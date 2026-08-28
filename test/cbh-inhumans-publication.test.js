import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const readJson = async (relative) => JSON.parse(await readFile(path.join(root, relative), 'utf8'));
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('Inhumans publishes the approved cache-only packet without erasing metadata gaps', async () => {
  const [packet, mapping, overlap, payload, manifest, catalog] = await Promise.all([
    readJson('scripts/data/cbh-packets/inhumans-reading-order.json'),
    readJson('scripts/data/cbh-mappings/inhumans-reading-order.json'),
    readJson('scripts/data/cbh-overlaps/inhumans-reading-order.json'),
    readJson('src/data/inhumans_reading_order.json'),
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
  ]);

  assert.equal(packet.packetDigest, mapping.packetDigest);
  assert.equal(mapping.mappingDigest, 'a4cbaf7108b0d4b9088362ea89ed5d930db9f354e4cfa11183926b81f9d76e5e');
  assert.equal(packet.sourceOccurrenceCount, 354);
  assert.equal(packet.rows.length, 217);
  assert.equal(packet.sourceGaps.length, 42);
  assert.equal(packet.repeatedSourceReferences.length, 4);
  assert.equal(payload.count, 259);
  assert.equal(payload.placeholders, 42);
  assert.equal(payload.items.filter((item) => !item.placeholder).length, 217);
  assert.equal(new Set(payload.items.map((item) => String(item.issueId))).size, 259);
  assert.deepEqual(
    payload.unresolved.map((item) => item.sourceKey),
    mapping.sourceGaps.map((gap) => String(gap.sourcePosition)),
  );
  assert.deepEqual(
    payload.items.filter((item) => item.placeholder).map((item) => item.number),
    mapping.sourceGaps.map((gap) => gap.issueNumber),
  );
  assert.deepEqual(
    payload.items.filter((item) => item.placeholder).slice(-8).map((item) => item.number),
    ['1.MU', '1.MU', '1.MU', '1.MU', '1.MU', '1.MU', '1.MU', '1.MU'],
  );
  const coverItem = payload.items.find((item) => item.issueId === 13183);
  assert.ok(coverItem);
  assert.match(coverItem.cover.path, /^https:/);
  assert.equal(overlap.comparisonCount, 166);
  assert.equal(overlap.comparisons.filter((comparison) => comparison.relationship === 'none').length, 150);
  assert.equal(overlap.comparisons.filter((comparison) => comparison.relationship === 'partial').length, 15);
  assert.equal(overlap.comparisons.filter((comparison) => comparison.relationship === 'existing-subset').length, 1);
  assert.equal(digest(mapping.rows.map((row) => row.selectedIssueId)), '90b317a623bdd0e42f8d01e331b12ef195b285113971635407ccba3054adc378');
  const manifestEntry = manifest.lists.find((entry) => entry.id === payload.id);
  const catalogEntry = catalog.lists.find((entry) => entry.id === payload.id);
  assert.equal(manifestEntry?.expect, payload.count);
  assert.equal(catalogEntry?.count, payload.count);
  assert.deepEqual(catalogEntry?.cover, coverItem.cover);
});
