import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import {
  digestCanonicalJson, libraryDigestFor, reportDigestFor, sourceCountsForPacket,
  validateFrozenPacket, validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport } from '../scripts/lib/cbh-overlap.mjs';
import { resolveRow } from '../scripts/lib/cbh-resolution.mjs';
import { loadCurrentOwnerLibrary } from '../scripts/lib/owner-current-library.mjs';
import {
  buildFirstStepsOverlap, OWNER_SOURCE_PROVIDER,
} from '../scripts/report-fantastic-four-overlap.mjs';
import { HOME_CATEGORIES, catalogEntries, parseCatalog } from '../src/js/lib/catalog.js';
import {
  addIssuesToList, createEmptyState, createList, exportBackup, validateBackup,
} from '../src/js/lib/model.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { ListHistoryStore, LIST_HISTORY_FORMAT, LIST_HISTORY_KEY } from '../src/js/lib/listHistory.js';
import {
  historicalMcuDescriptionEntry, historicalMcuDescriptionManifest,
} from './helpers/reading-choice-history.mjs';
import { assertFirstStepsMsMarvelReciprocal } from './helpers/first-steps-ms-marvel-reciprocal.mjs';

const id = 'mcu-prep-fantastic-four-first-steps';
const sourceUrl = 'https://github.com/raymond-nassar/recap-page/issues/701';
const vectors = [
  [12894, 13005, 13116, 13227, 13255, 13266],
  [13253, 13254, 13256],
  [15578, 15583, 15584, 15585, 15586, 15587, 15588, 15589],
  [25182, 25183, 25184, 25185, 25186],
  [48328, 48329, 48330, 48331, 48332, 49846],
];
const groups = [
  'Fantastic Four (1961) #1-6',
  'Fantastic Four: The Galactus Trilogy',
  'Fantastic Four Vol. 1: Imaginauts',
  'Fantastic Four by Jonathan Hickman Vol. 1',
  'Silver Surfer Vol. 1: New Dawn (whole Point One anthology; Silver Surfer material)',
];
const issueIds = vectors.flat();
const groupVector = vectors.flatMap((vector, index) => vector.map(() => groups[index]));
const json = async (file) => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const evidence = async () => {
  const [packet, mapping, report] = await Promise.all(
    ['packet', 'mapping', 'overlap'].map((kind) => json(`scripts/data/owner-mcu-prep/${id}.${kind}.json`)),
  );
  return { packet, mapping, report };
};

test('First Steps retains the accepted 6/3/8/5/6 source vector and cached canonical metadata', async () => {
  const { packet, mapping } = await evidence();
  assert.equal(packet.sourceUrl, sourceUrl);
  assert.equal(packet.expectedCount, 28);
  assert.doesNotThrow(() => validateFrozenPacket(packet, { provider: OWNER_SOURCE_PROVIDER }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.deepEqual(packet.rows.map((row) => row.candidateIssueId), issueIds);
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), issueIds);
  assert.deepEqual(mapping.selectionLedger.map((selection) => selection.selectedIssueIds), vectors);
  assert.equal(packet.sourceIssueBearingBlocksSha256, digestCanonicalJson(mapping.selectionLedger));
  assert.equal(packet.sourceReview.selectionLedgerDigest, packet.sourceIssueBearingBlocksSha256);
  assert.equal(packet.sourceReview.authorityType, 'human');
  assert.equal(packet.sourceReview.authorityIdentity, 'raymond-nassar');
  assert.equal(mapping.packetDigest, packet.packetDigest);
  assert.equal(createHash('sha256').update(JSON.stringify(issueIds)).digest('hex'),
    '390caf2c39ed3e4a78d79dfb1c2645fcf58f8b278fee95a7d598eab5ba7c6625');
  for (const row of mapping.rows) {
    assert.equal(row.resolutionStatus, 'exact');
    assert.equal(resolveRow(row, mapping.candidateMetadata).selectedIssueId, String(row.selectedIssueId));
    const cached = mapping.candidateMetadata.find((entry) => entry.id === row.selectedIssueId);
    assert.deepEqual(row.metadataEvidence, cached.metadataEvidence);
    assert.deepEqual(row.creators, cached.creators);
    assert.equal(cached.providerProjection.id, row.selectedIssueId);
    assert.equal(cached.providerProjection.seriesId, row.seriesId);
    assert.equal(cached.providerProjection.issueNumber, row.issueNumber);
    assert.equal(Object.hasOwn(cached.providerProjection, 'description'), false);
    assert.match(row.metadataEvidence.responseBodySha256, /^[a-f0-9]{64}$/);
    assert.match(row.metadataEvidence.urlSha256, /^[a-f0-9]{64}$/);
    assert.equal(row.metadataEvidence.status, 200);
  }
  assert.deepEqual(mapping.rows.slice(17, 22).map((row) => [row.seriesId, row.seriesYear]),
    Array.from({ length: 5 }, () => [421, 1998]));
  assert.equal(mapping.editionDisposition.physicalTocVerified, false);
  assert.equal(mapping.editionDisposition.separateHumanReviewedReceiptRequired, false);
  assert.deepEqual(sourceCountsForPacket(packet), {
    sourceOccurrenceCount: 28, sourceIdentityCount: 28, includedIssueCount: 28,
    sourceGapCount: 0, repeatedSourceReferenceCount: 0,
  });
});

