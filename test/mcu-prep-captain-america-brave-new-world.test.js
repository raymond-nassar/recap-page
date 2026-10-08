import test from 'node:test';
import { legacyOwnerPeers } from './helpers/current-reading-library.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences, digestCanonicalJson, libraryDigestFor,
  sourceCountsForPacket, validateFrozenPacket, validateMappingDigest, validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport } from '../scripts/lib/cbh-overlap.mjs';
import { resolveRow } from '../scripts/lib/cbh-resolution.mjs';
import { loadCurrentOwnerLibrary } from '../scripts/lib/owner-current-library.mjs';
import { catalogEntries, HOME_CATEGORIES, parseCatalog } from '../src/js/lib/catalog.js';
import {
  LIST_HISTORY_FORMAT, LIST_HISTORY_KEY, ListHistoryStore, parseListHistory,
} from '../src/js/lib/listHistory.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  addIssuesToList, createEmptyState, createList, exportBackup, markRead, normalizeCover,
  SCHEMA_VERSION, setDeferred, setIssueNote, validateBackup,
} from '../src/js/lib/model.js';
import { KEY } from '../src/js/storage.js';

const text = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const json = async (file) => JSON.parse(await text(file));
const fixture = await json('test/fixtures/mcu-prep-captain-america-brave-new-world-vector.json');
const { id, groups, sourceUrl } = fixture;
const expectedIds = fixture.rows.map((row) => row[1]);
const expectedPositions = fixture.rows.map((row) => row[0]);
const expectedGroups = fixture.rows.map((row) => groups[row[3]]);
const sourceFile = `scripts/data/owner-selections/${id}.json`;
const provider = {
  id: 'owner-authored', hosts: ['github.com'], sourceOrigin: 'Selected by raymond-nassar for MCU Prep',
};
const hashText = (value) => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
const evidence = async () => {
  const [source, packet, mapping, report] = await Promise.all([
    json(sourceFile), json(`scripts/data/owner-packets/${id}.json`),
    json(`scripts/data/owner-mappings/${id}.json`), json(`scripts/data/owner-overlaps/${id}.json`),
  ]);
  return { source, packet, mapping, report };
};

