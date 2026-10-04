import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertApprovedRelationshipReview, buildMarkdown,
} from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences, digestCanonicalJson, libraryDigestFor, validateFrozenPacket,
  validateMappingDigest, validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { issueIdsFromValue } from '../scripts/lib/cbh-overlap.mjs';
import { placeholderId } from '../scripts/lib/placeholder-id.mjs';
import { parseCatalog, searchCatalog, shelfKey } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'shang-chi-master-of-kung-fu-reading-order';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [packet, mapping, report, ledger, manifest, fixture] = await Promise.all([
  readJson(`scripts/data/cbh-packets/${id}.json`),
  readJson(`scripts/data/cbh-mappings/${id}.json`),
  readJson(`scripts/data/cbh-overlaps/${id}.json`),
  readJson(`scripts/data/cbh-source-ledgers/${id}.json`),
  readJson('src/data/curated-lists.json'),
  readJson('test/fixtures/shang-chi-browser-vector.json'),
]);

test('Shang-Chi conserves the corrected source boundary, original identities and eight qualified gaps', () => {
  assert.equal(packet.packetDigest, '03a9db98c4ef92eeab5c2adbbdd0699bae781a56ca8d0a3b2ea95f955ae938be');
  assert.equal(mapping.mappingDigest, '3ca94a2657dca2348c7ed584af670210072201dbb6d783252d52df3f9f031698');
  assert.equal(ledger.printedOccurrences.length, 375);
  assert.equal(ledger.printedVectorSha256,
    '6eca0f525cdd50e4ce47acb7878078891cf41e56d20f071bfac76e8fc6c51b1f');
  for (const [array, field, expected] of [
    [ledger.factualBlocks.map(({ sourceBlock: _sourceBlock, ...block }) => block),
      'sourceIssueBearingBlocksSha256', 'f10e9fb4d2a4c0daefac6521232b7f2230338d00b64e7fd48188b0ccfa4f0879'],
    [ledger.printedOccurrences, 'printedOccurrencesSha256',
      '7a614117a89d211a30cde8f7dfb4719eca2f5be9f6750295b7b645b3e44aed24'],
    [ledger.selectedOccurrences, 'selectedVectorSha256',
      'bed05db8b351c28133433e7db175a1cf515b43d953b49e3805f23f0211be4b9b'],
    [ledger.printedCorrespondence, 'printedCorrespondenceSha256',
      'cc40744eb5a4185b5eabf323669f682295b4fbc6e2ed37fd9562487d2d905ee6'],
  ]) {
    assert.equal(ledger[field], expected);
    assert.equal(digestCanonicalJson(array), expected, `${field} must cover its actual source array`);
  }
  assert.equal(packet.sourceOccurrenceCount, 302);
  assert.deepEqual([packet.rows.length, packet.sourceGaps.length, packet.repeatedSourceReferences.length],
    [290, 8, 4]);
  assert.deepEqual([...packet.rows, ...packet.sourceGaps, ...packet.repeatedSourceReferences]
    .map((row) => row.sourcePosition).sort((a, b) => a - b),
  Array.from({ length: 302 }, (_, index) => index + 1));
  assert.deepEqual(packet.repeatedSourceReferences.map((repeat) => [
    repeat.sourcePosition, packet.rows[repeat.canonicalRow - 1].sourcePosition,
  ]), [[12, 10], [207, 31], [208, 97], [209, 98]]);
  assert.deepEqual(packet.sourceGaps.map((row) => row.sourcePosition),
    [42, 49, 165, 166, 167, 168, 169, 170]);
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
  assert.equal(Object.hasOwn(packet, 'sourceGapResolutions'), false);
  assert.equal(Object.hasOwn(mapping, 'sourceGapResolutions'), false);
  const ironFist = mapping.rows.filter((row) => row.sourcePosition >= 244 && row.sourcePosition <= 250);
  assert.deepEqual(ironFist.map((row) => [row.sourcePosition, row.issueNumber, row.selectedIssueId]),
    [[244, '6', 64282], [245, '7', 64601], [246, '73', 64770], [247, '74', 65081],
      [248, '75', 65289], [249, '76', 65576], [250, '77', 66103]]);
  assert.deepEqual(ironFist.map((row) => row.sourceIssueReference),
    ['6', '7', '73', '74', '75', '76', '77']
      .map((number) => `Iron Fist (2017) #${number}`));
  assert.deepEqual([...new Set(ironFist.map((row) => row.sourceRangeReference))],
    ['Iron Fist (2017) #6-7, #73-77 (corrected collection; source prints #72-76)']);
  assert.deepEqual(ledger.printedOccurrences.slice(319, 324).map((row) => row.issueNumber),
    ['72', '73', '74', '75', '76']);
  assert.deepEqual(ledger.printedCorrespondence.slice(319, 324).map((row) => row.normalizedIssueNumber),
    ['73', '74', '75', '76', '77']);
  assert.equal(packet.rows.filter((row) => row.seriesId === 19133
    && row.manualSeriesSelectionApproved === true).length, 32);
  const ronin = packet.rows.find((row) => row.sourcePosition === 237);
  assert.deepEqual([ronin.seriesYear, ronin.candidateIssueId], [2010, 36365]);
  assert.equal(ledger.selectedOccurrences[236].seriesYearCandidate, 2011);
  assert.deepEqual([mapping.rows[0].selectedIssueId, packet.proposedManifest.coverIssueId],
    [67118, 67118]);
  assert.equal(mapping.rows.find((row) => row.sourcePosition === 30).selectedIssueId, 19868);
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
});

