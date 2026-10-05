import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createPreviewView } from '../src/js/views/preview.js';
import { createCatalogView } from '../src/js/views/catalog.js';

const mainSource = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
const list = { id: 'guide', file: 'guide.json', name: 'Guide', count: 1, depth: 'essential' };
const order = { items: [{ issueId: 1, title: 'One' }] };
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};

function node(props = {}, children = []) {
  return {
    children: [].concat(children), listeners: {}, open: false,
    addEventListener(name, listener) { this.listeners[name] = listener; },
    append(...next) { this.children.push(...next); },
    replaceChildren(...next) { this.children = next; },
    querySelectorAll() { return []; },
    showModal() { this.open = true; },
    ...props,
  };
}

function harness(t, { loadOrder = async () => order, onAdd, onClose } = {}) {
  const prior = globalThis.document;
  const document = { body: {}, activeElement: null };
  globalThis.document = document;
  t.after(() => { if (prior === undefined) delete globalThis.document; else globalThis.document = prior; });
  const nodes = Object.fromEntries(
    ['add', 'body', 'close', 'description', 'dialog', 'heading', 'meta', 'paths', 'source']
      .map((key) => [key, node()]),
  );
  const timers = [];
  t.mock.method(globalThis, 'setTimeout', (fn) => { timers.push(fn); return timers.length; });
  let state = { lists: {}, listOrder: [] };
  const calls = { added: 0, closed: [], failures: [], focusedIssues: [], opened: [], restored: [] };
  const view = createPreviewView({
    captureFocus: (container) => ({ container }),
    el: (_tag, props, children) => node(props, children),
    elements: () => nodes,
    getState: () => state,
    isInLibrary: (id) => Object.values(state.lists).find((saved) => saved.catalogId === id) ?? null,
    issueFocusAnchor: (issue) => { calls.focusedIssues.push(issue.issueId); return node(); },
    loadOrder,
    onAdd: async (...args) => {
      calls.added += 1;
      if (onAdd) return onAdd(...args);
      state = { lists: { saved: { id: 'saved', catalogId: list.id } }, listOrder: ['saved'] };
      return 'saved';
    },
    onClose: async (closedList, options) => {
      calls.closed.push({ list: closedList, options });
      if (onClose) await onClose(closedList, options);
    },
    onIssueLoadFailure: async (failure) => { calls.failures.push(failure); },
    onOpen: (...args) => calls.opened.push(args),
    presentation: { attributionLine: () => null },
    restoreFocus: (held, options) => calls.restored.push({ held, options }),
  });
  view.wire();
  const close = async () => { nodes.dialog.open = false; await nodes.dialog.listeners.close(); };
  const pressAdd = () => {
    const button = nodes.add.children[0];
    return button.onclick({ currentTarget: button });
  };
  return { calls, close, document, nodes, pressAdd, setState: (next) => { state = next; }, timers, view };
}

test('Preview no-change dismissal leaves its source card and focus intact', async (t) => {
  const anchor = { connected: true };
  let redraws = 0;
  const h = harness(t, {
    onClose: (_closed, { changed = true } = {}) => {
      if (changed) {
        redraws += 1;
        anchor.connected = false;
        h.document.activeElement = h.document.body;
      }
    },
  });
  h.document.activeElement = anchor;
  await h.view.open(list);
  await h.close();
  assert.equal(redraws, 0);
  assert.equal(anchor.connected, true);
  assert.equal(h.document.activeElement, anchor);
  assert.equal(h.calls.closed.length, 1, 'dismissal still notifies the notice-placement owner');
  assert.equal(h.calls.closed[0].options.changed, false);
});

test('Preview refreshes a real Add and preserves its Open and focus behavior', async (t) => {
  const h = harness(t);
  await h.view.open(list);
  h.document.activeElement = h.document.body;
  await h.pressAdd();
  assert.equal(h.calls.added, 1);
  assert.equal(h.calls.restored.length, 1);
  h.timers[0]();
  const open = h.nodes.add.children[0];
  assert.equal(open.children[0], 'Open \u2192');
  open.onclick();
  assert.deepEqual(h.calls.opened.map(([entry, saved]) => [entry.id, saved.id]), [['guide', 'saved']]);
  await h.close();
  assert.equal(h.calls.closed[0].options.changed, true);
  assert.equal(h.calls.closed[0].options.isCurrent(), true);
});

test('a failed Preview Add retains its focus recovery without requesting a repaint', async (t) => {
  const h = harness(t, { onAdd: async () => null });
  await h.view.open(list);
  h.document.activeElement = h.document.body;
  await h.pressAdd();
  assert.equal(h.calls.restored.length, 1);
  assert.equal(h.nodes.add.children[0].children[0], '+ Add to library');
  await h.close();
  assert.equal(h.calls.closed[0].options.changed, false);
});

test('Preview observes external library and saved-order changes while open', async (t) => {
  const h = harness(t);
  await h.view.open(list);
  h.setState({ lists: {}, listOrder: ['external'] });
  await h.close();
  assert.equal(h.calls.closed[0].options.changed, true);
});

