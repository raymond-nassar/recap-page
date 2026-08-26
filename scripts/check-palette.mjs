// Every contrast ratio this stylesheet claims, measured rather than asserted.
//
// The claims were prose in CSS comments and nothing checked them. The comment above `--accent-text`
// records three measurements to two decimal places, and the one above the availability badges
// warned in as many words that a light theme "would void all of these and the measurement would
// have to be redone per theme". That is the whole argument for this file: a second theme doubles
// the number of ratios and prose does not scale to it.
//
// Only foreground-on-background pairs that actually occur are listed. A pair nobody renders is a
// number that can drift without anyone noticing, and a floor met by a combination the app never
// shows is not a floor.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// WCAG 2.1: 4.5:1 for body text, 3:1 for large text and for the boundary of a control.
export const BODY = 4.5;
export const LARGE = 3;

// Foreground, background, floor, and where it is rendered. The last field is the reason the pair
// is here at all, so a reviewer can check the claim rather than trust the list.
//
// `--line` is deliberately absent. It was the border of five controls until BL-065, measured 1.29:1
// in Edge, and those controls were moved to `--line-2`. What is left on `--line` is a hairline
// around cards, images, panels and separators, plus the static `.pill` and `.badge` labels, none of
// which is a user interface component, so 1.4.11 does not reach them and a floor would be inventing
// a claim rather than recording one. The check that keeps this honest is a browser pass that
// enumerates every rendered interactive element and measures its own border, because a list of
// control selectors would be a list someone has to keep complete.
//
// That pass was not sufficient on its own, and review found the hole. `.rnote` is `border: 0` until
// `.has-note` is set, so the sixth control still on `--line` painted no border in any fixture and
// could not be seen by a scan of what is rendered. It measured the same 1.29:1 and moved with the
// other five. The pass now sets that class and reads all four border sides rather than the top, so
// a left accent counts: 731 painted boundaries per theme across seven views, none below the floor.
// A rule that paints only in a state no fixture reaches is the shape of the next such hole.
export const PAIRS = [
  ['--text', '--bg', BODY, 'body text on the page'],
  ['--text', '--card', BODY, 'body text on a card'],
  ['--text', '--card-2', BODY, 'body text on a raised card'],
  ['--text', '--rail', BODY, 'the rail label of the current view'],
  ['--dim', '--bg', BODY, 'secondary text on the page'],
  ['--dim', '--card', BODY, 'secondary text on a card'],
  ['--muted', '--bg', BODY, 'the rail hint and the progress ring label'],
  ['--muted', '--card', BODY, 'a card subtitle'],
  ['--read-fg', '--bg', BODY, 'a row that has been read'],
  ['--read-fg', '--card', BODY, 'a read row inside a card'],
  ['--blue', '--bg', BODY, 'a link, and the focus ring against the page'],
  ['--blue', '--card', BODY, 'a link inside a card'],
  ['--logo-fill', '--bg', LARGE, 'the large Home masthead against the page'],
  ['--accent-text', '--bg', BODY, 'the brand as text on the page: an eyebrow, the progress ring'],
  ['--accent-text', '--card', BODY, 'the brand as text on a card, and the selected filter pill'],
  ['--red-fg', '--bg', BODY, 'the Delete list hover, which is danger text on the page'],
  ['--red-fg', '--card', BODY, 'a danger hover and the unavailable badge'],
  ['--red-fg', '--card-2', BODY, 'the Remove button on a salvage row, which is on a raised card'],
  ['--red-fg-2', '--card', BODY, 'an error notice'],
  ['--teal', '--bg', BODY, 'the available badge on the page'],
  ['--teal', '--card', BODY, 'the available badge on a card'],
  ['--teal', '--card-2', BODY, 'the Start here badge on a catalog row'],
  ['--amber', '--bg', BODY, 'the scheduled badge on the page'],
  ['--amber', '--card', BODY, 'the scheduled badge on a card'],
  ['--on-accent', '--accent', BODY, 'the label of a primary button, and the knob of the cover-art switch in its on state'],
  ['--line-2', '--bg', LARGE, 'the boundary of a bordered control'],
  ['--line-2', '--card', LARGE, 'the boundary of a button on a card, such as the hero'],
  ['--line-2', '--card-2', LARGE, 'the boundary of a text input against its own fill'],
  ['--cb-line', '--card', LARGE, 'the boundary of an unchecked checkbox'],
  ['--cb-line', '--bg', LARGE, 'the boundary of an unchecked checkbox in a row on the page'],
  ['--track', '--card', LARGE, 'the unfilled part of a progress bar'],
  ['--track', '--rail', LARGE, 'the unfilled part of the per-list progress bar in the rail'],
  ['--accent', '--track', LARGE, 'the filled part of a progress bar against the unfilled part'],
  ['--warn', '--panel', LARGE, 'the border of the unreadable-data notice'],
  // BL-067. The cover-art switch and the primary button were the two controls no pair reached, so
  // nothing here would have moved if either had gone invisible. Measured by walking each control's
  // ancestor chain to the first opaque background rather than by reading the stylesheet, over seven
  // views and both themes.
  //
  // Review found the first attempt at this block wrong twice over, in the same sentence. It said the
  // switch is always on the page and the primary button always on a card, and gated the off-state
  // track on the page while leaving the on-state track of the same control, on the same background,
  // ungated. Half of one control. `--accent` on `--bg` is painted by two separate things: the switch's
  // on-state track, and the catalog Clear button, which is a `.btn` with a transparent border
  // falling through to the page. They measure 3.95:1 dark and 6.83:1 light, so nothing was failing,
  // but nothing was watching either.
  //
  // Neither was visible to the browser pass, and the reason is worth keeping: the Clear button is
  // `hidden` until a query is typed, and the switch's on state is not the state a fresh fixture
  // lands in. That is the hole this file's own header names, a rule that paints only in a state no
  // fixture reaches, and it caught this file rather than the app.
  //
  // What the plan got wrong is narrower than it looked. It asked for `--accent` on `--bg` and described
  // it as the knob on the on-state track. The description is garbled, because the knob on the
  // on-state track is `--on-accent` on `--accent`, already listed above. The pair itself was right.
  ['--track-2', '--bg', LARGE, 'the cover-art switch in its off state, which sits on the page'],
  ['--on-accent', '--track-2', LARGE, 'the knob of the cover-art switch on its off-state track'],
  ['--accent', '--bg', LARGE, 'the cover-art switch in its on state, and the catalog Clear button, both on the page'],
  ['--accent', '--card', LARGE, 'the fill of a primary button on a card'],
  ['--accent', '--card-2', LARGE, 'the fill of a primary button on a raised card'],
  // Found by the same review, one token over, and it is the reason the guard in test/theme.test.js
  // now pins `--on-accent` too. The tick inside a checked checkbox is `--on-accent` on `--teal`
  // (`src/styles.css:746` and `src/styles.css:748`), which is 1.93:1 in the dark theme. It is
  // listed here and recorded below rather than fixed, because the colour decision belongs to
  // BL-069 and this item is about measuring what nothing measured. The railed status dot is the
  // other thing painted on `--teal` and it carries no foreground at all, since
  // `.railed .rail-foot .pill` sets `color: transparent` at `src/styles.css:417-418`, so this is
  // the only pair `--teal` backs.
  ['--on-accent', '--teal', LARGE, 'the tick inside a checked read checkbox'],
  // BL-069, out of the BL-067 review, which found `--accent` painting three surfaces no pair reached.
  // Each was measured in Edge by hit testing what is actually behind the element rather than by
  // assuming, and all three clear the floor, so this is coverage rather than a repair.
  //
  // The skip link is absolutely positioned at the top left with `z-index: 100`, so it lands on the
  // rail rather than on the page. The folded-page brand mark is now a generated image and has its
  // own fixed palette, leaving this pair to describe the skip link alone.
  //
  // The accent bar is deliberately not on that entry. `.ri[aria-current]`
  // sets its own background at `src/styles.css:354`, a tint over the rail, and the bar at
  // `src/styles.css:358` is its `::before`, so it can only ever land on the tint. It reads 3.44 and
  // 5.35. Putting it on `--rail` with the other two would have read 4.09 and 6.37, overstating it
  // by 0.65 in the dark theme and 1.02 in the light one, which is the mistake hit testing was for.
  ['--accent', '--rail', LARGE, 'the skip link when focused on the rail'],
  ['--accent', 'the selected rail item', LARGE, 'the accent bar marking the current destination'],
  ['--accent', 'the unreadable-data banner', LARGE, 'the fill of the download button in the blocked banner'],

  // BL-072. The recovery banner offered two identically loud buttons while its own paragraph told
  // the reader to use one of them first, so the destructive one now takes the ghost treatment the
  // rest of the app already uses for a secondary action. That is a new boundary in the two places a
  // ghost button has any: its label and its border. Both are listed rather than assumed, because
  // the button that was made quieter is the one it would be worst to make unreadable.
  ['--text', 'the ghost button on the unreadable-data banner', BODY, 'the label of the start-fresh button'],
  ['--muted', 'the ghost button on the unreadable-data banner', LARGE, 'the border that sets the start-fresh button apart, at `src/styles.css:1514`'],
];

