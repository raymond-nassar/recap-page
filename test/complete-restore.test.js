// The complete restore's journal, marker and tab lock: one case per row of the state table in
// docs/ARCHITECTURE.md ("Complete backups"), the eight-write interruption matrix, the exits, erase,
// the writer rule and tab safety.
//
// Storage here keeps a snapshot after every write, so a browser-process kill can be modelled as what
// Chromium does: localStorage falls back to an earlier moment, while the journal, like IndexedDB, keeps
// everything that completed.

import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  CompleteRestore, KEEP_FINISHED_JOURNAL_MS, PRIOR_COPY_FORMAT, RESTORE_MESSAGES, decideRestoreState, readMarker,
  recoveryTextForPlatform, restoreMessagesForPlatform,
} from '../src/js/lib/completeRestore.js';
import {
  createCompleteBackup, prepareCompleteRestore, restorePlan, canonical, RESTORE_KEYS,
} from '../src/js/lib/completeBackup.js';
import { keepCurrentQuestion, keptNotice } from '../src/js/views/data.js';
import { createEmptyState, createList, addIssuesToList, exportBackup, normalizeIssue } from '../src/js/lib/model.js';
import { KEY, IMPORT_DRAFT_KEY, PRERESTORE_KEY, SETTINGS_KEY, SIDEBAR_KEY, RESTORE_MARKER_KEY } from '../src/js/storage.js';
import { LIST_HISTORY_KEY, LIST_HISTORY_FORMAT } from '../src/js/lib/listHistory.js';
import { DRAFT_FORMAT, DRAFT_VERSION, sourceOccurrences } from '../src/js/lib/importDraft.js';

const API_BASE = 'https://metadata.example.test/v1';
const DAY = KEEP_FINISHED_JOURNAL_MS;

test('iOS restore and recovery messages describe the app rather than browser tabs', () => {
  const messages = restoreMessagesForPlatform(true);
  const recovery = recoveryTextForPlatform(true);
  assert.match(messages.unchecked, /Close and reopen the app/);
  assert.match(messages.copyUnchecked, /saved here/);
  assert.match(recovery.lost, /the app closed/);
  for (const text of [...Object.values(messages), ...Object.values(recovery)]) {
    assert.doesNotMatch(text, /\b(?:browser|tabs?|windows?|reload(?:ing)?|this page)\b/i);
  }
});

function readerContent(state) {
  const value = exportBackup(state);
  delete value.exportedAt;
  return value;
}

function draftOf(rawText, extra = {}) {
  const occurrences = sourceOccurrences(rawText);
  return {
    format: DRAFT_FORMAT, version: DRAFT_VERSION, rawText, occurrences,
    incarnation: 'local', revision: 'local', previousSources: [],
    destination: { id: 'dest', created: 5, name: 'Pasted', newList: true, prefix: [] },
    expected: null, readerToken: null, paused: false, pending: null, ...extra,
  };
}

function localEntries() {
  let state = createList(createEmptyState(), { id: 'local', name: 'On this device' });
  state = addIssuesToList(state, 'local', [{ issueId: 1, title: 'One' }]).state;
  state.read[1] = 111;
  return [
    [KEY, JSON.stringify({ writeToken: 'local-token', ...exportBackup(state) })],
    [LIST_HISTORY_KEY, JSON.stringify({
      format: LIST_HISTORY_FORMAT, version: 1, writeToken: 'local-history',
      records: [{ listId: 'local', created: state.lists.local.created, catalogId: null, completedAt: 50, rating: null }],
    })],
    [SETTINGS_KEY, JSON.stringify({ apiBase: API_BASE, covers: true, theme: 'light', filter: 'all', readingShortcut: true, hideDescriptions: true })],
    [SIDEBAR_KEY, 'false'],
    [IMPORT_DRAFT_KEY, JSON.stringify(draftOf('- [ ] [One](https://www.marvel.com/comics/issue/1/)'))],
  ];
}

async function makeFileBackup() {
  let state = createList(createEmptyState(), { id: 'from-file', name: 'From the file' });
  state = addIssuesToList(state, 'from-file', [{ issueId: 7, title: 'Seven' }, { issueId: 8, title: 'Eight' }]).state;
  state.read[7] = 777;
  state.notes[8] = 'Restored note';
  const rawText = '- [ ] [Seven](https://www.marvel.com/comics/issue/7/)\n- [ ] Unknown';
  const draft = draftOf(rawText);
  draft.occurrences[1].choice = normalizeIssue({ issueId: 9, title: 'Nine' });
  return createCompleteBackup({
    reader: readerContent(state),
    history: { format: LIST_HISTORY_FORMAT, version: 1, records: [{ listId: 'from-file', created: state.lists['from-file'].created, catalogId: null, completedAt: 999, rating: 'up' }] },
    settings: { covers: false, theme: 'dark', filter: 'unread', readingShortcut: false, hideDescriptions: false, sidebarCollapsed: true },
    draft: Object.fromEntries(['format', 'version', 'rawText', 'occurrences', 'destination', 'previousSources'].map((key) => [key, draft[key]])),
  }, { cryptoProvider: webcrypto });
}

// One file for the whole run: list identities carry creation times, so a second file would differ.
const FILE = makeFileBackup();
const fileBackup = () => FILE;

function memoryStorage(entries) {
  const map = new Map(entries);
  const history = [new Map(map)];
  const refuse = new Set();
  // Keys whose removal throws, as a browser can refuse any write.
  const refuseRemoval = new Set();
  return {
    map, history, refuse, refuseRemoval,
    get length() { return map.size; },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem(key, value) {
      if (refuse.has(key)) {
        const error = new Error('The quota has been exceeded.');
        error.name = 'QuotaExceededError';
        throw error;
      }
      map.set(key, String(value));
      history.push(new Map(map));
    },
    removeItem(key) {
      if (refuseRemoval.has(key)) throw new Error('Injected removal refusal');
      map.delete(key);
      history.push(new Map(map));
    },
    // What a browser-process kill leaves: localStorage as it stood after `writes` writes.
    rewind(writes) {
      const kept = history[writes];
      map.clear();
      for (const [key, value] of kept) map.set(key, value);
      history.length = writes + 1;
    },
  };
}

// The Web Locks behaviour the engine relies on: shared beside shared, exclusive alone, ifAvailable
// answered at once, and waiting requests granted in order.
function fakeLocks() {
  const held = [];
  const queue = [];
  const fits = (mode) => (mode === 'exclusive' ? held.length === 0 : held.every((entry) => entry.mode === 'shared'));
  function pump() {
    while (queue.length && fits(queue[0].mode)) {
      const next = queue.shift();
      const entry = { mode: next.mode };
      held.push(entry);
      next.resolve(entry);
    }
  }
  return {
    held, queue,
    async request(name, options, callback) {
      const mode = options.mode ?? 'exclusive';
      let entry;
      if (options.ifAvailable) {
        if (queue.length || !fits(mode)) return callback(null);
        entry = { mode };
        held.push(entry);
      } else {
        entry = await new Promise((resolve) => { queue.push({ mode, resolve }); pump(); });
      }
      try { return await callback({ name, mode }); }
      finally { held.splice(held.indexOf(entry), 1); pump(); }
    },
  };
}

function fakeJournal() {
  let plan = null;
  let progress = null;
  let progressCalls = 0;
  // read: how many of the next reads fail, as IndexedDB does after an open timeout, abort or error.
  const faults = { progressAt: null, begin: false, remove: false, read: 0 };
  const log = [];
  return {
    available: true, log, faults,
    async read() {
      if (faults.read > 0) {
        faults.read -= 1;
        throw new Error('Injected read failure');
      }
      if (plan === null && progress === null) return null;
      if (plan && progress && plan.id === progress.id) return structuredClone({ ...plan, ...progress });
      return { unmatched: true, plan: structuredClone(plan), progress: structuredClone(progress) };
    },
    async readProgress() { return structuredClone(progress); },
    async begin(record) {
      if (faults.begin) throw new Error('Injected journal failure');
      const { writes, direction, phase, finishedAt, ...rest } = record;
      plan = structuredClone(rest);
      progress = { id: record.id, writes, direction, phase, finishedAt };
      log.push('begin');
    },
    async progress(record) {
      progressCalls += 1;
      if (faults.progressAt === progressCalls) throw new Error('Injected checkpoint failure');
      progress = { id: record.id, writes: record.writes, direction: record.direction, phase: record.phase, finishedAt: record.finishedAt };
      log.push(`progress:${record.writes}:${record.phase}`);
    },
    async remove() {
      if (faults.remove) throw new Error('Injected removal failure');
      plan = null;
      progress = null;
      log.push('remove');
      return true;
    },
    plant(record) {
      if (record === null) { plan = null; progress = null; return; }
      const { writes, direction, phase, finishedAt, ...rest } = structuredClone(record);
      plan = rest;
      progress = { id: record.id, writes, direction, phase, finishedAt };
    },
    plantRaw(rawPlan, rawProgress) { plan = rawPlan; progress = rawProgress; },
    get record() { return plan || progress ? structuredClone({ ...plan, ...progress }) : null; },
  };
}

