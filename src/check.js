// Usage: node src/check.js <tree.json | dump.xml> [--pkg com.yourname.tradehub]
// Prints the locator the recorder would choose for each app element, so you can sanity-check
// a real tree (for example tree1.json) before recording anything.

import fs from 'node:fs';
import { parseTree, appNodes, detectPackage } from './tree.js';
import { annotate } from './locators.js';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const pi = args.indexOf('--pkg');
if (!file) {
  console.error('usage: node src/check.js <tree.json|dump.xml> [--pkg <package>]');
  process.exit(1);
}

const raw = parseTree(fs.readFileSync(file));
const pkg = pi >= 0 ? args[pi + 1] : detectPackage(raw);
if (!pkg) {
  console.error('could not detect the app package; pass --pkg');
  process.exit(1);
}
const nodes = appNodes(raw, pkg);
annotate(nodes, pkg);

console.log(`file: ${file}`);
console.log(`package: ${pkg}   all nodes: ${raw.length}   app nodes: ${nodes.length}\n`);

const counts = {};
const coord = [];
for (const n of nodes) {
  const t = n.target;
  counts[t.kind] = (counts[t.kind] || 0) + 1;
  if (t.kind === 'coordinate' && n.rect.w > 0) coord.push(n);
  const name = (n.text || n.label || n.identifier.split('/').pop() || '').slice(0, 34).padEnd(34);
  const type = n.type.split('.').pop().slice(0, 16).padEnd(16);
  console.log(`${'  '.repeat(Math.min(n.depth, 6))}${type} ${name} [${t.kind} ${t.quality}] ${t.expr || '(coordinate)'}${t.viaAncestor ? '  (via parent)' : ''}`);
}
console.log('\nlocator kinds:', counts);
if (coord.length) {
  console.log(`\nelements with no usable locator (coordinate fallback): ${coord.length}`);
  coord.slice(0, 10).forEach((n) => console.log(`  ${n.type} at x=${n.rect.x} y=${n.rect.y} ${n.rect.w}x${n.rect.h}`));
}
