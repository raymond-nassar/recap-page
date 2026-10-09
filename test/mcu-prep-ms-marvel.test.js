import test from 'node:test';
import { legacyOwnerPeers } from './helpers/current-reading-library.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences, digestCanonicalJson,
  sourceCountsForPacket, validateFrozenPacket, validateMappingDigest, validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport } from '../scripts/lib/cbh-overlap.mjs';
import { resolveRow } from '../scripts/lib/cbh-resolution.mjs';
import { loadCurrentOwnerLibrary } from '../scripts/lib/owner-current-library.mjs';
import { historicalSpiderManSelectionLibraryDigest } from './helpers/reading-choice-history.mjs';
import { catalogEntries, HOME_CATEGORIES, parseCatalog } from '../src/js/lib/catalog.js';
import { LIST_HISTORY_FORMAT, LIST_HISTORY_KEY, ListHistoryStore } from '../src/js/lib/listHistory.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  addIssuesToList, createEmptyState, createList, exportBackup, SCHEMA_VERSION, validateBackup,
} from '../src/js/lib/model.js';
import {
  assertFirstStepsMsMarvelReciprocal, MS_MARVEL_PROVIDER,
} from './helpers/first-steps-ms-marvel-reciprocal.mjs';

const text = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const json = async (file) => JSON.parse(await text(file));
const fixture = await json('test/fixtures/mcu-prep-ms-marvel-vector.json');
const { id, groups, sourceUrl } = fixture;
const expectedIds = fixture.rows.map((row) => row[1]);
const expectedPositions = fixture.rows.map((row) => row[0]);
const expectedGroups = fixture.rows.map((row) => groups[row[3]]);
const sourceFile = `scripts/data/owner-selections/${id}.json`;
const hashText = (value) => createHash('sha256').update(value.replace(/\r\n/g, '\n')).digest('hex');
const evidence = async () => {
  const [source, packet, mapping, report] = await Promise.all([
    json(sourceFile), json(`scripts/data/owner-packets/${id}.json`),
    json(`scripts/data/owner-mappings/${id}.json`), json(`scripts/data/owner-overlaps/${id}.json`),
  ]);
  return { source, packet, mapping, report };
};
const firstStepsEvidence = async () => {
  const frozenId = 'mcu-prep-fantastic-four-first-steps';
  const [packet, mapping, report, reference] = await Promise.all([
    ...['packet', 'mapping', 'overlap'].map((kind) =>
      json(`scripts/data/owner-mcu-prep/${frozenId}.${kind}.json`)),
    json(`scripts/data/owner-mcu-prep/${frozenId}.ms-marvel-reciprocal.json`),
  ]);
  return { packet, mapping, report, reference };
};

