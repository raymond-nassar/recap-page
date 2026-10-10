import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildComparisonReport } from '../scripts/lib/cbh-overlap.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'miles-morales-best-of';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const range = (start, end) => Array.from(
  { length: end - start + 1 },
  (_, index) => String(start + index),
);

const sections = [
  {
    heading: "1. Ultimate Comics Spider-Man, Vol. 1 & 2 (Miles Morales' origin)",
    runs: [{ seriesId: 13831, numbers: range(1, 10) }],
  },
  {
    heading: '2. Spider-Men',
    runs: [{ seriesId: 16264, numbers: range(1, 5) }],
  },
  {
    heading: '3. Ultimate Comics Spider-Man by Brian Michael Bendis, Vol. 4',
    runs: [
      { seriesId: 13831, numbers: ['16.1'] },
      { seriesId: 13831, numbers: range(19, 22) },
    ],
  },
  {
    heading: '4. Miles Morales: Ultimate Spider-Man, Vol. 1: Revival',
    runs: [
      { seriesId: 18508, numbers: range(1, 5) },
      { seriesId: 17580, numbers: ['200'] },
    ],
  },
  {
    heading: '5. All-New Ultimates, Vol. 1: Power for Power',
    runs: [{ seriesId: 18524, numbers: range(1, 6) }],
  },
  {
    heading: '6. Spider-Verse',
    runs: [
      { seriesId: 17285, numbers: range(7, 15) },
      { seriesId: 17554, numbers: range(32, 33) },
      { seriesId: 18892, numbers: range(1, 2) },
      { seriesId: 18893, numbers: range(1, 3) },
      { seriesId: 18889, numbers: range(1, 3) },
      { seriesId: 18894, numbers: range(1, 4) },
      { seriesId: 18891, numbers: range(6, 8) },
    ],
  },
  {
    heading: '7. Secret Wars',
    runs: [{ seriesId: 19648, numbers: range(1, 9) }],
  },
  {
    heading: '8. Spider-Man/Spider-Gwen: Sitting in a Tree',
    runs: [
      { seriesId: 20508, numbers: range(12, 14) },
      { seriesId: 20505, numbers: range(16, 18) },
    ],
  },
  {
    heading: '9. Gwenpool, the Unbelievable Vol. 4: Beyond the Fourth Wall',
    runs: [{ seriesId: 21490, numbers: range(16, 20) }],
  },
  {
    heading: '10. Venom by Donny Cates, Vol. 1: Rex',
    runs: [{ seriesId: 24310, numbers: range(1, 6) }],
  },
];

async function expectedSelection() {
  const broad = await readJson('src/data/miles_morales_spider_man_reading_order.json');
  return sections.flatMap((section) => section.runs.flatMap(({ seriesId, numbers }) => (
    numbers.map((number) => {
      const rows = broad.items.filter((item) => item.seriesId === seriesId
        && String(item.number) === number);
      assert.equal(rows.length, 1, `expected one existing issue for series ${seriesId} #${number}`);
      return { ...rows[0], section: section.heading };
    })
  )));
}

test('Miles Morales best-of source and payload preserve all 84 requested positions', async () => {
  const [markdown, payload, manifest, catalog, ratedGuideIndex, expected] = await Promise.all([
    readFile('src/data/orders/miles-morales-best-of.md', 'utf8'),
    readJson('src/data/miles_morales_best_of.json'),
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
    readJson('src/data/rated-guide-index.json'),
    expectedSelection(),
  ]);
  const parsed = parseChecklist(markdown);
  const source = manifest.lists.find((entry) => entry.id === id);
  const catalogEntry = catalog.lists.find((entry) => entry.id === id);

  assert.equal(expected.length, 84);
  assert.equal(parsed.entries.length, 84);
  assert.equal(parsed.unresolved.length, 0);
  assert.deepEqual(parsed.headings.slice(1), sections.map(({ heading }) => heading));
  assert.deepEqual(parsed.entries.map((entry) => [
    entry.issueId, entry.title, entry.url, entry.section, entry.sourceKey,
    entry.index,
  ]), expected.map((item, index) => [
    item.issueId, item.title, item.url, item.section, String(index + 1), index,
  ]));
  assert.deepEqual(payload.items.map((item) => [
    item.issueId, item.title, item.url, item.seriesId, String(item.number), item.collectedIn,
  ]), expected.map((item) => [
    item.issueId, item.title, item.url, item.seriesId, String(item.number), item.section,
  ]));
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, 84);
  assert.equal(payload.count, 84);
  assert.equal(source.name, 'Best Miles Morales Comics Reading List');
  assert.equal(source.type, 'character-run');
  assert.equal(source.spotlightKind, 'best-of');
  assert.equal(source.depth, 'selected');
  assert.equal(source.sourceFile, 'miles-morales-best-of.md');
  assert.equal(source.sourceOrigin, 'Selected by the project owner');
  assert.equal(source.sourceLicense, null);
  assert.equal(source.sourcePage, undefined);
  assert.equal(source.expect, 84);
  assert.equal(catalogEntry.file, 'miles_morales_best_of.json');
  assert.equal(catalogEntry.count, 84);
  assert.equal(catalogEntry.type, 'character-run');
  assert.equal(catalogEntry.spotlightKind, 'best-of');
  assert.equal(catalogEntry.depth, 'selected');
  assert.equal(catalogEntry.sourceOrigin, source.sourceOrigin);
  assert.equal(catalogEntry.sourceLicense, null);
  assert.equal(catalogEntry.source, null);

  const ratedGuideIndexOrdinal = ratedGuideIndex.guides.findIndex(([guideId]) => guideId === id);
  assert.ok(ratedGuideIndexOrdinal >= 0);
  assert.deepEqual(ratedGuideIndex.guides[ratedGuideIndexOrdinal], [
    id, source.name, source.characters,
  ]);
  const indexedGuideOrdinals = new Map(
    ratedGuideIndex.issueGuides.map(([issueId, ordinals]) => [issueId, ordinals]),
  );
  for (const item of expected) {
    assert.ok(indexedGuideOrdinals.get(item.issueId)?.includes(ratedGuideIndexOrdinal),
      `rated-guide index is missing issue ${item.issueId}`);
  }

  const issue200 = payload.items.find((item) => item.issueId === 50446);
  assert.equal(issue200.number, '200');
  assert.equal(issue200.seriesId, 17580);
  assert.equal(issue200.url,
    'https://www.marvel.com/comics/issue/50446/ultimate_spider-man_2011_200');
  assert.equal(parsed.entries.find((entry) => entry.issueId === 50446).sourceKey, '26');
});

