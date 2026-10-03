import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertMappingMatchesPacketOccurrences,
  validateFrozenPacket,
  validateInventoryState,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { assertApprovedRelationshipReview, buildMarkdown, selectedIssueIds } from '../scripts/author-cbh-packet.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { placeholderId } from '../scripts/lib/placeholder-id.mjs';
import { parseCatalog, searchCatalog, shelfKey } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { countOrderGaps, MAX_COLLECTION } from '../src/js/lib/model.js';

const id = 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order';
const source = 'https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/age-of-apocalypse-reading-order/';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const gapPositions = [15, 21, 100, 131, 132, 133, 138, 139, 140, 141, 269, 270, 271, 272, 273, 274];
const repeatedPositions = [54, 95, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210];
const originalPositions = Array.from({ length: 275 }, (_, offset) => offset + 1)
  .filter((position) => !gapPositions.includes(position) && !repeatedPositions.includes(position));
const exactVectorDigest = '5c6eac5f3b4fbd41a598210cf26304f2df594757b05a22699d4fd881dad1c0d8';

test('AoA preserves the approved full-page source and every original, gap and repeat position', () => {
  const selectedStructuralVector = ledger.selectedOccurrences.map((item) => ({
    selectedPosition: item.selectedPosition,
    printedPosition: item.printedPosition,
    sourceBlock: item.sourceBlock,
    series: item.series,
    issueNumber: item.issueNumber,
    disposition: item.disposition,
    firstSelectedPosition: item.firstSelectedPosition,
  }));
  assert.equal(createHash('sha256').update(JSON.stringify(selectedStructuralVector)).digest('hex'),
    ledger.selectedStructuralVectorSha256);
  assert.equal(ledger.selectedStructuralVectorSha256,
    '1fd1977e3500e1af33b708dcfd4b399209f987bbf2d64c2fa0acaeaa7c1a1532');
  assert.equal(ledger.source.url, source);
  assert.equal(ledger.source.rawResponseSha256,
    '102e3bd2bc5f69ff6143c6e63298beb8d43a3077331189bb2754497c4fae582b');
  assert.match(ledger.status, /independently approved/);
  assert.deepEqual(ledger.sourceReview, packet.sourceReview);
  assert.deepEqual(ledger.selectedOccurrences.map((item) => item.selectedPosition),
    Array.from({ length: 275 }, (_, offset) => offset + 1));
  assert.equal(ledger.printedProvenance.length, 281);
  const printedIdentityVector = ledger.printedProvenance.map((item) => ({
    printedPosition: item.printedPosition,
    sourceBlock: item.sourceBlock,
    disposition: item.disposition,
    identity: item.identity,
  }));
  assert.equal(createHash('sha256').update(JSON.stringify(printedIdentityVector)).digest('hex'),
    '73942435fba9de03a9ebdf1b802b2d427c01c338bcb2dce1bf5862e166b3359d');
  assert.deepEqual(ledger.printedProvenance.reduce((counts, item) => {
    counts[item.disposition] = (counts[item.disposition] ?? 0) + 1;
    return counts;
  }, {}), {
    selected: 237,
    'older-alternate-backreference': 38,
    'qualified-non-whole-fragment': 6,
  });
  assert.equal(ledger.selectedFromCountDirections.length, 38);
  assert.deepEqual(packet.rows.map((row) => row.sourcePosition), originalPositions);
  assert.deepEqual(packet.sourceGaps.map((gap) => gap.sourcePosition), gapPositions);
  assert.deepEqual(packet.repeatedSourceReferences.map((repeat) => repeat.sourcePosition), repeatedPositions);
  assert.deepEqual(packet.repeatedSourceReferences.map((repeat) => [
    repeat.sourcePosition,
    packet.rows[repeat.canonicalRow - 1].sourcePosition,
  ]), [[54, 20], [95, 92], ...Array.from({ length: 11 }, (_, offset) => [
    200 + offset, 182 + offset,
  ])]);
  assert.equal(packet.sourceOccurrenceCount, 275);
  assert.equal(packet.expectedCount, 246);
  assert.equal(packet.proposedManifest.expect, 262);
  assert.equal(packet.proposedManifest.coverIssueId, 12386);
  assert.equal(packet.proposedManifest.timeline, null);
  assert.deepEqual([
    packet.proposedManifest.type, packet.proposedManifest.depth, packet.proposedManifest.spotlightKind,
  ], ['character-run', 'partial', 'other']);
  assert.deepEqual(packet.insertionAnchor, { beforeId: 'xmen-claremont' });
  assert.equal(packet.sourceReview.authorityIdentity, 'Independent source coordinator for guide issue #621');
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
});

