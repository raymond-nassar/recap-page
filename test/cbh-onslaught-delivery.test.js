import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertMappingMatchesPacketOccurrences, digestCanonicalJson, libraryDigestFor, validateFrozenPacket,
  validateInventoryState, validateMappingDigest, validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { issueIdsFromValue } from '../scripts/lib/cbh-overlap.mjs';
import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseCatalog, searchCatalog, shelfKey } from '../src/js/lib/catalog.js';
import { parseManifest } from '../src/js/lib/curated.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { placeholderId } from '../scripts/lib/placeholder-id.mjs';

const id = 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order';
const sourceUrl = 'https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/x-men-onslaught-reading-order/';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sourcePositions = Array.from({ length: 74 }, (_, index) => index + 1);
const printedPositions = Array.from({ length: 100 }, (_, index) => index + 1);
const originalIds = [
  12371, 13863, 14331, 14332, 14333, 13864, 13865, 51107, 13866, 14334, 13867, 18158,
  51108, 51109, 51106, 14335, 14336, 13868, 18159, 13869, 51105, 14337, 14338,
  13870, 13871, 52991, 52992, 18111, 14340, 13872, 13873, 14039, 14341, 14342, 52990,
  14343, 13875, 14344, 20767, 7288, 13245, 7409, 9255, 8564, 14042, 12203, 12204,
  51043, 6833, 23910, 10836, 18186, 18024, 23391, 14345, 13877, 7410, 18025, 18187,
  9256, 9586, 7289, 11830, 14043, 13246, 14346, 10453, 7411, 13878, 14347, 23388, 16337,
];
const omittedPrinted = [13, 17, ...Array.from({ length: 22 }, (_, index) => index + 40), 65, 66];

test('Onslaught preserves all 100 printed references and exactly 74 ordered selections', () => {
  assert.deepEqual(ledger.printedPositions.map((row) => row.printedPosition), printedPositions);
  assert.equal(ledger.blocks.length, 8);
  assert.deepEqual(ledger.blocks.map((block) => block.references.length),
    [13, 13, 13, 22, 10, 11, 10, 8]);
  const factual = hash({
    sourceUrl,
    blocks: ledger.blocks.map(({ sourceGroup, references }) => ({
      section: sourceGroup, references,
    })),
  });
  assert.equal(factual, '0c072bcb1ffab9042a159bfcdc84bcf25041bdc6eabf3fa04709f6270ee154d0');
  assert.equal(ledger.sourceContentSha256, factual);
  assert.equal(ledger.sourceIssueBearingBlocksSha256, factual);
  assert.equal(packet.sourceContentSha256, factual);
  assert.equal(packet.sourceIssueBearingBlocksSha256, factual);
  assert.equal(ledger.sourceHashDefinition.includes('ONE identical factual measurement'), true);
  assert.equal(ledger.sourceUrl, sourceUrl);
  assert.equal(packet.sourceUrl, sourceUrl);

  const selected = ledger.printedPositions.filter((row) => row.sourcePosition != null);
  assert.deepEqual(selected.map((row) => row.sourcePosition), sourcePositions);
  assert.deepEqual(selected.map((row) => row.printedPosition),
    printedPositions.filter((position) => !omittedPrinted.includes(position)));
  const selectedProjection = hash(selected.map((row) => ({
    sourcePosition: row.sourcePosition,
    printedPosition: row.printedPosition,
    sourceBlock: row.sourceBlock,
    sourceGroup: row.sourceGroup,
    sourceIssueReference: row.sourceIssueReference,
  })));
  assert.equal(selectedProjection, '5c1d335e875f00513f62ceec416f94149079d8fcaf4e2ed0e72fa4775647d8ea');
  assert.equal(ledger.selectedProjectionSha256, selectedProjection);
  assert.deepEqual(ledger.printedPositions.reduce((counts, row) => {
    counts[row.disposition] = (counts[row.disposition] ?? 0) + 1;
    return counts;
  }, {}), {
    'selected-original-candidate': 72,
    'selected-qualified-companion': 2,
    'excluded-source-unrelated': 1,
    'unverified-reference-provenance': 1,
    'optional-prelude-unique-excerpt': 16,
    'optional-prelude-backward-excerpt': 6,
    'excluded-one-page-excerpt': 2,
  });
  assert.deepEqual(ledger.printedPositions.filter((row) =>
    row.disposition === 'optional-prelude-backward-excerpt').map((row) => row.printedPosition),
  [43, 45, 46, 47, 49, 50]);
  assert.deepEqual(ledger.printedPositions.filter((row) =>
    row.disposition === 'selected-qualified-companion').map((row) => row.sourcePosition),
  [24, 37]);
  assert.deepEqual(ledger.printedPositions.filter((row) =>
    row.sourcePosition === 37).map((row) => row.sourceIssueReference),
  ['Xavier Institute Yearbook']);
  assert.equal(packet.sourceOccurrenceCount, 74);
  assert.equal(packet.expectedCount, 72);
  assert.equal(packet.proposedManifest.expect, 74);
  assert.equal(mapping.rows.length, 72);
  assert.equal(mapping.sourceGaps.length, 2);
  assert.equal(mapping.repeatedSourceReferences?.length ?? 0, 0);
  assert.deepEqual([...mapping.rows, ...mapping.sourceGaps]
    .map((row) => row.sourcePosition).sort((a, b) => a - b), sourcePositions);
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
});

