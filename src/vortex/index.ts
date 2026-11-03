// MobileWright project, device, replay, report and benchmark routes.
// Loaded with a dynamic import from server.js, so the recorder keeps working on Node versions that
// cannot run TypeScript; only the new panels are unavailable there.

import { RunError } from '../engines/run-types.ts';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { createProcessInspector } from '../runtime/process-inspector.ts';
import { DeviceBusyError, DeviceLeases } from '../devices/device-lease.ts';
import { createDeviceManager, defaultAdb, type AdbDevice, type DeviceDetails } from '../devices/device-manager.ts';
import { decodePng } from '../visual/png.ts';
import { findTemplate, screenChange } from '../visual/match.ts';
import { refineSuggestions } from '../model/assertions.ts';
import { journalPending, journalEnd, recorderStillAlive } from '../engines/run-journal.ts';
import { RunIndex } from '../engines/run-index.ts';
import { parsePackageInfo } from '../runtime/package-info.ts';
import { redact } from '../runtime/log-file.ts';
import { maskSecrets } from '../reports/secrets.ts';
import { loadReport, renderHtml, renderJson, reportFile, writeMeta, type RunMeta } from '../reports/report.ts';
import { sameProcess } from '../runtime/process-inspector.ts';
import { BenchmarkRunner, renderBenchHtml } from '../bench/benchmark.ts';
import { assertPackage } from '../device.js';
import { detectMobilewright, MobilewrightRunner } from '../engines/mobilewright/runner.ts';
import { GenerationError, type Framework, type Variant } from '../model/output.ts';
import { fromUiSteps, RecordingError, slug, type UiStep } from '../model/recording.ts';
import { buildCase, caseDir, listProject, ProjectError, readCaseRecording, readManifest, saveCase, type CaseRef, type Mode } from '../project/project.ts';

export interface VortexOptions {
  root: string;
  stateDir: string;
  mock: boolean;
  log: (...a: unknown[]) => void;
}

/** Live recorder state the Vortex routes need (owned by server.js). */
export interface RecorderContext {
  outDir: () => string;
  pkg: () => string;
  size: () => { width: number; height: number } | null;
  serial: () => string | null;
  /** Foreground activity of the last capture. */
  activity?: () => string | null;
  /** Class names of the native elements on the last captured screen. */
  nativeTypes?: () => string[];
  /** PNG of the last captured screen. */
  screenshot?: () => Buffer | null;
}

type Json = (res: ServerResponse, code: number, obj: unknown) => void;
type ReadBody = (req: IncomingMessage) => Promise<Record<string, unknown>>;

const RUN_TIMEOUT_MS = 15 * 60_000;

const MOCK_DEVICE: DeviceDetails = {
  serial: 'mock-device',
  state: 'device',
  transport: 'unknown',
  model: 'Mock phone (samples/)',
  product: 'mock',
  deviceName: 'mock',
  transportId: null,
  manufacturer: 'Vortex',
  androidVersion: '14',
  sdk: 34,
  primaryAbi: 'arm64-v8a',
  abis: ['arm64-v8a'],
  abiFamily: 'arm',
  screen: { width: 1080, height: 2400, overridden: false },
  density: { dpi: 420, overridden: false },
  isEmulator: false,
};

