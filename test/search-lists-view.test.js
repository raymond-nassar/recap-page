import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parseCatalog } from '../src/js/lib/catalog.js';
import { rankLists } from '../src/js/lib/listSearch.js';
import {
  createSearchListsView, comicsLine, creatorsLine, listsLine, seriesLine, OFFLINE_LINE, NAME_PAGE, TOP_PER_GROUP,
} from '../src/js/views/search-lists.js';

const catalog = parseCatalog(JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8')));
const LISTS = rankLists(catalog.lists, 'mcu prep', { guides: null }).length;

function descendants(node) {
  return typeof node === 'object' && node !== null
    ? [node, ...(node.children ?? []).flatMap(descendants)] : [];
}

function matches(node, selector) {
  const scope = /^\[data-scope="(.+)"\]$/.exec(selector);
  if (scope) return node.dataset?.scope === scope[1];
  if (selector === '[data-scope]') return node.dataset?.scope !== undefined;
  return node.tag === selector;
}

function harness({
  loadCatalog = async () => catalog, online = true, seriesCount = 12, creatorCount = 2,
} = {}) {
  let focused = null;
  const el = (tag, props = {}, children = []) => {
    const node = {
      tag, children: [], hidden: false, textContent: '', dataset: {}, attributes: {}, classes: new Set(),
      append(...next) { for (const child of next) this.children.push(child); },
      replaceChildren(...next) { this.children = []; this.append(...next); },
      setAttribute(name, value) { this.attributes[name] = value; },
      getAttribute(name) { return this.attributes[name]; },
      querySelectorAll(selector) { return descendants(this).slice(1).filter((child) => matches(child, selector)); },
      querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
      classList: { toggle(name, on) { if (on) node.classes.add(name); else node.classes.delete(name); } },
      focus() { focused = this; },
      ...props,
    };
    node.append(...[].concat(children));
    return node;
  };
  const scopeButton = (scope) => el('button', { dataset: { scope } });
  const group = () => ({ section: el('section', { hidden: true }), grid: el('div'), more: el('button', { hidden: true }) });
  const nodes = {
    card: el('section', { dataset: { scope: 'top' } }),
    browse: el('section'),
    scopes: el('div', { hidden: true }, ['top', 'lists', 'series', 'creators', 'comics'].map(scopeButton)),
    count: el('p', { hidden: true }),
    panes: el('div', { hidden: true }),
    lists: group(),
    series: group(),
    creators: group(),
    comics: { section: el('section', { hidden: true }), more: el('button', { hidden: true }) },
  };
  const names = (kind, total) => Array.from({ length: total }, (_, i) => ({ name: `${kind} ${i + 1}`, issueCount: i }));
  const timers = [];
  const announced = [];
  const lookups = [];
  const opened = [];
  const input = el('input');
  const view = createSearchListsView({
    el,
    elements: () => nodes,
    loadCatalog,
    loadGuides: async () => null,
    searchNames: async (kind, query, { limit }) => {
      const all = names(kind, kind === 'series' ? seriesCount : creatorCount);
      return { items: all.slice(0, limit), matched: all.length };
    },
    presentation: {
      catalogRow: (list, options) => el('article', { list, options }, [el('button')]),
    },
    thumb: () => el('span'),
    comics: { lookup: (query, options) => lookups.push({ query, ...options }) },
    openNamed: (kind, item) => opened.push([kind, item.name]),
    announce: (message) => announced.push(message),
    isOnline: () => online,
    setTimer: (fn, delay) => { const timer = { fn, delay, live: true }; timers.push(timer); return timer; },
    clearTimer: (timer) => { if (timer) timer.live = false; },
  });
  const comicStatus = (phase, query, count = 0) => view.comicStatus({
    phase, item: { name: query }, items: Array.from({ length: count }, () => ({})),
  });
  return {
    view, nodes, announced, lookups, opened, input, comicStatus,
    rows: (kind) => nodes[kind].grid.children,
    focused: () => focused,
    pressed: () => nodes.scopes.querySelectorAll('[data-scope]')
      .filter((button) => button.attributes['aria-pressed'] === 'true').map((button) => button.dataset.scope),
    flush: () => { for (const timer of timers.splice(0)) if (timer.live) timer.fn(); },
    timers,
  };
}

test('the count lines name an exact count, and comics only ever a count shown', () => {
  assert.equal(listsLine(1), '1 Reading List');
  assert.equal(listsLine(12), '12 Reading Lists');
  assert.equal(listsLine(0), 'No Reading Lists match');
  assert.equal(seriesLine(1), '1 series');
  assert.equal(creatorsLine(2), '2 creators');
  assert.equal(comicsLine(3), '3 comics shown.');
  assert.equal(comicsLine(50), '50 comics shown. Add words to narrow.');
  assert.equal(comicsLine(0), 'No comics match.');
});

test('an empty box shows Browse by and no scopes, and typing shows Top with three of each local group', async () => {
  const h = harness();
  await h.view.update('');
  assert.equal(h.nodes.browse.hidden, false);
  assert.equal(h.nodes.scopes.hidden, true);
  assert.equal(h.nodes.panes.hidden, true);
  await h.view.update('mcu prep');
  assert.equal(h.nodes.browse.hidden, true);
  assert.equal(h.nodes.scopes.hidden, false);
  assert.deepEqual(h.pressed(), ['top']);
  assert.equal(h.nodes.card.dataset.scope, 'top');
  assert.equal(h.nodes.count.textContent, 'Top results for “mcu prep”');
  for (const kind of ['lists', 'series']) {
    assert.equal(h.nodes[kind].section.hidden, false);
    assert.equal(h.rows(kind).length, TOP_PER_GROUP);
  }
  assert.equal(h.rows('creators').length, 2);
  assert.equal(h.nodes.lists.more.textContent, `See all ${LISTS} Reading Lists`);
  assert.equal(h.nodes.series.more.textContent, 'See all 12 series');
  assert.equal(h.nodes.creators.more.hidden, true, 'two creators need no See all');
  assert.equal(h.nodes.comics.section.hidden, true, 'comics are not looked up as the reader types');
  assert.deepEqual(h.lookups, []);
  assert.equal(h.rows('lists')[0].options.level, 'h3');
});

test('a scope switch shows the full group, keeps focus on the pressed scope and announces its count once', async () => {
  const h = harness();
  await h.view.update('mcu prep');
  assert.equal(h.timers.filter((timer) => timer.live).length, 1, 'the typing announcement is pending');
  h.view.setScope('lists');
  assert.deepEqual(h.pressed(), ['lists']);
  assert.equal(h.focused()?.dataset.scope, 'lists');
  assert.equal(h.nodes.count.textContent, `${LISTS} Reading Lists`);
  assert.equal(h.rows('lists').length, LISTS);
  assert.equal(h.nodes.series.section.hidden, true);
  assert.equal(h.nodes.lists.more.hidden, true);
  assert.deepEqual(h.announced, [`${LISTS} Reading Lists`]);
  h.flush();
  assert.deepEqual(h.announced, [`${LISTS} Reading Lists`], 'the pending typing announcement was cancelled');
  h.view.setScope('series');
  assert.equal(h.nodes.count.textContent, '12 series');
  assert.equal(h.nodes.series.more.hidden, true, 'every series fits in one page');
  assert.deepEqual(h.lookups, [], 'no local scope sends a comic request');
});

test('a comic lookup settling leaves the local rows standing, so a reader working down them keeps focus', async () => {
  const h = harness();
  await h.view.update('mcu prep');
  const rows = [...h.rows('lists'), ...h.rows('series')];
  h.view.submit();
  h.comicStatus('running', 'mcu prep');
  h.comicStatus('complete', 'mcu prep', 3);
  const after = [...h.rows('lists'), ...h.rows('series')];
  assert.ok(after.length === rows.length && after.every((row, i) => row === rows[i]), 'the same row nodes, not rebuilt copies');
});

test('Comics is looked up once per query: on first opening the scope or on Enter, never on a switch', async () => {
  const h = harness();
  await h.view.update('spider ');
  h.view.setScope('comics');
  assert.deepEqual(h.lookups, [{ query: 'spider' }]);
  h.comicStatus('running', 'spider');
  assert.equal(h.nodes.count.textContent, 'Looking up comics…');
  h.comicStatus('complete', 'spider', 50);
  assert.equal(h.nodes.count.textContent, '50 comics shown. Add words to narrow.');
  assert.equal(h.nodes.comics.section.hidden, false);
  for (const scope of ['top', 'lists', 'comics', 'creators', 'comics']) h.view.setScope(scope);
  h.view.submit();
  assert.equal(h.lookups.length, 1, 'switching and pressing Enter again send nothing');
  h.view.setScope('top');
  assert.equal(h.nodes.comics.section.hidden, false, 'Top shows the first comics once looked up');
  assert.ok(h.nodes.panes.classes.has('has-comics'));
  assert.equal(h.nodes.comics.more.hidden, false);
  assert.equal(h.nodes.comics.more.textContent, 'See all 50 comics');
  assert.match(h.announced.at(-1), /, 50 comics shown\.$/);
  await h.view.update('hulk');
  assert.equal(h.nodes.comics.section.hidden, true, 'a new query hides the last query’s comics');
  h.view.submit();
  assert.deepEqual(h.lookups.at(-1), { query: 'hulk', reveal: true });
  h.comicStatus('failed', 'hulk');
  h.view.submit();
  assert.equal(h.lookups.length, 3, 'a failed lookup can be tried again');
});

test('offline, the local scopes still work and Comics says it needs a connection without a request', async () => {
  const h = harness({ online: false });
  await h.view.update('mcu prep');
  assert.equal(h.rows('lists').length, TOP_PER_GROUP);
  h.view.setScope('comics');
  assert.equal(h.nodes.count.textContent, OFFLINE_LINE);
  assert.equal(h.announced.at(-1), OFFLINE_LINE);
  h.view.submit();
  assert.deepEqual(h.lookups, []);
  h.view.setScope('creators');
  assert.equal(h.nodes.count.textContent, '2 creators');
});

test('a Browse tile presses its scope, gives the reader the box and shows a hint rather than nothing', async () => {
  const h = harness();
  await h.view.update('');
  h.view.startScope('series', h.input);
  assert.equal(h.focused(), h.input);
  assert.deepEqual(h.pressed(), ['series']);
  assert.equal(h.nodes.scopes.hidden, false);
  assert.equal(h.nodes.browse.hidden, true);
  assert.equal(h.nodes.count.textContent, 'Type a series name to find it.');
  assert.deepEqual(h.announced, []);
  await h.view.update('spi');
  assert.equal(h.nodes.count.textContent, '12 series');
});

test('choosing a series or creator opens its screen, and Show more pages through the names', async () => {
  const h = harness({ seriesCount: 90 });
  await h.view.update('spider');
  h.rows('creators')[0].children.at(-1).onclick();
  assert.deepEqual(h.opened, [['creator', 'creators 1']]);
  h.view.setScope('series');
  assert.equal(h.rows('series').length, NAME_PAGE);
  assert.equal(h.nodes.series.more.hidden, false);
  await h.view.showMore('series');
  assert.equal(h.rows('series').length, NAME_PAGE * 2);
  assert.equal(h.focused(), h.rows('series')[NAME_PAGE].children.at(-1));
  h.rows('series')[0].children.at(-1).onclick();
  assert.deepEqual(h.opened.at(-1), ['series', 'series 1']);
});

test('typing announces once, after the pause, for the latest query', async () => {
  const h = harness();
  await h.view.update('m');
  await h.view.update('mcu prep');
  assert.deepEqual(h.announced, []);
  assert.ok(h.timers.every((timer) => timer.delay === 500));
  h.flush();
  assert.deepEqual(h.announced, [`Top results for “mcu prep”. ${LISTS} Reading Lists, 12 series, 2 creators.`]);
  await h.view.update('mcu');
  await h.view.update('');
  h.flush();
  assert.equal(h.announced.length, 1, 'clearing the box cancels a pending announcement');
});

test('a slower earlier load cannot overwrite a later query', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const h = harness({ loadCatalog: () => (calls++ === 0 ? gate.then(() => ({ lists: [] })) : Promise.resolve(catalog)) });
  const earlier = h.view.update('mcu prep');
  await h.view.update('House of M');
  const latest = h.rows('lists').map((row) => row.list.id);
  assert.equal(latest[0], 'house-of-m');
  release();
  await earlier;
  assert.deepEqual(h.rows('lists').map((row) => row.list.id), latest);
});

