// The cloud backup protocol: how backups are kept in the person's own cloud account, the same for every
// platform and provider (#810, P02-T03). Below it is a transport with four operations on the app's own
// area of the account, list, read, create and delete, which the Windows host, the Android app or a
// native iOS provider can each supply. Above it is the coordinator, which decides when. Neither one ever
// holds a token.
//
// Nothing is ever overwritten. Each browser owns a random stream id and a generation counter, and every
// backup creates a new file named for both, so a request that lands late, or twice, can only add an
// older generation and never replace a newer one. That rests on one fact alone: a browser never uses a
// generation number twice. A provider refusing a duplicate name is a backstop nothing relies on, because
// Google Drive allows duplicate names and a refused duplicate on OneDrive has not been observed.
//
// So the counter is kept in IndexedDB with strict durability, and each increment is committed and read
// back before the file it numbers is created. Chromium commits localStorage in batches at least five
// seconds apart and a killed browser loses the batch (Complete backups, docs/ARCHITECTURE.md), which
// here would hand the same number out twice.
//
// Files are compressed. A synthetic complete backup of 1,433,058 bytes built from the vendored catalog
// gzips to 164,166, 8.7 times smaller (measured 2026-10-28), and OneDrive keeps every file this app
// deletes in the person's recycle bin for up to 30 days. Compressed is not encrypted: the owner chose
// backups the provider can read, protected by the person's own account.

import { CLOUD_BACKUP_DATABASE, CLOUD_BACKUP_LOCK } from '../storage.js';
import { MAX_COMPLETE_BACKUP_BYTES, canonical, completeBackupSummary, parseCompleteBackup } from './completeBackup.js';
import { personalDigest as digestPersonalBackup } from './cloudSync.js';

export const CLOUD_ENVELOPE_FORMAT = 'recap-page-cloud-backup';
export const CLOUD_ENVELOPE_VERSION = 1;
// Applied to the uncompressed envelope, which is the complete backup and a few hundred bytes more, before
// anything is compressed. Discovery stops decompressing at the same figure, so it can read whatever was
// uploaded.
export const MAX_CLOUD_BACKUP_BYTES = MAX_COMPLETE_BACKUP_BYTES;
// One delete a backup keeps pace with one new file. The second lets a backup also remove a file that a
// lost reply, or a page closed part way through a backup, left behind; with one, each such file would
// stay for good.
export const CLOUD_PRUNE_PER_BACKUP = 2;
// What discovery reads at most: the newest streams first, and in each, files until two pass.
export const CLOUD_DISCOVERY_LIMITS = Object.freeze({ streams: 16, readsPerStream: 4, retainedReads: 16 });
// The longest each transport operation may take, which every provider stays within. A read or a create
// moves at most 32 MiB, and ten minutes carries that at 56 KB a second, a slow mobile link. A list may
// follow many pages, and on the Windows host it first waits for a create still under way. The engine
// waits the grace beyond each, for the reply to arrive, and then treats the operation as timed out.
export const CLOUD_TRANSPORT_DEADLINES_MS = Object.freeze({ list: 120_000, read: 600_000, create: 600_000, delete: 30_000 });
export const CLOUD_DEADLINE_GRACE_MS = 15_000;

const NAME = /^recap-page-backup-v1-([a-f0-9]{32})-([1-9][0-9]{0,15})\.json\.gz$/;
const KEPT_NAME = /^recap-page-kept-v1-([a-f0-9]{32})-([1-9][0-9]{0,15})-([a-f0-9]{32})\.json\.gz$/;
const STREAM = /^[a-f0-9]{32}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const PROVIDER = /^[a-z][a-z0-9-]{0,31}$/;
const RECORD_STORE = 'stream';
const RECORD_SLOT = 'record';
const SYNC_SLOT = 'sync';
const SYNC_GATE_SLOT = 'sync-gate';
const SYNC_DECLINES_SLOT = 'sync-declines';
const KEPT_WITNESS_SLOT = 'kept-history';
const KEPT_LEDGER_SLOT = 'kept-ledger';
const KEPT_PENDING_SLOT = 'kept-pending';
const RECORD_OPEN_MS = 5000;
const KEPT_LIMIT = 3;
const KEPT_LOCKED = Symbol('kept copy worker lock');
const KEPT_RETRY_WAIT_MS = CLOUD_TRANSPORT_DEADLINES_MS.create;
const KEPT_STALE_RESERVATION_MS = 60 * 60 * 1000;
const KEPT_CLEANUP_WAIT_MS = 1000;
// suspended holds consent an erase has set aside until it forgets or restores the record (S3a-7).
const RECORD_FIELDS = ['consent', 'device', 'nextGeneration', 'stream', 'suspended', 'validated', 'version'];
const SYNC_FIELDS = ['connection', 'consentId', 'declinedDigest', 'kept', 'matchedDigest', 'stream', 'version'];
const SYNC_GATE_FIELDS = ['connection', 'consentId', 'epoch', 'held', 'stream', 'version'];
const SYNC_DECLINES_FIELDS = ['connection', 'consentId', 'entries', 'stream', 'version'];
const KEPT_FIELDS = ['byteDigest', 'connection', 'contentDigest', 'generation', 'id', 'name', 'personalDigest', 'stream'];
const KEPT_LEDGER_FIELDS = ['entries', 'next', 'stream', 'version'];
const KEPT_ENTRY_FIELDS = [
  'byteDigest', 'changedOutside', 'connection', 'contentDigest', 'deleting', 'generation', 'id', 'name', 'order',
  'personalDigest', 'provider', 'reservedAt', 'size', 'staleAbsent', 'stream', 'verified',
];
// The id is random for every consent, so an acknowledgement can tell consent given again from the consent
// its backup was made under, even for the same connection in the same millisecond (stage 1 review, L1).
const CONSENT_FIELDS = ['at', 'connection', 'id', 'provider'];
const VERIFIED_FIELDS = ['generation', 'personalDigest', 'uploadedAt'];
const ENVELOPE_FIELDS = ['backup', 'createdAt', 'device', 'format', 'generation', 'stream', 'version'];
const DEFAULT_DEVICE = 'Recap Page';
const MAX_DEVICE_CHARACTERS = 64;
const INFLATE_SLICE = 1024;
const NOT_ON = 'Cloud backup is not turned on for this browser, so nothing was uploaded.';
// Refusals that every later delete in the same account would meet too.
const STOPS_DELETION = new Set(['needs-sign-in', 'needs-consent', 'not-connected', 'storage']);

export class CloudBackupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CloudBackupError';
    this.code = code;
  }
}

function refuse(message, code) { throw new CloudBackupError(message, code); }
function cleanupStopped(signal) {
  if (signal?.aborted) refuse('Saved-copy cleanup will be retried.', 'cleanup-stopped');
}
function waitForCleanup(operation, signal) {
  cleanupStopped(signal);
  return new Promise((resolve, reject) => {
    const stop = () => reject(new CloudBackupError('Saved-copy cleanup will be retried.', 'cleanup-stopped'));
    signal.addEventListener('abort', stop, { once: true });
    operation.then(
      (value) => { signal.removeEventListener('abort', stop); resolve(value); },
      (error) => { signal.removeEventListener('abort', stop); reject(error); },
    );
  });
}
// A record failure can stop any operation, so these say only what went wrong, and each operation adds what
// that left undone. None claims an outcome its operation did not have (stage 1 review, L3).
const RECORD_LOST = 'This browser could not keep its cloud backup record.';
const RECORD_UNREADABLE = 'This browser\'s cloud backup record cannot be read.';
const SYNC_UNREADABLE = 'This browser\'s cloud sync record cannot be read, so its saved copies were kept.';
const KEPT_UNREADABLE = 'This browser\'s saved cloud-copy record cannot be read, so its saved copies were kept.';
const KEPT_UNCONFIRMED = 'The cloud copy could not be confirmed, so nothing was loaded and this device\'s data is unchanged. Try again.';
const KEPT_CHANGED = 'A saved cloud copy changed outside the app or could not be checked, so it was not deleted. Check it in your cloud folder.';
// A backup's number another copy of this record already used, by the provider's refusal or a second item
// under the same name.
const TAKEN = 'A backup with this number was already in the account, perhaps made by a device restored from this one, so this browser now starts its backups afresh, and this one will be made again.';
const recordLost = () => new CloudBackupError(RECORD_LOST, 'storage');
// A record that is there but fails its checks, as against one the browser could not read at all: turning
// cloud backup on replaces the first with a new stream, and may find the second intact (stage 3 review,
// S3b-7).
export function isUnreadableRecord(error) {
  return error instanceof CloudBackupError && error.message === RECORD_UNREADABLE;
}
// A saved-copy record that is there but fails its checks, as against a read that failed outright, which
// cannot say whether there is a record at all.
export function isUnreadableKeptLedger(error) {
  return error instanceof CloudBackupError && error.message === KEPT_UNREADABLE;
}
async function saying(consequence, operation) {
  try { return await operation(); }
  catch (error) {
    if (error instanceof CloudBackupError && error.code === 'storage') throw new CloudBackupError(`${error.message} ${consequence}`, 'storage');
    throw error;
  }
}
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function exactFields(value, fields) { return object(value) && Object.keys(value).sort().join(',') === fields.join(','); }
function nonNegative(value) { return Number.isSafeInteger(value) && value >= 0; }
function controlFree(text) {
  return [...text].every((character) => {
    const code = character.codePointAt(0);
    return code > 0x1f && (code < 0x7f || code > 0x9f);
  });
}
function validConnection(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 128 && controlFree(value);
}
function hex(bytes) { return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join(''); }
const mebibytes = (bytes) => bytes / (1024 * 1024);
// The connection a page names for discovery, a restore or a deletion, as the host reported it.
function connectionOf(value) {
  if (!validConnection(value)) {
    refuse('No cloud connection was named, so nothing was read or changed.', 'invalid');
  }
  return value;
}

// ------------------------------------------------------------------ names and labels

export function cloudBackupName(stream, generation) {
  return `recap-page-backup-v1-${stream}-${generation}.json.gz`;
}

// The stream and generation a name this version writes carries, or null. The name also declares the
// format and its gzip compression, so nothing is ever decoded by guessing.
export function parseCloudBackupName(name) {
  const match = typeof name === 'string' ? NAME.exec(name) : null;
  if (!match) return null;
  const generation = Number(match[2]);
  return Number.isSafeInteger(generation) ? { stream: match[1], generation } : null;
}

function keptBackupName(stream, generation, id) {
  return `recap-page-kept-v1-${stream}-${generation}-${id}.json.gz`;
}

function parseKeptBackupName(name) {
  const match = typeof name === 'string' ? KEPT_NAME.exec(name) : null;
  if (!match) return null;
  const generation = Number(match[2]);
  return Number.isSafeInteger(generation) ? { stream: match[1], generation } : null;
}

function validDevice(value) {
  if (typeof value !== 'string' || value !== value.trim()) return false;
  const length = [...value].length;
  return length > 0 && length <= MAX_DEVICE_CHARACTERS && controlFree(value);
}

// What other devices see in discovery. Display only: it decides nothing.
export function cloudDeviceLabel(value) {
  const text = typeof value === 'string'
    ? [...value.replace(/\s+/g, ' ').trim()].slice(0, MAX_DEVICE_CHARACTERS).join('').trim() : '';
  return validDevice(text) ? text : DEFAULT_DEVICE;
}

// ------------------------------------------------------------------ the record

function validConsent(value) {
  return exactFields(value, CONSENT_FIELDS) && validConnection(value.connection)
    && typeof value.provider === 'string' && PROVIDER.test(value.provider) && nonNegative(value.at)
    && typeof value.id === 'string' && STREAM.test(value.id);
}

function validVerified(value, nextGeneration) {
  return exactFields(value, VERIFIED_FIELDS) && Number.isSafeInteger(value.generation) && value.generation >= 1
    && value.generation < nextGeneration && typeof value.personalDigest === 'string'
    && DIGEST.test(value.personalDigest) && nonNegative(value.uploadedAt);
}

// A record failing any of these checks is never trusted for a number, because reusing one is the single
// thing this protocol cannot survive.
function checkRecord(value) {
  const valid = exactFields(value, RECORD_FIELDS) && value.version === 1
    && typeof value.stream === 'string' && STREAM.test(value.stream)
    && Number.isSafeInteger(value.nextGeneration) && value.nextGeneration >= 1 && validDevice(value.device)
    && (value.consent === null || validConsent(value.consent))
    && (value.suspended === null || (value.consent === null && validConsent(value.suspended)))
    && Array.isArray(value.validated) && value.validated.length <= 2
    && value.validated.every((entry) => validVerified(entry, value.nextGeneration))
    && (value.validated.length < 2 || value.validated[0].generation > value.validated[1].generation);
  if (!valid) refuse(RECORD_UNREADABLE, 'storage');
  return value;
}

function validDigest(value) {
  return typeof value === 'string' && DIGEST.test(value);
}

function validKept(kept) {
  const name = parseKeptBackupName(kept?.name);
  return exactFields(kept, KEPT_FIELDS) && validConnection(kept.connection)
    && typeof kept.stream === 'string' && STREAM.test(kept.stream)
    && Number.isSafeInteger(kept.generation) && kept.generation >= 1 && validDigest(kept.personalDigest)
    && validDigest(kept.contentDigest) && validDigest(kept.byteDigest) && typeof kept.id === 'string' && kept.id.length > 0
    && name?.stream === kept.stream && name.generation === kept.generation;
}

function keptReference(entry) {
  const { connection, stream, generation, personalDigest, contentDigest, byteDigest, id, name } = entry;
  return { connection, stream, generation, personalDigest, contentDigest, byteDigest, id, name };
}

function validKeptEntry(entry) {
  const name = parseKeptBackupName(entry?.name);
  return exactFields(entry, KEPT_ENTRY_FIELDS) && validConnection(entry.connection)
    && typeof entry.provider === 'string' && PROVIDER.test(entry.provider)
    && typeof entry.stream === 'string' && STREAM.test(entry.stream)
    && Number.isSafeInteger(entry.generation) && entry.generation >= 1
    && validDigest(entry.personalDigest) && validDigest(entry.contentDigest) && validDigest(entry.byteDigest)
    && (entry.id === null || (typeof entry.id === 'string' && entry.id.length > 0))
    && typeof entry.verified === 'boolean' && (!entry.verified || entry.id !== null)
    && typeof entry.changedOutside === 'boolean'
    && typeof entry.deleting === 'boolean' && (!entry.deleting || entry.id !== null)
    && typeof entry.staleAbsent === 'boolean' && (!entry.staleAbsent || entry.id === null)
    && Number.isSafeInteger(entry.size) && entry.size > 0
    && Number.isSafeInteger(entry.order) && entry.order >= 1 && nonNegative(entry.reservedAt)
    && name?.stream === entry.stream && name.generation === entry.generation;
}

