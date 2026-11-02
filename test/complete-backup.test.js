// The complete backup file: what it holds, what it refuses, and the exact bytes a restore of it writes.
//
// Ported from the cloud branch's snapshot suite (archived head 4a29920e) and re-derived for the local
// file, which carries no stream, generation or capture identity and leaves the metadata service out.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  COMPLETE_BACKUP_FORMAT, COMPLETE_BACKUP_VERSION, MAX_COMPLETE_BACKUP_BYTES, CompleteBackupError,
  captureCompleteBackup, createCompleteBackup, parseCompleteBackup, prepareCompleteRestore, restorePlan,
  completeBackupFileRefusal, completeBackupSummary, settingsFromStorage, classifyComponent,
} from '../src/js/lib/completeBackup.js';
import {
  createEmptyState, createList, addIssuesToList, exportBackup, normalizeIssue, MAX_BACKUP_BYTES,
} from '../src/js/lib/model.js';
import { KEY, IMPORT_DRAFT_KEY, PRERESTORE_KEY, SETTINGS_KEY, SIDEBAR_KEY, Store, ImportDraftStore } from '../src/js/storage.js';
import { LIST_HISTORY_KEY, LIST_HISTORY_FORMAT, ListHistoryStore } from '../src/js/lib/listHistory.js';
import { DRAFT_FORMAT, DRAFT_VERSION, sourceOccurrences } from '../src/js/lib/importDraft.js';
import { availability } from '../src/js/lib/availability.js';

const crypto = { cryptoProvider: webcrypto };
const API_BASE = 'https://metadata.example.test/v1';
const historicalBackups = JSON.parse(readFileSync(new URL('./fixtures/historical-reader-complete-backups.json', import.meta.url))).fixtures;

test('complete backups from before reader-link withdrawal parse with byte-identical portable content', async () => {
  for (const fixture of historicalBackups) {
    const expected = JSON.parse(fixture.text);
    const parsed = await parseCompleteBackup(fixture.text, crypto);
    assert.deepEqual(JSON.parse(JSON.stringify(parsed)), expected, fixture.name);
    assert.equal((await createCompleteBackup(parsed.components, crypto)).text, fixture.text, 'the complete file remains byte-identical');
  }
});

test('complete backup capture preserves installed historical reader-link drafts and their digest', async () => {
  for (const fixture of historicalBackups) {
    const expected = JSON.parse(fixture.text);
    const map = new Map([
      [KEY, JSON.stringify(expected.components.reader)],
      [IMPORT_DRAFT_KEY, JSON.stringify(fixture.draft)],
    ]);
    const storage = { getItem: (key) => map.get(key) ?? null };
    const captured = await captureCompleteBackup({ storage, ...crypto });
    assert.equal(captured.text, fixture.text, 'capture preserves the baseline portable content and digest');
  }
});

test('complete restore prepares historical reader-link drafts without rewriting source or selections', async () => {
  for (const fixture of historicalBackups) {
    const prepared = prepareCompleteRestore({
      backup: await parseCompleteBackup(fixture.text, crypto), storage: { getItem: () => null }, isExclusive: () => true,
    });
    const restored = JSON.parse(prepared.owners.at(-1).value);
    assert.deepEqual(restored.occurrences, fixture.draft.occurrences);
    assert.equal(restored.rawText, fixture.draft.rawText);
    assert.equal(restored.paused, true);
    assert.equal(restored.pending, null);
    assert.equal(restored.readerToken, null);
    const current = sourceOccurrences(fixture.draft.rawText);
    assert.ok(current.every((entry) => entry.issueId == null), 'new pastes still refuse reader links');
    assert.ok(fixture.draft.occurrences.some((entry) => entry.issueId < 0));
    if (fixture.name === 'unresolved-reader') {
      assert.equal(Object.hasOwn(restored.occurrences[0], 'issueId'), false, 'the malformed historical URL remains unresolved');
      assert.equal(restored.occurrences[0].choice.issueId, 7, 'its explicit selected comic survives');
    }
  }
});

