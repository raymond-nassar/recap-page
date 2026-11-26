// Lists whose source publishes both an issue by issue order and a collected edition (book by book)
// order over the same comics. Both orders hold exactly the list's comics: a comic only a book
// collects is named in `notInList` for About this list rather than added, so switching never adds
// or removes a comic and a reader's progress, notes and ratings stay on the comics they belong to.
//
// `issueOrder` is the published list file's order. The book order is every book's comics in the
// order the source lists its books, then `unbooked`: the comics no listed book collects, kept
// together by series, each series where it first appears in the issue order. A choice that declares
// `bookSteps` gives its book order explicitly instead, as described at `declaredBookSections`.
export const READING_ORDER_CHOICES = [
  {
    catalogId: 'war-of-the-realms',
    source: 'https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/war-of-the-realms-reading-order/',
    retrieved: '2026-11-19',
    issueOrder: [
      69970, 70797, 71271, 71217, 76331, 73996, 76615, 76616, 77259, 70769, 69934, 71273, 73997, 75886, 75887, 75888,
      68016, 71051, 71052, 74065, 74066, 74067, 76332, 71361, 75448, 75450, 75451, 71274, 76333, 76618, 75484, 75482,
      71362, 73808, 73809, 75483, 70791, 76613, 76614, 76910, 71218, 71219, 71275, 76442, 76443, 77262, 77255, 76617,
      77261, 70755, 70756, 74006, 74007, 71053, 73998, 71276, 76911, 71277, 70792, 77260, 74814, 77667, 77480, 75872,
      70793, 78577,
    ],
    books: [
      { name: 'War of the Realms', issueIds: [71271, 71273, 71274, 71275, 71276, 71277, 74814] },
      { name: 'Thor Vol. 3', issueIds: [69934, 70791, 70792, 70793] },
      { name: 'War of the Realms: Journey Into Mystery', issueIds: [76331, 76613, 76614, 76910, 76911] },
      { name: 'War of the Realms: New Agents of Atlas', issueIds: [76615, 76616, 77259, 77260] },
      { name: 'War of the Realms: Giant-Man', issueIds: [75448, 75450, 75451] },
      { name: 'War of the Realms: Amazing Spider-Man/Daredevil', issueIds: [76333, 76618, 77262] },
      { name: 'War of the Realms: Venom', issueIds: [74065, 74066, 74067] },
      { name: 'Asgardians of the Galaxy Vol. 2', issueIds: [73996, 73997, 73998] },
    ],
    unbooked: [
      69970, 70797, 71217, 71218, 71219, 70769, 75886, 75887, 75888, 68016, 71051, 71052, 71053, 76332, 76617, 77261,
      71361, 71362, 75484, 75482, 73808, 73809, 75483, 76442, 76443, 77255, 70755, 70756, 74006, 74007, 77667, 77480,
      75872, 78577,
    ],
    notInList: [
      'the War of the Realms Prelude book',
      'Thor (2018) #16',
      'Venom (2018) #16',
      'Venom: Cult of Carnage #1',
      'Asgardians of the Galaxy (2018) #6 and #7',
    ],
  },
];

export const READING_ORDERS = {
  issue: { label: 'Issue by issue', description: 'Every comic in the order it happens in the story.' },
  book: { label: 'Book by book', description: 'Finish each collected book before starting the next.' },
};

export function readingOrderChoiceFor(list) {
  if (!list?.catalogId) return null;
  return READING_ORDER_CHOICES.find((choice) => choice.catalogId === list.catalogId) ?? null;
}

