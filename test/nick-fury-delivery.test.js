import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { placeholderId } from '../scripts/lib/placeholder-id.mjs';
import {
  sourcePositionsForPacket,
  validateFrozenPacket,
  validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const id = 'nick-fury-reading-order';
const inventoryId = 'omnibussin-nick-fury-from-war-world-ii-to-s-h-i-e-l-d';

test('Nick Fury and S.H.I.E.L.D. preserves the complete settled source accounting', async () => {
  const [packet, mapping, payload, inventory, manifest, markdown] = await Promise.all([
    readJson(`scripts/data/cbh-packets/${id}.json`),
    readJson(`scripts/data/cbh-mappings/${id}.json`),
    readJson('src/data/nick_fury_reading_order.json'),
    readJson('scripts/data/cbh-character-inventory.json'),
    readJson('src/data/curated-lists.json'),
    readFile('src/data/orders/nick-fury-reading-order.md', 'utf8'),
  ]);
  const inventoryRecord = inventory.find((record) => record.id === packet.inventoryId);
  validateFrozenPacket(packet, { inventoryRecord, catalogEntries: manifest.lists });
  validateMappingDigest(mapping);
  assert.equal(mapping.placeholderIdentityMode, 'legacy-source-position');

  const settledLedger = packet.sourceReview.metadataGapLedger;
  const partition = settledLedger.settledReferences.reduce((counts, reference) => {
    counts[reference.classification] = (counts[reference.classification] ?? 0) + 1;
    return counts;
  }, {});
  const exactIdsByPosition = new Map([
    [4, 19749], [193, 49976], [194, 49977], [195, 49978], [196, 49979], [197, 49980], [198, 49981],
    [199, 27710], [200, 27721], [201, 27732], [202, 27743], [203, 27752], [204, 27753],
    [210, 19494], [211, 19495], [232, 19522], [253, 27754], [254, 27755], [255, 27756],
    [256, 27711], [257, 27712], [258, 27713], [259, 27714], [260, 27715], [262, 27716],
    [263, 27717], [264, 27718], [265, 27719], [266, 27720], [267, 27722], [268, 27723],
    [269, 27724], [270, 27725], [271, 27726], [272, 27727], [273, 27728], [274, 27729],
    [275, 27730], [276, 27731], [277, 27733], [278, 27734], [279, 27735], [280, 27736],
    [281, 27737], [282, 27738], [283, 27739], [284, 27740], [285, 27741], [286, 27742],
    [287, 27744], [288, 27745], [300, 2009], [301, 21001], [302, 27746], [303, 27747],
    [304, 27748], [305, 27749], [306, 27750], [307, 27751], [363, 38181], [368, 38176],
    [369, 38175],
  ]);

  assert.deepEqual(partition, {
    'exact-atomic': 62,
    'canonical-repeat': 1,
    'provider-unavailability': 129,
    'source-semantic-exclusion': 2,
  });
  assert.equal(Object.values(partition).reduce((total, count) => total + count, 0), 194);
  assert.deepEqual(settledLedger.classificationCounts, {
    exactAtomic: 62,
    canonicalRepeat: 1,
    providerUnavailable: 129,
    sourceSemanticExclusion: 2,
    ambiguous: 0,
    unresolved: 0,
    total: 194,
  });
  assert.equal(
    settledLedger.providerAvailabilityStatement,
    'Owner search results report provider unavailability only; exact frozen source identities remain controlling, no nonexistence claim is made, and no substitution is authorized.',
  );
  assert.equal(packet.rows.length, 140);
  assert.equal(packet.sourceGaps.length, 129);
  assert.equal(packet.repeatedSourceReferences.length, 75);
  assert.equal(packet.excludedSourceRows.length, 26);
  assert.equal(packet.sourceGapResolutions.length, 65);
  assert.equal(packet.sourceOccurrenceCount, 370);
  assert.equal(packet.sourceOccurrenceCount,
    packet.rows.length + packet.sourceGaps.length
      + packet.repeatedSourceReferences.length + packet.excludedSourceRows.length);
  assert.deepEqual(sourcePositionsForPacket(packet), mapping.rows.map((row) => row.sourcePosition));

  assert.equal(payload.count, 269);
  assert.equal(payload.items.length, 269);
  assert.equal(payload.placeholders, 129);
  assert.equal(payload.unresolved.length, 129);
  assert.equal(payload.items.filter((item) => item.placeholder).length, 129);
  assert.equal(payload.items.filter((item) => !item.placeholder).length, 140);
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, 269);
  assert.equal(payload.items.find((item) => item.issueId === 10644)?.cover?.path.startsWith('https:'), true);
  assert.equal(manifest.lists.find((entry) => entry.id === id)?.coverIssueId, 10644);
  const parsedPlaceholders = parseChecklist(markdown).unresolved;
  assert.deepEqual(
    parsedPlaceholders.map((entry) => entry.issueId ?? placeholderId(id, entry.title, entry.sourceKey)),
    payload.items.filter((item) => item.placeholder).map((item) => item.issueId),
  );

  assert.equal(mapping.rows.length, 140);
  for (const [sourcePosition, selectedIssueId] of exactIdsByPosition) {
    const row = mapping.rows.find((candidate) => candidate.sourcePosition === sourcePosition);
    assert.equal(row?.selectedIssueId, selectedIssueId, `source position ${sourcePosition} selected exact issue`);
    assert.equal(
      payload.items.some((item) => item.issueId === selectedIssueId && !item.placeholder),
      true,
      `source position ${sourcePosition} exact issue must reach generated payload`,
    );
  }

  const repeat = packet.repeatedSourceReferences.find((reference) => reference.sourcePosition === 205);
  assert.equal(repeat?.canonicalGapPosition, 251);
  assert.deepEqual(
    packet.sourceGapResolutions.find((resolution) => resolution.sourcePosition === 205),
    {
      sourcePosition: 205,
      previousSourceIssueReference: 'Fury one-shot',
      previousSourceRangeReference: 'Fury one-shot',
      previousNormalizedSeriesTitle: 'Fury',
      previousSeriesYear: null,
      previousIssueNumber: 'null',
      resolutionKind: 'canonical-gap-repeat',
      canonicalGapPosition: 251,
      checkedAt: '2026-09-07',
      auditBasis: 'The frozen source identifies this earlier prose reference as the same work later stated atomically at source position 251; the canonical source gap remains provider-unavailable.',
      evidenceSources: [{
        kind: 'owner-settlement',
        url: 'https://github.com/raymond-nassar/recap-page/issues/330#issuecomment-5574311667',
        retrievedAt: '2026-09-07',
      }],
      evidenceDigest: '8eb35a4638883f3775bb48725e817b6dc0df544ffce8055c5d6d44def605f80c',
    },
  );
  assert.deepEqual(
    packet.excludedSourceRows.filter((row) => [293, 294].includes(row.sourcePosition))
      .map((row) => row.sourcePosition),
    [293, 294],
  );

  const providerRows = settledLedger.settledReferences
    .filter((reference) => reference.classification === 'provider-unavailability');
  assert.equal(providerRows.length, 129);
  assert.deepEqual(
    providerRows.map((reference) => [reference.sourcePosition, reference.sourceIssueReference]),
    packet.sourceGaps.map((gap) => [gap.sourcePosition, gap.sourceIssueReference]),
  );
  for (const gap of packet.sourceGaps) {
    assert.equal(gap.kind, 'availability-exclusion');
    assert.equal(gap.status, 'closed');
    assert.equal(gap.auditBasis.startsWith('Owner-observed provider unavailability'), true);
    assert.equal(Object.hasOwn(gap, 'selectedIssueId'), false);
    assert.equal(Object.hasOwn(gap, 'candidateIssueId'), false);
  }

  const infinity = mapping.rows.find((row) => row.sourcePosition === 363);
  assert.deepEqual(
    {
      sourceIssueReference: infinity?.sourceIssueReference,
      sourceRangeReference: infinity?.sourceRangeReference,
      sourceRetailIssueNumber: infinity?.sourceRetailIssueNumber,
      marvelIssueFieldNumber: infinity?.marvelIssueFieldNumber,
      metadataIssueNumber: infinity?.metadataIssueNumber,
    },
    {
      sourceIssueReference: 'S.H.I.E.L.D. Infinity',
      sourceRangeReference: 'S.H.I.E.L.D. Infinity',
      sourceRetailIssueNumber: '1',
      marvelIssueFieldNumber: '0',
      metadataIssueNumber: '0',
    },
  );
});

test('the merged Nick Fury inventory record is marked shipped', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const record = inventory.find((candidate) => candidate.id === inventoryId);

  assert.ok(record, `Missing the Nick Fury inventory record ${inventoryId}`);
  assert.deepEqual(record.catalogIds, [id]);
  assert.equal(record.deliveryStatus, 'shipped');
});
