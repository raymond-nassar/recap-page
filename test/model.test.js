import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  createEmptyState, createList, deleteList, restoreList, duplicateList, renameList, setActive, addIssuesToList,
  removeFromList, moveItem, moveItemTo, markRead, toggleRead, isRead, markManyRead,
  setOverride, upNext, listProgress, seriesProgress, listItems, pendingIssueIds,
  hydrationOrder, migrate, validateBackup, exportBackup, normalizeIssue, upsertIssue,
  normalizeCover, coverUrl, listForCatalogId, listCollections, SCHEMA_VERSION, MAX_NAME, MAX_DESCRIPTION,
  newId, hasMetadata, countOrderGaps, orderGapSentences, markDetailsRefused,
} from '../src/js/lib/model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const issue = (id, over = {}) => ({
  issueId: id,
  title: `Issue ${id}`,
  seriesId: 100,
  seriesName: 'Test Series (2013)',
  onSale: '2013-01-01T00:00:00+0000',
  digitalId: id * 2,
  ...over,
});

function withList(items = [1, 2, 3], name = 'L') {
  let s = createList(createEmptyState(), { name });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, items.map((i) => issue(i))).state;
  return { state: s, id };
}

// ------------------------------------------------------------------ issues

test('normalizeIssue rejects records without a usable id', () => {
  assert.equal(normalizeIssue({ title: 'no id' }), null);
  assert.equal(normalizeIssue({ issueId: 0 }), null);
  assert.equal(normalizeIssue({ issueId: 1.5 }), null);
  assert.equal(normalizeIssue({ issueId: 'abc' }), null);
  assert.equal(normalizeIssue(null), null);
});

// Hand-added issues with no marvel.com URL are given a negative synthetic id. Rejecting those
// meant the entry was silently discarded while the UI reported success.
test('a hand-added issue with a synthetic negative id is accepted', () => {
  const n = normalizeIssue({ issueId: -1738000000000, title: 'Something I own in print' });
  assert.ok(n, 'a synthetic id must not be rejected');
  assert.equal(n.issueId, -1738000000000);
  assert.equal(n.title, 'Something I own in print');
  assert.equal(n.url, null, 'a synthetic id has no marvel.com page, so no link may be invented');
});

test('a hand-added issue actually lands in the list', () => {
  const s = createList(createEmptyState(), { name: 'L' });
  const id = s.listOrder[0];
  const res = addIssuesToList(s, id, [{
    issueId: -1738000000000, title: 'By hand', source: 'manual', hydrated: true,
  }]);
  assert.equal(res.added, 1, 'the entry must be stored, not silently dropped');
  assert.deepEqual(res.state.lists[id].itemIds, [-1738000000000]);
  assert.equal(listItems(res.state, id)[0].title, 'By hand');
});

test('id zero is still refused, including inside a list', () => {
  const s = createList(createEmptyState(), { name: 'L' });
  const id = s.listOrder[0];
  const res = addIssuesToList(s, id, [{ issueId: 0, title: 'nope' }]);
  assert.equal(res.added, 0);
  assert.deepEqual(res.state.lists[id].itemIds, []);
});

test('normalizeIssue carries the rich fields from /issues/{id}', () => {
  const n = normalizeIssue({
    id: 7,
    title: 'T',
    cover: { path: 'http://i.annihil.us/u/x', extension: 'jpg' },
    description: 'A synopsis.',
    pageCount: 32,
    creators: [{ name: 'Jonathan Hickman', role: 'writer' }],
  });
  // Every rich field except the synopsis. This is the single issue-level write gate, reached by
  // upsertIssue on the way in and by coerce on every load, so dropping the field here is what makes
  // "a fetched synopsis is never stored" true of new writes, of trackers saved before BL-134, and of
  // restored backups, rather than true of the new button alone.
  assert.equal('description' in n, false, 'synopsis prose must not reach stored state by any path');
  assert.equal(n.pageCount, 32);
  assert.equal(n.creators[0].name, 'Jonathan Hickman');
  assert.equal(n.cover.path, 'https://i.annihil.us/u/x', 'http must be upgraded to https');
  assert.equal(n.cover.ext, 'jpg');
});

test('cover URLs are built from a variant and never invented', () => {
  const withCover = normalizeIssue({ id: 1, cover: { path: 'https://i.annihil.us/u/x', extension: 'jpg' } });
  assert.equal(coverUrl(withCover, 'portrait_uncanny'), 'https://i.annihil.us/u/x/portrait_uncanny.jpg');
  assert.equal(coverUrl(normalizeIssue({ id: 2 })), null, 'no cover means no URL, not a broken one');
});

test('normalizeCover refuses anything that is not an https URL', () => {
  assert.equal(normalizeCover(null), null);
  assert.equal(normalizeCover({ path: 'javascript:alert(1)', extension: 'jpg' }), null);
  assert.equal(normalizeCover({ extension: 'jpg' }), null);
  assert.equal(normalizeCover({ path: 'https://i.annihil.us/u/x' }).ext, 'jpg', 'extension defaults');
});

test('pageCount only survives when it is a positive number', () => {
  assert.equal(normalizeIssue({ id: 1, pageCount: 0 }).pageCount, null);
  assert.equal(normalizeIssue({ id: 1, pageCount: 'x' }).pageCount, null);
  assert.equal(normalizeIssue({ id: 1, pageCount: '48' }).pageCount, 48);
});

test('upsert merges new detail without erasing what we already had', () => {
  let s = upsertIssue(createEmptyState(), { issueId: 1, title: 'Old', digitalId: 5 });
  s = upsertIssue(s, { issueId: 1, title: 'New', pageCount: 32, description: 'Added' });
  assert.equal(s.issues[1].title, 'New');
  assert.equal(s.issues[1].pageCount, 32);
  assert.equal('description' in s.issues[1], false, 'and a synopsis is not one of the things it merges');
  assert.equal(s.issues[1].digitalId, 5, 'a later partial record must not blank a known field');
});

// ------------------------------------------------------------------ lists

test('adding the same issue twice is skipped, not duplicated', () => {
  const { state, id } = withList([1, 2]);
  const res = addIssuesToList(state, id, [issue(2), issue(3)]);
  assert.equal(res.added, 1);
  assert.equal(res.skipped, 1);
  assert.deepEqual(res.state.lists[id].itemIds, [1, 2, 3]);
});

test('a batch containing internal duplicates only adds one', () => {
  const { state, id } = withList([]);
  const res = addIssuesToList(state, id, [issue(9), issue(9)]);
  assert.equal(res.added, 1);
});

test('items can be inserted at a position and reordered', () => {
  const { state, id } = withList([1, 2, 3]);
  const inserted = addIssuesToList(state, id, [issue(9)], { at: 1 }).state;
  assert.deepEqual(inserted.lists[id].itemIds, [1, 9, 2, 3]);

  assert.deepEqual(moveItem(inserted, id, 9, -1).lists[id].itemIds, [9, 1, 2, 3]);
  assert.deepEqual(moveItemTo(inserted, id, 9, 3).lists[id].itemIds, [1, 2, 3, 9]);
});

test('moving past either end clamps instead of throwing', () => {
  const { state, id } = withList([1, 2, 3]);
  assert.deepEqual(moveItem(state, id, 1, -5).lists[id].itemIds, [1, 2, 3]);
  assert.deepEqual(moveItem(state, id, 3, 99).lists[id].itemIds, [1, 2, 3]);
});

test('operations on a missing list or item are no-ops', () => {
  const { state, id } = withList([1]);
  assert.equal(moveItem(state, 'nope', 1, 1), state);
  assert.equal(moveItem(state, id, 999, 1), state);
  assert.equal(removeFromList(state, 'nope', 1), state);
  assert.equal(renameList(state, 'nope', 'x'), state);
  assert.equal(setActive(state, 'nope'), state);
});