test('Shang-Chi requires its renewed independent relationship approval against all 198 pinned peers', async () => {
  assert.equal(report.reportDigest, '7d1728b99a201eaaa9f9ecac847d6568dabf0b3bbc122162e62e72887a5215d9');
  assert.equal(report.libraryDigest, '102ea0878763d021a849cd56e08b2d7b2552281c49aedeeacc8f75e95e4e617b');
  assert.equal(mapping.relationshipReview.approvalDigest,
    '76f81c9a189e88b98556ba1a7c0564531675380a82428480117abd49599a6f5f');
  assert.equal(mapping.reviewStatus, 'approved');
  assert.deepEqual(mapping.approvedManifest, packet.proposedManifest);
  const published = manifest.lists.filter((entry) => entry.id !== id
    && entry.id !== 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order'
    && entry.id !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order'
    && entry.id !== 'namor-sub-mariner-reading-order'
    && entry.id !== 'iron-fist-reading-order' && entry.id !== 'mcu-prep-daredevil-born-again' && entry.id !== 'mcu-prep-deadpool-and-wolverine' && entry.id !== 'mcu-prep-eternals' && entry.id !== 'spider-man-no-way-home-owner-selected' && entry.id !== 'mcu-prep-thunderbolts');
  assert.equal(published.length, 198);
  const orders = await Promise.all(published.map(async (entry) => ({
    id: entry.id,
    issueIds: issueIdsFromValue(await readJson(`src/data/${entry.out}`)).map(String),
  })));
  const peerDigest = libraryDigestFor({ ...manifest, lists: published }, orders);
  assert.equal(peerDigest, report.libraryDigest);
  const expectedOrderIds = published.map((entry) => entry.id);
  assert.equal(report.comparisonCount, expectedOrderIds.length);
  assert.deepEqual(report.comparisons.reduce((counts, comparison) => {
    counts[comparison.relationship] = (counts[comparison.relationship] ?? 0) + 1;
    return counts;
  }, {}), { partial: 16, none: 182 });
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: peerDigest, expectedOrderIds,
  }));
});

