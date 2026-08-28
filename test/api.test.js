// The series and creator search path in MarvelApi: loading a vendored index, sharing that load,
// and what happens when it fails. The ranking itself lives in lib/nameIndex.js and is tested in
// nameIndex.test.js; this file is about the loading contract around it, and about the base URL
// contract the constructor enforces before any of it can run.

import test from 'node:test';
import assert from 'node:assert/strict';
import { MarvelApi } from '../src/js/api.js';
import { cacheKey } from '../src/js/lib/cachePolicy.js';

const INDEX = {
  kind: 'series',
  generatedAt: '2026-08-05T06:14:00.000Z',
  total: 3,
  items: [[1, 'Civil War (2006 - 2007)', 7], [2, 'Civil War: Front Line (2006)', 11], [3, 'Marvel (2020)', 6]],
};

// Counts calls so the memoisation and the eviction-on-failure can both be observed.
function stubLoader(impl) {
  const loader = async (kind) => {
    loader.calls.push(kind);
    return impl(kind, loader.calls.length);
  };
  loader.calls = [];
  return loader;
}

const names = (result) => result.items.map((i) => i.name);

function pagedApi(responses) {
  const api = new MarvelApi();
  api.pageCalls = [];
  api.get = async (path, { signal } = {}) => {
    api.pageCalls.push({ path, signal });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next;
  };
  return api;
}

const rawIssue = (id) => ({
  id,
  title: `Issue ${id}`,
  issueNumber: String(id),
  seriesId: 10,
  seriesName: 'Paged',
});

test('a series search reads the vendored index rather than the API', async () => {
  const loadIndex = stubLoader(() => INDEX);
  const api = new MarvelApi({ loadIndex });

  const result = await api.searchSeries('civil war');
  assert.deepEqual(names(result), ['Civil War (2006 - 2007)', 'Civil War: Front Line (2006)']);
  assert.deepEqual(loadIndex.calls, ['series']);
  // The view needs these to say how much was left out and how old the snapshot is.
  assert.equal(result.matched, 2);
  assert.equal(result.total, 3);
  assert.equal(result.generatedAt, INDEX.generatedAt);
});

test('series and creators load separately, and each index loads only once', async () => {
  const loadIndex = stubLoader(() => INDEX);
  const api = new MarvelApi({ loadIndex });

  await api.searchSeries('civil war');
  await api.searchSeries('marvel');
  await api.searchCreators('civil war');
  assert.deepEqual(loadIndex.calls, ['series', 'creators']);
});

// Opening the card starts the download and the reader types while it is in flight, so the two
// can easily overlap. One file, one request.
test('searches started before the index arrives share the one load', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const loadIndex = stubLoader(async () => { await gate; return INDEX; });
  const api = new MarvelApi({ loadIndex });

  const both = Promise.all([api.searchSeries('civil war'), api.searchSeries('marvel')]);
  release();
  const [civil, marvel] = await both;

  assert.deepEqual(loadIndex.calls, ['series']);
  assert.equal(names(civil)[0], 'Civil War (2006 - 2007)');
  assert.equal(names(marvel)[0], 'Marvel (2020)');
});

// The whole point of the change. Answering a query with everything is the bug being replaced,
// so an index that will not load has to be an error and never a silent unfiltered list.
test('an index that will not load is an error, not an unfiltered list', async () => {
  const api = new MarvelApi({ loadIndex: stubLoader(() => { throw new Error('offline'); }) });
  await assert.rejects(() => api.searchSeries('civil war'), /offline/);
});

// The failure message tells the reader to search again, so searching again has to actually
// retry rather than replay the original error for the rest of the session.
test('a failed load is retried by searching again, as the message promises', async () => {
  const loadIndex = stubLoader((kind, call) => {
    if (call === 1) throw new Error('offline');
    return INDEX;
  });
  const api = new MarvelApi({ loadIndex });

  await assert.rejects(() => api.searchSeries('civil war'), /offline/);
  const second = await api.searchSeries('civil war');

  assert.equal(names(second)[0], 'Civil War (2006 - 2007)');
  assert.deepEqual(loadIndex.calls, ['series', 'series']);
});

// Warming is only a head start taken when the card opens. A reader who never searches must
// never see an error from it, and it must not poison the index for a later real search.
test('warming swallows its own failure and does not block a later search', async () => {
  const loadIndex = stubLoader((kind, call) => {
    if (call === 1) throw new Error('offline');
    return INDEX;
  });
  const api = new MarvelApi({ loadIndex });

  assert.equal(await api.warmNameIndex('series'), null);
  assert.equal(names(await api.searchSeries('civil war'))[0], 'Civil War (2006 - 2007)');
});

test('a warmed index is reused rather than fetched again by the search', async () => {
  const loadIndex = stubLoader(() => INDEX);
  const api = new MarvelApi({ loadIndex });

  await api.warmNameIndex('series');
  await api.searchSeries('civil war');
  assert.deepEqual(loadIndex.calls, ['series']);
});

