import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SCALE, grammarFindings, scaleFindings, spacingInventory, usageFindings,
  TOKENS, TOKEN_SHEETS, rootTokens, resolveTokens, tokenDefinitionFindings, tokenFindings, tokenGrammarFindings,
  tokenUsageFindings,
} from '../scripts/check-spacing.mjs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const mobile = readFileSync(new URL('../packaging/android/web/mobile.css', import.meta.url), 'utf8');
const sheets = (styles = css, overlay = mobile) => [[TOKEN_SHEETS[0], styles], [TOKEN_SHEETS[1], overlay]];

// What one rule appended to a stylesheet adds to that sheet's token findings.
function rawFindings(rule, sheet = 0) {
  const [file, source] = sheets()[sheet];
  return tokenGrammarFindings(file, `${source}\n${rule}\n`);
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

test('radius values in either stylesheet come only from radius tokens', () => {
  for (const [file, source] of sheets()) assert.deepEqual(tokenGrammarFindings(file, source), [], file);
  for (const [rule, sheet, expected] of [
    ['.x { border-radius: 5px; }', 0, ['carries raw radius value 5px']],
    ['.x { border-top-left-radius: 50%; }', 0, ['carries raw radius value 50%']],
    ['.x { border-radius: calc(var(--radius-md) - 1px); }', 0, ['carries raw radius value calc(var(--radius-md) - 1px)']],
    ['.x { border-radius: var(--space-4); }', 0, ['uses var(--space-4), which is not a radius token']],
    ['.x { border-radius: 12px 12px 0 0; }', 1, ['carries raw radius value 12px', 'carries raw radius value 12px']],
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
