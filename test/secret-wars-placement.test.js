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
// existing timeline stops or the Modern Avengers path moves. The separate event reading adds
// one stop, represented by the chooser rather than duplicated beside it.

const actual = parseCatalog(JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8')));
const PLACEMENT = 'placement:secret-wars-2015';
const withEvent = actual;
const beforeEvent = {
  ...actual,
  lists: actual.lists.filter((list) => list.id !== SECRET_WARS_2015_EVENT_ID),
};
const withoutReadings = {
  ...actual,
  lists: actual.lists.filter((list) => ![SECRET_WARS_2015_EVENT_ID, 'hickman-minimal', 'hickman-full'].includes(list.id)),
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

function harness(catalog = actual, { state = { lists: {}, listOrder: [], read: {} }, isCompleted = () => false } = {}) {
  const shelf = { clear: node(), filters: node(), query: node(), results: node(), search: node() };
  const follow = { wrap: node(), sections: node(), name: node(), whole: node(), about: node(), description: node(), source: node() };
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
    isCompleted,
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
    [['Event and tie-ins', SECRET_WARS_2015_EVENT_ID, []],
      ['Fast track', 'hickman-minimal', ['avengers-doomsday-secret-wars']], ['Hickman saga', 'hickman-full', []]]);
  assert.equal(placement.options[1].list, actual.lists.find((list) => list.id === 'hickman-minimal'),
    'the option is the catalog list itself, so its saved identity is the one already in use');
  assert.deepEqual(modernTimelinePlacements(withEvent.lists)[0].options.map((option) => option.label),
    ['Event and tie-ins', 'Fast track', 'Hickman saga']);
  assert.deepEqual(modernTimelinePlacements(beforeEvent.lists)[0].options.map((option) => option.label),
    ['Fast track', 'Hickman saga']);
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
  assert.deepEqual(card.options.map((option) => option.list.id), [SECRET_WARS_2015_EVENT_ID, 'hickman-minimal', 'hickman-full']);

  const bare = harness(withoutReadings);
  await bare.view.render('catalog');
  assert.equal(bare.stories().some((story) => story.key === PLACEMENT), false);
  assert.equal(placed.paints.at(-1).total, bare.paints.at(-1).total + 1,
    'only the actual event reading adds a stop; neither chooser nor its other options adds one');
  assert.deepEqual(
    groupCatalog(modernTimelineLists(actual.lists)).filter(({ lists }) =>
      !lists.some(({ id }) => id === SECRET_WARS_2015_EVENT_ID)),
    groupCatalog(modernTimelineLists(withoutReadings.lists)),
    'every pre-existing timeline stop stays unchanged',
  );
  assert.equal(placed.stories().length, bare.stories().length + 1);
  t.mock.timers.tick(600);
  const shown = modernTimelineLists(actual.lists).length;
  assert.match(placed.announced.at(-1), new RegExp(`shows ${shown + 2 + 14} Reading Lists. .* 0 of ${groupCatalog(modernTimelineLists(actual.lists)).length} timeline stops`),
    'each reading the card offers is counted as a Reading List shown');
  const sectionalCards = placed.stories().filter(({ sectional }) => sectional);
  assert.equal(sectionalCards.length, 1, 'the sectional parent is one non-addable chooser');
  assert.equal(sectionalCards[0].options.length, 14);
  const shownIds = placed.stories().flatMap(({ lists }) => lists.map(({ id }) => id));
  assert.equal(new Set(shownIds).size, shownIds.length, 'each addable child is shown once');
  assert.equal(shownIds.includes('civil-war-to-secret-invasion'), false);

  const event = harness(withEvent);
  await event.view.render('catalog');
  assert.equal(event.stories().filter((story) => story.lists.some((list) => list.id === SECRET_WARS_2015_EVENT_ID)).length, 1,
    'an event list offered on the card is not drawn a second time as its own stop');
  const eventCard = event.stories().find((story) => story.key === PLACEMENT);
  assert.equal(eventCard.stopKey, `list:${SECRET_WARS_2015_EVENT_ID}`, 'the card stands in for the event stop');
});

