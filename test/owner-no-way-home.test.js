import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildComparisonReport, compareIssueSets } from '../scripts/lib/cbh-overlap.mjs';
import {
  digestCanonicalJson,
  packetDigestFor,
  validateApprovalDigest,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { loadLibrarySnapshot } from '../scripts/report-order-overlap.mjs';
import {
  availableHomeCategories,
  CATALOG_SHELVES,
  groupCatalog,
  HOME_CATEGORIES,
  parseCatalog,
  shelfLists,
} from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  addIssuesToList,
  createEmptyState,
  createList,
  isRead,
  markRead,
  migrate,
  setListNote,
} from '../src/js/lib/model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ownerId = 'spider-man-no-way-home-owner-selected';
const legacyId = 'spider-man-no-way-home';
const expectedIds = [
  4372, 14846, 14857, 14868, 14879, 14890, 14901,
  45808, 45809, 45810, 45811, 50350, 51320, 51324,
  34135, 30324, 30325, 30326,
];
const expectedSections = [
  'Ultimate Spider-Man Vol. 1: Power and Responsibility',
  'Amazing Spider-Man Vol. 3: Spider-Verse',
  'Spider-Man: Big Time',
];
const expectedLegacyIds = [
  43170, 43171, 277, 5960, 6174, 6323, 15806, 15924, 6017,
  6089, 6225, 13444, 15828, 15945, 20798, 13498, 67330,
];
const reviewedPartials = new Map([
  ['amazing-spider-man-reading-order-modern-marvel-era', 10],
  ['doctor-octopus-otto-octavius-reading-order', 7],
  ['miles-morales-spider-man-reading-order', 7],
  ['spider-gwen-reading-order', 7],
  ['spider-verse', 7],
  ['ultimate-marvel-intro', 7],
  ['ultimate-spider-man-reading-order', 7],
]);

async function readJson(...parts) {
  return JSON.parse(await readFile(path.join(root, ...parts), 'utf8'));
}

async function loadPublication() {
  const manifest = await readJson('src', 'data', 'curated-lists.json');
  const catalog = parseCatalog(await readJson('src', 'data', 'catalog.json'));
  const entry = manifest.lists.find(({ id }) => id === ownerId);
  assert.ok(entry, 'The separately identified owner selection is missing from the manifest');
  const card = catalog.lists.find(({ id }) => id === ownerId);
  assert.ok(card, 'The separately identified owner selection is missing from the catalog');
  const payload = await readJson('src', 'data', entry.out);
  return { manifest, catalog, entry, card, payload };
}

test('owner No Way Home expands three standard collections to 18 ordered originals', async () => {
  const { entry, card, payload } = await loadPublication();
  const markdown = await readFile(path.join(root, 'src', 'data', 'orders', entry.sourceFile), 'utf8');
  const checklist = parseChecklist(markdown);
  assert.deepEqual(checklist.entries.map(({ issueId }) => issueId), expectedIds);
  assert.deepEqual(payload.items.map(({ issueId }) => issueId), expectedIds);
  assert.deepEqual(checklist.unresolved, []);
  assert.deepEqual(payload.unresolved, []);
  assert.equal(payload.placeholders, 0);
  assert.equal(entry.expect, 18);
  assert.equal(card.count, 18);
  assert.deepEqual(
    checklist.sourcePositions.map(({ ordinal, section, count }) => [ordinal, section, count]),
    expectedSections.map((section, index) => [index + 1, section, [7, 7, 4][index]]),
  );
  assert.deepEqual(
    payload.items.map(({ collectedIn }) => collectedIn),
    [
      ...Array(7).fill(expectedSections[0]),
      ...Array(7).fill(expectedSections[1]),
      ...Array(4).fill(expectedSections[2]),
    ],
  );
  assert.deepEqual(
    payload.items.map(({ number }) => String(number)),
    ['1', '2', '3', '4', '5', '6', '7', '9', '10', '11', '12', '13', '14', '15', '648', '649', '650', '651'],
  );
  assert.deepEqual(
    payload.items.map(({ seriesId }) => seriesId),
    [...Array(7).fill(466), ...Array(7).fill(17285), ...Array(4).fill(454)],
  );
  for (const [index, issue] of payload.items.entries()) {
    const writer = index < 7 ? 'Brian Michael Bendis' : 'Dan Slott';
    assert.ok(issue.creators.some(({ name, role }) => name === writer && role === 'writer'));
    assert.ok(issue.digitalId > 0);
    assert.ok(issue.cover);
    assert.equal(issue.placeholder, undefined);
  }
});

