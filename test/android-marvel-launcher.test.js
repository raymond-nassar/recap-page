import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { createAndroidReader, digitalReference } from '../packaging/android/web/reader.js';
import { launchDestination, MARVEL_COMICS_URL } from '../src/js/lib/readerDestination.js';
import { appLaunchUrl } from '../src/js/lib/marvelComicsAppUrl.js';

const comicsCaption = 'Find this comic on the Marvel Comics website. This is not a single-comic link. Reading progress has not changed.';
// #1601: nothing on Android may reach Marvel Unlimited, its book links or the comic detail pages.
const retired = /read\.marvel\.com|marvel\.com\/comics\/issue|marvelcomicsapp\.com\/mu\/|^marvelunlimited:/;

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

// The launcher no longer takes a fetch or a metadata address, so the global fetch and the host's
// timers are the only ways a lookup could still happen. Both are recorded rather than trusted.
function fixture(search = '?d=38811&i=52986', appUrlFor = undefined) {
  const timers = [];
  const host = events({
    setTimeout(...args) { timers.push(args); return 0; },
    clearTimeout() {},
  });
  const elements = Object.fromEntries(['heading', 'status', 'fallback']
    .map((name) => [name, events({ textContent: '', hidden: false, href: '' })]));
  const navigations = [];
  const requests = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = (...args) => { requests.push(args); return Promise.reject(new Error('no lookup')); };
  let launch;
  try {
    launch = createAndroidReader({
      host, elements, destination: launchDestination(new URLSearchParams(search)), comicsUrl: MARVEL_COMICS_URL,
      location: { search, assign: (url) => navigations.push(url) },
      ...(appUrlFor ? { appUrlFor } : {}),
    });
  } finally {
    globalThis.fetch = realFetch;
  }
  const start = async () => {
    globalThis.fetch = (...args) => { requests.push(args); return Promise.reject(new Error('no lookup')); };
    try { await launch.start(); } finally { globalThis.fetch = realFetch; }
  };
  return { launch: { start }, host, elements, navigations, requests, timers };
}

test('Android accepts only canonical positive references and never dispatches invalid ones', async () => {
  for (const value of ['38811', 38811, '999999999999']) assert.equal(digitalReference(value), String(value));
  for (const value of [null, '', 0, -1, '01', ' 38811', '38811 ', '1e3', '12/3', '38811&other=1', '1000000000000', {}, []]) {
    assert.equal(digitalReference(value), null);
    const f = fixture(`?d=${encodeURIComponent(String(value))}`);
    await f.launch.start();
    assert.deepEqual(f.navigations, []);
    assert.equal(f.requests.length, 0);
    assert.match(f.elements.status.textContent, /valid issue reference/);
  }
});

test('Android opens the Marvel Comics website for book and issue references with no date cutoff and no Marvel Unlimited branch', async () => {
  assert.equal(launchDestination(new URLSearchParams('r=unlimited')), 'comics');
  assert.equal(launchDestination(new URLSearchParams('')), 'comics');
  for (const destination of ['unlimited', undefined]) {
    assert.throws(() => createAndroidReader({
      host: events(), elements: { heading: events(), status: events(), fallback: events() },
      location: { search: '' }, destination, comicsUrl: MARVEL_COMICS_URL,
    }), /approved reader destination/);
  }
  // An old bookmark that still asks for Marvel Unlimited, or carries only a book or issue number,
  // opens the website: the mode is no longer honoured, and malformed modes change nothing.
  for (const search of ['?d=38811', '?i=52986', '?d=38811&i=52986', '?d=38811&r=unlimited', '?r=unlimited',
    '?r=comics', '?d=38811&r=unknown', '?d=38811&r=unlimited&r=comics']) {
    const f = fixture(search);
    assert.equal(f.elements.fallback.href, MARVEL_COMICS_URL, search);
    await f.launch.start();
    assert.deepEqual(f.navigations, [MARVEL_COMICS_URL], search);
    assert.equal(f.elements.heading.textContent, 'Opening Marvel Comics website');
    assert.equal(f.elements.status.textContent, comicsCaption);
    assert.doesNotMatch(f.elements.status.textContent, /December|Unlimited/);
    assert.equal(f.requests.length, 0, search);
    assert.equal(f.timers.length, 0, search);
  }
});

test('Android makes no metadata request and sets no lookup timer for an issue without a book reference', async () => {
  // Formerly the metadata lookup, its anonymous request options, its failure messages and its
  // eight-second budget. Every one of those paths is gone, so an issue-only link goes straight to
  // the website and a stored metadata address is never consulted.
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => assert.fail('Android Read reads no settings') };
  try {
    for (const search of ['?i=52986', '?i=52986&t=Hulk']) {
      const f = fixture(search);
      await f.launch.start();
      assert.equal(f.requests.length, 0);
      assert.equal(f.timers.length, 0);
      assert.deepEqual(f.navigations, [MARVEL_COMICS_URL]);
      assert.equal(f.elements.fallback.href, MARVEL_COMICS_URL);
      assert.doesNotMatch(f.elements.status.textContent, /look up|lookup|timed out|metadata/i);
    }
  } finally {
    if (saved === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = saved;
  }
});

