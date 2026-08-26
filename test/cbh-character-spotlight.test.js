import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approvalDigestFor,
  libraryDigestFor,
  packetDigestFor,
  validateFrozenPacket,
  validateInventoryState,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { issueIdsFromValue } from '../scripts/lib/cbh-overlap.mjs';
import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const candidateId = 'white-tiger-ava-ayala';
const batchCandidateIds = ['phalanx-reading-order', 'marvels-best-phoenix-comics'];
const cosmicCandidateId = 'rocket-raccoon-reading-order';
const grootCandidateId = 'groot-reading-order';
const ironManCandidateId = 'iron-man-reading-order';
const starLordCandidateId = 'star-lord-reading-order';
const starLordInventoryId = 'star-lord-reading-order-complete-peter-quill-comics-timeline';
const characterCandidateIds = [
  grootCandidateId,
  starLordCandidateId,
  'phalanx-reading-order',
  'marvels-best-phoenix-comics',
  cosmicCandidateId,
  candidateId,
];

function issueRange(series, year, from, to) {
  return Array.from({ length: to - from + 1 }, (_, index) => `${series}|${year}|${from + index}`);
}

const rocketSourceSequence = [
  'Tales to Astonish|1959|13',
  'Incredible Hulk|1962|271',
  ...issueRange('Rocket Raccoon', 1985, 1, 4),
  'Marvel Preview|1975|7',
  ...issueRange('Annihilators', 2010, 1, 4),
  ...issueRange('Annihilators: Earthfall', 2011, 1, 4),
  ...issueRange('Guardians of the Galaxy', 2008, 1, 25),
  ...issueRange('Rocket Raccoon', 2016, 1, 5),
  ...issueRange('Rocket', 2017, 1, 6),
  'Shuri|2018|3',
  ...issueRange('Avengers No Road Home', 2019, 1, 10),
  ...issueRange('Guardians of the Galaxy', 2019, 1, 12),
  'GUARDIANS OF THE GALAXY ANNUAL 1|2019|1',
];

const grootSourceSequence = [
  'Tales to Astonish|1959|13',
  'Incredible Hulk|1962|271',
  ...issueRange('Rocket Raccoon', 1985, 1, 4),
  'Marvel Preview|1975|7',
  ...issueRange('Annihilators', 2010, 1, 4),
  ...issueRange('Annihilators: Earthfall', 2011, 1, 4),
  ...issueRange('Guardians of the Galaxy', 2008, 1, 25),
  ...issueRange('Groot', 2015, 1, 6),
  ...issueRange('Rocket Raccoon', 2014, 1, 11),
  ...issueRange('Rocket Raccoon & Groot', 2016, 1, 10),
  ...issueRange('Annihilation: Conquest - Starlord', 2007, 1, 4),
  'Shuri|2018|3',
  ...issueRange('Groot', 2023, 1, 4),
];

const starLordSourceSequence = [
  'Marvel Preview|1975|4',
  'Marvel Preview|1975|11',
  'Marvel Preview|1975|14',
  'Marvel Preview|1975|15',
  'Marvel Preview|1975|18',
  'Marvel Comics Super Special|1977|10',
  'Marvel Spotlight|1979|6',
  'Marvel Spotlight|1979|7',
  'Marvel Premiere|1972|61',
  'Starlord|1996|1',
  'Starlord|1996|2',
  'Starlord|1996|3',
  'Guardians of the Galaxy|2008|1',
  'Guardians of the Galaxy|2008|2',
  'Guardians of the Galaxy|2008|3',
  'Guardians of the Galaxy|2008|4',
  'Guardians of the Galaxy|2008|5',
  'Guardians of the Galaxy|2008|6',
  'Guardians of the Galaxy|2008|7',
  'Guardians of the Galaxy|2008|8',
  'Guardians of the Galaxy|2008|9',
  'Guardians of the Galaxy|2008|10',
  'Guardians of the Galaxy|2008|11',
  'Guardians of the Galaxy|2008|12',
  'Guardians of the Galaxy|2008|13',
  'Guardians of the Galaxy|2008|14',
  'Guardians of the Galaxy|2008|15',
  'Guardians of the Galaxy|2008|16',
  'Guardians of the Galaxy|2008|17',
  'Guardians of the Galaxy|2008|18',
  'Guardians of the Galaxy|2008|19',
  'Guardians of the Galaxy|2008|20',
  'Guardians of the Galaxy|2008|21',
  'Guardians of the Galaxy|2008|22',
  'Guardians of the Galaxy|2008|23',
  'Guardians of the Galaxy|2008|24',
  'Guardians of the Galaxy|2008|25',
  'Legendary Star-Lord|2014|1',
  'Legendary Star-Lord|2014|2',
  'Legendary Star-Lord|2014|3',
  'Legendary Star-Lord|2014|4',
  'Legendary Star-Lord|2014|5',
  'Legendary Star-Lord|2014|6',
  'Legendary Star-Lord|2014|7',
  'Legendary Star-Lord|2014|8',
  'Legendary Star-Lord|2014|9',
  'Legendary Star-Lord|2014|10',
  'Star-Lord and Kitty Pryde|2015|1',
  'Star-Lord and Kitty Pryde|2015|2',
  'Star-Lord and Kitty Pryde|2015|3',
  'Star-Lord|2015|1',
  'Star-Lord|2015|2',
  'Star-Lord|2015|3',
  'Star-Lord|2015|4',
  'Star-Lord|2015|5',
  'Star-Lord|2015|6',
  'Star-Lord|2015|7',
  'Star-Lord|2015|8',
  'Star-Lord|2016|1',
  'Star-Lord|2016|2',
  'Star-Lord|2016|3',
  'Star-Lord|2016|4',
  'Star-Lord|2016|5',
  'Star-Lord|2016|6',
  'Free Comic Book Day|2017|1',
  'All-New Guardians of the Galaxy|2017|1',
  'All-New Guardians of the Galaxy|2017|2',
  'All-New Guardians of the Galaxy|2017|4',
  'All-New Guardians of the Galaxy|2017|6',
  'All-New Guardians of the Galaxy|2017|8',
  'All-New Guardians of the Galaxy|2017|10',
  'All-New Guardians of the Galaxy|2017|3',
  'All-New Guardians of the Galaxy|2017|5',
  'All-New Guardians of the Galaxy|2017|7',
  'All-New Guardians of the Galaxy|2017|9',
  'All-New Guardians of the Galaxy|2017|11',
  'All-New Guardians of the Galaxy|2017|12',
  'All-New Guardians of the Galaxy|2017|146',
  'All-New Guardians of the Galaxy|2017|147',
  'All-New Guardians of the Galaxy|2017|148',
  'All-New Guardians of the Galaxy|2017|149',
  'All-New Guardians of the Galaxy|2017|150',
  'The Mighty Captain Marvel|2017|125',
  'The Mighty Captain Marvel|2017|126',
  'The Mighty Captain Marvel|2017|127',
  'The Mighty Captain Marvel|2017|128',
  'The Mighty Captain Marvel|2017|129',
  'Old Man Quill|2019|1',
  'Old Man Quill|2019|2',
  'Old Man Quill|2019|3',
  'Old Man Quill|2019|4',
  'Old Man Quill|2019|5',
  'Old Man Quill|2019|6',
  'Old Man Quill|2019|7',
  'Old Man Quill|2019|8',
  'Old Man Quill|2019|9',
  'Old Man Quill|2019|10',
  'Old Man Quill|2019|11',
  'Old Man Quill|2019|12',
];