test('Miles Morales best-of classifies its relationships against the full current catalog', async () => {
  const expected = await expectedSelection();
  const [catalog, candidate] = await Promise.all([
    readJson('src/data/catalog.json'),
    readJson('src/data/miles_morales_best_of.json'),
  ]);
  const peerOrders = await Promise.all(catalog.lists
    .filter((entry) => entry.id !== id)
    .map(async (entry) => ({
      orderId: entry.id,
      issueIds: (await readJson(`src/data/${entry.file}`)).items,
    })));
  const report = buildComparisonReport({
    candidateIds: candidate.items.map((item) => item.issueId),
    orders: peerOrders,
  });

  assert.deepEqual(candidate.items.map((item) => item.issueId),
    expected.map((item) => item.issueId));
  assert.equal(report.candidateCount, 84);
  assert.equal(report.comparisonCount, catalog.lists.length - 1);
  assert.equal(report.comparisons.filter((entry) => entry.relationship === 'candidate-subset').length, 1);
  assert.equal(report.comparisons.filter((entry) => entry.relationship === 'partial').length, 14);
  assert.equal(report.comparisons.filter((entry) => entry.relationship === 'none').length, 300);
  assert.equal(report.comparisons.filter((entry) => entry.relationship === 'exact').length, 0);
  assert.equal(report.comparisons.filter((entry) => entry.relationship === 'existing-subset').length, 0);
  assert.deepEqual(report.comparisons.map((entry) => entry.orderId),
    catalog.lists.filter((entry) => entry.id !== id)
      .map((entry) => entry.id).sort((left, right) => left.localeCompare(right)));
  assert.deepEqual(report.comparisons
    .filter((entry) => entry.relationship !== 'none')
    .map((entry) => [entry.orderId, entry.relationship]), [
    ['amazing-spider-man-reading-order-modern-marvel-era', 'partial'],
    ['avengers-doomsday-secret-wars', 'partial'],
    ['doctor-doom-primer', 'partial'],
    ['doctor-octopus-otto-octavius-reading-order', 'partial'],
    ['donny-cates-marvel-universe-reading-order-2017', 'partial'],
    ['hickman-full', 'partial'],
    ['hickman-minimal', 'partial'],
    ['miles-morales-spider-man-reading-order', 'candidate-subset'],
    ['namor-sub-mariner-reading-order', 'partial'],
    ['spider-gwen-reading-order', 'partial'],
    ['spider-man-2099-reading-order', 'partial'],
    ['spider-verse', 'partial'],
    ['ultimate-spider-man-reading-order', 'partial'],
    ['venom-reading-order', 'partial'],
    ['winter-soldier-bucky-barnes-reading-order', 'partial'],
  ]);

  const broadMilesGuide = report.comparisons.find(
    (entry) => entry.orderId === 'miles-morales-spider-man-reading-order',
  );
  assert.equal(broadMilesGuide.relationship, 'candidate-subset');
  assert.equal(broadMilesGuide.sharedCount, 84);
  assert.deepEqual(broadMilesGuide.sharedIds, expected.map((item) => String(item.issueId)));
});
