// The write-once generation protocol: the record and its counter, one backup end to end, generations
// across tabs and restarts, lost replies and late creates, read-back, pruning, refusals, discovery of
// altered and foreign files, restore through the complete restore engine, deleting this device's
// backups, the protocol under the coordinator, and the page's cloud backup that holds them together
// (P02-T05). The provider is a fake transport here; IndexedDB is a fake that schedules transactions as
// browsers do. The real IndexedDB is exercised in Edge separately.

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createGunzip, gunzipSync, gzipSync } from 'node:zlib';
import {
  CLOUD_DEADLINE_GRACE_MS, CLOUD_ENVELOPE_FORMAT, CLOUD_ENVELOPE_VERSION, CLOUD_PRUNE_PER_BACKUP, CLOUD_TRANSPORT_DEADLINES_MS,
  MAX_CLOUD_BACKUP_BYTES, CloudBackupError, CloudBackupProtocol, cloudBackupName, cloudDeviceLabel, createCloudRecordStore,
  parseCloudBackupName,
} from '../src/js/lib/cloudProtocol.js';
import { CLOUD_BACKUP_CADENCE, CloudBackupCoordinator, createSavedChanges, personalDigest } from '../src/js/lib/cloudCoordinator.js';
import { CLOUD_SIGN_IN_POLL_MS, ERASE_HOST_SILENT_DEVICE, browserDeviceLabel, createCloudBackup } from '../src/js/lib/cloudBackup.js';
import { cloudCardStatus, cloudCardWarns, cloudEraseNote, cloudEraseOutcome, cloudSyncQuestion } from '../src/js/views/cloud.js';
import { CompleteRestore, createRestoreJournal } from '../src/js/lib/completeRestore.js';
import { CAPTURE_KEYS, canonical, captureCompleteBackup } from '../src/js/lib/completeBackup.js';
import { createEmptyState, createList, addIssuesToList, exportBackup } from '../src/js/lib/model.js';
import {
  CLOUD_BACKUP_DATABASE, CLOUD_BACKUP_LOCK, CLOUD_SYNC_OFFER_LOCK, CLOUD_SYNC_PENDING_KEY, KEY, SETTINGS_KEY, SIDEBAR_KEY,
} from '../src/js/storage.js';
import { createCloudHostTransport } from '../src/js/lib/cloudHostTransport.js';
import { createICloudTransport } from '../packaging/ios/icloud-web/icloudTransport.js';

const MIB = 1024 * 1024;
const API_BASE = 'https://metadata.example.test/v1';
const CONSENT = Object.freeze({ connection: 'connection-one', provider: 'onedrive', device: 'Edge on Windows' });
// The connection the host holds in most cases, as discovery, restores, deletion and the coordinator name it.
const ON = Object.freeze({ connection: CONSENT.connection });
const OTHER = 'f'.repeat(32);

// ------------------------------------------------------------------ fakes

// IndexedDB as the record store and the restore journal use it: out-of-line keys, read-write
// transactions that run one after another per database and apply their writes only when they commit,
// and callbacks that fire later rather than at once. faults.abort aborts the next commits; faults.drop
// lets the next commits report success without applying anything, which is what a write lost to a
// crash looks like to a later read.
function fakeIndexedDB() {
  const databases = new Map();
  const connections = new Map();
  const turns = new Map();
  const log = [];
  const faults = { abort: 0, drop: 0, open: null };
  const later = (callback) => queueMicrotask(callback);
  const clone = (value) => (value === undefined ? undefined : structuredClone(value));
  function connect(name) {
    const stores = databases.get(name);
    let closed = false;
    const db = {
      onversionchange: null,
      objectStoreNames: { contains: (store) => stores.has(store) },
      createObjectStore(store) { stores.set(store, new Map()); return {}; },
      close() { closed = true; },
      transaction(store, mode = 'readonly', options = {}) {
        if (closed) throw new DOMException('The connection is closing.', 'InvalidStateError');
        if (!stores.has(store)) throw new DOMException('No such store.', 'NotFoundError');
        log.push({ name, mode, durability: options.durability ?? 'default' });
        const data = stores.get(store);
        const previous = mode === 'readwrite' ? (turns.get(name) ?? Promise.resolve()) : Promise.resolve();
        let release = () => {};
        if (mode === 'readwrite') turns.set(name, new Promise((done) => { release = done; }));
        let staged = null;
        let pending = 0;
        let finished = false;
        const tx = { oncomplete: null, onabort: null, onerror: null };
        const finish = (aborted) => {
          if (finished) return;
          finished = true;
          later(() => {
            let failed = aborted;
            if (!failed && mode === 'readwrite' && faults.abort > 0) { faults.abort -= 1; failed = true; }
            if (!failed && mode === 'readwrite' && staged) {
              if (faults.drop > 0) faults.drop -= 1;
              else {
                data.clear();
                for (const [key, value] of staged) data.set(key, value);
              }
            }
            release();
            if (failed) tx.onabort?.();
            else tx.oncomplete?.();
          });
        };
        const settleIfIdle = () => later(() => { if (pending === 0) finish(false); });
        tx.abort = () => {
          if (finished) throw new DOMException('The transaction has finished.', 'InvalidStateError');
          finish(true);
        };
        const request = (operation) => {
          const req = { onsuccess: null, onerror: null, result: undefined };
          pending += 1;
          previous.then(() => later(() => {
            if (finished) return;
            staged ??= new Map(data);
            req.result = operation(staged);
            req.onsuccess?.();
            pending -= 1;
            settleIfIdle();
          }));
          return req;
        };
        tx.objectStore = () => ({
          get: (key) => request((map) => clone(map.get(key))),
          getKey: (key) => request((map) => (map.has(key) ? key : undefined)),
          put: (value, key) => request((map) => { map.set(key, clone(value)); return key; }),
          delete: (key) => request((map) => { map.delete(key); }),
        });
        previous.then(settleIfIdle);
        return tx;
      },
    };
    if (!connections.has(name)) connections.set(name, new Set());
    connections.get(name).add(db);
    return db;
  }
  return {
    log, faults, databases,
    open(name) {
      if (faults.open === 'throw') throw new DOMException('Blocked by policy.', 'SecurityError');
      const req = { onsuccess: null, onerror: null, onblocked: null, onupgradeneeded: null, result: undefined };
      later(() => {
        if (faults.open === 'error') { req.onerror?.(); return; }
        if (faults.open === 'hang') return;
        const fresh = !databases.has(name);
        if (fresh) databases.set(name, new Map());
        req.result = connect(name);
        if (fresh) req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
    // What erase in another tab does: every open connection is asked to close, then the database goes.
    deleteDatabase(name) {
      for (const db of connections.get(name) ?? []) db.onversionchange?.();
      connections.delete(name);
      databases.delete(name);
    },
  };
}

function loseNextSyncWrite(idb, protocol) {
  const write = protocol.records.writeSync;
  protocol.records.writeSync = (...args) => {
    protocol.records.writeSync = write;
    idb.faults.drop = 1;
    return write(...args);
  };
}

// A pre-sync tab changes only the original record key.
async function legacyRecordWrite(idb, change) {
  const db = await new Promise((resolve, reject) => {
    const request = idb.open(CLOUD_BACKUP_DATABASE, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('The old record store could not open.'));
  });
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction('stream', 'readwrite');
      const store = tx.objectStore('stream');
      const request = store.get('record');
      request.onsuccess = () => {
        const after = change(request.result ?? null);
        if (after === null) store.delete('record');
        else if (after !== undefined) store.put(after, 'record');
      };
      tx.oncomplete = resolve;
      tx.onabort = () => reject(new Error('The old record write failed.'));
    });
  } finally { db.close(); }
}

// The app's own area of one account, in memory, as a host holding one connection serves it. Every call is
// logged, so a test can count what a backup costs, and faults holds what the next call of each kind does
// instead of succeeding: a code to reject with, a function to wait on first, or one of the named shapes
// below. Every call must name the connection the host holds now, which a test can change between calls to
// stand for another profile reconnecting the host. Names are refused twice, as OneDrive is asked to;
// { duplicates: true } allows them, as Google Drive does.
function fakeTransport({ duplicates = false, connection = 'connection-one', latency = 0 } = {}) {
  const files = new Map();
  const calls = [];
  const created = [];
  const limbo = [];
  const faults = { list: [], read: [], create: [], delete: [] };
  const host = { connection };
  // The connection each call named, in order.
  const named = [];
  let next = 1;
  let created_at = 1_700_000_000_000;
  const failure = (code, message = `Injected ${code}`) => Object.assign(new Error(message), { code });
  const item = (id) => ({ id, name: files.get(id).name, size: files.get(id).bytes.byteLength, created: files.get(id).created });
  const store = (name, bytes) => {
    const id = `item-${next++}`;
    files.set(id, { name, bytes: new Uint8Array(bytes), created: created_at++ });
    return id;
  };
  const fault = async (kind) => {
    if (latency) await new Promise((resolve) => { setTimeout(resolve, latency); });
    const planned = faults[kind].shift();
    if (typeof planned === 'function') { await planned(); return null; }
    return planned ?? null;
  };
  // Checked after a fault's wait, so a test can switch the connection while a call is on its way.
  const guard = (options) => {
    named.push(options?.connection ?? null);
    if (host.connection === null) throw failure('not-connected');
    if (options?.connection !== host.connection) throw failure('needs-consent');
  };
  return {
    files, calls, created, faults, store, named,
    // Said by a transport whose provider keeps two items under one name, so the engine lists after a create.
    duplicateNames: duplicates,
    get connection() { return host.connection; },
    set connection(value) { host.connection = value; },
    async list(options) {
      calls.push('list');
      const planned = await fault('list');
      guard(options);
      if (planned) throw failure(planned);
      return [...files.keys()].map(item);
    },
    async read(id, options) {
      calls.push('read');
      const planned = await fault('read');
      guard(options);
      if (planned === 'corrupt') {
        const bytes = new Uint8Array(files.get(id).bytes);
        bytes[bytes.length - 1] ^= 1;
        return bytes;
      }
      if (planned) throw failure(planned);
      if (!files.has(id)) throw failure('not-found');
      return new Uint8Array(files.get(id).bytes);
    },
    async create(name, bytes, options) {
      calls.push('create');
      created.push(name);
      const planned = await fault('create');
      guard(options);
      if (planned === 'lost') {
        store(name, bytes);
        throw failure('timeout', 'The reply was lost.');
      }
      if (planned === 'late') {
        limbo.push({ name, bytes: new Uint8Array(bytes) });
        throw failure('timeout', 'No reply in time.');
      }
      if (planned === 'renamed') return item(store(`${name} (1)`, bytes));
      if (planned) throw failure(planned);
      if (!duplicates && [...files.values()].some((file) => file.name === name)) throw failure('exists');
      return item(store(name, bytes));
    },
    async delete(id, options) {
      calls.push('delete');
      const planned = await fault('delete');
      guard(options);
      if (planned) throw failure(planned);
      files.delete(id);
    },
    // A create that timed out lands now.
    land() { for (const { name, bytes } of limbo.splice(0)) store(name, bytes); },
    generations(stream) {
      return [...files.values()].map((file) => parseCloudBackupName(file.name))
        .filter((parsed) => parsed?.stream === stream).map((parsed) => parsed.generation).sort((a, b) => a - b);
    },
  };
}

// Web Locks by name: shared beside shared, exclusive alone, ifAvailable answered at once, waiting
// requests granted in order.
function fakeLocks() {
  const names = new Map();
  const slot = (name) => {
    if (!names.has(name)) names.set(name, { held: [], queue: [] });
    return names.get(name);
  };
  const fits = (lock, mode) => (mode === 'exclusive' ? lock.held.length === 0 : lock.held.every((entry) => entry.mode === 'shared'));
  const pump = (lock) => {
    while (lock.queue.length && fits(lock, lock.queue[0].mode)) {
      const waiting = lock.queue.shift();
      const entry = { mode: waiting.mode };
      lock.held.push(entry);
      waiting.resolve(entry);
    }
  };
  return {
    held: (name) => slot(name).held.length,
    waiting: (name) => slot(name).queue.length,
    async query() {
      return {
        held: [...names].flatMap(([name, lock]) => lock.held.map(({ mode }) => ({ name, mode }))),
        pending: [...names].flatMap(([name, lock]) => lock.queue.map(({ mode }) => ({ name, mode }))),
      };
    },
    closeHolder(name) {
      const lock = slot(name);
      lock.held.length = 0;
      pump(lock);
    },
    async request(name, options, callback) {
      const lock = slot(name);
      const mode = options.mode ?? 'exclusive';
      let entry;
      if (options.ifAvailable) {
        if (lock.queue.length || !fits(lock, mode)) return callback(null);
        entry = { mode };
        lock.held.push(entry);
      } else {
        entry = await new Promise((resolve) => { lock.queue.push({ mode, resolve }); pump(lock); });
      }
      try { return await callback({ name, mode }); }
      finally {
        const index = lock.held.indexOf(entry);
        if (index >= 0) lock.held.splice(index, 1);
        pump(lock);
      }
    },
  };
}

function memoryStorage(entries = []) {
  const map = new Map(entries);
  return {
    map,
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    clear() { map.clear(); },
  };
}

// Timers that fire only when the test moves the clock, in due order.
function fakeTime(start = 1_800_000_000_000) {
  let now = start;
  let next = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(callback, ms) {
      const id = next++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    pendingIn(ms) { return [...timers.values()].some((timer) => timer.at === now + ms); },
    async advance(ms, coordinators = []) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].callback();
        for (const coordinator of coordinators) await coordinator.idle();
      }
      now = end;
    },
  };
}

const settle = () => new Promise((resolve) => { setImmediate(resolve); });
// Bounded by time rather than by event-loop turns: gzip and SHA-256 run on Node's thread pool, and one full
// suite run on a loaded machine needed more than the 500 turns this used to allow (2026-10-28).
async function until(check, message, timeoutMs = 10_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await check()) return;
    await settle();
  }
  assert.fail(message);
}

// ------------------------------------------------------------------ fixtures

// Saved data on one device, changed the way its owners change it, and the backup a capture of it
// makes, as the coordinator hands it to the protocol.
function device(read = { 1: 111 }) {
  let state = createList(createEmptyState(), { id: 'list', name: 'On this device' });
  state = addIssuesToList(state, 'list', [{ issueId: 1, title: 'One' }, { issueId: 2, title: 'Two' }]).state;
  state = createList(state, { id: 'later', name: 'Later' });
  state = { ...state, active: 'list', read: { ...state.read, ...read } };
  const storage = memoryStorage([
    [SETTINGS_KEY, JSON.stringify({ apiBase: API_BASE, covers: true, theme: 'dark', filter: 'all', readingShortcut: true, hideDescriptions: true })],
    [SIDEBAR_KEY, 'false'],
  ]);
  const save = () => storage.setItem(KEY, JSON.stringify({ writeToken: 'token', ...exportBackup(state) }));
  save();
  return {
    storage,
    // Issue 2 read at a new moment: a change a backup holds.
    mark(time) {
      state = { ...state, read: { ...state.read, 2: time } };
      save();
    },
    // Another list opened: the one change a backup leaves out.
    open(active) {
      state = { ...state, active };
      save();
    },
    async snapshot() {
      const { text, backup } = await captureCompleteBackup({ storage, cryptoProvider: webcrypto });
      return { text, backup, personalDigest: await personalDigest(backup, webcrypto) };
    },
  };
}

function harness({ idb = fakeIndexedDB(), transport = fakeTransport(), locks = fakeLocks(), time = { now: 1_800_000_000_000 } } = {}) {
  return {
    idb, transport, locks, time, syncStorage: memoryStorage(),
    make: (overrides = {}) => new CloudBackupProtocol({
      transport, records: createCloudRecordStore(idb), cryptoProvider: webcrypto, locks, clock: () => time.now, ...overrides,
    }),
  };
}

async function consented(env, overrides) {
  const protocol = env.make(overrides);
  const record = await protocol.recordConsent(CONSENT);
  return { protocol, stream: record.stream };
}

async function syncContext(protocol, connection = CONSENT.connection) {
  const record = await protocol.record();
  assert.equal(record.consent.connection, connection);
  return { connection, stream: record.stream, consentId: record.consent.id };
}

async function remember(protocol, { connection = CONSENT.connection, ...changes } = {}) {
  return protocol.rememberSync({ ...await syncContext(protocol, connection), ...changes });
}

async function uploadForKept(protocol, home, change) {
  home.mark(change);
  const saved = await home.snapshot();
  const made = await protocol.upload(saved);
  const record = await protocol.record();
  return {
    ...await syncContext(protocol, record.consent.connection), generation: made.generation,
    personalDigest: saved.personalDigest, contentDigest: saved.backup.digest,
  };
}

const keptCreates = (transport) => transport.created.filter((name) => name.startsWith('recap-page-kept-v1-'));
function purposeTransport() {
  const transport = fakeTransport();
  const reads = [];
  const read = transport.read.bind(transport);
  transport.read = (id, options) => {
    reads.push({ id, purpose: options?.purpose });
    return read(id, options);
  };
  return { transport, reads };
}

test('read purpose: a kept copy is read back with verify', async () => {
  const { transport, reads } = purposeTransport();
  const { protocol } = await consented(harness({ transport }));
  const request = await uploadForKept(protocol, device(), 1);
  reads.length = 0;
  const kept = await protocol.keepBackup(request);
  assert.deepEqual(reads.filter(({ id }) => id === kept.id), [{ id: kept.id, purpose: 'verify' }]);
});

test('read purpose: fetching a backup reads it with restore', async () => {
  const { transport, reads } = purposeTransport();
  const { protocol } = await consented(harness({ transport }));
  await protocol.upload(await device().snapshot());
  const [entry] = (await protocol.discover(ON)).devices;
  reads.length = 0;
  await protocol.fetchBackup(entry.current, ON);
  assert.deepEqual(reads, [{ id: entry.current.id, purpose: 'restore' }]);
});

const quickCleanupTimer = (callback, ms) => setTimeout(callback,
  ms === 1000 || ms === CLOUD_TRANSPORT_DEADLINES_MS.read + CLOUD_DEADLINE_GRACE_MS ? 20 : ms);

for (const latency of [50, 120, 200, 300]) {
  test(`review: six kept copies retain three without attention at ${latency} ms per provider call`, async () => {
    const env = harness({ transport: fakeTransport({ latency }) });
    const { protocol } = await consented(env);
    const home = device();
    const copies = [];
    for (let change = 1; change <= 6; change += 1) {
      copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
      assert.equal(copies.filter((copy) => env.transport.files.has(copy.id)).length, Math.min(change, 3));
      const summary = await protocol.keptCopySummary(ON);
      assert.equal(summary.problem, false);
      assert.equal(summary.attention, 0);
    }
    assert.deepEqual(copies.filter((copy) => env.transport.files.has(copy.id)), copies.slice(-3));
  });
}

for (const latency of [400, 600]) {
  test(`review: an unverified recorded identity is adopted at ${latency} ms per provider call`, async () => {
    const env = harness({ transport: fakeTransport({ latency }) });
    const { protocol } = await consented(env);
    const request = await uploadForKept(protocol, device(), 1);
    env.transport.faults.read.push(null, 'timeout');
    await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
    const original = (await protocol.keptLedger()).entries[0];
    assert.ok(original.id);
    assert.equal((await protocol.keepBackup(request)).id, original.id);
    assert.equal(keptCreates(env.transport).length, 1);
    assert.deepEqual(await protocol.keptCopySummary(ON), { earlier: 0, attention: 0, problem: false });
  });
}

for (const code of ['unavailable', 'timeout', 'invalid']) {
  test(`review: a cleanup listing that fails as ${code} cannot fail the verified kept copy`, async () => {
    const env = harness();
    const { protocol } = await consented(env);
    const home = device();
    const copies = [];
    for (let change = 1; change <= 3; change += 1) {
      copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
    }
    const prune = protocol.pruneKept;
    protocol.pruneKept = (context) => {
      env.transport.faults.list.push(code);
      return prune.call(protocol, context);
    };
    const kept = await protocol.keepBackup(await uploadForKept(protocol, home, 4));
    protocol.pruneKept = prune;
    assert.equal((await protocol.syncState(ON)).kept.id, kept.id);
    assert.ok(copies.every((copy) => env.transport.files.has(copy.id)), 'nothing is deleted without a listing');
    assert.equal((await protocol.keptCopySummary(ON)).problem, true, 'the unfinished cleanup is reported');
    const fifth = await protocol.keepBackup(await uploadForKept(protocol, home, 5));
    assert.deepEqual([...copies, kept, fifth].filter((copy) => env.transport.files.has(copy.id)),
      [copies[2], kept, fifth]);
    assert.equal((await protocol.keptCopySummary(ON)).problem, false);
  });
}

test('review: kept copies listed without a size are checked by their bytes before they count', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const home = device();
  const evicted = new Set();
  const list = env.transport.list;
  env.transport.list = async (options) => (await list(options))
    .map((item) => (evicted.has(item.id) ? { ...item, size: null } : item));
  const copies = [];
  for (let change = 1; change <= 6; change += 1) {
    copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
    if (change >= 3) for (const copy of copies) evicted.add(copy.id);
    assert.equal(copies.filter((copy) => env.transport.files.has(copy.id)).length, Math.min(change, 3));
    assert.deepEqual(await protocol.keptCopySummary(ON), { earlier: 0, attention: 0, problem: false });
  }
  assert.deepEqual(copies.filter((copy) => env.transport.files.has(copy.id)), copies.slice(-3));
  env.transport.files.get(copies[3].id).bytes = new Uint8Array([9, 8, 7]);
  copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, 7)));
  assert.ok(env.transport.files.has(copies[3].id), 'a sizeless copy that fails its check is kept and reported');
  assert.equal((await protocol.keptCopySummary(ON)).attention, 1);
});

test('review: an interrupted reconcile cannot let a second kept copy be created', async () => {
  const env = harness();
  const { protocol } = await consented(env, { setTimer: quickCleanupTimer });
  const request = await uploadForKept(protocol, device(), 1);
  env.transport.faults.read.push(null, 'timeout');
  await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
  const original = (await protocol.keptLedger()).entries[0];
  assert.ok(original.id && !original.verified);
  const change = protocol.changeKeptLedger;
  let slow = true;
  protocol.changeKeptLedger = async (...args) => {
    if (slow) {
      slow = false;
      await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
    return change.apply(protocol, args);
  };
  await assert.rejects(protocol.keepBackup(request), { code: 'verify' });
  assert.equal(keptCreates(env.transport).length, 1, 'no second copy while the recorded one is unchecked');
  await new Promise((resolve) => { setTimeout(resolve, 150); });
  protocol.changeKeptLedger = change;
  assert.equal((await protocol.keepBackup(request)).id, original.id, 'a later pass adopts the recorded copy');
  assert.equal(keptCreates(env.transport).length, 1);
});

test('review: a kept copy listed at another size is reported, not counted or deleted', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const home = device();
  const copies = [];
  for (let change = 1; change <= 3; change += 1) {
    copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
  }
  const list = env.transport.list;
  env.transport.list = async (options) => (await list(options))
    .map((item) => (item.id === copies[0].id ? { ...item, size: item.size + 1 } : item));
  await protocol.keepBackup(await uploadForKept(protocol, home, 4));
  assert.ok(env.transport.files.has(copies[0].id), 'a copy whose listed size changed is not deleted');
  assert.equal((await protocol.keptCopySummary(ON)).attention, 1);
});

test('review: an unverified recorded copy never counts toward the newest three', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const home = device();
  const copies = [];
  for (let change = 1; change <= 3; change += 1) {
    copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
  }
  const fourth = await uploadForKept(protocol, home, 4);
  env.transport.faults.read.push(null, 'timeout');
  await assert.rejects(protocol.keepBackup(fourth), { code: 'timeout' });
  assert.ok((await protocol.keptLedger()).entries.some((entry) => entry.id !== null && !entry.verified));
  await protocol.pruneKept(await syncContext(protocol));
  assert.ok(copies.every((copy) => env.transport.files.has(copy.id)), 'an unchecked copy cannot evict a verified one');
});

test('review: an unreadable kept ledger does not block regular backup deletion', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const home = device();
  await protocol.keepBackup(await uploadForKept(protocol, home, 1));
  await uploadForKept(protocol, home, 2);
  await protocol.records.writeKeptLedger((ledger) => ({ ...ledger, unexpected: true }));
  const result = await protocol.deleteOwnBackups(ON);
  assert.equal(result.deleted, 2);
  assert.deepEqual(env.transport.generations(stream), []);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].code, 'storage');
  assert.equal([...env.transport.files.values()].filter((file) => file.name.startsWith('recap-page-kept-v1-')).length, 1);
  const retry = await protocol.deleteOwnBackups(ON);
  assert.equal(retry.deleted, 0);
  assert.equal(retry.failed[0].code, 'storage');
});

test('review: explicit deletion reconciles a hand-deleted exact identity without permanent attention', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const kept = await protocol.keepBackup(await uploadForKept(protocol, device(), 1));
  env.transport.files.delete(kept.id);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await protocol.deleteOwnBackups(ON);
    assert.deepEqual(result.failed, []);
    assert.equal((await protocol.keptCopySummary(ON)).attention, 0);
    assert.deepEqual((await protocol.keptLedger()).entries, []);
  }
});

test('review: an absent create reservation is attention, not an undeleted backup', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const request = await uploadForKept(protocol, device(), 1);
  env.transport.faults.create.push('late');
  await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const result = await protocol.deleteOwnBackups(ON);
    assert.deepEqual(result.failed, []);
    assert.equal(result.attention, 1);
    assert.equal((await protocol.keptCopySummary(ON)).attention, 1);
  }
});

test('review: a same-name same-bytes replacement with a new ID is never adopted or pruned', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const home = device();
  const first = await protocol.keepBackup(await uploadForKept(protocol, home, 1));
  const entry = (await protocol.keptLedger()).entries[0];
  const file = env.transport.files.get(first.id);
  env.transport.files.delete(first.id);
  const replacement = env.transport.store(file.name, file.bytes);
  await assert.rejects(protocol.checkKeptEntry(entry, CONSENT.connection), { code: 'verify' });
  for (let change = 2; change <= 5; change += 1) {
    await protocol.keepBackup(await uploadForKept(protocol, home, change));
  }
  assert.ok(env.transport.files.has(replacement));
  assert.ok((await protocol.keptLedger()).entries.some((held) => held.id === first.id && held.changedOutside));
});

test('review: retention protects a go-back reference older than the newest three', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const home = device();
  const prune = protocol.pruneKept;
  protocol.pruneKept = async () => {};
  const copies = [];
  for (let change = 1; change <= 4; change += 1) {
    copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
  }
  const entry = (await protocol.keptLedger()).entries.find((held) => held.id === copies[0].id);
  const context = await syncContext(protocol);
  await protocol.rememberKept(context, entry);
  protocol.pruneKept = prune;
  await protocol.pruneKept(context);
  assert.ok(env.transport.files.has(copies[0].id), 'the active recovery reference is not expendable');
  assert.equal((await protocol.syncState(ON)).kept.id, copies[0].id);
});

// A file as this version writes one, assembled here so a test can alter any part of it.
function envelopeFile({ stream, generation, backup, device: label = 'Planted', createdAt = 5 }) {
  return gzipSync(Buffer.from(canonical({
    backup, createdAt, device: label, format: CLOUD_ENVELOPE_FORMAT, generation, stream, version: CLOUD_ENVELOPE_VERSION,
  })));
}

// ------------------------------------------------------------------ the record

test('sync discovery checks the newest generation of every other stream and returns exact content identities', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const first = await device({ 1: 111 }).snapshot();
  const second = await device({ 1: 222 }).snapshot();
  const another = 'a'.repeat(32);
  env.transport.store(cloudBackupName(stream, 1), envelopeFile({ stream, generation: 1, backup: first.backup }));
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({ stream: OTHER, generation: 1, backup: first.backup }));
  const latest = env.transport.store(cloudBackupName(OTHER, 2), envelopeFile({
    stream: OTHER, generation: 2, backup: second.backup, device: 'Phone', createdAt: 123,
  }));
  env.transport.store(cloudBackupName(another, 1), envelopeFile({ stream: another, generation: 1, backup: first.backup }));
  env.transport.store('notes.txt', new Uint8Array([1]));
  const found = await protocol.discoverSync(await syncContext(protocol));
  assert.equal(found.length, 2);
  const phone = found.find((item) => item.stream === OTHER);
  assert.equal(phone.id, latest);
  assert.equal(phone.generation, 2);
  assert.equal(phone.createdAt, 123);
  assert.equal(phone.device, 'Phone');
  assert.equal(phone.digest, second.personalDigest);
  assert.equal(phone.contentDigest, second.backup.digest);
  assert.match(phone.byteDigest, /^[a-f0-9]{64}$/);
  assert.equal(phone.text, undefined, 'the checked contents are fetched again when chosen');
});

test('sync discovery refuses an unreadable newest backup instead of falling back to an older generation', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const saved = await device().snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({ stream: OTHER, generation: 1, backup: saved.backup }));
  env.transport.store(cloudBackupName(OTHER, 2), new Uint8Array([1, 2, 3]));
  await assert.rejects(protocol.discoverSync(await syncContext(protocol)), { code: 'invalid' });
});

test('sync discovery fails closed for ambiguous, unsupported and omitted backup identities', async () => {
  const saved = await device().snapshot();
  for (const kind of ['duplicate', 'future', 'omitted']) {
    const env = harness({ transport: fakeTransport({ duplicates: true }) });
    const { protocol } = await consented(env, kind === 'omitted' ? { limits: { streams: 1, readsPerStream: 4 } } : undefined);
    env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({ stream: OTHER, generation: 1, backup: saved.backup }));
    if (kind === 'duplicate') {
      env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({ stream: OTHER, generation: 1, backup: saved.backup }));
    } else if (kind === 'future') {
      env.transport.store('recap-page-backup-v2-unreadable.json.gz', new Uint8Array([1]));
    } else {
      const another = 'a'.repeat(32);
      env.transport.store(cloudBackupName(another, 1), envelopeFile({ stream: another, generation: 1, backup: saved.backup }));
    }
    await assert.rejects(protocol.discoverSync(await syncContext(protocol)), { code: 'invalid' }, kind);
  }
});

test('sync discovery refuses a newer candidate appearing while the current candidate is being read', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const saved = await device().snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({ stream: OTHER, generation: 1, backup: saved.backup }));
  env.transport.faults.read.push(async () => {
    env.transport.store(cloudBackupName(OTHER, 2), envelopeFile({ stream: OTHER, generation: 2, backup: saved.backup }));
  });
  await assert.rejects(protocol.discoverSync(await syncContext(protocol)), { code: 'raced' });
});

test('the sync upload gate is durable, consent-scoped and erased with the cloud record', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const epoch = 'b'.repeat(32);
  assert.equal(await protocol.syncGate(context), null, 'an absent gate is not permission to upload');
  await protocol.setSyncGate({ ...context, epoch, held: true });
  assert.deepEqual(await env.make().syncGate(context), { ...context, epoch, held: true, version: 1 });
  await protocol.setSyncGate({ ...context, epoch, held: false });
  assert.equal((await env.make().syncGate(context)).held, false);
  await protocol.withdrawConsent();
  await protocol.recordConsent(CONSENT);
  const renewed = await syncContext(protocol);
  assert.notEqual(renewed.consentId, context.consentId);
  assert.equal(await env.make().syncGate(renewed), null, 'earlier consent cannot authorize an upload');
  await assert.rejects(protocol.setSyncGate({ ...context, epoch, held: false }), { code: 'needs-consent' });
  await protocol.forget();
  assert.equal(env.idb.databases.get(CLOUD_BACKUP_DATABASE).get('stream').has('sync-gate'), false);
});

test('a canceled sync gate release aborts its transaction before it can commit', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const epoch = 'b'.repeat(32);
  await protocol.setSyncGate({ ...context, epoch, held: true });

  const controller = new AbortController();
  const write = protocol.records.writeSyncGate;
  protocol.records.writeSyncGate = (change, options) => write((...args) => {
    const result = change(...args);
    controller.abort();
    return result;
  }, options);
  let committed = false;
  await assert.rejects(protocol.setSyncGate({
    ...context, epoch, held: false, authorize: () => true, signal: controller.signal,
    onCommitted: () => { committed = true; },
  }));
  assert.equal(committed, false);
  assert.equal((await env.make().syncGate(context)).held, true);

  protocol.records.writeSyncGate = write;
  await assert.rejects(protocol.setSyncGate({
    ...context, epoch: 'c'.repeat(32), held: true, authorize: () => false,
  }), { code: 'raced' });
  assert.equal((await env.make().syncGate(context)).epoch, epoch, 'an obsolete hold cannot replace the current epoch');

  const rollback = new AbortController();
  const writeSync = protocol.records.writeSync;
  protocol.records.writeSync = (change, options) => writeSync((...args) => {
    const result = change(...args);
    rollback.abort();
    return result;
  }, options);
  await assert.rejects(protocol.rememberSync({
    ...context, declinedDigest: 'd'.repeat(64), authorize: () => true, signal: rollback.signal,
  }));
  assert.equal((await env.make().syncState(ON))?.declinedDigest ?? null, null,
    'a canceled interrupted-choice rollback cannot commit');
});

