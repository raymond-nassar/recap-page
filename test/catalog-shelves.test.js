import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CATALOG_SHELVES,
  HOME_CATEGORIES,
  PUBLISHING_AGES,
  PUBLISHING_CATEGORIES,
  catalogEntries,
  catalogListBrowseRoute,
  catalogListShelf,
  decadeSections,
  firstSentence,
  filterBySpotlightKind,
  groupCatalog,
  inPublishingAge,
  isPublishingCategoryLeaf,
  modernTimelineFeaturedList,
  modernTimelineLists,
  parseCatalog,
  publishingCategoryStories,
  resetCatalogNarrowing,
  shelfLists,
  shelfSections,
  pathPlacements,
  shelfStories,
  storyTypeFacets,
  storyTypeStories,
  storyYear,
  storylinesLists,
  storylinesStories,
  timelineYears,
} from '../src/js/lib/catalog.js';
import { mcuPrepSections } from '../src/js/lib/mcuPrep.js';
import { VIEWS, parseRoute } from '../src/js/lib/route.js';
import { currentReadingCensus } from './helpers/current-reading-library.mjs';

// Internal shelves remain a partition even though browse screens can overlap. The reachability
// check below also requires every bundled list to appear on at least one active screen.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = parseCatalog(JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8')));
const stories = groupCatalog(catalog.lists);
const keys = CATALOG_SHELVES.map((shelf) => shelf.key);

test('the retained Storylines classification preserves complete original groups and no duplicate IDs', () => {
  const projected = storylinesStories(stories);
  const ids = projected.flatMap((story) => story.lists.map((list) => list.id));
  for (const id of ['civil-war-essential', 'civil-war', 'civil-war-avengers',
    'house-of-m', 'house-of-m-essential', 'secret-invasion', 'secret-invasion-essential',
    'marvel-knights-to-planet-x-02', 'marvel-knights-to-planet-x-78']) {
    assert.ok(ids.includes(id), `${id} missing from secondary discovery`);
    assert.equal(catalogListShelf(catalog.lists, id), 'catalog');
  }
  assert.equal(ids.length, currentReadingCensus.storylines);
  assert.equal(projected.length, currentReadingCensus.storylines - 6, 'existing variant groups keep their shared-card reduction');
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(ids.includes('marvel-knights-to-planet-x-01'), false);
  for (const canonical of shelfLists(catalog.lists, 'lines')) {
    if (canonical.type !== 'screen-companion') assert.ok(ids.includes(canonical.id));
  }
  const hickman = projected.find((story) => story.lists.some((list) => list.id === 'hickman-minimal'));
  assert.deepEqual(hickman.lists.map((list) => list.id), ['hickman-minimal', 'hickman-full']);
  const canonicalHickman = stories.find((story) => story.lists.some((list) => list.id === 'hickman-minimal'));
  assert.deepEqual(canonicalHickman.lists.map((list) => list.id),
    ['hickman-minimal', 'avengers-doomsday-secret-wars', 'hickman-full']);
});

// The historical projection excludes MCU Prep companions and retains eras and creator runs.
test('the historical Storylines projection excludes MCU Prep and retains eras and creator runs', () => {
  const companions = catalog.lists.filter((list) => list.type === 'screen-companion');
  assert.equal(companions.length, currentReadingCensus.mcu);
  const ids = new Set(storylinesLists(catalog.lists).map((list) => list.id));
  assert.deepEqual(companions.filter((list) => ids.has(list.id)).map((list) => list.id), []);
  for (const type of ['era', 'creator-run']) {
    const kept = catalog.lists.filter((list) => list.type === type);
    assert.ok(kept.length > 0, `no ${type} lists are bundled`);
    for (const list of kept) assert.ok(ids.has(list.id), `${list.id} left the historical Storylines projection`);
  }
  const lines = CATALOG_SHELVES.find((shelf) => shelf.key === 'lines');
  for (const text of [lines.blurb, lines.empty]) assert.doesNotMatch(text, /companion/i);
});

