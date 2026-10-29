import { isRead } from '../lib/model.js';
import { canonicalReaderValue } from '../lib/listHistory.js';
import { KEY } from '../storage.js';

const NOTICE = 'bulk-read';

function listScope(state, id) {
  const list = state.lists[id];
  return list ? JSON.stringify([list.id, list.created, list.catalogId, list.itemIds]) : null;
}

function unreadIds(state, id) {
  return state.lists[id]?.itemIds.filter((issueId) => !isRead(state, issueId)) ?? [];
}

export function createBulkReadView({
  store, button, getListId, isCurrent, canSave, askConfirm, notify, clearNotice, reconcile, focusCurrentView, focusRetry,
}) {
  let pending = false;
  let undo = null;
  let settling = false;

  function canWrite() {
    return !store.blocked && Boolean(store.storage) && canSave();
  }

  function holds(record) {
    return !store.blocked && store.seenToken === record.token
      && listScope(store.state, record.id) === record.scope;
  }

  function forget() {
    undo = null;
    const focused = document.activeElement;
    clearNotice(NOTICE);
    if (focused && !focused.isConnected) focusCurrentView();
  }

  function render() {
    const control = button();
    control.disabled = !canWrite() || unreadIds(store.state, getListId()).length === 0;
    control.setAttribute('aria-disabled', String(pending || control.disabled));
    if (undo && !settling && !holds(undo)) forget();
  }

  function report(message, kind = 'error', action = null) {
    notify('#app-report', message, kind, NOTICE, action, {
      label: 'Dismiss',
      onClick: () => { forget(); focusCurrentView(); },
    });
  }

  function save(updater) {
    const state = store.update(updater);
    if (!store.lastUpdateOk) return { ok: false, storeReported: true };
    let error;
    try {
      if (canonicalReaderValue(store.storage.getItem(KEY), state, store.seenToken)) return { ok: true, state };
      error = 'Saved progress did not match the requested change.';
    } catch (failure) {
      error = `Saved progress could not be checked (${failure.message}).`;
    }
    // load() does not emit onChange. Repaint the adopted value or recovery state, not the
    // optimistic result that update() displayed before this verification failed.
    store.load();
    store.lastUpdateOk = false;
    reconcile();
    return { ok: false, error: `${error} The outcome could not be verified. Review your saved progress before trying again.` };
  }

  function offer(record, failed = false, error = null) {
    report(failed
      ? (error ?? 'Undo could not be saved. You can try again while your reading data is unchanged.')
      : `Marked ${record.ids.length} issue${record.ids.length === 1 ? '' : 's'} read in ${record.name}. Undo is available until your next saved reading-data change.`,
    failed ? 'error' : 'ok', {
      label: failed ? 'Try Undo again' : 'Undo mark all read',
      onClick: () => undoRead(record),
    });
  }

  function undoRead(record) {
    if (undo !== record || !holds(record)) {
      forget();
      report('That bulk change can no longer be undone. You can mark individual comics unread in the full Reading List.');
      focusCurrentView();
      return;
    }
    settling = true;
    let result;
    try {
      result = save((state) => {
        const read = { ...state.read };
        for (const id of record.ids) delete read[id];
        return { ...state, read };
      });
    } finally {
      settling = false;
    }
    if (!result.ok) {
      const retry = holds(record);
      if (retry) offer(record, true, result.error);
      else {
        forget();
        report(result.storeReported ? 'No read marks were undone.' : result.error);
      }
      render();
      if (retry) focusRetry();
      else focusCurrentView();
      return;
    }
    forget();
    report(`Undid marking ${record.ids.length} issue${record.ids.length === 1 ? '' : 's'} read in ${record.name}.`, 'ok');
    render();
    focusCurrentView();
  }

  async function markAllRead() {
    if (pending) return;
    const id = getListId();
    const state = store.state;
    const list = state.lists[id];
    const ids = unreadIds(state, id);
    if (!isCurrent() || !list || !canWrite() || !ids.length) {
      report('There are no unread comics to mark, or saving is paused. Review the current Reading List.');
      return;
    }
    const scope = listScope(state, id);
    pending = true;
    render();
    try {
      const yes = await askConfirm({
        title: `Mark all issues in "${list.name}" as read?`,
        body: `This marks ${ids.length} unread issue${ids.length === 1 ? '' : 's'} as read. Read progress is shared with every list containing those comics.`,
        confirmLabel: 'Mark All Read',
      });
      if (!yes) return;
      if (!isCurrent() || getListId() !== id || !canWrite()
        || listScope(store.state, id) !== scope
        || JSON.stringify(unreadIds(store.state, id)) !== JSON.stringify(ids)) {
        report('The Reading List or its progress changed while the question was open. Review it and choose Mark All Read again.');
        return;
      }
      const at = Date.now();
      const result = save((current) => {
        const read = { ...current.read };
        for (const issueId of ids) read[issueId] = at;
        return { ...current, read };
      });
      if (!result.ok) {
        report(result.storeReported ? 'No comics were marked read.' : result.error);
        return;
      }
      undo = { id, scope, ids, name: list.name, token: store.seenToken };
      offer(undo);
    } finally {
      pending = false;
      render();
      const control = button();
      if (isCurrent() && (document.activeElement === document.body
        || (document.activeElement === control && control.disabled))) {
        if (!control.disabled && control.checkVisibility()) control.focus();
        else focusCurrentView();
      }
    }
  }

  return { markAllRead, render };
}
