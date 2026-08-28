import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADD_VIEWS, LEGACY_VIEW_ALIASES, VIEWS, formatRoute, parseRoute,
} from '../src/js/lib/route.js';
import { addIssuesToList, createEmptyState, createList } from '../src/js/lib/model.js';
import {
  LongAddRunner, longAddStatusLine, mergeLongAddPage, persistLongAddPage,
} from '../src/js/main.js';
import { KEY, Store } from '../src/js/storage.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const html = read('src/index.html');
const main = read('src/js/main.js');

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

test('pagewise long adds preserve existing order and sort only issues owned by the run', () => {
  const { state: initial, listId } = listState([90, 91]);
  let context = { listId, insertAt: 2, ownedIds: [] };

  const first = mergeLongAddPage(initial, context, [issue(4), issue(2)]);
  context = first.context;
  const second = mergeLongAddPage(first.state, context, [issue(3), issue(1), issue(2)]);

  assert.deepEqual(second.state.lists[listId].itemIds, [90, 91, 1, 2, 3, 4]);
  assert.deepEqual(second.context.ownedIds, [1, 2, 3, 4]);
  assert.deepEqual(
    { firstAdded: first.added, secondAdded: second.added, secondSkipped: second.skipped },
    { firstAdded: 2, secondAdded: 2, secondSkipped: 1 },
  );
});

test('a refused first page rolls list creation and the page back together', () => {
  const saved = new Map();
  let writes = 0;
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

  const result = persistLongAddPage(
    store,
    [issue(1)],
    { listId: null, insertAt: 0, ownedIds: [], transition: null },
  );

  assert.equal(writes, 1, 'first-page setup and merge were split across writes');
  assert.equal(store.state.listOrder.length, 0, 'a failed first page left an empty list behind');
  assert.equal(saved.has(KEY), false, 'a failed first page left an empty list on disk');
  assert.equal(result.ok, false);
  assert.equal(result.context.listId, null, 'failed setup escaped into the run context');
});

test('a long add completes with persisted-page counts distinct from received counts', async () => {
  const api = controlledPages();
  const saved = [];
  const statuses = [];
  const runner = new LongAddRunner({
    load: api.load,
    savePage(items, context) {
      saved.push(items.map((item) => item.issueId));
      return { ok: true, added: items.length, skipped: 0, context };
    },
    onStatus: (status) => statuses.push(status),
  });

  const pending = runner.start({ id: 1, name: 'Complete', issueCount: 2 });
  await api.runs[0].page([issue(2), issue(1)], 2);
  api.runs[0].finish();
  const result = await pending;

  assert.deepEqual(saved, [[2, 1]]);
  assert.equal(result.phase, 'complete');
  assert.deepEqual(
    { received: result.received, persisted: result.persisted, pages: result.pages, added: result.added },
    { received: 2, persisted: 2, pages: 1, added: 2 },
  );
  assert.deepEqual(statuses.map((status) => status.phase), ['running', 'running', 'complete']);
});

test('cancel retires immediately and stale work cannot mutate or tear down its replacement', async () => {
  const api = controlledPages();
  const saved = [];
  const statuses = [];
  const runner = new LongAddRunner({
    load: api.load,
    savePage(items, context) {
      saved.push({ run: context.run, ids: items.map((item) => item.issueId) });
      return { ok: true, added: items.length, skipped: 0, context };
    },
    onStatus: (status) => statuses.push(status),
  });

  const first = runner.start({ id: 1, name: 'First', issueCount: 3 }, { run: 'first' });
  await api.runs[0].page([issue(1)], 3);
  const cancelled = runner.cancel();

  assert.equal(cancelled.phase, 'cancelled');
  assert.equal(cancelled.persisted, 1);
  assert.equal(runner.active, false, 'Cancel waited for the old transport to settle');

  const second = runner.start({ id: 2, name: 'Second', issueCount: 1 }, { run: 'second' });
  assert.equal(runner.active, true, 'the replacement did not start immediately');
  const replacement = runner.current;

  await api.runs[0].page([issue(2)], 3);
  api.runs[0].finish();
  await first;
  assert.equal(runner.current, replacement, 'old teardown cleared replacement ownership');

  await api.runs[1].page([issue(9)], 1);
  api.runs[1].finish();
  const completed = await second;

  assert.deepEqual(saved, [
    { run: 'first', ids: [1] },
    { run: 'second', ids: [9] },
  ]);
  assert.equal(completed.phase, 'complete');
  assert.equal(statuses.at(-1).item.name, 'Second', 'old status replaced the new run');
});