function environment(entries = localEntries()) {
  const env = {
    storage: memoryStorage(entries), locks: fakeLocks(), journal: fakeJournal(), now: 10 * DAY, reloads: 0,
  };
  env.make = (overrides = {}) => new CompleteRestore({
    storage: env.storage, locks: env.locks, journal: env.journal, events: null,
    clock: () => env.now, cryptoProvider: webcrypto, reload: () => { env.reloads += 1; }, lockAnswerMs: 200, ...overrides,
  });
  // A tab: started, its lock answered, its deferred read done.
  env.open = async (overrides) => {
    const tab = env.make(overrides);
    await tab.start();
    await tab.inspect();
    return tab;
  };
  return env;
}

const priorOf = (env) => Object.fromEntries(RESTORE_KEYS.map((key) => [key, env.storage.map.get(key) ?? null]));

test('complete restore applies authentic pre-withdrawal reader drafts and keeps their exact source and selections', async () => {
  const { readFileSync } = await import('node:fs');
  const { fixtures } = JSON.parse(readFileSync(new URL('./fixtures/historical-reader-complete-backups.json', import.meta.url)));
  for (const fixture of fixtures) {
    const env = environment();
    const priorDraft = env.storage.getItem(IMPORT_DRAFT_KEY);
    const tab = await env.open();
    const result = await tab.restore(fixture.text);
    assert.equal(result.ok, true, result.error);
    const restored = JSON.parse(env.storage.getItem(IMPORT_DRAFT_KEY));
    assert.equal(restored.rawText, fixture.draft.rawText);
    assert.deepEqual(restored.occurrences, fixture.draft.occurrences);
    assert.ok(restored.previousSources.includes(priorDraft), 'the displaced draft stays recoverable');
    assert.equal(restored.paused, true);
    assert.equal(restored.pending, null);
    assert.equal(restored.readerToken, null);
    assert.equal(env.journal.record.phase, 'done');
  }
});

async function planted(env, { id = 'a'.repeat(64), writes = 0, phase = 'applying', direction = 'forward', finishedAt = null, steps = 0, marker } = {}) {
  const { backup } = await fileBackup();
  const prepared = prepareCompleteRestore({ backup, storage: env.storage, isExclusive: () => true });
  const record = { version: 1, id, backup: canonical(backup), prepared, writes, direction, phase, finishedAt };
  env.journal.plant(record);
  const plan = restorePlan(prepared, backup);
  const effects = plan.components.flatMap((component) => component.effects);
  for (const effect of effects.slice(0, steps)) {
    if (effect.value === null) env.storage.map.delete(effect.key);
    else env.storage.map.set(effect.key, effect.value);
  }
  if (marker !== undefined) {
    if (marker === null) env.storage.map.delete(RESTORE_MARKER_KEY);
    else env.storage.map.set(RESTORE_MARKER_KEY, `${marker}:${id}`);
  }
  return { record, plan, effects, backup };
}

function preparedImage(plan) {
  return Object.assign({}, ...plan.components.map((component) => component.states.at(-1)));
}

function assertImage(env, image, message) {
  for (const [key, value] of Object.entries(image)) assert.equal(env.storage.map.get(key) ?? null, value, `${message}: ${key}`);
}

// ------------------------------------------------------------------ a whole restore

test('a restore journals and reads back before its marker, writes in order, and keeps the journal once done', async () => {
  const env = environment();
  const prior = priorOf(env);
  const tab = await env.open();
  assert.equal(tab.state.phase, 'open');
  const order = [];
  const begin = env.journal.begin;
  env.journal.begin = async (record) => { order.push(`begin:${readMarker(env.storage).state}`); return begin(record); };
  const { text } = await fileBackup();
  const result = await tab.restore(text);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(order, ['begin:absent'], 'the journal is written while no marker exists');
  const record = env.journal.record;
  const markerWrites = env.storage.history.map((snapshot) => snapshot.get(RESTORE_MARKER_KEY) ?? null);
  assert.deepEqual([...new Set(markerWrites)], [null, `active:${record.id}`, `done:${record.id}`]);
  assert.equal(record.phase, 'done');
  assert.equal(record.writes, 8, 'eight writes, each checkpointed');
  assert.equal(record.finishedAt, env.now);
  assert.deepEqual(record.prepared.before, prior, 'the exact prior values are kept');
  const plan = restorePlan(record.prepared, (await fileBackup()).backup);
  assertImage(env, preparedImage(plan), 'restored');
  assert.equal(JSON.parse(env.storage.map.get(SETTINGS_KEY)).apiBase, API_BASE, 'the metadata service is untouched');
  assert.equal(env.storage.map.get(SIDEBAR_KEY), 'true');
  assert.equal(env.storage.map.get(PRERESTORE_KEY), prior[KEY], 'the replaced reading data is the saved copy');
  const draft = JSON.parse(env.storage.map.get(IMPORT_DRAFT_KEY));
  assert.equal(draft.paused, true, 'a restored draft waits for review');
  assert.equal(draft.readerToken, null);
  assert.ok(draft.previousSources.includes(prior[IMPORT_DRAFT_KEY]));
  assert.equal(tab.state.phase, 'open');
  assert.equal(tab.state.recovery, null);
});

test('saving through the guard pauses during a restore and is refused before the lock answer, never run unguarded', async () => {
  const env = environment();
  const tab = env.make();
  const original = env.storage.map.get(KEY);
  assert.throws(() => tab.storage.setItem(SETTINGS_KEY, '{}'), /checking its other tabs|not saved/i, 'nothing writes before start');
  const settled = tab.start();
  assert.equal(tab.state.phase, 'pending');
  assert.throws(() => tab.storage.setItem(KEY, '{}'), /checking its other tabs/, 'a guarded write before the answer is not run');
  assert.equal(env.storage.map.get(KEY), original);
  tab.storage.setItem('mrt.cache-purge.v1', '1');
  assert.equal(env.storage.map.get('mrt.cache-purge.v1'), '1', 'keys a restore never replaces are not guarded');
  await settled;
  assert.equal(tab.state.phase, 'open');
  tab.storage.setItem(SIDEBAR_KEY, 'true');
  assert.equal(env.storage.map.get(SIDEBAR_KEY), 'true');
  let during = null;
  const progress = env.journal.progress;
  env.journal.progress = async (record) => {
    if (during === null) { try { tab.storage.setItem(SETTINGS_KEY, '{}'); during = 'written'; } catch (error) { during = error.message; } }
    return progress(record);
  };
  await tab.restore((await fileBackup()).text);
  assert.match(during, /complete restore is running/);
});

test('another open tab refuses the restore with nothing replaced and no journal; closing it lets the restore run', async () => {
  const env = environment();
  const prior = priorOf(env);
  const a = await env.open();
  const b = await env.open();
  const { text } = await fileBackup();
  const refused = await a.restore(text);
  assert.equal(refused.ok, false);
  assert.equal(refused.changed, false);
  assert.match(refused.error, /Close other Recap Page tabs/);
  assert.equal(env.journal.record, null);
  assertImage(env, prior, 'unchanged');
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(a.state.phase, 'open', 'saving resumes in the refusing tab');
  await b.releaseShared();
  assert.equal((await a.restore(text)).ok, true);
});

