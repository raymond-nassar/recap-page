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

const id = 'winter-soldier-bucky-barnes-reading-order';
const sourceUrl = 'https://www.comicbookherald.com/winter-soldier-bucky-barnes-reading-order/';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const blockCounts = [
  12, 4, 4, 4, 4, 6, 7, 20, 23, 27, 25, 19, 11, 7, 7, 6, 8, 7, 7, 4, 6, 6,
  6, 6, 12, 8, 4, 4, 6, 4, 6, 7, 5, 6, 5, 5, 10, 5, 5, 7, 15, 5, 5, 5, 8,
  5, 5, 5, 6, 10, 4, 16, 5, 6, 5, 6, 7, 5, 5, 5, 5, 1, 1, 6, 4,
];

test('Winter Soldier preserves every source block and backward reference without event expansion', () => {
  assert.deepEqual(ledger.blocks.map((block) => block.occurrenceCount), blockCounts);
  assert.equal(ledger.sourceIssueBearingBlocksSha256,
    createHash('sha256').update(JSON.stringify(ledger.blocks.map((block) => block.sourceRangeReference))).digest('hex'));
  assert.equal(blockCounts.reduce((sum, count) => sum + count, 0), 485);
  assert.deepEqual(ledger.occurrences.map((row) => row.sourcePosition),
    Array.from({ length: 485 }, (_, index) => index + 1));
  assert.equal(packet.sourceOccurrenceCount, 485);
  assert.equal(packet.repeatedSourceReferences.length, 1);
  const repeat = packet.repeatedSourceReferences[0];
  assert.equal(repeat.sourcePosition, 328);
  assert.equal(repeat.normalizedSeriesTitle, 'What If?');
  assert.equal(repeat.issueNumber, '4');
  const canonical = mapping.rows[repeat.canonicalRow - 1];
  assert.equal(canonical.sourcePosition, 136);
  assert.equal(canonical.seriesId, 2095);
  assert.equal(canonical.issueNumber, '4');
  assert.deepEqual(mapping.rows.map((row) => [row.sourcePosition, row.selectedIssueId]),
    ledger.occurrences.filter((row) => row.disposition === 'exact')
      .map((row) => [row.sourcePosition, row.issueId]));
  assert.deepEqual(mapping.sourceGaps ?? [], packet.sourceGaps ?? []);
  assert.equal(packet.rows.length, 480);
  assert.deepEqual(packet.sourceGaps.map((gap) => [gap.sourcePosition, gap.sourceIssueReference]), [
    [113, 'Invaders (1975) #24'],
    [395, 'Secret Wars (2015) #0'],
    [405, 'Runaways (2015) #1'],
    [446, 'The Punisher (2016) #229'],
  ]);
  assert.ok(packet.sourceGaps.every((gap) => gap.kind === 'published-metadata-gap'
    && gap.status === 'open' && gap.evidenceSources.some((source) => source.url
      === 'https://github.com/raymond-nassar/recap-page/issues/504')));
  for (const label of ['Secret Empire event', 'War of the Realms event', 'Black Widow (2020)']) {
    assert.ok(packet.excludedSourceReferences.some((reference) => reference.startsWith(label)));
  }
  assert.deepEqual(ledger.sourceLinkEvidence.filter((link) => link.text.endsWith('event'))
    .map((link) => link.url), [
    'https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/secret-empire',
    'https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/war-of-the-realms-reading-order',
  ]);
  assert.ok(ledger.sourceLinkEvidence.some((link) => link.url.includes('Devils-Reign-Winter-Soldier-1-ebook')));
  assert.ok(!packet.rows.some((row) => ['Secret Empire', 'War of the Realms', 'Black Widow']
    .includes(row.normalizedSeriesTitle)));
  assert.ok(!packet.rows.some((row) => row.seriesId === 832 && row.issueNumber === '10'));
  assert.ok(!packet.rows.some((row) => row.seriesId === 20884 && row.issueNumber === '6'));
});

