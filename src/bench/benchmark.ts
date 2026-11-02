// Performance analyzer: runs one saved MobileWright case repeatedly with the same steps and checks,
// measures every phase it can see, and reports medians and variation. Timings come only from real runs; a phase that
// cannot be measured is reported as such, with the reason.
//
// What is measured, and how:
//  - end to end: the runner's wall time for the test process (start to exit);
//  - steps, actions, assertion waits, WebView switches: timing marks in an instrumented COPY of the generated Plain test
//    (the copy differs from the saved file only by the mark lines, which is verified before running);
//  - app launch preamble (MobileWright): from the test's first line to its first step (the generated test launches the app);
//  - device discovery: adb enumeration, separately from test execution.

import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { DeviceLeases } from '../devices/device-lease.ts';
import type { MobilewrightRunner } from '../engines/mobilewright/runner.ts';
import type { RecordedEvent, Recording } from '../model/recording.ts';
import { listProject, readCaseRecording, type CaseRef } from '../project/project.ts';
import { instrumentTs, segments, type Segment } from './instrument.ts';
import { summarize, type Comparison, type Summary } from './stats.ts';

export type BenchFramework = 'mobilewright';

export interface BenchConfig {
  ref: CaseRef;
  frameworks: BenchFramework[];
  iterations: number;
  warmup: number;
  probes: boolean;
  coldStart: boolean;
  resetApp: boolean;
  timeoutMs: number;
}

export interface BenchDeps {
  outDir: () => string;
  stateDir: string;
  serial: () => string | null;
  pkg: () => string;
  simulated: boolean;
  mwRunner: MobilewrightRunner;
  leases: DeviceLeases;
  meta: (serial: string, pkg: string) => Promise<{ device: unknown; buildType: string; appVersion: string | null } | null>;
  /** Identity evidence for Mobilecli emulator aliases; exact physical serials need no alias. */
  deviceIdentity?: (serial: string) => Promise<{ deviceModel?: string | null; androidVersion?: string | null; deviceType?: string | null }>;
  /** Brings the app to its start state (outside timing). */
  resetApp: (serial: string, pkg: string) => Promise<void>;
  /** adb device discovery time, or null with a reason. */
  deviceDiscovery: () => Promise<{ ms: number | null; reason?: string }>;
  log: (m: string) => void;
}

export interface RunSample {
  framework: BenchFramework;
  iteration: number;
  warmup: boolean;
  status: string;
  summary: string;
  endToEndMs: number;
  sessionMs: number | null;
  cleanupMs: number | null;
  segments: Segment[];
  complete: boolean;
}

export interface BenchRecord {
  schema: 'vortex.benchmark';
  version: 1;
  id: string;
  status: 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';
  error: string | null;
  config: BenchConfig;
  case: { module: string; case: string; name: string; steps: { n: number; type: string; title: string; kind: 'action' | 'assertion' | 'other' }[]; assertions: number };
  environment: { device: unknown; appPackage: string; buildType: string; appVersion: string | null; simulated: boolean; host: string };
  startedAt: string;
  endedAt: string | null;
  progress: { done: number; total: number; current: string };
  samples: RunSample[];
  probes: Record<string, number[]>;
  probeNotes: string[];
  results: Record<string, { metrics: Record<string, Summary>; perStep: { n: number; title: string; kind: string; summary: Summary }[]; failures: number }>;
  probeSummary: Record<string, Summary>;
  comparisons: { metric: string; comparison: Comparison }[];
  notes: string[];
}