test('a genuinely new event offered on the card stays a timeline stop until it is read', async () => {
  const stops = groupCatalog(modernTimelineLists(withEvent.lists));
  const at = stops.findIndex((story) => story.lists.some((list) => list.id === SECRET_WARS_2015_EVENT_ID));
  assert.ok(at > 0, 'the event is one of the timeline stops');
  assert.equal(stops.length, groupCatalog(modernTimelineLists(beforeEvent.lists)).length + 1);
  const state = { lists: {}, listOrder: [], read: {} };
  for (const list of modernTimelineLists(withEvent.lists)) {
    state.lists[`saved-${list.id}`] = { id: `saved-${list.id}`, catalogId: list.id, name: list.name, itemIds: [] };
    state.listOrder.push(`saved-${list.id}`);
  }
  const unread = harness(withEvent, { state, isCompleted: (_state, id) => id !== `saved-${SECRET_WARS_2015_EVENT_ID}` });
  await unread.view.render('catalog');
  assert.deepEqual(
    [unread.paints.at(-1).kind, unread.paints.at(-1).storyKey, unread.paints.at(-1).completed, unread.paints.at(-1).total],
    ['current', `list:${SECRET_WARS_2015_EVENT_ID}`, at, stops.length],
    'every other stop read leaves the reader at the event, not at the end',
  );
  const read = harness(withEvent, { state, isCompleted: () => true });
  await read.view.render('catalog');
  assert.equal(read.paints.at(-1).kind, 'complete');
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
  assert.deepEqual(h.stories().find((story) => story.key === PLACEMENT)?.options.map(({ label }) => label),
    ['Event and tie-ins', 'Fast track', 'Hickman saga']);
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
    [['import', SECRET_WARS_2015_EVENT_ID], ['import', 'hickman-minimal'], ['import', 'hickman-full']]);
  assert.deepEqual(unsaved.calls, [], 'drawing the card adds nothing');
  for (const preview of all(unsaved.card).filter((node) => node.dataset?.act === 'preview')) preview.onclick();
  assert.deepEqual(unsaved.calls, [['preview', SECRET_WARS_2015_EVENT_ID], ['preview', 'hickman-minimal'], ['preview', 'hickman-full']]);

  const alias = present({ 'avengers-doomsday-secret-wars': { id: 'mcu-copy' } });
  const [event, fast, saga] = actions(alias.card);
  assert.equal(event.dataset.act, 'import', 'the event is an independent reading, not a saved fast-track alias');
  assert.equal(fast.dataset.act, 'open');
  assert.equal(fast.href, '#/read/mcu-copy');
  fast.onclick({ button: 0, preventDefault() {} });
  assert.deepEqual(alias.calls, [['open', 'avengers-doomsday-secret-wars', 'mcu-copy']],
    'the saved MCU Prep copy opens rather than a second fast track being offered');
  assert.equal(saga.dataset.act, 'import', 'the saga is a different reading and is still offered on its own');
  for (const preview of all(alias.card).filter((node) => node.dataset?.act === 'preview')) preview.onclick();
  assert.deepEqual(alias.calls.slice(1), [['preview', SECRET_WARS_2015_EVENT_ID], ['preview', 'avengers-doomsday-secret-wars'], ['preview', 'hickman-full']],
    'Preview shows the saved MCU Prep copy, so it offers Open rather than adding the fast track again');

  const both = present({ 'hickman-minimal': { id: 'own-copy' }, 'avengers-doomsday-secret-wars': { id: 'mcu-copy' } });
  actions(both.card)[1].onclick({ button: 0, preventDefault() {} });
  assert.deepEqual(both.calls, [['open', 'hickman-minimal', 'own-copy']], 'a copy saved as the fast track itself comes first');
  const savedEvent = present({ [SECRET_WARS_2015_EVENT_ID]: { id: 'event-copy' } });
  actions(savedEvent.card)[0].onclick({ button: 0, preventDefault() {} });
  assert.deepEqual(savedEvent.calls, [['open', SECRET_WARS_2015_EVENT_ID, 'event-copy']]);
});
