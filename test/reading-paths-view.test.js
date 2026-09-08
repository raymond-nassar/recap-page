import test from 'node:test';
import assert from 'node:assert/strict';

import { createReadingPathsView } from '../src/js/views/reading-paths.js';

function node(props = {}, children = []) {
  return {
    children: [].concat(children),
    dataset: {},
    hidden: false,
    listeners: {},
    value: '',
    addEventListener(name, listener) { this.listeners[name] = listener; },
    setAttribute(name, value) { this[name] = value; },
    focus() { this.focused = true; },
    replaceChildren(...next) { this.children = next; },
    ...props,
  };
}

const element = (_tag, props = {}, children = []) => node(props, children);
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

function actionFixture() {
  let state = { lists: {}, listOrder: [], read: {} };
  const opened = [];
  const nodes = {
    count: node(), description: node(), details: node(), name: node(),
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

test('stop actions inspect unowned stories and follow refreshed exact or sibling saved progress', async () => {
  const fixture = actionFixture();
  await fixture.view.render();
  const [single, grouped] = fixture.actions();
  assert.equal(single.textContent, 'Preview');
  assert.equal(single['aria-label'], 'Preview: single');
  assert.equal(grouped.textContent, 'Choose reading option');
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
  assert.equal(grouped.textContent, 'Choose reading option');
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
