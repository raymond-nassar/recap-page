import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, KEY } from '../src/js/storage.js';
import {
  MAX_LISTS, createEmptyState, createList, addIssuesToList,
  deleteList, restoreList, duplicateList, exportBackup,
} from '../src/js/lib/model.js';
import {
  LIST_HISTORY_KEY, LIST_HISTORY_FORMAT, LIST_HISTORY_COPY_FORMAT, MAX_HISTORY_BYTES,
  ListHistoryStore, parseListHistory, listHistoryIdentity, eraseReaderAndHistory,
} from '../src/js/lib/listHistory.js';

function memoryStorage() {
  const map = new Map();
  return {
    map,
    reads: new Map(),
    writes: [],
    failReads: new Set(),
    failOnceReads: new Set(),
    failWrites: new Set(),
    silentWrites: new Set(),
    failRemoves: new Set(),
    silentRemoves: new Set(),
    beforeGet: () => {},
    beforeSet: () => {},
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) {
      const count = (this.reads.get(key) ?? 0) + 1;
      this.reads.set(key, count);
      this.beforeGet(key, count);
      if (this.failReads.has(key) || this.failOnceReads.delete(key)) throw new Error('read refused');
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      this.writes.push(key);
      if (this.failWrites.has(key)) throw new Error('write refused');
      this.beforeSet(key, value);
      if (!this.silentWrites.has(key)) map.set(key, String(value));
    },
    removeItem(key) {
      if (this.failRemoves.has(key)) throw new Error('removal refused');
      if (!this.silentRemoves.has(key)) map.delete(key);
    },
  };
}

function serialLocks() {
  let tail = Promise.resolve();
  return {
    names: [],
    active: 0,
    peak: 0,
    request(name, operation) {
      this.names.push(name);
      const next = tail.then(async () => {
        this.active += 1;
        this.peak = Math.max(this.peak, this.active);
        try {
          return await operation();
        } finally {
          this.active -= 1;
        }
      });
      tail = next.catch(() => {});
      return next;
    },
  };
}

function seedState() {
  let state = createList(createEmptyState(), {
    id: 'a', name: 'First order', catalogId: 'first-order', note: 'Keep my note',
    itemIds: [1, 2, 3], deferredIssueIds: [3],
  });
  state = addIssuesToList(state, 'a', [
    { issueId: 1, title: 'One' }, { issueId: 2, title: 'Two' }, { issueId: 3, title: 'Three' },
  ]).state;
  state = createList(state, { id: 'b', name: 'Second order', itemIds: [2, 4] });
  state.lists.a.created = 100;
  state.lists.b.created = 200;
  return { ...state, read: { 1: 12345 }, notes: { 2: 'Keep my issue note' }, overrides: { 3: 'unavailable' } };
}

function readerValue(state = seedState()) {
  return JSON.stringify({ writeToken: 'fixture-reader', ...exportBackup(state) });
}

function recordFor(state, id, { completedAt = 1000, rating = null } = {}) {
  const list = state.lists[id];
  return { listId: id, created: list.created, catalogId: list.catalogId, completedAt, rating };
}

function historyValue(records) {
  return JSON.stringify({ format: LIST_HISTORY_FORMAT, version: 1, records });
}

function legacyValue() {
  return JSON.stringify({
    schemaVersion: 1,
    lists: [{
      name: 'Legacy order',
      items: [
        { issueId: 1, title: 'One', read: true, readAt: 111 },
        { issueId: 2, title: 'Two' },
      ],
    }],
  });
}

function harness({ readerRaw = readerValue(), historyRaw = null, locks = serialLocks() } = {}) {
  const storage = memoryStorage();
  if (readerRaw !== null) storage.map.set(KEY, readerRaw);
  if (historyRaw !== null) storage.map.set(LIST_HISTORY_KEY, historyRaw);
  const reader = new Store({ storage });
  reader.load();
  const notices = [];
  const fixture = { storage, reader, locks, notices, now: 1000 };
  const history = new ListHistoryStore({
    readerStore: reader, locks, clock: () => fixture.now,
    onChange: (_history, error) => notices.push(error),
  });
  fixture.history = history;
  history.load();
  return fixture;
}

