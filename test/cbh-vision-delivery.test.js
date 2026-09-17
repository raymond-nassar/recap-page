import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences, validateFrozenPacket, validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseCatalog, searchCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'the-vision-reading-order';
const sourceUrl = `https://www.comicbookherald.com/${id}/`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const numbers = (seriesId) => mapping.rows.filter((row) => row.seriesId === seriesId)
  .map((row) => row.issueNumber);
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, i) => String(first + i));
const blockCounts = [
  21, 1, 32, 21, 3, 7, 5, 2, 16, 14, 13, 26, 9, 10, 1, 15, 1, 1, 18, 8, 14, 20, 4,
  42, 44, 13, 4, 13, 5, 13, 7, 6, 6, 5, 3, 1, 11, 6, 6, 14, 6, 12, 10, 5, 6, 26, 5,
];
const run = (seriesId, first, last = first) => (
  typeof first === 'string' ? [[seriesId, first]]
    : range(first, last).map((number) => [seriesId, number])
);
const sourceBlocks = [
  [...run(1991, 57, 76), ...run(2300, 17)],
  run(9863, 1),
  [...run(1991, 59, 88), ...run(2021, 140), ...run(2300, 17)],
  [...run(1991, 124, 125), ...run(1991, 129, 135), ...run(2000, 33),
    ...run(3729, 2, 4), ...run(20555, 1, 8)],
  run(3716, 41, 43),
  run(1991, 181, 187),
  [...run(3729, 4), ...run(2090, 1, 4)],
  run(3716, 129, 130),
  [...run(1991, 231, 241), ...run(1988, 11, 12), ...run(2984, 16), ...run(2121, 256), ...run(3740, 60)],
  [...run(1991, 242, 254), ...run(1988, 13)],
  [...run(3655, 1, 12), ...run(3630, 2)],
  [...run(3631, 1, 4), ...run(3723, 7), ...run(1991, 250), ...run(3630, 1, 16),
    ...run(3655, 1, 2), ...run(1988, 15), ...run(3632, 1)],
  run(3630, 42, 50),
  [...run(3630, 51, 57), ...run(3630, 60, 62)],
  run(24456, 23),
  [...run(3630, 58, 59), ...run(3630, 63, 75)],
  run(3648, 5),
  run(3648, 19),
  [...run(1991, 345, 347), ...run(3630, 80, 82), ...run(3695, 32, 36),
    ...run(3645, 7, 9), ...run(2029, 278, 279), ...run(2083, 445, 446)],
  [...run(3630, 89, 91), ...run(3632, 8), ...run(20352, 1, 4)],
  [...run(3630, 92, 100), ...run(3630, 102), ...run(21494, 1, 4)],
  run(1991, 348, 367),
  run(20352, 1, 4),
  [...run(354, 1, 6), ...run(25955, 1), ...run(354, 7, 23), ...run(354, 0),
    ...run(354, '1 Rough Cut'), ...run(2572, 7), ...run(1997, 8), ...run(20086, 10),
    ...run(22936, 1), ...run(2111, 1, 12)],
  [...run(354, 24, 27), ...run(26449, 1), ...run(354, 28, 34), ...run(3706, 1),
    ...run(2049, 1, 3), ...run(354, 35, 56), ...run(354, '1 1/2'), ...run(26448, 1),
    ...run(2296, 42, 44), ...run(1992, 1)],
  [...run(354, 57, 63), ...run(19212, 1, 4), ...run(581, 58), ...run(2572, 64)],
  run(19212, 1, 4),
  run(354, 64, 76),
  [...run(354, 500, 503), ...run(829, 1)],
  [...run(756, 1, 12), ...run(1015, 1)],
  run(1067, 1, 7),
  run(1866, 21, 26),
  run(1866, 27, 32),
  run(1866, 32, 36),
  run(13257, 1, 3),
  run(9863, 1),
  [...run(9085, '12.1'), ...run(17318, 1, 10)],
  run(17954, 1, 6),
  [...run(17954, '7.Inh'), ...run(17954, 8, 12)],
  [...run(20443, 1, 12), ...run(20443, 0), ...run(19820, 1)],
  run(22547, 1, 6),
  run(20897, 1, 12),
  run(23020, 0, 9),
  run(22547, 7, 11),
  [...run(22547, 672), ...run(22552, 13), ...run(22547, 673), ...run(22552, 14),
    ...run(22547, 674), ...run(22552, 15)],
  [...run(22547, 675, 690), ...run(26034, 1, 10)],
  run(37267, 1, 5),
];

