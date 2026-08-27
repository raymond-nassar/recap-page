import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIRST_PACKET_IDS,
  assertApprovedRelationshipReview,
  assertCompleteOverlapReport,
  authorPacket,
  authorIdsFromArgs,
  buildMarkdown,
  existingEntriesForPacket,
  manifestEntryForMapping,
  mergePacketEntries,
  peerIdsFromArgs,
} from '../scripts/author-cbh-packet.mjs';
import {
  approvalDigestFor,
  assertGapTransition,
  gapEvidenceDigestFor,
  libraryDigestFor,
  mappingDigestFor,
  packetDigestFor,
  reportDigestFor,
  sourceOccurrenceCountFor,
  sourcePositionsForPacket,
  validateBatchNoDuplicates,
  validateFrozenPacket,
} from '../scripts/lib/cbh-inventory.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'src', 'data');
const mappingsDir = path.join(root, 'scripts', 'data', 'cbh-mappings');
const overlapsDir = path.join(root, 'scripts', 'data', 'cbh-overlaps');
const PACKET_IDS = FIRST_PACKET_IDS;

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function mappingIds(mapping) {
  return mapping.rows.map((row) => String(row.selectedIssueId));
}

function genericPacket({ withRepeat = false } = {}) {
  const packet = {
    schemaVersion: 1,
    id: 'future-event',
    inventoryId: 'future-event',
    sourceUrl: 'https://www.comicbookherald.com/future-event/',
    sourceRetrievedAt: '2026-08-22',
    sourceBoundary: 'The explicit issue-by-issue reading-order section.',
    excludedSourceReferences: [],
    expectedCount: 2,
    proposedManifest: {
      id: 'future-event',
      name: 'Future Event',
      description: 'A frozen two-issue event.',
      type: 'event',
      depth: 'complete',
      beginner: false,
      group: null,
      groupName: null,
      variant: null,
      sourceFile: 'future-event.md',
      sourcePage: 'https://www.comicbookherald.com/future-event/',
      sourceOrigin: "Compiled for this project from Comic Book Herald's guide",
      sourceLicense: null,
      out: 'future_event.json',
      characters: ['Tester'],
      keywords: ['Future Event'],
      expect: 2,
      timeline: 2026,
      coverIssueId: 9001,
    },
    insertionAnchor: { beforeId: 'chronology-anchor' },
    sourceReview: {
      authorityType: 'human',
      authorityIdentity: 'source-owner',
      rationale: 'The visible boundary and chronology were reviewed.',
      reviewedAt: '2026-08-22T12:00:00Z',
    },
    rows: [
      {
        sourceIssueReference: 'Future Event #1',
        sourceRangeReference: null,
        normalizedSeriesTitle: 'Future Event',
        seriesYear: 2026,
        issueNumber: '1',
        seriesId: 900,
        candidateIssueId: 9001,
        manualSeriesSelectionApproved: false,
        selectionNote: null,
      },
      {
        sourceIssueReference: 'Future Event #2',
        sourceRangeReference: null,
        normalizedSeriesTitle: 'Future Event',
        seriesYear: 2026,
        issueNumber: '2',
        seriesId: 900,
        candidateIssueId: 9002,
        manualSeriesSelectionApproved: false,
        selectionNote: null,
      },
    ],
  };
  if (withRepeat) {
    packet.sourceOccurrenceCount = 3;
    packet.repeatedSourceReferences = [{
      sourcePosition: 2,
      canonicalRow: 1,
      sourceIssueReference: 'Future Event #1',
      sourceRangeReference: 'Future Event #1 to #2, then #1 again',
      normalizedSeriesTitle: 'Future Event',
      seriesYear: 2026,
      issueNumber: '1',
    }];
  }
  packet.packetDigest = packetDigestFor(packet);
  return packet;
}

function genericGapPacket(kind = 'published-metadata-gap') {
  const packet = genericPacket();
  const missingRow = packet.rows.pop();
  packet.expectedCount = 1;
  packet.proposedManifest.expect = 1;
  packet.sourceOccurrenceCount = 2;
  packet.sourceGaps = [{
    sourcePosition: 2,
    sourceIssueReference: missingRow.sourceIssueReference,
    sourceRangeReference: missingRow.sourceRangeReference,
    normalizedSeriesTitle: missingRow.normalizedSeriesTitle,
    seriesYear: missingRow.seriesYear,
    issueNumber: missingRow.issueNumber,
    kind,
    status: kind === 'published-metadata-gap' ? 'open' : 'closed',
    checkedAt: '2026-08-26',
    auditBasis: kind === 'published-metadata-gap'
      ? 'The exact identity remains unresolved.'
      : 'The owner confirmed this comic is unavailable.',
    evidenceSources: [{
      kind: 'tracking-issue',
      url: 'https://example.test/issues/1',
      retrievedAt: '2026-08-26',
    }],
  }];
  packet.sourceGaps[0].evidenceDigest = gapEvidenceDigestFor(packet.sourceGaps[0]);
  packet.packetDigest = packetDigestFor(packet);
  return packet;
}

function genericGapMapping(packet) {
  const mapping = genericMapping(genericPacket());
  mapping.packetDigest = packet.packetDigest;
  mapping.approvedSourceCount = packet.sourceOccurrenceCount;
  mapping.sourceOccurrenceCount = packet.sourceOccurrenceCount;
  mapping.sourceGaps = structuredClone(packet.sourceGaps);
  mapping.proposedManifest = structuredClone(packet.proposedManifest);
  mapping.rows = mapping.rows.slice(0, 1);
  mapping.mappingDigest = mappingDigestFor(mapping);
  return mapping;
}