test('completion preserves current reader bytes, actual progress, deferral and reader backup fields', async () => {
  const h = harness();
  const raw = h.storage.getItem(KEY);
  const before = h.reader.state;
  const result = await h.history.complete('a');
  assert.equal(result.ok, true);
  assert.equal(result.identity, listHistoryIdentity(h.reader.state.lists.a));
  assert.equal(h.history.isCompleted(h.reader.state, 'a'), true);
  assert.equal(h.storage.getItem(KEY), raw);
  assert.equal(h.reader.state, before);
  assert.deepEqual(h.reader.state.read, { 1: 12345 });
  assert.deepEqual(h.reader.state.lists.a.deferredIssueIds, [3]);
  assert.equal(h.reader.state.lists.a.note, 'Keep my note');
  assert.equal(h.reader.state.notes[2], 'Keep my issue note');
  assert.equal(h.reader.state.schemaVersion, 3);
  assert.deepEqual(Object.keys(exportBackup(h.reader.state)), [
    'schemaVersion', 'exportedAt', 'app', 'issues', 'read', 'overrides',
    'notes', 'lists', 'listOrder', 'active',
  ]);
  assert.deepEqual(h.storage.writes, [LIST_HISTORY_KEY]);
});

test('completion is idempotent and reopening retains enjoyment without changing reader data', async () => {
  const h = harness();
  const readerRaw = h.storage.getItem(KEY);
  const identity = listHistoryIdentity(h.reader.state.lists.a);
  assert.equal((await h.history.complete('a')).identity, identity);
  const first = h.storage.getItem(LIST_HISTORY_KEY);
  h.now = 2000;
  const repeated = await h.history.complete('a');
  assert.equal(repeated.ok, true);
  assert.equal(repeated.identity, identity);
  assert.equal(h.storage.getItem(LIST_HISTORY_KEY), first);
  assert.equal((await h.history.rate('a', 'up')).identity, identity);
  assert.equal((await h.history.rate('a', 'up')).identity, identity);
  const reopened = await h.history.reopen('a');
  assert.equal(reopened.ok, true);
  assert.equal(reopened.identity, identity);
  assert.equal((await h.history.reopen('a')).identity, identity);
  assert.deepEqual(h.history.getRecord(h.reader.state, 'a'), recordFor(h.reader.state, 'a', { completedAt: null, rating: 'up' }));
  assert.equal(h.history.isCompleted(h.reader.state, 'a'), false);
  await h.history.complete('a');
  assert.equal(h.history.getRecord(h.reader.state, 'a').completedAt, 2000);
  assert.equal(h.history.getRecord(h.reader.state, 'a').rating, 'up');
  assert.equal(h.storage.getItem(KEY), readerRaw);
  await h.history.complete('b');
  await h.history.reopen('b');
  assert.equal(h.history.getRecord(h.reader.state, 'b'), null);
});

test('ratings switch and clear explicitly, and invalid or incomplete choices are refused', async () => {
  const h = harness();
  assert.equal((await h.history.rate('a', 'up')).ok, false);
  assert.equal(h.storage.getItem(LIST_HISTORY_KEY), null);
  await h.history.complete('a');
  for (const rating of ['up', 'down', null]) {
    const result = await h.history.rate('a', rating);
    assert.equal(result.ok, true);
    assert.equal(result.identity, listHistoryIdentity(h.reader.state.lists.a));
    assert.equal(h.history.getRecord(h.reader.state, 'a').rating, rating);
  }
  const raw = h.storage.getItem(LIST_HISTORY_KEY);
  assert.equal((await h.history.rate('a', 'maybe')).ok, false);
  assert.equal(h.storage.getItem(LIST_HISTORY_KEY), raw);
  assert.match(h.notices.at(-1), /invalid/);
});

test('completed and enjoyed projections use intentional status and recent completion order', async () => {
  const h = harness();
  assert.deepEqual(h.history.activeIds(h.reader.state), ['a', 'b']);
  assert.deepEqual(h.history.counts(h.reader.state), { completed: 0, enjoyed: 0 });
  await h.history.complete('a');
  await h.history.rate('a', 'up');
  h.now = 3000;
  await h.history.complete('b');
  assert.deepEqual(h.history.activeIds(h.reader.state), []);
  assert.deepEqual(h.history.completedIds(h.reader.state), ['b', 'a']);
  assert.deepEqual(h.history.completedIds(h.reader.state, { enjoyed: true }), ['a']);
  assert.deepEqual(h.history.counts(h.reader.state), { completed: 2, enjoyed: 1 });
  await h.history.reopen('b');
  assert.deepEqual(h.history.activeIds(h.reader.state), ['b']);
});

