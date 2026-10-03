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
import { parseCatalog, searchCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'ms-marvel-kamala-khan-reading-order';
const mappingPath = `scripts/data/cbh-mappings/${id}.json`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [packet, mapping, report, ledger] = await Promise.all([
  readJson(`scripts/data/cbh-packets/${id}.json`),
  readJson(mappingPath),
  readJson(`scripts/data/cbh-overlaps/${id}.json`),
  readJson(`scripts/data/cbh-source-ledgers/${id}.json`),
]);
const sourceCounts = {
  sourceOccurrenceCount: 196,
  sourceIdentityCount: 192,
  includedIssueCount: 187,
  sourceGapCount: 5,
  repeatedSourceReferenceCount: 4,
};
const gapIssueIds = new Map([
  [192, -2019288189],
  [193, -2036065808],
  [194, -1985732951],
  [195, -2002510570],
  [196, -1952177713],
]);
const at = (position) => mapping.rows.find((row) => row.sourcePosition === position);

test('Kamala conserves the complete factual source, four repeats and five unresolved originals', () => {
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.deepEqual(sourceCountsForPacket(packet), sourceCounts);
  assert.equal(ledger.sourceOccurrenceCount, 196);
  assert.equal(ledger.canonicalIssueCount, 192);
  assert.equal(ledger.blocks.length, 37);
  assert.deepEqual(Object.values(ledger.sectionOccurrenceCounts), [19, 95, 53, 29]);
  assert.deepEqual(ledger.occurrences.map((row) => row.sourcePosition),
    Array.from({ length: 196 }, (_, index) => index + 1));
  assert.deepEqual([
    ...packet.rows, ...packet.sourceGaps, ...packet.repeatedSourceReferences,
  ].map((row) => row.sourcePosition).sort((a, b) => a - b),
  Array.from({ length: 196 }, (_, index) => index + 1));
  assert.equal(digestCanonicalJson(ledger.blocks.map(({ section, kind, reference, runs }) => (
    { section, kind, reference, runs }
  ))), '8801f8a85fbff39de52e55efcc2dea7383a89d7b4d071f6f8bea0a7ebde7fad9');
  assert.equal(ledger.sourceIssueBearingBlocksSha256, packet.sourceIssueBearingBlocksSha256);
  assert.equal(ledger.sourceContentSha256, packet.sourceContentSha256);
  assert.equal(ledger.observedSnapshot.rawResponseSha256,
    '7b91fb3060531f4b8220750d43d6794dce47a4ffa60103c61254435bbbf6144f');
  assert.equal(ledger.observedSnapshot.renderedContentSha256,
    '926cceba8a902833fddf9146ec613cc3916819abda871c8c3fe4ac14829a4613');
  assert.notEqual(ledger.observedSnapshot.rawResponseSha256,
    ledger.observedSnapshot.factualProjectionSha256);
  assert.deepEqual(packet.repeatedSourceReferences.map(({ sourcePosition, canonicalRow }) => (
    [sourcePosition, packet.rows[canonicalRow - 1].sourcePosition]
  )), [[71, 54], [109, 98], [110, 99], [111, 100]]);
  assert.deepEqual(packet.sourceGaps.map((row) => row.sourcePosition), [192, 193, 194, 195, 196]);
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
  assert.ok(packet.sourceGaps.every((row) => row.status === 'open'
    && row.evidenceSources.some((source) => source.url.endsWith('/issues/598'))));
  assert.match(packet.excludedSourceReferences.join('\n'), /Point One.*fragment-only/);
  assert.match(packet.excludedSourceReferences.join('\n'), /Attilan Rising.*unnumbered/);
  assert.match(packet.excludedSourceReferences.join('\n'), /Amazing Spider-Man.*fragment-only/);
});

test('Kamala ledger block runs account for every packet and mapping disposition in source order', () => {
  const firstByOriginal = new Map();
  const occurrences = [];
  for (const block of ledger.blocks) {
    assert.equal(block.firstSourcePosition, occurrences.length + 1);
    const start = occurrences.length;
    for (const [originalTitle, workingOriginalYear, range] of block.runs) {
      assert.match(range, /^\d+(?:-\d+)?$/);
      const [first, last = first] = range.split('-').map(Number);
      assert.ok(last >= first);
      for (let number = first; number <= last; number += 1) {
        const issueNumber = String(number);
        const key = JSON.stringify([originalTitle, workingOriginalYear, issueNumber]);
        if (!firstByOriginal.has(key)) {
          firstByOriginal.set(key, { canonicalRow: firstByOriginal.size + 1, sourcePosition: occurrences.length + 1 });
        }
        const firstOccurrence = firstByOriginal.get(key);
        occurrences.push({
          sourcePosition: occurrences.length + 1,
          sourceBlock: block.sourceBlock,
          originalTitle,
          workingOriginalYear,
          issueNumber,
          canonicalRow: firstOccurrence.canonicalRow,
          ...(firstOccurrence.sourcePosition === occurrences.length + 1
            ? {} : { canonicalSourcePosition: firstOccurrence.sourcePosition }),
        });
      }
    }
    assert.equal(occurrences.length - start, block.selectedOccurrenceCount);
  }
  assert.equal(occurrences.length, 196);
  assert.equal(firstByOriginal.size, 192);
  assert.deepEqual(ledger.occurrences, occurrences);

  const titledAliases = new Map([
    ['Avengers (2015 standalone anthology)', 'Avengers'],
    ['Avengers (legacy numbering)', 'Avengers'],
    ['Amazing Spider-Man', 'The Amazing Spider-Man'],
  ]);
  const records = (data) => new Map([
    ...data.rows.map((row) => [row.sourcePosition, { kind: 'exact', row }]),
    ...data.sourceGaps.map((row) => [row.sourcePosition, { kind: 'gap', row }]),
    ...data.repeatedSourceReferences.map((row) => [row.sourcePosition, { kind: 'repeat', row }]),
  ]);
  const packetRecords = records(packet);
  const mappingRecords = records(mapping);
  assert.equal(packetRecords.size, 196);
  assert.equal(mappingRecords.size, 196);
  const sourceFields = ({ sourcePosition, sourceIssueReference, sourceRangeReference,
    normalizedSeriesTitle, seriesYear, issueNumber }) => ({
    sourcePosition, sourceIssueReference, sourceRangeReference,
    normalizedSeriesTitle, seriesYear, issueNumber,
  });
  for (const occurrence of occurrences) {
    const { sourcePosition, sourceBlock, originalTitle, workingOriginalYear, issueNumber, canonicalRow } = occurrence;
    const key = JSON.stringify([originalTitle, workingOriginalYear, issueNumber]);
    const first = firstByOriginal.get(key);
    const kind = first.sourcePosition === sourcePosition
      ? (sourcePosition >= 192 ? 'gap' : 'exact') : 'repeat';
    const packetRecord = packetRecords.get(sourcePosition);
    const mappingRecord = mappingRecords.get(sourcePosition);
    assert.equal(packetRecord?.kind, kind, `packet source position ${sourcePosition}`);
    assert.equal(mappingRecord?.kind, kind, `mapping source position ${sourcePosition}`);
    const row = packetRecord.row;
    const title = titledAliases.get(originalTitle) ?? originalTitle;
    assert.equal(row.normalizedSeriesTitle, title, `source position ${sourcePosition} title`);
    if (workingOriginalYear !== null) {
      assert.equal(row.seriesYear, workingOriginalYear, `source position ${sourcePosition} year`);
    } else {
      assert.ok(Number.isInteger(row.seriesYear), `source position ${sourcePosition} resolved provider year`);
    }
    assert.equal(row.issueNumber, issueNumber, `source position ${sourcePosition} issue`);
    assert.equal(row.sourceIssueReference, `${title} (${row.seriesYear}) #${issueNumber}`);
    assert.equal(row.sourceRangeReference, ledger.blocks[sourceBlock - 1].displayReference);
    assert.deepEqual(sourceFields(mappingRecord.row), sourceFields(row));
    if (kind === 'repeat') {
      assert.equal(row.canonicalRow, canonicalRow);
      assert.equal(mappingRecord.row.canonicalRow, canonicalRow);
      assert.equal(packet.rows[canonicalRow - 1].sourcePosition, first.sourcePosition);
    }
  }
});

test('Kamala keeps distinct originals and the source-directed Worlds Collide interleave', () => {
  for (const [position, seriesId, number, issueId] of [
    [1, 18468, '1', 49089],
    [20, 20443, '0', 56448],
    [21, 20443, '1', 55351],
    [27, 20615, '1', 56116],
    [54, 22552, '6', 61447],
    [89, 22547, '672', 64681],
    [90, 22552, '13', 61454],
    [91, 22547, '673', 65056],
    [92, 22552, '14', 61455],
    [93, 22547, '674', 65264],
    [94, 22552, '15', 61456],
    [98, 22552, '19', 66757],
    [115, 24155, '1', 66769],
    [127, 26592, '1', 73804],
    [145, 27133, '7', 75478],
    [168, 25804, '0', 66916],
    [169, 25133, '1', 69010],
    [170, 25147, '1', 69030],
    [171, 25139, '1', 69019],
    [172, 25141, '1', 69021],
    [173, 35628, '1', 103514],
    [174, 35626, '1', 103512],
    [175, 35627, '1', 103513],
    [176, 34644, '1', 101168],
    [177, 35364, '1', 102365],
    [178, 35566, '1', 103236],
    [190, 36206, '1', 104546],
    [191, 32866, '26', 102194],
  ]) {
    assert.deepEqual(
      [at(position)?.seriesId, at(position)?.issueNumber, at(position)?.selectedIssueId],
      [seriesId, number, issueId], `source position ${position} changed original`,
    );
  }
  assert.equal(new Set(mapping.rows.map((row) => row.selectedIssueId)).size, 187);
  assert.deepEqual(mapping.rows.filter((row) => row.sourcePosition >= 178
    && row.sourcePosition <= 190).map((row) => row.sourcePosition),
  Array.from({ length: 13 }, (_, index) => 178 + index));
  assert.equal(mapping.rows.some((row) => row.seriesId === 20443 && row.issueNumber === '0'
    && row.selectedIssueId !== 56448), false);
  assert.ok(!mapping.rows.some((row) =>
    /Free Comic Book Day|FCBD|Attilan Rising|Point One/.test(row.sourceIssueReference)));
});

test('Kamala publishes the exact generated checklist, 187 issues, five honest gaps and credited card', async () => {
  const [markdown, payload, manifest, rawCatalog, inventory] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson('src/data/ms_marvel_kamala_khan_reading_order.json'),
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
    readJson('scripts/data/cbh-character-inventory.json'),
  ]);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 187);
  assert.equal(parsed.unresolved.length, 5);
  assert.equal(payload.items.length, 192);
  assert.equal(payload.count, 192);
  assert.equal(payload.placeholders, 5);
  assert.equal(payload.unresolved.length, 5);
  const selected = [...mapping.rows, ...mapping.sourceGaps]
    .sort((left, right) => left.sourcePosition - right.sourcePosition);
  selected.forEach((row, index) => {
    const item = payload.items[index];
    if (row.selectedIssueId) {
      assert.deepEqual([item.issueId, item.seriesId, item.number],
        [row.selectedIssueId, row.seriesId, row.issueNumber]);
    } else {
      assert.equal(item.issueId, gapIssueIds.get(row.sourcePosition),
        `source position ${row.sourcePosition} changed placeholder identity`);
      assert.equal(item.placeholder, true);
      assert.equal(item.title, row.sourceIssueReference);
      assert.equal(item.digitalId, null);
    }
  });
  assert.deepEqual(payload.items.filter((item) => item.issueId < 0).map((item) => item.issueId),
    [...gapIssueIds.values()]);
  assert.ok(payload.items.every((item) => item.description == null));
  const entry = manifest.lists.find((row) => row.id === id);
  assert.deepEqual(entry, packet.proposedManifest);
  assert.equal(manifest.lists[manifest.lists.indexOf(entry) + 1].id, packet.insertionAnchor.beforeId);
  const catalog = parseCatalog(rawCatalog);
  const card = catalog.lists.find((row) => row.id === id);
  assert.equal(card.source, ledger.sourceUrl);
  assert.equal(card.count, 192);
  assert.equal(card.placeholderCount, 5);
  for (const value of [entry, card]) {
    assert.equal(value.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
    assert.equal(value.sourceLicense, null);
    assert.equal(value.depth, 'partial');
    assert.equal(value.spotlightKind, 'other');
    assert.equal(value.timeline, null);
  }
  assert.ok(searchCatalog(catalog.lists, 'Kamala Khan').some((row) => row.id === id));
  const record = inventory.find((row) => row.position === 77);
  assert.equal(record.id, id);
  assert.equal(record.deliveryStatus, 'shipped');
  assert.deepEqual(record.catalogIds, [id]);
  assert.deepEqual(record.overlapIds, report.comparisons.filter((row) =>
    row.relationship !== 'none').map((row) => row.orderId).sort());
});