test('zero-page cancellation and failures remain distinct terminal outcomes', async () => {
  const zeroApi = controlledPages();
  const zeroStatuses = [];
  const zero = new LongAddRunner({
    load: zeroApi.load,
    savePage() {
      assert.fail('zero-page cancellation attempted a save');
    },
    onStatus: (status) => zeroStatuses.push(status),
  });
  const zeroPending = zero.start({ id: 1, name: 'Zero' });
  zero.cancel();
  zeroApi.runs[0].finish();
  const cancelled = await zeroPending;

  assert.equal(cancelled.phase, 'cancelled');
  assert.equal(cancelled.persisted, 0);
  assert.equal(zeroStatuses.at(-1).phase, 'cancelled');

  const failedApi = controlledPages();
  const failedStatuses = [];
  const failed = new LongAddRunner({
    load: failedApi.load,
    savePage(items, context) {
      return { ok: true, added: items.length, skipped: 0, context };
    },
    onStatus: (status) => failedStatuses.push(status),
  });
  const failedPending = failed.start({ id: 2, name: 'Failed' });
  await failedApi.runs[0].page([issue(2)], 3);
  failedApi.runs[0].fail(new TypeError('offline'));
  const failure = await failedPending;

  assert.equal(failure.phase, 'failed');
  assert.equal(failure.persisted, 1);
  assert.equal(failedStatuses.at(-1).phase, 'failed');
});

test('a refused page write fails without counting that page as persisted', async () => {
  const statuses = [];
  const runner = new LongAddRunner({
    load: async (_item, { onPage }) => {
      await onPage([issue(1)], { loaded: 1, total: 2 });
    },
    savePage: () => ({ ok: false, error: 'Browser storage is full.' }),
    onStatus: (status) => statuses.push(status),
  });

  const result = await runner.start({ id: 1, name: 'No room' });

  assert.equal(result.phase, 'failed');
  assert.equal(result.error.name, 'SaveError');
  assert.equal(result.received, 1);
  assert.equal(result.persisted, 0);
  assert.equal(result.pages, 0);
  assert.equal(statuses.at(-1).phase, 'failed');
});

test('long-add status keeps cancellation, failure, and completion distinct', () => {
  const base = {
    item: { name: 'Fixture' },
    context: {},
    received: 2,
    persisted: 2,
    total: 4,
    pages: 1,
    added: 2,
    skipped: 0,
  };

  assert.equal(
    longAddStatusLine({ ...base, phase: 'cancelled' }, { name: 'Fixture', kind: 'series' }),
    'Fixture: stopped after 2 of 4 issues were saved. 2 added.',
  );
  assert.match(
    longAddStatusLine(
      { ...base, phase: 'failed', error: new TypeError('offline') },
      { name: 'Fixture', kind: 'series' },
    ),
    /^Fixture: loading failed\./,
  );
  assert.equal(
    longAddStatusLine({ ...base, phase: 'complete' }, { name: 'Fixture', kind: 'series' }),
    'Fixture: 2 issues added.',
  );
});