test('Brave New World retains nineteen exact originals, dated editions and genuine metadata receipts', async () => {
  const { source, packet, mapping } = await evidence();
  assert.deepEqual(expectedIds, [
    17623, 20668, 20863, 20999, 21535, 21968, 5815, 51053, 51238, 51240,
    51243, 51245, 51246, 56549, 56554, 56557, 56558, 56559, 56560,
  ]);
  assert.equal(hashText(JSON.stringify(expectedIds)), fixture.vectorSha256);
  assert.deepEqual([source.selectionCount, source.sourceIssueCount, source.publishedIssueCount], [3, 19, 19]);
  assert.deepEqual(source.sourceGroupCounts, [7, 6, 6]);
  assert.deepEqual(source.publishedGroupCounts, [7, 6, 6]);
  assert.deepEqual(source.rows.map((row) => row.sourcePosition), expectedPositions);
  assert.deepEqual(source.rows.map((row) => row.originalIssueId), expectedIds);
  assert.deepEqual(source.rows.map((row) => row.selectedIssueId), expectedIds);
  assert.deepEqual(source.selections.map((row) => row.writer), ['Jeph Loeb', 'Rick Remender', 'Nick Spencer']);
  assert.deepEqual(source.selections.map((row) => row.referenceEdition.isbn13),
    ['9780785128823', '9780785192329', '9780785196402']);
  assert.deepEqual(source.selections.map((row) => row.referenceEdition.publicationYear), [2009, 2016, 2016]);
  assert.deepEqual(source.selections.slice(0, 2).map((row) => row.sameFirstVolumeEdition.isbn13),
    ['9780785128816', '9780785193760']);
  assert.deepEqual(source.selections.slice(0, 2).map((row) => row.sameFirstVolumeEdition.publicationYear),
    [2008, 2015]);
  assert.equal(source.sourceUrl, sourceUrl);
  assert.equal(source.sourceRetrievedAt, '2026-10-03');
  assert.equal(source.readerDescription, fixture.description);
  assert.equal(source.editorialOrder.physicalTocVerified, false);
  assert.equal(source.editorialOrder.independentPhysicalPageOrderClaimed, false);
  assert.equal(source.editorialOrder.addedPreludeOrLaterRevealOriginals, false);
  assert.equal(source.editorialOrder.substitutedRun, false);
  assert.equal(source.selections[0].contents[1].materialOnly, true);
  const backup = source.wholeOriginalIdentityContract;
  assert.deepEqual([backup.originalIssueId, backup.sourcePosition, backup.selectedMaterial],
    [5815, 7, 'Puny Little Man backup']);
  assert.match(backup.wholeIssueQualification, /backup.*full original issue, including unrelated lead material/);
  assert.equal(backup.readerScope, 'whole-original');
  assert.equal(backup.qualificationScope, 'guide');
  assert.equal(backup.perStoryIdsAllowed, false);
  assert.equal(backup.progressOrUserNoteMutationAllowed, false);
  assert.equal(backup.globalMetadataOverrideAllowed, false);
  assert.ok(source.rawCreditCaveats.some((row) => row.includes('McGuiness, Ed')));
  assert.match(source.claimPolicy.publishedCopyBoundary, /does not|Do not claim/);
  const preserved = source.preservedResearch;
  assert.ok(preserved.artifacts.every((row) => !Object.hasOwn(row, 'path')),
    'Public Brave provenance receipts must not contain executable artifact paths');
  assert.deepEqual(preserved.artifacts.map(({ name, sha256, bytes }) => ({ name, sha256, bytes })), [
    {
      name: 'mcu-prep-captain-america-brave-new-world.source.json',
      sha256: '9056fdcab60e7a8806885642782445e8c069ec28d73f934873a9d8b867b15e7a',
      bytes: 44117,
    },
    {
      name: 'mcu-prep-captain-america-brave-new-world.packet.json',
      sha256: '05d26bb08d43de769aabcdd4f2533cdaa91eda08fdda74ec122d02667db83625',
      bytes: 12151,
    },
    {
      name: 'mcu-prep-captain-america-brave-new-world.mapping.json',
      sha256: '968f35551b3f71386067461fed076c0e50d914d07b01544e3d893b77552ee19b',
      bytes: 68136,
    },
  ]);
  assert.equal(preserved.publicArtifactReadRequired, false);
  assert.equal(preserved.publicSourceSelfContained, true);
  assert.equal(preserved.originalBytesChanged, false);
  assert.equal(hashText(await text(sourceFile)), packet.sourceContentSha256);
  assert.equal(packet.sourceIssueBearingBlocksSha256, digestCanonicalJson(source.rows));
  assert.deepEqual(sourceCountsForPacket(packet), {
    sourceOccurrenceCount: 19, sourceIdentityCount: 19, includedIssueCount: 19,
    sourceGapCount: 0, repeatedSourceReferenceCount: 0,
  });
  assert.equal(Object.hasOwn(packet, 'sourceGaps'), false);
  assert.equal(Object.hasOwn(packet, 'repeatedSourceReferences'), false);
  assert.deepEqual(packet.rows.map((row) => row.candidateIssueId), expectedIds);
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), expectedIds);
  assert.equal(mapping.candidateMetadata.length, 19);
  for (const row of mapping.rows) {
    assert.equal(row.resolutionStatus, 'exact');
    assert.equal(resolveRow(row, mapping.candidateMetadata).selectedIssueId, String(row.selectedIssueId));
    const candidate = mapping.candidateMetadata.find((entry) => entry.id === row.selectedIssueId);
    const fresh = candidate.freshMetadataEvidence;
    assert.equal(fresh.url, `https://marvel.emreparker.com/v1/issues/${row.selectedIssueId}`);
    assert.equal(fresh.urlSha256, hashText(fresh.url));
    assert.equal(fresh.status, 200);
    assert.match(fresh.retrievedAt, /^2026-10-07T/);
    assert.equal(fresh.matchesHistoricalResponseDigest, true);
    assert.equal(fresh.responseBodySha256, row.recordedHttpReceipt.bodySha256);
    assert.deepEqual(row.freshMetadataEvidence, fresh);
    assert.equal(candidate.providerProjection.id, row.selectedIssueId);
    assert.equal(candidate.providerProjection.seriesId, row.seriesId);
    assert.equal(candidate.providerProjection.issueNumber, row.issueNumber);
    assert.equal(candidate.providerProjection.title, row.resolvedIssueTitle);
    assert.equal(Object.hasOwn(candidate.providerProjection, 'description'), false);
    assert.equal(candidate.comicImageBytesFetched, false);
    assert.equal(candidate.descriptionStored, false);
    assert.equal(candidate.availabilityClaim, null);
  }
});