test('reload matches exact identity and changed creation or catalog identity cannot inherit completion', async () => {
  const h = harness();
  await h.history.complete('a');
  const reopened = new ListHistoryStore({ readerStore: h.reader, locks: h.locks });
  reopened.load();
  assert.equal(reopened.isCompleted(h.reader.state, 'a'), true);
  for (const changed of [{ created: 101 }, { catalogId: 'different-order' }]) {
    const state = { ...h.reader.state, lists: { ...h.reader.state.lists, a: { ...h.reader.state.lists.a, ...changed } } };
    assert.equal(reopened.getRecord(state, 'a'), null);
  }
  assert.ok(Object.isFrozen(reopened.getRecord(h.reader.state, 'a')));
});

test('duplicated lists share comic progress but never inherit completion or enjoyment', async () => {
  const h = harness();
  await h.history.complete('a');
  await h.history.rate('a', 'up');
  const duplicated = duplicateList(h.reader.state, 'a');
  h.reader.update(() => duplicated.state);
  assert.equal(h.reader.lastUpdateOk, true);
  assert.equal(h.history.isCompleted(h.reader.state, duplicated.listId), false);
  assert.equal(h.history.getRecord(h.reader.state, duplicated.listId), null);
  assert.equal(h.history.isCompleted(h.reader.state, 'a'), true);
  assert.equal(h.reader.state.read[1], 12345);
});

test('removal and matching Undo or reader restoration hide then recover exact retained history', async () => {
  const h = harness();
  await h.history.complete('a');
  const list = h.reader.state.lists.a;
  const backup = JSON.stringify(exportBackup(h.reader.state));
  const historyRaw = h.storage.getItem(LIST_HISTORY_KEY);
  h.reader.update((state) => deleteList(state, 'a'));
  assert.deepEqual(h.history.completedIds(h.reader.state), []);
  assert.equal(h.storage.getItem(LIST_HISTORY_KEY), historyRaw);
  h.reader.update((state) => restoreList(state, list, { index: 0, active: true }));
  assert.equal(h.history.isCompleted(h.reader.state, 'a'), true);
  assert.equal(h.reader.restore(JSON.stringify(exportBackup(createEmptyState()))).ok, true);
  assert.deepEqual(h.history.completedIds(h.reader.state), []);
  assert.equal(h.reader.restore(backup).ok, true);
  assert.equal(h.history.isCompleted(h.reader.state, 'a'), true);
  assert.equal(h.reader.undoRestore().ok, true);
  assert.deepEqual(h.history.completedIds(h.reader.state), []);
  assert.equal(h.storage.getItem(LIST_HISTORY_KEY), historyRaw);
});

test('prototype-named list identities remain independent Map records', async () => {
  let state = createEmptyState();
  for (const id of ['__proto__', 'constructor', 'toString']) state = createList(state, { id, name: id });
  const h = harness({ readerRaw: readerValue(state) });
  for (const id of state.listOrder) assert.equal((await h.history.complete(id)).ok, true);
  assert.equal(h.history.records.size, 3);
  assert.deepEqual(h.history.completedIds(h.reader.state), state.listOrder);
  assert.equal(listHistoryIdentity(null), null);
  assert.equal(listHistoryIdentity({ id: 'x', created: 0, catalogId: null }), null);
});

