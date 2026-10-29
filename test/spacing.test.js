import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SCALE, declarations, grammarFindings, scaleFindings, spacingInventory, usageFindings,
  TOKENS, TOKEN_SHEETS, lengthTokens, rootTokens, resolveTokens, tokenDefinitionFindings, tokenFindings,
  tokenGrammarFindings, tokenUsageFindings,
} from '../scripts/check-spacing.mjs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../packaging/android/web/mobile.css', import.meta.url), 'utf8');
const ios = readFileSync(new URL('../packaging/ios/web/ios.css', import.meta.url), 'utf8');
const launcher = readFileSync(new URL('../packaging/ios/web/launcher.css', import.meta.url), 'utf8');
const sheets = (styles = css, overlay = mobile, iosOverlay = ios, launcherOverlay = launcher) => [
  [TOKEN_SHEETS[0], styles], [TOKEN_SHEETS[1], overlay], [TOKEN_SHEETS[2], iosOverlay],
  [TOKEN_SHEETS[3], launcherOverlay],
];

// What one rule appended to a stylesheet adds to that sheet's token findings.
function rawFindings(rule, sheet = 0) {
  const all = sheets().map(([file, source], i) => [file, i === sheet ? `${source}\n${rule}\n` : source]);
  const [file, source] = all[sheet];
  return tokenGrammarFindings(file, source, lengthTokens(all));
}

test('the spacing ladder declares the selected ordered steps', () => {
  assert.deepEqual(scaleFindings(css), []);
  assert.deepEqual(
    [...SCALE.values()],
    ['.125rem', '.25rem', '.375rem', '.5rem', '.75rem', '1rem', '1.25rem', '1.5rem', '2rem', '2.5rem', '3rem'],
  );

  const changed = css.replace('--space-1: .125rem;', '--space-1: .13rem;');
  assert.deepEqual(scaleFindings(changed), ['--space-1 is .13rem, not .125rem']);
});

test('every spacing step is consumed by a governed declaration', () => {
  assert.deepEqual(usageFindings(css), []);
});

test('governed spacing accepts only the scale, token derivations and classified geometry', () => {
  assert.deepEqual(grammarFindings(css), []);
  assert.ok(css.includes('gap: var(--space-5);'), 'the rogue-token mutation target is missing');
  const changed = css
    .replace(':root {', ':root {\n  --rogue: .7rem;')
    .replace('gap: var(--space-5);', 'gap: var(--rogue);');
  const findings = grammarFindings(changed);
  assert.ok(findings.some((finding) => finding.includes('consumes unclassified --rogue: .7rem')));

  for (const value of ['1vw', '10%', '13px']) {
    const property = value === '13px' ? 'PADDING' : 'padding';
    const terminator = value === '13px' ? '' : ';';
    const bypass = `.sample { ${property}: ${value}${terminator} }`;
    assert.ok(
      grammarFindings(bypass).some((finding) => finding.includes('unsupported spacing value')),
      `${property}: ${value} bypassed the governed grammar`,
    );
  }
  const safeArea = 'var(--space-2) var(--space-2) calc(var(--space-2) + env(safe-area-inset-bottom))';
  const clearance = 'calc(var(--mobile-nav-height, 80px) + var(--space-6))';
  for (const rule of [
    `.sample { padding: ${safeArea}; }`,
    `.rail-header { margin: ${safeArea}; }`,
    `.rail-header { padding: ${safeArea.replace('inset-bottom', 'inset-top')}; }`,
    `.rail-header { padding: ${safeArea.replace('var(--space-2) +', '3px +')}; }`,
    `.rail-header { padding: ${safeArea.replace('--space-2', '--unknown')}; }`,
    `.sample { padding-bottom: ${clearance}; }`,
    `main { margin-bottom: ${clearance}; }`,
    `main { padding-bottom: ${clearance.replace('80px', '81px')}; }`,
    `main { padding-bottom: ${clearance.replace('var(--space-6)', '13px')}; }`,
    `main { padding-bottom: ${clearance.replace('--mobile-nav-height', '--unknown')}; }`,
  ]) {
    assert.ok(grammarFindings(`${css}\n${rule}`).length, `unclassified geometry passed: ${rule}`);
  }
});

