import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, KEY } from '../src/js/storage.js';
import {
  createEmptyState, createList, addIssuesToList, markRead, setDeferred, setListNote, exportBackup,
} from '../src/js/lib/model.js';
import { createBulkReadView } from '../src/js/views/bulk-read.js';

function fixture(count = 3) {
  let state = createList(createEmptyState(), { id: 'bulk', name: 'Already read' });
  state = addIssuesToList(state, 'bulk', Array.from({ length: count }, (_, i) => ({
    issueId: i + 1, title: `Comic ${i + 1}`, source: 'manual',
  }))).state;
  state = createList(state, { id: 'shared', name: 'Shared comic' });
  state = addIssuesToList(state, 'shared', [{ issueId: 2, title: 'Comic 2', source: 'manual' }]).state;
  state = markRead(state, 1, true, 123);
  return setDeferred(state, 'bulk', 3, true);
}

function readerData(state) {
  const data = exportBackup(state);
  delete data.exportedAt;
  return data;
}

function harness(t, initial = fixture(), answer = async () => true) {
  const data = new Map([[KEY, JSON.stringify(exportBackup(initial))], ['mrt.list-history.v1', 'history witness']]);
  const storage = {
    mode: null, writes: 0, failReads: false,
    getItem(key) {
      if (this.failReads && key === KEY) throw new Error('read unavailable');
      return data.get(key) ?? null;
    },
    setItem(key, value) {
      if (key === KEY) {
        this.writes += 1;
        if (this.mode === 'throw') throw new Error('quota');
        if (this.mode === 'silent') return;
      }
      data.set(key, String(value));
      if (this.mode === 'unknown' && key === KEY) this.failReads = true;
    },
    removeItem(key) { data.delete(key); },
  };
  const store = new Store({ storage });
  store.load();
  const documentBefore = globalThis.document;
  const body = { isConnected: true };
  globalThis.document = { activeElement: body, body };
  t.after(() => { globalThis.document = documentBefore; });
  const control = {
    disabled: false, isConnected: true,
    setAttribute(name, value) { this[name] = value; },
    checkVisibility: () => true,
    focus() { globalThis.document.activeElement = control; },
  };
  const calls = { asks: [], notices: [], reconciles: 0, focus: 0, paints: [] };
  const notices = new Map();
  let current = true;
  let active = 'bulk';
  let canSave = true;
  const view = createBulkReadView({
    store, button: () => control, getListId: () => active, isCurrent: () => current,
    canSave: () => canSave,
    askConfirm: async (question) => { calls.asks.push(question); return answer(question); },
    notify: (_selector, message, kind, key, action, dismiss) => {
      const notice = { message, kind, action, dismiss };
      notices.set(key, notice);
      calls.notices.push(notice);
    },
    clearNotice: (key) => notices.delete(key),
    reconcile: () => { calls.reconciles += 1; paint(); },
    focusCurrentView: () => { calls.focus += 1; },
    focusRetry: () => { calls.focus += 1; },
  });
  function paint() {
    calls.paints.push({ blocked: store.blocked, read: { ...store.state.read } });
    view.render();
  }
  store.onChange = paint;
  paint();
  return {
    store, storage, data, view, control, calls, notices,
    notice: () => notices.get('bulk-read'),
    setCurrent: (value) => { current = value; },
    setActive: (id) => { active = id; },
    setCanSave: (value) => { canSave = value; },
  };
}

test('bulk read saves every unread comic once, preserving existing dates and unrelated data; Undo is exact', async (t) => {
  const h = harness(t);
  const before = readerData(h.store.state);
  await h.view.markAllRead();
  assert.equal(h.storage.writes, 1);
  assert.equal(h.store.state.read[1], 123);
  assert.ok(h.store.state.read[2] > 0);
  assert.equal(h.store.state.read[2], h.store.state.read[3]);
  const expected = { ...before, read: { ...h.store.state.read } };
  assert.deepEqual(readerData(h.store.state), expected);
  assert.equal(h.store.state.lists.shared.itemIds[0], 2);
  assert.equal(h.data.get('mrt.list-history.v1'), 'history witness');
  assert.equal(h.calls.asks[0].body,
    'This marks 2 unread issues as read. Read progress is shared with every list containing those comics.');
  assert.equal(h.calls.asks[0].confirmLabel, 'Mark All Read');
  assert.equal(h.control['aria-disabled'], 'true');
  const reloaded = new Store({ storage: h.storage });
  reloaded.load();
  assert.deepEqual(reloaded.state.read, h.store.state.read);
  h.notice().action.onClick();
  assert.equal(h.storage.writes, 2);
  assert.deepEqual(readerData(h.store.state), before);
  assert.equal(h.notice().action, null);
});

