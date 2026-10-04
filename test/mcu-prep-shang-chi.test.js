import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

import { assertComparisonCoverage } from '../scripts/author-cbh-packet.mjs';
import { digestCanonicalJson, libraryDigestFor, reportDigestFor, validateSourceIdentities } from '../scripts/lib/cbh-inventory.mjs';
import { validateMcuCompanionInventory } from '../scripts/lib/cbh-mcu-companion.mjs';
import { buildComparisonReport, issueIdsFromValue } from '../scripts/lib/cbh-overlap.mjs';
import { groupCatalog, HOME_CATEGORIES, parseCatalog, shelfKey } from '../src/js/lib/catalog.js';
import { parseManifest } from '../src/js/lib/curated.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const fixture = await readJson('test/fixtures/mcu-prep-shang-chi-vector.json');
const { id } = fixture;
const [ledger, report, manifest, rawCatalog] = await Promise.all([
  readJson(`scripts/data/mcu-prep-source-ledgers/${id}.json`),
  readJson(`scripts/data/mcu-prep-overlaps/${id}.json`),
  readJson('src/data/curated-lists.json'),
  readJson('src/data/catalog.json'),
]);
const input = 'https://github.com/raymond-nassar/recap-page/issues/683#issuecomment-5971742989';
const origin = "Compiled for this project from the owner's selected Comic Book Herald excerpt";
const entry = manifest.lists.find((row) => row.id === id);
const markdown = await readFile(`src/data/orders/${id}.md`, 'utf8');
const payload = await readJson(`src/data/${entry.out}`);
const parsed = parseChecklist(markdown);
const catalog = parseCatalog(rawCatalog);
const card = catalog.lists.find((row) => row.id === id);
const expected = fixture.series.flatMap((series) => Array.from(
  { length: series.last - series.first + 1 }, (_, index) => ({
    title: `${series.title} (${series.year}) #${series.first + index}`,
    number: String(series.first + index),
    seriesId: series.id,
  }),
)).map((row, index) => ({ issueId: fixture.issueIds[index], ...row }));
const sections = fixture.blockCounts.flatMap((count, index) =>
  Array(count).fill(fixture.collectedInByBlock[index]));

