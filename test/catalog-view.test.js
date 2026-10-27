import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { catalogEntries, publishingCategoryStories } from '../src/js/lib/catalog.js';

import * as catalogView from '../src/js/views/catalog.js';

const { createCatalogView, followedPathPosition, followedPathStories } = catalogView;

async function navigationFixture({ entries = [], getNext } = {}) {
  const moduleUrl = new URL('../src/js/views/shared/collection-navigation.js', import.meta.url);
  assert.ok(existsSync(moduleUrl), 'UX10 shared native collection-navigation contract exists');
  const { createCollectionNavigation } = await import(moduleUrl.href);
  const focused = [];
  const targets = new Map(entries.map(({ id }) => [id, {
    isConnected: true,
    focus: () => focused.push(id),
    scrollIntoView(options) { this.scroll = options; },
  }]));
  let current = true;
  let invalidateOnLookup = false;
  const el = (tag, props = {}, children = []) => {
    const result = {
      tagName: tag.toUpperCase(), ...props, children: [].concat(children),
      textContent: props.text ?? '',
      append(...next) { this.children.push(...next); },
      addEventListener(name, listener) { this[`on${name}`] = listener; },
    };
    let value = props.value ?? '';
    Object.defineProperty(result, 'value', {
      get: () => value,
      set: (next) => { value = tag === 'select' && !result.children.some((option) => option.value === next) ? '' : next; },
    });
    return result;
  };
  const form = createCollectionNavigation({
    el, id: 'unit-jump', label: 'Jump to Reading List', entries,
    isCurrent: () => current,
    getTarget: (id) => { if (invalidateOnLookup) current = false; return targets.get(id); },
    ...(getNext ? { getNext } : {}),
  });
  const select = form.children.find((child) => child.tagName === 'SELECT');
  const status = form.children.find((child) => child.role === 'status');
  const button = form.children.find((child) => child.tagName === 'BUTTON');
  let prevented = 0;
  return {
    form, select, status, button, focused, targets, el,
    prevented: () => prevented, setCurrent: (next) => { current = next; },
    invalidateOnLookup: () => { invalidateOnLookup = true; },
    submit: (value) => {
      select.value = value;
      form.onsubmit({ preventDefault: () => { prevented += 1; } });
    },
  };
}

test('UX10 U06: shared native navigation preserves 81-card order and independent variant and reserved identities', async () => {
  const catalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
  const stories = catalogEntries(catalog.lists);
  const entries = publishingCategoryStories(stories, 'marvel-knights-heroes-return')
    .flatMap((story) => story.lists.map((list) => ({ id: `list:${list.id}`, name: list.name })));
  const h = await navigationFixture({ entries });
  assert.equal(entries.length, 81);
  assert.deepEqual(h.select.children.filter((option) => option.value).map((option) => option.value),
    entries.map(({ id }) => `entry:${id}`));
  assert.equal(h.select.children.some((option) => option.value === 'next-unfinished'), false);
  const variants = ['list:civil-war', 'list:civil-war-essential', 'list:civil-war-avengers', 'next-unfinished'];
  const v = await navigationFixture({ entries: variants.map((id) => ({ id, name: id })) });
  for (const id of variants) {
    v.submit(`entry:${id}`);
    assert.equal(v.focused.at(-1), id);
  }
  v.select.append(v.el('option', { value: 'next-unfinished', text: 'Unexpected next' }));
  const before = v.focused.length;
  v.submit('next-unfinished');
  assert.match(v.status.textContent, /no longer available/);
  assert.equal(v.focused.length, before);
});

test('UX10 U07: selection is inert and explicit native submit focuses exact target only while current', async () => {
  const h = await navigationFixture({ entries: [{ id: 'first', name: 'First' }, { id: 'last', name: 'Last' }] });
  h.select.value = 'entry:last';
  assert.deepEqual(h.focused, []);
  h.submit('entry:last');
  assert.equal(h.prevented(), 1);
  assert.deepEqual(h.focused, ['last']);
  assert.deepEqual(h.targets.get('last').scroll, { block: 'nearest', behavior: 'auto' });
  assert.match(h.status.textContent, /Last.*2/);
  h.setCurrent(false);
  const status = h.status.textContent;
  h.submit('entry:first');
  assert.equal(h.status.textContent, status);
  assert.deepEqual(h.focused, ['last']);
  h.setCurrent(true); h.invalidateOnLookup(); h.submit('entry:first');
  assert.deepEqual(h.focused, ['last']);
});

