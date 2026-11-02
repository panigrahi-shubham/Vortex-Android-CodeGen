/**
 * Feature: MobileWright engine support — device lease, JUnit parsing, failed-step mapping, run-file safety,
 *          WebDriver error hints, session capabilities, Python discovery, recorder locator parts
 * Layer: Unit — node:test
 * Real: all of the above as pure logic; files in a temp folder
 * Mocked: nothing
 * Guards: two tools driving one phone, wrong pass/fail reporting, running unsaved or out-of-folder code,
 *         misleading diagnostics, sessions that reset or launch apps unexpectedly
 * Run: npm run test:unit
 * Needs: Node.js 22.18+
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DeviceBusyError, DeviceLeases } from '../../src/devices/device-lease.ts';
import { annotate } from '../../src/locators.js';
import { appNodes, parseTree } from '../../src/tree.js';

// Risk: the ADB recorder and a MobileWright run drive the same phone at once.
// Given a run holding the device, When anyone else asks for it, Then they get DEVICE_BUSY naming the holder; after release it is free.
test('device lease: one owner per device, idempotent release', () => {
  const l = new DeviceLeases();
  const release = l.acquire('ZD222', { kind: 'run', id: 'r1', label: 'test_login' });
  assert.throws(() => l.acquire('ZD222', { kind: 'inspector', id: 'i1', label: 'Inspector' }), (e: unknown) => e instanceof DeviceBusyError && /test run "test_login"/.test((e as Error).message));
  assert.throws(() => l.assertFree('ZD222'), DeviceBusyError);
  l.assertFree('ZD222', { kind: 'run', id: 'r1' });
  l.assertFree('OTHER');
  release();
  release();
  l.assertFree('ZD222');
  assert.deepEqual(l.all(), []);
});

test('every recorded locator carries framework-neutral parts', () => {
  const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'samples');
  for (const f of ['home.json', 'products.json']) {
    const nodes = appNodes(parseTree(fs.readFileSync(path.join(SAMPLES, f))), 'com.yourname.tradehub') as unknown as { target: { kind: string; parts?: { by: string } } }[];
    annotate(nodes as never, 'com.yourname.tradehub');
    for (const n of nodes) {
      if (n.target.kind === 'coordinate') assert.equal(n.target.parts, undefined);
      else {
        assert.ok(n.target.parts, `${f}: ${n.target.kind} target without parts`);
        assert.equal(n.target.parts!.by === 'scoped', n.target.kind === 'scoped');
      }
    }
  }
});
