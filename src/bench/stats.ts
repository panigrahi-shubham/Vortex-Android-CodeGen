// Statistics for repeated measurements. Medians and spread, never a single number on its own, and comparisons that
// refuse to name a winner without enough runs or when the spreads overlap.

export interface Summary {
  n: number;
  median: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
  /** sample standard deviation (n - 1) */
  stdev: number | null;
  /** coefficient of variation in percent (stdev / mean) */
  cvPct: number | null;
  /** median absolute deviation */
  mad: number | null;
}

const r1 = (v: number) => Math.round(v * 10) / 10;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function summarize(values: (number | null | undefined)[]): Summary {
  const xs = values.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  if (!xs.length) return { n: 0, median: null, min: null, max: null, mean: null, stdev: null, cvPct: null, mad: null };
  const med = median(xs)!;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const stdev = xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)) : null;
  return {
    n: xs.length,
    median: r1(med),
    min: r1(Math.min(...xs)),
    max: r1(Math.max(...xs)),
    mean: r1(mean),
    stdev: stdev === null ? null : r1(stdev),
    cvPct: stdev === null || mean === 0 ? null : r1((stdev / mean) * 100),
    mad: r1(median(xs.map((x) => Math.abs(x - med)))!),
  };
}

export const MIN_RUNS_TO_COMPARE = 5;

export interface Comparison {
  verdict: 'insufficient-data' | 'no-clear-difference' | 'a-faster' | 'b-faster';
  /** median(b) - median(a), ms; positive = a is faster */
  diffMs: number | null;
  diffPct: number | null;
  explanation: string;
}

/**
 * Compares two sets of timings. A side is called faster only when both have at least MIN_RUNS_TO_COMPARE runs, the
 * medians differ by more than 5 %, and by more than twice the larger median absolute deviation (the spreads do not
 * overlap around the medians). Otherwise the answer says why it cannot tell.
 */
export function compare(a: Summary, b: Summary, names: [string, string] = ['A', 'B']): Comparison {
  if (a.n < MIN_RUNS_TO_COMPARE || b.n < MIN_RUNS_TO_COMPARE || a.median === null || b.median === null) {
    return { verdict: 'insufficient-data', diffMs: null, diffPct: null, explanation: `Needs at least ${MIN_RUNS_TO_COMPARE} successful runs on each side (have ${a.n} and ${b.n}). No conclusion from fewer runs.` };
  }
  const diff = b.median - a.median;
  const base = Math.min(a.median, b.median) || 1;
  const pct = r1((Math.abs(diff) / base) * 100);
  const noise = 2 * Math.max(a.mad ?? 0, b.mad ?? 0);
  if (pct <= 5 || Math.abs(diff) <= noise) {
    return { verdict: 'no-clear-difference', diffMs: r1(diff), diffPct: pct, explanation: `Medians differ by ${r1(Math.abs(diff))} ms (${pct} %), within the run-to-run variation (2 x MAD = ${r1(noise)} ms) or under 5 %.` };
  }
  const faster = diff > 0 ? names[0] : names[1];
  return { verdict: diff > 0 ? 'a-faster' : 'b-faster', diffMs: r1(diff), diffPct: pct, explanation: `${faster} has the lower median by ${r1(Math.abs(diff))} ms (${pct} %), more than the run-to-run variation (2 x MAD = ${r1(noise)} ms), on this device and app build.` };
}
