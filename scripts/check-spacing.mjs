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
// CSS owns the safe-area inset; wireMobileNavigation measures the bar height for main clearance.
const AUTHORED_GEOMETRY = [
  { selector: '.rail-header', property: 'padding',
    value: 'var(--space-2) var(--space-2) calc(var(--space-2) + env(safe-area-inset-bottom))' },
  { selector: 'main', property: 'padding-bottom',
    value: 'calc(var(--mobile-nav-height, 80px) + var(--space-6))' },
];
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
      .replace(/!important$/i, '!important')
      .replace(/\s+/g, ' ');
    if (AUTHORED_GEOMETRY.some(({ selector, property, value }) => (
      selector === declaration.selector && property === declaration.property && value === normalizedValue
    ))) continue;
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

// ---------------------------------------------------------------- design tokens
//
// #827 carries this gate past spacing to the other values both stylesheets draw with. Each is a token
// declared once, in the shared `:root` block of src/styles.css, with the value listed here, and a
// governed declaration in either stylesheet may name a value of its family only through one of them.
// The first step changed nothing on screen: every value in use became a token equal to itself. A value
// on #827's scales took that scale's token; every other value kept a token of its own, named for what
// wears it, so a later move onto a scale is a change to one token's value, made one screen at a time. A
// scale step may wait for its first consumer. A kept token exists only for the declarations that wear
// it, so it has to have one.
export const TOKEN_SHEETS = ['src/styles.css', 'packaging/android/web/mobile.css'];
const onScale = (family, value) => ({ family, value, scale: true });
const kept = (family, value, role) => ({ family, value, scale: false, role });

export const TOKENS = new Map([
  ['--radius-sm', onScale('radius', '4px')],
  ['--radius-md', onScale('radius', '8px')],
  ['--radius-lg', onScale('radius', '12px')],
  ['--radius-xl', onScale('radius', '16px')],
  ['--radius-pill', onScale('radius', '999px')],
  ['--radius-bar', kept('radius', '2px', 'the rail list progress bars')],
  ['--radius-marker', kept('radius', '3px', 'the current destination marker')],
  ['--radius-compact', kept('radius', '6px', 'thumbnails, compact controls, code and the focus ring')],
  ['--radius-callout', kept('radius', '10px', 'bordered callouts in the shelf and the timeline')],
  ['--radius-card', kept('radius', '14px', 'cards and disclosures')],
  ['--radius-feature', kept('radius', '20px', 'heroes, Home paths and Android sheets')],
  ['--radius-circle', kept('radius', '50%', 'dots, knobs and markers')],
  ['--stroke-1', onScale('stroke', '1px')],
  ['--stroke-2', onScale('stroke', '2px')],
  ['--stroke-3', onScale('stroke', '3px')],
  ['--stroke-checkbox', kept('stroke', '1.5px', 'the read checkbox')],
  ['--stroke-node', kept('stroke', '4px', 'the ring of a timeline era node')],
  ['--stroke-node-halo', kept('stroke', '5px', 'the halo around a timeline era node')],
  ['--elev-tooltip', onScale('elevation', '0 6px 20px rgb(var(--shadow-rgb) / calc(60% * var(--shadow-alpha)))')],
  ['--elev-action-tip', kept('elevation', '0 6px 18px rgb(var(--shadow-rgb) / 22%)', 'the action tip')],
  ['--elev-row-actions', kept('elevation', '0 8px 24px rgb(var(--shadow-rgb) / 28%)', 'the open row actions menu')],
  ['--elev-updates-panel', kept('elevation', '0 12px 28px rgb(var(--shadow-rgb) / 22%)', 'the Home updates panel')],
  ['--elev-selection-bar', kept('elevation', '0 -6px 20px rgb(var(--shadow-rgb) / calc(30% * var(--shadow-alpha)))', 'the selection bar')],
  ['--elev-done-bar', kept('elevation', '0 8px 24px rgb(var(--shadow-rgb) / 24%)', 'the Android Done bar')],
  ['--elev-cover', kept('elevation', '0 18px 46px rgb(var(--shadow-rgb) / calc(53.333% * var(--shadow-alpha)))', 'cover art in a hero')],
  ['--text-shadow-logotype', kept('elevation', '5px 5px 0 var(--accent)', 'the Home logotype')],
  ['--text-shadow-offset', kept('elevation', '.0625em .0625em 0 var(--accent)', 'the wrap-up cheer and the Android logotype')],
  ['--text-shadow-art', kept('elevation', '.055em .055em 0 rgb(var(--shadow-rgb) / 45%)', 'the initials on a cover placeholder')],
  ['--motion-fast', onScale('motion', '150ms')],
  ['--motion-normal', onScale('motion', '200ms')],
  ['--motion-slow', onScale('motion', '300ms')],
  ['--ease-out', onScale('motion', 'cubic-bezier(0, 0, 0, 1)')],
  ['--motion-hover', kept('motion', '120ms', 'the hover on a Home path card')],
  ['--motion-progress', kept('motion', '350ms', 'the progress ring and the glance bar fill')],
]);

