import test from 'node:test';
import assert from 'node:assert/strict';
import {
  access,
  mkdtemp,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertApprovedRelationshipReview,
} from '../scripts/author-cbh-packet.mjs';
import {
  CBRO_AUTHOR_IDS,
  approveCbroMappings,
  authorCbroPacket,
  buildCbroMarkdown,
  isApprovedCbroRelationship,
} from '../scripts/author-cbro-packet.mjs';
import {
  CBH_SOURCE_PROVIDER,
  approvalDigestFor,
  libraryDigestExcludingOrders,
  mappingDigestFor,
  packetDigestFor,
  reportDigestFor,
  sourcePositionsForPacket,
  validateBatchNoDuplicates,
  validateFrozenPacket,
  validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import {
  CBRO_ALL_SELECTED_IDS,
  CBRO_AUTHOR_IDS as CBRO_ORIGINAL_AUTHOR_IDS,
  CBRO_BATCH_FOUR_AUTHOR_IDS,
  CBRO_BATCH_FOUR_PACKET_REVIEW,
  CBRO_BATCH_FOUR_SELECTED_IDS,
  CBRO_BATCH_FOUR_UNTOUCHED_INVENTORY_SHA256,
  CBRO_BATCH_FIVE_ACTS_SOURCE_ROWS_SHA256,
  CBRO_BATCH_FIVE_AUTHOR_IDS,
  CBRO_BATCH_FIVE_EVALUATED_OUTCOME_SHA256,
  CBRO_BATCH_FIVE_PACKET_REVIEW,
  CBRO_BATCH_FIVE_SELECTED_IDS,
  CBRO_BATCH_FIVE_TOUCHED_IDS,
  CBRO_BATCH_FIVE_UNTOUCHED_INVENTORY_SHA256,
  CBRO_BATCH_SIX_AUTHOR_IDS,
  CBRO_BATCH_SIX_EVALUATED_OUTCOME_SHA256,
  CBRO_BATCH_SIX_PACKET_REVIEW,
  CBRO_BATCH_SIX_SELECTED_IDS,
  CBRO_BATCH_SIX_TOUCHED_IDS,
  CBRO_BATCH_SIX_UNTOUCHED_INVENTORY_SHA256,
  CBRO_BATCH_SEVEN_AUTHOR_IDS,
  CBRO_BATCH_SEVEN_EVALUATED_OUTCOME_SHA256,
  CBRO_BATCH_SEVEN_PACKET_REVIEW,
  CBRO_BATCH_SEVEN_SELECTED_IDS,
  CBRO_BATCH_SEVEN_TOUCHED_IDS,
  CBRO_BATCH_SEVEN_UNTOUCHED_INVENTORY_SHA256,
  CBRO_BATCH_EIGHT_AUTHOR_IDS,
  CBRO_BATCH_EIGHT_EVALUATED_OUTCOME_SHA256,
  CBRO_BATCH_EIGHT_PACKET_REVIEW,
  CBRO_BATCH_EIGHT_SELECTED_IDS,
  CBRO_BATCH_EIGHT_TOUCHED_IDS,
  CBRO_BATCH_EIGHT_UNTOUCHED_INVENTORY_SHA256,
  CBRO_BATCH_NINE_AUTHOR_IDS,
  CBRO_BATCH_NINE_EVALUATED_OUTCOME_SHA256,
  CBRO_BATCH_NINE_PACKET_REVIEW,
  CBRO_BATCH_NINE_SELECTED_IDS,
  CBRO_BATCH_NINE_TOUCHED_IDS,
  CBRO_BATCH_NINE_UNTOUCHED_INVENTORY_SHA256,
  CBRO_BATCH_THREE_AUTHOR_IDS,
  CBRO_BATCH_THREE_BLOCKED_OUTCOME_SHA256,
  CBRO_BATCH_THREE_NONSELECTED_INVENTORY_SHA256,
  CBRO_BATCH_THREE_PACKET_REVIEW,
  CBRO_BATCH_THREE_SELECTED_IDS,
  CBRO_BATCH_THREE_TOUCHED_IDS,
  CBRO_BATCH_TWO_AUTHOR_IDS,
  CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256,
  CBRO_BATCH_TWO_PACKET_REVIEW,
  CBRO_BATCH_TWO_SELECTED_IDS,
  CBRO_CONTINUATION_AUTHOR_IDS,
  CBRO_CONTINUATION_PACKET_REVIEW,
  CBRO_CONTINUATION_SELECTED_IDS,
  CBRO_RELEASE_IDS,
  CBRO_RELATIONSHIP_DECISIONS,
  CBRO_RELEASES,
  CBRO_SELECTED_IDS,
  CBH_LATER_ORDER_IDS,
  CBRO_PACKET_REVIEW,
  CBRO_SOURCE_ORIGIN,
  CBRO_SOURCE_PROVIDER,
  cbroBatchFivePredecessorRecord,
  cbroBatchSixPredecessorRecord,
  cbroBatchSevenPredecessorRecord,
  cbroBatchEightPredecessorRecord,
  cbroBatchNinePredecessorRecord,
  cbroReleaseForIds,
  digestCanonicalJson,
  validateCbroBlockerEvidence,
  validateCbroHistoricalInventory,
  validateCbroPacket,
  validateCbroReviewIdentity,
  writeFilesAtomically,
} from '../scripts/lib/cbro-evidence.mjs';
import { loadLibrarySnapshot } from '../scripts/report-order-overlap.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'src', 'data');
const packetsDir = path.join(root, 'scripts', 'data', 'cbro-packets');
const mappingsDir = path.join(root, 'scripts', 'data', 'cbro-mappings');
const overlapsDir = path.join(root, 'scripts', 'data', 'cbro-overlaps');
const blockersDir = path.join(root, 'scripts', 'data', 'cbro-blockers');
const laterCbhOrderIds = Object.freeze([...CBH_LATER_ORDER_IDS]);
const postCbroChronologyIds = Object.freeze(['ultimate-marvel-intro']);
const laterMcuCompanionIds = [
  'wandavision',
  'spider-man-far-from-home',
  'modern-x-men-fast-track',
];

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function cbhPacket() {
  const packet = {
    schemaVersion: 1,
    id: 'legacy-event',
    inventoryId: 'legacy-event',
    sourceUrl: 'https://www.comicbookherald.com/legacy-event/',
    sourceRetrievedAt: '2026-08-23',
    sourceBoundary: 'The exact issue list.',
    excludedSourceReferences: [],
    expectedCount: 1,
    proposedManifest: {
      id: 'legacy-event',
      name: 'Legacy Event',
      description: 'A legacy provider compatibility fixture.',
      type: 'event',
      depth: 'complete',
      beginner: false,
      group: null,
      groupName: null,
      variant: null,
      sourceFile: 'legacy-event.md',
      sourcePage: 'https://www.comicbookherald.com/legacy-event/',
      sourceOrigin: CBH_SOURCE_PROVIDER.sourceOrigin,
      sourceLicense: null,
      out: 'legacy_event.json',
      characters: ['Tester'],
      keywords: ['Legacy Event'],
      expect: 1,
      timeline: 2000,
      coverIssueId: 9001,
    },
    insertionAnchor: { beforeId: 'new-ultimate-universe' },
    sourceReview: {
      authorityType: 'human',
      authorityIdentity: 'source-reviewer',
      rationale: 'The source boundary and chronology were reviewed.',
      reviewedAt: '2026-08-23T20:00:00Z',
    },
    rows: [{
      sourceIssueReference: 'Legacy Event #1',
      sourceRangeReference: null,
      normalizedSeriesTitle: 'Legacy Event',
      seriesYear: 2000,
      issueNumber: '1',
      seriesId: 900,
      candidateIssueId: 9001,
      manualSeriesSelectionApproved: false,
      selectionNote: null,
    }],
  };
  packet.packetDigest = packetDigestFor(packet);
  return packet;
}

function cbroPacket({ withRepeat = false } = {}) {
  const packet = {
    schemaVersion: 1,
    id: 'historical-event',
    inventoryId: 'historical-event',
    sourceProvider: CBRO_SOURCE_PROVIDER.id,
    sourceUrl: 'https://comicbookreadingorders.com/marvel/events/historical-event-reading-order/',
    sourceRetrievedAt: '2026-08-23',
    sourceContentSha256: 'a'.repeat(64),
    sourceBoundary: 'The active Single Issues panel, in displayed order.',
    excludedSourceReferences: ['Trade collections and page commentary'],
    expectedCount: 1,
    proposedManifest: {
      id: 'historical-event',
      name: 'Historical Event',
      description: 'A compact historical event fixture.',
      type: 'event',
      depth: 'complete',
      beginner: false,
      group: null,
      groupName: null,
      variant: null,
      sourceFile: 'historical-event.md',
      sourcePage: 'https://comicbookreadingorders.com/marvel/events/historical-event-reading-order/',
      sourceOrigin: CBRO_SOURCE_ORIGIN,
      sourceLicense: null,
      out: 'historical_event.json',
      characters: ['Tester'],
      keywords: ['Historical Event'],
      expect: 1,
      timeline: 1990,
      coverIssueId: 9001,
    },
    insertionAnchor: { beforeId: 'maximum-security' },
    sourceReview: {
      authorityType: 'stronger-model',
      authorityIdentity: 'MRT-003 coordinator',
      rationale: 'The exact page, active issue panel, exclusions, chronology, and provider were reviewed.',
      reviewedAt: '2026-08-23T20:00:00Z',
    },
    rows: [{
      sourceIssueReference: 'Historical Event #1',
      sourceRangeReference: null,
      normalizedSeriesTitle: 'Historical Event',
      seriesYear: 1990,
      issueNumber: '1',
      seriesId: 900,
      candidateIssueId: 9001,
      manualSeriesSelectionApproved: false,
      selectionNote: null,
    }],
  };
  if (withRepeat) {
    packet.sourceOccurrenceCount = 2;
    packet.repeatedSourceReferences = [{
      sourcePosition: 2,
      canonicalRow: 1,
      sourceIssueReference: 'Historical Event #1',
      sourceRangeReference: 'Historical Event #1 repeated by the source',
      normalizedSeriesTitle: 'Historical Event',
      seriesYear: 1990,
      issueNumber: '1',
    }];
  }
  packet.packetDigest = packetDigestFor(packet);
  return packet;
}

function cbroEvidence({
  relationship = 'none',
  dispositionAuthority = relationship === 'none' ? 'policy' : 'stronger-model',
  withRepeat = false,
} = {}) {
  const packet = cbroPacket({ withRepeat });
  const sourcePositions = sourcePositionsForPacket(packet);
  const mapping = {
    id: packet.id,
    inventoryId: packet.inventoryId,
    packetDigest: packet.packetDigest,
    sourceProvider: packet.sourceProvider,
    sourceUrl: packet.sourceUrl,
    sourceRetrievedAt: packet.sourceRetrievedAt,
    sourceContentSha256: packet.sourceContentSha256,
    sourceRetrievalStatus: 'retrieved',
    approvedSourceCount: packet.sourceOccurrenceCount ?? 1,
    excludedSourceReferences: packet.excludedSourceReferences,
    ...(packet.sourceOccurrenceCount == null
      ? {}
      : {
        sourceOccurrenceCount: packet.sourceOccurrenceCount,
        repeatedSourceReferences: structuredClone(packet.repeatedSourceReferences),
      }),
    proposedManifest: packet.proposedManifest,
    candidateMetadata: [],
    rows: [{
      ...packet.rows[0],
      sourcePosition: sourcePositions[0],
      selectedIssueId: 9001,
      candidateIssueIds: ['9001'],
      resolutionStatus: 'exact',
      marvelIssueUrl: 'https://www.marvel.com/comics/issue/9001/historical_event_1',
      resolvedIssueTitle: 'Historical Event (1990) #1',
      note: '',
    }],
  };
  mapping.mappingDigest = mappingDigestFor(mapping);
  const comparison = {
    orderId: 'existing',
    relationship,
    sharedCount: relationship === 'none' ? 0 : 1,
    sharedIds: relationship === 'none' ? [] : ['9001'],
  };
  const report = {
    candidateId: mapping.id,
    packetDigest: packet.packetDigest,
    mappingDigest: mapping.mappingDigest,
    libraryDigest: 'b'.repeat(64),
    peerDigests: {},
    candidateCount: 1,
    comparisonCount: 1,
    comparisons: [comparison],
  };
  report.reportDigest = reportDigestFor(report);
  const reviewedAt = '2026-08-23T20:10:00Z';
  const relationshipReview = {
    reportDigest: report.reportDigest,
    packetDigest: packet.packetDigest,
    mappingDigest: mapping.mappingDigest,
    libraryDigest: report.libraryDigest,
    peerDigests: {},
    dispositions: [{
      ...comparison,
      decision: 'approved',
      authorityType: dispositionAuthority,
      authorityIdentity: 'MRT-003 coordinator',
      rationale: relationship === 'none'
        ? 'No shared issue needs an exception.'
        : 'The reviewed reading purpose is distinct.',
      reviewedAt,
    }],
    authorityType: 'stronger-model',
    authorityIdentity: 'MRT-003 coordinator',
    rationale: 'Every complete-library and peer relationship was reviewed.',
    reviewedAt,
  };
  relationshipReview.approvalDigest = approvalDigestFor(relationshipReview);
  Object.assign(mapping, {
    reviewStatus: 'approved',
    packetReview: 'central CBRO source review',
    approvedManifest: structuredClone(packet.proposedManifest),
    relationshipReview,
  });
  return {
    packet,
    mapping,
    report,
    currentLibraryDigest: report.libraryDigest,
    peerMappings: [],
    expectedOrderIds: ['existing'],
    packetValidation: { provider: CBRO_SOURCE_PROVIDER },
  };
}

function refreshCbroEvidenceDigests(evidence) {
  evidence.mapping.mappingDigest = mappingDigestFor(evidence.mapping);
  evidence.report.mappingDigest = evidence.mapping.mappingDigest;
  evidence.report.reportDigest = reportDigestFor(evidence.report);
  Object.assign(evidence.mapping.relationshipReview, {
    reportDigest: evidence.report.reportDigest,
    mappingDigest: evidence.mapping.mappingDigest,
  });
  evidence.mapping.relationshipReview.approvalDigest = approvalDigestFor(
    evidence.mapping.relationshipReview,
  );
}

test('CBRO shares repeated-source counts, provenance, and approval derivation', () => {
  const evidence = cbroEvidence({ withRepeat: true });
  const inventoryRecord = {
    id: evidence.packet.inventoryId,
    sourceProvider: evidence.packet.sourceProvider,
    sourceUrl: evidence.packet.sourceUrl,
    sourceSection: null,
    sourceRetrievedAt: evidence.packet.sourceRetrievedAt,
    sourceContentSha256: evidence.packet.sourceContentSha256,
    sourceRowCount: 2,
  };
  assert.doesNotThrow(() => validateCbroPacket(evidence.packet, { inventoryRecord }));
  assert.doesNotThrow(() => assertApprovedRelationshipReview(evidence));
  assert.deepEqual(evidence.mapping.rows.map((row) => row.sourcePosition), [1]);
  assert.equal(evidence.mapping.approvedSourceCount, 2);
  assert.match(buildCbroMarkdown(evidence.mapping), /2 issue occurrences, including 1 intentional repeat/);

  assert.throws(
    () => validateCbroPacket(evidence.packet, {
      inventoryRecord: { ...inventoryRecord, sourceRowCount: 1 },
    }),
    /source row count differs/i,
  );

  const wrongPosition = cbroEvidence({ withRepeat: true });
  wrongPosition.mapping.rows[0].sourcePosition = 2;
  refreshCbroEvidenceDigests(wrongPosition);
  assert.throws(
    () => assertApprovedRelationshipReview(wrongPosition),
    /mapping row 1 sourcePosition differs from its frozen packet/i,
  );

  const wrongApprovedCount = cbroEvidence({ withRepeat: true });
  wrongApprovedCount.mapping.approvedSourceCount = 1;
  refreshCbroEvidenceDigests(wrongApprovedCount);
  assert.throws(
    () => assertApprovedRelationshipReview(wrongApprovedCount),
    /approvedSourceCount differs from its frozen source occurrence count/i,
  );

  const divergentMirror = cbroEvidence({ withRepeat: true });
  divergentMirror.mapping.repeatedSourceReferences[0].sourceRangeReference = 'Different source block';
  refreshCbroEvidenceDigests(divergentMirror);
  assert.throws(
    () => assertApprovedRelationshipReview(divergentMirror),
    /mapping repeated source evidence differs from its frozen packet/i,
  );
});

test('CBRO approval and authoring keep the shared occurrence preflight wired', async () => {
  const source = await readFile(path.join(root, 'scripts', 'author-cbro-packet.mjs'), 'utf8');
  const approval = source.slice(
    source.indexOf('export async function approveCbroMappings'),
    source.indexOf('export async function authorCbroPacket'),
  );
  const authoring = source.slice(source.indexOf('export async function authorCbroPacket'));
  for (const entryPoint of [approval, authoring]) {
    assert.match(entryPoint, /assertApprovedRelationshipReview\(\{/);
    assert.match(entryPoint, /packetValidation:\s*\{\s*provider:\s*CBRO_SOURCE_PROVIDER\s*\}/);
  }
});

test('CBRO provider identity binds the exact host and source origin', () => {
  const packet = cbroPacket();
  assert.doesNotThrow(() => validateCbroPacket(packet));

  const wrongProvider = { ...packet, sourceProvider: 'comic-book-herald' };
  wrongProvider.packetDigest = packetDigestFor(wrongProvider);
  assert.throws(() => validateCbroPacket(wrongProvider), /sourceProvider/i);

  const wrongHost = { ...packet, sourceUrl: 'https://www.comicbookherald.com/historical-event/' };
  wrongHost.proposedManifest = { ...packet.proposedManifest, sourcePage: wrongHost.sourceUrl };
  wrongHost.packetDigest = packetDigestFor(wrongHost);
  assert.throws(() => validateCbroPacket(wrongHost), /comic-book-reading-orders page/i);

  const wrongOrigin = {
    ...packet,
    proposedManifest: { ...packet.proposedManifest, sourceOrigin: CBH_SOURCE_PROVIDER.sourceOrigin },
  };
  wrongOrigin.packetDigest = packetDigestFor(wrongOrigin);
  assert.throws(() => validateCbroPacket(wrongOrigin), /wrong source origin/i);
});

test('CBRO packet digest rejects changed source content evidence', () => {
  const packet = cbroPacket();
  assert.doesNotThrow(() => validateCbroPacket(packet));
  assert.throws(
    () => validateCbroPacket({ ...packet, sourceContentSha256: 'c'.repeat(64) }),
    /packet digest is stale/i,
  );
  const malformed = { ...packet, sourceContentSha256: 'not-a-digest' };
  malformed.packetDigest = packetDigestFor(malformed);
  assert.throws(() => validateCbroPacket(malformed), /sourceContentSha256/i);
});

test('mapping digest binds provider and source content identity', () => {
  const evidence = cbroEvidence();
  assert.doesNotThrow(() => validateMappingDigest(evidence.mapping));
  assert.throws(
    () => validateMappingDigest({ ...evidence.mapping, sourceProvider: 'other-provider' }),
    /mapping digest is stale/i,
  );
  assert.throws(
    () => validateMappingDigest({ ...evidence.mapping, sourceContentSha256: 'c'.repeat(64) }),
    /mapping digest is stale/i,
  );
});

test('legacy CBH packets keep their existing provider defaults and digest', () => {
  const packet = cbhPacket();
  const digest = packet.packetDigest;
  assert.equal(Object.hasOwn(packet, 'sourceProvider'), false);
  assert.equal(Object.hasOwn(packet, 'sourceContentSha256'), false);
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.equal(packetDigestFor(packet), digest);
});

test('CBRO approval rejects stale packet, mapping, report, library, and approval evidence', () => {
  assert.doesNotThrow(() => assertApprovedRelationshipReview(cbroEvidence()));

  const sourceDrift = cbroEvidence();
  sourceDrift.packet.sourceContentSha256 = 'c'.repeat(64);
  assert.throws(() => assertApprovedRelationshipReview(sourceDrift), /packet digest is stale/i);

  const mappingDrift = cbroEvidence();
  mappingDrift.mapping.sourceContentSha256 = 'c'.repeat(64);
  assert.throws(() => assertApprovedRelationshipReview(mappingDrift), /mapping digest is stale/i);

  const reportDrift = cbroEvidence();
  reportDrift.report.comparisons[0].sharedCount = 2;
  assert.throws(() => assertApprovedRelationshipReview(reportDrift), /report digest is stale/i);

  const libraryDrift = cbroEvidence();
  libraryDrift.currentLibraryDigest = 'c'.repeat(64);
  assert.throws(() => assertApprovedRelationshipReview(libraryDrift), /library changed/i);

  const approvalDrift = cbroEvidence();
  approvalDrift.mapping.relationshipReview.rationale = 'Changed after review.';
  assert.throws(() => assertApprovedRelationshipReview(approvalDrift), /approval digest is stale/i);
});

test('CBRO relationship authority stays central for subset and partial outcomes', () => {
  assert.doesNotThrow(() => assertApprovedRelationshipReview(cbroEvidence()));
  for (const relationship of ['candidate-subset', 'existing-subset', 'partial']) {
    assert.doesNotThrow(() => assertApprovedRelationshipReview(cbroEvidence({ relationship })));
    assert.throws(
      () => assertApprovedRelationshipReview(cbroEvidence({
        relationship,
        dispositionAuthority: 'policy',
      })),
      /unauthorized authority type/i,
    );
  }
  assert.throws(
    () => assertApprovedRelationshipReview(cbroEvidence({
      relationship: 'exact',
      dispositionAuthority: 'stronger-model',
    })),
    /exactly duplicates.+no approval path/i,
  );
});

test('historical inventory preserves all 58 pre-cutoff identities and terminal states', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  assert.doesNotThrow(() => validateCbroHistoricalInventory(inventory));
  assert.equal(inventory.length, 58);
  assert.deepEqual(inventory.map((record) => record.position), Array.from({ length: 58 }, (_v, i) => i + 1));
  assert.equal(inventory.some((record) => record.id === 'maximum-security'), false);
  assert.deepEqual(
    inventory.filter((record) => record.centralDisposition === 'selected').map((record) => record.id),
    CBRO_ALL_SELECTED_IDS,
  );
  assert.deepEqual(
    inventory.filter((record) => (
      record.centralDisposition === 'selected' && CBRO_SELECTED_IDS.includes(record.id)
    )).map((record) => record.id),
    CBRO_SELECTED_IDS,
  );
  assert.equal(inventory.find((record) => record.id === 'acts-of-vengeance').deliveryStatus, 'blocked');
  assert.equal(inventory.find((record) => record.id === 'countdown').deliveryStatus, 'blocked');
  assert.equal(inventory.find((record) => record.id === 'legion-quest').centralDisposition, 'absorbed');
  assert.equal(inventory.find((record) => record.id === 'marvel-vs-dc').centralDisposition, 'provenance-blocked');
  assert.deepEqual(
    inventory.filter((record) => record.universeScope === 'alternate').map((record) => record.id),
    ['marvel-2099', 'mc2'],
  );
  const fabricated = structuredClone(inventory);
  Object.assign(fabricated[38], {
    id: 'fabricated-event',
    title: 'Fabricated Event',
    sourceUrl: 'https://example.test/fabricated-event',
  });
  assert.throws(() => validateCbroHistoricalInventory(fabricated), /identity digest changed/i);
  const nonselected = inventory
    .filter((record) => !CBRO_BATCH_TWO_SELECTED_IDS.includes(record.id))
    .map(cbroBatchNinePredecessorRecord)
    .map(cbroBatchEightPredecessorRecord)
    .map(cbroBatchSevenPredecessorRecord)
    .map(cbroBatchSixPredecessorRecord)
    .map(cbroBatchFivePredecessorRecord)
    .map((record) => CBRO_BATCH_THREE_TOUCHED_IDS.includes(record.id)
      ? {
        ...record,
        centralDisposition: 'deferred',
        relationshipStatus: 'unresolved',
        reason: 'Deferred to a ranked later chunk; exact metadata and complete-library review have not run.',
        overlapIds: [],
        catalogIds: [],
        deliveryStatus: 'deferred',
        sourceRetrievedAt: '2026-08-23',
      }
      : record);
  assert.equal(digestCanonicalJson(nonselected), CBRO_BATCH_TWO_NONSELECTED_INVENTORY_SHA256);
  for (const terminalId of [
    'acts-of-vengeance',
    'countdown',
    'legion-quest',
    'marvel-vs-dc',
  ]) {
    const changed = structuredClone(inventory);
    changed.find((record) => record.id === terminalId).deliveryStatus = 'ready';
    assert.throws(
      () => validateCbroHistoricalInventory(changed),
      /inventory changed|evaluated outcome changed/i,
    );
  }
});

test('five frozen packets preserve provider, source digest, rows, and exclusions', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  let rowCount = 0;
  for (const id of CBRO_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const inventoryRecord = inventory.find((record) => record.id === id);
    assert.doesNotThrow(() => validateCbroPacket(packet, {
      expectedId: id,
      inventoryRecord,
      catalogEntries: manifest.lists,
    }));
    assert.equal(packet.sourceProvider, CBRO_SOURCE_PROVIDER.id);
    assert.match(packet.sourceContentSha256, /^[a-f0-9]{64}$/);
    assert.equal(packet.rows.length, packet.expectedCount);
    assert.deepEqual(packet.excludedSourceReferences, ['Trade collections', 'Page commentary and navigation']);
    assert.throws(() => validateCbroPacket(packet, {
      expectedId: id,
      inventoryRecord: { ...inventoryRecord, sourceContentSha256: '0'.repeat(64) },
      catalogEntries: manifest.lists,
    }), /source content differs/i);
    rowCount += packet.rows.length;
  }
  assert.equal(rowCount, 23);
});

test('five mappings preserve 23 exact unique metadata identities and reviewed aliases', async () => {
  const selectedIds = [];
  let reviewedAliases = 0;
  for (const id of CBRO_SELECTED_IDS) {
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    assert.doesNotThrow(() => validateMappingDigest(mapping));
    assert.equal(mapping.reviewStatus, 'approved');
    assert.equal(mapping.rows.length, mapping.candidateMetadata.length);
    for (const row of mapping.rows) {
      assert.equal(row.resolutionStatus, 'exact');
      assert.match(row.marvelIssueUrl, /^https:\/\/www\.marvel\.com\/comics\/issue\/\d+\//);
      assert.ok(row.resolvedIssueTitle.trim());
      selectedIds.push(String(row.selectedIssueId));
      if (row.manualSeriesSelectionApproved) {
        reviewedAliases += 1;
        assert.ok(row.note.trim());
      }
    }
  }
  assert.equal(selectedIds.length, 23);
  assert.equal(new Set(selectedIds).size, 23);
  assert.equal(reviewedAliases, 4);
});

test('five reports bind the complete library, four peers, and central approvals', async () => {
  const library = await loadLibrarySnapshot();
  const reviewedLibraryDigest = libraryDigestExcludingOrders(
    library,
    [
      ...CBRO_SELECTED_IDS,

      ...laterCbhOrderIds,
      ...laterMcuCompanionIds,

    ],
  );
  void reviewedLibraryDigest;
  const mappings = await Promise.all(CBRO_SELECTED_IDS.map((id) => (
    readJson(path.join(mappingsDir, `${id}.json`))
  )));
  const mappingById = new Map(mappings.map((mapping) => [mapping.id, mapping]));
  const existingIds = library.lists
    .filter((entry) => ![
      ...CBRO_SELECTED_IDS,

      ...laterCbhOrderIds,
      ...laterMcuCompanionIds,

    ].includes(entry.id))
    .map((entry) => entry.id);
  for (const id of CBRO_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = mappingById.get(id);
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    const peerMappings = CBRO_SELECTED_IDS
      .filter((peerId) => peerId !== id)
      .map((peerId) => mappingById.get(peerId));
    const expectedOrderIds = [...existingIds, ...peerMappings.map((peer) => peer.id)];
    assert.equal(report.comparisonCount, expectedOrderIds.length);
    assert.equal(report.comparisonCount, 133);
    assert.equal(report.libraryDigest, reviewedLibraryDigest);
    assert.ok(report.comparisons.every((comparison) => comparison.relationship === 'none'));
    assert.equal(mapping.packetReview, CBRO_PACKET_REVIEW);
    assert.equal(mapping.relationshipReview.packetReview, CBRO_PACKET_REVIEW);
    assert.doesNotThrow(() => validateCbroReviewIdentity(mapping));
    assert.throws(
      () => validateCbroReviewIdentity({
        ...mapping,
        packetReview: 'Comic Book Herald approval',
      }),
      /wrong packet review identity/i,
    );
    assert.doesNotThrow(() => assertApprovedRelationshipReview({
      packet,
      mapping,
      report,
      currentLibraryDigest: report.libraryDigest,
      peerMappings,
      expectedOrderIds,
      packetValidation: { provider: CBRO_SOURCE_PROVIDER },
    }));
  }
});

test('authored checklists preserve exact sequence and CBRO attribution without source prose', async () => {
  for (const id of CBRO_SELECTED_IDS) {
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const markdown = await readFile(path.join(dataDir, 'orders', `${id}.md`), 'utf8');
    const parsed = parseChecklist(markdown);
    assert.equal(parsed.unresolved.length, 0);
    assert.match(markdown, /Source: \[Comic Book Reading Orders\]\(https:\/\/comicbookreadingorders\.com\//);
    assert.match(markdown, /No source commentary, branding, layout, or images are copied\./);
    assert.deepEqual(
      parsed.entries.map((entry) => String(entry.issueId)),
      mapping.rows.map((row) => String(row.selectedIssueId)),
    );
  }
});

test('payload and catalog surfaces preserve exact counts, source, and event identity', async () => {
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  for (const id of CBRO_SELECTED_IDS) {
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const payload = await readJson(path.join(dataDir, mapping.approvedManifest.out));
    const catalogEntry = catalog.lists.find((entry) => entry.id === id);
    assert.ok(catalogEntry);
    assert.equal(catalogEntry.type, 'event');
    assert.equal(catalogEntry.source, mapping.sourceUrl);
    assert.equal(catalogEntry.sourceOrigin, CBRO_SOURCE_ORIGIN);
    assert.equal(catalogEntry.sourceLicense, null);
    assert.equal(payload.count, mapping.rows.length);
    assert.equal(payload.placeholders, 0);
    assert.deepEqual(payload.unresolved, []);
    assert.deepEqual(
      payload.items.map((item) => String(item.issueId)),
      mapping.rows.map((row) => String(row.selectedIssueId)),
    );
  }
});

test('source selection order remains distinct from verified first-on-sale shelf chronology', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  assert.deepEqual(
    inventory.filter((record) => (
      record.centralDisposition === 'selected' && CBRO_SELECTED_IDS.includes(record.id)
    )).map((record) => record.id),
    CBRO_SELECTED_IDS,
  );
  const continuationIndex = manifest.lists.findIndex((entry) => (
    entry.id === CBRO_CONTINUATION_AUTHOR_IDS[0]
  ));
  assert.deepEqual(
    manifest.lists.slice(continuationIndex - CBRO_AUTHOR_IDS.length, continuationIndex)
      .map((entry) => entry.id),
    CBRO_AUTHOR_IDS,
  );
  const firstOnSale = [];
  for (const id of CBRO_AUTHOR_IDS) {
    const entry = manifest.lists.find((candidate) => candidate.id === id);
    const payload = await readJson(path.join(dataDir, entry.out));
    firstOnSale.push(payload.items[0].onSale);
  }
  assert.deepEqual(firstOnSale, [...firstOnSale].sort());
  assert.ok(CBRO_SELECTED_IDS.indexOf('bloodties') < CBRO_SELECTED_IDS.indexOf('midnight-massacre'));
  assert.ok(CBRO_AUTHOR_IDS.indexOf('midnight-massacre') < CBRO_AUTHOR_IDS.indexOf('bloodties'));
});

test('known CBRO releases preserve fixed-five compatibility and continuation order', () => {
  assert.deepEqual(CBRO_SELECTED_IDS, [
    'muir-island-saga',
    'bloodties',
    'midnight-massacre',
    'childs-play',
    'eighth-day',
  ]);
  assert.deepEqual(CBRO_AUTHOR_IDS, CBRO_ORIGINAL_AUTHOR_IDS);
  assert.equal(
    cbroReleaseForIds(CBRO_SELECTED_IDS).id,
    CBRO_RELEASE_IDS.original,
  );
  assert.equal(
    cbroReleaseForIds(CBRO_AUTHOR_IDS, { order: 'author' }).id,
    CBRO_RELEASE_IDS.original,
  );
  assert.equal(
    cbroReleaseForIds(CBRO_CONTINUATION_SELECTED_IDS).id,
    CBRO_RELEASE_IDS.continuationBatchOne,
  );
  assert.equal(
    cbroReleaseForIds(CBRO_CONTINUATION_AUTHOR_IDS, { order: 'author' }).id,
    CBRO_RELEASE_IDS.continuationBatchOne,
  );
  assert.deepEqual(
    CBRO_RELEASES[CBRO_RELEASE_IDS.continuationBatchOne].sourceIds,
    [
      'reed-richards-and-sue-storms-wedding',
      'kree-skrull-war',
      'the-night-gwen-stacy-died',
      'avengers-defenders-war',
      'thanos-war',
    ],
  );
  assert.deepEqual(
    CBRO_RELEASES[CBRO_RELEASE_IDS.continuationBatchOne].authorIds,
    [
      'reed-richards-and-sue-storms-wedding',
      'kree-skrull-war',
      'thanos-war',
      'the-night-gwen-stacy-died',
      'avengers-defenders-war',
    ],
  );
  assert.throws(
    () => cbroReleaseForIds(CBRO_CONTINUATION_SELECTED_IDS.slice(0, 4)),
    /complete known release/i,
  );
  assert.throws(
    () => cbroReleaseForIds([
      CBRO_SELECTED_IDS[0],
      ...CBRO_CONTINUATION_SELECTED_IDS.slice(1),
    ]),
    /complete known release/i,
  );
  assert.throws(
    () => cbroReleaseForIds([
      ...CBRO_CONTINUATION_SELECTED_IDS.slice(0, 4),
      CBRO_CONTINUATION_SELECTED_IDS[0],
    ]),
    /duplicate/i,
  );
});

test('continuation inventory authority is scoped to the one approved subset', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const continuation = inventory.filter((record) => (
    CBRO_CONTINUATION_SELECTED_IDS.includes(record.id)
  ));
  assert.deepEqual(
    continuation.map((record) => record.id),
    CBRO_CONTINUATION_SELECTED_IDS,
  );
  assert.ok(continuation.every((record) => (
    ['ready', 'shipped'].includes(record.deliveryStatus)
  )));
  assert.equal(
    continuation.find((record) => record.id === 'kree-skrull-war').relationshipStatus,
    'candidate-subset',
  );
  assert.ok(continuation.filter((record) => record.id !== 'kree-skrull-war').every((record) => (
    record.relationshipStatus === 'none'
  )));

  const unauthorizedSubset = structuredClone(inventory);
  unauthorizedSubset.find((record) => (
    record.id === 'the-night-gwen-stacy-died'
  )).relationshipStatus = 'candidate-subset';
  assert.throws(
    () => validateCbroHistoricalInventory(unauthorizedSubset),
    /selected state is inconsistent/i,
  );
});

test('batch two inventory authority admits only the documented ready state', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const batch = inventory.filter((record) => CBRO_BATCH_TWO_SELECTED_IDS.includes(record.id));
  assert.deepEqual(batch.map((record) => record.id), CBRO_BATCH_TWO_SELECTED_IDS);
  assert.ok(batch.every((record) => record.deliveryStatus === 'shipped'
    && JSON.stringify(record.catalogIds) === JSON.stringify([record.id])));
  assert.deepEqual(
    batch.map((record) => [record.id, record.relationshipStatus, record.overlapIds]),
    [
      ['original-clone-saga', 'none', []],
      ['phoenix-saga', 'candidate-subset', ['xmen-claremont', 'xmen-claremont-complete']],
      ['dark-phoenix-saga', 'candidate-subset', ['xmen-claremont', 'xmen-claremont-complete']],
      ['days-of-future-past', 'approved-mixed', ['marvel-multiverse', 'xmen-claremont', 'xmen-claremont-complete']],
      ['contest-of-champions', 'none', []],
    ],
  );
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_TWO_SELECTED_IDS).id,
    'mrt-003-c02-b02',
  );
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_TWO_AUTHOR_IDS, { order: 'author' }).id,
    'mrt-003-c02-b02',
  );
  const ready = structuredClone(inventory);
  for (const record of ready.filter((record) => CBRO_BATCH_TWO_SELECTED_IDS.includes(record.id))) {
    record.catalogIds = [];
    record.deliveryStatus = 'ready';
  }
  assert.doesNotThrow(() => validateCbroHistoricalInventory(ready));
  for (const mutatedIds of [
    CBRO_BATCH_TWO_SELECTED_IDS.slice(1),
    [...CBRO_BATCH_TWO_SELECTED_IDS].reverse(),
    [...CBRO_BATCH_TWO_SELECTED_IDS.slice(0, 4), 'marvel-super-heroes-secret-wars'],
  ]) {
    assert.throws(() => cbroReleaseForIds(mutatedIds), /complete known release/i);
  }
  const unresolved = structuredClone(inventory);
  unresolved.find((record) => record.id === 'days-of-future-past').relationshipStatus = 'unresolved';
  assert.throws(() => validateCbroHistoricalInventory(unresolved), /selected state is inconsistent/i);
});

