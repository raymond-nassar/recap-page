import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import {
  approvalDigestFor,
  libraryDigestExcludingOrders,
  mappingDigestFor,
  packetDigestFor,
  reportDigestFor,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import {
  MCU_COMPANION_COUNT,
  MCU_PACKET_REVIEW,
  MCU_SELECTED_IDS,
  validateMcuCompanionInventory,
  validateMcuCompanionPacket,
} from '../scripts/lib/cbh-mcu-companion.mjs';
import {
  CBRO_BATCH_FIVE_SELECTED_IDS,
  CBRO_BATCH_FOUR_SELECTED_IDS,
  CBRO_BATCH_EIGHT_SELECTED_IDS,
  CBRO_BATCH_NINE_SELECTED_IDS,
  CBRO_BATCH_SEVEN_SELECTED_IDS,
  CBRO_BATCH_SIX_SELECTED_IDS,
  CBRO_BATCH_THREE_SELECTED_IDS,
  CBRO_BATCH_TWO_SELECTED_IDS,
  CBRO_CONTINUATION_SELECTED_IDS,
} from '../scripts/lib/cbro-evidence.mjs';
import { loadLibrarySnapshot } from '../scripts/report-order-overlap.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  availableHomeCategories,
  groupCatalog,
  HOME_CATEGORIES,
  parseCatalog,
  shelfLists,
} from '../src/js/lib/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expectedCounts = new Map([
  ['doctor-strange-multiverse-of-madness', 17],
  ['spider-man-no-way-home', 17],
  ['marvel-multiverse', 2],
  ['marvel-what-if', 7],
]);
const expectedRelationships = {
  'doctor-strange-multiverse-of-madness': [
    ['civil-war-avengers', 'partial', 6],
    ['dark-reign-avengers', 'partial', 1],
  ],
  'spider-man-no-way-home': [],
  'marvel-multiverse': [
    ['xmen-claremont', 'candidate-subset', 2],
    ['xmen-claremont-complete', 'candidate-subset', 2],
  ],
  'marvel-what-if': [],
};
const frozenExcludedIds = [
  ...MCU_SELECTED_IDS,
  ...CBRO_CONTINUATION_SELECTED_IDS,
  ...CBRO_BATCH_TWO_SELECTED_IDS,
  ...CBRO_BATCH_THREE_SELECTED_IDS,
  ...CBRO_BATCH_FOUR_SELECTED_IDS,
  ...CBRO_BATCH_FIVE_SELECTED_IDS,
  ...CBRO_BATCH_SIX_SELECTED_IDS,
  ...CBRO_BATCH_SEVEN_SELECTED_IDS,
  ...CBRO_BATCH_EIGHT_SELECTED_IDS,
  ...CBRO_BATCH_NINE_SELECTED_IDS,
];

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

async function loadEvidence() {
  const inventory = await readJson('scripts/data/cbh-mcu-companion-inventory.json');
  const records = new Map(inventory.records.map((record) => [record.id, record]));
  const entries = await Promise.all(MCU_SELECTED_IDS.map(async (id) => ({
    id,
    packet: await readJson(`scripts/data/cbh-packets/${id}.json`),
    mapping: await readJson(`scripts/data/cbh-mappings/${id}.json`),
    report: await readJson(`scripts/data/cbh-overlaps/${id}.json`),
  })));
  return { inventory, records, entries };
}

