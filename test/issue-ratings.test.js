import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  createEmptyState, createList, addIssuesToList, exportBackup, migrate, validateBackup,
  isIssueRating, issueRating, setIssueRating, markRead, setDeferred,
} from '../src/js/lib/model.js';
import { Store, KEY } from '../src/js/storage.js';

function storage() {
  const map = new Map();
  return {
    map, fail: false,
    getItem(key) { return map.get(key) ?? null; },
    setItem(key, value) { if (this.fail) throw new Error('quota'); map.set(key, String(value)); },
    removeItem(key) { map.delete(key); },
    get length() { return map.size; },
    key(index) { return [...map.keys()][index] ?? null; },
  };
}

test('issue ratings accept exactly ten half-star values and preserve unrelated state', () => {
  const state = createEmptyState();
  for (let n = 1; n <= 10; n++) {
    const next = setIssueRating(state, -42, n / 2);
    assert.equal(issueRating(next, -42), n / 2);
    for (const key of Object.keys(state).filter((name) => name !== 'ratings')) assert.strictEqual(next[key], state[key]);
  }
  assert.deepEqual(state.ratings, {});
  assert.equal(issueRating(state, 42), null);
});

test('invalid issue ratings and IDs are refused rather than converted to an unrated score', () => {
  for (const value of [0, -1, 5.5, 3.25, NaN, Infinity, '3', undefined]) {
    assert.equal(isIssueRating(value), false);
    assert.throws(() => setIssueRating(createEmptyState(), 42, value), /half-star/);
  }
  for (const id of [0, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => setIssueRating(createEmptyState(), id, 3.5), /issue ID/);
  }
});

test('clearing a score is absence, and reading changes do not clear a rating', () => {
  const rated = setIssueRating(createEmptyState(), 42, 3.5);
  const read = markRead(rated, 42);
  assert.equal(issueRating(markRead(read, 42, false), 42), 3.5);
  const cleared = setIssueRating(rated, 42, null);
  assert.equal(Object.hasOwn(cleared.ratings, 42), false);
  assert.equal(issueRating(rated, 42), 3.5);
});

test('schema 3 migrates ratings empty without losing deferrals or issue notes', () => {
  let state = createList(createEmptyState(), { id: 'saved', name: 'Saved' });
  state = addIssuesToList(state, 'saved', [{ issueId: 42, title: 'Example' }]).state;
  state = setDeferred(state, 'saved', 42, true);
  state.notes[42] = 'Remember';
  const old = { ...exportBackup(state), schemaVersion: 3 };
  delete old.ratings;
  const migrated = migrate(old);
  assert.equal(migrated.schemaVersion, 4);
  assert.deepEqual(migrated.ratings, {});
  assert.deepEqual(migrated.lists.saved.deferredIssueIds, [42]);
  assert.equal(migrated.notes[42], 'Remember');
  for (const version of [1, 2]) assert.deepEqual(migrate({ schemaVersion: version, lists: {} }).ratings, {});
});

test('schema 4 ratings round-trip without issue metadata or list membership', () => {
  const state = setIssueRating(setIssueRating(createEmptyState(), 42, 4.5), -42, 0.5);
  const backup = exportBackup(state);
  assert.deepEqual(backup.ratings, { 42: 4.5, '-42': 0.5 });
  const result = validateBackup(JSON.parse(JSON.stringify(backup)));
  assert.equal(result.ok, true);
  assert.deepEqual(result.state.ratings, state.ratings);
  assert.deepEqual(result.state.issues, {});
});

test('malformed schema 4 ratings cannot silently disappear during load or restore', () => {
  for (const ratings of [null, [], 'oops', { 0: 3 }, { '01': 3 }, { 42: '3.5' }, { 42: 3.25 }, { 42: 6 }]) {
    const raw = { ...exportBackup(createEmptyState()), ratings };
    assert.throws(() => migrate(raw), /rating/);
    assert.equal(validateBackup(raw).ok, false);
  }
});

