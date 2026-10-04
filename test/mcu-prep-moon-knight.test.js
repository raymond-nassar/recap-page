import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HOME_CATEGORIES, groupCatalog, parseCatalog, pathPlacements, shelfLists,
} from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { MAX_COLLECTION } from '../src/js/lib/model.js';
import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences, digestCanonicalJson, libraryDigestExcludingOrders,
  libraryDigestFor, validateFrozenPacket, validateMappingDigest, validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport, issueIdsFromValue } from '../scripts/lib/cbh-overlap.mjs';
import { loadLibrarySnapshot } from '../scripts/report-order-overlap.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const id = 'mcu-prep-moon-knight';
const laterId = 'mcu-prep-thunderbolts';
const expectedSelections = [
  {
    supplied: 'Moon Knight by Warren Ellis Vol. 1: From the Dead',
    title: 'Moon Knight Vol. 1: From the Dead',
    writer: 'Warren Ellis',
    isbn: '9780785154082',
    year: 2014,
    seriesId: 18467,
    issueIds: [49077, 49078, 49079, 49080, 49081, 49082],
  },
  {
    supplied: 'Moon Knight by Jeff Lemire Vol. 1: Resurrection War',
    title: 'Moon Knight Vol. 1: Lunatic',
    writer: 'Jeff Lemire',
    isbn: '9780785199533',
    year: 2016,
    seriesId: 20488,
    issueIds: [55575, 55577, 55579, 55580, 55581],
  },
  {
    supplied: 'Moon Knight by Jed MacKay Vol. 1: Lockdown',
    title: 'Moon Knight Vol. 1: The Midnight Mission',
    writer: 'Jed MacKay',
    isbn: '9781302931100',
    year: 2021,
    seriesId: 32071,
    issueIds: [93848, 93849, 93850, 93851, 93852, 93853],
  },
];
const expectedIssueIds = expectedSelections.flatMap((selection) => selection.issueIds);
const expectedGroups = expectedSelections.map((selection) => `${selection.title} (${selection.writer})`);
const expectedScreenIds = [
  'doctor-strange-multiverse-of-madness', 'spider-man-no-way-home', 'marvel-multiverse',
  'marvel-what-if', 'wandavision', 'spider-man-far-from-home', laterId, id,
];
const sourceOrigin = 'Selected by the owner for MCU Prep; expanded into original issues for this project';
const packetValidation = {
  provider: {
    id: 'owner-authored', hosts: ['github.com'], sourceOrigin,
    requireSourceProvider: true, requireSourceContentSha256: true,
  },
};
const projectionFields = [
  'schemaVersion', 'id', 'sourceProvider', 'sourceIssue', 'sourceRetrievedAt',
  'selectionOrigin', 'boundary', 'identityDecision', 'selections',
];

async function readJson(...parts) {
  return JSON.parse(await readFile(join(root, ...parts), 'utf8'));
}

