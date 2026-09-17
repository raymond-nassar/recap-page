import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertMappingMatchesPacketOccurrences,
  digestCanonicalJson,
  sourceOccurrenceCountFor,
  validateApprovalDigest,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'best-ultron-reading-order';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const blockCounts = [5, 3, 12, 12, 4, 6, 6, 1, 4, 1, 1, 19, 4, 4, 4, 5];

test('Ultron preserves the exact best-of page through issue-bearing Latest Additions', () => {
  assert.deepEqual(ledger.blocks.map((block) => block.occurrenceCount), blockCounts);
  assert.equal(blockCounts.reduce((sum, count) => sum + count, 0), 91);
  assert.deepEqual(ledger.occurrences.map((row) => row.sourcePosition),
    Array.from({ length: 91 }, (_, index) => index + 1));
  assert.equal(ledger.sourceIssueBearingBlocksSha256, digestCanonicalJson(ledger.blocks));
  assert.equal(packet.sourceIssueBearingBlocksSha256, ledger.sourceIssueBearingBlocksSha256);
  const domParagraphs = ledger.blocks
    .filter((block) => !['one-shot prologue', 'issues #4-#7 of Nova'].includes(block.sourceRangeReference))
    .map((block) => block.sourceRangeReference);
  assert.equal(createHash('sha256').update(JSON.stringify(domParagraphs)).digest('hex'),
    ledger.sourceDomIssueParagraphsSha256);
  assert.equal(packet.rows.length, 91);
  assert.equal(sourceOccurrenceCountFor(packet), 91);
  assert.equal((packet.repeatedSourceReferences ?? []).length, 0);
  assert.equal((packet.sourceGaps ?? []).length, 0);
  assert.equal(ledger.gapCount, 0);
  assert.equal(ledger.repeatCount, 0);
  assert.deepEqual(mapping.rows.map((row) => [row.sourcePosition, row.selectedIssueId]),
    ledger.occurrences.map((row) => [row.sourcePosition, row.issueId]));
  assert.deepEqual(packet.excludedSourceReferences, ledger.excludedSourceReferences);
  for (const label of ['Starlord', 'Wraith', 'Someone', 'Age of Ultron!', 'Runaways', 'Avengers Forever']) {
    assert.ok(packet.excludedSourceReferences.some((entry) => entry.includes(label)), label);
  }
  assert.equal(ledger.blocks.filter((block) => block.continuity?.includes('Animated')).length, 3);
});

test('Ultron pins original Avengers and Secret Wars identities, decimal prologue and unnumbered OGN', () => {
  const at = (position) => mapping.rows[position - 1];
  for (const position of [1, 6, 9, 56, 74]) {
    assert.equal(at(position).seriesId, 1991);
    assert.equal(at(position).seriesYear, 1963);
  }
  assert.equal(at(1).selectedIssueId, 7304);
  assert.equal(at(6).selectedIssueId, 7317);
  assert.equal(at(9).selectedIssueId, 7016);
  assert.deepEqual(mapping.rows.slice(20, 32).map((row) => row.selectedIssueId),
    [10580, 10584, 10585, 10586, 10587, 10588, 10589, 10590, 10591, 10581, 10582, 10583]);
  assert.ok(mapping.rows.slice(20, 32).every((row) => row.seriesId === 2063 && row.seriesYear === 1984));
  assert.deepEqual(mapping.rows.slice(32, 36).map((row) => row.selectedIssueId),
    [17500, 17502, 17503, 17504]);
  assert.ok(mapping.rows.slice(32, 36).every((row) => row.seriesId === 354 && row.seriesYear === 1998));
  assert.equal(at(49).selectedIssueId, 15891);
  assert.deepEqual(mapping.rows.slice(49, 53).map((row) => row.issueNumber), ['4', '5', '6', '7']);
  assert.ok(mapping.rows.slice(49, 53).every((row) => row.seriesId === 2504));
  assert.equal(at(54).sourceIssueReference, 'Avengers Assemble #12.1');
  assert.equal(at(54).selectedIssueId, 39852);
  assert.equal(at(54).seriesId, 9085);
  assert.equal(at(54).seriesYear, 2010);
  assert.equal(at(54).issueNumber, '12.1');
  assert.equal(at(55).selectedIssueId, 50076);
  assert.equal(at(55).seriesId, 18790);
  assert.equal(at(55).issueNumber, '0');
  assert.equal(at(55).resolvedIssueTitle, 'Avengers: Rage of Ultron (2015)');
  assert.deepEqual(mapping.rows.slice(55, 74).map((row) => row.issueNumber),
    Array.from({ length: 19 }, (_, index) => String(index + 212)));
  assert.equal(at(56).selectedIssueId, 7078);
  assert.ok(!mapping.rows.some((row) => row.selectedIssueId === 7077));
  assert.ok(mapping.rows.slice(74, 86).every((row) => row.seriesId === 21698 && row.seriesYear === 2016));
  assert.deepEqual(mapping.rows.slice(74, 86).map((row) => row.issueNumber),
    Array.from({ length: 12 }, (_, index) => String(index + 1)));
  assert.deepEqual(mapping.rows.slice(86).map((row) => row.selectedIssueId),
    [70799, 70800, 79897, 79898, 79899]);
  assert.ok(mapping.rows.slice(86).every((row) => row.seriesId === 24309));
});