function completeFixture({ created } = {}) {
  let state = createList(createEmptyState(), { id: '__proto__', name: 'Kept identity' });
  // The one clock reading in this fixture, fixed where a test pins exact bytes.
  if (created !== undefined) state.lists.__proto__.created = created;
  state = addIssuesToList(state, '__proto__', [
    { issueId: 1, title: 'One' }, { issueId: 2, title: 'Two', unlimitedDate: '2099-01-01' },
    { issueId: 3, title: 'Three', unlimitedDate: '2000-01-01' },
    { issueId: 4, title: 'Four' }, { issueId: 5, title: 'Five' },
  ]).state;
  state.read[1] = 12345;
  state.overrides = { 4: 'available', 5: 'unavailable' };
  state.ratings[1] = 3.5;
  state.notes[2] = 'Keep this note';
  state.lists.__proto__.note = 'List note';
  state.lists.__proto__.deferredIssueIds = [2];
  const history = {
    format: LIST_HISTORY_FORMAT, version: 1, writeToken: 'LOCAL_HISTORY_TOKEN',
    records: [{ listId: '__proto__', created: state.lists.__proto__.created, catalogId: null, completedAt: 12345, rating: 'up' }],
  };
  const rawText = '# Source\r\n\r\npersonal text\r\n- [x] [One](https://www.marvel.com/comics/issue/1/)\r\n- [ ] Gap\r\n- [ ] [One](https://www.marvel.com/comics/issue/1/)';
  const draft = {
    format: DRAFT_FORMAT, version: DRAFT_VERSION, rawText, occurrences: sourceOccurrences(rawText),
    incarnation: 'LOCAL_DRAFT_INCARNATION', revision: 'LOCAL_DRAFT_REVISION', previousSources: ['earlier verbatim source'],
    destination: { id: 'destination', created: 99, name: 'Source', newList: true, prefix: [] },
    expected: null, readerToken: 'LOCAL_READER_TOKEN', paused: false, pending: null,
  };
  draft.occurrences[1].choice = normalizeIssue({ issueId: 2, title: 'Chosen Two' });
  const map = new Map([
    [KEY, JSON.stringify({ writeToken: 'LOCAL_READER_TOKEN', ...exportBackup(state) })],
    [LIST_HISTORY_KEY, JSON.stringify(history)],
    [SETTINGS_KEY, JSON.stringify({
      apiBase: API_BASE, covers: false, theme: 'light', filter: 'deferred',
      readingShortcut: false, hideDescriptions: false, cachePurge: 99,
    })],
    [SIDEBAR_KEY, 'false'],
    [IMPORT_DRAFT_KEY, JSON.stringify(draft)],
    ['mrt.state.salvage', 'PRIVATE_SALVAGE'],
    ['mrt.unrelated', 'NOT_PART_OF_ANY_BACKUP'],
  ]);
  let writes = 0;
  const storage = {
    map,
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem(key) { return map.get(key) ?? null; },
    setItem(key, value) { writes += 1; map.set(key, String(value)); },
    removeItem(key) { writes += 1; map.delete(key); },
  };
  return { state, history, draft, map, storage, writes: () => writes };
}

test('a complete backup round-trips every component and leaves storage, tokens and the metadata service out', async () => {
  const f = completeFixture();
  const before = [...f.map];
  const { text, backup } = await captureCompleteBackup({ storage: f.storage, ...crypto });
  const decoded = await parseCompleteBackup(text, crypto);
  assert.equal(decoded.format, COMPLETE_BACKUP_FORMAT);
  assert.equal(decoded.version, COMPLETE_BACKUP_VERSION);
  assert.deepEqual(decoded.components, backup.components);
  const { reader, history, settings, draft } = decoded.components;
  assert.deepEqual(reader.listOrder, ['__proto__']);
  assert.equal(Object.hasOwn(reader.lists, '__proto__'), true);
  assert.equal(reader.schemaVersion, 4);
  assert.equal(reader.ratings[1], 3.5);
  assert.equal(reader.read[1], 12345);
  assert.deepEqual(reader.lists.__proto__.deferredIssueIds, [2]);
  assert.equal(reader.notes[2], 'Keep this note');
  assert.equal(history.records[0].rating, 'up');
  assert.deepEqual(settings, {
    covers: false, theme: 'light', filter: 'deferred', readingShortcut: false, hideDescriptions: false, sidebarCollapsed: false,
  });
  assert.equal(draft.rawText, f.draft.rawText);
  assert.equal(draft.occurrences[1].choice.issueId, 2);
  assert.deepEqual(draft.previousSources, ['earlier verbatim source']);
  assert.deepEqual([1, 2, 3, 4, 5].map((id) => availability(reader.issues[id], {
    override: reader.overrides[id], today: '2026-10-28',
  }).state), ['unknown', 'scheduled', 'expected', 'override-available', 'override-unavailable']);
  for (const value of ['LOCAL_READER_TOKEN', 'LOCAL_HISTORY_TOKEN', 'LOCAL_DRAFT_REVISION', 'LOCAL_DRAFT_INCARNATION',
    'PRIVATE_SALVAGE', 'NOT_PART_OF_ANY_BACKUP', 'apiBase', API_BASE, 'cachePurge', 'writeToken', 'exportedAt']) {
    assert(!text.includes(value), `${value} stays out of the file`);
  }
  assert.deepEqual([...f.map], before, 'making a backup writes nothing');
  assert.equal(f.writes(), 0);
});