test('Brave New World binds every current peer and the actual three-partial independent authority', async () => {
  const { packet, mapping, report } = await evidence();
  const [library, manifest, catalog] = await Promise.all([
    loadCurrentOwnerLibrary(id), json('src/data/curated-lists.json'), json('src/data/catalog.json'),
  ]);
  const current = buildComparisonReport({ candidateIds: expectedIds, orders: library.orders });
  const peerIds = [...new Set([...manifest.lists, ...catalog.lists].map((row) => row.id))]
    .filter((peerId) => peerId !== id).sort();
  assert.deepEqual(current.comparisons.map((row) => row.orderId).sort(), peerIds);
  assert.equal(current.comparisonCount, peerIds.length);
  assert.equal(library.descriptors.filter((row) => /^marvel-knights-to-planet-x-\d{2}$/.test(row.id)).length, 78);
  assert.ok(peerIds.includes('marvel-knights-to-planet-x'));
  assert.ok(!peerIds.includes('spider-man-no-way-home-owner-selected'));
  const recordedIds = new Set(report.comparisons.map((row) => row.orderId));
  const recordedOrders = library.orders.filter((row) => recordedIds.has(row.orderId));
  const recordedManifest = {
    ...library.manifest, lists: library.manifest.lists.filter((row) => recordedIds.has(row.id)),
  };
  const recordedDigest = libraryDigestFor(recordedManifest, recordedOrders.map((row) => ({
    id: row.orderId, issueIds: row.issueIds.map(String),
  })));
  assert.equal(report.comparisonCount, 292);
  assert.equal(report.libraryDigest, recordedDigest,
    'Actual post-Ms.Marvel descriptions and vectors remain the authority basis');
  assert.deepEqual(current.comparisons.filter((row) => recordedIds.has(row.orderId)), report.comparisons);
  assert.ok(legacyOwnerPeers(current.comparisons).filter((row) => !recordedIds.has(row.orderId))
    .every((row) => row.relationship === 'none' && row.sharedCount === 0 && row.sharedIds.length === 0),
  'Later meaningful relationships cannot inherit this frozen authority');
  assert.deepEqual(legacyOwnerPeers(current.comparisons).filter((row) => row.relationship !== 'none'), [
    { orderId: 'falcon-sam-wilson-captain-america-reading-order', relationship: 'partial', sharedCount: 12,
      sharedIds: expectedIds.slice(7).map(String) },
    { orderId: 'question-of-the-week-do-you-have-a-hulk-reading-order', relationship: 'partial', sharedCount: 6,
      sharedIds: expectedIds.slice(0, 6).map(String) },
    { orderId: 'world-war-hulk-aftersmash', relationship: 'partial', sharedCount: 6,
      sharedIds: expectedIds.slice(0, 6).map(String) },
  ]);
  assert.equal(report.comparisons.filter((row) => row.relationship === 'none').length, 289);
  validateFrozenPacket(packet, { provider });
  assertMappingMatchesPacketOccurrences(packet, mapping);
  validateMappingDigest(mapping);
  validateReportDigest(report);
  assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: recordedDigest,
    expectedOrderIds: [...recordedIds], packetValidation: { provider },
  });
  assert.equal(mapping.reviewStatus, 'approved');
  assert.match(mapping.relationshipReview.authorityIdentity, /GPT-6 Astra.*central coordinator independent/);
  assert.equal(mapping.relationshipReview.approvalDigest,
    'f943dea98fb70a9e099894a26db3675c25810689768c6866525af7a3e3a769af');
  assert.deepEqual(packet.insertionAnchor, { beforeId: 'agents-of-atlas-reading-order' });
  const retainedOrder = legacyOwnerPeers(manifest.lists);
  const position = retainedOrder.findIndex((row) => row.id === id);
  assert.equal(retainedOrder[position - 1].id, 'mcu-prep-ms-marvel');
  assert.equal(retainedOrder[position + 1].id, packet.insertionAnchor.beforeId);
});