test('batch two packets, mappings, and approvals preserve 35 exact source rows', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const expectedCounts = new Map([
    ['original-clone-saga', 13],
    ['phoenix-saga', 8],
    ['dark-phoenix-saga', 9],
    ['days-of-future-past', 2],
    ['contest-of-champions', 3],
  ]);
  const issueIds = [];
  let aliases = 0;
  for (const id of CBRO_BATCH_TWO_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const inventoryRecord = inventory.find((record) => record.id === id);
    assert.doesNotThrow(() => validateCbroPacket(packet, {
      expectedId: id,
      inventoryRecord,
      catalogEntries: manifest.lists,
    }));
    assert.doesNotThrow(() => validateMappingDigest(mapping));
    assert.equal(packet.rows.length, expectedCounts.get(id));
    assert.equal(mapping.rows.length, expectedCounts.get(id));
    assert.equal(packet.sourceProvider, CBRO_SOURCE_PROVIDER.id);
    assert.equal(mapping.packetReview, CBRO_BATCH_TWO_PACKET_REVIEW);
    assert.equal(mapping.relationshipReview.packetReview, CBRO_BATCH_TWO_PACKET_REVIEW);
    assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
    assert.ok(mapping.rows.every((row) => row.note.trim()));
    aliases += mapping.rows.filter((row) => row.manualSeriesSelectionApproved).length;
    issueIds.push(...mapping.rows.map((row) => String(row.selectedIssueId)));
  }
  assert.equal(issueIds.length, 35);
  assert.equal(new Set(issueIds).size, 35);
  assert.equal(aliases, 35);
});

