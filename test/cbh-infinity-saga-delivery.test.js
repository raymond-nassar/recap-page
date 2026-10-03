import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences,
  digestCanonicalJson,
  sourceCountsForPacket,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import {
  catalogListShelf, decadeSections, groupCatalog, modernTimelineLists, parseCatalog, shelfStories,
} from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'marvels-infinity-saga-gauntlet-wars-crusade-reading-order';
const mappingPath = `scripts/data/cbh-mappings/${id}.json`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [ledger, packet, mapping, report, manifest, inventory] = await Promise.all([
  readJson(`scripts/data/cbh-source-ledgers/${id}.json`),
  readJson(`scripts/data/cbh-packets/${id}.json`),
  readJson(mappingPath),
  readJson(`scripts/data/cbh-overlaps/${id}.json`),
  readJson('src/data/curated-lists.json'),
  readJson('scripts/data/cbh-character-inventory.json'),
]);
const canonical = [...mapping.rows, ...mapping.sourceGaps]
  .sort((a, b) => a.sourcePosition - b.sourcePosition);
const expectedCounts = {
  sourceOccurrenceCount: 221,
  sourceIdentityCount: 191,
  includedIssueCount: 174,
  sourceGapCount: 17,
  repeatedSourceReferenceCount: 30,
};
const closureUrl = 'https://github.com/raymond-nassar/recap-page/issues/400#issuecomment-5528556323';
const sourceVector = (occurrences) => occurrences.map((row) => [
  row.sourcePosition, row.sourceKind, row.sourceIssueReference, row.normalizedSeriesTitle,
  row.seriesYear, row.issueNumber, row.disposition, row.canonicalSourcePosition ?? null,
]);

function assertConserved(rows, repeats, gaps) {
  assert.equal(rows.length, 174);
  assert.equal(repeats.length, 30);
  assert.equal(gaps.length, 17);
  assert.deepEqual(
    [...rows, ...repeats, ...gaps].map((row) => row.sourcePosition).sort((a, b) => a - b),
    Array.from({ length: 221 }, (_, index) => index + 1),
  );
}

