import { KEY as READER_KEY } from '../storage.js';
import {
  MAX_BACKUP_BYTES, MAX_LISTS, MAX_NAME, SCHEMA_VERSION,
  createEmptyState, exportBackup, newId, setActive,
} from './model.js';

export const LIST_HISTORY_KEY = 'mrt.list-history.v1';
export const LIST_HISTORY_FORMAT = 'recap-page-list-history';
export const LIST_HISTORY_COPY_FORMAT = 'recap-page-list-history-saved-copy';
export const MAX_HISTORY_BYTES = MAX_BACKUP_BYTES;
const MAX_DATE = 8640000000000000;
const RECORD_FIELDS = ['listId', 'created', 'catalogId', 'completedAt', 'rating'];
const ENVELOPE_FIELDS = ['format', 'version', 'records', 'writeToken'];
const LOCK_UNAVAILABLE = 'Browser storage locking is unavailable. Completion history can be viewed and backed up, but changes cannot be saved safely in this browser.';

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function onlyFields(value, fields) {
  return Object.keys(value).every((key) => fields.includes(key));
}

function boundedText(text) {
  if (typeof text !== 'string' || text.length > MAX_HISTORY_BYTES
    || new TextEncoder().encode(text).length > MAX_HISTORY_BYTES) {
    throw new Error('Completion history exceeds the 8 MB limit or is not text. The saved data is unchanged.');
  }
}

function validCreated(value) {
  return typeof value === 'number' && Number.isFinite(value) && value !== 0;
}

function validCatalogId(value) {
  return value === null || (typeof value === 'string' && value.length > 0 && value.length <= MAX_NAME);
}

export function listHistoryIdentity(list) {
  if (!list || typeof list.id !== 'string' || !validCreated(list.created)
    || !validCatalogId(list.catalogId)) return null;
  return JSON.stringify([list.id, list.created, list.catalogId]);
}

export function parseListHistory(text) {
  if (text === null) return new Map();
  boundedText(text);
  let input;
  try {
    input = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error('Completion history is not valid JSON. Its saved value has been kept.', { cause: error });
  }
  if (!object(input) || input.format !== LIST_HISTORY_FORMAT || input.version !== 1
    || !onlyFields(input, ENVELOPE_FIELDS) || !Array.isArray(input.records)) {
    throw new Error('This is not a supported completion-history backup. Its saved value has been kept.');
  }
  if (Object.hasOwn(input, 'writeToken')
    && (typeof input.writeToken !== 'string' || !input.writeToken || input.writeToken.length > MAX_NAME)) {
    throw new Error('The completion-history write identity is invalid. Its saved value has been kept.');
  }
  if (input.records.length > MAX_LISTS) {
    throw new Error(`Completion history exceeds the ${MAX_LISTS} entry limit.`);
  }
  const records = new Map();
  for (const entry of input.records) {
    if (!object(entry) || !onlyFields(entry, RECORD_FIELDS)
      || typeof entry.listId !== 'string' || !validCreated(entry.created)
      || !validCatalogId(entry.catalogId)
      || !(entry.completedAt === null || (Number.isSafeInteger(entry.completedAt)
        && entry.completedAt > 0 && entry.completedAt <= MAX_DATE))
      || ![null, 'up', 'down'].includes(entry.rating)) {
      throw new Error('A completion-history entry is invalid. Its saved value has been kept.');
    }
    const key = listHistoryIdentity({ id: entry.listId, ...entry });
    if (records.has(key)) {
      throw new Error('Completion history repeats a list identity. Its saved value has been kept.');
    }
    records.set(key, Object.freeze({
      listId: entry.listId, created: entry.created, catalogId: entry.catalogId,
      completedAt: entry.completedAt, rating: entry.rating,
    }));
  }
  return records;
}

function envelope(records) {
  return { format: LIST_HISTORY_FORMAT, version: 1, records: [...records.values()] };
}

function completionSignature(records) {
  return JSON.stringify([...records].filter(([, entry]) => entry.completedAt !== null)
    .map(([key, entry]) => [key, entry.completedAt]));
}

