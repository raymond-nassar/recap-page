import { IMPORT_DRAFT_KEY } from '../storage.js';
import { LIST_HISTORY_KEY } from './listHistory.js';
import { parseCloudSnapshot, prepareCloudRestore } from './cloudSnapshot.js';
import { applyPreparedCloudRestore, preparedCloudRestoreImages } from './cloudRestore.js';

export const CLOUD_RESTORE_MARKER = 'mrt.cloud.restore.v1';
export const CLOUD_SESSION_LOCK = 'mrt.cloud.session.v1';
export const CLOUD_RESTORE_DATABASE = 'mrt-cloud-restore-v1';
const JOURNAL_STORE = 'restore';
const SLOT = 'active';
const PAUSED = 'Cloud restore recovery is pending or could not be checked. Open Backup & settings before saving changes.';
const CLOSE_TABS = 'Close other app tabs and windows, then try the restore again. Nothing was replaced.';
const stable = (value) => JSON.stringify(value, function(_key, item) {
  return item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]])) : item;
});
const equal = (a, b) => stable(a) === stable(b);
const exactImage = (storage, image) => Object.entries(image).every(([key, value]) => storage.getItem(key) === value);

// This database is not a response cache and must never be reached by cache cleanup.
export function createCloudRestoreJournal(factory = globalThis.indexedDB) {
  let opening;
  function open() {
    if (!opening) opening = new Promise((resolve, reject) => {
      if (!factory?.open) { reject(new Error('IndexedDB is unavailable. Cloud restore is disabled.')); return; }
      const request = factory.open(CLOUD_RESTORE_DATABASE, 1);
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error('Recovery journal could not be opened. Close older app tabs and retry.'));
      };
      const timer = setTimeout(fail, 5000);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(JOURNAL_STORE)) request.result.createObjectStore(JOURNAL_STORE);
      };
      request.onblocked = fail;
      request.onerror = fail;
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        settled = true;
        clearTimeout(timer);
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
    return opening;
  }
  async function transaction(mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let value;
      const tx = db.transaction(JOURNAL_STORE, mode);
      const request = operation(tx.objectStore(JOURNAL_STORE));
      request.onsuccess = () => { value = request.result; };
      tx.oncomplete = () => resolve(value ?? null);
      tx.onabort = tx.onerror = () => reject(new Error('Recovery journal transaction failed. Recovery remains guarded.'));
    });
  }
  return {
    read: () => transaction('readonly', (store) => store.get(SLOT)),
    put: (value) => transaction('readwrite', (store) => store.put(value, SLOT)),
    async remove(expected) {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(JOURNAL_STORE, 'readwrite');
        const store = tx.objectStore(JOURNAL_STORE);
        let removed = false;
        const read = store.get(SLOT);
        read.onsuccess = () => {
          if (!equal(read.result, expected)) { tx.abort(); return; }
          store.delete(SLOT);
          const verify = store.get(SLOT);
          verify.onsuccess = () => {
            removed = verify.result === undefined;
            if (!removed) tx.abort();
          };
        };
        tx.oncomplete = () => resolve(removed);
        tx.onabort = tx.onerror = () => reject(new Error('Recovery cleanup failed. The original journal is retained.'));
      });
    },
    async close() { if (opening) (await opening).close(); },
  };
}

