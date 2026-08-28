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
const id = 'runaways-reading-order';
const excludedPositions = [73, 74];
const canonicalPositions = Array.from({ length: 116 }, (_, index) => index + 1)
  .filter((position) => !excludedPositions.includes(position));

async function readJson(...segments) {
  return JSON.parse(await readFile(path.join(root, ...segments), 'utf8'));
}

function assertSourceAccounting(ledger, packet) {
  assert.equal(ledger.sourceBoundary.scope, 'full page');
  assert.equal(ledger.sourceBoundary.qualifyingSection, null);
  assert.match(ledger.sourceBoundary.rationale, /no Best Comics or Essential Comics/i);
  assert.equal(ledger.sourceOccurrenceCount, 116);
  assert.deepEqual(ledger.counts, {
    exact: 114,
    exclusion: 2,
    repeat: 0,
    gap: 0,
  });
  assert.deepEqual(
    ledger.occurrences.map((row) => row.position),
    Array.from({ length: 116 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    ledger.occurrences.reduce((counts, row) => {
      counts[row.sourceGroup] = (counts[row.sourceGroup] ?? 0) + 1;
      return counts;
    }, {}),
    {
      "I) Brian K. Vaughn and Adrian Alphona's Runaways": 37,
      'II) Runaways Meet Marvel Civil War and Secret Invasion, and Joss Whedon Joins': 20,
      'III) Terry Moore and Stuart Immonen Revive the Runaways Ongoing': 16,
      'IV) The Runaways of Secret Wars': 5,
      'Latest Additions:': 38,
    },
  );
  assert.deepEqual(
    packet.rows.map((row) => row.sourcePosition),
    canonicalPositions,
  );
  assert.deepEqual(
    packet.excludedSourceRows.map((row) => row.sourcePosition),
    excludedPositions,
  );
  assert.match(packet.excludedSourceRows[0].reason, /House of M \(2009\) #1/i);
  assert.match(packet.excludedSourceRows[1].reason, /Runaways \(2015\) #1/i);
  assert.equal(Object.hasOwn(packet, 'sourceGaps'), false);
}

test('Runaways publishes exact reader-visible rows while preserving owner-directed source exclusions', async () => {
  const [ledger, settlement, packet, mapping, overlap, inventory, manifest, payload, catalog, markdown] = await Promise.all([
    readJson('scripts', 'data', 'cbh-source-ledgers', `${id}.json`),
    readJson('scripts', 'data', 'cbh-provider-settlements', `${id}.json`),
    readJson('scripts', 'data', 'cbh-packets', `${id}.json`),
    readJson('scripts', 'data', 'cbh-mappings', `${id}.json`),
    readJson('scripts', 'data', 'cbh-overlaps', `${id}.json`),
    readJson('scripts', 'data', 'cbh-character-inventory.json'),
    readJson('src', 'data', 'curated-lists.json'),
    readJson('src', 'data', 'runaways_reading_order.json'),
    readJson('src', 'data', 'catalog.json'),
    readFile(path.join(root, 'src', 'data', 'orders', `${id}.md`), 'utf8'),
  ]);
  const inventoryRecord = inventory.find((entry) => entry.id === id);
  const manifestRecord = manifest.lists.find((entry) => entry.id === id);
  const catalogRecord = catalog.lists.find((entry) => entry.id === id);
  const parsed = parseChecklist(markdown);

  assertSourceAccounting(ledger, packet);
  assert.deepEqual(settlement.partition, {
    exact: 113,
    'owner-validated': 1,
    'metadata-absent': 2,
    ambiguous: 0,
    operational: 0,
  });
  assert.equal(settlement.retrieval.serialized, true);
  assert.equal(settlement.retrieval.noImageBytesStored, true);
  assert.deepEqual(settlement.retrieval.cache.metrics.errors, []);
  assert.equal(settlement.rows.length, 116);
  assert.deepEqual(
    settlement.rows
      .filter((row) => row.readerDisposition === 'owner-directed-exclusion')
      .map((row) => row.sourcePosition),
    excludedPositions,
  );
  assert.deepEqual(
    settlement.rows
      .filter((row) => row.ownerDirectedReason != null)
      .map((row) => row.sourcePosition),
    excludedPositions,
  );
  assert.deepEqual(
    ledger.occurrences
      .filter((row) => row.ownerDirectedReason != null)
      .map((row) => row.position),
    excludedPositions,
  );
  const freeComicDay = settlement.rows.find((row) => row.sourcePosition === 37);
  assert.equal(freeComicDay.selectedIssueId, 15695);
  assert.equal(freeComicDay.resolution, 'owner-validated');
  assert.equal(freeComicDay.hydrated.digitalId, 3128);
  assert.equal(freeComicDay.ownerProvidedIssueUrl, 'https://www.marvel.com/comics/issue/15695/read');
  const runaways2015IssueFour = settlement.rows.find((row) => row.sourcePosition === 77);
  assert.equal(runaways2015IssueFour.selectedIssueId, 51800);
  assert.equal(runaways2015IssueFour.hydrated.digitalId, 40007);

  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: id,
    inventoryRecord,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(overlap));
  assert.equal(mapping.rows.length, 114);
  assert.deepEqual(mapping.rows.map((row) => row.sourcePosition), canonicalPositions);
  assert.equal(mapping.rows.find((row) => row.sourcePosition === 37).selectedIssueId, 15695);
  assert.equal(mapping.rows.find((row) => row.sourcePosition === 77).selectedIssueId, 51800);

  assert.equal(overlap.comparisonCount, 138);
  assert.deepEqual(
    overlap.comparisons.filter((row) => row.relationship !== 'none').map((row) => ({
      orderId: row.orderId,
      relationship: row.relationship,
      sharedIds: row.sharedIds,
    })),
    [
      { orderId: 'civil-war', relationship: 'partial', sharedIds: ['4500', '4821', '5114', '5267'] },
      { orderId: 'civil-war-avengers', relationship: 'partial', sharedIds: ['4500', '4821', '5114', '5267'] },
      { orderId: 'secret-invasion', relationship: 'partial', sharedIds: ['21414', '21588', '21785'] },
    ],
  );

  assert.equal(inventoryRecord.deliveryStatus, 'ready');
  assert.deepEqual(inventoryRecord.overlapIds, ['civil-war', 'civil-war-avengers', 'secret-invasion']);
  assert.deepEqual(manifestRecord, mapping.approvedManifest);
  assert.equal(payload.count, 114);
  assert.equal(payload.placeholders, 0);
  assert.deepEqual(payload.unresolved, []);
  assert.equal(payload.items.length, 114);
  assert.equal(payload.items.some((item) => item.placeholder), false);
  assert.equal(payload.items.some((item) => item.issueId === 15695), true);
  assert.equal(payload.items.some((item) => item.issueId === 51800), true);
  assert.equal(parsed.entries.length, 114);
  assert.equal(parsed.unresolved.length, 0);
  assert.deepEqual(parsed.entries.map((entry) => Number(entry.sourceKey)), canonicalPositions);
  assert.equal(catalogRecord.count, 114);
  assert.equal(catalogRecord.coverIssueId, 15061);
  assert.equal(parseCatalog(catalog).dropped, 0);
});

test('Runaways source accounting rejects omitted source positions and visible exclusions', async () => {
  const [ledger, packet] = await Promise.all([
    readJson('scripts', 'data', 'cbh-source-ledgers', `${id}.json`),
    readJson('scripts', 'data', 'cbh-packets', `${id}.json`),
  ]);
  assertSourceAccounting(ledger, packet);

  const missingExclusion = structuredClone(packet);
  missingExclusion.excludedSourceRows.pop();
  assert.throws(() => assertSourceAccounting(ledger, missingExclusion));

  const visibleOwnerExclusion = structuredClone(packet);
  visibleOwnerExclusion.rows.push({
    ...ledger.occurrences.find((row) => row.position === 74),
    sourcePosition: 74,
    sourceIssueReference: 'Runaways (2015) #1',
    sourceRangeReference: 'IV) The Runaways of Secret Wars',
    normalizedSeriesTitle: 'Runaways',
    seriesYear: 2015,
    issueNumber: '1',
    seriesId: 19416,
    candidateIssueId: 0,
    manualSeriesSelectionApproved: false,
  });
  visibleOwnerExclusion.expectedCount += 1;
  assert.throws(() => assertSourceAccounting(ledger, visibleOwnerExclusion));
});
