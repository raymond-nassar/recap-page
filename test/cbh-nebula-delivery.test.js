import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences, validateFrozenPacket, validateMappingDigest, validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseCatalog, searchCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'nebula-reading-order';
const sourceUrl = 'https://www.comicbookherald.com/nebula-reading-order/';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);

const approvedIssueIds = [
  7127, 7128, 7129, 7131, 6928, 17790, 7188, 7189, 7190, 7191, 7192, 7193, 7194, 7195,
  15173, 15181, 9286, 9287, 9288, 9289, 9290, 9291, 15205, 15207, 15209, 15210, 15211,
  15212, 15213, 15215, 15216, 15217, 62313, 62314, 4109, 4219, 4471, 50944, 51919,
  51924, 51841, 51847, 61698, 61700, 61701, 61702, 61703, 61704, 61705, 61706, 61707,
  61708, 71308, 71310, 71311, 71312, 71313, 73421, 73422, 73423, 73424, 73425,
  78699, 78700, 73994, 73995, 73996, 73997, 73998,
];

test('Nebula conserves all 70 source positions and the approved 69 original issues', () => {
  const projection = ledger.blocks.map((block) => [
    block.section, block.collection, block.collectedContents, block.selectionKind,
    block.selectedIssueReferences, block.firstSourcePosition, block.originalIssueIds,
  ]);
  const digest = createHash('sha256').update(JSON.stringify(projection), 'utf8').digest('hex');
  const occurrences = ledger.blocks.flatMap((block) => block.originalIssueIds
    .map((issueId, index) => [block.firstSourcePosition + index, issueId]));
  assert.equal(ledger.sourceIssueBearingBlocksSha256, digest);
  assert.equal(packet.sourceIssueBearingBlocksSha256, digest);
  assert.equal(packet.sourceContentSha256, ledger.sourceContent.sha256);
  assert.equal(packet.sourceRetrievedAt, ledger.sourceRetrievedAt);
  assert.equal(ledger.sourceContent.nodeCount, 97);
  assert.deepEqual(ledger.articleSections, [
    'The Origin of Nebula', 'Infinity Gauntlet and Annihilation', 'After the MCU', 'Latest Additions',
  ]);
  assert.deepEqual(occurrences.map(([position]) => position),
    Array.from({ length: 70 }, (_, index) => index + 1));
  assert.deepEqual(occurrences.map(([, issueId]) => issueId).filter((issueId) => issueId !== null),
    approvedIssueIds);
  assert.deepEqual(occurrences,
    [...packet.rows.map((row) => [row.sourcePosition, row.candidateIssueId]), [23, null]]
      .sort(([left], [right]) => left - right));
  assert.equal(packet.sourceOccurrenceCount, 70);
  assert.equal(packet.rows.length, 69);
  assert.equal((packet.sourceGaps ?? []).length, 0);
  assert.equal((packet.repeatedSourceReferences ?? []).length, 0);
  assert.deepEqual(packet.sourceGapResolutions.map((row) => row.sourcePosition), [23]);
  assert.equal(packet.sourceGapResolutions[0].resolutionKind, 'source-exclusion');
  assert.equal(packet.sourceGapResolutions[0].previousSourceIssueReference, 'Silver Surfer Annual (1988) #5');
  assert.deepEqual(
    [...packet.rows.map((row) => row.sourcePosition), 23].sort((a, b) => a - b),
    Array.from({ length: 70 }, (_, index) => index + 1),
  );
  assert.deepEqual(mapping.rows.map((row) => row.sourcePosition),
    packet.rows.map((row) => row.sourcePosition));
  assert.deepEqual(packet.rows.map((row) => row.candidateIssueId), approvedIssueIds);
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), approvedIssueIds);
  assert.equal(new Set(approvedIssueIds).size, 69);
  assert.doesNotThrow(() => validateFrozenPacket(packet, { expectedId: id }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
});

