// Persistent sanitized receipts prevent a repeated request ID from dispatching a second action.
import fs from 'node:fs';
import path from 'node:path';
import { atomicWrite } from './project/project.ts';
import { webviewError, type PreparedWebAction } from './webview-inspector.ts';
import type { DomActionOutcome } from '../public/webview-action.js';
import type { UiStep } from './model/recording.ts';

export interface WebActionReceipt {
  version: 1; requestId: string; outcome: 'started' | 'completed' | 'rejected' | 'unknown';
  createdAt: string; updatedAt: string; step: UiStep; appPackage: string; serial: string;
  code?: string; warning?: string;
}
export interface WebActionRequest {
  body: Record<string, unknown>; appPackage: string; serial: string;
  prepare(): Promise<PreparedWebAction>;
  ready(): Promise<void>;
  invalidate(): void;
  dispatch(prepared: PreparedWebAction, value: string): Promise<DomActionOutcome>;
  observe(prepared: PreparedWebAction): Promise<Record<string, unknown>>;
}
const ID = /^[A-Za-z0-9-]{16,64}$/;
export function createWebActionJournal(stateDir: string) {
  const root = path.join(stateDir, 'webview-actions');
  const inFlight = new Set<string>();
  const file = (id: string) => {
    if (!ID.test(id)) throw webviewError('A unique action request ID is required.', 'BAD_REQUEST_ID', 400);
    return path.join(root, id + '.json');
  };
  function save(receipt: WebActionReceipt) {
    atomicWrite(file(receipt.requestId), JSON.stringify(receipt, null, 2));
  }
  function get(id: string): WebActionReceipt | null {
    const target = file(id);
    if (!fs.existsSync(target)) return null;
    let r: WebActionReceipt;
    try { r = JSON.parse(fs.readFileSync(target, 'utf8')) as WebActionReceipt; }
    catch { throw webviewError('This action receipt is unreadable. It was preserved; do not repeat the action automatically.', 'BAD_ACTION_RECEIPT'); }
    if (r.version !== 1 || r.requestId !== id || !['started','completed','rejected','unknown'].includes(r.outcome) || !r.step?.id) throw webviewError('This action receipt is invalid. Do not repeat the action automatically.', 'BAD_ACTION_RECEIPT');
    if (r.outcome === 'started' && !inFlight.has(id)) {
      r = { ...r, outcome: 'unknown', updatedAt: new Date().toISOString(), warning: 'The recorder stopped before the action result was saved. Inspect the app before deciding what to do; this request will not execute again.' };
      save(r);
    }
    return r;
  }
  return {
    get,
    async execute(request: WebActionRequest): Promise<Record<string, unknown> & { receipt: WebActionReceipt }> {
      const id = typeof request.body.requestId === 'string' ? request.body.requestId : '';
      const existing = get(id);
      if (existing) return { receipt: existing, duplicate: true, needsRefresh: true, actionCompleted: existing.outcome === 'completed' };
      if (!['tap','type','clear'].includes(String(request.body.action))) throw webviewError('Live recording supports tap, type and clear. Add assertions separately.', 'BAD_WEB_ACTION', 400);
      const prepared = await request.prepare();
      let value = '';
      if (prepared.step.type === 'type') {
        const source = prepared.step.secretEnv ? request.body.liveText : prepared.step.args?.text;
        if (typeof source !== 'string' || source.length > 4096 || (prepared.step.secretEnv && !source.length)) throw webviewError('Enter a value for this live action. Sensitive values are used once and are not saved.', 'LIVE_VALUE_REQUIRED', 400);
        value = source;
      }
      await request.ready();
      // Recheck after asynchronous preparation, so concurrent calls sharing an ID cannot both dispatch.
      const found = get(id);
      if (found) return { receipt: found, duplicate: true, needsRefresh: true, actionCompleted: found.outcome === 'completed' };
      const now = new Date().toISOString();
      let receipt: WebActionReceipt = { version: 1, requestId: id, outcome: 'started', createdAt: now, updatedAt: now,
        step: structuredClone(prepared.step), appPackage: request.appPackage, serial: request.serial };
      save(receipt); // Persistence failure here prevents dispatch.
      inFlight.add(id);
      try {
        request.invalidate();
        let result: DomActionOutcome;
        try { result = await request.dispatch(prepared, value); }
        catch { result = { outcome: 'rejected', code: 'TRANSPORT_OUTCOME_UNKNOWN' }; }
        if (result?.outcome === 'completed') receipt = { ...receipt, outcome: 'completed' };
        else if (result?.outcome === 'rejected' && result.code !== 'TRANSPORT_OUTCOME_UNKNOWN') receipt = { ...receipt, outcome: 'rejected', code: result.code || 'ACTION_REJECTED' };
        else receipt = { ...receipt, outcome: 'unknown', warning: 'The device response was lost or inconclusive. Inspect the app before deciding what to do. This request will not execute again.' };
        receipt.updatedAt = new Date().toISOString();
        try { save(receipt); }
        catch {
          // The original started record remains a durable barrier against a second dispatch.
          receipt = { ...receipt, warning: 'The action result could not be saved. Preserve this result and inspect the app; do not repeat the action automatically.' };
        }
        if (receipt.outcome !== 'completed') return { receipt, needsRefresh: true, actionCompleted: false };
        try { return { ...(await request.observe(prepared)), receipt, actionCompleted: true }; }
        catch { return { receipt, actionCompleted: true, needsRefresh: true, warning: 'Action completed, but the updated screen could not be read. Its recorded step is kept. Refresh before continuing; do not repeat the action.' }; }
      } finally { value = ''; inFlight.delete(id); }
    },
  };
}