test('equal saved content gives byte-identical files, and any change gives a different digest', async () => {
  const f = completeFixture();
  const first = await captureCompleteBackup({ storage: f.storage, ...crypto });
  const reader = JSON.parse(f.map.get(KEY));
  reader.writeToken = 'ANOTHER_TOKEN';
  reader.exportedAt = '2001-01-01T00:00:00.000Z';
  f.map.set(KEY, JSON.stringify(Object.fromEntries(Object.entries(reader).reverse())));
  f.map.set(LIST_HISTORY_KEY, JSON.stringify({ ...f.history, writeToken: 'ANOTHER_HISTORY_TOKEN' }));
  f.map.set(IMPORT_DRAFT_KEY, JSON.stringify({ ...f.draft, incarnation: 'other', revision: 'other', readerToken: 'other', paused: true }));
  const second = await captureCompleteBackup({ storage: f.storage, ...crypto });
  assert.equal(second.text, first.text, 'tokens, timestamps, key order and draft lifecycle do not change the file');
  reader.notes[2] = 'A deliberate edit';
  f.map.set(KEY, JSON.stringify(reader));
  const third = await captureCompleteBackup({ storage: f.storage, ...crypto });
  assert.notEqual(third.backup.digest, first.backup.digest);
});

test('an empty installation backs up explicit absences: no draft, and the sidebar left unset', async () => {
  const map = new Map();
  const storage = { getItem: (key) => map.get(key) ?? null };
  const empty = await captureCompleteBackup({ storage, ...crypto });
  assert.equal(empty.backup.components.draft, null);
  assert.equal(empty.backup.components.settings.sidebarCollapsed, null);
  assert.equal(empty.backup.components.settings.theme, 'system');
  assert.equal(empty.backup.components.settings.covers, true);
  assert.equal(empty.backup.components.settings.filter, 'all');
  map.set(SIDEBAR_KEY, 'true');
  const collapsed = await captureCompleteBackup({ storage, ...crypto });
  assert.equal(collapsed.backup.components.settings.sidebarCollapsed, true);
  map.set(SIDEBAR_KEY, 'false');
  const expanded = await captureCompleteBackup({ storage, ...crypto });
  assert.equal(expanded.backup.components.settings.sidebarCollapsed, false);
  assert.equal(new Set([empty, collapsed, expanded].map((each) => each.backup.digest)).size, 3, 'all three sidebar states differ');
  assert.deepEqual(settingsFromStorage('{not json', 'maybe'), {
    covers: true, theme: 'system', filter: 'all', readingShortcut: true, hideDescriptions: true, sidebarCollapsed: null,
  });
});

