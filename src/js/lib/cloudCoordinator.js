// The cloud backup coordinator: every saved change reaches it, and it decides when the newest complete
// state goes to the person's own cloud account. It owns timing and nothing else. What a backup holds is
// the complete backup file of completeBackup.js; how a backup is stored remotely (streams, generations,
// read-back, pruning) belongs to the protocol it is handed. So this file never sees a provider or a token.
//
// Three facts decide its shape, each read or measured rather than assumed (#810, P02-T02):
//
// * Every owner of saved data writes through one storage object, the complete-restore guard made at the
//   top of main.js: the reading data, completion history and import draft stores, the settings and the
//   sidebar. One observer wrapped around that object therefore sees every saved change, from every
//   writer present or future, with no flag to keep in step at each call site. A complete restore writes
//   past it and then reloads the page, and the comparison every start makes covers that.
// * Whether there is anything to back up is decided by content, never by which code saved: the digest of
//   the complete backup with the active list left out. Opening another list saves which list is open,
//   and that is the one change in the file a person does not make on purpose. Metadata the app fetches
//   for an issue is saved reading data and is backed up, as before this work.
// * OneDrive puts every delete this app may make into the person's recycle bin for up to 30 days, pruning
//   included (Microsoft Graph's delete reference, retrieved 2026-10-28), so each backup beyond the newest
//   two leaves one superseded file there. Backups therefore wait ten quiet seconds, run at most once every
//   five minutes, and run at once when the page is hidden, so a reading session costs a few files an hour.

import { CAPTURE_KEYS, canonical } from './completeBackup.js';

export const CLOUD_BACKUP_CADENCE = Object.freeze({
  quietMs: 10_000,
  minIntervalMs: 5 * 60_000,
  maxWaitMs: 10 * 60_000,
  retryMs: Object.freeze([5_000, 15_000, 60_000, 5 * 60_000]),
  recheckMs: 5_000,
});
const WORKER_LOCK = 'mrt.cloud-backup.worker.v1';
const MAX_TIMER_MS = 2_147_483_647;
// Refusals from a capture that a later save clears by itself: an import still being saved, or source
// the import draft could not save. Retrying on a timer would only refuse again.
const WAIT_FOR_CHANGE = new Set(['pending', 'unsaved']);
// Refusals no amount of waiting fixes without a change: the saved data cannot be read or is too large.
const STOP_UNTIL_CHANGE = new Set(['unreadable', 'storage', 'oversize', 'unsupported', 'hash', 'invalid', 'refused']);

// Wraps the storage every owner writes through. Reads pass straight through. A write to a key a backup
// holds is passed on first and reported only once the browser has accepted it, so a write that throws
// reports nothing, and a listener that throws cannot change the outcome of a save.
export function observeSavedWrites(storage, onWrite, keys = CAPTURE_KEYS) {
  if (!storage) return storage;
  const watched = new Set(keys);
  const report = (key) => {
    if (key !== null && !watched.has(key)) return;
    try { onWrite(key); } catch { /* observation never owns a save */ }
  };
  return {
    get length() { return storage.length; },
    key: (index) => storage.key(index),
    getItem: (key) => storage.getItem(key),
    setItem(key, value) { storage.setItem(key, value); report(key); },
    removeItem(key) { storage.removeItem(key); report(key); },
    clear() { storage.clear(); report(null); },
  };
}

