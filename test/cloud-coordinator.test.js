// The cloud backup coordinator: commit observation, coalescing, the backup cadence, offline, the complete
// restore's pause, retries, sign-in and tabs. The protocol and provider are fakes here; their own owners
// come with them. Time is a fake clock, so five minutes of schedule run in milliseconds.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import {
  CLOUD_BACKUP_CADENCE, CloudBackupCoordinator, createSavedChanges, observeSavedWrites, personalDigest,
} from '../src/js/lib/cloudCoordinator.js';
import { CAPTURE_KEYS } from '../src/js/lib/completeBackup.js';
import { KEY, SETTINGS_KEY, SIDEBAR_KEY, IMPORT_DRAFT_KEY } from '../src/js/storage.js';
import { LIST_HISTORY_KEY } from '../src/js/lib/listHistory.js';

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const { quietMs, minIntervalMs, retryMs, recheckMs } = CLOUD_BACKUP_CADENCE;

function memoryStorage() {
  const map = new Map();
  const refuse = new Set();
  return {
    map, refuse,
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) {
      if (refuse.has(key)) throw Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
      map.set(key, String(value));
    },
    removeItem(key) { map.delete(key); },
    clear() { map.clear(); },
  };
}

// Timers that fire only when the test moves the clock, in due order.
function fakeTime(start = 1_000_000_000) {
  let now = start;
  let next = 1;
  const timers = new Map();
  return {
    now: () => now,
    setTimer(callback, ms) {
      const id = next++;
      timers.set(id, { at: now + ms, callback });
      return id;
    },
    clearTimer(id) { timers.delete(id); },
    pending: () => [...timers.values()].map((timer) => timer.at - now),
    async advance(ms, coordinators = []) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = Math.max(now, due[1].at);
        due[1].callback();
        for (const coordinator of coordinators) await coordinator.idle();
      }
      now = end;
    },
  };
}

// Web Locks as the coordinator uses them: one exclusive holder, the rest wait in order.
function fakeLocks() {
  let tail = Promise.resolve();
  return {
    request(name, options, callback) {
      const run = tail.then(() => callback({ name, mode: options.mode }));
      tail = run.catch(() => {});
      return run;
    },
  };
}

// What a capture returns: a complete backup's components, of which only the reader's active list is
// not the person's own data.
function snapshotOf(content) {
  const components = {
    reader: { schemaVersion: 4, app: 'recap-page', lists: content.lists ?? {}, listOrder: content.listOrder ?? [], active: content.active ?? null, read: content.read ?? {} },
    history: { format: 'recap-page-list-history', version: 1, records: [] },
    settings: { covers: true, theme: 'dark', filter: 'all', readingShortcut: true, hideDescriptions: true, sidebarCollapsed: content.sidebar ?? null },
    draft: null,
  };
  return { text: JSON.stringify(components), backup: { components } };
}

function harness({ blocked = false, online = true, hidden = false, locks = fakeLocks(), record = { value: null }, time = fakeTime() } = {}) {
  const env = {
    time, locks, record, blocked, online, hidden,
    content: { read: { 1: 100 }, active: 'a' },
    captures: 0, uploads: [], states: [], failures: [], events: new EventTarget(),
  };
  env.make = (overrides = {}) => new CloudBackupCoordinator({
    capture: async () => {
      env.captures += 1;
      const failure = env.failures.shift();
      if (failure) throw failure;
      return snapshotOf(env.content);
    },
    upload: async ({ personalDigest: digest, text }) => {
      env.uploads.push({ digest, text, at: env.time.now() });
      const outcome = env.uploadOutcomes?.shift();
      if (outcome instanceof Error) throw outcome;
      if (outcome === 'hang') await new Promise(() => {});
      env.record.value = { personalDigest: digest, uploadedAt: env.time.now() };
    },
    lastUploaded: async () => env.record.value,
    isBlocked: () => env.blocked,
    isOnline: () => env.online,
    isHidden: () => env.hidden,
    locks: env.locks, events: env.events, clock: env.time.now,
    setTimer: env.time.setTimer, clearTimer: env.time.clearTimer, cryptoProvider: webcrypto,
    onChange: (state) => env.states.push(state),
    ...overrides,
  });
  env.start = (overrides) => {
    const coordinator = env.make(overrides);
    coordinator.start();
    return coordinator;
  };
  return env;
}

// ------------------------------------------------------------------ commit observation

