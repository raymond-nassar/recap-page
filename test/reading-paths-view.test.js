import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveReadingPaths } from '../src/js/lib/catalog.js';

import { createReadingPathsView, readingPathProgress } from '../src/js/views/reading-paths.js';

function node(props = {}, children = []) {
  const result = {
    children: [].concat(children),
    dataset: {},
    hidden: false,
    isConnected: true,
    textContent: props.text ?? '',
    listeners: {},
    addEventListener(name, listener) { this.listeners[name] = listener; },
    setAttribute(name, value) { this[name] = value; },
    focus() { this.focused = true; },
    scrollIntoView(options) { this.scrolled = options; },
    append(...next) { this.children.push(...next); },
    replaceChildren(...next) { this.children = next; },
    ...props,
  };
  let value = props.value ?? '';
  Object.defineProperty(result, 'value', {
    get: () => value,
    set: (next) => {
      value = result.tagName === 'SELECT' && !result.children.some((option) => option.value === next)
        ? '' : next;
    },
    configurable: true,
  });
  return result;
}

const element = (tag, props = {}, children = []) => node({ tagName: tag.toUpperCase(), ...props }, children);
const list = (id) => ({
  id,
  file: `${id}.json`,
  name: id,
  description: `${id} description`,
  type: 'event',
  depth: 'essential',
  count: 1,
});
const path = (id) => ({
  id,
  name: id,
  description: `${id} description`,
  sourceOrigin: 'Compiled for this test.',
  steps: [`${id}-one`, `${id}-two`],
});

test('Reading Paths preserves selector identity and rejects stale catalog loads', async () => {
  const nodes = {
    count: node(),
    description: node(),
    details: node(),
    name: node(),
    navigation: node(),
    progressOutputs: () => [],
    select: node(),
    source: node(),
    spine: node(),
    status: node(),
  };
  const pending = [];
  const canonical = [];
  let noticeClears = 0;
  const view = createReadingPathsView({
    clearLoadNotice: () => { noticeClears += 1; },
    el: element,
    elements: () => nodes,
    getRequestedPathId: () => null,
    getState: () => ({ lists: {}, listOrder: [], read: {} }),
    isCurrent: () => true,
    loadCatalog: () => new Promise((resolve) => pending.push(resolve)),
    onCanonicalPath: (id) => canonical.push(id),
    onLoadFailure: async () => {},
    onSelectedPath: () => {},
  });

  const first = view.render();
  const second = view.render();
  pending[1]({
    paths: [path('new')],
    lists: [list('new-one'), list('new-two')],
  });
  await second;
  const options = nodes.select.children;
  pending[0]({
    paths: [path('old')],
    lists: [list('old-one'), list('old-two')],
  });
  await first;

  assert.equal(nodes.name.textContent, 'new');
  assert.equal(nodes.select.children, options);
  assert.deepEqual(canonical, ['new']);
  assert.equal(noticeClears, 2);
});

function actionFixture({ isCompleted } = {}) {
  let state = { lists: {}, listOrder: [], read: {} };
  const opened = [];
  const nodes = {
    count: node(), description: node(), details: node(), name: node(), navigation: node(),
    select: node(), source: node(), spine: node(), status: node(),
    progressOutputs: () => nodes.spine.children.map((row) => {
      const copy = row.children[1];
      const output = copy.children[2];
      output.closest = () => row;
      row.querySelector = () => copy.children[3];
      return output;
    }),
  };
  nodes.spine.querySelectorAll = () => nodes.spine.children.map((row) => row.children[1].children[3]);
  const stops = [
    list('single'),
    { ...list('main'), group: 'shared', groupName: 'Shared story' },
    { ...list('exact'), group: 'shared', groupName: 'Shared story' },
  ];
  const view = createReadingPathsView({
    clearLoadNotice: () => {}, el: element, elements: () => nodes,
    getRequestedPathId: () => 'actions', getState: () => state, isCurrent: () => true,
    isCompleted,
    loadCatalog: async () => ({
      lists: stops,
      paths: [{ ...path('actions'), steps: ['single', 'exact'] }],
    }),
    onCanonicalPath: () => {}, onLoadFailure: async (failure) => { throw failure.error; },
    onOpenStop: (stop, progress) => opened.push({ stop, progress }),
    onSelectedPath: () => {},
  });
  return {
    view, nodes, opened,
    setState: (next) => { state = next; },
    actions: () => nodes.spine.querySelectorAll(),
  };
}

