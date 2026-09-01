import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ttlFor, isExpired, selectEvictions, cacheKey, sizeOf, TTL, DEFAULT_BUDGET_BYTES,
} from '../src/js/lib/cachePolicy.js';
import { READER_PREFIX, readerUrl, detailUrl, launchUrl, isLaunchable } from '../src/js/reader.js';
import {
  digitalIdFromUrl, parseChecklist, readerIssueId,
} from '../src/js/lib/markdown.js';
import { manualDetailUrl, stageChecklistEntry } from '../src/js/views/add.js';
import {
  createEmptyState, addIssuesToList, createList, listItems, markRead,
  pendingIssueIds, synopsisOrder,
} from '../src/js/lib/model.js';

// ------------------------------------------------------------------ cache policy

test('each route gets a TTL appropriate to how often it changes', () => {
  assert.equal(ttlFor('/issues/52447'), TTL.issue);
  assert.equal(ttlFor('issues/52447'), TTL.issue, 'leading slash is optional');
  assert.equal(ttlFor('/series/1234'), TTL.series);
  assert.equal(ttlFor('/search/issues?q=secret+wars'), TTL.search);
  assert.equal(ttlFor('/creators/99'), TTL.creators);
  assert.equal(ttlFor('/health'), TTL.health);
});

test('searches go stale far sooner than issue records', () => {
  assert.ok(TTL.search < TTL.issue);
  assert.ok(TTL.health < TTL.search);
});

test('an unrecognised route still gets a finite default TTL', () => {
  const t = ttlFor('/something/new');
  assert.equal(t, TTL.default);
  assert.ok(Number.isFinite(t) && t > 0);
});

test('a list route is not mistaken for a single-issue route', () => {
  assert.equal(ttlFor('/issues?year=2015'), TTL.default,
    'only /issues/<id> is immutable; a filtered list is not');
});

test('expiry is judged against the stored timestamp', () => {
  const now = 1_000_000;
  assert.equal(isExpired({ storedAt: now - 10, ttl: 100 }, now), false);
  assert.equal(isExpired({ storedAt: now - 200, ttl: 100 }, now), true);
  assert.equal(isExpired({ storedAt: now - 100, ttl: 100 }, now), true, 'exactly at the TTL is stale');
});

test('a malformed entry is treated as expired rather than trusted forever', () => {
  assert.equal(isExpired(null, 1000), true);
  assert.equal(isExpired({}, 1000), true);
  assert.equal(isExpired({ storedAt: 'x', ttl: 100 }, 1000), true);
  assert.equal(isExpired({ storedAt: 0, ttl: NaN }, 1000), true);
});

test('cache keys are scoped by base URL and schema version', () => {
  const base = { baseUrl: 'https://marvel.emreparker.com/v1', schemaVersion: 2, path: '/issues/1' };
  assert.equal(cacheKey(base), cacheKey({ ...base }));
  assert.notEqual(cacheKey(base), cacheKey({ ...base, schemaVersion: 3 }),
    'a new record shape must not read the old cache');
  assert.notEqual(cacheKey(base), cacheKey({ ...base, baseUrl: 'http://localhost:9000/v1' }),
    'switching to a self-hosted mirror must not read the old cache');
  assert.notEqual(cacheKey(base), cacheKey({ ...base, path: '/issues/2' }));
});

test('sizeOf survives values that cannot be serialized', () => {
  assert.ok(sizeOf({ a: 'hello' }) > 0);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(sizeOf(cyclic), 0, 'a cyclic value must not throw during budgeting');
});

test('nothing is evicted while the cache fits its budget', () => {
  const now = 1_000_000;
  const entries = [{ key: 'a', storedAt: now, ttl: 9999, bytes: 100, lastAccess: now }];
  assert.deepEqual(selectEvictions(entries, { budget: 1000, now }), []);
});

test('expired entries are dropped even when the cache is well under budget', () => {
  const now = 1_000_000;
  const entries = [
    { key: 'fresh', storedAt: now, ttl: 9999, bytes: 10, lastAccess: now },
    { key: 'stale', storedAt: now - 9999, ttl: 10, bytes: 10, lastAccess: now },
  ];
  assert.deepEqual(selectEvictions(entries, { budget: 1_000_000, now }), ['stale'],
    'the expired entry goes even though it was just accessed');
});

test('once expired entries are gone, eviction falls back to least-recently-accessed', () => {
  const now = 1_000_000;
  const entries = [
    { key: 'oldest', storedAt: now, ttl: 9999, bytes: 100, lastAccess: now - 300 },
    { key: 'newest', storedAt: now, ttl: 9999, bytes: 100, lastAccess: now - 100 },
    { key: 'middle', storedAt: now, ttl: 9999, bytes: 100, lastAccess: now - 200 },
  ];
  assert.deepEqual(selectEvictions(entries, { budget: 150, now }), ['oldest', 'middle']);
});

