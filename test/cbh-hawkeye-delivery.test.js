import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertApprovedRelationshipReview,
  buildMarkdown,
} from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences,
  libraryDigestFor,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport, issueIdsFromValue } from '../scripts/lib/cbh-overlap.mjs';
import {
  addIssuesToList,
  createEmptyState,
  createList,
  deleteList,
  isRead,
  markRead,
} from '../src/js/lib/model.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  historicalReadingChoiceManifest,
  historicalReadingChoiceIssueIds,
} from './helpers/reading-choice-history.mjs';

const id = 'hawkeye-reading-order';
const mappingFile = `scripts/data/cbh-mappings/${id}.json`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [packet, mapping, report, inventory, manifest] = await Promise.all([
  readJson(`scripts/data/cbh-packets/${id}.json`),
  readJson(mappingFile),
  readJson(`scripts/data/cbh-overlaps/${id}.json`),
  readJson('scripts/data/cbh-character-inventory.json'),
  readJson('src/data/curated-lists.json'),
]);

test('Hawkeye factual source ledger reproduces both retained issue-bearing projections', async () => {
  const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
  const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
  const issueBearing = ledger.issueBearingBlocks.map((block) => [
    block.tag,
    block.text,
    block.links.map((link) => `${link.label} ${link.href}`).join(' | '),
  ].join('\t')).join('\n');
  assert.equal(ledger.sourceHashes.normalizedRenderedContentSha256, packet.sourceContentSha256);
  assert.equal(ledger.sourceHashes.issueBearingBlocksSha256, packet.sourceIssueBearingBlocksSha256);
  assert.equal(ledger.sourceHashes.contentDefinition,
    'Rendered article innerText; CRLF -> LF; whitespace runs collapsed on each line; blank lines removed; UTF-8 SHA-256.');
  assert.equal(ledger.sourceHashes.issueBearingDefinition,
    'Article h1-h4, paragraphs beginning Collects:, each immediately preceding collection-title paragraph, the title-only Heroes Reborn recommendation, and the three numbered Fraction publication-order lines; tag TAB collapsed rendered text TAB link label plus origin/path (queries removed) in DOM order, joined LF without trailing LF; UTF-8 SHA-256.');
  assert.equal(ledger.issueBearingBlocks.length, 170);
  assert.equal(sha256(issueBearing), '28dc8a9ce300762ff35cb493b0d9ac019ad3b6440e1b238e985c4edbaf91226e');
  const blocks = new Map(ledger.issueBearingBlocks.map((block) => [block.sourceBlock, block]));
  assert.equal(blocks.size, 170);
  assert.equal(ledger.sourceGroups.length, 80);
  for (const group of ledger.sourceGroups) {
    const block = blocks.get(group.sourceBlock);
    assert.ok(block, `missing source block ${group.sourceBlock}`);
    if (Array.isArray(group.sourceReference)) {
      assert.deepEqual(group.sourceReference.map((_, index) =>
        blocks.get(group.sourceBlock + index)?.text), group.sourceReference);
    } else {
      assert.equal(block.text, group.sourceReference);
    }
    if (group.collectionOrdinal) assert.equal(blocks.get(group.sourceBlock - 1)?.text, group.title);
  }
  const collectionBlocks = ledger.sourceGroups.filter((group) => group.collectionOrdinal);
  const retainedParagraphs = new Set([
    ...collectionBlocks.flatMap((group) => [group.sourceBlock - 1, group.sourceBlock]),
    ...ledger.sourceGroups.filter((group) => group.kind === 'source-directed-order')
      .flatMap((group) => group.sourceReference.map((_, index) => group.sourceBlock + index)),
    ...ledger.sourceGroups.filter((group) => group.kind === 'title-only-one-shot')
      .map((group) => group.sourceBlock),
  ]);
  assert.equal(collectionBlocks.length, 78);
  assert.equal(ledger.selectedGroupCount, ledger.sourceGroups.filter((group) =>
    group.selectionOrdinal).length);
  assert.deepEqual(ledger.issueBearingBlocks.filter((block) => block.tag === 'p')
    .map((block) => block.sourceBlock).sort((a, b) => a - b),
  [...retainedParagraphs].sort((a, b) => a - b));
  assert.equal(ledger.sections.length, 9);
  assert.deepEqual(ledger.sectionCounts.map((row) => row.section), ledger.sections);
  assert.deepEqual(ledger.sectionCounts.map((row) => row.occurrences),
    [153, 121, 47, 43, 53, 59, 88, 36, 71]);
  assert.deepEqual(ledger.sectionCounts.map((row) => row.occurrences),
    ledger.sections.map((section) => ledger.occurrences.filter((row) =>
      row.sourceSection === section).length));
  assert.deepEqual(ledger.excludedSourceReferences.map((row) =>
    `${row.reference}: ${row.reason}`), packet.excludedSourceReferences);
  assert.deepEqual(ledger.selectedTitleOnlyReferences.map((row) => row.selectedOccurrences),
    [1, 5]);
  assert.ok(!JSON.stringify(ledger).includes('C:\\Users\\'));
});