test('Reading Path completion preserves exact and sibling selection with truthful read and deferred counts', () => {
  const state = {
    lists: { saved: { id: 'saved', catalogId: 'single', name: 'Saved order', itemIds: [1, 2], deferredIssueIds: [2] } },
    listOrder: ['saved'], read: { 1: 111 },
  };
  const stop = { stepId: 'single', lists: [list('single')] };
  const before = JSON.stringify(state);
  const progress = readingPathProgress(state, stop, { isCompleted: () => true });
  assert.equal(progress.state, 'done');
  assert.equal(progress.completed, true);
  assert.equal(progress.match, 'exact');
  assert.equal(progress.read, 1);
  assert.equal(progress.total, 2);
  assert.equal(progress.deferred, 1);
  const alternate = readingPathProgress(state, { ...stop, stepId: 'alternate' }, { isCompleted: () => true });
  assert.equal(alternate.match, 'sibling');
  assert.equal(alternate.read, 1);
  assert.equal(JSON.stringify(state), before);
});

test('Reading Path refresh presents explicit completion and reopens the same saved action without fake progress', async () => {
  let completed = true;
  const h = actionFixture({ isCompleted: () => completed });
  const state = {
    lists: { saved: { id: 'saved', catalogId: 'single', name: 'Saved', itemIds: [1, 2], deferredIssueIds: [2] } },
    listOrder: ['saved'], read: { 1: 111 },
  };
  h.setState(state);
  await h.view.render();
  const action = h.actions()[0];
  assert.match(h.nodes.progressOutputs()[0].textContent, /1 of 2.*1 deferred.*Marked as completed/);
  completed = false;
  h.view.refreshProgress();
  assert.equal(h.actions()[0], action);
  assert.doesNotMatch(h.nodes.progressOutputs()[0].textContent, /Marked as completed/);
  action.onclick();
  assert.equal(h.opened[0].progress.read, 1);
  assert.equal(h.opened[0].progress.total, 2);
});

test('stop actions inspect unowned stories and follow refreshed exact or sibling saved progress', async () => {
  const fixture = actionFixture();
  await fixture.view.render();
  const [single, grouped] = fixture.actions();
  assert.equal(single.textContent, 'Preview');
  assert.equal(single['aria-label'], 'Preview: single');
  assert.equal(grouped.textContent, 'Preview');
  assert.equal(grouped['aria-label'], 'Preview: exact');
  grouped.onclick();
  assert.equal(fixture.opened[0].progress, null);
  assert.deepEqual(fixture.opened[0].stop.lists.map(({ id }) => id), ['main', 'exact']);

  const saved = (id, catalogId) => ({
    id, catalogId, name: `Saved ${id}`, itemIds: [1, 2], collectedIn: {},
  });
  const state = {
    lists: { sibling: saved('sibling', 'main'), exact: saved('exact', 'exact') },
    listOrder: ['sibling', 'exact'], read: { 1: 1 },
  };
  const before = JSON.stringify(state);
  fixture.setState(state);
  fixture.view.refreshProgress();
  assert.equal(grouped, fixture.actions()[1]);
  assert.equal(grouped.textContent, 'Open saved list');
  grouped.onclick();
  assert.equal(fixture.opened[1].progress.listId, 'exact');
  assert.equal(JSON.stringify(state), before);

  fixture.setState({ ...state, lists: { sibling: state.lists.sibling }, listOrder: ['sibling'] });
  // Activation must not rely on the ownership seen by the last repaint.
  grouped.onclick();
  assert.equal(fixture.opened[2].progress.listId, 'sibling');
  fixture.view.refreshProgress();
  assert.equal(grouped.textContent, 'Open saved version');
  assert.equal(grouped['aria-label'], 'Open saved version: Saved sibling');
  assert.match(fixture.nodes.progressOutputs()[1].textContent, /Alternate reading version\.$/);

  fixture.setState({ lists: {}, listOrder: [], read: {} });
  fixture.view.refreshProgress();
  assert.equal(grouped.textContent, 'Preview');
});

test('return focus resolves the original stop only after the selected path is rendered', async () => {
  const fixture = actionFixture();
  await fixture.view.render({ opener: { pathId: 'actions', stepId: 'exact' } });
  assert.equal(fixture.actions()[1].focused, true);
  await fixture.view.render({ opener: { pathId: 'different', stepId: 'exact' } });
  assert.ok(fixture.actions().every((action) => !action.focused));
  await fixture.view.render({ opener: { pathId: 'actions', stepId: 'missing' } });
  assert.ok(fixture.actions().every((action) => !action.focused));
});

const actualCatalog = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
const actualPaths = resolveReadingPaths(actualCatalog.paths, actualCatalog.lists);

