import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LIBRARY_VIEWS, libraryView, isLibraryView, libraryViewProblems } from '../src/js/lib/library.js';
import { ADD_VIEWS } from '../src/js/lib/route.js';
import {
  createEmptyState, createList, addIssuesToList, markRead, deleteList, removeFromList,
  readIssues, manualIssues, listsContaining, migrate, SCHEMA_VERSION,
} from '../src/js/lib/model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// A state holding one curated list of two issues and one hand-added entry, which is the smallest
// shape that tells the two selectors apart: each has to find one thing the other must not.
function seeded() {
  let s = createEmptyState();
  s = createList(s, { name: 'Secret Wars', id: 'l1' });
  s = addIssuesToList(s, 'l1', [
    { issueId: 10, title: 'New Avengers 1', seriesName: 'New Avengers (2013)', source: 'curated', hydrated: true },
    { issueId: 20, title: 'Avengers 1', seriesName: 'Avengers (2012)', source: 'curated', hydrated: true },
  ], {}).state;
  s = addIssuesToList(s, 'l1', [
    { issueId: -99, title: 'A convention exclusive', source: 'manual', hydrated: true },
  ], {}).state;
  return s;
}

test('the list the rail buttons and sections are built from has to be self-consistent', () => {
  assert.deepEqual(libraryViewProblems(LIBRARY_VIEWS), []);
  assert.equal(LIBRARY_VIEWS.length, 2);
  assert.equal(isLibraryView('library-read'), true);
  assert.equal(isLibraryView('progress'), false);
  assert.equal(libraryView('nope'), null);
});

test('every view declares how to summarise and group its own rows', () => {
  // The renderer reads these two off the view rather than branching on the value, so a view that
  // shipped without them would render its heading and then throw when the band or the groups were
  // reached. Asserted here because the loader only fails the app on it, and a test names it sooner.
  for (const v of LIBRARY_VIEWS) {
    assert.equal(typeof v.summarise, 'function', `${v.value} has no summarise function`);
    assert.equal(typeof v.group, 'function', `${v.value} has no group function`);
  }
});

test('a Library view that cannot produce a section id or a page is reported, not accepted', () => {
  const ok = { value: 'library-read', label: 'L', sort: 'S', empty: 'E', markHandAdded: true, select: () => [], summarise: () => [], group: () => [] };
  assert.deepEqual(libraryViewProblems([]), ['The Library view list is empty.']);
  assert.deepEqual(
    libraryViewProblems([ok, { ...ok, value: 'library read' }]),
    ['Library view 1 has no value usable as a section id.'],
  );
  assert.deepEqual(libraryViewProblems([ok, ok]), ['Library view 1 repeats the value "library-read".']);
  assert.deepEqual(
    libraryViewProblems([{ ...ok, sort: '' }]),
    ['Library view 0 has no sort.'],
  );
  assert.deepEqual(
    libraryViewProblems([{ ...ok, select: null }]),
    ['Library view 0 has no select function.'],
  );
  // The renderer reaches for both on every view, so a section missing either is reported the
  // same way a missing selector is, rather than throwing on the first render.
  assert.deepEqual(
    libraryViewProblems([{ ...ok, summarise: null }]),
    ['Library view 0 has no summarise function.'],
  );
  assert.deepEqual(
    libraryViewProblems([{ ...ok, group: 'nope' }]),
    ['Library view 0 has no group function.'],
  );
  // false is a meaningful answer, so the check has to be for presence and not for truth.
  assert.deepEqual(libraryViewProblems([{ ...ok, markHandAdded: false }]), []);
  assert.deepEqual(
    libraryViewProblems([{ ...ok, markHandAdded: undefined }]),
    ['Library view 0 does not say whether to mark hand-added rows.'],
  );
});

