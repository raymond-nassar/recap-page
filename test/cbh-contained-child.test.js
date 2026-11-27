import test from 'node:test';
import assert from 'node:assert/strict';
import {
  packetDigestFor,
  validatePacketProposal,
} from '../scripts/lib/cbh-inventory.mjs';

const PAGE = 'https://www.comicbookherald.com/future-bridge/';

function row(title, number, issueId) {
  return {
    sourceIssueReference: `${title} #${number}`,
    sourceRangeReference: null,
    normalizedSeriesTitle: title,
    seriesYear: 2007,
    issueNumber: String(number),
    seriesId: 900,
    candidateIssueId: issueId,
    manualSeriesSelectionApproved: false,
    selectionNote: null,
  };
}

// A whole bridge page of five comics whose positions 2 to 3 were already shipped as a split.
function bridgePacket() {
  const packet = {
    schemaVersion: 1,
    id: 'future-bridge',
    inventoryId: 'future-bridge',
    sourceUrl: PAGE,
    sourceRetrievedAt: '2026-08-22',
    sourceBoundary: 'The whole page in source order.',
    excludedSourceReferences: [],
    expectedCount: 5,
    proposedManifest: {
      id: 'future-bridge',
      name: 'Future Bridge',
      description: 'A frozen five-issue bridge.',
      type: 'event',
      depth: 'complete',
      beginner: false,
      group: null,
      groupName: null,
      variant: null,
      sourceFile: 'future-bridge.md',
      sourcePage: PAGE,
      sourceOrigin: "Compiled for this project from Comic Book Herald's guide",
      sourceLicense: null,
      out: 'future_bridge.json',
      characters: ['Tester'],
      keywords: ['Future Bridge'],
      expect: 5,
      timeline: 2007,
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
      row('Lead In', 1, 9001),
      row('Quiet War', 1, 9002),
      row('Quiet War', 2, 9003),
      row('Lead Out', 1, 9004),
      row('Lead Out', 2, 9005),
    ],
  };
  packet.packetDigest = packetDigestFor(packet);
  return packet;
}

function inventoryRecord() {
  return {
    position: 1,
    id: 'future-bridge',
    title: 'Future Bridge',
    url: PAGE,
    guideType: 'bridge',
    window: 'Q2',
    disposition: 'grouped-variant',
    reason: 'Shipped split: Quiet War',
    sourceRetrievedAt: '2026-08-22',
    overlapIds: [],
    catalogIds: ['quiet-war'],
    deliveryStatus: 'shipped',
  };
}

function childEntry() {
  return { id: 'quiet-war', sourcePage: PAGE, expect: 2 };
}

function childMapping(issueIds = [9002, 9003]) {
  return {
    id: 'quiet-war',
    inventoryId: 'future-bridge',
    sourceUrl: PAGE,
    approvedSourceCount: issueIds.length,
    reviewStatus: 'approved',
    rows: issueIds.map((issueId) => ({ selectedIssueId: issueId, selectedIssueIds: [issueId] })),
  };
}

function validate({
  packet = bridgePacket(),
  record = inventoryRecord(),
  entries = [childEntry()],
  mappings = [childMapping()],
} = {}) {
  return validatePacketProposal(packet, {
    inventoryRecord: record,
    catalogEntries: entries,
    containedChildMappings: mappings,
  });
}

test('a whole page may share its address with a split that is exactly one contiguous block of it', () => {
  assert.doesNotThrow(() => validate());
  assert.throws(() => validate({ mappings: [] }), /Duplicate source URL/);
});

test('the shared address stays a duplicate unless every containment fact holds', () => {
  const cases = [
    ['a different inventory id', { mappings: [{ ...childMapping(), inventoryId: 'other-page' }] }],
    ['a reordered block', { mappings: [childMapping([9003, 9002])] }],
    ['a non-contiguous block', { mappings: [childMapping([9002, 9004])] }],
    ['a block longer than its catalog entry', { mappings: [childMapping([9002, 9003, 9004])] }],
    ['a child the record does not list', { record: { ...inventoryRecord(), catalogIds: [] } }],
    ['an unapproved mapping', { mappings: [{ ...childMapping(), reviewStatus: 'draft' }] }],
    ['a sectioned child', { mappings: [{ ...childMapping(), sourceSection: 'Quiet War' }] }],
  ];
  for (const [label, options] of cases) {
    assert.throws(() => validate(options), /contained child source/, label);
  }
  const sectioned = bridgePacket();
  sectioned.inventoryId = 'parent-page';
  sectioned.packetDigest = packetDigestFor(sectioned);
  assert.throws(
    () => validate({ packet: sectioned, record: { ...inventoryRecord(), id: 'parent-page' } }),
    /contained child source|inventory/i,
  );
});