test('a sync gate release reports its commit before the verification read', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const epoch = 'b'.repeat(32);
  await protocol.setSyncGate({ ...context, epoch, held: true });
  let committed = false;
  const read = protocol.records.readSyncGate;
  protocol.records.readSyncGate = async () => {
    assert.equal(committed, true, 'the committed choice is known before read-back begins');
    return read();
  };
  await protocol.setSyncGate({
    ...context, epoch, held: false, signal: new AbortController().signal,
    onCommitted: () => { committed = true; },
  });
  assert.equal((await env.make().syncGate(context)).held, false);
});

test('the record is written with strict durability, survives a new page, and is refused rather than lost', async () => {
  const idb = fakeIndexedDB();
  const store = createCloudRecordStore(idb);
  assert.equal(store.available, true);
  assert.equal(await store.read(), null, 'nothing until cloud backup is turned on');
  assert.deepEqual(await store.write(() => ({ value: 1 })), { before: null, after: { value: 1 } });
  assert.deepEqual(await createCloudRecordStore(idb).read(), { value: 1 }, 'a new page reads what was committed');
  const writes = idb.log.filter((entry) => entry.mode === 'readwrite');
  assert.ok(writes.length > 0 && writes.every((entry) => entry.durability === 'strict' && entry.name === CLOUD_BACKUP_DATABASE));

  const refusal = new CloudBackupError('Refused by the change itself.', 'refused');
  await assert.rejects(store.write(() => { throw refusal; }), (error) => error === refusal);
  idb.faults.abort = 1;
  await assert.rejects(store.write(() => ({ value: 2 })), { code: 'storage' });
  assert.deepEqual(await store.read(), { value: 1 }, 'neither a refused change nor an aborted commit changes the record');

  // Erase in another tab deletes the database: this connection closes and the next call opens a new one.
  idb.deleteDatabase(CLOUD_BACKUP_DATABASE);
  assert.equal(await store.read(), null);

  for (const open of ['throw', 'error']) {
    const broken = fakeIndexedDB();
    broken.faults.open = open;
    await assert.rejects(createCloudRecordStore(broken).read(), { code: 'storage' }, open);
  }
  const hung = fakeIndexedDB();
  hung.faults.open = 'hang';
  await assert.rejects(createCloudRecordStore(hung, { timeoutMs: 20 }).read(), { code: 'storage' });
});

test('a file is named for its stream and generation, and its name declares the format and the compression', () => {
  const stream = 'ab'.repeat(16);
  const name = cloudBackupName(stream, 12);
  assert.equal(name, `recap-page-backup-v1-${stream}-12.json.gz`);
  assert.deepEqual(parseCloudBackupName(name), { stream, generation: 12 });
  for (const other of [
    `recap-page-backup-v1-${stream}-0.json.gz`, `recap-page-backup-v1-${stream}-012.json.gz`,
    `recap-page-backup-v1-${stream}-12.json`, `recap-page-backup-v2-${stream}-12.json.gz`,
    `recap-page-backup-v1-${stream.toUpperCase()}-12.json.gz`, `recap-page-backup-v1-${stream}-12.json.gz (1)`,
    `recap-page-backup-v1-${stream}-9999999999999999.json.gz`, `recap-page-backup-v1-${stream}-99999999999999999.json.gz`,
    'recap-page-complete-backup.json', 'backup.json', null,
  ]) assert.equal(parseCloudBackupName(other), null, String(other));
  assert.equal(cloudDeviceLabel('  Edge   on\tWindows '), 'Edge on Windows');
  assert.equal([...cloudDeviceLabel('x'.repeat(80))].length, 64);
  for (const fallback of ['', '   ', 'bad\u0001label', null, 7]) assert.equal(cloudDeviceLabel(fallback), 'Recap Page', String(fallback));
});

// ------------------------------------------------------------------ one backup

test('a backup is one gzip file holding the exact complete backup, read back before it counts as made', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const home = device();
  const snapshot = await home.snapshot();
  const counted = [];
  const create = env.transport.create;
  env.transport.create = async (name, bytes, options) => {
    counted.push((await createCloudRecordStore(env.idb).read()).nextGeneration);
    return create(name, bytes, options);
  };
  let reading;
  env.transport.faults.read.push(() => new Promise((resolve) => { reading = resolve; }));
  const uploading = protocol.upload(snapshot);
  await until(() => reading, 'the read-back starts');
  assert.equal(await protocol.lastUploaded(ON), null, 'not counted while its read-back is pending');
  reading();
  assert.deepEqual(await uploading, { stream, generation: 1, name: cloudBackupName(stream, 1) });
  assert.deepEqual(counted, [2], 'the generation was committed before its file was created');
  assert.deepEqual(env.transport.calls, ['list', 'create', 'read'], 'every backup lists before it creates, and a first one has nothing to prune');

  const [file] = env.transport.files.values();
  assert.equal(file.name, cloudBackupName(stream, 1));
  const plain = gunzipSync(file.bytes).toString('utf8');
  const envelope = JSON.parse(plain);
  assert.equal(canonical(envelope), plain, 'canonical JSON, which any gzip reader opens');
  assert.deepEqual(Object.keys(envelope), ['backup', 'createdAt', 'device', 'format', 'generation', 'stream', 'version']);
  assert.deepEqual({ ...envelope, backup: undefined }, {
    backup: undefined, createdAt: env.time.now, device: CONSENT.device, format: CLOUD_ENVELOPE_FORMAT, generation: 1, stream, version: 1,
  });
  assert.equal(canonical(envelope.backup), snapshot.text, 'the complete backup, byte for byte');
  assert.deepEqual([...file.bytes.subarray(0, 2)], [0x1f, 0x8b], 'gzip');
  assert.deepEqual(await protocol.lastUploaded(ON), { personalDigest: snapshot.personalDigest, uploadedAt: env.time.now });
});

test('each backup costs one create, one read, one list and one delete, and exactly the newest two remain', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const home = device();
  const costs = [];
  for (let n = 1; n <= 6; n += 1) {
    home.mark(n);
    env.transport.calls.length = 0;
    await protocol.upload(await home.snapshot());
    costs.push(env.transport.calls.join(','));
  }
  assert.deepEqual(costs, [
    'list,create,read', 'list,create,read',
    'list,create,read,delete', 'list,create,read,delete', 'list,create,read,delete', 'list,create,read,delete',
  ]);
  assert.deepEqual(env.transport.generations(stream), [5, 6]);
  assert.deepEqual((await protocol.record()).validated.map((entry) => entry.generation), [6, 5]);
  // The list comes first, so a backup that cannot make it creates nothing.
  home.mark(7);
  env.transport.calls.length = 0;
  env.transport.faults.list.push('unavailable');
  await assert.rejects(protocol.upload(await home.snapshot()), { code: 'unavailable' });
  assert.deepEqual(env.transport.calls, ['list']);
});

// ------------------------------------------------------------------ generations

test('no generation is used twice, by tabs taking numbers at once or after a restart or a lost increment', async () => {
  const env = harness();
  await consented(env);
  const tabs = [env.make({ locks: null }), env.make({ locks: null }), env.make({ locks: null })];
  const taken = await Promise.all(Array.from({ length: 12 }, (_, index) => tabs[index % 3].allocate()));
  assert.deepEqual(taken.map((entry) => entry.generation).sort((a, b) => a - b), Array.from({ length: 12 }, (_, index) => index + 1));

  // A page that took a number and was closed before creating anything: the next page goes on from there.
  const restarted = env.make();
  assert.equal((await restarted.allocate()).generation, 13);

  // A commit that reports success but did not reach the disk is caught by the read-back, before any create.
  const home = device();
  env.idb.faults.drop = 1;
  await assert.rejects(restarted.upload(await home.snapshot()), { code: 'storage' });
  assert.deepEqual(env.transport.calls, [], 'nothing was created under a number that was not kept');
  assert.equal((await restarted.upload(await home.snapshot())).generation, 14);
  assert.deepEqual(env.transport.created.map((name) => parseCloudBackupName(name).generation), [14]);
});

test('a lost reply or a create that lands late only ever adds an older generation, and later backups remove it', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const home = device();
  home.mark(1);
  await protocol.upload(await home.snapshot());
  home.mark(2);
  env.transport.faults.create.push('lost');
  await assert.rejects(protocol.upload(await home.snapshot()), { code: 'timeout' });
  home.mark(3);
  env.transport.faults.create.push('late');
  await assert.rejects(protocol.upload(await home.snapshot()), { code: 'timeout' });
  home.mark(4);
  const newest = await home.snapshot();
  await protocol.upload(newest);
  assert.deepEqual(await protocol.lastUploaded(ON), { personalDigest: newest.personalDigest, uploadedAt: env.time.now });

  env.transport.land();
  assert.deepEqual(env.transport.generations(stream), [1, 2, 3, 4], 'generation 3 landed after generation 4');
  const elsewhere = await harness({ transport: env.transport }).make().discover(ON);
  assert.deepEqual([elsewhere.devices[0].current.generation, elsewhere.devices[0].previous.generation], [4, 3],
    'the late file is never taken for the newest');
  assert.equal(elsewhere.devices[0].current.text, undefined, 'discovery shows what a backup holds, not its bytes');

  home.mark(5);
  await protocol.upload(await home.snapshot());
  assert.deepEqual(env.transport.generations(stream), [3, 4, 5], `at most ${CLOUD_PRUNE_PER_BACKUP} deletes in one backup`);
  home.mark(6);
  await protocol.upload(await home.snapshot());
  assert.deepEqual(env.transport.generations(stream), [5, 6]);
  assert.equal(env.transport.created.length, new Set(env.transport.created).size, 'no name was ever sent twice');
});

test('a copy that does not read back as sent is removed and never counted, and a failed read-back leaves it for pruning', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const home = device();
  for (const [fault, where] of [['corrupt', 'read'], ['renamed', 'create']]) {
    home.mark(fault.length);
    env.transport.calls.length = 0;
    env.transport.faults[where].push(fault);
    await assert.rejects(protocol.upload(await home.snapshot()), { code: 'verify' }, fault);
    assert.equal(await protocol.lastUploaded(ON), null, fault);
    assert.equal(env.transport.calls.at(-1), 'delete', `${fault}: the copy is removed`);
    assert.equal(env.transport.files.size, 0, fault);
  }

  home.mark(3);
  env.transport.faults.read.push('timeout');
  await assert.rejects(protocol.upload(await home.snapshot()), { code: 'timeout' });
  assert.equal(await protocol.lastUploaded(ON), null, 'an unread copy is not counted');
  assert.deepEqual(env.transport.generations(stream), [3]);
  for (let n = 4; n <= 6; n += 1) {
    home.mark(n);
    await protocol.upload(await home.snapshot());
  }
  assert.deepEqual(env.transport.generations(stream), [5, 6], 'the unread copy was pruned as an older generation');
});

test('pruning that fails only lags, and never touches another stream, an unknown file or anything newer', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const home = device();
  const foreign = envelopeFile({ stream: OTHER, generation: 1, backup: (await home.snapshot()).backup });
  env.transport.store(cloudBackupName(OTHER, 1), foreign);
  env.transport.store('Recap Page notes.txt', new Uint8Array([1, 2, 3]));
  for (let n = 1; n <= 3; n += 1) {
    home.mark(n);
    await protocol.upload(await home.snapshot());
  }
  assert.deepEqual(env.transport.generations(stream), [2, 3]);

  home.mark(4);
  env.transport.faults.delete.push('timeout');
  const kept = await home.snapshot();
  await protocol.upload(kept);
  assert.deepEqual(await protocol.lastUploaded(ON), { personalDigest: kept.personalDigest, uploadedAt: env.time.now }, 'the backup still counts');
  home.mark(5);
  env.transport.faults.delete.push('timeout');
  await protocol.upload(await home.snapshot());
  assert.deepEqual(env.transport.generations(stream), [2, 3, 4, 5], 'two backups whose pruning failed');

  home.mark(6);
  await protocol.upload(await home.snapshot());
  home.mark(7);
  await protocol.upload(await home.snapshot());
  assert.deepEqual(env.transport.generations(stream), [6, 7], 'caught up');
  assert.deepEqual(env.transport.generations(OTHER), [1]);
  assert.ok([...env.transport.files.values()].some((file) => file.name === 'Recap Page notes.txt'));
});

// ------------------------------------------------------------------ refusals

test('consent for another connection, or after this device\'s backups were deleted, counts nothing as backed up', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const snapshot = await device().snapshot();
  await protocol.upload(snapshot);
  await protocol.recordConsent({ ...CONSENT, device: 'Renamed' });
  assert.notEqual(await protocol.lastUploaded(ON), null, 'the same connection keeps what it verified');

  // Perhaps another account: it holds none of this browser's backups yet, so the same content goes again.
  const TWO = { connection: 'connection-two' };
  env.transport.connection = TWO.connection;
  const moved = await protocol.recordConsent({ ...CONSENT, ...TWO });
  assert.deepEqual([moved.stream, moved.validated], [stream, []]);
  assert.equal(await protocol.lastUploaded(TWO), null);
  assert.equal((await protocol.upload(snapshot)).generation, 2, 'the counter carries on, so no number is reused');

  await protocol.deleteOwnBackups(TWO);
  assert.equal(await protocol.lastUploaded(TWO), null, 'nothing is backed up once it is deleted');
  await protocol.recordConsent({ ...CONSENT, ...TWO });
  assert.equal(await protocol.lastUploaded(TWO), null, 'so the first backup after consenting again goes at once');
  assert.equal((await protocol.upload(snapshot)).generation, 3);

  // Consent given again for another connection while a backup is under way: that backup belonged to the
  // old consent, so it does not count.
  let reading;
  env.transport.faults.read.push(() => new Promise((resolve) => { reading = resolve; }));
  const uploading = protocol.upload(snapshot);
  await until(() => reading, 'the read-back is pending');
  await protocol.recordConsent({ ...CONSENT, connection: 'connection-three' });
  reading();
  await assert.rejects(uploading, { code: 'refused' });
  assert.equal(await protocol.lastUploaded({ connection: 'connection-three' }), null);
});

test('a host reconnected to another account between allocating and creating uploads nothing and acknowledges nothing', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const snapshot = await device().snapshot();
  await protocol.upload(snapshot);
  assert.deepEqual(env.transport.named, ['connection-one', 'connection-one', 'connection-one'], 'the list, the create and its read-back name the consented connection');
  const before = env.transport.files.size;
  // Another profile reconnects the host after this browser has taken its number, before the create.
  env.transport.faults.create.push(async () => { env.transport.connection = 'connection-two'; });
  await assert.rejects(protocol.upload(snapshot), { code: 'needs-consent' });
  assert.equal(env.transport.named.at(-1), 'connection-one', 'the create named the consent, which the host no longer holds');
  assert.equal(env.transport.files.size, before, 'nothing landed in the account this browser never agreed to');
  const record = await protocol.record();
  assert.deepEqual([record.stream, record.validated.map((entry) => entry.generation), record.nextGeneration], [stream, [1], 3],
    'the second backup was not acknowledged');
  assert.equal(await protocol.lastUploaded({ connection: 'connection-two' }), null, 'so the host\'s account is never reported up to date');
  await assert.rejects(protocol.upload(snapshot), { code: 'needs-consent' }, 'every later backup asks for consent too');
  await assert.rejects(protocol.discover(ON), { code: 'needs-consent' });
  assert.equal(env.transport.files.size, before);
});

test('after the host reconnects, the backups this browser verified no longer count, so it never reports up to date', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const snapshot = await device().snapshot();
  await protocol.upload(snapshot);
  assert.equal((await protocol.lastUploaded(ON)).personalDigest, snapshot.personalDigest);
  // The record cannot know that another profile reconnected the host; the host's current connection says.
  env.transport.connection = 'connection-two';
  assert.equal(await protocol.lastUploaded({ connection: 'connection-two' }), null);
  assert.equal(await protocol.lastUploaded({}), null, 'a caller that names no connection is never told it is up to date');
  await assert.rejects(protocol.upload(snapshot), { code: 'needs-consent' });
  env.transport.connection = null;
  await assert.rejects(protocol.upload(snapshot), { code: 'not-connected' });
  for (const call of [() => protocol.discover({}), () => protocol.deleteOwnBackups(), () => protocol.fetchBackup({ id: 'item-1', stream: 'a'.repeat(32), generation: 1 })]) {
    await assert.rejects(call(), { code: 'invalid' }, 'each names the connection it acts under');
  }
});

test('nothing is sent without this browser\'s consent, a kept record, a backup within the cap and a browser that can compress', async () => {
  const env = harness();
  const home = device();
  const snapshot = await home.snapshot();
  const protocol = env.make();
  await assert.rejects(protocol.upload(snapshot), { code: 'refused' }, 'never turned on');
  await protocol.recordConsent(CONSENT);
  await protocol.withdrawConsent();
  await assert.rejects(protocol.upload(snapshot), { code: 'refused' }, 'consent withdrawn');
  const held = await protocol.recordConsent(CONSENT);

  await assert.rejects(env.make({ streams: {} }).upload(snapshot), { code: 'unsupported' });
  await assert.rejects(protocol.upload({ ...snapshot, text: `${snapshot.text} ` }), { code: 'invalid' });
  await assert.rejects(protocol.upload({ ...snapshot, personalDigest: 'not a digest' }), { code: 'invalid' });
  env.idb.faults.abort = 1;
  await assert.rejects(protocol.upload(snapshot), { code: 'storage' });
  assert.equal((await protocol.record()).nextGeneration, held.nextGeneration, 'no number was taken by a refusal');

  // The cap is on the envelope before it is compressed: this one would compress far below it.
  const plainSize = snapshot.text.length + 200;
  await assert.rejects(env.make({ maxBytes: plainSize - 300 }).upload(snapshot), { code: 'oversize' });
  assert.ok(gzipSync(snapshot.text).byteLength < plainSize - 300);
  assert.deepEqual(env.transport.calls, [], 'no refusal reached the account');

  // A record that fails its checks is never trusted for a number; consent starts a new stream instead.
  await createCloudRecordStore(env.idb).write(() => ({ ...held, nextGeneration: 0 }));
  await assert.rejects(protocol.upload(snapshot), { code: 'storage' });
  const fresh = await protocol.recordConsent(CONSENT);
  assert.notEqual(fresh.stream, held.stream);
  assert.equal(fresh.nextGeneration, 1);
});

// One record failure can stop any operation, so each refusal says what its own operation left undone,
// and none says nothing was uploaded after an upload (stage 1 review, L3).
test('a record that cannot be kept or read is reported for the operation it stopped', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const home = device();
  home.mark(1);
  const snapshot = await home.snapshot();
  const lost = 'This browser could not keep its cloud backup record.';
  const unreadable = 'This browser\'s cloud backup record cannot be read.';
  env.idb.faults.abort = 1;
  await assert.rejects(protocol.upload(snapshot), { code: 'storage', message: `${lost} Nothing was uploaded.` });
  assert.deepEqual(env.transport.calls, []);
  env.transport.faults.create.push(async () => { env.idb.faults.abort = 1; });
  await assert.rejects(protocol.upload(snapshot), { code: 'storage', message: `${lost} The backup was uploaded, but it does not count as made.` });
  assert.deepEqual(env.transport.calls, ['list', 'create', 'read'], 'it was made and read back first');
  env.idb.faults.abort = 1;
  await assert.rejects(protocol.recordConsent(CONSENT), { code: 'storage', message: `${lost} Cloud backup was not turned on.` });
  env.idb.faults.abort = 1;
  await assert.rejects(protocol.withdrawConsent(), { code: 'storage', message: `${lost} Cloud backup may still be on.` });
  env.idb.faults.abort = 1;
  env.transport.calls.length = 0;
  await assert.rejects(protocol.deleteOwnBackups(ON), { code: 'storage', message: `${lost} Nothing was deleted, and cloud backup may still be on.` });
  const held = await protocol.record();
  await createCloudRecordStore(env.idb).write(() => ({ ...held, nextGeneration: 0 }));
  await assert.rejects(protocol.upload(snapshot), { code: 'storage', message: `${unreadable} Nothing was uploaded.` });
  await assert.rejects(protocol.deleteOwnBackups(ON), { code: 'storage', message: `${unreadable} Nothing was deleted, and cloud backup may still be on.` });
  await assert.rejects(protocol.lastUploaded(ON), { code: 'storage', message: unreadable });
  assert.deepEqual(env.transport.calls, [], 'no refusal before a deletion reached the account');
});

// ------------------------------------------------------------------ copies of the record (M6)

// What a device or system backup brings back: the record as it stood when that backup was taken, in a
// browser of its own, talking to the same account.
async function copyOf(env, record) {
  const idb = fakeIndexedDB();
  await createCloudRecordStore(idb).write(() => structuredClone(record));
  return harness({ idb, transport: env.transport, locks: fakeLocks(), time: env.time }).make();
}

test('a record restored from an older device backup never uses a number its stream already has', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const home = device();
  home.mark(1);
  await protocol.upload(await home.snapshot());
  const saved = await protocol.record();
  for (let n = 2; n <= 4; n += 1) {
    home.mark(n);
    await protocol.upload(await home.snapshot());
  }
  assert.deepEqual(env.transport.generations(stream), [3, 4]);
  const restored = await copyOf(env, saved);
  env.transport.calls.length = 0;
  home.mark(5);
  const made = await restored.upload(await home.snapshot());
  assert.notEqual(made.stream, stream, 'it starts a new stream instead of making generation 2 again');
  assert.equal(made.generation, 1);
  assert.deepEqual(env.transport.calls, ['list', 'create', 'read'], 'at no extra cost');
  assert.equal(env.transport.created.length, new Set(env.transport.created).size, 'no name was ever sent twice');
  assert.deepEqual(env.transport.generations(stream), [3, 4], 'the old stream is left alone');
  const record = await restored.record();
  assert.deepEqual([record.stream, record.nextGeneration, record.validated.map((entry) => entry.generation)], [made.stream, 2, [1]]);
  assert.equal(record.device, saved.device, 'it keeps its label and its consent');
  assert.equal(canonical(record.consent), canonical(saved.consent));
});

test('two installations sharing one stream part ways at the first list that shows the other ahead', async () => {
  for (const duplicates of [false, true]) {
    const env = harness({ transport: fakeTransport({ duplicates }) });
    const { protocol: first, stream } = await consented(env);
    const home = device();
    home.mark(1);
    await first.upload(await home.snapshot());
    const second = await copyOf(env, await first.record());
    home.mark(2);
    await first.upload(await home.snapshot());
    home.mark(3);
    const parted = await second.upload(await home.snapshot());
    assert.notEqual(parted.stream, stream, `duplicates ${duplicates}: the copy starts its own stream`);
    home.mark(4);
    assert.equal((await first.upload(await home.snapshot())).stream, stream, 'and the first carries on with its own');
    assert.equal(env.transport.created.length, new Set(env.transport.created).size, 'no name was ever sent twice');
  }
});

// The copy lists before the first makes generation 2, then creates the same name, with other data. A
// provider that refuses a taken name refuses it, as the Windows host asks OneDrive to in the create's body
// (asked only in the URL, OneDrive replaced the file in the owner's session, P02-T07, B8); Google keeps
// both, and the list after the create finds the other. Either way the copy starts a new stream, and made
// again with the same data when its coordinator retries, within seconds, each copy's data is one discovery
// offers. Before the list after the create, Google kept both, and discovery, which shows a generation
// once, hid one copy's backup until that copy's data changed (stage 4 review, S4b-1).
test('a create refused because its name exists starts a new stream, and that number is never tried again', async () => {
  for (const duplicates of [false, true]) {
    const env = harness({ transport: fakeTransport({ duplicates }) });
    const { protocol: first, stream } = await consented(env);
    const home = device();
    home.mark(1);
    await first.upload(await home.snapshot());
    const second = await copyOf(env, await first.record());
    home.mark(2);
    const theirs = await home.snapshot();
    env.transport.faults.create.push(async () => { await first.upload(theirs); });
    home.mark(3);
    const mine = await home.snapshot();
    const taken = cloudBackupName(stream, 2);
    const made = await second.upload(mine).catch(async (error) => {
      if (error?.code !== 'exists') throw error;
      const record = await second.record();
      assert.notEqual(record.stream, stream);
      assert.deepEqual([record.nextGeneration, record.validated], [1, []], 'the next backup is the new stream\'s first');
      return second.upload(mine);
    });
    const offered = [];
    for (const entry of (await first.discover(ON)).devices) {
      for (const copy of [entry.current, entry.previous]) if (copy) offered.push(JSON.parse((await first.fetchBackup(copy, ON)).text).digest);
    }
    assert.deepEqual([offered.includes(theirs.backup.digest), offered.includes(mine.backup.digest)], [true, true],
      `duplicates ${duplicates}: each copy's data can be chosen, without waiting for its data to change`);
    assert.deepEqual(env.transport.generations(stream), [1, 2], 'one file of each number left in the shared stream');
    assert.notEqual(made.stream, stream, `duplicates ${duplicates}: parted`);
    assert.equal(env.transport.created.filter((name) => name === taken).length, 2, 'the shared number was sent once by each, never again');
  }
});

// ------------------------------------------------------------------ the transport contract

test('a transport that never answers is given up on at the deadline the engine states', async () => {
  assert.deepEqual({ ...CLOUD_TRANSPORT_DEADLINES_MS }, { list: 120_000, read: 600_000, create: 600_000, delete: 30_000 });
  assert.equal(CLOUD_DEADLINE_GRACE_MS, 15_000);
  const env = harness();
  const { protocol } = await consented(env, { deadlines: { list: 5, read: 5, create: 5, delete: 5 }, graceMs: 5 });
  const home = device();
  home.mark(1);
  env.transport.faults.create.push(() => new Promise(() => {}));
  await assert.rejects(protocol.upload(await home.snapshot()), { code: 'timeout' });
  assert.equal(await protocol.lastUploaded(ON), null);
  env.transport.faults.list.push(() => new Promise(() => {}));
  await assert.rejects(protocol.discover(ON), { code: 'timeout' });
});

test('a read refused as too large counts as a file that fails its checks, and discovery goes on', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const home = device();
  for (let n = 1; n <= 2; n += 1) {
    home.mark(n);
    await protocol.upload(await home.snapshot());
  }
  env.transport.faults.read.push('too-large');
  const found = await harness({ transport: env.transport }).make().discover(ON);
  const shown = found.devices.find((entry) => entry.stream === stream);
  assert.deepEqual([shown.current?.generation, shown.previous, shown.invalid], [1, null, 1]);
});

// ------------------------------------------------------------------ discovery

test('discovery shows each stream\'s newest valid backup and the one before, trusting nothing it reads and writing nothing', async () => {
  const transport = fakeTransport({ duplicates: true });
  const home = harness({ transport });
  const { protocol: homeProtocol, stream } = await consented(home);
  const laptop = device();
  for (let n = 1; n <= 3; n += 1) {
    laptop.mark(n);
    await homeProtocol.upload(await laptop.snapshot());
  }
  const { backup } = await laptop.snapshot();
  const altered = structuredClone(backup);
  altered.components.reader.read['1'] = 1;
  const planted = [
    // Another device, whose newest two files fail their checks in four different ways.
    [cloudBackupName(OTHER, 9), envelopeFile({ stream: OTHER, generation: 9, backup: altered })],
    [cloudBackupName(OTHER, 8), envelopeFile({ stream: OTHER, generation: 7, backup })],
    [cloudBackupName(OTHER, 6), gzipSync(Buffer.from('not json'))],
    [cloudBackupName(OTHER, 5), Buffer.from('not gzip at all')],
    [cloudBackupName(OTHER, 4), envelopeFile({ stream: OTHER, generation: 4, backup, device: 'Phone' })],
    [cloudBackupName(OTHER, 4), envelopeFile({ stream: OTHER, generation: 4, backup, device: 'Phone' })],
    [cloudBackupName(OTHER, 3), envelopeFile({ stream: OTHER, generation: 3, backup, device: 'Phone' })],
    // Files from before this protocol, and a stranger's.
    ['backup.json', Buffer.from('{}')], ['Recap Page probe.bin', Buffer.from([0])],
  ];
  for (const [name, bytes] of planted) transport.store(name, bytes);

  // A browser that has not given consent: it reads, and it creates nothing in the account or locally.
  const env = harness({ transport });
  const looking = env.make();
  transport.calls.length = 0;
  const filesBefore = [...transport.files.keys()];
  const found = await looking.discover(ON);
  assert.ok(transport.calls.every((call) => call === 'list' || call === 'read'), transport.calls.join(','));
  assert.deepEqual([...transport.files.keys()], filesBefore);
  assert.equal(await looking.record(), null);

  assert.equal(found.own, null);
  assert.equal(found.unrecognized, 2);
  const byStream = Object.fromEntries(found.devices.map((entry) => [entry.stream, entry]));
  assert.deepEqual(Object.keys(byStream).sort(), [OTHER, stream].sort());
  const mine = byStream[stream];
  assert.deepEqual([mine.current.generation, mine.previous.generation, mine.invalid, mine.files], [3, 2, 0, 2]);
  assert.equal(mine.current.device, CONSENT.device);
  assert.deepEqual(mine.current.summary, { lists: 2, records: 0, draft: false });
  const theirs = byStream[OTHER];
  assert.equal(theirs.invalid, 4, 'altered, misnamed, not JSON and not gzip');
  assert.equal(theirs.current, null, 'four reads at most for one stream, all failed');

  const wider = await env.make({ limits: { streams: 16, readsPerStream: 8 } }).discover(ON);
  const other = wider.devices.find((entry) => entry.stream === OTHER);
  assert.deepEqual([other.current.generation, other.previous.generation, other.current.device], [4, 3, 'Phone'],
    'a generation stored twice is shown once');

  // The browser that made them sees its own stream first and marked as its own.
  const own = await homeProtocol.discover(ON);
  assert.equal(own.own, stream);
  assert.equal(own.devices[0].stream, stream);
  assert.equal(own.devices[0].own, true);
  assert.equal(own.devices[1].own, false);
});

test('discovery stops decompressing at 32 MiB, so a small file that expands without end is not trusted', async () => {
  const env = harness();
  env.transport.store(cloudBackupName(OTHER, 1), gzipSync(Buffer.alloc(48 * MIB)));
  env.transport.store(cloudBackupName('e'.repeat(32), 1), new Uint8Array(0));
  let produced = 0;
  const written = [];
  // Chromium's DecompressionStream inflates every written chunk whole before anything reads its output:
  // in Edge 156 one 64 KiB chunk of a gzip bomb produced 67,415,144 bytes before the next write, against
  // 1,032,260 for a 1 KiB chunk (stage 1 review, M3). Node's honours backpressure inside a chunk, so it
  // could never show what the slicing is for. This double behaves as Chromium does and records the size
  // of every chunk it is given.
  class ChromiumLike {
    constructor(format) {
      assert.equal(format, 'gzip');
      const gunzip = createGunzip();
      const pending = [];
      gunzip.on('data', (out) => {
        produced += out.length;
        pending.push(out);
      });
      const failed = new Promise((resolve) => { gunzip.once('error', resolve); });
      const stream = new TransformStream({
        async transform(chunk, controller) {
          written.push(chunk.byteLength);
          const error = await Promise.race([new Promise((resolve) => { gunzip.write(chunk, () => resolve(null)); }), failed]);
          if (error) throw error;
          for (const out of pending.splice(0)) controller.enqueue(out);
        },
        async flush(controller) {
          const error = await Promise.race([new Promise((resolve) => { gunzip.end(() => resolve(null)); }), failed]);
          if (error) throw error;
          for (const out of pending.splice(0)) controller.enqueue(out);
        },
      });
      this.writable = stream.writable;
      this.readable = stream.readable;
    }
  }
  const found = await env.make({ streams: { Blob, CompressionStream, DecompressionStream: ChromiumLike } }).discover(ON);
  const bomb = found.devices.find((entry) => entry.stream === OTHER);
  assert.deepEqual([bomb.current, bomb.invalid], [null, 1]);
  assert.ok(written.length > 1 && Math.max(...written) <= 1024, `fed in kibibyte slices, the largest ${Math.max(...written)} bytes`);
  assert.ok(produced > MAX_CLOUD_BACKUP_BYTES && produced < MAX_CLOUD_BACKUP_BYTES + 4 * MIB,
    `stopped after ${produced} bytes, where a whole chunk would have produced 48 MiB`);

  // A listed size above the cap is never read at all.
  const big = harness();
  big.transport.store(cloudBackupName(OTHER, 2), new Uint8Array(4));
  const list = big.transport.list;
  big.transport.list = async (options) => (await list(options)).map((item) => ({ ...item, size: MAX_CLOUD_BACKUP_BYTES + 1 }));
  const listed = await big.make().discover(ON);
  assert.deepEqual([listed.devices.length, listed.unrecognized], [0, 1]);
  assert.ok(!big.transport.calls.includes('read'));
});

// ------------------------------------------------------------------ restore

