// One synchronous DOM dispatch, with checks in the same page evaluation. No retries.
// The primitives match MobileWright 0.0.69's WebView click/fill semantics.
export function performDomAction(command) {
  const reject = code => ({ outcome: 'rejected', code });
  if (location.href !== command.url) return reject('PAGE_CHANGED');
  if (!['tap','type','clear'].includes(command.action)) return reject('BAD_ACTION');
  const matches = document.querySelectorAll(command.selector);
  if (matches.length !== 1) return reject('AMBIGUOUS_ELEMENT');
  const el = matches[0], tag = el.tagName.toLowerCase();
  const inputLike = ['input','textarea','select'].includes(tag) || el.isContentEditable;
  const trim = value => String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  const text = inputLike ? '' : trim(el.innerText || el.textContent);
  const label = trim(el.getAttribute('aria-label') || el.labels?.[0]?.innerText || el.getAttribute('placeholder'));
  if (tag !== command.tag || text !== command.text || label !== command.label) return reject('ELEMENT_CHANGED');
  const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
  if (!rect.width || !rect.height || style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0 || el.closest('[inert],[aria-hidden="true"]')) return reject('ELEMENT_HIDDEN');
  for (let parent = el.parentElement; parent; parent = parent.parentElement) {
    const ancestorStyle = getComputedStyle(parent);
    if (ancestorStyle.visibility === 'hidden' || ancestorStyle.display === 'none' || Number(ancestorStyle.opacity) === 0) return reject('ELEMENT_HIDDEN');
  }
  if (el.disabled || el.getAttribute('aria-disabled') === 'true' || el.closest('fieldset:disabled')) return reject('ELEMENT_DISABLED');
  const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
  const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
  if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return reject('ELEMENT_HIDDEN');
  const hit = document.elementFromPoint(x, y);
  if (!hit || (hit !== el && !el.contains(hit))) return reject('ELEMENT_COVERED');
  if (command.action === 'tap') {
    if (typeof el.click !== 'function') return reject('BAD_ACTION');
    el.click();
  } else {
    const editable = tag === 'textarea' || el.isContentEditable || (tag === 'input' && ['text','email','password','search','tel','url','number'].includes(el.type));
    if (!editable || el.readOnly || el.getAttribute('aria-readonly') === 'true') return reject('NOT_EDITABLE');
    if (typeof command.value !== 'string' || command.value.length > 4096) return reject('BAD_INPUT');
    el.focus();
    if (el.isContentEditable) el.textContent = command.value;
    else {
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      if (descriptor?.set) descriptor.set.call(el, command.value);
      else el.value = command.value;
    }
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return { outcome: 'completed' };
}