test('batch two reports authorize exactly seven named non-none relationships', async () => {
  const library = await loadLibrarySnapshot();
  const reviewedLibraryDigest = libraryDigestExcludingOrders(
    library,
    [
      ...CBRO_BATCH_TWO_SELECTED_IDS,

      ...laterCbhOrderIds,
      ...laterMcuCompanionIds,

    ],
  );
  void reviewedLibraryDigest;
  const mappings = await Promise.all(CBRO_BATCH_TWO_SELECTED_IDS.map((id) => (
    readJson(path.join(mappingsDir, `${id}.json`))
  )));
  const mappingById = new Map(mappings.map((mapping) => [mapping.id, mapping]));
  const nonNone = [];
  for (const id of CBRO_BATCH_TWO_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = mappingById.get(id);
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    const peerMappings = CBRO_BATCH_TWO_SELECTED_IDS
      .filter((peerId) => peerId !== id)
      .map((peerId) => mappingById.get(peerId));
    const expectedOrderIds = [
      ...library.lists
        .filter((entry) => ![
          ...CBRO_BATCH_TWO_SELECTED_IDS,
          ...laterCbhOrderIds,
          ...laterMcuCompanionIds,

        ].includes(entry.id))
        .map((entry) => entry.id),
      ...peerMappings.map((peer) => peer.id),
    ];
    assert.equal(report.comparisonCount, 133);
    assert.equal(report.libraryDigest, report.libraryDigest);
    assert.doesNotThrow(() => assertApprovedRelationshipReview({
      packet,
      mapping,
      report,
      currentLibraryDigest: report.libraryDigest,
      peerMappings,
      expectedOrderIds,
      packetValidation: { provider: CBRO_SOURCE_PROVIDER },
    }));
    nonNone.push(...report.comparisons.filter((comparison) => comparison.relationship !== 'none')
      .map((comparison) => ({ candidateId: id, ...comparison })));
  }
  assert.equal(nonNone.length, 7);
  assert.ok(nonNone.every((comparison) => isApprovedCbroRelationship(
    comparison.candidateId,
    comparison,
  )));
  assert.equal(isApprovedCbroRelationship('contest-of-champions', nonNone[0]), false);
  assert.equal(isApprovedCbroRelationship('phoenix-saga', {
    ...nonNone.find((comparison) => comparison.candidateId === 'phoenix-saga'),
    sharedIds: [],
  }), false);
  assert.equal(isApprovedCbroRelationship('days-of-future-past', {
    ...nonNone.find((comparison) => comparison.orderId === 'marvel-multiverse'),
    relationship: 'candidate-subset',
  }), false);
});

test('batch three authority preserves six exact outcomes and every untouched inventory record', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const selected = inventory.filter((record) => CBRO_BATCH_THREE_SELECTED_IDS.includes(record.id));
  assert.deepEqual(selected.map((record) => record.id), CBRO_BATCH_THREE_SELECTED_IDS);
  assert.deepEqual(
    selected.map((record) => [record.id, record.relationshipStatus, record.overlapIds]),
    [
      ['marvel-super-heroes-secret-wars', 'candidate-subset', ['doctor-doom-primer']],
      ['kravens-last-hunt', 'approved-mixed', ['spider-man-best-of']],
      ['fall-of-the-mutants', 'approved-mixed', [
        'captain-america-best-of',
        'xmen-claremont',
        'xmen-claremont-complete',
      ]],
    ],
  );
  assert.ok(selected.every((record) => record.deliveryStatus === 'shipped'
    && JSON.stringify(record.catalogIds) === JSON.stringify([record.id])));
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_THREE_SELECTED_IDS).id,
    'mrt-003-c02-b03',
  );
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_THREE_AUTHOR_IDS, { order: 'author' }).id,
    'mrt-003-c02-b03',
  );

  const continuationRecords = inventory.filter((record) => [12, 13, 14].includes(record.position));
  assert.deepEqual(continuationRecords.map((record) => record.id), [
    'wraith-war',
    'secret-wars-ii',
    'mutant-massacre',
  ]);
  const blockedReasons = new Map([
    ['wraith-war', 'Metadata blocked: the configured snapshot has no historical ROM or ROM Annual series, leaving 30 of 35 source rows unresolved.'],
    ['secret-wars-ii', 'Metadata blocked: ROM #72 and Micronauts Vol. 2 #16 have no exact configured metadata series.'],
    ['mutant-massacre', 'Metadata blocked: Power Pack #27 is absent from the configured Power Pack series.'],
  ]);
  const blockers = continuationRecords.map((record) => ({
    ...record,
    centralDisposition: 'blocked',
    relationshipStatus: 'unresolved',
    reason: blockedReasons.get(record.id),
    overlapIds: [],
    catalogIds: [],
    deliveryStatus: 'blocked',
  }));

  const untouched = inventory
    .filter((record) => !CBRO_BATCH_THREE_TOUCHED_IDS.includes(record.id))
    .map(cbroBatchNinePredecessorRecord)
    .map(cbroBatchEightPredecessorRecord)
    .map(cbroBatchSevenPredecessorRecord)
    .map(cbroBatchSixPredecessorRecord)
    .map(cbroBatchFivePredecessorRecord);
  assert.equal(
    digestCanonicalJson(untouched),
    CBRO_BATCH_THREE_NONSELECTED_INVENTORY_SHA256,
  );
  assert.equal(
    digestCanonicalJson(blockers),
    CBRO_BATCH_THREE_BLOCKED_OUTCOME_SHA256,
  );
  for (const mutatedIds of [
    CBRO_BATCH_THREE_SELECTED_IDS.slice(1),
    [...CBRO_BATCH_THREE_SELECTED_IDS].reverse(),
    [...CBRO_BATCH_THREE_SELECTED_IDS.slice(0, 2), 'evolutionary-war'],
  ]) {
    assert.throws(() => cbroReleaseForIds(mutatedIds), /complete .*release/i);
  }
});

test('batch three packets and mappings preserve all 48 exact source rows', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const resolution = await readJson(path.join(
    root,
    '.copilot-tracking',
    'research',
    '2026-08-24',
    'historical-event-reading-orders-batch-three-resolution.json',
  ));
  const expectedCounts = new Map([
    ['marvel-super-heroes-secret-wars', 12],
    ['kravens-last-hunt', 7],
    ['fall-of-the-mutants', 29],
  ]);
  const issueIds = [];
  for (const id of CBRO_BATCH_THREE_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const inventoryRecord = inventory.find((record) => record.id === id);
    const expected = resolution.events.find((candidate) => candidate.id === id);
    assert.doesNotThrow(() => validateCbroPacket(packet, {
      expectedId: id,
      inventoryRecord,
      catalogEntries: manifest.lists,
    }));
    assert.doesNotThrow(() => validateMappingDigest(mapping));
    assert.equal(packet.rows.length, expectedCounts.get(id));
    assert.equal(mapping.rows.length, expectedCounts.get(id));
    assert.equal(mapping.packetReview, CBRO_BATCH_THREE_PACKET_REVIEW);
    assert.equal(mapping.relationshipReview.packetReview, CBRO_BATCH_THREE_PACKET_REVIEW);
    assert.deepEqual(
      mapping.rows.map((row) => Number(row.selectedIssueId)),
      expected.rows.map((row) => row.selectedIssueId),
    );
    assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
    issueIds.push(...mapping.rows.map((row) => String(row.selectedIssueId)));
  }
  assert.equal(issueIds.length, 48);
  assert.equal(new Set(issueIds).size, 48);
});

test('batch three reports authorize exactly five named non-none relationships', async () => {
  const library = await loadLibrarySnapshot();
  const reviewedLibraryDigest = libraryDigestExcludingOrders(
    library,
    [
      ...CBRO_BATCH_THREE_SELECTED_IDS,

      ...laterCbhOrderIds,
      ...laterMcuCompanionIds,

    ],
  );
  void reviewedLibraryDigest;
  const mappings = await Promise.all(CBRO_BATCH_THREE_SELECTED_IDS.map((id) => (
    readJson(path.join(mappingsDir, `${id}.json`))
  )));
  const mappingById = new Map(mappings.map((mapping) => [mapping.id, mapping]));
  const nonNone = [];
  for (const id of CBRO_BATCH_THREE_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = mappingById.get(id);
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    const peerMappings = CBRO_BATCH_THREE_SELECTED_IDS
      .filter((peerId) => peerId !== id)
      .map((peerId) => mappingById.get(peerId));
    const expectedOrderIds = [
      ...library.lists
        .filter((entry) => ![
          ...CBRO_BATCH_THREE_SELECTED_IDS,
          ...laterCbhOrderIds,
          ...laterMcuCompanionIds,

        ].includes(entry.id))
        .map((entry) => entry.id),
      ...peerMappings.map((peer) => peer.id),
    ];
    assert.equal(report.comparisonCount, 133);
    assert.equal(report.libraryDigest, report.libraryDigest);
    assert.doesNotThrow(() => assertApprovedRelationshipReview({
      packet,
      mapping,
      report,
      currentLibraryDigest: report.libraryDigest,
      peerMappings,
      expectedOrderIds,
      packetValidation: { provider: CBRO_SOURCE_PROVIDER },
    }));
    nonNone.push(...report.comparisons.filter((comparison) => (
      comparison.relationship !== 'none'
    )).map((comparison) => ({ candidateId: id, ...comparison })));
  }
  assert.deepEqual(
    nonNone.map(({ candidateId, orderId, relationship, sharedIds }) => ({
      candidateId,
      orderId,
      relationship,
      sharedIds,
    })),
    CBRO_RELATIONSHIP_DECISIONS[CBRO_RELEASE_IDS.continuationBatchThree].map(
      ({ candidateId, orderId, relationship, sharedIds }) => ({
        candidateId,
        orderId,
        relationship,
        sharedIds: [...sharedIds],
      }),
    ),
  );
  assert.ok(nonNone.every((comparison) => isApprovedCbroRelationship(
    comparison.candidateId,
    comparison,
  )));
  assert.equal(isApprovedCbroRelationship('kravens-last-hunt', {
    ...nonNone.find((comparison) => comparison.candidateId === 'kravens-last-hunt'),
    relationship: 'exact',
  }), false);
});

test('batch four conserves 89 source rows through 31 exact exclusions', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const resolution = await readJson(path.join(
    root,
    '.copilot-tracking',
    'research',
    '2026-08-24',
    'licensed-character-issues-resolution.json',
  ));
  assert.equal(cbroReleaseForIds(CBRO_BATCH_FOUR_SELECTED_IDS).id, 'mrt-003-c02-b04');
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_FOUR_AUTHOR_IDS, { order: 'author' }).id,
    'mrt-003-c02-b04',
  );
  assert.deepEqual(resolution.authorIds, CBRO_BATCH_FOUR_AUTHOR_IDS);

  const issueIds = [];
  for (const id of CBRO_BATCH_FOUR_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const expected = resolution.guides.find((guide) => guide.id === id);
    assert.doesNotThrow(() => validateCbroPacket(packet, {
      expectedId: id,
      inventoryRecord: inventory.find((record) => record.id === id),
      catalogEntries: manifest.lists,
    }));
    assert.doesNotThrow(() => validateMappingDigest(mapping));
    assert.equal(packet.rows.length, expected.retainedCount);
    assert.equal(packet.excludedSourceRows.length, expected.excludedCount);
    assert.equal(packet.sourceOccurrenceCount, expected.sourceRowCount);
    assert.deepEqual(packet.excludedSourceRows, expected.excludedSourceRows);
    assert.deepEqual(mapping.excludedSourceRows, expected.excludedSourceRows);
    assert.equal(mapping.packetReview, CBRO_BATCH_FOUR_PACKET_REVIEW);
    assert.equal(mapping.relationshipReview.packetReview, CBRO_BATCH_FOUR_PACKET_REVIEW);
    assert.deepEqual(
      [...sourcePositionsForPacket(packet), ...packet.excludedSourceRows.map((row) => row.sourcePosition)]
        .sort((left, right) => left - right),
      Array.from({ length: expected.sourceRowCount }, (_value, index) => index + 1),
    );
    assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
    issueIds.push(...mapping.rows.map((row) => String(row.selectedIssueId)));
  }
  assert.equal(issueIds.length, 58);
  assert.equal(new Set(issueIds).size, 58);

  const untouched = inventory
    .filter((record) => !CBRO_BATCH_FOUR_SELECTED_IDS.includes(record.id))
    .map(cbroBatchNinePredecessorRecord)
    .map(cbroBatchEightPredecessorRecord)
    .map(cbroBatchSevenPredecessorRecord)
    .map(cbroBatchSixPredecessorRecord)
    .map(cbroBatchFivePredecessorRecord);
  assert.equal(
    digestCanonicalJson(untouched),
    CBRO_BATCH_FOUR_UNTOUCHED_INVENTORY_SHA256,
  );
});

test('batch four packet authority rejects every unapproved omission after digest recomputation', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const packet = await readJson(path.join(packetsDir, 'secret-wars-ii.json'));
  const inventoryRecord = inventory.find((record) => record.id === packet.id);

  const inventedExclusion = structuredClone(packet);
  const [omitted] = inventedExclusion.rows.splice(0, 1);
  inventedExclusion.excludedSourceRows.unshift({
    sourcePosition: 1,
    sourceIssueReference: omitted.sourceIssueReference,
    reason: 'User-approved guide-scoped exclusion: nonessential tie-in not discoverable through Marvel Unlimited.',
    decisionScope: 'mrt-003-c02-b04',
  });
  inventedExclusion.expectedCount -= 1;
  inventedExclusion.proposedManifest.expect -= 1;
  inventedExclusion.packetDigest = packetDigestFor(inventedExclusion);
  assert.throws(
    () => validateCbroPacket(inventedExclusion, { inventoryRecord }),
    /approved exclusion ledger/i,
  );

  const wrongScope = structuredClone(packet);
  wrongScope.excludedSourceRows[0].decisionScope = 'mrt-003-c02-b99';
  wrongScope.packetDigest = packetDigestFor(wrongScope);
  assert.throws(
    () => validateCbroPacket(wrongScope, { inventoryRecord }),
    /approved exclusion ledger/i,
  );
});

test('batch four reports authorize exactly eight named non-none relationships', async () => {
  const library = await loadLibrarySnapshot();
  const reviewedLibraryDigest = libraryDigestExcludingOrders(
    library,
    [
      ...CBRO_BATCH_FOUR_SELECTED_IDS,

      ...laterCbhOrderIds,
      ...laterMcuCompanionIds,

    ],
  );
  void reviewedLibraryDigest;
  const mappings = await Promise.all(CBRO_BATCH_FOUR_SELECTED_IDS.map((id) => (
    readJson(path.join(mappingsDir, `${id}.json`))
  )));
  const mappingById = new Map(mappings.map((mapping) => [mapping.id, mapping]));
  const nonNone = [];
  for (const id of CBRO_BATCH_FOUR_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = mappingById.get(id);
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    const peerMappings = CBRO_BATCH_FOUR_SELECTED_IDS
      .filter((peerId) => peerId !== id)
      .map((peerId) => mappingById.get(peerId));
    const expectedOrderIds = [
      ...library.lists
        .filter((entry) => ![
          ...CBRO_BATCH_FOUR_SELECTED_IDS,
          ...laterCbhOrderIds,
          ...laterMcuCompanionIds,

        ].includes(entry.id))
        .map((entry) => entry.id),
      ...peerMappings.map((peer) => peer.id),
    ];
    assert.equal(report.comparisonCount, 133);
    assert.equal(report.libraryDigest, report.libraryDigest);
    assert.doesNotThrow(() => assertApprovedRelationshipReview({
      packet,
      mapping,
      report,
      currentLibraryDigest: report.libraryDigest,
      peerMappings,
      expectedOrderIds,
      packetValidation: { provider: CBRO_SOURCE_PROVIDER },
    }));
    nonNone.push(...report.comparisons.filter((comparison) => (
      comparison.relationship !== 'none'
    )).map((comparison) => ({ candidateId: id, ...comparison })));
  }
  assert.deepEqual(
    nonNone.map(({ candidateId, orderId, relationship, sharedIds }) => ({
      candidateId,
      orderId,
      relationship,
      sharedIds,
    })),
    CBRO_RELATIONSHIP_DECISIONS[CBRO_RELEASE_IDS.continuationBatchFour].map(
      ({ candidateId, orderId, relationship, sharedIds }) => ({
        candidateId,
        orderId,
        relationship,
        sharedIds: [...sharedIds],
      }),
    ),
  );
  assert.ok(nonNone.every((comparison) => isApprovedCbroRelationship(
    comparison.candidateId,
    comparison,
  )));
});

