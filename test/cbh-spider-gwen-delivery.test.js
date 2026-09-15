import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertMappingMatchesPacketOccurrences,
  validateApprovalDigest,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'spider-gwen-reading-order';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const blockCounts = [
  5, 27, 5, 6, 6, 1, 1, 1, 1, 1, 1, 1, 1, 5, 4, 6, 1,
  1, 1, 1, 1, 1, 5, 6, 5, 8, 4, 6, 5, 5, 5, 7, 5,
];
const sourceRuns = [
  [19075, 1, 5], [17285, 7, 15], [17554, 32, 33], [18892, 1, 2],
  [18893, 1, 3], [18889, 1, 3], [18894, 1, 4], [18891, 6, 8], [18555, 1, 1],
  [19670, 1, 5], [20505, 1, 6], [20499, 7, 8], [20505, 7, 8], [20618, 6, 7],
  [21280, 1, 1], [20505, 7, 7], [20499, 7, 7], [20618, 6, 6],
  [20505, 8, 8], [20499, 8, 8], [20618, 7, 7], [21442, 1, 1],
  [20505, 9, 13], [20505, 14, 15], [21441, 1, 1], [21853, 1, 1],
  [20508, 12, 14], [20505, 16, 18],
  [20508, 12, 12], [20505, 16, 16], [20508, 13, 13],
  [20505, 17, 17], [20508, 14, 14], [20505, 18, 18],
  [20505, 19, 23], [20505, 24, 29], [20505, 30, 34],
  [26001, 0, 5], [26176, 1, 2], [26003, 1, 4], [26003, 5, 10],
  [27622, 1, 5], [27622, 6, 10], [33961, 1, 5], [34328, 1, 7], [36645, 1, 5],
];

test('Spider-Gwen preserves all source blocks and Latest Additions in literal page order', () => {
  assert.deepEqual(ledger.blocks.map((block) => block.occurrenceCount), blockCounts);
  assert.equal(blockCounts.reduce((sum, count) => sum + count, 0), 139);
  const sourceText = ledger.blocks.map((block) => block.sourceRangeReference);
  assert.equal(sourceText.filter((text) => text.startsWith('Collects:')).length, 19);
  assert.equal(createHash('sha256').update(JSON.stringify(sourceText)).digest('hex'),
    packet.sourceIssueBearingBlocksSha256);
  assert.equal(packet.sourceIssueBearingBlocksSha256,
    '03a1ea654bb01735df8a9c8673d475f99cfc77bc876fa3cf8f868d5ea15b4054');
  assert.deepEqual(ledger.occurrences.map((row) => row.sourcePosition),
    Array.from({ length: 139 }, (_, index) => index + 1));
  const expected = sourceRuns.flatMap(([seriesId, first, last]) => (
    Array.from({ length: last - first + 1 }, (_, index) => [seriesId, String(first + index)])
  ));
  assert.deepEqual(ledger.occurrences.map((row) => [row.seriesId, row.issueNumber]), expected);
  assert.deepEqual(sourceText.slice(-3), [
    'Collects: Spider-Gwen: Gwenverse #1 to #5',
    'Collects: Spider-Man (2022) #1 to #7',
    'Collects: Spider-Gwen: Shadow Clones (2023) #1 to #5',
  ]);
});

test('Spider-Gwen selects distinct 2015 runs, correct Silk and actual Alpha and Omega identities', () => {
  const series = (seriesId) => mapping.rows.filter((row) => row.seriesId === seriesId);
  assert.deepEqual(series(19670).map((row) => row.selectedIssueId),
    [52521, 52527, 52529, 52530, 52531]);
  assert.deepEqual(series(20505).map((row) => row.issueNumber),
    Array.from({ length: 34 }, (_, index) => String(index + 1)));
  assert.equal(series(20505)[0].selectedIssueId, 55674);
  assert.equal(series(20505).at(-1).selectedIssueId, 69471);
  assert.equal(series(19661).length, 0);
  assert.equal(series(19671).length, 0);
  assert.deepEqual(series(20499).map((row) => [row.issueNumber, row.selectedIssueId]),
    [['7', 55646], ['8', 55647]]);
  assert.deepEqual(series(20618).map((row) => [row.issueNumber, row.selectedIssueId]),
    [['6', 56169], ['7', 56170]]);
  assert.deepEqual(series(21280).map((row) => [row.sourcePosition, row.selectedIssueId]),
    [[50, 58381]]);
  assert.deepEqual(series(21442).map((row) => [row.sourcePosition, row.selectedIssueId]),
    [[57, 58832]]);
  assert.deepEqual(series(33961).map((row) => [row.seriesYear, row.selectedIssueId]),
    [[2022, 98443], [2022, 98444], [2022, 98445], [2022, 98446], [2022, 98447]]);
  assert.deepEqual(series(20508).map((row) => [row.issueNumber, row.selectedIssueId]),
    [['12', 55706], ['13', 55707], ['14', 55708]]);
});

