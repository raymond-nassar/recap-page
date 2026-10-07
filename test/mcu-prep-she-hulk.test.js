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
import { LIST_HISTORY_FORMAT, LIST_HISTORY_KEY, ListHistoryStore } from '../src/js/lib/listHistory.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  addIssuesToList, createEmptyState, createList, exportBackup, SCHEMA_VERSION, validateBackup,
} from '../src/js/lib/model.js';

const text = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const json = async (file) => JSON.parse(await text(file));
const fixture = await json('test/fixtures/mcu-prep-she-hulk-vector.json');
const { id, groups, sourceUrl } = fixture;
const expectedIds = fixture.rows.map((row) => row[1]);
const expectedPositions = fixture.rows.map((row) => row[0]);
const expectedGroups = fixture.rows.map((row) => groups[row[3]]);
const provider = {
  id: 'owner-authored', hosts: ['github.com'], sourceOrigin: 'Selected by raymond-nassar for MCU Prep',
  requireSourceProvider: true, requireSourceContentSha256: true,
};
const sourceFile = `scripts/data/owner-selections/${id}.json`;
const hashText = (value) => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
const evidence = async () => {
  const [source, packet, mapping, report] = await Promise.all([
    json(sourceFile), json(`scripts/data/owner-packets/${id}.json`),
    json(`scripts/data/owner-mappings/${id}.json`), json(`scripts/data/owner-overlaps/${id}.json`),
  ]);
  return { source, packet, mapping, report };
};

