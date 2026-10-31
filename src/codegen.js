// Turns recorded steps into a MobileWright test in the same style as the existing specs:
//   import { expect, test } from '@mobilewright/test';  test.use({ autoAppLaunch: false });
//   device.launchApp(...) / device.terminateApp(...)  and  screen.getByText / getByLabel / getByTestId ...
//
// Every step is emitted as:  pre-assertion  ->  action  ->  post-assertion(s)

import { q } from './locators.js';

const needsVisibleFirst = new Set(['text', 'contains', 'checked', 'unchecked', 'selected', 'unselected']);

export function assertionLines(a, used) {
  const e = a.expr;
  const lines = [];
  if (needsVisibleFirst.has(a.assertion)) lines.push(`await expect(${e}).toBeVisible();`);
  switch (a.assertion) {
    case 'visible':
      lines.push(`await expect(${e}).toBeVisible();`);
      break;
    case 'hidden':
      used?.add('not.toBeVisible()');
      lines.push(`await expect(${e}).not.toBeVisible();`);
      break;
    case 'enabled':
      lines.push(`await expect(${e}).toBeEnabled();`);
      break;
    case 'disabled':
      used?.add('not.toBeEnabled()');
      lines.push(`await expect(${e}).not.toBeEnabled();`);
      break;
    case 'text':
      lines.push(`expect(await ${e}.getText()).toBe(${q(a.expected ?? '')});`);
      break;
    case 'contains':
      lines.push(`expect(await ${e}.getText()).toContain(${q(a.expected ?? '')});`);
      break;
    case 'checked':
      lines.push(`expect(await ${e}.isChecked()).toBe(true);`);
      break;
    case 'unchecked':
      lines.push(`expect(await ${e}.isChecked()).toBe(false);`);
      break;
    case 'selected':
      lines.push(`expect(await ${e}.isSelected()).toBe(true);`);
      break;
    case 'unselected':
      lines.push(`expect(await ${e}.isSelected()).toBe(false);`);
      break;
    case 'count':
      used?.add('count()');
      lines.push(`expect(await ${e}.count()).toBe(${Number(a.expected) || 0});`);
      break;
    default:
      lines.push(`// unsupported assertion: ${a.assertion}`);
  }
  return lines;
}

function describe(st) {
  const t = st.title ? ` "${st.title}"` : '';
  switch (st.type) {
    case 'tap': return `Tap${t}`;
    case 'longpress': return `Long-press${t}`;
    case 'doubletap': return `Double-tap${t}`;
    case 'swipe': return `Swipe ${st.args?.direction}`;
    case 'scroll_to': return `Scroll to${t}`;
    case 'type': return `Type into${t}`;
    case 'press': return `Press ${st.args?.key}`;
    case 'wait_visible': return `Wait for${t} to appear`;
    case 'wait_hidden': return `Wait for${t} to disappear`;
    case 'sleep': return `Wait ${st.args?.ms} ms`;
    case 'assert': return `Check${t} (${st.args?.assertion})`;
    default: return st.type;
  }
}

