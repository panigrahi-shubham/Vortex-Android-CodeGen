import { runChecks } from './doctor.js';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';
import { appNodes, hashNodes, detectPackage, toNested } from './tree.js';
import { annotate } from './locators.js';
import { suggest } from './suggest.js';
import { generate } from './codegen.js';
import { createRealDevice, createMockDevice, makeLock, assertPackage } from './device.js';
import { checkLocalRequest } from './http-guard.js';
import { acquireRecorderOwner } from './recorder-owner.js';
import { randomUUID, createHash } from 'node:crypto';
import { observeCompletedAction } from './action-result.js';
import { createDraftStore } from './draft-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const VERSION=JSON.parse(fs.readFileSync(path.join(ROOT,'package.json'),'utf8')).version;

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
  stateDir: path.resolve(opt('state-dir', 'VORTEX_STATE_DIR', path.join(ROOT, '.vortex'))),
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log('[vortex]', ...a);

const oneAtATime = makeLock();
const draftLock = makeLock();
const drafts = createDraftStore(opts.stateDir);

// Project, run and device services need Node.js 22.18+ (TypeScript type stripping).
// On older Node the recorder itself keeps working; only those panels report that they are unavailable.
let vortex = null;
let vortexUnavailable = null;
let ready = false;
let recorderOwner;
let stateOwner;
async function initialize() {
  try {
  const { createVortex } = await import('./vortex/index.ts');
  vortex = await createVortex({ root: ROOT, stateDir: opts.stateDir, mock: opts.mock, log });
  } catch (e) {
  vortexUnavailable = `MobileWright services are unavailable: it needs Node.js 22.18 or newer (this is ${process.version}). ${e.message.split('\n')[0]}`;
  log(vortexUnavailable);
  }
}
let device;
let state = { nodes: [], size: { width: 1080, height: 2400 } };

function localMobilecli() {
  for (const start of [opts.outDir, ROOT]) {
    let dir = start;
    for (;;) {
      const entry = path.join(dir, 'node_modules', 'mobilecli', 'index.js');
      if (fs.existsSync(entry)) return entry;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

async function getDevice() {
  if (device) return device;
  device = opts.mock
    ? createMockDevice(path.join(ROOT, 'samples'))
    : await createRealDevice({ serial: opts.serial, treeCmd: opts.treeCmd, treeSource: opts.treeSource, mobilecli: localMobilecli(), log });
  return device;
}

async function withRecorder(fn) {
  return oneAtATime(async () => {
    const dev = await getDevice();
    const release = vortex?.leases.acquire(dev.serial, { kind: 'recorder', id: randomUUID(), label: 'Recording' });
    let result;
    try { result = await fn(); } finally { release?.(); }
    return result;
  });
}

function pngSize(buf) {
  if (buf.length > 24 && buf.toString('ascii', 1, 4) === 'PNG') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  return null;
}

let pkgChangedFrom = null;

const currentSerial = () => (device ? device.serial : opts.mock ? 'mock-device' : opts.serial || null);
const recorderContext = {
  outDir: () => opts.outDir,
  pkg: () => opts.pkg,
  size: () => state.size || null,
  serial: currentSerial,
  activity: () => state.activity || null,
  nativeTypes: () => [...new Set((state.raw || []).map((n) => n.type))],
  screenshot: () => state.shot || null,
};

function annotatedApp(rawNodes) {
  let nodes = appNodes(rawNodes, opts.pkg);
  if (!nodes.length) {
    // Inspect another foreground app without replacing the configured launch target.
    const found = detectPackage(rawNodes);
    // A test fixture commonly terminates the app during cleanup. Do not mistake
    // the Android home screen for a newly selected application and overwrite the
    // configured package; the next run must still launch the selected app.
    const isLauncher = !!found && /(?:^|\.)(?:launcher|launcher3|nexuslauncher)(?:$|\.)/i.test(found);
    if (found && found !== opts.pkg && !isLauncher) {
      log(`package "${opts.pkg}" not found on screen; inspecting "${found}" while keeping the launch target`);
      // Inspect the foreground screen without changing the user's launch target.
      // Otherwise opening Settings or a picker makes Launch app launch that app.
      nodes = appNodes(rawNodes, found);
    }
  }
  annotate(nodes, opts.pkg);
  return nodes;
}

async function capture(settledRaw) {
  const dev = await getDevice();
  const began=performance.now();
  try {
  const [shot, raw, activity] = await Promise.allSettled([dev.screenshot(), settledRaw ?? readTree(dev), dev.activity ? dev.activity().catch(() => null) : null]).then((results) => {
    const failure = results.find((r) => r.status === 'rejected');
    if (failure) throw failure.reason;
    return results.map((r) => r.value);
  });
  const nodes = annotatedApp(raw);
  const size = pngSize(shot) || (await dev.size());
  state = { nodes, size, raw, shot, activity, screenId: randomUUID(), captureMs: Math.round(performance.now()-began) };
  return payload(shot, nodes, size, dev, activity);
  } catch(error) {
    state={...state,nodes:[],raw:[],invalid:true,screenId:randomUUID()};
    throw error;
  }
}

const readTree = (dev) => dev.tree();

function payload(shot, nodes, size, dev, activity) {
  const changed = pkgChangedFrom;
  pkgChangedFrom = null;
  return {
    screenId: state.screenId,
    pkgChangedFrom: changed,
    img: 'data:image/png;base64,' + shot.toString('base64'),
    width: size.width,
    height: size.height,
    pkg: opts.pkg,
    source: dev.source,
    device: dev.serial,
    activity: activity || null,
    captureMs: state.captureMs,
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
      visible: n.visible,
      target: n.target,
      options: n.options,
    })),
  };
}