test('Vision conserves every issue-bearing block, first occurrence, repeat and gap through Latest Additions', () => {
  assert.deepEqual(ledger.blocks.map((block) => block.occurrenceCount), blockCounts);
  assert.deepEqual(sourceBlocks.map((block) => block.length), blockCounts);
  assert.equal(blockCounts.reduce((sum, count) => sum + count, 0), 531);
  assert.equal(packet.sourceOccurrenceCount, 531);
  assert.equal(packet.rows.length, 493);
  assert.equal(packet.repeatedSourceReferences.length, 34);
  assert.equal(packet.sourceGaps.length, 4);
  assert.deepEqual([
    ...packet.rows, ...packet.repeatedSourceReferences, ...packet.sourceGaps,
  ].map((row) => row.sourcePosition).sort((a, b) => a - b),
  Array.from({ length: 531 }, (_, index) => index + 1));
  assert.deepEqual(mapping.rows.map((row) => [row.sourcePosition, row.selectedIssueId]),
    ledger.occurrences.filter((row) => row.disposition === 'exact')
      .map((row) => [row.sourcePosition, row.issueId]));
  for (const repeat of packet.repeatedSourceReferences) {
    const canonical = packet.rows[repeat.canonicalRow - 1];
    assert.ok(canonical.sourcePosition < repeat.sourcePosition);
    assert.deepEqual(
      [canonical.normalizedSeriesTitle, canonical.seriesYear, canonical.issueNumber],
      [repeat.normalizedSeriesTitle, repeat.seriesYear, repeat.issueNumber],
    );
  }
  const reconstructed = new Map(packet.rows.map((row) => (
    [row.sourcePosition, [row.seriesId, row.issueNumber]]
  )));
  for (const repeat of packet.repeatedSourceReferences) {
    reconstructed.set(repeat.sourcePosition,
      [packet.rows[repeat.canonicalRow - 1].seriesId, repeat.issueNumber]);
  }
  const gapSeries = new Map([[161, 3632], [181, 24456], [288, 354], [343, 354]]);
  for (const gap of packet.sourceGaps) {
    reconstructed.set(gap.sourcePosition, [gapSeries.get(gap.sourcePosition), gap.issueNumber]);
  }
  assert.deepEqual([...reconstructed].sort(([a], [b]) => a - b).map(([, value]) => value),
    sourceBlocks.flat());
  assert.equal(new Set(mapping.rows.map((row) => row.selectedIssueId)).size, 493);
  assert.equal(mapping.rows[0].seriesId, 1991);
  assert.equal(mapping.rows[0].issueNumber, '57');
  assert.equal(mapping.rows.at(-1).seriesId, 37267);
  assert.equal(mapping.rows.at(-1).issueNumber, '5');
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
});

test('Vision distinguishes the original volumes and canonicalizes Origins and Icons aliases', () => {
  for (const seriesId of [20352, 19212, 2090, 3631]) {
    assert.deepEqual(numbers(seriesId), range(1, 4));
  }
  for (const seriesId of [20897, 3655]) assert.deepEqual(numbers(seriesId), range(1, 12));
  assert.deepEqual(numbers(9863), ['1']);
  const origins = mapping.rows.find((row) => row.seriesId === 9863);
  assert.equal(origins.selectedIssueId, 32686);
  assert.equal(origins.seriesYear, 2011);
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 19212)
    .map((row) => row.selectedIssueId), [51119, 51120, 51121, 51122]);
  const repeatedCount = (seriesId) => packet.repeatedSourceReferences.filter((repeat) => (
    packet.rows[repeat.canonicalRow - 1].seriesId === seriesId
  )).length;
  assert.equal(repeatedCount(9863), 1);
  assert.equal(repeatedCount(19212), 4);
  assert.equal(repeatedCount(20352), 4);
  for (const [issueId, issueNumber] of [[18353, '5'], [18319, '19']]) {
    const row = mapping.rows.find((candidate) => candidate.selectedIssueId === issueId);
    assert.ok(row);
    assert.equal(row.seriesYear, 1989);
    assert.equal(row.issueNumber, issueNumber);
  }
  assert.ok(!mapping.rows.some((row) => row.seriesId === 2095));
  assert.ok(!numbers(3630).includes('101'));
  assert.deepEqual(numbers(1991), [
    ...range(57, 88), '124', '125', ...range(129, 135), ...range(181, 187),
    ...range(231, 254), ...range(345, 347), ...range(348, 367),
  ]);
});

