import test from 'node:test';
import assert from 'node:assert/strict';

import { createPreviewView } from '../src/js/views/preview.js';

function node(props = {}, children = []) {
  return {
    children: [].concat(children),
    listeners: {},
    open: false,
    addEventListener(name, listener) { this.listeners[name] = listener; },
    close() { this.open = false; },
    replaceChildren(...next) { this.children = next; },
    showModal() { this.open = true; },
    ...props,
  };
}

const element = (_tag, props = {}, children = []) => node(props, children);
const list = (id) => ({
  id,
  name: `List ${id}`,
  description: '',
  count: 1,
  depth: 'essential',
});

test('Preview rejects an older issue response after a newer selection opens', async () => {
  globalThis.document = { activeElement: null, body: {} };
  const nodes = {
    add: node(),
    body: node(),
    close: node(),
    description: node(),
    dialog: node(),
    heading: node(),
    meta: node(),
    paths: node(),
  };
  const pending = new Map();
  const focused = [];
  const view = createPreviewView({
    captureFocus: () => null,
    el: element,
    elements: () => nodes,
    isInLibrary: () => null,
    issueFocusAnchor: (issue) => {
      focused.push(issue.issueId);
      return node();
    },
    loadOrder: (file) => new Promise((resolve) => pending.set(file, resolve)),
    onAdd: async () => null,
    onClose: async () => {},
    onIssueLoadFailure: async () => {},
    onOpen: () => {},
    presentation: { markOwnedPaths: () => {}, pathChooser: () => node() },
    restoreFocus: () => {},
  });

  const first = view.open({ ...list('one'), file: 'one.json' });
  const second = view.open({ ...list('two'), file: 'two.json' });
  pending.get('two.json')({ items: [{ issueId: 2, title: 'Two' }] });
  await second;
  pending.get('one.json')({ items: [{ issueId: 1, title: 'One' }] });
  await first;

  assert.deepEqual(focused, [2]);
  assert.equal(nodes.heading.textContent, 'List two');
});
