import { execFile, exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseTree, appNodes } from './tree.js';

const KEYCODES = { BACK: 4, HOME: 3, ENTER: 66, APP_SWITCH: 187, RECENT: 187, DELETE: 67, TAB: 61, SEARCH: 84 };

function run(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr && stderr.toString().trim()) || err.message;
        reject(new Error(`${file} ${args.join(' ')} failed: ${msg}`));
      } else resolve(stdout);
    });
  });
}

function sh(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'buffer', maxBuffer: 128 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(new Error(`${cmd} failed: ${(stderr && stderr.toString().trim()) || err.message}`));
      else resolve(stdout);
    });
  });
}

// `adb shell input text` needs shell metacharacters escaped and spaces as %s.
export function escapeInputText(s) {
  return String(s).replace(/[^A-Za-z0-9._@%:,/+=-]/g, (c) => (c === ' ' ? '%s' : '\\' + c));
}

// Runs async jobs one at a time (two simultaneous `uiautomator dump` calls kill each other on the phone).
export function makeLock() {
  let tail = Promise.resolve();
  return (fn) => {
    const job = tail.then(fn, fn);
    tail = job.catch(() => {});
    return job;
  };
}

// `adb exec-out uiautomator dump /dev/tty` can answer "Killed" or an ERROR line when the service is busy: retry a few times.
export async function dumpUiautomator(adbRun, sleepFn = (ms) => new Promise((r) => setTimeout(r, ms)), tries = 4) {
  let last = '';
  for (let i = 0; i < tries; i++) {
    last = (await adbRun(['exec-out', 'uiautomator', 'dump', '/dev/tty'])).toString();
    if (last.includes('<hierarchy') || last.includes('<node')) return last;
    await sleepFn(500 * (i + 1));
  }
  const snippet = last.trim().slice(0, 120) || '(empty output)';
  throw new Error(`uiautomator dump did not return a screen after ${tries} tries: "${snippet}". Close other automation tools (a running test, Appium, the MobileWright Inspector) and press Refresh.`);
}

export async function createRealDevice({ serial, treeCmd = 'mobilecli dump ui', treeSource = 'auto', log = console.log } = {}) {
  if (!serial) {
    const out = (await run('adb', ['devices'])).toString();
    const devs = out.split(/\r?\n/).slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p[1] === 'device').map((p) => p[0]);
    if (devs.length === 0) throw new Error('No device found. Connect the phone, enable USB debugging and check `adb devices`.');
    if (devs.length > 1) throw new Error(`Several devices connected (${devs.join(', ')}). Start with --device <serial>.`);
    serial = devs[0];
  }
  const adb = (args) => run('adb', ['-s', serial, ...args]);
  const exclusive = makeLock();
  let useMobilecli = treeSource !== 'uiautomator';
  let source = useMobilecli ? 'mobilecli' : 'uiautomator';

  const dev = {
    name: 'real',
    serial,
    get source() {
      return source;
    },
    async size() {
      const out = (await adb(['shell', 'wm', 'size'])).toString();
      const o = /Override size:\s*(\d+)x(\d+)/.exec(out) || /Physical size:\s*(\d+)x(\d+)/.exec(out);
      if (!o) throw new Error('could not read screen size: ' + out.trim());
      return { width: +o[1], height: +o[2] };
    },
    screenshot: () => adb(['exec-out', 'screencap', '-p']),
    tree: () =>
      exclusive(async () => {
        if (useMobilecli) {
          try {
            const nodes = parseTree(await sh(treeCmd));
            if (nodes.length) {
              source = 'mobilecli';
              return nodes;
            }
            throw new Error('empty tree');
          } catch (e) {
            if (treeSource === 'mobilecli') throw e;
            useMobilecli = false;
            log(`[tree] "${treeCmd}" failed (${e.message.split('\n')[0]}). Using adb uiautomator dump instead.`);
          }
        }
        source = 'uiautomator';
        return parseTree(await dumpUiautomator(adb));
      }),
    tap: (x, y) => adb(['shell', 'input', 'tap', String(x), String(y)]),
    async doubletap(x, y) {
      await dev.tap(x, y);
      await new Promise((r) => setTimeout(r, 90));
      await dev.tap(x, y);
    },
    longpress: (x, y, ms = 900) => adb(['shell', 'input', 'swipe', String(x), String(y), String(x), String(y), String(ms)]),
    swipe: (x1, y1, x2, y2, ms = 350) => adb(['shell', 'input', 'swipe', ...[x1, y1, x2, y2, ms].map(String)]),
    text: (s) => adb(['shell', 'input', 'text', escapeInputText(s)]),
    key(k) {
      const code = KEYCODES[String(k).toUpperCase()];
      if (!code) throw new Error('unknown key ' + k);
      return adb(['shell', 'input', 'keyevent', String(code)]);
    },
  };
  return dev;
}

// A tiny fake phone with two screens, so the recorder UI can be tried (and tested) without a device.
export function createMockDevice(samplesDir) {
  let screen = 'home';
  const read = (f) => fs.readFileSync(path.join(samplesDir, f));
  const nodes = () => parseTree(read(`${screen}.json`));
  const dev = {
    name: 'mock',
    serial: 'mock-device',
    source: 'mock',
    async size() {
      return { width: 1080, height: 2400 };
    },
    async screenshot() {
      return read(`${screen}.png`);
    },
    async tree() {
      return nodes();
    },
    async tap(x, y) {
      const hit = appNodes(nodes(), 'com.yourname.tradehub')
        .filter((n) => n.rect.w > 0 && x >= n.rect.x && x < n.rect.x + n.rect.w && y >= n.rect.y && y < n.rect.y + n.rect.h)
        .sort((a, b) => b.depth - a.depth);
      const ids = hit.map((n) => n.identifier);
      if (ids.some((i) => i.endsWith('home_my_products_button'))) screen = 'products';
      else if (ids.some((i) => i.endsWith(':id/nav_home'))) screen = 'home';
    },
    async doubletap(x, y) {
      await dev.tap(x, y);
    },
    async longpress() {},
    async swipe() {},
    async text() {},
    async key(k) {
      if (String(k).toUpperCase() === 'BACK') screen = 'home';
    },
  };
  return dev;
}
