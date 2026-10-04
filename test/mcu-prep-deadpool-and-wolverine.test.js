import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import { buildComparisonReport } from '../scripts/lib/cbh-overlap.mjs';
import {
  digestCanonicalJson,
  libraryDigestExcludingOrders,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import {
  availableHomeCategories, groupCatalog, HOME_CATEGORIES, parseCatalog, shelfKey,
} from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  addIssuesToList, createEmptyState, createList, markRead, setDeferred, setIssueNote,
} from '../src/js/lib/model.js';
import { Store } from '../src/js/storage.js';
import {
  assertCurrentLibraryExtension, libraryVectorDigest,
} from './helpers/owner-mcu-library-extension.mjs';

const id = 'mcu-prep-deadpool-and-wolverine';
const stem = `owner-${id}`;
const readText = (relative) => readFile(new URL(relative, import.meta.url), 'utf8');
const readJson = async (relative) => JSON.parse(await readText(relative));
const expectedVector = [
  10155, 10156, 10157, 10158, 10159, 10160, 10161, 10162, 10164, 10165, 10166, 10167, 10168,
  43797, 43801, 44870, 46038, 46040, 46042,
  660, 723, 531, 1808, 843, 927,
  21330, 21508, 21710, 22475, 22876, 23744, 23934, 27129,
  10441, 8453, 8454, 8455, 8456, 8457, 8458, 8459, 8460, 8462,
];
const expectedTitles = [
  'Wolverine: Weapon X',
  'Deadpool Vol. 1: Dead Presidents',
  'Astonishing X-Men: Gifted',
  'Wolverine: Old Man Logan',
  'Deadpool Classic Vol. 1',
];
const provider = {
  id: 'owner-authored',
  hosts: ['github.com'],
  sourceOrigin: "Compiled for this project from the owner's selections",
  requireSourceProvider: true,
  requireSourceContentSha256: true,
};

async function loadEvidence() {
  const [sourceText, packet, mapping, report, manifest, catalog, payload, markdown] = await Promise.all([
    readText(`../scripts/data/${stem}-source.json`),
    readJson(`../scripts/data/${stem}-packet.json`),
    readJson(`../scripts/data/${stem}-mapping.json`),
    readJson(`../scripts/data/${stem}-overlap.json`),
    readJson('../src/data/curated-lists.json'),
    readJson('../src/data/catalog.json'),
    readJson('../src/data/mcu_prep_deadpool_and_wolverine.json'),
    readText('../src/data/orders/mcu-prep-deadpool-and-wolverine.md'),
  ]);
  return { sourceText, source: JSON.parse(sourceText), packet, mapping, report,
    manifest, catalog, payload, parsed: parseChecklist(markdown) };
}

async function loadCompleteLibrary(manifest, catalog) {
  const catalogIds = new Set(catalog.lists.map((entry) => entry.id));
  const completeManifest = {
    lists: [
      ...catalog.lists.map((entry) => ({ ...entry, out: entry.file })),
      ...manifest.lists.filter((entry) => !catalogIds.has(entry.id)),
    ],
    paths: catalog.paths,
  };
  const orders = await Promise.all(completeManifest.lists.map(async (entry) => ({
    id: entry.id,
    issueIds: (await readJson(`../src/data/${entry.out}`)).items.map((item) => String(item.issueId)),
  })));
  return { completeManifest, orders, catalogIds };
}

test('owner provenance preserves all five selections and the authorized title reconciliation', async () => {
  const { source } = await loadEvidence();
  assert.deepEqual(source.selections.map((selection) => selection.position), [1, 2, 3, 4, 5]);
  assert.deepEqual(source.selections.map((selection) => selection.collectionTitle), expectedTitles);
  assert.deepEqual(source.selections.map((selection) => selection.sourcePositions.length), [13, 6, 6, 8, 10]);
  assert.deepEqual(source.selections.flatMap((selection) => selection.sourcePositions),
    Array.from({ length: 43 }, (_, index) => index + 1));
  const deadPresidents = source.selections[1];
  assert.equal(deadPresidents.originalTitle, 'Deadpool by Daniel Way Vol. 1: Dead Presidents');
  assert.equal(deadPresidents.reconciliation.authorityIdentity, 'raymond-nassar');
  assert.equal(deadPresidents.reconciliation.decisionUrl,
    'https://github.com/raymond-nassar/recap-page/issues/680#issuecomment-5971701868');
  assert.deepEqual(deadPresidents.creditedCreators.slice(0, 2), ['Gerry Duggan', 'Brian Posehn']);
  assert.match(source.selections[0].expansionNote, /serial.+original whole comics/i);
  assert.equal(source.selections[4].reconciliation.kind, 'owner-delegated-single-volume-selection');
  assert.match(source.selections[4].expansionNote, /no unverified Wolverine encounter/i);
  assert.match(source.claimPolicy.publishedCopy, /No.+film-inspiration.+antagonism/i);
  assert.ok(source.selections.every((selection) => selection.evidence.length > 0
    && selection.evidence.every((evidence) => evidence.retrievedAt === '2026-10-03'
      && evidence.url.startsWith('https://'))));
});