test('UX10 U08: native absent, injected, out-of-vector and disconnected choices are truthful without fallback', async () => {
  const h = await navigationFixture({
    entries: [{ id: 'one', name: 'One' }],
    getNext: () => ({ kind: 'target', id: 'missing' }),
  });
  h.submit('');
  assert.match(h.status.textContent, /Choose/);
  h.submit('absent');
  assert.equal(h.select.value, '');
  assert.match(h.status.textContent, /Choose/);
  h.select.append(h.el('option', { value: 'entry:missing', text: 'Missing' }));
  h.submit('entry:missing');
  assert.equal(h.select.value, 'entry:missing');
  assert.match(h.status.textContent, /no longer available/);
  h.select.children.pop(); h.select.value = '';
  h.submit('next-unfinished');
  assert.match(h.status.textContent, /no longer available/);
  h.targets.get('one').isConnected = false;
  h.submit('entry:one');
  assert.match(h.status.textContent, /no longer available/);
  assert.deepEqual(h.focused, []);
  const empty = await navigationFixture();
  assert.equal(empty.button.disabled, true);
  h.setCurrent(false);
  const status = h.status.textContent;
  h.submit('');
  assert.equal(h.status.textContent, status);
});

function node(props = {}) {
  return {
    children: [],
    hidden: false,
    listeners: {},
    value: '',
    addEventListener(name, listener) { this.listeners[name] = listener; },
    append(...children) { this.children.push(...children); },
    querySelectorAll() { return []; },
    replaceChildren(...children) { this.children = children; },
    ...props,
  };
}

const path = (id, depth = 'complete') => ({ id, name: id, depth });
const story = (key, ...lists) => ({ key, name: key, lists });
const timelineList = (id, index, extra = {}) => ({
  id,
  file: `${id}.json`,
  name: extra.name ?? id,
  description: `${id} description`,
  type: 'event',
  depth: 'complete',
  count: 1,
  placeholderCount: 0,
  emptyRecordCount: 0,
  collections: 0,
  characters: [],
  keywords: [],
  group: null,
  groupName: null,
  variant: null,
  beginner: false,
  timeline: 2004 + index,
  ...extra,
});

function savedState(entries = [], read = []) {
  return {
    schemaVersion: 2,
    issues: {},
    read: Object.fromEntries(read.map((id) => [id, 1])),
    overrides: {},
    notes: {},
    lists: Object.fromEntries(entries.map(({ id, catalogId, itemIds }) => [
      id,
      { id, name: id, catalogId, itemIds, collectedIn: {} },
    ])),
    listOrder: entries.map(({ id }) => id),
    active: entries[0]?.id ?? null,
  };
}

function modernTimelinePosition(...args) {
  return catalogView.modernTimelinePosition(...args);
}

