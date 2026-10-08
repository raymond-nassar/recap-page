// The active reading order is the screen the app exists for, and MRT-003 rebuilt how it looks
// without touching what it does. Everything asserted here is a decision that a later change could
// undo silently, because none of it has a behaviour a functional test would notice: a view that
// quietly goes back to the prose measure, a progress figure that retreats into a tooltip, a second
// full-weight button beside the primary one, or a shelf that starts clipping its last tile again
// would all leave 1216 passing tests behind them.
//
// These read the stylesheet and the markup as text, which is the same instrument test/theme.test.js
// uses, and for the same reason: a rule that paints only in a state no fixture reaches still has to
// be right.

import test from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (p) => readFileSync(join(here, '..', p), 'utf8');
const html = read('src/index.html');
const css = read('src/styles.css');
const main = read('src/js/main.js');
const reading = read('src/js/views/reading.js');

test('responsive read boxes allocate real nonoverlapping row space', () => {
  assert.match(css, /\.cb \{[^}]*width: 24px; height: 24px/);
  assert.match(css, /grid-template-columns: 44px 44px minmax\(0, 1fr\) auto/);
  assert.match(css, /\.row \.cb \{ width: 44px; height: 44px; \}/);
});

test('narrow hero prose and idle list commands use their available width', () => {
  assert.match(css, /#hero-title \{ clear: both; \}/);
  assert.match(css, /\.list-tools \{[^}]*margin-bottom: var\(--space-4\)/);
  assert.match(css, /\.list-actions > summary \{[^}]*min-height: 44px/);
});

test('native list actions start closed and retain completion and pending controls with focus before close', () => {
  assert.match(html, /<details id="list-actions" class="list-actions action-disclosure">/);
  const opener = html.indexOf('<details id="list-actions"');
  assert.ok(opener >= 0, 'outer List actions opener is missing');
  let depth = 0;
  let end = null;
  for (const match of html.slice(opener).matchAll(/<\/?details\b[^>]*>/g)) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) {
      end = opener + match.index + match[0].length;
      break;
    }
  }
  assert.ok(end !== null, 'balanced outer List actions closer is missing');
  const editing = html.slice(opener, end);
  assert.match(editing, /<details id="list-export">/);
  assert.doesNotMatch(editing, /id="(?:hydration-status|synopsis-status|btn-cancel-hydrate|btn-cancel-synopsis)"/);
  assert.match(reading, /summary\.focus\(\);\s*details\.open = false/);
  assert.doesNotMatch(reading, /details\.open = !narrow/);
});

