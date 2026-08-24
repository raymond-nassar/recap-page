import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CATALOG_ERAS,
  eraKey,
  eraSections,
  groupCatalog,
  parseCatalog,
  shelfLists,
  shelfStories,
  spanLabel,
  storyYear,
} from '../src/js/lib/catalog.js';

// The browse screen signposts the events shelf with named eras. What matters is not which era any
// one order lands in, which is a judgement that will move, but that the eras place every order
// somewhere and place none of them twice. A bucket count asserts today's data; a partition asserts
// the property the screen depends on, and it keeps holding when a boundary moves.
//
// The eras are closed at both ends, so a story can match no era at all. That is deliberate, and it
// is why two of these tests are a pair failing in opposite directions: one that the fallback catches
// a stray and names it, one that the fallback is empty on the shipped catalog.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = parseCatalog(JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8')));
const stories = groupCatalog(catalog.lists);
// Eras divide one shelf rather than the whole catalog, so they are asked about the shelf that uses
// them. Feeding them everything would test an arrangement the app never draws.
const events = shelfStories(stories, 'catalog');
const sections = eraSections(events);

const named = CATALOG_ERAS.filter((era) => !era.undated && !era.fallback);
const fallback = CATALOG_ERAS.find((era) => era.fallback);

const one = (id, timeline, type = 'event') => ({ key: id, lists: [{ id, name: id, timeline, type }] });

test('every reading order lands in exactly one era', () => {
  const placed = new Map();
  for (const section of sections) {
    for (const story of section.stories) {
      placed.set(story.key, [...(placed.get(story.key) ?? []), section.key]);
    }
  }

  const missing = events.filter((s) => !placed.has(s.key)).map((s) => s.name ?? s.lists[0].name);
  assert.deepEqual(missing, [], `fell out of every era: ${missing.join(', ')}`);

  const twice = [...placed.entries()].filter(([, keys]) => keys.length > 1);
  assert.deepEqual(twice, [], `placed in more than one era: ${twice.map(([k]) => k).join(', ')}`);
});

// Counted in reading paths rather than in stories, because the partition has to hold for the rows
// actually drawn: a story is only whole on the shelf if every one of its readings came with it.
test('the eras account for every bundled reading path, not merely every story', () => {
  const inSections = sections.reduce((n, s) => n + s.stories.reduce((m, x) => m + x.lists.length, 0), 0);
  assert.equal(
    inSections,
    shelfLists(catalog.lists, 'catalog').length,
    'the eras and the events shelf disagree about how many orders exist',
  );
});

// The half of the pair that fails when the table has fallen behind the data. An order dated outside
// every declared era is caught and named with its year, so the obvious fix is to add an era row
// rather than to wonder why a count moved.
test('an order dated outside every era is caught by name, rather than lost', () => {
  for (const stray of [one('early', 1964), one('future', 2999)]) {
    const landed = eraSections([stray]);
    assert.equal(landed.length, 1, `${stray.key} was drawn in ${landed.length} sections rather than one`);
    assert.equal(
      landed[0].key,
      fallback.key,
      `${stray.key}, dated ${storyYear(stray)}, was claimed by "${landed[0].heading}" rather than held for an era row`,
    );
    assert.equal(landed[0].stories[0].key, stray.key);
  }
});

// The other half, failing in the opposite direction. The fallback exists for a state the app is
// expected never to be in, and a fallback quietly holding real content is that state. Between the
// two, it cannot become the place everything lands while the suite stays green.
test('nothing in the shipped catalog needs the fallback', () => {
  const strays = events
    .filter((s) => eraKey(s) === fallback.key)
    .map((s) => `${s.name ?? s.lists[0].name} (${storyYear(s)})`);
  assert.deepEqual(strays, [], `these are dated outside every era, so an era row is missing: ${strays.join(', ')}`);
  assert.equal(sections.some((s) => s.fallback), false, 'the fallback section was drawn on the shipped catalog');
});

// The fallback's rows share nothing but having been refused by every era, so a range over them would
// read as a stretch it covers rather than as unrelated strays.
test('the fallback never claims a range, however many years it holds', () => {
  const [section] = eraSections([one('early', 1964), one('future', 2999)]);
  assert.equal(section.key, fallback.key);
  assert.equal(section.blurb, fallback.blurb, 'the fallback appended a span to its blurb');
  assert.equal(/\d{4}/.test(section.blurb), false, 'the fallback printed a year');
});

test('an order with no year at all lands, rather than falling out of the shelf', () => {
  const undated = { key: 'best-of', lists: [{ id: 'best-of', name: 'Best of', type: 'character-run' }] };
  assert.equal(storyYear(undated), null);
  const landed = eraSections([undated]);
  assert.equal(landed.length, 1);
  assert.equal(landed[0].stories[0].key, 'best-of');
  assert.equal(landed[0].fallback, undefined, 'an undated order was treated as a stray rather than as undated');
});

// An era with nothing in it is dropped rather than drawn as a heading over empty space, the same
// rule the shelves follow. Searching and the facet chips both narrow the shelf far enough to empty
// an era, so this is a state a reader reaches rather than a theoretical one.
test('an era with nothing in it is not drawn', () => {
  const only = events.filter((s) => storyYear(s) === 2006);
  assert.ok(only.length, 'the fixture year has gone from the catalog');
  const landed = eraSections(only);
  assert.equal(landed.length, 1, 'an empty era was drawn with nothing under it');
  assert.ok(landed[0].stories.length);
});