test('the published original issue vector and five collection boundaries match the frozen source', async () => {
  const { source, packet, mapping, payload, parsed } = await loadEvidence();
  const expanded = source.selections.flatMap((selection) => selection.contents.flatMap((range) => (
    range.issueIds.map((issueId, index) => ({
      issueId, number: range.issueNumbers[index], seriesId: range.seriesId,
      seriesYear: range.seriesYear, collectionTitle: selection.collectionTitle,
    }))
  )));
  assert.equal(new Set(expectedVector).size, 43);
  assert.deepEqual(expanded.map((row) => row.issueId), expectedVector);
  assert.deepEqual(packet.rows.map((row) => row.candidateIssueId), expectedVector);
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), expectedVector);
  assert.deepEqual(parsed.entries.map((row) => row.issueId), expectedVector);
  assert.deepEqual(payload.items.map((row) => row.issueId), expectedVector);
  assert.deepEqual(parsed.entries.map((row) => Number(row.sourceKey)),
    Array.from({ length: 43 }, (_, index) => index + 1));
  for (const [index, expected] of expanded.entries()) {
    const item = payload.items[index];
    const metadata = mapping.candidateMetadata[index];
    assert.equal(item.seriesId, expected.seriesId);
    assert.equal(String(item.number), expected.number);
    assert.equal(item.collectedIn, expected.collectionTitle);
    assert.equal(parsed.entries[index].section, expected.collectionTitle);
    assert.equal(metadata.id, expected.issueId);
    assert.equal(metadata.seriesId, expected.seriesId);
    assert.equal(Number(/\((\d{4})/.exec(metadata.seriesName)?.[1]), expected.seriesYear);
    assert.equal(metadata.issueNumber, expected.number);
    assert.equal(metadata.lookup.status, 200);
    assert.equal(metadata.lookup.url, `https://marvel.emreparker.com/v1/issues/${expected.issueId}`);
    assert.equal(item.url, metadata.detailUrl);
    assert.equal(item.description, null);
    assert.notEqual(item.placeholder, true);
    assert.notEqual(item.detailsRefused, true);
  }
});

test('count and gap coverage account for every expanded original without placeholders or substitutions', async () => {
  const { source, packet, mapping, payload, parsed } = await loadEvidence();
  assert.deepEqual(
    [source.selectionCount, source.expandedIssueCount, source.publishedIssueCount, source.gapCount],
    [5, 43, 43, 0],
  );
  assert.deepEqual(source.sourceGaps, []);
  assert.deepEqual(source.repeatedSourceReferences, []);
  assert.deepEqual([packet.expectedCount, mapping.approvedSourceCount, payload.count, payload.collections],
    [43, 43, 43, 5]);
  assert.equal(payload.placeholders, 0);
  assert.deepEqual(payload.unresolved, []);
  assert.deepEqual(parsed.unresolved, []);
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, 43);
});

