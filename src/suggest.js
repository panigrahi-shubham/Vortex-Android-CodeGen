// Compares the screen before and after an action and proposes post-assertions.
// Nodes must already be annotated (node.target) by locators.annotate().

import { isDynamic } from './locators.js';

const key = (n) => `${n.identifier}|${n.text}|${n.label}`;
const tail = (n) => (n.identifier || '').split('/').pop();
const titleOf = (n) => n.text || n.label || tail(n) || n.type;

const CONTAINER = /root|container|layout|group|content|frame|wrapper|scroll|recycler|indicator/i;
const HOT = /title|header|heading|toast|snackbar|dialog|error|success|message|banner|badge/i;
const GONE = /loading|progress|spinner|dialog|snackbar|toast|popup|overlay/i;

export function suggest(prev, next, screenHeight = 2400) {
  const out = [];
  const prevKeys = new Set(prev.map(key));
  const nextKeys = new Set(next.map(key));

  const countBy = (list, id) => list.filter((n) => n.identifier === id).length;
  const prevById = new Map();
  for (const n of prev) if (n.identifier && countBy(prev, n.identifier) === 1) prevById.set(n.identifier, n);

  // 1. state changes on elements that exist in both screens (toggles, selected tab, changed text)
  for (const n of next) {
    if (!n.identifier || n.target?.kind !== 'testId') continue;
    const p = prevById.get(n.identifier);
    if (!p) continue;
    const base = { expr: n.target.expr, parts: n.target.parts, kind: 'testId', title: titleOf(n), reason: 'changed' };
    if (p.checked !== null && n.checked !== null && p.checked !== n.checked) {
      out.push({ ...base, assertion: n.checked ? 'checked' : 'unchecked' });
    } else if (p.selected !== n.selected && (p.selected || n.selected)) {
      out.push({ ...base, assertion: n.selected ? 'selected' : 'unselected' });
    } else if (n.text && p.text !== n.text && !isDynamic(n.text)) {
      out.push({ ...base, assertion: 'text', expected: n.text });
    }
  }

  // 2. new elements (new screen title, dialog, toast...)
  const scored = next
    .filter((n) => !prevKeys.has(key(n)) && n.rect.w > 0 && n.rect.h > 0 && n.rect.y < screenHeight && (n.text || n.label || n.identifier) && n.target && n.target.kind !== 'coordinate')
    .map((n) => {
      let s = n.target.quality;
      if (/TextView|Button/.test(n.type)) s += 10;
      if (HOT.test(tail(n)) || HOT.test(n.label)) s += 15;
      if (CONTAINER.test(tail(n)) && !n.text) s -= 20;
      if (!n.text && !n.label) s -= 10;
      if (n.target.kind === 'nth') s -= 15;
      return { n, s };
    })
    .filter((x) => x.s >= 60)
    .sort((a, b) => b.s - a.s);
  const seen = new Set(out.map((o) => o.expr + o.assertion));
  let appeared = 0;
  for (const { n } of scored) {
    if (appeared >= 4) break;
    const k = n.target.expr + 'visible';
    if (seen.has(k)) continue;
    seen.add(k);
    appeared++;
    out.push({ assertion: 'visible', expr: n.target.expr, parts: n.target.parts, kind: n.target.kind, title: titleOf(n), reason: 'appeared' });
  }

  // 3. things that went away (loaders, dialogs)
  prev
    .filter((n) => !nextKeys.has(key(n)) && n.identifier && GONE.test(tail(n)) && n.target?.kind === 'testId')
    .slice(0, 2)
    .forEach((n) => out.push({ assertion: 'hidden', expr: n.target.expr, parts: n.target.parts, kind: 'testId', title: titleOf(n), reason: 'disappeared' }));

  return out.slice(0, 7);
}
