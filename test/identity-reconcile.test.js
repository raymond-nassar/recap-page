import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  addsIdentityConflict, guardIdentityImport, identityConflicts, reconcileIdentities, validateIdentityCorrections,
} from '../src/js/lib/identityReconcile.js';
import { addIssuesToList, createList, deleteList, duplicateList, exportBackup, normalizeIssue } from '../src/js/lib/model.js';
import { taggedViewer, viewerKey } from '../src/js/lib/marvelComicsAppUrl.js';
import { KEY, Store } from '../src/js/storage.js';
import { createCompleteBackup, parseCompleteBackup } from '../src/js/lib/completeBackup.js';

// Disposable data only. The Wolverine numbers are the adjudicated Cable & Deadpool #44 match from
// #1601: the old guide key, its provider number and its Marvel Comics app viewer.
const OLD = -1224479109;
const PROVIDER = 16114;
const VIEWER = '9350';
const CANONICAL_TITLE = 'Cable & Deadpool (2004) #44';
const LEGACY_TITLE = 'Cable & Deadpool #44';
const WOLVERINE = 'wolverine-reading-order';
const BRIDGE = 'bridge-reading-order';
const corrections = [{
  catalogId: WOLVERINE, from: OLD, to: PROVIDER, appViewer: VIEWER,
  title: CANONICAL_TITLE, legacyTitle: LEGACY_TITLE, evidence: 'disposable',
}];
const viewerFor = (id) => (id === PROVIDER ? VIEWER : null);
const catalogIdsFor = (viewer) => (viewer === VIEWER ? [PROVIDER] : []);
const options = { corrections, viewerFor, catalogIdsFor };

function list(name, catalogId, itemIds, extra = {}) {
  return { name, description: '', catalogId, itemIds, collectedIn: {}, deferredIssueIds: [], ...extra };
}

function issue(issueId, title, extra = {}) {
  return normalizeIssue({ issueId, title, source: 'api', ...extra });
}

// The shape a build before this release saved: the comic under the Wolverine guide's own key with
// progress on it, one neighbour either side so order is observable, and an unrelated custom list.
function oldLibrary({ withCustom = true } = {}) {
  const lists = Object.assign(Object.create(null), {
    wolverine: list('Disposable Wolverine guide', WOLVERINE, [101, OLD, 102], {
      collectedIn: { [OLD]: 'Disposable book label' }, deferredIssueIds: [OLD],
    }),
  });
  if (withCustom) lists.custom = list('Unrelated saved comics', null, [-55]);
  return {
    schemaVersion: 4, app: 'recap-page', active: null,
    listOrder: Object.keys(lists), lists,
    issues: {
      101: issue(101, 'Before'), 102: issue(102, 'After'), [OLD]: issue(OLD, LEGACY_TITLE),
      ...(withCustom ? { [-55]: issue(-55, 'Previously accepted arbitrary negative') } : {}),
    },
    read: { [OLD]: 1700000000123 },
    notes: { [OLD]: 'Disposable note from the old Wolverine guide' },
    ratings: { [OLD]: 4.5 },
    overrides: { [OLD]: 'unavailable' },
  };
}

test('an untagged legacy integer in the viewer range never acquires a viewer', () => {
  const record = normalizeIssue({ issueId: -8000000000012618, title: 'Unrelated legacy comic' });
  assert.equal(record.appViewer, undefined);
  assert.equal(taggedViewer(record), null);
  const state = { ...oldLibrary({ withCustom: false }), issues: { [record.issueId]: record } };
  state.lists.wolverine = list('Hand made', null, [record.issueId]);
  assert.equal(reconcileIdentities(state, { catalogIdsFor: () => [12618], viewerFor: () => '12618' }), state);
});

test('a viewer-tagged comic is refused onto an untagged record with the same integer, and the reverse', () => {
  const key = viewerKey('12618');
  const base = oldLibrary({ withCustom: false });
  base.issues[key] = issue(key, 'Unrelated untagged comic');
  base.lists.custom = list('Hand made', null, [key]);
  base.listOrder.push('custom');
  const tagged = { issueId: key, appViewer: '12618', title: 'Runaways #1' };
  const refused = addIssuesToList(base, 'wolverine', [{ issueId: 1, title: 'Fine' }, tagged]);
  assert.equal(refused.state, base);
  assert.equal(refused.added, 0);
  assert.deepEqual(refused.collisions, [key]);
  assert.equal(base.issues[key].title, 'Unrelated untagged comic');

  const taggedBase = { ...base, issues: { ...base.issues, [key]: normalizeIssue(tagged) } };
  const reverse = addIssuesToList(taggedBase, 'wolverine', [{ issueId: key, title: 'Untagged copy' }]);
  assert.equal(reverse.state, taggedBase);
  assert.deepEqual(reverse.collisions, [key]);

  const same = addIssuesToList(taggedBase, 'wolverine', [tagged]);
  assert.equal(same.collisions, undefined);
  assert.equal(same.added, 1);
});

