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
    source: node(),
  };
  const pending = new Map();
  const focused = [];
  const state = { lists: {}, listOrder: [] };
  const view = createPreviewView({
    captureFocus: () => null,
    el: element,
    elements: () => nodes,
    getState: () => state,
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
    presentation: {
      attributionLine: (entry) => node({ textContent: `Source of ${entry.id}` }),
      markOwnedPaths: () => {},
      pathChooser: () => node(),
    },
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
  assert.equal(nodes.source.children[0].textContent, 'Source of two');
});

test('Preview separates individual issues after an edition without changing original order', async () => {
  const nodes = {
    add: node(),
    body: node(),
    close: node(),
    description: node(),
    dialog: node(),
    heading: node(),
    meta: node(),
    paths: node(),
    source: node(),
  };
  const items = [
    { issueId: 1, title: 'First individual issue' },
    { issueId: 2, title: 'First collected issue', collectedIn: 'Edition One' },
    { issueId: 3, title: 'Later individual issue' },
    { issueId: 4, title: 'Later collected issue', collectedIn: 'Edition One' },
  ];
  let requestedItems = items;
  const focused = [];
  const state = { lists: {}, listOrder: [] };
  const view = createPreviewView({
    captureFocus: () => null,
    el: element,
    elements: () => nodes,
    getState: () => state,
    isInLibrary: () => null,
    issueFocusAnchor: (entry) => {
      focused.push(entry.issueId);
      return node();
    },
    loadOrder: async () => ({ items: requestedItems }),
    onAdd: async () => null,
    onClose: async () => {},
    onIssueLoadFailure: async (failure) => { throw failure.error; },
    onOpen: () => {},
    presentation: {
      attributionLine: () => null,
      markOwnedPaths: () => {},
      pathChooser: () => node(),
    },
    restoreFocus: () => {},
  });

  await view.open({ ...list('mixed'), count: 4, file: 'mixed.json' });

  const rows = nodes.body.children[0].children;
  assert.deepEqual(rows.filter((entry) => entry.class === 'preview-group')
    .map((entry) => entry.children[0].text),
  ['Edition One', 'Individual issues', 'Edition One']);
  assert.deepEqual(focused, [1, 2, 3, 4]);
  assert.notEqual(rows[0].class, 'preview-group', 'leading individual issues keep their existing presentation');
  assert.deepEqual(items.map((entry) => entry.collectedIn ?? null),
    [null, 'Edition One', null, 'Edition One']);

  requestedItems = items.map(({ issueId, title }) => ({ issueId, title }));
  await view.open({ ...list('individual'), count: 4, file: 'individual.json' });
  assert.equal(nodes.body.children[0].children
    .filter((entry) => entry.class === 'preview-group').length, 0);

  requestedItems = items.map((entry) => ({ ...entry, collectedIn: 'Edition One' }));
  await view.open({ ...list('collected'), count: 4, file: 'collected.json' });
  assert.deepEqual(nodes.body.children[0].children
    .filter((entry) => entry.class === 'preview-group')
    .map((entry) => entry.children[0].text), ['Edition One']);
});

test('Preview keeps interior padding open and separates saved Open from added status', async () => {
  globalThis.document = { activeElement: null, body: {} };
  try {
    const nodes = Object.fromEntries([
      'add', 'body', 'close', 'description', 'dialog', 'heading', 'meta', 'paths', 'source',
    ].map((key) => [key, node()]));
    nodes.dialog.getBoundingClientRect = () => ({ left: 10, top: 20, right: 110, bottom: 120 });
    let saved = false;
    let opened = 0;
    const state = { lists: {}, listOrder: [] };
    const view = createPreviewView({
      captureFocus: () => null, el: element, elements: () => nodes, getState: () => state,
      isInLibrary: () => saved ? 'saved' : null,
      issueFocusAnchor: () => node(), loadOrder: async () => ({ items: [] }),
      onAdd: async () => { saved = true; return 'saved'; },
      onClose: async () => {}, onIssueLoadFailure: async (failure) => { throw failure.error; },
      onOpen: () => { opened += 1; },
      presentation: { attributionLine: () => null }, restoreFocus: () => {},
    });
    view.wire();
    await view.open(list('one'));
    nodes.dialog.listeners.click({ target: nodes.dialog, clientX: 11, clientY: 21 });
    assert.equal(nodes.dialog.open, true);
    await nodes.add.children[0].onclick({ currentTarget: nodes.add.children[0] });
    assert.equal(nodes.add.children[0].children[0], 'Open →');
    assert.match(nodes.add.children[0]['aria-label'], /^Open: List one$/);
    assert.equal(nodes.add.children[1].text, 'Added to library');
    nodes.add.children[0].onclick();
    assert.equal(opened, 1);
    nodes.dialog.listeners.click({ target: nodes.dialog, clientX: 9, clientY: 21 });
    assert.equal(nodes.dialog.open, false);
    view.invalidate();
  } finally {
    delete globalThis.document;
  }
});
