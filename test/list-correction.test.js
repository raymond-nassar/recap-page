import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  applyListRevision, compareListOrders, matchesEarlierPublishedOrder, publishedRevisionItems, revisedOrderKeepingExtras,
} from '../src/js/lib/listCorrection.js';
import {
  addIssuesToList, createEmptyState, createList, markRead, setDeferred, setIssueNote,
  setIssueRating, setListNote, setOverride,
} from '../src/js/lib/model.js';
import { beforeWolverineCorrectionIssueIds } from './helpers/wolverine-correction-history.mjs';

test('a list update comparison preserves the identity and order of each side', () => {
  const saved = [1, 7, 2, 9];
  const revised = [2, 3, 1, 4];
  assert.deepEqual(compareListOrders(saved, revised), {
    added: [3, 4],
    retained: [7, 9],
    reordered: true,
  });
  assert.deepEqual(saved, [1, 7, 2, 9]);
  assert.deepEqual(revised, [2, 3, 1, 4]);
  assert.deepEqual(compareListOrders([1, 2], [1, 3, 2]), {
    added: [3], retained: [], reordered: false,
  });
  assert.deepEqual(compareListOrders([1, 2], [1, 2]), {
    added: [], retained: [], reordered: false,
  });
});

test('a list update comparison refuses invalid or duplicate identities', () => {
  for (const [saved, revised] of [
    [[1, 1], [1]],
    [[1], [1, 1]],
    [[0], [1]],
    [[1], [Number.MAX_SAFE_INTEGER + 1]],
    [[1], []],
    [null, [1]],
  ]) {
    assert.throws(() => compareListOrders(saved, revised), /identity|order/i);
  }
});

test('updating follows the new order without dropping saved comics and is repeatable', () => {
  const saved = [1, 7, 2, 9];
  const revised = [2, 3, 1, 4];
  const updated = revisedOrderKeepingExtras(saved, revised);
  assert.deepEqual(updated, [7, 2, 3, 1, 4, 9]);
  assert.deepEqual(revisedOrderKeepingExtras(updated, revised), updated);
  assert.deepEqual(revisedOrderKeepingExtras([8, 9], [1, 2]), [1, 2, 8, 9]);
  assert.deepEqual(revisedOrderKeepingExtras([], [1]), [1]);
  const many = Array.from({ length: 130000 }, (_, index) => index + 2);
  const large = revisedOrderKeepingExtras([...many, 1], [1, 200000]);
  assert.equal(large.length, 130002);
  assert.deepEqual(large.slice(0, 3), [2, 3, 4]);
  assert.deepEqual(large.slice(-3), [130001, 1, 200000]);
});

test('a revision retains list and comic data by identity and rejects a stale review', () => {
  let state = createList(createEmptyState(), { id: '__proto__', name: 'Kept', catalogId: 'example' });
  state = addIssuesToList(state, '__proto__', [
    { issueId: 1, title: 'Saved one', collectedIn: 'Book' },
    { issueId: 7, title: 'Retired' },
    { issueId: 2, title: 'Saved two' },
  ]).state;
  state = markRead(state, 7, true, 123);
  state = setIssueNote(state, 7, 'Remember');
  state = setIssueRating(state, 7, 4.5);
  state = setOverride(state, 7, 'unavailable');
  state = setDeferred(state, '__proto__', 7);
  state = setListNote(state, '__proto__', 'My list note');
  const expected = JSON.stringify(state.lists.__proto__);
  const revision = [
    { issueId: 2, title: 'Different metadata' },
    { issueId: 3, title: 'New', collectedIn: 'New book' },
    { issueId: 1, title: 'Also different' },
  ];
  const updated = applyListRevision(state, '__proto__', expected, revision);
  assert.deepEqual(updated.lists.__proto__.itemIds, [7, 2, 3, 1]);
  assert.equal(Object.getPrototypeOf(updated.lists), null);
  assert.equal(updated.lists.__proto__.note, 'My list note');
  assert.deepEqual(updated.lists.__proto__.collectedIn, { 1: 'Book', 3: 'New book' });
  assert.deepEqual(updated.lists.__proto__.deferredIssueIds, [7]);
  assert.deepEqual(updated.issues[1], state.issues[1]);
  assert.deepEqual(updated.issues[2], state.issues[2]);
  assert.equal(updated.issues[3].title, 'New');
  for (const key of ['read', 'notes', 'ratings', 'overrides']) assert.deepEqual(updated[key], state[key]);
  assert.equal(updated.read[7], 123);
  assert.equal(applyListRevision(updated, '__proto__', JSON.stringify(updated.lists.__proto__), revision), updated);
  assert.throws(() => applyListRevision(updated, '__proto__', expected, revision), /changed/i);
  assert.throws(() => applyListRevision(state, 'missing', expected, revision), /changed/i);
  const withoutTitle = applyListRevision(state, '__proto__', expected, [{ issueId: 5 }]);
  assert.equal(withoutTitle.issues[5].title, 'Issue 5');
});

