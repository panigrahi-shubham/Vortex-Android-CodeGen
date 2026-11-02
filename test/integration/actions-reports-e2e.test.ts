import assert from 'node:assert/strict';

import { spawn } from 'node:child_process';

import fs from 'node:fs';

import os from 'node:os';

import path from 'node:path';

import { before, test } from 'node:test';

import { fileURLToPath } from 'node:url';

import { createProcessInspector } from '../../src/runtime/process-inspector.ts';

import { DeviceLeases } from '../../src/devices/device-lease.ts';

import { detectMobilewright, MobilewrightRunner } from '../../src/engines/mobilewright/runner.ts';

import { journalBegin } from '../../src/engines/run-journal.ts';

import type { Framework } from '../../src/model/output.ts';

import { buildCase, saveCase } from '../../src/project/project.ts';

import { actionSampleRecording, SAMPLES } from '../support/sample-flow.ts';

import { startServer, stopServer } from '../support/server.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SIZE = { width: 1080, height: 2400 };

const MW = process.env.VORTEX_MOBILEWRIGHT_DIR ? path.resolve(process.env.VORTEX_MOBILEWRIGHT_DIR) : '';

const noMw = MW && detectMobilewright(MW).ok ? false : 'VORTEX_MOBILEWRIGHT_DIR does not point to a project with @mobilewright/test: skipped, NOT passed';

before(() => {
  process.env.VORTEX_FAKE_SAMPLES = SAMPLES;
});

function save(out: string, frameworks: Framework[], rec: ReturnType<typeof actionSampleRecording>, ref: { module: string; case: string }) {
  const b = buildCase(rec, ref, { frameworks, mode: 'both', target: 'pom', size: SIZE });
  assert.deepEqual(b.issues, []);
  saveCase(out, ref, { recording: rec, files: b.files, assets: [], mode: 'both', target: 'pom', frameworks, generator: 'it' });
  return b.files.filter((f) => f.role === 'entry').map((f) => ({ variant: f.variant, file: path.join(ref.module, ref.case, f.path) }));
}

function wrongRole() {
  const rec = actionSampleRecording();
  const last = rec.events[rec.events.length - 1];
  last.check = { ...last.check!, expected: 'Role: BUYER' };
  return rec;
}

test('MobileWright: deep link, checkpoint, clear, wait enabled, close/launch pass; checkpoint attachment saved', { skip: noMw }, async () => {
  const out = fs.mkdtempSync(path.join(MW, '.vortex-act-it-'));
  try {
    const runner = new MobilewrightRunner({ leases: new DeviceLeases(), runsDir: path.join(out, '.runs'), testDriverModule: path.join(ROOT, 'test', 'fixtures', 'fake-mobilewright-driver.mjs') });
    for (const e of save(out, ['mobilewright'], actionSampleRecording(), { module: 'actions', case: 'more' })) {
      const { id } = await runner.start({ testsDir: out, files: [e.file], serial: 'mock-device', timeoutMs: 120_000 });
      const r = await runner.wait(id);
      assert.equal(r.status, 'passed', `${e.variant}: ${r.summary}\n${runner.get(id).output.slice(-2500)}`);
      const cp = r.artifacts.find((a) => a.type === 'checkpoint');
      assert.ok(cp?.file && fs.existsSync(path.join(runner.get(id).dir, cp.file)), `${e.variant}: ${JSON.stringify(r.artifacts)}`);
    }
    for (const e of save(out, ['mobilewright'], wrongRole(), { module: 'actions', case: 'wrong-role' })) {
      const { id } = await runner.start({ testsDir: out, files: [e.file], serial: 'mock-device', timeoutMs: 120_000 });
      const r = await runner.wait(id);
      assert.equal(r.status, 'failed');
      assert.equal(r.failed[0].diagnosis?.kind, 'assertion-mismatch', `${e.variant}: ${JSON.stringify(r.failed[0]).slice(0, 1500)}`);
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});

test('recovery: an interrupted run is stopped only when its process identity matches, and recorded as interrupted', async () => {
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-rec-state-'));
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-rec-out-'));
  const orphan = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000)'], { stdio: 'ignore' });
  const bystander = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 120000) // bystander'], { stdio: 'ignore' });
  const procs = createProcessInspector();
  await new Promise((r) => setTimeout(r, 300));
  const runs = path.join(state, 'runs');
  const d1 = path.join(runs, 'r-orphan');
  const d2 = path.join(runs, 'r-reused');
  fs.mkdirSync(d1, { recursive: true });
  fs.mkdirSync(d2, { recursive: true });
  journalBegin(runs, { id: 'r-orphan', engine: 'mobilewright', label: 'orphan', dir: d1, serial: 'mock-device', startedAt: new Date(Date.now() - 5000).toISOString(), process: await procs.info(orphan.pid!) });
  const reused = (await procs.info(bystander.pid!))!;
  journalBegin(runs, { id: 'r-reused', engine: 'mobilewright', label: 'reused pid', dir: d2, serial: 'mock-device', startedAt: new Date().toISOString(), process: { ...reused, startTime: 'not-the-same' } });
  // Simulate journals left by a recorder that is no longer running. journalBegin
  // normally records this live test process as owner, which must not be recovered.
  for (const id of ['r-orphan', 'r-reused']) {
    const file = path.join(runs, 'active', `${id}.json`);
    const entry = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete entry.recorderPid;
    fs.writeFileSync(file, JSON.stringify(entry));
  }
  const srv = await startServer(state, out);
  try {
    const rep = (await srv.api('/api/reports')).body;
    const orphanRec = rep.recovered.find((x: { id: string }) => x.id === 'r-orphan');
    assert.ok(orphanRec, JSON.stringify(rep.recovered));
    assert.match(orphanRec.detail.join(' '), /stopped its MobileWright process \d+ \(identity verified\)/);
    assert.match(rep.recovered.find((x: { id: string }) => x.id === 'r-reused').detail.join(' '), /left alone/);
    for (let i = 0; i < 50 && orphan.exitCode === null && orphan.signalCode === null; i++) await new Promise((r) => setTimeout(r, 100));
    assert.ok(orphan.exitCode !== null || orphan.signalCode !== null, 'the orphaned process was stopped');
    assert.equal(bystander.exitCode, null, 'the process with a reused PID was left running');
    assert.equal(bystander.signalCode, null);
    assert.equal(JSON.parse(fs.readFileSync(path.join(d1, 'result.json'), 'utf8')).status, 'interrupted');
    assert.deepEqual(fs.readdirSync(path.join(runs, 'active')), []);
  } finally {
    await stopServer(srv.child);
    bystander.kill();
    orphan.kill();
    fs.rmSync(state, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
});
