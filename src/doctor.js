// Setup check ("doctor"): read-only checks of everything Vortex can use, each with what to do when it is missing.
// Nothing is installed, downloaded or changed. Plain JavaScript so it also runs on Node versions too old for the
// TypeScript modules (it then checks Node and adb and says why the rest was not checked).
//
// CLI: node src/doctor.js [--out <tests folder>] [--json]

import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const WIN = process.platform === 'win32';

function run(cmd, args, timeoutMs = 10_000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { encoding: 'utf8', windowsHide: true, timeout: timeoutMs }, (err, stdout, stderr) => {
      resolve({ ok: !err, missing: err?.code === 'ENOENT', out: `${stdout || ''}${stderr || ''}`.trim() });
    });
  });
}

export function nodeSupportsTs(v = process.versions.node) {
  const [maj, min] = v.split('.').map(Number);
  return maj > 22 || (maj === 22 && min >= 18);
}

/**
 * @param {{ outDir?: string, mock?: boolean }} o
 * @returns {Promise<{ checks: { id: string, name: string, status: 'ok'|'warn'|'missing'|'info', detail: string, fix: string|null, needed: string }[], ready: { record: boolean, mobilewright: boolean } }>}
 */
export async function runChecks(o = {}) {
  const checks = [];
  const add = (id, name, status, detail, fix, needed) => checks.push({ id, name, status, detail, fix: fix || null, needed });

  const tsOk = nodeSupportsTs();
  add('node', 'Node.js', tsOk ? 'ok' : 'warn', `v${process.versions.node}${tsOk ? '' : ' (22.18 or newer needed for runs, reports and benchmarks)'}`,
    tsOk ? null : 'Install Node.js 24 LTS from nodejs.org (or `winget install OpenJS.NodeJS.LTS`), then reopen the terminal.', 'everything');

  const adb = await run('adb', ['version']);
  let devices = [];
  if (adb.ok) {
    add('adb', 'ADB (Android platform-tools)', 'ok', (adb.out.split('\n')[0] || 'adb').trim(), null, 'recording and runs');
    const d = await run('adb', ['devices']);
    devices = d.out.split('\n').slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p.length >= 2 && p[0]);
    const ready = devices.filter((p) => p[1] === 'device');
    const unauth = devices.filter((p) => p[1] === 'unauthorized');
    if (ready.length) add('device', 'Phone', 'ok', ready.map((p) => p[0]).join(', '), null, 'recording and runs');
    else if (unauth.length) add('device', 'Phone', 'warn', `${unauth.map((p) => p[0]).join(', ')}: unauthorized`, 'Unlock the phone and accept the "Allow USB debugging" prompt.', 'recording and runs');
    else add('device', 'Phone', 'missing', 'no device connected', 'Connect the phone with USB, turn on Developer options > USB debugging (you do this on the phone; Vortex never changes developer settings), then Refresh.', 'recording and runs');
  } else {
    add('adb', 'ADB (Android platform-tools)', 'missing', adb.missing ? 'adb is not on PATH' : adb.out.slice(0, 200),
      WIN ? 'Install Android platform-tools (`winget install Google.PlatformTools`, or unzip platform-tools and add its folder to PATH), then reopen the terminal.' : 'Install Android platform-tools and add it to PATH.', 'recording and runs');
  }

  if (!tsOk) {
    add('rest', 'MobileWright', 'info', 'not checked: needs Node.js 22.18 or newer', null, '');
    return finish(checks, o.mock);
  }

  // The checks below reuse the same detection code the runners use.
  const imp = (p) => import(pathToFileURL(path.join(ROOT, p)).href);
  try {
    const { detectMobilewright } = await imp('src/engines/mobilewright/runner.ts');
    const out = o.outDir || path.join(ROOT, 'generated');
    const m = detectMobilewright(out);
    add('mobilewright', 'MobileWright', m.ok ? 'ok' : 'warn', m.ok ? `${m.version ?? ''} (${m.projectDir})` : m.problems.join(' '), m.ok ? null : m.installCommand || 'Point the output folder at your MobileWright project (it needs node_modules/@mobilewright/test).', 'MobileWright runs');
  } catch (e) {
    add('mobilewright', 'MobileWright', 'warn', String(e.message || e), null, 'MobileWright runs');
  }
  return finish(checks, o.mock);
}

function finish(checks, mock = false) {
  const ok = (id) => checks.find((c) => c.id === id)?.status === 'ok';
  // Mock mode supplies its own phone data, so adb and a connected device are not needed.
  if (mock) return { checks, ready: { record: true, mobilewright: ok('node') && ok('mobilewright') } };
  return {
    checks,
    ready: {
      record: ok('adb') && ok('device'),
      mobilewright: ok('node') && ok('adb') && ok('mobilewright'),
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const i = args.indexOf('--out');
  const r = await runChecks({ outDir: i >= 0 ? args[i + 1] : undefined });
  if (args.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    const mark = { ok: 'OK  ', warn: 'WARN', missing: 'MISS', info: 'INFO' };
    for (const c of r.checks) {
      console.log(`[${mark[c.status]}] ${c.name}: ${c.detail}`);
      if (c.fix && c.status !== 'ok') console.log(`       -> ${c.fix}`);
    }
    console.log(`\nReady: recording ${r.ready.record ? 'yes' : 'no'}, MobileWright runs ${r.ready.mobilewright ? 'yes' : 'no'}`);
  }
}
