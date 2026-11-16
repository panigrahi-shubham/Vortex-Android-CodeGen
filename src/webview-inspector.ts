// Mobilecli shares the recorder's existing daemon; this inspector never starts a second device driver.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { collectDomSnapshot, type DomSnapshot } from '../public/webview-dom.js';
import type { UiStep, WebViewRef } from './model/recording.ts';

export const webviewError = (message: string, code = 'WEBVIEW_UNAVAILABLE', httpStatus = 409) => Object.assign(new Error(message), { code, httpStatus });
export interface InspectableWebView {
  id: string; url: string; title: string;
  bounds?: { x: number; y: number; width: number; height: number };
}
export type NativeWebNode = { type: string; identifier?: string; rect?: { x: number; y: number; w: number; h: number } };
export function pageIdentity(url: string): string {
  try { const u = new URL(url); return u.origin === 'null' ? u.protocol + u.pathname : u.origin + u.pathname; }
  catch { throw webviewError('The WebView URL is invalid. Refresh and select the page again.'); }
}
export type WebviewCall = (args: string[]) => Promise<unknown>;

export function parseMobilecliReply(text: string): unknown {
  let result: unknown;
  try { result = JSON.parse(text); } catch { throw webviewError('Mobilecli returned an unreadable response. Check its version and device connection.'); }
  if (result && typeof result === 'object' && 'status' in result) {
    const response = result as { status: string; data?: unknown; error?: string };
    if (response.status !== 'ok') throw webviewError(`Mobilecli could not inspect this WebView. ${String(response.error || '').slice(0, 300)}`);
    return response.data;
  }
  return result;
}

export function runMobilecliRead(entry: string | null, alias: string, args: string[]): Promise<unknown> {
  if (!entry) return Promise.reject(webviewError('Install the supported MobileWright runner in the output project so Mobilecli is available.', 'MOBILECLI_MISSING', 501));
  return new Promise((resolve, reject) => {
    // Device identity is always explicit. The caller supplies only fixed read-only subcommands.
    execFile(process.execPath, [entry, 'webview', args[0], '--device', alias, ...(args.length > 1 ? ['--', ...args.slice(1)] : [])],
      { encoding: 'utf8', windowsHide: true, timeout: 15_000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) return reject(webviewError(`Mobilecli WebView inspection failed or timed out. Check device authorization and debugging availability. ${String(stderr || '').trim().slice(0, 300)}`));
        try { resolve(parseMobilecliReply(stdout)); } catch (e) { reject(e); }
      });
  });
}

export function normalizeWebviews(value: unknown): InspectableWebView[] {
  if (value === null) return [];
  if (!Array.isArray(value) || value.length > 100) throw webviewError('Mobilecli returned an invalid WebView list.');
  const ids = new Set<string>();
  return value.map(v => {
    if (!v || typeof v.id !== 'string' || !v.id || v.id.length > 512 || ids.has(v.id)) throw webviewError('Mobilecli returned ambiguous WebView identities.');
    ids.add(v.id);
    return { id: v.id, url: String(v.url || '').slice(0, 4000), title: String(v.title || '').slice(0, 300), ...(v.bounds ? { bounds: v.bounds } : {}) };
  });
}

/** Refuse guessed index mappings: MobileWright maps native WebView order to bridge order. */
export function replayReference(view: InspectableWebView, views: InspectableWebView[], raw: NativeWebNode[]): { ref: WebViewRef | null; reason: string | null } {
  const native = raw.filter(n => /WebView$/i.test(n.type));
  const index = views.findIndex(v => v.id === view.id);
  const fallback = { testId: null, index: 0, count: 1, url: pageIdentity(view.url), title: view.title };
  if (views.length === 1 && native.length === 0) return { ref: fallback, reason: null };
  if (views.length !== native.length || index < 0) return { ref: null, reason: 'Native WebView nodes and inspectable pages cannot be matched reliably. You can inspect and copy CSS, but adding replay steps is disabled.' };
  if (views.length > 1) {
    const b = view.bounds;
    if (!b || ![b.x,b.y,b.width,b.height].every(Number.isFinite)) return { ref: null, reason: 'Several pages are exposed without reliable native bounds. Choose the page for inspection; replay mapping is unavailable.' };
    const matches = native.map((n, i) => ({ n, i })).filter(({ n }) => n.rect && Math.abs(n.rect.x - b.x) < 2 && Math.abs(n.rect.y - b.y) < 2 && Math.abs(n.rect.w - b.width) < 2 && Math.abs(n.rect.h - b.height) < 2);
    if (matches.length !== 1 || matches[0].i !== index) return { ref: null, reason: 'Native and inspectable WebView ordering is ambiguous. Recording is disabled to avoid replaying against another page.' };
  }
  const identifier = native[index]?.identifier || null;
  const uniqueId = identifier && native.filter(n => n.identifier === identifier).length === 1 ? identifier : null;
  return { ref: { testId: uniqueId, index, count: native.length, url: pageIdentity(view.url), title: view.title }, reason: null };
}

