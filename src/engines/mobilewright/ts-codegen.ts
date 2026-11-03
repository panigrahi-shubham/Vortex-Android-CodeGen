// MobileWright TypeScript generation from the shared recording model: Plain (one standalone spec) and
// POM (pages, fixtures, data and a spec that reads like the recorded flow).
//
// Written against @mobilewright/test 0.0.66 and checked against its type definitions and runner:
//  - getByText / getByLabel match EXACTLY by default, so `.nth(i)` uses the position among exact matches;
//  - checks use the retrying matchers (toBeHidden, toBeDisabled, toHaveText, toContainText, toBeChecked,
//    toBeSelected, toHaveCount, and `.not`), never one-shot reads;
//  - coordinate long-press / double-tap use screen.longPress / screen.doubleTap;
//  - hardware keys are limited to MobileWright's HardwareButton values.
// Anything that cannot be expressed is a validation issue; nothing is written as a placeholder.
//
// The legacy single-file format (src/codegen.js) is unchanged and still available.

import { afterScreen, camel, dataKey, PageRegistry, pascal, type MethodKind, type PagePlan, type PageLocator } from '../../model/pages.ts';
import { describeEvent, isCoordinateEvent, swipeGeometry, type GeneratedFile, type GenerationIssue } from '../../model/output.ts';
import type { AssertionKind, LocatorParts, RecordedEvent, Recording, WebViewRef } from '../../model/recording.ts';

export const MW_FORMAT = 'vortex-mobilewright v2';
export const MW_VERIFIED_WITH = '@mobilewright/test 0.0.66';

export const HARDWARE_BUTTONS = ['HOME', 'BACK', 'POWER', 'VOLUME_UP', 'VOLUME_DOWN', 'ENTER', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'DPAD_CENTER', 'APP_SWITCH', 'LOCK'];
const KEY_ALIASES: Record<string, string> = { RECENT: 'APP_SWITCH', RECENTS: 'APP_SWITCH' };