test('each issue breadcrumb resolves to an active browse screen', () => {
  const timeline = new Set(modernTimelineLists(catalog.lists).map(({ id }) => id));
  for (const list of catalog.lists) {
    const shelf = catalogListShelf(catalog.lists, list.id);
    const expected = list.type === 'screen-companion' ? 'marvel-on-screen'
      : shelf === 'lines' || (shelf === 'catalog' && !timeline.has(list.id)) ? 'genres' : shelf;
    const route = catalogListBrowseRoute(catalog.lists, list.id);
    assert.equal(route, expected, list.id);
    assert.ok(VIEWS.includes(route), `${list.id} names a retired screen`);
  }
  assert.equal(catalogListBrowseRoute(catalog.lists, 'avengers-doomsday-secret-wars'), 'marvel-on-screen');
  assert.equal(catalogListBrowseRoute(catalog.lists, 'hickman-minimal'), 'genres');
  assert.equal(catalogListBrowseRoute(catalog.lists, 'dark-phoenix-saga'), 'genres');
  assert.equal(catalogListBrowseRoute(catalog.lists, 'house-of-m'), 'catalog');
  for (const [lists, id] of [[null, 'a'], [catalog.lists, ''], [catalog.lists, 'missing']]) {
    assert.equal(catalogListBrowseRoute(lists, id), null);
  }
});

test('each bundled Reading List resolves through its grouped story to one canonical shelf', () => {
  for (const story of stories) {
    const shelf = keys.find((key) => shelfStories([story], key).length === 1);
    assert.ok(shelf, `${story.key} has no shelf`);
    for (const list of story.lists) {
      assert.equal(catalogListShelf(catalog.lists, list.id), shelf, `${list.id} resolved to the wrong shelf`);
    }
  }
  for (const [lists, id] of [[null, 'a'], [catalog.lists, ''], [catalog.lists, 'missing']]) {
    assert.equal(catalogListShelf(lists, id), null);
  }
});

