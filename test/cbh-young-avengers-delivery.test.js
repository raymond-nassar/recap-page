import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { parseCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = 'young-avengers-reading-order';

async function readJson(...segments) {
  return JSON.parse(await readFile(path.join(root, ...segments), 'utf8'));
}

test('Young Avengers preserves every settled source position without selecting an unsafe issue', async () => {
  const [ledger, packet, mapping, overlap, inventory, manifest, payload, catalog] = await Promise.all([
    readJson('scripts', 'data', 'cbh-source-ledgers', `${id}.json`),
    readJson('scripts', 'data', 'cbh-packets', `${id}.json`),
    readJson('scripts', 'data', 'cbh-mappings', `${id}.json`),
    readJson('scripts', 'data', 'cbh-overlaps', `${id}.json`),
    readJson('scripts', 'data', 'cbh-character-inventory.json'),
    readJson('src', 'data', 'curated-lists.json'),
    readJson('src', 'data', 'young_avengers_reading_order.json'),
    readJson('src', 'data', 'catalog.json'),
  ]);
  const inventoryRecord = inventory.find((entry) => entry.id === id);
  const manifestRecord = manifest.lists.find((entry) => entry.id === id);
  const catalogRecord = catalog.lists.find((entry) => entry.id === id);
  const semanticGaps = packet.sourceGaps.filter((gap) => (
    /Provider settlement: (ambiguous|metadata-absent)\./.test(gap.auditBasis)
  ));
  const contextOnly = packet.sourceGaps.filter((gap) => (
    /Provider settlement: context\./.test(gap.auditBasis)
  ));

  assert.equal(ledger.sourceOccurrenceCount, 220);
  assert.deepEqual(ledger.counts, {
    exclusion: 51,
    exact: 169,
    repeat: 0,
    gap: 0,
  });
  assert.equal(packet.rows.length, 114);
  assert.equal(packet.sourceGaps.length, 55);
  assert.equal(packet.excludedSourceRows.length, 51);
  assert.equal(semanticGaps.length, 51);
  assert.equal(contextOnly.length, 4);
  assert.equal(packet.rows.length + contextOnly.length + semanticGaps.length + packet.excludedSourceRows.length, 220);
  assert.equal(new Set(packet.rows.map((row) => row.candidateIssueId)).size, 114);
  assert.equal(new Set(packet.sourceGaps.map((gap) => gap.sourcePosition)).size, 55);
  assert.equal(new Set(packet.excludedSourceRows.map((row) => row.sourcePosition)).size, 51);
  assert.equal(packet.sourceGaps.every((gap) => gap.evidenceSources.some((source) => (
    source.url === 'https://github.com/raymond-nassar/recap-page/issues/333'
  ))), true);

  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: id,
    inventoryRecord,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(overlap));
  assert.equal(overlap.comparisonCount, 138);
  assert.equal(overlap.comparisons.filter((entry) => entry.relationship !== 'none').length, 8);
  assert.equal(overlap.comparisons.every((entry) => (
    entry.relationship === 'none' || entry.relationship === 'partial'
  )), true);

  const markdown = buildMarkdown(mapping);
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 114);
  assert.equal(parsed.unresolved.length, 55);
  assert.equal(new Set([...parsed.entries, ...parsed.unresolved].map((entry) => entry.sourceKey)).size, 169);
  assert.equal([...parsed.entries, ...parsed.unresolved].every((entry) => entry.sourceKey != null), true);
  assert.deepEqual(
    parsed.unresolved.map((entry) => Number(entry.sourceKey)),
    packet.sourceGaps.map((gap) => gap.sourcePosition),
  );

  assert.deepEqual(manifestRecord, mapping.approvedManifest);
  assert.equal(payload.count, 169);
  assert.equal(payload.placeholders, 55);
  assert.equal(payload.items.filter((item) => !item.placeholder).length, 114);
  assert.equal(payload.items.filter((item) => item.placeholder).length, 55);
  assert.deepEqual(
    payload.items.filter((item) => !item.placeholder).map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.deepEqual(
    payload.unresolved.map((entry) => Number(entry.sourceKey)),
    packet.sourceGaps.map((gap) => gap.sourcePosition),
  );
  assert.equal(catalogRecord.count, payload.count);
  assert.equal(catalogRecord.coverIssueId, 4500);
  assert.equal(
    `${catalogRecord.cover.path}.${catalogRecord.cover.ext}`,
    'https://i.annihil.us/u/prod/marvel/i/mg/9/e0/5718ee6a84c6b.jpg',
  );
  assert.equal(parseCatalog(catalog).dropped, 0);
});
