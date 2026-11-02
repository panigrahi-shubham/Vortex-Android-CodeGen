// Starts the real Vortex server process (src/server.js) for integration tests, on a free port with its own state and output folders.
import { spawn, type ChildProcess } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function freePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => {
      const p = (s.address() as net.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

export async function startServer(stateDir: string, outDir: string, env: Record<string, string> = {}, extraArgs: string[] = ['--mock']) {
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'server.js'), ...extraArgs, '--port', String(port), '--state-dir', stateDir, '--out', outDir], { env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  child.stdout!.on('data', (d) => (log += d));
  child.stderr!.on('data', (d) => (log += d));
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(base + '/api/config')).ok) break;
    } catch {
      /* not yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  const api = async (p: string, body?: unknown) => {
    const r = await fetch(base + p, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const t = await r.text();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { status: r.status, body: (r.headers.get('content-type')?.includes('json') ? JSON.parse(t) : t) as any, headers: r.headers };
  };
  return { base, api, child, log: () => log };
}

export async function stopServer(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await new Promise((r) => child.once('exit', r));
}