test('Character Spotlight taxonomy accounts for every reading and preserves grouped stories', () => {
  const spotlights = shelfLists(catalog.lists, 'spotlights');
  // #897: the fifteen young readers' lists moved to their own screen, so they are counted there.
  assert.equal(spotlights.length, 72);
  assert.equal(groupCatalog(spotlights).length, 71);
  assert.equal(spotlights.some((list) => list.audience === 'young-readers'), false);


  const bestOf = filterBySpotlightKind(spotlights, 'best-of');
  const completeGuide = filterBySpotlightKind(spotlights, 'complete-guide');
  const other = filterBySpotlightKind(spotlights, 'other');
  const expected = [
    ['best-of', 9, 9],
    ['complete-guide', 38, 38],
    ['other', 25, 24],

  ];
  for (const [kind, readingCount, storyCount] of expected) {
    const filtered = filterBySpotlightKind(spotlights, kind);
    assert.equal(filtered.length, readingCount, `${kind} reading count drifted`);
    assert.equal(groupCatalog(filtered).length, storyCount, `${kind} story count drifted`);
  }

  const xMen = groupCatalog(other)
    .find((story) => story.key === 'xmen-claremont');
  assert.equal(xMen.lists.length, 2, 'the grouped X-Men readings were split');

  const rocket = spotlights.find((list) => list.id === 'rocket-raccoon-reading-order');
  assert.ok(completeGuide.includes(rocket));
  assert.equal(bestOf.includes(rocket), false);

  const groot = spotlights.find((list) => list.id === 'groot-reading-order');
  assert.ok(groot, 'Groot is missing from Character Spotlight All');
  assert.ok(completeGuide.includes(groot));
  assert.equal(bestOf.includes(groot), false);

  const abomination = spotlights.find((list) => list.id === 'abomination-reading-order');
  assert.ok(abomination, 'Abomination is missing from Character Spotlight All');
  assert.ok(filterBySpotlightKind(spotlights, 'complete-guide').includes(abomination));
  assert.equal(filterBySpotlightKind(spotlights, 'best-of').includes(abomination), false);

  const defenders = spotlights.find((list) => list.id === 'the-defenders-reading-order');
  assert.ok(defenders, 'The Defenders is missing from Character Spotlight All');
  assert.ok(completeGuide.includes(defenders));
  assert.equal(bestOf.includes(defenders), false);

  const blackPanther = spotlights.find((list) => list.id === 'black-panther-reading-order');
  assert.ok(blackPanther, 'Black Panther is missing from Character Spotlight All');
  assert.ok(completeGuide.includes(blackPanther));
  assert.equal(bestOf.includes(blackPanther), false);

  const doctorStrange = spotlights.find((list) => list.id === 'doctor-strange-reading-order');
  assert.ok(doctorStrange, 'Doctor Strange is missing from Character Spotlight All');
  assert.ok(completeGuide.includes(doctorStrange));
  assert.equal(bestOf.includes(doctorStrange), false);

  const starLord = spotlights.find((list) => list.id === 'star-lord-reading-order');
  assert.ok(starLord, 'Star-Lord is missing from Character Spotlight All');
  assert.ok(completeGuide.includes(starLord));
  assert.equal(bestOf.includes(starLord), false);

  const adamWarlock = spotlights.find((list) => list.id === 'adam-warlock-reading-order');
  assert.ok(adamWarlock, 'Adam Warlock is missing from Character Spotlight All');
  assert.ok(completeGuide.includes(adamWarlock));
  assert.equal(bestOf.includes(adamWarlock), false);

  const hopeSummers = spotlights.find((list) => list.id === 'hope-summers-reading-order');
  assert.ok(hopeSummers, 'Hope Summers is missing from Character Spotlight All');
  assert.ok(other.includes(hopeSummers));
  assert.equal(completeGuide.includes(hopeSummers), false);

  const x23 = spotlights.find((list) => list.id === 'x-23-reading-order');
  assert.ok(x23, 'X-23 is missing from Character Spotlight All');
  assert.ok(completeGuide.includes(x23));
  assert.equal(bestOf.includes(x23), false);

  const hawkeye = spotlights.find((list) => list.id === 'hawkeye-reading-order');
  assert.ok(hawkeye, 'Hawkeye is missing from Character Spotlight All');
  assert.ok(other.includes(hawkeye));
  assert.equal(completeGuide.includes(hawkeye), false);

  const ironFist = spotlights.find((list) => list.id === 'iron-fist-reading-order');
  assert.ok(ironFist, 'Iron Fist is missing from Character Spotlight All');
  assert.ok(other.includes(ironFist));
  assert.equal(completeGuide.includes(ironFist), false);

  const silk = spotlights.find((list) => list.id === 'silk-cindy-moon-reading-order');
  assert.ok(silk, 'Silk is missing from Character Spotlight All');
  assert.ok(other.includes(silk));
  assert.equal(completeGuide.includes(silk), false);
  const kamala = spotlights.find((list) => list.id === 'ms-marvel-kamala-khan-reading-order');
  assert.ok(kamala, 'Kamala is missing from Character Spotlight All');
  assert.ok(other.includes(kamala));
  assert.equal(completeGuide.includes(kamala), false);
  const nova = spotlights.find((list) => list.id === 'nova-reading-order');
  assert.ok(nova, 'Nova is missing from Character Spotlight All');
  assert.ok(other.includes(nova));
  assert.equal(completeGuide.includes(nova), false);
  const gregPak = catalog.lists.find((list) =>
    list.id === 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide');
  assert.ok(gregPak, 'The Greg Pak creator route is missing from the catalog');
  assert.equal(catalogListShelf(catalog.lists, gregPak.id), 'lines');
  assert.equal(spotlights.includes(gregPak), false);
  assert.equal(gregPak.spotlightKind, null);

});

test('a path arrival clears the subset that would hide Essential Avengers', () => {
  const spotlights = shelfLists(catalog.lists, 'spotlights');
  const essential = spotlights.find((list) => list.id === 'essential-avengers');
  assert.equal(essential.spotlightKind, 'other');
  assert.equal(filterBySpotlightKind(spotlights, 'complete-guide').includes(essential), false);

  const state = { query: 'phalanx', facet: 'beginner', spotlight: 'complete-guide' };
  resetCatalogNarrowing(state);
  assert.equal(filterBySpotlightKind(spotlights, state.spotlight).includes(essential), true);
});

test('every story belongs to exactly one internal shelf', () => {
  const reached = new Map();
  for (const key of keys) {
    for (const story of shelfStories(stories, key)) {
      reached.set(story.key, [...(reached.get(story.key) ?? []), key]);
    }
  }

  const unreachable = stories
    .filter((s) => !reached.has(s.key))
    .map((s) => `${s.name ?? s.lists[0].name} (${s.lists.map((l) => l.type).join('/')})`);
  assert.deepEqual(unreachable, [], `listed on no shelf at all: ${unreachable.join(', ')}`);

  const twice = [...reached.entries()].filter(([, on]) => on.length > 1);
  assert.deepEqual(twice, [], `listed on more than one shelf: ${twice.map(([k, on]) => `${k} on ${on.join(' and ')}`).join(', ')}`);
});

test('the internal shelves sum to the catalog, in stories and in reading paths alike', () => {
  const byStory = keys.reduce((n, key) => n + shelfStories(stories, key).length, 0);
  assert.equal(byStory, stories.length, 'the shelves and the catalog disagree about how many stories exist');

  const byList = keys.reduce((n, key) => n + shelfLists(catalog.lists, key).length, 0);
  assert.equal(byList, catalog.lists.length, 'the shelves and the catalog disagree about how many orders exist');
});

test('every bundled Reading List remains reachable without the retired Storylines screen', () => {
  assert.equal(HOME_CATEGORIES.some(({ key }) => key === 'storylines'), false);
  assert.equal(VIEWS.includes('lines'), false);
  const entries = catalogEntries(catalog.lists);
  const enabled = (route) => HOME_CATEGORIES.some((category) => category.route === route)
    && VIEWS.includes(route);
  const ids = (stories) => stories.flatMap((story) => story.lists.map((list) => list.id));
  const reachable = new Set();
  const timeline = new Set(enabled('catalog') ? modernTimelineLists(catalog.lists).map(({ id }) => id) : []);
  if (enabled('catalog')) timeline.add(modernTimelineFeaturedList(catalog.lists)?.id);
  const genres = new Set();
  if (enabled('genres')) {
    for (const { key } of storyTypeFacets(entries).types) {
      for (const id of ids(storyTypeStories(entries, { type: key }))) genres.add(id);
    }
  }
  const ages = new Set();
  if (enabled('marvel-ages')) {
    for (const category of PUBLISHING_CATEGORIES.filter(isPublishingCategoryLeaf)) {
      if (!VIEWS.includes(category.route)) continue;
      for (const id of ids(publishingCategoryStories(entries, category.key))) ages.add(id);
    }
  }
  for (const set of [timeline, genres, ages]) for (const id of set) reachable.add(id);
  for (const [route, shelf] of [['spotlights', 'spotlights'], ['young-readers', 'young-readers']]) {
    if (enabled(route)) for (const list of shelfLists(catalog.lists, shelf)) reachable.add(list.id);
  }
  const companions = mcuPrepSections(catalog.lists, null).flatMap((section) => section.entries.map(({ list }) => list.id));
  if (enabled('marvel-on-screen')) for (const id of companions) reachable.add(id);

  const missing = catalog.lists.filter(({ id }) => !reachable.has(id)).map(({ id }) => id);
  assert.deepEqual(missing, [], `lists on no active browse screen: ${missing.join(', ')}`);
  assert.deepEqual(companions.filter((id) => genres.has(id)), [], 'MCU Prep stays on its own screen');
  const events = storylinesLists(catalog.lists).filter(({ type }) => type === 'event');
  assert.equal(events.length, 34);
  for (const list of events) {
    assert.ok(genres.has(list.id), `${list.id} is missing from Genres`);
    if (list.timeline < 2004) assert.ok(ages.has(list.id), `${list.id} is missing from Marvel Ages`);
    else assert.ok(timeline.has(list.id), `${list.id} is missing from Modern Timeline`);
  }
});

// A story is classified by all its readings together, even though browse categories may overlap.
test('a story whose readings disagree about type is not split across shelves', () => {
  const mixed = [{
    key: 'mixed',
    lists: [
      { id: 'mixed-a', name: 'Mixed', type: 'event', timeline: 2006 },
      { id: 'mixed-b', name: 'Mixed', type: 'character-run', timeline: 2006 },
    ],
  }];
  const on = keys.filter((key) => shelfStories(mixed, key).length);
  assert.deepEqual(on.length, 1, `a mixed story was assigned to ${on.length} shelves: ${on.join(', ')}`);
  const fallback = CATALOG_SHELVES.find((shelf) => !shelf.types);
  assert.equal(on[0], fallback.key, 'a mixed story went to a typed shelf rather than the fallback');
});

// Exactly one shelf takes whatever the others refuse. Two would make the assignment depend on which
// row is written first; none would leave a new type without a classification.
test('exactly one shelf takes what the others refuse', () => {
  const open = CATALOG_SHELVES.filter((shelf) => !shelf.types);
  assert.equal(open.length, 1, 'the shelves declare no single home for a type none of them names');
});

test('a type no shelf names still receives a classification', () => {
  const odd = [{ key: 'odd', lists: [{ id: 'odd', name: 'Odd', type: 'not-a-type', timeline: 2006 }] }];
  const on = keys.filter((key) => shelfStories(odd, key).length);
  assert.equal(on.length, 1, `an unknown type was assigned to ${on.length} shelves`);
});

test('the internal fallback classification still includes screen companions', () => {
  const companion = { key: 'screen', lists: [{ type: 'screen-companion' }] };
  assert.deepEqual(keys.filter((key) => shelfStories([companion], key).length), ['lines']);
  // Young readers is the fourth internal shelf, independently of overlapping browse categories.
  assert.equal(CATALOG_SHELVES.length, 4, 'a fifth internal shelf was added');
});

// #897. The Young readers shelf is chosen by audience rather than type or table order.
test('young readers\' lists use the Young readers shelf, whatever their type', () => {
  const young = shelfLists(catalog.lists, 'young-readers');
  assert.deepEqual(young.map((list) => list.id).sort(),
    catalog.lists.filter((list) => list.audience === 'young-readers').map((list) => list.id).sort());
  assert.equal(young.length, 15);
  assert.equal(groupCatalog(young).length, 15);
  for (const type of ['event', 'character-run', 'creator-run', 'era', 'screen-companion']) {
    const story = { key: type, lists: [{ id: type, name: type, type, audience: 'young-readers' }] };
    assert.deepEqual(keys.filter((key) => shelfStories([story], key).length), ['young-readers'], type);
    const plain = { key: type, lists: [{ id: type, name: type, type, audience: null }] };
    assert.equal(shelfStories([plain], 'young-readers').length, 0, `${type} with no audience`);
  }
  const mixed = { key: 'mixed', lists: [
    { id: 'a', name: 'A', type: 'character-run', audience: 'young-readers' },
    { id: 'b', name: 'B', type: 'character-run', audience: null },
  ] };
  assert.deepEqual(keys.filter((key) => shelfStories([mixed], key).length), ['lines'],
    'a story whose readings disagree about audience goes where a story mixing types goes');
});

test('an empty shelf section is not drawn', () => {
  const events = shelfStories(stories, 'catalog');
  assert.ok(events.length, 'the events shelf is empty');
  const drawn = shelfSections(events);
  assert.equal(drawn.length, 1, 'a shelf with nothing on it was drawn');
  assert.equal(drawn[0].key, 'catalog');
});

test('every internal shelf carries heading and empty-state metadata', () => {
  for (const shelf of CATALOG_SHELVES) {
    for (const field of ['key', 'heading', 'blurb', 'empty']) {
      assert.equal(typeof shelf[field], 'string', `the ${shelf.key} shelf has no ${field}`);
      assert.ok(shelf[field].trim().length, `the ${shelf.key} shelf has an empty ${field}`);
    }
    assert.equal('sub' in shelf, false, `the ${shelf.key} shelf still carries a redundant subtitle`);
  }
  const headings = CATALOG_SHELVES.map((shelf) => shelf.heading);
  assert.equal(new Set(headings).size, headings.length, 'two shelves share a heading');
});

test('Modern Timeline uses named eras and the historical Storylines grouping uses decade breaks', () => {
  assert.equal(CATALOG_SHELVES.find((shelf) => shelf.key === 'catalog').heading, 'Modern Timeline');
  assert.equal(CATALOG_SHELVES.find((shelf) => shelf.key === 'catalog').sections, 'eras');
  assert.equal(CATALOG_SHELVES.find((shelf) => shelf.key === 'lines').sections, 'decades');
  assert.equal(CATALOG_SHELVES.find((shelf) => shelf.key === 'spotlights').sections, null);
});

test('historical Storylines decade sections account for every story exactly once', () => {
  const storylines = shelfStories(stories, 'lines');
  const sections = decadeSections(storylines);
  const drawn = sections.flatMap((section) => section.stories);
  assert.deepEqual(drawn, storylines, 'the decade breaks reordered or dropped a storyline');
  assert.ok(sections.every((section) => section.heading && section.blurb), 'a decade break has no visible name');
});

test('an undated storyline has an honest section rather than a guessed decade', () => {
  const undated = { key: 'wide', lists: [{ id: 'wide', name: 'Wide', type: 'creator-run' }] };
  const sections = decadeSections([undated]);
  assert.equal(sections.length, 1);
  assert.equal(sections[0].heading, 'Across eras');
  assert.deepEqual(sections[0].stories, [undated]);
});

test('the timeline spine derives its ends and preserves internal empty years', () => {
  const events = shelfStories(stories, 'catalog');
  const years = timelineYears(events);
  const present = events.map(storyYear);
  assert.equal(years[0].year, Math.min(...present));
  assert.equal(years.at(-1).year, Math.max(...present));
  assert.ok(years[0].count > 0 && years.at(-1).count > 0, 'the derived range has an empty end');
  assert.deepEqual(
    years.filter(({ count }) => count === 0).map(({ year }) => year),
    [
      1966, 1967, 1968, 1969, 1970, 1972, 1974, 1975, 1977, 1978, 1979,
      1983, 1995, 2015,
    ],
  );
});

test('browse cards take exactly the first authored sentence', () => {
  assert.equal(firstSentence('First thought. Second thought.'), 'First thought.');
  assert.equal(firstSentence('One thought without punctuation'), 'One thought without punctuation');
  assert.equal(firstSentence(''), '');
  assert.equal(firstSentence(null), '');
});

// The retained fallback classification is not a screen; its old address opens Genres instead.
test('active shelf screens remain routable and the fallback address opens Genres', () => {
  for (const shelf of CATALOG_SHELVES) {
    if (shelf.key === 'lines') {
      assert.equal(VIEWS.includes(shelf.key), false);
      assert.equal(parseRoute('#/lines').view, 'genres');
    } else {
      assert.ok(VIEWS.includes(shelf.key), `the ${shelf.key} shelf is not a view the router accepts`);
    }
  }
});

// ------------------------------------------------------------------ publishing ages

// The modern-era boundary is data in the same table-driven place the eras are, so adding a Silver
// Age or Bronze Age screen is a row rather than an edit to a render function.
test('publishing ages keep reusable boundaries for future overlapping categories', () => {
  const modern = PUBLISHING_AGES.find((age) => age.key === 'modern');
  assert.equal(typeof modern.from, 'number', 'the modern age declares no start year');
  assert.equal('home' in modern, false, 'the age still owns the retired landing-page boundary');
});

test('an age selector includes its boundary and refuses the year before it', () => {
  const from = PUBLISHING_AGES.find((age) => age.key === 'modern').from;
  const older = { key: 'old', lists: [{ id: 'old', name: 'Old', type: 'event', timeline: from - 1 }] };
  const newer = { key: 'new', lists: [{ id: 'new', name: 'New', type: 'event', timeline: from }] };
  assert.equal(inPublishingAge(older, 'modern'), false);
  assert.equal(inPublishingAge(newer, 'modern'), true);
});

test('an undated story is not guessed into a publishing age', () => {
  const undated = { key: 'best-of', lists: [{ id: 'best-of', name: 'Best of', type: 'character-run' }] };
  assert.equal(storyYear(undated), null);
  assert.equal(inPublishingAge(undated, 'modern'), false);
  assert.equal(inPublishingAge(undated, 'missing'), false);
});

// ------------------------------------------------------------- path links

test('every path stop retains its internal shelf classification', () => {
  const placed = pathPlacements(catalog.paths, catalog.lists);
  assert.ok(placed.size >= 2, 'the catalog ships a reading path');
  for (const [key, placement] of placed) {
    assert.ok(placement.first, `${key} carries no head of its path, so its name can link nowhere`);
    for (const stop of [placement.first, placement.previous, placement.next].filter(Boolean)) {
      assert.ok(keys.includes(stop.shelf), `${key}'s neighbour ${stop.key} has no classification`);
      assert.equal('onHome' in stop, false, `${key}'s neighbour ${stop.key} carries retired Home placement`);
    }
  }
});

test('every stop belongs to its internal shelf at story and reading level', () => {
  const placed = pathPlacements(catalog.paths, catalog.lists);
  const named = new Set();
  for (const placement of placed.values()) {
    for (const stop of [placement.first, placement.previous, placement.next].filter(Boolean)) named.add(stop);
  }
  assert.ok(named.size >= 2, 'the path names neighbours to link to');

  for (const stop of named) {
    assert.ok(
      shelfStories(stories, stop.shelf).some((s) => s.key === stop.key),
      `${stop.name} is classified under ${stop.shelf}, which does not contain it`,
    );
    assert.ok(
      groupCatalog(shelfLists(catalog.lists, stop.shelf)).some((s) => s.key === stop.key),
      `${stop.name}'s readings do not belong to ${stop.shelf}`,
    );
  }
});
