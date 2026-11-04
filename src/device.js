import { execFile, exec } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parseTree, appNodes } from './tree.js';
import { validateAdbArgs, adbTransportArgs, adbTimeout } from '../public/adb-tools.js';

const KEYCODES = { BACK: 4, HOME: 3, ENTER: 66, APP_SWITCH: 187, RECENT: 187, DELETE: 67, TAB: 61, SEARCH: 84 };

function run(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'buffer', timeout: 15000, maxBuffer: 128 * 1024 * 1024, windowsHide: true, ...opts }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr && stderr.toString().trim()) || err.message;
        reject(new Error(`${file} ${args.join(' ')} failed: ${msg}`));
      } else resolve(stdout);
    });
  });
}

function sh(cmd) {
  return new Promise((resolve, reject) => {
    exec(cmd, { encoding: 'buffer', timeout: 15000, maxBuffer: 128 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
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

export async function createRealDevice({ serial, mobilecliDevice = '', treeCmd = 'mobilecli dump ui', treeSource = 'auto', mobilecli = null, log = console.log } = {}) {
  if (!serial) {
    const out = (await run('adb', ['devices'])).toString();
    const devs = out.split(/\r?\n/).slice(1).map((l) => l.trim().split(/\s+/)).filter((p) => p[1] === 'device').map((p) => p[0]);
    if (devs.length === 0) throw new Error('No device found. Connect the phone, enable USB debugging and check `adb devices`.');
    if (devs.length > 1) throw new Error(`Several devices connected (${devs.join(', ')}). Start with --device <serial>.`);
    serial = devs[0];
  }
  const adb = (args, options) => run('adb', ['-s', serial, ...args], options);
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
            const raw = mobilecli && treeCmd === 'mobilecli dump ui'
              ? await run(process.execPath, [mobilecli, 'dump', 'ui', '--device', mobilecliDevice||serial])
              : await sh(treeCmd);
            const nodes = parseTree(raw);
            if (nodes.length) {
              source = 'mobilecli';
              return nodes;
            }
            throw new Error('empty tree');
          } catch (e) {
            // An installed Mobilecli can already own Android UiAutomation after
            // a failed request. Starting a second instrumentation would kill it.
            if (treeSource === 'mobilecli' || mobilecli) {
              if (/no XML|uiautomation|instrumentation|killed/i.test(e.message)) {
                const processes = (await adb(['shell', 'dumpsys', 'activity', 'processes']).catch(() => Buffer.from(''))).toString();
                if (/mClass=ComponentInfo\{dev\.mobile\.maestro\.test\//.test(processes)) {
                  throw Object.assign(new Error('Maestro is controlling this phone. Disconnect its device session or close Maestro Studio, then Refresh in Vortex. Android cannot share this automation connection.'), {httpStatus:409, code:'EXTERNAL_AUTOMATION_BUSY'});
                }
              }
              throw e;
            }
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
    async adbCommand(args, timeoutMs) {
      const timeout=adbTimeout(timeoutMs), command=adbTransportArgs(validateAdbArgs(args));
      try { return await adb(command,{timeout}); }
      catch { throw new Error('ADB command failed. Check its arguments, device connection and permissions.'); }
    },
    async replaceText(x, y) {
      await dev.tap(x, y);
      // Select all in the focused editor, then delete; independent of text length.
      await adb(['shell', 'input', 'keycombination', '113', '29']); // CTRL+A
      await adb(['shell', 'input', 'keyevent', '67']);
    },
    key(k) {
      const code = KEYCODES[String(k).toUpperCase()];
      if (!code) throw new Error('unknown key ' + k);
      return adb(['shell', 'input', 'keyevent', String(code)]);
    },
    // Milestone 5 interactions. Every argument is validated before it reaches the device shell.
    async clearText(x, y, length) {
      await dev.tap(x, y);
      await adb(['shell', 'input', 'keyevent', 'KEYCODE_MOVE_END']);
      const n = Math.min(Math.max(Number(length) || 0, 0) + 2, 500);
      if (n) await adb(['shell', 'input', 'keyevent', ...Array(n).fill('67')]);
    },
    async hideKeyboard() {
      const out = (await adb(['shell', 'dumpsys', 'input_method'])).toString();
      if (/mInputShown=true/.test(out)) await adb(['shell', 'input', 'keyevent', '4']);
    },
    launchApp: (pkg) => adb(['shell', 'monkey', '-p', assertPackage(pkg), '-c', 'android.intent.category.LAUNCHER', '1']),
    closeApp: (pkg) => adb(['shell', 'am', 'force-stop', assertPackage(pkg)]),
    openUrl: (url, pkg) => adb(['shell', 'am', 'start', '-W', '-a', 'android.intent.action.VIEW', '-d', `'${assertDeepLink(url)}'`, assertPackage(pkg)]),
    // Foreground activity ("package/.Activity"), used to name pages. null when it cannot be read.
    async activity() {
      try {
        return parseResumedActivity((await adb(['shell', 'dumpsys', 'activity', 'activities'])).toString());
      } catch {
        return null;
      }
    },
  };
  return dev;
}

export function assertPackage(pkg) {
  if (!/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/.test(String(pkg))) throw new Error(`invalid package name "${pkg}"`);
  return String(pkg);
}

// A deep link goes through the device shell, so only plain URLs are accepted (no quotes, spaces or shell characters).
export function assertDeepLink(url) {
  const u = String(url);
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:[^\s'"`$\\;&|<>()]*$/.test(u) || u.length > 2000) throw new Error('invalid deep link: use a plain URL such as myapp://orders/42');
  return u;
}

// Reads the resumed (foreground) activity from `dumpsys activity activities` output (Android 8 to 15 formats).
export function parseResumedActivity(out) {
  const m =
    /\b(?:topResumedActivity|mResumedActivity|ResumedActivity)\s*[:=]\s*ActivityRecord\{[^}]*?\s([A-Za-z0-9_.]+)\/([A-Za-z0-9_.$]+)/.exec(out) ||
    /\bmFocusedActivity\s*[:=]\s*ActivityRecord\{[^}]*?\s([A-Za-z0-9_.]+)\/([A-Za-z0-9_.$]+)/.exec(out);
  if (!m) return null;
  const pkg = m[1];
  const cls = m[2].startsWith('.') ? pkg + m[2] : m[2];
  return `${pkg}/${cls.startsWith(pkg + '.') ? cls.slice(pkg.length) : cls}`;
}

// A tiny fake phone with three screens (home, products, a WebView screen), so the recorder UI can be tried (and tested) without a device.
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
      else if (ids.some((i) => i.endsWith('home_market_card'))) screen = 'insights';
      else if (ids.some((i) => i.endsWith(':id/nav_home') || i.endsWith('insights_back_button'))) screen = 'home';
    },
    async doubletap(x, y) {
      await dev.tap(x, y);
    },
    async longpress() {},
    async swipe() {},
    async text() {},
    async adbCommand(args, timeoutMs) {validateAdbArgs(args);adbTimeout(timeoutMs);return Buffer.from('Simulated ADB command; no connected device was used.');},
    async replaceText() {},
    async key(k) {
      if (String(k).toUpperCase() === 'BACK') screen = 'home';
    },
    async clearText() {},
    async hideKeyboard() {},
    async launchApp() {
      screen = 'home';
    },
    async closeApp() {
      screen = 'home';
    },
    async openUrl(url) {
      assertDeepLink(url);
      screen = /^tradehub:\/\/products\b/.test(url) ? 'products' : /^tradehub:\/\/insights\b/.test(url) ? 'insights' : 'home';
    },
    // Synthetic activity names for the sample screens (the samples carry no activity information).
    async activity() {
      return { home: 'com.yourname.tradehub/.ui.HomeActivity', products: 'com.yourname.tradehub/.ui.products.MyProductsActivity', insights: 'com.yourname.tradehub/.ui.insights.MarketInsightsActivity' }[screen];
    },
  };
  return dev;
}
