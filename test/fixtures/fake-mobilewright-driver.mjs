// A controlled MobileWright driver for tests and demos without a phone.
//
// It implements MobileWright's driver interface (device allocation + session methods) over the synthetic
// TradeHub sample screens in samples/, with the same tap rules as the recorder's mock device and the mock
// Appium server: tapping "My Products" opens the products screen, the market card opens "Market Insights" (a
// WebView screen); Back/Home return home; text typed into the focused field is kept until the screen changes.
// Its webViewBridge serves the WebView from a real headless Chromium (test/fixtures/webview-host.mjs), so
// MobileWright's own WebView engine runs in a browser engine.
//
// Passing against it proves the generated TypeScript compiles, is collected and executed by the real
// MobileWright runner, and that Vortex's runner reports results correctly. It does NOT prove anything about a
// real device. Plain JavaScript on purpose: it is loaded by the MobileWright runner, not by Vortex.
//
// Every call is appended to $VORTEX_FAKE_DRIVER_LOG (one JSON line each) when that variable is set.

import fs from 'node:fs';
import path from 'node:path';
import { openWebView, WEBVIEW } from './webview-host.mjs';

// No import.meta here: MobileWright's runner may load this file as CommonJS. The samples folder is passed in
// $VORTEX_FAKE_SAMPLES by whoever enables the fake driver (Vortex in --mock mode, or the integration tests).
const SIZE = { width: 1080, height: 2400, scale: 1 };

export default class FakeMobilewrightDriver {
  screen = 'home';
  typed = new Map();
  focused = null;
  appRunning = false;
  web = null;
  webDirty = true;

