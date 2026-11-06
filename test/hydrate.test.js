import test from 'node:test';
import assert from 'node:assert/strict';

import { Hydrator } from '../src/js/hydrate.js';
import { addIssuesToList, createEmptyState, createList, markRead, pendingIssueIds } from '../src/js/lib/model.js';

// `src/js/hydrate.js` had no test of any kind. It is the module that spends the rate limit, and
// three of its behaviours are the sort that only show up as a bug report weeks later: a run that
// stops without persisting what it already paid for, a single failed lookup stalling the queue,
// and a cancelled run tearing down a newer one.
//
// The last of those is the reason for the guard at the bottom of the loop, and it is the kind of
// code the repository's instructions single out: it runs only when something has already gone
// unusually, so it is the least exercised path in the module that matters most when it is wrong.

function stateWith(ids, { read = [], manual = [] } = {}) {
  let state = createList(createEmptyState(), { name: 'Order' });
  const listId = state.listOrder[0];
  const items = ids.map((id) => ({
    issueId: id,
    title: `Issue ${id}`,
    // 'import' rather than 'curated', because these stand for issues that are genuinely pending and
    // a curated item arriving with no metadata is not one: the vendoring run already asked about it
    // and came back empty, so it is now marked refused and leaves the queue. This fixture had been
    // using 'curated' to mean nothing more than "not manual", which stopped being true.
    source: manual.includes(id) ? 'manual' : 'import',
  }));
  state = addIssuesToList(state, listId, items).state;
  for (const id of read) state = markRead(state, id, true);
  return { state, listId };
}

// The real store is `src/js/storage.js`, which persists on every update. Only the update contract
// matters here, so the double records what was written rather than writing it anywhere.
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

// Each issue resolves only when the test says so, which is what makes it possible to cancel a run
// while a lookup is genuinely outstanding rather than hoping to win a race. Calls are kept as a
// list rather than a map keyed by issue id: two runs can have a lookup outstanding for the same
// issue at once, and that is exactly the situation the cancellation guards exist for, so a map
// would let the second run's call overwrite the first and quietly resolve the wrong one.
//
// `abortOnSignal` is off by default because the case that matters is the one where it does not
// fire: a call already in flight, or waiting its turn in the rate limiter, comes back normally
// after the run that issued it was cancelled.
function controllableApi({ abortOnSignal = false } = {}) {
  const calls = [];
  return {
    calls,
    get asked() {
      return calls.map((c) => c.issueId);
    },
    issue(issueId, { signal } = {}) {
      let record;
      const promise = new Promise((resolve, reject) => {
        record = {
          issueId,
          resolve,
          fail: reject,
          abort() {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          },
        };
      });
      calls.push(record);
      if (abortOnSignal) signal?.addEventListener('abort', record.abort, { once: true });
      return promise;
    },
  };
}

// One turn of the event loop, which is what it takes for a settled lookup to be picked up by the
// loop awaiting it and for the store write and progress callback that follow to have run.
const settled = () => new Promise((r) => setTimeout(r, 0));

