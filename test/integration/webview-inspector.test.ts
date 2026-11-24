import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { toUiSteps } from '../../src/model/recording.ts';
import { collectDomSnapshot } from '../../public/webview-dom.js';
import { loadPlaywright } from '../fixtures/webview-host.mjs';
import { startServer, stopServer } from '../support/server.ts';
const pw = loadPlaywright() as any;
const mw = process.env.VORTEX_MOBILEWRIGHT_DIR;

test('DOM collection reports real selector matches, hides field values, and labels iframe limits', { skip: !pw ? 'Playwright unavailable' : false }, async () => {
  const browser = await pw.chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent('<label for="email">Email</label><input id="email" data-testid="email" value="private@example.test"><input type="password" value="password-never-collect"><textarea>private-textarea-content</textarea><button data-testid="duplicate">First</button><button data-testid="duplicate">Second</button><button style="display:none" id="invisible">Hidden</button><iframe srcdoc="<button id=frame-only>Frame button</button>"></iframe>');
    const snapshot = await page.evaluate(collectDomSnapshot);
    const serialized = JSON.stringify(snapshot);
    for (const secret of ['private@example.test','password-never-collect','private-textarea-content']) assert.ok(!serialized.includes(secret));
    assert.ok(!snapshot.nodes.some((n: { domId: string }) => ['invisible','frame-only'].includes(n.domId)));
    assert.equal(snapshot.frames, 1);
    const email = snapshot.nodes.find((n: { domId: string }) => n.domId === 'email');
    assert.equal(email.selector, '[data-testid="email"]'); assert.equal(email.matches, 1);
    const duplicate = snapshot.nodes.find((n: { text: string }) => n.text === 'First');
    assert.ok(duplicate.warnings.length > 0); assert.equal(duplicate.matches, 1);
    assert.equal(duplicate.alternatives.find((a: { selector: string }) => a.selector === '[data-testid="duplicate"]').matches, 2);
    await page.setContent(`
      <section data-product-id="first"><div aria-label="product-card-context-menu">⋮</div></section>
      <section data-product-id="second"><div aria-label="product-card-context-menu">⋮</div></section>
      <div aria-label="unscoped-menu">⋮</div><div aria-label="unscoped-menu">⋮</div>
    `);
    const menus = (await page.evaluate(collectDomSnapshot)).nodes;
    const first = menus.find((n: { selector: string }) => n.selector.startsWith('[data-product-id="first"]'));
    assert.equal(first.source, 'Scoped DOM attribute');
    assert.equal(first.matches, 1);
    assert.equal(menus.find((n: { label: string }) => n.label === 'unscoped-menu').matches, 2);
    await page.evaluate("document.body.prepend(document.querySelector('[data-product-id=second]'))");
    assert.equal(await page.locator(first.selector).locator('..').getAttribute('data-product-id'), 'first');
    assert.match(snapshot.limitations, /CSS pixels/);
  } finally { await browser.close(); }
});

