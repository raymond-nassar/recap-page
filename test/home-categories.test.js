import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  CATALOG_SHELVES,
  HOME_CATEGORIES,
  MARVEL_AGES_CATEGORY,
  PUBLISHING_CATEGORIES,
  publishingAgeGroups,
  availableHomeCategories,
  groupCatalog,
  parseCatalog,
} from '../src/js/lib/catalog.js';
import { VIEWS } from '../src/js/lib/route.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');
const markup = read('src/index.html');
const source = read('src/js/main.js');
const catalog = parseCatalog(JSON.parse(read('src/data/catalog.json')));
const stories = groupCatalog(catalog.lists);

test('the current gateway offers three primary modes and two secondary gateways', () => {
  const categories = availableHomeCategories(stories);
  assert.deepEqual(
    categories.map(({ key }) => key),
    [
      'timeline',
      'storylines',
      'character-spotlights',
      'marvel-on-screen',
      'marvel-ages',
    ],
  );
  assert.deepEqual(
    categories.map(({ tier }) => tier),
    ['primary', 'primary', 'primary', 'secondary', 'secondary'],
  );

  for (const category of categories.filter(({ shelf }) => shelf)) {
    const expected = HOME_CATEGORIES.find(({ key }) => key === category.key).select(stories)
      .reduce((total, story) => total + story.lists.length, 0);
    assert.ok(expected > 0, `${category.heading} has no content`);
    assert.equal(category.count, expected, `${category.heading} reports the wrong availability`);
  }
  assert.equal(categories.find(({ key }) => key === 'timeline').count, 71);
  assert.equal(categories.find(({ key }) => key === 'marvel-ages').count, 122);
  assert.equal(categories.find(({ key }) => key === 'marvel-on-screen').count, 6);
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
    const generated = !category.shelf
      || PUBLISHING_CATEGORIES.some(({ route }) => route === category.route);
    assert.ok(
      generated || new RegExp(`id="view-${category.route}"`).test(markup),
      `${category.key} has no browse subpage`,
    );
    assert.ok(['primary', 'secondary'].includes(category.tier), `${category.key} has no supported tier`);
    assert.match(category.icon, /^[A-F0-9]{4,6}$/, `${category.key} has no Fluent glyph`);
    for (const field of ['heading', 'label']) {
      assert.equal(typeof category[field], 'string', `${category.key} has no ${field}`);
      assert.ok(category[field].trim(), `${category.key} has an empty ${field}`);
      assert.doesNotMatch(category[field], /[.!?]$/, `${category.key} ${field} became explanatory copy`);
    }
  }
  assert.match(source, /function ensurePublishingViews\(\)/, 'publishing subpages are not generated');
});

test('publishing ages stay declared while the shared gateway owns discovery', () => {
  for (const key of ['golden', 'silver', 'bronze', 'copper']) {
    assert.ok(PUBLISHING_CATEGORIES.some((category) => category.key === key), `${key} is not declared`);
    assert.ok(!HOME_CATEGORIES.some((category) => category.key === key), `${key} remains a Home peer`);
  }
  const available = availableHomeCategories(stories);
  assert.ok(available.some(({ key }) => key === 'marvel-ages'));
  assert.ok(!available.some(({ key }) => key === 'golden'));
});

test('Marvel Ages hides when empty and shares one count derivation with its screen', () => {
  const fixture = [
    { key: 'silver-fixture', lists: [{ id: 'silver-fixture', timeline: 1961 }] },
    { key: 'modern-fixture', lists: [{ id: 'modern-fixture', timeline: 2012 }] },
    { key: 'undated-fixture', lists: [{ id: 'undated-fixture', timeline: null }] },
  ];
  const categories = availableHomeCategories(fixture, [MARVEL_AGES_CATEGORY]);
  assert.equal(categories[0].count, publishingAgeGroups(fixture).count);
  assert.equal(categories[0].count, 2);
  assert.deepEqual(availableHomeCategories([], [MARVEL_AGES_CATEGORY]), []);
});

test('MCU Prep keeps the six screen companions in inventory order on the stable route', () => {
  const category = HOME_CATEGORIES.find(({ key }) => key === 'marvel-on-screen');
  assert.ok(category, 'MCU Prep is not declared');
  assert.equal(category.heading, 'MCU Prep');
  assert.deepEqual(
    category.select(stories).map((story) => story.lists[0].id),
    [
      'doctor-strange-multiverse-of-madness',
      'spider-man-no-way-home',
      'marvel-multiverse',
      'marvel-what-if',
      'wandavision',
      'spider-man-far-from-home',
    ],
  );
  assert.equal(category.route, 'marvel-on-screen');
});

test('Home is a category gateway rather than another copy of the catalog', () => {
  const home = markup.slice(markup.indexOf('id="view-home"'), markup.indexOf('id="view-read"'));
  assert.match(home, /id="home-primary-paths"/);
  assert.match(home, /id="home-secondary-paths"/);
  assert.match(home, /id="home-more-paths"[^>]*hidden/);
  assert.match(home, /id="home-h" class="home-brand">RECAP PAGE!<\/h1>/);
  assert.match(home, /class="home-action">Browse\. Choose\. Read\.<\/p>/);
  assert.doesNotMatch(home, /id="home-featured"|id="home-grid"|id="home-chips"|id="form-home-q"/);
  assert.doesNotMatch(home, /Featured journey|A place to start|Filter Reading Lists/);
  assert.doesNotMatch(source, /How do you want to read\?/);
});