test('Hawkeye ledger retains every source position, disposition, original and observed refusal', async () => {
  const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
  const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
  const fields = [
    'sourcePosition', 'sourceBlock', 'normalizedSeriesTitle', 'proposedSeriesYear',
    'proposedIssueNumber', 'disposition', 'canonicalSourcePosition',
  ];
  const projection = ledger.occurrences.map((row) => fields.map((field) =>
    row[field] == null ? '' : String(row[field])).join('\t')).join('\n');
  assert.equal(ledger.factualProjectionDefinition,
    'UTF-8, one selected occurrence per LF-terminated line with tab fields sourcePosition, sourceBlock, normalizedSeriesTitle, proposedSeriesYear, proposedIssueNumber, disposition, canonicalSourcePosition; no trailing LF; SHA-256. Proposed years/identities are not provider-approved.');
  assert.equal(sha256(projection), 'add87807c85b105e85f00c6a817ee1a4b58412cd7553cf9a36dabe62101d50bd');
  assert.equal(ledger.factualProjectionSha256, sha256(projection));
  assert.equal(ledger.occurrenceCount, 671);
  assert.equal(ledger.distinctProposedIdentityCount, 663);
  assert.equal(ledger.repeatCount, 8);
  assert.deepEqual([...new Set(ledger.occurrences.map((row) => row.sourceSection))],
    ledger.sections);
  const byPosition = new Map(ledger.occurrences.map((row) => [row.sourcePosition, row]));
  assert.equal(byPosition.size, 671);
  for (let position = 1; position <= 671; position++) assert.ok(byPosition.has(position));
  const selected = ledger.occurrences.filter((row) => row.disposition !== 'backward-repeat');
  assert.deepEqual(selected.map((row) => row.sourcePosition), [
    ...mapping.rows.map((row) => row.sourcePosition),
    ...mapping.sourceGaps.map((row) => row.sourcePosition),
  ].sort((a, b) => a - b));
  for (const row of [...mapping.rows, ...mapping.sourceGaps]) {
    const source = byPosition.get(row.sourcePosition);
    assert.deepEqual([source.sourceIssueReference, source.sourceRangeReference],
      [row.sourceIssueReference, row.sourceRangeReference]);
    const group = ledger.sourceGroups.find((candidate) =>
      candidate.sourceBlock === source.sourceBlock);
    assert.equal(source.sourceRangeReference,
      Array.isArray(group?.sourceReference)
        ? group.sourceReference.join(' | ')
        : group?.sourceReference);
  }
  assert.deepEqual(ledger.repeatedSourceReferences.map((row) => [
    row.sourcePosition, row.canonicalSourcePosition,
  ]), mapping.repeatedSourceReferences.map((row) => [
    row.sourcePosition, mapping.rows[row.canonicalRow - 1].sourcePosition,
  ]));
  assert.deepEqual(ledger.repeatedSourceReferences,
    ledger.occurrences.filter((row) => row.disposition === 'backward-repeat'));
  for (const repeat of mapping.repeatedSourceReferences) {
    const source = byPosition.get(repeat.sourcePosition);
    assert.deepEqual([source.sourceIssueReference, source.sourceRangeReference],
      [repeat.sourceIssueReference, repeat.sourceRangeReference]);
  }
  assert.deepEqual(ledger.sourceGapReview, mapping.sourceGaps);
  const corrections = mapping.rows.filter((row) => {
    const source = byPosition.get(row.sourcePosition);
    return source.normalizedSeriesTitle !== row.normalizedSeriesTitle
      || Number(source.proposedSeriesYear) !== row.seriesYear;
  }).map((row) => ({
    sourcePosition: row.sourcePosition,
    sourceSeriesTitle: byPosition.get(row.sourcePosition).normalizedSeriesTitle,
    proposedSeriesYear: Number(byPosition.get(row.sourcePosition).proposedSeriesYear),
    originalSeriesTitle: row.normalizedSeriesTitle,
    originalSeriesYear: row.seriesYear,
    originalSeriesId: row.seriesId,
    originalIssueId: row.selectedIssueId,
    detailUrl: row.marvelIssueUrl,
    mappingNote: row.note,
  }));
  assert.deepEqual(ledger.originalVolumeResolutions, corrections);
  assert.equal(corrections.length, 52);
  assert.deepEqual(ledger.exactDetailRefusals.map((row) => row.issueId),
    [56327, 55231, 55232, 55233, 55234, 55236]);
  for (const refusal of ledger.exactDetailRefusals) {
    const original = mapping.rows.find((row) => row.selectedIssueId === refusal.issueId);
    assert.equal(refusal.sourcePosition, original.sourcePosition);
    assert.equal(refusal.detailUrl, original.marvelIssueUrl);
    assert.equal(refusal.record.url, `https://marvel.emreparker.com/v1/issues/${refusal.issueId}`);
    assert.equal(refusal.record.urlSha256, sha256(refusal.record.url));
    assert.equal(refusal.record.status, 404);
    assert.equal(refusal.record.error, `404 ${refusal.record.url}`);
    assert.ok(Number.isFinite(Date.parse(refusal.record.fetchedAt)));
    assert.ok(!Object.hasOwn(refusal.record, 'body'));
    assert.ok(!Object.hasOwn(refusal.record, 'bodySha256'));
  }
});