function checkKeptLedger(value) {
  const valid = exactFields(value, KEPT_LEDGER_FIELDS) && value.version === 1
    && typeof value.stream === 'string' && STREAM.test(value.stream)
    && Number.isSafeInteger(value.next) && value.next >= 1 && Array.isArray(value.entries)
    && value.entries.every((entry) => validKeptEntry(entry) && entry.order < value.next)
    && new Set(value.entries.map((entry) => entry.name)).size === value.entries.length
    && new Set(value.entries.map((entry) => entry.order)).size === value.entries.length;
  if (!valid) refuse(KEPT_UNREADABLE, 'storage');
  const identities = value.entries.filter((entry) => entry.id !== null)
    .map((entry) => JSON.stringify([entry.connection, entry.id]));
  if (new Set(identities).size !== identities.length) refuse(KEPT_UNREADABLE, 'storage');
  return value;
}

function checkKeptWitness(value) {
  if (!exactFields(value, ['stream', 'unknown', 'version']) || value.version !== 1
    || typeof value.stream !== 'string' || !STREAM.test(value.stream) || typeof value.unknown !== 'boolean') {
    refuse('The kept-copy history could not be checked, so its possible copies were left alone.', 'storage');
  }
  return value;
}

function checkSyncState(value) {
  const kept = value?.kept;
  const valid = exactFields(value, SYNC_FIELDS) && value.version === 1 && validConnection(value.connection)
    && typeof value.stream === 'string' && STREAM.test(value.stream)
    && typeof value.consentId === 'string' && STREAM.test(value.consentId)
    && (value.matchedDigest === null || validDigest(value.matchedDigest))
    && (value.declinedDigest === null || validDigest(value.declinedDigest))
    && (kept === null || validKept(kept));
  if (!valid) refuse(SYNC_UNREADABLE, 'storage');
  return value;
}

function checkKeptPending(value) {
  const legacy = value?.version === 1;
  const fields = legacy
    ? ['connection', 'kept', 'stream', 'version']
    : ['connection', 'consentId', 'kept', 'previousKept', 'stream', 'targetDigest', 'version'];
  if (!exactFields(value, fields) || ![1, 2].includes(value.version)
    || !validConnection(value.connection) || typeof value.stream !== 'string' || !STREAM.test(value.stream)
    || !validKept(value.kept) || value.kept.connection !== value.connection || value.kept.stream !== value.stream
    || (!legacy && (!validDigest(value.targetDigest) || typeof value.consentId !== 'string' || !STREAM.test(value.consentId)
      || (value.previousKept !== null
      && (!validKept(value.previousKept) || value.previousKept.connection !== value.connection))))) {
    refuse('The pending cloud recovery copy could not be checked, so Go back is unavailable.', 'storage');
  }
  return value;
}

function keptPendingDetails(value) {
  return value === null ? null : {
    kept: value.kept, targetDigest: value.version === 2 ? value.targetDigest : null,
    previousKept: value.version === 2 ? value.previousKept : null,
    consentId: value.version === 2 ? value.consentId : null,
  };
}

function checkSyncGate(value) {
  const pending = value?.pending;
  const fields = pending === undefined ? SYNC_GATE_FIELDS : [...SYNC_GATE_FIELDS, 'pending'].sort();
  const pendingFields = pending?.stream === undefined ? ['intended', 'previous'] : ['intended', 'previous', 'stream'];
  const validPending = pending === undefined || (exactFields(pending, pendingFields)
    && validDigest(pending.intended) && (pending.previous === null || validDigest(pending.previous))
    && (pending.stream === undefined || (typeof pending.stream === 'string' && STREAM.test(pending.stream)
      && pending.stream !== value.stream)));
  const valid = exactFields(value, fields) && value.version === 1 && validConnection(value.connection)
    && typeof value.stream === 'string' && STREAM.test(value.stream)
    && typeof value.consentId === 'string' && STREAM.test(value.consentId)
    && typeof value.epoch === 'string' && STREAM.test(value.epoch) && typeof value.held === 'boolean'
    && validPending && (pending === undefined || value.held);
  if (!valid) refuse('The cloud sync upload hold could not be checked, so backups stay paused.', 'storage');
  return value;
}

function checkSyncDeclines(value) {
  const valid = exactFields(value, SYNC_DECLINES_FIELDS) && value.version === 1 && validConnection(value.connection)
    && typeof value.stream === 'string' && STREAM.test(value.stream)
    && typeof value.consentId === 'string' && STREAM.test(value.consentId)
    && Array.isArray(value.entries) && value.entries.every((entry, index) =>
    exactFields(entry, ['digest', 'stream']) && typeof entry.stream === 'string' && STREAM.test(entry.stream)
      && entry.stream !== value.stream && validDigest(entry.digest)
      && (index === 0 || value.entries[index - 1].stream < entry.stream));
  if (!valid) refuse('The saved cloud choices cannot be checked, so backups stay paused.', 'storage');
  return value;
}

function currentConsent(value, connection) {
  const record = value === null ? null : checkRecord(value);
  if (!record?.consent || record.consent.connection !== connection) {
    refuse('Cloud backup is not turned on for this connection, so nothing was changed.', 'needs-consent');
  }
  return record;
}

function syncContext({ connection, stream, consentId }) {
  const named = connectionOf(connection);
  if (typeof stream !== 'string' || !STREAM.test(stream)
    || typeof consentId !== 'string' || !STREAM.test(consentId)) {
    refuse('Cloud sync needs the current device and consent, so nothing was changed.', 'invalid');
  }
  return { connection: named, stream, consentId };
}

function requireSyncContext(value, context) {
  const record = currentConsent(value, context.connection);
  if (record.stream !== context.stream || record.consent.id !== context.consentId) {
    refuse('Cloud backup changed while this was being checked, so nothing was changed.', 'needs-consent');
  }
  return record;
}

function sameSyncContext(state, record) {
  return state !== null && state.connection === record.consent.connection
    && state.stream === record.stream && state.consentId === record.consent.id;
}

function storedContext(value) {
  if (value === null) return null;
  let record;
  try { record = checkRecord(value); }
  catch (error) {
    if (!isUnreadableRecord(error)) throw error;
    return null;
  }
  const consent = record.consent ?? record.suspended;
  return consent ? { connection: consent.connection, stream: record.stream, consentId: consent.id } : null;
}

function storedStream(value) {
  if (value === null) return null;
  try { return checkRecord(value).stream; }
  catch (error) {
    if (!isUnreadableRecord(error)) throw error;
    return null;
  }
}

function sameContext(left, right) {
  if (left === null || right === null) return left === right;
  return left.connection === right.connection && left.stream === right.stream && left.consentId === right.consentId;
}

function syncBelongsTo(state, context) {
  return context !== null && state.connection === context.connection
    && state.stream === context.stream && state.consentId === context.consentId;
}

// The cloud database is not a response cache, so cache cleanup never reaches its record or sync key.
// Every write asks for strict durability, so its complete event means the transaction is on disk.
export function createCloudRecordStore(factory = globalThis.indexedDB, { timeoutMs = RECORD_OPEN_MS } = {}) {
  let opening = null;
  function open() {
    if (!opening) {
      const attempt = new Promise((resolve, reject) => {
        let request;
        try { request = factory.open(CLOUD_BACKUP_DATABASE, 1); }
        catch { reject(recordLost()); return; }
        let settled = false;
        const finish = (db) => {
          if (settled) { db?.close(); return; }
          settled = true;
          clearTimeout(timer);
          if (!db) { reject(recordLost()); return; }
          // Another tab deleting the database closes this connection, and the next call opens a new one.
          db.onversionchange = () => {
            db.close();
            if (opening === attempt) opening = null;
          };
          resolve(db);
        };
        const timer = setTimeout(() => finish(null), timeoutMs);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains(RECORD_STORE)) request.result.createObjectStore(RECORD_STORE);
        };
        request.onblocked = () => finish(null);
        request.onerror = () => finish(null);
        request.onsuccess = () => finish(request.result);
      });
      opening = attempt;
      attempt.catch(() => { if (opening === attempt) opening = null; });
    }
    return opening;
  }
  async function run(mode, operation, { signal, onCommitted } = {}) {
    const db = await open();
    if (signal?.aborted) throw new CloudBackupError('The cloud choice changed. Check again.', 'raced');
    return new Promise((resolve, reject) => {
      let tx;
      try {
        try {
          tx = mode === 'readwrite' ? db.transaction(RECORD_STORE, mode, { durability: 'strict' }) : db.transaction(RECORD_STORE, mode);
        } catch (error) {
          if (error?.name === 'InvalidStateError') throw error;
          tx = db.transaction(RECORD_STORE, mode);
        }
      } catch {
        opening = null;
        reject(recordLost());
        return;
      }
      let value;
      let refusal = null;
      let cancelFailure = null;
      const cleanup = () => signal?.removeEventListener('abort', cancel);
      const cancel = () => {
        try { tx.abort(); }
        catch (error) {
          if (error?.name !== 'InvalidStateError') cancelFailure = error;
          onCommitted?.();
        }
      };
      tx.oncomplete = () => {
        cleanup();
        try {
          onCommitted?.();
          if (cancelFailure) reject(cancelFailure);
          else resolve(value);
        } catch (error) { reject(error); }
      };
      tx.onabort = () => {
        cleanup();
        reject(refusal ?? cancelFailure ?? (signal?.aborted
          ? new CloudBackupError('The cloud choice changed. Check again.', 'raced') : recordLost()));
      };
      tx.onerror = tx.onabort;
      if (signal?.aborted) { cancel(); return; }
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        operation(tx.objectStore(RECORD_STORE), {
          set: (result) => { value = result; },
          refuse: (error) => {
            refusal = error;
            try { tx.abort(); }
            catch (abortError) {
              if (abortError?.name !== 'InvalidStateError') {
                cleanup();
                reject(abortError);
              }
            }
          },
        });
      } catch {
        cleanup();
        try { tx.abort(); } catch { /* already finished */ }
        reject(recordLost());
      }
    });
  }
  return {
    available: typeof factory?.open === 'function',
    read: () => run('readonly', (store, { set }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => set(request.result ?? null);
    }),
    // The change is decided inside the transaction that writes it, so no other tab can come between the
    // read and the write.
    write: (change) => run('readwrite', (store, { set, refuse: stop }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => {
        const before = request.result ?? null;
        const sync = store.get(SYNC_SLOT);
        const key = store.getKey(SYNC_SLOT);
        const kept = store.get(KEPT_LEDGER_SLOT);
        const keptKey = store.getKey(KEPT_LEDGER_SLOT);
        keptKey.onsuccess = () => {
          let after;
          try {
            after = change(before);
            if (after === undefined) { set({ before, after: before }); return; }
            const previous = storedContext(before);
            const next = storedContext(after);
            if (!sameContext(previous, next)) store.delete(SYNC_DECLINES_SLOT);
            if (key.result !== undefined && !sameContext(previous, next)) {
              if (!previous || !next) store.delete(SYNC_SLOT);
              else {
                const state = checkSyncState(sync.result ?? null);
                if (!syncBelongsTo(state, previous) || before.consent === null) store.delete(SYNC_SLOT);
                else store.put({
                  ...state, ...next, matchedDigest: null, declinedDigest: null,
                  kept: state.kept?.connection === next.connection ? state.kept : null,
                }, SYNC_SLOT);
              }
            }
            if (keptKey.result !== undefined) {
              const priorStream = storedStream(before);
              const nextStream = storedStream(after);
              if (!priorStream || !nextStream) store.delete(KEPT_LEDGER_SLOT);
              else {
                let ledger;
                try { ledger = checkKeptLedger(kept.result); }
                catch (error) {
                  if (!(error instanceof CloudBackupError) || error.message !== KEPT_UNREADABLE) throw error;
                  ledger = null;
                }
                if (ledger && ledger.stream !== priorStream) store.delete(KEPT_LEDGER_SLOT);
                else if (ledger && priorStream !== nextStream) store.put({ ...ledger, stream: nextStream }, KEPT_LEDGER_SLOT);
              }
            }
            if (after === null) store.delete(RECORD_SLOT);
            else store.put(after, RECORD_SLOT);
            set({ before, after });
          } catch (error) { stop(error); }
        };
      };
    }),
    readSync: ({ signal } = {}) => run('readonly', (store, { set }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => {
        const record = request.result ?? null;
        const sync = store.get(SYNC_SLOT);
        const key = store.getKey(SYNC_SLOT);
        key.onsuccess = () => set({ record, sync: sync.result ?? null, syncPresent: key.result !== undefined });
      };
    }, { signal }),
    writeSync: (change, { signal } = {}) => run('readwrite', (store, { set, refuse: stop }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => {
        const record = request.result ?? null;
        const sync = store.get(SYNC_SLOT);
        const key = store.getKey(SYNC_SLOT);
        key.onsuccess = () => {
          const before = sync.result ?? null;
          let after;
          try { after = change(before, record, key.result !== undefined); }
          catch (error) { stop(error); return; }
          if (signal?.aborted) return;
          if (after === undefined) { set({ before, after: before }); return; }
          if (after === null) store.delete(SYNC_SLOT);
          else store.put(after, SYNC_SLOT);
          set({ before, after });
        };
      };
    }, { signal }),
    readSyncDeclines: ({ signal } = {}) => run('readonly', (store, { set }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => {
        const record = request.result ?? null;
        const declines = store.get(SYNC_DECLINES_SLOT);
        const key = store.getKey(SYNC_DECLINES_SLOT);
        key.onsuccess = () => set({ record, declines: declines.result ?? null, present: key.result !== undefined });
      };
    }, { signal }),
    writeSyncDeclines: (change, { signal } = {}) => run('readwrite', (store, { set, refuse: stop }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => {
        const record = request.result ?? null;
        const declines = store.get(SYNC_DECLINES_SLOT);
        const key = store.getKey(SYNC_DECLINES_SLOT);
        key.onsuccess = () => {
          const before = declines.result ?? null;
          let after;
          try { after = change(before, record, key.result !== undefined); }
          catch (error) { stop(error); return; }
          if (signal?.aborted) return;
          if (after === undefined) { set({ before, after: before }); return; }
          if (after === null) store.delete(SYNC_DECLINES_SLOT);
          else store.put(after, SYNC_DECLINES_SLOT);
          set({ before, after });
        };
      };
    }, { signal }),
    readSyncGate: ({ signal } = {}) => run('readonly', (store, { set }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => {
        const record = request.result ?? null;
        const gate = store.get(SYNC_GATE_SLOT);
        const key = store.getKey(SYNC_GATE_SLOT);
        key.onsuccess = () => set({ record, gate: gate.result ?? null, gatePresent: key.result !== undefined });
      };
    }, { signal }),
    writeSyncGate: (change, { signal, onCommitted } = {}) => run('readwrite', (store, { set, refuse: stop }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => {
        const record = request.result ?? null;
        const gate = store.get(SYNC_GATE_SLOT);
        const key = store.getKey(SYNC_GATE_SLOT);
        key.onsuccess = () => {
          const before = gate.result ?? null;
          let after;
          try { after = change(before, record, key.result !== undefined); }
          catch (error) { stop(error); return; }
          if (signal?.aborted) return;
          if (after === undefined) { set({ before, after: before }); return; }
          if (after === null) store.delete(SYNC_GATE_SLOT);
          else store.put(after, SYNC_GATE_SLOT);
          set({ before, after });
        };
      };
    }, { signal, onCommitted }),
    readKeptPending: () => run('readonly', (store, { set }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => {
        const record = request.result ?? null;
        const pending = store.get(KEPT_PENDING_SLOT);
        const key = store.getKey(KEPT_PENDING_SLOT);
        key.onsuccess = () => set({ record, pending: pending.result ?? null, present: key.result !== undefined });
      };
    }),
    writeKeptPending: (change) => run('readwrite', (store, { set, refuse: stop }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => {
        const record = request.result ?? null;
        const pending = store.get(KEPT_PENDING_SLOT);
        const key = store.getKey(KEPT_PENDING_SLOT);
        const sync = store.get(SYNC_SLOT);
        const syncKey = store.getKey(SYNC_SLOT);
        syncKey.onsuccess = () => {
          let after;
          try {
            after = change(pending.result ?? null, record, key.result !== undefined, sync.result ?? null, syncKey.result !== undefined);
          }
          catch (error) { stop(error); return; }
          if (after === undefined) { set(pending.result ?? null); return; }
          if (after === null) store.delete(KEPT_PENDING_SLOT);
          else store.put(after, KEPT_PENDING_SLOT);
          set(after);
        };
      };
    }),
    resolveKeptPending: (change) => run('readwrite', (store, { set, refuse: stop }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => {
        const record = request.result ?? null;
        const pending = store.get(KEPT_PENDING_SLOT);
        const pendingKey = store.getKey(KEPT_PENDING_SLOT);
        const sync = store.get(SYNC_SLOT);
        const syncKey = store.getKey(SYNC_SLOT);
        syncKey.onsuccess = () => {
          let after;
          try {
            after = change(pending.result ?? null, record, pendingKey.result !== undefined, sync.result ?? null, syncKey.result !== undefined);
          } catch (error) { stop(error); return; }
          try {
            if (after !== undefined) store.put(after, SYNC_SLOT);
            store.delete(KEPT_PENDING_SLOT);
            set(after);
          } catch (error) { stop(error); }
        };
      };
    }),
    readKeptLedger: () => run('readonly', (store, { set }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => {
        const record = request.result ?? null;
        const ledger = store.get(KEPT_LEDGER_SLOT);
        const key = store.getKey(KEPT_LEDGER_SLOT);
        key.onsuccess = () => set({ record, ledger: ledger.result ?? null, ledgerPresent: key.result !== undefined });
      };
    }),
    writeKeptLedger: (change) => run('readwrite', (store, { set, refuse: stop }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => {
        const record = request.result ?? null;
        const ledger = store.get(KEPT_LEDGER_SLOT);
        const key = store.getKey(KEPT_LEDGER_SLOT);
        key.onsuccess = () => {
          const before = ledger.result ?? null;
          let after;
          try { after = change(before, record, key.result !== undefined); }
          catch (error) { stop(error); return; }
          if (after === undefined) { set({ before, after: before }); return; }
          if (after === null) store.delete(KEPT_LEDGER_SLOT);
          else store.put(after, KEPT_LEDGER_SLOT);
          set({ before, after });
        };
      };
    }),
    readKeptWitness: () => run('readonly', (store, { set }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => {
        const record = request.result ?? null;
        const witness = store.get(KEPT_WITNESS_SLOT);
        const key = store.getKey(KEPT_WITNESS_SLOT);
        key.onsuccess = () => set({ record, witness: witness.result ?? null, present: key.result !== undefined });
      };
    }),
    writeKeptWitness: (change) => run('readwrite', (store, { set, refuse: stop }) => {
      const request = store.get(RECORD_SLOT);
      request.onsuccess = () => {
        const record = request.result ?? null;
        const witness = store.get(KEPT_WITNESS_SLOT);
        const key = store.getKey(KEPT_WITNESS_SLOT);
        key.onsuccess = () => {
          let after;
          try { after = change(witness.result ?? null, record, key.result !== undefined); }
          catch (error) { stop(error); return; }
          if (after !== undefined) store.put(after, KEPT_WITNESS_SLOT);
          set(after);
        };
      };
    }),
    forget: () => run('readwrite', (store) => {
      store.delete(RECORD_SLOT);
      store.delete(SYNC_SLOT);
      store.delete(SYNC_GATE_SLOT);
      store.delete(SYNC_DECLINES_SLOT);
      store.delete(KEPT_LEDGER_SLOT);
      store.delete(KEPT_WITNESS_SLOT);
      store.delete(KEPT_PENDING_SLOT);
    }),
    async close() {
      const pending = opening;
      opening = null;
      if (pending) (await pending.catch(() => null))?.close();
    },
  };
}

