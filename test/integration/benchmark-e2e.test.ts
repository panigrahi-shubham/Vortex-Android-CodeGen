import assert from 'node:assert/strict';

import fs from 'node:fs';

import os from 'node:os';

import path from 'node:path';

import { test } from 'node:test';

import { detectMobilewright } from '../../src/engines/mobilewright/runner.ts';

import type { Framework } from '../../src/model/output.ts';

import { buildCase, saveCase } from '../../src/project/project.ts';

import { sampleRecording } from '../support/sample-flow.ts';

import { startServer, stopServer } from '../support/server.ts';


const SIZE = { width: 1080, height: 2400 };

const MW = process.env.VORTEX_MOBILEWRIGHT_DIR ? path.resolve(process.env.VORTEX_MOBILEWRIGHT_DIR) : '';

function save(out: string, frameworks: Framework[]) {
  const rec = sampleRecording({ name: 'browse products' });
  const ref = { module: 'bench', case: 'browse' };
  const b = buildCase(rec, ref, { frameworks, mode: 'both', target: 'pom', size: SIZE });
  assert.deepEqual(b.issues, []);
  saveCase(out, ref, { recording: rec, files: b.files, assets: [], mode: 'both', target: 'pom', frameworks, generator: 'it' });
  return rec;
}

async function waitDone(api: Awaited<ReturnType<typeof startServer>>['api'], id: string, maxMs = 400_000) {
  const t0 = Date.now();
  for (;;) {
    const r = (await api(`/api/bench/${id}`)).body;
    if (r.status !== 'running') return r;
    if (Date.now() - t0 > maxMs) throw new Error('benchmark did not finish');
    await new Promise((x) => setTimeout(x, 300));
  }
}

test('benchmark: MobileWright timings, per-step medians, exports and unchanged source', { skip: !(MW && detectMobilewright(MW).ok) }, async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-bench-state-'));
  const out = fs.mkdtempSync(path.join(MW, '.vortex-bench-it-'));
  const rec = save(out, ['mobilewright']);
  const srv = await startServer(state, out, {});
  try {
    assert.equal((await srv.api('/api/bench', { module: 'bench', case: 'nope' })).status, 404);
    const st = await srv.api('/api/bench', { module: 'bench', case: 'browse', iterations: 5, warmup: 1 });
    assert.equal(st.status, 200, JSON.stringify(st.body));
    assert.equal((await srv.api('/api/bench', { module: 'bench', case: 'browse' })).status, 409, 'one benchmark at a time');
    const r = await waitDone(srv.api, st.body.id);
    assert.equal(r.status, 'done', r.error ?? JSON.stringify(r.samples.map((s: { status: string; summary: string }) => s.summary)));
    assert.equal(r.samples.length, 6, '1 warm-up + 5 measured runs');
    for (const fw of ['mobilewright']) {
      const res = r.results[fw];
      assert.equal(res.failures, 0, `${fw}: ${JSON.stringify(r.samples.filter((s: { framework: string }) => s.framework === fw).map((s: { status: string; summary: string; complete: boolean; segments: unknown[] }) => [s.status, s.summary, s.complete, s.segments.length]))}`);
      assert.equal(res.metrics.endToEnd.n, 5, fw);
      assert.equal(res.metrics.steps.n, 5, fw);
      assert.ok(res.metrics.steps.median > 0 && res.metrics.endToEnd.median > res.metrics.steps.median, fw);
      assert.ok(res.metrics.assertions.n === 5 && res.metrics.actions.n === 5, fw);
      assert.equal(res.perStep.length, rec.events.length);
      assert.ok(res.perStep.every((p: { summary: { n: number } }) => p.summary.n === 5), `${fw}: every step timed in every run`);
    }
    assert.equal(r.results.mobilewright.metrics.session.n, 0, 'not measurable from outside MobileWright: reported as not measured');
    assert.equal(r.results.mobilewright.metrics.preamble.n, 5);
    assert.ok(!r.probeSummary.deviceDiscovery && r.probeNotes.some((n: string) => /simulated device/.test(n)));
    assert.ok(!r.probeSummary.coldStart);
    assert.match(r.notes[0], /^SIMULATED device/);
    assert.equal(r.environment.buildType, 'debug');
    assert.equal(r.case.steps.length, rec.events.length);
    assert.ok(!fs.existsSync(path.join(out, '.vortex-bench')), 'instrumented copies removed from the project');
    const saved = fs.readFileSync(path.join(out, 'bench', 'browse', 'mobilewright', 'plain', 'browse.vortex-alt.ts'), 'utf8');
    assert.ok(!saved.includes('_vortex_mark'), 'the saved test is unchanged');
    const html = await srv.api(`/api/bench/${r.id}/export.html`);
    assert.match(String(html.headers.get('content-disposition')), /vortex-benchmark-/);
    for (const s of ['SIMULATED device', 'Recorded steps (first step to last)', 'Check and wait steps', 'Per step', 'Device discovery']) assert.ok(String(html.body).includes(s), s);
    assert.ok(fs.existsSync(path.join(state, 'benchmarks', r.id, 'benchmark.html')));
    const reports = (await srv.api('/api/reports')).body.reports;
    assert.equal(reports.filter((x: { file: string }) => /benchmark/.test(x.file)).length, 0, 'benchmark runs are not mixed into the run history');
    const list = (await srv.api('/api/bench')).body;
    assert.equal(list.active, null);
    assert.equal(list.benchmarks[0].id, r.id);

    // one run: no conclusions
    const one = await waitDone(srv.api, (await srv.api('/api/bench', { module: 'bench', case: 'browse', iterations: 1, warmup: 0, probes: false })).body.id);
    assert.equal(one.status, 'done');
    assert.ok(one.comparisons.every((c: { comparison: { verdict: string } }) => c.comparison.verdict === 'insufficient-data'));
    assert.ok(one.notes.some((n: string) => /Fewer than 5 runs/.test(n)));
  } finally {
    await stopServer(srv.child);
    fs.rmSync(state, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});