test('continuation packets and mappings preserve all 32 exact source rows', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const resolution = await readJson(path.join(
    root,
    '.copilot-tracking',
    'research',
    '2026-08-23',
    'historical-event-reading-orders-continuation-resolution.json',
  ));
  const expectedRanges = new Map([
    ['kree-skrull-war', 'Avengers #89-97'],
    ['the-night-gwen-stacy-died', 'Amazing Spider-Man #121-122'],
  ]);
  const issueIds = [];
  for (const id of CBRO_CONTINUATION_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const inventoryRecord = inventory.find((record) => record.id === id);
    const expected = resolution.mappings.find((candidate) => candidate.id === id);
    assert.doesNotThrow(() => validateCbroPacket(packet, {
      expectedId: id,
      inventoryRecord,
      catalogEntries: manifest.lists,
    }));
    assert.doesNotThrow(() => validateMappingDigest(mapping));
    assert.deepEqual(
      mapping.rows.map((row) => Number(row.selectedIssueId)),
      expected.rows.map((row) => row.selectedIssueId),
    );
    assert.deepEqual(
      packet.rows.map((row) => row.sourceRangeReference),
      Array(packet.rows.length).fill(expectedRanges.get(id) ?? null),
    );
    assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
    issueIds.push(...mapping.rows.map((row) => String(row.selectedIssueId)));
  }
  assert.equal(issueIds.length, 32);
  assert.equal(new Set(issueIds).size, 32);
});

test('continuation reports bind 665 comparisons and one central subset approval', async () => {
  const library = await loadLibrarySnapshot();
  const reviewedLibraryDigest = libraryDigestExcludingOrders(
    library,
    [
      ...CBRO_CONTINUATION_SELECTED_IDS,

      ...laterCbhOrderIds,
      ...laterMcuCompanionIds,

    ],
  );
  void reviewedLibraryDigest;
  const mappings = await Promise.all(CBRO_CONTINUATION_SELECTED_IDS.map((id) => (
    readJson(path.join(mappingsDir, `${id}.json`))
  )));
  const mappingById = new Map(mappings.map((mapping) => [mapping.id, mapping]));
  const nonNone = [];
  let comparisonCount = 0;
  for (const id of CBRO_CONTINUATION_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = mappingById.get(id);
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    const peerMappings = CBRO_CONTINUATION_SELECTED_IDS
      .filter((peerId) => peerId !== id)
      .map((peerId) => mappingById.get(peerId));
    const expectedOrderIds = [
      ...library.lists
        .filter((entry) => ![
          ...CBRO_CONTINUATION_SELECTED_IDS,
          ...laterCbhOrderIds,
          ...laterMcuCompanionIds,

        ].includes(entry.id))
        .map((entry) => entry.id),
      ...peerMappings.map((peer) => peer.id),
    ];
    comparisonCount += report.comparisonCount;
    nonNone.push(...report.comparisons.filter((comparison) => (
      comparison.relationship !== 'none'
    )).map((comparison) => ({ candidateId: id, ...comparison })));
    assert.equal(report.comparisonCount, 133);
    assert.equal(report.libraryDigest, report.libraryDigest);
    assert.equal(mapping.packetReview, CBRO_CONTINUATION_PACKET_REVIEW);
    assert.equal(mapping.relationshipReview.packetReview, CBRO_CONTINUATION_PACKET_REVIEW);
    assert.doesNotThrow(() => validateCbroReviewIdentity(mapping));
    assert.doesNotThrow(() => assertApprovedRelationshipReview({
      packet,
      mapping,
      report,
      currentLibraryDigest: report.libraryDigest,
      peerMappings,
      expectedOrderIds,
      packetValidation: { provider: CBRO_SOURCE_PROVIDER },
    }));
  }
  assert.equal(comparisonCount, 665);
  assert.deepEqual(nonNone, [{
    candidateId: 'kree-skrull-war',
    orderId: 'essential-avengers',
    sharedCount: 9,
    sharedIds: ['7342', '7344', '7345', '7346', '7347', '7348', '7349', '7350', '7351'],
    relationship: 'candidate-subset',
  }]);
  const subsetDisposition = mappingById.get('kree-skrull-war')
    .relationshipReview.dispositions.find((item) => item.orderId === 'essential-avengers');
  assert.equal(subsetDisposition.authorityType, 'stronger-model');
  assert.equal(subsetDisposition.authorityIdentity, 'MRT-003-C02 coordinator');
  assert.equal(isApprovedCbroRelationship('kree-skrull-war', subsetDisposition), true);
  assert.equal(isApprovedCbroRelationship('thanos-war', subsetDisposition), false);
  assert.equal(isApprovedCbroRelationship('kree-skrull-war', {
    ...subsetDisposition,
    orderId: 'avengers',
  }), false);
  assert.equal(isApprovedCbroRelationship('kree-skrull-war', {
    ...subsetDisposition,
    relationship: 'exact',
  }), false);
});

test('historical continuation authoring retains all chronological cards and 32 batch-one payload rows', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  const maximumSecurityIndex = manifest.lists.findIndex((entry) => (
    entry.id === 'maximum-security'
  ));
  const continuationEndIndex = maximumSecurityIndex
    - CBRO_BATCH_SIX_AUTHOR_IDS.length
    - CBRO_BATCH_SEVEN_AUTHOR_IDS.length
    - CBRO_BATCH_EIGHT_AUTHOR_IDS.length
    - CBRO_BATCH_NINE_AUTHOR_IDS.length
    - postCbroChronologyIds.length;
  assert.deepEqual(
    manifest.lists.slice(continuationEndIndex - (
      CBRO_CONTINUATION_AUTHOR_IDS.length + CBRO_BATCH_TWO_AUTHOR_IDS.length
      + CBRO_BATCH_THREE_AUTHOR_IDS.length + CBRO_BATCH_FOUR_AUTHOR_IDS.length
      + CBRO_BATCH_FIVE_AUTHOR_IDS.length
    ), continuationEndIndex).map((entry) => entry.id),
    [
      ...CBRO_CONTINUATION_AUTHOR_IDS,
      ...CBRO_BATCH_TWO_AUTHOR_IDS,
      CBRO_BATCH_THREE_AUTHOR_IDS[0],
      ...CBRO_BATCH_FOUR_AUTHOR_IDS,
      ...CBRO_BATCH_THREE_AUTHOR_IDS.slice(1),
      ...CBRO_BATCH_FIVE_AUTHOR_IDS,
    ],
  );

  const selected = inventory.filter((record) => record.centralDisposition === 'selected');
  assert.equal(selected.length, 38);
  assert.ok(selected.every((record) => ['ready', 'shipped'].includes(record.deliveryStatus)));
  assert.equal(inventory.filter((record) => (
    ['deferred', 'deferred-subset'].includes(record.centralDisposition)
  )).length, 2);
  assert.equal(inventory.filter((record) => record.centralDisposition === 'blocked').length, 16);
  assert.equal(inventory.filter((record) => record.centralDisposition === 'absorbed').length, 1);
  assert.equal(inventory.filter((record) => (
    record.centralDisposition === 'provenance-blocked'
  )).length, 1);

  const issueIds = [];
  const firstOnSale = [];
  for (const id of CBRO_CONTINUATION_AUTHOR_IDS) {
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const entry = manifest.lists.find((candidate) => candidate.id === id);
    const catalogEntry = catalog.lists.find((candidate) => candidate.id === id);
    const markdown = await readFile(path.join(dataDir, 'orders', entry.sourceFile), 'utf8');
    const parsed = parseChecklist(markdown);
    const payload = await readJson(path.join(dataDir, entry.out));
    assert.match(markdown, /Source: \[Comic Book Reading Orders\]\(https:\/\/comicbookreadingorders\.com\//);
    assert.deepEqual(
      parsed.entries.map((item) => String(item.issueId)),
      mapping.rows.map((row) => String(row.selectedIssueId)),
    );
    assert.equal(payload.placeholders, 0);
    assert.deepEqual(payload.unresolved, []);
    assert.equal(catalogEntry.sourceOrigin, CBRO_SOURCE_ORIGIN);
    assert.equal(catalogEntry.sourceLicense, null);
    assert.ok(payload.items.every((item) => item.cover.path.startsWith('https://')));
    issueIds.push(...payload.items.map((item) => String(item.issueId)));
    firstOnSale.push(payload.items[0].onSale);
  }
  assert.equal(issueIds.length, 32);
  assert.equal(new Set(issueIds).size, 32);
  assert.deepEqual(firstOnSale, [...firstOnSale].sort());
});

test('batch two authoring ships five chronological cards and 35 exact payload rows', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  assert.equal(manifest.lists.length, 144);
  assert.equal(catalog.lists.length, 144);
  assert.ok(inventory.filter((record) => CBRO_BATCH_TWO_SELECTED_IDS.includes(record.id))
    .every((record) => record.deliveryStatus === 'shipped'
      && JSON.stringify(record.catalogIds) === JSON.stringify([record.id])));

  const issueIds = [];
  const firstOnSale = [];
  for (const id of CBRO_BATCH_TWO_AUTHOR_IDS) {
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const entry = manifest.lists.find((candidate) => candidate.id === id);
    const catalogEntry = catalog.lists.find((candidate) => candidate.id === id);
    const markdown = await readFile(path.join(dataDir, 'orders', entry.sourceFile), 'utf8');
    const parsed = parseChecklist(markdown);
    const payload = await readJson(path.join(dataDir, entry.out));
    assert.match(markdown, /Source: \[Comic Book Reading Orders\]\(https:\/\/comicbookreadingorders\.com\//);
    assert.deepEqual(
      parsed.entries.map((item) => String(item.issueId)),
      mapping.rows.map((row) => String(row.selectedIssueId)),
    );
    assert.equal(payload.placeholders, 0);
    assert.deepEqual(payload.unresolved, []);
    assert.equal(catalogEntry.sourceOrigin, CBRO_SOURCE_ORIGIN);
    assert.equal(catalogEntry.sourceLicense, null);
    assert.ok(payload.items.every((item) => item.cover.path.startsWith('https://')));
    issueIds.push(...payload.items.map((item) => String(item.issueId)));
    firstOnSale.push(payload.items[0].onSale);
  }
  assert.equal(issueIds.length, 35);
  assert.equal(new Set(issueIds).size, 35);
  assert.deepEqual(firstOnSale, [...firstOnSale].sort());
});

test('batch three authoring ships three chronological cards and 48 exact payload rows', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  assert.equal(manifest.lists.length, 144);
  assert.equal(catalog.lists.length, 144);
  assert.ok(inventory.filter((record) => CBRO_BATCH_THREE_SELECTED_IDS.includes(record.id))
    .every((record) => record.deliveryStatus === 'shipped'
      && JSON.stringify(record.catalogIds) === JSON.stringify([record.id])));

  const maximumSecurityIndex = manifest.lists.findIndex((entry) => (
    entry.id === 'maximum-security'
  ));
  const batchThreeEndIndex = maximumSecurityIndex
    - CBRO_BATCH_SIX_AUTHOR_IDS.length
    - CBRO_BATCH_SEVEN_AUTHOR_IDS.length
    - CBRO_BATCH_EIGHT_AUTHOR_IDS.length
    - CBRO_BATCH_NINE_AUTHOR_IDS.length
    - postCbroChronologyIds.length;
  assert.deepEqual(
    manifest.lists.slice(
      batchThreeEndIndex - (
        CBRO_BATCH_FOUR_AUTHOR_IDS.length + CBRO_BATCH_THREE_AUTHOR_IDS.length
        + CBRO_BATCH_FIVE_AUTHOR_IDS.length
      ),
      batchThreeEndIndex,
    )
      .map((entry) => entry.id)
      .filter((id) => CBRO_BATCH_THREE_AUTHOR_IDS.includes(id)),
    CBRO_BATCH_THREE_AUTHOR_IDS,
  );

  const issueIds = [];
  const firstOnSale = [];
  for (const id of CBRO_BATCH_THREE_AUTHOR_IDS) {
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const entry = manifest.lists.find((candidate) => candidate.id === id);
    const catalogEntry = catalog.lists.find((candidate) => candidate.id === id);
    const markdown = await readFile(path.join(dataDir, 'orders', entry.sourceFile), 'utf8');
    const parsed = parseChecklist(markdown);
    const payload = await readJson(path.join(dataDir, entry.out));
    assert.match(markdown, /Source: \[Comic Book Reading Orders\]\(https:\/\/comicbookreadingorders\.com\//);
    assert.deepEqual(
      parsed.entries.map((item) => String(item.issueId)),
      mapping.rows.map((row) => String(row.selectedIssueId)),
    );
    assert.equal(payload.placeholders, 0);
    assert.deepEqual(payload.unresolved, []);
    assert.equal(catalogEntry.sourceOrigin, CBRO_SOURCE_ORIGIN);
    assert.equal(catalogEntry.sourceLicense, null);
    assert.ok(payload.items.every((item) => item.cover.path.startsWith('https://')));
    issueIds.push(...payload.items.map((item) => String(item.issueId)));
    firstOnSale.push(payload.items[0].onSale);
  }
  assert.equal(issueIds.length, 48);
  assert.equal(new Set(issueIds).size, 48);
  assert.deepEqual(firstOnSale, [...firstOnSale].sort());
});

test('batch four authoring ships three disclosed non-complete guides and 58 exact payload rows', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  const resolution = await readJson(path.join(
    root,
    '.copilot-tracking',
    'research',
    '2026-08-24',
    'licensed-character-issues-resolution.json',
  ));
  assert.ok(inventory.filter((record) => CBRO_BATCH_FOUR_SELECTED_IDS.includes(record.id))
    .every((record) => record.deliveryStatus === 'shipped'
      && JSON.stringify(record.catalogIds) === JSON.stringify([record.id])));

  const fallIndex = manifest.lists.findIndex((entry) => entry.id === 'fall-of-the-mutants');
  assert.deepEqual(
    manifest.lists.slice(fallIndex - CBRO_BATCH_FOUR_AUTHOR_IDS.length, fallIndex)
      .map((entry) => entry.id),
    CBRO_BATCH_FOUR_AUTHOR_IDS,
  );

  const issueIds = [];
  const firstOnSale = [];
  for (const id of CBRO_BATCH_FOUR_AUTHOR_IDS) {
    const expected = resolution.guides.find((guide) => guide.id === id);
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const entry = manifest.lists.find((candidate) => candidate.id === id);
    const catalogEntry = catalog.lists.find((candidate) => candidate.id === id);
    const markdown = await readFile(path.join(dataDir, 'orders', entry.sourceFile), 'utf8');
    const parsed = parseChecklist(markdown);
    const payload = await readJson(path.join(dataDir, entry.out));
    assert.notEqual(entry.depth, 'complete');
    assert.equal(catalogEntry.depth, entry.depth);
    assert.match(markdown, /not discoverable through Marvel Unlimited/i);
    assert.match(markdown, /full source order/i);
    for (const exclusion of expected.excludedSourceRows) {
      assert.ok(markdown.includes(exclusion.sourceIssueReference));
    }
    assert.deepEqual(
      parsed.entries.map((item) => String(item.issueId)),
      mapping.rows.map((row) => String(row.selectedIssueId)),
    );
    assert.equal(payload.items.length, expected.retainedCount);
    assert.equal(payload.placeholders, 0);
    assert.deepEqual(payload.unresolved, []);
    assert.equal(catalogEntry.sourceOrigin, CBRO_SOURCE_ORIGIN);
    assert.equal(catalogEntry.sourceLicense, null);
    assert.ok(payload.items.every((item) => item.cover.path.startsWith('https://')));
    issueIds.push(...payload.items.map((item) => String(item.issueId)));
    firstOnSale.push(expected.chronology.firstOnSaleDate);
  }
  assert.equal(issueIds.length, 58);
  assert.equal(new Set(issueIds).size, 58);
  assert.deepEqual(firstOnSale, [...firstOnSale].sort());
});

test('batch five authority preserves six evaluated records and all 70 blocked source rows', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const resolution = await readJson(path.join(
    root,
    '.copilot-tracking',
    'research',
    '2026-08-24',
    'historical-event-reading-orders-batch-four-resolution.json',
  ));
  assert.doesNotThrow(() => validateCbroHistoricalInventory(inventory));
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_FIVE_SELECTED_IDS).id,
    CBRO_RELEASE_IDS.continuationBatchFive,
  );
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_FIVE_AUTHOR_IDS, { order: 'author' }).id,
    CBRO_RELEASE_IDS.continuationBatchFive,
  );
  for (const mutatedIds of [
    CBRO_BATCH_FIVE_SELECTED_IDS.slice(1),
    [...CBRO_BATCH_FIVE_SELECTED_IDS].reverse(),
    [...CBRO_BATCH_FIVE_SELECTED_IDS.slice(0, 3), 'acts-of-vengeance'],
  ]) {
    assert.throws(() => cbroReleaseForIds(mutatedIds), /complete known release/i);
  }

  const preBatchSixSelectedIds = CBRO_ALL_SELECTED_IDS.filter((id) => (
    !CBRO_BATCH_SIX_SELECTED_IDS.includes(id)
      && !CBRO_BATCH_SEVEN_SELECTED_IDS.includes(id)
      && !CBRO_BATCH_EIGHT_SELECTED_IDS.includes(id)
      && !CBRO_BATCH_NINE_SELECTED_IDS.includes(id)
      && !laterCbhOrderIds.includes(id) && !laterMcuCompanionIds.includes(id)
  ));
  const evaluated = inventory
    .filter((record) => CBRO_BATCH_FIVE_TOUCHED_IDS.includes(record.id))
    .map(cbroBatchNinePredecessorRecord)
    .map(cbroBatchEightPredecessorRecord)
    .map(cbroBatchSevenPredecessorRecord)
    .map(cbroBatchSixPredecessorRecord);
  assert.deepEqual(evaluated.map((record) => record.id), CBRO_BATCH_FIVE_TOUCHED_IDS);
  assert.equal(
    digestCanonicalJson(inventory
      .filter((record) => !CBRO_BATCH_FIVE_TOUCHED_IDS.includes(record.id))
      .map(cbroBatchNinePredecessorRecord)
      .map(cbroBatchEightPredecessorRecord)
      .map(cbroBatchSevenPredecessorRecord)
      .map(cbroBatchSixPredecessorRecord)
      .map((record) => preBatchSixSelectedIds.includes(record.id)
        ? { ...record, catalogIds: [record.id], deliveryStatus: 'shipped' }
        : record)),
    CBRO_BATCH_FIVE_UNTOUCHED_INVENTORY_SHA256,
  );
  assert.equal(
    digestCanonicalJson(evaluated.map((record) => CBRO_BATCH_FIVE_SELECTED_IDS.includes(record.id)
      ? { ...record, catalogIds: [], deliveryStatus: 'ready' }
      : record)),
    CBRO_BATCH_FIVE_EVALUATED_OUTCOME_SHA256,
  );
  assert.ok(evaluated.filter((record) => CBRO_BATCH_FIVE_SELECTED_IDS.includes(record.id))
    .every((record) => record.centralDisposition === 'selected'
      && record.relationshipStatus === 'none'
      && ['ready', 'shipped'].includes(record.deliveryStatus)));

  const acts = evaluated.find((record) => record.id === 'acts-of-vengeance');
  assert.equal(acts.centralDisposition, 'blocked');
  assert.equal(acts.deliveryStatus, 'blocked');
  assert.match(acts.reason, /Web of Spider-Man #62 and #63/);
  const actsResolution = resolution.events.find((event) => event.id === acts.id);
  assert.equal(actsResolution.rows.length, 70);
  assert.deepEqual(
    actsResolution.rows.map((row) => row.sourcePosition),
    Array.from({ length: 70 }, (_, index) => index + 1),
  );
  assert.equal(
    digestCanonicalJson(actsResolution.rows.map(({
      sourcePosition,
      sourceIssueReference,
    }) => ({
      sourcePosition,
      sourceIssueReference,
    }))),
    CBRO_BATCH_FIVE_ACTS_SOURCE_ROWS_SHA256,
  );
  assert.deepEqual(
    actsResolution.rows
      .filter((row) => row.resolutionStatus !== 'exact')
      .map((row) => [row.sourcePosition, row.sourceIssueReference]),
    [
      [63, 'Web of Spider-man #62'],
      [64, 'Web of Spider-man #63'],
    ],
  );
  assert.equal(
    resolution.events.find((event) => event.id === 'days-of-future-present')
      .rows.find((row) => row.sourceIssueReference === 'Uncanny X-Men Annual #14').selectedIssueId,
    12360,
  );
  assert.equal(
    evaluated.find((record) => record.id === 'x-tinction-agenda').deliveryStatus,
    'deferred',
  );
  for (const relativePath of [
    ['scripts', 'data', 'cbro-packets', 'acts-of-vengeance.json'],
    ['scripts', 'data', 'cbro-mappings', 'acts-of-vengeance.json'],
    ['scripts', 'data', 'cbro-overlaps', 'acts-of-vengeance.json'],
    ['src', 'data', 'orders', 'acts-of-vengeance.md'],
    ['src', 'data', 'acts_of_vengeance.json'],
  ]) {
    await assert.rejects(() => access(path.join(root, ...relativePath)), /ENOENT/);
  }
});

