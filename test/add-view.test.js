import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADD_VIEWS, LEGACY_VIEW_ALIASES, VIEWS, formatRoute, parseRoute,
} from '../src/js/lib/route.js';
import {
  addIssuesToList, createEmptyState, createList, normalizeIssue,
} from '../src/js/lib/model.js';
import {
  ComicSearchRunner, createAddView, mergeSearchSelection, persistSearchSelection,
} from '../src/js/views/add.js';
import { KEY, Store } from '../src/js/storage.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const html = read('src/index.html');
const main = read('src/js/main.js');
const add = read('src/js/views/add.js');
const catalogPresentation = read('src/js/views/shared/catalog-presentation.js');

function prose(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function page(view) {
  const start = html.indexOf(`<section id="view-${view}" class="view" hidden`);
  assert.notEqual(start, -1, `the source must still carry #view-${view}`);
  const next = html.indexOf('\n          <section id="view-', start + 1);
  assert.notEqual(next, -1, `#view-${view} must still be followed by another view`);
  return html.slice(start, next);
}

const pages = new Map(ADD_VIEWS.map((view) => [view, page(view)]));
const allPages = [...pages.values()].join('\n');

function controlledPages() {
  const runs = [];
  return {
    runs,
    load(item, { signal, onPage }) {
      let finish;
      let fail;
      let loaded = 0;
      const pending = new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      });
      runs.push({
        item,
        signal,
        finish,
        fail,
        async page(items, total) {
          loaded += items.length;
          await onPage(items, { loaded, total });
        },
      });
      return pending;
    },
  };
}

const issue = (id, day = id) => ({
  issueId: id,
  title: `Issue ${id}`,
  number: String(id),
  onSale: `2026-01-${String(day).padStart(2, '0')}T00:00:00+0000`,
  source: 'api',
});

function listState(ids = []) {
  let state = createList(createEmptyState(), { name: 'Reading List' });
  const listId = state.listOrder[0];
  state = addIssuesToList(state, listId, ids.map((id) => issue(id))).state;
  return { state, listId };
}

test('saving a selection preserves existing order and sorts only the selected comics', () => {
  const { state: initial, listId } = listState([90, 91]);
  const result = mergeSearchSelection(initial, [
    issue(4), issue(2), issue(3), issue(1), issue(2),
  ], { listId });

  assert.deepEqual(result.state.lists[listId].itemIds, [90, 91, 1, 2, 3, 4]);
  assert.equal(result.state.listOrder.length, 1);
  assert.deepEqual(
    { added: result.added, skipped: result.skipped },
    { added: 4, skipped: 0 },
  );
});

test('a named new Reading List does not use or alter the active list', () => {
  const { state, listId } = listState([90]);
  const result = mergeSearchSelection(state, [issue(2), issue(1)], { name: '  Brubaker picks  ' });

  assert.equal(result.error, null);
  assert.notEqual(result.listId, listId);
  assert.equal(result.listName, 'Brubaker picks');
  assert.equal(result.state.active, result.listId);
  assert.deepEqual(result.state.lists[result.listId].itemIds, [1, 2]);
  assert.strictEqual(result.state.lists[listId], state.lists[listId]);
  assert.equal(result.state.issues[1].mu, null);
});

test('selected duplicates keep shared progress, notes, overrides and richer saved metadata', () => {
  const { state: initial, listId } = listState([90, 91, 2]);
  const state = {
    ...initial,
    issues: {
      ...initial.issues,
      2: { ...initial.issues[2], digitalId: 42, mu: '2026-02-01', hydrated: true },
    },
    read: { 2: 1234 },
    notes: { 2: 'Keep this note' },
    overrides: { 2: 'unavailable' },
    lists: Object.assign(Object.create(null), initial.lists, {
      [listId]: { ...initial.lists[listId], deferredIssueIds: [90], collectedIn: { 90: 'A book' } },
    }),
  };
  const result = mergeSearchSelection(state, [issue(2), issue(1)], { listId });

  assert.deepEqual(result.state.lists[listId].itemIds, [90, 91, 2, 1]);
  assert.deepEqual(result.state.lists[listId].deferredIssueIds, [90]);
  assert.deepEqual(result.state.lists[listId].collectedIn, { 90: 'A book' });
  for (const key of ['read', 'notes', 'overrides']) assert.strictEqual(result.state[key], state[key]);
  assert.equal(result.state.issues[2].digitalId, 42);
  assert.equal(result.state.issues[2].mu, '2026-02-01');
  assert.equal(result.state.issues[2].hydrated, true);
  assert.deepEqual({ added: result.added, skipped: result.skipped }, { added: 1, skipped: 1 });
});

