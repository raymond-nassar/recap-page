import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FIRST_PACKET_IDS,
  assertApprovedRelationshipReview,
  assertCompleteOverlapReport,
  authorIdsFromArgs,
  existingEntriesForPacket,
  manifestEntryForMapping,
  mergePacketEntries,
} from '../scripts/author-cbh-packet.mjs';
import {
  approvalDigestFor,
  mappingDigestFor,
  packetDigestFor,
  reportDigestFor,
  validateBatchNoDuplicates,
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

function genericPacket() {
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
  packet.packetDigest = packetDigestFor(packet);
  return packet;
}

function genericMapping(packet, id = packet.id) {
  const rows = [1, 2].map((issueNumber, index) => ({
    sourcePosition: index + 1,
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
    approvedSourceCount: rows.length,
    excludedSourceReferences: [],
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
} = {}) {
  const packet = genericPacket();
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

test('the approved Comic Book Herald packet stays exact through every generated surface', async () => {
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbh-modern-inventory.json'));
  assert.equal(existingEntriesForPacket(manifest.lists, PACKET_IDS).length, 56);

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

test('the authored packet has no aggregate identity, sequence, or issue overlap', async () => {
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

  const existingIssueIds = new Set(existingRecords.flatMap((record) => record.selectedIssueIds));
  assert.deepEqual(packetIssueIds.filter((id) => existingIssueIds.has(id)), []);

  for (const id of PACKET_IDS) {
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    assert.equal(report.comparisonCount, 35, `${id} overlap boundary changed`);
    assert.equal(report.candidateCount, packetRecords.find((record) => record.id === id).selectedIssueIds.length);
    assert.equal(report.comparisons.length, 35);
    assert.ok(report.comparisons.every((comparison) => (
      comparison.relationship === 'none'
      && comparison.sharedCount === 0
      && comparison.sharedIds.length === 0
    )), `${id} has an unapproved semantic overlap`);
  }
});

test('approved generic evidence stays current through named chronology insertion', () => {
  const evidence = genericEvidence();
  assert.doesNotThrow(() => assertApprovedRelationshipReview(evidence));
  assert.deepEqual(authorIdsFromArgs(['--only=future-event']), ['future-event']);
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
