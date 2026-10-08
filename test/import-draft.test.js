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