test('deleting a list keeps read progress and issue metadata', () => {
  const { state, id } = withList([1, 2]);
  const read = markRead(state, 1, true);
  const after = deleteList(read, id);
  assert.equal(after.lists[id], undefined);
  assert.ok(isRead(after, 1), 'progress must outlive the list that referenced it');
  assert.ok(after.issues[1], 'issue metadata must be retained for other lists');
});

test('deleting the active list moves focus to a surviving one', () => {
  let s = createList(createEmptyState(), { name: 'A' });
  s = createList(s, { name: 'B' });
  const [a] = s.listOrder;
  s = setActive(s, a);
  assert.notEqual(deleteList(s, a).active, a);
  assert.ok(deleteList(s, a).active);
});

test('undoing a delete puts the list back where it was', () => {
  let s = createList(createEmptyState(), { name: 'A' });
  s = createList(s, { name: 'B' });
  s = createList(s, { name: 'C' });
  const [, b] = s.listOrder;
  s = setActive(s, b);
  const list = s.lists[b];
  const index = s.listOrder.indexOf(b);

  const after = deleteList(s, b);
  const undone = restoreList(after, list, { index, active: true });

  assert.deepEqual(undone.listOrder, s.listOrder, 'the list returns to its old position, not the end');
  assert.deepEqual(undone.lists[b], list);
  assert.equal(undone.active, b, 'the list being read when it was deleted is being read again');
  // Undo after a delete is a recovery path, and this is the only site whose rebuild no other
  // assertion reaches, so without this line the source scan is the entire margin for it.
  assert.equal(Object.getPrototypeOf(undone.lists), null, 'the restored map has a prototype again');
});

test('a delete and its undo leave read progress untouched either way', () => {
  const { state, id } = withList([1, 2]);
  const read = markRead(state, 1, true);
  const list = read.lists[id];

  const after = deleteList(read, id);
  assert.ok(isRead(after, 1), 'deleting must not disturb progress');

  const undone = restoreList(after, list, { index: 0 });
  assert.ok(isRead(undone, 1), 'undoing must not disturb it either');
  assert.deepEqual(undone.read, read.read);
});

test('a restore never overwrites a list holding the same id', () => {
  const { state, id } = withList([1]);
  const renamed = renameList(state, id, 'Renamed since');
  assert.equal(restoreList(renamed, state.lists[id], { index: 0 }), renamed);
});

test('a restore never gives one catalog entry a second list', () => {
  let s = createList(createEmptyState(), { name: 'House of M', catalogId: 'house-of-m' });
  const [first] = s.listOrder;
  const deleted = s.lists[first];
  s = deleteList(s, first);
  // What the reader does between the delete and the undo: they add the order again, which mints
  // a new id, so the id guard above cannot see the collision.
  const reimported = createList(s, { name: 'House of M', catalogId: 'house-of-m' });

  assert.equal(restoreList(reimported, deleted, { index: 0 }), reimported);
  assert.equal(
    Object.values(restoreList(reimported, deleted, { index: 0 }).lists).filter((l) => l.catalogId === 'house-of-m').length,
    1,
    'two lists answering to one catalog entry make "in library" point at whichever is found first',
  );
});

test('a restore of a list with no catalog entry is not blocked by one', () => {
  let s = createList(createEmptyState(), { name: 'Mine' });
  const [a] = s.listOrder;
  const list = s.lists[a];
  s = deleteList(s, a);
  s = createList(s, { name: 'House of M', catalogId: 'house-of-m' });
  assert.ok(restoreList(s, list, { index: 0 }).lists[a], 'a null catalogId matches nothing');
});

test('a restore with no usable index appends rather than dropping the list', () => {
  let s = createList(createEmptyState(), { name: 'A' });
  const [a] = s.listOrder;
  const list = s.lists[a];
  s = deleteList(s, a);
  assert.deepEqual(restoreList(s, list, { index: 99 }).listOrder, [a]);
  assert.deepEqual(restoreList(s, list, {}).listOrder, [a]);
  assert.equal(restoreList(s, null, { index: 0 }), s);
});

test('names and descriptions are length-capped', () => {
  const s = createList(createEmptyState(), { name: 'x'.repeat(500), description: 'y'.repeat(5000) });
  const l = s.lists[s.listOrder[0]];
  assert.equal(l.name.length, 200);
  assert.equal(l.description.length, 2000);
});

// ------------------------------------------------------------------ duplicating

test('a duplicate copies the order and keeps sharing read progress', () => {
  const { state, id } = withList([1, 2, 3]);
  const read = markRead(state, 2, true);
  const { state: after, listId: copyId } = duplicateList(read, id);

  assert.notEqual(copyId, id, 'the copy needs its own id');
  assert.deepEqual(after.lists[copyId].itemIds, [1, 2, 3], 'order must survive the copy');
  assert.equal(after.lists[copyId].name, 'L (copy)');
  // The acceptance criterion: read state is global, so progress is shared rather than cloned.
  assert.ok(isRead(after, 2));
  assert.deepEqual(listProgress(after, copyId), { read: 1, total: 3 });
  assert.deepEqual(listProgress(after, id), { read: 1, total: 3 });

  // ...and marking read through the copy is visible in the original.
  const later = markRead(after, 1, true);
  assert.deepEqual(listProgress(later, id), { read: 2, total: 3 });
});

test('editing a duplicate never disturbs the original order', () => {
  const { state, id } = withList([1, 2, 3]);
  const { state: after, listId: copyId } = duplicateList(state, id);

  // A shared itemIds reference would make both of these leak across lists.
  const trimmed = removeFromList(after, copyId, 2);
  assert.deepEqual(trimmed.lists[copyId].itemIds, [1, 3]);
  assert.deepEqual(trimmed.lists[id].itemIds, [1, 2, 3], 'the original must keep every issue');

  const moved = moveItem(trimmed, id, 1, 2);
  assert.deepEqual(moved.lists[id].itemIds, [2, 3, 1]);
  assert.deepEqual(moved.lists[copyId].itemIds, [1, 3], 'the copy must keep its own order');
});

test('the copy sits next to its original rather than at the end', () => {
  let s = createList(createEmptyState(), { name: 'A' });
  s = createList(s, { name: 'B' });
  const [a, b] = s.listOrder;
  const { state: after, listId: copyId } = duplicateList(s, a);
  assert.deepEqual(after.listOrder, [a, copyId, b]);
});

test('duplicating repeatedly produces names you can tell apart', () => {
  const { state, id } = withList([1], 'Civil War');
  const first = duplicateList(state, id);
  const second = duplicateList(first.state, id);
  const third = duplicateList(second.state, id);
  assert.equal(first.state.lists[first.listId].name, 'Civil War (copy)');
  assert.equal(second.state.lists[second.listId].name, 'Civil War (copy 2)');
  assert.equal(third.state.lists[third.listId].name, 'Civil War (copy 3)');
});

// Appending the suffix and slicing afterwards would cut it straight back off, leaving a copy
// indistinguishable from the list it came from.
test('a maximally long name still yields a distinguishable copy', () => {
  const { state, id } = withList([1], 'x'.repeat(MAX_NAME));
  const { state: after, listId: copyId } = duplicateList(state, id);
  const copy = after.lists[copyId];
  assert.ok(copy.name.length <= MAX_NAME);
  assert.ok(copy.name.endsWith(' (copy)'));
  assert.notEqual(copy.name, after.lists[id].name);
});

test('an explicit name is honoured and capped, and a missing list is a no-op', () => {
  const { state, id } = withList([1, 2]);
  const named = duplicateList(state, id, { name: 'Essentials only' });
  assert.equal(named.state.lists[named.listId].name, 'Essentials only');

  const long = duplicateList(state, id, { name: 'z'.repeat(500) });
  assert.equal(long.state.lists[long.listId].name.length, MAX_NAME);

  const missing = duplicateList(state, 'nope');
  assert.equal(missing.listId, null);
  assert.equal(missing.state, state, 'a missing list must not produce a new state object');
});

