import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import * as catalog from '../src/js/lib/catalog.js';
import { createEmptyState } from '../src/js/lib/model.js';
import { createCatalogView, modernTimelinePosition } from '../src/js/views/catalog.js';
import { createCatalogPresentation } from '../src/js/views/shared/catalog-presentation.js';
import { createPreviewView } from '../src/js/views/preview.js';

const data = (file) => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8'));
const titles = new Map([
  ['hickman-minimal', 'Secret Wars Fast Track Trade Reading Order'],
  ['hickman-full', 'Complete Hickman Saga to Secret Wars'],
  ['new-ultimate-universe', 'New Ultimate Universe: Single-Issue Reading Order'],
  ['new-ultimate-universe-trades', 'New Ultimate Universe: Collected Edition Reading Order'],
  ['house-of-m', 'House of M: Main Series and Branded Tie-Ins'],
  ['house-of-m-essential', 'House of M: Main Series Only'],
  ['civil-war', 'Civil War: Main Series and Branded Tie-Ins'],
  ['civil-war-essential', 'Civil War: Main Series Only'],
  ['civil-war-avengers', 'Civil War: Avengers and Aftermath Reading Order'],
  ['secret-invasion', 'Secret Invasion: Main Series and Branded Tie-Ins'],
  ['secret-invasion-essential', 'Secret Invasion: Main Series Only'],
  ['xmen-claremont', 'X-Men Core Reading Order: Silver Age to Claremont'],
  ['xmen-claremont-complete', 'X-Men Expanded Reading Order: Silver Age to Claremont'],
  ['avengers-doomsday-secret-wars', 'Avengers: Doomsday & Avengers: Secret Wars'],
]);
const sections = [
  ['Original Secret Wars #1-12', [10580, 10584, 10585, 10586, 10587, 10588, 10589, 10590, 10591, 10581, 10582, 10583]],
  ['New Avengers Volume 1: Everything Dies (selected issues #1-3)', [43512, 43516, 43517]],
  ['Avengers: Time Runs Out Volume 1', [48389, 50096, 48390, 50973, 48391]],
  ['Avengers: Time Runs Out Volume 2', [52257, 48392, 52259, 48393, 51172]],
  ['Ultimate Enemy, Ultimate Mystery and Ultimate Doom', [30206, 30207, 30208, 30209, 30210, 30211, 30212, 30213, 30214, 30215, 30216, 30217]],
  ['Ultimate Comics Ultimates Volume 1', [38693, 38690, 38687, 38689, 38691, 38695]],
  ['Ultimate Comics Ultimates Volume 2', [38686, 38685, 38696, 38688, 38692, 38694]],
  ['Avengers: Time Runs Out Volume 3', [48394, 52261, 48395, 52263, 48396]],
  ['Avengers: Time Runs Out Volume 4', [52265, 52266, 48397, 52267, 48398]],
  ['Secret Wars (2015) #0-9', [52986, 52447, 52450, 52451, 52452, 52453, 52454, 52455, 52456, 57620]],
];

function node(props = {}, children = []) {
  return {
    children: [].concat(children),
    dataset: {},
    hidden: false,
    listeners: {},
    value: '',
    addEventListener(name, listener) { this.listeners[name] = listener; },
    append(...next) { this.children.push(...next); },
    querySelectorAll() { return []; },
    replaceChildren(...next) { this.children = next; },
    showModal() { this.open = true; },
    ...props,
  };
}

const el = (tag, props = {}, children = []) => node({ tag, ...props }, children);
const entry = (id, extra = {}) => ({
  id, file: `${id}.json`, name: id, description: `${id} description.`,
  type: 'creator-run', depth: 'essential', timeline: 2012, count: 3,
  characters: [], keywords: [], ...extra,
});
const fast = entry('fast', { group: 'shared', groupName: 'Shared story', name: titles.get('hickman-minimal') });
const full = entry('full', {
  group: 'shared', groupName: 'Shared story', depth: 'complete', name: titles.get('hickman-full'),
});

