import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MODERN_TIMELINE_FEATURED_ID,
  MODERN_TIMELINE_CHAPTER_COUNT,
  MODERN_TIMELINE_CONTINUATION_YEAR,
  MODERN_TIMELINE_START_YEAR,
  eraSections,
  groupCatalog,
  modernTimelineFeaturedList,
  modernTimelineLists,
  modernTimelineStories,
  parseCatalog,
  publishingCategoryStories,
  isModernTimelineChapterId,
  shelfLists,
} from '../src/js/lib/catalog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = parseCatalog(JSON.parse(
  readFileSync(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8'),
));
const stories = groupCatalog(catalog.lists);
const styles = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');

const story = (key, ...lists) => ({ key, lists });
const list = (id, timeline, extra = {}) => ({
  id,
  name: id,
  type: 'event',
  timeline,
  ...extra,
});

test('the app-selected Modern Timeline opens in 1998 and resumes in 2004', () => {
  const selected = modernTimelineStories([
    story('older', list('older', 1997)),
    story('opening', list('marvel-knights-to-planet-x-01', 1998)),
    story('other-1998', list('other-1998', 1998)),
    story('before-continuation', list('before-continuation', 2003)),
    story('continuation', list('continuation', 2004)),
    story('later', list('later', 2024)),
    story('undated', list('undated', null)),
    story('wrong-kind', list('wrong-kind', 2004, { type: 'creator-run' })),
    story('split', list('split-old', 1997), list('split-new', 1998)),
  ]);

  assert.equal(MODERN_TIMELINE_START_YEAR, 1998);
  assert.equal(MODERN_TIMELINE_CONTINUATION_YEAR, 2004);
  assert.deepEqual(selected.map(({ key }) => key), ['opening', 'continuation', 'later']);
});

test('list selection preserves order and never splits a grouped story', () => {
  const lists = [
    list('older', 1997),
    list('marvel-knights-to-planet-x-01', 1998),
    list('other-1998', 1998),
    list('split-old', 1997, { group: 'split' }),
    list('split-new', 1998, { group: 'split' }),
    list('continuation', 2004),
  ];

  assert.deepEqual(
    modernTimelineLists(lists).map(({ id }) => id),
    ['marvel-knights-to-planet-x-01', 'continuation'],
  );
});

test('the chapter family predicate is bounded to the 78 generated ids', () => {
  assert.equal(MODERN_TIMELINE_CHAPTER_COUNT, 78);
  assert.equal(isModernTimelineChapterId('marvel-knights-to-planet-x-01'), true);
  assert.equal(isModernTimelineChapterId('marvel-knights-to-planet-x-78'), true);
  for (const id of [
    'marvel-knights-to-planet-x',
    'marvel-knights-to-planet-x-00',
    'marvel-knights-to-planet-x-79',
    'marvel-knights-to-planet-x-1',
    'other-01',
  ]) {
    assert.equal(isModernTimelineChapterId(id), false, id);
  }
});

test('the featured guide resolves the existing catalog entry and no substitute', () => {
  const featured = modernTimelineFeaturedList(catalog.lists);
  assert.equal(MODERN_TIMELINE_FEATURED_ID, 'setup-to-modern-timeline');
  assert.equal(featured?.id, MODERN_TIMELINE_FEATURED_ID);
  assert.equal(featured?.type, 'era');
  assert.equal(featured?.timeline, null);
  assert.equal(catalog.lists.filter(({ id }) => id === MODERN_TIMELINE_FEATURED_ID).length, 1);
  assert.equal(modernTimelineFeaturedList([]), null);
});

