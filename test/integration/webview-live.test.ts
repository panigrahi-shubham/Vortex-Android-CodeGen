import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { performDomAction } from '../../public/webview-action.js';
import { collectDomSnapshot } from '../../public/webview-dom.js';
import { loadPlaywright } from '../fixtures/webview-host.mjs';
import { startServer, stopServer } from '../support/server.ts';
const pw = loadPlaywright() as any;
const mw = process.env.VORTEX_MOBILEWRIGHT_DIR;

test('live DOM dispatch replaces text using native setters and rejects stale, covered and ambiguous targets', { skip: !pw ? 'Playwright unavailable' : false }, async () => {
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<label for="name">Name</label><input id="name"><button id="go" onclick="window.taps=(window.taps||0)+1">Go</button><button>Other</button><div id="cover" style="display:none;position:fixed;inset:0;background:white;z-index:100"></div>');
    const dom = await page.evaluate(collectDomSnapshot);
    const node = dom.nodes.find((n: { domId: string }) => n.domId === 'name');
    const command = { action: 'type', selector: node.selector, url: dom.url, tag: node.tag, text: node.text, label: node.label, value: 'replacement' };
    await page.evaluate("window.events=0;window.tracker=0;const input=document.querySelector('#name');const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');Object.defineProperty(input,'value',{get(){return descriptor.get.call(this)},set(v){window.tracker++;descriptor.set.call(this,v)}});input.addEventListener('input',()=>window.events++);");
    assert.equal((await page.evaluate(performDomAction, command)).outcome, 'completed');
    assert.equal(await page.locator('#name').inputValue(), 'replacement');
    assert.equal(await page.evaluate('window.events'), 1); assert.equal(await page.evaluate('window.tracker'), 0);
    assert.equal((await page.evaluate(performDomAction, { ...command, action: 'clear', value: '' })).outcome, 'completed');
    assert.equal(await page.locator('#name').inputValue(), '');
    await page.locator('#name').evaluate((el: { readOnly: boolean }) => { el.readOnly = true; });
    assert.equal((await page.evaluate(performDomAction, command)).code, 'NOT_EDITABLE');
    const button = dom.nodes.find((n: { domId: string }) => n.domId === 'go');
    const tap = { action: 'tap', selector: button.selector, url: dom.url, tag: button.tag, text: button.text, label: button.label };
    assert.equal((await page.evaluate(performDomAction, { ...tap, selector: 'button' })).code, 'AMBIGUOUS_ELEMENT');
    await page.locator('#cover').evaluate((el: { style: { display: string } }) => { el.style.display = 'block'; });
    assert.equal((await page.evaluate(performDomAction, tap)).code, 'ELEMENT_COVERED');
    assert.equal(await page.evaluate('window.taps || 0'), 0);
    await page.locator('#cover').evaluate((el: { style: { display: string } }) => { el.style.display = 'none'; });
    assert.equal((await page.evaluate(performDomAction, { ...tap, url: 'https://wrong.test' })).code, 'PAGE_CHANGED');
    await page.locator('body').evaluate((el: { style: { opacity: string } }) => { el.style.opacity = '0'; });
    assert.equal((await page.evaluate(performDomAction, tap)).code, 'ELEMENT_HIDDEN');
    await page.locator('body').evaluate((el: { style: { opacity: string } }) => { el.style.opacity = '1'; });
    assert.equal((await page.evaluate(performDomAction, tap)).outcome, 'completed');
    assert.equal(await page.evaluate('window.taps'), 1);
  } finally { await browser.close(); }
});

