import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PUBLISHING_AGES,
  PUBLISHING_CATEGORIES,
  availablePublishingCategories,
  groupCatalog,
  inPublishingAge,
  parseCatalog,
  publishingCategoryStories,
  shelfKey,
  storyYear,
} from '../src/js/lib/catalog.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = parseCatalog(JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8')));
const stories = groupCatalog(catalog.lists);
const byKey = new Map(PUBLISHING_CATEGORIES.map((category) => [category.key, category]));
const topLevel = PUBLISHING_CATEGORIES.filter((category) => category.parent === null);
const modernPeriods = PUBLISHING_CATEGORIES.filter((category) => category.parent === 'modern');

const one = (year, type = 'event') => ({
  key: `${type}-${year ?? 'undated'}`,
  lists: [{ id: `${type}-${year ?? 'undated'}`, name: 'Fixture', timeline: year, type }],
});

test('the publishing registry declares every effective non-overlapping range and route', () => {
  assert.deepEqual(
    PUBLISHING_CATEGORIES.map(({ key, route, from, to, parent }) => ({
      key, route, from, to, parent,
    })),
    [
      { key: 'golden', route: 'age-golden', from: 1939, to: 1955, parent: null },
      { key: 'silver', route: 'age-silver', from: 1956, to: 1969, parent: null },
      { key: 'bronze', route: 'age-bronze', from: 1970, to: 1983, parent: null },
      { key: 'copper', route: 'age-copper', from: 1984, to: 1990, parent: null },
      { key: 'modern', route: 'age-modern', from: 1991, to: null, parent: null },
      { key: 'early-modern', route: 'age-early-modern', from: 1991, to: 1997, parent: 'modern' },
      {
        key: 'marvel-knights-heroes-return',
        route: 'age-marvel-knights-heroes-return',
        from: 1998,
        to: 2003,
        parent: 'modern',
      },
      { key: 'event-era', route: 'age-event-era', from: 2004, to: 2011, parent: 'modern' },
      { key: 'marvel-now', route: 'age-marvel-now', from: 2012, to: 2014, parent: 'modern' },
      {
        key: 'all-new-all-different',
        route: 'age-all-new-all-different',
        from: 2015,
        to: 2017,
        parent: 'modern',
      },
      { key: 'fresh-start', route: 'age-fresh-start', from: 2018, to: 2020, parent: 'modern' },
      { key: 'current', route: 'age-current', from: 2021, to: null, parent: 'modern' },
    ],
  );
  assert.deepEqual(PUBLISHING_AGES, topLevel);
  assert.equal(new Set(PUBLISHING_CATEGORIES.map(({ route }) => route)).size, PUBLISHING_CATEGORIES.length);
  for (const category of PUBLISHING_CATEGORIES) {
    assert.ok(category.heading.trim(), `${category.key} has no heading`);
    assert.ok(category.label.trim(), `${category.key} has no compact range label`);
    assert.ok(category.highlights.length, `${category.key} has no compact highlights`);
  }
});

test('every shared year belongs to the later period and never to both', () => {
  for (const [year, expected] of [
    [1956, 'silver'],
    [1970, 'bronze'],
    [1984, 'copper'],
    [1991, 'modern'],
  ]) {
    const matches = topLevel.filter(({ key }) => inPublishingAge(one(year), key));
    assert.deepEqual(matches.map(({ key }) => key), [expected], `${year} did not belong only to ${expected}`);
  }

  for (const [year, expected] of [
    [1998, 'marvel-knights-heroes-return'],
    [2004, 'event-era'],
    [2012, 'marvel-now'],
    [2015, 'all-new-all-different'],
    [2018, 'fresh-start'],
    [2021, 'current'],
  ]) {
    const matches = modernPeriods.filter(({ key }) => inPublishingAge(one(year), key));
    assert.deepEqual(matches.map(({ key }) => key), [expected], `${year} did not belong only to ${expected}`);
  }
});

test('the shipped dated catalog partitions once by age and once by Modern subperiod', () => {
  const dated = stories.filter((story) => storyYear(story) !== null);
  const modern = publishingCategoryStories(stories, 'modern');
  assert.equal(dated.length, 82);
  assert.equal(modern.length, 77);

  for (const story of dated) {
    assert.equal(
      topLevel.filter(({ key }) => inPublishingAge(story, key)).length,
      1,
      `${story.key} did not land in exactly one top-level age`,
    );
  }
  for (const story of modern) {
    assert.equal(
      modernPeriods.filter(({ key }) => inPublishingAge(story, key)).length,
      1,
      `${story.key} did not land in exactly one Modern subperiod`,
    );
  }

  const topLists = topLevel.reduce(
    (total, { key }) => total + publishingCategoryStories(stories, key)
      .reduce((sum, story) => sum + story.lists.length, 0),
    0,
  );
  const periodLists = modernPeriods.reduce(
    (total, { key }) => total + publishingCategoryStories(stories, key)
      .reduce((sum, story) => sum + story.lists.length, 0),
    0,
  );
  assert.equal(topLists, 88);
  assert.equal(periodLists, 83);
});

test('undated stories are not guessed into any publishing category', () => {
  const undated = one(null, 'character-run');
  assert.equal(storyYear(undated), null);
  assert.ok(PUBLISHING_CATEGORIES.every(({ key }) => !inPublishingAge(undated, key)));
});

test('publishing categories cross canonical shelves without changing shelf ownership', () => {
  const event = one(2018, 'event');
  const spotlight = one(2018, 'character-run');
  assert.notEqual(shelfKey(event), shelfKey(spotlight));
  assert.deepEqual(
    publishingCategoryStories([event, spotlight], 'fresh-start'),
    [event, spotlight],
  );
});

test('only populated publishing categories are available and counts use Reading Lists', () => {
  const ages = availablePublishingCategories(stories);
  assert.deepEqual(ages.map(({ key }) => key), ['silver', 'bronze', 'modern']);
  assert.deepEqual(ages.map(({ count }) => count), [1, 4, 83]);

  const periods = availablePublishingCategories(stories, 'modern');
  assert.deepEqual(
    periods.map(({ key, count }) => [key, count]),
    [
      ['early-modern', 4],
      ['marvel-knights-heroes-return', 2],
      ['event-era', 35],
      ['marvel-now', 10],
      ['all-new-all-different', 7],
      ['fresh-start', 12],
      ['current', 13],
    ],
  );
  assert.equal(byKey.has('early-modern'), true);
  assert.equal(periods.some(({ key }) => key === 'early-modern'), true);
});
