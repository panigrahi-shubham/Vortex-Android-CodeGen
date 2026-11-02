/**
 * Feature: Windows distribution (zip + launchers) and the setup check
 * Layer: Integration — the real packaging script, ZIP reader with CRC checks, the packaged recorder started from the
 *        extracted folder (no node_modules), the setup check through the CLI and the API
 * Mocked: the phone (--mock). Windows itself is NOT exercised: the .cmd/.ps1 launchers are checked for content and
 *         line endings only.
 * Guards: a package that misses files or needs npm install, user data or tests shipped in it, launchers with LF line
 *         endings, a setup check that changes something or breaks on old Node
 * Run: npm run test:integration
 * Needs: Node.js 22.18+
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { collect, packageWindows, readZip } from '../../scripts/package-windows.mjs';
import { startServer, stopServer } from '../support/server.ts';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('Windows package: self-contained, nothing of the user, CRLF launchers, starts from the extracted folder', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-pkg-'));
  try {
    const r = packageWindows(tmp);
    const zip = fs.readFileSync(r.zipFile);
    assert.equal(fs.readFileSync(`${r.zipFile}.sha256`, 'utf8').split(' ')[0], r.sha256);
    const entries = readZip(zip);
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const names = entries.map((e) => e.name.replace(`vortex-android-recorder-${version}/`, ''));
    for (const f of ['start-vortex.cmd', 'start-vortex.ps1', 'vortex.config.example.cmd', 'src/server.js', 'src/doctor.js', 'src/bench/benchmark.ts', 'public/index.html', 'samples/home.png', 'docs/BENCHMARKS.md', 'test/fixtures/fake-mobilewright-driver.mjs']) assert.ok(names.includes(f), f);
    assert.ok(!names.some((n) => /node_modules|^generated\/|^\.vortex|^test\/(unit|integration)|mock-appium|\.log$/.test(n)), names.filter((n) => /node_modules|generated|test\//.test(n)).join(', '));
    assert.deepEqual(names, collect().filter((n) => names.includes(n)), 'same order as collected');
    for (const e of entries.filter((x) => /\.(cmd|ps1)$/.test(x.name))) {
      const t = e.data.toString('utf8');
      assert.ok(!/[^\r]\n/.test(t), `${e.name} uses CRLF`);
    }
    const cmd = entries.find((e) => e.name.endsWith('start-vortex.cmd'))!.data.toString();
    assert.match(cmd, /node src\\server\.js %VORTEX_ARGS% %\*/);
    assert.match(cmd, /node src\\doctor\.js/);
    // extract and start the packaged recorder
    const dir = path.join(tmp, 'x');
    for (const e of entries) {
      const f = path.join(dir, e.name);
      assert.ok(path.resolve(f).startsWith(path.resolve(dir) + path.sep));
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, e.data);
    }
    const app = path.join(dir, `vortex-android-recorder-${version}`);
    assert.ok(!fs.existsSync(path.join(app, 'node_modules')));
    const srvScript = path.join(app, 'src', 'server.js');
    const state = path.join(tmp, 'state');
    const out = path.join(tmp, 'out');
    const { spawn } = await import('node:child_process');
    // start the packaged server (not the repository's)
    const port = 4000 + Math.floor(Math.random() * 1000);
    const child = spawn(process.execPath, [srvScript, '--mock', '--no-open', '--port', String(port), '--state-dir', state, '--out', out], { stdio: 'ignore' });
    try {
      let ok = false;
      for (let i = 0; i < 100 && !ok; i++) {
        ok = await fetch(`http://localhost:${port}/api/config`).then((x) => x.ok).catch(() => false);
        if (!ok) await new Promise((x) => setTimeout(x, 100));
      }
      assert.ok(ok, 'packaged server started');
      const scr = await fetch(`http://localhost:${port}/api/screen`).then((x) => x.json()) as { device: string };
      assert.equal(scr.device, 'mock-device');
      const setup = await fetch(`http://localhost:${port}/api/setup`).then((x) => x.json()) as { mock: boolean; ready: { record: boolean }; checks: { id: string }[] };
      assert.equal(setup.mock, true);
      assert.equal(setup.ready.record, true);
      assert.ok(setup.checks.some((c: { id: string }) => c.id === 'node'));
      assert.equal((await fetch(`http://localhost:${port}/api/bench`).then((x) => x.json()) as { active: string | null }).active, null);
      const page = await fetch(`http://localhost:${port}/`).then((x) => x.text());
      for (const s of ['id="guide"', 'id="btnTools"', 'id="benchDlg"', 'id="setupDlg"']) assert.ok(page.includes(s), s);
    } finally {
      child.kill();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('setup check: CLI and API, read-only, mock-aware', async () => {
  const j = JSON.parse(execFileSync(process.execPath, [path.join(ROOT, 'src', 'doctor.js'), '--json'], { encoding: 'utf8', env: { ...process.env, PATH: process.env.PATH ?? '' } }));
  assert.equal(j.checks[0].id, 'node');
  assert.equal(j.checks[0].status, 'ok');
  for (const id of ['adb', 'mobilewright']) assert.ok(j.checks.some((c: { id: string }) => c.id === id), id);
  for (const c of j.checks) if (c.status !== 'ok' && c.status !== 'info') assert.ok(c.fix, `${c.id} says what to do`);
  const text = execFileSync(process.execPath, [path.join(ROOT, 'src', 'doctor.js')], { encoding: 'utf8' });
  assert.match(text, /^\[(OK  |WARN|MISS|INFO)\] Node\.js: v/m);
  assert.match(text, /Ready: recording (yes|no), MobileWright runs (yes|no)/);
  const state = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-setup-'));
  const srv = await startServer(state, state);
  try {
    const r = await srv.api('/api/setup');
    assert.equal(r.status, 200);
    assert.equal(r.body.mock, true);
    assert.equal(r.body.ready.record, true, 'mock mode needs no phone');
  } finally {
    await stopServer(srv.child);
    fs.rmSync(state, { recursive: true, force: true });
  }
});