const FAMILY_PREFIXES = new Map([
  ['radius', /^--radius-/],
  ['stroke', /^--stroke-/],
  ['elevation', /^--(?:elev|text-shadow)-/],
  ['motion', /^--(?:motion|ease)-/],
]);

function familyOf(name) {
  for (const [family, prefix] of FAMILY_PREFIXES) if (prefix.test(name)) return family;
  return null;
}

// Splits a value at its top level, outside any function's parentheses, into atoms and commas.
function atoms(value) {
  const parts = [];
  let depth = 0;
  let atom = '';
  for (const ch of value) {
    if (ch === '(') depth += 1;
    else if (ch === ')') depth -= 1;
    if (depth === 0 && (/\s/.test(ch) || ch === ',')) {
      if (atom) parts.push(atom);
      if (ch === ',') parts.push(',');
      atom = '';
    } else {
      atom += ch;
    }
  }
  if (atom) parts.push(atom);
  return parts;
}

// The token an atom names, directly or negated: `var(--name)` or `calc(-1 * var(--name))`.
function tokenOf(atom) {
  return /^var\(\s*(--[-\w]+)\s*\)$/.exec(atom)?.[1]
    ?? /^calc\(\s*-1\s*\*\s*var\(\s*(--[-\w]+)\s*\)\s*\)$/.exec(atom)?.[1]
    ?? null;
}

// The comma-separated layers of a value such as a shadow list, each as its atoms.
function layers(list) {
  const out = [[]];
  for (const atom of list) {
    if (atom === ',') out.push([]);
    else out.at(-1).push(atom);
  }
  return out;
}