// ------------------------------------------------------------------ bytes

function bytesOf(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return null;
}

// Reads to the end, or stops as soon as more than `limit` bytes have come out.
async function collect(readable, limit) {
  const reader = readable.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

// An item as the transport lists it: an id, a name, its size in bytes and its creation time in
// milliseconds, either of the last two possibly unknown. Anything else is not an item.
function itemOf(value) {
  if (!object(value) || typeof value.id !== 'string' || value.id.length === 0 || typeof value.name !== 'string') return null;
  return {
    id: value.id, name: value.name,
    size: nonNegative(value.size) ? value.size : null,
    created: Number.isFinite(value.created) ? value.created : null,
  };
}

// ------------------------------------------------------------------ the protocol

export class CloudBackupProtocol {
  // transport: the app's own area of one account, installed through the page's one registration point:
  // the Windows host's fetch transport, or the bridge the Android or iOS app supplies. The full contract,
  // with every refusal code and what the engine does about it, is under Cloud backup in
  // docs/ARCHITECTURE.md. Every call names a connection, and the transport refuses with code
  // 'needs-consent' when it holds a different one, or 'not-connected' when it holds none, so nothing is
  // listed, read, created or deleted in an account this browser has not agreed to (stage 1 review, M1).
  //   list({ connection }) resolves to every item, as { id, name, size, created }; an area not made yet
  //   lists as empty.
  //   read(id, { connection, purpose }) resolves to the item's bytes, refusing with 'too-large' an item whose
  //   stored bytes exceed 32 MiB, without returning them, and with 'not-found' one that is gone. The purpose
  //   says why it is read: 'verify' for the read-back of an item this engine has just created, 'discover',
  //   'restore', 'keep' for a backup copied to a kept copy, and 'check' for a kept copy checked again. A
  //   transport may ignore it. One whose provider can hold a new item before it is stored, as iCloud can,
  //   may wait for that only for 'verify', and refuses every other read of such an item at once.
  //   create(name, bytes, { connection }) makes a new item and resolves to it. It never knowingly replaces
  //   one, and refuses with 'exists' a name it can tell is taken. A lost host reply can be reported as
  //   unavailable rather than timeout, so a kept-copy reservation survives either kind of failure.
  //   delete(id, { connection }) removes one, and an item already gone counts as removed.
  //   Each settles within CLOUD_TRANSPORT_DEADLINES_MS, and a refusal may carry the wait the provider
  //   asked for as retryAfterMs. Item ids are opaque and may equal names.
  constructor({
    transport, records = createCloudRecordStore(), cryptoProvider = globalThis.crypto, streams = globalThis,
    locks = globalThis.navigator?.locks, clock = Date.now, maxBytes = MAX_CLOUD_BACKUP_BYTES,
    limits = CLOUD_DISCOVERY_LIMITS, deadlines = CLOUD_TRANSPORT_DEADLINES_MS, graceMs = CLOUD_DEADLINE_GRACE_MS,
    setTimer = (callback, ms) => globalThis.setTimeout(callback, ms), clearTimer = (timer) => globalThis.clearTimeout(timer),
  } = {}) {
    if (['list', 'read', 'create', 'delete'].some((operation) => typeof transport?.[operation] !== 'function')) {
      throw new TypeError('Cloud backup needs a transport that can list, read, create and delete.');
    }
    if (['read', 'write', 'readSync', 'writeSync', 'readSyncGate', 'writeSyncGate', 'readSyncDeclines', 'writeSyncDeclines',
      'readKeptLedger', 'writeKeptLedger',
      'readKeptWitness', 'writeKeptWitness', 'readKeptPending', 'writeKeptPending', 'resolveKeptPending', 'forget']
      .some((operation) => typeof records?.[operation] !== 'function')
      || typeof clock !== 'function') {
      throw new TypeError('Cloud backup needs its record and a clock.');
    }
    Object.assign(this, { transport, records, cryptoProvider, streams, clock, maxBytes, limits, deadlines, graceMs, setTimer, clearTimer });
    this.locks = typeof locks?.request === 'function' ? locks : null;
    this.keptRetryCursor = 0;
    this.keptCleanupProblems = new Set();
  }

  // Every transport call is held to its deadline and the grace, so a provider that never answers cannot
  // hold the worker lock for good. The call is not cancelled: a create that lands after it was given up on
  // only adds a generation this browser already spent, and the list before the next create sees it.
  call(operation, ...args) {
    const limit = this.deadlines[operation] + this.graceMs;
    let timer;
    const late = new Promise((resolve, reject) => {
      timer = this.setTimer(() => reject(new CloudBackupError(
        `The cloud account did not answer within ${Math.round(limit / 1000)} seconds.`, 'timeout')), limit);
    });
    const answer = new Promise((resolve) => { resolve(this.transport[operation](...args)); });
    return Promise.race([answer, late]).finally(() => this.clearTimer(timer));
  }

  // ---------------------------------------------------------------- the record

  // Whole milliseconds, because the record and the envelope accept nothing else, and a clock that
  // answered a fraction would otherwise make every backup fail its own checks.
  now() {
    const time = this.clock();
    return Number.isFinite(time) ? Math.max(0, Math.floor(time)) : 0;
  }

  // As stored, or null when this browser has never turned cloud backup on.
  async record() {
    const value = await this.records.read();
    return value === null ? null : checkRecord(value);
  }

  async keptLedger() {
    const { record: rawRecord, ledger, ledgerPresent } = await this.records.readKeptLedger();
    const record = rawRecord === null ? null : checkRecord(rawRecord);
    if (!ledgerPresent || record === null) return null;
    const held = checkKeptLedger(ledger);
    return held.stream === record.stream ? held : null;
  }

  async keptHistory({ connection } = {}) {
    const named = connectionOf(connection);
    const { record: rawRecord, witness, present } = await this.records.readKeptWitness();
    const record = currentConsent(rawRecord, named);
    if (!present) return { unknown: true };
    const checked = checkKeptWitness(witness);
    return { unknown: checked.stream !== record.stream || checked.unknown };
  }

  async ensureKeptWitness(context) {
    let expected;
    await this.records.writeKeptWitness((raw, record, present) => {
      requireSyncContext(record, context);
      const previous = present ? checkKeptWitness(raw) : null;
      expected = previous?.stream === context.stream ? previous : { version: 1, stream: context.stream, unknown: true };
      return expected;
    });
    const { record, witness, present } = await this.records.readKeptWitness();
    requireSyncContext(record, context);
    if (!present || canonical(checkKeptWitness(witness)) !== canonical(expected)) throw recordLost();
    return expected;
  }

  async changeKeptLedger(change) {
    let expected;
    await this.records.writeKeptLedger((rawLedger, rawRecord, present) => {
      if (rawRecord === null) throw recordLost();
      const record = checkRecord(rawRecord);
      const prior = present ? checkKeptLedger(rawLedger) : null;
      const ledger = prior?.stream === record.stream ? prior : { version: 1, stream: record.stream, next: 1, entries: [] };
      expected = checkKeptLedger(change(ledger, record));
      return expected;
    });
    const held = await this.keptLedger();
    if (canonical(held) !== canonical(expected)) throw recordLost();
    return held;
  }

  async keptCopySummary({ connection } = {}) {
    const named = connection === null ? null : connectionOf(connection);
    const ledger = await this.keptLedger();
    const entries = ledger?.entries ?? [];
    const own = entries.filter((entry) => named !== null && entry.connection === named);
    const unresolved = own.filter((entry) => entry.changedOutside || entry.deleting || entry.staleAbsent).length;
    const excess = Math.max(0, own.filter((entry) => entry.id !== null && !entry.deleting && !entry.changedOutside).length - KEPT_LIMIT);
    return {
      earlier: entries.filter((entry) => named === null || entry.connection !== named).length,
      attention: unresolved + excess,
      problem: named !== null && this.keptCleanupProblems.has(named),
    };
  }

  async earlierKeptCopies(options) {
    return (await this.keptCopySummary(options)).earlier;
  }

  async syncState({ connection } = {}) {
    const named = connectionOf(connection);
    const { record: rawRecord, sync, syncPresent } = await this.records.readSync();
    const record = currentConsent(rawRecord, named);
    if (!syncPresent) return null;
    const state = checkSyncState(sync);
    if (!sameSyncContext(state, record)) return null;
    return { ...state, kept: state.kept?.connection === named ? state.kept : null, current: true };
  }

  async keptPending({ connection, details = false } = {}) {
    const named = connectionOf(connection);
    const { record: rawRecord, pending, present } = await this.records.readKeptPending();
    currentConsent(rawRecord, named);
    if (!present) return null;
    const held = checkKeptPending(pending);
    if (held.connection !== named) return details ? { foreign: true } : null;
    return details ? keptPendingDetails(held) : held.kept;
  }

  async setKeptPending({ connection, stream, consentId, kept, targetDigest, previousKept, expected, authorize } = {}) {
    const context = syncContext({ connection, stream, consentId });
    const scopedKept = (value) => validKept(value) && value.connection === connection && value.stream === stream;
    const connectedKept = (value) => validKept(value) && value.connection === connection;
    const detailed = kept !== null && targetDigest !== undefined;
    const expectedDetails = expected !== null && object(expected) && Object.hasOwn(expected, 'kept');
    if (!this.locks || (kept !== null && (!validKept(kept) || kept.connection !== connection || kept.stream !== stream))
      || (detailed && (!validDigest(targetDigest) || (previousKept !== null && !connectedKept(previousKept))))
      || (expected !== null && !(expectedDetails ? scopedKept(expected.kept) : scopedKept(expected)))
      || typeof authorize !== 'function') {
      refuse('The pending cloud recovery copy could not be recorded.', 'invalid');
    }
    const next = kept === null ? null : detailed
      ? { version: 2, connection, stream, consentId, kept, targetDigest, previousKept }
      : { version: 1, connection, stream, kept };
    return this.exclusive(async () => {
      if (kept !== null) await this.fetchRecordedKept({ ...context, kept });
      await this.records.writeKeptPending((raw, rawRecord, present, rawSync, syncPresent) => {
        const record = requireSyncContext(rawRecord, context);
        if (detailed) {
          const state = syncPresent ? checkSyncState(rawSync) : null;
          const active = sameSyncContext(state, record) ? state.kept : null;
          if (canonical(active) !== canonical(previousKept)) refuse('The kept cloud copy changed. Check again.', 'raced');
        }
        if (!authorize()) refuse('The cloud choice changed. Check again.', 'raced');
        const previous = present ? checkKeptPending(raw) : null;
        if (previous && (previous.connection !== connection || previous.stream !== stream)) {
          refuse('An earlier cloud recovery copy belongs to a different connection. Check it before loading other progress.', 'paused');
        }
        const held = previous?.connection === connection && previous.stream === stream ? previous : null;
        const current = expectedDetails ? keptPendingDetails(held) : held?.kept ?? null;
        if (canonical(current) !== canonical(expected)) refuse('The pending cloud recovery copy changed. Check again.', 'raced');
        return next;
      });
      if (canonical(await this.keptPending({ connection, details: true })) !== canonical(keptPendingDetails(next)) || !authorize()) {
        throw recordLost();
      }
    });
  }

  async resolveKeptPending({ connection, stream, consentId, pending, outcome, authorize, prune = true } = {}) {
    const context = syncContext({ connection, stream, consentId });
    if (!this.locks || !object(pending) || !validKept(pending.kept) || !validDigest(pending.targetDigest)
      || !['loaded', 'prior'].includes(outcome) || typeof authorize !== 'function' || typeof prune !== 'boolean') {
      refuse('The pending cloud recovery copy cannot be confirmed.', 'invalid');
    }
    return this.exclusive(async () => {
      requireSyncContext(await this.records.read(), context);
      if (outcome === 'loaded') {
        const ledger = await this.keptLedger();
        const entry = ledger?.entries.find((candidate) => canonical(keptReference(candidate)) === canonical(pending.kept)
          && candidate.verified && !candidate.deleting && !candidate.changedOutside);
        if (!entry) refuse('The pending cloud recovery copy cannot be confirmed.', 'verify');
        if (prune) await this.fetchRecordedKept({ ...context, kept: pending.kept });
      } else if (pending.consentId !== consentId && pending.previousKept
        && !(await this.syncState({ connection }))?.kept) {
        await this.fetchRecordedKept({ ...context, kept: pending.previousKept });
      }
      await this.records.resolveKeptPending((rawPending, rawRecord, present, rawSync, syncPresent) => {
        const record = requireSyncContext(rawRecord, context);
        if (!authorize()) refuse('The cloud choice changed. Check again.', 'raced');
        const held = present ? checkKeptPending(rawPending) : null;
        if (canonical(keptPendingDetails(held)) !== canonical(pending)) {
          refuse('The pending cloud recovery copy changed. Check again.', 'raced');
        }
        const state = syncPresent ? checkSyncState(rawSync) : null;
        const same = sameSyncContext(state, record);
        const active = same ? state.kept : null;
        const reattach = pending.consentId !== consentId && active === null && pending.previousKept !== null;
        if (!reattach && canonical(active) !== canonical(pending.previousKept)) {
          refuse('The kept cloud copy changed. Check again.', 'raced');
        }
        if (outcome === 'prior' && !reattach) return undefined;
        return {
          version: 1, connection, stream, consentId,
          matchedDigest: same ? state.matchedDigest : null,
          declinedDigest: same ? state.declinedDigest : null,
          kept: outcome === 'loaded' ? pending.kept : pending.previousKept,
        };
      });
      const [held, state] = await Promise.all([
        this.keptPending({ connection, details: true }), this.syncState({ connection }),
      ]);
      const expected = outcome === 'loaded' ? pending.kept : pending.previousKept;
      if (held !== null || canonical(state?.kept ?? null) !== canonical(expected) || !authorize()) throw recordLost();
      if (outcome === 'loaded' && prune) await this.pruneKept(context);
      return expected;
    });
  }

  async syncDeclines({ connection, stream, consentId, signal } = {}) {
    const context = syncContext({ connection, stream, consentId });
    const { record, declines, present } = await this.records.readSyncDeclines({ signal });
    requireSyncContext(record, context);
    if (!present) return [];
    const saved = checkSyncDeclines(declines);
    return syncBelongsTo(saved, context) ? saved.entries : [];
  }

  async rememberDecline({ connection, stream, consentId, remoteStream, digest, expected, authorize, signal } = {}) {
    const context = syncContext({ connection, stream, consentId });
    if (typeof remoteStream !== 'string' || !STREAM.test(remoteStream) || remoteStream === stream
      || (digest !== null && !validDigest(digest))
      || (expected !== undefined && expected !== null && !validDigest(expected))
      || (authorize !== undefined && typeof authorize !== 'function')
      || (signal !== undefined && (typeof signal?.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))) {
      refuse('The saved cloud choice is incomplete, so nothing was changed.', 'invalid');
    }
    let expectedEntries;
    await this.records.writeSyncDeclines((raw, rawRecord, present) => {
      requireSyncContext(rawRecord, context);
      if (authorize && authorize() !== true) refuse('The cloud check changed. Check again.', 'raced');
      const previous = present ? checkSyncDeclines(raw) : null;
      const entries = previous && syncBelongsTo(previous, context) ? previous.entries : [];
      const existing = entries.find((entry) => entry.stream === remoteStream)?.digest ?? null;
      if (expected !== undefined && existing !== expected) refuse('The cloud choice changed. Check again.', 'raced');
      expectedEntries = entries.filter((entry) => entry.stream !== remoteStream);
      if (digest !== null) expectedEntries.push({ stream: remoteStream, digest });
      expectedEntries.sort((left, right) => left.stream < right.stream ? -1 : left.stream > right.stream ? 1 : 0);
      return { version: 1, ...context, entries: expectedEntries };
    }, { signal });
    const actual = await this.syncDeclines({ ...context, signal });
    if (canonical(actual) !== canonical(expectedEntries)) throw recordLost();
    return actual;
  }

  async syncGate({ connection, stream, consentId, signal } = {}) {
    const context = syncContext({ connection, stream, consentId });
    const { record, gate, gatePresent } = await this.records.readSyncGate({ signal });
    requireSyncContext(record, context);
    if (!gatePresent) return null;
    const held = checkSyncGate(gate);
    return syncBelongsTo(held, context) ? held : null;
  }

  async setSyncGate({ connection, stream, consentId, epoch, held, pending, authorize, signal, onCommitted } = {}) {
    const context = syncContext({ connection, stream, consentId });
    if (typeof epoch !== 'string' || !STREAM.test(epoch) || typeof held !== 'boolean'
      || (authorize !== undefined && typeof authorize !== 'function')
      || (signal !== undefined && (typeof signal?.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))
      || (onCommitted !== undefined && typeof onCommitted !== 'function')) {
      refuse('The cloud sync upload hold is incomplete, so nothing was changed.', 'invalid');
    }
    let expected;
    await this.records.writeSyncGate((raw, record, present) => {
      requireSyncContext(record, context);
      const previous = present ? checkSyncGate(raw) : null;
      if ((!held || pending !== undefined) && (!previous || !syncBelongsTo(previous, context) || previous.epoch !== epoch)) {
        refuse('The cloud check changed, so backups remain paused.', 'raced');
      }
      const decision = pending === undefined
        ? (previous && syncBelongsTo(previous, context) ? previous.pending : undefined) : pending;
      if (!held && decision != null) refuse('A cloud choice still needs checking, so backups remain paused.', 'raced');
      if (authorize && authorize() !== true) {
        refuse('Saved data changed, so the earlier cloud choice was withdrawn.', 'raced');
      }
      expected = checkSyncGate({
        version: 1, ...context, epoch, held, ...(decision == null ? {} : { pending: decision }),
      });
      return expected;
    }, { signal, onCommitted });
    const actual = await this.syncGate({ ...context, signal });
    if (canonical(actual) !== canonical(expected)) throw recordLost();
    return actual;
  }

  async rememberSync({ connection, stream, consentId, matchedDigest, declinedDigest, authorize, signal } = {}) {
    const context = syncContext({ connection, stream, consentId });
    if ([matchedDigest, declinedDigest].some((value) => value !== undefined && value !== null && !validDigest(value))
      || (authorize !== undefined && typeof authorize !== 'function')
      || (signal !== undefined && (typeof signal?.aborted !== 'boolean'
        || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function'))) {
      refuse('Cloud sync needs valid saved-state digests, so nothing was changed.', 'invalid');
    }
    await this.records.writeSync((rawState, rawRecord, present) => {
      const record = requireSyncContext(rawRecord, context);
      if (authorize && authorize() !== true) refuse('The cloud check changed. Check again.', 'raced');
      const prior = present ? checkSyncState(rawState) : null;
      const same = sameSyncContext(prior, record);
      return {
        version: 1, connection: context.connection, stream: record.stream, consentId: record.consent.id,
        matchedDigest: matchedDigest === undefined ? (same ? prior.matchedDigest : null) : matchedDigest,
        declinedDigest: declinedDigest === undefined ? (same ? prior.declinedDigest : null) : declinedDigest,
        kept: same && prior.kept?.connection === context.connection ? prior.kept : null,
      };
    }, { signal });
    const { record: rawRecord, sync, syncPresent } = await this.records.readSync({ signal });
    const record = requireSyncContext(rawRecord, context);
    const held = syncPresent ? checkSyncState(sync) : null;
    if (!held || !sameSyncContext(held, record) || (matchedDigest !== undefined && held.matchedDigest !== matchedDigest)
      || (declinedDigest !== undefined && held.declinedDigest !== declinedDigest)) throw recordLost();
    return { ...held, current: true };
  }

  async forgetKeptEntry(entry) {
    await this.changeKeptLedger((ledger) => {
      const current = ledger.entries.find((held) => held.name === entry.name);
      if (!current || canonical(current) !== canonical(entry)) throw recordLost();
      return { ...ledger, entries: ledger.entries.filter((held) => held.name !== entry.name) };
    });
  }

  keptCleanup() {
    const controller = new AbortController();
    const { signal } = controller;
    return {
      signal,
      wait: async (operation, provider = false) => {
        cleanupStopped(signal);
        // Provider calls already have their own deadlines; this shorter wait bounds local records.
        if (provider) return operation;
        const timer = this.setTimer(() => controller.abort(), KEPT_CLEANUP_WAIT_MS);
        try { return await waitForCleanup(operation, signal); }
        finally { this.clearTimer(timer); }
      },
    };
  }

  // An exact reserved name is only an intent. It becomes an identity after unique listing and byte checks.
  // The read of its bytes is a read-back only straight after this engine created it.
  async checkKeptEntry(entry, connection, cleanup = null, purpose = 'check') {
    const signal = cleanup?.signal;
    const wait = cleanup?.wait ?? ((operation) => operation);
    const listed = await wait(this.listed(connection), true);
    cleanupStopped(signal);
    const matches = listed.retained.filter((item) => item.name === entry.name);
    const count = listed.nameCounts.get(entry.name) ?? 0;
    if (count === 0 && entry.id === null) return null;
    if (count === 0 && entry.id !== null) {
      try { await wait(this.call('read', entry.id, { connection, purpose: 'check' }), true); }
      catch (error) {
        cleanupStopped(signal);
        if (error?.code === 'not-found') return null;
        throw error;
      }
      cleanupStopped(signal);
      refuse(KEPT_UNCONFIRMED, 'verify');
    }
    if (count !== 1 || matches.length !== 1 || listed.duplicateIds.has(matches[0].id)
      || (entry.id !== null && entry.id !== matches[0].id)
      || (matches[0].size !== null && matches[0].size > this.maxBytes)) refuse(KEPT_UNCONFIRMED, 'verify');
    const item = matches[0];
    let bytes;
    try { bytes = bytesOf(await wait(this.call('read', item.id, { connection, purpose }), true)); }
    catch (error) {
      cleanupStopped(signal);
      if (error?.code === 'not-found') return null;
      if (error?.code === 'too-large') refuse(KEPT_UNCONFIRMED, 'verify');
      throw error;
    }
    cleanupStopped(signal);
    if (!bytes || bytes.byteLength > this.maxBytes || await this.digest(bytes) !== entry.byteDigest) {
      refuse(KEPT_UNCONFIRMED, 'verify');
    }
    cleanupStopped(signal);
    const checked = await this.decode(bytes, item);
    cleanupStopped(signal);
    if (!checked) refuse(KEPT_UNCONFIRMED, 'verify');
    const backup = await parseCompleteBackup(checked.text, { cryptoProvider: this.cryptoProvider });
    if (backup.digest !== entry.contentDigest || await digestPersonalBackup(backup, this.cryptoProvider) !== entry.personalDigest) {
      refuse(KEPT_UNCONFIRMED, 'verify');
    }
    cleanupStopped(signal);
    const latest = await wait(this.listed(connection), true);
    cleanupStopped(signal);
    const again = latest.retained.filter((candidate) => candidate.name === entry.name);
    if (latest.nameCounts.get(entry.name) !== 1 || again.length !== 1 || again[0].id !== item.id
      || latest.duplicateIds.has(item.id) || (again[0].size !== null && again[0].size !== bytes.byteLength)) {
      refuse(KEPT_UNCONFIRMED, 'verify');
    }
    if (entry.id === item.id && entry.verified && !entry.changedOutside) return entry;
    const held = await wait(this.changeKeptLedger((ledger) => {
      cleanupStopped(signal);
      const current = ledger.entries.find((candidate) => candidate.name === entry.name);
      if (!current || canonical(current) !== canonical(entry)) throw recordLost();
      return {
        ...ledger,
        entries: ledger.entries.map((candidate) => candidate.name === entry.name
          ? { ...candidate, id: item.id, verified: true, changedOutside: false, staleAbsent: false } : candidate),
      };
    }));
    return held.entries.find((candidate) => candidate.name === entry.name);
  }

  async checkKeptBeforeDeletion(entry, connection, cleanup = null) {
    const signal = cleanup?.signal;
    const wait = cleanup?.wait ?? ((operation) => operation);
    let checked;
    try { checked = await this.checkKeptEntry(entry, connection, cleanup); }
    catch (error) {
      cleanupStopped(signal);
      if (error instanceof CloudBackupError && error.code === 'storage') throw error;
      await wait(this.markKeptForAttention(entry));
      const code = STOPS_DELETION.has(error?.code) ? error.code : 'changed';
      throw Object.assign(new CloudBackupError(KEPT_CHANGED, code), { changedOutside: true });
    }
    cleanupStopped(signal);
    if (checked || entry.id === null) return checked;
    await wait(this.markKeptForAttention(entry));
    throw Object.assign(new CloudBackupError(KEPT_CHANGED, 'changed'), { changedOutside: true });
  }

  async markKeptForAttention(entry) {
    if (entry.changedOutside) return entry;
    const held = await this.changeKeptLedger((ledger) => {
      const current = ledger.entries.find((candidate) => candidate.name === entry.name);
      if (!current || canonical(current) !== canonical(entry)) throw recordLost();
      return {
        ...ledger,
        entries: ledger.entries.map((candidate) => candidate.name === entry.name
          ? { ...candidate, changedOutside: true } : candidate),
      };
    });
    return held.entries.find((candidate) => candidate.name === entry.name);
  }

  async noteKeptProblem(entry, connection) {
    this.keptCleanupProblems.add(connection);
    const controller = new AbortController();
    const { signal } = controller;
    const timer = this.setTimer(() => controller.abort(), KEPT_CLEANUP_WAIT_MS);
    try {
      const current = (await waitForCleanup(this.keptLedger(), signal))?.entries.find((candidate) => candidate.name === entry.name
        && candidate.connection === connection && candidate.byteDigest === entry.byteDigest);
      cleanupStopped(signal);
      if (current && !current.deleting) await waitForCleanup(this.markKeptForAttention(current), signal);
    } catch (error) {
      if (signal.aborted && error?.code === 'cleanup-stopped') return;
      if (!(error instanceof CloudBackupError) || error.code !== 'storage') throw error;
    } finally {
      this.clearTimer(timer);
    }
  }

  async markKeptDeleting(entry) {
    if (entry.deleting) return entry;
    const held = await this.changeKeptLedger((ledger) => {
      const current = ledger.entries.find((candidate) => candidate.name === entry.name);
      if (!current || canonical(current) !== canonical(entry) || entry.id === null) throw recordLost();
      return {
        ...ledger,
        entries: ledger.entries.map((candidate) => candidate.name === entry.name
          ? { ...candidate, deleting: true } : candidate),
      };
    });
    return held.entries.find((candidate) => candidate.name === entry.name);
  }

  async finishKeptDeletion(entry, connection, onRemoved = () => {}, cleanup = null) {
    const signal = cleanup?.signal;
    const wait = cleanup?.wait ?? ((operation) => operation);
    let bytes;
    try { bytes = bytesOf(await wait(this.call('read', entry.id, { connection, purpose: 'check' }), true)); }
    catch (error) {
      cleanupStopped(signal);
      if (error?.code === 'not-found') {
        await wait(this.forgetKeptEntry(entry));
        return;
      }
      if (STOPS_DELETION.has(error?.code)) throw error;
      await wait(this.markKeptForAttention(entry));
      throw Object.assign(new CloudBackupError(KEPT_CHANGED, 'changed'), { changedOutside: true });
    }
    cleanupStopped(signal);
    const matches = bytes && bytes.byteLength <= this.maxBytes && await this.digest(bytes) === entry.byteDigest;
    cleanupStopped(signal);
    if (!matches) {
      await wait(this.markKeptForAttention(entry));
      throw Object.assign(new CloudBackupError(KEPT_CHANGED, 'changed'), { changedOutside: true });
    }
    const latest = await wait(this.keptLedger());
    cleanupStopped(signal);
    if (!latest?.entries.some((candidate) => canonical(candidate) === canonical(entry) && candidate.deleting)) throw recordLost();
    await wait(this.remove(entry.id, connection), true);
    onRemoved();
    await wait(this.forgetKeptEntry(entry));
  }

  async reconcileKept(connection) {
    const ledger = await this.keptLedger();
    const pending = ledger?.entries.filter((entry) => entry.connection === connection && !entry.verified && !entry.deleting) ?? [];
    for (const entry of pending.filter((candidate) => candidate.id === null && !candidate.staleAbsent)) {
      const checked = await this.checkKeptEntry(entry, connection);
      if (checked
        || this.now() < entry.reservedAt || this.now() - entry.reservedAt < KEPT_STALE_RESERVATION_MS) continue;
      const listed = await this.listed(connection);
      if (listed.nameCounts.has(entry.name)) continue;
      await this.changeKeptLedger((current) => {
        const held = current.entries.find((candidate) => candidate.name === entry.name);
        if (!held || canonical(held) !== canonical(entry)) throw recordLost();
        return {
          ...current,
          entries: current.entries.map((candidate) => candidate.name === entry.name
            ? { ...candidate, staleAbsent: true, changedOutside: true } : candidate),
        };
      });
    }
    const known = pending.filter((entry) => entry.id !== null && !entry.changedOutside);
    if (known.length === 0) return;
    const cleanup = this.keptCleanup();
    for (const entry of known) {
      try {
        cleanupStopped(cleanup.signal);
        await this.checkKeptBeforeDeletion(entry, connection, cleanup);
      } catch (error) {
        if (cleanup.signal.aborted) {
          this.keptCleanupProblems.add(connection);
          return;
        }
        if (error instanceof CloudBackupError && error.code === 'storage') {
          await this.noteKeptProblem(entry, connection);
          continue;
        }
        if (error?.changedOutside && !STOPS_DELETION.has(error.code)) continue;
        throw error;
      }
    }
  }

  async rememberKept(context, entry, authorize = null) {
    const kept = keptReference(entry);
    await this.records.writeSync((rawState, rawRecord, present) => {
      const record = requireSyncContext(rawRecord, context);
      if (authorize && authorize() !== true) refuse('The cloud check changed. Check again.', 'raced');
      const prior = present ? checkSyncState(rawState) : null;
      const same = sameSyncContext(prior, record);
      return {
        version: 1, connection: context.connection, stream: record.stream, consentId: record.consent.id,
        matchedDigest: same ? prior.matchedDigest : null,
        declinedDigest: same ? prior.declinedDigest : null,
        kept,
      };
    });
    const { record: rawRecord, sync, syncPresent } = await this.records.readSync();
    const record = requireSyncContext(rawRecord, context);
    const held = syncPresent ? checkSyncState(sync) : null;
    if (!held || !sameSyncContext(held, record) || canonical(held.kept) !== canonical(kept)) throw recordLost();
    return kept;
  }

  async pruneKept(context) {
    const cleanup = this.keptCleanup();
    const { signal, wait } = cleanup;
    let activeEntry = null;
    try {
      const ledger = await wait(this.keptLedger());
      if (!ledger) return;
      const own = ledger.entries.filter((entry) => entry.connection === context.connection && entry.id !== null)
        .sort((a, b) => b.order - a.order);
      const protectedReference = async (entry) => {
        cleanupStopped(signal);
        const { record: rawRecord, sync, syncPresent } = await wait(this.records.readSync());
        cleanupStopped(signal);
        const record = requireSyncContext(rawRecord, context);
        const state = syncPresent ? checkSyncState(sync) : null;
        const { pending: rawPending, present } = await wait(this.records.readKeptPending());
        const pending = present ? checkKeptPending(rawPending) : null;
        cleanupStopped(signal);
        return (sameSyncContext(state, record) && state.kept?.id === entry.id && state.kept.name === entry.name)
          || (pending?.connection === context.connection && (
            (pending.kept.id === entry.id && pending.kept.name === entry.name)
            || (pending.previousKept?.id === entry.id && pending.previousKept.name === entry.name)));
      };
      let listed;
      try { listed = await wait(this.listed(context.connection), true); }
      catch (error) {
        // The verified replacement is already the go-back copy, so only a stop on deletion itself may fail it.
        if (STOPS_DELETION.has(error?.code)) throw error;
        this.keptCleanupProblems.add(context.connection);
        return;
      }
      const checkedEntries = [];
      for (const entry of own.filter((candidate) => !candidate.deleting && !candidate.changedOutside)) {
        activeEntry = entry;
        const matches = listed.retained.filter((item) => item.name === entry.name);
        const unique = entry.verified && listed.nameCounts.get(entry.name) === 1 && matches.length === 1
          && matches[0].id === entry.id && !listed.duplicateIds.has(entry.id);
        if (unique && matches[0].size === entry.size) {
          checkedEntries.push(entry);
          continue;
        }
        if (!unique || matches[0].size !== null) {
          await wait(this.markKeptForAttention(entry));
          continue;
        }
        // iCloud lists a copy that is not downloaded without a size, so its bytes are the only check.
        try {
          if (await this.checkKeptBeforeDeletion(entry, context.connection, cleanup)) checkedEntries.push(entry);
        } catch (error) {
          if (!error?.changedOutside || (STOPS_DELETION.has(error.code) && error.code !== 'storage')) throw error;
        }
      }
      for (const entry of checkedEntries.slice(KEPT_LIMIT)) {
        activeEntry = entry;
        if (await protectedReference(entry)) continue;
        const marked = await wait(this.markKeptDeleting(entry));
        cleanupStopped(signal);
        try {
          await this.finishKeptDeletion(marked, context.connection, () => {}, cleanup);
        } catch (error) {
          if (signal.aborted) {
            this.keptCleanupProblems.add(context.connection);
            return;
          }
          if (error instanceof CloudBackupError && error.code === 'storage') {
            await this.noteKeptProblem(marked, context.connection);
            return;
          }
          if (STOPS_DELETION.has(error?.code) && error.code !== 'storage') throw error;
          // The durable intent remains visible and can be retried on a later pass.
        }
      }
      const retry = ledger.entries.filter((entry) => entry.connection === context.connection
        && (entry.deleting || entry.changedOutside));
      if (retry.length === 0) {
        this.keptCleanupProblems.delete(context.connection);
        return;
      }
      const entry = retry[this.keptRetryCursor % retry.length];
      activeEntry = entry;
      this.keptRetryCursor += 1;
      if (await protectedReference(entry)) {
        this.keptCleanupProblems.delete(context.connection);
        return;
      }
      try {
        const operation = entry.deleting
          ? this.finishKeptDeletion(entry, context.connection, () => {}, cleanup)
          : this.checkKeptBeforeDeletion(entry, context.connection, cleanup);
        await operation;
      } catch (error) {
        if (signal.aborted) return;
        if (STOPS_DELETION.has(error?.code) && error.code !== 'storage') throw error;
        // The recorded attention stays visible until a later retry can resolve it.
      }
      this.keptCleanupProblems.delete(context.connection);
    } catch (error) {
      if (signal.aborted && error?.code === 'cleanup-stopped') {
        this.keptCleanupProblems.add(context.connection);
        return;
      }
      if (error instanceof CloudBackupError && error.code === 'storage') {
        if (activeEntry) await this.noteKeptProblem(activeEntry, context.connection);
        else this.keptCleanupProblems.add(context.connection);
        return;
      }
      throw error;
    }
  }

  async keepBackup({ connection, stream, consentId, generation, personalDigest, contentDigest, snapshot } = {}, options = {}) {
    const context = syncContext({ connection, stream, consentId });
    const fromSnapshot = snapshot !== undefined;
    if ((!fromSnapshot && (!Number.isSafeInteger(generation) || generation < 1))
      || (fromSnapshot && (options.token !== KEPT_LOCKED || typeof snapshot?.text !== 'string'
        || !object(snapshot?.backup) || canonical(snapshot.backup) !== snapshot.text))
      || !validDigest(personalDigest) || !validDigest(contentDigest)) {
      refuse('That backup cannot be kept because its identity is incomplete.', 'invalid');
    }
    if (!this.locks) refuse('This browser cannot safely keep a cloud copy while other tabs are open.', 'unsupported');
    this.supported();
    if (fromSnapshot) {
      const backup = await parseCompleteBackup(snapshot.text, { cryptoProvider: this.cryptoProvider });
      if (backup.digest !== contentDigest || await digestPersonalBackup(backup, this.cryptoProvider) !== personalDigest) {
        refuse('That backup does not match the saved copy to keep.', 'invalid');
      }
    }
    const operation = async () => {
      await this.ensureKeptWitness(context);
      let selectedGeneration = generation;
      const verified = (record) => {
        const entry = record.validated.find((item) => item.generation === selectedGeneration);
        if (!entry) refuse('That backup is no longer a verified copy on this device.', 'gone');
        if (entry.personalDigest !== personalDigest) refuse('That backup does not match the saved copy to keep.', 'invalid');
      };
      requireSyncContext(await this.records.read(), context);
      await this.reconcileKept(context.connection);
      let ledger = await this.keptLedger();
      const candidates = (ledger?.entries ?? []).filter((entry) => entry.connection === context.connection
        && entry.stream === stream && (fromSnapshot || entry.generation === generation) && entry.personalDigest === personalDigest
        && entry.contentDigest === contentDigest && entry.verified && !entry.deleting && !entry.changedOutside)
        .sort((a, b) => b.order - a.order);
      let kept = null;
      for (const entry of candidates) {
        try { kept = await this.checkKeptBeforeDeletion(entry, context.connection); }
        catch (error) {
          if (error instanceof CloudBackupError && error.code === 'storage') {
            await this.noteKeptProblem(entry, context.connection);
            continue;
          }
          if (STOPS_DELETION.has(error?.code)) throw error;
          continue;
        }
        if (kept) break;
      }
      if (!kept) {
        ledger = await this.keptLedger();
        const pending = (ledger?.entries ?? []).filter((entry) => entry.connection === context.connection
          && entry.id === null && !entry.staleAbsent);
        // A recorded copy that no pass has yet verified or flagged could still be this very copy, however
        // the pass that should have settled it ended.
        const unsettled = (ledger?.entries ?? []).some((entry) => entry.connection === context.connection
          && entry.id !== null && !entry.verified && !entry.changedOutside && !entry.deleting);
        if (unsettled || pending.length >= KEPT_LIMIT || pending.some((entry) => entry.id === null
          && (this.now() < entry.reservedAt || this.now() - entry.reservedAt < KEPT_RETRY_WAIT_MS))) {
          refuse(KEPT_UNCONFIRMED, 'verify');
        }
        const record = requireSyncContext(await this.records.read(), context);
        if (!fromSnapshot) verified(record);
        const { known, nameCounts, ids, duplicateIds } = await this.listed(context.connection);
        let bytes = null;
        let fromVerified = !fromSnapshot;
        const generations = fromSnapshot
          ? record.validated.filter((entry) => entry.personalDigest === personalDigest).map((entry) => entry.generation)
          : [generation];
        for (const candidate of generations) {
          const source = known.filter((item) => item.stream === stream && item.generation === candidate);
          if (source.length !== 1 || nameCounts.get(source[0].name) !== 1 || duplicateIds.has(source[0].id)) {
            if (fromSnapshot) continue;
            if (source.length === 0) refuse('That backup is no longer in the cloud account. Nothing was changed.', 'gone');
            refuse('That backup has an ambiguous cloud identity, so none was selected.', 'invalid');
          }
          let found;
          try { found = bytesOf(await this.call('read', source[0].id, { connection: context.connection, purpose: 'keep' })); }
          catch (error) {
            if (fromSnapshot && ['not-found', 'too-large'].includes(error?.code)) continue;
            if (error?.code === 'not-found') refuse('That backup is no longer in the cloud account. Nothing was changed.', 'gone');
            if (error?.code === 'too-large') refuse('That backup cannot be checked, so it was not kept.', 'invalid');
            throw error;
          }
          const checked = await this.decode(found, source[0]);
          if (!checked) {
            if (fromSnapshot) continue;
            refuse('That backup was changed or cannot be read, so it was not kept.', 'invalid');
          }
          const backup = await parseCompleteBackup(checked.text, { cryptoProvider: this.cryptoProvider });
          if (backup.digest !== contentDigest || await digestPersonalBackup(backup, this.cryptoProvider) !== personalDigest) {
            if (fromSnapshot) continue;
            refuse('That backup does not match the saved copy to keep.', 'invalid');
          }
          selectedGeneration = candidate;
          fromVerified = true;
          bytes = found;
          break;
        }
        if (fromSnapshot && !bytes) {
          const taken = await this.allocate();
          if (taken.stream !== stream || taken.consent.connection !== connection || taken.consent.id !== consentId) {
            refuse('Cloud backup changed, so the earlier choice was withdrawn.', 'raced');
          }
          selectedGeneration = taken.generation;
          bytes = await this.pack(snapshot.text, taken);
        }
        const name = keptBackupName(stream, selectedGeneration, this.randomId());
        if (nameCounts.has(name)) refuse('A kept copy already uses that name, so nothing was changed.', 'exists');
        const byteDigest = await this.digest(bytes);
        let reserved;
        ledger = await this.changeKeptLedger((current, record) => {
          const currentRecord = requireSyncContext(record, context);
          if (fromVerified) verified(currentRecord);
          else if (currentRecord.nextGeneration <= selectedGeneration) throw recordLost();
          if (!Number.isSafeInteger(current.next + 1)) throw recordLost();
          reserved = {
            connection: context.connection, provider: record.consent.provider, stream, generation: selectedGeneration,
            personalDigest, contentDigest, name, byteDigest, id: null, verified: false,
            changedOutside: false, deleting: false, staleAbsent: false, order: current.next, reservedAt: this.now(), size: bytes.byteLength,
          };
          return { ...current, next: current.next + 1, entries: [...current.entries, reserved] };
        });
        if (!ledger.entries.some((entry) => canonical(entry) === canonical(reserved))) throw recordLost();
        let made;
        try { made = itemOf(await this.call('create', name, bytes, { connection: context.connection })); }
        catch (error) {
          if (error?.code === 'exists') await this.forgetKeptEntry(reserved);
          throw error;
        }
        if (!made || made.name !== name || ids.has(made.id)) {
          refuse('The kept cloud copy was not created separately, so it cannot be used.', 'verify');
        }
        ledger = await this.changeKeptLedger((current) => {
          const entry = current.entries.find((candidate) => candidate.name === name);
          if (!entry || canonical(entry) !== canonical(reserved)) throw recordLost();
          return {
            ...current, entries: current.entries.map((candidate) => candidate.name === name
              ? { ...candidate, id: made.id } : candidate),
          };
        });
        const recorded = ledger.entries.find((entry) => entry.name === name);
        kept = await this.checkKeptEntry(recorded, context.connection, null, 'verify');
        if (!kept) refuse(KEPT_UNCONFIRMED, 'verify');
      }
      const reference = options.token === KEPT_LOCKED ? keptReference(kept) : await this.rememberKept(context, kept);
      if (options.token !== KEPT_LOCKED) await this.pruneKept(context);
      requireSyncContext(await this.records.read(), context);
      return reference;
    };
    return options.token === KEPT_LOCKED ? operation() : this.exclusive(operation);
  }

  async prepareKeptSnapshot({ connection, stream, consentId, snapshot, personalDigest, authorize } = {}) {
    const context = syncContext({ connection, stream, consentId });
    if (!this.locks || !validDigest(personalDigest) || typeof authorize !== 'function'
      || typeof snapshot?.text !== 'string' || !validDigest(snapshot?.backup?.digest)) {
      refuse('This device cannot be protected for restore.', 'invalid');
    }
    return this.exclusive(async () => {
      await authorize();
      const replacement = await this.keepBackup({
        ...context, snapshot, personalDigest, contentDigest: snapshot.backup.digest,
      }, { token: KEPT_LOCKED });
      await authorize();
      await this.fetchRecordedKept({ ...context, kept: replacement });
      await authorize();
      return replacement;
    });
  }

  async prepareKeptRestore({ connection, stream, consentId, kept, snapshot, personalDigest, authorize } = {}) {
    const context = syncContext({ connection, stream, consentId });
    if (!this.locks || !validKept(kept) || !validDigest(personalDigest) || typeof authorize !== 'function'
      || typeof snapshot?.text !== 'string' || !validDigest(snapshot?.backup?.digest)) {
      refuse('The kept cloud copy cannot be protected for restore.', 'invalid');
    }
    return this.exclusive(async () => {
      await authorize();
      const target = await this.fetchKeptBackup({ ...context, kept });
      await authorize();
      const replacement = await this.keepBackup({
        ...context, snapshot, personalDigest, contentDigest: snapshot.backup.digest,
      }, { token: KEPT_LOCKED });
      await authorize();
      await this.fetchRecordedKept({ ...context, kept: replacement });
      await authorize();
      const verified = await this.fetchKeptBackup({ ...context, kept });
      if (verified.text !== target.text) refuse('The kept cloud copy changed, so nothing was restored.', 'raced');
      await authorize();
      return { target: verified, replacement };
    });
  }

  async activateKept({ connection, stream, consentId, kept, authorize, prune = true } = {}) {
    const context = syncContext({ connection, stream, consentId });
    if (!this.locks || !validKept(kept) || kept.connection !== connection || kept.stream !== stream
      || typeof authorize !== 'function' || typeof prune !== 'boolean') {
      refuse('The new kept cloud copy cannot be confirmed.', 'invalid');
    }
    return this.exclusive(async () => {
      requireSyncContext(await this.records.read(), context);
      const ledger = await this.keptLedger();
      const entry = ledger?.entries.find((candidate) => canonical(keptReference(candidate)) === canonical(kept)
        && candidate.verified && !candidate.deleting && !candidate.changedOutside);
      if (!entry) {
        refuse('The new kept cloud copy cannot be confirmed.', 'verify');
      }
      let cleanup = prune;
      if (prune) {
        try {
          if (!await this.checkKeptEntry(entry, context.connection)) {
            refuse('The new kept cloud copy cannot be confirmed.', 'verify');
          }
        } catch (error) {
          if (!['offline', 'unavailable', 'timeout'].includes(error?.code)) throw error;
          // The copy was byte-verified before restore; preserve its reference if the network drops afterward.
          cleanup = false;
        }
      }
      const reference = await this.rememberKept(context, entry, authorize);
      if (cleanup) await this.pruneKept(context);
      return reference;
    });
  }

  async fetchRecordedKept({ connection, stream, consentId, kept } = {}) {
    const context = syncContext({ connection, stream, consentId });
    if (!validKept(kept) || kept.connection !== connection) {
      refuse('That kept backup cannot be found.', 'invalid');
    }
    requireSyncContext(await this.records.read(), context);
    const ledger = await this.keptLedger();
    const entry = ledger?.entries.find((candidate) => canonical(keptReference(candidate)) === canonical(kept)
      && candidate.verified && !candidate.deleting && !candidate.changedOutside);
    if (!entry) refuse('That kept backup is no longer recorded. Nothing was changed.', 'gone');
    const item = await this.retainedByName(kept.name, context.connection, kept.id);
    const checked = await this.fetchBackup(item, { connection: context.connection, expectedByteDigest: kept.byteDigest });
    const backup = await parseCompleteBackup(checked.text, { cryptoProvider: this.cryptoProvider });
    if (backup.digest !== kept.contentDigest || await digestPersonalBackup(backup, this.cryptoProvider) !== kept.personalDigest) {
      refuse('That kept backup was changed, so nothing was restored.', 'invalid');
    }
    await this.retainedByName(kept.name, context.connection, kept.id);
    requireSyncContext(await this.records.read(), context);
    return checked;
  }

  async fetchKeptBackup({ connection, stream, consentId, kept } = {}) {
    const context = syncContext({ connection, stream, consentId });
    if (!validKept(kept)) refuse('That kept backup cannot be found.', 'invalid');
    if (kept.connection !== context.connection) {
      refuse('That kept backup belongs to an earlier cloud connection. Nothing was changed.', 'gone');
    }
    const stillKept = async () => {
      const { record, sync, syncPresent } = await this.records.readSync();
      const current = requireSyncContext(record, context);
      const state = syncPresent ? checkSyncState(sync) : null;
      if (!sameSyncContext(state, current) || canonical(state.kept) !== canonical(kept)) {
        refuse('That kept backup is no longer the one offered. Nothing was changed.', 'gone');
      }
    };
    await stillKept();
    const item = await this.retainedByName(kept.name, context.connection, kept.id);
    const checked = await this.fetchBackup(item, { connection: context.connection, expectedByteDigest: kept.byteDigest });
    const backup = await parseCompleteBackup(checked.text, { cryptoProvider: this.cryptoProvider });
    if (backup.digest !== kept.contentDigest || await digestPersonalBackup(backup, this.cryptoProvider) !== kept.personalDigest) {
      refuse('That kept backup was changed, so it was not restored. Nothing was changed.', 'invalid');
    }
    await this.retainedByName(kept.name, context.connection, item.id);
    await stillKept();
    return checked;
  }

  // For the coordinator: this browser's newest verified backup, read afresh every time, because another
  // tab may have made one meanwhile. It counts only while the host still holds the connection this browser
  // agreed to: after a reconnect to another account the record cannot know about, nothing is up to date.
  async lastUploaded({ connection } = {}) {
    const record = await this.record();
    const newest = record?.consent && record.consent.connection === connection ? record.validated[0] : undefined;
    return newest ? { personalDigest: newest.personalDigest, uploadedAt: newest.uploadedAt } : null;
  }

  // Consent belongs to this browser and names the connection it was given for. The first consent starts
  // the stream. A record that cannot be read is replaced by a new stream rather than trusted for a number,
  // and its old files then show in discovery as another device's. Backups verified under another
  // connection, perhaps another account, are not in this one, so they no longer count as made.
  async recordConsent({ connection, provider, device } = {}) {
    const consent = { connection, provider, at: this.now(), id: this.randomId() };
    if (!validConsent(consent)) refuse('That connection cannot be used for cloud backup.', 'invalid');
    const label = cloudDeviceLabel(device);
    const stream = this.randomId();
    return saying('Cloud backup was not turned on.', async () => {
      await this.records.write((current) => {
        let record;
        try { record = current === null ? null : checkRecord(current); } catch { record = null; }
        if (!record) return { version: 1, stream, nextGeneration: 1, device: label, consent, validated: [], suspended: null };
        const validated = record.consent?.connection === consent.connection ? record.validated : [];
        return { ...record, device: label, consent, validated, suspended: null };
      });
      const held = await this.record();
      if (!held || canonical(held.consent) !== canonical(consent)) throw recordLost();
      return held;
    });
  }

  // Withdrawn before anything is deleted, and kept, so automatic backup stays stopped even if a deletion
  // stops part way. The stream and its counter stay, so no number is ever used twice; what was verified
  // is forgotten, because a later consent may find those files deleted or in another account.
  async withdrawConsent() {
    return saying('Cloud backup may still be on.', () => this.withdraw());
  }

  async withdraw() {
    await this.records.write((current) => (current === null ? undefined : { ...checkRecord(current), consent: null, validated: [], suspended: null }));
    const held = await this.record();
    if (held && (held.consent !== null || held.validated.length > 0)) throw recordLost();
    return held;
  }

  // Before an erase writes anything, consent is set aside in the record rather than withdrawn: no tab's
  // allocate takes a number while it is, and what was verified and the counter stay. The erase then forgets
  // the record, or, having erased nothing, puts the same consent back. A page that dies in between leaves it
  // set aside, and nothing puts it back by itself, because a part-way erase must not be backed up over the
  // good copies (stage 3 review, S3a-7). True when there was consent to set aside. `found` is called once the
  // write has found consent to set aside, before it commits, so a caller whose read-back then fails knows any
  // consent still set aside may be its own, and that one set aside earlier is not (#996 stage 2 review).
  async suspendConsent(found = () => {}) {
    let suspended = null;
    await this.records.write((current) => {
      const record = current === null ? null : checkRecord(current);
      if (!record?.consent) return undefined;
      suspended = record.consent;
      found();
      return { ...record, consent: null, suspended };
    });
    if (suspended === null) return false;
    const held = await this.record();
    if (!held || held.consent !== null || canonical(held.suspended) !== canonical(suspended)) throw recordLost();
    return true;
  }

  // Only consent still set aside goes back: consent given again meanwhile, or withdrawn, wins.
  async resumeConsent() {
    let resumed = null;
    await this.records.write((current) => {
      const record = current === null ? null : checkRecord(current);
      if (!record || record.consent !== null || record.suspended === null) return undefined;
      resumed = record.suspended;
      return { ...record, consent: resumed, suspended: null };
    });
    if (resumed === null) return false;
    const held = await this.record();
    if (!held || canonical(held.consent) !== canonical(resumed) || held.suspended !== null) throw recordLost();
    return true;
  }

  // The worker lock, held until the function this resolves to is called: an erase holds it from setting
  // consent aside until it has forgotten or restored the record, so no tab's backup runs meanwhile. Resolves
  // once held, after any backup another tab has under way.
  async hold() {
    if (!this.locks) return () => {};
    let release;
    const released = new Promise((resolve) => { release = resolve; });
    await new Promise((granted, failed) => {
      this.locks.request(CLOUD_BACKUP_LOCK, { mode: 'exclusive' }, () => { granted(); return released; }).catch(failed);
    });
    return release;
  }

  // Erase: this browser forgets cloud backup altogether. Its next consent starts a new stream, so no number
  // is used twice, and this stream's files stay in the account, where discovery shows them as another
  // device's. Read back raw, because a record too damaged to check is exactly the one being removed.
  async forget() {
    return saying('Cloud backup may still be on.', async () => {
      await this.records.forget();
      const { record, syncPresent } = await this.records.readSync();
      const { present: declinesPresent } = await this.records.readSyncDeclines();
      const { ledgerPresent } = await this.records.readKeptLedger();
      const { present: witnessPresent } = await this.records.readKeptWitness();
      const { present: keptPendingPresent } = await this.records.readKeptPending();
      if (record !== null || syncPresent || declinesPresent || ledgerPresent || witnessPresent || keptPendingPresent) throw recordLost();
      return null;
    });
  }

  // The number is committed and read back before the file it names exists, so no crash, kill or second
  // tab can hand it out again. Inside one transaction, so two tabs can never read the same counter.
  async allocate() {
    let taken = null;
    await this.records.write((current) => {
      if (current === null) refuse(NOT_ON, 'refused');
      const record = checkRecord(current);
      if (record.consent === null) refuse(NOT_ON, 'refused');
      taken = { stream: record.stream, generation: record.nextGeneration, device: record.device, consent: record.consent };
      return { ...record, nextGeneration: record.nextGeneration + 1 };
    });
    const held = await this.record();
    if (!held || held.stream !== taken.stream || held.nextGeneration <= taken.generation) throw recordLost();
    return taken;
  }

  // Keeps the two highest generations, so a late acknowledgement can never displace a newer one. The
  // whole consent is compared, not its connection alone: consent withdrawn and given again for the same
  // connection, as a deletion in one tab and consent in another can do, would otherwise count a backup
  // that the deletion then removes (stage 1 review, L1).
  async acknowledge({ stream, generation, consent, personalDigest, uploadedAt }) {
    const entry = { generation, personalDigest, uploadedAt };
    await this.records.write((current) => {
      const record = current === null ? null : checkRecord(current);
      // Erased, started afresh, withdrawn or agreed to again while this backup was made: its file belongs
      // to a stream, an account or a consent this record no longer describes, so it must not count.
      if (!record || record.stream !== stream || canonical(record.consent) !== canonical(consent)) {
        refuse('Cloud backup was turned off, or agreed to again, while this backup was made, so it does not count as made.', 'refused');
      }
      const validated = [entry, ...record.validated.filter((held) => held.generation !== generation)]
        .sort((a, b) => b.generation - a.generation).slice(0, 2);
      return { ...record, validated };
    });
    const held = await this.record();
    if (!held || held.stream !== stream || !held.validated.some((verified) => verified.generation >= generation)) throw recordLost();
    return held;
  }

  // A device or system backup can bring this record back with a counter behind the files its stream
  // already has: a phone restored from an older backup, a new one set up from it while the old one still
  // runs, or a profile restored the same way. Nothing on any platform says so, so the list before every
  // create is the check (M6). A file of this stream at or above the number taken, or a create refused with
  // 'exists', means another copy of this record is in use, so this browser starts a new stream rather than
  // use that number. The old stream's files stay, because the other copy may still be making them. With
  // `allocate`, the new stream's first number is taken in the same write, for the backup under way.
  async restream(taken, { allocate }) {
    const stream = this.randomId();
    let fresh = null;
    await this.records.write((current) => {
      const record = current === null ? null : checkRecord(current);
      if (!record || record.stream !== taken.stream || canonical(record.consent) !== canonical(taken.consent)) {
        refuse('Cloud backup was turned off, or agreed to again, while this backup was being made, so nothing was uploaded.', 'refused');
      }
      fresh = { stream, generation: 1, device: record.device, consent: record.consent };
      return { ...record, stream, nextGeneration: allocate ? 2 : 1, validated: [] };
    });
    const held = await this.record();
    if (!held || held.stream !== stream || (allocate && held.nextGeneration <= fresh.generation)) throw recordLost();
    return fresh;
  }

  // 128 random bits as hex, for a stream or a consent.
  randomId() {
    if (typeof this.cryptoProvider?.getRandomValues !== 'function') {
      refuse('This browser cannot make random ids, so cloud backup is unavailable here.', 'unsupported');
    }
    return hex(this.cryptoProvider.getRandomValues(new Uint8Array(16)));
  }

  // ---------------------------------------------------------------- bytes

  supported() {
    const { CompressionStream: Compress, DecompressionStream: Decompress, Blob: Bytes } = this.streams ?? {};
    if (typeof Compress !== 'function' || typeof Decompress !== 'function' || typeof Bytes !== 'function'
      || typeof this.cryptoProvider?.subtle?.digest !== 'function') {
      refuse('This browser cannot compress or check cloud backups, so cloud backup is unavailable here.', 'unsupported');
    }
  }

  async digest(bytes) {
    let hash;
    try { hash = await this.cryptoProvider.subtle.digest('SHA-256', bytes); }
    catch { refuse('A cloud backup digest could not be computed.', 'hash'); }
    return hex(new Uint8Array(hash));
  }

  async gzip(bytes) {
    const { Blob: Bytes, CompressionStream: Compress } = this.streams;
    return collect(new Bytes([bytes]).stream().pipeThrough(new Compress('gzip')), Infinity);
  }

  // null for anything that is not one whole gzip stream, or that comes out larger than the cap. Fed a
  // kibibyte at a time, each slice written only once the output before it has been read: a browser may
  // inflate a whole written chunk in one step, and deflate expands a kibibyte to about a mebibyte at
  // most, so a planted file that decompresses without end costs the cap and one slice's output.
  async gunzip(bytes) {
    let stream;
    try { stream = new this.streams.DecompressionStream('gzip'); } catch { return null; }
    const writer = stream.writable.getWriter();
    const feeding = (async () => {
      for (let at = 0; at < bytes.byteLength; at += INFLATE_SLICE) await writer.write(bytes.subarray(at, at + INFLATE_SLICE));
      await writer.close();
    })();
    feeding.catch(() => {});
    let plain;
    try { plain = await collect(stream.readable, this.maxBytes); } catch { plain = null; }
    if (plain === null) {
      await writer.abort().catch(() => {});
      return null;
    }
    try { await feeding; } catch { return null; }
    return plain;
  }

  // Everything this version can say about one file, or null when any check fails. Nothing in a file is
  // trusted: the folder is visible on OneDrive, so a person, or anything with access to the account, can
  // rename, edit or add files there.
  async decode(bytes, { id, stream, generation }) {
    if (!bytes || bytes.byteLength > this.maxBytes) return null;
    const plain = await this.gunzip(bytes);
    if (!plain) return null;
    let envelope;
    try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plain)); }
    catch { return null; }
    if (!exactFields(envelope, ENVELOPE_FIELDS) || envelope.format !== CLOUD_ENVELOPE_FORMAT
      || envelope.version !== CLOUD_ENVELOPE_VERSION || envelope.stream !== stream || envelope.generation !== generation
      || !validDevice(envelope.device) || !nonNegative(envelope.createdAt) || !object(envelope.backup)) return null;
    let text;
    let backup;
    try {
      text = canonical(envelope.backup);
      backup = await parseCompleteBackup(text, { cryptoProvider: this.cryptoProvider });
    } catch { return null; }
    return {
      id, stream, generation, device: envelope.device, createdAt: envelope.createdAt, size: bytes.byteLength,
      summary: completeBackupSummary(backup), text,
    };
  }

  // Ordinary backups and independent kept copies have distinct names so ordinary pruning cannot remove
  // a kept copy, including when another installation owns a copy of this stream.
  async listed(connection) {
    const items = await this.call('list', { connection });
    if (!Array.isArray(items)) refuse('The cloud account did not answer with a list.', 'invalid');
    const known = [];
    const retained = [];
    const nameCounts = new Map();
    const seenIds = new Set();
    const duplicateIds = new Set();
    let unrecognized = 0;
    let unknownBackups = 0;
    let malformedRetained = 0;
    for (const value of items) {
      if (typeof value?.id === 'string' && value.id.length > 0) {
        if (seenIds.has(value.id)) duplicateIds.add(value.id);
        seenIds.add(value.id);
      }
      const backupName = typeof value?.name === 'string' ? parseCloudBackupName(value.name) : null;
      const keptName = typeof value?.name === 'string' ? parseKeptBackupName(value.name) : null;
      if (backupName || keptName) nameCounts.set(value.name, (nameCounts.get(value.name) ?? 0) + 1);
      const item = itemOf(value);
      const parsed = item && backupName;
      const kept = item && keptName;
      if (parsed) known.push({ ...item, ...parsed });
      else if (kept) retained.push({ ...item, ...kept });
      else if (typeof value?.name === 'string' && value.name.startsWith('recap-page-kept-v1-')) malformedRetained += 1;
      else {
        unrecognized += 1;
        if (typeof value?.name === 'string' && value.name.startsWith('recap-page-backup-')) unknownBackups += 1;
      }
    }
    return { known, retained, nameCounts, unrecognized, ids: seenIds, duplicateIds, malformedRetained, unknownBackups };
  }

  async discard(id, connection) {
    try { await this.call('delete', id, { connection }); } catch { /* removed by a later backup's pruning */ }
  }

  // A delete refused as not found means the file is already gone, which is what a delete is for, however
  // the provider says it (stage 1 review, L2). Pruning goes on past it, and deletion counts it as deleted.
  async remove(id, connection) {
    try { await this.call('delete', id, { connection }); }
    catch (error) { if (error?.code !== 'not-found') throw error; }
  }

  // The envelope, compressed. Keys in sorted order, which makes it the envelope's canonical form without
  // serializing the backup a second time. The cap is on the envelope before it is compressed.
  async pack(text, { stream, generation, device }) {
    const envelope = `{"backup":${text},"createdAt":${this.now()},"device":${JSON.stringify(device)},`
      + `"format":"${CLOUD_ENVELOPE_FORMAT}","generation":${generation},"stream":"${stream}","version":${CLOUD_ENVELOPE_VERSION}}`;
    const plain = new TextEncoder().encode(envelope);
    const bytes = plain.byteLength > this.maxBytes ? null : await this.gzip(plain);
    if (!bytes || bytes.byteLength > this.maxBytes) {
      refuse(`This backup is larger than the ${mebibytes(this.maxBytes)} MiB a cloud backup can be, so it was not uploaded.`, 'oversize');
    }
    return bytes;
  }

  // ---------------------------------------------------------------- one backup

  // Per backup: one list, one create, one read and at most two deletes, the second only while files left
  // behind earlier remain. The list comes before the create, so a stream that another copy of this record
  // has gone ahead in is caught before any number of it is used (M6), and pruning works from that list. A
  // transport whose provider keeps two items under one name adds a second list, after the create.
  // Resolves only once the record holds this backup as verified, which is what the coordinator's spacing
  // and comparison read.
  async upload({ text, backup, personalDigest } = {}) {
    if (typeof text !== 'string' || !object(backup) || typeof personalDigest !== 'string' || !DIGEST.test(personalDigest)) {
      refuse('The backup to upload is incomplete.', 'invalid');
    }
    // The file holds the complete backup's exact bytes, which are its canonical form.
    if (canonical(backup) !== text) refuse('The backup to upload does not match its own text.', 'invalid');
    this.supported();
    let taken = await saying('Nothing was uploaded.', () => this.allocate());
    const { connection } = taken.consent;
    // Packed before the list, so a backup over the cap never reaches the account. A new stream only
    // shortens the envelope, since its first number has the fewest digits.
    let bytes = await this.pack(text, taken);
    const { known } = await this.listed(connection);
    if (known.some((item) => item.stream === taken.stream && item.generation >= taken.generation)) {
      taken = await saying('Nothing was uploaded.', () => this.restream(taken, { allocate: true }));
      bytes = await this.pack(text, taken);
    }
    const { stream, generation, consent } = taken;
    const name = cloudBackupName(stream, generation);
    const sent = await this.digest(bytes);
    let created;
    try { created = itemOf(await this.call('create', name, bytes, { connection })); }
    catch (error) {
      if (error?.code !== 'exists') throw error;
      // Only another copy of this record can have made this name. The number is never tried again, and
      // the next backup is the new stream's first.
      await saying('Nothing was uploaded.', () => this.restream(taken, { allocate: false }));
      refuse(TAKEN, 'exists');
    }
    if (!created || created.name !== name) {
      if (created) await this.discard(created.id, connection);
      refuse('The cloud copy was not kept under the name it was given, so it was removed and will be made again.', 'verify');
    }
    // A provider that keeps two items under one name, as Google Drive does, can now hold another copy's file
    // of this stream and number, made from a copy of this record after this backup's list. Discovery shows a
    // number once, so one of the two could not be chosen until its copy's data changed. Listing again finds
    // the other: this file goes, the stream parts here, and the backup is made again, as the new stream's
    // first, without waiting for a change (stage 4 review, S4b-1).
    if (this.transport.duplicateNames === true) {
      const { known: now } = await this.listed(connection);
      if (now.some((item) => item.stream === stream && item.generation === generation && item.id !== created.id)) {
        await this.discard(created.id, connection);
        await saying('Nothing was uploaded.', () => this.restream(taken, { allocate: false }));
        refuse(TAKEN, 'exists');
      }
    }
    const returned = bytesOf(await this.call('read', created.id, { connection, purpose: 'verify' }));
    if (!returned || await this.digest(returned) !== sent) {
      await this.discard(created.id, connection);
      refuse('The cloud copy did not read back as it was sent, so it was removed and will be made again.', 'verify');
    }
    const record = await saying('The backup was uploaded, but it does not count as made.',
      () => this.acknowledge({ stream, generation, consent, personalDigest, uploadedAt: this.now() }));
    // The backup is made and verified, so a failure from here on only leaves a file for a later backup.
    try { await this.prune(record, known, connection); }
    catch (error) {
      if (error instanceof CloudBackupError && error.code === 'storage') {
        throw new CloudBackupError(`${error.message} This backup was uploaded and checked, but older copies were not removed.`, 'storage');
      }
      // Other delete failures can be retried by a later backup.
    }
    return { stream, generation, name };
  }

  // This stream's files older than its second-newest verified generation, oldest first, from the list made
  // before this backup's create. Files of other streams, unrecognized files and anything newer are never
  // touched.
  async prune(record, known, connection) {
    const floor = record.validated[1]?.generation;
    if (floor === undefined) return 0;
    const current = await this.record();
    if (!current || current.stream !== record.stream || canonical(current.consent) !== canonical(record.consent)) return 0;
    const stale = known.filter((item) => item.stream === record.stream && item.generation < floor)
      .sort((a, b) => a.generation - b.generation).slice(0, CLOUD_PRUNE_PER_BACKUP);
    for (const item of stale) await this.remove(item.id, connection);
    return stale.length;
  }

  // ---------------------------------------------------------------- discovery and restore

  syncCandidates({ known, nameCounts, duplicateIds, unknownBackups }, stream) {
    if (unknownBackups) refuse('A cloud backup uses a format this version cannot check. Update the app, then check again.', 'invalid');
    const groups = new Map();
    for (const item of known) {
      if (item.stream === stream) continue;
      const previous = groups.get(item.stream);
      if (!previous || item.generation > previous.generation) groups.set(item.stream, item);
    }
    if (!Number.isSafeInteger(this.limits.streams) || groups.size > this.limits.streams) {
      refuse('There are too many devices to check safely. No progress was changed.', 'invalid');
    }
    const latest = [...groups.values()].sort((a, b) => a.stream < b.stream ? -1 : a.stream > b.stream ? 1 : 0);
    if (latest.some((item) => nameCounts.get(item.name) !== 1 || duplicateIds.has(item.id)
      || (item.size !== null && item.size > this.maxBytes))) {
      refuse('A newest cloud backup cannot be identified safely. No progress was changed.', 'invalid');
    }
    return latest;
  }

  async syncListing({ connection, stream, consentId } = {}) {
    const context = syncContext({ connection, stream, consentId });
    requireSyncContext(await this.records.read(), context);
    const selected = this.syncCandidates(await this.listed(context.connection), stream);
    requireSyncContext(await this.records.read(), context);
    return selected.map(({ id, name, stream: itemStream, generation, size }) =>
      ({ id, name, stream: itemStream, generation, size }));
  }

  async discoverSync({ connection, stream, consentId } = {}) {
    const context = syncContext({ connection, stream, consentId });
    this.supported();
    const selected = await this.syncListing(context);
    const result = [];
    for (const item of selected) {
      const checked = await this.inspect(item, context.connection, { includeByteDigest: true });
      if (!checked) refuse('A newest cloud backup could not be checked. No progress was changed.', 'invalid');
      const backup = await parseCompleteBackup(checked.text, { cryptoProvider: this.cryptoProvider });
      const digest = await digestPersonalBackup(backup, this.cryptoProvider);
      const read = Object.values(backup.components.reader.read);
      const identity = { ...checked };
      delete identity.text;
      result.push({
        ...identity, name: item.name, listedSize: item.size, digest, contentDigest: backup.digest, readCount: read.length,
        lastReadAt: read.reduce((latest, value) => Math.max(latest, value), 0) || null,
      });
    }
    const current = await this.syncListing(context);
    if (canonical(selected) !== canonical(current)) {
      refuse('Cloud backups changed while they were being checked. Check again.', 'raced');
    }
    requireSyncContext(await this.records.read(), context);
    return result;
  }

  // What is already in the account, shown before this browser's first upload and whenever asked: per
  // stream, the newest file that passes every check and the one before it. It only lists and reads, so it
  // never creates anything in the account. The connection is the one the host reports, since discovery
  // comes before this browser's consent.
  async discover({ connection, includeRetained = false } = {}) {
    this.supported();
    const named = connectionOf(connection);
    if (typeof includeRetained !== 'boolean') refuse('The kept-backup discovery option is invalid.', 'invalid');
    const own = await this.record().then((record) => record?.stream ?? null, () => null);
    const { known, retained, nameCounts, unrecognized, duplicateIds, malformedRetained } = await this.listed(named);
    const groups = new Map();
    let oversized = 0;
    for (const item of known) {
      if (item.size !== null && item.size > this.maxBytes) { oversized += 1; continue; }
      if (!groups.has(item.stream)) groups.set(item.stream, []);
      groups.get(item.stream).push(item);
    }
    const newest = (items) => Math.max(...items.map((item) => item.created ?? 0));
    const ordered = [...groups].map(([stream, items]) => ({ stream, items: items.sort((a, b) => b.generation - a.generation) }))
      .sort((a, b) => Number(b.stream === own) - Number(a.stream === own) || newest(b.items) - newest(a.items)
        || (a.stream < b.stream ? -1 : 1));
    const devices = [];
    for (const { stream, items } of ordered.slice(0, this.limits.streams)) {
      const found = [];
      let invalid = 0;
      let reads = 0;
      for (const item of items) {
        if (found.length === 2 || reads === this.limits.readsPerStream) break;
        // Google allows one name twice; a generation already shown is not shown again.
        if (found.some((held) => held.generation === item.generation)) continue;
        reads += 1;
        const checked = await this.inspect(item, named);
        if (checked) {
          const shown = { ...checked };
          delete shown.text;
          found.push(shown);
        } else if (checked === null) invalid += 1;
      }
      devices.push({ stream, own: stream === own, current: found[0] ?? null, previous: found[1] ?? null, invalid, files: items.length });
    }
    if (!includeRetained) {
      return {
        own, devices, omitted: Math.max(0, ordered.length - this.limits.streams),
        unrecognized: unrecognized + oversized + retained.length + malformedRetained,
      };
    }
    let retainedInvalid = malformedRetained;
    const candidates = retained.filter((item) => {
      if (duplicateIds.has(item.id) || nameCounts.get(item.name) !== 1 || (item.size !== null && item.size > this.maxBytes)) {
        retainedInvalid += 1;
        return false;
      }
      return true;
    }).sort((a, b) => (b.created ?? 0) - (a.created ?? 0)
      || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const limit = this.limits.retainedReads ?? CLOUD_DISCOVERY_LIMITS.retainedReads;
    if (!Number.isSafeInteger(limit) || limit < 0) refuse('The kept-backup discovery limit is invalid.', 'invalid');
    let retainedOmitted = Math.max(0, candidates.length - limit);
    const checkedRetained = [];
    for (const item of candidates.slice(0, limit)) {
      const checked = await this.inspect(item, named, { includeByteDigest: true });
      if (checked === undefined) { retainedOmitted += 1; continue; }
      if (checked === null) { retainedInvalid += 1; continue; }
      const shown = { ...checked, name: item.name, contentDigest: JSON.parse(checked.text).digest };
      delete shown.text;
      checkedRetained.push(shown);
    }
    let visibleRetained = checkedRetained;
    if (checkedRetained.length) {
      const { retained: latestRetained, nameCounts: latestCounts, duplicateIds: latestDuplicates } = await this.listed(named);
      const latestByName = new Map();
      for (const item of latestRetained) {
        if (!latestByName.has(item.name)) latestByName.set(item.name, []);
        latestByName.get(item.name).push(item);
      }
      visibleRetained = checkedRetained.filter((shown) => {
        const matches = latestByName.get(shown.name) ?? [];
        const count = latestCounts.get(shown.name) ?? 0;
        if (count > 1) { retainedInvalid += count; return false; }
        const item = matches[0];
        if (!item || item.id !== shown.id) { retainedOmitted += 1; return false; }
        if (latestDuplicates.has(item.id) || (item.size !== null && item.size > this.maxBytes)) {
          retainedInvalid += 1;
          return false;
        }
        if (item.size !== null && item.size !== shown.size) { retainedOmitted += 1; return false; }
        return true;
      });
    }
    return {
      own, devices, retained: visibleRetained, retainedInvalid, retainedOmitted,
      omitted: Math.max(0, ordered.length - this.limits.streams), unrecognized: unrecognized + oversized,
    };
  }

  // The checked file, null when it fails a check, or undefined when it was gone by the time it was read. A
  // read refused as too large is a file that fails a check, since its stored bytes pass the cap.
  async inspect(item, connection, { expectedByteDigest, includeByteDigest = false, purpose = 'discover' } = {}) {
    let bytes;
    try { bytes = bytesOf(await this.call('read', item.id, { connection, purpose })); }
    catch (error) {
      if (error?.code === 'not-found') return undefined;
      if (error?.code === 'too-large') return null;
      throw error;
    }
    if (!bytes || bytes.byteLength > this.maxBytes) return null;
    const byteDigest = expectedByteDigest !== undefined || includeByteDigest ? await this.digest(bytes) : null;
    if (expectedByteDigest !== undefined && byteDigest !== expectedByteDigest) return null;
    const checked = await this.decode(bytes, item);
    return checked && includeByteDigest ? { ...checked, byteDigest } : checked;
  }

  // A backup chosen from discovery, read and checked again, because the account may have changed since.
  // Its text goes to the complete restore engine, which checks it once more and journals before writing.
  async fetchBackup({ id, stream, generation } = {}, { connection, expectedByteDigest } = {}) {
    this.supported();
    const named = connectionOf(connection);
    if (typeof id !== 'string' || id.length === 0 || typeof stream !== 'string' || !STREAM.test(stream)
      || !Number.isSafeInteger(generation) || generation < 1
      || (expectedByteDigest !== undefined && !validDigest(expectedByteDigest))) refuse('That backup cannot be found.', 'invalid');
    const checked = await this.inspect({ id, stream, generation }, named, { expectedByteDigest, purpose: 'restore' });
    if (checked === undefined) refuse('That backup is no longer in the cloud account. Nothing was changed.', 'gone');
    if (checked === null) refuse('That backup was changed or cannot be read, so it was not restored. Nothing was changed.', 'invalid');
    return checked;
  }

  async retainedByName(name, connection, expectedId = null) {
    const { retained, nameCounts, duplicateIds } = await this.listed(connection);
    const candidates = retained.filter((item) => item.name === name);
    if ((nameCounts.get(name) ?? 0) > 1 || candidates.length > 1
      || candidates.some((item) => duplicateIds.has(item.id))) {
      refuse('More than one kept cloud copy has that name or identity, so none was selected.', 'invalid');
    }
    if (candidates.length === 0) {
      if (nameCounts.has(name)) refuse('That kept backup cannot be checked, so nothing was restored.', 'invalid');
      refuse('That kept backup is no longer in the cloud account. Nothing was changed.', 'gone');
    }
    const item = candidates[0];
    if (expectedId !== null && item.id !== expectedId) {
      refuse('That kept backup is no longer the one selected. Nothing was changed.', 'gone');
    }
    if (item.size !== null && item.size > this.maxBytes) {
      refuse('That kept backup is too large to check, so nothing was restored.', 'invalid');
    }
    return item;
  }

  async fetchRetainedBackup({ id, name, stream, generation, contentDigest, byteDigest, device, createdAt } = {}, { connection } = {}) {
    const named = connectionOf(connection);
    const parsed = parseKeptBackupName(name);
    if (typeof id !== 'string' || id.length === 0 || !parsed || parsed.stream !== stream || parsed.generation !== generation
      || !validDigest(contentDigest) || !validDigest(byteDigest) || !validDevice(device) || !nonNegative(createdAt)) {
      refuse('That kept backup cannot be found.', 'invalid');
    }
    const item = await this.retainedByName(name, named, id);
    const checked = await this.fetchBackup(item, { connection: named, expectedByteDigest: byteDigest });
    if (JSON.parse(checked.text).digest !== contentDigest || checked.device !== device || checked.createdAt !== createdAt) {
      refuse('That kept backup was changed, so it was not restored. Nothing was changed.', 'invalid');
    }
    await this.retainedByName(name, named, id);
    return checked;
  }

  // ---------------------------------------------------------------- deleting

  // Consent is withdrawn before the lock, so another tab cannot count a backup that deletion removes.
  // Independently kept files are selected only from the ledger for this exact connection.
  async deleteOwnBackups({ connection } = {}) {
    const named = connectionOf(connection);
    const record = await saying('Nothing was deleted, and cloud backup may still be on.', () => this.withdraw());
    if (!record) return { deleted: 0, failed: [] };
    return this.exclusive(async () => {
      const failed = [];
      let ledger = null;
      try { ledger = await this.keptLedger(); }
      catch (error) {
        if (!(error instanceof CloudBackupError) || error.code !== 'storage') throw error;
        failed.push({ id: null, name: null, code: 'storage' });
      }
      const retained = ledger?.entries.filter((entry) => entry.connection === named) ?? [];
      const earlier = ledger?.entries.filter((entry) => entry.connection !== named).length ?? 0;
      const { known } = await this.listed(named);
      const own = known.filter((item) => item.stream === record.stream).sort((a, b) => a.generation - b.generation);
      let deleted = 0;
      let stopped = null;
      let attention = 0;
      for (const item of own) {
        if (stopped) { failed.push({ id: item.id, name: item.name, code: stopped }); continue; }
        try {
          await this.remove(item.id, named);
          deleted += 1;
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'transient';
          failed.push({ id: item.id, name: item.name, code });
          // Every later delete would be refused the same way, so they are not sent.
          if (STOPS_DELETION.has(code)) stopped = code;
        }
      }
      for (const entry of retained) {
        if (stopped) {
          failed.push({ id: entry.id, name: entry.name, code: stopped });
          continue;
        }
        let removed = false;
        try {
          const checked = entry.id !== null ? entry : await this.checkKeptBeforeDeletion(entry, named);
          if (checked) {
            const marked = await this.markKeptDeleting(checked);
            await this.finishKeptDeletion(marked, named, () => { removed = true; deleted += 1; });
          } else {
            await this.markKeptForAttention(entry);
            attention += 1;
          }
        } catch (error) {
          const code = typeof error?.code === 'string' ? error.code : 'transient';
          failed.push({
            id: entry.id, name: entry.name, code, ...(removed ? { deleted: true } : {}),
            ...(error?.changedOutside ? { changedOutside: true } : {}),
          });
          if (STOPS_DELETION.has(code)) stopped = code;
        }
      }
      return { deleted, failed, ...(earlier ? { earlier } : {}), ...(attention ? { attention } : {}) };
    });
  }

  async exclusive(operation, { signal } = {}) {
    if (!this.locks) return operation();
    return this.locks.request(CLOUD_BACKUP_LOCK, { mode: 'exclusive', ...(signal ? { signal } : {}) }, operation);
  }
}
