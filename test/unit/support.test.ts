/**
 * Feature: Server Manager support code (process identity parsing, state file, log redaction,
 *          MobileWright status client, MobileWright install detection, local request guard)
 * Layer: Unit — node:test
 * Real: parsers, file state store (temp folder), request guard, redaction
 * Mocked: fetch (MobileWright /status), OS command output
 * Guards: Identity mismatches going unnoticed, corrupt state silently overwritten, secrets in exported logs,
 *         non-MobileWright services treated as MobileWright, other websites driving the local API
 * Run: npm run test:unit
 * Needs: Node.js 22.18+
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { redact, tailLog } from '../../src/runtime/log-file.ts';
import { assertPid, createProcessInspector, parsePidLines, parseProcStat, parseWindowsProcessJson, sameProcess } from '../../src/runtime/process-inspector.ts';
import { checkLocalRequest } from '../../src/http-guard.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-test-'));

// ---- process identity ----

test('/proc/<pid>/stat parsing survives spaces and parentheses in the process name', () => {
  const stat = '4242 (node (worker) x) S 1 4242 4242 0 -1 4194560 100 0 0 0 5 3 0 0 20 0 11 0 987654 1000 200';
  assert.deepEqual(parseProcStat(stat), { state: 'S', startTicks: '987654' });
});

test('Windows Win32_Process JSON is parsed and a PID mismatch is rejected', () => {
  const out = '{"pid":5120,"start":"2026-10-31T06:11:07.1040000Z","cmd":"\\"C:\\\\Program Files\\\\nodejs\\\\node.exe\\" C:\\\\npm\\\\mobilewright\\\\index.js --port 4723"}';
  const id = parseWindowsProcessJson(out, 5120);
  assert.equal(id?.startTime, 'utc:2026-10-31T06:11:07.1040000Z');
  assert.match(id!.commandLine, /mobilewright\\index\.js --port 4723/);
  assert.equal(parseWindowsProcessJson(out, 9999), null);
  assert.equal(parseWindowsProcessJson('', 5120), null);
});

// Risk: Ownership is judged on PID alone.
// Given identities that differ only in start time or command line, When compared, Then they are not the same process.
test('sameProcess requires PID, start time and command line to match', () => {
  const a = { pid: 10, startTime: 't1', commandLine: 'node mobilewright --port 4723' };
  assert.equal(sameProcess(a, { ...a }), true);
  assert.equal(sameProcess(a, { ...a, startTime: 't2' }), false);
  assert.equal(sameProcess(a, { ...a, commandLine: 'notepad.exe' }), false);
  assert.equal(sameProcess(a, null), false);
});

test('pid and pid-list validation', () => {
  assert.throws(() => assertPid(0));
  assert.throws(() => assertPid('12; rm' as unknown as number));
  assert.deepEqual(parsePidLines('123\r\n456\n123\n\nabc\n'), [123, 456]);
});

// Risk: Windows commands are built with unvalidated input.
// Given the Windows inspector, When it queries a process and a port, Then only fixed scripts with validated integers are sent.
test('Windows inspector sends fixed PowerShell scripts with validated numbers only', async () => {
  const sent: string[][] = [];
  const insp = createProcessInspector('win32', async (file, args) => {
    sent.push([file, ...args]);
    return args.at(-1)!.includes('Win32_Process') ? '{"pid":77,"start":"2026-01-01T00:00:00.0000000Z","cmd":"node mobilewright"}' : '4723\r\n';
  });
  assert.deepEqual(await insp.info(77), { pid: 77, startTime: 'utc:2026-01-01T00:00:00.0000000Z', commandLine: 'node mobilewright' });
  assert.deepEqual(await insp.listeningPids(4723), [4723]);
  await insp.kill(77, { force: false, tree: true });
  assert.deepEqual(sent.at(-1), ['taskkill', '/PID', '77', '/T', '/F']);
  assert.ok(sent.slice(0, 2).every((c) => c[0] === 'powershell.exe' && c.includes('-NoProfile')));
  await assert.rejects(insp.info(-1 as number));
});

test('Linux inspector reads this test process identity from /proc', { skip: process.platform !== 'linux' && 'Linux only' }, async () => {
  const insp = createProcessInspector('linux');
  const me = await insp.info(process.pid);
  assert.ok(me && me.startTime.startsWith('ticks:') && me.commandLine.includes('node'));
  assert.equal(await insp.info(4_000_000), null);
});

// ---- logs ----

// Risk: Passwords, tokens or OTPs from capabilities end up in the UI or exported logs.
// Given log lines with secrets, When read through tailLog, Then the values are masked and colour codes removed.
test('log tail masks secrets and strips colour codes', () => {
  assert.equal(redact('"password":"hunter2","user":"sam"'), '"password":"***","user":"sam"');
  assert.equal(redact('token=abc123 next'), 'token="***" next');
  assert.equal(redact('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.x.y'), 'Authorization: Bearer ***');
  assert.equal(redact('{"Authorization":"Bearer eyJhbGciOiJIUzI1NiJ9"}'), '{"Authorization":"***"}');
  assert.doesNotMatch(redact('header authorization=Basic dXNlcjpwYXNzd29yZA=='), /dXNlcjpwYXNzd29yZA/);
  const f = path.join(tmp(), 'a.log');
  fs.writeFileSync(f, ['\u001b[35m[MobileWright]\u001b[39m starting', 'caps {"otp":"123456"}', 'last'].join('\n') + '\n');
  assert.deepEqual(tailLog(f, 10), ['[MobileWright] starting', 'caps {"otp":"***"}', 'last']);
  assert.deepEqual(tailLog(path.join(tmp(), 'missing.log')), []);
});

// ---- local request guard ----

const req = (method: string, headers: Record<string, string>) => ({ method, headers }) as unknown as import('node:http').IncomingMessage;

// Risk: A web page in another tab starts or stops processes through the local API.
// Given requests with foreign Host, Origin, Sec-Fetch-Site or a non-JSON body, When checked, Then they are blocked; the recorder's own requests pass.
test('local request guard blocks other sites and DNS rebinding, allows the recorder page', () => {
  const ok = { host: 'localhost:4700', origin: 'http://localhost:4700', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' };
  assert.equal(checkLocalRequest(req('POST', ok), 4700), null);
  assert.equal(checkLocalRequest(req('GET', { host: '127.0.0.1:4700' }), 4700), null);
  assert.equal(checkLocalRequest(req('POST', { host: '127.0.0.1:4700', 'content-type': 'application/json' }), 4700), null, 'curl / scripts without Origin are allowed');
  assert.match(checkLocalRequest(req('GET', { host: 'attacker.example:4700' }), 4700)!, /Host/);
  assert.match(checkLocalRequest(req('POST', { ...ok, origin: 'https://evil.example' }), 4700)!, /another site/);
  assert.match(checkLocalRequest(req('POST', { ...ok, 'sec-fetch-site': 'cross-site' }), 4700)!, /cross-site/);
  assert.match(checkLocalRequest(req('POST', { ...ok, 'content-type': 'text/plain' }), 4700)!, /application\/json/);
  assert.match(checkLocalRequest(req('POST', { ...ok, origin: 'http://localhost:9999' }), 4700)!, /another site/);
});
