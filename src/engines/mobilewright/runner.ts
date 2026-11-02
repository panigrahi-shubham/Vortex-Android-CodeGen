// Runs saved MobileWright tests with MobileWright's own runner (`mobilewright test`, built on Playwright Test).
//
//  - Only saved .test.ts / .vortex-alt.ts files inside the output folder can run.
//  - The runner is the project's own installed copy (node_modules/mobilewright), found by walking up from the
//    output folder; nothing is downloaded. Telemetry is turned off for runs Vortex starts.
//  - For every run Vortex writes a small wrapper config into the run's report folder. It imports the project's
//    own mobilewright.config (when there is one) and only sets the device, the files to run, the output folder
//    and the reporters, so results are structured (JSON) and the project's config is never edited.
//  - The device is leased for the run, excluding recorder actions until it finishes.
//  - Success only when the runner exited 0 AND the JSON report counts at least one passed test and no failures.

import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { redact } from '../../runtime/log-file.ts';
import { createProcessInspector, type ProcessInspector } from '../../runtime/process-inspector.ts';
import type { DeviceLeases } from '../../devices/device-lease.ts';
import { RunError, type RunStatus } from '../run-types.ts';
import { RunIndex, stepAbove } from '../run-index.ts';
import { journalBegin, journalEnd } from '../run-journal.ts';
import { diagnoseFailure, type FailureDiagnosis } from '../../reports/diagnosis.ts';
import { maskSecrets } from '../../reports/secrets.ts';

export const MW_PINNED = '0.0.66';

export interface MobilewrightEnv {
  ok: boolean;
  projectDir: string | null;
  cli: string | null;
  version: string | null;
  config: string | null;
  problems: string[];
  installCommand: string | null;
}

const CONFIG_NAMES = ['mobilewright.config.ts', 'mobilewright.config.mts', 'mobilewright.config.cts', 'mobilewright.config.js', 'mobilewright.config.mjs', 'mobilewright.config.cjs'];