test('First Steps publishes every original once with five guide-scoped collection labels', async () => {
  const { mapping } = await evidence();
  const [payload, catalog, markdown] = await Promise.all([
    json('src/data/mcu_prep_fantastic_four_first_steps.json'),
    json('src/data/catalog.json'),
    readFile(new URL(`../src/data/orders/${id}.md`, import.meta.url), 'utf8'),
  ]);
  const parsed = parseChecklist(markdown);
  assert.deepEqual(parsed.entries.map((row) => row.issueId), issueIds);
  assert.deepEqual(parsed.entries.map((row) => Number(row.sourceKey)),
    Array.from({ length: 28 }, (_, index) => index + 1));
  assert.deepEqual(parsed.entries.map((row) => row.section), groupVector);
  assert.deepEqual(parsed.unresolved, []);
  assert.deepEqual(payload.items.map((row) => row.issueId), issueIds);
  assert.deepEqual(payload.items.map((row) => row.collectedIn), groupVector);
  assert.equal(payload.count, 28);
  assert.equal(payload.collections, 5);
  assert.equal(payload.placeholders, 0);
  assert.deepEqual(payload.unresolved, []);
  assert.equal(new Set(payload.items.map((row) => row.issueId)).size, 28);
  for (const item of payload.items) {
    const candidate = mapping.candidateMetadata.find((row) => row.id === item.issueId);
    assert.equal(item.title, candidate.providerProjection.title);
    assert.equal(item.seriesId, candidate.seriesId);
    assert.equal(item.digitalId, candidate.digitalId);
    assert.deepEqual(item.cover, candidate.normalizedCover);
    assert.deepEqual(item.creators, candidate.creators
      .filter((credit) => /writer|penciler|artist/i.test(credit.role))
      .map(({ name, role }) => ({ name, role })));
    assert.equal(item.description, null);
    assert.equal(Object.hasOwn(item, 'notes'), false);
    assert.equal(Object.hasOwn(item, 'storyId'), false);
  }
  assert.deepEqual(payload.items.slice(10, 17).map((row) => row.creators),
    Array.from({ length: 7 }, () => []));
  assert.deepEqual(payload.items[9].creators, [{ name: "Gabriele Dell'otto", role: 'penciler (cover)' }]);
  const card = catalog.lists.find((row) => row.id === id);
  assert.equal(card.count, 28);
  assert.equal(card.collections, 5);
  assert.equal(card.placeholderCount, 0);
  assert.equal(card.emptyRecordCount, 0);
  assert.equal(card.coverIssueId, 12894);
  assert.deepEqual(card.cover, payload.items[0].cover);
  assert.match(card.description, /whole anthology/i);
  assert.doesNotMatch(markdown, /Owned-source draft|not registered or published|[\u2013\u2014]/);
});