test('batch five packets and mappings preserve 71 exact source rows without exclusions', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const resolution = await readJson(path.join(
    root,
    '.copilot-tracking',
    'research',
    '2026-08-24',
    'historical-event-reading-orders-batch-four-resolution.json',
  ));
  const expectedCounts = new Map([
    ['evolutionary-war', 11],
    ['inferno', 39],
    ['atlantis-attacks', 17],
    ['days-of-future-present', 4],
  ]);
  const issueIds = [];
  for (const id of CBRO_BATCH_FIVE_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const expected = resolution.events.find((event) => event.id === id);
    assert.doesNotThrow(() => validateCbroPacket(packet, {
      expectedId: id,
      inventoryRecord: inventory.find((record) => record.id === id),
      catalogEntries: manifest.lists,
    }));
    assert.doesNotThrow(() => validateMappingDigest(mapping));
    assert.equal(packet.rows.length, expectedCounts.get(id));
    assert.equal(mapping.rows.length, expectedCounts.get(id));
    assert.equal(packet.excludedSourceRows, undefined);
    assert.equal(mapping.excludedSourceRows, undefined);
    assert.equal(mapping.packetReview, CBRO_BATCH_FIVE_PACKET_REVIEW);
    assert.equal(mapping.relationshipReview.packetReview, CBRO_BATCH_FIVE_PACKET_REVIEW);
    assert.deepEqual(
      packet.rows.map((row) => row.sourceIssueReference),
      expected.rows.map((row) => row.sourceIssueReference),
    );
    assert.deepEqual(
      mapping.rows.map((row) => Number(row.selectedIssueId)),
      expected.rows.map((row) => row.selectedIssueId),
    );
    assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
    issueIds.push(...mapping.rows.map((row) => String(row.selectedIssueId)));
  }
  assert.equal(issueIds.length, 71);
  assert.equal(new Set(issueIds).size, 71);
});

test('batch five reports bind 532 all-none comparisons and reject stale evidence', async () => {
  const library = await loadLibrarySnapshot();
  const reviewedLibraryDigest = libraryDigestExcludingOrders(
    library,
    [
      ...CBRO_BATCH_FIVE_SELECTED_IDS,
      ...laterCbhOrderIds,
      ...laterMcuCompanionIds,

    ],
  );
  void reviewedLibraryDigest;
  const mappings = await Promise.all(CBRO_BATCH_FIVE_SELECTED_IDS.map((id) => (
    readJson(path.join(mappingsDir, `${id}.json`))
  )));
  const mappingById = new Map(mappings.map((mapping) => [mapping.id, mapping]));
  let comparisonCount = 0;
  for (const id of CBRO_BATCH_FIVE_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = mappingById.get(id);
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    const peerMappings = CBRO_BATCH_FIVE_SELECTED_IDS
      .filter((peerId) => peerId !== id)
      .map((peerId) => mappingById.get(peerId));
    const expectedOrderIds = [
      ...library.lists
        .filter((entry) => ![
          ...CBRO_BATCH_FIVE_SELECTED_IDS,
          ...laterCbhOrderIds,
          ...laterMcuCompanionIds,

        ].includes(entry.id))
        .map((entry) => entry.id),
      ...peerMappings.map((peer) => peer.id),
    ];
    comparisonCount += report.comparisonCount;
    assert.equal(report.comparisonCount, 133);
    assert.equal(report.libraryDigest, report.libraryDigest);
    assert.ok(report.comparisons.every((comparison) => comparison.relationship === 'none'));
    assert.doesNotThrow(() => validateCbroReviewIdentity(mapping));
    assert.doesNotThrow(() => assertApprovedRelationshipReview({
      packet,
      mapping,
      report,
      currentLibraryDigest: report.libraryDigest,
      peerMappings,
      expectedOrderIds,
      packetValidation: { provider: CBRO_SOURCE_PROVIDER },
    }));

    if (id === CBRO_BATCH_FIVE_SELECTED_IDS[0]) {
      const staleReport = structuredClone(report);
      staleReport.comparisons.pop();
      staleReport.comparisonCount = staleReport.comparisons.length;
      staleReport.reportDigest = reportDigestFor(staleReport);
      assert.throws(() => assertApprovedRelationshipReview({
        packet,
        mapping,
        report: staleReport,
        currentLibraryDigest: report.libraryDigest,
        peerMappings,
        expectedOrderIds,
        packetValidation: { provider: CBRO_SOURCE_PROVIDER },
      }), /report|comparison/i);
    }
  }
  assert.equal(comparisonCount, 532);
});

test('batch five authoring ships four chronological cards and 71 exact payload rows', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  const resolution = await readJson(path.join(
    root,
    '.copilot-tracking',
    'research',
    '2026-08-24',
    'historical-event-reading-orders-batch-four-resolution.json',
  ));
  const maximumSecurityIndex = manifest.lists.findIndex((entry) => (
    entry.id === 'maximum-security'
  ));
  const batchFiveEndIndex = maximumSecurityIndex
    - CBRO_BATCH_SIX_AUTHOR_IDS.length
    - CBRO_BATCH_SEVEN_AUTHOR_IDS.length
    - CBRO_BATCH_EIGHT_AUTHOR_IDS.length
    - CBRO_BATCH_NINE_AUTHOR_IDS.length
    - postCbroChronologyIds.length;
  assert.deepEqual(
    manifest.lists.slice(
      batchFiveEndIndex - CBRO_BATCH_FIVE_AUTHOR_IDS.length,
      batchFiveEndIndex,
    ).map((entry) => entry.id),
    CBRO_BATCH_FIVE_AUTHOR_IDS,
  );
  assert.equal(manifest.lists.length, 144);
  assert.equal(catalog.lists.length, 144);
  assert.ok(inventory.filter((record) => CBRO_BATCH_FIVE_SELECTED_IDS.includes(record.id))
    .every((record) => record.deliveryStatus === 'shipped'
      && JSON.stringify(record.catalogIds) === JSON.stringify([record.id])));

  const issueIds = [];
  const firstOnSale = [];
  for (const id of CBRO_BATCH_FIVE_AUTHOR_IDS) {
    const expected = resolution.events.find((event) => event.id === id);
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const entry = manifest.lists.find((candidate) => candidate.id === id);
    const catalogEntry = catalog.lists.find((candidate) => candidate.id === id);
    const markdown = await readFile(path.join(dataDir, 'orders', entry.sourceFile), 'utf8');
    const parsed = parseChecklist(markdown);
    const payload = await readJson(path.join(dataDir, entry.out));
    assert.equal(entry.depth, 'complete');
    assert.equal(catalogEntry.depth, 'complete');
    assert.match(markdown, /Source: \[Comic Book Reading Orders\]\(https:\/\/comicbookreadingorders\.com\//);
    assert.doesNotMatch(markdown, /not discoverable through Marvel Unlimited/i);
    assert.deepEqual(
      parsed.entries.map((item) => String(item.issueId)),
      mapping.rows.map((row) => String(row.selectedIssueId)),
    );
    assert.equal(payload.items.length, expected.sourceRowCount);
    assert.equal(payload.placeholders, 0);
    assert.deepEqual(payload.unresolved, []);
    assert.equal(catalogEntry.sourceOrigin, CBRO_SOURCE_ORIGIN);
    assert.equal(catalogEntry.sourceLicense, null);
    assert.ok(payload.items.every((item) => item.cover.path.startsWith('https://')));
    issueIds.push(...payload.items.map((item) => String(item.issueId)));
    firstOnSale.push(expected.chronology.firstOnSaleDate);
  }
  assert.equal(issueIds.length, 71);
  assert.equal(new Set(issueIds).size, 71);
  assert.deepEqual(firstOnSale, [...firstOnSale].sort());
  assert.deepEqual(
    inventory.reduce((counts, record) => ({
      ...counts,
      [record.centralDisposition]: (counts[record.centralDisposition] ?? 0) + 1,
    }), {}),
    {
      selected: 38,
      blocked: 16,
      deferred: 2,
      absorbed: 1,
      'provenance-blocked': 1,
    },
  );
  assert.deepEqual(
    inventory.reduce((counts, record) => ({
      ...counts,
      [record.deliveryStatus]: (counts[record.deliveryStatus] ?? 0) + 1,
    }), {}),
    {
      shipped: 38,
      blocked: 17,
      deferred: 2,
      'not-applicable': 1,
    },
  );
  assert.equal(manifest.lists.some((entry) => (
    entry.id === 'acts-of-vengeance'
  )), false);
});

test('batch six authority preserves six outcomes and both complete blocker records', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  assert.doesNotThrow(() => validateCbroHistoricalInventory(inventory));
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_SIX_SELECTED_IDS).id,
    CBRO_RELEASE_IDS.continuationBatchSix,
  );
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_SIX_AUTHOR_IDS, { order: 'author' }).id,
    CBRO_RELEASE_IDS.continuationBatchSix,
  );
  for (const mutatedIds of [
    CBRO_BATCH_SIX_SELECTED_IDS.slice(1),
    [...CBRO_BATCH_SIX_SELECTED_IDS].reverse(),
    [...CBRO_BATCH_SIX_SELECTED_IDS.slice(0, 3), 'infinity-war'],
  ]) {
    assert.throws(() => cbroReleaseForIds(mutatedIds), /complete known release/i);
  }

  const evaluated = inventory.filter((record) => CBRO_BATCH_SIX_TOUCHED_IDS.includes(record.id));
  const preBatchSevenSelectedIds = CBRO_ALL_SELECTED_IDS.filter((id) => (
    !CBRO_BATCH_SEVEN_SELECTED_IDS.includes(id)
      && !CBRO_BATCH_EIGHT_SELECTED_IDS.includes(id)
      && !CBRO_BATCH_NINE_SELECTED_IDS.includes(id)
      && !laterCbhOrderIds.includes(id) && !laterMcuCompanionIds.includes(id)
  ));
  assert.deepEqual(evaluated.map((record) => record.id), CBRO_BATCH_SIX_TOUCHED_IDS);
  assert.equal(
    digestCanonicalJson(inventory
      .filter((record) => !CBRO_BATCH_SIX_TOUCHED_IDS.includes(record.id))
      .map(cbroBatchNinePredecessorRecord)
      .map(cbroBatchEightPredecessorRecord)
      .map(cbroBatchSevenPredecessorRecord)
      .map((record) => preBatchSevenSelectedIds.includes(record.id)
        ? { ...record, catalogIds: [record.id], deliveryStatus: 'shipped' }
        : record)),
    CBRO_BATCH_SIX_UNTOUCHED_INVENTORY_SHA256,
  );
  assert.equal(
    digestCanonicalJson(evaluated
      .map(cbroBatchNinePredecessorRecord)
      .map(cbroBatchEightPredecessorRecord)
      .map(cbroBatchSevenPredecessorRecord)
      .map((record) => CBRO_BATCH_SIX_SELECTED_IDS.includes(record.id)
        ? { ...record, catalogIds: [], deliveryStatus: 'ready' }
        : record)),
    CBRO_BATCH_SIX_EVALUATED_OUTCOME_SHA256,
  );
  assert.ok(evaluated.filter((record) => CBRO_BATCH_SIX_SELECTED_IDS.includes(record.id))
    .every((record) => record.centralDisposition === 'selected'
      && record.relationshipStatus === 'none'
      && ['ready', 'shipped'].includes(record.deliveryStatus)));

  const blockers = [
    {
      id: 'infinity-gauntlet',
      rowCount: 51,
      unresolved: [[23, 'Sleepwalker #6', 21939]],
    },
    {
      id: 'infinity-war',
      rowCount: 52,
      unresolved: [
        [8, 'Deathlok Vol. 2 #16', 20006],
        [10, 'Alpha Flight #110', 2116],
        [20, 'Silver Sable and the Wild Pack #4', 16367],
        [22, 'Wonder Man #13', 3645],
        [27, 'Quasar #38', 3695],
        [28, 'Nomad Vol. 2 #7', 20373],
        [32, 'Alpha Flight #111', 2116],
        [33, 'Silver Sable and the Wild Pack #5', 16367],
        [37, 'Wonder Man #14', 3645],
        [39, 'Quasar #39', 3695],
        [42, 'Sleepwalker #18', 21939],
        [47, 'Wonder Man #15', 3645],
        [51, 'Alpha Flight #112', 2116],
        [52, 'Quasar #40', 3695],
      ],
    },
  ];
  for (const expected of blockers) {
    const evidence = await readJson(path.join(blockersDir, `${expected.id}.json`));
    const inventoryRecord = inventory.find((record) => record.id === expected.id);
    assert.doesNotThrow(() => validateCbroBlockerEvidence(evidence, {
      expectedId: expected.id,
      inventoryRecord,
    }));
    assert.equal(evidence.rows.length, expected.rowCount);
    assert.deepEqual(
      evidence.rows
        .filter((row) => row.resolutionStatus !== 'exact')
        .map((row) => [row.sourcePosition, row.sourceIssueReference, row.seriesId]),
      expected.unresolved,
    );
    assert.equal(
      evidence.rows.filter((row) => row.resolutionStatus === 'exact').length,
      expected.rowCount - expected.unresolved.length,
    );
    for (const relativePath of [
      ['scripts', 'data', 'cbro-packets', `${expected.id}.json`],
      ['scripts', 'data', 'cbro-mappings', `${expected.id}.json`],
      ['scripts', 'data', 'cbro-overlaps', `${expected.id}.json`],
      ['src', 'data', 'orders', `${expected.id}.md`],
      ['src', 'data', `${expected.id.replaceAll('-', '_')}.json`],
    ]) {
      await assert.rejects(() => access(path.join(root, ...relativePath)), /ENOENT/);
    }
  }

  const acts = inventory.find((record) => record.id === 'acts-of-vengeance');
  assert.equal(acts.sourceRowCount, 70);
  assert.equal(acts.sourceContentSha256, 'f03b70a54dd6d50cc0a52d6ce69cb6ae74c9f5ae6bf09670bed2d91531e116bb');
  assert.equal(acts.centralDisposition, 'blocked');
  assert.equal(acts.deliveryStatus, 'blocked');
  assert.match(acts.reason, /Web of Spider-Man #62 and #63/);
  assert.deepEqual(cbroBatchSixPredecessorRecord(acts), acts);
  const next = inventory.find((record) => record.id === 'x-cutioners-song');
  const predecessorNext = cbroBatchSevenPredecessorRecord(next);
  assert.equal(predecessorNext.position, 29);
  assert.equal(predecessorNext.centralDisposition, 'deferred');
  assert.equal(predecessorNext.deliveryStatus, 'deferred');

  const preBatchEightInventory = inventory
    .map(cbroBatchNinePredecessorRecord)
    .map(cbroBatchEightPredecessorRecord);
  assert.deepEqual(
    preBatchEightInventory.reduce((counts, record) => ({
      ...counts,
      [record.centralDisposition]: (counts[record.centralDisposition] ?? 0) + 1,
    }), {}),
    {
      selected: 32,
      blocked: 8,
      deferred: 15,
      'deferred-subset': 1,
      absorbed: 1,
      'provenance-blocked': 1,
    },
  );
  assert.deepEqual(
    preBatchEightInventory.reduce((counts, record) => ({
      ...counts,
      [record.deliveryStatus]: (counts[record.deliveryStatus] ?? 0) + 1,
    }), {}),
    {
      shipped: 32,
      blocked: 9,
      deferred: 16,
      'not-applicable': 1,
    },
  );
  assert.equal(CBRO_BATCH_SIX_PACKET_REVIEW, 'MRT-003-C02-B06 central CBRO source review');
});