test('unsaved duplicate selections retain richer metadata in either input order', () => {
  const rich = {
    ...issue(1),
    seriesName: 'Shared series',
    digitalId: 42,
    mu: '2026-02-01',
    pageCount: 32,
    creators: [{ name: 'A creator', role: 'writer' }],
    hydrated: true,
  };
  const sparse = { issueId: 1, title: rich.title, hydrated: false };
  for (const items of [[rich, sparse], [sparse, rich]]) {
    const result = mergeSearchSelection(createEmptyState(), items, { name: 'Shared picks' });
    assert.deepEqual(result.state.issues[1], normalizeIssue(rich));
    assert.deepEqual(result.state.lists[result.listId].itemIds, [1]);
    assert.deepEqual({ added: result.added, skipped: result.skipped }, { added: 1, skipped: 0 });
  }
});

test('invalid selections, names and deleted destinations never create a fallback list', () => {
  const { state } = listState([90]);
  for (const [items, destination, error] of [
    [[], { name: 'Empty' }, /Select at least/],
    [[{ issueId: 0 }], { name: 'Invalid' }, /valid issue ID/],
    [[issue(1)], { name: '  ' }, /Name the new/],
    [[issue(1)], { name: 'x'.repeat(201) }, /200 characters/],
    [[issue(1)], { listId: 'deleted', name: 'Do not create this' }, /no longer exists/],
    [[issue(1)], { listId: '__proto__' }, /no longer exists/],
  ]) {
    const result = mergeSearchSelection(state, items, destination);
    assert.strictEqual(result.state, state);
    assert.equal(result.added, 0);
    assert.match(result.error, error);
  }
});

test('a real destination named like an object prototype remains selectable', () => {
  const state = createList(createEmptyState(), { id: '__proto__', name: 'A restored list' });
  const result = mergeSearchSelection(state, [issue(1)], { listId: '__proto__' });
  assert.equal(result.error, null);
  assert.deepEqual(result.state.lists.__proto__.itemIds, [1]);
});

test('a refused selection rolls new-list creation and comics back in one write', () => {
  const saved = new Map();
  let writes = 0;
  let education = 0;
  const storage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem(key, value) {
      writes += 1;
      const state = JSON.parse(value);
      if (Object.values(state.lists).some((list) => list.itemIds.length > 0)) {
        const error = new Error('full');
        error.name = 'QuotaExceededError';
        throw error;
      }
      saved.set(key, value);
    },
    removeItem: (key) => saved.delete(key),
  };
  const store = new Store({ storage });
  store.load();

  const result = persistSearchSelection(
    store,
    [issue(1)],
    { name: 'Brubaker picks' },
    () => { education += 1; },
  );

  assert.equal(writes, 1, 'list creation and selected membership were split across writes');
  assert.equal(store.state.listOrder.length, 0, 'a refused save left an empty list behind');
  assert.equal(saved.has(KEY), false, 'a refused save changed the saved reading data');
  assert.equal(result.ok, false);
  assert.equal(result.listId, null, 'a phantom new destination escaped after refusal');
  assert.equal(education, 0, 'a failed save consumed save education');
  assert.equal(result.added, 0);
  assert.match(result.error, /full|storage/i);
});

test('a successful selection records education only after its one durable write', () => {
  const saved = new Map();
  let writes = 0;
  const store = new Store({ storage: {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => { writes += 1; saved.set(key, value); },
  } });
  store.load();
  const result = persistSearchSelection(store, [issue(2), issue(1)], { name: 'My comics' }, (status) => {
    const onDisk = JSON.parse(saved.get(KEY));
    assert.deepEqual(onDisk.lists[status.listId].itemIds, [1, 2]);
    assert.equal(status.added, 2);
    return 'recorded';
  });
  assert.equal(writes, 1);
  assert.equal(result.ok, true);
  assert.equal(result.transition, 'recorded');
});