function assertRocketSourceBoundary(packet) {
  assert.equal(packet.rows.length, 75);
  assert.deepEqual(
    packet.rows.map((row) => (
      `${row.normalizedSeriesTitle}|${row.seriesYear}|${row.issueNumber}`
    )),
    rocketSourceSequence,
  );
}
const laterHistoricalIds = [
  'muir-island-saga',
  'bloodties',
  'midnight-massacre',
  'childs-play',
  'eighth-day',
  'reed-richards-and-sue-storms-wedding',
  'kree-skrull-war',
  'the-night-gwen-stacy-died',
  'avengers-defenders-war',
  'thanos-war',
  'original-clone-saga',
  'phoenix-saga',
  'dark-phoenix-saga',
  'days-of-future-past',
  'contest-of-champions',
  'marvel-super-heroes-secret-wars',
  'wraith-war',
  'secret-wars-ii',
  'mutant-massacre',
  'kravens-last-hunt',
  'fall-of-the-mutants',
  'evolutionary-war',
  'inferno',
  'atlantis-attacks',
  'days-of-future-present',
  'x-tinction-agenda',
  'operation-galactic-storm',
  'dead-mans-hand',
  'rise-of-the-midnight-sons',
  'x-cutioners-song',
  'mys-tech-wars',
  'fatal-attractions',
  'time-and-time-again',
  'phalanx-covenant',
  'operation-zero-tolerance',
  'spider-man-identity-crisis',
  'hunt-for-xavier',
  'magneto-war',
];
const laterMcuIds = [
  'doctor-strange-multiverse-of-madness',
  'spider-man-no-way-home',
  'marvel-multiverse',
  'marvel-what-if',
  'wandavision',
  'spider-man-far-from-home',
];
const laterCbhIds = [
  'hickman-x-men',
  'ultimate-marvel-intro',
  'x-men-utopia',
  'x-men-messiah-to-avx',
];
const continuationHistoricalIds = laterHistoricalIds.slice(5);

function assertGrootSourceBoundary(packet) {
  assert.equal(
    packet.sourceIssueBearingBlocksSha256,
    '2f73854ba172a902a511cb2ae45ee4236bf81367166126667370c482c26478e3',
  );
  assert.equal(packet.sourceRetrievedAt, '2026-08-23');
  assert.equal(packet.sourceOccurrenceCount, 84);
  assert.equal(packet.repeatedSourceReferences.length, 8);
  assert.deepEqual(
    packet.repeatedSourceReferences.map(({ sourcePosition, canonicalRow }) => ({
      sourcePosition,
      canonicalRow,
    })),
    Array.from({ length: 8 }, (_, index) => ({
      sourcePosition: 72 + index,
      canonicalRow: 8 + index,
    })),
  );
  assert.equal(packet.excludedSourceReferences.some((entry) => /already represented/i.test(entry)), false);
  assert.equal(packet.rows.length, 76);
  assert.deepEqual(
    packet.rows.map((row) => (
      `${row.normalizedSeriesTitle}|${row.seriesYear}|${row.issueNumber}`
    )),
    grootSourceSequence,
  );
}