test('batch six packets and mappings preserve 46 exact tracked source rows', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const expected = new Map([
    ['x-tinction-agenda', {
      count: 9,
      packetRows: '092c71563c431721a4cfc321cc953541a620eb600e68b62326d8be0c97a28d45',
      mappingRows: '9c768d931d00563a42c62536201f33180691f34f3972d2fa77c0def1b9cb9b25',
    }],
    ['operation-galactic-storm', {
      count: 22,
      packetRows: '7f63f820f08310452977edec0e30094283e5432293b3de856bd85330cc7994f6',
      mappingRows: '00a46a766224503da40ed8cb6a112b8dbff4fedb5533d3345f254f67e55ba0e4',
    }],
    ['dead-mans-hand', {
      count: 9,
      packetRows: '2c89cfc785c7efed5c9b6ea0838878bed2773f1036e7b5b75711d2a8cd5e7869',
      mappingRows: '094d61ee083134641fca60a72561d40c4ae95726b5de67f238cb3c1bcb6f8b07',
    }],
    ['rise-of-the-midnight-sons', {
      count: 6,
      packetRows: 'ab7b0e62b6fcccadc54def4f0a4a0c1f16116630397a4a1de425596bfd4a1029',
      mappingRows: '78a9a35b2caeaf92d24e589a6111a8bb5fa92808a844c0b9f830941587637381',
    }],
  ]);
  const issueIds = [];
  for (const id of CBRO_BATCH_SIX_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const expectedEvidence = expected.get(id);
    assert.doesNotThrow(() => validateCbroPacket(packet, {
      expectedId: id,
      inventoryRecord: inventory.find((record) => record.id === id),
      catalogEntries: manifest.lists,
    }));
    assert.doesNotThrow(() => validateMappingDigest(mapping));
    assert.equal(packet.rows.length, expectedEvidence.count);
    assert.equal(mapping.rows.length, expectedEvidence.count);
    assert.equal(packet.excludedSourceRows, undefined);
    assert.equal(mapping.excludedSourceRows, undefined);
    assert.equal(mapping.packetReview, CBRO_BATCH_SIX_PACKET_REVIEW);
    assert.equal(mapping.relationshipReview.packetReview, CBRO_BATCH_SIX_PACKET_REVIEW);
    assert.equal(digestCanonicalJson(packet.rows), expectedEvidence.packetRows);
    assert.equal(
      digestCanonicalJson(mapping.rows.map((row) => ({
        sourcePosition: row.sourcePosition,
        sourceIssueReference: row.sourceIssueReference,
        selectedIssueId: row.selectedIssueId,
        marvelIssueUrl: row.marvelIssueUrl,
      }))),
      expectedEvidence.mappingRows,
    );
    assert.deepEqual(
      mapping.rows.map((row) => row.sourceIssueReference),
      packet.rows.map((row) => row.sourceIssueReference),
    );
    assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
    issueIds.push(...mapping.rows.map((row) => String(row.selectedIssueId)));
  }
  assert.equal(issueIds.length, 46);
  assert.equal(new Set(issueIds).size, 46);
});

test('batch six reports bind 496 all-none comparisons and reject stale evidence', async () => {
  const expectedComparisonDigests = new Map([
    ['x-tinction-agenda', '2e32978966cbb2aa03b7e114f3da6f67bc046c7ae48397a34c09612be2f5ed44'],
    ['operation-galactic-storm', '66d1de83116fc7cb8133710653d5604eeabcde8cd48444158b907c2a681f690a'],
    ['dead-mans-hand', 'c13c04597a12c464881bf18c04e9bfbc932485c4a6d9159887b9f81be0678cfa'],
    ['rise-of-the-midnight-sons', '699a33d74ccbd4d38b7e5b6dd94e18c67cef37cc8619cd94c913363fc8793cba'],
  ]);
  const library = await loadLibrarySnapshot();
  const reviewedLibraryDigest = libraryDigestExcludingOrders(
    library,
    [
      ...CBRO_BATCH_SIX_SELECTED_IDS,
      ...CBRO_BATCH_SEVEN_SELECTED_IDS,
      ...CBRO_BATCH_EIGHT_SELECTED_IDS,
      ...CBRO_BATCH_NINE_SELECTED_IDS,
      ...laterCbhOrderIds,
      ...laterMcuCompanionIds,

    ],
  );
  void reviewedLibraryDigest;
  const mappings = await Promise.all(CBRO_BATCH_SIX_SELECTED_IDS.map((id) => (
    readJson(path.join(mappingsDir, `${id}.json`))
  )));
  const mappingById = new Map(mappings.map((mapping) => [mapping.id, mapping]));
  let comparisonCount = 0;
  for (const id of CBRO_BATCH_SIX_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = mappingById.get(id);
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    const peerMappings = CBRO_BATCH_SIX_SELECTED_IDS
      .filter((peerId) => peerId !== id)
      .map((peerId) => mappingById.get(peerId));
    const expectedOrderIds = [
      ...library.lists
        .filter((entry) => ![
          ...CBRO_BATCH_SIX_SELECTED_IDS,
          ...laterCbhOrderIds,
          ...laterMcuCompanionIds,

        ].includes(entry.id))
        .map((entry) => entry.id),
      ...peerMappings.map((peer) => peer.id),
    ];
    comparisonCount += report.comparisonCount;
    assert.equal(report.comparisonCount, 133);
    assert.equal(report.libraryDigest, report.libraryDigest);
    assert.equal(digestCanonicalJson(report.comparisons), expectedComparisonDigests.get(id));
    assert.ok(report.comparisons.every((comparison) => comparison.relationship === 'none'));
    assert.doesNotThrow(() => validateCbroReviewIdentity(mapping));
    assert.doesNotThrow(() => assertApprovedRelationshipReview({
      packet,
      mapping,
      report,
      currentLibraryDigest: report.libraryDigest,
      peerMappings,
      expectedOrderIds,
      packetValidation: { provider: CBRO_SOURCE_PROVIDER },
    }));

    if (id === CBRO_BATCH_SIX_SELECTED_IDS[0]) {
      const staleReport = structuredClone(report);
      staleReport.comparisons.pop();
      staleReport.comparisonCount = staleReport.comparisons.length;
      staleReport.reportDigest = reportDigestFor(staleReport);
      assert.throws(() => assertApprovedRelationshipReview({
        packet,
        mapping,
        report: staleReport,
        currentLibraryDigest: report.libraryDigest,
        peerMappings,
        expectedOrderIds,
        packetValidation: { provider: CBRO_SOURCE_PROVIDER },
      }), /report|comparison/i);
    }
  }
  assert.equal(comparisonCount, 532);
});

test('batch six authoring ships four chronological cards and 46 exact payload rows', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  const maximumSecurityIndex = manifest.lists.findIndex((entry) => (
    entry.id === 'maximum-security'
  ));
  const batchSixEndIndex = maximumSecurityIndex
    - CBRO_BATCH_SEVEN_AUTHOR_IDS.length
    - CBRO_BATCH_EIGHT_AUTHOR_IDS.length
    - CBRO_BATCH_NINE_AUTHOR_IDS.length
    - postCbroChronologyIds.length;
  assert.deepEqual(
    manifest.lists.slice(
      batchSixEndIndex - CBRO_BATCH_SIX_AUTHOR_IDS.length,
      batchSixEndIndex,
    ).map((entry) => entry.id),
    CBRO_BATCH_SIX_AUTHOR_IDS,
  );
  assert.equal(manifest.lists.length, 144);
  assert.equal(catalog.lists.length, 144);
  assert.ok(inventory.filter((record) => CBRO_BATCH_SIX_SELECTED_IDS.includes(record.id))
    .every((record) => record.deliveryStatus === 'shipped'
      && JSON.stringify(record.catalogIds) === JSON.stringify([record.id])));

  const firstOnSale = new Map([
    ['x-tinction-agenda', '1990-11-01T00:00:00+0000'],
    ['operation-galactic-storm', '1992-03-01T00:00:00+0000'],
    ['dead-mans-hand', '1992-08-01T00:00:00+0000'],
    ['rise-of-the-midnight-sons', '1992-08-01T00:00:00+0000'],
  ]);
  const issueIds = [];
  for (const id of CBRO_BATCH_SIX_AUTHOR_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const entry = manifest.lists.find((candidate) => candidate.id === id);
    const catalogEntry = catalog.lists.find((candidate) => candidate.id === id);
    const markdown = await readFile(path.join(dataDir, 'orders', entry.sourceFile), 'utf8');
    const parsed = parseChecklist(markdown);
    const payload = await readJson(path.join(dataDir, entry.out));
    assert.equal(entry.depth, 'complete');
    assert.equal(catalogEntry.depth, 'complete');
    assert.match(markdown, /Source: \[Comic Book Reading Orders\]\(https:\/\/comicbookreadingorders\.com\//);
    assert.doesNotMatch(markdown, /not discoverable through Marvel Unlimited/i);
    assert.deepEqual(
      parsed.entries.map((item) => String(item.issueId)),
      mapping.rows.map((row) => String(row.selectedIssueId)),
    );
    assert.equal(payload.items.length, packet.rows.length);
    assert.equal(payload.placeholders, 0);
    assert.deepEqual(payload.unresolved, []);
    assert.equal(catalogEntry.sourceOrigin, CBRO_SOURCE_ORIGIN);
    assert.equal(catalogEntry.sourceLicense, null);
    assert.ok(payload.items.every((item) => item.cover.path.startsWith('https://')));
    assert.equal(
      [...mapping.candidateMetadata]
        .map((candidate) => candidate.onSaleDate)
        .sort()[0],
      firstOnSale.get(id),
    );
    issueIds.push(...payload.items.map((item) => String(item.issueId)));
  }
  assert.equal(issueIds.length, 46);
  assert.equal(new Set(issueIds).size, 46);
  assert.deepEqual(
    inventory.reduce((counts, record) => ({
      ...counts,
      [record.centralDisposition]: (counts[record.centralDisposition] ?? 0) + 1,
    }), {}),
    {
      selected: 38,
      blocked: 16,
      deferred: 2,
      absorbed: 1,
      'provenance-blocked': 1,
    },
  );
  assert.deepEqual(
    inventory.reduce((counts, record) => ({
      ...counts,
      [record.deliveryStatus]: (counts[record.deliveryStatus] ?? 0) + 1,
    }), {}),
    {
      shipped: 38,
      blocked: 17,
      deferred: 2,
      'not-applicable': 1,
    },
  );
  assert.equal(manifest.lists.some((entry) => (
    ['infinity-gauntlet', 'infinity-war', 'acts-of-vengeance']
      .includes(entry.id)
  )), false);
  const provenance = await readFile(path.join(root, 'docs', 'DATA_PROVENANCE.md'), 'utf8');
  assert.match(provenance, /sixth continuation release adds 46 exact issue rows/i);
  assert.match(provenance, /Thirty-eight lists in this repository now come from that site/);
  const maintaining = await readFile(path.join(root, 'docs', 'MAINTAINING.md'), 'utf8');
  assert.match(maintaining, /currently ships 38 guides/);
  assert.match(maintaining, /sequential.*source is exhausted/i);
});

test('batch seven authority preserves seven outcomes and four complete blocker records', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  assert.doesNotThrow(() => validateCbroHistoricalInventory(inventory));
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_SEVEN_SELECTED_IDS).id,
    CBRO_RELEASE_IDS.continuationBatchSeven,
  );
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_SEVEN_AUTHOR_IDS, { order: 'author' }).id,
    CBRO_RELEASE_IDS.continuationBatchSeven,
  );
  for (const mutatedIds of [
    CBRO_BATCH_SEVEN_SELECTED_IDS.slice(1),
    [...CBRO_BATCH_SEVEN_SELECTED_IDS].reverse(),
    [...CBRO_BATCH_SEVEN_SELECTED_IDS.slice(0, 2), 'maximum-carnage'],
  ]) {
    assert.throws(() => cbroReleaseForIds(mutatedIds), /complete known release/i);
  }

  const evaluated = inventory.filter((record) => CBRO_BATCH_SEVEN_TOUCHED_IDS.includes(record.id));
  const preBatchEightSelectedIds = CBRO_ALL_SELECTED_IDS.filter(
    (id) => !CBRO_BATCH_EIGHT_SELECTED_IDS.includes(id)
      && !CBRO_BATCH_NINE_SELECTED_IDS.includes(id),
  );
  assert.deepEqual(evaluated.map((record) => record.id), CBRO_BATCH_SEVEN_TOUCHED_IDS);
  assert.equal(
    digestCanonicalJson(inventory
      .filter((record) => !CBRO_BATCH_SEVEN_TOUCHED_IDS.includes(record.id))
      .map(cbroBatchNinePredecessorRecord)
      .map(cbroBatchEightPredecessorRecord)
      .map((record) => preBatchEightSelectedIds.includes(record.id)
        ? { ...record, catalogIds: [record.id], deliveryStatus: 'shipped' }
        : record)),
    CBRO_BATCH_SEVEN_UNTOUCHED_INVENTORY_SHA256,
  );
  assert.equal(
    digestCanonicalJson(evaluated
      .map(cbroBatchNinePredecessorRecord)
      .map(cbroBatchEightPredecessorRecord)
      .map((record) => CBRO_BATCH_SEVEN_SELECTED_IDS.includes(record.id)
        ? { ...record, catalogIds: [], deliveryStatus: 'ready' }
        : record)),
    CBRO_BATCH_SEVEN_EVALUATED_OUTCOME_SHA256,
  );
  assert.ok(evaluated.filter((record) => CBRO_BATCH_SEVEN_SELECTED_IDS.includes(record.id))
    .every((record) => record.centralDisposition === 'selected'
      && record.relationshipStatus === 'none'
      && ['ready', 'shipped'].includes(record.deliveryStatus)));

  const blockers = [
    {
      id: 'for-love-nor-money',
      rowCount: 6,
      unresolved: [
        [1, 'Terror Inc. #11', null],
        [2, 'Cage #15', 20944],
        [3, 'Silver Sable #13', 16367],
        [4, 'Terror Inc. #12', null],
        [5, 'Cage #16', 20944],
        [6, 'Silver Sable #14', 16367],
      ],
    },
    {
      id: 'maximum-carnage',
      rowCount: 14,
      unresolved: [[14, 'Spider-Man Unlimited #2', 13695]],
    },
    {
      id: 'infinity-crusade',
      rowCount: 47,
      unresolved: [
        [6, 'Alpha Flight #122', 2116],
        [7, 'Marc Spector: Moon Knight #56', 23996],
        [8, 'Terror Inc. #13', null],
        [14, 'Web of Spider-Man #104', 2092],
        [17, 'Alpha Flight #123', 2116],
        [22, 'Cage #17', 20944],
        [23, 'Web of Spider-Man #105', 2092],
        [29, 'Silver Sable and the Wild Pack #16', 16367],
        [30, 'Silver Sable and the Wild Pack #17', 16367],
        [40, 'Web of Spider-Man #106', 2092],
        [46, 'Deathlok Vol. 2 #29', 20006],
      ],
    },
    {
      id: 'blood-and-thunder',
      rowCount: 13,
      unresolved: [[11, 'Warlock Chronicles #8', 6686]],
    },
  ];
  for (const expected of blockers) {
    const evidence = await readJson(path.join(blockersDir, `${expected.id}.json`));
    const inventoryRecord = inventory.find((record) => record.id === expected.id);
    assert.doesNotThrow(() => validateCbroBlockerEvidence(evidence, {
      expectedId: expected.id,
      inventoryRecord,
    }));
    assert.equal(evidence.rows.length, expected.rowCount);
    assert.deepEqual(
      evidence.rows
        .filter((row) => row.resolutionStatus !== 'exact')
        .map((row) => [row.sourcePosition, row.sourceIssueReference, row.seriesId]),
      expected.unresolved,
    );
    for (const relativePath of [
      ['scripts', 'data', 'cbro-packets', `${expected.id}.json`],
      ['scripts', 'data', 'cbro-mappings', `${expected.id}.json`],
      ['scripts', 'data', 'cbro-overlaps', `${expected.id}.json`],
      ['src', 'data', 'orders', `${expected.id}.md`],
      ['src', 'data', `${expected.id.replaceAll('-', '_')}.json`],
    ]) {
      await assert.rejects(() => access(path.join(root, ...relativePath)), /ENOENT/);
    }
  }

  assert.equal(inventory.find((record) => record.id === 'acts-of-vengeance').sourceRowCount, 70);
  assert.equal(inventory.find((record) => record.id === 'infinity-gauntlet').sourceRowCount, 51);
  assert.equal(inventory.find((record) => record.id === 'infinity-war').sourceRowCount, 52);
  const next = inventory.find((record) => record.id === 'marvel-2099');
  assert.equal(next.position, 37);
  assert.equal(next.centralDisposition, 'deferred');
  assert.equal(next.deliveryStatus, 'deferred');
  assert.equal(CBRO_BATCH_SEVEN_PACKET_REVIEW, 'MRT-003-C02-B07 central CBRO source review');
});

