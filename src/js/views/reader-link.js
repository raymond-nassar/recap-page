import {
  REPORT_LINK,
  TEMPORARY_LINK_LIFETIME,
  originalReaderDescription,
  parseTemporaryReaderLink,
  readerLinkReport,
  savedReaderIssue,
} from '../lib/temporaryReaderLink.js';
import { readerUrl } from '../reader.js';

// Nodes and effects are injected so this view cannot save state, open tabs, or submit reports.
export function createReaderLinkView({
  elements,
  getState,
  links,
  announce,
  onChange,
  focusFallback,
}) {
  let issueId = null;
  let source = 'saved';
  let draft = null;
  let report = null;
  let wired = false;
  const listeners = [];

  function held() {
    return savedReaderIssue(getState(), issueId);
  }

  function context(issue) {
    return { issue, digitalId: links.get(getState(), issueId), epoch: links.epoch };
  }

  function matches(snapshot, issue) {
    return snapshot?.issue === issue && snapshot.epoch === links.epoch
      && snapshot.digitalId === links.get(getState(), issueId);
  }

  function focusEdit() {
    const node = elements().edit;
    if (node.isConnected && !node.hidden && !node.disabled && !elements().root.hidden) node.focus();
    else focusFallback();
  }

  function error(message) {
    const nodes = elements();
    nodes.error.textContent = message;
    nodes.input.setAttribute('aria-invalid', 'true');
    announce(message);
  }

  function resetError() {
    const nodes = elements();
    nodes.error.textContent = '';
    nodes.input.removeAttribute('aria-invalid');
  }

  function preview() {
    resetError();
    const parsed = parseTemporaryReaderLink(elements().input.value);
    elements().preview.textContent = parsed.ok
      ? `Will use ${parsed.url}. Page position and extra address details are not retained.`
      : 'Paste a reader address to preview the destination.';
    refresh();
  }

  function refresh() {
    const nodes = elements();
    const issue = held();
    const current = links.get(getState(), issueId);
    const eligible = Boolean(issue) && links.known;
    nodes.root.hidden = issueId === null;
    nodes.edit.disabled = !eligible;
    nodes.revert.hidden = !eligible || current === null;
    nodes.reportToggle.disabled = !eligible;
    nodes.summary.textContent = eligible
      ? `Original: ${originalReaderDescription(issue)}. ${current === null
        ? 'Using the original link.'
        : `Temporary reader link in this tab: ${readerUrl(current)}.`} ${TEMPORARY_LINK_LIFETIME}`
      : 'A matching saved comic reference is needed. Temporary links do not verify comic identity or access.';
    if (draft && (!eligible || !matches(draft, issue))) {
      draft.stale = true;
      nodes.error.textContent = 'The saved comic or temporary link changed. Cancel and edit the current comic again.';
    }
    nodes.apply.disabled = !draft || draft.stale || !eligible;
    if (report && (!eligible || !matches(report, issue))) {
      nodes.reportStatus.textContent = 'These report details describe an earlier context. Review them or regenerate from the current comic.';
    }
    nodes.regenerate.disabled = !eligible;
  }

  function cancel({ focus = true } = {}) {
    draft = null;
    elements().form.hidden = true;
    elements().input.value = '';
    elements().preview.textContent = '';
    resetError();
    refresh();
    if (focus) focusEdit();
  }

  function hideReport() {
    report = null;
    const nodes = elements();
    nodes.reportPanel.hidden = true;
    nodes.reportText.value = '';
    nodes.reportStatus.textContent = '';
  }

  function show(id, { source: nextSource = 'saved' } = {}) {
    if (!['saved', 'bundled', 'api'].includes(nextSource)) throw new TypeError('Unrecognized comic source.');
    if (id !== issueId || nextSource !== source) {
      issueId = id;
      source = nextSource;
      elements().status.textContent = '';
      cancel({ focus: false });
      hideReport();
    }
    refresh();
  }

  function edit() {
    const issue = held();
    if (!issue || !links.known) {
      announce('A matching saved comic reference is needed before editing.');
      refresh();
      return;
    }
    draft = { ...context(issue), stale: false };
    const nodes = elements();
    const current = links.get(getState(), issueId);
    nodes.input.value = current === null ? '' : readerUrl(current);
    nodes.form.hidden = false;
    nodes.apply.textContent = `Use temporarily for ${issue.title || 'this comic'}`;
    nodes.status.textContent = 'Use this only for the same comic. The app cannot verify the address or subscription access.';
    preview();
    refresh();
    nodes.input.focus();
  }

  function apply(event) {
    event?.preventDefault();
    refresh();
    if (!draft || draft.stale || !held() || !links.known) {
      error('Edit the current saved comic again before choosing a temporary link.');
      return;
    }
    const result = links.use(getState(), issueId, elements().input.value);
    if (!result.ok) {
      error(result.error);
      elements().input.focus();
      return;
    }
    cancel({ focus: false });
    elements().status.textContent = 'Using temporarily in this tab. Nothing was saved to your library.';
    refresh();
    onChange();
    announce(elements().status.textContent);
    focusEdit();
  }

  function original() {
    const result = links.remove(getState(), issueId);
    if (!result.ok) {
      elements().status.textContent = result.error;
      announce(result.error);
      refresh();
      return;
    }
    cancel({ focus: false });
    elements().status.textContent = 'Using the current original link. Saved comic data is unchanged.';
    refresh();
    onChange();
    announce(elements().status.textContent);
    focusEdit();
  }

  function generateReport() {
    const issue = held();
    if (!issue || !links.known) {
      announce('A matching saved comic reference is needed for report details.');
      return;
    }
    report = context(issue);
    const nodes = elements();
    nodes.reportText.value = readerLinkReport(issue, report.digitalId);
    nodes.reportPanel.hidden = false;
    nodes.reportStatus.textContent =
      'Review and manually copy only what you want to share. Do not include lists, progress, notes, credentials, local paths or logs.';
  }

  function reconcile(outcome = { changed: false }) {
    const nodes = elements();
    const active = nodes.form.ownerDocument?.activeElement;
    const formFocused = active && nodes.form.contains(active);
    const reportFocused = active && nodes.reportPanel.contains(active);
    const result = links.reconcile(getState(), outcome);
    if (outcome.changed === true || outcome.changed === null) {
      cancel({ focus: false });
      hideReport();
    }
    refresh();
    if (result.removed || !result.known) {
      const message = result.known
        ? 'Temporary links for replaced or missing saved comics were cleared.'
        : 'Saved comic references are uncertain. Temporary links were cleared.';
      elements().status.textContent = message;
      announce(message);
    }
    onChange();
    if ((formFocused && nodes.form.hidden) || (reportFocused && nodes.reportPanel.hidden)) focusEdit();
    return result;
  }

  function clearDocument() {
    links.clear();
    cancel({ focus: false });
    hideReport();
    refresh();
    onChange();
  }

  function leave() {
    cancel({ focus: false });
    hideReport();
    issueId = null;
    refresh();
  }

  function wire() {
    if (wired) return;
    wired = true;
    const nodes = elements();
    nodes.label.textContent = 'Marvel Unlimited reader address';
    nodes.label.setAttribute('for', nodes.input.id);
    nodes.input.setAttribute('aria-describedby', `${nodes.preview.id} ${nodes.error.id}`);
    nodes.input.maxLength = 500;
    nodes.input.type = 'url';
    nodes.input.required = true;
    nodes.form.noValidate = true;
    nodes.reportText.setAttribute('aria-label', 'Optional report details to review and copy');
    nodes.reportLink.textContent = 'Open GitHub correction form (new tab)';
    for (const [name, value] of Object.entries(REPORT_LINK)) nodes.reportLink.setAttribute(name, value);
    nodes.reportDisclosure.textContent =
      'GitHub hosts this report and may require sign-in. Opening the form submits nothing. A report may help the project investigate a permanent fix; it does not change Marvel data or verify access. Fill the order and publication fields yourself; for a manual entry with no order, say so. Missing post-2025 metadata is expected; service or subscription problems may belong upstream.';
    for (const key of ['edit', 'cancel', 'revert', 'reportToggle', 'regenerate']) nodes[key].type = 'button';
    nodes.apply.type = 'submit';
    nodes.cancel.textContent = 'Cancel';
    nodes.revert.textContent = 'Use original link';
    nodes.edit.textContent = 'Edit temporary reader link';
    nodes.reportToggle.textContent = 'Report details';
    nodes.regenerate.textContent = 'Regenerate report details';
    nodes.form.hidden = true;
    nodes.reportPanel.hidden = true;
    const listen = (node, type, handler) => {
      node.addEventListener(type, handler);
      listeners.push(() => node.removeEventListener(type, handler));
    };
    listen(nodes.edit, 'click', edit);
    listen(nodes.cancel, 'click', () => cancel());
    listen(nodes.revert, 'click', original);
    listen(nodes.input, 'input', preview);
    listen(nodes.form, 'submit', apply);
    listen(nodes.form, 'keydown', (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    });
    listen(nodes.reportToggle, 'click', generateReport);
    listen(nodes.regenerate, 'click', generateReport);
    refresh();
  }

  function destroy() {
    for (const remove of listeners.splice(0)) remove();
    wired = false;
    leave();
  }

  return { wire, show, refresh, reconcile, clearDocument, leave, destroy };
}