test('an old Wolverine library moves to the provider number with order, progress and choices kept', () => {
  const before = oldLibrary();
  const after = reconcileIdentities(before, options);
  assert.notEqual(after, before);
  assert.deepEqual(after.lists.wolverine.itemIds, [101, PROVIDER, 102]);
  assert.deepEqual(after.lists.wolverine.collectedIn, { [PROVIDER]: 'Disposable book label' });
  assert.deepEqual(after.lists.wolverine.deferredIssueIds, [PROVIDER]);
  assert.equal(after.read[PROVIDER], 1700000000123);
  assert.equal(after.notes[PROVIDER], 'Disposable note from the old Wolverine guide');
  assert.equal(after.ratings[PROVIDER], 4.5);
  assert.equal(after.overrides[PROVIDER], 'unavailable');
  for (const key of ['read', 'notes', 'ratings', 'overrides']) assert.equal(Object.hasOwn(after[key], OLD), false);
  assert.deepEqual(after.issues[OLD], before.issues[OLD], 'the old record is kept as saved');
  assert.deepEqual(after.lists.custom, before.lists.custom);
  assert.equal(reconcileIdentities(after, options), after, 'a second pass changes nothing');
  assert.equal(before.lists.wolverine.itemIds[1], OLD, 'the input is not mutated');
});

test('equal values on both records join; differing values preserve both untouched', () => {
  const equal = oldLibrary();
  equal.issues[PROVIDER] = issue(PROVIDER, CANONICAL_TITLE);
  equal.notes[PROVIDER] = equal.notes[OLD];
  const joined = reconcileIdentities(equal, options);
  assert.equal(joined.lists.wolverine.itemIds[1], PROVIDER);
  assert.equal(joined.notes[PROVIDER], equal.notes[OLD]);

  const differing = oldLibrary();
  differing.issues[PROVIDER] = issue(PROVIDER, CANONICAL_TITLE);
  differing.notes[PROVIDER] = 'Different disposable note, must not be replaced';
  differing.ratings[PROVIDER] = 1;
  assert.equal(reconcileIdentities(differing, options), differing);
});

test('a holder outside the correcting guide, or no holder at all, blocks the move', () => {
  const shared = oldLibrary();
  shared.lists.custom = list('Unrelated saved comics', null, [-55, OLD]);
  assert.equal(reconcileIdentities(shared, options), shared);

  // A deleted list keeps its comics' progress, so an orphan is not proof of a match.
  const orphan = oldLibrary();
  orphan.lists = Object.assign(Object.create(null), { custom: orphan.lists.custom });
  orphan.listOrder = ['custom'];
  assert.equal(reconcileIdentities(orphan, options), orphan);

  const orphanTagged = oldLibrary();
  const key = viewerKey(VIEWER);
  orphanTagged.issues[key] = normalizeIssue({ issueId: key, appViewer: VIEWER, title: 'Cable & Deadpool #44' });
  orphanTagged.notes[key] = 'Orphaned viewer note';
  assert.equal(reconcileIdentities(orphanTagged, { corrections: [], viewerFor, catalogIdsFor }), orphanTagged);
});

test('a held viewer-only comic joins its one catalog number when the table later pairs them', () => {
  const key = viewerKey(VIEWER);
  const state = oldLibrary({ withCustom: false });
  state.issues[key] = normalizeIssue({ issueId: key, appViewer: VIEWER, title: 'Cable & Deadpool #44' });
  state.lists.viewer = list('Reader copy', null, [key]);
  state.listOrder.push('viewer');
  state.read[key] = 5;
  const after = reconcileIdentities(state, { corrections: [], viewerFor, catalogIdsFor });
  assert.deepEqual(after.lists.viewer.itemIds, [PROVIDER]);
  assert.equal(after.read[PROVIDER], 5);
  assert.equal(after.issues[PROVIDER].appViewer, undefined);
  assert.deepEqual(after.issues[key], state.issues[key]);
  const twice = reconcileIdentities(state, { corrections: [], viewerFor, catalogIdsFor: () => [PROVIDER, 999] });
  assert.equal(twice, state, 'a viewer the table pairs with two numbers joins nothing');
});