test('a complete backup refuses unsupported formats, missing components and changed contents', async () => {
  const { backup } = await captureCompleteBackup({ storage: completeFixture().storage, ...crypto });
  for (const change of [
    (value) => { value.version += 1; },
    (value) => { value.format = 'recap-page-cloud-backup'; },
    (value) => { value.unreviewed = 'unknown'; },
    (value) => { delete value.components.draft; },
    (value) => { value.components.reader = null; },
    (value) => { value.components.reader.schemaVersion += 1; },
    (value) => { delete value.components.reader.notes; },
    (value) => { value.components.reader.overrides[4] = true; },
    (value) => { value.components.settings.sidebarCollapsed = 'false'; },
    (value) => { value.components.settings.filter = 'future-filter'; },
    (value) => { value.components.settings.theme = 'future-theme'; },
    (value) => { value.components.settings.apiBase = 'https://elsewhere.example.test'; },
    (value) => { value.components.history.records.push(value.components.history.records[0]); },
    (value) => { value.components.history.writeToken = 'device-only'; },
    (value) => { value.components.draft.occurrences[0].line = 900; },
    (value) => { value.components.draft.readerToken = 'device-only'; },
  ]) {
    const value = structuredClone(backup);
    change(value);
    await assert.rejects(parseCompleteBackup(JSON.stringify(value), crypto), CompleteBackupError);
  }
});

test('a complete backup is refused when any byte of its content differs from its digest', async () => {
  const { backup } = await captureCompleteBackup({ storage: completeFixture().storage, ...crypto });
  for (const change of [
    (value) => { value.components.reader.notes[2] = 'Changed content'; },
    (value) => { value.components.settings.covers = true; },
    (value) => { value.components.draft.previousSources = []; },
    (value) => { value.digest = 'e'.repeat(64); },
  ]) {
    const altered = structuredClone(backup);
    change(altered);
    await assert.rejects(parseCompleteBackup(JSON.stringify(altered), crypto), (error) => error.code === 'integrity');
  }
  await assert.rejects(createCompleteBackup(backup.components, { cryptoProvider: {} }), (error) => error.code === 'unsupported');
});

test('single-kind backups and other files are refused by name, so the reader knows where each belongs', async () => {
  const f = completeFixture();
  const cases = [
    [JSON.stringify(exportBackup(f.state)), /reading-data backup/],
    [JSON.stringify(f.history), /completion-history backup/],
    [f.map.get(IMPORT_DRAFT_KEY), /import-draft backup/],
    [JSON.stringify({ format: 'recap-page-complete-restore-prior', version: 1 }), /prior copy/],
    [JSON.stringify({ format: COMPLETE_BACKUP_FORMAT, version: 2 }), /newer version/],
    ['[]', /not a complete backup/],
    ['{not json', /not readable JSON/],
  ];
  for (const [text, message] of cases) {
    await assert.rejects(parseCompleteBackup(text, crypto), (error) => error instanceof CompleteBackupError && message.test(error.message));
  }
});

test('the complete file has a 32 MiB ceiling of its own, and the 8 MiB single-kind limit is unchanged', async () => {
  assert.equal(MAX_COMPLETE_BACKUP_BYTES, 32 * 1024 * 1024);
  assert.equal(MAX_BACKUP_BYTES, 8 * 1024 * 1024);
  await assert.rejects(parseCompleteBackup(' '.repeat(MAX_COMPLETE_BACKUP_BYTES + 1), crypto), (error) => error.code === 'oversize');
  assert.equal(completeBackupFileRefusal({ size: MAX_COMPLETE_BACKUP_BYTES }), null);
  assert.match(completeBackupFileRefusal({ size: MAX_COMPLETE_BACKUP_BYTES + 1 }), /32 MiB/);
  assert.equal(completeBackupFileRefusal({ size: MAX_BACKUP_BYTES + 1 }), null, 'a file between the two limits is read');
  const { backup } = await captureCompleteBackup({ storage: completeFixture().storage, ...crypto });
  const huge = structuredClone(backup.components);
  huge.draft.previousSources = ['p'.repeat(MAX_BACKUP_BYTES)];
  await assert.rejects(createCompleteBackup(huge, crypto), (error) => error.code === 'oversize');
});