test('the MCU companion inventory preserves all fourteen user priorities and terminal states', async () => {
  const inventory = await readJson('scripts/data/cbh-mcu-companion-inventory.json');
  assert.doesNotThrow(() => validateMcuCompanionInventory(inventory));
  assert.equal(inventory.records.length, MCU_COMPANION_COUNT);
  assert.deepEqual(
    inventory.records.filter((record) => record.centralDisposition === 'selected')
      .map((record) => record.id),
    MCU_SELECTED_IDS,
  );
  assert.deepEqual(
    inventory.records.filter((record) => record.centralDisposition === 'follow-up')
      .map((record) => record.followUpRank),
    [1, 2, 3, 4, 5, 6],
  );
  assert.equal(
    inventory.records.filter((record) => record.centralDisposition === 'blocked').length,
    4,
  );
  assert.equal(
    inventory.records.find((record) => record.id === 'spider-man-far-from-home').wordpressId,
    40184,
  );

  const missing = structuredClone(inventory);
  missing.records.pop();
  assert.throws(() => validateMcuCompanionInventory(missing), /must contain 14 records/i);

  const reordered = structuredClone(inventory);
  [reordered.records[0], reordered.records[1]] = [reordered.records[1], reordered.records[0]];
  assert.throws(() => validateMcuCompanionInventory(reordered), /position must be 1/i);

  const fabricated = structuredClone(inventory);
  fabricated.records[0].title = 'Fabricated companion';
  assert.throws(() => validateMcuCompanionInventory(fabricated), /identity digest changed/i);
});

test('four frozen packets and mappings preserve 43 exact source rows', async () => {
  const { inventory, records, entries } = await loadEvidence();
  assert.doesNotThrow(() => validateMcuCompanionInventory(inventory));
  const allIds = [];
  for (const { id, packet, mapping } of entries) {
    assert.doesNotThrow(() => validateMcuCompanionPacket(packet, {
      expectedId: id,
      inventoryRecord: records.get(id),
    }));
    assert.doesNotThrow(() => validateMappingDigest(mapping));
    assert.equal(mapping.packetDigest, packet.packetDigest);
    assert.equal(mapping.packetReview, MCU_PACKET_REVIEW);
    assert.equal(packet.rows.length, expectedCounts.get(id));
    assert.equal(mapping.rows.length, expectedCounts.get(id));
    assert.equal(packet.proposedManifest.type, 'screen-companion');
    assert.equal(packet.proposedManifest.depth, 'selected');
    assert.equal(packet.proposedManifest.timeline, null);
    assert.equal(packet.proposedManifest.beginner, false);
    assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
    assert.deepEqual(
      mapping.rows.map((row) => row.sourceIssueReference),
      packet.rows.map((row) => row.sourceIssueReference),
    );
    allIds.push(...mapping.rows.map((row) => String(row.selectedIssueId)));
  }
  assert.equal(allIds.length, 43);
  assert.equal(new Set(allIds).size, 43);

  const doctor = entries.find((entry) => entry.id === 'doctor-strange-multiverse-of-madness');
  assert.equal(doctor.mapping.rows[10].sourceIssueReference, 'New Avengers: Illuminati #0');
  assert.equal(doctor.mapping.rows[10].metadataIssueNumber, '1');
  assert.equal(doctor.mapping.rows[10].manualSeriesSelectionApproved, true);

  const whatIf = entries.find((entry) => entry.id === 'marvel-what-if');
  assert.equal(whatIf.mapping.rows.at(-1).sourceIssueReference, 'What If? Magik');
  assert.equal(whatIf.mapping.rows.at(-1).manualSeriesSelectionApproved, true);

  const omitted = structuredClone(whatIf.packet);
  omitted.rows.pop();
  omitted.expectedCount -= 1;
  omitted.proposedManifest.expect -= 1;
  assert.throws(() => validateMcuCompanionPacket(omitted, {
    expectedId: whatIf.id,
    inventoryRecord: records.get(whatIf.id),
  }), /packet digest is stale/i);

  const sourceDrift = structuredClone(whatIf.packet);
  sourceDrift.sourceIssueBearingBlocksSha256 = '0'.repeat(64);
  sourceDrift.packetDigest = packetDigestFor(sourceDrift);
  assert.throws(() => validateMcuCompanionPacket(sourceDrift, {
    expectedId: whatIf.id,
    inventoryRecord: records.get(whatIf.id),
  }), /issue-bearing boundary differs/i);
});

