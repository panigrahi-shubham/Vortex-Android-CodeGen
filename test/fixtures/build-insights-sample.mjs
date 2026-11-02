// Builds samples/insights.json and samples/insights.png (the "Market Insights" screen of the synthetic TradeHub
// app: a native toolbar and a WebView showing samples/insights.html). Run once after changing the page:
//   node test/fixtures/build-insights-sample.mjs
// The native tree exposes the web content the way Android accessibility typically does: texts and controls
// without resource ids, which is exactly why DOM inspection is needed.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { blit, crop, decodePng, encodePng } from '../../src/visual/png.ts';
import { loadPlaywright, openWebView, WEBVIEW } from './webview-host.mjs';

const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'samples');
const PKG = 'com.yourname.tradehub';
const wv = await openWebView(SAMPLES);
const shot = decodePng(await wv.page.screenshot());
// DOM elements that accessibility exposes as native nodes
const items = await wv.page.evaluate(() => {
  const out = [];
  const add = (el, type, text, extra = {}) => {
    const r = el.getBoundingClientRect();
    if (r.width && r.height) out.push({ type, text, x: r.left, y: r.top, w: r.width, h: r.height, ...extra });
  };
  add(document.querySelector('h1'), 'android.widget.TextView', 'Metal rates today');
  add(document.querySelector('.sub'), 'android.widget.TextView', 'Synthetic demo data');
  document.querySelectorAll('.rate-row').forEach((row) => {
    add(row.querySelector('.name'), 'android.widget.TextView', row.querySelector('.name').textContent);
    add(row.querySelector('.price'), 'android.widget.TextView', row.querySelector('.price').textContent);
    add(row.querySelector('.watch'), 'android.widget.Button', 'Watch');
  });
  add(document.querySelector('label[for=email]'), 'android.widget.TextView', 'Email for daily rates');
  add(document.querySelector('#email'), 'android.widget.EditText', '', { placeholder: 'you@example.com' });
  add(document.querySelector('button[type=submit]'), 'android.widget.Button', 'Subscribe');
  add(document.querySelector('#alerts-frame'), 'android.view.View', '', { label: 'Price alerts' });
  return out;
});
const s = WEBVIEW.dpr;
const B = WEBVIEW.nativeBounds;
const px = (it) => ({ x: Math.round(B.x + it.x * s), y: Math.round(B.y + it.y * s), width: Math.round(it.w * s), height: Math.round(it.h * s) });
let ref = 200;
const node = (o) => ({ ref: `@e${ref++}`, text: '', ...o });

// toolbar picture rendered by the same browser
const pw = loadPlaywright();
const b = await pw.chromium.launch();
const p = await b.newPage({ viewport: { width: 1080, height: 150 } });
await p.setContent('<body style="margin:0;background:#1f4fbf;color:#fff;font:600 48px Roboto,Arial,sans-serif;height:150px;display:flex;align-items:center"><span style="width:150px;text-align:center;font-size:60px">&#8592;</span>Market Insights</body>');
const toolbar = decodePng(await p.screenshot());
await b.close();
await wv.close();

const home = decodePng(fs.readFileSync(path.join(SAMPLES, 'home.png')));
const screen = { width: 1080, height: 2400, data: new Uint8Array(1080 * 2400 * 4).fill(255) };
blit(screen, crop(home, 0, 0, 1080, 105), 0, 0);
blit(screen, toolbar, 0, 105);
blit(screen, shot, B.x, B.y);
blit(screen, crop(home, 0, 2280, 1080, 120), 0, 2280);
fs.writeFileSync(path.join(SAMPLES, 'insights.png'), encodePng(screen));

const homeTree = JSON.parse(fs.readFileSync(path.join(SAMPLES, 'home.json'), 'utf8'));
const system = homeTree.data.elements.filter((e) => /systemui|android:id\//.test(e.identifier || ''));
const app = node({
  type: 'android.widget.LinearLayout', identifier: `${PKG}:id/action_bar_root`, rect: { x: 0, y: 105, width: 1080, height: 2175 },
  children: [
    node({ type: 'android.view.ViewGroup', identifier: `${PKG}:id/insights_toolbar`, rect: { x: 0, y: 105, width: 1080, height: 150 }, children: [
      node({ type: 'android.widget.ImageButton', label: 'Navigate up', identifier: `${PKG}:id/insights_back_button`, rect: { x: 0, y: 105, width: 150, height: 150 } }),
      node({ type: 'android.widget.TextView', text: 'Market Insights', identifier: `${PKG}:id/insights_title_text`, rect: { x: 150, y: 140, width: 420, height: 80 } }),
    ] }),
    node({ type: 'android.webkit.WebView', identifier: `${PKG}:id/insights_webview`, rect: { ...B }, children: [
      node({ type: 'android.view.View', label: 'Market Insights', rect: { ...B }, children: items.map((it) => node({ type: it.type, text: it.text, ...(it.label ? { label: it.label } : {}), ...(it.placeholder ? { placeholder: it.placeholder } : {}), rect: px(it) })) }),
    ] }),
  ],
});
fs.writeFileSync(path.join(SAMPLES, 'insights.json'), JSON.stringify({ status: 'ok', data: { elements: [...system, app] } }, null, 2) + '\n');
console.log('wrote insights.png and insights.json:', items.length, 'web nodes');