test('the baseline inventory maps every normalized spacing value exactly once', () => {
  const fixture = `
    .sample {
      margin: -.35rem 0 .6rem;
      padding: 1px 1.4rem 15rem;
      gap: 2.4rem;
    }
  `;
  const inventory = spacingInventory(fixture);
  assert.deepEqual(inventory.unmapped, []);
  assert.deepEqual(inventory.multiplyMapped, []);
  assert.deepEqual(inventory.mapping, [
    { px: -5.6, target: 'calc(-1 * var(--space-3))' },
    { px: 1, target: 'calc(var(--space-1) / 2)' },
    { px: 9.6, target: 'var(--space-4)' },
    { px: 22.4, target: 'var(--space-8)' },
    { px: 38.4, target: 'var(--space-10)' },
    { px: 240, target: 'var(--setting-control-reserve)' },
  ]);
});

// -- design tokens (#827) --

test('design tokens are declared once, in the shared :root block, with their listed values', () => {
  assert.deepEqual(tokenFindings(sheets()), []);
  const has = (findings, text) => findings.some((finding) => finding.includes(text));

  assert.deepEqual(tokenDefinitionFindings(sheets(css.replace('--radius-md: 8px;', '--radius-md: 9px;'))),
    ['--radius-md is 9px, not 8px']);
  const overlay = tokenDefinitionFindings(sheets(css, `${mobile}\n:root { --radius-md: 8px; }\n`));
  assert.ok(has(overlay, 'packaging/android/web/mobile.css line') && has(overlay, 'declares --radius-md outside the shared :root block'), overlay.join('\n'));
  assert.ok(has(overlay, 'declares --radius-md a second time'), overlay.join('\n'));
  const iosOverlay = tokenDefinitionFindings(sheets(css, mobile, `${ios}\n:root { --radius-md: 8px; }\n`));
  assert.ok(has(iosOverlay, 'packaging/ios/web/ios.css line') && has(iosOverlay, 'declares --radius-md outside the shared :root block'), iosOverlay.join('\n'));
  const themed = tokenDefinitionFindings(sheets(css.replace(':root[data-theme="light"] {', ':root[data-theme="light"] {\n  --radius-lg: 12px;')));
  assert.ok(has(themed, 'declares --radius-lg outside the shared :root block'), themed.join('\n'));
  assert.ok(has(tokenDefinitionFindings(sheets(css.replace('--radius-sm: 4px;', '--radius-sm: 4px;\n  --radius-rogue: 7px;'))),
    'declares unclassified token --radius-rogue: 7px'));
  assert.deepEqual(tokenDefinitionFindings(sheets(css.replace(/\n {2}--radius-sm: 4px;/, ''))), ['--radius-sm is missing']);
});

test('every listed token is declared with its listed value, and the resolver reads them back', () => {
  const tokens = rootTokens(css);
  for (const [name, { value }] of TOKENS) assert.equal(tokens.get(name), value, name);
  assert.equal(resolveTokens('0 var(--radius-marker) var(--radius-marker) 0', tokens), '0 3px 3px 0');
});

test('radius values in every stylesheet come only from radius tokens', () => {
  for (const [file, source] of sheets()) assert.deepEqual(tokenGrammarFindings(file, source), [], file);
  for (const [rule, sheet, expected] of [
    ['.x { border-radius: 5px; }', 0, ['carries raw radius value 5px']],
    ['.x { border-top-left-radius: 50%; }', 0, ['carries raw radius value 50%']],
    ['.x { border-radius: calc(var(--radius-md) - 1px); }', 0, ['carries raw radius value calc(var(--radius-md) - 1px)']],
    ['.x { border-radius: var(--space-4); }', 0, ['uses var(--space-4), which is not a radius token']],
    ['.x { border-radius: 12px 12px 0 0; }', 1, ['carries raw radius value 12px', 'carries raw radius value 12px']],
    ['.x { border-radius: 6px; }', 2, ['carries raw radius value 6px']],
  ]) {
    const findings = rawFindings(rule, sheet);
    assert.equal(findings.length, expected.length, `${rule}: ${findings.join('; ')}`);
    expected.forEach((text, i) => assert.ok(findings[i].endsWith(text), `${rule}: ${findings[i]}`));
  }
  for (const rule of [
    '.x { border-radius: 0 var(--radius-marker) var(--radius-marker) 0; }',
    '.x { border-radius: inherit; }',
    '.x { border-radius: var(--radius-lg) / var(--radius-md) !important; }',
  ]) assert.deepEqual(rawFindings(rule), [], rule);
});