test('Moon Knight provenance keeps all three supplied positions apart from verified bibliography', async () => {
  const ledger = await readJson('scripts', 'data', 'owner-selections', `${id}.json`);
  assert.equal(ledger.id, id);
  assert.equal(ledger.sourceProvider, 'owner-authored');
  assert.equal(ledger.sourceIssue, 'https://github.com/raymond-nassar/recap-page/issues/685');
  assert.equal(ledger.identityDecision.status, 'approved');
  assert.equal(ledger.identityDecision.approvedBy, 'raymond-nassar');
  assert.equal(ledger.identityDecision.decisionEvidence,
    'https://github.com/raymond-nassar/recap-page/issues/685#issuecomment-5971776857');
  assert.deepEqual(ledger.identityDecision.approvedCorrections, [
    { position: 2, suppliedSubtitle: 'Resurrection War', approvedSubtitle: 'Lunatic' },
    { position: 3, suppliedSubtitle: 'Lockdown', approvedSubtitle: 'The Midnight Mission' },
  ]);
  assert.deepEqual(ledger.selections.map((selection) => selection.identityStatus),
    ['verified', 'owner-approved-title-correction', 'owner-approved-title-correction']);
  assert.deepEqual(ledger.selections.map((selection) => selection.position), [1, 2, 3]);
  assert.equal(ledger.selections.length, expectedSelections.length);
  for (const [index, selection] of ledger.selections.entries()) {
    const expected = expectedSelections[index];
    const edition = selection.verifiedEdition;
    assert.equal(selection.suppliedTitle, expected.supplied);
    assert.ok(selection.suppliedRationale.trim());
    assert.match(selection.rationaleStatus, /owner description/i);
    assert.equal(edition.title, expected.title);
    assert.equal(edition.writer, expected.writer);
    assert.equal(edition.volume, 1);
    assert.equal(edition.paperbackIsbn, expected.isbn);
    assert.equal(edition.originalSeriesTitle, 'Moon Knight');
    assert.equal(edition.originalSeriesYear, expected.year);
    assert.equal(edition.seriesId, expected.seriesId);
    assert.deepEqual(edition.issueIds, expected.issueIds);
    assert.deepEqual(edition.issues, expected.issueIds.map((_, issue) => String(issue + 1)));
    assert.ok(selection.evidence.length >= 1);
    for (const evidence of selection.evidence) {
      const url = new URL(evidence.url);
      assert.equal(url.protocol, 'https:');
      assert.ok(!['marvel.com', 'www.marvel.com', 'read.marvel.com'].includes(url.hostname));
      assert.equal(evidence.retrievedAt, '2026-10-03');
      assert.ok(evidence.basis.trim());
    }
  }
  assert.match(ledger.publicationPolicy, /bibliographic identity conflict is not a provider gap/i);
  assert.match(ledger.metadataEvidence.reuseBoundary, /selection boundary.+authorship are not reused/i);
});

test('Moon Knight publishes one selected MCU Prep card, not a character guide or reading path', async () => {
  const manifest = await readJson('src', 'data', 'curated-lists.json');
  const rawCatalog = await readJson('src', 'data', 'catalog.json');
  const catalog = parseCatalog(rawCatalog);
  const packet = await readJson('scripts', 'data', 'owner-packets', `${id}.json`);
  assert.equal(manifest.lists.filter((entry) => entry.id === id).length, 1);
  assert.equal(catalog.lists.filter((entry) => entry.id === id).length, 1);
  const entry = manifest.lists.find((entry) => entry.id === id);
  assert.equal(entry.type, 'screen-companion');
  assert.deepEqual(entry, packet.proposedManifest);
  const card = catalog.lists.find((item) => item.id === id);
  for (const item of [entry, card]) {
    assert.equal(item.name, 'Moon Knight: MCU Prep');
    assert.equal(item.type, 'screen-companion');
    assert.equal(item.depth, 'selected');
    assert.equal(item.timeline, null);
    assert.equal(item.beginner, false);
    assert.equal(item.sourceOrigin, sourceOrigin);
    assert.equal(item.sourceLicense, null);
    assert.doesNotMatch(item.description, /\borigin\b|adaptation|closest tonal|ongoing|comic book herald/i);
    assert.doesNotMatch(item.description, /[\u2013\u2014]/);
  }
  assert.equal(Object.hasOwn(entry, 'spotlightKind'), false);
  assert.equal(card.spotlightKind, null);
  assert.equal(entry.sourcePage, 'https://github.com/raymond-nassar/recap-page/issues/685');
  assert.equal(card.source, entry.sourcePage);
  assert.equal(card.count, 17);
  assert.equal(card.placeholderCount, 0);
  assert.equal(card.emptyRecordCount, 0);
  assert.deepEqual(HOME_CATEGORIES.find((category) => category.key === 'marvel-on-screen')
    .select(groupCatalog(catalog.lists)).map((story) => story.lists[0].id), expectedScreenIds);
  assert.equal(shelfLists(catalog.lists, 'spotlights').length, 70);
  assert.ok(!shelfLists(catalog.lists, 'spotlights').some((item) => item.id === id));
  assert.equal(catalog.paths.some((path) => path.steps.includes(id)), false);
  assert.equal(pathPlacements(catalog.paths, catalog.lists).has(`list:${id}`), false);
});

