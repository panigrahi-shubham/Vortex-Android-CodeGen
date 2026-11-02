import assert from 'node:assert/strict';

import { execFileSync } from 'node:child_process';

import fs from 'node:fs';


import path from 'node:path';

import { before, test } from 'node:test';

import { fileURLToPath } from 'node:url';


import { DeviceLeases } from '../../src/devices/device-lease.ts';

import { detectMobilewright, MobilewrightRunner } from '../../src/engines/mobilewright/runner.ts';

import type { Framework } from '../../src/model/output.ts';

import { buildCase, saveCase } from '../../src/project/project.ts';

import { loadPlaywright } from '../fixtures/webview-host.mjs';

import { SAMPLES, webSampleRecording } from '../support/sample-flow.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const SIZE = { width: 1080, height: 2400 };

const noBrowser = loadPlaywright() ? false : 'Playwright with Chromium is not available (set VORTEX_PLAYWRIGHT): skipped, NOT passed';

const MW = process.env.VORTEX_MOBILEWRIGHT_DIR ? path.resolve(process.env.VORTEX_MOBILEWRIGHT_DIR) : '';

const noMw = noBrowser || (MW && detectMobilewright(MW).ok ? false : 'VORTEX_MOBILEWRIGHT_DIR does not point to a project with @mobilewright/test: skipped, NOT passed');

before(() => {
  process.env.VORTEX_FAKE_SAMPLES = SAMPLES;
});

function saveWeb(out: string, frameworks: Framework[], o: Parameters<typeof webSampleRecording>[0], caseSlug = 'subscribe') {
  const rec = webSampleRecording(o);
  const ref = { module: 'insights', case: caseSlug };
  const b = buildCase(rec, ref, { frameworks, mode: 'both', target: 'pom', size: SIZE });
  assert.deepEqual(b.issues, []);
  saveCase(out, ref, { recording: rec, files: b.files, assets: [], mode: 'both', target: 'pom', frameworks, generator: 'it' });
  return b.files.filter((f) => f.role === 'entry').map((f) => ({ variant: f.variant, file: path.join('insights', caseSlug, f.path) }));
}

test('MobileWright: Native -> WebView -> Native type-checks and passes in Plain and POM; failures name the step', { skip: noMw }, async () => {
  const out = fs.mkdtempSync(path.join(MW, '.vortex-web-it-'));
  try {
    const entries = saveWeb(out, ['mobilewright'], { sensitive: false });
    saveWeb(out, ['mobilewright'], { sensitive: true }, 'secret-email');
    fs.writeFileSync(path.join(out, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', skipLibCheck: true, noUnusedLocals: true, types: ['node'], typeRoots: [path.join(ROOT, 'node_modules', '@types')] }, include: ['**/*.ts'], exclude: ['**/reports/**', '.runs/**'] }));
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', path.join(out, 'tsconfig.json')], { encoding: 'utf8' });
    } catch (e) {
      assert.fail(`tsc failed:\n${(e as { stdout?: string }).stdout}`);
    }
    const runner = new MobilewrightRunner({ leases: new DeviceLeases(), runsDir: path.join(out, '.runs'), testDriverModule: path.join(ROOT, 'test', 'fixtures', 'fake-mobilewright-driver.mjs') });
    const run = async (file: string) => {
      const { id } = await runner.start({ testsDir: out, files: [file], serial: 'mock-device', timeoutMs: 120_000 });
      return { id, r: await runner.wait(id) };
    };
    for (const e of entries) {
      const { id, r } = await run(e.file);
      assert.equal(r.status, 'passed', `${e.variant}: ${r.summary}\n${runner.get(id).output.slice(-2500)}`);
    }
    for (const e of saveWeb(out, ['mobilewright'], { statusExpected: 'Subscribed: nobody' }, 'wrong-status')) {
      const { r } = await run(e.file);
      assert.equal(r.status, 'failed');
      assert.equal(r.failed[0].step, '4. Check "status" (text) (web)', e.variant);
    }
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
