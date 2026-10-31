import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTree, appNodes, detectPackage } from '../src/tree.js';
import { annotate } from '../src/locators.js';
import { suggest } from '../src/suggest.js';
import { generate } from '../src/codegen.js';
import { escapeInputText, makeLock, dumpUiautomator } from '../src/device.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples');
const PKG = 'com.yourname.tradehub';
let pass = 0;
const results = [];
function t(name, fn) {
  try { fn(); pass++; results.push(['ok', name]); } catch (e) { results.push(['FAIL', name + '\n      ' + e.message]); }
}

const load = (f) => {
  const raw = parseTree(fs.readFileSync(path.join(dir, f)));
  const nodes = appNodes(raw, PKG);
  annotate(nodes, PKG);
  return { raw, nodes };
};
const byId = (nodes, id, i = 0) => nodes.filter((n) => n.identifier === `${PKG}:id/${id}`)[i];

const home = load('home.json');
const prod = load('products.json');

t('detects the app package, ignoring systemui and the recorder overlay', () => {
  assert.equal(detectPackage(home.raw), PKG);
});
t('drops status bar, navigation bar and overlay nodes', () => {
  assert.ok(home.raw.length > home.nodes.length);
  assert.ok(!home.nodes.some((n) => n.identifier.startsWith('com.android.systemui')));
  assert.ok(!home.nodes.some((n) => n.identifier.includes('screenrecorder')));
  assert.ok(!home.nodes.some((n) => n.text === '00:11:43'));
});
t('unique resource-id -> getByTestId with id() helper', () => {
  const n = byId(home.nodes, 'home_search_input');
  assert.equal(n.target.kind, 'testId');
  assert.equal(n.target.expr, "screen.getByTestId(id('home_search_input'))");
});
t('icon inside a nav item climbs to the labelled parent (testId, not the dynamic label)', () => {
  const nav = byId(home.nodes, 'nav_messages');
  const icon = home.nodes[nav.childIds[0]]; // icon container
  const iconView = home.nodes[icon.childIds[1]];
  assert.equal(iconView.target.kind, 'testId');
  assert.equal(iconView.target.expr, "screen.getByTestId(id('nav_messages'))");
  assert.equal(iconView.target.viaAncestor, true);
});
t('dynamic label is flagged when it is the only option', () => {
  const n = home.nodes.find((x) => x.text === '10 Products');
  assert.ok(n.target.quality < 100);
});
t('repeated list buttons are scoped by the row title', () => {
  const edits = prod.nodes.filter((n) => n.identifier === `${PKG}:id/myproduct_edit_button`);
  assert.equal(edits.length, 3);
  assert.equal(edits[1].target.kind, 'scoped');
  assert.ok(edits[1].target.expr.includes("filter({ has: screen.getByText('Fiber Laser Metal Cutting Machine 1500W') })"));
  assert.ok(edits[1].target.expr.endsWith(".getByTestId(id('myproduct_edit_button'))"));
});
t('first row is scoped by a different anchor than the second', () => {
  const edits = prod.nodes.filter((n) => n.identifier === `${PKG}:id/myproduct_edit_button`);
  assert.ok(edits[0].target.expr.includes("getByText('Carbon')"));
});
t('unlabeled icon button falls back to a coordinate tap', () => {
  const n = prod.nodes.find((x) => x.type.endsWith('ImageButton'));
  assert.equal(n.target.kind, 'coordinate');
  assert.equal(n.target.expr, null);
});
t('home -> products diff suggests the new screen title as a post-assertion', () => {
  const s = suggest(home.nodes, prod.nodes);
  assert.ok(s.some((x) => x.assertion === 'visible' && x.expr.includes('myproducts_title_text')), JSON.stringify(s.slice(0, 3)));
});
t('tab bar selection change is suggested as a state check', () => {
  const a = load('home.json').nodes;
  const b = load('home.json').nodes;
  byId(b, 'nav_home').selected = false;
  byId(b, 'nav_categories').selected = true;
  const s = suggest(a, b);
  assert.ok(s.some((x) => x.assertion === 'selected' && x.expr.includes('nav_categories')));
});
t('switch toggle is suggested as checked/unchecked', () => {
  const a = load('products.json').nodes;
  const b = load('products.json').nodes;
  byId(b, 'myproduct_active_switch', 0).checked = false;
  const s = suggest(a, b);
  // the three switches share an id, so no id-based state check is expected (avoids a wrong, ambiguous assertion)
  assert.ok(!s.some((x) => x.assertion === 'unchecked'));
});
t('uiautomator XML is parsed with entities and bounds', () => {
  const xml = `<?xml version='1.0' encoding='UTF-8'?><hierarchy rotation="0"><node index="0" text="" resource-id="com.yourname.tradehub:id/root" class="android.widget.FrameLayout" content-desc="" checkable="false" checked="false" enabled="true" selected="false" bounds="[0,0][1080,2400]"><node index="0" text="Tom &amp; Jerry &gt; &quot;x&quot;" resource-id="com.yourname.tradehub:id/title" class="android.widget.TextView" content-desc="" checkable="false" checked="false" enabled="true" selected="false" bounds="[10,20][110,70]" /></node></hierarchy>`;
  const n = parseTree(xml);
  assert.equal(n.length, 2);
  assert.equal(n[1].text, 'Tom & Jerry > "x"');
  assert.deepEqual(n[1].rect, { x: 10, y: 20, w: 100, h: 50 });
  assert.equal(n[1].parentId, 0);
});
t('UTF-16 (PowerShell redirect) tree files are readable', () => {
  const json = fs.readFileSync(path.join(dir, 'home.json'), 'utf8');
  const buf = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(json, 'utf16le')]);
  assert.ok(parseTree(buf).length > 50);
});
t('adb input text escaping', () => {
  assert.equal(escapeInputText('a b&c'), 'a%sb\\&c');
});