// Poll the tree until two consecutive dumps match. Returns the elapsed time so slow screens can be flagged.
async function settle(dev, maxMs = 8000) {
  const t0 = Date.now();
  let prev = null;
  let raw;
  let matched=false;
  await sleep(250);
  for (;;) {
    raw = await readTree(dev);
    const nodes = appNodes(raw, opts.pkg);
    const h = hashNodes(nodes);
    if (prev !== null && h === prev) {matched=true;break;}
    prev = h;
    if (Date.now() - t0 > maxMs) break;
    await sleep(300);
  }
  return { ms: Date.now() - t0, raw, stable:matched };
}

async function action(body) {
  const dev = await getDevice();
  const began=performance.now();
  if (state.invalid) throw Object.assign(new Error('The last screen capture failed. Refresh before recording another action.'), { httpStatus: 409, code: 'STALE_SCREEN' });
  if (body.screenId && body.screenId !== state.screenId) throw Object.assign(new Error('The screen changed in another view. Refresh before recording this action.'), { httpStatus: 409, code: 'STALE_SCREEN' });
  const before = state.nodes;
  const beforeShot = state.shot;
  if (['tap','doubletap','longpress','text','clear','swipe'].includes(body.kind)) {
    if (!state.screenId || !body.screenId) throw Object.assign(new Error('Refresh and supply the current screen before a device action.'),{httpStatus:409,code:'STALE_SCREEN'});
    if (![body.x,body.y].every(Number.isFinite) || body.x<0 || body.y<0 || body.x>=state.size.width || body.y>=state.size.height) throw Object.assign(new Error('The action coordinates are outside the captured screen.'),{httpStatus:400,code:'BAD_COORDINATES'});
  }
  switch (body.kind) {
    case 'web': throw Object.assign(new Error('DOM recording is unavailable in this MobileWright recorder. Use exposed text/ID or explicit coordinates.'), { httpStatus: 422 });
    case 'tap': await dev.tap(body.x, body.y); break;
    case 'doubletap': await dev.doubletap(body.x, body.y); break;
    case 'longpress': await dev.longpress(body.x, body.y); break;
    case 'swipe': await dev.swipe(body.x, body.y, body.x2, body.y2, body.duration || 350); break;
    case 'text': {
      const input = state.nodes.find((n) => n.id === body.nodeId);
      if (!input || input.visible===false || !/EditText|TextField/i.test(input.type) || !input.target?.parts || input.target.kind === 'coordinate' || input.target.viaAncestor) {
        throw new Error('Refresh and choose an editable field with a replayable locator before typing.');
      }
      await dev.replaceText(input.rect.x + input.rect.w / 2, input.rect.y + input.rect.h / 2);
      await dev.text(body.text);
      break;
    }
    case 'key': await dev.key(body.key); break;
    case 'clear': await dev.clearText(body.x, body.y, body.length); break;
    case 'hide_keyboard': await dev.hideKeyboard(); break;
    case 'launch_app': await dev.launchApp(opts.pkg); break;
    case 'close_app': await dev.closeApp(opts.pkg); break;
    case 'deep_link': await dev.openUrl(body.url, opts.pkg); break;
    case 'scroll': {
      const { width, height } = state.size;
      await dev.swipe(Math.round(width / 2), Math.round(height * 0.7), Math.round(width / 2), Math.round(height * 0.3), 400);
      break;
    }
    default: throw new Error('unknown action ' + body.kind);
  }
  const actionMs=Math.round(performance.now()-began);
  return observeCompletedAction(async () => {
    const policy=body.capturePolicy==='stable'?'stable':'fast';
    const observedAt=performance.now();
    const settled = policy==='stable'?await settle(dev):null;
    if (!settled) await sleep(150);
    const screen = await capture(settled?.raw);
    const raw = ['swipe', 'scroll', 'hide_keyboard', 'checkpoint'].includes(body.kind) ? [] : suggest(before, state.nodes, state.size.height);
    const suggestions = vortex ? vortex.refineSuggestions(raw) : raw;
    const screenChange = vortex ? vortex.changeBetween(beforeShot, state.shot) : null;
    return { screen, settleMs: Math.round(performance.now()-observedAt), suggestions, screenChange, timings:{actionMs,captureMs:screen.captureMs,totalMs:Math.round(performance.now()-began),policy,stable:settled?.stable??false} };
  }, () => {
    state = { ...state, nodes: [], raw: [], screenId: randomUUID(), invalid: true };
  });
}