test('strict parsing refuses malformed envelopes, fields, dates, ratings and duplicate identities', () => {
  const record = recordFor(seedState(), 'a');
  const value = { format: LIST_HISTORY_FORMAT, version: 1, records: [record] };
  assert.equal(parseListHistory(null).size, 0);
  assert.equal(parseListHistory(JSON.stringify(value)).size, 1);
  const invalid = [
    'broken', 'null', '[]', '{}',
    JSON.stringify({ ...value, version: 2 }),
    JSON.stringify({ ...value, extra: true }),
    JSON.stringify({ ...value, writeToken: '' }),
    JSON.stringify({ ...value, records: [record, record] }),
    ...[
      { listId: 1 }, { created: 0 }, { catalogId: '' }, { completedAt: 0 },
      { completedAt: 1.5 }, { completedAt: 8640000000000001 }, { rating: 'maybe' }, { extra: true },
    ].map((change) => JSON.stringify({ ...value, records: [{ ...record, ...change }] })),
  ];
  for (const text of invalid) assert.throws(() => parseListHistory(text), Error);
});

test('history parsing enforces byte and record ceilings before accepting data', () => {
  assert.throws(() => parseListHistory('x'.repeat(MAX_HISTORY_BYTES + 1)), /8 MB/);
  assert.throws(() => parseListHistory('\u00e9'.repeat(MAX_HISTORY_BYTES / 2 + 1)), /8 MB/);
  assert.throws(() => parseListHistory(historyValue(Array(MAX_LISTS + 1).fill(null))), /entry limit/);
});

test('unknown or newer history stays untouched and its troubleshooting copy is lossless', async () => {
  for (const raw of ['broken\ud800', historyValue([]).replace('"version":1', '"version":2')]) {
    const h = harness({ historyRaw: raw });
    assert.equal(h.history.known, false);
    assert.equal(h.history.counts(h.reader.state), null);
    assert.equal(h.history.canSave, false);
    assert.equal((await h.history.complete('a')).ok, false);
    assert.equal(h.storage.getItem(LIST_HISTORY_KEY), raw);
    assert.throws(() => h.history.exportBackup(), Error);
    const copy = JSON.parse(h.history.exportStoredCopy());
    assert.equal(copy.format, LIST_HISTORY_COPY_FORMAT);
    assert.equal(copy.storedValue, raw);
    assert.equal((await h.history.restore(JSON.stringify(copy))).ok, false);
    assert.equal(h.storage.getItem(LIST_HISTORY_KEY), raw);
  }
});

test('a throwing history write re-adopts the saved value and never reports completion', async () => {
  const h = harness();
  const readerRaw = h.storage.getItem(KEY);
  h.storage.failWrites.add(LIST_HISTORY_KEY);
  const result = await h.history.complete('a');
  assert.equal(result.ok, false);
  assert.match(result.error, /could not be saved/);
  assert.equal(h.history.known, true);
  assert.equal(h.history.isCompleted(h.reader.state, 'a'), false);
  assert.equal(h.storage.getItem(LIST_HISTORY_KEY), null);
  assert.equal(h.storage.getItem(KEY), readerRaw);
  assert.equal(h.history.busy, false);
});

test('a silent history write cannot leave optimistic in-memory completion', async () => {
  const h = harness();
  h.storage.silentWrites.add(LIST_HISTORY_KEY);
  const result = await h.history.complete('a');
  assert.equal(result.ok, false);
  assert.match(result.error, /did not match/);
  assert.equal(h.history.known, true);
  assert.equal(h.history.isCompleted(h.reader.state, 'a'), false);
  assert.deepEqual(h.history.counts(h.reader.state), { completed: 0, enjoyed: 0 });
  assert.equal(h.storage.getItem(LIST_HISTORY_KEY), null);
});

test('failed history verification becomes unknown until an explicit successful re-read', async () => {
  const h = harness();
  h.storage.beforeSet = (key) => {
    if (key === LIST_HISTORY_KEY) h.storage.failOnceReads.add(key);
  };
  const result = await h.history.complete('a');
  assert.equal(result.ok, false);
  assert.match(result.error, /could not be verified/);
  assert.equal(h.history.known, false);
  assert.equal(h.history.counts(h.reader.state), null);
  assert.equal(h.history.canSave, false);
  h.history.load();
  assert.equal(h.history.known, true);
  assert.equal(h.history.isCompleted(h.reader.state, 'a'), true);
});