test('a catalog failure shows a notice in the Reading Lists scope only', async () => {
  const h = harness({ loadCatalog: async () => { throw new Error('HTTP 500'); } });
  await h.view.update('mcu prep');
  h.view.setScope('lists');
  assert.equal(h.nodes.count.textContent, 'Reading Lists could not be loaded: HTTP 500.');
  h.view.setScope('series');
  assert.equal(h.nodes.count.textContent, '12 series');
});

test('typing and switching make no network request and write no storage or history entry', async () => {
  const originals = {
    fetch: globalThis.fetch, localStorage: globalThis.localStorage, history: globalThis.history,
    indexedDB: globalThis.indexedDB, sessionStorage: globalThis.sessionStorage,
  };
  const calls = [];
  const spy = (name) => () => { calls.push(name); return undefined; };
  globalThis.fetch = async (...args) => { calls.push(`fetch ${args[0]}`); throw new Error('no network'); };
  const storage = (name) => ({ setItem: spy(`${name}.setItem`), removeItem: spy(`${name}.removeItem`), getItem: () => null });
  globalThis.localStorage = storage('localStorage');
  globalThis.sessionStorage = storage('sessionStorage');
  globalThis.indexedDB = { open: spy('indexedDB.open') };
  globalThis.history = { pushState: spy('history.pushState'), replaceState: spy('history.replaceState') };
  try {
    const h = harness();
    for (const query of ['s', 'sp', 'spider', 'spider-man 2099', '', 'mcu prep']) await h.view.update(query);
    for (const scope of ['lists', 'series', 'creators', 'top']) h.view.setScope(scope);
    h.flush();
    assert.deepEqual(calls, []);
    assert.deepEqual(h.lookups, []);
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
