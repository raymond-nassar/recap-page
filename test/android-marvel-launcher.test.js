import test from 'node:test';
import assert from 'node:assert/strict';
import { createAndroidReader, digitalReference, resolveMarvelIssue } from '../packaging/android/web/reader.js';

const drn = 'drn:src:marvel:unison::prod:03baf094-d1bf-4eb6-8533-0840ebc0d0b9';
const appUrl = `marvelunlimited://issue/${drn}`;
const endpoint = 'https://bifrost.marvel.com/unison/legacy?digitalId=38811';
const payload = (id = drn) => ({ data: { dynamicQueryOrError: { entity: { contents: [{ content: { id } }] } } } });
const response = (body, ok = true) => ({ ok, json: async () => body });

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

function fixture(search = '?d=38811&i=52986', fetchImpl = async () => response(payload()), readApiBase = () => 'https://metadata.example/v1') {
  const timers = new Map();
  const host = events({
    setTimeout(handler, milliseconds) {
      const id = Symbol();
      timers.set(id, { handler, milliseconds });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  });
  const elements = Object.fromEntries(['heading', 'status', 'fallback', 'appLink']
    .map((name) => [name, events({ textContent: '', hidden: false, href: '' })]));
  const navigations = [];
  const requests = [];
  const launch = createAndroidReader({
    host, elements, readApiBase,
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

test('Android app lookup uses only canonical positive digital IDs and an anonymous fixed request', async () => {
  for (const value of ['38811', 38811, '999999999999']) assert.equal(digitalReference(value), String(value));
  for (const value of [null, '', 0, -1, '01', ' 38811', '38811 ', '1e3', '12/3', '38811&other=1', '1000000000000', {}, []]) {
    assert.equal(digitalReference(value), null);
    await assert.rejects(resolveMarvelIssue(value, () => { assert.fail('Invalid IDs cannot fetch'); }), /invalid-reference/);
  }
  const signal = new AbortController().signal;
  const url = await resolveMarvelIssue('38811', async (target, options) => {
    assert.equal(target, endpoint);
    assert.deepEqual(options, {
      headers: { accept: 'application/json' }, cache: 'no-store', credentials: 'omit',
      referrerPolicy: 'no-referrer', redirect: 'error', signal,
    });
    return response(payload());
  }, signal);
  assert.equal(url, appUrl);
});

test('Android app lookup rejects empty, ambiguous, errored and noncanonical DRN payloads', async () => {
  const invalid = [
    null, {}, [], { data: null },
    { data: { dynamicQueryOrError: { entity: { contents: [] } } } },
    { data: { dynamicQueryOrError: { entity: { contents: [payload().data.dynamicQueryOrError.entity.contents[0], {}] } } } },
    { ...payload(), errors: [{ message: 'Partial response' }] },
    { ...payload(), errors: {} },
    { data: { dynamicQueryOrError: { ...payload().data.dynamicQueryOrError, error: { message: 'Failed' } } } },
    ...['', '38811', null, {}, drn.toUpperCase(), `${drn}?x=1`, `${drn}#extra`,
      `${drn}/`, ` ${drn}`, drn.replace('prod', 'stage'), `https://evil.example/${drn}`]
      .map((id) => payload(id)),
  ];
  for (const body of invalid) await assert.rejects(resolveMarvelIssue('38811', async () => response(body)), /no-app-link/);
});

test('Android resolver HTTP and transport failures stay explicit rather than generating a link', async () => {
  await assert.rejects(resolveMarvelIssue('38811', async () => response(payload(), false)), /resolver-unavailable/);
  await assert.rejects(resolveMarvelIssue('38811', async () => { throw new Error('offline'); }), /offline/);
  await assert.rejects(resolveMarvelIssue('38811', async () => ({ ok: true, json: async () => { throw new SyntaxError('invalid JSON'); } })), SyntaxError);
});

test('Android known-ID launch keeps browser escape after native success, failure and retry', async () => {
  const f = fixture('?d=38811&i=52986&t=%3Cimg%3E', undefined, () => assert.fail('Known ID needs no settings lookup'));
  assert.equal(f.elements.fallback.href, 'https://read.marvel.com/#/book/38811');
  assert.match(f.elements.heading.textContent, /<img>/);
  await f.launch.start();
  assert.deepEqual(f.navigations, [appUrl]);
  assert.equal(f.requests.length, 1);
  assert.equal(f.elements.appLink.href, appUrl);
  assert.equal(f.elements.appLink.hidden, false);
  f.host.emit('recap:reader-result', true);
  assert.match(f.elements.status.textContent, /If the comic did not load/);
  assert.match(f.elements.status.textContent, /progress has not changed/);
  f.elements.appLink.emit('click');
  f.host.emit('recap:reader-result', false);
  assert.match(f.elements.status.textContent, /could not be opened/);
  f.elements.fallback.emit('click');
  f.elements.appLink.emit('click');
  f.host.emit('recap:reader-result', true);
  assert.match(f.elements.status.textContent, /was opened/);
  assert.equal(f.requests.length, 1, 'Retrying a validated link does not refetch');
  assert.equal(f.timers.size, 0);
});

test('Android missing digital ID uses the configured metadata service before Bifrost', async () => {
  const f = fixture('?i=52986', async (url, options) => {
    assert.equal(options.credentials, 'omit');
    assert.equal(options.cache, 'no-store');
    return response(url === endpoint ? payload() : { digitalId: 38811 });
  });
  assert.equal(f.elements.fallback.href, 'https://www.marvel.com/comics/issue/52986/');
  await f.launch.start();
  assert.deepEqual(f.requests.map(([url]) => url), ['https://metadata.example/v1/issues/52986', endpoint]);
  assert.equal(f.requests[0][1].signal, f.requests[1][1].signal);
  assert.deepEqual(f.navigations, [appUrl]);
  assert.equal(f.elements.fallback.href, 'https://read.marvel.com/#/book/38811');
});

test('Android invalid, unresolved and failed references remain on an informative fallback', async () => {
  const cases = [
    { search: '?d=0&i=-1&url=https://evil.example', expected: /valid issue reference/, calls: 0 },
    { search: '?i=52986', api: () => null, expected: /metadata address/, calls: 0 },
    { search: '?i=52986', body: {}, expected: /No digital reader link/, calls: 1 },
    { search: '?i=52986', ok: false, expected: /Could not resolve/, calls: 1 },
    { search: '?d=38811', body: { data: { dynamicQueryOrError: { entity: { contents: [] } } } }, expected: /Could not resolve/, calls: 1 },
  ];
  for (const entry of cases) {
    const f = fixture(entry.search, async () => response(entry.body, entry.ok ?? true), entry.api);
    await f.launch.start();
    assert.match(f.elements.status.textContent, entry.expected);
    assert.equal(f.requests.length, entry.calls);
    assert.deepEqual(f.navigations, []);
    assert.equal(f.elements.appLink.hidden, true);
    assert.match(f.elements.fallback.href, /^https:\/\/(?:read|www)\.marvel\.com\//);
  }
});

test('Android lookup has one eight-second budget and reports timeout without a handoff', async () => {
  const f = fixture('?d=38811', (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  }));
  const finished = f.launch.start();
  assert.equal(f.timers.size, 1);
  const timer = [...f.timers.values()][0];
  assert.equal(timer.milliseconds, 8000);
  timer.handler();
  await finished;
  assert.match(f.elements.status.textContent, /timed out/);
  assert.deepEqual(f.navigations, []);
  assert.equal(f.timers.size, 0);
});

test('Android browser choice and teardown suppress late metadata and resolver responses', async () => {
  for (const search of ['?d=38811', '?i=52986']) {
    for (const action of ['browser', 'pagehide']) {
      const late = deferred();
      const f = fixture(search, () => late.promise);
      const finished = f.launch.start();
      if (action === 'browser') f.elements.fallback.emit('click');
      else f.host.emit('pagehide');
      late.resolve(response(search.includes('d=') ? payload() : { digitalId: 38811 }));
      await finished;
      assert.equal(f.requests[0][1].signal.aborted, true);
      assert.equal(f.requests.length, 1);
      assert.deepEqual(f.navigations, [], `${search}: ${action}`);
      assert.equal(f.elements.appLink.hidden, true);
      assert.equal(f.timers.size, 0);
    }
  }
});
