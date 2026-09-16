import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences,
  validateApprovalDigest,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { parseCatalog, searchCatalog } from '../src/js/lib/catalog.js';

const id = 'falcon-sam-wilson-captain-america-reading-order';
const sourceUrl = 'https://www.comicbookherald.com/falcon-sam-wilson-captain-america-reading-order/';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const blockCounts = [
  23, 13, 12, 11, 16, 8, 17, 3, 8, 6, 11, 7, 10, 4, 12, 5, 20, 1, 14, 3, 14, 2,
  12, 26, 1, 7, 14, 7, 6, 8, 7, 7, 4, 6, 5, 6, 6, 6, 4, 6, 7, 5, 18, 6, 4, 6,
  7, 6, 5, 20, 6, 6, 20, 4, 6, 5, 4, 5, 6, 3, 3, 5, 5, 6, 1, 7, 6,
];
const vectorSha256 = 'd615de0df4e0f6faa7e3c76351dd4d85745951e6c7796ace7ff84bf3e6218db3';
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('Falcon conserves every source block and backward repeat through Latest Additions', () => {
  assert.deepEqual(ledger.blocks.map((block) => block.occurrenceCount), blockCounts);
  assert.equal(blockCounts.reduce((sum, count) => sum + count, 0), 540);
  assert.equal(ledger.sourceIssueBearingBlocksSha256,
    digest(ledger.blocks.map((block) => block.sourceRangeReference)));
  assert.equal(packet.sourceOccurrenceCount, 540);
  assert.equal(packet.rows.length, 494);
  assert.equal(packet.repeatedSourceReferences.length, 46);
  assert.equal(packet.sourceGaps?.length ?? 0, 0);
  assert.deepEqual(ledger.occurrences.map((row) => row.sourcePosition),
    Array.from({ length: 540 }, (_, index) => index + 1));
  assert.deepEqual(mapping.rows.map((row) => [row.sourcePosition, row.selectedIssueId]),
    ledger.occurrences.filter((row) => row.disposition === 'exact')
      .map((row) => [row.sourcePosition, row.issueId]));
  for (const repeat of packet.repeatedSourceReferences) {
    const first = packet.rows[repeat.canonicalRow - 1];
    assert.ok(first.sourcePosition < repeat.sourcePosition);
    assert.equal(first.normalizedSeriesTitle, repeat.normalizedSeriesTitle);
    assert.equal(first.seriesYear, repeat.seriesYear);
    assert.equal(first.issueNumber, repeat.issueNumber);
  }
  assert.equal(digest(mapping.rows.map((row) => row.selectedIssueId)), vectorSha256);
  assert.equal(mapping.rows[0].sourceIssueReference, 'Tales of Suspense (1959) #97');
  assert.equal(mapping.rows.at(-1).seriesId, 34023);
  assert.equal(mapping.rows.at(-1).issueNumber, '11');
  assert.equal(ledger.occurrences.find((row) => row.sourcePosition === 535).disposition, 'repeat');
});

test('Falcon distinguishes original volumes, Infinite aliases, suffixes and actual one-shots', () => {
  const numbers = (seriesId) => mapping.rows.filter((row) => row.seriesId === seriesId)
    .map((row) => row.issueNumber);
  assert.deepEqual(packet.rows.filter((row) => row.seriesId === 36550)
    .map((row) => row.candidateIssueId), [105605, 105606, 105607, 105608]);
  assert.deepEqual(numbers(23603), ['1', '2', '3', '4', '5']);
  assert.deepEqual(numbers(19134), ['1', '2', '3', '4']);
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 19134)
    .map((row) => row.selectedIssueId), [51090, 51091, 51039, 51040]);
  assert.ok(!mapping.rows.some((row) => row.seriesId === 19344));
  assert.deepEqual(numbers(20443), Array.from({ length: 15 }, (_, i) => String(i + 1)));
  assert.deepEqual(numbers(22190), ['1']);
  assert.deepEqual(numbers(22547), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(numbers(15282), ['0.1', '1', '2', '3', '4']);
  assert.deepEqual(numbers(3629), ['3', '4', '11']);
  assert.deepEqual(packet.rows.filter((row) => row.seriesId === 3629)
    .map((row) => [row.sourceIssueReference, row.seriesYear]), [
    ['Captain America Annual #3', 1971],
    ['Captain America Annual #4', 1971],
    ['Captain America Annual #11', 1971],
  ]);
  assert.deepEqual(numbers(26448), ['1']);
  assert.deepEqual(numbers(855), ['1', '2', '3', '4', '5', '6', '7', '8']);
  assert.deepEqual(numbers(1067), ['1', '2', '3', '4', '5', '6', '7']);
  assert.deepEqual(numbers(753), ['61', '62', '63', '64']);
  for (const [position, seriesId, issueId] of [
    [117, 3752, 20608], [422, 15373, 45879], [473, 21098, 64178],
    [477, 21064, 57833], [478, 21095, 57861], [534, 24503, 98662],
  ]) {
    const row = mapping.rows.find((candidate) => candidate.sourcePosition === position);
    assert.equal(row.seriesId, seriesId);
    assert.equal(row.selectedIssueId, issueId);
  }
  const au = mapping.rows.find((row) => row.sourcePosition === 422);
  assert.equal(au.issueNumber, '15AU');
  assert.equal(au.metadataIssueNumber, '15');
  assert.equal(mapping.rows.find((row) => row.sourcePosition === 534).issueNumber, '0');
  assert.ok(!mapping.rows.some((row) => [18904, 9934, 23277].includes(row.seriesId)));
  assert.equal(ledger.excludedSourceBlocks.length, 7);
});