// The point main.js reports saved changes to. Nothing listens until cloud backup is turned on, so a
// build without it does no more than call an empty set.
export function createSavedChanges() {
  const listeners = new Set();
  return {
    notify(key = null) {
      for (const listener of listeners) {
        try { listener(key); } catch { /* one listener cannot stop another */ }
      }
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

async function sha256(text, cryptoProvider) {
  const hash = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(hash)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

// The digest that decides whether a backup is due: the complete backup's components with the active
// list left out, in the canonical form the backup's own digest uses.
export async function personalDigest(backup, cryptoProvider = globalThis.crypto) {
  const { reader, ...rest } = backup.components;
  const personal = { ...reader };
  delete personal.active;
  return sha256(canonical({ ...rest, reader: personal }), cryptoProvider);
}

export class CloudBackupCoordinator {
  // capture: resolves to { text, backup } for the newest saved state, or throws with a code.
  // lastUploaded: resolves to { personalDigest, uploadedAt } for this installation's newest verified
  //   backup, or null. It is read at every run, because another tab may have made one meanwhile.
  // upload: stores one backup and resolves only once that record says so. It may throw an error with
  //   code 'needs-sign-in' or 'refused', or any other error, which is retried: a backup is written once
  //   and never overwrites another, so a retry after a lost reply costs a file, never a backup.
  constructor({
    capture, upload, lastUploaded,
    isBlocked = () => false,
    isOnline = () => globalThis.navigator?.onLine !== false,
    isHidden = () => globalThis.document?.visibilityState === 'hidden',
    locks = globalThis.navigator?.locks, events = globalThis, clock = Date.now,
    setTimer = (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimer = (timer) => globalThis.clearTimeout(timer),
    cryptoProvider = globalThis.crypto, cadence = CLOUD_BACKUP_CADENCE, onChange = () => {},
  } = {}) {
    if ([capture, upload, lastUploaded, isBlocked, isOnline, isHidden, clock, setTimer, clearTimer, onChange]
      .some((value) => typeof value !== 'function')) {
      throw new TypeError('Cloud backup needs a capture, an upload, its record and its schedule owners.');
    }
    Object.assign(this, {
      capture, upload, lastUploaded, isBlocked, isOnline, isHidden, clock, setTimer, clearTimer, cryptoProvider, cadence, onChange,
    });
    this.locks = typeof locks?.request === 'function' ? locks : null;
    this.events = events;
    this.watched = new Set(CAPTURE_KEYS);
    this.active = false;
    this.epoch = 0;
    this.timer = null;
    this.running = null;
    this.idlePromise = Promise.resolve();
    this.resetSchedule();
    this.state = Object.freeze({ phase: 'off', code: null, retryAt: null, lastUploadAt: null });
    this.listeners = {
      storage: (event) => { if (event?.key === null || this.watched.has(event?.key)) this.notify(); },
      online: () => this.resume(),
      visibilitychange: () => this.pageHidden(),
    };
  }

  resetSchedule() {
    this.dirty = false;
    this.changes = 0;
    this.changedAt = 0;
    this.dirtySince = 0;
    this.lastUploadAt = 0;
    this.retryAt = 0;
    this.recheckAt = 0;
    this.retries = 0;
    this.flushing = false;
    this.waiting = null;
    this.halted = null;
    this.code = null;
    this.saving = false;
  }

  // Turned on for this installation: connected, and this installation's consent recorded. The first run
  // compares the newest state with the newest backup, which covers whatever was saved while it was off,
  // in another tab, or by a complete restore.
  start() {
    if (this.active) return;
    this.active = true;
    this.epoch += 1;
    this.resetSchedule();
    for (const [type, listener] of Object.entries(this.listeners)) this.events?.addEventListener?.(type, listener);
    this.markDirty();
    this.schedule();
  }

  // Disconnected, consent withdrawn, or erased: nothing more is captured or sent, and a run already under
  // way finishes without changing anything here.
  stop() {
    if (!this.active) return;
    this.active = false;
    this.epoch += 1;
    for (const [type, listener] of Object.entries(this.listeners)) this.events?.removeEventListener?.(type, listener);
    this.cancelTimer();
    this.running?.controller.abort();
    this.running = null;
    this.resetSchedule();
    this.publish();
  }

  // A saved change of anything a backup holds, from this tab's observer or another tab's storage event.
  notify() {
    if (!this.active) return;
    this.markDirty();
    if (this.halted && this.halted !== 'needs-sign-in') this.halted = null;
    if (this.waiting && WAIT_FOR_CHANGE.has(this.waiting)) this.waiting = null;
    this.schedule();
  }

  // Back online, saving resumed, or anything else that may have cleared a wait.
  resume() {
    if (!this.active) return;
    this.waiting = null;
    this.recheckAt = 0;
    this.schedule();
  }

  // The person asked, or signed in again: whatever stopped backups is tried again now.
  retry() {
    if (!this.active) return;
    this.halted = null;
    this.waiting = null;
    this.recheckAt = 0;
    this.retryAt = 0;
    this.retries = 0;
    this.markDirty();
    this.flushing = true;
    this.schedule();
  }

  pageHidden() {
    if (!this.active || !this.isHidden() || !this.dirty) return;
    this.flushing = true;
    this.schedule();
  }

  markDirty() {
    const now = this.clock();
    if (!this.dirty) this.dirtySince = now;
    this.dirty = true;
    this.changes += 1;
    this.changedAt = now;
  }

  idle() { return this.idlePromise; }

  cancelTimer() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  dueAt() {
    const { quietMs, minIntervalMs, maxWaitMs } = this.cadence;
    const settled = this.flushing ? this.clock() : Math.min(this.changedAt + quietMs, this.dirtySince + maxWaitMs);
    const spaced = this.flushing ? 0 : this.lastUploadAt + minIntervalMs;
    return Math.max(settled, spaced, this.retryAt, this.waiting ? this.recheckAt : 0);
  }

  schedule() {
    this.cancelTimer();
    if (this.active && this.dirty && !this.halted && !this.running && !(this.waiting && WAIT_FOR_CHANGE.has(this.waiting))) {
      const delay = Math.min(MAX_TIMER_MS, Math.max(0, this.dueAt() - this.clock()));
      this.timer = this.setTimer(() => {
        this.timer = null;
        this.idlePromise = this.work();
      }, delay);
    }
    this.publish();
  }

  current(run) { return this.active && run.epoch === this.epoch; }

  async withWorker(run, operation) {
    if (!this.locks) return operation();
    return this.locks.request(WORKER_LOCK, { mode: 'exclusive', signal: run.controller.signal }, operation);
  }

  async work() {
    if (!this.active || !this.dirty || this.halted || this.running) return;
    const run = { epoch: this.epoch, controller: new AbortController() };
    this.running = run;
    this.waiting = null;
    this.recheckAt = 0;
    this.code = null;
    try {
      // Checked before the lock and again inside it: a complete restore or recovery that holds saving
      // paused may be about to replace everything a capture would read.
      if (this.isBlocked()) { this.wait('paused'); return; }
      if (!this.isOnline()) { this.wait('offline'); return; }
      await this.withWorker(run, async () => {
        if (!this.current(run)) return;
        if (this.isBlocked()) { this.wait('paused'); return; }
        const seen = this.changes;
        const snapshot = await this.capture();
        if (!this.current(run)) return;
        const digest = await personalDigest(snapshot.backup, this.cryptoProvider);
        const last = await this.lastUploaded();
        if (!this.current(run)) return;
        if (Number.isFinite(last?.uploadedAt)) this.lastUploadAt = Math.max(this.lastUploadAt, last.uploadedAt);
        if (last?.personalDigest !== digest) {
          // Another tab of this installation may have uploaded meanwhile, so the interval is measured
          // from the shared record, not from this tab's memory.
          if (!this.flushing && this.clock() < this.lastUploadAt + this.cadence.minIntervalMs) return;
          this.saving = true;
          this.publish();
          // Spacing counts backups that were made, never attempts: a retry follows its own backoff.
          const startedAt = this.clock();
          await this.upload({ text: snapshot.text, backup: snapshot.backup, personalDigest: digest });
          if (!this.current(run)) return;
          this.lastUploadAt = Math.max(this.lastUploadAt, startedAt);
        }
        this.retries = 0;
        this.retryAt = 0;
        this.flushing = false;
        if (this.changes === seen) this.dirty = false;
      });
    } catch (error) {
      if (this.current(run)) this.failed(error);
    } finally {
      if (this.running === run) this.running = null;
      if (this.current(run)) {
        this.saving = false;
        this.schedule();
      }
    }
  }

  wait(code) {
    this.waiting = code;
    // Saving paused for a complete restore ends in a reload or within seconds, and the browser's online
    // event is not always sent, so both are looked at again on a timer rather than waited on blind.
    this.recheckAt = this.clock() + (code === 'offline' ? this.cadence.retryMs.at(-1) : this.cadence.recheckMs);
  }

  failed(error) {
    const code = typeof error?.code === 'string' ? error.code : null;
    if (code === 'raced') {
      this.code = code;
      this.retryAt = this.clock() + this.cadence.recheckMs;
      return;
    }
    if (WAIT_FOR_CHANGE.has(code)) { this.waiting = code; return; }
    if (code === 'needs-sign-in') { this.halted = code; return; }
    if (STOP_UNTIL_CHANGE.has(code)) { this.halted = 'failed'; this.code = code; return; }
    // Anything else is retried, and each wait is at least as long as the provider asked for.
    const delay = this.cadence.retryMs[Math.min(this.retries, this.cadence.retryMs.length - 1)];
    this.retries += 1;
    const asked = Number.isSafeInteger(error?.retryAfterMs) && error.retryAfterMs > 0 ? error.retryAfterMs : 0;
    this.code = code ?? 'transient';
    this.retryAt = this.clock() + Math.max(delay, asked);
  }

  publish() {
    let phase;
    let code = null;
    if (!this.active) phase = 'off';
    else if (this.halted === 'needs-sign-in') phase = 'needs-sign-in';
    else if (this.halted) { phase = 'failed'; code = this.code; }
    else if (this.saving) phase = 'saving';
    else if (this.waiting) { phase = 'waiting'; code = this.waiting; }
    else if (this.retryAt > this.clock()) { phase = 'retrying'; code = this.code; }
    else if (this.dirty) phase = 'pending';
    else phase = 'up-to-date';
    const next = {
      phase, code,
      retryAt: phase === 'retrying' ? this.retryAt : phase === 'waiting' ? this.recheckAt || null : null,
      lastUploadAt: this.lastUploadAt || null,
    };
    if (Object.keys(next).every((key) => next[key] === this.state[key])) return;
    this.state = Object.freeze(next);
    try { this.onChange(this.state); } catch { /* a view's failure cannot change the schedule */ }
  }
}
