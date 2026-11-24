import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  groupCatalog,
  modernTimelineLists,
  modernTimelinePlacements,
  parseCatalog,
  resolveReadingPaths,
  SECRET_WARS_2015_EVENT_ID,
} from '../src/js/lib/catalog.js';
import { createCatalogView } from '../src/js/views/catalog.js';
import { createCatalogPresentation } from '../src/js/views/shared/catalog-presentation.js';

// The owner placed Secret Wars (2015) at 2015 on Modern Timeline as one card offering its readings
// (2026-11-24). These checks hold the parts that protect saved reading: the card points at the
// readings that already exist, a saved MCU Prep copy continues the fast track, and nothing about the
// timeline's stops or the Modern Avengers path moves. Run against the shipped catalog.

const actual = parseCatalog(JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8')));
const PLACEMENT = 'placement:secret-wars-2015';
const eventList = {
  ...actual.lists.find((list) => list.id === 'hickman-minimal'),
  id: SECRET_WARS_2015_EVENT_ID,
  name: 'Secret Wars (2015) Event and Tie-ins',
  type: 'event',
  group: undefined,
  groupName: undefined,
  variant: undefined,
  timeline: 2015,
};
const withEvent = { ...actual, lists: [...actual.lists, eventList] };
const withoutReadings = {
  ...actual,
  lists: actual.lists.filter((list) => !['hickman-minimal', 'hickman-full'].includes(list.id)),
};

function node(props = {}, children = []) {
  return {
    children: [].concat(children),
    dataset: {},
    hidden: false,
    isConnected: true,
    textContent: props.text ?? '',
    listeners: {},
    addEventListener(name, listener) { this.listeners[name] = listener; },
    setAttribute(name, value) { this[name] = value; },
    focus() {},
    scrollIntoView() {},
    querySelectorAll() { return []; },
    querySelector() { return null; },
    append(...next) { this.children.push(...next); },
    before() {},
    replaceChildren(...next) { this.children = next; },
    value: '',
    ...props,
  };
}

const element = (tag, props = {}, children = []) => node({ tagName: tag.toUpperCase(), ...props }, children);

function harness(catalog = actual) {
  const state = { lists: {}, listOrder: [], read: {} };
  const shelf = { clear: node(), filters: node(), query: node(), results: node(), search: node() };
  const follow = { wrap: node(), select: element('select'), about: node(), description: node(), source: node() };
  const sections = [];
  const paints = [];
  const announced = [];
  const cards = [];
  const view = createCatalogView({
    announce: (message) => announced.push(message),
    clearLoadNotice: () => {},
    el: element,
    elements: {
      shelf: () => shelf, spotlightKinds: () => [], spotlightSorts: () => [], follow: () => follow,
    },
    getState: () => state,
    isCurrent: (key) => key === 'catalog',
    isCompleted: () => false,
    loadCatalog: () => Promise.resolve(catalog),
    notifyDropped: () => {},
    onLoadFailure: ({ error }) => { throw error; },
    onSortChange: () => {},
    presentation: {
      catalogCard: (story) => {
        cards.push(story);
        return element('article', { dataset: { story: story.key } });
      },
      chosenPath: () => null,
      ensureSetupGuideFeature: () => {},
      paintTimelinePosition: (_root, position) => paints.push(position),
      renderTimelineSections: (_box, drawn) => sections.push(drawn),
    },
  });
  view.wire('catalog');
  const stories = () => sections.at(-1).flatMap((section) => section.stories);
  return { view, shelf, sections, paints, announced, cards, stories, state };
}

test('the placement resolves existing readings by id, in the owner order, and leaves the timeline list alone', () => {
  const [placement, ...rest] = modernTimelinePlacements(actual.lists);
  assert.deepEqual(rest, []);
  assert.equal(placement.key, PLACEMENT);
  assert.equal(placement.year, 2015);
  assert.deepEqual(placement.options.map((option) => [option.label, option.list.id, option.savedAs.map((list) => list.id)]),
    [['Fast track', 'hickman-minimal', ['avengers-doomsday-secret-wars']], ['Hickman saga', 'hickman-full', []]]);
  assert.equal(placement.options[0].list, actual.lists.find((list) => list.id === 'hickman-minimal'),
    'the option is the catalog list itself, so its saved identity is the one already in use');
  assert.deepEqual(modernTimelinePlacements(withEvent.lists)[0].options.map((option) => option.label),
    ['Event and tie-ins', 'Fast track', 'Hickman saga']);
  assert.deepEqual(modernTimelinePlacements(withoutReadings.lists), [], 'no reading, no card');
  const timelineIds = new Set(modernTimelineLists(actual.lists).map((list) => list.id));
  for (const id of ['hickman-minimal', 'hickman-full', 'avengers-doomsday-secret-wars']) {
    assert.equal(timelineIds.has(id), false, `${id} is not a timeline stop of its own`);
  }
});

test('the default timeline draws the card at 2015 without counting it as a stop', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const placed = harness();
  await placed.view.render('catalog');
  const card = placed.stories().find((story) => story.key === PLACEMENT);
  assert.ok(card, 'the placement is drawn on the default timeline');
  const era = placed.sections.at(-1).find((section) => section.stories.includes(card));
  assert.ok(era.from <= 2015 && era.to >= 2015, 'it sits in the era holding 2015');
  assert.deepEqual(card.options.map((option) => option.list.id), ['hickman-minimal', 'hickman-full']);

  const bare = harness(withoutReadings);
  await bare.view.render('catalog');
  assert.equal(bare.stories().some((story) => story.key === PLACEMENT), false);
  assert.deepEqual(placed.paints.at(-1), bare.paints.at(-1), 'the timeline position is the same with or without it');
  assert.equal(placed.stories().length, bare.stories().length + 1);
  t.mock.timers.tick(600);
  const shown = modernTimelineLists(actual.lists).length;
  assert.match(placed.announced.at(-1), new RegExp(`shows ${shown + 2} Reading Lists. .* 0 of ${groupCatalog(modernTimelineLists(actual.lists)).length} timeline stops`),
    'each reading the card offers is counted as a Reading List shown');

  const event = harness(withEvent);
  await event.view.render('catalog');
  assert.equal(event.stories().filter((story) => story.lists.some((list) => list.id === SECRET_WARS_2015_EVENT_ID)).length, 1,
    'an event list offered on the card is not drawn a second time as its own stop');
  assert.deepEqual(event.paints.at(-1), placed.paints.at(-1), 'and it is never counted as a stop');
});