test('Modern Timeline position covers unavailable, empty, movement, and completion states', () => {
  const stories = [
    story('first', path('first')),
    story('second', path('second')),
  ];
  const empty = savedState();

  assert.deepEqual(
    modernTimelinePosition(empty, [], { dropped: 2 }),
    { kind: 'unavailable', dropped: 2 },
  );
  assert.deepEqual(
    modernTimelinePosition(empty, []),
    { kind: 'empty', completed: 0, total: 0 },
  );
  assert.deepEqual(
    modernTimelinePosition(empty, stories),
    { kind: 'current', storyKey: 'list:first', storyName: 'first', completed: 0, total: 2 },
  );

  const partial = savedState([
    { id: 'saved-first', catalogId: 'first', itemIds: [1, 2] },
  ], [1]);
  assert.deepEqual(
    modernTimelinePosition(partial, stories),
    { kind: 'current', storyKey: 'list:first', storyName: 'first', completed: 0, total: 2 },
  );

  const advanced = savedState([
    { id: 'saved-first', catalogId: 'first', itemIds: [1, 2] },
  ], [1, 2]);
  assert.deepEqual(
    modernTimelinePosition(advanced, stories),
    { kind: 'current', storyKey: 'list:second', storyName: 'second', completed: 1, total: 2 },
  );

  advanced.read = { 2: 1 };
  assert.deepEqual(
    modernTimelinePosition(advanced, stories),
    { kind: 'current', storyKey: 'list:first', storyName: 'first', completed: 0, total: 2 },
  );

  const complete = savedState([
    { id: 'saved-first', catalogId: 'first', itemIds: [1, 2] },
    { id: 'saved-second', catalogId: 'second', itemIds: [3] },
  ], [1, 2, 3]);
  assert.deepEqual(
    modernTimelinePosition(complete, stories),
    { kind: 'complete', completed: 2, total: 2 },
  );

  const zeroItems = savedState([
    { id: 'saved-first', catalogId: 'first', itemIds: [] },
  ]);
  assert.equal(modernTimelinePosition(zeroItems, stories).storyKey, 'list:first');
});

test('Modern Timeline position uses the shallowest owned path and first saved catalog identity', () => {
  const grouped = [
    story('grouped', path('essential', 'essential'), path('complete'), path('alternate')),
    story('after', path('after')),
  ];

  const deepOnly = savedState([
    { id: 'deep', catalogId: 'complete', itemIds: [1, 2] },
  ], [1, 2]);
  assert.equal(modernTimelinePosition(deepOnly, grouped).storyKey, 'list:after');

  const shallowActive = savedState([
    { id: 'deep', catalogId: 'complete', itemIds: [1, 2] },
    { id: 'shallow', catalogId: 'essential', itemIds: [1, 3] },
  ], [1, 2]);
  assert.equal(modernTimelinePosition(shallowActive, grouped).storyKey, 'list:essential');

  const firstSavedWins = savedState([
    { id: 'first-copy', catalogId: 'essential', itemIds: [4, 5] },
    { id: 'second-copy', catalogId: 'essential', itemIds: [6] },
  ], [6]);
  assert.equal(modernTimelinePosition(firstSavedWins, grouped).storyKey, 'list:essential');

  const before = JSON.stringify(shallowActive);
  modernTimelinePosition(shallowActive, grouped);
  assert.equal(JSON.stringify(shallowActive), before);
  assert.deepEqual(Object.keys(shallowActive).sort(), [
    'active', 'issues', 'listOrder', 'lists', 'notes', 'overrides', 'read', 'schemaVersion',
  ]);
});

function catalogHarness({
  catalog = {
    dropped: 0,
    paths: [],
    lists: Array.from({ length: 13 }, (_, index) => timelineList(
      index === 0 ? 'first' : index === 1 ? 'second' : `extra-${index}`,
      index,
      { name: index === 0 ? 'First' : index === 1 ? 'Second' : `Extra ${index}` },
    )),
  },
  loadCatalog = null,
} = {}) {
  const nodes = {
    clear: node(),
    filters: node(),
    query: node(),
    results: node(),
    search: node(),
  };
  const paints = [];
  const announcements = [];
  const timeline = node({ kind: 'timeline' });
  const setup = node();
  let currentState = savedState();
  let active = true;
  let loads = 0;
  const view = createCatalogView({
    announce: (message) => announcements.push(message),
    clearLoadNotice: () => {},
    el: (_tag, props = {}) => node(props),
    elements: {
      shelf: () => nodes,
      spotlightKinds: () => [],
      spotlightSorts: () => [],
    },
    getState: () => currentState,
    isCurrent: (key) => active && key === 'catalog',
    loadCatalog: () => {
      loads += 1;
      return loadCatalog ? loadCatalog() : Promise.resolve(catalog);
    },
    notifyDropped: () => {},
    onLoadFailure: () => {},
    onSortChange: () => {},
    presentation: {
      chosenPath: () => null,
      ensureSetupGuideFeature: (_lists, _key, _featured, options = {}) => {
        setup.hidden = Boolean(options.hidden);
      },
      paintTimelinePosition: (...args) => paints.push(args),
      renderTimelineSections: (root) => root.append(timeline),
    },
  });
  view.wire('catalog');
  return {
    announcements,
    catalog,
    loads: () => loads,
    nodes,
    paints,
    setup,
    setActive: (value) => { active = value; },
    setState: (value) => { currentState = value; },
    timeline,
    view,
  };
}

