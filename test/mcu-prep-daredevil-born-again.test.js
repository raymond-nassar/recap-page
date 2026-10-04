import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import {
  digestCanonicalJson,
  libraryDigestFor,
  validateFrozenPacket,
  validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport, issueIdsFromValue } from '../scripts/lib/cbh-overlap.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  HOME_CATEGORIES, groupCatalog, parseCatalog, shelfLists,
} from '../src/js/lib/catalog.js';
import { parseManifest } from '../src/js/lib/curated.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = 'mcu-prep-daredevil-born-again';
const sourceOrigin = 'Selected by raymond-nassar for MCU Prep';
const provider = {
  id: 'owner-authored',
  hosts: ['github.com'],
  sourceOrigin,
  requireSourceProvider: true,
  requireSourceContentSha256: true,
};
const collections = [
  [1, '1. The Man Without Fear', 'Daredevil: The Man Without Fear', 1993, 3897, 1,
    [20750, 20751, 20752, 20753, 20754]],
  [2, '2. Born Again', 'Daredevil', 1964, 2002, 227,
    [8215, 8216, 8217, 8219, 8220, 8221, 8222]],
  [3, '3a. Out', 'Daredevil', 1998, 449, 32,
    [15634, 15635, 15636, 15637, 15638, 15639, 15640, 15641, 15643]],
  [3, '3b. The Devil Inside and Out Vol. 1', 'Daredevil', 1998, 449, 82,
    [3482, 3946, 4070, 4183, 4284, 4439]],
  [4, '4. Know Fear', 'Daredevil', 2019, 26080, 1,
    [71553, 71556, 71559, 71561, 71563]],
  [5, '5. No Devils, Only God', 'Daredevil', 2019, 26080, 6,
    [71565, 71566, 71567, 71568, 71569]],
];
const expectedRows = collections.flatMap(([position, part, title, year, seriesId, first, ids]) => (
  ids.map((issueId, index) => ({
    issueId,
    selectionPosition: position,
    part,
    title: `${title} (${year}) #${first + index}`,
    seriesId,
    seriesYear: year,
    number: String(first + index),
  }))
));
const expectedIds = expectedRows.map((row) => row.issueId);

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

async function evidence() {
  const [ledger, packet, mapping, report] = await Promise.all([
    json(`scripts/data/owner-selections/${id}.json`),
    json(`scripts/data/owner-packets/${id}.json`),
    json(`scripts/data/owner-mappings/${id}.json`),
    json(`scripts/data/owner-overlaps/${id}.json`),
  ]);
  return { ledger, packet, mapping, report };
}

