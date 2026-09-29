import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences,
  digestCanonicalJson,
  sourceCountsForPacket,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'x-23-reading-order';
const mappingPath = `scripts/data/cbh-mappings/${id}.json`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [packet, mapping, report, ledger, manifest, catalog, payload, inventory] = await Promise.all([
  readJson(`scripts/data/cbh-packets/${id}.json`),
  readJson(mappingPath),
  readJson(`scripts/data/cbh-overlaps/${id}.json`),
  readJson(`scripts/data/cbh-source-ledgers/${id}.json`),
  readJson('src/data/curated-lists.json'),
  readJson('src/data/catalog.json'),
  readJson('src/data/x_23_reading_order.json'),
  readJson('scripts/data/cbh-character-inventory.json'),
]);

function assertWholeVector(rows) {
  assert.equal(rows.length, 291);
  assert.deepEqual(rows.map((row) => row.sourcePosition),
    Array.from({ length: 291 }, (_, index) => index + 1));
  assert.equal(new Set(rows.map((row) => row.selectedIssueId)).size, 291);
  const vector = rows.map((row) => ({
    sourcePosition: row.sourcePosition,
    disposition: row.resolutionStatus,
    sourceIssueReference: row.sourceIssueReference,
    originalSeriesId: row.seriesId,
    originalIssueNumber: row.issueNumber,
    selectedIssueId: row.selectedIssueId,
  }));
  assert.equal(digestCanonicalJson(vector),
    'ad08408d14841cc58b48be2a02a29d76043617476b99053baf984dcbd19c0e64');
}

test('X-23 conserves all 291 source positions and the approved complete original vector', async () => {
  const markdown = await readFile(`src/data/orders/${id}.md`, 'utf8');
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assertWholeVector(mapping.rows);
  assert.deepEqual(sourceCountsForPacket(packet), {
    sourceOccurrenceCount: 291,
    sourceIdentityCount: 291,
    includedIssueCount: 291,
    sourceGapCount: 0,
    repeatedSourceReferenceCount: 0,
  });
  assert.equal(packet.expectedCount, 291);
  assert.equal(packet.proposedManifest.expect, 291);
  assert.equal(ledger.sourceOccurrenceCount, 291);
  assert.equal(ledger.selectedBlockCount, 38);
  assert.equal(ledger.sourceBlocks.length, 38);
  assert.deepEqual(Object.values(ledger.sectionCounts), [69, 42, 58, 53, 6, 63]);
  assert.equal(ledger.wholeIssueRepeatCount, 0);
  assert.equal(ledger.excludedReferences.length, 9);
  assert.equal(ledger.excludedReferences.filter((entry) => entry.kind.includes('fragment')).length, 5);
  assert.deepEqual(packet.excludedSourceReferences, ledger.excludedReferences.map((entry) =>
    `${entry.location}: ${entry.source}. ${entry.why}`));
  assert.deepEqual(ledger.selectedReferences.map((row) => [row.sourcePosition, row.selectedIssueId]),
    mapping.rows.map((row) => [row.sourcePosition, row.selectedIssueId]));
  assert.equal(ledger.sourceContentSha256, packet.sourceContentSha256);
  assert.equal(ledger.sourceContentSha256,
    '0043e51971b85739a12305324e93814df93435a56a5d1dea3c24a95b5cdaac7d');
  assert.match(ledger.sourceContentNormalization, /NFC/);
  const projection = ledger.sourceBlocks.map((block) => Object.fromEntries(
    ['section', 'heading', 'selection', 'deferredTo', 'sourceDirected']
      .filter((key) => Object.hasOwn(block, key)).map((key) => [key, block[key]])));
  assert.equal(digestCanonicalJson(projection), ledger.sourceIssueBearingBlocksSha256);
  assert.equal(ledger.sourceIssueBearingBlocksSha256, packet.sourceIssueBearingBlocksSha256);
  assert.equal(ledger.sourceIssueBearingBlocksSha256,
    'fcc78df1359b5315e11b8762483429a2feb48224b44223da969e82a3cbb23670');
  assert.match(ledger.sourceIssueBearingBlocksNormalization, /recursively sort object keys/i);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  assert.equal(parseChecklist(markdown).entries.length, 291);
  assert.deepEqual(payload.items.map((item) => [item.issueId, item.seriesId, item.number]),
    mapping.rows.map((row) => [row.selectedIssueId, row.seriesId, row.issueNumber]));
  assert.equal(payload.count, 291);
  assert.equal(payload.placeholders, 0);
  assert.deepEqual(payload.unresolved, []);
});