test('Onslaught keeps original series, companions, both gaps and excerpt boundaries distinct', () => {
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), originalIds);
  assert.equal(new Set(originalIds).size, 72);
  const at = (position) => mapping.rows.find((row) => row.sourcePosition === position);
  for (const [position, seriesId, number, issueId] of [
    [1, 2102, '1', 12371], [8, 19205, '1', 51107],
    [13, 19206, '1', 51108], [14, 19206, '2', 51109],
    [15, 19204, '1', 51106], [21, 19203, '1', 51105],
    [37, 19823, '1', 52990], [41, 3900, '1', 20767],
    [42, 1991, '401', 7288], [43, 2121, '415', 13245],
    [44, 1995, '34', 7409], [45, 2021, '444', 9255],
    [50, 19135, '8', 51043], [54, 3643, '18', 18186],
    [56, 6681, '11', 23391], [69, 2057, '1', 10453],
    [73, 6680, '1', 23388], [74, 13577, '6', 16337],
  ]) assert.deepEqual([at(position)?.seriesId, at(position)?.issueNumber, at(position)?.selectedIssueId],
    [seriesId, number, issueId], `selected position ${position}`);
  assert.deepEqual(mapping.rows.filter((row) =>
    row.manualSeriesSelectionApproved).map((row) => row.sourcePosition), [1, 13, 14]);
  assert.deepEqual(mapping.sourceGaps.map((row) =>
    [row.sourcePosition, row.sourceIssueReference, row.status]),
  [[24, 'X-Men Hotshots', 'open'], [27, 'Archangel #1', 'open']]);
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
  assert.ok(mapping.sourceGaps[0].evidenceSources.some((source) =>
    source.url === 'https://github.com/raymond-nassar/recap-page/issues/640'));
  assert.ok(mapping.sourceGaps[1].evidenceSources.some((source) =>
    source.url === 'https://github.com/raymond-nassar/recap-page/issues/641'));
  assert.deepEqual(ledger.printedPositions.filter((row) =>
    row.disposition === 'excluded-one-page-excerpt').map((row) => row.sourceIssueReference),
  ['Fantastic Four #414', 'Avengers #400']);
  assert.equal(ledger.printedPositions[16].sourceIssueReference, 'X-Men Timelines');
  assert.equal(ledger.printedPositions[16].sourcePosition, undefined);
  assert.deepEqual(ledger.printedPositions[75].sourcePosition, 50);
  assert.ok(!mapping.rows.some((row) => row.sourceIssueReference === 'Fantastic Four #414'
    || row.sourceIssueReference === 'Avengers #400' || row.sourceIssueReference === 'X-Men Timelines'));
});