test('a tab opened while another restores waits with saving paused, then reloads instead of writing old state', async () => {
  const env = environment();
  const a = await env.open();
  let late;
  const progress = env.journal.progress;
  env.journal.progress = async (record) => {
    if (!late) {
      late = env.make();
      await late.start();
      assert.equal(late.state.phase, 'paused');
      assert.equal(late.state.message, RESTORE_MESSAGES.otherTab);
      assert.throws(() => late.storage.setItem(SETTINGS_KEY, '{"theme":"light"}'), /Another Recap Page tab is restoring/);
    }
    return progress(record);
  };
  assert.equal((await a.restore((await fileBackup()).text)).ok, true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(env.reloads, 1, 'the late tab reloads once the restore lets go of the lock');
  assert.equal(JSON.parse(env.storage.map.get(SETTINGS_KEY)).theme, 'dark', 'and never wrote its earlier settings');
});

// A closed tab's shared lock outlives the close by seconds under load (#1004), so a restore's
// exclusive request can be queued rather than held when another tab starts. That tab pauses as it
// does for a held restore, and reloads only once the restore has been granted and let go.
test('a tab opened while a restore is still queued behind a closing tab pauses, and reloads only after the restore lets go', async () => {
  const env = environment();
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
  let closing;
  void env.locks.request('restore', { mode: 'shared' }, () => new Promise((resolve) => { closing = resolve; }));
  let granted = false;
  let release;
  const restoring = env.locks.request('restore', { mode: 'exclusive' }, () => new Promise((resolve) => { granted = true; release = resolve; }));
  await tick();
  assert.equal(granted, false, 'the restore is queued, not held');
  const late = env.make();
  await late.start();
  assert.equal(late.state.phase, 'paused');
  assert.equal(late.state.message, RESTORE_MESSAGES.otherTab);
  assert.throws(() => late.storage.setItem(SETTINGS_KEY, '{"theme":"light"}'), /Another Recap Page tab is restoring/);
  closing();
  await tick();
  assert.equal(granted, true);
  assert.equal(env.reloads, 0, 'no reload while the restore holds the lock');
  assert.equal(late.state.phase, 'paused');
  release();
  await restoring;
  await tick();
  assert.equal(env.reloads, 1, 'one reload once the restore lets go');
});

test('a page restored from the back-forward cache reloads when a restore ran meanwhile, and resumes when none did', async () => {
  const env = environment();
  const listeners = {};
  const events = { addEventListener: (type, listener) => { listeners[type] = listener; } };
  const tab = env.make({ events });
  await tab.start();
  await tab.inspect();
  listeners.pagehide();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(tab.state.phase, 'pending', 'a hidden page holds no lock and saves nothing');
  listeners.pageshow({ persisted: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(tab.state.phase, 'open');
  assert.equal(env.reloads, 0);
  listeners.pagehide();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const other = await env.open();
  assert.equal((await other.restore((await fileBackup()).text)).ok, true);
  listeners.pageshow({ persisted: true });
  assert.equal(env.reloads, 1, 'the resumed page is read afresh rather than writing settings from before the restore');
});

// The lock is requested a microtask after start() reads the marker, and settings were read even earlier,
// so another tab can finish a whole restore, or its last write, in between. The lock then answers at
// once and nothing is pending, yet this page holds what it read before. Here the browser answers this
// tab's lock request only after the other tab has finished and let go.
test('a tab whose start overlaps the end of another tab\'s restore reloads before it saves anything', async () => {
  for (const seenAtStart of ['active', 'absent']) {
    const env = environment();
    let release;
    const restoring = env.locks.request('restore', { mode: 'exclusive' }, () => new Promise((resolve) => { release = resolve; }));
    let answer;
    const gate = new Promise((resolve) => { answer = resolve; });
    const late = env.make({ lockAnswerMs: 5000, locks: { request: async (...args) => { await gate; return env.locks.request(...args); } } });
    let finish;
    if (seenAtStart === 'active') {
      const { record } = await planted(env, { marker: 'active', phase: 'done', writes: 8, steps: 8, finishedAt: env.now });
      finish = async () => { env.storage.map.set(RESTORE_MARKER_KEY, `done:${record.id}`); };
    } else {
      finish = () => planted(env, { marker: 'done', phase: 'done', writes: 8, steps: 8, finishedAt: env.now });
    }
    const settled = late.start();
    assert.equal(late.state.phase, seenAtStart === 'active' ? 'paused' : 'pending', seenAtStart);
    await finish();
    release();
    await restoring;
    answer();
    await settled;
    await late.inspect();
    assert.equal(env.reloads, 1, `${seenAtStart}: the page is read again`);
    assert.notEqual(late.state.phase, 'open', seenAtStart);
    assert.throws(() => late.storage.setItem(SETTINGS_KEY, '{"theme":"light"}'), /reloading/, `${seenAtStart}: nothing it read before is saved`);
    assert.equal(JSON.parse(env.storage.map.get(SETTINGS_KEY)).theme, 'dark', seenAtStart);
  }
});

// ------------------------------------------------------------------ interruptions

test('every one of the eight writes, interrupted before its checkpoint, is recovered from its bytes after a reload', async () => {
  for (let effect = 0; effect < 8; effect += 1) {
    const env = environment();
    const prior = priorOf(env);
    const tab = await env.open();
    env.journal.faults.progressAt = effect + 1;
    const failed = await tab.restore((await fileBackup()).text);
    assert.equal(failed.ok, false, `write ${effect}`);
    assert.equal(failed.changed, null);
    assert.equal(tab.state.phase, 'paused');
    assert.equal(tab.state.recovery?.kind, 'interrupted', `write ${effect}`);
    assert.throws(() => tab.storage.setItem(KEY, '{}'), /did not finish/);
    const record = env.journal.record;
    assert.equal(record.writes, effect, 'the checkpoint for this write was never made');
    env.journal.faults.progressAt = null;
    await tab.releaseShared();
    const reopened = await env.open();
    assert.equal(reopened.state.recovery?.kind, 'interrupted', `reopened after write ${effect}`);
    assert.equal(reopened.state.recovery.canFinish, true);
    const prior2 = JSON.parse(await reopened.exportPrior());
    assert.equal(prior2.format, PRIOR_COPY_FORMAT);
    assert.deepEqual(prior2.values, prior, 'the exact prior copy can be downloaded');
    const direction = effect % 2 ? 'prior' : 'forward';
    const result = await reopened.recover(direction);
    assert.equal(result.ok, true, `${direction} after write ${effect}: ${result.error}`);
    const plan = restorePlan(record.prepared, (await fileBackup()).backup);
    assertImage(env, direction === 'prior' ? prior : preparedImage(plan), `${direction} after write ${effect}`);
    assert.equal(readMarker(env.storage).raw, `done:${record.id}`);
    assert.equal(reopened.state.phase, 'open');
  }
});

test('a kill that loses recent localStorage writes is still recovered, because the bytes decide and not the checkpoint', async () => {
  for (const kept of [0, 1, 3, 6, 9]) {
    const env = environment();
    const prior = priorOf(env);
    const tab = await env.open();
    assert.equal((await tab.restore((await fileBackup()).text)).ok, true);
    const record = env.journal.record;
    // localStorage as it stood after `kept` of its writes: none, the marker only, part way, or done.
    env.storage.rewind(kept);
    await tab.releaseShared();
    const reopened = await env.open();
    const marker = readMarker(env.storage).state;
    if (kept <= 1) {
      assert.equal(marker, kept === 0 ? 'absent' : 'active');
      assert.equal(reopened.state.recovery?.kind, 'lost', 'a finished restore whose writes were all lost is offered again');
      assert.equal(reopened.state.recovery.canFinish, true);
      assert.equal(reopened.state.recovery.canKeep, true);
    } else {
      assert.equal(marker, 'active');
      assert.equal(reopened.state.recovery?.kind, 'interrupted', `kept ${kept}`);
    }
    assert.equal((await reopened.recover('forward')).ok, true, `kept ${kept}`);
    assertImage(env, preparedImage(restorePlan(record.prepared, (await fileBackup()).backup)), `kept ${kept}`);
    assert.notDeepEqual(priorOf(env), prior);
  }
});

// ------------------------------------------------------------------ the state table, row by row

test('row 1: no marker and no journal is an ordinary start, and the next restore proceeds', async () => {
  const env = environment();
  const tab = env.make();
  tab.start();
  assert.equal(tab.state.phase, 'pending', 'nothing is read from the journal before the first render');
  await tab.settled;
  await tab.inspect();
  assert.equal(tab.state.phase, 'open');
  assert.equal(tab.state.recovery, null);
  assert.equal((await tab.restore((await fileBackup()).text)).ok, true);
});

test('row 2: a journal that never wrote, with no marker, is discarded even after the reader edits', async () => {
  const env = environment();
  await planted(env, { marker: null });
  const tab = env.make();
  await tab.start();
  assert.equal(tab.state.phase, 'open', 'no marker, so saving is not paused');
  tab.storage.setItem(SETTINGS_KEY, JSON.stringify({ apiBase: API_BASE, theme: 'dark' }));
  await tab.inspect();
  assert.equal(env.journal.record, null, 'discarded');
  assert.equal(tab.state.recovery, null);
  assert.equal(JSON.parse(env.storage.map.get(SETTINGS_KEY)).theme, 'dark', 'the edit stands');
  const again = environment();
  await planted(again, { marker: null });
  const next = await again.open({ });
  assert.equal((await next.restore((await fileBackup()).text)).ok, true, 'the next restore discards it and proceeds');
});

test('row 2, lost marker: a surviving restore write keeps the journal for recovery', async () => {
  const env = environment();
  await planted(env, { marker: null, steps: 3 });
  const tab = await env.open();
  assert.equal(tab.state.recovery?.kind, 'interrupted');
  assert.equal((await tab.restore((await fileBackup()).text)).ok, false, 'the next restore is refused until recovery ends');
});

test('row 3: an advanced or finished journal with every component prior offers the restore again', async () => {
  for (const [phase, writes] of [['done', 8], ['applying', 4]]) {
    const env = environment();
    await planted(env, { marker: null, phase, writes, finishedAt: phase === 'done' ? env.now : null });
    const tab = await env.open();
    assert.equal(tab.state.phase, 'paused');
    assert.equal(tab.state.recovery?.kind, phase === 'done' ? 'lost' : 'interrupted', phase);
    assert.equal(tab.state.recovery.canFinish, true);
    assert.equal(tab.state.recovery.canKeep, true);
    assert.equal(tab.state.recovery.canRestorePrior, false, 'nothing to put back');
  }
});

test('row 4: no marker, and a journal whose writes partly landed, pauses and offers recovery', async () => {
  const env = environment();
  await planted(env, { marker: null, writes: 5, steps: 5 });
  const tab = await env.open();
  assert.equal(tab.state.recovery?.kind, 'interrupted');
  assert.equal(tab.state.recovery.canRestorePrior, true);
  assert.throws(() => tab.storage.setItem(KEY, '{}'), /did not finish/);
});

test('row 5: an unreadable journal pauses saving, offers it for download, and the keep-current exit ends it', async () => {
  const env = environment();
  const prior = priorOf(env);
  env.journal.plantRaw({ id: 'x', backup: 'not a backup' }, { id: 'x', writes: 'many' });
  const tab = await env.open();
  assert.equal(tab.state.recovery?.kind, 'invalid');
  assert.equal(tab.state.recovery.download, 'raw');
  const copy = JSON.parse(await tab.exportPrior());
  assert.equal(copy.verified, false);
  assert.equal((await tab.restore((await fileBackup()).text)).ok, false);
  assert.equal((await tab.keepCurrent()).ok, true);
  assert.equal(env.journal.record, null);
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(tab.state.phase, 'open');
  assertImage(env, prior, 'kept without a write');
});

test('row 6: an active marker with its journal pauses at once and offers Finish, Restore prior and the copy', async () => {
  const env = environment();
  const prior = priorOf(env);
  const { plan, record } = await planted(env, { marker: 'active', writes: 2, steps: 2 });
  const tab = env.make();
  tab.start();
  assert.equal(tab.state.phase, 'paused', 'the marker alone pauses saving, before the journal is read');
  await tab.settled;
  await tab.inspect();
  assert.deepEqual(
    { kind: tab.state.recovery.kind, finish: tab.state.recovery.canFinish, prior: tab.state.recovery.canRestorePrior, download: tab.state.recovery.download },
    { kind: 'interrupted', finish: true, prior: true, download: 'prior' },
  );
  assert.equal((await tab.restore((await fileBackup()).text)).ok, false, 'refused until recovery ends');
  assert.equal((await tab.recover('prior')).ok, true);
  assertImage(env, prior, 'put back');
  assert.equal(readMarker(env.storage).raw, `done:${record.id}`);
  assert.ok(plan);
});

test('row 7: a foreign edit is reported and never overwritten; Finish refuses and the keep-current exit ends it', async () => {
  const env = environment();
  await planted(env, { marker: 'active', writes: 3, steps: 3 });
  env.storage.map.set(LIST_HISTORY_KEY, 'FOREIGN_SAVED_EDIT');
  const tab = await env.open();
  assert.equal(tab.state.recovery?.kind, 'foreign');
  assert.equal(tab.state.recovery.canFinish, false);
  assert.equal(tab.state.recovery.canKeep, true);
  assert.equal((await tab.recover('forward')).ok, false);
  assert.equal(env.storage.map.get(LIST_HISTORY_KEY), 'FOREIGN_SAVED_EDIT');
  const before = priorOf(env);
  assert.equal((await tab.keepCurrent()).ok, true);
  assert.deepEqual(priorOf(env), before, 'the exit writes no user data');
  assert.equal(env.journal.record, null);
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(tab.state.phase, 'open');
  tab.storage.setItem(SIDEBAR_KEY, 'true');
});

test('row 8: an active marker without its journal says the copy is missing and offers only the exit', async () => {
  for (const variant of ['absent', 'other', 'invalid']) {
    const env = environment();
    if (variant === 'other') await planted(env, { id: 'b'.repeat(64) });
    if (variant === 'invalid') env.journal.plantRaw({ id: 'c' }, null);
    env.storage.map.set(RESTORE_MARKER_KEY, `active:${'a'.repeat(64)}`);
    const tab = await env.open();
    assert.equal(tab.state.recovery?.kind, 'missing', variant);
    assert.equal(tab.state.recovery.canFinish, false);
    assert.equal(tab.state.recovery.download, { absent: null, other: 'prior', invalid: 'raw' }[variant], variant);
    assert.equal((await tab.keepCurrent()).ok, true, variant);
    assert.equal(tab.state.phase, 'open', variant);
  }
});

test('row 9: a cleaning marker finishes its cleanup at startup, waiting for other tabs to close', async () => {
  const env = environment();
  const { record } = await planted(env, { marker: 'cleaning', phase: 'done', writes: 8, steps: 8, finishedAt: env.now });
  const other = await (async () => { const tab = env.make(); await tab.start(); return tab; })();
  const tab = env.make();
  tab.start();
  assert.equal(tab.state.phase, 'paused');
  await tab.settled;
  const inspecting = tab.inspect();
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(tab.state.message, RESTORE_MESSAGES.cleaning, 'waiting for the other tab');
  await other.releaseShared();
  await inspecting;
  assert.equal(env.journal.record, null);
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(tab.state.phase, 'open');
  assert.ok(record);
  const second = environment();
  second.storage.map.set(RESTORE_MARKER_KEY, `cleaning:${'d'.repeat(64)}`);
  const alone = await second.open();
  assert.equal(readMarker(second.storage).state, 'absent', 'a cleaning marker with no journal is simply cleared');
  assert.equal(alone.state.phase, 'open');
});

test('row 10: a cleaning marker beside another restore\'s journal clears the marker, then judges that journal', async () => {
  const env = environment();
  await planted(env, { id: 'b'.repeat(64), marker: null });
  env.storage.map.set(RESTORE_MARKER_KEY, `cleaning:${'a'.repeat(64)}`);
  const tab = await env.open();
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(env.journal.record, null, 'the other journal never wrote, so it is discarded as row 2');
  assert.equal(tab.state.phase, 'open');
  const invalid = environment();
  invalid.journal.plantRaw({ id: 'z' }, null);
  invalid.storage.map.set(RESTORE_MARKER_KEY, `cleaning:${'a'.repeat(64)}`);
  const second = await invalid.open();
  assert.equal(readMarker(invalid.storage).state, 'absent');
  assert.equal(second.state.recovery?.kind, 'invalid', 'an unreadable journal then pauses as row 5');
});

test('row 11: a done marker keeps its journal for a day, then a start clears it; the next restore clears it sooner', async () => {
  const env = environment();
  const tab = await env.open();
  assert.equal((await tab.restore((await fileBackup()).text)).ok, true);
  const restored = priorOf(env);
  const id = env.journal.record.id;
  const later = await env.open();
  assert.equal(later.state.phase, 'open');
  assert.equal(env.journal.record?.id, id, 'kept while the browser may still be saving');
  later.storage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light' }));
  env.now += DAY;
  const dayLater = env.make();
  await dayLater.start();
  await later.releaseShared();
  await tab.releaseShared();
  await dayLater.inspect();
  assert.equal(env.journal.record, null);
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(dayLater.state.recovery, null, 'an edit after a finished restore is never mistaken for a foreign one');
  assert.notDeepEqual(priorOf(env), restored);
  const again = environment();
  const first = await again.open();
  await first.restore((await fileBackup()).text);
  const firstId = again.journal.record.id;
  assert.equal((await first.restore((await fileBackup()).text)).ok, true);
  assert.notEqual(again.journal.record.id, firstId, 'the next restore replaces the kept journal');
});

test('row 12: a done marker whose journal is gone is cleared at startup', async () => {
  const env = environment();
  env.storage.map.set(RESTORE_MARKER_KEY, `done:${'a'.repeat(64)}`);
  const tab = await env.open();
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(tab.state.phase, 'open');
});

test('row 13: a done marker beside a newer restore\'s journal treats that journal as having lost its marker', async () => {
  const env = environment();
  await planted(env, { id: 'b'.repeat(64), marker: null, writes: 8, phase: 'done', finishedAt: env.now });
  env.storage.map.set(RESTORE_MARKER_KEY, `done:${'a'.repeat(64)}`);
  const tab = await env.open();
  assert.equal(tab.state.recovery?.kind, 'lost', 'its writes were lost with its marker');
});

test('row 14: a done marker with an unreadable journal pauses as an unreadable journal does', async () => {
  const env = environment();
  env.journal.plantRaw({ id: 'a' }, { id: 'a' });
  env.storage.map.set(RESTORE_MARKER_KEY, `done:${'a'.repeat(64)}`);
  const tab = await env.open();
  assert.equal(tab.state.recovery?.kind, 'invalid');
  assert.equal(decideRestoreState(readMarker(env.storage), { kind: 'absent' }, env.storage, env.now).kind, 'clear-marker');
});

// IndexedDB can fail a read once (an open timeout, an abort, an error) and succeed on the next. Such a
// copy is said as one that could not be checked, never as missing, so nothing treats it as gone.
test('an active marker with a journal that cannot be read is unchecked; keeping leaves the copy for a later start', async () => {
  const env = environment();
  const { record } = await planted(env, { marker: 'active', writes: 3, steps: 3 });
  env.journal.faults.read = Infinity;
  const tab = await env.open();
  assert.deepEqual(
    { kind: tab.state.recovery?.kind, download: tab.state.recovery?.download, finish: tab.state.recovery?.canFinish, keep: tab.state.recovery?.canKeep },
    { kind: 'unchecked', download: null, finish: false, keep: true },
  );
  assert.match(tab.state.recovery.message, /could not be checked just now/);
  assert.ok(tab.state.recovery.message.endsWith('a later start offers it again if it can.'));
  assert.ok(keepCurrentQuestion(tab.state.recovery).endsWith('so it is left in place, and a later start offers it again if it can.'), 'the question says what the status says');
  assert.equal(await tab.recoveryCopyHeld(), null, 'the erase question says it could not check');
  const writesBefore = env.storage.history.length;
  assert.equal((await tab.keepCurrent()).ok, true);
  assert.deepEqual(
    env.storage.history.slice(writesBefore).map((image) => image.get(RESTORE_MARKER_KEY) ?? null),
    [null],
    'cleared directly: a cleaning marker would tell a later start to remove the copy being left for it',
  );
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(env.journal.record?.id, record.id, 'the copy was never deleted');
  env.journal.faults.read = 0;
  await tab.releaseShared();
  const later = await env.open();
  assert.equal(later.state.recovery?.kind, 'interrupted', 'a later start that can read it offers it again');
  assert.equal(later.state.recovery.download, 'prior');

  // With no marker the page opens, and only complete restore waits for a reload, which checks again.
  const quiet = environment();
  await planted(quiet, { marker: null, writes: 3, steps: 3 });
  quiet.journal.faults.read = Infinity;
  const page = await quiet.open();
  assert.equal(page.state.phase, 'open');
  assert.equal(page.state.available, false);
  assert.equal(page.state.unavailableReason, RESTORE_MESSAGES.journalUnchecked, 'a failed check, not a missing capability');
  const refused = await page.restore((await fileBackup()).text);
  assert.equal(refused.error, 'Recap Page could not check for a recovery copy from an earlier complete restore just now, so nothing was replaced. Reload the page to try again.');
  quiet.journal.faults.read = 0;
  assert.equal(quiet.journal.record?.writes, 3, 'an earlier journal that could not be read is never written over');
});

test('a copy unreadable at the start is never deleted unseen: keeping finds it readable and shows it again', async () => {
  const env = environment();
  const { record } = await planted(env, { marker: 'active', writes: 3, steps: 3 });
  env.journal.faults.read = 1;
  const tab = await env.open();
  assert.equal(tab.state.recovery?.kind, 'unchecked');
  assert.equal(tab.state.unavailableReason, null, 'no verdict for the rest of the session');
  const kept = await tab.keepCurrent();
  assert.equal(kept.ok, false);
  assert.equal(kept.error, RESTORE_MESSAGES.copyReadable);
  assert.equal(env.journal.record?.id, record.id, 'the copy is still there');
  assert.equal(readMarker(env.storage).raw, `active:${record.id}`);
  assert.deepEqual(
    { kind: tab.state.recovery?.kind, download: tab.state.recovery?.download, finish: tab.state.recovery?.canFinish },
    { kind: 'interrupted', download: 'prior', finish: true },
    'the copy, Finish and Restore prior data are offered instead',
  );
  assert.equal(JSON.parse(await tab.exportPrior()).restoreId, record.id);
  assert.equal(tab.state.phase, 'paused');
});

test('a copy unreadable when a restore stops is never deleted unseen either', async () => {
  const env = environment();
  const prior = priorOf(env);
  const tab = await env.open();
  const progress = env.journal.progress;
  let calls = 0;
  env.journal.progress = async (record) => {
    calls += 1;
    if (calls === 3) {
      env.journal.faults.read = 1;
      throw new Error('Injected checkpoint failure');
    }
    return progress(record);
  };
  assert.equal((await tab.restore((await fileBackup()).text)).ok, false);
  assert.equal(tab.state.recovery?.kind, 'unchecked', 'the failed read is said as one');
  const id = env.journal.record.id;
  env.journal.progress = progress;
  const kept = await tab.keepCurrent();
  assert.equal(kept.ok, false);
  assert.equal(env.journal.record?.id, id);
  assert.equal(tab.state.recovery?.kind, 'interrupted');
  assert.equal(tab.state.recovery.download, 'prior');
  assert.equal((await tab.recover('prior')).ok, true);
  assertImage(env, prior, 'and the earlier data can still be put back');
});

test('keeping the current data is refused when the recovery never offered it', async () => {
  const env = environment();
  const { record } = await planted(env, { marker: 'active', writes: 3, steps: 3 });
  const tab = await env.open();
  assert.equal(tab.state.recovery?.kind, 'interrupted');
  assert.equal(tab.state.recovery.canKeep, false);
  const before = priorOf(env);
  const kept = await tab.keepCurrent();
  assert.equal(kept.ok, false);
  assert.equal(kept.error, RESTORE_MESSAGES.keepNotOffered);
  assert.equal(env.journal.record?.id, record.id);
  assert.equal(readMarker(env.storage).raw, `active:${record.id}`);
  assert.deepEqual(priorOf(env), before);
  assert.equal(tab.state.phase, 'paused');
});

// The card hides Finish restore and Restore prior data wherever a recovery leaves them out, so only a
// stale or scripted call reaches the next three cases, and the cloud backup will call this engine.
// Unguarded, either choice wrote over a restore the reader had been told was finished (#947).
function assertUntouched(env, record, marker, message) {
  assert.equal(readMarker(env.storage).raw, marker, `${message}: marker`);
  assert.deepEqual(env.journal.record, record, `${message}: journal`);
}

test('Finish and Restore prior data are refused during the cleanup after a finished restore, and after it', async () => {
  // A cleanup that cannot clear its marker, which pauses saving as a cleanup, and one whose copy cannot
  // be removed, which opens normally and leaves the copy for a later start. Neither offers either way.
  for (const fault of ['marker', 'copy']) {
    const cleanup = environment();
    await planted(cleanup, { marker: 'cleaning', phase: 'done', writes: 8, steps: 8, finishedAt: cleanup.now });
    if (fault === 'marker') cleanup.storage.refuseRemoval.add(RESTORE_MARKER_KEY);
    else cleanup.journal.faults.remove = true;
    const page = await cleanup.open();
    assert.equal(page.state.recovery?.kind ?? null, fault === 'marker' ? 'cleanup' : null, fault);
    const restored = priorOf(cleanup);
    const kept = cleanup.journal.record;
    const marker = readMarker(cleanup.storage).raw;
    for (const [direction, error] of [['prior', RESTORE_MESSAGES.priorNotOffered], ['forward', RESTORE_MESSAGES.finishNotOffered]]) {
      const result = await page.recover(direction);
      assert.deepEqual({ ok: result.ok, changed: result.changed, error: result.error }, { ok: false, changed: false, error }, `${fault} ${direction}`);
      assert.deepEqual(priorOf(cleanup), restored, `${fault} ${direction}: the restored data stays`);
      assertUntouched(cleanup, kept, marker, `${fault} ${direction}`);
    }
    assert.equal(page.state.recovery?.kind ?? null, fault === 'marker' ? 'cleanup' : null, `${fault}: the choices on screen stay`);
  }

  // A finished restore whose journal is kept, with nothing shown at all.
  const finished = environment();
  const page = await finished.open();
  assert.equal((await page.restore((await fileBackup()).text)).ok, true);
  assert.equal(page.state.recovery, null);
  const done = priorOf(finished);
  const journal = finished.journal.record;
  assert.equal((await page.recover('prior')).error, RESTORE_MESSAGES.priorNotOffered);
  assert.deepEqual(priorOf(finished), done, 'a finished restore is never undone by a call nothing offered');
  assertUntouched(finished, journal, `done:${journal.id}`, 'finished');
});

test('a choice the shown recovery leaves out is refused, even where it would hold under the lock', async () => {
  // Finish was never on screen for a foreign edit. Here the edit is undone behind the page, as a tab of
  // an earlier version could, so only the recovery that was shown can refuse it.
  const foreign = environment();
  const { record: edited } = await planted(foreign, { marker: 'active', writes: 3, steps: 3 });
  const original = foreign.storage.map.get(LIST_HISTORY_KEY);
  foreign.storage.map.set(LIST_HISTORY_KEY, 'FOREIGN_SAVED_EDIT');
  const reported = await foreign.open();
  assert.equal(reported.state.recovery?.kind, 'foreign');
  if (original === undefined) foreign.storage.map.delete(LIST_HISTORY_KEY);
  else foreign.storage.map.set(LIST_HISTORY_KEY, original);
  const before = priorOf(foreign);
  const finish = await reported.recover('forward');
  assert.deepEqual({ ok: finish.ok, changed: finish.changed, error: finish.error }, { ok: false, changed: false, error: RESTORE_MESSAGES.finishNotOffered });
  assert.deepEqual(priorOf(foreign), before, 'nothing is written');
  assertUntouched(foreign, edited, `active:${edited.id}`, 'foreign');

  // A recovery that offers one direction only: the restore's writes were all lost, so nothing is put back.
  const lost = environment();
  await planted(lost, { marker: null, phase: 'done', writes: 8, finishedAt: lost.now });
  const reopened = await lost.open();
  assert.deepEqual(
    { kind: reopened.state.recovery?.kind, finish: reopened.state.recovery?.canFinish, prior: reopened.state.recovery?.canRestorePrior },
    { kind: 'lost', finish: true, prior: false },
  );
  const record = lost.journal.record;
  assert.equal((await reopened.recover('prior')).error, RESTORE_MESSAGES.priorNotOffered);
  assertUntouched(lost, record, null, 'lost');
});

test('an offer that no longer holds under the lock is refused, and the choices that hold now are shown', async () => {
  // Every restore write is put back behind the page, so there is nothing left to restore the prior data
  // over, and the decision made again under the lock says so, as keeping does.
  const stale = environment();
  const prior = priorOf(stale);
  const { record: interrupted } = await planted(stale, { marker: 'active', writes: 2, steps: 2 });
  const shown = await stale.open();
  assert.equal(shown.state.recovery?.canRestorePrior, true);
  for (const [key, value] of Object.entries(prior)) {
    if (value === null) stale.storage.map.delete(key);
    else stale.storage.map.set(key, value);
  }
  const refused = await shown.recover('prior');
  assert.deepEqual({ ok: refused.ok, changed: refused.changed, error: refused.error }, { ok: false, changed: false, error: RESTORE_MESSAGES.priorNotOffered });
  assert.deepEqual(
    { kind: shown.state.recovery?.kind, prior: shown.state.recovery?.canRestorePrior, finish: shown.state.recovery?.canFinish },
    { kind: 'interrupted', prior: false, finish: true },
    'the choices shown are the ones that hold now',
  );
  assertUntouched(stale, interrupted, `active:${interrupted.id}`, 'stale');
  assert.deepEqual(priorOf(stale), prior, 'nothing is written');
  assert.equal(shown.state.phase, 'paused');
});

// A done: or cleaning: marker follows data the reader already accepted. Beside a journal that cannot be
// read it stays, so a later start that can read the journal applies its rows. Cleared, the journal a
// finished restore kept would come back as a foreign recovery saying that restore did not finish.
test('erasing beside a journal that cannot be read leaves a done marker, so a finished restore never returns as a foreign one', async () => {
  const env = environment();
  const tab = await env.open();
  assert.equal((await tab.restore((await fileBackup()).text)).ok, true);
  const { id } = env.journal.record;
  await tab.releaseShared();
  env.journal.faults.read = Infinity;
  const page = await env.open();
  assert.equal(page.state.phase, 'open');
  assert.equal(await page.recoveryCopyHeld(), null, 'the erase question says it could not check, not that the copy goes');
  const erased = await page.erase(async () => {
    page.storage.setItem(KEY, JSON.stringify({ writeToken: 'erased', ...exportBackup(createEmptyState()) }));
    page.storage.removeItem(LIST_HISTORY_KEY);
    page.storage.removeItem(IMPORT_DRAFT_KEY);
    return true;
  });
  assert.deepEqual(erased, {
    ok: true, erased: true, copyRemoved: false,
    error: 'The app could not check for a recovery copy kept by a complete restore, so one may still be in this browser.',
  });
  assert.equal(readMarker(env.storage).raw, `done:${id}`, 'the marker stays with its journal');
  assert.equal(env.journal.record?.id, id);
  env.journal.faults.read = 0;
  await page.releaseShared();
  const later = await env.open();
  assert.equal(later.state.recovery, null, 'a later start that can read the journal applies the done: rows');
  assert.equal(later.state.phase, 'open');
});

test('a cleaning marker beside a journal that cannot be read opens as a done marker does, and stays until a start can finish the cleanup', async () => {
  const env = environment();
  const { record } = await planted(env, { marker: 'cleaning', phase: 'done', writes: 8, steps: 8, finishedAt: env.now });
  env.journal.faults.read = Infinity;
  const tab = await env.open();
  assert.equal(tab.state.phase, 'open', 'a cleanup follows data the reader already accepted, so saving does not wait on it');
  assert.equal(tab.state.recovery, null);
  assert.equal(tab.state.unavailableReason, RESTORE_MESSAGES.journalUnchecked);
  tab.storage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light' }));
  const erased = await tab.erase(async () => {
    tab.storage.setItem(KEY, JSON.stringify({ writeToken: 'erased', ...exportBackup(createEmptyState()) }));
    return true;
  });
  assert.equal(erased.error, RESTORE_MESSAGES.copyUnchecked);
  assert.equal(readMarker(env.storage).raw, `cleaning:${record.id}`, 'the marker stays with its journal');
  env.journal.faults.read = 0;
  await tab.releaseShared();
  const later = await env.open();
  assert.equal(env.journal.record, null, 'a start that can read the journal finishes the cleanup');
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(later.state.recovery, null, 'never reopened as a restore that did not finish');
  assert.equal(later.state.phase, 'open');
});

// A copy that can be read but not removed, as on a full disk, waits with its cleaning: marker for a later
// start, the way an unreadable one does. Every recovery action ends in a reload, so a start that paused
// on it would pause again straight after keeping, at every start, for as long as the disk stayed full
// (#947). A cleanup that cannot clear its marker still pauses, because what the marker hides may be
// another restore's journal.
test('a cleanup whose recovery copy cannot be removed opens normally, and the copy waits with its marker for a later start', async () => {
  const env = environment();
  const { record } = await planted(env, { marker: 'cleaning', phase: 'done', writes: 8, steps: 8, finishedAt: env.now });
  env.journal.faults.remove = true;
  const tab = await env.open();
  assert.equal(tab.state.phase, 'open', 'saving is not paused');
  assert.equal(tab.state.recovery, null);
  assert.equal(tab.state.unavailableReason, RESTORE_MESSAGES.copyStuck);
  assert.match(tab.state.unavailableReason, /perhaps because storage is full/);
  assert.equal(readMarker(env.storage).raw, `cleaning:${record.id}`, 'the marker stays for a later start');
  assert.equal(env.journal.record?.id, record.id, 'and so does the copy');
  tab.storage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light' }));
  const refused = await tab.restore((await fileBackup()).text);
  assert.deepEqual({ ok: refused.ok, changed: refused.changed, error: refused.error }, { ok: false, changed: false, error: RESTORE_MESSAGES.copyKept });
  await tab.releaseShared();
  const again = await env.open();
  assert.equal(again.state.phase, 'open', 'a reload while the copy still cannot be removed opens normally too');
  assert.equal(again.state.unavailableReason, RESTORE_MESSAGES.copyStuck);
  env.journal.faults.remove = false;
  await again.releaseShared();
  const later = await env.open();
  assert.equal(env.journal.record, null, 'a start that can remove the copy finishes the cleanup');
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(later.state.unavailableReason, null);
  assert.equal(later.state.phase, 'open');
});

test('a cleanup that cannot clear its marker pauses as a cleanup, and says what reloading and keeping do', async () => {
  const env = environment();
  await planted(env, { marker: 'cleaning', phase: 'done', writes: 8, steps: 8, finishedAt: env.now });
  env.storage.refuseRemoval.add(RESTORE_MARKER_KEY);
  const tab = await env.open();
  assert.deepEqual(
    { kind: tab.state.recovery?.kind, download: tab.state.recovery?.download, keep: tab.state.recovery?.canKeep },
    { kind: 'cleanup', download: null, keep: true },
  );
  assert.equal(tab.state.message, RESTORE_MESSAGES.cleanupFailed);
  assert.match(tab.state.message, /perhaps because storage is full, so saving is paused\. Reload the page to try again, or open Backup & settings and keep the data that is here\.$/);
  const question = keepCurrentQuestion(tab.state.recovery);
  assert.ok(question.endsWith('at once, or at a later start if this browser cannot remove it yet.'), question);
  for (const said of [tab.state.message, tab.state.recovery.message, question]) {
    assert.doesNotMatch(said, /did not finish|missing|no recovery copy left|is then finished/i, said);
  }
  env.storage.refuseRemoval.clear();
  assert.equal((await tab.keepCurrent()).ok, true, 'keeping finishes the cleanup once the marker can be cleared');
  assert.equal(env.journal.record, null);
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(tab.state.phase, 'open');
});

// Keeping finishes whatever upkeep a fresh decision leaves, and never ends recovery over another restore's
// journal. A copy that cannot be removed is the one failure it does not wait on: the person's choice is
// made, so the copy waits with its cleaning: marker, and the reload that follows does not pause again.
test('keeping whose recovery copy cannot be removed ends the pause, and the copy waits with its marker for a later start', async () => {
  const env = environment();
  const { record } = await planted(env, { marker: 'active', writes: 3, steps: 3 });
  env.storage.map.set(LIST_HISTORY_KEY, 'FOREIGN');
  const tab = await env.open();
  assert.equal(tab.state.recovery?.kind, 'foreign');
  env.journal.faults.remove = true;
  assert.deepEqual(await tab.keepCurrent(), { ok: true, changed: false, copyKept: true });
  assert.equal(readMarker(env.storage).raw, `cleaning:${record.id}`, 'the marker says the cleanup is still to do');
  assert.equal(env.journal.record?.id, record.id, 'and the copy waits with it');
  assert.equal(tab.state.phase, 'open', 'saving starts again');
  assert.equal(tab.state.recovery, null);
  assert.equal(tab.state.unavailableReason, RESTORE_MESSAGES.copyStuck);
  tab.storage.setItem(SETTINGS_KEY, JSON.stringify({ theme: 'light' }));
  await tab.releaseShared();
  const reloaded = await env.open();
  assert.equal(reloaded.state.phase, 'open', 'the reload that follows keeping does not pause again');
  assert.equal(reloaded.state.recovery, null);
  env.journal.faults.remove = false;
  await reloaded.releaseShared();
  const later = await env.open();
  assert.equal(env.journal.record, null, 'a start that can remove the copy finishes the cleanup');
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(later.state.unavailableReason, null);
});

test('the keep question says a recovery copy goes at once, or at a later start if this browser cannot remove it yet, except one the next start offers again', () => {
  const later = 'at once, or at a later start if this browser cannot remove it yet';
  for (const recovery of [{ kind: 'interrupted', download: 'prior' }, { kind: 'cleanup', download: null }]) {
    assert.ok(keepCurrentQuestion(recovery).includes(later), recovery.kind);
  }
  const raw = keepCurrentQuestion({ kind: 'invalid', download: 'raw' });
  assert.ok(!raw.includes(later), 'a copy that fails its checks is never removed by a later start on its own');
  assert.ok(raw.includes('If this browser cannot remove it yet, the next start offers it again.'), raw);
  assert.ok(!keepCurrentQuestion({ kind: 'unchecked', download: null }).includes(later), 'an unchecked copy is never deleted by keeping');
  assert.ok(keepCurrentQuestion({ kind: 'missing', download: null }).endsWith('There is no recovery copy left to delete.'));
});

// A copy that fails its checks cannot wait with its cleaning: marker the way a readable one does: the
// next start clears that marker and offers the copy again (#954). The behavior is left as it is; what
// keeping and erase say about it is what this holds. Both recoveries over such a copy are covered.
test('a recovery copy that fails its checks and cannot be removed is offered again at the next start, and keeping and erase say so', async () => {
  for (const variant of ['invalid', 'missing']) {
    const env = environment();
    env.journal.plantRaw({ id: 'x', backup: 'not a backup' }, null);
    if (variant === 'missing') env.storage.map.set(RESTORE_MARKER_KEY, `active:${'a'.repeat(64)}`);
    const tab = await env.open();
    assert.deepEqual({ kind: tab.state.recovery?.kind, download: tab.state.recovery?.download }, { kind: variant, download: 'raw' });
    env.journal.faults.remove = true;
    const kept = await tab.keepCurrent();
    assert.deepEqual(kept, { ok: true, changed: false, copyKept: true, offered: true }, variant);
    assert.equal(keptNotice(kept), 'The data that was here is unchanged, but the recovery copy could not be removed, perhaps because storage is full, so it is offered again.');
    assert.equal(tab.state.unavailableReason, RESTORE_MESSAGES.copyStuckOffered, variant);
    await tab.releaseShared();
    const next = await env.open();
    assert.deepEqual({ phase: next.state.phase, kind: next.state.recovery?.kind }, { phase: 'paused', kind: 'invalid' }, `${variant}: the reload after keeping offers it again`);
    const erased = await next.erase(async () => true);
    assert.deepEqual(erased, { ok: true, erased: true, copyRemoved: false, error: RESTORE_MESSAGES.copyOffered }, variant);
    assert.equal(next.state.unavailableReason, RESTORE_MESSAGES.copyStuckOffered, variant);
    await next.releaseShared();
    const after = await env.open();
    assert.deepEqual({ phase: after.state.phase, kind: after.state.recovery?.kind }, { phase: 'paused', kind: 'invalid' }, `${variant}: and so does the next start after erase`);
    assert.equal(env.journal.record?.id, 'x', 'the copy is still there');
  }
  // A copy that can be read keeps its own wording: it waits for a later start.
  assert.equal(keptNotice({ ok: true, copyKept: true }), `Recovery ended. Saving has started again with the data that was here. ${RESTORE_MESSAGES.copyKept}`);
});

test('keeping that uncovers another restore\'s journal shows its choices instead of ending recovery over it', async () => {
  const env = environment();
  const { record } = await planted(env, { id: 'b'.repeat(64), marker: null, writes: 3, steps: 3 });
  // A cleanup marker the start could not clear, beside a journal another restore left.
  env.storage.map.set(RESTORE_MARKER_KEY, `cleaning:${'a'.repeat(64)}`);
  env.storage.refuseRemoval.add(RESTORE_MARKER_KEY);
  const tab = await env.open();
  assert.equal(tab.state.phase, 'paused');
  env.storage.refuseRemoval.clear();
  const kept = await tab.keepCurrent();
  assert.equal(kept.ok, false);
  assert.equal(kept.error, RESTORE_MESSAGES.copyChanged);
  assert.deepEqual(
    { kind: tab.state.recovery?.kind, id: tab.state.recovery?.id, download: tab.state.recovery?.download },
    { kind: 'interrupted', id: record.id, download: 'prior' },
    'the other restore\'s choices are shown',
  );
  assert.equal(tab.state.phase, 'paused');
  assert.equal(env.journal.record?.id, record.id, 'and its copy is kept');
  assert.equal(readMarker(env.storage).state, 'absent');
});

// Keeping ends a pause over a cleanup that failed only when what failed was removing a copy. A marker it
// cannot save or clear may hide another restore's half-applied journal, so keeping stays paused with the
// choices shown and nothing changed. Each case below reaches one of keep's two guards.
const MARKER_REFUSED = 'The restore marker could not be saved. Nothing further was changed.';

test('keeping behind a cleaning marker it cannot clear, beside another restore\'s journal, stays paused with nothing changed', async () => {
  const env = environment();
  const { record } = await planted(env, { id: 'b'.repeat(64), marker: null, writes: 3, steps: 3 });
  env.storage.map.set(RESTORE_MARKER_KEY, `cleaning:${'a'.repeat(64)}`);
  env.storage.refuseRemoval.add(RESTORE_MARKER_KEY);
  const tab = await env.open();
  const shown = tab.state.recovery;
  assert.deepEqual({ phase: tab.state.phase, kind: shown?.kind }, { phase: 'paused', kind: 'cleanup' });
  const kept = await tab.keepCurrent();
  assert.deepEqual({ ok: kept.ok, error: kept.error, copyKept: kept.copyKept }, { ok: false, error: MARKER_REFUSED, copyKept: undefined });
  assert.equal(tab.state.phase, 'paused');
  assert.deepEqual(tab.state.recovery, shown, 'the choices shown are unchanged');
  assert.equal(env.journal.record?.id, record.id, 'the other restore\'s journal is kept');
  assert.equal(readMarker(env.storage).raw, `cleaning:${'a'.repeat(64)}`);
});

test('keeping a recovery whose cleanup cannot save its marker stays paused with nothing changed', async () => {
  const env = environment();
  const { record } = await planted(env, { marker: 'active', writes: 3, steps: 3 });
  env.storage.map.set(LIST_HISTORY_KEY, 'FOREIGN');
  const tab = await env.open();
  const shown = tab.state.recovery;
  assert.deepEqual({ kind: shown?.kind, keep: shown?.canKeep }, { kind: 'foreign', keep: true });
  env.storage.refuse.add(RESTORE_MARKER_KEY);
  const kept = await tab.keepCurrent();
  assert.deepEqual({ ok: kept.ok, error: kept.error, copyKept: kept.copyKept }, { ok: false, error: MARKER_REFUSED, copyKept: undefined });
  assert.equal(tab.state.phase, 'paused');
  assert.deepEqual(tab.state.recovery, shown, 'the choices shown are unchanged');
  assert.equal(env.journal.record?.id, record.id, 'the recovery copy is kept');
  assert.equal(readMarker(env.storage).raw, `active:${record.id}`);
});

// ------------------------------------------------------------------ order, exits and erase

test('a journal that cannot be saved stops the restore before its marker, with nothing written', async () => {
  const env = environment();
  const prior = priorOf(env);
  const tab = await env.open();
  env.journal.faults.begin = true;
  const result = await tab.restore((await fileBackup()).text);
  assert.equal(result.ok, false);
  assert.equal(result.changed, false);
  assert.equal(readMarker(env.storage).state, 'absent', 'no marker without a journal');
  assertImage(env, prior, 'unchanged');
  env.journal.faults.begin = false;
  const reopened = await env.open();
  assert.equal(reopened.state.phase, 'open', 'the next start is ordinary');
  assert.equal(reopened.state.recovery, null);
});

test('foreign bytes are never accepted as prepared: recovery refuses and leaves them in place', async () => {
  const env = environment();
  const { effects } = await planted(env, { marker: 'active', writes: 4, steps: 4 });
  env.storage.map.set(KEY, effects[2].value.replace('Restored note', 'Planted note'));
  const tab = await env.open();
  assert.equal(tab.state.recovery?.kind, 'foreign');
  assert.equal((await tab.recover('forward')).ok, false);
  assert.equal((await tab.recover('prior')).ok, false);
  assert.match(env.storage.map.get(KEY), /Planted note/);
});

test('an interrupted cleanup leaves a cleaning marker, which the next start finishes; it never leaves a bare journal', async () => {
  const env = environment();
  await planted(env, { marker: 'active', writes: 3, steps: 3 });
  env.storage.map.set(LIST_HISTORY_KEY, 'FOREIGN');
  const tab = await env.open();
  env.journal.faults.remove = true;
  assert.equal((await tab.keepCurrent()).copyKept, true);
  assert.match(readMarker(env.storage).raw, /^cleaning:/, 'the marker says cleaning while the journal remains');
  env.journal.faults.remove = false;
  await tab.releaseShared();
  const next = await env.open();
  assert.equal(env.journal.record, null);
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(next.state.phase, 'open');
  assert.equal(next.state.recovery, null, 'finished as cleanup, not reopened as a foreign edit');
});

test('erase works while a recovery is pending: user data first, then the journal and marker in cleanup order', async () => {
  const env = environment();
  await planted(env, { marker: 'active', writes: 2, steps: 2 });
  const tab = await env.open();
  assert.equal(tab.state.phase, 'paused');
  assert.equal(await tab.recoveryCopyHeld(), true, 'the erase question names the recovery copy');
  const seen = [];
  const result = await tab.erase(async () => {
    seen.push(env.journal.record !== null, readMarker(env.storage).state);
    tab.storage.setItem(KEY, JSON.stringify({ writeToken: 'erased', ...exportBackup(createEmptyState()) }));
    tab.storage.removeItem(LIST_HISTORY_KEY);
    tab.storage.removeItem(IMPORT_DRAFT_KEY);
    return true;
  });
  assert.deepEqual(seen, [true, 'active'], 'the journal and marker are still there while user data is erased');
  assert.equal(result.ok, true);
  assert.equal(result.copyRemoved, true);
  assert.equal(env.journal.record, null);
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(tab.state.phase, 'open');
  assert.equal(await tab.recoveryCopyHeld(), false);
  const kept = environment();
  const plain = await kept.open();
  await plain.restore((await fileBackup()).text);
  assert.equal(await plain.recoveryCopyHeld(), true, 'a kept journal is named too');
  assert.equal((await plain.erase(async () => true)).copyRemoved, true);
  assert.equal(kept.journal.record, null);
});

test('erase whose recovery copy cannot be removed still ends the pause, and the copy waits with its marker for a later start', async () => {
  const env = environment();
  const { record } = await planted(env, { marker: 'active', writes: 2, steps: 2 });
  const tab = await env.open();
  assert.equal(tab.state.phase, 'paused');
  env.journal.faults.remove = true;
  const result = await tab.erase(async () => {
    tab.storage.setItem(KEY, JSON.stringify({ writeToken: 'erased', ...exportBackup(createEmptyState()) }));
    tab.storage.removeItem(LIST_HISTORY_KEY);
    tab.storage.removeItem(IMPORT_DRAFT_KEY);
    return true;
  });
  assert.deepEqual(result, { ok: true, erased: true, copyRemoved: false, error: RESTORE_MESSAGES.copyKept });
  assert.equal(tab.state.phase, 'open', 'saving starts again');
  assert.equal(tab.state.recovery, null);
  assert.equal(tab.state.unavailableReason, RESTORE_MESSAGES.copyStuck);
  assert.equal(readMarker(env.storage).raw, `cleaning:${record.id}`);
  assert.equal(env.journal.record?.id, record.id);
  env.journal.faults.remove = false;
  await tab.releaseShared();
  const later = await env.open();
  assert.equal(env.journal.record, null, 'a start that can remove the copy finishes the cleanup');
  assert.equal(readMarker(env.storage).state, 'absent');
  assert.equal(later.state.phase, 'open');
  assert.equal(later.state.recovery, null, 'finished as cleanup, never reopened as the restore that stopped');
});

// A restore holds the lock from before its marker exists, while it prepares and saves its journal, so
// an erase in the same tab would otherwise run as if nothing were pending and could remove that journal.
test('erase waits for this tab\'s own restore instead of reaching past it', async () => {
  const env = environment();
  const tab = await env.open();
  const begin = env.journal.begin;
  let during = null;
  env.journal.begin = async (record) => {
    during = await tab.erase(async () => { throw new Error('the erase ran'); });
    return begin(record);
  };
  const restored = await tab.restore((await fileBackup()).text);
  assert.deepEqual(during, { ok: false, erased: false, error: RESTORE_MESSAGES.busy });
  assert.equal(restored.ok, true);
});

test('without Web Locks or IndexedDB only complete restore is turned off, with its reason, and saving works', async () => {
  for (const [overrides, reason] of [[{ locks: null }, RESTORE_MESSAGES.noLocks], [{ journal: { available: false } }, RESTORE_MESSAGES.noJournal]]) {
    const env = environment();
    const tab = await env.open(overrides);
    assert.equal(tab.state.phase, 'unavailable');
    assert.equal(tab.state.available, false);
    assert.equal(tab.state.unavailableReason, reason);
    tab.storage.setItem(SETTINGS_KEY, '{}');
    const result = await tab.restore((await fileBackup()).text);
    assert.equal(result.ok, false);
    assert.equal(result.error, reason);
  }
});

test('a write the browser refuses stops the restore part way, and recovery puts the prior data back', async () => {
  const env = environment();
  const prior = priorOf(env);
  env.storage.refuse.add(LIST_HISTORY_KEY);
  const tab = await env.open();
  const result = await tab.restore((await fileBackup()).text);
  assert.equal(result.ok, false);
  assert.match(result.error, /Browser storage is full/);
  assert.equal(tab.state.recovery?.kind, 'interrupted');
  env.storage.refuse.clear();
  assert.equal((await tab.recover('prior')).ok, true);
  assertImage(env, prior, 'put back');
});

test('iOS complete restore quota failure names app storage', async () => {
  const previous = globalThis.document;
  globalThis.document = { documentElement: { dataset: { platform: 'ios' } } };
  try {
    const env = environment();
    const prior = priorOf(env);
    env.storage.refuse.add(LIST_HISTORY_KEY);
    const tab = await env.open();
    const result = await tab.restore((await fileBackup()).text);
    assert.equal(result.ok, false);
    assert.match(result.error, /App storage is full/);
    assert.doesNotMatch(result.error, /browser/i);
    env.storage.refuse.clear();
    assert.equal((await tab.recover('prior')).ok, true);
    assertImage(env, prior, 'put back');
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
});