test('browser records a visual tap and DOM steps, saves and replays Plain and POM', { timeout: 120_000, skip: !pw || !mw ? 'Playwright and MobileWright required' : false }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vortex-v4-dom-'));
  const out = fs.mkdtempSync(path.join(mw!, '.vortex-v4-dom-'));
  const srv = await startServer(path.join(tmp, 'state'), out);
  let browser: any;
  try {
    assert.deepEqual((await srv.api('/api/webviews')).body.pages, []);
    browser = await pw.chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1800, height: 1200 } });
    const errors: string[] = []; page.on('pageerror', (e: Error) => errors.push(e.message));
    await page.goto(srv.base);
    await page.locator('#btnWebview').click();
    await page.locator('#wvVisual').click();
    assert.equal(await page.locator('#tapStyle').inputValue(), 'visual');
    await page.waitForFunction("document.querySelector('#shot').complete && document.querySelector('#shot').naturalWidth > 0");
    const shot = await page.locator('#shot').boundingBox();
    await page.locator('#ov').click({ position: { x: 320 / 1080 * shot.width, y: 589 / 2400 * shot.height } });
    await page.waitForFunction("document.querySelectorAll('#steps .step').length===1");
    assert.match(await page.locator('#step-0').innerText(), /visual/i);
    await page.locator('#btnWebview').click();
    await page.waitForFunction("document.querySelectorAll('#wvPages option').length===2");
    await page.locator('#wvPages').selectOption('sample-insights');
    await page.locator('#wvInspect').click();
    await page.locator('#wvNodes button').first().waitFor();
    const choose = async (q: string) => {
      await page.locator('#wvSearch').fill(q);
      await page.locator('#wvNodes button').first().click();
    };
    await choose('subscribe-email');
    await page.locator('#wvSensitive').uncheck();
    await page.locator('#wvInput').fill('buyer@example.com');
    await page.locator('[data-wv-action="type"]').click();
    await page.waitForFunction("document.querySelectorAll('#steps .step').length===2");
    await choose('subscribe-btn');
    await page.locator('[data-wv-action="tap"]').click();
    await page.waitForFunction("document.querySelectorAll('#steps .step').length===3");
    await choose('#status');
    await page.locator('#wvAssertion').selectOption('text');
    await page.locator('#wvExpected').fill('Subscribed: buyer@example.com');
    await page.locator('[data-wv-action="assert"]').click();
    await page.waitForFunction("document.querySelectorAll('#steps .step').length===4");
    await page.screenshot({ path: '/tmp/vortex-v4-webview.png', fullPage: true });
    await page.locator('#wvDlg [data-close]').click();
    await page.locator('#tname').fill('dom subscribe'); await page.locator('#tmodule').fill('v4');
    await page.locator('#mode').selectOption('both'); await page.locator('#target').selectOption('pom');
    await page.locator('#btnSave').click();
    await page.waitForFunction("document.querySelector('#saveDlg').open");
    const saved = (await srv.api('/api/project/recording?module=v4&case=dom-subscribe')).body;
    const { recording, assets } = saved;
    assert.equal((await srv.api('/api/generate', { steps: toUiSteps(recording), name: 'legacy web', pkg: recording.app.package })).status, 422);
    assert.ok(recording.events[0].visualTarget);
    assert.equal(assets.length, 1);
    assert.equal(recording.events.filter((e: { context: string }) => e.context === 'WEBVIEW').length, 3);
    assert.ok(recording.events[1].target.parts.value.includes('subscribe-email'));
    // Inspection and adding steps have not filled or submitted the real mock DOM.
    const inspected = (await srv.api('/api/webviews/inspect', { id: 'sample-insights' })).body;
    assert.equal(inspected.dom.nodes.find((n: { domId: string }) => n.domId === 'status').text, '');
    const stale = await srv.api('/api/webviews/step', { snapshotId: inspected.snapshotId, nodeId: '0', action: 'tap' });
    assert.equal(stale.status, 200);
    await srv.api('/api/screen');
    assert.equal((await srv.api('/api/webviews/step', { snapshotId: inspected.snapshotId, nodeId: '0', action: 'tap' })).status, 409);
    for (const variant of ['plain','pom']) {
      const started = await srv.api('/api/runs', { engine: 'mobilewright', scope: 'case', module: 'v4', case: 'dom-subscribe', variant });
      assert.equal(started.status, 200, JSON.stringify(started.body));
      let result;
      for (let attempt = 0; attempt < 200; attempt++) {
        result = (await srv.api('/api/runs/' + started.body.id)).body;
        if (!['queued','running'].includes(result.status)) break;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      assert.equal(result.status, 'passed', JSON.stringify(result));
    }
    const wrongSteps = toUiSteps(recording);
    for (const step of wrongSteps) if (step.webview) step.webview.url = 'https://insights.tradehub.example/wrong-page';
    const wrongCase = { steps: wrongSteps, name: 'wrong context', module: 'v4', pkg: recording.app.package, frameworks: ['mobilewright'], mode: 'plain' };
    assert.equal((await srv.api('/api/project/save', wrongCase)).body.code, 'MISSING_TEMPLATE');
    assert.equal((await srv.api('/api/project/save', { ...wrongCase, assets })).status, 200);
    const wrongRun = await srv.api('/api/runs', { engine: 'mobilewright', scope: 'case', module: 'v4', case: 'wrong-context' });
    assert.equal(wrongRun.status, 200);
    let rejected;
    for (let attempt = 0; attempt < 200; attempt++) {
      rejected = (await srv.api('/api/runs/' + wrongRun.body.id)).body;
      if (!['queued','running'].includes(rejected.status)) break;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
    assert.equal(rejected.status, 'failed');
    assert.match(JSON.stringify(rejected), /WebView page differs from the recorded page/);
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    await stopServer(srv.child); fs.rmSync(tmp, { recursive: true, force: true }); fs.rmSync(out, { recursive: true, force: true });
  }
});