test('owner Daredevil preserves five positions and the explicitly expanded third selection', async () => {
  const ledger = await json(`scripts/data/owner-selections/${id}.json`);
  assert.equal(ledger.sourceProvider, 'owner-authored');
  assert.equal(ledger.sourceOrigin, sourceOrigin);
  assert.deepEqual(ledger.selections.map((selection) => selection.sourcePosition), [1, 2, 3, 4, 5]);
  assert.equal(ledger.selections[2].suppliedTitle, 'Daredevil by Ed Brubaker Vol. 1: Out');
  assert.equal(ledger.ownerExpansion.decision, 'Include both');
  assert.equal(ledger.ownerExpansion.selectionPosition, 3);
  assert.match(ledger.ownerExpansion.evidenceUrl, /issues\/681#issuecomment-\d+$/);
  const expanded = ledger.selections.flatMap((selection) => selection.collections);
  assert.deepEqual(expanded.map((collection) => collection.writer), [
    'Frank Miller', 'Frank Miller', 'Brian Michael Bendis',
    'Ed Brubaker', 'Chip Zdarsky', 'Chip Zdarsky',
  ]);
  assert.deepEqual(expanded.map((collection) => collection.issueIds.length), [5, 7, 9, 6, 5, 5]);
  assert.deepEqual(expanded.flatMap((collection) => collection.issueIds), expectedIds);
  assert.deepEqual(expanded.flatMap((collection) => collection.issueNumbers),
    expectedRows.map((row) => row.number));
  assert.equal(ledger.sourceOccurrenceCount, 37);
  assert.deepEqual(ledger.publishedIssueIds, expectedIds);
  assert.deepEqual(ledger.sourceGaps, []);
  assert.equal(new Set(expectedIds).size, 37);
  assert.match(expanded[1].normalizationNote, /exactly seven.+227-233/);
  assert.match(expanded[5].normalizationNote, /distributor prints.+2018.+series 26080.+2019/);
});

test('owner Daredevil packet and mapping bind the exact identity and collection order', async () => {
  const { ledger, packet, mapping } = await evidence();
  assert.doesNotThrow(() => validateFrozenPacket(packet, { expectedId: id, provider }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.equal(packet.sourceContentSha256, digestCanonicalJson(ledger));
  assert.equal(packet.sourceIssueBearingBlocksSha256, digestCanonicalJson(ledger.selections));
  assert.equal(mapping.packetDigest, packet.packetDigest);
  assert.deepEqual(packet.rows.map((row) => row.candidateIssueId), expectedIds);
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), expectedIds);
  for (const [index, expected] of expectedRows.entries()) {
    const row = mapping.rows[index];
    assert.deepEqual(
      [row.sourcePosition, row.sourceSelectionPosition, row.sourceGroup,
        row.seriesYear, row.seriesId, row.issueNumber, row.resolvedIssueTitle],
      [index + 1, expected.selectionPosition, expected.part,
        expected.seriesYear, expected.seriesId, expected.number, expected.title],
    );
    assert.equal(row.resolutionStatus, 'exact');
    assert.equal(row.sourceIssueReference, expected.title);
    assert.equal(packet.rows[index].sourceSelectionPosition, expected.selectionPosition);
    assert.equal(packet.rows[index].sourceRangeReference, expected.part);
    assert.match(row.marvelIssueUrl, new RegExp(`/comics/issue/${expected.issueId}/`));
  }
  assert.equal(packet.expectedCount, 37);
  assert.equal(mapping.approvedSourceCount, 37);
  assert.deepEqual(packet.sourceGaps ?? [], []);
  assert.deepEqual(mapping.sourceGaps ?? [], []);
});

test('owner Daredevil frozen approvals remain valid across the complete current library', async () => {
  const { ledger, packet, mapping, report } = await evidence();
  const [catalog, manifest] = await Promise.all([
    json('src/data/catalog.json'), json('src/data/curated-lists.json'),
  ]);
  const byId = new Map(catalog.lists.map((entry) => [entry.id, entry]));
  const visible = ledger.libraryReview.visibleOrderIds.map((orderId) => {
    const entry = byId.get(orderId);
    assert.ok(entry, `reviewed visible order ${orderId} is missing`);
    return { ...entry, out: entry.file };
  });
  const retained = ledger.libraryReview.retainedNoncatalogOrderIds.map((orderId) => {
    const entry = manifest.lists.find((candidate) => candidate.id === orderId);
    assert.ok(entry, `reviewed retained order ${orderId} is missing`);
    return entry;
  });
  const entries = [...visible, ...retained];
  const orders = await Promise.all(entries.map(async (entry) => ({
    orderId: entry.id,
    issueIds: issueIdsFromValue(await json(`src/data/${entry.out}`)),
  })));
  const currentLibraryDigest = libraryDigestFor(
    { lists: entries, paths: ledger.libraryReview.paths },
    orders.map((order) => ({ id: order.orderId, issueIds: order.issueIds })),
  );
  const actual = buildComparisonReport({ candidateIds: expectedIds, orders });
  assert.equal(visible.length, 280);
  assert.deepEqual(retained.map((entry) => entry.id), ['marvel-knights-to-planet-x']);
  assert.equal(report.comparisonCount, 281);
  assert.deepEqual(report.comparisons, actual.comparisons);
  assert.equal(report.libraryDigest, currentLibraryDigest);
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest,
    expectedOrderIds: entries.map((entry) => entry.id),
    packetValidation: { provider },
  }));
  assert.deepEqual(
    report.comparisons.filter((comparison) => comparison.relationship !== 'none')
      .map((comparison) => [comparison.orderId, comparison.relationship, comparison.sharedIds]),
    [
      ['daredevil-reading-order', 'candidate-subset', expectedIds.map(String)],
      ['iron-fist-reading-order', 'partial',
        [15640, 15641, 15643, 3482, 3946, 4070, 4183, 4284, 4439].map(String)],
      ['marvel-knights-to-planet-x', 'partial', collections[2][6].map(String)],
      ['marvel-knights-to-planet-x-26', 'existing-subset', collections[2][6].map(String)],
    ],
  );
  assert.ok(mapping.relationshipReview.dispositions
    .filter((disposition) => disposition.relationship !== 'none')
    .every((disposition) => disposition.authorityType === 'human'
      && disposition.authorityIdentity === 'raymond-nassar'));
  const reviewed = new Set(entries.map((entry) => entry.id));
  const later = catalog.lists.filter((entry) => entry.id !== id && !reviewed.has(entry.id));
  assert.deepEqual(later.map((entry) => entry.id),
    ['mcu-prep-thunderbolts', 'mcu-prep-moon-knight',
      'mcu-prep-eternals', 'mcu-prep-deadpool-and-wolverine']);
  assert.deepEqual(manifest.lists.filter((entry) => entry.catalog === false)
    .map((entry) => entry.id), retained.map((entry) => entry.id));
  const laterOrders = await Promise.all(later.map(async (entry) => ({
    orderId: entry.id,
    issueIds: issueIdsFromValue(await json(`src/data/${entry.file}`)),
  })));
  const current = buildComparisonReport({ candidateIds: expectedIds, orders: [...orders, ...laterOrders] });
  assert.equal(current.comparisonCount, 285);
  const activePeerIds = [...new Set([...manifest.lists, ...catalog.lists].map((entry) => entry.id))]
    .filter((peerId) => peerId !== id).sort();
  assert.deepEqual(current.comparisons.map((entry) => entry.orderId).sort(), activePeerIds);
  assert.equal(activePeerIds.includes('spider-man-no-way-home-owner-selected'), false);
  assert.equal(current.comparisons.filter((entry) => entry.relationship === 'none').length, 281);
  assert.deepEqual(current.comparisons.filter((entry) => entry.relationship !== 'none'),
    report.comparisons.filter((entry) => entry.relationship !== 'none'));
  assert.deepEqual(current.comparisons.filter((entry) => later.some((peer) => peer.id === entry.orderId))
    .map((entry) => [entry.relationship, entry.sharedIds]), later.map(() => ['none', []]));
});

