import { isIssueRating, issueRating } from '../lib/model.js';
import { labelledName, shownName } from '../lib/accname.js';

const identity = (issue) => issue
  ? JSON.stringify([issue.issueId, issue.title, issue.seriesName, issue.number])
  : null;

export function createIssueRatingView({ elements, getState, isBlocked, blockedMessage = () => null, saveRating, announce }) {
  let current = null;
  let savedIdentity = null;
  let draft = null;
  let saving = false;
  let restoreFocus = true;
  // Where focus goes when a rating opened from somewhere other than the details page closes. It is a
  // function rather than an element because saving redraws the list row that opened it.
  let returnTo = null;

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
    const state = getState();
    const unavailable = isBlocked();
    if (current) paintTrigger(nodes, state, unavailable);
    const replaced = draft && draft.identity !== null && identity(state.issues[draft.issueId]) !== draft.identity;
    if (draft && !saving && (unavailable || replaced || issueRating(state, draft.issueId) !== draft.original)) {
      draft.stale = true;
      error('The saved comic or rating changed. Cancel and reopen the rating editor before saving.');
    }
    paintDraft();
  }

  function paintTrigger(nodes, state, unavailable) {
    const replaced = savedIdentity !== null && identity(state.issues[current.issueId]) !== savedIdentity;
    const score = issueRating(state, current.issueId);
    nodes.trigger.disabled = unavailable || replaced;
    const label = unavailable || replaced ? 'Rating unavailable'
      : score === null ? 'Rate this comic' : `Your rating: ${score}/5`;
    nodes.label.textContent = label;
    // The button's words lead its name, then the comic it rates (#905).
    nodes.trigger.setAttribute('aria-label', unavailable || replaced ? label
      : score === null ? labelledName(label, current.title) : shownName([label], `Edit rating for ${current.title}`));
    nodes.root.classList.toggle('is-rated', score !== null && !unavailable);
    nodes.status.textContent = unavailable
      ? blockedMessage() || 'Ratings are unavailable while saved reading data cannot be read. Open Backup & settings.'
      : replaced ? 'This saved comic changed. Reopen its details to rate it.' : '';
    nodes.status.hidden = !nodes.status.textContent;
  }

  function paintDraft() {
    if (!draft) return;
    const nodes = elements();
    const value = nodes.input.value === '' ? null : Number(nodes.input.value);
    const valid = isIssueRating(value);
    nodes.input.setAttribute('aria-invalid', String(nodes.input.value !== '' && !valid));
    for (const star of nodes.stars) {
      const fill = valid ? Math.max(0, Math.min(1, value - Number(star.dataset.rating) + 1)) : 0;
      star.dataset.fill = fill === 1 ? 'full' : fill === 0.5 ? 'half' : 'empty';
    }
    for (const radio of nodes.radios) {
      radio.checked = valid && Number(radio.value) === value;
      radio.disabled = saving || draft.stale;
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
    begin(current, savedIdentity, null);
  }

  // Rates a saved comic from a list row or another screen, through the same dialog. Focus goes back to
  // whatever focusTarget() finds when the dialog closes.
  function rate(issue, { focusTarget = null } = {}) {
    const nodes = elements();
    if (nodes.dialog.open) return false;
    const held = issue ? getState().issues[issue.issueId] : null;
    if (isBlocked() || !held) return false;
    begin(held, identity(held), focusTarget);
    return true;
  }

  function begin(issue, savedAs, focusTarget) {
    const nodes = elements();
    const original = issueRating(getState(), issue.issueId);
    draft = { issueId: issue.issueId, original, identity: savedAs, stale: false };
    returnTo = focusTarget;
    nodes.comic.textContent = issue.title;
    nodes.input.value = original ?? '';
    nodes.remove.hidden = original === null;
    restoreFocus = true;
    error('');
    paintDraft();
    nodes.dialog.showModal();
    // The dialog would otherwise focus the first radio, 0.5, where an arrow key moves away from the
    // saved score rather than by half a star from it.
    ([...nodes.radios].find((radio) => radio.checked) ?? nodes.radios[0])?.focus();
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
      const back = returnTo;
      returnTo = null;
      if (!restoreFocus) return;
      if (back) {
        back()?.focus();
        return;
      }
      if (current && !nodes.root.hidden && !nodes.trigger.disabled) nodes.trigger.focus();
    });
    nodes.input.addEventListener('input', () => {
      error(nodes.input.value !== '' && !isIssueRating(Number(nodes.input.value))
        ? 'Choose a rating from 0.5 to 5 in half-star increments.' : '');
      paintDraft();
    });
    for (const radio of nodes.radios) {
      radio.addEventListener('change', () => { if (radio.checked) change(Number(radio.value)); });
    }
    nodes.decrease.addEventListener('click', () => change(Math.max(0.5, Number(nodes.input.value) - 0.5)));
    nodes.increase.addEventListener('click', () => change(Math.min(5, Number(nodes.input.value) + 0.5)));
  }

  return { wire, show, leave, refresh, rate };
}