test('Android known-ID launch opens the website, not the browser reader, without Bifrost or app dispatch', async () => {
  const publicDrn = '03baf094-d1bf-4eb6-8533-0840ebc0d0b9';
  const f = fixture(`?d=38811&i=52986&t=%3Cimg%3E&drn=${publicDrn}`);
  assert.equal(f.elements.fallback.href, MARVEL_COMICS_URL);
  assert.equal(f.elements.heading.textContent, 'Opening <img>', 'the title is text, never markup');
  await f.launch.start();
  assert.deepEqual(f.navigations, [MARVEL_COMICS_URL]);
  assert.equal(f.navigations.some((url) => retired.test(url) || url.includes('bifrost')), false);
  assert.equal(f.requests.length, 0);
  f.host.emit('recap:reader-result', false);
  assert.match(f.elements.status.textContent, /browser was not opened/);
  f.elements.fallback.emit('click');
  f.host.emit('recap:reader-result', true);
  assert.match(f.elements.status.textContent, /progress has not changed/);
  assert.equal(f.requests.length, 0);
});

test('Android ignores issue-page parameters, valid or forged, and opens the website instead', async () => {
  // Formerly a known-refused page opened its exact slug and other page shapes fell back to a
  // lookup. No marvel.com issue page is a Read destination any more, whatever the query claims.
  const page = 'https://www.marvel.com/comics/issue/129224/ultimate_endgame_2025_1';
  for (const search of [
    `?i=129224&u=${encodeURIComponent(page)}&p=1`,
    `?d=38811&i=129224&u=${encodeURIComponent(page)}&p=1`,
    `?i=129225&u=${encodeURIComponent(page)}&p=1`,
    `?i=129224&u=${encodeURIComponent('https://evil.example/comics/issue/129224/x')}&p=1`,
    `?i=129224&u=${encodeURIComponent(page)}&u=${encodeURIComponent(page)}&p=1`,
    `?i=129224&u=${encodeURIComponent(page)}&p=0`,
    `?i=129224&u=${encodeURIComponent(page)}`,
  ]) {
    const f = fixture(search);
    assert.equal(f.elements.fallback.href, MARVEL_COMICS_URL, search);
    await f.launch.start();
    assert.deepEqual(f.navigations, [MARVEL_COMICS_URL], search);
    assert.equal(f.requests.length, 0, search);
  }
});

test('Android invalid references remain on an informative fallback to the website', async () => {
  for (const search of ['?d=0&i=-1&url=https://evil.example', '?u=https%3A%2F%2Fwww.marvel.com%2Fcomics%2Fissue%2F1%2Fx', '']) {
    const f = fixture(search);
    await f.launch.start();
    assert.equal(f.elements.heading.textContent, 'Nothing to open');
    assert.match(f.elements.status.textContent, /valid issue reference/);
    assert.equal(f.requests.length, 0);
    assert.deepEqual(f.navigations, []);
    assert.equal(f.elements.fallback.href, MARVEL_COMICS_URL);
  }
});

test('Android browser choice and teardown before start suppress the handoff', async () => {
  for (const action of ['browser', 'pagehide']) {
    for (const search of ['?i=52986', '?a=4879']) {
      const f = fixture(search, appLaunchUrl);
      if (action === 'browser') f.elements.fallback.emit('click');
      else f.host.emit('pagehide');
      await f.launch.start();
      assert.deepEqual(f.navigations, [], `${action} ${search}`);
      assert.equal(f.requests.length, 0);
    }
  }
});

test('950 Android opens a Marvel Comics app link without a lookup, whatever else the link carries', async () => {
  const appLink = 'https://www.marvelcomicsapp.com/viewer/4879';
  for (const search of ['?a=4879&i=52986', '?a=4879&d=38811&i=52986', '?a=4879&r=unlimited', '?a=4879&r=comics']) {
    const f = fixture(search, appLaunchUrl);
    assert.equal(f.elements.fallback.href, appLink);
    await f.launch.start();
    assert.deepEqual(f.navigations, [appLink]);
    assert.equal(f.elements.status.textContent, 'Taking you to this comic in the Marvel Comics app.');
    assert.equal(f.requests.length, 0);
  }
  for (const search of ['?a=0&d=38811', '?a=4879&a=5&d=38811', '?a=https%3A%2F%2Fevil.example&d=38811']) {
    const f = fixture(search, appLaunchUrl);
    await f.launch.start();
    assert.deepEqual(f.navigations, [MARVEL_COMICS_URL], search);
  }
  // #1601: a viewer number alone opens, since a viewer-only comic has nothing else to send.
  const bare = fixture('?a=4879', appLaunchUrl);
  await bare.launch.start();
  assert.deepEqual(bare.navigations, [appLink]);
  const unwired = fixture('?a=4879&d=38811');
  await unwired.launch.start();
  assert.deepEqual(unwired.navigations, [MARVEL_COMICS_URL]);
});

test('950 the Android launch page note names the app link and the browser, with no cutoff or lookup', () => {
  const source = readFileSync(new URL('../packaging/android/web/launcher.js', import.meta.url), 'utf8');
  assert.ok(source.includes("'Comic links can open in the Marvel Comics app or your browser. Find on Marvel Comics opens the website.'"));
  assert.doesNotMatch(source, /Bifrost|metadata|December|Marvel Unlimited|look up|issuePageUrl|apiBase/);
});

test('950 Android retired Marvel Unlimited app addresses now open the website, while a viewer still wins', async () => {
  for (const query of ['m=10441&i=10441', 'm=10441&i=10441&d=38811', 'm=10442&i=10441', 'm=10441&m=10441&i=10441']) {
    const f = fixture(`?${query}`, appLaunchUrl);
    assert.equal(f.elements.fallback.href, MARVEL_COMICS_URL, query);
    await f.launch.start();
    assert.deepEqual(f.navigations, [MARVEL_COMICS_URL], query);
    assert.equal(f.navigations.some((url) => retired.test(url)), false);
    assert.equal(f.requests.length, 0);
  }
  const both = fixture('?a=4879&m=10441&i=10441', appLaunchUrl);
  await both.launch.start();
  assert.deepEqual(both.navigations, ['https://www.marvelcomicsapp.com/viewer/4879']);
});
