import assert from 'node:assert/strict';
import test from 'node:test';

import { assertMappingMatchesPacketOccurrences } from '../scripts/lib/cbh-inventory.mjs';

function packet() {
  return {
    id: 'range-check',
    rows: Array.from({ length: 6 }, (_, index) => ({
      sourceIssueReference: `Mighty Avengers #${index + 1}`,
      normalizedSeriesTitle: 'Mighty Avengers',
      seriesYear: 2007,
      issueNumber: String(index + 1),
      seriesId: 1866,
      candidateIssueId: index + 1,
      manualSeriesSelectionApproved: false,
    })),
  };
}

function mapping(selectedIds) {
  return {
    approvedSourceCount: 6,
    rows: selectedIds.map((selectedIssueId, index) => ({
      sourcePosition: index + 1,
      resolutionStatus: 'exact',
      selectedIssueId,
    })),
  };
}

test('exact source ranges reject an ID-less member rather than producing success-shaped accounting', () => {
  const candidate = mapping([6097, 6301, 13477, 15855, 15965, null]);
  assert.throws(() => assertMappingMatchesPacketOccurrences(packet(), candidate), /concrete selected issue id/i);
});

test('exact source ranges preserve every source member with a concrete selected ID', () => {
  const candidate = mapping([6097, 6301, 13477, 15855, 15965, 16519]);
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet(), candidate));
});
