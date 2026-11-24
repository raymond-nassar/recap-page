import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { parseCatalog } from '../src/js/lib/catalog.js';
import { createStartingPointView } from '../src/js/views/starting-point.js';

const catalog = parseCatalog(JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8')));
const markup = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');

function control(props = {}) {
  return {
    listeners: {},
    children: [],
    hidden: false,
    checked: false,
    value: '',
    textContent: '',
    addEventListener(name, listener) { this.listeners[name] = listener; },
    replaceChildren(...next) { this.children = next; },
    ...props,
  };
}

function harness({ load = async () => catalog } = {}) {
  const nodes = {
    familiarity: [control({ value: 'new' }), control({ value: 'experienced' })],
    favorite: control(),
    starters: control({ textContent: 'Explore the ten starter picks' }),
    timeline: control({ textContent: 'Start the Modern Timeline', hidden: true }),
    match: control({ hidden: true }),
  };
  const calls = { announce: [], failures: [], cleared: 0, cards: [] };
  let loader = load;
  const view = createStartingPointView({
    el: (tag, props = {}) => ({ tag, ...props }),
    elements: () => nodes,
    isCurrent: () => true,
    loadCatalog: () => loader(),
    presentation: {
      catalogCard(story, options) {
        calls.cards.push(options);
        return { card: story.lists[0].id };
      },
    },
    announce: (text) => calls.announce.push(text),
    onLoadFailure: async (failure) => { calls.failures.push(failure); },
    clearLoadNotice: () => { calls.cleared += 1; },
  });
  const answer = {
    familiarity(value) {
      for (const radio of nodes.familiarity) radio.checked = radio.value === value;
      nodes.familiarity.find((radio) => radio.value === value).listeners.change();
    },
    favorite(value) {
      nodes.favorite.value = value;
      nodes.favorite.listeners.change();
    },
  };
  const shown = () => ['starters', 'timeline', 'match'].filter((key) => !nodes[key].hidden);
  return {
    nodes, calls, view, answer, shown, setLoader: (next) => { loader = next; },
  };
}

test('the favorite question offers No preference and then every Character spotlight, most popular first', async () => {
  const h = harness();
  await h.view.render();
  const options = h.nodes.favorite.children;
  assert.deepEqual([options[0].value, options[0].text], ['', 'No preference']);
  assert.equal(options.length, 74, 'No preference plus the 73 Character spotlights in the current catalog');
  assert.deepEqual(options.slice(1, 4).map(({ text }) => text),
    ['10 Best Spider-Man (Peter Parker) Comics Reading List', 'Wolverine', 'Iron Man']);
  const ids = new Set(catalog.lists.map(({ id }) => id));
  for (const { value } of options.slice(1)) assert.ok(ids.has(value), `${value} is a real catalog list`);
  assert.equal(h.nodes.favorite.value, '');
});

test('each pair of answers shows exactly one result', async () => {
  const h = harness();
  await h.view.render();
  assert.deepEqual(h.shown(), ['starters'], 'before any answer the existing starter link stays in place');

  h.answer.familiarity('new');
  assert.deepEqual(h.shown(), ['starters']);
  assert.equal(h.calls.announce.at(-1), 'Explore the ten starter picks');

  h.answer.familiarity('experienced');
  assert.deepEqual(h.shown(), ['timeline']);
  assert.equal(h.calls.announce.at(-1), 'Start the Modern Timeline');

  h.answer.favorite('wolverine-reading-order');
  assert.deepEqual(h.shown(), ['match'], 'a favorite gets its guide and no timeline invitation');
  assert.deepEqual(h.nodes.match.children, [{ card: 'wolverine-reading-order' }]);
  assert.deepEqual(h.calls.cards.at(-1), { surface: 'new-to-comics', report: '#guide-preview-report', level: 'h3' });
  assert.equal(h.calls.announce.at(-1), 'Wolverine');

  h.answer.familiarity('new');
  assert.deepEqual(h.shown(), ['match'], 'the favorite decides the guide for new readers too');

  h.answer.favorite('');
  assert.deepEqual(h.shown(), ['starters']);
  assert.deepEqual(h.nodes.match.children, []);
});

test('answers last for the visit only and never touch storage or the address', async (t) => {
  const forbidden = (name) => new Proxy({}, { get() { throw new Error(`${name} was used`); } });
  for (const name of ['localStorage', 'sessionStorage', 'location', 'history']) {
    const had = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { configurable: true, get: () => forbidden(name) });
    t.after(() => {
      if (had) Object.defineProperty(globalThis, name, had);
      else delete globalThis[name];
    });
  }
  const h = harness();
  // A browser may restore a checked radio after a reload; the visit starts unanswered regardless.
  h.nodes.familiarity[1].checked = true;
  await h.view.render();
  assert.deepEqual(h.nodes.familiarity.map(({ checked }) => checked), [false, false]);
  h.answer.familiarity('experienced');
  h.answer.favorite('iron-man-reading-order');
  // Leaving and coming back within the visit repaints the same answers.
  h.nodes.familiarity[1].checked = false;
  h.nodes.favorite.value = '';
  await h.view.render();
  assert.deepEqual(h.nodes.familiarity.map(({ checked }) => checked), [false, true]);
  assert.equal(h.nodes.favorite.value, 'iron-man-reading-order');
  assert.deepEqual(h.shown(), ['match']);
});

