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

const id = 'spider-man-2099-reading-order';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const range = (title, year, start, end = start) => Array.from(
  { length: end - start + 1 }, (_, index) => [title, year, String(start + index)],
);
const sourceBlocks = [
  range('Spider-Man 2099', 1992, 1, 10),
  [...range('Spider-Man 2099', 1992, 11, 14), ...range('2099 Unlimited', 1993, 1, 3),
    ...range('Spider-Man 2099 Annual', 1994, 1)],
  [...range('Spider-Man 2099', 1992, 15, 22), ...range('Ravage 2099', 1992, 15),
    ...range('X-Men 2099', 1993, 5), ...range('Doom 2099', 1993, 14),
    ...range('Punisher 2099', 1993, 13)],
  [...range('Spider-Man 2099', 1992, 15, 16), ...range('Ravage 2099', 1992, 15),
    ...range('X-Men 2099', 1993, 5), ...range('Doom 2099', 1993, 14),
    ...range('Punisher 2099', 1993, 13), ...range('2099 Unlimited', 1993, 4)],
  [...range('Spider-Man 2099', 1992, 23, 33), ...range('2099 Unlimited', 1993, 8)],
  [...range('Spider-Man 2099', 1992, 34, 38), ...range('Spider-Man 2099 Special', 1995, 1),
    ...range('Spider-Man 2099 Meets Spider-Man', 1995, 1), ...range('2099 Unlimited', 1993, 9, 10)],
  range('2099: World of Tomorrow', 1996, 1, 8),
  range('Captain Marvel', 2000, 27, 29),
  [...range('Exiles', 2001, 75, 89), ...range('Exiles Annual', 2006, 1)],
  [...range('Exiles', 2001, 90, 100), ...range('Exiles: Days of Then and Now', 2008, 1),
    ...range('X-Men: Die by the Sword', 2007, 1, 5)],
  [...range('Timestorm 2009/2099', 2009, 1, 4),
    ...range('Timestorm 2009/2099: Spider-Man', 2009, 1),
    ...range('Timestorm 2009/2099: X-Men', 2009, 1)],
  range('Superior Spider-Man', 2013, 17, 19),
  [...range('Spider-Man 2099', 2014, 1, 5), ...range('Amazing Spider-Man', 2014, 1)],
  range('Spider-Man 2099', 2014, 6, 12),
  range('Secret Wars 2099', 2015, 1, 5),
  range('Spider-Man 2099', 2015, 1, 5),
  range('Spider-Man 2099', 2015, 6, 10),
  range('Spider-Man 2099', 2015, 11, 16),
  range('Spider-Man 2099', 2015, 17, 21),
  [...range('Spider-Man 2099', 2015, 22, 25), ...range('Spider-Man 2099 Meets Spider-Man', 1995, 1)],
  range('Amazing Spider-Man', 2018, 32, 36),
  [...range('Spider-Man 2099: Exodus Alpha', 2022, 1),
    ...range('Spider-Man 2099: Exodus', 2022, 1, 5),
    ...range('Spider-Man 2099: Exodus Omega', 2022, 1)],
  range('Spider-Man 2099: Dark Genesis', 2023, 1, 5),
  range("Miguel O'Hara - Spider-Man: 2099", 2024, 1, 5),
];
const identity = (row) => [row.normalizedSeriesTitle, row.seriesYear, row.issueNumber];

test('Spider-Man 2099 conserves the full ordered source vector and seven backward repeats', () => {
  assert.deepEqual(sourceBlocks.map((block) => block.length),
    [10, 8, 12, 7, 12, 9, 8, 3, 16, 17, 6, 3, 6, 7, 5, 5, 5, 6, 5, 5, 5, 7, 5, 5]);
  assert.deepEqual(ledger.blocks.map((block) => block.occurrenceCount), sourceBlocks.map((block) => block.length));
  assert.equal(sourceBlocks.flat().length, 177);
  assert.deepEqual(ledger.occurrences.map(identity), sourceBlocks.flat());
  assert.deepEqual(ledger.occurrences.map((row) => row.sourcePosition),
    Array.from({ length: 177 }, (_, index) => index + 1));
  assert.equal(packet.sourceOccurrenceCount, 177);
  assert.equal(packet.rows.length + packet.sourceGaps.length, 170);
  assert.deepEqual(packet.repeatedSourceReferences.map((row) => row.sourcePosition),
    [31, 32, 33, 34, 35, 36, 155]);
  assert.equal(packet.excludedSourceReferences.length, 0);
  const byPosition = new Map([...packet.rows, ...packet.sourceGaps, ...packet.repeatedSourceReferences]
    .map((row) => [row.sourcePosition, row]));
  assert.deepEqual(Array.from({ length: 177 }, (_, i) => identity(byPosition.get(i + 1))), sourceBlocks.flat());
  for (const repeat of packet.repeatedSourceReferences) {
    const canonical = mapping.rows[repeat.canonicalRow - 1];
    assert.ok(canonical.sourcePosition < repeat.sourcePosition);
    assert.deepEqual(identity(canonical), identity(repeat));
  }
});

