// Visual fallback: find a recorded template (a crop of an unlabeled element) on a screenshot.
//
// Method (explainable, no machine learning):
//  1. zero-mean normalised cross-correlation (ZNCC) on greyscale, which ignores uniform brightness/contrast changes;
//  2. coarse-to-fine: a full search on a downscaled copy, then exact refinement around the best coarse peaks;
//  3. scale-aware: the template is also tried at other sizes (different screen densities);
//  4. a region of interest limits where to look;
//  5. the best position is then checked in colour (mean RGB difference), because ZNCC ignores colour;
//  6. if a second, separate place scores almost as well, the result is ambiguous.
// A result is `found` only when confidence >= minConfidence, the colours agree and it is not ambiguous.
// Callers must never tap a result that is not `found`.

import { crop, gray, resize, resizeGray, type Image } from './png.ts';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MatchOptions {
  /** Search only inside this region of the screen (screen pixels). */
  roi?: Rect | null;
  /** Template scales to try (1 = recorded size). */
  scales?: number[];
  /** ZNCC needed to accept a match (0..1). Default 0.9. */
  minConfidence?: number;
  /** Largest mean per-channel colour difference (0..255) accepted at the best position. Default 40. */
  rgbTolerance?: number;
  /** A second peak this close to the best one (in ZNCC) makes the result ambiguous. Default 0.02. */
  ambiguityMargin?: number;
}

export interface MatchResult {
  found: boolean;
  /** Why it is not found, in plain words. */
  reason: string | null;
  confidence: number;
  rect: Rect | null;
  center: { x: number; y: number } | null;
  scale: number | null;
  rgbDiff: number | null;
  secondBest: number | null;
  ambiguous: boolean;
  timeMs: number;
  limitations: string[];
}

export const MATCH_LIMITATIONS = [
  'Matches the recorded picture, not the element: a different element that looks the same can match.',
  'Rotated, partly covered or restyled elements (theme, language, state) usually do not match.',
  'Scales outside the tried range (default 0.8x to 1.25x) are not found.',
];

interface Peak { x: number; y: number; v: number }

/** ZNCC of template t (tw x th, zero-mean, with norm tn) at every position of s (sw x sh); returns the best peaks. */
function scan(s: Float32Array, sw: number, sh: number, t: Float32Array, tw: number, th: number, keep: number, minDist: number): Peak[] {
  const W = sw - tw + 1, H = sh - th + 1;
  if (W <= 0 || H <= 0) return [];
  // integral images for window sums of s and s^2
  const iw = sw + 1;
  const I = new Float64Array(iw * (sh + 1));
  const I2 = new Float64Array(iw * (sh + 1));
  for (let y = 0; y < sh; y++) {
    let r = 0, r2 = 0;
    for (let x = 0; x < sw; x++) {
      const v = s[y * sw + x];
      r += v;
      r2 += v * v;
      I[(y + 1) * iw + x + 1] = I[y * iw + x + 1] + r;
      I2[(y + 1) * iw + x + 1] = I2[y * iw + x + 1] + r2;
    }
  }
  let tn = 0;
  for (let i = 0; i < t.length; i++) tn += t[i] * t[i];
  tn = Math.sqrt(tn);
  const n = tw * th;
  const peaks: Peak[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = y * iw + x, b = y * iw + x + tw, c = (y + th) * iw + x, d = (y + th) * iw + x + tw;
      const sum = I[d] - I[b] - I[c] + I[a];
      const sum2 = I2[d] - I2[b] - I2[c] + I2[a];
      const varS = sum2 - (sum * sum) / n;
      if (varS <= 1e-6) continue;
      let dot = 0;
      for (let j = 0; j < th; j++) {
        const so = (y + j) * sw + x, to = j * tw;
        for (let i = 0; i < tw; i++) dot += s[so + i] * t[to + i];
      }
      const v = dot / (Math.sqrt(varS) * tn); // t is zero-mean, so the window mean cancels out
      if (peaks.length < keep || v > peaks[peaks.length - 1].v) {
        const near = peaks.findIndex((p) => Math.abs(p.x - x) < minDist && Math.abs(p.y - y) < minDist);
        if (near >= 0) {
          if (v > peaks[near].v) peaks[near] = { x, y, v };
        } else peaks.push({ x, y, v });
        peaks.sort((p, q) => q.v - p.v);
        if (peaks.length > keep) peaks.length = keep;
      }
    }
  }
  return peaks;
}

