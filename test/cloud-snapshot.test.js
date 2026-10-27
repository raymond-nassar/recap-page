import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  captureCloudContent, createCloudSnapshot, parseCloudSnapshot, prepareCloudRestore, CloudSnapshotError,
  MAX_CLOUD_SNAPSHOT_BYTES,
} from '../src/js/lib/cloudSnapshot.js';
import {
  createEmptyState, createList, addIssuesToList, exportBackup, normalizeIssue,
  MAX_BACKUP_BYTES,
} from '../src/js/lib/model.js';
import { KEY, IMPORT_DRAFT_KEY, PRERESTORE_KEY } from '../src/js/storage.js';
import { LIST_HISTORY_KEY, LIST_HISTORY_FORMAT } from '../src/js/lib/listHistory.js';
import { DRAFT_FORMAT, DRAFT_VERSION, sourceOccurrences } from '../src/js/lib/importDraft.js';
import { availability } from '../src/js/lib/availability.js';
import { applyPreparedCloudRestore } from '../src/js/lib/cloudRestore.js';
import { CloudRestoreSession, CLOUD_RESTORE_MARKER } from '../src/js/lib/cloudSession.js';

const capture = {
  captureId: 'a'.repeat(64), streamId: 'b'.repeat(64), slotId: 'reserved-slot-a', attemptId: 'c'.repeat(64),
  generation: 1, capturedAt: '2026-10-22T00:00:00.000Z', label: 'Synthetic desktop',
};

function fixture() {
  let state = createList(createEmptyState(), { id: '__proto__', name: 'Kept identity' });
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
    records: [{ listId: '__proto__', created: state.lists.__proto__.created, catalogId: null,
      completedAt: 12345, rating: 'up' }],
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
    ['mrt.settings', JSON.stringify({
      apiBase: 'https://metadata.example.test/v1', covers: false, theme: 'light', filter: 'deferred',
      readingShortcut: false, hideDescriptions: false, cachePurgeVersion: 99,
    })],
    ['sidebar.collapsed', 'false'],
    [IMPORT_DRAFT_KEY, JSON.stringify(draft)],
    ['mrt.state.salvage', 'PRIVATE_SALVAGE'],
    ['mrt.cloud.credentials', 'PROVIDER_CREDENTIALS_MUST_NOT_BE_READ'],
  ]);
  const storage = {
    getItem(key) { return map.get(key) ?? null; },
    setItem() { assert.fail('capture must never write saved data'); },
    removeItem() { assert.fail('capture must never remove saved data'); },
  };
  return { state, history, draft, map, storage, options: { storage, isBlocked: () => false, cryptoProvider: webcrypto } };
}

test('cloud snapshot round-trips the complete portable inventory without exporting storage or credential identities', async () => {
  const f = fixture();
  const before = [...f.map];
  const held = await captureCloudContent(f.options);
  const encoded = await createCloudSnapshot(held.components, capture);
  const decoded = await parseCloudSnapshot(encoded.text);
  assert.deepEqual(decoded.components, held.components);
  assert.equal(decoded.contentDigest, held.contentDigest);
  assert.deepEqual(decoded.componentDigests, held.componentDigests);
  assert.deepEqual(decoded.components.reader.listOrder, ['__proto__']);
  assert.equal(Object.hasOwn(decoded.components.reader.lists, '__proto__'), true);
  assert.equal(decoded.components.reader.ratings[1], 3.5);
  assert.equal(decoded.components.reader.read[1], 12345);
  assert.equal(decoded.components.reader.read[2], undefined);
  assert.deepEqual(decoded.components.reader.lists.__proto__.deferredIssueIds, [2]);
  assert.equal(decoded.components.reader.notes[2], 'Keep this note');
  assert.equal(decoded.components.history.records[0].rating, 'up');
  assert.equal(decoded.components.settings.sidebarCollapsed, false);
  assert.equal(decoded.components.settings.hideDescriptions, false);
  assert.equal(decoded.components.draft.rawText, f.draft.rawText);
  assert.equal(decoded.components.draft.occurrences.length, 3);
  assert.equal(decoded.components.draft.occurrences[1].choice.issueId, 2);
  assert.deepEqual(decoded.components.draft.previousSources, ['earlier verbatim source']);
  assert.deepEqual([1, 2, 3, 4, 5].map((id) => availability(decoded.components.reader.issues[id], {
    override: decoded.components.reader.overrides[id], today: '2026-10-22',
  }).state), ['unknown', 'scheduled', 'expected', 'override-available', 'override-unavailable']);
  for (const value of ['LOCAL_READER_TOKEN', 'LOCAL_HISTORY_TOKEN', 'LOCAL_DRAFT_REVISION', 'LOCAL_DRAFT_INCARNATION',
    'PRIVATE_SALVAGE', 'PROVIDER_CREDENTIALS_MUST_NOT_BE_READ', 'cachePurgeVersion']) assert(!encoded.text.includes(value));
  assert.deepEqual([...f.map], before);
});

