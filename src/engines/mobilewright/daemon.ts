import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
import { RunError } from '../run-types.ts';

/** Mobilecli's Android DeviceServer holds Android's single UiAutomation slot while its daemon is alive. */
const execFileAsync = promisify(execFile);
export async function mobilecliDaemonStatus(testsDir: string): Promise<{ installed: boolean; running: boolean | null; cli: string | null; error?: string }> {
  let dir = path.resolve(testsDir);
  let cli: string | null = null;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', 'mobilecli', 'index.js');
    if (fs.existsSync(candidate)) {
      cli = candidate;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (!cli) return { installed: false, running: false, cli: null };

  try {
    const { stdout } = await execFileAsync(process.execPath, [cli, 'daemon', 'status'], {
      encoding: 'utf8', windowsHide: true, timeout: 10_000, maxBuffer: 1024 * 1024,
    });
    const state = JSON.parse(stdout) as { running?: boolean };
    return { installed: true, running: typeof state.running === 'boolean' ? state.running : null, cli };
  } catch (e) {
    return { installed: true, running: null, cli, error: (e as Error).message };
  }
}

export async function stopMobilecliDaemon(testsDir: string): Promise<boolean> {
  const status = await mobilecliDaemonStatus(testsDir);
  if (!status.installed || status.running === false) return false;
  if (status.running === null) {
    throw new RunError('MOBILECLI_STATUS_FAILED', 409,
      'Could not check whether Mobilecli owns Android UI automation. Retry after checking the Mobilecli daemon.',
      { cli: status.cli, cause: status.error });
  }
  try {
    await execFileAsync(process.execPath, [status.cli!, 'daemon', 'stop'], {
      encoding: 'utf8', windowsHide: true, timeout: 20_000, maxBuffer: 1024 * 1024,
    });
    const after = await mobilecliDaemonStatus(testsDir);
    if (after.running !== false) throw new Error(after.error || 'the daemon still reports as running');
    return true;
  } catch (e) {
    // Some daemons exit just after their stop command's deadline.
    const after = await mobilecliDaemonStatus(testsDir);
    if (after.running === false) return true;
    throw new RunError('MOBILECLI_AUTOMATION_BUSY', 409,
      `Could not stop Mobilecli's daemon. Check its status and retry.`,
      { cause: (e as Error).message });
  }
}
