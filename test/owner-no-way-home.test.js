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
  catalogEntries,
  HOME_CATEGORIES,
  parseCatalog,
  shelfLists,
} from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  exportBackup,
  isRead,
  listForCatalogId,
  listItems,
  migrate,
} from '../src/js/lib/model.js';
import { Store, KEY } from '../src/js/storage.js';
import { importedNoWayHomeFixture } from './helpers/owner-no-way-home-import.mjs';
import { historicalReadingChoiceIssueIds } from './helpers/reading-choice-history.mjs';

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

async function loadArchive() {
  const manifest = await readJson('src', 'data', 'curated-lists.json');
  const catalog = parseCatalog(await readJson('src', 'data', 'catalog.json'));
  const packet = await readJson('scripts', 'data', 'owner-mcu-prep', `${ownerId}.packet.json`);
  const entry = packet.proposedManifest;
  assert.equal(entry.id, ownerId);
  const payload = await readJson('src', 'data', entry.out);
  return { manifest, catalog, entry, payload };
}

test('owner No Way Home expands three standard collections to 18 ordered originals', async () => {
  const { entry, payload } = await loadArchive();
  const markdown = await readFile(path.join(root, 'src', 'data', 'orders', entry.sourceFile), 'utf8');
  const checklist = parseChecklist(markdown);
  assert.deepEqual(checklist.entries.map(({ issueId }) => issueId), expectedIds);
  assert.deepEqual(payload.items.map(({ issueId }) => issueId), expectedIds);
  assert.deepEqual(checklist.unresolved, []);
  assert.deepEqual(payload.unresolved, []);
  assert.equal(payload.placeholders, 0);
  assert.equal(entry.expect, 18);
  assert.equal(payload.count, 18);
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
  const { manifest, catalog, entry, payload } = await loadArchive();
  const legacyEntry = manifest.lists.find(({ id }) => id === legacyId);
  const legacyCard = catalog.lists.find(({ id }) => id === legacyId);
  assert.ok(legacyEntry);
  assert.ok(legacyCard);
  assert.equal(legacyEntry.out, 'spider_man_no_way_home.json');
  assert.equal(legacyEntry.name, 'Spider-Man: No Way Home');
  assert.match(legacyEntry.sourceOrigin, /Comic Book Herald/);
  assert.equal(legacyCard.count, 17);
  for (const [file, expected] of [
    ['spider_man_no_way_home.json', '3adc2c9972ac801950183fdbaf08bb7de298f47b1ee3b8fe377c109a3161aae5'],
    [path.join('orders', 'spider-man-no-way-home.md'), '5d4ecf1e085ed2480e778707315631d93c539c60de2ef2fbf08814609da1179b'],
    ['spider_man_no_way_home_owner_selected.json', '7d6eadd3d92da6ae4048b3d5711f29803c4edfea2f7ec250f382817e1b7b937c'],
    [path.join('orders', 'spider-man-no-way-home-owner-selected.md'), '03db2728489533d09ed73eaf9575c0cd4e5d5329aabf984039669a109ff72c44'],
  ]) {
    const text = await readFile(path.join(root, 'src', 'data', file), 'utf8');
    assert.equal(createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex'),
      expected, `${file}: frozen source changed`);
  }
  const legacy = await readJson('src', 'data', legacyEntry.out);
  assert.deepEqual(legacy.items.map(({ issueId }) => issueId), expectedLegacyIds);
  assert.equal(compareIssueSets(expectedIds, expectedLegacyIds).relationship, 'none');
  assert.equal(entry.name, 'Spider-Man: No Way Home (Owner selections)');
  assert.equal(entry.sourcePage, 'https://github.com/raymond-nassar/recap-page/issues/686');
  assert.equal(payload.source, entry.sourcePage);
  assert.match(entry.sourceOrigin, /owner/i);
  assert.doesNotMatch(entry.sourceOrigin, /Comic Book Herald/);
  assert.match(payload.sourceOrigin, /owner/i);
  for (const published of [entry]) {
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
});

test('owner No Way Home withdrawal leaves only the original guide in new discovery', async () => {
  const { manifest, catalog, payload } = await loadArchive();
  assert.equal(manifest.lists.some(({ id }) => id === ownerId), false);
  assert.equal(catalog.lists.some(({ id }) => id === ownerId), false);
  assert.equal(manifest.lists.filter(({ id }) => id === legacyId).length, 1);
  assert.equal(catalog.lists.filter(({ id }) => id === legacyId).length, 1);
  const stories = catalogEntries(catalog.lists);
  const definition = HOME_CATEGORIES.find(({ key }) => key === 'marvel-on-screen');
  assert.equal(definition.heading, 'MCU Prep');
  assert.equal(definition.route, 'marvel-on-screen');
  const screenIds = definition.select(stories).flatMap(({ lists }) => lists.map(({ id }) => id));
  assert.equal(screenIds.filter((id) => id === ownerId).length, 0);
  assert.equal(screenIds.filter((id) => id === legacyId).length, 1);
  assert.ok(availableHomeCategories(stories).some(({ key }) => key === 'marvel-on-screen'));
  assert.deepEqual(CATALOG_SHELVES.map(({ key }) => key), ['catalog', 'lines', 'spotlights']);
  for (const { key } of CATALOG_SHELVES) {
    assert.equal(shelfLists(catalog.lists, key).some(({ id }) => id === ownerId), false);
  }
  assert.equal(shelfLists(catalog.lists, 'lines').filter(({ id }) => id === legacyId).length, 1);
  assert.ok(!manifest.paths.some(({ steps }) => steps.includes(ownerId)));
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
  assert.equal(peers.has(ownerId), false, 'Archived evidence must not become an active descriptor');
  const orders = [...peers.values()];
  const report = buildComparisonReport({ candidateIds: payload.items.map(({ issueId }) => issueId), orders });
  assert.equal(report.comparisonCount, peers.size);
  assert.deepEqual(report.comparisons.map(({ orderId }) => orderId),
    [...peers.keys()].sort((left, right) => left.localeCompare(right)));
  assert.equal(report.comparisons.filter(({ orderId }) => orderId === 'marvel-knights-to-planet-x').length, 1,
    'Complete-library review must include the retained hidden partition parent');
});

test('retired owner No Way Home imports survive reload without changing saved bytes or backups', async () => {
  const { manifest, payload } = await loadArchive();
  const legacyEntry = manifest.lists.find(({ id }) => id === legacyId);
  const legacy = await readJson('src', 'data', legacyEntry.out);
  const fixture = importedNoWayHomeFixture({ owner: payload, legacy });
  const bytes = new Map(Object.entries(fixture.keys));
  const storage = {
    getItem: (key) => bytes.get(key) ?? null,
    setItem: (key) => assert.fail(`Reload unexpectedly wrote ${key}`),
    removeItem: (key) => assert.fail(`Reload unexpectedly removed ${key}`),
  };
  for (let reload = 0; reload < 2; reload += 1) {
    const store = new Store({ storage });
    const reloaded = store.load();
    assert.equal(store.blocked, false);
    assert.equal(bytes.get(KEY), fixture.raw);
    assert.deepEqual(Object.fromEntries(bytes), fixture.keys);
    assert.deepEqual(reloaded.lists, fixture.state.lists);
    assert.deepEqual(reloaded.issues, fixture.state.issues);
    assert.deepEqual(reloaded.listOrder, fixture.state.listOrder);
    assert.equal(reloaded.active, 'retired-import');
    assert.deepEqual(reloaded.read, fixture.state.read);
    assert.deepEqual(reloaded.notes, fixture.state.notes);
    assert.deepEqual(reloaded.overrides, fixture.state.overrides);
    const saved = listForCatalogId(reloaded, ownerId);
    assert.equal(saved.id, 'retired-import');
    assert.deepEqual(saved.itemIds, expectedIds);
    assert.deepEqual(
      listItems(reloaded, saved.id).map(({ issueId, collectedIn }) => [issueId, collectedIn]),
      payload.items.map(({ issueId, collectedIn }) => [issueId, collectedIn]),
    );
    assert.ok(isRead(reloaded, expectedLegacyIds[0]));
    assert.ok(isRead(reloaded, expectedIds[0]));
    assert.deepEqual({ ...exportBackup(reloaded), exportedAt: fixture.backup.exportedAt }, fixture.backup);
    assert.deepEqual(migrate(fixture.backup).lists, reloaded.lists);
  }
});

test('owner No Way Home provenance preserves every selection, exact lookup and edition boundary', async () => {
  const { entry, payload } = await loadArchive();
  const packet = await readJson('scripts', 'data', 'owner-mcu-prep', `${ownerId}.packet.json`);
  const mapping = await readJson('scripts', 'data', 'owner-mcu-prep', `${ownerId}.mapping.json`);
  assert.equal(packet.packetDigest, packetDigestFor(packet));
  assert.equal(packet.packetDigest, '7ace7b7df104993c65b7375234bd93f6fc0335c19a55fc7d61f70acc5cd2acfc');
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.equal(mapping.mappingDigest, '446fd4bca140b80beed361491559286b62d8e9efca9f8bbf65fb3164e3076865');
  assert.equal(mapping.packetDigest, packet.packetDigest);
  assert.equal(packet.sourceProvider, 'owner-selected');
  assert.equal(mapping.sourceProvider, packet.sourceProvider);
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

test('archived owner No Way Home approval binds the actual packet, mapping and exact original cohort', async () => {
  const { catalog, payload } = await loadArchive();
  const packet = await readJson('scripts', 'data', 'owner-mcu-prep', `${ownerId}.packet.json`);
  const mapping = await readJson('scripts', 'data', 'owner-mcu-prep', `${ownerId}.mapping.json`);
  const report = await readJson('scripts', 'data', 'owner-mcu-prep', `${ownerId}.overlap.json`);
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => validateApprovalDigest(report.relationshipReview, ownerId));
  assert.equal(report.reportDigest, 'a5f97c22866a2a4db8c2c3c5bb65f2641c32d58e3a805cf44a54a911fec5409c');
  assert.equal(report.relationshipReview.approvalDigest,
    'bff8fcaf07ea991e0979dec44a6e32a096fd74e474554e71031140a6fba8a1ec');
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
    issueIds: historicalReadingChoiceIssueIds(peer.id,
      (await readJson('src', 'data', peer.file)).items.map(({ issueId }) => String(issueId))),
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
  assert.deepEqual(partials.map(({ orderId, relationship, sharedCount }) => [orderId, relationship, sharedCount]),
    [...reviewedPartials].map(([id, sharedCount]) => [id, 'partial', sharedCount]));
  assert.deepEqual(
    report.relationshipReview.approvals.map(({ orderId, relationship, sharedCount, sharedIds }) => (
      { orderId, relationship, sharedCount, sharedIds }
    )),
    partials,
  );
  assert.ok(report.relationshipReview.approvals.every(({ approved }) => approved === true));
});
