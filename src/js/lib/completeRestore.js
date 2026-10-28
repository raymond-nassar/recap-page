// The restore engine for a complete backup, and the guard that keeps every other writer away from saved
// data while a restore runs or waits to be recovered.
//
// A complete restore replaces four kinds of data with eight writes, so an interruption can leave any
// mixture of old and new. The engine journals the exact prior and prepared bytes of every component in
// IndexedDB, reads the journal back, and only then sets a marker in localStorage and writes. Startup
// reads only that marker, synchronously, so a start with nothing pending never waits for IndexedDB or
// for the tab lock; a deferred journal read after the first render finds anything the marker missed.
//
// The order matters because the two stores do not reach disk together. Measured against Chromium's own
// source on 2026-10-28: a completed IndexedDB transaction is handed to the operating system at once,
// while localStorage writes wait in a batch for five seconds or more (longer under its hourly rate
// limits) and are dropped if the browser process is killed first. Each batch is written whole, so what
// survives a kill is localStorage as it stood at some earlier moment. Hence three rules:
//
// * The journal is written before the marker and never removed before it, so a marker always has a
//   journal. Journal writes ask for strict durability, so this also holds across a power cut.
// * Each component's bytes are classified against its whole sequence of states, because the browser can
//   lose any run of recent writes whatever the journal's checkpoint says. Only exact states are trusted;
//   anything else is a foreign edit, reported and never overwritten.
// * A finished restore keeps its journal, and its marker becomes done. Since localStorage keeps its own
//   order, a marker that reads done means every restore write before it is present. A later start clears
//   the kept journal once it is a day old, far past the delayed save, and the next restore or erase
//   clears it sooner. Removing it at once would let a kill a few seconds later undo a restore the reader
//   had been told was finished, with nothing left to recover from.
//
// Tabs coordinate through one Web Lock. Every tab holds it shared while it can save; a restore, a
// recovery and their cleanups take it exclusively, so they run only while no other tab of this version
// can write. A tab opened meanwhile waits, then reloads, so nothing it held from before can be written
// back. Tabs still running a version without this lock cannot be seen, which the confirmation says.

import { RESTORE_MARKER_KEY, RESTORE_LOCK, RESTORE_DATABASE } from '../storage.js';
import {
  CompleteBackupError, RESTORE_KEYS, canonical, classifyComponent, imageOf, parseCompleteBackup,
  prepareCompleteRestore, restorePlan,
} from './completeBackup.js';

const JOURNAL_STORE = 'journal';
const PLAN_SLOT = 'plan';
const PROGRESS_SLOT = 'progress';
const MARKER = /^(active|cleaning|done):([a-f0-9]{64})$/;
const HEX = /^[a-f0-9]{64}$/;
const NO_ID = '0'.repeat(64);
export const PRIOR_COPY_FORMAT = 'recap-page-complete-restore-prior';
export const PRIOR_COPY_FILENAME = 'recap-page-complete-restore-prior.json';
export const KEEP_FINISHED_JOURNAL_MS = 24 * 60 * 60 * 1000;
const LOCK_ANSWER_MS = 5000;
const JOURNAL_OPEN_MS = 5000;

export const RESTORE_MESSAGES = Object.freeze({
  starting: 'Recap Page is checking its other tabs before saving. That change was not saved; try it again.',
  working: 'A complete restore is running in this tab. Saving starts again when it ends.',
  otherTab: 'Another Recap Page tab is restoring a complete backup, so saving is paused here. This tab reloads when it finishes.',
  unchecked: 'This browser did not say whether another Recap Page tab is restoring, so saving is paused. Reload the page to try again.',
  checking: 'Recap Page is checking an earlier complete restore, so saving is paused for a moment.',
  cleaning: 'Recap Page is finishing an earlier complete restore. Close other Recap Page tabs and saving starts again.',
  recovery: 'A complete restore did not finish, so saving is paused. Open Backup & settings to finish it or keep the data that is here.',
  cleanupFailed: 'Recap Page could not finish cleaning up after an earlier complete restore, perhaps because storage is full, so saving is paused. Reload the page to try again, or open Backup & settings and keep the data that is here.',
  closeTabs: 'Close other Recap Page tabs and windows, including ones running an older version, then try again. Nothing was replaced.',
  busy: 'A complete restore action is already running. Wait for it to finish.',
  noLocks: 'This browser cannot coordinate Recap Page tabs, so complete restore is turned off here. Every other backup still works.',
  noJournal: 'This browser cannot keep a recovery copy, so complete restore is turned off here. Every other backup still works.',
  // A read that failed once is not a missing capability, so it is said as a check this page could not
  // make, which a reload makes again.
  journalUnchecked: 'Recap Page could not check for an unfinished complete restore just now, so complete restore is off until you reload the page. Every other backup still works.',
  restoreUnchecked: 'Recap Page could not check for a recovery copy from an earlier complete restore just now, so nothing was replaced. Reload the page to try again.',
  copyReadable: 'The recovery copy can be read now, so nothing was removed. Download the exact prior copy before you choose again.',
  copyChanged: 'The recovery copy changed after these choices were shown, so nothing was removed. Choose again from the options shown now.',
  keepNotOffered: 'Keeping the data that is here now is not offered for this restore, so nothing was removed. Finish it or restore the prior data.',
  finishNotOffered: 'Finishing this restore is not offered now, so nothing was replaced. Choose again from the options shown now.',
  priorNotOffered: 'Restoring the prior data is not offered for this restore now, so nothing was replaced. Choose again from the options shown now.',
  copyUnchecked: 'The app could not check for a recovery copy kept by a complete restore, so one may still be in this browser.',
  // A copy that can be read but not removed, as on a full disk, waits with its marker for a later start.
  copyKept: 'The recovery copy could not be removed, perhaps because storage is full, so a later start tries again.',
  copyStuck: 'Recap Page could not remove the recovery copy from an earlier complete restore, perhaps because storage is full, so complete restore is off until a later start removes it. Every other backup still works.',
  reloading: 'Another Recap Page tab changed saved data, so this page is reloading to show it.',
});