test('Hawkeye keeps all 671 source positions as 662 exact, one open gap and eight later repeats', () => {
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.equal(packet.sourceOccurrenceCount, 671);
  assert.equal(packet.expectedCount, 662);
  assert.equal(mapping.rows.length, 662);
  assert.equal(new Set(mapping.rows.map((row) => row.selectedIssueId)).size, 662);
  assert.deepEqual(packet.repeatedSourceReferences.map((row) => row.sourcePosition),
    [158, 418, 419, 420, 421, 422, 423, 638]);
  assert.deepEqual(mapping.sourceGaps.map((row) => [
    row.sourcePosition, row.sourceIssueReference, row.status,
  ]), [[159, 'Marvel Super Action #1', 'open']]);
  const positions = [
    ...mapping.rows.map((row) => row.sourcePosition),
    ...mapping.sourceGaps.map((row) => row.sourcePosition),
    ...mapping.repeatedSourceReferences.map((row) => row.sourcePosition),
  ].sort((a, b) => a - b);
  assert.deepEqual(positions, Array.from({ length: 671 }, (_, index) => index + 1));
  for (const repeat of packet.repeatedSourceReferences) {
    const original = mapping.rows[repeat.canonicalRow - 1];
    assert.ok(original.sourcePosition < repeat.sourcePosition);
    assert.deepEqual(
      [repeat.normalizedSeriesTitle, repeat.seriesYear, repeat.issueNumber],
      [original.normalizedSeriesTitle, original.seriesYear, original.issueNumber],
    );
  }
  assert.ok(!positions.includes(672));
  assert.ok(mapping.rows.some((row) => row.sourcePosition === 186
    && row.selectedIssueId === 56327 && row.seriesId === null));
  assert.ok(mapping.candidateMetadata.some((candidate) => candidate.id === 56327
    && candidate.detailsRefused === true));
});