test('a fresh bridge guide and an old Wolverine library converge on one checkmark', () => {
  const before = oldLibrary();
  before.lists.bridge = list('Bridge guide', BRIDGE, []);
  before.listOrder.push('bridge');
  const imported = addIssuesToList(before, 'bridge', [{ issueId: 201, title: 'First' }, { issueId: PROVIDER, title: 'Cable & Deadpool #44' }]).state;
  const after = reconcileIdentities(imported, options);
  assert.equal(addsIdentityConflict(before, after, options), false);
  assert.deepEqual(after.lists.bridge.itemIds, [201, PROVIDER]);
  assert.deepEqual(after.lists.wolverine.itemIds, [101, PROVIDER, 102]);
  assert.equal(after.notes[PROVIDER], 'Disposable note from the old Wolverine guide');
  assert.equal(identityConflicts(after, options).size, 0);
});

test('an import that would leave two usable checkmarks for one comic is detected before writing', () => {
  const before = oldLibrary();
  before.issues[PROVIDER] = issue(PROVIDER, CANONICAL_TITLE);
  before.notes[PROVIDER] = 'Different disposable note, must not be replaced';
  assert.equal(identityConflicts(before, options).size, 0, 'an unheld record is not yet a second checkmark');
  before.lists.bridge = list('Bridge guide', BRIDGE, []);
  before.listOrder.push('bridge');
  const imported = reconcileIdentities(addIssuesToList(before, 'bridge', [{ issueId: PROVIDER, title: 'Cable & Deadpool #44' }]).state, options);
  assert.equal(addsIdentityConflict(before, imported, options), true);
  assert.deepEqual([...identityConflicts(imported, options)], [`${OLD}|${PROVIDER}`]);
});

test('a copied legacy source label blocks a duplicate corrected import before any shell is saved', () => {
  const original = oldLibrary({ withCustom: false });
  const { state: copied, listId: copyId } = duplicateList(original, 'wolverine');
  const before = deleteList(copied, 'wolverine');

  const shell = createList(before, { id: 'bridge', name: 'Bridge guide', catalogId: BRIDGE });
  const imported = addIssuesToList(shell, 'bridge', [
    { issueId: PROVIDER, title: CANONICAL_TITLE },
  ]).state;
  const after = reconcileIdentities(imported, options);

  assert.equal(before.lists[copyId].catalogId, null);
  assert.equal(before.lists[copyId].itemIds.includes(OLD), true);
  assert.equal(addsIdentityConflict(before, after, options), true);
  assert.deepEqual([...identityConflicts(after, options)], [`${OLD}|${PROVIDER}`]);
  const guarded = guardIdentityImport(before, imported, options);
  assert.equal(guarded.conflict, true);
  assert.equal(guarded.state, before);
  assert.equal(guarded.state.lists.bridge, undefined, 'the refused import never leaves a list shell');
  assert.deepEqual(guarded.state, before, 'the saved in-memory state is unchanged');

  const unrelated = {
    ...before,
    issues: { ...before.issues, [OLD]: issue(OLD, 'Different comic at the same old key') },
  };
  const unrelatedShell = createList(unrelated, { id: 'bridge', name: 'Bridge guide', catalogId: BRIDGE });
  const unrelatedImport = addIssuesToList(unrelatedShell, 'bridge', [
    { issueId: PROVIDER, title: CANONICAL_TITLE },
  ]).state;
  assert.equal(addsIdentityConflict(unrelated, reconcileIdentities(unrelatedImport, options), options), false);

  const canonicalOnly = {
    ...before,
    issues: { ...before.issues, [OLD]: issue(OLD, CANONICAL_TITLE) },
  };
  const canonicalShell = createList(canonicalOnly, { id: 'bridge', name: 'Bridge guide', catalogId: BRIDGE });
  const canonicalImport = addIssuesToList(canonicalShell, 'bridge', [
    { issueId: PROVIDER, title: CANONICAL_TITLE },
  ]).state;
  assert.equal(guardIdentityImport(canonicalOnly, canonicalImport, options).conflict, false);
});