test('owner No Way Home keeps source authority and the existing companion identity distinct', async () => {
  const { manifest, catalog, entry, card, payload } = await loadPublication();
  const legacyEntry = manifest.lists.find(({ id }) => id === legacyId);
  const legacyCard = catalog.lists.find(({ id }) => id === legacyId);
  assert.ok(legacyEntry);
  assert.ok(legacyCard);
  assert.equal(legacyEntry.out, 'spider_man_no_way_home.json');
  assert.equal(legacyEntry.name, 'Spider-Man: No Way Home');
  assert.match(legacyEntry.sourceOrigin, /Comic Book Herald/);
  assert.equal(legacyCard.count, 17);
  const legacy = await readJson('src', 'data', legacyEntry.out);
  assert.deepEqual(legacy.items.map(({ issueId }) => issueId), expectedLegacyIds);
  assert.equal(compareIssueSets(expectedIds, expectedLegacyIds).relationship, 'none');
  assert.equal(entry.name, 'Spider-Man: No Way Home (Owner selections)');
  assert.equal(entry.sourcePage, 'https://github.com/raymond-nassar/recap-page/issues/686');
  assert.equal(card.source, entry.sourcePage);
  assert.match(entry.sourceOrigin, /owner/i);
  assert.doesNotMatch(entry.sourceOrigin, /Comic Book Herald/);
  assert.match(payload.sourceOrigin, /owner/i);
  for (const published of [entry, card]) {
    assert.equal(published.type, 'screen-companion');
    assert.equal(published.depth, 'selected');
    assert.equal(published.timeline, null);
    assert.equal(published.beginner, false);
    assert.equal(published.group, null);
    assert.equal(published.groupName, null);
    assert.equal(published.variant, null);
    assert.doesNotMatch(published.description, /borrows|wholesale|direct(?:ly)? inspir|Sinister Six/i);
    assert.doesNotMatch(`${published.name} ${published.description}`, /[\u2013\u2014]/);
  }
  assert.equal(Object.hasOwn(entry, 'spotlightKind'), false);
  assert.equal(card.spotlightKind, null);
});

test('owner No Way Home reaches MCU Prep and Storylines without an exact duplicate', async () => {
  const { catalog, card, payload } = await loadPublication();
  const stories = groupCatalog(catalog.lists);
  const definition = HOME_CATEGORIES.find(({ key }) => key === 'marvel-on-screen');
  assert.equal(definition.heading, 'MCU Prep');
  assert.equal(definition.route, 'marvel-on-screen');
  const screenIds = definition.select(stories).flatMap(({ lists }) => lists.map(({ id }) => id));
  assert.equal(screenIds.filter((id) => id === ownerId).length, 1);
  assert.equal(screenIds.filter((id) => id === legacyId).length, 1);
  assert.ok(availableHomeCategories(stories).some(({ key }) => key === 'marvel-on-screen'));
  assert.deepEqual(CATALOG_SHELVES.map(({ key }) => key), ['catalog', 'lines', 'spotlights']);
  assert.ok(shelfLists(catalog.lists, 'lines').includes(card));
  assert.ok(!shelfLists(catalog.lists, 'spotlights').includes(card));
  assert.ok(!shelfLists(catalog.lists, 'catalog').includes(card));
  assert.ok(!catalog.paths.some(({ steps }) => steps.includes(ownerId)));
  const visibleOrders = await Promise.all(catalog.lists.map(async (peer) => ({
    orderId: peer.id,
    issueIds: (await readJson('src', 'data', peer.file)).items.map(({ issueId }) => String(issueId)),
  })));
  const sourceLibrary = await loadLibrarySnapshot();
  const peers = new Map(sourceLibrary.orders.map((order) => [order.orderId, order]));
  for (const order of visibleOrders) {
    if (peers.has(order.orderId)) {
      assert.deepEqual(order.issueIds, peers.get(order.orderId).issueIds,
        `${order.orderId}: visible and source-manifest vectors disagree`);
    } else {
      peers.set(order.orderId, order);
    }
  }
  const orders = [...peers.values()].filter(({ orderId }) => orderId !== ownerId);
  const report = buildComparisonReport({ candidateIds: payload.items.map(({ issueId }) => issueId), orders });
  assert.equal(report.comparisonCount, peers.size - 1);
  assert.equal(report.comparisons.filter(({ orderId }) => orderId === 'marvel-knights-to-planet-x').length, 1,
    'Complete-library review must include the retained hidden partition parent');
  assert.deepEqual(report.comparisons.filter(({ relationship }) => relationship === 'exact'), []);
  assert.deepEqual(
    report.comparisons.filter(({ relationship }) => relationship !== 'none')
      .map(({ orderId, relationship, sharedCount }) => [orderId, relationship, sharedCount]),
    [...reviewedPartials].map(([id, sharedCount]) => [id, 'partial', sharedCount]),
    'Any new meaningful relationship needs central review, not inherited approval',
  );
  for (const [id, sharedCount] of reviewedPartials) {
    const comparison = report.comparisons.find(({ orderId }) => orderId === id);
    assert.equal(comparison.relationship, 'partial');
    assert.equal(comparison.sharedCount, sharedCount);
  }
});