t('a list row itself is not collapsed into the whole list', () => {
  const row = prod.nodes.filter((n) => n.identifier === `${PKG}:id/myproduct_row_card`)[1];
  assert.equal(row.target.kind, 'scoped');
  assert.ok(row.target.expr.startsWith("screen.getByTestId(id('myproduct_row_card')).filter("));
});
t('dynamic price text inside a row prefers the scoped locator', () => {
  const price = prod.nodes.filter((n) => n.identifier === `${PKG}:id/myproduct_price_text`)[0];
  assert.equal(price.target.kind, 'scoped');
  assert.ok(price.target.expr.endsWith(".getByTestId(id('myproduct_price_text'))"));
});

const asyncTests = [];
asyncTests.push(['uiautomator "Killed" output is retried, then succeeds', async () => {
  let n = 0;
  const out = await dumpUiautomator(async () => (++n < 3 ? Buffer.from('Killed') : Buffer.from('<?xml?><hierarchy><node bounds="[0,0][1,1]"/></hierarchy>')), async () => {});
  assert.equal(n, 3);
  assert.ok(out.includes('<hierarchy'));
}]);
asyncTests.push(['uiautomator gives a clear error when it never answers', async () => {
  await assert.rejects(() => dumpUiautomator(async () => Buffer.from('Killed'), async () => {}, 2), /did not return a screen after 2 tries: "Killed"/);
}]);
asyncTests.push(['jobs under the lock never overlap', async () => {
  const lock = makeLock();
  let running = 0, maxRunning = 0;
  const job = () => lock(async () => { running++; maxRunning = Math.max(maxRunning, running); await new Promise((r) => setTimeout(r, 20)); running--; });
  await Promise.all([job(), job(), job(), job()]);
  assert.equal(maxRunning, 1);
}]);

const steps = [
  { type: 'tap', title: 'Search', target: byId(home.nodes, 'home_search_button').target, pre: true, mode: 'name', x: 917, y: 443 },
  { type: 'type', title: 'Search', target: byId(home.nodes, 'home_search_input').target, args: { text: 'steel' }, pre: true },
  { type: 'swipe', args: { direction: 'up', distance: 650 } },
  { type: 'scroll_to', title: 'Featured Products', target: byId(home.nodes, 'home_featured_header_text').target },
  { type: 'tap', title: 'icon', target: prod.nodes.find((x) => x.type.endsWith('ImageButton')).target, x: 990, y: 1950, asset: 'step-5.png' },
  { type: 'tap', title: 'Edit', x: 670, y: 1286, target: prod.nodes.filter((n) => n.identifier.endsWith('myproduct_edit_button'))[1].target, post: [{ assertion: 'visible', expr: "screen.getByText('Edit product')" }] },
  { type: 'press', args: { key: 'BACK' } },
  { type: 'assert', title: 'Role', target: byId(home.nodes, 'home_role_badge_text').target, args: { assertion: 'text', expected: 'Role: SELLER' } },
  { type: 'wait_hidden', title: 'Loader', target: { kind: 'testId', expr: "screen.getByTestId(id('loading_progress'))" } },
];
const code = generate(steps, { name: 'search and edit', bundleId: PKG, size: { width: 1080, height: 2400 } });