test('Shang-Chi refuses a pending clone even when exact issue rows are unchanged', () => {
  const pending = structuredClone(mapping);
  pending.reviewStatus = 'pending-independent-review';
  delete pending.packetReview;
  delete pending.approvedManifest;
  delete pending.relationshipReview;
  assert.throws(() => assertApprovedRelationshipReview({
    packet, mapping: pending, report, currentLibraryDigest: report.libraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /not approved/);
});

test('Shang-Chi authored checklist and complete browser vector preserve every selected position', async () => {
  const [markdown, fixtureBytes] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readFile('test/fixtures/shang-chi-browser-vector.json'),
  ]);
  assert.equal(createHash('sha256').update(fixtureBytes.toString('utf8').replace(/\r\n/g, '\n')).digest('hex'),
    '7ef31593030ad78ef871d470921cc6b7f5938d99e2099dd67822383298a51a49');
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  const all = [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index);
  assert.deepEqual([parsed.entries.length, parsed.unresolved.length, all.length], [290, 8, 298]);
  assert.equal(fixture.packetDigest, packet.packetDigest);
  assert.equal(fixture.mappingDigest, mapping.mappingDigest);
  assert.equal(fixture.relationshipApprovalDigest, mapping.relationshipReview.approvalDigest);
  assert.equal(fixture.sourceOccurrenceCount, 302);
  assert.deepEqual(fixture.rows.map((row) => row.sourcePosition),
    [...packet.rows, ...packet.sourceGaps]
      .map((row) => row.sourcePosition).sort((a, b) => a - b));
  const sourceByPosition = new Map([...mapping.rows, ...mapping.sourceGaps]
    .map((row) => [row.sourcePosition, row]));
  all.forEach((row, index) => {
    const expected = fixture.rows[index];
    const source = sourceByPosition.get(expected.sourcePosition);
    assert.equal(row.sourceKey, String(expected.sourcePosition));
    assert.equal(row.title, expected.title);
    assert.equal(row.section?.slice(0, 200) ?? null, expected.collectedIn);
    assert.ok((expected.collectedIn?.length ?? 0) <= 200);
    assert.equal(row.issueId ?? placeholderId(id, row.title, row.sourceKey), expected.issueId);
    assert.equal(source.selectedIssueId ?? expected.issueId, expected.issueId);
    if (expected.gap) assert.equal(source.sourceIssueReference, expected.sourceIssueReference);
    else assert.deepEqual([source.seriesId, source.issueNumber],
      [expected.seriesId, expected.issueNumber]);
  });
  assert.deepEqual(fixture.rows.filter((row) => row.gap).map((row) => row.sourcePosition),
    [42, 49, 165, 166, 167, 168, 169, 170]);
  assert.deepEqual(fixture.rows.filter((row) => row.sourcePosition >= 244 && row.sourcePosition <= 250)
    .map((row) => [row.sourcePosition, row.issueId, row.issueNumber]),
  [[244, 64282, '6'], [245, 64601, '7'], [246, 64770, '73'], [247, 65081, '74'],
    [248, 65289, '75'], [249, 65576, '76'], [250, 66103, '77']]);
  assert.match(markdown, /^## Iron Fist \(2017\) #6-7, #73-77 \(corrected collection; source prints #72-76\)$/m);
  assert.doesNotMatch(markdown, /^## Iron Fist 6-7, 72-76$/m);
  assert.deepEqual(fixture.repeatTargets.map((repeat) => [
    repeat.sourcePosition, repeat.canonicalSourcePosition,
  ]), [[12, 10], [207, 31], [208, 97], [209, 98]]);
  const position = manifest.lists.findIndex((entry) => entry.id === id);
  assert.equal(manifest.lists.length, 207);
  assert.equal(manifest.lists[position - 1].id, 'doctor-octopus-otto-octavius-reading-order');
  assert.equal(manifest.lists[position + 1].id, 'thunderbolts-reading-order');
  assert.deepEqual(manifest.lists[position], packet.proposedManifest);
});

test('Shang-Chi vendored payload preserves exact original IDs, eight gaps and its own cover', async () => {
  const [payload, catalog, markdown] = await Promise.all([
    readJson(`src/data/${packet.proposedManifest.out}`),
    readJson('src/data/catalog.json'),
    readFile(`src/data/orders/${id}.md`, 'utf8'),
  ]);
  const parsed = parseChecklist(markdown);
  assert.deepEqual([payload.count, payload.items.length, payload.unresolved.length],
    [298, 298, 8]);
  const exactItems = payload.items.filter((item) => !item.placeholder);
  assert.deepEqual(exactItems.map((item) => item.issueId),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.deepEqual(payload.items.map((item) => item.issueId),
    fixture.rows.map((row) => row.issueId));
  assert.deepEqual(exactItems.map((item) => item.title),
    mapping.rows.map((row) => row.resolvedIssueTitle));
  assert.deepEqual(payload.items.map((item) => item.collectedIn),
    [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index)
      .map((row) => row.section));
  assert.deepEqual(payload.unresolved.map((row) => [row.index, row.sourceKey, row.title]),
    fixture.rows.filter((row) => row.gap)
      .map((row) => [fixture.rows.indexOf(row), String(row.sourcePosition), row.title]));
  assert.deepEqual(payload.items.filter((item) => item.placeholder).map((item) => item.issueId),
    fixture.rows.filter((row) => row.gap).map((row) => row.issueId));
  assert.ok(payload.items.every((item) => item.description === null));
  assert.ok(payload.items.filter((item) => item.placeholder).every((item) =>
    item.url === null && item.seriesId === null && item.digitalId === null));
  assert.equal(payload.items.find((item) => item.issueId === 66103).number, '77');
  assert.equal(payload.items.find((item) => item.issueId === 36365).seriesId, 12429);
  const card = catalog.lists.find((entry) => entry.id === id);
  const cover = payload.items.find((item) => item.issueId === 67118).cover;
  assert.ok(cover?.path && cover.ext);
  assert.deepEqual([card.coverIssueId, card.cover], [67118, cover]);
  assert.deepEqual([card.count, card.placeholderCount, card.emptyRecordCount], [298, 8, 0]);
  assert.deepEqual([card.type, card.depth, card.spotlightKind, card.timeline],
    ['character-run', 'partial', 'other', null]);
  assert.equal(card.sourceLicense, null);
  assert.equal(catalog.lists.length, 284);
  const parsedCatalog = parseCatalog(catalog);
  assert.equal(shelfKey({ lists: [card] }), 'spotlights');
  for (const query of ['Shang-Chi', 'Master of Kung Fu', 'Ten Rings']) {
    assert.ok(searchCatalog(parsedCatalog.lists, query).some((entry) => entry.id === id));
  }
});