test('large list uses a single write without resetting an already-read timestamp', async (t) => {
  const h = harness(t, fixture(10000));
  await h.view.markAllRead();
  assert.equal(h.storage.writes, 1);
  assert.equal(Object.keys(h.store.state.read).length, 10000);
  assert.equal(h.store.state.read[1], 123);
});

test('cancel is write-free, and confirmation blocks duplicate activation', async (t) => {
  let resolve;
  const h = harness(t, fixture(2), () => new Promise((done) => { resolve = done; }));
  const pending = h.view.markAllRead();
  assert.equal(h.control['aria-disabled'], 'true');
  await h.view.markAllRead();
  assert.equal(h.calls.asks.length, 1);
  assert.equal(h.calls.asks[0].body,
    'This marks 1 unread issue as read. Read progress is shared with every list containing those comics.');
  resolve(false);
  await pending;
  assert.equal(h.storage.writes, 0);
  assert.equal(h.control.disabled, false);
  assert.equal(h.notice(), undefined);
});

test('changed membership, progress, incarnation or view refuses a stale confirmation', async (t) => {
  for (const change of ['membership', 'progress', 'incarnation', 'view', 'active']) {
    const h = harness(t, fixture(), async () => {
      if (change === 'membership') h.store.update((s) => ({
        ...s, lists: { ...s.lists, bulk: { ...s.lists.bulk, itemIds: [1, 2] } },
      }));
      if (change === 'progress') h.store.update((s) => markRead(s, 2));
      if (change === 'incarnation') h.store.update((s) => ({
        ...s, lists: { ...s.lists, bulk: { ...s.lists.bulk, created: s.lists.bulk.created + 1 } },
      }));
      if (change === 'view') h.setCurrent(false);
      if (change === 'active') h.setActive('shared');
      h.storage.writes = 0;
      return true;
    });
    await h.view.markAllRead();
    assert.equal(h.storage.writes, 0, change);
    assert.equal(h.notice().kind, 'error', change);
    assert.equal(h.notice().action, null, change);
  }
});

test('same-value adoption during confirmation does not depend on object identity', async (t) => {
  const h = harness(t, fixture(), async () => {
    h.store.adoptForeignWrite(h.data.get(KEY));
    return true;
  });
  await h.view.markAllRead();
  assert.equal(h.notice().kind, 'ok');
  assert.equal(Object.keys(h.store.state.read).length, 3);
});

test('empty, all-read and blocked lists disable the action without writing', async (t) => {
  const empty = harness(t, createList(createEmptyState(), { id: 'bulk', name: 'Empty' }));
  assert.equal(empty.control.disabled, true);
  await empty.view.markAllRead();
  assert.equal(empty.storage.writes, 0);
  const h = harness(t);
  h.store.blocked = true;
  h.view.render();
  assert.equal(h.control.disabled, true);
  await h.view.markAllRead();
  assert.equal(h.storage.writes, 0);
});

test('refused, silent and unknown writes never report success, and recovered state is repainted', async (t) => {
  for (const mode of ['throw', 'silent', 'unknown']) {
    const h = harness(t);
    h.storage.mode = mode;
    await h.view.markAllRead();
    assert.equal(h.notice().kind, 'error', mode);
    assert.equal(h.notice().action, null, mode);
    assert.equal(h.store.lastUpdateOk, false, mode);
    if (mode === 'silent') {
      assert.deepEqual(h.store.state.read, { 1: 123 });
      assert.deepEqual(h.calls.paints.at(-1), { blocked: false, read: { 1: 123 } });
      assert.equal(h.calls.reconciles, 1);
    }
    if (mode === 'unknown') {
      assert.equal(h.store.blocked, true);
      assert.equal(h.calls.paints.at(-1).blocked, true);
      assert.equal(h.control.disabled, true);
    }
  }
});

