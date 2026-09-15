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
import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'miles-morales-spider-man-reading-order';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const blockCounts = [
  5, 5, 5, 2, 19, 5, 6, 20, 6, 6, 6, 27, 6, 7, 10, 5, 8, 5, 6, 6,
  10, 5, 4, 6, 6, 6, 7, 7, 2, 5, 13, 7, 1, 5, 6, 5, 6, 6, 6, 6,
  5, 7, 8, 6, 5, 5, 6, 4, 5, 6, 4, 6, 6, 6, 5, 6, 5, 5, 6, 5,
];

test('Miles source census accounts for all collections, explicit instructions and backward repeats', () => {
  assert.deepEqual(ledger.blocks.map((block) => block.occurrenceCount), blockCounts);
  assert.equal(ledger.sourceCollectionOccurrenceCount, 400);
  assert.equal(ledger.blocks.reduce((sum, block) => sum + block.collectionOccurrenceCount, 0), 400);
  assert.equal(ledger.deferredCollectionReferences.length, 6);
  assert.equal(ledger.additionalSequenceReferences.length, 1);
  assert.equal(400 - 6 + 1, packet.sourceOccurrenceCount);
  assert.equal(packet.sourceOccurrenceCount, 395);
  assert.equal(ledger.sourceIssueBearingBlocksSha256,
    createHash('sha256').update(JSON.stringify(ledger.blocks)).digest('hex'));
  assert.deepEqual(ledger.occurrences.map((row) => row.sourcePosition),
    Array.from({ length: 395 }, (_, index) => index + 1));
  assert.deepEqual(packet.repeatedSourceReferences.map((row) => row.sourcePosition),
    [237, 273, 274, 275, 290, 291, 292, 326, 384]);
  assert.equal(packet.rows.length + packet.sourceGaps.length, 386);
  assert.deepEqual(mapping.rows.map((row) => [row.sourcePosition, row.selectedIssueId]),
    ledger.occurrences.filter((row) => row.disposition === 'exact')
      .map((row) => [row.sourcePosition, row.issueId]));
  for (const repeat of packet.repeatedSourceReferences) {
    const original = mapping.rows[repeat.canonicalRow - 1];
    assert.ok(original.sourcePosition < repeat.sourcePosition);
    assert.equal(original.normalizedSeriesTitle, repeat.normalizedSeriesTitle);
    assert.equal(original.issueNumber, repeat.issueNumber);
  }
  assert.ok(ledger.contextOnlyReferences.some((row) => row.reference === 'Ultimate Fallout #4'));
  assert.ok(!mapping.rows.some((row) => row.seriesId === 14807));
  assert.ok(!mapping.rows.some((row) => row.normalizedSeriesTitle === 'Spider-Man'
    && row.seriesYear === 2016 && row.issueNumber === '11'));
  assert.ok(!mapping.rows.some((row) => row.seriesId === 25999 && row.issueNumber === '28'));
});

test('Miles crossover instructions take precedence over collection range order', () => {
  const sequence = (block) => {
    const positions = new Set(ledger.occurrences.filter((row) => row.block === block)
      .map((row) => row.sourcePosition));
    return mapping.rows.filter((row) => positions.has(row.sourcePosition))
      .map((row) => `${row.normalizedSeriesTitle} #${row.issueNumber}`);
  };
  assert.deepEqual(sequence(4), ['Ultimate Comics Spider-Man #11', 'Ultimate Comics Spider-Man #12']);
  assert.deepEqual(sequence(5), [
    'Ultimate Comics X-Men #13', 'Ultimate Comics X-Men #14', 'Ultimate Comics X-Men #15',
    'Ultimate Comics X-Men #16', 'Ultimate Comics X-Men #17', 'Ultimate Comics X-Men #18',
    'Ultimate Comics Ultimates #13', 'Ultimate Comics Ultimates #14',
    'Ultimate Comics Spider-Man #13', 'Ultimate Comics Spider-Man #14',
    'Ultimate Comics Ultimates #15', 'Ultimate Comics Spider-Man #15', 'Ultimate Comics Spider-Man #16',
    'Ultimate Comics Ultimates #16', 'Ultimate Comics Spider-Man #17',
    'Ultimate Comics Ultimates #17', 'Ultimate Comics Ultimates #18',
    'Ultimate Comics Spider-Man #18', 'Ultimate Comics Ultimates #18.1',
  ]);
  assert.deepEqual(sequence(26), [
    'Spider-Man #12', 'Spider-Gwen #16', 'Spider-Man #13',
    'Spider-Gwen #17', 'Spider-Man #14', 'Spider-Gwen #18',
  ]);
  assert.deepEqual(sequence(37), [
    'Avengers #672', 'Champions #13', 'Avengers #673',
    'Champions #14', 'Avengers #674', 'Champions #15',
  ]);
  for (const deferred of ledger.deferredCollectionReferences) {
    const row = mapping.rows.find((entry) => entry.sourcePosition === deferred.effectiveSourcePosition);
    assert.equal(`${row.normalizedSeriesTitle} #${row.issueNumber}`, deferred.sourceIssueReference);
  }
});

