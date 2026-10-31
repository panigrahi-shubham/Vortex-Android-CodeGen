import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { appNodes, hashNodes, detectPackage, toNested } from './tree.js';
import { annotate } from './locators.js';
import { suggest } from './suggest.js';
import { generate } from './codegen.js';
import { createRealDevice, createMockDevice, makeLock } from './device.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

// ---- CLI / env options -------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(`--${name}`);
const opt = (name, env, dflt) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : process.env[env] || dflt;
};
const opts = {
  mock: flag('mock'),
  port: Number(opt('port', 'PORT', 4700)),
  pkg: opt('pkg', 'PKG', 'com.yourname.tradehub'),
  serial: opt('device', 'DEVICE', ''),
  outDir: path.resolve(opt('out', 'OUT_DIR', path.join(ROOT, 'generated'))),
  treeCmd: opt('tree-cmd', 'TREE_CMD', 'mobilecli dump ui'),
  treeSource: opt('tree-source', 'TREE_SOURCE', 'auto'), // auto | mobilecli | uiautomator
  noOpen: flag('no-open'),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[tphub]', ...a);

const oneAtATime = makeLock();
let device;
let state = { nodes: [], size: { width: 1080, height: 2400 } };

async function getDevice() {
  if (device) return device;
  device = opts.mock
    ? createMockDevice(path.join(ROOT, 'samples'))
    : await createRealDevice({ serial: opts.serial, treeCmd: opts.treeCmd, treeSource: opts.treeSource, log });
  return device;
}

function pngSize(buf) {
  if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  return null;
}

let pkgChangedFrom = null;

function annotatedApp(rawNodes) {
  let nodes = appNodes(rawNodes, opts.pkg);
  if (!nodes.length) {
    // The configured package is not on screen: switch to the app that is, so the user is not left with an empty screen.
    const found = detectPackage(rawNodes);
    if (found && found !== opts.pkg) {
      log(`package "${opts.pkg}" not found on screen; switching to "${found}"`);
      pkgChangedFrom = opts.pkg;
      opts.pkg = found;
      nodes = appNodes(rawNodes, opts.pkg);
    }
  }
  annotate(nodes, opts.pkg);
  return nodes;
}

async function capture() {
  const dev = await getDevice();
  const [shot, raw] = await Promise.all([dev.screenshot(), dev.tree()]);
  const nodes = annotatedApp(raw);
  const size = pngSize(shot) || (await dev.size());
  state = { nodes, size, raw, shot };
  return payload(shot, nodes, size, dev);
}

function payload(shot, nodes, size, dev) {
  const changed = pkgChangedFrom;
  pkgChangedFrom = null;
  return {
    pkgChangedFrom: changed,
    img: 'data:image/png;base64,' + shot.toString('base64'),
    width: size.width,
    height: size.height,
    pkg: opts.pkg,
    source: dev.source,
    device: dev.serial,
    appVisible: nodes.length > 0,
    nodes: nodes.map((n) => ({
      id: n.id,
      parentId: n.parentId,
      depth: n.depth,
      type: n.type,
      text: n.text,
      label: n.label,
      identifier: n.identifier,
      placeholder: n.placeholder,
      rect: n.rect,
      checked: n.checked,
      enabled: n.enabled,
      selected: n.selected,
      target: n.target,
      options: n.options,
    })),
  };
}

// Poll the tree until two consecutive dumps match. Returns the elapsed time so slow screens can be flagged.
async function settle(dev, maxMs = 8000) {
  const t0 = Date.now();
  let prev = null;
  await sleep(250);
  for (;;) {
    const nodes = appNodes(await dev.tree(), opts.pkg);
    const h = hashNodes(nodes);
    if (prev !== null && h === prev) break;
    prev = h;
    if (Date.now() - t0 > maxMs) break;
    await sleep(300);
  }
  return Date.now() - t0;
}

async function action(body) {
  const dev = await getDevice();
  const before = state.nodes;
  switch (body.kind) {
    case 'tap': await dev.tap(body.x, body.y); break;
    case 'doubletap': await dev.doubletap(body.x, body.y); break;
    case 'longpress': await dev.longpress(body.x, body.y); break;
    case 'swipe': await dev.swipe(body.x, body.y, body.x2, body.y2, body.duration || 350); break;
    case 'text':
      await dev.tap(body.x, body.y);
      await sleep(350);
      await dev.text(body.text);
      break;
    case 'key': await dev.key(body.key); break;
    case 'scroll': {
      const { width, height } = state.size;
      await dev.swipe(Math.round(width / 2), Math.round(height * 0.7), Math.round(width / 2), Math.round(height * 0.3), 400);
      break;
    }
    default: throw new Error('unknown action ' + body.kind);
  }
  const settleMs = await settle(dev);
  const screen = await capture();
  const suggestions = body.kind === 'swipe' || body.kind === 'scroll' ? [] : suggest(before, state.nodes, state.size.height);
  return { screen, settleMs, suggestions };
}

// ---- HTTP ---------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const json = (res, code, obj) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

const safeName = (s) => String(s || 'recorded-flow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'recorded-flow';

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(fs.readFileSync(path.join(ROOT, 'public', 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, 200, { pkg: opts.pkg, mock: opts.mock, outDir: opts.outDir, treeSource: opts.treeSource });
    }
    if (req.method === 'POST' && url.pathname === '/api/config') {
      const b = await readBody(req);
      if (b.pkg) opts.pkg = String(b.pkg).trim();
      return json(res, 200, { pkg: opts.pkg });
    }
    if (req.method === 'GET' && url.pathname === '/api/screen') return json(res, 200, await oneAtATime(() => capture()));
    if (req.method === 'POST' && url.pathname === '/api/action') {
      const body = await readBody(req);
      return json(res, 200, await oneAtATime(() => action(body)));
    }
    if (req.method === 'POST' && url.pathname === '/api/generate') {
      const b = await readBody(req);
      return json(res, 200, { code: generate(b.steps || [], { name: b.name || 'recorded flow', bundleId: b.pkg || opts.pkg, size: state.size }) });
    }
    if (req.method === 'POST' && url.pathname === '/api/debug') {
      // Saves exactly what the phone exposes right now (full tree + screenshot) so element problems can be diagnosed.
      if (!state.raw) return json(res, 400, { error: 'no screen captured yet' });
      const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
      const d = path.join(opts.outDir, 'debug');
      fs.mkdirSync(d, { recursive: true });
      const treeFile = path.join(d, `snapshot-${stamp}.json`);
      fs.writeFileSync(treeFile, JSON.stringify(toNested(state.raw), null, 2), 'utf8');
      fs.writeFileSync(path.join(d, `snapshot-${stamp}.png`), state.shot);
      return json(res, 200, { file: treeFile });
    }
    if (req.method === 'POST' && url.pathname === '/api/save') {
      const b = await readBody(req);
      const base = safeName(b.name);
      fs.mkdirSync(path.join(opts.outDir, 'assets'), { recursive: true });
      const file = path.join(opts.outDir, `${base}.spec.ts`);
      fs.writeFileSync(file, b.code, 'utf8');
      for (const a of b.assets || []) {
        const m = /^data:image\/png;base64,(.+)$/.exec(a.dataUrl || '');
        if (m) fs.writeFileSync(path.join(opts.outDir, 'assets', path.basename(a.name)), Buffer.from(m[1], 'base64'));
      }
      return json(res, 200, { file });
    }
    json(res, 404, { error: 'not found' });
  } catch (e) {
    log('error:', e.message);
    json(res, 500, { error: e.message });
  }
});

server.listen(opts.port, '127.0.0.1', () => {
  const url = `http://localhost:${opts.port}`;
  log(`recorder running at ${url}  (${opts.mock ? 'MOCK device' : 'real device'}, package ${opts.pkg})`);
  log(`saved specs go to ${opts.outDir}`);
  if (!opts.noOpen && process.platform === 'win32') exec(`start "" ${url}`);
});
