import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { startServer, stopServer } from '../support/server.ts';
import { SAMPLES } from '../support/sample-flow.ts';
import { loadPlaywright } from '../fixtures/webview-host.mjs';

test('mock device panel explains simulated transport and refuses hardware commands', { skip: !loadPlaywright() ? 'Playwright unavailable' : false }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-connection-mock-'));
  const srv = await startServer(path.join(tmp, 'state'), path.join(tmp, 'out'));
  try {
    const status = await srv.api('/api/connection');
    assert.equal(status.body.mock, true);
    for (const operation of ['select', 'connect', 'recover']) assert.equal((await srv.api('/api/connection/' + operation, { serial: 'physical', endpoint: 'host:5555' })).status, 409);
    const pw = loadPlaywright() as any;
    assert.ok(pw, 'Playwright is required for the device panel check');
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(srv.base);
      await page.locator('#btnDevices').evaluate((button: { click(): void }) => button.click());
      await page.waitForFunction("document.querySelector('#devStatus')?.textContent?.includes('Simulated mode')");
      assert.equal(await page.locator('#devConnect').isDisabled(), true);
      assert.equal(await page.locator('#devRecover').isDisabled(), true);
    } finally { await browser.close(); }
  } finally { await stopServer(srv.child); fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('selection and recovery keep device identity, reject stale actions, and diagnose disconnects', { skip: process.platform === 'win32' ? 'POSIX fake adb executable; hardware not exercised' : !loadPlaywright() ? 'Playwright unavailable' : false }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-connection-live-'));
  const bin = path.join(tmp, 'bin'); fs.mkdirSync(bin);
  const state = path.join(tmp, 'devices.txt');
  fs.writeFileSync(state, 'List of devices attached\nphone-one device usb:1 model:One\nphone-two device usb:2 model:Two\n');
  fs.writeFileSync(path.join(bin, 'adb'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'devices') process.stdout.write(fs.readFileSync(${JSON.stringify(state)}));
else if (args[0] === 'connect') { fs.appendFileSync(${JSON.stringify(state)}, args[1]+' device model:Remote\\n'); console.log('connected'); }
else if (args.includes('screencap')) process.stdout.write(fs.readFileSync(${JSON.stringify(path.join(SAMPLES, 'home.png'))}));
else if (args.includes('uiautomator')) console.log('<hierarchy><node text="Home" resource-id="com.yourname.tradehub:id/home" class="android.widget.TextView" package="com.yourname.tradehub" bounds="[0,0][100,100]" /></hierarchy>');
else if (args.includes('activities')) console.log('mResumedActivity: ActivityRecord{0 u0 com.yourname.tradehub/.HomeActivity}');
else if (args.includes('version')) console.log('Android Debug Bridge fake');
`, { mode: 0o755 });
  const srv = await startServer(path.join(tmp, 'state'), path.join(tmp, 'out'), { PATH: bin + path.delimiter + process.env.PATH }, ['--device', 'phone-one', '--tree-source', 'uiautomator']);
  try {
    const capture = await srv.api('/api/screen'); assert.equal(capture.status, 200);
    assert.equal((await srv.api('/api/draft', { revision: 0, data: { pkg: 'com.yourname.tradehub', device: 'phone-one', name: 'Keep this flow', steps: [{ type: 'wait', args: { ms: 100 } }] } })).status, 200);
    const selected = await srv.api('/api/connection/select', { serial: 'phone-two', mobilecliDevice: 'TwoAlias' });
    assert.equal(selected.body.current, 'phone-two'); assert.equal(selected.body.mobilecliDevice, 'TwoAlias');
    assert.equal((await srv.api('/api/action', { kind: 'key', key: 'BACK', screenId: capture.body.screenId })).status, 409);
    fs.writeFileSync(state, 'List of devices attached\nphone-one device usb:1\nphone-two unauthorized usb:2\n');
    assert.equal((await srv.api('/api/connection/recover', {})).status, 409);
    assert.equal((await srv.api('/api/connection')).body.current, 'phone-two');
    assert.match((await srv.api('/api/connection')).body.hint, /authorization/);
    fs.writeFileSync(state, 'List of devices attached\nphone-one device usb:1\n');
    assert.equal((await srv.api('/api/connection')).body.state, 'missing');
    fs.appendFileSync(state, 'phone-two device usb:2\n');
    assert.equal((await srv.api('/api/connection/recover', {})).body.current, 'phone-two');
    assert.equal((await srv.api('/api/draft')).body.data.name, 'Keep this flow');
    assert.equal((await srv.api('/api/connection/connect', { endpoint: 'bad:0' })).status, 400);
    assert.equal((await srv.api('/api/connection/connect', { endpoint: 'phone.example:5555' })).body.connected, 'phone.example:5555');
    assert.equal((await srv.api('/api/connection')).body.current, 'phone-two', 'connecting never silently selects another device');
    const pw = loadPlaywright() as any; assert.ok(pw);
    const browser = await pw.chromium.launch();
    try {
      const page = await browser.newPage();
      await page.addInitScript("localStorage.setItem('vortex.setupSeen', '1')");
      await page.goto(srv.base);
      await page.locator('#btnDevices').evaluate((button: { click(): void }) => button.click());
      await page.locator('[data-select-device="phone-one"]').waitFor();
      await page.locator('[data-select-device="phone-one"]').click();
      await page.waitForFunction("document.querySelector('#devStatus')?.textContent?.includes('Selected phone-one')");
      assert.equal((await srv.api('/api/connection')).body.mobilecliDevice, '');
      // Clear the alias explicitly when switching to an ADB-matched device.
      await page.locator('#devAlias').fill('');
      await page.locator('[data-select-device="phone-two"]').click();
      await page.waitForFunction("document.querySelector('#devStatus')?.textContent?.includes('Selected phone-two')");
      assert.equal((await srv.api('/api/connection')).body.mobilecliDevice, '');
      assert.equal(await page.locator('#inspectList button').count(), 0);
    } finally { await browser.close(); }
  } finally { await stopServer(srv.child); fs.rmSync(tmp, { recursive: true, force: true }); }
});
