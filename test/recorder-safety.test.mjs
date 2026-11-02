import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { acquireRecorderOwner } from '../src/recorder-owner.js';
import { observeCompletedAction } from '../src/action-result.js';
import { DeviceLeases } from '../src/devices/device-lease.ts';
import { mobilecliDaemonStatus, stopMobilecliDaemon } from '../src/engines/mobilewright/daemon.ts';
import { recorderStillAlive } from '../src/engines/run-journal.ts';

test('recovery leaves journals owned by a live recorder alone', () => {
  assert.equal(recorderStillAlive({ recorderPid: process.pid }), true);
});

test('daemon checks keep timers responsive and accept an exit after a failed stop command', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-daemon-test-'));
  const cliDir = path.join(dir, 'node_modules', 'mobilecli');
  fs.mkdirSync(cliDir, { recursive: true });
  fs.writeFileSync(path.join(cliDir, 'index.js'), `
    const fs = require('node:fs'); const path = require('node:path');
    const stopped = path.join(__dirname, 'stopped');
    if (process.argv[3] === 'stop') { fs.writeFileSync(stopped, 'yes'); process.exit(1); }
    setTimeout(() => console.log(JSON.stringify({running: !fs.existsSync(stopped)})), 250);
  `);
  let ticked = false;
  const timer = setTimeout(() => { ticked = true; }, 25);
  try {
    assert.equal((await mobilecliDaemonStatus(dir)).running, true);
    assert.equal(ticked, true, 'daemon check must not block the event loop');
    assert.equal(await stopMobilecliDaemon(dir), true);
  } finally {
    clearTimeout(timer);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('completed action survives failed observation and invalidates stale state', async () => {
  let invalidated = false;
  const result = await observeCompletedAction(async () => { throw new Error('dump failed'); }, () => { invalidated = true; });
  assert.equal(result.actionCompleted, true);
  assert.equal(result.screen, null);
  assert.equal(invalidated, true);
  assert.match(result.warning, /do not repeat/);
});

test('recorder lease excludes an inspector until observation finishes', () => {
  const leases = new DeviceLeases();
  const release = leases.acquire('phone', { kind: 'recorder', id: 'capture', label: 'Capture' });
  assert.throws(() => leases.acquire('phone', { kind: 'inspector', id: 'inspect', label: 'Inspector' }), /recorder action/);
  release();
  leases.acquire('phone', { kind: 'inspector', id: 'inspect', label: 'Inspector' })();
});

test('ownership socket excludes a second owner and is released on close', async () => {
  const owner = await acquireRecorderOwner(0);
  const port = owner.address().port;
  try { await assert.rejects(acquireRecorderOwner(port), /recovery has not run/); }
  finally { await new Promise((resolve) => owner.close(resolve)); }
  const next = await acquireRecorderOwner(port);
  await new Promise((resolve) => next.close(resolve));
});

test('occupied UI port rejects startup before recovery touches pending journals', async () => {
  const occupied = await acquireRecorderOwner(0);
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-startup-test-'));
  const active = path.join(state, 'runs', 'active');
  fs.mkdirSync(active, { recursive: true });
  const journal = path.join(active, 'pending.json');
  fs.writeFileSync(journal, JSON.stringify({ id: 'pending', engine: 'appium', dir: state, startedAt: new Date().toISOString(), process: null }));
  try {
    const child = spawn(process.execPath, ['src/server.js', '--mock', '--no-open', '--port', String(occupied.address().port), '--state-dir', state], { windowsHide: true, stdio: 'pipe' });
    let output = '';
    child.stdout.on('data', (b) => { output += b; });
    child.stderr.on('data', (b) => { output += b; });
    const timer = setTimeout(() => child.kill(), 15000);
    const [code] = await once(child, 'exit');
    clearTimeout(timer);
    assert.equal(code, 1, output);
    assert.equal(fs.existsSync(journal), true, 'duplicate startup must not recover journals');
    assert.equal(fs.existsSync(path.join(state, 'result.json')), false);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
    fs.rmSync(state, { recursive: true, force: true });
  }
});
