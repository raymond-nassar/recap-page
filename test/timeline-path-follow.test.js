import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseCatalog, resolveReadingPaths } from '../src/js/lib/catalog.js';
import { createCatalogView, followedPathPosition } from '../src/js/views/catalog.js';

// #897 retired the Reading paths page and moved following a path onto Modern Timeline. The page's
// own checks are carried here onto the Timeline's follow mode, one for one: a single path selector
// that no stale catalog load can repaint, each stop counted and drawn by the same saved copy, a
// refresh that repaints progress without rebuilding a control, and the page's jump to any stop or
// to the next unfinished one (UX10 U01 to U05). Run against the shipped catalog, so the 78 stop path
// is the real one.

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
    querySelectorAll() { return []; },
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
const actual = parseCatalog(JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8')));
const actualPaths = resolveReadingPaths(actual.paths, actual.lists);
const pathOf = (id) => actualPaths.find((path) => path.id === id);

function harness(pathId = 'marvel-knights-to-planet-x') {
  let state = { lists: {}, listOrder: [], read: {} };
  let active = true;
  let loader = () => Promise.resolve(actual);
  const completed = new Set();
  const focused = [];
  const paints = [];
  const shelf = { clear: node(), filters: node(), query: node(), results: node(), search: node() };
  const follow = { wrap: node(), select: element('select'), about: node(), description: node(), source: node() };
  const view = createCatalogView({
    announce: () => {},
    clearLoadNotice: () => {},
    el: element,
    elements: {
      shelf: () => shelf, spotlightKinds: () => [], spotlightSorts: () => [], follow: () => follow,
    },
    getState: () => state,
    isCurrent: (key) => active && key === 'catalog',
    isCompleted: (_state, id) => completed.has(id),
    loadCatalog: () => loader(),
    notifyDropped: () => {},
    onLoadFailure: ({ error }) => { throw error; },
    onSortChange: () => {},
    presentation: {
      catalogCard: (entry) => {
        const id = entry.lists[0].id;
        const title = element('h2', {
          class: 'catalog-card-title', text: entry.lists[0].name, focus() { focused.push(id); },
        });
        return element('article', {
          dataset: { story: entry.key },
          reading: id,
          title,
          querySelector: (selector) => (selector === '.catalog-card-title' ? title : null),
        }, [title]);
      },
      chosenPath: () => null,
      ensureSetupGuideFeature: () => {},
      paintTimelinePosition: (_root, position) => paints.push(position),
      renderTimelineSections: () => {},
    },
  });
  view.wire('catalog');
  view.setFollowedPath(pathId);
  const form = () => {
    const wrap = shelf.results.children.find((child) => child.class === 'path-jump');
    assert.ok(wrap?.children[0]?.tagName === 'FORM', 'the jump form is drawn above the followed path');
    return wrap.children[0];
  };
  const field = (current = form()) => current.children.find((child) => child.tagName === 'SELECT');
  const status = () => form().children.find((child) => child.role === 'status');
  const cards = () => shelf.results.children.find((child) => child.tagName === 'OL')
    .children.map((item) => item.children[2]);
  function submit(value, current = form()) {
    field(current).value = value;
    let prevented = false;
    current.onsubmit({ preventDefault: () => { prevented = true; } });
    assert.equal(prevented, true);
  }
  function own(stop, id = stop.stepId, done = false, itemIds = [1, 2]) {
    state.lists[id] = { id, catalogId: stop.stepId, name: id, created: 2001, itemIds, collectedIn: {} };
    state.listOrder.push(id);
    if (done) completed.add(id);
  }
  return {
    view, follow, shelf, paints, focused, completed, form, field, status, cards, submit, own,
    state: () => state,
    setState: (next) => { state = next; },
    setActive: (next) => { active = next; },
    setLoader: (next) => { loader = next; },
  };
}

test('following a path keeps one path selector and lets no stale catalog load repaint it', async () => {
  const h = harness('modern-avengers');
  const pending = [];
  h.setLoader(() => new Promise((resolve) => pending.push(resolve)));
  const first = h.view.render('catalog');
  const second = h.view.render('catalog');
  pending[1](actual);
  await second;
  const options = h.follow.select.children;
  const drawn = h.shelf.results.children;
  pending[0]({ ...actual, paths: [] });
  await first;
  assert.equal(h.view.followedPath(), 'modern-avengers', 'a stale load naming no paths lets nothing go');
  assert.equal(h.follow.select.value, 'modern-avengers');
  assert.equal(h.shelf.results.children, drawn, 'nothing is redrawn by the stale load');
  h.setLoader(() => Promise.resolve(actual));
  await h.view.render('catalog');
  assert.equal(h.follow.select.children, options, 'the same paths keep the same options');
  assert.deepEqual(options.map((option) => option.value), ['', ...actualPaths.map((path) => path.id)]);
});

test('a stop is counted by its exact copy, else a saved sibling, and deferred unread never finishes it', () => {
  const state = {
    lists: { saved: { id: 'saved', catalogId: 'single', name: 'Saved order', itemIds: [1, 2], deferredIssueIds: [2] } },
    listOrder: ['saved'], read: { 1: 111 },
  };
  const single = { id: 'single', name: 'Single' };
  const before = JSON.stringify(state);
  const exact = [{ key: 'list:single', name: 'Single', lists: [single] }];
  assert.equal(followedPathPosition(state, exact).kind, 'current', 'one of two read, one deferred, is unfinished');
  assert.deepEqual(followedPathPosition(state, exact, { isCompleted: () => true }), { kind: 'complete', completed: 1, total: 1 });
  const sibling = [{ key: 'alternate', name: 'Alternate', lists: [{ id: 'alternate', name: 'Alternate' }, single] }];
  assert.equal(followedPathPosition(state, sibling).storyKey, 'list:single', 'the saved sibling is the one counted');
  assert.deepEqual(followedPathPosition(state, sibling, { isCompleted: () => true }), { kind: 'complete', completed: 1, total: 1 });
  assert.equal(JSON.stringify(state), before);
});

test('a refresh repaints an explicit completion without rebuilding a stop or the jump', async () => {
  const h = harness('modern-avengers');
  const stops = pathOf('modern-avengers').stops;
  stops.forEach((stop) => h.own(stop, stop.stepId, true));
  await h.view.render('catalog');
  assert.equal(h.paints.at(-1).kind, 'complete');
  const cards = h.cards();
  const form = h.form();
  h.completed.delete(stops[3].stepId);
  h.view.refreshProgress();
  assert.deepEqual(h.paints.at(-1), {
    kind: 'current', storyKey: `list:${stops[3].stepId}`, storyName: h.paints.at(-1).storyName, stop: 4, completed: 9, total: 10,
  });
  assert.equal(h.form(), form);
  assert.deepEqual(h.cards(), cards);
});

test('each stop is drawn as the reading it is counted by: the one the path names, else a saved sibling', async () => {
  const h = harness('modern-avengers');
  const stop = pathOf('modern-avengers').stops[7];
  assert.equal(stop.stepId, 'hickman-minimal');
  const sibling = stop.lists.find((list) => list.id !== stop.stepId).id;
  const drawn = async () => {
    await h.view.render('catalog');
    return h.cards()[7].reading;
  };
  assert.equal(await drawn(), 'hickman-minimal', 'with nothing saved, the reading the path names');
  h.own({ stepId: sibling }, 'sibling-copy');
  h.own(stop, 'exact-copy');
  const before = JSON.stringify(h.state());
  assert.equal(await drawn(), 'hickman-minimal', 'its own saved copy before an earlier sibling');
  delete h.state().lists['exact-copy'];
  h.state().listOrder = ['sibling-copy'];
  assert.equal(await drawn(), sibling, 'a saved sibling when the named reading is not saved');
  h.setState({ lists: {}, listOrder: [], read: {} });
  assert.equal(await drawn(), 'hickman-minimal');
  assert.equal(before.includes('exact-copy'), true, 'drawing a stop writes nothing');
});

test('UX10 U01: the full 78-stop named jump focuses only the late stop without opening or writing', async () => {
  const h = harness();
  await h.view.render('catalog');
  const form = h.form();
  const stops = pathOf('marvel-knights-to-planet-x').stops;
  assert.equal(stops.length, 78);
  assert.deepEqual(h.cards().map((card) => card.reading), stops.map((stop) => stop.stepId));
  assert.deepEqual(h.field().children.filter((option) => option.value.startsWith('entry:')).map((option) => option.value),
    stops.map((stop) => `entry:${stop.stepId}`));
  const before = JSON.stringify(h.state());
  const completedBefore = [...h.completed];
  h.submit(`entry:${stops[77].stepId}`);
  assert.deepEqual(h.focused, [stops[77].stepId]);
  assert.deepEqual(h.cards()[77].title.scrolled, { block: 'nearest', behavior: 'auto' });
  assert.equal(h.cards()[77].title.tabindex, '-1');
  // UX10's contract, kept by the decision of 2026-10-26 on #897: a jump opens no list, switches no
  // saved version, changes no progress, saves no destination and marks nothing completed.
  assert.equal(JSON.stringify(h.state()), before);
  assert.deepEqual([...h.completed], completedBefore);
  assert.equal(h.form(), form);
});

// The Timeline counts a stop finished when its copy is marked completed or fully read, and the
// jump's next unfinished stop is the one it marks You are here, so the screen answers one way.
test('UX10 U02: next unfinished keeps unread, deferred and empty copies, as You are here does', async () => {
  const h = harness();
  await h.view.render('catalog');
  const stops = pathOf('marvel-knights-to-planet-x').stops;
  h.submit('next-unfinished');
  assert.equal(h.focused.at(-1), stops[0].stepId);
  stops.forEach((stop, index) => h.own(stop, stop.stepId, index !== 75, [100 + index]));
  h.submit('next-unfinished');
  assert.equal(h.focused.at(-1), stops[75].stepId, 'an unread copy');
  h.state().lists[stops[75].stepId].deferredIssueIds = [175];
  h.submit('next-unfinished');
  assert.equal(h.focused.at(-1), stops[75].stepId, 'a copy whose unread issue is deferred');
  h.state().lists[stops[75].stepId].itemIds = [];
  h.submit('next-unfinished');
  assert.equal(h.focused.at(-1), stops[75].stepId, 'an empty copy');
  const position = followedPathPosition(h.state(), stops.map((stop) => ({ key: stop.key, name: stop.name, lists: stop.lists })), {
    isCompleted: (_state, id) => h.completed.has(id),
  });
  assert.equal(position.stop, 76, 'You are here marks the same stop');
  h.state().lists[stops[75].stepId].itemIds = [175];
  h.state().read[175] = 1;
  const focused = h.focused.length;
  h.submit('next-unfinished');
  assert.equal(h.status().textContent, 'All displayed stops are complete.', 'a fully read copy is finished');
  assert.equal(h.focused.length, focused);
});

test('UX10 U03: duplicate exact and catalog sibling A-E transitions keep the counted saved copy', async () => {
  const h = harness('modern-avengers');
  await h.view.render('catalog');
  const stops = pathOf('modern-avengers').stops;
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
  const measure = async (reading, nextIndex) => {
    const before = JSON.stringify(h.state());
    h.submit('next-unfinished');
    assert.equal(h.focused.at(-1), h.cards()[nextIndex].reading, `next unfinished is stop ${nextIndex + 1}`);
    assert.equal(JSON.stringify(h.state()), before);
    await h.view.render('catalog');
    assert.equal(h.cards()[7].reading, reading);
  };
  const remove = (id) => {
    delete h.state().lists[id];
    h.state().listOrder = h.state().listOrder.filter((entry) => entry !== id);
  };
  await measure('hickman-minimal', 7);
  remove('ux10-hickman-first'); await measure('hickman-minimal', 8);
  remove('ux10-hickman-second'); await measure('hickman-full', 8);
  h.completed.delete('ux10-hickman-full'); await measure('hickman-full', 7);
  remove('ux10-hickman-full'); remove('ux10-hickman-doomsday'); await measure('hickman-minimal', 7);
});

// A save in another tab repaints the place without redrawing a stop, so when it counts a stop by
// another of its readings, the stop keeps its drawn card and You are here stays on it, named as the
// card is, rather than reading as a stop a search has hidden.
test('a stop counted by another reading after a save elsewhere keeps its place on its drawn card', async () => {
  const h = harness('modern-avengers');
  const stops = pathOf('modern-avengers').stops;
  stops.slice(0, 7).forEach((stop) => h.own(stop, stop.stepId, true));
  h.own({ stepId: 'hickman-minimal' }, 'minimal-copy');
  h.own({ stepId: 'hickman-full' }, 'full-copy');
  await h.view.render('catalog');
  const drawn = h.cards()[7];
  assert.equal(drawn.reading, 'hickman-minimal');
  assert.equal(h.paints.at(-1).storyKey, 'list:hickman-minimal');
  delete h.state().lists['minimal-copy'];
  h.state().listOrder = h.state().listOrder.filter((id) => id !== 'minimal-copy');
  const paints = h.paints.length;
  assert.equal(h.view.refreshProgress(), false, 'the place has not moved, so nothing is repainted');
  assert.equal(h.paints.length, paints);
  assert.equal(h.paints.at(-1).storyKey, 'list:hickman-minimal');
  assert.equal(h.cards()[7], drawn, 'the stop is not redrawn');
  h.completed.add('full-copy');
  assert.equal(h.view.refreshProgress(), true);
  assert.deepEqual(h.paints.at(-1), {
    kind: 'current', storyKey: `list:${stops[8].stepId}`, storyName: h.cards()[8].title.textContent, stop: 9, completed: 8, total: 10,
  }, 'finishing the stop by its other reading moves the place on');
});

test('UX10 U04: all-complete, reopened and removed copies resolve live without rebuilding the jump', async () => {
  const h = harness();
  await h.view.render('catalog');
  const form = h.form();
  const stops = pathOf('marvel-knights-to-planet-x').stops;
  stops.forEach((stop) => h.own(stop, stop.stepId, true));
  h.submit('next-unfinished');
  assert.equal(h.status().textContent, 'All displayed stops are complete.');
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
  h.view.refreshProgress();
  assert.equal(h.form(), form);
  h.submit('next-unfinished');
  assert.equal(h.focused.at(-1), stops[0].stepId);
});

test('UX10 U05: stale, disconnected and invalid jump choices never fall back or focus another path', async () => {
  const h = harness();
  await h.view.render('catalog');
  const old = h.form();
  const stops = pathOf('marvel-knights-to-planet-x').stops;
  const id = stops[77].stepId;
  h.submit('unknown-value');
  assert.equal(h.field().value, '');
  assert.match(h.status().textContent, /Choose/);
  h.field().append(element('option', { value: 'entry:missing', text: 'Missing' }));
  h.submit('entry:missing');
  assert.match(h.status().textContent, /no longer available/);
  h.field().children.pop();
  h.cards()[77].title.isConnected = false;
  h.submit(`entry:${id}`);
  assert.match(h.status().textContent, /no longer available/);
  h.cards()[77].title.isConnected = true;
  h.setActive(false); h.submit(`entry:${id}`); h.setActive(true);
  assert.equal(h.focused.length, 0);
  h.follow.select.value = 'modern-avengers';
  h.follow.select.listeners.change();
  await new Promise((resolve) => setImmediate(resolve));
  h.submit(`entry:${id}`, old);
  assert.equal(h.focused.length, 0, 'the jump of the path left behind moves nothing');
  const latest = h.form();
  let resolve;
  h.setLoader(() => new Promise((done) => { resolve = done; }));
  const loading = h.view.render('catalog');
  h.submit(`entry:${pathOf('modern-avengers').stops[0].stepId}`, latest);
  assert.equal(h.focused.length, 0, 'nor does one drawn before a render that has not finished');
  resolve(actual);
  await loading;
  h.submit(`entry:${pathOf('modern-avengers').stops[9].stepId}`);
  assert.deepEqual(h.focused, [pathOf('modern-avengers').stops[9].stepId]);
});
