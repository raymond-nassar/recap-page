import assert from 'node:assert/strict';
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

const id = 'mephisto-reading-order';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const blockCounts = [
  5, 8, 12, 11, 11, 13, 16, 13, 20, 19, 18, 11, 11, 9, 4, 19, 14, 10, 17,
  19, 16, 6, 8, 16, 18, 17, 17, 19, 6, 4, 13, 4, 6, 6, 5, 9, 5, 7, 8, 7,
  8, 5, 1, 5, 1, 6, 6, 8, 15, 6, 6, 5, 5, 6, 6, 4, 8,
];

test('Mephisto preserves all 57 source blocks, five gaps and two backward repeats', () => {
  assert.deepEqual(ledger.blocks.map((block) => block.occurrenceCount), blockCounts);
  assert.equal(blockCounts.reduce((sum, count) => sum + count, 0), 558);
  assert.deepEqual(ledger.occurrences.map((row) => row.sourcePosition),
    Array.from({ length: 558 }, (_, index) => index + 1));
  assert.equal(packet.rows.length, 551);
  assert.equal(packet.sourceOccurrenceCount, 558);
  assert.equal(packet.repeatedSourceReferences.length, 2);
  assert.equal(packet.excludedSourceReferences.length, 0);
  assert.deepEqual(packet.sourceGaps.map((gap) => gap.sourcePosition), [76, 88, 145, 214, 260]);
  assert.deepEqual(packet.sourceGaps.map((gap) => gap.sourceIssueReference), [
    'Marvel Treasury Edition (1974) #2',
    'Doctor Strange Annual (1976) #1',
    'Epic Illustrated (1980) #1',
    'Marvel Graphic Novel: Doctor Strange and Doctor Doom - Triumph and Torment (1989)',
    'Thor Annual (1966) #15',
  ]);
  assert.ok(packet.sourceGaps.every((gap) => gap.kind === 'published-metadata-gap'
    && gap.status === 'open'
    && gap.evidenceSources.some((source) => source.url
      === 'https://github.com/raymond-nassar/recap-page/issues/493')));
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
  assert.deepEqual(mapping.rows.map((row) => [row.sourcePosition, row.selectedIssueId]),
    ledger.occurrences.filter((row) => row.disposition === 'exact')
      .map((row) => [row.sourcePosition, row.issueId]));
  for (const repeat of packet.repeatedSourceReferences) {
    const canonical = mapping.rows[repeat.canonicalRow - 1];
    assert.ok(canonical.sourcePosition < repeat.sourcePosition);
    assert.equal(canonical.issueNumber, repeat.issueNumber);
    assert.equal(canonical.normalizedSeriesTitle, repeat.normalizedSeriesTitle);
  }
});

test('Mephisto selects the correct annual, Wolverine run, one-shots and decimal issues', () => {
  const byPosition = new Map(mapping.rows.map((row) => [row.sourcePosition, row]));
  assert.equal(byPosition.get(1).selectedIssueId, 30224);
  assert.equal(byPosition.get(1).seriesId, 9962);
  assert.equal(byPosition.get(324).selectedIssueId, 76626);
  assert.equal(byPosition.get(324).seriesId, 27508);
  assert.equal(byPosition.get(375).selectedIssueId, 14433);
  assert.equal(byPosition.get(375).seriesId, 465);
  assert.equal(byPosition.get(458).selectedIssueId, 49360);
  assert.equal(byPosition.get(458).seriesId, 18561);
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 24304)
    .map((row) => row.selectedIssueId), [67223, 67224, 67225, 67226]);
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 7455)
    .map((row) => row.issueNumber), ['11', '33', '34', '35', '36', '37', '42', '43']);
  for (const [position, issueId] of [[471, 52763], [477, 52761]]) {
    assert.equal(byPosition.get(position).selectedIssueId, issueId);
    assert.equal(byPosition.get(position).metadataIssueNumber, '0');
  }
  assert.ok(mapping.rows.some((row) => row.seriesId === 14018 && row.issueNumber === '0.1'));
  assert.ok(mapping.rows.some((row) => row.seriesId === 14764 && row.issueNumber === '626.1'));
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 13911)
    .map((row) => row.issueNumber),
  ['10', '11', '12', '13', '13.1', '13.2', '13.3', '13.4', '14', '27.1', '36', '37', '38', '39', '40', '41', '42']);
  assert.ok(mapping.rows.some((row) => row.seriesId === 2288 && row.issueNumber === '-1'));
  assert.equal(mapping.rows.at(-1).selectedIssueId, 84356);
  assert.equal(mapping.rows.at(-1).sourcePosition, 558);
});

test('Mephisto packet, mapping and relationship approval retain their digest contracts', async () => {
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const currentReport = await buildReportForMapping(
    `scripts/data/cbh-mappings/${id}.json`, [], {
      excludedOrderIds: ['miles-morales-spider-man-reading-order', 'spider-gwen-reading-order', 'best-ultron-reading-order', 'winter-soldier-bucky-barnes-reading-order', 'spider-man-2099-reading-order', 'donny-cates-marvel-universe-reading-order-2017', 'falcon-sam-wilson-captain-america-reading-order', 'the-vision-reading-order', 'emma-frost-reading-order'],
    },
  );
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => validateApprovalDigest(mapping.relationshipReview, id));
  assert.equal(report.comparisonCount, 174);
  assert.deepEqual(currentReport.comparisons, report.comparisons);
  assert.equal(currentReport.libraryDigest, report.libraryDigest);
  assert.equal(report.comparisons.filter((row) => row.relationship === 'exact').length, 0);
  assert.deepEqual(report.comparisons.filter((row) => row.relationship === 'existing-subset')
    .map((row) => row.orderId), ['damnation', 'revolutionary-war']);
  assert.equal(mapping.relationshipReview.dispositions.length, report.comparisonCount);
  assert.ok(mapping.relationshipReview.dispositions.every((row) => row.decision === 'approved'));
});

test('Mephisto checklist and catalog publish the exact vector with credit and five gap placeholders', async () => {
  const [markdown, payload, catalog, manifest] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson('src/data/mephisto_reading_order.json'),
    readJson('src/data/catalog.json'),
    readJson('src/data/curated-lists.json'),
  ]);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 551);
  assert.equal(parsed.unresolved.length, 5);
  assert.equal(payload.items.length, 556);
  assert.deepEqual(payload.items.filter((item) => !item.placeholder).map((item) => item.issueId),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.equal(payload.items.filter((item) => item.placeholder).length, 5);
  const uniqueIds = new Set(payload.items.map((item) => item.issueId));
  assert.equal(uniqueIds.size, payload.items.length);
  assert.ok(payload.items.filter((item) => item.placeholder)
    .every((item) => item.issueId < 0 && item.digitalId == null));
  assert.ok(payload.items.every((item) => item.description == null));
  const manifestEntry = manifest.lists.find((row) => row.id === id);
  const catalogEntry = catalog.lists.find((row) => row.id === id);
  assert.equal(manifestEntry.sourcePage, 'https://www.comicbookherald.com/mephisto-reading-order/');
  assert.equal(catalogEntry.source, manifestEntry.sourcePage);
  for (const source of [manifestEntry, catalogEntry]) {
    assert.equal(source.name, 'Mephisto');
    assert.equal(source.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
    assert.equal(source.sourceLicense, null);
    assert.equal(source.depth, 'partial');
    assert.equal(source.spotlightKind, 'other');
  }
  assert.equal(payload.items[0].issueId, 30224);
  assert.equal(payload.items.at(-1).issueId, 84356);
});
