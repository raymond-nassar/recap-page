import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MODERN_TIMELINE_FEATURED_ID,
  MODERN_TIMELINE_START_YEAR,
  groupCatalog,
  modernTimelineFeaturedList,
  modernTimelineLists,
  modernTimelineStories,
  parseCatalog,
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

test('the app-selected Modern Timeline boundary includes 1998 and excludes 1997', () => {
  const selected = modernTimelineStories([
    story('older', list('older', 1997)),
    story('boundary', list('boundary', 1998)),
    story('later', list('later', 2024)),
    story('undated', list('undated', null)),
    story('wrong-kind', list('wrong-kind', 2004, { type: 'creator-run' })),
    story('split', list('split-old', 1997), list('split-new', 1998)),
  ]);

  assert.equal(MODERN_TIMELINE_START_YEAR, 1998);
  assert.deepEqual(selected.map(({ key }) => key), ['boundary', 'later']);
});

test('list selection preserves order and never splits a grouped story', () => {
  const lists = [
    list('older', 1997),
    list('boundary', 1998),
    list('split-old', 1997, { group: 'split' }),
    list('split-new', 1998, { group: 'split' }),
    list('later', 2024),
  ];

  assert.deepEqual(
    modernTimelineLists(lists).map(({ id }) => id),
    ['boundary', 'later'],
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

test('the shipped Modern Timeline starts with Marvel Knights and keeps only 1998-plus events', () => {
  const selectedLists = modernTimelineLists(catalog.lists);
  const selectedStories = modernTimelineStories(stories);
  const olderEvents = shelfLists(catalog.lists, 'catalog')
    .filter(({ timeline }) => timeline < MODERN_TIMELINE_START_YEAR);

  assert.equal(selectedLists.length, 76);
  assert.equal(selectedStories.length, 72);
  assert.equal(olderEvents.length, 34);
  assert.equal(selectedLists[0].id, 'marvel-knights-to-planet-x');
  assert.ok(selectedLists.every(({ type, timeline }) => (
    type === 'event' && timeline >= MODERN_TIMELINE_START_YEAR
  )));
  assert.ok(selectedLists.some(({ id }) => id === 'avengers-disassembled'));
  assert.equal(selectedLists.some(({ id }) => id === 'operation-zero-tolerance'), false);
  assert.equal(selectedLists.some(({ id }) => id === MODERN_TIMELINE_FEATURED_ID), false);
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
