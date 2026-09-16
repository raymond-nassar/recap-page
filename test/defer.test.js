import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmptyState, createList, addIssuesToList, setDeferred, isDeferred, queuedIssueIds,
  upNext, listProgress, listReadingProgress, listItems, markRead, setOverride,
  duplicateList, deleteList, restoreList, removeFromList, restoreRemovedIssue, moveItem,
  migrate, exportBackup, validateBackup, SCHEMA_VERSION, MAX_ISSUES,
} from '../src/js/lib/model.js';
import { availability } from '../src/js/lib/availability.js';
import { Store, KEY } from '../src/js/storage.js';
import { matchesReadingFilter } from '../src/js/lib/readingFilters.js';
import { readingPathProgress } from '../src/js/views/reading-paths.js';

function fixture() {
  let state = createList(createEmptyState(), { id: '__proto__', name: 'First', catalogId: 'first' });
  state = addIssuesToList(state, '__proto__', [1, -2, 3].map((issueId) => ({
    issueId, title: `Synthetic ${issueId}`, collectedIn: 'Book One', source: 'manual',
  }))).state;
  return createList(state, { id: 'other', name: 'Other', itemIds: [1, -2, 3] });
}

function memoryStorage() {
  const map = new Map();
  return {
    failKey: null,
    silentKey: null,
    failRemoveKey: null,
    failReadAfterSwap: false,
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
    getItem(key) {
      if (this.unreadable && key === KEY) throw new Error('Synthetic read failure');
      return map.get(key) ?? null;
    },
    setItem(key, value) {
      if (this.failKey === key) throw new Error('Synthetic write failure');
      if (this.silentKey === key) return;
      map.set(key, String(value));
      if (key === KEY && this.failReadAfterSwap) this.unreadable = true;
    },
    removeItem(key) {
      if (this.failRemoveKey === key) throw new Error('Synthetic cleanup failure');
      map.delete(key);
    },
  };
}

test('510 deferral changes only one list intent, never reading, identity, order or availability', () => {
  for (const [mu, override] of [
    [null, null], ['2999-01-01', null], ['2020-01-01', null],
    [null, 'available'], [null, 'unavailable'],
  ]) {
    let before = fixture();
    before.issues[1].mu = mu;
    before = setOverride(before, 1, override);
    const badge = availability(before.issues[1], { override });
    const after = setDeferred(before, '__proto__', 1);
    for (const key of ['read', 'issues', 'notes', 'overrides', 'listOrder', 'active']) {
      assert.equal(after[key], before[key], key);
    }
    assert.equal(after.lists.other, before.lists.other);
    assert.equal(after.lists.__proto__.itemIds, before.lists.__proto__.itemIds);
    assert.equal(after.lists.__proto__.collectedIn, before.lists.__proto__.collectedIn);
    assert.deepEqual(availability(after.issues[1], { override }), badge);
    assert.equal(isDeferred(after, '__proto__', 1), true);
    assert.equal(isDeferred(after, 'other', 1), false);
    assert.equal(Object.getPrototypeOf(after.lists), null);
    assert.deepEqual(setDeferred(after, '__proto__', 1, false).lists, before.lists);
  }
});

test('510 selection skips deferred work in source order and never treats all-deferred as read', () => {
  let state = fixture();
  state = setDeferred(state, '__proto__', 1);
  assert.equal(upNext(state, '__proto__').issueId, -2);
  assert.deepEqual(queuedIssueIds(state, '__proto__'), [-2, 3]);
  assert.equal(upNext(state, 'other').issueId, 1);
  state = setDeferred(state, '__proto__', 3);
  state = setDeferred(state, '__proto__', -2);
  assert.equal(upNext(state, '__proto__'), null);
  assert.deepEqual(listProgress(state, '__proto__'), { read: 0, total: 3 });
  assert.deepEqual(listReadingProgress(state, '__proto__'), { read: 0, total: 3, deferred: 3, queued: 0 });
  state = setDeferred(state, '__proto__', -2, false);
  assert.equal(upNext(state, '__proto__').issueId, -2);
  assert.deepEqual(state.lists.__proto__.itemIds, [1, -2, 3]);
  assert.equal(upNext(state, 'missing'), null);
  assert.deepEqual(listReadingProgress(state, 'missing'), { read: 0, total: 0, deferred: 0, queued: 0 });
});