test('Winter Soldier keeps Avengers volumes, actual Standoff tie-ins and late source boundaries distinct', () => {
  const numbersFor = (seriesId) => mapping.rows.filter((row) => row.seriesId === seriesId)
    .map((row) => row.issueNumber);
  assert.deepEqual(numbersFor(1991), [...Array.from({ length: 20 }, (_, i) => String(i + 1)), '71']);
  assert.deepEqual(numbersFor(9085), ['1', '2', '3', '4', '5', '6']);
  assert.deepEqual(numbersFor(753), Array.from({ length: 17 }, (_, i) => String(i + 48)));
  assert.deepEqual(numbersFor(20841), ['8', '9', '10']);
  assert.deepEqual(numbersFor(19648), Array.from({ length: 9 }, (_, i) => String(i + 1)));
  assert.deepEqual(numbersFor(19416), ['2', '3', '4']);
  assert.deepEqual(numbersFor(20443), ['7', '8']);
  assert.deepEqual(numbersFor(20621), ['7', '8']);
  assert.deepEqual(numbersFor(20607), ['3', '4']);
  assert.deepEqual(numbersFor(20711), ['7', '8']);
  for (const seriesId of [21284, 21064, 21095]) assert.deepEqual(numbersFor(seriesId), ['1']);
  assert.deepEqual(numbersFor(31378), ['1']);
  assert.deepEqual(numbersFor(34156), ['1']);
  assert.deepEqual(numbersFor(36518), ['1']);
  assert.deepEqual(numbersFor(32242), ['7', '8', '9', '10', '11']);
  assert.deepEqual(numbersFor(37725), ['1', '2', '3', '4']);
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 26381)
    .map((row) => row.selectedIssueId), [73102, 73103, 73104, 73105, 73106, 73107, 73108]);
  assert.deepEqual(numbersFor(16325), ['620', '621', '622', '623', '624', '625', '626', '627', '628']);
  for (const [position, issueId, seriesId] of [
    [281, 26024, 8140], [282, 27420, 43541], [453, 66475, 25688],
    [474, 91746, 31378], [475, 99050, 34156], [476, 105528, 36518],
  ]) {
    const row = mapping.rows.find((candidate) => candidate.sourcePosition === position);
    assert.equal(row.selectedIssueId, issueId);
    assert.equal(row.seriesId, seriesId);
  }
  assert.equal(mapping.rows.at(-1).sourcePosition, 485);
});

test('Winter Soldier approval preserves every source-manifest order in its reviewed library', async () => {
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const current = await buildReportForMapping(
    `scripts/data/cbh-mappings/${id}.json`, [], { excludedOrderIds: ['donny-cates-marvel-universe-reading-order-2017', 'falcon-sam-wilson-captain-america-reading-order'] },
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
      && !['donny-cates-marvel-universe-reading-order-2017', 'falcon-sam-wilson-captain-america-reading-order'].includes(row.id)).map((row) => row.id)));
  assert.equal(report.comparisonCount, manifest.lists.length - 3);
  assert.ok(report.comparisons.every((row) => row.relationship !== 'exact'));
  assert.equal(mapping.relationshipReview.dispositions.length, report.comparisonCount);
  assert.ok(mapping.relationshipReview.dispositions.every((row) => row.decision === 'approved'));
});

test('Winter Soldier publishes the exact issue vector with both discovery names and source credit', async () => {
  const [markdown, payload, catalog] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson(`src/data/${id.replaceAll('-', '_')}.json`),
    readJson('src/data/catalog.json'),
  ]);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, mapping.rows.length);
  assert.equal(parsed.unresolved.length, packet.sourceGaps?.length ?? 0);
  const sequence = [
    ...mapping.rows.map((row) => ({ position: row.sourcePosition, id: row.selectedIssueId })),
    ...(packet.sourceGaps ?? []).map((row) => ({ position: row.sourcePosition, id: null })),
  ].sort((a, b) => a.position - b.position);
  assert.deepEqual(payload.items.map((item) => item.placeholder ? null : item.issueId),
    sequence.map((row) => row.id));
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, payload.items.length);
  assert.ok(payload.items.filter((item) => item.placeholder)
    .every((item) => item.issueId < 0 && item.digitalId == null));
  assert.ok(payload.items.every((item) => item.description == null));
  assert.equal(payload.items.length, 484);
  for (const row of mapping.rows) {
    const item = payload.items.find((candidate) => candidate.issueId === row.selectedIssueId);
    assert.equal(item.seriesId, row.seriesId);
    assert.equal(item.number, row.metadataIssueNumber ?? row.issueNumber);
  }
  const universe = payload.items.filter((item) => item.seriesId === 26381);
  assert.equal(universe.length, 7);
  assert.ok(universe.every((item) => item.onSale.startsWith('1998-')
    && item.creators.some((creator) => creator.name === 'Roger Stern' && creator.role === 'writer')));
  const card = catalog.lists.find((row) => row.id === id);
  assert.equal(card.name, 'Bucky Barnes / Winter Soldier');
  assert.equal(card.source, sourceUrl);
  assert.equal(card.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
  assert.equal(card.sourceLicense, null);
  assert.equal(card.spotlightKind, 'other');
  assert.equal(card.depth, 'partial');
  for (const alias of ['Bucky Barnes', 'Winter Soldier']) {
    assert.ok(card.characters.includes(alias));
    assert.ok(card.keywords.includes(alias));
  }
  assert.equal(payload.items.at(-1).seriesId, 37725);
  assert.equal(payload.items.at(-1).number, '4');
});