function viewFixture(lists, { state = createEmptyState(), paths = [] } = {}) {
  const nodes = {
    clear: node(), filters: node(), query: node(), results: node(), search: node(),
  };
  const cards = [];
  const positions = [];
  const paintCard = (story, placement) => {
    cards.push({ story, placement });
    return node();
  };
  const view = createCatalogView({
    announce: () => {},
    clearLoadNotice: () => {},
    el,
    elements: {
      shelf: () => nodes,
      spotlightKinds: () => [],
      spotlightSorts: () => [],
    },
    getState: () => state,
    loadCatalog: async () => ({ lists, paths, dropped: 0 }),
    notifyDropped: () => {},
    onLoadFailure: ({ error }) => { throw error; },
    onSortChange: () => {},
    presentation: {
      catalogCard: paintCard,
      chosenPath: (story) => story.lists[0],
      ensureSetupGuideFeature: () => {},
      paintTimelinePosition: (_root, position, options) => positions.push({ position, options }),
      renderTimelineSections: (_root, groups, placements) => {
        for (const section of groups) {
          for (const story of section.stories) paintCard(story, placements.get(story.groupKey ?? story.key));
        }
      },
      shelfSectionHead: () => node(),
    },
  });
  return { view, nodes, cards, positions };
}

test('facets count visible list choices without losing logical story equivalence', () => {
  assert.equal(catalog.countStories([fast, full]), 1);
  const facets = catalog.catalogFacets([fast, full]);
  assert.equal(facets.find(({ key }) => key === 'all').count, 2);
  assert.equal(facets.find(({ key }) => key === 'type:creator-run').count, 2);
});

test('independent spotlight choices retain their shared subject rank and stable order', () => {
  const choices = catalog.catalogEntries([
    entry('other', { name: 'Other Spotlight' }),
    entry('xmen-claremont', {
      group: 'claremont', groupName: 'X-Men', name: titles.get('xmen-claremont'),
    }),
    entry('xmen-claremont-complete', {
      group: 'claremont', groupName: 'X-Men', name: titles.get('xmen-claremont-complete'),
    }),
  ]);
  assert.deepEqual(choices.slice(1).map(catalog.spotlightRankForStory), [22, 22]);
  assert.deepEqual(
    catalog.sortSpotlightStories(choices, 'popularity').map(({ lists }) => lists[0].id),
    ['xmen-claremont', 'xmen-claremont-complete', 'other'],
  );
});

test('Storylines renders both choices independently with the same logical path placement', async () => {
  const after = entry('after', { timeline: 2015 });
  const fixture = viewFixture([fast, full, after], {
    paths: [{ id: 'route', name: 'Route', steps: ['fast', 'after'] }],
  });
  await fixture.view.render('lines');
  assert.equal(fixture.cards.length, 3);
  assert.deepEqual(fixture.cards.map(({ story }) => story.key), ['list:fast', 'list:full', 'list:after']);
  assert.ok(fixture.cards.every(({ story }) => story.lists.length === 1));
  assert.deepEqual(fixture.cards.slice(0, 2).map(({ placement }) => [placement.position, placement.total]), [[1, 2], [1, 2]]);
  const orientation = fixture.nodes.results.children.find(({ class: name }) => name === 'rail-hint shelf-orientation');
  assert.equal(orientation.text, `Start Route with ${fast.name} or ${full.name}.`);
});

test('search threshold counts individually visible cards rather than collapsed groups', async () => {
  const fixture = viewFixture(Array.from({ length: 13 }, (_, index) => (
    entry(`choice-${index}`, { group: 'many', groupName: 'Many choices' })
  )));
  await fixture.view.render('lines');
  assert.equal(fixture.nodes.search.hidden, false);
  assert.equal(fixture.cards.length, 13);
});