test('portable content digest ignores storage tokens, timestamps and remote identities but detects saved data changes', async () => {
  const f = fixture();
  const first = await captureCloudContent(f.options);
  const reader = JSON.parse(f.map.get(KEY));
  reader.writeToken = 'REPLACEMENT_TOKEN';
  reader.exportedAt = '2001-01-01T00:00:00.000Z';
  f.map.set(KEY, JSON.stringify(Object.fromEntries(Object.entries(reader).reverse())));
  f.map.set(LIST_HISTORY_KEY, JSON.stringify({ ...f.history, writeToken: 'REPLACEMENT_HISTORY_TOKEN' }));
  f.map.set(IMPORT_DRAFT_KEY, JSON.stringify({
    ...f.draft, incarnation: 'new-incarnation', revision: 'new-revision', readerToken: 'new-reader-token', paused: true,
  }));
  const second = await captureCloudContent(f.options);
  assert.equal(second.contentDigest, first.contentDigest);
  const a = await createCloudSnapshot(first.components, capture);
  const b = await createCloudSnapshot(second.components, {
    ...capture, generation: 45, attemptId: 'd'.repeat(64), capturedAt: '2025-01-01T00:00:00.000Z',
  });
  assert.notEqual(a.text, b.text);
  assert.equal(a.snapshot.contentDigest, b.snapshot.contentDigest);
  reader.notes[2] = 'A deliberate edit';
  f.map.set(KEY, JSON.stringify(reader));
  assert.notEqual((await captureCloudContent(f.options)).contentDigest, first.contentDigest);
});

test('empty installations and intentional draft removal retain explicit absence and default sidebar semantics', async () => {
  const map = new Map();
  const options = { storage: { getItem: (key) => map.get(key) ?? null }, isBlocked: () => false };
  const empty = await captureCloudContent(options);
  assert.equal(empty.components.draft, null);
  assert.equal(empty.components.settings.sidebarCollapsed, null);
  assert.equal(empty.components.settings.theme, 'system');
  assert.equal(empty.components.settings.covers, true);
  map.set('sidebar.collapsed', 'false');
  const expanded = await captureCloudContent(options);
  assert.equal(expanded.components.settings.sidebarCollapsed, false);
  assert.notEqual(empty.contentDigest, expanded.contentDigest);
  const f = fixture();
  const withDraft = await captureCloudContent(f.options);
  f.map.delete(IMPORT_DRAFT_KEY);
  const removed = await captureCloudContent(f.options);
  assert.equal(removed.components.draft, null);
  assert.notEqual(removed.contentDigest, withDraft.contentDigest);
});

test('cloud snapshot refuses unsupported schemas, incomplete components, invalid preferences and changed draft provenance', async () => {
  const f = fixture();
  const { components } = await captureCloudContent(f.options);
  const { snapshot } = await createCloudSnapshot(components, capture);
  for (const change of [
    (value) => { value.version++; },
    (value) => { value.unreviewed = 'unknown'; },
    (value) => { delete value.components.draft; },
    (value) => { value.components.reader = null; },
    (value) => { value.components.reader.schemaVersion++; },
    (value) => { delete value.components.reader.notes; },
    (value) => { value.components.reader.ratings[1] = 3.25; },
    (value) => { value.components.reader.overrides[4] = true; },
    (value) => { value.components.settings.sidebarCollapsed = 'false'; },
    (value) => { value.components.settings.filter = 'future-filter'; },
    (value) => { value.components.settings.theme = 'future-theme'; },
    (value) => { value.components.settings.apiBase = 'http://foreign.example.test'; },
    (value) => { value.components.settings.accessToken = 'not-portable'; },
    (value) => { value.components.history.records.push(value.components.history.records[0]); },
    (value) => { value.components.draft.occurrences[0].line = 900; },
    (value) => { value.components.draft.readerToken = 'not-portable'; },
    (value) => { value.generation = 0; },
  ]) {
    const value = structuredClone(snapshot);
    change(value);
    await assert.rejects(parseCloudSnapshot(JSON.stringify(value)), CloudSnapshotError);
  }
});

