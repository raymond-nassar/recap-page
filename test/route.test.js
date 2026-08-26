import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { VIEWS, formatRoute, parseRoute } from '../src/js/lib/route.js';
import { HOME_CATEGORIES, PUBLISHING_CATEGORIES } from '../src/js/lib/catalog.js';
import { LIBRARY_VIEWS } from '../src/js/lib/library.js';
import { READING_FILTERS, DEFAULT_FILTER } from '../src/js/lib/readingFilters.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

// assert.match prints the whole subject on failure, and main.js is 120 KB, which buries the run.
// These say what was looked for instead.
const has = (text, re, what) => assert.ok(re.test(text), `expected to find ${what}`);
const lacks = (text, re, what) => assert.ok(!re.test(text), `expected not to find ${what}`);

test('every view the rail can reach survives a round trip', () => {
  for (const view of VIEWS) {
    const parsed = parseRoute(formatRoute({ view }));
    assert.deepEqual(parsed, { view, listId: null, filter: null }, `round trip failed for ${view}`);
  }
});

test('every publishing category has a direct route and generated panel contract', () => {
  const main = read('src/js/main.js');
  for (const { route } of PUBLISHING_CATEGORIES) {
    assert.ok(VIEWS.includes(route), `${route} is not routable`);
    assert.deepEqual(parseRoute(`#/${route}`), { view: route, listId: null, filter: null });
  }
  has(main, /id:\s*`view-\$\{category\.route\}`/, 'registry-derived publishing panel ids');
  has(main, /id:\s*`\$\{category\.route\}-h`/, 'registry-derived publishing heading ids');
  has(main, /id:\s*`\$\{category\.route\}-report`/, 'registry-derived publishing report ids');
  has(main, /id:\s*`\$\{category\.route\}-results`/, 'registry-derived publishing result ids');
  has(main, /root\.insertBefore\(el\('section',[\s\S]*?\), \$\('\.app-footer'\)\)/,
    'publishing panels inserted before the footer');
});

test('Marvel Ages has one generated route without changing publishing hashes', () => {
  const category = HOME_CATEGORIES.find(({ key }) => key === 'marvel-ages');
  assert.equal(category?.route, 'marvel-ages');
  assert.ok(VIEWS.includes(category.route));
  assert.deepEqual(parseRoute('#/marvel-ages'), {
    view: 'marvel-ages',
    listId: null,
    filter: null,
  });
  assert.equal(formatRoute({ view: category.route }), '#/marvel-ages');
  assert.deepEqual(
    PUBLISHING_CATEGORIES.map(({ route }) => route),
    [
      'age-golden',
      'age-silver',
      'age-bronze',
      'age-copper',
      'age-modern',
      'age-early-modern',
      'age-marvel-knights-heroes-return',
      'age-event-era',
      'age-marvel-now',
      'age-all-new-all-different',
      'age-fresh-start',
      'age-current',
    ],
  );
});

test('the compatible catalog route remains Modern Timeline', () => {
  assert.deepEqual(parseRoute('#/catalog'), { view: 'catalog', listId: null, filter: null });
  const markup = read('src/index.html');
  assert.equal(HOME_CATEGORIES.find(({ route }) => route === 'catalog')?.heading, 'Modern Timeline');
  has(markup, /id="catalog-h">Modern Timeline<\/h1>/, 'Modern Timeline page heading');
});

test('the library views are routable, not just the seven typed ones', () => {
  for (const { value } of LIBRARY_VIEWS) {
    assert.ok(VIEWS.includes(value), `${value} is showable but not routable`);
    assert.deepEqual(parseRoute(formatRoute({ view: value })), { view: value, listId: null, filter: null });
  }
});

test('a list id rides along and comes back intact', () => {
  const hash = formatRoute({ view: 'read', listId: 'list-mabc123-x7y2z9' });
  assert.equal(hash, '#/read/list-mabc123-x7y2z9');
  assert.deepEqual(parseRoute(hash), { view: 'read', listId: 'list-mabc123-x7y2z9', filter: null });
});

// createList accepts a caller-supplied id, so an id containing a slash or a space is reachable
// without a bug anywhere. Encoding it is what keeps it from being read back as a third segment.
test('a list id needing escapes survives a round trip', () => {
  for (const id of ['a/b', 'a b', 'a%b', 'a#b', 'ünïcødé', 'a?b']) {
    const parsed = parseRoute(formatRoute({ view: 'read', listId: id }));
    assert.deepEqual(parsed, { view: 'read', listId: id, filter: null }, `round trip failed for ${id}`);
  }
});

