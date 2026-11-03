import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parseCatalog } from '../src/js/lib/catalog.js';
import { createSearchListsView, LIST_RESULTS_INITIAL } from '../src/js/views/search-lists.js';

const catalog = parseCatalog(JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8')));

function descendants(node) {
  return typeof node === 'object' && node !== null
    ? [node, ...(node.children ?? []).flatMap(descendants)] : [];
}

function harness({ loadCatalog = async () => catalog, loadGuides = async () => null } = {}) {
  const el = (tag, props = {}, children = []) => {
    const node = {
      tag, children: [], hidden: false, textContent: '',
      append(...next) {
        for (const child of next) {
          this.children.push(child);
          if (typeof child === 'object') child.parent = this;
        }
      },
      replaceChildren(...next) { this.children = []; this.append(...next); },
      querySelector(selector) {
        return descendants(this).slice(1).find((child) => child.class === selector.slice(1));
      },
      focus() { focused = this; },
      ...props,
    };
    node.append(...[].concat(children));
    return node;
  };
  let focused = null;
  const nodes = {
    section: el('section', { hidden: true }), count: el('p'), grid: el('div'), more: el('button', { hidden: true }),
  };
  const timers = [];
  const announced = [];
  const loads = { catalog: 0, guides: 0 };
  const view = createSearchListsView({
    el,
    elements: () => nodes,
    loadCatalog: () => { loads.catalog += 1; return loadCatalog(); },
    loadGuides: () => { loads.guides += 1; return loadGuides(); },
    presentation: {
      catalogRow: (list, options) => el('article', { story: { lists: [list] }, options }, [
        el('button', { class: 'catalog-card-preview', story: { lists: [list] } }),
      ]),
    },
    announce: (message) => announced.push(message),
    setTimer: (fn, delay) => { const timer = { fn, delay, live: true }; timers.push(timer); return timer; },
    clearTimer: (timer) => { if (timer) timer.live = false; },
  });
  return {
    view, nodes, announced, loads,
    cards: () => nodes.grid.children.map((card) => card.story.lists[0]),
    focused: () => focused,
    flush: () => { for (const timer of timers.splice(0)) if (timer.live) timer.fn(); },
    timers,
  };
}

test('a query shows six ranked Reading List rows, a count and a Show all button', async () => {
  const h = harness();
  await h.view.update('mcu prep');
  assert.equal(h.nodes.section.hidden, false);
  assert.equal(LIST_RESULTS_INITIAL, 6);
  assert.equal(h.cards().length, 6);
  assert.ok(h.cards().every((list) => list.type === 'screen-companion'));
  assert.equal(h.nodes.count.textContent, '37 Reading Lists match');
  assert.equal(h.nodes.more.hidden, false);
  assert.equal(h.nodes.more.textContent, 'Show all 37 Reading Lists');
  const [card] = h.nodes.grid.children;
  assert.deepEqual(card.options, { report: '#search-lists-report', level: 'h3' });
});

test('Show all reveals every match and moves focus to the first newly shown card', async () => {
  const h = harness();
  await h.view.update('mcu prep');
  const first = h.cards();
  await h.view.showAll();
  assert.equal(h.cards().length, 37);
  assert.deepEqual(h.cards().slice(0, 6), first);
  assert.equal(h.nodes.more.hidden, true);
  assert.equal(h.focused()?.story.lists[0], h.cards()[6]);
  await h.view.refresh();
  assert.equal(h.cards().length, 37, 'a refresh after Preview keeps the expanded group');
  await h.view.update('mcu');
  assert.equal(h.cards().length, 6, 'a new query starts collapsed again');
});

test('re-entering Search with the same query keeps the rows the reader had, collapsed or expanded', async () => {
  const h = harness();
  await h.view.update('mcu prep');
  await h.view.update('mcu prep');
  assert.equal(h.cards().length, 6);
  assert.equal(h.nodes.more.textContent, 'Show all 37 Reading Lists');
  await h.view.showAll();
  await h.view.update('mcu prep');
  assert.equal(h.cards().length, 37, 'the same query keeps Show all');
  assert.equal(h.nodes.more.hidden, true);
});

test('one match reads in the singular and needs no Show all button', async () => {
  const h = harness();
  await h.view.update('House of M');
  assert.equal(h.cards()[0].id, 'house-of-m');
  const count = h.cards().length;
  assert.equal(h.nodes.count.textContent, count === 1 ? '1 Reading List matches' : `${count} Reading Lists match`);
  assert.equal(h.nodes.more.hidden, count <= 6);
});

test('no terms hides the group, and a query with no match says so', async () => {
  const h = harness();
  await h.view.update('mcu prep');
  await h.view.update('  -- ');
  assert.equal(h.nodes.section.hidden, true);
  await h.view.update('zzqqxx');
  assert.equal(h.nodes.section.hidden, false);
  assert.equal(h.cards().length, 0);
  assert.equal(h.nodes.more.hidden, true);
  assert.equal(h.nodes.count.textContent, 'No Reading Lists match');
});

test('the count is announced once, after typing pauses, for the latest query only', async () => {
  const h = harness();
  await h.view.update('m');
  await h.view.update('mc');
  await h.view.update('mcu prep');
  assert.deepEqual(h.announced, []);
  assert.ok(h.timers.every((timer) => timer.delay === 500));
  h.flush();
  assert.deepEqual(h.announced, ['37 Reading Lists match']);
  await h.view.update('mcu prep');
  await h.view.update('');
  h.flush();
  assert.deepEqual(h.announced, ['37 Reading Lists match'], 'clearing the field cancels a pending announcement');
});

test('a slower earlier load cannot overwrite a later query', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const h = harness({ loadCatalog: () => (calls++ === 0 ? gate.then(() => catalog) : Promise.resolve(catalog)) });
  const earlier = h.view.update('mcu prep');
  await h.view.update('House of M');
  release();
  await earlier;
  assert.equal(h.cards()[0].id, 'house-of-m');
});

test('a catalog failure shows a notice in the group only, and a guide failure keeps lists findable', async () => {
  const failed = harness({ loadCatalog: async () => { throw new Error('HTTP 500'); } });
  await failed.view.update('mcu prep');
  assert.equal(failed.nodes.section.hidden, false);
  assert.equal(failed.cards().length, 0);
  assert.equal(failed.nodes.more.hidden, true);
  assert.match(failed.nodes.count.textContent, /Reading Lists could not be loaded: HTTP 500\./);
  const noGuides = harness({ loadGuides: async () => { throw new Error('offline'); } });
  await noGuides.view.update('mcu prep');
  assert.equal(noGuides.nodes.count.textContent, '37 Reading Lists match');
});

test('typing makes no network request and writes no cache, storage or history entry', async () => {
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
    for (const query of ['s', 'sp', 'spi', 'spider', 'spider-man', 'spider-man 2099', '']) await h.view.update(query);
    await h.view.update('mcu prep');
    await h.view.showAll();
    h.flush();
    assert.deepEqual(calls, []);
    assert.deepEqual(h.loads, { catalog: 7, guides: 7 }, 'only a query with terms reads the on-device loaders');
  } finally {
    for (const [key, value] of Object.entries(originals)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});