test('a search keeps only the readings it names, and an unrelated search drops the card', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const h = harness();
  await h.view.render('catalog');
  h.shelf.query.value = 'fast track';
  h.shelf.query.listeners.input();
  await h.view.render('catalog');
  const card = h.stories().find((story) => story.key === PLACEMENT);
  assert.deepEqual(card?.options.map((option) => option.label), ['Fast track']);
  assert.deepEqual(card.lists.map((list) => list.id), ['hickman-minimal']);
  h.shelf.query.value = 'Secret Wars (2015)';
  h.shelf.query.listeners.input();
  await h.view.render('catalog');
  assert.equal(h.stories().find((story) => story.key === PLACEMENT)?.options.length, 2);
  h.shelf.query.value = 'zzzz no such reading';
  h.shelf.query.listeners.input();
  await h.view.render('catalog');
  t.mock.timers.tick(600);
  assert.match(h.announced.at(-1), /No Reading Lists match/);
});

test('following Modern Avengers draws no placement and keeps the fast track as stop 8 of 10', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const path = resolveReadingPaths(actual.paths, actual.lists).find((entry) => entry.id === 'modern-avengers');
  assert.equal(path.stops.length, 10);
  assert.equal(path.stops[7].stepId, 'hickman-minimal');
  const h = harness();
  h.view.setFollowedPath('modern-avengers');
  await h.view.render('catalog');
  assert.equal(h.cards.some((story) => story.key === PLACEMENT || story.placement), false);
  assert.equal(h.cards.length, 10);
  t.mock.timers.tick(600);
  assert.match(h.announced.join(' '), /follows The Modern Avengers: 10 stops/);
});

function present(saved = {}) {
  const calls = [];
  const presentation = createCatalogPresentation({
    el: (tag, props = {}, children = []) => ({ tag, children: [].concat(children).filter(Boolean), ...props }),
    hueOf: () => 0,
    isInLibrary: (id) => saved[id] ?? null,
    onAdd: (list) => calls.push(['add', list.id]),
    onOpen: (list, copy) => calls.push(['open', list.id, copy.id]),
    onPreview: (list) => calls.push(['preview', list.id]),
    paintCoverUrl: () => {},
    shortTitle: (title) => title,
  });
  const [placement] = modernTimelinePlacements(actual.lists);
  return { calls, card: presentation.placementCard(placement) };
}

const all = (node) => (node && typeof node === 'object' ? [node, ...node.children.flatMap(all)] : []);
const actions = (card) => all(card).filter((node) => node.dataset?.act === 'open' || node.dataset?.act === 'import');

test('each reading on the card opens its own saved copy, a saved MCU Prep copy continues the fast track, and nothing is added', () => {
  const unsaved = present();
  assert.equal(all(unsaved.card).find((node) => node.class === 'catalog-card-title').text, 'Secret Wars (2015)');
  assert.deepEqual(actions(unsaved.card).map((node) => [node.dataset.act, node.dataset.key]),
    [['import', 'hickman-minimal'], ['import', 'hickman-full']]);
  assert.deepEqual(unsaved.calls, [], 'drawing the card adds nothing');
  for (const preview of all(unsaved.card).filter((node) => node.dataset?.act === 'preview')) preview.onclick();
  assert.deepEqual(unsaved.calls, [['preview', 'hickman-minimal'], ['preview', 'hickman-full']]);

  const alias = present({ 'avengers-doomsday-secret-wars': { id: 'mcu-copy' } });
  const [fast, saga] = actions(alias.card);
  assert.equal(fast.dataset.act, 'open');
  assert.equal(fast.href, '#/read/mcu-copy');
  fast.onclick({ button: 0, preventDefault() {} });
  assert.deepEqual(alias.calls, [['open', 'avengers-doomsday-secret-wars', 'mcu-copy']],
    'the saved MCU Prep copy opens rather than a second fast track being offered');
  assert.equal(saga.dataset.act, 'import', 'the saga is a different reading and is still offered on its own');

  const both = present({ 'hickman-minimal': { id: 'own-copy' }, 'avengers-doomsday-secret-wars': { id: 'mcu-copy' } });
  actions(both.card)[0].onclick({ button: 0, preventDefault() {} });
  assert.deepEqual(both.calls, [['open', 'hickman-minimal', 'own-copy']], 'a copy saved as the fast track itself comes first');
});
