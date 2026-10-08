import { isIssueRating, issueRating } from '../lib/model.js';

const identity = (issue) => issue
  ? JSON.stringify([issue.issueId, issue.title, issue.seriesName, issue.number])
  : null;

export function createIssueRatingView({ elements, getState, isBlocked, saveRating, announce }) {
  let current = null;
  let savedIdentity = null;
  let draft = null;
  let saving = false;
  let restoreFocus = true;

  function error(message) {
    elements().error.textContent = message;
  }

  function close({ focus = true } = {}) {
    restoreFocus = focus;
    draft = null;
    if (elements().dialog.open) elements().dialog.close();
  }

  function refresh() {
    const nodes = elements();
    nodes.root.hidden = !current;
    if (!current) return;
    const state = getState();
    const unavailable = isBlocked();
    const replaced = savedIdentity !== null && identity(state.issues[current.issueId]) !== savedIdentity;
    const score = issueRating(state, current.issueId);
    nodes.trigger.disabled = unavailable || replaced;
    nodes.label.textContent = unavailable || replaced ? 'Rating unavailable'
      : score === null ? 'Rate this issue' : `Your rating: ${score}/5`;
    nodes.trigger.setAttribute('aria-label', unavailable || replaced ? 'Rating unavailable'
      : score === null ? `Rate ${current.title}` : `Your rating: ${score} out of 5. Edit rating for ${current.title}.`);
    nodes.root.classList.toggle('is-rated', score !== null && !unavailable);
    nodes.status.textContent = unavailable
      ? 'Ratings are unavailable while saved reading data cannot be read. Open Backup & settings.'
      : replaced ? 'This saved comic changed. Reopen its details to rate it.' : '';
    nodes.status.hidden = !nodes.status.textContent;
    if (draft && !saving && (unavailable || replaced || score !== draft.original)) {
      draft.stale = true;
      error('The saved comic or rating changed. Cancel and reopen the rating editor before saving.');
    }
    paintDraft();
  }

  function paintDraft() {
    if (!draft) return;
    const nodes = elements();
    const value = nodes.input.value === '' ? null : Number(nodes.input.value);
    const valid = isIssueRating(value);
    nodes.input.setAttribute('aria-invalid', String(nodes.input.value !== '' && !valid));
    for (const button of nodes.stars) {
      const fill = valid ? Math.max(0, Math.min(1, value - Number(button.dataset.rating) + 1)) : 0;
      button.dataset.fill = fill === 1 ? 'full' : fill === 0.5 ? 'half' : 'empty';
      button.disabled = saving || draft.stale;
    }
    nodes.input.disabled = saving || draft.stale;
    nodes.decrease.disabled = saving || draft.stale || !valid || value <= 0.5;
    nodes.increase.disabled = saving || draft.stale || value === 5;
    nodes.save.disabled = saving || draft.stale || !valid;
    nodes.remove.disabled = saving || draft.stale;
  }

  function open() {
    refresh();
    const nodes = elements();
    if (!current || nodes.trigger.disabled || nodes.dialog.open) return;
    const original = issueRating(getState(), current.issueId);
    draft = { issueId: current.issueId, original, stale: false };
    nodes.comic.textContent = current.title;
    nodes.input.value = original ?? '';
    nodes.remove.hidden = original === null;
    restoreFocus = true;
    error('');
    paintDraft();
    nodes.dialog.showModal();
  }

  function change(value) {
    if (!draft || draft.stale || saving) return;
    elements().input.value = value;
    error('');
    paintDraft();
  }

  function commit(clear = false) {
    refresh();
    if (!draft || draft.stale || saving) return;
    const nodes = elements();
    const value = clear ? null : nodes.input.value === '' ? NaN : Number(nodes.input.value);
    if (!clear && !isIssueRating(value)) {
      error('Choose a rating from 0.5 to 5 in half-star increments.');
      return;
    }
    saving = true;
    paintDraft();
    let result;
    try {
      result = saveRating(draft.issueId, value);
    } catch (failure) {
      error(`The rating could not be saved (${failure.message}). Your draft is still here.`);
      return;
    } finally {
      saving = false;
      paintDraft();
    }
    if (!result.ok) {
      error(result.error || 'The rating could not be saved. Your draft is still here; try again.');
      refresh();
      return;
    }
    close();
    refresh();
    announce(value === null ? 'Your rating was removed.' : `Your rating was saved: ${value} out of 5.`);
  }

  function show(issue, { source = 'saved' } = {}) {
    if (current?.issueId !== issue.issueId || identity(current) !== identity(issue)) close({ focus: false });
    current = issue;
    savedIdentity = source === 'saved' ? identity(issue) : null;
    refresh();
  }

  function leave() {
    close({ focus: false });
    current = null;
    savedIdentity = null;
    elements().root.hidden = true;
  }

  function wire() {
    const nodes = elements();
    nodes.trigger.addEventListener('click', open);
    nodes.form.addEventListener('submit', (event) => { event.preventDefault(); commit(); });
    nodes.cancel.addEventListener('click', () => close());
    nodes.remove.addEventListener('click', () => commit(true));
    nodes.dialog.addEventListener('cancel', () => { restoreFocus = true; draft = null; });
    nodes.dialog.addEventListener('close', () => {
      if (nodes.dialog.open) return;
      draft = null;
      if (restoreFocus && current && !nodes.root.hidden && !nodes.trigger.disabled) nodes.trigger.focus();
    });
    nodes.input.addEventListener('input', () => {
      error(nodes.input.value !== '' && !isIssueRating(Number(nodes.input.value))
        ? 'Choose a rating from 0.5 to 5 in half-star increments.' : '');
      paintDraft();
    });
    for (const button of nodes.stars) {
      button.addEventListener('click', () => change(Number(button.dataset.rating)));
    }
    nodes.decrease.addEventListener('click', () => change(Math.max(0.5, Number(nodes.input.value) - 0.5)));
    nodes.increase.addEventListener('click', () => change(Math.min(5, Number(nodes.input.value) + 0.5)));
  }

  return { wire, show, leave, refresh };
}