test('cooperating tabs serialize history writes and stale actions adopt without overwriting', async () => {
  const h = harness();
  const second = new ListHistoryStore({ readerStore: h.reader, locks: h.locks });
  second.load();
  const [first, stale] = await Promise.all([h.history.complete('a'), second.complete('b')]);
  assert.equal(first.ok, true);
  assert.equal(stale.ok, false);
  assert.match(stale.error, /Another tab/);
  assert.equal(second.isCompleted(h.reader.state, 'a'), true);
  assert.equal(second.isCompleted(h.reader.state, 'b'), false);
  assert.equal((await second.complete('b')).ok, true);
  h.history.load();
  assert.deepEqual(new Set(h.history.completedIds(h.reader.state)), new Set(['a', 'b']));
  assert.equal(h.locks.peak, 1);
  assert.ok(h.locks.names.every((name) => name === LIST_HISTORY_KEY));
});

test('lock waits retain the action witness despite event adoption or list replacement', async () => {
  for (const operation of ['complete', 'restore']) {
    const h = harness();
    const before = h.reader.state;
    const pending = operation === 'complete'
      ? h.history.complete('b')
      : h.history.restore(historyValue([recordFor(before, 'b')]));
    const foreign = historyValue([recordFor(before, 'a', { rating: 'up' })]);
    h.storage.map.set(LIST_HISTORY_KEY, foreign);
    h.history.load();
    assert.equal((await pending).ok, false);
    assert.equal(h.storage.getItem(LIST_HISTORY_KEY), foreign);
    assert.equal(h.history.isCompleted(h.reader.state, 'a'), true);
    assert.equal(h.history.isCompleted(h.reader.state, 'b'), false);
  }
  const h = harness();
  const pending = h.history.complete('a');
  h.reader.update((state) => deleteList(state, 'a'));
  h.reader.update((state) => createList(state, { id: 'a', name: 'Replacement' }));
  assert.equal((await pending).ok, false);
  assert.equal(h.storage.getItem(LIST_HISTORY_KEY), null);
});

test('unsupported or refused locking stays visibly read-only without touching saved data', async () => {
  for (const locks of [null, { request() { throw new Error('lock refused'); } }]) {
    const h = harness({ locks });
    const raw = h.storage.getItem(KEY);
    const result = await h.history.complete('a');
    assert.equal(result.ok, false);
    assert.match(result.error, /locking|locked/);
    assert.equal(h.storage.getItem(LIST_HISTORY_KEY), null);
    assert.equal(h.storage.getItem(KEY), raw);
    assert.equal(h.history.busy, false);
  }
  const h = harness();
  h.history.clock = () => { throw new Error('programming fault'); };
  await assert.rejects(h.history.complete('a'), /programming fault/);
  assert.equal(h.history.busy, false);
});

test('legacy completion stabilizes only canonical existing reader fields and supplied read markers', async () => {
  const h = harness({ readerRaw: legacyValue() });
  const oldId = h.reader.state.active;
  const result = await h.history.complete(oldId);
  assert.equal(result.ok, true);
  assert.notEqual(result.listId, oldId);
  const saved = JSON.parse(h.storage.getItem(KEY));
  assert.equal(saved.schemaVersion, 3);
  assert.equal(saved.read[1], 111);
  assert.equal(saved.lists[result.listId].id, result.listId);
  assert.equal(saved.active, result.listId);
  assert.equal(h.history.isCompleted(h.reader.state, result.listId), true);
  assert.equal(Object.hasOwn(saved, 'completion'), false);
  const stabilized = h.storage.getItem(KEY);
  h.reader.load();
  h.history.load();
  assert.equal(h.history.isCompleted(h.reader.state, result.listId), true);
  assert.equal((await h.history.complete(result.listId)).ok, true);
  assert.equal(h.storage.getItem(KEY), stabilized);
});

test('tokenless foreign reader bytes survive the exact legacy normalization guard', async () => {
  const h = harness({ readerRaw: legacyValue() });
  const foreign = JSON.parse(legacyValue());
  foreign.lists[0].items[1].read = true;
  foreign.lists[0].items[1].readAt = 222;
  const foreignRaw = JSON.stringify(foreign);
  h.storage.reads.clear();
  h.storage.beforeGet = (key, count) => {
    // Reader read four is persist's comparison, after the latest legacy load.
    if (key === KEY && count === 4) h.storage.map.set(KEY, foreignRaw);
  };
  const result = await h.history.complete(h.reader.state.active);
  assert.equal(result.ok, false);
  assert.equal(h.storage.getItem(KEY), foreignRaw);
  assert.equal(h.reader.state.read[1], 111);
  assert.equal(h.reader.state.read[2], 222);
  assert.equal(h.storage.getItem(LIST_HISTORY_KEY), null);
});

