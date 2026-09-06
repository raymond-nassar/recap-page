import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

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
const expectedVector = [
  [9, 1629], [10, 1721], [11, 1830], [12, 1941], [13, 2049], [14, 2162],
  [15, 2328], [16, 2448], [17, 3018], [18, 3359], [19, 3887], [20, 4252],
  [21, 3222], [43, 37421], [59, 45717], [66, 10002], [67, 10003],
  [112, 61282], [113, 61283], [114, 61284], [115, 61285], [116, 61286],
  [117, 61287], [140, 57030], [141, 57034], [142, 58371], [143, 57529],
  [144, 57530], [145, 57611], [149, 57612], [150, 58372], [151, 58373],
  [152, 58374], [153, 59419], [155, 59420], [156, 60134], [157, 60135],
  [158, 60136], [159, 60137], [160, 61035], [161, 61036], [163, 70101],
  [164, 70102], [165, 70103], [166, 70104], [213, 95052], [216, 101168],
  [217, 107310], [218, 110207], [219, 97124], [220, 105865],
];
const contextPositions = [169, 194, 214, 215];
const settledPositions = new Set(expectedVector.map(([sourcePosition]) => sourcePosition));
const settledIds = new Set(expectedVector.map(([, issueId]) => issueId));

async function readJson(...segments) {
  return JSON.parse(await readFile(path.join(root, ...segments), 'utf8'));
}

test('Young Avengers publishes the reviewed 51-issue settlement in frozen source order', async () => {
  const [ledger, packet, mapping, overlap, inventory, manifest, payload, catalog, markdown] = await Promise.all([
    readJson('scripts', 'data', 'cbh-source-ledgers', `${id}.json`),
    readJson('scripts', 'data', 'cbh-packets', `${id}.json`),
    readJson('scripts', 'data', 'cbh-mappings', `${id}.json`),
    readJson('scripts', 'data', 'cbh-overlaps', `${id}.json`),
    readJson('scripts', 'data', 'cbh-character-inventory.json'),
    readJson('src', 'data', 'curated-lists.json'),
    readJson('src', 'data', 'young_avengers_reading_order.json'),
    readJson('src', 'data', 'catalog.json'),
    readFile(path.join(root, 'src', 'data', 'orders', `${id}.md`), 'utf8'),
  ]);
  const inventoryRecord = inventory.find((entry) => entry.id === id);
  const manifestRecord = manifest.lists.find((entry) => entry.id === id);
  const catalogRecord = catalog.lists.find((entry) => entry.id === id);
  const parsed = parseChecklist(markdown);
  const mappingVector = mapping.rows
    .filter((row) => settledPositions.has(row.sourcePosition))
    .map((row) => [row.sourcePosition, Number(row.selectedIssueId)]);
  const resolutionVector = packet.sourceGapResolutions
    .map((resolution) => [resolution.sourcePosition, resolution.selectedIssueId]);

  assert.equal(ledger.sourceOccurrenceCount, 220);
  assert.deepEqual(ledger.counts, {
    exclusion: 51,
    exact: 169,
    repeat: 0,
    gap: 0,
  });
  assert.equal(packet.rows.length, 165);
  assert.equal(packet.sourceGaps.length, 4);
  assert.equal(packet.excludedSourceRows.length, 51);
  assert.equal(packet.sourceGapResolutions.length, 51);
  assert.equal(packet.rows.length + packet.sourceGaps.length + packet.excludedSourceRows.length, 220);
  assert.equal(new Set(packet.rows.map((row) => row.candidateIssueId)).size, 165);
  assert.deepEqual(packet.sourceGaps.map((gap) => gap.sourcePosition), contextPositions);
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
  assert.equal(overlap.comparisons.filter((entry) => entry.relationship !== 'none').length, 9);
  assert.equal(overlap.comparisons.every((entry) => (
    entry.relationship === 'none' || entry.relationship === 'partial'
  )), true);
  assert.deepEqual(mapping.sourceGapResolutions, packet.sourceGapResolutions);
  assert.deepEqual(mappingVector, expectedVector);
  assert.deepEqual(resolutionVector, expectedVector);
  assert.equal(packet.sourceGapResolutions.every((resolution) => (
    resolution.resolutionKind === 'exact-issue'
  )), true);

  assert.equal(parsed.entries.length, 165);
  assert.equal(parsed.unresolved.length, 4);
  assert.equal(new Set([...parsed.entries, ...parsed.unresolved].map((entry) => entry.sourceKey)).size, 169);
  assert.equal([...parsed.entries, ...parsed.unresolved].every((entry) => entry.sourceKey != null), true);
  assert.deepEqual(
    parsed.unresolved.map((entry) => Number(entry.sourceKey)),
    contextPositions,
  );
  assert.deepEqual(
    parsed.entries
      .filter((entry) => settledPositions.has(Number(entry.sourceKey)))
      .map((entry) => [Number(entry.sourceKey), Number(entry.issueId)]),
    expectedVector,
  );

  assert.deepEqual(manifestRecord, mapping.approvedManifest);
  assert.equal(payload.count, 169);
  assert.equal(payload.placeholders, 4);
  assert.equal(payload.items.filter((item) => !item.placeholder).length, 165);
  assert.equal(payload.items.filter((item) => item.placeholder).length, 4);
  assert.deepEqual(
    payload.items.filter((item) => !item.placeholder).map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.deepEqual(
    payload.unresolved.map((entry) => Number(entry.sourceKey)),
    contextPositions,
  );
  assert.deepEqual(
    payload.items
      .filter((item) => settledIds.has(Number(item.issueId)))
      .map((item) => Number(item.issueId)),
    expectedVector.map(([, issueId]) => issueId),
  );
  assert.equal(catalogRecord.count, payload.count);
  assert.equal(catalogRecord.placeholderCount, 4);
  assert.equal(catalogRecord.coverIssueId, 4500);
  assert.equal(
    `${catalogRecord.cover.path}.${catalogRecord.cover.ext}`,
    'https://i.annihil.us/u/prod/marvel/i/mg/9/e0/5718ee6a84c6b.jpg',
  );

  const settledCandidates = mapping.candidateMetadata.filter((candidate) => (
    settledIds.has(Number(candidate.id))
  ));
  assert.equal(settledCandidates.length, 51);
  assert.equal(settledCandidates.every((candidate) => (
    candidate.detailUrl.startsWith(`https://www.marvel.com/comics/issue/${candidate.id}/`)
  )), true);
  assert.equal(mapping.rows.filter((row) => (
    row.sourcePosition >= 112 && row.sourcePosition <= 117
  )).every((row) => (
    row.seriesId === 22533 && row.resolvedSeriesTitle === 'Hawkeye (2016 - 2018)'
  )), true);
  const guardians = mapping.rows.find((row) => row.sourcePosition === 220);
  assert.equal(guardians.selectedIssueId, 105865);
  assert.equal(guardians.seriesId, 36593);
  assert.equal(guardians.resolvedSeriesTitle, 'Guardians of the Galaxy (2023 - Present)');
  assert.equal(parseCatalog(catalog).dropped, 0);
});
