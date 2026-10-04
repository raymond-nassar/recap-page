import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertComparisonCoverage } from '../scripts/author-cbh-packet.mjs';
import {
  digestCanonicalJson,
  validateApprovalDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport } from '../scripts/lib/cbh-overlap.mjs';
import { MCU_SELECTED_IDS } from '../scripts/lib/cbh-mcu-companion.mjs';
import {
  availableHomeCategories,
  groupCatalog,
  HOME_CATEGORIES,
  parseCatalog,
  shelfLists,
} from '../src/js/lib/catalog.js';
import { parseManifest } from '../src/js/lib/curated.js';
import { issueIdFromUrl, parseChecklist } from '../src/js/lib/markdown.js';
import {
  addIssuesToList,
  createEmptyState,
  createList,
  isRead,
  listProgress,
  markRead,
  SCHEMA_VERSION,
} from '../src/js/lib/model.js';
import { assertCurrentLibraryExtension } from './helpers/owner-mcu-library-extension.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = 'mcu-prep-thunderbolts';
const name = 'MCU Prep: Thunderbolts*';
const sourceFile = `scripts/data/${id}-source.json`;
const payloadFile = 'src/data/mcu_prep_thunderbolts.json';
const expectedIds = [
  15311, 15322, 15333, 15344, 15355, 9260, 48062, 48061, 48063,
  84365, 84366, 84367, 84368, 84369,
  91, 1492, 1579, 1668, 1764, 1870, 1978, 2190, 2308, 2421, 2422, 3084, 3188,
  57233, 57236, 57238, 57239, 57240, 57241, 78850,
];
const expectedTitles = [
  ...Array.from({ length: 5 }, (_, index) => `Thunderbolts (1997) #${index + 1}`),
  'Incredible Hulk (1962) #449',
  'Tales of the Marvel Universe (1996) #1',
  'Spider-Man Team-Up (1995) #7',
  'THUNDERBOLTS ANNUAL 1 (1997) #1',
  ...Array.from({ length: 5 }, (_, index) => `Black Widow (2020) #${index + 1}`),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 13, 14]
    .map((number) => `Captain America (2004) #${number}`),
  ...Array.from({ length: 6 }, (_, index) => `Thunderbolts (2016) #${index + 1}`),
  'Taskmaster (2020) #1',
];
const expectedSections = [
  ...Array(9).fill('Thunderbolts Classic Vol. 1'),
  ...Array(5).fill('Black Widow by Kelly Thompson Vol. 1: The Ties That Bind'),
  ...Array(13).fill('Captain America: Winter Soldier Ultimate Collection'),
  ...Array(6).fill('Thunderbolts Vol. 1: There Is No High Road'),
  null,
];
const expectedPositions = Array.from({ length: 35 }, (_, index) => index + 1)
  .filter((position) => position !== 6);
const expectedPartialPeers = [
  ['black-widow-reading-order', 13],
  ['captain-america-best-of', 13],
  ['falcon-sam-wilson-captain-america-reading-order', 13],
  ['question-of-the-week-do-you-have-a-hulk-reading-order', 1],
  ['thunderbolts-reading-order', 15],
  ['winter-soldier-bucky-barnes-reading-order', 18],
];