test('Moon Knight publishes 17 exact originals in three approved collection groups', async () => {
  const payload = await readJson('src', 'data', 'mcu_prep_moon_knight.json');
  const ledger = await readJson('scripts', 'data', 'owner-selections', `${id}.json`);
  const packet = await readJson('scripts', 'data', 'owner-packets', `${id}.json`);
  const mapping = await readJson('scripts', 'data', 'owner-mappings', `${id}.json`);
  const browserFixture = await readJson('test', 'fixtures', 'mcu-prep-moon-knight-browser-vector.json');
  const markdown = await readFile(join(root, 'src', 'data', 'orders', `${id}.md`), 'utf8');
  const parsed = parseChecklist(markdown);
  const wanted = expectedSelections.flatMap((selection, index) => selection.issueIds.map((issueId, issue) => ({
    issueId,
    title: `Moon Knight (${selection.year}) #${issue + 1}`,
    group: expectedGroups[index],
    selectionPosition: index + 1,
  })));
  assert.deepEqual(browserFixture.rows, wanted.map((row, index) => ({
    position: index + 1, issueId: row.issueId, title: row.title, section: row.group,
  })));
  assert.deepEqual([payload.count, payload.collections, payload.placeholders, payload.unresolved],
    [17, 3, 0, []]);
  assert.deepEqual(payload.items.map((item) => item.issueId), expectedIssueIds);
  assert.deepEqual(parsed.entries.map((item) => item.issueId), expectedIssueIds);
  assert.deepEqual(parsed.unresolved, []);
  assert.deepEqual(parsed.headings.slice(1), expectedGroups);
  assert.ok(expectedGroups.every((group) => group.length <= MAX_COLLECTION));
  assert.deepEqual(parsed.entries.map((item) => item.sourceKey),
    expectedIssueIds.map((_, index) => String(index + 1)));
  assert.deepEqual(packet.rows.map((row) => row.candidateIssueId), expectedIssueIds);
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), expectedIssueIds);
  assert.deepEqual(ledger.expandedRows.map((row) => row.issueId), expectedIssueIds);
  for (const [index, expected] of wanted.entries()) {
    const item = payload.items[index];
    const entry = parsed.entries[index];
    const source = ledger.expandedRows[index];
    assert.equal(item.title, expected.title);
    assert.equal(item.collectedIn, expected.group);
    assert.equal(entry.title, expected.title);
    assert.equal(entry.section, expected.group);
    assert.deepEqual(
      [source.sourcePosition, source.selectionPosition, source.originalTitle, source.collection],
      [index + 1, expected.selectionPosition, expected.title, expected.group],
    );
    assert.deepEqual(
      [packet.rows[index].sourcePosition, packet.rows[index].selectionPosition],
      [index + 1, expected.selectionPosition],
    );
    assert.equal(new URL(item.url).pathname.split('/')[3], String(expected.issueId));
    assert.equal(item.placeholder, undefined);
    assert.equal(item.description, null);
  }
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, 17);
  assert.equal(payload.sourceOrigin, sourceOrigin);
  assert.equal(payload.sourceLicense, null);
  assert.doesNotMatch(markdown, /Moon Knight \(2012\)|closest tonal match|reimagined origin|current ongoing/i);
});