test('a correction table with any fault applies nothing', () => {
  assert.equal(validateIdentityCorrections(corrections, { viewerFor }).ok, true);
  assert.equal(validateIdentityCorrections(corrections).ok, false, 'the bundled table does not pair this viewer yet');
  const missingLegacyTitle = { ...corrections[0] };
  delete missingLegacyTitle.legacyTitle;
  assert.equal(validateIdentityCorrections([missingLegacyTitle], { viewerFor }).ok, false);
  const bad = [...corrections, { catalogId: WOLVERINE, from: 102, to: 101, title: 'No evidence' }];
  assert.equal(validateIdentityCorrections(bad, { viewerFor }).ok, false);
  const state = oldLibrary();
  assert.equal(reconcileIdentities(state, { ...options, corrections: bad }), state);
});

function memoryStorage(initial, { failWrites = false } = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      if (failWrites) throw new Error('disposable quota');
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  };
}

test('the store moves a saved library once, and a repeated load moves nothing', () => {
  const storage = memoryStorage({ [KEY]: JSON.stringify(oldLibrary()) });
  const first = new Store({ storage });
  first.load();
  assert.deepEqual(first.reconcileIdentities(options), { ok: true, changed: true });
  const saved = JSON.parse(storage.values.get(KEY));
  assert.deepEqual(saved.lists.wolverine.itemIds, [101, PROVIDER, 102]);
  const second = new Store({ storage });
  second.load();
  assert.deepEqual(second.reconcileIdentities(options), { ok: true, changed: false });
});

test('a failed reconcile write keeps the saved data and reports the save failure', () => {
  const raw = JSON.stringify(oldLibrary());
  const storage = memoryStorage({ [KEY]: raw });
  const changes = [];
  const store = new Store({ storage, onChange: (state, error) => changes.push(error) });
  store.load();
  const before = store.state;
  storage.setItem = () => { throw new Error('disposable quota'); };
  assert.deepEqual(store.reconcileIdentities(options), { ok: false, changed: false });
  assert.equal(storage.values.get(KEY), raw);
  assert.equal(store.state, before);
  assert.equal(store.lastUpdateOk, false);
  assert.ok(store.lastError, 'the failure is not silent');
  assert.ok(changes.at(-1), 'the failure reaches the same onChange path an ordinary save uses');
});

test('a held conflict is not a failure and writes nothing', () => {
  const state = oldLibrary();
  state.issues[PROVIDER] = issue(PROVIDER, 'Cable & Deadpool (2004) #44');
  state.notes[PROVIDER] = 'Different disposable note, must not be replaced';
  state.lists.custom.itemIds.push(PROVIDER);
  const raw = JSON.stringify(state);
  const storage = memoryStorage({ [KEY]: raw });
  const store = new Store({ storage });
  store.load();
  assert.deepEqual(store.reconcileIdentities(options), { ok: true, changed: false });
  assert.equal(storage.values.get(KEY), raw);
  assert.equal(store.lastError, null);
});

test('a complete backup made from an old library still verifies unchanged, and tampering is refused', async () => {
  // Read through the store without reconciling, which is the form a save made before this release
  // holds and the form a complete backup of it signs.
  const store = new Store({ storage: memoryStorage({ [KEY]: JSON.stringify(oldLibrary()) }) });
  store.load();
  const reader = exportBackup(store.state);
  delete reader.exportedAt;
  const components = {
    draft: null,
    history: { format: 'recap-page-list-history', records: [], version: 1 },
    reader,
    settings: { covers: true, filter: 'all', hideDescriptions: false, readingShortcut: true, sidebarCollapsed: null, theme: 'system' },
  };
  const { text } = await createCompleteBackup(components, { cryptoProvider: webcrypto });
  const parsed = await parseCompleteBackup(text, { cryptoProvider: webcrypto });
  assert.deepEqual(parsed.components.reader.lists.wolverine.itemIds, [101, OLD, 102]);
  assert.equal(parsed.components.reader.notes[OLD], 'Disposable note from the old Wolverine guide');
  const tampered = text.replace('Disposable note from the old Wolverine guide', 'Changed note');
  await assert.rejects(parseCompleteBackup(tampered, { cryptoProvider: webcrypto }));
});
