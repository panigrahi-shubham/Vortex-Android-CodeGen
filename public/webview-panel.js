// WebView DOM remains a separate inspection surface: its CSS bounds are not screen pixels.
export function setupWebviewPanel({ call, onScreen, onStep, onVisualMode, onInvalidate = () => {}, context = () => ({}) }) {
  const $ = selector => document.querySelector(selector);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  let inspected = null, selected = null, pending = false;
  const pendingKey = 'vortex.webview.pendingAction';
  let pendingAction = null;
  try { const saved = localStorage.getItem(pendingKey); if (/^[A-Za-z0-9-]{16,64}$/.test(saved || '')) pendingAction = saved; } catch {}
  let reviewRequired = false;
  function remember(id) { pendingAction = id; try { if (id) localStorage.setItem(pendingKey, id); else localStorage.removeItem(pendingKey); } catch {} }
  const status = message => { $('#wvStatus').textContent = message; };
  function controls() {
    const ready = !pending && selected?.matches === 1 && !!inspected?.ref;
    for (const action of $('#wvActions').querySelectorAll('[data-wv-action]')) {
      const kind = action.dataset.wvAction, live = $('#wvExecution').value === 'live' && kind !== 'assert';
      action.disabled = !ready || (live && !!pendingAction) || (['type','clear'].includes(kind) && !selected?.editable);
      action.textContent = (live ? 'Run & record ' : 'Add ') + (kind === 'assert' ? 'assertion' : kind + (live ? '' : ' step'));
    }
    $('#wvRecoverAction').hidden = !pendingAction;
    $('#wvRecoverAction').disabled = pending;
    $('#wvAcknowledgeAction').hidden = !reviewRequired;
    $('#wvAcknowledgeAction').disabled = pending;
    $('#wvExecution').disabled = pending;
    $('#wvFind').disabled = pending;
    $('#wvVisual').disabled = pending || !!pendingAction;
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
    if (query) {
      const score = node => [node.text, node.label, node.domId].some(value => value.toLowerCase() === query) ? 2 :
        /^(?:a|button|input|textarea|select)$/.test(node.tag) ? 1 : 0;
      nodes.sort((a, b) => score(b) - score(a));
    }
    $('#wvNodes').innerHTML = nodes.map(n => `<button type="button" data-wv-node="${esc(n.id)}" style="display:block;width:100%;text-align:left;margin:4px 0" aria-pressed="${n.id === selected?.id}"><b>${esc(n.tag)}</b> ${esc(n.label || n.text || n.domId || '(empty)')}<br><small>${esc(n.selector)} · ${n.matches} match(es)</small></button>`).join('') || '<p>No visible top-level DOM elements match.</p>';
    $('#wvCount').textContent = `${nodes.length} of ${inspected?.dom.nodes.length || 0} elements`;
  }
  function choose(id) {
    selected = inspected?.dom.nodes.find(n => n.id === id) || null;
    if (!selected) return;
    $('#wvSelector').value = selected.selector;
    $('#wvDetails').textContent = JSON.stringify({ source: 'Web DOM', tag: selected.tag, label: selected.label, text: selected.text, enabled: selected.enabled, editable: selected.editable, boundsInCssPixels: selected.rect, locatorSource: selected.source, matches: selected.matches, warnings: selected.warnings, alternatives: selected.alternatives }, null, 2);
    $('#wvSensitive').checked = true; $('#wvSensitive').disabled = selected.sensitive;
    $('#wvInput').value = ''; $('#wvLiveInput').value = ''; syncInput();
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
  $('#wvVisual').onclick = () => { $('#wvDlg').close(); onVisualMode(); };
  $('#wvFind').onclick = () => request(find);
  $('#wvPages').onchange = () => { clear(); status('Choose Inspect page to read this page’s DOM.'); controls(); };
  $('#wvInspect').onclick = () => request(async () => {
    const id = $('#wvPages').value; clear(); status('Reading the selected page; no device action is sent...');
    const response = await call('/api/webviews/inspect', { id });
    if (!response.ok) throw Error(response.data.error || 'DOM inspection unavailable.');
    inspected = response.data; onScreen(inspected.screen);
    $('#wvLimitations').textContent = inspected.dom.limitations + ` Frames detected: ${inspected.dom.frames}.` + (inspected.dom.truncated ? ' Snapshot truncated; narrow the page before inspecting again.' : '');
    status((inspected.simulated ? 'Simulated DOM. ' : '') + (inspected.reason || ($('#wvExecution').value === 'live' ? 'DOM ready. Run & record executes tap, type and clear now; assertions are added for replay.' : 'DOM ready. Adding a step records it only; it runs during replay.')));
    renderNodes();
  });
  $('#wvSearch').oninput = renderNodes;
  $('#wvNodes').onclick = event => { const button = event.target.closest('[data-wv-node]'); if (button && !pending) choose(button.dataset.wvNode); };
  function syncInput() {
    $('#wvInput').disabled = $('#wvSensitive').checked;
    $('#wvLiveInputRow').hidden = $('#wvExecution').value !== 'live' || !$('#wvSensitive').checked;
  }
  $('#wvSensitive').onchange = () => { syncInput(); $('#wvInput').value = ''; $('#wvLiveInput').value = ''; };
  $('#wvExecution').onchange = () => { syncInput(); controls(); if (!pendingAction) status($('#wvExecution').value === 'live' ? 'Run & record enabled. Tap, type and clear execute on the app now and add one recorded step.' : 'Add step only: no app action is executed.'); };
  function applyInspection(data) {
    inspected = data; selected = null;
    $('#wvSelector').value = ''; $('#wvDetails').textContent = 'Select a DOM element from the updated page.';
    if (data) {
      $('#wvLimitations').textContent = data.dom.limitations + ` Frames detected: ${data.dom.frames}.` + (data.simulated ? ' The native mock image is static; DOM state is live.' : '');
      renderNodes();
    } else clear();
  }
  function acceptReceipt(data) {
    const receipt = data.receipt;
    if (!receipt) throw Error('The action result is missing. Recover the last result before doing another live action.');
    if (receipt.outcome === 'completed') {
      const current = context();
      if (data.current?.appPackage !== receipt.appPackage || data.current?.serial !== receipt.serial || (current.appPackage && current.appPackage !== receipt.appPackage)) {
        reviewRequired = true;
        status('This action belongs to a different app or device. Open its matching recording before recovering the step.'); return;
      }
      onStep(receipt.step);
      remember(null); reviewRequired = false;
      if (data.screen) onScreen(data.screen);
      applyInspection(data.inspection || null);
      status(data.warning || receipt.warning || (data.duplicate ? 'Recovered the completed action and its recorded step. The action was not sent again. Inspect the page to continue.' : 'Action completed and recorded. Select a control from the refreshed DOM to continue.'));
    } else if (receipt.outcome === 'rejected') {
      remember(null); reviewRequired = false; clear();
      const reasons = { PAGE_CHANGED: 'The page changed.', ELEMENT_CHANGED: 'The selected element changed.', ELEMENT_HIDDEN: 'The element is not visible.', ELEMENT_DISABLED: 'The element is disabled.', ELEMENT_COVERED: 'Another element covers this control.', AMBIGUOUS_ELEMENT: 'The selector no longer matches one element.', NOT_EDITABLE: 'The field cannot be edited.' };
      status('No action was executed. ' + (reasons[receipt.code] || 'The page rejected the action.') + ' Inspect again before continuing.');
    } else {
      clear(); reviewRequired = receipt.outcome === 'unknown';
      status(receipt.outcome === 'started' ? 'The action is still running. Recover its result again shortly.' : receipt.warning || 'The action outcome is unknown. Inspect the app; it will not be retried automatically.');
    }
  }
  $('#wvRecoverAction').onclick = () => request(async () => {
    if (!pendingAction) return;
    const response = await call('/api/webviews/actions/' + encodeURIComponent(pendingAction));
    if (!response.ok) { reviewRequired = true; clear(); throw Error(response.data.error || 'No action receipt is available. Inspect the app before deciding what to do.'); }
    acceptReceipt({ ...response.data, duplicate: true });
  });
  $('#wvAcknowledgeAction').onclick = () => { remember(null); reviewRequired = false; clear(); status('Outcome reviewed. Find and inspect the intended page before choosing a new action.'); };

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
      const live = $('#wvExecution').value === 'live' && action !== 'assert';
      if (live) {
        if (pendingAction) throw Error('Recover the previous action result before starting another live action.');
        if (action === 'type' && body.secretEnv) {
          body.liveText = $('#wvLiveInput').value;
          if (!body.liveText) throw Error('Enter the value for this live action. Its replay uses the environment variable.');
        }
        body.requestId = crypto.randomUUID();
        remember(body.requestId); reviewRequired = false; onInvalidate();
        $('#wvLiveInput').value = ''; $('#wvInput').value = '';
        const response = await call('/api/webviews/execute', body);
        if (!response.ok) {
          if (response.status >= 400 && response.status < 500 || response.status === 503) remember(null);
          clear();
          throw Error(response.data.error || 'The response was lost. Recover the last result before repeating an action.');
        }
        acceptReceipt(response.data); return;
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
  syncInput(); controls();
}
