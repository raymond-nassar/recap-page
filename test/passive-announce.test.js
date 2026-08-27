// Announcements for surfaces that change without moving focus.
//
// Every one of these writes repeats in ordinary use, so a test that only observed the first call
// would miss the repetition the item was filed to fix. These drive the real call sequences instead
// and count what a reader hears across the whole of one.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  announceChannel,
  stateAnnouncer,
  passiveAnnouncer,
  hydrationAnnouncement,
  withSaveEducation,
} from '../src/js/main.js';
import { SAVE_EDUCATION_STATE } from '../src/js/lib/saveEducation.js';

function heard() {
  const said = [];
  return { said, speak: (m) => said.push(m) };
}

// Replays what Hydrator does to onProgress: one 'running' when the queue is built, one more per
// issue finished, then a single closing phase. `src/js/hydrate.js:50-85`.
function runHydration(announce, { total, stopAfter = null }) {
  announce(hydrationAnnouncement({ phase: 'running', done: 0, total }));
  const last = stopAfter ?? total;
  for (let done = 1; done <= last; done += 1) {
    announce(hydrationAnnouncement({ phase: 'running', done, total }));
  }
  const closing = stopAfter === null ? 'complete' : 'cancelled';
  announce(hydrationAnnouncement({ phase: closing, done: last, total }));
}

function hydrationHarness() {
  const rec = heard();
  const state = passiveAnnouncer(rec.speak);
  return { said: rec.said, announce: (a) => state('hydration', a.state, a.msg) };
}

test('a twenty issue run is announced twice, not twenty-two times', () => {
  const h = hydrationHarness();
  runHydration(h.announce, { total: 20 });
  assert.deepEqual(h.said, [
    'Fetching details for 20 issues.',
    'All issue details fetched.',
  ]);
});

test('a stopped run says it stopped once, however far it got', () => {
  const h = hydrationHarness();
  runHydration(h.announce, { total: 20, stopAfter: 7 });
  assert.deepEqual(h.said, [
    'Fetching details for 20 issues.',
    'Detail fetching stopped. Progress was kept.',
  ]);
});

test('a second run over the same list announces its own start', () => {
  const h = hydrationHarness();
  runHydration(h.announce, { total: 20 });
  runHydration(h.announce, { total: 3 });
  assert.deepEqual(h.said, [
    'Fetching details for 20 issues.',
    'All issue details fetched.',
    'Fetching details for 3 issues.',
    'All issue details fetched.',
  ]);
});

// Hydrator.start reports 'idle' and returns when there is nothing pending, so this is what
// pressing the button with a fully hydrated list produces.
test('starting with nothing to fetch says nothing', () => {
  const h = hydrationHarness();
  h.announce(hydrationAnnouncement({ phase: 'idle', done: 0, total: 0 }));
  h.announce(hydrationAnnouncement(null));
  assert.deepEqual(h.said, []);
});

test('an idle report mid-session is silent and does not suppress the run after it', () => {
  const h = hydrationHarness();
  runHydration(h.announce, { total: 4 });
  h.announce(hydrationAnnouncement(null));
  runHydration(h.announce, { total: 4 });
  assert.deepEqual(h.said, [
    'Fetching details for 4 issues.',
    'All issue details fetched.',
    'Fetching details for 4 issues.',
    'All issue details fetched.',
  ]);
});

test('one issue is announced in the singular', () => {
  const h = hydrationHarness();
  runHydration(h.announce, { total: 1 });
  assert.equal(h.said[0], 'Fetching details for 1 issue.');
});

// The guard silences a repeated state, so two phases sharing a state would silence whichever of
// their two messages arrived second. Found by mutation: relabelling 'cancelled' as 'complete'
// changed what a reader could hear and no other test here noticed.
test('every phase gets a state of its own', () => {
  const phases = ['idle', 'running', 'cancelled', 'complete'];
  const seen = phases.map((phase) => hydrationAnnouncement({ phase, done: 1, total: 2 }));
  assert.deepEqual(seen.map((s) => s.state), phases);
  assert.equal(new Set(seen.map((s) => s.msg)).size, phases.length);
});

test('an unreachable service speaks once however often it is rechecked', () => {
  const rec = heard();
  const state = passiveAnnouncer(rec.speak);
  state('api', 'down', 'unreachable');
  state('api', 'down', 'unreachable');
  state('api', 'down', 'unreachable');
  assert.deepEqual(rec.said, ['unreachable']);
});

// The seed is the point: a boot that finds the service healthy has confirmed the assumption a
// reader already holds, and saying so would be noise on every single load.
test('a healthy boot is silent but a failed one speaks', () => {
  const ok = heard();
  passiveAnnouncer(ok.speak)('api', 'ok', 'reachable again');
  assert.deepEqual(ok.said, []);

  const bad = heard();
  passiveAnnouncer(bad.speak)('api', 'down', 'unreachable');
  assert.deepEqual(bad.said, ['unreachable']);
});