function jumpFixture(pathId = 'marvel-knights-to-planet-x') {
  const h = actionFixture();
  let state = { lists: {}, listOrder: [], read: {} };
  let active = true;
  let loader = () => Promise.resolve(actualCatalog);
  const completed = new Set();
  const focused = [];
  const view = createReadingPathsView({
    clearLoadNotice: () => {}, el: element, elements: () => h.nodes,
    getRequestedPathId: () => pathId, getState: () => state, isCurrent: () => active,
    isCompleted: (_state, id) => completed.has(id), loadCatalog: () => loader(),
    onCanonicalPath: () => {}, onLoadFailure: ({ error }) => { throw error; },
    onOpenStop: (...args) => h.opened.push(args), onSelectedPath: () => {},
  });
  view.wire();
  function form() {
    const result = h.nodes.navigation.children[0];
    assert.ok(result?.tagName === 'FORM', 'UX10 native jump form exists on the accepted path surface');
    return result;
  }
  function field() { return form().children.find((child) => child.tagName === 'SELECT'); }
  function status() { return form().children.find((child) => child.role === 'status'); }
  function submit(value, currentForm = form()) {
    const select = currentForm.children.find((child) => child.tagName === 'SELECT');
    select.value = value;
    let prevented = false;
    currentForm.onsubmit({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
  }
  function instrument() {
    for (const action of h.actions()) {
      action.focus = () => { focused.push(action.dataset.readingPathAction); action.focused = true; };
    }
  }
  function own(stop, id = stop.stepId, done = false, itemIds = [1, 2]) {
    state.lists[id] = { id, catalogId: stop.stepId, name: id, created: 2001, itemIds, collectedIn: {} };
    state.listOrder.push(id);
    if (done) completed.add(id);
  }
  return {
    ...h, view, form, field, status, submit, instrument, focused, completed, own,
    state: () => state, setState: (next) => { state = next; },
    setActive: (next) => { active = next; }, setLoader: (next) => { loader = next; },
  };
}

test('UX10 U01: the full 78-stop named jump focuses only the late action without opening or writing', async () => {
  const h = jumpFixture();
  await h.view.render();
  const form = h.form();
  const stops = h.view.selected().stops;
  assert.equal(stops.length, 78);
  assert.deepEqual(stops.map((stop) => stop.stepId),
    actualPaths.find((entry) => entry.id === 'marvel-knights-to-planet-x').stops.map((stop) => stop.stepId));
  assert.deepEqual(h.actions().map((action) => action.dataset.readingPathAction), stops.map((stop) => stop.stepId));
  assert.deepEqual(h.field().children.filter((option) => option.value.startsWith('entry:')).map((option) => option.value),
    stops.map((stop) => `entry:${stop.stepId}`));
  h.instrument();
  const before = JSON.stringify(h.state());
  h.submit(`entry:${stops[77].stepId}`);
  assert.deepEqual(h.focused, [stops[77].stepId]);
  assert.deepEqual(h.actions()[77].scrolled, { block: 'nearest', behavior: 'auto' });
  assert.equal(h.opened.length, 0);
  assert.equal(JSON.stringify(h.state()), before);
  assert.equal(h.form(), form);
});

test('UX10 U02: next unfinished uses only explicit completion, including unread, deferred and empty copies', async () => {
  const h = jumpFixture();
  await h.view.render();
  h.form(); h.instrument();
  const stops = h.view.selected().stops;
  h.submit('next-unfinished');
  assert.equal(h.focused.at(-1), stops[0].stepId);
  stops.forEach((stop, index) => h.own(stop, stop.stepId, index !== 75));
  h.state().read = { 1: 1, 2: 1 };
  h.state().lists[stops[76].stepId].deferredIssueIds = [2];
  h.state().lists[stops[76].stepId].itemIds = [3, 4];
  h.submit('next-unfinished');
  assert.equal(h.focused.at(-1), stops[75].stepId);
  h.completed.add(stops[75].stepId);
  h.completed.delete(stops[76].stepId);
  h.state().lists[stops[76].stepId].itemIds = [];
  h.submit('next-unfinished');
  assert.equal(h.focused.at(-1), stops[76].stepId);
});

test('UX10 U03: duplicate exact and catalog sibling A-E transitions preserve explicit saved identity', async () => {
  const h = jumpFixture('modern-avengers');
  await h.view.render();
  h.form(); h.instrument();
  const stops = h.view.selected().stops;
  stops.slice(0, 7).forEach((stop) => h.own(stop, stop.stepId, true));
  const copies = [
    ['ux10-hickman-first', 'hickman-minimal', false],
    ['ux10-hickman-second', 'hickman-minimal', true],
    ['ux10-hickman-full', 'hickman-full', true],
    ['ux10-hickman-doomsday', 'avengers-doomsday-secret-wars', false],
  ];
  copies.forEach(([id, catalogId, done], index) => {
    h.own({ stepId: catalogId }, id, done);
    h.state().lists[id].created = 2001 + index;
  });
  h.state().active = 'ux10-hickman-full';
  h.state().read = { 1: 1 };
  const measure = (savedId, nextIndex, label) => {
    h.view.refreshProgress();
    const progress = readingPathProgress(h.state(), stops[7], { isCompleted: (_state, id) => h.completed.has(id) });
    assert.equal(progress?.listId ?? null, savedId);
    assert.equal(h.actions()[7].textContent, label);
    if (progress) { assert.equal(progress.read, 1); assert.equal(progress.total, 2); }
    const before = JSON.stringify(h.state());
    h.submit('next-unfinished');
    assert.equal(h.focused.at(-1), stops[nextIndex].stepId);
    assert.equal(JSON.stringify(h.state()), before);
  };
  const remove = (id) => {
    delete h.state().lists[id];
    h.state().listOrder = h.state().listOrder.filter((entry) => entry !== id);
  };
  measure('ux10-hickman-first', 7, 'Open saved list');
  remove('ux10-hickman-first'); measure('ux10-hickman-second', 8, 'Open saved list');
  remove('ux10-hickman-second'); measure('ux10-hickman-full', 8, 'Open saved version');
  h.completed.delete('ux10-hickman-full'); measure('ux10-hickman-full', 7, 'Open saved version');
  remove('ux10-hickman-full'); remove('ux10-hickman-doomsday'); measure(null, 7, 'Preview');
});

test('UX10 U04: all-complete, unknown, reopened and removed imports resolve live without rebuilding focus', async () => {
  const h = jumpFixture();
  await h.view.render();
  const form = h.form(); h.instrument();
  const stops = h.view.selected().stops;
  stops.forEach((stop) => h.own(stop, stop.stepId, true));
  h.submit('next-unfinished');
  assert.match(h.status().textContent, /All displayed stops are marked as completed/);
  assert.equal(h.focused.length, 0);
  h.completed.clear();
  h.submit('next-unfinished');
  assert.equal(h.focused.at(-1), stops[0].stepId);
  stops.forEach((stop) => h.completed.add(stop.stepId));
  h.completed.delete(stops[75].stepId);
  h.submit('next-unfinished');
  assert.equal(h.focused.at(-1), stops[75].stepId);
  delete h.state().lists[stops[0].stepId];
  h.state().listOrder.shift();
  const action = h.actions()[75];
  h.view.refreshProgress();
  assert.equal(h.form(), form); assert.equal(h.actions()[75], action); assert.equal(action.focused, true);
  h.submit('next-unfinished');
  assert.equal(h.focused.at(-1), stops[0].stepId);
});

test('UX10 U05: stale, disconnected and invalid native choices never fall back or focus another path', async () => {
  const h = jumpFixture();
  await h.view.render();
  const old = h.form(); h.instrument();
  const id = h.view.selected().stops[77].stepId;
  h.submit('unknown-value');
  assert.equal(h.field().value, '');
  assert.match(h.status().textContent, /Choose/);
  h.field().append(element('option', { value: 'entry:missing', text: 'Missing' }));
  h.submit('entry:missing');
  assert.match(h.status().textContent, /no longer available/);
  h.field().children.pop();
  h.actions()[77].isConnected = false;
  h.submit(`entry:${id}`);
  assert.match(h.status().textContent, /no longer available/);
  h.actions()[77].isConnected = true;
  const removed = h.nodes.spine.children.pop();
  h.submit(`entry:${id}`);
  assert.match(h.status().textContent, /no longer available/);
  h.nodes.spine.children.push(removed);
  h.setActive(false); h.submit(`entry:${id}`); h.setActive(true);
  assert.equal(h.focused.length, 0);
  h.nodes.select.listeners.change({ target: { value: 'modern-avengers' } });
  h.submit(`entry:${id}`, old);
  assert.equal(h.focused.length, 0);
  const latest = h.form();
  let resolve;
  h.setLoader(() => new Promise((done) => { resolve = done; }));
  const loading = h.view.render();
  h.submit(`entry:${h.view.selected().stops[0].stepId}`, latest);
  assert.equal(h.focused.length, 0);
  resolve(actualCatalog); await loading;
  h.instrument();
  h.submit(`entry:${id}`);
  assert.deepEqual(h.focused, [id]);
});
