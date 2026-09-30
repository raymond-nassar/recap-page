import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertMappingMatchesPacketOccurrences,
  digestCanonicalJson,
  gapEvidenceDigestFor,
  validateFrozenPacket,
  validateInventoryState,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import { buildReportForMapping, loadLibrarySnapshot } from '../scripts/report-order-overlap.mjs';
import { parseCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'silk-cindy-moon-reading-order';
const sourceUrl = 'https://www.comicbookherald.com/silk-cindy-moon-reading-order/';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);

test('Silk conserves all 74 original source positions across exact rows and open digital gaps', () => {
  assert.equal(packet.sourceUrl, sourceUrl);
  assert.equal(packet.sourceContentSha256,
    '2ecec5d22636d8df48cd602c74ba9ffff83a69b267d9a40c564ce64ccee97e5a');
  assert.equal(packet.sourceIssueBearingBlocksSha256,
    '84b2cc98f43b7245134dcd5516b89b6c47c0c995103cc6dfaea244894010761f');
  assert.equal(ledger.blocks.length, 13);
  assert.equal(ledger.orderedSeriesSegmentCount, 21);
  assert.deepEqual(ledger.sections.map((section) => section.occurrenceCount), [6, 28, 40]);
  assert.deepEqual(ledger.blocks.map((block) => block.occurrenceCount),
    [6, 7, 7, 5, 6, 3, 8, 8, 6, 4, 4, 4, 6]);
  assert.equal(packet.sourceOccurrenceCount, 74);
  assert.equal(packet.rows.length, 67);
  assert.equal(packet.sourceGaps.length, 7);
  assert.equal(packet.repeatedSourceReferences, undefined);
  assert.deepEqual(packet.sourceGaps.map((gap) => gap.sourcePosition), [44, 45, 46, 47, 48, 49, 50]);
  assert.ok(packet.sourceGaps.every((gap) => gap.kind === 'published-metadata-gap'
    && gap.status === 'open' && gap.evidenceDigest === gapEvidenceDigestFor(gap)));
  assert.ok(packet.sourceGaps.every((gap) => gap.evidenceSources.some((source) => (
    source.url === 'https://github.com/raymond-nassar/recap-page/issues/568'
  ))));
  const vector = [
    ...mapping.rows.map((row) => [
      row.sourcePosition, row.seriesId, row.issueNumber, row.selectedIssueId,
    ]),
    ...mapping.sourceGaps.map((gap) => [
      gap.sourcePosition, 21127, gap.issueNumber, null,
    ]),
  ].sort((left, right) => left[0] - right[0]);
  assert.deepEqual(vector.map((row) => row[0]), Array.from({ length: 74 }, (_, i) => i + 1));
  assert.equal(digestCanonicalJson(vector),
    '686abaf004fab5d4fe2b8e53385453324d99d68f06c0d3f1ed2bff4dafdadb03');
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
});

test('Silk retains original volumes, section order, narrower cuts and qualified one-shots', () => {
  const at = (position) => mapping.rows.find((row) => row.sourcePosition === position);
  assert.deepEqual([at(1).seriesId, at(1).selectedIssueId, at(6).issueNumber], [17285, 45798, '6']);
  assert.deepEqual([at(7).seriesId, at(14).seriesId, at(20).seriesId], [19661, 20499, 20432]);
  assert.equal(mapping.candidateMetadata.find((candidate) => candidate.id === 55298).onSaleDate
    .slice(0, 10), '2015-10-07');
  assert.deepEqual([at(32).issueNumber, at(33).issueNumber, at(34).issueNumber], ['1', '2', '3']);
  assert.deepEqual(mapping.rows.filter((row) => row.sourcePosition >= 35 && row.sourcePosition <= 42)
    .map((row) => row.seriesId), [21280, 20499, 20499, 20505, 20505, 20618, 20618, 21442]);
  assert.deepEqual([at(43).seriesId, at(43).selectedIssueId], [21127, 57973]);
  assert.ok(mapping.rows.every((row) => ![58648, 58649, 58650, 58651]
    .includes(row.selectedIssueId)));
  assert.deepEqual(mapping.rows.filter((row) => row.sourcePosition >= 51 && row.sourcePosition <= 56)
    .map((row) => row.issueNumber), ['13', '14', '15', '16', '17', '18']);
  assert.deepEqual(mapping.rows.filter((row) => row.sourcePosition >= 57 && row.sourcePosition <= 64)
    .map((row) => row.seriesId), [27505, 27505, 27505, 27505, 27624, 27624, 27624, 27624]);
  assert.deepEqual(mapping.rows.filter((row) => row.sourcePosition >= 65 && row.sourcePosition <= 68)
    .map((row) => row.selectedIssueId), [77116, 90780, 77117, 85661]);
  assert.match(at(68).sourceIssueReference, /Spider-Man story/);
  assert.deepEqual(mapping.rows.slice(-6).map((row) => row.issueNumber), ['50', '51', '52', '53', '54', '55']);
  assert.equal(packet.proposedManifest.depth, 'partial');
  assert.equal(packet.proposedManifest.spotlightKind, 'other');
  assert.equal(packet.proposedManifest.expect, 74);
  assert.equal(packet.proposedManifest.timeline, null);
  assert.equal(packet.proposedManifest.coverIssueId, 45798);
  assert.ok(packet.excludedSourceReferences.some((reference) => reference.includes('Amazing Spider-Man (2018) #44')));
});

