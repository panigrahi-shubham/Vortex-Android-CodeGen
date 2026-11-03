// Assertion intelligence: turns the recorder's raw before/after suggestions into a short, ranked list.
//
// Rules (shown to the user as the suggestion's reason):
//  - duplicates (same check on the same element) are merged;
//  - an exact-text check on a value that looks dynamic (counts, prices, times) becomes a visibility check, because the
//    exact value will differ on the next run;
//  - checks on the acted-on element's state (checked/selected/enabled) rank first, then elements that appeared or
//    disappeared, then text changes; stable resource-ids rank above labels and texts;
//  - checks without a locator are dropped (they could only be coordinates);
//  - at most six suggestions are kept; the UI requires explicit acceptance.

import { isDynamic } from '../locators.js';

export interface Suggestion {
  assertion: string;
  expected?: string | number;
  expr?: string | null;
  parts?: { by: string; value?: string } | null;
  kind?: string;
  title?: string;
  reason?: string;
  rank?: number;
}

const BASE: Record<string, number> = { checked: 70, unchecked: 70, selected: 68, unselected: 68, enabled: 62, disabled: 62, visible: 55, hidden: 50, text: 45, contains: 40, count: 35 };

export function refineSuggestions(list: Suggestion[], max = 6): Suggestion[] {
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const raw of list) {
    if (!raw.parts) continue;
    let s: Suggestion = { ...raw };
    if (s.assertion === 'text' && isDynamic(String(s.expected ?? ''))) {
      s = { ...s, assertion: 'visible', expected: undefined, reason: `${s.reason ? s.reason + '; ' : ''}value "${String(raw.expected)}" looks dynamic, so it checks the element is shown instead of its exact text` };
    }
    const key = `${s.assertion}|${JSON.stringify(s.parts)}|${s.expected ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const byScore = s.parts?.by === 'id' ? 15 : s.parts?.by === 'label' ? 5 : s.parts?.by === 'scoped' ? 3 : 0;
    s.rank = (BASE[s.assertion] ?? 30) + byScore - (isDynamic(String(s.title ?? '')) ? 10 : 0);
    out.push(s);
  }
  return out.sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).slice(0, max);
}