const RECOVERY_TEXT = {
  interrupted: 'A complete restore did not finish. Saving is paused until you choose: download the exact prior copy if you want it, then finish the restore or put the earlier data back.',
  lost: 'A complete restore finished, but the browser closed before it saved the result, so the data from before it is still here. Saving is paused until you finish the restore again or keep this data.',
  foreign: 'A complete restore did not finish, and some saved data changed afterwards, so it cannot be finished or undone automatically. Saving is paused. Download the exact prior copy, then keep the data that is here now.',
  missing: 'A complete restore did not finish, and its recovery copy is missing. Saving is paused until you keep the data that is here now.',
  invalid: 'The recovery copy from an earlier complete restore cannot be read. Saving is paused. Download it if you want it, then keep the data that is here now.',
  unchecked: 'A complete restore did not finish, and its recovery copy could not be checked just now, so saving is paused. Reload the page to try again. Keeping the data that is here now leaves the copy in place, and a later start offers it again if it can.',
  cleanup: 'Recap Page could not finish cleaning up after an earlier complete restore, perhaps because storage is full, so saving is paused. Reload the page to try again, or keep the data that is here now.',
};

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

export function readMarker(storage) {
  let raw;
  try { raw = storage?.getItem(RESTORE_MARKER_KEY) ?? null; }
  catch { return { state: 'unreadable', id: null, raw: undefined }; }
  if (raw === null) return { state: 'absent', id: null, raw };
  const match = MARKER.exec(raw);
  return match ? { state: match[1], id: match[2], raw } : { state: 'invalid', id: null, raw };
}

function writeMarker(storage, value) {
  try {
    if (value === null) storage.removeItem(RESTORE_MARKER_KEY);
    else storage.setItem(RESTORE_MARKER_KEY, value);
  } catch { /* the read below decides */ }
  let held;
  try { held = storage.getItem(RESTORE_MARKER_KEY) ?? null; } catch { held = undefined; }
  if (held !== value) throw new Error('The restore marker could not be saved. Nothing further was changed.');
}

// ------------------------------------------------------------------ journal

// Two slots: the plan, written once, and its progress, rewritten after every write. The plan holds the
// whole backup and every prior value, so checkpoints never rewrite it.
//
// This database is not a response cache and must never be reached by cache cleanup.
export function createRestoreJournal(factory = globalThis.indexedDB, { timeoutMs = JOURNAL_OPEN_MS } = {}) {
  let opening = null;
  function open() {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        let request;
        try { request = factory.open(RESTORE_DATABASE, 1); }
        catch { reject(new Error(RESTORE_MESSAGES.noJournal)); return; }
        let settled = false;
        const fail = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(new Error(RESTORE_MESSAGES.noJournal));
        };
        const timer = setTimeout(fail, timeoutMs);
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
      opening.catch(() => { opening = null; });
    }
    return opening;
  }
  async function run(mode, operation) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = mode === 'readwrite' ? db.transaction(JOURNAL_STORE, mode, { durability: 'strict' }) : db.transaction(JOURNAL_STORE, mode);
      } catch {
        tx = db.transaction(JOURNAL_STORE, mode);
      }
      let value;
      operation(tx.objectStore(JOURNAL_STORE), (result) => { value = result; }, tx);
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(new Error('The recovery copy could not be saved or read.'));
      tx.onerror = tx.onabort;
    });
  }
  return {
    available: typeof factory?.open === 'function',
    read: () => run('readonly', (store, set) => {
      const plan = store.get(PLAN_SLOT);
      const progress = store.get(PROGRESS_SLOT);
      progress.onsuccess = () => {
        const [held, at] = [plan.result, progress.result];
        if (held === undefined && at === undefined) set(null);
        else if (object(held) && object(at) && held.id === at.id) set({ ...held, ...at });
        // Kept whole, so the reader can still download it, but it can never pass as a journal.
        else set({ unmatched: true, plan: held ?? null, progress: at ?? null });
      };
    }),
    readProgress: () => run('readonly', (store, set) => {
      const progress = store.get(PROGRESS_SLOT);
      progress.onsuccess = () => set(progress.result ?? null);
    }),
    begin: (record) => run('readwrite', (store) => {
      const { writes, direction, phase, finishedAt, ...plan } = record;
      store.put(plan, PLAN_SLOT);
      store.put({ id: record.id, writes, direction, phase, finishedAt }, PROGRESS_SLOT);
    }),
    progress: (record) => run('readwrite', (store) => {
      store.put({ id: record.id, writes: record.writes, direction: record.direction, phase: record.phase, finishedAt: record.finishedAt }, PROGRESS_SLOT);
    }),
    remove: () => run('readwrite', (store, set, tx) => {
      store.delete(PLAN_SLOT);
      store.delete(PROGRESS_SLOT);
      const plan = store.get(PLAN_SLOT);
      const progress = store.get(PROGRESS_SLOT);
      progress.onsuccess = () => {
        const gone = plan.result === undefined && progress.result === undefined;
        set(gone);
        if (!gone) tx.abort();
      };
    }),
    async close() {
      const pending = opening;
      opening = null;
      if (pending) (await pending.catch(() => null))?.close();
    },
  };
}