test('owner No Way Home import retains both catalog identities, existing progress and collection order', async () => {
  const { manifest, entry, payload } = await loadPublication();
  const legacyEntry = manifest.lists.find(({ id }) => id === legacyId);
  const legacy = await readJson('src', 'data', legacyEntry.out);
  let state = createList(createEmptyState(), { id: 'existing', name: legacyEntry.name, catalogId: legacyId });
  state = addIssuesToList(state, 'existing', legacy.items).state;
  state = setListNote(state, 'existing', 'My existing reading notes');
  state = markRead(state, expectedLegacyIds[0], true, 1700000000000);
  state = markRead(state, expectedIds[0], true, 1700000000001);
  const savedLegacy = structuredClone(state.lists.existing);
  state = createList(state, { id: 'owner', name: entry.name, catalogId: ownerId });
  const imported = addIssuesToList(state, 'owner', payload.items);
  assert.equal(imported.added, 18);
  assert.equal(imported.skipped, 0);
  const reloaded = migrate(JSON.parse(JSON.stringify(imported.state)));
  assert.deepEqual(reloaded.lists.existing, savedLegacy);
  assert.equal(reloaded.lists.owner.catalogId, ownerId);
  assert.deepEqual(reloaded.lists.owner.itemIds, expectedIds);
  assert.ok(isRead(reloaded, expectedLegacyIds[0]));
  assert.ok(isRead(reloaded, expectedIds[0]));
  assert.deepEqual(
    expectedIds.map((id) => reloaded.lists.owner.collectedIn[id]),
    payload.items.map(({ collectedIn }) => collectedIn),
  );
});