const waitForAnnouncement = () => new Promise((resolve) => setTimeout(resolve, 550));

test('narrowed Timeline results lead while unrelated Setup returns only after clear', async () => {
  const h = catalogHarness();
  await h.view.render('catalog');
  assert.equal(h.setup.hidden, false);
  h.nodes.query.value = 'unmatched discovery';
  h.nodes.query.listeners.input();
  await h.view.render('catalog');
  assert.equal(h.setup.hidden, true);
  assert.ok(h.nodes.results.children.some((child) => child.text?.includes('No Reading Lists')));
  h.nodes.query.value = '';
  h.nodes.query.listeners.input();
  await h.view.render('catalog');
  assert.equal(h.setup.hidden, false);
  assert.equal(h.paints.at(-1)[2].narrowed, false);
});

test('Catalog derives before narrowing and refreshes only a changed position', async () => {
  const h = catalogHarness();
  await h.view.render('catalog');
  await waitForAnnouncement();
  h.announcements.length = 0;

  assert.equal(h.paints.length, 1);
  assert.equal(h.paints[0][1].storyKey, 'list:first');
  assert.equal(h.paints[0][2].visibleStoryKeys.has('list:first'), true);
  assert.equal(h.paints[0][2].narrowed, false);

  const children = [...h.nodes.results.children];
  const loads = h.loads();
  assert.equal(h.view.refreshProgress(), false);
  await waitForAnnouncement();
  assert.deepEqual(h.announcements, []);
  assert.equal(h.paints.length, 1);

  h.setState(savedState([
    { id: 'saved-first', catalogId: 'first', itemIds: [1] },
  ], [1]));
  assert.equal(h.view.refreshProgress(), true);
  await waitForAnnouncement();
  assert.equal(h.paints.at(-1)[1].storyKey, 'list:second');
  assert.match(h.announcements.at(-1), /You are here: Second/);
  assert.equal(h.loads(), loads);
  assert.deepEqual(h.nodes.results.children, children);

  h.nodes.query.value = 'Second';
  h.nodes.query.listeners.input();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.paints.at(-1)[1].storyKey, 'list:second');
  assert.equal(h.paints.at(-1)[2].narrowed, true);
  assert.deepEqual([...h.paints.at(-1)[2].visibleStoryKeys], ['list:second']);
});

test('Catalog commits live position context only for the current completed render', async () => {
  const pending = [];
  const catalog = {
    dropped: 0,
    paths: [],
    lists: Array.from({ length: 13 }, (_, index) => timelineList(
      index === 0 ? 'first' : index === 1 ? 'second' : `extra-${index}`,
      index,
    )),
  };
  const h = catalogHarness({
    catalog,
    loadCatalog: () => new Promise((resolve) => pending.push(resolve)),
  });

  const first = h.view.render('catalog');
  const second = h.view.render('catalog');
  assert.equal(h.view.refreshProgress(), false);

  h.setState(savedState([
    { id: 'saved-first', catalogId: 'first', itemIds: [1] },
  ], [1]));
  pending[1](catalog);
  await second;
  assert.equal(h.paints.length, 1);
  assert.equal(h.paints[0][1].storyKey, 'list:second');

  pending[0](catalog);
  await first;
  assert.equal(h.paints.length, 1);

  h.setActive(false);
  assert.equal(h.view.refreshProgress(), false);
  assert.equal(h.paints.length, 1);
});

