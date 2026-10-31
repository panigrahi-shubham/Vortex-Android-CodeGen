// Chooses the most stable MobileWright locator for a tree node.
//
// Preference order (quality score):
//   100  getByTestId   unique resource-id
//    85  getByLabel    unique content-description
//    75  getByText     unique visible text
//    60  scoped        repeated container narrowed by a unique child text  (.filter({ has: ... }))
//    55  label/text that is unique but looks dynamic (count, time, price)
//    40  .nth(i)       position-based, last resort
//    10  coordinate    nothing usable on the element -> recorded as a coordinate tap

const DYN = /[₹$€£]\s?\d|\b\d{1,2}:\d{2}|(^|[\s,(])\d+([.,]\d+)*\s+[a-z%]|^\d+([.,]\d+)*$|\d+\s?%/i;
export const isDynamic = (s) => DYN.test(s || '');

const norm = (s) => String(s || '').trim().toLowerCase();

export const q = (s) =>
  "'" + String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '\\n') + "'";

// Ids in the app's own package are written as id('name'); other packages stay as full strings.
export function idExpr(identifier, pkg) {
  const p = pkg + ':id/';
  return identifier.startsWith(p) ? `id(${q(identifier.slice(p.length))})` : q(identifier);
}

export function makeContext(nodes, pkg) {
  const byId = new Map();
  for (const n of nodes) {
    if (!n.identifier) continue;
    if (!byId.has(n.identifier)) byId.set(n.identifier, []);
    byId.get(n.identifier).push(n.id);
  }
  // getByText / getByLabel may match by substring, so uniqueness is judged conservatively:
  // a string counts as unique only if exactly one node contains it in its text or label.
  const cache = new Map();
  const matches = (str) => {
    const k = norm(str);
    if (cache.has(k)) return cache.get(k);
    const ids = k ? nodes.filter((n) => norm(n.text).includes(k) || norm(n.label).includes(k)).map((n) => n.id) : [];
    cache.set(k, ids);
    return ids;
  };
  return { nodes, pkg, byId, matches };
}

const area = (n) => Math.max(0, n.rect.w) * Math.max(0, n.rect.h);

function descendants(n, ctx) {
  const out = [];
  const walk = (id) => {
    for (const c of ctx.nodes[id].childIds) {
      out.push(ctx.nodes[c]);
      walk(c);
    }
  };
  walk(n.id);
  return out;
}

function innerWithin(c, inside, ctx) {
  const same = (f, v) => inside.filter((x) => x[f] === v).length;
  if (c.identifier && same('identifier', c.identifier) === 1) return `getByTestId(${idExpr(c.identifier, ctx.pkg)})`;
  if (c.label && same('label', c.label) === 1) return `getByLabel(${q(c.label)})`;
  if (c.text && same('text', c.text) === 1) return `getByText(${q(c.text)})`;
  return null;
}

// Repeated container (same id many times, e.g. list rows) narrowed by a child text that is unique on screen.
function scopedIn(container, c, ctx) {
  const inside = descendants(container, ctx);
  const anchor = inside.find((x) => x.id !== c.id && x.text && !isDynamic(x.text) && ctx.matches(x.text).length === 1);
  if (!anchor) return null;
  const base = `screen.getByTestId(${idExpr(container.identifier, ctx.pkg)}).filter({ has: screen.getByText(${q(anchor.text)}) })`;
  if (container.id === c.id) return { kind: 'scoped', expr: base, quality: 60, warnings: [] };
  const inner = innerWithin(c, inside, ctx);
  if (!inner) return null;
  return { kind: 'scoped', expr: `${base}.${inner}`, quality: 60, warnings: [] };
}

function scoped(c, ctx) {
  // 1. a repeated ancestor (a list row) that contains this element
  let cur = c;
  for (let i = 0; i < 5 && cur.parentId !== null; i++) {
    cur = ctx.nodes[cur.parentId];
    if (cur.identifier && ctx.byId.get(cur.identifier).length > 1) {
      const r = scopedIn(cur, c, ctx);
      if (r) return r;
    }
  }
  // 2. the element is itself the repeated row
  if (c.identifier && ctx.byId.get(c.identifier).length > 1) return scopedIn(c, c, ctx);
  return null;
}

