import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  parseCatalog, typeLabel, depthLabel, depthHint, catalogCategories, filterByCategory,
  searchCatalog, groupCatalog, variantLabel, defaultPath, pickPath,
  sourceLink, sourceLabel, sourceLicense, updatedLabel,
  safeOrderFile, LIST_TYPES, READING_DEPTHS, UNCATEGORIZED,
  catalogFacets, filterByFacet, facetLabel, isShortOrder, catalogCoverUrl,
  readingTimeLabel, MINUTES_PER_ISSUE, SHORT_ORDER_MAX, collectionsLabel, isTradeOrder, sortCatalog,
  countStories, shelfKey, shelfSections, CATALOG_SHELVES, pathPlacements,
  filterBySpotlightKind, spotlightKindLabel, resetCatalogNarrowing, SPOTLIGHT_KINDS,
} from '../src/js/lib/catalog.js';

test('safeOrderFile accepts a plain markdown name and nothing that escapes the orders folder', () => {
  assert.equal(safeOrderFile('new-ultimate-universe.md'), 'new-ultimate-universe.md');
  assert.equal(safeOrderFile('  spaced.md  '), 'spaced.md');
  for (const bad of [
    '../escape.md', 'orders/nested.md', 'C:\\abs.md', '/abs.md', '.hidden.md',
    'order.json', 'order', 'order.md.json', 'https://example.test/x.md', '', null, undefined, 42,
  ]) {
    assert.equal(safeOrderFile(bad), null, `accepted ${JSON.stringify(bad)}`);
  }
});

test('parses a well-formed catalog entry', () => {
  const { lists, dropped } = parseCatalog({
    lists: [{
      id: 'hickman-minimal',
      file: 'hickman_minimal.json',
      name: 'Hickman to Secret Wars: minimal',
      description: 'The essential spine.',
      type: 'creator-run',
      depth: 'essential',
      count: 89,
      source: 'https://example.com/order.md',
      sourceSection: '  X-Men: Divided We Stand  ',
      sourceLicense: 'MIT',
      updatedAt: '2026-08-04T06:14:48.695Z',
    }],
  });
  assert.equal(dropped, 0);
  assert.equal(lists.length, 1);
  assert.equal(lists[0].count, 89);
  assert.equal(lists[0].type, 'creator-run');
  assert.equal(lists[0].sourceSection, 'X-Men: Divided We Stand');
});

test('entries missing what a reader needs to choose are dropped, and counted', () => {
  const { lists, dropped } = parseCatalog({
    lists: [
      { id: 'a', name: 'A', count: 1 },                       // no file
      { id: 'b', file: 'b.json', count: 1 },                  // no name
      { id: 'c', file: 'c.json', name: 'C' },                 // no count
      { id: 'd', file: 'd.json', name: 'D', count: -1 },      // impossible count
      null,
    ],
  });
  assert.equal(lists.length, 0);
  assert.equal(dropped, 5);
});

test('duplicate ids are dropped rather than shown twice', () => {
  const entry = { id: 'x', file: 'x.json', name: 'X', count: 3 };
  const { lists, dropped } = parseCatalog({ lists: [entry, { ...entry, name: 'X again' }] });
  assert.equal(lists.length, 1);
  assert.equal(dropped, 1);
  assert.equal(lists[0].name, 'X');
});

test('a curated file name that could escape the data directory is rejected', () => {
  for (const file of ['../secrets.json', 'a/b.json', 'https://evil.test/x.json', 'x.js', '.json']) {
    const { lists, dropped } = parseCatalog({ lists: [{ id: 'x', file, name: 'X', count: 1 }] });
    assert.equal(lists.length, 0, `accepted ${file}`);
    assert.equal(dropped, 1);
  }
});

test('unknown type and depth values become null instead of being displayed', () => {
  const { lists } = parseCatalog({
    lists: [{ id: 'x', file: 'x.json', name: 'X', count: 1, type: 'anthology', depth: 'skim' }],
  });
  assert.equal(lists[0].type, null);
  assert.equal(lists[0].depth, null);
  assert.equal(typeLabel(null), 'Reading List');
  assert.equal(depthLabel(null), null);
  assert.equal(typeLabel('event'), 'Event');
  assert.equal(depthLabel('essential'), 'Essential reading');
  assert.equal(typeLabel('screen-companion'), 'Screen companion');
  assert.equal(depthLabel('selected'), 'Selected issues');
  assert.equal(depthHint('selected'), 'Issue-specific recommendations chosen from a broader guide.');
});

test('a missing or malformed catalog yields an empty list, not a crash', () => {
  assert.deepEqual(parseCatalog(undefined), { lists: [], paths: [], dropped: 0 });
  assert.deepEqual(parseCatalog({ lists: 'nope' }), { lists: [], paths: [], dropped: 0 });
  // A catalog written before paths existed still parses; the section is absent, not empty-invalid.
  assert.deepEqual(parseCatalog({ lists: [] }).paths, []);
  assert.deepEqual(parseCatalog({ lists: [], paths: 'nope' }).paths, []);
});