test('a current timeline position names the owned choice without making its sibling another stop', () => {
  const state = {
    ...createEmptyState(),
    lists: { saved: { id: 'saved', catalogId: 'full', name: 'My saved saga', itemIds: [1, 2] } },
    listOrder: ['saved'],
    read: { 1: 1 },
  };
  const before = JSON.stringify(state);
  const stories = catalog.groupCatalog([fast, full, entry('after')]);
  assert.deepEqual(modernTimelinePosition(state, stories), {
    kind: 'current', storyKey: 'list:full', storyName: full.name, completed: 0, total: 2,
  });
  assert.equal(JSON.stringify(state), before);
  state.read[2] = 1;
  assert.equal(modernTimelinePosition(state, stories).storyKey, 'list:after');
  assert.equal(modernTimelinePosition(state, stories).completed, 1);
});

test('a filtered sibling cannot take the current owned choice marker', async () => {
  const state = {
    ...createEmptyState(),
    lists: { saved: { id: 'saved', catalogId: 'full', name: 'My saved saga', itemIds: [1, 2] } },
    listOrder: ['saved'],
    read: { 1: 1 },
  };
  const lists = [fast, full, ...Array.from({ length: 12 }, (_, index) => entry(`extra-${index}`))]
    .map((list) => ({ ...list, type: 'event' }));
  const fixture = viewFixture(lists, { state });
  fixture.view.wire('catalog');
  await fixture.view.render('catalog');
  fixture.nodes.query.value = 'Fast Track';
  fixture.nodes.query.listeners.input();
  await new Promise((resolve) => setImmediate(resolve));
  const { position, options } = fixture.positions.at(-1);
  assert.equal(position.storyKey, 'list:full');
  assert.deepEqual([...options.visibleStoryKeys], ['list:fast']);
  assert.equal(options.visibleStoryKeys.has(position.storyKey), false);
  assert.match(options.message, /Complete Hickman Saga to Secret Wars.*hidden/);
});

test('each card binds Add or Open and Preview to its own exact list', () => {
  const added = [];
  const opened = [];
  const previewed = [];
  const presentation = createCatalogPresentation({
    el, hueOf: () => 0, paintCoverUrl: () => {}, shortTitle: (name) => name,
    isInLibrary: (id) => id === 'full' ? { id: 'saved-full' } : null,
    onAdd: (list) => added.push(list.id),
    onOpen: (list) => opened.push(list.id),
    onPreview: (list) => previewed.push(list.id),
  });
  const descendants = (root) => typeof root === 'object' && root !== null
    ? [root, ...root.children.flatMap(descendants)] : [];
  for (const list of [fast, full]) {
    const card = presentation.catalogCard({ key: `list:${list.id}`, groupKey: 'shared', lists: [list] }, null);
    const buttons = descendants(card).filter(({ tag }) => tag === 'button');
    assert.equal(buttons[0].dataset.key, list.id);
    assert.equal(buttons[1].children[0], 'Preview');
    assert.equal(buttons[1]['aria-label'], `Preview: ${list.name}`);
    buttons[0].onclick({ currentTarget: buttons[0] });
    buttons[1].onclick();
  }
  assert.deepEqual(added, ['fast']);
  assert.deepEqual(opened, ['full']);
  assert.deepEqual(previewed, ['fast', 'full']);
});

test('Preview inspects one named list even when supplied a logical sibling group', async () => {
  const nodes = Object.fromEntries(
    ['add', 'body', 'close', 'description', 'dialog', 'heading', 'meta', 'paths', 'source'].map((key) => [key, node()]),
  );
  const loaded = [];
  const state = createEmptyState();
  const view = createPreviewView({
    captureFocus: () => null, el, elements: () => nodes, isInLibrary: () => null,
    getState: () => state,
    issueFocusAnchor: () => node(),
    loadOrder: async (file) => { loaded.push(file); return { items: [{ issueId: 1, title: 'One' }] }; },
    onAdd: async () => null, onClose: async () => {},
    onIssueLoadFailure: ({ error }) => { throw error; },
    onOpen: () => {}, restoreFocus: () => {},
    presentation: {
      attributionLine: () => null,
      markOwnedPaths: () => {},
      pathChooser: () => node(),
    },
  });
  await view.open(full, { key: 'shared', name: 'Shared story', lists: [fast, full] });
  assert.equal(nodes.heading.textContent, full.name);
  assert.equal(nodes.paths.children.length, 0);
  assert.equal(nodes.paths.hidden, true);
  assert.deepEqual(loaded, ['full.json']);
});