const readJson = async (file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const readChecklist = async () => parseChecklist(await readFile(
  path.join(root, 'src', 'data', 'orders', `${id}.md`),
  'utf8',
));

test('Thunderbolts preserves five owner selections, approved editions and all 35 source positions', async () => {
  const source = await readJson(sourceFile);
  assert.equal(source.selectionAuthority, 'owner-authored-outline');
  assert.equal(source.intakeUrl, 'https://github.com/raymond-nassar/recap-page/issues/682');
  assert.equal(source.renderingScopeApprovalUrl,
    'https://github.com/raymond-nassar/recap-page/issues/682#issuecomment-5972199443');
  assert.equal(source.sourceSelectionCount, 5);
  assert.equal(source.sourceOccurrenceCount, 35);
  assert.equal(source.publishedIssueCount, 34);
  assert.equal(source.gapCount, 1);
  assert.deepEqual(source.selections.map((selection) => selection.position), [1, 2, 3, 4, 5]);
  assert.deepEqual(source.selections.map((selection) => selection.originalSelection), [
    'Thunderbolts Classic Vol. 1 (Kurt Busiek/Mark Bagley): the original premise of villains reinventing themselves as heroes; the foundational trust-no-one concept.',
    'Black Widow by Kelly Thompson Vol. 1: The Ties That Bind: modern, movie-aligned take on Yelena Belova as a lead, not a sidekick.',
    'Captain America: The Winter Soldier (Ed Brubaker/Steve Epting): the modern reimagining of Bucky Barnes as the brainwashed Winter Soldier, core to his arc on the team.',
    "Thunderbolts by Jim Zub Vol. 1: Life Sentences: recent run with Bucky, Red Guardian, Ghost, and Taskmaster on the roster, closely mirroring the film's team.",
    'Hawkeye: Red Vendetta/Occupy Avengers era one-shot featuring Taskmaster or U.S.Agent (pick a short Taskmaster/Agent spotlight issue): quick characterization boost for the rounder roster.',
  ]);
  assert.deepEqual(source.rows.map((row) => row.sourcePosition),
    Array.from({ length: 35 }, (_, index) => index + 1));
  assert.deepEqual(source.selections.map((selection) => selection.sourcePositions.length),
    [10, 5, 13, 6, 1]);
  assert.deepEqual(source.selections.flatMap((selection) => selection.sourcePositions),
    source.rows.map((row) => row.sourcePosition));
  for (const selection of source.selections) {
    assert.deepEqual(selection.sourcePositions,
      source.rows.filter((row) => row.selection === selection.position)
        .map((row) => row.sourcePosition));
    assert.ok(selection.assessment);
    for (const key of selection.evidenceKeys) {
      const evidence = source.evidence.find((entry) => entry.key === key);
      assert.ok(evidence?.url.startsWith('https://'));
      assert.equal(evidence.retrievedAt, source.retrievedAt);
    }
  }
  assert.equal(source.selections[2].resolvedTitle,
    'Captain America: Winter Soldier Ultimate Collection');
  assert.equal(source.selections[2].isbn, '9780785143413');
  assert.equal(source.selections[2].ownerDecisionUrl,
    'https://github.com/raymond-nassar/recap-page/issues/682#issuecomment-5971692441');
  assert.equal(source.selections[3].resolvedTitle, 'Thunderbolts Vol. 1: There Is No High Road');
  assert.equal(source.selections[3].ownerDecisionUrl,
    'https://github.com/raymond-nassar/recap-page/issues/682#issuecomment-5971667297');
  assert.equal(source.selections[4].resolvedTitle, 'Taskmaster (2020) #1');
  assert.equal(source.selections[4].selectionKind, 'single-issue-spotlight');
  assert.equal(source.selections[4].collectionTitle, null);
  assert.equal(source.selections[4].collectedIn, null);
  assert.match(source.selections[4].selectionDecision, /one short.*32 pages.*miniseries opener/);
  assert.equal(source.rows.filter((row) => row.selection === 5).length, 1);
  assert.ok(!source.rows.some((row) => row.issueId === 2420 || row.issueId === 62424));
});

test('Thunderbolts checklist and payload publish exactly 34 ordered original identities', async () => {
  const [source, payload, parsed] = await Promise.all([
    readJson(sourceFile), readJson(payloadFile), readChecklist(),
  ]);
  const resolved = source.rows.filter((row) => row.status === 'resolved');
  assert.deepEqual(resolved.map((row) => row.issueId), expectedIds);
  assert.deepEqual(resolved.map((row) => row.sourcePosition), expectedPositions);
  assert.deepEqual(parsed.entries.map((entry) => entry.issueId), expectedIds);
  assert.deepEqual(parsed.entries.map((entry) => Number(entry.sourceKey)), expectedPositions);
  assert.deepEqual(parsed.entries.map((entry) => entry.title), expectedTitles);
  assert.deepEqual(parsed.entries.map((entry) => entry.section), expectedSections);
  assert.deepEqual(parsed.unresolved, []);
  assert.deepEqual(payload.items.map((item) => item.issueId), expectedIds);
  assert.deepEqual(payload.items.map((item) => item.title), expectedTitles);
  assert.deepEqual(payload.items.map((item) => item.collectedIn ?? null), expectedSections);
  assert.deepEqual(payload.items.map((item) => item.seriesId), resolved.map((row) => row.seriesId));
  assert.equal(payload.id, id);
  assert.equal(payload.name, name);
  assert.equal(payload.count, 34);
  assert.equal(payload.collections, 4);
  assert.equal(payload.placeholders, 0);
  assert.deepEqual(payload.unresolved, []);
  assert.equal(new Set(expectedIds).size, 34);
  assert.ok(payload.items.every((item) => Number.isInteger(item.issueId) && item.issueId > 0
    && item.placeholder !== true && item.description == null
    && issueIdFromUrl(item.url) === item.issueId));
  for (const alias of source.providerAliases) {
    const item = payload.items.find((entry) => entry.issueId === alias.issueId);
    assert.equal(item.title, alias.providerTitle);
    assert.equal(item.seriesName, alias.providerSeriesName);
  }
  assert.equal(payload.items.at(-1).pageCount, 32);
});

test('Thunderbolts keeps the exact minus-one gap without a guessed replacement or shipped placeholder', async () => {
  const [source, manifest] = await Promise.all([
    readJson(sourceFile), readJson('src/data/curated-lists.json'),
  ]);
  const gapRows = source.rows.filter((row) => row.status === 'provider-gap');
  assert.deepEqual(gapRows, [{
    sourcePosition: 6,
    selection: 1,
    reference: 'Thunderbolts (1997) #-1',
    seriesId: 2296,
    issueId: null,
    status: 'provider-gap',
  }]);
  assert.equal(source.rows.length, source.publishedIssueCount + source.gapCount);
  assert.equal(source.gaps.length, 1);
  assert.equal(source.gaps[0].sourcePosition, 6);
  assert.equal(source.gaps[0].reference, gapRows[0].reference);
  assert.equal(source.gaps[0].issueUrl,
    'https://github.com/raymond-nassar/recap-page/issues/687');
  assert.deepEqual(source.gaps[0].failedLookups.map((lookup) => [lookup.url, lookup.returnedRecords]), [
    ['https://marvel.emreparker.com/v1/series/2296/issues?limit=200&offset=0', 83],
    ['https://marvel.emreparker.com/v1/search/issues?q=Thunderbolts%201997%20-1&limit=100', 84],
  ]);
  assert.deepEqual(source.gaps[0].rejectedRelabelings.map((row) =>
    [row.issueId, row.title, row.issueNumber]), [
    [15311, 'Thunderbolts (1997) #1', '1'],
    [62424, 'Thunderbolts (1997) #1', '1'],
  ]);
  assert.match(manifest.lists.find((entry) => entry.id === id).description,
    /34 resolved originals.*Thunderbolts \(1997\) #-1.*documented provider gap/);
});

test('Thunderbolts uses the existing MCU Prep gateways and Storylines shelf without CBH attribution', async () => {
  const [rawManifest, rawCatalog, inventory] = await Promise.all([
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
    readJson('scripts/data/cbh-mcu-companion-inventory.json'),
  ]);
  const manifest = parseManifest(rawManifest);
  assert.deepEqual(manifest.errors, []);
  const catalog = parseCatalog(rawCatalog);
  const authored = rawManifest.lists.find((entry) => entry.id === id);
  const card = catalog.lists.find((entry) => entry.id === id);
  assert.equal(rawManifest.lists.filter((entry) => entry.id === id).length, 1);
  assert.equal(catalog.lists.filter((entry) => entry.id === id).length, 1);
  for (const entry of [authored, card]) {
    assert.equal(entry.name, name);
    assert.equal(entry.type, 'screen-companion');
    assert.equal(entry.depth, 'selected');
    assert.equal(entry.timeline, null);
    assert.equal(entry.beginner, false);
    assert.equal(entry.coverIssueId, 15311);
    assert.equal(entry.spotlightKind ?? null, null);
    assert.equal(entry.sourceLicense, null);
    assert.match(entry.sourceOrigin, /owner-authored outline.*#682/);
    assert.doesNotMatch(entry.sourceOrigin, /Comic Book Herald/);
    assert.doesNotMatch(entry.description, /[\u2013\u2014]/);
  }
  assert.equal(authored.sourceFile, `${id}.md`);
  assert.equal(Object.hasOwn(authored, 'spotlightKind'), false);
  assert.equal(Object.hasOwn(rawCatalog.lists.find((entry) => entry.id === id), 'spotlightKind'), false);
  assert.equal(authored.out, 'mcu_prep_thunderbolts.json');
  assert.equal(authored.expect, 34);
  assert.equal(card.source, 'https://github.com/raymond-nassar/recap-page/issues/682');
  assert.equal(card.count, 34);
  assert.equal(card.collections, 4);
  assert.equal(inventory.records.length, 14);
  assert.equal(inventory.records.some((entry) => entry.id === id), false);
  assert.deepEqual(inventory.records.filter((entry) => entry.centralDisposition === 'selected')
    .map((entry) => entry.id), MCU_SELECTED_IDS);
  const stories = groupCatalog(catalog.lists);
  const gateway = availableHomeCategories(stories)
    .find((category) => category.key === 'marvel-on-screen');
  assert.equal(gateway.count, catalog.lists.filter((entry) => entry.type === 'screen-companion').length);
  const category = HOME_CATEGORIES.find((entry) => entry.key === 'marvel-on-screen');
  assert.equal(category.heading, 'MCU Prep');
  assert.deepEqual(category.select(stories).map((story) => story.lists[0].id)
    .filter((candidateId) => MCU_SELECTED_IDS.includes(candidateId) || candidateId === id),
  [...MCU_SELECTED_IDS, id]);
  assert.equal(shelfLists(catalog.lists, 'lines').filter((entry) => entry.id === id).length, 1);
  assert.equal(shelfLists(catalog.lists, 'spotlights').some((entry) => entry.id === id), false);
  assert.equal(catalog.paths.some((entry) => entry.steps.includes(id)), false);
});

test('Thunderbolts keeps its frozen approval and checks the complete current library', async () => {
  const [manifest, catalog, report, payload] = await Promise.all([
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
    readJson(`scripts/data/${id}-overlaps.json`),
    readJson(payloadFile),
  ]);
  const descriptors = [
    ...catalog.lists.filter((entry) => entry.id !== id).map((entry) => ({
      orderId: entry.id, file: entry.file, descriptor: entry,
    })),
    ...manifest.lists.filter((entry) => entry.catalog === false).map((entry) => ({
      orderId: entry.id, file: entry.out, descriptor: entry,
    })),
  ].sort((left, right) => left.orderId.localeCompare(right.orderId));
  const orders = await Promise.all(descriptors.map(async (entry) => ({
    ...entry,
    issueIds: (await readJson(`src/data/${entry.file}`)).items.map((item) => String(item.issueId)),
  })));
  const currentComparison = buildComparisonReport({ candidateIds: expectedIds, orders });
  assert.equal(currentComparison.comparisonCount, catalog.lists.length - 1
    + manifest.lists.filter((entry) => entry.catalog === false).length);
  assert.deepEqual(
    currentComparison.comparisons.filter((entry) => entry.relationship !== 'none'),
    report.comparisons.filter((entry) => entry.relationship !== 'none'),
    'New meaningful relationships need central review, not inherited approval',
  );
  const reviewedIds = new Set(report.comparisons.map((entry) => entry.orderId));
  const reviewedOrders = orders.filter((entry) => reviewedIds.has(entry.orderId));
  const comparison = buildComparisonReport({ candidateIds: expectedIds, orders: reviewedOrders });
  assert.equal(comparison.comparisonCount, 281);
  assert.equal(orders.filter((entry) => /^marvel-knights-to-planet-x-\d{2}$/.test(entry.orderId))
    .length, 78);
  assert.ok(orders.some((entry) => entry.orderId === 'marvel-knights-to-planet-x'));
  const extension = await readJson(
    'scripts/data/owner-mcu-prep-deadpool-and-wolverine-current-library-extension.json',
  );
  const { current, laterIds } = assertCurrentLibraryExtension({
    extension, candidateId: id, candidateIds: expectedIds,
    orders: [...orders, { orderId: id, issueIds: payload.items.map((item) => String(item.issueId)) }],
    originalReport: report, originalApprovalDigest: report.relationshipReview.approvalDigest,
  });
  assert.deepEqual(laterIds, ['mcu-prep-deadpool-and-wolverine', 'spider-man-no-way-home-owner-selected']);
  assert.deepEqual(current, currentComparison);
  assert.equal(report.candidateId, id);
  assert.equal(report.mappingDigest, digestCanonicalJson(expectedIds.map(String)));
  assert.equal(report.libraryDigest, digestCanonicalJson(reviewedOrders));
  assert.deepEqual(report.sourceCounts, { selections: 5, occurrences: 35, resolved: 34, gaps: 1 });
  assert.deepEqual(report.comparisons, comparison.comparisons);
  assert.doesNotThrow(() => assertComparisonCoverage(report, {
    candidateId: id,
    candidateCount: 34,
    expectedOrderIds: reviewedOrders.map((entry) => entry.orderId),
  }));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.deepEqual(report.comparisons.filter((entry) => entry.relationship === 'partial')
    .map((entry) => [entry.orderId, entry.sharedCount]), expectedPartialPeers);
  assert.equal(report.comparisons.filter((entry) => entry.relationship === 'none').length, 275);
  assert.ok(report.comparisons.every((entry) => ['none', 'partial'].includes(entry.relationship)),
    'Exact duplicates and unapproved subsets have no publication path');
  const review = report.relationshipReview;
  assert.equal(review?.authorityType, 'human');
  assert.equal(review.authorityIdentity, 'raymond-nassar');
  assert.ok(review.authorityIdentity && review.rationale && review.reviewedAt);
  assert.equal(review.evidenceUrl,
    'https://github.com/raymond-nassar/recap-page/issues/682#issuecomment-5971795529');
  assert.equal((await readJson(sourceFile)).relationshipApprovalUrl, review.evidenceUrl);
  assert.equal(review.reportDigest, report.reportDigest);
  assert.equal(review.mappingDigest, report.mappingDigest);
  assert.equal(review.libraryDigest, report.libraryDigest);
  assert.doesNotThrow(() => validateApprovalDigest(review, id));
  assert.equal(review.dispositions.length, report.comparisons.length);
  assert.equal(new Set(review.dispositions.map((entry) => entry.orderId)).size, 281);
  for (const entry of report.comparisons) {
    const disposition = review.dispositions.find((value) => value.orderId === entry.orderId);
    assert.equal(disposition.relationship, entry.relationship);
    assert.equal(disposition.decision, 'approved');
    assert.ok((entry.relationship === 'none' ? ['policy', 'human', 'stronger-model']
      : ['human', 'stronger-model']).includes(disposition.authorityType));
    assert.ok(disposition.authorityIdentity && disposition.rationale);
    assert.equal(disposition.reviewedAt, review.reviewedAt);
  }
});

test('Thunderbolts import shares existing read progress without changing saved lists or schema', async () => {
  const [existing, payload] = await Promise.all([
    readJson('src/data/thunderbolts_reading_order.json'), readJson(payloadFile),
  ]);
  let state = createList(createEmptyState(), {
    id: 'existing-thunderbolts',
    name: existing.name,
    catalogId: 'thunderbolts-reading-order',
  });
  state = addIssuesToList(state, 'existing-thunderbolts',
    existing.items.map((item) => ({ ...item, source: 'curated' }))).state;
  state = markRead(state, 15311, true, 1234);
  const oldList = structuredClone(state.lists['existing-thunderbolts']);
  const oldRead = structuredClone(state.read);
  const oldOverrides = structuredClone(state.overrides);
  state = createList(state, { id: 'owner-companion', name: payload.name, catalogId: id });
  state = addIssuesToList(state, 'owner-companion',
    payload.items.map((item) => ({ ...item, source: 'curated' }))).state;
  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.deepEqual(state.lists['existing-thunderbolts'], oldList);
  assert.deepEqual(state.read, oldRead);
  assert.deepEqual(state.overrides, oldOverrides);
  assert.deepEqual(state.lists['owner-companion'].itemIds, expectedIds);
  assert.deepEqual(listProgress(state, 'owner-companion'), { read: 1, total: 34 });
  assert.equal(isRead(state, 15311), true);
  assert.equal(state.listOrder.length, 2);
});