test('an empty-state action is optional, but a declared one has to lead somewhere', () => {
  // Omitting it is a real answer: an empty screen with nothing useful to offer should offer
  // nothing. A declared one is checked because the button is painted from these two strings and a
  // typo in the destination would render a control that navigates nowhere and reports no error.
  const ok = { value: 'library-read', label: 'L', sort: 'S', empty: 'E', markHandAdded: true, select: () => [], summarise: () => [], group: () => [] };
  assert.deepEqual(libraryViewProblems([ok]), []);
  const bad = 'Library view 0 has an empty-state action with no label or no destination.';
  assert.deepEqual(libraryViewProblems([{ ...ok, emptyAction: { label: 'Go', view: 'catalog' } }]), []);
  assert.deepEqual(libraryViewProblems([{ ...ok, emptyAction: { label: 'Go', view: '' } }]), [bad]);
  assert.deepEqual(libraryViewProblems([{ ...ok, emptyAction: { label: '', view: 'catalog' } }]), [bad]);
  assert.deepEqual(libraryViewProblems([{ ...ok, emptyAction: { label: 'Go' } }]), [bad]);
  assert.deepEqual(libraryViewProblems([{ ...ok, emptyAction: null }]), [bad]);
});

test('every declared empty-state action names a view the rail can actually reach', () => {
  // The destination is a data value here and a data-view attribute there, so nothing but this
  // test connects the two. An allow-list written by hand does not connect them either: the first
  // version of this test allowed 'library', 'settings' and 'reading', none of which are views,
  // while omitting 'data' and 'read', which are. It would have passed the exact typo it was
  // written to catch. Read the sections out of the markup instead, because a section is what
  // showView looks for and failing to find one blanks the page.
  const html = read('src/index.html');
  const sections = new Set(sectionIds(html));
  for (const v of LIBRARY_VIEWS) {
    if (!v.emptyAction) continue;
    assert.ok(
      sections.has(v.emptyAction.view),
      `${v.value} offers an empty-state action going to ${v.emptyAction.view}, which has no section in the markup`,
    );
    // The disclosure the action opens is looked up by id at click time and skipped when missing,
    // so a wrong id degrades quietly to a plain view change rather than throwing.
    if (v.emptyAction.open) {
      assert.ok(
        html.includes(`id="${v.emptyAction.open}"`),
        `${v.value} offers an empty-state action opening ${v.emptyAction.open}, which is not in the markup`,
      );
    }
  }
});

test('Everything read is the read map, newest first', () => {
  let s = seeded();
  s = markRead(s, 20, true, 1000);
  s = markRead(s, 10, true, 3000);
  assert.deepEqual(readIssues(s).map((r) => r.issueId), [10, 20]);
  assert.deepEqual(readIssues(s).map((r) => r.readAt), [3000, 1000]);
});

test('issues read in the same moment are ordered by id rather than by key order', () => {
  // markManyRead calls markRead in a loop, each with its own Date.now(), so a bulk mark produces
  // runs of equal timestamps. Without the explicit tie break these fall back to key enumeration,
  // which puts positive ids in ascending order and every negative id after them.
  let s = seeded();
  for (const id of [20, -99, 10]) s = markRead(s, id, true, 5000);
  assert.deepEqual(readIssues(s).map((r) => r.issueId), [-99, 10, 20]);
});

test('an unread issue is not in Everything read, and unmarking removes it', () => {
  let s = markRead(seeded(), 10, true, 1000);
  assert.deepEqual(readIssues(s).map((r) => r.issueId), [10]);
  s = markRead(s, 10, false);
  assert.deepEqual(readIssues(s), []);
});

test('a read issue with no metadata record is shown as itself rather than dropped', () => {
  // Reachable through a restored backup whose read map names an issue its issues map does not.
  // Dropping it would make the view quietly disagree with the progress ring.
  const s = markRead(createEmptyState(), 4321, true, 1000);
  assert.deepEqual(readIssues(s).map((r) => r.title), ['Issue 4321']);
  assert.deepEqual(readIssues(s).map((r) => r.lists), [[]]);
});

test('an issue read inside a list that was later deleted says it belongs to nothing', () => {
  // deleteList keeps issue metadata and read state deliberately, so before these views such an
  // issue appeared on no screen at all. This is the whole reason the view reads the map and not
  // the lists.
  let s = markRead(seeded(), 10, true, 1000);
  assert.deepEqual(readIssues(s)[0].lists, ['Secret Wars']);
  s = deleteList(s, 'l1');
  const rows = readIssues(s);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].title, 'New Avengers 1');
  assert.deepEqual(rows[0].lists, []);
});