test('every write to what a backup holds is reported once the browser accepts it, and nothing else is', () => {
  const storage = memoryStorage();
  const seen = [];
  const observed = observeSavedWrites(storage, (key) => seen.push(key));
  assert.deepEqual([...CAPTURE_KEYS].sort(), [KEY, LIST_HISTORY_KEY, SETTINGS_KEY, SIDEBAR_KEY, IMPORT_DRAFT_KEY].sort());
  for (const key of CAPTURE_KEYS) observed.setItem(key, 'value');
  observed.setItem('mrt.cache-purge.v1', '1');
  observed.setItem('mrt.state.salvage', 'copy');
  observed.removeItem(LIST_HISTORY_KEY);
  assert.deepEqual(seen, [...CAPTURE_KEYS, LIST_HISTORY_KEY], 'only the five keys a backup holds');
  storage.refuse.add(SETTINGS_KEY);
  assert.throws(() => observed.setItem(SETTINGS_KEY, 'refused'), /quota/);
  assert.equal(seen.length, 6, 'a write the browser refused is not a saved change');
  assert.equal(observed.getItem(KEY), 'value', 'reads pass straight through');
  assert.equal(observed.length, storage.length);
  assert.equal(observed.key(0), storage.key(0));
  const throwing = observeSavedWrites(storage, () => { throw new Error('listener failed'); });
  throwing.setItem(KEY, 'still saved');
  assert.equal(storage.getItem(KEY), 'still saved', 'a listener cannot change the outcome of a save');
  const changes = createSavedChanges();
  const heard = [];
  const stop = changes.subscribe((key) => heard.push(key));
  changes.subscribe(() => { throw new Error('one listener'); });
  changes.notify(KEY);
  stop();
  changes.notify(KEY);
  assert.deepEqual(heard, [KEY], 'one listener cannot stop another, and an unsubscribed one hears nothing');
});