test('Shang-Chi MCU Prep conserves the seven-block owner replacement and dual provenance', () => {
  assert.equal(ledger.compilationInput.url, input);
  assert.equal(ledger.compilationInput.kind, 'owner-selected-excerpt');
  assert.equal(ledger.externalSource.url,
    'https://www.comicbookherald.com/shang-chi-master-of-kung-fu-reading-order/');
  assert.equal(ledger.externalSource.section, 'Latest Additions:');
  assert.equal(ledger.externalSource.verifiedAt, '2026-10-03');
  assert.deepEqual(ledger.blocks.map((block) => block.position), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(ledger.blocks.map((block) => block.issueIds.length), fixture.blockCounts);
  assert.deepEqual(ledger.blocks.flatMap((block) => block.issueIds), fixture.issueIds);
  assert.equal(ledger.blocks[2].printedTitle,
    'Shang-Chi by Greg Luen Yang Vol. 1: Brothers & Sisters');
  assert.equal(ledger.blocks[2].title,
    'Shang-Chi by Gene Luen Yang Vol. 1: Brothers & Sisters');
  assert.deepEqual(ledger.excludedSourceReferences, [{
    title: 'King in Black: Atlantis Attacks',
    originalIssues: 'Atlantis Attacks (2020) #1-5',
    reason: 'Not selected in the owner-approved excerpt; not a provider metadata gap.',
  }]);
  assert.deepEqual(ledger.supersededOutline.map((row) => row.position), [1, 2, 3]);
  assert.ok(ledger.supersededOutline.every((row) => row.status === 'superseded'));
  assert.deepEqual(ledger.metadataGaps, []);
  assert.deepEqual(ledger.unresolvedSelections, []);
  assert.equal(ledger.vectorSha256, fixture.vectorSha256);
  assert.equal(digestCanonicalJson(fixture.issueIds), fixture.vectorSha256);
  assert.equal(digestCanonicalJson(ledger.blocks), ledger.blocksSha256);
  assert.equal(entry.sourceOrigin, origin);
  assert.equal(entry.sourcePage, input);
  assert.equal(entry.sourceSection ?? null, null);
  assert.equal(entry.sourceLicense, null);
  assert.equal(Object.hasOwn(entry, 'sourceUrl'), false);
  assert.match(markdown, /owner's seven-block/);
  assert.ok(markdown.includes(ledger.externalSource.url));
  assert.match(markdown, /Latest Additions:/);
  assert.match(markdown, /Atlantis Attacks \(2020\) #1-5/);
  assert.doesNotMatch(markdown, /direct (?:basis|inspiration)|Greg Luen Yang/);
  assert.doesNotThrow(() => validateSourceIdentities(
    [entry], manifest.lists.filter((row) => row.id !== id),
  ));
});

test('Shang-Chi MCU Prep publishes the independent 37-original identity and order vector', () => {
  assert.equal(fixture.issueCount, 37);
  assert.equal(new Set(fixture.issueIds).size, 37);
  assert.deepEqual(ledger.occurrences.map((row) => row.sourcePosition),
    Array.from({ length: 37 }, (_, index) => index + 1));
  assert.deepEqual(ledger.occurrences.map((row) => row.issueId), fixture.issueIds);
  assert.deepEqual(parsed.entries.map((row) => row.issueId), fixture.issueIds);
  assert.deepEqual(parsed.entries.map((row) => Number(row.sourceKey)),
    Array.from({ length: 37 }, (_, index) => index + 1));
  assert.deepEqual(parsed.unresolved, []);
  assert.deepEqual(payload.items.map(({ issueId, title, number, seriesId }) => ({
    issueId, title, number, seriesId,
  })), expected);
  assert.deepEqual(payload.items.map((row) => row.collectedIn ?? null), sections);
  assert.deepEqual(parsed.entries.map((row) => row.section), sections);
  assert.equal(payload.count, 37);
  assert.equal(payload.placeholders, 0);
  assert.deepEqual(payload.unresolved, []);
  assert.ok(payload.items.every((row) => row.description === null && !row.placeholder));
  assert.deepEqual(ledger.occurrences.map(({ issueId, title, number, seriesId }) => ({
    issueId, title, number, seriesId,
  })), expected);
  for (const row of payload.items) {
    assert.match(row.url, new RegExp(`^https://www\\.marvel\\.com/comics/issue/${row.issueId}/`));
  }
  assert.equal(entry.coverIssueId, 84410);
  assert.equal(card.coverIssueId, 84410);
  assert.deepEqual(card.cover, payload.items.find((row) => row.issueId === 84410).cover);
});

test('Shang-Chi MCU Prep keeps collected editions and selected material honest with whole-issue tracking', () => {
  assert.deepEqual(ledger.storySelection, {
    blockPosition: 6,
    issueId: 95679,
    selectedMaterial: 'Shang-Chi story only',
    trackerProgressUnit: 'original issue',
  });
  assert.deepEqual(ledger.blocks.map((block) => block.trackingHeading), fixture.collectedInByBlock);
  assert.equal(ledger.blocks.filter((block) => block.trackingHeading).length, fixture.collectionCount);
  assert.equal(payload.collections, fixture.collectionCount);
  assert.equal(card.collections, fixture.collectionCount);
  assert.equal(payload.items[16].issueId, 92003);
  assert.equal(payload.items[16].collectedIn ?? null, null);
  assert.equal(ledger.occurrences[16].collectedIn, null);
  assert.equal(parsed.entries[16].section, null);
  assert.equal(parsed.entries[15].section, fixture.collectedInByBlock[2]);
  assert.equal(parsed.entries[17].section, fixture.collectedInByBlock[4]);
  assert.equal(payload.items[29].issueId, 95679);
  assert.equal(payload.items[29].title, "Marvel's Voices: Identity (2021) #1");
  assert.equal(payload.items[29].collectedIn, fixture.collectedInByBlock[5]);
  assert.match(payload.items[29].collectedIn, /Shang-Chi story only; progress is whole-issue/);
  assert.match(payload.items[5].collectedIn, /collection selects material; progress is whole-issue/);
  assert.match(markdown, /completion remains whole-issue/);
  assert.ok(payload.items.every((row) => !Object.hasOwn(row, 'storyProgress')));
});

test('Shang-Chi MCU Prep reaches the existing gateway and Storylines without a new taxonomy', () => {
  assert.equal(parseManifest(manifest).errors.length, 0);
  assert.equal(entry.name, fixture.name);
  for (const row of [entry, rawCatalog.lists.find((item) => item.id === id), card]) {
    assert.equal(row.type, 'screen-companion');
    assert.equal(row.depth, 'selected');
    assert.equal(row.timeline, null);
    assert.equal(row.beginner, false);
  }
  assert.equal(Object.hasOwn(entry, 'spotlightKind'), false);
  assert.equal(Object.hasOwn(payload, 'spotlightKind'), false);
  assert.equal(card.spotlightKind, null);
  assert.equal(shelfKey({ lists: [card] }), 'lines');
  const screen = HOME_CATEGORIES.find((row) => row.key === 'marvel-on-screen');
  assert.equal(screen.heading, 'MCU Prep');
  assert.deepEqual(screen.select(groupCatalog(catalog.lists))
    .flatMap((story) => story.lists.map((row) => row.id)),
  catalog.lists.filter((row) => row.type === 'screen-companion').map((row) => row.id));
  assert.equal(catalog.lists.filter((row) => row.id === id).length, 1);
  assert.equal(manifest.lists.filter((row) => row.id === id).length, 1);
  assert.equal(card.source, input);
  assert.equal(card.sourceOrigin, origin);
  assert.equal(payload.source, input);
  assert.equal(payload.sourceOrigin, origin);
  assert.equal(payload.sourceLicense, null);
  assert.equal(card.count, 37);
  assert.equal(card.placeholderCount, 0);
  assert.equal(card.emptyRecordCount, 0);
  assert.equal(catalog.paths.some((row) => row.steps.includes(id)), false);
});

test('Shang-Chi MCU Prep retains historical comparisons and covers the complete current library', async () => {
  const sourceIds = new Set(report.coverage.sourceOrderIds);
  const childIds = new Set(report.coverage.generatedChildIds);
  const sourceEntries = manifest.lists.filter((row) => sourceIds.has(row.id));
  const childEntries = rawCatalog.lists.filter((row) => childIds.has(row.id));
  assert.equal(sourceEntries.length, 203);
  assert.equal(childEntries.length, 78);
  assert.equal(report.coverage.visibleCatalogCount, 280);
  assert.equal(report.coverage.hiddenParentCount, 1);
  assert.equal(report.coverage.totalCompared, 281);
  const entries = [...sourceEntries, ...childEntries];
  const orders = await Promise.all(entries.map(async (row) => ({
    id: row.id,
    issueIds: issueIdsFromValue(await readJson(path.join('src', 'data', row.out ?? row.file))),
  })));
  const baselineManifest = { ...manifest, lists: entries };
  const digest = libraryDigestFor(baselineManifest, orders);
  assert.equal(digest, report.libraryDigest);
  const actual = buildComparisonReport({ candidateIds: fixture.issueIds, orders });
  assert.deepEqual(actual.comparisons, report.comparisons);
  assert.equal(report.reportDigest, reportDigestFor(report));
  assert.doesNotThrow(() => assertComparisonCoverage(report, {
    candidateId: id, candidateCount: 37, expectedOrderIds: entries.map((row) => row.id),
  }));
  const shared = report.comparisons.filter((row) => row.relationship !== 'none');
  assert.deepEqual(shared.map((row) => [row.orderId, row.relationship, row.sharedCount]), [
    ['agents-of-atlas-reading-order', 'partial', 5],
    ['iron-man-reading-order', 'partial', 6],
    ['shang-chi-master-of-kung-fu-reading-order', 'candidate-subset', 37],
    ['silk-cindy-moon-reading-order', 'partial', 4],
  ]);
  assert.equal(report.comparisons.filter((row) => row.relationship === 'none').length, 277);
  assert.equal(report.comparisons.some((row) => row.relationship === 'exact'), false);
  const currentSourceIds = new Set(manifest.lists.map((row) => row.id));
  const currentEntries = [
    ...manifest.lists.filter((row) => row.id !== id),
    ...rawCatalog.lists.filter((row) => !currentSourceIds.has(row.id)),
  ];
  const currentOrders = await Promise.all(currentEntries.map(async (row) => ({
    id: row.id,
    issueIds: issueIdsFromValue(await readJson(path.join('src', 'data', row.out ?? row.file))),
  })));
  const current = buildComparisonReport({ candidateIds: fixture.issueIds, orders: currentOrders });
  assert.equal(current.comparisonCount, 286);
  assert.equal(current.comparisonCount, currentEntries.length);
  assert.doesNotThrow(() => assertComparisonCoverage(current, {
    candidateId: id,
    candidateCount: 37,
    expectedOrderIds: currentEntries.map((row) => row.id),
  }));
  const reviewedIds = new Set(report.comparisons.map((row) => row.orderId));
  assert.deepEqual(current.comparisons.filter((row) => reviewedIds.has(row.orderId)), report.comparisons);
  assert.deepEqual(current.comparisons.filter((row) => row.relationship !== 'none'), shared,
    'New meaningful relationships need central review, not inherited approval');
  assert.equal(current.comparisons.some((row) =>
    row.orderId === 'spider-man-no-way-home-owner-selected'), false);
  for (const laterId of [
    'mcu-prep-thunderbolts', 'mcu-prep-moon-knight', 'mcu-prep-eternals',
    'mcu-prep-deadpool-and-wolverine', 'mcu-prep-daredevil-born-again',
  ]) {
    const comparison = current.comparisons.find((row) => row.orderId === laterId);
    assert.deepEqual(comparison?.sharedIds, []);
    assert.equal(comparison?.relationship, 'none');
  }
  assert.equal(ledger.relationshipReview.status, 'approved');
  assert.equal(ledger.relationshipReview.authorityType, 'stronger-model');
  assert.equal(ledger.relationshipReview.authorityIdentity,
    'GPT-6.1 Sol (gpt-6.1-sol), MCU Prep coordinator');
  assert.equal(ledger.relationshipReview.vectorSha256, fixture.vectorSha256);
  assert.equal(ledger.relationshipReview.blocksSha256, ledger.blocksSha256);
  assert.equal(ledger.relationshipReview.libraryDigest, digest);
  assert.equal(ledger.relationshipReview.reportDigest, report.reportDigest);
  assert.deepEqual(ledger.relationshipReview.approvedRelationships,
    shared.map(({ orderId, relationship, sharedIds }) => ({ orderId, relationship, sharedIds })));
  assert.match(ledger.relationshipReview.decisionUrl,
    /^https:\/\/github\.com\/raymond-nassar\/recap-page\/issues\/683#issuecomment-\d+$/);
});

test('Shang-Chi MCU Prep leaves the historical fourteen-source CBH intake unchanged', async () => {
  const inventory = await readJson('scripts/data/cbh-mcu-companion-inventory.json');
  assert.doesNotThrow(() => validateMcuCompanionInventory(inventory));
  assert.equal(inventory.records.length, 14);
  assert.equal(inventory.records.some((row) => row.id === id), false);
  assert.equal(ledger.sourceFraming.decisionUrl,
    'https://github.com/raymond-nassar/recap-page/issues/683#issuecomment-5971836654');
  assert.equal(ledger.collectionMetadataCorrection.decisionUrl,
    'https://github.com/raymond-nassar/recap-page/issues/683#issuecomment-5972333151');
  assert.equal(ledger.relationshipReview.decisionUrl,
    'https://github.com/raymond-nassar/recap-page/issues/683#issuecomment-5972405708');
  assert.equal(Object.hasOwn(ledger, 'wordpressId'), false);
  assert.equal(Object.hasOwn(ledger, 'inventoryId'), false);
});
