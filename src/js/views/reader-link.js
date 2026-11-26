import { readerClosureNotice } from '../lib/readerDestination.js';

export function createReaderLinkView({ elements, getState, links, onChange, focusFallback }) {
  let issueId = null;

  // #1601: without a verified link the control reads Find on Marvel Comics, so this reuses the
  // owner's approved notice rather than describing a Read button the comic does not have.
  function refresh() {
    const nodes = elements();
    nodes.root.hidden = issueId === null;
    nodes.summary.textContent = readerClosureNotice();
  }

  function show(id) {
    if (issueId !== id) elements().help.open = false;
    issueId = id;
    refresh();
  }

  function leave() {
    const nodes = elements();
    const ownedFocus = nodes.root.contains(nodes.root.ownerDocument?.activeElement);
    issueId = null;
    nodes.help.open = false;
    refresh();
    if (ownedFocus) focusFallback();
  }

  function reconcile(outcome) {
    const result = links.reconcile(getState(), outcome);
    refresh();
    onChange();
    return result;
  }

  function clearDocument() {
    links.clear();
    refresh();
    onChange();
  }

  function wire() {
    elements().help.open = false;
    refresh();
  }

  return { wire, show, refresh, reconcile, clearDocument, leave, destroy: leave };
}
