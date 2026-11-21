import { compareListOrders, earlierPublishedOrders, matchesEarlierPublishedOrder, publishedRevisionItems, readingOrderArrangement } from '../lib/listCorrection.js';
import { currentReadingOrder, readingOrderChoiceFor } from '../lib/readingOrderChoices.js';
import { legacyReadingOrder } from '../lib/legacyReadingOrders.js';
import { labelledName } from '../lib/accname.js';
import { offlineActionLabel, offlineStatusText } from './shared/offline-status.js';

// A list switched to book by book compares against the published order arranged the same way, or a
// check for updates would quietly put it back issue by issue under its book headings.
function inReadingOrder(list, items) {
  const choice = readingOrderChoiceFor(list);
  if (!choice || currentReadingOrder(list, choice) !== 'book') return items;
  const byId = new Map(items.map((item) => [item.issueId, item]));
  return readingOrderArrangement({ itemIds: [...byId.keys()] }, choice, 'book').itemIds.map((id) => byId.get(id));
}

export function createListRevisions({ $, el, getState, activeListId, isCurrent, canSave, getDatasetEpoch, loadCatalog, loadOrder, askConfirm, saveRevision, offlineContent }) {
  let request = null;
  let shownListId = null;
  let chooser = null;
  let offlineRequest = null;
  let offlineState = null;
  let offlineShown = null;
  let offlineChecked = false;

  const status = (text) => {
    $('#list-revision-status').textContent = text;
    $('#list-revision-status').hidden = !text;
  };
  const currentList = () => {
    const id = activeListId();
    return Object.hasOwn(getState().lists, id ?? '') ? getState().lists[id] : null;
  };
  const valid = (held) => request === held && isCurrent() && canSave()
    && getDatasetEpoch() === held.epoch && currentList()?.id === held.id
    && JSON.stringify(currentList()) === held.signature;

  function busy(value) {
    const disabled = !canSave();
    const controls = ['review', 'check', 'choose'].map((name) => $(`#list-revision-${name}`));
    if (disabled && isCurrent() && controls.includes(document.activeElement)) focusOptions();
    for (const control of controls) {
      control.disabled = disabled;
      control.setAttribute('aria-disabled', String(value || disabled));
    }
  }

  function withdraw() {
    if (!request) return;
    const held = request;
    request = null;
    held.controller.abort();
    busy(false);
  }

  // An open phone sheet keeps focus inside its modal; otherwise its visible button replaces the summary.
  function focusOptions() {
    const target = [
      $('#android-list-sheet[open] .android-sheet-header button'), $('#list-actions > summary'), $('#android-list-options'),
    ].find((node) => node?.getClientRects().length);
    target?.focus();
  }

  function offlineTarget(list) {
    if (!list) return null;
    const matches = list.catalogId ? [] : earlierPublishedOrders(list);
    return legacyReadingOrder(list.catalogId || (matches.length === 1 ? matches[0].catalogId : null));
  }

  // A check belongs to the open disclosure; a save can continue after it closes.
  function validOffline(held) {
    return offlineRequest === held && isCurrent() && offlineContent?.available?.()
      && getDatasetEpoch() === held.epoch && currentList()?.id === held.id
      && JSON.stringify(currentList()) === held.signature
      && (held.kind !== 'check' || $('#list-actions').open)
      && offlineTarget(currentList())?.id === held.target;
  }

  function withdrawOffline() {
    if (!offlineRequest) return;
    const held = offlineRequest;
    offlineRequest = null;
    held.controller.abort();
  }

  function syncOffline(offered, list) {
    const action = $('#list-offline-action');
    const cancel = $('#list-offline-cancel');
    const feedback = $('#list-offline-status');
    if (!offered && isCurrent() && [action, cancel].includes(document.activeElement)) focusOptions();
    action.hidden = !offered;
    if (!offered) {
      cancel.hidden = true;
      feedback.hidden = true;
      return;
    }
    const state = offlineState?.state || 'idle';
    const label = offlineActionLabel(offlineState, 'Make published order available offline');
    action.textContent = label;
    action.setAttribute('aria-label', labelledName(label, list.name));
    action.dataset.state = state;
    const disabled = state === 'checking' || state === 'preparing' || state === 'unsupported' || state === 'busy';
    if (!disabled) action.disabled = false;
    cancel.hidden = state !== 'preparing';
    if (disabled && document.activeElement === action) {
      if (cancel.hidden) focusOptions();
      else cancel.focus();
    }
    if ((cancel.hidden || offlineState?.cancelling) && document.activeElement === cancel) {
      if (!cancel.hidden || !action.getClientRects().length) focusOptions();
      else action.focus();
    }
    action.disabled = disabled;
    cancel.disabled = Boolean(offlineState?.cancelling);
    cancel.textContent = offlineState?.cancelling ? 'Cancelling...' : 'Cancel';
    feedback.textContent = offlineStatusText(offlineState, { published: true });
    feedback.hidden = !feedback.textContent;
  }

  function renderOffline() {
    const list = isCurrent() ? currentList() : null;
    const target = offlineTarget(list);
    const offered = Boolean(target && offlineContent?.available?.());
    const same = offered && offlineShown?.id === list.id && offlineShown.target === target.id;
    if (!same) {
      withdrawOffline();
      offlineState = null;
      offlineChecked = false;
      offlineShown = offered ? { id: list.id, target: target.id } : null;
    } else if (offlineRequest && !validOffline(offlineRequest)) {
      const kind = offlineRequest.kind;
      withdrawOffline();
      // A withdrawn check established nothing, so it must not read as cancelled preparation.
      offlineState = { state: kind === 'check' ? 'unchecked' : 'cancelled' };
    }
    if (offlineState?.state === 'check-failed' && !$('#list-actions').open) offlineState = { state: 'unchecked' };
    syncOffline(offered, list);
    // Work started elsewhere cannot be watched from here, and a check that did not finish established
    // nothing, so closing the menu arms one fresh check instead of polling.
    if (['busy', 'unchecked'].includes(offlineState?.state) && !$('#list-actions').open) offlineChecked = false;
    if (offered && $('#list-actions').open && !offlineChecked && !offlineRequest) void checkOffline();
  }

  function beginOffline(kind) {
    const list = currentList();
    const target = offlineTarget(list);
    if (offlineRequest || !isCurrent() || !target || !offlineContent?.available?.()) return null;
    offlineRequest = {
      kind, id: list.id, target: target.id, epoch: getDatasetEpoch(), signature: JSON.stringify(list),
      controller: new AbortController(),
    };
    offlineChecked = true;
    return offlineRequest;
  }

  function finishOffline(held, result) {
    if (offlineRequest !== held) return;
    if (!validOffline(held)) {
      const kind = held.kind;
      withdrawOffline();
      offlineState = { state: kind === 'check' ? 'unchecked' : 'cancelled' };
      renderOffline();
      return;
    }
    offlineRequest = null;
    if (result.state === 'preparing') offlineState = { state: 'busy' };
    else if (held.kind === 'check' && result.state === 'failed') offlineState = { state: 'check-failed' };
    else if (held.kind === 'check' && result.state === 'cancelled') offlineState = { state: 'unchecked' };
    else offlineState = result;
    renderOffline();
  }

  async function checkOffline() {
    if (!offlineContent?.readiness) return;
    const held = beginOffline('check');
    if (!held) return;
    offlineState = { state: 'checking' };
    renderOffline();
    let result;
    try {
      result = await offlineContent.readiness(held.target, { legacy: true, signal: held.controller.signal });
    } catch {
      result = { ok: false, state: 'failed' };
    }
    finishOffline(held, result);
  }

  async function prepareOffline() {
    if (!offlineContent?.prepare) return;
    const held = beginOffline('prepare');
    if (!held) return;
    offlineState = { state: 'preparing' };
    renderOffline();
    let result;
    try {
      result = await offlineContent.prepare(held.target, {
        legacy: true,
        signal: held.controller.signal,
        onProgress: (progress) => {
          if (!validOffline(held) || offlineState?.cancelling) return;
          offlineState = { state: 'preparing', progress };
          renderOffline();
        },
      });
    } catch {
      result = { ok: false, state: 'failed' };
    }
    finishOffline(held, result);
  }

  function cancelOffline() {
    if (!offlineRequest || offlineState?.state !== 'preparing' || offlineState.cancelling) return;
    offlineState = { ...offlineState, cancelling: true };
    offlineRequest.controller.abort();
    renderOffline();
  }

  function closeChooser() {
    if (isCurrent() && [$('#list-revision-select'), $('#list-revision-choose')].includes(document.activeElement)) {
      focusOptions();
    }
    $('#list-revision-chooser').hidden = true;
    chooser = null;
  }

  function chooserValid() {
    return chooser && isCurrent() && canSave() && getDatasetEpoch() === chooser.epoch
      && currentList()?.id === chooser.id && JSON.stringify(currentList()) === chooser.signature;
  }

  function render() {
    const list = currentList();
    if (request && !request.applying && !valid(request)) {
      const changedHere = isCurrent() && list?.id === request.id;
      withdraw();
      if (changedHere) status(canSave() ? 'Your saved data changed. Compare the list again before updating.' : '');
    }
    if (shownListId !== list?.id || !isCurrent()) {
      shownListId = isCurrent() ? list?.id ?? null : null;
      closeChooser();
      status('');
    } else if (chooser && !chooserValid()) {
      closeChooser();
    }
    busy(Boolean(request));
    const offer = $('#list-revision-offer');
    const hideOffer = !isCurrent() || !canSave() || !list || !matchesEarlierPublishedOrder(list);
    if (hideOffer && isCurrent() && offer.contains(document.activeElement)) focusOptions();
    offer.hidden = hideOffer;
    renderOffline();
  }

  function begin() {
    const list = currentList();
    if (request || !isCurrent() || !canSave() || !list) return null;
    request = {
      id: list.id, epoch: getDatasetEpoch(), signature: JSON.stringify(list),
      controller: new AbortController(), applying: false,
    };
    busy(true);
    return request;
  }

  function finish(held) {
    if (request !== held) return;
    request = null;
    busy(false);
  }

  async function compare(held, entry) {
    status('Loading the published order…');
    let order;
    try {
      order = await loadOrder(entry.file, { signal: held.controller.signal });
      if (!valid(held)) return;
      const items = inReadingOrder(currentList(), publishedRevisionItems(entry, order));
      const difference = compareListOrders(currentList().itemIds, items.map(({ issueId }) => issueId));
      const added = difference.added.length;
      if (!added && !difference.reordered) {
        status('Your list already includes this published order. Your list is unchanged.');
        return;
      }
      status('');
      const yes = await askConfirm({
        title: `Update from ${entry.name}?`,
        body: added
          ? `Updating adds ${added} ${added === 1 ? 'comic' : 'comics'} from the published order. Everything already in your list stays, and your progress stays on the same comics. Your custom order may change.`
          : 'Updating puts your list in the published order. Everything already in your list stays, and your progress stays on the same comics.',
        confirmLabel: 'Update list',
        signal: held.controller.signal,
      });
      if (!valid(held) || !yes) return;
      held.applying = true;
      const restoreOfferFocus = document.activeElement === $('#list-revision-review');
      let result;
      try {
        result = saveRevision(held.id, held.signature, items);
      } catch {
        status('We couldn\'t confirm the list update. Reopen the app to check your list.');
        return;
      } finally {
        held.applying = false;
      }
      if ($('#list-revision-offer').hidden && restoreOfferFocus) focusOptions();
      if (!result.ok) {
        status(result.error);
        return;
      }
      status('Your list was updated. Progress stays on the same comics.');
    } catch (error) {
      if (valid(held)) status(`Could not compare the published order (${error.message}). Your list is unchanged.`);
    }
  }

  async function start({ automatic = false } = {}) {
    const held = begin();
    if (!held) return;
    status('Loading published orders…');
    try {
      const list = currentList();
      const matches = automatic ? earlierPublishedOrders(list).map(({ catalogId }) => catalogId) : [];
      const target = list.catalogId || (matches.length === 1 ? matches[0] : null);
      const legacy = legacyReadingOrder(target);
      const catalog = legacy ? null : await loadCatalog();
      if (!valid(held)) return;
      let entries = Array.isArray(catalog?.lists) ? catalog.lists.filter((entry) => entry?.id && entry?.name && entry?.file) : [];
      if (target) {
        const entry = legacy ?? entries.find((candidate) => candidate.id === target);
        if (!entry) {
          status('The published order is unavailable. Your list is unchanged.');
          return;
        }
        await compare(held, entry);
      } else {
        if (automatic) entries = entries.filter((entry) => matches.includes(entry.id));
        const select = $('#list-revision-select');
        select.replaceChildren(el('option', { value: '', text: 'Select a published order' }), ...entries.map((entry) => (
          el('option', { value: entry.id, text: entry.name })
        )));
        chooser = { epoch: held.epoch, id: held.id, signature: held.signature, ids: new Set(entries.map((entry) => entry.id)) };
        $('#list-revision-chooser').hidden = false;
        status(entries.length
          ? `Choose a published order to compare.${catalog.dropped ? ' Some published orders are unavailable.' : ''}`
          : 'No published orders are available. Your list is unchanged.');
        select.focus();
      }
    } catch (error) {
      if (valid(held)) status(`Could not load published orders (${error.message}). Your list is unchanged.`);
    } finally {
      finish(held);
    }
  }

  async function choose() {
    if (!canSave()) return;
    if (!chooserValid()) {
      closeChooser();
      status('Your saved data changed. Compare the list again before updating.');
      return;
    }
    const held = begin();
    if (!held) return;
    try {
      const catalog = await loadCatalog();
      if (!valid(held)) return;
      const selected = $('#list-revision-select').value;
      const entry = chooser?.ids.has(selected) && catalog.lists.find((candidate) => candidate.id === selected);
      if (!entry?.file) {
        status('Choose a published order to compare.');
        $('#list-revision-select').focus();
        return;
      }
      await compare(held, entry);
    } catch (error) {
      if (valid(held)) status(`Could not load published orders (${error.message}). Your list is unchanged.`);
    } finally {
      finish(held);
    }
  }

  function wire() {
    $('#list-revision-review').addEventListener('click', () => { void start({ automatic: true }); });
    $('#list-revision-check').addEventListener('click', () => { void start(); });
    $('#list-revision-choose').addEventListener('click', () => { void choose(); });
    $('#list-actions').addEventListener('toggle', () => { renderOffline(); });
    $('#list-offline-action').addEventListener('click', () => { void prepareOffline(); });
    $('#list-offline-cancel').addEventListener('click', cancelOffline);
    globalThis.navigator?.serviceWorker?.addEventListener('controllerchange', renderOffline);
  }

  return { render, wire };
}
