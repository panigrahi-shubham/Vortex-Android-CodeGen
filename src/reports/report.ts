// Execution reports: one record per run (both engines), built from the files the run left in its report folder, and
// exported as JSON or as one self-contained HTML file. Everything text-like goes through secret masking first.

import fs from 'node:fs';
import path from 'node:path';
import { redact } from '../runtime/log-file.ts';
import { maskSecrets } from './secrets.ts';

export interface RunMeta {
  id: string;
  engine: 'appium' | 'mobilewright';
  label: string;
  files: string[];
  appPackage: string | null;
  device: { serial: string; model: string | null; androidVersion: string | null; sdk: number | null; simulated: boolean } | null;
  buildType: 'debug' | 'release' | 'unknown';
  appVersion: string | null;
  retry: { attempt: number; of: number; previous: string | null } | null;
}

export interface Report {
  id: string;
  dir: string;
  meta: RunMeta | null;
  result: Record<string, unknown> & {
    status: string;
    summary: string;
    startedAt: string;
    endedAt?: string;
    durationMs: number;
    tests?: Record<string, number> | null;
    failed?: { test: string; message: string; step: string | null; details: string; diagnosis?: { kind: string; title: string; hint: string; expected?: string; actual?: string } }[];
    artifacts?: { type: string; file?: string; test?: string }[];
    sessionStartupMs?: number | null;
    exitCode?: number | null;
    category?: string | null;
  };
  files: string[];
  log: string;
}

const safeText = (s: string) => redact(maskSecrets(s));

export function writeMeta(dir: string, meta: RunMeta) {
  try {
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
  } catch {
    /* report folder may be gone */
  }
}

export function loadReport(dir: string): Report | null {
  let result: Report['result'];
  try {
    // masked before parsing, so every consumer (UI, exports) only ever sees masked values
    result = JSON.parse(safeText(fs.readFileSync(path.join(dir, 'result.json'), 'utf8')));
  } catch {
    return null;
  }
  let meta: RunMeta | null = null;
  try {
    meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  } catch {
    meta = null;
  }
  let log = '';
  try {
    const all = fs.readFileSync(path.join(dir, 'output.log'), 'utf8');
    log = all.length > 60_000 ? '... (start of log omitted)\n' + all.slice(-60_000) : all;
  } catch {
    log = '';
  }
  const files: string[] = [];
  const walk = (d: string, rel = '') => {
    for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) {
      if (e.isDirectory()) walk(path.join(d, e.name), rel + e.name + '/');
      else files.push(rel + e.name);
    }
  };
  walk(dir);
  return { id: String(result.id ?? path.basename(dir)), dir, meta, result, files, log: safeText(log) };
}

