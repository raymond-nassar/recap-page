import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { THEMES, DEFAULT_THEME, themeAttribute, normaliseTheme } from '../src/js/lib/theme.js';
import { PAIRS, KNOWN, SURFACES, BODY, parseHex, parseColour, luminance, ratio, tokensIn, checkAll, unresolved, passingReport, resolveSurface } from '../scripts/check-palette.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, ...rel.split('/')), 'utf8');
const css = read('src/styles.css');

const DARK = ':root, :root[data-theme="dark"]';
const LIGHT_ATTR = ':root[data-theme="light"]';
const LIGHT_MEDIA = ':root:not([data-theme="dark"])';

// Comments are blanked rather than removed so every offset still lines up with the original text.
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, (m) => ' '.repeat(m.length));

// The last token block is the light palette inside the media query, so the search for stray
// literals begins after that whole @media block closes. Counting braces is what gets this right:
// taking the first `}` after the selector lands inside the media query and leaves half the token
// declarations in scope, which is how this test first reported four tokens as stray literals.
function endOfTokenBlocks(text) {
  const src = stripComments(text);
  const at = src.indexOf(LIGHT_MEDIA);
  assert.ok(at > 0, 'the media-query light block is no longer where this test looks for it');
  const open = src.lastIndexOf('@media', at);
  let depth = 0;
  for (let i = src.indexOf('{', open); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  throw new Error('the media-query light block is unclosed');
}

test('the three offered themes are system, dark and light', () => {
  assert.deepEqual(THEMES, ['system', 'dark', 'light']);
});

test('system writes no data-theme attribute at all', () => {
  // Writing data-theme="system" would match neither the dark selector nor the light one, so the
  // page would fall through to the bare `:root` defaults and strand itself on dark while the
  // control said it was following the system. Absence is what lets the media query decide.
  assert.equal(themeAttribute('system'), null);
});

test('an explicit theme writes its own name', () => {
  assert.equal(themeAttribute('dark'), 'dark');
  assert.equal(themeAttribute('light'), 'light');
});

test('an unrecognised theme is treated as system rather than written through', () => {
  // A value that reaches here from an older or hand-edited settings blob must not become a
  // data-theme nobody styles.
  assert.equal(themeAttribute('midnight'), null);
  assert.equal(themeAttribute(''), null);
  assert.equal(themeAttribute(undefined), null);
});

test('normalising is what turns an unknown stored theme into the default', () => {
  assert.equal(normaliseTheme('light'), 'light');
  assert.equal(normaliseTheme('midnight'), DEFAULT_THEME);
  assert.equal(normaliseTheme(undefined), DEFAULT_THEME);
  assert.equal(normaliseTheme(null), DEFAULT_THEME);
  assert.equal(DEFAULT_THEME, 'system');
});

test('main.js normalises the stored theme on the way in and on the way from the control', () => {
  // Both entry points have to go through the same normalisation, or a value rejected at one gets
  // in at the other. main.js cannot be imported here because it reads `document` at module scope,
  // so this reads it the way library.test.js does.
  const src = read('src/js/main.js');
  assert.match(src, /theme:\s*normaliseTheme\(raw\.theme\)/, 'loadSettings no longer normalises');
  assert.match(src, /settings\.theme\s*=\s*normaliseTheme\(next\)/, 'setTheme no longer normalises');
  assert.match(src, /theme:\s*settings\.theme/, 'saveSettings no longer persists the theme');
});

test('the settings control offers exactly the themes the code accepts', () => {
  // A fourth option in the markup would be silently normalised back to system on selection, and a
  // missing one would be unreachable.
  //
  // The element is matched by its id rather than by its whole opening tag. Written as an exact tag
  // this went red the first time the control was given a class, which says nothing about the themes
  // on offer and is the one thing this test is not about. What still has to hold is that the control
  // is a select and that its values are the accepted set, and both of those are still asserted.
  const html = read('src/index.html');
  const select = html.match(/<select\b[^>]*\bid="opt-theme"[^>]*>([\s\S]*?)<\/select>/);
  assert.ok(select, 'the theme control is no longer a select this test can read');
  const values = [...select[1].matchAll(/value="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(values, THEMES);
});

test('the two light token blocks declare exactly the same tokens', () => {
  // The light palette is written out twice on purpose: once for the explicit override and once
  // inside the prefers-color-scheme query, because the module is deferred and a JS-only
  // resolution would paint dark and then flip. Duplication is the right call there and a
  // liability everywhere else, so this is the test that makes it safe to keep.
  const attr = tokensIn(css, LIGHT_ATTR);
  const media = tokensIn(css, LIGHT_MEDIA);
  assert.deepEqual([...media.keys()].sort(), [...attr.keys()].sort());
  for (const [name, value] of attr) {
    assert.equal(media.get(name), value, `${name} differs between the two light blocks`);
  }
});

test('every token the dark theme declares, the light theme declares too', () => {
  // A token missing from one palette silently falls through to the other's value, which is how a
  // dark surface colour ends up painted on a light page.
  const dark = tokensIn(css, DARK);
  const light = tokensIn(css, LIGHT_ATTR);
  const missing = [...dark.keys()].filter((k) => !light.has(k));
  assert.deepEqual(missing, [], `the light theme does not declare ${missing.join(', ')}`);
});

test('no rule outside the token blocks names a literal colour', () => {
  // The whole point of the refactor: a literal colour in a rule is a colour that cannot follow a
  // theme. The token blocks are where literals belong, so the search starts after the last of
  // them, and comments are stripped first because several of them quote the very hex values the
  // refactor removed.
  const body = stripComments(css).slice(endOfTokenBlocks(css));
  const literals = [...body.matchAll(/#[0-9a-fA-F]{3,8}\b|\brgba?\(\s*[\d.]|\bhsla?\(\s*[\d.]/g)];
  assert.deepEqual(literals.map((m) => m[0]), [], 'a rule still carries a literal colour');
});

test('relative luminance follows the WCAG curve at both ends', () => {
  assert.equal(luminance([255, 255, 255]), 1);
  assert.equal(luminance([0, 0, 0]), 0);
});

test('black on white is the maximum contrast ratio of 21', () => {
  assert.equal(Math.round(ratio([0, 0, 0], [255, 255, 255]) * 100) / 100, 21);
});

test('contrast is symmetric, so pair order cannot change a verdict', () => {
  const a = ratio([18, 21, 27], [251, 252, 254]);
  const b = ratio([251, 252, 254], [18, 21, 27]);
  assert.equal(a, b);
});

test('shorthand and longhand hex parse to the same colour', () => {
  assert.deepEqual(parseHex('#fff'), [255, 255, 255]);
  assert.deepEqual(parseHex('#ffffff'), [255, 255, 255]);
  assert.equal(parseHex('not a colour'), null);
});

test('every measured pair names a real place it is rendered', () => {
  // A pair with no rendering site is a number that can drift unnoticed, and a floor met by a
  // combination the app never shows is not a floor.
  for (const [fg, bg, floor, where] of PAIRS) {
    assert.match(fg, /^--/);
    // A background is a token or one of the declared surfaces, and nothing else. Without this the
    // background field would accept any string, and a typo would become a surface that silently
    // fails to resolve rather than a pair that is measured.
    assert.ok(bg.startsWith('--') || Object.hasOwn(SURFACES, bg), `${fg} on ${bg} names neither a token nor a declared surface`);
    assert.ok(floor === 4.5 || floor === 3, `${fg} on ${bg} has an unexpected floor`);
    assert.ok(where && where.length > 8, `${fg} on ${bg} does not say where it is rendered`);
  }
});

test('a declared surface resolves to what the browser resolves it to', () => {
  // The two surfaces this file computes are the two it cannot read, so agreeing with itself proves
  // nothing. These six values were sampled from the painted pixels of the real app in Edge at
  // 1280x900, the rail on the catalog view and the banner reached by writing unreadable bytes into
  // the storage key before load. Pinning them is what stops the arithmetic being quietly replaced
  // by something that merely passes.
  const expected = {
    'the selected rail item': { dark: '#1f1f24', light: '#dfdfe5' },
    'the unreadable-data banner': { dark: '#2d2220', light: '#f1eae1' },
    // Sampling matters most here. `getComputedStyle` returns `rgba(255,255,255,0.06)` for this
    // button: the value before compositing, so reading it back would have confirmed the stylesheet
    // and not the render.
    'the ghost button on the unreadable-data banner': { dark: '#392f2d', light: '#e3dcd4' },
  };
  const hex = (c) => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
  for (const [selector, theme] of [[DARK, 'dark'], [LIGHT_ATTR, 'light']]) {
    const tokens = tokensIn(css, selector);
    for (const [name, byTheme] of Object.entries(expected)) {
      const { colour, message } = resolveSurface(name, tokens);
      assert.ok(colour, `${name} did not resolve in the ${theme} theme: ${message}`);
      assert.equal(hex(colour), byTheme[theme], `${name} resolves differently from the browser in the ${theme} theme`);
    }
  }
});

test('every declared surface is one a pair actually renders on', () => {
  // The same rule the pair list lives by. A surface nothing is drawn on is a computation nobody
  // checks, and it would keep passing after the rule that painted it was deleted.
  for (const name of Object.keys(SURFACES)) {
    assert.ok(PAIRS.some(([, bg]) => bg === name), `${name} is declared but no pair is rendered on it`);
  }
});

test('the recovery banner gives its two actions different weights, and gates the one it quietened', () => {
  // The banner tells the reader to download a copy first and then start fresh. Two identical
  // buttons cannot carry that order, and the destructive one is the wrong one to make equally
  // loud, so the ghost class on it is load bearing rather than cosmetic.
  const html = read('src/index.html');
  const actions = html.match(/<div class="blocked-actions">([\s\S]*?)<\/div>/);
  assert.ok(actions, 'the blocked banner no longer has an actions row');
  const classOf = (id) => {
    const m = actions[1].match(new RegExp(`<button[^>]*id="${id}"`));
    assert.ok(m, `${id} is not in the banner's actions`);
    return actions[1].match(new RegExp(`class="([^"]*)"[^>]*id="${id}"`))?.[1] ?? '';
  };
  assert.ok(!classOf('btn-download-salvage').includes('btn-g'), 'the safe action was made a ghost, so the banner now points at the destructive one');
  assert.ok(classOf('btn-start-fresh').includes('btn-g'), 'both banner buttons are primary again, so the order the paragraph states is not shown');

  // The pair list is written by hand, so it can drift from the rule it claims to measure. Reading
  // the declaration back is what stops an edit changing the colour while the gate goes on
  // measuring the old one and reporting a pass.
  const rule = css.match(/\.blocked \.btn-g\s*\{([^}]*)\}/);
  assert.ok(rule, 'the scoped border rule is gone, so the button is back on the token that measures 2.44:1 on this surface');
  const declared = rule[1].match(/border-color:\s*var\((--[\w-]+)\)/);
  assert.ok(declared, '.blocked .btn-g no longer takes its border colour from a token');
  const gated = PAIRS.filter(([, bg]) => bg === 'the ghost button on the unreadable-data banner');
  assert.ok(
    gated.some(([fg]) => fg === declared[1]),
    `the stylesheet borders the banner ghost with ${declared[1]} but the gate measures ${gated.map(([fg]) => fg).join(' and ')}`,
  );

  // The label is read, so it is measured against the body floor rather than the control floor. It
  // is checked the same way round as the border, off the declaration, because a pair quietly
  // deleted from the list is how the button that was made quieter stops being measured at all.
  const base = css.match(/\n\.btn-g\s*\{([^}]*)\}/);
  assert.ok(base, 'the ghost button rule is gone');
  const label = base[1].match(/color:\s*var\((--[\w-]+)\)/);
  assert.ok(label, '.btn-g no longer takes its text colour from a token');
  assert.ok(
    gated.some(([fg, , floor]) => fg === label[1] && floor === BODY),
    `the banner ghost is labelled in ${label[1]}, which is not measured against the ${BODY}:1 body floor on that surface`,
  );
});

test('a surface may be built on another surface, and a cycle is a finding rather than a crash', () => {
  // The ghost button on the banner is a tint over a tint, which the first version of this could not
  // express: it read the base as a token and nothing else. Resolving one level deep would have
  // measured that button against the panel and reported a contrast it never has.
  const tokens = tokensIn(css, DARK);
  const nested = SURFACES['the ghost button on the unreadable-data banner'];
  assert.equal(nested.on, 'the unreadable-data banner', 'the ghost button is no longer built on a surface');
  assert.ok(!nested.on.startsWith('--'), 'the base is a token, so this no longer proves nesting works');

  // The nesting is what makes the difference, so measure it rather than assert it resolves. Against
  // the panel the answer would be a different colour entirely.
  const onSurface = resolveSurface('the ghost button on the unreadable-data banner', tokens).colour;
  const banner = resolveSurface('the unreadable-data banner', tokens).colour;
  const panel = parseColour(tokens.get('--panel'));
  const tint = parseColour(tokens.get('--tint-base'));
  const overPanel = tint.map((v, i) => Math.round(v * nested.fraction + panel[i] * (1 - nested.fraction)));
  assert.notDeepEqual(onSurface, overPanel, 'the ghost button resolves as though the banner were not there');
  const between = onSurface.every((v, i) => (v - banner[i]) * (tint[i] - banner[i]) >= 0);
  assert.ok(between, 'the ghost button does not sit between the banner and the tint laid over it');

  // A hand written list can name two surfaces in terms of each other. That has to report as the
  // authoring mistake it is rather than run the stack out, which reads as a crash in the gate and
  // sends the next reader looking for a bug in the arithmetic instead of a typo in the list.
  const cyclic = {
    a: { layer: '--tint-base', fraction: 0.5, on: 'b', css: 'a test fixture' },
    b: { layer: '--tint-base', fraction: 0.5, on: 'a', css: 'a test fixture' },
  };
  const loop = resolveSurface('a', tokens, new Set(), cyclic);
  assert.ok(loop.message, 'a surface defined in terms of itself resolved to a colour');
  assert.match(loop.message, /defined in terms of itself/);
});

test('a surface built from a missing token is a finding, not a skip', () => {
  // The same rule a missing token follows. A surface that cannot be resolved has to fail loudly,
  // because the alternative is a pair that stops being measured with nobody deciding that it should.
  // Proved by removing the token rather than by asserting the code path exists.
  //
  // Which surfaces that breaks is derived rather than listed, because a surface can inherit the
  // dependency from the one it is built on. Naming them here instead would be a list to keep
  // complete, and it would pass while a newly tinted surface went quietly unchecked.
  const dependsOnTint = (name) => {
    const surface = SURFACES[name];
    if (!surface) return false;
    return surface.layer === '--tint-base' || dependsOnTint(surface.on);
  };
  const affected = Object.keys(SURFACES).filter(dependsOnTint);
  assert.ok(affected.length > 0, 'no surface is built on --tint-base, so this proves nothing');

  const without = css.replace(/--tint-base:\s*[^;]+;/g, '');
  const findings = checkAll(without).filter((f) => /cannot be resolved/.test(f.message));
  assert.ok(findings.length > 0, 'removing --tint-base left every pair on the tinted surface silently unmeasured');
  assert.ok(findings.every((f) => affected.includes(f.bgName)), 'the finding names a surface that does not depend on the removed token');
  for (const name of affected) {
    assert.ok(findings.some((f) => f.bgName === name), `${name} depends on --tint-base but resolved without it`);
  }
});

test('a bare rgb triple parses as a colour, and an out-of-range one does not', () => {
  // `--tint-base` is the only token declared this way, because it is only ever used inside
  // `rgb(... / n%)`. Accepting it is what lets a tinted surface resolve; accepting `300 0 0` would
  // let a typo resolve to a colour no browser would paint.
  assert.deepEqual(parseColour('255 255 255'), [255, 255, 255]);
  assert.deepEqual(parseColour('0 0 0'), [0, 0, 0]);
  assert.deepEqual(parseColour('#d43333'), [212, 51, 51]);
  assert.equal(parseColour('300 0 0'), null);
  assert.equal(parseColour('255 255'), null);
  assert.equal(parseColour('not a colour'), null);
});

test('the recorded below-floor pairs are exactly the pairs that measure below it', () => {
  // Both halves matter. A new failure is the obvious one. A recorded pair that has since been
  // raised is the one that keeps the list from outliving its debt.
  const { fresh, fixed } = unresolved(css);
  assert.deepEqual(fresh.map((f) => f.key), [], 'a new pair is below the contrast floor');
  assert.deepEqual(fixed, [], 'a recorded pair now meets the floor and should be removed from KNOWN');
});

test('every recorded pair reports its current ratio, not just its existence', () => {
  // The docs claim the ratio is printed on every CI run, and for a while that was false: the number
  // was reachable only under a `--report` flag no CI step passes, so a green run said five pairs were
  // recorded and never said what they measured. A ratio nobody sees cannot be noticed drifting, and
  // these are the pairs most likely to move, since the gate stays green anywhere below the floor.
  //
  // This spawns the gate rather than calling into it, because the claim is about what a run prints.
  // The first version of this test asserted on `unresolved`'s return shape, one level below the
  // claim, and review found the mutation that escaped it: delete the print loop and its destructure
  // and the suite stayed green while the claim went false again.
  const out = execFileSync(process.execPath, [join(ROOT, 'scripts', 'check-palette.mjs')], { encoding: 'utf8' });
  const { recorded } = unresolved(css);
  assert.equal(recorded.length, KNOWN.length, 'a recorded pair reports no measurement');
  for (const f of recorded) {
    assert.equal(typeof f.ratio, 'number', `${f.fgName} on ${f.bgName} reports no ratio`);
    assert.ok(f.where, `${f.fgName} on ${f.bgName} reports no place it is rendered`);
    const line = out.split(/\r?\n/).find((l) => l.includes(`${f.fgName} on ${f.bgName} (${f.themeName})`));
    assert.ok(line, `the gate never prints ${f.fgName} on ${f.bgName} in the ${f.themeName} theme`);
    // The measured value, not merely the shape of one. Review found that checking only the shape let a
    // constant pass, which would print a fixed number for a pair that had drifted and defeat the whole
    // reason the ratio is printed.
    assert.ok(line.includes(`${f.ratio.toFixed(2)}:1`), `${line.trim()} does not carry its own measured ratio of ${f.ratio.toFixed(2)}:1`);
    assert.match(line, /^\s+\d+\.\d\d:1\s/, `${line.trim()} carries no measured ratio`);
    assert.ok(line.includes(f.where), `${f.fgName} on ${f.bgName} is printed without the place it is drawn`);
  }
});

test('the passing report refuses a stylesheet that is not passing', () => {
  // `passingReport` is exported, so its precondition can no longer live in the order of statements
  // inside `main()`. Review found the earlier version hardcoded "0 new" and built its list from the
  // recorded keys alone, so called directly on a broken stylesheet it returned a clean-looking report
  // for a tree with fresh failures in it. Flattening every colour to one grey makes every pair 1:1.
  const flattened = css.replace(/#[0-9a-fA-F]{3,8}\b/g, '#808080');
  const { fresh } = unresolved(flattened);
  assert.ok(fresh.length > 0, 'the flattened stylesheet was supposed to fail, so this proves nothing');
  assert.equal(passingReport(flattened), null, 'a report was produced for a stylesheet with fresh failures');
  assert.ok(passingReport(css), 'the real stylesheet passes and must still produce a report');
});

test('the recorded pairs are all non-text boundaries, never body text', () => {
  // Recording a body-text pair would be waiving readability, which is not a trade this list is
  // allowed to make. Every entry has to be a 3:1 boundary, not a 4.5:1 text pair.
  for (const key of KNOWN) {
    const [theme, fg, bg] = key.split(':');
    assert.ok(['dark', 'light'].includes(theme), `${key} names no theme`);
    const pair = PAIRS.find((p) => p[0] === fg && p[1] === bg);
    assert.ok(pair, `${key} is not one of the measured pairs`);
    assert.equal(pair[2], 3, `${key} is body text and must not be recorded as accepted`);
  }
});

test('a control boundary is measured against every surface it is drawn on, not just one', () => {
  // The pair list was measured in Edge against what the app actually paints, and three of the
  // surfaces it found were not the ones the list originally named. A checkbox in a row sits on the
  // page rather than on a card, a hero button sits on a card rather than on the page, and a text
  // input's border has that input's own fill on its inner side. Measuring one surface and calling
  // the boundary done is how a token passes the gate and still disappears somewhere on screen.
  //
  // `--track` is here for the same reason and was added later, by review: the trough renders on a
  // card in the reading hero and on the rail in the per-list bars, and listing only the card hid a
  // real degradation when the dark trough was darkened.
  //
  // `--accent` and `--track-2` were added later still, by review of BL-067, and their absence is what
  // let that change gate the cover-art switch's off state while leaving the on state of the same
  // control on the same background unmeasured. This assertion is the thing that was supposed to
  // force the question and could not, because it said nothing about the two tokens the change was
  // about. A foreground that gains a surface without this line moving is the defect, so the line
  // moves with it deliberately.
  // `--accent` gained three more surfaces in BL-069, and two of them are not tokens. That is the point
  // of listing them here: the rail carries the brand mark and the focused skip link, the selected
  // rail item carries the accent bar that marks the current destination, and the unreadable-data
  // banner carries both of its buttons. None of the three was measured anywhere before, so `--accent`
  // could have gone invisible on any of them without this file moving.
  // `--teal` gained `--card-2` when the reading path put a "Start here" badge on a catalog row.
  // The gap is the whole reason this line is here: the badge reused `.pill-ok`'s exact two values,
  // so it looked covered by the two green pairs already recorded, and neither of them is the
  // surface a catalog row actually draws. Reusing a colour is not the same as reusing a
  // measurement, and a review found this one rather than the gate.
  // `--red-fg` gained `--bg` and `--card-2` when the brand moved off red: danger text on the page
  // had been gated through the brand token that used to share the hue, and once the two separated
  // that pair covered nothing danger was actually drawn on. The salvage row's Remove button, which
  // is danger on a raised card, had never been measured at all.
  const surfaces = (fg) => PAIRS.filter((p) => p[0] === fg).map((p) => p[1]).sort();
  assert.deepEqual(surfaces('--line-2'), ['--bg', '--card', '--card-2']);
  assert.deepEqual(surfaces('--cb-line'), ['--bg', '--card']);
  assert.deepEqual(surfaces('--track'), ['--card', '--rail']);
  assert.deepEqual(surfaces('--teal'), ['--bg', '--card', '--card-2']);
  assert.deepEqual(surfaces('--red-fg'), ['--bg', '--card', '--card-2']);
  assert.deepEqual(surfaces('--accent'), ['--bg', '--card', '--card-2', '--rail', '--track', 'the selected rail item', 'the unreadable-data banner']);
  assert.deepEqual(surfaces('--track-2'), ['--bg']);
  assert.deepEqual(surfaces('--on-accent'), ['--accent', '--teal', '--track-2']);
});

// Every class this app puts on something a reader operates, found by reading the markup and the
// renderer rather than by listing them here. Both sources are needed: the toolbar buttons are
// authored in index.html, while the rows are built in main.js.
function interactiveClasses() {
  const found = new Set();
  const add = (attr) => {
    for (const token of attr.replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) {
      if (token) found.add(token);
    }
  };
  const TAGS = 'button|input|select|textarea|a|summary';
  for (const m of read('src/index.html').matchAll(new RegExp(`<(?:${TAGS})\\s[^>]*class="([^"]*)"`, 'g'))) add(m[1]);
  // el('button', { class: '...' }) and its backticked form. The object literal is matched lazily up
  // to the class key, so other attributes before it do not have to be anticipated.
  for (const m of read('src/js/main.js').matchAll(new RegExp(`el\\(\\s*'(?:${TAGS})'\\s*,\\s*\\{[^{}]*?class:\\s*(?:'([^']*)'|\`([^\`]*)\`)`, 'g'))) add(m[1] ?? m[2]);
  return found;
}

test('nothing a reader operates is bordered with the ungated hairline token', () => {
  // `--line` carries no floor because it is decoration. That is a claim, and this is what stops it
  // rotting: it cross-references the rules that draw a border in `--line` against the classes the
  // markup and the renderer actually put on a button, an input or a link.
  //
  // The browser pass cannot cover this on its own, which review proved. `.rnote` is `border: 0`
  // until `.has-note` is set, so a fixture with no notes saved never painted it, and the one
  // control still on `--line` was invisible to a scan of what is rendered. A rule that paints only
  // in a state no fixture reaches needs a check that reads rules rather than pixels.
  const interactive = interactiveClasses();
  assert.ok(interactive.has('quiet'), 'the class scan found no toolbar buttons, so it is not reading the markup');
  assert.ok(interactive.has('rnote'), 'the class scan found no rendered controls, so it is not reading main.js');

  const offenders = [];
  for (const rule of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const [, selector, body] = rule;
    if (!/border[a-z-]*:[^;]*var\(--line\)/.test(body)) continue;
    for (const cls of selector.matchAll(/\.([\w-]+)/g)) {
      if (interactive.has(cls[1])) offenders.push(`${selector.trim().split('\n').pop().trim()} borders .${cls[1]}`);
    }
  }
  assert.deepEqual(offenders, [], 'a control is bordered with --line, which carries no contrast floor');
});

test('a progress bar is measured where it carries its value, fill against trough', () => {
  // `--track` on `--card` cannot reach 3:1 while the `--accent` fill still reads as the filled part,
  // so it stays recorded and this pair is measured in its place. Dropping it would leave the bar
  // with no gated contrast at all, which is worse than the ratio that is recorded.
  const pair = PAIRS.find(([fg, bg]) => fg === '--accent' && bg === '--track');
  assert.ok(pair, 'the fill of a progress bar is no longer measured against its trough');
  assert.equal(pair[2], 3);
  for (const [selector, name] of [[DARK, 'dark'], [LIGHT_ATTR, 'light']]) {
    const tokens = tokensIn(css, selector);
    const r = ratio(parseHex(tokens.get('--accent')), parseHex(tokens.get('--track')));
    assert.ok(r >= 3, `the ${name} progress fill measures ${r.toFixed(2)}:1 against its own trough`);
  }
});

test('both themes carry a colour-scheme declaration', () => {
  // Without it the browser paints its own form controls and scrollbars for the wrong theme, which
  // is the one part of the page CSS custom properties cannot reach.
  assert.match(css, /:root,\s*:root\[data-theme="dark"\][^}]*color-scheme:\s*dark/s);
  assert.match(css, /:root\[data-theme="light"\][^}]*color-scheme:\s*light/s);
});

test('every pair resolves in both themes, so nothing is skipped unmeasured', () => {
  // check() reports a missing token as a finding rather than skipping it, so an empty findings list
  // here means every pair in both themes was genuinely measured. The count is derived rather than
  // written down, because a figure in a comment is one more thing to keep in step with the list.
  const findings = checkAll(css);
  const unresolvable = findings.filter((f) => /not defined|not a plain hex/.test(f.message));
  assert.deepEqual(unresolvable.map((f) => f.message), []);
});

function declaredPixelMinHeight(selector) {
  const rule = stripComments(css).match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  assert.ok(rule, `${selector} has no rule`);
  const declaration = rule[1].match(/(?:^|;)\s*min-height:\s*([\d.]+)px\s*(?:;|$)/);
  assert.ok(declaration, `${selector} has no pixel minimum height`);
  return Number(declaration[1]);
}

test('the quiet button has a minimum height of at least 24 pixels', () => {
  assert.ok(declaredPixelMinHeight('\\.quiet') >= 24);
});

test('the file input has a minimum height of at least 24 pixels', () => {
  assert.ok(declaredPixelMinHeight('input\\[type="file"\\]') >= 24);
});

test('the checkbox row has a minimum height of at least 24 pixels', () => {
  assert.ok(declaredPixelMinHeight('\\.checkbox') >= 24);
});
