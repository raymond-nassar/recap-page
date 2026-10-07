import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState, createList, addIssuesToList, setDeferred, markRead, exportBackup } from '../src/js/lib/model.js';
import { Store, KEY } from '../src/js/storage.js';
import { ListHistoryStore, listHistoryIdentity } from '../src/js/lib/listHistory.js';
import { createCompletionView, LIST_FEEDBACK_URL, PRIVATE_FEEDBACK_URL } from '../src/js/views/completion.js';

const feedbackUrl = 'https://forms.cloud.microsoft/Pages/ResponsePage.aspx?id=DQSIkWdsW0yxEjajBLZtrQAAAAAAAAAAAAMAAEys2uVUMkJLVFlNTUhaUFk0NERQQzYxT0xSSDAwVy4u';

function node(props = {}, children = []) {
  const classes = new Set();
  return {
    children: [].concat(children), listeners: {}, attributes: {}, hidden: false, disabled: false,
    isConnected: true, value: '', open: false,
    classList: { toggle(name, force) { if (force) classes.add(name); else classes.delete(name); } },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    setAttribute(name, value) { this.attributes[name] = value; },
    getAttribute(name) { return this.attributes[name] ?? null; },
    removeAttribute(name) { delete this.attributes[name]; },
    replaceChildren(...next) { this.children = next; },
    prepend(child) { this.children.unshift(child); },
    append(child) { this.children.push(child); },
    insertBefore(child, before) {
      const index = this.children.indexOf(before);
      this.children.splice(index < 0 ? this.children.length : index, 0, child);
    },
    closest() { return this.hidden ? this : null; },
    focus() { this.focused = true; },
    showModal() { this.open = true; },
    close() { this.open = false; this.listeners.close?.(); },
    ...props,
  };
}

const element = (_tag, props, children) => node(props, children);