test('First Steps is one independent MCU Prep choice and never revives the retired owner guide', async () => {
  const { packet } = await evidence();
  const [manifest, rawCatalog, inventory] = await Promise.all([
    json('src/data/curated-lists.json'), json('src/data/catalog.json'),
    json('scripts/data/cbh-mcu-companion-inventory.json'),
  ]);
  const entry = manifest.lists.find((row) => row.id === id);
  const card = rawCatalog.lists.find((row) => row.id === id);
  assert.deepEqual(historicalMcuDescriptionEntry(entry), packet.proposedManifest);
  for (const row of [entry, card]) {
    assert.equal(row.type, 'screen-companion');
    assert.equal(row.depth, 'selected');
    assert.equal(row.timeline, null);
    assert.equal(row.beginner, false);
    assert.equal(row.sourceLicense, null);
    assert.equal(row.group, null);
    assert.equal(row.groupName, null);
  }
  assert.equal(entry.sourcePage, sourceUrl);
  assert.equal(card.source, sourceUrl);
  const parsed = parseCatalog(rawCatalog);
  const stories = catalogEntries(parsed.lists);
  const mcu = HOME_CATEGORIES.find((category) => category.key === 'marvel-on-screen');
  const selected = mcu.select(stories).flatMap((story) => story.lists.map((list) => list.id));
  assert.deepEqual(selected, parsed.lists.filter((list) => list.type === 'screen-companion').map((list) => list.id));
  assert.equal(selected.filter((selectedId) => selectedId === id).length, 1);
  const choice = stories.find((story) => story.key === `list:${id}`);
  assert.deepEqual(choice.lists.map((list) => list.id), [id]);
  assert.ok(HOME_CATEGORIES.find((category) => category.key === 'storylines').select(stories)
    .some((story) => story.key === `list:${id}`));
  assert.ok(!HOME_CATEGORIES.find((category) => category.key === 'character-spotlights').select(stories)
    .some((story) => story.key === `list:${id}`));
  assert.ok(!manifest.lists.some((row) => row.id === 'spider-man-no-way-home-owner-selected'));
  assert.ok(!rawCatalog.lists.some((row) => row.id === 'spider-man-no-way-home-owner-selected'));
  assert.equal((await json('src/data/spider_man_no_way_home_owner_selected.json')).count, 18);
  assert.equal((await json('src/data/spider_man_no_way_home.json')).count, 17);
  assert.equal(inventory.records.length, 14);
  assert.equal(inventory.inventoryIdentitySha256,
    '3f1385d457081d0ccaa7513ae161c42895d3ce2dd05ced0d06d5bf25d47bda11');
});

test('First Steps reviews every active source and generated child without inheriting an old library seal', async () => {
  const { packet, mapping, report } = await evidence();
  const [manifest, catalog, current] = await Promise.all([
    json('src/data/curated-lists.json'), json('src/data/catalog.json'), buildFirstStepsOverlap(mapping),
  ]);
  const peerIds = [...new Set([...manifest.lists, ...catalog.lists].map((row) => row.id))]
    .filter((peerId) => peerId !== id).sort();
  assert.deepEqual(current.comparisons.map((row) => row.orderId).sort(), peerIds);
  assert.equal(current.comparisonCount, peerIds.length);
  const recordedPeers = new Set(report.comparisons.map((row) => row.orderId));
  const library = await loadCurrentOwnerLibrary(id);
  const recordedOrders = library.orders.filter((row) => recordedPeers.has(row.orderId));
  const recordedManifest = historicalMcuDescriptionManifest({
    ...library.manifest,
    lists: library.manifest.lists.filter((row) => recordedPeers.has(row.id)),
  });
  const unsigned = {
    ...current,
    libraryDigest: libraryDigestFor(recordedManifest, recordedOrders.map((row) => ({
      id: row.orderId, issueIds: row.issueIds.map(String),
    }))),
    ...buildComparisonReport({ candidateIds: issueIds, orders: recordedOrders }),
  };
  const historical = { ...unsigned, reportDigest: reportDigestFor(unsigned) };
  assert.deepEqual(historical, report);
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report,
    currentLibraryDigest: historical.libraryDigest,
    expectedOrderIds: [...recordedPeers],
    packetValidation: { provider: OWNER_SOURCE_PROVIDER },
  }));
  const reference = await json(`scripts/data/owner-mcu-prep/${id}.ms-marvel-reciprocal.json`);
  const reciprocal = await assertFirstStepsMsMarvelReciprocal({ reference, packet, mapping, report });
  assert.deepEqual(current.comparisons, reciprocal.current.comparisons,
    'Every active peer remains covered; only the exact approved reciprocal may add a shared relationship');
  assert.ok(!current.comparisons.some((row) => row.orderId === 'spider-man-no-way-home-owner-selected'));
  assert.ok(current.comparisons.some((row) => row.orderId === 'marvel-knights-to-planet-x'));
  assert.ok(current.comparisons.some((row) => row.orderId === 'marvel-knights-to-planet-x-34'));
});