test('the skip link target is not a route', () => {
  assert.equal(parseRoute('#main'), null);
});

// #main alone does not prove the prefix guard: strip the guard and "#main" still parses to nothing,
// because "ain" is not a view. What the guard really stops is a foreign anchor whose third
// character onwards happens to spell a view, which without it would be adopted as that view.
test('a foreign anchor is refused even when it spells a view name past the prefix', () => {
  for (const hash of ['#zread', '#ahome', '#-about', '#!/read']) {
    assert.equal(parseRoute(hash), null, `expected null for ${hash}`);
  }
});

// The claim above is only worth anything while index.html really ships that link, so this reads it
// rather than trusting the test's own memory of it.
test('index.html still ships the #main skip link the parser is guarding against', () => {
  const html = read('src/index.html');
  has(html, /class="skip-link" href="#main"/, 'the skip link');
  has(html, /<main id="main"/, 'the skip link target');
});

test('anything that is not one of our routes is refused', () => {
  for (const hash of ['', '#', '#/', '#main', '#read', '#!/read', '/read', 'read', '#//read']) {
    assert.equal(parseRoute(hash), null, `expected null for ${JSON.stringify(hash)}`);
  }
});

test('a hash that is not a string is refused rather than thrown at', () => {
  for (const hash of [null, undefined, 42, {}, []]) {
    assert.equal(parseRoute(hash), null);
  }
});

test('an unknown view is refused, so a renamed view degrades to the fallback', () => {
  assert.equal(parseRoute('#/settings'), null);
  assert.equal(parseRoute('#/read2'), null);
  assert.equal(parseRoute('#/READ'), null);
});

test('a third segment is refused rather than quietly ignored', () => {
  assert.equal(parseRoute('#/read/list-a/extra'), null);
});

// ------------------------------------------------------------------ the reading filter

test('a chosen filter rides along and comes back intact', () => {
  const hash = formatRoute({ view: 'read', listId: 'list-a', filter: 'unread' });
  assert.equal(hash, '#/read/list-a?filter=unread');
  assert.deepEqual(parseRoute(hash), { view: 'read', listId: 'list-a', filter: 'unread' });
});

// The whole reason the filter is a query and not a third path segment. If the default were written
// out, every address the app emits would change shape, and every link shared or bookmarked under
// BL-036 would stop matching the one it writes today.
test('the default filter is written nowhere, so an unfiltered address is unchanged', () => {
  assert.equal(formatRoute({ view: 'read', listId: 'list-a', filter: DEFAULT_FILTER }), '#/read/list-a');
  assert.equal(formatRoute({ view: 'read', listId: 'list-a' }), '#/read/list-a');
  assert.equal(formatRoute({ view: 'about', filter: DEFAULT_FILTER }), '#/about');
});

test('every filter the app offers is routable, so adding one needs no edit here', () => {
  for (const { value } of READING_FILTERS) {
    const parsed = parseRoute(formatRoute({ view: 'read', listId: 'list-a', filter: value }));
    const expected = value === DEFAULT_FILTER ? null : value;
    assert.deepEqual(parsed, { view: 'read', listId: 'list-a', filter: expected }, `round trip failed for ${value}`);
  }
});

test('the popularity sort round trips on the spotlights route', () => {
  const hash = formatRoute({ view: 'spotlights', sort: 'popularity' });
  assert.equal(hash, '#/spotlights?sort=popularity');
  assert.deepEqual(parseRoute(hash), { view: 'spotlights', listId: null, filter: null, sort: 'popularity' });
});

test('the popularity sort coexists with the reading filter query', () => {
  const hash = formatRoute({ view: 'spotlights', filter: 'unread', sort: 'popularity' });
  assert.equal(hash, '#/spotlights?filter=unread&sort=popularity');
  assert.deepEqual(parseRoute(hash), {
    view: 'spotlights', listId: null, filter: 'unread', sort: 'popularity',
  });
});

test('an unknown spotlights sort is dropped without breaking the route', () => {
  assert.deepEqual(parseRoute('#/spotlights?sort=bogus'), { view: 'spotlights', listId: null, filter: null });
  assert.equal(formatRoute({ view: 'spotlights', sort: 'bogus' }), '#/spotlights');
});