function stepLines(st, n, used, size, helper) {
  const out = [`// ${n}. ${describe(st)}`];
  const T = st.target;
  const E = T?.expr;
  const coord = !T || T.kind === 'coordinate' || !E;
  const pre = st.pre !== false;
  const warn = T?.warnings?.length && !coord ? `// note: ${T.warnings[0]}` : null;
  if (T?.kind === 'nth') used.add('nth()');

  switch (st.type) {
    case 'tap':
    case 'longpress':
    case 'doubletap': {
      const ratio = size ? ` (${(st.x / size.width).toFixed(3)}, ${(st.y / size.height).toFixed(3)}) of ${size.width}x${size.height}` : '';
      const mode = coord ? 'coord' : st.type === 'tap' ? st.mode || 'both' : 'name';
      if (coord) {
        out.push(`await screen.tap(${st.x}, ${st.y}); // unlabeled element at${ratio || ' the recorded position'}${st.asset ? `; template image: assets/${st.asset}` : ''}`);
        if (st.type !== 'tap') out.push(`// TODO: this was a ${st.type}; coordinate ${st.type} is not generated, replace with a locator-based ${st.type}`);
      } else if (mode === 'coord') {
        out.push(`await screen.tap(${st.x}, ${st.y}); // coordinate tap${ratio}; name-based locator would be: ${E}`);
      } else if (mode === 'both') {
        helper.used = true;
        if (warn) out.push(warn);
        out.push(`await tapOrAt(${E}, ${st.x}, ${st.y}); // by name; falls back to${ratio} if not found or not tappable`);
      } else {
        if (warn) out.push(warn);
        if (pre) out.push(`await expect(${E}).toBeVisible();`);
        const method = { tap: 'tap', longpress: 'longPress', doubletap: 'doubleTap' }[st.type];
        if (st.type === 'longpress') used.add('longPress()');
        out.push(`await ${E}.${method}();`);
      }
      break;
    }
    case 'swipe':
      out.push(`await screen.swipe('${st.args.direction}', { distance: ${st.args.distance} });`);
      break;
    case 'scroll_to':
      if (coord) out.push(`await screen.swipe('up', { distance: 700 }); // no locator for the target: scroll by distance`);
      else out.push(`await ${E}.scrollIntoViewIfNeeded();`);
      break;
    case 'type':
      if (coord) {
        out.push(`await screen.tap(${st.x}, ${st.y}); // input field without a locator`);
        out.push(`// TODO: type ${q(st.args.text)} here (a locator-based fill is not possible for this field)`);
      }
      else {
        if (warn) out.push(warn);
        if (pre) out.push(`await expect(${E}).toBeVisible();`);
        out.push(`await ${E}.fill(${q(st.args.text)});`);
      }
      break;
    case 'press':
      if (!['BACK', 'HOME'].includes(st.args.key)) used.add(`pressButton('${st.args.key}')`);
      out.push(`await screen.pressButton('${st.args.key}');`);
      break;
    case 'wait_visible':
      out.push(`await expect(${E}).toBeVisible();`);
      break;
    case 'wait_hidden':
      used.add('not.toBeVisible()');
      out.push(`await expect(${E}).not.toBeVisible();`);
      break;
    case 'sleep':
      out.push(`await new Promise((resolve) => setTimeout(resolve, ${Number(st.args.ms) || 1000})); // prefer a wait-for-element step`);
      break;
    case 'assert':
      out.push(...assertionLines({ assertion: st.args.assertion, expr: E, expected: st.args.expected }, used));
      break;
    default:
      out.push(`// unsupported step type: ${st.type}`);
  }

  const post = (st.post || []).filter((p) => p.expr);
  if (post.length) {
    out.push('// then:');
    for (const p of post) out.push(...assertionLines(p, used));
  }
  if (st.settleMs > 3000) out.push(`// the screen took about ${(st.settleMs / 1000).toFixed(1)} s to settle after this step`);
  return out;
}

export function generate(steps, { name = 'recorded flow', bundleId = 'com.yourname.tradehub', size } = {}) {
  const used = new Set();
  const helper = { used: false };
  const body = [];
  steps.forEach((st, i) => {
    for (const line of stepLines(st, i + 1, used, size, helper)) {
      const prev = body[body.length - 1];
      if (prev === line && !line.startsWith('//')) continue; // drop identical consecutive checks
      body.push(line);
    }
  });

  const out = [];
  out.push(`import { expect, test } from '@mobilewright/test';`);
  out.push('');
  out.push('test.use({ autoAppLaunch: false });');
  out.push('');
  out.push(`const bundleId = ${q(bundleId)};`);
  out.push('const id = (name: string) => `${bundleId}:id/${name}`;');
  out.push('');
  if (used.size) out.push(`// Verify on first run (not confirmed in the MobileWright docs): ${[...used].join(', ')}`);
  out.push(`test(${q(name)}, async ({ device, screen }) => {`);
  if (helper.used) {
    out.push('  // Tap by locator; if the element is not found or cannot be tapped, tap the position recorded while recording.');
    out.push('  const tapOrAt = async (target: { exists(): Promise<boolean>; tap(): Promise<void> }, x: number, y: number) => {');
    out.push('    try {');
    out.push('      if (await target.exists()) {');
    out.push('        await target.tap();');
    out.push('        return;');
    out.push('      }');
    out.push('    } catch {');
    out.push('      // fall through to the coordinate tap');
    out.push('    }');
    out.push('    await screen.tap(x, y);');
    out.push('  };');
    out.push('');
  }
  out.push('  await device.launchApp(bundleId);');
  out.push('  try {');
  if (!body.length) out.push('    // no steps recorded yet');
  for (const l of body) out.push(l ? '    ' + l : '');
  out.push('  } finally {');
  out.push('    await device.terminateApp(bundleId);');
  out.push('  }');
  out.push('});');
  out.push('');
  return out.join('\n');
}
