import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MODERN_TIMELINE_FEATURED_ID,
  MODERN_TIMELINE_CONTINUATION_YEAR,
  MODERN_TIMELINE_OPENING_ID,
  MODERN_TIMELINE_START_YEAR,
  eraSections,
  groupCatalog,
  modernTimelineFeaturedList,
  modernTimelineLists,
  modernTimelineStories,
  parseCatalog,
  publishingCategoryStories,
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
    story('opening', list(MODERN_TIMELINE_OPENING_ID, 1998)),
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
    list(MODERN_TIMELINE_OPENING_ID, 1998),
    list('other-1998', 1998),
    list('split-old', 1997, { group: 'split' }),
    list('split-new', 1998, { group: 'split' }),
    list('continuation', 2004),
  ];

  assert.deepEqual(
    modernTimelineLists(lists).map(({ id }) => id),
    [MODERN_TIMELINE_OPENING_ID, 'continuation'],
  );
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

test('the shipped Modern Timeline runs from Marvel Knights directly to Avengers Disassembled', () => {
  const selectedLists = modernTimelineLists(catalog.lists);
  const selectedStories = modernTimelineStories(stories);
  const sections = eraSections(selectedStories);
  const datedSections = sections.filter(({ span }) => span);
  const excluded = shelfLists(catalog.lists, 'catalog')
    .filter(({ id, timeline }) => (
      timeline >= MODERN_TIMELINE_START_YEAR
      && timeline < MODERN_TIMELINE_CONTINUATION_YEAR
      && id !== MODERN_TIMELINE_OPENING_ID
    ));
  const periodIds = new Set(
    publishingCategoryStories(stories, 'marvel-knights-heroes-return')
      .flatMap(({ lists }) => lists.map(({ id }) => id)),
  );
  const olderEvents = shelfLists(catalog.lists, 'catalog')
    .filter(({ timeline }) => timeline < MODERN_TIMELINE_START_YEAR);

  assert.equal(selectedLists.length, 71);
  assert.equal(selectedStories.length, 67);
  assert.equal(olderEvents.length, 34);
  assert.deepEqual(
    selectedStories.slice(0, 2).map(({ lists: [first] }) => [first.name, first.timeline]),
    [['Marvel Knights to Planet X', 1998], ['Avengers Disassembled', 2004]],
  );
  assert.ok(selectedLists.every(({ type, timeline }) => (
    type === 'event'
    && (timeline >= MODERN_TIMELINE_CONTINUATION_YEAR || timeline === MODERN_TIMELINE_START_YEAR)
  )));
  assert.ok(selectedLists.slice(1).every(({ timeline }) => timeline >= MODERN_TIMELINE_CONTINUATION_YEAR));
  assert.ok(selectedLists.some(({ id }) => id === 'avengers-disassembled'));
  assert.equal(selectedLists.some(({ id }) => id === 'operation-zero-tolerance'), false);
  assert.equal(selectedLists.some(({ id }) => id === MODERN_TIMELINE_FEATURED_ID), false);
  assert.deepEqual(
    excluded.map(({ id }) => id),
    ['spider-man-identity-crisis', 'hunt-for-xavier', 'eighth-day', 'magneto-war', 'maximum-security'],
  );
  assert.ok(excluded.every(({ id }) => periodIds.has(id)));
  assert.equal(datedSections[0].from, MODERN_TIMELINE_START_YEAR);
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