test('four reports bind the current library and exactly three selected peers', async () => {
  const { records, entries } = await loadEvidence();
  const library = await loadLibrarySnapshot();
  const reviewedLibraryDigest = libraryDigestExcludingOrders(library, frozenExcludedIds);
  const mappings = new Map(entries.map((entry) => [entry.id, entry.mapping]));
  const existingIds = library.lists
    .filter((entry) => !frozenExcludedIds.includes(entry.id))
    .map((entry) => entry.id);

  for (const { id, packet, mapping, report } of entries) {
    const peers = MCU_SELECTED_IDS.filter((peerId) => peerId !== id)
      .map((peerId) => mappings.get(peerId));
    const expectedOrderIds = [...existingIds, ...peers.map((peer) => peer.id)];
    assert.equal(report.comparisonCount, 100);
    assert.equal(report.comparisonCount, expectedOrderIds.length);
    assert.equal(report.libraryDigest, reviewedLibraryDigest);
    assert.doesNotThrow(() => validateReportDigest(report));
    assert.doesNotThrow(() => assertApprovedRelationshipReview({
      packet,
      mapping,
      report,
      currentLibraryDigest: reviewedLibraryDigest,
      peerMappings: peers,
      expectedOrderIds,
    }));
    assert.deepEqual(
      report.comparisons
        .filter((comparison) => comparison.relationship !== 'none')
        .map((comparison) => [
          comparison.orderId,
          comparison.relationship,
          comparison.sharedCount,
        ]),
      expectedRelationships[id],
    );
    assert.equal(mapping.relationshipReview.dispositions.length, 100);
    assert.equal(records.get(id).relationshipStatus, 'reviewed');
  }
});

test('the Marvel Multiverse subset stays explicit, central, and narrowly described', async () => {
  const { entries } = await loadEvidence();
  const item = entries.find((entry) => entry.id === 'marvel-multiverse');
  assert.match(item.packet.proposedManifest.description, /only selection.+identifies by issue number/i);
  const subsetDispositions = item.mapping.relationshipReview.dispositions
    .filter((disposition) => disposition.relationship === 'candidate-subset');
  assert.equal(subsetDispositions.length, 2);
  assert.ok(subsetDispositions.every((disposition) => (
    disposition.authorityType === 'stronger-model'
    && disposition.authorityIdentity === 'MRT-004 coordinator'
    && /transparent thematic subset/i.test(disposition.rationale)
  )));

  const policySubset = structuredClone(item.mapping);
  for (const disposition of policySubset.relationshipReview.dispositions) {
    if (disposition.relationship === 'candidate-subset') disposition.authorityType = 'policy';
  }
  policySubset.relationshipReview.approvalDigest = approvalDigestFor(
    policySubset.relationshipReview,
  );
  const peers = entries.filter((entry) => entry.id !== item.id).map((entry) => entry.mapping);
  const library = await loadLibrarySnapshot();
  assert.throws(() => assertApprovedRelationshipReview({
    packet: item.packet,
    mapping: policySubset,
    report: item.report,
    currentLibraryDigest: libraryDigestExcludingOrders(library, frozenExcludedIds),
    peerMappings: peers,
    expectedOrderIds: [
      ...library.lists
        .filter((entry) => !frozenExcludedIds.includes(entry.id))
        .map((entry) => entry.id),
      ...peers.map((peer) => peer.id),
    ],
  }), /unauthorized authority type/i);
});

test('an exact relationship remains unapprovable', async () => {
  const { entries } = await loadEvidence();
  const item = entries.find((entry) => entry.id === 'spider-man-no-way-home');
  const exactReport = structuredClone(item.report);
  const comparison = exactReport.comparisons[0];
  comparison.relationship = 'exact';
  comparison.sharedCount = item.mapping.rows.length;
  comparison.sharedIds = item.mapping.rows.map((row) => String(row.selectedIssueId));
  exactReport.reportDigest = reportDigestFor(exactReport);

  const exactMapping = structuredClone(item.mapping);
  const disposition = exactMapping.relationshipReview.dispositions
    .find((candidate) => candidate.orderId === comparison.orderId);
  disposition.relationship = 'exact';
  disposition.authorityType = 'stronger-model';
  disposition.authorityIdentity = 'MRT-004 coordinator';
  exactMapping.relationshipReview.reportDigest = exactReport.reportDigest;
  exactMapping.relationshipReview.approvalDigest = approvalDigestFor(
    exactMapping.relationshipReview,
  );
  exactMapping.mappingDigest = mappingDigestFor(exactMapping);

  const peers = entries.filter((entry) => entry.id !== item.id).map((entry) => entry.mapping);
  const library = await loadLibrarySnapshot();
  assert.throws(() => assertApprovedRelationshipReview({
    packet: item.packet,
    mapping: exactMapping,
    report: exactReport,
    currentLibraryDigest: libraryDigestExcludingOrders(library, frozenExcludedIds),
    peerMappings: peers,
    expectedOrderIds: [
      ...library.lists
        .filter((entry) => !frozenExcludedIds.includes(entry.id))
        .map((entry) => entry.id),
      ...peers.map((peer) => peer.id),
    ],
  }), /exactly duplicates.+no approval path/i);
});