test('V5 browser runs and records actions, recovers a lost response once, and replays Plain/POM', { timeout: 150_000, skip: !pw || !mw ? 'Playwright and MobileWright required' : false }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-v5-live-'));
  const out = fs.mkdtempSync(path.join(mw!, '.vortex-v5-live-'));
  const privateValue = 'private-value-728@example.test';
  const srv = await startServer(path.join(tmp, 'state'), out, { VORTEX_SECRET_LOGIN: privateValue });
  let browser: any;
  try {
    browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    const liveRequests: Record<string, unknown>[] = [];
    page.on('request', (req: { url(): string; postDataJSON(): Record<string, unknown> }) => { if (req.url().endsWith('/api/webviews/execute')) liveRequests.push(req.postDataJSON()); });
    await page.goto(srv.base);
    await page.locator('#inspectSearch').fill('home_market_card'); await page.locator('#inspectList button').first().click(); await page.locator('[data-ins-action="tap"]').click();
    const count = async (n: number) => page.waitForFunction(`document.querySelectorAll('#steps .step').length===${n}`);
    await count(1);
    await page.locator('#btnWebview').click(); await page.waitForFunction("document.querySelectorAll('#wvPages option').length===2");
    await page.locator('#wvPages').selectOption('sample-insights'); await page.locator('#wvInspect').click(); await page.locator('#wvNodes button').first().waitFor();
    await page.locator('#wvExecution').selectOption('live');
    const choose = async (query: string, nth = 0) => { await page.locator('#wvSearch').fill(query); await page.locator('#wvNodes button').nth(nth).click(); };
    await choose('subscribe-email');
    await page.locator('#wvSecretEnv').fill('VORTEX_SECRET_LOGIN'); await page.locator('#wvLiveInput').fill(privateValue);
    await page.locator('[data-wv-action="type"]').click(); await count(2);
    assert.equal(await page.locator('#wvLiveInput').inputValue(), '');
    await choose('subscribe-email'); await page.locator('[data-wv-action="clear"]').click(); await count(3);
    await choose('subscribe-email'); await page.locator('#wvSensitive').uncheck(); await page.locator('#wvInput').fill('buyer@example.com');
    await page.locator('[data-wv-action="type"]').click(); await count(4);
    await choose('subscribe-btn');
    await page.locator('[data-wv-action="tap"]').evaluate((button: { click(): void }) => { button.click(); button.click(); });
    await count(5);
    assert.equal(liveRequests.length, 4, 'double click sends one live request');
    await choose('#status');
    assert.match(await page.locator('#wvDetails').innerText(), /Subscribed: buyer@example.com/);
    await page.locator('#wvAssertion').selectOption('contains'); await page.locator('#wvExpected').fill('Subscribed:'); await page.locator('[data-wv-action="assert"]').click(); await count(6);
    // Abort the browser response after the server has executed and saved the receipt.
    await page.route('**/api/webviews/execute', async (route: any) => { await route.fetch(); await route.abort('failed'); });
    await choose('Watch', 1); await page.locator('[data-wv-action="tap"]').click();
    await page.waitForFunction("!!localStorage.getItem('vortex.webview.pendingAction') && !document.querySelector('#wvRecoverAction').disabled");
    assert.equal(await page.locator('#steps .step').count(), 6);
    const lostRequest = liveRequests[liveRequests.length - 1];
    await page.unroute('**/api/webviews/execute');
    await page.locator('#wvRecoverAction').click(); await count(7);
    assert.equal(await page.evaluate("localStorage.getItem('vortex.webview.pendingAction')"), null);
    const duplicate = await srv.api('/api/webviews/execute', lostRequest);
    assert.equal(duplicate.body.duplicate, true); assert.equal(duplicate.body.receipt.outcome, 'completed');
    await page.locator('#wvInspect').click(); await page.locator('#wvSearch').fill('Watching'); await page.locator('#wvNodes button').first().click();
    assert.match(await page.locator('#wvDetails').innerText(), /Watching/, 'recovery and duplicate request did not toggle the button twice');
    await page.locator('#wvAssertion').selectOption('text'); await page.locator('#wvExpected').fill('Watching'); await page.locator('[data-wv-action="assert"]').click(); await count(8);
    await page.screenshot({ path: '/tmp/vortex-v5-live.png', fullPage: true });
    await page.locator('#wvDlg [data-close]').click();
    await page.locator('#tname').fill('live subscribe'); await page.locator('#tmodule').fill('v5');
    await page.locator('#mode').selectOption('both'); await page.locator('#target').selectOption('pom'); await page.locator('#btnSave').click();
    await page.waitForFunction("document.querySelector('#saveDlg').open");
    const recording = (await srv.api('/api/project/recording?module=v5&case=live-subscribe')).body.recording;
    assert.ok(!JSON.stringify(recording).includes(privateValue)); assert.equal(recording.events[1].input.secretEnv, 'VORTEX_SECRET_LOGIN');
    const receipts = fs.readdirSync(path.join(tmp, 'state', 'webview-actions')).map(name => fs.readFileSync(path.join(tmp, 'state', 'webview-actions', name), 'utf8')).join('\n');
    assert.ok(!receipts.includes(privateValue)); assert.ok(!srv.log().includes(privateValue));
    for (const variant of ['plain','pom']) {
      const started = await srv.api('/api/runs', { engine: 'mobilewright', scope: 'case', module: 'v5', case: 'live-subscribe', variant });
      assert.equal(started.status, 200, JSON.stringify(started.body));
      let result;
      for (let attempt = 0; attempt < 300; attempt++) { result = (await srv.api('/api/runs/' + started.body.id)).body; if (!['queued','running'].includes(result.status)) break; await new Promise(resolve => setTimeout(resolve, 100)); }
      assert.equal(result.status, 'passed', JSON.stringify(result));
    }
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close(); await stopServer(srv.child);
    fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true });
  }
});
