import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const html = read('src/index.html');
const main = read('src/js/main.js');

// These guards need the Add view, not a sentence that happens to match somewhere else in the page.
// Slicing between the view roots is what keeps a future copy edit in another screen from satisfying
// an Add view rule by accident.
function between(text, startsWith, endsWith) {
  const from = text.indexOf(startsWith);
  assert.notEqual(from, -1, `the source must still carry ${startsWith}`);
  const to = text.indexOf(endsWith, from + startsWith.length);
  assert.notEqual(to, -1, `${startsWith} must still be followed by ${endsWith}`);
  return text.slice(from, to);
}

function prose(text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const addView = between(
  html,
  '<section id="view-add" class="view" hidden aria-labelledby="add-h">',
  '<section id="view-data" class="view" hidden aria-labelledby="data-h">',
);

function addSectionTag(id) {
  const rx = new RegExp(`<([a-z]+)\\b[^>]*id="${escapeRegExp(id)}"[^>]*>`, 'i');
  const match = addView.match(rx);
  assert.ok(match, `the Add view no longer contains #${id}`);
  return match[1].toLowerCase();
}

function disclosureBlock(id) {
  return between(addView, `<details class="card" id="${id}">`, '</details>');
}

function summaryBlock(id) {
  return between(disclosureBlock(id), '<summary>', '</summary>');
}

test('the Add view still says the metadata snapshot ends in 2025 and search cannot find newer issues', () => {
  const manual = prose(disclosureBlock('sec-manual'));
  assert.match(manual, /\b2025\b/i, 'the hand-entry card no longer names the 2025 boundary');
  assert.match(
    manual,
    /(?:newer|anything newer|very recent issues?)[^.]*not be found by search|search cannot reach/i,
    'the hand-entry card no longer says search misses issues beyond the snapshot',
  );
  assert.match(manual, /still tracks/i, 'the hand-entry card no longer says a hand entry still tracks');
  assert.match(
    manual,
    /availability[^.]*unknown|unknown[^.]*availability/i,
    'the hand-entry card no longer says a newer hand entry keeps unknown availability',
  );
});

test('the manual lookup control still says the title goes to the wiki and your progress does not', () => {
  const hintMatch = addView.match(
    /<button[^>]*id="btn-manual-lookup"[^>]*>Look up details<\/button>\s*<p class="rail-hint">([\s\S]*?)<\/p>\s*<div id="manual-candidates" class="results"><\/div>/,
  );
  assert.ok(hintMatch, 'the manual lookup hint is no longer beside the Look up details control');
  const hint = prose(hintMatch[1]);
  assert.match(hint, /nothing happens until you press/i, 'the lookup hint no longer says the request waits for a press');
  assert.match(
    hint,
    /sends?[^.]*words[^.]*Title box[^.]*Marvel Fandom wiki/i,
    'the lookup hint no longer says the typed title goes to the Marvel Fandom wiki',
  );
  assert.match(
    hint,
    /community site[^.]*Marvel does not run/i,
    'the lookup hint no longer says the wiki is a community site Marvel does not run',
  );
  assert.match(
    hint,
    /nothing about your lists or your reading progress goes with it/i,
    'the lookup hint no longer says lists and reading progress stay out of the request',
  );
});

test('the Add view keeps exactly five primary buttons in its own markup', () => {
  // The primary rule is about buttons whose whole class attribute is exactly `btn`, or exactly
  // `btn btn-icon` for the three that submit a search field. A word-boundary search would count
  // `class="btn btn-g"` as well, which is how a guard on this very rule would have reported six
  // buttons while the intended count was five.
  const worded = addView.match(/class="btn"/g) ?? [];
  const iconOnly = addView.match(/class="btn btn-icon"/g) ?? [];
  assert.equal(worded.length + iconOnly.length, 5);
  assert.equal(iconOnly.length, 3, 'the three search submits are the icon-only ones');
});

test('every icon-only primary button carries a name and a tooltip', () => {
  // An icon-only control has no visible text to fall back on, so the glyph is hidden from the
  // accessibility tree and the name has to be stated. The tooltip is what the sighted user gets.
  const buttons = addView.match(/<button[^>]*class="btn btn-icon"[^>]*>/g) ?? [];
  assert.equal(buttons.length, 3);
  for (const button of buttons) {
    assert.match(button, /title="Search"/, `no tooltip on ${button}`);
    assert.match(button, /aria-label="[^"]+"/, `no accessible name on ${button}`);
  }
});

test('the Add view heading levels stay 1, 2, 2, 3, 3, 3, 3 with no skipped level', () => {
  const levels = [...addView.matchAll(/<h([1-6])\b/g)].map((m) => Number(m[1]));
  assert.deepEqual(levels, [1, 2, 2, 3, 3, 3, 3], 'the Add view heading order changed');
  const skipped = [];
  for (let i = 1; i < levels.length; i += 1) {
    if (levels[i] > levels[i - 1] + 1) skipped.push(`${levels[i - 1]} to ${levels[i]}`);
  }
  assert.deepEqual(skipped, [], `the Add view skips heading levels: ${skipped.join(', ')}`);
});

test('the Add view keeps search open and the four other add paths collapsible', () => {
  assert.equal(addSectionTag('sec-search'), 'section', 'the search path became a disclosure again');
  for (const id of ['sec-series', 'sec-creator', 'sec-import', 'sec-manual']) {
    assert.equal(addSectionTag(id), 'details', `${id} is no longer a collapsible disclosure`);
  }
});

test('each secondary disclosure says why it exists inside its summary', () => {
  // The purpose line belongs in the summary because a closed details hides the rest of the card. In
  // that position it joins the accessible name, so a reader using a screen reader hears the same
  // reason a sighted reader sees before opening the card.
  for (const id of ['sec-series', 'sec-creator', 'sec-import', 'sec-manual']) {
    const summary = summaryBlock(id);
    const why = summary.match(/<span class="card-why">([\s\S]*?)<\/span>/);
    assert.ok(why, `${id} no longer carries a card-why line inside its summary`);
    assert.ok(prose(why[1]).length > 0, `${id} carries an empty card-why line`);
  }
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
