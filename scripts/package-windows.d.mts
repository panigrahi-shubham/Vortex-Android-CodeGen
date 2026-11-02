export declare const INCLUDE: string[];
export declare function collect(root?: string): string[];
export declare function buildZip(entries: { name: string; data: Buffer; date?: Date }[]): Buffer;
export declare function readZip(buf: Buffer): { name: string; data: Buffer }[];
export declare function packageWindows(outDir?: string): { zipFile: string; sha256: string; files: number; bytes: number };