function fixture() {
  let state = createList(createEmptyState(), { id: 'a', name: 'Private list name', catalogId: 'source' });
  state = addIssuesToList(state, 'a', [{ issueId: 1, title: 'One' }, { issueId: 2, title: 'Two' }, { issueId: 3, title: 'Three' }]).state;
  state = markRead(state, 1, true, 1000);
  state = setDeferred(state, 'a', 3, true);
  const records = new Map();
  const calls = { notify: [], announce: [], selected: [], opened: [], previewed: [], downloads: [], confirms: [], retry: 0, focus: 0 };
  const nodes = Object.fromEntries([
    'readBody', 'listTools', 'wrapup', 'wrapupHeading', 'status', 'complete', 'reopen',
    'collectionOpen', 'ratings', 'up', 'down', 'icons', 'downIcons', 'feedbackGuide',
    'feedbackDialog', 'feedbackClose', 'feedbackLink', 'privateFeedbackLink',
    'recommendations', 'suggestions', 'recommendationStatus', 'recommendationRetry',
    'recommendationBrowse', 'collectionCount', 'collectionStatus', 'collectionSection',
    'collectionResults', 'home', 'homeYours', 'library', 'libraryYours', 'dataSafety',
    'historyControls', 'historyStatus', 'historyExport', 'historyCopy', 'historyRetry', 'historyRestore',
    'backupHistory', 'historyTroubleshooting',
  ].map((name) => [name, node()]));
  nodes.collectionFilters = [node({ value: 'all' }), node({ value: 'enjoyed' })];
  nodes.home.append(nodes.homeYours);
  nodes.library.append(nodes.libraryYours);
  const h = { state, current: 'read', nodes, calls, fail: false, next: null, fileRefusal: null, confirmation: true };
  const history = {
    known: true, busy: false, canSave: true, seenRaw: null, writeUnavailable: null, lastError: null, completionRevision: 0,
    getRecord(_state, id) { return this.known ? records.get(id) ?? null : null; },
    isCompleted(_state, id) { return this.getRecord(_state, id)?.completedAt != null; },
    completedIds(_state, { enjoyed = false } = {}) {
      return _state.listOrder.filter((id) => this.isCompleted(_state, id) && (!enjoyed || this.getRecord(_state, id).rating === 'up'));
    },
    counts(_state) { return this.known ? { completed: this.completedIds(_state).length, enjoyed: this.completedIds(_state, { enjoyed: true }).length } : null; },
    async complete(id) {
      const identity = listHistoryIdentity(h.state.lists[id]);
      if (h.next) await h.next;
      if (h.fail) return { ok: false, error: 'Save refused' };
      records.set(id, { completedAt: 1000, rating: null });
      this.completionRevision += 1;
      return { ok: true, listId: id, identity };
    },
    async reopen(id) {
      records.set(id, { completedAt: null, rating: records.get(id)?.rating ?? null });
      this.completionRevision += 1;
      return { ok: true, listId: id, identity: listHistoryIdentity(h.state.lists[id]) };
    },
    async rate(id, rating) {
      if (h.fail) return { ok: false, error: 'Save refused' };
      records.set(id, { ...records.get(id), rating });
      return { ok: true, listId: id, identity: listHistoryIdentity(h.state.lists[id]) };
    },
    load() { calls.retry += 1; },
    exportBackup() { return 'normal history'; },
    exportStoredCopy() { return 'opaque copy'; },
    async restore(text) { calls.restored = text; return { ok: true }; },
  };
  h.history = history;
  h.records = records;
  h.resolves = async () => ({ suggestions: [], failures: [], cancelled: false });
  const catalog = { lists: [{ id: 'next', name: 'Next list' }] };
  const view = createCompletionView({
    el: element, elements: () => nodes, getState: () => h.state, getView: () => h.current,
    getListId: () => h.state.active, history,
    renderSavedLists: (_section, _results, options) => calls.selected.push(options),
    openList: (id) => calls.opened.push(id),
    showView: (name) => { h.current = name; },
    loadCatalog: async () => catalog,
    resolveRecommendations: (options) => h.resolves(options),
    previewRecommendation: (...args) => calls.previewed.push(args),
    askConfirm: async (options) => { calls.confirms.push(options); return h.confirmation; },
    backupFileRefusal: () => h.fileRefusal,
    download: async (...args) => { calls.downloads.push(args); return true; },
    notify: (...args) => calls.notify.push(args),
    announce: (message) => calls.announce.push(message),
    focusCurrentView: () => { calls.focus += 1; },
    createIcon: (name) => node({ icon: name }),
  });
  h.view = view;
  h.flush = async () => { await new Promise((resolve) => setImmediate(resolve)); await view.render(); };
  view.wire();
  return h;
}

function useLegacyReader(h, schemaVersion, replaceAfterSave = false) {
  const initial = schemaVersion === 1 ? {
    schemaVersion: 1,
    lists: [{ name: 'Legacy list', items: Object.values(h.state.issues).map((issue) => ({
      ...issue, read: !!h.state.read[issue.issueId], readAt: h.state.read[issue.issueId],
    })) }],
  } : {
    ...exportBackup(h.state), schemaVersion,
    lists: { ...h.state.lists, a: { ...h.state.lists.a, created: 0 } },
  };
  const map = new Map([[KEY, JSON.stringify(initial)]]);
  const storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
  const reader = new Store({ storage });
  reader.load();
  Object.defineProperty(h, 'state', { get: () => reader.state });
  let replaced = false;
  const history = new ListHistoryStore({
    readerStore: reader, locks: { request: async (_name, operation) => operation() }, clock: () => 3000,
    onChange(value) {
      if (!replaceAfterSave || replaced || ![...value.records.values()].some((record) => record.completedAt != null)) return;
      replaced = true;
      const id = reader.state.active;
      reader.update((state) => ({
        ...state, lists: { ...state.lists, [id]: { ...state.lists[id], created: state.lists[id].created + 1, note: 'Replacement note' } },
      }));
    },
  });
  history.load();
  for (const method of ['getRecord', 'isCompleted', 'completedIds', 'counts', 'complete', 'reopen', 'rate']) {
    h.history[method] = history[method].bind(history);
  }
  for (const property of ['known', 'busy', 'canSave', 'seenRaw', 'writeUnavailable', 'lastError', 'completionRevision']) {
    Object.defineProperty(h.history, property, { get: () => history[property] });
  }
  return { reader, history, map };
}