test('a radius kept off the scale exists only for what wears it, and a scale step may wait', () => {
  assert.deepEqual(tokenUsageFindings(sheets()), []);
  const unworn = css.replaceAll('border-radius: var(--radius-callout)', 'border-radius: var(--radius-lg)');
  assert.notEqual(unworn, css, 'the --radius-callout consumers are missing');
  assert.deepEqual(tokenUsageFindings(sheets(unworn)),
    ['--radius-callout holds 10px for bordered callouts in the shelf and the timeline, but nothing uses it']);
  const waiting = css.replaceAll('var(--radius-sm)', 'var(--radius-md)');
  assert.notEqual(waiting, css, 'the --radius-sm consumer is missing');
  assert.deepEqual(tokenUsageFindings(sheets(waiting)), []);
});

test('stroke widths come only from stroke tokens, while a stroke may name its colour through any token', () => {
  for (const [file, source] of sheets()) assert.deepEqual(tokenGrammarFindings(file, source, lengthTokens(sheets())), [], file);
  for (const [rule, sheet, expected] of [
    ['.x { border: 1px solid var(--line); }', 0, ['carries raw stroke value 1px']],
    ['.x { border-bottom-width: thin; }', 0, ['carries raw stroke value thin']],
    ['.x { border-top: calc(var(--stroke-1) * 2) solid var(--line); }', 0, ['carries raw stroke value calc(var(--stroke-1) * 2)']],
    ['.x { text-decoration-thickness: .1em; }', 0, ['carries raw stroke value .1em']],
    ['.x { border-left: var(--radius-sm) solid var(--accent); }', 0, ['uses var(--radius-sm), which is not a stroke token']],
    ['.x { --rule-width: 2px; border: var(--rule-width) solid var(--line); }', 0, ['uses var(--rule-width), which is not a stroke token']],
    ['.x { border-inline-start: var(--space-1) solid var(--line); }', 1, ['uses var(--space-1), which is not a stroke token']],
    ['.x { border: 2px solid CanvasText; }', 1, ['carries raw stroke value 2px']],
  ]) {
    const findings = rawFindings(rule, sheet);
    assert.equal(findings.length, expected.length, `${rule}: ${findings.join('; ')}`);
    expected.forEach((text, i) => assert.ok(findings[i].endsWith(text), `${rule}: ${findings[i]}`));
  }
  for (const rule of [
    '.x { border: var(--stroke-1) solid var(--line); border-top: none; }',
    '.x { border: 0; }',
    '.x { border: var(--stroke-2) dashed rgb(var(--shadow-rgb) / 20%) !important; }',
    '.x { border-bottom: var(--stroke-checkbox) solid color-mix(in srgb, var(--accent) 40%, transparent); }',
    '.x { text-decoration-thickness: var(--stroke-1); }',
  ]) assert.deepEqual(rawFindings(rule), [], rule);

  // The overlay draws with widths the main stylesheet declares, so the whole check reads lengths across
  // both sheets: one sheet alone would take a spacing step in the overlay for a colour.
  const overlay = `${mobile}\n.x { border: var(--space-1) solid var(--line); }\n`;
  assert.deepEqual(tokenGrammarFindings(TOKEN_SHEETS[1], overlay), []);
  assert.ok(tokenFindings(sheets(css, overlay)).some((finding) => finding.endsWith('uses var(--space-1), which is not a stroke token')));

  const unworn = css.replace('border: var(--stroke-checkbox) solid var(--cb-line)', 'border: var(--stroke-2) solid var(--cb-line)');
  assert.notEqual(unworn, css, 'the --stroke-checkbox consumer is missing');
  assert.deepEqual(tokenUsageFindings(sheets(unworn)), ['--stroke-checkbox holds 1.5px for the read checkbox, but nothing uses it']);
});

test('iOS launcher hit areas use the shared target token', () => {
  assert.deepEqual(tokenGrammarFindings(TOKEN_SHEETS[3], launcher), []);
  assert.deepEqual(tokenUsageFindings(sheets()), []);
  const rawTarget = tokenGrammarFindings(TOKEN_SHEETS[3], launcher.replaceAll('var(--target)', '44px'));
  assert.ok(rawTarget.some((finding) => finding.includes('carries raw target value 44px')));
});