test('Ultron approval preserves the full reviewed source library without dropping shared comics', async () => {
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const current = await buildReportForMapping(
    `scripts/data/cbh-mappings/${id}.json`, [], { excludedOrderIds: ['spider-man-2099-reading-order', 'winter-soldier-bucky-barnes-reading-order', 'donny-cates-marvel-universe-reading-order-2017', 'falcon-sam-wilson-captain-america-reading-order', 'the-vision-reading-order', 'emma-frost-reading-order'] },
  );
  const manifest = await readJson('src/data/curated-lists.json');
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => validateApprovalDigest(mapping.relationshipReview, id));
  assert.equal(report.comparisonCount, manifest.lists.length - 7);
  assert.deepEqual(current, report);
  assert.equal(report.comparisons.filter((row) => row.relationship === 'exact').length, 0);
  assert.equal(mapping.relationshipReview.dispositions.length, report.comparisonCount);
  assert.ok(mapping.relationshipReview.dispositions.every((row) => row.decision === 'approved'));
});

test('Ultron checklist and Best of card publish the entire exact vector with source credit', async () => {
  const [markdown, payload, catalog, manifest] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson('src/data/best_ultron_reading_order.json'),
    readJson('src/data/catalog.json'),
    readJson('src/data/curated-lists.json'),
  ]);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 91);
  assert.equal(parsed.unresolved.length, 0);
  assert.equal(payload.items.length, 91);
  assert.deepEqual(payload.items.map((item) => item.issueId), mapping.rows.map((row) => row.selectedIssueId));
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, 91);
  assert.ok(payload.items.every((item) => item.issueId > 0 && !item.placeholder && item.description == null));
  assert.equal(payload.items[54].title, 'Avengers: Rage of Ultron (2015)');
  const entry = manifest.lists.find((row) => row.id === id);
  const card = catalog.lists.find((row) => row.id === id);
  assert.equal(entry.sourcePage, 'https://www.comicbookherald.com/best-ultron-reading-order/');
  assert.equal(card.source, entry.sourcePage);
  for (const source of [entry, card]) {
    assert.equal(source.name, 'Ultron');
    assert.equal(source.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
    assert.equal(source.sourceLicense, null);
    assert.equal(source.depth, 'selected');
    assert.equal(source.spotlightKind, 'best-of');
    assert.match(source.description, /animated-continuity Ultron Revolution/);
  }
  assert.equal(ledger.metadataHydration.reusedCount, 83);
  assert.equal(ledger.metadataHydration.fetchedCount, 8);
  assert.equal(ledger.metadataHydration.records.length, 91);
  assert.deepEqual(ledger.metadataHydration.records.filter((row) => row.identitySource)
    .map((row) => row.issueId), [70799, 70800, 79897, 79898, 79899]);
  assert.ok(payload.items.slice(86).every((item) => item.title && item.seriesName
    && item.cover === null && item.digitalId === null && item.creators.length === 0));
  for (const row of ledger.metadataHydration.records) {
    if (row.kind === 'reconstructed-from-pinned-payload') {
      assert.match(row.sha256, /^[0-9a-f]{64}$/);
      assert.match(row.note, /not a fresh HTTP response/);
    } else {
      assert.equal(row.kind, 'live-metadata-api');
      assert.match(row.bodySha256, /^[0-9a-f]{64}$/);
    }
  }
});
