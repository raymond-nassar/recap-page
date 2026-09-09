import test from 'node:test';
import assert from 'node:assert/strict';
import { earlierIssueIds } from '../src/js/lib/reorientation.js';

function state() {
  return {
    lists: { a: { itemIds: [1, 2, 3, 4] }, b: { itemIds: [3, 2] }, empty: { itemIds: [] } },
    issues: {},
    read: { 1: 900, 2: 100, 4: 999 },
    notes: { 2: 'Saved note' },
  };
}

test('445 predecessors use current order, not the newest marker or later read islands', () => {
  const s = state();
  const before = structuredClone(s);
  assert.deepEqual(earlierIssueIds(s, 'a'), [1, 2]);
  assert.equal(earlierIssueIds(s, 'a').at(-1), 2);
  assert.deepEqual(s, before);
});

test('445 completed, empty, missing and first-unread lists have explicit ranges', () => {
  const s = state();
  s.read[3] = 1;
  assert.deepEqual(earlierIssueIds(s, 'a'), [1, 2, 3, 4]);
  for (const id of ['empty', 'missing']) assert.deepEqual(earlierIssueIds(s, id), []);
  delete s.read[1];
  assert.deepEqual(earlierIssueIds(s, 'a'), []);
});

test('445 overlap, missing metadata and changed order derive only current list membership', () => {
  const s = state();
  assert.deepEqual(earlierIssueIds(s, 'b'), []);
  s.lists.a.itemIds = [2, 1, 3];
  assert.deepEqual(earlierIssueIds(s, 'a'), [2, 1]);
  s.lists.a.itemIds = [2, 3];
  assert.deepEqual(earlierIssueIds(s, 'a'), [2]);
});
