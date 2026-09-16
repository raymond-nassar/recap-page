import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertMappingMatchesPacketOccurrences, validateApprovalDigest, validateFrozenPacket,
  validateInventoryState, validateMappingDigest, validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import { selectPreparationGuides } from '../scripts/prepare-cbh-batch.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseCatalog, searchCatalog, shelfKey } from '../src/js/lib/catalog.js';
import { parseManifest } from '../src/js/lib/curated.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'donny-cates-marvel-universe-reading-order-2017';
const sourceUrl = `https://www.comicbookherald.com/${id}/`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const payload = await readJson(`src/data/${id.replaceAll('-', '_')}.json`);
const ranges = [
  [20457, 381, 385], [24016, 1], [20457, 386], [24016, 2], [20457, 387],
  [24016, 3], [20457, 388], [24016, 4], [20457, 389], [20457, 390],
  [22653, 13, 18], [26009, 1], [24329, 1, 5], [24340, 1], [25951, 1],
  [24738, 1, 5], [24310, 1, 5], [25942, 1], [26486, 1], [24310, 6, 8],
  [25943, 1], [24310, 9], [25944, 1], [24310, 10, 12], [25945, 1],
  [26685, 1, 6], [26480, 1, 5], [26930, 1], [27554, 1], [26480, 6],
  [26930, 2, 5], [24310, 13, 16], [26480, 7, 12], [24310, 21, 25], [28031, 1, 5],
];
const expectedVector = ranges.flatMap(([seriesId, first, last = first]) => (
  Array.from({ length: last - first + 1 }, (_, index) => [seriesId, String(first + index)])
));

test('Donny Cates preserves the full source-defined ordered vector and interleavings', () => {
  assert.equal(expectedVector.length, 88);
  assert.equal(ledger.blocks.length, 35);
  assert.equal(ledger.sourceSections.length, 6);
  assert.deepEqual(ledger.blocks.map((block) => block.occurrenceCount),
    ranges.map(([, first, last = first]) => last - first + 1));
  assert.equal(ledger.sourceIssueBearingBlocksSha256, createHash('sha256')
    .update(JSON.stringify(ledger.blocks.map((block) => block.sourceRangeReference))).digest('hex'));
  for (const rows of [packet.rows, mapping.rows, ledger.occurrences]) {
    assert.deepEqual(rows.map((row) => [row.seriesId, row.issueNumber]), expectedVector);
  }
  assert.deepEqual(mapping.rows.map((row) => row.sourcePosition),
    Array.from({ length: 88 }, (_, index) => index + 1));
  assert.deepEqual(ledger.occurrences.map((row) => row.issueId),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.deepEqual(ledger.counts, { exact: 88, repeat: 0, gap: 0 });
  assert.equal(new Set(mapping.rows.map((row) => row.selectedIssueId)).size, 88);
});

test('Donny Cates keeps original limited series, same-series tie-ins and pointer boundaries', () => {
  assert.equal(ledger.limitedSeriesExpansion.sourceCount, 5);
  assert.equal(ledger.limitedSeriesExpansion.seriesId, 24738);
  assert.ok(ledger.limitedSeriesExpansion.sourceLink.includes('/dp/130291300X/'));
  assert.match(ledger.limitedSeriesExpansion.basis, /no numbered Collects line/);
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 24738)
    .map((row) => row.issueNumber), ['1', '2', '3', '4', '5']);
  const venom = mapping.rows.filter((row) => row.seriesId === 24310);
  assert.deepEqual(venom.map((row) => row.issueNumber),
    [...Array.from({ length: 16 }, (_, index) => String(index + 1)), '21', '22', '23', '24', '25']);
  assert.ok(venom.every((row) => row.seriesYear === 2018));
  assert.ok(mapping.rows.filter((row) => row.seriesId === 28031)
    .every((row) => row.seriesYear === 2020));
  assert.equal(ledger.eventPointerEvidence.absoluteCarnage.existingOrderId, 'absolute-carnage');
  assert.equal(ledger.eventPointerEvidence.absoluteCarnage.existingCount, 31);
  assert.equal(ledger.eventPointerEvidence.absoluteCarnage.coreIssueIds.length, 5);
  assert.ok(packet.excludedSourceReferences.some((text) => text.startsWith('Absolute Carnage')));
  assert.ok(packet.excludedSourceReferences.some((text) => text.startsWith('War of the Realms')));
  assert.ok(!mapping.rows.some((row) => [27272, 25991].includes(row.seriesId)));
  assert.equal(mapping.rows.at(-1).seriesId, 28031);
  assert.equal(mapping.rows.at(-1).issueNumber, '5');
});