test('She-Hulk accounts for thirteen exact originals and qualified first-trade boundaries', async () => {
  const { source, packet, mapping } = await evidence();
  assert.equal(source.selectionCount, 3);
  assert.equal(source.publishedIssueCount, 13);
  assert.deepEqual(source.sourceGroupCounts, [1, 6, 6]);
  assert.deepEqual(source.publishedGroupCounts, [1, 6, 6]);
  assert.deepEqual(source.rows.map((row) => row.sourcePosition), expectedPositions);
  assert.deepEqual(source.rows.map((row) => row.originalIssueId), expectedIds);
  assert.deepEqual(source.rows.map((row) => row.selectedIssueId), expectedIds);
  assert.deepEqual(source.rows.map((row) => row.seriesYear), [1980, ...Array(6).fill(2004), ...Array(6).fill(2014)]);
  assert.equal(packet.expectedCount, 13);
  assert.equal(packet.proposedManifest.expect, 13);
  assert.equal(mapping.approvedSourceCount, 13);
  assert.deepEqual(sourceCountsForPacket(packet), {
    sourceOccurrenceCount: 13, sourceIdentityCount: 13, includedIssueCount: 13,
    sourceGapCount: 0, repeatedSourceReferenceCount: 0,
  });
  assert.equal(Object.hasOwn(packet, 'sourceGaps'), false);
  assert.equal(Object.hasOwn(packet, 'sourceRepeats'), false);
  assert.deepEqual(packet.rows.map((row) => row.candidateIssueId), expectedIds);
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), expectedIds);
  assert.deepEqual(mapping.rows.map((row) => row.sourcePosition), expectedPositions);
  assert.equal(hashText(JSON.stringify(expectedIds)), fixture.vectorSha256);
  assert.equal(hashText(await text(sourceFile)), packet.sourceContentSha256);
  assert.equal(packet.sourceIssueBearingBlocksSha256, digestCanonicalJson(source.rows));
  assert.equal(source.sourceUrl, sourceUrl);
  assert.equal(source.readerDescription, fixture.description);
  assert.equal(source.editorialOrder.originIssueId, 15256);
  assert.equal(source.editorialOrder.authorityType, 'coordinator-choice-under-autonomous-delegation');
  assert.equal(source.editorialOrder.separateHumanReceiptClaimed, false);
  assert.equal(source.editorialOrder.precisePrintingDayAsserted, false);
  assert.equal(source.sourceDecisionUrl, `${sourceUrl}#issuecomment-5976082382`);
  assert.equal(source.supersededKickoffPointer.url,
    'https://github.com/raymond-nassar/recap-page/issues/701');
  assert.equal(source.sourceSelections[0].collectionTitle, null);
  assert.equal(source.sourceSelections[0].editionIsbn, null);
  assert.deepEqual(source.sourceSelections[1].publicationYearObservations.map((row) => row.year), [2004, 2007]);
  assert.equal(source.sourceSelections[1].editionIsbn, '9780785114437');
  assert.equal(source.sourceSelections[1].precisePrintingDate, null);
  assert.equal(source.sourceSelections[2].editionIsbn, '9780785190196');
  assert.equal(source.sourceSelections[2].publicationYear, 2014);
  assert.deepEqual(source.sourceSelections[2].creditedCreators.slice(1), [
    { name: 'Javier Pulido', role: 'artist on #1-4' },
    { name: 'Ron Wimberly', role: 'artist on #5-6' },
  ]);
  assert.ok(source.factualQualifications.some((row) => /Soule remains selected.*refutes absolute recency/.test(row)));
  assert.equal(source.preservedResearch.originalsWereUncommittedDrafts, true);
  assert.equal(source.preservedResearch.artifacts.length, 3);
  for (const original of source.preservedResearch.artifacts) {
    assert.equal(hashText(await text(original.path)), original.sha256);
  }
  assert.equal(mapping.candidateMetadata.length, 13);
  for (const row of mapping.rows) {
    assert.equal(row.resolutionStatus, 'exact');
    assert.equal(resolveRow(row, mapping.candidateMetadata).selectedIssueId, String(row.selectedIssueId));
    const candidate = mapping.candidateMetadata.find((entry) => entry.id === row.selectedIssueId);
    const fresh = candidate.freshMetadataEvidence;
    assert.equal(fresh.url, `https://marvel.emreparker.com/v1/issues/${row.selectedIssueId}`);
    assert.equal(fresh.urlSha256, hashText(fresh.url));
    assert.equal(fresh.status, 200);
    assert.match(fresh.retrievedAt, /^2026-10-06T/);
    assert.equal(fresh.responseBodySha256, candidate.bodySha256);
    assert.match(fresh.parsedBodySha256, /^[a-f0-9]{64}$/);
    assert.equal(row.recordedHttpReceipt.bodySha256, candidate.bodySha256);
    assert.deepEqual(row.freshMetadataEvidence, fresh);
    assert.equal(candidate.providerProjection.id, row.selectedIssueId);
    assert.equal(candidate.providerProjection.seriesId, row.seriesId);
    assert.equal(candidate.providerProjection.issueNumber, row.issueNumber);
    assert.equal(candidate.providerProjection.title, row.resolvedIssueTitle);
    assert.equal(Object.hasOwn(candidate.providerProjection, 'description'), false);
    assert.equal(candidate.coverBytesFetched, false);
    assert.equal(candidate.availabilityClaim, null);
  }
});