// ---- HTTP ---------------------------------------------------------------------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes=0;
    req.on('data', (c) => {bytes+=c.length;if(bytes>10*1024*1024){reject(Object.assign(new Error('Request exceeds 10 MB.'),{httpStatus:413}));return;}chunks.push(c);});
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
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control':'no-store' });
  res.end(JSON.stringify(obj));
};

const safeName = (s) => String(s || 'recorded-flow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'recorded-flow';

const server = http.createServer(async (req, res) => {
  if (!ready) return json(res, 503, { error: 'Recorder is starting. Retry shortly.' });
  const url = new URL(req.url, 'http://localhost');
  const blocked = checkLocalRequest(req, opts.port);
  if (blocked) {
    log(blocked);
    return json(res, 403, { error: blocked });
  }
  try {
    if (vortex) {
      if (await vortex.handle(req, res, url, json, readBody, recorderContext)) return;
    } else if (/^\/api\/(automation|devices|tests|runs|reports|bench|project|mobilewright|visual)\b/.test(url.pathname)) {
      return json(res, 501, { error: vortexUnavailable, code: 'UNAVAILABLE' });
    }
    // A recorder action must not drive the phone while a test run owns it.
    if ((url.pathname === '/api/screen' || url.pathname === '/api/action') && vortex) {
      try {
        vortex.assertDeviceFree(currentSerial());
      } catch (e) {
        return json(res, e.httpStatus || 409, { error: e.message, code: e.code || 'DEVICE_BUSY' });
      }
    }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': MIME['.html'] });
      return res.end(fs.readFileSync(path.join(ROOT, 'public', 'index.html')));
    }
    if (req.method === 'GET' && url.pathname === '/recording-tools.js') {
      res.writeHead(200,{'Content-Type':MIME['.js'],'Cache-Control':'no-store'});
      return res.end(fs.readFileSync(path.join(ROOT,'public','recording-tools.js')));
    }
    if (req.method === 'GET' && url.pathname === '/api/draft') return json(res,200,await draftLock(async()=>drafts.read()));
    if (req.method === 'POST' && url.pathname === '/api/draft') {
      const body=await readBody(req);
      return json(res,200,await draftLock(async()=>drafts.write(body.data??null,body.revision)));
    }
    if (req.method === 'GET' && url.pathname === '/api/setup') {
      const r = await runChecks({ outDir: opts.outDir, mock: opts.mock });
      return json(res, 200, { ...r, mock: opts.mock });
    }
    if (req.method === 'GET' && url.pathname === '/api/config') {
      return json(res, 200, { version:VERSION, pkg: opts.pkg, mock: opts.mock, outDir: opts.outDir, treeSource: opts.treeSource, engine: 'mobilewright', services: vortex ? 'available' : vortexUnavailable });
    }
    if (req.method === 'POST' && url.pathname === '/api/config') {
      const b = await readBody(req);
      if (b.pkg) {
        const pkg=String(b.pkg).trim();assertPackage(pkg);
        if(pkg!==opts.pkg){opts.pkg=pkg;state={...state,nodes:[],raw:[],invalid:true,screenId:randomUUID()};}
      }
      return json(res, 200, { pkg: opts.pkg });
    }
    if (req.method === 'POST' && url.pathname === '/api/record/stop') {
      await oneAtATime(async () => {});
      return json(res, 200, { stopped: true });
    }
    if (req.method === 'GET' && url.pathname === '/api/screen') return json(res, 200, await withRecorder(() => capture()));
    if (req.method === 'POST' && url.pathname === '/api/action') {
      const body = await readBody(req);
      return json(res, 200, await withRecorder(() => action(body)));
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
    json(res, e.httpStatus || 500, { error: e.message, code: e.code });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    log(`recorder is already running at http://127.0.0.1:${opts.port}. Open that existing Vortex window, or stop its recorder process before starting another.`);
  } else {
    log(`could not start the recorder on 127.0.0.1:${opts.port}:`, e.message);
  }
  // A duplicate process must leave the running recorder and its work alone.
  process.exit(1);
});

// Bind the UI port before recovering interrupted runs.
await new Promise((resolve) => server.listen(opts.port, '127.0.0.1', resolve));
try {
  if (!opts.mock) recorderOwner = await acquireRecorderOwner();
  // Mock instances may coexist, but no two instances may recover the same state.
  fs.mkdirSync(opts.stateDir, { recursive: true });
  const stateKey = fs.realpathSync(opts.stateDir);
  const normalized = process.platform === 'win32' ? stateKey.toLowerCase() : stateKey;
  const statePort = 20000 + createHash('sha256').update(normalized).digest().readUInt32BE(0) % 20000;
  stateOwner = await acquireRecorderOwner(statePort);
} catch (e) {
  log(e.message);
  server.close();
  process.exit(1);
}
await initialize();
ready = true;
{
  const url = `http://localhost:${opts.port}`;
  log(`recorder running at ${url}  (${opts.mock ? 'MOCK device' : 'real device'}, package ${opts.pkg})`);
  log(`saved specs go to ${opts.outDir}`);
  if (!opts.noOpen && process.platform === 'win32') exec(`start "" ${url}`);
}

// Stop only work owned by this recorder on exit.
let shuttingDown = false;
async function shutdown(sig) {
  if (shuttingDown) return;
  shuttingDown = true;
  log(`${sig} received, shutting down`);
  try {
    const r = vortex && (await vortex.shutdown());
    if (r) for (const st of r.steps) log('[server]', `${st.ok ? 'ok ' : 'FAIL'} ${st.step}: ${st.detail}`);
  } catch (e) {
    log('[server] shutdown error:', e.message);
  }
  server.close();
  recorderOwner?.close();
  stateOwner?.close();
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) {
  try {
    process.on(sig, () => void shutdown(sig));
  } catch {
    /* signal not supported on this platform */
  }
}
