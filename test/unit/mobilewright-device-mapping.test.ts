import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DeviceLeases } from '../../src/devices/device-lease.ts';
import { MobilewrightRunner } from '../../src/engines/mobilewright/runner.ts';
import { RunError } from '../../src/engines/run-types.ts';
import type { ProcessInspector } from '../../src/runtime/process-inspector.ts';

function project() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-device-map-'));
  fs.mkdirSync(path.join(dir, 'node_modules/@mobilewright/test'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules/@mobilewright/test/package.json'), '{"version":"0.0.66"}');
  fs.mkdirSync(path.join(dir, 'node_modules/mobilewright/dist'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'node_modules/mobilewright/dist/cli.js'), `require('fs').writeFileSync(process.env.PLAYWRIGHT_JSON_OUTPUT_FILE, JSON.stringify({ stats: { expected: 1, unexpected: 0, flaky: 0, skipped: 0 }, suites: [], errors: [] }));`);
  fs.mkdirSync(path.join(dir, 'node_modules/mobilecli'), { recursive: true });
  const marker = path.join(dir, 'hardware-discovery.marker');
  fs.writeFileSync(path.join(dir, 'node_modules/mobilecli/index.js'), `require('fs').writeFileSync(${JSON.stringify(marker)}, 'queried'); console.log(JSON.stringify({ status: 'ok', data: { devices: [{ id: 'unrelated-real-phone', model: 'Example Phone', platform: 'android', type: 'real', state: 'online' }] } }));`);
  fs.writeFileSync(path.join(dir, 'flow.test.ts'), '// saved fixture');
  return { dir, marker };
}

const inspector: ProcessInspector = {
  platform: process.platform,
  info: async () => null,
  listeningPids: async () => [],
  isPortFree: async () => true,
  kill: async () => { throw new Error('Tests must not kill a process'); },
};

test('simulated driver keeps mock-device and never queries connected hardware', { timeout: 10000 }, async () => {
  const { dir, marker } = project();
  try {
    const leases = new DeviceLeases();
    const runner = new MobilewrightRunner({ leases, runsDir: path.join(dir, 'runs'), testDriverModule: path.join(dir, 'fake-driver.mjs'), inspector });
    const { id } = await runner.start({ testsDir: dir, files: ['flow.test.ts'], serial: 'mock-device', timeoutMs: 5000 });
    const result = await runner.wait(id);
    const config = fs.readFileSync(path.join(runner.get(id).dir, 'vortex.mobilewright.config.ts'), 'utf8');
    assert.match(config, /deviceId: "mock-device"/);
    assert.doesNotMatch(config, /unrelated-real-phone/);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(result.simulated, true);
    assert.equal(result.status, 'passed');
    assert.equal(leases.holder('mock-device'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('unmatched real serial cannot adopt the sole phone without identity metadata', async () => {
  const { dir, marker } = project();
  try {
    const leases = new DeviceLeases();
    const runner = new MobilewrightRunner({ leases, runsDir: path.join(dir, 'runs'), inspector });
    await assert.rejects(runner.start({ testsDir: dir, files: ['flow.test.ts'], serial: 'selected-but-absent', timeoutMs: 5000 }),
      (error: unknown) => error instanceof RunError && error.code === 'MOBILEWRIGHT_DEVICE_MISMATCH');
    assert.equal(fs.existsSync(marker), true);
    assert.deepEqual(runner.active(), []);
    assert.equal(leases.holder('selected-but-absent'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