test('Onslaught approved full-library report preserves all 200 peers at its publication', async () => {
  const manifest = await readJson('src/data/curated-lists.json');
  const existing = manifest.lists.filter((entry) =>
    entry.id !== id && entry.id !== 'namor-sub-mariner-reading-order'
      && entry.id !== 'iron-fist-reading-order' && entry.id !== 'mcu-prep-eternals' && entry.id !== 'mcu-prep-thunderbolts');
  assert.equal(existing.length, 200);
  const existingManifest = {
    ...manifest,
    lists: existing,
    ...(Array.isArray(manifest.paths)
      ? { paths: manifest.paths.filter((entry) =>
        entry.id !== id && !entry.steps?.includes(id)) }
      : {}),
  };
  const orderIssueIds = await Promise.all(existing.map(async (entry) => ({
    id: entry.id,
    issueIds: issueIdsFromValue(await readJson(`src/data/${entry.out}`)).map(String),
  })));
  const libraryDigest = libraryDigestFor(existingManifest, orderIssueIds);
  assert.equal(libraryDigest, '473bfe1e3e3247395973c2464b01fcbfafc858ed656417baf5cdf44ea5174903');
  assert.equal(report.reportDigest, '1ef070ad35dfd5507f78515c7465f988f0a3ded82fd416a3990ba81734d9b7bf');
  const rebuilt = await buildReportForMapping(`scripts/data/cbh-mappings/${id}.json`, [],
    { excludedOrderIds: ['mcu-prep-thunderbolts', 'namor-sub-mariner-reading-order', 'iron-fist-reading-order', 'mcu-prep-eternals'] });
  assert.deepEqual(rebuilt, report);
  assert.equal(mapping.reviewStatus, 'approved');
  assert.deepEqual(mapping.approvedManifest, packet.proposedManifest);
  assert.equal(mapping.relationshipReview.approvalDigest,
    '9afcd9cf0ac10dc87ba9d0a6c9fa5a334f34d4be75b806b9950ff9ca73cbcda8');
  assert.equal(report.comparisonCount, 200);
  assert.deepEqual(report.comparisons.reduce((counts, row) => {
    counts[row.relationship] = (counts[row.relationship] ?? 0) + 1;
    return counts;
  }, {}), { none: 192, partial: 8 });
  assert.deepEqual(new Set(report.comparisons.map((row) => row.orderId)),
    new Set(existing.map((row) => row.id)));
  assert.equal(digestCanonicalJson(report.comparisons.filter((row) =>
    !['shang-chi-master-of-kung-fu-reading-order',
      'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order'].includes(row.orderId))),
  '555eb3cda94c6aa0db057feabe70e0e62df030d534559f6a3ad554c2048acd91');
  assert.deepEqual(report.comparisons.filter((row) =>
    ['shang-chi-master-of-kung-fu-reading-order',
      'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order'].includes(row.orderId)),
  [
    { orderId: 'shang-chi-master-of-kung-fu-reading-order', relationship: 'none',
      sharedCount: 0, sharedIds: [] },
    { orderId: 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order',
      relationship: 'partial', sharedCount: 1, sharedIds: ['12371'] },
  ]);
  assert.doesNotThrow(() => validateReportDigest(report));
  const approved = {
    packet, mapping, report, currentLibraryDigest: libraryDigest,
    expectedOrderIds: existing.map((row) => row.id),
  };
  assert.doesNotThrow(() => assertApprovedRelationshipReview(approved));
  const pending = { ...mapping, reviewStatus: 'pending-independent-review' };
  delete pending.packetReview;
  delete pending.approvedManifest;
  delete pending.relationshipReview;
  assert.throws(() => assertApprovedRelationshipReview({
    ...approved, mapping: pending,
  }), /pending|approved|review/i);
});