test('X-23 keeps distinct originals, deferred positions, decimals and late source limits', () => {
  const at = (position) => mapping.rows[position - 1];
  for (const [position, seriesId, number, issueId] of [
    [1, 766, '1', 1534],
    [7, 981, '1', 5629],
    [13, 22666, '1', 61789],
    [14, 45257, '1', 30246],
    [46, 749, '20', 3059],
    [69, 749, '43', 16468],
    [109, 3839, '26', 32583],
    [111, 3839, '28', 30674],
    [112, 9367, '1', 30255],
    [114, 9367, '3', 30260],
    [139, 13911, '13.1', 42171],
    [140, 13911, '13.2', 42170],
    [141, 13911, '13.3', 42662],
    [142, 13911, '13.4', 42663],
    [252, 30155, '1', 85662],
    [289, 27564, '43', 102304],
    [290, 27564, '44', 102305],
    [291, 27564, '45', 109774],
  ]) {
    assert.deepEqual([at(position).seriesId, at(position).issueNumber, at(position).selectedIssueId],
      [seriesId, number, issueId], `source position ${position} changed original`);
  }
  assert.equal(packet.proposedManifest.coverIssueId, at(1).selectedIssueId);
  assert.equal(ledger.sourceBlocks[0].deferredTo, 'III: X-23 (2010 ongoing) #1-3');
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 9367
    && ['1', '2', '3'].includes(row.issueNumber)).map((row) => row.sourcePosition),
  [112, 113, 114]);
  assert.deepEqual(mapping.rows.filter((row) => row.sourceRangeReference === 'X-Men: Second Coming: 26-28')
    .map((row) => row.issueNumber), ['26', '27', '28']);
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 27567)
    .map((row) => row.issueNumber), ['16', '17', '18', '19', '20']);
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 31324)
    .map((row) => row.issueNumber), Array.from({ length: 12 }, (_, i) => String(i + 7)));
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 27564)
    .map((row) => row.issueNumber), ['39', '40', '41', '42', '43', '44', '45']);
  assert.equal(mapping.rows.filter((row) => row.seriesId === 32109).length, 1);
  assert.equal(mapping.rows.find((row) => row.seriesId === 32109).issueNumber, '3');
  assert.match(at(252).sourceIssueReference, /FCBD 2020 \(X-Men\/Dark Ages\)/);
  assert.deepEqual(ledger.excludedReferences.filter((entry) =>
    entry.source.includes('X-Force Annual (2010) #1')).map((entry) => entry.kind),
  ['fragment', 'repeated fragment']);
  assert.ok(ledger.excludedReferences.some((entry) =>
    entry.source.includes('All-New Wolverine Saga #1')
    && entry.location.includes('deferred until IV') && entry.kind === 'deferred fragment'));
  assert.ok(ledger.excludedReferences.some((entry) =>
    entry.source.includes('Material From X Necrosha') && entry.kind === 'fragment'));
  assert.ok(ledger.excludedReferences.some((entry) =>
    entry.source.includes('Messiah CompleX') && entry.kind === 'title-only external pointer'));
  assert.ok(ledger.excludedReferences.some((entry) =>
    entry.source.includes('Death of Wolverine') && entry.kind === 'title-only external pointer'));
  assert.ok(!mapping.rows.some((row) => /Annual \(2010\)|All-New Wolverine Saga|Road To Hell/.test(
    row.sourceIssueReference)));
  assert.deepEqual(ledger.sourceAbsences.slice(0, 3),
    ['X-Men (2021) #1-6', 'X-Men (2019) #1-15', 'X-Force (2019) #1-38']);
});