test('Falcon preserves twelve individually evidenced Sentinel originals without inventing optional metadata', async () => {
  const payload = await readJson(`src/data/${id.replaceAll('-', '_')}.json`);
  const facts = ledger.identityEvidence.sentinel1998.facts;
  assert.deepEqual(facts.map((fact) => fact.id),
    [62354, 62355, 62356, 62357, 62358, 62359, 62360, 62361, 62362, 62363, 62364, 62365]);
  const items = payload.items.filter((item) => item.seriesId === 22902);
  assert.deepEqual(items.map((item) => item.issueId), facts.map((fact) => fact.id));
  assert.ok(facts.every((fact) => fact.source.includes('Sentinel_of_Liberty_Vol_1_')));
  assert.ok(items.every((item) => item.digitalId === null && item.cover === null
    && item.onSale === null && item.mu === null && item.creators.length === 0
    && item.placeholder !== true));
  assert.ok(ledger.metadataProvenance.filter((row) => facts.some((fact) => fact.id === row.issueId))
    .every((row) => row.kind === 'reviewed-secondary-identity'));
});

test('Falcon approval preserves every source-manifest order in its reviewed library', async () => {
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const current = await buildReportForMapping(
    `scripts/data/cbh-mappings/${id}.json`, [], { excludedOrderIds: ['donny-cates-marvel-universe-reading-order-2017', 'the-vision-reading-order'] },
  );
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => validateApprovalDigest(mapping.relationshipReview, id));
  assert.deepEqual(current.comparisons, report.comparisons);
  assert.equal(current.libraryDigest, report.libraryDigest);
  assert.deepEqual(new Set(report.comparisons.map((row) => row.orderId)),
    new Set(manifest.lists.filter((row) => row.id !== id
      && row.id !== 'donny-cates-marvel-universe-reading-order-2017' && row.id !== 'the-vision-reading-order').map((row) => row.id)));
  assert.equal(report.comparisonCount, manifest.lists.length - 3);
  assert.ok(report.comparisons.every((row) => row.relationship !== 'exact'));
  assert.equal(mapping.relationshipReview.dispositions.length, report.comparisonCount);
  assert.ok(mapping.relationshipReview.dispositions.every((row) => row.decision === 'approved'));
});

test('Falcon publishes the full exact vector with all discovery names and source credit', async () => {
  const [markdown, payload, catalog] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson(`src/data/${id.replaceAll('-', '_')}.json`),
    readJson('src/data/catalog.json'),
  ]);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 494);
  assert.equal(parsed.unresolved.length, 0);
  assert.deepEqual(parsed.entries.map((row) => Number(row.issueId)),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.equal(payload.items.length, 494);
  assert.equal(digest(payload.items.map((item) => item.issueId)), vectorSha256);
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, 494);
  assert.ok(payload.items.every((item) => item.description === null && item.placeholder !== true));
  for (const row of mapping.rows) {
    const item = payload.items.find((candidate) => candidate.issueId === row.selectedIssueId);
    assert.equal(item.seriesId, row.seriesId);
    assert.equal(item.number, row.metadataIssueNumber ?? row.issueNumber);
  }
  const card = catalog.lists.find((row) => row.id === id);
  assert.equal(card.name, 'Falcon / Sam Wilson / Captain America');
  assert.equal(card.source, sourceUrl);
  assert.equal(card.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
  assert.equal(card.sourceLicense, null);
  assert.equal(card.spotlightKind, 'complete-guide');
  assert.equal(card.depth, 'complete');
  for (const alias of ['Falcon', 'Sam Wilson', 'Captain America']) {
    assert.ok(card.characters.includes(alias));
    assert.ok(card.keywords.includes(alias));
    assert.ok(searchCatalog(parseCatalog(catalog).lists, alias).some((row) => row.id === id));
  }
});
