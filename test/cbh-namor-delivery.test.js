import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertMappingMatchesPacketOccurrences,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';

import { placeholderId } from '../scripts/lib/placeholder-id.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { parseCatalog } from '../src/js/lib/catalog.js';
import {
  buildHistoricalReadingChoiceReport as buildReportForMapping,
  loadHistoricalReadingChoiceLibrary as loadLibrarySnapshot,
} from './helpers/reading-choice-history.mjs';

const id = 'namor-sub-mariner-reading-order';
const url = 'https://www.comicbookherald.com/namor-sub-mariner-reading-order/';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
const hash = (value) => createHash('sha256').update(JSON.stringify(value), 'utf8').digest('hex');
const gaps = new Map(packet.sourceGaps.map((row) => [row.sourcePosition, row]));
const repeats = new Map(packet.repeatedSourceReferences.map((row) => [row.sourcePosition, row]));

function sourceVector() {
  const result = [];
  for (const block of ledger.blocks) {
    assert.equal(block.selectedIssueReferences.length, block.selectedOccurrenceCount);
    assert.equal(block.originalIssueIds.length, block.selectedOccurrenceCount);
    if (!block.selectedOccurrenceCount) {
      assert.equal(block.firstSourcePosition, null);
      continue;
    }
    assert.equal(block.firstSourcePosition, result.length + 1);
    block.originalIssueIds.forEach((issueId, offset) => {
      result.push({
        position: result.length + 1,
        issueId,
        sourceReference: block.selectedIssueReferences[offset],
        sourceBlock: block.sourceBlock,
      });
    });
  }
  return result;
}

function expectedOutput(source) {
  return source.filter((row) => !repeats.has(row.position)).map((row) => ({
    position: row.position,
    issueId: row.issueId ?? placeholderId(id,
      gaps.get(row.position).sourceIssueReference, String(row.position)),
  }));
}

function assertOutputVector(payload, expected) {
  assert.deepEqual(payload.items.map((item) => item.issueId),
    expected.map((row) => row.issueId), 'Complete source-grounded output issue vector changed');
}

test('Namor source preserves all 88 blocks and 705 issue occurrences', () => {
  assert.equal(ledger.sourceContent.sha256,
    'b0f9854bb0fa9ccd839abb597ee1edacf55bba3a7cba6cd8e1b9c2f8ffba0f74');
  assert.match(ledger.sourceContent.normalization, /browser article innerText/);
  assert.equal(ledger.rawHttpResponseSha256, null);
  assert.equal(hash(ledger.factualProjection),
    '4a9872ac276a553cb29bc45049be9811294fa6679f0a39b439be39e647eae259');
  assert.equal(hash(ledger.blocks.map(({
    kind, reference, section, selectedIssueReferences, originalIssueIds,
  }) => ({ kind, reference, section, selectedIssueReferences, originalIssueIds }))),
  'f5bcecd74dffd137df6dc91a0f0a16f9fbf9f723d5738917b99ff13a0367bfa6');
  assert.equal(ledger.blocks.length, 88);
  const source = sourceVector();
  assert.equal(source.length, 705);
  assert.deepEqual(source.map((row) => row.position),
    Array.from({ length: 705 }, (_, index) => index + 1));
  assert.deepEqual(ledger.articleSections.length, 11);
  assert.equal(ledger.blocks[21].selectedOccurrenceCount, 0);
  assert.deepEqual([36, 39, 45, 50, 56, 77, 80, 82, 85, 88]
    .map((block) => ledger.blocks[block - 1].selectedOccurrenceCount),
  [12, 17, 18, 5, 1, 13, 1, 1, 1, 1]);
  assert.deepEqual([683, 694, 705].map((position) => source[position - 1].sourceReference),
    ['Avengers #32', 'Avengers #53', 'Black Panther #14']);
  assert.equal(ledger.scopeIssue, 'https://github.com/raymond-nassar/recap-page/issues/611');
  assert.equal(ledger.gapIssue, 'https://github.com/raymond-nassar/recap-page/issues/622');
});