function sameListContent(left, right) {
  const a = { ...left };
  const b = { ...right };
  delete a.id;
  delete a.created;
  delete b.id;
  delete b.created;
  return JSON.stringify(a) === JSON.stringify(b);
}

function rawCatalogId(list) {
  return typeof list?.catalogId === 'string' && list.catalogId
    ? list.catalogId.slice(0, MAX_NAME) : null;
}

function canonicalReaderValue(raw, state, token) {
  if (typeof raw !== 'string' || typeof token !== 'string' || !token) return false;
  let input;
  try {
    input = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return false;
    throw error;
  }
  if (!object(input) || input.writeToken !== token || typeof input.exportedAt !== 'string') return false;
  const date = new Date(input.exportedAt);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== input.exportedAt) return false;
  // The reader writer generates this stamp internally; every data field and its token still match.
  const expected = { ...exportBackup(state), exportedAt: input.exportedAt };
  return raw === JSON.stringify({ writeToken: token, ...expected });
}

export class ListHistoryStore {
  constructor({ readerStore, storage = readerStore?.storage, locks, clock = Date.now, onChange = () => {} } = {}) {
    this.readerStore = readerStore;
    this.storage = storage;
    this.locks = locks;
    this.clock = clock;
    this.onChange = onChange;
    this.records = new Map();
    this.seenRaw = undefined;
    this.known = false;
    this.blocked = false;
    this.lastError = null;
    this.busy = false;
    this.revision = 0;
    this.completionRevision = 0;
  }

  lockContext() {
    try {
      const locks = this.locks === undefined ? globalThis.navigator?.locks : this.locks;
      return typeof locks?.request === 'function'
        ? { locks, error: null } : { locks: null, error: LOCK_UNAVAILABLE };
    } catch (error) {
      return { locks: null, error: `Completion-history storage locking could not be accessed (${error.message}). Changes are paused.` };
    }
  }

  get writeUnavailable() { return this.lockContext().error; }
  get canSave() { return this.known && !this.blocked && !this.busy && !this.writeUnavailable; }

  fail(message, extra = {}) {
    this.lastError = message;
    return { ok: false, error: message, ...extra };
  }

  adoptRaw(raw) {
    const previous = this.known ? completionSignature(this.records) : null;
    this.seenRaw = raw;
    try {
      const next = parseListHistory(raw);
      this.records = next;
      this.known = true;
      this.blocked = false;
      this.lastError = null;
      this.revision += 1;
      if (previous !== completionSignature(next)) this.completionRevision += 1;
      return { ok: true };
    } catch (error) {
      this.known = false;
      this.blocked = true;
      this.completionRevision += 1;
      return this.fail(error.message);
    }
  }

  load() {
    let result;
    try {
      if (!this.storage) throw new Error('Browser storage is unavailable');
      const raw = this.storage.getItem(LIST_HISTORY_KEY);
      result = this.adoptRaw(raw);
    } catch (error) {
      this.seenRaw = undefined;
      this.known = false;
      this.blocked = true;
      this.completionRevision += 1;
      result = this.fail(`Completion history could not be read (${error.message}). Its saved value is untouched.`);
    }
    this.onChange(this, result.ok ? null : result.error);
    return result;
  }

  getRecord(state, listId) {
    if (!this.known || !Object.hasOwn(state.lists, listId ?? '')) return null;
    return this.records.get(listHistoryIdentity(state.lists[listId])) ?? null;
  }

  isCompleted(state, listId) {
    return this.getRecord(state, listId)?.completedAt != null;
  }

  activeIds(state) {
    return state.listOrder.filter((id) => !this.isCompleted(state, id));
  }

  completedIds(state, { enjoyed = false } = {}) {
    return state.listOrder.filter((id) => {
      const record = this.getRecord(state, id);
      return record?.completedAt != null && (!enjoyed || record.rating === 'up');
    }).sort((a, b) => this.getRecord(state, b).completedAt - this.getRecord(state, a).completedAt);
  }

  counts(state) {
    if (!this.known) return null;
    const ids = this.completedIds(state);
    return {
      completed: ids.length,
      enjoyed: ids.filter((id) => this.getRecord(state, id).rating === 'up').length,
    };
  }