test('recovery after a failure is announced', () => {
  const rec = heard();
  const state = passiveAnnouncer(rec.speak);
  state('api', 'down', 'unreachable');
  state('api', 'ok', 'reachable again');
  state('api', 'ok', 'reachable again');
  state('api', 'down', 'unreachable');
  assert.deepEqual(rec.said, ['unreachable', 'reachable again', 'unreachable']);
});

test('keys do not interfere with each other', () => {
  const rec = heard();
  const state = stateAnnouncer(rec.speak);
  state('a', 'x', 'a-x');
  state('b', 'x', 'b-x');
  state('a', 'x', 'a-x again');
  assert.deepEqual(rec.said, ['a-x', 'b-x']);
});

test('a state carrying no message still moves the key', () => {
  const rec = heard();
  const state = stateAnnouncer(rec.speak);
  assert.equal(state('k', 'quiet', null), true);
  assert.equal(state('k', 'quiet', 'should not be heard'), false);
  assert.deepEqual(rec.said, []);
});

// The channel below is the element-facing half, and it is where giving hydration a start
// announcement did real damage. These drive it the way the app does: through a fake tick, so a
// whole synchronous burst can be replayed and then flushed, which is the shape a browser produces
// and the shape the harness above deliberately cannot.
function channel() {
  const node = { textContent: 'stale' };
  const opens = [];
  const timers = [];
  const announce = announceChannel(
    () => {
      opens.push(node.textContent);
      node.textContent = '';
      return (msg) => { node.textContent = msg; };
    },
    (fn) => timers.push(fn),
  );
  return {
    announce,
    node,
    opens,
    tick: () => { const due = timers.splice(0); for (const fn of due) fn(); },
    pending: () => timers.length,
  };
}

// This is addToActive: it confirms the add, then starts the hydrator, whose start() reports
// 'running' before its first await. `src/js/main.js:3672-3675` and `src/js/hydrate.js:50`.
test('a confirmation and the hydration start raised together are both heard', () => {
  const c = channel();
  c.announce('Added 20 issues to Reading.');
  c.announce('Fetching details for 20 issues.');
  c.tick();
  assert.equal(c.node.textContent, 'Added 20 issues to Reading. Fetching details for 20 issues.');
});

// The defect was not that the text was wrong but that there was only ever one timer's worth of it,
// so the second write overwrote the first with nothing rendered in between.
test('messages raised in one tick are one utterance, not two writes racing', () => {
  const c = channel();
  c.announce('first');
  c.announce('second');
  c.announce('third');
  assert.equal(c.pending(), 1, 'a burst must schedule one write, not one per message');
  c.tick();
  assert.equal(c.node.textContent, 'first second third');
  assert.deepEqual(c.opens, ['stale'], 'the region is cleared once per utterance, not per message');
});

// Clearing is what makes a screen reader re-announce a repeated message, so an utterance that
// never cleared would be silent whenever it repeated the previous one.
test('a later tick is a fresh utterance and clears the region again', () => {
  const c = channel();
  c.announce('List deleted.');
  c.tick();
  c.announce('List deleted.');
  c.tick();
  assert.equal(c.node.textContent, 'List deleted.');
  assert.deepEqual(c.opens, ['stale', 'List deleted.']);
});

test('a message raised while a write is pending joins it rather than starting a second', () => {
  const c = channel();
  c.announce('one');
  c.tick();
  c.announce('two');
  c.announce('three');
  assert.equal(c.pending(), 1);
  c.tick();
  assert.equal(c.node.textContent, 'two three');
  assert.equal(c.pending(), 0, 'the slot must be released before the write, not left holding');
});

test('new education is one combined action message rather than a second notification', () => {
  const message = withSaveEducation('Added House of M: 20 issues.', {
    previous: SAVE_EDUCATION_STATE.UNSEEN,
    current: SAVE_EDUCATION_STATE.EXPLAINING,
    changed: true,
  });

  assert.equal(
    message,
    'Added House of M: 20 issues. Your lists and progress save automatically in this browser; '
      + 'use Backup & settings for a copy you can restore elsewhere.',
  );
});

test('education does not repeat after it has already been introduced or completed', () => {
  const action = 'House of M #1 marked read.';
  for (const transition of [
    { previous: SAVE_EDUCATION_STATE.EXPLAINING, current: SAVE_EDUCATION_STATE.COMPLETE, changed: true },
    { previous: SAVE_EDUCATION_STATE.COMPLETE, current: SAVE_EDUCATION_STATE.COMPLETE, changed: false },
    null,
  ]) {
    assert.equal(withSaveEducation(action, transition), action);
  }
});
