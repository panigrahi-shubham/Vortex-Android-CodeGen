// Runs inside the selected WebView. Read-only, bounded, and deliberately excludes input values.
// Keep this function self-contained: Mobilecli evaluates its source on the device.
export function collectDomSnapshot() {
  const limit = 400, scanLimit = 3000;
  const nodes = [];
  const candidates = document.querySelectorAll('a,button,input,textarea,select,[contenteditable="true"],[role],label,h1,h2,h3,p,span');
  const trim = (value, max = 200) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);
  const attrSelector = (name, value) => `[${name}="${CSS.escape(value)}"]`;
  const count = selector => document.querySelectorAll(selector).length;
  for (const el of Array.from(candidates).slice(0, scanLimit)) {
    if (nodes.length >= limit) break;
    const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
    if (!rect.width || !rect.height || rect.bottom <= 0 || rect.right <= 0 || rect.top >= innerHeight || rect.left >= innerWidth || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || el.closest('[inert],[aria-hidden="true"]')) continue;
    const tag = el.tagName.toLowerCase();
    const inputLike = ['input','textarea','select'].includes(tag) || el.isContentEditable;
    const text = inputLike ? '' : trim(el.innerText || el.textContent);
    const label = trim(el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('placeholder'));
    if (['span','p','label'].includes(tag) && !text && !el.getAttribute('role')) continue;
    const alternatives = [];
    for (const name of ['data-testid', 'data-test', 'data-qa']) {
      const value = el.getAttribute(name);
      if (value) alternatives.push({ selector: attrSelector(name, value), source: name });
    }
    if (el.id && !/^(?:ember|react|radix|mui)[-_:]?\d/i.test(el.id)) alternatives.push({ selector: '#' + CSS.escape(el.id), source: 'DOM id' });
    for (const name of ['name', 'aria-label']) {
      const value = el.getAttribute(name);
      if (value) alternatives.push({ selector: tag + attrSelector(name, value), source: name });
    }
    for (const candidate of alternatives) candidate.matches = count(candidate.selector);
    let preferred = alternatives.find(candidate => candidate.matches === 1);
    const warnings = [];
    if (!preferred) {
      const parts = [];
      for (let node = el; node && node.nodeType === 1; node = node.parentElement) {
        const name = node.tagName.toLowerCase();
        const peers = node.parentElement ? Array.from(node.parentElement.children).filter(other => other.tagName === node.tagName) : [node];
        parts.unshift(name + (peers.length > 1 ? `:nth-of-type(${peers.indexOf(node) + 1})` : ''));
        if (parts.length >= 16) break;
      }
      const selector = parts.join(' > ');
      preferred = { selector, source: 'DOM position', matches: count(selector) };
      alternatives.push(preferred);
      warnings.push('Positional CSS depends on the current DOM structure. Review it before replay.');
    }
    if (preferred.selector.length > 2048) continue;
    const editable = tag === 'textarea' || el.isContentEditable || (tag === 'input' && ['text','email','password','search','tel','url','number'].includes((el.type || 'text').toLowerCase()));
    nodes.push({ id: String(nodes.length), tag, text, label, domId: trim(el.id), role: trim(el.getAttribute('role')), editable,
      sensitive: tag === 'input' && el.type === 'password', enabled: !el.disabled && el.getAttribute('aria-disabled') !== 'true',
      selector: preferred.selector, matches: preferred.matches, source: preferred.source, alternatives, warnings,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } });
  }
  return { url: location.href, title: document.title, capturedAt: new Date().toISOString(), viewport: { width: innerWidth, height: innerHeight },
    nodes, frames: document.querySelectorAll('iframe,frame').length, truncated: candidates.length > scanLimit || nodes.length >= limit,
    limitations: 'Top-level light DOM only. Frames and shadow DOM are not traversed. Bounds are CSS pixels, not Android screen coordinates. Input values are not collected.' };
}