test('a stale tab refuses its selection and adopts the other tab without a phantom list', () => {
  const saved = new Map();
  const storage = {
    getItem: (key) => saved.get(key) ?? null,
    setItem: (key, value) => saved.set(key, value),
  };
  const stale = new Store({ storage });
  const current = new Store({ storage });
  stale.load();
  current.load();
  const other = persistSearchSelection(current, [issue(1)], { name: 'Other tab' });
  let education = 0;
  const refused = persistSearchSelection(stale, [issue(2)], { name: 'Not saved' }, () => { education += 1; });

  assert.equal(refused.ok, false);
  assert.equal(refused.added, 0);
  assert.equal(education, 0);
  assert.deepEqual(stale.state.listOrder, [other.listId]);
  assert.equal(stale.state.issues[2], undefined);
  assert.equal(JSON.parse(saved.get(KEY)).lists[other.listId].name, 'Other tab');
});

test('a comic preview completes with deduplicated chronological results, without a writer', async () => {
  const api = controlledPages();
  const statuses = [];
  const runner = new ComicSearchRunner({
    load: api.load,
    onStatus: (status) => statuses.push(status),
  });

  const pending = runner.start({ id: 1, name: 'Complete', issueCount: 999 });
  await api.runs[0].page([issue(2), issue(1), issue(2)], 3);
  api.runs[0].finish();
  const result = await pending;

  assert.equal(result.phase, 'complete');
  assert.deepEqual(result.items.map((item) => item.issueId), [1, 2]);
  assert.equal(result.received, 3);
  assert.equal(result.total, 3, 'an older name-index count overruled the API');
  assert.equal(runner.savePage, undefined);
  assert.deepEqual(statuses.map((status) => status.phase), ['running', 'running', 'complete']);
});

test('duplicate preview pages retain richer metadata before selection', async () => {
  const rich = { ...issue(1), mu: '2026-02-01', digitalId: 42, hydrated: true };
  const runner = new ComicSearchRunner({
    load: async (_item, { onPage }) => {
      await onPage([rich], { loaded: 1, total: 2 });
      await onPage([{ issueId: 1, title: rich.title, hydrated: false }], { loaded: 2, total: 2 });
    },
  });
  const result = await runner.start({ name: 'Repeated comic' });
  assert.equal(result.phase, 'complete');
  assert.deepEqual(result.items, [normalizeIssue(rich)]);
});

test('cancel retires immediately and stale preview work cannot mutate its replacement', async () => {
  const api = controlledPages();
  const statuses = [];
  const runner = new ComicSearchRunner({
    load: api.load,
    onStatus: (status) => statuses.push(status),
  });

  const first = runner.start({ id: 1, name: 'First', issueCount: 3 });
  await api.runs[0].page([issue(1)], 3);
  const cancelled = runner.cancel();

  assert.equal(cancelled.phase, 'cancelled');
  assert.deepEqual(cancelled.items.map((item) => item.issueId), [1]);
  assert.equal(runner.active, false, 'Cancel waited for the old transport to settle');

  const second = runner.start({ id: 2, name: 'Second', issueCount: 1 });
  assert.equal(runner.active, true, 'the replacement did not start immediately');
  const replacement = runner.current;

  await api.runs[0].page([issue(2)], 3);
  api.runs[0].finish();
  await first;
  assert.equal(runner.current, replacement, 'old teardown cleared replacement ownership');

  await api.runs[1].page([issue(9)], 1);
  api.runs[1].finish();
  const completed = await second;

  assert.deepEqual(completed.items.map((item) => item.issueId), [9]);
  assert.equal(completed.phase, 'complete');
  assert.equal(statuses.at(-1).item.name, 'Second', 'old status replaced the new run');
});

test('zero-page cancellation and partial failures remain distinct read-only previews', async () => {
  const zeroApi = controlledPages();
  const zeroStatuses = [];
  const zero = new ComicSearchRunner({
    load: zeroApi.load,
    onStatus: (status) => zeroStatuses.push(status),
  });
  const zeroPending = zero.start({ id: 1, name: 'Zero' });
  zero.cancel();
  zeroApi.runs[0].finish();
  const cancelled = await zeroPending;

  assert.equal(cancelled.phase, 'cancelled');
  assert.deepEqual(cancelled.items, []);
  assert.equal(zeroStatuses.at(-1).phase, 'cancelled');

  const failedApi = controlledPages();
  const failedStatuses = [];
  const failed = new ComicSearchRunner({
    load: failedApi.load,
    onStatus: (status) => failedStatuses.push(status),
  });
  const failedPending = failed.start({ id: 2, name: 'Failed' });
  await failedApi.runs[0].page([issue(2)], 3);
  failedApi.runs[0].fail(new TypeError('offline'));
  const failure = await failedPending;

  assert.equal(failure.phase, 'failed');
  assert.deepEqual(failure.items.map((item) => item.issueId), [2]);
  assert.equal(failedStatuses.at(-1).phase, 'failed');
});