// Several of the bugs these tests exist to catch do not make a run fail, they make it never finish:
// drop the guard that ignores a second start and the replacement run awaits a lookup nobody will
// ever answer. Awaited directly, that hangs the whole suite instead of failing it, and `node --test`
// has no default per-test timeout, so CI would sit there until the job's own limit killed it hours
// later with nothing useful to report. Every await of a promise the module owns goes through here
// so that a hang is reported as the failure it is.
function within(promise, label, ms = 2000) {
  let timer;
  const capped = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms waiting for ${label}`)), ms);
  });
  return Promise.race([Promise.resolve(promise).finally(() => clearTimeout(timer)), capped]);
}

function instantApi(answer) {
  const asked = [];
  return {
    asked,
    async issue(issueId) {
      asked.push(issueId);
      return answer(issueId);
    },
  };
}

const full = (id) => ({ issueId: id, title: `Issue ${id}`, digitalId: id * 10 });

test('nothing to hydrate reports idle rather than starting a run', async () => {
  const { state, listId } = stateWith([1, 2], {});
  const store = fakeStore(state);
  const seen = [];
  // Everything is already hydrated once upsert marks it so; here nothing is pending because the
  // list is empty of unhydrated imported issues after we mark them all hydrated.
  for (const id of [1, 2]) {
    store.update((s) => ({ ...s, issues: { ...s.issues, [id]: { ...s.issues[id], hydrated: true } } }));
  }
  const h = new Hydrator({ api: instantApi(full), store, onProgress: (p) => seen.push(p) });
  await within(h.start(listId), 'the run to finish');
  assert.deepEqual(seen.map((p) => p.phase), ['idle']);
  assert.equal(h.active, false);
});

test('a complete run persists every issue and reports its progress as it goes', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const store = fakeStore(state);
  const seen = [];
  const h = new Hydrator({ api: instantApi(full), store, onProgress: (p) => seen.push({ ...p }) });
  await within(h.start(listId), 'the run to finish');

  assert.deepEqual(seen.map((p) => p.phase), ['running', 'running', 'running', 'running', 'complete']);
  assert.deepEqual(seen.map((p) => p.done), [0, 1, 2, 3, 3]);
  assert.equal(seen[0].total, 3);
  for (const id of [1, 2, 3]) assert.equal(store.state.issues[id].hydrated, true);
  assert.equal(h.active, false);
});

// The comment above the catch says a single failed lookup must not stall the queue. Without the
// catch the first failure would reject `start` and leave every later issue unhydrated forever.
test('one failed lookup does not stop the ones behind it', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const store = fakeStore(state);
  const api = instantApi((id) => {
    if (id === 2) throw new Error('500 from upstream');
    return full(id);
  });
  const h = new Hydrator({ api, store, onProgress: () => {} });
  await within(h.start(listId), 'the run to finish');

  assert.deepEqual(api.asked, [1, 2, 3]);
  assert.equal(store.state.issues[1].hydrated, true);
  assert.equal(store.state.issues[3].hydrated, true);
  assert.notEqual(store.state.issues[2].hydrated, true, 'a failed lookup was recorded as hydrated');
});

// A lookup that comes back empty must not be recorded as hydrated, or the issue is never retried.
//
// Asserting only on `hydrated` is not enough to pin this. `upsertIssue` rejects an input with no
// issueId, so removing the `if (full)` guard leaves the stored state byte for byte identical and an
// assertion about state alone passes against the bug. What does change is that `store.update` is
// called anyway, and the real store persists to localStorage on every update, so the guard is what
// stops an empty answer costing a write. Counting the writes is what makes this test able to fail.
test('a lookup that resolves nothing is not recorded as hydrated, and costs no write', async () => {
  const { state, listId } = stateWith([1, 2]);
  const store = fakeStore(state);
  const h = new Hydrator({ api: instantApi((id) => (id === 1 ? null : full(id))), store });
  await within(h.start(listId), 'the run to finish');
  assert.notEqual(store.state.issues[1].hydrated, true);
  assert.equal(store.state.issues[2].hydrated, true);
  assert.equal(store.writes, 1, 'the empty answer was persisted anyway');
});

test('a second start while one is running is ignored rather than doubling the queue', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const store = fakeStore(state);
  const api = controllableApi();
  const h = new Hydrator({ api, store, onProgress: () => {} });

  const run = h.start(listId);
  await settled();
  assert.equal(h.active, true);

  const ignored = h.start(listId);
  await settled();
  assert.equal(api.calls.length, 1, 'the second start issued its own lookups');
  await within(ignored, 'the ignored second start to return');

  for (let i = 0; i < 3; i += 1) {
    api.calls[i].resolve(full(api.calls[i].issueId));
    await settled();
  }
  await within(run, 'the run to finish');
  assert.deepEqual(api.asked, [1, 2, 3]);
});

// The comment says partial progress is persisted as it goes, so cancelling never throws away work
// already paid for in rate limit. Cancelling after one lookup must leave that one recorded.
test('cancelling keeps the work already paid for', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const store = fakeStore(state);
  const api = controllableApi({ abortOnSignal: true });
  const seen = [];
  const h = new Hydrator({ api, store, onProgress: (p) => seen.push({ ...p }) });

  const run = h.start(listId);
  await settled();
  api.calls[0].resolve(full(1));
  await settled();

  h.cancel();
  await within(run, 'the run to finish');

  assert.equal(store.state.issues[1].hydrated, true, 'the completed lookup was thrown away');
  assert.equal(h.active, false);
  assert.equal(seen.at(-1).phase, 'cancelled');
  assert.equal(api.calls.length, 2, 'a lookup was issued after cancelling');
});

test('cancelling before anything is running still reports cancelled rather than throwing', () => {
  const seen = [];
  const h = new Hydrator({ api: instantApi(full), store: fakeStore(createEmptyState()), onProgress: (p) => seen.push(p) });
  assert.doesNotThrow(() => h.cancel());
  assert.deepEqual(seen.map((p) => p.phase), ['cancelled']);
});

// The first of the two guards in the loop, and the one whose absence is invisible until someone
// watches the progress counter. A lookup issued by a cancelled run can still come back normally,
// because aborting does not un-issue a request already in flight or already waiting its turn in
// the rate limiter. If the straggler is allowed past, it counts itself against whichever run is
// current, so the replacement run reports progress it has not made.
test('a straggler from a cancelled run does not count towards the run that replaced it', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const store = fakeStore(state);
  const api = controllableApi();
  const seen = [];
  const h = new Hydrator({ api, store, onProgress: (p) => seen.push({ ...p }) });

  const first = h.start(listId);
  await settled();
  h.cancel();

  const second = h.start(listId);
  await settled();
  assert.equal(h.active, true, 'the replacement run did not start');
  assert.equal(api.calls.length, 2, 'the replacement run did not issue its own lookup');
  seen.length = 0;

  // The cancelled run's lookup now comes back, successfully, after the replacement run exists.
  api.calls[0].resolve(full(1));
  await settled();
  await within(first, 'the cancelled run to unwind');

  assert.equal(h.done, 0, 'the straggler advanced the replacement run\'s counter');
  assert.deepEqual(seen, [], 'the straggler reported progress against the replacement run');

  for (let i = 1; i < api.calls.length; i += 1) {
    api.calls[i].resolve(full(api.calls[i].issueId));
    await settled();
  }
  await within(second, 'the replacement run to finish');
});

// The second guard, at the end of the run. A cancelled run that unwinds after a new one has
// started would otherwise set `running` false and `controller` null on its way out, and those are
// now the NEW run's fields, leaving that run invisible to the UI and impossible to cancel.
test('a cancelled run unwinding late cannot tear down the run that replaced it', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const store = fakeStore(state);
  const api = controllableApi();
  const h = new Hydrator({ api, store, onProgress: () => {} });

  const first = h.start(listId);
  await settled();
  h.cancel();
  assert.equal(h.active, false);

  const second = h.start(listId);
  await settled();
  assert.equal(h.active, true, 'the replacement run did not start');
  const replacementController = h.controller;

  // Only now does the cancelled run's outstanding lookup fail, after the replacement exists.
  api.calls[0].abort();
  await settled();
  await within(first, 'the cancelled run to unwind');

  assert.equal(h.active, true, 'the old run cleared the new run\'s running flag');
  assert.equal(h.controller, replacementController, 'the old run cleared the new run\'s controller');

  for (let i = 1; i < api.calls.length; i += 1) {
    api.calls[i].resolve(full(api.calls[i].issueId));
    await settled();
  }
  await within(second, 'the replacement run to finish');
  assert.equal(h.active, false);
});

// A run that is cancelled reports 'cancelled' rather than 'complete' even when the loop happens to
// have reached the end, because the signal is what is asked, not the counter.
test('a run aborted at the last lookup does not report itself complete', async () => {
  const { state, listId } = stateWith([1]);
  const store = fakeStore(state);
  const api = controllableApi();
  const seen = [];
  const h = new Hydrator({ api, store, onProgress: (p) => seen.push({ ...p }) });

  const run = h.start(listId);
  await settled();
  h.controller.abort();
  api.calls[0].abort();
  await within(run, 'the run to finish');

  assert.equal(seen.at(-1).phase, 'cancelled');
  assert.notEqual(seen.at(-1).phase, 'complete');
});

// Resumption is not a flag the Hydrator keeps; it falls out of asking the model what is still
// pending each time. A second run after a partial first one must pick up only what is left.
test('starting again after a partial run asks only for what is still missing', async () => {
  const { state, listId } = stateWith([1, 2, 3]);
  const store = fakeStore(state);
  const api = controllableApi({ abortOnSignal: true });
  const h = new Hydrator({ api, store, onProgress: () => {} });

  const first = h.start(listId);
  await settled();
  api.calls[0].resolve(full(1));
  await settled();
  h.cancel();
  await within(first, 'the cancelled run to unwind');

  const resumed = instantApi(full);
  const h2 = new Hydrator({ api: resumed, store, onProgress: () => {} });
  await within(h2.start(listId), 'the resumed run to finish');

  assert.deepEqual(resumed.asked.sort((a, b) => a - b), [2, 3], 'the resumed run re-fetched work already done');
});

// Priority is the model's job, but the Hydrator is the only caller that depends on it, and a
// lookahead that stopped being honoured would show up as the issue you are about to read being
// the last one to arrive.
test('what the reader is about to read is asked for first', async () => {
  const { state, listId } = stateWith([1, 2, 3, 4, 5, 6, 7, 8], { read: [1, 2, 3, 4, 5] });
  const store = fakeStore(state);
  const api = instantApi(full);
  const h = new Hydrator({ api, store, onProgress: () => {} });
  await within(h.start(listId, { lookahead: 1 }), 'the lookahead run to finish');

  assert.deepEqual(api.asked.slice(0, 2), [6, 7], 'the next unread comics were not asked for first');
  assert.equal(api.asked.length, 8);
});

test('hand-added issues are never looked up, having no upstream record to find', async () => {
  const { state, listId } = stateWith([1, 2, 3], { manual: [2] });
  const store = fakeStore(state);
  const api = instantApi(full);
  const h = new Hydrator({ api, store, onProgress: () => {} });
  await within(h.start(listId), 'the run to finish');
  assert.equal(api.asked.includes(2), false, 'a hand-added issue was looked up upstream');
  assert.deepEqual(api.asked.sort((a, b) => a - b), [1, 3]);
});

test('status carries the counters the progress display reads', async () => {
  const { state, listId } = stateWith([1, 2]);
  const store = fakeStore(state);
  const h = new Hydrator({ api: instantApi(full), store, onProgress: () => {} });
  assert.deepEqual(h.status('idle'), { phase: 'idle', done: 0, total: 0, running: false });
  await within(h.start(listId), 'the run to finish');
  assert.deepEqual(h.status('complete'), { phase: 'complete', done: 2, total: 2, running: false });
});

// ---------------------------------------------- a refusal and a hiccup are not the same failure

// The catch used to discard every error, which made a 404 and a timeout indistinguishable and left
// both in the queue. One of them belongs there and the other does not: a service that answers "no
// such issue" will answer that again, so retrying it spends the reader's request budget, held at 45
// a minute, to learn nothing. The 34 items the shipped catalog has no metadata for are all of this
// kind, so the button offering to fetch them was counting work that could not be done.
const notFound = () => {
  const err = new Error('Not found.');
  err.status = 404;
  throw err;
};

test('an issue upstream has no record of leaves the queue instead of being asked about forever', async () => {
  const { state, listId } = stateWith([1, 2]);
  const store = fakeStore(state);
  const api = instantApi((id) => (id === 1 ? notFound() : full(id)));
  const h = new Hydrator({ api, store, onProgress: () => {} });
  await within(h.start(listId), 'the run to finish');

  assert.equal(store.state.issues[1].detailsRefused, true);
  assert.notEqual(store.state.issues[1].hydrated, true, 'a refusal must not read as fetched');
  assert.deepEqual(pendingIssueIds(store.state), [], 'the refused issue is still queued for a second identical refusal');
});

// The other half of the same claim, and the one that keeps this from being a licence to drop
// anything that fails. A timeout, a busy service or a lost connection says nothing about the issue,
// so it stays pending and the next run picks it up.
test('a transient failure stays pending, because it says nothing about the issue', async () => {
  const { state, listId } = stateWith([1, 2]);
  const store = fakeStore(state);
  const api = instantApi((id) => {
    if (id === 1) throw new Error('502 from upstream');
    return full(id);
  });
  const h = new Hydrator({ api, store, onProgress: () => {} });
  await within(h.start(listId), 'the run to finish');

  assert.notEqual(store.state.issues[1].detailsRefused, true, 'a busy service was recorded as having no such issue');
  assert.deepEqual(pendingIssueIds(store.state), [1]);
});

// Recording a refusal is a write, and the module is careful elsewhere not to persist for nothing.
// One refusal costs one write; a run that meets the same refusal twice must not cost two.
test('a refusal costs one write and a second run over it costs none', async () => {
  const { state, listId } = stateWith([1]);
  const store = fakeStore(state);
  const h = new Hydrator({ api: instantApi(notFound), store, onProgress: () => {} });
  await within(h.start(listId), 'the first run to finish');
  assert.equal(store.writes, 1);
  await within(h.start(listId), 'the second run to finish');
  assert.equal(store.writes, 1, 'the second run asked again and wrote again');
});
