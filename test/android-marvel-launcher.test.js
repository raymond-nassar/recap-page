import test from 'node:test';
import assert from 'node:assert/strict';
import { createAndroidReader, digitalReference } from '../packaging/android/web/reader.js';
import { issuePageUrl } from '../src/js/lib/issuePageUrl.js';
import { launchDestination, MARVEL_COMICS_URL } from '../src/js/lib/readerDestination.js';

const response = (body, ok = true) => ({ ok, json: async () => body });
const before = new Date(2026, 11, 6, 23, 59, 59, 999);
const after = new Date(2026, 11, 7);
const exactReader = 'https://read.marvel.com/#/book/38811';

function events(properties = {}) {
  const listeners = new Map();
  return {
    ...properties,
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(handler);
    },
    emit(name, detail) {
      for (const listener of listeners.get(name) || []) listener({ detail });
    },
  };
}

function fixture(search = '?d=38811&i=52986', fetchImpl = async () => response({ digitalId: 38811 }),
  readApiBase = () => 'https://metadata.example/v1', now = before) {
  const timers = new Map();
  const host = events({
    setTimeout(handler, milliseconds) {
      const id = Symbol();
      timers.set(id, { handler, milliseconds });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  const elements = Object.fromEntries(['heading', 'status', 'fallback']
    .map((name) => [name, events({ textContent: '', hidden: false, href: '' })]));
  const navigations = [];
  const requests = [];
  const launch = createAndroidReader({
    host, elements, readApiBase, validateIssuePageUrl: issuePageUrl,
    destination: launchDestination(new URLSearchParams(search), now), comicsUrl: MARVEL_COMICS_URL,
    location: { search, assign: (url) => navigations.push(url) },
    fetchImpl: (...args) => { requests.push(args); return fetchImpl(...args); },
  });
  return { launch, host, elements, navigations, requests, timers };
}

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('Android accepts only canonical positive references and never dispatches invalid ones', async () => {
  for (const value of ['38811', 38811, '999999999999']) assert.equal(digitalReference(value), String(value));
  for (const value of [null, '', 0, -1, '01', ' 38811', '38811 ', '1e3', '12/3', '38811&other=1', '1000000000000', {}, []]) {
    assert.equal(digitalReference(value), null);
    for (const now of [before, after]) {
      const f = fixture(`?d=${encodeURIComponent(String(value))}`, () => assert.fail('Invalid reference cannot fetch'), undefined, now);
      await f.launch.start();
      assert.deepEqual(f.navigations, []);
      assert.match(f.elements.status.textContent, /valid issue reference/);
    }
  }
});

test('Android uses the shared device-local cutoff for both known and unknown reader references', async () => {
  for (const search of ['?d=38811', '?i=52986']) {
    for (const now of [before, after]) {
      const f = fixture(search, undefined, undefined, now);
      await f.launch.start();
      assert.deepEqual(f.navigations, [now === before ? exactReader : MARVEL_COMICS_URL]);
      assert.equal(f.requests.length, now === before && search.includes('i=') ? 1 : 0);
      assert.match(f.elements.status.textContent, now === before
        ? /Reading ends December 7, 2026/ : /not a single-comic link/);
      assert.equal(f.requests.some(([url]) => url.includes('bifrost')), false);
      assert.equal(f.navigations.some((url) => url.startsWith('marvelunlimited:')), false);
    }
  }
  const snapshot = fixture('?d=38811&r=unlimited', undefined, undefined, after);
  await snapshot.launch.start();
  assert.deepEqual(snapshot.navigations, [exactReader], 'a gesture-selected branch survives launcher initialization across midnight');
  for (const suffix of ['&r=unknown', '&r=unlimited&r=comics']) {
    const f = fixture(`?d=38811${suffix}`, undefined, undefined, after);
    await f.launch.start();
    assert.deepEqual(f.navigations, [MARVEL_COMICS_URL], 'malformed modes default to local time');
  }
});

test('Android metadata HTTP, transport and JSON failures remain explicit with a browser fallback', async () => {
  for (const fetchImpl of [
    async () => response({}, false),
    async () => { throw new Error('offline'); },
    async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } }),
  ]) {
    const f = fixture('?i=52986', fetchImpl);
    await f.launch.start();
    assert.deepEqual(f.navigations, []);
    assert.match(f.elements.status.textContent, /Could not look up/);
    assert.equal(f.elements.fallback.href, 'https://www.marvel.com/comics/issue/52986/');
    assert.equal(f.timers.size, 0);
  }
});

test('Android known-ID launch opens the exact browser reader without Bifrost or app dispatch', async () => {
  const publicDrn = '03baf094-d1bf-4eb6-8533-0840ebc0d0b9';
  const f = fixture(`?d=38811&i=52986&t=%3Cimg%3E&drn=${publicDrn}`, () => assert.fail('Known ID cannot fetch'),
    () => assert.fail('Known ID needs no settings lookup'));
  assert.equal(f.elements.fallback.href, exactReader);
  assert.match(f.elements.heading.textContent, /<img>/);
  await f.launch.start();
  assert.deepEqual(f.navigations, [exactReader]);
  assert.equal(f.requests.length, 0);
  f.host.emit('recap:reader-result', false);
  assert.match(f.elements.status.textContent, /browser was not opened/);
  f.elements.fallback.emit('click');
  f.host.emit('recap:reader-result', true);
  assert.match(f.elements.status.textContent, /progress has not changed/);
  assert.equal(f.requests.length, 0);
  assert.equal(f.timers.size, 0);
});