test('a provider that stops short cannot label a partial preview complete', async () => {
  const runner = new ComicSearchRunner({
    load: async (_item, { onPage }) => {
      await onPage([issue(1)], { loaded: 1, total: 2 });
    },
  });

  const result = await runner.start({ id: 1, name: 'No room' });

  assert.equal(result.phase, 'failed');
  assert.equal(result.received, 1);
  assert.deepEqual(result.items.map((item) => item.issueId), [1]);
  assert.match(result.error.message, /before every comic loaded/);
});

test('plain issue searches use the same preview normalization and refuse invalid IDs', async () => {
  const runner = new ComicSearchRunner({ load: async () => [issue(2), issue(1)] });
  const result = await runner.start({ name: 'Issues' });
  assert.equal(result.phase, 'complete');
  assert.deepEqual(result.items.map((item) => item.issueId), [1, 2]);
  const invalid = new ComicSearchRunner({ load: async () => [{ issueId: 0 }] });
  const failed = await invalid.start({ name: 'Invalid' });
  assert.equal(failed.phase, 'failed');
  assert.match(failed.error.message, /valid issue ID/);
});

test('all search surfaces share selection controls rather than immediate Add actions', () => {
  assert.match(add, /const selected = new Map\(\)/);
  assert.match(add, /config\.runner = new ComicSearchRunner/);
  assert.match(add, /label: `Cancel \$\{config\.kind\} search`/);
  assert.match(add, /if \(focusedCancel\) \$\(config\.input\)\.focus/);
  assert.match(add, /if \(config\.epoch !== epoch\) return/);
  assert.match(add, /matched === 1 && items\.length === 1/);
  assert.match(add, /beforeunload/);
  assert.doesNotMatch(add, /savePage|onAdd|addToActive|LongAddRunner|Add all issues/);
});

test('the Add hub groups five routes with five dedicated pages', () => {
  assert.deepEqual(ADD_VIEWS, ['add-search', 'add-series', 'add-creator', 'add-import', 'add-manual']);
  const hub = page('add');
  for (const view of ADD_VIEWS) {
    assert.ok(VIEWS.includes(view), `${view} is showable but not routable`);
    assert.match(pages.get(view), new RegExp(`<h1 id="${view}-h">`), `${view} has no page heading`);
    assert.match(hub, new RegExp(`data-view="${view}"`), `${view} has no Add hub choice`);
  }
  assert.match(html, /class="ri" data-view="add"/, 'the rail has no Add hub entry');
  assert.match(html, /class="ri" data-view="add"[\s\S]*?<span class="lbl">Add comics<\/span>/);
  assert.match(hub, /<h1 id="add-h">Add comics<\/h1>/);
});

test('search uses selection while manual and curated Add labels stay intact', () => {
  assert.match(catalogPresentation, /const CATALOG_ADD = '\+ Add to library'/);
  assert.match(allPages, />Add issue<\/button>/);
  assert.match(add, /\}, 'Browse comics'\)/);
  assert.match(add, /textContent = `Select all \$\{comics\(matches\.length\)\}`/);
});

test('the Add address opens the hub while old child addresses stay valid', () => {
  assert.equal(VIEWS.includes('add'), true);
  assert.equal(LEGACY_VIEW_ALIASES.add, undefined);
  assert.deepEqual(parseRoute('#/add'), { view: 'add', listId: null, filter: null, full: false });
  assert.equal(formatRoute({ view: 'add' }), '#/add');
  for (const view of ADD_VIEWS) {
    assert.deepEqual(parseRoute(`#/${view}`), { view, listId: null, filter: null, full: false });
  }
});

