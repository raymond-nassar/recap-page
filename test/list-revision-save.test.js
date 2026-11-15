import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { KEY, Store } from '../src/js/storage.js';
import { addIssuesToList, createList, markRead } from '../src/js/lib/model.js';
import { captureCompleteBackup, parseCompleteBackup } from '../src/js/lib/completeBackup.js';
import { isListRevisionVerificationPaused, saveListRevision } from '../src/js/lib/listRevisionSave.js';

function fixture() {
  const values = new Map();
  const storage = {
    mode: 'normal',
    unreadable: false,
    getItem(key) {
      if (this.unreadable) throw new Error('read unavailable');
      const current = values.get(key) ?? null;
      if (this.mode === 'foreign-again' && current?.includes('foreign-write')) {
        const other = JSON.parse(current);
        other.writeToken = 'second-foreign-write';
        values.set(key, JSON.stringify(other));
      }
      return current;
    },
    setItem(key, value) {
      if (this.mode === 'throw') throw new Error('quota');
      if (this.mode === 'silent') return;
      values.set(key, value);
      if (this.mode === 'unreadable') this.unreadable = true;
      if (this.mode === 'invalid-foreign') values.set(key, '{"lists":[]}');
      if (this.mode === 'foreign' || this.mode === 'foreign-again') {
        const other = JSON.parse(value);
        other.writeToken = 'foreign-write';
        other.lists.saved.name = 'Changed in another tab';
        values.set(key, JSON.stringify(other));
      }
    },
    removeItem(key) { values.delete(key); },
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
  };
  const store = new Store({ storage });
  store.load();
  store.update((state) => {
    const list = createList(state, { id: 'saved', name: 'Before' });
    return markRead(addIssuesToList(list, 'saved', [{ issueId: 1, title: 'One' }]).state, 1, true, 123);
  });
  return { store, storage, values, expected: JSON.stringify(store.state.lists.saved) };
}

const revised = [{ issueId: 1, title: 'One' }, { issueId: 2, title: 'Two' }];

test('a list update reports success only after its complete saved state is read back', () => {
  const { store, storage, expected } = fixture();
  const result = saveListRevision(store, 'saved', expected, revised);
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)).lists.saved.itemIds, [1, 2]);
  assert.equal(JSON.parse(storage.getItem(KEY)).read[1], 123);
  assert.equal(JSON.parse(storage.getItem(KEY)).writeToken, store.seenToken);
});

test('a thrown or silent update leaves the prior durable list and reports failure', () => {
  for (const mode of ['throw', 'silent']) {
    const { store, storage, expected } = fixture();
    const before = storage.getItem(KEY);
    storage.mode = mode;
    const result = saveListRevision(store, 'saved', expected, revised);
    assert.equal(result.ok, false, mode);
    assert.equal(result.changed, false, mode);
    assert.equal(storage.getItem(KEY), before, mode);
    assert.deepEqual(store.state.lists.saved.itemIds, [1], mode);
    assert.equal(store.lastUpdateOk, false, mode);
    assert.equal(store.blocked, false, mode);
  }
});

test('an unreadable or concurrently replaced update is not reported as saved', () => {
  const unreadable = fixture();
  unreadable.storage.mode = 'unreadable';
  const unknown = saveListRevision(unreadable.store, 'saved', unreadable.expected, revised);
  assert.equal(unknown.ok, false);
  assert.equal(unknown.changed, null);
  assert.equal(unreadable.store.blocked, true);
  assert.match(unknown.error, /could not be verified/i);
  assert.deepEqual(unreadable.store.state.lists.saved.itemIds, [1]);
  unreadable.storage.unreadable = false;
  assert.deepEqual(JSON.parse(unreadable.storage.getItem(KEY)).lists.saved.itemIds, [1, 2]);

  const foreign = fixture();
  foreign.storage.mode = 'foreign';
  const replaced = saveListRevision(foreign.store, 'saved', foreign.expected, revised);
  assert.equal(replaced.ok, false);
  assert.equal(replaced.changed, null);
  assert.equal(foreign.store.blocked, false);
  assert.equal(foreign.store.state.lists.saved.name, 'Changed in another tab');
  assert.equal(foreign.store.seenToken, 'foreign-write');
});

test('an uncertain update is distinguishable from an unreadable-data recovery incident', () => {
  const { store, storage, expected } = fixture();
  storage.mode = 'unreadable';
  const result = saveListRevision(store, 'saved', expected, revised);
  assert.equal(result.changed, null);
  const isUncertain = () => isListRevisionVerificationPaused(store);
  assert.equal(isUncertain(), true);
  store.blockedReason = 'Could not read your saved data.';
  assert.equal(isUncertain(), false);
  store.blocked = false;
  assert.equal(isUncertain(), false);
});

test('a display failure after a write reports that the update was saved', () => {
  const { store, storage, expected } = fixture();
  store.onChange = () => { throw new Error('render failed'); };
  const result = saveListRevision(store, 'saved', expected, revised);
  assert.equal(result.ok, false);
  assert.equal(result.changed, true);
  assert.match(result.error, /saved.*render failed/i);
  assert.deepEqual(JSON.parse(storage.getItem(KEY)).lists.saved.itemIds, [1, 2]);
});