test('the bundled catalog is valid and its counts match the vendored orders', async () => {
  const url = new URL('../src/data/catalog.json', import.meta.url);
  const { lists, dropped } = parseCatalog(JSON.parse(await readFile(url, 'utf8')));
  assert.equal(dropped, 0);
  assert.ok(lists.length > 0);

  for (const list of lists) {
    assert.ok(LIST_TYPES.includes(list.type), `${list.id} has no valid type`);
    assert.ok(READING_DEPTHS.includes(list.depth), `${list.id} has no valid depth`);
    // What matters is that the reader always sees where an order came from. A list compiled in
    // this repository has no upstream page to link to, so its license carries the credit.
    assert.ok(sourceLabel(list), `${list.id} has no attribution`);
    assert.ok(list.updatedAt, `${list.id} has no last-updated date`);
    assert.ok(list.characters.length, `${list.id} has no characters to search by`);

    const order = JSON.parse(await readFile(new URL(`../src/data/${list.file}`, import.meta.url), 'utf8'));
    assert.equal(list.count, order.items.length, `${list.id} count is out of date`);
    assert.equal(list.id, order.id);

    // The card art has to belong to the order it represents. A cover pinned from an issue
    // that is not in the file is how a catalog ends up illustrated with the wrong comic.
    assert.ok(list.coverIssueId, `${list.id} has no representative issue for its cover`);
    const rep = order.items.find((i) => i.issueId === list.coverIssueId);
    assert.ok(rep, `${list.id} cover issue ${list.coverIssueId} is not in ${list.file}`);
    assert.deepEqual(list.cover, rep.cover, `${list.id} cover does not match its representative issue`);
    // Marvel serves http in the API payload; anything pinned must already be https or it is
    // blocked as mixed content the moment the app is served over TLS.
    assert.match(list.cover.path, /^https:\/\//, `${list.id} cover is not https`);
  }
});

test('the bundled Hickman X-Men order is a distinct creator run', async () => {
  const { lists } = parseCatalog(JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8')));
  const entry = lists.find((list) => list.id === 'hickman-x-men');
  assert.ok(entry, 'missing Hickman X-Men entry');
  assert.equal(entry.type, 'creator-run');
  assert.equal(entry.depth, 'complete');
  assert.equal(entry.group, null);
  assert.equal(entry.count, 54);

  const order = JSON.parse(await readFile(new URL('../src/data/hickman_x_men.json', import.meta.url), 'utf8'));
  const ids = order.items.map((item) => item.issueId);
  assert.deepEqual(ids.slice(0, 4), [72984, 72991, 72985, 72992]);
  assert.ok(ids.includes(90151), 'X-Men #21 closes Hickman on the title');
  assert.deepEqual(ids.slice(-4), [96222, 96223, 96224, 96225]);
  assert.ok(!ids.includes(112184), 'post-Hickman X-Men (2021) rows are broader Krakoa context');
});

test('every catalog cover resolves to a variant URL the browser can request', async () => {
  const url = new URL('../src/data/catalog.json', import.meta.url);
  const { lists } = parseCatalog(JSON.parse(await readFile(url, 'utf8')));
  for (const list of lists) {
    assert.match(
      catalogCoverUrl(list),
      /^https:\/\/.+\/portrait_incredible\.(jpg|png|gif)$/,
      `${list.id} does not produce a usable cover URL`,
    );
  }
});

test('a cover issue id has to be a positive whole number, matching the manifest rule', () => {
  const { lists } = parseCatalog({
    lists: [-1, 0, 4216, 1.5, '4216', null].map((v, i) => (
      { id: `x${i}`, file: 'x.json', name: 'X', count: 1, coverIssueId: v }
    )),
  });
  // Only the real id survives. A negative number is the one that matters: it is truthy, so
  // accepting it would let corrupted data reach the preview lookup looking like an id.
  assert.deepEqual(lists.map((l) => l.coverIssueId), [null, null, 4216, null, null, null]);
});

test('an entry with no usable cover falls back rather than requesting a broken image', () => {
  const { lists } = parseCatalog({
    lists: [
      { id: 'x', file: 'x.json', name: 'X', count: 1 },
      // Marvel's own payload is http; anything that cannot be served over TLS is dropped
      // rather than rendered as a mixed-content image that silently fails to load.
      { id: 'y', file: 'y.json', name: 'Y', count: 1, cover: { path: 'ftp://cdn.test/y', ext: 'jpg' }, coverIssueId: 0 },
    ],
  });
  assert.equal(lists[0].cover, null);
  assert.equal(lists[0].coverIssueId, null);
  assert.equal(catalogCoverUrl(lists[0]), null);
  assert.equal(lists[1].cover, null);
  assert.equal(lists[1].coverIssueId, null);
  assert.equal(catalogCoverUrl(lists[1]), null);
});

test('beginner-friendliness is recorded, not inferred, so only an explicit true counts', () => {
  const { lists } = parseCatalog({
    lists: [
      { id: 'a', file: 'a.json', name: 'A', count: 1, beginner: true },
      { id: 'b', file: 'b.json', name: 'B', count: 1, beginner: 'yes' },
      { id: 'c', file: 'c.json', name: 'C', count: 1 },
    ],
  });
  assert.deepEqual(lists.map((l) => l.beginner), [true, false, false]);
  assert.deepEqual(filterByFacet(lists, 'beginner').map((l) => l.id), ['a']);
});

test('facets cover the ways a reader chooses, and never offer one that matches nothing', () => {
  const lists = parseCatalog({
    lists: [
      { id: 'a', file: 'a.json', name: 'A', count: 8, type: 'event', beginner: true },
      { id: 'b', file: 'b.json', name: 'B', count: 200, type: 'creator-run' },
    ],
  }).lists;

  const facets = catalogFacets(lists);
  assert.deepEqual(facets.map((f) => f.key), ['all', 'beginner', 'type:event', 'type:creator-run', 'short']);
  assert.deepEqual(facets.map((f) => f.count), [2, 1, 1, 1, 1]);
  // Plural, because a chip labels a set rather than a single list.
  assert.equal(facetLabel(lists, 'type:event'), 'Events');

  assert.deepEqual(filterByFacet(lists, 'all').map((l) => l.id), ['a', 'b']);
  assert.deepEqual(filterByFacet(lists, 'short').map((l) => l.id), ['a']);
  assert.deepEqual(filterByFacet(lists, 'type:creator-run').map((l) => l.id), ['b']);

  // Nothing is short here, so the chip that would lead to an empty grid is not offered.
  const long = parseCatalog({ lists: [{ id: 'c', file: 'c.json', name: 'C', count: 400, type: 'era' }] }).lists;
  assert.equal(catalogFacets(long).some((f) => f.key === 'short'), false);
  assert.equal(catalogFacets(long).some((f) => f.key === 'beginner'), false);
});

test('a stale facet matches nothing rather than quietly widening to everything', () => {
  const { lists } = parseCatalog({ lists: [{ id: 'a', file: 'a.json', name: 'A', count: 3 }] });
  assert.deepEqual(filterByFacet(lists, 'type:motion-comic'), []);
  assert.deepEqual(filterByFacet(lists, 'nonsense'), []);
  assert.equal(facetLabel(lists, 'nonsense'), 'that filter');
});

test('spotlight taxonomy is explicit, conservative, and filterable', () => {
  const { lists } = parseCatalog({
    lists: [
      { id: 'best', file: 'best.json', name: 'Best', count: 1, spotlightKind: 'best-of' },
      { id: 'complete', file: 'complete.json', name: 'Complete', count: 2, spotlightKind: 'complete-guide' },
      { id: 'other', file: 'other.json', name: 'Other', count: 3, spotlightKind: 'other' },
      { id: 'stale', file: 'stale.json', name: 'Stale', count: 4, spotlightKind: 'unknown' },
    ],
  });
  assert.deepEqual(SPOTLIGHT_KINDS, ['best-of', 'complete-guide', 'other']);
  assert.deepEqual(lists.map((list) => list.spotlightKind), ['best-of', 'complete-guide', 'other', null]);
  assert.deepEqual(filterBySpotlightKind(lists, 'all').map((list) => list.id), ['best', 'complete', 'other', 'stale']);
  assert.deepEqual(filterBySpotlightKind(lists, 'best-of').map((list) => list.id), ['best']);
  assert.deepEqual(filterBySpotlightKind(lists, 'complete-guide').map((list) => list.id), ['complete']);
  assert.deepEqual(filterBySpotlightKind(lists, 'other').map((list) => list.id), ['other']);
  assert.deepEqual(filterBySpotlightKind(lists, 'unknown'), []);
  assert.equal(spotlightKindLabel('all'), 'All');
  assert.equal(spotlightKindLabel('best-of'), 'Best of');
  assert.equal(spotlightKindLabel('complete-guide'), 'Complete guides');
  assert.equal(spotlightKindLabel('other'), null);
});

test('catalog narrowing resets every shelf-local filter together', () => {
  const state = { query: 'avengers', facet: 'beginner', spotlight: 'complete-guide' };
  assert.equal(resetCatalogNarrowing(state), state);
  assert.deepEqual(state, { query: '', facet: 'all', spotlight: 'all' });
  assert.equal(resetCatalogNarrowing(null), null);
});

test('an order under twenty issues is short; exactly twenty is not, as the label says', () => {
  assert.equal(isShortOrder({ count: 19 }), true);
  assert.equal(isShortOrder({ count: SHORT_ORDER_MAX }), false);
  assert.equal(isShortOrder({ count: null }), false);
  assert.equal(isShortOrder({}), false);
});

test('reading time is stated in round units and never for an unknown count', () => {
  assert.equal(readingTimeLabel(1), 'about 20 minutes');
  assert.equal(readingTimeLabel(4), 'about 80 minutes');
  assert.equal(readingTimeLabel(5), 'about 2 hours');
  assert.equal(readingTimeLabel(0), null);
  assert.equal(readingTimeLabel(null), null);
  // The assumption behind the estimate is a constant callers can show, not a hidden number.
  assert.equal(MINUTES_PER_ISSUE, 20);
});

test('categories are derived from the lists, with counts and a stable order', () => {
  const { lists } = parseCatalog({
    lists: [
      { id: 'a', file: 'a.json', name: 'A', count: 1, type: 'era' },
      { id: 'b', file: 'b.json', name: 'B', count: 1, type: 'event' },
      { id: 'c', file: 'c.json', name: 'C', count: 1, type: 'event' },
      { id: 'd', file: 'd.json', name: 'D', count: 1 },
    ],
  });
  assert.deepEqual(catalogCategories(lists), [
    { key: 'event', label: 'Event', count: 2 },
    { key: 'era', label: 'Era', count: 1 },
    { key: 'other', label: 'Other', count: 1 },
  ]);
});

test('filtering narrows the lists without altering them, and “all” keeps every list', () => {
  const { lists } = parseCatalog({
    lists: [
      { id: 'a', file: 'a.json', name: 'A', count: 1, type: 'era', description: 'An era.' },
      { id: 'b', file: 'b.json', name: 'B', count: 1, type: 'event' },
    ],
  });
  const eras = filterByCategory(lists, 'era');
  assert.deepEqual(eras.map((l) => l.id), ['a']);
  assert.equal(eras[0].description, 'An era.', 'details must survive filtering');
  assert.equal(eras[0], lists[0]);

  assert.equal(filterByCategory(lists, 'all').length, 2);
  assert.equal(filterByCategory(lists, null).length, 2);
});

test('lists with an unusable type are grouped under “other”, never hidden', () => {
  const { lists } = parseCatalog({
    lists: [{ id: 'a', file: 'a.json', name: 'A', count: 1, type: 'anthology' }],
  });
  assert.deepEqual(filterByCategory(lists, UNCATEGORIZED).map((l) => l.id), ['a']);
});

test('an unknown category matches nothing rather than everything', () => {
  const { lists } = parseCatalog({ lists: [{ id: 'a', file: 'a.json', name: 'A', count: 1, type: 'era' }] });
  assert.deepEqual(filterByCategory(lists, 'event'), []);
});

const sample = parseCatalog({
  lists: [
    {
      id: 'hickman', file: 'hickman.json', name: 'Hickman to Secret Wars: minimal', count: 89,
      type: 'creator-run', depth: 'essential',
      description: 'The essential spine of Jonathan Hickman’s Avengers run.',
      characters: ['Avengers', 'Black Panther'], keywords: ['Jonathan Hickman', 'Secret Wars'],
    },
    {
      id: 'civil-war', file: 'civil_war.json', name: 'Civil War', count: 40,
      type: 'event', depth: 'complete',
      description: 'Registration splits the heroes.',
      characters: ['Iron Man', 'Captain America', 'Spider-Man'], keywords: ['crossover'],
    },
  ],
}).lists;

const ids = (lists) => lists.map((l) => l.id);

test('search matches a list title', () => {
  assert.deepEqual(ids(searchCatalog(sample, 'civil war')), ['civil-war']);
});

test('search matches a character that is not in the title', () => {
  assert.deepEqual(ids(searchCatalog(sample, 'spider-man')), ['civil-war']);
  assert.deepEqual(ids(searchCatalog(sample, 'black panther')), ['hickman']);
});

test('search matches keywords and descriptions', () => {
  assert.deepEqual(ids(searchCatalog(sample, 'crossover')), ['civil-war']);
  assert.deepEqual(ids(searchCatalog(sample, 'registration')), ['civil-war']);
});

test('search ignores case, accents, and punctuation', () => {
  assert.deepEqual(ids(searchCatalog(sample, 'HICKMAN’S')), ['hickman']);
  assert.deepEqual(ids(searchCatalog(sample, 'spider man')), ['civil-war']);
});

// "spiderman" and "xmen" are how these names are typed at least as often as the hyphenated
// spelling. Folding punctuation to a space alone returned nothing for them, which reads as
// "we do not have that list" rather than "you punctuated it differently".
test('a name typed without its punctuation still finds the list', () => {
  assert.deepEqual(ids(searchCatalog(sample, 'spiderman')), ['civil-war']);
  assert.deepEqual(ids(searchCatalog(sample, 'SpiderMan')), ['civil-war']);
  assert.deepEqual(ids(searchCatalog(sample, 'ironman')), ['civil-war']);
  assert.deepEqual(ids(searchCatalog(sample, 'captainamerica')), ['civil-war']);
  assert.deepEqual(ids(searchCatalog(sample, 'blackpanther')), ['hickman']);
});

test('extra terms narrow the results instead of widening them', () => {
  assert.deepEqual(ids(searchCatalog(sample, 'secret wars avengers')), ['hickman']);
  assert.deepEqual(ids(searchCatalog(sample, 'secret wars spider-man')), []);
  // The de-punctuated form must not let a multi-word query match by running the words together
  // across unrelated fields, which would turn a narrowing query into a widening one.
  assert.deepEqual(ids(searchCatalog(sample, 'secretwars spiderman')), []);
});

test('an empty or whitespace query returns every list', () => {
  assert.equal(searchCatalog(sample, '').length, 2);
  assert.equal(searchCatalog(sample, '   ').length, 2);
  assert.equal(searchCatalog(sample, undefined).length, 2);
});

test('search and category filtering compose', () => {
  assert.deepEqual(ids(searchCatalog(filterByCategory(sample, 'event'), 'iron man')), ['civil-war']);
  assert.deepEqual(ids(searchCatalog(filterByCategory(sample, 'creator-run'), 'iron man')), []);
});

test('characters and keywords are normalised, and rubbish entries are dropped', () => {
  const { lists } = parseCatalog({
    lists: [{
      id: 'x', file: 'x.json', name: 'X', count: 1,
      characters: ['  Namor  ', 'Namor', '', null, 7],
      keywords: 'not-an-array',
    }],
  });
  assert.deepEqual(lists[0].characters, ['Namor']);
  assert.deepEqual(lists[0].keywords, []);
});

test('every reading depth has a label and a plain-English explanation', () => {
  for (const depth of READING_DEPTHS) {
    assert.ok(depthLabel(depth), `${depth} has no label`);
    assert.ok(depthHint(depth), `${depth} has no explanation`);
  }
  assert.equal(depthHint('skim'), null);
});

// ------------------------------------------------------------------ variant grouping

const variants = parseCatalog({
  lists: [
    {
      id: 'cw-essential', file: 'cw_e.json', name: 'Civil War: essential', count: 12,
      type: 'event', depth: 'essential', group: 'civil-war', groupName: 'Civil War',
      variant: 'Essential reading',
    },
    {
      id: 'cw-full', file: 'cw_f.json', name: 'Civil War: complete', count: 90,
      type: 'event', depth: 'complete', group: 'civil-war', groupName: 'Civil War',
      variant: 'Complete reading, with tie-ins',
    },
    { id: 'solo', file: 'solo.json', name: 'Annihilation', count: 30, type: 'event' },
  ],
}).lists;

test('orders for the same event are grouped together under the event name', () => {
  const groups = groupCatalog(variants);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].name, 'Civil War');
  assert.deepEqual(groups[0].lists.map((l) => l.id), ['cw-essential', 'cw-full']);
});