function genericMapping(packet, id = packet.id) {
  const sourcePositions = sourcePositionsForPacket(packet);
  const rows = [1, 2].map((issueNumber, index) => ({
    sourcePosition: sourcePositions[index],
    sourceIssueReference: `Future Event #${issueNumber}`,
    sourceRangeReference: null,
    normalizedSeriesTitle: 'Future Event',
    seriesYear: 2026,
    issueNumber: String(issueNumber),
    seriesId: 900,
    candidateIssueId: 9000 + issueNumber,
    manualSeriesSelectionApproved: false,
    resolutionStatus: 'exact',
    candidateIssueIds: [String(9000 + issueNumber)],
    selectedIssueId: 9000 + issueNumber,
    marvelIssueUrl: `https://www.marvel.com/comics/issue/${9000 + issueNumber}/future_event_${issueNumber}`,
    resolvedIssueTitle: `Future Event (2026) #${issueNumber}`,
    note: 'Exact reviewed metadata identity.',
  }));
  const mapping = {
    id,
    inventoryId: id,
    packetDigest: packet.packetDigest,
    sourceUrl: packet.sourceUrl,
    sourceRetrievedAt: packet.sourceRetrievedAt,
    sourceRetrievalStatus: 'retrieved',
    approvedSourceCount: packet.sourceOccurrenceCount ?? rows.length,
    excludedSourceReferences: [],
    ...(packet.sourceOccurrenceCount == null
      ? {}
      : {
        sourceOccurrenceCount: packet.sourceOccurrenceCount,
        repeatedSourceReferences: structuredClone(packet.repeatedSourceReferences),
      }),
    proposedManifest: packet.proposedManifest,
    candidateMetadata: [],
    rows,
  };
  mapping.mappingDigest = mappingDigestFor(mapping);
  return mapping;
}

function genericEvidence({
  relationship = 'none',
  dispositionAuthority = relationship === 'none' ? 'policy' : 'human',
  withPeer = false,
  withRepeat = false,
} = {}) {
  const packet = genericPacket({ withRepeat });
  const mapping = genericMapping(packet);
  const peerMappings = withPeer
    ? [{
      ...genericMapping({
        ...packet,
        packetDigest: 'b'.repeat(64),
      }, 'peer-event'),
      packetDigest: 'b'.repeat(64),
    }]
    : [];
  if (withPeer) peerMappings[0].mappingDigest = mappingDigestFor(peerMappings[0]);
  const peerDigests = Object.fromEntries(peerMappings.map((peer) => [peer.id, peer.mappingDigest]));
  const comparisons = [
    {
      orderId: 'existing',
      relationship,
      sharedCount: relationship === 'none' ? 0 : 1,
      sharedIds: relationship === 'none' ? [] : ['9001'],
    },
    ...(withPeer ? [{
      orderId: 'peer-event',
      relationship: 'none',
      sharedCount: 0,
      sharedIds: [],
    }] : []),
  ];
  const report = {
    candidateId: packet.id,
    packetDigest: packet.packetDigest,
    mappingDigest: mapping.mappingDigest,
    libraryDigest: 'c'.repeat(64),
    peerDigests,
    candidateCount: 2,
    comparisonCount: comparisons.length,
    comparisons,
  };
  report.reportDigest = reportDigestFor(report);
  const reviewedAt = '2026-08-22T13:00:00Z';
  const dispositions = comparisons.map((comparison) => ({
    orderId: comparison.orderId,
    relationship: comparison.relationship,
    decision: 'approved',
    rationale: comparison.relationship === 'none'
      ? 'No shared issues require an exception.'
      : 'The narrower and broader paths serve distinct reviewed purposes.',
    authorityType: comparison.orderId === 'existing' ? dispositionAuthority : 'policy',
    authorityIdentity: comparison.orderId === 'existing' ? 'relationship-reviewer' : 'relationship-policy-v1',
    reviewedAt,
  }));
  const relationshipReview = {
    reportDigest: report.reportDigest,
    packetDigest: packet.packetDigest,
    mappingDigest: mapping.mappingDigest,
    libraryDigest: report.libraryDigest,
    peerDigests,
    dispositions,
    authorityType: 'human',
    authorityIdentity: 'relationship-reviewer',
    rationale: 'Every current library and peer comparison was reviewed.',
    reviewedAt,
  };
  relationshipReview.approvalDigest = approvalDigestFor(relationshipReview);
  Object.assign(mapping, {
    reviewStatus: 'approved',
    packetReview: 'central source review',
    approvedManifest: structuredClone(packet.proposedManifest),
    relationshipReview,
  });
  return {
    packet,
    mapping,
    report,
    peerMappings,
    currentLibraryDigest: report.libraryDigest,
    expectedOrderIds: comparisons.map((comparison) => comparison.orderId),
  };
}

function refreshEvidenceDigests(evidence) {
  evidence.mapping.mappingDigest = mappingDigestFor(evidence.mapping);
  evidence.report.packetDigest = evidence.packet.packetDigest;
  evidence.report.mappingDigest = evidence.mapping.mappingDigest;
  evidence.report.reportDigest = reportDigestFor(evidence.report);
  Object.assign(evidence.mapping.relationshipReview, {
    reportDigest: evidence.report.reportDigest,
    packetDigest: evidence.packet.packetDigest,
    mappingDigest: evidence.mapping.mappingDigest,
  });
  evidence.mapping.relationshipReview.approvalDigest = approvalDigestFor(
    evidence.mapping.relationshipReview,
  );
}

function packetForOccurrenceShape(uniqueCount, repeated) {
  const packet = genericPacket();
  packet.id = 'occurrence-shape';
  packet.inventoryId = packet.id;
  packet.sourceUrl = 'https://www.comicbookherald.com/occurrence-shape/';
  packet.proposedManifest = {
    ...packet.proposedManifest,
    id: packet.id,
    sourceFile: `${packet.id}.md`,
    sourcePage: packet.sourceUrl,
    out: 'occurrence_shape.json',
    expect: uniqueCount,
  };
  packet.expectedCount = uniqueCount;
  packet.rows = Array.from({ length: uniqueCount }, (_, index) => ({
    sourceIssueReference: `Placeholder Series ${index + 1} #1`,
    sourceRangeReference: `Placeholder source block ${index + 1}`,
    normalizedSeriesTitle: `Placeholder Series ${index + 1}`,
    seriesYear: 2000,
    issueNumber: '1',
    seriesId: 100000 + index,
    candidateIssueId: 200000 + index,
    manualSeriesSelectionApproved: false,
    selectionNote: null,
  }));
  for (const item of repeated) {
    const row = packet.rows[item.canonicalRow - 1];
    Object.assign(row, {
      sourceIssueReference: item.sourceIssueReference,
      sourceRangeReference: item.canonicalRangeReference,
      normalizedSeriesTitle: item.normalizedSeriesTitle,
      seriesYear: item.seriesYear,
      issueNumber: item.issueNumber,
    });
  }
  packet.sourceOccurrenceCount = uniqueCount + repeated.length;
  packet.repeatedSourceReferences = repeated.map((item) => {
    const row = packet.rows[item.canonicalRow - 1];
    return {
      sourcePosition: item.sourcePosition,
      canonicalRow: item.canonicalRow,
      sourceIssueReference: item.sourceIssueReference,
      sourceRangeReference: item.repeatedRangeReference,
      normalizedSeriesTitle: row.normalizedSeriesTitle,
      seriesYear: row.seriesYear,
      issueNumber: row.issueNumber,
    };
  });
  packet.packetDigest = packetDigestFor(packet);
  return packet;
}

