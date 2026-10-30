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
export const CLOUD_DISCOVERY_LIMITS = Object.freeze({ streams: 16, readsPerStream: 4 });
// The longest each transport operation may take, which every provider stays within. A read or a create
// moves at most 32 MiB, and ten minutes carries that at 56 KB a second, a slow mobile link. A list may
// follow many pages, and on the Windows host it first waits for a create still under way. The engine
// waits the grace beyond each, for the reply to arrive, and then treats the operation as timed out.
export const CLOUD_TRANSPORT_DEADLINES_MS = Object.freeze({ list: 120_000, read: 600_000, create: 600_000, delete: 30_000 });
export const CLOUD_DEADLINE_GRACE_MS = 15_000;

const NAME = /^recap-page-backup-v1-([a-f0-9]{32})-([1-9][0-9]{0,15})\.json\.gz$/;
const STREAM = /^[a-f0-9]{32}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const PROVIDER = /^[a-z][a-z0-9-]{0,31}$/;
const RECORD_STORE = 'stream';
const RECORD_SLOT = 'record';
const RECORD_OPEN_MS = 5000;
// suspended holds consent an erase has set aside until it forgets or restores the record (S3a-7).
const RECORD_FIELDS = ['consent', 'device', 'nextGeneration', 'stream', 'suspended', 'validated', 'version'];
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
const STOPS_DELETION = new Set(['needs-sign-in', 'needs-consent', 'not-connected']);

export class CloudBackupError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'CloudBackupError';
    this.code = code;
  }
}