test('Point One remains one shared original while the Surfer qualification stays in this guide', async () => {
  const { mapping } = await evidence();
  const payload = await json('src/data/mcu_prep_fantastic_four_first_steps.json');
  assert.equal(payload.items.at(-1).issueId, 49846);
  assert.match(payload.items.at(-1).collectedIn, /whole Point One anthology; Silver Surfer material/);
  assert.equal(mapping.anthologyIdentityContract.readerScope, 'whole-original');
  assert.equal(mapping.anthologyIdentityContract.perStoryIdsAllowed, false);
  assert.equal(mapping.anthologyIdentityContract.qualificationScope, 'guide');
  assert.equal(mapping.anthologyIdentityContract.siblingRelationshipApproval, null);
  let state = createList(createEmptyState(), { id: 'existing', name: 'Existing anthology reading' });
  state = addIssuesToList(state, 'existing', [{
    ...payload.items.at(-1), collectedIn: 'Existing anthology collection',
  }]).state;
  state = {
    ...state, read: { 49846: 123456 }, notes: { 49846: 'My existing anthology note.' },
    overrides: { 49846: 'unavailable' },
  };
  const historyText = JSON.stringify({
    format: LIST_HISTORY_FORMAT, version: 1,
    records: [{
      listId: 'existing', created: state.lists.existing.created, catalogId: null,
      completedAt: 123457, rating: 'up',
    }],
  });
  const saved = new Map([[LIST_HISTORY_KEY, historyText]]);
  const history = new ListHistoryStore({ storage: { getItem: (key) => saved.get(key) ?? null } });
  assert.equal(history.load().ok, true);
  state = createList(state, { id: 'first-steps', name: payload.name, catalogId: id });
  state = addIssuesToList(state, 'first-steps', payload.items).state;
  assert.deepEqual(state.lists['first-steps'].itemIds, issueIds);
  assert.equal(state.lists.existing.collectedIn[49846], 'Existing anthology collection');
  assert.equal(state.lists['first-steps'].collectedIn[49846], groups[4]);
  assert.equal(state.read[49846], 123456);
  assert.equal(state.notes[49846], 'My existing anthology note.');
  assert.equal(state.overrides[49846], 'unavailable');
  assert.equal(history.getRecord(state, 'existing').rating, 'up');
  assert.equal(history.isCompleted(state, 'existing'), true);
  assert.equal(saved.get(LIST_HISTORY_KEY), historyText);
  assert.equal(Object.hasOwn(state.issues[49846], 'collectedIn'), false);
  assert.equal(Object.keys(state.issues).filter((key) => key === '49846').length, 1);
  const restored = validateBackup(exportBackup(state));
  assert.equal(restored.ok, true, restored.errors.join('; '));
  assert.deepEqual(restored.state.lists['first-steps'].itemIds, issueIds);
  assert.equal(restored.state.read[49846], 123456);
  assert.equal(restored.state.notes[49846], 'My existing anthology note.');
  assert.equal(restored.state.overrides[49846], 'unavailable');
  assert.equal(history.isCompleted(restored.state, 'existing'), true);
  assert.equal(Object.hasOwn(exportBackup(state), 'listHistory'), false);
  assert.equal(restored.state.lists['first-steps'].collectedIn[49846], groups[4]);
});