test('wrap-up completes and reopens at the existing visibility boundaries without reader-data mutation', async () => {
  const h = fixture();
  const before = JSON.stringify(h.state);
  await h.view.render();
  assert.equal(h.nodes.complete.hidden, false);
  assert.equal(h.state.read[1], 1000);
  assert.equal(h.state.lists.a.itemIds.length, 3);
  assert.deepEqual(h.state.lists.a.deferredIssueIds, [3]);
  assert.equal(h.nodes.wrapup.hidden, true);
  const allRead = fixture();
  for (const id of allRead.state.lists.a.itemIds) allRead.state = markRead(allRead.state, id, true, 2000);
  await allRead.view.render();
  assert.equal(allRead.nodes.wrapup.hidden, false);
  h.nodes.complete.listeners.click();
  await h.flush();
  assert.equal(h.nodes.complete.hidden, true);
  assert.equal(h.nodes.reopen.hidden, false);
  assert.equal(h.nodes.wrapup.hidden, false);
  assert.equal(h.nodes.reopen.focused, true);
  assert.equal(JSON.stringify(h.state), before);
  h.nodes.up.listeners.click();
  await h.flush();
  assert.equal(h.nodes.up.attributes['aria-pressed'], 'true');
  h.nodes.reopen.listeners.click();
  await h.flush();
  assert.equal(h.nodes.complete.hidden, false);
  assert.equal(h.nodes.complete.focused, true);
  assert.equal(h.history.getRecord(h.state, 'a').rating, 'up');
  assert.equal(JSON.stringify(h.state), before);

  const originalNow = Date.now;
  try {
    for (const [version, replace] of [[2, false], [3, false], [1, false], [1, true]]) {
      Date.now = () => 1000;
      const legacy = fixture();
      const native = useLegacyReader(legacy, version, replace);
      await legacy.view.render();
      const oldId = legacy.state.active;
      assert.equal(legacy.state.lists[oldId].created, 1000);
      Date.now = () => 2000;
      legacy.nodes.complete.listeners.click();
      await legacy.flush();
      const id = native.reader.state.active;
      assert.equal(JSON.parse(native.map.get(KEY)).lists[id].created, replace ? 2001 : 2000);
      assert.equal(native.history.isCompleted(native.reader.state, id), !replace);
      assert.equal(legacy.calls.announce.length, replace ? 0 : 1, `schema ${version}, replacement ${replace}`);
      assert.equal(legacy.nodes.reopen.focused === true, !replace, `schema ${version}, replacement ${replace}`);
      assert.equal(id === oldId, version !== 1);
    }
  } finally { Date.now = originalNow; }
});

test('healthy history keeps exceptional tools disclosed and incidents open without moving focus', async () => {
  const h = fixture();
  await h.view.render();
  assert.equal(h.nodes.library.children[0], h.nodes.libraryYours);
  const gateway = h.nodes.library.children.find((section) => section.id === 'library-completed');
  assert.ok(gateway);
  assert.equal(gateway.hidden, true, 'zero completed history does not lead active reading');
  await h.history.complete('a');
  await h.view.render();
  const browse = gateway.children.find((child) => child.id === 'library-completed-browse');
  assert.equal(browse.href, '#/catalog');
  assert.equal(browse.hidden, false);
  browse.onclick({ button: 0, ctrlKey: true, preventDefault() { assert.fail('native default intercepted'); } });
  browse.onclick({ button: 0, preventDefault() {} });
  assert.equal(h.current, 'catalog');
  assert.equal(h.nodes.historyTroubleshooting.open, false);
  assert.ok(h.nodes.backupHistory.children.includes(h.nodes.historyControls));
  h.history.known = false;
  h.history.lastError = 'Saved history could not be read';
  await h.view.render();
  assert.equal(browse.hidden, true, 'unknown history is not all-completed');
  assert.equal(h.nodes.historyTroubleshooting.open, true);
  assert.match(h.nodes.historyStatus.textContent, /could not be read/);
  assert.equal(h.nodes.historyRetry.disabled, false);
  assert.equal(h.nodes.historyCopy.disabled, false);
  assert.equal(h.nodes.historyRetry.focused, undefined, 'passive errors must not steal focus');
});