test('Hawkeye preserves interleaves, source collection order and original relaunch volumes', () => {
  const rows = mapping.rows;
  const slice = (from, to) => rows.filter((row) => row.sourcePosition >= from
    && row.sourcePosition <= to);
  assert.deepEqual(slice(1, 34).map((row) => row.issueNumber),
    Array.from({ length: 34 }, (_, index) => String(index + 39)));
  assert.deepEqual(slice(104, 115).map((row) => row.sourceIssueReference),
    [...Array.from({ length: 10 }, (_, index) => `Avengers #${101 + index}`),
      'Daredevil #99', 'Avengers #111']);
  assert.deepEqual(slice(220, 224).map((row) => row.issueNumber),
    ['60', '61', '62', '58', '59']);
  assert.deepEqual(slice(478, 500).map((row) => row.sourceIssueReference),
    [
      ...Array.from({ length: 13 }, (_, index) => `Hawkeye #${index + 1}`),
      'Hawkeye Annual #1',
      ...Array.from({ length: 9 }, (_, index) => `Hawkeye #${index + 14}`),
    ]);
  assert.deepEqual(slice(549, 559).map((row) => row.seriesId),
    [...Array(5).fill(19255), ...Array(6).fill(20468)]);
  assert.deepEqual(slice(576, 583).map((row) => row.issueNumber),
    Array.from({ length: 8 }, (_, index) => String(index)));
  assert.deepEqual(slice(668, 671).map((row) => [row.seriesId, row.issueNumber]),
    [[37725, '1'], [37725, '2'], [37725, '3'], [37725, '4']]);
  assert.deepEqual(slice(446, 449).map((row) => row.seriesId), Array(4).fill(16325));
  assert.deepEqual(slice(446, 449).map((row) => row.sourceIssueReference),
    [629, 630, 631, 632].map((number) => `Captain America and Hawkeye #${number}`));
  assert.deepEqual(slice(537, 538).map((row) => row.seriesId), [19032, 19032]);
  assert.ok(rows.some((row) => row.issueNumber === '21.1' && row.seriesId === 9799));
  assert.ok(!rows.some((row) => row.sourcePosition === 159));
});

