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
import { resolveRow } from '../scripts/lib/cbh-resolution.mjs';
import { buildCurrentOwnerOverlap } from '../scripts/lib/owner-current-library.mjs';
import { catalogEntries, HOME_CATEGORIES, parseCatalog } from '../src/js/lib/catalog.js';
import { LIST_HISTORY_FORMAT, LIST_HISTORY_KEY, ListHistoryStore } from '../src/js/lib/listHistory.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  addIssuesToList, createEmptyState, createList, exportBackup, SCHEMA_VERSION, validateBackup,
} from '../src/js/lib/model.js';
import { historicalMcuDescriptionManifest } from './helpers/reading-choice-history.mjs';

const text = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const json = async (file) => JSON.parse(await text(file));
const fixture = await json('test/fixtures/mcu-prep-brand-new-day-vector.json');
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

test('Brand New Day accounts for twenty source positions and nineteen exact originals', async () => {
  const { source, packet, mapping } = await evidence();
  assert.deepEqual(source.sourceGaps?.map((row) => row.sourcePosition), [14],
    'Source position 14 must remain in the explicit nonempty source-gap ledger');
  assert.deepEqual(source.sourceGaps, packet.sourceGaps);
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
  const gap = source.sourceGapDetails[0];
  assert.deepEqual([gap.sourcePosition, gap.selectionPosition, gap.withinSelectionPosition,
    gap.originalIssueId, gap.selectedIssueId, gap.seriesId, gap.coverUrl],
  [14, 2, 8, 59715, null, null, null]);
  assert.equal(gap.issue.url, fixture.gapUrl);
  assert.equal(gap.receipt.httpStatus, 404);
  assert.deepEqual(gap.lookupBundle.map((lookup) => lookup.receipt.httpStatus), [200, 200, 200, 404]);
  assert.deepEqual(gap.nonSubstituteIds, [59710, 59711, 59712, 42148, 59421, 12010]);
  assert.equal(source.selectionCount, 3);
  assert.deepEqual(source.sourceGroupCounts, [6, 8, 6]);
  assert.deepEqual(source.publishedGroupCounts, [6, 7, 6]);
  assert.deepEqual(source.rows.map((row) => row.sourcePosition),
    Array.from({ length: 20 }, (_, index) => index + 1));
  assert.deepEqual(source.rows.map((row) => row.originalIssueId),
    [...expectedIds.slice(0, 13), 59715, ...expectedIds.slice(13)]);
  assert.deepEqual(source.rows.filter((row) => row.resolutionStatus === 'exact')
    .map((row) => row.selectedIssueId), expectedIds);
  assert.equal(packet.expectedCount, 19);
  assert.equal(packet.proposedManifest.expect, 19);
  assert.equal(mapping.approvedSourceCount, 20);
  assert.deepEqual(sourceCountsForPacket(packet), {
    sourceOccurrenceCount: 20, sourceIdentityCount: 20, includedIssueCount: 19,
    sourceGapCount: 1, repeatedSourceReferenceCount: 0,
  });
  assert.deepEqual(packet.rows.map((row) => row.candidateIssueId), expectedIds);
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), expectedIds);
  assert.deepEqual(mapping.rows.map((row) => row.sourcePosition), expectedPositions);
  assert.equal(hashText(JSON.stringify(expectedIds)), fixture.vectorSha256);
  assert.equal(hashText(await text(sourceFile)), packet.sourceContentSha256);
  assert.equal(packet.sourceIssueBearingBlocksSha256, digestCanonicalJson(source.rows));
  assert.equal(source.sourceUrl, sourceUrl);
  assert.equal(source.readerDescription, fixture.description);
  assert.equal(source.editorialOrder.physicalTocVerified, false);
  assert.equal(source.editorialOrder.separateHumanReceiptClaimed, false);
  assert.deepEqual([source.editorialOrder.originalIssueId, source.editorialOrder.sourcePosition,
    source.editorialOrder.publishedPosition], [66474, 20, 19]);
  assert.equal(source.preservedResearch.sourceCommit, '3178fc805b2e408246cc5332846f3d6405a32fa3');
  for (const original of source.preservedResearch.artifacts) {
    assert.equal(hashText(await text(original.path)), original.sha256);
  }
  assert.equal(mapping.candidateMetadata.length, 19);
  for (const row of mapping.rows) {
    assert.equal(row.resolutionStatus, 'exact');
    assert.equal(resolveRow(row, mapping.candidateMetadata).selectedIssueId, String(row.selectedIssueId));
    const candidate = mapping.candidateMetadata.find((entry) => entry.id === row.selectedIssueId);
    const fresh = candidate.freshMetadataEvidence;
    assert.equal(fresh.url, candidate.metadataUrl);
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
  }
});

