import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PUBLISHING_AGES,
  PUBLISHING_CATEGORIES,
  HOME_CATEGORIES,
  availablePublishingCategories,
  groupCatalog,
  inPublishingAge,
  isPublishingCategoryLeaf,
  parseCatalog,
  publishingAgeGroups,
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
  assert.equal(dated.length, 192);
  assert.equal(modern.length, 170);

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
  assert.equal(topLists, 198);
  assert.equal(periodLists, 176);
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
  assert.deepEqual(ages.map(({ key }) => key), ['silver', 'bronze', 'copper', 'modern']);
  assert.deepEqual(ages.map(({ count }) => count), [2, 9, 11, 176]);

  const periods = availablePublishingCategories(stories, 'modern');
  assert.deepEqual(
    periods.map(({ key, count }) => [key, count]),
    [
      ['early-modern', 13],
      ['marvel-knights-heroes-return', 81],
      ['event-era', 39],
      ['marvel-now', 10],
      ['all-new-all-different', 7],
      ['fresh-start', 13],
      ['current', 13],
    ],
  );
  assert.equal(byKey.has('early-modern'), true);
  assert.equal(periods.some(({ key }) => key === 'early-modern'), true);
});

test('the Marvel Ages gateway groups populated leaves without double-counting Modern', () => {
  const groups = publishingAgeGroups(stories);
  assert.equal(groups.count, 198);
  assert.equal(groups.stories.reduce(
    (total, story) => total + story.lists.length,
    0,
  ), groups.count);
  assert.deepEqual(
    groups.earlier.map(({ key, count }) => [key, count]),
    [['silver', 2], ['bronze', 9], ['copper', 11]],
  );
  assert.deepEqual(
    [groups.modern?.key, groups.modern?.count],
    ['modern', 176],
  );
  assert.deepEqual(
    groups.modernChildren.map(({ key, count }) => [key, count]),
    [
      ['early-modern', 13],
      ['marvel-knights-heroes-return', 81],
      ['event-era', 39],
      ['marvel-now', 10],
      ['all-new-all-different', 7],
      ['fresh-start', 13],
      ['current', 13],
    ],
  );
  assert.ok(!groups.earlier.some(({ key }) => key === 'golden'));
});

test('the Marvel Ages gateway handles empty and sparse catalogs from the same derivation', () => {
  assert.deepEqual(publishingAgeGroups([]), {
    stories: [],
    count: 0,
    earlier: [],
    modern: null,
    modernChildren: [],
  });

  const sparse = [one(1961), one(2012), one(null)];
  const groups = publishingAgeGroups(sparse);
  assert.equal(groups.count, 2);
  assert.deepEqual(groups.earlier.map(({ key, count }) => [key, count]), [['silver', 1]]);
  assert.deepEqual([groups.modern?.key, groups.modern?.count], ['modern', 1]);
  assert.deepEqual(
    groups.modernChildren.map(({ key, count }) => [key, count]),
    [['marvel-now', 1]],
  );
  assert.deepEqual(groups.stories, sparse.slice(0, 2));
});

test('publication leaf eligibility comes from registry structure rather than current content', () => {
  const mcuPrep = HOME_CATEGORIES.find(({ key }) => key === 'marvel-on-screen');
  for (const [category, expected] of [
    [byKey.get('modern'), false],
    [byKey.get('event-era'), true],
    [byKey.get('golden'), true],
    [mcuPrep, false],
  ]) {
    assert.equal(isPublishingCategoryLeaf(category), expected, category?.key);
  }
});
