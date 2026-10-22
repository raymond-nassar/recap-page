import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONTENT_CACHE_PREFIX,
  CONTENT_MANIFEST_PATH,
  createOfflineContent,
} from '../src/js/lib/offlineContent.js';

const ORIGIN = 'http://127.0.0.1:8787';
const LIST_ID = 'house-of-m';
const CATALOG = {
  lists: [{
    id: LIST_ID,
    name: 'House of M',
    file: 'house_of_m.json',
    count: 1,
    placeholderCount: 0,
    emptyRecordCount: 0,
  }],
};
const ORDER = { id: LIST_ID, items: [{ issueId: 2092 }] };

function makeResponse(url, body, contentType = 'application/json', status = 200) {
  const bytes = body instanceof Uint8Array
    ? body.slice()
    : new TextEncoder().encode(typeof body === 'string' ? body : JSON.stringify(body));
  return {
    status,
    url,
    type: 'basic',
    redirected: false,
    headers: { get: (name) => name.toLowerCase() === 'content-type' ? contentType : null },
    clone() {
      return makeResponse(url, bytes, contentType, status);
    },
    async arrayBuffer() {
      return bytes.slice().buffer;
    },
    async json() {
      return JSON.parse(new TextDecoder().decode(bytes));
    },
  };
}

function makeCaches() {
  const stores = new Map();
  const calls = { put: [], deleted: [], activePuts: 0, maxActivePuts: 0 };
  let failPut = null;
  let lieOnPut = null;
  let afterPut = null;
  const api = {
    stores,
    calls,
    failNextPut(predicate) { failPut = predicate; },
    lieOnNextPut(predicate) { lieOnPut = predicate; },
    afterNextPut(callback) { afterPut = callback; },
    async keys() { return [...stores.keys()]; },
    async delete(name) {
      calls.deleted.push(name);
      return stores.delete(name);
    },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const entries = stores.get(name);
      return {
        async put(key, response) {
          calls.activePuts += 1;
          calls.maxActivePuts = Math.max(calls.maxActivePuts, calls.activePuts);
          try {
            await Promise.resolve();
            const url = typeof key === 'string' ? key : key.url;
            calls.put.push({ cache: name, url });
            if (failPut?.(name, url)) {
              failPut = null;
              throw new Error('synthetic quota refusal');
            }
            if (lieOnPut?.(name, url)) {
              lieOnPut = null;
              afterPut?.();
              return;
            }
            entries.set(url, response.clone());
            afterPut?.();
          } finally {
            calls.activePuts -= 1;
          }
        },
        async match(key) {
          const url = typeof key === 'string' ? key : key.url;
          const response = entries.get(url);
          return response?.clone() ?? null;
        },
      };
    },
  };
  return api;
}

function makeWorld({ catalog = CATALOG, order = ORDER, caches = makeCaches() } = {}) {
  const calls = [];
  const storageCalls = [];
  const fetchConcurrency = { active: 0, max: 0 };
  const bodies = new Map([
    [`${ORIGIN}/`, ['<!doctype html><title>Recap Page</title>', 'text/html']],
    [`${ORIGIN}/styles.css`, ['body { color: black; }', 'text/css']],
    [`${ORIGIN}/js/app.js`, ['import "./main.js";', 'text/javascript']],
    [`${ORIGIN}/data/catalog.json`, [JSON.stringify(catalog), 'application/json']],
    [`${ORIGIN}/data/house_of_m.json`, [JSON.stringify(order), 'application/json']],
  ]);
  const scope = {
    location: { origin: ORIGIN, href: `${ORIGIN}/#/home` },
    navigator: { serviceWorker: { controller: { state: 'activated' } } },
    caches,
    crypto: globalThis.crypto,
    Response: globalThis.Response,
    TextEncoder: globalThis.TextEncoder,
    TextDecoder: globalThis.TextDecoder,
    performance: {
      getEntriesByType: () => [
        { name: `${ORIGIN}/js/app.js` },
        { name: `${ORIGIN}/styles.css` },
        { name: 'https://example.com/js/third-party.js' },
      ],
    },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const found = bodies.get(url);
      if (!found) throw new Error(`unexpected fetch: ${url}`);
      fetchConcurrency.active += 1;
      fetchConcurrency.max = Math.max(fetchConcurrency.max, fetchConcurrency.active);
      await Promise.resolve();
      fetchConcurrency.active -= 1;
      return makeResponse(url, found[0], found[1]);
    },
    localStorage: {
      getItem() { storageCalls.push('get'); throw new Error('offline content must not access localStorage'); },
      setItem() { storageCalls.push('set'); throw new Error('offline content must not write localStorage'); },
    },
    calls,
    bodies,
    storageCalls,
    fetchConcurrency,
  };
  return { scope, caches, calls, storageCalls, fetchConcurrency };
}

function controller(world) {
  return createOfflineContent({ scope: world.scope, caches: world.caches });
}

