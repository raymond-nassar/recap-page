import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SCALE, grammarFindings, scaleFindings, spacingInventory, usageFindings,
} from '../scripts/check-spacing.mjs';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

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