test('Infinity Saga retains the reviewed 221-position source vector and 14 raw collections', () => {
  assert.equal(ledger.sourceContentSha256,
    '1a2067e56a7c2c1833f225380acce3f6ec2ba0acedfb1679ea068e1153050e49');
  assert.equal(ledger.sourceIssueBearingBlocksSha256,
    '1adf32798c5f03f9a03dc70e80bbdf5c3010d4ec1641360a53d51cf44e93c74b');
  assert.equal(ledger.collectedCoverage.length, 14);
  assert.equal(ledger.rawFactualEntries.filter((entry) => entry.kind === 'collects').length, 14);
  assert.deepEqual(Object.values(ledger.counts.sections).map((section) => [
    section.occurrences, section.canonical, section.repeats,
  ]), [[30, 20, 10], [63, 43, 20], [69, 69, 0], [46, 46, 0], [13, 13, 0]]);
  assert.equal(ledger.proposedOccurrences.length, 221);
  assert.deepEqual(ledger.proposedOccurrences.map((row) => row.sourcePosition),
    Array.from({ length: 221 }, (_, index) => index + 1));
  assert.equal(digestCanonicalJson(sourceVector(ledger.proposedOccurrences)),
    'd8cf7b9b0505bb4f220d3003a9d03e9a16ddec599520f84517a1a9c9c6aacf7f');
  assertConserved(packet.rows, packet.repeatedSourceReferences, packet.sourceGaps);
  assert.deepEqual(sourceCountsForPacket(packet), expectedCounts);
  assert.doesNotThrow(() => validateFrozenPacket(packet, { expectedId: id }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.deepEqual(mapping.rows.map((row) => row.sourcePosition),
    packet.rows.map((row) => row.sourcePosition));
  assert.deepEqual(packet.repeatedSourceReferences.map((row) => [
    row.sourcePosition, packet.rows[row.canonicalRow - 1].sourcePosition,
  ]).filter(([source]) => source <= 30), [
    [17, 8], [21, 9], [22, 10], [23, 11], [24, 12],
    [25, 13], [26, 14], [27, 15], [29, 6], [30, 7],
  ]);
});

test('Infinity Saga interleaves all three directed events before nondirected continuations', () => {
  const at = (position) => ledger.proposedOccurrences[position - 1];
  for (const [position, kind, title, number] of [
    [8, 'collection-only', 'Silver Surfer', '40'],
    [16, 'collection-only', 'Silver Surfer', '39'],
    [31, 'directed-reading-order', 'Cloak and Dagger', '18'],
    [35, 'directed-reading-order', 'Silver Surfer', '51'],
    [36, 'directed-reading-order', 'Infinity Gauntlet', '1'],
    [61, 'directed-reading-order', 'Silver Surfer', '60'],
    [62, 'directed-reading-order', 'Doctor Strange, Sorcerer Supreme', '36'],
    [73, 'collection-only', 'Silver Surfer', '61'],
    [94, 'directed-reading-order', 'Infinity War', '1'],
    [99, 'directed-reading-order', 'Captain America', '408'],
    [112, 'directed-reading-order', 'Marvel Comics Presents', '108'],
    [115, 'directed-reading-order', 'Marvel Comics Presents', '111'],
    [163, 'directed-reading-order', 'Infinity Crusade', '1'],
    [171, 'directed-reading-order', 'Terror Inc.', '13'],
    [172, 'directed-reading-order', 'Marc Spector: Moon Knight', '56'],
    [209, 'collection-only', 'Thanos Annual', '1'],
    [221, 'collection-only', 'Infinity Gauntlet', '5'],
  ]) {
    assert.deepEqual([at(position).sourceKind, at(position).normalizedSeriesTitle,
      at(position).issueNumber], [kind, title, number], `source position ${position}`);
  }
  assert.deepEqual(mapping.rows.filter((row) => row.sourcePosition >= 112
    && row.sourcePosition <= 115).map((row) => row.issueNumber),
  ['108', '109', '110', '111']);
  assert.deepEqual(ledger.nonselections.slice(0, 6)
    .map((entry) => entry.sourceIssueReference), [
    'Material From Marvel Comics Presents (1988) 50',
    'Material From Silver Surfer Annual 5',
    'Material From Marvel Comics Presents (1988) 112',
    'Marvel Holiday Special 2',
    'Marvel Swimsuit Special 2',
    'What The-?! 24',
  ]);
  assert.deepEqual(ledger.nonselections.slice(0, 6).filter((entry) =>
    entry.ownerClosure === closureUrl).map((entry) => entry.sourceIssueReference), [
    'Material From Silver Surfer Annual 5',
    'Marvel Holiday Special 2',
    'Marvel Swimsuit Special 2',
  ]);
  assert.deepEqual(ledger.nonselections.filter((entry) =>
    entry.section === 'Infinity Crusades Reading Order'
    && entry.volume === 'Infinity Crusade Crossovers Vol. 2 Premiere')
    .map((entry) => entry.issueNumber), ['125', '127', '28', '126']);
  assert.ok(!ledger.proposedOccurrences.some((row) => (
    (row.normalizedSeriesTitle === 'Alpha Flight'
      && ['125', '126', '127'].includes(row.issueNumber))
    || (row.normalizedSeriesTitle === 'Deathlok' && row.issueNumber === '28')
  )));
  assert.equal(ledger.nonselections.filter((entry) =>
    entry.issueNumber === '112' && entry.normalizedSeriesTitle === 'Marvel Comics Presents').length, 1);
  assert.equal(ledger.collectedCoverage.filter((entry) =>
    entry.rawCollects.includes('Material From Marvel Comics Presents (1988) 112')).length, 2);
});

test('Infinity Saga checklist keeps 174 exact issues and 17 assigned gaps in first-occurrence order', async () => {
  const markdown = await readFile(`src/data/orders/${id}.md`, 'utf8');
  assert.equal(mapping.reviewStatus, 'approved');
  assert.deepEqual(mapping.approvedManifest, packet.proposedManifest);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 174);
  assert.equal(parsed.unresolved.length, 17);
  assert.deepEqual(packet.sourceGaps.map((row) => row.sourcePosition),
    [100, 120, 124, 130, 138, 170, 171, 172, 181, 182, 183, 185, 193, 194, 204, 207, 211]);
  assert.ok(packet.sourceGaps.every((row) => row.kind === 'published-metadata-gap'
    && row.status === 'open'
    && row.evidenceSources.some((evidence) => evidence.kind === 'tracking-issue'
      && evidence.url === 'https://github.com/raymond-nassar/recap-page/issues/586')));
  assert.ok(packet.sourceGaps.every((row) =>
    !/Silver Surfer Annual 5|Marvel Holiday Special 2|Marvel Swimsuit Special 2/.test(
      row.sourceIssueReference)));
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
  assert.deepEqual([...parsed.entries, ...parsed.unresolved]
    .sort((a, b) => a.index - b.index).map((entry) => Number(entry.sourceKey)),
  canonical.map((row) => row.sourcePosition));
  assert.ok(!Object.hasOwn(packet.proposedManifest, 'spotlightKind'));
});

test('Infinity Saga admission and relationship review stay current under Across eras', async () => {
  const entry = manifest.lists.find((row) => row.id === id);
  const index = manifest.lists.indexOf(entry);
  const inventoryEntry = inventory.find((row) => row.position === 51);
  assert.deepEqual(entry, packet.proposedManifest);
  assert.equal(mapping.reviewStatus, 'approved');
  assert.deepEqual(entry, mapping.approvedManifest);
  assert.equal(manifest.lists[index + 1].id, 'operation-galactic-storm');
  assert.equal(entry.type, 'era');
  assert.equal(entry.depth, 'partial');
  assert.equal(entry.timeline, null);
  assert.equal(entry.expect, 191);
  assert.equal(entry.coverIssueId, 9286);
  assert.ok(!Object.hasOwn(entry, 'spotlightKind'));
  assert.equal(entry.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
  assert.equal(entry.sourcePage, ledger.sourceUrl);
  assert.deepEqual([inventoryEntry.guideType, inventoryEntry.position, inventoryEntry.disposition,
    inventoryEntry.centralDisposition, inventoryEntry.deliveryStatus],
  ['era', 51, 'new-order', 'pilot-approved', 'shipped']);
  assert.deepEqual(inventoryEntry.catalogIds, [id]);
  assert.deepEqual(inventoryEntry.overlapIds, report.comparisons.filter((row) =>
    row.relationship !== 'none').map((row) => row.orderId).sort());
  assert.equal(inventoryEntry.overlapIds.length, 18);
  assert.deepEqual(report.comparisons.reduce((counts, row) => {
    counts[row.relationship] = (counts[row.relationship] ?? 0) + 1;
    return counts;
  }, {}), { partial: 18, none: 173 });
  assert.equal(report.comparisons.find((row) => row.orderId === 'x-23-reading-order')
    .relationship, 'none');
  assert.equal(report.comparisons.find((row) => row.orderId === 'silk-cindy-moon-reading-order')
    .relationship, 'none');
  assert.equal(report.comparisonCount, 191);
  const current = await buildReportForMapping(mappingPath, [], {
    excludedOrderIds: ['mcu-prep-thunderbolts', 'hawkeye-reading-order', 'marvel-zombies-reading-order',
      'ms-marvel-kamala-khan-reading-order', 'nova-reading-order', 'ultimate-spider-man-reading-order', 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide',
      'shang-chi-master-of-kung-fu-reading-order', 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order', 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order', 'namor-sub-mariner-reading-order', 'iron-fist-reading-order', 'mcu-prep-deadpool-and-wolverine'],
  });
  assert.deepEqual(current, report);
  assert.equal(mapping.relationshipReview?.approvalDigest,
    'd7b650a9cef9cc080cc3eb27e86a51a4b82696090a095223c750ff269d3e11ab');
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: current.libraryDigest,
    expectedOrderIds: manifest.lists.filter((row) =>
      row.id !== id && row.id !== 'hawkeye-reading-order'
      && row.id !== 'shang-chi-master-of-kung-fu-reading-order' && row.id !== 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order' && row.id !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order'
      && row.id !== 'marvel-zombies-reading-order'
      && row.id !== 'ms-marvel-kamala-khan-reading-order'
      && row.id !== 'nova-reading-order' && row.id !== 'ultimate-spider-man-reading-order' && row.id !== 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide').filter((row) => row.id !== 'namor-sub-mariner-reading-order' && row.id !== 'iron-fist-reading-order' && row.id !== 'mcu-prep-deadpool-and-wolverine' && row.id !== 'mcu-prep-thunderbolts').map((row) => row.id),
  }));
});