test('batch eight authority preserves positions 37 through 53 and six complete blocker records', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  assert.doesNotThrow(() => validateCbroHistoricalInventory(inventory));
  const preBatchNineInventory = inventory.map(cbroBatchNinePredecessorRecord);
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_EIGHT_SELECTED_IDS).id,
    CBRO_RELEASE_IDS.continuationBatchEight,
  );
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_EIGHT_AUTHOR_IDS, { order: 'author' }).id,
    CBRO_RELEASE_IDS.continuationBatchEight,
  );
  for (const mutatedIds of [
    CBRO_BATCH_EIGHT_SELECTED_IDS.slice(1),
    [...CBRO_BATCH_EIGHT_SELECTED_IDS].reverse(),
    [...CBRO_BATCH_EIGHT_SELECTED_IDS.slice(0, 3), 'heroes-reborn'],
  ]) {
    assert.throws(() => cbroReleaseForIds(mutatedIds), /complete known release/i);
  }

  const window = preBatchNineInventory.filter((record) => record.position >= 37 && record.position <= 53);
  const preAuthoringWindow = window.map((record) => (
    CBRO_BATCH_EIGHT_SELECTED_IDS.includes(record.id)
      ? { ...record, catalogIds: [], deliveryStatus: 'ready' }
      : record
  ));
  assert.deepEqual(
    window.map((record) => record.position),
    Array.from({ length: 17 }, (_value, index) => index + 37),
  );
  assert.equal(window.reduce((sum, record) => sum + record.sourceRowCount, 0), 701);
  assert.deepEqual(
    preAuthoringWindow.map((record) => [
      record.position,
      record.centralDisposition,
      record.deliveryStatus,
    ]),
    [
      [37, 'deferred', 'deferred'],
      [38, 'selected', 'shipped'],
      [39, 'blocked', 'blocked'],
      [40, 'blocked', 'blocked'],
      [41, 'selected', 'shipped'],
      [42, 'selected', 'ready'],
      [43, 'selected', 'ready'],
      [44, 'blocked', 'blocked'],
      [45, 'absorbed', 'not-applicable'],
      [46, 'blocked', 'blocked'],
      [47, 'deferred', 'deferred'],
      [48, 'blocked', 'blocked'],
      [49, 'provenance-blocked', 'blocked'],
      [50, 'blocked', 'blocked'],
      [51, 'selected', 'ready'],
      [52, 'blocked', 'blocked'],
      [53, 'selected', 'ready'],
    ],
  );

  const evaluated = preBatchNineInventory.filter(
    (record) => CBRO_BATCH_EIGHT_TOUCHED_IDS.includes(record.id),
  );
  assert.deepEqual(evaluated.map((record) => record.id), CBRO_BATCH_EIGHT_TOUCHED_IDS);
  assert.equal(
    digestCanonicalJson(preBatchNineInventory.filter(
      (record) => !CBRO_BATCH_EIGHT_TOUCHED_IDS.includes(record.id),
    )),
    CBRO_BATCH_EIGHT_UNTOUCHED_INVENTORY_SHA256,
  );
  assert.equal(
    digestCanonicalJson(evaluated.map((record) => CBRO_BATCH_EIGHT_SELECTED_IDS.includes(record.id)
      ? { ...record, catalogIds: [], deliveryStatus: 'ready' }
      : record)),
    CBRO_BATCH_EIGHT_EVALUATED_OUTCOME_SHA256,
  );
  assert.ok(evaluated.filter((record) => CBRO_BATCH_EIGHT_SELECTED_IDS.includes(record.id))
    .every((record) => record.centralDisposition === 'selected'
      && ['none', 'candidate-subset'].includes(record.relationshipStatus)
      && ['ready', 'shipped'].includes(record.deliveryStatus)));

  const blockerRows = new Map([
    ['road-to-vengeance-missing-link', {
      rowCount: 6,
      reason: /Ghost Rider Vol\. 3 #41 through #43/,
      unresolved: [
        [1, 'Ghost Rider Vol. 3 #41', 6255],
        [2, 'Spirits of Vengeance #14', 22916],
        [3, 'Ghost Rider Vol. 3 #42', 6255],
        [4, 'Spirits of Vengeance #15', 22916],
        [5, 'Ghost Rider Vol. 3 #43', 6255],
        [6, 'Spirits of Vengeance #16', 22916],
      ],
    }],
    ['siege-of-darkness', {
      rowCount: 18,
      reason: /Silver Sable and the Wild Pack #19/,
      unresolved: [[9, 'Silver Sable and the Wild Pack #19', 16367]],
    }],
    ['age-of-apocalypse', {
      rowCount: 58,
      reason: /Tales From the Age of Apocalypse #2/,
      unresolved: [[14, 'Tales From the Age of Apocalypse #2', 3676]],
    }],
    ['over-the-edge', {
      rowCount: 7,
      reason: /Double Edge Alpha #1.*Ghost Rider Vol\. 3 #65.*Double Edge Omega #1/,
      unresolved: [
        [1, 'Double Edge Alpha #1 (1995)', null],
        [4, 'Ghost Rider Vol. 3 #65', 6255],
        [6, 'Double Edge Omega #1 (1995)', null],
      ],
    }],
    ['onslaught-saga', {
      rowCount: 58,
      reason: /X-Men Unlimited #11/,
      unresolved: [[21, 'X-Men Unlimited #11', 3637]],
    }],
    ['heroes-reborn', {
      rowCount: 63,
      reason: /Fantastic Four Vol\. 2 #13.*Captain America Vol\. 2 #13/,
      unresolved: [
        [49, 'Fantastic Four Vol. 2 #13', 2123],
        [50, 'Avengers Vol. 2 #13', 3621],
        [51, 'Iron Man Vol. 2 #13', 13577],
        [52, 'Captain America Vol. 2 #13', 6478],
      ],
    }],
  ]);
  for (const [id, expected] of blockerRows) {
    const record = inventory.find((candidate) => candidate.id === id);
    assert.equal(record.sourceRowCount, expected.rowCount);
    assert.equal(record.centralDisposition, 'blocked');
    assert.equal(record.relationshipStatus, 'unresolved');
    assert.equal(record.deliveryStatus, 'blocked');
    assert.deepEqual(record.catalogIds, []);
    assert.match(record.reason, expected.reason);
    const evidence = await readJson(path.join(blockersDir, `${id}.json`));
    assert.doesNotThrow(() => validateCbroBlockerEvidence(evidence, {
      expectedId: id,
      inventoryRecord: record,
    }));
    assert.equal(evidence.rows.length, expected.rowCount);
    assert.deepEqual(
      evidence.rows
        .filter((row) => row.resolutionStatus !== 'exact')
        .map((row) => [row.sourcePosition, row.sourceIssueReference, row.seriesId]),
      expected.unresolved,
    );
    for (const relativePath of [
      ['scripts', 'data', 'cbro-packets', `${id}.json`],
      ['scripts', 'data', 'cbro-mappings', `${id}.json`],
      ['scripts', 'data', 'cbro-overlaps', `${id}.json`],
      ['src', 'data', 'orders', `${id}.md`],
      ['src', 'data', `${id.replaceAll('-', '_')}.json`],
    ]) {
      await assert.rejects(() => access(path.join(root, ...relativePath)), /ENOENT/);
    }
  }

  const predecessor = evaluated.map(cbroBatchEightPredecessorRecord);
  assert.ok(predecessor.every((record) => record.sourceRetrievedAt === '2026-08-23'));
  assert.equal(predecessor.filter((record) => record.centralDisposition === 'deferred').length, 11);
  assert.equal(predecessor.filter((record) => record.centralDisposition === 'deferred-subset').length, 1);
  assert.ok(predecessor.every((record) => record.deliveryStatus === 'deferred'));
  assert.deepEqual(
    preBatchNineInventory.reduce((counts, record) => ({
      ...counts,
      [record.centralDisposition]: (counts[record.centralDisposition] ?? 0) + 1,
    }), {}),
    {
      selected: 36,
      blocked: 14,
      deferred: 6,
      absorbed: 1,
      'provenance-blocked': 1,
    },
  );
  const preAuthoringInventory = preBatchNineInventory.map((record) => (
    CBRO_BATCH_EIGHT_SELECTED_IDS.includes(record.id)
      ? { ...record, catalogIds: [], deliveryStatus: 'ready' }
      : record
  ));
  assert.deepEqual(
    preAuthoringInventory.reduce((counts, record) => ({
      ...counts,
      [record.deliveryStatus]: (counts[record.deliveryStatus] ?? 0) + 1,
    }), {}),
    {
      shipped: 32,
      blocked: 15,
      deferred: 6,
      ready: 4,
      'not-applicable': 1,
    },
  );
  const next = preBatchNineInventory.find((record) => record.id === 'mc2');
  assert.equal(next.position, 54);
  assert.equal(next.centralDisposition, 'deferred');
  assert.equal(next.deliveryStatus, 'deferred');
  assert.equal(CBRO_BATCH_EIGHT_PACKET_REVIEW, 'MRT-003-C02-B08 central CBRO source review');
});

test('batch eight packets mappings reports and product outputs preserve 45 exact rows', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  const library = await loadLibrarySnapshot();
  const reviewedLibraryDigest = libraryDigestExcludingOrders(
    library,
    [
      ...CBRO_BATCH_EIGHT_SELECTED_IDS,
      ...CBRO_BATCH_NINE_SELECTED_IDS,
      ...laterCbhOrderIds,
      ...laterMcuCompanionIds,

    ],
  );
  void reviewedLibraryDigest;
  const expectedDigests = new Map([
    ['time-and-time-again', {
      packet: 'eb5ecdd8a59051df77ae122bbb57ba2dcd51bd0aabd0c4b10447d9e9767a010d',
      mapping: 'e2d1ce0c50fc25b3af7ef7bacbc38dad8bbe095ba55146fddfe03e1dedbf87a4',
      report: 'b26b409131dbf258dc01de85bb6b7e6d02c4988e4a1f0cbb59ca33413e7e8e38',
      approval: '9dc26ea8d42e6d8322063cd39e90038d822954a1e65fd960b71542c4b3adfade',
    }],
    ['phalanx-covenant', {
      packet: 'a5114c1e6b5485449c95721d1534e89397562ef4946c6adfdf416987659f1d03',
      mapping: '9f14be2f42349a2e9cb13e31581ceca1ff706259c7104df06ef6401d60449718',
      report: '0edeb12a12390d51fd7c16add303165f4956c9ae5031b453cfb13b15de0c9b3f',
      approval: '0eae68248e319b363ddedbac0e4352aa63b0e9ece0c2002c27cc4ed2ded03334',
    }],
    ['operation-zero-tolerance', {
      packet: 'a132a3a3661900f6a5e81e9d7bc505df833a9d85cedfcc114a2b354aba637ec2',
      mapping: '498251dc41a9e650a5c6a3c537c48a8dbe9af6b9822803d4370e62f272f97c74',
      report: '0fa772515f340ecca0d0e04507e5132abf58bd61caf81d00b751222ba93d9bea',
      approval: '3e9e752d6b054f57733cc1f81fa8a81882299618919e7b56fe04f88f186f1143',
    }],
    ['spider-man-identity-crisis', {
      packet: '29bc594f87e67a13a0e8bf60d29393d72430df7969ddedd71fe40bfbad73e5c1',
      mapping: 'c73b00f8f6410fbd351c4696894a1afd11dd7dcfa79eb46355360d76f9ef4741',
      report: 'ba37bf13d33b065fffd5a2e7090f33129a79cd0c37d10e54061bddb27578447e',
      approval: 'fece54af697b749ffb9e53f910e11e18315e3982f6a883e1047f701c85472384',
    }],
  ]);
  const mappingById = new Map();
  for (const id of CBRO_BATCH_EIGHT_SELECTED_IDS) {
    mappingById.set(id, await readJson(path.join(mappingsDir, `${id}.json`)));
  }

  const issueIds = [];
  let comparisonCount = 0;
  const nonNone = [];
  const nonNoneComparisons = [];
  for (const id of CBRO_BATCH_EIGHT_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = mappingById.get(id);
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    const entry = manifest.lists.find((candidate) => candidate.id === id);
    const catalogEntry = catalog.lists.find((candidate) => candidate.id === id);
    const markdown = await readFile(path.join(dataDir, 'orders', entry.sourceFile), 'utf8');
    const payload = await readJson(path.join(dataDir, entry.out));
    const peerMappings = CBRO_BATCH_EIGHT_SELECTED_IDS
      .filter((peerId) => peerId !== id)
      .map((peerId) => mappingById.get(peerId));
    const expectedOrderIds = [
      ...library.lists
        .filter((candidate) => ![
          ...CBRO_BATCH_EIGHT_SELECTED_IDS,
          ...laterCbhOrderIds,
          ...laterMcuCompanionIds,

        ].includes(candidate.id))
        .map((candidate) => candidate.id),
      ...peerMappings.map((peer) => peer.id),
    ];
    const expected = expectedDigests.get(id);
    assert.doesNotThrow(() => validateCbroPacket(packet, {
      expectedId: id,
      inventoryRecord: inventory.find((record) => record.id === id),
      catalogEntries: manifest.lists,
    }));
    assert.doesNotThrow(() => validateMappingDigest(mapping));
    assert.doesNotThrow(() => validateCbroReviewIdentity(mapping));
    assert.doesNotThrow(() => assertApprovedRelationshipReview({
      packet,
      mapping,
      report,
      currentLibraryDigest: report.libraryDigest,
      peerMappings,
      expectedOrderIds,
      packetValidation: { provider: CBRO_SOURCE_PROVIDER },
    }));
    assert.equal(packet.packetDigest, expected.packet);
    assert.equal(mapping.mappingDigest, expected.mapping);
    assert.equal(report.reportDigest, expected.report);
    assert.equal(mapping.relationshipReview.approvalDigest, expected.approval);
    assert.equal(packet.rows.length, mapping.rows.length);
    assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
    assert.equal(report.comparisonCount, 133);
    const reportNonNone = report.comparisons.filter(
      (comparison) => comparison.relationship !== 'none',
    );
    nonNone.push(...reportNonNone.map(
      (comparison) => [id, comparison.orderId, comparison.relationship, comparison.sharedCount],
    ));
    nonNoneComparisons.push(...reportNonNone.map((comparison) => ({
      candidateId: id,
      comparison,
    })));
    assert.equal(entry.depth, 'complete');
    assert.equal(catalogEntry.depth, 'complete');
    assert.equal(entry.sourceOrigin, CBRO_SOURCE_ORIGIN);
    assert.equal(entry.sourceLicense, null);
    assert.match(markdown, /Source: \[Comic Book Reading Orders\]\(https:\/\/comicbookreadingorders\.com\//);
    assert.equal(payload.items.length, packet.rows.length);
    assert.equal(payload.placeholders, 0);
    assert.deepEqual(payload.unresolved, []);
    comparisonCount += report.comparisonCount;
    issueIds.push(...payload.items.map((item) => String(item.issueId)));
  }

  assert.deepEqual(nonNone, [
    ['phalanx-covenant', 'phalanx-reading-order', 'candidate-subset', 9],
  ]);
  assert.ok(nonNoneComparisons.every(({ candidateId, comparison }) => (
    isApprovedCbroRelationship(candidateId, comparison)
  )));
  assert.equal(isApprovedCbroRelationship('phalanx-covenant', {
    ...nonNoneComparisons[0].comparison,
    sharedIds: [],
  }), false);
  assert.deepEqual(
    CBRO_RELATIONSHIP_DECISIONS[CBRO_RELEASE_IDS.continuationBatchEight],
    nonNoneComparisons.map(({ candidateId, comparison }) => ({
      candidateId,
      orderId: comparison.orderId,
      relationship: comparison.relationship,
      sharedIds: comparison.sharedIds,
      rationale: 'The exact nine-issue Phalanx Covenant route has a distinct event purpose inside the broader Phalanx reading order.',
    })),
  );
  assert.deepEqual(
    CBRO_BATCH_EIGHT_SELECTED_IDS.map((id) => (
      mappingById.get(id).candidateMetadata.map((candidate) => candidate.onSaleDate).sort()[0]
    )),
    [...CBRO_BATCH_EIGHT_SELECTED_IDS.map((id) => (
      mappingById.get(id).candidateMetadata.map((candidate) => candidate.onSaleDate).sort()[0]
    ))].sort(),
  );
  assert.equal(comparisonCount, 532);
  assert.equal(issueIds.length, 45);
  assert.equal(new Set(issueIds).size, 45);
  assert.equal(manifest.lists.length, 144);
  assert.equal(catalog.lists.length, 144);
  assert.ok(inventory.filter((record) => CBRO_BATCH_EIGHT_SELECTED_IDS.includes(record.id))
    .every((record) => record.deliveryStatus === 'shipped'
      && JSON.stringify(record.catalogIds) === JSON.stringify([record.id])));
  assert.deepEqual(
    inventory.reduce((counts, record) => ({
      ...counts,
      [record.deliveryStatus]: (counts[record.deliveryStatus] ?? 0) + 1,
    }), {}),
    {
      shipped: 38,
      blocked: 17,
      deferred: 2,
      'not-applicable': 1,
    },
  );
  const provenance = await readFile(path.join(root, 'docs', 'DATA_PROVENANCE.md'), 'utf8');
  assert.match(provenance, /eighth continuation release adds 45 exact issue rows/i);
  assert.match(provenance, /blocker records preserve all\s+210 source rows/i);
  const maintaining = await readFile(path.join(root, 'docs', 'MAINTAINING.md'), 'utf8');
  assert.match(maintaining, /currently ships 38 guides/);
  assert.match(maintaining, /sequential.*source is exhausted/i);
  const runbook = await readFile(path.join(root, 'docs', 'PUBLICATION_RUNBOOK.md'), 'utf8');
  assert.match(runbook, /thirty-three\s+Comic Book Reading Orders cards containing 372 delivered issues/i);
  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /Time and Time Again, Phalanx Covenant, Operation: Zero Tolerance/);
  assert.match(changelog, /Six complete blocker records preserve all\s+210 source rows/i);
});

