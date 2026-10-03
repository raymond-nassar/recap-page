import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences,
  sourceCountsForPacket,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseCatalog, searchCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { placeholderId } from '../scripts/lib/placeholder-id.mjs';

const id = 'nova-reading-order';
const mappingPath = `scripts/data/cbh-mappings/${id}.json`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [ledger, packet, mapping, report] = await Promise.all([
  readJson(`scripts/data/cbh-source-ledgers/${id}.json`),
  readJson(`scripts/data/cbh-packets/${id}.json`),
  readJson(mappingPath),
  readJson(`scripts/data/cbh-overlaps/${id}.json`),
]);
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');
const positions = (rows) => rows.map((row) => row.sourcePosition);
const allPositions = Array.from({ length: 404 }, (_, index) => index + 1);
const sourceTitleAliases = new Map([
  ...[13, ...Array.from({ length: 8 }, (_, index) => index + 97)]
    .map((position) => [position, 'The Amazing Spider-Man']),
  [86, 'X-Men Annual'],
  [106, 'Peter Parker, the Spectacular Spider-Man Annual'],
  [182, 'ANNIHILATION PROLOGUE 1'],
  [210, 'NOVA: ORIGIN OF RICHARD RIDER 1'],
  ...Array.from({ length: 7 }, (_, index) => [index + 225,
    index === 0 ? 'The Thanos Imperative: Ignition' : 'The Thanos Imperative']),
  [232, 'THE THANOS IMPERATIVE: DEVASTATION 1'],
  [330, 'Free Comic Book Day (All-New Guardians of the Galaxy)'],
  ...Array.from({ length: 5 }, (_, index) => [index + 349, 'All-New Guardians of the Galaxy']),
]);
const providerYearAliases = new Map([[232, 2010]]);
const gapPositions = [
  { sourcePosition: 141, canonicalPosition: 120, issueId: -1111446084, title: 'Nova (1994) #17' },
  { sourcePosition: 142, canonicalPosition: 121, issueId: -1061113227, title: 'Nova (1994) #18' },
];

function assertConserved(source) {
  assert.deepEqual([
    ...positions(source.rows),
    ...positions(source.sourceGaps),
    ...positions(source.repeatedSourceReferences),
    ...positions(source.excludedSourceRows),
  ].sort((left, right) => left - right), allPositions);
}