// The defect this guards is the one the section blurbs were already written to avoid: a heading or a
// blurb that advertises something the section cannot show. The catalog has no event in 2001, 2002,
// 2003, 2015 or 2023, so a span taken from the bucket bounds would name years with nothing under
// them.
test('the span a section prints is the span of what landed in it', () => {
  for (const section of sections) {
    // The fallback is exempt by design and has its own test; it holds a span it deliberately
    // declines to print.
    if (section.fallback || !section.span) continue;
    const years = section.stories.map(storyYear).filter((y) => y !== null);
    assert.equal(section.span.from, Math.min(...years), `${section.key} claims to start before anything in it`);
    assert.equal(section.span.to, Math.max(...years), `${section.key} claims to run past anything in it`);
    assert.ok(section.blurb.includes(spanLabel(section.span)), `${section.key} prints a span its blurb does not carry`);
  }
});

// The eras at each end print their derived span like every other, rather than suppressing it as
// noise. It is the early warning that the table has fallen behind the data: when content arrives
// from a stretch no era names, the range a reader sees is the thing that moves first.
test('the eras at each end print a span rather than suppressing it', () => {
  const dated = sections.filter((s) => !s.undated && !s.fallback);
  assert.ok(dated.length >= 2, 'the shelf drew fewer than two dated eras');
  for (const section of [dated[0], dated[dated.length - 1]]) {
    assert.ok(section.span, `${section.key} derived no span`);
    assert.ok(section.blurb.includes(spanLabel(section.span)), `${section.key} did not print its derived span`);
  }
});

test('a section holding one year says that year rather than a range with one end', () => {
  assert.equal(spanLabel({ from: 2006, to: 2006 }), '2006');
  assert.equal(spanLabel({ from: 2000, to: 2007 }), '2000 to 2007');
  assert.equal(spanLabel(null), null);
});

// The era names point at orders on the shelf. An era named after something the catalog does not
// contain is the same failure as a blurb naming a badge that is not drawn: it reads as a signpost
// and points nowhere. Siege is the live example, absent from the catalog and so absent from here.
test('every era is named after orders the catalog actually contains', () => {
  const names = catalog.lists.map((l) => l.name.toLowerCase());
  assert.equal(CATALOG_ERAS.filter((e) => e.undated).length, 1, 'exactly one era is expected to take the undated orders');
  assert.equal(CATALOG_ERAS.filter((e) => e.fallback).length, 1, 'exactly one era is expected to catch strays');

  for (const era of named) {
    // The heading names two orders, joined by "to", and both ends have to exist on the shelf.
    for (const part of era.heading.split(' to ')) {
      const needle = part.trim().toLowerCase();
      assert.ok(
        names.some((n) => n.includes(needle)),
        `the era "${era.heading}" names "${part.trim()}", which is not in the catalog`,
      );
    }
  }
});

// Closed at both ends, which is the decision the fallback exists to make safe. An open end would
// keep the partition total for free, but it would do it by swallowing a 1975 event into an era named
// for 2004, and a heading that cannot be wrong is worth less than one that fails loudly.
test('every era declares real bounds at both ends', () => {
  assert.ok(named.length >= 2, 'at least two dated eras are expected');
  for (const era of named) {
    assert.equal(typeof era.from, 'number', `${era.key} is open at the start, so an older order would be mislabelled`);
    assert.equal(typeof era.to, 'number', `${era.key} is open at the end, so a newer order would be mislabelled`);
    assert.ok(era.from <= era.to, `${era.key} runs backwards`);
  }
});

// Ordered and non-overlapping, checked on the declarations rather than on where the bundled orders
// happen to land. Overlap would put one year in two eras and make the partition a matter of which
// row was written first.
//
// Gaps are allowed, and that is the point of closing the eras. Demanding contiguity would make
// adding a row an edit to its neighbour as well, which is exactly the one-line edit the table exists
// to keep cheap. Anything dated inside a gap is caught by the fallback, drawn for the reader and
// failed in the suite, so a gap loses nothing.
test('the eras are declared in order and no year belongs to two of them', () => {
  for (let i = 1; i < named.length; i += 1) {
    assert.ok(
      named[i].from > named[i - 1].to,
      `${named[i - 1].heading} ends at ${named[i - 1].to} and ${named[i].heading} starts at ${named[i].from}`,
    );
  }
});

// The trap that closing the eras leaves behind. A bucket cannot acquire content outside its bounds
// any more, so the only way its heading can come to mislabel what it holds is for someone to widen
// the bounds instead of adding a row. This is what says so.
//
// Three years of slack, because the longest run of years the bundled catalog skips is three, 2001 to
// 2003, so an era may legitimately reach three empty years past its content. Further than that and
// the bound is reaching past the stretch of publishing its heading names.
test('no era reaches far past what it holds', () => {
  const SLACK = 3;
  for (const section of sections) {
    if (section.undated || section.fallback) continue;
    assert.ok(
      section.span.from - section.from <= SLACK,
      `"${section.heading}" starts at ${section.from} but holds nothing before ${section.span.from}`,
    );
    assert.ok(
      section.to - section.span.to <= SLACK,
      `"${section.heading}" runs to ${section.to} but holds nothing after ${section.span.to}`,
    );
  }
});
