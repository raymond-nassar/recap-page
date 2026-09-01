import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const SCALE = new Map([
  ['--space-1', '.125rem'],
  ['--space-2', '.25rem'],
  ['--space-3', '.375rem'],
  ['--space-4', '.5rem'],
  ['--space-5', '.75rem'],
  ['--space-6', '1rem'],
  ['--space-7', '1.25rem'],
  ['--space-8', '1.5rem'],
  ['--space-9', '2rem'],
  ['--space-10', '2.5rem'],
  ['--space-11', '3rem'],
]);

const SCALE_PX = [...SCALE.values()].map((value) => Number.parseFloat(value) * 16);
const CANDIDATES = new Map([
  ['selected-11', SCALE_PX],
  ['compact-9', [2, 4, 6, 8, 12, 16, 24, 32, 48]],
  ['quarter-rem-7', [4, 8, 12, 16, 24, 32, 48]],
]);
const SEMANTIC = new Map([
  ['--setting-control-reserve', {
    value: '15rem',
    consumers: [{ selector: '.setting', property: 'padding-right' }],
  }],
]);
const GOVERNED = /^(?:(?:margin|padding)(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|gap|row-gap|column-gap)$/;
const VARIABLE = String.raw`var\(\s*--[-\w]+\s*\)`;
const CALCULATION = String.raw`calc\((?:[\s+\-*/.\d()]|${VARIABLE})+\)`;
const SPACING_ATOM = String.raw`(?:0|auto|${VARIABLE}|${CALCULATION})`;
const SPACING_VALUE = new RegExp(String.raw`^${SPACING_ATOM}(?:\s+${SPACING_ATOM})*(?:\s*!important)?$`);

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length));
}

function lineAt(source, index) {
  return source.slice(0, index).split(/\r?\n/).length;
}

export function declarations(source) {
  const clean = stripComments(source);
  const out = [];
  const pattern = /([-\w]+)\s*:\s*([^;{}]+)(?:;|(?=\s*}))/g;
  for (const match of clean.matchAll(pattern)) {
    const open = clean.lastIndexOf('{', match.index);
    const previousClose = clean.lastIndexOf('}', open);
    const selector = clean.slice(previousClose + 1, open).trim();
    const property = match[1].startsWith('--') ? match[1] : match[1].toLowerCase();
    out.push({
      property,
      value: match[2].trim(),
      selector,
      index: match.index,
      line: lineAt(source, match.index),
    });
  }
  return out;
}

function customProperties(all) {
  const properties = new Map();
  for (const declaration of all.filter(({ property }) => property.startsWith('--'))) {
    properties.set(declaration.property, declaration);
  }
  return properties;
}