function checkDom(value: unknown): DomSnapshot {
  const d = value as DomSnapshot;
  if (!d || typeof d.url !== 'string' || d.url.length > 4000 || typeof d.title !== 'string' || !Array.isArray(d.nodes) || d.nodes.length > 400 || !d.viewport || ![d.viewport.width,d.viewport.height].every(Number.isFinite)) throw webviewError('The page did not return a valid DOM snapshot.');
  const ids = new Set<string>();
  const nodes = d.nodes.map(n => {
    if (!n || typeof n.id !== 'string' || ids.has(n.id) || typeof n.selector !== 'string' || n.selector.length > 2048 || typeof n.tag !== 'string' || typeof n.text !== 'string' || typeof n.label !== 'string' || !Number.isInteger(n.matches) || n.matches < 1 || !n.rect || ![n.rect.x,n.rect.y,n.rect.width,n.rect.height].every(Number.isFinite) || !Array.isArray(n.warnings) || typeof n.editable !== 'boolean' || typeof n.sensitive !== 'boolean') throw webviewError('The page returned an invalid DOM element.');
    ids.add(n.id);
    return { id: n.id, tag: n.tag.slice(0, 40), text: n.text.slice(0, 200), label: n.label.slice(0, 200), domId: String(n.domId || '').slice(0, 200), role: String(n.role || '').slice(0, 100),
      editable: n.editable, sensitive: n.sensitive, enabled: n.enabled === true, selector: n.selector, matches: n.matches, source: String(n.source || '').slice(0, 100),
      alternatives: (Array.isArray(n.alternatives) ? n.alternatives : []).slice(0, 10).filter(a => typeof a.selector === 'string' && a.selector.length <= 2048 && Number.isInteger(a.matches)).map(a => ({ selector: a.selector, matches: a.matches, source: String(a.source || '').slice(0, 100) })),
      warnings: n.warnings.slice(0, 10).map(w => String(w).slice(0, 300)), rect: { x: n.rect.x, y: n.rect.y, width: n.rect.width, height: n.rect.height } };
  });
  return { url: d.url, title: d.title.slice(0, 300), capturedAt: typeof d.capturedAt === 'string' ? d.capturedAt.slice(0, 40) : new Date().toISOString(),
    viewport: { width: d.viewport.width, height: d.viewport.height }, nodes, frames: Number.isInteger(d.frames) ? d.frames : 0, truncated: d.truncated === true,
    limitations: 'Top-level light DOM only. Frames and shadow DOM are not traversed. Bounds are CSS pixels, not Android screen coordinates. Input values are not collected.' };
}
const SCRIPT = `(${collectDomSnapshot.toString()})()`;

