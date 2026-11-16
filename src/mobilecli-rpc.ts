// An owned loopback HTTP front end for the existing Mobilecli daemon.
// Live values travel in JSON request bodies, never CLI arguments or temporary files.
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { createProcessInspector, sameProcess, type ProcessIdentity } from './runtime/process-inspector.ts';
import { webviewError } from './webview-inspector.ts';

type Binary = { executable: string; prefixArgs?: string[] };
export function mobilecliBinary(entry: string | null): Binary {
  if (!entry) throw webviewError('Install the supported MobileWright project before running WebView actions.', 'MOBILECLI_MISSING', 501);
  const platforms: Record<string, string> = { linux: 'linux', darwin: 'darwin', win32: 'windows' };
  const arches: Record<string, string> = { x64: 'amd64', arm64: 'arm64' };
  const suffix = platforms[process.platform] && arches[process.arch] ? `${platforms[process.platform]}-${arches[process.arch]}` : null;
  if (!suffix) throw webviewError('This platform does not have a supported Mobilecli binary.', 'MOBILECLI_MISSING', 501);
  try {
    const require = createRequire(entry);
    const pkg = require.resolve(`@mobilenext/mobilecli-${suffix}/package.json`);
    return { executable: path.join(path.dirname(pkg), `mobilecli-${suffix}${process.platform === 'win32' ? '.exe' : ''}`) };
  } catch { throw webviewError('The installed Mobilecli native binary is missing. Reinstall the supported runner.', 'MOBILECLI_MISSING', 501); }
}
export async function callMobilecliRpc(endpoint: string, method: string, params: Record<string, unknown>, timeoutMs = 15_000): Promise<unknown> {
  const url = new URL(endpoint);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/rpc') throw new Error('Mobilecli live transport must use the owned loopback endpoint.');
  const id = randomUUID();
  try {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
    if (!response.ok) throw new Error('RPC transport failed');
    const data = await response.text();
    if (data.length > 4 * 1024 * 1024) throw new Error('RPC response too large');
    const result = JSON.parse(data) as { id?: string; error?: unknown; result?: unknown };
    if (result.id !== id || result.error || !Object.hasOwn(result, 'result')) throw new Error('RPC response invalid');
    return result.result;
  } catch {
    // RPC errors may quote the evaluated expression and input. Do not expose them.
    throw webviewError('Mobilecli did not return a confirmed result. Inspect the page before retrying any action.', 'WEBVIEW_RPC_FAILED');
  }
}

export function createMobilecliRpc(resolveBinary: () => Binary) {
  let child: ChildProcess | null = null;
  let identity: ProcessIdentity | null = null;
  let endpoint: string | null = null;
  let starting: Promise<void> | null = null;
  const processes = createProcessInspector();
  async function stop() {
    const target = child, recorded = identity;
    endpoint = null; child = null; identity = null;
    if (!target || target.exitCode !== null || target.signalCode !== null) return;
    if (!recorded || !sameProcess(recorded, await processes.info(recorded.pid))) return;
    const exited = new Promise<void>(resolve => target.once('exit', () => resolve()));
    await processes.kill(recorded.pid, { force: false, tree: false }).catch(() => {});
    const finished = await Promise.race([exited.then(() => true), new Promise<false>(resolve => { const timer = setTimeout(() => resolve(false), 2500); timer.unref(); })]);
    if (!finished && sameProcess(recorded, await processes.info(recorded.pid))) await processes.kill(recorded.pid, { force: true, tree: false }).catch(() => {});
  }
  async function start() {
    const binary = resolveBinary();
    const listener = net.createServer();
    const port = await new Promise<number>((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', () => {
        const address = listener.address() as net.AddressInfo;
        listener.close(() => resolve(address.port));
      });
    });
    const processHandle = spawn(binary.executable, [...(binary.prefixArgs || []), 'server', 'start', '--listen', `127.0.0.1:${port}`], { stdio: ['ignore','pipe','pipe'], windowsHide: true });
    child = processHandle;
    // Drain output without logging potential device data.
    processHandle.stdout?.on('data', () => {}); processHandle.stderr?.on('data', () => {});
    let spawnFailed = false;
    processHandle.on('error', () => { spawnFailed = true; });
    if (processHandle.pid) identity = await processes.info(processHandle.pid);
    const deadline = Date.now() + 10_000;
    try {
      while (Date.now() < deadline) {
        if (spawnFailed || processHandle.exitCode !== null || processHandle.signalCode !== null) throw new Error('RPC server exited');
        try {
          const response = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500), redirect: 'error' });
          if (response.ok && processHandle.exitCode === null && processHandle.signalCode === null) {
            if (!identity && processHandle.pid) identity = await processes.info(processHandle.pid);
            if (!identity) throw new Error('Cannot establish process identity');
            endpoint = `http://127.0.0.1:${port}/rpc`; return;
          }
        } catch { /* still starting */ }
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      throw new Error('RPC server readiness timeout');
    } catch {
      await stop();
      throw webviewError('Could not start the owned Mobilecli loopback transport. Check the installation and host permissions.', 'MOBILECLI_START_FAILED', 503);
    }
  }
  return {
    async ready() {
      if (endpoint && child && child.exitCode === null && child.signalCode === null) return;
      if (!starting) starting = start().finally(() => { starting = null; });
      await starting;
    },
    async call(method: string, params: Record<string, unknown>) {
      if (!endpoint || !child || child.exitCode !== null || child.signalCode !== null) throw webviewError('The owned Mobilecli transport stopped. Inspect the page again.', 'WEBVIEW_RPC_FAILED');
      return callMobilecliRpc(endpoint, method, params);
    },
    async close() { await starting?.catch(() => {}); await stop(); },
  };
}
