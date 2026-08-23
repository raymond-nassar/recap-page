import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseManifest } from '../src/js/lib/curated.js';
import { parseCatalog } from '../src/js/lib/catalog.js';

const valid = {
  id: 'civil-war',
  name: 'Civil War',
  description: 'Registration splits the heroes.',
  type: 'event',
  depth: 'essential',
  sourceUrl: 'https://example.test/civil_war.md',
  sourcePage: 'https://example.test/civil_war',
  sourceOrigin: 'Vendored from example.test',
  sourceLicense: null,
  out: 'civil_war.json',
  characters: ['Iron Man'],
  keywords: ['crossover'],
  expect: 40,
};

test('a complete manifest entry is accepted as-is', () => {
  const { entries, errors } = parseManifest({ lists: [valid] });
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].out, 'civil_war.json');
  assert.equal(entries[0].sourcePage, 'https://example.test/civil_war');
  assert.equal(entries[0].expect, 40);
});

test('sourcePage falls back to sourceUrl so attribution is never blank', () => {
  const { entries } = parseManifest({ lists: [{ ...valid, sourcePage: undefined }] });
  assert.equal(entries[0].sourcePage, valid.sourceUrl);
});

test('a source section is preserved for distinct guides on one page', () => {
  const { entries, errors } = parseManifest({
    lists: [{ ...valid, sourceSection: '  X-Men: Divided We Stand  ' }],
  });
  assert.deepEqual(errors, []);
  assert.equal(entries[0].sourceSection, 'X-Men: Divided We Stand');
});

test('expect is optional', () => {
  const { entries, errors } = parseManifest({ lists: [{ ...valid, expect: undefined }] });
  assert.deepEqual(errors, []);
  assert.equal(entries[0].expect, null);
});

test('an order can be authored in this repository instead of fetched', () => {
  const local = { ...valid, sourceUrl: undefined, sourcePage: undefined, sourceFile: 'civil_war.md' };
  const { entries, errors } = parseManifest({ lists: [local] });
  assert.deepEqual(errors, []);
  assert.equal(entries[0].sourceFile, 'civil_war.md');
  assert.equal(entries[0].sourceUrl, null);
  // No upstream page to send the reader to, so attribution rests on the origin alone rather
  // than on a link that goes nowhere.
  assert.equal(entries[0].sourcePage, null);
});

// BL-099. Origin and licence were one field, and ten of the twelve values it held were prose
// about where an order came from. Prose is not a grant, so the shape is checked: anything that
// is not an SPDX expression is refused, which is every one of those ten.
test('a licence is an SPDX expression and provenance prose is not accepted as one', () => {
  for (const spdx of ['MIT', 'CC0-1.0', 'Apache-2.0', 'MIT OR Apache-2.0', 'GPL-2.0-only WITH Classpath-exception-2.0']) {
    const { entries, errors } = parseManifest({ lists: [{ ...valid, sourceLicense: spdx }] });
    assert.deepEqual(errors, [], `rejected the SPDX expression ${spdx}`);
    assert.equal(entries[0].sourceLicense, spdx);
  }
});

// Null is the ordinary answer and has to stay distinguishable from a licence. It means nobody
// granted anything for this file, which is not the same claim as the file being unencumbered.
test('a null licence is accepted, because no licence conveyed is the ordinary case', () => {
  const { entries, errors } = parseManifest({ lists: [{ ...valid, sourceLicense: null }] });
  assert.deepEqual(errors, []);
  assert.equal(entries[0].sourceLicense, null);
  assert.equal(entries[0].sourceOrigin, valid.sourceOrigin);
});

// BL-099 review. A non-string value used to pass the shape check, because String(true) is
// SPDX-shaped, and was then stored as null by the same coercion that reads the field. The entry
// came out claiming no licence was conveyed, which is a claim nobody in the manifest had made.
// Refusing the type keeps null meaning only what a null was written to mean.
test('a licence that is not a string is refused rather than coerced into no licence', () => {
  for (const bad of [true, 123, ['MIT'], { name: 'MIT' }]) {
    const { entries, errors } = parseManifest({ lists: [{ ...valid, sourceLicense: bad }] });
    assert.equal(entries.length, 0, `accepted the non-string licence ${JSON.stringify(bad)}`);
    assert.match(errors.join('\n'), /must be an SPDX expression/);
  }
});