  async runLocked(operation) {
    const { locks, error } = this.lockContext();
    if (!locks) {
      const refused = this.fail(error);
      this.onChange(this, refused.error);
      return refused;
    }
    let result;
    let callbackError;
    this.busy = true;
    try {
      result = await locks.request(LIST_HISTORY_KEY, () => {
        try {
          return operation();
        } catch (failure) {
          callbackError = failure;
          throw failure;
        }
      });
    } catch (failure) {
      if (callbackError) throw callbackError;
      result = this.fail(`Completion-history storage could not be locked (${failure.message}). That change was not saved.`);
    } finally {
      this.busy = false;
    }
    this.onChange(this, result.ok ? null : result.error);
    return result;
  }

  checkFresh(expected, { recovery = false } = {}) {
    if (expected === undefined) return this.fail('Completion history has not been read. Retry reading it before making changes.');
    let held;
    try {
      held = this.storage.getItem(LIST_HISTORY_KEY);
    } catch (error) {
      this.known = false;
      this.blocked = true;
      return this.fail(`Completion history could not be checked (${error.message}). That change was not saved.`);
    }
    if (held !== expected) {
      this.adoptRaw(held);
      return this.fail('Another tab changed completion history. This tab is up to date; review it and make the change again.');
    }
    if (!recovery && (!this.known || this.blocked)) {
      return this.fail('Completion history cannot be changed until it can be read or a valid history backup is restored.');
    }
    return { ok: true };
  }

  captureList(listId) {
    const state = this.readerStore?.state;
    const list = state && Object.hasOwn(state.lists, listId ?? '') ? state.lists[listId] : null;
    return listHistoryIdentity(list) ? { list, index: state.listOrder.indexOf(listId) } : null;
  }

  prepareList(captured) {
    const reader = this.readerStore;
    if (!captured || !reader || reader.blocked || !reader.storage) {
      return this.fail('The saved reading list could not be verified. Nothing was completed or rated.');
    }
    const present = this.captureList(captured.list.id);
    if (!present || listHistoryIdentity(present.list) !== listHistoryIdentity(captured.list)) {
      return this.fail('That reading list was removed or replaced. Its earlier completion action was not applied.');
    }
    let raw;
    try {
      raw = reader.storage.getItem(READER_KEY);
    } catch (error) {
      return this.fail(`The saved reading list could not be checked (${error.message}). Nothing was completed or rated.`);
    }
    let input;
    try {
      input = JSON.parse(raw);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
      reader.load();
      return this.fail('Reading data changed or could not be read. Nothing was completed or rated.');
    }
    const version = Number(input?.schemaVersion ?? 1);
    const saved = object(input?.lists) && Object.hasOwn(input.lists, captured.list.id)
      ? input.lists[captured.list.id] : null;
    if (!object(input) || ![1, 2, 3, SCHEMA_VERSION].includes(version)) {
      reader.load();
      return this.fail('Saved reading data is not a supported version. Completion history is unchanged.');
    }
    if (reader.foreignWriteSince()) {
      reader.load();
      return this.fail('Reading data changed in another tab. Review the current list and make the completion change again.');
    }
    if (version >= 2 && saved && validCreated(Number(saved.created))) {
      if (Number(saved.created) !== present.list.created || rawCatalogId(saved) !== present.list.catalogId) {
        reader.load();
        return this.fail('That saved reading list has a different identity. Its earlier completion action was not applied.');
      }
      return { ok: true, list: present.list, readerRaw: raw };
    }

    // Legacy loads mint identities. Save the latest normalization against its exact raw witness.
    reader.load();
    if (reader.blocked) return this.fail('The reading list could not be prepared safely. Completion history is unchanged.');
    const id = version < 2 ? reader.state.listOrder[captured.index] : captured.list.id;
    const normalized = Object.hasOwn(reader.state.lists, id ?? '') ? reader.state.lists[id] : null;
    if (!normalized || !sameListContent(captured.list, normalized)) {
      return this.fail('The reading list changed before it could be prepared. Completion history is unchanged.');
    }
    const prepared = setActive(reader.state, id);
    if (!reader.persist(prepared, raw)) {
      const message = reader.lastError || 'The reading list could not be saved safely.';
      reader.load();
      return this.fail(`${message} Completion history is unchanged.`);
    }
    let durable;
    try {
      durable = reader.storage.getItem(READER_KEY);
    } catch (error) {
      reader.load();
      return this.fail(`The prepared reading list could not be verified (${error.message}). Completion history is unchanged.`);
    }
    if (!canonicalReaderValue(durable, prepared, reader.seenToken)) {
      reader.load();
      return this.fail('The prepared reading list write could not be verified. Completion history is unchanged.');
    }
    reader.load();
    const actual = reader.state.lists[id];
    if (reader.blocked || listHistoryIdentity(actual) !== listHistoryIdentity(normalized)) {
      return this.fail('The saved reading list changed during preparation. Completion history is unchanged.');
    }
    return { ok: true, list: actual, readerRaw: durable };
  }