test('a foreign save is adopted and never overwritten by the bulk action', async (t) => {
  const h = harness(t, fixture(), async () => {
    const other = new Store({ storage: h.storage });
    other.load();
    other.update((s) => markRead(s, 2, true, 789));
    h.storage.writes = 0;
    return true;
  });
  await h.view.markAllRead();
  assert.equal(h.storage.writes, 0);
  assert.equal(h.store.state.read[2], 789);
  assert.equal(h.store.state.read[3], undefined);
  assert.equal(h.notice().kind, 'error');
});

test('any later saved change withdraws Undo; an old action cannot erase later progress', async (t) => {
  const h = harness(t);
  await h.view.markAllRead();
  const old = h.notice().action;
  h.store.update((s) => setListNote(s, 'bulk', 'A later note'));
  assert.equal(h.notice(), undefined);
  const before = h.data.get(KEY);
  old.onClick();
  assert.equal(h.data.get(KEY), before);
  assert.equal(h.notice().action, null);
  assert.equal(h.notice().kind, 'error');
});

test('failed Undo retains a safe retry and silent Undo repaints saved progress', async (t) => {
  for (const mode of ['throw', 'silent', 'unknown']) {
    const h = harness(t);
    await h.view.markAllRead();
    h.storage.mode = mode;
    h.notice().action.onClick();
    assert.equal(h.notice().kind, 'error', mode);
    if (mode === 'unknown') {
      assert.equal(h.notice().action, null);
      assert.equal(h.calls.paints.at(-1).blocked, true);
    } else {
      assert.equal(Object.keys(h.calls.paints.at(-1).read).length, 3);
      assert.equal(h.notice().action.label, 'Try Undo again');
      if (mode === 'silent') assert.match(h.notice().message, /The outcome could not be verified/);
      h.storage.mode = null;
      h.notice().action.onClick();
      assert.deepEqual(h.store.state.read, { 1: 123 });
      assert.equal(h.notice().action, null);
    }
  }
});

test('a complete-restore pause disables the action without asking or writing', async (t) => {
  const h = harness(t);
  h.setCanSave(false);
  h.view.render();
  const disabled = h.control.disabled;
  await h.view.markAllRead();
  assert.deepEqual({ disabled, questions: h.calls.asks.length, writes: h.storage.writes },
    { disabled: true, questions: 0, writes: 0 });
  h.setCanSave(true);
  h.view.render();
  assert.equal(h.control.disabled, false);
});

test('a complete-restore pause during confirmation refuses the write', async (t) => {
  const h = harness(t, fixture(), async () => {
    h.setCanSave(false);
    h.view.render();
    return true;
  });
  await h.view.markAllRead();
  assert.equal(h.storage.writes, 0);
  assert.equal(h.notice().kind, 'error');
  assert.equal(h.control.disabled, true);
});

test('Store-reported write refusal and conflict receive only a short bulk outcome', async (t) => {
  for (const mode of ['throw', 'conflict']) {
    await t.test(mode, async (t) => {
      const h = harness(t, fixture(), async () => {
        if (mode === 'throw') h.storage.mode = mode;
        else {
          const other = new Store({ storage: h.storage });
          other.load();
          other.update((s) => markRead(s, 2, true, 789));
        }
        return true;
      });
      await h.view.markAllRead();
      assert.ok(h.store.lastError);
      assert.equal(h.notice().message, 'No comics were marked read.');
    });
  }
});

test('a Store-reported Undo conflict gets a short outcome without a retry', async (t) => {
  const h = harness(t);
  await h.view.markAllRead();
  const action = h.notice().action;
  const other = new Store({ storage: h.storage });
  other.load();
  other.update((s) => setListNote(s, 'bulk', 'From another tab'));
  action.onClick();
  assert.equal(h.notice().message, 'No read marks were undone.');
  assert.equal(h.notice().action, null);
  assert.equal(h.store.state.lists.bulk.note, 'From another tab');
});