test('the Wolverine revision comparison uses identities, including reordered shared comics', () => {
  const payload = JSON.parse(readFileSync(new URL('../src/data/wolverine_reading_order.json', import.meta.url)));
  const revised = payload.items.map(({ issueId }) => issueId);
  const saved = beforeWolverineCorrectionIssueIds(revised).map(Number);
  const diff = compareListOrders(saved, revised);
  assert.equal(diff.added.length, 69);
  assert.equal(diff.retained.length, 4);
  assert.equal(diff.reordered, true);
  assert.deepEqual(compareListOrders(revised, revised), { added: [], retained: [], reordered: false });
  assert.equal(matchesEarlierPublishedOrder({ catalogId: 'wolverine-reading-order', itemIds: saved }), true);
  assert.equal(matchesEarlierPublishedOrder({ catalogId: null, itemIds: saved }), true);
  assert.equal(matchesEarlierPublishedOrder({ catalogId: 'wolverine-reading-order', itemIds: revised }), false);
  assert.equal(matchesEarlierPublishedOrder({ catalogId: 'wolverine-reading-order', itemIds: saved.slice(1) }), false);
  assert.equal(matchesEarlierPublishedOrder({ catalogId: 'another-list', itemIds: saved }), false);
  assert.equal(publishedRevisionItems({ id: payload.id }, payload), payload.items);
  assert.throws(() => publishedRevisionItems({ id: payload.id }, { ...payload, items: saved.map((issueId) => ({ issueId })), count: saved.length }), /not available/);
  assert.throws(() => publishedRevisionItems({ id: 'another-list' }, payload), /verified/);
  assert.throws(() => publishedRevisionItems({ id: payload.id }, { ...payload, count: 1 }), /verified/);
});

test('updating the actual earlier Wolverine list retains retired comics and their data', () => {
  const payload = JSON.parse(readFileSync(new URL('../src/data/wolverine_reading_order.json', import.meta.url)));
  const revised = payload.items.map(({ issueId }) => issueId);
  const saved = beforeWolverineCorrectionIssueIds(revised).map(Number);
  const current = new Map(payload.items.map((item) => [item.issueId, item]));
  const retired = saved.filter((id) => !current.has(id));
  let state = createList(createEmptyState(), { id: 'wolverine', name: 'Wolverine', catalogId: payload.id });
  state = addIssuesToList(state, 'wolverine', saved.map((issueId) => current.get(issueId) ?? { issueId })).state;
  state = markRead(state, retired[0], true, 123);
  state = setIssueNote(state, retired[0], 'My note');
  state = setOverride(state, retired[0], 'unavailable');
  state = setDeferred(state, 'wolverine', retired[0]);
  const updated = applyListRevision(state, 'wolverine', JSON.stringify(state.lists.wolverine), payload.items);
  assert.equal(updated.lists.wolverine.itemIds.length, 1276);
  assert.deepEqual(updated.lists.wolverine.itemIds.filter((id) => current.has(id)), revised);
  assert.ok(retired.every((id) => updated.lists.wolverine.itemIds.includes(id)));
  assert.equal(updated.read[retired[0]], 123);
  assert.equal(updated.notes[retired[0]], 'My note');
  assert.equal(updated.overrides[retired[0]], 'unavailable');
  assert.ok(updated.lists.wolverine.deferredIssueIds.includes(retired[0]));
});