test('Spider-Gwen records twelve backward repeats and the unnumbered collection boundary without gaps', () => {
  assert.equal(packet.rows.length, 127);
  assert.equal(packet.sourceOccurrenceCount, 139);
  assert.deepEqual(packet.repeatedSourceReferences.map((row) => [
    row.sourcePosition, row.canonicalRow,
  ]), [
    [51, 46], [52, 44], [53, 48], [54, 47], [55, 45], [56, 49],
    [73, 61], [74, 64], [75, 62], [76, 65], [77, 63], [78, 66],
  ]);
  assert.equal(packet.sourceGaps?.length ?? 0, 0);
  assert.equal(mapping.sourceGaps?.length ?? 0, 0);
  assert.equal(packet.excludedSourceReferences.length, 1);
  assert.match(packet.excludedSourceReferences[0], /^Gwenom vs Carnage:/);
  assert.match(packet.excludedSourceReferences[0], /supplies no issue numbers/);
  assert.ok(mapping.rows.every((row) => row.seriesId !== 31380));
  assert.deepEqual(mapping.rows.map((row) => [row.sourcePosition, row.selectedIssueId]),
    ledger.occurrences.filter((row) => row.disposition === 'exact')
      .map((row) => [row.sourcePosition, row.issueId]));
  for (const repeat of packet.repeatedSourceReferences) {
    const canonical = mapping.rows[repeat.canonicalRow - 1];
    assert.ok(canonical.sourcePosition < repeat.sourcePosition);
    assert.equal(ledger.occurrences[repeat.sourcePosition - 1].issueId,
      canonical.selectedIssueId);
  }
});

test('Spider-Gwen digests and approval preserve the reviewed source library', async () => {
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const currentReport = await buildReportForMapping(
    `scripts/data/cbh-mappings/${id}.json`, [], {
      excludedOrderIds: ['miles-morales-spider-man-reading-order', 'best-ultron-reading-order', 'winter-soldier-bucky-barnes-reading-order', 'spider-man-2099-reading-order'],
    },
  );
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => validateApprovalDigest(mapping.relationshipReview, id));
  assert.equal(report.comparisonCount, 175);
  assert.deepEqual(report.comparisons.map((row) => row.orderId).sort(),
    manifest.lists.filter((row) => row.id !== id
      && row.id !== 'miles-morales-spider-man-reading-order'
      && !['best-ultron-reading-order', 'winter-soldier-bucky-barnes-reading-order'].includes(row.id) && row.id !== 'spider-man-2099-reading-order').map((row) => row.id).sort());
  assert.deepEqual(currentReport.comparisons, report.comparisons);
  assert.equal(currentReport.libraryDigest, report.libraryDigest);
  assert.deepEqual(report.comparisons.filter((row) => row.relationship !== 'none')
    .map((row) => [row.orderId, row.relationship, row.sharedCount]), [
    ['amazing-spider-man-reading-order-modern-marvel-era', 'partial', 41],
    ['spider-geddon', 'partial', 11],
    ['spider-verse', 'partial', 31],
    ['venom-reading-order', 'partial', 1],
  ]);
  assert.equal(mapping.relationshipReview.dispositions.length, report.comparisonCount);
  assert.ok(mapping.relationshipReview.dispositions.every((row) => row.decision === 'approved'));
});

test('Spider-Gwen publishes the exact credited payload and auditable metadata reuse', async () => {
  const [markdown, payload, catalog, manifest] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson('src/data/spider_gwen_reading_order.json'),
    readJson('src/data/catalog.json'),
    readJson('src/data/curated-lists.json'),
  ]);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 127);
  assert.equal(parsed.unresolved.length, 0);
  assert.deepEqual(payload.items.map((item) => item.issueId),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, 127);
  assert.ok(payload.items.every((item) => item.description === null
    && item.issueId > 0 && !item.placeholder && item.seriesId && item.cover?.path));
  const manifestEntry = manifest.lists.find((row) => row.id === id);
  const catalogEntry = catalog.lists.find((row) => row.id === id);
  assert.equal(manifestEntry.sourcePage, 'https://www.comicbookherald.com/spider-gwen-reading-order/');
  assert.equal(catalogEntry.source, manifestEntry.sourcePage);
  for (const source of [manifestEntry, catalogEntry]) {
    assert.equal(source.name, 'Spider-Gwen / Ghost-Spider');
    assert.equal(source.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
    assert.equal(source.sourceLicense, null);
    assert.equal(source.depth, 'complete');
    assert.equal(source.spotlightKind, 'complete-guide');
    assert.ok(source.keywords.includes('Ghost Spider'));
    assert.match(source.description, /unnumbered Gwenom vs Carnage/);
  }
  assert.equal(payload.items[0].issueId, 50954);
  assert.equal(payload.items.at(-1).issueId, 105956);
  assert.equal(ledger.metadataHydration.reusedCount, 60);
  assert.equal(ledger.metadataHydration.fetchedCount, 67);
  assert.equal(ledger.metadataHydration.records.length, 127);
  const hashes = new Map();
  for (const record of ledger.metadataHydration.records) {
    if (record.kind !== 'reconstructed-from-pinned-payload') continue;
    if (!hashes.has(record.file)) {
      hashes.set(record.file, createHash('sha256')
        .update((await readFile(record.file, 'utf8')).replace(/\r\n/g, '\n')).digest('hex'));
    }
    assert.equal(record.hashBasis, 'UTF-8 source text with LF line endings');
    assert.equal(record.sha256, hashes.get(record.file));
    assert.match(record.note, /not a fresh HTTP response/);
  }
});