test('owner evidence reuses the frozen packet and mapping contracts without CBH attribution', async () => {
  const { sourceText, source, packet, mapping, manifest, payload } = await loadEvidence();
  assert.doesNotThrow(() => validateFrozenPacket(packet, { provider, expectedId: id }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.equal(packet.sourceContentSha256,
    createHash('sha256').update(sourceText.replace(/\r\n/g, '\n'), 'utf8').digest('hex'));
  assert.equal(packet.sourceIssueBearingBlocksSha256, digestCanonicalJson(source.selections));
  const entry = manifest.lists.find((list) => list.id === id);
  assert.deepEqual(packet.proposedManifest, entry);
  assert.deepEqual(mapping.proposedManifest, entry);
  assert.equal(payload.source, source.sourceUrl);
  assert.equal(entry.sourceOrigin, provider.sourceOrigin);
  assert.equal(payload.sourceOrigin, provider.sourceOrigin);
  assert.equal(entry.sourceLicense, null);
  assert.equal(payload.sourceLicense, null);
  assert.doesNotMatch(entry.sourceOrigin, /Comic Book Herald/);
  const inventory = await readJson('../scripts/data/cbh-mcu-companion-inventory.json');
  assert.equal(inventory.records.length, 14);
  assert.ok(inventory.records.every((record) => record.id !== id));
  assert.doesNotMatch(entry.description, /[\u2013\u2014]|film.+inspir|costume|antagonism/i);
});

test('MCU Prep discovery preserves six CBH guides and all five distinct owner companions', async () => {
  const { manifest, catalog: raw } = await loadEvidence();
  const catalog = parseCatalog(raw);
  const entry = manifest.lists.find((list) => list.id === id);
  const card = catalog.lists.find((list) => list.id === id);
  assert.equal(manifest.lists.length, 208);
  assert.equal(catalog.lists.length, 285);
  assert.equal(manifest.lists.filter((list) => list.id === id).length, 1);
  assert.equal(catalog.lists.filter((list) => list.id === id).length, 1);
  for (const value of [entry, card]) {
    assert.deepEqual([value.type, value.depth, value.timeline, value.beginner],
      ['screen-companion', 'selected', null, false]);
    assert.equal(value.spotlightKind ?? null, null);
  }
  assert.equal(Object.hasOwn(entry, 'spotlightKind'), false);
  assert.equal(card.name, 'MCU Prep: Deadpool & Wolverine');
  assert.equal(card.count, 43);
  assert.equal(card.collections, 5);
  assert.equal(shelfKey({ lists: [card] }), 'lines');
  const stories = groupCatalog(catalog.lists);
  const category = HOME_CATEGORIES.find((item) => item.key === 'marvel-on-screen');
  assert.equal(category.route, 'marvel-on-screen');
  assert.deepEqual(category.select(stories).map((story) => story.lists[0].id), [
    'doctor-strange-multiverse-of-madness', 'spider-man-no-way-home', 'marvel-multiverse',
    'marvel-what-if', 'wandavision', 'spider-man-far-from-home', 'mcu-prep-thunderbolts',
    'mcu-prep-eternals', id, 'mcu-prep-daredevil-born-again',
    'spider-man-no-way-home-owner-selected',
  ]);
  assert.equal(availableHomeCategories(stories).find((item) => item.key === category.key).count, 11);
  assert.ok(catalog.paths.every((readingPath) => !readingPath.steps.includes(id)));
});

test('approved relationships cover the complete library including generated children and noncatalog parents', async () => {
  const { packet, mapping, report, manifest, catalog } = await loadEvidence();
  const extension = await readJson(`../scripts/data/${stem}-current-library-extension.json`);
  const { completeManifest, orders, catalogIds } = await loadCompleteLibrary(manifest, catalog);
  const expectedPeers = orders.filter((entry) => entry.id !== id);
  const added = extension.extensions.find((entry) => entry.candidateId === id);
  const recordedPeerIds = new Set([
    ...report.comparisons.map((entry) => entry.orderId),
    ...added.laterComparisons.map((entry) => entry.orderId),
  ]);
  const recordedOrders = orders.filter((entry) => entry.id === id || recordedPeerIds.has(entry.id));
  const { current: recorded, laterIds } = assertCurrentLibraryExtension({
    extension, candidateId: id, candidateIds: expectedVector, orders: recordedOrders,
    originalReport: report, originalApprovalDigest: mapping.relationshipReview.approvalDigest,
  });
  const current = buildComparisonReport({ candidateIds: expectedVector, orders: expectedPeers });
  assert.deepEqual(current.comparisons.map((entry) => entry.orderId).sort(),
    expectedPeers.map((entry) => entry.id).sort());
  const addedPeerIds = expectedPeers.filter((entry) => !recordedPeerIds.has(entry.id))
    .map((entry) => entry.id);
  assert.deepEqual(addedPeerIds, ['mcu-prep-daredevil-born-again']);
  assert.deepEqual(current.comparisons.filter((entry) => recordedPeerIds.has(entry.orderId)),
    recorded.comparisons);
  assert.deepEqual(current.comparisons.filter((entry) => !recordedPeerIds.has(entry.orderId))
    .map((entry) => [entry.relationship, entry.sharedCount, entry.sharedIds]), [['none', 0, []]]);
  assert.deepEqual(current.comparisons.filter((entry) => entry.relationship !== 'none'),
    report.comparisons.filter((entry) => entry.relationship !== 'none'),
    'A new or changed nonempty relationship does not inherit the frozen approval');
  assert.equal(extension.publishedBase, '7e18d3fc7c115de3afd6e38807e86b52c75cbf29');
  assert.deepEqual(laterIds, [
    'mcu-prep-eternals', 'mcu-prep-thunderbolts', 'spider-man-no-way-home-owner-selected',
  ]);
  assert.equal(current.comparisonCount, expectedPeers.length);
  assert.equal(recorded.comparisonCount, 284);
  assert.equal(current.comparisonCount, 285);
  assert.ok(expectedPeers.length >= catalog.lists.length - 1);
  assert.ok(expectedPeers.some((entry) => !manifest.lists.some((item) => item.id === entry.id)));
  assert.ok(expectedPeers.some((entry) => !catalogIds.has(entry.id)));
  assert.ok(current.comparisons.every((comparison) => comparison.relationship !== 'exact'));
  const publicationPeers = new Set(report.comparisons.map((entry) => entry.orderId));
  const reviewedPeers = expectedPeers.filter((entry) => publicationPeers.has(entry.id));
  const reviewed = buildComparisonReport({ candidateIds: expectedVector.map(String), orders: reviewedPeers });
  assert.deepEqual(report.comparisons, reviewed.comparisons);
  const libraryDigest = libraryDigestExcludingOrders(
    { manifest: completeManifest, orderIssueIds: orders }, [id, ...laterIds, ...addedPeerIds],
  );
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: libraryDigest,
    expectedOrderIds: reviewedPeers.map((entry) => entry.id), packetValidation: { provider },
  }));
  for (const comparison of report.comparisons.filter((item) => item.relationship !== 'none')) {
    const disposition = mapping.relationshipReview.dispositions.find((item) => item.orderId === comparison.orderId);
    assert.ok(['human', 'stronger-model'].includes(disposition.authorityType));
    assert.match(disposition.rationale, /owner-selected.+companion/i);
  }
});