test('the shipped Modern Timeline carries all chapters into the Avengers era', () => {
  const selectedLists = modernTimelineLists(catalog.lists);
  const selectedStories = modernTimelineStories(stories);
  const sections = eraSections(selectedStories);
  const datedSections = sections.filter(({ span }) => span);
  const excluded = shelfLists(catalog.lists, 'catalog')
    .filter(({ id, timeline }) => (
      timeline >= MODERN_TIMELINE_START_YEAR
      && timeline < MODERN_TIMELINE_CONTINUATION_YEAR
      && !isModernTimelineChapterId(id)
    ));
  const periodIds = new Set(
    publishingCategoryStories(stories, 'marvel-knights-heroes-return')
      .flatMap(({ lists }) => lists.map(({ id }) => id)),
  );
  const olderEvents = shelfLists(catalog.lists, 'catalog')
    .filter(({ timeline }) => timeline < MODERN_TIMELINE_START_YEAR);

  const chapters = selectedLists.filter(({ id }) => isModernTimelineChapterId(id));
  assert.equal(selectedLists.length, 148);
  assert.equal(selectedStories.length, 144);
  assert.equal(olderEvents.length, 34);
  assert.deepEqual(
    selectedStories.slice(0, 2).map(({ lists: [first] }) => [first.name, first.timeline]),
    [
      ['Daredevil & Black Widow Opening Sequence', 1998],
      ['Punisher: Welcome Back Frank', 2000],
    ],
  );
  assert.ok(selectedLists.every(({ id, type, timeline }) => (
    type === 'event'
    && (
      timeline >= MODERN_TIMELINE_CONTINUATION_YEAR
      || (isModernTimelineChapterId(id) && timeline >= MODERN_TIMELINE_START_YEAR)
    )
  )));
  assert.equal(chapters.length, 78);
  assert.deepEqual(
    Object.fromEntries([1998, 1999, 2000, 2001, 2002, 2003, 2004].map((year) => [
      year,
      chapters.filter((list) => list.timeline === year).length,
    ])),
    {
      1998: 1, 1999: 0, 2000: 2, 2001: 16, 2002: 24, 2003: 32, 2004: 3,
    },
  );
  for (const year of [1998, 2000, 2001, 2002, 2003, 2004]) {
    const ordinals = chapters
      .filter((list) => list.timeline === year)
      .map((list) => Number(list.id.slice(-2)));
    assert.ok(ordinals.every((ordinal, index) => index === 0 || ordinal > ordinals[index - 1]));
  }
  assert.ok(selectedLists.some(({ id }) => id === 'avengers-disassembled'));
  assert.equal(selectedLists.some(({ id }) => id === 'operation-zero-tolerance'), false);
  assert.equal(selectedLists.some(({ id }) => id === MODERN_TIMELINE_FEATURED_ID), false);
  assert.deepEqual(
    excluded.map(({ id }) => id),
    ['spider-man-identity-crisis', 'hunt-for-xavier', 'eighth-day', 'magneto-war', 'maximum-security'],
  );
  assert.ok(excluded.every(({ id }) => periodIds.has(id)));
  assert.equal(datedSections[0].from, MODERN_TIMELINE_START_YEAR);
  assert.equal(datedSections[0].to, 2003);
  assert.equal(datedSections[1].from, MODERN_TIMELINE_CONTINUATION_YEAR);
  assert.equal(datedSections[0].from, datedSections[0].span.from);
  assert.ok(datedSections.every(({ from, to, span }) => (
    from === span.from && to === span.to
  )), 'a rendered era includes empty years before its first or after its last selected story');
});

test('only Modern Timeline era descriptions opt out of the shared prose measure', () => {
  assert.match(
    styles,
    /\.shelf-section-blurb \{[^}]*max-width: 64ch;[^}]*\}/,
  );
  assert.match(
    styles,
    /#catalog-results \.timeline-era-head \.shelf-section-blurb \{ max-width: none; \}/,
  );
  assert.match(
    styles,
    /\.timeline-era-head \{ border-color: CanvasText; border-left-color: Highlight; \}/,
  );
  assert.match(
    styles,
    /\.timeline-era-head \.shelf-section-blurb \{ color: CanvasText; \}/,
  );
});