test('series and creator indexes warm when their pages open by any route', () => {
  assert.match(
    main,
    /view = next;\s*addView\.enter\(next\);/,
    'view entry no longer starts the relevant name index',
  );
  assert.match(
    add,
    /function enter\(name\)[\s\S]*name === 'add-series' \? 'series' : name === 'add-creator' \? 'creators'/,
    'the two name-search pages no longer map to their indexes',
  );
  assert.doesNotMatch(
    add,
    /addEventListener\('(pointerenter|focusin)', warm/,
    'index warming still depends on pointer or focus entry',
  );
});


test('the manual page keeps the 2025 boundary in one compact sentence', () => {
  const manual = prose(pages.get('add-manual'));
  assert.match(manual, /\b2025\b/i, 'the hand-entry card no longer names the 2025 boundary');
  assert.match(
    manual,
    /missing from search[^.]*post-2025|post-2025[^.]*missing from search/i,
    'the hand-entry card no longer says search misses issues beyond the snapshot',
  );
  assert.match(manual, /still track/i, 'the hand-entry card no longer says a hand entry still tracks');
  assert.match(
    manual,
    /availability[^.]*unknown|unknown[^.]*availability/i,
    'the hand-entry card no longer says a newer hand entry keeps unknown availability',
  );
});

test('the manual lookup names Marvel Fandom and keeps its privacy detail behind a disclosure', () => {
  const hintMatch = pages.get('add-manual').match(
    /<button[^>]*id="btn-manual-lookup"[^>]*>Look up on Marvel Fandom<\/button>\s*<details class="field-disclosure">\s*<summary>What lookup sends<\/summary>\s*<p class="rail-hint">([\s\S]*?)<\/p>\s*<\/details>\s*<div id="manual-candidates" class="results"><\/div>/,
  );
  assert.ok(hintMatch, 'the manual lookup privacy detail is no longer behind its disclosure');
  const hint = prose(hintMatch[1]);
  assert.match(
    hint,
    /only the title[^.]*sent to Marvel Fandom/i,
    'the lookup detail no longer says the typed title goes to Marvel Fandom',
  );
  assert.match(
    hint,
    /community site[^.]*Marvel does not run/i,
    'the lookup hint no longer says the wiki is a community site Marvel does not run',
  );
  assert.match(
    hint,
    /lists[^.]*progress[^.]*stay here/i,
    'the lookup hint no longer says lists and reading progress stay out of the request',
  );
});

test('only paste and manual entry imply an active destination before an explicit save', () => {
  for (const [view, source] of pages) {
    assert.doesNotMatch(source, /<div class="sub add-target">/, `${view} still repeats its destination in the header`);
    if (view === 'add-import' || view === 'add-manual') {
      assert.match(
        source,
        /<section class="card card-static addpri add-page"[^>]*>\s*<p class="add-destination add-target"><\/p>/,
        `${view} lost its existing destination`,
      );
    } else {
      assert.doesNotMatch(source, /\badd-target\b/, `${view} still implies an automatic destination`);
      assert.doesNotMatch(source, /comic-search-hint/);
      assert.match(source, /aria-describedby="(?:search|series|creator)-help"/);
      assert.match(source, /class="visually-hidden">Select comics/);
    }
  }
  assert.match(add, /Adding to: \$\{target\.name\}/, 'the compact destination no longer names the current list');
  assert.doesNotMatch(
    add,
    /already in your library\. \$\{destination\}/,
    'search summaries still repeat the destination below the card badge',
  );
});

test('the five Add pages reserve primary styling for paste and manual saves', () => {
  const worded = allPages.match(/class="btn"/g) ?? [];
  const searches = allPages.match(/class="btn btn-g btn-icon[^"]*"/g) ?? [];
  assert.equal(worded.length, 2);
  assert.equal(searches.length, 3, 'the three search submits are secondary icon-only controls');
});

test('every icon-only search button carries a name, tooltip and accessible description', () => {
  const buttons = allPages.match(/<button[^>]*class="btn btn-g btn-icon[^"]*"[^>]*>/g) ?? [];
  assert.equal(buttons.length, 3);
  for (const button of buttons) {
    assert.match(button, /class="[^"]*\bhas-tooltip\b/, `no tooltip hook on ${button}`);
    assert.match(button, /data-tooltip="[^"]+"/, `no tooltip on ${button}`);
    assert.doesNotMatch(button, /\btitle="/, `native title remains on ${button}`);
    assert.match(button, /aria-label="[^"]+"/, `no accessible name on ${button}`);
    assert.match(button, /aria-describedby="[^"]+"/, `no accessible description on ${button}`);
  }
});

test('each Add page starts at h1 and skips no heading level', () => {
  for (const [view, source] of pages) {
    const levels = [...source.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
    assert.equal(levels[0], 1, `${view} does not start at h1`);
    for (let i = 1; i < levels.length; i += 1) {
      assert.ok(levels[i] <= levels[i - 1] + 1, `${view} skips from h${levels[i - 1]} to h${levels[i]}`);
    }
  }
});

test('the paste page shows both Markdown states and explains them in the example', () => {
  const source = prose(pages.get('add-import'));
  assert.match(source, /- \[ \]/, 'the example has no unread checklist line');
  assert.match(source, /- \[x\]/i, 'the example has no already-read checklist line');
  assert.match(source, /\[x\] = already read/i, 'the ticked state is not explained');
  assert.match(source, /links are optional/i, 'the example makes links look required');
});

test('the optional reader address is behind a disclosure on the manual page', () => {
  const source = pages.get('add-manual');
  assert.match(
    source,
    /<details class="field-disclosure">[\s\S]*?<summary>Add a reader link \(optional\)<\/summary>[\s\S]*?id="manual-url"/,
    'the address field is standing open or its disclosure lost its label',
  );
});

test('every repeated Add view row action keeps the paired grey secondary classes', () => {
  // `btn-g` changes colours only. The base `btn` carries the padding, radius, inline-flex layout and
  // 44 pixel target, so writing `btn-g` on its own silently drops the button shape while still
  // looking plausibly styled in a code review.
  const sites = [
    [
      'select-all comics button',
      /const selectAll = el\('button', \{\s*type: 'button', class: 'btn btn-g(?: [^']*)?'/,
    ],
    [
      'show-more comics button',
      /const more = el\('button', \{ type: 'button', class: 'btn btn-g'/,
    ],
    [
      'creator and series Browse comics button',
      /function wireNameSearch[\s\S]*?class: 'btn btn-g'[\s\S]*?\}, 'Browse comics'\)/,
    ],
    [
      'unresolvedRow This one button',
      /function unresolvedRow[\s\S]*?type: 'button', class: 'btn btn-g'[\s\S]*?\}, 'This one'\)/,
    ],
    [
      'doManualLookup Use this button',
      /async function doManualLookup[\s\S]*?el\('button', \{[\s\S]*?class: 'btn btn-g',[\s\S]*?onclick: \(\) => acceptManualMatch\(candidate\),[\s\S]*?\}, 'Use this'\)/,
    ],
  ];
  for (const [site, rx] of sites) assert.match(add, rx, `${site} no longer uses the paired grey button classes`);
});