test('Kamala relationship receipt covers every member of the current library', async () => {
  const current = await buildReportForMapping(mappingPath, [], {
    excludedOrderIds: ['mcu-prep-thunderbolts', 'nova-reading-order', 'ultimate-spider-man-reading-order', 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide', 'shang-chi-master-of-kung-fu-reading-order', 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order', 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order', 'namor-sub-mariner-reading-order', 'iron-fist-reading-order', 'mcu-prep-eternals'],
  });
  const manifest = await readJson('src/data/curated-lists.json');
  const expectedOrderIds = manifest.lists.filter((entry) =>
    entry.id !== 'shang-chi-master-of-kung-fu-reading-order' && entry.id !== 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order' && entry.id !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order' && entry.id !== id && entry.id !== 'nova-reading-order'
    && entry.id !== 'ultimate-spider-man-reading-order' && entry.id !== 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide').filter((row) => row.id !== 'namor-sub-mariner-reading-order' && row.id !== 'iron-fist-reading-order' && row.id !== 'mcu-prep-eternals' && row.id !== 'mcu-prep-thunderbolts').map((entry) => entry.id);
  assert.deepEqual(current, report);
  assert.equal(report.comparisonCount, 194);
  assert.equal(report.comparisonCount, expectedOrderIds.length);
  assert.deepEqual(new Set(report.comparisons.map((row) => row.orderId)),
    new Set(expectedOrderIds));
  assert.deepEqual(report.comparisons.reduce((counts, row) => ({
    ...counts, [row.relationship]: (counts[row.relationship] ?? 0) + 1,
  }), {}), { partial: 16, none: 178 });
  assert.equal(mapping.relationshipReview.approvalDigest,
    '30a50925eabd31addf58b3995ad45228ea0d51d465fdd15018337c5ba689eba6');
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: current.libraryDigest, expectedOrderIds,
  }));
});

test('Kamala approval rejects a changed standalone #0 identity and a lost final gap', () => {
  const changed = structuredClone(mapping);
  changed.rows.find((row) => row.sourcePosition === 20).selectedIssueId = 55351;
  assert.throws(() => validateMappingDigest(changed), /digest/i);
  const truncated = structuredClone(packet);
  truncated.sourceGaps.pop();
  assert.throws(() => validateFrozenPacket(truncated), /digest|count|source/i);
});
