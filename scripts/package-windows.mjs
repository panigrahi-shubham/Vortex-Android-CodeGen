// Builds the Windows distribution: dist/vortex-android-recorder-<version>-windows.zip (+ .sha256).
// Contents: the recorder (it has no runtime npm dependencies), the Windows launchers, docs, samples and the fake
// MobileWright driver used by --mock. Not included: tests, node_modules, generated output, state, anything of yours.
//
// Usage: node scripts/package-windows.mjs [--out <folder>]
// The ZIP writer is built in (Node's zlib), so packaging needs nothing installed.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

export const INCLUDE = [
  'package.json', 'README.md', 'CHANGELOG.md', 'BASELINE_AUDIT.md',
  'start-vortex.cmd', 'start-vortex.ps1', 'vortex.config.example.cmd',
  'src/', 'public/', 'samples/', 'docs/', 'examples/',
  'test/fixtures/fake-mobilewright-driver.mjs', 'test/fixtures/webview-host.mjs',
];
const SKIP = /(^|\/)(node_modules|\.vortex|\.vortex-bench|generated|dist)(\/|$)|\.log$|\.tmp$/;

export function collect(root = ROOT) {
  const files = [];
  const walk = (rel) => {
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || SKIP.test(rel)) return;
    const st = fs.statSync(abs);
    if (st.isDirectory()) for (const e of fs.readdirSync(abs).sort()) walk(rel ? `${rel.replace(/\/$/, '')}/${e}` : e);
    else files.push(rel);
  };
  for (const i of INCLUDE) walk(i.replace(/\/$/, ''));
  return files;
}

/** Minimal ZIP (deflate, UTF-8 names, no ZIP64): enough for a few MB of source files. */
export function buildZip(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  const dosTime = (d) => ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xffff;
  const dosDate = (d) => (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xffff;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const data = e.data;
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = zlib.crc32(data) >>> 0;
    const d = e.date ?? new Date();
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt16LE(dosTime(d), 10); h.writeUInt16LE(dosDate(d), 12); h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(comp.length, 18); h.writeUInt32LE(data.length, 22); h.writeUInt16LE(name.length, 26); h.writeUInt16LE(0, 28);
    local.push(h, name, comp);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(dosTime(d), 12); c.writeUInt16LE(dosDate(d), 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(comp.length, 20);
    c.writeUInt32LE(data.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt32LE(0, 30); c.writeUInt32LE(0, 34); c.writeUInt32LE(0, 38);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, cd, end]);
}

/** Reads a ZIP written by buildZip (or any plain deflate/store ZIP) and checks every CRC. */
export function readZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('not a zip');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = [];
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('bad central directory');
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nlen = buf.readUInt16LE(p + 28);
    const xlen = buf.readUInt16LE(p + 30);
    const clen = buf.readUInt16LE(p + 32);
    const off = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString('utf8');
    const lnl = buf.readUInt16LE(off + 26);
    const lxl = buf.readUInt16LE(off + 28);
    const raw = buf.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + csize);
    const data = method === 8 ? zlib.inflateRawSync(raw) : raw;
    if ((zlib.crc32(data) >>> 0) !== crc) throw new Error(`CRC mismatch in ${name}`);
    out.push({ name, data });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

export function packageWindows(outDir = path.join(ROOT, 'dist')) {
  const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const top = `vortex-android-recorder-${version}`;
  const files = collect();
  for (const must of ['start-vortex.cmd', 'src/server.js', 'public/index.html']) if (!files.includes(must)) throw new Error(`missing ${must}`);
  const entries = files.map((f) => {
    let data = fs.readFileSync(path.join(ROOT, f));
    // Windows launchers must have CRLF line endings whatever the checkout did
    if (/\.(cmd|ps1)$/.test(f)) data = Buffer.from(data.toString('utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
    return { name: `${top}/${f}`, data, date: fs.statSync(path.join(ROOT, f)).mtime };
  });
  fs.mkdirSync(outDir, { recursive: true });
  const zipFile = path.join(outDir, `${top}-windows.zip`);
  const zip = buildZip(entries);
  readZip(zip); // self-check before writing
  fs.writeFileSync(zipFile, zip);
  const sha = crypto.createHash('sha256').update(zip).digest('hex');
  fs.writeFileSync(`${zipFile}.sha256`, `${sha}  ${path.basename(zipFile)}\n`);
  return { zipFile, sha256: sha, files: entries.length, bytes: zip.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const i = process.argv.indexOf('--out');
  const r = packageWindows(i >= 0 ? path.resolve(process.argv[i + 1]) : undefined);
  console.log(`${r.zipFile}\n${r.files} files, ${(r.bytes / 1024).toFixed(0)} KB, sha256 ${r.sha256}`);
}