async function validateRecord(record) {
  if (!record || Object.keys(record).sort().join(',') !== 'candidate,direction,id,phase,position,prepared,version'
    || record.version !== 1 || typeof record.id !== 'string' || !/^[a-f0-9]{64}$/.test(record.id)
    || !['forward', 'prior'].includes(record.direction) || !['applying', 'adopting', 'cleaning'].includes(record.phase)
    || !Number.isInteger(record.position) || record.position < 0 || record.position > 8
    || typeof record.candidate !== 'string') throw new Error(PAUSED);
  const snapshot = await parseCloudSnapshot(record.candidate);
  const { states, effects } = preparedCloudRestoreImages(record.prepared);
  const [reader, history, settings, draft] = record.prepared.owners;
  const readerValue = JSON.parse(reader.value);
  delete readerValue.writeToken; delete readerValue.exportedAt;
  const historyValue = JSON.parse(history.value);
  delete historyValue.writeToken;
  const { sidebarCollapsed, ...preferences } = snapshot.components.settings;
  const portableDraft = snapshot.components.draft;
  const draftValue = draft.value === null ? null : JSON.parse(draft.value);
  if (snapshot.captureId !== record.prepared.captureId || snapshot.contentDigest !== record.prepared.contentDigest
    || effects.length !== 8 || !equal(readerValue, snapshot.components.reader)
    || !equal(historyValue, snapshot.components.history)
    || !equal(JSON.parse(settings.effects[0].value), preferences)
    || settings.effects[1].value !== (sidebarCollapsed === null ? null : String(sidebarCollapsed))
    || (portableDraft === null) !== (draftValue === null)
    || portableDraft !== null && (!Object.entries(portableDraft).every(([key, value]) =>
      key === 'previousSources' || equal(draftValue[key], value))
      || !equal(draftValue.previousSources, [...new Set([
        ...portableDraft.previousSources, ...draft.retainedSources, ...(draft.before === null ? [] : [draft.before]),
      ])]))) throw new Error('The saved restore journal does not match its validated backup. Export recovery; no local data was replaced.');
  return { states, effects };
}

export class CloudRestoreSession {
  constructor({
    storage = globalThis.localStorage, locks = globalThis.navigator?.locks,
    journal = createCloudRestoreJournal(), events = globalThis, adopt = async () => false,
  } = {}) {
    this.rawStorage = storage;
    this.locks = locks;
    this.journal = journal;
    this.events = events;
    this.adopt = adopt;
    this.listeners = new Set();
    this.record = null;
    this.shared = null;
    this.sharedOpening = null;
    this.recoverable = false;
    this.exclusive = false;
    this.accessible = false;
    this.busy = false;
    this.closed = false;
    this.state = Object.freeze({ phase: 'checking', error: null, pending: false });
    const self = this;
    this.storage = {
      source: storage,
      get length() { return storage.length; },
      key: (index) => storage.key(index),
      getItem: (key) => storage.getItem(key),
      setItem(key, value) { self.assertWritable(); storage.setItem(key, value); },
      removeItem(key) { self.assertWritable(); storage.removeItem(key); },
      clear() { self.assertWritable(); storage.clear(); },
    };
    this.changed = (event) => {
      if (event.key === CLOUD_RESTORE_MARKER || event.key === null) {
        this.publish('checking', PAUSED);
        if (!this.busy) void this.inspect();
      }
    };
  }

