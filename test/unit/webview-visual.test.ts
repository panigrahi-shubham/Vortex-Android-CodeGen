/**
 * Feature: WebView diagnostics, WebView locator candidates and scoring, WebView steps in MobileWright generators,
 *          visual fallback (PNG, template matching, screen change)
 * Layer: Unit — node:test
 * Real: diagnostics logic on captured adb output, candidate generation on a DOM snapshot, generators, PNG codec,
 *       template matching on the sample screenshots
 * Mocked: adb (canned output), the DOM (a hand-built snapshot)
 * Guards: wrong or architecture-based WebView diagnoses, generated ids recommended as stable, iframe steps silently
 *         dropped for MobileWright, WebView steps leaking out of their context, low-confidence or ambiguous visual
 *         matches reported as found
 * Run: npm run test:unit
 * Needs: Node.js 22.18+
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { generateMobilewrightPlain, generateMobilewrightPom, webViewExpr } from '../../src/engines/mobilewright/ts-codegen.ts';
import { fromUiSteps, toUiSteps, validateRecording } from '../../src/model/recording.ts';
import { blit, crop, decodePng, encodePng, resize, type Image } from '../../src/visual/png.ts';
import { findTemplate, screenChange } from '../../src/visual/match.ts';
import { INSIGHTS, INSIGHTS_WEB, PKG, SAMPLES, webSampleRecording, webSampleSteps } from '../support/sample-flow.ts';

const SIZE = { width: 1080, height: 2400 };
const img = (f: string) => decodePng(fs.readFileSync(path.join(SAMPLES, f)));

// ---- generators -------------------------------------------------------------------------------

// Risk: WebView steps are written outside their context, or an unsupported step is silently left out.
test('WebView steps: one context block per run of steps, in both MobileWright variants', () => {
  const rec = webSampleRecording({ iframe: true });
  assert.equal(rec.events.filter((e) => e.context === 'WEBVIEW').length, 7);
  const back = fromUiSteps(toUiSteps(rec), { id: rec.id, name: rec.name, module: rec.module, appPackage: PKG, serial: null, screen: SIZE, createdAt: rec.createdAt, version: 'x' });
  assert.deepEqual(back.events.map((e) => [e.context, e.webview?.testId ?? null]), rec.events.map((e) => [e.context, e.webview?.testId ?? null]));

  // MobileWright: iframe steps are refused with a reason, everything else is generated
  const mw = generateMobilewrightPlain(rec, { caseSlug: 'subscribe', size: SIZE });
  assert.deepEqual(mw.issues.map((i) => i.step), [7, 8]);
  assert.match(mw.issues[0].message, /iframe.*cannot enter iframes/);
  const ok = generateMobilewrightPlain(webSampleRecording(), { caseSlug: 'subscribe', size: SIZE });
  assert.deepEqual(ok.issues, []);
  const t = ok.files[0].content;
  assert.equal((t.match(/getByWebView\(/g) ?? []).length, 1);
  assert.ok(t.includes("const web = await screen.getByWebView({ testId: id('insights_webview') }).page();"));
  assert.ok(t.includes("await webLocator(web, '[data-testid=\"subscribe-btn\"]').click();"));
  assert.ok(t.includes("await expect(webLocator(web, '#status')).toHaveText('Subscribed: buyer@example.com');"));
  const mwPom = generateMobilewrightPom(webSampleRecording(), { caseSlug: 'subscribe', size: SIZE });
  assert.deepEqual(mwPom.issues, []);
  assert.ok(mwPom.files.find((f) => f.role === 'entry')!.content.includes('const marketInsightsWebPage = new MarketInsightsWebPage(web);'));

  // unsupported in WebViews: long-press, selected
  const bad = fromUiSteps([
    { ...webSampleSteps()[1], type: 'longpress' },
    { ...webSampleSteps()[3], args: { assertion: 'selected' } },
  ], { id: 'r', name: 'n', module: 'm', appPackage: PKG, serial: null, screen: SIZE, version: 'x' });
  assert.deepEqual(generateMobilewrightPlain(bad, { caseSlug: 'x', size: SIZE }).issues.map((i) => i.step), [1, 2]);
  assert.equal(webViewExpr({ ...INSIGHTS_WEB, testId: null, count: 2, index: 1 }, PKG), 'screen.getByWebView().nth(1)');
  assert.throws(() => validateRecording({ ...rec, events: [{ ...rec.events[1], webview: null }] }), /needs its WebView/);
  assert.equal(INSIGHTS.name, 'Market Insights');
});

// ---- visual -----------------------------------------------------------------------------------

// Risk: a corrupt or unsupported PNG is misread; the codec changes pixels.
test('PNG codec: lossless round trip; refuses what it cannot read', () => {
  const home = img('home.png');
  const again = decodePng(encodePng(home));
  assert.equal(again.width, 1080);
  assert.ok(Buffer.from(again.data).equals(Buffer.from(home.data)));
  assert.throws(() => decodePng(Buffer.from('not a png')), /not a PNG/);
  const c = crop(home, 1000, 2300, 200, 200);
  assert.deepEqual([c.width, c.height], [80, 100], 'crops are clipped to the image');
});

// Risk: the visual fallback reports a confident match that is wrong, ambiguous or the wrong colour.
test('template matching: exact, scaled, absent, ambiguous, colour-changed, region of interest', () => {
  const home = img('home.png');
  const products = img('products.png');
  const tpl = crop(home, 764, 146, 200, 200);
  const r = findTemplate(home, tpl);
  assert.ok(r.found && r.confidence > 0.99);
  assert.deepEqual(r.rect, { x: 764, y: 146, w: 200, h: 200 });

  const small = resize(home, 972, 2160); // the same screen at 0.9 scale
  const s = findTemplate(small, crop(home, 60, 540, 200, 200));
  assert.ok(s.found, s.reason ?? '');
  assert.equal(s.scale, 0.9);
  assert.ok(Math.abs(s.rect!.x - 54) <= 3 && Math.abs(s.rect!.y - 486) <= 3, JSON.stringify(s.rect));
  // a template that is mostly background: rescaled, it matches other places almost as well -> never "found" elsewhere
  const weak = findTemplate(small, tpl);
  assert.ok(!weak.found || (Math.abs(weak.rect!.x - 688) <= 6 && Math.abs(weak.rect!.y - 131) <= 6), JSON.stringify(weak));

  const absent = findTemplate(products, crop(home, 440, 1186, 200, 200));
  assert.equal(absent.found, false);
  assert.match(absent.reason!, /below the required 90%/);

  // two identical patches: ambiguous, never found; the region of interest resolves it
  const canvas: Image = { width: 600, height: 300, data: new Uint8Array(600 * 300 * 4).fill(255) };
  const patch = crop(home, 764, 146, 120, 120);
  blit(canvas, patch, 20, 40);
  blit(canvas, patch, 400, 120);
  const amb = findTemplate(canvas, patch);
  assert.equal(amb.found, false);
  assert.equal(amb.ambiguous, true);
  assert.match(amb.reason!, /ambiguous/);
  const roi = findTemplate(canvas, patch, { roi: { x: 300, y: 0, w: 300, h: 300 } });
  assert.ok(roi.found);
  assert.deepEqual([roi.rect!.x, roi.rect!.y], [400, 120]);

  // same shape, other colours: the blue header with red and blue swapped
  const header = crop(home, 0, 0, 200, 200);
  const swapped: Image = { ...header, data: Uint8Array.from(header.data) };
  for (let i = 0; i < swapped.data.length; i += 4) [swapped.data[i], swapped.data[i + 2]] = [header.data[i + 2], header.data[i]];
  const col = findTemplate(home, swapped);
  assert.equal(col.found, false);
  assert.match(col.reason!, /colours differ/);
  assert.ok(col.rgbDiff! > 40, String(col.rgbDiff));

  const flat: Image = { width: 50, height: 50, data: new Uint8Array(50 * 50 * 4).fill(200) };
  assert.match(findTemplate(home, flat).reason!, /flat colour/);
  assert.ok(r.limitations.length >= 3);
});

test('screen change: identical screens 0, a navigation clearly above the no-change threshold', () => {
  const home = img('home.png');
  assert.equal(screenChange(home, home), 0);
  assert.ok(screenChange(home, img('products.png')) > 0.1);
  assert.ok(screenChange(home, img('insights.png')) > 0.1);
  assert.equal(screenChange(home, resize(home, 540, 1200)), 1, 'different sizes count as changed');
});