test('Added by hand is the manual source marker, by title', () => {
  let s = seeded();
  s = addIssuesToList(s, 'l1', [
    { issueId: -1, title: 'Another one by hand', source: 'manual', hydrated: true },
  ], {}).state;
  assert.deepEqual(manualIssues(s).map((r) => r.title), ['A convention exclusive', 'Another one by hand']);
  // The two curated issues are the ones that must not appear.
  assert.equal(manualIssues(s).some((r) => r.issueId === 10 || r.issueId === 20), false);
});

test('a hand-added issue removed from its list is still added by hand', () => {
  const s = removeFromList(seeded(), 'l1', -99);
  const rows = manualIssues(s);
  assert.deepEqual(rows.map((r) => r.issueId), [-99]);
  assert.deepEqual(rows[0].lists, []);
});

test('a row names every list it is in, in rail order', () => {
  let s = seeded();
  s = createList(s, { name: 'Aardvark reading', id: 'l2' });
  s = addIssuesToList(s, 'l2', [{ issueId: 10, title: 'New Avengers 1', source: 'curated' }], {}).state;
  // listOrder, not alphabetical: the names are read back in the order the rail shows them.
  assert.deepEqual(listsContaining(s, 10), ['Secret Wars', 'Aardvark reading']);
  assert.deepEqual(listsContaining(s, 999), []);
});

// Everything read prints the timestamp, so what a restore can put in the read map is this view's
// problem too. `store.load` runs every saved state through `migrate`, and `migrate` replaces any
// value that is not a usable number, which is what makes the row renderer safe in dropping the
// date when `readAt` is falsy: no falsy value can reach it carrying a real reading date. Pinned
// here because the rendering depends on it and nothing else asserts it.
test('a restore cannot put a date on screen that is not one', () => {
  const raw = {
    schemaVersion: SCHEMA_VERSION,
    issues: {}, lists: {}, listOrder: [], overrides: {},
    read: { 1: 'banana', 2: null, 3: 0, 4: 1700000000000 },
  };
  const rows = readIssues(migrate(raw));
  assert.deepEqual(rows.map((r) => r.issueId).sort((a, b) => a - b), [1, 2, 3, 4]);
  for (const row of rows) {
    assert.equal(Number.isFinite(row.readAt), true, `issue ${row.issueId} kept ${row.readAt}`);
    assert.notEqual(row.readAt, 0, `issue ${row.issueId} kept a falsy timestamp`);
  }
  assert.equal(rows.find((r) => r.issueId === 4).readAt, 1700000000000);
});

// The v1 branch of `migrate` is a separate path that never reaches `coerce`: it rebuilds the state
// from scratch and writes read state through `markRead`. Restoring a v1 backup is the supported
// route to it, so testing only the v2 shape above would have pinned the invariant on the one path
// that already held it and reported a pass while a v1 backup put "Invalid Date" on the page.
test('a restore from the older format cannot put a date on screen either', () => {
  const raw = {
    schemaVersion: 1,
    lists: {
      a: {
        name: 'Old',
        items: [
          { issueId: 5, title: 'Bad stamp', read: true, readAt: 'banana' },
          { issueId: 6, title: 'No stamp', read: true },
          { issueId: 7, title: 'Real stamp', read: true, readAt: 1700000000000 },
          { issueId: 8, title: 'Never read', read: false },
        ],
      },
    },
  };
  const rows = readIssues(migrate(raw));
  assert.deepEqual(rows.map((r) => r.issueId).sort((a, b) => a - b), [5, 6, 7]);
  for (const row of rows) {
    assert.equal(Number.isFinite(row.readAt), true, `issue ${row.issueId} kept ${row.readAt}`);
    assert.equal(
      new Date(row.readAt).toString() === 'Invalid Date',
      false,
      `issue ${row.issueId} renders as Invalid Date`,
    );
  }
  assert.equal(rows.find((r) => r.issueId === 7).readAt, 1700000000000);
});

