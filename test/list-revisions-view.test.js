import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createListRevisions } from '../src/js/views/list-revisions.js';
import { offlineStatusText } from '../src/js/views/shared/offline-status.js';
import { READING_ORDER_REVISIONS } from '../src/js/lib/readingOrderRevisions.js';
import { bookOrderOf, READING_ORDER_CHOICES } from '../src/js/lib/readingOrderChoices.js';
import { reconcileIdentities } from '../src/js/lib/identityReconcile.js';
import { firstReleasedWolverineIssueOrders } from './helpers/wolverine-correction-history.mjs';

// Loading a save moves a linked list's corrected comics to their verified identities before any
// offer is considered, so an earlier order is offered in the form a real load leaves it in.
const loadedIds = (catalogId, itemIds) => reconcileIdentities({
  issues: {}, lists: { saved: { id: 'saved', catalogId, itemIds: [...itemIds] } },
}).lists.saved.itemIds;

function fixture({ catalogId = null, itemIds = [1], ask = null, loadOrder = null, save = null, catalogEntries = null, offlineContent = null } = {}) {
  const nodes = new Map();
  for (const id of [
    'list-revision-offer', 'list-revision-review', 'list-revision-check', 'list-revision-choose',
    'list-revision-chooser', 'list-revision-select', 'list-revision-status', 'list-actions > summary',
    'android-list-options', 'android-list-sheet[open] .android-sheet-header button', 'list-actions',
    'list-offline-action', 'list-offline-cancel', 'list-offline-status',
  ]) {
    nodes.set(id, {
      hidden: false, value: '', textContent: '', children: [], events: {}, attributes: {}, dataset: {}, boxes: [{}],
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
    loadCatalog: async () => { catalogs += 1; return { lists: catalogEntries ?? [entry] }; }, loadOrder: loadOrder ?? (async () => order),
    offlineContent,
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

test('only saved legacy orders offer deliberate offline preparation of their original order', async () => {
  try {
    const earlier = READING_ORDER_REVISIONS.find((record) => record.catalogId === 'xmen-claremont').previousOrders[0];
    for (const [catalogId, itemIds, expected] of [
      ['xmen-claremont', [123], 'xmen-claremont'],
      ['xmen-claremont-complete', [456], 'xmen-claremont-complete'],
      [null, earlier, 'xmen-claremont'],
    ]) {
      const calls = [];
      const offlineContent = {
        available: () => true,
        readiness: async (...args) => { calls.push(['readiness', ...args]); return { ok: true, state: 'idle' }; },
        prepare: async (...args) => { calls.push(['prepare', ...args]); return { ok: true, state: 'ready' }; },
      };
      const f = fixture({ catalogId, itemIds, offlineContent });
      const before = JSON.stringify(f.state);
      assert.equal(f.get('list-offline-action').hidden, false);
      assert.equal(f.get('list-offline-action').textContent, 'Make published order available offline');
      assert.deepEqual(calls, [], 'rendering a saved list does not download an offline bundle');
      f.get('list-offline-action').click();
      await settle();
      assert.equal(calls.length, 1);
      assert.equal(calls[0][0], 'prepare');
      assert.equal(calls[0][1], expected);
      assert.equal(calls[0][2].legacy, true);
      assert.match(f.get('list-offline-action').textContent, /Refresh.*offline/i);
      assert.match(f.get('list-offline-status').textContent, /ready/i);
      assert.equal(JSON.stringify(f.state), before);
    }

    for (const [catalogId, itemIds] of [['another-order', [1]], [null, [123, 456]]]) {
      const f = fixture({ catalogId, itemIds, offlineContent: {} });
      assert.equal(f.get('list-offline-action').hidden, true, 'an unrelated or ambiguous personal list gets no guessed order');
    }
  } finally {
    delete globalThis.document;
  }
});

test('legacy offline preparation can be cancelled and is withdrawn if the saved view changes', async () => {
  try {
    let active;
    let starts = 0;
    const offlineContent = {
      available: () => true,
      prepare: (_id, options) => {
        starts += 1;
        active = options;
        return new Promise((resolve) => options.signal.addEventListener('abort', () => resolve({ ok: false, state: 'cancelled' }), { once: true }));
      },
    };
    const f = fixture({ catalogId: 'xmen-claremont', offlineContent });
    const before = JSON.stringify(f.state);
    f.get('list-offline-action').focus();
    f.get('list-offline-action').click();
    f.get('list-offline-action').click();
    assert.equal(starts, 1, 'a pending request cannot be submitted twice');
    assert.equal(f.get('list-offline-status').textContent, 'Saving this published order for offline use.');
    assert.equal(f.get('list-offline-cancel').hidden, false);
    assert.equal(globalThis.document.activeElement, f.get('list-offline-cancel'));
    active.onProgress({ phase: 'write', completed: 1, total: 3 });
    assert.match(f.get('list-offline-status').textContent, /1 of 3/);
    f.get('list-offline-cancel').click();
    await settle();
    assert.equal(active.signal.aborted, true);
    assert.match(f.get('list-offline-status').textContent, /earlier completed offline copy is unchanged/i);
    assert.equal(JSON.stringify(f.state), before);

    f.get('list-offline-action').click();
    f.setVisible(false);
    f.view.render();
    assert.equal(active.signal.aborted, true);
    await settle();
    assert.equal(f.get('list-offline-action').hidden, true);
    assert.equal(f.get('list-offline-status').hidden, true);
    assert.equal(JSON.stringify(f.state), before);
  } finally {
    delete globalThis.document;
  }
});

test('offline capability and readiness control the legacy action without preparing on its own', async () => {
  try {
    let available = false;
    let resolveReadiness;
    let preparations = 0;
    const offlineContent = {
      available: () => available,
      readiness: () => new Promise((resolve) => { resolveReadiness = resolve; }),
      prepare: async () => { preparations += 1; return { ok: false, state: 'failed', error: 'Storage is full.' }; },
    };
    const f = fixture({ catalogId: 'xmen-claremont', offlineContent });
    assert.equal(f.get('list-offline-action').hidden, true);
    available = true;
    f.view.render();
    assert.equal(f.get('list-offline-action').hidden, false);
    assert.equal(preparations, 0);
    f.get('list-actions').open = true;
    f.get('list-actions').events.toggle();
    assert.equal(f.get('list-offline-action').disabled, true);
    assert.equal(f.get('list-offline-status').textContent, 'Checking whether this published order is ready offline.');
    resolveReadiness({ ok: true, state: 'ready' });
    await settle();
    assert.equal(f.get('list-offline-action').disabled, false);
    assert.equal(f.get('list-offline-action').textContent, 'Refresh offline copy');
    f.get('list-offline-action').click();
    await settle();
    assert.equal(preparations, 1);
    assert.equal(f.get('list-offline-status').textContent, "We couldn't confirm the offline copy. Try again.");
    assert.equal(f.get('list-offline-status').hidden, false);
    assert.doesNotMatch(f.get('list-offline-status').textContent, /Storage is full/, 'exception text stays out of the published order');
    assert.equal(f.get('list-offline-action').textContent, 'Try again');
    available = false;
    f.get('list-offline-action').focus();
    f.view.render();
    assert.equal(f.get('list-offline-action').hidden, true);
    assert.equal(globalThis.document.activeElement, f.get('list-actions > summary'));
  } finally {
    delete globalThis.document;
  }
});

test('preparation this menu did not start is reported without a failure or Cancel, and reopening checks again', async () => {
  try {
    const BUSY = 'The app is already preparing an offline copy. Reopen Reading List options to check again.';
    let busy = true;
    let checks = 0;
    const f = fixture({ catalogId: 'xmen-claremont', offlineContent: {
      available: () => true,
      readiness: async () => { checks += 1; return busy ? { ok: false, state: 'preparing' } : { ok: true, state: 'idle' }; },
      prepare: async () => ({ ok: true, state: 'ready' }),
    } });
    const before = JSON.stringify(f.state);
    f.get('list-actions').open = true;
    f.get('list-actions').events.toggle();
    await settle();
    assert.equal(f.get('list-offline-status').textContent, BUSY);
    assert.equal(f.get('list-offline-cancel').hidden, true, 'no Cancel for work this menu cannot cancel');
    assert.equal(f.get('list-offline-action').disabled, true);
    assert.equal(f.get('list-offline-action').textContent, 'Make published order available offline');
    f.view.render();
    await settle();
    await settle();
    assert.equal(checks, 1, 'an open menu does not poll');
    f.get('list-actions').open = false;
    f.get('list-actions').events.toggle();
    await settle();
    assert.equal(checks, 1, 'closing the menu does not check');
    busy = false;
    f.get('list-actions').open = true;
    f.get('list-actions').events.toggle();
    await settle();
    assert.equal(checks, 2, 'reopening Reading List options checks again');
    assert.equal(f.get('list-offline-status').textContent, 'This published order is not saved for offline use.');
    assert.equal(f.get('list-offline-action').disabled, false);
    assert.equal(JSON.stringify(f.state), before);

    let resolveCheck;
    const late = fixture({ catalogId: 'xmen-claremont', offlineContent: {
      available: () => true,
      readiness: () => { checks += 1; return new Promise((resolve) => { resolveCheck = resolve; }); },
    } });
    checks = 0;
    late.get('list-actions').open = true;
    late.get('list-actions').events.toggle();
    late.get('list-actions').open = false;
    late.get('list-actions').events.toggle();
    resolveCheck({ ok: false, state: 'preparing' });
    await settle();
    late.get('list-actions').open = true;
    late.get('list-actions').events.toggle();
    assert.equal(checks, 2, 'a busy answer that arrives after closing still rechecks on reopen');
  } finally {
    delete globalThis.document;
  }
});

test('published order failures show approved text and never exception text', async () => {
  try {
    for (const [prepare, expected] of [
      [async () => ({ ok: false, state: 'failed', code: 'unconfirmed', error: 'Another tab prepared a different offline copy. Try again.' }),
        "We couldn't confirm the offline copy. Try again."],
      [async () => { throw new Error('internal fixture detail'); }, "We couldn't confirm the offline copy. Try again."],
      [async () => ({ ok: false, state: 'failed', error: 'internal fixture detail' }), "We couldn't confirm the offline copy. Try again."],
      [async () => ({ ok: false, state: 'unsupported', error: 'internal fixture detail' }), 'Offline preparation is not supported in this browser.'],
    ]) {
      const f = fixture({ catalogId: 'xmen-claremont-complete', offlineContent: { available: () => true, prepare } });
      const before = JSON.stringify(f.state);
      f.get('list-offline-action').click();
      await settle();
      assert.equal(f.get('list-offline-status').textContent, expected);
      assert.equal(f.get('list-offline-status').hidden, !expected);
      assert.doesNotMatch(f.get('list-offline-status').textContent, /internal fixture detail|Another tab/);
      assert.equal(JSON.stringify(f.state), before);
    }
  } finally {
    delete globalThis.document;
  }
});

test('failed published-order checks report a retry and recheck once on reopening', async () => {
  try {
    for (const outcome of [
      async () => { throw new Error('internal fixture detail'); },
      async () => ({ ok: false, state: 'failed', error: 'internal fixture detail' }),
    ]) {
      let checks = 0;
      const f = fixture({ catalogId: 'xmen-claremont', offlineContent: {
        available: () => true,
        readiness: async () => { checks += 1; return checks === 1 ? outcome() : { ok: true, state: 'ready' }; },
      } });
      const before = JSON.stringify(f.state);
      f.get('list-actions').open = true;
      f.get('list-actions').events.toggle();
      await settle();
      assert.equal(f.get('list-offline-status').textContent,
        "We couldn't check whether this published order is ready offline. Reopen Reading List options to check again.");
      assert.equal(f.get('list-offline-status').hidden, false);
      assert.equal(f.get('list-offline-cancel').hidden, true);
      assert.equal(f.get('list-offline-action').textContent, 'Make published order available offline');
      assert.equal(f.get('list-offline-action').disabled, false);
      f.view.render();
      await settle();
      assert.equal(checks, 1, 'an open menu does not poll');
      f.get('list-actions').open = false;
      f.get('list-actions').events.toggle();
      assert.equal(f.get('list-offline-status').textContent, '');
      assert.equal(f.get('list-offline-status').hidden, true);
      f.get('list-actions').open = true;
      f.get('list-actions').events.toggle();
      await settle();
      assert.equal(checks, 2);
      assert.equal(f.get('list-offline-status').textContent, 'Offline copy verified and ready on this device.');
      assert.equal(JSON.stringify(f.state), before);
    }

    let resolveCheck;
    let signal;
    const f = fixture({ catalogId: 'xmen-claremont', offlineContent: {
      available: () => true,
      readiness: (_id, options) => {
        signal = options.signal;
        return new Promise((resolve) => { resolveCheck = resolve; });
      },
    } });
    f.get('list-actions').open = true;
    f.get('list-actions').events.toggle();
    f.state.lists.saved.itemIds = [1, 2];
    f.view.render();
    assert.equal(signal.aborted, true);
    resolveCheck({ ok: false, state: 'failed', error: 'internal fixture detail' });
    await settle();
    assert.doesNotMatch(f.get('list-offline-status').textContent, /cancel/i, 'a withdrawn check is not cancelled preparation');
    assert.equal(f.get('list-offline-status').textContent, '');
  } finally {
    delete globalThis.document;
  }
});

test('closing Reading List options withdraws a check and ignores late failures', async () => {
  try {
    for (const beforeToggle of [false, true]) {
      let checks = 0;
      let signal;
      let resolveFirst;
      let rejectFirst;
      const f = fixture({ catalogId: 'xmen-claremont', offlineContent: {
        available: () => true,
        readiness: (_id, options) => {
          checks += 1;
          if (checks > 1) return Promise.resolve({ ok: true, state: 'ready' });
          signal = options.signal;
          return new Promise((resolve, reject) => { resolveFirst = resolve; rejectFirst = reject; });
        },
      } });
      const before = JSON.stringify(f.state);
      f.get('list-actions').open = true;
      f.get('list-actions').events.toggle();
      assert.equal(checks, 1);
      f.get('list-actions').open = false;
      if (beforeToggle) {
        resolveFirst({ ok: false, state: 'failed', error: 'internal fixture detail' });
        await settle();
      } else {
        f.get('list-actions').events.toggle();
      }
      assert.equal(signal.aborted, true);
      assert.equal(f.get('list-offline-status').textContent, '');
      assert.equal(f.get('list-offline-status').hidden, true);
      f.get('list-actions').open = true;
      f.get('list-actions').events.toggle();
      await settle();
      assert.equal(checks, 2);
      assert.equal(f.get('list-offline-status').textContent, 'Offline copy verified and ready on this device.');
      if (!beforeToggle) {
        rejectFirst(new Error('internal fixture detail'));
        await settle();
        assert.equal(f.get('list-offline-status').textContent, 'Offline copy verified and ready on this device.');
      }
      f.view.render();
      await settle();
      assert.equal(checks, 2, 'the reopened menu does not poll');
      assert.equal(JSON.stringify(f.state), before);
    }
  } finally {
    delete globalThis.document;
  }
});

test('the preview keeps its wording except for an unconfirmed completed copy', () => {
  assert.equal(offlineStatusText({ state: 'preparing' }), 'Preparing and verifying this Reading List for offline use.');
  assert.equal(offlineStatusText({ state: 'idle' }), 'This Reading List is not saved for offline use.');
  assert.equal(offlineStatusText({ state: 'failed', error: 'Storage is full.' }), 'Offline preparation failed: Storage is full.');
  assert.equal(offlineStatusText({ state: 'failed', code: 'unconfirmed', error: 'The completed offline Reading List could not be confirmed.' }),
    "We couldn't confirm the offline copy. Try again.");
});

test('hidden earlier Core and personalized legacy lists compare with their own unchanged orders', async () => {
  try {
    for (const [catalogId, file, earlier] of [
      ['xmen-claremont', 'xmen_claremont.json', true],
      ['xmen-claremont', 'xmen_claremont.json', false],
      ['xmen-claremont-complete', 'xmen_claremont_complete.json', false],
    ]) {
      const payload = JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8'));
      const itemIds = earlier
        ? [...READING_ORDER_REVISIONS.find((record) => record.catalogId === catalogId).previousOrders[0]]
        : [999999999, ...payload.items.map(({ issueId }) => issueId).reverse()];
      let requested;
      const f = fixture({ catalogId, itemIds, catalogEntries: [], loadOrder: async (name) => {
        requested = name;
        return payload;
      } });
      if (earlier) assert.equal(f.get('list-revision-offer').hidden, false);
      f.get(earlier ? 'list-revision-review' : 'list-revision-check').click();
      await settle();
      assert.equal(requested, file);
      assert.match(f.getQuestion().title, catalogId.endsWith('complete') ? /Expanded/ : /Core/);
      assert.equal(f.getSaves(), 0, 'cancelling never changes the saved list');
      assert.deepEqual(f.state.lists.saved.itemIds, itemIds);
    }
  } finally {
    delete globalThis.document;
  }
});

test('unavailable hidden legacy payload reports failure without saving', async () => {
  try {
    const f = fixture({ catalogId: 'xmen-claremont-complete', catalogEntries: [], loadOrder: async () => {
      throw new Error('offline fixture');
    } });
    f.get('list-revision-check').click();
    await settle();
    assert.match(f.get('list-revision-status').textContent, /offline fixture.*unchanged/);
    assert.equal(f.getSaves(), 0);
  } finally {
    delete globalThis.document;
  }
});

test('a reused catalog ID cannot redirect a legacy comparison to a different order', async () => {
  try {
    const payload = JSON.parse(readFileSync(new URL('../src/data/xmen_claremont_complete.json', import.meta.url), 'utf8'));
    const itemIds = payload.items.map(({ issueId }) => issueId).reverse();
    let requested;
    const f = fixture({
      catalogId: payload.id, itemIds,
      catalogEntries: [{ id: payload.id, name: 'Synthetic replacement', file: 'replacement.json' }],
      loadOrder: async (name) => { requested = name; return payload; },
    });
    f.get('list-revision-check').click();
    await settle();
    assert.equal(requested, 'xmen_claremont_complete.json');
    assert.match(f.getQuestion().title, /Expanded/);
    assert.equal(f.getSaves(), 0);
  } finally {
    delete globalThis.document;
  }
});

test('a personal list chooser offers only active catalog entries', async () => {
  try {
    const entries = [
      { id: 'fixture-era-one', name: 'Synthetic era one', file: 'fixture_one.json' },
      { id: 'fixture-era-two', name: 'Synthetic era two', file: 'fixture_two.json' },
    ];
    const f = fixture({ catalogEntries: entries });
    f.get('list-revision-check').click();
    await settle();
    assert.deepEqual(f.get('list-revision-select').children.slice(1).map(({ value }) => value), entries.map(({ id }) => id));
  } finally {
    delete globalThis.document;
  }
});

test('the first released Wolverine order has the automatic review offer', () => {
  try {
    for (const itemIds of firstReleasedWolverineIssueOrders()) {
      const f = fixture({ catalogId: 'wolverine-reading-order', itemIds: loadedIds('wolverine-reading-order', itemIds) });
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
    const itemIds = loadedIds(record.catalogId, record.previousOrders[0]);
    const f = fixture({ catalogId: record.catalogId, itemIds: [...itemIds] });
    assert.equal(f.get('list-revision-offer').hidden, false);
    f.state.lists.saved.itemIds.pop();
    f.view.render();
    assert.equal(f.get('list-revision-offer').hidden, true);
    f.state.lists.saved.itemIds.push(itemIds.at(-1));
    f.setVisible(false);
    f.view.render();
    assert.equal(f.get('list-revision-offer').hidden, true);
  } finally {
    delete globalThis.document;
  }
});

test('an unlinked list matching one earlier order can review that order directly', async () => {
  try {
    // An unlinked copy of the earlier Wolverine order keeps comics that load could not move, so
    // updating it would show two checkmarks for one comic and it is not offered.
    const wolverine = READING_ORDER_REVISIONS.find(({ catalogId }) => catalogId === 'wolverine-reading-order');
    assert.equal(fixture({ itemIds: loadedIds(null, wolverine.previousOrders[0]) }).get('list-revision-offer').hidden, true);
    const record = READING_ORDER_REVISIONS.find(({ catalogId }) => catalogId !== 'wolverine-reading-order');
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
      catalogId: record.catalogId, itemIds: loadedIds(record.catalogId, record.previousOrders[0]),
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

test('a list switched to book by book is already up to date with its published order', async () => {
  try {
    const [choice] = READING_ORDER_CHOICES;
    const order = { id: choice.catalogId, count: choice.issueOrder.length, items: choice.issueOrder.map((issueId) => ({ issueId })) };
    const f = fixture({ catalogId: choice.catalogId, itemIds: bookOrderOf(choice), loadOrder: async () => order });
    f.get('list-revision-check').click();
    await settle();
    await settle();
    assert.equal(f.getQuestion(), undefined);
    assert.equal(f.get('list-revision-status').textContent, 'Your list already includes this published order. Your list is unchanged.');
    assert.equal(f.getSaves(), 0);
  } finally {
    delete globalThis.document;
  }
});