test('cloud snapshot rejects byte corruption instead of trusting caller or per-component hash claims', async () => {
  const { components } = await captureCloudContent(fixture().options);
  const { snapshot } = await createCloudSnapshot(components, capture);
  for (const change of [
    (value) => { value.components.reader.notes[2] = 'Changed content'; },
    (value) => { value.contentDigest = 'e'.repeat(64); },
    (value) => { value.componentDigests.settings = 'e'.repeat(64); },
  ]) {
    const altered = structuredClone(snapshot);
    change(altered);
    await assert.rejects(parseCloudSnapshot(JSON.stringify(altered)), (error) => error.code === 'integrity');
  }
  await assert.rejects(createCloudSnapshot(components, capture, { cryptoProvider: {} }),
    (error) => error.code === 'unsupported');
});

test('cloud capture rejects UTF-8 component and aggregate overflow before accepting portable data', async () => {
  const f = fixture();
  f.map.set('mrt.settings', JSON.stringify({ unknown: '\u20ac'.repeat(Math.ceil(MAX_BACKUP_BYTES / 3)) }));
  await assert.rejects(captureCloudContent(f.options), (error) => error.code === 'oversize');
  await assert.rejects(parseCloudSnapshot(' '.repeat(MAX_CLOUD_SNAPSHOT_BYTES + 1)),
    (error) => error.code === 'oversize');
  const { components } = await captureCloudContent(fixture().options);
  const value = {
    ...components.settings, apiBase: 'https://large.example.test/',
  };
  const overhead = new TextEncoder().encode(JSON.stringify(value)).length;
  value.apiBase += 'a'.repeat(MAX_BACKUP_BYTES - overhead);
  assert.equal(new TextEncoder().encode(JSON.stringify(value)).length, MAX_BACKUP_BYTES);
  const exact = await createCloudSnapshot({ ...components, settings: value }, capture);
  assert.equal((await parseCloudSnapshot(exact.text)).components.settings.apiBase, value.apiBase);
  value.apiBase += 'a';
  await assert.rejects(createCloudSnapshot({ ...components, settings: value }, capture),
    (error) => error.code === 'oversize');
});

test('cloud capture rereads after asynchronous hashing and stops after three racing attempts without writing', async () => {
  const f = fixture();
  let hashes = 0;
  const cryptoProvider = { subtle: {
    async digest(algorithm, bytes) {
      if (hashes++ === 0) {
        const changed = JSON.parse(f.map.get(KEY));
        changed.notes[2] = 'Saved during hashing';
        f.map.set(KEY, JSON.stringify(changed));
      }
      return webcrypto.subtle.digest(algorithm, bytes);
    },
  } };
  const result = await captureCloudContent({ ...f.options, cryptoProvider });
  assert.equal(result.components.reader.notes[2], 'Saved during hashing');
  assert.equal(result.witness[KEY], f.map.get(KEY));
  let reads = 0;
  let readerReads = 0;
  const racing = {
    getItem(key) {
      reads++;
      if (key === KEY) {
        readerReads++;
        return JSON.stringify({ ...exportBackup(f.state), writeToken: `changed-${readerReads}` });
      }
      return f.storage.getItem(key);
    },
  };
  await assert.rejects(captureCloudContent({ ...f.options, storage: racing }),
    (error) => error.code === 'raced');
  assert.equal(readerReads, 6, 'three before/after attempts, no unbounded retry');
  assert.equal(reads, 30);
});