test('Silk retains the approved relationships against every current library peer', async () => {
  const library = await loadLibrarySnapshot();
  const current = await buildReportForMapping(`scripts/data/cbh-mappings/${id}.json`, [], {
    excludedOrderIds: ['marvels-infinity-saga-gauntlet-wars-crusade-reading-order',
      'hawkeye-reading-order', 'marvel-zombies-reading-order',
      'ms-marvel-kamala-khan-reading-order', 'nova-reading-order', 'ultimate-spider-man-reading-order', 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide', 'shang-chi-master-of-kung-fu-reading-order', 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order', 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order', 'namor-sub-mariner-reading-order'],
  });
  const expectedOrderIds = library.lists.filter((entry) => entry.id !== 'shang-chi-master-of-kung-fu-reading-order' && entry.id !== 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order' && entry.id !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order' && entry.id !== id
    && entry.id !== 'marvels-infinity-saga-gauntlet-wars-crusade-reading-order'
    && entry.id !== 'hawkeye-reading-order'
    && entry.id !== 'marvel-zombies-reading-order'
    && entry.id !== 'ms-marvel-kamala-khan-reading-order'
    && entry.id !== 'nova-reading-order' && entry.id !== 'ultimate-spider-man-reading-order' && entry.id !== 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide').filter((row) => row.id !== 'namor-sub-mariner-reading-order')
    .map((entry) => entry.id);
  assert.deepEqual(current, report);
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.equal(report.comparisonCount, 190);
  assert.deepEqual(report.comparisons.map((row) => row.orderId), expectedOrderIds.toSorted());
  assert.deepEqual(report.comparisons.reduce((counts, row) => {
    counts[row.relationship] = (counts[row.relationship] ?? 0) + 1;
    return counts;
  }, {}), { none: 179, partial: 11 });
  assert.deepEqual(report.comparisons.filter((row) => row.relationship !== 'none')
    .map((row) => [row.orderId, row.sharedCount]), [
    ['agents-of-atlas-reading-order', 8],
    ['amazing-spider-man-reading-order-modern-marvel-era', 10],
    ['clone-conspiracy', 4],
    ['doctor-octopus-otto-octavius-reading-order', 5],
    ['iron-man-reading-order', 1],
    ['miles-morales-spider-man-reading-order', 11],
    ['question-of-the-week-do-you-have-a-hulk-reading-order', 6],
    ['spider-gwen-reading-order', 8],
    ['spider-man-2099-reading-order', 1],
    ['spider-verse', 3],
    ['war-of-the-realms', 4],
  ]);
  assert.deepEqual(
    report.comparisons.filter((row) => [
      'nebula-reading-order', 'hope-summers-reading-order', 'x-23-reading-order',
    ].includes(row.orderId)).map((row) => [row.orderId, row.relationship, row.sharedCount]),
    [
      ['hope-summers-reading-order', 'none', 0],
      ['nebula-reading-order', 'none', 0],
      ['x-23-reading-order', 'none', 0],
    ],
  );
  assert.equal(mapping.reviewStatus, 'approved');
  assert.equal(mapping.relationshipReview.approvalDigest,
    'b20f6c2685a007d0abb5e8b9ec4a215f955df31b07c3d605b925f0d73259d90a');
  assert.equal(mapping.relationshipReview.dispositions.length, 190);
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: current.libraryDigest, expectedOrderIds,
  }));
});