test('composition constructs one Add boundary and delegates its lifecycle', () => {
  assert.equal((main.match(/createAddView\(\{/g) ?? []).length, 1);
  for (const method of ['enter', 'renderDestination', 'wire']) {
    assert.equal(
      (main.match(new RegExp(`addView\\.${method}\\(`, 'g')) ?? []).length,
      1,
      `main must delegate Add ${method} exactly once`,
    );
  }
  assert.doesNotMatch(main, /function (renderResults|doImport|unresolvedRow|doManual)\(/);
  assert.doesNotMatch(
    add,
    /from ['"](?:\.\.\/(?:api|cache|hydrate|main|storage|synopsis)\.js|\.\.\/lib\/limiter\.js|\.\/)/,
    'Add must receive controller services and sibling views through composition',
  );
  for (const owner of ['Store', 'MarvelApi', 'ResponseCache', 'RateLimiter', 'Hydrator', 'SynopsisRunner']) {
    assert.match(main, new RegExp(`new ${owner}\\(`), `${owner} construction left main`);
    assert.doesNotMatch(add, new RegExp(`new ${owner}\\(`), `${owner} construction moved into Add`);
  }

  const warmed = [];
  const view = createAddView({
    search: {
      creatorIssues() {},
      seriesIssues() {},
    },
    warmNameIndex: (kind) => warmed.push(kind),
  });
  assert.deepEqual(
    Object.keys(view).sort(),
    ['enter', 'renderDestination', 'wire'],
  );
  view.enter('add-series');
  view.enter('add-creator');
  view.enter('add-import');
  assert.deepEqual(warmed, ['series', 'creators']);
});