test('Catalog owns shelf narrowing and delegates presentation through its injected contract', async () => {
  const nodes = {
    clear: node(),
    filters: node(),
    query: node(),
    results: node(),
    search: node(),
  };
  const rendered = [];
  const view = createCatalogView({
    announce: () => {},
    clearLoadNotice: () => {},
    el: (_tag, props = {}) => node(props),
    elements: {
      shelf: () => nodes,
      spotlightKinds: () => [],
      spotlightSorts: () => [],
    },
    loadCatalog: async () => ({ dropped: 0, lists: [], paths: [] }),
    notifyDropped: () => {},
    onLoadFailure: () => {},
    onSortChange: () => {},
    presentation: {
      chosenPath: () => null,
      ensureSetupGuideFeature: () => {},
      renderTimelineSections: (...args) => rendered.push(args),
    },
  });

  view.wire('catalog');
  nodes.query.value = '  avengers  ';
  nodes.query.listeners.input();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(nodes.clear.hidden, false);
  assert.equal(nodes.results.children.length, 1);
  assert.equal(rendered.length, 0);
});

// #897: following a bundled path on the Modern Timeline. A node that keeps what it is given, so the
// numbered stops and the cards inside them can be read back in order.
function keptNode(tag, props = {}, children = []) {
  return {
    tag,
    ...props,
    children: [].concat(children).filter((child) => child != null),
    dataset: { ...(props.dataset ?? {}) },
    hidden: props.hidden ?? false,
    listeners: {},
    textContent: props.text ?? '',
    value: props.value ?? '',
    addEventListener(name, listener) { this.listeners[name] = listener; },
    append(...more) { this.children.push(...more); },
    querySelectorAll() { return []; },
    replaceChildren(...next) { this.children = next; },
  };
}

const named = (id, index, name, extra = {}) => timelineList(id, index, { name, ...extra });
// Thirteen Timeline events and one undated character run, which the Timeline itself never shows.
const followCatalog = (steps) => ({
  dropped: 0,
  lists: [
    ...Array.from({ length: 13 }, (_, index) => named(`event-${index + 1}`, index, `Event ${index + 1}`)),
    named('essential', 0, 'Essential', { type: 'character-run', timeline: null }),
  ],
  paths: [
    { id: 'avengers', name: 'Avengers path', description: 'Three stops.', sourceOrigin: 'Compiled for a test.', steps },
    { id: 'long', name: 'Long path', description: 'Every event.', sourceOrigin: 'Compiled for a test.', steps: ['essential', ...Array.from({ length: 13 }, (_, index) => `event-${13 - index}`)] },
  ],
});

function followHarness(catalog = followCatalog(['essential', 'event-6', 'event-1'])) {
  const nodes = {
    clear: keptNode('button'),
    filters: keptNode('fieldset'),
    query: keptNode('input'),
    results: keptNode('div'),
    search: keptNode('form'),
  };
  const follow = {
    wrap: keptNode('div', { hidden: true }),
    select: keptNode('select'),
    about: keptNode('details', { hidden: true }),
    description: keptNode('p'),
    source: keptNode('p'),
  };
  const calls = { changes: 0, canonical: 0, timelines: 0, setupHidden: null };
  const paints = [];
  const announcements = [];
  let state = savedState();
  const view = createCatalogView({
    announce: (message) => announcements.push(message),
    clearLoadNotice: () => {},
    el: keptNode,
    elements: {
      shelf: () => nodes,
      spotlightKinds: () => [],
      spotlightSorts: () => [],
      follow: () => follow,
    },
    getState: () => state,
    isCurrent: (key) => key === 'catalog',
    loadCatalog: async () => catalog,
    notifyDropped: () => {},
    onFollowChange: () => { calls.changes += 1; },
    onFollowCanonical: () => { calls.canonical += 1; },
    onLoadFailure: () => {},
    onSortChange: () => {},
    presentation: {
      catalogCard: (entry, placement, options) => keptNode('article', { dataset: { story: entry.key }, placement, options }),
      chosenPath: () => null,
      ensureSetupGuideFeature: (_lists, _key, _featured, options = {}) => { calls.setupHidden = Boolean(options.hidden); },
      paintTimelinePosition: (...args) => paints.push(args),
      renderTimelineSections: () => { calls.timelines += 1; },
    },
  });
  view.wire('catalog');
  const stops = () => {
    const list = nodes.results.children.find((child) => child.tag === 'ol');
    return (list?.children ?? []).map((item) => ({
      value: item.value,
      meta: item.children[1].textContent,
      story: item.children[2].dataset.story,
    }));
  };
  return {
    announcements, calls, follow, nodes, paints, stops, view,
    setState: (next) => { state = next; },
  };
}

