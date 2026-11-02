export function parsePackageInfo(out: string): { debuggable: boolean | null; versionName: string | null } {
  const flags = /\bflags=\[([^\]]*)\]/.exec(out);
  const v = /versionName=([^\s]+)/.exec(out);
  return { debuggable: flags ? /\bDEBUGGABLE\b/.test(flags[1]) : null, versionName: v ? v[1] : null };
}
