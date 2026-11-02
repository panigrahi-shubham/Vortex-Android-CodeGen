// A flow on the synthetic TradeHub sample screens, recorded the way the UI records it: targets and
// suggestions straight from the recorder modules, screen names as the recorder captures them.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { annotate } from '../../src/locators.js';
import { fromUiSteps, type Recording, type UiStep } from '../../src/model/recording.ts';
import { suggest } from '../../src/suggest.js';
import { appNodes, parseTree } from '../../src/tree.js';

export const PKG = 'com.yourname.tradehub';
export const SAMPLES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'samples');
export const HOME = { name: 'Home', activity: `${PKG}/.ui.HomeActivity` };
export const PRODUCTS = { name: 'My Products', activity: `${PKG}/.ui.products.MyProductsActivity` };

type N = { id: number; identifier: string; text: string; label: string; target: UiStep['target'] };
export const load = (f: string) => {
  const n = appNodes(parseTree(fs.readFileSync(path.join(SAMPLES, f))), PKG) as unknown as N[];
  annotate(n as never, PKG);
  return n;
};
export const byId = (nodes: N[], id: string, i = 0) => nodes.filter((n) => n.identifier === `${PKG}:id/${id}`)[i];

export interface FlowOptions {
  roleExpected?: string;
  sensitive?: boolean;
}

export function sampleSteps(o: FlowOptions = {}): UiStep[] {
  const home = load('home.json');
  const prod = load('products.json');
  const appeared = (suggest(home as never, prod as never) as { assertion: string; parts: unknown; title: string; reason: string; kind: string }[])
    .filter((s) => s.assertion === 'visible')
    .slice(0, 1)
    .map((s) => ({ ...s, on: true }));
  const rows = prod.filter((n) => n.identifier === `${PKG}:id/myproduct_row_card`).length;
  const steps: UiStep[] = [
    { type: 'type', title: 'Search', target: byId(home, 'home_search_input').target, args: { text: 'steel pipes' }, pre: true, x: 540, y: 330, screen: HOME, screenAfter: HOME },
    { type: 'assert', title: 'Search', target: byId(home, 'home_search_input').target, args: { assertion: 'visible' }, screen: HOME },
    { type: 'tap', title: 'My Products', target: byId(home, 'home_my_products_button').target, mode: 'name', pre: true, x: 285, y: 233, sugg: appeared as never, screen: HOME, screenAfter: PRODUCTS },
    { type: 'tap', title: 'Edit', target: prod.filter((n) => n.identifier.endsWith('myproduct_edit_button'))[1].target, mode: 'both', x: 670, y: 1286, screen: PRODUCTS, screenAfter: PRODUCTS },
    { type: 'assert', title: 'rows', target: { kind: 'testId', parts: { by: 'id', value: `${PKG}:id/myproduct_row_card` } }, args: { assertion: 'count', expected: rows }, screen: PRODUCTS },
    { type: 'press', title: 'Back', args: { key: 'BACK' }, screen: PRODUCTS, screenAfter: HOME },
    { type: 'assert', title: 'Role', target: byId(home, 'home_role_badge_text').target, args: { assertion: 'text', expected: o.roleExpected ?? 'Role: SELLER' }, screen: HOME },
    { type: 'swipe', title: 'swipe up', args: { direction: 'up', distance: 600, from: { x: 540, y: 1500 }, to: { x: 540, y: 900 }, duration: 300 }, screen: HOME },
    { type: 'scroll_to', title: 'Featured Products', target: byId(home, 'home_featured_header_text').target, screen: HOME },
  ];
  if (o.sensitive) {
    steps.splice(1, 0, { type: 'type', title: 'Search', target: byId(home, 'home_search_input').target, args: {}, secretEnv: 'VORTEX_SECRET_SEARCH', pre: true, x: 540, y: 330, screen: HOME });
  }
  return steps;
}

export function sampleRecording(o: FlowOptions & { name?: string } = {}): Recording {
  return fromUiSteps(sampleSteps(o), {
    id: 'rec-sample-0001',
    name: o.name ?? 'browse my products',
    module: 'catalog',
    appPackage: PKG,
    serial: 'mock-device',
    screen: { width: 1080, height: 2400 },
    createdAt: '2026-10-31T10:00:00.000Z',
    version: 'test',
  });
}

export const INSIGHTS = { name: 'Market Insights', activity: `${PKG}/.ui.insights.MarketInsightsActivity` };
export const INSIGHTS_WEB = { testId: `${PKG}:id/insights_webview`, index: 0, count: 1, url: 'https://insights.tradehub.example/rates', title: 'Market Insights' };

const css = (value: string, frames: string[] = []) => ({ kind: 'css', expr: null, quality: 105, warnings: [], parts: { by: 'css' as const, value, ...(frames.length ? { frames } : {}) } });
const web = (s: Omit<UiStep, 'context' | 'webview' | 'screen'>): UiStep => ({ ...s, context: 'WEBVIEW', webview: INSIGHTS_WEB, screen: INSIGHTS, pre: true });

