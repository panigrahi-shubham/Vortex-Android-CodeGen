import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWebviewInspector, normalizeWebviews, pageIdentity, parseMobilecliReply, replayReference, runMobilecliRead } from '../../src/webview-inspector.ts';
import type { DomSnapshot } from '../../public/webview-dom.js';
import { generateMobilewrightPlain, generateMobilewrightPom } from '../../src/engines/mobilewright/ts-codegen.ts';
import { webSampleRecording } from '../support/sample-flow.ts';

const dom: DomSnapshot = { url: 'https://example.test/form', title: 'Form', capturedAt: new Date().toISOString(), viewport: { width: 400, height: 800 }, frames: 0, truncated: false, limitations: 'Top-level DOM',
  nodes: [{ id: '0', tag: 'input', text: '', label: 'Email', domId: 'email', role: '', editable: true, sensitive: false, enabled: true,
    selector: '#email', matches: 1, source: 'DOM id', alternatives: [], warnings: [], rect: { x: 10, y: 20, width: 200, height: 30 } }] };
const view = { id: 'web-1', url: dom.url, title: dom.title };

test('Mobilecli responses distinguish failure, empty pages, and ambiguous identities', () => {
  assert.deepEqual(parseMobilecliReply('{"status":"ok","data":[]}'), []);
  assert.throws(() => parseMobilecliReply('{"status":"error","error":"debugging unavailable"}'), /debugging unavailable/);
  assert.throws(() => parseMobilecliReply('not json'), /unreadable/);
  assert.deepEqual(normalizeWebviews(null), []);
  assert.throws(() => normalizeWebviews([view, view]), /ambiguous/);
  assert.equal(pageIdentity('https://user:password@example.test/form?token=secret#private'), 'https://example.test/form');
});

test('WebView mapping refuses guessed order and only records reliable native identities', () => {
  const bounds = { x: 0, y: 100, width: 400, height: 600 };
  const one = { ...view, bounds }, two = { id: 'web-2', title: 'Other', url: 'https://other.test', bounds: { ...bounds, y: 800 } };
  const native = [one, two].map((v, i) => ({ type: 'android.webkit.WebView', identifier: `app:id/web${i}`, rect: { x: v.bounds.x, y: v.bounds.y, w: v.bounds.width, h: v.bounds.height } }));
  assert.equal(replayReference(one, [one,two], native).ref?.testId, 'app:id/web0');
  assert.equal(replayReference(one, [two,one], native).ref, null);
  assert.equal(replayReference(view, [view,two], native).ref, null);
  assert.equal(replayReference(view, [view], []).ref?.count, 1);
  assert.equal(replayReference(view, [view], native).ref, null);
});

test('adding a DOM step revalidates the element, rejects stale screens and keeps secrets as references', async () => {
  let current = structuredClone(dom);
  const calls: string[][] = [];
  const inspector = createWebviewInspector(async args => { calls.push(args); return args[0] === 'list' ? [{ ...view, url: current.url }] : current; });
  const captured = await inspector.inspect(view.id, 'screen-one', []);
  await assert.rejects(inspector.step({ snapshotId: captured.snapshotId, nodeId: '0', action: 'tap' }, 'old-screen'), /changed/);
  const secret = await inspector.step({ snapshotId: captured.snapshotId, nodeId: '0', action: 'type', secretEnv: 'VORTEX_SECRET_EMAIL', text: 'never-store-me' }, 'screen-one');
  assert.equal(secret.secretEnv, 'VORTEX_SECRET_EMAIL');
  assert.equal(secret.args?.text, undefined);
  assert.ok(!JSON.stringify(secret).includes('never-store-me'));
  assert.equal(secret.webview?.url, dom.url);
  assert.ok(calls.every(args => ['list','eval'].includes(args[0])), 'inspection and recording never dispatch a device action');
  current.nodes[0].label = 'A different field';
  await assert.rejects(inspector.step({ snapshotId: captured.snapshotId, nodeId: '0', action: 'tap' }, 'screen-one'), /element changed/);
  current = structuredClone(dom); current.nodes[0].sensitive = true;
  const password = await inspector.inspect(view.id, 'screen-one', []);
  await assert.rejects(inspector.step({ snapshotId: password.snapshotId, nodeId: '0', action: 'type', text: 'raw-password' }, 'screen-one'), /environment variable/);
  current.url = 'https://example.test/other';
  await assert.rejects(inspector.step({ snapshotId: password.snapshotId, nodeId: '0', action: 'tap' }, 'screen-one'), /navigated/);
});

test('Plain and POM replay guard the selected WebView URL and reattach after recorded page changes', () => {
  for (const generate of [generateMobilewrightPlain,generateMobilewrightPom]) {
    const rec = webSampleRecording();
    rec.events[3].webview = { ...rec.events[3].webview!, url: 'https://insights.tradehub.example/confirmed' };
    const result = generate(rec, { caseSlug: 'guarded', size: rec.device.screen });
    assert.deepEqual(result.issues, []);
    const output = result.files.map(f => f.content).join('\n');
    assert.match(output, /WebView page differs from the recorded page/);
    assert.match(output, /inspectedPageUrl.pathname !== '\/confirmed'/);
  }
});


test('Mobilecli inspection uses the explicit device alias and argument arrays', async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-webview-cli-'));
  try {
    const entry = path.join(temp, 'cli.mjs');
    fs.writeFileSync(entry, "console.log(JSON.stringify({status:'ok',data:process.argv.slice(2)}))");
    assert.deepEqual(await runMobilecliRead(entry, 'DeviceAlias', ['list']), ['webview','list','--device','DeviceAlias']);
    assert.deepEqual(await runMobilecliRead(entry, 'DeviceAlias', ['eval','context;not-a-shell','({readOnly:true})']), ['webview','eval','--device','DeviceAlias','--','context;not-a-shell','({readOnly:true})']);
    await assert.rejects(runMobilecliRead(null, 'DeviceAlias', ['list']), /Install.*runner/);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
