// BL-134: a synopsis can be fetched and shown, and cannot be kept.
//
// The promise this file defends is narrow and absolute, so it is worth stating before the tests
// that check it: prose fetched from the metadata service reaches the screen and nothing else. Not
// mrt.state.v2, not a backup, not the response cache, not the browser's own cache.
//
// Four separate mechanisms make that true and none of them is a spare. normalizeIssue drops the
// field, so no persistence path carries it. withoutSynopsis strips it before a cache write, so the
// app's own store never holds it. no-store on the request stops the browser keeping a copy the app
// cannot reach. And the runner writes nothing at all, including the 404 that the metadata hydrator
// records, because a feature whose promise is that it stores nothing must not change stored data as
// a side effect of being used.
//
// The most dangerous code here is the code that runs when something has gone wrong: the guards that
// stop a cancelled run tearing down its replacement, and the purge that must not record success it
// did not have. Those get the most tests, for the reason the repository instructions give.

import test from 'node:test';
import assert from 'node:assert/strict';

import { SessionSynopsis, SynopsisRunner, NO_SYNOPSIS } from '../src/js/synopsis.js';
import { withoutSynopsis, MarvelApi } from '../src/js/api.js';
import {
  CACHE_PURGE_KEY,
  cachePurgeMark,
  cacheCleanupFailureMessage,
  clearCacheGenerations,
  maintainCacheGeneration,
  purgeStaleCache,
  sanitizeStoredIssueDescriptions,
  synopsisAnnouncement,
  synopsisDisclaimer,
  synopsisServiceName,
  synopsisStatusLine,
  writeCachePurgeMark,
} from '../src/js/main.js';
import { Store, KEY } from '../src/js/storage.js';
import {
  addIssuesToList, createEmptyState, createList, markRead, markDetailsRefused,
  exportBackup, hydrationOrder, synopsisOrder, lookaheadPriority, MAX_DESCRIPTION,
  withoutIssueDescriptions,
} from '../src/js/lib/model.js';

function stateWith(ids, { read = [], manual = [], refused = [] } = {}) {
  let state = createList(createEmptyState(), { name: 'Order' });
  const listId = state.listOrder[0];
  const items = ids.map((id) => ({
    issueId: id,
    title: `Issue ${id}`,
    source: manual.includes(id) ? 'manual' : 'import',
  }));
  state = addIssuesToList(state, listId, items).state;
  for (const id of read) state = markRead(state, id, true);
  for (const id of refused) state = markDetailsRefused(state, id);
  return { state, listId };
}

function fakeStore(initial) {
  return {
    state: initial,
    writes: 0,
    update(fn) {
      this.state = fn(this.state);
      this.writes += 1;
      return this.state;
    },
  };
}

function instantApi(answer) {
  const asked = [];
  const opts = [];
  return {
    asked,
    opts,
    async issue(issueId, options = {}) {
      asked.push(issueId);
      opts.push(options);
      return answer(issueId);
    },
  };
}

function controllableApi() {
  const calls = [];
  return {
    calls,
    get asked() {
      return calls.map((c) => c.issueId);
    },
    issue(issueId) {
      let record;
      const promise = new Promise((resolve, reject) => {
        record = { issueId, resolve, fail: reject };
      });
      calls.push(record);
      return promise;
    },
  };
}

const settled = () => new Promise((r) => setTimeout(r, 0));

