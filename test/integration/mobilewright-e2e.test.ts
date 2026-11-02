/**
 * Feature: Record -> generate MobileWright (Plain, POM, Both) -> save to the project -> typecheck -> run with
 *          MobileWright's own runner -> structured result
 * Layer: Integration — the real @mobilewright/test package (types, CLI, Playwright Test runner, fixtures,
 *        locators, matchers), the real Vortex runner (wrapper config, JSON report, classification, cancel, lease)
 * Mocked: the phone. test/fixtures/fake-mobilewright-driver.mjs implements MobileWright's driver interface over
 *         the sample TradeHub screens. Passing here is NOT real-device verification.
 * Guards: generated TypeScript that does not compile against the real types, code the real runner cannot load
 *         or execute, wrong pass/fail classification, failures attributed to the wrong step, secrets required
 *         but not reported, cancel leaving processes or the device locked, Both mode running a flow twice
 * Run: VORTEX_MOBILEWRIGHT_DIR=/path/to/project-with-@mobilewright/test@0.0.66 npm run test:integration
 * Needs: a folder whose node_modules has @mobilewright/test (skipped otherwise, NOT passed)
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DeviceBusyError, DeviceLeases } from '../../src/devices/device-lease.ts';
import { detectMobilewright, MobilewrightRunner } from '../../src/engines/mobilewright/runner.ts';
import { fromUiSteps } from '../../src/model/recording.ts';
import { buildCase, listProject, saveCase, type Mode } from '../../src/project/project.ts';
import type { Recording } from '../../src/model/recording.ts';
import type { Variant } from '../../src/model/output.ts';
import { HOME, PKG, SAMPLES, sampleRecording } from '../support/sample-flow.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROJECT = process.env.VORTEX_MOBILEWRIGHT_DIR ? path.resolve(process.env.VORTEX_MOBILEWRIGHT_DIR) : '';
const env = PROJECT ? detectMobilewright(PROJECT) : null;
const skip = env?.ok ? false : `VORTEX_MOBILEWRIGHT_DIR does not point to a folder with @mobilewright/test installed (${env ? env.problems.join(' ') : 'not set'}): skipped, NOT passed`;
const SIZE = { width: 1080, height: 2400 };

let out: string;
let leases: DeviceLeases;
let runner: MobilewrightRunner;
let driverLog: string;

before(() => {
  if (skip) return;
  out = fs.mkdtempSync(path.join(PROJECT, '.vortex-it-'));
  leases = new DeviceLeases();
  driverLog = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-mw-log-')), 'driver.jsonl');
  process.env.VORTEX_FAKE_SAMPLES = SAMPLES;
  process.env.VORTEX_FAKE_DRIVER_LOG = driverLog;
  runner = new MobilewrightRunner({ leases, runsDir: path.join(out, '.runs'), testDriverModule: path.join(ROOT, 'test', 'fixtures', 'fake-mobilewright-driver.mjs') });
});

after(() => {
  if (out) fs.rmSync(out, { recursive: true, force: true });
});

function save(rec: Recording, caseSlug: string, mode: Mode, target: Variant = 'pom', module = 'catalog') {
  const ref = { module, case: caseSlug };
  const b = buildCase(rec, ref, { frameworks: ['mobilewright'], mode, target, size: SIZE });
  assert.deepEqual(b.issues, []);
  saveCase(out, ref, { recording: rec, files: b.files, assets: [], mode, target: mode === 'both' ? target : null, frameworks: ['mobilewright'], generator: 'it' });
  return Object.fromEntries(b.files.filter((f) => f.role === 'entry').map((f) => [f.variant, path.join(module, caseSlug, f.path)]));
}

async function run(files: string[], timeoutMs = 120_000) {
  const { id } = await runner.start({ testsDir: out, files, serial: 'mock-device', timeoutMs });
  return { id, result: await runner.wait(id) };
}

// Risk: generated code compiles in our heads but not against MobileWright's real type definitions.
// Given Plain and POM output (with a sensitive input), When type-checked under strict settings against @mobilewright/test, Then there are no errors.
test('generated TypeScript type-checks against the real @mobilewright/test types', { skip }, () => {
  save(sampleRecording({ sensitive: true }), 'typed', 'both', 'pom');
  fs.writeFileSync(path.join(out, 'tsconfig.json'), JSON.stringify({
    compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', skipLibCheck: true, noUnusedLocals: true, types: ['node'], typeRoots: [path.join(ROOT, 'node_modules', '@types')] },
    include: ['**/*.ts'],
    exclude: ['**/reports/**', '.runs/**'],
  }));
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(out, 'tsconfig.json')], { encoding: 'utf8' });
  } catch (e) {
    assert.fail(`tsc failed:\n${(e as { stdout?: string }).stdout}`);
  }
});