// Every owner of saved data in the app is handed the one storage object main.js makes, so wrapping it
// is what lets one observer see every writer. Nothing in main.js writes past it with the browser's own.
test('main.js wraps the guard every owner of saved data writes through, before any owner is made', () => {
  const src = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
  const wrap = src.indexOf('const localStorage = observeSavedWrites(completeRestore.storage ?? globalThis.localStorage, savedChanges.notify);');
  assert.ok(wrap !== -1, 'the guard is wrapped by the observer');
  for (const owner of ['new Store({', 'new ImportDraftStore({', 'new ListHistoryStore({']) {
    assert.ok(wrap < src.indexOf(owner), `${owner} comes after the wrap`);
  }
  assert.doesNotMatch(src, /globalThis\.localStorage\??\.(setItem|removeItem)\(/, 'nothing writes past the observer');
});

// ------------------------------------------------------------------ what is backed up, and when

test('the first run backs up the newest state, and a burst of changes becomes one backup', async () => {
  const env = harness();
  const coordinator = env.start();
  assert.equal(coordinator.state.phase, 'pending');
  await env.time.advance(quietMs - 1, [coordinator]);
  assert.equal(env.uploads.length, 0, 'nothing before ten quiet seconds');
  await env.time.advance(1, [coordinator]);
  assert.equal(env.uploads.length, 1, 'whatever was saved while it was off goes first');
  assert.equal(coordinator.state.phase, 'up-to-date');
  for (let i = 2; i <= 6; i += 1) {
    env.content = { ...env.content, read: { ...env.content.read, [i]: 100 + i } };
    coordinator.notify();
    await env.time.advance(2 * SECOND, [coordinator]);
  }
  await env.time.advance(minIntervalMs, [coordinator]);
  assert.equal(env.uploads.length, 2, 'five marks a few seconds apart are one backup');
  assert.equal(env.uploads[1].digest, await personalDigest(snapshotOf(env.content).backup, webcrypto), 'and it holds the newest of them');
  assert.ok(env.uploads[1].at - env.uploads[0].at >= minIntervalMs, 'at most one backup every five minutes');
  assert.equal(env.captures, 2, 'one capture per backup');
});

test('opening another list saves it but is never a backup', async () => {
  const env = harness();
  const coordinator = env.start();
  await env.time.advance(quietMs, [coordinator]);
  assert.equal(env.uploads.length, 1);
  for (const active of ['b', 'c', 'a', 'd']) {
    env.content = { ...env.content, active };
    coordinator.notify();
    await env.time.advance(minIntervalMs, [coordinator]);
  }
  assert.equal(env.uploads.length, 1, 'the active list is the one field a person does not change on purpose');
  assert.equal(env.captures, 5, 'each save was looked at');
  assert.equal(coordinator.state.phase, 'up-to-date');
  env.content = { ...env.content, sidebar: true };
  coordinator.notify();
  await env.time.advance(minIntervalMs, [coordinator]);
  assert.equal(env.uploads.length, 2, 'every other field is, the sidebar choice included');
});

test('a hidden page backs up at once, without waiting for quiet or the five minutes', async () => {
  const env = harness();
  const coordinator = env.start();
  await env.time.advance(quietMs, [coordinator]);
  env.content = { ...env.content, read: { ...env.content.read, 9: 900 } };
  coordinator.notify();
  await env.time.advance(MINUTE, [coordinator]);
  assert.equal(env.uploads.length, 1, 'still inside the five minutes');
  env.hidden = true;
  env.events.dispatchEvent(new Event('visibilitychange'));
  await env.time.advance(0, [coordinator]);
  assert.equal(env.uploads.length, 2, 'the person left, so it goes now');
  env.events.dispatchEvent(new Event('visibilitychange'));
  await env.time.advance(0, [coordinator]);
  assert.equal(env.uploads.length, 2, 'nothing more to send');
});

test('changes saved in another tab reach this tab, and nothing else from storage does', async () => {
  const env = harness();
  const coordinator = env.start();
  await env.time.advance(quietMs, [coordinator]);
  const storageEvent = (key) => Object.assign(new Event('storage'), { key });
  env.events.dispatchEvent(storageEvent('mrt.cache-purge.v1'));
  assert.equal(coordinator.state.phase, 'up-to-date');
  env.content = { ...env.content, read: { ...env.content.read, 4: 400 } };
  env.events.dispatchEvent(storageEvent(LIST_HISTORY_KEY));
  assert.equal(coordinator.state.phase, 'pending');
  await env.time.advance(minIntervalMs, [coordinator]);
  assert.equal(env.uploads.length, 2);
});

// ------------------------------------------------------------------ waits, failures and retries

test('changes made offline wait for the connection, then go as one backup', async () => {
  const env = harness({ online: false });
  const coordinator = env.start();
  for (let i = 0; i < 3; i += 1) {
    env.content = { ...env.content, read: { ...env.content.read, [20 + i]: i } };
    coordinator.notify();
    await env.time.advance(MINUTE, [coordinator]);
  }
  assert.equal(env.uploads.length, 0);
  assert.equal(env.captures, 0, 'nothing is even read while offline');
  assert.deepEqual({ phase: coordinator.state.phase, code: coordinator.state.code }, { phase: 'waiting', code: 'offline' });
  env.online = true;
  env.events.dispatchEvent(new Event('online'));
  await env.time.advance(quietMs, [coordinator]);
  assert.equal(env.uploads.length, 1, 'one backup of the newest state, as soon as the connection is back');
  assert.equal(coordinator.state.phase, 'up-to-date');
});

test('nothing is read while a complete restore or its recovery holds saving paused', async () => {
  const env = harness({ blocked: true });
  const coordinator = env.start();
  await env.time.advance(quietMs + 3 * recheckMs, [coordinator]);
  assert.equal(env.captures, 0);
  assert.deepEqual({ phase: coordinator.state.phase, code: coordinator.state.code }, { phase: 'waiting', code: 'paused' });
  env.blocked = false;
  await env.time.advance(recheckMs, [coordinator]);
  assert.equal(env.uploads.length, 1, 'it looks again a few seconds later and goes');
});

test('a capture that a complete restore started under is discarded, and the next capture once saving opens is backed up', async () => {
  const env = harness();
  let straddle = true;
  const coordinator = env.start({
    capture: async () => {
      env.captures += 1;
      const snapshot = snapshotOf(env.content);
      // The person starts a complete restore while this capture is reading storage.
      if (straddle) env.blocked = true;
      straddle = false;
      return snapshot;
    },
  });
  await env.time.advance(quietMs, [coordinator]);
  assert.equal(env.captures, 1);
  assert.equal(env.uploads.length, 0, 'nothing captured beside a restore is uploaded');
  assert.deepEqual({ phase: coordinator.state.phase, code: coordinator.state.code }, { phase: 'waiting', code: 'paused' });
  await env.time.advance(3 * recheckMs, [coordinator]);
  assert.equal(env.captures, 1, 'nothing is read again while saving stays paused');
  env.content = { ...env.content, read: { ...env.content.read, 9: 900 } };
  env.blocked = false;
  await env.time.advance(recheckMs, [coordinator]);
  assert.equal(env.captures, 2);
  assert.equal(env.uploads.length, 1);
  assert.equal(JSON.parse(env.uploads[0].text).reader.read['9'], 900, 'the backup holds what storage says once it is open');
  coordinator.stop();
});

test('a failed upload is retried after 5 s, 15 s, a minute and five minutes, and never sooner than the provider asks', async () => {
  const env = harness();
  const transient = (retryAfterMs) => Object.assign(new Error('Service unavailable'), { code: 'transient', retryAfterMs });
  env.uploadOutcomes = [transient(), transient(2 * MINUTE), transient(), transient(), transient()];
  const coordinator = env.start();
  await env.time.advance(quietMs, [coordinator]);
  const gaps = [];
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    assert.equal(coordinator.state.phase, 'retrying', `attempt ${attempt}`);
    gaps.push(coordinator.state.retryAt - env.time.now());
    await env.time.advance(coordinator.state.retryAt - env.time.now(), [coordinator]);
  }
  assert.deepEqual(gaps, [retryMs[0], 2 * MINUTE, retryMs[2], retryMs[3], retryMs[3]],
    'the provider asked for two minutes where the backoff said fifteen seconds, and the backoff stops growing at five minutes');
  assert.equal(env.uploads.length, 6, 'each attempt is a new backup, never an overwrite');
  assert.equal(coordinator.state.phase, 'up-to-date');
});