test('Onslaught authoring preserves all 74 positions ahead of Operation: Zero Tolerance', async () => {
  const [markdown, manifest, inventory] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson('src/data/curated-lists.json'),
    readJson('scripts/data/cbh-character-inventory.json'),
  ]);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 72);
  assert.equal(parsed.unresolved.length, 2);
  assert.deepEqual(parsed.entries.map((row) => row.issueId), originalIds);
  assert.deepEqual(parsed.unresolved.map((row) => row.sourceKey), ['24', '27']);
  const rowsByPosition = new Map([...mapping.rows, ...mapping.sourceGaps]
    .map((row) => [row.sourcePosition, row]));
  const all = [...parsed.entries, ...parsed.unresolved]
    .sort((left, right) => left.index - right.index);
  assert.deepEqual(all.map((row) => Number(row.sourceKey)), sourcePositions);
  for (const row of all) {
    const source = rowsByPosition.get(Number(row.sourceKey));
    assert.equal(row.section, source.sourceRangeReference ?? source.sourceGroup);
    if (source.selectedIssueId == null) {
      assert.equal(row.title, source.sourceIssueReference);
    } else {
      assert.equal(row.issueId, source.selectedIssueId);
      assert.equal(row.url, source.marvelIssueUrl);
    }
  }
  assert.deepEqual(parseManifest(manifest).errors, []);
  assert.equal(manifest.lists.length, 205);
  const position = manifest.lists.findIndex((entry) => entry.id === id);
  assert.equal(manifest.lists[position + 1].id, 'operation-zero-tolerance');
  assert.deepEqual(manifest.lists[position], packet.proposedManifest);
  assert.deepEqual(mapping.proposedManifest, packet.proposedManifest);
  assert.equal(manifest.lists[position].spotlightKind, undefined);
  assert.equal(manifest.lists[position].coverIssueId, 20767);
  assert.equal(manifest.lists[position].timeline, 1996);
  assert.equal(manifest.lists[position].depth, 'partial');
  assert.equal(manifest.lists[position].type, 'event');
  assert.doesNotThrow(() => validateInventoryState(inventory));
  const record = inventory.find((entry) => entry.id === id);
  assert.deepEqual([record.position, record.guideType, record.deliveryStatus, record.catalogIds],
    [127, 'event', 'shipped', [id]]);
  assert.equal(record.centralDisposition, 'pilot-approved');
  assert.equal(record.disposition, 'new-order');
  assert.match(record.reason, /72 exact original comics and 2 explicit unresolved identity gaps/);
  assert.deepEqual(record.overlapIds, report.comparisons.filter((row) =>
    row.relationship !== 'none')
    .map((row) => row.orderId));
});

test('Onslaught publishes 72 exact original identities and two ordered unresolved placeholders', async () => {
  const [payload, catalogRaw] = await Promise.all([
    readJson(`src/data/${packet.proposedManifest.out}`),
    readJson('src/data/catalog.json'),
  ]);
  const expected = [...mapping.rows, ...mapping.sourceGaps]
    .sort((left, right) => left.sourcePosition - right.sourcePosition);
  assert.equal(payload.items.length, 74);
  assert.equal(payload.count, 74);
  assert.equal(payload.placeholders, 2);
  assert.equal(payload.unresolved.length, 2);
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, 74);
  assert.deepEqual(payload.items.filter((item) => !item.placeholder).map((item) => item.issueId),
    originalIds);
  expected.forEach((row, index) => {
    const item = payload.items[index];
    assert.equal(item.collectedIn, row.sourceGroup, `source position ${row.sourcePosition}`);
    assert.equal(item.description, null);
    if (row.selectedIssueId != null) {
      assert.equal(item.issueId, row.selectedIssueId);
      assert.equal(item.title, row.resolvedIssueTitle);
      assert.equal(item.number, row.issueNumber);
      assert.equal(item.seriesId, row.seriesId);
      assert.equal(item.placeholder, undefined);
    } else {
      assert.equal(item.placeholder, true);
      assert.ok(item.issueId < 0);
      assert.equal(item.title, row.sourceIssueReference);
      assert.equal(item.digitalId, null);
    }
  });
  assert.equal(payload.items[23].title, 'X-Men Hotshots');
  assert.equal(payload.items[23].issueId, placeholderId(id, 'X-Men Hotshots', '24'));
  assert.equal(payload.items[26].title, 'Archangel #1');
  assert.equal(payload.items[26].issueId, placeholderId(id, 'Archangel #1', '27'));
  assert.equal(payload.items[36].issueId, 52990);
  assert.equal(payload.items[40].issueId, 20767);
  assert.equal(payload.items[49].issueId, 51043);
  assert.equal(payload.items[68].issueId, 10453);
  assert.equal(payload.items[72].issueId, 23388);
  assert.equal(payload.items[73].issueId, 16337);
  const catalog = parseCatalog(catalogRaw);
  assert.equal(catalog.lists.length, 282);
  const card = catalog.lists.find((row) => row.id === id);
  assert.equal(card.count, 74);
  assert.equal(card.placeholderCount, 2);
  assert.equal(card.coverIssueId, 20767);
  assert.deepEqual(card.cover, payload.items[40].cover);
  assert.equal(card.source, sourceUrl);
  assert.equal(card.type, 'event');
  assert.equal(card.depth, 'partial');
  assert.equal(card.timeline, 1996);
  assert.equal(card.spotlightKind, null);
  assert.equal(shelfKey({ lists: [card] }), 'catalog');
  for (const term of ['Onslaught', 'Road to Onslaught', 'X-Men']) {
    assert.ok(searchCatalog(catalog.lists, term).some((row) => row.id === id));
  }
});