test('Hawkeye has a complete approved current-library relationship and shipped inventory lifecycle', async () => {
  const existing = historicalReadingChoiceManifest(manifest).lists.filter((entry) =>
    entry.id !== id && entry.id !== 'marvel-zombies-reading-order'
    && entry.id !== 'shang-chi-master-of-kung-fu-reading-order'
    && entry.id !== 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order' && entry.id !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order'
    && entry.id !== 'ms-marvel-kamala-khan-reading-order'
    && entry.id !== 'nova-reading-order' && entry.id !== 'ultimate-spider-man-reading-order' && entry.id !== 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide'
    && entry.id !== 'namor-sub-mariner-reading-order' && entry.id !== 'iron-fist-reading-order' && entry.id !== 'mcu-prep-shang-chi-and-the-legend-of-the-ten-rings' && entry.id !== 'mcu-prep-daredevil-born-again' && entry.id !== 'mcu-prep-moon-knight' && entry.id !== 'mcu-prep-deadpool-and-wolverine' && entry.id !== 'mcu-prep-eternals' && entry.id !== 'mcu-prep-fantastic-four-first-steps' && entry.id !== 'mcu-prep-spider-man-brand-new-day' && entry.id !== 'mcu-prep-she-hulk' && entry.id !== 'mcu-prep-ms-marvel' && entry.id !== 'mcu-prep-captain-america-brave-new-world' && entry.id !== 'spider-man-no-way-home-owner-selected' && entry.id !== 'mcu-prep-thunderbolts');
  const orders = await Promise.all(existing.map(async (entry) => ({
    orderId: entry.id,
    issueIds: historicalReadingChoiceIssueIds(entry.id, issueIdsFromValue(await readJson(`src/data/${entry.out}`))),
  })));
  const libraryDigest = libraryDigestFor({ ...manifest, lists: existing },
    orders.map((order) => ({
      id: order.orderId,
      issueIds: order.issueIds.map(String),
    })));
  const comparisons = buildComparisonReport({
    candidateIds: mapping.rows.map((row) => String(row.selectedIssueId)),
    orders,
    peerOrders: [],
  });
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.deepEqual(comparisons, {
    candidateCount: report.candidateCount,
    comparisonCount: report.comparisonCount,
    comparisons: report.comparisons,
  });
  assert.equal(libraryDigest, report.libraryDigest);
  assert.equal(report.comparisonCount, 192);
  assert.deepEqual(report.comparisons.reduce((counts, row) => {
    counts[row.relationship] = (counts[row.relationship] ?? 0) + 1;
    return counts;
  }, {}), { none: 129, partial: 58, 'existing-subset': 5 });
  const expectedOrderIds = existing.map((entry) => entry.id);
  assert.deepEqual(report.comparisons.map((row) => row.orderId).sort(),
    expectedOrderIds.sort());
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: libraryDigest, expectedOrderIds,
  }));
  assert.equal(mapping.relationshipReview.approvalDigest,
    'fabada8e6b33368d1947316aff88037de173fd55ffc472014ef2d25468102068');
  assert.deepEqual(report.comparisons.find((row) =>
    row.orderId === 'marvels-infinity-saga-gauntlet-wars-crusade-reading-order'), {
    orderId: 'marvels-infinity-saga-gauntlet-wars-crusade-reading-order',
    sharedCount: 2,
    sharedIds: ['17838', '17839'],
    relationship: 'partial',
  });
  assert.deepEqual(report.comparisons.find((row) =>
    row.orderId === 'silk-cindy-moon-reading-order'), {
    orderId: 'silk-cindy-moon-reading-order',
    sharedCount: 0,
    sharedIds: [],
    relationship: 'none',
  });
  const x23 = report.comparisons.find((row) => row.orderId === 'x-23-reading-order');
  assert.equal(x23.relationship, 'partial');
  assert.equal(x23.sharedCount, 14);
  assert.deepEqual(x23.sharedIds, [
    '36489', '36485', '36488', '36486', '40255', '40249', '40248', '40252',
    '61282', '61283', '61284', '61285', '61286', '61287',
  ]);
  const reviewedPeers = report.comparisons
    .filter((row) => row.relationship !== 'none')
    .map((row) => row.orderId).sort();
  const item = inventory.find((entry) => entry.position === 44);
  assert.equal(item.id, id);
  assert.deepEqual(item.overlapIds, reviewedPeers);
  assert.equal(item.sourceRetrievedAt, packet.sourceRetrievedAt);
  assert.equal(item.sourceContentSha256, packet.sourceContentSha256);
  assert.equal(item.centralDisposition, 'pilot-approved');
  assert.equal(item.disposition, 'new-order');
  assert.equal(item.deliveryStatus, 'shipped');
  assert.deepEqual(item.catalogIds, [id]);
  const published = manifest.lists.find((entry) => entry.id === id);
  assert.equal(published.expect, 663);
  assert.equal(published.coverIssueId, 42768);
  assert.equal(published.depth, 'partial');
  assert.equal(published.spotlightKind, 'other');
  assert.equal(manifest.lists[manifest.lists.indexOf(published) - 1].id, 'nebula-reading-order');
});

