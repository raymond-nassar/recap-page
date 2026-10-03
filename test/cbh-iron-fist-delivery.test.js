import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences,
  digestCanonicalJson,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { placeholderId } from '../scripts/lib/placeholder-id.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'iron-fist-reading-order';
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const packetPath = `scripts/data/cbh-packets/${id}.json`;
const mappingPath = `scripts/data/cbh-mappings/${id}.json`;
const [packet, mapping, ledger] = await Promise.all([
  readJson(packetPath), readJson(mappingPath),
  readJson(`scripts/data/cbh-source-ledgers/${id}.json`),
]);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const normalizeCrLf = (text) => text.replace(/\r\n/g, '\n');

test('Iron Fist conserves its approved source, original, gap and repeat identities', () => {
  assert.equal(packet.packetDigest,
    '1268ac4816f3fed217405c7eae4024c4cde8f0ad8c3a682cae666ad2fe274638');
  assert.equal(mapping.mappingDigest,
    'e48c7e646b0a53bd0eaaf45f4db56a55fe130f0e76c289912afe38de01509ade');
  assert.equal(ledger.sourceContentSha256, packet.sourceContentSha256);
  assert.equal(ledger.sourceIssueBearingBlocksSha256, packet.sourceIssueBearingBlocksSha256);
  for (const [field, value] of [
    ['sourceIssueBearingBlocksSha256', ledger.sourceOnlyProjection],
    ['printedOccurrencesSha256', ledger.printedOccurrences],
    ['selectedDecisionProjectionSha256', ledger.selectedDecisionProjection],
    ['selectedOccurrencesSha256', ledger.selectedOccurrences],
  ]) {
    assert.equal(ledger[field], digestCanonicalJson(value), `${field} does not describe its retained facts`);
  }
  assert.equal(ledger.sourceIssueBearingBlocksSha256,
    '3ad765cfd6ccc172c54789e3cbff99689adfbd93d999a9bd502e057edd4443ee');
  assert.equal(ledger.selectedDecisionProjectionSha256,
    'ce03c6c538a5e96826fb0407b2809b488ce7a7d75f51d195ba0dbd706b4ab7cd');
  assert.equal(ledger.printedReferenceCount, 435);
  assert.equal(packet.sourceOccurrenceCount, 430);
  assert.equal(packet.expectedCount, 376);
  assert.equal(mapping.rows.length, 376);
  assert.equal(mapping.sourceGaps.length, 38);
  assert.equal(mapping.repeatedSourceReferences.length, 16);
  assert.equal(new Set(mapping.rows.map((row) => row.selectedIssueId)).size, 376);
  assert.deepEqual([...mapping.rows, ...mapping.sourceGaps, ...mapping.repeatedSourceReferences]
    .map((row) => row.sourcePosition).sort((a, b) => a - b),
  Array.from({ length: 430 }, (_, index) => index + 1));
  for (const repeat of mapping.repeatedSourceReferences) {
    const original = mapping.rows[repeat.canonicalRow - 1];
    assert.ok(original.sourcePosition < repeat.sourcePosition);
    assert.deepEqual([repeat.normalizedSeriesTitle, repeat.issueNumber],
      [original.normalizedSeriesTitle, original.issueNumber]);
  }
  assert.deepEqual(mapping.sourceGaps.filter((row) => row.sourcePosition >= 140
    && row.sourcePosition <= 155).map((row) => row.issueNumber),
  Array.from({ length: 16 }, (_, index) => String(index + 19)),
  );
  assert.equal(new Set(mapping.sourceGaps.filter((row) => row.sourcePosition >= 140
    && row.sourcePosition <= 155).map((row) => row.sourceRangeReference),
  ).size, 1);
  assert.ok(mapping.sourceGaps.find((row) => row.sourcePosition === 179)
    .sourceRangeReference.includes('story material'));
  assert.ok(mapping.rows.some((row) => row.selectedIssueId === 59301
    && row.sourceIssueReference.includes('#9')));
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
});