test('an incomplete entry is reported with its reason, not silently skipped', () => {
  const cases = [
    [{ ...valid, id: '' }, /has no id/],
    [{ ...valid, name: '' }, /has no name/],
    [{ ...valid, out: '../escape.json' }, /output file name/],
    [{ ...valid, sourceUrl: 'http://example.test/x.md' }, /sourceUrl that is not https/],
    [{ ...valid, sourceUrl: 'not a url' }, /sourceUrl that is not https/],
    [{ ...valid, sourceUrl: undefined, sourcePage: undefined }, /no sourceUrl or sourceFile/],
    [{ ...valid, sourceUrl: undefined, sourceFile: '../escape.md' }, /sourceFile that is not a plain/],
    [{ ...valid, sourceUrl: undefined, sourceFile: 'order.json' }, /sourceFile that is not a plain/],
    [{ ...valid, sourceFile: 'order.md' }, /an order comes from one place/],
    [{ ...valid, sourceSection: '   ' }, /sourceSection must be a non-empty string/],
    [{ ...valid, sourceOrigin: null }, /has no sourceOrigin/],
    [{ ...valid, sourceLicense: 'MIT (emreparker/marvel-comics)' }, /must be an SPDX expression/],
    [{ ...valid, sourceLicense: 'Compiled for this project' }, /must be an SPDX expression/],
    [{ ...valid, sourceLicense: 'Assembled from Marvel series metadata (publication order)' }, /must be an SPDX expression/],
    [{ ...valid, type: 'anthology' }, /type must be one of/],
    [{ ...valid, depth: 'skim' }, /depth must be one of/],
    [{ ...valid, expect: 0 }, /expect must be/],
    [{ ...valid, variant: 'Essential reading' }, /need a group to belong to/],
    [{ ...valid, groupName: 'Civil War' }, /need a group to belong to/],
    [null, /is not an object/],
  ];
  for (const [entry, pattern] of cases) {
    const { entries, errors } = parseManifest({ lists: [entry] });
    assert.equal(entries.length, 0, `accepted ${JSON.stringify(entry)}`);
    assert.match(errors.join('\n'), pattern);
  }
});

test('an order can declare the event variant it belongs to', () => {
  const { entries, errors } = parseManifest({
    lists: [{ ...valid, group: 'civil-war', groupName: 'Civil War', variant: 'Essential reading' }],
  });
  assert.deepEqual(errors, []);
  assert.equal(entries[0].group, 'civil-war');
  assert.equal(entries[0].variant, 'Essential reading');
});

test('a character run requires one explicit spotlight taxonomy value', () => {
  const character = { ...valid, type: 'character-run', spotlightKind: 'best-of' };
  const { entries, errors } = parseManifest({ lists: [character] });
  assert.deepEqual(errors, []);
  assert.equal(entries[0].spotlightKind, 'best-of');

  for (const spotlightKind of [undefined, null, 'complete', true]) {
    const parsed = parseManifest({ lists: [{ ...character, spotlightKind }] });
    assert.equal(parsed.entries.length, 0, `accepted ${JSON.stringify(spotlightKind)}`);
    assert.match(parsed.errors.join('\n'), /spotlightKind must be one of/);
  }
});

test('spotlight taxonomy is forbidden on non-character orders', () => {
  const plain = parseManifest({ lists: [valid] });
  assert.deepEqual(plain.errors, []);
  assert.equal(Object.hasOwn(plain.entries[0], 'spotlightKind'), false);

  const { entries, errors } = parseManifest({
    lists: [{ ...valid, spotlightKind: 'best-of' }],
  });
  assert.equal(entries.length, 0);
  assert.match(errors.join('\n'), /only valid on a character-run/);
});