test('invalid completion backup gives unchanged history and next action without replacement', async () => {
  const h = fixture();
  h.current = 'data';
  h.nodes.historyRestore.files = [{ text: async () => 'not history JSON' }];
  await h.nodes.historyRestore.listeners.change({ target: h.nodes.historyRestore });
  assert.equal(h.calls.restored, undefined);
  assert.match(h.calls.notify.at(-1)[1], /^Completion history is unchanged\..*Choose a completion-history JSON backup/);
  assert.equal(h.nodes.historyRestore.disabled, false);
});

test('compact completion status exposes unavailable actions without healthy explanatory prose', async () => {
  const h = fixture();
  await h.history.complete('a');
  await h.view.render();
  assert.equal(h.nodes.status.hidden, true);
  assert.equal(h.nodes.status.textContent, '');
  for (const failure of [
    { known: false, lastError: 'History could not be read', writeUnavailable: null },
    { known: true, lastError: null, writeUnavailable: 'History is read-only' },
    { known: true, lastError: 'Save failed', writeUnavailable: null },
  ]) {
    Object.assign(h.history, failure, { canSave: false });
    await h.view.render();
    assert.equal(h.nodes.wrapup.hidden, false);
    assert.equal(h.nodes.status.hidden, false);
    assert.equal(h.nodes.status.textContent, failure.lastError || failure.writeUnavailable);
    assert.equal(h.nodes.reopen.disabled, true);
    assert.equal(h.nodes.up.disabled, true);
    Object.assign(h.history, { known: true, lastError: null, writeUnavailable: null, canSave: true });
    await h.view.render();
    assert.equal(h.nodes.status.hidden, true);
    assert.equal(h.nodes.status.textContent, '');
    assert.equal(h.nodes.reopen.disabled, false);
  }
});

test('completed gallery selects intentional and enjoyed records with truthful status details', async () => {
  const h = fixture();
  h.state = createList(h.state, { id: 'b', name: 'Second' });
  h.records.set('a', { completedAt: 1000, rating: 'up' });
  h.records.set('b', { completedAt: 2000, rating: 'down' });
  h.current = 'completed';
  await h.view.render();
  assert.deepEqual(h.calls.selected.at(-1).ids, ['a', 'b']);
  assert.equal(h.calls.selected.at(-1).status().text, 'Completed');
  assert.match(h.calls.selected.at(-1).detail(h.state, 'a'), /^Enjoyed\. Completed/);
  h.nodes.collectionFilters[1].listeners.change();
  assert.deepEqual(h.calls.selected.at(-1).ids, ['a']);
  assert.match(h.nodes.collectionCount.textContent, /2 completed.*1 enjoyed/);
  h.history.known = false;
  h.history.lastError = 'Cannot read saved history';
  await h.view.render();
  assert.match(h.nodes.collectionCount.textContent, /unavailable, not an empty/);
  assert.match(h.nodes.collectionStatus.textContent, /Cannot read saved history/);
});