test('510 read wins without erasing retained deferral and explicit resume remains deliberate', () => {
  let state = setDeferred(fixture(), '__proto__', 1);
  state = markRead(state, 1, true, 510);
  assert.equal(isDeferred(state, '__proto__', 1), true);
  assert.deepEqual(listReadingProgress(state, '__proto__'), { read: 1, total: 3, deferred: 0, queued: 2 });
  assert.equal(listItems(state, '__proto__')[0].deferred, true);
  assert.equal(upNext(state, 'other').issueId, -2);
  state = markRead(state, 1, false);
  assert.equal(upNext(state, '__proto__').issueId, -2);
  assert.equal(upNext(state, 'other').issueId, 1);
  state = setDeferred(state, '__proto__', 1, false);
  assert.equal(upNext(state, '__proto__').issueId, 1);
  assert.deepEqual(state.read, {});
  assert.equal(setDeferred(state, 'missing', 1), state);
  assert.equal(setDeferred(state, '__proto__', 999), state);
  assert.equal(setDeferred(state, '__proto__', 1, false), state);
});

test('510 copies own independent intent, moves keep canonical order and fresh additions stay eligible', () => {
  let state = setDeferred(setDeferred(fixture(), '__proto__', 3), '__proto__', 1);
  const copy = duplicateList(state, '__proto__');
  assert.deepEqual(copy.state.lists[copy.listId].deferredIssueIds, [1, 3]);
  assert.notEqual(copy.state.lists[copy.listId].deferredIssueIds, state.lists.__proto__.deferredIssueIds);
  assert.equal(copy.state.lists[copy.listId].catalogId, null);
  state = setDeferred(copy.state, copy.listId, 1, false);
  assert.equal(isDeferred(state, '__proto__', 1), true);
  state = moveItem(state, '__proto__', 3, -2);
  assert.deepEqual(state.lists.__proto__.deferredIssueIds, [3, 1]);
  state = addIssuesToList(state, '__proto__', [{ issueId: 4, title: 'Added' }], { at: 0 }).state;
  assert.deepEqual(queuedIssueIds(state, '__proto__'), [4, -2]);
  state = createList(state, { id: 'fresh', itemIds: [1, -2, 3] });
  assert.deepEqual(state.lists.fresh.deferredIssueIds, []);
});

test('510 membership undo merges captured intent without overwriting later choices or shared reads', () => {
  const before = setDeferred(fixture(), '__proto__', 1);
  let state = removeFromList(before, '__proto__', 1);
  assert.deepEqual(state.lists.__proto__.deferredIssueIds, []);
  state = setDeferred(state, '__proto__', -2);
  state = markRead(state, 1, true, 510);
  const restored = restoreRemovedIssue(state, '__proto__', 1, {
    index: 0, collectedIn: 'Book One', deferred: true,
  });
  assert.deepEqual(restored.lists.__proto__.deferredIssueIds, [1, -2]);
  assert.deepEqual(restored.lists.__proto__.itemIds, before.lists.__proto__.itemIds);
  for (const key of ['read', 'issues', 'notes', 'overrides']) assert.equal(restored[key], state[key]);
  assert.equal(listReadingProgress(restored, '__proto__').deferred, 1);
  assert.equal(listReadingProgress(markRead(restored, 1, false), '__proto__').deferred, 2);
  const deleted = deleteList(restored, '__proto__');
  assert.equal(deleted.read, restored.read);
  assert.deepEqual(restoreList(deleted, restored.lists.__proto__).lists.__proto__, restored.lists.__proto__);
  const reimported = createList(deleted, { id: 'replacement', catalogId: 'first', itemIds: [1] });
  assert.equal(restoreList(reimported, restored.lists.__proto__), reimported);
});

test('510 round-trip keeps schema3 intent including read members and migrates old backups with none', () => {
  let state = setDeferred(setDeferred(fixture(), '__proto__', -2), '__proto__', 1);
  state = markRead(state, 1, true, 510);
  const backup = JSON.parse(JSON.stringify(exportBackup(state)));
  assert.equal(backup.schemaVersion, 3);
  assert.equal(SCHEMA_VERSION, 3);
  const restored = validateBackup(backup);
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.state.lists, state.lists);
  assert.deepEqual(restored.state.read, state.read);
  assert.deepEqual(migrate(backup).lists.__proto__.deferredIssueIds, [1, -2]);
  const old = migrate({ ...backup, schemaVersion: 2 });
  assert.deepEqual(old.lists.__proto__.deferredIssueIds, []);
  assert.deepEqual(old.read, state.read);
  const v1 = migrate({ schemaVersion: 1, lists: { old: { name: 'Old', items: [{ issueId: 1, read: true, readAt: 510 }] } } });
  assert.deepEqual(v1.lists[v1.listOrder[0]].deferredIssueIds, []);
  assert.equal(v1.read[1], 510);
  const missing = JSON.parse(JSON.stringify(backup));
  delete missing.lists.__proto__.deferredIssueIds;
  assert.deepEqual(migrate(missing).lists.__proto__.deferredIssueIds, []);
});

