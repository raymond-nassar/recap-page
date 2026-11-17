import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  RECONNECT_ADDRESS, STORE_ENGINE_KEY, launchReconnect, observeEngine, reconnectAvailable, waitForEngine,
} from '../src/js/lib/reconnect.js';
import { captureCompleteBackup, RESTORE_KEYS } from '../src/js/lib/completeBackup.js';
import { KEY } from '../src/js/storage.js';
import { createEmptyState, exportBackup } from '../src/js/lib/model.js';
import { checkLocalServer, LOCAL_SERVER_STATUS } from '../src/js/lib/localServer.js';

function memoryStorage() {
  const map = new Map();
  return { map, getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key) };
}

const answer = (status, headers = {}) => ({ status, headers: new Headers(headers) });
const ready = (generation) => answer(204, {
  'X-Recap-Page-Server': '1', ...(generation === undefined ? {} : { 'X-Recap-Page-Generation': generation }),
});

async function probe(storage, reply) {
  const fetchImpl = observeEngine(async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  }, storage);
  return checkLocalServer({ fetchImpl });
}

test('a ready answer from the Store engine is remembered, and any other ready answer forgets it (#1412)', async () => {
  const storage = memoryStorage();
  assert.equal(await probe(storage, ready('a'.repeat(64))), LOCAL_SERVER_STATUS.READY);
  assert.equal(storage.getItem(STORE_ENGINE_KEY), 'store');
  for (const generation of ['development', '', undefined]) {
    storage.setItem(STORE_ENGINE_KEY, 'store');
    await probe(storage, ready(generation));
    assert.equal(storage.getItem(STORE_ENGINE_KEY), null, `generation ${generation}`);
  }
});

test('an answer that is not the engine ready, or no answer, leaves the record alone (#1412)', async () => {
  for (const reply of [new TypeError('Failed to fetch'), answer(404), answer(204), answer(200, { 'X-Recap-Page-Server': '1' })]) {
    const storage = memoryStorage();
    storage.setItem(STORE_ENGINE_KEY, 'store');
    await probe(storage, reply);
    assert.equal(storage.getItem(STORE_ENGINE_KEY), 'store', String(reply?.status ?? reply));
  }
});

test('an unwritable storage still hands the answer back (#1412)', async () => {
  const storage = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); }, removeItem() { throw new Error('SecurityError'); } };
  assert.equal(await probe(storage, ready('b'.repeat(64))), LOCAL_SERVER_STATUS.READY);
});

function scope({ origin = 'http://127.0.0.1:8787', standalone = true } = {}) {
  const assigned = [];
  return {
    assigned,
    location: { origin, assign: (url) => assigned.push(url) },
    matchMedia: (query) => ({ matches: query === '(display-mode: standalone)' && standalone }),
  };
}

test('Reconnect is offered only in the Store app window when nothing answers (#1412)', () => {
  const storage = memoryStorage();
  storage.setItem(STORE_ENGINE_KEY, 'store');
  const unreachable = LOCAL_SERVER_STATUS.UNREACHABLE;
  assert.equal(reconnectAvailable(unreachable, { scope: scope(), storage }), true);
  assert.equal(reconnectAvailable(unreachable, { scope: scope({ standalone: false }), storage }), false, 'a browser tab');
  assert.equal(reconnectAvailable(unreachable, { scope: scope({ origin: 'http://localhost:8787' }), storage }), false, 'another origin');
  assert.equal(reconnectAvailable(LOCAL_SERVER_STATUS.UNEXPECTED, { scope: scope(), storage }), false, 'something else answers');
  assert.equal(reconnectAvailable(unreachable, { scope: scope(), storage: memoryStorage() }), false, 'portable or development engine');
  const unreadable = { getItem() { throw new Error('SecurityError'); } };
  assert.equal(reconnectAvailable(unreachable, { scope: scope(), storage: unreadable }), false, 'unreadable storage');
});

test('Reconnect asks Windows for the fixed address and nothing else (#1412)', () => {
  const window = scope();
  launchReconnect(window);
  assert.deepEqual(window.assigned, [RECONNECT_ADDRESS]);
  assert.equal(RECONNECT_ADDRESS, 'recap-page:');
});

function clock() {
  let time = 0;
  return { now: () => time, sleep: async (ms) => { time += ms; } };
}

test('the wait succeeds only on a ready answer, and ends at its limit (#1412)', async () => {
  const replies = [LOCAL_SERVER_STATUS.UNREACHABLE, LOCAL_SERVER_STATUS.UNEXPECTED, LOCAL_SERVER_STATUS.READY];
  let probes = 0;
  assert.equal(await waitForEngine(async () => { probes += 1; return replies.shift(); }, { ...clock(), waitMs: 10_000, pollMs: 1_000 }), true);
  assert.equal(probes, 3);

  probes = 0;
  const never = await waitForEngine(async () => { probes += 1; return LOCAL_SERVER_STATUS.UNREACHABLE; }, { ...clock(), waitMs: 5_000, pollMs: 1_000 });
  assert.equal(never, false);
  assert.equal(probes, 6, 'checks at 0 to 5 seconds, then stops');
});

test('the wait stops as soon as a newer check takes over (#1412)', async () => {
  let current = true;
  let probes = 0;
  const result = await waitForEngine(async () => {
    probes += 1;
    if (probes === 2) current = false;
    return probes === 2 ? LOCAL_SERVER_STATUS.READY : LOCAL_SERVER_STATUS.UNREACHABLE;
  }, { ...clock(), waitMs: 60_000, pollMs: 1_000, isCurrent: () => current });
  assert.equal(result, false, 'a ready answer that belongs to a newer check is not this attempt\'s success');
  assert.equal(probes, 2);
});

test('the Store engine record stays on this device: backups neither capture nor restore it (#1412)', async () => {
  const storage = memoryStorage();
  storage.setItem(KEY, JSON.stringify(exportBackup(createEmptyState())));
  storage.setItem(STORE_ENGINE_KEY, 'store');
  const capture = await captureCompleteBackup({ storage, cryptoProvider: webcrypto });
  assert.equal(capture.text.includes(STORE_ENGINE_KEY), false);
  assert.equal(RESTORE_KEYS.includes(STORE_ENGINE_KEY), false);
});
