import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildComparisonReport } from '../scripts/lib/cbh-overlap.mjs';
import {
  curatedLedgerDigestFor, curatedRelationshipReportDigestFor,
} from '../scripts/lib/owner-guide.mjs';
import {
  firstSentence, groupCatalog, parseCatalog, storyTypeStories,
} from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { assertCurrentReadingRoster, registeredCuratedGuides } from './helpers/current-reading-library.mjs';

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const sha = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const guides = [
  { id: 'mc2', count: 207, gaps: 17, type: 'era', timeline: null },
  { id: 'second-clone-saga', count: 141, gaps: 20, type: 'event', timeline: 1994 },
];

test('flat issue orders do not acquire a fictitious collected-edition section', async () => {
  for (const { id } of guides) {
    const markdown = await readFile(`src/data/orders/${id}.md`, 'utf8');
    assert.ok(parseChecklist(markdown).entries.every((row) => !row.section), id);
  }
});

for (const guide of guides) {
  test(`${guide.id} publishes exact source-order rows and accounts for every metadata gap`, async () => {
    const [historical, ledger, payload, markdown, manifest, rawCatalog] = await Promise.all([
      readJson(`scripts/data/cbro-blockers/${guide.id}.json`),
      readJson(`scripts/data/curated-source-ledgers/${guide.id}.json`),
      readJson(`src/data/${guide.id.replaceAll('-', '_')}.json`),
      readFile(`src/data/orders/${guide.id}.md`, 'utf8'),
      readJson('src/data/curated-lists.json'),
      readJson('src/data/catalog.json'),
    ]);
    const expected = historical.rows.filter((row) => row.selectedIssueId);
    const gaps = historical.rows.filter((row) => !row.selectedIssueId);
    const parsed = parseChecklist(markdown);
    assert.equal(ledger.source.historicalLedgerHashFormat, 'JSON.stringify');
    assert.equal(ledger.source.historicalLedgerSha256, sha(historical));
    assert.equal(expected.length, guide.count);
    assert.equal(gaps.length, guide.gaps);
    assert.equal(ledger.sourceRows.length, guide.count + guide.gaps);
    assert.deepEqual(ledger.sourceRows.map((row) => row.sourcePosition),
      Array.from({ length: historical.sourceRowCount }, (_, index) => index + 1));
    assert.deepEqual(ledger.sourceRows.map((row) => [row.sourcePosition, row.sourceIssueReference, row.issueNumber]),
      historical.rows.map((row) => [row.sourcePosition, row.sourceIssueReference, row.issueNumber]));
    assert.deepEqual(ledger.sourceRows.filter((row) => row.selectedIssueId).map((row) => row.selectedIssueId),
      expected.map((row) => row.selectedIssueId));
    assert.deepEqual(ledger.sourceRows.filter((row) => !row.selectedIssueId).map((row) => row.sourcePosition),
      gaps.map((row) => row.sourcePosition));
    assert.deepEqual(ledger.resolvedVector, expected.map((row) => row.selectedIssueId));
    assert.equal(ledger.resolvedVectorSha256, sha(ledger.resolvedVector));
    assert.equal(ledger.repeats.length, 0);
    for (const gap of ledger.sourceRows.filter((row) => !row.selectedIssueId)) {
      assert.equal(gap.resolutionStatus, 'metadata-gap');
      assert.ok(gap.failedLookups.length > 0);
      assert.ok(gap.failedLookups.every((lookup) => lookup.url.startsWith('https://marvel.emreparker.com/v1/')
        && lookup.status === 200 && lookup.exactMatchCount === 0 && lookup.responseSha256.length === 64));
      assert.match(gap.gapIssue, /^https:\/\/github\.com\/raymond-nassar\/recap-page\/issues\/\d+$/);
      assert.equal(gap.selectedIssueId, null);
    }
    assert.deepEqual(parsed.entries.map((row) => [row.issueId, Number(row.sourceKey)]),
      expected.map((row) => [row.selectedIssueId, row.sourcePosition]));
    assert.equal(parsed.unresolved.length, 0);
    assert.deepEqual(payload.items.map((row) => row.issueId), ledger.resolvedVector);
    assert.equal(payload.count, guide.count);
    assert.equal(payload.placeholders, 0);
    assert.equal(payload.collections, 0);
    assert.equal(new Set(payload.items.map((row) => row.issueId)).size, guide.count);
    for (const row of payload.items) {
      assert.ok(row.digitalId === null || (Number.isInteger(row.digitalId) && row.digitalId > 0));
      assert.equal(row.description, null);
      assert.ok(!row.cover || row.cover.path.startsWith('https:'));
    }
    const entry = manifest.lists.find((row) => row.id === guide.id);
    const { lists, dropped } = parseCatalog(rawCatalog);
    assert.equal(dropped, 0);
    const card = lists.find((row) => row.id === guide.id);
    assert.equal(entry.expect, guide.count);
    assert.equal(entry.type, guide.type);
    assert.equal(entry.depth, 'partial');
    assert.equal(entry.timeline, guide.timeline);
    assert.equal(entry.group, null);
    assert.equal(entry.sourceOrigin, 'Compiled for this project from Comic Book Reading Orders');
    assert.equal(entry.sourceLicense, null);
    assert.equal(card.source, historical.sourceUrl);
    assert.equal(card.count, guide.count);
    assert.deepEqual(card.storyTypes, entry.storyTypes);
    assert.deepEqual(card.tones, entry.tones ?? []);
    assert.ok(firstSentence(card.description).length <= 140);
    assert.doesNotMatch(firstSentence(card.description), /\d|reading order|\bpath\b|\blist\b|CBRO|Comic Book Reading Orders/i);
    assert.doesNotMatch(card.description, /[\u2013\u2014]/);
    assert.ok(storyTypeStories(groupCatalog(lists), { type: card.storyTypes[0] })
      .some((story) => story.lists.some((row) => row.id === guide.id)));
    assert.equal(groupCatalog(lists).find((story) => story.lists.some((row) => row.id === guide.id)).lists.length, 1);
    assertCurrentReadingRoster(manifest, rawCatalog);
  });
}

