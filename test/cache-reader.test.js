import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ttlFor, isExpired, selectEvictions, cacheKey, sizeOf, TTL, DEFAULT_BUDGET_BYTES,
} from '../src/js/lib/cachePolicy.js';
import { READER_PREFIX, readerUrl, detailUrl, launchUrl, isLaunchable, openIssue } from '../src/js/reader.js';
import {
  digitalIdFromUrl, parseChecklist, readerIssueId, serializeChecklist, serializeReadingOrder,
} from '../src/js/lib/markdown.js';
import { manualDetailUrl, stageChecklistEntry } from '../src/js/views/add.js';
import {
  createEmptyState, addIssuesToList, createList, listItems, markRead,
  pendingIssueIds, synopsisOrder, migrate, exportBackup, validateBackup, upsertIssue,
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

test('Read opens the Marvel Comics website synchronously in a fresh tab for a comic with only a book id, on any date', () => {
  // Formerly split at December 7, 2026 into the Marvel Unlimited reader and the website. #1601
  // removed that cutoff, so a stale or hostile clock argument can no longer choose a destination.
  const priorWindow = globalThis.window;
  const opened = [];
  globalThis.window = { open: (...args) => { opened.push(args); return null; } };
  try {
    for (const now of [new Date(2026, 11, 6, 23, 59, 59, 999), new Date(2026, 11, 7), new Date(2027, 0, 1)]) {
      // 52446 has no Marvel Comics app link.
      const result = openIssue({ issueId: 52446, digitalId: 38164 }, { origin: 'http://example.test', now });
      assert.equal(result.target, 'comics');
      const [url, frame, features] = opened.at(-1);
      assert.equal(new URL(url).searchParams.get('r'), 'comics');
      assert.equal(frame, '_blank');
      assert.equal(features, 'noopener');
      assert.equal(result.ok, true, 'noopener null is not a blocked-popup observation');
    }
    assert.equal(opened.length, 3);
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

test('the launch reads no clock and retains legacy reference bytes in the record without sending them', () => {
  const clock = {
    getFullYear: () => assert.fail('no cutoff is computed'), getMonth: () => assert.fail('no cutoff'),
    getDate: () => assert.fail('no cutoff'), toISOString: () => assert.fail('no cutoff'),
    valueOf: () => assert.fail('No implicit instant comparison'),
  };
  const issue = { issueId: -7, digitalId: 129648 };
  const before = JSON.stringify(issue);
  const url = new URL(launchUrl(issue, 'http://example.test', { now: clock }));
  assert.equal(url.searchParams.get('r'), 'comics');
  assert.equal(url.searchParams.has('d'), false, 'a book id is inert');
  assert.equal(url.searchParams.has('i'), false);
  assert.equal(JSON.stringify(issue), before, 'the saved book id is untouched');
});

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
  for (const bad of [null, undefined, 0, -1, 'abc', '', NaN, 1.5, true, [1], { valueOf: () => 1 },
    '1e3', ' 1', '1 ', '01', '0', 1000000000000]) {
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

const findOnlyRow = { issueId: 56003, title: 'Find-only fixture #1', findOnly: true, url: null, source: 'curated' };

test('a Find-only provider row keeps its key and checkmark without gaining a guessed URL', () => {
  const legacy = { issueId: 52447, title: 'Existing fixture #1', url: null };
  let state = createList(createEmptyState(), { name: 'Disposable guide' });
  const listId = state.active;
  state = addIssuesToList(state, listId, [findOnlyRow, legacy]).state;
  state = markRead(state, findOnlyRow.issueId);
  for (const saved of [state, migrate(JSON.parse(JSON.stringify(state))), validateBackup(exportBackup(state)).state]) {
    const items = listItems(saved, listId);
    const [row, ordinary] = items;
    assert.equal(row.issueId, 56003);
    assert.equal(row.findOnly, true);
    assert.equal(row.url, null);
    assert.equal(row.read, true);
    assert.equal(detailUrl(row), null);
    assert.equal(isLaunchable(row), true);
    const { searchParams } = new URL(launchUrl(row, 'http://127.0.0.1:8787'));
    assert.deepEqual([...searchParams], [['r', 'comics'], ['t', row.title]]);
    assert.equal(detailUrl(ordinary), 'https://www.marvel.com/comics/issue/52447/');

    const source = { name: 'Disposable guide', items };
    assert.match(serializeChecklist(source), /^- \[x\] Find-only fixture #1$/m);
    assert.match(serializeChecklist(source, { literal: true }), /^- \[x\] Find-only fixture #1$/m);
    assert.match(serializeReadingOrder(source), /^- \[ \] Find-only fixture #1$/m);
  }
});

test('Find-only records refuse guessed links during metadata merges, even if an old copy already has one', () => {
  const old = { issueId: findOnlyRow.issueId, title: 'Existing fixture title', source: 'curated' };
  let state = createList(createEmptyState(), { name: 'Disposable guide' });
  const listId = state.active;
  state = addIssuesToList(state, listId, [old]).state;
  const oldIssue = state.issues[old.issueId];
  assert.equal(oldIssue.url, 'https://www.marvel.com/comics/issue/56003/');
  for (const preserveExisting of [false, true]) {
    const revised = addIssuesToList(state, listId, [findOnlyRow], { preserveExisting }).state;
    const issue = revised.issues[old.issueId];
    assert.equal(issue.findOnly, true);
    assert.equal(issue.url, null);
    assert.equal(issue.title, preserveExisting ? old.title : findOnlyRow.title);
    assert.equal(upsertIssue(revised, old).issues[old.issueId].url, null);
  }
  assert.equal(detailUrl({ ...findOnlyRow, url: oldIssue.url }), null);
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

// The app opens its own launch page synchronously, so it never has to retain a window handle across
// an await, because testing on 2026-08-03 showed handles are unreliable. #1601: only the destination,
// a verified viewer number and the title cross the query; book and issue ids no longer do.
test('launchUrl stays same-origin and passes no Marvel Unlimited reference ids', () => {
  const u = new URL(launchUrl({ issueId: 52446, digitalId: 38164, title: 'Secret Wars #1' }, 'http://127.0.0.1:8787'));
  assert.equal(u.origin, 'http://127.0.0.1:8787');
  assert.equal(u.pathname, '/open.html');
  assert.deepEqual([...u.searchParams.keys()].sort(), ['r', 't']);
  assert.equal(u.searchParams.get('r'), 'comics');
  assert.equal(u.searchParams.get('t'), 'Secret Wars #1');
});

test('launchUrl sends nothing for the launch page to resolve when a digitalId is unknown', () => {
  const u = new URL(launchUrl({ issueId: 52446, digitalId: null }, 'http://127.0.0.1:8787'));
  assert.deepEqual([...u.searchParams.keys()], ['r']);
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
  assert.equal(u.searchParams.get('d'), null);
  assert.doesNotMatch(u.search, /passwd/);
});

test('launch references reject coercible, noncanonical and oversized values', () => {
  for (const bad of [true, false, [1], { valueOf: () => 1 }, '1e3', ' 1', '1 ', '01', 0,
    '0', -1, 1000000000000]) {
    const issue = { issueId: bad, digitalId: null };
    assert.equal(isLaunchable(issue), false, String(bad));
    const launch = new URL(launchUrl(issue, 'http://127.0.0.1:8787'));
    assert.deepEqual([...launch.searchParams.keys()], ['r'], String(bad));
    assert.equal(isLaunchable({ issueId: null, digitalId: bad }), false, String(bad));
  }
  // A canonical string id still counts as a reference for offering the control, but is not sent.
  assert.equal(isLaunchable({ issueId: '52446', digitalId: '38164' }), true);
  assert.deepEqual([...new URL(launchUrl({ issueId: '52446', digitalId: '38164' }, 'http://127.0.0.1:8787'))
    .searchParams.keys()], ['r']);
});

test('an issue with neither id is not launchable', () => {
  assert.equal(isLaunchable({}), false);
  assert.equal(isLaunchable(null), false);
  assert.equal(isLaunchable({ issueId: 0 }), false);
  assert.equal(isLaunchable({ issueId: 1 }), true);
  assert.equal(isLaunchable({ digitalId: 1 }), true);
});

test('a saved title-only manual comic can use Find without changing its checkmark', () => {
  const issueId = -8;
  let state = createList(createEmptyState(), { name: 'Manual comics' });
  const listId = state.listOrder[0];
  state = addIssuesToList(state, listId, [{
    issueId,
    title: 'A manually added comic #1',
    source: 'manual',
    hydrated: true,
  }], {}).state;
  state = markRead(state, issueId, true, 1234);

  const stored = listItems(state, listId)[0];
  const before = JSON.stringify(state);
  assert.equal(stored.issueId, issueId);
  assert.equal(stored.digitalId, null);
  assert.equal(detailUrl(stored), null);
  assert.equal(isLaunchable(stored), true);

  const priorWindow = globalThis.window;
  const opened = [];
  globalThis.window = { open: (...args) => { opened.push(args); return null; } };
  try {
    const result = openIssue(stored, { origin: 'http://127.0.0.1:8787' });
    assert.equal(result.ok, true);
    assert.equal(result.target, 'comics');
    const launch = new URL(opened[0][0]);
    assert.equal(launch.origin, 'http://127.0.0.1:8787');
    assert.deepEqual([...launch.searchParams.keys()].sort(), ['r', 't']);
    assert.equal(launch.searchParams.get('r'), 'comics');
    assert.equal(launch.searchParams.get('t'), stored.title);
    assert.equal(listItems(state, listId)[0].read, true);
    assert.equal(JSON.stringify(state), before, 'opening Find must not alter saved progress');
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
});

// The old book id remains round-trippable for saved data, but it no longer chooses the destination.
// A title-only negative-id entry can still use the general website fallback.
test('a hand-added issue keeps its pasted book id, which no longer launches the reader', () => {
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
  assert.equal(isLaunchable(stored), true, 'the saved title offers the website fallback');
  // Read reaches the reader, and Info offers nothing rather than offering the same place again
  // under a name that says marvel.com. Keeping the pasted address as the detail url is what makes
  // that happen, so the rule is exercised here rather than assumed.
  assert.equal(detailUrl(stored), null, 'a reader address must not be dressed up as a detail page');
  // #1601: a saved reader address, from an older import, is never offered as the Info link.
  assert.equal(detailUrl({ issueId, url: 'https://read.marvel.com/#/book/129648' }), null);
  assert.equal(
    detailUrl({ issueId: 52447, url: 'https://read.marvel.com/#/book/129648' }),
    'https://www.marvel.com/comics/issue/52447/',
  );

  const u = new URL(launchUrl(stored, 'http://127.0.0.1:8787'));
  // #1601: the book id is still saved and still makes the control available, but it no longer
  // launches Marvel Unlimited. Read opens the Marvel Comics website.
  assert.equal(u.searchParams.get('r'), 'comics');
  assert.equal(u.searchParams.get('d'), null, 'a saved book id is inert');
  assert.equal(u.searchParams.get('i'), null, 'a synthetic id must not be sent anywhere');
  assert.doesNotMatch(u.href, /read\.marvel\.com/);
  assert.equal(stored.digitalId, 129648, 'and launching leaves the saved field as it was');
});

test('a saved legacy reader entry keeps its reserved identity and enters no provider queue', () => {
  const parsed = parseChecklist([
    '## Ghost-Spider',
    '- [x] [All-New Spider-Gwen: The Ghost-Spider (2026) #9](https://read.marvel.com/#/book/129648/page/4)',
  ].join('\n'), { legacyReaderLinks: true });
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
  assert.equal(stored.digitalId, 129648, 'the legacy book id stays saved');
  assert.deepEqual([...launch.searchParams.keys()].sort(), ['r', 't']);
  assert.equal(launch.searchParams.get('r'), 'comics', 'and Read opens the website rather than the old reader');
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
