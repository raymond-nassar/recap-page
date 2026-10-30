import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences,
  libraryDigestExcludingOrders,
  libraryDigestFor,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { loadCurrentOwnerLibrary } from '../scripts/lib/owner-current-library.mjs';
import { buildReportForMapping, loadLibrarySnapshot } from '../scripts/report-order-overlap.mjs';
import { firstSentence, parseCatalog, resolveReadingPaths } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { registeredOwnerIds } from './helpers/current-reading-library.mjs';
import { recordedOwnerManifest } from './helpers/owner-delivery-contract.mjs';

// #981. The owner's Professor X selection from Comic Book Herald's guide, verified against the page,
// with the X-Men lists that continue his story offered as a Reading Path rather than copied inside.
const id = 'professor-x-reading-order';
const pathId = 'professor-x-and-the-x-men';
const readJson = async (file) => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const readText = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const MEMORIAL = 'In memory of Sir Patrick Stewart (1940 to 2026), who brought Professor X to life on screen.';
// The owner approved the path's public wording on #997, ending it as the Avengers path's ends.
const PATH_DESCRIPTION = "Professor X's essential comics first, then the X-Men stories that carry his part further: "
  + "Onslaught, Jonathan Hickman's Krakoa era and its 2024 finale. Messiah Complex, which the guide also names, "
  + 'opens the X-Men: Messiah Complex to Avengers vs. X-Men path. No two stops share an issue, so nothing is read twice.';

const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const issueAt = (position) => mapping.rows.find((row) => row.sourcePosition === position);

// The approval bound the library as it stood before this guide and its path. Lists and paths added
// since then are named by what the reviewed roster lacks, so a later addition needs no edit here.
async function reviewedLibrary() {
  const library = await loadLibrarySnapshot();
  const reviewed = new Set(report.comparisons.map((row) => row.orderId));
  const later = library.manifest.lists.map((entry) => entry.id).filter((listId) => !reviewed.has(listId));
  const laterPaths = (library.manifest.paths ?? []).map((entry) => entry.id)
    .filter((entry) => !['modern-avengers', 'x-men-messiah-to-avx'].includes(entry));
  return { library, excluded: [...later, ...laterPaths], reviewed: [...reviewed] };
}

test('Professor X keeps the page order and the owner table identities it was verified against', () => {
  assert.equal(ledger.source.issueBearingBlocksSha256, ledger.source.intakeComparison.intakeIssueBearingBlocksSha256);
  assert.equal(packet.sourceIssueBearingBlocksSha256, ledger.source.issueBearingBlocksSha256);
  assert.equal(packet.sourceContentSha256, ledger.source.contentSha256);
  assert.deepEqual(ledger.counts, {
    issueBearingBlocks: 35, selectedBlocks: 8, excludedReferences: 20, canonicalIssueRows: 58, sourceGaps: 0,
  });
  assert.equal(packet.excludedSourceReferences.length, 20);
  assert.equal(Object.hasOwn(packet, 'sourceGaps'), false);
  // The page lists Classic X-Men #31 before Uncanny X-Men #117; the owner's table had them reversed.
  assert.deepEqual([issueAt(9).selectedIssueId, issueAt(10).selectedIssueId], [20587, 12433]);
  // The table's #117 link names a 1981 series, but the issue is the 1963 series' #117.
  assert.deepEqual([issueAt(10).seriesId, issueAt(10).resolvedIssueTitle], [2258, 'Uncanny X-Men (1963) #117']);
  // Illuminati is the five-issue limited series, not the April 2006 one-shot, issue 3984.
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 1137).map((row) => row.selectedIssueId),
    [5723, 5864, 13481, 15968, 17254]);
  assert.ok(mapping.rows.every((row) => row.selectedIssueId !== 3984));
  assert.deepEqual(
    [mapping.rows[0].resolvedIssueTitle, mapping.rows.at(-1).resolvedIssueTitle],
    ['Uncanny X-Men (1963) #12', 'X-Men Legacy (2008) #225'],
  );
});

test('Professor X keeps the frozen packet, mapping, full report and approval aligned', async () => {
  const { library, excluded, reviewed } = await reviewedLibrary();
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const manifest = await readJson('src/data/curated-lists.json');
  const regenerated = await buildReportForMapping(`scripts/data/cbh-mappings/${id}.json`, [], {
    excludedOrderIds: excluded,
  });

  assert.deepEqual(regenerated, report);
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: id,
    inventoryRecord: inventory.find((record) => record.id === id),
    catalogEntries: manifest.lists.filter((entry) => entry.id !== id),
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.equal(report.candidateCount, 58);
  assert.equal(report.comparisonCount, 254);
  assert.deepEqual(
    report.comparisons.reduce((counts, row) => ({ ...counts, [row.relationship]: (counts[row.relationship] ?? 0) + 1 }), {}),
    { none: 239, partial: 15 },
  );
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: libraryDigestExcludingOrders(library, excluded),
    expectedOrderIds: reviewed,
  }));
});