/** Finds the MobileWright project that contains `dir` (the nearest folder with node_modules/@mobilewright/test). */
export function detectMobilewright(dir: string): MobilewrightEnv {
  let cur = path.resolve(dir);
  for (;;) {
    const nm = path.join(cur, 'node_modules');
    const testPkg = path.join(nm, '@mobilewright', 'test', 'package.json');
    if (fs.existsSync(testPkg)) {
      const cli = path.join(nm, 'mobilewright', 'dist', 'cli.js');
      let version: string | null = null;
      try {
        version = (JSON.parse(fs.readFileSync(testPkg, 'utf8')) as { version?: string }).version ?? null;
      } catch {
        /* unreadable package.json */
      }
      const problems: string[] = [];
      if (!fs.existsSync(cli)) problems.push(`@mobilewright/test is installed in ${cur} but its runner (node_modules/mobilewright/dist/cli.js) is missing. Reinstall it.`);
      return { ok: !problems.length, projectDir: cur, cli: fs.existsSync(cli) ? cli : null, version, config: findConfig(dir, cur), problems, installCommand: problems.length ? `npm install -D @mobilewright/test@${MW_PINNED}` : null };
    }
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  return {
    ok: false,
    projectDir: null,
    cli: null,
    version: null,
    config: null,
    problems: [`No MobileWright project contains the output folder (${path.resolve(dir)}). Start the recorder with --out pointing into your MobileWright project, or install it in a parent folder.`],
    installCommand: `npm install -D @mobilewright/test@${MW_PINNED}`,
  };
}

/** Nearest mobilewright.config.* between `from` and the project root (inclusive). */
function findConfig(from: string, projectDir: string): string | null {
  let cur = path.resolve(from);
  for (;;) {
    for (const n of CONFIG_NAMES) {
      const f = path.join(cur, n);
      if (fs.existsSync(f)) return f;
    }
    if (cur === projectDir) return null;
    const up = path.dirname(cur);
    if (up === cur) return null;
    cur = up;
  }
}

const rel = (fromDir: string, to: string) => {
  const r = path.relative(fromDir, to).split(path.sep).join('/');
  return r.startsWith('.') ? r : './' + r;
};
const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The per-run wrapper config (TypeScript, loaded by MobileWright's runner). */
export function wrapperConfig(o: { configDir: string; userConfig: string | null; deviceId: string; testDir: string; files: string[]; outputDir: string; jsonFile: string; driverModule: string | null }): string {
  const L: string[] = [
    '// Written by Vortex for one test run. It is not part of your project and can be deleted with the report.',
    "import { defineConfig } from 'mobilewright';",
  ];
  if (o.userConfig) L.push(`import projectConfig from ${JSON.stringify(rel(o.configDir, o.userConfig))};`);
  if (o.driverModule) L.push(`import TestDriver from ${JSON.stringify(rel(o.configDir, o.driverModule))};`);
  L.push('');
  L.push(o.userConfig ? '// eslint-disable-next-line @typescript-eslint/no-explicit-any\nconst { projects: _projects, ...base } = (projectConfig ?? {}) as any;' : 'const base = {};');
  // Matched against absolute paths; separators may differ by platform, so match either slash.
  const match = o.files.map((f) => `new RegExp(${JSON.stringify(f.split(path.sep).map(reEscape).join('[\\\\/]') + '$')})`);
  L.push('export default defineConfig({');
  L.push('  platform: \'android\',');
  L.push('  ...base,');
  L.push(`  deviceId: ${JSON.stringify(o.deviceId)},`);
  L.push(`  testDir: ${JSON.stringify(o.testDir)},`);
  L.push(`  testMatch: [${match.join(', ')}],`);
  L.push("  testIgnore: ['**/node_modules/**'],");
  L.push(`  outputDir: ${JSON.stringify(o.outputDir)},`);
  L.push(`  reporter: [['line'], ['json', { outputFile: ${JSON.stringify(o.jsonFile)} }]],`);
  if (o.driverModule) L.push('  // simulated device for tests and demos (never used for real devices)\n  // eslint-disable-next-line @typescript-eslint/no-explicit-any\n  driver: new TestDriver() as any,');
  L.push('});', '');
  return L.join('\n');
}

interface MobilecliDevice {
  id: string;
  platform: string;
  type: string;
  state: string;
  model?: string;
  version?: string;
}

/** Map ADB's transport serial to Mobilecli's device ID (which may be an AVD/device alias). */
const execFileAsync = promisify(execFile);
async function mobilewrightDeviceId(projectDir: string, serial: string, expected: { model?: string | null; androidVersion?: string | null; type?: string | null }): Promise<string> {
  const cli = path.join(projectDir, 'node_modules', 'mobilecli', 'index.js');
  if (!fs.existsSync(cli)) return serial;
  let devices: MobilecliDevice[];
  try {
    const { stdout } = await execFileAsync(process.execPath, [cli, 'devices', '--platform', 'android'], {
      encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
    });
    const parsed = JSON.parse(stdout) as { status?: string; data?: { devices?: MobilecliDevice[] } };
    devices = parsed.status === 'ok' && Array.isArray(parsed.data?.devices) ? parsed.data.devices : [];
  } catch {
    // Preserve the previous behavior if Mobilecli cannot be queried; its normal
    // allocation error will then explain that the requested serial is absent.
    return serial;
  }
  const direct = devices.find((d) => d.id === serial && d.platform === 'android' && d.state === 'online');
  if (direct) return direct.id;
  // An unrelated sole online device is not evidence that it is the selected ADB device.
  // Alias mapping needs at least the selected device's model; an exact serial match above does not.
  const candidates = devices.filter((d) => !!expected.model && d.platform === 'android' && d.state === 'online'
    && (!expected.model || d.model === expected.model)
    && (!expected.androidVersion || d.version === expected.androidVersion)
    && (!expected.type || d.type === expected.type));
  if (candidates.length === 1) return candidates[0].id;
  if (candidates.length === 0) {
    throw new RunError('MOBILEWRIGHT_DEVICE_MISMATCH', 409,
      `MobileWright cannot identify the selected ADB device ${serial}${expected.model ? ` (${expected.model})` : ''}. Connect it to Mobilecli or select a matching online Android device.`,
      { serial, model: expected.model ?? null, androidVersion: expected.androidVersion ?? null, type: expected.type ?? null,
        available: devices.filter((d) => d.platform === 'android' && d.state === 'online').map((d) => ({ id: d.id, model: d.model ?? null, version: d.version ?? null, type: d.type })) });
  }
  throw new RunError('MOBILEWRIGHT_DEVICE_AMBIGUOUS', 409,
    `More than one MobileWright device matches ADB device ${serial}; set a MobileWright device ID explicitly.`,
    { serial, model: expected.model ?? null, available: candidates.map((d) => d.id) });
}

// ---- JSON report -----------------------------------------------------------------------------

interface PwAttachment { name: string; contentType?: string; body?: string; path?: string }
interface PwResult { status: string; error?: { message?: string; stack?: string }; errors?: { message?: string; stack?: string }[]; attachments?: PwAttachment[] }
interface PwTest { status: string; results: PwResult[] }
interface PwSpec { title: string; file: string; line: number; tests: PwTest[] }
interface PwSuite { title: string; file?: string; specs?: PwSpec[]; suites?: PwSuite[] }
interface PwReport { stats?: { expected: number; unexpected: number; flaky: number; skipped: number }; suites?: PwSuite[]; errors?: { message?: string; stack?: string }[] }

const ansi = (s: string) => s.replace(/\u001b\[[0-9;]*m/g, '');

export function parseReport(r: PwReport) {
  const failed: { title: string; file: string; message: string; stack: string }[] = [];
  const attachments: PwAttachment[] = [];
  const walk = (s: PwSuite, trail: string[]) => {
    for (const sp of s.specs ?? []) {
      for (const t of sp.tests) {
        for (const r of t.results) attachments.push(...(r.attachments ?? []));
        if (t.status !== 'unexpected') continue;
        const last = t.results[t.results.length - 1];
        const err = last?.error ?? last?.errors?.[0] ?? {};
        failed.push({ title: [...trail, sp.title].filter(Boolean).join(' > '), file: sp.file, message: ansi(err.message ?? 'failed').split('\n').filter(Boolean).slice(0, 3).join(' '), stack: ansi(err.stack ?? '') });
      }
    }
    for (const c of s.suites ?? []) walk(c, c.file && !trail.length ? [] : [...trail, c.title]);
  };
  for (const s of r.suites ?? []) walk(s, []);
  const st = r.stats ?? { expected: 0, unexpected: 0, flaky: 0, skipped: 0 };
  return { attachments, passed: st.expected + st.flaky, failedCount: st.unexpected, skipped: st.skipped, total: st.expected + st.flaky + st.unexpected + st.skipped, failed, errors: (r.errors ?? []).map((e) => ansi(e.message ?? '').trim()).filter(Boolean) };
}

/** The "// N. ..." step for a failure: the first stack frame that points into one of the run's test files. */
export function failedStepTs(files: string[], stack: string): string | null {
  for (const m of stack.matchAll(/((?:[A-Za-z]:)?[^\s():]+\.(?:test|vortex-alt)\.ts):(\d+):\d+/g)) {
    const f = files.find((x) => path.resolve(x) === path.resolve(m[1]) || x.split(path.sep).join('/').endsWith(m[1].split(path.sep).join('/')));
    if (!f) continue;
    try {
      return stepAbove(fs.readFileSync(f, 'utf8'), Number(m[2]), /^test\(/, /^\s+\/\/ (\d+\. .*)$/);
    } catch {
      return null;
    }
  }
  return null;
}

// ---- runner ----------------------------------------------------------------------------------

export interface MwRunResult {
  status: RunStatus;
  category: 'import-or-syntax' | 'automation' | 'runner' | 'usage' | null;
  summary: string;
  exitCode: number | null;
  signal: string | null;
  tests: { total: number; passed: number; failed: number; skipped: number } | null;
  failed: { test: string; message: string; step: string | null; details: string; diagnosis?: FailureDiagnosis }[];
  artifacts: { type: string; file?: string }[];
  sessionStartupMs?: number | null;
  cleanup: { step: string; ok: boolean; detail: string }[];
  simulated: boolean;
  startedAt: string;
  endedAt: string;
  durationMs: number;
}

interface Run {
  id: string;
  /** false: kept out of the run history (benchmark iterations) */
  record: boolean;
  files: string[];
  label: string;
  dir: string;
  serial: string;
  status: RunStatus;
  output: string;
  outputOffset: number;
  child: ChildProcess | null;
  cancelRequested: boolean;
  timedOut: boolean;
  result: MwRunResult | null;
  simulated: boolean;
  done: Promise<MwRunResult>;
}

export interface MwRunnerDeps {
  leases: DeviceLeases;
  runsDir: string;
  /** Driver module injected into the wrapper config (tests and --mock demos only; never set from the UI). */
  testDriverModule?: string | null;
  inspector?: ProcessInspector;
  index?: RunIndex;
  nodePath?: string;
  maxOutputChars?: number;
}

export class MobilewrightRunner {
  #runs = new Map<string, Run>();
  #d: Required<MwRunnerDeps>;

  constructor(deps: MwRunnerDeps) {
    this.#d = { testDriverModule: null, inspector: createProcessInspector(), index: new RunIndex(path.join(deps.runsDir, 'index.jsonl')), nodePath: process.execPath, maxOutputChars: 2_000_000, ...deps } as Required<MwRunnerDeps>;
  }

  static resolveTestFile(testsDir: string, file: string): string {
    const root = path.resolve(testsDir);
    const abs = path.resolve(root, file);
    if (!abs.startsWith(root + path.sep)) throw new RunError('OUTSIDE_TESTS_DIR', 400, 'Only tests saved in the output folder can be run.');
    if (!/^[A-Za-z0-9_.-]+\.(test|vortex-alt)\.ts$/.test(path.basename(abs))) throw new RunError('NOT_A_TEST_FILE', 400, 'Only saved MobileWright tests (*.test.ts) can be run.');
    if (!fs.existsSync(abs)) throw new RunError('NOT_SAVED', 404, `${path.basename(abs)} is not saved. Save the test first; Vortex only runs saved code.`);
    return abs;
  }

  async start(o: { testsDir: string; files: string[]; serial: string | null; deviceModel?: string | null; androidVersion?: string | null; deviceType?: string | null; timeoutMs: number; reportDir?: string; label?: string; /** false = not added to the run history (benchmark iterations) */ record?: boolean }): Promise<{ id: string }> {
    if (!o.files.length) throw new RunError('NO_TESTS', 400, 'Nothing selected to run.');
    const files = o.files.map((f) => MobilewrightRunner.resolveTestFile(o.testsDir, f));
    if (!o.serial) throw new RunError('NO_DEVICE', 409, 'No device is selected. Connect the phone and refresh the screen first.');
    const env = detectMobilewright(o.testsDir);
    if (!env.ok || !env.cli || !env.projectDir) throw new RunError('MOBILEWRIGHT_NOT_READY', 409, env.problems.join(' '), { installCommand: env.installCommand });
    // Synthetic drivers own their own device namespace. Never discover or substitute a physical phone.
    const mobilewrightId = this.#d.testDriverModule ? o.serial
      : await mobilewrightDeviceId(env.projectDir, o.serial, { model: o.deviceModel, androidVersion: o.androidVersion, type: o.deviceType });

    const id = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')}-${randomUUID().slice(0, 6)}`;
    const label = o.label ?? (files.length === 1 ? path.basename(files[0]) : `${files.length} MobileWright tests`);
    const release = this.#d.leases.acquire(o.serial, { kind: 'run', id, label });
    const simulated = !!this.#d.testDriverModule;
    let dir: string;
    let configFile: string;
    let jsonFile: string;
    try {
      dir = o.reportDir ? path.join(o.reportDir, `${id}-mobilewright`) : path.join(this.#d.runsDir, `${id}-mobilewright`);
      fs.mkdirSync(dir, { recursive: true });
      configFile = path.join(dir, 'vortex.mobilewright.config.ts');
      jsonFile = path.join(dir, 'results.json');
      fs.writeFileSync(configFile, wrapperConfig({ configDir: dir, userConfig: env.config, deviceId: mobilewrightId, testDir: path.resolve(o.testsDir), files, outputDir: path.join(dir, 'test-results'), jsonFile, driverModule: this.#d.testDriverModule }));
    } catch (e) {
      // A failed report/config write must not leave a device owned by a run that never started.
      release();
      throw new RunError('PREPARE_FAILED', 500, `Could not prepare the MobileWright run: ${(e as Error).message}`);
    }

    let resolveDone!: (r: MwRunResult) => void;
    const run: Run = {
      id, record: o.record !== false, files, label, dir, serial: o.serial, status: 'starting', output: '', outputOffset: 0, child: null,
      cancelRequested: false, timedOut: false, result: null, simulated,
      done: new Promise<MwRunResult>((r) => (resolveDone = r)),
    };
    this.#runs.set(id, run);
    const startedAt = new Date().toISOString();
    const args = [env.cli, 'test', '-c', configFile];
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      MOBILEWRIGHT_DISABLE_TELEMETRY: '1',
      DO_NOT_TRACK: '1',
      FORCE_COLOR: '0',
      PLAYWRIGHT_JSON_OUTPUT_FILE: jsonFile,
      PW_TEST_HTML_REPORT_OPEN: 'never',
    };
    this.#append(run, `$ node ${args.map((a) => (a.includes(' ') ? JSON.stringify(a) : a)).join(' ')}\n`);
    if (simulated) this.#append(run, '[vortex] simulated device: the fake MobileWright driver is used (mock mode / tests). Results say nothing about a real phone.\n');
    if (env.config) this.#append(run, `[vortex] using your config ${env.config} (device, files, output folder and reporters are set for this run)\n`);

    let child: ChildProcess;
    try {
      child = spawn(this.#d.nodePath, args, { cwd: env.projectDir, env: childEnv, detached: process.platform !== 'win32', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
      release();
      this.#runs.delete(id);
      throw new RunError('SPAWN_FAILED', 500, `Could not start MobileWright: ${(e as Error).message}`);
    }
    run.child = child;
    run.status = 'running';
    const pid = child.pid;
    void (async () => journalBegin(this.#d.runsDir, { id, engine: 'mobilewright', label, dir, serial: o.serial!, startedAt, process: pid ? await this.#d.inspector.info(pid).catch(() => null) : null }))();
    child.stdout!.on('data', (b: Buffer) => this.#append(run, b.toString('utf8')));
    child.stderr!.on('data', (b: Buffer) => this.#append(run, b.toString('utf8')));
    const timer = setTimeout(() => {
      run.timedOut = true;
      this.#append(run, `\n[vortex] timeout after ${Math.round(o.timeoutMs / 1000)} s: stopping the run\n`);
      this.#kill(run, false);
    }, o.timeoutMs);

    let finished = false;
    const finish = (code: number | null, signal: NodeJS.Signals | null, spawnError?: Error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      const result = this.#finish(run, code, signal, startedAt, jsonFile, spawnError);
      journalEnd(this.#d.runsDir, id);
      release();
      result.cleanup.push({ step: 'release device', ok: true, detail: `${run.serial} is free again` });
      run.result = result;
      run.status = result.status;
      run.child = null;
      try {
        fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify({ id, engine: 'mobilewright', label, files, serial: run.serial, ...result }, null, 2));
      } catch {
        /* report folder removed */
      }
      if (run.record) this.#d.index.add({ id, engine: 'mobilewright', label, dir, status: result.status, summary: result.summary, startedAt, durationMs: result.durationMs });
      resolveDone(result);
    };
    child.once('error', (e) => finish(null, null, e));
    child.once('close', (code, signal) => finish(code, signal));
    return { id };
  }

  #append(run: Run, text: string) {
    const t = redact(maskSecrets(ansi(text)));
    run.output += t;
    if (run.output.length > this.#d.maxOutputChars) {
      const drop = run.output.length - this.#d.maxOutputChars;
      run.output = run.output.slice(drop);
      run.outputOffset += drop;
    }
    try {
      fs.appendFileSync(path.join(run.dir, 'output.log'), t);
    } catch {
      /* ignore */
    }
  }

  #kill(run: Run, force: boolean) {
    const pid = run.child?.pid;
    if (!pid || run.child?.exitCode !== null) return;
    void this.#d.inspector.kill(pid, { force, tree: true }).catch(() => {});
    if (!force) {
      setTimeout(() => {
        if (run.child && run.child.exitCode === null) void this.#d.inspector.kill(pid, { force: true, tree: true }).catch(() => {});
      }, 5_000).unref();
    }
  }

  #finish(run: Run, code: number | null, signal: NodeJS.Signals | null, startedAt: string, jsonFile: string, spawnError?: Error): MwRunResult {
    let report: ReturnType<typeof parseReport> | null = null;
    try {
      report = parseReport(JSON.parse(fs.readFileSync(jsonFile, 'utf8')) as PwReport);
    } catch {
      report = null;
    }
    const failed = (report?.failed ?? []).map((f) => ({ test: f.title, message: redact(maskSecrets(f.message.slice(0, 500))), step: failedStepTs(run.files, f.stack), details: redact(maskSecrets(f.stack.slice(-4000))) }));
    let status: RunStatus;
    let category: MwRunResult['category'] = null;
    let summary: string;
    // A file that fails to load also ends with "No tests found"; only an otherwise clean run counts as empty.
    const loadErrors = (report?.errors ?? []).filter((e) => !/^error: no tests found/i.test(e) && !/^no tests found/i.test(e));
    const noTests = report ? report.total === 0 && !loadErrors.length && report.errors.some((e) => /no tests found/i.test(e)) : /no tests found/i.test(run.output);
    if (spawnError) {
      status = 'error';
      category = 'usage';
      summary = `MobileWright could not be started: ${spawnError.message}`;
    } else if (run.cancelRequested) {
      status = 'cancelled';
      summary = 'Cancelled by the user.';
    } else if (run.timedOut) {
      status = 'timeout';
      summary = 'Stopped because it exceeded the run timeout.';
    } else if (noTests) {
      status = 'no-tests';
      summary = 'MobileWright found no tests in the selected files.';
    } else if (!report) {
      status = 'error';
      category = 'runner';
      summary = `MobileWright exited with code ${code ?? 'none'}${signal ? ` (signal ${signal})` : ''} and wrote no results. See the output.`;
    } else if (report.total === 0 && loadErrors.length) {
      status = 'error';
      category = 'import-or-syntax';
      summary = `The test could not be loaded: ${loadErrors[0].split('\n')[0].slice(0, 300)}`;
    } else if (code === 0 && report.passed > 0 && report.failedCount === 0) {
      status = 'passed';
      summary = `${report.passed} passed${report.skipped ? `, ${report.skipped} skipped` : ''}.`;
    } else if (report.failedCount > 0) {
      status = 'failed';
      category = 'automation';
      summary = `${report.failedCount} of ${report.total} test(s) failed.`;
    } else {
      status = 'error';
      category = 'runner';
      summary = `MobileWright exited with code ${code ?? 'none'}; ${report.passed} passed, ${report.failedCount} failed${report.errors.length ? `; ${report.errors[0].split('\n')[0]}` : ''}.`;
    }
    for (const f of failed) (f as MwRunResult['failed'][number]).diagnosis = diagnoseFailure({ message: f.message, details: f.details, category, status });
    const endedAt = new Date().toISOString();
    const artifacts: MwRunResult['artifacts'] = [];
    // screenshot checkpoints attached by the test (test.info().attach) are saved next to the report
    for (const a of report?.attachments ?? []) {
      if (!/^checkpoint-[\w.-]+$/.test(a.name) || a.contentType !== 'image/png') continue;
      try {
        const data = a.body ? Buffer.from(a.body, 'base64') : a.path ? fs.readFileSync(a.path) : null;
        if (data) {
          fs.writeFileSync(path.join(run.dir, `${a.name}.png`), data);
          artifacts.push({ type: 'checkpoint', file: `${a.name}.png` });
        }
      } catch {
        /* attachment not readable */
      }
    }
    const out = path.join(run.dir, 'test-results');
    const walk = (d: string) => {
      for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.png$/i.test(e.name)) artifacts.push({ type: 'screenshot', file: path.relative(run.dir, p).split(path.sep).join('/') });
      }
    };
    walk(out);
    return {
      status, category, summary, exitCode: code, signal: signal ?? null,
      tests: report ? { total: report.total, passed: report.passed, failed: report.failedCount, skipped: report.skipped } : null,
      failed, artifacts, cleanup: [], simulated: run.simulated, startedAt, endedAt, durationMs: Date.parse(endedAt) - Date.parse(startedAt),
    };
  }

  has(id: string) {
    return this.#runs.has(id);
  }

  cancel(id: string) {
    const run = this.#runs.get(id);
    if (!run) throw new RunError('NO_RUN', 404, 'No such run.');
    if (run.result) return { status: run.status };
    run.cancelRequested = true;
    this.#append(run, '\n[vortex] cancel requested: stopping MobileWright\n');
    this.#kill(run, false);
    return { status: 'cancelling' };
  }

  get(id: string, from = 0) {
    const run = this.#runs.get(id);
    if (!run) throw new RunError('NO_RUN', 404, 'No such run (runs from earlier recorder sessions are in the history list).');
    const start = Math.max(0, from - run.outputOffset);
    return { id: run.id, engine: 'mobilewright' as const, file: run.files[0], files: run.files, label: run.label, status: run.status, output: run.output.slice(start), next: run.outputOffset + run.output.length, result: run.result, dir: run.dir };
  }

  wait(id: string): Promise<MwRunResult> {
    const run = this.#runs.get(id);
    if (!run) throw new RunError('NO_RUN', 404, 'No such run.');
    return run.done;
  }

  active() {
    return [...this.#runs.values()].filter((r) => !r.result).map((r) => ({ id: r.id, engine: 'mobilewright' as const, label: r.label, status: r.status }));
  }

  history(limit = 30) {
    return this.#d.index
      .list(limit * 2)
      .filter((e) => e.engine === 'mobilewright')
      .slice(0, limit)
      .map((e) => ({ id: e.id, engine: 'mobilewright' as const, file: e.label, status: e.status, summary: e.summary, startedAt: e.startedAt, durationMs: e.durationMs, dir: e.dir }));
  }
}
