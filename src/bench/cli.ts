// npm run bench -- --module <module> --case <case> [--frameworks mobilewright] [--runs 5] [--warmup 1]
//                  [--no-probes] [--no-reset] [--url http://localhost:4700] [--html <file>]
//
// Runs a benchmark through the running recorder (same phone, same project) and prints medians.

import fs from 'node:fs';
import { METRICS, PROBES, type BenchRecord } from './benchmark.ts';

const args = process.argv.slice(2);
const opt = (k: string, d?: string) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : d;
};
const has = (k: string) => args.includes(`--${k}`);
if (has('help') || !opt('module') || !opt('case')) {
  console.log('usage: npm run bench -- --module <module> --case <case> [--frameworks mobilewright] [--runs 5] [--warmup 1] [--no-probes] [--no-reset] [--url http://localhost:4700] [--html report.html]');
  process.exit(has('help') ? 0 : 2);
}
const base = (opt('url', `http://localhost:${process.env.PORT || 4700}`) as string).replace(/\/+$/, '');
if (!/^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d+$/.test(base)) {
  console.error('--url must be the local recorder, for example http://localhost:4700');
  process.exit(2);
}
async function api(p: string, body?: unknown) {
  const r = await fetch(base + p, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) throw new Error(String(j.error ?? `HTTP ${r.status}`));
  return j;
}

let started: { id: string };
try {
  started = (await api('/api/bench', {
    module: opt('module'), case: opt('case'),
    frameworks: (opt('frameworks', 'mobilewright') as string).split(',').map((s) => s.trim()),
    iterations: Number(opt('runs', '5')), warmup: Number(opt('warmup', '1')),
    probes: !has('no-probes'), resetApp: !has('no-reset'),
  })) as { id: string };
} catch (e) {
  console.error(`Benchmark not started: ${(e as Error).message}\n(Is the recorder running at ${base}?)`);
  process.exit(1);
}
process.on('SIGINT', () => {
  void api(`/api/bench/${started.id}/cancel`, {}).finally(() => process.exit(130));
});
let r: BenchRecord;
let last = '';
for (;;) {
  r = (await api(`/api/bench/${started.id}`)) as unknown as BenchRecord;
  const line = `[${r.progress.done}/${r.progress.total}] ${r.progress.current}`;
  if (line !== last) console.log((last = line));
  if (r.status !== 'running') break;
  await new Promise((x) => setTimeout(x, 500));
}
const ms = (v: number | null) => (v === null ? '-' : `${v} ms`);
console.log(`\nBenchmark ${r.id}: ${r.status}${r.error ? ` (${r.error})` : ''}`);
for (const n of r.notes) console.log(`! ${n}`);
for (const [fw, res] of Object.entries(r.results)) {
  console.log(`\n${fw}            runs   median        min        max   variation`);
  for (const [k, name] of Object.entries(METRICS)) {
    const s = res.metrics[k];
    if (s?.n) console.log(`  ${name.padEnd(46).slice(0, 46)} ${String(s.n).padStart(3)} ${ms(s.median).padStart(10)} ${ms(s.min).padStart(10)} ${ms(s.max).padStart(10)} ${s.cvPct === null ? '-' : s.cvPct + ' %'}`);
  }
}
if (Object.keys(r.probeSummary).length) {
  console.log('\nDevice discovery');
  for (const [k, name] of Object.entries(PROBES)) {
    const s = r.probeSummary[k];
    if (s?.n) console.log(`  ${name.padEnd(46).slice(0, 46)} ${String(s.n).padStart(3)} ${ms(s.median).padStart(10)} ${ms(s.min).padStart(10)} ${ms(s.max).padStart(10)} ${s.cvPct === null ? '-' : s.cvPct + ' %'}`);
  }
  for (const n of r.probeNotes) console.log(`  (${n})`);
}
for (const c of r.comparisons) console.log(`\n${METRICS[c.metric]}: ${c.comparison.explanation}`);
const html = opt('html');
if (html) {
  const t = await fetch(`${base}/api/bench/${r.id}/export.html`).then((x) => x.text());
  fs.writeFileSync(html, t);
  console.log(`\nHTML report: ${html}`);
}
process.exit(r.status === 'done' ? 0 : 1);