test('Moon Knight vendoring accounts for every original without disguising identity conflicts as gaps', async () => {
  const ledger = await readJson('scripts', 'data', 'owner-selections', `${id}.json`);
  const payload = await readJson('src', 'data', 'mcu_prep_moon_knight.json');
  assert.equal(ledger.metadataEvidence.selectedListVendoring, 'complete');
  assert.equal(ledger.metadataEvidence.vendorCommand, 'npm run vendor -- --only=mcu-prep-moon-knight');
  assert.equal(ledger.metadataEvidence.vendoredAt, payload.generatedAt);
  assert.deepEqual(ledger.sourceGaps, []);
  assert.deepEqual(ledger.failedProviderLookups, []);
  assert.deepEqual(ledger.metadataEvidence.liveIssueChecks.map((check) => check.issueId), expectedIssueIds);
  assert.equal(ledger.metadataEvidence.liveIssueChecks.length, payload.items.length);
  for (const [index, check] of ledger.metadataEvidence.liveIssueChecks.entries()) {
    const item = payload.items[index];
    const selection = expectedSelections[check.selectionPosition - 1];
    assert.equal(check.sourcePosition, index + 1);
    assert.equal(check.issueId, item.issueId);
    assert.equal(check.url, `${payload.apiBase}/issues/${item.issueId}`);
    assert.equal(check.outcome, 'metadata-resolved');
    assert.equal(check.title, item.title);
    assert.equal(check.number, item.number);
    assert.equal(check.seriesId, selection.seriesId);
    assert.equal(item.seriesId, selection.seriesId);
    assert.ok(item.digitalId > 0);
    assert.ok(item.cover.path.startsWith('https://'));
    assert.equal(item.detailsRefused, undefined);
    assert.ok(item.creators.some((creator) => (
      creator.role === 'writer' && creator.name.toLowerCase() === selection.writer.toLowerCase()
    )));
  }
});

test('Moon Knight preserves human-approved snapshots and checks the complete current library', async () => {
  const ledger = await readJson('scripts', 'data', 'owner-selections', `${id}.json`);
  const packet = await readJson('scripts', 'data', 'owner-packets', `${id}.json`);
  const mapping = await readJson('scripts', 'data', 'owner-mappings', `${id}.json`);
  const report = await readJson('scripts', 'data', 'cbh-overlaps', `${id}.json`);
  const visibleReport = await readJson('scripts', 'data', 'owner-overlaps', `${id}-visible.json`);
  const library = await loadLibrarySnapshot();
  const catalog = await readJson('src', 'data', 'catalog.json');
  const entries = catalog.lists.filter((entry) => entry.id !== id);
  const visibleOrders = await Promise.all(entries.map(async (entry) => ({
    id: entry.id, issueIds: issueIdsFromValue(await readJson('src', 'data', entry.file)).map(String),
  })));
  const visibleDigest = libraryDigestFor({
    lists: entries.filter((entry) => entry.id !== laterId), paths: catalog.paths,
  }, visibleOrders.filter((entry) => entry.id !== laterId));
  assert.deepEqual(ledger.sourceContentProjection, projectionFields);
  const projection = Object.fromEntries(projectionFields.map((field) => [field, ledger[field]]));
  assert.equal(packet.sourceContentSha256, digestCanonicalJson(projection));
  assert.equal(ledger.sourceContentSha256, packet.sourceContentSha256);
  assert.equal(packet.sourceIssueBearingBlocksSha256, digestCanonicalJson(packet.rows));
  assert.equal(packet.sourceProvider, 'owner-authored');
  assert.equal(packet.sourceUrl, ledger.sourceIssue);
  validateFrozenPacket(packet, { expectedId: id, ...packetValidation });
  validateMappingDigest(mapping);
  assertMappingMatchesPacketOccurrences(packet, mapping);
  const projections = [
    {
      report, review: mapping.relationshipReview,
      currentLibraryDigest: libraryDigestExcludingOrders(library, [id, laterId]),
      expectedOrderIds: library.lists.filter((entry) => entry.id !== id && entry.id !== laterId)
        .map((entry) => entry.id),
      currentOrders: library.orders.filter((order) => order.orderId !== id),
      count: 203,
    },
    {
      report: visibleReport, review: mapping.visibleRelationshipReview,
      currentLibraryDigest: visibleDigest,
      expectedOrderIds: entries.filter((entry) => entry.id !== laterId).map((entry) => entry.id),
      currentOrders: visibleOrders,
      count: 280,
    },
  ];
  for (const evidence of projections) {
    validateReportDigest(evidence.report);
    assert.equal(evidence.report.comparisonCount, evidence.count);
    assert.equal(evidence.review.authorityType, 'human');
    assert.equal(evidence.review.authorityIdentity, 'raymond-nassar');
    assert.equal(evidence.review.evidence,
      'https://github.com/raymond-nassar/recap-page/issues/685#issuecomment-5971795527');
    assertApprovedRelationshipReview({
      packet, mapping: { ...mapping, relationshipReview: evidence.review },
      report: evidence.report, currentLibraryDigest: evidence.currentLibraryDigest,
      expectedOrderIds: evidence.expectedOrderIds, packetValidation,
    });
    const shared = evidence.report.comparisons.filter((row) => row.relationship !== 'none');
    assert.deepEqual(shared.map((row) => [row.orderId, row.relationship, row.sharedCount]),
      [['moon-knight-reading-order', 'candidate-subset', 17]]);
    assert.deepEqual(shared[0].sharedIds, expectedIssueIds.map(String));
    const subset = evidence.review.dispositions.find((row) => row.orderId === 'moon-knight-reading-order');
    assert.equal(subset.authorityType, 'human');
    assert.equal(subset.authorityIdentity, 'raymond-nassar');
    const current = buildComparisonReport({
      candidateIds: expectedIssueIds, orders: evidence.currentOrders,
    });
    assert.equal(current.comparisonCount, evidence.count + 1);
    assert.deepEqual(current.comparisons, [
      ...evidence.report.comparisons,
      { orderId: laterId, sharedCount: 0, sharedIds: [], relationship: 'none' },
    ].sort((left, right) => left.orderId.localeCompare(right.orderId)));
  }
  assert.ok(visibleReport.comparisons.some((row) => row.orderId === 'marvel-knights-to-planet-x-01'));
  assert.ok(!visibleReport.comparisons.some((row) => row.orderId === 'marvel-knights-to-planet-x'));
  assert.ok(report.comparisons.some((row) => row.orderId === 'marvel-knights-to-planet-x'));
  assert.equal(ledger.relationshipReports.sourceOrders.reportDigest, report.reportDigest);
  assert.equal(ledger.relationshipReports.visibleCatalog.reportDigest, visibleReport.reportDigest);
});