test('Hawkeye checklist retains the exact approved positions without duplicating repeats', async () => {
  const markdown = await readFile(`src/data/orders/${id}.md`, 'utf8');
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 662);
  assert.equal(parsed.unresolved.length, 1);
  assert.deepEqual(parsed.entries.map((row) => Number(row.sourceKey)),
    mapping.rows.map((row) => row.sourcePosition));
  assert.deepEqual(parsed.entries.map((row) => Number(row.issueId)),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.equal(Number(parsed.unresolved[0].sourceKey), 159);
});

test('Hawkeye pinned payload keeps one gap, six observed refusals and the approved cover', async () => {
  const [payload, catalog] = await Promise.all([
    readJson('src/data/hawkeye_reading_order.json'),
    readJson('src/data/catalog.json'),
  ]);
  const pinned = payload.items.filter((item) => !item.placeholder);
  const gap = payload.items.filter((item) => item.placeholder);
  const refusedIds = [56327, 55231, 55232, 55233, 55234, 55236];
  assert.equal(payload.count, 663);
  assert.equal(payload.items.length, 663);
  assert.equal(payload.placeholders, 1);
  assert.deepEqual(payload.unresolved.map((entry) => [
    entry.sourceKey, entry.title,
  ]), [['159', 'Marvel Super Action #1']]);
  assert.equal(gap.length, 1);
  assert.ok(gap[0].issueId < 0);
  assert.equal(gap[0].title, 'Marvel Super Action #1');
  assert.deepEqual(pinned.map((item) => item.issueId),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.deepEqual(payload.items.filter((item) => item.detailsRefused)
    .map((item) => item.issueId), refusedIds);
  for (const issueId of refusedIds) {
    const item = pinned.find((entry) => entry.issueId === issueId);
    assert.equal(item.seriesId, null);
    assert.equal(item.cover, null);
    assert.equal(item.placeholder, undefined);
    assert.equal(item.url, mapping.rows.find((row) => row.selectedIssueId === issueId).marvelIssueUrl);
  }
  assert.ok(payload.items.every((item) => item.description === null));
  const card = catalog.lists.find((entry) => entry.id === id);
  assert.equal(card.count, 663);
  assert.equal(card.placeholderCount, 1);
  assert.equal(card.emptyRecordCount, 6);
  assert.equal(card.coverIssueId, 42768);
  assert.ok(card.cover?.path.startsWith('https://'));
  assert.equal(card.spotlightKind, 'other');
  assert.equal(card.depth, 'partial');
  assert.equal(card.source, packet.sourceUrl);
});

test('Hawkeye reimport preserves stable shared issue progress and one unresolved position', async () => {
  const payload = await readJson('src/data/hawkeye_reading_order.json');
  const knownIssue = payload.items.find((item) => item.issueId === 42768);
  const gap = payload.items.find((item) => item.placeholder);
  let state = createList(createEmptyState(), {
    id: 'prior-hawkeye', name: payload.name, catalogId: id,
  });
  state = addIssuesToList(state, 'prior-hawkeye',
    [knownIssue, gap].map((item) => ({ ...item, source: 'curated' }))).state;
  state = markRead(state, knownIssue.issueId, true, 1000);
  state = deleteList(state, 'prior-hawkeye');
  state = createList(state, {
    id: 'current-hawkeye', name: payload.name, catalogId: id,
  });
  const imported = addIssuesToList(state, 'current-hawkeye',
    payload.items.map((item) => ({ ...item, source: 'curated' })));
  state = imported.state;
  assert.equal(imported.added, 663);
  assert.deepEqual(state.lists['current-hawkeye'].itemIds,
    payload.items.map((item) => item.issueId));
  assert.equal(isRead(state, knownIssue.issueId), true);
  assert.equal(state.read[knownIssue.issueId], 1000);
  assert.ok(state.lists['current-hawkeye'].itemIds.includes(gap.issueId));
});
