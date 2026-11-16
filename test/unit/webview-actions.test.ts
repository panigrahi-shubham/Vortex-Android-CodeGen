import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { createWebActionJournal, type WebActionRequest } from '../../src/webview-actions.ts';
import { callMobilecliRpc, createMobilecliRpc, mobilecliBinary } from '../../src/mobilecli-rpc.ts';

function request(body: Record<string, unknown> = {}): WebActionRequest {
  return { body: { requestId: randomUUID(), action: 'type', liveText: 'private-value-728', ...body }, appPackage: 'com.example.app', serial: 'phone-one',
    prepare: async () => ({ step: { id: randomUUID(), type: 'type', title: 'Password', secretEnv: 'VORTEX_SECRET_PASSWORD', args: {}, context: 'WEBVIEW' }, viewId: 'page', selector: '#password', expected: { url: 'https://example.test', tag: 'input', text: '', label: 'Password' } }),
    ready: async () => {}, invalidate() {}, dispatch: async () => ({ outcome: 'completed' }), observe: async () => ({ screen: 'updated' }) };
}
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-v5-'));

test('completed actions survive capture failure and request replay without repeating delivery or saving sensitive input', async () => {
  const dir = temp();
  try {
    const journal = createWebActionJournal(dir), req = request(); let dispatched = 0;
    req.dispatch = async (_prepared, value) => { assert.equal(value, 'private-value-728'); dispatched++; return { outcome: 'completed' }; };
    req.observe = async () => { throw Error('refresh failed'); };
    const first = await journal.execute(req);
    assert.equal(first.receipt.outcome, 'completed'); assert.equal(first.actionCompleted, true); assert.equal(first.needsRefresh, true);
    assert.match(String(first.warning), /do not repeat/);
    const duplicate = await journal.execute(req); assert.equal(duplicate.duplicate, true);
    const recovered = await createWebActionJournal(dir).execute(req); assert.equal(recovered.receipt.outcome, 'completed');
    assert.equal(dispatched, 1);
    const saved = fs.readFileSync(path.join(dir, 'webview-actions', req.body.requestId + '.json'), 'utf8');
    assert.ok(!saved.includes('private-value-728')); assert.ok(!JSON.stringify(first).includes('private-value-728'));
    assert.match(saved, /VORTEX_SECRET_PASSWORD/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('lost device responses and interrupted receipts remain unknown and are never automatically delivered again', async () => {
  const dir = temp();
  try {
    const journal = createWebActionJournal(dir), req = request(); let count = 0;
    req.dispatch = async () => { count++; throw Error('could include private-value-728'); };
    const result = await journal.execute(req); assert.equal(result.receipt.outcome, 'unknown'); assert.ok(!JSON.stringify(result).includes('private-value-728'));
    await journal.execute(req); assert.equal(count, 1);
    const interrupted = { ...result.receipt, requestId: randomUUID(), outcome: 'started' };
    fs.writeFileSync(path.join(dir, 'webview-actions', interrupted.requestId + '.json'), JSON.stringify(interrupted));
    const restarted = createWebActionJournal(dir);
    assert.equal(restarted.get(interrupted.requestId)?.outcome, 'unknown');
    await restarted.execute({ ...req, body: { ...req.body, requestId: interrupted.requestId } }); assert.equal(count, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('concurrent copies of an action ID dispatch once and preflight failures dispatch nothing', async () => {
  const dir = temp();
  try {
    const journal = createWebActionJournal(dir), req = request(); let count = 0;
    req.ready = async () => { await new Promise(resolve => setTimeout(resolve, 10)); };
    req.dispatch = async () => { count++; await new Promise(resolve => setTimeout(resolve, 10)); return { outcome: 'completed' }; };
    const results = await Promise.all([journal.execute(req), journal.execute(req)]);
    assert.equal(count, 1); assert.ok(results.some(r => r.duplicate === true));
    const invalid = request(); invalid.prepare = async () => { throw Error('stale'); }; invalid.dispatch = req.dispatch;
    await assert.rejects(journal.execute(invalid), /stale/); assert.equal(count, 1);
    await assert.rejects(journal.execute(request({ liveText: '' })), /Enter a value/);
    await assert.rejects(journal.execute(request({ requestId: '../escape' })), /request ID/);
    const notReady = request(); notReady.ready = async () => { throw Error('not ready'); }; notReady.dispatch = req.dispatch;
    await assert.rejects(journal.execute(notReady), /not ready/); assert.equal(count, 1);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an unwritable action journal prevents dispatch', async () => {
  const dir = temp();
  try {
    const blocker = path.join(dir, 'file'); fs.writeFileSync(blocker, 'not a directory');
    const journal = createWebActionJournal(blocker), req = request(); let called = false;
    req.dispatch = async () => { called = true; return { outcome: 'completed' }; };
    await assert.rejects(journal.execute(req)); assert.equal(called, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('loopback RPC uses request bodies and sanitizes untrusted device errors', async () => {
  const seen: Record<string, any>[] = [];
  const server = http.createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    const message = JSON.parse(text); seen.push(message);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, ...(message.method === 'error' ? { error: { message: 'private-value-728' } } : { result: { ok: true } }) }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/rpc`;
  try {
    assert.deepEqual(await callMobilecliRpc(endpoint, 'device.webview.evaluate', { deviceId: 'PhoneAlias', expression: 'private-value-728' }), { ok: true });
    assert.equal(seen[0].params.deviceId, 'PhoneAlias'); assert.equal(seen[0].params.expression, 'private-value-728');
    await assert.rejects(callMobilecliRpc(endpoint, 'error', {}), error => !String(error).includes('private-value-728'));
    await assert.rejects(callMobilecliRpc('http://example.test/rpc', 'error', {}), /loopback/);
    assert.throws(() => mobilecliBinary(null), /Install/);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});

test('owned Mobilecli transport starts and stops only its child process and can restart', async () => {
  const dir = temp();
  const script = path.join(dir, 'rpc.mjs');
  fs.writeFileSync(script, `import http from 'node:http';
const address=process.argv[process.argv.indexOf('--listen')+1].split(':');
http.createServer(async(req,res)=>{if(req.method==='GET'){res.end('ready');return;}let body='';for await(const c of req)body+=c;const m=JSON.parse(body);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{device:m.params.deviceId}}));}).listen(Number(address[1]),address[0]);`);
  const transport = createMobilecliRpc(() => ({ executable: process.execPath, prefixArgs: [script] }));
  try {
    await transport.ready(); assert.deepEqual(await transport.call('device.webview.list', { deviceId: 'one' }), { device: 'one' });
    await transport.close(); await assert.rejects(transport.call('device.webview.list', {}), /stopped/);
    await transport.ready(); assert.deepEqual(await transport.call('device.webview.list', { deviceId: 'two' }), { device: 'two' });
  } finally { await transport.close(); fs.rmSync(dir, { recursive: true, force: true }); }
});
