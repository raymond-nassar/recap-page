import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences, digestCanonicalJson, validateFrozenPacket, validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseCatalog, searchCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'emma-frost-reading-order';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const selectedBlocks = [
  2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 21, 23, 25, 26, 28, 31, 32, 36, 38, 39, 41, 43, 44,
  45, 49, 50, 53, 54, 56, 58, 59, 61, 63, 65, 66, 68, 70, 72, 73, 75, 76, 79, 81, 83, 85,
  87, 89, 91, 93, 95, 96, 97, 99, 100, 101, 102, 104, 105, 106, 108, 109, 111, 113, 114, 115,
  117, 118, 120, 121, 123, 125, 127, 128, 130, 132, 134, 136, 138, 139, 141, 143, 145, 146, 148,
  150, 152, 154, 156, 158, 160, 162, 164, 167, 168, 170, 172, 174, 176, 178, 180, 182, 184, 186,
  188, 190, 192, 194, 195, 197, 199, 201, 203, 205, 207, 209, 211, 213, 215, 217, 219, 220, 222,
  224, 226, 228, 230, 232, 234, 236, 238, 240, 242, 244, 246, 248, 250, 252, 254, 256, 258, 259,
  261, 263, 265, 267, 268, 271, 273, 275, 277, 279, 280, 283, 285, 287, 289, 290, 291, 292, 293,
  294, 295, 296, 297, 298, 299,
];
const range = (first, last) => Array.from({ length: last - first + 1 }, (_, index) => String(first + index));
const rowsFor = (seriesId) => mapping.rows.filter((row) => row.seriesId === seriesId);

test('Emma selects the source cuts with collection fallback and conserves the full source vector', () => {
  assert.equal(ledger.blocks.length, 300);
  assert.equal(ledger.blocks.filter((block) => block.kind === 'collection').length, 165);
  assert.equal(ledger.blocks.filter((block) => block.kind === 'emma-frost-cut').length, 116);
  assert.deepEqual(ledger.blocks.filter((block) => block.selected).map((block) => block.sourceBlock), selectedBlocks);
  assert.equal(ledger.sourceSelection.fallbackCollectionSourcePositions.length, 47);
  assert.deepEqual(ledger.sourceSelection.cutToCollectionAssociations.find((row) => row.cutSourcePosition === 49),
    { cutSourcePosition: 49, replacesCollectionSourcePositions: [46, 47, 48] });
  assert.equal(ledger.sourceIssueBearingBlocksSha256,
    'ba1df5cd455097b69c64e697976a2db9d07a5085d8654f2e2c4ae06329d41412');
  assert.equal(packet.sourceOccurrenceCount, 802);
  assert.equal(packet.rows.length, 791);
  assert.equal(packet.sourceGaps.length, 2);
  assert.equal(packet.repeatedSourceReferences.length, 9);
  const all = [...packet.rows, ...packet.sourceGaps, ...packet.repeatedSourceReferences];
  assert.deepEqual(all.map((row) => row.sourcePosition).sort((a, b) => a - b),
    Array.from({ length: 802 }, (_, index) => index + 1));
  assert.equal(ledger.blocks.reduce((sum, block) => sum + block.selectedOccurrenceCount, 0), 802);
  assert.equal(digestCanonicalJson(ledger.occurrences.map((row) => (
    [row.sourceBlock, row.seriesId, row.issueNumber]
  ))), 'e5795607542c766d525b4542aa06c540c43fe752f563c1b2545a6230c5a443cc');
  assert.deepEqual(mapping.rows.map((row) => [row.sourcePosition, row.selectedIssueId]),
    ledger.occurrences.filter((row) => row.disposition === 'exact')
      .map((row) => [row.sourcePosition, row.issueId]));
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), ledger.canonicalIssueIdVector);
  for (const row of mapping.rows) {
    const occurrence = ledger.occurrences[row.sourcePosition - 1];
    assert.deepEqual([row.seriesId, row.issueNumber], [occurrence.seriesId, occurrence.issueNumber]);
  }
  for (const repeat of packet.repeatedSourceReferences) {
    const canonical = packet.rows[repeat.canonicalRow - 1];
    assert.ok(canonical.sourcePosition < repeat.sourcePosition);
    assert.deepEqual([repeat.normalizedSeriesTitle, repeat.seriesYear, repeat.issueNumber],
      [canonical.normalizedSeriesTitle, canonical.seriesYear, canonical.issueNumber]);
  }
  assert.equal(mapping.rows[0].selectedIssueId, 12446);
  assert.equal(mapping.rows.at(-1).selectedIssueId, 102236);
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
});

