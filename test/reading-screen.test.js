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
  assert.match(main, /\$\('#ring-sub'\)\.textContent/);
  assert.equal(/#ring-wrap'\)\.setAttribute\('title'/.test(main), false, 'the percentage is back in a tooltip');
});

test('the ring geometry in the markup and the constant in the renderer agree', () => {
  // The dash array is the circumference of the circle it is drawn on. They are written in two
  // files, so the only thing keeping them in step is this.
  const r = Number(html.match(/class="ring-arc"[^>]*\br="(\d+)"/)[1]);
  const dash = Number(html.match(/stroke-dasharray="([\d.]+)"/)[1]);
  const constant = Number(main.match(/const RING_CIRCUMFERENCE = ([\d.]+);/)[1]);
  assert.equal(dash, constant, 'the markup and the renderer disagree about the circumference');
  assert.ok(Math.abs(dash - 2 * Math.PI * r) < 0.05, `${dash} is not the circumference of a circle of radius ${r}`);
});

test('the hero offers one dominant action, and the way out of the app is a link', () => {
  // Three controls of near-equal weight is the same as none, and the issue page is not an action
  // the app performs. Its element is still an anchor either way; this is about what it looks like.
  const hero = html.match(/<section class="hero" id="hero"[\s\S]*?\n {14}<\/section>/)[0];
  const cta = hero.match(/<div class="cta">[\s\S]*?<\/div>/)[0];
  assert.match(cta, /class="btn btn-lg" id="btn-hero-read"/);
  assert.match(cta, /class="btn btn-g" id="btn-hero-inspect"/);
  assert.match(cta, /class="btn btn-g" id="btn-hero-done"/);
  assert.match(cta, /class="btn btn-link" id="btn-hero-info"/);
  assert.equal((cta.match(/btn-lg/g) || []).length, 1, 'more than one call to action carries the dominant treatment');
});

test('the list tools are demoted by moving the border to the strip, not by hiding a button', () => {
  // Discoverability and keyboard access both have to survive the demotion, so the test is that the
  // buttons are still there, still bordered when reached, and that the group carries an edge.
  assert.match(css, /\.list-tools \{[^}]*border: 1px solid var\(--line\)/);
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
  assert.match(css, /\.tile \{[^}]*flex: 1 1 112px[^}]*max-width: 168px/);
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
});

test('the sticky filters are scoped by id, because other fieldsets share the class', () => {
  assert.match(css, /#reading-filters \{[^}]*position: sticky/);
  assert.equal(/\n\.filters \{[^}]*position: sticky/.test(css), false, 'every fieldset with the filters class is now sticky');
  const others = ['progress-scope', 'catalog-filters'];
  for (const id of others) assert.match(html, new RegExp(`class="filters" id="${id}"`), `${id} is no longer a filters fieldset`);
});