test('She-Hulk binds post-refresh approval to every current-library peer', async () => {
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
  assert.equal(report.comparisonCount, 290);
  assert.equal(report.libraryDigest, recordedDigest,
    'Post-refresh authority binds actual current descriptions without a historical inverse');
  assert.deepEqual(current.comparisons.filter((row) => recordedIds.has(row.orderId)), report.comparisons);
  assert.ok(legacyOwnerPeers(current.comparisons).filter((row) => !recordedIds.has(row.orderId))
    .every((row) => row.relationship === 'none' && row.sharedCount === 0 && row.sharedIds.length === 0),
  'A later meaningful relationship needs its own central review');
  assert.deepEqual(legacyOwnerPeers(current.comparisons).filter((row) => row.relationship !== 'none'), [
    {
      orderId: 'question-of-the-week-do-you-have-a-hulk-reading-order',
      relationship: 'partial', sharedCount: 7, sharedIds: expectedIds.slice(0, 7).map(String),
    },
  ]);
  const hulk = library.orders.find((row) => row.orderId === 'question-of-the-week-do-you-have-a-hulk-reading-order');
  assert.equal(hulk.issueIds.length, 1149);
  assert.ok(expectedIds.slice(7).every((issueId) => !hulk.issueIds.includes(String(issueId))));
  assert.equal(report.comparisons.filter((row) => row.relationship === 'none').length, 289);
  validateFrozenPacket(packet, { provider });
  assertMappingMatchesPacketOccurrences(packet, mapping);
  validateMappingDigest(mapping);
  validateReportDigest(report);
  assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: recordedDigest,
    expectedOrderIds: [...recordedIds], packetValidation: { provider },
  });
  assert.equal(packet.sourceReview.authorityType, 'stronger-model');
  assert.equal(mapping.relationshipReview.authorityType, 'stronger-model');
  assert.match(mapping.relationshipReview.authorityIdentity, /GPT-6 Astra.*central coordinator independent/);
  assert.equal(mapping.relationshipReview.reviewedAt, '2026-10-06T20:26:04.235Z');
  assert.equal(mapping.relationshipReview.approvalDigest,
    '6b912b468d9cce4b20c2fdf08c3c97ac3196d8aa5656d3c9ef93190c9e1cd17a');
  assert.deepEqual(packet.insertionAnchor, { beforeId: 'agents-of-atlas-reading-order' });
  const position = manifest.lists.findIndex((row) => row.id === id);
  assert.equal(manifest.lists[position - 1].id, 'mcu-prep-spider-man-brand-new-day');
  assert.equal(manifest.lists[position + 1].id, 'mcu-prep-ms-marvel');
  assert.ok(manifest.lists.findIndex((row) => row.id === packet.insertionAnchor.beforeId) > position + 1);
});

