/**
 * Feature: performance analyzer — statistics, comparison rules, benchmark instrumentation, report rendering
 * Layer: Unit — node:test
 * Real: statistics, instrumentation of real generated Plain tests (MobileWright, native and WebView flows)
 * Mocked: nothing
 * Guards: a winner named from one run or from noise, an instrumented copy that drops or changes a step or a check,
 *         step timings attributed to the wrong step
 * Run: npm run test:unit
 * Needs: Node.js 22.18+
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { renderBenchHtml, type BenchRecord } from '../../src/bench/benchmark.ts';
import { instrumentTs, segments } from '../../src/bench/instrument.ts';
import { compare, median, summarize } from '../../src/bench/stats.ts';
import { generateMobilewrightPlain } from '../../src/engines/mobilewright/ts-codegen.ts';
import { actionSampleRecording, sampleRecording, webSampleRecording } from '../support/sample-flow.ts';

const SIZE = { width: 1080, height: 2400 };

test('statistics: median, spread and variation; empty and single runs', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  const s = summarize([100, 110, 90, 105, 95, null, Number.NaN]);
  assert.deepEqual([s.n, s.median, s.min, s.max, s.mean], [5, 100, 90, 110, 100]);
  assert.equal(s.stdev, 7.9);
  assert.equal(s.cvPct, 7.9);
  assert.equal(s.mad, 5);
  const one = summarize([42]);
  assert.deepEqual([one.n, one.median, one.stdev, one.cvPct], [1, 42, null, null]);
  assert.equal(summarize([]).median, null);
});

// Risk: the analyzer declares a framework faster from a single run or from run-to-run noise.
test('comparison: no verdict from few runs or overlapping spreads; a verdict only from a clear, repeated difference', () => {
  const a = summarize([100, 102, 98, 101, 99]);
  assert.equal(compare(summarize([100]), summarize([200])).verdict, 'insufficient-data');
  assert.equal(compare(summarize([100, 101, 99, 100]), summarize([300, 301, 299, 300])).verdict, 'insufficient-data');
  assert.equal(compare(a, summarize([103, 104, 102, 103, 104])).verdict, 'no-clear-difference', 'within 5 %');
  assert.equal(compare(summarize([100, 160, 60, 130, 70]), summarize([120, 180, 80, 150, 90])).verdict, 'no-clear-difference', 'noisy');
  const c = compare(a, summarize([150, 152, 148, 151, 149]), ['baseline', 'current']);
  assert.equal(c.verdict, 'a-faster');
  assert.equal(c.diffMs, 50);
  assert.match(c.explanation, /^baseline has the lower median by 50 ms \(50 %\)/);
  assert.equal(compare(summarize([150, 152, 148, 151, 149]), a).verdict, 'b-faster');
});

// Risk: the benchmark runs something other than the saved test (a step or an assertion missing).
test('instrumentation: marks every step in MobileWright, native and WebView, and changes nothing else', () => {
  for (const rec of [sampleRecording(), webSampleRecording({ iframe: false }), actionSampleRecording()]) {
    const ts = generateMobilewrightPlain(rec, { caseSlug: 'c', size: SIZE }).files[0].content;
    const it = instrumentTs(ts, '/tmp/marks.jsonl');
    assert.deepEqual(it.steps, rec.events.map((_, i) => i + 1));
    assert.equal(it.content.split('\n').filter((l) => !/__vortexMark|__vortexAppend/.test(l)).join('\n'), ts);
    assert.equal((it.content.match(/await expect\(/g) ?? []).length, (ts.match(/await expect\(/g) ?? []).length);
  }
  const web = instrumentTs(generateMobilewrightPlain(webSampleRecording({ iframe: false }), { caseSlug: 'c', size: SIZE }).files[0].content, '/m');
  assert.equal(web.webviewBlocks, 1);
  assert.match(web.content, /__vortexMark\('end'\);\n {2}\} finally \{/);
  assert.throws(() => instrumentTs("test('a', async () => {\n});\ntest('b', async () => {\n});\n", '/m'), /found 2/);
});

test('segments: durations between consecutive marks; incomplete runs flagged', () => {
  const s = segments(['{"step":"start","t":0}', '{"step":1,"t":10}', '{"step":"webview","t":35.5}', 'garbage', '{"step":2,"t":40}', '{"step":"end","t":100}'].join('\n'));
  assert.deepEqual(s.segments, [{ label: 'start', ms: 10 }, { label: '1', ms: 25.5 }, { label: 'webview', ms: 4.5 }, { label: '2', ms: 60 }]);
  assert.equal(s.complete, true);
  assert.equal(segments('{"step":"start","t":0}\n{"step":1,"t":5}').complete, false);
});

test('benchmark report: medians, notes, simulated warning, verdict wording', () => {
  const s = summarize([100, 101, 99, 100, 102]);
  const r = {
    schema: 'vortex.benchmark', version: 1, id: 'b1', status: 'done', error: null,
    config: { ref: { module: 'm', case: 'c' }, frameworks: ['mobilewright'], iterations: 5, warmup: 1, probes: true, coldStart: false, resetApp: true, timeoutMs: 1 },
    case: { module: 'm', case: 'c', name: 'browse <products>', steps: [{ n: 1, type: 'tap', title: 'X', kind: 'action' }], assertions: 1 },
    environment: { device: { model: 'Pixel', serial: 'S1', androidVersion: '15', sdk: 35 }, appPackage: 'com.x', buildType: 'release', appVersion: '2.1', simulated: true, host: 'linux' },
    startedAt: 'a', endedAt: 'b', progress: { done: 10, total: 10, current: '' }, samples: [], probes: {}, probeNotes: ['note <1>'],
    results: { mobilewright: { metrics: { steps: s }, perStep: [{ n: 1, title: '1. X', kind: 'action', summary: s }], failures: 0 } },
    probeSummary: {}, comparisons: [], notes: ['SIMULATED device'],
  } as unknown as BenchRecord;
  const html = renderBenchHtml(r);
  for (const x of ['browse &lt;products&gt;', 'Pixel (S1), Android 15 / API 35', '<b>release</b> build', '<b>100 ms</b>', 'SIMULATED device', 'note &lt;1&gt;', 'not measured']) assert.ok(html.includes(x), x);
});