test('a sign-in the provider refuses stops backups where the person can see it, and signing in again resumes them', async () => {
  const env = harness();
  env.uploadOutcomes = [Object.assign(new Error('Sign in again'), { code: 'needs-sign-in' })];
  const coordinator = env.start();
  await env.time.advance(quietMs, [coordinator]);
  assert.equal(coordinator.state.phase, 'needs-sign-in');
  env.content = { ...env.content, read: { ...env.content.read, 7: 700 } };
  coordinator.notify();
  await env.time.advance(10 * MINUTE, [coordinator]);
  assert.equal(env.uploads.length, 1, 'no silent retries while sign-in is needed');
  assert.equal(coordinator.state.phase, 'needs-sign-in', 'and it still says so');
  coordinator.retry();
  await env.time.advance(0, [coordinator]);
  assert.equal(env.uploads.length, 2);
  assert.equal(coordinator.state.phase, 'up-to-date');
});

test('a host that holds another connection, or none, stops backups until this browser agrees again', async () => {
  for (const code of ['needs-consent', 'not-connected']) {
    const env = harness();
    env.uploadOutcomes = [Object.assign(new Error('Agree again'), { code })];
    const coordinator = env.start();
    await env.time.advance(quietMs, [coordinator]);
    assert.deepEqual({ phase: coordinator.state.phase, code: coordinator.state.code }, { phase: 'needs-consent', code }, code);
    env.content = { ...env.content, read: { ...env.content.read, 7: 700 } };
    coordinator.notify();
    await env.time.advance(10 * MINUTE, [coordinator]);
    assert.equal(env.uploads.length, 1, `${code}: a saved change does not upload into an account nobody agreed to`);
    assert.equal(coordinator.state.phase, 'needs-consent');
    coordinator.retry();
    await env.time.advance(0, [coordinator]);
    assert.equal(env.uploads.length, 2, `${code}: agreeing again resumes`);
    assert.equal(coordinator.state.phase, 'up-to-date');
    coordinator.stop();
  }
});

