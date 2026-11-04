// Shared by capture, locator selection and the browser. Android autocomplete
// widgets extend EditText, but the accessibility tree exposes their concrete class.
export function isEditableControl(node) {
  return /(?:EditText|(?:Multi)?AutoCompleteTextView|TextField)$/i.test(node?.type || '');
}

export function findEditableInput(node, nodes) {
  const seen = new Set();
  while (node && !seen.has(node.id)) {
    if (isEditableControl(node)) return node;
    seen.add(node.id);
    node = node.parentId == null ? null : nodes.find(n => n.id === node.parentId);
  }
  return null;
}