test('page titles use ordinary focus-visible rather than a forced navigation box', () => {
  assert.match(css, /:focus-visible \{\s*outline: 3px solid var\(--blue\)/);
  assert.doesNotMatch(css, /\.view h1\[tabindex="-1"\]:focus(?!-visible)/);
  assert.match(main, /heading\.setAttribute\('tabindex', '-1'\);\s*heading\.focus/);
});

test('mobile navigation reserves measured content space and cannot cover active forms or dialogs', () => {
  assert.match(html, /<a href="#\/data"[^>]*id="save-education-settings"/);
  assert.match(reading, /isPlainNavigation\(event\)[\s\S]*showView\('data', \{ push: true \}\)/);
  assert.match(css, /main \{ padding-bottom: calc\(var\(--mobile-nav-height, 80px\)/);
  assert.match(css, /scroll-padding-bottom: calc\(var\(--mobile-nav-height, 80px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /body:has\(dialog\[open\]\) \.rail-header \{ visibility: hidden; \}/);
  assert.match(main, /new ResizeObserver/);
  assert.match(main, /visualViewport\.height < window\.innerHeight \* 0\.75/);
  assert.match(main, /hide \|\| editable\(\) \|\| obscuredViewport\(\)/);
  assert.doesNotMatch(main.slice(main.indexOf('function wireMobileNavigation'), main.indexOf('let tooltips;')),
    /localStorage|store\.update|history\./);
});
test('the reading view opts out of the prose measure, so a desktop is used rather than margined', () => {
  // BL-165 capped every view at the reading measure and gave home an opt-out because a catalog is a
  // grid. The reading view is the same kind of surface and was measured at 876px on a 2560 display
  // with the rest of the width left as margin.
  const view = html.match(/<section id="view-read"[^>]*>/);
  assert.ok(view, 'the reading view is gone from the markup');
  assert.match(view[0], /class="view view-wide"/);
  assert.match(css, /\.view\.view-wide \{ max-width: none; \}/);
});

test('the progress figure is on the screen rather than inside a tooltip', () => {
  // The percentage used to exist only as a `title` on the ring, which neither a touch user nor a
  // keyboard user can open, so the readable statement of progress was the bare count.
  assert.match(html, /id="ring-label"/);
  assert.match(html, /id="ring-sub"/);
  assert.match(reading, /\$\('#ring-sub'\)\.textContent/);
  assert.equal(/#ring-wrap'\)\.setAttribute\('title'/.test(main), false, 'the percentage is back in a tooltip');
});

test('the ring geometry in the markup and the constant in the renderer agree', () => {
  // The dash array is the circumference of the circle it is drawn on. They are written in two
  // files, so the only thing keeping them in step is this.
  const r = Number(html.match(/class="ring-arc"[^>]*\br="(\d+)"/)[1]);
  const dash = Number(html.match(/stroke-dasharray="([\d.]+)"/)[1]);
  const constant = Number(reading.match(/export const RING_CIRCUMFERENCE = ([\d.]+);/)[1]);
  assert.equal(dash, constant, 'the markup and the renderer disagree about the circumference');
  assert.ok(Math.abs(dash - 2 * Math.PI * r) < 0.05, `${dash} is not the circumference of a circle of radius ${r}`);
});

test('the hero offers one dominant action, and the way out of the app is a link', () => {
  // Three controls of near-equal weight is the same as none, and the issue page is not an action
  // the app performs. Its element is still an anchor either way; this is about what it looks like.
  const hero = html.match(/<section class="hero" id="hero"[\s\S]*?\n {14}<\/section>/)[0];
  const cta = hero.match(/<div class="cta" id="hero-primary-actions">[\s\S]*?<\/div>/)[0];
  assert.match(cta, /class="btn btn-lg[^"]*" id="btn-hero-read"/);
  assert.match(cta, /class="btn btn-g[^"]*" id="btn-hero-done"/);
  assert.doesNotMatch(cta, /id="btn-hero-(inspect|defer|info)"/);
  assert.match(hero, /class="btn btn-link" id="btn-hero-inspect">About this comic/);
  const secondary = hero.match(/<details[^>]*id="hero-more-actions"[\s\S]*?<\/details>/)[0];
  assert.match(secondary, /class="btn btn-link" id="btn-hero-info"/);
  assert.match(secondary, /id="btn-hero-defer"/);
  assert.equal((cta.match(/btn-lg/g) || []).length, 1, 'more than one call to action carries the dominant treatment');
});

test('reading shortcuts stay discoverable without permanent keycap clutter', () => {
  const hero = html.match(/<section class="hero" id="hero"[\s\S]*?\n {14}<\/section>/)[0];
  const cta = hero.match(/<div class="cta" id="hero-primary-actions">[\s\S]*?<\/div>/)[0];
  assert.doesNotMatch(cta, /<kbd>/, 'a shortcut keycap is still always visible on a reading action');
  for (const [id, tooltip, ariaKey] of [
    ['btn-hero-read', 'Keyboard shortcut: Enter', 'Enter'],
    ['btn-hero-done', 'Mark read and continue. Keyboard shortcut: D', 'd'],
  ]) {
    const button = cta.match(new RegExp(`<button[^>]*id="${id}"[^>]*>`))?.[0] ?? '';
    assert.match(button, /class="[^"]*\bhas-tooltip\b/, `${id} has no tooltip hook`);
    assert.ok(button.includes(`data-tooltip="${tooltip}"`), `${id} has no visible action and shortcut tooltip`);
    assert.match(button, new RegExp(`aria-keyshortcuts="${ariaKey}"`), `${id} does not expose its shortcut accessibly`);
  }
  assert.match(html, /id="action-tip" hidden aria-hidden="true"/);
  assert.match(main, /wireTooltips\(/);
  const settings = html.match(/<h3>Keyboard shortcuts<\/h3>[\s\S]*?<\/table>/)?.[0] ?? '';
  assert.equal((settings.match(/<tr>/g) ?? []).length, 3, 'the Settings shortcut reference changed');
});

test('icon-only controls expose their meaning on hover and keyboard focus', () => {
  const toggle = html.match(/<button[^>]*id="btn-rail-toggle"[^>]*>/)?.[0] ?? '';
  assert.match(toggle, /data-tip="Collapse sidebar · Ctrl\+\\"/);
  assert.match(toggle, /aria-keyshortcuts="Control\+\\"/);
  assert.doesNotMatch(main, /toggle\.title\s*=/, 'the sidebar shortcut still relies on a native title');
  assert.match(main, /closest\('\.ri, \.brand, \.pill, \.rail-toggle'\)/);

  for (const id of ['form-search', 'form-series', 'form-creator']) {
    const form = html.match(new RegExp(`<form id="${id}"[\\s\\S]*?<\\/form>`))?.[0] ?? '';
    assert.match(form, /class="btn btn-g btn-icon has-tooltip"/, `${id} has no styled secondary tooltip`);
    assert.match(form, /data-tooltip="[^"]+"/, `${id} has no visual tooltip text`);
    assert.doesNotMatch(form, /\btitle="/, `${id} still relies on a native title`);
  }

  assert.match(reading, /class: 'cb has-tooltip'/);
  for (const tooltip of [
    'Open issue page on marvel.com',
    'Move up',
    'Move down',
    'Remove from list',
  ]) {
    assert.ok(reading.includes(`tooltip: '${tooltip}'`), `the row controls are missing the ${tooltip} tooltip`);
  }
  assert.match(reading, /tooltip: label/);
});

test('reading rows use a labeled disclosure at every width instead of hover-only commands', () => {
  assert.match(reading, /class: 'row-actions'/);
  assert.match(reading, /class: 'mini row-actions-toggle'[\s\S]*text: 'More actions'/);
  assert.match(reading, /'aria-expanded': 'false'/);
  assert.match(reading, /'aria-controls': panelId/);
  assert.match(reading, /'aria-label': `More actions for \$\{item\.title\}`/);
  assert.match(reading, /text: 'More actions', dataset: \{ key: item\.issueId, act: 'more' \}/);
  assert.match(reading, /setOpen\(false\);\s*focusRemovalTarget\(toggle, \{ avoidFilters: true \}\)/);
  assert.match(reading, /filters\.getBoundingClientRect\(\)/);
  assert.match(reading, /top: top - filterBounds\.bottom, left: 0, behavior: 'instant'/);
  for (const label of ['Move up', 'Move down', 'Remove from list']) {
    assert.ok(reading.includes(`class: 'mini-label', text: '${label}'`), `the mobile actions are missing ${label}`);
  }
  for (const label of ['Mark as available', 'Mark as unavailable', 'Clear availability override']) {
    assert.ok(reading.includes(`'${label}'`), `the explicit availability actions are missing ${label}`);
  }

  assert.match(css, /\.row-actions-toggle \{\s*display: inline-flex/);
  assert.match(css, /\.row-actions:not\(\.is-open\) > \.ract \{ display: none; \}/);
  assert.match(css, /\.row-actions\.is-open > \.ract \{[^}]*display: grid/);
  assert.doesNotMatch(css, /\.row:hover \.ract/);
});

test('Coming up precedes the one native full Reading List disclosure', () => {
  const fullAt = html.indexOf('id="full"');
  const shelfAt = html.indexOf('id="shelf-sec"');
  assert.ok(fullAt >= 0 && shelfAt >= 0 && shelfAt < fullAt, 'Coming up is not before the full Reading List');
  const disclosures = html.match(/<details class="full" id="full"[\s\S]*?<\/details>/g) ?? [];
  assert.equal(disclosures.length, 1, 'the reading screen no longer has exactly one full-order disclosure');
  assert.equal((disclosures[0].match(/<summary>/g) ?? []).length, 1, 'the disclosure no longer has one native summary');
  for (const id of ['full-heading', 'full-action', 'full-count']) {
    assert.match(disclosures[0], new RegExp(`id="${id}"`), `the summary is missing ${id}`);
  }
  assert.match(disclosures[0], /class="chev" aria-hidden="true"/);
});

test('the full Reading List summary is a wrapping full-width action', () => {
  const full = css.match(/details\.full \{[^}]*\}/)?.[0] ?? '';
  const summary = css.match(/details\.full > summary \{[^}]*\}/)?.[0] ?? '';
  assert.match(full, /border: 1px solid var\(--line\)/);
  assert.match(full, /background: var\(--card\)/);
  assert.match(summary, /display: flex/);
  assert.match(summary, /flex-wrap: wrap/);
  assert.match(summary, /min-height: 44px/);
  assert.match(summary, /width|padding/);
  assert.match(css, /#full-heading \{[^}]*font-size: var\(--t-subtitle\)[^}]*font-weight: 600/);
  assert.match(css, /#full-action \{[^}]*font-weight: 600/);
  assert.match(css, /details\.full\[open\] > summary \{[^}]*border-bottom/);
  assert.doesNotMatch(summary, /position: sticky/);
});

test('the full Reading List action and state hooks receive the accepted copy', () => {
  assert.match(reading, /\$\('#full-action'\)\.textContent = \$\('#full'\)\.open/);
  for (const copy of ['Hide full Reading List', 'View all ${total} issue', 'No issues yet', '${unread} unread', 'All read']) {
    assert.ok(reading.includes(copy), `the summary renderer is missing ${copy}`);
  }
});

test('all editing commands remain reachable through native List actions', () => {
  assert.match(css, /\.list-actions-body \{[^}]*border: 1px solid var\(--line\)/);
  const ordinaryStrip = css.match(/^\.list-tools \{[^}]*\}/m)?.[0] ?? '';
  assert.match(ordinaryStrip, /display: flex/);
  assert.doesNotMatch(ordinaryStrip, /border:/);
  assert.match(css, /\.list-tools \.quiet \{[^}]*border-color: transparent/);
  assert.match(css, /\.list-tools \.quiet:hover, \.list-tools \.quiet:focus-visible \{[^}]*border-color: var\(--line-2\)/);
  for (const id of ['btn-rename-list', 'btn-list-note', 'btn-duplicate-list', 'btn-export-md', 'btn-delete-list']) {
    assert.match(html, new RegExp(`<button type="button" class="quiet[^"]*" id="${id}"`), `${id} left the tool strip`);
  }
});

test('the shelf wraps, so no upcoming issue is off the right edge', () => {
  // Measured at 1280x900 before the change: the eighth tile was clipped by the scroller.
  const shelf = css.match(/\n\.shelf \{[^}]*\}/)[0];
  assert.match(shelf, /flex-wrap: wrap/);
  assert.equal(/overflow-x: auto/.test(shelf), false, 'the shelf is a horizontal scroller again');
  // An auto-fit grid wraps too, and it was the first shape tried. It is excluded by name because it
  // hands the space of each collapsed track to the survivors, which put four remaining tiles a
  // measured 80px apart on a declared 14.4px gap. A cap on the tile does not cap the track.
  assert.equal(/auto-fit/.test(shelf), false, 'the shelf stretches its tracks again');
  const tile = css.match(/\n\.tile \{[^}]*\}/)[0];
  assert.match(tile, /flex: 1 1 112px/);
  assert.match(tile, /max-width: 168px/);
});

test('Coming up tiles align Read controls when titles wrap to different heights', () => {
  const tile = css.match(/\n\.tile \{[^}]*\}/)[0];
  const button = css.match(/\n\.tile-read \{[^}]*\}/)[0];
  assert.match(tile, /display: flex/);
  assert.match(tile, /flex-direction: column/);
  assert.match(button, /margin-top: auto/, 'Coming up actions no longer share the row baseline');
});

test('the current row is marked by more than a tint, and the rows carry a rule between them', () => {
  // The separator is later in the file than `.row.now` at equal specificity, so it has to exclude
  // the marked row by name or it wins that row's top edge back and outlines it on three sides.
  assert.match(css, /\.row \+ \.row:not\(:hover\):not\(\.now\) \{ border-top-color: var\(--line\); \}/);
  assert.match(css, /\.row\.now \{ box-shadow: inset 3px 0 0 var\(--accent-text\); \}/);
});

test('every new surface survives forced colours', () => {
  // An inset shadow and a hairline in a palette token are both discarded by forced colours, so each
  // one that carries meaning needs a replacement the mode is required to honour.
  const forced = css.match(/@media \(forced-colors: active\) \{[\s\S]*$/)[0];
  assert.match(forced, /\.list-tools \{ border: 1px solid CanvasText; \}/);
  assert.match(forced, /\.row\.now \{ border: 2px solid Highlight; box-shadow: none; \}/);
  assert.match(forced, /#reading-filters \{ background: Canvas; \}/);
  assert.match(forced, /details\.full, details\.full > summary \{ border-color: CanvasText; background: Canvas; \}/);
});

test('the sticky filters are scoped by id, because other fieldsets share the class', () => {
  assert.match(css, /#reading-filters \{[^}]*position: sticky/);
  assert.equal(/\n\.filters \{[^}]*position: sticky/.test(css), false, 'every fieldset with the filters class is now sticky');
  const others = ['progress-scope', 'catalog-filters'];
  for (const id of others) assert.match(html, new RegExp(`class="filters" id="${id}"`), `${id} is no longer a filters fieldset`);
});