test('a backup found in the account restores through the complete restore engine, and the restored browser keeps its own stream', async () => {
  const transport = fakeTransport();
  const awayEnv = harness({ transport });
  const away = await awayEnv.make();
  await away.recordConsent({ ...CONSENT, device: 'Old laptop' });
  const oldLaptop = device({ 1: 111, 2: 222 });
  const saved = await oldLaptop.snapshot();
  await away.upload(saved);

  const env = harness({ transport });
  const protocol = env.make();
  const found = await protocol.discover(ON);
  const [old] = found.devices;
  assert.deepEqual([found.own, old.own, old.current.device, old.current.summary.lists], [null, false, 'Old laptop', 2]);
  const chosen = await protocol.fetchBackup(old.current, ON);
  assert.equal(chosen.text, saved.text, 'the exact complete backup that was uploaded');

  const fresh = memoryStorage();
  const restore = new CompleteRestore({
    storage: fresh, locks: env.locks, journal: createRestoreJournal(env.idb), events: null,
    clock: () => env.time.now, cryptoProvider: webcrypto, reload: () => {}, lockAnswerMs: 200,
  });
  await restore.start();
  await restore.inspect();
  const result = await restore.restore(chosen.text);
  assert.equal(result.ok, true, result.error);
  const restored = await captureCompleteBackup({ storage: fresh, cryptoProvider: webcrypto });
  assert.equal(restored.backup.digest, saved.backup.digest, 'everything the backup held is what this browser now holds');

  const mine = await protocol.recordConsent({ ...CONSENT, device: 'New desktop' });
  assert.notEqual(mine.stream, old.stream, 'a restore never adopts the stream it came from');
  await protocol.upload({ text: restored.text, backup: restored.backup, personalDigest: await personalDigest(restored.backup, webcrypto) });
  const after = await protocol.discover(ON);
  assert.deepEqual(after.devices.map((entry) => [entry.own, entry.current.device, entry.current.generation]),
    [[true, 'New desktop', 1], [false, 'Old laptop', 1]]);
  assert.equal((await away.record()).nextGeneration, 2, 'the old stream was never written by the new browser');

  transport.files.clear();
  await assert.rejects(protocol.fetchBackup(old.current, ON), { code: 'gone' });
  const misnamed = transport.store(cloudBackupName(old.stream, 1), envelopeFile({ stream: old.stream, generation: 2, backup: saved.backup }));
  await assert.rejects(protocol.fetchBackup({ ...old.current, id: misnamed }, ON), { code: 'invalid' }, 'checked again when chosen');
});

// ------------------------------------------------------------------ deleting

test('deleting this device\'s backups withdraws consent first, then removes every generation of its stream and nothing else', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  assert.deepEqual(await harness().make().deleteOwnBackups(ON), { deleted: 0, failed: [] }, 'a browser that never turned it on');
  const home = device();
  for (let n = 1; n <= 3; n += 1) {
    home.mark(n);
    await protocol.upload(await home.snapshot());
  }
  home.mark(4);
  env.transport.faults.create.push('lost');
  await assert.rejects(protocol.upload(await home.snapshot()), { code: 'timeout' });
  env.transport.store(cloudBackupName(OTHER, 1), new Uint8Array([1]));
  env.transport.store('Recap Page notes.txt', new Uint8Array([2]));

  // Another tab's backup is under way, holding the worker lock with its create in flight.
  let landing;
  env.transport.faults.create.push(() => new Promise((resolve) => { landing = resolve; }));
  home.mark(5);
  const otherTab = env.make();
  const snapshot = await home.snapshot();
  const inFlight = env.locks.request(CLOUD_BACKUP_LOCK, { mode: 'exclusive' }, () => otherTab.upload(snapshot));
  await until(() => landing, 'the other tab\'s create is in flight');
  env.transport.calls.length = 0;
  const deleting = protocol.deleteOwnBackups(ON);
  await until(async () => (await protocol.record()).consent === null, 'consent is withdrawn before anything else');
  await until(() => env.locks.waiting(CLOUD_BACKUP_LOCK) === 1, 'the deletion waits for the backup under way');
  assert.deepEqual(env.transport.calls, [], 'nothing is listed or deleted while that backup runs');
  landing();
  await assert.rejects(inFlight, { code: 'refused' }, 'that backup is not counted once consent is withdrawn');
  const result = await deleting;
  assert.deepEqual(result, { deleted: 4, failed: [] }, 'generations 2 to 5, including the one that backup made');
  assert.deepEqual(env.transport.generations(stream), []);
  assert.deepEqual(env.transport.generations(OTHER), [1]);
  assert.equal(env.transport.files.size, 2);
  const record = await protocol.record();
  assert.deepEqual([record.stream, record.consent, record.validated, record.nextGeneration], [stream, null, [], 6],
    'the counter stays, so no number is reused, and nothing counts as backed up');
  await assert.rejects(protocol.upload(await home.snapshot()), { code: 'refused' });
});

// A deletion in one tab withdraws consent, then another tab gives it again for the same connection, while a
// backup made under the first consent is in flight. The deletion waits for that backup and then removes
// its file, so the backup must not count, or this browser would report up to date over an account holding
// nothing of its stream (stage 1 review, L1).
test('a backup made under consent that was withdrawn and given again for the same connection does not count', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const home = device();
  home.mark(1);
  const snapshot = await home.snapshot();
  const deleter = env.make();
  const again = env.make();
  let deleting;
  env.transport.faults.create.push(async () => {
    deleting = deleter.deleteOwnBackups(ON);
    await until(async () => (await again.record()).consent === null, 'the deletion withdrew consent');
    await again.recordConsent(CONSENT);
  });
  const backup = env.locks.request(CLOUD_BACKUP_LOCK, { mode: 'exclusive' }, () => protocol.upload(snapshot));
  await assert.rejects(backup, {
    code: 'refused', message: 'Cloud backup was turned off, or agreed to again, while this backup was made, so it does not count as made.',
  });
  assert.deepEqual(await deleting, { deleted: 1, failed: [] }, 'the deletion removed the file that backup made');
  assert.deepEqual(env.transport.generations(stream), []);
  const record = await protocol.record();
  assert.deepEqual([record.consent?.connection, record.validated], [CONSENT.connection, []], 'consent was given again, and nothing counts');
  assert.equal(await protocol.lastUploaded(ON), null);
});

test('a deletion that fails part way says which files remain, and stops at the first sign-in refusal', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const home = device();
  for (let n = 1; n <= 4; n += 1) {
    home.mark(n);
    env.transport.faults.create.push('lost');
    await assert.rejects(protocol.upload(await home.snapshot()), { code: 'timeout' });
  }
  assert.deepEqual(env.transport.generations(stream), [1, 2, 3, 4]);
  env.transport.faults.delete.push('timeout');
  const first = await protocol.deleteOwnBackups(ON);
  assert.equal(first.deleted, 3);
  assert.deepEqual(first.failed.map((entry) => [parseCloudBackupName(entry.name).generation, entry.code]), [[1, 'timeout']]);
  assert.deepEqual(await protocol.deleteOwnBackups(ON), { deleted: 1, failed: [] }, 'asking again finishes the job');

  await protocol.recordConsent(CONSENT);
  for (let n = 5; n <= 7; n += 1) {
    home.mark(n);
    env.transport.faults.create.push('lost');
    await assert.rejects(protocol.upload(await home.snapshot()), { code: 'timeout' });
  }
  env.transport.calls.length = 0;
  env.transport.faults.delete.push('needs-sign-in');
  const refused = await protocol.deleteOwnBackups(ON);
  assert.equal(refused.deleted, 0);
  assert.deepEqual(refused.failed.map((entry) => entry.code), ['needs-sign-in', 'needs-sign-in', 'needs-sign-in']);
  assert.deepEqual(env.transport.calls, ['list', 'delete'], 'no further deletes after the first refusal');
});

// A provider may answer not found for a file another device removed after the list. That file is gone,
// which is what deleting it was for, so neither pruning nor deletion stops on it (stage 1 review, L2).
test('a delete refused as not found counts as done, for pruning and for deleting this device\'s backups', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const home = device();
  for (let n = 1; n <= 3; n += 1) {
    home.mark(n);
    if (n === 3) env.transport.faults.delete.push('timeout');
    await protocol.upload(await home.snapshot());
  }
  assert.deepEqual(env.transport.generations(stream), [1, 2, 3], 'pruning lagged once');
  home.mark(4);
  env.transport.faults.delete.push('not-found');
  await protocol.upload(await home.snapshot());
  assert.deepEqual(env.transport.generations(stream), [1, 3, 4], 'pruning went on past generation 1 and removed generation 2');
  env.transport.faults.delete.push('not-found');
  assert.deepEqual(await protocol.deleteOwnBackups(ON), { deleted: 3, failed: [] });
});

// ------------------------------------------------------------------ with the coordinator

test('under the coordinator, a burst makes one backup at the cadence, opening a list makes none, and a lost reply is a new generation', async () => {
  const { quietMs, minIntervalMs, retryMs } = CLOUD_BACKUP_CADENCE;
  const time = fakeTime();
  const env = harness();
  const { protocol, stream } = await consented(env, { clock: time.now });
  const home = device();
  const seen = [];
  const coordinator = new CloudBackupCoordinator({
    capture: () => captureCompleteBackup({ storage: home.storage, cryptoProvider: webcrypto }),
    upload: (snapshot) => protocol.upload(snapshot), lastUploaded: () => protocol.lastUploaded({ connection: env.transport.connection }),
    locks: env.locks, events: new EventTarget(), clock: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer,
    cryptoProvider: webcrypto, isOnline: () => true, isHidden: () => false, onChange: (state) => seen.push(state),
  });
  coordinator.start();
  let heldDuringCreate = null;
  env.transport.faults.create.push(async () => { heldDuringCreate = env.locks.held(CLOUD_BACKUP_LOCK); });
  await time.advance(quietMs, [coordinator]);
  assert.deepEqual(env.transport.calls, ['list', 'create', 'read']);
  assert.equal(heldDuringCreate, 1, 'the coordinator backs up under the lock a deletion waits for');
  assert.equal(coordinator.state.phase, 'up-to-date');

  env.transport.calls.length = 0;
  for (let n = 1; n <= 10; n += 1) {
    home.mark(n);
    coordinator.notify();
    await time.advance(1000, [coordinator]);
  }
  await time.advance(minIntervalMs, [coordinator]);
  assert.deepEqual(env.transport.calls, ['list', 'create', 'read'], 'ten changes, one backup');

  env.transport.calls.length = 0;
  home.open('later');
  coordinator.notify();
  await time.advance(minIntervalMs, [coordinator]);
  assert.deepEqual(env.transport.calls, [], 'the active list is not backed up');
  assert.equal(coordinator.state.phase, 'up-to-date', 'compared and found unchanged, not refused');

  home.mark(99);
  coordinator.notify();
  env.transport.faults.create.push('lost');
  seen.length = 0;
  await time.advance(minIntervalMs + retryMs[0], [coordinator]);
  assert.ok(seen.some((state) => state.phase === 'retrying' && state.code === 'timeout'), 'the lost reply was retried');
  assert.equal(coordinator.state.phase, 'up-to-date');
  assert.deepEqual(env.transport.created.map((name) => parseCloudBackupName(name).generation), [1, 2, 3, 4]);
  assert.deepEqual(env.transport.generations(stream), [2, 3, 4], 'the lost reply\'s file waits to be pruned with the next backup');
  coordinator.stop();
});

// ------------------------------------------------------------------ the page's cloud backup

// The Windows host as the page meets it: the account above, plus the status, connect and disconnect the
// host answers. A sign-in stays open until the test finishes it, and every status request is counted.
function windowsHost(transport, { account = 'reader@example.test' } = {}) {
  const host = { enabled: true, state: transport.connection ? 'connected' : 'not-connected', statuses: 0, disconnects: 0, refuse: null, reason: null, silent: false };
  const linked = () => host.state === 'connected' || host.state === 'needs-sign-in';
  // A host that does not answer at all, as the real transport reads one: status says so as transient, and
  // every operation fails as unreachable.
  const answer = () => (host.silent ? Object.freeze({ enabled: false, transient: true }) : host.enabled ? Object.freeze({
    enabled: true, provider: 'onedrive', state: host.state, connection: linked() ? transport.connection : null,
    account: linked() ? account : null, message: null, reason: linked() ? host.reason : null,
    signInExpiresAt: host.state === 'signing-in' ? 1_800_000_300_000 : null,
  }) : Object.freeze({ enabled: false }));
  for (const name of ['list', 'read', 'create', 'delete']) {
    const operation = transport[name];
    transport[name] = async (...args) => {
      if (host.silent) throw Object.assign(new Error('The Recap Page app could not be reached.'), { code: 'unavailable' });
      return operation(...args);
    };
  }
  return Object.assign(transport, {
    host,
    async status() { host.statuses += 1; return answer(); },
    async connect() {
      if (host.state === 'not-connected' || host.state === 'needs-sign-in') host.state = 'signing-in';
      return answer();
    },
    async disconnect() {
      host.disconnects += 1;
      if (host.refuse) throw Object.assign(new Error(host.refuse), { code: 'refused' });
      transport.connection = null;
      host.state = 'not-connected';
      return answer();
    },
    // The sign-in in the browser finishing: the same connection for the same account and folder, or a new one.
    signedIn(connection) {
      transport.connection = connection;
      host.state = 'connected';
    },
  });
}

function page({
  env, home = device(), channel = null, databases, savedChanges = null, launchSync = false,
  events = new EventTarget(), isHidden = () => false, isOnline = () => true, device: label = 'Microsoft Edge on Windows',
} = {}) {
  const time = fakeTime();
  const protocol = env.make({ clock: time.now });
  const cloud = createCloudBackup({
    transport: env.transport, protocol, ...(label === null ? {} : { device: label }), channel, setTimer: time.setTimer, savedChanges,
    syncStorage: () => env.syncStorage,
    capture: () => captureCompleteBackup({ storage: home.storage, cryptoProvider: webcrypto }),
    databases: databases ?? (async () => [...env.idb.databases.keys()].map((name) => ({ name, version: 1 }))),
    coordinator: {
      locks: env.locks, events, clock: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer,
      cryptoProvider: webcrypto, isOnline, isHidden,
    },
    ...(launchSync ? {
      launchSync: {
        locks: env.locks, setTimer: time.setTimer, clearTimer: time.clearTimer, cryptoProvider: webcrypto,
        restoreReady: async () => ({ ok: true }),
        ...(launchSync === true ? {} : launchSync),
      },
    } : {}),
  });
  return { env, protocol, home, time, cloud, run: (ms = 0) => time.advance(ms, [cloud]) };
}

test('a consented OneDrive launch checks other devices before the automatic backup can run', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  await consented(env);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const { cloud, time } = page({ env, launchSync: true });
  await cloud.resume();
  assert.ok(cloud.model.sync, 'launch sync is part of the cloud card model');
  await until(() => cloud.model.sync.phase === 'offer', 'the other device is offered');
  assert.equal(cloud.model.sync.offer.remote.device, 'Phone');
  await time.advance(CLOUD_BACKUP_CADENCE.minIntervalMs, [cloud]);
  assert.deepEqual(env.transport.created, [], 'an unresolved offer holds automatic uploads');
  await cloud.turnOff();
});

for (const provider of ['googledrive', 'icloud']) {
  test(`${provider} keeps its existing backup behavior without the OneDrive launch offer`, async () => {
    const transport = windowsHost(fakeTransport());
    transport.status = async () => ({
      enabled: true, provider, state: 'connected', connection: 'connection-one', account: 'reader@example.test',
    });
    const env = harness({ transport });
    const protocol = env.make();
    await protocol.recordConsent({ ...CONSENT, provider });
    const remote = await device({ 1: 333 }).snapshot();
    env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
      stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
    }));
    const tab = page({ env, launchSync: true });
    await tab.cloud.resume();
    assert.equal(tab.cloud.model.sync.phase, 'off');
    await tab.time.advance(CLOUD_BACKUP_CADENCE.maxWaitMs, [tab.cloud]);
    assert.ok(env.transport.created.some((name) => parseCloudBackupName(name)), 'automatic backup still runs');
    assert.equal(tab.cloud.model.sync.phase, 'off', 'no launch choice is shown');
    await tab.cloud.turnOff();
  });
}

test('a saved change withdraws a launch offer immediately, before it is checked again', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  await consented(env);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const savedChanges = createSavedChanges();
  const { cloud, home, time } = page({ env, launchSync: true, savedChanges });
  await cloud.resume();
  await until(() => cloud.model.sync.phase === 'offer', 'the other device is offered');
  home.mark(2);
  savedChanges.notify();
  assert.equal(cloud.model.sync.phase, 'checking', 'the old offer is withdrawn as soon as the data changes');
  await time.advance(1000, [cloud]);
  await until(() => cloud.model.sync.phase === 'offer', 'the changed device is compared again');
  assert.equal(cloud.model.sync.offer.local.readCount, 2);
  await cloud.turnOff();
});

test('turning off withdraws a cloud choice before consent withdrawal finishes', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  await consented(env);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const tab = page({ env, launchSync: true });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the other device is offered');
  let release;
  const paused = new Promise((resolve) => { release = resolve; });
  const withdraw = tab.protocol.withdrawConsent.bind(tab.protocol);
  tab.protocol.withdrawConsent = async () => { await paused; return withdraw(); };
  const turningOff = tab.cloud.turnOff();
  assert.equal(tab.cloud.model.sync.phase, 'off', 'the old choice disappears before storage answers');
  assert.equal((await tab.cloud.keepSync()).ok, false);
  release();
  await turningOff;
});

test('an outstanding cloud choice stays open while unchanged, then follows newer and removed backups', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const older = await device({ 1: 333 }).snapshot();
  const first = env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: older.backup, device: 'Phone', createdAt: 123,
  }));
  const tab = page({ env, launchSync: true });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the other device is offered');
  const shown = tab.cloud.model.sync.offer;
  const lists = env.transport.calls.filter((call) => call === 'list').length;
  const reads = env.transport.calls.filter((call) => call === 'read').length;
  await tab.time.advance(5000);
  await until(() => env.transport.calls.filter((call) => call === 'list').length > lists, 'the offer is rechecked');
  await until(() => tab.time.pendingIn(5000) || tab.time.pendingIn(15000), 'the next offer check is scheduled');
  assert.equal(env.transport.calls.filter((call) => call === 'read').length, reads, 'unchanged backups are not downloaded again');
  assert.equal(tab.time.pendingIn(15000), true, 'unchanged listings back off');
  assert.equal(tab.cloud.model.sync.phase, 'offer', 'the unchanged offer remains');
  assert.equal(tab.cloud.model.sync.offer, shown, 'an unchanged question is not interrupted');
  assert.equal((await protocol.syncGate(context)).held, true);

  const newer = await device({ 2: 444 }).snapshot();
  const second = env.transport.store(cloudBackupName(OTHER, 2), envelopeFile({
    stream: OTHER, generation: 2, backup: newer.backup, device: 'Phone', createdAt: 124,
  }));
  await tab.time.advance(15000);
  await until(() => tab.cloud.model.sync.offer?.remote.id === second, 'the newer backup replaces the earlier choice');
  await until(() => tab.time.pendingIn(5000), 'the replacement is watched');
  assert.equal((await protocol.syncGate(context)).held, true);

  env.transport.files.delete(first);
  env.transport.files.delete(second);
  await tab.time.advance(5000);
  await until(() => tab.cloud.model.sync.phase === 'clear', 'the vanished backup is withdrawn and checked again');
  assert.equal(tab.cloud.model.sync.notice, null);
  assert.equal((await protocol.syncGate(context)).held, false);
  await tab.cloud.turnOff();
});

test('an unchanged offer uses bounded listing-only checks over an hour, including unknown listed sizes', async () => {
  const transport = windowsHost(fakeTransport());
  const list = transport.list.bind(transport);
  transport.list = async (options) => (await list(options)).map((item) => ({ ...item, size: null }));
  const env = harness({ transport });
  await consented(env);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const tab = page({ env, launchSync: true });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the other device is offered');
  const reads = transport.calls.filter((call) => call === 'read').length;
  const lists = transport.calls.filter((call) => call === 'list').length;
  const delays = [5_000, 15_000, 60_000, ...Array(11).fill(300_000)];
  for (const [index, delay] of delays.entries()) {
    await tab.time.advance(delay);
    const next = index === 0 ? 15_000 : index === 1 ? 60_000 : 300_000;
    await until(() => tab.time.pendingIn(next), 'the next backed-off listing is scheduled');
    assert.equal(tab.cloud.model.sync.phase, 'offer');
  }
  await tab.time.advance(3_600_000 - delays.reduce((sum, delay) => sum + delay, 0));
  assert.equal(transport.calls.filter((call) => call === 'list').length - lists, 14);
  assert.equal(transport.calls.filter((call) => call === 'read').length, reads, 'unchanged files are never downloaded by the watch');
  await tab.cloud.turnOff();
});

test('a same-size change remains subject to byte verification before Keep', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const remote = await device({ 1: 333 }).snapshot();
  const id = env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const tab = page({ env, launchSync: true });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the other device is offered');
  const file = env.transport.files.get(id);
  file.bytes[file.bytes.length - 1] ^= 1;
  await tab.time.advance(5_000);
  await until(() => tab.time.pendingIn(15_000), 'the unchanged listing is watched');
  assert.equal(tab.cloud.model.sync.phase, 'offer', 'a listing cannot detect changed bytes of the same size');
  assert.equal((await tab.cloud.keepSync()).ok, false, 'the final check does detect the changed bytes');
  assert.equal((await protocol.syncGate(context)).held, true);
  assert.deepEqual(await protocol.syncDeclines(context), []);
  await tab.cloud.turnOff();
});

test('a stalled offer recheck withdraws the choice and ignores its eventual answer', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const tab = page({ env, launchSync: true });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the other device is offered');
  let release;
  let entered = false;
  const wait = new Promise((resolve) => { release = resolve; });
  env.transport.faults.list.push(async () => { entered = true; await wait; });
  await tab.time.advance(5000);
  await until(() => entered, 'the offer recheck starts');
  await tab.time.advance(30_000);
  await until(() => tab.cloud.model.sync.phase === 'failed', 'the timed-out offer is withdrawn');
  assert.equal((await protocol.syncGate(context)).held, true);
  assert.equal((await tab.cloud.keepSync()).ok, false);
  release();
  await settle();
  assert.equal(tab.cloud.model.sync.phase, 'failed');
  assert.equal((await protocol.syncGate(context)).held, true);
  await tab.cloud.turnOff();
});

test('a late offer recheck cannot undo a Keep chosen while it was waiting', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const tab = page({ env, launchSync: true });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the other device is offered');
  let release;
  let entered = false;
  const wait = new Promise((resolve) => { release = resolve; });
  env.transport.faults.list.push(async () => { entered = true; await wait; });
  await tab.time.advance(5000);
  await until(() => entered, 'the offer recheck starts');
  assert.deepEqual(await tab.cloud.keepSync(), { ok: true });
  assert.equal((await protocol.syncGate(context)).held, false);
  release();
  await settle();
  assert.equal(tab.cloud.model.sync.phase, 'clear');
  assert.equal((await protocol.syncGate(context)).held, false);
  await tab.cloud.turnOff();
});

for (const change of ['sign-out', 'account switch']) {
  test(`an offer is withdrawn when its next check observes ${change}`, async () => {
    const env = harness({ transport: windowsHost(fakeTransport()) });
    const { protocol } = await consented(env);
    const context = await syncContext(protocol);
    const remote = await device({ 1: 333 }).snapshot();
    env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
      stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
    }));
    const tab = page({ env, launchSync: true });
    await tab.cloud.resume();
    await until(() => tab.cloud.model.sync.phase === 'offer', 'the other device is offered');
    if (change === 'sign-out') env.transport.host.state = 'not-connected';
    else env.transport.signedIn('connection-two');
    await tab.time.advance(5000);
    await until(() => tab.cloud.model.sync.phase === 'off', 'the old offer and account are withdrawn');
    assert.equal((await tab.cloud.keepSync()).ok, false);
    assert.equal((await protocol.syncGate(context)).held, true);
    assert.deepEqual(env.transport.created, []);
    assert.equal(tab.cloud.model.on, false);
    await tab.cloud.turnOff();
  });
}

test('a local save at the final no-offer gate release keeps uploads paused', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const home = device();
  const tab = page({
    env, home,
    launchSync: { snapshotCurrent: (witness) => CAPTURE_KEYS.every((key) => home.storage.getItem(key) === witness[key]) },
  });
  const setGate = tab.protocol.setSyncGate.bind(tab.protocol);
  let changed = false;
  tab.protocol.setSyncGate = async (args) => {
    if (!args.held && !changed) {
      changed = true;
      home.mark(999);
    }
    return setGate(args);
  };
  await tab.cloud.resume();
  await until(() => ['failed', 'clear'].includes(tab.cloud.model.sync.phase), 'the check settles');
  assert.equal(tab.cloud.model.sync.phase, 'failed', 'the changed snapshot is refused');
  assert.equal((await protocol.syncGate(context)).held, true);
  assert.deepEqual(env.transport.created, []);
  await tab.cloud.turnOff();
});

test('a matching device does not erase the decision to keep different progress from another device', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const home = device();
  const local = await home.snapshot();
  const declined = await device({ 1: 333 }).snapshot();
  const third = 'e'.repeat(32);
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: declined.backup, device: 'Phone', createdAt: 123,
  }));
  env.transport.store(cloudBackupName(third, 1), envelopeFile({
    stream: third, generation: 1, backup: local.backup, device: 'Tablet', createdAt: 124,
  }));
  await protocol.rememberSync({ ...context, declinedDigest: declined.personalDigest });
  const tab = page({ env, home, launchSync: true });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'clear', 'the matching device is checked');
  assert.equal((await protocol.syncState(ON)).declinedDigest, declined.personalDigest);
  await tab.cloud.recheckSync();
  assert.equal(tab.cloud.model.sync.phase, 'clear', 'the unchanged declined backup is not offered again');
  await tab.cloud.turnOff();
});

test('returning after a minute re-arms the hold and checks newly saved cloud progress', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  await consented(env);
  const events = new EventTarget();
  let hidden = false;
  const { cloud, time } = page({ env, launchSync: true, events, isHidden: () => hidden });
  await cloud.resume();
  await until(() => cloud.model.sync.phase === 'clear', 'the initial check finishes');
  hidden = true;
  events.dispatchEvent(new Event('visibilitychange'));
  await time.advance(60_000, [cloud]);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  hidden = false;
  events.dispatchEvent(new Event('visibilitychange'));
  assert.notEqual(cloud.model.sync.phase, 'clear', 'the old result is withdrawn on return');
  await until(() => cloud.model.sync.phase === 'offer', 'the new cloud progress is offered');
  assert.equal(cloud.model.sync.offer.remote.device, 'Phone');
  await cloud.turnOff();
});

test('Keep records the declined remote and allows this device to back up without removing the other device', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const remote = await device({ 1: 333 }).snapshot();
  const remoteId = env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const { cloud, time, home } = page({ env, launchSync: true });
  const before = await home.snapshot();
  await cloud.resume();
  await until(() => cloud.model.sync.phase === 'offer', 'the other device is offered');
  const offered = cloud.model.sync.offer;
  assert.deepEqual(await cloud.keepSync(), { ok: true });
  assert.deepEqual(await protocol.syncDeclines(context), [{ stream: OTHER, digest: offered.remote.digest }]);
  assert.equal((await protocol.syncGate(context)).held, false);
  await time.advance(CLOUD_BACKUP_CADENCE.minIntervalMs, [cloud]);
  assert.ok(env.transport.files.has(remoteId), 'ordinary pruning never removes another device');
  assert.equal((await home.snapshot()).backup.digest, before.backup.digest, 'Keep does not replace local data');
  assert.ok(env.transport.created.some((name) => parseCloudBackupName(name)?.stream === context.stream));
  await cloud.turnOff();
});

test('Keep remembers each differing remote stream without alternating offers', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const first = await device({ 1: 333 }).snapshot();
  const second = await device({ 2: 444 }).snapshot();
  const tablet = 'e'.repeat(32);
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: first.backup, device: 'Phone', createdAt: 123,
  }));
  env.transport.store(cloudBackupName(tablet, 1), envelopeFile({
    stream: tablet, generation: 1, backup: second.backup, device: 'Tablet', createdAt: 124,
  }));
  const tab = page({ env, launchSync: true });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the first stream is offered');
  const declinedFirst = tab.cloud.model.sync.offer.remote.stream;
  assert.equal((await tab.cloud.keepSync()).ok, true);
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the other stream is offered');
  assert.notEqual(tab.cloud.model.sync.offer.remote.stream, declinedFirst);
  assert.equal((await protocol.syncGate(context)).held, true, 'uploads stay held while the second choice is pending');
  assert.deepEqual(env.transport.created, [], 'the first Keep does not upload before the second choice');
  assert.equal((await tab.cloud.keepSync()).ok, true);
  await tab.cloud.recheckSync();
  assert.equal(tab.cloud.model.sync.phase, 'clear', 'both prior choices remain remembered');
  await tab.cloud.recheckSync();
  assert.equal(tab.cloud.model.sync.phase, 'clear', 'checking again does not alternate between streams');
  assert.equal((await env.make().syncDeclines(context)).length, 2, 'both choices survive a new protocol instance');
  await tab.cloud.turnOff();
});

for (const interveningUpload of [false, true]) test(`Load and Go back preserve a choice and promptly upload after an intervening upload: ${interveningUpload}`, async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const home = device();
  const original = await home.snapshot();
  const declined = await device({ 2: 444 }).snapshot();
  const selected = await device({ 1: 333 }).snapshot();
  const tablet = 'e'.repeat(32);
  env.transport.store(cloudBackupName(tablet, 1), envelopeFile({
    stream: tablet, generation: 1, backup: declined.backup, device: 'Tablet', createdAt: 124,
  }));
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: selected.backup, device: 'Phone', createdAt: 123,
  }));
  const makeRestore = async () => {
    const restore = new CompleteRestore({
      storage: home.storage, locks: env.locks, journal: createRestoreJournal(env.idb), events: null,
      cryptoProvider: webcrypto, reload: () => {}, lockAnswerMs: 200,
    });
    await restore.start();
    await restore.inspect();
    return restore;
  };
  const draft = { recovery: [], uncertain: false };
  let restore = await makeRestore();
  const tab = page({
    env, home, launchSync: {
      restoreReady: () => restore.checkAvailability(),
      restore: (text, options) => restore.restore(text, { ...options, importDraft: draft, draftRecovery: [] }),
    },
  });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the newest tablet is offered');
  assert.equal(tab.cloud.model.sync.offer.remote.stream, tablet);
  assert.equal((await tab.cloud.keepSync()).ok, true);
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the phone is offered next');
  assert.equal(tab.cloud.model.sync.offer.remote.stream, OTHER);
  assert.equal((await tab.cloud.loadSync()).ok, true);
  assert.equal((await home.snapshot()).backup.digest, selected.backup.digest);
  assert.deepEqual(await protocol.syncDeclines(context), [{ stream: tablet, digest: declined.personalDigest }]);

  env.locks.closeHolder(CLOUD_SYNC_OFFER_LOCK);
  await restore.releaseShared();
  restore = await makeRestore();
  const reopened = page({
    env, home, launchSync: {
      restoreReady: () => restore.checkAvailability(),
      restore: (text, options) => restore.restore(text, { ...options, importDraft: draft, draftRecovery: [] }),
    },
  });
  await reopened.cloud.resume();
  await until(() => reopened.cloud.model.sync.phase === 'clear', 'the loaded device is checked after restart');
  await reopened.run(0);
  assert.equal((await protocol.lastUploaded(ON)).personalDigest, selected.personalDigest);
  if (interveningUpload) await protocol.upload(await device({ 1: 777 }).snapshot());
  assert.equal((await reopened.cloud.goBackSync()).ok, true);
  assert.equal((await home.snapshot()).backup.digest, original.backup.digest);
  assert.deepEqual(await env.make().syncDeclines(context), [{ stream: tablet, digest: declined.personalDigest }]);
  env.locks.closeHolder(CLOUD_SYNC_OFFER_LOCK);
  await restore.releaseShared();
  const afterBack = page({ env, home, launchSync: true });
  await afterBack.cloud.resume();
  await until(() => afterBack.cloud.model.sync.phase === 'clear', 'the restored prior progress is checked after restart');
  await afterBack.run(0);
  assert.equal((await protocol.lastUploaded(ON)).personalDigest, original.personalDigest,
    'Go back publishes the checked restored progress without the ordinary backup spacing');
  await afterBack.cloud.turnOff();
  await reopened.cloud.turnOff();
  await tab.cloud.turnOff();
});

test('Keep refuses a remote whose bytes changed after the offer', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const remote = await device({ 1: 333 }).snapshot();
  const remoteId = env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const { cloud } = page({ env, launchSync: true });
  await cloud.resume();
  await until(() => cloud.model.sync.phase === 'offer', 'the other device is offered');
  env.transport.files.get(remoteId).bytes = new Uint8Array([1, 2, 3]);
  const result = await cloud.keepSync();
  assert.equal(result.ok, false);
  assert.equal((await protocol.syncState(ON))?.declinedDigest ?? null, null);
  assert.equal((await protocol.syncGate(context)).held, true);
  await cloud.turnOff();
});

test('a save during Keep withdraws the choice and restores the previous declined marker', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const savedChanges = createSavedChanges();
  const tab = page({ env, launchSync: true, savedChanges });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the other device is offered');
  const remember = tab.protocol.rememberDecline.bind(tab.protocol);
  let changed = false;
  tab.protocol.rememberDecline = async (args) => {
    const result = await remember(args);
    if (!changed && args.digest !== null) {
      changed = true;
      tab.home.mark(2);
      savedChanges.notify();
    }
    return result;
  };
  assert.equal((await tab.cloud.keepSync()).ok, false);
  assert.deepEqual(await protocol.syncDeclines(context), []);
  const gate = await protocol.syncGate(context);
  assert.equal(gate.held, true);
  assert.equal(gate.pending, undefined);
  await tab.time.advance(1000, [tab.cloud]);
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the changed device is offered again');
  await tab.cloud.turnOff();
});