export async function createVortex(o: VortexOptions) {
  const devices = createDeviceManager();
  const leases = new DeviceLeases();
  // In --mock mode MobileWright runs use the fake driver over the sample screens (clearly reported as simulated).
  // Otherwise a test driver is only used when the environment explicitly names one (integration tests).
  const fakeDriver = path.join(o.root, 'test', 'fixtures', 'fake-mobilewright-driver.mjs');
  if (o.mock) process.env.VORTEX_FAKE_SAMPLES ??= path.join(o.root, 'samples');
  const mwRunner = new MobilewrightRunner({ leases, runsDir: path.join(o.stateDir, 'runs'), testDriverModule: o.mock && fs.existsSync(fakeDriver) ? fakeDriver : process.env.VORTEX_MOBILEWRIGHT_TEST_DRIVER || null });
  let version = 'unknown';
  try {
    version = (JSON.parse(fs.readFileSync(path.join(o.root, 'package.json'), 'utf8')) as { version: string }).version;
  } catch {
    /* keep unknown */
  }
  const generator = `vortex-android-recorder ${version}`;
  const runsDir = path.join(o.stateDir, 'runs');
  const index = new RunIndex(path.join(runsDir, 'index.jsonl'));
  const procs = createProcessInspector();

  // ---- safe cleanup of runs interrupted by a recorder crash (Milestone 5) ----
  const recovered: { id: string; label: string; detail: string[] }[] = [];
  for (const j of journalPending(runsDir).filter(j => j.engine === 'mobilewright')) {
    if (recorderStillAlive(j)) {
      o.log('[runs]', `left active run ${j.id} alone: its recorder is still alive`);
      continue;
    }
    const detail: string[] = [];
    try {
      if (j.process) {
        const now = await procs.info(j.process.pid).catch(() => null);
        if (sameProcess(j.process, now)) {
          await procs.kill(j.process.pid, { force: true, tree: true });
          detail.push(`stopped its MobileWright process ${j.process.pid} (identity verified)`);
        } else detail.push('its process had already ended (or the PID now belongs to another program, which was left alone)');
      }
      const endedAt = new Date().toISOString();
      const result = { id: j.id, engine: j.engine, label: j.label, status: 'interrupted', category: null, summary: 'The recorder stopped while this run was in progress; Vortex cleaned up after it on the next start.', exitCode: null, signal: null, tests: null, failed: [], artifacts: [], cleanup: detail.map((d) => ({ step: 'recovery', ok: true, detail: d })), startedAt: j.startedAt, endedAt, durationMs: Date.parse(endedAt) - Date.parse(j.startedAt) };
      if (fs.existsSync(j.dir)) fs.writeFileSync(path.join(j.dir, 'result.json'), JSON.stringify(result, null, 2));
      index.add({ id: j.id, engine: j.engine, label: j.label, dir: j.dir, status: 'interrupted', summary: result.summary, startedAt: j.startedAt, durationMs: result.durationMs });
    } catch (e) {
      detail.push(`recovery error: ${(e as Error).message}`);
    } finally {
      journalEnd(runsDir, j.id);
      recovered.push({ id: j.id, label: j.label, detail });
      o.log('[runs]', `recovered interrupted run ${j.id}: ${detail.join('; ')}`);
    }
  }

  // ---- run metadata, reports and retries ----
  const metaCache = new Map<string, { at: number; device: RunMeta['device']; buildType: RunMeta['buildType']; appVersion: string | null }>();
  async function runMeta(serial: string, pkg: string) {
    const k = `${serial}|${pkg}`;
    const c = metaCache.get(k);
    if (c && Date.now() - c.at < 60_000) return c;
    let device: RunMeta['device'] = null;
    let buildType: RunMeta['buildType'] = 'unknown';
    let appVersion: string | null = null;
    if (o.mock) {
      device = { serial, model: MOCK_DEVICE.model, androidVersion: MOCK_DEVICE.androidVersion, sdk: MOCK_DEVICE.sdk, simulated: true };
      buildType = 'debug';
      appVersion = '1.0-demo';
    } else {
      const d = await devices.details(serial).catch(() => null);
      device = { serial, model: d ? [d.manufacturer, d.model].filter(Boolean).join(' ') || null : null, androidVersion: d?.androidVersion ?? null, sdk: d?.sdk ?? null, simulated: false };
      const info = parsePackageInfo(await defaultAdb(['-s', serial, 'shell', 'dumpsys', 'package', pkg]).catch(() => ''));
      buildType = info.debuggable === null ? 'unknown' : info.debuggable ? 'debug' : 'release';
      appVersion = info.versionName;
    }
    const v = { at: Date.now(), device, buildType, appVersion };
    metaCache.set(k, v);
    return v;
  }
  const retryNext = new Map<string, string>();
  type Engine = 'mobilewright';
  async function startTracked(engine: Engine, args: { testsDir: string; files?: string[]; file?: string; serial: string | null; appPackage: string; timeoutMs: number; reportDir?: string; label?: string; allowAutomationSwitch?: boolean }, retries: number, attempt = 1, previous: string | null = null): Promise<{ id: string }> {
    const label = args.label && attempt > 1 ? `${args.label} (retry ${attempt - 1})` : args.label;
    const mwDevice = args.serial && !o.mock ? await devices.details(args.serial).catch(() => null) : null;
    const started = await mwRunner.start({ testsDir: args.testsDir, files: args.files ?? [], serial: args.serial,
          deviceModel: mwDevice?.model, androidVersion: mwDevice?.androidVersion,
          deviceType: mwDevice ? (mwDevice.isEmulator ? 'emulator' : 'real') : null,
          timeoutMs: args.timeoutMs, reportDir: args.reportDir, label });
    const x = mwRunner;
    const run = x.get(started.id);
    const m = args.serial ? await runMeta(args.serial, args.appPackage).catch(() => null) : null;
    writeMeta(run.dir, { id: started.id, engine, label: run.label, files: (run.files ?? []).map((f) => path.relative(args.testsDir, f)), appPackage: args.appPackage, device: m?.device ?? null, buildType: m?.buildType ?? 'unknown', appVersion: m?.appVersion ?? null, retry: retries > 0 ? { attempt, of: retries + 1, previous } : null });
    void x.wait(started.id).then(async (r) => {
      const rep = loadReport(run.dir);
      if (rep) {
        try {
          fs.writeFileSync(path.join(run.dir, 'report.html'), renderHtml(rep));
          fs.writeFileSync(path.join(run.dir, 'report.json'), renderJson(rep));
        } catch {
          /* ignore */
        }
      }
      if (r.status === 'failed' && r.category === 'automation' && attempt <= retries) {
        try {
          const next = await startTracked(engine, args, retries, attempt + 1, started.id);
          retryNext.set(started.id, next.id);
        } catch (e) {
          o.log('[runs]', `retry not started: ${(e as Error).message}`);
        }
      }
    });
    return started;
  }
  /** Report folder of a run of this session or of the history. */
  function runDir(id: string): string | null {
    if (mwRunner.has(id)) return mwRunner.get(id).dir;
    const h = mwRunner.history(200).find((x) => x.id === id);
    return h?.dir ?? null;
  }

  // ---- performance analyzer (Milestone 6) ----
  /** Brings the app to its start state between benchmark runs (never timed). */
  async function resetApp(serial: string, pkg: string) {
    assertPackage(pkg);
    if (o.mock) return;
    const release = leases.acquire(serial, { kind: 'run', id: randomUUID(), label: 'Benchmark app reset' });
    try {
    await defaultAdb(['-s', serial, 'shell', 'am', 'force-stop', pkg]);
    await defaultAdb(['-s', serial, 'shell', 'monkey', '-p', pkg, '-c', 'android.intent.category.LAUNCHER', '1']);
    // wait for the app's window to have focus (polling, no fixed sleep)
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const w = await defaultAdb(['-s', serial, 'shell', 'dumpsys', 'window']).catch(() => '');
      if (new RegExp(`mCurrentFocus=.*${pkg.replace(/\./g, '\\.')}/`).test(w)) return;
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`${pkg} did not come to the foreground within 20 s after launch`);
    } finally { release(); }
  }
  let bench: BenchmarkRunner | null = null;
  const benchFor = (ctx: RecorderContext) =>
    (bench ??= new BenchmarkRunner({
      outDir: ctx.outDir, stateDir: o.stateDir, serial: ctx.serial, pkg: ctx.pkg, simulated: o.mock, mwRunner, leases,
      meta: (serial, pkg) => runMeta(serial, pkg),
      deviceIdentity: async (serial) => {
        if (o.mock) return {};
        const d = await devices.details(serial).catch(() => null);
        return { deviceModel: d?.model, androidVersion: d?.androidVersion, deviceType: d ? (d.isEmulator ? 'emulator' : 'real') : null };
      },
      resetApp,
      deviceDiscovery: async () => {
        if (o.mock) return { ms: null, reason: 'Device discovery not measured: simulated device (adb is not used).' };
        const t0 = performance.now();
        await devices.list();
        return { ms: Math.round((performance.now() - t0) * 10) / 10 };
      },
      log: (m) => o.log('[bench]', m),
    }));

  const FRAMEWORKS: Framework[] = ['mobilewright'];
  function projectInput(body: Record<string, unknown>, ctx: RecorderContext) {
    const steps = (body.steps as UiStep[]) ?? [];
    const name = String(body.name || 'recorded flow').trim() || 'recorded flow';
    const ref: CaseRef = { module: slug(String(body.module || 'general'), 'general'), case: slug(name) };
    if (Array.isArray(body.frameworks) && body.frameworks.some(f => f !== 'mobilewright')) throw new ProjectError('UNSUPPORTED_FRAMEWORK', 400, 'This recorder supports MobileWright only.');
    const frameworks = (Array.isArray(body.frameworks) ? body.frameworks : ['mobilewright']).filter((f): f is Framework => FRAMEWORKS.includes(f as Framework));
    const mode = (['plain', 'pom', 'both'].includes(String(body.mode)) ? body.mode : 'plain') as Mode;
    const target = (body.target === 'pom' ? 'pom' : 'plain') as Variant;
    // Keep the identity of a recording that is saved again under the same case.
    let id = `rec-${randomUUID().slice(0, 8)}`;
    let createdAt: string | undefined;
    try {
      const prev = JSON.parse(fs.readFileSync(path.join(caseDir(ctx.outDir(), ref), 'recording.json'), 'utf8')) as { id?: string; createdAt?: string };
      if (prev.id) id = prev.id;
      createdAt = prev.createdAt;
    } catch {
      /* new case */
    }
    const recording = fromUiSteps(steps, { id, name, module: ref.module, appPackage: String(body.pkg || ctx.pkg()), serial: ctx.serial(), screen: ctx.size(), createdAt, version });
    return { ref, recording, frameworks, mode, target };
  }

  /** Entry files to run for a case, module or the whole project. */
  function runTargets(outDir: string, engine: Framework, body: Record<string, unknown>): { files: string[]; reportDir: string; label: string; appPackage: string } {
    const scope = String(body.scope ?? 'case');
    const { modules } = listProject(outDir);
    const pick = (c: (typeof modules)[number]['cases'][number]) => {
      if(c.pendingReview.length)throw new RunError('PENDING_REVIEW',409,`${c.module}/${c.case} has edited output awaiting .vortex-new review. Resolve it before replay.`);
      const mine = c.entries.filter((e) => e.framework === engine && e.exists);
      const v = body.variant === 'plain' || body.variant === 'pom' ? body.variant : null;
      return (v ? mine.filter((e) => e.variant === v) : mine.filter((e) => e.discoverable)).map((e) => path.join(c.module, c.case, e.path));
    };
    if (scope === 'case') {
      const ref = { module: String(body.module ?? ''), case: String(body.case ?? '') };
      const c = modules.find((m) => m.module === ref.module)?.cases.find((x) => x.case === ref.case);
      if (!c) throw new RunError('NOT_SAVED', 404, `No saved case ${ref.module}/${ref.case}.`);
      const files = pick(c);
      if (!files.length) throw new RunError('NO_TESTS', 404, `${ref.module}/${ref.case} has no saved MobileWright test${body.variant ? ` (${String(body.variant)})` : ''}. Save it with that framework selected.`);
      const appPackage=readCaseRecording(outDir,ref).recording.app.package;assertPackage(appPackage);
      return { files, reportDir: path.join(caseDir(outDir, ref), 'reports'), appPackage, label: `${ref.module}/${ref.case}${body.variant ? ` (${String(body.variant)})` : ''}` };
    }
    const mods = scope === 'module' ? modules.filter((m) => m.module === String(body.module ?? '')) : scope === 'all' ? modules : [];
    if (scope !== 'module' && scope !== 'all') throw new RunError('BAD_SCOPE', 400, 'scope must be case, module or all.');
    const files = mods.flatMap((m) => m.cases.flatMap(pick));
    if (!files.length) throw new RunError('NO_TESTS', 404, `Nothing to run: no saved MobileWright tests in ${scope === 'module' ? `module "${String(body.module)}"` : 'the project'}.`);
    const packages=new Set(mods.flatMap(m=>m.cases.filter(c=>pick(c).length).map(c=>readCaseRecording(outDir,{module:c.module,case:c.case}).recording.app.package)));
    if(packages.size!==1)throw new RunError('MIXED_APP_BATCH',409,'Run cases for one app package at a time. This batch contains different app targets.');
    const appPackage=[...packages][0];assertPackage(appPackage);
    return { files, reportDir: path.join(outDir, '.vortex-reports'), appPackage, label: scope === 'module' ? `module ${String(body.module)}` : 'all tests' };
  }

  function listTests(outDir: string) {
    let names: string[] = [];
    try {
      names = fs.readdirSync(outDir);
    } catch {
      return [];
    }
    return names
      .filter((f) => f.endsWith('.spec.ts'))
      .map((f) => {
        const st = fs.statSync(path.join(outDir, f));
        return { file: f, framework: 'mobilewright', modified: st.mtime.toISOString(), size: st.size, runnable: false };
      })
      .sort((a, b) => b.modified.localeCompare(a.modified));
  }

  async function handle(req: IncomingMessage, res: ServerResponse, url: URL, json: Json, readBody: ReadBody, ctx: RecorderContext): Promise<boolean> {
    const p = url.pathname;
    const ours = ['/api/bench', '/api/reports', '/api/automation/', '/api/devices', '/api/tests', '/api/runs', '/api/project', '/api/mobilewright/', '/api/visual/'].some((x) => p.startsWith(x));
    if (!ours) return false;
    try {
      const POST = req.method === 'POST';
      const body = POST ? await readBody(req) : {};
      const bool = (k: string) => body[k] === true;
      let out: unknown;
      const runMatch = /^\/api\/runs\/([A-Za-z0-9-]+)(\/cancel|\/artifact)?$/.exec(p);
      const repMatch = /^\/api\/reports\/([A-Za-z0-9-]+)(\/export\.html|\/export\.json|\/file)?$/.exec(p);

      if (!POST && p === '/api/automation/conflicts') {
        const owner = ctx.serial() ? leases.holder(ctx.serial()!) : null;
        json(res, 200, { engine: 'mobilewright', serial: ctx.serial(), canResolve: false, conflicts: owner ? [{ code: 'device-busy', title: 'Device in use', message: owner.label }] : [] });
        return true;
      }

      // ---- benchmarks (Milestone 6) ----
      const benchMatch = /^\/api\/bench\/([A-Za-z0-9-]+)(\/export\.html|\/export\.json|\/cancel)?$/.exec(p);
      if (p === '/api/bench' && !POST) {
        const b = benchFor(ctx);
        out = { active: b.active(), benchmarks: b.list() };
        json(res, 200, out);
        return true;
      }
      if (p === '/api/bench' && POST) {
        const fws = Array.isArray(body.frameworks) ? (body.frameworks as unknown[]).map(String) : undefined;
        out = await benchFor(ctx).start({
          ref: { module: String(body.module ?? ''), case: String(body.case ?? '') },
          frameworks: fws as 'mobilewright'[] | undefined,
          iterations: Number(body.iterations), warmup: body.warmup === undefined ? undefined : Number(body.warmup),
          probes: body.probes !== false, coldStart: body.coldStart === true, resetApp: body.resetApp !== false,
          timeoutMs: Number(body.timeoutMs) || undefined,
        });
        json(res, 200, out);
        return true;
      }
      if (benchMatch) {
        const b = benchFor(ctx);
        if (POST && benchMatch[2] === '/cancel') {
          json(res, 200, b.cancel(benchMatch[1]));
          return true;
        }
        const r = b.get(benchMatch[1]);
        if (!r) throw Object.assign(new Error('No such benchmark.'), { code: 'NOT_FOUND', httpStatus: 404 });
        if (benchMatch[2] === '/export.html') {
          // ?inline=1: shown inside the Benchmarks dialog (the page has no scripts); otherwise a download
          res.writeHead(200, url.searchParams.get('inline') === '1' ? { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:" } : { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="vortex-benchmark-${r.id}.html"` });
          res.end(renderBenchHtml(r));
          return true;
        }
        if (benchMatch[2] === '/export.json') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="vortex-benchmark-${r.id}.json"` });
          res.end(JSON.stringify(r, null, 2));
          return true;
        }
        json(res, 200, r);
        return true;
      }
      // ---- reports (Milestone 5) ----
      if (!POST && p === '/api/reports') {
        const list = mwRunner.history(200).sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 200);
        out = {
          recovered,
          reports: list.map((h) => {
            let meta: RunMeta | null = null;
            try {
              meta = JSON.parse(fs.readFileSync(path.join(h.dir, 'meta.json'), 'utf8'));
            } catch {
              meta = null;
            }
            return { ...h, device: meta?.device ?? null, buildType: meta?.buildType ?? 'unknown', retry: meta?.retry ?? null };
          }),
        };
      } else if (repMatch && !POST) {
        const dir = runDir(repMatch[1]);
        const rep = dir ? loadReport(dir) : null;
        if (!rep) throw Object.assign(new Error('No report for this run (it may still be running).'), { code: 'NO_REPORT', httpStatus: 404 });
        if (repMatch[2] === '/export.html') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Disposition': `attachment; filename="vortex-run-${rep.id}.html"` });
          res.end(renderHtml(rep));
          return true;
        }
        if (repMatch[2] === '/export.json') {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': `attachment; filename="vortex-run-${rep.id}.json"` });
          res.end(renderJson(rep));
          return true;
        }
        if (repMatch[2] === '/file') {
          const f = reportFile(rep.dir, url.searchParams.get('name') || '');
          if (!f) {
            json(res, 404, { error: 'no such file' });
            return true;
          }
          const ext = path.extname(f);
          res.writeHead(200, { 'Content-Type': ext === '.png' ? 'image/png' : ext === '.json' ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8' });
          res.end(ext === '.png' ? fs.readFileSync(f) : redact(maskSecrets(fs.readFileSync(f, 'utf8'))));
          return true;
        }
        out = { ...rep, retryNext: retryNext.get(rep.id) ?? null };
      }
      // ---- devices ----
      else if (!POST && p === '/api/devices') {
        const list: AdbDevice[] = o.mock ? [MOCK_DEVICE] : await devices.list();
        const cur = ctx.serial();
        out = { devices: list, current: cur, currentConnected: cur ? list.some((d) => d.serial === cur && d.state === 'device') : null, leases: leases.all() };
      } else if (!POST && p === '/api/devices/details') {
        out = o.mock ? MOCK_DEVICE : await devices.details(url.searchParams.get('serial') || '');
      }
      // ---- visual fallback (Milestone 4) ----
      else if (POST && p === '/api/visual/find') {
        const shot = ctx.screenshot?.();
        if (!shot) throw Object.assign(new Error('No screen captured yet: refresh the screen first.'), { code: 'NO_SCREEN', httpStatus: 409 });
        const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(body.template ?? ''));
        if (!m) throw Object.assign(new Error('template must be a PNG data URL'), { code: 'BAD_TEMPLATE', httpStatus: 400 });
        const roi = body.roi && typeof body.roi === 'object' ? (body.roi as { x: number; y: number; w: number; h: number }) : null;
        const minConfidence = Number(body.minConfidence) > 0 && Number(body.minConfidence) <= 1 ? Number(body.minConfidence) : 0.9;
        out = findTemplate(decodePng(shot), decodePng(Buffer.from(m[1], 'base64')), { roi, minConfidence });
      }
      else if (!POST && p === '/api/tests') out = { outDir: ctx.outDir(), tests: listTests(ctx.outDir()) };
      // ---- project: shared model, MobileWright Plain/POM/Both ----
      else if (POST && p === '/api/project/preview') {
        const inp = projectInput(body, ctx);
        if (!inp.frameworks.length) throw new ProjectError('NO_FRAMEWORK', 400, 'Choose at least one framework.');
        const b = buildCase(inp.recording, inp.ref, { frameworks: inp.frameworks, mode: inp.mode, target: inp.target, size: ctx.size() });
        const existing = readManifest(caseDir(ctx.outDir(), inp.ref));
        out = { ref: inp.ref, caseDir: caseDir(ctx.outDir(), inp.ref), exists: !!existing, target: b.target, files: b.files, issues: b.issues };
      } else if (POST && p === '/api/project/save') {
        const inp = projectInput(body, ctx);
        if (!inp.recording.events.length) throw new ProjectError('EMPTY', 400, 'Nothing recorded yet: record at least one step before saving.');
        const b = buildCase(inp.recording, inp.ref, { frameworks: inp.frameworks, mode: inp.mode, target: inp.target, size: ctx.size() });
        if (b.issues.length) throw new GenerationError(b.issues);
        const used = new Set(inp.recording.events.map((e) => e.templateRef?.split('/').pop()).filter(Boolean));
        const assets = ((body.assets as { name: string; dataUrl: string }[]) ?? [])
          .filter((a) => used.has(path.basename(String(a.name))))
          .flatMap((a) => {
            const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(a.dataUrl ?? ''));
            return m ? [{ name: path.basename(String(a.name)), data: Buffer.from(m[1], 'base64') }] : [];
          });
        const r = saveCase(ctx.outDir(), inp.ref, {
          recording: inp.recording, files: b.files, assets, mode: inp.mode, target: inp.mode === 'both' ? inp.target : null, frameworks: inp.frameworks,
          replace: Array.isArray(body.replace) ? (body.replace as unknown[]).map(String) : [], generator,
        });
        out = { ref: inp.ref, ...r };
      } else if (!POST && p === '/api/project') out = { outDir: ctx.outDir(), ...listProject(ctx.outDir()) };
      else if (!POST && p === '/api/project/recording') {
        out = readCaseRecording(ctx.outDir(), { module: url.searchParams.get('module') || '', case: url.searchParams.get('case') || '' });
      } else if (!POST && p === '/api/mobilewright/env') out = { ...detectMobilewright(ctx.outDir()), simulated: o.mock };
      // ---- runs ----
      else if (POST && p === '/api/runs') {
        const timeoutMs = Number(body.timeoutMs) > 0 ? Math.min(Number(body.timeoutMs), 3_600_000) : RUN_TIMEOUT_MS;
        if (body.engine && body.engine !== 'mobilewright') throw new RunError('UNSUPPORTED_FRAMEWORK', 400, 'Only MobileWright runs are supported.');
        const engine = 'mobilewright' as const;
        const retries = Math.max(0, Math.min(3, Math.floor(Number(body.retries) || 0)));
        if (retries > 0 && !bool('retrySafe')) throw new RunError('RETRY_SAFETY_REQUIRED', 409,
          'Retries repeat the whole test and may duplicate products or other changes. Confirm that this flow is safe to repeat.');
        const allowAutomationSwitch = bool('resolveAutomationConflict');
        {
          const t = runTargets(ctx.outDir(), engine, body);
          out = await startTracked(engine, { testsDir: ctx.outDir(), files: t.files, serial: ctx.serial(), appPackage: t.appPackage, timeoutMs, reportDir: t.reportDir, label: t.label, allowAutomationSwitch }, retries);
        }
      } else if (!POST && p === '/api/runs') {
        out = {
          active: mwRunner.active(),
          history: mwRunner.history().sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 40),
        };
      } else if (runMatch && !POST && !runMatch[2]) out = { ...mwRunner.get(runMatch[1], Number(url.searchParams.get('from')) || 0), retryNext: retryNext.get(runMatch[1]) ?? null };
      else if (runMatch && POST && runMatch[2] === '/cancel') out = mwRunner.cancel(runMatch[1]);
      else if (runMatch && !POST && runMatch[2] === '/artifact') {
        const r = mwRunner.get(runMatch[1]);
        const want = String(url.searchParams.get('file') || '');
        const ok = /^failure-[A-Za-z0-9_.-]+\.(png|xml|html)$/.test(want) || /^checkpoint-[A-Za-z0-9_.-]+\.png$/.test(want) || (r.engine === 'mobilewright' && /^test-results\/[A-Za-z0-9_.\/-]+\.png$/.test(want) && !want.split('/').includes('..'));
        const f = path.resolve(r.dir, want);
        if (!ok || !f.startsWith(path.resolve(r.dir) + path.sep) || !fs.existsSync(f)) {
          json(res, 404, { error: 'no such artifact' });
          return true;
        }
        res.writeHead(200, { 'Content-Type': f.endsWith('.png') ? 'image/png' : 'text/plain; charset=utf-8' });
        res.end(f.endsWith('.png') ? fs.readFileSync(f) : redact(maskSecrets(fs.readFileSync(f, 'utf8'))));
        return true;
      } else {
        json(res, 404, { error: 'not found' });
        return true;
      }
      json(res, 200, out);
    } catch (e) {
      const err = e as Error & { code?: string; httpStatus?: number; details?: unknown; hint?: string | null; issues?: unknown };
      if (e instanceof GenerationError) json(res, 422, { error: e.message, code: e.code, issues: e.issues });
      else if (e instanceof RecordingError || e instanceof ProjectError) json(res, (e as { httpStatus: number }).httpStatus, { error: e.message, code: (e as { code: string }).code });
      else if (e instanceof RunError || e instanceof DeviceBusyError || err.httpStatus) {
        json(res, err.httpStatus ?? 500, { error: err.message, code: err.code, details: err.details, hint: err.hint ?? null });
      } else json(res, 500, { error: err.message });
    }
    return true;
  }

  /** Called before the recorder drives the phone through ADB. Throws when a test owns it. */
  function assertDeviceFree(serial: string | null) {
    if (serial) leases.assertFree(serial);
  }

  async function shutdown() {
    const ab = bench?.active();
    if (ab) bench!.cancel(ab);
    for (const r of mwRunner.active()) {
      try {
        const x = mwRunner;
        x.cancel(r.id);
        await Promise.race([x.wait(r.id), new Promise((res) => setTimeout(res, 10_000))]);
      } catch {
        /* ignore */
      }
    }

  }

  /** Share of the screen that changed between two PNG screenshots (0..1), or null if they cannot be compared. */
  function changeBetween(a: Buffer | null | undefined, b: Buffer | null | undefined): number | null {
    if (!a || !b) return null;
    try {
      return screenChange(decodePng(a), decodePng(b));
    } catch {
      return null;
    }
  }

  return { handle, bench: () => bench, assertDeviceFree, shutdown, mwRunner, leases, changeBetween, refineSuggestions, stateDir: path.resolve(o.stateDir) };
}