test('duplicating carries the description and does not steal focus', () => {
  let s = createList(createEmptyState(), { name: 'A', description: 'From Comic Book Herald.' });
  const [a] = s.listOrder;
  s = setActive(s, a);
  const { state: after, listId: copyId } = duplicateList(s, a);
  assert.equal(after.lists[copyId].description, 'From Comic Book Herald.');
  assert.equal(after.active, a, 'the model must leave switching lists to the caller');
});

// createList and renameList both clamp, so an over-long description can only reach the store
// from outside the model: a restored backup, or state written before the limit existed.
// Copying it verbatim would let each duplication carry the oversized value forward instead of
// closing the hole. Shipped in 318d2ea with no test.
test('a duplicate clamps a description that arrived over-long', () => {
  const { state, id } = withList([1]);
  const long = 'd'.repeat(MAX_DESCRIPTION + 500);
  const restored = {
    ...state,
    lists: { ...state.lists, [id]: { ...state.lists[id], description: long } },
  };

  const { state: after, listId: copyId } = duplicateList(restored, id);
  assert.equal(after.lists[copyId].description.length, MAX_DESCRIPTION);
  assert.equal(after.lists[copyId].description, long.slice(0, MAX_DESCRIPTION));
  // Duplicating is not a repair operation: the original is left exactly as it was found.
  assert.equal(after.lists[id].description, long);

  // Copying a copy must not reintroduce it either.
  const second = duplicateList(after, copyId);
  assert.equal(second.state.lists[second.listId].description.length, MAX_DESCRIPTION);
});

test('a duplicate of a list with no description gets an empty one, not "undefined"', () => {
  const { state, id } = withList([1]);
  for (const missing of [undefined, null, 0]) {
    const bare = {
      ...state,
      lists: { ...state.lists, [id]: { ...state.lists[id], description: missing } },
    };
    const { state: after, listId: copyId } = duplicateList(bare, id);
    assert.equal(after.lists[copyId].description, '', `description ${missing} became a string`);
  }
});

test('a list imported from the catalog remembers which entry it came from', () => {
  const s = createList(createEmptyState(), { name: 'Civil War', catalogId: 'civil-war' });
  const id = s.listOrder[0];
  assert.equal(s.lists[id].catalogId, 'civil-war');
  assert.equal(listForCatalogId(s, 'civil-war').id, id);
  assert.equal(listForCatalogId(s, 'house-of-m'), null);
  assert.equal(listForCatalogId(s, null), null);

  // A hand-made list has no catalog entry behind it, so it must not claim one.
  const plain = createList(createEmptyState(), { name: 'Mine' });
  assert.equal(plain.lists[plain.listOrder[0]].catalogId, null);
});

test('the catalog link survives a reload, or "in library" would be wrong after one', () => {
  const s = createList(createEmptyState(), { name: 'Civil War', catalogId: 'civil-war' });
  const round = migrate(JSON.parse(JSON.stringify(s)));
  const id = round.listOrder[0];
  assert.equal(round.lists[id].catalogId, 'civil-war');
  assert.equal(listForCatalogId(round, 'civil-war').id, id);
});

test('a duplicate is the reader\'s own copy, so it does not inherit the catalog link', () => {
  const s = createList(createEmptyState(), { name: 'Civil War', catalogId: 'civil-war' });
  const id = s.listOrder[0];
  const { state: after, listId: copyId } = duplicateList(s, id);
  assert.equal(after.lists[copyId].catalogId, null);
  // The original still counts as the imported one, so the card keeps pointing at it.
  assert.equal(listForCatalogId(after, 'civil-war').id, id);
});

// ------------------------------------------------------------------ read state
test('read state is global, so the same issue in two lists is consistent', () => {
  let s = createList(createEmptyState(), { name: 'A' });
  s = createList(s, { name: 'B' });
  const [a, b] = s.listOrder;
  s = addIssuesToList(s, a, [issue(1)]).state;
  s = addIssuesToList(s, b, [issue(1)]).state;

  s = markRead(s, 1, true);
  assert.ok(listItems(s, a)[0].read);
  assert.ok(listItems(s, b)[0].read, 'an issue cannot be read in one list and unread in another');
  assert.equal(listProgress(s, a).read, 1);
  assert.equal(listProgress(s, b).read, 1);
});

test('toggling and bulk marking behave symmetrically', () => {
  const { state } = withList([1, 2, 3]);
  assert.ok(isRead(toggleRead(state, 1), 1));
  assert.equal(isRead(toggleRead(toggleRead(state, 1), 1), 1), false);

  const many = markManyRead(state, [1, 2, 3], true);
  assert.equal(Object.keys(many.read).length, 3);
  assert.equal(Object.keys(markManyRead(many, [1, 2, 3], false).read).length, 0);
});

test('up next returns the first unread in list order', () => {
  const { state, id } = withList([1, 2, 3]);
  assert.equal(upNext(state, id).issueId, 1);
  assert.equal(upNext(markRead(state, 1, true), id).issueId, 2);
  assert.equal(upNext(markManyRead(state, [1, 2, 3], true), id), null);
});

test('series progress counts unique issues once across lists', () => {
  let s = createList(createEmptyState(), { name: 'A' });
  s = createList(s, { name: 'B' });
  const [a, b] = s.listOrder;
  s = addIssuesToList(s, a, [issue(1), issue(2)]).state;
  s = addIssuesToList(s, b, [issue(2), issue(3)]).state;
  s = markRead(s, 2, true);

  const rows = seriesProgress(s);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].tracked, 3, 'issue 2 must not be counted twice');
  assert.equal(rows[0].read, 1);
});

test('series progress counts one list alone when given its id', () => {
  let s = createList(createEmptyState(), { name: 'A' });
  s = createList(s, { name: 'B' });
  const [a, b] = s.listOrder;
  s = addIssuesToList(s, a, [issue(1), issue(2)]).state;
  s = addIssuesToList(s, b, [issue(2), issue(3)]).state;
  s = markRead(s, 2, true);

  const inA = seriesProgress(s, a);
  assert.equal(inA[0].tracked, 2, 'list A holds issues 1 and 2');
  assert.equal(inA[0].read, 1);

  const inB = seriesProgress(s, b);
  assert.equal(inB[0].tracked, 2, 'list B holds issues 2 and 3');
  assert.equal(inB[0].read, 1, 'read state is shared, so issue 2 is read in both');

  assert.equal(seriesProgress(s)[0].tracked, 3, 'the cross-list total is still reachable');
});

test('series progress for a list that does not exist is empty, not global', () => {
  let s = createList(createEmptyState(), { name: 'A' });
  const [a] = s.listOrder;
  s = addIssuesToList(s, a, [issue(1), issue(2)]).state;

  assert.deepEqual(seriesProgress(s, 'no-such-list'), []);
  assert.equal(seriesProgress(s)[0].tracked, 2, 'the unscoped call is unaffected');
});

test('series progress splits a list by series', () => {
  let s = createList(createEmptyState(), { name: 'A' });
  s = createList(s, { name: 'B' });
  const [a, b] = s.listOrder;
  s = addIssuesToList(s, a, [
    { ...issue(1), seriesId: 10, seriesName: 'Alpha' },
    { ...issue(2), seriesId: 20, seriesName: 'Beta' },
    { ...issue(3), seriesId: 20, seriesName: 'Beta' },
  ]).state;
  // A series only the other list carries, so a scoped call that quietly counted every list
  // would show three rows here rather than two.
  s = addIssuesToList(s, b, [{ ...issue(4), seriesId: 30, seriesName: 'Gamma' }]).state;
  s = markRead(s, 3, true);

  const rows = seriesProgress(s, a);
  assert.deepEqual(rows.map((r) => r.seriesName), ['Alpha', 'Beta'], 'sorted, and Gamma is not here');
  assert.equal(rows[1].tracked, 2);
  assert.equal(rows[1].read, 1);
  assert.deepEqual(
    seriesProgress(s).map((r) => r.seriesName),
    ['Alpha', 'Beta', 'Gamma'],
    'the unscoped call still sees every series',
  );
});