test('following a path shows every stop in the path\'s own order, a stop the Timeline never shows included', async () => {
  const h = followHarness();
  await h.view.render('catalog');
  assert.equal(h.follow.wrap.hidden, false);
  assert.deepEqual(h.follow.select.children.map((option) => [option.value, option.text]), [
    ['', 'Whole timeline'], ['avengers', 'Avengers path (3 stops)'], ['long', 'Long path (14 stops)'],
  ]);
  assert.equal(h.calls.timelines, 1);
  assert.deepEqual(h.stops(), []);

  h.view.setFollowedPath('avengers');
  await h.view.render('catalog');
  assert.equal(h.follow.select.value, 'avengers');
  assert.equal(h.follow.about.hidden, false);
  assert.equal(h.follow.description.textContent, 'Three stops.');
  assert.equal(h.follow.source.textContent, 'Source: Compiled for a test.');
  assert.equal(h.calls.timelines, 1, 'a followed path is not drawn as era and year rows');
  assert.equal(h.calls.setupHidden, true, 'the optional setup guide steps aside for the path');
  assert.deepEqual(h.stops(), [
    { value: '1', meta: 'Stop 1 of 3', story: 'list:essential' },
    { value: '2', meta: 'Stop 2 of 3 · Starts 2009', story: 'list:event-6' },
    { value: '3', meta: 'Stop 3 of 3 · Starts 2004', story: 'list:event-1' },
  ]);
  const card = h.nodes.results.children.find((child) => child.tag === 'ol').children[0].children[2];
  assert.equal(card.placement, null, 'a stop card does not repeat its step as a disclosure');
  assert.equal(card.options.level, 'h2');
});

test('a followed path shows its own progress, counting stops finished out of order', async () => {
  const h = followHarness();
  h.view.setFollowedPath('avengers');
  h.setState(savedState([
    { id: 'saved-essential', catalogId: 'essential', itemIds: [1] },
    { id: 'saved-event-1', catalogId: 'event-1', itemIds: [2] },
  ], [1, 2]));
  await h.view.render('catalog');
  const [, position, options] = h.paints.at(-1);
  assert.deepEqual(position, { kind: 'current', storyKey: 'list:event-6', storyName: 'Event 6', stop: 2, completed: 2, total: 3 });
  assert.equal(options.progress, 'Stop 2 of 3 · 2 of 3 stops complete');
  await waitForAnnouncement();
  assert.equal(h.announcements.at(-1),
    'Modern Timeline follows Avengers path: 3 stops. You are here: Event 6, stop 2 of 3. 2 of 3 stops complete.');

  h.setState(savedState([
    { id: 'saved-essential', catalogId: 'essential', itemIds: [1] },
    { id: 'saved-event-6', catalogId: 'event-6', itemIds: [3] },
    { id: 'saved-event-1', catalogId: 'event-1', itemIds: [2] },
  ], [1, 2, 3]));
  assert.equal(h.view.refreshProgress(), true);
  await waitForAnnouncement();
  assert.deepEqual(h.paints.at(-1)[1], { kind: 'complete', completed: 3, total: 3 });
  assert.equal(h.announcements.at(-1), 'Avengers path complete. All 3 stops are complete.');
});