// A stale link from an older build names a view the reader can still be taken to, so the filter is
// refused and the route is not. Refusing the whole route would answer a dropped filter by refusing
// to navigate at all, and the address self-corrects on the next sync either way.
test('an unknown filter is dropped without taking the route down with it', () => {
  for (const hash of ['#/read/list-a?filter=bogus', '#/read/list-a?filter=', '#/read/list-a?other=unread', '#/read/list-a?']) {
    assert.deepEqual(parseRoute(hash), { view: 'read', listId: 'list-a', filter: null }, `expected no filter for ${hash}`);
  }
});

test('an unknown filter is never written into an address either', () => {
  assert.equal(formatRoute({ view: 'read', listId: 'list-a', filter: 'bogus' }), '#/read/list-a');
  assert.equal(formatRoute({ view: 'read', listId: 'list-a', filter: 42 }), '#/read/list-a');
});

// createList accepts a caller-supplied id, so an id holding a question mark is reachable without a
// bug anywhere. It arrives here as %3F, which is why parseRoute splits on the first `?` before
// decoding: decoding first would turn that id back into a `?` and cut the path at it.
test('a list id holding a question mark is not read as the start of the filter', () => {
  const hash = formatRoute({ view: 'read', listId: 'a?b', filter: 'unread' });
  assert.equal(hash, '#/read/a%3Fb?filter=unread');
  assert.deepEqual(parseRoute(hash), { view: 'read', listId: 'a?b', filter: 'unread' });
});

test('a filter cannot smuggle in a path segment', () => {
  assert.deepEqual(parseRoute('#/read/list-a?filter=un/read'), { view: 'read', listId: 'list-a', filter: null });
});

test('a filter on a view with no list needs no placeholder in its place', () => {
  const hash = formatRoute({ view: 'progress', filter: 'unread' });
  assert.equal(hash, '#/progress?filter=unread');
  assert.deepEqual(parseRoute(hash), { view: 'progress', listId: null, filter: 'unread' });
});

test('a malformed percent escape is refused rather than throwing', () => {
  assert.equal(parseRoute('#/read/%E0%A4%A'), null);
  assert.equal(parseRoute('#/%'), null);
});

test('a trailing slash reads as no list rather than an empty one', () => {
  assert.deepEqual(parseRoute('#/read/'), { view: 'read', listId: null, filter: null });
});

test('formatting an unknown view yields nothing to write', () => {
  assert.equal(formatRoute({ view: 'nope' }), '');
  assert.equal(formatRoute({}), '');
  assert.equal(formatRoute(), '');
});

// main.js cannot be imported here, because it reads `document` at module scope. Its wiring is
// checked as text, which is the convention the library view tests already use.
test('main.js takes its view list from the route module rather than keeping a second copy', () => {
  const main = read('src/js/main.js');
  has(main, /import \{[^}]*VIEWS[^}]*\} from '\.\/lib\/route\.js'/, 'VIEWS imported from route.js');
  lacks(main, /const VIEWS = \[/, 'a second VIEWS declaration in main.js');
});