test('open source gaps close only as the same exact identity or an availability exclusion', () => {
  const openPacket = genericGapPacket();
  const exactPacket = genericPacket();
  const exactMapping = genericMapping(exactPacket);
  assert.doesNotThrow(() => assertGapTransition(openPacket, exactPacket, exactMapping));

  const yearlessGap = structuredClone(openPacket);
  yearlessGap.sourceGaps[0].seriesYear = null;
  yearlessGap.sourceGaps[0].evidenceDigest = gapEvidenceDigestFor(yearlessGap.sourceGaps[0]);
  yearlessGap.packetDigest = packetDigestFor(yearlessGap);
  assert.doesNotThrow(() => validateFrozenPacket(yearlessGap));
  assert.notEqual(yearlessGap.sourceGaps[0].evidenceDigest, openPacket.sourceGaps[0].evidenceDigest);

  const unavailablePacket = genericGapPacket('availability-exclusion');
  const unavailableMapping = genericGapMapping(unavailablePacket);
  assert.doesNotThrow(() => assertGapTransition(openPacket, unavailablePacket, unavailableMapping));

  assert.throws(
    () => assertGapTransition(unavailablePacket, exactPacket, exactMapping),
    /closed source gap.*cannot become exact/i,
  );

  const changedIdentity = structuredClone(unavailablePacket);
  changedIdentity.sourceGaps[0].issueNumber = '3';
  changedIdentity.sourceGaps[0].evidenceDigest = gapEvidenceDigestFor(changedIdentity.sourceGaps[0]);
  changedIdentity.packetDigest = packetDigestFor(changedIdentity);
  assert.throws(
    () => assertGapTransition(openPacket, changedIdentity, genericGapMapping(changedIdentity)),
    /changed identity or disposition/i,
  );
});

test('the final Thanos artifacts conserve every source position and publish only dispositioned issues', async () => {
  const packet = await readJson(path.join(root, 'scripts', 'data', 'cbh-packets', 'thanos-reading-order.json'));
  const mapping = await readJson(path.join(mappingsDir, 'thanos-reading-order.json'));
  const report = await readJson(path.join(overlapsDir, 'thanos-reading-order.json'));
  const payload = await readJson(path.join(dataDir, 'thanos_reading_order.json'));
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const markdown = await readFile(path.join(dataDir, 'orders', 'thanos-reading-order.md'), 'utf8');
  const exclusions = [
    "Logan's Run #6",
    'Spidey Super Stories #39',
    'Deathlok #16',
    'Silver Sable & The Wild Pack #4',
    'Silver Sable & The Wild Pack #5',
    'Nomad #7',
    'Sleepwalker #18',
  ];
  const sparseIssueIds = [18261, 18262, 18263, 12648, 12650, 12651, 12652, 18925, 18926, 18927, 18929, 23490];
  const resolvedPositions = [
    [114, 18261],
    [115, 18262],
    [116, 18263],
    [117, 12650],
    [118, 12651],
    [119, 12652],
    [125, 18925],
    [126, 18926],
    [127, 18927],
    [128, 18929],
    [137, 12648],
    [176, 23490],
  ];

  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.deepEqual({
    occurrences: packet.sourceOccurrenceCount,
    identities: packet.rows.length + packet.sourceGaps.length,
    published: packet.rows.length,
    exclusions: packet.sourceGaps.length,
    repeats: packet.repeatedSourceReferences.length,
  }, {
    occurrences: 321,
    identities: 279,
    published: 272,
    exclusions: 7,
    repeats: 42,
  });
  assert.deepEqual(packet.sourceGaps.map((gap) => gap.sourceIssueReference), exclusions);
  assert.ok(packet.sourceGaps.every((gap) => gap.kind === 'availability-exclusion' && gap.status === 'closed'));
  assert.deepEqual(report.sourceCounts, mapping.relationshipReview.sourceCounts);
  assert.equal(report.comparisonCount, 137);
  assert.equal(mapping.relationshipReview.dispositions.length, 137);
  assert.equal(mapping.rows.length, 272);
  assert.deepEqual(
    mapping.rows
      .filter((row) => sparseIssueIds.includes(Number(row.selectedIssueId)))
      .map((row) => [row.sourcePosition, Number(row.selectedIssueId)]),
    resolvedPositions,
  );
  assert.equal(payload.items.length, 272);
  assert.equal(manifest.lists.find((entry) => entry.id === packet.id).expect, 272);
  assert.deepEqual(
    payload.items.filter((item) => sparseIssueIds.includes(item.issueId)).map((item) => item.issueId).sort((a, b) => a - b),
    [...sparseIssueIds].sort((a, b) => a - b),
  );
  for (const exclusion of exclusions) {
    assert.equal(markdown.includes(exclusion), false, `${exclusion} leaked into the published checklist`);
  }
});