test('Vision keeps source-defined event ranges, No Surrender and story-qualified FCBD originals', () => {
  assert.deepEqual(numbers(1067), range(1, 7));
  assert.deepEqual(numbers(23020), range(0, 9));
  assert.deepEqual(numbers(17318), range(1, 10));
  assert.deepEqual(numbers(22547), [...range(1, 11), ...range(672, 690)]);
  assert.deepEqual(numbers(22552), range(13, 15));
  assert.deepEqual(numbers(26034), range(1, 10));
  const worldsCollide = mapping.rows.filter((row) => (
    (row.seriesId === 22547 && Number(row.issueNumber) >= 672 && Number(row.issueNumber) <= 674)
    || row.seriesId === 22552
  ));
  assert.deepEqual(worldsCollide.map((row) => [row.seriesId, row.issueNumber]), [
    [22547, '672'], [22552, '13'], [22547, '673'],
    [22552, '14'], [22547, '674'], [22552, '15'],
  ]);
  assert.deepEqual(numbers(20443), [...range(1, 12), '0']);
  for (const [issueId, seriesId] of [[56448, 20443], [52985, 19820]]) {
    assert.equal(mapping.rows.find((row) => row.selectedIssueId === issueId)?.seriesId, seriesId);
  }
  assert.ok(!mapping.rows.some((row) => [23791, 2039].includes(row.seriesId)));
});

test('Vision retains four exact gap identities and distinguishes missing metadata from failed requests', () => {
  assert.deepEqual(packet.sourceGaps.map((row) => [row.sourcePosition, row.sourceIssueReference]), [
    [161, 'West Coast Avengers Annual (1986) #1'],
    [181, 'Avengers Spotlight (1989) #23'],
    [288, 'Avengers (1998) #1 Rough Cut'],
    [343, 'Avengers (1998) #1 1/2'],
  ]);
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
  assert.ok(packet.sourceGaps.every((row) => row.kind === 'published-metadata-gap'
    && row.status === 'open'
    && row.evidenceSources.some((source) => source.kind === 'tracking-issue'
      && source.url === 'https://github.com/raymond-nassar/recap-page/issues/522')));
  assert.match(packet.sourceGaps.at(-1).auditBasis, /HTTP 500/);
  assert.match(packet.sourceGaps.at(-1).auditBasis, /not evidence of comic absence/);
});

test('Vision approval preserves its complete publication-time source-library snapshot', async () => {
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const current = await buildReportForMapping(
    `scripts/data/cbh-mappings/${id}.json`, [], { excludedOrderIds: ['emma-frost-reading-order', 'doctor-octopus-otto-octavius-reading-order'] },
  );
  const expectedOrderIds = manifest.lists.filter((row) => row.id !== id && row.id !== 'emma-frost-reading-order' && row.id !== 'doctor-octopus-otto-octavius-reading-order').map((row) => row.id);
  assert.deepEqual(current, report);
  assert.equal(report.comparisonCount, expectedOrderIds.length);
  assert.deepEqual(new Set(report.comparisons.map((row) => row.orderId)), new Set(expectedOrderIds));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: current.libraryDigest, expectedOrderIds,
  }));
});