test('a list with no group stays an ungrouped entry', () => {
  const groups = groupCatalog(variants);
  assert.equal(groups[1].name, null);
  assert.deepEqual(groups[1].lists.map((l) => l.id), ['solo']);
});

test('groups keep the order in which their event first appears', () => {
  const reordered = [variants[2], variants[0], variants[1]];
  assert.deepEqual(groupCatalog(reordered).map((g) => g.name), [null, 'Civil War']);
});

test('a lone surviving variant is not given a heading over a single item', () => {
  const groups = groupCatalog([variants[0]]);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].name, null);
  assert.equal(groups[0].lists[0].id, 'cw-essential');
});

test('a group falls back to a member name when groupName is missing', () => {
  const { lists } = parseCatalog({
    lists: [
      { id: 'a', file: 'a.json', name: 'Inferno: essential', count: 1, group: 'inferno' },
      { id: 'b', file: 'b.json', name: 'Inferno: complete', count: 2, group: 'inferno' },
    ],
  });
  assert.equal(groupCatalog(lists)[0].name, 'Inferno: essential');
});

test('every variant is named, falling back to depth and then to the list name', () => {
  assert.equal(variantLabel(variants[0]), 'Essential reading');
  const { lists } = parseCatalog({
    lists: [
      { id: 'a', file: 'a.json', name: 'A', count: 1, group: 'g', depth: 'complete' },
      { id: 'b', file: 'b.json', name: 'B', count: 1, group: 'g' },
    ],
  });
  assert.equal(variantLabel(lists[0]), 'Complete reading');
  assert.equal(variantLabel(lists[1]), 'B');
});

