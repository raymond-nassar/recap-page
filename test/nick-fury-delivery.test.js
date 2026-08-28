import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  sourcePositionsForPacket,
  validateFrozenPacket,
  validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const id = 'nick-fury-reading-order';
const inventoryId = 'omnibussin-nick-fury-from-war-world-ii-to-s-h-i-e-l-d';

test('Nick Fury and S.H.I.E.L.D. preserves the complete settled source accounting', async () => {
  const [packet, mapping, payload, inventory, manifest] = await Promise.all([
    readJson(`scripts/data/cbh-packets/${id}.json`),
    readJson(`scripts/data/cbh-mappings/${id}.json`),
    readJson('src/data/nick_fury_reading_order.json'),
    readJson('scripts/data/cbh-character-inventory.json'),
    readJson('src/data/curated-lists.json'),
  ]);
  const inventoryRecord = inventory.find((record) => record.id === packet.inventoryId);
  validateFrozenPacket(packet, { inventoryRecord, catalogEntries: manifest.lists });
  validateMappingDigest(mapping);

  assert.equal(packet.rows.length, 78);
  assert.equal(packet.sourceGaps.length, 194);
  assert.equal(packet.repeatedSourceReferences.length, 74);
  assert.equal(packet.excludedSourceRows.length, 24);
  assert.equal(packet.sourceOccurrenceCount, 370);
  assert.equal(packet.sourceOccurrenceCount,
    packet.rows.length + packet.sourceGaps.length
      + packet.repeatedSourceReferences.length + packet.excludedSourceRows.length);
  assert.deepEqual(sourcePositionsForPacket(packet), mapping.rows.map((row) => row.sourcePosition));

  assert.equal(payload.count, 272);
  assert.equal(payload.items.length, 272);
  assert.equal(payload.placeholders, 194);
  assert.equal(payload.unresolved.length, 194);
  assert.equal(payload.items.filter((item) => item.placeholder).length, 194);
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, 272);
  assert.equal(payload.items.find((item) => item.issueId === 10644)?.cover?.path.startsWith('https:'), true);
  assert.equal(manifest.lists.find((entry) => entry.id === id)?.coverIssueId, 10644);

  const ambiguous = ['Marvel Spotlight (1971) #31', 'Marvel Team-Up #139'];
  assert.deepEqual(
    packet.sourceGaps.filter((gap) => ambiguous.includes(gap.sourceIssueReference))
      .map((gap) => gap.sourceIssueReference),
    ambiguous,
  );
  assert.equal(mapping.rows.some((row) => ambiguous.includes(row.sourceIssueReference)), false);
});

test('the merged Nick Fury inventory record is marked shipped', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const record = inventory.find((candidate) => candidate.id === inventoryId);

  assert.ok(record, `Missing the Nick Fury inventory record ${inventoryId}`);
  assert.deepEqual(record.catalogIds, [id]);
  assert.equal(record.deliveryStatus, 'shipped');
});
