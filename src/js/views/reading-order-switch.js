import { upNext } from '../lib/model.js';
import { readingOrderArrangement } from '../lib/listCorrection.js';
import { currentReadingOrder, READING_ORDERS, readingOrderChoiceFor } from '../lib/readingOrderChoices.js';

const KEEPS = 'Switching keeps everything you have read, your notes and your ratings.';
const CUSTOM = 'You arranged this list yourself. Choosing an order puts it back in that order.';
const NOT_CHANGED = 'The order could not be changed. Your list is just as it was.';
const NOT_CONFIRMED = 'We could not confirm the new order was saved. Close and reopen the app to check your list.';
// The save path words its results for a list update and carries technical detail in brackets, so the
// switch says each outcome in its own plain words and leaves the detail to the console.
const PROBLEMS = {
  removed: 'Your saved reading was cleared in another window. The order was not changed.',
  conflict: 'Your reading changed in another window. Choose the order again.',
  'not-saved': 'The new order could not be saved. Your list is just as it was.',
  'changed-while-saving': 'Your reading changed in another window while saving. Check your list before trying again.',
  paused: 'Saving has stopped to keep your reading safe. Close and reopen the app to check your list.',
  'saved-not-shown': 'The new order was saved, but the page did not update. Close and reopen the app to see it.',
  'too-large': 'Your saved reading is too large to change the order. Nothing was changed.',
};

export function switchProblem(result) {
  return Object.hasOwn(PROBLEMS, result?.reason ?? '') ? PROBLEMS[result.reason] : NOT_CHANGED;
}

// The two-way reading order switch at the top of a list whose source publishes both orders. A switch
// re-sorts the comics the list already holds and changes nothing else, so it is saved through the
// same verified path as a published list update, against the exact list the reader was looking at.
export function createReadingOrderSwitch({
  $, getState, activeListId, isCurrent, canSave, getDatasetEpoch, askConfirm, saveSwitch, log = console.error,
}) {
  let request = null;
  let shownListId = null;

  const buttons = () => [$('#reading-order-issue'), $('#reading-order-book')];
  const status = (text) => {
    $('#reading-order-status').textContent = text;
    $('#reading-order-status').hidden = !text;
  };
  const currentList = () => {
    const id = activeListId();
    return Object.hasOwn(getState().lists, id ?? '') ? getState().lists[id] : null;
  };
  const valid = (held) => request === held && isCurrent() && canSave()
    && getDatasetEpoch() === held.epoch && currentList()?.id === held.id
    && JSON.stringify(currentList()) === held.signature;

  function withdraw() {
    if (!request) return;
    const held = request;
    request = null;
    held.controller.abort();
  }

  function render() {
    const list = currentList();
    if (request && !request.applying && !valid(request)) {
      const changedHere = isCurrent() && list?.id === request.id;
      withdraw();
      if (changedHere) status(canSave() ? 'Your list changed. Choose the order again.' : '');
    }
    if (shownListId !== list?.id || !isCurrent()) {
      shownListId = isCurrent() ? list?.id ?? null : null;
      status('');
    }
    const order = isCurrent() && list ? currentReadingOrder(list) : null;
    const box = $('#reading-order');
    if (order === null && box.contains(document.activeElement)) $('#order-name')?.focus();
    box.hidden = order === null;
    const disabled = !canSave();
    for (const button of buttons()) {
      button.setAttribute('aria-pressed', String(button.dataset.order === order));
      button.disabled = disabled;
      button.setAttribute('aria-disabled', String(disabled || Boolean(request)));
    }
    $('#reading-order-hint').textContent = order === 'custom'
      ? `${CUSTOM} ${KEEPS}`
      : order ? `${READING_ORDERS[order].description} ${KEEPS}` : KEEPS;
  }

  function finish(held) {
    if (request !== held) return;
    request = null;
    render();
  }

  async function choose(target) {
    const list = currentList();
    if (request || !isCurrent() || !canSave() || !list || !READING_ORDERS[target]) return;
    const choice = readingOrderChoiceFor(list);
    const from = currentReadingOrder(list, choice);
    if (from === null || from === target) return;
    const held = request = {
      id: list.id, epoch: getDatasetEpoch(), signature: JSON.stringify(list),
      controller: new AbortController(), applying: false,
    };
    render();
    try {
      const state = getState();
      const arranged = readingOrderArrangement(list, choice, target);
      const before = upNext(state, list.id);
      const after = upNext({ ...state, lists: Object.assign(Object.create(null), state.lists, { [list.id]: arranged }) }, list.id);
      const label = READING_ORDERS[target].label.toLowerCase();
      // Moving the reader's place or undoing their own arrangement is worth a question; a plain
      // re-sort that leaves the next comic where it was is not.
      const moves = (before?.issueId ?? null) !== (after?.issueId ?? null);
      if (from === 'custom' || moves) {
        status('');
        const parts = [];
        if (from === 'custom') parts.push(`You arranged this list yourself. Switching puts every comic in ${label} order.`);
        if (moves) {
          parts.push(before && after
            ? `Your next comic changes from ${before.title} to ${after.title}.`
            : after ? `Your next comic will be ${after.title}.` : 'You will have no comic up next.');
        }
        parts.push(KEEPS);
        const yes = await askConfirm({
          title: `Switch to ${label}?`,
          body: parts.join(' '),
          confirmLabel: 'Switch order',
          signal: held.controller.signal,
        });
        if (!valid(held) || !yes) return;
      }
      held.applying = true;
      let result;
      try {
        result = saveSwitch(held.id, held.signature, target);
      } catch (error) {
        log('Recap Page could not confirm the reading order switch:', error);
        status(NOT_CONFIRMED);
        return;
      } finally {
        held.applying = false;
      }
      if (!result.ok) {
        log('Recap Page did not switch the reading order:', result.error);
        status(switchProblem(result));
        return;
      }
      status(`Your list is now ${label}.`);
    } catch (error) {
      if (!valid(held)) return;
      log('Recap Page could not arrange the reading order:', error);
      status(NOT_CHANGED);
    } finally {
      finish(held);
    }
  }

  function wire() {
    for (const button of buttons()) {
      button.addEventListener('click', () => {
        if (button.getAttribute('aria-pressed') === 'true') return;
        void choose(button.dataset.order);
      });
    }
  }

  return { render, wire };
}