test('search matches the event name and the variant name', () => {
  assert.deepEqual(
    searchCatalog(variants, 'civil war tie-ins').map((l) => l.id),
    ['cw-full'],
  );
});

test('the bundled catalog names every variant it groups', async () => {
  const url = new URL('../src/data/catalog.json', import.meta.url);
  const { lists } = parseCatalog(JSON.parse(await readFile(url, 'utf8')));
  for (const group of groupCatalog(lists)) {
    if (!group.name) continue;
    const labels = group.lists.map(variantLabel);
    assert.equal(new Set(labels).size, labels.length, `${group.name} has ambiguous variants`);
  }
});

// ------------------------------------------------------------------ which path, and in what order

// Depth order, not catalog order: the fixture lists the longest path first on purpose.
const paths = parseCatalog({
  lists: [
    {
      id: 'cw-full', file: 'f.json', name: 'Civil War: complete', count: 31,
      depth: 'complete', group: 'civil-war', groupName: 'Civil War', variant: 'Every branded issue',
    },
    {
      id: 'cw-tie', file: 't.json', name: 'Civil War: tie-ins', count: 24,
      depth: 'tie-ins', group: 'civil-war', groupName: 'Civil War', variant: 'The tie-ins',
    },
    {
      id: 'cw-main', file: 'm.json', name: 'Civil War: main series', count: 7,
      depth: 'essential', group: 'civil-war', groupName: 'Civil War', variant: 'The main series only',
    },
  ],
}).lists;