function assertStarLordSourceBoundary(packet) {
  assert.equal(
    packet.sourceIssueBearingBlocksSha256,
    '8e604a0e5f77a1d927be683aa5325da0ede70a658dacf9b7d0661f4213813aa8',
  );
  assert.equal(packet.sourceRetrievedAt, '2026-08-23');
  assert.equal(packet.rows.length, 99);
  assert.deepEqual(
    packet.rows.map((row) => (
      `${row.normalizedSeriesTitle}|${row.seriesYear}|${row.issueNumber}`
    )),
    starLordSourceSequence,
  );
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

async function prePublicationLibraryDigest(manifest, excludedIds = [candidateId]) {
  const excluded = new Set(excludedIds);
  const lists = manifest.lists.filter((entry) => !excluded.has(entry.id));
  const paths = (manifest.paths ?? []).filter((entry) => (
    !excluded.has(entry.id)
    && !entry.steps?.some((step) => excluded.has(step))
  ));
  const orderIssueIds = await Promise.all(lists.map(async (entry) => {
    const payload = await readJson(path.join('src', 'data', entry.out || `${entry.id}.json`));
    return {
      id: entry.id,
      issueIds: issueIdsFromValue(payload),
    };
  }));
  return libraryDigestFor({ ...manifest, lists, paths }, orderIssueIds);
}

test('spotlight taxonomy does not rewrite frozen issue-library evidence', () => {
  const manifest = {
    version: 1,
    lists: [{
      id: 'example-character',
      type: 'character-run',
      title: 'Example Character',
    }],
  };
  const classified = {
    ...manifest,
    lists: manifest.lists.map((entry) => ({ ...entry, spotlightKind: 'best-of' })),
  };
  const issueIds = [{ id: 'example-character', issueIds: ['1', '2'] }];

  assert.equal(libraryDigestFor(classified, issueIds), libraryDigestFor(manifest, issueIds));
  assert.notEqual(
    libraryDigestFor({
      ...manifest,
      lists: manifest.lists.map((entry) => ({ ...entry, title: 'Changed Character' })),
    }, issueIds),
    libraryDigestFor(manifest, issueIds),
  );
});

test('the character inventory preserves every central disposition and ships six spotlights', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  assert.doesNotThrow(() => validateInventoryState(inventory));
  assert.equal(inventory.length, 128);
  assert.equal(new Set(inventory.map((record) => record.id)).size, 128);
  assert.equal(new Set(inventory.map((record) => record.url)).size, 128);

  const dispositionCounts = inventory.reduce((counts, record) => {
    counts[record.centralDisposition] = (counts[record.centralDisposition] ?? 0) + 1;
    return counts;
  }, {});
  assert.equal(dispositionCounts.deferred, 113);
  assert.equal(dispositionCounts.excluded, 7);
  assert.equal(dispositionCounts.blocked, 2);
  assert.equal(dispositionCounts['pilot-approved'], 6);

  const shipped = inventory.filter((record) => record.deliveryStatus === 'shipped');
  assert.deepEqual(shipped.map((record) => record.id), [
    grootCandidateId,
    'phalanx-reading-order',
    'marvels-best-phoenix-comics',
    cosmicCandidateId,
    starLordInventoryId,
    candidateId,
  ]);
  const shippedById = new Map(shipped.map((record) => [record.id, record]));
  assert.deepEqual(shippedById.get('phalanx-reading-order').catalogIds, ['phalanx-reading-order']);
  assert.deepEqual(
    shippedById.get('phalanx-reading-order').overlapIds,
    ['xmen-claremont', 'xmen-claremont-complete'],
  );
  assert.deepEqual(shippedById.get(grootCandidateId).catalogIds, [grootCandidateId]);
  assert.deepEqual(shippedById.get(grootCandidateId).overlapIds, [
    'annihilation-conquest',
    cosmicCandidateId,
    starLordCandidateId,
    'war-of-kings',
  ]);
  assert.deepEqual(shippedById.get(starLordInventoryId).catalogIds, [starLordCandidateId]);
  assert.deepEqual(shippedById.get(starLordInventoryId).overlapIds, [
    cosmicCandidateId,
    grootCandidateId,
    'infinity-countdown-wars',
    'war-of-kings',
  ]);
  assert.deepEqual(
    shippedById.get('marvels-best-phoenix-comics').catalogIds,
    ['marvels-best-phoenix-comics'],
  );
  assert.deepEqual(shippedById.get('marvels-best-phoenix-comics').overlapIds, []);
  assert.deepEqual(shippedById.get(cosmicCandidateId).catalogIds, [cosmicCandidateId]);
  assert.deepEqual(shippedById.get(cosmicCandidateId).overlapIds, [
    'marvel-fresh-start-avengers',
    'scarlet-witch-best-of',
    'war-of-kings',
  ]);
  assert.deepEqual(shippedById.get(candidateId).catalogIds, [candidateId]);
  assert.deepEqual(shippedById.get(candidateId).overlapIds, [
    'all-new-all-different-avengers',
    'axis',
    'hickman-full',
    'x-men-regenesis',
  ]);
});

test('the character inventory rejects incomplete evidence and source sets', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const missingField = inventory.map((record) => ({ ...record }));
  delete missingField[0].sourceContentSha256;
  assert.throws(() => validateInventoryState(missingField), /sourceContentSha256/i);
  assert.throws(() => validateInventoryState(inventory.slice(0, -1)), /exactly 128 records/i);
  assert.throws(
    () => validateInventoryState([
      ...inventory.slice(0, -1),
      { ...inventory[0], position: 128 },
    ]),
    /duplicate inventory id/i,
  );
});

