import { setTimeout as delay } from 'node:timers/promises';
import { findTemplate, type MatchResult } from './match.ts';
import { decodePng } from './png.ts';

export interface VisualTarget {
  width: number;
  height: number;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
}

export function validVisualTarget(v: VisualTarget | null | undefined): v is VisualTarget {
  return !!v && Number.isInteger(v.width) && Number.isInteger(v.height) &&
    v.width >= 1 && v.width <= 8192 && v.height >= 1 && v.height <= 8192 &&
    Number.isInteger(v.x) && v.x >= 0 && v.x < v.width &&
    Number.isInteger(v.y) && v.y >= 0 && v.y < v.height &&
    [v.offsetX, v.offsetY].every(n => Number.isFinite(n) && n >= 0 && n < 1);
}

export function findVisualTarget(screenshot: Buffer, template: Buffer, target: VisualTarget): MatchResult {
  if (!validVisualTarget(target)) throw new Error('Invalid visual tap geometry.');
  const frame = decodePng(screenshot);
  const image = decodePng(template);
  if (image.width < 24 || image.height < 24 || image.width > 200 || image.height > 200) {
    throw new Error('Invalid visual tap crop. Record the target again.');
  }
  const sx = frame.width / target.width, sy = frame.height / target.height;
  if (Math.abs(sx / sy - 1) > 0.2) throw new Error('The screen aspect ratio changed too far for safe visual replay.');
  const scale = Math.min(sx, sy);
  const x = target.x * sx, y = target.y * sy;
  // Search the neighborhood of the former tap, with room for scrolling and local reflow.
  const halfW = Math.min(320, Math.max(image.width * scale, frame.width * 0.22));
  const halfH = Math.min(320, Math.max(image.height * scale, frame.height * 0.12));
  const left = Math.max(0, Math.floor(x - halfW)), top = Math.max(0, Math.floor(y - halfH));
  const right = Math.min(frame.width, Math.ceil(x + halfW)), bottom = Math.min(frame.height, Math.ceil(y + halfH));
  const match = findTemplate(frame, image, {
    roi: { x: left, y: top, w: right - left, h: bottom - top },
    scales: [scale, scale * 0.9, scale * 1.1],
    minConfidence: 0.93, rgbTolerance: 25, ambiguityMargin: 0.05,
  });
  if (!match.found || !match.rect) return match;
  const { x: mx, y: my, w, h } = match.rect;
  return { ...match, center: { x: mx + Math.floor(w * target.offsetX), y: my + Math.floor(h * target.offsetY) } };
}

interface VisualScreen {
  screenshot(options: { format: 'png'; scale: number }): Promise<Buffer>;
  tap(x: number, y: number): Promise<void>;
}

export async function tapVisualTarget(screen: VisualScreen, template: Buffer, target: VisualTarget): Promise<void> {
  const read = () => screen.screenshot({ format: 'png', scale: 1 });
  let point: { x: number; y: number } | null = null;
  let reason = 'no stable match';
  // A match must agree across two fresh frames. The tap is dispatched once, outside the retry loop.
  for (let attempt = 0; attempt < 4; attempt++) {
    const match = findVisualTarget(await read(), template, target);
    if (match.found && match.center && point &&
        Math.hypot(match.center.x - point.x, match.center.y - point.y) <= 2) {
      await screen.tap(match.center.x, match.center.y);
      return;
    }
    point = match.found ? match.center : null;
    if (match.reason) reason = match.reason;
    if (attempt < 3) await delay(140);
  }
  throw new Error(`Visual tap could not confirm a unique, stable target (${reason}). No tap was sent. Inspect the screen and check the recorded crop.`);
}