// Two of the surfaces this stylesheet paints on are not tokens and have no hex value to read, so a
// pair rendered on either could not be listed at all and both went ungated. That is the state this
// list exists to prevent, and the argument for computing them here rather than recording a gap: an
// unmeasurable boundary is one nobody can notice moving.
//
// Both are the same arithmetic, which is the reason one mechanism covers two CSS forms. Laying a
// translucent layer over an opaque backdrop and mixing two opaque colours in sRGB are both a
// straight interpolation of the gamma encoded channels, so each is a fraction of one colour plus
// the remainder of another. The tokens are still read out of the stylesheet, so changing `--rail`,
// `--panel` or `--warn` still moves the number.
//
// Checked against Edge before it was trusted, because arithmetic that agrees with itself proves
// nothing. Sampled from the painted pixels of the real app at 1280x900, the selected rail item
// composites to #1f1f24 and the recovery banner to #2d2220; in the light theme they are #dfdfe5
// and #f1eae1. All four are what this produces, so the gate and the browser agree to the byte. The
// test below pins those four values for that reason.
export const SURFACES = {
  'the selected rail item': {
    layer: '--tint-base',
    // 20/255, not 0.08. The browser quantizes an alpha to eight bits before it composites, so 8%
    // is laid down as 20/255 and the result is a unit lighter than the exact fraction gives. It is
    // invisible in the dark theme, where both round the same way, and one unit of blue out in the
    // light theme. Measured, not assumed: the painted pixel is 223,223,229 and exact 0.08 predicts
    // 228 in blue. The ghost button below already carries the same correction.
    fraction: 20 / 255,
    on: '--rail',
    css: 'rgb(var(--tint-base) / 8%) over the rail, at `src/styles.css:354`',
  },
  'the unreadable-data banner': {
    layer: '--warn',
    fraction: 0.12,
    on: '--panel',
    css: 'color-mix(in srgb, var(--warn) 12%, var(--panel)), at `src/styles.css:1490`',
  },
  // Built on a surface rather than a token, which is the case the first version of this could not
  // express. A ghost button is a tint over whatever it is dropped onto, so on the banner it is a
  // tint over a tint. Resolving only one level deep would have meant measuring this button against
  // the panel and reporting a contrast it never has.
  'the ghost button on the unreadable-data banner': {
    layer: '--tint-base',
    fraction: 0.05882,
    on: 'the unreadable-data banner',
    css: 'rgb(var(--tint-base) / 5.882%) over the banner, at `src/styles.css:600`',
  },
};