  saveRecords(records) {
    let candidate;
    try {
      candidate = JSON.stringify({ writeToken: newId('history'), ...envelope(records) });
      parseListHistory(candidate);
    } catch (error) {
      return this.fail(error.message);
    }
    try {
      this.storage.setItem(LIST_HISTORY_KEY, candidate);
    } catch (error) {
      this.load();
      return this.fail(`Completion history could not be saved (${error.message}). That change was not confirmed.`);
    }
    let actual;
    try {
      actual = this.storage.getItem(LIST_HISTORY_KEY);
    } catch (error) {
      this.known = false;
      this.blocked = true;
      this.seenRaw = undefined;
      return this.fail(`The completion-history write could not be verified (${error.message}). Reload or retry before making changes.`);
    }
    this.adoptRaw(actual);
    if (actual !== candidate) {
      return this.fail('The completion-history write did not match the saved value. That change was not confirmed.');
    }
    return { ok: true };
  }

  changeList(listId, change) {
    const captured = this.captureList(listId);
    const expectedRaw = this.seenRaw;
    return this.runLocked(() => {
      const fresh = this.checkFresh(expectedRaw);
      if (!fresh.ok) return fresh;
      const prepared = this.prepareList(captured);
      if (!prepared.ok) return prepared;
      let actualReader;
      try {
        actualReader = this.readerStore.storage.getItem(READER_KEY);
      } catch (error) {
        return this.fail(`Reading data could not be checked (${error.message}). Completion history is unchanged.`);
      }
      if (actualReader !== prepared.readerRaw) {
        this.readerStore.load();
        return this.fail('Reading data changed before completion could be saved. Review it and try again.');
      }
      const identity = listHistoryIdentity(prepared.list);
      const previous = this.records.get(identity);
      const changed = change(previous);
      if (!changed.ok) return this.fail(changed.error);
      if (changed.unchanged) return { ok: true, listId: prepared.list.id, identity };
      const next = new Map(this.records);
      if (changed.record) {
        next.set(identity, Object.freeze({
          listId: prepared.list.id, created: prepared.list.created,
          catalogId: prepared.list.catalogId, ...changed.record,
        }));
      } else next.delete(identity);
      const saved = this.saveRecords(next);
      return { ...saved, listId: prepared.list.id, ...(saved.ok ? { identity } : {}) };
    });
  }

  complete(listId) {
    return this.changeList(listId, (previous) => {
      if (previous?.completedAt != null) return { ok: true, unchanged: true };
      const completedAt = this.clock();
      if (!Number.isSafeInteger(completedAt) || completedAt <= 0 || completedAt > MAX_DATE) {
        return { ok: false, error: 'The completion date is invalid. Nothing was completed.' };
      }
      return { ok: true, record: { completedAt, rating: previous?.rating ?? null } };
    });
  }

  reopen(listId) {
    return this.changeList(listId, (previous) => ({
      ok: true,
      unchanged: previous?.completedAt == null,
      record: previous?.rating ? { completedAt: null, rating: previous.rating } : null,
    }));
  }