test('Reading Paths names its authored choice while retaining equivalent saved-list relationships', () => {
  const [path] = catalog.resolveReadingPaths([{
    id: 'route', name: 'Route', description: 'A route.', sourceOrigin: 'Compiled for this test.',
    steps: ['full', 'after'],
  }], [fast, full, entry('after')]);
  assert.equal(path.stops[0].name, full.name);
  assert.equal(path.stops[0].stepId, 'full');
  assert.deepEqual(path.stops[0].lists.map(({ id }) => id), ['fast', 'full']);
  assert.equal(path.stops.length, 2);
});

test('all existing choices and the MCU counterpart have their distinctive import titles', () => {
  const manifest = data('curated-lists.json');
  const published = data('catalog.json');
  for (const [id, title] of titles) {
    const spec = manifest.lists.find((list) => list.id === id);
    const list = published.lists.find((list) => list.id === id);
    assert.ok(spec && list, `Missing named list ${id}`);
    assert.equal(spec.name, title, id);
    assert.equal(list.name, title, id);
    assert.equal(data(list.file).name, title, id);
  }
  assert.equal(new Set(titles.values()).size, titles.size);
});

test('the fast track keeps the exact 69 originals in the ten requested trade sections', () => {
  const order = data('hickman_minimal.json');
  const expected = sections.flatMap(([collectedIn, ids]) => ids.map((issueId) => ({ issueId, collectedIn })));
  assert.equal(order.count, 69);
  assert.equal(order.collections, 10);
  assert.equal(order.placeholders, 0);
  assert.deepEqual(order.unresolved, []);
  assert.deepEqual(order.items.map(({ issueId, collectedIn }) => ({ issueId, collectedIn })), expected);
  assert.equal(new Set(order.items.map(({ issueId }) => issueId)).size, 69);
  const zero = order.items.find(({ issueId }) => issueId === 52986);
  assert.equal(zero.seriesId, 19821);
  assert.equal(zero.number, '0');
  assert.equal(order.items.at(-1).number, '9');
  assert.ok(order.items.every(({ issueId, placeholder, description }) => issueId > 0 && !placeholder && description === null));
});

test('the MCU Prep list is independently named but has identical source contents', () => {
  const published = data('catalog.json');
  const film = published.lists.find(({ id }) => id === 'avengers-doomsday-secret-wars');
  assert.ok(film, 'MCU Prep counterpart must be published');
  assert.equal(film.type, 'screen-companion');
  assert.equal(film.timeline, null);
  assert.equal(film.name, titles.get(film.id));
  const movie = data(film.file);
  const fastTrack = data('hickman_minimal.json');
  assert.notEqual(movie.id, fastTrack.id);
  assert.deepEqual(movie.items, fastTrack.items);
  assert.equal(movie.collections, fastTrack.collections);
  assert.equal(movie.source, fastTrack.source);
});

test('renaming the complete saga preserves its entire original issue vector', () => {
  const fullSaga = data('hickman_full.json');
  assert.equal(fullSaga.count, 219);
  assert.equal(
    createHash('sha256').update(fullSaga.items.map(({ issueId }) => issueId).join(',')).digest('hex'),
    '61c4ea7f8a36b7ed898e47a7c7f5fd923e2d49548c7e9d75bf7a9d08e35d709a',
  );
});
