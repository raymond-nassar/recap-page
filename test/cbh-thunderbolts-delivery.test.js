import { currentReadingCensus } from './helpers/current-reading-library.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences,
  digestCanonicalJson,
  validateFrozenPacket,
  validateInventoryState,
  validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';

import { parseCatalog, searchCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  buildHistoricalReadingChoiceReport as buildReportForMapping,
  historicalReadingChoiceManifest,
} from './helpers/reading-choice-history.mjs';

const id = 'thunderbolts-reading-order';
const sourceUrl = 'https://www.comicbookherald.com/the-thunderbolts-reading-order/';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);

test('Thunderbolts conserves all 258 approved source positions in one frozen vector', () => {
  const exact = mapping.rows.map((row) => ({
    sourcePosition: row.sourcePosition,
    sourceIssueReference: row.sourceIssueReference,
    selectedIssueId: row.selectedIssueId,
    resolvedIssueTitle: row.resolvedIssueTitle,
    normalizedSeriesTitle: row.normalizedSeriesTitle,
    seriesYear: row.seriesYear,
    resolutionStatus: 'exact',
  }));
  const gaps = mapping.sourceGaps.map((row) => ({
    sourcePosition: row.sourcePosition,
    sourceIssueReference: row.sourceIssueReference,
    selectedIssueId: null,
    resolvedIssueTitle: null,
    normalizedSeriesTitle: row.normalizedSeriesTitle,
    seriesYear: row.seriesYear,
    resolutionStatus: 'gap',
  }));
  const orderedVector = [...exact, ...gaps].sort((left, right) => (
    left.sourcePosition - right.sourcePosition
  ));

  assert.equal(packet.sourceIssueBearingBlocksSha256,
    'b39f01a181e5215b2ffbee967a74e1e843f8c7ab8788ea7aa288f65bb4bd662e');
  assert.equal(packet.sourceOccurrenceCount, 258);
  assert.equal(mapping.rows.length, 257);
  assert.equal(mapping.sourceGaps.length, 1);
  assert.equal(new Set([...mapping.rows, ...mapping.sourceGaps]
    .map((row) => row.sourceRangeReference)).size, 37);
  assert.equal(packet.excludedSourceReferences.length, 3);
  assert.equal(packet.repeatedSourceReferences, undefined);
  assert.equal(packet.excludedSourceRows, undefined);
  assert.deepEqual(orderedVector.map((row) => row.sourcePosition),
    Array.from({ length: 258 }, (_, index) => index + 1));
  assert.equal(digestCanonicalJson(orderedVector),
    '539082f05dcfe19276b72336003ba83fa155a90f260e6166c5d56eae0d122720');
  const originalSeriesNumbers = new Set(mapping.rows
    .filter((row) => row.seriesId === 2296)
    .map((row) => row.issueNumber));
  for (let number = 51; number <= 100; number += 1) {
    assert.equal(originalSeriesNumbers.has(String(number)), false);
  }
  const renumberedSeriesNumbers = new Set(mapping.rows
    .filter((row) => row.seriesId === 18527)
    .map((row) => row.issueNumber));
  assert.equal(renumberedSeriesNumbers.has('132'), false);
  assert.deepEqual(
    orderedVector.at(-1),
    {
      sourcePosition: 258,
      sourceIssueReference: 'Thunderbolts (2021) #3',
      selectedIssueId: 91762,
      resolvedIssueTitle: 'King in Black: Thunderbolts (2021) #3',
      normalizedSeriesTitle: 'King in Black: Thunderbolts',
      seriesYear: 2021,
      resolutionStatus: 'exact',
    },
  );
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.deepEqual(packet.sourceReview, {
    authorityType: 'stronger-model',
    authorityIdentity: 'GPT-6 Astra coordinator, guide review for issue #555',
    rationale: 'Independently read the entire credited Comic Book Herald article and reconciled all 37 collection blocks against a separately counted 258-position source vector. No narrower character cuts exist. Preserve the explicit collection sequence, qualifications, specials, annuals and title/volume transitions, without filling source-absent ranges or adding later teams. Named one-shots are explicit selected comics, but their exact original identities still require evidence before metadata resolution is accepted.',
    reviewedAt: '2026-09-28T18:21:40.095Z',
  });
});