test('a story offers its paths shortest commitment first, by declared depth rather than by catalog order', () => {
  const [story] = groupCatalog(paths);
  assert.deepEqual(story.lists.map((l) => l.id), ['cw-main', 'cw-full', 'cw-tie']);
});

test('paths sharing a depth keep the order the catalog gave them', () => {
  const { lists } = parseCatalog({
    lists: [
      { id: 'b', file: 'b.json', name: 'B', count: 2, depth: 'complete', group: 'g' },
      { id: 'a', file: 'a.json', name: 'A', count: 1, depth: 'complete', group: 'g' },
    ],
  });
  assert.deepEqual(groupCatalog(lists)[0].lists.map((l) => l.id), ['b', 'a']);
});

test('a path whose depth the manifest does not declare sorts last, not ahead of the ones that do', () => {
  const { lists } = parseCatalog({
    lists: [
      { id: 'none', file: 'n.json', name: 'N', count: 1, group: 'g' },
      { id: 'deep', file: 'd.json', name: 'D', count: 2, depth: 'complete', group: 'g' },
    ],
  });
  assert.deepEqual(groupCatalog(lists)[0].lists.map((l) => l.id), ['deep', 'none']);
});

test('a story the reader has not started shows its shortest path', () => {
  const [story] = groupCatalog(paths);
  assert.equal(defaultPath(story).id, 'cw-main');
  assert.equal(defaultPath(story, () => false).id, 'cw-main');
});

test('a story the reader has already started shows the path they started', () => {
  const [story] = groupCatalog(paths);
  assert.equal(defaultPath(story, (l) => l.id === 'cw-full').id, 'cw-full');
});

test('a reader holding two paths of one story is shown the shallower of the two', () => {
  const [story] = groupCatalog(paths);
  assert.equal(defaultPath(story, (l) => l.id !== 'cw-main').id, 'cw-full');
});

test('defaultPath has an answer for a story with no paths left', () => {
  assert.equal(defaultPath({ lists: [] }), null);
  assert.equal(defaultPath(null), null);
});

test('the reader\u2019s own choice of path is honoured over the default', () => {
  const [story] = groupCatalog(paths);
  assert.equal(pickPath(story, 'cw-tie').id, 'cw-tie');
});

test('a stored choice naming a path the story no longer offers falls back rather than showing nothing', () => {
  const [story] = groupCatalog(paths);
  // A search that narrows the story to one path, and a data change that drops one, arrive here the
  // same way: the id is still stored and no longer matches anything.
  assert.equal(pickPath(story, 'cw-deleted').id, 'cw-main');
  const narrowed = groupCatalog([paths[0]])[0];
  assert.equal(pickPath(narrowed, 'cw-main').id, 'cw-full');
});

test('a stored choice does not override the path the reader already holds when it is stale', () => {
  const [story] = groupCatalog(paths);
  assert.equal(pickPath(story, 'cw-gone', (l) => l.id === 'cw-full').id, 'cw-full');
});

test('the bundled Civil War story offers all three of its reading paths', async () => {
  const url = new URL('../src/data/catalog.json', import.meta.url);
  const { lists } = parseCatalog(JSON.parse(await readFile(url, 'utf8')));
  const story = groupCatalog(lists).find((g) => g.key === 'civil-war');
  assert.deepEqual(
    story.lists.map((l) => l.id),
    ['civil-war-essential', 'civil-war', 'civil-war-avengers'],
  );
});

// The shelf shows one card per story, so a chip promising "Events (8)" that opens onto six cards
// is the chip lying about what it will do. Counting is the only thing that changes: the filter
// itself still works on paths, because a path is what actually gets imported.
test('a facet counts the stories it will show, not the reading paths inside them', () => {
  const facets = catalogFacets(paths);
  assert.equal(facets.find((f) => f.key === 'all').count, 1, 'three paths through one story are one card');
});