test('Donny Cates creator inventory passes shared preparation without character-only metadata', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const entry = inventory.find((row) => row.id === id);
  assert.equal(entry.position, 29);
  assert.equal(entry.guideType, 'creator-run');
  assert.equal(entry.centralDisposition, 'pilot-approved');
  assert.equal(entry.deliveryStatus, 'shipped');
  assert.doesNotThrow(() => validateInventoryState(inventory));
  const invalid = structuredClone(inventory);
  invalid[28].guideType = 'invented-creator-type';
  assert.throws(() => validateInventoryState(invalid), /known guide type/);
  const prepared = await selectPreparationGuides([id]);
  assert.equal(prepared[0].packetDigest, packet.packetDigest);
  assert.equal(prepared[0].proposedManifest.type, 'creator-run');
  assert.equal(Object.hasOwn(prepared[0].proposedManifest, 'spotlightKind'), false);
  assert.deepEqual(parseManifest({ lists: [packet.proposedManifest] }).errors, []);
  const wronglyClassified = { ...packet.proposedManifest, type: 'character-run' };
  assert.ok(parseManifest({ lists: [wronglyClassified] }).errors.length > 0);
});

test('Donny Cates approval covers the full current source manifest without legacy exclusions', async () => {
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const current = await buildReportForMapping(
    `scripts/data/cbh-mappings/${id}.json`, [], { excludedOrderIds: [] },
  );
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => validateApprovalDigest(mapping.relationshipReview, id));
  assert.deepEqual(current.comparisons, report.comparisons);
  assert.equal(current.libraryDigest, report.libraryDigest);
  assert.deepEqual(new Set(report.comparisons.map((row) => row.orderId)),
    new Set(manifest.lists.filter((row) => row.id !== id).map((row) => row.id)));
  assert.equal(report.comparisonCount, manifest.lists.length - 1);
  assert.ok(report.comparisons.every((row) => row.relationship !== 'exact'));
  assert.equal(mapping.relationshipReview.dispositions.length, report.comparisonCount);
});

test('Donny Cates publishes exact IDs, original metadata and explicitly reconstructed evidence', async () => {
  const pending = [ledger, packet, mapping, await readJson(`scripts/data/cbh-overlaps/${id}.json`)];
  const editorial = new Set([packet.proposedManifest, mapping.proposedManifest, mapping.approvedManifest]);
  while (pending.length) {
    const value = pending.pop();
    if (value == null || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      if (key === 'description' && !editorial.has(value)) {
        assert.ok(child == null || child === '', 'Source evidence must not retain publisher descriptions');
      }
      if (child != null && typeof child === 'object') pending.push(child);
    }
  }
  const markdown = await readFile(`src/data/orders/${id}.md`, 'utf8');
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  assert.equal(parseChecklist(markdown).unresolved.length, 0);
  assert.deepEqual(payload.items.map((item) => item.issueId),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.deepEqual(payload.items.map((item) => [item.seriesId, item.number]), expectedVector);
  assert.ok(payload.items.every((item) => item.description == null && item.issueId > 0));
  assert.ok(payload.items.every((item) => item.cover?.path && item.cover.ext));
  assert.equal(ledger.metadataHydration.reused, 76);
  assert.equal(ledger.metadataHydration.fetched, 12);
  assert.equal(ledger.metadataHydration.records.length, 88);
  assert.deepEqual(ledger.metadataHydration.records.map((row) => row.issueId),
    payload.items.map((row) => row.issueId));
  for (const evidence of ledger.metadataHydration.records) {
    assert.match(evidence.bodySha256, /^[a-f0-9]{64}$/);
    if (evidence.kind === 'reconstructed-pinned-payload') {
      assert.match(evidence.fileSha256, /^[a-f0-9]{64}$/);
      assert.match(evidence.fieldAdaptation, /Not a fresh HTTP response/);
      const source = await readJson(evidence.file);
      const item = source.items.find((row) => row.issueId === evidence.issueId);
      const published = payload.items.find((row) => row.issueId === evidence.issueId);
      assert.deepEqual(published.cover, item.cover);
      assert.equal(published.url, item.url);
      assert.equal(published.seriesId, item.seriesId);
    } else {
      assert.equal(evidence.kind, 'fresh-provider-issue-response');
      assert.equal(evidence.url, `https://marvel.emreparker.com/v1/issues/${evidence.issueId}`);
    }
  }
});

test('Donny Cates is discoverable as a selected creator guide with exact source credit', async () => {
  const raw = await readJson('src/data/catalog.json');
  const card = raw.lists.find((row) => row.id === id);
  assert.equal(card.name, "Donny Cates' Marvel Universe");
  assert.equal(card.type, 'creator-run');
  assert.equal(card.depth, 'selected');
  assert.equal(card.source, sourceUrl);
  assert.equal(card.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
  assert.equal(card.sourceLicense, null);
  assert.equal(card.spotlightKind, undefined);
  assert.equal(shelfKey({ lists: [card] }), 'lines');
  const catalog = parseCatalog(raw);
  for (const query of ['Donny Cates', 'Thanos Wins', 'Venom Island']) {
    assert.ok(searchCatalog(catalog.lists, query).some((row) => row.id === id));
  }
});
