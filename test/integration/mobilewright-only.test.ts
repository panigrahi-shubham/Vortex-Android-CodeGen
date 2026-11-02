import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startServer, stopServer } from '../support/server.ts';

test('MobileWright-only server rejects retired APIs and engines without affecting inspection', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-mw-only-'));
  const server = await startServer(path.join(root, 'state'), path.join(root, 'out'));
  try {
    const config = await server.api('/api/config');
    assert.equal(config.body.engine, 'mobilewright');
    for (const endpoint of ['/api/appium/status', '/api/appium/inspect', '/api/python/env']) {
      assert.equal((await server.api(endpoint)).status, 404, endpoint);
    }
    const rejected = await server.api('/api/runs', { engine: 'appium' });
    assert.equal(rejected.status, 400);
    assert.equal(rejected.body.code, 'UNSUPPORTED_FRAMEWORK');
    const mixedBench = await server.api('/api/bench', { module: 'm', case: 'c', frameworks: ['mobilewright', 'appium'] });
    assert.equal(mixedBench.status, 400);
    assert.match(mixedBench.body.error, /Only MobileWright/);
    const screen = await server.api('/api/screen');
    assert.equal(screen.status, 200);
    assert.ok(screen.body.nodes.length > 0);
    const stale = await server.api('/api/action', { kind: 'tap', x: 20, y: 20, screenId: 'old-capture' });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'STALE_SCREEN');
    await server.api('/api/config', {pkg: 'com.indiamart.m'});
    const foreground = await server.api('/api/screen');
    assert.ok(foreground.body.nodes.length > 0, 'the mock foreground app remains inspectable');
    assert.equal(foreground.body.pkg, 'com.indiamart.m', 'inspection cannot change the launch target');
    assert.equal((await server.api('/api/config')).body.pkg, 'com.indiamart.m');
  } finally {
    await stopServer(server.child);
    fs.rmSync(root, { recursive: true, force: true });
  }
});