test('an import still being saved waits for the next change; a capture that raced looks again shortly', async () => {
  const env = harness();
  const refusal = (code) => Object.assign(new Error('refused'), { code });
  env.failures = [refusal('pending')];
  const coordinator = env.start();
  await env.time.advance(quietMs + 10 * MINUTE, [coordinator]);
  assert.deepEqual({ phase: coordinator.state.phase, code: coordinator.state.code }, { phase: 'waiting', code: 'pending' });
  assert.equal(env.captures, 1, 'a timer would only be refused again');
  coordinator.notify();
  env.failures = [refusal('raced')];
  // Waiting kept the change unsaved for ten minutes, the most a change waits, so this run is due at once.
  await env.time.advance(0, [coordinator]);
  assert.deepEqual({ phase: coordinator.state.phase, code: coordinator.state.code }, { phase: 'retrying', code: 'raced' });
  assert.equal(coordinator.state.retryAt - env.time.now(), recheckMs);
  await env.time.advance(recheckMs, [coordinator]);
  assert.equal(env.uploads.length, 1);
  env.failures = [refusal('unreadable')];
  env.content = { ...env.content, read: { ...env.content.read, 8: 800 } };
  coordinator.notify();
  await env.time.advance(minIntervalMs + 10 * MINUTE, [coordinator]);
  assert.deepEqual({ phase: coordinator.state.phase, code: coordinator.state.code }, { phase: 'failed', code: 'unreadable' });
  coordinator.notify();
  await env.time.advance(quietMs, [coordinator]);
  assert.equal(env.uploads.length, 2, 'the next change tries again');
});

// ------------------------------------------------------------------ restarts and tabs

// The digest is computed with real Web Crypto, so a run that is still on its way to the upload is waited
// for here rather than assumed.
async function until(condition) {
  for (let i = 0; i < 1000 && !condition(); i += 1) await new Promise((resolve) => { setImmediate(resolve); });
  assert.ok(condition(), 'the run reached the point the test waits for');
}

test('a backup cut off part way by a reload goes again from the newest state, and the old run changes nothing', async () => {
  const env = harness();
  env.uploadOutcomes = ['hang'];
  const before = env.start();
  await env.time.advance(quietMs);
  await until(() => env.uploads.length === 1);
  assert.equal(before.state.phase, 'saving');
  before.stop();
  assert.equal(before.state.phase, 'off');
  env.content = { ...env.content, read: { ...env.content.read, 5: 500 } };
  // A reload destroys the page, and with it every Web Lock the page held, so the new page's coordinator
  // is not kept waiting by the old run's lock.
  const after = env.start({ locks: fakeLocks() });
  await env.time.advance(quietMs, [after]);
  assert.equal(env.uploads.length, 2, 'the reloaded page backs up again, write-once, so the cut-off one costs a file at most');
  assert.equal(env.uploads[1].digest, await personalDigest(snapshotOf(env.content).backup, webcrypto));
  assert.equal(after.state.phase, 'up-to-date');
  assert.equal(before.state.phase, 'off', 'the stopped coordinator never reports again');
});

test('two tabs of one installation back up one change once', async () => {
  const shared = { locks: fakeLocks(), record: { value: null }, time: fakeTime() };
  const first = harness(shared);
  const second = harness(shared);
  second.content = first.content;
  const a = first.start();
  const b = second.start();
  await shared.time.advance(quietMs, [a, b]);
  assert.equal(first.uploads.length + second.uploads.length, 1, 'the second finds the first one\'s backup in the shared record');
  first.content = { ...first.content, read: { ...first.content.read, 3: 300 } };
  second.content = first.content;
  a.notify();
  b.notify();
  await shared.time.advance(minIntervalMs, [a, b]);
  assert.equal(first.uploads.length + second.uploads.length, 2);
  assert.equal(a.state.phase, 'up-to-date');
  assert.equal(b.state.phase, 'up-to-date');
});

test('stopping cancels a backup that has not started and ignores one that has', async () => {
  const env = harness();
  const coordinator = env.start();
  coordinator.stop();
  await env.time.advance(10 * MINUTE, [coordinator]);
  assert.equal(env.captures, 0);
  assert.deepEqual(env.time.pending(), []);
  coordinator.notify();
  assert.equal(coordinator.state.phase, 'off', 'a stopped coordinator ignores saved changes');
  let release;
  let started = false;
  const late = new Promise((resolve) => { release = resolve; });
  const slow = env.start({
    upload: async ({ personalDigest: digest }) => {
      started = true;
      await late;
      env.record.value = { personalDigest: digest, uploadedAt: env.time.now() };
    },
  });
  await env.time.advance(quietMs);
  await until(() => started);
  slow.stop();
  release();
  await slow.idle();
  assert.equal(slow.state.phase, 'off');
  assert.equal(slow.state.lastUploadAt, null, 'the late result is not taken as this coordinator\'s backup');
  assert.deepEqual(env.time.pending(), [], 'nothing is scheduled after it stops');
});