test('thumb feedback remains opt-in, clears selected choices and restores dialog focus', async () => {
  const h = fixture();
  const before = JSON.stringify(h.state);
  assert.deepEqual(h.nodes.icons.children.map((child) => child.icon), ['thumb-up']);
  assert.deepEqual(h.nodes.downIcons.children.map((child) => child.icon), ['thumb-down']);
  await h.history.complete('a');
  await h.view.render();
  h.nodes.down.listeners.click();
  await h.flush();
  assert.equal(h.nodes.down.attributes['aria-pressed'], 'true');
  assert.equal(h.nodes.feedbackDialog.open, false, 'negative enjoyment saves without opening reporting');
  assert.equal(LIST_FEEDBACK_URL, feedbackUrl);
  assert.equal(h.nodes.feedbackLink.href, feedbackUrl);
  assert.equal(h.nodes.privateFeedbackLink.href, PRIVATE_FEEDBACK_URL);
  const destination = new URL(h.nodes.feedbackLink.href);
  assert.equal(destination.protocol, 'https:');
  assert.deepEqual([...destination.searchParams.keys()], ['id']);
  assert.equal(destination.hash, '');
  assert.equal(h.nodes.feedbackLink.href.includes(h.state.lists.a.name), false);
  h.nodes.feedbackGuide.listeners.click();
  h.nodes.feedbackDialog.listeners.cancel({ preventDefault() {} });
  assert.equal(h.nodes.feedbackDialog.open, false);
  assert.equal(h.nodes.feedbackGuide.focused, true);
  h.nodes.feedbackGuide.listeners.click();
  assert.equal(h.nodes.feedbackDialog.open, true);
  assert.equal(h.records.get('a').rating, 'down');
  h.nodes.feedbackClose.listeners.click();
  assert.equal(h.nodes.feedbackDialog.open, false);
  assert.equal(h.nodes.feedbackGuide.focused, true);
  assert.equal(JSON.stringify(h.state), before, 'report instructions never attach or change reading data');
  h.nodes.down.listeners.click();
  await h.flush();
  assert.equal(h.nodes.down.attributes['aria-pressed'], 'false');
  assert.equal(h.nodes.feedbackDialog.open, false);
  h.fail = true;
  const announcements = h.calls.announce.length;
  h.nodes.down.listeners.click();
  await h.flush();
  assert.equal(h.nodes.down.attributes['aria-pressed'], 'false');
  assert.equal(h.calls.announce.length, announcements);
  assert.equal(h.nodes.feedbackDialog.open, false, 'failed rating does not open instructions either');
});

test('pending completion cannot steal focus or show stale suggestions after navigation or identity replacement', async () => {
  const h = fixture();
  let release;
  h.next = new Promise((resolve) => { release = resolve; });
  h.nodes.complete.listeners.click();
  assert.equal(h.nodes.complete.disabled, true);
  h.current = 'home';
  release();
  await h.flush();
  assert.equal(h.nodes.reopen.focused, undefined);
  assert.deepEqual(h.calls.announce, []);
  const replaced = fixture();
  const hold = {};
  replaced.next = new Promise((resolve) => { hold.resolve = resolve; });
  replaced.nodes.complete.listeners.click();
  replaced.state = {
    ...replaced.state,
    lists: { ...replaced.state.lists, a: { ...replaced.state.lists.a, created: replaced.state.lists.a.created + 1 } },
  };
  hold.resolve();
  await replaced.flush();
  assert.deepEqual(replaced.calls.announce, []);
  assert.equal(replaced.nodes.reopen.focused, undefined);
  h.current = 'read';
  const pending = [];
  const signals = [];
  h.resolves = (options) => {
    signals.push(options.signal);
    return new Promise((resolve) => pending.push(resolve));
  };
  const first = h.view.render();
  await new Promise((resolve) => setImmediate(resolve));
  const oldIdentity = listHistoryIdentity(h.state.lists.a);
  h.state = { ...h.state, lists: { ...h.state.lists, a: { ...h.state.lists.a, created: h.state.lists.a.created + 1 } } };
  assert.notEqual(listHistoryIdentity(h.state.lists.a), oldIdentity);
  const second = h.view.render();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(signals[0].aborted, true);
  pending[1]({ suggestions: [], failures: [], cancelled: false });
  await second;
  pending[0]({ suggestions: [{ catalogId: 'next', name: 'Stale', reasons: [] }], failures: [], cancelled: false });
  await first;
  assert.deepEqual(h.nodes.suggestions.children, []);
});