test('capture refuses unreadable data and an unsettled import without writing, and rereads a racing save', async () => {
  const f = completeFixture();
  f.map.set(KEY, '{malformed');
  await assert.rejects(captureCompleteBackup({ storage: f.storage, ...crypto }), (error) => error.code === 'unreadable');
  f.map.set(KEY, JSON.stringify(exportBackup(f.state)));
  f.map.set(IMPORT_DRAFT_KEY, JSON.stringify({ ...f.draft, pending: { beforeAbsent: false, beforeToken: null, before: '{}', after: '{}', indices: [0], at: 1 } }));
  await assert.rejects(captureCompleteBackup({ storage: f.storage, ...crypto }), (error) => error.code === 'pending');
  f.map.delete(IMPORT_DRAFT_KEY);
  let digests = 0;
  const cryptoProvider = { subtle: { async digest(algorithm, bytes) {
    if (digests++ === 0) {
      const changed = JSON.parse(f.map.get(KEY));
      changed.notes[2] = 'Saved during the digest';
      f.map.set(KEY, JSON.stringify(changed));
    }
    return webcrypto.subtle.digest(algorithm, bytes);
  } } };
  const raced = await captureCompleteBackup({ storage: f.storage, cryptoProvider });
  assert.equal(raced.backup.components.reader.notes[2], 'Saved during the digest');
  let reads = 0;
  const racing = { getItem(key) { reads += 1; return key === KEY ? JSON.stringify({ ...exportBackup(f.state), writeToken: `w${reads}` }) : f.storage.getItem(key); } };
  await assert.rejects(captureCompleteBackup({ storage: racing, ...crypto }), (error) => error.code === 'raced');
  assert.equal(reads, 30, 'three attempts, each read before and after, then a refusal rather than an endless retry');
  assert.equal(f.writes(), 0);
});

test('preparation freezes every owner\'s exact bytes, keeps the metadata service, and writes nothing', async () => {
  const f = completeFixture();
  const { backup } = await captureCompleteBackup({ storage: f.storage, ...crypto });
  const reader = JSON.parse(f.map.get(KEY));
  reader.notes[2] = 'Prior local note';
  f.map.set(KEY, JSON.stringify(reader));
  f.map.set(PRERESTORE_KEY, 'EXACT_PRIOR_SAVED_COPY');
  f.map.set('mrt.state.restore.tmp', 'EXACT_PRIOR_STAGE');
  f.map.set(SETTINGS_KEY, JSON.stringify({ apiBase: API_BASE, covers: true, theme: 'dark', filter: 'all', readingShortcut: true, hideDescriptions: true, cachePurge: 99 }));
  f.map.set(SIDEBAR_KEY, 'true');
  const before = [...f.map];
  const prepared = prepareCompleteRestore({ backup, storage: f.storage, isExclusive: () => true, draftRecovery: ['UNSAVED_SOURCE'] });
  assert.deepEqual([...f.map], before);
  assert.equal(f.writes(), 0);
  const [readerOwner, historyOwner, settingsOwner, draftOwner] = prepared.owners;
  assert.deepEqual(readerOwner.effects.map(({ key }) => key), ['mrt.state.restore.tmp', PRERESTORE_KEY, KEY, 'mrt.state.restore.tmp']);
  assert.equal(readerOwner.effects[0].before, 'EXACT_PRIOR_STAGE');
  assert.equal(readerOwner.effects[1].before, 'EXACT_PRIOR_SAVED_COPY');
  assert.equal(readerOwner.effects[1].value, f.map.get(KEY), 'the replaced reading data becomes the saved copy');
  assert.equal(readerOwner.effects[3].value, null);
  const restoredReader = JSON.parse(readerOwner.value);
  assert.equal(restoredReader.notes[2], 'Keep this note');
  assert.notEqual(restoredReader.writeToken, reader.writeToken);
  assert.notEqual(JSON.parse(historyOwner.value).writeToken, f.history.writeToken);
  const settings = JSON.parse(settingsOwner.effects[0].value);
  assert.equal(settings.apiBase, API_BASE, 'the metadata service is left as saved');
  assert.equal(settings.cachePurge, 99, 'fields the file does not carry are left as saved');
  assert.deepEqual([settings.covers, settings.theme, settings.filter], [false, 'light', 'deferred']);
  assert.deepEqual(settingsOwner.effects[1], { key: SIDEBAR_KEY, before: 'true', value: 'false' });
  const draft = JSON.parse(draftOwner.value);
  assert.equal(draft.paused, true);
  assert.equal(draft.pending, null);
  assert.equal(draft.readerToken, null);
  assert.equal(draft.expected, null);
  assert.notEqual(draft.revision, f.draft.revision);
  assert.ok(draft.previousSources.includes(f.map.get(IMPORT_DRAFT_KEY)), 'the displaced draft is kept inside the restored one');
  assert.ok(draft.previousSources.includes('UNSAVED_SOURCE'), 'unsaved source this tab holds is kept too');
  assert.deepEqual(JSON.parse(JSON.stringify(prepared)), prepared, 'the journal can hold the exact bytes');
  const plan = restorePlan(prepared, backup);
  assert.deepEqual(plan.components.map((c) => c.effects.length), [4, 1, 2, 1]);
  assert.deepEqual(plan.components.map((c) => classifyComponent(f.storage, c).status), ['prior', 'prior', 'prior', 'prior']);
});