// Asserting the handler's body, not just that a listener exists. Removing the applyRoute call
// leaves both the listener and the boot read in place, so a check for those two strings alone
// stays green while Back and Forward silently stop working. Measured against that exact mutation.
test('main.js listens for hashchange and acts on the route it reads', () => {
  const main = read('src/js/main.js');
  has(
    main,
    /addEventListener\('hashchange',[^)]*\(\) => \{\s*const route = parseRoute\(location\.hash\);\s*if \(route\) applyRoute\(route, \{ focus: true,/,
    'a hashchange handler that reads the route and applies it with focus',
  );
  has(main, /const bootRoute = parseRoute\(location\.hash\)/, 'the boot read of location.hash');
});

// The passive path must never push. A reader who marks twenty issues read and then presses Back
// once should leave the view they were on, not walk back through twenty identical entries.
test('main.js writes the hash passively with replaceState, not by assignment', () => {
  const main = read('src/js/main.js');
  has(main, /history\.replaceState/, 'a replaceState call for passive syncs');
});

// Choosing a filter is the deliberate act this whole scheme exists for, so it has to push. A
// replace here would leave Back unable to undo a filter change, which is the task BL-037 left open.
//
// The order of the three statements is the assertion, not their presence. Committing after setFilter
// rather than before it formats the traversal's entry from the filter that is replacing it, so it
// writes what the push below was going to write, and that push then matches the address already
// showing and writes nothing. The traversal's result is not misplaced, it is never recorded at all,
// and the path that reaches this is a click carrying no pointerdown, which is what assistive
// technology produces and the only reason the commit is here.
test('main.js commits, then sets, then pushes when a filter is chosen', () => {
  const main = read('src/js/main.js');
  const handler = main.slice(main.indexOf("radio.addEventListener('change'"), main.indexOf("const group = $('#reading-filters')"));
  has(
    handler,
    /endFilterRun\(\{ commit: true \}\);[\s\S]*?setFilter\(e\.target\.value\);[\s\S]*?syncHash\(\{ push: true \}\);/,
    'the else branch committing any open traversal before it adopts the new filter and pushes',
  );
});

// Arrow keys move a radio group one stop at a time and fire change at every stop, so pushing on
// each one made Back walk a keyboard reader back through filters they only passed over. Measured in
// Edge on this tree before the fix: three presses of ArrowRight left three entries and one Back
// landed two filters short. The traversal now writes nothing until it ends and then writes one.
test('a keyboard traversal holds its write until it ends', () => {
  const main = read('src/js/main.js');
  has(main, /radio\.addEventListener\('keydown', \(e\) => \{\s*if \(e\.key\.startsWith\('Arrow'\) && !e\.ctrlKey && !e\.altKey && !e\.metaKey\) arrowing = true;/,
    'an arrow key with no modifier setting the traversal flag before the change it produces');
  const handler = main.slice(main.indexOf("radio.addEventListener('change'"), main.indexOf("const group = $('#reading-filters')"));
  has(handler, /if \(arrowing\) \{/, 'the handler branching on whether an arrow key produced the change');
  has(handler, /filterRunBase = filter;\s*filterRunOpen = true;/,
    'the traversal recording the filter it began from before the first stop moves it');
  lacks(handler, /if \(arrowing\)[\s\S]*?syncHash\(\{ push: true \}\);[\s\S]*?\} else \{/,
    'no write on the arrow branch, which is the whole of holding it until the traversal ends');
  has(handler, /arrowing = false;/, 'the arrow flag being cleared by the change it fired');
});

// The address lags the rows for as long as a traversal is open, and something else can write in that
// window: every store.update reaches renderAll, which syncs, and background hydration writes on a
// timer. Formatting a passive sync with the live filter would replace the entry the reader arrived
// on with the half-chosen address and destroy the thing Back exists to return to.
test('a passive sync during a traversal writes the address the traversal began from', () => {
  const main = read('src/js/main.js');
  const body = main.slice(main.indexOf('function syncHash'), main.indexOf('function endFilterRun'));
  has(body, /const shown = filterRunOpen && !push \? filterRunBase : filter;/,
    'a passive sync formatting with the base rather than the live filter');
  has(body, /formatRoute\(\{ view, listId: activeListId\(\), filter: shown, sort \}\)/,
    'and the route being built from it');
});

// A traversal that is left and returned to is two traversals, and moving between radios inside the
// group is not leaving it, so the check has to look at where focus went. Leaving is also when the
// traversal's one entry gets written, so these listeners commit rather than discard.
test('leaving the filter group commits the traversal, and moving inside it does not', () => {
  const main = read('src/js/main.js');
  has(main, /group\.addEventListener\('focusout', \(e\) => \{\s*if \(e\.relatedTarget && group\.contains\(e\.relatedTarget\)\) return;\s*arrowing = false;\s*endFilterRun\(\{ commit: true \}\);/,
    'a focusout that commits the run only when focus left the group');
  has(main, /group\.addEventListener\('pointerdown', \(\) => \{\s*arrowing = false;\s*endFilterRun\(\{ commit: true \}\);/,
    'a pointer press committing the run, which is the only listener a press on the checked radio reaches');
});

// Committing is what writes the traversal's entry, so it has to push. Discarding must not write at
// all, because the only caller that discards is applyRoute, where the address is already correct.
test('ending a traversal writes one entry when it commits and none when it does not', () => {
  const main = read('src/js/main.js');
  const body = main.slice(main.indexOf('function endFilterRun'), main.indexOf('function endFilterRun') + 400);
  has(body, /if \(!filterRunOpen\) return;/, 'ending a traversal that is not open doing nothing');
  has(body, /filterRunOpen = false;\s*filterRunBase = null;/, 'both traversal variables being cleared');
  has(body, /if \(commit\) syncHash\(\{ push: true \}\);/, 'a commit pushing and a discard writing nothing');
});

// Back is a navigation and a traversal cannot span one. The landing address is authoritative, so the
// traversal is discarded rather than committed: committing would write over the address Back chose.
//
// Position is the assertion here too. Moved below showView, the run is still open when showView's
// trailing sync runs, so that sync formats from filterRunBase and the address is left claiming a
// filter the rows are not showing. Modelled sequence: pending in force, one ArrowRight, then
// Alt+Left, which reaches applyRoute with the run genuinely open. It leaves a persistent
// address-versus-rows disagreement and two adjacent identical entries, which is the dead Back this
// design exists to close.
test('applyRoute discards any open traversal, and does it before showView', () => {
  const main = read('src/js/main.js');
  const body = main.slice(main.indexOf('function applyRoute'), main.indexOf('function showView'));
  has(
    body,
    /setFilter\([\s\S]*?endFilterRun\(\{ commit: false \}\);[\s\S]*?showView\(route\.view/,
    'applyRoute discarding the run after setFilter and before showView',
  );
});

// `store.state.lists` is a plain object, so a bare lookup answers `__proto__`, `constructor` and
// `toString` with something from Object.prototype. Measured on this tree before the fix: opening
// `#/read/__proto__` persisted `active: "__proto__"` and threw a TypeError out of listProgress, and
// the stored id made the same throw happen on the next boot, during module evaluation.
test('a list id naming a prototype member cannot be adopted from an address', () => {
  const main = read('src/js/main.js');
  has(main, /Object\.hasOwn\(store\.state\.lists, route\.listId\)/, 'applyRoute asking whether the list is really there');
  has(main, /Object\.hasOwn\(store\.state\.lists, activeListId\(\) \?\? ''\)/, 'showView asking the same question');
  lacks(main, /store\.state\.lists\[route\.listId\]/, 'a bare lookup of a list id from an address');
  // The bare lookups that remain read an id already in storage, which no address can now put there.
  // They are reachable only from a hand-edited state file, through coerce, and that is BL-068. The
  // count is asserted so one added on the address path cannot hide among them. The destination-copy
  // simplification removed one redundant lookup from renderAll and left the shared formatter's
  // lookup in place, reducing this count from seven without changing which ids can reach storage.
  const bare = [...main.matchAll(/store\.state\.lists\[activeListId\(\)\]/g)];
  assert.equal(bare.length, 6, 'a bare list lookup was added or removed without deciding about BL-068');
});

// Assigning location.hash fires hashchange, which re-runs applyRoute and moves focus to the view
// heading. For a filter radio that throws the keyboard out of the control just pressed. Measured in
// Edge: pushState fires no hashchange, and Back over an entry it made still does.
test('main.js pushes with pushState rather than by assigning the hash', () => {
  const main = read('src/js/main.js');
  has(main, /history\.pushState\(null, '', next\)/, 'a pushState call for deliberate navigation');
  lacks(main, /location\.hash = /, 'an assignment to location.hash');
});

// The two callers of applyRoute disagree about what an address with no filter means, and the
// disagreement is the point. Back hands over an address this app wrote, and this app omits the
// filter only when it is the default, so absent there means All. Boot may be handed a bookmark made
// before any of this shipped, where absent means nothing at all and the stored setting stands.
test('main.js reads an absent filter as All on Back but as the stored one at boot', () => {
  const main = read('src/js/main.js');
  has(main, /applyRoute\(bootRoute, \{ focus: false, filterIfAbsent: filter \}\)/, 'boot falling back to the restored filter');
  has(main, /applyRoute\(route, \{ focus: true, filterIfAbsent: DEFAULT_FILTER \}\)/, 'hashchange falling back to the default');
});

// One path in and out of the filter, so a route cannot move the rows without moving the radio, and
// a radio cannot move the rows without storing the choice.
test('nothing sets the filter behind setFilter back', () => {
  const main = read('src/js/main.js');
  const body = main.slice(main.indexOf('function setFilter'), main.indexOf('function wireReading'));
  has(body, /settings\.filter = wanted;/, 'setFilter storing the choice');
  has(body, /radio\.checked = true;/, 'setFilter moving the radio');
  has(body, /renderRows\(\);/, 'setFilter re-rendering the rows');
  // wireReading restores from settings before any radio exists to read, and corrects an
  // unrecognised stored value, which is a job setFilter does not have. Every other write is a bug.
  const writes = [...main.matchAll(/^\s*filter = /gm)];
  assert.equal(writes.length, 2, 'the filter is written somewhere other than setFilter and the restore');
});