test('a shadow is a whole elevation token or a ring drawn with stroke widths, and a text shadow is a token', () => {
  for (const [rule, sheet, expected] of [
    ['.x { box-shadow: 0 4px 12px rgb(var(--shadow-rgb) / 20%); }', 0, ['carries raw shadow value 4px', 'carries raw shadow value 12px']],
    ['.x { box-shadow: inset 0 0 0 1px var(--line); }', 0, ['carries raw shadow value 1px']],
    ['.x { box-shadow: var(--elev-tooltip), 0 0 0 2px var(--accent); }', 0, ['carries raw shadow value 2px']],
    ['.x { box-shadow: 0 0 0 var(--space-1) var(--line); }', 0, ['uses var(--space-1), which is not a shadow token']],
    ['.x { box-shadow: var(--text-shadow-art); }', 0, ['uses var(--text-shadow-art), which is not a shadow token']],
    ['.x { --lift: 0 2px 6px black; box-shadow: var(--lift); }', 0, ['uses var(--lift), which is not a shadow token']],
    ['.x { box-shadow: inset 0 0 0 var(--lift) var(--line); --lift: 0 2px; }', 0, ['uses var(--lift), which is not a shadow token']],
    ['.x { text-shadow: 1px 1px 0 var(--accent); }', 0, ['carries raw text shadow value 1px 1px 0 var(--accent)']],
    ['.x { text-shadow: var(--elev-cover); }', 0, ['uses var(--elev-cover), which is not a text shadow token']],
    ['.x { box-shadow: 0 8px 24px rgb(var(--shadow-rgb) / 24%); }', 1, ['carries raw shadow value 8px', 'carries raw shadow value 24px']],
  ]) {
    const findings = rawFindings(rule, sheet);
    assert.equal(findings.length, expected.length, `${rule}: ${findings.join('; ')}`);
    expected.forEach((text, i) => assert.ok(findings[i].endsWith(text), `${rule}: ${findings[i]}`));
  }
  for (const rule of [
    '.x { box-shadow: var(--elev-row-actions); }',
    '.x { box-shadow: var(--elev-tooltip), inset 0 0 0 var(--stroke-1) var(--line-2) !important; }',
    '.x { box-shadow: inset 0 calc(-1 * var(--stroke-3)) 0 currentColor; }',
    '.x { box-shadow: 0 0 0 var(--stroke-node-halo) var(--bg); }',
    '.x { box-shadow: none; text-shadow: none; }',
    '.x { text-shadow: var(--text-shadow-offset); }',
  ]) assert.deepEqual(rawFindings(rule), [], rule);

  // A role token stands for a surface that already plays that role with a shadow scaled by
  // `--shadow-alpha`; every other shadow keeps a token named for its surface until it gains one.
  for (const [name, { family, scale, value }] of TOKENS) {
    if (family === 'elevation' && scale) assert.match(value, /var\(--shadow-alpha\)/, name);
  }

  // The Done bar's shadow is worn only by the Android overlay, and the overlay's use is enough.
  const undone = mobile.replace('box-shadow: var(--elev-done-bar)', 'box-shadow: var(--elev-row-actions)');
  assert.notEqual(undone, mobile, 'the --elev-done-bar consumer is missing');
  assert.deepEqual(tokenUsageFindings(sheets(css, undone)),
    ['--elev-done-bar holds 0 8px 24px rgb(var(--shadow-rgb) / 24%) for the Android Done bar, but nothing uses it']);
});

test('durations come only from motion tokens, and step one keeps its one easing, ease', () => {
  for (const [rule, sheet, expected] of [
    ['.x { transition: opacity 200ms; }', 0, ['carries raw motion value 200ms']],
    ['.x { transition: opacity var(--motion-fast) ease-in-out; }', 0, ['carries raw motion value ease-in-out']],
    ['.x { animation: spin 1s linear infinite; }', 0, ['carries raw motion value 1s', 'carries raw motion value linear']],
    ['.x { transition-timing-function: cubic-bezier(.2, 0, 0, 1); }', 0, ['carries raw motion value cubic-bezier(.2, 0, 0, 1)']],
    ['.x { transition-duration: var(--stroke-1); }', 0, ['uses var(--stroke-1), which is not a motion token']],
    ['.x { --fade: 200ms; transition: opacity var(--fade); }', 0, ['uses var(--fade), which is not a motion token']],
    ['.x { transition: transform .2s ease; }', 1, ['carries raw motion value .2s']],
  ]) {
    const findings = rawFindings(rule, sheet);
    assert.equal(findings.length, expected.length, `${rule}: ${findings.join('; ')}`);
    expected.forEach((text, i) => assert.ok(findings[i].endsWith(text), `${rule}: ${findings[i]}`));
  }
  for (const rule of [
    '.x { transition: transform var(--motion-fast) ease, border-color var(--motion-hover); }',
    '.x { transition: opacity var(--motion-normal) var(--ease-out); transition-delay: 0s; }',
    '.x { transition: none; animation: none !important; }',
  ]) assert.deepEqual(rawFindings(rule), [], rule);

  const unworn = css.replaceAll('var(--motion-hover)', 'var(--motion-fast)');
  assert.notEqual(unworn, css, 'the --motion-hover consumer is missing');
  assert.deepEqual(tokenUsageFindings(sheets(unworn)), ['--motion-hover holds 120ms for the hover on a Home path card, but nothing uses it']);
});

