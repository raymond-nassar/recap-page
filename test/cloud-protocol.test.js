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
import { CLOUD_BACKUP_CADENCE, CloudBackupCoordinator, personalDigest } from '../src/js/lib/cloudCoordinator.js';
import { CLOUD_SIGN_IN_POLL_MS, browserDeviceLabel, createCloudBackup } from '../src/js/lib/cloudBackup.js';
import { cloudCardStatus, cloudCardWarns, cloudEraseNote, cloudEraseOutcome } from '../src/js/views/cloud.js';
import { CompleteRestore, createRestoreJournal } from '../src/js/lib/completeRestore.js';
import { canonical, captureCompleteBackup } from '../src/js/lib/completeBackup.js';
import { createEmptyState, createList, addIssuesToList, exportBackup } from '../src/js/lib/model.js';
import { CLOUD_BACKUP_DATABASE, CLOUD_BACKUP_LOCK, KEY, SETTINGS_KEY, SIDEBAR_KEY } from '../src/js/storage.js';

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

// The app's own area of one account, in memory, as a host holding one connection serves it. Every call is
// logged, so a test can count what a backup costs, and faults holds what the next call of each kind does
// instead of succeeding: a code to reject with, a function to wait on first, or one of the named shapes
// below. Every call must name the connection the host holds now, which a test can change between calls to
// stand for another profile reconnecting the host. Names are refused twice, as OneDrive is asked to;
// { duplicates: true } allows them, as Google Drive does.
function fakeTransport({ duplicates = false, connection = 'connection-one' } = {}) {
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
        lock.held.splice(lock.held.indexOf(entry), 1);
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
    idb, transport, locks, time,
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

// A file as this version writes one, assembled here so a test can alter any part of it.
function envelopeFile({ stream, generation, backup, device: label = 'Planted', createdAt = 5 }) {
  return gzipSync(Buffer.from(canonical({
    backup, createdAt, device: label, format: CLOUD_ENVELOPE_FORMAT, generation, stream, version: CLOUD_ENVELOPE_VERSION,
  })));
}

// ------------------------------------------------------------------ the record

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

// The copy lists before the first makes generation 2, then creates the same name. OneDrive refuses it, so
// the copy starts a new stream; Google keeps both, so the list is its only guard, and the next list parts
// them.
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
    const taken = cloudBackupName(stream, 2);
    if (!duplicates) {
      await assert.rejects(second.upload(await home.snapshot()), { code: 'exists' });
      const record = await second.record();
      assert.notEqual(record.stream, stream);
      assert.deepEqual([record.nextGeneration, record.validated], [1, []], 'the next backup is the new stream\'s first');
    } else {
      assert.equal((await second.upload(await home.snapshot())).stream, stream, 'Google kept both');
      home.mark(4);
      await first.upload(await home.snapshot());
    }
    home.mark(5);
    const made = await second.upload(await home.snapshot());
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

function page({ env, home = device(), channel = null, databases, savedChanges = null } = {}) {
  const time = fakeTime();
  const protocol = env.make({ clock: time.now });
  const cloud = createCloudBackup({
    transport: env.transport, protocol, device: 'Microsoft Edge on Windows', channel, setTimer: time.setTimer, savedChanges,
    capture: () => captureCompleteBackup({ storage: home.storage, cryptoProvider: webcrypto }),
    databases: databases ?? (async () => [...env.idb.databases.keys()].map((name) => ({ name, version: 1 }))),
    coordinator: {
      locks: env.locks, events: new EventTarget(), clock: time.now, setTimer: time.setTimer, clearTimer: time.clearTimer,
      cryptoProvider: webcrypto, isOnline: () => true, isHidden: () => false,
    },
  });
  return { env, protocol, home, time, cloud, run: (ms = 0) => time.advance(ms, [cloud]) };
}

test('other devices see this one by its browser and the system it runs on', () => {
  const edge = { userAgentData: { brands: [{ brand: 'Not)A;Brand' }, { brand: 'Chromium' }, { brand: 'Microsoft Edge' }], platform: 'Windows' } };
  assert.equal(browserDeviceLabel(edge), 'Microsoft Edge on Windows');
  assert.equal(browserDeviceLabel({ userAgentData: { brands: [{ brand: 'Chromium' }, { brand: 'Not_A Brand' }], platform: 'Android' } }), 'Chromium on Android');
  assert.equal(browserDeviceLabel({ userAgent: 'Mozilla/5.0 (Macintosh)' }), 'Recap Page', 'no client hints: the protocol\'s default');
  assert.equal(browserDeviceLabel(undefined), 'Recap Page');
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