test('failed, silent or unreadable legacy stabilization never writes completion history', async () => {
  for (const failure of ['throw', 'silent', 'verify']) {
    const raw = legacyValue();
    const h = harness({ readerRaw: raw });
    if (failure === 'throw') h.storage.failWrites.add(KEY);
    if (failure === 'silent') h.storage.silentWrites.add(KEY);
    if (failure === 'verify') h.storage.beforeSet = (key) => {
      if (key === KEY) h.storage.failOnceReads.add(KEY);
    };
    const result = await h.history.complete(h.reader.state.active);
    assert.equal(result.ok, false, failure);
    assert.equal(h.storage.getItem(LIST_HISTORY_KEY), null, failure);
    assert.equal(h.reader.state.read[1], 111, failure);
    if (failure !== 'verify') assert.equal(h.storage.getItem(KEY), raw, failure);
  }
});

test('stable schema-two bytes are preserved, missing identities stabilize and unsupported reader versions refuse', async () => {
  const versionTwo = exportBackup(seedState());
  versionTwo.schemaVersion = 2;
  delete versionTwo.lists.a.deferredIssueIds;
  const oldRaw = JSON.stringify(versionTwo);
  const h = harness({ readerRaw: oldRaw });
  assert.equal((await h.history.complete('a')).ok, true);
  assert.equal(h.storage.getItem(KEY), oldRaw);
  const missing = exportBackup(seedState());
  missing.lists.a.created = 0;
  const prepared = harness({ readerRaw: JSON.stringify(missing) });
  assert.equal((await prepared.history.complete('a')).ok, true);
  assert.ok(JSON.parse(prepared.storage.getItem(KEY)).lists.a.created > 0);
  prepared.reader.load();
  assert.equal(prepared.history.isCompleted(prepared.reader.state, 'a'), true);
  for (const version of [4, 3.5, 'invalid', 0]) {
    const changed = harness();
    const input = JSON.parse(changed.storage.getItem(KEY));
    input.schemaVersion = version;
    const raw = JSON.stringify(input);
    changed.storage.map.set(KEY, raw);
    assert.equal((await changed.history.complete('a')).ok, false);
    assert.equal(changed.storage.getItem(KEY), raw);
    assert.equal(changed.storage.getItem(LIST_HISTORY_KEY), null);
  }
});

test('history backup and strict restore remain independent of reading data and opaque saved copies', async () => {
  const h = harness();
  const readerRaw = h.storage.getItem(KEY);
  await h.history.complete('a');
  await h.history.rate('a', 'up');
  const backup = h.history.exportBackup();
  assert.equal(Object.hasOwn(JSON.parse(backup), 'writeToken'), false);
  await h.history.reopen('a');
  assert.equal((await h.history.restore(backup)).ok, true);
  assert.equal(h.history.isCompleted(h.reader.state, 'a'), true);
  assert.equal(h.history.getRecord(h.reader.state, 'a').rating, 'up');
  assert.equal(h.storage.getItem(KEY), readerRaw);
  const historyRaw = h.storage.getItem(LIST_HISTORY_KEY);
  for (const invalid of [null, undefined, {}, 'broken', historyValue([]).replace('"version":1', '"version":2')]) {
    assert.equal((await h.history.restore(invalid)).ok, false);
    assert.equal(h.storage.getItem(LIST_HISTORY_KEY), historyRaw);
  }
  h.storage.map.set(LIST_HISTORY_KEY, 'unreadable original');
  h.history.load();
  assert.equal((await h.history.restore(backup)).ok, true);
  assert.equal(h.history.known, true);
  assert.equal(h.storage.getItem(KEY), readerRaw);
});

