import test from 'node:test';
import assert from 'node:assert/strict';
import { createListRevisions } from '../src/js/views/list-revisions.js';
import { READING_ORDER_REVISIONS } from '../src/js/lib/readingOrderRevisions.js';

function fixture({ catalogId = null, itemIds = [1], ask = null } = {}) {
  const nodes = new Map();
  for (const id of [
    'list-revision-offer', 'list-revision-review', 'list-revision-check', 'list-revision-choose',
    'list-revision-chooser', 'list-revision-select', 'list-revision-status', 'list-actions > summary',
  ]) {
    nodes.set(id, {
      hidden: false, value: '', textContent: '', children: [], events: {}, attributes: {},
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { this.events[name] = callback; },
      replaceChildren(...children) { this.children = children; },
      focus() { globalThis.document.activeElement = this; },
      click() { this.events.click(); },
    });
  }
  globalThis.document = { activeElement: null };
  const get = (id) => nodes.get(id.replace(/^#/, ''));
  const el = (tag, properties) => ({ tag, ...properties });
  let state = { lists: { saved: { id: 'saved', catalogId, itemIds } } };
  const entry = { id: catalogId ?? 'sample', name: 'Sample order', file: 'sample.json' };
  const order = { id: entry.id, count: 2, items: [{ issueId: 1 }, { issueId: 2 }] };
  let visible = true;
  let answer = false;
  let saves = 0;
  let question;
  const view = createListRevisions({
    $: get, el, getState: () => state, activeListId: () => 'saved', isCurrent: () => visible,
    loadCatalog: async () => ({ lists: [entry] }), loadOrder: async () => order,
    askConfirm: async (options) => { question = options; return ask ? ask(options) : answer; },
    saveRevision: (_id, _signature, items) => {
      saves += 1;
      state.lists.saved.itemIds = items.map(({ issueId }) => issueId);
      view.render();
      return { ok: true };
    },
  });
  view.wire();
  view.render();
  return {
    get, state, entry, order, view, setAnswer: (value) => { answer = value; },
    replaceState: () => { state = { ...state }; },
    setVisible: (value) => { visible = value; }, getSaves: () => saves, getQuestion: () => question,
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('a personal list chooses a published order, cancels and can then update', async () => {
  try {
    const f = fixture();
    f.get('list-revision-check').click();
    await settle();
    assert.equal(f.get('list-revision-chooser').hidden, false);
    assert.equal(f.get('list-revision-select').children[1].value, 'sample');
    f.get('list-revision-select').value = 'sample';
    f.get('list-revision-choose').click();
    await settle();
    assert.equal(f.getSaves(), 0);
    assert.match(f.getQuestion().body, /progress stays on the same comics/i);
    f.setAnswer(true);
    f.get('list-revision-choose').click();
    await settle();
    assert.equal(f.getSaves(), 1);
    assert.deepEqual(f.state.lists.saved.itemIds, [1, 2]);
    assert.match(f.get('list-revision-status').textContent, /updated/i);
    assert.equal(f.get('list-revision-chooser').hidden, true);
    assert.equal(globalThis.document.activeElement, f.get('list-actions > summary'));
    f.get('list-revision-check').click();
    await settle();
    f.get('list-revision-select').value = 'sample';
    f.get('list-revision-choose').click();
    await settle();
    assert.equal(f.getSaves(), 1);
    assert.match(f.get('list-revision-status').textContent, /already includes/i);
  } finally {
    delete globalThis.document;
  }
});

test('a stale personal-list chooser is withdrawn when the list becomes linked', async () => {
  try {
    const f = fixture();
    f.get('list-revision-check').click();
    await settle();
    f.get('list-revision-select').value = 'sample';
    f.state.lists.saved.catalogId = 'different';
    f.replaceState();
    f.view.render();
    assert.equal(f.get('list-revision-chooser').hidden, true);
    f.setAnswer(true);
    f.get('list-revision-choose').click();
    await settle();
    assert.equal(f.getSaves(), 0);
  } finally {
    delete globalThis.document;
  }
});

test('an earlier-order offer is withdrawn when the list or route changes', () => {
  try {
    const record = READING_ORDER_REVISIONS[0];
    const f = fixture({ catalogId: record.catalogId, itemIds: [...record.previousOrders[0]] });
    assert.equal(f.get('list-revision-offer').hidden, false);
    f.state.lists.saved.itemIds.pop();
    f.view.render();
    assert.equal(f.get('list-revision-offer').hidden, true);
    f.state.lists.saved.itemIds.push(record.previousOrders[0].at(-1));
    f.setVisible(false);
    f.view.render();
    assert.equal(f.get('list-revision-offer').hidden, true);
  } finally {
    delete globalThis.document;
  }
});

test('an unlinked list matching one earlier order can review that order directly', async () => {
  try {
    const record = READING_ORDER_REVISIONS[0];
    const f = fixture({ itemIds: [...record.previousOrders[0]] });
    f.entry.id = record.catalogId;
    f.order.id = record.catalogId;
    f.order.items = record.revisedOrder.map((issueId) => ({ issueId }));
    f.order.count = f.order.items.length;
    assert.equal(f.get('list-revision-offer').hidden, false);
    f.get('list-revision-review').click();
    await settle();
    assert.ok(f.getQuestion());
    assert.equal(f.getSaves(), 0);
  } finally {
    delete globalThis.document;
  }
});

test('a mismatched published payload is refused without saving', async () => {
  try {
    const f = fixture({ catalogId: 'linked' });
    f.order.id = 'different';
    f.get('list-revision-check').click();
    await settle();
    assert.equal(f.getSaves(), 0);
    assert.match(f.get('list-revision-status').textContent, /could not be verified/i);
  } finally {
    delete globalThis.document;
  }
});

test('a change while a review is open withdraws it and prevents saving', async () => {
  try {
    let aborted = false;
    const f = fixture({
      catalogId: 'linked',
      ask: ({ signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { aborted = true; resolve(true); }, { once: true });
      }),
    });

    f.get('list-revision-check').click();
    await settle();
    f.state.lists.saved.itemIds.push(7);
    f.view.render();
    await settle();
    assert.equal(aborted, true);
    assert.equal(f.getSaves(), 0);
    assert.match(f.get('list-revision-status').textContent, /saved data changed/i);
  } finally {
    delete globalThis.document;
  }
});

test('a replaced saved state withdraws even an identical list review', async () => {
  try {
    let aborted = false;
    const f = fixture({
      catalogId: 'linked',
      ask: ({ signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { aborted = true; resolve(true); }, { once: true });
      }),
    });
    f.get('list-revision-check').click();
    await settle();
    f.replaceState();
    f.view.render();
    await settle();
    assert.equal(aborted, true);
    assert.equal(f.getSaves(), 0);
  } finally {
    delete globalThis.document;
  }
});
