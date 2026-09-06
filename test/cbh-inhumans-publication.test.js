import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import {
  assertMappingMatchesPacketOccurrences,
  validateFrozenPacket,
  validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const root = path.resolve(import.meta.dirname, '..');
const expectedVector = [
  [73, 17188], [74, 17189], [75, 17190], [76, 17191], [77, 17192], [78, 363],
  [79, 338], [80, 351], [81, 362], [82, 380], [83, 319], [84, 432],
  [87, 1399], [133, 25971], [144, 28701], [145, 28702], [146, 28703],
  [147, 28704], [148, 28705], [192, 48562], [193, 48563], [198, 48673],
  [200, 48653], [280, 62652], [289, 65910], [291, 63973], [292, 64401],
  [293, 64815], [294, 65079], [295, 65287], [297, 62507], [298, 62511],
  [299, 62601], [300, 62604], [301, 62603], [302, 62602], [303, 62637],
  [304, 62648],
];
const expectedExclusionPositions = [114, 191, 199, 202];
const settledPositions = new Set(expectedVector.map(([sourcePosition]) => sourcePosition));
const settledIds = new Set(expectedVector.map(([, issueId]) => issueId));

const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'));

test('Inhumans publishes 38 exact resolutions and preserves four explicit exclusions', async () => {
  const [
    packet,
    mapping,
    overlap,
    inventory,
    payload,
    manifest,
    catalog,
    markdown,
  ] = await Promise.all([
    readJson('scripts/data/cbh-packets/inhumans-reading-order.json'),
    readJson('scripts/data/cbh-mappings/inhumans-reading-order.json'),
    readJson('scripts/data/cbh-overlaps/inhumans-reading-order.json'),
    readJson('scripts/data/cbh-character-inventory.json'),
    readJson('src/data/inhumans_reading_order.json'),
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
    readFile(path.join(root, 'src/data/orders/inhumans-reading-order.md'), 'utf8'),
  ]);
  const parsed = parseChecklist(markdown);
  const exactResolutions = packet.sourceGapResolutions.filter((resolution) => (
    resolution.resolutionKind === 'exact-issue'
  ));
  const exclusionResolutions = packet.sourceGapResolutions.filter((resolution) => (
    resolution.resolutionKind === 'source-exclusion'
  ));
  const mappingVector = mapping.rows
    .filter((row) => settledPositions.has(row.sourcePosition))
    .map((row) => [row.sourcePosition, Number(row.selectedIssueId)]);
  const checklistVector = parsed.entries
    .filter((entry) => settledPositions.has(Number(entry.sourceKey)))
    .map((entry) => [Number(entry.sourceKey), Number(entry.issueId)]);
  const publishedSettlements = payload.items
    .filter((item) => settledIds.has(Number(item.issueId)));

  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.equal(packet.packetDigest, mapping.packetDigest);
  assert.equal(
    mapping.mappingDigest,
    'c413318a546b26e81bf02558cb69fa05cffb28a7f6a5d3f40dfe03812e2227e0',
  );
  assert.equal(Object.hasOwn(packet, 'sourceGaps'), false);
  assert.equal(Object.hasOwn(mapping, 'sourceGaps'), false);
  assert.deepEqual(mapping.sourceGapResolutions, packet.sourceGapResolutions);
  assert.deepEqual(mappingVector, expectedVector);
  assert.deepEqual(
    exactResolutions.map((resolution) => [
      resolution.sourcePosition,
      resolution.selectedIssueId,
    ]),
    expectedVector,
  );
  assert.deepEqual(checklistVector, expectedVector);
  assert.deepEqual(
    publishedSettlements.map((item) => Number(item.issueId)),
    expectedVector.map(([, issueId]) => issueId),
  );
  assert.deepEqual(
    exclusionResolutions.map((resolution) => resolution.sourcePosition),
    expectedExclusionPositions,
  );
  assert.deepEqual(
    packet.excludedSourceRows
      .filter((row) => expectedExclusionPositions.includes(row.sourcePosition))
      .map((row) => row.sourcePosition),
    expectedExclusionPositions,
  );

  assert.equal(packet.sourceOccurrenceCount, 354);
  assert.equal(packet.rows.length, 255);
  assert.equal(packet.sourceGapResolutions.length, 42);
  assert.equal(exactResolutions.length, 38);
  assert.equal(exclusionResolutions.length, 4);
  assert.equal(packet.repeatedSourceReferences.length, 4);
  assert.equal(packet.excludedSourceRows.length, 95);
  assert.equal(payload.count, 255);
  assert.equal(payload.placeholders, 0);
  assert.equal(payload.unresolved.length, 0);
  assert.equal(parsed.entries.length, 255);
  assert.equal(parsed.unresolved.length, 0);
  assert.equal(new Set(payload.items.map((item) => String(item.issueId))).size, 255);

  const suffixResolutions = new Map(
    packet.sourceGapResolutions
      .filter((resolution) => [192, 193, 198, 200, 297, 298, 299, 300, 301, 302, 303, 304]
        .includes(resolution.sourcePosition))
      .map((resolution) => [resolution.sourcePosition, resolution]),
  );
  for (const sourcePosition of [192, 193, 198, 200]) {
    assert.match(suffixResolutions.get(sourcePosition).previousIssueNumber, /\.Inh$/);
    assert.doesNotMatch(suffixResolutions.get(sourcePosition).resolvedIssueNumber, /\.Inh$/);
  }
  for (const sourcePosition of [297, 298, 299, 300, 301, 302, 303, 304]) {
    assert.equal(suffixResolutions.get(sourcePosition).previousIssueNumber, '1.MU');
    assert.equal(suffixResolutions.get(sourcePosition).resolvedIssueNumber, '1.1');
  }

  const excludedByPosition = new Map(
    exclusionResolutions.map((resolution) => [resolution.sourcePosition, resolution]),
  );
  assert.match(excludedByPosition.get(114).exclusionReason, /Front Line #6 is a different title/);
  for (const sourcePosition of [191, 199, 202]) {
    const resolution = excludedByPosition.get(sourcePosition);
    assert.match(resolution.previousIssueNumber, /\.Inh$/);
    assert.equal(Object.hasOwn(resolution, 'selectedIssueId'), false);
    assert.match(resolution.exclusionReason, /base-numbered.+is not substituted/);
  }

  const repeated = packet.repeatedSourceReferences.find(
    (reference) => reference.sourcePosition === 329,
  );
  assert.equal(repeated.canonicalRow, 177);
  assert.equal(packet.rows[repeated.canonicalRow - 1].sourceIssueReference, 'Uncanny Inhumans #11');
  assert.equal(packet.rows[repeated.canonicalRow - 1].candidateIssueId, 52869);

  const settledCandidates = mapping.candidateMetadata.filter((candidate) => (
    settledIds.has(Number(candidate.id))
  ));
  assert.equal(settledCandidates.length, 38);
  assert.equal(settledCandidates.filter((candidate) => candidate.detailsRefused === true).length, 0);
  assert.ok(settledCandidates.every((candidate) => (
    candidate.detailUrl.startsWith(`https://www.marvel.com/comics/issue/${candidate.id}/`)
      && candidate.seriesId != null
  )));
  assert.equal(publishedSettlements.filter((item) => item.detailsRefused === true).length, 0);
  assert.ok(publishedSettlements.every((item) => (
    item.placeholder !== true
      && item.url.startsWith(`https://www.marvel.com/comics/issue/${item.issueId}/`)
      && item.seriesId != null
  )));

  const coverItem = payload.items.find((item) => item.issueId === 13183);
  assert.ok(coverItem);
  assert.match(coverItem.cover.path, /^https:/);
  assert.equal(overlap.comparisonCount, 138);
  assert.equal(
    overlap.comparisons.filter((comparison) => comparison.relationship === 'none').length,
    125,
  );
  assert.equal(
    overlap.comparisons.filter((comparison) => comparison.relationship === 'partial').length,
    12,
  );
  assert.equal(
    overlap.comparisons.filter((comparison) => (
      comparison.relationship === 'existing-subset'
    )).length,
    1,
  );
  const manifestEntry = manifest.lists.find((entry) => entry.id === payload.id);
  const catalogEntry = catalog.lists.find((entry) => entry.id === payload.id);
  const inventoryEntry = inventory.find((entry) => entry.id === payload.id);
  assert.equal(manifestEntry?.expect, payload.count);
  assert.equal(catalogEntry?.count, payload.count);
  assert.deepEqual(catalogEntry?.cover, coverItem.cover);
  assert.deepEqual(
    inventoryEntry?.overlapIds,
    overlap.comparisons
      .filter((comparison) => comparison.relationship !== 'none')
      .map((comparison) => comparison.orderId),
  );
  assert.match(inventoryEntry?.reason, /255 exact issue identities.+95 explicit source exclusions/);
});