test('reader erase must be durable before completion history is cleared', async () => {
  for (const failure of ['throw', 'silent', 'verify', 'token']) {
    const historyRaw = historyValue([recordFor(seedState(), 'a')]);
    const h = harness({ historyRaw });
    const readerRaw = h.storage.getItem(KEY);
    if (failure === 'throw') h.storage.failWrites.add(KEY);
    if (failure === 'silent') h.storage.silentWrites.add(KEY);
    if (failure === 'verify') h.storage.beforeSet = (key) => {
      if (key === KEY) h.storage.failOnceReads.add(KEY);
    };
    if (failure === 'token') h.storage.beforeSet = (key, value) => {
      if (key !== KEY) return;
      h.storage.silentWrites.add(KEY);
      h.storage.map.set(KEY, JSON.stringify({ ...JSON.parse(value), writeToken: 'unrelated-token' }));
    };
    let withdrawn = 0;
    const result = await eraseReaderAndHistory(h.reader, h.history, { onReaderErased: () => { withdrawn += 1; } });
    assert.equal(withdrawn, 0, failure);
    assert.equal(result.ok, false, failure);
    assert.notEqual(result.readerErased, true, failure);
    assert.equal(result.historyKept, true, failure);
    assert.equal(h.storage.getItem(LIST_HISTORY_KEY), historyRaw, failure);
    if (failure === 'throw' || failure === 'silent') assert.equal(h.storage.getItem(KEY), readerRaw, failure);
  }
});

test('history cleanup verifies absence and refuses unavailable or changed erase witnesses', async () => {
  const historyRaw = historyValue([recordFor(seedState(), 'a')]);
  for (const failure of ['none', 'throw', 'silent', 'history', 'reader', 'locks', 'unavailable']) {
    const h = harness({ historyRaw, locks: failure === 'locks' ? null : serialLocks() });
    if (failure === 'throw') h.storage.failRemoves.add(LIST_HISTORY_KEY);
    if (failure === 'silent') h.storage.silentRemoves.add(LIST_HISTORY_KEY);
    if (failure === 'unavailable') h.storage.failOnceReads.add(LIST_HISTORY_KEY);
    let withdrawn = 0;
    let erasedRaw;
    const pending = eraseReaderAndHistory(h.reader, h.history, {
      onReaderErased() {
        withdrawn += 1;
        erasedRaw = h.storage.getItem(KEY);
        assert.equal(h.storage.getItem(LIST_HISTORY_KEY), historyRaw);
        assert.deepEqual(JSON.parse(erasedRaw).listOrder, []);
      },
    });
    assert.equal(withdrawn, 1, failure);
    if (failure === 'history') {
      h.storage.map.set(LIST_HISTORY_KEY, historyValue([recordFor(seedState(), 'b')]));
      h.history.load();
    }
    if (failure === 'reader') h.reader.update((state) => createList(state, { id: 'new', name: 'New reading data' }));
    const result = await pending;
    assert.equal(result.ok, true, failure);
    assert.equal(result.readerErased, true, failure);
    assert.equal(result.readerRaw, erasedRaw, failure);
    assert.equal(result.historyKept, failure !== 'none', failure);
    assert.equal(h.storage.getItem(LIST_HISTORY_KEY) === null, failure === 'none', failure);
    if (failure === 'reader') {
      assert.equal(result.readerChanged, true);
      assert.ok(h.reader.state.lists.new);
    }
  }
  const h = harness({ historyRaw });
  assert.equal(h.reader.eraseAll().ok, true);
  assert.equal((await h.history.clearAfterErase(h.storage.getItem(KEY), undefined)).ok, false);
  assert.equal(h.storage.getItem(LIST_HISTORY_KEY), historyRaw);
  const corrupt = harness({ historyRaw: 'corrupt saved history' });
  assert.equal((await eraseReaderAndHistory(corrupt.reader, corrupt.history)).historyKept, false);
  assert.equal(corrupt.storage.getItem(LIST_HISTORY_KEY), null);
  const absent = harness({ locks: null });
  assert.equal((await eraseReaderAndHistory(absent.reader, absent.history)).historyKept, false);
  const unreadable = harness({ historyRaw });
  const failedRead = eraseReaderAndHistory(unreadable.reader, unreadable.history);
  unreadable.storage.failReads.add(KEY);
  const unknown = await failedRead;
  assert.equal(unknown.readerChanged, null);
  assert.equal(unknown.historyKept, true);
});