test('a second foreign change during reconciliation pauses further writes', () => {
  const { store, storage, expected } = fixture();
  storage.mode = 'foreign-again';
  const result = saveListRevision(store, 'saved', expected, revised);
  assert.equal(result.ok, false);
  assert.equal(result.changed, null);
  assert.equal(store.blocked, true);
  assert.match(result.error, /changed again/i);
});

test('a display failure while adopting a foreign write pauses further saving', () => {
  const { store, storage, expected } = fixture();
  storage.mode = 'foreign';
  store.onChange = () => { throw new Error('render failed'); };
  const result = saveListRevision(store, 'saved', expected, revised);
  assert.equal(result.ok, false);
  assert.equal(result.changed, null);
  assert.equal(store.blocked, true);
  assert.match(result.error, /render failed/i);
  assert.equal(JSON.parse(storage.getItem(KEY)).lists.saved.name, 'Changed in another tab');
});

test('a display failure cannot undo the safety pause after unreadable verification', () => {
  const { store, storage, expected } = fixture();
  storage.mode = 'unreadable';
  store.onChange = () => { throw new Error('render failed'); };
  const result = saveListRevision(store, 'saved', expected, revised);
  assert.equal(result.ok, false);
  assert.equal(result.changed, null);
  assert.equal(store.blocked, true);
  assert.match(result.error, /read unavailable/i);
  assert.match(result.error, /render failed/i);
});

test('a malformed foreign value is preserved and saving is paused', () => {
  const { store, storage, expected } = fixture();
  storage.mode = 'invalid-foreign';
  const result = saveListRevision(store, 'saved', expected, revised);
  assert.equal(result.ok, false);
  assert.equal(result.changed, null);
  assert.equal(store.blocked, true);
  assert.equal(storage.getItem(KEY), '{"lists":[]}');
  assert.deepEqual(store.state.lists.saved.itemIds, [1]);
});

test('a concurrent tokenless legacy write is not overwritten', () => {
  const { storage, values } = fixture();
  const legacy = JSON.parse(storage.getItem(KEY));
  delete legacy.writeToken;
  values.set(KEY, JSON.stringify(legacy));
  const store = new Store({ storage });
  store.load();
  const expected = JSON.stringify(store.state.lists.saved);
  legacy.lists.saved.name = 'Edited elsewhere';
  values.set(KEY, JSON.stringify(legacy));
  const result = saveListRevision(store, 'saved', expected, revised);
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(JSON.parse(storage.getItem(KEY)).lists.saved.name, 'Edited elsewhere');
  assert.deepEqual(JSON.parse(storage.getItem(KEY)).lists.saved.itemIds, [1]);
});

test('unreadable tokenless data before an update is protected from later writes', () => {
  const { storage, values } = fixture();
  const legacy = JSON.parse(storage.getItem(KEY));
  delete legacy.writeToken;
  values.set(KEY, JSON.stringify(legacy));
  const store = new Store({ storage });
  store.load();
  const expected = JSON.stringify(store.state.lists.saved);
  values.set(KEY, '{"lists":[]}');
  const result = saveListRevision(store, 'saved', expected, revised);
  assert.equal(result.ok, false);
  assert.equal(store.blocked, true);
  store.update((state) => createList(state, { id: 'later', name: 'Later' }));
  assert.equal(storage.getItem(KEY), '{"lists":[]}');
});

test('a failed pre-update read pauses later writes until the data can be checked', () => {
  const { store, storage, expected } = fixture();
  storage.unreadable = true;
  const result = saveListRevision(store, 'saved', expected, revised);
  assert.equal(result.ok, false);
  assert.equal(store.blocked, true);
  storage.unreadable = false;
  const before = storage.getItem(KEY);
  store.update((state) => createList(state, { id: 'later', name: 'Later' }));
  assert.equal(storage.getItem(KEY), before);
});

test('a concurrent tokenless erase is adopted before an update', () => {
  const { storage, values } = fixture();
  const legacy = JSON.parse(storage.getItem(KEY));
  delete legacy.writeToken;
  values.set(KEY, JSON.stringify(legacy));
  const store = new Store({ storage });
  store.load();
  const expected = JSON.stringify(store.state.lists.saved);
  storage.removeItem(KEY);
  const result = saveListRevision(store, 'saved', expected, revised);
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(store.blocked, false);
  assert.equal(store.state.lists.saved, undefined);
  assert.equal(storage.getItem(KEY), null);
});

test('a tokenless legacy list that already matches is not reported as a save failure', () => {
  const { storage, values } = fixture();
  const legacy = JSON.parse(storage.getItem(KEY));
  delete legacy.writeToken;
  const before = JSON.stringify(legacy);
  values.set(KEY, before);
  const store = new Store({ storage });
  store.load();
  const result = saveListRevision(store, 'saved', JSON.stringify(store.state.lists.saved), [revised[0]]);
  assert.equal(result.ok, true);
  assert.equal(result.changed, false);
  assert.equal(storage.getItem(KEY), before);
});

test('an updated list remains valid in a complete backup', async () => {
  const { store, storage, expected } = fixture();
  assert.equal(saveListRevision(store, 'saved', expected, revised).ok, true);
  const { text } = await captureCompleteBackup({ storage, cryptoProvider: webcrypto });
  const backup = await parseCompleteBackup(text, { cryptoProvider: webcrypto });
  assert.deepEqual(backup.components.reader.lists.saved.itemIds, [1, 2]);
  assert.equal(backup.components.reader.read[1], 123);
});