test('She-Hulk publishes thirteen originals without changing reader or history data', async () => {
  const { packet, mapping } = await evidence();
  const [payload, manifest, catalog, markdown, inventory] = await Promise.all([
    json('src/data/mcu_prep_she_hulk.json'), json('src/data/curated-lists.json'),
    json('src/data/catalog.json'), text(`src/data/orders/${id}.md`),
    json('scripts/data/cbh-mcu-companion-inventory.json'),
  ]);
  const parsed = parseChecklist(markdown);
  assert.deepEqual(parsed.entries.map((row) => row.issueId), expectedIds);
  assert.deepEqual(parsed.entries.map((row) => Number(row.sourceKey)), expectedPositions);
  assert.deepEqual(parsed.entries.map((row) => row.section), expectedGroups);
  assert.deepEqual(parsed.entries.map((row) => row.title), fixture.rows.map((row) => row[2]));
  assert.deepEqual(parsed.unresolved, []);
  assert.match(markdown, /DATA_PROVENANCE\.md#owner-authored-mcu-prep-she-hulk-attorney-at-law/);
  assert.doesNotMatch(markdown, /[\u2013\u2014]/);
  assert.deepEqual(payload.items.map((row) => row.issueId), expectedIds,
    'Published She-Hulk original vector and order must match the accepted source exactly');
  assert.deepEqual(payload.items.map((row) => row.collectedIn), expectedGroups);
  assert.deepEqual([payload.count, payload.collections, payload.placeholders], [13, 3, 0]);
  assert.deepEqual(payload.unresolved, []);
  assert.equal(payload.description, fixture.description);
  assert.equal(payload.sourceOrigin, provider.sourceOrigin);
  assert.equal(payload.source, sourceUrl);
  assert.equal(payload.sourceLicense, null);
  for (const item of payload.items) {
    const candidate = mapping.candidateMetadata.find((row) => row.id === item.issueId);
    assert.equal(item.title, candidate.providerProjection.title);
    assert.equal(item.digitalId, candidate.digitalId);
    assert.deepEqual(item.cover, candidate.normalizedCover);
    assert.deepEqual(item.creators, candidate.creators
      .filter((credit) => /writer|penciler|artist/i.test(credit.role))
      .map(({ name, role }) => ({ name, role })));
    assert.equal(item.description, null);
    assert.equal(Object.hasOwn(item, 'notes'), false);
    assert.equal(Object.hasOwn(item, 'storyId'), false);
  }
  assert.deepEqual(payload.items.filter((row) => row.creators.length === 0).map((row) => row.issueId),
    expectedIds.slice(0, 7));
  assert.deepEqual(payload.items.filter((row) => row.mu && Number(row.mu.slice(0, 4)) < 2007)
    .map((row) => row.issueId), expectedIds.slice(1, 7));
  assert.deepEqual(manifest.lists.find((row) => row.id === id), packet.proposedManifest);
  assert.equal(manifest.lists.filter((row) => row.id === id).length, 1);
  assert.equal(catalog.lists.filter((row) => row.id === id).length, 1);
  const card = catalog.lists.find((row) => row.id === id);
  assert.deepEqual([card.type, card.depth, card.timeline, card.beginner, card.group, card.sourceLicense],
    ['screen-companion', 'selected', null, false, null, null]);
  assert.equal(card.description, fixture.description);
  assert.equal(card.sourceOrigin, provider.sourceOrigin);
  assert.deepEqual(card.cover, payload.items[0].cover);
  const choices = catalogEntries(parseCatalog(catalog).lists);
  const mcu = HOME_CATEGORIES.find((category) => category.key === 'marvel-on-screen');
  assert.equal(mcu.select(choices).filter((choice) => choice.key === `list:${id}`).length, 1);
  assert.equal(inventory.records.length, 14);
  assert.equal(inventory.inventoryIdentitySha256,
    '3f1385d457081d0ccaa7513ae161c42895d3ce2dd05ced0d06d5bf25d47bda11');
  assert.ok(![...manifest.lists, ...catalog.lists].some((row) => row.id === 'spider-man-no-way-home-owner-selected'));
  assert.equal((await json('src/data/spider_man_no_way_home_owner_selected.json')).count, 18);
  assert.equal((await json('src/data/spider_man_no_way_home.json')).count, 17);

  let state = createList(createEmptyState(), { id: 'existing-hulk', name: 'My Hulk list', note: 'My list note' });
  state = addIssuesToList(state, 'existing-hulk', [{
    ...payload.items[0], collectedIn: 'My previous Hulk section',
  }]).state;
  state = { ...state, read: { 15256: 123456 }, notes: { 15256: 'My existing Hulk note' },
    overrides: { 15256: 'unavailable' } };
  const priorList = structuredClone(state.lists['existing-hulk']);
  const historyText = JSON.stringify({
    format: LIST_HISTORY_FORMAT, version: 1,
    records: [{ listId: priorList.id, created: priorList.created, catalogId: null,
      completedAt: 123457, rating: 'up' }],
  });
  const saved = new Map([[LIST_HISTORY_KEY, historyText]]);
  const history = new ListHistoryStore({ storage: { getItem: (key) => saved.get(key) ?? null } });
  assert.equal(history.load().ok, true);
  state = createList(state, { id: 'she-hulk', name: payload.name, catalogId: id, description: payload.description });
  state = addIssuesToList(state, 'she-hulk', payload.items).state;
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(state.lists['existing-hulk'], priorList);
  assert.deepEqual(state.lists['she-hulk'].itemIds, expectedIds);
  assert.equal(state.lists['she-hulk'].collectedIn[15256], groups[0]);
  assert.equal(Object.hasOwn(state.issues[15256], 'collectedIn'), false);
  assert.equal(Object.keys(state.issues).filter((key) => key === '15256').length, 1);
  const backup = exportBackup(state);
  const restored = validateBackup(backup);
  assert.equal(restored.ok, true, restored.errors.join('; '));
  assert.deepEqual(restored.state.lists['she-hulk'].itemIds, expectedIds);
  assert.deepEqual(restored.state.lists['existing-hulk'], priorList);
  assert.equal(restored.state.read[15256], 123456);
  assert.equal(restored.state.notes[15256], 'My existing Hulk note');
  assert.equal(restored.state.overrides[15256], 'unavailable');
  assert.equal(history.isCompleted(restored.state, 'existing-hulk'), true);
  assert.equal(history.getRecord(restored.state, 'existing-hulk').rating, 'up');
  assert.equal(saved.get(LIST_HISTORY_KEY), historyText);
  assert.equal(Object.hasOwn(backup, 'listHistory'), false);
});
