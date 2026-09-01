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