export function createWebviewInspector(call: WebviewCall) {
  let snapshot: { snapshotId: string; screenId: string; view: InspectableWebView; dom: DomSnapshot; ref: WebViewRef | null; reason: string | null } | null = null;
  const list = async () => normalizeWebviews(await call(['list']));
  async function read(id: string) {
    const views = await list();
    const view = views.find(v => v.id === id);
    if (!view) throw webviewError('This WebView is no longer available. Find pages again.', 'STALE_WEBVIEW');
    const dom = checkDom(await call(['eval', view.id, SCRIPT]));
    if (view.url && dom.url !== view.url) throw webviewError('The WebView navigated while being inspected. Refresh and select it again.', 'STALE_WEBVIEW');
    return { views, view: { ...view, url: dom.url, title: dom.title }, dom };
  }
  return {
    list,
    invalidate() { snapshot = null; },
    async inspect(id: unknown, screenId: string, native: NativeWebNode[]) {
      snapshot = null;
      if (typeof id !== 'string' || !id || id.length > 512) throw webviewError('Choose a page from the WebView list.', 'BAD_WEBVIEW', 400);
      const result = await read(id);
      const mapped = replayReference(result.view, result.views, native);
      snapshot = { snapshotId: randomUUID(), screenId, view: result.view, dom: result.dom, ...mapped };
      return snapshot;
    },
    async step(body: Record<string, unknown>, screenId: string | undefined): Promise<UiStep> {
      const cached = snapshot;
      if (!cached || body.snapshotId !== cached.snapshotId || cached.screenId !== screenId) throw webviewError('The captured screen or WebView changed. Inspect the page again before adding a step.', 'STALE_WEBVIEW');
      if (!cached.ref) throw webviewError(cached.reason || 'This WebView cannot be mapped for replay.');
      const old = cached.dom.nodes.find(n => n.id === body.nodeId);
      if (!old || old.matches !== 1) throw webviewError('Choose one uniquely matched DOM element.', 'AMBIGUOUS_DOM');
      const fresh = await read(cached.view.id);
      if (fresh.views.length !== cached.ref.count || fresh.views.findIndex(v => v.id === cached.view.id) !== cached.ref.index) throw webviewError('The WebView order changed. Inspect it again.', 'STALE_WEBVIEW');
      if (fresh.dom.url !== cached.dom.url) throw webviewError('The page navigated. Inspect it again.', 'STALE_WEBVIEW');
      const node = fresh.dom.nodes.find(n => n.selector === old.selector);
      if (!node || node.matches !== 1 || node.tag !== old.tag || node.text !== old.text || node.label !== old.label) throw webviewError('The selected DOM element changed. Inspect the page again.', 'STALE_WEBVIEW');
      const type = String(body.action);
      if (!['tap','type','clear','assert'].includes(type)) throw webviewError('Unsupported WebView recording action.', 'BAD_WEB_ACTION', 400);
      if (['type','clear'].includes(type) && !node.editable) throw webviewError('Choose an editable DOM input for typing or clearing.', 'BAD_WEB_ACTION', 400);
      const args: Record<string, unknown> = {};
      let secretEnv: string | undefined;
      if (type === 'type') {
        if (body.secretEnv) {
          if (typeof body.secretEnv !== 'string' || !/^[A-Z][A-Z0-9_]{0,63}$/.test(body.secretEnv)) throw webviewError('Use an environment variable name such as VORTEX_SECRET_WEB_INPUT.', 'BAD_SECRET', 400);
          secretEnv = body.secretEnv;
        } else {
          if (node.sensitive) throw webviewError('Password fields must use an environment variable reference.', 'BAD_SECRET', 400);
          if (typeof body.text !== 'string' || body.text.length > 4096) throw webviewError('Input text must be at most 4096 characters.', 'BAD_WEB_ACTION', 400);
          args.text = body.text;
        }
      }
      if (type === 'assert') {
        const assertion = String(body.assertion || 'visible');
        if (!['visible','enabled','disabled','text','contains','count'].includes(assertion)) throw webviewError('Unsupported DOM assertion.', 'BAD_WEB_ACTION', 400);
        if (node.editable && ['text','contains'].includes(assertion)) throw webviewError('DOM input values are not text assertions. Choose a presence or enabled-state check.', 'BAD_WEB_ACTION', 400);
        args.assertion = assertion;
        if (['text','contains'].includes(assertion)) {
          if (typeof body.expected !== 'string' || body.expected.length > 4096) throw webviewError('Expected text must be at most 4096 characters.', 'BAD_WEB_ACTION', 400);
          args.expected = body.expected;
        }
        if (assertion === 'count') {
          if (!Number.isInteger(body.expected) || Number(body.expected) < 0 || Number(body.expected) > 10000) throw webviewError('Expected count must be an integer from 0 to 10000.', 'BAD_WEB_ACTION', 400);
          args.expected = Number(body.expected);
        }
      }
      return { id: randomUUID(), type, title: (node.label || node.text || node.domId || node.tag).slice(0, 100), args, pre: true, mode: 'name',
        target: { kind: 'css', parts: { by: 'css', value: node.selector }, warnings: node.warnings },
        context: 'WEBVIEW', webview: cached.ref, ...(secretEnv ? { secretEnv } : {}) };
    },
  };
}