test('preparation commits the selected list and actual shell only after verified writes', async () => {
  const world = makeWorld();
  const progress = [];
  const result = await controller(world).prepare(LIST_ID, { onProgress: (step) => progress.push(step) });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.state, 'ready');
  assert.equal(result.manifest.complete, true);
  assert.deepEqual(
    result.manifest.resources.map(({ path }) => path),
    ['/', '/data/catalog.json', '/data/house_of_m.json', '/js/app.js', '/styles.css'],
  );
  assert.ok(world.caches.calls.maxActivePuts <= 4);
  assert.ok(world.fetchConcurrency.max <= 4);
  assert.ok(progress.some((step) => step.phase === 'write' && step.completed === step.total));
  assert.equal(world.calls.some(({ url }) => url.includes('annihil.us')), false);
  assert.equal([...world.caches.stores.keys()].filter((name) => name.startsWith(CONTENT_CACHE_PREFIX)).length, 1);
  assert.deepEqual(world.storageCalls, []);
});

test('a second preparation cannot overlap the active preparation', async () => {
  const world = makeWorld();
  const offline = controller(world);
  let release;
  let started = false;
  const held = new Promise((resolve) => { release = resolve; });
  const fetch = world.scope.fetch;
  world.scope.fetch = async (...args) => {
    if (!started) {
      started = true;
      await held;
    }
    return fetch(...args);
  };
  const first = offline.prepare(LIST_ID);
  const duplicate = await offline.prepare(LIST_ID);

  assert.deepEqual(duplicate, {
    ok: false,
    state: 'preparing',
    error: 'Offline preparation is already running.',
  });
  release();
  assert.equal((await first).state, 'ready');
});

test('an external resource in the observed page graph is neither fetched nor inventoried', async () => {
  const world = makeWorld();
  const result = await controller(world).prepare(LIST_ID);

  assert.equal(result.ok, true, result.error);
  assert.equal(world.calls.some(({ url }) => new URL(url).origin !== ORIGIN), false);
  assert.equal(result.manifest.resources.some(({ path }) => path.includes('annihil')), false);
  const unsupported = makeWorld();
  delete unsupported.scope.navigator.serviceWorker;
  assert.deepEqual(await controller(unsupported).prepare(LIST_ID), {
    ok: false,
    state: 'unsupported',
    error: 'This browser does not support offline app storage.',
  });
  assert.equal(unsupported.calls.length, 0);
  const uncontrolled = makeWorld();
  uncontrolled.scope.navigator.serviceWorker.controller = null;
  assert.equal((await controller(uncontrolled).prepare(LIST_ID)).state, 'unsupported');
  assert.equal(uncontrolled.calls.length, 0);
});

test('a failed cache write keeps the prior completed set and exposes the failure', async () => {
  const world = makeWorld();
  const offline = controller(world);
  const initial = await offline.prepare(LIST_ID);
  assert.equal(initial.ok, true, initial.error);
  const lastGoodCache = initial.cacheName;
  world.scope.bodies.set(`${ORIGIN}/data/house_of_m.json`, [
    JSON.stringify({ ...ORDER, items: [{ issueId: 2095 }] }), 'application/json',
  ]);
  world.caches.failNextPut((name) => name !== lastGoodCache);
  const changed = await offline.prepare(LIST_ID);

  assert.equal(changed.ok, false);
  assert.equal(changed.state, 'failed');
  assert.match(changed.error, /synthetic quota refusal/);
  assert.ok(world.caches.stores.has(lastGoodCache), 'the previous completed cache was removed');
  assert.equal(world.caches.calls.deleted.length, 1);
});

test('a silent cache write is not accepted as completion and its partial generation is removed', async () => {
  const world = makeWorld();
  const offline = controller(world);
  const initial = await offline.prepare(LIST_ID);
  assert.equal(initial.ok, true, initial.error);
  const lastGoodCache = initial.cacheName;
  world.scope.bodies.set(`${ORIGIN}/data/house_of_m.json`, [
    JSON.stringify({ ...ORDER, items: [{ issueId: 2094 }] }), 'application/json',
  ]);
  world.caches.lieOnNextPut((name, url) => name !== lastGoodCache
    && url.endsWith('/data/house_of_m.json'));
  const changed = await offline.prepare(LIST_ID);

  assert.equal(changed.ok, false);
  assert.equal(changed.state, 'failed');
  assert.match(changed.error, /did not match after its offline write/);
  assert.equal(world.caches.stores.size, 1, 'an incomplete generation remained available');
});

test('cancellation and reload readiness preserve the last good set and withdraw it after content changes', async () => {
  const world = makeWorld();
  const offline = controller(world);
  const initial = await offline.prepare(LIST_ID);
  assert.equal(initial.ok, true, initial.error);
  const lastGoodCache = initial.cacheName;
  assert.equal((await controller(world).readiness(LIST_ID)).state, 'ready');

  world.scope.bodies.set(`${ORIGIN}/data/house_of_m.json`, [
    JSON.stringify({ ...ORDER, items: [{ issueId: 2096 }] }), 'application/json',
  ]);
  const abort = new AbortController();
  world.caches.afterNextPut(() => abort.abort());
  const cancelled = await offline.prepare(LIST_ID, { signal: abort.signal });
  assert.equal(cancelled.state, 'cancelled');
  assert.deepEqual([...world.caches.stores.keys()], [lastGoodCache]);

  const stale = await controller(world).readiness(LIST_ID);
  assert.equal(stale.state, 'stale');
  assert.match(stale.reason, /changed/);
  assert.equal(CONTENT_MANIFEST_PATH, '/__mrt_offline_content__/manifest.json');
});