test('510 new-schema malformed deferral is explicitly refused before state can be overwritten', () => {
  for (const value of [null, {}, '1', [0], ['1'], [1.5], [999], Array(MAX_ISSUES + 1).fill(1)]) {
    const backup = exportBackup(fixture());
    backup.lists.__proto__ = { ...backup.lists.__proto__, deferredIssueIds: value };
    const result = validateBackup(backup);
    assert.equal(result.ok, false);
    assert.match(result.errors.join(' '), /deferred/i);
  }
  const backup = exportBackup(fixture());
  backup.lists.__proto__ = { ...backup.lists.__proto__, deferredIssueIds: [3, 1, 3] };
  assert.deepEqual(migrate(backup).lists.__proto__.deferredIssueIds, [1, 3]);
  const storage = memoryStorage();
  const raw = JSON.stringify({ ...backup, lists: { bad: { itemIds: [1], deferredIssueIds: [999] } } });
  storage.setItem(KEY, raw);
  const store = new Store({ storage });
  store.load();
  assert.equal(store.blocked, true);
  store.update(() => fixture());
  assert.equal(storage.getItem(KEY), raw);
  assert.equal(store.lastUpdateOk, false);
});

test('510 successful reload, adoption and stale-write refusal preserve per-list intent', () => {
  const storage = memoryStorage();
  const first = new Store({ storage });
  first.update(() => fixture());
  const second = new Store({ storage });
  second.load();
  first.update((state) => setDeferred(state, '__proto__', 1));
  const raw = storage.getItem(KEY);
  second.update((state) => setDeferred(state, '__proto__', -2));
  assert.equal(second.lastUpdateOk, false);
  assert.equal(storage.getItem(KEY), raw);
  assert.deepEqual(second.state.lists.__proto__.deferredIssueIds, [1]);
  assert.equal(second.adoptForeignWrite(raw), true);
  assert.deepEqual(second.state.lists.__proto__.deferredIssueIds, [1]);
  const reload = new Store({ storage });
  assert.deepEqual(reload.load().lists, first.state.lists);
  assert.equal(reload.adoptForeignWrite(JSON.stringify({ schemaVersion: 99 })), false);
  assert.equal(storage.getItem(KEY), raw);
});

test('510 refused defer, resume and restore preserve bytes and undo remains truthful', () => {
  const storage = memoryStorage();
  const store = new Store({ storage });
  store.update(() => setDeferred(fixture(), '__proto__', 1));
  const previous = store.state;
  const raw = storage.getItem(KEY);
  storage.failKey = KEY;
  for (const [id, value] of [[-2, true], [1, false]]) {
    store.update((state) => setDeferred(state, '__proto__', id, value));
    assert.equal(store.lastUpdateOk, false);
    assert.equal(store.state, previous);
    assert.equal(storage.getItem(KEY), raw);
  }
  storage.failKey = 'mrt.state.restore.tmp';
  const replacement = exportBackup(setDeferred(previous, '__proto__', -2));
  assert.deepEqual(store.restore(replacement).changed, false);
  assert.equal(storage.getItem(KEY), raw);
  storage.failKey = null;
  storage.failRemoveKey = 'mrt.state.restore.tmp';
  assert.equal(store.restore(replacement).ok, true);
  assert.deepEqual(store.state.lists.__proto__.deferredIssueIds, [1, -2]);
  storage.failRemoveKey = null;
  assert.equal(store.undoRestore().ok, true);
  assert.deepEqual(store.state.lists.__proto__.deferredIssueIds, [1]);
  storage.silentKey = KEY;
  assert.equal(store.restore(replacement).changed, false);
  assert.deepEqual(store.state.lists.__proto__.deferredIssueIds, [1]);
  storage.silentKey = null;
  storage.failReadAfterSwap = true;
  assert.equal(store.restore(replacement).changed, null);
  assert.equal(store.blocked, true);
});

test('510 filters and exact or sibling Reading Paths distinguish deferred unread from completion', () => {
  let state = fixture();
  for (const id of [1, -2, 3]) state = setDeferred(state, '__proto__', id);
  state = markRead(state, 1, true, 510);
  const items = listItems(state, '__proto__');
  assert.equal(items.filter((item) => matchesReadingFilter('all', item)).length, 3);
  assert.equal(items.filter((item) => matchesReadingFilter('unread', item)).length, 2);
  assert.equal(items.filter((item) => matchesReadingFilter('deferred', item)).length, 2);
  assert.equal(items.filter((item) => matchesReadingFilter('read', item)).length, 1);
  for (const stop of [
    { stepId: 'first', lists: [] },
    { stepId: 'not-imported', lists: [{ id: 'first' }] },
  ]) {
    const progress = readingPathProgress(state, stop);
    assert.equal(progress.listId, '__proto__');
    assert.equal(progress.state, 'active');
    assert.equal(progress.read, 1);
    assert.equal(progress.total, 3);
    assert.equal(progress.deferred, 2);
  }
});