test('cloud capture refuses blocked, unreadable and unsettled data without borrowing recovery copies', async () => {
  const f = fixture();
  await assert.rejects(captureCloudContent({ ...f.options, isBlocked: () => true }),
    (error) => error.code === 'blocked');
  await assert.rejects(captureCloudContent({ ...f.options, storage: {
    getItem() { throw new Error('PRIVATE_STORAGE_DETAIL'); },
  } }), (error) => error.code === 'storage' && !error.message.includes('PRIVATE'));
  f.map.set(KEY, '{malformed');
  await assert.rejects(captureCloudContent(f.options), CloudSnapshotError);
  f.map.set(KEY, JSON.stringify(exportBackup(f.state)));
  f.draft.pending = { beforeAbsent: false, beforeToken: null, before: '{}', after: '{}', indices: [0], at: 123 };
  f.map.set(IMPORT_DRAFT_KEY, JSON.stringify(f.draft));
  await assert.rejects(captureCloudContent(f.options), (error) => error.code === 'pending');
  f.map.delete(IMPORT_DRAFT_KEY);
  let blocked = false;
  await assert.rejects(captureCloudContent({
    ...f.options, isBlocked: () => blocked,
    cryptoProvider: { subtle: { async digest(algorithm, bytes) {
      blocked = true;
      return webcrypto.subtle.digest(algorithm, bytes);
    } } },
  }), (error) => error.code === 'blocked');
});

test('composite restore preparation freezes exact owner bytes and recovery effects without performing writes', async () => {
  const f = fixture();
  const { components } = await captureCloudContent(f.options);
  const { text } = await createCloudSnapshot(components, capture);
  const reader = JSON.parse(f.map.get(KEY));
  reader.notes[2] = 'Prior local note';
  f.map.set(KEY, JSON.stringify(reader));
  f.map.set(PRERESTORE_KEY, 'EXACT_PRIOR_RECOVERY_BYTES');
  f.map.set('mrt.state.restore.tmp', 'EXACT_PRIOR_TEMPORARY_BYTES');
  const before = [...f.map];
  const prepared = await prepareCloudRestore({
    text, storage: f.storage, isExclusive: () => true, draftRecovery: ['UNSAVED_PRIOR_SOURCE'],
  });
  assert.deepEqual([...f.map], before);
  const intendedReader = prepared.owners.find((owner) => owner.owner === 'reader');
  assert.equal(intendedReader.before.main, f.map.get(KEY));
  assert.deepEqual(intendedReader.effects.map(({ key }) => key),
    ['mrt.state.restore.tmp', PRERESTORE_KEY, KEY, 'mrt.state.restore.tmp']);
  assert.equal(intendedReader.effects[1].value, f.map.get(KEY));
  assert.equal(intendedReader.effects[1].before, 'EXACT_PRIOR_RECOVERY_BYTES');
  assert.equal(intendedReader.effects[0].before, 'EXACT_PRIOR_TEMPORARY_BYTES');
  assert.equal(intendedReader.effects[3].value, null);
  assert.equal(intendedReader.effects[2].value, intendedReader.value);
  const restoredReader = JSON.parse(intendedReader.value);
  assert.equal(restoredReader.notes[2], 'Keep this note');
  assert.notEqual(restoredReader.writeToken, reader.writeToken);
  assert.equal(new Date(restoredReader.exportedAt).toISOString(), restoredReader.exportedAt);
  const history = prepared.owners.find((owner) => owner.owner === 'history');
  assert.notEqual(JSON.parse(history.value).writeToken, f.history.writeToken);
  const draft = JSON.parse(prepared.owners.find((owner) => owner.owner === 'draft').value);
  assert.equal(draft.paused, true);
  assert.equal(draft.pending, null);
  assert.equal(draft.readerToken, null);
  assert.notEqual(draft.revision, f.draft.revision);
  assert.notEqual(draft.incarnation, f.draft.incarnation);
  assert(draft.previousSources.includes(f.map.get(IMPORT_DRAFT_KEY)));
  assert(draft.previousSources.includes('UNSAVED_PRIOR_SOURCE'));
  const saved = JSON.stringify(prepared);
  assert.deepEqual(JSON.parse(saved), prepared, 'the journal can retain exact prepared bytes rather than regenerating them');
});