function refuse(message, code) { throw new CloudBackupError(message, code); }
// A record failure can stop any operation, so these say only what went wrong, and each operation adds what
// that left undone. None claims an outcome its operation did not have (stage 1 review, L3).
const RECORD_LOST = 'This browser could not keep its cloud backup record.';
const RECORD_UNREADABLE = 'This browser\'s cloud backup record cannot be read.';
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
function hex(bytes) { return [...bytes].map((value) => value.toString(16).padStart(2, '0')).join(''); }
const mebibytes = (bytes) => bytes / (1024 * 1024);
// The connection a page names for discovery, a restore or a deletion, as the host reported it.
function connectionOf(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 128 || !controlFree(value)) {
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
  return exactFields(value, CONSENT_FIELDS) && typeof value.connection === 'string' && value.connection.length > 0
    && value.connection.length <= 128 && controlFree(value.connection)
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

// One record in a database of its own: not a response cache, so cache cleanup never reaches it. Every
// write asks for strict durability, so its complete event means the record is on disk.
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
  async function run(mode, operation) {
    const db = await open();
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
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(refusal ?? recordLost());
      tx.onerror = tx.onabort;
      try {
        operation(tx.objectStore(RECORD_STORE), {
          set: (result) => { value = result; },
          refuse: (error) => {
            refusal = error;
            tx.abort();
          },
        });
      } catch {
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
        let after;
        try { after = change(before); }
        catch (error) { stop(error); return; }
        if (after === undefined) { set({ before, after: before }); return; }
        if (after === null) store.delete(RECORD_SLOT);
        else store.put(after, RECORD_SLOT);
        set({ before, after });
      };
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
  //   read(id, { connection }) resolves to the item's bytes, refusing with 'too-large' an item whose stored
  //   bytes exceed 32 MiB, without returning them, and with 'not-found' one that is gone.
  //   create(name, bytes, { connection }) makes a new item and resolves to it. It never knowingly replaces
  //   one, refuses with 'exists' a name it can tell is taken, and a create refused with any code but
  //   'timeout' never appears later.
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
    if (typeof records?.read !== 'function' || typeof records?.write !== 'function' || typeof clock !== 'function') {
      throw new TypeError('Cloud backup needs its record and a clock.');
    }
    Object.assign(this, { transport, records, cryptoProvider, streams, clock, maxBytes, limits, deadlines, graceMs, setTimer, clearTimer });
    this.locks = typeof locks?.request === 'function' ? locks : null;
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
      await this.records.write(() => null);
      if (await this.records.read() !== null) throw recordLost();
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

  // Every item whose name this version writes, with its stream and generation, and how many others there
  // were. The others are never read or touched.
  async listed(connection) {
    const items = await this.call('list', { connection });
    if (!Array.isArray(items)) refuse('The cloud account did not answer with a list.', 'invalid');
    const known = [];
    let unrecognized = 0;
    for (const value of items) {
      const item = itemOf(value);
      const parsed = item && parseCloudBackupName(item.name);
      if (parsed) known.push({ ...item, ...parsed });
      else unrecognized += 1;
    }
    return { known, unrecognized };
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
    const returned = bytesOf(await this.call('read', created.id, { connection }));
    if (!returned || await this.digest(returned) !== sent) {
      await this.discard(created.id, connection);
      refuse('The cloud copy did not read back as it was sent, so it was removed and will be made again.', 'verify');
    }
    const record = await saying('The backup was uploaded, but it does not count as made.',
      () => this.acknowledge({ stream, generation, consent, personalDigest, uploadedAt: this.now() }));
    // The backup is made and verified, so a failure from here on only leaves a file for a later backup.
    try { await this.prune(record, known, connection); } catch { /* deletes may lag */ }
    return { stream, generation, name };
  }

  // This stream's files older than its second-newest verified generation, oldest first, from the list made
  // before this backup's create. Files of other streams, unrecognized files and anything newer are never
  // touched.
  async prune(record, known, connection) {
    const floor = record.validated[1]?.generation;
    if (floor === undefined) return 0;
    const stale = known.filter((item) => item.stream === record.stream && item.generation < floor)
      .sort((a, b) => a.generation - b.generation).slice(0, CLOUD_PRUNE_PER_BACKUP);
    for (const item of stale) await this.remove(item.id, connection);
    return stale.length;
  }

  // ---------------------------------------------------------------- discovery and restore

  // What is already in the account, shown before this browser's first upload and whenever asked: per
  // stream, the newest file that passes every check and the one before it. It only lists and reads, so it
  // never creates anything in the account. The connection is the one the host reports, since discovery
  // comes before this browser's consent.
  async discover({ connection } = {}) {
    this.supported();
    const named = connectionOf(connection);
    const own = await this.record().then((record) => record?.stream ?? null, () => null);
    const { known, unrecognized } = await this.listed(named);
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
    return { own, devices, omitted: Math.max(0, ordered.length - this.limits.streams), unrecognized: unrecognized + oversized };
  }

  // The checked file, null when it fails a check, or undefined when it was gone by the time it was read. A
  // read refused as too large is a file that fails a check, since its stored bytes pass the cap.
  async inspect(item, connection) {
    let bytes;
    try { bytes = bytesOf(await this.call('read', item.id, { connection })); }
    catch (error) {
      if (error?.code === 'not-found') return undefined;
      if (error?.code === 'too-large') return null;
      throw error;
    }
    return this.decode(bytes, item);
  }

  // A backup chosen from discovery, read and checked again, because the account may have changed since.
  // Its text goes to the complete restore engine, which checks it once more and journals before writing.
  async fetchBackup({ id, stream, generation } = {}, { connection } = {}) {
    this.supported();
    const named = connectionOf(connection);
    if (typeof id !== 'string' || id.length === 0 || typeof stream !== 'string' || !STREAM.test(stream)
      || !Number.isSafeInteger(generation) || generation < 1) refuse('That backup cannot be found.', 'invalid');
    const checked = await this.inspect({ id, stream, generation }, named);
    if (checked === undefined) refuse('That backup is no longer in the cloud account. Nothing was changed.', 'gone');
    if (checked === null) refuse('That backup was changed or cannot be read, so it was not restored. Nothing was changed.', 'invalid');
    return checked;
  }

  // ---------------------------------------------------------------- deleting

  // "Delete this device's cloud backups": consent is withdrawn first, then every file of this stream is
  // deleted, every generation, in the account of the connection the host reports. It waits for a backup
  // another tab has under way, so a file that backup creates cannot be missed. Other streams and
  // unrecognized files are never touched.
  async deleteOwnBackups({ connection } = {}) {
    const named = connectionOf(connection);
    const record = await saying('Nothing was deleted, and cloud backup may still be on.', () => this.withdraw());
    if (!record) return { deleted: 0, failed: [] };
    return this.exclusive(async () => {
      const { known } = await this.listed(named);
      const own = known.filter((item) => item.stream === record.stream).sort((a, b) => a.generation - b.generation);
      let deleted = 0;
      let stopped = null;
      const failed = [];
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
      return { deleted, failed };
    });
  }

  async exclusive(operation) {
    if (!this.locks) return operation();
    return this.locks.request(CLOUD_BACKUP_LOCK, { mode: 'exclusive' }, operation);
  }
}