  #log(op, args = {}) {
    const f = process.env.VORTEX_FAKE_DRIVER_LOG;
    if (f) fs.appendFileSync(f, JSON.stringify({ op, ...args, screen: this.screen }) + '\n');
  }

  #samples() {
    const d = process.env.VORTEX_FAKE_SAMPLES;
    if (!d) throw new Error('VORTEX_FAKE_SAMPLES is not set: the fake MobileWright driver needs the samples folder');
    return d;
  }

  /** The sample tree with stable element keys (path of child indexes). */
  #elements() {
    const raw = JSON.parse(fs.readFileSync(path.join(this.#samples(), `${this.screen}.json`), 'utf8'));
    const tag = (e, key) => ({ ...e, key, children: (e.children ?? []).map((c, i) => tag(c, `${key}.${i}`)) });
    return (raw.data?.elements ?? raw.elements ?? []).map((e, i) => tag(e, String(i)));
  }

  #go(screen) {
    if (screen !== this.screen) {
      this.screen = screen;
      this.typed.clear();
      this.focused = null;
      if (screen === 'insights') this.webDirty = true;
    }
  }

  async #webPage() {
    if (!this.web) this.web = await openWebView(this.#samples());
    else if (this.webDirty) await this.web.reset();
    this.webDirty = false;
    return this.web.page;
  }

  // ---- WebView bridge (what MobileWright's getByWebView().page() uses) ----
  get webViewBridge() {
    return {
      listWebViews: async () => {
        if (this.screen !== 'insights') return [];
        const page = await this.#webPage();
        return [{ id: 'wv-1', url: page.url(), title: await page.title(), nativeBounds: { ...WEBVIEW.nativeBounds } }];
      },
      attachWebView: async (id) => {
        if (id !== 'wv-1' || this.screen !== 'insights') throw new Error(`no webview ${id}`);
        const page = await this.#webPage();
        this.#log('attachWebView', { id });
        return {
          evaluate: (expr) => page.evaluate(expr),
          goto: async (url) => void (await page.goto(url)),
          goBack: async () => void (await page.goBack()),
          goForward: async () => void (await page.goForward()),
          url: async () => page.url(),
          title: async () => page.title(),
          reload: async () => void (await page.reload()),
          waitForLoadState: async (state) => page.waitForLoadState(state ?? 'load'),
          close: async () => {},
        };
      },
    };
  }

  // ---- view tree ----
  async getViewHierarchy() {
    const view = (e) => {
      const r = e.rect ?? { x: 0, y: 0, width: 0, height: 0 };
      const text = this.typed.has(e.key) ? this.typed.get(e.key) : e.text ?? '';
      return {
        type: e.type || '',
        label: e.label || undefined,
        identifier: e.identifier || undefined,
        resourceId: e.identifier || undefined,
        text,
        value: /EditText/.test(e.type ?? '') ? text : undefined,
        isVisible: r.width > 0 && r.height > 0,
        isEnabled: e.enabled !== false,
        isSelected: !!e.selected,
        isChecked: e.checked === undefined || e.checked === null ? undefined : !!e.checked,
        bounds: { x: r.x, y: r.y, width: r.width, height: r.height },
        children: e.children.map(view),
      };
    };
    return this.#elements().map(view);
  }

  /** Deepest, topmost element under the point, with its ancestors (nearest first). */
  #hit(x, y) {
    const inside = (e) => e.rect && e.rect.width > 0 && e.rect.height > 0 && x >= e.rect.x && x < e.rect.x + e.rect.width && y >= e.rect.y && y < e.rect.y + e.rect.height;
    const down = (list, chain) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        if (inside(c)) return down(c.children, [c, ...chain]) ?? [c, ...chain];
      }
      return null;
    };
    return down(this.#elements(), []) ?? [];
  }

  // ---- input ----
  async tap(x, y) {
    const chain = this.#hit(x, y);
    const node = chain[0];
    this.#log('tap', { x, y, id: node?.identifier ?? null });
    if (!node) return;
    const ids = chain.map((e) => e.identifier ?? '');
    this.focused = /EditText/.test(node.type ?? '') ? node.key : null;
    if (ids.some((i) => i.endsWith('home_my_products_button'))) this.#go('products');
    else if (ids.some((i) => i.endsWith('home_market_card'))) this.#go('insights');
    else if (ids.some((i) => i.endsWith(':id/nav_home') || i.endsWith('insights_back_button'))) this.#go('home');
    else if (this.screen === 'insights' && ids.some((i) => i.endsWith('insights_webview'))) {
      const B = WEBVIEW.nativeBounds; // a touch on the WebView reaches the page
      await (await this.#webPage()).mouse.click((x - B.x) / WEBVIEW.dpr, (y - B.y) / WEBVIEW.dpr);
    }
  }
  // ---- allocation ----
  async allocate() {
    this.#log('allocate');
    return { deviceId: 'mock-device', platform: 'android', model: 'Fake TradeHub phone', osVersion: '14', type: 'emulator' };
  }
  async release() {
    await this.web?.close();
    this.web = null;
  }
  async connect() {
    return { deviceId: 'mock-device', platform: 'android' };
  }
  async disconnect() {
    await this.web?.close();
    this.web = null;
  }
  async listDevices() {
    return [{ id: 'mock-device', name: 'Fake TradeHub phone', platform: 'android', type: 'emulator', state: 'online' }];
  }

  async doubleTap(x, y) {
    this.#log('doubleTap', { x, y });
    await this.tap(x, y);
  }
  async longPress(x, y, duration) {
    this.#log('longPress', { x, y, duration });
  }
  async typeText(text) {
    this.#log('typeText', { length: String(text).length });
    if (this.focused !== null) this.typed.set(this.focused, (this.typed.get(this.focused) ?? '') + text);
  }
  async clearText() {
    this.#log('clearText');
    if (this.focused !== null) this.typed.set(this.focused, '');
  }
  async pressKeys() {}
  async swipe(direction, opts) {
    this.#log('swipe', { direction, ...(opts ?? {}) });
  }
  async gesture() {}
  async pressButton(button) {
    this.#log('pressButton', { button });
    if (button === 'BACK' || button === 'HOME') this.#go('home');
  }

  // ---- screen ----
  async screenshot() {
    return fs.readFileSync(path.join(this.#samples(), `${this.screen}.png`));
  }
  async getScreenSize() {
    return SIZE;
  }
  async getOrientation() {
    return 'portrait';
  }
  async setOrientation() {}
  async setGeolocation() {}
  async setFoldState() {}

  // ---- apps ----
  async launchApp(bundleId) {
    this.#log('launchApp', { bundleId });
    this.appRunning = true;
    this.#go('home');
  }
  async terminateApp(bundleId) {
    this.#log('terminateApp', { bundleId });
    this.appRunning = false;
    this.#go('home');
  }
  async clearAppData() {}
  async listApps() {
    return [{ bundleId: 'com.yourname.tradehub' }];
  }
  async getForegroundApp() {
    return { bundleId: 'com.yourname.tradehub' };
  }
  async installApp() {}
  async uninstallApp() {}
  async openUrl(url) {
    this.#log('openUrl', { url });
    this.#go(/^tradehub:\/\/products\b/.test(url) ? 'products' : /^tradehub:\/\/insights\b/.test(url) ? 'insights' : 'home');
  }
  async startRecording() {}
  async stopRecording() {
    return {};
  }
}