test('full restore preparation represents absent draft and unset sidebar as guarded explicit removals', async () => {
  const f = fixture();
  const { components } = await captureCloudContent(f.options);
  components.draft = null;
  components.settings.sidebarCollapsed = null;
  const { text } = await createCloudSnapshot(components, capture);
  const before = [...f.map];
  const prepared = await prepareCloudRestore({
    text, storage: f.storage, isExclusive: () => true, draftRecovery: ['UNSAVED_BEFORE_DRAFT_REMOVAL'],
  });
  const draft = prepared.owners.find((owner) => owner.owner === 'draft');
  assert.equal(draft.value, null);
  assert.deepEqual(draft.retainedSources, ['UNSAVED_BEFORE_DRAFT_REMOVAL']);
  assert.deepEqual(draft.effects, [{ key: IMPORT_DRAFT_KEY, before: f.map.get(IMPORT_DRAFT_KEY), value: null }]);
  const settings = prepared.owners.find((owner) => owner.owner === 'settings');
  assert.deepEqual(settings.effects[1], { key: 'sidebar.collapsed', before: 'false', value: null });
  assert.equal(Object.hasOwn(JSON.parse(settings.effects[0].value), 'sidebarCollapsed'), false);
  assert.equal(prepared.before[IMPORT_DRAFT_KEY], f.map.get(IMPORT_DRAFT_KEY));
  assert.deepEqual([...f.map], before);
});

test('expanded draft source preservation fails preparation before any earlier component is replaced', async () => {
  const f = fixture();
  const { components } = await captureCloudContent(f.options);
  components.draft.previousSources = ['p'.repeat(MAX_BACKUP_BYTES - 4096)];
  const { text } = await createCloudSnapshot(components, capture);
  const local = {
    ...f.draft, rawText: `${'x'.repeat(MAX_BACKUP_BYTES / 2)}\n${f.draft.rawText}`,
  };
  local.occurrences = sourceOccurrences(local.rawText);
  f.map.set(IMPORT_DRAFT_KEY, JSON.stringify(local));
  const before = [...f.map];
  await assert.rejects(prepareCloudRestore({ text, storage: f.storage, isExclusive: () => true }),
    (error) => error.code === 'preparation');
  assert.deepEqual([...f.map], before);
});

test('restore preparation refuses a missing exclusive lease and any stale prior-value witness', async () => {
  const f = fixture();
  const { components } = await captureCloudContent(f.options);
  const { text } = await createCloudSnapshot(components, capture);
  await assert.rejects(prepareCloudRestore({ text, storage: f.storage, isExclusive: () => false }),
    (error) => error.code === 'blocked');
  let reads = 0;
  const changed = JSON.stringify({ ...JSON.parse(f.map.get(KEY)), writeToken: 'FOREIGN_LOCAL_WRITE' });
  const storage = {
    ...f.storage,
    getItem(key) {
      if (key === KEY && ++reads === 2) f.map.set(KEY, changed);
      return f.storage.getItem(key);
    },
  };
  await assert.rejects(prepareCloudRestore({ text, storage, isExclusive: () => true }),
    (error) => error.code === 'raced');
  assert.equal(f.map.get(KEY), changed);
});

async function applyFixture() {
  const f = fixture();
  const { components } = await captureCloudContent(f.options);
  const { text } = await createCloudSnapshot(components, capture);
  const prepared = await prepareCloudRestore({ text, storage: f.storage, isExclusive: () => true });
  const verified = JSON.stringify(prepared);
  const map = new Map(f.map);
  let writes = 0;
  const storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) { writes++; map.set(key, value); },
    removeItem(key) { writes++; map.delete(key); },
  };
  return {
    prepared, verified, map, storage, writes: () => writes,
    guards: { storage, isExclusive: () => true,
      isJournalReady: ({ prepared: value }) => JSON.stringify(value) === verified },
  };
}