test('Infinity Saga authoring rejects a pending in-memory mapping', () => {
  const pending = { ...mapping, reviewStatus: 'pending-independent-review' };
  assert.throws(() => buildMarkdown(pending), /not approved/);
  assert.throws(() => assertApprovedRelationshipReview({
    packet, mapping: pending, report, currentLibraryDigest: report.libraryDigest,
    expectedOrderIds: manifest.lists.filter((row) =>
      row.id !== id && row.id !== 'hawkeye-reading-order'
      && row.id !== 'shang-chi-master-of-kung-fu-reading-order' && row.id !== 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order' && row.id !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order'
      && row.id !== 'marvel-zombies-reading-order'
      && row.id !== 'ms-marvel-kamala-khan-reading-order'
      && row.id !== 'nova-reading-order' && row.id !== 'ultimate-spider-man-reading-order' && row.id !== 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide').filter((row) => row.id !== 'namor-sub-mariner-reading-order' && row.id !== 'iron-fist-reading-order' && row.id !== 'mcu-prep-deadpool-and-wolverine' && row.id !== 'mcu-prep-thunderbolts').map((row) => row.id),
  }), /not approved/);
});

test('Infinity Saga pinned payload and catalog preserve Storylines discovery and gap provenance', async () => {
  const [payload, catalog] = await Promise.all([
    readJson(`src/data/${packet.proposedManifest.out}`),
    readJson('src/data/catalog.json'),
  ]);
  const entry = catalog.lists.find((row) => row.id === id);
  assert.equal(payload.count, 191);
  assert.equal(payload.items.length, 191);
  assert.equal(new Set(payload.items.map((row) => row.issueId)).size, 191);
  assert.equal(payload.items.filter((row) => row.issueId > 0).length, 174);
  assert.equal(payload.items.filter((row) => row.placeholder).length, 17);
  assert.equal(payload.placeholders, 17);
  assert.equal(payload.unresolved.length, 17);
  assert.deepEqual(payload.items.map((row) => row.issueId > 0 ? row.issueId : null),
    canonical.map((row) => row.selectedIssueId ?? null));
  assert.deepEqual(payload.items.filter((row) => row.placeholder).map((row) => row.title),
    mapping.sourceGaps.map((row) => row.sourceIssueReference));
  assert.ok(payload.items.every((row) => row.description == null));
  const refused = payload.items.filter((row) => row.detailsRefused);
  assert.deepEqual(refused.map((row) => row.issueId),
    [12648, 18925, 12650, 18261, 18926, 12651, 18262, 18927, 18263, 12652, 18929]);
  assert.ok(refused.every((row) => !row.placeholder && row.seriesId === null
    && row.digitalId === null && row.cover === null));
  assert.equal(entry.type, 'era');
  assert.equal(entry.coverIssueId, 9286);
  assert.equal(entry.placeholderCount, 17);
  assert.equal(entry.emptyRecordCount, 11);
  assert.ok(!Object.hasOwn(entry, 'spotlightKind'));
  assert.equal(entry.source, ledger.sourceUrl);
  assert.equal(catalog.lists.filter((row) => row.type === 'event').length, 189);
  assert.equal(catalog.lists.filter((row) => row.type === 'era').length, 10);
  assert.equal(catalog.lists.filter((row) => row.type === 'character-run').length, 70);
  const normalized = parseCatalog(catalog);
  const storylines = shelfStories(groupCatalog(normalized.lists), 'lines');
  const acrossEras = decadeSections(storylines).find((section) => section.key === 'across-eras');
  assert.equal(normalized.dropped, 0);
  assert.equal(catalogListShelf(normalized.lists, id), 'lines');
  assert.equal(acrossEras.stories.flatMap((story) => story.lists)
    .filter((list) => list.id === id).length, 1);
  assert.equal(modernTimelineLists(normalized.lists).some((list) => list.id === id), false);
});

test('Infinity Saga checks fail if a selected row or source repeat silently disappears', () => {
  assert.throws(() => assertConserved(packet.rows.slice(1), packet.repeatedSourceReferences,
    packet.sourceGaps), /173 !== 174/);
  assert.throws(() => assertConserved(packet.rows, packet.repeatedSourceReferences.slice(1),
    packet.sourceGaps), /29 !== 30/);
  const moved = structuredClone(ledger.proposedOccurrences);
  [moved[35], moved[36]] = [moved[36], moved[35]];
  assert.notEqual(digestCanonicalJson(sourceVector(moved)),
    'd8cf7b9b0505bb4f220d3003a9d03e9a16ddec599520f84517a1a9c9c6aacf7f');
});