test('readings grouped into one story agree on spotlight taxonomy', () => {
  const base = {
    ...valid,
    type: 'character-run',
    group: 'x-men',
    groupName: 'X-Men',
    variant: 'Spine',
    spotlightKind: 'other',
  };
  const { errors } = parseManifest({
    lists: [
      base,
      { ...base, id: 'x-men-complete', out: 'x_men_complete.json', variant: 'Complete', spotlightKind: 'complete-guide' },
    ],
  });
  assert.match(errors.join('\n'), /group "x-men" has conflicting spotlightKind values/);
});

test('a duplicate id is rejected rather than vendored twice', () => {
  const { entries, errors } = parseManifest({ lists: [valid, { ...valid, name: 'Civil War again' }] });
  assert.equal(entries.length, 1);
  assert.match(errors.join('\n'), /duplicate id "civil-war"/);
});

test('a missing or malformed manifest reports an error instead of crashing', () => {
  assert.match(parseManifest(undefined).errors.join(), /no "lists" array/);
  assert.match(parseManifest({ lists: 'nope' }).errors.join(), /no "lists" array/);
});

test('the bundled manifest is valid and describes exactly the bundled catalog', async () => {
  const manifest = JSON.parse(await readFile(new URL('../src/data/curated-lists.json', import.meta.url), 'utf8'));
  const { entries, errors } = parseManifest(manifest);
  assert.deepEqual(errors, []);
  assert.ok(entries.length > 0);

  const catalogRaw = JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
  const { lists } = parseCatalog(catalogRaw);

  assert.deepEqual(entries.map((e) => e.id).sort(), lists.map((l) => l.id).sort());
  for (const entry of entries) {
    const list = lists.find((l) => l.id === entry.id);
    const rawList = catalogRaw.lists.find((l) => l.id === entry.id);
    assert.equal(list.file, entry.out, `${entry.id} file drifted from the manifest`);
    assert.equal(list.name, entry.name);
    assert.equal(list.type, entry.type);
    assert.equal(list.depth, entry.depth);
    if (entry.type === 'character-run') {
      assert.equal(list.spotlightKind, entry.spotlightKind);
      assert.equal(rawList.spotlightKind, entry.spotlightKind);
    } else {
      assert.equal(Object.hasOwn(entry, 'spotlightKind'), false, `${entry.id} normalized a forbidden taxonomy field`);
      assert.equal(Object.hasOwn(rawList, 'spotlightKind'), false, `${entry.id} generated a forbidden taxonomy field`);
      assert.equal(list.spotlightKind, null);
    }
    assert.equal(list.source, entry.sourcePage);
    assert.equal(list.sourceSection, entry.sourceSection);
    assert.equal(list.sourceOrigin, entry.sourceOrigin, `${entry.id} origin drifted from the manifest`);
    assert.equal(list.sourceLicense, entry.sourceLicense);
    assert.deepEqual(list.characters, entry.characters);
    assert.deepEqual(list.keywords, entry.keywords);
    assert.equal(list.group, entry.group, `${entry.id} group drifted from the manifest`);
    assert.equal(list.groupName, entry.groupName);
    assert.equal(list.variant, entry.variant);
    if (entry.expect != null) assert.equal(list.count, entry.expect, `${entry.id} count drifted`);
  }
});

// BL-099. The catalog is rebuilt from the pinned files rather than from the manifest, so a
// pinned file that keeps a stale origin puts a claim in front of a reader that the manifest no
// longer makes. The two are checked against each other rather than each against a copy of the
// expected text, which somebody would then have to keep up to date.
test('every pinned order file states the same origin and licence as the manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../src/data/curated-lists.json', import.meta.url), 'utf8'));
  const { entries } = parseManifest(manifest);
  assert.ok(entries.length > 0);

  for (const entry of entries) {
    const pinned = JSON.parse(await readFile(new URL(`../src/data/${entry.out}`, import.meta.url), 'utf8'));
    assert.equal(pinned.sourceSection ?? null, entry.sourceSection, `${entry.id}: pinned section disagrees with the manifest`);
    assert.equal(pinned.sourceOrigin, entry.sourceOrigin, `${entry.id}: pinned origin disagrees with the manifest`);
    assert.equal(pinned.sourceLicense ?? null, entry.sourceLicense, `${entry.id}: pinned licence disagrees with the manifest`);
    // A pinned file is the copy the reader is actually served, so the shape is checked here too
    // rather than only where the manifest is parsed.
    if (pinned.sourceLicense != null) {
      assert.match(
        String(pinned.sourceLicense),
        /^[A-Za-z0-9.+-]+( (AND|OR|WITH) [A-Za-z0-9.+-]+)*$/,
        `${entry.id}: pinned licence is not an SPDX expression`,
      );
    }
  }
});