test('Brand New Day binds actual approval to the complete current library', async () => {
  const { packet, mapping, report } = await evidence();
  const [{ report: current, library }, manifest, catalog] = await Promise.all([
    buildCurrentOwnerOverlap(mapping), json('src/data/curated-lists.json'), json('src/data/catalog.json'),
  ]);
  const peerIds = [...new Set([...manifest.lists, ...catalog.lists].map((row) => row.id))]
    .filter((peerId) => peerId !== id).sort();
  assert.deepEqual(current.comparisons.map((row) => row.orderId).sort(), peerIds);
  assert.equal(current.comparisonCount, peerIds.length);
  assert.equal(library.descriptors.filter((row) => /^marvel-knights-to-planet-x-\d{2}$/.test(row.id)).length, 78);
  assert.ok(peerIds.includes('marvel-knights-to-planet-x'));
  assert.ok(!peerIds.includes('spider-man-no-way-home-owner-selected'));
  const recordedIds = new Set(report.comparisons.map((row) => row.orderId));
  const recordedOrders = library.orders.filter((row) => recordedIds.has(row.orderId));
  const recordedManifest = historicalMcuDescriptionManifest({
    ...library.manifest,
    lists: library.manifest.lists.filter((row) => recordedIds.has(row.id)),
  });
  const recordedDigest = libraryDigestFor(recordedManifest, recordedOrders.map((row) => ({
    id: row.orderId, issueIds: row.issueIds.map(String),
  })));
  assert.equal(report.comparisonCount, 289);
  assert.equal(report.libraryDigest, recordedDigest);
  assert.deepEqual(current.comparisons.filter((row) => recordedIds.has(row.orderId)), report.comparisons);
  assert.deepEqual(legacyOwnerPeers(current.comparisons).filter((row) => row.relationship !== 'none'),
    report.comparisons.filter((row) => row.relationship !== 'none'),
    'A new meaningful relationship needs its own central review');
  assert.deepEqual(report.comparisons.filter((row) => row.relationship !== 'none')
    .map((row) => [row.orderId, row.relationship, row.sharedCount]), [
    ['amazing-spider-man-reading-order-modern-marvel-era', 'partial', 12],
    ['doctor-octopus-otto-octavius-reading-order', 'partial', 6],
    ['marvel-knights-to-planet-x', 'partial', 6],
    ['marvel-knights-to-planet-x-07', 'partial', 6],
    ['spider-man-best-of', 'partial', 6],
  ]);
  assert.equal(report.comparisons.filter((row) => row.relationship === 'none').length, 284);
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
  assert.match(mapping.relationshipReview.authorityIdentity, /central coordinator independent/);
  assert.equal(mapping.relationshipReview.approvalDigest,
    'f4caf353a23d71c80f59e2338c3ce18001b1dc6ddf8d70367bd815aa444b9d5e');
  const chapter = mapping.relationshipReview.dispositions.find((row) =>
    row.orderId === 'marvel-knights-to-planet-x-07');
  assert.match(chapter.rationale, /seven-original generated chapter shares six Coming Home/);
  assert.deepEqual(packet.insertionAnchor, { beforeId: 'agents-of-atlas-reading-order' });
  const position = manifest.lists.findIndex((row) => row.id === id);
  assert.equal(manifest.lists[position - 1].id, 'mcu-prep-fantastic-four-first-steps');
  assert.equal(manifest.lists[position + 1].id, 'mcu-prep-she-hulk');
  assert.ok(position < manifest.lists.findIndex((row) => row.id === packet.insertionAnchor.beforeId));
});

