import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCatalog } from '../src/js/lib/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'src', 'data');
const mappingsDir = path.join(root, 'scripts', 'data', 'cbh-mappings');
const overlapsDir = path.join(root, 'scripts', 'data', 'cbh-overlaps');
const sourcePage = 'https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/x-men-events-from-messiah-complex-to-avengers-vs-x-men-2007-to-2012/';

const RECONCILED_SECTIONS = Object.freeze([
  ['Previously: Messiah CompleX', 'messiah-complex', 13],
  ['X-Men: Divided We Stand', 'x-men-divided-we-stand', 48],
  ['X-Men: Manifest Destiny', 'x-men-manifest-destiny', 19],
  ['Messiah War', 'messiah-war', 10],
  ['Avengers and X-Men: Utopia', 'x-men-utopia', 14],
  ['X-Men: Nation X', 'x-men-nation-x', 20],
  ['Necrosha', 'necrosha', 14],
  ['Second Coming', 'second-coming', 23],
  ['Curse of the Mutants', 'x-men-curse-of-the-mutants', 18],
  ['Wolverine Goes to Hell', 'wolverine-goes-to-hell', 15],
  ['Age of X', 'x-men-age-of-x', 11],
  ['Schism', 'x-men-schism', 7],
  ['Regenesis', 'x-men-regenesis', 43],
]);

const PATH_STEPS = Object.freeze([
  'messiah-complex',
  'x-men-divided-we-stand',
  'x-men-manifest-destiny',
  'messiah-war',
  'x-men-nation-x',
  'necrosha',
  'second-coming',
  'x-men-curse-of-the-mutants',
  'wolverine-goes-to-hell',
  'x-men-age-of-x',
  'x-men-schism',
  'x-men-regenesis',
]);

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function sequenceDigest(ids) {
  return createHash('sha256').update(ids.join('|')).digest('hex');
}

test('the Messiah to AvX source sections are reconciled to catalog orders', async () => {
  const catalog = parseCatalog(await readJson(path.join(dataDir, 'catalog.json')));
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbh-modern-inventory.json'));
  const byId = new Map(catalog.lists.map((entry) => [entry.id, entry]));

  for (const [section, id, count] of RECONCILED_SECTIONS) {
    const entry = byId.get(id);
    assert.ok(entry, `${section} is missing catalog id ${id}`);
    assert.equal(entry.count, count);
  }

  const sourceEntries = RECONCILED_SECTIONS
    .map(([, id]) => byId.get(id))
    .filter((entry) => entry.source === sourcePage);
  assert.equal(sourceEntries.length, 9);
  assert.ok(sourceEntries.every((entry) => !entry.source.includes('#')));
  assert.deepEqual(
    Object.fromEntries(sourceEntries.map((entry) => [entry.id, entry.sourceSection])),
    {
      'x-men-divided-we-stand': 'X-Men: Divided We Stand',
      'x-men-manifest-destiny': 'X-Men: Manifest Destiny',
      'x-men-utopia': 'Avengers and X-Men: Utopia',
      'x-men-nation-x': 'X-Men: Nation X',
      'x-men-curse-of-the-mutants': 'Curse of the Mutants',
      'wolverine-goes-to-hell': 'Wolverine Goes to Hell',
      'x-men-age-of-x': 'Age of X',
      'x-men-schism': 'Schism',
      'x-men-regenesis': 'Regenesis',
    },
  );

  assert.equal(byId.has('avengers-vs-x-men'), false);
  assert.ok(inventory.find((entry) => entry.id === 'x-men-events-fast-track').catalogIds.includes('x-men-utopia'));
});

test('Utopia is a standalone gap order with centrally approved overlaps', async () => {
  const mapping = await readJson(path.join(mappingsDir, 'x-men-utopia.json'));
  const report = await readJson(path.join(overlapsDir, 'x-men-utopia.json'));

  assert.equal(mapping.reviewStatus, 'approved');
  assert.equal(mapping.rows.length, 14);
  assert.equal(mapping.approvedSourceCount, 14);
  assert.equal(sequenceDigest(mapping.rows.map((row) => String(row.selectedIssueId))),
    'aced364cbb7395fb6d39485b2ce8f769c120574398b7ee800b97036876780db9');
  assert.equal(report.candidateCount, 14);
  assert.equal(report.comparisonCount, 136);

  const overlaps = Object.fromEntries(
    report.comparisons
      .filter((comparison) => comparison.relationship !== 'none')
      .map((comparison) => [comparison.orderId, comparison]),
  );
  assert.deepEqual(Object.keys(overlaps).sort(), ['dark-reign-avengers', 'x-men-nation-x']);
  assert.deepEqual(overlaps['dark-reign-avengers'].sharedIds, ['27513', '24814', '24806']);
  assert.deepEqual(overlaps['x-men-nation-x'].sharedIds, ['26968', '26969', '26970', '26971', '26972']);

  const approved = new Map(mapping.relationshipReview.dispositions.map((entry) => [entry.orderId, entry]));
  assert.equal(approved.get('dark-reign-avengers').decision, 'approved');
  assert.equal(approved.get('x-men-nation-x').decision, 'approved');
});

test('the no-repeat X-Men path preserves the source handoff without adding AvX', async () => {
  const catalog = parseCatalog(await readJson(path.join(dataDir, 'catalog.json')));
  const readingPath = catalog.paths.find((entry) => entry.id === 'x-men-messiah-to-avx');
  assert.ok(readingPath);
  assert.deepEqual(readingPath.steps, PATH_STEPS);
  assert.equal(readingPath.steps.includes('x-men-utopia'), false);
  assert.equal(readingPath.steps.includes('avengers-vs-x-men'), false);
});