test('Emma distinguishes X-Men relaunches, annual years and corrected original identities', () => {
  assert.deepEqual(rowsFor(389).map((row) => row.issueNumber), range(1, 18));
  assert.equal(rowsFor(2281).length, 26);
  assert.ok(rowsFor(2281).every((row) => row.seriesYear === 2001));
  assert.ok(rowsFor(749).every((row) => row.seriesYear === 2004 && Number(row.issueNumber) <= 46));
  assert.deepEqual(rowsFor(2265).map((row) => row.issueNumber), ['36', '37']);
  assert.ok(rowsFor(403).every((row) => row.seriesYear === 2004 && Number(row.issueNumber) >= 165));
  for (const [seriesId, year, issueId] of [
    [18268, 1995, 48242], [35680, 1996, 103770], [38974, 1997, 113556], [45057, 1999, 133124],
    [3704, 2001, 18997], [3801, 2008, 20674], [26646, 2019, 73943], [19417, 2015, 51801],
  ]) {
    assert.deepEqual(rowsFor(seriesId).map((row) => [row.seriesYear, row.issueNumber, row.selectedIssueId]),
      [[year, '1', issueId]]);
  }
  assert.deepEqual(rowsFor(26173).map((row) => row.selectedIssueId), [71842, 71843]);
  assert.ok(rowsFor(26173).every((row) => row.seriesYear === 2019));
  assert.deepEqual(rowsFor(21098).map((row) => row.selectedIssueId), [60955, 64178]);
  assert.ok(!mapping.rows.some((row) => [20307, 23277, 922, 16229].includes(row.seriesId)));
  const suffix = mapping.rows.find((row) => row.selectedIssueId === 48673);
  assert.equal(suffix.issueNumber, '15');
  assert.match(suffix.sourceRangeReference, /#15\.INH/);
  assert.equal(ledger.reusedIdentityEvidence.issueId, 48673);
  assert.deepEqual(rowsFor(31375).map((row) => row.issueNumber), range(1, 18));
  assert.ok(!rowsFor(31324).some((row) => row.issueNumber === '25'));
  assert.deepEqual(rowsFor(34717).map((row) => row.issueNumber), range(1, 13));
  assert.ok(mapping.rows.every((row) => !/undefined|null/i.test(row.resolvedIssueTitle)));
});

test('Emma honors explicit source placements without adding their pointer issues', () => {
  const at = (seriesId, number) => mapping.rows.findIndex((row) => row.seriesId === seriesId && row.issueNumber === number);
  assert.equal(ledger.placementOverrides.length, 11);
  assert.equal(at(646, '20'), at(2281, '134') + 1);
  assert.equal(at(2281, '135'), at(646, '23') + 1);
  assert.equal(at(563, '8'), at(2281, '141') + 1);
  assert.equal(at(4423, '8'), at(2258, '504') + 1);
  assert.equal(at(6391, '1'), at(4423, '8') + 1);
  assert.equal(at(6599, '1'), at(6603, '2') - 1);
  assert.ok(at(6599, '1') > at(2258, '507'));
  assert.equal(at(16449, '10'), at(17602, '4') - 1);
  assert.equal(at(20622, '17'), at(22644, '3') - 1);
  assert.equal(at(20460, '19'), at(22644, '5') - 1);
  assert.equal(at(28053, '5'), at(29690, '1') + 1);
  assert.equal(at(27547, '21'), at(27564, '20') + 1);
  assert.equal(at(27567, '21'), at(27547, '21') + 1);
  assert.equal(rowsFor(27547).filter((row) => row.issueNumber === '21').length, 1);
  assert.equal(at(31375, '4'), at(34446, '1') + 1);
  assert.ok(at(31375, '6') < at(34459, '1'));
});

test('Emma retains exact unresolved source positions rather than selecting neighboring or duplicate candidates', () => {
  assert.deepEqual(packet.sourceGaps.map((row) => [row.sourcePosition, row.sourceIssueReference]), [
    [105, 'Generation X Annual (1998) #1'], [788, 'X-Men: Hellfire Gala (2023) #1'],
  ]);
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
  for (const gap of packet.sourceGaps) {
    assert.equal(gap.kind, 'published-metadata-gap');
    assert.equal(gap.status, 'open');
    assert.ok(gap.evidenceSources.some((source) => source.kind === 'tracking-issue'
      && source.url === 'https://github.com/raymond-nassar/recap-page/issues/529'));
  }
  assert.ok(!mapping.rows.some((row) => [106802, 115803].includes(row.selectedIssueId)));
  assert.match(packet.sourceGaps[0].auditBasis, /HTTP 200 with zero items/);
  assert.match(packet.sourceGaps[1].auditBasis, /106802 and 115803/);
});

test('Emma relationship approval regenerates against every current source-manifest order', async () => {
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const current = await buildReportForMapping(`scripts/data/cbh-mappings/${id}.json`, [], { excludedOrderIds: [] });
  const expectedOrderIds = manifest.lists.filter((row) => row.id !== id).map((row) => row.id);
  assert.deepEqual(current, report);
  assert.equal(report.comparisonCount, 183);
  assert.deepEqual(new Set(report.comparisons.map((row) => row.orderId)), new Set(expectedOrderIds));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: current.libraryDigest, expectedOrderIds,
  }));
});