test('suggestions open saved candidates or preview unsaved ones and expose failures with retry', async () => {
  const h = fixture();
  await h.history.complete('a');
  h.resolves = async () => ({
    suggestions: [
      { catalogId: 'next', name: 'Saved next', savedListId: 'b', reasons: [{ text: 'Next in a Reading Path.' }] },
      { catalogId: 'next', name: 'Unsaved next', reasons: [{ text: 'Includes comics by a verified writer.' }] },
    ],
    failures: [{ message: 'Candidate metadata could not be loaded.' }], cancelled: false,
  });
  await h.view.render();
  assert.equal(h.nodes.suggestions.children.length, 2);
  for (const suggestion of h.nodes.suggestions.children) {
    const button = suggestion.children[2];
    assert.ok(button['aria-label'].startsWith(button.text));
    assert.ok(button['aria-label'].includes(suggestion.children[0].text));
  }
  h.nodes.suggestions.children[0].children[2].onclick();
  h.nodes.suggestions.children[1].children[2].onclick();
  assert.deepEqual(h.calls.opened, ['b']);
  assert.equal(h.calls.previewed[0][0].id, 'next');
  assert.match(h.nodes.recommendationStatus.textContent, /Candidate metadata could not be loaded/);
  assert.equal(h.nodes.recommendationRetry.hidden, false);
  assert.equal(h.nodes.recommendationStatus.hidden, false);
  const suggestions = h.nodes.suggestions.children;
  h.resolves = async () => ({ suggestions: [], failures: [], cancelled: false });
  await h.view.refreshRecommendations({ force: true });
  assert.equal(h.nodes.suggestions.children.length, 0);
  assert.equal(h.nodes.recommendationStatus.hidden, true);
  assert.equal(h.nodes.recommendationStatus.textContent, '');
  let release;
  h.resolves = () => new Promise((resolve) => { release = resolve; });
  const loading = h.view.refreshRecommendations({ force: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.nodes.recommendationStatus.hidden, false);
  assert.match(h.nodes.recommendationStatus.textContent, /Finding/);
  assert.equal(h.nodes.recommendationRetry.hidden, true);
  release({ suggestions: [], failures: [{ message: 'Retry failed' }], cancelled: false });
  await loading;
  assert.equal(h.nodes.recommendationStatus.hidden, false);
  assert.match(h.nodes.recommendationStatus.textContent, /Retry failed/);
  assert.equal(h.nodes.recommendationRetry.hidden, false);
  h.resolves = async () => { throw new Error('Catalog unavailable'); };
  await h.view.refreshRecommendations({ force: true });
  assert.equal(h.nodes.recommendationStatus.hidden, false);
  assert.match(h.nodes.recommendationStatus.textContent, /Catalog unavailable/);
  assert.equal(h.nodes.recommendationRetry.hidden, false);
  h.resolves = async () => ({
    suggestions: [{ catalogId: 'next', name: 'Recovered next', reasons: [{ text: 'Next in a Reading Path.' }] }],
    failures: [], cancelled: false,
  });
  await h.view.refreshRecommendations({ force: true });
  assert.equal(h.nodes.suggestions.children.length, 1);
  assert.equal(h.nodes.recommendationStatus.hidden, true);
  assert.equal(h.nodes.recommendationStatus.textContent, '');
  assert.equal(h.nodes.recommendationRetry.hidden, true);
  await h.history.reopen('a');
  await h.view.render();
  suggestions[0].children[2].onclick();
  assert.deepEqual(h.calls.opened, ['b'], 'retained old DOM actions are refused after reopening');
});

test('history controls separate backups, bound file reads and confirm only valid history replacement', async () => {
  const h = fixture();
  h.current = 'data';
  h.nodes.historyExport.listeners.click();
  h.nodes.historyCopy.listeners.click();
  await h.flush();
  assert.deepEqual(h.calls.downloads.map((args) => args[1]), ['normal history', 'opaque copy']);
  let read = 0;
  const file = { text: async () => { read += 1; return JSON.stringify({ format: 'recap-page-list-history', version: 1, records: [] }); } };
  h.nodes.historyRestore.files = [file];
  h.fileRefusal = 'File is too large';
  h.nodes.historyRestore.listeners.change({ target: h.nodes.historyRestore });
  await h.flush();
  assert.equal(read, 0);
  assert.match(h.calls.notify.at(-1)[1], /too large/);
  h.fileRefusal = null;
  h.nodes.historyRestore.listeners.change({ target: h.nodes.historyRestore });
  await h.flush();
  assert.equal(read, 1);
  assert.equal(h.calls.confirms.length, 1);
  assert.match(h.calls.confirms[0].body, /no automatic Undo/);
  assert.ok(h.calls.restored);
  h.nodes.historyRetry.listeners.click();
  assert.equal(h.calls.retry, 1);
  h.history.known = false;
  h.history.seenRaw = undefined;
  await h.view.render();
  assert.equal(h.nodes.historyExport.disabled, true);
  assert.equal(h.nodes.historyRestore.disabled, true);
  assert.equal(h.nodes.historyCopy.disabled, false);
});