test('a catalog that cannot load keeps both no-preference results and recovers on retry', async () => {
  const h = harness({ load: async () => { throw new Error('offline'); } });
  await h.view.render();
  assert.equal(h.calls.failures.length, 1);
  assert.equal(h.calls.failures[0].error.message, 'offline');
  assert.deepEqual(h.nodes.favorite.children.map(({ text }) => text), ['No preference']);
  assert.deepEqual(h.shown(), ['starters']);
  h.answer.familiarity('experienced');
  assert.deepEqual(h.shown(), ['timeline']);

  h.setLoader(async () => catalog);
  await h.calls.failures[0].retry();
  assert.equal(h.calls.cleared, 1);
  assert.equal(h.nodes.favorite.children.length, 74);
  assert.deepEqual(h.shown(), ['timeline'], 'the answer given while offline is kept');
});

test('the guide asks both questions with the approved words above its one result', () => {
  const start = markup.indexOf('aria-labelledby="guide-start-h"');
  const section = markup.slice(start, markup.indexOf('</section>', start));
  assert.match(section, /<h2 id="guide-start-h">Find a starting point<\/h2>/);
  assert.match(section, /<legend class="filter-legend">How familiar are you with Marvel comics\?<\/legend>/);
  const radios = [...section.matchAll(/<input type="radio" name="guide-start-familiarity" value="([a-z]+)" \/>\s*<span>([^<]+)<\/span>/g)]
    .map(([, value, label]) => [value, label]);
  assert.deepEqual(radios, [['new', "I'm new"], ['experienced', "I've read Marvel comics before"]]);
  assert.doesNotMatch(section, /checked/, 'no answer is chosen for the reader');
  assert.match(section, /<label for="guide-start-favorite" class="story-type-label">Who would you like to read about\?<\/label>/);
  assert.match(section, /<select id="guide-start-favorite"><option value="">No preference<\/option><\/select>/);
  const result = section.slice(section.indexOf('id="guide-start-result"'));
  assert.ok(section.indexOf('id="guide-start-favorite"') < section.indexOf('id="guide-start-result"'));
  assert.match(result, /<p id="guide-start-starters"><a href="#\/genres" class="btn primary" data-view="genres" data-guide-starters>Explore the ten starter picks<\/a><\/p>/);
  assert.match(result, /<p id="guide-start-timeline" hidden><a href="#\/catalog" class="btn primary" data-view="catalog">Start the Modern Timeline<\/a><\/p>/);
  assert.match(result, /<div id="guide-start-match" class="catalog-grid publishing-grid" hidden><\/div>/);
});

test('the app paints the starting point whenever the guide page shows', () => {
  assert.match(mainSource, /if \(next === 'new-to-comics'\) void startingPointView\.render\(\);/);
  const start = mainSource.indexOf('const startingPointView = createStartingPointView');
  assert.notEqual(start, -1);
  const body = mainSource.slice(start, mainSource.indexOf('});', start));
  assert.match(body, /isCurrent: \(\) => view === 'new-to-comics'/);
  assert.match(body, /report: '#guide-preview-report'/);
  assert.match(body, /key: CATALOG_LOAD/);
  assert.doesNotMatch(body, /store\.|localStorage|syncHash/);
});