test('Ms. Marvel accounts for eighteen exact originals and the qualified three-trade scope', async () => {
  const { source, packet, mapping } = await evidence();
  assert.deepEqual(expectedIds, [
    49089, 49090, 49091, 49092, 49093, 49846, 49094, 49095, 49096,
    49097, 49098, 49099, 75470, 75472, 75474, 75475, 75476, 75477,
  ]);
  assert.equal(hashText(JSON.stringify(expectedIds)), fixture.vectorSha256);
  assert.deepEqual([source.selectionCount, source.sourceIssueCount, source.publishedIssueCount], [3, 18, 18]);
  assert.deepEqual(source.sourceGroupCounts, [6, 6, 6]);
  assert.deepEqual(source.publishedGroupCounts, [6, 6, 6]);
  assert.deepEqual(source.rows.map((row) => row.sourcePosition), expectedPositions);
  assert.deepEqual(source.rows.map((row) => row.originalIssueId), expectedIds);
  assert.deepEqual(source.rows.map((row) => row.selectedIssueId), expectedIds);
  assert.deepEqual(source.selections.map((row) => row.editionIsbn),
    ['9780785190219', '9780785190226', '9781302918293']);
  assert.deepEqual(source.selections.map((row) => row.publicationYear), [2014, 2015, 2019]);
  assert.equal(source.sourceUrl, sourceUrl);
  assert.equal(source.readerDescription, fixture.description);
  assert.equal(source.sourceDecisionUrl, `${sourceUrl}#issuecomment-5976082380`);
  assert.equal(source.supersededKickoffPointer.url, 'https://github.com/raymond-nassar/recap-page/issues/700');
  assert.equal(source.editorialOrder.authorityType, 'coordinator-choice-under-autonomous-delegation');
  assert.equal(source.editorialOrder.physicalTocVerified, false);
  assert.equal(source.editorialOrder.separateHumanReceiptClaimed, false);
  assert.equal(source.editorialOrder.anthologyOriginalIssueId, 49846);
  assert.equal(source.editorialOrder.anthologySourcePosition, 6);
  assert.match(source.anthologyIdentityContract.wholeIssueQualification,
    /Kamala Khan's Ms\. Marvel story only.*full original anthology, including unrelated stories/);
  assert.equal(source.anthologyIdentityContract.readerScope, 'whole-original');
  assert.equal(source.anthologyIdentityContract.qualificationScope, 'guide');
  assert.equal(source.anthologyIdentityContract.perStoryIdsAllowed, false);
  assert.equal(source.anthologyIdentityContract.progressOrUserNoteMutationAllowed, false);
  assert.equal(source.selections[0].supplementalMaterial.length, 1);
  assert.equal(source.selections[0].supplementalMaterial[0].kind, 'non-issue-supplement');
  assert.ok(source.factualQualifications.some((row) => /Jacob Wyatt.*Jake Wyatt.*#6-7/.test(row)));
  assert.ok(source.factualQualifications.some((row) => /2019 year.*precise publication day/.test(row)));
  assert.deepEqual(source.preservedBroaderGuideIds,
    ['ms-marvel-kamala-khan-reading-order', 'captain-marvel-ms-marvel-reading-order']);
  assert.equal(source.preservedResearch.artifacts.length, 3);
  for (const original of source.preservedResearch.artifacts) {
    assert.equal(hashText(await text(original.path)), original.sha256);
  }
  assert.equal(hashText(await text(sourceFile)), packet.sourceContentSha256);
  assert.equal(packet.sourceIssueBearingBlocksSha256, digestCanonicalJson(source.rows));
  assert.deepEqual(sourceCountsForPacket(packet), {
    sourceOccurrenceCount: 18, sourceIdentityCount: 18, includedIssueCount: 18,
    sourceGapCount: 0, repeatedSourceReferenceCount: 0,
  });
  assert.equal(Object.hasOwn(packet, 'sourceGaps'), false);
  assert.equal(Object.hasOwn(packet, 'repeatedSourceReferences'), false);
  assert.deepEqual(packet.rows.map((row) => row.candidateIssueId), expectedIds);
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), expectedIds);
  assert.deepEqual(mapping.rows.map((row) => row.sourcePosition), expectedPositions);
  assert.equal(mapping.candidateMetadata.length, 18);
  for (const row of mapping.rows) {
    assert.equal(row.resolutionStatus, 'exact');
    assert.equal(resolveRow(row, mapping.candidateMetadata).selectedIssueId, String(row.selectedIssueId));
    const candidate = mapping.candidateMetadata.find((entry) => entry.id === row.selectedIssueId);
    const fresh = candidate.freshMetadataEvidence;
    assert.equal(fresh.url, `https://marvel.emreparker.com/v1/issues/${row.selectedIssueId}`);
    assert.equal(fresh.urlSha256, hashText(fresh.url));
    assert.equal(fresh.status, 200);
    assert.match(fresh.retrievedAt, /^2026-10-06T/);
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

test('Ms. Marvel binds full-current authority and the strict First Steps reciprocal reference', async () => {
  const { packet, mapping, report } = await evidence();
  const [library, manifest, catalog, frozen] = await Promise.all([
    loadCurrentOwnerLibrary(id), json('src/data/curated-lists.json'), json('src/data/catalog.json'),
    firstStepsEvidence(),
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
  const recordedDigest = historicalSpiderManSelectionLibraryDigest(recordedManifest, recordedOrders.map((row) => ({
    id: row.orderId, issueIds: row.issueIds.map(String),
  })));
  assert.equal(report.comparisonCount, 291);
  assert.equal(report.libraryDigest, recordedDigest,
    'This post-refresh authority binds actual descriptions, not an older inverse');
  assert.deepEqual(current.comparisons.filter((row) => recordedIds.has(row.orderId)), report.comparisons);
  assert.ok(legacyOwnerPeers(current.comparisons).filter((row) => !recordedIds.has(row.orderId))
    .every((row) => row.relationship === 'none' && row.sharedCount === 0 && row.sharedIds.length === 0),
  'A later meaningful Ms. Marvel relationship needs its own central authority');
  const solo2014 = expectedIds.slice(0, 5).concat(expectedIds.slice(6, 12)).map(String);
  assert.deepEqual(legacyOwnerPeers(current.comparisons).filter((row) => row.relationship !== 'none'), [
    { orderId: 'captain-marvel-ms-marvel-reading-order', relationship: 'partial', sharedCount: 11, sharedIds: solo2014 },
    { orderId: 'mcu-prep-fantastic-four-first-steps', relationship: 'partial', sharedCount: 1, sharedIds: ['49846'] },
    { orderId: 'ms-marvel-kamala-khan-reading-order', relationship: 'partial', sharedCount: 17,
      sharedIds: expectedIds.filter((issueId) => issueId !== 49846).map(String) },
  ]);
  assert.equal(report.comparisons.filter((row) => row.relationship === 'none').length, 288);
  validateFrozenPacket(packet, { provider: MS_MARVEL_PROVIDER });
  assertMappingMatchesPacketOccurrences(packet, mapping);
  validateMappingDigest(mapping);
  validateReportDigest(report);
  assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: recordedDigest,
    expectedOrderIds: [...recordedIds], packetValidation: { provider: MS_MARVEL_PROVIDER },
  });
  assert.equal(mapping.reviewStatus, 'approved');
  assert.match(mapping.relationshipReview.authorityIdentity, /GPT-6 Astra.*central coordinator independent/);
  assert.equal(mapping.relationshipReview.approvalDigest,
    '93131dbe78b4b490b0ef2a93fa08bd2372430ab1e280d9738996aae9711fd72a');
  const reciprocal = await assertFirstStepsMsMarvelReciprocal(frozen);
  assert.deepEqual(reciprocal.approvedDelta,
    { orderId: id, relationship: 'partial', sharedCount: 1, sharedIds: ['49846'] });
  assert.deepEqual(packet.insertionAnchor, { beforeId: 'agents-of-atlas-reading-order' });
  const retainedOrder = legacyOwnerPeers(manifest.lists);
  const position = retainedOrder.findIndex((row) => row.id === id);
  assert.equal(retainedOrder[position - 1].id, 'mcu-prep-she-hulk');
  assert.equal(retainedOrder[position + 1].id, 'mcu-prep-captain-america-brave-new-world');
  assert.equal(retainedOrder[position + 2].id, packet.insertionAnchor.beforeId);
});

test('Ms. Marvel publishes eighteen originals with guide-local shared anthology and protected saved data', async () => {
  const { packet, mapping } = await evidence();
  const [payload, manifest, catalog, markdown, inventory, firstSteps] = await Promise.all([
    json('src/data/mcu_prep_ms_marvel.json'), json('src/data/curated-lists.json'),
    json('src/data/catalog.json'), text(`src/data/orders/${id}.md`),
    json('scripts/data/cbh-mcu-companion-inventory.json'),
    json('src/data/mcu_prep_fantastic_four_first_steps.json'),
  ]);
  const parsed = parseChecklist(markdown);
  assert.deepEqual(parsed.entries.map((row) => row.issueId), expectedIds);
  assert.deepEqual(parsed.entries.map((row) => Number(row.sourceKey)), expectedPositions);
  assert.deepEqual(parsed.entries.map((row) => row.section), expectedGroups);
  assert.deepEqual(parsed.unresolved, []);
  assert.match(markdown, /DATA_PROVENANCE\.md#owner-authored-mcu-prep-ms-marvel/);
  assert.doesNotMatch(markdown, /[\u2013\u2014]/);
  assert.deepEqual(payload.items.map((row) => row.issueId), expectedIds,
    'Published Ms. Marvel original vector and order must match the accepted source exactly');
  assert.deepEqual(payload.items.map((row) => row.collectedIn), expectedGroups);
  assert.deepEqual([payload.count, payload.collections, payload.placeholders], [18, 3, 0]);
  assert.deepEqual(payload.unresolved, []);
  assert.equal(payload.description, fixture.description);
  assert.equal(payload.sourceOrigin, MS_MARVEL_PROVIDER.sourceOrigin);
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
  assert.deepEqual(manifest.lists.find((row) => row.id === id), packet.proposedManifest);
  assert.equal(manifest.lists.filter((row) => row.id === id).length, 1);
  assert.equal(catalog.lists.filter((row) => row.id === id).length, 1);
  const card = catalog.lists.find((row) => row.id === id);
  assert.deepEqual([card.type, card.depth, card.timeline, card.beginner, card.group, card.sourceLicense],
    ['screen-companion', 'selected', null, false, null, null]);
  assert.equal(card.description, fixture.description);
  assert.equal(card.sourceOrigin, MS_MARVEL_PROVIDER.sourceOrigin);
  const choices = catalogEntries(parseCatalog(catalog).lists);
  const mcu = HOME_CATEGORIES.find((category) => category.key === 'marvel-on-screen');
  assert.equal(mcu.select(choices).filter((choice) => choice.key === `list:${id}`).length, 1);
  assert.equal(inventory.records.length, 14);
  assert.equal(inventory.inventoryIdentitySha256,
    '3f1385d457081d0ccaa7513ae161c42895d3ce2dd05ced0d06d5bf25d47bda11');
  assert.ok(![...manifest.lists, ...catalog.lists].some((row) => row.id === 'spider-man-no-way-home-owner-selected'));

  let state = createList(createEmptyState(), {
    id: 'first-steps', name: firstSteps.name, catalogId: firstSteps.id,
    description: 'My saved First Steps description', note: 'My previous list note',
  });
  state = addIssuesToList(state, 'first-steps', firstSteps.items).state;
  state = { ...state, read: Object.fromEntries(firstSteps.items.map((row) => [row.issueId, 123456])),
    notes: { 49846: 'My existing anthology note' },
    overrides: { 49846: 'unavailable' } };
  const priorList = structuredClone(state.lists['first-steps']);
  const historyText = JSON.stringify({
    format: LIST_HISTORY_FORMAT, version: 1,
    records: [{ listId: priorList.id, created: priorList.created, catalogId: firstSteps.id,
      completedAt: 123457, rating: 'up' }],
  });
  const saved = new Map([[LIST_HISTORY_KEY, historyText]]);
  const history = new ListHistoryStore({ storage: { getItem: (key) => saved.get(key) ?? null } });
  assert.equal(history.load().ok, true);
  state = createList(state, { id: 'ms-marvel', name: payload.name, catalogId: id, description: payload.description });
  state = addIssuesToList(state, 'ms-marvel', payload.items).state;
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(state.lists['first-steps'], priorList);
  assert.deepEqual(state.lists['ms-marvel'].itemIds, expectedIds);
  assert.equal(state.lists['ms-marvel'].collectedIn[49846], groups[0]);
  assert.match(state.lists['first-steps'].collectedIn[49846], /whole Point One anthology; Silver Surfer material/);
  assert.equal(Object.hasOwn(state.issues[49846], 'collectedIn'), false);
  assert.equal(Object.keys(state.issues).filter((key) => key === '49846').length, 1);
  const backup = exportBackup(state);
  const restored = validateBackup(backup);
  assert.equal(restored.ok, true, restored.errors.join('; '));
  assert.deepEqual(restored.state.lists['ms-marvel'].itemIds, expectedIds);
  assert.deepEqual(restored.state.lists['first-steps'], priorList);
  assert.equal(restored.state.read[49846], 123456);
  assert.equal(restored.state.notes[49846], 'My existing anthology note');
  assert.equal(restored.state.overrides[49846], 'unavailable');
  assert.equal(history.getRecord(restored.state, 'first-steps').rating, 'up');
  assert.equal(history.isCompleted(restored.state, 'first-steps'), true);
  assert.equal(saved.get(LIST_HISTORY_KEY), historyText);
  assert.equal(Object.hasOwn(backup, 'listHistory'), false);
});
