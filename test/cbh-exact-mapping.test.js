import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertMappingMatchesPacketOccurrences,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';

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

test('Marvel Zombies counts exact originals, open gaps and its later repeat as source occurrences', async () => {
  const frozen = JSON.parse(await readFile(new URL(
    '../scripts/data/cbh-packets/marvel-zombies-reading-order.json', import.meta.url,
  ), 'utf8'));
  const resolved = JSON.parse(await readFile(new URL(
    '../scripts/data/cbh-mappings/marvel-zombies-reading-order.json', import.meta.url,
  ), 'utf8'));

  validateFrozenPacket(frozen);
  validateMappingDigest(resolved);
  assertMappingMatchesPacketOccurrences(frozen, resolved);
  assert.equal(frozen.sourceOccurrenceCount, 95);
  assert.equal(resolved.approvedSourceCount, 95);
  assert.equal(resolved.rows.length, 91);
  assert.equal(frozen.sourceGaps.length, 3);
  assert.deepEqual(frozen.repeatedSourceReferences.map((row) => [
    row.sourcePosition, row.canonicalRow,
  ]), [[73, 4]]);
  assert.throws(
    () => assertMappingMatchesPacketOccurrences(frozen, {
      ...resolved, approvedSourceCount: resolved.rows.length,
    }),
    /approvedSourceCount differs from its frozen source occurrence count/,
  );
});

test('Marvel Zombies report covers the full current library with unchanged exact overlaps', async () => {
  const mappingPath = new URL(
    '../scripts/data/cbh-mappings/marvel-zombies-reading-order.json', import.meta.url,
  );
  const report = JSON.parse(await readFile(new URL(
    '../scripts/data/cbh-overlaps/marvel-zombies-reading-order.json', import.meta.url,
  ), 'utf8'));
  validateReportDigest(report);
  const current = await buildReportForMapping(mappingPath, [], {
    excludedOrderIds: ['ms-marvel-kamala-khan-reading-order', 'nova-reading-order', 'ultimate-spider-man-reading-order', 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide',
      'shang-chi-master-of-kung-fu-reading-order', 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order', 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order', 'namor-sub-mariner-reading-order', 'iron-fist-reading-order', 'mcu-prep-thunderbolts', 'spider-man-no-way-home-owner-selected', 'mcu-prep-daredevil-born-again', 'mcu-prep-eternals'],
  });
  assert.deepEqual(report, current);
  assert.equal(report.sourceCounts.sourceOccurrenceCount, 95);
  assert.equal(report.sourceCounts.includedIssueCount, 91);
  assert.equal(report.comparisonCount, 193);
  assert.equal(report.comparisons.filter((item) => item.relationship !== 'none').length, 8);
});