function varNames(value) {
  return [...value.matchAll(/var\(\s*(--[-\w]+)/g)].map((match) => match[1]);
}

export function scaleFindings(source) {
  const properties = customProperties(declarations(source));
  const findings = [];
  for (const [name, expected] of SCALE) {
    const declaration = properties.get(name);
    if (!declaration) findings.push(`${name} is missing`);
    else if (declaration.value !== expected) {
      findings.push(`${name} is ${declaration.value}, not ${expected}`);
    }
  }
  return findings;
}

export function grammarFindings(source) {
  const all = declarations(source);
  const properties = customProperties(all);
  const findings = [];

  for (const declaration of all.filter(({ property }) => GOVERNED.test(property))) {
    const normalizedValue = declaration.value
      .replace(/\bauto\b/gi, 'auto')
      .replace(/!important$/i, '!important');
    if (!SPACING_VALUE.test(normalizedValue)) {
      findings.push(`line ${declaration.line} ${declaration.property} carries unsupported spacing value ${declaration.value}`);
    }

    for (const name of varNames(declaration.value)) {
      if (SCALE.has(name)) continue;
      const semantic = SEMANTIC.get(name);
      if (!semantic) {
        const value = properties.get(name)?.value ?? 'an undeclared value';
        findings.push(`line ${declaration.line} ${declaration.property} consumes unclassified ${name}: ${value}`);
        continue;
      }
      const allowed = semantic.consumers.some(({ selector, property }) => (
        selector === declaration.selector && property === declaration.property
      ));
      if (!allowed) {
        findings.push(`line ${declaration.line} ${declaration.property} is not a classified consumer of ${name}`);
      }
    }
  }

  for (const [name, { value, consumers }] of SEMANTIC) {
    const declaration = properties.get(name);
    if (!declaration) findings.push(`${name} is missing`);
    else if (declaration.value !== value) findings.push(`${name} is ${declaration.value}, not ${value}`);
    for (const consumer of consumers) {
      const found = all.some((candidate) => (
        candidate.selector === consumer.selector
        && candidate.property === consumer.property
        && candidate.value === `var(${name})`
      ));
      if (!found) findings.push(`${name} has no classified ${consumer.selector} ${consumer.property} consumer`);
    }
  }

  return findings;
}

export function usageFindings(source) {
  const uses = new Set(
    declarations(source)
      .filter(({ property }) => GOVERNED.test(property))
      .flatMap(({ value }) => varNames(value)),
  );
  return [...SCALE.keys()].filter((name) => !uses.has(name)).map((name) => `${name} is unused`);
}

function normalizedLength(number, unit) {
  if (unit === 'rem') return number * 16;
  if (unit === 'px') return number;
  return null;
}

export function spacingInventory(source) {
  const governed = declarations(source).filter(({ property }) => GOVERNED.test(property));
  const values = [];
  for (const declaration of governed) {
    for (const match of declaration.value.matchAll(/(-?(?:\d*\.)?\d+)(rem|px|em)\b/g)) {
      const px = normalizedLength(Number.parseFloat(match[1]), match[2]);
      values.push({ text: match[0], px, line: declaration.line, property: declaration.property });
    }
  }

  const frequencies = new Map();
  for (const value of values.filter(({ px }) => px !== null)) {
    const key = Math.abs(value.px);
    frequencies.set(key, (frequencies.get(key) ?? 0) + 1);
  }
  const migratable = values.filter(({ px }) => px !== null && Math.abs(px) !== 1 && Math.abs(px) !== 240);

  const candidates = [...CANDIDATES].map(([name, steps]) => {
    let total = 0;
    let maximum = 0;
    let changed = 0;
    for (const value of migratable) {
      const distance = Math.min(...steps.map((step) => Math.abs(step - Math.abs(value.px))));
      total += distance;
      maximum = Math.max(maximum, distance);
      if (distance > 1e-9) changed += 1;
    }
    return {
      name,
      steps,
      changed,
      meanMovementPx: total / migratable.length,
      maximumMovementPx: maximum,
    };
  });

  const distinct = [...new Set(values.filter(({ px }) => px !== null).map(({ px }) => px))]
    .sort((a, b) => a - b);
  const mapping = distinct.map((px) => {
    const magnitude = Math.abs(px);
    if (magnitude === 1) {
      return { px, target: px < 0 ? 'calc(-1 * var(--space-1) / 2)' : 'calc(var(--space-1) / 2)' };
    }
    if (magnitude === 240) return { px, target: 'var(--setting-control-reserve)' };
    const distance = Math.min(...SCALE_PX.map((step) => Math.abs(step - magnitude)));
    const nearest = SCALE_PX.filter((step) => Math.abs(step - magnitude) === distance)
      .sort((a, b) => (frequencies.get(b) ?? 0) - (frequencies.get(a) ?? 0) || a - b)[0];
    const name = [...SCALE][SCALE_PX.indexOf(nearest)][0];
    return { px, target: px < 0 ? `calc(-1 * var(${name}))` : `var(${name})` };
  });

  return {
    declarations: governed.length,
    numericOccurrences: values.length,
    unsupportedOccurrences: values.filter(({ px }) => px === null),
    distinctValues: distinct.length,
    singletonValues: [...frequencies.values()].filter((count) => count === 1).length,
    frequencies: [...frequencies].sort((a, b) => a[0] - b[0]).map(([px, count]) => ({ px, count })),
    candidates,
    mapping,
    unmapped: distinct.filter((px) => !mapping.some((entry) => entry.px === px)),
    multiplyMapped: distinct.filter((px) => mapping.filter((entry) => entry.px === px).length !== 1),
  };
}

export function checkAll(source) {
  return [...scaleFindings(source), ...grammarFindings(source), ...usageFindings(source)];
}

function main() {
  const source = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');
  if (process.argv.includes('--inventory')) {
    console.log(JSON.stringify(spacingInventory(source), null, 2));
    return;
  }
  const findings = checkAll(source);
  if (findings.length) {
    console.error(`Spacing check found ${findings.length} problem(s):`);
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exitCode = 1;
    return;
  }
  console.log(`${SCALE.size} spacing steps; 0 raw, unclassified or unused governed values`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