test('Android missing digital ID uses only the configured anonymous metadata service before the cutoff', async () => {
  const f = fixture('?i=52986', async (url, options) => {
    assert.equal(url, 'https://metadata.example/v1/issues/52986');
    assert.deepEqual(Object.keys(options).sort(), ['cache', 'credentials', 'headers', 'redirect', 'referrerPolicy', 'signal']);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.redirect, 'error');
    return response({ digitalId: 38811 });
  });
  await f.launch.start();
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.navigations, [exactReader]);
  assert.equal(f.elements.fallback.href, exactReader);
});

test('Android known-refused issue page keeps its exact slug without metadata lookup', async () => {
  const page = 'https://www.marvel.com/comics/issue/129224/ultimate_endgame_2025_1';
  const search = `?i=129224&u=${encodeURIComponent(page)}&p=1`;
  const f = fixture(search, () => assert.fail('Known-refused page must not fetch'), () => assert.fail('No settings lookup'));
  await f.launch.start();
  assert.deepEqual(f.navigations, [page]);
  assert.equal(f.requests.length, 0);
  assert.equal(f.timers.size, 0);
  assert.match(f.elements.status.textContent, /issue page/);
  const direct = fixture(`?d=38811&${search.slice(1)}`);
  await direct.launch.start();
  assert.deepEqual(direct.navigations, [exactReader]);
});

test('Android rejects forged page parameters and looks up unknown references', async () => {
  const page = 'https://www.marvel.com/comics/issue/129224/ultimate_endgame_2025_1';
  for (const search of [
    `?i=129225&u=${encodeURIComponent(page)}&p=1`,
    `?i=129224&u=${encodeURIComponent('https://evil.example/comics/issue/129224/x')}&p=1`,
    `?i=129224&u=${encodeURIComponent(page)}&u=${encodeURIComponent(page)}&p=1`,
    `?i=129224&u=${encodeURIComponent(page)}&p=0`,
  ]) {
    const f = fixture(search, async () => response({}, false));
    await f.launch.start();
    assert.equal(f.requests.length, 1, search);
    assert.deepEqual(f.navigations, [], search);
    const issueId = new URLSearchParams(search).get('i');
    assert.equal(f.elements.fallback.href, search.includes('p=0') ? page
      : `https://www.marvel.com/comics/issue/${issueId}/`);
  }
});

test('Android valid page without refusal retains its exact browser escape after unresolved lookup', async () => {
  const page = 'https://www.marvel.com/comics/issue/129224/ultimate_endgame_2025_1';
  for (const result of [response({}, false), response({ digitalId: null })]) {
    const f = fixture(`?i=129224&u=${encodeURIComponent(page)}`, async () => result);
    await f.launch.start();
    assert.equal(f.requests.length, 1);
    assert.equal(f.elements.fallback.href, page);
    assert.deepEqual(f.navigations, []);
    assert.equal(f.timers.size, 0);
  }
});

test('Android invalid, unresolved and failed references remain on an informative fallback', async () => {
  for (const entry of [
    { search: '?d=0&i=-1&url=https://evil.example', expected: /valid issue reference/, calls: 0 },
    { search: '?i=52986', api: () => null, expected: /metadata address/, calls: 0 },
    { search: '?i=52986', body: {}, expected: /No digital reader link/, calls: 1 },
    { search: '?i=52986', ok: false, expected: /Could not look up/, calls: 1 },
  ]) {
    const f = fixture(entry.search, async () => response(entry.body, entry.ok ?? true), entry.api);
    await f.launch.start();
    assert.match(f.elements.status.textContent, entry.expected);
    assert.equal(f.requests.length, entry.calls);
    assert.deepEqual(f.navigations, []);
    assert.match(f.elements.fallback.href, /^https:\/\/(?:www\.marvel\.com|marvel\.webtoon\.com)\//);
  }
});

test('Android lookup has one eight-second budget and reports timeout without handoff', async () => {
  const f = fixture('?i=52986', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  const finished = f.launch.start();
  const timer = [...f.timers.values()][0];
  assert.equal(f.timers.size, 1);
  assert.equal(timer.milliseconds, 8000);
  timer.handler();
  await finished;
  assert.match(f.elements.status.textContent, /timed out/);
  assert.deepEqual(f.navigations, []);
  assert.equal(f.timers.size, 0);
});

test('Android browser choice and teardown abort lookup and suppress late metadata dispatch', async () => {
  for (const action of ['browser', 'pagehide']) {
    const late = deferred();
    const f = fixture('?i=52986', () => late.promise);
    const finished = f.launch.start();
    if (action === 'browser') f.elements.fallback.emit('click');
    else f.host.emit('pagehide');
    late.resolve(response({ digitalId: 38811 }));
    await finished;
    assert.equal(f.requests[0][1].signal.aborted, true);
    assert.equal(f.requests.length, 1);
    assert.deepEqual(f.navigations, []);
    assert.equal(f.timers.size, 0);
  }
});