test('an existing Preview Open keeps its exact list identity and does not Add', async (t) => {
  const h = harness(t);
  const saved = { id: 'existing', catalogId: list.id };
  h.setState({ lists: { existing: saved }, listOrder: ['existing'] });
  await h.view.open(list);
  assert.equal(h.nodes.add.children[0].onclick(), 1);
  assert.equal(h.calls.added, 0);
  assert.deepEqual(h.calls.opened, [[list, saved]]);
  await h.close();
  assert.equal(h.calls.closed[0].options.changed, false);
});

test('a real Add completing after dismissal requests its source refresh once', async (t) => {
  let pending = deferred();
  const h = harness(t, { onAdd: () => pending.promise });
  await h.view.open(list);
  const adding = h.pressAdd();
  await h.close();
  h.setState({ lists: { saved: { id: 'saved', catalogId: list.id } }, listOrder: ['saved'] });
  pending.resolve('saved');
  await adding;
  assert.deepEqual(h.calls.closed.map(({ options }) => options.changed), [false, true]);
  assert.equal(h.calls.restored.length, 0);

  pending = deferred();
  await h.view.open({ ...list, id: 'other', file: 'other.json' });
  const secondAdd = h.pressAdd();
  h.setState({ lists: { other: { id: 'other-saved', catalogId: 'other' } }, listOrder: ['other-saved'] });
  await h.close();
  pending.resolve('other-saved');
  await secondAdd;
  assert.deepEqual(h.calls.closed.map(({ options }) => options.changed), [false, true, true]);
});

test('Preview refreshes distinct close revisions without stale render or focus', async (t) => {
  let pendingAdd = deferred();
  const firstRefresh = deferred();
  let revision = 'initial';
  const painted = [];
  const focused = [];
  const h = harness(t, {
    onAdd: () => pendingAdd.promise,
    onClose: (...args) => closeOwner(...args),
  });
  h.document.activeElement = h.document.body;
  const closeOwner = mainClose({
    view: 'catalog',
    placeNotices: () => {},
    CATALOG_SHELVES: [{ key: 'catalog' }],
    generatedCategoryByRoute: new Map(),
    $: () => node(),
    captureFocus: () => ({ revision }),
    document: h.document,
    restoreFocus: (held) => focused.push(held.revision),
    catalogView: {
      render: async (_key, { isCurrent }) => {
        const renderingRevision = revision;
        if (renderingRevision === 'external') await firstRefresh.promise;
        if (isCurrent()) painted.push(renderingRevision);
      },
    },
  });
  await h.view.open(list);
  const adding = h.pressAdd();
  revision = 'external';
  h.setState({ lists: { external: { id: 'external' } }, listOrder: ['external'] });
  const closing = h.close();
  try {
    assert.equal(h.calls.closed.length, 1);
    const externalCurrent = h.calls.closed[0].options.isCurrent;
    revision = 'late-add';
    h.setState({
      lists: { external: { id: 'external' }, saved: { id: 'saved', catalogId: list.id } },
      listOrder: ['external', 'saved'],
    });
    assert.equal(externalCurrent(), false, 'a newer library revision immediately invalidates the older notification');
    pendingAdd.resolve('saved');
    await adding;
    assert.equal(h.calls.closed.length, 2, 'the late Add must request its distinct changed refresh');
    assert.deepEqual(h.calls.closed.map(({ options }) => options.changed), [true, true]);
    assert.equal(h.calls.closed[1].options.isCurrent(), true);
    firstRefresh.resolve();
    await closing;
    assert.deepEqual(painted, ['late-add']);
    assert.deepEqual(focused, ['late-add']);

    pendingAdd = deferred();
    await h.view.open({ ...list, id: 'other', file: 'other.json' });
    const sameRevisionAdd = h.pressAdd();
    revision = 'already-committed';
    h.setState({ lists: { other: { id: 'other', catalogId: 'other' } }, listOrder: ['other'] });
    await h.close();
    pendingAdd.resolve('other');
    await sameRevisionAdd;
    assert.equal(h.calls.closed.length, 3, 'the already-refreshed identical revision is notified once');
    assert.deepEqual(painted, ['late-add', 'already-committed']);
    assert.deepEqual(focused, ['late-add', 'already-committed']);
  } finally {
    pendingAdd.resolve('saved');
    firstRefresh.resolve();
    await Promise.all([adding, closing]);
  }
});

test('dismissal invalidates a pending Preview issue response', async (t) => {
  const pending = deferred();
  const h = harness(t, { loadOrder: () => pending.promise });
  const opening = h.view.open(list);
  await h.close();
  pending.resolve(order);
  await opening;
  assert.deepEqual(h.calls.focusedIssues, []);
  assert.equal(h.calls.failures.length, 0);
});