test('Spider-Man 2099 keeps the 1994 annual, distinct runs and actual crossover one-shots', () => {
  const at = new Map(mapping.rows.map((row) => [row.sourcePosition, row]));
  assert.deepEqual([at.get(18).seriesYear, at.get(18).seriesId, at.get(18).selectedIssueId],
    [1994, 20022, 53431]);
  for (const [year, seriesId, count] of [[1992, 2070, 38], [2014, 18891, 12], [2015, 20511, 25]]) {
    const rows = mapping.rows.filter((row) => row.seriesId === seriesId);
    assert.equal(rows.length, count);
    assert.ok(rows.every((row) => row.seriesYear === year));
    assert.deepEqual(rows.map((row) => row.issueNumber), Array.from({ length: count }, (_, i) => String(i + 1)));
  }
  for (const [position, seriesId, issueId] of [
    [27, 20021, 53430], [28, 16423, 43366], [29, 20019, 53428], [30, 20020, 53429],
    [55, 27380, 76328], [56, 44665, 65143],
  ]) {
    assert.equal(at.get(position).seriesId, seriesId);
    assert.equal(at.get(position).selectedIssueId, issueId);
  }
  for (const seriesId of [8466, 8467, 33910, 33911]) {
    assert.equal(mapping.rows.filter((row) => row.seriesId === seriesId).length, 1);
  }
  assert.equal(mapping.rows.at(-1).sourcePosition, 177);
  assert.deepEqual(identity(mapping.rows.at(-1)), ["Miguel O'Hara - Spider-Man: 2099", 2024, '5']);
});

test('Spider-Man 2099 preserves original World of Tomorrow positions as open metadata gaps', () => {
  const tomorrow = packet.sourceGaps.filter((row) => row.normalizedSeriesTitle === '2099: World of Tomorrow');
  assert.deepEqual(tomorrow.map((row) => row.sourcePosition), [59, 60, 61, 62, 63, 64, 65, 66]);
  assert.deepEqual(tomorrow.map(identity), range('2099: World of Tomorrow', 1996, 1, 8));
  assert.ok(packet.sourceGaps.every((gap) => gap.kind === 'published-metadata-gap'
    && gap.status === 'open' && gap.evidenceSources.some((source) => source.kind === 'tracking-issue')));
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
});

test('Spider-Man 2099 regenerates its full-current library relationship report without historical omissions', async () => {
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const current = await buildReportForMapping(`scripts/data/cbh-mappings/${id}.json`, [], { excludedOrderIds: [] });
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => validateApprovalDigest(mapping.relationshipReview, id));
  assert.equal(report.comparisonCount, manifest.lists.length - 1);
  assert.deepEqual(current.comparisons, report.comparisons);
  assert.equal(current.libraryDigest, report.libraryDigest);
  assert.equal(report.comparisons.filter((row) => row.relationship === 'exact').length, 0);
  assert.equal(report.comparisons.find((row) => row.orderId === 'marvel-2099').relationship, 'partial');
  assert.deepEqual(report.comparisons.filter((row) => row.relationship !== 'none')
    .map((row) => [row.orderId, row.relationship, row.sharedCount]), [
    ['amazing-spider-man-reading-order-modern-marvel-era', 'partial', 8],
    ['marvel-2099', 'partial', 45],
    ['spider-gwen-reading-order', 'partial', 3],
    ['spider-verse', 'partial', 4],
  ]);
  assert.equal(mapping.relationshipReview.dispositions.length, report.comparisonCount);
  assert.ok(mapping.relationshipReview.dispositions.every((row) => row.decision === 'approved'));
});

test('Spider-Man 2099 publishes its complete canonical vector with source credit and negative-ID gap placeholders', async () => {
  const [markdown, payload, catalog] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson('src/data/spider_man_2099_reading_order.json'),
    readJson('src/data/catalog.json'),
  ]);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, mapping.rows.length);
  assert.equal(parsed.unresolved.length, packet.sourceGaps.length);
  assert.equal(payload.items.length, 170);
  const firstOccurrences = ledger.occurrences.filter((row) => row.disposition !== 'repeat');
  assert.deepEqual(payload.items.map((item, index) => item.issueId > 0
    ? item.issueId : firstOccurrences[index].sourcePosition),
  firstOccurrences.map((row) => row.disposition === 'exact' ? row.issueId : row.sourcePosition));
  assert.deepEqual(payload.items.filter((item) => !item.placeholder).map((item) => item.issueId),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, 170);
  assert.equal(payload.items.filter((item) => item.placeholder).length, packet.sourceGaps.length);
  assert.ok(payload.items.filter((item) => item.placeholder).every((item) => item.issueId < 0 && item.digitalId == null));
  assert.ok(payload.items.every((item) => item.description == null));
  assert.equal(payload.items[0].issueId, 10865);
  assert.equal(payload.items.at(-1).issueId, mapping.rows.at(-1).selectedIssueId);
  const entry = catalog.lists.find((row) => row.id === id);
  assert.equal(entry.name, 'Spider-Man 2099');
  assert.equal(entry.source, 'https://www.comicbookherald.com/spider-man-2099-reading-order/');
  assert.equal(entry.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
  assert.equal(entry.sourceLicense, null);
  assert.equal(entry.depth, 'partial');
  assert.equal(entry.spotlightKind, 'other');
  assert.ok(entry.keywords.includes('Miguel O\'Hara'));
});
