import test from 'node:test';
import assert from 'node:assert/strict';
import { createHomeUpdatesSeen, HOME_UPDATES_SEEN_KEY as KEY } from '../src/js/lib/homeUpdatesSeen.js';
import { Store } from '../src/js/storage.js';
import { createEmptyState, exportBackup } from '../src/js/lib/model.js';

function storage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    map, writes: [], failReads: false, failWrites: false, silent: false,
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem(key) {
      if (this.failReads) throw new Error('unreadable');
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      this.writes.push(key);
      if (this.failWrites) throw new Error('quota');
      if (!this.silent) map.set(key, String(value));
    },
    removeItem: (key) => map.delete(key),
  };
}
const locks = { request: async (key, fn) => { assert.equal(key, KEY); return fn(); } };
const event = (area, key = KEY, newValue = null) => ({ storageArea: area, key, newValue });

test('viewing remembers the batch without changing reading state', async () => {
  const area = storage({
    'mrt.state.v2': JSON.stringify(createEmptyState()),
    'mrt.state.restore.tmp': 'temporary bytes',
    'mrt.state.prerestore': 'previous bytes',
    'mrt.state.salvage': 'salvage bytes',
    'mrt.settings': 'settings bytes',
  });
  const before = new Map(area.map);
  const store = new Store({ storage: area });
  store.load();
  const flags = [store.blocked, store.lastUpdateOk, store.seenToken, store.lastError];
  const seen = createHomeUpdatesSeen({ storage: area, locks });
  assert.equal(area.writes.length, 0);
  assert.equal((await seen.acknowledge(10)).remembered, true);
  assert.equal(area.getItem(KEY), '10');
  assert.equal(seen.current(), 10);
  assert.deepEqual(area.writes, [KEY]);
  for (const [key, value] of before) assert.equal(area.getItem(key), value);
  assert.deepEqual([store.blocked, store.lastUpdateOk, store.seenToken, store.lastError], flags);
});

test('older acknowledgments cannot lower a newer durable batch in another tab', async () => {
  const area = storage({ [KEY]: '30' });
  const older = createHomeUpdatesSeen({ storage: area, locks });
  const newer = createHomeUpdatesSeen({ storage: area, locks });
  await newer.acknowledge(50);
  assert.equal((await older.acknowledge(40)).remembered, true);
  assert.equal(area.getItem(KEY), '50');
  assert.equal(older.current(), 50);
});

test('storage events reread live values and ignore stale, unrelated and session payloads', async () => {
  const area = storage({ [KEY]: '50' });
  const seen = createHomeUpdatesSeen({ storage: area, locks });
  assert.equal(seen.handleStorageEvent(event(storage(), KEY, '90')), false);
  assert.equal(seen.handleStorageEvent(event(area, 'other', '90')), false);
  assert.equal(seen.handleStorageEvent(event(area, KEY, null)), true);
  assert.equal(seen.current(), 50);
  area.map.set(KEY, '70');
  seen.handleStorageEvent(event(area, KEY, '10'));
  assert.equal(seen.current(), 70);
  assert.equal(area.writes.length, 0);
});

test('genuine deletion retires held acknowledgments until a fresh explicit opening', async () => {
  const area = storage({ [KEY]: '30' });
  const jobs = [];
  const held = { request: (_key, fn) => new Promise((resolve) => jobs.push({ fn, resolve })) };
  const seen = createHomeUpdatesSeen({ storage: area, locks: held });
  const old = seen.acknowledge(50);
  area.map.delete(KEY);
  seen.handleStorageEvent(event(area));
  assert.equal(seen.current(), 0);
  const retired = jobs.shift();
  retired.resolve(retired.fn());
  assert.equal((await old).canceled, true);
  assert.equal(area.getItem(KEY), null);
  assert.equal(area.writes.length, 0);
  assert.equal(seen.current(), 0);
  const fresh = seen.acknowledge(50);
  const current = jobs.shift();
  current.resolve(current.fn());
  assert.equal((await fresh).remembered, true);
  area.map.clear();
  seen.handleStorageEvent(event(area, null));
  assert.equal(seen.current(), 0);
  assert.equal(area.getItem(KEY), null);
});

test('malformed values are repairable only on opening and unreadable storage is never overwritten', async () => {
  for (const raw of ['0', '01', '-1', 'Infinity', '1000000000000001', 'bad']) {
    const area = storage({ [KEY]: raw });
    const seen = createHomeUpdatesSeen({ storage: area, locks });
    assert.equal(seen.status().reason, 'malformed');
    assert.equal(area.getItem(KEY), raw);
    assert.equal(area.writes.length, 0);
    assert.equal((await seen.acknowledge(10)).remembered, true);
    assert.equal(area.getItem(KEY), '10');
  }
  const area = storage({ [KEY]: 'bytes' });
  area.failReads = true;
  const seen = createHomeUpdatesSeen({ storage: area, locks });
  assert.equal((await seen.acknowledge(10)).reason, 'unreadable');
  assert.equal(seen.current(), 10);
  assert.equal(area.map.get(KEY), 'bytes');
  assert.equal(area.writes.length, 0);
});

test('missing or rejected locks and throwing writes retain visit memory with explicit failure', async () => {
  for (const [manager, fault, reason] of [
    [null, false, 'locks-unavailable'],
    [{ request: () => Promise.reject(new Error('denied')) }, false, 'locks-rejected'],
    [locks, true, 'write-failed'],
  ]) {
    const area = storage();
    area.failWrites = fault;
    const seen = createHomeUpdatesSeen({ storage: area, locks: manager });
    const result = await seen.acknowledge(10);
    assert.equal(result.reason, reason);
    assert.equal(result.remembered, false);
    assert.equal(seen.current(), 10);
    assert.equal(area.getItem(KEY), null);
  }
});

test('silent viewing writes are not reported as remembered', async () => {
  const area = storage();
  area.silent = true;
  const seen = createHomeUpdatesSeen({ storage: area, locks });
  const result = await seen.acknowledge(10);
  assert.equal(result.remembered, false);
  assert.equal(result.reason, 'write-unverified');
  assert.equal(seen.current(), 10);
  assert.equal(area.getItem(KEY), null);
});

test('reading erase, Start fresh, restore, undo and JSON backup leave the preference outside reading state', async () => {
  const area = storage({ [KEY]: '50' });
  const store = new Store({ storage: area });
  store.load();
  const backup = JSON.stringify(exportBackup(createEmptyState()));
  assert.ok(store.restore(backup));
  assert.equal(area.getItem(KEY), '50');
  assert.ok(store.undoRestore());
  assert.equal(area.getItem(KEY), '50');
  store.eraseAll();
  assert.equal(area.getItem(KEY), '50');
  store.startFresh();
  assert.equal(area.getItem(KEY), '50');
  assert.ok(!JSON.stringify(exportBackup(store.state)).includes(KEY));
});
