export function validateAdbArgs(args: unknown): string[];
export function adbTimeout(value?: unknown): number;
export function parseAdbCommand(command: string, serial?: string): string[];
export function adbTransportArgs(args: string[]): string[];
export function formatAdbCommand(args: string[], serial?: string): string;
export const ADB_PRESETS: [string,string,string[]][];