test('AoA exact-ID vector retains 246 distinct originals and all 16 qualified question slots', () => {
  const ids = selectedIssueIds(mapping).map(Number);
  assert.equal(ids.length, 246);
  assert.equal(new Set(ids).size, 246);
  assert.equal(createHash('sha256').update(JSON.stringify(ids)).digest('hex'), exactVectorDigest);
  assert.deepEqual(mapping.rows.filter((row) => row.sourcePosition >= 166 && row.sourcePosition <= 171)
    .map((row) => [row.seriesYear, row.selectedIssueId]),
  [[2004, 3534], [2004, 3539], [2004, 3945], [2004, 4068], [2004, 4181], [2004, 4281]]);
  assert.deepEqual(mapping.rows.filter((row) => row.manualSeriesSelectionApproved)
    .map((row) => row.sourcePosition), [18, 19]);
  assert.deepEqual(mapping.rows.find((row) => row.sourcePosition === 19)
    .metadataIssueNumber, '1');
  assert.equal(mapping.rows.find((row) => row.sourcePosition === 19).issueNumber, '2');
  assert.equal(mapping.rows.find((row) => row.sourcePosition === 130).selectedIssueId, 50992);
  assert.equal(mapping.rows.find((row) => row.sourcePosition === 256).selectedIssueId, 49221);
  assert.equal(mapping.rows.filter((row) => row.normalizedSeriesTitle === 'Uncanny Avengers').length, 25);
  assert.equal(mapping.rows.filter((row) => row.normalizedSeriesTitle === 'Age of Apocalypse'
    && row.seriesYear === 2012).length, 14);
  assert.ok(mapping.rows.every((row) => !/8\s*AU/i.test(row.sourceIssueReference)));
  assert.deepEqual(mapping.sourceGaps.map((gap) => gap.sourcePosition), gapPositions);
  for (const gap of mapping.sourceGaps) {
    assert.equal(gap.kind, 'published-metadata-gap');
    assert.equal(gap.status, 'open');
    assert.match(gap.auditBasis, /no provider-wide absence, publication or availability determination/i);
    assert.ok(gap.evidenceSources.some((item) => item.kind === 'tracking-issue'));
  }
  assert.match(mapping.sourceGaps.find((gap) => gap.sourcePosition === 15).auditBasis,
    /exact original identity remains unresolved/);
});

test('AoA relationship report is rebuilt from every peer at its review', async () => {
  const manifest = await readJson('src/data/curated-lists.json');
  const expectedOrderIds = manifest.lists.map((item) => item.id)
    .filter((orderId) => orderId !== id
      && orderId !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order'
      && orderId !== 'namor-sub-mariner-reading-order'
      && orderId !== 'iron-fist-reading-order' && orderId !== 'mcu-prep-shang-chi-and-the-legend-of-the-ten-rings' && orderId !== 'mcu-prep-thunderbolts')
    .sort((left, right) => left.localeCompare(right));
  const live = await buildReportForMapping(
    `scripts/data/cbh-mappings/${id}.json`, [],
    { excludedOrderIds: ['the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order',
      'namor-sub-mariner-reading-order', 'iron-fist-reading-order', 'mcu-prep-shang-chi-and-the-legend-of-the-ten-rings', 'mcu-prep-thunderbolts'] },
  );
  assert.equal(expectedOrderIds.length, 199);
  assert.deepEqual(report.comparisons.map((item) => item.orderId), expectedOrderIds);
  assert.deepEqual(live, report);
  assert.equal(report.comparisonCount, 199);
  assert.equal(report.candidateCount, 246);
  assert.deepEqual(report.comparisons.reduce((counts, item) => {
    counts[item.relationship] = (counts[item.relationship] ?? 0) + 1;
    return counts;
  }, {}), { none: 173, partial: 23, 'existing-subset': 3 });
  assert.deepEqual(report.comparisons.filter((item) => item.relationship === 'existing-subset')
    .map((item) => [item.orderId, item.sharedCount]), [
    ['messiah-war', 10], ['mutant-massacre', 11], ['x-cutioners-song', 13],
  ]);
  assert.deepEqual(report.comparisons.find((item) =>
    item.orderId === 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide')
    .sharedIds, []);
  assert.deepEqual(report.comparisons.find((item) =>
    item.orderId === 'shang-chi-master-of-kung-fu-reading-order')
    .sharedIds, []);
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.equal(mapping.reviewStatus, 'approved');
  assert.match(mapping.packetReview, /^Independent coordinator/);
  assert.deepEqual(mapping.approvedManifest, packet.proposedManifest);
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: live.libraryDigest, expectedOrderIds,
  }));
  const pending = structuredClone(mapping);
  pending.reviewStatus = 'pending-independent-review';
  delete pending.packetReview;
  delete pending.approvedManifest;
  delete pending.relationshipReview;
  assert.throws(() => assertApprovedRelationshipReview({
    packet, mapping: pending, report, currentLibraryDigest: live.libraryDigest, expectedOrderIds,
  }), /approved|review|pending/i);
});

