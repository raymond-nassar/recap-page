import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseManifest } from '../src/js/lib/curated.js';
import { parseCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { curatedLedgerDigestFor, curatedRelationshipReportDigestFor } from '../scripts/lib/owner-guide.mjs';
import { approvalDigestFor } from '../scripts/lib/cbh-inventory.mjs';

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

for (const [id, expected, characters] of [
  ['history-of-the-marvel-universe-2019', [75119, 75120, 75121, 75122, 75123, 75124], ['Galactus', 'Franklin Richards']],
  ['marvels-1994', [10280, 10281, 10282, 10283], ['Phil Sheldon']],
]) {
  test(`guide book ${id} retains its owner-selected originals through source, payload, and catalog`, async () => {
    const manifest = JSON.parse(await readFile(new URL('../src/data/curated-lists.json', import.meta.url), 'utf8'));
    const catalog = JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
    const entry = manifest.lists.find((candidate) => candidate.id === id);
    assert.ok(entry, `${id} must be a curated source`);
    assert.equal(entry.type, 'creator-run');
    assert.equal(entry.depth, 'complete');
    assert.equal(entry.beginner, false);
    assert.equal(entry.timeline ?? null, null);
    assert.deepEqual(entry.storyTypes ?? [], []);
    assert.deepEqual(entry.characters, characters);
    const checklist = await readFile(new URL(`../src/data/orders/${entry.sourceFile}`, import.meta.url), 'utf8');
    const parsed = parseChecklist(checklist);
    assert.deepEqual(parsed.unresolved, []);
    assert.deepEqual(parsed.entries.map((row) => row.issueId), expected);
    const payload = JSON.parse(await readFile(new URL(`../src/data/${entry.out}`, import.meta.url), 'utf8'));
    assert.deepEqual(payload.items.map((row) => row.issueId), expected);
    const card = catalog.lists.find((candidate) => candidate.id === id);
    assert.ok(card, `${id} must have a catalog preview`);
    assert.equal(card.count, expected.length);
    assert.equal(card.file, entry.out);
    assert.deepEqual(card.characters, characters);
  });
}

test('guide book source ledgers retain the reviewed complete-library evidence', async () => {
  for (const [id, peer] of [
    ['history-of-the-marvel-universe-2019', 'marvels-1994'],
    ['marvels-1994', 'history-of-the-marvel-universe-2019'],
  ]) {
    const ledger = JSON.parse(await readFile(
      new URL(`../scripts/data/curated-source-ledgers/${id}.json`, import.meta.url), 'utf8',
    ));
    assert.equal(ledger.ledgerDigest, curatedLedgerDigestFor(ledger));
    const { relationshipReview: review } = ledger;
    assert.equal(review.status, 'approved');
    assert.equal(review.authorityType, 'agent-content-review');
    assert.equal(review.approvalDigest, approvalDigestFor(review));
    assert.equal(review.report.candidateId, id);
    assert.equal(review.report.ledgerDigest, ledger.ledgerDigest);
    assert.equal(review.report.reportDigest, curatedRelationshipReportDigestFor(review.report));
    assert.equal(review.report.comparisonCount, 344);
    assert.equal(review.report.comparisons.length, 344);
    assert.equal(new Set(review.report.comparisons.map(({ orderId }) => orderId)).size, 344);
    assert.ok(review.report.comparisons.some(({ orderId }) => orderId === peer));
    assert.ok(review.report.comparisons.every(({ sharedCount, sharedIds, relationship }) =>
      sharedCount === 0 && sharedIds.length === 0 && relationship === 'none'));
  }
});

test('reading blocks are opt-in local sections, not an inferred collected-edition boundary', () => {
  const local = { ...valid, sourceUrl: undefined, sourceFile: 'civil-war.md' };
  const selected = parseManifest({ lists: [{ ...local, sectionKind: 'reading-blocks' }] });
  assert.deepEqual(selected.errors, []);
  assert.equal(selected.entries[0].sectionKind, 'reading-blocks');
  assert.equal(Object.hasOwn(parseManifest({ lists: [local] }).entries[0], 'sectionKind'), false);
  for (const entry of [
    { ...valid, sectionKind: 'reading-blocks' },
    ...[null, false, '', 'collections', ['reading-blocks']].map((sectionKind) => ({ ...local, sectionKind })),
    { ...local, sectionKind: 'reading-blocks', partitionFile: 'parts.json', catalog: false },
  ]) {
    const result = parseManifest({ lists: [entry] });
    assert.equal(result.entries.length, 0);
    assert.match(result.errors.join('\n'), /sectionKind/);
  }
});

test('Storylines metadata is strict, whole-group and partition-parent-only', () => {
  for (const storylines of [null, 'true', 1, []]) {
    assert.ok(parseManifest({ lists: [{ ...valid, storylines }] }).errors.length,
      `accepted invalid storylines ${JSON.stringify(storylines)}`);
  }
  const selected = parseManifest({ lists: [{ ...valid, storylines: true }] });
  assert.deepEqual(selected.errors, []);
  assert.equal(selected.entries[0].storylines, true);
  const member = { ...valid, id: 'civil-war-long', out: 'long.json', group: 'civil-war',
    groupName: 'Civil War', variant: 'Complete' };
  assert.ok(parseManifest({ lists: [
    { ...valid, group: 'civil-war', groupName: 'Civil War', variant: 'Essential', storylines: true },
    member,
  ] }).errors.length, 'mixed group eligibility must fail');
  const parent = { ...valid, sourceUrl: undefined, sourceFile: 'civil_war.md',
    partitionFile: 'parts.json', catalog: false };
  for (const extra of [
    { storylines: false }, { storylinesChildren: null }, { storylinesChildren: [' x'] },
    { storylinesChildren: ['x', 'x'] }, { storylinesChildren: [1] },
  ]) assert.ok(parseManifest({ lists: [{ ...parent, ...extra }] }).errors.length);
  assert.ok(parseManifest({ lists: [{ ...valid, storylinesChildren: [] }] }).errors.length);
  assert.deepEqual(parseManifest({ lists: [{ ...parent, storylinesChildren: [] }] }).errors, []);
});

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

// #898. A Home category selects young readers' lists by this value, so a misspelling has to fail
// the manifest rather than leave a list silently outside the category.
test('audience is a closed vocabulary, carried only when a list states one', () => {
  const stated = parseManifest({ lists: [{ ...valid, audience: 'young-readers' }] });
  assert.deepEqual(stated.errors, []);
  assert.equal(stated.entries[0].audience, 'young-readers');

  const unstated = parseManifest({ lists: [valid] });
  assert.deepEqual(unstated.errors, []);
  assert.equal(Object.hasOwn(unstated.entries[0], 'audience'), false);

  for (const audience of ['kids', 'Young Readers', '', null, ['young-readers'], true]) {
    const { entries, errors } = parseManifest({ lists: [{ ...valid, audience }] });
    assert.equal(entries.length, 0, `accepted audience ${JSON.stringify(audience)}`);
    assert.match(errors.join('\n'), /audience must be one of young-readers/);
  }
});

// #1060. Search and the planned Home category select on these values, so a misspelling, a
// repeat or an over-long list has to fail the manifest rather than reach a reader.
test('story types and tones are closed, capped and carried only when stated', () => {
  const stated = parseManifest({ lists: [{ ...valid, storyTypes: ['espionage', 'thriller', 'political'], tones: ['epic', 'dark'] }] });
  assert.deepEqual(stated.errors, []);
  assert.deepEqual(stated.entries[0].storyTypes, ['espionage', 'thriller', 'political']);
  assert.deepEqual(stated.entries[0].tones, ['epic', 'dark']);

  const unstated = parseManifest({ lists: [valid] }).entries[0];
  assert.equal(Object.hasOwn(unstated, 'storyTypes'), false);
  assert.equal(Object.hasOwn(unstated, 'tones'), false);

  const refused = [
    { storyTypes: [] }, { storyTypes: 'espionage' }, { storyTypes: ['spy'] }, { storyTypes: ['Espionage'] },
    { storyTypes: ['war', 'war'] }, { storyTypes: ['war', 'horror', 'comedy', 'political'] },
    { tones: [] }, { tones: ['grim'] }, { tones: ['epic', 'dark', 'lighthearted'] }, { tones: null },
  ];
  for (const extra of refused) {
    const { entries, errors } = parseManifest({ lists: [{ ...valid, ...extra }] });
    assert.equal(entries.length, 0, `accepted ${JSON.stringify(extra)}`);
    assert.match(errors.join('\n'), /(storyTypes|tones) must list 1 to [23] unique values/);
  }
  const parent = { ...valid, sourceUrl: undefined, sourceFile: 'civil_war.md',
    partitionFile: 'parts.json', catalog: false, storyTypes: ['war'] };
  assert.match(parseManifest({ lists: [parent] }).errors.join('\n'), /storyTypes belongs on a listed reading/);
});

// #1065. A partition parent's chapters are generated, so their tags are held on the parent keyed
// by child ID. Each chapter answers to the same closed lists and caps as an ordinary list, and
// must name at least one story type, so an owner's tag cannot be misspelled or overfilled here.
test('chapter tags are partition-parent-only and each chapter obeys the list rules', () => {
  const parent = { ...valid, sourceUrl: undefined, sourceFile: 'civil_war.md',
    partitionFile: 'parts.json', catalog: false };
  const chapterTags = {
    'civil-war-01': { storyTypes: ['war', 'political', 'thriller'], tones: ['epic', 'dark'] },
    'civil-war-02': { storyTypes: ['crime-noir'] },
  };
  const stated = parseManifest({ lists: [{ ...parent, chapterTags }] });
  assert.deepEqual(stated.errors, []);
  assert.deepEqual(stated.entries[0].chapterTags, chapterTags);
  assert.equal(Object.hasOwn(parseManifest({ lists: [parent] }).entries[0], 'chapterTags'), false);

  assert.match(parseManifest({ lists: [{ ...valid, chapterTags }] }).errors.join('\n'),
    /chapterTags must be an object keyed by exact child IDs on a partition parent/);
  const refused = [
    [null, /chapterTags must be an object/],
    [[], /chapterTags must be an object/],
    [{ ' civil-war-01': { storyTypes: ['war'] } }, /must be keyed by an exact child ID/],
    [{ 'civil-war-01': { storyTypes: ['spy'] } }, /storyTypes must list 1 to 3/],
    [{ 'civil-war-01': { storyTypes: ['war', 'horror', 'comedy', 'political'] } }, /storyTypes must list 1 to 3/],
    [{ 'civil-war-01': { storyTypes: ['war'], tones: ['grim'] } }, /tones must list 1 to 2/],
    [{ 'civil-war-01': { storyTypes: ['war'], tones: ['epic', 'dark', 'lighthearted'] } }, /tones must list 1 to 2/],
    [{ 'civil-war-01': { tones: ['dark'] } }, /must list at least one story type/],
    [{ 'civil-war-01': { storyTypes: ['war'], keywords: ['x'] } }, /may hold only storyTypes and tones/],
    [{ 'civil-war-01': ['war'] }, /may hold only storyTypes and tones/],
  ];
  for (const [bad, message] of refused) {
    const { entries, errors } = parseManifest({ lists: [{ ...parent, chapterTags: bad }] });
    assert.equal(entries.length, 0, `accepted ${JSON.stringify(bad)}`);
    assert.match(errors.join('\n'), message);
  }
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

test('a partition parent is local, explicit and excluded from the visible catalog', () => {
  const parent = {
    ...valid,
    sourceUrl: undefined,
    sourcePage: undefined,
    sourceFile: 'civil_war.md',
    partitionFile: 'civil-war-parts.json',
    catalog: false,
  };
  const { entries, errors } = parseManifest({ lists: [parent] });
  assert.deepEqual(errors, []);
  assert.equal(entries[0].partitionFile, 'civil-war-parts.json');
  assert.equal(entries[0].catalog, false);

  for (const bad of [
    { ...parent, partitionFile: '../parts.json' },
    { ...parent, catalog: true },
    { ...parent, catalog: 'false' },
    { ...parent, sourceFile: undefined, sourceUrl: valid.sourceUrl },
    { ...valid, catalog: false },
  ]) {
    assert.ok(parseManifest({ lists: [bad] }).errors.length, JSON.stringify(bad));
  }
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

test('a selected screen companion is accepted without spotlight taxonomy', () => {
  const companion = {
    ...valid,
    type: 'screen-companion',
    depth: 'selected',
  };
  const { entries, errors } = parseManifest({ lists: [companion] });
  assert.deepEqual(errors, []);
  assert.equal(entries[0].type, 'screen-companion');
  assert.equal(entries[0].depth, 'selected');
  assert.equal(Object.hasOwn(entries[0], 'spotlightKind'), false);

  const rejected = parseManifest({
    lists: [{ ...companion, spotlightKind: 'best-of' }],
  });
  assert.equal(rejected.entries.length, 0);
  assert.match(rejected.errors.join('\n'), /only valid on a character-run/);
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

  const visibleEntries = entries.filter((entry) => entry.catalog);
  const partitionParents = entries.filter((entry) => !entry.catalog);
  const generatedChildren = lists.filter((list) => /^marvel-knights-to-planet-x-\d{2}$/.test(list.id));
  assert.equal(partitionParents.length, 1);
  assert.equal(partitionParents[0].id, 'marvel-knights-to-planet-x');
  assert.equal(lists.some((list) => list.id === partitionParents[0].id), false);
  assert.equal(generatedChildren.length, 78);
  assert.deepEqual(
    visibleEntries.map((entry) => entry.id).sort(),
    lists.filter((list) => !generatedChildren.includes(list)).map((list) => list.id).sort(),
  );
  for (const entry of visibleEntries) {
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
    assert.equal(list.audience, entry.audience ?? null, `${entry.id} audience drifted from the manifest`);
    assert.equal(rawList.audience ?? null, entry.audience ?? null, `${entry.id} generated a different audience`);
    assert.deepEqual(list.storyTypes, entry.storyTypes ?? [], `${entry.id} story types drifted from the manifest`);
    assert.deepEqual(list.tones, entry.tones ?? [], `${entry.id} tones drifted from the manifest`);
    assert.deepEqual(rawList.storyTypes, entry.storyTypes, `${entry.id} generated different story types`);
    assert.deepEqual(rawList.tones, entry.tones, `${entry.id} generated different tones`);
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

test('setup to modern timeline keeps its five sections, twenty-one rows, and no overlaps', async () => {
  const manifest = JSON.parse(await readFile(new URL('../src/data/curated-lists.json', import.meta.url), 'utf8'));
  const { entries } = parseManifest(manifest);
  const setup = entries.find((entry) => entry.id === 'setup-to-modern-timeline');
  assert.ok(setup, 'missing setup-to-modern-timeline manifest entry');
  assert.equal(setup.type, 'era');
  assert.equal(setup.depth, 'essential');
  assert.equal(setup.beginner, true);
  assert.equal(setup.timeline, null);
  assert.equal(setup.expect, 21);

  const pinned = JSON.parse(await readFile(new URL('../src/data/setup_to_modern_timeline.json', import.meta.url), 'utf8'));
  assert.equal(pinned.items.length, 21);
  assert.deepEqual(pinned.items.map((item) => item.issueId), [
    75504, 75505, 75506, 75507,
    22874, 22875, 23084, 23578, 23932, 25958,
    77526,
    10639, 10640, 10641, 10642, 10643,
    22442, 22443, 22444, 22446, 22445,
  ]);
  assert.deepEqual(pinned.items.map((item) => item.collectedIn), [
    'Marvels Annotated',
    'Marvels Annotated',
    'Marvels Annotated',
    'Marvels Annotated',
    'Marvels: Eye of the Camera',
    'Marvels: Eye of the Camera',
    'Marvels: Eye of the Camera',
    'Marvels: Eye of the Camera',
    'Marvels: Eye of the Camera',
    'Marvels: Eye of the Camera',
    'Marvels Epilogue',
    'The Sentry Core Mini-Series',
    'The Sentry Core Mini-Series',
    'The Sentry Core Mini-Series',
    'The Sentry Core Mini-Series',
    'The Sentry Core Mini-Series',
    'The Sentry One-Shot Tie-Ins',
    'The Sentry One-Shot Tie-Ins',
    'The Sentry One-Shot Tie-Ins',
    'The Sentry One-Shot Tie-Ins',
    'The Sentry One-Shot Tie-Ins',
  ]);

  const setupIds = new Set(pinned.items.map((item) => item.issueId));
  for (const entry of entries) {
    if (entry.id === setup.id) continue;
    const order = JSON.parse(await readFile(new URL(`../src/data/${entry.out}`, import.meta.url), 'utf8'));
    const overlap = order.items.filter((item) => setupIds.has(item.issueId));
    assert.equal(overlap.length, 0, `${entry.id} overlaps setup-to-modern-timeline with ${overlap.map((item) => item.issueId).join(', ')}`);
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
    // A factual ledger is also a derivation record, but it must name this order and its exact rows.
    if (!/scripts\/[\w-]+\.mjs|DATA_PROVENANCE\.md/.test(trail)) {
      const ledgerLink = `../../../scripts/data/curated-source-ledgers/${entry.id}.json`;
      assert.ok(trail.includes(`](${ledgerLink})`),
        `${entry.sourceFile}: trail names neither a generating script nor a provenance record`);
      const ledger = JSON.parse(await readFile(new URL(
        `../scripts/data/curated-source-ledgers/${entry.id}.json`, import.meta.url,
      ), 'utf8'));
      assert.equal(ledger.id, entry.id);
      assert.equal(ledger.ledgerDigest, curatedLedgerDigestFor(ledger));
      assert.ok(ledger.source?.url && ledger.source?.boundary);
      assert.ok(Array.isArray(ledger.sourceRows) && ledger.sourceRows.length > 0);
      assert.deepEqual(ledger.resolvedVector, parseChecklist(md).entries.map((row) => row.issueId));
    }
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