test('Iron Fist retains its publication-time relationship review and unchanged named checklist', async () => {
  const [report, manifest, markdownBytes] = await Promise.all([
    readJson(`scripts/data/cbh-overlaps/${id}.json`),
    readJson('src/data/curated-lists.json'),
    readFile(`src/data/orders/${id}.md`),
  ]);
  const peers = manifest.lists.filter((entry) => entry.id !== id
    && entry.id !== 'mcu-prep-daredevil-born-again' && entry.id !== 'mcu-prep-thunderbolts');
  const live = await buildReportForMapping(mappingPath, [], {
    excludedOrderIds: ['mcu-prep-thunderbolts', 'mcu-prep-daredevil-born-again'],
  });
  assert.deepEqual(report, live);
  assert.equal(report.comparisonCount, peers.length);
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: live.libraryDigest,
    expectedOrderIds: peers.map((entry) => entry.id),
  }));
  const pending = { ...mapping, reviewStatus: 'pending-independent-review' };
  delete pending.packetReview;
  delete pending.approvedManifest;
  delete pending.relationshipReview;
  assert.throws(() => assertApprovedRelationshipReview({
    packet, mapping: pending, report, currentLibraryDigest: live.libraryDigest,
    expectedOrderIds: peers.map((entry) => entry.id),
  }));
  assert.equal(report.comparisonCount, 202);
  assert.equal(report.libraryDigest,
    'f848b51201db507b5a0d807b50a239f6192a2f3d5f2a14e85dd1bef84f6a63d9');
  assert.equal(report.reportDigest,
    'eb36bd14a7472e35b0823c9434125798a0233022c2869f95f8cd39c39130e25a');
  assert.deepEqual(report.comparisons.reduce((counts, row) => {
    counts[row.relationship] = (counts[row.relationship] ?? 0) + 1;
    return counts;
  }, {}), { none: 173, partial: 28, 'existing-subset': 1 });
  assert.deepEqual(report.comparisons.find((row) => row.orderId
    === 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order'),
  {
    orderId: 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order',
    sharedCount: 0, sharedIds: [], relationship: 'none',
  });
  assert.deepEqual(report.comparisons.find((row) =>
    row.orderId === 'namor-sub-mariner-reading-order')?.sharedIds,
  ['66014', '66015', '66016', '66017', '66018', '66019', '66020', '66021', '66022',
    '39757', '39762', '39763', '39758', '39759', '39761', '39760', '39767',
    '39766', '39765', '39764', '39756']);
  const markdown = normalizeCrLf(markdownBytes.toString('utf8'));
  assert.equal(markdown, buildMarkdown(mapping));
  assert.ok(!markdown.includes('\r'));
  assert.equal(sha(markdown), 'ff8b02b7579de4469a00fc74c8cb98fe3f84c65ad7d6666d8714574dac6cafd3');
  const parsed = parseChecklist(markdown);
  const ordered = [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index);
  assert.equal(ordered.length, 414);
  assert.deepEqual(ordered.map((row) => Number(row.sourceKey)),
    [...mapping.rows, ...mapping.sourceGaps]
      .map((row) => row.sourcePosition).sort((a, b) => a - b));
  assert.deepEqual(parsed.entries.map((row) => row.issueId),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.ok(ordered.filter((row) => Number(row.sourceKey) >= 140
    && Number(row.sourceKey) <= 155).every((row) =>
    /Iron Fist-relevance continuation.*outside.*Volume 2/i.test(row.section)));
  assert.ok(ordered.filter((row) => Number(row.sourceKey) >= 179
    && Number(row.sourceKey) <= 188).every((row) =>
    /Heroes for Hire story material/i.test(row.section)));
  const position = manifest.lists.findIndex((entry) => entry.id === id);
  assert.ok(position >= 0);
  assert.equal(manifest.lists[position + 1].id, 'ultimate-spider-man-reading-order');
  assert.deepEqual(manifest.lists[position], packet.proposedManifest);
});