test('an interrupted Keep is rolled back before a later launch checks or releases the hold', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const remoteDigest = await personalDigest(remote.backup, webcrypto);
  const epoch = 'a'.repeat(32);
  await protocol.setSyncGate({ ...context, epoch, held: true });
  await protocol.setSyncGate({ ...context, epoch, held: true, pending: { previous: null, intended: remoteDigest } });
  await protocol.rememberSync({ ...context, declinedDigest: remoteDigest });
  const { cloud } = page({ env, launchSync: true });
  await cloud.resume();
  await until(() => cloud.model.sync.phase === 'offer', 'the interrupted choice is offered again');
  assert.equal((await protocol.syncState(ON)).declinedDigest, null);
  const gate = await protocol.syncGate(context);
  assert.equal(gate.held, true);
  assert.equal(gate.pending, undefined);
  await cloud.turnOff();
});

test('an interrupted per-stream Keep restores its previous decision without touching other streams', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const remote = await device({ 1: 333 }).snapshot();
  const third = 'e'.repeat(32);
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const previous = 'a'.repeat(64);
  const unrelated = 'b'.repeat(64);
  await protocol.rememberDecline({ ...context, remoteStream: OTHER, digest: previous, expected: null });
  await protocol.rememberDecline({ ...context, remoteStream: third, digest: unrelated, expected: null });
  const epoch = 'c'.repeat(32);
  await protocol.setSyncGate({ ...context, epoch, held: true });
  await protocol.setSyncGate({
    ...context, epoch, held: true, pending: { stream: OTHER, previous, intended: remote.personalDigest },
  });
  await protocol.rememberDecline({ ...context, remoteStream: OTHER, digest: remote.personalDigest, expected: previous });
  const tab = page({ env, launchSync: true });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the interrupted choice is offered again');
  assert.deepEqual(await protocol.syncDeclines(context), [
    { stream: third, digest: unrelated }, { stream: OTHER, digest: previous },
  ]);
  assert.equal((await protocol.syncGate(context)).pending, undefined);
  await tab.cloud.turnOff();
});

test('a corrupt per-stream choice record keeps uploads paused instead of silently forgetting it', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  await protocol.rememberDecline({ ...context, remoteStream: OTHER, digest: 'a'.repeat(64), expected: null });
  env.idb.databases.get(CLOUD_BACKUP_DATABASE).get('stream').get('sync-declines').entries[0].digest = 'invalid';
  const tab = page({ env, launchSync: true });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'failed', 'the corrupt choice fails the check');
  assert.equal((await protocol.syncGate(context)).held, true);
  assert.deepEqual(env.transport.created, []);
  await tab.cloud.turnOff();
});

test('per-stream choices are not adopted after consent is withdrawn and granted again', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const old = await syncContext(protocol);
  await protocol.rememberDecline({ ...old, remoteStream: OTHER, digest: 'a'.repeat(64), expected: null });
  await protocol.withdrawConsent();
  await protocol.recordConsent(CONSENT);
  const current = await syncContext(protocol);
  assert.notEqual(current.consentId, old.consentId);
  assert.deepEqual(await protocol.syncDeclines(current), []);
  await assert.rejects(protocol.syncDeclines(old), { code: 'needs-consent' });
});

for (const fault of ['abort', 'drop']) {
  test(`a ${fault === 'abort' ? 'transaction abort' : 'lost write'} during a per-stream choice is reported`, async () => {
    const env = harness();
    const { protocol } = await consented(env);
    const context = await syncContext(protocol);
    env.idb.faults[fault] = 1;
    await assert.rejects(protocol.rememberDecline({
      ...context, remoteStream: OTHER, digest: 'a'.repeat(64), expected: null,
    }), { code: 'storage' });
    assert.deepEqual(await protocol.syncDeclines(context), []);
  });
}

test('Load keeps the exact local copy in the cloud and a journal before replacing it', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const home = device();
  const prior = await home.snapshot();
  const priorReader = home.storage.getItem(KEY);
  const draft = { recovery: [], uncertain: false };
  const restore = new CompleteRestore({
    storage: home.storage, locks: env.locks, journal: createRestoreJournal(env.idb), events: null,
    clock: () => env.time.now, cryptoProvider: webcrypto, reload: () => {}, lockAnswerMs: 200,
  });
  await restore.start();
  await restore.inspect();
  const tab = page({
    env, home,
    launchSync: { restore: (text, options) => {
      assert.equal(typeof options.assertStillAuthorized, 'function');
      options.assertStillAuthorized();
      return restore.restore(text, { ...options, importDraft: draft, draftRecovery: draft.recovery.slice() });
    } },
  });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the other device is offered');
  const result = await tab.cloud.loadSync();
  assert.equal(result.ok, true, result.error);
  assert.equal((await home.snapshot()).backup.digest, remote.backup.digest);
  assert.deepEqual(env.transport.generations(context.stream), [],
    'the data being replaced is not published as the newest ordinary backup');
  const sync = await protocol.syncState(ON);
  assert.equal(sync.kept.contentDigest, prior.backup.digest);
  assert.ok(env.transport.files.has(sync.kept.id), 'the independent cloud copy still exists');
  assert.equal((await protocol.fetchKeptBackup({ ...context, kept: sync.kept })).text, prior.text);
  assert.equal((await protocol.syncGate(context)).held, true, 'the stale page cannot upload before reloading');
  assert.equal(JSON.parse(await restore.exportPrior()).values[KEY], priorReader, 'the local recovery journal remains available');
  await tab.cloud.turnOff();
});

test('a refused Load never activates or prunes the earlier go-back copy', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const home = device();
  let earlier;
  for (const change of [2, 3, 4]) {
    const request = await uploadForKept(protocol, home, change);
    earlier = await protocol.keepBackup(request);
  }
  home.mark(999);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const before = await home.snapshot();
  const tab = page({ env, home, launchSync: { restore: async () => ({ ok: false, error: 'Close other tabs.' }) } });
  await tab.cloud.resume();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await until(() => tab.cloud.model.sync.phase === 'offer', 'the remote remains available');
    assert.equal((await tab.cloud.loadSync()).ok, false);
    assert.deepEqual((await protocol.syncState(ON)).kept, earlier, 'a refused restore cannot move Go back');
    assert.ok(env.transport.files.has(earlier.id), 'the earlier copy is not pruned');
    assert.equal((await home.snapshot()).backup.digest, before.backup.digest);
    if (attempt < 2) await tab.cloud.recheckSync();
  }
  assert.equal((await protocol.syncGate(context)).held, true);
  await tab.cloud.turnOff();
});

test('a late failed download leaves the prior Go back copy active and all earlier copies intact', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const home = device();
  let earlier;
  for (const change of [2, 3, 4]) earlier = await protocol.keepBackup(await uploadForKept(protocol, home, change));
  const retainedBefore = [...env.transport.files.values()]
    .filter((file) => file.name.startsWith('recap-page-kept-')).map((file) => file.name);
  home.mark(999);
  const local = await home.snapshot();
  const remote = await device({ 1: 333 }).snapshot();
  const remoteId = env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  let restored = false;
  const tab = page({ env, home, launchSync: { restore: async () => { restored = true; return { ok: true }; } } });
  const fetch = tab.protocol.fetchBackup.bind(tab.protocol);
  let selectedReads = 0;
  tab.protocol.fetchBackup = async (item, options) => {
    if (item.id === remoteId && ++selectedReads === 2) throw new CloudBackupError('The download failed.', 'unavailable');
    return fetch(item, options);
  };
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the remote is offered');
  assert.equal((await tab.cloud.loadSync()).ok, false);
  assert.equal(selectedReads, 2, 'the second, post-staging download is the failure');
  assert.equal(restored, false);
  assert.deepEqual((await protocol.syncState(ON)).kept, earlier);
  assert.ok(retainedBefore.every((name) => [...env.transport.files.values()].some((file) => file.name === name)));
  assert.equal((await home.snapshot()).backup.digest, local.backup.digest);
  await tab.cloud.turnOff();
});

test('a matching verified regular upload is reused without creating another ordinary backup', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const home = device();
  const local = await home.snapshot();
  const uploaded = await protocol.upload(local);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const restore = new CompleteRestore({
    storage: home.storage, locks: env.locks, journal: createRestoreJournal(env.idb), events: null,
    cryptoProvider: webcrypto, reload: () => {}, lockAnswerMs: 200,
  });
  await restore.start();
  await restore.inspect();
  const draft = { recovery: [], uncertain: false };
  const tab = page({
    env, home, launchSync: {
      restoreReady: () => restore.checkAvailability(),
      restore: (text, options) => restore.restore(text, { ...options, importDraft: draft, draftRecovery: [] }),
    },
  });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the remote is offered');
  assert.equal((await tab.cloud.loadSync()).ok, true);
  assert.deepEqual(env.transport.generations(context.stream), [uploaded.generation]);
  assert.equal((await protocol.syncState(ON)).kept.generation, uploaded.generation);
  assert.equal((await protocol.syncState(ON)).kept.contentDigest, local.backup.digest);
  await tab.cloud.turnOff();
  await restore.releaseShared();
});

for (const hasEarlierKept of [false, true]) test(`Load handles empty local data with an earlier kept copy: ${hasEarlierKept}`, async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  let earlier = null;
  if (hasEarlierKept) {
    const snapshot = await device().snapshot();
    const uploaded = await protocol.upload(snapshot);
    earlier = await protocol.keepBackup({
      ...context, generation: uploaded.generation,
      personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
    });
  }
  const storage = memoryStorage();
  const home = {
    storage,
    snapshot: async () => {
      const { text, backup } = await captureCompleteBackup({ storage, cryptoProvider: webcrypto });
      return { text, backup, personalDigest: await personalDigest(backup, webcrypto) };
    },
  };
  const empty = await home.snapshot();
  const ordinaryBefore = env.transport.generations(context.stream);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const makeRestore = async () => {
    const instance = new CompleteRestore({
      storage, locks: env.locks, journal: createRestoreJournal(env.idb), events: null, cryptoProvider: webcrypto,
      reload: () => {}, lockAnswerMs: 200,
    });
    await instance.start();
    await instance.inspect();
    return instance;
  };
  let restore = await makeRestore();
  const draft = { recovery: [], uncertain: false };
  const tab = page({
    env, home, launchSync: {
      restoreReady: () => restore.checkAvailability(),
      restore: (text, options) => restore.restore(text, { ...options, importDraft: draft, draftRecovery: [] }),
    },
  });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the remote is offered');
  const question = cloudSyncQuestion(tab.cloud.model.sync.offer, { when: () => 'earlier' });
  if (hasEarlierKept) {
    assert.match(question.body, /A copy of this device's progress is kept, and you can go back/);
  } else {
    assert.doesNotMatch(question.body, /A copy of this device's progress is kept|you can go back/);
  }
  const result = await tab.cloud.loadSync();
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(env.transport.generations(context.stream), ordinaryBefore, 'Load does not create an ordinary backup');
  assert.equal((await home.snapshot()).backup.digest, remote.backup.digest);
  if (hasEarlierKept) {
    const kept = (await protocol.syncState(ON)).kept;
    assert.notEqual(kept.id, earlier.id, 'the older copy no longer masquerades as the pre-Load state');
    assert.equal(kept.contentDigest, empty.backup.digest);
    assert.equal(keptCreates(env.transport).length, 2);
    assert.ok(env.transport.files.has(earlier.id), 'the earlier kept file is retained');

    env.locks.closeHolder(CLOUD_SYNC_OFFER_LOCK);
    await restore.releaseShared();
    restore = await makeRestore();
    const reopened = page({
      env, home, launchSync: {
        restoreReady: () => restore.checkAvailability(),
        restore: (text, options) => restore.restore(text, { ...options, importDraft: draft, draftRecovery: [] }),
      },
    });
    await reopened.cloud.resume();
    await until(() => reopened.cloud.model.sync.phase === 'clear', 'the loaded state is checked after restart');
    const back = await reopened.cloud.goBackSync();
    assert.equal(back.ok, true, back.error);
    assert.equal((await home.snapshot()).backup.digest, empty.backup.digest, 'Go back restores the exact empty state');
    await reopened.cloud.turnOff();
  } else {
    assert.deepEqual(keptCreates(env.transport), []);
    assert.equal((await protocol.syncState(ON))?.kept ?? null, null);
  }
  await tab.cloud.turnOff();
  await restore.releaseShared();
});

for (const trigger of ['Load', 'watch']) test(`an empty-device offer is withdrawn if its earlier kept reference changes: ${trigger}`, async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const storage = memoryStorage();
  const home = {
    storage,
    snapshot: async () => {
      const { text, backup } = await captureCompleteBackup({ storage, cryptoProvider: webcrypto });
      return { text, backup, personalDigest: await personalDigest(backup, webcrypto) };
    },
  };
  const empty = await home.snapshot();
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const restore = new CompleteRestore({
    storage, locks: env.locks, journal: createRestoreJournal(env.idb), events: null, cryptoProvider: webcrypto,
    reload: () => {}, lockAnswerMs: 200,
  });
  await restore.start();
  await restore.inspect();
  const draft = { recovery: [], uncertain: false };
  const tab = page({
    env, home, launchSync: {
      restoreReady: () => restore.checkAvailability(),
      restore: (text, options) => restore.restore(text, { ...options, importDraft: draft, draftRecovery: [] }),
    },
  });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the remote is offered');
  const other = await device().snapshot();
  const uploaded = await protocol.upload(other);
  const kept = await protocol.keepBackup({
    ...context, generation: uploaded.generation,
    personalDigest: other.personalDigest, contentDigest: other.backup.digest,
  });
  if (trigger === 'Load') {
    const result = await tab.cloud.loadSync();
    assert.equal(result.ok, false);
    assert.match(result.error, /changed|withdrawn/i);
  } else {
    const original = tab.cloud.model.sync.offer;
    await tab.time.advance(5000);
    await until(() => tab.cloud.model.sync.phase === 'offer' && tab.cloud.model.sync.offer !== original,
      'the offer is replaced after the kept reference changes');
    assert.match(cloudSyncQuestion(tab.cloud.model.sync.offer, { when: () => 'earlier' }).body,
      /A copy of this device's progress is kept/);
  }
  assert.equal((await home.snapshot()).backup.digest, empty.backup.digest);
  assert.equal((await protocol.syncState(ON)).kept.id, kept.id);
  await tab.cloud.turnOff();
  await restore.releaseShared();
});

test('an otherwise empty device with customized settings still gets a cloud safety copy', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const storage = memoryStorage([[SETTINGS_KEY, JSON.stringify({ theme: 'dark' })]]);
  const snapshot = () => captureCompleteBackup({ storage, cryptoProvider: webcrypto });
  const prior = await snapshot();
  const home = { storage, snapshot };
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const restore = new CompleteRestore({
    storage, locks: env.locks, journal: createRestoreJournal(env.idb), events: null,
    cryptoProvider: webcrypto, reload: () => {}, lockAnswerMs: 200,
  });
  await restore.start();
  await restore.inspect();
  const draft = { recovery: [], uncertain: false };
  const tab = page({
    env, home, launchSync: {
      restoreReady: () => restore.checkAvailability(),
      restore: (text, options) => restore.restore(text, { ...options, importDraft: draft, draftRecovery: [] }),
    },
  });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the remote is offered');
  assert.equal((await tab.cloud.loadSync()).ok, true);
  assert.equal((await protocol.syncState(ON)).kept.contentDigest, prior.backup.digest);
  assert.equal(keptCreates(env.transport).length, 1);
  await tab.cloud.turnOff();
  await restore.releaseShared();
});

test('the checked state loaded from another device uploads without the normal spacing delay', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const home = device();
  await protocol.upload(await home.snapshot());
  home.mark(999);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const restore = new CompleteRestore({
    storage: home.storage, locks: env.locks, journal: createRestoreJournal(env.idb), events: null,
    cryptoProvider: webcrypto, reload: () => {}, lockAnswerMs: 200,
  });
  await restore.start();
  await restore.inspect();
  const draft = { recovery: [], uncertain: false };
  const tab = page({
    env, home, launchSync: {
      restoreReady: () => restore.checkAvailability(),
      restore: (text, options) => restore.restore(text, { ...options, importDraft: draft, draftRecovery: [] }),
    },
  });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the remote is offered');
  assert.equal((await tab.cloud.loadSync()).ok, true);
  env.locks.closeHolder(CLOUD_SYNC_OFFER_LOCK);
  await restore.releaseShared();
  const reopened = page({ env, home, launchSync: true });
  await reopened.cloud.resume();
  await until(() => reopened.cloud.model.sync.phase === 'clear', 'the loaded state is checked after reopening');
  await reopened.run(0);
  assert.equal((await protocol.lastUploaded(ON)).personalDigest, remote.personalDigest,
    'the verified loaded state replaces the previous ordinary backup immediately after the check');
  assert.ok(env.transport.generations(context.stream).length >= 2);
  await reopened.cloud.turnOff();
  await tab.cloud.turnOff();
});

test('a restore blocked by another tab makes no safety upload', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  await consented(env);
  const home = device();
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const restore = new CompleteRestore({
    storage: home.storage, locks: env.locks, journal: createRestoreJournal(env.idb), events: null,
    cryptoProvider: webcrypto, reload: () => {}, lockAnswerMs: 200,
  });
  const other = new CompleteRestore({
    storage: home.storage, locks: env.locks, journal: createRestoreJournal(env.idb), events: null,
    cryptoProvider: webcrypto, reload: () => {}, lockAnswerMs: 200,
  });
  await restore.start();
  await restore.inspect();
  await other.start();
  await other.inspect();
  const draft = { recovery: [], uncertain: false };
  const tab = page({
    env, home, launchSync: {
      restoreReady: () => restore.checkAvailability(),
      restore: (text, options) => restore.restore(text, { ...options, importDraft: draft, draftRecovery: [] }),
    },
  });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the remote is offered');
  const before = env.transport.created.length;
  const result = await tab.cloud.loadSync();
  assert.equal(result.ok, false);
  assert.equal(env.transport.created.length, before, 'a refused restore does not create any cloud copy');
  await tab.cloud.turnOff();
  await other.releaseShared();
  await restore.releaseShared();
});

test('network and return events wait for an in-progress cloud restore to finish', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  await consented(env);
  const home = device();
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const events = new EventTarget();
  const journal = createRestoreJournal(env.idb);
  const progress = journal.progress;
  journal.progress = async (record) => {
    await progress(record);
    if (record.writes === 1) {
      events.dispatchEvent(new Event('offline'));
      events.dispatchEvent(new Event('online'));
    }
  };
  const restore = new CompleteRestore({
    storage: home.storage, locks: env.locks, journal, events: null, cryptoProvider: webcrypto,
    reload: () => {}, lockAnswerMs: 200,
  });
  await restore.start();
  await restore.inspect();
  const draft = { recovery: [], uncertain: false };
  const tab = page({
    env, home, events,
    launchSync: { restore: (text, options) => restore.restore(text, { ...options, importDraft: draft, draftRecovery: [] }) },
  });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the remote is offered');
  const result = await tab.cloud.loadSync();
  assert.equal(result.ok, true, result.error);
  assert.equal((await home.snapshot()).backup.digest, remote.backup.digest);
  assert.equal(tab.cloud.model.sync.phase, 'loaded', 'the old page stays held until it reloads');
  await tab.cloud.turnOff();
  await restore.releaseShared();
});

test('a disconnect during restore still activates the already verified prior cloud copy', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const home = device();
  const prior = await home.snapshot();
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const events = new EventTarget();
  let online = true;
  const journal = createRestoreJournal(env.idb);
  const progress = journal.progress;
  journal.progress = async (record) => {
    await progress(record);
    if (record.writes === 1) {
      online = false;
      events.dispatchEvent(new Event('offline'));
    }
  };
  const restore = new CompleteRestore({
    storage: home.storage, locks: env.locks, journal, events: null, cryptoProvider: webcrypto,
    reload: () => {}, lockAnswerMs: 200,
  });
  await restore.start();
  await restore.inspect();
  const draft = { recovery: [], uncertain: false };
  const tab = page({
    env, home, events, isOnline: () => online,
    launchSync: { restore: (text, options) => restore.restore(text, { ...options, importDraft: draft, draftRecovery: [] }) },
  });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the remote is offered');
  const result = await tab.cloud.loadSync();
  assert.equal(result.ok, true, result.error);
  assert.equal((await home.snapshot()).backup.digest, remote.backup.digest);
  assert.equal((await protocol.syncState(ON))?.kept?.contentDigest, prior.backup.digest,
    'Go back names the verified data from immediately before Load');
  await tab.cloud.turnOff();
  await restore.releaseShared();
});

test('a follower cannot release a stale clear gate when no check leader existed', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const epoch = 'a'.repeat(32);
  await protocol.setSyncGate({ ...context, epoch, held: true });
  await protocol.setSyncGate({ ...context, epoch, held: false });
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  let acquired;
  let release;
  const ready = new Promise((resolve) => { acquired = resolve; });
  const waiting = new Promise((resolve) => { release = resolve; });
  const lock = env.locks.request(CLOUD_SYNC_OFFER_LOCK, { mode: 'exclusive' }, async () => {
    acquired();
    await waiting;
  });
  await ready;
  const tab = page({ env, launchSync: true });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'following', 'the tab initially follows the lock holder');
  release();
  await lock;
  await tab.cloud.checkSync();
  await until(() => ['offer', 'clear'].includes(tab.cloud.model.sync.phase), 'the follower settles');
  assert.equal(tab.cloud.model.sync.phase, 'offer', 'a stale clear gate cannot stand in for a new check');
  assert.ok(env.transport.calls.includes('list'));
  await tab.cloud.turnOff();
});

test('an upload observes the offer lock without taking the election itself', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  await consented(env);
  const request = env.locks.request.bind(env.locks);
  const query = env.locks.query.bind(env.locks);
  let electionRequests = 0;
  let queries = 0;
  env.locks.request = (name, ...args) => {
    if (name === CLOUD_SYNC_OFFER_LOCK) electionRequests += 1;
    return request(name, ...args);
  };
  env.locks.query = async () => { queries += 1; return query(); };
  const tab = page({ env, launchSync: true });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'clear', 'the initial check finishes');
  const before = electionRequests;
  await tab.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
  assert.ok(queries > 0, 'the uploader queries the lock state');
  assert.equal(electionRequests, before, 'checking permission never competes in the offer election');
  assert.ok(env.transport.created.some((name) => parseCloudBackupName(name)), 'an unheld upload proceeds');
  await tab.cloud.turnOff();
});

test('Load refuses replacement if the independent cloud copy cannot be kept', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  let restored = false;
  const tab = page({ env, launchSync: { restore: async () => { restored = true; return { ok: true }; } } });
  const before = await tab.home.snapshot();
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the other device is offered');
  tab.protocol.keepBackup = async () => { throw new Error('Injected kept-copy failure.'); };
  const result = await tab.cloud.loadSync();
  assert.equal(result.ok, false);
  assert.equal(restored, false);
  assert.equal((await tab.home.snapshot()).backup.digest, before.backup.digest);
  assert.equal((await protocol.syncGate(context)).held, true);
  await tab.cloud.turnOff();
});

test('Load creates no kept copy when its durable history witness cannot be written', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  let restored = false;
  const tab = page({ env, launchSync: { restore: async () => { restored = true; return { ok: true }; } } });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the other device is offered');
  tab.protocol.records.writeKeptWitness = async () => { throw new Error('Injected history-witness failure.'); };
  const result = await tab.cloud.loadSync();
  assert.equal(result.ok, false);
  assert.equal(restored, false);
  assert.deepEqual(keptCreates(env.transport), []);
  assert.equal((await protocol.syncGate(context)).held, true);
  await tab.cloud.turnOff();
});

for (const change of ['remote vanished', 'signed out', 'local active list changed']) {
  test(`Load withdraws if ${change} while the safety copy is being kept`, async () => {
    const env = harness({ transport: windowsHost(fakeTransport()) });
    const { protocol } = await consented(env);
    const context = await syncContext(protocol);
    const remote = await device({ 1: 333 }).snapshot();
    const remoteId = env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
      stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
    }));
    let restored = false;
    const savedChanges = createSavedChanges();
    const tab = page({ env, savedChanges, launchSync: { restore: async () => { restored = true; return { ok: true }; } } });
    const before = await tab.home.snapshot();
    await tab.cloud.resume();
    await until(() => tab.cloud.model.sync.phase === 'offer', 'the other device is offered');
    const keep = tab.protocol.keepBackup.bind(tab.protocol);
    tab.protocol.keepBackup = async (args) => {
      const kept = await keep(args);
      if (change === 'remote vanished') env.transport.files.delete(remoteId);
      if (change === 'signed out') env.transport.host.state = 'not-connected';
      if (change === 'local active list changed') {
        tab.home.open('later');
        savedChanges.notify();
      }
      return kept;
    };
    const result = await tab.cloud.loadSync();
    assert.equal(result.ok, false);
    assert.equal(restored, false);
    const after = await tab.home.snapshot();
    assert.equal(after.personalDigest, before.personalDigest, 'the prior reading progress remains');
    assert.equal((await protocol.syncGate(context)).held, true);
    await tab.cloud.turnOff();
  });
}

test('a warned override releases only a failed check, and the next check re-arms the hold', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  env.transport.faults.list.push('unavailable');
  const { cloud } = page({ env, launchSync: true });
  await cloud.resume();
  await until(() => cloud.model.sync.phase === 'failed', 'the failed check is reported');
  assert.equal((await protocol.syncGate(context)).held, true);
  assert.deepEqual(await cloud.overrideSync(), { ok: true });
  assert.equal((await protocol.syncGate(context)).held, false);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  await cloud.recheckSync();
  assert.equal(cloud.model.sync.phase, 'offer');
  assert.equal((await protocol.syncGate(context)).held, true);
  assert.equal((await cloud.overrideSync()).ok, false, 'an outstanding choice cannot be bypassed');
  await cloud.turnOff();
});

test('a second tab follows the failed-check override rather than making its own choice', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  env.transport.faults.list.push('unavailable');
  const leader = page({ env, launchSync: true });
  const follower = page({ env, home: leader.home, launchSync: true });
  await leader.cloud.resume();
  await until(() => leader.cloud.model.sync.phase === 'failed', 'the leader reports the failed check');
  await follower.cloud.resume();
  await until(() => follower.cloud.model.sync.phase === 'following', 'the other tab follows');
  assert.equal((await follower.cloud.overrideSync()).ok, false);
  assert.equal((await protocol.syncGate(context)).held, true);
  assert.deepEqual(await leader.cloud.overrideSync(), { ok: true });
  await follower.cloud.checkSync();
  assert.equal(follower.cloud.model.sync.phase, 'clear');
  assert.equal((await protocol.syncGate(context)).held, false);
  await leader.cloud.turnOff();
  await follower.cloud.refresh();
});

test('a follower cannot upload while the leader cannot restore an uncertain hold', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const leader = page({ env, launchSync: true });
  const follower = page({ env, home: leader.home, launchSync: true });
  await leader.cloud.resume();
  await until(() => leader.cloud.model.sync.phase === 'offer', 'the leader offers the other device');
  await follower.cloud.resume();
  await until(() => follower.cloud.model.sync.phase === 'following', 'the second tab follows');

  const setGate = leader.protocol.setSyncGate.bind(leader.protocol);
  let releaseUncertain = false;
  leader.protocol.setSyncGate = async (next) => {
    if (releaseUncertain && next.held) throw new CloudBackupError('The hold cannot be written.', 'storage');
    const result = await setGate(next);
    if (!next.held) {
      releaseUncertain = true;
      throw new CloudBackupError('The hold cannot be verified.', 'storage');
    }
    return result;
  };
  assert.equal((await leader.cloud.keepSync()).ok, false);
  assert.equal((await protocol.syncGate(context)).held, false, 'the fault leaves the stored hold uncertain');
  await follower.cloud.checkSync();
  const before = env.transport.created.length;
  await follower.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
  assert.equal(env.transport.created.length, before, 'the elected failed check still prevents an upload');
  leader.protocol.setSyncGate = setGate;
  await leader.cloud.turnOff();
  await follower.cloud.refresh();
});

test('a failed initial hold prevents an already-running tab from uploading', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const other = page({ env, launchSync: true });
  await other.cloud.resume();
  await until(() => other.cloud.model.sync.phase === 'clear', 'the first tab finishes its earlier check');
  assert.equal((await protocol.syncGate(context)).held, false);

  const opening = page({ env, home: other.home, launchSync: true });
  const setGate = opening.protocol.setSyncGate.bind(opening.protocol);
  opening.protocol.setSyncGate = async (next) => {
    if (next.held) throw new CloudBackupError('The hold cannot be written.', 'storage');
    return setGate(next);
  };
  await opening.cloud.resume();
  await until(() => opening.cloud.model.sync.phase === 'failed', 'the new check reports its unconfirmed hold');
  assert.equal(opening.cloud.model.sync.code, 'hold-unconfirmed');
  const before = env.transport.created.length;
  await other.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
  assert.equal(env.transport.created.length, before, 'a failed hold must not let another tab upload');
  env.locks.closeHolder(CLOUD_SYNC_OFFER_LOCK);
  await other.run(CLOUD_BACKUP_CADENCE.recheckMs);
  assert.equal(env.transport.created.length, before, 'closing the failed tab must not release an older clear gate');
  const recovery = page({ env, home: other.home, launchSync: true });
  await recovery.cloud.resume();
  await until(() => recovery.cloud.model.sync.phase === 'clear', 'a new check resolves the abandoned marker');
  assert.equal(env.syncStorage.getItem(CLOUD_SYNC_PENDING_KEY), null);
  await other.run(CLOUD_BACKUP_CADENCE.recheckMs);
  assert.ok(env.transport.created.length > before, 'a successful new check resumes backups');
  await recovery.cloud.turnOff();
  opening.protocol.setSyncGate = setGate;
  await opening.cloud.refresh();
  await other.cloud.refresh();
});

test('a refused pending marker still leaves a durable IndexedDB hold before reporting failure', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const other = page({ env, launchSync: true });
  await other.cloud.resume();
  await until(() => other.cloud.model.sync.phase === 'clear', 'the earlier check completes');
  const write = env.syncStorage.setItem;
  env.syncStorage.setItem = () => { throw new Error('Storage refused the marker.'); };
  const opening = page({ env, home: other.home, launchSync: true });
  await opening.cloud.resume();
  await until(() => opening.cloud.model.sync.phase === 'failed', 'the marker failure is reported');
  assert.equal(opening.cloud.model.sync.code, 'hold-unconfirmed');
  assert.equal((await protocol.syncGate(context)).held, true, 'the independent durable hold was still attempted');
  env.locks.closeHolder(CLOUD_SYNC_OFFER_LOCK);
  const before = env.transport.created.length;
  await other.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
  assert.equal(env.transport.created.length, before, 'a failed marker write cannot enable an older tab');
  env.syncStorage.setItem = write;
  const recovery = page({ env, home: other.home, launchSync: true });
  await recovery.cloud.resume();
  await until(() => recovery.cloud.model.sync.phase === 'clear', 'the marker can be repaired');
  await recovery.cloud.turnOff();
  await opening.cloud.refresh();
  await other.cloud.refresh();
});

test('a removed pending marker cannot authorize an old Keep choice', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const remote = await device({ 1: 333 }).snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: remote.backup, device: 'Phone', createdAt: 123,
  }));
  const tab = page({ env, launchSync: true });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'offer', 'the other device is offered');
  env.syncStorage.removeItem(CLOUD_SYNC_PENDING_KEY);
  assert.equal((await tab.cloud.keepSync()).ok, false);
  assert.equal((await protocol.syncGate(context)).held, true);
  assert.equal((await protocol.syncState(ON))?.declinedDigest ?? null, null);
  await tab.cloud.turnOff();
});

test('Go back protects the current data before loading the exact prior kept copy', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const home = device();
  const prior = await home.snapshot();
  const uploaded = await protocol.upload(prior);
  const originalKept = await protocol.keepBackup({
    ...context, generation: uploaded.generation, personalDigest: prior.personalDigest, contentDigest: prior.backup.digest,
  });
  home.mark(999);
  const current = await home.snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({
    stream: OTHER, generation: 1, backup: current.backup, device: 'Phone', createdAt: 123,
  }));
  await protocol.rememberSync({ ...context, matchedDigest: current.personalDigest });
  const draft = { recovery: [], uncertain: false };
  const restore = new CompleteRestore({
    storage: home.storage, locks: env.locks, journal: createRestoreJournal(env.idb), events: null,
    clock: () => env.time.now, cryptoProvider: webcrypto, reload: () => {}, lockAnswerMs: 200,
  });
  await restore.start();
  await restore.inspect();
  const tab = page({
    env, home,
    launchSync: { restore: (text, options) => {
      assert.equal(typeof options.assertStillAuthorized, 'function');
      options.assertStillAuthorized();
      return restore.restore(text, { ...options, importDraft: draft, draftRecovery: draft.recovery.slice() });
    } },
  });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'clear', 'the current cloud progress is checked');
  assert.equal(tab.cloud.model.sync.kept.id, originalKept.id);
  const result = await tab.cloud.goBackSync();
  assert.equal(result.ok, true, result.error);
  assert.equal((await home.snapshot()).backup.digest, prior.backup.digest);
  const after = await protocol.syncState(ON);
  assert.equal(after.kept.contentDigest, current.backup.digest, 'the data being replaced is now the go-back copy');
  assert.ok(env.transport.files.has(after.kept.id));
  assert.ok(env.transport.files.has(originalKept.id), 'the target survives until its verified bytes are consumed');
  assert.equal((await protocol.syncGate(context)).held, true, 'uploads wait for the page to reload');
  await tab.cloud.turnOff();
});