test('Silk ships 67 exact issues, seven original digital placeholders and source credit', async () => {
  const [inventory, manifest, catalogRaw, markdown, payload] = await Promise.all([
    readJson('scripts/data/cbh-character-inventory.json'),
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson(`src/data/${packet.proposedManifest.out}`),
  ]);
  const record = inventory.find((row) => row.id === id);
  const entry = manifest.lists.find((row) => row.id === id);
  const catalog = parseCatalog(catalogRaw);
  const card = catalog.lists.find((row) => row.id === id);
  const parsed = parseChecklist(markdown);
  assert.doesNotThrow(() => validateInventoryState(inventory));
  assert.equal(record.position, 133);
  assert.equal(record.deliveryStatus, 'shipped');
  assert.equal(record.sourceContentSha256, packet.sourceContentSha256);
  assert.deepEqual(record.catalogIds, [id]);
  assert.deepEqual(record.overlapIds, report.comparisons.filter((row) => row.relationship !== 'none')
    .map((row) => row.orderId).sort());
  assert.deepEqual(entry, mapping.approvedManifest);
  assert.equal(card.coverIssueId, 45798);
  assert.equal(card.count, 74);
  assert.equal(card.placeholderCount, 7);
  assert.equal(card.source, sourceUrl);
  assert.equal(card.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
  assert.equal(card.depth, 'partial');
  assert.equal(card.spotlightKind, 'other');
  assert.equal(parsed.entries.length, 67);
  assert.equal(parsed.unresolved.length, 7);
  assert.deepEqual([...parsed.entries, ...parsed.unresolved]
    .sort((left, right) => left.index - right.index).map((row) => Number(row.sourceKey)),
  Array.from({ length: 74 }, (_, i) => i + 1));
  assert.deepEqual(parsed.entries.map((row) => row.issueId), mapping.rows.map((row) => row.selectedIssueId));
  assert.deepEqual(payload.items.filter((row) => row.placeholder).map((row) => row.number),
    ['2', '3', '4', '5', '6', '7', '8']);
  assert.ok(payload.items.slice(43, 50).every((row) => row.placeholder === true
    && row.issueId < 0 && row.url === null && row.title.includes('Infinite Comic')));
  assert.deepEqual(payload.items.filter((row) => !row.placeholder).map((row) => row.issueId),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.match(payload.items[67].collectedIn, /Spider-Man story only/);
  assert.equal(payload.items[67].issueId, 85661);
  assert.deepEqual(parsed.headings.slice(1),
    [...new Set(payload.items.map((item) => item.collectedIn))]);
  assert.ok(card.description);
});

test('Silk named author reproduces every pinned collection and digital gap', async () => {
  const [markdown, payload] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson(`src/data/${packet.proposedManifest.out}`),
  ]);
  const authored = buildMarkdown(mapping);
  assert.equal(markdown.replace(/\r\n/g, '\n'), authored);
  const parsed = parseChecklist(authored);
  const rows = [...parsed.entries, ...parsed.unresolved].sort((left, right) => left.index - right.index);
  assert.equal(rows.length, 74);
  assert.deepEqual(rows.map((row) => Number(row.sourceKey)),
    Array.from({ length: 74 }, (_, i) => i + 1));
  assert.deepEqual(rows.map((row) => row.section), payload.items.map((item) => item.collectedIn));
  assert.deepEqual(rows.map((row) => row.issueId ?? null),
    payload.items.map((item) => item.placeholder ? null : item.issueId));
  assert.deepEqual(rows.map((row) => row.title), payload.items.map((item) => item.title));
  assert.deepEqual(parsed.unresolved.map((row) => row.title),
    payload.items.filter((item) => item.placeholder).map((item) => item.title));
  assert.deepEqual(parsed.unresolved.map((row) => row.index + 1), [44, 45, 46, 47, 48, 49, 50]);
  assert.match(rows[67].section, /FCBD 2020 #1 Spider-Man story only/);
});

test('Silk checkpoint gates reject changed originals, vanished gaps and lost peer comparisons', () => {
  const wrongOriginal = structuredClone(mapping);
  wrongOriginal.rows[0].selectedIssueId = 58648;
  assert.throws(() => validateMappingDigest(wrongOriginal), /mapping digest is stale/i);

  const lostGap = structuredClone(packet);
  lostGap.sourceGaps.pop();
  assert.throws(() => validateFrozenPacket(lostGap), /source|packet|gap/i);

  const lostPeer = structuredClone(report);
  lostPeer.comparisons.pop();
  assert.throws(() => validateReportDigest(lostPeer), /report digest is stale/i);
});
