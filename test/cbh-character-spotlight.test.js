import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approvalDigestFor,
  libraryDigestFor,
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
const characterCandidateIds = [...batchCandidateIds, cosmicCandidateId, candidateId];

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

function assertRocketSourceBoundary(packet) {
  assert.equal(packet.rows.length, 75);
  assert.deepEqual(
    packet.rows.map((row) => (
      `${row.normalizedSeriesTitle}|${row.seriesYear}|${row.issueNumber}`
    )),
    rocketSourceSequence,
  );
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

async function prePublicationLibraryDigest(manifest, excludedIds = [candidateId]) {
  const excluded = new Set(excludedIds);
  const lists = manifest.lists.filter((entry) => !excluded.has(entry.id));
  const orderIssueIds = await Promise.all(lists.map(async (entry) => {
    const payload = await readJson(path.join('src', 'data', entry.out || `${entry.id}.json`));
    return {
      id: entry.id,
      issueIds: issueIdsFromValue(payload),
    };
  }));
  return libraryDigestFor({ ...manifest, lists }, orderIssueIds);
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

test('the character inventory preserves every central disposition and ships four spotlights', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  assert.doesNotThrow(() => validateInventoryState(inventory));
  assert.equal(inventory.length, 128);
  assert.equal(new Set(inventory.map((record) => record.id)).size, 128);
  assert.equal(new Set(inventory.map((record) => record.url)).size, 128);

  const dispositionCounts = inventory.reduce((counts, record) => {
    counts[record.centralDisposition] = (counts[record.centralDisposition] ?? 0) + 1;
    return counts;
  }, {});
  assert.equal(dispositionCounts.deferred, 115);
  assert.equal(dispositionCounts.excluded, 7);
  assert.equal(dispositionCounts.blocked, 2);
  assert.equal(dispositionCounts['pilot-approved'], 4);

  const shipped = inventory.filter((record) => record.deliveryStatus === 'shipped');
  assert.deepEqual(shipped.map((record) => record.id), characterCandidateIds);
  assert.deepEqual(shipped[0].catalogIds, ['phalanx-reading-order']);
  assert.deepEqual(shipped[0].overlapIds, ['xmen-claremont', 'xmen-claremont-complete']);
  assert.deepEqual(shipped[1].catalogIds, ['marvels-best-phoenix-comics']);
  assert.deepEqual(shipped[1].overlapIds, []);
  assert.deepEqual(shipped[2].catalogIds, [cosmicCandidateId]);
  assert.deepEqual(shipped[2].overlapIds, [
    'marvel-fresh-start-avengers',
    'scarlet-witch-best-of',
    'war-of-kings',
  ]);
  assert.deepEqual(shipped[3].catalogIds, [candidateId]);
  assert.deepEqual(shipped[3].overlapIds, [
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
  const reviewedLibraryDigest = await prePublicationLibraryDigest(manifest, characterCandidateIds);
  const regeneratedReport = await buildReportForMapping(
    path.join(root, 'scripts', 'data', 'cbh-mappings', `${candidateId}.json`),
  );

  assert.equal(reviewedLibraryDigest, '587aa7f5980b16cbaae187fda5fa0296ef82ca6c26cfc4e0ad89e84094ecdb03');
  assert.equal(report.libraryDigest, reviewedLibraryDigest);
  assert.deepEqual(
    regeneratedReport.comparisons.filter((comparison) => (
      ![...batchCandidateIds, cosmicCandidateId].includes(comparison.orderId)
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
      cosmicCandidateId,
      'xmen-claremont',
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
  const reviewedLibraryDigest = await prePublicationLibraryDigest(manifest, [cosmicCandidateId]);
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
  assert.deepEqual(regeneratedReport, report);
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

test('the first character batch stays exact through evidence, catalog, and generated data', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const reviewedLibraryDigest = await prePublicationLibraryDigest(
    manifest,
    [...batchCandidateIds, cosmicCandidateId],
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
        { orderId: 'xmen-claremont', relationship: 'partial', sharedCount: 8 },
        { orderId: 'xmen-claremont-complete', relationship: 'partial', sharedCount: 8 },
      ],
    },
    'marvels-best-phoenix-comics': {
      count: 53,
      checkpoints: [8605, 70250, 109787],
      partials: [],
    },
  };

  assert.equal(reviewedLibraryDigest, '5aac85d8ff7e085eb038bb021ccc106b240070648a8fc152f4a60acecee2bdc0');
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
    assert.equal(item.report.comparisonCount, 88);
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
  assert.equal(catalog.lists.length, 90);
  const characterRuns = catalog.lists.filter((entry) => entry.type === 'character-run');
  assert.equal(characterRuns.length, 12);
  assert.equal(new Set(characterRuns.map((entry) => entry.group ?? entry.id)).size, 11);
});