test('eviction makes room for the incoming entry, not just the existing ones', () => {
  const now = 1_000_000;
  const entries = [{ key: 'a', storedAt: now, ttl: 9999, bytes: 100, lastAccess: now }];
  assert.deepEqual(selectEvictions(entries, { budget: 150, now, incoming: 0 }), [],
    'fits on its own');
  assert.deepEqual(selectEvictions(entries, { budget: 150, now, incoming: 100 }), ['a'],
    'must free space for what is about to be written');
});

test('an entry with no recorded access time falls back to when it was stored', () => {
  const now = 1_000_000;
  const entries = [
    { key: 'no-access', storedAt: now - 500, ttl: 9999, bytes: 100 },
    { key: 'accessed', storedAt: now - 900, ttl: 9999, bytes: 100, lastAccess: now },
  ];
  assert.deepEqual(selectEvictions(entries, { budget: 150, now }), ['no-access']);
});

test('the default budget is a real cap, not unlimited', () => {
  assert.ok(Number.isFinite(DEFAULT_BUDGET_BYTES) && DEFAULT_BUDGET_BYTES > 0);
});

// ------------------------------------------------------------------ reader links

test('the reader URL is the hash form the live reader actually uses', () => {
  assert.equal(readerUrl(38164), `${READER_PREFIX}38164`);
  assert.equal(readerUrl(38164), 'https://read.marvel.com/#/book/38164');
  assert.equal(readerUrl('38164'), 'https://read.marvel.com/#/book/38164');
});

// Guards the P00 finding: these exact ids were confirmed against a live subscription.
test('the three verified P00 digital ids still map to their reader URLs', () => {
  assert.equal(readerUrl(1067), 'https://read.marvel.com/#/book/1067');
  assert.equal(readerUrl(38164), 'https://read.marvel.com/#/book/38164');
  assert.equal(readerUrl(76967), 'https://read.marvel.com/#/book/76967');
});

test('a missing digitalId yields no reader URL rather than a broken one', () => {
  for (const bad of [null, undefined, 0, -1, 'abc', '', NaN, 1.5]) {
    assert.equal(readerUrl(bad), null, `${String(bad)} must not produce a link`);
  }
});

test('the marvel.com detail page is the fallback when only an issueId is known', () => {
  assert.equal(detailUrl({ issueId: 52447 }), 'https://www.marvel.com/comics/issue/52447/');
  assert.equal(
    detailUrl({ issueId: 52447, url: 'https://www.marvel.com/comics/issue/52447/secret_wars' }),
    'https://www.marvel.com/comics/issue/52447/secret_wars',
  );
});

test('an untrusted url from third-party metadata is not followed', () => {
  assert.equal(
    detailUrl({ issueId: 1, url: 'https://evil.example.com/x' }),
    'https://www.marvel.com/comics/issue/1/',
  );
  assert.equal(
    detailUrl({ issueId: 1, url: 'javascript:alert(1)' }),
    'https://www.marvel.com/comics/issue/1/',
  );
  assert.equal(
    detailUrl({ issueId: 1, url: 'https://marvel.com.evil.example/x' }),
    'https://www.marvel.com/comics/issue/1/',
    'a lookalike host must not pass',
  );
});

test('with neither a safe url nor an issueId there is no detail link', () => {
  assert.equal(detailUrl({}), null);
  assert.equal(detailUrl(null), null);
});

// The launch page does the digitalId lookup itself, so the app never has to retain a
// window handle across an await, because testing on 2026-08-03 showed handles are unreliable.
test('launchUrl stays same-origin and passes only the reference ids', () => {
  const u = new URL(launchUrl({ issueId: 52447, digitalId: 38164, title: 'Secret Wars #1' }, 'http://127.0.0.1:8787'));
  assert.equal(u.origin, 'http://127.0.0.1:8787');
  assert.equal(u.pathname, '/open.html');
  assert.equal(u.searchParams.get('d'), '38164');
  assert.equal(u.searchParams.get('i'), '52447');
  assert.equal(u.searchParams.get('t'), 'Secret Wars #1');
});

test('launchUrl omits an unknown digitalId so the page knows to resolve it', () => {
  const u = new URL(launchUrl({ issueId: 52447, digitalId: null }, 'http://127.0.0.1:8787'));
  assert.equal(u.searchParams.get('d'), null);
  assert.equal(u.searchParams.get('i'), '52447');
});

test('a hostile title cannot escape the query string', () => {
  const u = new URL(launchUrl({ issueId: 1, title: '"><script>alert(1)</script>' }, 'http://127.0.0.1:8787'));
  assert.equal(u.origin, 'http://127.0.0.1:8787');
  assert.equal(u.pathname, '/open.html');
  assert.equal(u.searchParams.get('t'), '"><script>alert(1)</script>',
    'it survives as data, having been percent-encoded in the raw URL');
  assert.doesNotMatch(u.search, /<script>/, 'and is not literal in the emitted URL');
});

test('an absurdly long title is truncated rather than blowing up the URL', () => {
  const u = new URL(launchUrl({ issueId: 1, title: 'x'.repeat(5000) }, 'http://127.0.0.1:8787'));
  assert.equal(u.searchParams.get('t').length, 120);
});