test('Go back reports a vanished kept copy before uploading or replacing anything', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const home = device();
  const prior = await home.snapshot();
  const uploaded = await protocol.upload(prior);
  const kept = await protocol.keepBackup({
    ...context, generation: uploaded.generation, personalDigest: prior.personalDigest, contentDigest: prior.backup.digest,
  });
  home.mark(999);
  const current = await home.snapshot();
  let restored = false;
  const tab = page({ env, home, launchSync: { restore: async () => { restored = true; return { ok: true }; } } });
  await tab.cloud.resume();
  await until(() => tab.cloud.model.sync.phase === 'clear', 'the cloud check finishes');
  env.transport.files.delete(kept.id);
  const creates = env.transport.created.length;
  const result = await tab.cloud.goBackSync();
  assert.equal(result.ok, false);
  assert.equal(restored, false);
  assert.equal(env.transport.created.length, creates);
  assert.equal((await home.snapshot()).backup.digest, current.backup.digest);
  await tab.cloud.turnOff();
});

test('other devices see this one by its browser and the system it runs on', () => {
  const edge = { userAgentData: { brands: [{ brand: 'Not)A;Brand' }, { brand: 'Chromium' }, { brand: 'Microsoft Edge' }], platform: 'Windows' } };
  assert.equal(browserDeviceLabel(edge), 'Microsoft Edge on Windows');
  assert.equal(browserDeviceLabel({ userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Not_A Brand' }], platform: 'Android' } }), 'Chromium on Android');
  assert.equal(browserDeviceLabel({ userAgent: 'Mozilla/5.0 (Macintosh)' }), 'Recap Page', 'no client hints: the protocol\'s default');
  assert.equal(browserDeviceLabel(undefined), 'Recap Page');
  assert.equal(browserDeviceLabel(edge, 'device'), 'Recap Page on Android');
  assert.equal(browserDeviceLabel(undefined, 'device'), 'Recap Page on Android');
});

test('a transport supplies the iOS device name; absent device keeps existing labels byte for byte', async () => {
  for (const [scope, supplied, expected] of [
    ['device', 'Recap Page on iPhone', 'Recap Page on iPhone'],
    ['device', 'Recap Page on iPad', 'Recap Page on iPad'],
    ['device', undefined, 'Recap Page on Android'],
    ['profiles', undefined, browserDeviceLabel(globalThis.navigator, 'profiles')],
  ]) {
    const env = harness();
    windowsHost(env.transport);
    env.transport.scope = scope;
    if (supplied !== undefined) env.transport.device = supplied;
    const tab = page({ env, device: null });
    await tab.cloud.enter();
    await tab.cloud.turnOn();
    assert.equal((await tab.protocol.record()).device, expected);
    tab.cloud.beforeErase();
  }
});

test('the page carries an upload wait to the card and withdraws it after the next status', async () => {
  const env = harness();
  windowsHost(env.transport);
  const currentStatus = env.transport.status;
  let waiting = true;
  env.transport.status = async () => ({ ...await currentStatus(), provider: 'icloud', waitingForUpload: waiting });
  const tab = page({ env });
  assert.equal((await tab.cloud.enter()).waitingForUpload, true);
  assert.match(cloudCardStatus(tab.cloud.model), /iCloud has not finished uploading/);
  waiting = false;
  assert.equal((await tab.cloud.refresh()).waitingForUpload, undefined);
  assert.doesNotMatch(cloudCardStatus(tab.cloud.model), /iCloud has not finished uploading/);
});

test('the page reports earlier-connection copies without mistaking an unreadable ledger for none', async () => {
  const env = harness();
  windowsHost(env.transport);
  const tab = page({ env });
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  await tab.protocol.keepBackup(await uploadForKept(tab.protocol, tab.home, 1));
  assert.equal((await tab.cloud.refresh()).earlierKept, 0);

  env.transport.signedIn('connection-two');
  const reconnected = await tab.cloud.refresh();
  assert.equal(reconnected.earlierKept, 1);
  assert.equal(reconnected.keptProblem, false);
  assert.match(cloudCardStatus(reconnected), /One recorded kept copy from an earlier connection may remain/);

  await tab.protocol.records.writeKeptLedger(() => ({ version: 999 }));
  const unreadable = await tab.cloud.refresh();
  assert.equal(unreadable.earlierKept, null);
  assert.equal(unreadable.keptProblem, true);
  assert.match(cloudCardStatus(unreadable), /saved-copy record could not be checked/i);
});

test('a saved-copy read that fails outright leaves the counts unknown without claiming a record', async () => {
  const env = harness();
  windowsHost(env.transport);
  const tab = page({ env });
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  tab.protocol.records.readKeptLedger = async () => { throw new Error('The browser storage did not answer.'); };
  const failed = await tab.cloud.refresh();
  assert.equal(failed.earlierKept, null);
  assert.equal(failed.keptAttention, null);
  assert.equal(failed.keptProblem, false);
  assert.doesNotMatch(cloudCardStatus(failed), /saved-copy|kept cop/i);
});

test('the page reports current-connection residual copies that need attention', async () => {
  const env = harness();
  windowsHost(env.transport);
  const tab = page({ env });
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  const copies = [];
  for (let change = 1; change <= 3; change += 1) {
    copies.push(await tab.protocol.keepBackup(await uploadForKept(tab.protocol, tab.home, change)));
  }
  env.transport.files.delete(copies[0].id);
  await tab.protocol.keepBackup(await uploadForKept(tab.protocol, tab.home, 4));
  const model = await tab.cloud.refresh();
  assert.equal(model.keptAttention, 1);
  assert.match(cloudCardStatus(model), /saved or attempted cloud copy could not be confirmed or removed/i);
});

test('the page withdraws stale saved-copy counts while a connection changes', async () => {
  const env = harness();
  windowsHost(env.transport);
  const tab = page({ env });
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  await tab.protocol.keepBackup(await uploadForKept(tab.protocol, tab.home, 1));
  assert.equal((await tab.cloud.refresh()).earlierKept, 0);

  const count = tab.protocol.keptCopySummary.bind(tab.protocol);
  let releaseOld;
  let releaseNew;
  let startedOld = false;
  let startedNew = false;
  const oldGate = new Promise((resolve) => { releaseOld = resolve; });
  const newGate = new Promise((resolve) => { releaseNew = resolve; });
  tab.protocol.keptCopySummary = async ({ connection }) => {
    const result = await count({ connection });
    if (connection === 'connection-one') { startedOld = true; await oldGate; }
    if (connection === 'connection-two') { startedNew = true; await newGate; }
    return result;
  };
  env.transport.connect = async () => {
    env.transport.signedIn('connection-two');
    return env.transport.status();
  };
  const old = tab.cloud.refresh();
  let next;
  try {
    await until(() => startedOld, 'the first connection count is waiting');
    next = tab.cloud.connect();
    await until(() => startedNew, 'the next connection count is waiting');
    assert.equal(tab.cloud.model.earlierKept, null, 'the old count is withdrawn before the new count returns');
    releaseNew();
    assert.equal((await next).earlierKept, 1);
    releaseOld();
    await old;
    assert.equal(tab.cloud.model.earlierKept, 1, 'a late count cannot overwrite the new connection');
  } finally {
    releaseOld();
    releaseNew();
    await Promise.allSettled([old, next]);
  }
});

test('in a build without cloud backup the page shows nothing, asks once when the card opens, and never opens the record', async () => {
  const env = harness();
  windowsHost(env.transport).host.enabled = false;
  const { cloud } = page({ env });
  await cloud.resume();
  assert.equal(env.transport.host.statuses, 0, 'nothing at startup');
  assert.equal((await cloud.enter()).shown, false);
  assert.equal(env.transport.host.statuses, 1, 'one request when Backup & settings opens');
  cloud.beforeErase();
  assert.deepEqual(await cloud.afterErase(true), { ok: true, problems: [] });
  assert.deepEqual([env.transport.host.statuses, env.transport.host.disconnects], [1, 0], 'an erase asks nothing more');
  assert.deepEqual(env.transport.calls, []);
  assert.equal(env.idb.databases.size, 0, 'no database was made');

  const blind = page({ env, databases: async () => undefined });
  await blind.cloud.resume();
  assert.equal(env.transport.host.statuses, 1, 'a browser that cannot list its databases does not guess at startup');
  assert.equal((await blind.cloud.enter()).shown, false);
  assert.equal(env.idb.databases.size, 0, 'nor open one to look, with no host to back up to');
});

test('ordinary cloud discovery leaves kept-looking files as other files until sync controls request them', async () => {
  const env = harness();
  windowsHost(env.transport);
  const stream = 'a'.repeat(32);
  const { backup } = await device().snapshot();
  const name = `recap-page-kept-v1-${stream}-1-${'b'.repeat(32)}.json.gz`;
  env.transport.store(name, envelopeFile({ stream, generation: 1, backup }));
  env.transport.store('recap-page-kept-v1-invalid.json.gz', Buffer.from('not a backup'));
  env.transport.faults.read.push('unavailable');

  const model = await page({ env }).cloud.enter();
  assert.equal(model.discovery.state, 'ready', 'an unrelated unreadable file does not fail ordinary discovery');
  assert.deepEqual(model.discovery.result.devices, []);
  assert.equal(model.discovery.result.unrecognized, 2, 'both files remain visible as other files');
  assert.deepEqual(env.transport.calls, ['list'], 'ordinary discovery does not read unused retained files');
});

test('turning on agrees to the connection shown, backs up at once, and goes on at the next start without asking', async () => {
  const env = harness();
  windowsHost(env.transport);
  const heard = [];
  const savedChanges = { subscribe(listener) { heard.push(listener); return () => {}; } };
  const first = page({ env, savedChanges });
  const shown = await first.cloud.enter();
  assert.deepEqual([shown.shown, shown.host, shown.on, shown.agreed, shown.account], [true, 'connected', false, false, 'reader@example.test']);
  assert.deepEqual([shown.discovery.state, shown.discovery.result.devices], ['ready', []], 'what the account holds comes first');
  assert.deepEqual(env.transport.calls, ['list'], 'discovery creates nothing in the account');
  assert.equal(heard.length, 0, 'no saved change is listened for before backups start');

  env.transport.calls.length = 0;
  const on = await first.cloud.turnOn();
  assert.deepEqual([on.on, on.agreed], [true, true]);
  assert.equal(heard.length, 1, 'listened for from the first start');
  const record = await first.protocol.record();
  assert.deepEqual([record.consent.connection, record.consent.provider, record.device], [env.transport.connection, 'onedrive', 'Microsoft Edge on Windows']);
  await first.run(0);
  assert.deepEqual(env.transport.calls, ['list', 'create', 'read'], 'the first backup went at once');
  assert.equal(first.cloud.model.backup.phase, 'up-to-date');

  const statuses = env.transport.host.statuses;
  const next = page({ env, home: first.home });
  env.transport.calls.length = 0;
  assert.equal((await next.cloud.resume()).on, true, 'the record says this browser agreed');
  assert.equal(env.transport.host.statuses, statuses + 1);
  await next.run(CLOUD_BACKUP_CADENCE.quietMs);
  assert.deepEqual(env.transport.calls, [], 'compared, and already backed up');
  assert.equal(next.cloud.model.backup.phase, 'up-to-date');

  env.transport.host.enabled = false;
  const unanswered = await page({ env, home: first.home }).cloud.resume();
  assert.deepEqual([unanswered.shown, unanswered.host, unanswered.agreed, unanswered.on, unanswered.backup.phase],
    [true, 'not-answering', true, false, 'off'], 'a browser that agreed is told the host is not answering, and waits');

  first.home.mark(4);
  heard[0]('mrt.state.v2');
  assert.equal(first.cloud.model.backup.phase, 'pending', 'a saved change reaches the backups');
});

test('consent belongs to one connection: after another profile reconnects the host, nothing is uploaded and this browser is asked again', async () => {
  const env = harness();
  windowsHost(env.transport);
  const tab = page({ env });
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  await tab.run(0);
  const made = env.transport.created.length;
  env.transport.signedIn('connection-two');
  tab.home.mark(5);
  tab.cloud.notify();
  await tab.run(CLOUD_BACKUP_CADENCE.minIntervalMs);
  assert.equal(env.transport.created.length, made, 'nothing was created under a connection this browser did not agree to');
  const model = tab.cloud.model;
  assert.deepEqual([model.on, model.agreed, model.askedAgain, model.backup.phase], [false, true, true, 'off']);
  assert.equal(model.reason, null, 'another profile signing in needs no explaining');
  const looked = await tab.cloud.enter();
  assert.deepEqual([looked.discovery.state, looked.discovery.connection], ['ready', 'connection-two'], 'the newly connected account is shown first');
  // The person deleted the app folder instead: the host starts a new connection and says why, and the page
  // carries that to the card rather than claiming anyone signed in again (P02-T07 decision 2).
  env.transport.signedIn('connection-three');
  env.transport.host.reason = 'The Recap Page folder was deleted from OneDrive, so cloud backup asks again before it makes a new one.';
  const told = await tab.cloud.refresh();
  assert.deepEqual([told.askedAgain, told.reason], [true, env.transport.host.reason]);
});

// A host that does not answer, as while the app restarts, is not a host that said no. Backups this browser
// agreed to keep their schedule, or start, and their own backoff carries the outage, so they go on by
// themselves when it answers; only a definite answer stops them (stage 3 review, S3a-3).
test('a host that does not answer stops no backups: they go on by themselves when it answers again', async () => {
  const env = harness();
  windowsHost(env.transport);
  const tab = page({ env });
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  await tab.run(0);
  const made = env.transport.created.length;
  env.transport.host.silent = true;
  const during = await tab.cloud.refresh();
  assert.deepEqual([during.host, during.agreed], ['not-answering', true], 'as opening About or Backup & settings asks');
  tab.home.mark(11);
  tab.cloud.notify();
  await tab.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
  assert.equal(env.transport.created.length, made, 'nothing can be made while it does not answer');
  env.transport.host.silent = false;
  await tab.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
  assert.equal(env.transport.created.length, made + 1, 'made once it answers, with nothing asked of the page');
  assert.equal(tab.cloud.model.backup.phase, 'up-to-date');

  // Started while it does not answer: backups wait for it rather than never starting.
  env.transport.host.silent = true;
  const later = page({ env, home: tab.home });
  const started = await later.cloud.resume();
  assert.deepEqual([started.host, started.agreed], ['not-answering', true]);
  tab.home.mark(12);
  await later.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
  env.transport.host.silent = false;
  await later.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
  assert.equal(env.transport.created.length, made + 2);

  // A definite answer still stops them: the host was disconnected in another profile.
  await env.transport.disconnect();
  assert.equal((await later.cloud.refresh()).backup.phase, 'off');
  tab.home.mark(13);
  later.cloud.notify();
  await later.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
  assert.equal(env.transport.created.length, made + 2);
});

// Startup asks the host only for a browser whose record holds consent. One that turned backups off, deleted
// its backups or was erased keeps its record database, and asks nothing (stage 3 review, S3a-6).
test('startup asks the host only when this browser holds consent', async () => {
  const env = harness();
  windowsHost(env.transport);
  const tab = page({ env });
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  await tab.run(0);
  const asked = async () => {
    const before = env.transport.host.statuses;
    await page({ env, home: tab.home }).cloud.resume();
    return env.transport.host.statuses - before;
  };
  assert.equal(await asked(), 1, 'agreed: asked once');
  await tab.cloud.turnOff();
  assert.equal(await asked(), 0, 'turned off');
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  await tab.run(0);
  await tab.cloud.deleteOwn();
  assert.equal(await asked(), 0, 'its backups deleted');
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  await tab.cloud.beforeErase();
  tab.home.storage.clear();
  await tab.cloud.afterErase(true);
  assert.deepEqual([await asked(), env.idb.databases.has(CLOUD_BACKUP_DATABASE)], [0, true], 'erased, the database kept');
});

test('erase removes a pending cloud check only after the erase succeeds', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  await consented(env);
  env.syncStorage.setItem(CLOUD_SYNC_PENDING_KEY, 'a'.repeat(32));
  const tab = page({ env });
  await tab.cloud.resume();
  await tab.cloud.beforeErase();
  await tab.cloud.afterErase(false);
  assert.equal(env.syncStorage.getItem(CLOUD_SYNC_PENDING_KEY), 'a'.repeat(32), 'a refused erase preserves the hold');
  await tab.cloud.beforeErase();
  const outcome = await tab.cloud.afterErase(true);
  assert.equal(outcome.ok, true);
  assert.equal(env.syncStorage.getItem(CLOUD_SYNC_PENDING_KEY), null, 'a completed erase removes the local marker');
});

test('erase reports a pending cloud marker that storage refuses to remove', async () => {
  const env = harness({ transport: windowsHost(fakeTransport()) });
  await consented(env);
  env.syncStorage.setItem(CLOUD_SYNC_PENDING_KEY, 'a'.repeat(32));
  const tab = page({ env });
  await tab.cloud.resume();
  await tab.cloud.beforeErase();
  const remove = env.syncStorage.removeItem;
  env.syncStorage.removeItem = () => { throw new Error('Storage refused removal.'); };
  const outcome = await tab.cloud.afterErase(true);
  assert.equal(outcome.ok, false);
  assert.match(outcome.problems.join(' '), /cloud check marker/i);
  assert.equal(env.syncStorage.getItem(CLOUD_SYNC_PENDING_KEY), 'a'.repeat(32));
  env.syncStorage.removeItem = remove;
});

// The erase question promised to disconnect every profile, or this browser had cloud backup: a host that
// does not answer, or answers that this build has none, has not been disconnected, so the erase says so
// rather than reporting success (stage 3 review, S3a-1). The words are the owner's, approved 2026-10-28.
test('an erase the host does not answer says cloud backup may still be connected, rather than reporting success', async () => {
  for (const silence of ['silent', 'not enabled']) {
    const env = harness();
    windowsHost(env.transport);
    const tab = page({ env });
    await tab.cloud.enter();
    await tab.cloud.turnOn();
    await tab.run(0);
    assert.match(cloudEraseNote(tab.cloud.model), /disconnected too, for every browser profile/);
    await tab.cloud.beforeErase();
    if (silence === 'silent') env.transport.host.silent = true;
    else env.transport.host.enabled = false;
    tab.home.storage.clear();
    const outcome = await tab.cloud.afterErase(true);
    assert.deepEqual([outcome.ok, env.transport.host.disconnects], [false, 0], silence);
    assert.equal(cloudEraseOutcome(outcome), ' Cloud backup could not be fully turned off. The Recap Page app did not answer, so cloud backup '
      + 'may still be connected for every browser profile on this Windows account. Check Cloud backup in Backup & settings.', silence);
  }
  // Not answering already when the question was asked, so it named only this browser's settings: this
  // browser had cloud backup all the same, so a host that still does not answer is said.
  const env = harness();
  windowsHost(env.transport);
  const tab = page({ env });
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  await tab.run(0);
  env.transport.host.silent = true;
  await tab.cloud.refresh();
  assert.match(cloudEraseNote(tab.cloud.model), /^This browser's cloud backup settings are erased too\./);
  await tab.cloud.beforeErase();
  tab.home.storage.clear();
  const outcome = await tab.cloud.afterErase(true);
  assert.deepEqual([outcome.ok, outcome.problems.length], [false, 1]);
});

// The Android app's transport says its sign-in reaches this device alone, and the model carries that to
// the card and the erase's report, so neither names a Windows account there (#810, P03-T03).
test('a transport that reaches only this device turns the model and an unanswered erase to this device', async () => {
  const env = harness();
  windowsHost(env.transport);
  env.transport.scope = 'device';
  const tab = page({ env });
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  await tab.run(0);
  assert.equal(tab.cloud.model.scope, 'device');
  assert.match(cloudEraseNote(tab.cloud.model), /^Cloud backup is disconnected too, on this device\./);
  await tab.cloud.beforeErase();
  env.transport.host.silent = true;
  tab.home.storage.clear();
  const outcome = await tab.cloud.afterErase(true);
  assert.deepEqual(outcome.problems, [ERASE_HOST_SILENT_DEVICE]);

  const windows = harness();
  windowsHost(windows.transport);
  const other = page({ env: windows });
  await other.cloud.enter();
  assert.equal(other.cloud.model.scope, 'profiles', 'any other transport keeps the Windows reach');
});

// An erase sets this browser's consent aside in the shared record before its first write, rather than
// withdrawing it, and holds the worker lock until it has forgotten or restored the record. So no tab backs
// up the erased state, not even one where backups are turned on during the erase, and an erase that erased
// nothing puts the same consent back (stage 3 review, S3a-7; the lock, coordinator, 2026-10-28).
test('an erase holds every tab\'s backups until it has forgotten or restored the record', async () => {
  const env = harness();
  windowsHost(env.transport);
  const first = page({ env });
  await first.cloud.enter();
  await first.cloud.turnOn();
  await first.run(0);
  const made = env.transport.created.length;
  const agreed = await first.protocol.record();

  await first.cloud.beforeErase();
  const setAside = await first.protocol.record();
  assert.deepEqual([setAside.consent, setAside.suspended, setAside.validated], [null, agreed.consent, agreed.validated],
    'set aside rather than withdrawn');
  first.home.storage.clear();

  // Another tab during the erase restores nothing, and turning backups on there uploads nothing until the
  // erase has ended. Its clock is moved directly, because its backup waits on the erase's lock.
  const second = page({ env, home: first.home });
  const opened = await second.cloud.enter();
  assert.deepEqual([opened.agreed, (await second.protocol.record()).consent], [false, null]);
  await second.cloud.turnOn();
  await second.time.advance(CLOUD_BACKUP_CADENCE.maxWaitMs);
  assert.equal(env.transport.created.length, made, 'turned on during the erase: nothing is uploaded');
  assert.deepEqual([env.locks.held(CLOUD_BACKUP_LOCK), env.locks.waiting(CLOUD_BACKUP_LOCK)], [1, 1], 'its backup waits on the erase\'s lock');
  await first.cloud.afterErase(true);
  await second.cloud.idle();
  assert.deepEqual([env.transport.created.length, await second.protocol.record()], [made, null], 'the erase forgot this browser, so nothing is made');

  // An erase that erased nothing puts the same consent back, with what was verified.
  const again = harness();
  windowsHost(again.transport);
  const tab = page({ env: again });
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  await tab.run(0);
  const before = await tab.protocol.record();
  await tab.cloud.beforeErase();
  await tab.cloud.afterErase(false);
  assert.deepEqual(await tab.protocol.record(), before);
  assert.deepEqual([tab.cloud.model.on, again.locks.held(CLOUD_BACKUP_LOCK)], [true, 0]);
});

// A page that dies during an erase leaves consent set aside and releases its lock with it. Nothing puts the
// consent back by itself, because the erase may have stopped part way and backups of partly erased data
// replace the good ones; the card says so, and the person turns backups on again (stage 3 review, S3a-7).
// The words are the owner's, approved 2026-10-28.
test('a page that dies during an erase leaves backups stopped and says so, until the person turns them on', async () => {
  const env = harness();
  windowsHost(env.transport);
  const first = page({ env });
  await first.cloud.enter();
  await first.cloud.turnOn();
  await first.run(0);
  const made = env.transport.created.length;
  await first.protocol.suspendConsent();
  first.home.mark(21);

  const next = page({ env, home: first.home });
  const statuses = env.transport.host.statuses;
  await next.cloud.resume();
  await next.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
  assert.deepEqual([env.transport.host.statuses, env.transport.created.length], [statuses, made], 'startup asks nothing and uploads nothing');
  const shown = await next.cloud.enter();
  assert.deepEqual([shown.agreed, shown.on, shown.suspended], [false, false, true]);
  assert.equal(cloudCardStatus(shown), 'Connected to OneDrive as reader@example.test. Automatic backup stopped while this browser\'s data was '
    + 'being erased. If that erase did not finish, check your data before you turn automatic backup on again, because new backups replace older ones.');
  assert.equal(cloudCardWarns(shown), true);
  await next.cloud.turnOn();
  await next.run(0);
  assert.deepEqual([env.transport.created.length, (await next.protocol.record()).suspended], [made + 1, null], 'turned on by the person, it backs up');
});

// The erase goes ahead only once the shared record is confirmed to give no tab a number, because the lock ends
// with the page that holds it. A lock it cannot take, or consent it cannot set aside, leaves nothing erased.
// Before this, a second tab with consent backed up the cleared data, and in time its backups would prune the
// good ones (stage 4 review, S4c-1, the reviewer's sequence: setting aside, forgetting and withdrawing all
// fail). The test plays the page's part: it erases only when the erase is not refused.
test('an erase that cannot take the lock or set consent aside erases nothing, and no tab backs up the erased data', async () => {
  const { ERASE_NOT_STOPPED } = await import('../src/js/lib/cloudBackup.js');
  const env = harness();
  windowsHost(env.transport);
  const first = page({ env });
  await first.cloud.enter();
  await first.cloud.turnOn();
  await first.run(0);
  const second = page({ env, home: first.home });
  await second.cloud.resume();
  await second.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
  const made = env.transport.created.length;
  const agreed = await first.protocol.record();
  const erase = async (failing) => {
    const refused = await first.cloud.beforeErase();
    if (!refused) {
      first.home.storage.clear();
      failing?.();
      await first.cloud.afterErase(true);
    }
    return refused;
  };
  const afterwards = async () => {
    env.idb.faults.abort = 0;
    env.transport.host.refuse = null;
    assert.equal(env.locks.held(CLOUD_BACKUP_LOCK), 0, 'the erase let go of the lock');
    second.cloud.notify();
    await second.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
    return env.transport.created.length;
  };

  env.idb.faults.abort = 3;
  env.transport.host.refuse = 'The Recap Page app could not be reached.';
  const unwritten = await erase();
  assert.equal(await afterwards(), made, 'no tab backed up anything');
  assert.equal(unwritten, `${ERASE_NOT_STOPPED} This browser could not keep its cloud backup record.`);
  assert.deepEqual([await first.protocol.record(), first.cloud.model.on, first.cloud.model.backup.phase !== 'off'],
    [agreed, true, true], 'consent as it was, and this page\'s backups going on');

  const request = env.locks.request;
  env.locks.request = async () => { throw new DOMException('The lock request was aborted.', 'AbortError'); };
  const unlocked = await erase();
  env.locks.request = request;
  assert.equal(await afterwards(), made);
  assert.equal(unlocked, ERASE_NOT_STOPPED, 'without the lock, nothing is set aside or erased');
  assert.deepEqual([await first.protocol.record(), first.cloud.model.on, first.cloud.model.backup.phase !== 'off'], [agreed, true, true]);

  // When the recovery fails after consent was set aside, the record still gives no tab a number.
  const stuck = await erase(() => {
    env.idb.faults.abort = 2;
    env.transport.host.refuse = 'The Recap Page app could not be reached.';
  });
  assert.equal(stuck, null);
  assert.equal(await afterwards(), made, 'the erased state was never backed up');
  assert.deepEqual([(await first.protocol.record()).consent, second.cloud.model.suspended], [null, true]);
});

// Setting consent aside can commit and then fail its read-back, when the record is lost or storage fails for
// a moment. The erase is refused, and the consent it set aside goes back, so a refused erase leaves backups as
// it found them. When even that fails, the refusal says automatic backup is now off (#996, S5-1).
test('a refused erase whose read-back fails puts consent back, or says automatic backup is now off', async () => {
  const { ERASE_NOT_STOPPED } = await import('../src/js/lib/cloudBackup.js');
  for (const putBack of [true, false]) {
    const env = harness();
    windowsHost(env.transport);
    const tab = page({ env });
    await tab.cloud.enter();
    await tab.cloud.turnOn();
    await tab.run(0);
    const made = env.transport.created.length;
    const agreed = await tab.protocol.record();
    const { suspendConsent, resumeConsent } = tab.protocol;
    const lost = () => new CloudBackupError('This browser could not keep its cloud backup record.', 'storage');
    tab.protocol.suspendConsent = async function suspendThenLose(...args) {
      const { record } = this;
      this.record = async () => { this.record = record; throw lost(); };
      return suspendConsent.apply(this, args);
    };
    if (!putBack) tab.protocol.resumeConsent = async () => { throw lost(); };
    const refused = await tab.cloud.beforeErase();
    tab.protocol.suspendConsent = suspendConsent;
    tab.protocol.resumeConsent = resumeConsent;
    assert.equal(env.locks.held(CLOUD_BACKUP_LOCK), 0, 'the erase let go of the lock');
    if (putBack) {
      assert.equal(refused, `${ERASE_NOT_STOPPED} This browser could not keep its cloud backup record.`);
      assert.deepEqual(await tab.protocol.record(), agreed, 'the consent set aside went back');
      assert.deepEqual([tab.cloud.model.on, tab.cloud.model.backup.phase !== 'off'], [true, true], 'backups go on');
      tab.home.mark(31);
      tab.cloud.notify();
      await tab.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
      assert.equal(env.transport.created.length, made + 1, 'and back up the next change');
    } else {
      assert.equal(refused, `${ERASE_NOT_STOPPED} This browser could not keep its cloud backup record. `
        + 'Automatic backup is now off until you turn it on again.');
      assert.deepEqual([tab.cloud.model.on, tab.cloud.model.suspended], [false, true], 'the card shows it stopped');
    }
  }
});

// Consent an earlier erase left set aside, when its page died part way, stays set aside through a later erase
// that is refused before it sets anything aside itself: putting it back would back up the partly erased data
// over the good copies, which is what leaving it set aside prevents (stage 3 review, S3a-7; #996 stage 2 review).
test('a refused erase puts back only the consent it set aside, never one an interrupted erase left', async () => {
  const { ERASE_NOT_STOPPED } = await import('../src/js/lib/cloudBackup.js');
  const env = harness();
  windowsHost(env.transport);
  const first = page({ env });
  await first.cloud.enter();
  await first.cloud.turnOn();
  await first.run(0);
  await first.protocol.suspendConsent();
  first.home.mark(21);
  const made = env.transport.created.length;
  const left = await first.protocol.record();

  const next = page({ env, home: first.home });
  await next.cloud.resume();
  const { suspendConsent } = next.protocol;
  next.protocol.suspendConsent = async () => { throw new CloudBackupError('This browser could not keep its cloud backup record.', 'storage'); };
  const refused = await next.cloud.beforeErase();
  next.protocol.suspendConsent = suspendConsent;
  assert.equal(refused, `${ERASE_NOT_STOPPED} This browser could not keep its cloud backup record.`);
  assert.equal(env.locks.held(CLOUD_BACKUP_LOCK), 0, 'the erase let go of the lock');
  assert.deepEqual(await next.protocol.record(), left, 'the consent the interrupted erase set aside is still set aside');
  next.cloud.notify();
  await next.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
  assert.equal(env.transport.created.length, made, 'the partly erased data was not backed up');
  const shown = await next.cloud.enter();
  assert.deepEqual([shown.on, shown.suspended], [false, true], 'the card still says backups stopped during an erase');
});

// A record that fails its checks is said on the card, and turning on replaces it with a new stream, so its
// files are then another device's. A record the browser could not read at all is not called unreadable,
// because turning on may find it intact and go on with it (stage 3 review, S3b-7).
test('only a record that fails its checks is called unreadable, and turning on then starts a new stream', async () => {
  const env = harness();
  windowsHost(env.transport);
  const first = page({ env });
  await first.cloud.enter();
  await first.cloud.turnOn();
  await first.run(0);
  const held = await first.protocol.record();

  await first.protocol.records.close();
  env.idb.faults.open = 'error';
  const lost = await first.cloud.refresh();
  env.idb.faults.open = null;
  assert.deepEqual([lost.recordProblem, lost.recordUnreadable, lost.on], ['This browser could not keep its cloud backup record.', false, false]);
  assert.equal(cloudCardStatus(lost), 'Connected to OneDrive as reader@example.test.', 'it may be intact');

  await createCloudRecordStore(env.idb).write(() => ({ ...held, nextGeneration: 0 }));
  const shown = await first.cloud.refresh();
  assert.deepEqual([shown.recordUnreadable, shown.agreed, shown.on], [true, false, false]);
  assert.match(cloudCardStatus(shown), /could not read its cloud backup settings, so backups have stopped\./);
  assert.equal(cloudCardWarns(shown), true);

  const on = await first.cloud.turnOn();
  await first.run(0);
  assert.deepEqual([on.recordUnreadable, on.on], [false, true]);
  const { stream } = await first.protocol.record();
  assert.notEqual(stream, held.stream, 'a new stream');
  const found = await first.cloud.discover();
  assert.deepEqual(found.discovery.result.devices.map((entry) => [entry.stream, entry.own]), [[stream, true], [held.stream, false]],
    'the earlier backups are listed as another device\'s');
});

test('the page sends the chosen provider to the host and leaves an absent choice absent', async () => {
  const env = harness();
  windowsHost(env.transport);
  env.transport.signedIn(null);
  env.transport.host.state = 'not-connected';
  const calls = [];
  const connect = env.transport.connect;
  env.transport.connect = async (...args) => {
    calls.push(args);
    return connect(...args);
  };
  const tab = page({ env });
  await tab.cloud.enter();
  await tab.cloud.connect('googledrive');
  await tab.cloud.connect();
  assert.deepEqual(calls, [[{ provider: 'googledrive' }], []]);
});

test('signing in waits for the browser, then shows the account before asking; signing in again carries backups on', async () => {
  const env = harness();
  windowsHost(env.transport);
  env.transport.signedIn(null);
  env.transport.host.state = 'not-connected';
  const { backup } = await device().snapshot();
  env.transport.store(cloudBackupName(OTHER, 1), envelopeFile({ stream: OTHER, generation: 1, backup, device: 'Phone' }));
  const tab = page({ env });
  const before = await tab.cloud.enter();
  assert.deepEqual([before.host, before.discovery.state, env.transport.calls], ['not-connected', 'idle', []]);
  assert.equal((await tab.cloud.connect()).host, 'signing-in');
  await tab.run(CLOUD_SIGN_IN_POLL_MS * 3);
  assert.equal(tab.cloud.model.host, 'signing-in', 'still waiting for the browser');
  env.transport.signedIn('connection-two');
  await tab.run(CLOUD_SIGN_IN_POLL_MS);
  await until(() => tab.cloud.model.discovery.state === 'ready', 'discovery follows the sign-in');
  const after = tab.cloud.model;
  assert.deepEqual([after.host, after.on, after.discovery.result.devices.map((entry) => entry.current.device)], ['connected', false, ['Phone']]);
  const [copy] = after.discovery.result.devices;
  assert.equal(JSON.parse((await tab.cloud.fetchBackup(copy.current)).text).digest, backup.digest, 'read and checked again for the restore');
  env.transport.faults.read.push('corrupt');
  await assert.rejects(tab.cloud.fetchBackup(copy.current), { code: 'invalid' });

  await tab.cloud.turnOn();
  await tab.run(0);
  const made = env.transport.created.length;
  env.transport.host.state = 'needs-sign-in';
  env.transport.faults.list.push('needs-sign-in');
  tab.home.mark(7);
  tab.cloud.notify();
  await tab.run(CLOUD_BACKUP_CADENCE.minIntervalMs);
  assert.deepEqual([tab.cloud.model.host, tab.cloud.model.on, tab.cloud.model.backup.phase], ['needs-sign-in', true, 'needs-sign-in']);
  await tab.cloud.connect();
  env.transport.signedIn('connection-two');
  await tab.run(CLOUD_SIGN_IN_POLL_MS);
  assert.equal(env.transport.created.length, made + 1, 'the change waiting since went at once');
  assert.equal(tab.cloud.model.backup.phase, 'up-to-date');
});

// After a sign-in, a tab can hear of it twice: from another tab's broadcast, whose refresh shows the account
// and opens the card's list of what it holds, and from its own sign-in poll. Measured in Edge, three tabs open
// through a sign-in made five discoveries, each a list and up to 64 reads, because the poll discovered again
// whatever had started (stage 2 review, S1b, found while measuring the page's requests).
test('a sign-in finishing is discovered once, however many ways a tab hears of it', async () => {
  const env = harness();
  windowsHost(env.transport);
  env.transport.signedIn(null);
  env.transport.host.state = 'not-connected';
  const tab = page({ env });
  await tab.cloud.enter();
  await tab.cloud.connect();
  env.transport.signedIn('connection-two');
  await tab.cloud.refresh();
  const opened = tab.cloud.discover();
  await tab.run(CLOUD_SIGN_IN_POLL_MS);
  await opened;
  await until(() => tab.cloud.model.discovery.state === 'ready', 'what the account holds is shown');
  assert.equal(env.transport.calls.filter((call) => call === 'list').length, 1, 'one list for one sign-in');
});

test('deleting this device\'s backups stops them first and reads the account again; disconnecting deletes nothing', async () => {
  const env = harness();
  windowsHost(env.transport);
  const tab = page({ env });
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  await tab.run(0);
  tab.home.mark(3);
  tab.cloud.notify();
  await tab.run(CLOUD_BACKUP_CADENCE.minIntervalMs);
  const { stream } = await tab.protocol.record();
  assert.deepEqual(env.transport.generations(stream), [1, 2]);
  await tab.cloud.discover();
  assert.deepEqual(await tab.cloud.deleteOwn(), { deleted: 2, failed: [] });
  const model = tab.cloud.model;
  assert.deepEqual([model.on, model.agreed, model.hasStream, model.backup.phase], [false, false, true, 'off']);
  assert.deepEqual([model.discovery.state, model.discovery.result.devices], ['ready', []], 'what the account holds was read again');
  tab.home.mark(4);
  tab.cloud.notify();
  await tab.run(CLOUD_BACKUP_CADENCE.minIntervalMs);
  assert.deepEqual(env.transport.generations(stream), [], 'and nothing is backed up after');

  await tab.cloud.turnOn();
  await tab.run(0);
  const gone = await tab.cloud.disconnect();
  assert.deepEqual([gone.host, gone.on, gone.backup.phase, env.transport.host.disconnects], ['not-connected', false, 'off', 1]);
  assert.deepEqual(env.transport.generations(stream), [3], 'the files stay');
});

test('erase holds backups from before its first write, forgets this browser and disconnects the host; one that erased nothing lets them go on', async () => {
  const env = harness();
  windowsHost(env.transport);
  let deliver = () => {};
  const channel = { postMessage() {}, set onmessage(handler) { deliver = handler; } };
  const tab = page({ env, channel });
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  await tab.run(0);
  const made = env.transport.created.length;

  tab.cloud.beforeErase();
  assert.equal(tab.cloud.model.backup.phase, 'off');
  deliver();
  await tab.cloud.idle();
  assert.equal(tab.cloud.model.backup.phase, 'off', 'another tab\'s news restarts nothing during an erase');
  tab.home.storage.clear();
  assert.deepEqual(await tab.cloud.afterErase(true), { ok: true, problems: [] });
  assert.equal(await tab.protocol.record(), null, 'this browser forgot cloud backup');
  assert.equal(env.transport.host.disconnects, 1, 'and the host its sign-in, for every profile');
  await tab.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
  assert.equal(env.transport.created.length, made, 'the erased state was never backed up');
  assert.deepEqual([tab.cloud.model.host, tab.cloud.model.agreed], ['not-connected', false]);

  env.transport.signedIn('connection-three');
  tab.home.mark(8);
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  await tab.run(0);
  tab.cloud.beforeErase();
  await tab.cloud.afterErase(false);
  assert.deepEqual([tab.cloud.model.on, tab.cloud.model.backup.phase === 'off'], [true, false], 'nothing erased: backups go on');

  // The record cannot be forgotten nor consent withdrawn, and the host cannot be reached: both are said,
  // and nothing backs up the erased state over what was there before. Consent was set aside before the
  // erase's first write, so it stays set aside, and the card says backups stopped (stage 3 review, S3a-7).
  await tab.cloud.beforeErase();
  env.idb.faults.abort = 2;
  env.transport.host.refuse = 'The Recap Page app could not be reached.';
  const stuck = await tab.cloud.afterErase(true);
  assert.deepEqual([stuck.ok, stuck.problems.length], [false, 2]);
  assert.match(stuck.problems[1], /could not be reached/);
  assert.deepEqual([tab.cloud.model.on, tab.cloud.model.suspended, tab.cloud.model.backup.phase], [false, true, 'off']);
  const before = env.transport.created.length;
  tab.cloud.notify();
  await tab.run(CLOUD_BACKUP_CADENCE.maxWaitMs);
  assert.equal(env.transport.created.length, before);
});

test('turning cloud backup on or off in one tab reaches the others', async () => {
  const env = harness();
  windowsHost(env.transport);
  const ends = [];
  const channel = () => {
    const end = { onmessage: null, postMessage: () => { for (const other of ends) if (other !== end) other.onmessage?.(); } };
    ends.push(end);
    return end;
  };
  const a = page({ env, channel: channel() });
  const b = page({ env, channel: channel(), home: a.home });
  await a.cloud.enter();
  await b.cloud.enter();
  await a.cloud.turnOn();
  await b.cloud.idle();
  assert.deepEqual([b.cloud.model.on, b.cloud.model.backup.phase === 'off'], [true, false], 'the other tab backs up too');
  await a.cloud.turnOff();
  await b.cloud.idle();
  assert.deepEqual([b.cloud.model.on, b.cloud.model.backup.phase], [false, 'off']);
});

// The page passes a real BroadcastChannel, and Node has one too: any process that imports the page's
// modules, as several test files import main.js, waited on a listener that never closes. Measured here
// on 2026-10-28: a full run stopped producing output, and had to be stopped, once main.js held one open.
test('listening for other tabs keeps no process alive', async () => {
  const { execFile } = await import('node:child_process');
  const code = "import { createCloudBackup } from './src/js/lib/cloudBackup.js';\n"
    + "createCloudBackup({ transport: { status() {}, connect() {}, disconnect() {} }, protocol: {}, channel: new BroadcastChannel('probe') });\n";
  const started = Date.now();
  const outcome = await new Promise((resolve) => {
    execFile(process.execPath, ['--input-type=module', '-e', code], { cwd: new URL('..', import.meta.url), timeout: 20_000 },
      (error) => resolve(error ? (error.killed ? 'still running after 20 seconds' : error.message) : 'exited'));
  });
  assert.equal(outcome, 'exited', `after ${Date.now() - started} ms`);
});

test('two iCloud read-backs waiting for upload never prune confirmed backups or count as verified', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const home = device();
  for (const generation of [1, 2]) {
    home.mark(generation);
    await protocol.upload(await home.snapshot());
  }
  for (const generation of [3, 4]) {
    home.mark(generation);
    env.transport.calls.length = 0;
    env.transport.faults.read.push('unavailable');
    await assert.rejects(protocol.upload(await home.snapshot()), { code: 'unavailable' });
    assert.equal(env.transport.calls.includes('delete'), false, 'no retention delete after a pending read-back');
    assert.deepEqual((await protocol.record()).validated.map((entry) => entry.generation), [2, 1]);
    assert.deepEqual(env.transport.generations(stream), Array.from({ length: generation }, (_, at) => at + 1),
      'pending files stay in listings without becoming retained verified generations');
  }
  home.mark(5);
  await protocol.upload(await home.snapshot());
  assert.deepEqual((await protocol.record()).validated.map((entry) => entry.generation), [5, 2]);
  assert.deepEqual(env.transport.generations(stream), [2, 3, 4, 5], 'the prior confirmed backup is kept beside its confirmed replacement');
  home.mark(6);
  await protocol.upload(await home.snapshot());
  assert.deepEqual((await protocol.record()).validated.map((entry) => entry.generation), [6, 5]);
  assert.equal(env.transport.generations(stream).includes(2), false, 'only a later confirmed replacement allows that backup to be pruned');
});

test('sync state is a durable separate key and leaves the version 1 backup record unchanged', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const original = await protocol.record();
  const matchedDigest = 'a'.repeat(64);
  const declinedDigest = 'b'.repeat(64);
  assert.equal(await protocol.syncState(ON), null);

  await remember(protocol, { matchedDigest, declinedDigest });
  const later = await env.make().syncState(ON);
  assert.deepEqual(later, {
    version: 1, connection: ON.connection, stream, consentId: original.consent.id,
    matchedDigest, declinedDigest, kept: null, current: true,
  });
  assert.deepEqual(await protocol.record(), original, 'the existing record has no additional fields');
  const writes = env.idb.log.filter((entry) => entry.mode === 'readwrite');
  assert.ok(writes.every((entry) => entry.name === CLOUD_BACKUP_DATABASE && entry.durability === 'strict'));
});

test('sync state updates in different tabs do not clobber each other and a new consent resets the baseline', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const other = env.make();
  const matchedDigest = 'a'.repeat(64);
  const declinedDigest = 'b'.repeat(64);
  await Promise.all([
    remember(protocol, { matchedDigest }),
    remember(other, { declinedDigest }),
  ]);
  const first = await protocol.syncState(ON);
  assert.deepEqual([first.matchedDigest, first.declinedDigest, first.current], [matchedDigest, declinedDigest, true]);

  env.transport.connection = 'connection-two';
  await protocol.recordConsent({ ...CONSENT, connection: 'connection-two' });
  const switched = await protocol.syncState({ connection: 'connection-two' });
  assert.deepEqual([switched.matchedDigest, switched.declinedDigest, switched.current], [null, null, true]);
  await remember(protocol, { connection: 'connection-two', matchedDigest: 'c'.repeat(64) });
  assert.equal((await protocol.syncState({ connection: 'connection-two' })).matchedDigest, 'c'.repeat(64));

  await protocol.recordConsent({ ...CONSENT, connection: 'connection-two' });
  const reconsented = await protocol.syncState({ connection: 'connection-two' });
  assert.deepEqual([reconsented.matchedDigest, reconsented.declinedDigest, reconsented.current], [null, null, true]);
});