test('settings the file leaves alone keep their exact bytes, and a missing draft or unset sidebar is a removal', async () => {
  const f = completeFixture();
  const { backup } = await captureCompleteBackup({ storage: f.storage, ...crypto });
  const same = prepareCompleteRestore({ backup, storage: f.storage, isExclusive: () => true });
  assert.equal(same.owners[2].effects[0].value, f.map.get(SETTINGS_KEY), 'unchanged settings are not rewritten');
  const empty = structuredClone(backup.components);
  empty.draft = null;
  empty.settings.sidebarCollapsed = null;
  const other = await createCompleteBackup(empty, crypto);
  const prepared = prepareCompleteRestore({ backup: other.backup, storage: f.storage, isExclusive: () => true, draftRecovery: ['UNSAVED'] });
  assert.deepEqual(prepared.owners[3].effects, [{ key: IMPORT_DRAFT_KEY, before: f.map.get(IMPORT_DRAFT_KEY), value: null }]);
  assert.deepEqual(prepared.owners[3].retainedSources, ['UNSAVED']);
  assert.deepEqual(prepared.owners[2].effects[1], { key: SIDEBAR_KEY, before: 'false', value: null });
  assert.equal(completeBackupSummary(other.backup).draft, false);
  assert.deepEqual(completeBackupSummary(backup), { lists: 1, records: 1, draft: true });
});

test('a draft over its limit once displaced source is kept refuses the whole restore before any write', async () => {
  const f = completeFixture();
  const { backup } = await captureCompleteBackup({ storage: f.storage, ...crypto });
  const components = structuredClone(backup.components);
  components.draft.previousSources = ['p'.repeat(MAX_BACKUP_BYTES - 8192)];
  const large = await createCompleteBackup(components, crypto);
  const local = { ...f.draft, rawText: `${'x'.repeat(MAX_BACKUP_BYTES / 2)}\n${f.draft.rawText}` };
  local.occurrences = sourceOccurrences(local.rawText);
  f.map.set(IMPORT_DRAFT_KEY, JSON.stringify(local));
  const before = [...f.map];
  assert.throws(() => prepareCompleteRestore({ backup: large.backup, storage: f.storage, isExclusive: () => true }),
    (error) => error.code === 'preparation');
  assert.deepEqual([...f.map], before);
  assert.equal(f.writes(), 0);
});

test('preparation refuses without the exclusive lock and when saved data changes under it', async () => {
  const f = completeFixture();
  const { backup } = await captureCompleteBackup({ storage: f.storage, ...crypto });
  assert.throws(() => prepareCompleteRestore({ backup, storage: f.storage, isExclusive: () => false }), (error) => error.code === 'blocked');
  let reads = 0;
  const changed = JSON.stringify({ ...JSON.parse(f.map.get(KEY)), writeToken: 'ANOTHER_TAB' });
  const storage = { ...f.storage, getItem(key) { if (key === KEY && ++reads === 2) f.map.set(KEY, changed); return f.storage.getItem(key); } };
  assert.throws(() => prepareCompleteRestore({ backup, storage, isExclusive: () => true }), (error) => error.code === 'raced');
  assert.equal(f.map.get(KEY), changed);
});