export function parseHex(hex) {
  let h = hex.trim().replace(/^#/, '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  return [0, 1, 2].map((i) => parseInt(h.slice(i * 2, i * 2 + 2), 16));
}

// `--tint-base` is declared as a bare `r g b` triple rather than a hex colour, because it is only
// ever used inside `rgb(... / n%)` where an alpha is appended. A hex parser alone cannot read it,
// and reading it is what lets a tinted surface be resolved.
export function parseColour(value) {
  const hex = parseHex(value);
  if (hex) return hex;
  const triple = value.trim().match(/^(\d{1,3})\s+(\d{1,3})\s+(\d{1,3})$/);
  if (!triple) return null;
  const rgb = [1, 2, 3].map((i) => Number(triple[i]));
  return rgb.every((v) => v <= 255) ? rgb : null;
}

// A fraction of one colour laid over the remainder of another, which is what the browser does for
// both an alpha composite onto an opaque backdrop and an sRGB colour mix.
//
// The base may itself be a surface, because a ghost button on the banner is a tint over a tint.
// `seen` is not defensive dressing: a surface list is hand written, and two entries naming each
// other would otherwise recurse until the stack ran out, which reports as a crash rather than as
// the authoring mistake it is.
export function resolveSurface(name, tokens, seen = new Set(), surfaces = SURFACES) {
  const surface = surfaces[name];
  if (!surface) return { message: `${name} is not a surface this file knows how to resolve` };
  if (seen.has(name)) return { message: `${name} is defined in terms of itself, so it cannot be resolved` };
  seen.add(name);
  const layer = parseColour(tokens.get(surface.layer) ?? '');
  let base = null;
  if (surface.on.startsWith('--')) {
    base = parseColour(tokens.get(surface.on) ?? '');
  } else {
    const under = resolveSurface(surface.on, tokens, seen, surfaces);
    if (under.message) return under;
    base = under.colour;
  }
  // A surface built from a token that is missing or unreadable is a finding rather than a skip, for
  // the same reason a missing token is: silently passing over one is how a pair stops being checked
  // without anybody deciding that it should.
  if (!layer) return { message: `${surface.layer} is not defined as a colour, so ${name} cannot be resolved` };
  if (!base) return { message: `${surface.on} is not defined as a colour, so ${name} cannot be resolved` };
  return { colour: layer.map((v, i) => Math.round(v * surface.fraction + base[i] * (1 - surface.fraction))) };
}

// A background is either a token or one of the surfaces above. Returning the same shape for both
// keeps the caller from having to know which it asked for.
function background(name, tokens) {
  if (!name.startsWith('--')) return resolveSurface(name, tokens);
  const raw = tokens.get(name);
  if (!raw) return { message: `${name} is not defined` };
  const colour = parseHex(raw);
  return colour ? { colour } : { message: `${name} is not a plain hex colour, so it cannot be measured` };
}

// WCAG relative luminance. The 0.03928 knee and the 2.4 exponent are the specification's, not a
// simplification of it, because a simplified curve moves ratios by enough to pass a failing pair.
export function luminance([r, g, b]) {
  const f = (v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function ratio(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Declarations are read in source order and later ones win, which is how the cascade resolves a
// token declared in both the shared block and a theme block.
export function tokensIn(css, selector) {
  const out = new Map();
  const shared = block(css, ':root {');
  const themed = block(css, selector);
  for (const src of [shared, themed]) {
    if (!src) continue;
    for (const m of src.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(m[1], m[2].trim());
  }
  return out;
}

function block(css, opener) {
  const at = css.indexOf(opener);
  if (at < 0) return null;
  const start = css.indexOf('{', at);
  let depth = 0;
  for (let i = start; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(start + 1, i);
    }
  }
  return null;
}

export function check(css, selector, themeName) {
  const tokens = tokensIn(css, selector);
  const findings = [];
  for (const [fgName, bgName, floor, where] of PAIRS) {
    const fgRaw = tokens.get(fgName);
    // A missing token is a finding rather than a skip. Silently passing over one is how a pair
    // stops being checked without anybody deciding that it should.
    if (!fgRaw) {
      findings.push({ themeName, fgName, bgName, message: `${fgName} is not defined for the ${themeName} theme` });
      continue;
    }
    const fg = parseHex(fgRaw);
    if (!fg) {
      findings.push({ themeName, fgName, bgName, message: `${fgName} is not a plain hex colour, so it cannot be measured` });
      continue;
    }
    const bgResult = background(bgName, tokens);
    if (!bgResult.colour) {
      findings.push({ themeName, fgName, bgName, message: `${bgResult.message} for the ${themeName} theme` });
      continue;
    }
    const r = ratio(fg, bgResult.colour);
    if (r < floor) {
      findings.push({
        themeName,
        fgName,
        bgName,
        ratio: r,
        where,
        message: `${fgName} on ${bgName} measures ${r.toFixed(2)}:1, below the ${floor}:1 floor, and is ${where}`,
      });
    }
  }
  return findings;
}

export function checkAll(css) {
  return [
    ...check(css, ':root, :root[data-theme="dark"]', 'dark'),
    ...check(css, ':root[data-theme="light"]', 'light'),
  ];
}

// Five non-text pairs sit below 3:1 and are recorded rather than fixed. BL-065 raised the other four.
//
// All four are `--track` against something behind it, and the reason they stay is arithmetic rather
// than reluctance. `--track` is the trough of a progress bar and the `--accent` fill sits directly on
// it, so the token has to answer to two floors at once. Colours clearing 3:1 against both surfaces
// behind the bar AND carrying the fill at 3:1 exist in the dark theme, but every one of them inverts
// it: each has a relative luminance of at least 0.611, which is 3.6 times the fill's 0.170, so the
// empty part of the bar would be brighter than the filled part. In the light theme no such colour
// exists at all, because the light fill is dark enough that nothing above black clears 3:1 beneath
// it. Either way the bar cannot report progress the right way round, which is a worse outcome for
// the reader than the recorded ratio. BL-166 re-derived both halves after it repainted the fill
// purple and rotated the neutrals, rather than carrying the old figures across a change that moved
// every term in them.
//
// The bar renders on two surfaces, not one, and review found the second: `.pbar` sits on a card and
// `.ri .bar` sits on the rail. Listing only the card is the same defect BL-065 fixed for `--line-2`
// and `--cb-line`, and it hid a real degradation, because darkening the dark trough took it from
// 1.47:1 to 1.30:1 against the rail with nothing recording the move. Both surfaces are listed now,
// so the trade is on the record in both places rather than only where it was convenient.
//
// So the pair that actually carries the value is measured instead: `--accent` on `--track` is in the
// list above at the 3:1 floor and passes in both themes, which is the same pair the rail bar uses,
// so the rail improved by exactly the amount the card bar did. The dark trough was darkened from
// #2a303c to #232731 to get there, taking the fill from 2.72 to 3.07; the light theme already
// measured 3.67. The bar is also never the only way to read progress, because the same numbers are
// stated as text beside it, at `src/js/main.js:1373` in the rail and `src/js/main.js:5381` in the
// saved lists.
//
// Those two citations, and the two in the fifth entry below, were all four lines out of date when
// BL-069 checked them, because nothing then gated a `path:line` written in a code comment: the
// anchors gate read tracked Markdown only, so a citation here drifted silently every time the file
// it named changed. BL-071 has since widened it to every tracked file, and the twelve citations in
// this one are now fingerprinted like any other. One of them was still wrong when they enrolled.
//
// They are recorded rather than waived because a gate that quietly tolerates its own findings is not
// a gate. The baseline is exact in both directions. A new pair below the floor fails, which is the
// obvious half. A listed pair that now passes ALSO fails, which is the half that matters: it is what
// stops this list outliving the debt it describes, and an accepted-failures list nobody prunes is
// how a gate turns into a rubber stamp.
export const KNOWN = [
  'dark:--track:--card',
  'light:--track:--card',
  'dark:--track:--rail',
  'light:--track:--rail',
  // The fifth is a different case from the four above and is recorded for a different reason. The
  // white tick inside a checked read checkbox is 1.93:1 on the dark `--teal` fill, and 6.54:1 on
  // the light one, so only the dark theme is below the floor. BL-166 moved it from 2.30:1 when it
  // replaced the old green fill with `#3fcfbb`, and re-affirmed the decision below on the new
  // arithmetic rather than inheriting it: a pair already recorded is exactly the pair a later
  // change is most able to worsen without anybody noticing.
  //
  // BL-069 was the item that had to choose, and it chose to leave it. The choice is arithmetic
  // rather than preference, and the arithmetic is not the trough's. A trough clearing the card, the
  // rail and its own fill while staying darker than that fill does not exist: a search of all
  // 16,777,216 sRGB colours returns none. A fill clearing all three of its floors does exist, and
  // 2,138,235 of them do, so this one was a genuine choice.
  //
  // What decided it is what the choice costs. White on a fill reaching 3:1 caps that fill's relative
  // luminance at 0.3000, and the shipped teal is at 0.4927. Every fill under that cap reads at
  // most 6.27:1 on the page and 5.80:1 on a card, against 9.72:1 and 8.99:1 today, so clearing the
  // tick costs the available badge between 3.19 and 3.45 of its ratio, depending on which surface it
  // is read against. The nearest feasible fill to the shipped one, #3aa2b3, lands exactly on 3.00:1
  // with no margin at all.
  //
  // That is a trade of contrast on text for contrast on a glyph, and the glyph is the side that
  // carries nothing. The badge is language a reader has to read. The tick is not read by anybody:
  // the button takes its accessible name from the `aria-label` at `src/js/main.js:2758`, which
  // replaces the glyph in the name computation, and `aria-pressed` at `src/js/main.js:2757`
  // carries the state besides. The fill already says the box is checked, emphatically, at 8.99:1
  // against a card and 9.72:1 against the page. Taking that much ratio away from words that are
  // read, to give it to a symbol that is not, is a worse outcome for the reader who needs the
  // contrast most.
  //
  // So the tick is reinforcement drawn on an already unmistakable fill, which is the same judgement
  // BL-049 reached about the badge borders and BL-067 about the switch graphic. This line is what
  // keeps the number visible, and the figures above are what a later change has to argue against
  // rather than reopen from nothing.
  //
  // The classification is what makes this entry eligible at all, and it deserves stating rather
  // than assuming, because the test below rejects any recorded pair carrying the 4.5:1 text floor.
  // WCAG scopes text to characters that express something in human language. A tick is a symbol
  // that happens to arrive as a font glyph, and here it is never language to anybody. It is a state
  // indicator drawn on a control, so the floor is the 3:1 of 1.4.11 and not the 4.5:1 of 1.4.3.
  // If that reading is ever overturned, this entry is not eligible and the green has to change.
  'dark:--on-accent:--teal',
];

export function unresolved(css) {
  const found = checkAll(css).map((f) => ({ ...f, key: `${f.themeName}:${f.fgName}:${f.bgName}` }));
  const keys = new Set(found.map((f) => f.key));
  const fresh = found.filter((f) => !KNOWN.includes(f.key));
  const fixed = KNOWN.filter((k) => !keys.has(k));
  // `found` comes back too so the passing path can print what each recorded pair currently measures.
  // Review found the backlog and the changelog both claiming the ratio was printed on every run when
  // only the count was, and the number was reachable only under a `--report` flag no CI step passes.
  const recorded = KNOWN.map((k) => found.find((f) => f.key === k)).filter(Boolean);
  return { fresh, fixed, recorded };
}

function main() {
  const css = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');

  if (process.argv.includes('--report')) {
    for (const [selector, themeName] of [[':root, :root[data-theme="dark"]', 'dark'], [':root[data-theme="light"]', 'light']]) {
      const tokens = tokensIn(css, selector);
      console.log(`\n${themeName}`);
      for (const [fgName, bgName, floor] of PAIRS) {
        const fg = parseHex(tokens.get(fgName) || '');
        const bg = background(bgName, tokens).colour ?? null;
        const r = fg && bg ? ratio(fg, bg) : null;
        const mark = r === null ? '  ?' : r < floor ? 'FAIL' : '  ok';
        console.log(`  ${mark}  ${(r === null ? '     ' : r.toFixed(2).padStart(5))}  (${floor})  ${fgName} on ${bgName}`);
      }
    }
    return;
  }

  const { fresh, fixed } = unresolved(css);
  for (const f of fresh) console.log(`  ${f.themeName}: ${f.message}`);
  for (const k of fixed) {
    console.log(`  ${k} now meets the floor. Remove it from KNOWN in scripts/check-palette.mjs, and update the Issue that owns the correction.`);
  }
  if (fresh.length || fixed.length) {
    console.log(`\n${fresh.length} new pair(s) below the floor, ${fixed.length} recorded pair(s) no longer below it.`);
    process.exitCode = 1;
    return;
  }
  const lines = passingReport(css);
  // A null report means the tree is not clean, which the guard above should already have caught.
  // Asserting it here rather than trusting the ordering keeps the two halves from drifting apart.
  if (!lines) throw new Error('passingReport refused a tree that the guard above passed as clean');
  for (const line of lines) console.log(line);
}

// The passing path's output is built rather than printed inline so a test can assert on it. Review
// found the previous version pinned only `unresolved`, one level below the claim: deleting the print
// loop and its destructure left the suite green, the gate exit 0, and three prose statements that the
// ratio is printed on every run false again. The test spawns this script and reads stdout, so the
// thing the docs claim is the thing that is checked.
//
// Everything in the report derives from the module's own data. An earlier version took the pair count
// as a parameter, which put half the summary line under the caller's control and half under the
// module's, and the pair count is the one figure that has gone stale in this item's prose three times.
// It also hardcoded "0 new", which is true only past `main()`'s guard: exported, that made a function
// that reports green for a red tree. It returns null on a tree with unresolved findings instead, so a
// caller that skips the check gets nothing rather than a reassuring lie.
export function passingReport(css) {
  const { fresh, fixed, recorded } = unresolved(css);
  if (fresh.length || fixed.length) return null;
  const measured = PAIRS.length * 2;
  const lines = [`${measured} pairs measured across the dark and light themes, ${KNOWN.length} recorded below the floor, ${fresh.length} new.`];
  // The recorded ones report their current ratio rather than only their count. A number nobody can
  // see cannot be noticed drifting, and these are exactly the pairs a later change is most likely to
  // move, since the gate stays green anywhere between the floor and 1:1.
  for (const f of recorded) {
    lines.push(`  ${f.ratio === undefined ? '   ?' : `${f.ratio.toFixed(2)}:1`}  ${f.fgName} on ${f.bgName} (${f.themeName}), ${f.where || f.message}`);
  }
  return lines;
}

if (process.argv[1] && process.argv[1].endsWith('check-palette.mjs')) main();
