// Types for device.js (plain JavaScript, used by the TypeScript modules and tests).
export function parseResumedActivity(out: string): string | null;
export function createMockDevice(samplesDir: string): unknown;
export function createRealDevice(o: { serial?: string; treeCmd?: string; treeSource?: string; mobilecli?: string | null; log?: (...a: unknown[]) => void }): Promise<unknown>;
export function makeLock(): <T>(fn: () => Promise<T>) => Promise<T>;
export function escapeInputText(s: string): string;
export function dumpUiautomator(adbRun: (args: string[]) => Promise<Buffer>, sleepFn?: (ms: number) => Promise<void>, tries?: number): Promise<Buffer>;
export function assertPackage(pkg: string): string;
export function assertDeepLink(url: string): string;