test('empty Home creates one labelled first-run region without changing Browse', () => {
  const start = source.indexOf('function ensureHomeFirstRun');
  const body = source.slice(start, source.indexOf('async function renderHomeCategories', start));
  assert.notEqual(start, -1, 'the first-run region builder is missing');
  assert.match(body, /id: 'home-first-run'[\s\S]*'aria-labelledby': 'home-first-run-h'/);
  assert.match(body, /el\('h2', \{ id: 'home-first-run-h', text: 'Where do you want to start\?'/);
  assert.match(body, /Browse curated Reading Lists\. Add individual issues or your own list\./);
  assert.match(body, /\$\('#home-categories'\)\.prepend\(section\)/);
  assert.doesNotMatch(markup.slice(markup.indexOf('id="view-browse"')), /home-first-run/);
});

test('first-run guidance follows the same local populated state as Home', () => {
  const start = source.indexOf('function renderHome()');
  const body = source.slice(start, source.indexOf('function ensurePublishingViews', start));
  assert.match(body, /const populated = store\.state\.listOrder\.length > 0;/);
  assert.match(body, /const firstRun = ensureHomeFirstRun\(\);/);
  assert.match(body, /firstRun\.hidden = populated;/);
});

test('the recommended start resolves after catalog load and only opens Preview', () => {
  const start = source.indexOf("const recommendation = $('#home-recommended')");
  const body = source.slice(start, source.indexOf('if (homeCatalog.dropped)', start));
  assert.notEqual(start, -1, 'the recommended-start catalog resolution is missing');
  assert.match(body, /modernTimelineFeaturedList\(homeCatalog\.lists\)/);
  assert.match(body, /\$\('#btn-home-recommended'\)\.onclick = \(\) => openPreview\(list\)/);
  assert.doesNotMatch(body, /importCurated|setActive|showView|location\.hash|localStorage/);
});

test('Home and Browse use concise action headings for both discovery tiers', () => {
  assert.match(markup, /id="home-cat-h"[^>]*>Explore<\/h2>/);
  assert.match(markup, /id="home-more-h">Discover More<\/h3>/);
  assert.match(markup, /id="browse-cat-h"[^>]*>Explore<\/h2>/);
  assert.match(markup, /id="browse-more-h">Discover More<\/h3>/);
  assert.doesNotMatch(markup, />Ways to read<|>More ways to read</);
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

test('asynchronous category results expose concise polite status updates', () => {
  const gatewayStatuses = [...markup.matchAll(/<p[^>]*data-paths-status[^>]*>/g)];
  assert.equal(gatewayStatuses.length, 2, 'Home and Browse must each expose a loading status');
  assert.ok(
    gatewayStatuses.every(([status]) => /role="status"/.test(status)),
    'Home and Browse loading results are not polite live statuses',
  );
  assert.match(
    source,
    /\$\{categories\.length\} ways to read available/,
    'loaded gateway results do not leave a concise screen-reader status',
  );
  assert.match(source, /status\.classList\.toggle\('visually-hidden', categories\.length > 0\)/);
  assert.match(
    source,
    /class:\s*'publishing-count'[\s\S]*role:\s*'status'[\s\S]*text:\s*'Loading Reading Lists'/,
    'publishing pages do not expose one polite loading and result status',
  );
  assert.match(source, /class:\s*'rail-hint'[\s\S]*'aria-hidden':\s*'true'[\s\S]*Loading Reading Lists/);
});

test('rendered categories navigate explicitly instead of relying on boot-time bindings', () => {
  const start = source.indexOf('function homeCategoryTile');
  assert.notEqual(start, -1, 'the category tile renderer is missing');
  const body = source.slice(start, source.indexOf('\n}', start));
  assert.match(body, /showView\(category\.route,\s*\{\s*push:\s*true\s*\}\)/);
});

test('Preview Open closes its modal before navigating to an existing Reading List', () => {
  const start = source.indexOf('function addButton');
  assert.notEqual(start, -1, 'the catalog action renderer is missing');
  const body = source.slice(start, source.indexOf('async function addFromCatalog', start));
  assert.match(
    body,
    /if \(\$\('#preview'\)\.open\) \$\('#preview'\)\.close\(\);\s*showView\('read',\s*\{\s*push:\s*true\s*\}\)/,
    'Preview remains open over the Reading List it navigates to',
  );
});

test('successful additions point people to Library rather than the fixed rail', () => {
  assert.match(source, /It is now in your Library\./);
  assert.doesNotMatch(source, /It is now in your sidebar\./);
});

test('every cover the app builds remains lazy after Home stops drawing catalog cards', () => {
  const images = [...source.matchAll(/el\('img',\s*\{([^}]*)\}/g)].map((match) => match[1]);
  assert.ok(images.length >= 4, `expected the app to build at least four images, saw ${images.length}`);
  const eager = images.filter((attributes) => !/loading:\s*'lazy'/.test(attributes));
  assert.deepEqual(eager, [], `these images are fetched before they are wanted: ${eager.join(' | ')}`);
});