test('Emma publishes the complete canonical vector and linked source credit under both character names', async () => {
  const payload = await readJson('src/data/emma_frost_reading_order.json');
  const markdown = await readFile(`src/data/orders/${id}.md`, 'utf8');
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 791);
  assert.equal(parsed.unresolved.length, 2);
  assert.equal(payload.items.length, 793);
  assert.equal(new Set(payload.items.map((row) => row.issueId)).size, 793);
  const expected = [...mapping.rows, ...mapping.sourceGaps].sort((a, b) => a.sourcePosition - b.sourcePosition);
  expected.forEach((row, index) => {
    const item = payload.items[index];
    if (row.selectedIssueId) {
      assert.deepEqual([item.issueId, item.seriesId, item.number], [row.selectedIssueId, row.seriesId, row.issueNumber]);
    } else {
      assert.ok(item.issueId < 0);
      assert.equal(item.placeholder, true);
      assert.equal(item.title, row.sourceIssueReference);
    }
  });
  assert.ok(payload.items.every((row) => row.description == null && row.title && !/undefined|null/i.test(row.title)));
  assert.equal(payload.items.find((row) => row.issueId === 42332).number, '0');
  const catalog = parseCatalog(await readJson('src/data/catalog.json'));
  const card = catalog.lists.find((row) => row.id === id);
  assert.equal(card.source, `https://www.comicbookherald.com/${id}/`);
  assert.equal(card.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
  assert.equal(card.sourceLicense, null);
  assert.equal(card.depth, 'partial');
  assert.equal(card.spotlightKind, 'other');
  for (const alias of ['Emma Frost', 'White Queen']) {
    assert.ok(searchCatalog(catalog.lists, alias).some((row) => row.id === id));
  }
});

test('Emma metadata reconstruction preserves pinned covers and independently recorded sparse fields', async () => {
  const payload = await readJson('src/data/emma_frost_reading_order.json');
  const byId = new Map(payload.items.map((row) => [row.issueId, row]));
  const records = ledger.metadataHydration.records;
  assert.equal(records.length, 791);
  assert.equal(records.filter((row) => row.kind === 'provider-response').length, 374);
  const reused = records.filter((row) => row.kind === 'reconstructed-from-pinned-payload');
  assert.equal(reused.length, 417);
  const files = [...new Set(reused.map((row) => row.file))];
  const fileHash = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
  const sources = new Map(await Promise.all(files.map(async (file) => {
    const text = await readFile(file, 'utf8');
    const lf = text.replace(/\r\n/g, '\n');
    assert.equal(fileHash(lf), fileHash(lf.replace(/\n/g, '\r\n')));
    return [file, { hash: fileHash(text), data: JSON.parse(text) }];
  })));
  for (const record of reused) {
    const source = sources.get(record.file);
    assert.equal(source.hash, record.fileSha256);
    const item = source.data.items.find((row) => row.issueId === record.issueId);
    assert.ok(item);
    assert.deepEqual(byId.get(record.issueId).cover, item.cover ?? null);
  }
  assert.match(ledger.fileHashEncoding, /CRLF normalized to LF/);
  const pending = [ledger];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    if (value.file && value.fileSha256) {
      assert.equal(fileHash(await readFile(value.file, 'utf8')), value.fileSha256);
      assert.match(value.observedFileSha256, /^[a-f0-9]{64}$/);
    }
    for (const child of Object.values(value)) if (child && typeof child === 'object') pending.push(child);
  }
  const issueZero = records.find((row) => row.issueId === 42332);
  assert.equal(issueZero.requiredFieldReconstruction.value, '0');
  for (const issueId of [101529, 101530, 112140, 102233, 102236]) {
    assert.ok(records.find((row) => row.issueId === issueId).supplementalFields
      .some((field) => field.field === 'title'));
  }
});

test('Emma evidence excludes synopsis prose recursively, including nested gap candidates', () => {
  const editorial = new Set([packet.proposedManifest, mapping.proposedManifest, mapping.approvedManifest]);
  const pending = [packet, mapping, ledger];
  while (pending.length) {
    const value = pending.pop();
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      if (['synopsis', 'description'].includes(key) && !editorial.has(value)) assert.ok(child == null || child === '');
      if (child && typeof child === 'object') pending.push(child);
    }
  }
});
