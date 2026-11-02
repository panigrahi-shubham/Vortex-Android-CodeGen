// Timing marks for benchmark copies of generated Plain tests. The user's saved files are never changed: the benchmark
// writes an instrumented copy into its own folder. The copy is the original plus mark lines only, which is checked
// (removing the inserted lines must give back the original byte for byte), so no step and no assertion can be lost.

export interface Instrumented {
  content: string;
  /** step numbers found in the file, in order */
  steps: number[];
  webviewBlocks: number;
}

export class InstrumentError extends Error {
  code = 'BENCH_INSTRUMENT';
  httpStatus = 422;
}


const TS_MARK = '__vortexMark';

function verify(original: string, out: string[], inserted: Set<number>) {
  const back = out.filter((_, i) => !inserted.has(i)).join('\n');
  if (back !== original) throw new InstrumentError('Instrumentation changed the test beyond adding timing marks; benchmark refused.');
}

/** MobileWright Plain test (format v2, one `test(` block). */
export function instrumentTs(original: string, marksFile: string): Instrumented {
  const lines = original.split('\n');
  const tests = lines.map((l, i) => (/^test\(/.test(l) ? i : -1)).filter((i) => i >= 0);
  if (tests.length !== 1) throw new InstrumentError(`Expected one test in the Plain MobileWright file, found ${tests.length}.`);
  const t = tests[0];
  const lastImport = lines.reduce((acc, l, i) => (/^import /.test(l) ? i : acc), -1);
  let endAt = -1;
  for (let i = lines.length - 1; i > t; i--) {
    if (/^ {2}\} finally \{$/.test(lines[i])) {
      endAt = i;
      break;
    }
  }
  if (endAt < 0) for (let i = lines.length - 1; i > t; i--) if (/^\}\);\s*$/.test(lines[i])) {
    endAt = i;
    break;
  }
  if (endAt < 0) throw new InstrumentError('The end of the MobileWright test was not found (it may have been edited).');
  const out: string[] = [];
  const inserted = new Set<number>();
  const add = (s: string) => {
    inserted.add(out.length);
    out.push(s);
  };
  const steps: number[] = [];
  let webviewBlocks = 0;
  lines.forEach((l, i) => {
    if (i > t && i < endAt) {
      let m: RegExpExecArray | null;
      if ((m = /^(\s*)\/\/ (\d+)\. /.exec(l))) {
        steps.push(Number(m[2]));
        add(`${m[1]}${TS_MARK}(${Number(m[2])});`);
      } else if ((m = /^(\s*)\/\/ WebView: /.exec(l))) {
        webviewBlocks++;
        add(`${m[1]}${TS_MARK}('webview');`);
      }
    }
    if (i === endAt) add(`    ${TS_MARK}('end');`);
    out.push(l);
    if (i === lastImport) {
      add("import { appendFileSync as __vortexAppend } from 'node:fs'; // benchmark copy: timing marks only");
      add(`const ${TS_MARK} = (step: string | number) => __vortexAppend(${JSON.stringify(marksFile)}, JSON.stringify({ step, t: performance.now() }) + '\\n');`);
    }
    if (i === t) add(`  ${TS_MARK}('start');`);
  });
  if (!steps.length) throw new InstrumentError('No recorded steps found in the MobileWright test (it may have been edited).');
  verify(original, out, inserted);
  return { content: out.join('\n'), steps, webviewBlocks };
}

export interface Segment {
  /** 'start' (test preamble, e.g. MobileWright's app launch), a step number, or 'webview' (context switch / page attach) */
  label: string;
  ms: number;
}

/** Marks file (JSON lines in execution order) -> durations between consecutive marks. Incomplete runs end at the last mark. */
export function segments(marksJsonl: string): { segments: Segment[]; complete: boolean } {
  const marks = marksJsonl.split('\n').filter(Boolean).flatMap((l) => {
    try {
      const m = JSON.parse(l) as { step: string | number; t: number };
      return typeof m.t === 'number' ? [m] : [];
    } catch {
      return [];
    }
  });
  const out: Segment[] = [];
  for (let i = 0; i + 1 < marks.length; i++) out.push({ label: String(marks[i].step), ms: Math.round((marks[i + 1].t - marks[i].t) * 10) / 10 });
  return { segments: out, complete: marks.length > 0 && String(marks[marks.length - 1].step) === 'end' };
}