/** Files of a report that may be served or embedded (no path tricks, known kinds only). */
export function reportFile(dir: string, name: string): string | null {
  if (!/^[\w./-]+$/.test(name) || name.split('/').includes('..')) return null;
  if (!/\.(png|xml|html|json|log|txt)$/.test(name)) return null;
  const f = path.resolve(dir, name);
  return f.startsWith(path.resolve(dir) + path.sep) && fs.existsSync(f) ? f : null;
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const ms = (v: unknown) => (typeof v === 'number' ? (v >= 60_000 ? `${Math.floor(v / 60_000)} min ${Math.round((v % 60_000) / 1000)} s` : v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${v} ms`) : 'not measured');

/** One self-contained HTML page (screenshots embedded, text masked). */
export function renderHtml(r: Report): string {
  const res = r.result;
  const m = r.meta;
  const t = (res.tests ?? {}) as Record<string, number>;
  const counts = res.tests ? `${t.passed ?? (t.total ?? 0) - (t.failures ?? 0) - (t.errors ?? 0) - (t.skipped ?? 0)} passed, ${t.failed ?? (t.failures ?? 0) + (t.errors ?? 0)} failed, ${t.skipped ?? 0} skipped (of ${t.total ?? '?'})` : 'no test results';
  const rows: [string, string][] = [
    ['Test', m?.label ?? String(res.label ?? res.file ?? r.id)],
    ['Framework', m?.engine === 'mobilewright' || res.engine === 'mobilewright' ? 'MobileWright (TypeScript)' : 'Legacy run'],
    ['Result', `${res.status}${res.category ? ` (${res.category})` : ''}: ${res.summary}`],
    ['Tests', counts],
    ['Device', m?.device ? `${m.device.model ?? 'unknown model'} (${m.device.serial}), Android ${m.device.androidVersion ?? '?'}${m.device.sdk ? ` / API ${m.device.sdk}` : ''}${m.device.simulated ? ' — simulated' : ''}` : 'not recorded'],
    ['App', m ? `${m.appPackage ?? '?'}${m.appVersion ? ` ${m.appVersion}` : ''}, ${m.buildType} build` : 'not recorded'],
    ['Started / ended', `${res.startedAt} / ${res.endedAt ?? ''}`],
    ['Duration', ms(res.durationMs)],
    ['Session startup', ms(res.sessionStartupMs ?? null)],
    ['Exit code', String(res.exitCode ?? '')],
    ['Retry', m?.retry ? `attempt ${m.retry.attempt} of ${m.retry.of}${m.retry.previous ? ` (after ${m.retry.previous})` : ''}` : 'none requested'],
  ];
  const img = (f: string) => {
    const p = reportFile(r.dir, f);
    return p ? `<img alt="${esc(f)}" src="data:image/png;base64,${fs.readFileSync(p).toString('base64')}">` : '';
  };
  const textFile = (f: string, max = 200_000) => {
    const p = reportFile(r.dir, f);
    if (!p) return '';
    const s = fs.readFileSync(p, 'utf8');
    return esc(safeText(s.length > max ? s.slice(0, max) + '\n... (truncated)' : s));
  };
  const arts = res.artifacts ?? [];
  const failed = (res.failed ?? []).map((f) => `<div class="fail"><b>${esc(f.test)}</b>${f.step ? ` · failed at step <b>${esc(f.step)}</b>` : ''}<div class="msg">${esc(safeText(f.message))}</div>` +
    (f.diagnosis ? `<div class="diag"><b>${esc(f.diagnosis.title)}</b>${f.diagnosis.expected !== undefined ? `<br>expected: <code>${esc(f.diagnosis.expected)}</code> · actual: <code>${esc(f.diagnosis.actual)}</code>` : ''}<br>${esc(f.diagnosis.hint)}</div>` : '') +
    `<details><summary>Error details</summary><pre>${esc(safeText(f.details))}</pre></details></div>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Vortex run ${esc(r.id)}</title>
<style>body{font:14px/1.45 system-ui,Segoe UI,sans-serif;margin:0;padding:20px;color:#1c2430;background:#f6f7fb}h1{font-size:20px;margin:0 0 4px}.st{font-weight:700;text-transform:uppercase}.passed{color:#1f7a3a}.failed,.error,.timeout,.interrupted{color:#b42318}.no-tests,.cancelled{color:#a15c07}
table{border-collapse:collapse;background:#fff;margin:12px 0;width:100%;max-width:960px}td{border-bottom:1px solid #e5e8ef;padding:6px 10px;vertical-align:top}td:first-child{color:#5b6476;width:170px}
.fail{background:#fff;border:1px solid #f1c3c0;border-radius:8px;padding:10px;margin:10px 0;max-width:960px}.msg{color:#b42318;margin:4px 0}.diag{background:#fff8e6;border-radius:6px;padding:8px;margin:6px 0}
pre{white-space:pre-wrap;word-break:break-all;background:#0f1420;color:#d7e3ff;padding:10px;border-radius:8px;max-height:480px;overflow:auto;font-size:12px}img{max-height:520px;border:1px solid #d5d9e2;border-radius:6px;margin:6px 8px 0 0}code{background:#eef1f6;padding:0 4px;border-radius:4px}.mut{color:#5b6476}</style></head><body>
<h1>${esc(rows[0][1])} <span class="st ${esc(res.status)}">${esc(res.status)}</span></h1><div class="mut">Vortex Android Recorder run ${esc(r.id)} · exported ${esc(new Date().toISOString())} · secrets masked</div>
<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>
${failed}
${arts.filter((a) => a.type === 'screenshot' && a.file).length ? `<h2>Screenshots at failure</h2>${arts.filter((a) => a.type === 'screenshot').map((a) => img(a.file!)).join('')}` : ''}
${arts.filter((a) => a.type === 'checkpoint' && a.file).length ? `<h2>Checkpoints</h2>${arts.filter((a) => a.type === 'checkpoint').map((a) => `<figure style="display:inline-block;margin:0">${img(a.file!)}<figcaption class="mut">${esc(a.file)}</figcaption></figure>`).join('')}` : ''}
${arts.filter((a) => a.type === 'page-source' && a.file).map((a) => `<details><summary>Native hierarchy at failure (${esc(a.file)})</summary><pre>${textFile(a.file!)}</pre></details>`).join('')}
${arts.filter((a) => a.type === 'dom' && a.file).map((a) => `<details><summary>WebView DOM at failure (${esc(a.file)})</summary><pre>${textFile(a.file!)}</pre></details>`).join('')}
<details${res.status === 'passed' ? '' : ' open'}><summary>Log</summary><pre>${esc(r.log)}</pre></details>
</body></html>`;
}

/** Machine-readable export: the run record plus meta, with text masked. */
export function renderJson(r: Report): string {
  return safeText(JSON.stringify({ schema: 'vortex.report', version: 1, id: r.id, meta: r.meta, result: r.result, files: r.files }, null, 2));
}