export class BenchError extends Error {
  code: string;
  httpStatus: number;
  constructor(code: string, httpStatus: number, message: string) {
    super(message);
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

const ASSERTION_TYPES = new Set(['assert', 'wait_visible', 'wait_hidden', 'wait_enabled', 'check_activity']);
const kindOf = (t: string): 'action' | 'assertion' | 'other' => (ASSERTION_TYPES.has(t) ? 'assertion' : t === 'checkpoint' || t === 'sleep' ? 'other' : 'action');

export const METRICS: Record<string, string> = {
  endToEnd: 'End to end (test process)',
  steps: 'Recorded steps (first step to last)',
  actions: 'Action steps (with their pre/post checks)',
  assertions: 'Check and wait steps',
  webview: 'WebView switch / page attach',
  preamble: 'Test preamble (app launch in MobileWright tests)',
  session: 'Session creation (driver fixture)',
  cleanup: 'Session cleanup (teardown)',
};
export const PROBES: Record<string, string> = { deviceDiscovery: 'Device discovery (adb)' };

export class BenchmarkRunner {
  #starting = false;
  #d: BenchDeps;
  #active: { id: string; cancel: boolean; runId: string | null; fw: BenchFramework | null } | null = null;
  #records = new Map<string, BenchRecord>();
  constructor(d: BenchDeps) {
    this.#d = d;
  }

  get dir() {
    return path.join(this.#d.stateDir, 'benchmarks');
  }

  #save(r: BenchRecord) {
    const dir = path.join(this.dir, r.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'benchmark.json'), JSON.stringify(r, null, 2));
    if (r.status !== 'running') fs.writeFileSync(path.join(dir, 'benchmark.html'), renderBenchHtml(r));
  }

  list(): { id: string; status: string; case: string; frameworks: BenchFramework[]; iterations: number; startedAt: string; buildType: string; simulated: boolean }[] {
    let ids: string[] = [];
    try {
      ids = fs.readdirSync(this.dir).filter((x) => /^[\w-]+$/.test(x)).sort().reverse().slice(0, 100);
    } catch {
      ids = [];
    }
    return ids.flatMap((id) => {
      const r = this.get(id);
      return r ? [{ id, status: r.status, case: `${r.case.module}/${r.case.case}`, frameworks: r.config.frameworks, iterations: r.config.iterations, startedAt: r.startedAt, buildType: r.environment.buildType, simulated: r.environment.simulated }] : [];
    });
  }

  get(id: string): BenchRecord | null {
    if (!/^[\w-]+$/.test(id)) return null;
    const live = this.#records.get(id);
    if (live) return live;
    try {
      const r = JSON.parse(fs.readFileSync(path.join(this.dir, id, 'benchmark.json'), 'utf8')) as BenchRecord;
      // written while running, but no longer running in this process: the recorder stopped during it
      if (r.status === 'running') r.status = 'interrupted';
      return r;
    } catch {
      return null;
    }
  }

  active() {
    return this.#active ? this.#active.id : null;
  }

  cancel(id: string) {
    if (!this.#active || this.#active.id !== id) throw new BenchError('NOT_RUNNING', 409, 'This benchmark is not running.');
    this.#active.cancel = true;
    const a = this.#active;
    if (a.runId && a.fw) {
      try {
        this.#d.mwRunner.cancel(a.runId);
      } catch {
        /* already finished */
      }
    }
    return { cancelling: true };
  }

  /** Validates, prepares the instrumented copies and starts the benchmark in the background. */
  async start(input: Partial<BenchConfig> & { ref: CaseRef }): Promise<{ id: string }> {
    if (this.#starting) throw new BenchError('BUSY', 409, 'A benchmark is starting. Wait for it or cancel it.');
    this.#starting = true;
    try { return await this.#start(input); } finally { this.#starting = false; }
  }

  async #start(input: Partial<BenchConfig> & { ref: CaseRef }): Promise<{ id: string }> {
    if (this.#active) throw new BenchError('BUSY', 409, 'A benchmark is already running. Wait for it or cancel it.');
    const requested = input.frameworks ?? ['mobilewright'];
    if (!Array.isArray(requested) || !requested.length || requested.some(f => f !== 'mobilewright')) throw new BenchError('BAD_INPUT', 400, 'Only MobileWright benchmarks are supported.');
    const frameworks: BenchFramework[] = ['mobilewright'];
    const cfg: BenchConfig = {
      ref: input.ref,
      frameworks,
      iterations: Math.max(1, Math.min(30, Math.floor(Number(input.iterations) || 5))),
      warmup: Math.max(0, Math.min(3, Math.floor(input.warmup === undefined ? 1 : Number(input.warmup) || 0))),
      probes: input.probes !== false,
      coldStart: false,
      resetApp: input.resetApp !== false,
      timeoutMs: Math.max(30_000, Math.min(3_600_000, Number(input.timeoutMs) || 600_000)),
    };
    const serial = this.#d.serial();
    if (!serial) throw new BenchError('NO_DEVICE', 409, 'No device is selected. Connect the phone and refresh the screen first.');
    this.#d.leases.assertFree(serial);
    const outDir = this.#d.outDir();
    const rec: Recording = readCaseRecording(outDir, cfg.ref).recording;
    const info = listProject(outDir).modules.find((m) => m.module === cfg.ref.module)?.cases.find((c) => c.case === cfg.ref.case);
    if (!info) throw new BenchError('NOT_SAVED', 404, `No saved case ${cfg.ref.module}/${cfg.ref.case}.`);
    const plain: Record<string, string> = {};
    for (const fw of frameworks) {
      const e = info.entries.find((x) => x.framework === fw && x.variant === 'plain' && x.exists);
      if (!e) throw new BenchError('NO_PLAIN', 409, `${cfg.ref.module}/${cfg.ref.case} has no saved Plain MobileWright test. Benchmarks use the Plain test so both frameworks run the same steps: save the case in Plain or Both mode with that framework.`);
      plain[fw] = path.join(outDir, cfg.ref.module, cfg.ref.case, e.path);
    }
    const id = `${new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '')}-${randomUUID().slice(0, 6)}`;
    const benchDir = path.join(this.dir, id);
    fs.mkdirSync(path.join(benchDir, 'runs'), { recursive: true });
    // Copies live under the output folder so MobileWright resolves @mobilewright/test from the project; removed at the end.
    const copyDir = path.join(outDir, '.vortex-bench', id);
    // copies left behind by a benchmark the recorder could not finish (only Vortex writes into .vortex-bench)
    try {
      for (const old of fs.readdirSync(path.dirname(copyDir))) if (/^[\w-]+$/.test(old)) fs.rmSync(path.join(path.dirname(copyDir), old), { recursive: true, force: true });
    } catch {
      /* none */
    }
    fs.mkdirSync(copyDir, { recursive: true });
    const marks = path.join(benchDir, 'marks.jsonl');
    const copies: Record<string, string> = {};
    for (const fw of frameworks) {
      const src = fs.readFileSync(plain[fw], 'utf8');
      const ins = instrumentTs(src, marks);
      if (ins.steps.length !== rec.events.length) {
        fs.rmSync(copyDir, { recursive: true, force: true });
        throw new BenchError('STEPS_MISMATCH', 409, `The saved ${fw} test has ${ins.steps.length} step markers but the recording has ${rec.events.length} steps (the file was probably edited). Save the case again before benchmarking.`);
      }
      const f = path.join(copyDir, `${cfg.ref.case}.bench.test.ts`);
      fs.writeFileSync(f, ins.content);
      copies[fw] = path.relative(outDir, f);
    }
    const m = await this.#d.meta(serial, this.#d.pkg()).catch(() => null);
    const record: BenchRecord = {
      schema: 'vortex.benchmark', version: 1, id, status: 'running', error: null, config: cfg,
      case: {
        module: cfg.ref.module, case: cfg.ref.case, name: rec.name,
        steps: rec.events.map((e, i) => ({ n: i + 1, type: e.action.type, title: e.title, kind: kindOf(e.action.type) })),
        assertions: rec.events.filter((e) => e.action.type === 'assert').length + rec.events.reduce((a, e) => a + (e.post?.length ?? 0), 0),
      },
      environment: { device: m?.device ?? null, appPackage: this.#d.pkg(), buildType: m?.buildType ?? 'unknown', appVersion: m?.appVersion ?? null, simulated: this.#d.simulated, host: `${process.platform} ${process.arch}, Node ${process.version}` },
      startedAt: new Date().toISOString(), endedAt: null,
      progress: { done: 0, total: (cfg.warmup + cfg.iterations) * frameworks.length, current: 'starting' },
      samples: [], probes: {}, probeNotes: [], results: {}, probeSummary: {}, comparisons: [], notes: [],
    };
    this.#records.set(id, record);
    this.#active = { id, cancel: false, runId: null, fw: null };
    this.#save(record);
    void this.#run(record, { serial, outDir, copies, copyDir, marks, benchDir, events: rec.events })
      .catch((e) => {
        record.status = 'failed';
        record.error = (e as Error).message;
      })
      .finally(() => {
        record.endedAt = new Date().toISOString();
        if (this.#active?.cancel && record.status === 'running') record.status = 'cancelled';
        if (record.status === 'running') record.status = 'done';
        this.#finish(record);
        this.#save(record);
        this.#records.delete(id);
        this.#active = null;
        fs.rmSync(copyDir, { recursive: true, force: true });
        try {
          if (!fs.readdirSync(path.dirname(copyDir)).length) fs.rmdirSync(path.dirname(copyDir));
        } catch {
          /* keep */
        }
        this.#d.log(`benchmark ${id} ${record.status}`);
      });
    return { id };
  }

  async #run(r: BenchRecord, x: { serial: string; outDir: string; copies: Record<string, string>; copyDir: string; marks: string; benchDir: string; events: RecordedEvent[] }) {
    const cfg = r.config;
    const pkg = r.environment.appPackage;
    const identity = await this.#d.deviceIdentity?.(x.serial) ?? {};
    const order = (i: number) => (i % 2 ? [...cfg.frameworks].reverse() : cfg.frameworks);
    for (let i = 0; i < cfg.warmup + cfg.iterations; i++) {
      if (this.#active?.cancel) break;
      const warm = i < cfg.warmup;
      if (cfg.probes && !warm) {
        const d = await this.#d.deviceDiscovery();
        if (d.ms !== null) (r.probes.deviceDiscovery ??= []).push(d.ms);
        else if (d.reason && !r.probeNotes.includes(d.reason)) r.probeNotes.push(d.reason);
      }
      for (const fw of order(i)) {
        if (this.#active?.cancel) break;
        r.progress.current = `MobileWright ${warm ? 'warm-up' : `run ${i - cfg.warmup + 1}/${cfg.iterations}`}`;
        if (cfg.resetApp) await this.#d.resetApp(x.serial, pkg).catch((e) => r.notes.push(`app reset failed before ${fw} run ${i + 1}: ${(e as Error).message}`));
        fs.rmSync(x.marks, { force: true });
        const runner = this.#d.mwRunner;
        const label = `benchmark ${r.id} ${fw} ${warm ? 'warm-up' : '#' + (i - cfg.warmup + 1)}`;
        const started = await this.#d.mwRunner.start({ testsDir: x.outDir, files: [x.copies[fw]], serial: x.serial, ...identity, timeoutMs: cfg.timeoutMs, reportDir: path.join(x.copyDir, 'runs'), label, record: false });
        this.#active!.runId = started.id;
        this.#active!.fw = fw;
        const res = await runner.wait(started.id);
        this.#active!.runId = null;
        // Run folders start inside the project (MobileWright resolves its packages from the per-run config file's folder)
        // and are moved to the benchmark folder afterwards.
        const runDir = runner.get(started.id).dir;
        const dir = path.join(x.benchDir, 'runs', path.basename(runDir));
        try {
          fs.cpSync(runDir, dir, { recursive: true });
          fs.rmSync(runDir, { recursive: true, force: true });
        } catch (e) {
          r.notes.push(`could not move run folder ${runDir}: ${(e as Error).message}`);
        }
        let marksText = '';
        try {
          marksText = fs.readFileSync(x.marks, 'utf8');
          fs.renameSync(x.marks, path.join(dir, 'marks.jsonl'));
        } catch {
          marksText = '';
        }
        const seg = segments(marksText);
        let cleanupMs: number | null = null;
        r.samples.push({ framework: fw, iteration: i, warmup: warm, status: res.status, summary: res.summary, endToEndMs: res.durationMs, sessionMs: (res as { sessionStartupMs?: number | null }).sessionStartupMs ?? null, cleanupMs, segments: seg.segments, complete: seg.complete });
        r.progress.done++;
        this.#save(r);
      }
    }
  }

  #finish(r: BenchRecord) {
    const kinds = new Map(r.case.steps.map((s) => [String(s.n), s]));
    for (const fw of r.config.frameworks) {
      const runs = r.samples.filter((s) => s.framework === fw && !s.warmup);
      const ok = runs.filter((s) => s.status === 'passed' && s.complete);
      const sum = (s: RunSample, pred: (g: Segment) => boolean) => s.segments.filter(pred).reduce((a, g) => a + g.ms, 0);
      const numeric = (g: Segment) => /^\d+$/.test(g.label) || g.label === 'webview';
      const metrics: Record<string, Summary> = {
        endToEnd: summarize(ok.map((s) => s.endToEndMs)),
        steps: summarize(ok.map((s) => sum(s, numeric))),
        actions: summarize(ok.map((s) => sum(s, (g) => kinds.get(g.label)?.kind === 'action'))),
        // checks accepted after an action run inside that action's step; this row covers check/wait steps only
        assertions: summarize(r.case.steps.some((x) => x.kind === 'assertion') ? ok.map((s) => sum(s, (g) => kinds.get(g.label)?.kind === 'assertion')) : []),
        webview: summarize(ok.some((s) => s.segments.some((g) => g.label === 'webview')) ? ok.map((s) => sum(s, (g) => g.label === 'webview')) : []),
        preamble: summarize(fw === 'mobilewright' ? ok.map((s) => sum(s, (g) => g.label === 'start')) : []),
        session: summarize(ok.map((s) => s.sessionMs)),
        cleanup: summarize(ok.map((s) => s.cleanupMs)),
      };
      const perStep = r.case.steps.map((st) => ({ n: st.n, title: `${st.n}. ${st.title || st.type}`, kind: st.kind, summary: summarize(ok.map((s) => s.segments.find((g) => g.label === String(st.n))?.ms ?? null)) }));
      r.results[fw] = { metrics, perStep, failures: runs.length - ok.length };
      if (runs.length - ok.length) r.notes.push(`${fw}: ${runs.length - ok.length} of ${runs.length} measured run(s) did not pass and are excluded from the statistics (see the run folders).`);
    }
    for (const k of Object.keys(PROBES)) if (r.probes[k]?.length) r.probeSummary[k] = summarize(r.probes[k]);
    if (r.environment.simulated) r.notes.unshift('SIMULATED device: these timings describe the simulator on this computer, not a phone.');
    if (r.config.iterations < 5) r.notes.push('Fewer than 5 runs: collect more samples before drawing performance conclusions.');
  }
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f = (v: number | null) => (v === null ? '–' : v >= 10_000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`);
const row = (name: string, s: Summary | undefined) => s && s.n
  ? `<tr><td>${esc(name)}</td><td class="n">${s.n}</td><td class="n"><b>${f(s.median)}</b></td><td class="n">${f(s.min)}</td><td class="n">${f(s.max)}</td><td class="n">${f(s.stdev)}</td><td class="n">${s.cvPct === null ? '–' : s.cvPct + ' %'}</td></tr>`
  : `<tr class="mut"><td>${esc(name)}</td><td class="n">0</td><td colspan="5">not measured</td></tr>`;
const HEAD = '<tr><th>Phase</th><th>runs</th><th>median</th><th>min</th><th>max</th><th>stdev</th><th>variation</th></tr>';

export function renderBenchHtml(r: BenchRecord): string {
  const env = r.environment as { device: { model?: string; serial?: string; androidVersion?: string; sdk?: number; simulated?: boolean } | null; appPackage: string; buildType: string; appVersion: string | null; simulated: boolean; host: string };
  const d = env.device;
  const fwName = (_x: string) => 'MobileWright';
  const sections = Object.entries(r.results).map(([fw, res]) => `<h2>${fwName(fw)}</h2><table>${HEAD}${Object.entries(METRICS).map(([k, n]) => row(n, res.metrics[k])).join('')}</table>
<details><summary>Per step</summary><table>${HEAD}${res.perStep.map((p) => row(`${p.title} (${p.kind})`, p.summary)).join('')}</table></details>`).join('');
  const probes = Object.keys(r.probeSummary).length || r.probeNotes.length ? `<h2>Device discovery</h2><table>${HEAD}${Object.entries(PROBES).map(([k, n]) => row(n, r.probeSummary[k])).join('')}</table>${r.probeNotes.map((n) => `<p class="mut">${esc(n)}</p>`).join('')}` : '';
  const cmp = r.comparisons.length ? `<h2>Comparison</h2><table><tr><th>Metric</th><th>Verdict</th><th>Why</th></tr>${r.comparisons.map((c) => `<tr><td>${esc(METRICS[c.metric] ?? c.metric)}</td><td><b>${esc({ 'insufficient-data': 'not enough runs', 'no-clear-difference': 'no clear difference', 'a-faster': 'baseline faster', 'b-faster': 'MobileWright faster' }[c.comparison.verdict])}</b></td><td>${esc(c.comparison.explanation)}</td></tr>`).join('')}</table>` : '';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Vortex benchmark ${esc(r.id)}</title>
<style>body{font:14px/1.45 system-ui,Segoe UI,sans-serif;margin:0;padding:20px;color:#1c2430;background:#f6f7fb}h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:18px 0 6px}
table{border-collapse:collapse;background:#fff;margin:6px 0;width:100%;max-width:980px}td,th{border-bottom:1px solid #e5e8ef;padding:5px 9px;text-align:left;vertical-align:top}th{color:#5b6476;font-weight:600}.n{text-align:right;white-space:nowrap}.mut{color:#5b6476}
.warn{background:#fff3cd;border:1px solid #f0d58c;border-radius:8px;padding:8px 10px;max-width:960px;margin:8px 0}</style></head><body>
<h1>Benchmark: ${esc(r.case.name)} <span class="mut">(${esc(r.case.module)}/${esc(r.case.case)})</span></h1>
<div class="mut">Vortex Android Recorder benchmark ${esc(r.id)} · ${esc(r.status)} · ${esc(r.startedAt)} to ${esc(r.endedAt ?? '')}</div>
${r.notes.map((n) => `<div class="warn">${esc(n)}</div>`).join('')}${r.error ? `<div class="warn">Error: ${esc(r.error)}</div>` : ''}
<table><tr><td>Device</td><td>${d ? `${esc(d.model ?? '?')} (${esc(d.serial)}), Android ${esc(d.androidVersion ?? '?')}${d.sdk ? ` / API ${d.sdk}` : ''}` : 'not recorded'}${env.simulated ? ' — <b>simulated</b>' : ''}</td></tr>
<tr><td>App</td><td>${esc(env.appPackage)} ${esc(env.appVersion ?? '')}, <b>${esc(env.buildType)}</b> build</td></tr>
<tr><td>Workflow</td><td>${r.case.steps.length} steps, ${r.case.assertions} recorded checks (check steps and accepted post-checks), identical in every framework (instrumented copy verified against the saved test)</td></tr>
<tr><td>Runs</td><td>${r.config.iterations} measured + ${r.config.warmup} warm-up per framework, alternating order; app ${r.config.resetApp ? 'restarted before each run (not timed)' : 'not restarted between runs'}</td></tr>
<tr><td>Host</td><td>${esc(env.host)}</td></tr></table>
${sections}${probes}${cmp}
<p class="mut">Variation = standard deviation / mean. A framework is called faster only with at least 5 passing runs each, a median difference above 5 % and above twice the larger median absolute deviation, and only for this device and build.</p>
</body></html>`;
}