test('owner No Way Home provenance preserves every selection, exact lookup and edition boundary', async () => {
  const { entry, payload } = await loadPublication();
  const packet = await readJson('scripts', 'data', 'owner-mcu-prep', `${ownerId}.packet.json`);
  const mapping = await readJson('scripts', 'data', 'owner-mcu-prep', `${ownerId}.mapping.json`);
  assert.equal(packet.packetDigest, packetDigestFor(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.equal(mapping.packetDigest, packet.packetDigest);
  assert.equal(packet.sourceProvider, 'owner-selected');
  assert.equal(mapping.sourceProvider, packet.sourceProvider);
  assert.deepEqual(packet.proposedManifest, entry);
  assert.deepEqual(mapping.proposedManifest, entry);
  assert.equal(packet.sourceOccurrenceCount, 3);
  assert.equal(packet.expandedOriginalCount, 18);
  assert.deepEqual(packet.selections.map(({ sourcePosition }) => sourcePosition), [1, 2, 3]);
  assert.deepEqual(packet.selections.flatMap(({ selectedIssueIds }) => selectedIssueIds), expectedIds);
  assert.deepEqual(packet.selections.map(({ selectedIssueIds }) => selectedIssueIds.length), [7, 7, 4]);
  assert.deepEqual(packet.sourceGaps, []);
  assert.deepEqual(packet.metadataGaps, []);
  assert.deepEqual(packet.unidentifiedSelections, []);
  assert.equal(packet.editionDisposition.authorityType, 'coordinator-implementation');
  assert.deepEqual(mapping.rows, packet.rows);
  assert.deepEqual(mapping.rows.map(({ selectedIssueId }) => selectedIssueId), expectedIds);
  assert.deepEqual(mapping.rows.map(({ selectedTitle }) => selectedTitle), payload.items.map(({ title }) => title));
  assert.deepEqual(mapping.candidateMetadata.metadataGaps, []);
  assert.equal(mapping.candidateMetadata.detailResponses200, 18);
  for (const [index, row] of mapping.rows.entries()) {
    assert.equal(row.row, index + 1);
    assert.equal(row.resolutionStatus, 'exact');
    assert.equal(row.selectedSeriesId, payload.items[index].seriesId);
    assert.equal(row.issueNumber, payload.items[index].number);
    assert.equal(row.metadataEvidence.status, 200);
    assert.equal(row.metadataEvidence.issueId, row.selectedIssueId);
    assert.equal(row.metadataEvidence.url, `https://marvel.emreparker.com/v1/issues/${row.selectedIssueId}`);
    assert.equal(row.metadataEvidence.urlSha256, createHash('sha256').update(row.metadataEvidence.url).digest('hex'));
    assert.match(row.metadataEvidence.bodySha256, /^[a-f0-9]{64}$/);
    assert.equal(payload.items[index].description, null);
  }
  for (const selection of packet.selections) {
    const selected = payload.items.filter(({ issueId }) => selection.selectedIssueIds.includes(issueId));
    const creators = new Set(selected.flatMap(({ creators: credits }) => credits.map(({ name }) => name)));
    for (const name of [...selection.writerEvidence, ...selection.principalArtistEvidence]) {
      assert.ok(creators.has(name), `${selection.collectionTitle}: missing creator evidence for ${name}`);
    }
  }
  assert.equal(packet.selections[1].editionEvidence[0].isbn, '9780785192343');
  assert.equal(packet.selections[1].excludedEdition.isbn, '9780785190363');
  assert.equal(packet.selections[2].editionEvidence[0].isbn, '9780785146247');
  assert.equal(packet.selections[2].excludedEdition.isbn, '9780785162179');
  assert.equal(packet.selections[2].identityEvidence.issueId, 34135);
});

test('owner No Way Home human overlap approval binds the actual packet, mapping and full library', async () => {
  const { catalog, payload } = await loadPublication();
  const packet = await readJson('scripts', 'data', 'owner-mcu-prep', `${ownerId}.packet.json`);
  const mapping = await readJson('scripts', 'data', 'owner-mcu-prep', `${ownerId}.mapping.json`);
  const report = await readJson('scripts', 'data', 'owner-mcu-prep', `${ownerId}.overlap.json`);
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => validateApprovalDigest(report.relationshipReview, ownerId));
  assert.equal(report.packetDigest, packet.packetDigest);
  assert.equal(report.mappingDigest, mapping.mappingDigest);
  assert.equal(report.libraryDigest, digestCanonicalJson(report.librarySnapshot));
  assert.equal(report.relationshipReview.authorityType, 'human');
  assert.equal(report.relationshipReview.authorityIdentity, 'raymond-nassar');
  assert.equal(report.relationshipReview.evidenceUrl,
    'https://github.com/raymond-nassar/recap-page/issues/686#issuecomment-5971795523');
  for (const field of ['packetDigest', 'mappingDigest', 'reportDigest', 'libraryDigest']) {
    assert.equal(report.relationshipReview[field], report[field]);
  }
  assert.equal(report.comparisonCount, 280);
  assert.equal(report.librarySnapshot.entries.length, report.comparisonCount);
  const reviewedIds = new Set(report.librarySnapshot.entries.map(({ id }) => id));
  const orders = await Promise.all(catalog.lists.filter(({ id }) => reviewedIds.has(id)).map(async (peer) => ({
    orderId: peer.id,
    issueIds: (await readJson('src', 'data', peer.file)).items.map(({ issueId }) => String(issueId)),
  })));
  assert.equal(orders.length, reviewedIds.size);
  for (const order of orders) {
    assert.equal(report.peerDigests[order.orderId], digestCanonicalJson(order.issueIds));
  }
  const actual = buildComparisonReport({ candidateIds: payload.items.map(({ issueId }) => issueId), orders });
  assert.deepEqual(report.comparisons, actual.comparisons);
  assert.equal(report.comparisons.filter(({ relationship }) => relationship === 'none').length, 273);
  assert.deepEqual(report.comparisons.filter(({ relationship }) => /exact|subset/.test(relationship)), []);
  const partials = report.comparisons.filter(({ relationship }) => relationship === 'partial');
  assert.equal(partials.length, 7);
  assert.deepEqual(
    report.relationshipReview.approvals.map(({ orderId, relationship, sharedCount, sharedIds }) => (
      { orderId, relationship, sharedCount, sharedIds }
    )),
    partials,
  );
  assert.ok(report.relationshipReview.approvals.every(({ approved }) => approved === true));
});
