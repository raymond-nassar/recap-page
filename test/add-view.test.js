import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ADD_VIEWS, LEGACY_VIEW_ALIASES, VIEWS, formatRoute, parseRoute,
} from '../src/js/lib/route.js';

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

test('the Add hub groups five routes with five dedicated pages', () => {
  assert.deepEqual(ADD_VIEWS, ['add-search', 'add-series', 'add-creator', 'add-import', 'add-manual']);
  const hub = page('add');
  for (const view of ADD_VIEWS) {
    assert.ok(VIEWS.includes(view), `${view} is showable but not routable`);
    assert.match(pages.get(view), new RegExp(`<h1 id="${view}-h">`), `${view} has no page heading`);
    assert.match(hub, new RegExp(`data-view="${view}"`), `${view} has no Add hub choice`);
  }
  assert.match(html, /class="ri" data-view="add"/, 'the rail has no Add hub entry');
});

test('the Add address opens the hub while old child addresses stay valid', () => {
  assert.equal(VIEWS.includes('add'), true);
  assert.equal(LEGACY_VIEW_ALIASES.add, undefined);
  assert.deepEqual(parseRoute('#/add'), { view: 'add', listId: null, filter: null });
  assert.equal(formatRoute({ view: 'add' }), '#/add');
  for (const view of ADD_VIEWS) {
    assert.deepEqual(parseRoute(`#/${view}`), { view, listId: null, filter: null });
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
  const iconOnly = allPages.match(/class="btn btn-icon"/g) ?? [];
  assert.equal(worded.length + iconOnly.length, 5);
  assert.equal(iconOnly.length, 3, 'the three search submits are the icon-only ones');
});

test('every icon-only primary button carries a name and a tooltip', () => {
  const buttons = allPages.match(/<button[^>]*class="btn btn-icon"[^>]*>/g) ?? [];
  assert.equal(buttons.length, 3);
  for (const button of buttons) {
    assert.match(button, /title="Search"/, `no tooltip on ${button}`);
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