test('sync state refuses corrupt, aborted and lost writes without replacing the prior state', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const matchedDigest = 'a'.repeat(64);
  for (const fault of ['abort', 'drop']) {
    env.idb.faults[fault] = 1;
    await assert.rejects(remember(protocol, { matchedDigest }), { code: 'storage' }, fault);
    assert.equal((await protocol.records.readSync()).sync, null);
  }

  const corrupt = { version: 999, matchedDigest };
  await protocol.records.writeSync(() => corrupt);
  await assert.rejects(protocol.syncState(ON), { code: 'storage' });
  await assert.rejects(remember(protocol, { matchedDigest }), { code: 'storage' });
  assert.deepEqual((await protocol.records.readSync()).sync, corrupt, 'corruption is not overwritten as an empty marker');

  await protocol.records.close();
  env.idb.faults.open = 'error';
  await assert.rejects(protocol.syncState(ON), { code: 'storage' }, 'a failed read is not an absent marker');
});

test('sync state treats a present null or undefined as corruption, not an absent pin', async () => {
  for (const value of [null, undefined]) {
    const env = harness();
    const { protocol, stream } = await consented(env);
    const home = device();
    await protocol.upload(await home.snapshot());
    home.mark(2);
    await protocol.upload(await home.snapshot());
    env.idb.databases.get(CLOUD_BACKUP_DATABASE).get('stream').set('sync', value);

    await assert.rejects(protocol.syncState(ON), { code: 'storage' }, String(value));
    await assert.rejects(remember(protocol, { matchedDigest: 'a'.repeat(64) }), { code: 'storage' }, String(value));
    home.mark(3);
    await protocol.upload(await home.snapshot());
    assert.deepEqual(env.transport.generations(stream), [2, 3], 'ordinary pruning does not depend on sync state');
  }
});

test('sync state survives a cancelled erase and is forgotten atomically with a completed erase', async () => {
  const env = harness();
  windowsHost(env.transport);
  const tab = page({ env });
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  await tab.run(0);
  await remember(tab.protocol, { matchedDigest: 'a'.repeat(64), declinedDigest: 'b'.repeat(64) });
  const before = await tab.protocol.syncState(ON);
  const context = await syncContext(tab.protocol);
  await tab.protocol.rememberDecline({ ...context, remoteStream: OTHER, digest: 'c'.repeat(64), expected: null });

  await tab.cloud.beforeErase();
  await tab.cloud.afterErase(false);
  assert.deepEqual(await tab.protocol.syncState(ON), before, 'a cancelled erase keeps the marker');
  assert.deepEqual(await tab.protocol.syncDeclines(context), [{ stream: OTHER, digest: 'c'.repeat(64) }]);

  await tab.cloud.beforeErase();
  tab.home.storage.clear();
  assert.deepEqual(await tab.cloud.afterErase(true), { ok: true, problems: [] });
  assert.deepEqual(await tab.protocol.records.readSync(), { record: null, sync: null, syncPresent: false });
  assert.equal((await tab.protocol.records.readSyncDeclines()).present, false, 'a completed erase removes the choices');
});

for (const lostWrites of [1, 2]) {
  test(`sync state from a failed erase cannot become a later baseline (lost writes: ${lostWrites})`, async () => {
    const env = harness();
    windowsHost(env.transport);
    const tab = page({ env });
    await tab.cloud.enter();
    await tab.cloud.turnOn();
    await tab.run(0);
    await remember(tab.protocol, { matchedDigest: 'a'.repeat(64) });

    await tab.cloud.beforeErase();
    tab.home.storage.clear();
    env.idb.faults.drop = lostWrites;
    const outcome = await tab.cloud.afterErase(true);
    assert.equal(outcome.ok, false, 'a lost forget is reported');
    const stored = await tab.protocol.records.readSync();
    assert.notEqual(stored.record, null, 'the cloud record was not forgotten');
    assert.equal(stored.record.consent, null, 'a failed erase cannot resume automatic backups');
    assert.equal(stored.syncPresent, lostWrites === 2,
      'a successful withdrawal clears the marker; a lost withdrawal leaves it suspended');
    await tab.protocol.recordConsent(CONSENT);
    assert.equal(await tab.protocol.syncState(ON), null, 'renewed consent cannot adopt an incompletely erased marker');
  });
}

test('sync state left by an older erase is cleared before a fresh record is created', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const snapshot = await device().snapshot();
  await protocol.upload(snapshot);
  const kept = await protocol.keepBackup({
    ...context, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
  });
  await remember(protocol, { matchedDigest: snapshot.personalDigest });
  await legacyRecordWrite(env.idb, () => null);
  assert.equal((await protocol.records.readSync()).syncPresent, true, 'an older erase does not know the sync key');

  await protocol.recordConsent(CONSENT);
  assert.equal(await protocol.syncState(ON), null, 'the old local marker and kept reference are not resurrected');
  await remember(protocol, { matchedDigest: 'a'.repeat(64) });
  assert.equal((await protocol.syncState(ON)).kept, null);
  assert.ok(env.transport.files.has(kept.id), 'erase did not delete the cloud copy');
});

for (const oldLast of [false, true]) {
  test(`sync state never resurrects an erased reference when an older tab recreates the record (oldLast=${oldLast})`, async () => {
    const env = harness();
    const { protocol } = await consented(env);
    const context = await syncContext(protocol);
    const snapshot = await device().snapshot();
    await protocol.upload(snapshot);
    const kept = await protocol.keepBackup({
      ...context, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
    });
    await remember(protocol, { matchedDigest: snapshot.personalDigest });
    const before = await protocol.record();
    const oldRecreation = {
      ...before, stream: 'e'.repeat(32), nextGeneration: 1, validated: [],
      consent: { ...before.consent, id: 'd'.repeat(32) }, suspended: null,
    };
    const oldEraseAndRecreate = async () => {
      await legacyRecordWrite(env.idb, () => null);
      await legacyRecordWrite(env.idb, () => oldRecreation);
    };
    if (oldLast) {
      await protocol.recordConsent(CONSENT);
      await oldEraseAndRecreate();
    } else {
      await oldEraseAndRecreate();
      await protocol.recordConsent(CONSENT);
    }

    const current = await protocol.syncState(ON);
    assert.equal(current?.kept ?? null, null, `an erased reference stayed hidden when oldLast=${oldLast}`);
    const latest = await syncContext(protocol);
    await assert.rejects(protocol.fetchKeptBackup({ ...latest, kept }), { code: 'gone' });
    await remember(protocol, { matchedDigest: 'a'.repeat(64) });
    assert.equal((await protocol.syncState(ON)).kept, null, 'a new marker cannot adopt the old reference');
    assert.ok(env.transport.files.has(kept.id), 'forgetting the local reference does not delete the cloud file');
  });
}

test('sync state refuses a delayed result after the consent or stream changes', async () => {
  for (const change of ['consent', 'stream']) {
    const env = harness();
    const { protocol } = await consented(env);
    await remember(protocol, { matchedDigest: 'a'.repeat(64) });
    const before = await syncContext(protocol);
    const record = await protocol.record();
    if (change === 'consent') await protocol.recordConsent(CONSENT);
    else await protocol.restream({ stream: record.stream, consent: record.consent }, { allocate: false });

    await assert.rejects(protocol.rememberSync({ ...before, matchedDigest: 'b'.repeat(64) }), { code: 'needs-consent' }, change);
    const after = await protocol.syncState(ON);
    assert.deepEqual([after.current, after.matchedDigest], [true, null], 'the new context has no baseline');
    assert.equal((await protocol.records.readSync()).sync.matchedDigest, null, 'the stale result wrote nothing');
  }
});

test('kept ledger retains the newest three exact identities without touching other copies', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const home = device();
  const copies = [];
  let foreign;
  for (let change = 1; change <= 5; change += 1) {
    const request = await uploadForKept(protocol, home, change);
    copies.push(await protocol.keepBackup(request));
    if (change === 2) {
      foreign = env.transport.store(`recap-page-kept-v1-${OTHER}-1-${'a'.repeat(32)}.json.gz`,
        env.transport.files.get(copies[1].id).bytes);
      env.transport.store(cloudBackupName(OTHER, 1), new Uint8Array([7]));
    }
  }
  assert.deepEqual(copies.filter((copy) => env.transport.files.has(copy.id)).map((copy) => copy.id),
    copies.slice(-3).map((copy) => copy.id));
  assert.ok(env.transport.files.has(foreign), 'a kept-looking copy outside the ledger is not deleted');
  assert.deepEqual(env.transport.generations(stream), [4, 5], 'the ordinary retention rule is unchanged');
  assert.deepEqual(env.transport.generations(OTHER), [1], 'another installation is untouched');
  assert.equal((await protocol.syncState(ON)).kept.id, copies[4].id, 'the current go-back copy is never pruned');
});

for (const missing of ['witness', 'ledger', 'both']) {
  test(`missing kept-copy ${missing} stays uncertain and never deletes unrecorded copies`, async () => {
    const env = harness();
    const { protocol } = await consented(env);
    const home = device();
    const copies = [];
    for (let change = 1; change <= 3; change += 1) {
      copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
    }
    const foreign = env.transport.store(`recap-page-kept-v1-${OTHER}-1-${'a'.repeat(32)}.json.gz`,
      env.transport.files.get(copies[0].id).bytes);
    const store = env.idb.databases.get(CLOUD_BACKUP_DATABASE).get('stream');
    if (missing !== 'ledger') store.delete('kept-history');
    if (missing !== 'witness') store.delete('kept-ledger');
    assert.equal((await protocol.keptHistory(ON)).unknown, true);
    await protocol.keepBackup(await uploadForKept(protocol, home, 4));
    assert.ok(env.transport.files.has(foreign), 'a file outside the ledger is never pruned');
    if (missing !== 'witness') {
      for (const copy of copies) assert.ok(env.transport.files.has(copy.id), 'a lost ledger cannot authorize deletion');
    }
  });
}

for (const corrupt of ['witness', 'ledger', 'both']) {
  test(`corrupt kept-copy ${corrupt} cannot authorize cleanup or replacement`, async () => {
    const env = harness();
    const { protocol } = await consented(env);
    const home = device();
    const original = await protocol.keepBackup(await uploadForKept(protocol, home, 1));
    const store = env.idb.databases.get(CLOUD_BACKUP_DATABASE).get('stream');
    if (corrupt !== 'ledger') store.set('kept-history', { version: 99 });
    if (corrupt !== 'witness') store.set('kept-ledger', { version: 99 });
    const next = await uploadForKept(protocol, home, 2);
    await assert.rejects(protocol.keepBackup(next));
    assert.ok(env.transport.files.has(original.id));
    assert.equal(keptCreates(env.transport).length, 1, 'no second kept copy is created');
  });
}

test('kept ledger retries a created but unverified copy by its exact identity', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const request = await uploadForKept(protocol, device(), 1);
  env.transport.faults.read.push(null, 'timeout');
  await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
  const [id] = [...env.transport.files].find(([, file]) => file.name.startsWith('recap-page-kept-v1-'));
  const before = keptCreates(env.transport).length;
  const held = await protocol.keepBackup(request);
  assert.equal(held.id, id, 'verification resumes the original copy');
  assert.equal(keptCreates(env.transport).length, before, 'retry creates no second copy');
  const entries = (await protocol.records.readKeptLedger()).ledger.entries;
  assert.equal(entries.find((entry) => entry.id === id)?.verified, true);
});

test('kept ledger counts unverified copies only after a replacement is checked', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const home = device();
  const kept = [];
  for (let change = 1; change <= 3; change += 1) {
    kept.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
  }
  const fourth = await uploadForKept(protocol, home, 4);
  env.transport.faults.read.push(null, 'timeout');
  await assert.rejects(protocol.keepBackup(fourth), { code: 'timeout' });
  const pendingId = [...env.transport.files].find(([, file]) => file.name === keptCreates(env.transport).at(-1))[0];
  assert.ok(kept.every((copy) => env.transport.files.has(copy.id)), 'an unverified replacement deletes nothing');
  const fifth = await protocol.keepBackup(await uploadForKept(protocol, home, 5));
  assert.deepEqual(kept.filter((copy) => env.transport.files.has(copy.id)).map((copy) => copy.id), [kept[2].id]);
  assert.ok(env.transport.files.has(pendingId), 'the earlier pending copy counted among the newest three');
  assert.ok(env.transport.files.has(fifth.id));
  assert.equal((await protocol.records.readKeptLedger()).ledger.entries.find((entry) => entry.id === pendingId).verified, true);
});

test('kept ledger adopts a lost create reply only after unique matching bytes are read', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const request = await uploadForKept(protocol, device(), 1);
  env.transport.faults.create.push('lost');
  await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
  const [id] = [...env.transport.files].find(([, file]) => file.name.startsWith('recap-page-kept-v1-'));
  const held = await protocol.keepBackup(request);
  assert.equal(held.id, id, 'the uniquely matched original is adopted');
  assert.equal(keptCreates(env.transport).length, 1);
  assert.equal((await protocol.records.readKeptLedger()).ledger.entries[0].verified, true);
});

test('kept ledger preserves a reservation when a non-timeout connection failure loses the create reply', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const request = await uploadForKept(protocol, device(), 1);
  const create = env.transport.create;
  env.transport.create = async (...args) => {
    await create(...args);
    throw Object.assign(new Error('The connection closed before its reply.'), { code: 'unavailable' });
  };
  await assert.rejects(protocol.keepBackup(request), { code: 'unavailable' });
  const [id] = [...env.transport.files].find(([, file]) => file.name.startsWith('recap-page-kept-v1-'));
  env.transport.create = create;
  const kept = await protocol.keepBackup(request);
  assert.equal(kept.id, id, 'the completed create is found without another upload');
  assert.equal(keptCreates(env.transport).length, 1);
});

test('kept ledger reconciles a create whose identity write was lost', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const request = await uploadForKept(protocol, device(), 1);
  const create = env.transport.create;
  env.transport.create = async (...args) => {
    const made = await create(...args);
    env.idb.faults.drop = 1;
    return made;
  };
  await assert.rejects(protocol.keepBackup(request), { code: 'storage' });
  const [id] = [...env.transport.files].find(([, file]) => file.name.startsWith('recap-page-kept-v1-'));
  assert.equal((await protocol.records.readKeptLedger()).ledger.entries[0].id, null);
  env.transport.create = create;
  assert.equal((await protocol.keepBackup(request)).id, id);
  assert.equal(keptCreates(env.transport).length, 1);
});

test('kept ledger retains a temporarily missing unverified identity for later reconciliation', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const request = await uploadForKept(protocol, device(), 1);
  env.transport.faults.read.push(null, 'timeout');
  await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
  const [id, file] = [...env.transport.files].find(([, item]) => item.name.startsWith('recap-page-kept-v1-'));
  env.transport.files.delete(id);

  const replacement = await protocol.keepBackup(request);
  let ledger = (await protocol.records.readKeptLedger()).ledger;
  assert.ok(ledger.entries.some((entry) => entry.id === id && !entry.verified),
    'a missing unverified identity remains recorded');
  env.transport.files.set(id, file);
  await protocol.keepBackup(request);
  ledger = (await protocol.records.readKeptLedger()).ledger;
  assert.ok(ledger.entries.some((entry) => entry.id === id && entry.verified));
  assert.ok(env.transport.files.has(replacement.id));
});

test('kept ledger never adopts or deletes different bytes under a reserved name', async () => {
  const env = harness({ transport: fakeTransport({ duplicates: true }) });
  const { protocol } = await consented(env);
  const request = await uploadForKept(protocol, device(), 1);
  env.transport.faults.create.push('late');
  await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
  const name = keptCreates(env.transport)[0];
  const otherId = env.transport.store(name, new Uint8Array([1, 2, 3]));
  await assert.rejects(protocol.keepBackup(request), { code: 'verify' });
  assert.equal(keptCreates(env.transport).length, 1, 'a conflicting item is not treated as an absent create');
  assert.ok(env.transport.files.has(otherId), 'the conflicting item is never deleted');
  assert.equal((await protocol.records.readKeptLedger()).ledger.entries[0].id, null);
  const refused = await protocol.deleteOwnBackups(ON);
  assert.ok(refused.failed.some((entry) => entry.id === null && entry.code === 'changed' && entry.changedOutside));
  assert.ok(env.transport.files.has(otherId), 'explicit deletion also leaves different bytes alone');
  assert.equal((await protocol.records.readKeptLedger()).ledger.entries[0].changedOutside, true);
});

test('kept ledger waits before replacing an absent uncertain create and later reconciles it', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const request = await uploadForKept(protocol, device(), 1);
  env.transport.faults.create.push('late');
  await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
  await assert.rejects(protocol.keepBackup(request), { code: 'verify' }, 'the original may still arrive');
  assert.equal(keptCreates(env.transport).length, 1);
  env.time.now += CLOUD_TRANSPORT_DEADLINES_MS.create + 1;
  const replacement = await protocol.keepBackup(request);
  assert.equal(keptCreates(env.transport).length, 2, 'a later check may create a replacement');
  env.transport.land();
  const creates = keptCreates(env.transport).length;
  await protocol.keepBackup(request);
  assert.equal(keptCreates(env.transport).length, creates);
  const entries = (await protocol.records.readKeptLedger()).ledger.entries;
  assert.equal(entries.length, 2);
  assert.ok(entries.every((entry) => entry.id && entry.verified), 'the late original is identified too');
  assert.ok(env.transport.files.has(replacement.id));
});

test('kept ledger stops at three outstanding create reservations with a plain refusal', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const request = await uploadForKept(protocol, device(), 1);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    env.transport.faults.create.push('late');
    await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
    env.time.now += CLOUD_TRANSPORT_DEADLINES_MS.create + 1;
  }
  await assert.rejects(protocol.keepBackup(request), (error) => {
    assert.match(error.message, /could not be confirmed/i);
    assert.match(error.message, /nothing was loaded/i);
    assert.match(error.message, /data is unchanged/i);
    return true;
  });
  assert.equal(keptCreates(env.transport).length, 3);
  assert.equal((await protocol.records.readKeptLedger()).ledger.entries.filter((entry) => entry.id === null).length, 3);
});

test('three hour-old absent create reservations stay recorded without blocking a new kept copy', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const request = await uploadForKept(protocol, device(), 1);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    env.transport.faults.create.push('late');
    await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
    env.time.now += CLOUD_TRANSPORT_DEADLINES_MS.create + 1;
  }
  await assert.rejects(protocol.keepBackup(request), { code: 'verify' });
  env.time.now += 60 * 60 * 1000;
  const kept = await protocol.keepBackup(request);
  let ledger = (await protocol.records.readKeptLedger()).ledger;
  assert.equal(ledger.entries.filter((entry) => entry.id === null && entry.staleAbsent).length, 3);
  assert.equal((await protocol.keptCopySummary(ON)).attention, 3);
  assert.ok(env.transport.files.has(kept.id));

  env.transport.land();
  for (let retry = 0; retry < 4; retry += 1) await protocol.keepBackup(request);
  ledger = (await protocol.records.readKeptLedger()).ledger;
  assert.equal(ledger.entries.filter((entry) => entry.id === null).length, 0, 'late copies were identified or cleaned up');
  assert.ok(ledger.entries.every((entry) => entry.verified));
  assert.ok(ledger.entries.length <= 3);
  assert.ok(env.transport.files.has(kept.id), 'the current go-back copy is never pruned');
});

test('a failed exact-name check does not expire an old create reservation', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const request = await uploadForKept(protocol, device(), 1);
  env.transport.faults.create.push('late');
  await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
  env.time.now += 60 * 60 * 1000;
  env.transport.faults.list.push('timeout');
  await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
  assert.equal((await protocol.keptLedger()).entries[0].staleAbsent, false);
  assert.equal(keptCreates(env.transport).length, 1);
});

test('kept ledger reports a failed cleanup without blocking, then retries without another copy', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const home = device();
  const first = [];
  for (let change = 1; change <= 3; change += 1) {
    first.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
  }
  const fourth = await uploadForKept(protocol, home, 4);
  env.transport.faults.delete.push('timeout');
  const kept = await protocol.keepBackup(fourth);
  assert.ok(first.every((copy) => env.transport.files.has(copy.id)), 'failed cleanup leaves the earlier copies');
  assert.equal((await protocol.keptCopySummary(ON)).attention, 1, 'the unfinished deletion is reported');
  assert.ok((await protocol.keptLedger()).entries.some((entry) => entry.id === first[0].id && entry.deleting));
  const created = keptCreates(env.transport).length;
  assert.equal((await protocol.keepBackup(fourth)).id, kept.id);
  assert.equal(keptCreates(env.transport).length, created, 'the verified replacement is reused');
  assert.equal(env.transport.files.has(first[0].id), false);
  assert.ok(env.transport.files.has(kept.id));
});

test('kept ledger does not forget a missing cleanup candidate before it can be checked', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const home = device();
  const copies = [];
  for (let change = 1; change <= 3; change += 1) {
    copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
  }
  const file = env.transport.files.get(copies[0].id);
  env.transport.files.delete(copies[0].id);
  const request = await uploadForKept(protocol, home, 4);
  await protocol.keepBackup(request);
  assert.ok((await protocol.records.readKeptLedger()).ledger.entries.some((entry) => entry.id === copies[0].id && entry.changedOutside));
  assert.equal((await protocol.keptCopySummary(ON)).attention, 1);
  env.transport.files.set(copies[0].id, file);
  await protocol.keepBackup(request);
  assert.ok((await protocol.keptLedger()).entries.some((entry) => entry.id === copies[0].id && !entry.changedOutside));
  await protocol.keepBackup(request);
  assert.equal(env.transport.files.has(copies[0].id), false);
});