const RECORD_FIELDS = ['backup', 'direction', 'finishedAt', 'id', 'phase', 'prepared', 'version', 'writes'];

async function checkRecord(record, cryptoProvider) {
  if (!object(record) || Object.keys(record).sort().join(',') !== RECORD_FIELDS.join(',') || record.version !== 1
    || typeof record.id !== 'string' || !HEX.test(record.id) || typeof record.backup !== 'string'
    || !['forward', 'prior'].includes(record.direction) || !['applying', 'done'].includes(record.phase)
    || !Number.isSafeInteger(record.writes) || record.writes < 0
    || !(record.finishedAt === null || Number.isFinite(record.finishedAt))) {
    throw new CompleteBackupError('The recovery copy is incomplete.', 'journal');
  }
  const backup = await parseCompleteBackup(record.backup, { cryptoProvider });
  return { kind: 'valid', record, backup, plan: restorePlan(record.prepared, backup) };
}

// ------------------------------------------------------------------ locks

// A Web Lock held until release() is called. Resolves to null when the lock was not granted.
function holdLock(locks, options) {
  return new Promise((resolve) => {
    let release;
    const released = new Promise((done) => { release = done; });
    const lease = { release: () => { release(); return lease.done; }, done: null };
    lease.done = Promise.resolve().then(() => locks.request(RESTORE_LOCK, options, async (lock) => {
      if (!lock) { resolve(null); return; }
      resolve(lease);
      await released;
    })).catch(() => { resolve(null); });
  });
}

function timeout(ms) {
  return new Promise((resolve) => { setTimeout(() => resolve('timeout'), ms); });
}