test('overrides can be set and cleared', () => {
  const { state } = withList([1]);
  assert.equal(setOverride(state, 1, 'available').overrides[1], 'available');
  assert.equal(setOverride(setOverride(state, 1, 'available'), 1, null).overrides[1], undefined);
  assert.equal(setOverride(state, 1, 'garbage').overrides[1], undefined);
});

// ------------------------------------------------------------------ hydration

test('pending issues exclude hydrated and hand-added records', () => {
  let s = createList(createEmptyState(), { name: 'L' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [
    { issueId: 1, title: 'imported', hydrated: false, source: 'import' },
    { issueId: 2, title: 'done', hydrated: true, source: 'api' },
    { issueId: 3, title: 'by hand', hydrated: false, source: 'manual' },
  ]).state;
  assert.deepEqual(pendingIssueIds(s), [1]);
});

test('hydration fetches what you are about to read first', () => {
  let s = createList(createEmptyState(), { name: 'L' });
  const id = s.listOrder[0];
  const staged = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map((i) => ({ issueId: i, title: `t${i}`, hydrated: false, source: 'import' }));
  s = addIssuesToList(s, id, staged).state;
  s = markManyRead(s, [1, 2], true);

  const order = hydrationOrder(s, id, 2);
  assert.deepEqual(order.slice(0, 3), [3, 4, 5], 'the next unread issues come first');
  assert.equal(order.length, 10, 'everything still gets fetched eventually');
});

// ------------------------------------------------------------------ persistence

test('a v1 backup migrates to global read state', () => {
  const v1 = {
    schemaVersion: 1,
    lists: [{
      name: 'Old',
      items: [
        { issueId: 1, title: 'One', read: true },
        { issueId: 2, title: 'Two', read: false },
      ],
    }],
  };
  const s = migrate(v1);
  assert.equal(s.schemaVersion, SCHEMA_VERSION);
  const id = s.listOrder[0];
  assert.deepEqual(s.lists[id].itemIds, [1, 2]);
  assert.ok(isRead(s, 1));
  assert.equal(isRead(s, 2), false);
});

test('a future schema is refused rather than silently mangled', () => {
  assert.throws(() => migrate({ schemaVersion: 99 }), /Unsupported schema/);
  const res = validateBackup({ schemaVersion: 99 });
  assert.equal(res.ok, false);
  assert.equal(res.state, null);
});

test('validateBackup rejects junk without touching anything', () => {
  for (const bad of [null, 'string', 42, [], { schemaVersion: 2, lists: [] }]) {
    assert.equal(validateBackup(bad).ok, false, `${JSON.stringify(bad)} must be refused`);
  }
});

test('a well-formed backup round-trips', () => {
  const { state, id } = withList([1, 2, 3]);
  const s = markRead(setOverride(state, 2, 'unavailable'), 1, true);
  const exported = JSON.parse(JSON.stringify(exportBackup(s)));
  const res = validateBackup(exported);

  assert.equal(exported.app, 'recap-page');
  assert.ok(res.ok, res.errors.join(' '));
  assert.deepEqual(res.state.lists[id].itemIds, [1, 2, 3]);
  assert.ok(isRead(res.state, 1));
  assert.equal(res.state.overrides[2], 'unavailable');

  const oldLabel = validateBackup({ ...exported, app: 'marvel-reading-tracker' });
  assert.ok(oldLabel.ok, oldLabel.errors.join(' '));
  assert.deepEqual(oldLabel.state.lists[id].itemIds, [1, 2, 3]);
});

test('coercion drops corrupt entries instead of failing the whole restore', () => {
  const s = migrate({
    schemaVersion: 2,
    issues: { 1: { issueId: 1, title: 'ok' }, bad: { title: 'no id' } },
    read: { 1: 123, notanumber: 5 },
    overrides: { 1: 'available', 2: 'nonsense' },
    lists: { a: { name: 'A', itemIds: [1, 'x', 2] } },
    listOrder: ['a', 'ghost'],
    active: 'ghost',
  });
  assert.ok(s.issues[1]);
  assert.equal(Object.keys(s.issues).length, 1);
  assert.ok(isRead(s, 1));
  assert.equal(s.overrides[2], undefined);
  assert.deepEqual(s.lists.a.itemIds, [1, 2]);
  assert.deepEqual(s.listOrder, ['a']);
  assert.equal(s.active, 'a', 'a dangling active pointer must be repaired');
});

test('listItems reports placeholders for ids with no metadata yet', () => {
  let s = createList(createEmptyState(), { name: 'L' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [{ issueId: 55, title: 'Known' }]).state;
  s = { ...s, issues: {} };
  const [item] = listItems(s, id);
  assert.equal(item.issueId, 55);
  assert.equal(item.hydrated, false);
  assert.ok(item.title);
});

// Search, series and creator results come from list endpoints, which return neither `cover`
// nor `digitalId`. Such an issue must stay pending so hydration fills those in - otherwise it
// sits in the list with no art and, worse, no way to open it in Marvel Unlimited.
test('an issue added from a list endpoint stays pending until hydrated', async () => {
  const { toIssue } = await import('../src/js/api.js');

  // Exactly the shape the live API returns from /v1/search/issues and /v1/series/{id}/issues.
  const fromList = toIssue({
    id: 52447, title: 'Secret Wars (2015) #1', issueNumber: 1,
    detailUrl: 'https://www.marvel.com/comics/issue/52447/secret_wars_2015_1',
    seriesId: 19648, seriesName: 'Secret Wars (2015)',
    onSaleDate: '2015-05-06', unlimitedDate: '2015-11-09', yearPage: 2015,
  });

  assert.equal(fromList.cover, null, 'list endpoints omit cover');
  assert.equal(fromList.digitalId, null, 'list endpoints omit digitalId');
  assert.equal(fromList.hydrated, false, 'so it must not be treated as complete');

  let s = createList(createEmptyState(), { name: 'From search' });
  const listId = s.listOrder[0];
  s = addIssuesToList(s, listId, [fromList]).state;

  assert.deepEqual(pendingIssueIds(s), [52447], 'hydration must know it still needs details');
  assert.ok(hydrationOrder(s, listId).includes(52447));

  // And once hydrated it drops out of the queue.
  s = upsertIssue(s, { ...fromList, digitalId: 38164, cover: { path: 'http://i.annihil.us/u/y', extension: 'jpg' }, hydrated: true });
  assert.deepEqual(pendingIssueIds(s), []);
});

// ---------------------------------------------------------------- collected editions
//
// The edition lives on the list rather than on the issue, because read state is global and the
// same issue sits in both the issue-by-issue order and the trade order at once. Storing it on
// the issue would make importing one order silently relabel the other.

const trade = (id, name) => ({ ...issue(id), collectedIn: name });

test('a list records which collected edition each issue was added under', () => {
  let s = createList(createEmptyState(), { name: 'Trades' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [trade(1, 'Vol. 1'), trade(2, 'Vol. 1'), trade(3, 'Vol. 2')], {}).state;

  assert.deepEqual(listItems(s, id).map((i) => i.collectedIn), ['Vol. 1', 'Vol. 1', 'Vol. 2']);
});

// The edition is a fact about this list. Letting it reach the shared issue record would leak
// one list's structure into every other list holding the same issue.
test('the edition never reaches the shared issue record', () => {
  let s = createList(createEmptyState(), { name: 'Trades' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [trade(1, 'Vol. 1')], {}).state;

  assert.equal(s.issues[1].collectedIn, undefined);
});

test('an ordinary order reports no edition at all', () => {
  let s = createList(createEmptyState(), { name: 'Issues' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [issue(1), issue(2)], {}).state;

  assert.deepEqual(listItems(s, id).map((i) => i.collectedIn), [null, null]);
  assert.deepEqual(listCollections(s, id), []);
});

test('collected editions are reported in reading order with their own progress', () => {
  let s = createList(createEmptyState(), { name: 'Trades' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [trade(1, 'Vol. 1'), trade(2, 'Vol. 1'), trade(3, 'Vol. 2')], {}).state;
  s = markRead(s, 1, true);

  assert.deepEqual(
    listCollections(s, id).map((c) => [c.name, c.read, c.total]),
    [['Vol. 1', 1, 2], ['Vol. 2', 0, 1]],
  );
});

// A book split in two by a move is shown as two runs, because itemIds is the reading order and
// regrouping them would report an order the list does not have.
test('a move that splits a book reports it as two runs, not one', () => {
  let s = createList(createEmptyState(), { name: 'Trades' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [trade(1, 'Vol. 1'), trade(2, 'Vol. 1'), trade(3, 'Vol. 2')], {}).state;
  s = moveItemTo(s, id, 3, 1);

  assert.deepEqual(
    listCollections(s, id).map((c) => [c.name, c.total]),
    [['Vol. 1', 1], ['Vol. 2', 1], ['Vol. 1', 1]],
  );
});

// Re-adding an order the reader already holds must not move an issue into a different book
// than the one they have been working through.
test('re-importing does not relabel an issue the list already held', () => {
  let s = createList(createEmptyState(), { name: 'Trades' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [trade(1, 'Vol. 1')], {}).state;
  s = addIssuesToList(s, id, [trade(1, 'Vol. 9'), trade(2, 'Vol. 9')], {}).state;

  assert.deepEqual(listItems(s, id).map((i) => i.collectedIn), ['Vol. 1', 'Vol. 9']);
});

// Left behind, the entry would put the issue back into a book it had been removed from the
// moment it was added again, and grow storage for a list that no longer holds it.
test('removing an issue drops the edition it was filed under', () => {
  let s = createList(createEmptyState(), { name: 'Trades' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [trade(1, 'Vol. 1')], {}).state;
  s = removeFromList(s, id, 1);

  assert.equal(s.lists[id].collectedIn[1], undefined);
});

test('duplicating a trade order copies its books', () => {
  let s = createList(createEmptyState(), { name: 'Trades' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [trade(1, 'Vol. 1'), trade(2, 'Vol. 2')], {}).state;
  const dup = duplicateList(s, id);
  s = dup.state;

  assert.deepEqual(listItems(s, dup.listId).map((i) => i.collectedIn), ['Vol. 1', 'Vol. 2']);
});

// coerce runs on every load, so an entry for an issue the list no longer holds would survive
// forever otherwise. Saved data is a file the reader can edit, and an older build that removed
// an issue without knowing about editions is exactly how such an entry gets there.
test('an edition for an issue the list does not hold is dropped on load', () => {
  let s = createList(createEmptyState(), { name: 'Trades' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [trade(1, 'Vol. 1')], {}).state;
  const raw = JSON.parse(JSON.stringify(s));
  raw.lists[id].collectedIn['999'] = 'A Book That Is Not Here';

  const loaded = migrate(raw);
  assert.equal(loaded.lists[id].collectedIn['999'], undefined);
  assert.equal(loaded.lists[id].collectedIn[1], 'Vol. 1');
});

// A file the reader can edit can hold anything at all in this field, and an object that is not
// a map of strings must not reach the view.
test('a malformed collectedIn is discarded rather than trusted', () => {
  let s = createList(createEmptyState(), { name: 'Trades' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [issue(1)], {}).state;
  const raw = JSON.parse(JSON.stringify(s));
  raw.lists[id].collectedIn = { 1: 42 };

  assert.deepEqual(migrate(raw).lists[id].collectedIn, {});
});

// ---------------------------------------------------------------- list ids that name prototype members

// A backup is JSON, and JSON.parse defines "__proto__" as an own key rather than invoking the
// setter, so a list saved under that name reaches migrate intact. An ordinary map then lost it on the
// way in and answered lists[id] for names nobody stored. These fixtures are built from JSON text on
// purpose: `{ '__proto__': v }` in an object literal sets the prototype even with a quoted key, so a
// fixture written that way is empty and the test passes or fails for a reason that is not the app's.
const protoBackup = (name) => JSON.parse(
  `{"schemaVersion":${SCHEMA_VERSION},"lists":{"__proto__":{"id":"__proto__","name":${JSON.stringify(name)},"itemIds":[1,2,3],"created":1}},"listOrder":["__proto__"],"active":"__proto__"}`,
);

const PROTO_NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', '__proto__'];

test('a restored list whose id names a prototype member is kept rather than lost', () => {
  const s = migrate(protoBackup('Ruined'));
  assert.ok(Object.hasOwn(s.lists, '__proto__'), 'the list is not an own member of the map');
  assert.equal(s.lists['__proto__'].name, 'Ruined');
  assert.deepEqual(Object.keys(exportBackup(s).lists), ['__proto__'], 'the backup written afterwards drops it');
});

test('a stored active naming a prototype member is not adopted', () => {
  for (const name of PROTO_NAMES) {
    const raw = JSON.parse(`{"schemaVersion":${SCHEMA_VERSION},"lists":{"real":{"id":"real","name":"Real","itemIds":[],"created":1}},"listOrder":["real"],"active":${JSON.stringify(name)}}`);
    assert.equal(migrate(raw).active, 'real', `active fell through to ${name}`);
  }
});

test('a stored order naming prototype members keeps only the lists that exist', () => {
  const raw = JSON.parse(`{"schemaVersion":${SCHEMA_VERSION},"lists":{"real":{"id":"real","name":"Real","itemIds":[],"created":1}},"listOrder":["real","constructor","toString"],"active":"real"}`);
  assert.deepEqual(migrate(raw).listOrder, ['real']);
});

test('setActive refuses an id that only the prototype answers for', () => {
  const s = createList(createEmptyState(), { name: 'Real', id: 'real' });
  for (const name of PROTO_NAMES) assert.equal(setActive(s, name).active, 'real', `setActive adopted ${name}`);
});

test('an ordinary edit leaves the map unable to answer for a name it does not hold', () => {
  // This is the case that catches a fix applied to coerce alone, and the one that was expected to be
  // covered by the restore case and is not. A rebuild site written as `{ ...state.lists, [id]: v }`
  // keeps the renamed list, because a computed key is stored as data even for `__proto__`, while
  // quietly handing the map Object.prototype back. The list survives its own rename and the damage
  // lands on the next lookup instead, so the assertion has to be about the names nobody stored.
  let s = createEmptyState();
  s = createList(s, { name: 'Real', id: 'real' });
  const after = renameList(s, 'real', 'Renamed');
  for (const name of PROTO_NAMES) {
    assert.equal(after.lists[name], undefined, `a list was found under ${name} after a rename`);
  }
  assert.equal(Object.getPrototypeOf(after.lists), null, 'the map has a prototype again after a rename');
  // The empty map is the one producing site no behavioural assertion reaches, because a state with no
  // list in it is never looked up by a colliding name. It is held by this line and nothing else.
  assert.equal(Object.getPrototypeOf(createEmptyState().lists), null, 'a fresh state starts with an ordinary map');
});

test('no rebuild site spreads the list map back into an ordinary object', () => {
  // The behavioural tests above cover the sites that exist. This covers the site somebody adds next.
  // A spread produces an ordinary object even from a null-prototype one, so a single `{ ...x.lists }`
  // anywhere hands Object.prototype back to the whole map and every guarantee above goes with it.
  // Scanning the source rather than listing the known sites is deliberate: a list of places that
  // must each be written correctly is the defect this fix exists to remove, not a way to enforce it.
  //
  // The receiver is matched as a dotted path rather than one identifier, and the scan runs over the
  // whole file rather than line by line, because the map is reached as `store.state.lists` everywhere
  // in main.js and a spread may be wrapped. A pattern that only matched `state.lists` on one line was
  // blind to the entire file with no behavioural coverage, which is where the next site is likeliest.
  const dir = join(ROOT, 'src', 'js');
  const files = [];
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith('.js')) files.push(join(d, e.name));
    }
  };
  walk(dir);
  assert.ok(files.length > 5, 'the scan found almost no files, so it proves nothing');
  const offenders = [];
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    const re = /\{\s*\.\.\.\s*[\w$]+(?:\s*\.\s*[\w$]+)*\s*\.\s*lists\b/g;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      // A line comment is the natural place to warn somebody off this idiom, and spelling it out
      // there must not fire the scan the warning is about. A false alarm on the one comment a
      // maintainer would write to help is how a check earns the reputation that gets it ignored.
      const lineStart = text.lastIndexOf('\n', m.index) + 1;
      if (text.slice(lineStart, m.index).includes('//')) continue;
      offenders.push(`${f.slice(ROOT.length + 1)}:${text.slice(0, m.index).split(/\r?\n/).length}`);
    }
  }
  assert.deepEqual(offenders, [], 'the list map is spread into an object literal, which drops its null prototype');
});

// The clock is frozen because the stamp is the part of an id that does not need testing. What was
// wrong was the other part: everything minted inside one millisecond was told apart by six random
// base-36 characters alone, and once the version 1 restore path was made linear it began minting
// about 610 ids per stamp. Freezing the clock puts every id in this test into one stamp, which is
// the worst case of exactly the claim, and it makes the check deterministic rather than a draw.
//
// The size is chosen so the check can actually fail. Under the random form 300,000 ids in one stamp
// give 4.5e10 pairs against 36^6, so about 20.7 collisions are expected and a clean run has a
// probability around 1e-9. Under the counting form a repeat is impossible below 36^6 ids. Watched
// failing with the random form restored: 299,979 of 300,000 were distinct, 21 collisions against
// the 20.7 the arithmetic predicts.
test('ids minted in bulk within one millisecond are all distinct', () => {
  const realNow = Date.now;
  Date.now = () => 1755000000000;
  try {
    const seen = new Set();
    for (let i = 0; i < 300000; i += 1) seen.add(newId());
    // The count rather than the ids, so a failure prints two numbers instead of building a diff of
    // 300,000 strings, which is how the listOrder assertion in backup-bounds took its own file down.
    assert.equal(seen.size, 300000, 'two ids minted in the same millisecond were identical');
  } finally {
    Date.now = realNow;
  }
});

// BL-110. An order is short of metadata in two unrelated ways and import reported only one of
// them, from a payload field that reads 0 for every order this app ships. These fix the count at
// the level the reader is told about it, which is where the defect was.
test('the two kinds of gap in an order are counted apart', () => {
  const order = {
    items: [
      { issueId: 1, seriesId: 10, digitalId: 100 },
      { issueId: 2, seriesId: null, digitalId: null },
      { issueId: 3, seriesId: null, digitalId: null },
      { issueId: -4, seriesId: null, digitalId: null, placeholder: true },
    ],
  };
  assert.deepEqual(countOrderGaps(order), { placeholders: 1, empty: 2 });
});

test('a placeholder is not also counted as an item that came back empty', () => {
  // A placeholder holds no metadata either, so an inclusive count would report the same missing
  // issue twice under two explanations. One issue, one gap, one number.
  const order = { items: [{ issueId: -1, placeholder: true }] };
  const { placeholders, empty } = countOrderGaps(order);
  assert.equal(placeholders, 1);
  assert.equal(empty, 0);
});

test('a metadata-bearing legacy placeholder flag is not an openability gap', () => {
  const launchable = {
    issueId: 12817,
    placeholder: true,
    seriesId: 485,
    digitalId: 1595,
  };
  const unlinked = {
    issueId: -1,
    placeholder: true,
    seriesId: null,
    digitalId: null,
  };
  assert.deepEqual(countOrderGaps({ items: [launchable] }), { placeholders: 0, empty: 0 });
  assert.deepEqual(orderGapSentences({ items: [launchable] }), []);
  assert.deepEqual(countOrderGaps({ items: [launchable, unlinked] }), { placeholders: 1, empty: 0 });
});

test('an order with neither kind of gap reports neither, and says nothing', () => {
  const order = { items: [{ issueId: 1, seriesId: 10, digitalId: 100 }, { issueId: 2, seriesId: 11, digitalId: 101 }] };
  assert.deepEqual(countOrderGaps(order), { placeholders: 0, empty: 0 });
  assert.deepEqual(orderGapSentences(order), []);
});

test('an item counts as carrying metadata on either field, not only on both', () => {
  // The two fields arrive from the same endpoint, so in the shipped data they are present or
  // absent together. Requiring both would start counting a real record as a gap the first time
  // upstream returns one without a digitalId, which is an issue that exists and is not on
  // Unlimited rather than an issue nothing answered for.
  assert.equal(hasMetadata({ seriesId: 10, digitalId: null }), true);
  assert.equal(hasMetadata({ seriesId: null, digitalId: 100 }), true);
  assert.equal(hasMetadata({ seriesId: null, digitalId: null }), false);
  assert.equal(hasMetadata(null), false);
});

test('the counts come from the items, not from the order payload that claims them', () => {
  // The payload field is what import used to read. Two of the shipped orders predate it entirely,
  // and it counts only the first kind of gap, so it is exactly the number this item exists to
  // stop trusting. An order asserting nothing is missing does not get to be believed over its
  // own items.
  const order = {
    placeholders: 0,
    items: [{ issueId: 1, seriesId: null, digitalId: null }, { issueId: -2, placeholder: true }],
  };
  assert.deepEqual(countOrderGaps(order), { placeholders: 1, empty: 1 });

  const noItems = { placeholders: 7 };
  assert.deepEqual(countOrderGaps(noItems), { placeholders: 0, empty: 0 });
});

test('both gaps are disclosed, and the second sentence does not repeat what the first one promises', () => {
  const order = {
    items: [
      { issueId: 1, seriesId: 10, digitalId: 100 },
      { issueId: 2, seriesId: null, digitalId: null },
      { issueId: -3, placeholder: true },
    ],
  };
  const said = orderGapSentences(order);
  assert.equal(said.length, 2);
  assert.match(said[0], /^1 of them has no Marvel Unlimited link yet and cannot be opened\.$/);
  assert.match(said[1], /^1 of them came with no details at all, so it shows no cover and has no Unlimited link\.$/);
  // An item that came back empty carries a real, positive issue id, so the app does open a tab
  // for it and the lookup fails there. Claiming it cannot be opened would be false in the
  // opposite direction from the silence this replaces.
  assert.ok(!said[1].includes('cannot be opened'));
});

test('a gap of one is not described in the plural', () => {
  const one = orderGapSentences({ items: [{ issueId: 1, seriesId: null, digitalId: null }] });
  assert.equal(one.length, 1);
  assert.ok(one[0].startsWith('1 of them came with no details at all, so it shows'));
  const two = orderGapSentences({
    items: [{ issueId: 1, seriesId: null, digitalId: null }, { issueId: 2, seriesId: null, digitalId: null }],
  });
  assert.ok(two[0].startsWith('2 of them came with no details at all, so they show'));
});

// The unit tests above would all pass against an order shape nobody ships. This one is the claim
// that matters: the gap the reader is now told about is a gap the bundled data actually has, and
// it is the one the old count could never report. Derived from the files rather than from a list
// of which orders are affected, which is the enumeration this repository keeps being bitten by.
test('the bundled orders carry a gap the payload field never reported', () => {
  const dataDir = join(ROOT, 'src', 'data');
  const catalog = JSON.parse(readFileSync(join(dataDir, 'catalog.json'), 'utf8'));
  const lists = catalog.lists ?? catalog;
  assert.ok(lists.length > 0);

  let empty = 0;
  let placeholders = 0;
  let claimed = 0;
  let affected = 0;
  for (const list of lists) {
    const order = JSON.parse(readFileSync(join(dataDir, list.file), 'utf8'));
    const gaps = countOrderGaps(order);
    empty += gaps.empty;
    placeholders += gaps.placeholders;
    claimed += Number(order.placeholders) || 0;
    if (gaps.empty > 0) affected += 1;
    // The payload field records raw placeholder flags. One legacy item has since gained launch
    // metadata without rewriting its pinned provenance, so the item-derived openability count is
    // intentionally one lower while the raw field must still agree with the raw flags.
    if (order.placeholders != null) {
      assert.equal(
        order.items.filter((item) => item.placeholder === true).length,
        Number(order.placeholders),
        `${list.file}: placeholder field disagrees with its item flags`,
      );
    }
  }

  assert.ok(empty > 0, 'no bundled order has an item that came back empty, so this check proves nothing');
  // Read on 2026-08-15 across the fourteen bundled orders, then re-derived on 2026-08-26 after
  // WandaVision, Spider-Man: Far From Home, and the Modern X-Men Fast Track order merged in
  // from main, and again the same day after the Amazing Spider-Man complete guide added 106
  // placeholders of its own. The Iron Man guide then added seven owner-confirmed issue ids that
  // the live metadata index does not list. The Abomination guide retains one empty response after
  // its Ghost Rider identity was corrected. The Ant-Man guide adds three researched identities
  // whose optional details were refused, bringing the total to 90 across nine affected orders.
  // Written down as observations rather than
  // floors: they move whenever an order is added or re-vendored, and moving one should mean editing
  // this line deliberately rather than watching a range quietly widen.
  //
  // The placeholder figures were 0 until the X-Men order arrived with six. The Captain America
  // guide carries 69 raw source-preserving flags, but one representative cover record also carries
  // valid launch metadata, leaving 68 unopenable placeholders in that guide. The
  // Deadpool guide adds two provider-metadata gaps with official issue identities. Black Panther
  // adds four source-preserving metadata gaps with distinct negative identifiers. Doctor Strange
  // adds 39 source-preserving metadata gaps with distinct negative identifiers. Daredevil now
  // carries no placeholders after its owner-reviewed availability settlement. Venom adds 33
  // further source-preserving metadata gaps with distinct negative identifiers. Punisher adds 158
  // distinct placeholders; its 23 repeated source occurrences remain evidence, not duplicate rows.
  // Magneto adds 58 cached-provider gaps. Loki adds 18 distinct source-occurrence gaps. Silver
  // Surfer adds four source-preserving metadata gaps. Black Widow adds fourteen, Moon Knight adds 18,
  // and X-Force adds 23 source-position metadata gaps. Inhumans adds 42 more. Young Avengers adds
  // 55 source-preserving placeholders. Fantastic Four adds 185 individually preserved cache-only
  // provider gaps, Guardians adds 29, and Defenders adds 23 without substituting a source identity.
  // Nick Fury and S.H.I.E.L.D. adds 194 individually preserved source-position gaps without
  // claiming a metadata match. Adam Warlock adds four more source-preserving metadata gaps.
  // Three Amazing Spider-Man placeholders now resolve to seven exact issues. Five carry provider
  // metadata, while two keep official issue links beside an explicit provider refusal.
  // Ant-Man adds three exact official links with explicit provider refusals.
  assert.equal(claimed, 1885, 'the payload placeholder total moved; re-derive the figures in the record');
  assert.equal(placeholders, 1884, 'the bundled unopenable-placeholder total moved; re-derive the figures in the record');
  assert.equal(empty, 90);
  assert.equal(affected, 9);
});

// Every check above passes with the import path reverted, because they all call the counter
// directly and the defect was never in a counter. It was in which number import read. So the one
// assertion that would have caught the original bug is this one: that the announcement is built
// from the items and no longer from the field.
//
// Asserted against the source text because `importCurated` needs a document, a store and a fetch
// to run, which is the same reason `test/library.test.js` reads this file rather than calling it.
test('import builds its gap disclosure from the items, not from the order payload', () => {
  const main = readFileSync(join(ROOT, 'src', 'js', 'main.js'), 'utf8');
  const body = main.slice(main.indexOf('async function importCurated('), main.indexOf('// ------------------------------------------------------------------ progress'));
  assert.ok(body.length > 0, 'importCurated is no longer where this check looks for it');
  assert.match(body, /parts\.push\(\.\.\.orderGapSentences\(order\)\);/, 'the import summary no longer says what the order is missing');
  assert.ok(
    !/order\.placeholders/.test(body),
    'import reads the placeholder count off the order payload again, which is 0 for every order this app ships',
  );
});

// The same shape of check for the same reason, and it is the one assertion that can fail if import
// starts asserting metadata it does not have again. Every other check of the refusal builds its own
// state and so passes with this call site reverted; the defect was never in the model.
//
// 19,619 of the 19,709 non-placeholder curated items carry metadata and 90 do not, so
// `hydrated: true` over the map was a statement about the whole file that was false for 61
// distinct issues.
test('import lets each curated item speak for itself rather than asserting metadata over the file', () => {
  const main = readFileSync(join(ROOT, 'src', 'js', 'main.js'), 'utf8');
  const body = main.slice(main.indexOf('async function importCurated('), main.indexOf('// ------------------------------------------------------------------ progress'));
  assert.ok(body.length > 0, 'importCurated is no longer where this check looks for it');
  // Comments stripped before the search, because the comment at the call site names the thing it
  // says is not there. A source check that reads prose as code fails on the fix that satisfies it.
  const code = body.replace(/^\s*\/\/.*$/gm, '');
  assert.match(code, /source: 'curated'/, 'curated items no longer say where they came from, which is what marks the empty ones refused');
  assert.ok(
    !/hydrated:\s*true/.test(code),
    'import asserts every curated item arrived with its details again, which is false for 90 of them',
  );
});

// ------------------------------------------------- a refusal is not a thing still to be tried

// Two absences had been one. An issue holding no metadata was called "pending" whether nobody had
// asked about it yet or upstream had already answered that it holds no such issue, and the second
// is not something waiting to happen. A curated order is the output of a completed vendoring run,
// so an item arriving from one with nothing on it has already been asked about, and the answer was
// no. That is knowable at the moment it is added, without asking anything.
test('a curated item that arrived with nothing is refused, not pending', () => {
  const n = normalizeIssue({ issueId: 7, title: 'X', source: 'curated' });
  assert.equal(n.detailsRefused, true);
  assert.equal(n.hydrated, false, 'a refusal must not also read as fetched, or nothing ever says so');
});

test('a curated item that arrived with metadata is neither refused nor pending', () => {
  const n = normalizeIssue({ issueId: 7, title: 'X', source: 'curated', digitalId: 900 });
  assert.equal(n.detailsRefused, false);
  assert.equal(n.hydrated, true);
});

// The distinction is between sources, not between empty and full. A checklist imported from
// Markdown carries no metadata either, and that one genuinely is waiting: nothing has looked it up.
test('an issue imported from a checklist is still pending, having never been asked about', () => {
  const n = normalizeIssue({ issueId: 7, title: 'X', source: 'import' });
  assert.equal(n.detailsRefused, false);
  assert.equal(n.hydrated, false);
});

// No migration was written for this, and the reason it needs none is that coerce runs every stored
// issue back through normalizeIssue on load. A tracker imported before this existed therefore
// corrects itself the next time it is opened rather than staying wrong until a re-import. The
// stored hydrated: true is the false assertion import used to make over the whole file.
test('a tracker imported before this existed is corrected when it next loads', () => {
  const raw = {
    schemaVersion: SCHEMA_VERSION,
    issues: { 7: { issueId: 7, title: 'Ultimate Black Panther (2024) #22', source: 'curated', hydrated: true } },
    lists: { a: { id: 'a', name: 'L', itemIds: [7] } },
    listOrder: ['a'],
  };
  const s = migrate(raw);
  assert.equal(s.issues[7].detailsRefused, true);
  assert.equal(s.issues[7].hydrated, false);
  assert.equal(s.issues[7].title, 'Ultimate Black Panther (2024) #22', 'coercion rewrote the title it was correcting the flag on');
});

// The flag has to survive the round trip on its own, or a refusal met at runtime is forgotten the
// next time the app opens and the issue rejoins the queue it had left.
test('a refusal recorded at runtime survives a save and a load', () => {
  const stored = { issueId: 7, title: 'X', source: 'import', hydrated: false, detailsRefused: true };
  assert.equal(normalizeIssue(stored).detailsRefused, true);
});

// Not clampScalar, which would take any truthy value. A hand-edited backup saying "yes" must not
// become a refusal, because the reader has no control that clears one.
test('only a true boolean is read as a refusal, so a hand-edited backup cannot invent one', () => {
  assert.equal(normalizeIssue({ issueId: 7, source: 'import', detailsRefused: 'yes' }).detailsRefused, false);
  assert.equal(normalizeIssue({ issueId: 7, source: 'import', detailsRefused: 1 }).detailsRefused, false);
});

// This set is both the retry queue and the number printed on the button that offers to work through
// it, so a refusal left in it spends the reader's own request budget to be told the same thing
// again, and promises details that are never going to arrive.
test('a refused issue is not offered for fetching', () => {
  let s = createList(createEmptyState(), { name: 'L' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [
    { issueId: 1, title: 'A', source: 'import' },
    { issueId: 2, title: 'B', source: 'curated' },
  ]).state;
  assert.deepEqual(pendingIssueIds(s), [1], 'the refused issue is still queued for a lookup that can only fail');
});

// Written through its own updater rather than through upsertIssue, and this is why: upsertIssue
// normalizes what it is handed, a bare { issueId } normalizes to a title of "Issue 7", that is not
// null so stripNulls keeps it, and the merge would replace the real title with a placeholder. The
// bug would show as issue titles turning into their own numbers as lookups failed.
test('recording a refusal does not overwrite what is already known about the issue', () => {
  let s = createList(createEmptyState(), { name: 'L' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [{ issueId: 7, title: 'Real Title (2024) #1', source: 'import', seriesName: 'Real Series' }]).state;
  const after = markDetailsRefused(s, 7);
  assert.equal(after.issues[7].detailsRefused, true);
  assert.equal(after.issues[7].title, 'Real Title (2024) #1');
  assert.equal(after.issues[7].seriesName, 'Real Series');
});

test('recording a refusal twice, or for an issue that is not held, changes nothing', () => {
  let s = createList(createEmptyState(), { name: 'L' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [{ issueId: 7, title: 'A', source: 'import' }]).state;
  const once = markDetailsRefused(s, 7);
  assert.equal(markDetailsRefused(once, 7), once, 'a second write is a second persist to the origin for no change');
  assert.equal(markDetailsRefused(s, 999), s, 'an issue the tracker does not hold was written into it');
});

// A later successful sighting has to clear the flag, or an issue upstream has since gained a record
// for stays marked as refused forever. stripNulls keeps false, so the incoming answer wins.
test('a successful lookup clears a refusal rather than leaving it stuck', () => {
  let s = createList(createEmptyState(), { name: 'L' });
  const id = s.listOrder[0];
  s = addIssuesToList(s, id, [{ issueId: 7, title: 'A', source: 'curated' }]).state;
  assert.equal(s.issues[7].detailsRefused, true);
  s = upsertIssue(s, { issueId: 7, title: 'A', source: 'api', digitalId: 42, hydrated: true });
  assert.equal(s.issues[7].detailsRefused, false);
  assert.equal(s.issues[7].hydrated, true);
});

// The unit tests above would all pass against data nobody ships. This is the claim that matters:
// the shipped catalog really does contain items that no lookup will ever answer for, and the number
// of issues the app was offering to fetch was that many too high. Derived from the files rather
// than from a list of which orders are affected.
test('the bundled orders really do contain issues no lookup can answer for', () => {
  const dataDir = join(ROOT, 'src', 'data');
  const catalog = JSON.parse(readFileSync(join(dataDir, 'catalog.json'), 'utf8'));
  const lists = catalog.lists ?? catalog;

  let s = createEmptyState();
  for (const list of lists) {
    const order = JSON.parse(readFileSync(join(dataDir, list.file), 'utf8'));
    s = createList(s, { name: list.name });
    const id = s.listOrder[s.listOrder.length - 1];
    s = addIssuesToList(s, id, order.items.map((i) => ({ ...i, source: 'curated' }))).state;
  }

  const refused = Object.values(s.issues).filter((i) => i.detailsRefused);
  // 74 items across four orders, which include 45 distinct issues because the two Ultimate orders
  // overlap. Read on 2026-08-14; written down as an observation rather than a floor, so
  // re-vendoring an order means editing this line deliberately.
  //
  // Deliberately edited on 2026-08-15, from 34 to 40. The X-Men orders added six checklist lines
  // carrying no Marvel link, which vendor as placeholders with negative ids, and a placeholder is
  // refused on arrival for the same reason an empty item is: no lookup will ever answer for it.
  // The six are two distinct issues in the spine and four in the complete variant, counted twice
  // over because a placeholder's id is hashed from the order it sits in as well as its title. The
  // Ultimate figure is unchanged at 34, which is the check that this grew for the stated reason
  // rather than because an order regressed.
  //
  // Deliberately edited on 2026-08-26, from 40 to 49. WandaVision added nine exact Marvel issue
  // pages that the metadata API refuses while keeping their official issue links.
  //
  // Deliberately edited again the same day, from 49 to 155. The Amazing Spider-Man complete guide
  // adds 106 checklist lines with no Marvel link, each hashed to its own placeholder id by title
  // and order, so all 106 are distinct new refusals with nothing else in the catalog to collide
  // with.
  //
  // Deliberately edited again the same day, from 155 to 162. The Iron Man guide added seven
  // owner-confirmed issue ids that the live metadata index does not list, and none repeat an id
  // already present in the bundled catalog.
  //
  // Deliberately edited on 2026-09-03, from 1,938 to 1,941. The Ant-Man guide adds three exact
  // official links whose optional metadata requests were refused.
  //
  // The Abomination guide retains one exact issue page with no metadata response after its
  // Ghost Rider identity was corrected. Captain
  // America adds 69 placeholders, 68 of which are new negative identifiers because its cover
  // record already has a pinned Marvel issue id. Deadpool adds two official issue identities
  // that the provider also cannot answer. Black Panther adds four negative placeholder identifiers.
  // Doctor Strange adds 39 more negative placeholder identifiers. Daredevil now adds none after
  // its availability settlement. Venom adds 33 more negative
  // placeholder identifiers. Punisher adds 158 distinct placeholders while retaining 23 repeated
  // source occurrences without duplicate identifiers. Magneto adds 58. Loki adds 18. Silver
  // Surfer adds four. Black Widow adds fourteen, Moon Knight adds 18, X-Force adds 23, Inhumans
  // adds 42, and Young Avengers adds 55. Fantastic Four adds 185, Guardians adds 29, Defenders
  // adds 23, Nick Fury and S.H.I.E.L.D. adds 194, and Adam Warlock adds four.
  assert.equal(refused.length, 1941);
  assert.equal(pendingIssueIds(s).length, 0, 'the app is still offering to fetch details that do not exist');
});