test('guarded apply recognizes every owner effect after a write-before-checkpoint crash without minting new bytes', async () => {
  const f = await applyFixture();
  const count = f.prepared.owners.flatMap((owner) => owner.effects).length;
  assert.equal(count, 8);
  for (let step = 0; step < count; step++) {
    const result = applyPreparedCloudRestore(f.prepared, step, f.guards);
    assert.equal(result.ok, true, `effect ${step}: ${result.error}`);
    const writes = f.writes();
    const reopened = JSON.parse(f.verified);
    const recognized = applyPreparedCloudRestore(reopened, step, f.guards);
    assert.equal(recognized.ok, true, `checkpoint recovery ${step}: ${recognized.error}`);
    assert.equal(recognized.alreadyApplied, true);
    assert.equal(f.writes(), writes);
  }
  const [reader, history, settings, draft] = f.prepared.owners;
  assert.equal(f.map.get(KEY), reader.value);
  assert.equal(f.map.get(LIST_HISTORY_KEY), history.value);
  assert.equal(f.map.get('mrt.settings'), settings.effects[0].value);
  assert.equal(f.map.get(IMPORT_DRAFT_KEY), draft.value);
  assert.equal(f.map.has('mrt.state.restore.tmp'), false);
  assert.equal(f.map.get('mrt.cloud.credentials'), 'PROVIDER_CREDENTIALS_MUST_NOT_BE_READ');
});

test('prepared apply never writes without both the exact verified journal and the exclusive session', async () => {
  const f = await applyFixture();
  for (const guard of [
    { isExclusive: () => false }, { isJournalReady: () => false },
    { isJournalReady: undefined }, { isExclusive: () => Promise.resolve(true) },
  ]) {
    const result = applyPreparedCloudRestore(f.prepared, 0, { ...f.guards, ...guard });
    assert.equal(result.ok, false);
    assert.equal(result.changed, false);
    assert.equal(f.writes(), 0);
    assert(result.error);
  }
  const changed = structuredClone(f.prepared);
  changed.captureId = 'f'.repeat(64);
  assert.equal(applyPreparedCloudRestore(changed, 0, f.guards).ok, false);
  assert.equal(f.writes(), 0);
});

test('prepared apply refuses foreign local edits and unsupported key or byte substitutions', async () => {
  const f = await applyFixture();
  for (const change of [
    (value) => { value.owners[1].effects[0].key = 'mrt.cloud.credentials'; },
    (value) => { value.owners[0].effects[2].value = '{}'; },
    (value) => { value.before.arbitrary = null; },
    (value) => { value.owners[3].value = null; },
  ]) {
    const altered = structuredClone(f.prepared);
    change(altered);
    const result = applyPreparedCloudRestore(altered, 0, { ...f.guards, isJournalReady: () => true });
    assert.equal(result.ok, false);
    assert.equal(f.writes(), 0);
  }
  f.map.set(KEY, 'FOREIGN_SAVED_EDIT');
  const conflict = applyPreparedCloudRestore(f.prepared, 0, f.guards);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.changed, false);
  assert.equal(f.map.get(KEY), 'FOREIGN_SAVED_EDIT');
  assert.equal(f.writes(), 0);
});

test('failed or unknown prepared writes retain recovery and become recognizable only after exact reread', async () => {
  for (const mode of ['silent', 'throw', 'foreign', 'unreadable']) {
    const f = await applyFixture();
    let attempted = false;
    let unreadable = false;
    const storage = {
      ...f.storage,
      getItem(key) {
        if (unreadable) throw new Error('PRIVATE_READBACK_DETAIL');
        return f.storage.getItem(key);
      },
      setItem(key, value) {
        attempted = true;
        if (mode === 'throw') throw new Error('PRIVATE_WRITE_DETAIL');
        if (mode === 'silent') return;
        f.storage.setItem(key, mode === 'foreign' ? 'FOREIGN_SAVED_VALUE' : value);
        if (mode === 'unreadable') unreadable = true;
      },
    };
    const failed = applyPreparedCloudRestore(f.prepared, 0, { ...f.guards, storage });
    assert.equal(attempted, true);
    assert.equal(failed.ok, false);
    assert.equal(failed.changed, ['silent', 'throw'].includes(mode) ? false : null);
    assert(!failed.error.includes('PRIVATE'));
    assert.equal(f.map.get(KEY), f.prepared.before[KEY]);
    if (mode === 'unreadable') {
      unreadable = false;
      const writes = f.writes();
      const recovered = applyPreparedCloudRestore(JSON.parse(f.verified), 0, { ...f.guards, storage });
      assert.equal(recovered.ok, true);
      assert.equal(recovered.alreadyApplied, true);
      assert.equal(f.writes(), writes);
    }
  }
});