function assertLedgerPacketSelection(sourceLedger, sourcePacket) {
  const selected = new Map(sourceLedger.selectedOccurrences.map((row) => [row.sourcePosition, row]));
  const excluded = new Map(sourceLedger.excludedSourceRows.map((row) => [row.sourcePosition, row]));
  const packetSelected = [
    ...sourcePacket.rows, ...sourcePacket.sourceGaps, ...sourcePacket.repeatedSourceReferences,
  ];
  const packetByPosition = new Map(packetSelected.map((row) => [row.sourcePosition, row]));
  assert.equal(sourceLedger.orderedBlocks.length, 52);
  assert.equal(new Set(sourceLedger.orderedBlocks.map((block) => block.sourceBlock)).size, 52);
  assert.equal(selected.size, 401);
  assert.equal(packetByPosition.size, 401);
  assert.deepEqual([...packetByPosition.keys()].sort((a, b) => a - b), [...selected.keys()]);
  assert.deepEqual(
    sourceLedger.orderedBlocks.flatMap((block) =>
      [...block.selectedPositions, ...block.excludedPositions]).sort((a, b) => a - b),
    allPositions,
  );
  for (const block of sourceLedger.orderedBlocks) {
    const blockSelected = sourceLedger.selectedOccurrences
      .filter((row) => row.sourceBlock === block.sourceBlock);
    const blockExcluded = sourceLedger.excludedSourceRows
      .filter((row) => row.sourceBlock === block.sourceBlock);
    assert.deepEqual(positions(blockSelected), block.selectedPositions, `block ${block.sourceBlock} selection`);
    assert.deepEqual(positions(blockExcluded), block.excludedPositions, `block ${block.sourceBlock} exclusions`);
    for (const row of [...blockSelected, ...blockExcluded]) {
      assert.equal(row.sourceSection, block.section, `source ${row.sourcePosition} section`);
      assert.equal(row.sourceCollection, block.title, `source ${row.sourcePosition} collection`);
      assert.equal(row.sourceRangeReference, block.raw, `source ${row.sourcePosition} raw range`);
    }
  }
  for (const [position, source] of selected) {
    const row = packetByPosition.get(position);
    assert.ok(row, `source ${position} missing from packet`);
    if (row.sourceGroup !== undefined) {
      assert.equal(row.sourceGroup, source.sourceSection, `source ${position} group`);
    }
    assert.ok(row.sourceRangeReference.includes(source.sourceRangeReference.replace(/^Collects:\s*/, '')),
      `source ${position} raw range omitted`);
    assert.equal(row.normalizedSeriesTitle,
      sourceTitleAliases.get(position) ?? source.normalizedSeriesTitle, `source ${position} original series`);
    assert.equal(row.seriesYear,
      providerYearAliases.get(position) ?? source.seriesYear, `source ${position} original year`);
    assert.equal(row.issueNumber, source.issueNumber, `source ${position} issue number`);
  }
  for (const row of sourcePacket.excludedSourceRows) {
    const source = excluded.get(row.sourcePosition);
    assert.ok(source, `excluded source ${row.sourcePosition} missing from ledger`);
    assert.equal(source.status, 'closed');
    assert.equal(row.sourceIssueReference, source.sourceIssueReference);
    assert.equal(row.normalizedSeriesTitle, source.normalizedSeriesTitle);
    assert.equal(row.issueNumber, source.issueNumber);
  }
  const repeats = new Map(sourceLedger.repeatedSourceReferences
    .map((row) => [row.sourcePosition, row]));
  assert.equal(repeats.size, 30);
  for (const row of sourcePacket.repeatedSourceReferences) {
    const source = repeats.get(row.sourcePosition);
    assert.equal(sourcePacket.rows[row.canonicalRow - 1]?.sourcePosition,
      source?.canonicalSourcePosition,
      `source ${row.sourcePosition} repeat must point to its first canonical row`);
    assert.ok(source.canonicalSourcePosition < row.sourcePosition);
  }
  assert.deepEqual(sourceLedger.providerIdentityNotes.map((note) => note.sourceBlock), [22, 40]);
  assert.deepEqual([
    sourceLedger.selectedOccurrences.find((row) => row.sourcePosition === 232)?.seriesYear,
    sourcePacket.rows.find((row) => row.sourcePosition === 232)?.seriesYear,
    sourceLedger.providerIdentityNotes[0].originalProviderIssueId,
  ], [2011, 2010, 37979]);
  assert.deepEqual([
    sourcePacket.rows.find((row) => row.sourcePosition === 330)?.issueNumber,
    sourceLedger.providerIdentityNotes[1].originalProviderIssueNumber,
    sourceLedger.providerIdentityNotes[1].originalProviderIssueId,
  ], ['1', '0', 62818]);
}