test('Moon Knight collection candidates match exact original issue identities, not inherited CBH labels', async () => {
  const ledger = await readJson('scripts', 'data', 'owner-selections', `${id}.json`);
  const mapping = await readJson('scripts', 'data', 'cbh-mappings', 'moon-knight-reading-order.json');
  const payload = await readJson('src', 'data', 'moon_knight_reading_order.json');
  assert.equal(expectedIssueIds.length, 17);
  assert.equal(new Set(expectedIssueIds).size, 17);
  assert.deepEqual(ledger.selections.flatMap((selection) => selection.verifiedEdition.issueIds),
    expectedIssueIds);
  for (const selection of ledger.selections) {
    const edition = selection.verifiedEdition;
    for (const [index, issueId] of edition.issueIds.entries()) {
      const exact = mapping.rows.find((row) => row.selectedIssueId === issueId);
      const issue = payload.items.find((item) => item.issueId === issueId);
      const title = `Moon Knight (${edition.originalSeriesYear}) #${index + 1}`;
      assert.ok(exact, `Missing exact metadata mapping for ${issueId}`);
      assert.ok(issue, `Missing pinned original issue ${issueId}`);
      assert.equal(exact.resolutionStatus, 'exact');
      assert.equal(exact.seriesYear, edition.originalSeriesYear);
      assert.equal(exact.seriesId, edition.seriesId);
      assert.equal(exact.issueNumber, edition.issues[index]);
      assert.equal(exact.resolvedIssueTitle, title);
      assert.equal(issue.title, title);
      assert.equal(issue.seriesId, edition.seriesId);
      assert.equal(issue.number, edition.issues[index]);
      assert.equal(new URL(issue.url).pathname.split('/')[3], String(issueId));
      assert.equal(issue.placeholder, undefined);
      assert.ok(issue.creators.some((creator) => (
        creator.role === 'writer'
        && creator.name.toLowerCase() === edition.writer.toLowerCase()
      )));
    }
  }
});