test('Professor X inventory lifecycle matches the approved source and relationships', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const record = inventory.find((row) => row.id === id);
  assert.deepEqual(record.overlapIds, report.comparisons
    .filter((row) => row.relationship !== 'none').map((row) => row.orderId).sort());
  assert.deepEqual({
    position: record.position,
    url: record.url,
    sourceRetrievedAt: record.sourceRetrievedAt,
    sourceContentSha256: record.sourceContentSha256,
    catalogIds: record.catalogIds,
    disposition: record.disposition,
    deliveryStatus: record.deliveryStatus,
    centralDisposition: record.centralDisposition,
    metadataHorizonStatus: record.metadataHorizonStatus,
  }, {
    position: 92,
    url: packet.sourceUrl,
    sourceRetrievedAt: packet.sourceRetrievedAt,
    sourceContentSha256: packet.sourceContentSha256,
    catalogIds: [id],
    disposition: 'new-order',
    deliveryStatus: 'shipped',
    centralDisposition: 'pilot-approved',
    metadataHorizonStatus: 'approved',
  });
});

test('Professor X publishes the checklist, payload and spotlight entry with the memorial last', async () => {
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = parseCatalog(await readJson('src/data/catalog.json'));
  const entry = manifest.lists.find((row) => row.id === id);
  const card = catalog.lists.find((row) => row.id === id);
  const payload = await readJson(`src/data/${entry.out}`);
  const markdown = await readText(`src/data/orders/${entry.sourceFile}`);
  const parsed = parseChecklist(markdown);

  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  assert.equal(parsed.entries.length, 58);
  assert.equal(parsed.unresolved.length, 0);
  assert.deepEqual(payload.items.map((item) => item.issueId), mapping.rows.map((row) => row.selectedIssueId));
  assert.equal(payload.items.filter((item) => item.placeholder).length, 0);
  assert.deepEqual(
    [card.type, card.spotlightKind, card.depth, card.count, card.placeholderCount, card.emptyRecordCount,
      card.collections, card.coverIssueId, card.timeline, card.source, card.sourceOrigin],
    ['character-run', 'best-of', 'selected', 58, 0, 0, 0, 12436, null,
      'https://www.comicbookherald.com/professor-x-reading-order/',
      "Compiled for this project from Comic Book Herald's guide"],
  );
  // The memorial closes About this order and Preview; cards show only the first sentence.
  assert.ok(entry.description.endsWith(` ${MEMORIAL}`));
  assert.equal(entry.description.split(MEMORIAL).length, 2);
  assert.equal(card.description, entry.description);
  assert.notEqual(firstSentence(card.description), MEMORIAL);
  assert.doesNotMatch(firstSentence(card.description), /Patrick Stewart/);
  for (const text of [entry.name, entry.description]) {
    assert.doesNotMatch(text, /[\u2013\u2014]/);
    assert.doesNotMatch(text, /unlimited|availab/i);
  }
});

test('the Professor X path starts at the spotlight and continues to the X-Men lists that carry his story', async () => {
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = parseCatalog(await readJson('src/data/catalog.json'));
  const steps = [
    id,
    'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order',
    'hickman-x-men',
    'fall-house-x-rise-powers-x',
  ];
  assert.deepEqual(manifest.paths.find((entry) => entry.id === pathId).steps, steps);
  const resolved = resolveReadingPaths(catalog.paths, catalog.lists);
  const path = resolved.find((entry) => entry.id === pathId);
  assert.deepEqual(path.stops.map((stop) => stop.stepId), steps);
  // Messiah Complex already opens its own path, and a stop on two paths would be offered two
  // next stops when it is finished, which #897 accepted as one.
  assert.deepEqual(resolved.filter((entry) => entry.stops.some((stop) => stop.stepId === 'messiah-complex'))
    .map((entry) => entry.id), ['x-men-messiah-to-avx']);
  assert.ok(manifest.lists.find((entry) => entry.id === id).description
    .includes(`continue on the ${path.name} path in Modern Timeline.`));
  assert.equal(manifest.paths.find((entry) => entry.id === pathId).description, PATH_DESCRIPTION);
  assert.equal((await readJson('src/data/catalog.json')).paths.find((entry) => entry.id === pathId).description,
    PATH_DESCRIPTION);
});

// Onslaught is an owner guide with open gaps, so its library will be recorded again. That record
// keeps this path, which names Onslaught itself, and the rebuilt record has to keep it too.
test('an owner guide on the Professor X path keeps the path when its library is next recorded', async () => {
  const manifest = await readJson('src/data/curated-lists.json');
  const owners = manifest.paths.find((entry) => entry.id === pathId).steps
    .filter((step) => registeredOwnerIds.includes(step));
  assert.deepEqual(owners, ['the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order']);
  for (const candidateId of owners) {
    const library = await loadCurrentOwnerLibrary(candidateId);
    const vectors = library.orders.map((entry) => ({ id: entry.orderId, issueIds: entry.issueIds.map(String) }));
    const rebuilt = recordedOwnerManifest(library.manifest, new Set(vectors.map((entry) => entry.id)), { candidateId });
    assert.ok(rebuilt.paths.some((entry) => entry.id === pathId));
    assert.equal(libraryDigestFor(rebuilt, vectors), library.libraryDigest);
  }
});