test('Thunderbolts preserves source labels while selecting the original provider volumes', () => {
  const expectedTranslations = [
    ['Incredible Hulk (1968) #449', 'Incredible Hulk', 1962, 2021, 9260],
    ['Amazing Spider-Man (1963) #565', 'Amazing Spider-Man', 1999, 454, 21503],
    ['Dark Avengers #175', 'Dark Avengers', 2012, 789, 40775],
    ['Thunderbolts (2013) #1', 'Thunderbolts', 2012, 17154, 45389],
    ['Punisher (2018) #12', 'The Punisher', 2018, 25498, 77258],
    ['Thunderbolts (2021) #1', 'King in Black: Thunderbolts', 2021, 31385, 91760],
  ];
  for (const [sourceIssueReference, title, year, seriesId, issueId] of expectedTranslations) {
    const row = mapping.rows.find((candidate) => (
      candidate.sourceIssueReference === sourceIssueReference
    ));
    assert.deepEqual(
      [row?.sourceIssueReference, row?.normalizedSeriesTitle, row?.seriesYear,
        row?.seriesId, row?.selectedIssueId],
      [sourceIssueReference, title, year, seriesId, issueId],
    );
    assert.doesNotMatch(row.normalizedSeriesTitle, /\(\d{4}\)$/);
  }

  const issueZero = mapping.rows.find((row) => row.sourcePosition === 29);
  assert.match(issueZero?.sourceIssueReference, /#0$/);
  assert.equal(issueZero?.normalizedSeriesTitle, 'Thunderbolts');
});

test('Thunderbolts keeps the approved #0, annual and special issue identities', () => {
  const expected = new Map([
    [10, [48063, 18156, 1997, '1']],
    [29, [53752, 2296, 1997, '0']],
    [30, [50522, 18883, 1998, '1']],
    [47, [59962, 21941, 2000, '1']],
    [48, [20627, 26449, 2000, '1']],
    [105, [16010, 2542, 2007, '1']],
    [106, [15799, 2316, 2006, '1']],
    [107, [6014, 1867, 2007, '1']],
    [122, [17291, 3085, 2007, '1']],
    [123, [20712, 3847, 2008, '1']],
    [124, [21279, 4896, 2008, '1']],
    [142, [22344, 5958, 2008, '1']],
    [146, [23069, 6604, 2008, '1']],
  ]);
  for (const [sourcePosition, identity] of expected) {
    const row = mapping.rows.find((candidate) => candidate.sourcePosition === sourcePosition);
    assert.deepEqual(
      [row?.selectedIssueId, row?.seriesId, row?.seriesYear, row?.issueNumber],
      identity,
      `source position ${sourcePosition}`,
    );
  }
  assert.match(mapping.rows.find((row) => row.sourcePosition === 106).sourceIssueReference,
    /^Thunderbolts stories from /);
  assert.match(mapping.rows.find((row) => row.sourcePosition === 146).sourceIssueReference,
    /^material from /);
});

test('Thunderbolts publishes the real #-1 gap as one placeholder with durable evidence', async () => {
  const gap = mapping.sourceGaps[0];
  assert.equal(gap.sourcePosition, 6);
  assert.equal(gap.sourceIssueReference, 'Thunderbolts (1997) #-1');
  assert.equal(gap.issueNumber, '-1');
  assert.equal(gap.status, 'open');
  assert.match(gap.auditBasis, /83 records/);
  assert.match(gap.auditBasis, /84 records/);
  assert.match(gap.auditBasis, /No reprint or collection was substituted/);
  assert.deepEqual(gap.evidenceSources.map((source) => source.url), [
    sourceUrl,
    'https://marvel.emreparker.com/v1/search/issues?q=Thunderbolts%201997%20-1&limit=100',
    'https://marvel.emreparker.com/v1/series/2296/issues?limit=200&offset=0',
    'https://github.com/raymond-nassar/recap-page/issues/558',
  ]);

  const markdown = await readFile(`src/data/orders/${id}.md`, 'utf8');
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 257);
  assert.equal(parsed.unresolved.length, 1);
  const payload = await readJson(`src/data/${packet.proposedManifest.out}`);
  assert.equal(payload.items.length, 258);
  assert.equal(payload.items.filter((item) => item.placeholder).length, 1);
  const expected = [...mapping.rows, ...mapping.sourceGaps]
    .sort((left, right) => left.sourcePosition - right.sourcePosition);
  expected.forEach((row, index) => {
    const item = payload.items[index];
    if (row.selectedIssueId) {
      assert.deepEqual(
        [item.issueId, item.seriesId, item.number, item.title],
        [row.selectedIssueId, row.seriesId, row.issueNumber, row.resolvedIssueTitle],
        `source position ${row.sourcePosition}`,
      );
    } else {
      assert.equal(item.placeholder, true);
      assert.equal(item.title, row.sourceIssueReference);
    }
  });
  const placeholder = payload.items[5];
  assert.equal(placeholder.placeholder, true);
  assert.equal(placeholder.title, 'Thunderbolts (1997) #-1');
  assert.ok(placeholder.issueId < 0);
  assert.notEqual(placeholder.issueId, 15311);
  assert.equal(placeholder.url, null);
  assert.equal(payload.items[0].issueId, 15311);
  const provenance = await readFile('docs/DATA_PROVENANCE.md', 'utf8');
  assert.match(provenance, /Issue #558[\s\S]+assigned to `raymond-nassar`/);
});

test('Thunderbolts approval covers all 186 source-manifest peers at its review', async () => {
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const current = await buildReportForMapping(
    `scripts/data/cbh-mappings/${id}.json`,
    [],
    { excludedOrderIds: ['nebula-reading-order', 'hope-summers-reading-order', 'x-23-reading-order', 'ms-marvel-kamala-khan-reading-order', 'marvel-zombies-reading-order', 'hawkeye-reading-order', 'silk-cindy-moon-reading-order', 'marvels-infinity-saga-gauntlet-wars-crusade-reading-order', 'nova-reading-order', 'ultimate-spider-man-reading-order', 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide', 'shang-chi-master-of-kung-fu-reading-order', 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order', 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order', 'namor-sub-mariner-reading-order', 'iron-fist-reading-order', 'mcu-prep-shang-chi-and-the-legend-of-the-ten-rings', 'mcu-prep-thunderbolts', 'spider-man-no-way-home-owner-selected', 'mcu-prep-daredevil-born-again', 'mcu-prep-moon-knight', 'mcu-prep-deadpool-and-wolverine', 'mcu-prep-eternals', 'mcu-prep-fantastic-four-first-steps', 'mcu-prep-spider-man-brand-new-day', 'mcu-prep-she-hulk', 'mcu-prep-ms-marvel', 'mcu-prep-captain-america-brave-new-world'] },
  );
  const expectedOrderIds = historicalReadingChoiceManifest(manifest).lists
    .filter((row) => ![id, 'nebula-reading-order', 'hope-summers-reading-order', 'x-23-reading-order', 'ms-marvel-kamala-khan-reading-order', 'marvel-zombies-reading-order', 'hawkeye-reading-order', 'silk-cindy-moon-reading-order', 'marvels-infinity-saga-gauntlet-wars-crusade-reading-order', 'nova-reading-order', 'ultimate-spider-man-reading-order', 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide', 'shang-chi-master-of-kung-fu-reading-order', 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order', 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order'].includes(row.id)).filter((row) => row.id !== 'namor-sub-mariner-reading-order' && row.id !== 'iron-fist-reading-order' && row.id !== 'mcu-prep-shang-chi-and-the-legend-of-the-ten-rings' && row.id !== 'mcu-prep-daredevil-born-again' && row.id !== 'mcu-prep-moon-knight' && row.id !== 'mcu-prep-deadpool-and-wolverine' && row.id !== 'mcu-prep-eternals' && row.id !== 'mcu-prep-fantastic-four-first-steps' && row.id !== 'mcu-prep-spider-man-brand-new-day' && row.id !== 'mcu-prep-she-hulk' && row.id !== 'mcu-prep-ms-marvel' && row.id !== 'mcu-prep-captain-america-brave-new-world' && row.id !== 'spider-man-no-way-home-owner-selected' && row.id !== 'mcu-prep-thunderbolts')

    .map((row) => row.id);
  assert.deepEqual(current, report);
  assert.equal(report.comparisonCount, 186);
  assert.deepEqual(report.comparisons.reduce((counts, row) => {
    counts[row.relationship] = (counts[row.relationship] ?? 0) + 1;
    return counts;
  }, {}), { partial: 18, none: 168 });
  assert.deepEqual(new Set(report.comparisons.map((row) => row.orderId)),
    new Set(expectedOrderIds));
  assert.equal(mapping.relationshipReview.approvalDigest,
    '1537f94a171f8f607b67d487da47a644343f8cd6140d58a69d97a6b7c534600e');
  assert.equal(mapping.relationshipReview.dispositions.length, 186);
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: current.libraryDigest,
    expectedOrderIds,
  }));
});

test('Thunderbolts is discoverable with source credit and measured maintained totals', async () => {
  const manifest = await readJson('src/data/curated-lists.json');
  const rawCatalog = await readJson('src/data/catalog.json');
  const catalog = parseCatalog(rawCatalog);
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const entry = manifest.lists.find((row) => row.id === id);
  const card = catalog.lists.find((row) => row.id === id);

  assert.equal(manifest.lists.length, currentReadingCensus.sources);
  assert.equal(catalog.lists.length, currentReadingCensus.visible);
  assert.equal(inventory.length, 133);

  assert.doesNotThrow(() => validateInventoryState(inventory));
  assert.deepEqual(entry, mapping.approvedManifest);
  assert.equal(entry.coverIssueId, 15311);
  assert.equal(card.coverIssueId, 15311);
  assert.equal(packet.sourceUrl, sourceUrl);
  assert.equal(entry.sourcePage, sourceUrl);
  assert.equal(card.source, sourceUrl);
  assert.equal(card.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
  assert.equal(card.sourceLicense, null);
  assert.equal(card.depth, 'partial');
  assert.equal(card.spotlightKind, 'other');
  assert.equal(card.count, 258);
  assert.equal(card.placeholderCount, 1);
  assert.equal(card.emptyRecordCount, 0);
  for (const query of [
    'Thunderbolts', 'Baron Zemo', 'Hawkeye', 'Songbird', 'Luke Cage', 'Winter Soldier', 'Red Hulk',
  ]) {
    assert.ok(searchCatalog(catalog.lists, query).some((row) => row.id === id), query);
  }
  const inventoryRecord = inventory.find((row) => row.id === id);
  assert.equal(inventoryRecord.position, 132);
  assert.equal(inventoryRecord.centralDisposition, 'pilot-approved');
  assert.equal(inventoryRecord.deliveryStatus, 'shipped');
  assert.equal(inventoryRecord.sourceRetrievedAt, packet.sourceRetrievedAt);
  assert.equal(inventoryRecord.sourceContentSha256, packet.sourceContentSha256);
  assert.equal(inventoryRecord.sourceBoundaryStatus, 'exact-page-snapshot');
  assert.equal(inventoryRecord.metadataHorizonStatus, 'approved');
  assert.match(inventoryRecord.reason, /18 partial relationships; 168 have no shared issue/);
  assert.deepEqual(
    inventoryRecord.overlapIds,
    report.comparisons
      .filter((row) => row.relationship !== 'none')
      .map((row) => row.orderId)
      .sort(),
  );
});
