import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import {
  digestCanonicalJson,
  sourceCountsForPacket,
  validateFrozenPacket,
  validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { resolveRow } from '../scripts/lib/cbh-resolution.mjs';
import { buildEternalsOverlap, OWNER_SOURCE_PROVIDER } from '../scripts/report-eternals-overlap.mjs';
import { HOME_CATEGORIES, groupCatalog, parseCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'mcu-prep-eternals';
const sourceUrl = 'https://github.com/raymond-nassar/recap-page/issues/684';
const approvalUrl = `${sourceUrl}#issuecomment-5971795544`;
const groups = [
  'Eternals by Jack Kirby Vol. 1',
  'Eternals by Neil Gaiman and John Romita Jr.',
  'Eternals Vol. 1: Only Death Is Eternal',
];
const vectors = [
  [8799, 8810, 8811, 8812, 8813, 8814, 8815, 8816, 8817, 8800, 8801],
  [4311, 4466, 4785, 5073, 5226, 5523, 5894],
  [85560, 85561, 85562, 85563, 85564, 85565],
];
const issueIds = vectors.flat();
const groupVector = vectors.flatMap((vector, index) => vector.map(() => groups[index]));
const readJson = async (relativePath) => JSON.parse(
  await readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8'),
);

async function evidence() {
  const [ledger, packet, mapping, report] = await Promise.all([
    'selections', 'packet', 'mapping', 'overlap',
  ].map((kind) => readJson(`scripts/data/owner-mcu-prep/eternals-${kind}.json`)));
  return { ledger, packet, mapping, report };
}

test('Eternals preserves three owner positions and exact 11/7/6 original boundaries', async () => {
  const { ledger, packet, mapping } = await evidence();
  assert.equal(ledger.owner, 'raymond-nassar');
  assert.equal(ledger.sourceUrl, sourceUrl);
  assert.equal(ledger.selectionCount, 3);
  assert.deepEqual(ledger.sourceSelections.map((selection) => selection.position), [1, 2, 3]);
  assert.deepEqual(ledger.sourceSelections.map((selection) => selection.collectionTitle), groups);
  assert.deepEqual(ledger.sourceSelections.map((selection) => selection.originalIssueIds), vectors);
  assert.deepEqual(ledger.sourceSelections.map((selection) => [selection.seriesYear, selection.seriesId]),
    [[1976, 2017], [2006, 1058], [2021, 30146]]);
  assert.deepEqual(ledger.sourceSelections.map((selection) => selection.issueNumbers),
    [11, 7, 6].map((count) => Array.from({ length: count }, (_, index) => String(index + 1))));
  assert.deepEqual(ledger.sourceSelections.flatMap((selection) => selection.expandedSourcePositions),
    Array.from({ length: 24 }, (_, index) => index + 1));
  assert.deepEqual(ledger.sourceSelections.map((selection) => selection.creators),
    [['Jack Kirby'], ['Neil Gaiman', 'John Romita Jr.'], ['Kieron Gillen', 'Esad Ribic']]);
  const corrected = ledger.sourceSelections[2];
  assert.equal(corrected.suppliedTitle, 'Eternals by Kieron Gillen Vol. 1: To Die Is Glorious');
  assert.equal(corrected.edition.isbn, '9781302925475');
  assert.equal(corrected.approvedCorrection.approvedSubtitle, 'Only Death Is Eternal');
  assert.equal(corrected.approvedCorrection.decisionUrl, `${sourceUrl}#issuecomment-5971757650`);
  for (const selection of ledger.sourceSelections) {
    assert.ok(selection.edition.evidence.length > 0);
    assert.ok(selection.edition.evidence.every((receipt) =>
      receipt.url.startsWith('https:') && receipt.retrievedAt === '2026-10-03' && receipt.basis));
  }

  assert.doesNotThrow(() => validateFrozenPacket(packet, { provider: OWNER_SOURCE_PROVIDER }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.equal(packet.sourceReview.selectionLedgerDigest, digestCanonicalJson(ledger));
  assert.equal(packet.sourceReview.authorityType, 'human');
  assert.equal(packet.sourceReview.authorityIdentity, ledger.owner);
  assert.equal(packet.sourceReview.decisionUrl, approvalUrl);
  assert.equal(mapping.packetDigest, packet.packetDigest);
  assert.equal(packet.expectedCount, 24);
  assert.deepEqual(packet.rows.map((row) => row.candidateIssueId), issueIds);
  assert.deepEqual(packet.rows.map((row) => row.selectionPosition),
    vectors.flatMap((vector, index) => vector.map(() => index + 1)));
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), issueIds);
  for (const row of mapping.rows) {
    assert.equal(row.resolutionStatus, 'exact');
    assert.equal(resolveRow(row, mapping.candidateMetadata).selectedIssueId,
      String(row.selectedIssueId));
    const candidate = mapping.candidateMetadata.find((item) => item.id === row.selectedIssueId);
    assert.equal(candidate.issueTitle, row.sourceIssueReference);
    assert.equal(candidate.seriesId, row.seriesId);
    assert.equal(candidate.seriesYear, row.seriesYear);
    assert.equal(candidate.issueNumber, row.issueNumber);
    assert.equal(candidate.metadataUrl, `https://marvel.emreparker.com/v1/issues/${row.selectedIssueId}`);
    assert.match(row.marvelIssueUrl, new RegExp(`/issue/${row.selectedIssueId}/`));
  }
});

test('Eternals publishes all 24 originals once, grouped, with no hidden metadata gaps', async () => {
  const { ledger, packet } = await evidence();
  const [payload, rawCatalog, markdown] = await Promise.all([
    readJson('src/data/mcu_prep_eternals.json'),
    readJson('src/data/catalog.json'),
    readFile(new URL('../src/data/orders/mcu-prep-eternals.md', import.meta.url), 'utf8'),
  ]);
  const parsed = parseChecklist(markdown);
  assert.deepEqual(parsed.entries.map((row) => row.issueId), issueIds);
  assert.deepEqual(parsed.entries.map((row) => row.section), groupVector);
  assert.deepEqual(parsed.unresolved, []);
  assert.deepEqual(payload.items.map((row) => row.issueId), issueIds);
  assert.equal(new Set(payload.items.map((row) => row.issueId)).size, 24);
  assert.deepEqual(payload.items.map((row) => row.collectedIn), groupVector);
  assert.equal(payload.count, 24);
  assert.equal(payload.collections, 3);
  assert.equal(payload.placeholders, 0);
  assert.deepEqual(payload.unresolved, []);
  assert.deepEqual(ledger.metadataGaps, []);
  assert.deepEqual(sourceCountsForPacket(packet), {
    sourceOccurrenceCount: 24, sourceIdentityCount: 24, includedIssueCount: 24,
    sourceGapCount: 0, repeatedSourceReferenceCount: 0,
  });
  const card = rawCatalog.lists.find((entry) => entry.id === id);
  assert.equal(card.count, 24);
  assert.equal(card.collections, 3);
  assert.equal(card.placeholderCount, 0);
  assert.equal(card.emptyRecordCount, 0);
  assert.equal(card.coverIssueId, 8799);
  assert.deepEqual(card.cover, payload.items[0].cover);
  assert.ok(payload.items.every((row) =>
    row.seriesId > 0 && row.digitalId > 0 && row.cover?.path.startsWith('https://')
    && !row.detailsRefused && row.description === null));
});

test('Eternals uses the existing owner-attributed MCU Prep gateway and Storylines shelf', async () => {
  const { packet } = await evidence();
  const [manifest, rawCatalog] = await Promise.all([
    readJson('src/data/curated-lists.json'), readJson('src/data/catalog.json'),
  ]);
  const entry = manifest.lists.find((item) => item.id === id);
  assert.deepEqual(entry, packet.proposedManifest);
  const catalog = parseCatalog(rawCatalog);
  const card = rawCatalog.lists.find((item) => item.id === id);
  for (const item of [entry, card]) {
    assert.equal(item.type, 'screen-companion');
    assert.equal(item.depth, 'selected');
    assert.equal(item.timeline, null);
    assert.equal(item.beginner, false);
    assert.equal(Object.hasOwn(item, 'spotlightKind'), false);
    assert.equal(item.sourceOrigin, 'Compiled for this project');
    assert.equal(item.sourceLicense, null);
    assert.doesNotMatch(item.description, /[\u2013\u2014]|closest in tone|alongside the film/i);
  }
  assert.equal(entry.sourcePage, sourceUrl);
  assert.equal(card.source, sourceUrl);
  const stories = groupCatalog(catalog.lists);
  const mcu = HOME_CATEGORIES.find((category) => category.key === 'marvel-on-screen');
  assert.equal(mcu.heading, 'MCU Prep');
  assert.equal(mcu.route, 'marvel-on-screen');
  const selected = mcu.select(stories).flatMap((story) => story.lists.map((list) => list.id));
  assert.deepEqual(selected, catalog.lists.filter((list) => list.type === 'screen-companion')
    .map((list) => list.id));
  assert.equal(selected.filter((selectedId) => selectedId === id).length, 1);
  const storylines = HOME_CATEGORIES.find((category) => category.key === 'storylines');
  const spotlights = HOME_CATEGORIES.find((category) => category.key === 'character-spotlights');
  assert.ok(storylines.select(stories).some((story) => story.lists.some((list) => list.id === id)));
  assert.ok(!spotlights.select(stories).some((story) => story.lists.some((list) => list.id === id)));
});

test('Eternals binds human Thanos-overlap approval to the complete source and visible-child library', async () => {
  const { packet, mapping, report } = await evidence();
  const [manifest, catalog, current] = await Promise.all([
    readJson('src/data/curated-lists.json'), readJson('src/data/catalog.json'),
    buildEternalsOverlap(mapping),
  ]);
  const expectedPeerIds = [...new Set([...manifest.lists, ...catalog.lists]
    .map((entry) => entry.id).filter((peerId) => peerId !== id))].sort();
  assert.deepEqual(report.comparisons.map((entry) => entry.orderId).sort(), expectedPeerIds);
  assert.equal(report.comparisonCount, expectedPeerIds.length);
  assert.deepEqual(current, report);
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report,
    currentLibraryDigest: current.libraryDigest,
    expectedOrderIds: expectedPeerIds,
    packetValidation: { provider: OWNER_SOURCE_PROVIDER },
  }));
  assert.deepEqual(report.comparisons.filter((entry) => entry.relationship !== 'none')
    .map(({ orderId, relationship, sharedIds }) => [orderId, relationship, sharedIds]),
  [['thanos-reading-order', 'partial', vectors[2].map(String)]]);
  const approval = mapping.relationshipReview.dispositions.find((entry) =>
    entry.orderId === 'thanos-reading-order');
  assert.equal(approval.authorityType, 'human');
  assert.equal(approval.authorityIdentity, 'raymond-nassar');
  assert.equal(approval.decisionUrl, approvalUrl);
  assert.deepEqual(approval.sharedIds, vectors[2].map(String));
});