test('Namor exact original vector, eight gaps and five backward references conserve every source position', () => {
  const source = sourceVector();
  const expected = expectedOutput(source);
  assert.equal(packet.sourceUrl, url);
  assert.equal(packet.sourceOccurrenceCount, 705);
  assert.equal(expected.length, 700);
  assert.equal(mapping.rows.length, 692);
  assert.equal(packet.sourceGaps.length, 8);
  assert.deepEqual([...gaps.keys()], [153, 339, 340, 341, 342, 369, 626, 663]);
  assert.deepEqual(packet.sourceGaps.map((row) => row.sourceIssueReference), [
    'Invaders (1975) #24',
    'Prince Namor, the Sub-Mariner (1984) #1',
    'Prince Namor, the Sub-Mariner (1984) #2',
    'Prince Namor, the Sub-Mariner (1984) #3',
    'Prince Namor, the Sub-Mariner (1984) #4',
    'Marvel Graphic Novel (1982) #27',
    'Secret Wars (2015) #0',
    'Captain America #25',
  ]);
  assert.ok(packet.sourceGaps.every((row) => row.evidenceSources.some((entry) =>
    entry.url === 'https://github.com/raymond-nassar/recap-page/issues/622')));
  const repeatTargets = [...repeats].map(([position, row]) =>
    [position, packet.rows[row.canonicalRow - 1].sourcePosition]);
  assert.deepEqual(repeatTargets,
    [[87, 86], [102, 96], [103, 97], [532, 530], [533, 531]]);
  assert.equal(new Set(mapping.rows.map((row) => row.selectedIssueId)).size, 692);
  assert.equal(hash(mapping.rows.map((row) => row.selectedIssueId)),
    'f137877d574a6b77ee9a7d82711862d27dba3833727c0172e552c87a582c1034');
  for (const row of source) {
    if (repeats.has(row.position)) {
      const earlier = packet.rows[repeats.get(row.position).canonicalRow - 1].sourcePosition;
      assert.ok(earlier < row.position);
      assert.equal(row.issueId, source[earlier - 1].issueId);
      continue;
    }
    const resolved = mapping.rows.find((item) => item.sourcePosition === row.position);
    assert.equal(resolved?.selectedIssueId ?? null, row.issueId,
      `Incorrect original at source position ${row.position}: ${row.sourceReference}`);
    assert.equal(gaps.has(row.position), row.issueId === null);
  }
  const annual = mapping.rows.find((row) => row.sourcePosition === 359);
  assert.deepEqual([annual.selectedIssueId, annual.seriesId, annual.marvelIssueUrl],
    [56327, null, 'https://www.marvel.com/comics/issue/56327/west_coast_avengers_annual_1986_1']);
  assert.equal(mapping.candidateMetadata.find((row) => row.id === 56327)?.detailsRefused, true);
  assert.equal(gaps.get(663).seriesYear, null);
  assert.ok(!mapping.rows.some((row) => row.selectedIssueId === 64178 && row.sourcePosition === 663));
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
});

test('Namor independent approval covers every peer in its publication snapshot', async () => {
  const library = await loadLibrarySnapshot();
  const current = await buildReportForMapping(`scripts/data/cbh-mappings/${id}.json`, [], {
    excludedOrderIds: ['iron-fist-reading-order', 'mcu-prep-shang-chi-and-the-legend-of-the-ten-rings', 'mcu-prep-thunderbolts', 'spider-man-no-way-home-owner-selected', 'mcu-prep-daredevil-born-again', 'mcu-prep-moon-knight', 'mcu-prep-deadpool-and-wolverine', 'mcu-prep-eternals', 'mcu-prep-fantastic-four-first-steps', 'mcu-prep-spider-man-brand-new-day', 'mcu-prep-she-hulk', 'mcu-prep-ms-marvel'],
  });
  assert.deepEqual(current, report);
  assert.equal(report.comparisonCount, 201);
  assert.deepEqual(report.comparisons.reduce((count, row) => {
    count[row.relationship] = (count[row.relationship] ?? 0) + 1;
    return count;
  }, {}), { partial: 55, none: 146 });
  assert.equal(report.comparisons.find((row) => row.orderId === 'ultimate-spider-man-reading-order')
    .relationship, 'none');
  assert.deepEqual(report.comparisons.filter((row) => [
    'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide',
    'shang-chi-master-of-kung-fu-reading-order',
    'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order',
    'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order',
  ].includes(row.orderId)).map((row) => [row.orderId, row.relationship, row.sharedIds]), [
    ['planet-hulk-reading-order-and-greg-pak-hulk-comics-guide', 'none', []],
    ['shang-chi-master-of-kung-fu-reading-order', 'partial',
      ['83989', '83993', '83994', '83995', '83996']],
    ['the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order', 'none', []],
    ['the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order', 'none', []],
  ]);
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.equal(mapping.reviewStatus, 'approved');
  assert.equal(mapping.relationshipReview.reportDigest, report.reportDigest);
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: current.libraryDigest,
    expectedOrderIds: library.lists.filter((row) =>
      row.id !== id && row.id !== 'iron-fist-reading-order' && row.id !== 'mcu-prep-shang-chi-and-the-legend-of-the-ten-rings' && row.id !== 'mcu-prep-daredevil-born-again' && row.id !== 'mcu-prep-moon-knight' && row.id !== 'mcu-prep-deadpool-and-wolverine' && row.id !== 'mcu-prep-eternals' && row.id !== 'mcu-prep-fantastic-four-first-steps' && row.id !== 'mcu-prep-spider-man-brand-new-day' && row.id !== 'mcu-prep-she-hulk' && row.id !== 'mcu-prep-ms-marvel' && row.id !== 'spider-man-no-way-home-owner-selected' && row.id !== 'mcu-prep-thunderbolts').map((row) => row.id),
  }));
  const ironFist = await readJson('src/data/iron_fist_reading_order.json');
  const shared = new Set(ironFist.items.filter((row) => row.issueId > 0).map((row) => row.issueId));
  assert.deepEqual((await readJson('src/data/namor_sub_mariner_reading_order.json')).items
    .map((row) => row.issueId).filter((issueId) => shared.has(issueId)),
  [66014, 66015, 66016, 66017, 66018, 66019, 66020, 66021, 66022,
    39757, 39762, 39763, 39758, 39759, 39761, 39760, 39767,
    39766, 39765, 39764, 39756]);
  const pending = structuredClone(mapping);
  pending.reviewStatus = 'pending-independent-review';
  delete pending.packetReview;
  delete pending.approvedManifest;
  delete pending.relationshipReview;
  assert.throws(() => assertApprovedRelationshipReview({
    packet, mapping: pending, report, currentLibraryDigest: current.libraryDigest,
    expectedOrderIds: report.comparisons.map((row) => row.orderId),
  }), /approved|review|pending/i);
});