// ---------------------------------------------------------------- markup agreement
// The two files are held together here rather than in either of them. `showView` hides every
// section by name and then focuses the heading of the one it showed, so a route with no section
// blanks the page and throws on a null, and a section with no route is unreachable. Neither says
// anything in the console until a reader presses the button.

function sectionIds(html) {
  return [...html.matchAll(/id="view-([a-z0-9-]+)"/g)].map((m) => m[1]).sort();
}

test('every view main.js switches between has a section in the markup, and the reverse', () => {
  // The list moved to src/js/lib/route.js in BL-036, so that one declaration backs both what can
  // be shown and what a URL can address. Read from there, but keep asserting on the markup.
  const literal = read('src/js/lib/route.js').match(/export const VIEWS = \[([^\]]*)\]/);
  assert.ok(literal, 'route.js no longer declares a VIEWS list this test can read');
  assert.match(literal[1], /\.\.\.LIBRARY_VIEWS/, 'VIEWS no longer spreads the Library views in');
  assert.match(literal[1], /\.\.\.ADD_VIEWS/, 'VIEWS no longer spreads the Add views in');
  const named = [...literal[1].matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
  const expected = [
    ...named,
    ...LIBRARY_VIEWS.map((v) => v.value),
    ...ADD_VIEWS,
  ].sort();

  assert.deepEqual(sectionIds(read('src/index.html')), expected);
});

test('every rail button routes to a view that exists', () => {
  const html = read('src/index.html');
  const sections = new Set(sectionIds(html));
  const routes = [...html.matchAll(/data-view="([a-z0-9-]+)"/g)].map((m) => m[1]);
  assert.ok(routes.length >= 8, `expected the rail to be found, got ${routes.length} routes`);
  assert.deepEqual(routes.filter((r) => !sections.has(r)), []);
});

test('each Library hub choice carries the label its view is rendered with', () => {
  const html = read('src/index.html');
  const hub = html.slice(html.indexOf('id="view-library"'), html.indexOf('id="view-progress"'));
  for (const v of LIBRARY_VIEWS) {
    const button = hub.match(new RegExp(`data-view="${v.value}"[\\s\\S]*?</button>`));
    assert.ok(button, `no Library hub choice routes to ${v.value}`);
    assert.ok(
      button[0].includes(`<span>${v.label}</span>`),
      `the Library hub choice for ${v.value} does not say ${JSON.stringify(v.label)}`,
    );
  }
});