function randomId(cryptoProvider) {
  const bytes = new Uint8Array(32);
  cryptoProvider.getRandomValues(bytes);
  return [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('');
}

// ------------------------------------------------------------------ the state table

function classify(storage, found) {
  let parts;
  try { parts = found.plan.components.map((component) => classifyComponent(storage, component)); }
  catch { return { parts: [], foreign: true, allPrior: false, allPrepared: false }; }
  return {
    parts,
    foreign: parts.some((part) => part.status === 'other'),
    allPrior: parts.every((part) => part.status === 'prior' || part.status === 'unchanged'),
    allPrepared: parts.every((part) => part.status === 'prepared' || part.status === 'unchanged'),
  };
}

function recoveryOf(kind, journal, { canFinish = false, canRestorePrior = false, canKeep = !canFinish || kind === 'lost' } = {}) {
  const download = journal.kind === 'valid' ? 'prior' : journal.kind === 'invalid' ? 'raw' : null;
  return {
    kind: 'recovery',
    recovery: {
      kind, id: journal.kind === 'valid' ? journal.record.id : null, message: RECOVERY_TEXT[kind],
      canFinish, canRestorePrior, canKeep, download,
    },
  };
}

function recoveryFor(journal, storage, { marked }) {
  const result = classify(storage, journal);
  const { record } = journal;
  // A restore writes nothing before its marker, so with no marker and nothing recorded, any change in
  // the stored bytes is the reader's own, and only a restore write found in them keeps the journal.
  const progressed = result.parts.some((part) => part.status === 'partial' || part.status === 'prepared');
  if (!marked && record.writes === 0 && record.phase === 'applying' && !progressed) return { kind: 'discard', id: record.id };
  if (result.foreign) return recoveryOf('foreign', journal);
  const target = record.direction === 'prior' ? result.allPrior : result.allPrepared;
  if (!marked && record.phase === 'done' && target) return { kind: 'finished', id: record.id, finishedAt: record.finishedAt };
  if (record.direction === 'forward' && record.phase === 'done' && result.allPrior) return recoveryOf('lost', journal, { canFinish: true });
  return recoveryOf('interrupted', journal, { canFinish: true, canRestorePrior: !result.allPrior, canKeep: result.allPrior });
}

// What the marker, the journal and the stored bytes together call for. The table it implements is in
// docs/ARCHITECTURE.md under "Complete backups".
export function decideRestoreState(marker, journal, storage, now) {
  const valid = journal.kind === 'valid';
  const absentRows = () => {
    if (journal.kind === 'absent') return { kind: 'none' };
    if (journal.kind === 'invalid') return recoveryOf('invalid', journal);
    const decision = recoveryFor(journal, storage, { marked: false });
    if (decision.kind === 'finished') {
      return now - (decision.finishedAt ?? now) >= KEEP_FINISHED_JOURNAL_MS ? { kind: 'cleanup', id: decision.id, wait: false } : { kind: 'none' };
    }
    return decision;
  };
  if (journal.kind === 'unreadable') {
    // Not "missing": the copy may be there and readable on the next try, so nothing may treat it as gone.
    // A done: or cleaning: marker follows data the reader already accepted, so it waits, as no marker
    // does, for a start that can read the journal and apply its rows. Pausing on one would ask the
    // same question at every start for as long as IndexedDB failed.
    return ['absent', 'done', 'cleaning'].includes(marker.state)
      ? { kind: 'none', unavailable: true }
      : { ...recoveryOf('unchecked', journal), unavailable: true };
  }
  switch (marker.state) {
    case 'active':
      return valid && journal.record.id === marker.id ? recoveryFor(journal, storage, { marked: true }) : recoveryOf('missing', journal);
    case 'cleaning':
      if (journal.kind === 'absent' || (valid && journal.record.id === marker.id)) return { kind: 'cleanup', id: marker.id, wait: true };
      return { kind: 'clear-marker', id: marker.id, wait: true, then: absentRows() };
    case 'done':
      if (journal.kind === 'absent') return { kind: 'clear-marker', id: marker.id, wait: false, then: { kind: 'none' } };
      if (valid && journal.record.id === marker.id) {
        return now - (journal.record.finishedAt ?? now) >= KEEP_FINISHED_JOURNAL_MS ? { kind: 'cleanup', id: marker.id, wait: false } : { kind: 'none' };
      }
      return absentRows();
    case 'absent':
      return absentRows();
    default:
      return recoveryOf('missing', journal);
  }
}

// ------------------------------------------------------------------ the session

export class CompleteRestore {
  constructor({
    storage = globalThis.localStorage, locks = globalThis.navigator?.locks,
    journal = createRestoreJournal(globalThis.indexedDB), events = globalThis,
    clock = Date.now, cryptoProvider = globalThis.crypto, reload = () => globalThis.location?.reload(),
    lockAnswerMs = LOCK_ANSWER_MS,
  } = {}) {
    this.raw = storage ?? null;
    this.locks = typeof locks?.request === 'function' ? locks : null;
    this.journal = journal;
    this.events = events;
    this.clock = clock;
    this.cryptoProvider = cryptoProvider;
    this.reload = reload;
    this.lockAnswerMs = lockAnswerMs;
    this.listeners = new Set();
    this.started = false;
    this.shared = null;
    this.answered = false;
    this.timedOut = false;
    this.otherTab = false;
    this.busy = false;
    this.exclusiveHeld = false;
    this.writeScope = 0;
    this.checking = false;
    this.cleaning = false;
    this.recovery = null;
    this.verified = null;
    // The marker as this page last knew it: read at start, and updated by every marker write this tab
    // makes itself. Any other difference means another tab changed saved data under this page.
    this.markerSeen = null;
    this.journalUnchecked = false;
    this.copyStuck = false;
    this.stale = false;
    this.unavailableReason = !this.locks ? RESTORE_MESSAGES.noLocks
      : this.journal?.available ? null : RESTORE_MESSAGES.noJournal;
    this.settled = Promise.resolve();
    this.phase = 'idle';
    this.state = Object.freeze({ phase: 'idle', message: null, recovery: null, available: false, unavailableReason: this.unavailableReason, busy: false });
    const self = this;
    const raw = this.raw;
    const guarded = new Set(RESTORE_KEYS);
    // Every owner of saved data writes through this. Only the keys a complete restore replaces are
    // guarded, so salvage copies, cache cleanup marks and acknowledgements are never refused.
    this.storage = raw ? {
      get length() { return raw.length; },
      key: (index) => raw.key(index),
      getItem: (key) => raw.getItem(key),
      setItem(key, value) {
        if (guarded.has(key)) self.assertWritable();
        raw.setItem(key, value);
      },
      removeItem(key) {
        if (guarded.has(key)) self.assertWritable();
        raw.removeItem(key);
      },
      clear() {
        self.assertWritable();
        raw.clear();
      },
    } : undefined;
  }

  get capable() { return Boolean(this.raw && this.locks && this.journal?.available); }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  writable() {
    return this.writeScope > 0 || this.phase === 'open' || this.phase === 'unavailable';
  }

  assertWritable() {
    if (!this.writable()) throw new Error(this.state.message || RESTORE_MESSAGES.starting);
  }

  refresh() {
    let phase = 'open';
    let message = null;
    if (!this.started) phase = 'idle';
    else if (this.stale) { phase = 'paused'; message = RESTORE_MESSAGES.reloading; }
    else if (this.cleaning) { phase = 'paused'; message = RESTORE_MESSAGES.cleaning; }
    else if (this.busy) { phase = 'paused'; message = RESTORE_MESSAGES.working; }
    else if (this.otherTab) { phase = 'paused'; message = RESTORE_MESSAGES.otherTab; }
    else if (this.recovery) { phase = 'paused'; message = this.recovery.kind === 'cleanup' ? RESTORE_MESSAGES.cleanupFailed : RESTORE_MESSAGES.recovery; }
    else if (this.checking) { phase = 'paused'; message = RESTORE_MESSAGES.checking; }
    else if (this.timedOut) { phase = 'paused'; message = RESTORE_MESSAGES.unchecked; }
    else if (!this.capable) phase = 'unavailable';
    else if (!this.shared) { phase = 'pending'; message = RESTORE_MESSAGES.starting; }
    this.phase = phase;
    const unavailableReason = this.unavailableReason ?? (this.journalUnchecked ? RESTORE_MESSAGES.journalUnchecked : null)
      ?? (this.copyStuck ? RESTORE_MESSAGES.copyStuck : null);
    this.state = Object.freeze({
      phase, message, recovery: this.recovery,
      available: this.capable && !unavailableReason && !this.recovery && phase === 'open',
      unavailableReason, busy: this.busy, reloading: this.stale,
    });
    for (const listener of this.listeners) {
      try { listener(this.state); } catch { /* a view's failure cannot change the restore's state */ }
    }
    return this.state;
  }

  // Every marker write this tab makes goes through here, so a difference from markerSeen is always
  // another tab's doing.
  markOwn(value) {
    writeMarker(this.raw, value);
    this.markerSeen = value;
  }

  markerChanged() {
    return readMarker(this.raw).raw !== this.markerSeen;
  }

  // Everything this page read before may be older than storage, so nothing more is saved from it.
  reloadNow() {
    this.stale = true;
    this.refresh();
    this.reload();
  }

  // Synchronous, and the first thing boot does: the marker alone decides whether saving starts paused.
  // The lock is only requested here; nothing waits for its answer except writes.
  start() {
    if (this.started) return this.settled;
    this.started = true;
    const marker = readMarker(this.raw);
    this.markerSeen = marker.raw;
    if (['active', 'cleaning', 'invalid', 'unreadable'].includes(marker.state)) this.checking = true;
    this.refresh();
    this.settled = this.acquireShared();
    this.events?.addEventListener?.('pagehide', () => {
      if (this.busy) return;
      void this.releaseShared().then(() => this.refresh());
    });
    this.events?.addEventListener?.('pageshow', (event) => {
      if (!event?.persisted || this.busy) return;
      // Restored from the back-forward cache. A restore or recovery another tab ran meanwhile changed
      // the marker, and every owner here still holds what it read before, so the page is read again.
      if (this.markerChanged()) {
        this.reloadNow();
        return;
      }
      void this.acquireShared();
    });
    return this.settled;
  }

  async acquireShared() {
    if (!this.locks || !this.raw || this.shared || this.busy) { this.refresh(); return; }
    const request = holdLock(this.locks, { mode: 'shared', ifAvailable: true });
    const answer = await Promise.race([request, timeout(this.lockAnswerMs)]);
    if (answer === 'timeout') {
      this.timedOut = true;
      this.refresh();
      // A late answer still counts, so a slow browser recovers without a reload.
      void request.then((late) => this.takeAnswer(late));
      return;
    }
    this.takeAnswer(answer);
  }

  takeAnswer(answer) {
    this.answered = true;
    this.timedOut = false;
    if (answer) {
      if (this.shared || this.busy) void answer.release();
      else this.shared = answer;
      this.otherTab = false;
      // A restore, a recovery or a cleanup another tab finished between this page's first read and its
      // lock leaves nothing pending, yet this page still holds what it read before, settings included,
      // which have no write token to catch them. So the page is read again before anything is saved.
      if (this.markerChanged()) {
        this.reloadNow();
        return;
      }
    } else {
      this.otherTab = true;
      this.waitForOtherTab();
    }
    this.refresh();
  }

  async releaseShared() {
    const lease = this.shared;
    this.shared = null;
    if (lease) await lease.release();
  }

  // Another tab holds the lock exclusively. When it lets go, whatever it did is read afresh.
  waitForOtherTab() {
    if (this.waiting) return;
    this.waiting = holdLock(this.locks, { mode: 'shared' }).then(async (lease) => {
      if (lease) await lease.release();
      this.reloadNow();
    });
  }

  async readJournal() {
    if (!this.journal?.available) return { kind: 'unreadable' };
    let record;
    try { record = await this.journal.read(); }
    catch { return { kind: 'unreadable' }; }
    if (record === null || record === undefined) return { kind: 'absent' };
    try { return await checkRecord(record, this.cryptoProvider); }
    catch { return { kind: 'invalid', raw: record }; }
  }

  // The deferred read. Runs after the first render and never blocks it.
  async inspect() {
    if (!this.started || !this.capable && !this.checking) { this.checking = false; this.refresh(); return this.state; }
    if (this.otherTab || this.busy || this.stale) return this.state;
    if (this.inspecting) return this.inspecting;
    this.inspecting = this.runInspection().finally(() => { this.inspecting = null; });
    return this.inspecting;
  }

  async runInspection() {
    // The same rule as the lock answer, for a page whose answer was late: the check runs before this
    // tab writes a marker of its own, which would hide what another tab did.
    if (this.markerChanged()) {
      this.reloadNow();
      return this.state;
    }
    const journal = await this.readJournal();
    const decision = decideRestoreState(readMarker(this.raw), journal, this.raw, this.clock());
    this.journalUnchecked = Boolean(decision.unavailable) && decision.kind !== 'recovery' && Boolean(this.journal?.available);
    await this.act(decision, { inside: false });
    this.checking = false;
    return this.refresh();
  }

  // Carries out a decision. Discards and cleanups run under the exclusive lock, as the table requires,
  // so a tab never removes the journal of a restore another tab is running. Outside a restore they
  // are attempted only when the lock is free, except where saving waits on them.
  async act(decision, { inside }) {
    if (decision.kind === 'recovery') {
      this.recovery = decision.recovery;
      return;
    }
    this.recovery = null;
    if (decision.kind === 'none' || decision.kind === 'finished') return;
    const maintain = async () => {
      const fresh = decideRestoreState(readMarker(this.raw), await this.readJournal(), this.raw, this.clock());
      if (fresh.kind !== decision.kind || fresh.id !== decision.id) return this.act(fresh, { inside: true });
      if (fresh.kind === 'discard') await this.removeJournal();
      else if (fresh.kind === 'cleanup') await this.cleanUp(fresh.id);
      else if (fresh.kind === 'clear-marker') {
        this.markOwn(null);
        return this.act(fresh.then, { inside: true });
      }
      return { ok: true };
    };
    if (inside) return maintain();
    if (decision.wait) this.cleaning = true;
    this.refresh();
    const result = await this.withExclusive(maintain, { wait: Boolean(decision.wait), quiet: true });
    this.cleaning = false;
    // A copy that cannot be removed waits with its marker for a later start, as one that cannot be read
    // does. Pausing on it would pause every start, because every recovery action ends in a reload (#947).
    // Only a cleaning: marker waits, so any other failure here is a cleanup, and it is said as one: the
    // restore it follows finished or was kept.
    if (result?.ok === false && decision.wait && !result.copyKept) this.recovery = recoveryOf('cleanup', { kind: 'absent' }).recovery;
  }

  async removeJournal() {
    let gone;
    try { gone = await this.journal.remove() === true && await this.journal.read() === null; }
    catch { gone = false; }
    if (!gone) throw Object.assign(new Error(RESTORE_MESSAGES.copyKept), { copyKept: true });
    this.copyStuck = false;
  }

  // Keeping and erase end the pause even when the copy cannot be removed yet: the cleaning: marker
  // already written stays with it, so a later start finishes the cleanup, and complete restore is off
  // until then. Nothing else is left half done, because the person's choice was made before the cleanup.
  leaveCopyForLater() {
    this.recovery = null;
    this.copyStuck = true;
  }

  // Cleanup order: the marker says cleaning, the journal goes and is checked gone, then the marker
  // goes. A marker never outlives its journal except as "cleaning", which the next start finishes.
  async cleanUp(id, { journal = true } = {}) {
    this.markOwn(`cleaning:${id ?? NO_ID}`);
    if (journal) await this.removeJournal();
    this.markOwn(null);
  }

  // Over a journal that cannot be read, only a marker that pauses every start is cleared, and directly:
  // a cleaning: step would tell a later start to remove the copy being left for it to offer. A done: or
  // cleaning: marker stays, so a later start that can read the journal applies its rows.
  clearOverUnchecked() {
    if (!['active', 'invalid', 'unreadable'].includes(readMarker(this.raw).state)) return false;
    this.markOwn(null);
    return true;
  }

  async withExclusive(operation, { wait = false } = {}) {
    if (this.busy) return { ok: false, changed: false, error: RESTORE_MESSAGES.busy };
    this.busy = true;
    this.refresh();
    let lease = null;
    try {
      if (this.locks) {
        await this.releaseShared();
        lease = await holdLock(this.locks, wait ? { mode: 'exclusive' } : { mode: 'exclusive', ifAvailable: true });
        if (!lease) return { ok: false, changed: false, error: RESTORE_MESSAGES.closeTabs };
      }
      this.exclusiveHeld = true;
      try {
        return (await operation()) ?? { ok: true };
      } catch (error) {
        if (error?.copyKept) this.copyStuck = true;
        return {
          ok: false, changed: error && 'changed' in error ? error.changed : false,
          error: error?.message || 'The complete restore could not continue.',
          ...(error?.copyKept ? { copyKept: true } : {}),
        };
      } finally {
        this.exclusiveHeld = false;
      }
    } finally {
      if (lease) await lease.release();
      this.busy = false;
      await this.acquireShared();
    }
  }

  assertRunning(record) {
    if (this.exclusiveHeld !== true || this.verified !== record
      || readMarker(this.raw).raw !== `active:${record.id}`) {
      throw new Error('The restore lost its lock or its recovery copy, so nothing more was replaced. Recovery is available.');
    }
  }

  writeStep(component, step, direction, record) {
    this.assertRunning(record);
    const source = direction === 'forward' ? component.states[step] : component.states[step + 1];
    const target = direction === 'forward' ? component.states[step + 1] : component.states[step];
    const effect = component.effects[step];
    const value = direction === 'forward' ? effect.value : effect.before;
    const same = (image, state) => component.keys.every((key) => image[key] === state[key]);
    if (same(imageOf(this.raw, component.keys), target)) return false;
    if (!same(imageOf(this.raw, component.keys), source)) {
      throw new Error('Saved data changed outside this restore, so it was not replaced. Recovery is available.');
    }
    let failure = null;
    try {
      if (value === null) this.raw.removeItem(effect.key);
      else this.raw.setItem(effect.key, value);
    } catch (error) { failure = error; }
    const held = imageOf(this.raw, component.keys);
    if (same(held, target)) return true;
    if (same(held, source)) {
      throw new Error(failure?.name === 'QuotaExceededError'
        ? 'Browser storage is full, so the restore stopped before replacing everything. Recovery is available.'
        : 'A write was refused, so the restore stopped before replacing everything. Recovery is available.');
    }
    throw new Error('Saved data does not match the restore, so it stopped. Recovery is available.');
  }

  async checkpoint(next) {
    await this.journal.progress(next);
    const read = await this.journal.readProgress();
    if (!read || read.id !== next.id || read.writes !== next.writes || read.phase !== next.phase
      || read.direction !== next.direction || read.finishedAt !== next.finishedAt) {
      throw new Error('The recovery copy could not be updated, so the restore stopped. Recovery is available.');
    }
    this.verified = next;
    return next;
  }

  async apply(found, record, direction) {
    let current = record;
    const components = direction === 'forward' ? found.plan.components : [...found.plan.components].reverse();
    for (const component of components) {
      let where;
      try { where = classifyComponent(this.raw, component); }
      catch { where = { status: 'other' }; }
      if (where.status === 'other') throw new Error('Saved data changed outside this restore, so it was not replaced. Recovery is available.');
      const steps = direction === 'forward'
        ? Array.from({ length: component.effects.length - where.highest }, (_, i) => where.highest + i)
        : Array.from({ length: where.lowest }, (_, i) => where.lowest - 1 - i);
      for (const step of steps) {
        if (this.writeStep(component, step, direction, current)) {
          current = await this.checkpoint({ ...current, writes: current.writes + 1 });
        }
      }
    }
    const check = classify(this.raw, found);
    if (check.foreign || !(direction === 'forward' ? check.allPrepared : check.allPrior)) {
      throw new Error('Saved data does not match the restore, so it stopped. Recovery is available.');
    }
    current = await this.checkpoint({ ...current, phase: 'done', finishedAt: this.clock() });
    this.markOwn(`done:${current.id}`);
    return current;
  }

  // Leaves storage exactly as it was found, or with a recovery the next start offers. Never both
  // half-written and unrecorded.
  async restore(text, { draftRecovery = [] } = {}) {
    if (!this.capable || this.unavailableReason) return { ok: false, changed: false, error: this.unavailableReason ?? RESTORE_MESSAGES.noJournal };
    if (this.recovery) return { ok: false, changed: false, error: RESTORE_MESSAGES.recovery };
    let backup;
    try { backup = await parseCompleteBackup(text, { cryptoProvider: this.cryptoProvider }); }
    catch (error) { return { ok: false, changed: false, invalid: true, error: error.message }; }
    return this.withExclusive(async () => {
      // Whatever an earlier restore left is settled first: a kept journal is cleaned up, an orphan that
      // never wrote is discarded, and anything that still needs the reader refuses this restore.
      const marker = readMarker(this.raw);
      const earlier = await this.readJournal();
      // A journal that cannot be read now may still be the only copy of what an earlier restore
      // replaced, and this restore's journal would be written over it.
      if (earlier.kind === 'unreadable') throw new Error(RESTORE_MESSAGES.restoreUnchecked);
      let before = decideRestoreState(marker, earlier, this.raw, this.clock());
      if (before.kind === 'clear-marker') {
        this.markOwn(null);
        before = before.then;
      }
      if (before.kind === 'recovery') {
        this.recovery = before.recovery;
        throw new Error(RESTORE_MESSAGES.recovery);
      }
      if (before.kind === 'discard') await this.removeJournal();
      else if (before.kind === 'cleanup') await this.cleanUp(before.id);
      else if (marker.state === 'done') await this.cleanUp(marker.id);
      const prepared = prepareCompleteRestore({
        backup, storage: this.raw, isExclusive: () => this.exclusiveHeld, draftRecovery,
      });
      const record = {
        version: 1, id: randomId(this.cryptoProvider), backup: canonical(backup), prepared,
        writes: 0, direction: 'forward', phase: 'applying', finishedAt: null,
      };
      const found = await checkRecord(record, this.cryptoProvider);
      // The journal, read back whole, before the marker that relies on it.
      await this.journal.begin(record);
      const stored = await this.journal.read().catch(() => null);
      if (!stored || canonical(stored) !== canonical(record)) {
        await this.removeJournal().catch(() => {});
        throw new Error('The recovery copy could not be saved, so nothing was replaced.');
      }
      this.verified = record;
      try { this.markOwn(`active:${record.id}`); }
      catch (error) {
        await this.removeJournal().catch(() => {});
        throw error;
      }
      try {
        await this.apply(found, record, 'forward');
      } catch (error) {
        await this.settleFailure();
        error.changed = null;
        throw error;
      }
      return { ok: true, changed: true };
    });
  }

  // A failed read here is said as one, never as a missing copy: keeping the current data acts only on
  // what was shown, and a copy that was only unreadable must still be offered when it can be read.
  async settleFailure() {
    const journal = await this.readJournal();
    const decision = decideRestoreState(readMarker(this.raw), journal, this.raw, this.clock());
    if (decision.kind === 'recovery') this.recovery = decision.recovery;
    else this.recovery = recoveryOf(journal.kind === 'unreadable' ? 'unchecked' : 'missing', journal).recovery;
  }

  // Finish and Restore prior data act only on the recovery that was shown, and only in a direction it
  // offers, decided again under the lock as keeping is. The card hides both where a recovery leaves
  // them out, but a stale or scripted call used to reach past that: during the cleanup after a finished
  // restore, Restore prior data wrote the earlier data back over the restored data (#947).
  async recover(direction) {
    if (!['forward', 'prior'].includes(direction)) return { ok: false, changed: false, error: 'Choose Finish restore or Restore prior data.' };
    const offers = (offer) => (direction === 'forward' ? offer?.canFinish : offer?.canRestorePrior) === true;
    const notOffered = direction === 'forward' ? RESTORE_MESSAGES.finishNotOffered : RESTORE_MESSAGES.priorNotOffered;
    const shown = this.recovery;
    if (!offers(shown)) return { ok: false, changed: false, error: notOffered };
    return this.withExclusive(async () => {
      const marker = readMarker(this.raw);
      const found = await this.readJournal();
      if (found.kind === 'unreadable') {
        await this.settleFailure();
        throw new Error('The recovery copy could not be checked just now, so nothing was replaced. Reload the page to try again.');
      }
      if (found.kind !== 'valid' || (marker.state !== 'absent' && marker.state !== 'done' && marker.id !== found.record.id)) {
        await this.settleFailure();
        throw new Error('The recovery copy does not match this restore, so nothing was replaced.');
      }
      const check = classify(this.raw, found);
      if (check.foreign) {
        await this.settleFailure();
        throw new Error('Saved data changed after the restore stopped, so it was not replaced. Download the exact prior copy, then keep the data that is here now.');
      }
      // Where the fresh decision offers something else, its choices are shown instead. Where it offers
      // no choice at all, the shown one stays until keeping or a reload settles it, so a refusal here
      // never removes or rewrites anything.
      const fresh = decideRestoreState(marker, found, this.raw, this.clock());
      const offer = fresh.kind === 'recovery' ? fresh.recovery : null;
      if (!offers(offer) || offer.id !== shown.id) {
        if (offer) this.recovery = offer;
        throw new Error(notOffered);
      }
      const record = { ...found.record, direction, phase: 'applying', finishedAt: null };
      await this.checkpoint(record);
      this.markOwn(`active:${record.id}`);
      try {
        await this.apply(found, record, direction);
      } catch (error) {
        await this.settleFailure();
        error.changed = null;
        throw error;
      }
      this.recovery = null;
      return { ok: true, changed: true };
    });
  }

  // The exit when automatic recovery refuses: the data that is here is kept as it is, not one byte of
  // it written, and the recovery copy and marker go in cleanup order. It is decided again under the
  // lock and acts only on the recovery that was shown. A copy that has become readable since, or an
  // offer that never included keeping, is shown again rather than deleted unseen.
  async keepCurrent() {
    const shown = this.recovery;
    return this.withExclusive(async () => {
      const journal = await this.readJournal();
      const fresh = decideRestoreState(readMarker(this.raw), journal, this.raw, this.clock());
      if (fresh.kind !== 'recovery') {
        // Nothing waits for a choice any more; whatever upkeep that leaves is finished here. Upkeep that
        // fails leaves saving paused with the choices that were shown, and upkeep that uncovers another
        // restore's journal shows that journal's choices rather than ending recovery over it. A copy that
        // cannot be removed is the exception: it waits for a later start, and the pause ends.
        try { await this.act(fresh, { inside: true }); }
        catch (error) {
          if (error?.copyKept) {
            this.leaveCopyForLater();
            return { ok: true, changed: false, copyKept: true };
          }
          this.recovery = shown ?? (fresh.wait ? recoveryOf('cleanup', { kind: 'absent' }).recovery : null);
          throw error;
        }
        if (this.recovery) throw new Error(RESTORE_MESSAGES.copyChanged);
        return { ok: true, changed: false };
      }
      const offer = fresh.recovery;
      if (!shown || offer.id !== shown.id || offer.download !== shown.download) {
        this.recovery = offer;
        throw new Error(offer.download === 'prior' && shown?.download !== 'prior' ? RESTORE_MESSAGES.copyReadable : RESTORE_MESSAGES.copyChanged);
      }
      if (!offer.canKeep) {
        this.recovery = offer;
        throw new Error(RESTORE_MESSAGES.keepNotOffered);
      }
      // A journal IndexedDB cannot read is left for a later start rather than guessed at, and so is one
      // it can read but not remove, once its cleaning: marker says so.
      if (journal.kind === 'unreadable') this.clearOverUnchecked();
      else {
        try { await this.cleanUp(offer.id ?? readMarker(this.raw).id ?? NO_ID); }
        catch (error) {
          if (!error?.copyKept) throw error;
          this.leaveCopyForLater();
          return { ok: true, changed: false, copyKept: true };
        }
      }
      this.recovery = null;
      return { ok: true, changed: false };
    });
  }

  async exportPrior() {
    const found = await this.readJournal();
    if (found.kind === 'valid') {
      return JSON.stringify({
        format: PRIOR_COPY_FORMAT, version: 1, verified: true, restoreId: found.record.id,
        values: found.record.prepared.before, retainedDraftSources: found.record.prepared.owners[3].retainedSources,
      }, null, 2);
    }
    if (found.kind === 'invalid') {
      try { return JSON.stringify({ format: PRIOR_COPY_FORMAT, version: 1, verified: false, record: found.raw }, null, 2); }
      catch { /* falls through to the refusal */ }
    }
    throw new Error('There is no recovery copy this browser can read.');
  }

  // Erase works in every state. While a recovery is pending it takes the exclusive lock and may write
  // past the pause; otherwise it runs as it always has. Either way the user data goes first, then any
  // recovery copy and marker, in cleanup order. It waits for this tab's own restore, which already
  // holds the lock while it prepares and could otherwise have its journal removed from under it.
  async erase(operation) {
    if (this.busy) return { ok: false, erased: false, error: RESTORE_MESSAGES.busy };
    if (this.stale) return { ok: false, erased: false, error: RESTORE_MESSAGES.reloading };
    const marker = readMarker(this.raw);
    const pending = Boolean(this.recovery) || ['active', 'cleaning', 'invalid', 'unreadable'].includes(marker.state);
    if (this.otherTab) return { ok: false, erased: false, error: RESTORE_MESSAGES.otherTab };
    const run = async () => {
      this.writeScope += 1;
      let erased;
      try { erased = await operation(); }
      finally { this.writeScope -= 1; }
      if (erased !== true) return { ok: true, erased: false, copyRemoved: false };
      const held = readMarker(this.raw);
      const found = this.journal?.available ? await this.readJournal() : { kind: 'absent' };
      // A journal that could not be read is left where it is, and the report says so. Its marker goes
      // only when it would pause every start; done: and cleaning: stay with it for a later start.
      if (found.kind === 'unreadable') {
        try { if (this.clearOverUnchecked()) this.recovery = null; }
        catch (error) { return { ok: true, erased: true, copyRemoved: false, error: `${RESTORE_MESSAGES.copyUnchecked} ${error.message}` }; }
        return { ok: true, erased: true, copyRemoved: false, error: RESTORE_MESSAGES.copyUnchecked };
      }
      if (held.state === 'absent' && found.kind === 'absent') return { ok: true, erased: true, copyRemoved: false };
      try {
        const present = found.kind === 'valid' || found.kind === 'invalid';
        const id = found.kind === 'valid' ? found.record.id : held.id ?? NO_ID;
        await this.cleanUp(id, { journal: present });
        this.recovery = null;
        return { ok: true, erased: true, copyRemoved: present };
      } catch (error) {
        if (error?.copyKept) this.leaveCopyForLater();
        return { ok: true, erased: true, copyRemoved: false, error: error.message };
      }
    };
    if (!pending) {
      const result = await run();
      this.refresh();
      return result;
    }
    return this.withExclusive(run);
  }

  // Whether erasing would also remove a recovery copy, for the erase question: true, false, or null
  // when the journal could not be read, which the question says as a check it could not make. Asked of
  // the journal itself, as erase does, because a marker or an earlier recovery alone can promise a copy
  // that erase then cannot remove.
  async recoveryCopyHeld() {
    const found = await this.readJournal();
    if (found.kind === 'unreadable') return this.journal?.available ? null : false;
    return found.kind === 'valid' || found.kind === 'invalid';
  }
}

export { NO_ID as NO_RESTORE_ID };
