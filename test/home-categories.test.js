import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CATALOG_SHELVES,
  HOME_CATEGORIES,
  availableHomeCategories,
  groupCatalog,
  parseCatalog,
  shelfStories,
} from '../src/js/lib/catalog.js';
import { VIEWS } from '../src/js/lib/route.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const markup = read('src/index.html');
const source = read('src/js/main.js');
const catalog = parseCatalog(JSON.parse(read('src/data/catalog.json')));
const stories = groupCatalog(catalog.lists);

test('the current gateway offers every populated canonical shelf', () => {
  const categories = availableHomeCategories(stories);
  assert.deepEqual(
    categories.map(({ key }) => key),
    ['timeline', 'storylines', 'character-spotlights'],
  );
  assert.ok(categories.every(({ tier }) => tier === 'primary'));

  for (const category of categories) {
    const expected = shelfStories(stories, category.shelf)
      .reduce((total, story) => total + story.lists.length, 0);
    assert.ok(expected > 0, `${category.heading} has no content`);
    assert.equal(category.count, expected, `${category.heading} reports the wrong availability`);
  }
});

test('an empty category stays hidden while overlapping categories remain independent', () => {
  const one = stories[0];
  const definitions = [
    {
      key: 'first',
      route: 'catalog',
      heading: 'First',
      label: 'Browse first',
      icon: 'E736',
      tier: 'primary',
      select: () => [one],
    },
    {
      key: 'overlap',
      route: 'lines',
      heading: 'Overlap',
      label: 'Browse overlap',
      icon: 'E8FD',
      tier: 'secondary',
      select: () => [one],
    },
    {
      key: 'empty',
      route: 'spotlights',
      heading: 'Empty',
      label: 'Browse empty',
      icon: 'E77B',
      tier: 'secondary',
      select: () => [],
    },
  ];

  const categories = availableHomeCategories(stories, definitions);
  assert.deepEqual(categories.map(({ key }) => key), ['first', 'overlap']);
  assert.deepEqual(categories.map(({ count }) => count), [1, 1]);
});

test('every declared category has compact UI metadata and its own browse subpage', () => {
  assert.ok(HOME_CATEGORIES.length >= CATALOG_SHELVES.length);
  assert.equal(new Set(HOME_CATEGORIES.map(({ key }) => key)).size, HOME_CATEGORIES.length);
  assert.equal(
    new Set(HOME_CATEGORIES.map(({ route }) => route)).size,
    HOME_CATEGORIES.length,
    'Home categories cannot share a generic destination',
  );

  for (const category of HOME_CATEGORIES) {
    assert.ok(VIEWS.includes(category.route), `${category.key} points to unknown route ${category.route}`);
    assert.match(markup, new RegExp(`id="view-${category.route}"`), `${category.key} has no browse subpage`);
    assert.ok(['primary', 'secondary'].includes(category.tier), `${category.key} has no supported tier`);
    assert.match(category.icon, /^[A-F0-9]{4,6}$/, `${category.key} has no Fluent glyph`);
    for (const field of ['heading', 'label']) {
      assert.equal(typeof category[field], 'string', `${category.key} has no ${field}`);
      assert.ok(category[field].trim(), `${category.key} has an empty ${field}`);
      assert.doesNotMatch(category[field], /[.!?]$/, `${category.key} ${field} became explanatory copy`);
    }
  }
});

test('Home is a category gateway rather than another copy of the catalog', () => {
  const home = markup.slice(markup.indexOf('id="view-home"'), markup.indexOf('id="view-read"'));
  assert.match(home, /id="home-primary-paths"/);
  assert.match(home, /id="home-secondary-paths"/);
  assert.match(home, /id="home-more-paths"[^>]*hidden/);
  assert.doesNotMatch(home, /id="home-featured"|id="home-grid"|id="home-chips"|id="form-home-q"/);
  assert.doesNotMatch(home, /Featured journey|A place to start|Filter Reading Lists/);
  assert.match(source, /populated \? 'Continue reading' : 'How do you want to read\?'/);
});

test('Home and Browse use the same category renderer', () => {
  assert.equal(
    [...markup.matchAll(/data-category-gateway/g)].length,
    2,
    'Home and Browse must each expose one category gateway',
  );
  assert.match(markup, /id="view-browse"[\s\S]*?data-category-gateway/);
  assert.match(
    source,
    /function renderHomeCategories\(\)[\s\S]*querySelectorAll\('\[data-category-gateway\]'\)/,
    'the renderer no longer discovers both category gateways',
  );
  assert.doesNotMatch(source, /function renderBrowseCategories/);
});

test('rendered categories navigate explicitly instead of relying on boot-time bindings', () => {
  const start = source.indexOf('function homeCategoryTile');
  assert.notEqual(start, -1, 'the category tile renderer is missing');
  const body = source.slice(start, source.indexOf('\n}', start));
  assert.match(body, /showView\(category\.route,\s*\{\s*push:\s*true\s*\}\)/);
});

test('every cover the app builds remains lazy after Home stops drawing catalog cards', () => {
  const images = [...source.matchAll(/el\('img',\s*\{([^}]*)\}/g)].map((match) => match[1]);
  assert.ok(images.length >= 4, `expected the app to build at least four images, saw ${images.length}`);
  const eager = images.filter((attributes) => !/loading:\s*'lazy'/.test(attributes));
  assert.deepEqual(eager, [], `these images are fetched before they are wanted: ${eager.join(' | ')}`);
});