test('series and creator long adds use independent runners and active Cancel actions', () => {
  assert.match(main, /const seriesAddRunner = createLongAddRunner\(\{[\s\S]*?kind: 'series'[\s\S]*?input: '#series-q'/);
  assert.match(main, /const creatorAddRunner = createLongAddRunner\(\{[\s\S]*?kind: 'creator'[\s\S]*?input: '#creator-q'/);
  assert.match(main, /running \? \{ label: `Cancel \$\{config\.kind\} import`, onClick: \(\) => runner\.cancel\(\) \} : null/);
  assert.match(main, /else if \(!running && focusedCancel\) \{\s*\$\(config\.input\)\?\.focus\(\{ preventScroll: true \}\);/);
  assert.match(main, /if \(active\?\.\(\)\) \{[\s\S]*?Cancel the current \$\{kind === 'series' \? 'series' : 'creator'\} import before searching again\./);
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

test('the destination rename does not alter Add action labels', () => {
  assert.match(main, /const CATALOG_ADD = '\+ Add to library'/);
  assert.match(allPages, />Add issue<\/button>/);
  assert.match(main, /\}, 'Add all issues'\)/);
  assert.match(main, /\}, 'Add'\);/);
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
    /view = next;\s*warmNameIndexForView\(next\);/,
    'view entry no longer starts the relevant name index',
  );
  assert.match(
    main,
    /function warmNameIndexForView\(name\)[\s\S]*name === 'add-series' \? 'series' : name === 'add-creator' \? 'creators'/,
    'the two name-search pages no longer map to their indexes',
  );
  assert.doesNotMatch(
    main,
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

test('each Add destination sits inside its working card instead of the page header', () => {
  for (const [view, source] of pages) {
    assert.doesNotMatch(source, /<div class="sub add-target">/, `${view} still repeats its destination in the header`);
    assert.match(
      source,
      /<section class="card card-static addpri add-page"[^>]*>\s*<p class="add-destination add-target"><\/p>/,
      `${view} has no compact destination inside its working card`,
    );
  }
  assert.match(main, /Adding to: \$\{target\.name\}/, 'the compact destination no longer names the current list');
  assert.doesNotMatch(
    main,
    /already in your library\. \$\{destination\}/,
    'search summaries still repeat the destination below the card badge',
  );
});

test('the five Add pages keep exactly five primary buttons between them', () => {
  const worded = allPages.match(/class="btn"/g) ?? [];
  const iconOnly = allPages.match(/class="btn btn-icon[^"]*"/g) ?? [];
  assert.equal(worded.length + iconOnly.length, 5);
  assert.equal(iconOnly.length, 3, 'the three search submits are the icon-only ones');
});

test('every icon-only primary button carries a name and a tooltip', () => {
  const buttons = allPages.match(/<button[^>]*class="btn btn-icon[^"]*"[^>]*>/g) ?? [];
  assert.equal(buttons.length, 3);
  for (const button of buttons) {
    assert.match(button, /class="[^"]*\bhas-tooltip\b/, `no tooltip hook on ${button}`);
    assert.match(button, /data-tooltip="[^"]+"/, `no tooltip on ${button}`);
    assert.doesNotMatch(button, /\btitle="/, `native title remains on ${button}`);
    assert.match(button, /aria-label="[^"]+"/, `no accessible name on ${button}`);
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
      'renderResults row Add button',
      /function renderResults[\s\S]*?const btn = el\('button', \{ type: 'button', class: 'btn btn-g' \}, 'Add'\);/,
    ],
    [
      'series wireNameSearch button class',
      /wireNameSearch\(\{[\s\S]*?section: '#sec-series'[\s\S]*?btnClass: 'btn btn-g'/,
    ],
    [
      'creator wireNameSearch button class',
      /wireNameSearch\(\{[\s\S]*?section: '#sec-creator'[\s\S]*?btnClass: 'btn btn-g'/,
    ],
    [
      'unresolvedRow This one button',
      /function unresolvedRow[\s\S]*?type: 'button', class: 'btn btn-g'[\s\S]*?\}, 'This one'\)/,
    ],
    [
      'doManualLookup Use this button',
      /async function doManualLookup[\s\S]*?el\('button', \{ type: 'button', class: 'btn btn-g', onclick: \(\) => acceptManualMatch\(candidate\) \}, 'Use this'\)/,
    ],
  ];
  for (const [site, rx] of sites) assert.match(main, rx, `${site} no longer uses the paired grey button classes`);
});