test('Namor checklist and pinned payload publish the complete source-grounded output vector', async () => {
  const [markdown, payload, manifest, catalogRaw] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson('src/data/namor_sub_mariner_reading_order.json'),
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
  ]);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  const checklist = [...parsed.entries, ...parsed.unresolved]
    .sort((left, right) => left.index - right.index);
  const expected = expectedOutput(sourceVector());
  assert.deepEqual(checklist.map((row) => Number(row.sourceKey)),
    expected.map((row) => row.position));
  assert.deepEqual(checklist.map((row) => row.issueId ?? placeholderId(id, row.title, row.sourceKey)),
    expected.map((row) => row.issueId));
  assert.equal(parsed.entries.length, 692);
  assert.equal(parsed.unresolved.length, 8);
  assertOutputVector(payload, expected);
  assert.deepEqual(payload.items.map((row) => row.collectedIn),
    checklist.map((row) => row.section));
  assert.equal(payload.items.length, 700);
  assert.equal(payload.items.filter((row) => row.placeholder).length, 8);
  assert.deepEqual(payload.items.filter((row) => row.detailsRefused).map((row) => row.issueId),
    [56327, 64259, 64285]);
  assert.ok(payload.items.filter((row) => row.detailsRefused).every((row) =>
    row.issueId > 0 && row.placeholder !== true));
  assert.equal(new Set(payload.items.map((row) => row.issueId)).size, 700);
  const annual = payload.items.find((row) => row.issueId === 56327);
  assert.equal(annual?.detailsRefused, true);
  assert.deepEqual([annual.seriesId, annual.onSale, annual.digitalId, annual.cover],
    [null, null, null, null]);
  for (const row of packet.sourceGaps) {
    const item = payload.items.find((entry) =>
      entry.issueId === placeholderId(id, row.sourceIssueReference, String(row.sourcePosition)));
    assert.equal(item?.placeholder, true);
    assert.equal(item?.url, null);
  }
  assert.deepEqual([expected[0].issueId, expected.at(-1).issueId], [11184, 102503]);
  assert.ok(payload.items.every((row) => row.description == null));
  const entryIndex = manifest.lists.findIndex((row) => row.id === id);
  assert.ok(entryIndex >= 0);
  assert.equal(manifest.lists[entryIndex + 1].id, 'nebula-reading-order');
  assert.deepEqual(manifest.lists[entryIndex], mapping.approvedManifest);
  const card = parseCatalog(catalogRaw).lists.find((row) => row.id === id);
  assert.equal(card?.count, 700);
  assert.equal(card?.placeholderCount, 8);
  assert.equal(card?.coverIssueId, 11184);
  assert.equal(card?.source, url);
  for (const value of [card, manifest.lists[entryIndex]]) {
    assert.equal(value.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
    assert.equal(value.sourceLicense, null);
    assert.equal(value.depth, 'partial');
    assert.equal(value.spotlightKind, 'other');
  }
});

test('mutating one real Namor output identity fails the complete vector assertion', async () => {
  const payload = await readJson('src/data/namor_sub_mariner_reading_order.json');
  assertOutputVector(payload, expectedOutput(sourceVector()));
  const altered = structuredClone(payload);
  altered.items[358].issueId = 64178;
  assert.throws(() => assertOutputVector(altered, expectedOutput(sourceVector())),
    /Complete source-grounded output issue vector changed/);
});