// BL-033 stopped the full order from being built while it is closed, which is how it starts. That
// makes opening it the only thing that can fill it, so the guard and the listener are one
// mechanism in two files and neither half means anything alone. Removing the listener leaves an
// order that silently never fills, and nothing in the console says so.
test('the full order is skipped while closed and filled when it is opened', () => {
  const main = read('src/js/main.js');
  const html = read('src/index.html');

  assert.match(html, /<details class="full" id="full">/, 'the markup no longer holds the details the guard names');
  assert.equal(
    / open>/.test(html.match(/<details class="full" id="full"[^>]*>/)[0]),
    false,
    'the order now starts open, so the skip would never be the first thing a reader meets',
  );
  assert.match(
    main,
    /if \(!\$\('#full'\)\.open\) \{ rowsPending = true; return; \}/,
    'renderRows no longer skips the rows while the order is closed',
  );
  assert.match(
    main,
    /\$\('#full'\)\.addEventListener\('toggle', \(\) => \{\s*if \(\$\('#full'\)\.open && rowsPending\) renderRows\(\);/,
    'nothing renders the rows when the order is opened, so it would fill only on the next change',
  );
});

// The count sits in the <summary>, which stays on screen when the order below it is closed, so it
// has to be written on the side of the guard that still runs. Moving it back below the return
// would freeze it at whatever it read when the reader last had the order open.
test('the unread count is written before the closed-order return, not after it', () => {
  const main = read('src/js/main.js');
  const body = main.slice(main.indexOf('function renderRows()'));
  const count = body.indexOf("$('#full-count').textContent");
  const guard = body.indexOf("if (!$('#full').open)");
  assert.ok(count !== -1 && guard !== -1, 'renderRows no longer holds both the count and the guard');
  assert.ok(count < guard, 'the unread count is now written after the return that skips a closed order');
});

// The cache key is the whole item on purpose. An enumerated list of the fields a row happens to
// read is one somebody has to keep complete, and a field left out of it is a row that silently
// stops updating, which is the whole defect the cache would otherwise buy. Three inputs are not part
// of the item and so must stay named: `currentId`, today's date, which is what decides whether
// a badge reads "soon" or "MU" and would otherwise freeze a row built before local midnight, and
// the cover setting, which since BL-108 decides whether the row's image was requested at all.
//
// What the key does is now proved by calling it, in `test/render-rows.test.js`, which BL-064 made
// possible by giving the key a name and the module an export. What is left here is the half that
// no unit test can reach: that `renderRows` reads the day once and hands that same day to both
// judgements, so every row in one pass is scored against one date, and that the setting it hands
// the key is the one the paint reads.
test('a cached row is keyed by the whole item, not by a list of fields', () => {
  const main = read('src/js/main.js');
  assert.match(
    main,
    /return `\$\{JSON\.stringify\(item\)\}\|\$\{item\.issueId === currentId\}\|\$\{today\}\|\$\{covers !== false\}`;/,
    'the row cache key no longer covers every field of the item plus the up-next marker, the day and the cover setting',
  );
  assert.match(
    main,
    /const rowKey = rowCacheKey\(item, currentId, today, settings\.covers\);/,
    'renderRows no longer keys its rows through rowCacheKey, so the tested key may not be the used one',
  );
  assert.match(
    main,
    /const today = localDayString\(\);/,
    'renderRows no longer reads the day once, so rows in one pass can be judged against different days',
  );
  for (const call of [/availability\(item, \{ override, today \}\)/, /describe\(item, \{ override, today \}\)/]) {
    assert.match(main, call, `a row no longer passes the day it was keyed on into ${call}`);
  }
});

// Keying a row costs nothing unless the key is compared. Deleting either comparison leaves every
// row and every heading reused unconditionally, which is silent: eslint stays clean because the key
// is still referenced where it is stored, and a row simply keeps the checkmark it was built with.
// The list reset is the same shape but worse than staleness, because a reused row's move and remove
// handlers close over the id of the list it was built for.
test('the row cache is invalidated, not merely populated', () => {
  const main = read('src/js/main.js');
  assert.match(
    main,
    /if \(cached && cached\.key === rowKey\) \{ desired\.push\(cached\.node\); continue; \}/,
    'a cached row is no longer compared against its key, so every row is reused whatever changed',
  );
  assert.match(
    main,
    /if \(cachedHead && cachedHead\.key === headKey\) desired\.push\(cachedHead\.node\);/,
    'a cached edition heading is no longer compared against its key, so its "n of m read" freezes',
  );
  assert.match(
    main,
    /if \(id !== rowCacheListId\) \{ rowCache = new Map\(\); rowCacheListId = id; \}/,
    'the cache no longer resets between lists, so rows leak across lists with the wrong list id bound',
  );
});

// Reordering these two loops reintroduces the fault the reconciler was written to avoid: a stale
// node left in front of the reused ones shifts every later index by one, so one rebuilt row moves
// all the rest. Measured in Edge on the 219 issue list, that was 219 moves rather than 2.
test('the reconciler drops unwanted nodes before it places the wanted ones', () => {
  const main = read('src/js/main.js');
  const fn = main.slice(main.indexOf('function commitRows('));
  const drop = fn.indexOf('if (!wanted.has(node)) node.remove()');
  const place = fn.indexOf('container.insertBefore(node');
  assert.ok(drop !== -1 && place !== -1, 'commitRows no longer both drops and places nodes');
  assert.ok(drop < place, 'commitRows places nodes before dropping the stale ones, which moves every later row');
});