const KEYWORDS = new Set(['0', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);

// A length, or a function that computes one, standing as one value.
const LENGTHY = /^(?:-?(?:\d*\.)?\d+[a-z%]+|(?:calc|min|max|clamp)\(.*\))$/i;
// A duration other than zero, and an easing other than `ease`, which step one kept as it was.
const DURATION = /^-?(?:\d*\.)?\d+m?s$/i;
const EASING = /^(?:(?:cubic-bezier|steps|linear)\(.*\)|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/i;

// Each family names the properties it governs and judges a value's atoms. An atom that names a token
// of an accepted family is fine, a token of any other family is the wrong kind of value, and `raw`
// says which of the remaining atoms are values of this family that have to come from a token. A
// stroke names its colour through a token outside the families, so `accepts` is also handed the
// custom properties whose value is a length, which would carry a width past the gate under a colour's
// name. A shadow is judged a layer at a time: `whole` names the tokens that stand for an entire layer,
// and a layer that is not one of them is a ring drawn with stroke widths, or, where the family has no
// `raw` test, a raw value in itself.
const TOKEN_RULES = [
  {
    family: 'radius',
    properties: /^border(?:-(?:top|bottom|start|end)-(?:left|right|start|end))?-radius$/,
    accepts: (name) => familyOf(name) === 'radius',
    raw: (atom) => !KEYWORDS.has(atom) && atom !== '/',
  },
  {
    family: 'stroke',
    properties: /^(?:border(?:-(?:top|right|bottom|left|block|inline)(?:-(?:start|end))?)?(?:-width)?|column-rule(?:-width)?|text-decoration-thickness)$/,
    accepts: (name, lengths) => familyOf(name) === 'stroke' || (!familyOf(name) && !lengths.has(name)),
    raw: (atom) => LENGTHY.test(atom) || /^(?:thin|medium|thick)$/i.test(atom),
  },
  {
    family: 'shadow',
    properties: /^box-shadow$/,
    whole: (name) => name.startsWith('--elev-'),
    accepts: (name, lengths) => familyOf(name) === 'stroke' || (!familyOf(name) && !lengths.has(name)),
    raw: (atom) => LENGTHY.test(atom),
  },
  {
    family: 'text shadow',
    properties: /^text-shadow$/,
    whole: (name) => name.startsWith('--text-shadow-'),
  },
  {
    family: 'motion',
    properties: /^(?:transition|animation)(?:-(?:duration|delay|timing-function))?$/,
    accepts: (name) => familyOf(name) === 'motion',
    raw: (atom) => (DURATION.test(atom) && Number.parseFloat(atom) !== 0) || EASING.test(atom),
  },
];

function lastSelector(selector) {
  return selector.slice(selector.lastIndexOf('{') + 1).replace(/\s+/g, ' ').trim();
}

// Every custom property a bare `:root` rule declares, by name, for the tests that pin a rendered value
// through the token a rule now names.
export function rootTokens(source) {
  const tokens = new Map();
  for (const declaration of declarations(source)) {
    if (declaration.property.startsWith('--') && lastSelector(declaration.selector) === ':root') {
      tokens.set(declaration.property, declaration.value.replace(/\s+/g, ' ').trim());
    }
  }
  return tokens;
}

export function resolveTokens(value, tokens) {
  let current = value;
  for (let i = 0; i < 12; i += 1) {
    const next = current.replace(/var\(\s*(--[-\w]+)\s*\)/g, (whole, name) => tokens.get(name) ?? whole);
    if (next === current) return current;
    current = next;
  }
  throw new Error(`${value} does not resolve: its tokens refer to each other`);
}

// Every custom property, in any of the sheets and under any selector, whose value is a length or
// carries one, such as a whole shadow.
export function lengthTokens(sheets) {
  const values = new Map();
  for (const [, source] of sheets) {
    for (const { property, value } of declarations(source)) {
      if (property.startsWith('--')) values.set(property, [...(values.get(property) ?? []), value.replace(/\s+/g, ' ').trim()]);
    }
  }
  const first = new Map([...values].map(([name, list]) => [name, list[0]]));
  return new Set([...values]
    .filter(([, list]) => list.some((value) => atoms(resolveTokens(value, first)).some((atom) => LENGTHY.test(atom))))
    .map(([name]) => name));
}

export function tokenDefinitionFindings(sheets) {
  const findings = [];
  const declared = new Set();
  for (const [file, source] of sheets) {
    for (const declaration of declarations(source)) {
      const { property, line, selector } = declaration;
      if (!property.startsWith('--') || !familyOf(property)) continue;
      const token = TOKENS.get(property);
      if (!token) {
        findings.push(`${file} line ${line} declares unclassified token ${property}: ${declaration.value}`);
        continue;
      }
      if (file !== TOKEN_SHEETS[0] || selector.replace(/\s+/g, ' ').trim() !== ':root') {
        findings.push(`${file} line ${line} declares ${property} outside the shared :root block of ${TOKEN_SHEETS[0]}`);
      }
      if (declared.has(property)) findings.push(`${file} line ${line} declares ${property} a second time`);
      declared.add(property);
      const value = declaration.value.replace(/\s+/g, ' ').trim();
      if (value !== token.value) findings.push(`${property} is ${value}, not ${token.value}`);
    }
  }
  for (const name of TOKENS.keys()) if (!declared.has(name)) findings.push(`${name} is missing`);
  return findings;
}

export function tokenGrammarFindings(file, source, lengths = lengthTokens([[file, source]])) {
  const findings = [];
  for (const declaration of declarations(source)) {
    if (declaration.property.startsWith('--')) continue;
    for (const rule of TOKEN_RULES) {
      if (!rule.properties.test(declaration.property)) continue;
      const value = declaration.value.replace(/\s*!important\s*$/i, '').trim();
      const where = `${file} line ${declaration.line} ${declaration.property}`;
      const list = atoms(value);
      for (const layer of rule.whole ? layers(list) : [list.filter((atom) => atom !== ',')]) {
        if (rule.whole && layer.length === 1) {
          const name = tokenOf(layer[0]);
          if (name ? rule.whole(name) : KEYWORDS.has(layer[0]) || layer[0] === 'none') continue;
          if (name) {
            findings.push(`${where} uses ${layer[0]}, which is not a ${rule.family} token`);
            continue;
          }
        }
        if (!rule.raw) {
          findings.push(`${where} carries raw ${rule.family} value ${layer.join(' ')}`);
          continue;
        }
        for (const atom of layer) {
          const name = tokenOf(atom);
          if (name) {
            if (!rule.accepts(name, lengths)) findings.push(`${where} uses ${atom}, which is not a ${rule.family} token`);
          } else if (rule.raw(atom)) {
            findings.push(`${where} carries raw ${rule.family} value ${atom}`);
          }
        }
      }
    }
  }
  return findings;
}

export function tokenUsageFindings(sheets) {
  const used = new Set();
  for (const [, source] of sheets) {
    for (const declaration of declarations(source)) {
      for (const match of declaration.value.matchAll(/var\(\s*(--[-\w]+)/g)) used.add(match[1]);
    }
  }
  return [...TOKENS]
    .filter(([name, token]) => !token.scale && !used.has(name))
    .map(([name, token]) => `${name} holds ${token.value} for ${token.role}, but nothing uses it`);
}

export function tokenFindings(sheets) {
  const definitions = tokenDefinitionFindings(sheets);
  const missing = new Set(definitions.map((finding) => /^(--[-\w]+) is missing$/.exec(finding)?.[1]).filter(Boolean));
  const lengths = lengthTokens(sheets);
  return [
    ...definitions,
    ...sheets.flatMap(([file, source]) => tokenGrammarFindings(file, source, lengths)),
    ...tokenUsageFindings(sheets).filter((finding) => !missing.has(finding.split(' ')[0])),
  ];
}

function main() {
  const source = readFileSync(join(ROOT, 'src', 'styles.css'), 'utf8');
  if (process.argv.includes('--inventory')) {
    console.log(JSON.stringify(spacingInventory(source), null, 2));
    return;
  }
  const sheets = TOKEN_SHEETS.map((file) => [file, readFileSync(join(ROOT, ...file.split('/')), 'utf8')]);
  const findings = [...checkAll(source), ...tokenFindings(sheets)];
  if (findings.length) {
    console.error(`Spacing and design token check found ${findings.length} problem(s):`);
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exitCode = 1;
    return;
  }
  const families = new Set([...TOKENS.values()].map(({ family }) => family)).size;
  console.log(`${SCALE.size} spacing steps; 0 raw, unclassified or unused governed values`);
  console.log(`${TOKENS.size} design tokens in ${families} ${families === 1 ? 'family' : 'families'}; 0 raw, unclassified or unused values in either stylesheet`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