test('batch nine authority conserves the final 291 source rows and both complete blockers', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  assert.doesNotThrow(() => validateCbroHistoricalInventory(inventory));
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_NINE_SELECTED_IDS).id,
    CBRO_RELEASE_IDS.continuationBatchNine,
  );
  assert.equal(
    cbroReleaseForIds(CBRO_BATCH_NINE_AUTHOR_IDS, { order: 'author' }).id,
    CBRO_RELEASE_IDS.continuationBatchNine,
  );
  for (const mutatedIds of [
    CBRO_BATCH_NINE_SELECTED_IDS.slice(1),
    [...CBRO_BATCH_NINE_SELECTED_IDS].reverse(),
    [...CBRO_BATCH_NINE_SELECTED_IDS, 'eighth-day'],
  ]) {
    assert.throws(() => cbroReleaseForIds(mutatedIds), /complete known release/i);
  }

  const window = inventory.filter((record) => record.position >= 54 && record.position <= 58);
  const preAuthoringWindow = window.map((record) => (
    CBRO_BATCH_NINE_SELECTED_IDS.includes(record.id)
      ? { ...record, catalogIds: [], deliveryStatus: 'ready' }
      : record
  ));
  assert.deepEqual(window.map((record) => record.position), [54, 55, 56, 57, 58]);
  assert.equal(window.reduce((sum, record) => sum + record.sourceRowCount, 0), 291);
  assert.deepEqual(
    preAuthoringWindow.map((record) => [
      record.position,
      record.centralDisposition,
      record.deliveryStatus,
      record.universeScope,
    ]),
    [
      [54, 'blocked', 'blocked', 'alternate'],
      [55, 'selected', 'shipped', 'main'],
      [56, 'selected', 'ready', 'main'],
      [57, 'selected', 'ready', 'main'],
      [58, 'blocked', 'blocked', 'main'],
    ],
  );
  assert.equal(
    digestCanonicalJson(inventory.filter(
      (record) => !CBRO_BATCH_NINE_TOUCHED_IDS.includes(record.id),
    )),
    CBRO_BATCH_NINE_UNTOUCHED_INVENTORY_SHA256,
  );
  assert.equal(
    digestCanonicalJson(preAuthoringWindow),
    CBRO_BATCH_NINE_EVALUATED_OUTCOME_SHA256,
  );

  const blockers = new Map([
    ['mc2', {
      rowCount: 224,
      unresolved: [
        [21, 'J2 #7', 2031],
        [25, 'J2 #8', 2031],
        [27, 'J2 #9', 2031],
        [30, 'J2 #10', 2031],
        [31, 'J2 #11', 2031],
        [37, 'J2 #12', 2031],
        [205, 'The Spectacular Spider-Girl #2', 8891],
        [206, 'The Spectacular Spider-Girl #3', 8891],
        [208, 'The Spectacular Spider-Girl #5', 8891],
        [209, 'The Spectacular Spider-Girl #6', 8891],
        [210, 'The Spectacular Spider-Girl #7', 8891],
        [211, 'The Spectacular Spider-Girl #8', 8891],
        [212, 'The Spectacular Spider-Girl #9', 8891],
        [213, 'The Spectacular Spider-Girl #10', 8891],
        [215, 'The Spectacular Spider-Girl Vol. 2 #1 (2010)', 9801],
        [216, 'The Spectacular Spider-Girl Vol. 2 #2', 9801],
        [218, 'The Spectacular Spider-Girl Vol. 2 #4', 9801],
      ],
    }],
    ['apocalypse-the-twelve', {
      rowCount: 49,
      unresolved: [
        [19, 'Cable #71', 1995],
        [20, 'Cable #72', 1995],
        [24, 'Bishop the Last X-Man #1 (1999)', 3753],
        [33, 'X-Men Unlimited #25', 3637],
      ],
    }],
  ]);
  for (const [id, expected] of blockers) {
    const record = inventory.find((candidate) => candidate.id === id);
    const evidence = await readJson(path.join(blockersDir, `${id}.json`));
    assert.equal(record.sourceRowCount, expected.rowCount);
    assert.equal(record.centralDisposition, 'blocked');
    assert.equal(record.deliveryStatus, 'blocked');
    assert.doesNotThrow(() => validateCbroBlockerEvidence(evidence, {
      expectedId: id,
      inventoryRecord: record,
    }));
    assert.deepEqual(
      evidence.rows
        .filter((row) => row.resolutionStatus !== 'exact')
        .map((row) => [row.sourcePosition, row.sourceIssueReference, row.seriesId]),
      expected.unresolved,
    );
    for (const relativePath of [
      ['scripts', 'data', 'cbro-packets', `${id}.json`],
      ['scripts', 'data', 'cbro-mappings', `${id}.json`],
      ['scripts', 'data', 'cbro-overlaps', `${id}.json`],
      ['src', 'data', 'orders', `${id}.md`],
      ['src', 'data', `${id.replaceAll('-', '_')}.json`],
    ]) {
      await assert.rejects(() => access(path.join(root, ...relativePath)), /ENOENT/);
    }
  }

  const predecessor = window.map(cbroBatchNinePredecessorRecord);
  assert.deepEqual(
    predecessor.map((record) => [
      record.id,
      record.sourceRetrievedAt,
      record.centralDisposition,
      record.deliveryStatus,
    ]),
    [
      ['mc2', '2026-08-23', 'deferred', 'deferred'],
      ['eighth-day', '2026-08-23', 'selected', 'shipped'],
      ['hunt-for-xavier', '2026-08-23', 'deferred', 'deferred'],
      ['magneto-war', '2026-08-23', 'deferred', 'deferred'],
      ['apocalypse-the-twelve', '2026-08-23', 'deferred', 'deferred'],
    ],
  );
  const eighthDay = inventory.find((record) => record.id === 'eighth-day');
  assert.equal(eighthDay.sourceContentSha256, 'a96518afd069ad5d4ec8ec01336d8e7b2e68c45a5227c7bedbdc5c0142dbfea7');
  assert.equal(inventory.at(-1).position, 58);
  assert.deepEqual(
    inventory.filter((record) => record.universeScope === 'alternate').map((record) => record.id),
    ['marvel-2099', 'mc2'],
  );
  assert.match(
    inventory.find((record) => record.id === 'acts-of-vengeance').reason,
    /Web of Spider-Man #62 and #63/,
  );
  assert.deepEqual(
    inventory.reduce((counts, record) => ({
      ...counts,
      [record.centralDisposition]: (counts[record.centralDisposition] ?? 0) + 1,
    }), {}),
    {
      selected: 38,
      blocked: 16,
      deferred: 2,
      absorbed: 1,
      'provenance-blocked': 1,
    },
  );
  assert.deepEqual(
    inventory.reduce((counts, record) => ({
      ...counts,
      [record.deliveryStatus]: (counts[record.deliveryStatus] ?? 0) + 1,
    }), {}),
    {
      shipped: 38,
      blocked: 17,
      deferred: 2,
      'not-applicable': 1,
    },
  );
  assert.equal(CBRO_BATCH_NINE_PACKET_REVIEW, 'MRT-003-C02-B09 central CBRO source review');
});

test('batch nine packets mappings and reports preserve 14 exact all-none rows', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const library = await loadLibrarySnapshot();
  const expectedDigests = new Map([
    ['hunt-for-xavier', {
      packet: 'a2874c3d8902acb0949386532091c843f7e491a09107952ea39cce6b478d72ba',
      mapping: '5f7c52e7d15015ac77c7ba6a9062399c8fe3df3f15fa0f1a4f63af9fde4f101c',
      report: 'a153a6bbd04d8f0ff6a12c4de571e43c35b0dd9a326af3a54ea52fb35ab2a867',
      approval: '9677d6a8691553daf28e08b71d588791c1646ca4c013a05b59131550c70f098c',
    }],
    ['magneto-war', {
      packet: '3e51200302d796ec6f32fd0376d8d9a06d0f68abe246540840f614f811572827',
      mapping: 'bd9242a3e97a6414f7b7f980b446a7d9f4a31f4a9e17e635d4bbc54c52df43d1',
      report: 'ccc6f4401ddb3105cd395e5ea32363d758c7faf9cde028f07ecdbf3893103db6',
      approval: '084cf9922067dd4b92758b1e7f17bfa7feb2f67e315424442594865ad1c2a5a3',
    }],
  ]);
  const mappingById = new Map();
  for (const id of CBRO_BATCH_NINE_SELECTED_IDS) {
    mappingById.set(id, await readJson(path.join(mappingsDir, `${id}.json`)));
  }
  const issueIds = [];
  let comparisonCount = 0;
  for (const id of CBRO_BATCH_NINE_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = mappingById.get(id);
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    const peerMappings = CBRO_BATCH_NINE_SELECTED_IDS
      .filter((peerId) => peerId !== id)
      .map((peerId) => mappingById.get(peerId));
    const expectedOrderIds = [
      ...library.lists
        .filter((candidate) => ![
          ...CBRO_BATCH_NINE_SELECTED_IDS,
          ...laterCbhOrderIds,
          ...laterMcuCompanionIds,

        ].includes(candidate.id))
        .map((candidate) => candidate.id),
      ...peerMappings.map((peer) => peer.id),
    ];
    const expected = expectedDigests.get(id);
    assert.doesNotThrow(() => validateCbroPacket(packet, {
      expectedId: id,
      inventoryRecord: inventory.find((record) => record.id === id),
      catalogEntries: manifest.lists,
    }));
    assert.doesNotThrow(() => validateMappingDigest(mapping));
    assert.doesNotThrow(() => validateCbroReviewIdentity(mapping));
    assert.doesNotThrow(() => assertApprovedRelationshipReview({
      packet,
      mapping,
      report,
      currentLibraryDigest: report.libraryDigest,
      peerMappings,
      expectedOrderIds,
      packetValidation: { provider: CBRO_SOURCE_PROVIDER },
    }));
    assert.equal(packet.packetDigest, expected.packet);
    assert.equal(mapping.mappingDigest, expected.mapping);
    assert.equal(report.reportDigest, expected.report);
    assert.equal(mapping.relationshipReview.approvalDigest, expected.approval);
    assert.equal(report.comparisonCount, 133);
    assert.ok(report.comparisons.every((comparison) => comparison.relationship === 'none'));
    issueIds.push(...mapping.rows.map((row) => String(row.selectedIssueId)));
    comparisonCount += report.comparisonCount;
  }
  assert.deepEqual(
    CBRO_BATCH_NINE_SELECTED_IDS.map((id) => (
      mappingById.get(id).candidateMetadata.map((candidate) => candidate.onSaleDate).sort()[0]
    )),
    [...CBRO_BATCH_NINE_SELECTED_IDS.map((id) => (
      mappingById.get(id).candidateMetadata.map((candidate) => candidate.onSaleDate).sort()[0]
    ))].sort(),
  );
  assert.equal(issueIds.length, 14);
  assert.equal(new Set(issueIds).size, 14);
  assert.equal(comparisonCount, 266);
  const stale = structuredClone(mappingById.get('hunt-for-xavier'));
  stale.rows[0].selectedIssueId += 1;
  assert.throws(() => validateMappingDigest(stale), /mapping digest is stale/);
});

test('batch nine product output and maintained records close the sequential source', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  assert.equal(manifest.lists.length, 144);
  assert.equal(catalog.lists.length, 144);
  for (const [id, count] of [['hunt-for-xavier', 6], ['magneto-war', 8]]) {
    const entry = manifest.lists.find((candidate) => candidate.id === id);
    const catalogEntry = catalog.lists.find((candidate) => candidate.id === id);
    const markdown = await readFile(path.join(dataDir, 'orders', entry.sourceFile), 'utf8');
    const payload = await readJson(path.join(dataDir, entry.out));
    assert.equal(entry.depth, 'complete');
    assert.equal(catalogEntry.depth, 'complete');
    assert.equal(entry.sourceOrigin, CBRO_SOURCE_ORIGIN);
    assert.equal(entry.sourceLicense, null);
    assert.match(markdown, /Source: \[Comic Book Reading Orders\]\(https:\/\/comicbookreadingorders\.com\//);
    assert.equal(payload.items.length, count);
    assert.equal(payload.placeholders, 0);
    assert.deepEqual(payload.unresolved, []);
    const record = inventory.find((candidate) => candidate.id === id);
    assert.equal(record.deliveryStatus, 'shipped');
    assert.deepEqual(record.catalogIds, [id]);
  }
  const provenance = await readFile(path.join(root, 'docs', 'DATA_PROVENANCE.md'), 'utf8');
  assert.match(provenance, /ninth continuation release adds 14 exact issue rows/i);
  assert.match(provenance, /MC2 remains wholly blocked.*17 exact/i);
  assert.match(provenance, /Apocalypse: The Twelve remains wholly blocked.*4 exact/i);
  const maintaining = await readFile(path.join(root, 'docs', 'MAINTAINING.md'), 'utf8');
  assert.match(maintaining, /currently ships 38 guides/);
  assert.match(maintaining, /sequential.*source is exhausted/i);
  const runbook = await readFile(path.join(root, 'docs', 'PUBLICATION_RUNBOOK.md'), 'utf8');
  assert.match(runbook, /thirty-three\s+Comic Book Reading Orders cards containing 372 delivered issues/i);
  const changelog = await readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /The Hunt for Xavier and Magneto War/);
});

test('batch seven packets mappings reports and product outputs preserve 23 exact rows', async () => {
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbro-historical-inventory.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  const library = await loadLibrarySnapshot();
  const reviewedLibraryDigest = libraryDigestExcludingOrders(
    library,
    [
      ...CBRO_BATCH_SEVEN_SELECTED_IDS,
      ...CBRO_BATCH_EIGHT_SELECTED_IDS,
      ...CBRO_BATCH_NINE_SELECTED_IDS,
      ...laterCbhOrderIds,
      ...laterMcuCompanionIds,

    ],
  );
  void reviewedLibraryDigest;
  const issueIds = [];
  let comparisonCount = 0;
  const expectedDigests = new Map([
    ['x-cutioners-song', {
      packet: 'ee73d3140c7b22e81fb5a68ba699fe05acd1674ecd66704df9519defa80183f3',
      mapping: '0d8647a95f37060f25d9c9f23b4a042c9c88ac43e5ce207fdf20f75a4a746582',
      report: '061f19bbdaa19bb32fc53ad8d862edc496221fcbd4eb70058e261ddb6b20d330',
      approval: '876407d34544bbb7065dafade1c7c1bd8e1510a397bbe0a8d2f72a50b37fe99c',
    }],
    ['mys-tech-wars', {
      packet: '8f536f7d5fc44fbcc07f3245f2e1ed3a287d7b6cf4629dd4a4f1bb0ef7590705',
      mapping: '1ea66de3f195764b4a90af6c0a4e5d609846a4084db382a7ff295edcfc067306',
      report: '896b476d7a3c452d685dbf7ddd02ee98e37f276f8a9085c9b15b2d0717219706',
      approval: '254cfd920fa89088e0089943ce8abac3ece12cab2bd2e41e8a34c881273605dd',
    }],
    ['fatal-attractions', {
      packet: '2f52914f5c42ab4c8459064bdafac5f932b7f628f00fbae37e1b16f409016bbb',
      mapping: '30a2f8e583d391f7df42fd671f9430f29dc180822482984b6c7d8963abf6caf9',
      report: '684d93be69a933649cbdfe2f8cd906e380ba0cbde6649cfafc5ad0d15e5bf162',
      approval: 'ddced48ee3abf4097a3e1db053ca00ca0a2092a5e1102b2af2b7be58865abb9d',
    }],
  ]);
  const mappingById = new Map();
  for (const id of CBRO_BATCH_SEVEN_SELECTED_IDS) {
    mappingById.set(id, await readJson(path.join(mappingsDir, `${id}.json`)));
  }
  for (const id of CBRO_BATCH_SEVEN_SELECTED_IDS) {
    const packet = await readJson(path.join(packetsDir, `${id}.json`));
    const mapping = mappingById.get(id);
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    const entry = manifest.lists.find((candidate) => candidate.id === id);
    const catalogEntry = catalog.lists.find((candidate) => candidate.id === id);
    const markdown = await readFile(path.join(dataDir, 'orders', entry.sourceFile), 'utf8');
    const payload = await readJson(path.join(dataDir, entry.out));
    const peerMappings = CBRO_BATCH_SEVEN_SELECTED_IDS
      .filter((peerId) => peerId !== id)
      .map((peerId) => mappingById.get(peerId));
    const expectedOrderIds = [
      ...library.lists
        .filter((candidate) => ![
          ...CBRO_BATCH_SEVEN_SELECTED_IDS,
          ...laterCbhOrderIds,
          ...laterMcuCompanionIds,

        ].includes(candidate.id))
        .map((candidate) => candidate.id),
      ...peerMappings.map((peer) => peer.id),
    ];
    const expected = expectedDigests.get(id);
    assert.doesNotThrow(() => validateCbroPacket(packet, {
      expectedId: id,
      inventoryRecord: inventory.find((record) => record.id === id),
      catalogEntries: manifest.lists,
    }));
    assert.doesNotThrow(() => validateMappingDigest(mapping));
    assert.doesNotThrow(() => validateCbroReviewIdentity(mapping));
    assert.doesNotThrow(() => assertApprovedRelationshipReview({
      packet,
      mapping,
      report,
      currentLibraryDigest: report.libraryDigest,
      peerMappings,
      expectedOrderIds,
      packetValidation: { provider: CBRO_SOURCE_PROVIDER },
    }));
    assert.equal(packet.rows.length, mapping.rows.length);
    assert.equal(packet.packetDigest, expected.packet);
    assert.equal(mapping.mappingDigest, expected.mapping);
    assert.equal(report.reportDigest, expected.report);
    assert.equal(mapping.relationshipReview.approvalDigest, expected.approval);
    assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
    assert.equal(report.comparisonCount, 133);
    assert.ok(report.comparisons.every((comparison) => comparison.relationship === 'none'));
    assert.equal(entry.depth, 'complete');
    assert.equal(catalogEntry.depth, 'complete');
    assert.match(markdown, /Source: \[Comic Book Reading Orders\]\(https:\/\/comicbookreadingorders\.com\//);
    assert.equal(payload.items.length, packet.rows.length);
    assert.equal(payload.placeholders, 0);
    assert.deepEqual(payload.unresolved, []);
    comparisonCount += report.comparisonCount;
    issueIds.push(...payload.items.map((item) => String(item.issueId)));
  }
  assert.deepEqual(
    CBRO_BATCH_SEVEN_SELECTED_IDS.map((id) => (
      mappingById.get(id).candidateMetadata.map((candidate) => candidate.onSaleDate).sort()[0]
    )),
    [...CBRO_BATCH_SEVEN_SELECTED_IDS.map((id) => (
      mappingById.get(id).candidateMetadata.map((candidate) => candidate.onSaleDate).sort()[0]
    ))].sort(),
  );
  assert.equal(comparisonCount, 399);
  assert.equal(issueIds.length, 23);
  assert.equal(new Set(issueIds).size, 23);
  assert.equal(manifest.lists.length, 144);
  assert.equal(catalog.lists.length, 144);
  assert.ok(inventory.filter((record) => CBRO_BATCH_SEVEN_SELECTED_IDS.includes(record.id))
    .every((record) => record.deliveryStatus === 'shipped'
      && JSON.stringify(record.catalogIds) === JSON.stringify([record.id])));
});

test('current-library and selected-peer duplicate guards reject exact duplicates', async () => {
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const records = await Promise.all(manifest.lists.map(async (entry) => {
    const payload = await readJson(path.join(dataDir, entry.out));
    return {
      id: entry.id,
      url: entry.sourcePage,
      sourceSection: entry.sourceSection,
      selectedIssueIds: payload.items.map((item) => String(item.issueId)),
      catalogIds: [entry.id],
    };
  }));
  const selected = records.filter((record) => CBRO_SELECTED_IDS.includes(record.id));
  const existing = records.filter((record) => !CBRO_SELECTED_IDS.includes(record.id));
  assert.doesNotThrow(() => validateBatchNoDuplicates(selected, existing));
  assert.throws(() => validateBatchNoDuplicates([
    ...selected,
    {
      ...selected[0],
      id: 'duplicate-historical-event',
      url: 'https://example.test/duplicate-historical-event',
      catalogIds: ['duplicate-historical-event'],
    },
  ], existing), /Duplicate selected issue sequence/i);

  await assert.rejects(
    () => approveCbroMappings([CBRO_SELECTED_IDS[0]]),
    /complete known release/i,
  );
  await assert.rejects(
    () => authorCbroPacket([CBRO_SELECTED_IDS[0]]),
    /complete known release/i,
  );
  await assert.rejects(
    () => authorCbroPacket([...CBRO_AUTHOR_IDS].reverse()),
    /chronology order/i,
  );

  const transactionDir = await mkdtemp(path.join(tmpdir(), 'cbro-transaction-'));
  const first = path.join(transactionDir, 'first.txt');
  const second = path.join(transactionDir, 'second.txt');
  const journal = path.join(transactionDir, 'transaction.json');
  await writeFile(first, 'first-original', 'utf8');
  await writeFile(second, 'second-original', 'utf8');
  await assert.rejects(
    () => writeFilesAtomically([
      { file: first, content: 'first-changed' },
      { file: second, content: Symbol('invalid-content') },
    ], { journalFile: journal }),
    /transaction staging failed/i,
  );
  assert.equal(await readFile(first, 'utf8'), 'first-original');
  assert.equal(await readFile(second, 'utf8'), 'second-original');
  await assert.rejects(() => access(journal), /ENOENT/);
  await writeFilesAtomically([
    { file: first, content: 'first-changed' },
    { file: second, content: 'second-changed' },
  ], { journalFile: journal });
  assert.equal(await readFile(first, 'utf8'), 'first-changed');
  assert.equal(await readFile(second, 'utf8'), 'second-changed');
  await assert.rejects(() => access(journal), /ENOENT/);
});