  rate(listId, rating) {
    if (![null, 'up', 'down'].includes(rating)) {
      const result = this.fail('That enjoyment choice is invalid. Nothing was rated.');
      this.onChange(this, result.error);
      return Promise.resolve(result);
    }
    return this.changeList(listId, (previous) => {
      if (previous?.completedAt == null) {
        return { ok: false, error: 'Complete this reading list before recording enjoyment.' };
      }
      return {
        ok: true, unchanged: previous.rating === rating,
        record: { completedAt: previous.completedAt, rating },
      };
    });
  }

  exportBackup() {
    const loaded = this.load();
    if (!loaded.ok) throw new Error(loaded.error);
    return JSON.stringify(envelope(this.records));
  }

  exportStoredCopy() {
    if (!this.storage) throw new Error('Browser storage is unavailable');
    const storedValue = this.storage.getItem(LIST_HISTORY_KEY);
    return JSON.stringify({ format: LIST_HISTORY_COPY_FORMAT, version: 1, storedValue }, null, 2);
  }

  restore(text) {
    const expectedRaw = this.seenRaw;
    let restored;
    try {
      boundedText(text);
      restored = parseListHistory(text);
    } catch (error) {
      const result = this.fail(error.message);
      this.onChange(this, result.error);
      return Promise.resolve(result);
    }
    return this.runLocked(() => {
      const fresh = this.checkFresh(expectedRaw, { recovery: true });
      return fresh.ok ? this.saveRecords(restored) : fresh;
    });
  }

  clearAfterErase(readerRaw, historyRaw) {
    const clear = () => {
      let heldReader;
      try {
        heldReader = this.readerStore.storage.getItem(READER_KEY);
      } catch (error) {
        return this.fail(`Reader erasure could not be checked (${error.message}). Completion history was kept.`, { readerChanged: null });
      }
      if (heldReader !== readerRaw
        || !canonicalReaderValue(readerRaw, createEmptyState(), this.readerStore.seenToken)) {
        this.readerStore.load();
        return this.fail('Another tab changed reading data after the erase. Completion history was kept.', { readerChanged: true });
      }
      const fresh = this.checkFresh(historyRaw, { recovery: true });
      if (!fresh.ok) return fresh;
      try {
        if (historyRaw !== null) this.storage.removeItem(LIST_HISTORY_KEY);
        const actual = this.storage.getItem(LIST_HISTORY_KEY);
        this.adoptRaw(actual);
        if (actual !== null) return this.fail('Completion history could not be removed and is still saved in this browser.');
      } catch (error) {
        this.load();
        return this.fail(`Completion-history removal could not be verified (${error.message}). Its saved value may still be here.`);
      }
      return { ok: true };
    };
    if (historyRaw === null) {
      const result = clear();
      this.onChange(this, result.ok ? null : result.error);
      return Promise.resolve(result);
    }
    return this.runLocked(clear);
  }
}

export async function eraseReaderAndHistory(readerStore, history, { onReaderErased } = {}) {
  history.load();
  const historyRaw = history.seenRaw;
  const { ok, snapshotKept } = readerStore.eraseAll();
  if (!ok) return { ok: false, readerErased: false, historyKept: true, snapshotKept, error: readerStore.lastError };
  let readerRaw;
  try {
    readerRaw = readerStore.storage.getItem(READER_KEY);
  } catch (error) {
    readerStore.load();
    return {
      ok: false, readerErased: null, historyKept: true, snapshotKept,
      error: `Reader erasure could not be verified (${error.message}). Completion history was kept.`,
    };
  }
  if (!canonicalReaderValue(readerRaw, createEmptyState(), readerStore.seenToken)) {
    readerStore.load();
    return {
      ok: false, readerErased: false, historyKept: true, snapshotKept,
      error: 'The reader erase did not match the saved data. Completion history was kept.',
    };
  }
  onReaderErased?.();
  const cleanup = await history.clearAfterErase(readerRaw, historyRaw);
  return {
    ok: true, readerErased: true, historyKept: !cleanup.ok, snapshotKept,
    readerRaw, error: cleanup.error ?? null,
    readerChanged: cleanup.readerChanged === undefined ? false : cleanup.readerChanged,
  };
}