test('Vision publishes canonical exact IDs and negative-ID gaps with credited alias discovery', async () => {
  const [markdown, payload, rawCatalog] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson(`src/data/${id.replaceAll('-', '_')}.json`),
    readJson('src/data/catalog.json'),
  ]);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 493);
  assert.equal(parsed.unresolved.length, 4);
  assert.equal(payload.items.length, 497);
  assert.deepEqual(payload.items.filter((row) => row.issueId > 0).map((row) => row.issueId),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.deepEqual(payload.items.filter((row) => row.issueId > 0)
    .map((row) => [row.seriesId, row.number]),
  mapping.rows.map((row) => [row.seriesId, row.metadataIssueNumber ?? row.issueNumber]));
  for (const issueId of [55231, 55232, 55233, 55234, 55236, 64259]) {
    const item = payload.items.find((row) => row.issueId === issueId);
    assert.ok(item);
    assert.equal(item.placeholder === true, false);
    for (const field of ['onSale', 'mu', 'digitalId', 'cover', 'pageCount']) {
      assert.equal(item[field], null);
    }
    assert.deepEqual(item.creators, []);
  }
  assert.equal(new Set(payload.items.map((row) => row.issueId)).size, 497);
  const gaps = payload.items.filter((row) => row.issueId < 0);
  assert.equal(gaps.length, 4);
  assert.ok(gaps.every((row) => row.placeholder === true));
  const canonical = [...mapping.rows, ...mapping.sourceGaps]
    .sort((left, right) => left.sourcePosition - right.sourcePosition);
  canonical.forEach((row, index) => {
    if (row.selectedIssueId) {
      assert.equal(payload.items[index].issueId, row.selectedIssueId);
    } else {
      assert.ok(payload.items[index].issueId < 0);
      assert.equal(payload.items[index].title, row.sourceIssueReference);
    }
  });
  assert.ok(payload.items.every((row) => row.description == null));
  const card = rawCatalog.lists.find((row) => row.id === id);
  assert.equal(card.source, sourceUrl);
  assert.equal(card.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
  assert.equal(card.sourceLicense, null);
  assert.equal(card.spotlightKind, 'other');
  assert.equal(card.depth, 'partial');
  for (const alias of ['Vision', 'Scarlet Witch', 'Avengers Icons']) {
    assert.ok(searchCatalog(parseCatalog(rawCatalog).lists, alias).some((row) => row.id === id));
  }
});

test('Vision evidence excludes copied synopses recursively, including nested resolution candidates', () => {
  const editorial = new Set([packet.proposedManifest, mapping.proposedManifest, mapping.approvedManifest]);
  const pending = [ledger, packet, mapping];
  while (pending.length) {
    const value = pending.pop();
    if (value == null || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      if (['description', 'synopsis'].includes(key) && !editorial.has(value)) {
        assert.ok(child == null || child === '', 'Evidence must not retain publisher synopsis prose');
      }
      if (child != null && typeof child === 'object') pending.push(child);
    }
  }
});

test('Vision retains pinned cover URLs instead of losing them during metadata reconstruction', async () => {
  const payload = await readJson(`src/data/${id.replaceAll('-', '_')}.json`);
  const reused = ledger.metadataHydration.records
    .filter((row) => row.kind === 'reconstructed-from-pinned-payload');
  const sources = new Map(await Promise.all([...new Set(reused.map((row) => row.file))]
    .map(async (file) => [file, await readJson(file)])));
  assert.equal(reused.length, 394);
  assert.equal(ledger.metadataHydration.fieldReconstruction['cover.path'], 'cover.path');
  assert.equal(ledger.metadataHydration.fieldReconstruction['cover.ext'], 'cover.extension');
  for (const record of reused) {
    const original = sources.get(record.file).items.find((row) => row.issueId === record.issueId);
    const published = payload.items.find((row) => row.issueId === record.issueId);
    assert.ok(original);
    assert.ok(published);
    assert.deepEqual(published.cover, original.cover ?? null, `Cover for issue ${record.issueId}`);
  }
  assert.ok(payload.items.find((row) => row.issueId === packet.proposedManifest.coverIssueId)?.cover?.path);
});
