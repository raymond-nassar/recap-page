import { readerDestination } from '../lib/readerDestination.js';

export function createReaderLinkView({ elements, getState, links, onChange, focusFallback, now = () => new Date() }) {
  let issueId = null;

  function refresh() {
    const nodes = elements();
    nodes.root.hidden = issueId === null;
    nodes.summary.textContent = readerDestination(now()) === 'unlimited'
      ? 'Read opens the Marvel Unlimited web reader when a reader link is recorded. Otherwise it looks up the link or opens the comic details page. Reading ends December 7, 2026.'
      : 'Read opens the Marvel Comics website, not a single-comic link. Find the comic there.';
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