/** Native -> WebView -> Native on the sample app. `iframe` adds a step inside the same-origin iframe (Appium only). */
export function webSampleSteps(o: { iframe?: boolean; statusExpected?: string; sensitive?: boolean } = {}): UiStep[] {
  const home = load('home.json');
  const steps: UiStep[] = [
    { type: 'tap', title: 'Live Market Insights Banner', target: byId(home, 'home_market_card').target, mode: 'name', pre: true, x: 540, y: 614, screen: HOME, screenAfter: INSIGHTS },
    web({ type: 'type', title: 'Email', target: css('[data-testid="subscribe-email"]'), args: o.sensitive ? {} : { text: 'buyer@example.com' }, ...(o.sensitive ? { secretEnv: 'VORTEX_SECRET_EMAIL' } : {}) }),
    web({ type: 'tap', title: 'Subscribe', target: css('[data-testid="subscribe-btn"]') }),
    web({ type: 'assert', title: 'status', target: css('#status'), args: { assertion: 'text', expected: o.statusExpected ?? 'Subscribed: buyer@example.com' } }),
    web({ type: 'tap', title: 'Watch', target: css('div.rate-row[data-metal="copper"] button.watch') }),
    web({ type: 'assert', title: 'Watch', target: css('div.rate-row[data-metal="copper"] button.watch'), args: { assertion: 'text', expected: 'Watching' } }),
  ];
  if (o.iframe) {
    steps.push(web({ type: 'tap', title: 'Alert me when steel drops', target: css('#alert-toggle', ['#alerts-frame']) }));
    steps.push(web({ type: 'assert', title: 'Alert me when steel drops', target: css('#alert-toggle', ['#alerts-frame']), args: { assertion: 'checked' } }));
  }
  steps.push(
    { type: 'press', title: 'Back', args: { key: 'BACK' }, screen: INSIGHTS, screenAfter: HOME },
    { type: 'assert', title: 'Role', target: byId(home, 'home_role_badge_text').target, args: { assertion: 'text', expected: 'Role: SELLER' }, screen: HOME },
  );
  return steps;
}

export function webSampleRecording(o: { iframe?: boolean; statusExpected?: string; sensitive?: boolean; name?: string } = {}): Recording {
  return fromUiSteps(webSampleSteps(o), {
    id: 'rec-web-0001',
    name: o.name ?? 'subscribe to rates',
    module: 'insights',
    appPackage: PKG,
    serial: 'mock-device',
    screen: { width: 1080, height: 2400 },
    createdAt: '2026-10-31T10:00:00.000Z',
    version: 'test',
  });
}

/** Milestone 5 interactions on the sample app. `appiumOnly` adds the steps MobileWright 0.0.66 cannot express. */
export function actionSampleSteps(o: { appiumOnly?: boolean; activityExpected?: string } = {}): UiStep[] {
  const home = load('home.json');
  const search = byId(home, 'home_search_input');
  const steps: UiStep[] = [
    { type: 'deep_link', title: 'Deep link', args: { url: 'tradehub://products' }, screen: HOME, screenAfter: PRODUCTS },
    ...(o.appiumOnly ? [{ type: 'check_activity', title: 'My Products', args: { activity: o.activityExpected ?? PRODUCTS.activity }, screen: PRODUCTS } as UiStep] : []),
    { type: 'checkpoint', title: 'products', args: { name: 'products' }, screen: PRODUCTS },
    { type: 'press', title: 'Back', args: { key: 'BACK' }, screen: PRODUCTS, screenAfter: HOME },
    { type: 'type', title: 'Search', target: search.target, args: { text: 'copper' }, pre: true, x: 540, y: 330, screen: HOME },
    { type: 'clear', title: 'Search', target: search.target, pre: true, x: 540, y: 330, screen: HOME },
    { type: 'wait_enabled', title: 'Search', target: search.target, screen: HOME },
    ...(o.appiumOnly ? [{ type: 'hide_keyboard', title: 'Hide keyboard', args: {}, screen: HOME } as UiStep] : []),
    { type: 'close_app', title: 'Close app', args: {}, screen: HOME },
    { type: 'launch_app', title: 'Launch app', args: {}, screen: HOME },
    { type: 'assert', title: 'Role', target: byId(home, 'home_role_badge_text').target, args: { assertion: 'text', expected: 'Role: SELLER' }, screen: HOME },
  ];
  return steps;
}

export function actionSampleRecording(o: { appiumOnly?: boolean; activityExpected?: string; name?: string } = {}): Recording {
  return fromUiSteps(actionSampleSteps(o), { id: 'rec-actions-0001', name: o.name ?? 'more actions', module: 'actions', appPackage: PKG, serial: 'mock-device', screen: { width: 1080, height: 2400 }, createdAt: '2026-10-31T10:00:00.000Z', version: 'test' });
}