function within(promise, label, ms = 2000) {
  let timer;
  const capped = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${label}`)), ms);
  });
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(timer)), capped]);
}

const withProse = (id) => ({ issueId: id, title: `Issue ${id}`, description: `Synopsis for ${id}.` });

const notFound = () => {
  const err = new Error('Not found.');
  err.status = 404;
  throw err;
};

test('a focused issue run requests only that positive issue and writes nowhere', async () => {
  const { state } = stateWith([7, 8]);
  const store = fakeStore(state);
  const session = new SessionSynopsis();
  const api = instantApi(withProse);
  const runner = new SynopsisRunner({ api, store, session });
  await within(runner.startIssue(8), 'the focused synopsis');
  assert.deepEqual(api.asked, [8]);
  assert.equal(api.opts[0].cache, false);
  assert.equal(session.text(8), 'Synopsis for 8.');
  assert.equal(store.writes, 0);
});

test('a focused issue run refuses local ids and already-known session answers', async () => {
  const { state } = stateWith([7]);
  const store = fakeStore(state);
  const session = new SessionSynopsis();
  session.record(7, 'Already held.');
  const api = instantApi(withProse);
  const runner = new SynopsisRunner({ api, store, session });
  await runner.startIssue(-7);
  await runner.startIssue(7);
  assert.deepEqual(api.asked, []);
  assert.equal(store.writes, 0);
});

// ---------------------------------------------------------------- the session store

test('a fetched synopsis is held only in the session store, which starts empty', () => {
  const session = new SessionSynopsis();
  assert.equal(session.size, 0);
  assert.equal(session.text(1), null);
  assert.equal(session.known(1), false, 'an unasked issue must not read as answered');
});

// The three states have to stay apart. "Not asked" is what makes an issue join a queue; "asked and
// answered with nothing" is what keeps it out of the next one; and prose is what gets displayed.
// Folding the middle one into either of the others costs a request per issue per session, or shows
// a reader a blank where a sentence belongs.
test('asked-and-empty is a different answer from not-asked-yet', () => {
  const session = new SessionSynopsis();
  session.record(7, '');
  assert.equal(session.known(7), true);
  assert.equal(session.get(7), NO_SYNOPSIS);
  assert.equal(session.text(7), null, 'an empty answer is not text to display');

  session.record(8, '   ');
  assert.equal(session.get(8), NO_SYNOPSIS, 'whitespace is not a synopsis');

  session.record(9, 'Real prose.');
  assert.equal(session.text(9), 'Real prose.');
});

// 63 curated issues already carry detailsRefused, written by the metadata hydrator when the service
// answered 404. An issue the service has no record of has no synopsis either, so a run that ignored
// the field would spend 63 requests per session learning what the tracker wrote down months ago.
test('issues the service has already refused are seeded as known negatives', () => {
  const { state } = stateWith([1, 2, 3], { refused: [2] });
  const session = new SessionSynopsis();
  session.seedFrom(state);
  assert.equal(session.known(2), true);
  assert.equal(session.get(2), NO_SYNOPSIS);
  assert.equal(session.known(1), false, 'seeding must not claim anything about issues that were never refused');
});

// Read, never written. This is the one field the feature touches that also lives in saved state,
// and the direction is the whole of the promise.
test('seeding reads the refusal without writing anything back', () => {
  const { state } = stateWith([1, 2], { refused: [2] });
  const before = JSON.stringify(state);
  new SessionSynopsis().seedFrom(state);
  assert.equal(JSON.stringify(state), before, 'seeding mutated saved state');
});

test('prose already held is not overwritten by a later seed', () => {
  const { state } = stateWith([1], { refused: [1] });
  const session = new SessionSynopsis();
  session.record(1, 'Typed in from somewhere else.');
  session.seedFrom(state);
  assert.equal(session.text(1), 'Typed in from somewhere else.');
});

// ---------------------------------------------------------------- the ordering helper

// The bug this helper exists to prevent, stated as a test. Applying the predicate after the slice
// is correct on a first run and wrong on every one after it: the priority group shrinks as issues
// get answered, and the shortfall is made up from the remainder, which is not in reading order.
test('the lookahead counts issues that are actually wanted, not issues that happen to be first', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const done = new Set([1, 2, 3]);
  const got = lookaheadPriority(ids, (id) => !done.has(id), 8);
  assert.deepEqual(got, [4, 5, 6, 7, 8, 9, 10, 11, 12], 'the group must still hold nine ids after three are answered');
  assert.equal(got.length, 9);
});

test('a lookahead of 8 means the current issue plus the next eight', () => {
  const ids = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  assert.deepEqual(lookaheadPriority(ids, () => true, 8), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
});

test('a shorter list than the lookahead yields the list, not a padded one', () => {
  assert.deepEqual(lookaheadPriority([1, 2], () => true, 8), [1, 2]);
  assert.deepEqual(lookaheadPriority([], () => true, 8), []);
});

// hydrationOrder now shares the helper, so its first-run behaviour is pinned here rather than left
// to be noticed later. This is the case the old implementation got right, and it still has to hold.
test('hydration still asks for what you are about to read first', () => {
  const { state, listId } = stateWith([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], { read: [1, 2] });
  const order = hydrationOrder(state, listId, 2);
  assert.deepEqual(order.slice(0, 3), [3, 4, 5]);
  assert.equal(order.length, 10, 'everything still gets fetched eventually');
});

// ---------------------------------------------------------------- the synopsis queue

test('the queue is bounded by the list, and puts the next unread issues first', () => {
  const { state, listId } = stateWith([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], { read: [1, 2] });
  const queue = synopsisOrder(state, listId, () => true, 8);
  assert.deepEqual(queue.slice(0, 9), [3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.equal(queue.length, 12, 'read issues are fetched too, just not first');
});

test('hand-added issues are left out, having no upstream record to ask about', () => {
  const { state, listId } = stateWith([1, 2, 3], { manual: [2] });
  assert.deepEqual(synopsisOrder(state, listId, () => true, 8), [1, 3]);
});

test('a list that is not there yields no queue rather than throwing', () => {
  const { state } = stateWith([1]);
  assert.deepEqual(synopsisOrder(state, 'nope', () => true, 8), []);
});

// ---------------------------------------------------------------- the run

test('a run fetches every issue in the list and holds each synopsis in memory', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const store = fakeStore(state);
  const session = new SessionSynopsis();
  const api = instantApi(withProse);
  const runner = new SynopsisRunner({ api, store, session, onProgress: () => {} });

  await within(runner.start(listId), 'the run to finish');

  assert.deepEqual(api.asked, [1, 2, 3]);
  assert.equal(session.text(2), 'Synopsis for 2.');
  assert.equal(runner.active, false);
});

// The single most important assertion in this file. A run that wrote anything would put the prose
// back into the file BL-130 removed it from, one issue at a time.
test('a complete run costs no write to saved state at all', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const store = fakeStore(state);
  const before = JSON.stringify(store.state);
  const runner = new SynopsisRunner({ api: instantApi(withProse), store, session: new SessionSynopsis() });

  await within(runner.start(listId), 'the run to finish');

  assert.equal(store.writes, 0, 'a synopsis run wrote to saved state');
  assert.equal(JSON.stringify(store.state), before, 'saved state changed during a synopsis run');
});

// Counting writes rather than comparing state, because the two catch different mistakes: a write of
// an identical object leaves the comparison passing while still costing a localStorage round trip
// in the real store, and a 404 handler copied from Hydrator is exactly the shape that does that.
test('a 404 is remembered for the session and written nowhere', async () => {
  const { state, listId } = stateWith([1, 2]);
  const store = fakeStore(state);
  const session = new SessionSynopsis();
  const api = instantApi((id) => (id === 1 ? notFound() : withProse(id)));
  const runner = new SynopsisRunner({ api, store, session });

  await within(runner.start(listId), 'the run to finish');

  assert.equal(session.get(1), NO_SYNOPSIS, 'the refusal was not remembered, so it will be asked again');
  assert.equal(store.writes, 0, 'the refusal was persisted');
  assert.notEqual(store.state.issues[1].detailsRefused, true, 'a synopsis run marked an issue refused');
});

// The other half of that claim: a busy service says nothing about the issue, so it stays unknown and
// a later run asks again. Folding the two together would make one upstream hiccup permanent for the
// session.
test('a transient failure leaves the issue unknown rather than recorded as empty', async () => {
  const { state, listId } = stateWith([1, 2]);
  const session = new SessionSynopsis();
  const api = instantApi((id) => {
    if (id === 1) throw new Error('502 from upstream');
    return withProse(id);
  });
  const runner = new SynopsisRunner({ api, store: fakeStore(state), session });

  await within(runner.start(listId), 'the run to finish');

  assert.equal(session.known(1), false, 'a busy service was recorded as having no synopsis');
  assert.equal(session.text(2), 'Synopsis for 2.', 'and the queue carried on regardless');
});

// A cached entry has had its description stripped by the time a run reads it, so a cached read would
// answer "no synopsis" for an issue that has one, and a cached write would put back what the strip
// just removed. Both halves are the same option, which is why one assertion covers it.
test('every lookup in a run goes past the cache in both directions', async () => {
  const { state, listId } = stateWith([1, 2]);
  const api = instantApi(withProse);
  const runner = new SynopsisRunner({ api, store: fakeStore(state), session: new SessionSynopsis() });

  await within(runner.start(listId), 'the run to finish');

  assert.equal(api.opts.length, 2);
  for (const opt of api.opts) assert.equal(opt.cache, false, 'a synopsis lookup was allowed to use the cache');
});

test('a second run asks only about what the first one did not answer', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const store = fakeStore(state);
  const session = new SessionSynopsis();
  const first = instantApi(withProse);
  await within(new SynopsisRunner({ api: first, store, session }).start(listId), 'the first run');

  const second = instantApi(withProse);
  await within(new SynopsisRunner({ api: second, store, session }).start(listId), 'the second run');

  assert.deepEqual(second.asked, [], 'the second run re-fetched prose it already had');
});

test('an issue already refused in saved state is never asked about', async () => {
  const { state, listId } = stateWith([1, 2, 3], { refused: [2] });
  const api = instantApi(withProse);
  const runner = new SynopsisRunner({ api, store: fakeStore(state), session: new SessionSynopsis() });

  await within(runner.start(listId), 'the run to finish');

  assert.deepEqual(api.asked, [1, 3], 'a request was spent on an issue the tracker already knew was refused');
});

test('nothing left to ask about reports idle rather than starting a run', async () => {
  const { state, listId } = stateWith([1], { refused: [1] });
  const seen = [];
  const runner = new SynopsisRunner({
    api: instantApi(withProse), store: fakeStore(state), session: new SessionSynopsis(), onProgress: (p) => seen.push(p),
  });
  await within(runner.start(listId), 'the run to finish');
  assert.deepEqual(seen.map((p) => p.phase), ['idle']);
});

test('a second start while one is running is ignored rather than doubling the queue', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const api = controllableApi();
  const runner = new SynopsisRunner({ api, store: fakeStore(state), session: new SessionSynopsis() });

  const run = runner.start(listId);
  await settled();
  const ignored = runner.start(listId);
  await settled();
  assert.equal(api.calls.length, 1, 'the second start issued its own lookups');
  await within(ignored, 'the ignored start to return');

  for (let i = 0; i < 3; i += 1) {
    api.calls[i].resolve(withProse(api.calls[i].issueId));
    await settled();
  }
  await within(run, 'the run to finish');
});

test('cancelling keeps what already arrived and stops asking for more', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const session = new SessionSynopsis();
  const api = controllableApi();
  const seen = [];
  const runner = new SynopsisRunner({ api, store: fakeStore(state), session, onProgress: (p) => seen.push({ ...p }) });

  const run = runner.start(listId);
  await settled();
  api.calls[0].resolve(withProse(1));
  await settled();
  runner.cancel();
  api.calls[1].resolve(withProse(2));
  await within(run, 'the run to unwind');

  assert.equal(session.text(1), 'Synopsis for 1.', 'the completed lookup was thrown away');
  assert.equal(runner.active, false);
  assert.equal(seen.at(-1).phase, 'cancelled');
  assert.equal(api.calls.length, 2, 'a lookup was issued after cancelling');
});

test('cancelling before anything is running reports cancelled rather than throwing', () => {
  const seen = [];
  const runner = new SynopsisRunner({
    api: instantApi(withProse), store: fakeStore(createEmptyState()), session: new SessionSynopsis(), onProgress: (p) => seen.push(p),
  });
  assert.doesNotThrow(() => runner.cancel());
  assert.deepEqual(seen.map((p) => p.phase), ['cancelled']);
});

// The two guards copied from Hydrator, and the reason they are copied rather than assumed
// unnecessary. A lookup issued by a cancelled run can still come back normally, because aborting
// does not un-issue a request already waiting its turn in the rate limiter.
test('a straggler from a cancelled run does not count towards the run that replaced it', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const api = controllableApi();
  const seen = [];
  const runner = new SynopsisRunner({
    api, store: fakeStore(state), session: new SessionSynopsis(), onProgress: (p) => seen.push({ ...p }),
  });

  const first = runner.start(listId);
  await settled();
  runner.cancel();
  const second = runner.start(listId);
  await settled();
  assert.equal(runner.active, true, 'the replacement run did not start');
  seen.length = 0;

  api.calls[0].resolve(withProse(1));
  await settled();
  await within(first, 'the cancelled run to unwind');

  assert.equal(runner.done, 0, 'the straggler advanced the replacement run\'s counter');
  assert.deepEqual(seen, [], 'the straggler reported progress against the replacement run');

  for (let i = 1; i < api.calls.length; i += 1) {
    api.calls[i].resolve(withProse(api.calls[i].issueId));
    await settled();
  }
  await within(second, 'the replacement run to finish');
});

test('a cancelled run unwinding late cannot tear down the run that replaced it', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const api = controllableApi();
  const runner = new SynopsisRunner({ api, store: fakeStore(state), session: new SessionSynopsis() });

  const first = runner.start(listId);
  await settled();
  runner.cancel();
  const second = runner.start(listId);
  await settled();
  const replacement = runner.controller;

  api.calls[0].fail(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  await settled();
  await within(first, 'the cancelled run to unwind');

  assert.equal(runner.active, true, 'the old run cleared the new run\'s running flag');
  assert.equal(runner.controller, replacement, 'the old run cleared the new run\'s controller');

  for (let i = 1; i < api.calls.length; i += 1) {
    api.calls[i].resolve(withProse(api.calls[i].issueId));
    await settled();
  }
  await within(second, 'the replacement run to finish');
});

// ---------------------------------------------------------------- the cache strip

test('an issue record loses its synopsis and keeps everything else', () => {
  const stripped = withoutSynopsis({ id: 7, title: 'T', description: 'Prose.', digitalId: 42 });
  assert.equal('description' in stripped, false);
  assert.equal(stripped.title, 'T');
  assert.equal(stripped.digitalId, 42);
});

test('a search response loses the synopsis on every item', () => {
  const stripped = withoutSynopsis({ items: [{ id: 1, description: 'A.' }, { id: 2, description: 'B.' }] });
  assert.deepEqual(stripped.items.map((i) => 'description' in i), [false, false]);
  assert.deepEqual(stripped.items.map((i) => i.id), [1, 2]);
});

// The reason the strip checks the shape rather than removing the key wherever it appears. This one
// cache serves /health, /series, /creators and /search/issues, and a description on any of those
// means something else. A strip by key would have removed it, and the damage would have surfaced
// somewhere with nothing to connect it back to the synopsis feature.
test('a description that is not an issue synopsis survives the strip', () => {
  const service = { status: 'ok', description: 'The metadata service, version 3.' };
  assert.deepEqual(withoutSynopsis(service), service);

  const series = { seriesId: 19648, description: 'An editorial blurb this project wrote.' };
  assert.deepEqual(withoutSynopsis(series), series);
});

test('the strip leaves an unaffected response as the object it already was', () => {
  const untouched = { id: 7, title: 'T' };
  assert.equal(withoutSynopsis(untouched), untouched, 'an unaffected response was copied for nothing');
});

test('the strip does not choke on what a service might return instead of an object', () => {
  assert.equal(withoutSynopsis(null), null);
  assert.equal(withoutSynopsis(undefined), undefined);
  assert.equal(withoutSynopsis('text'), 'text');
});

// ------------------------------------------------------ what reaches saved state and backup files

test('a clean state crosses the persistence guard without a copy or warning', () => {
  const state = stateWith([7]).state;
  const warnings = [];
  assert.equal(withoutIssueDescriptions(state, 'Test boundary', (text) => warnings.push(text)), state);
  assert.deepEqual(warnings, []);
});

test('backup export refuses issue prose without changing its source', () => {
  const { state, listId } = stateWith([7]);
  const source = {
    ...state,
    issues: { ...state.issues, 7: { ...state.issues[7], description: 'Secret synopsis.' } },
    lists: { ...state.lists, [listId]: { ...state.lists[listId], description: 'Reader list notes.' } },
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (text) => warnings.push(text);
  let backup;
  try {
    backup = exportBackup(source);
  } finally {
    console.warn = originalWarn;
  }

  assert.equal('description' in backup.issues[7], false);
  assert.equal(backup.lists[listId].description, 'Reader list notes.');
  assert.equal(source.issues[7].description, 'Secret synopsis.', 'export mutated its caller');
  assert.deepEqual(warnings, ['Backup export refused 1 issue description field.']);
});

test('state update refuses issue prose before adopting or saving the change', () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
  };
  const store = new Store({ storage });
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (text) => warnings.push(text);
  try {
    store.update((state) => ({
      ...state,
      issues: { ...state.issues, 7: { issueId: 7, title: 'Seven', description: 'Secret synopsis.' } },
      read: { ...state.read, 7: true },
    }));
  } finally {
    console.warn = originalWarn;
  }

  assert.equal(store.lastUpdateOk, true);
  assert.equal('description' in store.state.issues[7], false);
  assert.equal(store.state.read[7], true);
  assert.equal('description' in JSON.parse(values.get(KEY)).issues[7], false);
  assert.deepEqual(warnings, ['State update refused 1 issue description field.']);
});

// ---------------------------------------------------------------- what reaches the wire and the cache

function fakeResponse(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => body,
  };
}

function recordingCache() {
  return {
    written: [],
    async get() { return null; },
    async set(path, value) { this.written.push({ path, value }); },
  };
}

test('the caller gets the synopsis and the cache gets a copy without it', async () => {
  const cache = recordingCache();
  const init = [];
  const api = new MarvelApi({
    cache,
    fetch: async (_url, options) => { init.push(options); return fakeResponse({ id: 7, title: 'T', description: 'Prose.' }); },
  });

  const issue = await api.issue(7);
  assert.equal(issue.description, 'Prose.', 'the caller must still get the prose it asked for');
  assert.equal(cache.written.length, 1);
  assert.equal('description' in cache.written[0].value, false, 'the cache was given the prose');
});

// The browser's own cache is the one store this app can neither read nor clear, so the directive is
// the only thing standing between a fetched synopsis and a copy on disk that outlives the tab.
test('every request carries no-store, so the browser keeps no copy either', async () => {
  const init = [];
  const api = new MarvelApi({
    cache: recordingCache(),
    fetch: async (_url, options) => { init.push(options); return fakeResponse({ id: 7 }); },
  });

  await api.issue(7);
  assert.equal(init.length, 1);
  assert.equal(init[0].cache, 'no-store');
});

// ---------------------------------------------------------------- the one-time purge

const okCache = () => ({ cleared: 0, async clear() { this.cleared += 1; return true; } });
const brokenCache = () => ({ cleared: 0, async clear() { this.cleared += 1; return false; } });

function memoryStorage(initial = {}, { failWrite = false, ignoreWrite = false } = {}) {
  const values = new Map(Object.entries(initial));
  return {
    writes: [],
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      this.writes.push([key, value]);
      if (failWrite) throw new Error('storage full');
      if (!ignoreWrite) values.set(key, value);
    },
  };
}

function cleanupCache({ active = true, legacy = { status: 'deleted', blocked: false } } = {}) {
  const activeResults = Array.isArray(active) ? [...active] : null;
  return {
    clears: 0,
    deletions: 0,
    async clear() {
      this.clears += 1;
      return activeResults ? activeResults.shift() : active;
    },
    async deleteLegacy({ onBlocked } = {}) {
      this.deletions += 1;
      if (legacy.blocked) onBlocked?.();
      return legacy;
    },
  };
}

test('the purge runs once and then never again', async () => {
  const cache = okCache();
  assert.deepEqual(await purgeStaleCache(cache, 0, 1), { ran: true, cleared: true });
  assert.deepEqual(await purgeStaleCache(cache, 1, 1), { ran: false, cleared: false });
  assert.equal(cache.cleared, 1);
});

// The finding this was written for. clear() used to swallow its own failure and return nothing, so
// the caller would advance the marker over prose still sitting in the store, permanently, because
// the marker is exactly what stops the retry. Reporting the outcome is what makes the retry possible.
test('a purge that failed is not recorded as done, so the next boot tries again', async () => {
  const cache = brokenCache();
  assert.deepEqual(await purgeStaleCache(cache, 0, 1), { ran: true, cleared: false });
  assert.deepEqual(await purgeStaleCache(cache, 0, 1), { ran: true, cleared: false });
  assert.equal(cache.cleared, 2, 'a failed purge was not retried');
});

test('a marker from a newer build is left alone rather than treated as behind', async () => {
  const cache = okCache();
  assert.deepEqual(await purgeStaleCache(cache, 5, 1), { ran: false, cleared: false });
  assert.equal(cache.cleared, 0);
});

test('the dedicated purge marker migrates from the maximum valid dedicated or legacy value', () => {
  const storage = memoryStorage({
    [CACHE_PURGE_KEY]: '3',
    'mrt.settings': JSON.stringify({ cachePurge: 5 }),
  });
  assert.equal(cachePurgeMark(storage), 5);

  const dedicatedWins = memoryStorage({
    [CACHE_PURGE_KEY]: '8',
    'mrt.settings': JSON.stringify({ cachePurge: 2 }),
  });
  assert.equal(cachePurgeMark(dedicatedWins), 8);
});

test('invalid dedicated and legacy purge values are ignored explicitly', () => {
  for (const value of [
    '', '-1', '1.5', 'Infinity', 'unsafe', String(Number.MAX_SAFE_INTEGER + 1),
    true, false, [1], { value: 1 },
  ]) {
    const storage = memoryStorage({
      [CACHE_PURGE_KEY]: value,
      'mrt.settings': JSON.stringify({ cachePurge: value }),
    });
    assert.equal(cachePurgeMark(storage), 0, `accepted invalid marker ${JSON.stringify(value)}`);
  }
  assert.equal(cachePurgeMark(memoryStorage({
    [CACHE_PURGE_KEY]: '4',
    'mrt.settings': '{not json',
  })), 4, 'malformed legacy settings hid a valid dedicated marker');
});

function serialLocks() {
  const names = [];
  let tail = Promise.resolve();
  return {
    names,
    request(name, callback) {
      names.push(name);
      const result = tail.then(callback);
      tail = result.catch(() => {});
      return result;
    },
  };
}

test('writing the dedicated marker migrates legacy state and never moves backwards', async () => {
  const storage = memoryStorage({ 'mrt.settings': JSON.stringify({ cachePurge: 3 }) });
  const locks = serialLocks();
  assert.equal(await writeCachePurgeMark(storage, 1, locks), 3);
  assert.deepEqual(storage.writes, [[CACHE_PURGE_KEY, '3']]);

  assert.equal(await writeCachePurgeMark(storage, 2, locks), 3);
  assert.equal(storage.writes.length, 1, 'an idempotent lower write touched storage again');
  assert.deepEqual(locks.names, [CACHE_PURGE_KEY, CACHE_PURGE_KEY]);
});

test('current tabs serialize marker updates so a lower generation cannot win a race', async () => {
  const storage = memoryStorage();
  const locks = serialLocks();
  await Promise.all([
    writeCachePurgeMark(storage, 5, locks),
    writeCachePurgeMark(storage, 1, locks),
  ]);
  assert.equal(storage.getItem(CACHE_PURGE_KEY), '5');
});

test('a missing lock and a failed or ineffective marker write are surfaced', async () => {
  await assert.rejects(
    () => writeCachePurgeMark(memoryStorage(), 1, null),
    /lock/i,
  );
  await assert.rejects(
    () => writeCachePurgeMark(memoryStorage({}, { failWrite: true }), 1, serialLocks()),
    /storage full/,
  );
  await assert.rejects(
    () => writeCachePurgeMark(memoryStorage({}, { ignoreWrite: true }), 1, serialLocks()),
    /could not be verified/i,
  );
});

test('a current marker preserves active cache entries but still retires the legacy database', async () => {
  const cache = cleanupCache();
  assert.deepEqual(await maintainCacheGeneration(cache, 1, 1), {
    ran: false,
    activeCleared: true,
    legacy: { status: 'deleted', blocked: false },
  });
  assert.equal(cache.clears, 0);
  assert.equal(cache.deletions, 1);
});

test('automatic cleanup treats entirely unavailable IndexedDB as nothing reachable to remove', async () => {
  const cache = {
    available: false,
    async clear() { return false; },
    async deleteLegacy() {
      return { status: 'unavailable', blocked: false, error: null };
    },
  };
  const result = await maintainCacheGeneration(cache, 0, 1);

  assert.deepEqual(result, {
    ran: true,
    activeCleared: true,
    storageUnavailable: true,
    legacy: { status: 'unavailable', blocked: false, error: null },
  });
  assert.equal(cacheCleanupFailureMessage(result), '');

  const storage = memoryStorage();
  await writeCachePurgeMark(storage, 1, serialLocks());
  assert.equal(storage.getItem(CACHE_PURGE_KEY), '1');
});

test('generation maintenance reports active clear failure, blocked cleanup, and deletion failure', async () => {
  let blocked = 0;
  const partial = cleanupCache({
    active: false,
    legacy: { status: 'deleted', blocked: true },
  });
  assert.deepEqual(
    await maintainCacheGeneration(partial, 0, 1, { onLegacyBlocked: () => { blocked += 1; } }),
    {
      ran: true,
      activeCleared: false,
      legacy: { status: 'deleted', blocked: true },
    },
  );
  assert.equal(blocked, 1);

  const failed = cleanupCache({ legacy: { status: 'failed', blocked: false, error: new Error('delete failed') } });
  const result = await clearCacheGenerations(failed);
  assert.equal(result.activeCleared, true);
  assert.equal(result.legacy.status, 'failed');
  assert.match(result.legacy.error.message, /delete failed/);
});

test('manual cleanup clears the active generation again after a blocked legacy deletion', async () => {
  const cache = cleanupCache({
    active: [true, false],
    legacy: { status: 'deleted', blocked: true },
  });
  const result = await clearCacheGenerations(cache);
  assert.equal(cache.clears, 2);
  assert.equal(result.activeCleared, false, 'a failed final clear was reported as successful');
});

test('foreign saved-state prose is removed independently of the cache marker', () => {
  const raw = JSON.stringify({
    ...createEmptyState(),
    issues: { 7: { issueId: 7, title: 'Seven', description: 'Legacy synopsis.' } },
  });
  const storage = memoryStorage({ [KEY]: raw });
  const readerStore = new Store({ storage });
  readerStore.load();

  const result = sanitizeStoredIssueDescriptions(readerStore, raw);
  assert.deepEqual(result, { needed: true, cleared: true });
  assert.equal('description' in JSON.parse(storage.getItem(KEY)).issues[7], false);
});

test('boot sanitation resynchronizes the live store so the first real edit is not refused', () => {
  const raw = JSON.stringify({
    ...createEmptyState(),
    issues: { 7: { issueId: 7, title: 'Seven', description: 'Legacy synopsis.' } },
  });
  const storage = memoryStorage({ [KEY]: raw });
  const readerStore = new Store({ storage });
  readerStore.load();

  assert.deepEqual(
    sanitizeStoredIssueDescriptions(readerStore, raw, { adoptCurrent: true }),
    { needed: true, cleared: true },
  );
  readerStore.update((state) => ({ ...state, read: { ...state.read, 7: true } }));
  assert.equal(readerStore.lastUpdateOk, true);
  assert.equal(JSON.parse(storage.getItem(KEY)).read[7], true);
});

test('foreign saved-state prose is sanitized without disturbing a blocked recovery incident', () => {
  const recoveryRaw = JSON.stringify({ schemaVersion: 99, marker: 'recovery bytes' });
  const storage = memoryStorage({ [KEY]: recoveryRaw });
  const readerStore = new Store({ storage });
  readerStore.load();
  assert.equal(readerStore.blocked, true);
  const salvageKey = readerStore.salvageKey;

  const foreignRaw = JSON.stringify({
    ...createEmptyState(),
    issues: { 7: { issueId: 7, title: 'Seven', description: 'Legacy synopsis.' } },
  });
  storage.setItem(KEY, foreignRaw);
  const failures = [];
  const result = sanitizeStoredIssueDescriptions(readerStore, foreignRaw, {
    onFailure: (error) => failures.push(error),
  });

  assert.deepEqual(result, { needed: true, cleared: true });
  assert.deepEqual(failures, []);
  assert.equal(readerStore.blocked, true, 'sanitation cleared the unrelated recovery latch');
  assert.equal(storage.getItem(salvageKey), recoveryRaw, 'sanitation changed the recovery copy');
  assert.equal('description' in JSON.parse(storage.getItem(KEY)).issues[7], false);
});

test('a failed saved-state sanitation is reported and remains retryable', () => {
  const raw = JSON.stringify({
    ...createEmptyState(),
    issues: { 7: { issueId: 7, title: 'Seven', description: 'Legacy synopsis.' } },
  });
  const storage = memoryStorage({ [KEY]: raw }, { failWrite: true });
  const readerStore = new Store({ storage });
  readerStore.load();
  const failures = [];

  assert.deepEqual(
    sanitizeStoredIssueDescriptions(readerStore, raw, {
      onFailure: (error) => failures.push(error),
    }),
    { needed: true, cleared: false },
  );
  assert.equal(failures.length, 1);
  assert.match(failures[0], /could not save/i);
  assert.equal(JSON.parse(storage.getItem(KEY)).issues[7].description, 'Legacy synopsis.');
});

test('a silently ignored saved-state sanitation is detected by reading durable state back', () => {
  const raw = JSON.stringify({
    ...createEmptyState(),
    issues: { 7: { issueId: 7, title: 'Seven', description: 'Legacy synopsis.' } },
  });
  const storage = memoryStorage({ [KEY]: raw }, { ignoreWrite: true });
  const readerStore = new Store({ storage });
  readerStore.load();
  const failures = [];

  assert.deepEqual(
    sanitizeStoredIssueDescriptions(readerStore, raw, {
      onFailure: (error) => failures.push(error),
    }),
    { needed: true, cleared: false },
  );
  assert.deepEqual(failures, ['The saved-state cleanup write could not be verified.']);
  assert.equal(JSON.parse(storage.getItem(KEY)).issues[7].description, 'Legacy synopsis.');
});

test('a queued old sanitation event cannot overwrite newer tokenless saved data', () => {
  const olderRaw = JSON.stringify({
    ...createEmptyState(),
    issues: { 7: { issueId: 7, title: 'Seven', description: 'Older synopsis.' } },
  });
  const newerRaw = JSON.stringify({
    ...createEmptyState(),
    issues: { 8: { issueId: 8, title: 'Eight', description: 'Newer synopsis.' } },
  });
  const storage = memoryStorage({ [KEY]: olderRaw });
  const readerStore = new Store({ storage });
  readerStore.load();
  storage.setItem(KEY, newerRaw);

  assert.deepEqual(
    sanitizeStoredIssueDescriptions(readerStore, olderRaw),
    { needed: true, cleared: true },
  );
  const durable = JSON.parse(storage.getItem(KEY));
  assert.equal('7' in durable.issues, false, 'the queued old event replaced newer saved data');
  assert.equal(durable.issues[8].title, 'Eight');
  assert.equal('description' in durable.issues[8], false);
});

test('unsupported current foreign state is preserved and its sanitation failure is surfaced', () => {
  const raw = JSON.stringify({
    schemaVersion: 99,
    issues: { 7: { issueId: 7, description: 'Unknown-schema synopsis.' } },
  });
  const storage = memoryStorage({ [KEY]: raw });
  const readerStore = new Store({ storage });
  const failures = [];

  assert.deepEqual(
    sanitizeStoredIssueDescriptions(readerStore, raw, {
      onFailure: (error) => failures.push(error),
    }),
    { needed: true, cleared: false },
  );
  assert.equal(storage.getItem(KEY), raw);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /unsupported schema|could not be read safely/i);
});

test('saved data changing during sanitation is re-read and only the newer bytes are cleaned', () => {
  const firstRaw = JSON.stringify({
    ...createEmptyState(),
    issues: { 7: { issueId: 7, title: 'Seven', description: 'First synopsis.' } },
  });
  const newerRaw = JSON.stringify({
    ...createEmptyState(),
    issues: { 8: { issueId: 8, title: 'Eight', description: 'Newer synopsis.' } },
  });
  let current = firstRaw;
  let reads = 0;
  const storage = {
    getItem() {
      reads += 1;
      if (reads === 2) current = newerRaw;
      return current;
    },
    setItem(_key, value) {
      current = value;
    },
  };
  const readerStore = new Store({ storage });
  const failures = [];

  assert.deepEqual(
    sanitizeStoredIssueDescriptions(readerStore, firstRaw, {
      onFailure: (error) => failures.push(error),
    }),
    { needed: true, cleared: true },
  );
  const durable = JSON.parse(current);
  assert.deepEqual(failures, []);
  assert.equal('7' in durable.issues, false);
  assert.equal(durable.issues[8].title, 'Eight');
  assert.equal('description' in durable.issues[8], false);
});


// ------------------------------------------------- what a run says about itself when it goes wrong

// Both reviews of this change found the same thing independently: a run in which every single lookup
// failed still ended by saying "All synopses fetched". Nothing else on screen contradicted it,
// because there is deliberately no pending count for this feature, so the false sentence stood on
// its own. A 404 is not a failure and must not count as one: the service answered, and the answer
// was that it holds no record.
test('a run that reached nothing does not claim every synopsis was fetched', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const phases = [];
  const api = instantApi(() => { throw new TypeError('Failed to fetch'); });
  const runner = new SynopsisRunner({
    api, store: fakeStore(state), session: new SessionSynopsis(), onProgress: (s) => phases.push(s.phase),
  });

  await within(runner.start(listId), 'the run to finish');

  assert.equal(phases.at(-1), 'partial', 'a run that fetched nothing reported success');
  assert.equal(runner.failed, 3);
});

test('a run that reached some of them reports how many it could not', async () => {
  const { state, listId } = stateWith([1, 2, 3, 4]);
  const session = new SessionSynopsis();
  let last = null;
  const api = instantApi((id) => {
    if (id === 2) throw new TypeError('Failed to fetch');
    return withProse(id);
  });
  const runner = new SynopsisRunner({ api, store: fakeStore(state), session, onProgress: (s) => { last = s; } });

  await within(runner.start(listId), 'the run to finish');

  assert.equal(last.phase, 'partial');
  assert.equal(last.failed, 1);
  assert.equal(last.total, 4);
  assert.equal(session.text(3), 'Synopsis for 3.', 'the run stopped early instead of carrying on');
});

test('an issue the service has no record of is an answer, not a failure', async () => {
  const { state, listId } = stateWith([1, 2]);
  let last = null;
  const runner = new SynopsisRunner({
    api: instantApi((id) => (id === 1 ? notFound() : withProse(id))),
    store: fakeStore(state),
    session: new SessionSynopsis(),
    onProgress: (s) => { last = s; },
  });

  await within(runner.start(listId), 'the run to finish');

  assert.equal(last.phase, 'complete', 'a 404 was counted as a failure to reach the service');
  assert.equal(last.failed, 0);
});

// A request already in flight when the reader presses stop can still resolve normally. Recording it
// would put a synopsis on screen that the "Stopped after n of m" count beside it does not include,
// which is the app disagreeing with itself about what it just did.
test('a synopsis that lands after the stop is not recorded', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const session = new SessionSynopsis();
  const api = controllableApi();
  const runner = new SynopsisRunner({ api, store: fakeStore(state), session });

  const run = runner.start(listId);
  await settled();
  runner.cancel();
  api.calls[0].resolve(withProse(1));
  await settled();
  await within(run, 'the cancelled run to unwind');

  assert.equal(session.known(1), false, 'a response that arrived after the stop was kept anyway');
  assert.equal(session.size, 0);
});

// ------------------------------------------------------------------ bounds on what is held

// normalizeIssue was the only place issue prose ever met MAX_DESCRIPTION, and this feature removed
// that line, so the cap had to move with the prose. It is textContent on the way to the screen, so
// nothing is injected; what an unbounded value costs is memory and layout.
test('prose is capped at the same length every other admitted field is', () => {
  const session = new SessionSynopsis();
  session.record(7, 'x'.repeat(MAX_DESCRIPTION * 3));
  assert.equal(session.text(7).length, MAX_DESCRIPTION);
});

test('a synopsis inside the cap is kept whole', () => {
  const session = new SessionSynopsis();
  const prose = 'y'.repeat(MAX_DESCRIPTION);
  session.record(7, prose);
  assert.equal(session.text(7), prose);
});

// ------------------------------------------------------------------ the tail of the queue

// The same defect lookaheadPriority was written to fix, one step further down the queue. Building
// the tail by filtering the list keeps list order, so issues already read sit ahead of unread ones
// further along. A reader a hundred issues into an order would spend the first minutes of the run on
// prose for issues they had already finished, and none of it survives the tab to make that back.
test('the tail puts unread issues ahead of ones already read', () => {
  const ids = Array.from({ length: 30 }, (_, i) => i + 1);
  const { state, listId } = stateWith(ids, { read: [1, 2, 3, 4, 5] });
  const order = synopsisOrder(state, listId, () => true, 8);

  assert.deepEqual(order.slice(0, 9), [6, 7, 8, 9, 10, 11, 12, 13, 14]);
  const firstRead = order.findIndex((id) => id <= 5);
  const lastUnread = order.reduce((at, id, i) => (id > 5 ? i : at), -1);
  assert.ok(firstRead > lastUnread, `an issue already read was queued at ${firstRead}, before an unread one at ${lastUnread}`);
});

test('every issue is still asked about exactly once', () => {
  const ids = Array.from({ length: 30 }, (_, i) => i + 1);
  const { state, listId } = stateWith(ids, { read: [1, 2, 3, 4, 5] });
  const order = synopsisOrder(state, listId, () => true, 8);
  assert.equal(order.length, 30);
  assert.equal(new Set(order).size, 30);
});

// ------------------------------------------------------------------ what the disclaimer names

// The dialog exists to say where the prose comes from before the reader agrees to fetch it. The API
// base is theirs to change, so a hard-coded host means a reader who has pointed the app somewhere
// else is shown the name of a third party the request will not go to, which defeats the control the
// dialog is.
test('the disclaimer names the service that will actually be asked', () => {
  assert.equal(synopsisServiceName('https://marvel.emreparker.com/v1'), 'marvel.emreparker.com');
  assert.match(synopsisDisclaimer('https://mirror.example.org/v1').body, /mirror\.example\.org/);
  assert.doesNotMatch(synopsisDisclaimer('https://mirror.example.org/v1').body, /emreparker/);
});

test('a base that is not a usable URL is described in words rather than guessed at', () => {
  assert.equal(synopsisServiceName('not a url'), 'the community Marvel metadata service');
  assert.equal(synopsisServiceName(undefined), 'the community Marvel metadata service');
});

test('the disclaimer still makes all four promises about what is not kept', () => {
  const { body } = synopsisDisclaimer('https://marvel.emreparker.com/v1');
  assert.match(body, /held for this browser tab only/);
  assert.match(body, /not written into your lists/);
  assert.match(body, /not included in a backup/);
  assert.match(body, /gone when you reload/);
});

test('a run that could not reach some issues is announced as such, not as finished', () => {
  const said = synopsisAnnouncement({ phase: 'partial', done: 4, total: 4, failed: 1 });
  assert.equal(said.state, 'partial');
  assert.match(said.msg, /1 issue could not be reached/);
  assert.doesNotMatch(said.msg, /All synopses fetched/);
});

// ------------------------------------------------------- what a stopped run says it got through

// The partial ending stopped a finished run claiming answers it never got, but the same count runs
// through the stopped ending, and done is incremented for a refused request exactly as it is for an
// answered one. So a reader who stopped a run that had been failing saw the failures counted as
// fetches, next to a hero still saying no synopsis is recorded for the issue in front of them.
test('a stopped run does not count the requests that were refused', () => {
  const line = synopsisStatusLine({ phase: 'cancelled', done: 3, total: 5, failed: 2 });
  assert.match(line, /Stopped after 1 of 5/);
  assert.match(line, /2 could not be reached/);
});

test('a stopped run that lost nothing is still counted plainly', () => {
  const line = synopsisStatusLine({ phase: 'cancelled', done: 3, total: 5, failed: 0 });
  assert.equal(line, 'Stopped after 3 of 5.');
});

test('the spoken form of a stopped run says how many it could not reach', () => {
  const said = synopsisAnnouncement({ phase: 'cancelled', done: 3, total: 5, failed: 2 });
  assert.equal(said.state, 'cancelled');
  assert.match(said.msg, /2 issues could not be reached/);
  assert.match(said.msg, /What arrived is on screen until you reload/);
});

test('the spoken form of a clean stop does not mention failures at all', () => {
  const said = synopsisAnnouncement({ phase: 'cancelled', done: 3, total: 5, failed: 0 });
  assert.doesNotMatch(said.msg, /could not be reached/);
});

// The counts above are hand-built. This one drives the real runner, so the arithmetic is pinned
// against what a run actually reports rather than against an assumption about it.
test('what a real stopped run says matches the answers it actually holds', async () => {
  const { state, listId } = stateWith([1, 2, 3, 4, 5]);
  const session = new SessionSynopsis();
  let last = null;
  const api = instantApi((id) => {
    if (id === 1) return withProse(1);
    if (id === 2 || id === 3) throw new TypeError('Failed to fetch');
    return withProse(id);
  });
  const runner = new SynopsisRunner({
    api,
    store: fakeStore(state),
    session,
    onProgress: (s) => { if (s.phase === 'running' && s.done === 3) runner.cancel(); else if (s.phase === 'cancelled') last = s; },
  });

  await within(runner.start(listId), 'the stopped run to unwind');

  assert.equal(last.phase, 'cancelled');
  assert.equal(session.size, 1, 'the run held a different number of answers than the test assumed');
  assert.match(synopsisStatusLine(last), new RegExp(`Stopped after ${session.size} of 5`));
});

// Fixing the stopped ending without the running one left the two disagreeing, which is worse than
// leaving both wrong: the reader watched the number climb to 3 and pressing stop rewrote it to 1.
// A count that moves backwards at the moment it is being read is the failure the subtraction is
// meant to prevent, not a smaller version of it.
test('the running line does not count the requests that were refused', () => {
  const line = synopsisStatusLine({ phase: 'running', done: 3, total: 5, failed: 2 });
  assert.match(line, /Fetching synopses 1 of 5/);
  assert.match(line, /2 could not be reached/);
});

test('the running line stays plain until something is actually lost', () => {
  const line = synopsisStatusLine({ phase: 'running', done: 3, total: 5, failed: 0 });
  assert.equal(line, 'Fetching synopses 3 of 5\u2026');
});

// The whole point of the subtraction is that these two agree, so this asserts them against each
// other rather than against a number written into the test.
test('the count does not jump when a failing run is stopped', async () => {
  const { state, listId } = stateWith([1, 2, 3, 4, 5]);
  const session = new SessionSynopsis();
  let lastRunning = null;
  let cancelled = null;
  const api = instantApi((id) => {
    if (id === 1) return withProse(1);
    if (id === 2 || id === 3) throw new TypeError('Failed to fetch');
    return withProse(id);
  });
  const runner = new SynopsisRunner({
    api,
    store: fakeStore(state),
    session,
    onProgress: (s) => {
      if (s.phase === 'running') {
        lastRunning = synopsisStatusLine(s);
        if (s.done === 3) runner.cancel();
      } else if (s.phase === 'cancelled') cancelled = synopsisStatusLine(s);
    },
  });

  await within(runner.start(listId), 'the stopped run to unwind');

  const shown = (line) => Number(/(\d+) of 5/.exec(line)[1]);
  assert.equal(session.size, 1, 'the run held a different number of answers than the test assumed');
  assert.equal(shown(lastRunning), shown(cancelled), `"${lastRunning}" then "${cancelled}"`);
  assert.equal(shown(cancelled), session.size);
});

// Exported now, so it can be called by something that does not repeat renderSynopsis's own guard.
test('the status line says nothing at all before a run starts', () => {
  assert.equal(synopsisStatusLine(null), '');
  assert.equal(synopsisStatusLine(undefined), '');
  assert.equal(synopsisStatusLine({ phase: 'idle' }), '');
});