test('kept ledger explicit deletion includes retained identities and retries failures', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const request = await uploadForKept(protocol, device(), 1);
  const kept = await protocol.keepBackup(request);
  const foreign = env.transport.store(`recap-page-kept-v1-${OTHER}-1-${'b'.repeat(32)}.json.gz`,
    env.transport.files.get(kept.id).bytes);
  const remove = env.transport.delete;
  let once = true;
  env.transport.delete = async (id, options) => {
    if (id === kept.id && once) { once = false; throw Object.assign(new Error('Injected failure'), { code: 'timeout' }); }
    return remove(id, options);
  };
  const first = await protocol.deleteOwnBackups(ON);
  assert.deepEqual(first.failed.map((item) => item.id), [kept.id]);
  assert.ok(env.transport.files.has(kept.id));
  assert.ok((await protocol.records.readKeptLedger()).ledger.entries.some((entry) => entry.id === kept.id));
  const second = await protocol.deleteOwnBackups(ON);
  assert.deepEqual(second, { deleted: 1, failed: [] });
  assert.equal(env.transport.files.has(kept.id), false);
  assert.ok(env.transport.files.has(foreign), 'unowned kept-looking files are untouched');
});

for (const operation of ['retention', 'explicit deletion']) {
  for (const problem of ['changed', 'unreadable']) {
    test(`kept ledger preserves and reports ${problem} copies during ${operation}`, async () => {
      const env = harness();
      const { protocol } = await consented(env);
      const home = device();
      const copies = [];
      for (let change = 1; change <= (operation === 'retention' ? 3 : 1); change += 1) {
        copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
      }
      const victim = copies[0];
      const originalBytes = env.transport.files.get(victim.id).bytes;
      const otherBytes = new Uint8Array([1, 2, 3, 4]);
      if (problem === 'changed') env.transport.files.get(victim.id).bytes = otherBytes;
      const read = env.transport.read;
      if (problem === 'unreadable') {
        env.transport.read = async (id, options) => {
          if (id === victim.id) throw Object.assign(new Error('The saved copy is not readable.'), { code: 'timeout' });
          return read(id, options);
        };
      }
      const request = operation === 'retention' ? await uploadForKept(protocol, home, 4) : null;
      let outcome;
      if (operation === 'retention') {
        outcome = await protocol.keepBackup(request);
      } else {
        outcome = await protocol.deleteOwnBackups(ON);
      }
      assert.ok(env.transport.files.has(victim.id), 'the unchecked copy is not deleted');
      if (problem === 'changed') assert.deepEqual(env.transport.files.get(victim.id).bytes, otherBytes);
      const marked = (await protocol.records.readKeptLedger()).ledger.entries.find((entry) => entry.id === victim.id);
      assert.equal(marked?.changedOutside, true, 'the recorded copy is marked for attention');
      if (operation === 'retention') {
        assert.ok(env.transport.files.has(outcome.id), 'the verified replacement remains available');
        assert.equal((await protocol.keptCopySummary(ON)).attention, 1);
      } else {
        assert.ok(outcome.failed.some((entry) => entry.id === victim.id && entry.code === 'changed'));
      }
      env.transport.files.get(victim.id).bytes = originalBytes;
      env.transport.read = read;
      const verified = await protocol.checkKeptEntry(marked, CONSENT.connection);
      assert.equal(verified.changedOutside, false, 'successful rechecking clears the attention marker');
      if (operation === 'retention') await protocol.keepBackup(request);
      else assert.deepEqual(await protocol.deleteOwnBackups(ON), { deleted: 1, failed: [] });
      assert.equal(env.transport.files.has(victim.id), false, 'a verified retry can finish');
    });
  }
}

test('kept deletion stops if an unchecked copy cannot be marked in durable storage', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const home = device();
  const first = await protocol.keepBackup(await uploadForKept(protocol, home, 1));
  const second = await protocol.keepBackup(await uploadForKept(protocol, home, 2));
  env.transport.files.get(first.id).bytes = new Uint8Array([1, 2, 3]);
  const read = env.transport.read;
  env.transport.read = async (id, options) => {
    if (id === first.id) env.idb.faults.abort = 1;
    return read(id, options);
  };
  const result = await protocol.deleteOwnBackups(ON);
  assert.ok(env.transport.files.has(first.id), 'the unchecked copy is left alone');
  assert.ok(env.transport.files.has(second.id), 'no later kept copies are removed after the record failure');
  assert.deepEqual(result.failed.map(({ id, code }) => ({ id, code })), [
    { id: first.id, code: 'storage' },
    { id: second.id, code: 'storage' },
  ]);
});

test('delete intent must be durable before a kept copy is sent for deletion', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const kept = await protocol.keepBackup(await uploadForKept(protocol, device(), 1));
  const mark = protocol.markKeptDeleting.bind(protocol);
  protocol.markKeptDeleting = async (entry) => {
    env.idb.faults.abort = 1;
    return mark(entry);
  };
  const result = await protocol.deleteOwnBackups(ON);
  assert.ok(env.transport.files.has(kept.id), 'the provider was not asked to delete without a durable intent');
  assert.ok(result.failed.some((entry) => entry.id === kept.id && entry.code === 'storage'));
});

test('a failed retention intent is reported but cannot block the verified replacement', async () => {
  const env = harness();
  windowsHost(env.transport);
  const tab = page({ env });
  await tab.cloud.enter();
  await tab.cloud.turnOn();
  const { protocol, home } = tab;
  const copies = [];
  for (let change = 1; change <= 3; change += 1) {
    copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
  }
  const request = await uploadForKept(protocol, home, 4);
  const mark = protocol.markKeptDeleting.bind(protocol);
  protocol.markKeptDeleting = async (entry) => {
    if (entry.id === copies[0].id) env.idb.faults.abort = 1;
    return mark(entry);
  };
  const fourth = await protocol.keepBackup(request);
  assert.ok(env.transport.files.has(fourth.id));
  assert.ok(env.transport.files.has(copies[0].id), 'the provider was not asked to delete without an intent');
  assert.equal((await protocol.keptCopySummary(ON)).problem, true);
  assert.ok((await env.make().keptLedger()).entries.find((entry) => entry.id === copies[0].id).changedOutside,
    'a later page can see the recorded cleanup attention');
  assert.match(cloudCardStatus(await tab.cloud.refresh()), /saved-copy record could not be checked or updated/i);
  protocol.markKeptDeleting = mark;
  await protocol.keepBackup(request);
  await protocol.keepBackup(request);
  assert.equal(env.transport.files.has(copies[0].id), false);
  assert.equal((await protocol.keptCopySummary(ON)).problem, false);
  assert.doesNotMatch(cloudCardStatus(await tab.cloud.refresh()), /saved-copy record could not be checked or updated/i);
});

for (const state of ['verified', 'unverified']) {
  test(`an unchecked ${state} copy with an unwritable attention record cannot block a replacement`, async () => {
    const env = harness();
    const { protocol } = await consented(env);
    const request = await uploadForKept(protocol, device(), 1);
    if (state === 'unverified') {
      env.transport.faults.read.push(null, 'timeout');
      await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
    } else await protocol.keepBackup(request);
    const original = (await protocol.keptLedger()).entries[0];
    const read = env.transport.read;
    env.transport.read = async (id, options) => {
      if (id === original.id) {
        env.idb.faults.abort = 1;
        throw Object.assign(new Error('The saved copy is not readable.'), { code: 'timeout' });
      }
      return read(id, options);
    };
    const replacement = await protocol.keepBackup(request);
    assert.notEqual(replacement.id, original.id);
    assert.ok(env.transport.files.has(original.id));
    const summary = await protocol.keptCopySummary(ON);
    assert.ok(summary.problem || summary.attention > 0);
    assert.equal((await env.make().keptCopySummary(ON)).attention, 1, 'a later page can report the unchecked copy');
    env.transport.read = read;
    env.idb.faults.abort = 0;
    await protocol.keepBackup(request);
    assert.equal((await protocol.keptCopySummary(ON)).problem, false);
  });
}

test('delete intent reconciles a confirmed deletion after the ledger update fails', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const kept = await protocol.keepBackup(await uploadForKept(protocol, device(), 1));
  const remove = env.transport.delete;
  env.transport.delete = async (id, options) => {
    await remove(id, options);
    if (id === kept.id) env.idb.faults.abort = 1;
  };
  const result = await protocol.deleteOwnBackups(ON);
  assert.equal(env.transport.files.has(kept.id), false);
  assert.ok(result.failed.some((entry) => entry.id === kept.id && entry.code === 'storage' && entry.deleted === true));
  assert.ok((await protocol.records.readKeptLedger()).ledger.entries.some((entry) => entry.id === kept.id && entry.deleting),
    'the exact identity and deletion intent remain recorded');
  const retry = await protocol.deleteOwnBackups(ON);
  assert.deepEqual(retry, { deleted: 0, failed: [] }, 'the exact absent identity can be reconciled');
  assert.ok(!(await protocol.records.readKeptLedger()).ledger.entries.some((entry) => entry.id === kept.id));
});

test('delete intent never deletes changed bytes on retry and later finishes the recorded deletion', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const kept = await protocol.keepBackup(await uploadForKept(protocol, device(), 1));
  const original = env.transport.files.get(kept.id).bytes;
  env.transport.faults.delete.push(null, 'timeout');
  const first = await protocol.deleteOwnBackups(ON);
  assert.ok(first.failed.some((entry) => entry.id === kept.id && entry.code === 'timeout'));
  assert.ok((await protocol.keptLedger()).entries.some((entry) => entry.id === kept.id && entry.deleting));
  env.transport.files.get(kept.id).bytes = new Uint8Array([9, 8, 7]);
  const changed = await protocol.deleteOwnBackups(ON);
  assert.ok(changed.failed.some((entry) => entry.id === kept.id && entry.changedOutside));
  assert.ok(env.transport.files.has(kept.id), 'different bytes under the recorded identity are not deleted');
  env.transport.files.get(kept.id).bytes = original;
  assert.deepEqual(await protocol.deleteOwnBackups(ON), { deleted: 1, failed: [] });
  assert.equal(env.transport.files.has(kept.id), false);
});

test('delete intent left by failed retention cleanup cannot block a later kept copy', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const home = device();
  const copies = [];
  for (let change = 1; change <= 3; change += 1) {
    copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
  }
  const remove = env.transport.delete;
  env.transport.delete = async (id, options) => {
    await remove(id, options);
    if (id === copies[0].id) env.idb.faults.abort = 1;
  };
  const fourth = await protocol.keepBackup(await uploadForKept(protocol, home, 4));
  assert.equal(env.transport.files.has(copies[0].id), false);
  assert.ok((await protocol.records.readKeptLedger()).ledger.entries.some((entry) => entry.id === copies[0].id && entry.deleting));
  const fifth = await protocol.keepBackup(await uploadForKept(protocol, home, 5));
  assert.ok(env.transport.files.has(fourth.id) && env.transport.files.has(fifth.id));
  assert.ok(!(await protocol.records.readKeptLedger()).ledger.entries.some((entry) => entry.id === copies[0].id));
});

for (const problem of ['missing', 'changed', 'unreadable']) {
  test(`residual ${problem} attention does not block a kept copy or evict a newer verified copy`, async () => {
    const env = harness();
    const { protocol } = await consented(env);
    const home = device();
    const copies = [];
    for (let change = 1; change <= 3; change += 1) {
      copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
    }
    const victim = copies[0];
    if (problem === 'missing') env.transport.files.delete(victim.id);
    if (problem === 'changed') env.transport.files.get(victim.id).bytes = new Uint8Array([1, 2, 3]);
    const read = env.transport.read;
    if (problem === 'unreadable') {
      env.transport.read = async (id, options) => {
        if (id === victim.id) throw Object.assign(new Error('The saved copy is not readable.'), { code: 'timeout' });
        return read(id, options);
      };
    }
    const fourth = await protocol.keepBackup(await uploadForKept(protocol, home, 4));
    assert.ok(copies.slice(1).every((copy) => env.transport.files.has(copy.id)));
    assert.ok(env.transport.files.has(fourth.id));
    const ledger = await protocol.keptLedger();
    assert.ok(ledger.entries.some((entry) => entry.id === victim.id && entry.changedOutside));
    assert.equal((await protocol.keptCopySummary(ON)).attention, 1, 'the remaining attention is reported');
  });
}

test('recent residual attention cannot evict an older verified kept copy', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const home = device();
  const copies = [];
  for (let change = 1; change <= 3; change += 1) {
    copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
  }
  env.transport.files.delete(copies[2].id);
  const fourth = await protocol.keepBackup(await uploadForKept(protocol, home, 4));
  assert.ok(copies.slice(0, 2).every((copy) => env.transport.files.has(copy.id)),
    'both valid older copies still fit after the missing recent copy is excluded');
  assert.ok(env.transport.files.has(fourth.id));
  assert.ok((await protocol.keptLedger()).entries.some((entry) => entry.id === copies[2].id && entry.changedOutside));
});

test('a residual attention entry cannot block when clearing its marker fails', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const home = device();
  const copies = [];
  for (let change = 1; change <= 3; change += 1) {
    copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
  }
  const original = env.transport.files.get(copies[0].id);
  env.transport.files.delete(copies[0].id);
  await protocol.keepBackup(await uploadForKept(protocol, home, 4));
  assert.ok((await protocol.keptLedger()).entries.some((entry) => entry.id === copies[0].id && entry.changedOutside));
  env.transport.files.set(copies[0].id, original);
  const request = await uploadForKept(protocol, home, 5);
  const read = env.transport.read;
  env.transport.read = async (id, options) => {
    const bytes = await read(id, options);
    if (id === copies[0].id) env.idb.faults.abort = 1;
    return bytes;
  };
  const fifth = await protocol.keepBackup(request);
  assert.ok(env.transport.files.has(fifth.id));
  assert.ok(env.transport.files.has(copies[0].id), 'the unresolved entry is not deleted');
  assert.ok((await protocol.keptLedger()).entries.some((entry) => entry.id === copies[0].id && entry.changedOutside));
});

test('a stalled residual copy does not hold a new verified kept copy', async () => {
  const env = harness();
  const quickTimer = quickCleanupTimer;
  const { protocol } = await consented(env, { setTimer: quickTimer });
  const home = device();
  const copies = [];
  for (let change = 1; change <= 3; change += 1) {
    copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
  }
  const original = env.transport.files.get(copies[0].id);
  env.transport.files.delete(copies[0].id);
  await protocol.keepBackup(await uploadForKept(protocol, home, 4));
  env.transport.files.set(copies[0].id, original);
  const request = await uploadForKept(protocol, home, 5);
  const read = env.transport.read;
  let release;
  let started = false;
  let finished = false;
  const gate = new Promise((resolve) => { release = resolve; });
  env.transport.read = async (id, options) => {
    if (id === copies[0].id) { started = true; await gate; }
    return read(id, options);
  };
  const pending = protocol.keepBackup(request).then((value) => { finished = true; return value; });
  try {
    await until(() => started || finished, 'the cleanup check starts or the new copy is returned');
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    assert.equal(finished, true, 'an earlier unchecked copy must not hold the new verified copy');
    const kept = await pending;
    assert.ok(env.transport.files.has(kept.id));
    assert.ok(env.transport.files.has(copies[0].id), 'the stalled copy is not deleted');
  } finally {
    release();
    await pending;
  }
});

for (const stage of ['ledger read', 'deletion intent']) {
  test(`a stalled cleanup ${stage} cannot hold a verified replacement or start a late delete`, async () => {
    const env = harness();
    const quickTimer = (callback, ms) => setTimeout(callback, ms === 1000 ? 20 : ms);
    const { protocol } = await consented(env, { setTimer: quickTimer });
    const home = device();
    const copies = [];
    for (let change = 1; change <= 3; change += 1) {
      copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
    }
    const request = await uploadForKept(protocol, home, 4);
    let release;
    const blocked = new Promise((resolve) => { release = resolve; });
    let stall = false;
    let started = false;
    if (stage === 'ledger read') {
      const readLedger = protocol.keptLedger.bind(protocol);
      const remember = protocol.rememberKept.bind(protocol);
      protocol.rememberKept = async (...args) => {
        const kept = await remember(...args);
        stall = true;
        return kept;
      };
      protocol.keptLedger = async () => {
        if (stall) { started = true; await blocked; stall = false; }
        return readLedger();
      };
    } else {
      const mark = protocol.markKeptDeleting.bind(protocol);
      protocol.markKeptDeleting = async (...args) => {
        started = true;
        await blocked;
        return mark(...args);
      };
    }
    let finished = false;
    const pending = protocol.keepBackup(request).finally(() => { finished = true; });
    try {
      await until(() => started || finished, `the cleanup ${stage} starts or the new copy is returned`);
      await new Promise((resolve) => { setTimeout(resolve, 100); });
      assert.equal(finished, true, 'a stalled cleanup must not hold the new verified copy');
      assert.ok(env.transport.files.has(copies[0].id), 'the earlier copy has not been deleted');
    } finally {
      release();
      await pending;
    }
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    assert.ok(env.transport.files.has(copies[0].id), 'abandoned cleanup cannot start a late delete');
  });
}

test('a stalled attention-record retry cannot hold a verified replacement or write later', async () => {
  const env = harness();
  const quickTimer = (callback, ms) => setTimeout(callback, ms === 1000 ? 20 : ms);
  const { protocol } = await consented(env, { setTimer: quickTimer });
  const home = device();
  const copies = [];
  for (let change = 1; change <= 3; change += 1) {
    copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
  }
  const request = await uploadForKept(protocol, home, 4);
  const mark = protocol.markKeptDeleting.bind(protocol);
  protocol.markKeptDeleting = async (entry) => {
    if (entry.id === copies[0].id) env.idb.faults.abort = 1;
    return mark(entry);
  };
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let inRetry = false;
  let started = false;
  const retry = protocol.noteKeptProblem.bind(protocol);
  const readLedger = protocol.keptLedger.bind(protocol);
  protocol.noteKeptProblem = async (...args) => {
    inRetry = true;
    return retry(...args);
  };
  protocol.keptLedger = async () => {
    if (inRetry && !started) { started = true; await blocked; }
    return readLedger();
  };
  let finished = false;
  const pending = protocol.keepBackup(request).finally(() => { finished = true; });
  try {
    await until(() => started || finished, 'the attention retry starts or the new copy is returned');
    await new Promise((resolve) => { setTimeout(resolve, 100); });
    assert.equal(finished, true, 'the optional attention retry must not hold the verified replacement');
    assert.equal((await protocol.keptCopySummary(ON)).problem, true);
  } finally {
    release();
    await pending;
  }
  await new Promise((resolve) => { setTimeout(resolve, 20); });
  const entry = (await readLedger()).entries.find((candidate) => candidate.id === copies[0].id);
  assert.equal(entry.changedOutside, false, 'an abandoned retry does not begin a late attention write');
  assert.ok(env.transport.files.has(copies[0].id));
});

test('a stalled marked deletion cannot hold a new copy or delete after its check was abandoned', async () => {
  const env = harness();
  const quickTimer = quickCleanupTimer;
  const { protocol } = await consented(env, { setTimer: quickTimer });
  const home = device();
  const copies = [];
  for (let change = 1; change <= 3; change += 1) {
    copies.push(await protocol.keepBackup(await uploadForKept(protocol, home, change)));
  }
  const fourth = await uploadForKept(protocol, home, 4);
  env.transport.faults.delete.push('timeout');
  await protocol.keepBackup(fourth);
  assert.ok((await protocol.keptLedger()).entries.some((entry) => entry.id === copies[0].id && entry.deleting));
  const request = await uploadForKept(protocol, home, 5);
  const read = env.transport.read;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  env.transport.read = async (id, options) => {
    if (id === copies[0].id) await gate;
    return read(id, options);
  };
  let pending;
  let deadline;
  try {
    pending = protocol.keepBackup(request);
    const result = await Promise.race([
      pending,
      new Promise((resolve, reject) => { deadline = setTimeout(() => reject(new Error('A marked deletion blocked the new copy.')), 500); }),
    ]);
    assert.ok(env.transport.files.has(result.id));
    release();
    await settle();
    await settle();
    assert.ok(env.transport.files.has(copies[0].id), 'a late read cannot start a deletion after cleanup returned');
    assert.ok((await protocol.keptLedger()).entries.some((entry) => entry.id === copies[0].id && entry.deleting));
  } finally {
    clearTimeout(deadline);
    release();
    if (pending) await pending;
  }
});

test('a stale create whose read stalls remains reported and is reconciled on a later pass', async () => {
  const env = harness();
  const quickTimer = quickCleanupTimer;
  const { protocol } = await consented(env, { setTimer: quickTimer });
  const request = await uploadForKept(protocol, device(), 1);
  env.transport.faults.create.push('late');
  await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
  env.time.now += 60 * 60 * 1000;
  const kept = await protocol.keepBackup(request);
  env.transport.land();
  const old = [...env.transport.files].find(([, file]) => file.name === keptCreates(env.transport)[0])[0];
  const read = env.transport.read;
  const digest = protocol.digest.bind(protocol);
  let release;
  let observedLateDigest;
  let lateReadReturned = false;
  const lateDigest = new Promise((resolve) => { observedLateDigest = resolve; });
  const gate = new Promise((resolve) => { release = resolve; });
  env.transport.read = async (id, options) => {
    if (id !== old) return read(id, options);
    await gate;
    const bytes = await read(id, options);
    lateReadReturned = true;
    return bytes;
  };
  protocol.digest = async (bytes) => {
    if (lateReadReturned) observedLateDigest();
    return digest(bytes);
  };
  let deadline;
  let pending;
  try {
    pending = protocol.keepBackup(request);
    const result = await Promise.race([
      pending,
      new Promise((resolve, reject) => { deadline = setTimeout(() => reject(new Error('A stale create blocked the new copy.')), 500); }),
    ]);
    assert.equal(result.id, kept.id);
    release();
    const continued = await Promise.race([
      lateDigest.then(() => true),
      new Promise((resolve) => { setTimeout(() => resolve(false), 200); }),
    ]);
    assert.equal(continued, false, 'a late read cannot continue validation after cleanup returned');
    assert.ok((await protocol.keptLedger()).entries.some((entry) => entry.id === null && entry.staleAbsent));
  } finally {
    clearTimeout(deadline);
    release();
    if (pending) await pending;
  }
  env.transport.read = read;
  protocol.digest = digest;
  await protocol.keepBackup(request);
  assert.ok((await protocol.keptLedger()).entries.some((entry) => entry.id === old && entry.verified));
});

test('kept ledger reports an uncertain create on deletion and deletes it if it later arrives', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const request = await uploadForKept(protocol, device(), 1);
  env.transport.faults.create.push('late');
  await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
  const pending = await protocol.deleteOwnBackups(ON);
  assert.equal(pending.failed.length, 0, 'an absent reservation is not an undeleted backup');
  assert.equal(pending.attention, 1, 'a late create is still reported for attention');
  env.transport.land();
  const done = await protocol.deleteOwnBackups(ON);
  assert.deepEqual(done, { deleted: 1, failed: [] });
  assert.equal(env.transport.files.size, 0);
});

test('kept ledger reconciles an absent known identity without claiming another deletion', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const request = await uploadForKept(protocol, device(), 1);
  env.transport.faults.read.push(null, 'timeout');
  await assert.rejects(protocol.keepBackup(request), { code: 'timeout' });
  const [id] = [...env.transport.files].find(([, item]) => item.name.startsWith('recap-page-kept-v1-'));
  env.transport.files.delete(id);
  const result = await protocol.deleteOwnBackups(ON);
  assert.deepEqual(result, { deleted: 1, failed: [] }, 'only the regular generation was deleted');
  assert.ok(!(await protocol.records.readKeptLedger()).ledger.entries.some((entry) => entry.id === id));
  assert.deepEqual(await protocol.deleteOwnBackups(ON), { deleted: 0, failed: [] });
  assert.equal(env.transport.files.has(id), false);
});

for (const oldLast of [false, true]) {
  test(`kept ledger is not adopted after an older tab erases and recreates its record (oldLast=${oldLast})`, async () => {
    const env = harness();
    const { protocol } = await consented(env);
    const kept = await protocol.keepBackup(await uploadForKept(protocol, device(), 1));
    const before = await protocol.record();
    const replacement = {
      ...before, stream: 'e'.repeat(32), nextGeneration: 1, validated: [],
      consent: { ...before.consent, id: 'd'.repeat(32) }, suspended: null,
    };
    const oldEraseAndRecreate = async () => {
      await legacyRecordWrite(env.idb, () => null);
      await legacyRecordWrite(env.idb, () => replacement);
    };
    if (oldLast) {
      await protocol.recordConsent(CONSENT);
      await oldEraseAndRecreate();
    } else {
      await oldEraseAndRecreate();
      await protocol.recordConsent(CONSENT);
    }
    assert.equal(await protocol.keptLedger(), null);
    assert.deepEqual(await protocol.deleteOwnBackups(ON), { deleted: 0, failed: [] });
    assert.ok(env.transport.files.has(kept.id), 'the orphaned ledger cannot delete an earlier copy');
  });
}

test('kept ledger leaves earlier connections alone even for the same identity and bytes', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const first = await protocol.keepBackup(await uploadForKept(protocol, device(), 1));
  const firstFile = env.transport.files.get(first.id);
  env.transport.connection = 'connection-two';
  await protocol.recordConsent({ ...CONSENT, connection: 'connection-two' });
  const copy = await protocol.keepBackup(await uploadForKept(protocol, device(), 2));
  assert.ok(env.transport.files.has(first.id));
  assert.deepEqual(env.transport.files.get(first.id).bytes, firstFile.bytes, 'the old file has the same bytes and name');
  const result = await protocol.deleteOwnBackups({ connection: 'connection-two' });
  assert.equal(result.failed.length, 0);
  assert.equal(env.transport.files.has(copy.id), false);
  assert.ok(env.transport.files.has(first.id), 'the old-connection identity is never deleted in the new connection');
  assert.equal(result.earlier, 1, 'the card can report the earlier connection');
});

test('kept ledger does not offer a previous connection reference after reconnect', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const previous = await protocol.keepBackup(await uploadForKept(protocol, device(), 1));
  env.transport.connection = 'connection-two';
  await protocol.recordConsent({ ...CONSENT, connection: 'connection-two' });
  const current = await syncContext(protocol, 'connection-two');
  assert.equal((await protocol.syncState({ connection: 'connection-two' })).kept, null);
  await assert.rejects(protocol.fetchKeptBackup({ ...current, kept: previous }), { code: 'gone' });
  assert.ok(env.transport.files.has(previous.id));
  assert.equal(await protocol.earlierKeptCopies({ connection: 'connection-two' }), 1);
});

test('sync pin keeps the independent copy through later uploads and a failed replacement', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const { consentId } = await syncContext(protocol);
  const home = device();
  const first = await home.snapshot();
  const made = await protocol.upload(first);
  const pin = { ...ON, stream, generation: made.generation, personalDigest: first.personalDigest, contentDigest: first.backup.digest };
  const kept = await protocol.keepBackup({ ...pin, consentId });

  for (let generation = 2; generation <= 6; generation += 1) {
    home.mark(generation);
    await protocol.upload(await home.snapshot());
  }
  assert.deepEqual(env.transport.generations(stream), [5, 6], 'ordinary pruning keeps the newest two generations');
  assert.ok(env.transport.files.has(kept.id), 'the independent recovery copy survives');
  assert.deepEqual((await protocol.syncState(ON)).kept, kept);

  home.mark(7);
  env.transport.faults.read.push('timeout');
  const deletedBefore = env.transport.calls.filter((call) => call === 'delete').length;
  await assert.rejects(protocol.upload(await home.snapshot()), { code: 'timeout' });
  assert.equal(env.transport.calls.filter((call) => call === 'delete').length, deletedBefore,
    'an unverified replacement deletes nothing');
  assert.ok(env.transport.files.has(kept.id), 'the independent recovery copy is still present');
});

test('sync pin is replaced only after the new verified copy and the pin itself are kept', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const { consentId } = await syncContext(protocol);
  const home = device();
  const first = await home.snapshot();
  await protocol.upload(first);
  const pin1 = { ...ON, stream, generation: 1, personalDigest: first.personalDigest, contentDigest: first.backup.digest };
  const kept1 = await protocol.keepBackup({ ...pin1, consentId });

  home.mark(2);
  const second = await home.snapshot();
  await protocol.upload(second);
  const pin2 = { ...ON, stream, generation: 2, personalDigest: second.personalDigest, contentDigest: second.backup.digest };
  loseNextSyncWrite(env.idb, protocol);
  await assert.rejects(protocol.keepBackup({ ...pin2, consentId }), { code: 'storage' });
  assert.deepEqual((await protocol.syncState(ON)).kept, kept1, 'a lost pin write keeps the old reference');

  const kept2 = await protocol.keepBackup({ ...pin2, consentId });
  assert.deepEqual((await protocol.syncState(ON)).kept, kept2);
  for (let generation = 3; generation <= 5; generation += 1) {
    home.mark(generation);
    await protocol.upload(await home.snapshot());
  }
  assert.deepEqual(env.transport.generations(stream), [4, 5], 'only the newest two ordinary backups remain');
  assert.ok(env.transport.files.has(kept1.id), 'the earlier independent recovery copy is not deleted automatically');
  assert.ok(env.transport.files.has(kept2.id), 'the replacement recovery copy is also retained');
});

test('sync pin refuses a missing, changed, duplicated, unverified or unlocked backup', async () => {
  for (const fault of ['missing', 'changed', 'duplicated', 'unverified', 'mismatched-content', 'unlocked']) {
    const env = harness({ transport: fakeTransport({ duplicates: true }) });
    const { protocol, stream } = await consented(env);
    const { consentId } = await syncContext(protocol);
    const snapshot = await device().snapshot();
    const digest = fault === 'mismatched-content' ? 'f'.repeat(64) : snapshot.personalDigest;
    const made = await protocol.upload({ ...snapshot, personalDigest: digest });
    const pin = { ...ON, stream, generation: made.generation, personalDigest: digest, contentDigest: snapshot.backup.digest };
    const [id, file] = [...env.transport.files.entries()][0];
    if (fault === 'missing') env.transport.files.delete(id);
    if (fault === 'changed') env.transport.files.set(id, { ...file, bytes: new Uint8Array([0]) });
    if (fault === 'duplicated') env.transport.store(file.name, file.bytes);
    if (fault === 'unverified') pin.personalDigest = 'f'.repeat(64);
    const candidate = fault === 'unlocked' ? env.make({ locks: null }) : protocol;
    await assert.rejects(candidate.keepBackup({ ...pin, consentId }), {
      code: fault === 'missing' ? 'gone' : fault === 'unlocked' ? 'unsupported' : 'invalid',
    }, fault);
    assert.equal((await protocol.records.readSync()).sync, null, 'a refused pin changes no state');
  }
});

test('sync pin and pruning use the same lock, so a copy pruned first cannot then be pinned', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const { consentId } = await syncContext(protocol);
  const home = device();
  const first = await home.snapshot();
  await protocol.upload(first);
  home.mark(2);
  await protocol.upload(await home.snapshot());
  home.mark(3);
  const third = await home.snapshot();
  let releaseRead;
  env.transport.faults.read.push(() => new Promise((resolve) => { releaseRead = resolve; }));
  const uploading = env.locks.request(CLOUD_BACKUP_LOCK, { mode: 'exclusive' }, () => protocol.upload(third));
  await until(() => releaseRead, 'the replacement read-back is pending');
  let pin;
  try {
    pin = protocol.keepBackup({
      ...ON, stream, consentId, generation: 1, personalDigest: first.personalDigest, contentDigest: first.backup.digest,
    });
    await until(() => env.locks.waiting(CLOUD_BACKUP_LOCK) === 1, 'the pin waits for pruning');
  } finally {
    releaseRead();
    await uploading;
  }
  await assert.rejects(pin, { code: 'gone' });
  assert.equal((await protocol.records.readSync()).sync, null);
});

test('sync state corruption does not prevent independent ordinary pruning', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const home = device();
  for (let generation = 1; generation <= 2; generation += 1) {
    home.mark(generation);
    await protocol.upload(await home.snapshot());
  }
  await protocol.records.writeSync(() => ({ version: 999 }));
  home.mark(3);
  await protocol.upload(await home.snapshot());
  assert.deepEqual(env.transport.generations(stream), [2, 3], 'the independent copy does not require an ordinary pin');
  assert.equal((await protocol.record()).validated[0].generation, 3, 'the verified upload is still recorded');
  const { known } = await protocol.listed(ON.connection);
  const record = await protocol.record();
  await protocol.records.close();
  env.idb.faults.open = 'error';
  await assert.rejects(protocol.prune(record, known, ON.connection), { code: 'storage' }, 'an unreadable record still stops pruning');
  assert.deepEqual(env.transport.generations(stream), [2, 3]);
});

test('sync pin cannot cross a consent change while the cloud copy is being verified', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const { consentId } = await syncContext(protocol);
  const snapshot = await device().snapshot();
  await protocol.upload(snapshot);
  env.transport.faults.read.push(async () => { await protocol.recordConsent(CONSENT); });
  await assert.rejects(protocol.keepBackup({
    ...ON, stream, consentId, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
  }), { code: 'needs-consent' });
  assert.equal((await protocol.records.readSync()).sync, null);
});

