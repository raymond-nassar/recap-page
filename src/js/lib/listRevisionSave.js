import { KEY } from '../storage.js';
import { exportBackup, validateBackup } from './model.js';
import { applyListRevision } from './listCorrection.js';

const verificationPauses = new WeakMap();

export function isListRevisionVerificationPaused(store, { uncertainOnly = false } = {}) {
  const pause = verificationPauses.get(store);
  return Boolean(store.blocked && pause && store.blockedReason === pause.message && (!uncertainOnly || pause.attemptedWrite));
}

function comparableBackup(state) {
  const backup = exportBackup(state);
  delete backup.exportedAt;
  return JSON.stringify(backup);
}

function pauseForUnknown(store, previous, message, { notify = true, attemptedWrite = true } = {}) {
  store.state = previous;
  store.blocked = true;
  store.blockedReason = message;
  store.lastError = message;
  store.lastUpdateOk = false;
  verificationPauses.set(store, { message, attemptedWrite });
  if (notify) {
    try {
      store.onChange(store.state, message);
    } catch (error) {
      message += ` The display could not refresh (${error.message}).`;
      store.blockedReason = message;
      store.lastError = message;
      verificationPauses.set(store, { message, attemptedWrite });
    }
  }
  return { ok: false, changed: attemptedWrite ? null : false, error: message };
}

function reconcile(store, raw, previous, attemptedWrite = true) {
  if (raw !== null) {
    try {
      if (!validateBackup(JSON.parse(raw)).ok) throw new Error('invalid saved data');
    } catch (error) {
      return pauseForUnknown(store, previous, attemptedWrite
        ? 'The saved data could not be read after the update. Saving is paused; reopen the app to check your list.'
        : `Could not verify the saved data (${error.message}). Saving is paused; reopen the app to check your list.`, { attemptedWrite });
    }
  }
  let adopted;
  try {
    adopted = store.adoptForeignWrite(raw);
  } catch (error) {
    return pauseForUnknown(store, store.state, `The saved data could not be displayed (${error.message}). Saving is paused; reopen the app to check your list.`, { notify: false, attemptedWrite });
  }
  if (!adopted) {
    return pauseForUnknown(store, previous, attemptedWrite
      ? 'The saved data could not be read after the update. Saving is paused; reopen the app to check your list.'
      : 'Could not verify the saved data (saved data could not be adopted). Saving is paused; reopen the app to check your list.', { attemptedWrite });
  }
  try {
    if (store.storage.getItem(KEY) === raw) return null;
  } catch (error) {
    return pauseForUnknown(store, store.state, `The saved data could not be verified (${error.message}). Saving is paused; reopen the app to check your list.`, { attemptedWrite });
  }
  return pauseForUnknown(store, store.state, 'The saved data changed again while it was being checked. Saving is paused; reopen the app to check your list.', { attemptedWrite });
}

export function saveListRevision(store, listId, expectedList, items) {
  if (!store.storage) return { ok: false, changed: false, error: 'Reading-data storage is unavailable. Nothing was changed.' };
  if (store.blocked) return { ok: false, changed: false, error: 'Saving is paused. Your list was not changed.' };
  let before;
  try {
    before = store.storage.getItem(KEY);
  } catch (error) {
    return pauseForUnknown(store, store.state, `Could not read the saved data (${error.message}). Saving is paused; reopen the app to check your list.`, { attemptedWrite: false });
  }
  if (before === null) {
    const uncertain = reconcile(store, before, store.state, false);
    if (uncertain) return uncertain;
    return { ok: false, changed: false, error: 'Saved data was removed elsewhere. Your list was not changed by this update.' };
  }
  let saved;
  try {
    const checked = validateBackup(JSON.parse(before));
    if (!checked.ok) throw new Error(checked.errors.join(' '));
    saved = checked.state;
  } catch (error) {
    return pauseForUnknown(store, store.state, `Could not verify the saved data (${error.message}). Saving is paused; reopen the app to check your list.`, { attemptedWrite: false });
  }
  if (comparableBackup(saved) !== comparableBackup(store.state)) {
    const uncertain = reconcile(store, before, store.state, false);
    if (uncertain) return uncertain;
    return { ok: false, changed: false, error: 'Saved data changed elsewhere. Compare the list again before updating.' };
  }
  const previous = store.state;
  let state;
  let updateException = null;
  try {
    state = store.update((current) => applyListRevision(current, listId, expectedList, items));
  } catch (error) {
    updateException = error;
    state = store.state;
  }
  const updateOk = store.lastUpdateOk;
  const conflicted = store.conflicted;
  let durable;
  try {
    durable = store.storage.getItem(KEY);
  } catch (error) {
    return pauseForUnknown(store, previous, `The update could not be verified (${error.message}). Saving is paused; reopen the app to check your list.`);
  }
  let actual = null;
  try {
    actual = durable === null ? null : JSON.parse(durable);
  } catch {
    // The value may be a concurrent writer's unreadable data, not this update's output.
  }
  if (updateOk && actual && (actual.writeToken === store.seenToken || (state === previous && durable === before))) {
    delete actual.writeToken;
    delete actual.exportedAt;
    if (JSON.stringify(actual) === comparableBackup(state)) {
      if (updateException) {
        const changed = durable !== before;
        return {
          ok: false,
          changed,
          error: changed
            ? `The list was saved, but the display could not refresh (${updateException.message}). Reopen the app to check it.`
            : `The list was not changed (${updateException.message}).`,
        };
      }
      return { ok: true, changed: state !== previous, state };
    }
  }
  const changed = durable === before ? false : null;
  const message = conflicted
    ? 'Saved data changed elsewhere. Compare the list again before updating.'
    : changed === false
      ? 'The update was not saved. Your list is unchanged.'
      : 'The saved data changed while the update was being verified. Check your list before trying again.';
  store.lastError ||= message;
  store.lastUpdateOk = false;
  const uncertain = reconcile(store, durable, previous);
  if (uncertain) return uncertain;
  return { ok: false, changed, error: message };
}
