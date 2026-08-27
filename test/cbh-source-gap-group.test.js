import assert from 'node:assert/strict';
import test from 'node:test';

import {
  gapEvidenceDigestFor,
  packetDigestFor,
  validateFrozenPacket,
} from '../scripts/lib/cbh-inventory.mjs';

function packetWithGap(sourceGroup) {
  const gap = {
    sourcePosition: 2,
    sourceIssueReference: 'Missing Series #2',
    sourceRangeReference: 'Visible source block',
    normalizedSeriesTitle: 'Missing Series',
    seriesYear: 2026,
    issueNumber: '2',
    kind: 'published-metadata-gap',
    status: 'open',
    checkedAt: '2026-08-26',
    auditBasis: 'The metadata provider has no exact record.',
    evidenceSources: [{
      kind: 'metadata-api',
      url: 'https://example.test/search/issues?q=missing',
      retrievedAt: '2026-08-26',
    }],
  };
  if (sourceGroup !== undefined) gap.sourceGroup = sourceGroup;
  gap.evidenceDigest = gapEvidenceDigestFor(gap);

  const packet = {
    schemaVersion: 1,
    id: 'grouped-gap',
    inventoryId: 'grouped-gap',
    sourceUrl: 'https://www.comicbookherald.com/grouped-gap/',
    sourceRetrievedAt: '2026-08-26',
    sourceBoundary: 'The full visible source page.',
    excludedSourceReferences: [],
    sourceOccurrenceCount: 2,
    sourceGaps: [gap],
    expectedCount: 1,
    proposedManifest: {
      id: 'grouped-gap',
      name: 'Grouped Gap',
      description: 'A test guide.',
      type: 'event',
      depth: 'partial',
      beginner: false,
      group: null,
      groupName: null,
      variant: null,
      sourceFile: 'grouped-gap.md',
      sourcePage: 'https://www.comicbookherald.com/grouped-gap/',
      sourceOrigin: "Compiled for this project from Comic Book Herald's guide",
      sourceLicense: null,
      out: 'grouped_gap.json',
      characters: ['Tester'],
      keywords: ['Tester'],
      expect: 2,
      timeline: null,
      coverIssueId: 1,
    },
    insertionAnchor: { beforeId: 'other-guide' },
    sourceReview: {
      authorityType: 'human',
      authorityIdentity: 'source-reviewer',
      rationale: 'The visible source boundary was reviewed.',
      reviewedAt: '2026-08-26T20:00:00Z',
    },
    rows: [{
      sourceIssueReference: 'Included Series #1',
      sourceRangeReference: 'Visible source block',
      normalizedSeriesTitle: 'Included Series',
      seriesYear: 2026,
      issueNumber: '1',
      seriesId: 1,
      candidateIssueId: 1,
      manualSeriesSelectionApproved: false,
      selectionNote: null,
    }],
  };
  packet.packetDigest = packetDigestFor(packet);
  return packet;
}

test('source gaps may omit source groups for existing packets', () => {
  assert.doesNotThrow(() => validateFrozenPacket(packetWithGap()));
});

test('source gap groups are validated and included in their evidence digest', () => {
  const packet = packetWithGap('Visible source block');
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.notEqual(
    gapEvidenceDigestFor({ ...packet.sourceGaps[0], sourceGroup: 'Different source block' }),
    packet.sourceGaps[0].evidenceDigest,
  );
});

test('source gap groups reject invalid and unsupported fields', () => {
  for (const sourceGroup of ['', 1]) {
    assert.throws(
      () => validateFrozenPacket(packetWithGap(sourceGroup)),
      /sourceGroup/i,
    );
  }
  const packet = packetWithGap('Visible source block');
  packet.sourceGaps[0].unexpected = true;
  packet.sourceGaps[0].evidenceDigest = gapEvidenceDigestFor(packet.sourceGaps[0]);
  packet.packetDigest = packetDigestFor(packet);
  assert.throws(() => validateFrozenPacket(packet), /unsupported fields/i);
});
