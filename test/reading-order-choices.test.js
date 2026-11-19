import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEY, Store } from '../src/js/storage.js';
import { applyListRevision, readingOrderArrangement, switchReadingOrder } from '../src/js/lib/listCorrection.js';
import { saveListRevision } from '../src/js/lib/listRevisionSave.js';
import {
  addIssuesToList, createEmptyState, createList, markRead, removeFromList, setDeferred, setIssueNote, setIssueRating, upNext,
} from '../src/js/lib/model.js';
import {
  bookNamesOf, bookOrderOf, booksLeaveOut, currentReadingOrder, READING_ORDER_CHOICES, readingOrderChoiceFor,
} from '../src/js/lib/readingOrderChoices.js';

const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const [choice] = READING_ORDER_CHOICES;

function published(entry) {
  const listed = catalog.lists.find(({ id }) => id === entry.catalogId);
  return JSON.parse(readFileSync(new URL(`../src/data/${listed.file}`, import.meta.url), 'utf8')).items;
}

function readerState() {
  let state = createList(createEmptyState(), { id: 'wotr', name: 'The War of the Realms', catalogId: choice.catalogId });
  state = addIssuesToList(state, 'wotr', published(choice), { sort: false }).state;
  state = markRead(state, choice.issueOrder[0], true, 111);
  state = setIssueNote(state, choice.issueOrder[1], 'Loved the cliffhanger.');
  state = setIssueRating(state, choice.issueOrder[2], 4);
  return state;
}

const signature = (state) => JSON.stringify(state.lists.wotr);
const withList = (state, list) => ({ ...state, lists: { ...state.lists, [list.id]: list } });

test('every listed choice holds exactly its published comics in both orders', () => {
  for (const entry of READING_ORDER_CHOICES) {
    const items = published(entry);
    assert.deepEqual(entry.issueOrder, items.map(({ issueId }) => issueId), entry.catalogId);
    const books = bookOrderOf(entry);
    assert.equal(new Set(books).size, books.length, `${entry.catalogId} repeats a comic in its book order`);
    assert.deepEqual([...books].sort((a, b) => a - b), [...entry.issueOrder].sort((a, b) => a - b), entry.catalogId);
    // The comics no book collects stay together by series, each series where it first appears.
    const booked = bookNamesOf(entry);
    const series = new Map(items.map(({ issueId, seriesId }) => [issueId, seriesId]));
    const firstSeen = [];
    for (const id of entry.issueOrder) if (!booked.has(id) && !firstSeen.includes(series.get(id))) firstSeen.push(series.get(id));
    const expected = firstSeen.flatMap((seriesId) => entry.issueOrder.filter((id) => !booked.has(id) && series.get(id) === seriesId));
    assert.deepEqual(entry.unbooked, expected, entry.catalogId);
  }
});

test('switching re-sorts the comics into book order and back without touching progress, notes or ratings', () => {
  const state = readerState();
  const book = switchReadingOrder(state, 'wotr', signature(state), 'book');
  assert.deepEqual(book.lists.wotr.itemIds, bookOrderOf(choice));
  assert.equal(Object.keys(book.lists.wotr.collectedIn).length, 32);
  assert.equal(book.lists.wotr.collectedIn[71271], 'War of the Realms');
  assert.equal(currentReadingOrder(book.lists.wotr), 'book');
  for (const key of ['read', 'notes', 'ratings', 'issues', 'active']) assert.deepEqual(book[key], state[key], key);

  const back = switchReadingOrder(book, 'wotr', signature(book), 'issue');
  assert.deepEqual(back.lists.wotr, state.lists.wotr);
  assert.equal(currentReadingOrder(back.lists.wotr), 'issue');
});

test('a switch adds nothing back and keeps hand-added and set-aside comics where the reader left them', () => {
  let state = removeFromList(readerState(), 'wotr', 71273);
  const list = state.lists.wotr;
  const anchor = list.itemIds.indexOf(71271);
  state = withList(state, {
    ...list,
    itemIds: [...list.itemIds.slice(0, anchor), 999001, ...list.itemIds.slice(anchor)],
    collectedIn: { 999001: 'My own book' },
  });
  state = setDeferred(state, 'wotr', 75448, true);
  for (const target of ['book', 'issue']) {
    state = switchReadingOrder(state, 'wotr', signature(state), target);
    const { itemIds, collectedIn, deferredIssueIds } = state.lists.wotr;
    assert.equal(itemIds.includes(71273), false, target);
    assert.equal(itemIds.length, 66, target);
    assert.equal(itemIds[itemIds.indexOf(71271) - 1], 999001, target);
    assert.equal(collectedIn[999001], 'My own book', target);
    assert.deepEqual(deferredIssueIds, [75448], target);
  }
});