test('repeated source references stay explicit, canonical, fresh, and unique', () => {
  const evidence = genericEvidence({ withRepeat: true });
  assert.doesNotThrow(() => validateFrozenPacket(evidence.packet));
  assert.deepEqual(sourcePositionsForPacket(evidence.packet), [1, 3]);
  assert.equal(evidence.mapping.approvedSourceCount, 3);
  assert.deepEqual(evidence.mapping.rows.map((row) => row.sourcePosition), [1, 3]);
  assert.doesNotThrow(() => assertApprovedRelationshipReview(evidence));

  const markdown = buildMarkdown(evidence.mapping);
  assert.match(markdown, /3 issue occurrences, including 1 intentional repeat.*lists each distinct comic once at its first source occurrence/);
  assert.match(markdown, /No source commentary or images are copied\./);
  assert.equal(parseChecklist(markdown).entries.length, 2);

  const oldPacket = genericPacket();
  assert.equal(Object.hasOwn(oldPacket, 'sourceOccurrenceCount'), false);
  assert.equal(packetDigestFor(oldPacket), oldPacket.packetDigest);
  assert.equal(buildMarkdown(genericEvidence().mapping).includes('intentional repeats'), false);

  const groupedMapping = structuredClone(evidence.mapping);
  groupedMapping.rows[0].sourceGroup = 'First source section';
  groupedMapping.rows[1].sourceGroup = 'Second source section';
  const groupedMarkdown = buildMarkdown(groupedMapping);
  assert.match(groupedMarkdown, /## First source section\n- \[ \]/);
  assert.match(groupedMarkdown, /## Second source section\n- \[ \]/);

  const halfPresent = structuredClone(evidence.packet);
  delete halfPresent.repeatedSourceReferences;
  halfPresent.packetDigest = packetDigestFor(halfPresent);
  assert.throws(() => validateFrozenPacket(halfPresent), /must appear together/i);

  const inverseHalfPresent = structuredClone(evidence.packet);
  delete inverseHalfPresent.sourceOccurrenceCount;
  inverseHalfPresent.packetDigest = packetDigestFor(inverseHalfPresent);
  assert.throws(() => validateFrozenPacket(inverseHalfPresent), /must appear together/i);

  const empty = structuredClone(evidence.packet);
  empty.repeatedSourceReferences = [];
  empty.sourceOccurrenceCount = 2;
  empty.packetDigest = packetDigestFor(empty);
  assert.throws(() => validateFrozenPacket(empty), /must be a non-empty array/i);

  const wrongCount = structuredClone(evidence.packet);
  wrongCount.sourceOccurrenceCount = 4;
  wrongCount.packetDigest = packetDigestFor(wrongCount);
  assert.throws(() => validateFrozenPacket(wrongCount), /must equal exact rows plus supplemental source rows/i);

  const forward = structuredClone(evidence.packet);
  forward.repeatedSourceReferences[0].canonicalRow = 2;
  forward.packetDigest = packetDigestFor(forward);
  assert.throws(() => validateFrozenPacket(forward), /must target an earlier canonical row/i);

  const duplicatePosition = structuredClone(evidence.packet);
  duplicatePosition.sourceOccurrenceCount = 4;
  duplicatePosition.repeatedSourceReferences.push({
    ...structuredClone(duplicatePosition.repeatedSourceReferences[0]),
    canonicalRow: 1,
  });
  duplicatePosition.packetDigest = packetDigestFor(duplicatePosition);
  assert.throws(() => validateFrozenPacket(duplicatePosition), /duplicate repeated source position/i);

  const outOfRangePosition = structuredClone(evidence.packet);
  outOfRangePosition.repeatedSourceReferences[0].sourcePosition = 4;
  outOfRangePosition.packetDigest = packetDigestFor(outOfRangePosition);
  assert.throws(() => validateFrozenPacket(outOfRangePosition), /outside the source occurrence count/i);

  const outOfRangeCanonicalRow = structuredClone(evidence.packet);
  outOfRangeCanonicalRow.repeatedSourceReferences[0].canonicalRow = 3;
  outOfRangeCanonicalRow.packetDigest = packetDigestFor(outOfRangeCanonicalRow);
  assert.throws(() => validateFrozenPacket(outOfRangeCanonicalRow), /must name a canonical packet row/i);

  const identityMismatch = structuredClone(evidence.packet);
  identityMismatch.repeatedSourceReferences[0].issueNumber = '2';
  identityMismatch.packetDigest = packetDigestFor(identityMismatch);
  assert.throws(() => validateFrozenPacket(identityMismatch), /issueNumber differs from canonical row/i);

  const missingField = structuredClone(evidence.packet);
  delete missingField.repeatedSourceReferences[0].sourceIssueReference;
  missingField.packetDigest = packetDigestFor(missingField);
  assert.throws(() => validateFrozenPacket(missingField), /missing required fields: sourceIssueReference/i);

  const emptyIssueReference = structuredClone(evidence.packet);
  emptyIssueReference.repeatedSourceReferences[0].sourceIssueReference = ' ';
  emptyIssueReference.packetDigest = packetDigestFor(emptyIssueReference);
  assert.throws(() => validateFrozenPacket(emptyIssueReference), /sourceIssueReference must be a non-empty string/i);

  const invalidRangeReference = structuredClone(evidence.packet);
  invalidRangeReference.repeatedSourceReferences[0].sourceRangeReference = 42;
  invalidRangeReference.packetDigest = packetDigestFor(invalidRangeReference);
  assert.throws(() => validateFrozenPacket(invalidRangeReference), /sourceRangeReference must be a non-empty string/i);

  const unsupportedField = structuredClone(evidence.packet);
  unsupportedField.repeatedSourceReferences[0].reason = 'Already represented';
  unsupportedField.packetDigest = packetDigestFor(unsupportedField);
  assert.throws(() => validateFrozenPacket(unsupportedField), /unsupported fields: reason/i);

  const accidentalDuplicate = genericPacket();
  accidentalDuplicate.rows[1] = structuredClone(accidentalDuplicate.rows[0]);
  accidentalDuplicate.packetDigest = packetDigestFor(accidentalDuplicate);
  assert.throws(() => validateFrozenPacket(accidentalDuplicate), /duplicate canonical packet identity/i);

  const stalePacket = structuredClone(evidence.packet);
  stalePacket.repeatedSourceReferences[0].sourceRangeReference = 'Changed later';
  assert.throws(() => validateFrozenPacket(stalePacket), /packet digest is stale/i);

  const wrongPosition = genericEvidence({ withRepeat: true });
  wrongPosition.mapping.rows[1].sourcePosition = 2;
  refreshEvidenceDigests(wrongPosition);
  assert.throws(
    () => assertApprovedRelationshipReview(wrongPosition),
    /mapping row 2 sourcePosition differs from its frozen packet/i,
  );

  const wrongApprovedCount = genericEvidence({ withRepeat: true });
  wrongApprovedCount.mapping.approvedSourceCount = 2;
  refreshEvidenceDigests(wrongApprovedCount);
  assert.throws(
    () => assertApprovedRelationshipReview(wrongApprovedCount),
    /approvedSourceCount differs from its frozen source occurrence count/i,
  );

  const divergentMirror = genericEvidence({ withRepeat: true });
  divergentMirror.mapping.repeatedSourceReferences[0].sourceRangeReference = 'Different source block';
  refreshEvidenceDigests(divergentMirror);
  assert.throws(
    () => assertApprovedRelationshipReview(divergentMirror),
    /mapping source position evidence differs from its frozen packet/i,
  );
});

test('excluded source rows conserve exact positions without changing legacy packets', () => {
  const packet = packetForOccurrenceShape(2, []);
  delete packet.repeatedSourceReferences;
  packet.sourceOccurrenceCount = 3;
  packet.excludedSourceRows = [{
    sourcePosition: 2,
    sourceIssueReference: 'Licensed Tie-In #1',
    reason: 'User-approved guide-scoped exclusion.',
    decisionScope: 'test-release',
  }];
  packet.packetDigest = packetDigestFor(packet);
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.deepEqual(sourcePositionsForPacket(packet), [1, 3]);
  assert.equal(sourceOccurrenceCountFor(packet), 3);

  const wrongCount = structuredClone(packet);
  wrongCount.sourceOccurrenceCount = 2;
  wrongCount.packetDigest = packetDigestFor(wrongCount);
  assert.throws(
    () => validateFrozenPacket(wrongCount),
    /exact rows plus supplemental source rows/i,
  );

  const duplicatePosition = structuredClone(packet);
  duplicatePosition.sourceOccurrenceCount = 4;
  duplicatePosition.excludedSourceRows.push({
    ...duplicatePosition.excludedSourceRows[0],
    sourceIssueReference: 'Licensed Tie-In #2',
  });
  duplicatePosition.packetDigest = packetDigestFor(duplicatePosition);
  assert.throws(
    () => validateFrozenPacket(duplicatePosition),
    /duplicate supplemental source position/i,
  );

  const unordered = structuredClone(packet);
  unordered.sourceOccurrenceCount = 4;
  unordered.excludedSourceRows = [
    { ...unordered.excludedSourceRows[0], sourcePosition: 3 },
    {
      ...unordered.excludedSourceRows[0],
      sourcePosition: 2,
      sourceIssueReference: 'Licensed Tie-In #2',
    },
  ];
  unordered.packetDigest = packetDigestFor(unordered);
  assert.throws(() => validateFrozenPacket(unordered), /must be in sourcePosition order/i);

  const unsupported = structuredClone(packet);
  unsupported.excludedSourceRows[0].marvelIssueId = 1;
  unsupported.packetDigest = packetDigestFor(unsupported);
  assert.throws(() => validateFrozenPacket(unsupported), /unsupported fields: marvelIssueId/i);

  const missingScope = structuredClone(packet);
  delete missingScope.excludedSourceRows[0].decisionScope;
  missingScope.packetDigest = packetDigestFor(missingScope);
  assert.throws(() => validateFrozenPacket(missingScope), /missing required fields: decisionScope/i);

  const legacy = genericPacket();
  assert.equal(Object.hasOwn(legacy, 'sourceOccurrenceCount'), false);
  assert.equal(Object.hasOwn(legacy, 'excludedSourceRows'), false);
  assert.deepEqual(sourcePositionsForPacket(legacy), [1, 2]);
});

test('the three blocked source shapes reconstruct one unique first-occurrence sequence', () => {
  const ironMan = packetForOccurrenceShape(813, [
    {
      sourcePosition: 716,
      canonicalRow: 708,
      sourceIssueReference: 'Tony Stark: Iron Man #15',
      canonicalRangeReference: 'Tony Stark: Iron Man #12 to #16',
      repeatedRangeReference: 'Tony Stark: Iron Man #15 to #19',
      normalizedSeriesTitle: 'Tony Stark: Iron Man',
      seriesYear: 2018,
      issueNumber: '15',
    },
    {
      sourcePosition: 717,
      canonicalRow: 709,
      sourceIssueReference: 'Tony Stark: Iron Man #16',
      canonicalRangeReference: 'Tony Stark: Iron Man #12 to #16',
      repeatedRangeReference: 'Tony Stark: Iron Man #15 to #19',
      normalizedSeriesTitle: 'Tony Stark: Iron Man',
      seriesYear: 2018,
      issueNumber: '16',
    },
  ]);
  const oldManLogan = packetForOccurrenceShape(96, [
    {
      sourcePosition: 47,
      canonicalRow: 39,
      sourceIssueReference: 'Old Man Logan #19',
      canonicalRangeReference: 'Old Man Logan #14 to #19',
      repeatedRangeReference: 'Old Man Logan #19 to #25',
      normalizedSeriesTitle: 'Old Man Logan',
      seriesYear: 2016,
      issueNumber: '19',
    },
    {
      sourcePosition: 60,
      canonicalRow: 52,
      sourceIssueReference: 'Old Man Logan #25',
      canonicalRangeReference: 'Old Man Logan #19 to #25',
      repeatedRangeReference: 'Old Man Logan #25 to #30',
      normalizedSeriesTitle: 'Old Man Logan',
      seriesYear: 2016,
      issueNumber: '25',
    },
  ]);
  const planetHulkRows = [27, 29, 31, 34, 36];
  const planetHulk = packetForOccurrenceShape(104, planetHulkRows.map((canonicalRow, index) => ({
    sourcePosition: 39 + index,
    canonicalRow,
    sourceIssueReference: `World War Hulk #${index + 1}`,
    canonicalRangeReference: 'The explicit Greg Pak interleaved order',
    repeatedRangeReference: 'World War Hulk #1 to #5',
    normalizedSeriesTitle: 'World War Hulk',
    seriesYear: 2007,
    issueNumber: String(index + 1),
  })));

  for (const packet of [ironMan, oldManLogan, planetHulk]) {
    assert.doesNotThrow(() => validateFrozenPacket(packet));
    assert.equal(
      packet.sourceOccurrenceCount,
      packet.rows.length + packet.repeatedSourceReferences.length,
    );
  }
  const ironPositions = sourcePositionsForPacket(ironMan);
  assert.equal(ironPositions[709], 710);
  assert.equal(ironPositions[715], 718);
  const oldManPositions = sourcePositionsForPacket(oldManLogan);
  assert.equal(oldManPositions[38], 39);
  assert.equal(oldManPositions[46], 48);
  assert.equal(oldManPositions[51], 53);
  assert.equal(oldManPositions[58], 61);
  const planetPositions = sourcePositionsForPacket(planetHulk);
  assert.equal(planetPositions[35], 36);
  assert.equal(planetPositions[38], 44);
});

test('the approved Comic Book Herald packet stays exact through every generated surface', async () => {
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbh-modern-inventory.json'));
  assert.equal(
    existingEntriesForPacket(manifest.lists, PACKET_IDS).length,
    manifest.lists.length - PACKET_IDS.length,
  );

  for (const id of PACKET_IDS) {
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const approved = manifestEntryForMapping(mapping);
    const manifestEntry = manifest.lists.find((entry) => entry.id === id);
    const catalogEntry = catalog.lists.find((entry) => entry.id === id);
    const markdown = await readFile(path.join(dataDir, 'orders', approved.sourceFile), 'utf8');
    const parsed = parseChecklist(markdown);
    const generated = await readJson(path.join(dataDir, approved.out));
    const expectedIds = mappingIds(mapping);
    const inventoryEntry = inventory.find((entry) => entry.id === id);
    const candidatesById = new Map(mapping.candidateMetadata.map((candidate) => (
      [String(candidate.id), candidate]
    )));

    assert.ok(manifestEntry, `${id} is missing from the curated manifest`);
    assert.ok(catalogEntry, `${id} is missing from the generated catalog`);
    assert.equal(mapping.reviewStatus, 'approved');
    assert.equal(inventoryEntry.deliveryStatus, 'shipped');
    assert.deepEqual(inventoryEntry.catalogIds, [id]);
    assert.deepEqual(inventoryEntry.overlapIds, []);
    assert.match(inventoryEntry.reason, /^Shipped:/);
    for (const row of mapping.rows) {
      const candidate = candidatesById.get(String(row.selectedIssueId));
      if (!candidate?.manualSeriesSelection) continue;
      assert.equal(candidate.manualSeriesSelectionApproved, true, `${id} has an unapproved series-title mismatch`);
      assert.equal(row.manualSeriesSelectionApproved, true, `${id} row lacks explicit manual series approval`);
      assert.ok(row.note.trim(), `${id} manual series selection has no note`);
    }
    assert.equal(mapping.packetReview, '.copilot-tracking/reviews/logs/2026-08-21/modern-marvel-continuity-guides-packet-review.md');
    assert.deepEqual(manifestEntry, approved, `${id} manifest fields differ from the approved packet`);
    assert.equal(Object.hasOwn(manifestEntry, 'coverSourcePosition'), false);
    assert.equal(Object.hasOwn(manifestEntry, 'coverSourceReference'), false);
    assert.equal(parsed.unresolved.length, 0, `${id} has unresolved Markdown rows`);
    assert.equal(/^## /m.test(markdown), false, `${id} invents an unapproved grouping heading`);
    assert.deepEqual(parsed.entries.map((entry) => String(entry.issueId)), expectedIds, `${id} Markdown sequence drifted`);
    assert.deepEqual(generated.items.map((item) => String(item.issueId)), expectedIds, `${id} generated sequence drifted`);
    assert.equal(generated.count, expectedIds.length);
    assert.equal(generated.placeholders, 0);
    assert.deepEqual(generated.unresolved, []);
    assert.deepEqual(
      generated.items.map((item) => String(item.number)),
      mapping.rows.map((row) => String(row.issueNumber)),
      `${id} generated issue numbers differ from the approved mapping`,
    );
    assert.equal(catalogEntry.count, expectedIds.length);
    assert.equal(catalogEntry.source, mapping.sourceUrl);
    assert.equal(catalogEntry.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
    assert.equal(catalogEntry.sourceLicense, null);
    assert.equal(catalogEntry.coverIssueId, approved.coverIssueId);
  }
});

test('authoring requires one clean overlap row for every expected order identity', () => {
  const expectedOrderIds = ['existing-order', 'packet-peer'];
  const valid = {
    candidateCount: 1,
    comparisonCount: 2,
    comparisons: expectedOrderIds.map((orderId) => ({
      orderId,
      relationship: 'none',
      sharedCount: 0,
      sharedIds: [],
    })),
  };

  assert.doesNotThrow(() => assertCompleteOverlapReport(valid, {
    candidateId: 'candidate',
    candidateCount: 1,
    expectedOrderIds,
  }));
  assert.throws(() => assertCompleteOverlapReport({
    ...valid,
    comparisons: [],
  }, {
    candidateId: 'candidate',
    candidateCount: 1,
    expectedOrderIds,
  }), /overlap report is incomplete/i);
  assert.throws(() => assertCompleteOverlapReport({
    ...valid,
    comparisons: [
      valid.comparisons[0],
      { ...valid.comparisons[1], orderId: 'unexpected-order' },
    ],
  }, {
    candidateId: 'candidate',
    candidateCount: 1,
    expectedOrderIds,
  }), /overlap report is incomplete/i);
});

test('the original authored packet keeps its identities, sequence, and pre-publication overlap evidence', async () => {
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const packetSet = new Set(PACKET_IDS);
  const packetRecords = [];
  const existingRecords = [];
  const packetIssueIds = [];

  for (const entry of manifest.lists) {
    const generated = await readJson(path.join(dataDir, entry.out));
    const record = {
      id: entry.id,
      url: entry.sourcePage,
      selectedIssueIds: generated.items.map((item) => String(item.issueId)),
      catalogIds: [entry.id],
    };
    if (packetSet.has(entry.id)) {
      packetRecords.push(record);
      packetIssueIds.push(...record.selectedIssueIds);
    } else {
      existingRecords.push(record);
    }
  }

  assert.equal(packetRecords.length, 10);
  assert.equal(packetIssueIds.length, 238);
  assert.equal(new Set(packetIssueIds).size, 238);
  assert.doesNotThrow(() => validateBatchNoDuplicates(packetRecords, existingRecords));
  const allowedOverlaps = new Map([
    ['axis', [
      {
        orderId: 'white-tiger-ava-ayala',
        relationship: 'partial',
        sharedCount: 4,
        sharedIds: ['48592', '51049', '51550', '51158'],
      },
    ]],
  ]);

  for (const id of PACKET_IDS) {
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    assert.equal(report.comparisonCount, 134, `${id} overlap boundary changed`);
    assert.equal(report.candidateCount, packetRecords.find((record) => record.id === id).selectedIssueIds.length);
    assert.equal(report.comparisons.length, 134);
    const allowed = allowedOverlaps.get(id) ?? [];
    assert.ok(report.comparisons.every((comparison) => {
      const expected = allowed.find((entry) => entry.orderId === comparison.orderId);
      if (expected) {
        return comparison.relationship === expected.relationship
          && comparison.sharedCount === expected.sharedCount
          && JSON.stringify(comparison.sharedIds) === JSON.stringify(expected.sharedIds);
      }
      return comparison.relationship === 'none'
        && comparison.sharedCount === 0
        && comparison.sharedIds.length === 0;
    }), `${id} has an unapproved semantic overlap`);
  }
});

test('approved generic evidence stays current through named chronology insertion', () => {
  const evidence = genericEvidence();
  assert.doesNotThrow(() => assertApprovedRelationshipReview(evidence));
  assert.deepEqual(authorIdsFromArgs(['--only=future-event']), ['future-event']);
  assert.deepEqual(peerIdsFromArgs(['--peer=peer-event']), ['peer-event']);
  const entry = manifestEntryForMapping(evidence.mapping);
  const merged = mergePacketEntries(
    [{ id: 'before' }, { id: 'chronology-anchor' }, { id: 'after' }],
    [entry],
    { 'future-event': evidence.packet.insertionAnchor },
  );
  assert.deepEqual(merged.map((item) => item.id), [
    'before',
    'future-event',
    'chronology-anchor',
    'after',
  ]);
});

test('one-guide authoring keeps a shipped external peer outside the reviewed library', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'mrt-author-peer-'));
  const mappingsDir = path.join(tempDir, 'mappings');
  const overlapsDir = path.join(tempDir, 'overlaps');
  const packetsDir = path.join(tempDir, 'packets');
  const ordersDir = path.join(tempDir, 'orders');
  const payloadDir = path.join(tempDir, 'payloads');
  const manifestFile = path.join(tempDir, 'curated-lists.json');

  try {
    await Promise.all([
      mkdir(mappingsDir),
      mkdir(overlapsDir),
      mkdir(packetsDir),
      mkdir(ordersDir),
      mkdir(payloadDir),
    ]);
    const evidence = genericEvidence({ withPeer: true, withRepeat: true });
    const peerMapping = evidence.peerMappings[0];
    const manifestEntry = (id, out, sourcePage) => ({
      id,
      name: id,
      description: `The ${id} fixture.`,
      type: 'event',
      depth: 'complete',
      beginner: false,
      group: null,
      groupName: null,
      variant: null,
      sourceFile: `${id}.md`,
      sourcePage,
      sourceOrigin: "Compiled for this project from Comic Book Herald's guide",
      sourceLicense: null,
      out,
      characters: ['Tester'],
      keywords: [id],
      expect: 1,
      timeline: 2025,
      coverIssueId: 1,
    });
    const existingEntry = manifestEntry(
      'existing',
      'existing.json',
      'https://www.comicbookherald.com/existing/',
    );
    const peerEntry = manifestEntry(
      'peer-event',
      'peer_event.json',
      'https://www.comicbookherald.com/peer-event/',
    );
    const manifest = { version: 1, lists: [existingEntry, peerEntry], paths: [] };
    const libraryDigest = libraryDigestFor(
      { ...manifest, lists: [existingEntry] },
      [{ id: 'existing', issueIds: ['7001'] }],
    );

    evidence.packet.insertionAnchor = { beforeId: 'existing' };
    evidence.packet.packetDigest = packetDigestFor(evidence.packet);
    Object.assign(evidence.mapping, {
      packetDigest: evidence.packet.packetDigest,
      proposedManifest: structuredClone(evidence.packet.proposedManifest),
      approvedManifest: structuredClone(evidence.packet.proposedManifest),
    });
    evidence.mapping.mappingDigest = mappingDigestFor(evidence.mapping);
    Object.assign(evidence.report, {
      packetDigest: evidence.packet.packetDigest,
      mappingDigest: evidence.mapping.mappingDigest,
      libraryDigest,
    });
    evidence.report.reportDigest = reportDigestFor(evidence.report);
    Object.assign(evidence.mapping.relationshipReview, {
      reportDigest: evidence.report.reportDigest,
      packetDigest: evidence.packet.packetDigest,
      mappingDigest: evidence.mapping.mappingDigest,
      libraryDigest,
    });
    evidence.mapping.relationshipReview.approvalDigest = approvalDigestFor(
      evidence.mapping.relationshipReview,
    );

    await Promise.all([
      writeFile(
        path.join(packetsDir, 'future-event.json'),
        JSON.stringify(evidence.packet),
        'utf8',
      ),
      writeFile(
        path.join(mappingsDir, 'future-event.json'),
        JSON.stringify(evidence.mapping),
        'utf8',
      ),
      writeFile(
        path.join(mappingsDir, 'peer-event.json'),
        JSON.stringify(peerMapping),
        'utf8',
      ),
      writeFile(
        path.join(overlapsDir, 'future-event.json'),
        JSON.stringify(evidence.report),
        'utf8',
      ),
      writeFile(manifestFile, JSON.stringify(manifest), 'utf8'),
      writeFile(
        path.join(payloadDir, 'existing.json'),
        JSON.stringify({ items: [{ issueId: 7001 }] }),
        'utf8',
      ),
      writeFile(
        path.join(payloadDir, 'peer_event.json'),
        JSON.stringify({ items: [{ issueId: 9001 }, { issueId: 9002 }] }),
        'utf8',
      ),
    ]);

    const summary = await authorPacket(['future-event'], {
      mappingsDir,
      overlapsDir,
      packetsDir,
      ordersDir,
      manifestFile,
      payloadDir,
      peerIds: ['peer-event'],
    });
    assert.deepEqual(summary, { guides: 1, rows: 2, manifestEntries: 3 });
    const authoredManifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    assert.deepEqual(
      authoredManifest.lists.find((entry) => entry.id === 'peer-event'),
      peerEntry,
    );
    await writeFile(
      path.join(payloadDir, 'future_event.json'),
      JSON.stringify({ items: [{ issueId: 9001 }, { issueId: 9002 }] }),
      'utf8',
    );

    const wrongPosition = {
      ...evidence,
      mapping: structuredClone(evidence.mapping),
      report: structuredClone(evidence.report),
    };
    wrongPosition.mapping.rows[1].sourcePosition = 2;
    refreshEvidenceDigests(wrongPosition);
    await writeFile(
      path.join(mappingsDir, 'future-event.json'),
      JSON.stringify(wrongPosition.mapping),
      'utf8',
    );
    await writeFile(
      path.join(overlapsDir, 'future-event.json'),
      JSON.stringify(wrongPosition.report),
      'utf8',
    );
    await assert.rejects(
      () => authorPacket(['future-event'], {
        mappingsDir,
        overlapsDir,
        packetsDir,
        ordersDir,
        manifestFile,
        payloadDir,
        peerIds: ['peer-event'],
      }),
      /mapping row 2 sourcePosition differs from its frozen packet/i,
    );
    await writeFile(
      path.join(mappingsDir, 'future-event.json'),
      JSON.stringify(evidence.mapping),
      'utf8',
    );
    await writeFile(
      path.join(overlapsDir, 'future-event.json'),
      JSON.stringify(evidence.report),
      'utf8',
    );

    const stalePeer = structuredClone(peerMapping);
    stalePeer.rows[0].selectedIssueId = 9999;
    await writeFile(
      path.join(mappingsDir, 'peer-event.json'),
      JSON.stringify(stalePeer),
      'utf8',
    );
    await assert.rejects(
      () => authorPacket(['future-event'], {
        mappingsDir,
        overlapsDir,
        packetsDir,
        ordersDir,
        manifestFile,
        payloadDir,
        peerIds: ['peer-event'],
      }),
      /mapping digest is stale/i,
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('exact relationships have no approval path', () => {
  const evidence = genericEvidence({ relationship: 'exact', dispositionAuthority: 'human' });
  assert.throws(
    () => assertApprovedRelationshipReview(evidence),
    /exactly duplicates.+no approval path/i,
  );
});

test('either subset direction can pass only with central authority', () => {
  for (const relationship of ['candidate-subset', 'existing-subset']) {
    const approved = genericEvidence({ relationship, dispositionAuthority: 'stronger-model' });
    assert.doesNotThrow(() => assertApprovedRelationshipReview(approved));
    const worker = genericEvidence({ relationship, dispositionAuthority: 'lower-cost-worker' });
    assert.throws(
      () => assertApprovedRelationshipReview(worker),
      /unauthorized authority type/i,
    );
  }
});

test('partial overlap requires stronger-model or human disposition', () => {
  const approved = genericEvidence({ relationship: 'partial', dispositionAuthority: 'human' });
  assert.doesNotThrow(() => assertApprovedRelationshipReview(approved));
  const policyOnly = genericEvidence({ relationship: 'partial', dispositionAuthority: 'policy' });
  assert.throws(
    () => assertApprovedRelationshipReview(policyOnly),
    /unauthorized authority type/i,
  );
});

test('authoring rejects packet, mapping, report, library, or peer freshness drift', () => {
  const sourceDrift = genericEvidence();
  sourceDrift.packet.sourceBoundary = 'A changed source boundary.';
  assert.throws(() => assertApprovedRelationshipReview(sourceDrift), /packet digest is stale/i);

  const mappingDrift = genericEvidence();
  mappingDrift.mapping.rows[0].selectedIssueId = 9999;
  assert.throws(() => assertApprovedRelationshipReview(mappingDrift), /mapping digest is stale/i);

  const reportDrift = genericEvidence();
  reportDrift.report.comparisons[0].sharedCount = 2;
  assert.throws(() => assertApprovedRelationshipReview(reportDrift), /report digest is stale/i);

  const libraryDrift = genericEvidence();
  libraryDrift.currentLibraryDigest = 'd'.repeat(64);
  assert.throws(() => assertApprovedRelationshipReview(libraryDrift), /library changed/i);

  const peerDrift = genericEvidence({ withPeer: true });
  peerDrift.peerMappings[0].rows[0].selectedIssueId = 9999;
  assert.throws(() => assertApprovedRelationshipReview(peerDrift), /mapping digest is stale/i);
});

test('authoring rejects disposition or approved-manifest drift after approval', () => {
  const dispositionDrift = genericEvidence();
  dispositionDrift.mapping.relationshipReview.dispositions[0].rationale = 'Changed later.';
  assert.throws(() => assertApprovedRelationshipReview(dispositionDrift), /approval digest is stale/i);

  const manifestDrift = genericEvidence();
  manifestDrift.mapping.approvedManifest.name = 'Changed later';
  assert.throws(() => assertApprovedRelationshipReview(manifestDrift), /approved manifest differs/i);
});