test('a facet still counts two separate stories separately', () => {
  const { lists } = parseCatalog({
    lists: [
      { id: 'a1', file: 'a1.json', name: 'A one', count: 1, group: 'a' },
      { id: 'a2', file: 'a2.json', name: 'A two', count: 2, group: 'a' },
      { id: 'b1', file: 'b1.json', name: 'B one', count: 3 },
    ],
  });
  assert.equal(catalogFacets(lists).find((f) => f.key === 'all').count, 2);
});

test('an order in no group counts as its own story', () => {
  const { lists } = parseCatalog({
    lists: [
      { id: 'x', file: 'x.json', name: 'X', count: 1 },
      { id: 'y', file: 'y.json', name: 'Y', count: 2 },
    ],
  });
  assert.equal(countStories(lists), 2, 'two ungrouped orders are two stories, not one bucket of blanks');
});

test('counting stories tolerates nothing to count', () => {
  assert.equal(countStories([]), 0);
  assert.equal(countStories(undefined), 0);
});

// A type chip counts the stories left after its own filter runs, so the number it shows is the
// number of cards pressing it produces.
test('a type facet counts the stories that survive that filter alone', () => {
  const { lists } = parseCatalog({
    lists: [
      { id: 'e1', file: 'e1.json', name: 'E one', count: 1, type: 'event', group: 'e' },
      { id: 'e2', file: 'e2.json', name: 'E two', count: 2, type: 'event', group: 'e' },
      { id: 'r1', file: 'r1.json', name: 'R one', count: 3, type: 'era' },
    ],
  });
  const facets = catalogFacets(lists);
  assert.equal(facets.find((f) => f.key === 'type:event').count, 1);
  assert.equal(facets.find((f) => f.key === 'type:era').count, 1);
});

// ------------------------------------------------------------------ attribution

test('a source is linked only when it is a real https address', () => {
  assert.equal(sourceLink({ source: 'https://example.com/order.md' }), 'https://example.com/order.md');
  assert.equal(sourceLink({ source: 'javascript:alert(1)' }), null);
  assert.equal(sourceLink({ source: 'http://example.com/order.md' }), null);
  assert.equal(sourceLink({ source: 'Comic Book Herald' }), null);
  assert.equal(sourceLink({}), null);
});

test('attribution prefers the origin, and never goes blank while any credit exists', () => {
  assert.equal(
    sourceLabel({ sourceOrigin: 'Compiled for this project', sourceLicense: 'MIT', source: 'https://example.com' }),
    'Compiled for this project',
  );
  // BL-099 split one field into two. A catalog written before the split has no origin, and the
  // credit it does carry is still owed, so the older fields remain as fallbacks.
  assert.equal(sourceLabel({ sourceLicense: 'MIT', source: 'https://example.com' }), 'MIT');
  assert.equal(sourceLabel({ source: 'https://example.com' }), 'https://example.com');
  assert.equal(sourceLabel({}), null);
});

// A licence and a credit are different claims, so they are read by different functions. Null is
// the ordinary answer and means no licence was conveyed, not that the order is unencumbered.
test('the licence is read separately from the credit, and is usually absent', () => {
  assert.equal(sourceLicense({ sourceOrigin: 'Compiled for this project', sourceLicense: null }), null);
  assert.equal(sourceLicense({ sourceOrigin: 'Compiled for this project' }), null);
  assert.equal(sourceLicense({ sourceLicense: 'CC0-1.0' }), 'CC0-1.0');
  assert.equal(sourceLicense({}), null);
});

test('a last-updated date is shown only when it is a real date', () => {
  assert.equal(updatedLabel({ updatedAt: '2026-08-04T06:14:48.695Z' }, 'en-GB'), '4 Aug 2026');
  assert.equal(updatedLabel({ updatedAt: 'sometime last year' }), null);
  assert.equal(updatedLabel({}), null);
});