test('owner Daredevil checklist and pinned payload publish all 37 originals in six parts', async () => {
  const [markdown, payload] = await Promise.all([
    readFile(path.join(root, 'src', 'data', 'orders', `${id}.md`), 'utf8'),
    json('src/data/mcu_prep_daredevil_born_again.json'),
  ]);
  const parsed = parseChecklist(markdown);
  assert.deepEqual(parsed.entries.map((row) => row.issueId), expectedIds);
  assert.deepEqual(parsed.entries.map((row) => row.title), expectedRows.map((row) => row.title));
  assert.deepEqual(parsed.entries.map((row) => row.section), expectedRows.map((row) => row.part));
  assert.deepEqual(parsed.unresolved, []);
  assert.deepEqual(payload.items.map((row) => row.issueId), expectedIds);
  assert.deepEqual(payload.items.map((row) => row.title), expectedRows.map((row) => row.title));
  assert.deepEqual(payload.items.map((row) => row.number), expectedRows.map((row) => row.number));
  assert.deepEqual(payload.items.map((row) => row.seriesId), expectedRows.map((row) => row.seriesId));
  assert.deepEqual(payload.items.map((row) => row.collectedIn), expectedRows.map((row) => row.part));
  assert.deepEqual([payload.count, payload.collections, payload.placeholders], [37, 6, 0]);
  assert.deepEqual(payload.unresolved, []);
  assert.equal(payload.sourceOrigin, sourceOrigin);
  assert.equal(payload.sourceLicense, null);
  assert.ok(payload.items.every((row) => row.description === null && !row.detailsRefused));
  const ledger = await json(`scripts/data/owner-selections/${id}.json`);
  assert.equal(ledger.metadataPublication.payloadSha256, digestCanonicalJson(payload));
  assert.deepEqual(ledger.metadataPublication.lookupEndpoints,
    expectedIds.map((issueId) => `${payload.apiBase}/issues/${issueId}`));
  assert.deepEqual(ledger.metadataPublication.detailRefusals, []);
  assert.deepEqual(ledger.metadataPublication.missingDigitalIds, []);
  assert.deepEqual(ledger.metadataPublication.missingCoverIds, []);
  assert.deepEqual(ledger.metadataPublication.missingCreatorCreditIds,
    payload.items.filter((row) => row.creators.length === 0).map((row) => row.issueId));
  assert.equal(ledger.metadataPublication.missingCreatorCreditIds.length, 12);
  assert.doesNotMatch(markdown, /[\u2013\u2014]/);
});

test('owner Daredevil remains one owner-credited MCU Prep card outside Character Spotlight', async () => {
  const [manifest, rawCatalog] = await Promise.all([
    json('src/data/curated-lists.json'), json('src/data/catalog.json'),
  ]);
  assert.deepEqual(parseManifest(manifest).errors, []);
  const entry = manifest.lists.find((candidate) => candidate.id === id);
  assert.ok(entry, 'owner-authored manifest entry is missing');
  const catalog = parseCatalog(rawCatalog);
  const cards = catalog.lists.filter((candidate) => candidate.id === id);
  assert.equal(cards.length, 1);
  assert.equal(Object.hasOwn(entry, 'spotlightKind'), false);
  assert.equal(Object.hasOwn(rawCatalog.lists.find((candidate) => candidate.id === id), 'spotlightKind'), false);
  for (const card of [entry, cards[0]]) {
    assert.deepEqual([card.type, card.depth, card.timeline, card.beginner],
      ['screen-companion', 'selected', null, false]);
    assert.equal(card.spotlightKind ?? null, null);
    assert.equal(card.sourceOrigin, sourceOrigin);
    assert.equal(card.sourceLicense, null);
    assert.doesNotMatch(card.description, /[\u2013\u2014]|direct.*adapt|becomes? mayor/i);
  }
  assert.equal(cards[0].count, 37);
  const category = HOME_CATEGORIES.find((candidate) => candidate.key === 'marvel-on-screen');
  const selected = category.select(groupCatalog(catalog.lists)).map((story) => story.lists[0].id);
  assert.deepEqual(selected, [
    'doctor-strange-multiverse-of-madness', 'spider-man-no-way-home', 'marvel-multiverse',
    'marvel-what-if', 'wandavision', 'spider-man-far-from-home', 'mcu-prep-thunderbolts',
    'mcu-prep-eternals', 'mcu-prep-deadpool-and-wolverine', id,
  ]);
  assert.equal(shelfLists(catalog.lists, 'spotlights').some((card) => card.id === id), false);
  assert.equal(catalog.paths.some((readingPath) => readingPath.steps.includes(id)), false);
});
