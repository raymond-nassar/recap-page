import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CATALOG_SHELVES,
  PUBLISHING_AGES,
  decadeSections,
  firstSentence,
  filterBySpotlightKind,
  groupCatalog,
  inPublishingAge,
  parseCatalog,
  resetCatalogNarrowing,
  shelfLists,
  shelfSections,
  pathPlacements,
  shelfStories,
  storyYear,
  timelineYears,
} from '../src/js/lib/catalog.js';
import { VIEWS } from '../src/js/lib/route.js';

// The catalog is split across three screens. Three screens is three chances to drop a story, and a
// story reachable from no screen at all is the worst outcome available here: it is bundled with the
// app, listed in no index, and the reader has no way to learn it exists. So the partition is
// asserted as a property rather than as three counts, and it is asserted at both levels, because a
// story is only whole on a shelf if every one of its readings came with it.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = parseCatalog(JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8')));
const stories = groupCatalog(catalog.lists);
const keys = CATALOG_SHELVES.map((shelf) => shelf.key);

test('Character Spotlight taxonomy accounts for every reading and preserves grouped stories', () => {
  const spotlights = shelfLists(catalog.lists, 'spotlights');
  assert.equal(spotlights.length, 14);
  assert.equal(groupCatalog(spotlights).length, 13);

  const expected = [
    ['best-of', 5, 5],
    ['complete-guide', 5, 5],
    ['other', 4, 3],
  ];
  for (const [kind, readingCount, storyCount] of expected) {
    const filtered = filterBySpotlightKind(spotlights, kind);
    assert.equal(filtered.length, readingCount, `${kind} reading count drifted`);
    assert.equal(groupCatalog(filtered).length, storyCount, `${kind} story count drifted`);
  }

  const xMen = groupCatalog(filterBySpotlightKind(spotlights, 'other'))
    .find((story) => story.key === 'xmen-claremont');
  assert.equal(xMen.lists.length, 2, 'the grouped X-Men readings were split');

  const rocket = spotlights.find((list) => list.id === 'rocket-raccoon-reading-order');
  assert.ok(filterBySpotlightKind(spotlights, 'complete-guide').includes(rocket));
  assert.equal(filterBySpotlightKind(spotlights, 'best-of').includes(rocket), false);

  const groot = spotlights.find((list) => list.id === 'groot-reading-order');
  assert.ok(groot, 'Groot is missing from Character Spotlight All');
  assert.ok(filterBySpotlightKind(spotlights, 'complete-guide').includes(groot));
  assert.equal(filterBySpotlightKind(spotlights, 'best-of').includes(groot), false);

  const starLord = spotlights.find((list) => list.id === 'star-lord-reading-order');
  assert.ok(starLord, 'Star-Lord is missing from Character Spotlight All');
  assert.ok(filterBySpotlightKind(spotlights, 'complete-guide').includes(starLord));
  assert.equal(filterBySpotlightKind(spotlights, 'best-of').includes(starLord), false);
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

test('every story reaches exactly one screen', () => {
  const reached = new Map();
  for (const key of keys) {
    for (const story of shelfStories(stories, key)) {
      reached.set(story.key, [...(reached.get(story.key) ?? []), key]);
    }
  }

  const unreachable = stories
    .filter((s) => !reached.has(s.key))
    .map((s) => `${s.name ?? s.lists[0].name} (${s.lists.map((l) => l.type).join('/')})`);
  assert.deepEqual(unreachable, [], `listed on no screen at all: ${unreachable.join(', ')}`);

  const twice = [...reached.entries()].filter(([, on]) => on.length > 1);
  assert.deepEqual(twice, [], `listed on more than one screen: ${twice.map(([k, on]) => `${k} on ${on.join(' and ')}`).join(', ')}`);
});

test('the screens sum to the catalog, in stories and in reading paths alike', () => {
  const byStory = keys.reduce((n, key) => n + shelfStories(stories, key).length, 0);
  assert.equal(byStory, stories.length, 'the screens and the catalog disagree about how many stories exist');

  const byList = keys.reduce((n, key) => n + shelfLists(catalog.lists, key).length, 0);
  assert.equal(byList, catalog.lists.length, 'the screens and the catalog disagree about how many orders exist');
});

// A story is assigned by all of its readings together, so a story read two ways cannot be torn in
// half and drawn on two screens. No bundled story mixes types today, which is why this is asserted
// on a fixture: the rule decides nothing yet, and it decides everything the first time one does.
test('a story whose readings disagree about type is not split across two screens', () => {
  const mixed = [{
    key: 'mixed',
    lists: [
      { id: 'mixed-a', name: 'Mixed', type: 'event', timeline: 2006 },
      { id: 'mixed-b', name: 'Mixed', type: 'character-run', timeline: 2006 },
    ],
  }];
  const on = keys.filter((key) => shelfStories(mixed, key).length);
  assert.deepEqual(on.length, 1, `a mixed story was drawn on ${on.length} screens: ${on.join(', ')}`);
  const fallback = CATALOG_SHELVES.find((shelf) => !shelf.types);
  assert.equal(on[0], fallback.key, 'a mixed story went to a typed screen rather than to the one that takes everything');
});

// Exactly one shelf takes whatever the others refuse. Two would make the assignment depend on which
// row is written first; none would let a new type fall off every screen at once.
test('exactly one screen takes what the others refuse', () => {
  const open = CATALOG_SHELVES.filter((shelf) => !shelf.types);
  assert.equal(open.length, 1, 'the shelves declare no single home for a type none of them names');
});

test('a type no screen names still reaches a reader', () => {
  const odd = [{ key: 'odd', lists: [{ id: 'odd', name: 'Odd', type: 'not-a-type', timeline: 2006 }] }];
  const on = keys.filter((key) => shelfStories(odd, key).length);
  assert.equal(on.length, 1, `an unknown type was drawn on ${on.length} screens`);
});

test('screen companions remain reachable on the existing Storylines screen', () => {
  const companion = { key: 'screen', lists: [{ type: 'screen-companion' }] };
  assert.deepEqual(keys.filter((key) => shelfStories([companion], key).length), ['lines']);
  assert.equal(CATALOG_SHELVES.length, 3, 'a fourth browse screen was added');
});

// An empty screen is dropped rather than drawn as a heading with nothing under it, the same rule the
// eras follow. Home draws every shelf, and a search narrowing the catalog to one kind of reading is
// a state a reader reaches rather than a theoretical one.
test('a screen with nothing on it is not drawn', () => {
  const events = shelfStories(stories, 'catalog');
  assert.ok(events.length, 'the events shelf is empty');
  const drawn = shelfSections(events);
  assert.equal(drawn.length, 1, 'a shelf with nothing on it was drawn');
  assert.equal(drawn[0].key, 'catalog');
});

test('every screen carries the words its own empty state and heading need', () => {
  for (const shelf of CATALOG_SHELVES) {
    for (const field of ['key', 'heading', 'blurb', 'empty']) {
      assert.equal(typeof shelf[field], 'string', `the ${shelf.key} shelf has no ${field}`);
      assert.ok(shelf[field].trim().length, `the ${shelf.key} shelf has an empty ${field}`);
    }
    assert.equal('sub' in shelf, false, `the ${shelf.key} shelf still carries a redundant subtitle`);
  }
  const headings = CATALOG_SHELVES.map((shelf) => shelf.heading);
  assert.equal(new Set(headings).size, headings.length, 'two screens share a heading');
});

test('Modern Timeline uses named eras and Storylines uses decade breaks', () => {
  assert.equal(CATALOG_SHELVES.find((shelf) => shelf.key === 'catalog').heading, 'Modern Timeline');
  assert.equal(CATALOG_SHELVES.find((shelf) => shelf.key === 'catalog').sections, 'eras');
  assert.equal(CATALOG_SHELVES.find((shelf) => shelf.key === 'lines').sections, 'decades');
  assert.equal(CATALOG_SHELVES.find((shelf) => shelf.key === 'spotlights').sections, null);
});

test('Storylines decade sections account for every story exactly once', () => {
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
      1983, 1989,
      1990, 1992, 1995, 1996, 1997, 1998, 2001, 2002, 2003, 2015, 2023,
    ],
  );
});