function assertRawRuns(sourceLedger) {
  const selected = new Map(sourceLedger.selectedOccurrences.map((row) => [row.sourcePosition, row]));
  const run = (series, year, first, last) =>
    Array.from({ length: last - first + 1 }, (_, index) => [series, year, String(first + index)]);
  const checks = [
    [1, /Nova \(1976\) 1-12, Amazing Spider-Man \(1963\) 171/,
      [...run('Nova', 1976, 1, 12), ['Amazing Spider-Man', 1963, '171']], []],
    [3, /Fantastic Four \(1961\) #204-206, 208-21/,
      [...run('Nova', 1976, 20, 25), ...run('Fantastic Four', 1961, 204, 206),
        ...run('Fantastic Four', 1961, 208, 214)], []],
    [11, /#1 To #20/, run('Nova', 1994, 1, 18), [143, 144]],
    [12, /#43 To #60\+ \(Ending Of Series\)/, run('New Warriors', 1990, 43, 75), []],
    [40, /1-2, 4, 6, 8, 10, Free Comic Book Day 2017/,
      [...['1', '2', '4', '6', '8', '10'].map((number) =>
        ['All-New Guardians of the Galaxy', 2017, number]),
      ['Free Comic Book Day 2017 (All-New Guardians of the Galaxy)', 2017, '1']], []],
    [44, /Guardians Of The Galaxy \(2017\) 146-151/,
      run('Guardians of the Galaxy', 2017, 146, 150), [354]],
    [47, /Champions 22-2/, run('Champions', 2016, 22, 27), []],
    [52, /^X-Men Red #14$/, [['X-Men Red', 2022, '14']], []],
  ];
  for (const [number, raw, expected, excluded] of checks) {
    const block = sourceLedger.orderedBlocks.find((row) => row.sourceBlock === number);
    assert.match(block.raw, raw);
    assert.deepEqual(block.selectedPositions.map((position) => {
      const row = selected.get(position);
      return [row.normalizedSeriesTitle, row.seriesYear, row.issueNumber];
    }), expected, `source block ${number} raw run expansion`);
    assert.deepEqual(block.excludedPositions, excluded);
  }
  for (const number of [13, 14]) {
    const block = sourceLedger.orderedBlocks.find((row) => row.sourceBlock === number);
    assert.equal(block.raw, 'Collects:');
    assert.deepEqual(block.selectedPositions, []);
    assert.deepEqual(block.excludedPositions, []);
  }
}

test('Nova preserves the full source, all 404 positions and three closed corrections', () => {
  assert.equal(ledger.sourceContentSha256,
    'ff1a8e7fa60e6a579582bbcc753973b0b0a3451938f7be7e1dcdc5be7e89dc85');
  assert.equal(sha256(ledger.orderedBlocks.map(({ section, title, raw }) => (
    [section, title, raw].join(' | ')
  )).join('\n')), ledger.sourceIssueBearingBlocksSha256);
  assert.equal(ledger.sourceIssueBearingBlocksSha256,
    'b18e741deb340032e8f93023ea91a111a05c5a42999846895708e5bbd59d9bbb');
  assert.equal(sha256(JSON.stringify(ledger.selectedOccurrences.map(({
    normalizedSeriesTitle, seriesYear, issueNumber,
  }) => `${normalizedSeriesTitle.toLowerCase()}|${seriesYear}|${issueNumber}`))),
  ledger.selectedVectorFingerprint);
  assert.equal(ledger.selectedVectorFingerprint,
    '18da6e23158b22bf1737427c24ccb2a1ed94c4f278eb4ea24b7888da0d1f2eb6');
  assert.equal(ledger.selectedOccurrences.length, 401);
  assert.equal(ledger.counts.uniqueOriginalIdentities, 371);
  assert.deepEqual(ledger.orderedBlocks.find((block) => block.sourceBlock === 44)
    .excludedPositions, [354]);
  assert.match(ledger.orderedBlocks.find((block) => block.sourceBlock === 44).raw,
    /146-151/);
  assert.deepEqual([
    ...positions(ledger.selectedOccurrences), ...positions(ledger.excludedSourceRows),
  ].sort((left, right) => left - right), allPositions);
  assert.deepEqual(positions(ledger.excludedSourceRows), [143, 144, 354]);
  assert.deepEqual(positions(packet.sourceGaps), [141, 142]);
  assert.deepEqual(positions(packet.excludedSourceRows), [143, 144, 354]);
  assert.equal(packet.rows.length, 369);
  assert.equal(packet.repeatedSourceReferences.length, 30);
  assert.equal(packet.sourceOccurrenceCount, 404);
  assertConserved(packet);
  assertLedgerPacketSelection(ledger, packet);
  assertRawRuns(ledger);
  const alteredLedger = structuredClone(ledger);
  alteredLedger.selectedOccurrences.find((row) => row.sourcePosition === 232).issueNumber = '2';
  assert.throws(() => assertLedgerPacketSelection(alteredLedger, packet), assert.AssertionError);
  assert.throws(() => assertConserved({
    ...packet,
    excludedSourceRows: packet.excludedSourceRows.slice(0, -1),
  }), assert.AssertionError);
  assert.throws(() => assertConserved({
    ...packet,
    sourceGaps: packet.sourceGaps.slice(0, -1),
  }), assert.AssertionError);
  assert.deepEqual(sourceCountsForPacket(packet), {
    sourceOccurrenceCount: 404,
    sourceIdentityCount: 371,
    includedIssueCount: 369,
    sourceGapCount: 2,
    repeatedSourceReferenceCount: 30,
  });
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
});

test('Nova pins distinct original volumes and renders gaps without closed source errors', async () => {
  const markdown = await readFile(`src/data/orders/${id}.md`, 'utf8');
  const parsed = parseChecklist(markdown);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  assert.equal(parsed.entries.length, 369);
  assert.deepEqual(parsed.unresolved.map(({ title, sourceKey }) => [title, sourceKey]), [
    ['Nova (1994) #17', '141'],
    ['Nova (1994) #18', '142'],
  ]);
  assert.equal(parsed.entries[0].issueId, 23363);
  assert.equal(parsed.entries.at(-1).sourceKey, '404');
  assert.ok([...parsed.entries, ...parsed.unresolved]
    .every((row) => !['143', '144', '354'].includes(row.sourceKey)));
  assert.equal(new Set(mapping.rows.map((row) => row.selectedIssueId)).size, 369);
  assert.deepEqual(mapping.rows.filter((row) => row.normalizedSeriesTitle === 'New Warriors'
    && row.seriesYear === 1990 && Number(row.issueNumber) >= 43
    && Number(row.issueNumber) <= 75).map((row) => Number(row.issueNumber)),
  Array.from({ length: 33 }, (_, index) => index + 43));
  assert.ok(!mapping.rows.some((row) => row.normalizedSeriesTitle === 'Fantastic Four'
    && row.issueNumber === '207'));
  const promotional = mapping.rows.find((row) => row.selectedIssueId === 62818);
  assert.match(promotional.sourceIssueReference, /#1$/);
  assert.equal(promotional.metadataIssueNumber, '0');
  assert.equal(mapping.rows.find((row) => row.selectedIssueId === 37979).seriesYear, 2010);
  assert.equal(packet.proposedManifest.coverIssueId, 23363);
  assert.equal(packet.proposedManifest.expect, 371);
  assert.deepEqual(mapping.sourceGaps.map((gap) => gap.kind),
    ['published-metadata-gap', 'published-metadata-gap']);
  assert.ok(mapping.excludedSourceRows.every((row) => row.exclusionKind === 'source-correction'));
});

test('Nova renewed approval covers every final-base peer and retains all 37 non-none relationships', async () => {
  const manifest = await readJson('src/data/curated-lists.json');
  const orderIds = manifest.lists.filter((entry) => entry.id !== 'shang-chi-master-of-kung-fu-reading-order' && entry.id !== 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order' && entry.id !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order' && entry.id !== id
    && entry.id !== 'ultimate-spider-man-reading-order' && entry.id !== 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide').filter((row) => row.id !== 'namor-sub-mariner-reading-order' && row.id !== 'iron-fist-reading-order' && row.id !== 'mcu-prep-thunderbolts').map((entry) => entry.id);
  const rebuilt = await buildReportForMapping(mappingPath, [], {
    excludedOrderIds: ['mcu-prep-thunderbolts', 'ultimate-spider-man-reading-order', 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide', 'shang-chi-master-of-kung-fu-reading-order', 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order', 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order', 'namor-sub-mariner-reading-order', 'iron-fist-reading-order'],
  });
  assert.deepEqual(rebuilt, report);
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.equal(report.comparisonCount, 195);
  assert.equal(orderIds.length, 195);
  assert.deepEqual(new Set(report.comparisons.map((row) => row.orderId)), new Set(orderIds));
  assert.deepEqual(report.comparisons.reduce((counts, comparison) => ({
    ...counts,
    [comparison.relationship]: (counts[comparison.relationship] ?? 0) + 1,
  }), {}), { none: 158, partial: 36, 'existing-subset': 1 });
  assert.deepEqual(report.peerDigests, {});
  assert.equal(report.libraryDigest,
    'c75ad1641ebb4a956c287cb72798d8763ff6ea62cfa2c824f8073c43eb11c6ec');
  assert.equal(report.reportDigest,
    '5e642bff815b35af0cc13ade5090977842a125eb0a4ba03d8fdc92a975bfc86b');
  assert.equal(mapping.reviewStatus, 'approved');
  assert.deepEqual(mapping.approvedManifest, packet.proposedManifest);
  assert.equal(mapping.relationshipReview.approvalDigest,
    '963134e0c502bdcdc298cbf55265bc5a21cef432c38d56f699a7180121014b55');
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: rebuilt.libraryDigest, expectedOrderIds: orderIds,
  }));
});

test('Nova refuses a pending review even when report and selected issue rows are unchanged', () => {
  const pending = { ...mapping, reviewStatus: 'pending-independent-review' };
  delete pending.packetReview;
  delete pending.approvedManifest;
  delete pending.relationshipReview;
  assert.throws(() => buildMarkdown(pending), /not approved/);
  assert.throws(() => assertApprovedRelationshipReview({
    packet, mapping: pending, report, currentLibraryDigest: report.libraryDigest,
    expectedOrderIds: report.comparisons.map((row) => row.orderId),
  }), /not approved/);
});

test('Nova publishes 371 canonical entries and the two negative-ID gaps without duplicating repeats', async () => {
  const [manifest, catalog, payload, inventory, markdown] = await Promise.all([
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
    readJson('src/data/nova_reading_order.json'),
    readJson('scripts/data/cbh-character-inventory.json'),
    readFile(`src/data/orders/${id}.md`, 'utf8'),
  ]);
  const entry = manifest.lists.find((row) => row.id === id);
  const card = parseCatalog(catalog).lists.find((row) => row.id === id);
  const slot = inventory.find((row) => row.id === id);
  const index = manifest.lists.indexOf(entry);
  assert.deepEqual(entry, packet.proposedManifest);
  assert.equal(manifest.lists[index + 1].id, 'phalanx-reading-order');
  assert.equal(entry.timeline, null);
  assert.equal(entry.depth, 'partial');
  assert.equal(entry.spotlightKind, 'other');
  assert.equal(payload.count, 371);
  assert.equal(payload.items.length, 371);
  assert.equal(payload.placeholders, 2);
  assert.deepEqual(payload.items.flatMap((item, index) => item.placeholder
    ? [{ sourcePosition: mapping.sourceGaps.find((gap) =>
      gap.sourceIssueReference === item.title)?.sourcePosition,
    canonicalPosition: index + 1, issueId: item.issueId, title: item.title }]
    : []), gapPositions);
  for (const gap of gapPositions) {
    assert.equal(placeholderId(id, gap.title, String(gap.sourcePosition)), gap.issueId);
  }
  const expected = [...mapping.rows, ...mapping.sourceGaps]
    .sort((left, right) => left.sourcePosition - right.sourcePosition);
  assert.deepEqual(payload.items.map((item, index) => ({
    position: index + 1, issueId: item.issueId, title: item.title,
  })), expected.map((row, index) => ({
    position: index + 1,
    issueId: row.selectedIssueId ?? gapPositions.find((gap) =>
      gap.sourcePosition === row.sourcePosition)?.issueId,
    title: row.resolvedIssueTitle ?? row.sourceIssueReference,
  })));
  expected.forEach((row, rowIndex) => {
    const item = payload.items[rowIndex];
    if (row.selectedIssueId) {
      assert.deepEqual([item.issueId, item.seriesId, item.number],
        [row.selectedIssueId, row.seriesId, row.metadataIssueNumber ?? row.issueNumber],
        `source ${row.sourcePosition}`);
    } else {
      assert.equal(item.placeholder, true);
      assert.equal(item.title, row.sourceIssueReference);
    }
  });
  assert.equal(payload.items[0].issueId, 23363);
  assert.equal(payload.items.at(-1).issueId, mapping.rows.at(-1).selectedIssueId);
  assert.deepEqual(parseChecklist(markdown).unresolved.map((row) => row.sourceKey), ['141', '142']);
  assert.equal(card.count, 371);
  assert.equal(card.placeholderCount, 2);
  assert.equal(card.coverIssueId, 23363);
  assert.equal(slot.disposition, 'new-order');
  assert.equal(slot.centralDisposition, 'pilot-approved');
  assert.equal(slot.deliveryStatus, 'shipped');
  assert.deepEqual(slot.catalogIds, [id]);
  assert.deepEqual(slot.overlapIds, report.comparisons.filter((row) =>
    row.relationship !== 'none').map((row) => row.orderId).sort());
  assert.equal(searchCatalog(parseCatalog(catalog).lists, 'Nova').some((row) => row.id === id), true);
});