test('Brave New World publishes the exact nineteen-vector and preserves reader, deferral and separate history', async () => {
  const { packet, mapping } = await evidence();
  const [payload, manifest, catalog, markdown, inventory] = await Promise.all([
    json('src/data/mcu_prep_captain_america_brave_new_world.json'), json('src/data/curated-lists.json'),
    json('src/data/catalog.json'), text(`src/data/orders/${id}.md`),
    json('scripts/data/cbh-mcu-companion-inventory.json'),
  ]);
  const parsed = parseChecklist(markdown);
  assert.deepEqual(parsed.entries.map((row) => row.issueId), expectedIds);
  assert.deepEqual(parsed.entries.map((row) => Number(row.sourceKey)), expectedPositions);
  assert.deepEqual(parsed.entries.map((row) => row.section), expectedGroups);
  assert.deepEqual(parsed.unresolved, []);
  assert.match(markdown, /Puny Little Man backup.*Wolverine \(2003\) #50/);
  assert.match(markdown, /records progress for the full original issue, including its unrelated lead material/);
  assert.match(markdown, /DATA_PROVENANCE\.md#owner-authored-mcu-prep-captain-america-brave-new-world/);
  assert.doesNotMatch(markdown, /[\u2013\u2014]/);
  assert.deepEqual(payload.items.map((row) => row.issueId), expectedIds,
    'Published Brave New World original vector and position7 whole5815 must match the accepted source');
  assert.deepEqual(payload.items.map((row) => row.title), fixture.rows.map((row) => row[2]));
  assert.deepEqual(payload.items.map((row) => row.collectedIn), expectedGroups);
  assert.deepEqual([payload.count, payload.collections, payload.placeholders], [19, 3, 0]);
  assert.deepEqual(payload.unresolved, []);
  assert.equal(payload.description, fixture.description);
  assert.equal(payload.sourceOrigin, provider.sourceOrigin);
  assert.equal(payload.source, sourceUrl);
  assert.equal(payload.sourceLicense, null);
  for (const item of payload.items) {
    const candidate = mapping.candidateMetadata.find((row) => row.id === item.issueId);
    assert.equal(item.title, candidate.providerProjection.title);
    assert.equal(item.digitalId, candidate.digitalId);
    assert.deepEqual(item.cover, normalizeCover(candidate.providerProjection.cover));
    assert.deepEqual(item.creators, candidate.creators
      .filter((credit) => /writer|penciler|artist/i.test(credit.role))
      .map(({ name, role }) => ({ name, role })));
    assert.equal(item.description, null);
    assert.equal(Object.hasOwn(item, 'notes'), false);
    assert.equal(Object.hasOwn(item, 'storyId'), false);
  }
  assert.deepEqual(manifest.lists.find((row) => row.id === id), packet.proposedManifest);
  assert.equal(manifest.lists.filter((row) => row.id === id).length, 1);
  assert.equal(catalog.lists.filter((row) => row.id === id).length, 1);
  const card = catalog.lists.find((row) => row.id === id);
  assert.deepEqual([card.type, card.depth, card.timeline, card.beginner, card.group, card.sourceLicense],
    ['screen-companion', 'selected', null, false, null, null]);
  assert.equal(card.description, fixture.description);
  assert.equal(card.sourceOrigin, provider.sourceOrigin);
  const choices = catalogEntries(parseCatalog(catalog).lists);
  const mcu = HOME_CATEGORIES.find((category) => category.key === 'marvel-on-screen');
  assert.equal(mcu.select(choices).filter((choice) => choice.key === `list:${id}`).length, 1);
  assert.equal(inventory.records.length, 14);
  assert.equal(inventory.inventoryIdentitySha256,
    '3f1385d457081d0ccaa7513ae161c42895d3ce2dd05ced0d06d5bf25d47bda11');
  assert.ok(![...manifest.lists, ...catalog.lists].some((row) => row.id === 'spider-man-no-way-home-owner-selected'));

  const hulkCard = catalog.lists.find((row) => row.id === 'question-of-the-week-do-you-have-a-hulk-reading-order');
  const houseCard = catalog.lists.find((row) => row.id === 'house-of-m');
  const [hulk, house] = await Promise.all([
    json(`src/data/${hulkCard.file}`), json(`src/data/${houseCard.file}`),
  ]);
  let state = createList(createEmptyState(), {
    id: 'prior-hulk', name: hulk.name, catalogId: hulk.id, description: 'My saved Hulk description',
    note: 'Keep my prior list note',
  });
  state = addIssuesToList(state, 'prior-hulk', hulk.items).state;
  for (const item of hulk.items) state = markRead(state, item.issueId, true, 123456);
  state = setIssueNote(state, 17623, 'Keep my Red Hulk issue note');
  state = createList(state, { id: 'prior-house', name: house.name, catalogId: house.id });
  state = addIssuesToList(state, 'prior-house', house.items).state;
  state = setDeferred(state, 'prior-house', house.items[2].issueId);
  state = { ...state, overrides: { 17623: 'unavailable' } };
  const previous = structuredClone(state);
  const historyRecord = {
    listId: 'prior-hulk', created: state.lists['prior-hulk'].created, catalogId: hulk.id,
    completedAt: 123457, rating: 'up',
  };
  const historyText = JSON.stringify({ format: LIST_HISTORY_FORMAT, version: 1, records: [historyRecord] });
  const saved = new Map([[KEY, JSON.stringify(state)], [LIST_HISTORY_KEY, historyText]]);
  const history = new ListHistoryStore({ storage: { getItem: (key) => saved.get(key) ?? null } });
  assert.equal(history.load().ok, true);
  const separateHistoryBackup = history.exportBackup();
  state = createList(state, { id: 'brave', name: payload.name, catalogId: id, description: payload.description });
  state = addIssuesToList(state, 'brave', payload.items).state;
  assert.equal(KEY, 'mrt.state.v2');
  assert.equal(state.schemaVersion, 3);
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(state.lists['prior-hulk'], previous.lists['prior-hulk']);
  assert.deepEqual(state.lists['prior-house'], previous.lists['prior-house']);
  assert.deepEqual(state.read, previous.read);
  assert.deepEqual(state.notes, previous.notes);
  assert.deepEqual(state.overrides, previous.overrides);
  assert.deepEqual(state.lists.brave.itemIds, expectedIds);
  assert.equal(state.lists.brave.collectedIn[5815], groups[0]);
  assert.equal(Object.hasOwn(state.issues[5815], 'collectedIn'), false);
  assert.equal(Object.hasOwn(state.issues[5815], 'storyId'), false);
  assert.equal(Object.keys(state.issues).filter((key) => key === '5815').length, 1);
  assert.equal(Object.keys(state.issues).filter((key) => key === '17623').length, 1);
  const readerBackup = exportBackup(state);
  const restored = validateBackup(readerBackup);
  assert.equal(restored.ok, true, restored.errors.join('; '));
  assert.deepEqual(restored.state.lists.brave.itemIds, expectedIds);
  assert.deepEqual(restored.state.lists['prior-hulk'], previous.lists['prior-hulk']);
  assert.deepEqual(restored.state.lists['prior-house'], previous.lists['prior-house']);
  assert.deepEqual(restored.state.read, previous.read);
  assert.deepEqual(restored.state.notes, previous.notes);
  assert.deepEqual(restored.state.overrides, previous.overrides);
  assert.equal(history.getRecord(restored.state, 'prior-hulk').rating, 'up');
  assert.equal(history.isCompleted(restored.state, 'prior-hulk'), true);
  assert.equal(saved.get(LIST_HISTORY_KEY), historyText);
  assert.equal(Object.hasOwn(readerBackup, 'listHistory'), false);
  assert.deepEqual([...parseListHistory(separateHistoryBackup).values()], [historyRecord]);
});