test('Brand New Day publishes one qualified guide without changing saved reader or history data', async () => {
  const { packet, mapping } = await evidence();
  const [payload, manifest, catalog, markdown, inventory] = await Promise.all([
    json('src/data/mcu_prep_spider_man_brand_new_day.json'),
    json('src/data/curated-lists.json'), json('src/data/catalog.json'),
    text(`src/data/orders/${id}.md`), json('scripts/data/cbh-mcu-companion-inventory.json'),
  ]);
  const parsed = parseChecklist(markdown);
  assert.deepEqual(parsed.entries.map((row) => row.issueId), expectedIds);
  assert.deepEqual(parsed.entries.map((row) => Number(row.sourceKey)), expectedPositions);
  assert.deepEqual(parsed.entries.map((row) => row.section), expectedGroups);
  assert.deepEqual(parsed.entries.map((row) => row.title), fixture.rows.map((row) => row[2]));
  assert.deepEqual(parsed.unresolved, []);
  assert.match(markdown, /Source position 14, selection 2, within-book position 8/);
  assert.ok(markdown.includes(fixture.gapUrl));
  assert.doesNotMatch(markdown, /- \[[ x]\].*Venom Super Special|[\u2013\u2014]/);
  assert.deepEqual(payload.items.map((row) => row.issueId), expectedIds);
  assert.deepEqual(payload.items.map((row) => row.collectedIn), expectedGroups);
  assert.equal(payload.count, 19);
  assert.equal(payload.collections, 3);
  assert.equal(payload.placeholders, 0);
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
    [43128, 43132]);
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

  let state = createList(createEmptyState(), { id: 'existing-spidey', name: 'My Spidey list', note: 'My list note' });
  state = addIssuesToList(state, 'existing-spidey', [{
    ...payload.items[0], collectedIn: 'My previous Coming Home section',
  }]).state;
  state = { ...state, read: { 3583: 123456 }, notes: { 3583: 'My existing Spidey note' },
    overrides: { 3583: 'unavailable' } };
  const priorList = structuredClone(state.lists['existing-spidey']);
  const historyText = JSON.stringify({
    format: LIST_HISTORY_FORMAT, version: 1,
    records: [{ listId: priorList.id, created: priorList.created, catalogId: null,
      completedAt: 123457, rating: 'up' }],
  });
  const saved = new Map([[LIST_HISTORY_KEY, historyText]]);
  const history = new ListHistoryStore({ storage: { getItem: (key) => saved.get(key) ?? null } });
  assert.equal(history.load().ok, true);
  state = createList(state, { id: 'brand', name: payload.name, catalogId: id, description: payload.description });
  state = addIssuesToList(state, 'brand', payload.items).state;
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(state.lists['existing-spidey'], priorList);
  assert.deepEqual(state.lists.brand.itemIds, expectedIds);
  assert.equal(state.lists.brand.collectedIn[3583], groups[0]);
  assert.equal(Object.hasOwn(state.issues[3583], 'collectedIn'), false);
  assert.equal(Object.keys(state.issues).filter((key) => key === '3583').length, 1);
  const backup = exportBackup(state);
  const restored = validateBackup(backup);
  assert.equal(restored.ok, true, restored.errors.join('; '));
  assert.deepEqual(restored.state.lists.brand.itemIds, expectedIds);
  assert.deepEqual(restored.state.lists['existing-spidey'], priorList);
  assert.equal(restored.state.read[3583], 123456);
  assert.equal(restored.state.notes[3583], 'My existing Spidey note');
  assert.equal(restored.state.overrides[3583], 'unavailable');
  assert.equal(history.isCompleted(restored.state, 'existing-spidey'), true);
  assert.equal(history.getRecord(restored.state, 'existing-spidey').rating, 'up');
  assert.equal(saved.get(LIST_HISTORY_KEY), historyText);
  assert.equal(Object.hasOwn(backup, 'listHistory'), false);
});