  publish(phase, error = null) {
    this.state = Object.freeze({ phase, error, pending: !!this.record || ['unknown', 'recovery', 'restoring'].includes(phase) });
    for (const listener of this.listeners) listener(this.state);
  }
  subscribe = (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); };
  isReady = () => !this.closed && this.accessible && !!this.shared && this.state.phase === 'ready';
  isBlocked = () => {
    if (this.closed || this.busy || !['ready', 'unavailable'].includes(this.state.phase)) return true;
    if (this.locks?.request && !this.shared) return true;
    try { return this.rawStorage.getItem(CLOUD_RESTORE_MARKER) !== null; }
    catch { return true; }
  };
  assertWritable() {
    if (this.isBlocked()) throw new Error(PAUSED);
  }
  beforeErase = async () => !this.busy && !this.isBlocked();

  async acquireShared() {
    if (this.shared || this.closed || !this.locks?.request) return false;
    if (this.sharedOpening) return this.sharedOpening;
    let entered;
    const ready = new Promise((resolve) => { entered = resolve; });
    const lease = { release: null, done: null };
    lease.done = this.locks.request(CLOUD_SESSION_LOCK, { mode: 'shared', ifAvailable: true }, async (lock) => {
      if (!lock || this.closed) { entered(false); return; }
      this.shared = lease;
      entered(true);
      await new Promise((resolve) => { lease.release = resolve; });
      if (this.shared === lease) this.shared = null;
    }).catch(() => { entered(false); });
    this.sharedOpening = ready;
    try { return await ready; }
    finally { this.sharedOpening = null; }
  }
  async releaseShared() {
    const lease = this.shared;
    if (lease) { lease.release(); await lease.done; }
  }

  async open() {
    await this.acquireShared();
    this.events?.addEventListener?.('storage', this.changed);
    await this.inspect();
    return this;
  }
  async inspect() {
    if (this.closed) return;
    try {
      const marker = this.rawStorage.getItem(CLOUD_RESTORE_MARKER);
      const record = await this.journal.read();
      this.accessible = true;
      if (record !== null) {
        this.record = record;
        this.recoverable = false;
        await validateRecord(record);
        this.recoverable = true;
        if (marker !== null && marker !== record.id) throw new Error(PAUSED);
        this.publish('recovery', 'A cloud restore did not finish. Download the prior copy, then explicitly Finish restore or Restore prior data.');
      } else if (marker !== null) {
        throw new Error('A restore marker exists without a readable journal. Saving and uploads are paused. Preserve local exports and reopen this browser profile.');
      } else if (!this.shared) {
        this.record = null;
        this.recoverable = false;
        this.publish(this.locks?.request ? 'unknown' : 'unavailable', this.locks?.request
          ? CLOSE_TABS : 'Web Locks are unavailable. Cloud restore is disabled; local reading remains available.');
      } else {
        this.record = null;
        this.recoverable = false;
        this.publish('ready');
      }
    } catch (error) {
      this.accessible = false;
      this.publish('unknown', error.message || PAUSED);
    }
  }

  marker(value) {
    if (value === null) this.rawStorage.removeItem(CLOUD_RESTORE_MARKER);
    else this.rawStorage.setItem(CLOUD_RESTORE_MARKER, value);
    if (this.rawStorage.getItem(CLOUD_RESTORE_MARKER) !== value) throw new Error(PAUSED);
  }
  async persist(record) {
    await this.journal.put(record);
    const verified = await this.journal.read();
    if (!equal(record, verified)) throw new Error('Recovery checkpoint could not be verified. Recovery remains paused.');
    this.record = verified;
    this.recoverable = true;
  }

  exportPrior() {
    if (!this.recoverable || !this.record?.prepared?.before) throw new Error('The recovery journal is not verified. Preserve the separate local exports.');
    return JSON.stringify({
      format: 'recap-page-cloud-restore-prior', version: 1, restoreId: this.record.id,
      values: this.record.prepared.before, retainedDraftSources: this.record.prepared.owners[3].retainedSources,
    }, null, 2);
  }

  async exclusiveRun(operation) {
    if (this.busy || this.closed) return { ok: false, error: PAUSED };
    if (!this.accessible || !this.locks?.request) return { ok: false, error: this.state.error || PAUSED };
    this.busy = true;
    this.publish('restoring', 'Restoring complete saved data. Saving and uploads are paused.');
    await this.releaseShared();
    let result;
    try {
      result = await this.locks.request(CLOUD_SESSION_LOCK, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
        if (!lock) throw new Error(CLOSE_TABS);
        this.exclusive = true;
        try {
          // Session first, then history, then draft. Prepared apply never recursively locks an owner.
          return await this.locks.request(LIST_HISTORY_KEY, () =>
            this.locks.request(IMPORT_DRAFT_KEY, operation));
        } finally { this.exclusive = false; }
      });
    } catch (error) {
      result = { ok: false, error: error.message || PAUSED };
      this.publish(this.record ? 'recovery' : 'unknown', result.error);
    } finally {
      this.busy = false;
      await this.acquireShared();
    }
    if (result.ok) this.publish('ready');
    else if (!this.record) {
      const message = result.error;
      await this.inspect();
      this.publish(this.state.phase, message);
    }
    return result;
  }

  async restore(text, { draftRecovery = [] } = {}) {
    if (this.isBlocked()) return { ok: false, error: this.state.error || PAUSED };
    return this.exclusiveRun(async () => {
      if (await this.journal.read() !== null || this.rawStorage.getItem(CLOUD_RESTORE_MARKER) !== null) throw new Error(PAUSED);
      const prepared = await prepareCloudRestore({
        text, storage: this.rawStorage, isExclusive: () => this.exclusive, draftRecovery,
      });
      const random = new Uint8Array(32);
      globalThis.crypto.getRandomValues(random);
      const id = [...random].map((n) => n.toString(16).padStart(2, '0')).join('');
      const record = { version: 1, id, candidate: text, prepared, position: 0, direction: 'forward', phase: 'applying' };
      await validateRecord(record);
      this.marker(id);
      try { await this.persist(record); }
      catch (error) {
        if (await this.journal.read() === null) this.marker(null);
        throw error;
      }
      return this.runPrepared('forward');
    });
  }

  async recover(direction) {
    if (!['forward', 'prior'].includes(direction)) return { ok: false, error: 'Choose Finish restore or Restore prior data.' };
    return this.exclusiveRun(async () => {
      const record = await this.journal.read();
      if (record === null) throw new Error(PAUSED);
      await validateRecord(record);
      this.recoverable = true;
      const marker = this.rawStorage.getItem(CLOUD_RESTORE_MARKER);
      if (marker !== null && marker !== record.id) throw new Error(PAUSED);
      this.record = record;
      this.marker(record.id);
      return this.runPrepared(direction);
    });
  }

  async runPrepared(direction) {
    const { states } = await validateRecord(this.record);
    let record = this.record;
    const adjacent = record.position + (record.direction === 'forward' ? 1 : -1);
    let position = record.position;
    if (!exactImage(this.rawStorage, states[position])) {
      if (adjacent < 0 || adjacent >= states.length || !exactImage(this.rawStorage, states[adjacent])) {
        throw new Error('Local data contains an unknown or foreign edit. Download the prior copy; automated recovery did not replace it.');
      }
      position = adjacent;
    }
    record = { ...record, position, direction, phase: 'applying' };
    // The original verified intent already owns the next step. Changing direction needs a new checkpoint.
    if (!equal(record, this.record)) await this.persist(record);
    const target = direction === 'forward' ? 8 : 0;
    while (record.position !== target) {
      const step = direction === 'forward' ? record.position : record.position - 1;
      const verified = stable(this.record.prepared);
      const applied = applyPreparedCloudRestore(record.prepared, step, {
        storage: this.rawStorage, direction, isExclusive: () => this.exclusive,
        isJournalReady: ({ prepared }) => this.rawStorage.getItem(CLOUD_RESTORE_MARKER) === record.id
          && stable(prepared) === verified && equal(record, this.record),
      });
      if (!applied.ok) throw new Error(applied.error);
      record = { ...record, position: record.position + (direction === 'forward' ? 1 : -1) };
      await this.persist(record);
    }
    const image = states[target];
    await this.persist({ ...record, phase: 'adopting' });
    if (!exactImage(this.rawStorage, image) || await this.adopt(image, { direction }) !== true
      || !exactImage(this.rawStorage, image)) throw new Error('Saved data or its on-screen readback did not agree. Recovery remains available; no success was announced.');
    await this.persist({ ...this.record, phase: 'cleaning' });
    if (!exactImage(this.rawStorage, image)) throw new Error(PAUSED);
    // Clear the marker first under the exclusive lease. A surviving journal guards the next boot.
    this.marker(null);
    try {
      if (await this.journal.remove(this.record) !== true) throw new Error(PAUSED);
    } catch (error) {
      this.marker(record.id);
      throw error;
    }
    this.record = null;
    this.recoverable = false;
    return { ok: true, direction };
  }

  async close() {
    if (this.busy) throw new Error('Wait for the active restore before closing its session.');
    this.closed = true;
    this.events?.removeEventListener?.('storage', this.changed);
    await this.releaseShared();
    this.publish('closed', PAUSED);
  }
}

let runtime = null;
export function cloudRestoreRuntime() { return runtime; }
export async function initializeCloudRestore() {
  if (!runtime) {
    runtime = await new CloudRestoreSession().open();
    const resume = async () => {
      if (runtime.busy) return;
      await runtime.acquireShared();
      await runtime.inspect();
    };
    globalThis.addEventListener?.('pagehide', () => {
      runtime.publish('checking', PAUSED);
      void runtime.releaseShared();
    });
    globalThis.addEventListener?.('pageshow', resume);
    globalThis.document?.addEventListener?.('visibilitychange', () => {
      if (globalThis.document.visibilityState !== 'hidden') void resume();
    });
  }
  return runtime;
}
