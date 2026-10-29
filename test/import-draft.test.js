import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAFT_FORMAT, DRAFT_VERSION, sourceOccurrences, validateImportDraft,
  importProjection, pendingOutcome, listSignature,
} from '../src/js/lib/importDraft.js';
import { createEmptyState, createList, addIssuesToList, markRead, MAX_BACKUP_BYTES } from '../src/js/lib/model.js';

function sample(rawText = '# Raw\r\n\r\nprose\r\n- [x] [One](https://www.marvel.com/comics/issue/1/)\r\n- [ ] Two\u00a0#2\r\n') {
  return {
    format: DRAFT_FORMAT, version: DRAFT_VERSION, rawText, occurrences: sourceOccurrences(rawText),
    incarnation: 'local', revision: 'r1', previousSources: [],
    destination: { id: 'dest', created: 1, name: 'Raw', newList: true, prefix: [] },
    expected: null, readerToken: null, paused: false, pending: null,
  };
}

test('draft validator preserves verbatim physical provenance and refuses invalid or over-limit input', () => {
  const draft = sample();
  const restored = validateImportDraft(JSON.stringify(draft));
  assert.equal(restored.rawText, draft.rawText);
  const legacy = sample('- [x] [Saved reader](https://read.marvel.com/#/book/129648)\n- [ ] [Old invalid link](https://read.marvel.com/)');
  legacy.occurrences = sourceOccurrences(legacy.rawText, { legacyReaderLinks: true });
  assert.deepEqual(validateImportDraft(JSON.stringify(legacy)), legacy, 'previously saved drafts restore without rewriting identity or provenance');
  const fresh = sample(legacy.rawText);
  assert.equal(fresh.occurrences[0].issueId, undefined);
  assert.equal(fresh.occurrences[0].read, true);
  assert.deepEqual(validateImportDraft(JSON.stringify(fresh)), fresh);
  assert.deepEqual(restored.occurrences.map((row) => [row.index, row.line]), [[0, 4], [1, 5]]);
  for (const mutate of [
    (value) => { value.version = 2; },
    (value) => { value.occurrences[1].line = 9; },
    (value) => { value.occurrences[1].choice = { issueId: 0 }; },
    (value) => { value.destination.prefix = [1, 1]; },
    (value) => { value.pending = { indices: [999] }; },
    (value) => { value.occurrences = Array(250001).fill(value.occurrences[0]); },
  ]) {
    const value = structuredClone(draft);
    mutate(value);
    assert.throws(() => validateImportDraft(JSON.stringify(value)));
  }
  assert.throws(() => validateImportDraft(' '.repeat(MAX_BACKUP_BYTES + 1)), /limit/);
  assert.throws(() => sourceOccurrences('- [ ] [Overflow](https://www.marvel.com/comics/issue/999999999999999999/)'), /identity/);
});

test('pending outcome requires unchanged before token and never replays a completed marker after deliberate unread', () => {
  const draft = sample('- [x] [One](https://www.marvel.com/comics/issue/1/)\n- [ ] Gap');
  let before = createList(createEmptyState(), { id: 'dest', name: 'Dest' });
  before = addIssuesToList(before, 'dest', [{ issueId: 1, title: 'One' }]).state;
  draft.destination = { ...draft.destination, created: before.lists.dest.created, newList: false, prefix: [1] };
  draft.expected = listSignature(before.lists.dest);
  const after = markRead(before, 1, true, 10);
  draft.pending = {
    indices: [0], at: 10, before: importProjection(before, draft, [0]),
    after: importProjection(after, draft, [0]), beforeToken: 'before', beforeAbsent: false,
  };
  assert.equal(pendingOutcome(draft, before, 'before', false), 'before');
  assert.equal(pendingOutcome(draft, after, 'after', false), 'after');
  assert.equal(pendingOutcome(draft, markRead(after, 1, false), 'unread', false), 'unknown');
  assert.equal(pendingOutcome(draft, before, null, false), 'unknown');
  assert.equal(pendingOutcome(draft, createEmptyState(), 'other', false), 'unknown');
  assert.equal(after.read[1], 10);
});
// A complete backup, for the refusal pins below and nothing else.
async function completeBackupText() {
  const { createCompleteBackup } = await import('../src/js/lib/completeBackup.js');
  const { createEmptyState: empty, exportBackup: exported } = await import('../src/js/lib/model.js');
  const reader = exported(empty());
  delete reader.exportedAt;
  const settings = { covers: true, theme: 'system', filter: 'all', readingShortcut: true, hideDescriptions: true, sidebarCollapsed: null };
  return (await createCompleteBackup({ reader, history: { format: 'recap-page-list-history', version: 1, records: [] }, settings, draft: null })).text;
}

// Characterization pin, exempt from fail-first by name: the import-draft restore is unchanged since
// 4.2.0 and already refuses a complete backup by its format, without a write.
test('the import-draft restore refuses a complete backup file and writes nothing', async () => {
  const { Store, ImportDraftStore } = await import('../src/js/storage.js');
  const map = new Map();
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) };
  const reader = new Store({ storage });
  reader.load();
  const draft = new ImportDraftStore({ reader, locks: { request: async (_name, operation) => operation() } });
  const result = await draft.restore(await completeBackupText(), draft.capture());
  assert.deepEqual([result.ok, result.changed, result.invalid], [false, false, true]);
  assert.match(result.error, /not a supported import draft file/);
  assert.equal(map.size, 0);
});