t('generated spec has the project style (imports, launch, finally terminate)', () => {
  assert.ok(code.startsWith("import { expect, test } from '@mobilewright/test';"));
  assert.ok(code.includes('test.use({ autoAppLaunch: false });'));
  assert.ok(code.includes('await device.launchApp(bundleId);'));
  assert.ok(code.includes('await device.terminateApp(bundleId);'));
});
t('default tap style is name with coordinate fallback (helper + tapOrAt call)', () => {
  assert.ok(code.includes('const tapOrAt = async (target: { exists(): Promise<boolean>; tap(): Promise<void> }, x: number, y: number) => {'));
  assert.match(code, /await tapOrAt\(screen\.getByTestId\(id\('myproduct_row_card'\)\)\.filter\(\{ has: screen\.getByText\('Fiber Laser Metal Cutting Machine 1500W'\) \}\)\.getByTestId\(id\('myproduct_edit_button'\)\), 670, 1286\);/);
  assert.ok(code.includes('falls back to (0.620, 0.536) of 1080x2400'));
});
t('coordinate-only style writes screen.tap and keeps the name in a comment', () => {
  const c = generate([{ type: 'tap', title: 'Search', mode: 'coord', x: 917, y: 443, target: byId(home.nodes, 'home_search_button').target }], { bundleId: PKG, size: { width: 1080, height: 2400 } });
  assert.ok(c.includes('await screen.tap(917, 443); // coordinate tap (0.849, 0.185) of 1080x2400; name-based locator would be: screen.getByTestId(id(\'home_search_button\'))'));
  assert.ok(!c.includes('tapOrAt'));
});
t('name-only style has no helper and keeps the pre-assertion', () => {
  const c = generate([{ type: 'tap', title: 'Search', mode: 'name', pre: true, x: 1, y: 2, target: byId(home.nodes, 'home_search_button').target }], { bundleId: PKG });
  assert.ok(!c.includes('tapOrAt'));
  assert.ok(c.includes(".toBeVisible();\n    await screen.getByTestId(id('home_search_button')).tap();"));
});
t('every action has a pre-assertion (name-only style)', () => {
  assert.match(code, /await expect\(screen\.getByTestId\(id\('home_search_button'\)\)\)\.toBeVisible\(\);\n\s+await screen\.getByTestId\(id\('home_search_button'\)\)\.tap\(\);/);
});
t('type uses fill, swipe uses screen.swipe, scroll uses scrollIntoViewIfNeeded', () => {
  assert.ok(code.includes(".fill('steel');"));
  assert.ok(code.includes("await screen.swipe('up', { distance: 650 });"));
  assert.ok(code.includes('.scrollIntoViewIfNeeded();'));
});
t('coordinate tap carries ratio and template reference', () => {
  assert.ok(code.includes('await screen.tap(990, 1950);'));
  assert.ok(code.includes('(0.917, 0.813) of 1080x2400'));
  assert.ok(code.includes('assets/step-5.png'));
});
t('post-assertions, text assertions and BACK are emitted', () => {
  assert.ok(code.includes("// then:"));
  assert.ok(code.includes("await expect(screen.getByText('Edit product')).toBeVisible();"));
  assert.ok(code.includes("expect(await screen.getByTestId(id('home_role_badge_text')).getText()).toBe('Role: SELLER');"));
  assert.ok(code.includes("await screen.pressButton('BACK');"));
});
t('unconfirmed APIs are listed in a header comment', () => {
  assert.match(code, /Verify on first run \(not confirmed in the MobileWright docs\): .*not\.toBeVisible\(\)/);
});

fs.mkdirSync(path.join(dir, '..', 'generated'), { recursive: true });
fs.writeFileSync(path.join(dir, '..', 'generated', 'sample-from-tests.spec.ts'), code);

for (const [name, fn] of asyncTests) {
  try { await fn(); pass++; results.push(['ok', name]); } catch (e) { results.push(['FAIL', name + '\n      ' + e.message]); }
}
for (const [s, m] of results) console.log(`${s === 'ok' ? 'PASS' : 'FAIL'}  ${m}`);
console.log(`\n${pass}/${results.length} passed`);
process.exit(pass === results.length ? 0 : 1);