// The stamp is a UTC instant, so it has to render as the same day everywhere. Formatted in
// local time, an early-morning UTC stamp slips to the previous day across the Americas, and
// two readers comparing the same catalog would see different dates.
test('the snapshot date is the same day in every timezone', () => {
  const early = { updatedAt: '2026-08-04T00:30:00.000Z' };
  const late = { updatedAt: '2026-08-04T23:30:00.000Z' };
  const saved = process.env.TZ;
  try {
    for (const tz of ['UTC', 'America/Los_Angeles', 'America/New_York', 'Asia/Tokyo', 'Pacific/Kiritimati']) {
      process.env.TZ = tz;
      assert.equal(updatedLabel(early, 'en-GB'), '4 Aug 2026', `early stamp in ${tz}`);
      assert.equal(updatedLabel(late, 'en-GB'), '4 Aug 2026', `late stamp in ${tz}`);
    }
  } finally {
    if (saved == null) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

test('every bundled catalog entry carries attribution and a last-updated date', async () => {
  const url = new URL('../src/data/catalog.json', import.meta.url);
  const { lists } = parseCatalog(JSON.parse(await readFile(url, 'utf8')));
  assert.ok(lists.length);
  for (const list of lists) {
    assert.ok(sourceLabel(list), `${list.id} has no attribution`);
    assert.ok(updatedLabel(list, 'en-GB'), `${list.id} has no last-updated date`);
  }
});

// ---------------------------------------------------------------- collected editions
//
// Reading in trades is a way of collecting rather than a kind of story, so it is a facet and a
// meta line rather than a new list type. These check it stays invisible on an ordinary order.

test('an order divided into collected editions says so, and an ordinary one says nothing', () => {
  assert.equal(collectionsLabel({ collections: 23 }), '23 collected editions');
  assert.equal(collectionsLabel({ collections: 1 }), '1 collected edition');
  assert.equal(collectionsLabel({ collections: 0 }), null);
  assert.equal(collectionsLabel({}), null);
  assert.equal(collectionsLabel(null), null);
});

// A count that is not a whole positive number is a broken catalog entry, and "NaN collected
// editions" on a card is worse than saying nothing.
test('a nonsense collection count is treated as no collections at all', () => {
  for (const bad of [-3, 2.5, '23', null, undefined, NaN, Infinity]) {
    assert.equal(isTradeOrder({ collections: bad }), false, `rejects ${String(bad)}`);
    assert.equal(collectionsLabel({ collections: bad }), null, `and labels nothing for ${String(bad)}`);
  }
});

test('the catalog offers a collected-edition facet only when such an order exists', () => {
  const plain = parseCatalog({ lists: [{ id: 'a', name: 'A', file: 'a.json', count: 5 }] }).lists;
  assert.ok(!catalogFacets(plain).some((f) => f.key === 'trade'), 'no facet with nothing to filter');

  const mixed = parseCatalog({
    lists: [
      { id: 'a', name: 'A', file: 'a.json', count: 5 },
      { id: 'b', name: 'B', file: 'b.json', count: 132, collections: 23 },
    ],
  }).lists;
  const facet = catalogFacets(mixed).find((f) => f.key === 'trade');
  assert.ok(facet, 'the facet appears once an order is divided into books');
  assert.equal(facet.count, 1);
  assert.deepEqual(filterByFacet(mixed, 'trade').map((l) => l.id), ['b']);
});

// parseCatalog builds an explicit object, so a field it does not name is dropped on load and
// the catalog would go on reporting every order as an ordinary one.
test('the collection count survives parsing the catalog', () => {
  const { lists } = parseCatalog({
    lists: [{ id: 'b', name: 'B', file: 'b.json', count: 132, collections: 23 }],
  });
  assert.equal(lists[0].collections, 23);
});

// ------------------------------------------------------------------- timeline

const dated = (id, timeline) => ({ id, name: id, file: `${id}.json`, count: 1, timeline });

test('the shelf is ordered by the year each order starts, and undated orders follow the dated run', () => {
  const shelf = sortCatalog([
    dated('king-in-black', 2020),
    dated('best-of', null),
    dated('disassembled', 2004),
    dated('claremont', null),
    dated('maximum-security', 2000),
  ]);
  assert.deepEqual(shelf.map((l) => l.id), [
    'maximum-security', 'disassembled', 'king-in-black', 'best-of', 'claremont',
  ]);
});

// Two reading paths through one story are grouped under a single heading, and the group takes its
// position from whichever member the shelf reaches first. Reordering has to leave that member the
// same one, so a tie has to keep the catalog's own order rather than resolving it arbitrarily.
test('orders that begin in the same year keep the order the catalog gives them', () => {
  const same = ['civil-war', 'civil-war-essential', 'annihilation', 'civil-war-avengers'];
  const shelf = sortCatalog(same.map((id) => dated(id, 2006)));
  assert.deepEqual(shelf.map((l) => l.id), same);
});

test('sortCatalog leaves its argument alone', () => {
  const input = [dated('b', 2020), dated('a', 1963)];
  sortCatalog(input);
  assert.deepEqual(input.map((l) => l.id), ['b', 'a']);
});

// parseCatalog builds an explicit object, so a field it does not name is dropped on load and
// every order would sort as though it had no place on the timeline.
test('the timeline year survives parsing the catalog', () => {
  const { lists } = parseCatalog({ lists: [dated('x', 2006)] });
  assert.equal(lists[0].timeline, 2006);
});

// A year is a whole number no earlier than Marvel Comics #1. Anything else is a maintainer's
// typo, and a string would sort as though it were undated while looking correct in the file.
test('a timeline that is not a usable year becomes null rather than being trusted', () => {
  for (const bad of ['2006', 2006.5, 1900, -2006, null, undefined, {}]) {
    const { lists } = parseCatalog({ lists: [dated('x', bad)] });
    assert.equal(lists[0].timeline, null, `accepted ${JSON.stringify(bad)}`);
  }
});

test('the shipped catalog carries the timeline recorded in the manifest', async () => {
  const catalog = parseCatalog(JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8')));
  const manifest = JSON.parse(await readFile(new URL('../src/data/curated-lists.json', import.meta.url), 'utf8'));
  const wanted = new Map(manifest.lists.map((l) => [l.id, l.timeline ?? null]));
  assert.equal(catalog.lists.length, wanted.size);
  for (const list of catalog.lists) {
    assert.equal(list.timeline, wanted.get(list.id), `${list.id} is not where the manifest puts it`);
  }
});

// A group is one decision presented once. Giving its members different years would scatter them
// across the shelf, and the heading would then sit at the earliest of them with the rest adrift.
test('every reading path through one story starts in the same year', async () => {
  const manifest = JSON.parse(await readFile(new URL('../src/data/curated-lists.json', import.meta.url), 'utf8'));
  const byGroup = new Map();
  for (const list of manifest.lists) {
    if (!list.group) continue;
    const seen = byGroup.get(list.group);
    if (seen === undefined) byGroup.set(list.group, list.timeline ?? null);
    else assert.equal(list.timeline ?? null, seen, `${list.id} starts in a different year from the rest of ${list.group}`);
  }
  assert.ok(byGroup.size >= 1, 'the manifest has at least one grouped story');
});

// ------------------------------------------------------------------ shelf sections

test('a story whose every reading is a character run is a spotlight', () => {
  assert.equal(shelfKey({ lists: [{ type: 'character-run' }, { type: 'character-run' }] }), 'spotlights');
});

test('a screen companion uses the existing Storylines browse fallback', () => {
  assert.equal(shelfKey({ lists: [{ type: 'screen-companion' }] }), 'lines');
});

test('an event belongs to the screen that carries the events', () => {
  assert.equal(shelfKey({ lists: [{ type: 'event' }] }), 'catalog');
});

// The conservative half of the rule. A story is placed by all of its readings together, so a story
// read two ways cannot be torn in half and drawn on two screens.
test('a story whose readings disagree falls to the screen that takes everything', () => {
  assert.equal(shelfKey({ lists: [{ type: 'character-run' }, { type: 'event' }] }), 'lines');
});

// Both bundled creator runs are Hickman's Avengers. They are line-wide reading rather than a single
// event or a single character, which is the screen they belong on.
test('a line-wide reading is neither an event nor a spotlight', () => {
  assert.equal(shelfKey({ lists: [{ type: 'era' }] }), 'lines');
  assert.equal(shelfKey({ lists: [{ type: 'creator-run' }] }), 'lines');
});

test('a story with no readings at all does not become a spotlight', () => {
  for (const empty of [{ lists: [] }, {}, null]) {
    assert.equal(shelfKey(empty), 'lines');
  }
});

test('shelfSections divides the shelf without reordering any part of it', () => {
  const stories = [
    { key: 'a', lists: [{ type: 'event' }] },
    { key: 'b', lists: [{ type: 'character-run' }] },
    { key: 'c', lists: [{ type: 'era' }] },
    { key: 'd', lists: [{ type: 'character-run' }] },
    { key: 'e', lists: [{ type: 'event' }] },
  ];
  const sections = shelfSections(stories);
  assert.deepEqual(sections.map((s) => s.key), ['catalog', 'lines', 'spotlights']);
  assert.deepEqual(sections[0].stories.map((s) => s.key), ['a', 'e']);
  assert.deepEqual(sections[1].stories.map((s) => s.key), ['c']);
  assert.deepEqual(sections[2].stories.map((s) => s.key), ['b', 'd']);
});

// A heading over nothing tells a reader a kind of reading exists and then withholds it. Dropping the
// empty section is also what lets a narrowed shelf still name the one kind it is showing.
test('shelfSections drops a section with no rows and keeps the one that has them', () => {
  const only = shelfSections([{ key: 'a', lists: [{ type: 'character-run' }] }]);
  assert.equal(only.length, 1);
  assert.equal(only[0].key, 'spotlights');
  assert.equal(shelfSections([]).length, 0);
  assert.equal(shelfSections(null).length, 0);
});

test('every section carries a heading and Timeline context without a page subtitle', () => {
  for (const section of CATALOG_SHELVES) {
    assert.ok(section.heading.length, `${section.key} has a heading`);
    assert.ok(section.blurb.length > 40, `${section.key} explains itself`);
    assert.equal('sub' in section, false, `${section.key} still carries a redundant page subtitle`);
    const copy = section.heading + section.blurb;
    assert.ok(!/[\u2013\u2014]/.test(copy), `${section.key} copy has no long dashes`);
  }
});

test('era context does not repeat the Start Here badge already drawn on a card', () => {
  for (const section of CATALOG_SHELVES) {
    assert.ok(!/start here/i.test(section.blurb), `${section.key}'s unconditional blurb promises no badge`);
  }
});

// The state the gating was written for, measured rather than asserted: narrowing that leaves a
// screen full of rows while the one story the badge is drawn on is gone. Measured on the landing
// page, which is the screen that draws a head over every shelf and so the screen the sentence can
// appear on: four of the seven facet chips do it.
test('narrowing can leave a screen populated with the first stop gone', async () => {
  const raw = JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
  const catalog = parseCatalog(raw);
  const placed = pathPlacements(catalog.paths, catalog.lists);
  const first = (stories) => stories.some((s) => placed.get(s.key)?.previous === null);
  assert.ok(first(groupCatalog(catalog.lists)), 'the badge is drawn somewhere to begin with');

  const hiding = catalogFacets(catalog.lists)
    .filter((facet) => facet.key !== 'all')
    .map((facet) => groupCatalog(filterByFacet(catalog.lists, facet.key)))
    .filter((stories) => stories.length && !first(stories));
  assert.ok(hiding.length, 'a facet keeps rows while dropping the story the badge is on');

  const searched = groupCatalog(searchCatalog(catalog.lists, 'x-men'));
  assert.ok(searched.length && !first(searched), 'and so does a search');
});

// This replaces an assertion that the reading path stayed wholly inside one section, which was the
// acceptance criterion of the two-part shelf. Splitting the catalog into three screens by kind of
// reading breaks it: the path is a sequence and the screens are sets, and the one bundled path runs
// through all three of them.
//
// That is a known consequence and it is with the owner, so this pins the shape rather than blessing
// it. What is asserted is the part not in dispute and the part that would be a genuine loss: every
// stop resolves, every stop is listed on exactly one screen, and no stop becomes unreachable. The
// screen count is pinned too, so a change to the split is a red build and a decision rather than a
// drift. When the owner rules on how the badge should carry a reader across a screen boundary, this
// is the test that changes.
test('every stop on the reading path is listed on exactly one screen', async () => {
  const raw = JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
  const catalog = parseCatalog(raw);
  const placed = pathPlacements(catalog.paths, catalog.lists);
  const onPath = groupCatalog(catalog.lists).filter((s) => placed.has(s.key));
  assert.ok(onPath.length >= 2, 'the catalog ships a reading path');

  const keys = CATALOG_SHELVES.map((shelf) => shelf.key);
  for (const story of onPath) {
    const on = keys.filter((key) => shelfKey(story) === key);
    assert.equal(on.length, 1, `${story.key} is a path stop listed on ${on.length} screens`);
  }

  const spans = new Set(onPath.map(shelfKey));
  assert.equal(
    spans.size,
    3,
    `the reading path spans ${spans.size} screens (${[...spans].join(', ')}); the split changed and the badge has to follow`,
  );
});

test('every screen has rows in the shipped catalog', async () => {
  const raw = JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
  const sections = shelfSections(groupCatalog(parseCatalog(raw).lists));
  assert.deepEqual(sections.map((s) => s.key), CATALOG_SHELVES.map((s) => s.key));
  for (const section of sections) assert.ok(section.stories.length, `${section.key} is not empty`);
});