test('explicit prior recovery reverses only known applied effects and preserves exact pre-restore values', async () => {
  const f = await applyFixture();
  for (let step = 0; step <= 5; step++) assert.equal(applyPreparedCloudRestore(f.prepared, step, f.guards).ok, true);
  for (let step = 5; step >= 0; step--) {
    const result = applyPreparedCloudRestore(f.prepared, step, { ...f.guards, direction: 'prior' });
    assert.equal(result.ok, true, result.error);
  }
  for (const [key, value] of Object.entries(f.prepared.before)) assert.equal(f.storage.getItem(key), value);
  assert.equal(f.map.get('mrt.cloud.credentials'), 'PROVIDER_CREDENTIALS_MUST_NOT_BE_READ');
});

function sessionLocks() {
  const held = new Map();
  return {
    async request(name, options, callback) {
      if (typeof options === 'function') { callback = options; options = {}; }
      const entries = held.get(name) ?? [];
      const mode = options.mode ?? 'exclusive';
      if (entries.some((entry) => entry.mode === 'exclusive' || mode === 'exclusive')) {
        if (options.ifAvailable) return callback(null);
        throw new Error('Unexpected waiting lock in fixture');
      }
      const entry = { mode };
      entries.push(entry);
      held.set(name, entries);
      try { return await callback({ name, mode }); }
      finally { entries.splice(entries.indexOf(entry), 1); }
    },
  };
}

async function journalFixture() {
  const f = await applyFixture();
  let record = null;
  let failPut = 0;
  let puts = 0;
  let failDelete = false;
  const journal = {
    async read() { return structuredClone(record); },
    async put(value) {
      if (++puts === failPut) throw new Error('Injected journal checkpoint failure');
      record = structuredClone(value);
    },
    async remove() {
      if (failDelete) throw new Error('Injected cleanup failure');
      record = null;
      return true;
    },
  };
  const { components } = await captureCloudContent(fixture().options);
  components.reader.notes[2] = 'Restored note';
  const { text } = await createCloudSnapshot(components, capture);
  const locks = sessionLocks();
  const make = () => new CloudRestoreSession({
    storage: f.storage, journal, locks, events: null,
    adopt: async (image) => Object.entries(image).every(([key, value]) => f.storage.getItem(key) === value),
  });
  return { ...f, text, make, journal, locks,
    failCheckpoint(effect) { failPut = puts + 2 + effect; },
    failCleanup() { failDelete = true; },
    repair() { failPut = 0; failDelete = false; },
  };
}

test('real restore session guards synchronous writers and refuses another tab before preparing any journal', async () => {
  const f = await journalFixture();
  const a = f.make(), b = f.make();
  await a.open(); await b.open();
  const prior = [...f.map];
  assert.equal((await a.restore(f.text)).ok, false);
  assert.match(a.state.error, /other app tabs/i);
  assert.equal(await f.journal.read(), null);
  assert.deepEqual([...f.map], prior);
  await b.close();
  assert.equal((await a.restore(f.text)).ok, true);
  assert.equal(JSON.parse(f.storage.getItem(KEY)).notes[2], 'Restored note');
  assert.equal(a.isBlocked(), false);
  assert.equal(f.storage.getItem(CLOUD_RESTORE_MARKER), null);
  assert.equal(await f.journal.read(), null);
  await a.close();
});

test('durable controller recovers all eight write-before-checkpoint faults after reload without regenerating bytes', async () => {
  for (let effect = 0; effect < 8; effect++) {
    const f = await journalFixture();
    const session = f.make();
    await session.open();
    f.failCheckpoint(effect);
    const result = await session.restore(f.text);
    assert.equal(result.ok, false, `effect ${effect}`);
    assert.equal(session.isBlocked(), true);
    const prior = session.exportPrior();
    const record = await f.journal.read();
    assert(record, `journal ${effect}`);
    assert.throws(() => session.storage.setItem(KEY, '{}'), /recovery|restore/i);
    await session.close();
    f.repair();
    const reopened = f.make();
    await reopened.open();
    assert.equal(reopened.isBlocked(), true);
    assert.equal(reopened.exportPrior(), prior);
    assert.equal(JSON.stringify((await f.journal.read()).prepared), JSON.stringify(record.prepared));
    assert.equal((await reopened.recover(effect % 2 ? 'prior' : 'forward')).ok, true, `recovery ${effect}: ${reopened.state.error}`);
    const expected = effect % 2 ? record.prepared.before
      : Object.assign({}, record.prepared.before, ...record.prepared.owners.flatMap((owner) =>
        owner.effects.map(({ key, value }) => ({ [key]: value }))));
    for (const [key, value] of Object.entries(expected)) assert.equal(f.storage.getItem(key), value, key);
    await reopened.close();
  }
});