test('Nebula keeps the 2014 Guardians original, numbered prose and late source positions', () => {
  const guardian = mapping.rows.find((row) => row.sourcePosition === 39);
  assert.deepEqual(
    [guardian.normalizedSeriesTitle, guardian.seriesYear, guardian.issueNumber, guardian.selectedIssueId],
    ['Guardians of the Galaxy Infinite', 2014, '1', 50944],
  );
  assert.ok(!approvedIssueIds.includes(47162));
  assert.deepEqual(mapping.rows.slice(24, 29).map((row) => row.issueNumber),
    ['70', '71', '72', '73', '74']);
  assert.deepEqual(mapping.rows.slice(-5).map((row) => [row.seriesYear, row.issueNumber]),
    [[2018, '6'], [2018, '7'], [2018, '8'], [2018, '9'], [2018, '10']]);
  assert.deepEqual(mapping.rows.filter((row) => row.normalizedSeriesTitle === 'Nebula')
    .map((row) => [row.seriesYear, row.issueNumber, row.selectedIssueId]),
  [[2020, '1', 78699], [2020, '2', 78700]]);
  assert.deepEqual(packet.rows.filter((row) => [64, 65].includes(row.sourcePosition))
    .map((row) => row.sourceRangeReference), ['Nebula (2020) #1-2', 'Nebula (2020) #1-2']);
  assert.deepEqual(mapping.rows.filter((row) => [64, 65].includes(row.sourcePosition))
    .map((row) => row.sourceRangeReference), ['Nebula (2020) #1-2', 'Nebula (2020) #1-2']);
  assert.equal(ledger.blocks.find((block) => block.firstSourcePosition === 1).selectionKind,
    'explicit-cut');
  assert.match(ledger.blocks[0].collectedContents, /#255-261/);
  assert.deepEqual(ledger.blocks[0].selectedIssueReferences,
    ['Avengers (1963) #257-260', 'Avengers Annual #14']);
  assert.equal(ledger.blocks.find((block) => block.firstSourcePosition === 26).selectionKind,
    'numbered-prose-reference');
  assert.deepEqual(ledger.blocks.find((block) => block.firstSourcePosition === 48)
    .selectedIssueReferences, ['Thanos (2016) #7-12']);
  assert.equal(ledger.blocks.find((block) => block.firstSourcePosition === 54).selectionKind,
    'complete-collection');
  assert.deepEqual(ledger.blocks.at(-1).selectedIssueReferences,
    ['Asgardians of the Galaxy #6-10']);
  assert.deepEqual(ledger.exclusions.find((row) => row.sourcePosition === 23),
    {
      kind: 'closed-availability-exclusion',
      sourcePosition: 23,
      original: 'Silver Surfer Annual (1988) #5',
      ownerDecision: 'https://github.com/raymond-nassar/recap-page/issues/400#issuecomment-5528556323',
    });
  assert.equal(ledger.exclusions.find((row) => row.kind === 'unnumbered-pointer').reference,
    'Nebula by Ayala');
  assert.equal(ledger.identityEvidence[0].pinnedIssueId, 50944);
  assert.equal(ledger.identityEvidence[0].distinctEarlierSeriesIssueId, 47162);
  assert.deepEqual(ledger.identityEvidence[1].pinnedIssueIds, [78699, 78700]);
  const original = mapping.candidateMetadata.find((row) => row.id === 50944);
  assert.deepEqual(
    [ledger.identityEvidence[0].pinnedSeriesId, ledger.identityEvidence[0].pinnedOnSaleDate,
      ledger.identityEvidence[0].pinnedDetailUrl],
    [original.seriesId, original.onSaleDate, original.detailUrl],
  );
  for (const [index, issueId] of ledger.identityEvidence[1].pinnedIssueIds.entries()) {
    const record = mapping.candidateMetadata.find((row) => row.id === issueId);
    assert.deepEqual(
      [ledger.identityEvidence[1].pinnedSeriesId,
        ledger.identityEvidence[1].pinnedOnSaleDates[index],
        ledger.identityEvidence[1].pinnedDetailUrls[index]],
      [record.seriesId, record.onSaleDate, record.detailUrl],
    );
  }
  assert.match(packet.excludedSourceReferences.join(' '), /unnumbered series pointer/);
});

test('Nebula approved relationship report preserves all 187 reviewed orders', async () => {
  const manifest = await readJson('src/data/curated-lists.json');
  const expectedOrderIds = manifest.lists
    .filter((row) => row.id !== 'shang-chi-master-of-kung-fu-reading-order' && row.id !== 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order' && row.id !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order' && row.id !== id && row.id !== 'nova-reading-order' && row.id !== 'ultimate-spider-man-reading-order' && row.id !== 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide' && row.id !== 'hope-summers-reading-order'
      && row.id !== 'x-23-reading-order' && row.id !== 'ms-marvel-kamala-khan-reading-order' && row.id !== 'marvel-zombies-reading-order'
      && row.id !== 'hawkeye-reading-order'
      && row.id !== 'silk-cindy-moon-reading-order'
      && row.id !== 'marvels-infinity-saga-gauntlet-wars-crusade-reading-order').filter((row) => row.id !== 'namor-sub-mariner-reading-order' && row.id !== 'iron-fist-reading-order' && row.id !== 'mcu-prep-daredevil-born-again' && row.id !== 'mcu-prep-moon-knight' && row.id !== 'mcu-prep-deadpool-and-wolverine' && row.id !== 'mcu-prep-eternals' && row.id !== 'spider-man-no-way-home-owner-selected' && row.id !== 'mcu-prep-thunderbolts')
    .map((row) => row.id);
  const regenerated = await buildReportForMapping(`scripts/data/cbh-mappings/${id}.json`, [], {
    excludedOrderIds: ['mcu-prep-thunderbolts', 'hope-summers-reading-order', 'x-23-reading-order', 'marvel-zombies-reading-order',
      'hawkeye-reading-order', 'silk-cindy-moon-reading-order', 'marvels-infinity-saga-gauntlet-wars-crusade-reading-order',
      'ms-marvel-kamala-khan-reading-order', 'nova-reading-order', 'ultimate-spider-man-reading-order', 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide', 'shang-chi-master-of-kung-fu-reading-order', 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order', 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order', 'namor-sub-mariner-reading-order', 'iron-fist-reading-order', 'spider-man-no-way-home-owner-selected', 'mcu-prep-daredevil-born-again', 'mcu-prep-moon-knight', 'mcu-prep-deadpool-and-wolverine', 'mcu-prep-eternals'],

  });
  assert.deepEqual(regenerated, report);
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.equal(report.comparisonCount, 187);
  assert.deepEqual(report.comparisons.reduce((counts, row) => {
    counts[row.relationship] = (counts[row.relationship] ?? 0) + 1;
    return counts;
  }, {}), { none: 163, partial: 24 });
  assert.deepEqual(new Set(report.comparisons.map((row) => row.orderId)), new Set(expectedOrderIds));
  assert.equal(mapping.packetDigest, packet.packetDigest);
  assert.equal(report.packetDigest, packet.packetDigest);
  assert.equal(report.mappingDigest, mapping.mappingDigest);
  assert.equal(mapping.sourceContentSha256, ledger.sourceContent.sha256);
  assert.equal(mapping.sourceRetrievedAt, ledger.sourceRetrievedAt);
  assert.equal(mapping.relationshipReview.approvalDigest,
    '76ddef67c6fa9532db8cd7d0d785f4677dc8c1dff97cafba6401d8ee76a2379e');
  assert.deepEqual(mapping.approvedManifest, packet.proposedManifest);
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: regenerated.libraryDigest, expectedOrderIds,
  }));

  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const record = inventory.find((row) => row.id === id);
  assert.equal(record.sourceContentSha256, ledger.sourceContent.sha256);
  assert.equal(record.sourceRetrievedAt, packet.sourceRetrievedAt);
  assert.deepEqual(record.overlapIds, report.comparisons.filter((row) => row.relationship !== 'none')
    .map((row) => row.orderId).sort());
  assert.deepEqual(record.catalogIds, [id]);
});