export const ts = (s: string) => "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n').replace(/[\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16)) + "'";
const oneLine = (s: string) => s.replace(/\r?\n/g, ' ').replace(/\*\//g, '* /');

/** MobileWright locator expression on `root` ('screen' or 'this.screen'). */
export function mwLocator(parts: LocatorParts | null | undefined, pkg: string, root: string): { code: string } | { error: string } {
  if (!parts) return { error: 'this step has no locator details (recorded by an older version). Delete it and record it again.' };
  if (parts.by === 'css' || parts.by === 'xpath') {
    if (!parts.value) return { error: 'empty WebView selector' };
    if (parts.frames?.length) return { error: `the element is inside an iframe (${parts.frames.join(' > ')}); MobileWright ${MW_VERIFIED_WITH.split(' ').pop()} WebView locators cannot enter iframes. Pick an exposed native control or record an explicit coordinate action.` };
    const sel = ts(parts.by === 'xpath' ? `xpath=${parts.value}` : parts.value);
    // 0.0.66 declares page.locator() as Playwright's Locator, but expect() is typed for MobileWebViewLocator,
    // which is what page.locator() returns at run time; the cast keeps TypeScript in line with the runtime.
    return { code: root === 'web' ? `webLocator(web, ${sel})` : `${root}.locator(${sel}) as unknown as MobileWebViewLocator` };
  }
  const idE = (v: string) => (v.startsWith(pkg + ':id/') ? `id(${ts(v.slice(pkg.length + 4))})` : ts(v));
  const simple = (by: string, v: string, base: string) => (by === 'id' ? `${base}.getByTestId(${idE(v)})` : by === 'type' ? `${base}.getByType(${ts(v)})` : by === 'label' ? `${base}.getByLabel(${ts(v)})` : `${base}.getByText(${ts(v)})`);
  if (parts.by === 'scoped') {
    if (!parts.container || !parts.anchorText) return { error: 'incomplete list-row locator' };
    let code = `${root}.getByTestId(${idE(parts.container)}).filter({ has: ${root}.getByText(${ts(parts.anchorText)}) })`;
    if (parts.inner) code = simple(parts.inner.by, parts.inner.value, code);
    return { code };
  }
  const v = parts.value ?? '';
  if (!v) return { error: 'empty locator value' };
  let code = simple(parts.by, v, root);
  if (parts.index !== undefined) {
    if (!Number.isInteger(parts.index) || parts.index < 0) return { error: 'the element position could not be determined exactly; pick a more specific element' };
    code += `.nth(${parts.index})`;
  }
  return { code };
}

function matcher(kind: AssertionKind, expected: string | number | undefined, L: string): { line: string } | { error: string } {
  const exp = expected ?? '';
  switch (kind) {
    case 'visible': return { line: `await expect(${L}).toBeVisible();` };
    case 'hidden': return { line: `await expect(${L}).toBeHidden();` };
    case 'enabled': return { line: `await expect(${L}).toBeEnabled();` };
    case 'disabled': return { line: `await expect(${L}).toBeDisabled();` };
    case 'text': return { line: `await expect(${L}).toHaveText(${ts(String(exp))});` };
    case 'contains': return { line: `await expect(${L}).toContainText(${ts(String(exp))});` };
    case 'checked': return { line: `await expect(${L}).toBeChecked();` };
    case 'unchecked': return { line: `await expect(${L}).not.toBeChecked();` };
    case 'selected': return { line: `await expect(${L}).toBeSelected();` };
    case 'unselected': return { line: `await expect(${L}).not.toBeSelected();` };
    case 'count': {
      const c = Number(exp);
      if (!Number.isInteger(c) || c < 0) return { error: `count check needs a whole number, got "${String(exp)}"` };
      return { line: `await expect(${L}).toHaveCount(${c});` };
    }
    default: return { error: `the "${String(kind)}" check is not supported` };
  }
}

// ---- event emitter shared by Plain and POM -----------------------------------------------------

/** `screen.getByWebView(...)` for the WebView a step was recorded in. */
export function webViewExpr(w: WebViewRef | null, pkg: string, root = 'screen'): string {
  if (w?.testId) return `${root}.getByWebView({ testId: ${w.testId.startsWith(pkg + ':id/') ? `id(${ts(w.testId.slice(pkg.length + 4))})` : ts(w.testId)} })`;
  if (w && w.count > 1) return `${root}.getByWebView().nth(${w.index})`;
  return `${root}.getByWebView()`;
}

interface Style {
  /** Locator expression for WebView checks. */
  webLoc(screen: string, parts: LocatorParts | null | undefined, title: string): { code: string } | { error: string };
  /** Statement for a WebView action. */
  webAct(kind: 'tap' | 'fill' | 'scroll_to', screen: string, parts: LocatorParts, title: string, o: { checkFirst: boolean; value: string | null }): string;
  /** Lines at the start of a WebView block (after `const web = ...`). */
  webOpen(blockLines: string[]): string[];
  /** Locator expression for checks. */
  loc(screen: string, parts: LocatorParts | null | undefined, title: string): { code: string } | { error: string };
  /** Statement for a locator-based action. */
  act(kind: MethodKind, screen: string, parts: LocatorParts, title: string, o: { checkFirst: boolean; fallback: { x: number; y: number } | null; value: string | null }): string;
  /** Expression for the typed value of an event. */
  value(e: RecordedEvent, screen: string, parts: LocatorParts, title: string): string;
}

interface Ctx {
  pkg: string;
  size: { width: number; height: number } | null;
  issues: GenerationIssue[];
  variant: 'plain' | 'pom';
  uses: Set<'tapOrAt' | 'secret' | 'sleep' | 'webLocator' | 'coordinateGuard'>;
  /** The spec uses `id(...)` outside page objects (WebView selection by resource-id). */
  usesId?: boolean;
}

function webEventLines(e: RecordedEvent, ctx: Ctx, S: Style): string[] {
  const n = e.seq;
  const out = [`// ${n}. ${oneLine(describeEvent(e))} (web)`];
  const issue = (message: string) => ctx.issues.push({ framework: 'mobilewright', variant: ctx.variant, step: n, message });
  const scr = e.screen.name;
  const parts = e.target?.parts ?? null;
  const L = S.webLoc(scr, parts, e.title);
  if ('error' in L) {
    issue(L.error);
    return out;
  }
  const a = e.action;
  switch (a.type) {
    case 'tap':
      out.push(S.webAct('tap', scr, parts!, e.title, { checkFirst: e.preCheck, value: null }));
      break;
    case 'type':
      if (e.input?.secretEnv) ctx.uses.add('secret');
      out.push(S.webAct('fill', scr, parts!, e.title, { checkFirst: e.preCheck, value: S.value(e, scr, parts!, e.title) }));
      break;
    case 'scroll_to':
      out.push(S.webAct('scroll_to', scr, parts!, e.title, { checkFirst: false, value: null }));
      break;
    case 'clear':
      out.push(`await ${L.code}.fill('');`);
      break;
    case 'wait_enabled':
      out.push(`await expect(${L.code}).toBeEnabled();`);
      break;
    case 'wait_visible':
    case 'wait_hidden':
      out.push(`await expect(${L.code}).${a.type === 'wait_visible' ? 'toBeVisible' : 'toBeHidden'}();`);
      break;
    case 'assert': {
      if (!e.check) break;
      if (e.check.kind === 'selected' || e.check.kind === 'unselected') {
        issue('MobileWright WebView locators have no selected check; use checked/unchecked or a text check');
        break;
      }
      const m = matcher(e.check.kind, e.check.expected, L.code);
      if ('error' in m) issue(m.error);
      else out.push(m.line);
      break;
    }
    default:
      issue(`"${a.type}" is not available for WebView elements: record it on the native screen instead`);
  }
  for (const pa of e.post) {
    const pl = S.webLoc(scr, pa.target.parts, pa.title);
    const m = 'error' in pl ? pl : matcher(pa.kind, pa.expected, pl.code);
    if ('error' in m) issue(`suggested check on "${pa.title || 'element'}": ${m.error}`);
    else out.push(m.line);
  }
  return out;
}

function eventLines(e: RecordedEvent, ctx: Ctx, S: Style): string[] {
  if (e.context === 'WEBVIEW') return webEventLines(e, ctx, S);
  const n = e.seq;
  const out = [`// ${n}. ${oneLine(describeEvent(e))}`];
  const issue = (message: string) => ctx.issues.push({ framework: 'mobilewright', variant: ctx.variant, step: n, message });
  const T = e.target;
  const coordTarget = !T || T.kind === 'coordinate';
  const scr = e.screen.name;
  const parts = coordTarget ? null : T!.parts;
  const L = coordTarget ? null : S.loc(scr, parts, e.title);
  const need = (): string | null => {
    if (L && 'code' in L) return L.code;
    issue(L && 'error' in L ? L.error : 'this step needs an element locator, but the element has none');
    return null;
  };
  const p = e.position;
  const ratio = (x: number, y: number) => (ctx.size ? ` (${(x / ctx.size.width).toFixed(3)}, ${(y / ctx.size.height).toFixed(3)}) of ${ctx.size.width}x${ctx.size.height}` : '');
  const a = e.action;

  switch (a.type) {
    case 'tap':
    case 'longpress':
    case 'doubletap': {
      if (!coordTarget && !(L && 'code' in L)) {
        need();
        break;
      }
      const coord = isCoordinateEvent(e);
      if (coord) {
        if (!p) {
          issue('no recorded position for this step');
          break;
        }
        ctx.uses.add('coordinateGuard');
        out.push('await assertCoordinateScreen(screen);');
        const fn = { tap: 'tap', longpress: 'longPress', doubletap: 'doubleTap' }[a.type];
        const why = coordTarget ? `unlabeled element at${ratio(p.x, p.y) || ' the recorded position'}` : `coordinate style chosen${ratio(p.x, p.y)}`;
        out.push(`await screen.${fn}(${p.x}, ${p.y}); // ${why}${e.templateRef ? `; template image: ${e.templateRef}` : ''}`);
        break;
      }
      const kind = a.type as MethodKind;
      const both = a.type === 'tap' && e.tapStyle === 'both';
      if (both && !p) {
        issue('name-with-fallback tap needs the recorded position; switch the step to "Name only"');
        break;
      }
      if (T!.warnings.length) out.push(`// note: ${oneLine(T!.warnings[0])}`);
      if (both) {ctx.uses.add('tapOrAt');ctx.uses.add('coordinateGuard');}
      out.push(S.act(kind, scr, parts!, e.title, { checkFirst: e.preCheck, fallback: both ? p : null, value: null }));
      break;
    }
    case 'type': {
      if (coordTarget) {
        issue('MobileWright can only fill an input element, and none was found where you clicked. Record the Type step on the input field itself.');
        break;
      }
      if (!need()) break;
      if (e.input?.secretEnv) ctx.uses.add('secret');
      if (T!.warnings.length) out.push(`// note: ${oneLine(T!.warnings[0])}`);
      out.push(S.act('fill', scr, parts!, e.title, { checkFirst: e.preCheck, fallback: null, value: S.value(e, scr, parts!, e.title) }));
      break;
    }
    case 'swipe': {
      const g = swipeGeometry(e);
      if (g) {
        out.push(`await screen.swipe(${ts(g.direction)}, { distance: ${g.distance}, startX: ${g.startX}, startY: ${g.startY}${g.durationMs ? `, duration: ${g.durationMs}` : ''} });`);
      } else if (a.direction && Number.isFinite(a.distance)) {
        out.push(`await screen.swipe(${ts(a.direction)}, { distance: ${a.distance} }); // recorded before start points were stored: starts at the screen centre`);
      } else issue('the swipe has no recorded direction or distance');
      break;
    }
    case 'scroll_to':
      if (coordTarget) {
        issue('there is nothing to scroll to because the element has no locator. Record a Swipe instead.');
        break;
      }
      if (!need()) break;
      out.push(S.act('scroll_to', scr, parts!, e.title, { checkFirst: false, fallback: null, value: null }));
      break;
    case 'press': {
      const raw = String(a.key ?? '').toUpperCase();
      const key = KEY_ALIASES[raw] ?? raw;
      if (!HARDWARE_BUTTONS.includes(key)) {
        issue(`the "${raw}" key is not a MobileWright hardware button (${HARDWARE_BUTTONS.join(', ')})`);
        break;
      }
      out.push(`await screen.pressButton(${ts(key)});`);
      break;
    }
    case 'wait_visible':
    case 'wait_hidden': {
      const c = need();
      if (c) out.push(`await expect(${c}).${a.type === 'wait_visible' ? 'toBeVisible' : 'toBeHidden'}();`);
      break;
    }
    case 'clear': {
      const c = need();
      if (c) out.push(...(e.preCheck ? [`await expect(${c}).toBeVisible();`] : []), `await ${c}.clear();`);
      break;
    }
    case 'wait_enabled': {
      const c = need();
      if (c) out.push(`await expect(${c}).toBeEnabled();`);
      break;
    }
    case 'hide_keyboard':
      issue('MobileWright 0.0.66 has no hide-keyboard action. Record "Back" instead if that closes the keyboard in your app.');
      break;
    case 'launch_app':
      out.push('await device.launchApp(bundleId);', 'appClosed = false;');
      break;
    case 'close_app':
      out.push('await device.terminateApp(bundleId);', 'appClosed = true;');
      break;
    case 'deep_link':
      if (!a.url) issue('the deep link has no URL');
      else out.push(`await device.openUrl(${ts(a.url)});`);
      break;
    case 'check_activity':
      issue('MobileWright 0.0.66 reports the foreground app but not the activity, so this check cannot be written for it. Check an element that only this screen shows.');
      break;
    case 'checkpoint': {
      const name = checkpointName(a.name);
      out.push(`await test.info().attach(${ts(`checkpoint-${name}`)}, { body: await screen.screenshot(), contentType: 'image/png' });`);
      break;
    }
    case 'sleep': {
      const ms = Number(a.ms) || 1000;
      out.push(`await new Promise((resolve) => setTimeout(resolve, ${ms})); // fixed wait recorded on purpose; a wait-for step is more reliable`);
      break;
    }
    case 'assert': {
      const c = need();
      if (!c || !e.check) {
        if (c) issue('the check has no kind');
        break;
      }
      const m = matcher(e.check.kind, e.check.expected, c);
      if ('error' in m) issue(m.error);
      else out.push(m.line);
      break;
    }
  }

  if (e.post.length) {
    out.push('// then:');
    for (const pa of e.post) {
      const pl = S.loc(afterScreen(e), pa.target.parts, pa.title);
      if ('error' in pl) {
        issue(`suggested check on "${pa.title || 'element'}": ${pl.error}`);
        continue;
      }
      const m = matcher(pa.kind, pa.expected, pl.code);
      if ('error' in m) issue(`suggested check on "${pa.title || 'element'}": ${m.error}`);
      else out.push(m.line);
    }
  }
  if ((e.observations.settleMs ?? 0) > 3000) out.push(`// the screen took about ${((e.observations.settleMs ?? 0) / 1000).toFixed(1)} s to settle after this step`);
  return out;
}

const webKey = (e: RecordedEvent) => (e.context === 'WEBVIEW' ? JSON.stringify([e.webview?.testId ?? null, e.webview?.index ?? 0]) : null);

function body(rec: Recording, ctx: Ctx, S: Style): string[] {
  const lines: string[] = [];
  const evs = rec.events;
  for (let k = 0; k < evs.length; ) {
    const key = webKey(evs[k]);
    if (!key) {
      for (const l of eventLines(evs[k], ctx, S).flatMap((x) => x.split('\n'))) {
        if (lines[lines.length - 1] === l && !l.startsWith('//')) continue; // identical consecutive checks
        lines.push(l);
      }
      k++;
      continue;
    }
    // a run of steps in the same WebView: one page attach, in its own block
    const first = evs[k];
    const block: string[] = [];
    while (k < evs.length && webKey(evs[k]) === key) {
      for (const l of eventLines(evs[k], ctx, S).flatMap((x) => x.split('\n'))) {
        if (block[block.length - 1] === l && !l.startsWith('//')) continue;
        block.push(l);
      }
      k++;
    }
    if (/\bid\(/.test(webViewExpr(first.webview, ctx.pkg))) ctx.usesId = true;
    const w = first.webview;
    lines.push(`// WebView${w?.title ? `: ${oneLine(w.title)}` : ''}${w?.url ? ` (${oneLine(w.url)})` : ''}`, '{', `  const web = await ${webViewExpr(w, ctx.pkg)}.page();`, ...S.webOpen(block).map((l) => '  ' + l), ...block.map((l) => (l ? '  ' + l : '')), '}');
  }
  return lines;
}

const TAP_OR_AT = [
  '// Fallback only if the locator is absent. A delivered tap error must propagate without another tap.',
  'async function tapOrAt(screen: Screen, target: Locator, x: number, y: number): Promise<void> {',
  '  if (await target.exists()) {',
  '    await target.tap();',
  '    return;',
  '  }',
  '  await assertCoordinateScreen(screen);',
  '  await screen.tap(x, y);',
  '}',
];

function coordinateGuard(size: Ctx['size'], exported=false): string[] {
  return [
    `${exported?'export ':''}async function assertCoordinateScreen(screen: Screen): Promise<void> {`,
    ...(!size?['  throw new Error("Recorded screen dimensions are missing. Re-record coordinate actions before replay.");']: [
      '  const png = await screen.screenshot({ format: "png", scale: 1 });',
      '  if (png.length < 24 || png.toString("ascii", 1, 4) !== "PNG") throw new Error("Cannot verify coordinate geometry: expected a PNG screenshot.");',
      `  if (png.readUInt32BE(16) !== ${size.width} || png.readUInt32BE(20) !== ${size.height}) throw new Error("Screen geometry changed from ${size.width}x${size.height}. Re-record the coordinate action; no tap was sent.");`,
    ]),
    '}',
  ];
}

const SECRET = [
  '// Sensitive input is never stored in the test: it is read from an environment variable at run time.',
  'function secret(name: string): string {',
  '  const value = process.env[name];',
  "  if (!value) throw new Error(`Set the ${name} environment variable: this test types a sensitive value that Vortex does not store.`);",
  '  return value;',
  '}',
];

/** Safe file-name part for a screenshot checkpoint. */
export const checkpointName = (n: string | undefined) => (String(n ?? 'checkpoint').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'checkpoint');

const WEB_LOCATOR = [
  '// An element inside the WebView. MobileWright 0.0.66 declares page.locator() as returning Playwright\'s Locator, while',
  '// expect() is typed for its MobileWebViewLocator, which is what page.locator() returns at run time.',
  'const webLocator = (page: MobileWebViewPage, selector: string) => page.locator(selector) as unknown as MobileWebViewLocator;',
];

function header(rec: Recording, variant: string, size: Ctx['size']): string[] {
  return [
    `// ${oneLine(rec.name)}: recorded with Vortex Android Recorder (${variant}).`,
    `// Format: ${MW_FORMAT}, written for ${MW_VERIFIED_WITH}. Recording: ${rec.id}${size ? `; screen ${size.width}x${size.height}` : ''}.`,
  ];
}

// ---- Plain -----------------------------------------------------------------------------------

export interface MwOptions {
  caseSlug: string;
  size: { width: number; height: number } | null;
}

export function generateMobilewrightPlain(rec: Recording, o: MwOptions): { files: GeneratedFile[]; issues: GenerationIssue[] } {
  const pkg = rec.app.package;
  const ctx: Ctx = { pkg, size: o.size, issues: [], variant: 'plain', uses: new Set() };
  const S: Style = {
    loc: (_s, parts) => mwLocator(parts, pkg, 'screen'),
    act: (kind, _s, parts, _t, opt) => {
      const L = (mwLocator(parts, pkg, 'screen') as { code: string }).code;
      if (opt.fallback) return `await tapOrAt(screen, ${L}, ${opt.fallback.x}, ${opt.fallback.y}); // by name; falls back to the recorded position`;
      const pre = opt.checkFirst && kind !== 'scroll_to' ? `await expect(${L}).toBeVisible();\n` : '';
      const call = { tap: 'tap()', longpress: 'longPress()', doubletap: 'doubleTap()', fill: `fill(${opt.value})`, scroll_to: 'scrollIntoViewIfNeeded()' }[kind];
      return `${pre}await ${L}.${call};`;
    },
    value: (e) => (e.input?.secretEnv ? `secret(${ts(e.input.secretEnv)})` : ts(e.input?.text ?? '')),
    webLoc: (_s, parts) => {
      ctx.uses.add('webLocator');
      return mwLocator(parts, pkg, 'web');
    },
    webAct: (kind, _s, parts, _t, opt) => {
      const L = (mwLocator(parts, pkg, 'web') as { code: string }).code;
      const pre = opt.checkFirst && kind !== 'scroll_to' ? `await expect(${L}).toBeVisible();\n` : '';
      return `${pre}await ${L}.${{ tap: 'click()', fill: `fill(${opt.value})`, scroll_to: 'scrollIntoViewIfNeeded()' }[kind]};`;
    },
    webOpen: () => [],
  };
  const b = body(rec, ctx, S).flatMap((l) => l.split('\n'));
  const out: string[] = [...header(rec, 'Plain', o.size)];
  out.push(`import { expect, test } from '@mobilewright/test';`);
  const mwTypes = [...(ctx.uses.has('tapOrAt') ? ['Locator'] : []), ...(ctx.uses.has('coordinateGuard') ? ['Screen'] : []), ...(ctx.uses.has('webLocator') ? ['MobileWebViewLocator', 'MobileWebViewPage'] : [])];
  if (mwTypes.length) out.push(`import type { ${mwTypes.join(', ')} } from 'mobilewright';`);
  out.push('', 'test.use({ autoAppLaunch: false });', '', `const bundleId = ${ts(pkg)};`, 'const id = (name: string) => `${bundleId}:id/${name}`;', '');
  if (ctx.uses.has('tapOrAt')) out.push(...TAP_OR_AT, '');
  if (ctx.uses.has('coordinateGuard')) out.push(...coordinateGuard(o.size), '');
  if (ctx.uses.has('secret')) out.push(...SECRET, '');
  if (ctx.uses.has('webLocator')) out.push(...WEB_LOCATOR, '');
  out.push(`test(${ts(rec.name)}, async ({ device, screen }) => {`);
  if(rec.events[0]?.action.type!=='launch_app')out.push('  await device.launchApp(bundleId);');
  out.push('  let appClosed = false;', '  try {');
  if (!b.length) out.push('    // no steps recorded yet');
  for (const l of b) out.push(l ? '    ' + l : '');
  out.push('  } finally {', '    if (!appClosed) await device.terminateApp(bundleId);', '  }', '});', '');
  return {
    files: [{ path: `mobilewright/plain/${o.caseSlug}.test.ts`, content: out.join('\n'), framework: 'mobilewright', variant: 'plain', role: 'entry' }],
    issues: ctx.issues,
  };
}

// ---- POM -------------------------------------------------------------------------------------

const pageClass = (p: PagePlan) => pascal([...p.words, ...(p.words[p.words.length - 1] === 'page' ? [] : ['page'])]);
const pageVar = (p: PagePlan) => camel([...p.words, ...(p.words[p.words.length - 1] === 'page' ? [] : ['page'])]);
const locName = (l: PageLocator) => camel(l.words);
const webClass = (p: PagePlan) => pascal([...p.words, 'web', 'page']);
const webVar = (p: PagePlan) => camel([...p.words, 'web', 'page']);

export function generateMobilewrightPom(rec: Recording, o: MwOptions): { files: GeneratedFile[]; issues: GenerationIssue[] } {
  const pkg = rec.app.package;
  const reg = new PageRegistry();
  const ctx: Ctx = { pkg, size: o.size, issues: [], variant: 'pom', uses: new Set() };
  const usedPages = new Set<PagePlan>();
  const webReg = new PageRegistry();
  const data = new Map<string, string>(); // key -> event id
  const dataValues: { key: string; text?: string; secretEnv?: string }[] = [];
  const S: Style = {
    loc: (screen, parts, title) => {
      const check = mwLocator(parts, pkg, 'this.screen');
      if ('error' in check) return check;
      const { page, loc } = reg.locator(screen, parts!, title);
      usedPages.add(page);
      return { code: `${pageVar(page)}.${locName(loc)}` };
    },
    act: (kind, screen, parts, title, opt) => {
      const { page, loc } = reg.locator(screen, parts, title);
      usedPages.add(page);
      const m = camel(reg.method(page, kind, loc));
      const args: string[] = [];
      if (kind === 'fill') args.push(opt.value!);
      const flags: string[] = [];
      if (opt.fallback) flags.push(`fallback: { x: ${opt.fallback.x}, y: ${opt.fallback.y} }`);
      if (!opt.checkFirst && kind !== 'scroll_to') flags.push('checkFirst: false');
      if (flags.length) args.push(`{ ${flags.join(', ')} }`);
      return `await ${pageVar(page)}.${m}(${args.join(', ')});`;
    },
    value: (e, screen, parts, title) => {
      const { loc } = reg.locator(screen, parts, title);
      const key = dataKey(e, loc.words, data);
      if (!dataValues.some((d) => d.key === key)) dataValues.push({ key, ...(e.input?.secretEnv ? { secretEnv: e.input.secretEnv } : { text: e.input?.text ?? '' }) });
      return e.input?.secretEnv ? `secrets.${camel(key.split('_'))}()` : `data.${camel(key.split('_'))}`;
    },
    webLoc: (screen, parts, title) => {
      const check = mwLocator(parts, pkg, 'this.web');
      if ('error' in check) return check;
      const { page, loc } = webReg.locator(screen, parts!, title);
      return { code: `${webVar(page)}.${locName(loc)}` };
    },
    webAct: (kind, screen, parts, title, opt) => {
      const { page, loc } = webReg.locator(screen, parts, title);
      const m = camel(webReg.method(page, kind, loc));
      const args = [...(kind === 'fill' ? [opt.value!] : []), ...(!opt.checkFirst && kind !== 'scroll_to' ? ['{ checkFirst: false }'] : [])];
      return `await ${webVar(page)}.${m}(${args.join(', ')});`;
    },
    webOpen: (block) => [...webReg.pages.values()].filter((p) => block.some((l) => new RegExp(`\\b${webVar(p)}\\.`).test(l))).map((p) => `const ${webVar(p)} = new ${webClass(p)}(web);`),
  };
  // data keys for WebView fields come from the web page registry
  const valueNative = S.value;
  S.value = (e, screen, parts, title) => (e.context === 'WEBVIEW' ? valueWeb(e, screen, parts, title) : valueNative(e, screen, parts, title));
  const valueWeb: Style['value'] = (e, screen, parts, title) => {
    const { loc } = webReg.locator(screen, parts, title);
    const key = dataKey(e, loc.words, data);
    if (!dataValues.some((d) => d.key === key)) dataValues.push({ key, ...(e.input?.secretEnv ? { secretEnv: e.input.secretEnv } : { text: e.input?.text ?? '' }) });
    return e.input?.secretEnv ? `secrets.${camel(key.split('_'))}()` : `data.${camel(key.split('_'))}`;
  };
  const b = body(rec, ctx, S).flatMap((l) => l.split('\n'));
  const files: GeneratedFile[] = [];
  const add = (p: string, lines: string[], role: GeneratedFile['role'] = 'support') => files.push({ path: `mobilewright/pom/${p}`, content: lines.join('\n') + '\n', framework: 'mobilewright', variant: 'pom', role });
  const pages = [...reg.pages.values()];

  // pages/app.ts
  add('pages/app.ts', [
    `// Shared app details and helpers for the page objects of "${oneLine(rec.name)}" (generated by Vortex; ${MW_FORMAT}).`,
    `import { expect } from '@mobilewright/test';`,
    `import type { Locator, Screen } from 'mobilewright';`,
    '',
    `export const bundleId = ${ts(pkg)};`,
    'export const id = (name: string) => `${bundleId}:id/${name}`;',
    '',
    ...coordinateGuard(o.size,true),
    '',
    'export interface ActionOptions {',
    '  /** Check the element is visible before acting (default true). */',
    '  checkFirst?: boolean;',
    '  /** Tap this position only if the locator is absent; delivered tap errors propagate. */',
    '  fallback?: { x: number; y: number };',
    '}',
    '',
    'export abstract class BasePage {',
    '  constructor(protected readonly screen: Screen) {}',
    '',
    '  protected async tapTarget(target: Locator, o: ActionOptions = {}): Promise<void> {',
    '    if (o.fallback) {',
    '      if (await target.exists()) {',
    '        await target.tap();',
    '        return;',
    '      }',
    '      await assertCoordinateScreen(this.screen);',
    '      await this.screen.tap(o.fallback.x, o.fallback.y);',
    '      return;',
    '    }',
    '    if (o.checkFirst !== false) await expect(target).toBeVisible();',
    '    await target.tap();',
    '  }',
    '',
    '  protected async ready(target: Locator, o: ActionOptions = {}): Promise<Locator> {',
    '    if (o.checkFirst !== false) await expect(target).toBeVisible();',
    '    return target;',
    '  }',
    '}',
  ]);

  for (const p of pages) {
    const cls = pageClass(p);
    const lines = [
      `// ${pascal(p.words)} screen, as recorded in "${oneLine(rec.name)}" (generated by Vortex; ${MW_FORMAT}).`,
      `import type { Locator } from 'mobilewright';`,
      `import { BasePage, id, type ActionOptions } from './app';`,
      '',
      `export class ${cls} extends BasePage {`,
    ];
    for (const l of p.locators) {
      const code = (mwLocator(l.parts, pkg, 'this.screen') as { code: string }).code;
      lines.push(`  get ${locName(l)}(): Locator {`, `    return ${code};`, '  }', '');
    }
    for (const m of p.methods) {
      const name = camel([...{ tap: ['tap'], longpress: ['long', 'press'], doubletap: ['double', 'tap'], fill: ['fill'], scroll_to: ['scroll', 'to'] }[m.kind], ...m.loc.words]);
      const L = `this.${locName(m.loc)}`;
      if (m.kind === 'tap') lines.push(`  async ${name}(o: ActionOptions = {}): Promise<void> {`, `    await this.tapTarget(${L}, o);`, '  }', '');
      else if (m.kind === 'longpress') lines.push(`  async ${name}(o: ActionOptions = {}): Promise<void> {`, `    await (await this.ready(${L}, o)).longPress();`, '  }', '');
      else if (m.kind === 'doubletap') lines.push(`  async ${name}(o: ActionOptions = {}): Promise<void> {`, `    await (await this.ready(${L}, o)).doubleTap();`, '  }', '');
      else if (m.kind === 'fill') lines.push(`  async ${name}(value: string, o: ActionOptions = {}): Promise<void> {`, `    await (await this.ready(${L}, o)).fill(value);`, '  }', '');
      else lines.push(`  async ${name}(): Promise<void> {`, `    await ${L}.scrollIntoViewIfNeeded();`, '  }', '');
    }
    if (lines[lines.length - 1] === '') lines.pop();
    lines.push('}');
    // `id` is only needed when a locator uses an app resource-id
    const text = lines.join('\n');
    add(`pages/${cls}.ts`, /\bid\(/.test(text) ? lines : lines.map((l) => (l.startsWith('import { BasePage, id,') ? `import { BasePage, type ActionOptions } from './app';` : l)));
  }

  // WebView page objects: built in the test from the attached page (`new XWebPage(web)`), not fixtures
  const webPages = [...webReg.pages.values()];
  for (const p of webPages) {
    const lines = [
      `// ${pascal(p.words)} web page (inside a WebView), as recorded in "${oneLine(rec.name)}" (generated by Vortex; ${MW_FORMAT}).`,
      `import { expect } from '@mobilewright/test';`,
      `import type { MobileWebViewLocator, MobileWebViewPage } from 'mobilewright';`,
      '',
      `export class ${webClass(p)} {`,
      '  constructor(readonly web: MobileWebViewPage) {}',
      '',
    ];
    for (const l of p.locators) lines.push(`  get ${locName(l)}(): MobileWebViewLocator {`, `    return ${(mwLocator(l.parts, pkg, 'this.web') as { code: string }).code};`, '  }', '');
    for (const m of p.methods) {
      const name = camel([...{ tap: ['tap'], longpress: ['long', 'press'], doubletap: ['double', 'tap'], fill: ['fill'], scroll_to: ['scroll', 'to'] }[m.kind], ...m.loc.words]);
      const L = `this.${locName(m.loc)}`;
      const pre = `    if (o.checkFirst !== false) await expect(${L}).toBeVisible();`;
      if (m.kind === 'tap') lines.push(`  async ${name}(o: { checkFirst?: boolean } = {}): Promise<void> {`, pre, `    await ${L}.click();`, '  }', '');
      else if (m.kind === 'fill') lines.push(`  async ${name}(value: string, o: { checkFirst?: boolean } = {}): Promise<void> {`, pre, `    await ${L}.fill(value);`, '  }', '');
      else lines.push(`  async ${name}(): Promise<void> {`, `    await ${L}.scrollIntoViewIfNeeded();`, '  }', '');
    }
    if (lines[lines.length - 1] === '') lines.pop();
    lines.push('}');
    const text = lines.join('\n');
    add(`pages/${webClass(p)}.ts`, /\bexpect\(/.test(text) ? lines : lines.filter((l) => !l.startsWith(`import { expect }`)));
  }

  // fixtures.ts
  const fx = pages.map((p) => `  ${pageVar(p)}: ${pageClass(p)};`);
  add('fixtures.ts', [
    `// Page-object fixtures for "${oneLine(rec.name)}" (generated by Vortex; ${MW_FORMAT}).`,
    `import { expect, test as base } from '@mobilewright/test';`,
    ...pages.map((p) => `import { ${pageClass(p)} } from './pages/${pageClass(p)}';`),
    '',
    pages.length ? `export const test = base.extend<{\n${fx.join('\n')}\n}>({` : 'export const test = base.extend({',
    ...pages.map((p) => `  ${pageVar(p)}: async ({ screen }, use) => {\n    await use(new ${pageClass(p)}(screen));\n  },`),
    '});',
    '',
    'export { expect };',
  ]);

  // data file
  const dataFile = `data/${o.caseSlug}.data`;
  if (dataValues.length) {
    const plain = dataValues.filter((d) => d.text !== undefined);
    const sec = dataValues.filter((d) => d.secretEnv);
    const lines = [`// Test data for "${oneLine(rec.name)}" (generated by Vortex). Edit values here, not in the test.`];
    lines.push('export const data = {', ...plain.map((d) => `  ${camel(d.key.split('_'))}: ${ts(d.text!)},`), '} as const;');
    if (sec.length) {
      lines.push('', ...SECRET, '', '/** Sensitive values come from environment variables; Vortex never stores them. */', 'export const secrets = {', ...sec.map((d) => `  ${camel(d.key.split('_'))}: () => secret(${ts(d.secretEnv!)}),`), '};');
    }
    add(`${dataFile}.ts`, lines);
  }

  // the spec
  const used = pages.filter((p) => usedPages.has(p));
  const hasSecrets = dataValues.some((d) => d.secretEnv);
  const hasData = dataValues.some((d) => d.text !== undefined);
  const imports = [`import { expect, test } from '../fixtures';`, `import { bundleId${ctx.usesId ? ', id' : ''} } from '../pages/app';`];
  for (const p of webPages) imports.push(`import { ${webClass(p)} } from '../pages/${webClass(p)}';`);
  const dataNames = [hasData ? 'data' : '', hasSecrets ? 'secrets' : ''].filter(Boolean);
  if (dataNames.length) imports.push(`import { ${dataNames.join(', ')} } from '../${dataFile}';`);
  const spec = [...header(rec, 'POM', o.size), ...imports, '', 'test.use({ autoAppLaunch: false });', ''];
  const fixtures = ['device', 'screen', ...used.map(pageVar)];
  spec.push(...(b.some(l=>l.includes('assertCoordinateScreen(screen)'))?[`import { assertCoordinateScreen } from '../pages/app';`,'']:[]));
  spec.push(`test(${ts(rec.name)}, async ({ ${fixtures.join(', ')} }) => {`);
  if(rec.events[0]?.action.type!=='launch_app')spec.push('  await device.launchApp(bundleId);');
  spec.push('  let appClosed = false;', '  try {');
  if (!b.length) spec.push('    // no steps recorded yet');
  for (const l of b) spec.push(l ? '    ' + l : '');
  spec.push('  } finally {', '    if (!appClosed) await device.terminateApp(bundleId);', '  }', '});');
  // `expect` and `screen` are always imported/destructured for consistency; drop them when unused so linters stay quiet.
  let specText = spec.join('\n');
  const bodyText = b.join('\n');
  if (!/\bexpect\(/.test(bodyText)) specText = specText.replace(`import { expect, test } from '../fixtures';`, `import { test } from '../fixtures';`);
  if (!/\bscreen\./.test(bodyText)) specText = specText.replace(`async ({ device, screen`, `async ({ device`);
  files.push({ path: `mobilewright/pom/tests/${o.caseSlug}.test.ts`, content: specText + '\n', framework: 'mobilewright', variant: 'pom', role: 'entry' });
  return { files, issues: ctx.issues };
}