test('browse cards take exactly the first authored sentence', () => {
  assert.equal(firstSentence('First thought. Second thought.'), 'First thought.');
  assert.equal(firstSentence('One thought without punctuation'), 'One thought without punctuation');
  assert.equal(firstSentence(''), '');
  assert.equal(firstSentence(null), '');
});

// The shelf key doubles as the view id, so a shelf the router does not know is a rail entry leading
// nowhere and a screen with no address.
test('every screen is a route the app can reach', () => {
  for (const shelf of CATALOG_SHELVES) {
    assert.ok(VIEWS.includes(shelf.key), `the ${shelf.key} shelf is not a view the router accepts`);
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

// A "Next" that crosses a screen boundary is a link, so it has to know which screen. The answer
// travels on the stop rather than being worked out by whichever renderer drew the row, because a
// shelf's renderer only ever sees its own share of the catalog and could not resolve a stop that is
// not its.
test('every path stop carries the screen it is drawn on', () => {
  const placed = pathPlacements(catalog.paths, catalog.lists);
  assert.ok(placed.size >= 2, 'the catalog ships a reading path');
  for (const [key, placement] of placed) {
    assert.ok(placement.first, `${key} carries no head of its path, so its name can link nowhere`);
    for (const stop of [placement.first, placement.previous, placement.next].filter(Boolean)) {
      assert.ok(keys.includes(stop.shelf), `${key}'s neighbour ${stop.key} names a screen that exists`);
      assert.equal('onHome' in stop, false, `${key}'s neighbour ${stop.key} carries retired Home placement`);
    }
  }
});

// The one that keeps the link honest, and the reason arriving clears the destination's search box
// and facet chips. A link names one order and lands the reader at the top of a screen; if that
// order is not on the screen at all, the app has told them something untrue. Nothing at render time
// can repair that, so it is settled here instead: the screen a stop names is a screen that lists
// it, for every stop of every path, at both the story level and the reading level the facet counts
// are taken from. The head of the path is in this set because the path's own name links to it, so
// it makes the same promise the forward link does and has to keep it the same way.
test('every stop is listed on the screen its own link names', () => {
  const placed = pathPlacements(catalog.paths, catalog.lists);
  const named = new Set();
  for (const placement of placed.values()) {
    for (const stop of [placement.first, placement.previous, placement.next].filter(Boolean)) named.add(stop);
  }
  assert.ok(named.size >= 2, 'the path names neighbours to link to');

  for (const stop of named) {
    assert.ok(
      shelfStories(stories, stop.shelf).some((s) => s.key === stop.key),
      `${stop.name} is linked to ${stop.shelf}, which does not list it`,
    );
    assert.ok(
      groupCatalog(shelfLists(catalog.lists, stop.shelf)).some((s) => s.key === stop.key),
      `${stop.name}'s readings do not reach ${stop.shelf}, so that screen would count it and not draw it`,
    );
  }
});