test('a rearranged list is recognised as custom, and either order puts it back', () => {
  const state = readerState();
  const ids = [...state.lists.wotr.itemIds];
  [ids[0], ids[1]] = [ids[1], ids[0]];
  const custom = withList(state, { ...state.lists.wotr, itemIds: ids });
  assert.equal(currentReadingOrder(custom.lists.wotr), 'custom');
  assert.deepEqual(switchReadingOrder(custom, 'wotr', signature(custom), 'issue').lists.wotr.itemIds, choice.issueOrder);
  assert.deepEqual(switchReadingOrder(custom, 'wotr', signature(custom), 'book').lists.wotr.itemIds, bookOrderOf(choice));
});

test('a switch to the order the list is already in changes nothing, and a stale or ordinary list is refused', () => {
  const state = readerState();
  assert.equal(switchReadingOrder(state, 'wotr', signature(state), 'issue'), state);
  assert.throws(() => switchReadingOrder(state, 'wotr', '{}', 'book'), /saved list changed/);
  assert.throws(() => switchReadingOrder(state, 'wotr', signature(state), 'sideways'), /not available/);
  const plain = createList(createEmptyState(), { id: 'plain', name: 'Mine', itemIds: [1, 2] });
  assert.throws(() => switchReadingOrder(plain, 'plain', JSON.stringify(plain.lists.plain), 'book'), /only one reading order/);
  assert.equal(currentReadingOrder(plain.lists.plain), null);
});

test('only a list that offers the switch names what the books leave out', () => {
  const state = readerState();
  assert.deepEqual(booksLeaveOut(state.lists.wotr), choice.notInList);
  assert.deepEqual(booksLeaveOut({ catalogId: 'house-of-m', itemIds: [1, 2] }), []);
  const single = { ...state.lists.wotr, itemIds: [choice.issueOrder[0], 999001] };
  assert.equal(currentReadingOrder(single), null);
  assert.deepEqual(booksLeaveOut(single), []);
  assert.equal(readingOrderChoiceFor(null), null);
});

test('the book order moves a fresh reader to the event\'s first book', () => {
  const state = readerState();
  const arranged = readingOrderArrangement(state.lists.wotr, choice, 'book');
  assert.equal(upNext(state, 'wotr').issueId, choice.issueOrder[1]);
  assert.equal(upNext(withList(state, arranged), 'wotr').issueId, 71271);
});

test('an update keeps book names whole on a book by book list and drops them from any other order', () => {
  const items = published(choice);
  const byId = new Map(items.map((item) => [item.issueId, item]));
  let book = switchReadingOrder(readerState(), 'wotr', signature(readerState()), 'book');
  book = removeFromList(book, 'wotr', 71273);
  const restored = applyListRevision(book, 'wotr', signature(book), bookOrderOf(choice).map((id) => byId.get(id)));
  assert.deepEqual(restored.lists.wotr.itemIds, bookOrderOf(choice));
  assert.equal(restored.lists.wotr.collectedIn[71273], 'War of the Realms');
  assert.equal(currentReadingOrder(restored.lists.wotr), 'book');

  const ids = [...book.lists.wotr.itemIds];
  [ids[0], ids[1]] = [ids[1], ids[0]];
  const custom = withList(book, { ...book.lists.wotr, itemIds: ids });
  const issue = applyListRevision(custom, 'wotr', signature(custom), items);
  assert.deepEqual(issue.lists.wotr.itemIds, choice.issueOrder);
  assert.equal(choice.issueOrder.some((id) => issue.lists.wotr.collectedIn[id] !== undefined), false);
  assert.equal(currentReadingOrder(issue.lists.wotr), 'issue');
});

function storeFixture() {
  const values = new Map();
  const storage = {
    mode: 'normal',
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) {
      if (this.mode === 'throw') throw new Error('quota');
      if (this.mode === 'silent') return;
      values.set(key, value);
    },
    removeItem(key) { values.delete(key); },
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
  };
  const store = new Store({ storage });
  store.load();
  store.update(() => readerState());
  return { store, storage };
}

test('a switch is reported only once its saved state reads back, and a failed save changes nothing', () => {
  const ok = storeFixture();
  const result = saveListRevision(ok.store, 'wotr', signature(ok.store.state), 'book', switchReadingOrder);
  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  const saved = JSON.parse(ok.storage.getItem(KEY));
  assert.deepEqual(saved.lists.wotr.itemIds, bookOrderOf(choice));
  assert.equal(saved.read[choice.issueOrder[0]], 111);

  for (const mode of ['throw', 'silent']) {
    const { store, storage } = storeFixture();
    const before = storage.getItem(KEY);
    const list = structuredClone(store.state.lists.wotr);
    storage.mode = mode;
    const failed = saveListRevision(store, 'wotr', signature(store.state), 'book', switchReadingOrder);
    assert.equal(failed.ok, false, mode);
    assert.equal(failed.changed, false, mode);
    assert.equal(storage.getItem(KEY), before, mode);
    assert.deepEqual(store.state.lists.wotr, list, mode);
  }
});
