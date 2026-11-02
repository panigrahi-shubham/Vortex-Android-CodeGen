import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { DeviceLeases } from '../../src/devices/device-lease.ts';
import { MobilewrightRunner } from '../../src/engines/mobilewright/runner.ts';
import { RunError } from '../../src/engines/run-types.ts';

test('failed run-directory creation releases the device without registering a phantom run', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-mw-lease-'));
  try {
    fs.mkdirSync(path.join(dir, 'node_modules/@mobilewright/test'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules/@mobilewright/test/package.json'), '{"version":"0.0.66"}');
    fs.mkdirSync(path.join(dir, 'node_modules/mobilewright/dist'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules/mobilewright/dist/cli.js'), 'throw new Error("must not spawn");');
    fs.writeFileSync(path.join(dir, 'flow.test.ts'), '// saved fixture');
    const blocked = path.join(dir, 'reports-is-a-file');
    fs.writeFileSync(blocked, 'keep this user file');
    const leases = new DeviceLeases();
    const runner = new MobilewrightRunner({ leases, runsDir: path.join(dir, 'runs') });
    await assert.rejects(runner.start({ testsDir: dir, files: ['flow.test.ts'], serial: 'test-phone', timeoutMs: 1000, reportDir: blocked }),
      (error: unknown) => error instanceof RunError && error.code === 'PREPARE_FAILED');
    assert.equal(leases.holder('test-phone'), null);
    assert.deepEqual(runner.active(), []);
    const release = leases.acquire('test-phone', { kind: 'recorder', id: 'next', label: 'Recording can resume' });
    release();
    assert.equal(fs.readFileSync(blocked, 'utf8'), 'keep this user file');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