test('the batch keeps every visible and hidden peer in its factual relationship review', async () => {
  const [catalog, manifest] = await Promise.all([
    readJson('src/data/catalog.json'), readJson('src/data/curated-lists.json'),
  ]);
  const files = new Map(manifest.lists.map((entry) => [entry.id, entry.out]));
  for (const entry of catalog.lists) files.set(entry.id, entry.file);
  const orders = await Promise.all([...files].map(async ([orderId, file]) => ({
    orderId, issueIds: (await readJson(`src/data/${file}`)).items,
  })));
  // The Captain America (2025) Modern Timeline lists were registered after these reviews.
  const laterModernTimelineIds = ['captain-america-2025-our-secret-wars',
    'captain-america-2025-dooms-shadow', 'captain-america-2025-hells-angel'];
  const batchIds = ['mc2', 'second-clone-saga', 'marvel-1602', 'blood-and-thunder'];
  assert.ok(batchIds.every((id) => registeredCuratedGuides.some((entry) => entry.id === id)));
  const laterCuratedIds = registeredCuratedGuides.slice(registeredCuratedGuides
    .findLastIndex((entry) => batchIds.includes(entry.id)) + 1).map((entry) => entry.id);
  for (const guide of guides) {
    const ledger = await readJson(`scripts/data/curated-source-ledgers/${guide.id}.json`);
    // Keep the coordinator's approved two-guide snapshot intact; the supplemental review below
    // accounts for the owner's two later admissions against the complete current library.
    const report = buildComparisonReport({
      candidateIds: ledger.resolvedVector,
      orders: orders.filter((entry) => entry.orderId !== guide.id
        && !['marvel-1602', 'blood-and-thunder', ...laterModernTimelineIds, ...laterCuratedIds].includes(entry.orderId)),
    });
    assert.equal(ledger.ledgerDigest, curatedLedgerDigestFor(ledger));
    const sealedReport = { candidateId: guide.id, ledgerDigest: ledger.ledgerDigest, ...report };
    sealedReport.reportDigest = curatedRelationshipReportDigestFor(sealedReport);
    assert.deepEqual(sealedReport, ledger.relationshipReview.report);
    assert.equal(report.comparisons.filter((row) => row.relationship === 'exact').length, 0);
    const meaningful = report.comparisons.filter((row) => row.relationship !== 'none');
    assert.deepEqual(ledger.relationshipReview.decisions.map((row) => [
      row.orderId, row.relationship, row.sharedIds,
    ]), meaningful.map((row) => [row.orderId, row.relationship, row.sharedIds]));
    for (const decision of ledger.relationshipReview.decisions) {
      assert.equal(decision.authorityType, 'agent-content-review');
      assert.ok(decision.rationale);
    }
  }
  const supplemental = await readJson('scripts/data/cbro-owner-november-2026-batch-review.json');
  assert.deepEqual(supplemental.guideIssues, [1085, 1086, 1087, 1088]);
  assert.equal(supplemental.authorityType, 'agent-content-review');
  assert.deepEqual(supplemental.reports.map(({ report }) => report.candidateId),
    ['mc2', 'second-clone-saga', 'marvel-1602', 'blood-and-thunder']);
  for (const { report, decisions } of supplemental.reports) {
    const candidate = await readJson(`scripts/data/curated-source-ledgers/${report.candidateId}.json`);
    const expected = { candidateId: candidate.id, ledgerDigest: candidate.ledgerDigest,
      ...buildComparisonReport({ candidateIds: candidate.resolvedVector,
        orders: orders.filter((entry) => entry.orderId !== candidate.id
          && ![...laterModernTimelineIds, ...laterCuratedIds].includes(entry.orderId)) }) };
    expected.reportDigest = curatedRelationshipReportDigestFor(expected);
    assert.deepEqual(report, expected);
    assert.deepEqual(decisions.map(({ orderId, relationship, sharedIds }) => [orderId, relationship, sharedIds]),
      report.comparisons.filter((row) => row.relationship !== 'none')
        .map(({ orderId, relationship, sharedIds }) => [orderId, relationship, sharedIds]));
    assert.ok(decisions.every((decision) => decision.authorityType === 'agent-content-review' && decision.rationale));
  }
  const ledger = await readJson('scripts/data/curated-source-ledgers/second-clone-saga.json');
  const original = ledger.relationshipReview.report.comparisons.find((row) => row.orderId === 'original-clone-saga');
  const conspiracy = ledger.relationshipReview.report.comparisons.find((row) => row.orderId === 'clone-conspiracy');
  assert.equal(original.relationship, 'partial');
  assert.equal(original.sharedCount, 2);
  assert.deepEqual(original.sharedIds, ['6537', '6540']);
  assert.equal(conspiracy.relationship, 'none');
  assert.equal(ledger.placement.groupDecision, 'separate-story');
  assert.equal(ledger.placement.yearBasis, 'The principal saga begins in 1994; earlier recalled origin issues do not move the story to 1975.');
});
