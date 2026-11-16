import { compareListOrders, earlierPublishedOrders, matchesEarlierPublishedOrder, publishedRevisionItems } from '../lib/listCorrection.js';

export function createListRevisions({ $, el, getState, activeListId, isCurrent, canSave, getDatasetEpoch, loadCatalog, loadOrder, askConfirm, saveRevision }) {
  let request = null;
  let shownListId = null;
  let chooser = null;

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
    $('#list-revision-offer').hidden = !isCurrent() || !canSave() || !list || !matchesEarlierPublishedOrder(list);
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
      const items = publishedRevisionItems(entry, order);
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
      } catch (error) {
        status(`The update could not be verified (${error.message}). Reopen the app to check your list.`);
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
      const catalog = await loadCatalog();
      if (!valid(held)) return;
      const list = currentList();
      let entries = Array.isArray(catalog?.lists) ? catalog.lists.filter((entry) => entry?.id && entry?.name && entry?.file) : [];
      const matches = automatic ? earlierPublishedOrders(list).map(({ catalogId }) => catalogId) : [];
      const target = list.catalogId || (matches.length === 1 ? matches[0] : null);
      if (target) {
        const entry = entries.find((candidate) => candidate.id === target);
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
  }

  return { render, wire };
}
