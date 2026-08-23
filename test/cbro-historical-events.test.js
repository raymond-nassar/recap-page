import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertApprovedRelationshipReview,
} from '../scripts/author-cbh-packet.mjs';
import {
  CBRO_AUTHOR_IDS,
} from '../scripts/author-cbro-packet.mjs';
import {
  CBH_SOURCE_PROVIDER,
  approvalDigestFor,
  libraryDigestExcludingOrders,
  mappingDigestFor,
  packetDigestFor,
  reportDigestFor,
  validateBatchNoDuplicates,
  validateFrozenPacket,
  validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import {
  CBRO_SELECTED_IDS,
  CBRO_SOURCE_ORIGIN,
  CBRO_SOURCE_PROVIDER,
  validateCbroHistoricalInventory,
  validateCbroPacket,
} from '../scripts/lib/cbro-evidence.mjs';
import { loadLibrarySnapshot } from '../scripts/report-order-overlap.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'src', 'data');
const packetsDir = path.join(root, 'scripts', 'data', 'cbro-packets');
const mappingsDir = path.join(root, 'scripts', 'data', 'cbro-mappings');
const overlapsDir = path.join(root, 'scripts', 'data', 'cbro-overlaps');

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

function cbroPacket() {
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
  packet.packetDigest = packetDigestFor(packet);
  return packet;
}

function cbroEvidence({
  relationship = 'none',
  dispositionAuthority = relationship === 'none' ? 'policy' : 'stronger-model',
} = {}) {
  const packet = cbroPacket();
  const mapping = {
    id: packet.id,
    inventoryId: packet.inventoryId,
    packetDigest: packet.packetDigest,
    sourceProvider: packet.sourceProvider,
    sourceUrl: packet.sourceUrl,
    sourceRetrievedAt: packet.sourceRetrievedAt,
    sourceContentSha256: packet.sourceContentSha256,
    sourceRetrievalStatus: 'retrieved',
    approvedSourceCount: 1,
    excludedSourceReferences: packet.excludedSourceReferences,
    proposedManifest: packet.proposedManifest,
    candidateMetadata: [],
    rows: [{
      ...packet.rows[0],
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
    CBRO_SELECTED_IDS,
  );
  assert.equal(inventory.find((record) => record.id === 'days-of-future-present').deliveryStatus, 'blocked');
  assert.equal(inventory.find((record) => record.id === 'countdown').deliveryStatus, 'blocked');
  assert.equal(inventory.find((record) => record.id === 'legion-quest').centralDisposition, 'absorbed');
  assert.equal(inventory.find((record) => record.id === 'marvel-vs-dc').centralDisposition, 'provenance-blocked');
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
  const reviewedLibraryDigest = libraryDigestExcludingOrders(library, CBRO_SELECTED_IDS);
  const mappings = await Promise.all(CBRO_SELECTED_IDS.map((id) => (
    readJson(path.join(mappingsDir, `${id}.json`))
  )));
  const mappingById = new Map(mappings.map((mapping) => [mapping.id, mapping]));
  const existingIds = library.lists
    .filter((entry) => !CBRO_SELECTED_IDS.includes(entry.id))
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
    assert.equal(report.comparisonCount, 93);
    assert.equal(report.libraryDigest, reviewedLibraryDigest);
    assert.ok(report.comparisons.every((comparison) => comparison.relationship === 'none'));
    assert.doesNotThrow(() => assertApprovedRelationshipReview({
      packet,
      mapping,
      report,
      currentLibraryDigest: reviewedLibraryDigest,
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
    inventory.filter((record) => record.centralDisposition === 'selected').map((record) => record.id),
    CBRO_SELECTED_IDS,
  );
  const maximumSecurityIndex = manifest.lists.findIndex((entry) => entry.id === 'maximum-security');
  assert.deepEqual(
    manifest.lists.slice(maximumSecurityIndex - CBRO_AUTHOR_IDS.length, maximumSecurityIndex)
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
});