test('Iron Man keeps its complete boundary and exact metadata blocker without product artifacts', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const manifest = await readJson('src/data/curated-lists.json');
  const record = inventory.find((candidate) => candidate.id === ironManCandidateId);
  assert.equal(record.centralDisposition, 'deferred');
  assert.equal(record.deliveryStatus, 'not-applicable');
  assert.equal(record.metadataHorizonStatus, 'blocked-exact-resolution-not-run');
  assert.match(record.reason, /815-occurrence source boundary has 813 distinct issues/);
  for (const required of [
    'Crimson Dynamo #1-4',
    'Iron Man: Viva Las Vegas #3-4',
    'Iron Man Legacy #2, #5, and #10',
  ]) {
    assert.match(record.reason, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal(manifest.lists.some((entry) => entry.id === ironManCandidateId), false);
  for (const relativePath of [
    `scripts/data/cbh-packets/${ironManCandidateId}.json`,
    `scripts/data/cbh-mappings/${ironManCandidateId}.json`,
    `scripts/data/cbh-overlaps/${ironManCandidateId}.json`,
    `src/data/orders/${ironManCandidateId}.md`,
    'src/data/iron_man_reading_order.json',
  ]) {
    await assert.rejects(() => readFile(path.join(root, relativePath), 'utf8'), /ENOENT/);
  }
});

test('the frozen White Tiger evidence stays exact through every generated surface', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson(`scripts/data/cbh-packets/${candidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${candidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${candidateId}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/white_tiger_ava_ayala.json');
  const markdown = await readFile(path.join(root, 'src/data/orders/white-tiger-ava-ayala.md'), 'utf8');
  const parsed = parseChecklist(markdown);
  const inventoryRecord = inventory.find((record) => record.id === candidateId);
  const reviewedLibraryDigest = await prePublicationLibraryDigest(
    manifest,
    [
      ...characterCandidateIds,
      ...laterHistoricalIds,
      ...laterMcuIds,
      ...laterCbhIds,
      ...continuationHistoricalIds,
    ],
  );
  const regeneratedReport = await buildReportForMapping(
    path.join(root, 'scripts', 'data', 'cbh-mappings', `${candidateId}.json`),
  );

  assert.equal(reviewedLibraryDigest, '0b747d8a9e3f5f66f42d9eb603a59ef8b0dce7fcea04290d6d34a7506b12aeb3');
  assert.equal(report.libraryDigest, reviewedLibraryDigest);
  assert.deepEqual(
    regeneratedReport.comparisons.filter((comparison) => (
      ![
        'agatha-harkness-reading-order',
        ...batchCandidateIds,
        cosmicCandidateId,
        grootCandidateId,
        starLordCandidateId,
        ...laterHistoricalIds,
        ...laterMcuIds,
        ...laterCbhIds,
      ]
        .includes(comparison.orderId)
    )),
    report.comparisons,
  );
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: candidateId,
    inventoryRecord,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));

  assert.equal(packet.rows.length, 82);
  assert.equal(mapping.rows.length, 82);
  assert.equal(report.candidateCount, 82);
  assert.equal(report.comparisonCount, 86);
  assert.equal(new Set(mapping.rows.map((row) => String(row.selectedIssueId))).size, 82);
  assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));

  const partials = report.comparisons
    .filter((comparison) => comparison.relationship !== 'none')
    .map(({ orderId, relationship, sharedCount }) => ({ orderId, relationship, sharedCount }));
  assert.deepEqual(partials, [
    { orderId: 'all-new-all-different-avengers', relationship: 'partial', sharedCount: 6 },
    { orderId: 'axis', relationship: 'partial', sharedCount: 4 },
    { orderId: 'hickman-full', relationship: 'partial', sharedCount: 1 },
    { orderId: 'x-men-regenesis', relationship: 'partial', sharedCount: 1 },
  ]);

  const community = mapping.rows.at(-1);
  assert.equal(community.selectedIssueId, 103954);
  assert.equal(community.sourceIssueReference, "Marvel's Voices: Community (2021) #1");
  assert.equal(community.resolvedIssueTitle, "Marvel's Voices: Community (2022) #1");
  assert.match(community.note, /source labels the one-shot 2021/i);

  const manifestIndex = manifest.lists.findIndex((entry) => entry.id === candidateId);
  assert.ok(manifestIndex >= 0);
  assert.deepEqual(
    manifest.lists.slice(manifestIndex + 1, manifestIndex + 5).map((entry) => entry.id),
    [
      'phalanx-reading-order',
      'marvels-best-phoenix-comics',
      'agatha-harkness-reading-order',
      cosmicCandidateId,
    ],
  );
  assert.equal(manifest.lists[manifestIndex].type, 'character-run');
  assert.equal(manifest.lists[manifestIndex].group, null);
  assert.equal(catalog.lists.find((entry) => entry.id === candidateId).count, 82);
  assert.deepEqual(
    parsed.entries.map((entry) => String(entry.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.deepEqual(
    generated.items.map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
});

test('the frozen Rocket evidence stays complete, fresh, and exact through every generated surface', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson(`scripts/data/cbh-packets/${cosmicCandidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${cosmicCandidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${cosmicCandidateId}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/rocket_raccoon_reading_order.json');
  const markdown = await readFile(
    path.join(root, 'src/data/orders/rocket-raccoon-reading-order.md'),
    'utf8',
  );
  const parsed = parseChecklist(markdown);
  const inventoryRecord = inventory.find((record) => record.id === cosmicCandidateId);
  const reviewedLibraryDigest = await prePublicationLibraryDigest(
    manifest,
    [
      cosmicCandidateId,
      'agatha-harkness-reading-order',
      grootCandidateId,
      starLordCandidateId,
      ...laterHistoricalIds,
      ...laterMcuIds,
      ...laterCbhIds,
    ],
  );
  const regeneratedReport = await buildReportForMapping(
    path.join(root, 'scripts', 'data', 'cbh-mappings', `${cosmicCandidateId}.json`),
  );

  assert.equal(packet.packetDigest, '99d180656af7f429d8bfb6b40e736f8ba30d0f9334da27799cec8f31ff20b384');
  assert.equal(mapping.mappingDigest, '6f87747f42b979377176e8be7ef6f2c761beeed2aaad297f2af3f53e44deef40');
  assert.equal(reviewedLibraryDigest, '30a01783e36ea7e1a799725e8164805c57f17f79e9697d65201d6cb288ef2cab');
  assert.equal(report.reportDigest, 'fcc1d5607a39e16651ac1b1c05e316a017616c31c4db0d14e1c581f3232f1973');
  assert.equal(
    mapping.relationshipReview.approvalDigest,
    'a62c3676b583f8caea1f422e88f9d22147c96e9533a3b0eca165ba94c8a00b6b',
  );
  assert.equal(report.libraryDigest, reviewedLibraryDigest);
  assert.deepEqual(
    regeneratedReport.comparisons.filter((comparison) => (
      !['agatha-harkness-reading-order'].includes(comparison.orderId)
      &&
      ![
        grootCandidateId,
        starLordCandidateId,
        ...laterHistoricalIds,
        ...laterMcuIds,
        ...laterCbhIds,
        ...continuationHistoricalIds,
      ]
        .includes(comparison.orderId)
    )),
    report.comparisons,
  );
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: cosmicCandidateId,
    inventoryRecord,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));

  assertRocketSourceBoundary(packet);
  assert.equal(mapping.rows.length, 75);
  assert.equal(report.candidateCount, 75);
  assert.equal(report.comparisonCount, 89);
  assert.equal(mapping.relationshipReview.dispositions.length, 89);
  assert.equal(new Set(mapping.rows.map((row) => String(row.selectedIssueId))).size, 75);
  assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
  assert.deepEqual(
    mapping.rows.map((row) => row.sourceIssueReference),
    packet.rows.map((row) => row.sourceIssueReference),
  );
  assert.deepEqual(
    [0, 14, 15, 39, 40, 51, 61, 74].map((index) => mapping.rows[index].selectedIssueId),
    [11353, 39979, 21268, 32551, 62061, 71797, 71987, 76749],
  );

  assert.deepEqual(
    report.comparisons
      .filter((comparison) => comparison.relationship !== 'none')
      .map(({ orderId, relationship, sharedCount }) => ({ orderId, relationship, sharedCount })),
    [
      { orderId: 'marvel-fresh-start-avengers', relationship: 'partial', sharedCount: 10 },
      { orderId: 'scarlet-witch-best-of', relationship: 'partial', sharedCount: 10 },
      { orderId: 'war-of-kings', relationship: 'partial', sharedCount: 7 },
    ],
  );
  assert.deepEqual(
    mapping.relationshipReview.dispositions.map((disposition) => (
      [disposition.orderId, disposition.relationship]
    )),
    report.comparisons.map((comparison) => [comparison.orderId, comparison.relationship]),
  );

  const manifestEntry = manifest.lists.find((entry) => entry.id === cosmicCandidateId);
  const catalogEntry = catalog.lists.find((entry) => entry.id === cosmicCandidateId);
  assert.equal(manifestEntry.type, 'character-run');
  assert.equal(manifestEntry.spotlightKind, 'complete-guide');
  assert.equal(manifestEntry.group, null);
  assert.equal(catalogEntry.type, 'character-run');
  assert.equal(catalogEntry.spotlightKind, 'complete-guide');
  assert.equal(catalogEntry.count, 75);
  assert.deepEqual(
    parsed.entries.map((entry) => String(entry.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.deepEqual(
    generated.items.map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );

  const omittedSourceRow = structuredClone(packet);
  omittedSourceRow.rows.splice(1, 1);
  omittedSourceRow.expectedCount = 74;
  omittedSourceRow.proposedManifest.expect = 74;
  assert.throws(() => assertRocketSourceBoundary(omittedSourceRow));

  const stalePacket = structuredClone(packet);
  stalePacket.rows[0].issueNumber = '14';
  assert.throws(() => validateFrozenPacket(stalePacket), /packet digest is stale/i);

  const staleMapping = structuredClone(mapping);
  staleMapping.rows.pop();
  assert.throws(() => validateMappingDigest(staleMapping), /mapping digest is stale/i);

  const staleReport = structuredClone(report);
  staleReport.comparisons.pop();
  assert.throws(() => validateReportDigest(staleReport), /report digest is stale/i);

  const omittedDisposition = structuredClone(mapping);
  omittedDisposition.relationshipReview.dispositions.pop();
  omittedDisposition.relationshipReview.approvalDigest = approvalDigestFor(
    omittedDisposition.relationshipReview,
  );
  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping: omittedDisposition,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /relationship dispositions are incomplete/i);

  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: '0'.repeat(64),
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /library changed since relationship review/i);
});

test('the frozen Groot evidence stays complete, fresh, distinct, and exact', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson(`scripts/data/cbh-packets/${grootCandidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${grootCandidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${grootCandidateId}.json`);
  const rocketMapping = await readJson(`scripts/data/cbh-mappings/${cosmicCandidateId}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/groot_reading_order.json');
  const markdown = await readFile(
    path.join(root, 'src/data/orders/groot-reading-order.md'),
    'utf8',
  );
  const parsed = parseChecklist(markdown);
  const inventoryRecord = inventory.find((record) => record.id === grootCandidateId);
  const reviewedLibraryDigest = await prePublicationLibraryDigest(
    manifest,
    [grootCandidateId, cosmicCandidateId, 'agatha-harkness-reading-order', ...laterMcuIds, ...laterCbhIds, ...continuationHistoricalIds],
  );
  const regeneratedReport = await buildReportForMapping(
    path.join(root, 'scripts', 'data', 'cbh-mappings', `${grootCandidateId}.json`),
    [path.join(root, 'scripts', 'data', 'cbh-mappings', `${cosmicCandidateId}.json`)],
  );

  assert.equal(packet.packetDigest, 'b9cd22d29d38539fa16d44d15db0cea8108ad414319828c0108845d0f3d267c7');
  assert.equal(mapping.mappingDigest, '8f693cbf39f09350230965373d28a9bf3cb4fc34175ed848b751778a41d16523');
  assert.equal(reviewedLibraryDigest, '8b5680c2dc9ed3b3da78547d62927a95448616ac8ddafdd554675ef30ec1e870');
  assert.equal(report.reportDigest, '616c4564ad98a0f7f7fe5ac57d021e1e19d7156050c82c887d8e8132e9020949');
  assert.equal(
    mapping.relationshipReview.approvalDigest,
    'c12bf41481b245aade1ea4089d9226dc4a1f9698b96d076d1c219de79ecfe949',
  );
  assert.deepEqual(report.peerDigests, {
    [cosmicCandidateId]: '6f87747f42b979377176e8be7ef6f2c761beeed2aaad297f2af3f53e44deef40',
  });
  assert.deepEqual(
    regeneratedReport.comparisons.filter((comparison) => !['agatha-harkness-reading-order'].includes(comparison.orderId)
      && !laterMcuIds.includes(comparison.orderId)
      && !continuationHistoricalIds.includes(comparison.orderId)
      && !laterCbhIds.includes(comparison.orderId)
      && !continuationHistoricalIds.includes(comparison.orderId)),
    report.comparisons,
  );
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: grootCandidateId,
    inventoryRecord,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    peerMappings: [rocketMapping],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));

  assertGrootSourceBoundary(packet);
  assert.equal(mapping.rows.length, 76);
  assert.equal(report.candidateCount, 76);
  assert.equal(report.comparisonCount, 96);
  assert.equal(mapping.relationshipReview.dispositions.length, 96);
  assert.equal(new Set(mapping.rows.map((row) => String(row.selectedIssueId))).size, 76);
  assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
  assert.equal(mapping.approvedSourceCount, 84);
  assert.equal(mapping.sourceOccurrenceCount, 84);
  assert.equal(mapping.rows[70].sourcePosition, 71);
  assert.equal(mapping.rows[71].sourcePosition, 80);
  assert.deepEqual(
    mapping.rows.map((row) => row.sourceIssueReference),
    packet.rows.map((row) => row.sourceIssueReference),
  );
  assert.deepEqual(
    mapping.rows.map((row) => row.selectedIssueId),
    [
      11353, 9082, 22811, 22812, 22813, 22814, 19779, 36644, 36647, 36646, 36645,
      39982, 39981, 39980, 39979, 21268, 21412, 21586, 21783, 22025, 22352, 22544,
      22957, 23148, 23636, 23792, 23793, 23986, 24188, 25303, 25304, 25305, 25306,
      25307, 25308, 25309, 29022, 29009, 29010, 32551, 53697, 53699, 53700, 53701,
      54929, 54930, 50221, 50223, 50224, 50225, 50788, 51150, 52393, 52396, 52399,
      52400, 52401, 55597, 55599, 55601, 55602, 55603, 55604, 55605, 55606, 55607,
      55608, 16009, 16191, 16598, 16599, 71797, 107816, 107817, 107818, 107819,
    ],
  );

  const partials = report.comparisons
    .filter((comparison) => comparison.relationship !== 'none')
    .map(({ orderId, relationship, sharedCount }) => ({ orderId, relationship, sharedCount }));
  assert.deepEqual(partials, [
    { orderId: 'annihilation-conquest', relationship: 'partial', sharedCount: 4 },
    { orderId: cosmicCandidateId, relationship: 'partial', sharedCount: 41 },
    { orderId: starLordCandidateId, relationship: 'partial', sharedCount: 25 },
    { orderId: 'war-of-kings', relationship: 'partial', sharedCount: 7 },
  ]);
  const grootIds = new Set(mapping.rows.map((row) => String(row.selectedIssueId)));
  const sharedRocketIds = rocketMapping.rows
    .map((row) => String(row.selectedIssueId))
    .filter((id) => grootIds.has(id));
  assert.equal(sharedRocketIds.length, 41);
  assert.deepEqual(
    new Set(report.comparisons.find((comparison) => (
      comparison.orderId === cosmicCandidateId
    )).sharedIds),
    new Set(sharedRocketIds),
  );

  const manifestEntry = manifest.lists.find((entry) => entry.id === grootCandidateId);
  const catalogEntry = catalog.lists.find((entry) => entry.id === grootCandidateId);
  assert.equal(manifestEntry.type, 'character-run');
  assert.equal(manifestEntry.spotlightKind, 'complete-guide');
  assert.equal(manifestEntry.group, null);
  assert.equal(manifestEntry.expect, 76);
  assert.equal(catalogEntry.type, 'character-run');
  assert.equal(catalogEntry.spotlightKind, 'complete-guide');
  assert.equal(catalogEntry.count, 76);
  assert.deepEqual(
    parsed.entries.map((entry) => String(entry.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.match(markdown, /84 issue occurrences, including 8 intentional repeats/);
  assert.match(markdown, /each distinct comic once at its first source occurrence/);
  assert.deepEqual(
    generated.items.map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );

  const malformedBoundary = structuredClone(packet);
  malformedBoundary.sourceIssueBearingBlocksSha256 = 'not-a-digest';
  malformedBoundary.packetDigest = packetDigestFor(malformedBoundary);
  assert.throws(
    () => validateFrozenPacket(malformedBoundary),
    /sourceIssueBearingBlocksSha256 must be a lowercase SHA-256 digest/i,
  );

  const staleBoundary = structuredClone(packet);
  staleBoundary.sourceIssueBearingBlocksSha256 = '0'.repeat(64);
  staleBoundary.packetDigest = packetDigestFor(staleBoundary);
  assert.doesNotThrow(() => validateFrozenPacket(staleBoundary));
  assert.throws(() => assertGrootSourceBoundary(staleBoundary));

  const stalePeer = structuredClone(rocketMapping);
  stalePeer.rows[0].selectedIssueId = 9999;
  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    peerMappings: [stalePeer],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /mapping digest is stale/i);
});

test('the frozen Star-Lord evidence stays complete, fresh, distinct, and exact', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson(`scripts/data/cbh-packets/${starLordCandidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${starLordCandidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${starLordCandidateId}.json`);
  const rocketMapping = await readJson(`scripts/data/cbh-mappings/${cosmicCandidateId}.json`);
  const grootMapping = await readJson(`scripts/data/cbh-mappings/${grootCandidateId}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/star_lord_reading_order.json');
  const markdown = await readFile(
    path.join(root, 'src/data/orders/star-lord-reading-order.md'),
    'utf8',
  );
  const parsed = parseChecklist(markdown);
  const inventoryRecord = inventory.find((record) => (
    record.id === starLordInventoryId
  ));
  const reviewedLibraryDigest = await prePublicationLibraryDigest(
    manifest,
    [
      starLordCandidateId,
      cosmicCandidateId,
      grootCandidateId,
      'agatha-harkness-reading-order',
      ...laterMcuIds,
      ...laterCbhIds,
      ...continuationHistoricalIds,
    ],
  );
  const regeneratedReport = await buildReportForMapping(
    path.join(root, 'scripts', 'data', 'cbh-mappings', `${starLordCandidateId}.json`),
    [
      path.join(root, 'scripts', 'data', 'cbh-mappings', `${cosmicCandidateId}.json`),
      path.join(root, 'scripts', 'data', 'cbh-mappings', `${grootCandidateId}.json`),
    ],
  );

  assert.equal(packet.packetDigest, 'a19869d4e6e5250df9c8fba6f4c65cb485fd63124cd104020c6af310e1abc4ac');
  assert.equal(mapping.mappingDigest, '731a3399ed455840723712deeffa4dc4a9a0ef2cc11d6fd093da6e3af97552da');
  assert.equal(reviewedLibraryDigest, '8b0b2826b312a913ee631c170f41b6ffebf659a73d2f2651f5ab61d55e293602');
  assert.equal(report.reportDigest, '552d9bb8cf029f865467f2895e85d4badfc0b3a21aec14215aeec20433040543');
  assert.equal(
    mapping.relationshipReview.approvalDigest,
    'c4ef4b9a736d166c31ffc385a77a69deff39038bbd2ff545ca222a92316d546c',
  );
  assert.deepEqual(report.peerDigests, {
    [grootCandidateId]: '8f693cbf39f09350230965373d28a9bf3cb4fc34175ed848b751778a41d16523',
    [cosmicCandidateId]: '6f87747f42b979377176e8be7ef6f2c761beeed2aaad297f2af3f53e44deef40',
  });
  assert.deepEqual(
    regeneratedReport.comparisons.filter((comparison) => (
      !['agatha-harkness-reading-order'].includes(comparison.orderId)
      &&
      !laterMcuIds.includes(comparison.orderId)
      && !laterCbhIds.includes(comparison.orderId)
      && !continuationHistoricalIds.includes(comparison.orderId)
    )),
    report.comparisons,
  );
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: starLordCandidateId,
    inventoryRecord,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    peerMappings: [rocketMapping, grootMapping],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));

  assertStarLordSourceBoundary(packet);
  assert.equal(mapping.rows.length, 99);
  assert.equal(report.candidateCount, 99);
  assert.equal(report.comparisonCount, 96);
  assert.equal(mapping.relationshipReview.dispositions.length, 96);
  assert.equal(new Set(mapping.rows.map((row) => String(row.selectedIssueId))).size, 99);
  assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
  assert.deepEqual(
    mapping.rows.map((row) => row.sourceIssueReference),
    packet.rows.map((row) => row.sourceIssueReference),
  );
  assert.deepEqual(
    mapping.rows.map((row) => row.selectedIssueId),
    [
      19776, 19760, 19763, 19764, 19767, 50896, 10263, 82621, 10252, 50897, 50898,
      50899, 21268, 21412, 21586, 21783, 22025, 22352, 22544, 22957, 23148, 23636,
      23792, 23793, 23986, 24188, 25303, 25304, 25305, 25306, 25307, 25308, 25309,
      29022, 29009, 29010, 32551, 50887, 50929, 50952, 50966, 51052, 51141, 53276,
      52028, 52029, 52032, 53710, 53712, 53713, 56180, 56181, 56182, 56183, 56184,
      56185, 56186, 56187, 61681, 61682, 61683, 61684, 61685, 61686, 62818, 61513,
      61514, 61516, 61518, 61520, 61522, 61515, 61517, 61519, 61521, 61523, 61524,
      65074, 65075, 65282, 65283, 65547, 64961, 65062, 65271, 65902, 66271, 73829,
      73830, 73831, 73832, 73833, 73834, 73835, 73836, 73837, 73838, 73839, 73840,
    ],
  );

  const partials = report.comparisons
    .filter((comparison) => comparison.relationship !== 'none')
    .map(({ orderId, relationship, sharedCount }) => ({ orderId, relationship, sharedCount }));
  assert.deepEqual(partials, [
    { orderId: grootCandidateId, relationship: 'partial', sharedCount: 25 },
    { orderId: 'infinity-countdown-wars', relationship: 'partial', sharedCount: 1 },
    { orderId: cosmicCandidateId, relationship: 'partial', sharedCount: 25 },
    { orderId: 'war-of-kings', relationship: 'partial', sharedCount: 7 },
  ]);
  assert.equal(report.comparisons.filter((comparison) => comparison.relationship === 'none').length, 92);

  const starLordIds = new Set(mapping.rows.map((row) => String(row.selectedIssueId)));
  for (const peerMapping of [rocketMapping, grootMapping]) {
    const sharedIds = peerMapping.rows
      .map((row) => String(row.selectedIssueId))
      .filter((id) => starLordIds.has(id));
    assert.equal(sharedIds.length, 25);
    assert.deepEqual(
      new Set(report.comparisons.find((comparison) => (
        comparison.orderId === peerMapping.id
      )).sharedIds),
      new Set(sharedIds),
    );
  }

  const superSpecial = mapping.rows.find((row) => (
    row.sourceIssueReference === 'Marvel Super Special #10'
  ));
  assert.equal(superSpecial.selectedIssueId, 50896);
  const fcbd = mapping.rows.find((row) => row.sourceIssueReference.startsWith('FCBD 2017'));
  assert.equal(fcbd.selectedIssueId, 62818);
  assert.equal(fcbd.issueNumber, '1');
  assert.equal(fcbd.metadataIssueNumber, '0');
  assert.match(fcbd.note, /source calls this issue #1/i);

  const manifestEntry = manifest.lists.find((entry) => entry.id === starLordCandidateId);
  const catalogEntry = catalog.lists.find((entry) => entry.id === starLordCandidateId);
  assert.equal(manifestEntry.type, 'character-run');
  assert.equal(manifestEntry.spotlightKind, 'complete-guide');
  assert.equal(manifestEntry.group, null);
  assert.equal(manifestEntry.expect, 99);
  assert.equal(catalogEntry.type, 'character-run');
  assert.equal(catalogEntry.spotlightKind, 'complete-guide');
  assert.equal(catalogEntry.count, 99);
  assert.deepEqual(
    parsed.entries.map((entry) => String(entry.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.deepEqual(
    generated.items.map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  const starLordIndex = manifest.lists.findIndex((entry) => entry.id === starLordCandidateId);
  assert.equal(manifest.lists[starLordIndex - 1].id, grootCandidateId);
  assert.equal(manifest.lists[starLordIndex + 1].id, 'xmen-claremont');

  const reordered = structuredClone(packet);
  const numeric = reordered.rows.slice(65, 77)
    .sort((left, right) => Number(left.issueNumber) - Number(right.issueNumber));
  reordered.rows.splice(65, 12, ...numeric);
  reordered.packetDigest = packetDigestFor(reordered);
  assert.doesNotThrow(() => validateFrozenPacket(reordered));
  assert.throws(() => assertStarLordSourceBoundary(reordered));

  const omittedSourceRow = structuredClone(packet);
  omittedSourceRow.rows.splice(1, 1);
  omittedSourceRow.expectedCount = 98;
  omittedSourceRow.proposedManifest.expect = 98;
  omittedSourceRow.packetDigest = packetDigestFor(omittedSourceRow);
  assert.throws(() => assertStarLordSourceBoundary(omittedSourceRow));

  const stalePacket = structuredClone(packet);
  stalePacket.rows[0].issueNumber = '5';
  assert.throws(() => validateFrozenPacket(stalePacket), /packet digest is stale/i);

  const staleMapping = structuredClone(mapping);
  staleMapping.rows.pop();
  assert.throws(() => validateMappingDigest(staleMapping), /mapping digest is stale/i);

  const staleReport = structuredClone(report);
  staleReport.comparisons.pop();
  assert.throws(() => validateReportDigest(staleReport), /report digest is stale/i);

  const staleRocket = structuredClone(rocketMapping);
  staleRocket.rows[0].selectedIssueId = 9999;
  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    peerMappings: [staleRocket, grootMapping],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /mapping digest is stale/i);

  const staleGroot = structuredClone(grootMapping);
  staleGroot.rows[0].selectedIssueId = 9999;
  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    peerMappings: [rocketMapping, staleGroot],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /mapping digest is stale/i);

  const omittedDisposition = structuredClone(mapping);
  omittedDisposition.relationshipReview.dispositions.pop();
  omittedDisposition.relationshipReview.approvalDigest = approvalDigestFor(
    omittedDisposition.relationshipReview,
  );
  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping: omittedDisposition,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    peerMappings: [rocketMapping, grootMapping],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /relationship dispositions are incomplete/i);

  const staleApproval = structuredClone(mapping);
  staleApproval.relationshipReview.rationale = 'Changed after approval.';
  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping: staleApproval,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    peerMappings: [rocketMapping, grootMapping],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /approval digest is stale/i);

  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: '0'.repeat(64),
    peerMappings: [rocketMapping, grootMapping],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /library changed since relationship review/i);
});

test('the first character batch stays exact through evidence, catalog, and generated data', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const reviewedLibraryDigest = await prePublicationLibraryDigest(
    manifest,
    [
      ...batchCandidateIds,
      cosmicCandidateId,
      grootCandidateId,
      starLordCandidateId,
      ...laterHistoricalIds,
      ...laterMcuIds,
      ...laterCbhIds,
    ],
  );
  const evidence = await Promise.all(batchCandidateIds.map(async (id) => ({
    id,
    packet: await readJson(`scripts/data/cbh-packets/${id}.json`),
    mapping: await readJson(`scripts/data/cbh-mappings/${id}.json`),
    report: await readJson(`scripts/data/cbh-overlaps/${id}.json`),
    generated: await readJson(`src/data/${id.replaceAll('-', '_')}.json`),
    markdown: await readFile(path.join(root, 'src', 'data', 'orders', `${id}.md`), 'utf8'),
  })));
  const expected = {
    'phalanx-reading-order': {
      count: 28,
      checkpoints: [10353, 8664, 102527],
      partials: [
        { orderId: 'phalanx-covenant', relationship: 'existing-subset', sharedCount: 9 },
        { orderId: 'xmen-claremont', relationship: 'partial', sharedCount: 8 },
        { orderId: 'xmen-claremont-complete', relationship: 'partial', sharedCount: 8 },
      ],
    },
    'marvels-best-phoenix-comics': {
      count: 53,
      checkpoints: [8605, 70250, 109787],
      partials: [
        { orderId: 'hickman-x-men', relationship: 'partial', sharedCount: 5 },
      ],
    },
  };

  assert.equal(reviewedLibraryDigest, '4356357b07c13318a06ead874b65e0259c5e81baa7a31b71722f1fcac5bc498f');
  for (const item of evidence) {
    const peer = evidence.find((candidate) => candidate.id !== item.id);
    const inventoryRecord = inventory.find((record) => record.id === item.id);
    const parsed = parseChecklist(item.markdown);
    const config = expected[item.id];
    assert.doesNotThrow(() => validateFrozenPacket(item.packet, {
      expectedId: item.id,
      inventoryRecord,
      catalogEntries: manifest.lists,
    }));
    assert.doesNotThrow(() => validateMappingDigest(item.mapping));
    assert.doesNotThrow(() => validateReportDigest(item.report));
    assert.doesNotThrow(() => assertApprovedRelationshipReview({
      packet: item.packet,
      mapping: item.mapping,
      report: item.report,
      currentLibraryDigest: reviewedLibraryDigest,
      peerMappings: [peer.mapping],
      expectedOrderIds: item.report.comparisons.map((comparison) => comparison.orderId),
    }));

    assert.equal(item.mapping.rows.length, config.count);
    assert.equal(item.report.candidateCount, config.count);
    assert.equal(item.report.comparisonCount, 137);
    assert.ok(item.mapping.rows.every((row) => row.resolutionStatus === 'exact'));
    assert.equal(new Set(item.mapping.rows.map((row) => String(row.selectedIssueId))).size, config.count);
    assert.deepEqual(
      [item.mapping.rows[0], item.mapping.rows[Math.floor(config.count / 2)], item.mapping.rows.at(-1)]
        .map((row) => row.selectedIssueId),
      config.checkpoints,
    );
    assert.deepEqual(
      item.report.comparisons
        .filter((comparison) => comparison.relationship !== 'none')
        .map(({ orderId, relationship, sharedCount }) => ({ orderId, relationship, sharedCount })),
      config.partials,
    );
    assert.equal(manifest.lists.find((entry) => entry.id === item.id).group, null);
    assert.equal(catalog.lists.find((entry) => entry.id === item.id).count, config.count);
    assert.deepEqual(
      parsed.entries.map((entry) => String(entry.issueId)),
      item.mapping.rows.map((row) => String(row.selectedIssueId)),
    );
    assert.deepEqual(
      item.generated.items.map((row) => String(row.issueId)),
      item.mapping.rows.map((row) => String(row.selectedIssueId)),
    );
  }

  const allBatchIds = evidence.flatMap((item) => item.mapping.rows.map((row) => String(row.selectedIssueId)));
  assert.equal(new Set(allBatchIds).size, 81);
  assert.equal(catalog.lists.length, 140);
  const characterRuns = catalog.lists.filter((entry) => entry.type === 'character-run');
  assert.equal(characterRuns.length, 15);
  assert.equal(new Set(characterRuns.map((entry) => entry.group ?? entry.id)).size, 14);
});
