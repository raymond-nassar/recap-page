import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import {
  digestCanonicalJson,
  sourcePositionsForPacket,
  validateFrozenPacket,
  validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const id = 'punisher-reading-order';
const expectedExactVector = [
  [96, 77954],
  [182, 69826], [183, 69827], [184, 69828], [185, 69829], [186, 69830],
  [187, 69831], [188, 69832], [189, 69833], [190, 69834],
  [191, 80423], [192, 82157], [193, 84575],
  [340, 116], [341, 117], [342, 115], [343, 15005], [344, 499],
  [346, 701], [359, 1883],
  [366, 2548], [367, 3081], [368, 3183], [369, 3389], [370, 3501],
  [372, 3944], [373, 4067], [374, 4180], [375, 4279], [376, 4433],
  [377, 4752], [378, 5068], [379, 5069], [380, 5222], [381, 5379],
  [382, 5517], [383, 5647], [384, 5855], [385, 5856], [386, 6092],
  [387, 6227], [388, 13434], [389, 15815], [390, 15934],
  [397, 16115], [398, 16463], [399, 17221], [400, 17351], [401, 17591],
  [402, 20835], [403, 20973], [404, 21181], [405, 21331], [406, 21509],
  [407, 21711], [415, 21712], [416, 21940], [417, 22270], [418, 22477],
  [419, 22878], [447, 59301], [474, 69361], [475, 69362], [476, 69363],
];

test('the Punisher settlement publishes exact identities without changing retained placeholders', async () => {
  const [packet, mapping, payload, markdown] = await Promise.all([
    readJson(`scripts/data/cbh-packets/${id}.json`),
    readJson(`scripts/data/cbh-mappings/${id}.json`),
    readJson('src/data/punisher_reading_order.json'),
    readFile('src/data/orders/punisher-reading-order.md', 'utf8'),
  ]);
  validateFrozenPacket(packet);
  validateMappingDigest(mapping);

  const parsed = parseChecklist(markdown);
  const ledger = packet.sourceReview.metadataGapLedger;
  const classificationCounts = ledger.settledReferences.reduce((counts, reference) => {
    counts[reference.classification] = (counts[reference.classification] ?? 0) + 1;
    return counts;
  }, {});

  assert.deepEqual(ledger.classificationCounts, {
    exactAtomic: 64,
    canonicalRepeat: 23,
    providerUnavailable: 94,
    sourceSemanticExclusion: 0,
    ambiguous: 0,
    unresolved: 0,
    total: 181,
  });
  assert.deepEqual(classificationCounts, {
    'exact-atomic': 64,
    'provider-unavailability': 94,
    'canonical-repeat': 23,
  });
  assert.equal(ledger.settledReferenceDigest, digestCanonicalJson(ledger.settledReferences));

  const resolutionVector = packet.sourceGapResolutions.map((resolution) => [
    resolution.sourcePosition,
    resolution.selectedIssueId,
  ]);
  const settledPositions = new Set(expectedExactVector.map(([sourcePosition]) => sourcePosition));
  const mappingVector = mapping.rows
    .filter((row) => settledPositions.has(row.sourcePosition))
    .map((row) => [row.sourcePosition, row.selectedIssueId]);
  assert.deepEqual(resolutionVector, expectedExactVector);
  assert.deepEqual(mappingVector, expectedExactVector);
  assert.equal(packet.sourceGapResolutions.every((resolution) => (
    resolution.resolutionKind === 'exact-issue'
  )), true);

  assert.equal(packet.rows.length, 544);
  assert.equal(packet.sourceGaps.length, 94);
  assert.equal(packet.repeatedSourceReferences.length, 145);
  assert.equal(packet.excludedSourceRows.length, 74);
  assert.equal(packet.sourceOccurrenceCount, 857);
  assert.equal(
    packet.rows.length + packet.sourceGaps.length
      + packet.repeatedSourceReferences.length + packet.excludedSourceRows.length,
    857,
  );
  assert.equal(new Set(sourcePositionsForPacket(packet)).size, 544);
  assert.equal(
    packet.repeatedSourceReferences.filter((reference) => (
      Object.hasOwn(reference, 'canonicalGapPosition')
    )).length,
    23,
  );

  assert.equal(mapping.placeholderIdentityMode, 'title');
  assert.equal(mapping.rows.length, 544);
  assert.equal(mapping.candidateMetadata.length, 544);
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
  assert.deepEqual(mapping.sourceGapResolutions, packet.sourceGapResolutions);
  assert.equal(packet.sourceGaps.every((gap) => (
    gap.kind === 'availability-exclusion'
      && gap.status === 'closed'
      && !Object.hasOwn(gap, 'candidateIssueId')
      && !Object.hasOwn(gap, 'selectedIssueId')
  )), true);
  assert.equal(mapping.rows.find((row) => row.sourcePosition === 193)?.seriesId, null);

  assert.equal(parsed.entries.length, 544);
  assert.equal(parsed.unresolved.length, 94);
  assert.equal(parsed.unresolved.every((entry) => entry.sourceKey == null), true);
  assert.equal(payload.count, 638);
  assert.equal(payload.items.length, 638);
  assert.equal(payload.placeholders, 94);
  assert.equal(payload.items.filter((item) => item.placeholder === true).length, 94);
  assert.equal(payload.items.filter((item) => item.issueId > 0).length, 544);
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, 638);
  const retainedIdentityRecords = [...packet.sourceGaps]
    .sort((left, right) => left.sourcePosition - right.sourcePosition)
    .map((gap, index) => ({
      sourcePosition: gap.sourcePosition,
      sourceIssueReference: gap.sourceIssueReference,
      sourceRangeReference: gap.sourceRangeReference ?? null,
      normalizedSeriesTitle: gap.normalizedSeriesTitle,
      seriesYear: gap.seriesYear,
      issueNumber: gap.issueNumber,
      issueId: payload.items.filter((item) => item.placeholder === true)[index].issueId,
    }));
  assert.equal(
    digestCanonicalJson(retainedIdentityRecords),
    'bced0797a6028a63305048eb340ff14ad61cfd4d3b1155ba82e993890e9d77f0',
  );
  for (const [sourcePosition, issueId] of expectedExactVector) {
    assert.equal(
      payload.items.some((item) => item.issueId === issueId && item.placeholder !== true),
      true,
      `source position ${sourcePosition} exact issue must reach the reader payload`,
    );
  }

  const unavailableIssueNumbers = packet.sourceGaps
    .filter((gap) => gap.normalizedSeriesTitle === 'Punisher MAX' && gap.seriesYear === 2004)
    .map((gap) => Number(gap.issueNumber));
  assert.deepEqual(unavailableIssueNumbers, [
    6, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25,
  ]);
  assert.equal(packet.sourceGaps.filter((gap) => (
    gap.normalizedSeriesTitle === 'Frank Castle: The Punisher MAX'
  )).length, 10);
  assert.equal(packet.sourceGaps.filter((gap) => (
    gap.normalizedSeriesTitle === 'Punisher MAX' && gap.seriesYear === 2009
  )).length, 22);

  assert.equal(mapping.rows.some((row) => [421, 54973, 57889, 57890, 57891, 57892]
    .includes(Number(row.selectedIssueId))), false);
  assert.equal(mapping.rows.some((row) => [41137, 29813, 19366, 21102, 13744]
    .includes(Number(row.seriesId))), false);
});