test('a non-numeric issueId is not passed through to the launcher', () => {
  const u = new URL(launchUrl({ issueId: '../../etc/passwd', digitalId: 5 }, 'http://127.0.0.1:8787'));
  assert.equal(u.searchParams.get('i'), null);
  assert.equal(u.searchParams.get('d'), '5');
});

test('an issue with neither id is not launchable', () => {
  assert.equal(isLaunchable({}), false);
  assert.equal(isLaunchable(null), false);
  assert.equal(isLaunchable({ issueId: 0 }), false);
  assert.equal(isLaunchable({ issueId: 1 }), true);
  assert.equal(isLaunchable({ digitalId: 1 }), true);
});

// The whole point of reading the book id off the reader's address. An issue newer than the
// metadata snapshot has no record upstream, so the synthetic id is all the app would otherwise
// hold, and a synthetic id resolves to nothing. This walks the same three steps the hand-entry
// form walks, because each one alone can silently drop the field.
test('a hand-added issue keeps its pasted book id and launches at the reader', () => {
  const digitalId = digitalIdFromUrl('https://read.marvel.com/#/book/129648');
  assert.equal(digitalId, 129648);

  const issueId = -1755000000000;
  let state = createList(createEmptyState(), { name: 'My reading order' });
  const listId = state.listOrder[state.listOrder.length - 1];
  state = addIssuesToList(state, listId, [{
    issueId,
    title: 'All-New Spider-Gwen: The Ghost-Spider (2026) #9',
    url: manualDetailUrl('https://read.marvel.com/#/book/129648', digitalId),
    digitalId,
    source: 'manual',
    hydrated: true,
  }], {}).state;

  const stored = state.issues[issueId];
  assert.equal(stored.digitalId, 129648, 'storage must not drop the one field that makes Read work');
  assert.equal(isLaunchable(stored), true, 'a negative id alone is not launchable, so this proves the book id carried');
  // Read reaches the reader, and Info offers nothing rather than offering the same place again
  // under a name that says marvel.com. Keeping the pasted address as the detail url is what makes
  // that happen, so the rule is exercised here rather than assumed.
  assert.equal(detailUrl(stored), null, 'a reader address must not be dressed up as a detail page');
  assert.equal(
    detailUrl({ issueId, url: 'https://read.marvel.com/#/book/129648' }),
    'https://read.marvel.com/#/book/129648',
    'and this is why: the detail check accepts a reader address, so the form must not store one',
  );

  const u = new URL(launchUrl(stored, 'http://127.0.0.1:8787'));
  assert.equal(u.searchParams.get('d'), '129648');
  assert.equal(u.searchParams.get('i'), null, 'a synthetic id must not be sent to a lookup that cannot resolve it');
  assert.equal(readerUrl(stored.digitalId), 'https://read.marvel.com/#/book/129648');
});

test('a reader checklist entry keeps its reserved identity and enters no provider queue', () => {
  const parsed = parseChecklist([
    '## Ghost-Spider',
    '- [x] [All-New Spider-Gwen: The Ghost-Spider (2026) #9](https://read.marvel.com/#/book/129648/page/4)',
  ].join('\n'));
  const entry = parsed.entries[0];
  const staged = stageChecklistEntry(entry);

  assert.deepEqual(staged, {
    issueId: readerIssueId(129648),
    title: 'All-New Spider-Gwen: The Ghost-Spider (2026) #9',
    url: null,
    digitalId: 129648,
    source: 'manual',
    hydrated: true,
    collectedIn: 'Ghost-Spider',
  });

  let state = createList(createEmptyState(), { name: 'Future issues' });
  const listId = state.listOrder[0];
  const first = addIssuesToList(state, listId, [staged, staged], {});
  assert.deepEqual({ added: first.added, skipped: first.skipped }, { added: 1, skipped: 1 });
  state = entry.read ? markRead(first.state, entry.issueId, true, 1234) : first.state;
  const repeated = addIssuesToList(state, listId, [staged], {});
  assert.deepEqual({ added: repeated.added, skipped: repeated.skipped }, { added: 0, skipped: 1 });

  const stored = listItems(repeated.state, listId)[0];
  assert.equal(stored.read, true);
  assert.equal(stored.collectedIn, 'Ghost-Spider');
  assert.equal(stored.url, null);
  assert.equal(detailUrl(stored), null);
  assert.deepEqual(pendingIssueIds(repeated.state), []);
  assert.deepEqual(synopsisOrder(repeated.state, listId, () => true), []);

  const launch = new URL(launchUrl(stored, 'http://127.0.0.1:8787'));
  assert.equal(launch.searchParams.get('d'), '129648');
  assert.equal(launch.searchParams.get('i'), null);
});

test('digital id presence alone does not classify a provider issue as reader-only', () => {
  assert.deepEqual(stageChecklistEntry({
    issueId: 52447,
    digitalId: 38164,
    title: 'Secret Wars (2015) #1',
    url: 'https://www.marvel.com/comics/issue/52447/secret_wars',
    section: null,
  }), {
    issueId: 52447,
    title: 'Secret Wars (2015) #1',
    url: 'https://www.marvel.com/comics/issue/52447/secret_wars',
    digitalId: 38164,
    source: 'import',
    hydrated: false,
    collectedIn: null,
  });
});