test('X-23 publishes a credited and discoverable complete guide with approved lifecycle', () => {
  const entry = manifest.lists.find((item) => item.id === id);
  const catalogEntry = catalog.lists.find((item) => item.id === id);
  const record = inventory.find((item) => item.id === id);
  const index = manifest.lists.indexOf(entry);
  assert.deepEqual(entry, packet.proposedManifest);
  assert.equal(manifest.lists[index + 1].id, packet.insertionAnchor.beforeId);
  assert.equal(catalogEntry.id, id);
  assert.equal(entry.sourcePage, ledger.sourceUrl);
  assert.equal(entry.sourceLicense, null);
  assert.equal(entry.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
  assert.equal(entry.type, 'character-run');
  assert.equal(entry.spotlightKind, 'complete-guide');
  assert.equal(entry.depth, 'complete');
  assert.ok(entry.characters.includes('Laura Kinney'));
  assert.ok(entry.keywords.includes('All-New Wolverine'));
  assert.equal(record.position, 124);
  assert.equal(record.disposition, 'new-order');
  assert.equal(record.centralDisposition, 'pilot-approved');
  assert.equal(record.deliveryStatus, 'shipped');
  assert.deepEqual(record.catalogIds, [id]);
  assert.equal(record.sourceRetrievedAt, packet.sourceRetrievedAt);
  assert.equal(record.sourceContentSha256, packet.sourceContentSha256);
  assert.deepEqual(record.overlapIds, report.comparisons.filter((comparison) =>
    comparison.relationship !== 'none').map((comparison) => comparison.orderId).sort());
});

test('X-23 publication-time full-library review includes every reviewed peer and the actual coordinator receipt', async () => {
  const current = await buildReportForMapping(mappingPath, [], {
    excludedOrderIds: ['hawkeye-reading-order'],
  });
  const expectedOrderIds = manifest.lists.filter((entry) =>
    entry.id !== id && entry.id !== 'hawkeye-reading-order').map((entry) => entry.id);
  assert.deepEqual(current, report);
  assert.equal(report.candidateCount, 291);
  assert.equal(report.comparisonCount, 189);
  assert.equal(report.comparisonCount, expectedOrderIds.length);
  assert.deepEqual(new Set(report.comparisons.map((entry) => entry.orderId)),
    new Set(expectedOrderIds));
  assert.deepEqual(report.comparisons.reduce((counts, row) => {
    counts[row.relationship] = (counts[row.relationship] ?? 0) + 1;
    return counts;
  }, {}), { partial: 23, none: 165, 'existing-subset': 1 });
  assert.equal(report.comparisons.find((row) => row.orderId === 'messiah-war').relationship,
    'existing-subset');
  assert.equal(report.comparisons.find((row) =>
    row.orderId === 'thunderbolts-reading-order').relationship, 'none');
  assert.equal(report.comparisons.find((row) =>
    row.orderId === 'hope-summers-reading-order').relationship, 'partial');
  assert.equal(mapping.relationshipReview.approvalDigest,
    '5df5738c595464a253fde04de5ea708ed41b8f91fc08c29a432a613c5e3ca596');
  assert.equal(mapping.relationshipReview.dispositions.length, 189);
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: current.libraryDigest, expectedOrderIds,
  }));
});

test('X-23 conservation check rejects a collapsed one-shot or truncated final block', () => {
  const wrongOriginal = structuredClone(mapping.rows);
  wrongOriginal[13].selectedIssueId = 30255;
  assert.throws(() => assertWholeVector(wrongOriginal), /Expected values to be strictly equal/);
  assert.throws(() => assertWholeVector(mapping.rows.slice(0, -1)), /290 !== 291/);
});