// BL-099 acceptance: locally compiled orders need a reviewable derivation record. Every order
// under src/data/orders is authored here, and eighteen are written by committed scripts, which
// put the trail in by construction. The other sixteen carry one only if somebody wrote it, which
// is exactly the kind of thing that rots, so all files are checked rather than trusted.
//
// The check is not keyed on which files are which. Naming the two by hand would be an
// enumeration somebody has to keep complete, and the eleventh order is the one it would miss.
test('every order authored here records how it was derived', async () => {
  const manifest = JSON.parse(await readFile(new URL('../src/data/curated-lists.json', import.meta.url), 'utf8'));
  const { entries } = parseManifest(manifest);
  const local = entries.filter((e) => e.sourceFile);
  assert.ok(local.length > 0, 'no locally authored orders to check');

  for (const entry of local) {
    const md = await readFile(new URL(`../src/data/orders/${entry.sourceFile}`, import.meta.url), 'utf8');
    const lines = md.split(/\r?\n/);
    const first = lines.findIndex((l) => /^\s*- \[[ xX]\]/.test(l));
    assert.ok(first > 0, `${entry.sourceFile}: no checklist items found`);
    // Everything above the first tickable line, minus the title and any sub-heading, is the
    // trail. A title alone is what the two hand-compiled files had before BL-099.
    const trail = lines.slice(0, first).filter((l) => l.trim() && !/^#/.test(l)).join(' ');
    assert.ok(
      trail.length > 200,
      `${entry.sourceFile}: has no derivation trail above its first checklist item`,
    );
    // A trail is reviewable if it can be followed: either to the script that wrote the file, or
    // to the record that says how a hand-compiled sequence was arrived at.
    assert.match(
      trail,
      /scripts\/[\w-]+\.mjs|DATA_PROVENANCE\.md/,
      `${entry.sourceFile}: trail names neither a generating script nor the provenance record`,
    );
  }
});

// A timeline year decides where an order sits on the shelf. A string or a fractional year would
// pass through as though the order had no place at all, so it is rejected with the reason rather
// than quietly reordering the catalog.
test('a timeline that is not a whole year of 1939 or later is refused', () => {
  for (const bad of ['2006', 2006.5, 1938, -2006, true]) {
    const { entries, errors } = parseManifest({ lists: [{ ...valid, timeline: bad }] });
    assert.equal(entries.length, 0, `accepted ${JSON.stringify(bad)}`);
    assert.ok(errors.some((e) => e.includes('timeline')), `no timeline error for ${JSON.stringify(bad)}`);
  }
});

test('an order with no timeline is valid, and records that it has no place on the shelf', () => {
  const { entries, errors } = parseManifest({ lists: [{ ...valid, timeline: 1963 }] });
  assert.deepEqual(errors, []);
  assert.equal(entries[0].timeline, 1963);
  assert.equal(parseManifest({ lists: [valid] }).entries[0].timeline, null);
});

test('every order in the shipped manifest states where it sits on the timeline', async () => {
  const raw = JSON.parse(await readFile(new URL('../src/data/curated-lists.json', import.meta.url), 'utf8'));
  for (const list of raw.lists) {
    assert.ok(
      Object.hasOwn(list, 'timeline'),
      `${list.id} does not say where it sits, so it would fall to the end of the shelf by accident`,
    );
  }
});
