import test from 'node:test';
import assert from 'node:assert/strict';
import { createListRevisions } from '../src/js/views/list-revisions.js';
import { READING_ORDER_REVISIONS } from '../src/js/lib/readingOrderRevisions.js';
import { firstReleasedWolverineIssueOrders } from './helpers/wolverine-correction-history.mjs';

function fixture({ catalogId = null, itemIds = [1], ask = null, loadOrder = null, save = null } = {}) {
  const nodes = new Map();
  for (const id of [
    'list-revision-offer', 'list-revision-review', 'list-revision-check', 'list-revision-choose',
    'list-revision-chooser', 'list-revision-select', 'list-revision-status', 'list-actions > summary',
    'android-list-options', 'android-list-sheet[open] .android-sheet-header button',
  ]) {
    nodes.set(id, {
      hidden: false, value: '', textContent: '', children: [], events: {}, attributes: {}, boxes: [{}],
      getClientRects() { return this.boxes; },
      setAttribute(name, value) { this.attributes[name] = value; },
      addEventListener(name, callback) { this.events[name] = callback; },
      replaceChildren(...children) { this.children = children; },
      focus() { globalThis.document.activeElement = this; },
      click() { this.events.click(); },
    });
  }
  nodes.get('list-revision-offer').contains = (node) => ['review', 'check', 'choose']
    .some((name) => nodes.get(`list-revision-${name}`) === node);
  nodes.get('android-list-sheet[open] .android-sheet-header button').boxes = [];
  globalThis.document = { activeElement: null };
  const get = (id) => nodes.get(id.replace(/^#/, ''));
  const el = (tag, properties) => ({ tag, ...properties });
  let state = { lists: { saved: { id: 'saved', catalogId, itemIds } } };
  const entry = { id: catalogId ?? 'sample', name: 'Sample order', file: 'sample.json' };
  const order = { id: entry.id, count: 2, items: [{ issueId: 1 }, { issueId: 2 }] };
  let visible = true;
  let writable = true;
  let epoch = 0;
  let catalogs = 0;
  let answer = false;
  let saves = 0;
  let question;
  const view = createListRevisions({
    $: get, el, getState: () => state, activeListId: () => 'saved', isCurrent: () => visible,
    canSave: () => writable, getDatasetEpoch: () => epoch,
    loadCatalog: async () => { catalogs += 1; return { lists: [entry] }; }, loadOrder: loadOrder ?? (async () => order),
    askConfirm: async (options) => { question = options; return ask ? ask(options) : answer; },
    saveRevision: (_id, _signature, items) => {
      saves += 1;
      if (save) return save(state, items);
      state.lists.saved.itemIds = items.map(({ issueId }) => issueId);
      view.render();
      return { ok: true };
    },
  });
  view.wire();
  view.render();
  return {
    get, state, entry, order, view, setAnswer: (value) => { answer = value; },
    replaceState: ({ dataset = false } = {}) => { state = { ...state }; if (dataset) epoch += 1; },
    setWritable: (value) => { writable = value; }, getCatalogs: () => catalogs,
    setVisible: (value) => { visible = value; }, getSaves: () => saves, getQuestion: () => question,
  };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('the first released Wolverine order has the automatic review offer', () => {
  try {
    for (const itemIds of firstReleasedWolverineIssueOrders()) {
      const f = fixture({ catalogId: 'wolverine-reading-order', itemIds });
      assert.equal(f.get('list-revision-offer').hidden, false);
    }
  } finally {
    delete globalThis.document;
  }
});

test('a reorder that adds nothing says the list takes the published order', async () => {
  try {
    const f = fixture({ catalogId: 'linked', itemIds: [2, 1] });
    f.get('list-revision-check').click();
    await settle();
    assert.equal(
      f.getQuestion().body,
      'Updating puts your list in the published order. Everything already in your list stays, and your progress stays on the same comics.',
    );
    assert.equal(f.getSaves(), 0);
  } finally {
    delete globalThis.document;
  }
});

test('review uses singular only when the update adds one comic', async () => {
  try {
    for (const [itemIds, count, noun] of [
      [[1], 1, 'comic'],
      [[], 2, 'comics'],
    ]) {
      const f = fixture({ catalogId: 'linked', itemIds });
      f.get('list-revision-check').click();
      await settle();
      assert.equal(
        f.getQuestion().body,
        `Updating adds ${count} ${noun} from the published order. Everything already in your list stays, and your progress stays on the same comics. Your custom order may change.`,
      );
      assert.equal(f.getSaves(), 0);
    }
  } finally {
    delete globalThis.document;
  }
});

test('pending comparison uses the app ellipsis in both loading messages', async () => {
  let releaseOrder;
  const pendingOrder = new Promise((resolve) => { releaseOrder = resolve; });
  const f = fixture({ catalogId: 'linked', loadOrder: () => pendingOrder });
  try {
    f.get('list-revision-check').click();
    const catalogStatus = f.get('list-revision-status').textContent;
    await settle();
    assert.deepEqual(
      [catalogStatus, f.get('list-revision-status').textContent],
      ['Loading published orders…', 'Loading the published order…'],
    );
    releaseOrder(f.order);
    await settle();
    assert.ok(f.getQuestion());
  } finally {
    releaseOrder(f.order);
    await settle();
    delete globalThis.document;
  }
});

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

test('on a phone the update and the chooser hand focus to the visible options button', async () => {
  try {
    const f = fixture();
    f.get('list-actions > summary').boxes = [];
    f.get('list-revision-check').click();
    await settle();
    f.get('list-revision-select').value = 'sample';
    f.setAnswer(true);
    f.get('list-revision-choose').focus();
    f.get('list-revision-choose').click();
    await settle();
    assert.equal(f.getSaves(), 1);
    assert.equal(globalThis.document.activeElement, f.get('android-list-options'));
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
    assert.equal(f.get('list-revision-status').textContent,
      'Could not compare the published order (The published order could not be verified.). Your list is unchanged.');
  } finally {
    delete globalThis.document;
  }
});

test('published update exceptions report an uncertain result before or after a change', async () => {
  try {
    for (const changed of [false, true]) {
      const f = fixture({
        catalogId: 'linked',
        save: (state, items) => {
          if (changed) state.lists.saved.itemIds = items.map(({ issueId }) => issueId);
          throw new Error('update failed');
        },
      });
      f.setAnswer(true);
      f.get('list-revision-check').click();
      await settle();
      assert.equal(f.getSaves(), 1);
      assert.deepEqual(f.state.lists.saved.itemIds, changed ? [1, 2] : [1]);
      assert.equal(f.get('list-revision-status').hidden, false);
      assert.equal(f.get('list-revision-status').textContent,
        'We couldn\'t confirm the list update. Reopen the app to check your list.');
    }
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

test('withdrawing a stale review restores focus before hiding its offer', async () => {
  let f;
  try {
    f = fixture({
      catalogId: 'linked',
      ask: ({ signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', () => {
          f.get('list-revision-review').focus();
          resolve(false);
        }, { once: true });
      }),
    });
    f.get('list-revision-review').focus();
    f.get('list-revision-review').click();
    await settle();
    assert.ok(f.getQuestion());

    f.state.lists.saved.itemIds.push(7);
    f.view.render();
    await settle();

    assert.equal(f.get('list-revision-offer').hidden, true);
    assert.equal(globalThis.document.activeElement, f.get('list-actions > summary'));
  } finally {
    delete globalThis.document;
  }
});

test('a replaced data set withdraws even an identical list review', async () => {
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
    f.replaceState({ dataset: true });
    f.view.render();
    await settle();
    assert.equal(aborted, true);
    assert.equal(f.getSaves(), 0);
  } finally {
    delete globalThis.document;
  }
});

test('an unusable saved identity hides the offer without breaking render or the manual error', async () => {
  try {
    const f = fixture({ catalogId: 'linked', itemIds: [12345678901234568] });
    assert.equal(f.get('list-revision-offer').hidden, true);
    f.get('list-revision-check').click();
    await settle();
    assert.match(f.get('list-revision-status').textContent, /saved order has an invalid or duplicate comic identity/);
    assert.equal(f.getSaves(), 0);
  } finally {
    delete globalThis.document;
  }
});

test('a saving pause withdraws the offer, controls and an open review before another load', async () => {
  try {
    const record = READING_ORDER_REVISIONS[0];
    let aborted = false;
    const f = fixture({
      catalogId: record.catalogId, itemIds: [...record.previousOrders[0]],
      ask: ({ signal }) => new Promise((resolve) => {
        signal.addEventListener('abort', () => { aborted = true; resolve(true); }, { once: true });
      }),
    });
    f.order.id = record.catalogId;
    f.order.items = record.revisedOrder.map((issueId) => ({ issueId }));
    f.order.count = f.order.items.length;
    f.get('list-revision-review').click();
    await settle();
    assert.ok(f.getQuestion());
    f.setWritable(false);
    f.view.render();
    await settle();
    assert.equal(aborted, true);
    assert.equal(f.get('list-revision-offer').hidden, true);
    for (const id of ['list-revision-review', 'list-revision-check', 'list-revision-choose']) {
      assert.equal(f.get(id).disabled, true, id);
      f.get(id).click();
    }
    await settle();
    assert.equal(f.getCatalogs(), 1);
    assert.equal(f.getSaves(), 0);
    f.setWritable(true);
    f.view.render();
    assert.equal(f.get('list-revision-offer').hidden, false);
    assert.equal(f.get('list-revision-check').disabled, false);
  } finally {
    delete globalThis.document;
  }
});

test('a saving pause moves focus from comparison controls without taking unrelated focus', () => {
  try {
    for (const id of ['list-revision-review', 'list-revision-check', 'list-revision-choose']) {
      const f = fixture();
      f.get(id).focus();
      f.setWritable(false);
      f.view.render();
      assert.equal(globalThis.document.activeElement, f.get('list-actions > summary'), id);
    }
    const phone = fixture();
    phone.get('list-actions > summary').boxes = [];
    phone.get('list-revision-review').focus();
    phone.setWritable(false);
    phone.view.render();
    assert.equal(globalThis.document.activeElement, phone.get('android-list-options'));

    const sheet = fixture();
    sheet.get('list-actions > summary').boxes = [];
    sheet.get('android-list-sheet[open] .android-sheet-header button').boxes = [{}];
    sheet.get('list-revision-check').focus();
    sheet.setWritable(false);
    sheet.view.render();
    assert.equal(globalThis.document.activeElement, sheet.get('android-list-sheet[open] .android-sheet-header button'));

    const f = fixture();
    const unrelated = {};
    globalThis.document.activeElement = unrelated;
    f.setWritable(false);
    f.view.render();
    assert.equal(globalThis.document.activeElement, unrelated);
  } finally {
    delete globalThis.document;
  }
});

test('a paused review moves focus after its dialog returns focus to the disabled opener', async () => {
  let f;
  try {
    f = fixture({
      catalogId: 'linked',
      ask: ({ signal }) => new Promise((resolve) => {
        globalThis.document.activeElement = {};
        signal.addEventListener('abort', () => {
          f.get('list-revision-check').focus();
          resolve(false);
        }, { once: true });
      }),
    });
    f.get('list-revision-check').focus();
    f.get('list-revision-check').click();
    await settle();
    f.setWritable(false);
    f.view.render();
    assert.equal(globalThis.document.activeElement, f.get('list-actions > summary'));
    await settle();
  } finally {
    delete globalThis.document;
  }
});

test('background state updates keep an unchanged list review and chooser usable', async () => {
  try {
    let answer;
    const f = fixture({
      catalogId: 'linked',
      ask: () => new Promise((resolve) => { answer = resolve; }),
    });
    f.get('list-revision-check').click();
    await settle();
    f.replaceState();
    f.view.render();
    assert.equal(f.getQuestion().signal.aborted, false);
    answer(true);
    await settle();
    assert.equal(f.getSaves(), 1);

    const chooser = fixture();
    chooser.get('list-revision-check').click();
    await settle();
    chooser.replaceState();
    chooser.view.render();
    assert.equal(chooser.get('list-revision-chooser').hidden, false);
    chooser.get('list-revision-select').value = 'sample';
    chooser.get('list-revision-choose').click();
    await settle();
    assert.ok(chooser.getQuestion());
  } finally {
    delete globalThis.document;
  }
});