test('Nebula ships the full vector without placeholders and credits the exact source', async () => {
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = parseCatalog(await readJson('src/data/catalog.json'));
  const payload = await readJson('src/data/nebula_reading_order.json');
  const markdown = await readFile(path.join(root, 'src/data/orders', `${id}.md`), 'utf8');
  const entry = manifest.lists.find((row) => row.id === id);
  const card = catalog.lists.find((row) => row.id === id);
  const parsed = parseChecklist(markdown);
  const manifestIndex = manifest.lists.findIndex((row) => row.id === id);
  const catalogIndex = catalog.lists.findIndex((row) => row.id === id);

  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  assert.match(markdown, /^## Nebula \(2020\) #1-2$/m);
  assert.deepEqual(payload.items.filter((row) => [78699, 78700].includes(row.issueId))
    .map((row) => row.collectedIn), ['Nebula (2020) #1-2', 'Nebula (2020) #1-2']);
  assert.equal(manifest.lists[manifestIndex - 2].id, 'thunderbolts-reading-order');
  assert.equal(manifest.lists[manifestIndex - 1].id, 'namor-sub-mariner-reading-order');
  assert.equal(manifest.lists[manifestIndex + 1].id, 'hawkeye-reading-order');
  assert.equal(manifest.lists[manifestIndex + 2].id, packet.insertionAnchor.beforeId);
  assert.equal(catalog.lists[catalogIndex - 2].id, 'thunderbolts-reading-order');
  assert.equal(catalog.lists[catalogIndex - 1].id, 'namor-sub-mariner-reading-order');
  assert.equal(catalog.lists[catalogIndex + 1].id, 'hawkeye-reading-order');
  assert.equal(catalog.lists[catalogIndex + 2].id, packet.insertionAnchor.beforeId);
  assert.deepEqual(parsed.entries.map((row) => row.issueId), approvedIssueIds);
  assert.equal(parsed.unresolved.length, 0);
  assert.deepEqual(payload.items.map((row) => row.issueId), approvedIssueIds);
  assert.equal(payload.items.length, 69);
  assert.equal(payload.count, 69);
  assert.equal(payload.placeholders, 0);
  assert.deepEqual(payload.unresolved, []);
  assert.ok(payload.items.every((row) => !row.placeholder && row.description == null));
  assert.equal(payload.items[0].issueId, 7127);
  assert.equal(payload.items.at(-1).issueId, 73998);
  assert.equal(entry.expect, 69);
  assert.equal(card.count, 69);
  assert.equal(card.placeholderCount, 0);
  assert.equal(card.emptyRecordCount, 0);
  assert.equal(card.coverIssueId, 7127);
  for (const value of [entry, card, payload]) {
    assert.equal(value.sourcePage ?? value.source, sourceUrl);
    assert.equal(value.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
    assert.equal(value.sourceLicense, null);
  }
  for (const value of [entry, card]) {
    assert.equal(value.depth, 'partial');
    assert.equal(value.spotlightKind, 'other');
  }
  assert.ok(searchCatalog(catalog.lists, 'Nebula').some((row) => row.id === id));
});