test('reduced motion still stops every transition and animation, and nothing outranks it', () => {
  // The universal rule has no specificity, so any other important transition or animation would win
  // over it and move for a reader who asked for no motion.
  const important = sheets().flatMap(([file, source]) => declarations(source)
    .filter(({ property, value }) => /^(?:transition|animation)/.test(property) && /!important\s*$/i.test(value))
    .map(({ selector, property, value }) => `${file} ${selector.replace(/\s+/g, ' ').trim()} ${property}: ${value.trim()}`));
  assert.deepEqual(important, [
    'src/styles.css @media (prefers-reduced-motion: reduce) { *, *::before, *::after transition: none !important',
    'src/styles.css @media (prefers-reduced-motion: reduce) { *, *::before, *::after animation: none !important',
  ]);
});

test('a focus ring takes its width and offset from the focus tokens, and any other outline is a stroke', () => {
  for (const [rule, sheet, expected] of [
    ['.x { outline: 3px solid var(--blue); }', 0, ['carries raw outline value 3px']],
    ['.x { outline-width: thin; }', 0, ['carries raw outline value thin']],
    ['.x { outline: var(--focus-offset) solid var(--blue); }', 0, ['uses var(--focus-offset), which is not an outline token']],
    ['.x { outline-offset: 2px; }', 0, ['carries raw outline offset value 2px']],
    ['.x { outline-offset: -3px; }', 0, ['carries raw outline offset value -3px']],
    ['.x { outline-offset: var(--stroke-2); }', 0, ['uses var(--stroke-2), which is not an outline offset token']],
    ['.x { outline: 2px solid Highlight; }', 1, ['carries raw outline value 2px']],
  ]) {
    const findings = rawFindings(rule, sheet);
    assert.equal(findings.length, expected.length, `${rule}: ${findings.join('; ')}`);
    expected.forEach((text, i) => assert.ok(findings[i].endsWith(text), `${rule}: ${findings[i]}`));
  }
  for (const rule of [
    '.x { outline: var(--focus-width) solid var(--blue); outline-offset: var(--focus-offset); }',
    '.x { outline-offset: calc(-1 * var(--focus-width)); }',
    '.x { outline: var(--stroke-2) solid Highlight; }',
    '.x { outline: none; outline-offset: 0; }',
  ]) assert.deepEqual(rawFindings(rule), [], rule);

  const unworn = css.replace('outline-offset: var(--focus-offset-code)', 'outline-offset: var(--focus-offset)');
  assert.notEqual(unworn, css, 'the --focus-offset-code consumer is missing');
  assert.deepEqual(tokenUsageFindings(sheets(unworn)), ['--focus-offset-code holds 3px for a code example in the import guide, but nothing uses it']);
});

test('a minimum of 24, 44 or 48 pixels is a target and names its token, and other minimums stay layout', () => {
  for (const [rule, sheet, expected] of [
    ['.x { min-height: 44px; }', 0, ['carries raw target value 44px']],
    ['.x { min-width: 24px; min-height: 48px; }', 0, ['carries raw target value 24px', 'carries raw target value 48px']],
    ['.x { min-block-size: 44px; }', 0, ['carries raw target value 44px']],
    ['.x { min-height: var(--radius-card); }', 0, ['uses var(--radius-card), which is not a target token']],
    ['.x { min-height: 48px; }', 1, ['carries raw target value 48px']],
  ]) {
    const findings = rawFindings(rule, sheet);
    assert.equal(findings.length, expected.length, `${rule}: ${findings.join('; ')}`);
    expected.forEach((text, i) => assert.ok(findings[i].endsWith(text), `${rule}: ${findings[i]}`));
  }
  for (const rule of [
    '.x { min-height: var(--target); min-width: var(--target-touch); }',
    '.x { min-height: 12rem; min-width: 0; }',
    '.x { min-height: calc(var(--mobile-nav-height, 80px) + var(--space-4)); }',
    '.x { min-height: 40px; }',
  ]) assert.deepEqual(rawFindings(rule), [], rule);
});