test('series pagination delivers each normalized page and preserves the complete result', async () => {
  const api = pagedApi([
    { items: [rawIssue(3), rawIssue(2)], total: 3, has_next: true },
    { items: [rawIssue(1)], total: 3, has_next: false },
  ]);
  const pages = [];

  const issues = await api.seriesIssues(10, {
    onPage: (items, progress) => pages.push({ ids: items.map((item) => item.issueId), progress }),
  });

  assert.deepEqual(pages, [
    { ids: [3, 2], progress: { loaded: 2, total: 3 } },
    { ids: [1], progress: { loaded: 3, total: 3 } },
  ]);
  assert.deepEqual(issues.map((item) => item.issueId), [3, 2, 1]);
  assert.equal(issues[0].seriesName, 'Paged');
});

test('creator pagination awaits page delivery before requesting the next page', async () => {
  const api = pagedApi([
    { items: [rawIssue(2)], total: 2, has_next: true },
    { items: [rawIssue(1)], total: 2, has_next: false },
  ]);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const pages = [];

  const loading = api.creatorIssues(7, {
    onPage: async (items) => {
      pages.push(items.map((item) => item.issueId));
      if (pages.length === 1) await gate;
    },
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(api.pageCalls.length, 1, 'the second request started before the first page was handled');
  release();
  const issues = await loading;
  assert.deepEqual(pages, [[2], [1]]);
  assert.deepEqual(issues.map((item) => item.issueId), [2, 1]);
});

test('aborting after a delivered page prevents every later page callback', async () => {
  const api = pagedApi([
    { items: [rawIssue(2)], total: 2, has_next: true },
    { items: [rawIssue(1)], total: 2, has_next: false },
  ]);
  const controller = new AbortController();
  const pages = [];

  await assert.rejects(
    () => api.seriesIssues(10, {
      signal: controller.signal,
      onPage: (items) => {
        pages.push(items.map((item) => item.issueId));
        controller.abort();
      },
    }),
    { name: 'AbortError' },
  );

  assert.deepEqual(pages, [[2]]);
  assert.equal(api.pageCalls.length, 1, 'a later page was requested after abort');
});

// The kind-to-file map in the real loader is the gate, so this exercises the shipped default
// rather than a stub. It rejects before reaching the network, which is why there is no fetch
// here to intercept.
test('an unknown index name is refused by the real loader before any request', async () => {
  const api = new MarvelApi();
  await assert.rejects(() => api.searchNameIndex('publishers', 'marvel'), /Unknown search index "publishers"/);
});

// Which base URLs are usable is decided by lib/apiBase.js and enforced here, in the client that
// does the fetching, rather than only at the settings form. The form is one of three ways a base
// reaches this constructor; the other two read stored values that no current code has checked.
// api-base.test.js covers the rule itself, so these cover only that the client applies it.
test('a base URL the rule refuses cannot be used to build a client at all', () => {
  const refused = [
    'http://evil.example.com',
    'http://localhost.evil.example.com',
    'ftp://localhost',
    'javascript:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'marvel.emreparker.com/v1',
    '/v1',
    '',
    '   ',
    null,
  ];
  assert.equal(refused.length, 10);
  for (const bad of refused) {
    assert.throws(
      () => new MarvelApi({ baseUrl: bad }),
      TypeError,
      `expected ${JSON.stringify(bad)} to be refused by the constructor`,
    );
  }
});

// The rule deliberately allows any https origin and plain http to loopback, so that a reader
// running their own mirror is not locked out. Refusing one of these would be the same defect in
// the other direction.
test('an https origin and a loopback mirror are both still accepted', () => {
  const accepted = ['https://marvel.emreparker.com/v1', 'https://mirror.example/v1', 'http://127.0.0.1:8787/v1', 'http://localhost:8787'];
  assert.equal(accepted.length, 4);
  for (const good of accepted) {
    assert.equal(new MarvelApi({ baseUrl: good }).baseUrl, good);
  }
});

test('a trailing slash is stripped before the base URL is checked and before it is used', () => {
  assert.equal(new MarvelApi({ baseUrl: 'https://mirror.example/v1//' }).baseUrl, 'https://mirror.example/v1');
});

// Switching mirrors must not serve entries fetched from the previous one. cache-reader.test.js
// covers the key function; this covers the wiring, since the constructor is what hands its own
// normalised base to the cache it builds when none is supplied.
test('the cache the client builds for itself is scoped by that base URL', () => {
  const one = new MarvelApi({ baseUrl: 'https://one.example/v1' });
  const two = new MarvelApi({ baseUrl: 'https://two.example/v1' });

  assert.equal(one.cache.key('/issues/1'), cacheKey({ baseUrl: 'https://one.example/v1', schemaVersion: 2, path: '/issues/1' }));
  assert.notEqual(one.cache.key('/issues/1'), two.cache.key('/issues/1'));
  assert.equal(new MarvelApi({ baseUrl: 'https://one.example/v1/' }).cache.key('/issues/1'), one.cache.key('/issues/1'));
});