test('sync pin keeps an earlier cloud copy without carrying its reference to a new connection', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const { consentId } = await syncContext(protocol);
  const home = device();
  const snapshot = await home.snapshot();
  await protocol.upload(snapshot);
  const pin = { ...ON, stream, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest };
  const kept = await protocol.keepBackup({ ...pin, consentId });

  env.transport.connection = 'connection-two';
  await protocol.recordConsent({ ...CONSENT, connection: 'connection-two' });
  await remember(protocol, { connection: 'connection-two', matchedDigest: 'c'.repeat(64) });
  assert.equal((await protocol.syncState({ connection: 'connection-two' })).kept, null);
  for (let generation = 2; generation <= 6; generation += 1) {
    home.mark(generation);
    await protocol.upload(await home.snapshot());
  }
  assert.deepEqual(env.transport.generations(stream), [5, 6]);
  assert.ok(env.transport.files.has(kept.id), 'the earlier-connection copy is left alone');
});

for (const corrupt of [false, true]) {
  test(`sync consent can be withdrawn while the protection record is ${corrupt ? 'corrupt' : 'valid'}`, async () => {
    const env = harness();
    const { protocol } = await consented(env);
    const context = await syncContext(protocol);
    const snapshot = await device().snapshot();
    await protocol.upload(snapshot);
    const kept = await protocol.keepBackup({
      ...context, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
    });
    if (corrupt) await protocol.records.writeSync(() => ({ version: 999 }));
    await protocol.withdrawConsent();
    const stored = await protocol.records.readSync();
    assert.equal(stored.record.consent, null, 'no consent remains to authorize uploads');
    assert.equal(stored.syncPresent, false, 'withdrawal clears the no-longer-valid local reference');
    assert.ok(env.transport.files.has(kept.id), 'the independent cloud file is not deleted');
    assert.equal((await protocol.discover({ ...ON, includeRetained: true })).retained[0].id, kept.id);
  });
}

test('sync pin checks the full saved snapshot even when only the active list changed', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const { consentId } = await syncContext(protocol);
  const home = device();
  const first = await home.snapshot();
  await protocol.upload(first);
  home.open('later');
  const current = await home.snapshot();
  assert.equal(current.personalDigest, first.personalDigest, 'automatic backup ignores the active list');
  assert.notEqual(current.backup.digest, first.backup.digest, 'the complete saved snapshot did change');
  await assert.rejects(protocol.keepBackup({
    ...ON, stream, consentId, generation: 1, personalDigest: current.personalDigest, contentDigest: current.backup.digest,
  }), { code: 'invalid' });
  assert.equal((await protocol.records.readSync()).sync, null);
});

test('sync pin survives pruning by another installation with a copied stream', async () => {
  const transport = fakeTransport();
  const first = harness({ transport });
  const second = harness({ transport });
  const { protocol, stream } = await consented(first);
  const { consentId } = await syncContext(protocol);
  const home = device();
  const snapshot = await home.snapshot();
  await protocol.upload(snapshot);
  const copied = await protocol.record();
  const other = second.make();
  await other.records.write(() => copied);
  await protocol.keepBackup({
    ...ON, stream, consentId, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
  });

  for (let generation = 2; generation <= 4; generation += 1) {
    home.mark(generation);
    await other.upload(await home.snapshot());
  }
  const kept = (await protocol.syncState(ON)).kept;
  assert.ok(transport.files.has(kept.id),
    `the retained copy survives; the original generation is present: ${transport.generations(stream).includes(1)}`);
  const checked = await protocol.fetchBackup(kept, ON);
  assert.equal(checked.text, snapshot.text, 'the retained copy still holds the original saved data');
});

test('sync pin survives pruning by an older tab that does not read the pin', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const { consentId } = await syncContext(protocol);
  const oldTab = env.make();
  oldTab.prune = async (record, known, connection) => {
    const floor = record.validated[1]?.generation;
    if (floor === undefined) return 0;
    const stale = known.filter((item) => item.stream === record.stream && item.generation < floor)
      .sort((a, b) => a.generation - b.generation).slice(0, CLOUD_PRUNE_PER_BACKUP);
    for (const item of stale) await oldTab.remove(item.id, connection);
    return stale.length;
  };
  const home = device();
  const snapshot = await home.snapshot();
  await protocol.upload(snapshot);
  await protocol.keepBackup({
    ...ON, stream, consentId, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
  });
  for (let generation = 2; generation <= 4; generation += 1) {
    home.mark(generation);
    const next = await home.snapshot();
    await env.locks.request(CLOUD_BACKUP_LOCK, { mode: 'exclusive' }, () => oldTab.upload(next));
  }
  const kept = (await protocol.syncState(ON)).kept;
  assert.ok(env.transport.files.has(kept.id),
    `the retained copy survives; the original generation is present: ${env.transport.generations(stream).includes(1)}`);
  assert.equal((await protocol.fetchBackup(kept, ON)).text, snapshot.text);
});

test('sync pin leaves a failed independent copy and the earlier recovery reference untouched', async () => {
  for (const fault of ['read-timeout', 'read-corrupt', 'create-lost', 'lost-reference']) {
    const env = harness();
    const { protocol, stream } = await consented(env);
    const { consentId } = await syncContext(protocol);
    const home = device();
    const first = await home.snapshot();
    await protocol.upload(first);
    const kept = await protocol.keepBackup({
      ...ON, stream, consentId, generation: 1, personalDigest: first.personalDigest, contentDigest: first.backup.digest,
    });
    home.mark(2);
    const next = await home.snapshot();
    await protocol.upload(next);
    if (fault === 'read-timeout') env.transport.faults.read.push(null, 'timeout');
    if (fault === 'read-corrupt') env.transport.faults.read.push(null, 'corrupt');
    if (fault === 'create-lost') env.transport.faults.create.push('lost');
    if (fault === 'lost-reference') loseNextSyncWrite(env.idb, protocol);
    const deletes = env.transport.calls.filter((call) => call === 'delete').length;
    const code = fault === 'read-corrupt' ? 'verify' : fault === 'lost-reference' ? 'storage' : 'timeout';
    await assert.rejects(protocol.keepBackup({
      ...ON, stream, consentId, generation: 2, personalDigest: next.personalDigest, contentDigest: next.backup.digest,
    }), { code }, fault);
    assert.deepEqual((await protocol.syncState(ON)).kept, kept, 'the earlier reference remains');
    assert.ok(env.transport.files.has(kept.id), 'the earlier independent copy remains');
    assert.equal(env.transport.calls.filter((call) => call === 'delete').length, deletes, 'a failed attempt deletes nothing');
  }
});

test('sync pin refuses a purported new copy that reuses an unrecognized file identity', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const snapshot = await device().snapshot();
  await protocol.upload(snapshot);
  const source = [...env.transport.files.values()][0];
  const foreignId = env.transport.store('notes.txt', source.bytes);
  env.transport.create = async (name, bytes) => ({ id: foreignId, name, size: bytes.byteLength, created: 1 });
  await assert.rejects(protocol.keepBackup({
    ...context, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
  }), { code: 'verify' });
  assert.equal((await protocol.records.readSync()).syncPresent, false);
  assert.equal(env.transport.files.get(foreignId).name, 'notes.txt');
});

test('sync pin refuses a purported new copy that reuses a malformed listed identity', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const snapshot = await device().snapshot();
  await protocol.upload(snapshot);
  const source = [...env.transport.files.values()][0];
  const foreignId = env.transport.store('notes.txt', source.bytes);
  const list = env.transport.list;
  env.transport.list = async (options) => (await list(options)).map((item) => (
    item.id === foreignId ? { id: foreignId } : item
  ));
  env.transport.create = async (name, bytes) => ({ id: foreignId, name, size: bytes.byteLength, created: 1 });
  await assert.rejects(protocol.keepBackup({
    ...context, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
  }), { code: 'verify' });
  assert.equal((await protocol.records.readSync()).syncPresent, false);
  assert.equal(env.transport.files.get(foreignId).name, 'notes.txt');
});

test('sync pin refuses an ordinary source whose listed identity is ambiguous', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const snapshot = await device().snapshot();
  await protocol.upload(snapshot);
  const sourceId = [...env.transport.files.keys()][0];
  const list = env.transport.list;
  env.transport.list = async (options) => {
    const items = await list(options);
    return [...items, { ...items.find((item) => item.id === sourceId), name: 'notes.txt' }];
  };
  await assert.rejects(protocol.keepBackup({
    ...context, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
  }), { code: 'invalid' });
  assert.equal((await protocol.records.readSync()).syncPresent, false);
});

test('sync pin refuses an ordinary source whose name is duplicated by a malformed listing', async () => {
  const env = harness({ transport: fakeTransport({ duplicates: true }) });
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const snapshot = await device().snapshot();
  await protocol.upload(snapshot);
  const source = [...env.transport.files.values()][0];
  const list = env.transport.list;
  env.transport.list = async (options) => [...await list(options), { name: source.name }];
  await assert.rejects(protocol.keepBackup({
    ...context, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
  }), { code: 'invalid' });
  assert.equal((await protocol.records.readSync()).syncPresent, false);
});

for (const ambiguity of ['name without an id', 'id without a name']) {
  test(`sync pin refuses a duplicate ${ambiguity} appearing after creation`, async () => {
    const env = harness({ transport: fakeTransport({ duplicates: true }) });
    const { protocol } = await consented(env);
    const context = await syncContext(protocol);
    const snapshot = await device().snapshot();
    await protocol.upload(snapshot);
    let made = null;
    const create = env.transport.create;
    const list = env.transport.list;
    env.transport.create = async (...args) => {
      made = await create(...args);
      return made;
    };
    env.transport.list = async (options) => {
      const items = await list(options);
      if (!made) return items;
      return [...items, ambiguity === 'name without an id' ? { name: made.name } : { id: made.id }];
    };
    await assert.rejects(protocol.keepBackup({
      ...context, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
    }), { code: 'verify' });
    assert.equal((await protocol.records.readSync()).syncPresent, false);
  });
}

test('sync pin copies remain discoverable without a local record and are not ordinary sync backups', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const { consentId } = await syncContext(protocol);
  const snapshot = await device().snapshot();
  await protocol.upload(snapshot);
  const kept = await protocol.keepBackup({
    ...ON, stream, consentId, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
  });
  await protocol.forget();
  for (const [id, file] of env.transport.files) {
    if (parseCloudBackupName(file.name)) env.transport.files.delete(id);
  }
  assert.ok(env.transport.files.has(kept.id), 'erasing the local record does not delete the cloud copy');

  const fresh = env.make();
  const found = await fresh.discover({ ...ON, includeRetained: true });
  assert.deepEqual(found.devices, [], 'a kept copy is not offered as a newer device backup');
  assert.equal(found.unrecognized, 0, 'a kept copy is not an unknown file');
  assert.equal(found.retained.length, 1);
  assert.deepEqual([found.retained[0].id, found.retained[0].name], [kept.id, kept.name]);
  assert.equal((await fresh.fetchRetainedBackup(found.retained[0], ON)).text, snapshot.text);
});

test('sync retained discovery only exposes uniquely named backups that pass the content and size checks', async () => {
  const env = harness({ transport: fakeTransport({ duplicates: true }) });
  const stream = 'a'.repeat(32);
  const { backup } = await device().snapshot();
  const name = (generation, token) => `recap-page-kept-v1-${stream}-${generation}-${token.repeat(32)}.json.gz`;
  const valid = env.transport.store(name(1, '1'), envelopeFile({ stream, generation: 1, backup, device: 'Phone' }));
  const corrupt = env.transport.store(name(2, '2'), Buffer.from('not a gzip backup'));
  const wrongIdentity = env.transport.store(name(3, '3'), envelopeFile({ stream, generation: 1, backup }));
  const alteredBackup = structuredClone(backup);
  alteredBackup.components.settings.theme = alteredBackup.components.settings.theme === 'dark' ? 'light' : 'dark';
  const altered = env.transport.store(name(6, '6'), envelopeFile({ stream, generation: 6, backup: alteredBackup }));
  const duplicateName = name(4, '4');
  const duplicateA = env.transport.store(duplicateName, envelopeFile({ stream, generation: 4, backup }));
  const duplicateB = env.transport.store(duplicateName, envelopeFile({ stream, generation: 4, backup }));
  const oversized = env.transport.store(name(5, '5'), Buffer.from('not a backup'));
  const malformedName = env.transport.store('recap-page-kept-v1-not-a-valid-name.json.gz', Buffer.from('not a backup'));
  const list = env.transport.list;
  env.transport.list = async (options) => (await list(options)).map((item) => (
    item.id === oversized ? { ...item, size: MAX_CLOUD_BACKUP_BYTES + 1 } : item
  ));
  const readIds = [];
  const read = env.transport.read;
  env.transport.read = async (id, options) => { readIds.push(id); return read(id, options); };

  const found = await env.make().discover({ ...ON, includeRetained: true });
  assert.deepEqual(found.retained.map((item) => item.id), [valid]);
  assert.deepEqual([found.retainedInvalid, found.retainedOmitted], [7, 0]);
  assert.equal(found.retained[0].device, 'Phone');
  assert.equal(found.retained[0].name, name(1, '1'));
  assert.equal('text' in found.retained[0], false, 'discovery exposes metadata, not the saved data');
  assert.deepEqual(new Set(readIds), new Set([valid, corrupt, wrongIdentity, altered]));
  assert.ok(!readIds.some((id) => [duplicateA, duplicateB, oversized, malformedName].includes(id)));
});

test('sync retained discovery bounds reads and reports valid-looking files it did not inspect', async () => {
  const env = harness();
  const stream = 'b'.repeat(32);
  const { backup } = await device().snapshot();
  const ids = [];
  for (let generation = 1; generation <= 5; generation += 1) {
    const name = `recap-page-kept-v1-${stream}-${generation}-${String(generation).repeat(32)}.json.gz`;
    ids.push(env.transport.store(name, envelopeFile({ stream, generation, backup })));
  }
  const readIds = [];
  const read = env.transport.read;
  env.transport.read = async (id, options) => { readIds.push(id); return read(id, options); };
  const found = await env.make({ limits: { streams: 16, readsPerStream: 4, retainedReads: 2 } })
    .discover({ ...ON, includeRetained: true });
  assert.deepEqual(found.retained.map((item) => item.id), [ids[4], ids[3]], 'newest candidates are checked first');
  assert.deepEqual(readIds, [ids[4], ids[3]]);
  assert.deepEqual([found.retainedInvalid, found.retainedOmitted], [0, 3]);
});

for (const ambiguity of ['duplicate name without an id', 'duplicate id without a name']) {
  for (const action of ['discovery', 'restore']) {
    test(`sync retained ${action} refuses a ${ambiguity}`, async () => {
      const env = harness({ transport: fakeTransport({ duplicates: true }) });
      const stream = 'b'.repeat(32);
      const { backup } = await device().snapshot();
      const name = `recap-page-kept-v1-${stream}-1-${'a'.repeat(32)}.json.gz`;
      const id = env.transport.store(name, envelopeFile({ stream, generation: 1, backup }));
      const protocol = env.make();
      const [chosen] = (await protocol.discover({ ...ON, includeRetained: true })).retained;
      const list = env.transport.list;
      env.transport.list = async (options) => [
        ...await list(options),
        ambiguity === 'duplicate name without an id' ? { name } : { id },
      ];

      if (action === 'discovery') {
        const found = await protocol.discover({ ...ON, includeRetained: true });
        assert.deepEqual(found.retained, []);
        assert.ok(found.retainedInvalid > 0, 'an ambiguous file is reported');
      } else {
        await assert.rejects(protocol.fetchRetainedBackup(chosen, ON), { code: 'invalid' });
      }
    });
  }
}

for (const change of [
  'duplicate-name', 'duplicate-id', 'duplicate-name-without-id', 'duplicate-id-without-name',
  'replaced', 'oversized', 'size-changed',
]) {
  test(`sync retained discovery withdraws a ${change} entry that changes during its read`, async () => {
    const env = harness({ transport: fakeTransport({ duplicates: true }) });
    const stream = 'b'.repeat(32);
    const { backup } = await device().snapshot();
    const name = `recap-page-kept-v1-${stream}-1-${'a'.repeat(32)}.json.gz`;
    const bytes = envelopeFile({ stream, generation: 1, backup });
    const id = env.transport.store(name, bytes);
    const list = env.transport.list;
    let changed = false;
    env.transport.list = async (options) => {
      const items = await list(options);
      if (!changed) return items;
      if (change === 'duplicate-id') return [...items, { ...items[0], name: 'notes.txt' }];
      if (change === 'duplicate-name-without-id') return [...items, { name }];
      if (change === 'duplicate-id-without-name') return [...items, { id }];
      if (change === 'oversized') return items.map((item) => (
        item.id === id ? { ...item, size: MAX_CLOUD_BACKUP_BYTES + 1 } : item
      ));
      if (change === 'size-changed') return items.map((item) => (
        item.id === id ? { ...item, size: item.size + 1 } : item
      ));
      return items;
    };
    const read = env.transport.read;
    env.transport.read = async (selected, options) => {
      const result = await read(selected, options);
      changed = true;
      if (change === 'duplicate-name') env.transport.store(name, bytes);
      if (change === 'replaced') {
        env.transport.files.delete(id);
        env.transport.store(name, bytes);
      }
      return result;
    };
    const found = await env.make().discover({ ...ON, includeRetained: true });
    assert.deepEqual(found.retained, []);
    assert.ok(['replaced', 'size-changed'].includes(change) ? found.retainedOmitted > 0 : found.retainedInvalid > 0);
  });
}

for (const change of ['missing', 'duplicate', 'changed', 'duplicate-during-read']) {
  test(`sync retained restore refuses a ${change} file after discovery`, async () => {
    const env = harness({ transport: fakeTransport({ duplicates: true }) });
    const stream = 'c'.repeat(32);
    const home = device();
    const original = await home.snapshot();
    const name = `recap-page-kept-v1-${stream}-1-${'a'.repeat(32)}.json.gz`;
    const bytes = envelopeFile({ stream, generation: 1, backup: original.backup });
    const id = env.transport.store(name, bytes);
    const protocol = env.make();
    const [chosen] = (await protocol.discover({ ...ON, includeRetained: true })).retained;
    if (change === 'missing') env.transport.files.delete(id);
    else if (change === 'duplicate') env.transport.store(name, bytes);
    else if (change === 'changed') {
      home.mark(3);
      const changed = await home.snapshot();
      env.transport.files.set(id, { ...env.transport.files.get(id), bytes: envelopeFile({ stream, generation: 1, backup: changed.backup }) });
    } else env.transport.faults.read.push(async () => { env.transport.store(name, bytes); });
    await assert.rejects(() => protocol.fetchRetainedBackup(chosen, ON), { code: change === 'missing' ? 'gone' : 'invalid' });
  });
}

test('sync pin revalidates the full kept copy, active consent and current reference on every fetch', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env);
  const context = await syncContext(protocol);
  const home = device();
  const first = await home.snapshot();
  await protocol.upload(first);
  const kept = await protocol.keepBackup({
    ...context, generation: 1, personalDigest: first.personalDigest, contentDigest: first.backup.digest,
  });
  assert.equal((await protocol.fetchKeptBackup({ ...context, kept })).text, first.text);

  const file = env.transport.files.get(kept.id);
  home.open('later');
  const altered = await home.snapshot();
  assert.equal(altered.personalDigest, first.personalDigest);
  env.transport.files.set(kept.id, {
    ...file, bytes: envelopeFile({ stream, generation: 1, backup: altered.backup, device: CONSENT.device }),
  });
  await assert.rejects(protocol.fetchKeptBackup({ ...context, kept }), { code: 'invalid' }, 'a different full snapshot is refused');
  env.transport.files.set(kept.id, file);

  env.transport.faults.read.push(async () => { await protocol.recordConsent(CONSENT); });
  await assert.rejects(protocol.fetchKeptBackup({ ...context, kept }), { code: 'needs-consent' }, 'consent changed during the read');
  const renewed = await syncContext(protocol);
  assert.equal((await protocol.fetchKeptBackup({ ...renewed, kept })).text, first.text, 'a new consent revalidates the same file');

  await protocol.records.writeSync((state) => ({ ...state, kept: null }));
  await assert.rejects(protocol.fetchKeptBackup({ ...renewed, kept }), { code: 'gone' }, 'a withdrawn reference is not offered');
});

test('sync pin revalidation refuses a missing or ambiguous kept name', async () => {
  for (const change of ['missing', 'duplicate']) {
    const env = harness({ transport: fakeTransport({ duplicates: true }) });
    const { protocol } = await consented(env);
    const context = await syncContext(protocol);
    const snapshot = await device().snapshot();
    await protocol.upload(snapshot);
    const kept = await protocol.keepBackup({
      ...context, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
    });
    if (change === 'missing') env.transport.files.delete(kept.id);
    else env.transport.store(kept.name, env.transport.files.get(kept.id).bytes);
    await assert.rejects(protocol.fetchKeptBackup({ ...context, kept }), { code: change === 'missing' ? 'gone' : 'invalid' }, change);
  }
});

test('sync pin revalidation refuses a new file under the old name', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const snapshot = await device().snapshot();
  await protocol.upload(snapshot);
  const kept = await protocol.keepBackup({
    ...context, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
  });
  const file = env.transport.files.get(kept.id);
  env.transport.files.delete(kept.id);
  const replacementId = env.transport.store(kept.name, file.bytes);
  assert.notEqual(replacementId, kept.id);
  await assert.rejects(protocol.fetchKeptBackup({ ...context, kept }), { code: 'gone' });
  const [discovered] = (await protocol.discover({ ...ON, includeRetained: true })).retained;
  assert.equal(discovered.id, replacementId, 'the validated replacement remains separately discoverable');
});

test('a same-name replacement with the same snapshot is not the recorded kept copy', async () => {
  const env = harness();
  const { protocol } = await consented(env);
  const context = await syncContext(protocol);
  const snapshot = await device().snapshot();
  await protocol.upload(snapshot);
  const kept = await protocol.keepBackup({
    ...context, generation: 1, personalDigest: snapshot.personalDigest, contentDigest: snapshot.backup.digest,
  });
  const [chosen] = (await protocol.discover({ ...ON, includeRetained: true })).retained;
  const file = env.transport.files.get(kept.id);
  const replaced = new Uint8Array(file.bytes);
  replaced[9] = replaced[9] === 0 ? 1 : 0;
  assert.deepEqual(gunzipSync(replaced), gunzipSync(file.bytes), 'the replacement decodes to the same backup');
  env.transport.files.set(kept.id, { ...file, bytes: replaced });

  await assert.rejects(protocol.fetchKeptBackup({ ...context, kept }), { code: 'invalid' });
  await assert.rejects(protocol.fetchRetainedBackup(chosen, ON), { code: 'invalid' });
  const [neutral] = (await protocol.discover({ ...ON, includeRetained: true })).retained;
  assert.match(kept.byteDigest, /^[a-f0-9]{64}$/);
  assert.equal(chosen.byteDigest, kept.byteDigest);
  assert.notEqual(neutral.byteDigest, kept.byteDigest, 'the valid replacement can only receive the neutral label');
});

test('sync pin safety lets unlocked workers prune ordinary backups without deleting a kept copy', async () => {
  const env = harness();
  const { protocol, stream } = await consented(env, { locks: null });
  const home = device();
  for (let generation = 1; generation <= 4; generation += 1) {
    home.mark(generation);
    await protocol.upload(await home.snapshot());
  }
  assert.deepEqual(env.transport.generations(stream), [3, 4], 'ordinary cleanup still works without Web Locks');

  const second = harness();
  const { protocol: locked, stream: keptStream } = await consented(second);
  const context = await syncContext(locked);
  const first = await home.snapshot();
  await locked.upload(first);
  const kept = await locked.keepBackup({
    ...context, generation: 1, personalDigest: first.personalDigest, contentDigest: first.backup.digest,
  });
  const unlocked = new CloudBackupProtocol({
    transport: second.transport, records: locked.records, locks: null, clock: second.clock,
  });
  for (let generation = 2; generation <= 4; generation += 1) {
    home.mark(generation);
    await unlocked.upload(await home.snapshot());
  }
  assert.deepEqual(second.transport.generations(keptStream), [3, 4], 'ordinary pruning keeps only the newest two');
  assert.equal((await unlocked.fetchKeptBackup({ ...context, kept })).text, first.text);
});

// ------------------------------------------------------------------ iCloud: why each file is read (#949)

// The iOS app's handler as the engine meets it, through the real iOS adapter and host transport. A file is
// on the device at once and waits for iCloud until the test uploads it, and a read of a waiting file is
// refused at once, with the 15 seconds the handler names, unless it may wait for the upload. Which read
// may wait is what these tests are about, so each read is answered as the handler of its shape answers
// it. A read that states its purpose is answered as the app's handler now answers it: only 'verify', of
// the name the last create made, waits, and lists leave that alone. A read that states none is answered
// as the handler on 65bcbe56 answered it, which took the read-back to be the read after the first list
// after a create, so the race these tests are about is reproduced against an engine that states no
// purpose. The 150-second window and the create deadline are the native tests' to prove.
function icloudNative(connection) {
  const files = new Map();
  const gates = new Map();
  const waiting = [];
  const reads = [];
  let candidate = null;
  let generation = 0;
  let legacy = null;
  let epoch = 0;
  const answer = (body) => ({ v: 1, kind: 'cloud-result', status: 200, body: JSON.stringify(body) });
  const refused = (code, message, retryAfterMs) => answer({ ok: false, error: { code, message, ...(retryAfterMs ? { retryAfterMs } : {}) } });
  const item = (name) => ({ id: name, name, size: Buffer.from(files.get(name).bytes, 'base64').byteLength, created: null });
  async function pause(point) {
    const gate = gates.get(point);
    if (!gate) return;
    gates.delete(point);
    gate.reached = true;
    await gate.opened;
  }
  const native = {
    reads,
    autoUpload: false,
    // The next request to arrive at this point waits there until the test lets it go.
    hold(point) {
      let release;
      const gate = { reached: false, opened: new Promise((resolve) => { release = resolve; }) };
      gate.release = release;
      gates.set(point, gate);
      return gate;
    },
    uploadAll() {
      for (const file of files.values()) file.uploaded = true;
      for (const resolve of waiting.splice(0)) resolve();
    },
    async postMessage({ op, body }) {
      const input = JSON.parse(body || '{}');
      if (op === 'status') {
        return answer({ ok: true, status: { provider: 'icloud', providers: ['icloud'], state: 'connected', connection, account: null, message: null, reason: null, signInExpiresAt: null } });
      }
      if (input.connection !== connection) return refused('needs-consent', 'Cloud backup asks again first.');
      if (op === 'list') {
        const saved = legacy;
        legacy = null;
        epoch += 1;
        const at = epoch;
        await pause('list');
        if (saved && !saved.listed && epoch === at) legacy = { ...saved, listed: true };
        return answer({ ok: true, items: [...files.keys()].map(item) });
      }
      if (op === 'read') {
        let mayWait;
        if (input.purpose === undefined) {
          mayWait = legacy?.name === input.id;
          legacy = null;
          epoch += 1;
        } else {
          mayWait = input.purpose === 'verify' && candidate === input.id;
          if (input.purpose === 'verify') candidate = null;
        }
        const file = files.get(input.id);
        const read = { name: input.id, purpose: input.purpose, waited: Boolean(file && !file.uploaded && mayWait) };
        reads.push(read);
        if (!file) return refused('not-found', 'That backup is not in iCloud.');
        if (!file.uploaded && !mayWait) return refused('unavailable', 'iCloud has not uploaded this backup yet.', 15_000);
        if (!file.uploaded) await new Promise((resolve) => { waiting.push(resolve); });
        return answer({ ok: true, bytes: file.bytes });
      }
      if (op === 'create') {
        legacy = null;
        epoch += 1;
        const at = epoch;
        candidate = null;
        generation += 1;
        const made = generation;
        await pause('create');
        files.set(input.name, { bytes: input.bytes, uploaded: native.autoUpload });
        if (epoch === at) legacy = { name: input.name, listed: false };
        if (generation === made) candidate = input.name;
        await pause('create-reply');
        return answer({ ok: true, item: item(input.name) });
      }
      if (op === 'delete') {
        legacy = null;
        epoch += 1;
        candidate = null;
        generation += 1;
        files.delete(input.id);
        return answer({ ok: true });
      }
      return { v: 1, kind: 'cloud-result', status: 404, body: 'null' };
    },
  };
  return native;
}

test('OneDrive on iPhone and iPad transports inherits the launch offer before uploading', async () => {
  for (const [label, nav] of [
    ['iPhone', { userAgent: 'iPhone' }],
    ['iPad', { userAgent: 'Macintosh', maxTouchPoints: 5 }],
  ]) {
    const connection = 'c'.repeat(32);
    const native = icloudNative(connection);
    native.autoUpload = true;
    const postMessage = native.postMessage.bind(native);
    const calls = [];
    native.postMessage = async (message) => {
      calls.push(message.op);
      if (message.op === 'status') {
        return {
          v: 1, kind: 'cloud-result', status: 200, body: JSON.stringify({
            ok: true, status: {
              provider: 'onedrive', providers: ['icloud', 'onedrive'], state: 'connected', connection,
              account: 'reader@example.test', message: null, reason: null, signInExpiresAt: null,
            },
          }),
        };
      }
      return postMessage(message);
    };
    const transport = createICloudTransport({ native, nav, createTransport: createCloudHostTransport });
    const env = harness({ transport });
    const protocol = env.make();
    await protocol.recordConsent({ connection, provider: 'onedrive', device: transport.device });
    const remote = await device({ 1: 333 }).snapshot();
    await transport.create(cloudBackupName(OTHER, 1), envelopeFile({
      stream: OTHER, generation: 1, backup: remote.backup, device: 'Desktop', createdAt: 123,
    }), { connection });
    const createdBefore = calls.filter((op) => op === 'create').length;
    const tab = page({ env, launchSync: true, device: null });
    await tab.cloud.resume();
    await until(() => tab.cloud.model.sync.phase === 'offer', `${label} offers the other device`);
    assert.equal(transport.device, `Recap Page on ${label}`);
    assert.equal(tab.cloud.model.sync.offer.remote.device, 'Desktop');
    assert.ok(calls.includes('list') && calls.includes('read'), 'the check crosses the native transport');
    await tab.time.advance(CLOUD_BACKUP_CADENCE.minIntervalMs, [tab.cloud]);
    assert.equal(calls.filter((op) => op === 'create').length, createdBefore, 'the unresolved offer holds uploads');
    await tab.cloud.turnOff();
  }
});

// One backup already made and uploaded, and the next one to make, on a device whose iCloud keeps the
// next file waiting until the test uploads it.
async function icloudBackups() {
  const connection = 'c'.repeat(32);
  const native = icloudNative(connection);
  const transport = createICloudTransport({ native, nav: { userAgent: 'iPhone' }, createTransport: createCloudHostTransport });
  assert.equal((await transport.status()).state, 'connected');
  assert.equal(transport.duplicateNames, true, 'iCloud lists again after a create, as the race needs');
  const env = harness({ transport });
  const protocol = env.make();
  await protocol.recordConsent({ connection, provider: 'icloud', device: transport.device });
  const home = device();
  native.autoUpload = true;
  await protocol.upload(await home.snapshot());
  native.autoUpload = false;
  native.reads.length = 0;
  home.mark(2);
  return { connection, native, protocol, next: await home.snapshot() };
}

const outcome = (promise) => promise.then(() => 'done', (error) => error?.code ?? 'failed');

test('iCloud: discovery that lists first after a create is refused at once, and the backup still verifies', async () => {
  const { connection, native, protocol, next } = await icloudBackups();
  const reply = native.hold('create-reply');
  const uploading = outcome(protocol.upload(next));
  try {
    await until(() => reply.reached, 'the create reached the app');
    const discovering = outcome(protocol.discover({ connection }));
    await until(() => native.reads.length === 1, 'discovery read the new file');
    assert.equal(native.reads[0].waited, false, 'a discovery read never waits for an upload');
    assert.equal(await discovering, 'unavailable');
    reply.release();
    await until(() => native.reads.length === 2, 'the backup read its file back');
    assert.equal(native.reads[1].waited, true, "the backup's read-back waits for the upload");
    native.uploadAll();
    assert.equal(await uploading, 'done');
    assert.equal((await protocol.record()).validated[0].generation, 2);
  } finally {
    reply.release();
    native.uploadAll();
    await uploading;
  }
});

test('iCloud: discovery listing while a create completes is refused at once, and the backup still verifies', async () => {
  const { connection, native, protocol, next } = await icloudBackups();
  const creating = native.hold('create');
  const reply = native.hold('create-reply');
  const uploading = outcome(protocol.upload(next));
  let listing = null;
  try {
    await until(() => creating.reached, 'the create reached the app');
    listing = native.hold('list');
    const discovering = outcome(protocol.discover({ connection }));
    await until(() => listing.reached, 'discovery started its list');
    creating.release();
    await until(() => reply.reached, 'the create completed while the list was in flight');
    listing.release();
    await until(() => native.reads.length === 1, 'discovery read the new file');
    assert.equal(native.reads[0].waited, false, 'a discovery read never waits for an upload');
    assert.equal(await discovering, 'unavailable');
    reply.release();
    await until(() => native.reads.length === 2, 'the backup read its file back');
    assert.equal(native.reads[1].waited, true, "the backup's read-back waits for the upload");
    native.uploadAll();
    assert.equal(await uploading, 'done');
    assert.equal((await protocol.record()).validated[0].generation, 2);
  } finally {
    creating.release();
    listing?.release();
    reply.release();
    native.uploadAll();
    await uploading;
  }
});