test('approved evidence reaches four payloads, cards, and one MCU Prep group', async () => {
  const { inventory, entries } = await loadEvidence();
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = parseCatalog(await readJson('src/data/catalog.json'));
  const manifestIndex = manifest.lists.findIndex((entry) => (
    entry.id === MCU_SELECTED_IDS[0]
  ));
  assert.ok(manifestIndex >= 0);
  assert.deepEqual(
    manifest.lists.slice(manifestIndex, manifestIndex + MCU_SELECTED_IDS.length)
      .map((entry) => entry.id),
    MCU_SELECTED_IDS,
  );
  assert.equal(catalog.lists.length, 134);
  assert.deepEqual(
    inventory.records.filter((record) => record.centralDisposition === 'selected')
      .map((record) => [record.deliveryStatus, record.catalogIds]),
    MCU_SELECTED_IDS.map((id) => ['shipped', [id]]),
  );

  const mappingById = new Map(entries.map((entry) => [entry.id, entry.mapping]));
  for (const id of MCU_SELECTED_IDS) {
    const manifestEntry = manifest.lists.find((entry) => entry.id === id);
    const catalogEntry = catalog.lists.find((entry) => entry.id === id);
    const mapping = mappingById.get(id);
    const markdown = await readFile(path.join(root, 'src', 'data', 'orders', `${id}.md`), 'utf8');
    const payload = await readJson(`src/data/${manifestEntry.out}`);
    const parsed = parseChecklist(markdown);
    assert.equal(manifestEntry.type, 'screen-companion');
    assert.equal(manifestEntry.depth, 'selected');
    assert.equal(manifestEntry.timeline, null);
    assert.equal(manifestEntry.beginner, false);
    assert.equal(Object.hasOwn(manifestEntry, 'spotlightKind'), false);
    assert.equal(catalogEntry.type, 'screen-companion');
    assert.equal(catalogEntry.depth, 'selected');
    assert.equal(catalogEntry.timeline, null);
    assert.equal(catalogEntry.beginner, false);
    assert.equal(catalogEntry.source, mapping.sourceUrl);
    assert.equal(catalogEntry.count, mapping.rows.length);
    assert.equal(payload.placeholders, 0);
    assert.deepEqual(payload.unresolved, []);
    assert.deepEqual(
      parsed.entries.map((entry) => String(entry.issueId)),
      mapping.rows.map((row) => String(row.selectedIssueId)),
    );
    assert.deepEqual(
      payload.items.map((entry) => String(entry.issueId)),
      mapping.rows.map((row) => String(row.selectedIssueId)),
    );
    assert.doesNotMatch(manifestEntry.description, /[\u2013\u2014]/);
  }

  const stories = groupCatalog(catalog.lists);
  const screen = availableHomeCategories(stories)
    .find((category) => category.key === 'marvel-on-screen');
  assert.equal(screen.count, 4);
  const screenDefinition = HOME_CATEGORIES.find((category) => (
    category.key === 'marvel-on-screen'
  ));
  assert.equal(screenDefinition.heading, 'MCU Prep');
  assert.deepEqual(
    screenDefinition.select(stories).map((story) => story.lists[0].id),
    MCU_SELECTED_IDS,
  );
  assert.deepEqual(
    shelfLists(catalog.lists, 'spotlights').length,
    14,
    'Character Spotlight count differs from the reconciled Star-Lord baseline',
  );
});
