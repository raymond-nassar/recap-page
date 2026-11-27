import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEY, Store } from '../src/js/storage.js';
import { applyListRevision, readingOrderArrangement, switchReadingOrder } from '../src/js/lib/listCorrection.js';
import { saveListRevision } from '../src/js/lib/listRevisionSave.js';
import { switchProblem } from '../src/js/views/reading-order-switch.js';
import {
  addIssuesToList, createEmptyState, createList, exportBackup, markRead, MAX_BACKUP_BYTES, MAX_DESCRIPTION, removeFromList,
  setDeferred, setIssueNote, setIssueRating, upNext,
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
    if (entry.bookSteps === undefined) assert.deepEqual(entry.unbooked, expected, entry.catalogId);
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

// The shipped comics with a declared book order that puts single comics before, between and after
// books, the shape a source gives when it opens with a one-shot or ends with an epilogue.
function steppedChoice() {
  const { unbooked, ...rest } = choice;
  const [opening, between, ...others] = unbooked;
  const [first, ...laterBooks] = choice.books;
  const bookSteps = [
    { issueId: opening }, { book: first.name }, { issueId: between },
    ...laterBooks.map(({ name }) => ({ book: name })), ...others.map((issueId) => ({ issueId })),
  ];
  return { ...rest, bookSteps };
}

test('a declared book order keeps single comics before, between and after books', () => {
  const stepped = steppedChoice();
  const order = bookOrderOf(stepped);
  const [opening, between] = choice.unbooked;
  assert.equal(order[0], opening);
  assert.deepEqual(order.slice(1, 8), choice.books[0].issueIds);
  assert.equal(order[8], between);
  assert.equal(order.at(-1), choice.unbooked.at(-1));
  assert.equal(order.at(-2), choice.unbooked.at(-2));

  const state = readerState();
  const arranged = readingOrderArrangement(state.lists.wotr, stepped, 'book');
  assert.deepEqual(arranged.itemIds, order);
  assert.equal(Object.hasOwn(arranged.collectedIn, opening), false);
  assert.equal(arranged.collectedIn[choice.books[0].issueIds[0]], choice.books[0].name);
  assert.equal(currentReadingOrder(arranged, stepped), 'book');
  assert.deepEqual(readingOrderArrangement(arranged, stepped, 'issue'), state.lists.wotr);
  // Book names still come from the books alone, so a declared order cannot relabel a single comic.
  assert.deepEqual(bookNamesOf(stepped), bookNamesOf(choice));
});

test('a declared book order that would add, drop or repeat a comic or a book is refused', () => {
  const stepped = steppedChoice();
  const [first] = stepped.bookSteps;
  const book = stepped.bookSteps[1];
  const invalid = {
    'both declarations': { ...stepped, unbooked: [] },
    'a book placed twice': { ...stepped, bookSteps: [...stepped.bookSteps, book] },
    'a book left out': { ...stepped, bookSteps: stepped.bookSteps.filter((step) => step !== book) },
    'an unknown book': { ...stepped, bookSteps: [...stepped.bookSteps, { book: 'Not a book' }] },
    'a comic placed twice': { ...stepped, bookSteps: [...stepped.bookSteps, first] },
    'a comic left out': { ...stepped, bookSteps: stepped.bookSteps.slice(1) },
    'a comic the list lacks': { ...stepped, bookSteps: [...stepped.bookSteps.slice(1), { issueId: 999001 }] },
    'a booked comic placed alone': { ...stepped, bookSteps: [...stepped.bookSteps, { issueId: choice.books[0].issueIds[0] }] },
    'a step that is both': { ...stepped, bookSteps: [{ ...first, book: book.book }, ...stepped.bookSteps.slice(1)] },
    'a step that is neither': { ...stepped, bookSteps: [{}, ...stepped.bookSteps] },
    'a book named twice': { ...stepped, books: [...stepped.books, stepped.books[0]] },
    'a comic listed twice in the issue order': {
      catalogId: 'repeat', issueOrder: [901, 901, 902], books: [{ name: 'Book', issueIds: [902] }],
      bookSteps: [{ issueId: 901 }, { book: 'Book' }],
    },
  };
  for (const [name, entry] of Object.entries(invalid)) assert.throws(() => bookOrderOf(entry), Error, name);
});

test('comics a source places only in its issue order stay apart from the book order, in issue order', async () => {
  const { bookSectionsOf } = await import('../src/js/lib/readingOrderChoices.js');
  assert.equal(typeof bookSectionsOf, 'function');
  const stepped = steppedChoice();
  const [opening, between] = choice.unbooked;
  const kept = new Set([opening, between, ...choice.books.flatMap(({ issueIds }) => issueIds)]);
  const issueOrderOnly = choice.issueOrder.filter((id) => !kept.has(id));
  const split = { ...stepped, bookSteps: stepped.bookSteps.filter((step) => !Object.hasOwn(step, 'issueId') || kept.has(step.issueId)), issueOrderOnly };
  const { placed, issueOrderOnly: unplaced } = bookSectionsOf(split);
  assert.deepEqual(placed, bookOrderOf(steppedChoice()).filter((id) => kept.has(id)));
  assert.deepEqual(unplaced, issueOrderOnly);
  assert.deepEqual([...placed, ...unplaced].sort((a, b) => a - b), [...choice.issueOrder].sort((a, b) => a - b));
  // No single saved order can say where those comics fall among the books, so none is offered.
  assert.throws(() => bookOrderOf(split), /no single book order/);
  assert.deepEqual(bookSectionsOf(choice), { placed: bookOrderOf(choice), issueOrderOnly: [] });
  assert.deepEqual(bookSectionsOf({ ...split, issueOrderOnly: [], bookSteps: stepped.bookSteps }).issueOrderOnly, []);
  const invalid = {
    'out of issue order': { ...split, issueOrderOnly: [...issueOrderOnly].reverse() },
    'also placed': { ...split, issueOrderOnly: [opening, ...issueOrderOnly] },
    'left out': { ...split, issueOrderOnly: issueOrderOnly.slice(1) },
    'without book steps': { ...choice, issueOrderOnly: [] },
  };
  for (const [name, entry] of Object.entries(invalid)) assert.throws(() => bookSectionsOf(entry), Error, name);
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
  const start = readerState();
  let book = switchReadingOrder(start, 'wotr', signature(start), 'book');
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

function faultyStore({ pad = false } = {}) {
  const values = new Map();
  const storage = {
    mode: 'normal',
    unreadable: false,
    getItem(key) {
      if (this.unreadable) throw new Error('read unavailable');
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      if (this.mode === 'silent') return;
      values.set(key, value);
      if (this.mode === 'unreadable') this.unreadable = true;
      if (this.mode === 'foreign') {
        const other = JSON.parse(value);
        other.writeToken = 'foreign-write';
        other.lists.wotr.name = 'Changed in another window';
        values.set(key, JSON.stringify(other));
      }
    },
    removeItem(key) { values.delete(key); },
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
  };
  const store = new Store({ storage });
  store.load();
  store.update(() => (pad ? nearlyFull(readerState()) : readerState()));
  return { store, storage, values };
}

const backupSize = (state) => new TextEncoder().encode(JSON.stringify(exportBackup(state), null, 2)).length;

// Fills the reader's saved reading with lists of the same shape until one byte below the backup
// limit, so the book titles a switch adds are the only thing that can push it over.
function nearlyFull(state) {
  const filler = (index, length) => ({
    ...createList(createEmptyState(), { id: 'x', name: 'Filler' }).lists.x,
    id: `filler-${String(index).padStart(6, '0')}`, description: 'x'.repeat(length), created: 1,
  });
  const withFillers = (count, last) => {
    const lists = Object.assign(Object.create(null), state.lists);
    const listOrder = [...state.listOrder];
    for (let index = 0; index < count; index += 1) {
      const list = filler(index, index === count - 1 ? last : MAX_DESCRIPTION);
      lists[list.id] = list;
      listOrder.push(list.id);
    }
    return { ...state, lists, listOrder };
  };
  const one = backupSize(withFillers(1, MAX_DESCRIPTION));
  const each = backupSize(withFillers(2, MAX_DESCRIPTION)) - one;
  let count = Math.floor((MAX_BACKUP_BYTES - one) / each);
  let last;
  do {
    count += 1;
    last = MAX_BACKUP_BYTES - 1 - backupSize(withFillers(count, 0));
  } while (last > MAX_DESCRIPTION);
  return withFillers(count, last);
}

test('every way a switch can fail to save shows its own plain message', () => {
  const cases = [
    ['not saved', 'The new order could not be saved. Your list is just as it was.', ({ storage }) => { storage.mode = 'silent'; }],
    ['cleared elsewhere', 'Your saved reading was cleared in another window. The order was not changed.',
      ({ storage }) => storage.removeItem(KEY)],
    ['changed elsewhere first', 'Your reading changed in another window. Choose the order again.', ({ storage, values }) => {
      const other = JSON.parse(storage.getItem(KEY));
      other.writeToken = 'other-window';
      other.lists.wotr.name = 'Changed in another window';
      values.set(KEY, JSON.stringify(other));
    }],
    ['changed while saving', 'Your reading changed in another window while saving. Check your list before trying again.',
      ({ storage }) => { storage.mode = 'foreign'; }],
    ['unreadable after saving', 'Saving has stopped to keep your reading safe. Close and reopen the app to check your list.',
      ({ storage }) => { storage.mode = 'unreadable'; }],
    ['saved but not shown', 'The new order was saved, but the page did not update. Close and reopen the app to see it.',
      ({ store }) => { store.onChange = () => { throw new Error('render failed'); }; }],
  ];
  for (const [name, message, prepare] of cases) {
    const fixture = faultyStore();
    const listSignature = signature(fixture.store.state);
    prepare(fixture);
    const result = saveListRevision(fixture.store, 'wotr', listSignature, 'book', switchReadingOrder);
    assert.equal(result.ok, false, name);
    assert.equal(switchProblem(result), message, name);
  }
  const stale = faultyStore();
  const rejected = saveListRevision(stale.store, 'wotr', '{}', 'book', switchReadingOrder);
  assert.equal(switchProblem(rejected), 'The order could not be changed. Your list is just as it was.');
});

test('a switch that would take saved reading past its size limit says so and changes nothing', () => {
  const { store, storage } = faultyStore({ pad: true });
  assert.equal(backupSize(store.state), MAX_BACKUP_BYTES - 1);
  const before = storage.getItem(KEY);
  const result = saveListRevision(store, 'wotr', signature(store.state), 'book', switchReadingOrder);
  assert.equal(result.ok, false);
  assert.equal(switchProblem(result), 'Your saved reading is too large to change the order. Nothing was changed.');
  assert.equal(storage.getItem(KEY), before);
});