// Risk: the code compiles but the real runner cannot load or execute it; Both mode runs the flow twice.
// Given a Both-mode case (target POM), When the POM spec and the explicitly selected Plain alt file run, Then both pass, the driver saw the recorded actions, and default discovery finds only the POM spec.
test('Plain and POM specs pass in the real MobileWright runner; Both mode exposes one test to discovery', { skip }, async () => {
  const e = save(sampleRecording(), 'browse', 'both', 'pom');
  fs.writeFileSync(driverLog, '');
  const pom = await run([e.pom]);
  assert.equal(pom.result.status, 'passed', pom.result.summary + '\n' + runner.get(pom.id).output.slice(-2000));
  assert.deepEqual(pom.result.tests, { total: 1, passed: 1, failed: 0, skipped: 0 });
  assert.equal(pom.result.simulated, true);
  const ops = fs.readFileSync(driverLog, 'utf8').trim().split('\n').map((l) => JSON.parse(l) as { op: string; id?: string; button?: string });
  assert.ok(ops.some((o) => o.op === 'tap' && o.id?.endsWith('home_my_products_button')), 'tapped My Products');
  assert.ok(ops.some((o) => o.op === 'typeText'), 'typed the search text');
  assert.ok(ops.some((o) => o.op === 'pressButton' && o.button === 'BACK'));
  const plain = await run([e.plain]);
  assert.equal(plain.result.status, 'passed', plain.result.summary);
  assert.ok(e.plain.endsWith('.vortex-alt.ts'));
  const c = listProject(out).modules.flatMap((m) => m.cases).find((x) => x.case === 'browse')!;
  assert.deepEqual(c.entries.filter((x) => x.discoverable).map((x) => x.variant), ['pom']);
  // the device was leased during the runs and is free again
  leases.acquire('mock-device', { kind: 'inspector', id: 'probe', label: 'probe' })();
});

// Risk: a failing check is reported as passed, or the report names the wrong step.
// Given the flow expecting the wrong role, When run (Plain and POM), Then the run fails as an automation failure at step 7 with MobileWright's message.
test('a failing check is classified as failed and mapped to the recorded step', { skip }, async () => {
  const e = save(sampleRecording({ roleExpected: 'Role: BUYER' }), 'wrong-role', 'both', 'plain');
  for (const f of [e.plain, e.pom]) {
    const { result } = await run([f], 120_000);
    assert.equal(result.status, 'failed', result.summary);
    assert.equal(result.category, 'automation');
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].step, '7. Check "Role" (text)', f);
    assert.match(result.failed[0].message, /toHaveText|Role: BUYER/);
  }
});

// Risk: a test needing a secret silently types nothing, or the run passes without it.
test('sensitive input: missing variable fails with a clear message; provided variable passes', { skip }, async () => {
  const e = save(sampleRecording({ sensitive: true }), 'secret', 'pom');
  delete process.env.VORTEX_SECRET_SEARCH;
  const miss = await run([e.pom]);
  assert.equal(miss.result.status, 'failed');
  assert.match(miss.result.failed[0].message, /VORTEX_SECRET_SEARCH/);
  process.env.VORTEX_SECRET_SEARCH = 'steel';
  try {
    const ok = await run([e.pom]);
    assert.equal(ok.result.status, 'passed', ok.result.summary);
    assert.ok(!runner.get(ok.id).output.includes('steel'), 'secret value not in the output');
  } finally {
    delete process.env.VORTEX_SECRET_SEARCH;
  }
});

// Risk: a broken or empty file is reported as passed or as a test failure.
test('load errors and empty files are classified separately', { skip }, async () => {
  const dir = path.join(out, 'misc', 'broken');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'syntax.test.ts'), "import { test } from '@mobilewright/test';\ntest('x', async () => { const = ; });\n");
  fs.writeFileSync(path.join(dir, 'empty.test.ts'), "import '@mobilewright/test';\n");
  const syntax = await run(['misc/broken/syntax.test.ts']);
  assert.equal(syntax.result.status, 'error');
  assert.equal(syntax.result.category, 'import-or-syntax');
  const empty = await run(['misc/broken/empty.test.ts']);
  assert.equal(empty.result.status, 'no-tests', empty.result.summary);
});

// Risk: cancel leaves the runner running or the device locked.
test('cancel stops the run and frees the device', { skip }, async () => {
  const rec = fromUiSteps([{ type: 'sleep', args: { ms: 60_000 }, screen: HOME }], { id: 'rec-sleep', name: 'long wait', module: 'misc', appPackage: PKG, serial: null, screen: SIZE, version: 'it' });
  const e = save(rec, 'long-wait', 'plain', 'plain', 'misc');
  const { id } = await runner.start({ testsDir: out, files: [e.plain], serial: 'mock-device', timeoutMs: 120_000 });
  for (let i = 0; i < 100 && !/1 test|Running/.test(runner.get(id).output); i++) await new Promise((r) => setTimeout(r, 100));
  assert.throws(() => leases.acquire('mock-device', { kind: 'inspector', id: 'x', label: 'x' }), DeviceBusyError);
  runner.cancel(id);
  const r = await runner.wait(id);
  assert.equal(r.status, 'cancelled');
  assert.ok(r.durationMs < 30_000);
  leases.acquire('mock-device', { kind: 'inspector', id: 'probe2', label: 'probe' })();
});

// Risk: running a module mixes up cases or misses some.
test('a module run executes every case once', { skip }, async () => {
  save(sampleRecording({ name: 'first' }), 'first', 'pom', 'pom', 'shop');
  save(sampleRecording({ name: 'second' }), 'second', 'both', 'plain', 'shop');
  const files = listProject(out).modules.find((m) => m.module === 'shop')!.cases.flatMap((c) => c.entries.filter((x) => x.discoverable).map((x) => path.join('shop', c.case, x.path)));
  assert.equal(files.length, 2);
  const { result } = await run(files);
  assert.equal(result.status, 'passed', result.summary);
  assert.equal(result.tests?.total, 2);
});