test('a prepared record that differs from its file in any written byte is never trusted', async () => {
  const f = completeFixture();
  const { backup } = await captureCompleteBackup({ storage: f.storage, ...crypto });
  const prepared = prepareCompleteRestore({ backup, storage: f.storage, isExclusive: () => true });
  for (const change of [
    (value) => { value.owners[0].value = value.owners[0].value.replace('Keep this note', 'Planted'); },
    (value) => { value.owners[0].effects[2].value = '{}'; },
    (value) => { value.owners[1].effects[0].key = 'mrt.unrelated'; },
    (value) => { value.owners[2].effects[0].value = value.owners[2].effects[0].value.replace(API_BASE, 'https://elsewhere.example.test'); },
    (value) => { value.owners[3].value = null; },
    (value) => { value.before.arbitrary = null; },
    (value) => { value.digest = 'f'.repeat(64); },
  ]) {
    const altered = structuredClone(prepared);
    change(altered);
    assert.throws(() => restorePlan(altered, backup), (error) => error.code === 'journal');
  }
});

// Characterization pins: the single-kind exports are unchanged by this feature, so these pass on the
// parent commit by design and are exempt from the fail-first rule. Each expected value is the SHA-256 of
// the exact bytes the v4.2.0 tag's own code (13d43f14) writes for this saved data, with the export time
// fixed: reading data as its download is serialized, completion history, and the import draft both as
// stored and with unsaved source this page still holds. Measured on 2026-10-28.
test('single-kind exports keep the exact bytes v4.2.0 writes for the same saved data', () => {
  const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
  const f = completeFixture({ created: 1700000000000 });
  const reader = new Store({ storage: f.storage });
  reader.load();
  const exported = exportBackup(reader.state);
  exported.exportedAt = '2026-10-28T00:00:00.000Z';
  assert.equal(sha256(JSON.stringify(exported, null, 2)), '5b50a4ba4cea15b002d10bd555209aa9443c3a90e86a4ea42931a715acca5dd2');
  const history = new ListHistoryStore({ readerStore: reader, locks: null });
  history.load();
  assert.equal(history.exportBackup(), JSON.stringify({ format: LIST_HISTORY_FORMAT, version: 1, records: f.history.records }));
  assert.equal(sha256(history.exportBackup()), '3c41eca79ff976c6f288583344fa7226bce6960707f800bdd32daa98581c6d8a');
  const draft = new ImportDraftStore({ reader, locks: null });
  assert.equal(sha256(draft.exportText()), 'e3aba20da8540c6e849c9be4217ea6feaf65e343973dc1e7a7056f6a772b12d7');
  draft.recovery = [JSON.stringify({ ...f.draft, revision: 'UNSAVED_REVISION', previousSources: [] })];
  assert.equal(sha256(draft.exportText()), 'a875d443aad3d97da10cd3425b29df8705a054e64987d899f0b4912dfb839c84');
  assert.equal(f.writes(), 0);
});

// Source this page could not save is held only by the import-draft store, never in storage, so a file
// read from storage would leave it out while the card says the file holds everything.
test('the complete download refuses while this page holds import source it could not save', async () => {
  const f = completeFixture();
  for (const importDraft of [{ recovery: ['unsaved source'], uncertain: false }, { recovery: [], uncertain: true }]) {
    await assert.rejects(captureCompleteBackup({ storage: f.storage, importDraft, ...crypto }), (error) => error instanceof CompleteBackupError
      && error.code === 'unsaved' && error.message.includes('Download it with Download import-draft backup instead.'), JSON.stringify(importDraft));
  }
  const { backup } = await captureCompleteBackup({ storage: f.storage, importDraft: { recovery: [], uncertain: false }, ...crypto });
  assert.equal(backup.components.draft.rawText, f.draft.rawText, 'with nothing unsaved, the stored draft is captured as before');
  assert.equal(f.writes(), 0);
});

test('complete backup digest refusals name the app on iOS and preserve browser wording on web', async () => {
  const { backup } = await captureCompleteBackup({ storage: completeFixture().storage, ...crypto });
  const originalDocument = globalThis.document;
  try {
    globalThis.document = { documentElement: { dataset: { platform: 'ios' } } };
    await assert.rejects(createCompleteBackup(backup.components, { cryptoProvider: {} }), (error) => error instanceof CompleteBackupError
      && error.message === 'This app cannot check backup digests, so complete backups are unavailable here.');

    delete globalThis.document;
    await assert.rejects(createCompleteBackup(backup.components, { cryptoProvider: {} }), (error) => error instanceof CompleteBackupError
      && error.message === 'This browser cannot check backup digests, so complete backups are unavailable here.');
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