test('Miles keeps Champions and Spider-Verse volumes, decimals, legacy numbering and endpoint distinct', () => {
  const rows = mapping.rows;
  assert.deepEqual([22552, 26592, 29034].map((seriesId) =>
    rows.filter((row) => row.seriesId === seriesId).map((row) => row.issueNumber)), [
    Array.from({ length: 27 }, (_, index) => String(index + 1)),
    Array.from({ length: 10 }, (_, index) => String(index + 1)),
    ['1', '2', '3', '4', '5'],
  ]);
  const verses = rows.filter((row) => row.normalizedSeriesTitle === 'Spider-Verse');
  assert.deepEqual(verses.map((row) => [row.seriesYear, row.issueNumber]), [
    [2014, '1'], [2014, '2'],
    [2019, '1'], [2019, '2'], [2019, '3'], [2019, '4'], [2019, '5'], [2019, '6'],
  ]);
  assert.equal(new Set(verses.map((row) => row.seriesId)).size, 2);
  assert.ok(rows.some((row) => row.seriesId === 13831 && row.issueNumber === '16.1'));
  assert.ok(rows.some((row) => row.seriesId === 13936 && row.issueNumber === '18.1'));
  assert.deepEqual(rows.filter((row) => /\.LR$/.test(row.issueNumber))
    .map((row) => row.issueNumber), ['50.LR', '51.LR', '52.LR', '53.LR', '54.LR']);
  assert.deepEqual(rows.filter((row) => row.normalizedSeriesTitle === 'Spider-Man'
    && Number(row.issueNumber) >= 234).map((row) => row.issueNumber),
  ['234', '235', '236', '237', '238', '239', '240']);
  assert.equal(rows[0].seriesId, 13831);
  assert.equal(rows[0].issueNumber, '1');
  assert.equal(rows.at(-1).seriesId, 35645);
  assert.equal(rows.at(-1).issueNumber, '5');
  assert.deepEqual(rows.filter((row) => row.issueNumber.endsWith('.LR'))
    .map((row) => row.selectedIssueId), [90548, 90549, 90550, 90551, 91507]);
  assert.ok(rows.some((row) => row.selectedIssueId === 50446 && row.issueNumber === '200'));
  assert.equal(rows.find((row) => row.selectedIssueId === 50446).sourceIssueReference,
    'Ultimate Spider-Man #200');
  assert.ok(rows.some((row) => row.selectedIssueId === 16893 && row.issueNumber === '19'));
  assert.deepEqual(rows.filter((row) => [52985, 52986].includes(row.selectedIssueId))
    .map((row) => row.selectedIssueId), [52986, 52985]);
  assert.ok(!rows.some((row) => row.seriesId === 26025));
});

test('Miles unresolved originals remain explicit tracked source gaps rather than substitutions', () => {
  assert.deepEqual(packet.sourceGaps.map((gap) => [
    gap.sourcePosition, gap.normalizedSeriesTitle, gap.issueNumber,
  ]), [[67, 'Ultimate Prologue', '1']]);
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 23020
    && ['9', '10'].includes(row.issueNumber)).map((row) => row.selectedIssueId), [64259, 64285]);
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
  for (const gap of packet.sourceGaps) {
    assert.equal(gap.kind, 'published-metadata-gap');
    assert.equal(gap.status, 'open');
    assert.ok(gap.evidenceSources.some((source) => source.kind === 'tracking-issue'));
    assert.ok(gap.evidenceSources.some((source) => source.kind === 'metadata-api'));
    assert.ok(!mapping.rows.some((row) => row.sourcePosition === gap.sourcePosition));
  }
});

test('Miles approvals preserve the reviewed library and frozen evidence', async () => {
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const current = await buildReportForMapping(
    `scripts/data/cbh-mappings/${id}.json`, [], { excludedOrderIds: ['best-ultron-reading-order', 'winter-soldier-bucky-barnes-reading-order'] },
  );
  const manifest = await readJson('src/data/curated-lists.json');
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => validateApprovalDigest(mapping.relationshipReview, id));
  assert.deepEqual(current.comparisons, report.comparisons);
  assert.equal(current.libraryDigest, report.libraryDigest);
  assert.equal(report.comparisonCount, manifest.lists.length - 3);
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: current.libraryDigest,
    expectedOrderIds: manifest.lists.filter((row) => row.id !== id
      && !['best-ultron-reading-order', 'winter-soldier-bucky-barnes-reading-order'].includes(row.id)).map((row) => row.id),
  }));
});

test('Miles checklist and catalog publish the exact vector with credit and no copied descriptions', async () => {
  const [markdown, payload, catalog, manifest] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson('src/data/miles_morales_spider_man_reading_order.json'),
    readJson('src/data/catalog.json'),
    readJson('src/data/curated-lists.json'),
  ]);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, mapping.rows.length);
  assert.equal(parsed.unresolved.length, packet.sourceGaps.length);
  assert.equal(payload.items.length, 386);
  assert.deepEqual(payload.items.filter((item) => !item.placeholder).map((item) => item.issueId),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, payload.items.length);
  assert.equal(payload.items.filter((item) => item.placeholder).length, packet.sourceGaps.length);
  assert.ok(payload.items.filter((item) => item.placeholder)
    .every((item) => item.issueId < 0 && item.digitalId == null));
  assert.ok(payload.items.every((item) => item.description == null));
  assert.deepEqual(payload.items.filter((item) => item.detailsRefused).map((item) => item.issueId),
    [64259, 64285]);
  for (const entry of [
    manifest.lists.find((row) => row.id === id), catalog.lists.find((row) => row.id === id),
  ]) {
    assert.equal(entry.name, 'Spider-Man: Miles Morales');
    assert.equal(entry.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
    assert.equal(entry.sourceLicense, null);
    assert.equal(entry.depth, 'partial');
    assert.equal(entry.spotlightKind, 'other');
    assert.equal(entry.sourcePage ?? entry.source, packet.sourceUrl);
  }
});