function zeroMean(t: Float32Array): Float32Array {
  let m = 0;
  for (const v of t) m += v;
  m /= t.length;
  const o = new Float32Array(t.length);
  for (let i = 0; i < t.length; i++) o[i] = t[i] - m;
  return o;
}

function meanRgbDiff(a: Image, b: Image): number {
  let d = 0;
  const n = Math.min(a.data.length, b.data.length);
  for (let i = 0; i < n; i += 4) d += Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
  return d / ((n / 4) * 3);
}

export function findTemplate(screen: Image, template: Image, o: MatchOptions = {}): MatchResult {
  const t0 = Date.now();
  const minConfidence = o.minConfidence ?? 0.9;
  const rgbTolerance = o.rgbTolerance ?? 40;
  const margin = o.ambiguityMargin ?? 0.02;
  const scales = o.scales ?? [1, 0.9, 1.1, 0.8, 1.25];
  const roi = o.roi ? clampRect(o.roi, screen) : { x: 0, y: 0, w: screen.width, h: screen.height };
  const res = (r: Partial<MatchResult>): MatchResult => ({ found: false, reason: null, confidence: 0, rect: null, center: null, scale: null, rgbDiff: null, secondBest: null, ambiguous: false, timeMs: Date.now() - t0, limitations: MATCH_LIMITATIONS, ...r });

  const area = crop(screen, roi.x, roi.y, roi.w, roi.h);
  const sg = gray(area);
  // every refined peak, at every scale; the best one wins, and the best one elsewhere decides ambiguity
  const all: { x: number; y: number; v: number; s: number; w: number; h: number }[] = [];
  let flat = true;
  for (const sc of scales) {
    const tw = Math.round(template.width * sc), th = Math.round(template.height * sc);
    if (tw < 8 || th < 8 || tw > area.width || th > area.height) continue;
    const tpl = sc === 1 ? template : resize(template, tw, th);
    const tgFull = zeroMean(gray(tpl));
    let tvar = 0;
    for (const v of tgFull) tvar += v * v;
    if (tvar / tgFull.length < 4) continue; // less than 2 grey levels of variation: nothing to match on
    flat = false;
    const f = Math.max(1, Math.floor(Math.min(tw, th) / 24));
    const cw = Math.floor(area.width / f), ch = Math.floor(area.height / f);
    const ctw = Math.floor(tw / f), cth = Math.floor(th / f);
    const cs = f === 1 ? sg : resizeGray(sg, area.width, area.height, cw, ch);
    const ct = f === 1 ? tgFull : zeroMean(resizeGray(gray(tpl), tw, th, ctw, cth));
    const coarse = scan(cs, cw, ch, ct, ctw, cth, 10, Math.max(2, Math.floor(Math.min(ctw, cth) / 2)));
    // refine each coarse peak level by level (f, f/2, ..., 1), searching +-2 pixels at each level
    const levels: number[] = [];
    for (let l = f; l > 1; l = Math.ceil(l / 2)) levels.push(l);
    levels.push(1);
    const pyr = new Map<number, { s: Float32Array; w: number; h: number; t: Float32Array; tw: number; th: number }>();
    const level = (l: number) => {
      let v = pyr.get(l);
      if (!v) {
        const w = Math.floor(area.width / l), h = Math.floor(area.height / l), ltw = Math.floor(tw / l), lth = Math.floor(th / l);
        v = { s: l === 1 ? sg : resizeGray(sg, area.width, area.height, w, h), w, h, t: l === 1 ? tgFull : zeroMean(resizeGray(gray(tpl), tw, th, ltw, lth)), tw: ltw, th: lth };
        pyr.set(l, v);
      }
      return v;
    };
    for (const p of coarse) {
      let px = p.x * f, py = p.y * f, v = p.v;
      for (const l of levels.slice(1).length ? levels.slice(1) : [1]) {
        const L = level(l);
        const cx = Math.round(px / l), cy = Math.round(py / l);
        const x0 = Math.max(0, cx - 2), y0 = Math.max(0, cy - 2);
        const x1 = Math.min(L.w, cx + L.tw + 2), y1 = Math.min(L.h, cy + L.th + 2);
        const ww = x1 - x0, hh = y1 - y0;
        if (ww < L.tw || hh < L.th) break;
        const sub = new Float32Array(ww * hh);
        for (let y = 0; y < hh; y++) sub.set(L.s.subarray((y0 + y) * L.w + x0, (y0 + y) * L.w + x1), y * ww);
        const r = scan(sub, ww, hh, L.t, L.tw, L.th, 1, 1)[0];
        if (!r) break;
        px = (x0 + r.x) * l;
        py = (y0 + r.y) * l;
        v = r.v;
      }
      all.push({ x: px, y: py, v, s: sc, w: tw, h: th });
    }
  }
  all.sort((p, q) => q.v - p.v);
  const best = all[0] ?? null;
  const far = best ? all.find((p) => Math.abs(p.x + p.w / 2 - (best.x + best.w / 2)) > best.w / 2 || Math.abs(p.y + p.h / 2 - (best.y + best.h / 2)) > best.h / 2) : undefined;
  const second = far ? far.v : -1;
  if (flat) return res({ reason: 'the template is a flat colour, so there is nothing to match on' });
  if (!best) return res({ reason: 'the template is larger than the search area' });
  const rect = { x: roi.x + best.x, y: roi.y + best.y, w: best.w, h: best.h };
  const tplAt = best.s === 1 ? template : resize(template, best.w, best.h);
  const rgbDiff = meanRgbDiff(crop(screen, rect.x, rect.y, rect.w, rect.h), tplAt);
  const confidence = Math.max(0, Math.min(1, best.v));
  const secondBest = second >= 0 ? Math.max(0, Math.min(1, second)) : null;
  const ambiguous = secondBest !== null && secondBest >= minConfidence && confidence - secondBest < margin;
  let reason: string | null = null;
  if (confidence < minConfidence) reason = `best match ${(confidence * 100).toFixed(1)}% is below the required ${(minConfidence * 100).toFixed(0)}%`;
  else if (rgbDiff > rgbTolerance) reason = `the shape matches but the colours differ (mean difference ${rgbDiff.toFixed(0)} > ${rgbTolerance})`;
  else if (ambiguous) reason = `ambiguous: another place matches almost as well (${(secondBest! * 100).toFixed(1)}%)`;
  return res({
    found: reason === null,
    reason,
    confidence,
    rect,
    center: { x: Math.round(rect.x + rect.w / 2), y: Math.round(rect.y + rect.h / 2) },
    scale: best.s,
    rgbDiff,
    secondBest,
    ambiguous,
  });
}

function clampRect(r: Rect, img: Image): Rect {
  const x = Math.max(0, Math.min(img.width, Math.round(r.x)));
  const y = Math.max(0, Math.min(img.height, Math.round(r.y)));
  return { x, y, w: Math.max(0, Math.min(img.width - x, Math.round(r.w))), h: Math.max(0, Math.min(img.height - y, Math.round(r.h))) };
}

/** Share of the screen (0..1) that changed between two screenshots (8x downscaled grey, threshold 24). */
export function screenChange(a: Image, b: Image): number {
  if (a.width !== b.width || a.height !== b.height) return 1;
  const w = Math.max(1, Math.floor(a.width / 8)), h = Math.max(1, Math.floor(a.height / 8));
  const ga = resizeGray(gray(a), a.width, a.height, w, h);
  const gb = resizeGray(gray(b), b.width, b.height, w, h);
  let changed = 0;
  for (let i = 0; i < ga.length; i++) if (Math.abs(ga[i] - gb[i]) > 24) changed++;
  return changed / ga.length;
}