// A source can place a comic no book collects before, between or after its books, and appending
// every such comic after the last book would move it out of the place the source gives it. So a
// choice may declare `bookSteps` instead of `unbooked`: its book order as `{ book: name }` and
// `{ issueId }` entries. A source can also give a comic a place in its issue order and none among
// its books, and putting that comic after the finale would claim a place the source never gave
// it, so such comics go in `issueOrderOnly`, kept in issue order and apart from the book steps.
// Together the two must name every book once and every comic exactly once, because a comic left
// out or repeated would add or drop a comic on a switch.
function declaredBookSections(choice) {
  if (choice.unbooked !== undefined) throw new Error(`${choice.catalogId} declares both bookSteps and unbooked.`);
  const known = new Set(choice.issueOrder);
  if (known.size !== choice.issueOrder.length) throw new Error(`${choice.catalogId} lists a comic twice in its issue order.`);
  const books = new Map(choice.books.map((book) => [book.name, book.issueIds]));
  if (books.size !== choice.books.length) throw new Error(`${choice.catalogId} names a book twice.`);
  const placed = new Set();
  const order = [];
  for (const step of choice.bookSteps) {
    const isBook = Object.hasOwn(step ?? {}, 'book');
    if (isBook === Object.hasOwn(step ?? {}, 'issueId')) throw new Error(`${choice.catalogId} has a book step that is neither one book nor one comic.`);
    if (isBook && !books.has(step.book)) throw new Error(`${choice.catalogId} places a book it does not list: ${step.book}.`);
    if (isBook && placed.has(step.book)) throw new Error(`${choice.catalogId} places a book twice: ${step.book}.`);
    if (isBook) placed.add(step.book);
    order.push(...(isBook ? books.get(step.book) : [step.issueId]));
  }
  const missing = choice.books.find((book) => !placed.has(book.name));
  if (missing) throw new Error(`${choice.catalogId} does not place the book ${missing.name}.`);
  const issueOrderOnly = choice.issueOrderOnly ?? [];
  const all = order.concat(issueOrderOnly);
  if (new Set(all).size !== all.length || all.length !== known.size || all.some((id) => !known.has(id))) {
    throw new Error(`${choice.catalogId} book order does not hold each of its comics exactly once.`);
  }
  const unplaced = new Set(issueOrderOnly);
  if (choice.issueOrder.filter((id) => unplaced.has(id)).some((id, index) => id !== issueOrderOnly[index])) {
    throw new Error(`${choice.catalogId} does not keep its issue order only comics in issue order.`);
  }
  return { placed: order, issueOrderOnly };
}

// The book order in two parts: `placed`, the books and single comics in the order the source sets
// them, and `issueOrderOnly`, the comics it places only in its issue order.
export function bookSectionsOf(choice) {
  if (choice.bookSteps !== undefined) return declaredBookSections(choice);
  if (choice.issueOrderOnly !== undefined) throw new Error(`${choice.catalogId} declares issueOrderOnly without bookSteps.`);
  return { placed: choice.books.flatMap((book) => book.issueIds).concat(choice.unbooked), issueOrderOnly: [] };
}

// A saved list holds one order, and no single order can keep comics apart from the books without
// saying they come before or after them, so a choice with issue order only comics has no book order
// to save until a layout carries the second part.
export function bookOrderOf(choice) {
  const { placed, issueOrderOnly } = bookSectionsOf(choice);
  if (issueOrderOnly.length) throw new Error(`${choice.catalogId} has comics placed only in its issue order, so it has no single book order.`);
  return placed;
}

// The comic id to book name map the book order gives its comics.
export function bookNamesOf(choice) {
  const names = new Map();
  for (const book of choice.books) for (const id of book.issueIds) names.set(id, book.name);
  return names;
}

export function orderIdsFor(choice, order) {
  if (order === 'issue') return choice.issueOrder;
  if (order === 'book') return bookOrderOf(choice);
  throw new Error('That reading order is not available.');
}

// Which order a saved list is in: 'issue', 'book', 'custom' when the reader has rearranged it, or
// null when the list has no choice. Only the comics both the list and the order hold are compared,
// so a hand-added comic or a removed one does not count as a rearrangement. The two orders can agree
// on what is left of a list, and then the book headings decide, because they are what a reader sees.
export function currentReadingOrder(list, choice = readingOrderChoiceFor(list)) {
  if (!choice || !Array.isArray(list?.itemIds)) return null;
  // Validate before hiding a split projection: malformed declarations still need to fail, but a
  // valid second section cannot be represented by this saved list's two-way order switch.
  if (choice.bookSteps !== undefined || choice.issueOrderOnly !== undefined) {
    if (bookSectionsOf(choice).issueOrderOnly.length) return null;
  }
  const held = new Set(list.itemIds);
  // A list left with one of the order's comics has nothing to arrange.
  if (choice.issueOrder.filter((id) => held.has(id)).length < 2) return null;
  const follows = (order) => {
    const shared = order.filter((id) => held.has(id));
    const known = new Set(order);
    const saved = list.itemIds.filter((id) => known.has(id));
    return shared.length === saved.length && shared.every((id, index) => id === saved[index]);
  };
  const names = bookNamesOf(choice);
  const labelled = list.itemIds.some((id) => names.has(id) && list.collectedIn?.[id] === names.get(id));
  const issue = follows(choice.issueOrder);
  const book = follows(bookOrderOf(choice));
  if (issue && book) return labelled ? 'book' : 'issue';
  if (book) return 'book';
  if (issue) return 'issue';
  return 'custom';
}

// The comics the collected books hold that the list leaves out, for a list that offers the switch.
export function booksLeaveOut(list) {
  const choice = readingOrderChoiceFor(list);
  return choice && currentReadingOrder(list, choice) !== null ? choice.notInList : [];
}