test('journal startup, foreign images, failed cleanup and adoption never silently lift the recovery guard', async () => {
  const f = await journalFixture();
  const session = f.make();
  await session.open();
  f.failCleanup();
  assert.equal((await session.restore(f.text)).ok, false);
  assert.equal(session.isBlocked(), true);
  const prior = session.exportPrior();
  f.map.set(KEY, 'FOREIGN_WRITE');
  assert.equal((await session.recover('prior')).ok, false);
  assert.equal(f.map.get(KEY), 'FOREIGN_WRITE');
  assert.equal(session.exportPrior(), prior);
  await session.close();
  const unknown = new CloudRestoreSession({
    storage: f.storage, locks: f.locks, events: null,
    journal: { async read() { throw new Error('Denied'); } },
  });
  await unknown.open();
  assert.equal(unknown.isBlocked(), true);
  assert.throws(() => unknown.storage.removeItem(KEY));
  await unknown.close();
});

test('preflight journal failure makes no local effects; missing locks disables restore without blocking an empty journal', async () => {
  const f = await journalFixture();
  const before = [...f.map];
  const denied = new CloudRestoreSession({
    storage: f.storage, locks: f.locks, events: null,
    journal: { read: async () => null, put: async () => { throw new Error('Full'); } },
  });
  await denied.open();
  assert.equal((await denied.restore(f.text)).ok, false);
  assert.deepEqual([...f.map], before);
  assert.equal(denied.isBlocked(), false);
  await denied.close();
  const unsupported = new CloudRestoreSession({ storage: f.storage, locks: null, journal: f.journal, events: null });
  await unsupported.open();
  assert.equal(unsupported.isReady(), false);
  assert.equal(unsupported.isBlocked(), false);
  assert.equal((await unsupported.restore(f.text)).ok, false);
  await unsupported.close();
  f.map.set(CLOUD_RESTORE_MARKER, 'unreadable-marker');
  const unknown = f.make();
  await unknown.open();
  assert.equal(unknown.isBlocked(), true);
  assert.equal((await unknown.recover('forward')).ok, false);
  await unknown.close();
});

test('runtime adoption refusal retains exact recovery; retained source order is verified without regenerating a draft', async () => {
  const f = await journalFixture();
  const session = f.make();
  await session.open();
  session.adopt = async () => false;
  assert.equal((await session.restore(f.text, { draftRecovery: ['UNSAVED_A', 'UNSAVED_B'] })).ok, false);
  assert.equal(session.isBlocked(), true);
  const record = await f.journal.read();
  const draft = JSON.parse(record.prepared.owners[3].value);
  assert.deepEqual(draft.previousSources.slice(-3), ['UNSAVED_A', 'UNSAVED_B', record.prepared.before[IMPORT_DRAFT_KEY]]);
  session.adopt = async () => true;
  assert.equal((await session.recover('forward')).ok, true);
  assert.equal(f.storage.getItem(IMPORT_DRAFT_KEY), record.prepared.owners[3].value);
  await session.close();
});

test('a malformed journal never becomes a trusted prior download or a permission to replace local values', async () => {
  const f = await journalFixture();
  const session = f.make();
  await session.open();
  f.failCleanup();
  await session.restore(f.text);
  const record = await f.journal.read();
  await session.close();
  record.candidate = '{}';
  await f.journal.put(record);
  const reopened = f.make();
  await reopened.open();
  const before = [...f.map];
  assert.equal(reopened.isBlocked(), true);
  assert.equal(reopened.recoverable, false);
  assert.throws(() => reopened.exportPrior(), /not verified/);
  assert.equal((await reopened.recover('forward')).ok, false);
  assert.deepEqual([...f.map], before);
  await reopened.close();
});
