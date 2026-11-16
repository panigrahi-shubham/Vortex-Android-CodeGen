// WebView DOM remains a separate inspection surface: its CSS bounds are not screen pixels.
export function setupWebviewPanel({ call, onScreen, onStep }) {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  let inspected = null, selected = null, pending = false;
  const status = message => { $('#wvStatus').textContent = message; };
  function controls() {
    const ready = !pending && selected?.matches === 1 && !!inspected?.ref;
    for (const action of $('#wvActions').querySelectorAll('[data-wv-action]')) action.disabled = !ready || (['type','clear'].includes(action.dataset.wvAction) && !selected?.editable);
    $('#wvFind').disabled = pending;
    $('#wvInspect').disabled = pending || !$('#wvPages').value;
    $('#wvCopy').disabled = pending || !selected;
  }
  function clear() {
    inspected = null; selected = null;
    $('#wvNodes').replaceChildren(); $('#wvDetails').textContent = 'Select a DOM element.'; $('#wvSelector').value = ''; controls();
  }
  function renderNodes() {
    const query = $('#wvSearch').value.trim().toLowerCase();
    const nodes = (inspected?.dom.nodes || []).filter(n => [n.text,n.label,n.domId,n.tag,n.role,n.selector].some(v => String(v).toLowerCase().includes(query)));
    $('#wvNodes').innerHTML = nodes.map(n => `<button type="button" data-wv-node="${esc(n.id)}" style="display:block;width:100%;text-align:left;margin:4px 0" aria-pressed="${n.id === selected?.id}"><b>${esc(n.tag)}</b> ${esc(n.label || n.text || n.domId || '(empty)')}<br><small>${esc(n.selector)} · ${n.matches} match(es)</small></button>`).join('') || '<p>No visible top-level DOM elements match.</p>';
    $('#wvCount').textContent = `${nodes.length} of ${inspected?.dom.nodes.length || 0} elements`;
  }
  function choose(id) {
    selected = inspected?.dom.nodes.find(n => n.id === id) || null;
    if (!selected) return;
    $('#wvSelector').value = selected.selector;
    $('#wvDetails').textContent = JSON.stringify({ source: 'Web DOM', tag: selected.tag, label: selected.label, text: selected.text, enabled: selected.enabled, editable: selected.editable, boundsInCssPixels: selected.rect, locatorSource: selected.source, matches: selected.matches, warnings: selected.warnings, alternatives: selected.alternatives }, null, 2);
    $('#wvSensitive').checked = true; $('#wvSensitive').disabled = selected.sensitive;
    $('#wvInput').value = ''; $('#wvInput').disabled = true;
    $('#wvExpected').value = selected.text;
    renderNodes(); controls();
  }
  async function request(operation) {
    if (pending) return;
    pending = true; controls();
    try { await operation(); }
    catch (error) { status(error.message || 'WebView inspection failed. Native inspection remains available.'); }
    finally { pending = false; controls(); }
  }
  async function find() {
    clear(); $('#wvPages').replaceChildren(new Option('Choose an inspectable page', ''));
    status('Finding pages through the current device owner...');
    const response = await call('/api/webviews');
    if (!response.ok) throw Error(response.data.error || 'Could not discover pages.');
    onScreen(response.data.screen);
    for (const page of response.data.pages) $('#wvPages').add(new Option(`${page.title || '(untitled)'} — ${page.url}`, page.id));
    status((response.data.simulated ? 'Simulated WebView. ' : '') + response.data.message);
  }
  $('#btnWebview').onclick = () => { $('#wvDlg').showModal(); request(find); };
  $('#wvFind').onclick = () => request(find);
  $('#wvPages').onchange = () => { clear(); status('Choose Inspect page to read this page’s DOM.'); controls(); };
  $('#wvInspect').onclick = () => request(async () => {
    const id = $('#wvPages').value; clear(); status('Reading the selected page; no device action is sent...');
    const response = await call('/api/webviews/inspect', { id });
    if (!response.ok) throw Error(response.data.error || 'DOM inspection unavailable.');
    inspected = response.data; onScreen(inspected.screen);
    $('#wvLimitations').textContent = inspected.dom.limitations + ` Frames detected: ${inspected.dom.frames}.` + (inspected.dom.truncated ? ' Snapshot truncated; narrow the page before inspecting again.' : '');
    status((inspected.simulated ? 'Simulated DOM. ' : '') + (inspected.reason || 'DOM ready. Adding a step records it only; it runs during replay.'));
    renderNodes();
  });
  $('#wvSearch').oninput = renderNodes;
  $('#wvNodes').onclick = event => { const button = event.target.closest('[data-wv-node]'); if (button && !pending) choose(button.dataset.wvNode); };
  $('#wvSensitive').onchange = () => { $('#wvInput').disabled = $('#wvSensitive').checked; if ($('#wvSensitive').checked) $('#wvInput').value = ''; };
  $('#wvCopy').onclick = async () => {
    try { await navigator.clipboard.writeText($('#wvSelector').value); status('Copied CSS selector. Use it within the selected WebView context.'); }
    catch { $('#wvSelector').focus(); $('#wvSelector').select(); status('Select and copy the CSS selector manually.'); }
  };
  $('#wvActions').onclick = event => {
    const button = event.target.closest('[data-wv-action]');
    if (!button || button.disabled || !selected || !inspected) return;
    request(async () => {
      const action = button.dataset.wvAction;
      const body = { snapshotId: inspected.snapshotId, nodeId: selected.id, action };
      if (action === 'type') {
        if ($('#wvSensitive').checked) body.secretEnv = $('#wvSecretEnv').value.trim();
        else body.text = $('#wvInput').value;
        if ($('#wvSensitive').checked && !body.secretEnv) throw Error('Enter the environment variable that will provide this value during replay.');
      }
      if (action === 'assert') {
        body.assertion = $('#wvAssertion').value;
        body.expected = body.assertion === 'count' ? Number($('#wvExpected').value) : $('#wvExpected').value;
      }
      const response = await call('/api/webviews/step', body);
      if (!response.ok) {
        if (['STALE_WEBVIEW','AMBIGUOUS_DOM'].includes(response.data.code)) clear();
        throw Error(response.data.error || 'Could not add the step.');
      }
      onStep(response.data.step); $('#wvInput').value = '';
      status('Added ' + action + ' step to the recording. No action was executed on the page.');
    });
  };
  controls();
}