test('later peer relationships require review even when fresh extension hashes are internally consistent', async () => {
  const { mapping, report, manifest, catalog } = await loadEvidence();
  const { orders } = await loadCompleteLibrary(manifest, catalog);
  const extension = await readJson(`../scripts/data/${stem}-current-library-extension.json`);
  const added = extension.extensions.find((entry) => entry.candidateId === id);
  const recordedIds = new Set([
    id, ...report.comparisons.map((entry) => entry.orderId),
    ...added.laterComparisons.map((entry) => entry.orderId),
  ]);
  const mutated = structuredClone(orders.filter((entry) => recordedIds.has(entry.id)));
  const peer = mutated.find((entry) => entry.id === 'mcu-prep-thunderbolts');
  peer.issueIds[0] = String(expectedVector[0]);
  added.laterComparisons = buildComparisonReport({
    candidateIds: expectedVector,
    orders: mutated.filter((entry) => Object.hasOwn(added.laterIssueVectorDigests, entry.id)),
  }).comparisons;
  assert.equal(added.laterComparisons.find((entry) => entry.orderId === peer.id)?.relationship, 'partial');
  added.laterIssueVectorDigests[peer.id] = digestCanonicalJson(peer.issueIds);
  extension.libraryVectorDigest = libraryVectorDigest(mutated);
  const unsigned = { ...extension };
  delete unsigned.extensionDigest;
  extension.extensionDigest = digestCanonicalJson(unsigned);
  assert.throws(() => assertCurrentLibraryExtension({
    extension, candidateId: id, candidateIds: expectedVector, orders: mutated,
    originalReport: report, originalApprovalDigest: mapping.relationshipReview.approvalDigest,
  }), /meaningful relationships require bounded review/);
});

test('normal import and repeat import preserve saved progress, notes, overrides and existing lists', async () => {
  const { payload } = await loadEvidence();
  const shared = payload.items.find((item) => item.issueId === 660);
  const readAt = Date.UTC(2026, 9, 3);
  let state = createList(createEmptyState(), { id: 'existing', name: 'Existing reading list', note: 'Keep this list note' });
  state = addIssuesToList(state, 'existing', [shared]).state;
  state = markRead(state, 660, true, readAt);
  state = setIssueNote(state, 660, 'Keep this issue note');
  state = setDeferred(state, 'existing', 660);
  state = { ...state, overrides: { 660: 'unavailable' } };
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const store = new Store({ storage });
  store.update(() => state);
  const existing = structuredClone(state.lists.existing);
  store.update((current) => createList(current, { id, name: payload.name, catalogId: id }));
  const first = addIssuesToList(store.state, id, payload.items);
  assert.deepEqual([first.added, first.skipped], [43, 0]);
  store.update(() => first.state);
  const second = addIssuesToList(store.state, id, payload.items);
  assert.deepEqual([second.added, second.skipped], [0, 43]);
  store.update(() => second.state);
  const reloaded = new Store({ storage });
  reloaded.load();
  assert.deepEqual(reloaded.state.lists[id].itemIds, expectedVector);
  assert.deepEqual(reloaded.state.lists[id].collectedIn,
    Object.fromEntries(payload.items.map((item) => [item.issueId, item.collectedIn])));
  assert.deepEqual(reloaded.state.lists.existing, existing);
  assert.deepEqual(reloaded.state.read, { 660: readAt });
  assert.deepEqual(reloaded.state.notes, { 660: 'Keep this issue note' });
  assert.deepEqual(reloaded.state.overrides, { 660: 'unavailable' });
  assert.equal(reloaded.state.active, 'existing');
  assert.equal(reloaded.state.schemaVersion, state.schemaVersion);
});