test('search and filters narrow within a long path and keep its numbering', async () => {
  const h = followHarness();
  h.view.setFollowedPath('long');
  await h.view.render('catalog');
  assert.equal(h.nodes.search.hidden, false, 'a path longer than twelve stops is searchable');
  assert.deepEqual(h.stops().map(({ story }) => story).slice(0, 3), ['list:essential', 'list:event-13', 'list:event-12']);
  h.nodes.query.value = 'Event 1';
  h.nodes.query.listeners.input();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.stops().map(({ value, story }) => [value, story]), [
    ['2', 'list:event-13'], ['3', 'list:event-12'], ['4', 'list:event-11'], ['5', 'list:event-10'], ['14', 'list:event-1'],
  ]);
  await waitForAnnouncement();
  assert.match(h.announcements.at(-1), /^Modern Timeline follows Long path: 5 of 14 stops matching “Event 1”\./);
  assert.equal(h.paints.at(-1)[2].narrowed, true);
});

test('choosing another path lets the old narrowing go, and choosing none restores the whole timeline', async () => {
  const h = followHarness();
  h.view.setFollowedPath('long');
  await h.view.render('catalog');
  h.nodes.query.value = 'Event 1';
  h.nodes.query.listeners.input();
  await new Promise((resolve) => setImmediate(resolve));

  h.follow.select.value = 'avengers';
  h.follow.select.listeners.change();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.view.followedPath(), 'avengers');
  assert.equal(h.nodes.query.value, '');
  assert.equal(h.calls.changes, 1, 'the address records the choice');
  assert.equal(h.stops().length, 3);

  const timelines = h.calls.timelines;
  h.follow.select.value = '';
  h.follow.select.listeners.change();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.view.followedPath(), null);
  assert.equal(h.calls.changes, 2);
  assert.equal(h.calls.timelines, timelines + 1);
  assert.deepEqual(h.stops(), []);
  assert.equal(h.follow.about.hidden, true);
  assert.equal(h.paints.at(-1)[2].progress, undefined, 'the whole timeline keeps its own count');
});

test('a path that no longer resolves is let go and the address corrected, rather than drawn empty', async () => {
  const h = followHarness();
  h.view.setFollowedPath('retired-path');
  await h.view.render('catalog');
  assert.equal(h.view.followedPath(), null);
  assert.equal(h.calls.canonical, 1);
  assert.equal(h.calls.timelines, 1);
  h.view.setFollowedPath('avengers');
  h.view.clearNarrowing('catalog');
  assert.equal(h.view.followedPath(), null, 'going to a stop from a card shows its whole screen');
});

test('a followed path\'s stops lead with the reading the path names', () => {
  const stops = followedPathStories({
    stops: [{ key: 'group', name: 'Group', stepId: 'complete', lists: [path('essential', 'essential'), path('complete')] }],
  });
  assert.deepEqual(stops[0].lists.map(({ id }) => id), ['complete', 'essential']);
  const owned = savedState([{ id: 'mine', catalogId: 'essential', itemIds: [1] }]);
  assert.equal(followedPathPosition(owned, stops).storyKey, 'list:essential', 'a saved sibling reading is the one counted');
  assert.equal(followedPathPosition(savedState(), stops).storyKey, 'list:complete');
  assert.deepEqual(followedPathPosition(savedState(), [], {}), { kind: 'empty', completed: 0, total: 0 });
  assert.deepEqual(followedPathPosition(savedState(), stops, { dropped: 1 }), { kind: 'unavailable', dropped: 1 });
});

test('Catalog-family modules have constructed boundaries without concrete controller imports', () => {
  const main = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
  for (const name of ['CatalogView', 'PreviewView', 'ReadingPathsView', 'CatalogPresentation']) {
    assert.equal((main.match(new RegExp(`create${name}\\(\\{`, 'g')) ?? []).length, 1);
  }
  for (const path of [
    '../src/js/views/catalog.js',
    '../src/js/views/preview.js',
    '../src/js/views/reading-paths.js',
    '../src/js/views/shared/catalog-presentation.js',
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /from ['"].*(?:main|storage|views\/(?:catalog|preview|reading-paths))\.js['"]/);
  }
});