test('navigation invalidates Preview load failure and delayed Add focus work', async (t) => {
  const pending = deferred();
  const pendingAdd = deferred();
  let response = pending.promise;
  const h = harness(t, { loadOrder: () => response, onAdd: () => pendingAdd.promise });
  const opening = h.view.open(list);
  h.view.invalidate();
  pending.reject(new Error('Old request'));
  await opening;
  await h.close();
  assert.equal(h.calls.failures.length, 0);
  assert.equal(h.calls.closed.length, 0);

  response = Promise.resolve(order);
  await h.view.open(list);
  const adding = h.pressAdd();
  h.view.invalidate();
  h.setState({ lists: { saved: { id: 'saved', catalogId: list.id } }, listOrder: ['saved'] });
  pendingAdd.resolve('saved');
  await adding;
  assert.equal(h.calls.closed.length, 0);
  assert.equal(h.calls.restored.length, 0);
  assert.equal(h.timers.length, 0);
});

test('a newer Preview invalidates an older close completion and Add timer', async (t) => {
  const h = harness(t);
  await h.view.open(list);
  await h.pressAdd();
  await h.close();
  const oldCurrent = h.calls.closed[0].options.isCurrent;
  await h.view.open({ ...list, id: 'other', file: 'other.json' });
  const add = h.nodes.add.children[0];
  const restored = h.calls.restored.length;
  h.timers[0]();
  assert.equal(oldCurrent(), false);
  assert.equal(h.nodes.add.children[0], add);
  assert.equal(h.calls.restored.length, restored);
});

function mainClose(context) {
  const start = mainSource.indexOf('  onClose: async ');
  const end = mainSource.indexOf('\n  onIssueLoadFailure:', start);
  assert.ok(start >= 0 && end > start);
  const expression = mainSource.slice(start + '  onClose: '.length, end).trim().replace(/,$/, '');
  return runInNewContext(`(${expression})`, context);
}

test('the real close owner keeps notice placement but skips a no-change repaint', async () => {
  let notices = 0;
  const close = mainClose({
    placeNotices: () => { notices += 1; },
    CATALOG_SHELVES: [{ key: 'catalog' }],
    generatedCategoryByRoute: new Map(),
    view: 'catalog',
    $: () => assert.fail('No-change dismissal must not look up or replace a source card'),
  });
  await close(list, { changed: false, isCurrent: () => true });
  assert.equal(notices, 1);
});

test('the real close owner does not restore focus after navigation during refresh', async () => {
  const pending = deferred();
  let current = true;
  let restored = 0;
  const context = {
    placeNotices: () => {},
    CATALOG_SHELVES: [{ key: 'catalog' }],
    generatedCategoryByRoute: new Map(),
    view: 'catalog',
    $: () => node(),
    captureFocus: () => ({}),
    catalogView: { render: () => pending.promise },
    document: { body: {}, activeElement: null },
    restoreFocus: () => { restored += 1; },
  };
  context.document.activeElement = context.document.body;
  const closing = mainClose(context)(list, { changed: true, isCurrent: () => current });
  current = false;
  context.view = 'library';
  pending.resolve();
  await closing;
  assert.equal(restored, 0);
});

test('publishing refresh ignores stale success and failure after navigation', async () => {
  const start = mainSource.indexOf('async function renderPublishingCategory(');
  const end = mainSource.indexOf('\nfunction renderAll()', start);
  assert.ok(start >= 0 && end > start);
  for (const rejected of [false, true]) {
    const pending = deferred();
    const box = node();
    const periods = node();
    let reports = 0;
    let current = true;
    const context = {
      view: 'age-early-modern',
      publishingCategoryGeneration: 0,
      generatedCategoryByRoute: new Map([['age-early-modern', { route: 'age-early-modern' }]]),
      $: (selector) => selector.endsWith('-results') ? box : periods,
      el: (_tag, props) => node(props),
      clearNotice: () => {},
      CATALOG_LOAD: 'catalog',
      loadCatalog: () => pending.promise,
      reportBundledLoadFailure: () => { reports += 1; },
    };
    const render = runInNewContext(`(${mainSource.slice(start, end)})`, context);
    const rendering = render('age-early-modern', { isCurrent: () => current });
    const loading = box.children[0];
    current = false;
    context.view = 'library';
    if (rejected) pending.reject(new Error('Stale failure'));
    else pending.resolve({ lists: [] });
    await rendering;
    assert.equal(box.children[0], loading);
    assert.equal(reports, 0);
  }
});

test('a catalog refresh obeys its close owner cancellation after an awaited load', async () => {
  const pending = deferred();
  const nodes = { clear: node(), filters: node(), query: node(), results: node(), search: node() };
  let current = true;
  let reports = 0;
  const view = createCatalogView({
    announce: () => {}, clearLoadNotice: () => {},
    el: (_tag, props) => node(props),
    elements: { shelf: () => nodes },
    loadCatalog: () => pending.promise,
    notifyDropped: () => {},
    onLoadFailure: () => { reports += 1; },
    onSortChange: () => {},
    presentation: {},
  });
  const rendering = view.render('lines', { isCurrent: () => current });
  const loading = nodes.results.children[0];
  current = false;
  pending.resolve({ lists: [], paths: [] });
  await rendering;
  assert.equal(nodes.results.children[0], loading);
  assert.equal(reports, 0);
});