test('Iron Fist pinned payload and catalog retain all 414 original slots, cover and one detail refusal', async () => {
  const [payload, catalog, markdown, manifest, partition, vector, inventory, report] = await Promise.all([
    readJson('src/data/iron_fist_reading_order.json'),
    readJson('src/data/catalog.json'),
    readFile(`src/data/orders/${id}.md`, 'utf8').then(normalizeCrLf),
    readJson('src/data/curated-lists.json'),
    readJson('scripts/data/marvel-knights-to-planet-x-overlaps.json'),
    readJson('test/fixtures/iron-fist-browser-vector.json'),
    readJson('scripts/data/cbh-character-inventory.json'),
    readJson(`scripts/data/cbh-overlaps/${id}.json`),
  ]);
  const parsed = parseChecklist(markdown);
  const ordered = [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index);
  const expectedIds = ordered.map((row) => row.issueId
    ?? placeholderId(id, row.title, row.sourceKey));
  assert.equal(payload.count, 414);
  assert.equal(payload.placeholders, 38);
  assert.equal(payload.items.length, 414);
  assert.equal(payload.unresolved.length, 38);
  assert.deepEqual(payload.items.map((row) => row.issueId), expectedIds);
  assert.equal(new Set(expectedIds).size, 414);
  assert.deepEqual(payload.items.map((row) => row.collectedIn), ordered.map((row) => row.section));
  assert.deepEqual(payload.items.filter((row) => row.placeholder).map((row) => row.issueId),
    expectedIds.filter((issueId) => issueId < 0));
  assert.deepEqual(payload.items.filter((row) => row.detailsRefused).map((row) => row.issueId),
    [59301]);
  const refused = payload.items.find((row) => row.issueId === 59301);
  assert.equal(refused.placeholder, undefined);
  assert.equal(refused.digitalId, null);
  assert.equal(payload.items.find((row) => row.issueId === 10201).cover.ext, 'jpg');
  const parsedCatalog = parseCatalog(catalog);
  assert.equal(parsedCatalog.dropped, 0);
  const listed = catalog.lists.find((entry) => entry.id === id);
  assert.deepEqual([listed.count, listed.placeholderCount, listed.coverIssueId], [414, 38, 10201]);
  assert.deepEqual([listed.type, listed.depth, listed.spotlightKind, listed.timeline],
    ['character-run', 'partial', 'other', null]);
  assert.equal(manifest.lists.length, 205);
  assert.equal(catalog.lists.length, 282);
  assert.equal(catalog.lists.filter((entry) => entry.type === 'character-run').length, 70);
  assert.equal(catalog.lists.filter((entry) => entry.type === 'character-run'
    && entry.id !== id).length, 69);
  assert.equal(catalog.lists.filter((entry) => entry.sourceLicense != null).length, 0);
  assert.equal(manifest.lists.find((entry) => entry.id === id).sourceLicense, null);
  const inventoryEntry = inventory.find((entry) => entry.id === id);
  assert.deepEqual([inventoryEntry.position, inventoryEntry.deliveryStatus,
    inventoryEntry.centralDisposition, inventoryEntry.metadataHorizonStatus],
  [53, 'shipped', 'pilot-approved', 'approved']);
  assert.deepEqual(inventoryEntry.catalogIds, [id]);
  assert.deepEqual(inventoryEntry.overlapIds, report.comparisons
    .filter((row) => row.relationship !== 'none').map((row) => row.orderId));
  assert.equal(inventoryEntry.overlapIds.length, 29);
  for (const entry of [payload, listed]) {
    assert.equal(entry.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
    assert.equal(entry.sourceLicense, null);
  }
  assert.equal(partition.pairCount, 83);
  assert.equal(partition.existingListCount, 23);
  assert.equal(partition.sharedOccurrenceCount, 443);
  assert.deepEqual(partition.pairs.filter((row) => row.existingListId === id), [{
    chapterId: 'marvel-knights-to-planet-x-26',
    existingListId: id,
    sharedCount: 3,
    sharedIssueIds: [15640, 15641, 15643],
  }]);
  assert.deepEqual(vector.rows.map((row) => row.issueId), expectedIds);
  assert.deepEqual(vector.rows.map((row) => row.sourcePosition),
    ordered.map((row) => Number(row.sourceKey)));
  assert.deepEqual(vector.rows.map((row) => [row.title, row.section]),
    payload.items.map((row) => [row.title, row.collectedIn]));
  assert.equal(sha(normalizeCrLf(await readFile('test/fixtures/iron-fist-browser-vector.json', 'utf8'))),
    '3798f250df864c72e8ca26f7d61457ed4b2d5e108b566824fef4c5a9d25633d0');
  assert.equal(vector.rows.filter((row) => row.placeholder).length, 38);
  assert.equal(vector.rows.filter((row) => row.detailsRefused).length, 1);
});