function bestFor(c, ctx) {
  const opts = [];
  if (c.identifier && ctx.byId.get(c.identifier).length === 1) {
    opts.push({ kind: 'testId', expr: `screen.getByTestId(${idExpr(c.identifier, ctx.pkg)})`, quality: 100, warnings: [] });
  }
  if (c.label && ctx.matches(c.label).length === 1) {
    const dyn = isDynamic(c.label);
    opts.push({
      kind: 'label',
      expr: `screen.getByLabel(${q(c.label)})`,
      quality: dyn ? 55 : 85,
      warnings: dyn ? ['label looks dynamic (count, time or price): it may change between runs'] : [],
    });
  }
  if (c.text && ctx.matches(c.text).length === 1) {
    const dyn = isDynamic(c.text);
    opts.push({
      kind: 'text',
      expr: `screen.getByText(${q(c.text)})`,
      quality: dyn ? 50 : 75,
      warnings: dyn ? ['text looks dynamic (count, time or price): it may change between runs'] : [],
    });
  }
  const top = opts.length ? opts.sort((a, b) => b.quality - a.quality)[0] : null;
  if (top && top.quality >= 75) return top;

  // weak or missing simple locator: a scoped one (repeated row + unique child text) is more stable
  const s = scoped(c, ctx);
  if (s && (!top || s.quality > top.quality)) return s;
  if (top) return top;

  if (c.identifier) {
    const ids = ctx.byId.get(c.identifier);
    return {
      kind: 'nth',
      expr: `screen.getByTestId(${idExpr(c.identifier, ctx.pkg)}).nth(${ids.indexOf(c.id)})`,
      quality: 40,
      warnings: [`position-based: ${ids.length} elements share this id`],
    };
  }
  const key = c.label || c.text;
  if (key) {
    const m = ctx.matches(key);
    const k = m.indexOf(c.id);
    if (k >= 0) {
      return {
        kind: 'nth',
        expr: `screen.${c.label ? 'getByLabel' : 'getByText'}(${q(key)}).nth(${k})`,
        quality: 35,
        warnings: ['position-based: this text is not unique'],
      };
    }
  }
  return null;
}

// Best locator for the element the user pointed at. If the element itself has nothing usable
// (for example an icon inside a labelled button) the search climbs a few levels to a close ancestor.
export function bestTarget(n, ctx) {
  const own = bestFor(n, ctx);
  if (own && own.quality >= 60) return { ...own, score: own.quality, nodeId: n.id, viaAncestor: false };
  const chain = [n];
  const a0 = area(n);
  let cur = n;
  for (let i = 0; i < 3 && cur.parentId !== null && a0 > 0; i++) {
    const p = ctx.nodes[cur.parentId];
    if (area(p) > 15 * a0) break;
    chain.push(p);
    cur = p;
  }
  let best = null;
  chain.forEach((c, i) => {
    const o = bestFor(c, ctx);
    if (!o) return;
    const score = o.quality - i * 3;
    if (!best || score > best.score) best = { ...o, score, nodeId: c.id, viaAncestor: i > 0 };
  });
  if (!best) {
    return {
      kind: 'coordinate',
      expr: null,
      quality: 10,
      score: 10,
      warnings: ['no id, label or text on this element: recorded as a coordinate tap'],
      nodeId: n.id,
      viaAncestor: false,
    };
  }
  return best;
}

// Every simple locator for one node (used by the Inspect view).
export function optionsFor(n, ctx) {
  const out = [];
  const note = (c) => (c === 1 ? 'unique' : `${c} matches`);
  if (n.identifier) out.push({ kind: 'testId', expr: `screen.getByTestId(${idExpr(n.identifier, ctx.pkg)})`, note: note(ctx.byId.get(n.identifier).length) });
  if (n.label) out.push({ kind: 'label', expr: `screen.getByLabel(${q(n.label)})`, note: note(ctx.matches(n.label).length) + (isDynamic(n.label) ? ', dynamic' : '') });
  if (n.text) out.push({ kind: 'text', expr: `screen.getByText(${q(n.text)})`, note: note(ctx.matches(n.text).length) + (isDynamic(n.text) ? ', dynamic' : '') });
  return out;
}

export function annotate(nodes, pkg) {
  const ctx = makeContext(nodes, pkg);
  for (const n of nodes) {
    n.target = bestTarget(n, ctx);
    n.options = optionsFor(n, ctx);
  }
  return ctx;
}