test('AoA published checklist preserves 262 positions under factual section headings', async () => {
  const [markdown, manifest, inventory] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson('src/data/curated-lists.json'),
    readJson('scripts/data/cbh-character-inventory.json'),
  ]);
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 246);
  assert.equal(parsed.unresolved.length, 16);
  const all = [...parsed.entries, ...parsed.unresolved].sort((left, right) => left.index - right.index);
  assert.deepEqual(all.map((item) => Number(item.sourceKey)),
    Array.from({ length: 275 }, (_, offset) => offset + 1)
      .filter((position) => !repeatedPositions.includes(position)));
  assert.deepEqual(parsed.unresolved.map((item) => Number(item.sourceKey)), gapPositions);
  assert.deepEqual(parsed.entries.map((item) => item.issueId), selectedIssueIds(mapping).map(Number));
  const fieldsByPosition = new Map([...mapping.rows, ...mapping.sourceGaps]
    .map((entry) => [entry.sourcePosition, entry]));
  assert.deepEqual(all.map((item) => [
    fieldsByPosition.get(Number(item.sourceKey))?.sourceRangeReference,
    fieldsByPosition.get(Number(item.sourceKey))?.sourceGroup,
  ]), all.map((item) => [item.section, item.section]));
  assert.equal(buildMarkdown(mapping).replace(/\r\n?/g, '\n'), markdown.replace(/\r\n?/g, '\n'));
  assert.equal(parsed.headings.filter((heading) => heading.startsWith('Preferred modern')).length, 5);
  assert.equal(parsed.headings.length, 13);
  assert.ok(parsed.entries.filter((item) => Number(item.sourceKey) >= 72
    && Number(item.sourceKey) <= 274).every((item) =>
    !item.section?.includes('Earth-616')));
  assert.ok(all.every((item) => !item.section || item.section.length <= MAX_COLLECTION));
  const chosen = parsed.entries.find((entry) => entry.sourceKey === '275');
  assert.match(chosen.section, /Older-edition companion: The Chosen/);
  assert.equal(manifest.lists.length, 205);
  assert.equal(manifest.lists[manifest.lists.findIndex((entry) => entry.id === id) + 1].id,
    'xmen-claremont');
  assert.deepEqual(manifest.lists.find((entry) => entry.id === id), packet.proposedManifest);
  assert.doesNotThrow(() => validateInventoryState(inventory));
});

test('AoA vendor preserves the complete 262-position reading vector and qualified gaps', async () => {
  const [markdown, payload, catalogRaw, inventory] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson(`src/data/${packet.proposedManifest.out}`),
    readJson('src/data/catalog.json'),
    readJson('scripts/data/cbh-character-inventory.json'),
  ]);
  const parsed = parseChecklist(markdown);
  const selected = [...parsed.entries, ...parsed.unresolved].sort((left, right) => left.index - right.index);
  const expectedIds = selected.map((entry) =>
    entry.issueId ?? placeholderId(id, entry.title, entry.sourceKey));
  assert.equal(selected.length, 262);
  assert.deepEqual(payload.items.map((item) => item.issueId), expectedIds);
  assert.equal(new Set(expectedIds).size, 262);
  assert.deepEqual(payload.items.map((item) => item.collectedIn),
    selected.map((entry) => entry.section));
  assert.ok(payload.items.every((item) => item.collectedIn.length <= MAX_COLLECTION));
  assert.deepEqual(payload.unresolved.map((item) => Number(item.sourceKey)), gapPositions);
  assert.deepEqual(payload.items.filter((item) => item.placeholder).map((item) => item.issueId),
    parsed.unresolved.map((entry) => placeholderId(id, entry.title, entry.sourceKey)));
  assert.deepEqual(countOrderGaps(payload), { placeholders: 16, empty: 0 });
  assert.deepEqual([payload.count, payload.items.length, payload.placeholders, payload.collections],
    [262, 262, 16, 12]);
  assert.ok(payload.items.filter((item) => item.issueId > 0).every((item) =>
    item.seriesId > 0 && item.digitalId > 0 && item.cover?.path && item.description === null
    && !item.detailsRefused));
  assert.deepEqual(payload.items.slice(-7, -1).map((item) => [
    item.title, item.placeholder,
  ]), Array.from({ length: 6 }, (_, index) => [
    `X-Men of Apocalypse (2025) #${index + 1}`, true,
  ]));
  assert.equal(payload.items.at(-1).issueId, 17701);
  assert.match(payload.items.at(-1).collectedIn, /Older-edition companion: The Chosen/);
  const catalog = parseCatalog(catalogRaw);
  assert.equal(catalog.dropped, 0);
  const card = catalog.lists.find((entry) => entry.id === id);
  assert.deepEqual([
    card.count, card.coverIssueId, card.type, card.depth, card.spotlightKind, card.timeline,
  ], [262, 12386, 'character-run', 'partial', 'other', null]);
  assert.deepEqual(card.cover, payload.items.find((item) => item.issueId === 12386).cover);
  assert.equal(shelfKey({ lists: [card] }), 'spotlights');
  assert.ok(searchCatalog(catalog.lists, 'Age of Apocalypse').some((entry) => entry.id === id));
  const record = inventory.find((entry) => entry.id === id);
  assert.deepEqual([record.position, record.guideType, record.deliveryStatus, record.catalogIds],
    [7, 'character-run', 'shipped', [id]]);
  assert.deepEqual(record.sourcePositions, [7, 127]);
  assert.deepEqual(record.overlapIds, report.comparisons.filter((row) =>
    row.relationship !== 'none').map((row) => row.orderId));
});