test('ratings survive primary Store reload, restore and restore Undo', () => {
  const disk = storage();
  const store = new Store({ storage: disk });
  store.load();
  store.update((state) => setIssueRating(state, 42, 3.5));
  const copy = JSON.stringify(exportBackup(store.state));
  const reloaded = new Store({ storage: disk });
  reloaded.load();
  assert.equal(issueRating(reloaded.state, 42), 3.5);
  const legacy = JSON.stringify({ ...exportBackup(createEmptyState()), schemaVersion: 3, ratings: undefined });
  assert.equal(reloaded.restore(legacy).ok, true);
  assert.equal(issueRating(reloaded.state, 42), null);
  assert.equal(reloaded.undoRestore().ok, true);
  assert.equal(issueRating(reloaded.state, 42), 3.5);
  assert.equal(reloaded.restore(copy).ok, true);
  assert.equal(issueRating(reloaded.state, 42), 3.5);
});

test('failed rating writes roll back and notify rather than report a saved draft', () => {
  const disk = storage();
  const errors = [];
  const store = new Store({ storage: disk, onChange: (_state, error) => { if (error) errors.push(error); } });
  store.load();
  store.update((state) => setIssueRating(state, 42, 2));
  const before = disk.getItem(KEY);
  disk.fail = true;
  store.update((state) => setIssueRating(state, 42, 4));
  assert.equal(store.lastUpdateOk, false);
  assert.equal(issueRating(store.state, 42), 2);
  assert.equal(disk.getItem(KEY), before);
  assert.ok(errors.length > 0);
});

test('cross-tab rating adoption and stale-write refusal preserve the newer score', () => {
  const disk = storage();
  const first = new Store({ storage: disk });
  const second = new Store({ storage: disk });
  first.load();
  second.load();
  first.update((state) => setIssueRating(state, 42, 4.5));
  second.update((state) => setIssueRating(state, 42, 1));
  assert.equal(second.lastUpdateOk, false);
  assert.equal(issueRating(second.state, 42), 4.5);
  first.update((state) => setIssueRating(state, 42, 5));
  second.adoptForeignWrite(disk.getItem(KEY));
  assert.equal(issueRating(second.state, 42), 5);
});

test('erase clears ratings through the existing reader erase contract', () => {
  const disk = storage();
  const store = new Store({ storage: disk });
  store.load();
  store.update((state) => setIssueRating(state, -42, 2.5));
  assert.equal(store.eraseAll().ok, true);
  assert.deepEqual(store.state.ratings, {});
  const reloaded = new Store({ storage: disk });
  reloaded.load();
  assert.deepEqual(reloaded.state.ratings, {});
});

test('the actual pre-rating build refuses and salvages schema 4 instead of dropping ratings', async () => {
  const revision = 'd8d1a01c';
  const oldSource = (path) => execFileSync('git', ['show', `${revision}:${path}`], { encoding: 'utf8' });
  const absoluteImports = (source, base) => source.replace(/from '(\.[^']+)'/g,
    (_match, specifier) => `from '${new URL(specifier, base).href}'`);
  const dataModule = (source) => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
  const oldModel = dataModule(absoluteImports(oldSource('src/js/lib/model.js'), new URL('../src/js/lib/model.js', import.meta.url)));
  const oldStoreSource = oldSource('src/js/storage.js').replace("'./lib/model.js'", `'${oldModel}'`);
  const { Store: PreviousStore } = await import(dataModule(oldStoreSource));
  const disk = storage();
  const raw = JSON.stringify(exportBackup(setIssueRating(createEmptyState(), 42, 3.5)));
  disk.setItem(KEY, raw);
  const old = new PreviousStore({ storage: disk });
  old.load();
  assert.equal(old.blocked, true);
  assert.match(old.blockedReason, /Unsupported schema version 4/);
  old.update((state) => ({ ...state, notes: { 42: 'Old edit' } }));
  assert.equal(disk.getItem(KEY), raw);
  assert.equal(old.salvagedRaw(), raw);
});
