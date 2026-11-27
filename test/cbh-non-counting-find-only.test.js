import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildMarkdown, selectedIssueIds } from '../scripts/author-cbh-packet.mjs';
import {
  assertFindOnlySourcePositions, assertMappingMatchesPacketOccurrences, approvalDigestFor, mappingDigestFor,
  digestCanonicalJson, packetDigestFor, sourceCountsForPacket, validateFrozenPacket,
} from '../scripts/lib/cbh-inventory.mjs';
import { loadReviewedVendorFields } from '../scripts/lib/reviewed-vendor-fields.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { viewerKey } from '../src/js/lib/marvelComicsAppUrl.js';
import { restoreFindOnlyEntries, vendorIssueItem } from '../scripts/vendor-orders.mjs';

// Synthetic shape of Secret Wars (2015) r3 in miniature: two linked rows, one owner-directed
// non-counting reference back to the first, and one exact provider row the source gave no address.
async function fixture({ viewer = null } = {}) {
  const template = JSON.parse(await readFile('scripts/data/cbh-packets/thanos-reading-order.json', 'utf8'));
  const row = (sourcePosition, id, title, url) => ({
    ...template.rows[0], sourcePosition, candidateIssueId: id, resolutionStatus: 'exact',
    selectedIssueId: id, marvelIssueUrl: url, resolvedIssueTitle: title, issueNumber: '1',
    normalizedSeriesTitle: title, sourceIssueReference: `${title} #1`,
  });
  const rows = [
    row(1, 101, 'Linked One', 'https://www.marvel.com/comics/issue/101'),
    row(2, 102, 'Linked Two', 'https://www.marvel.com/comics/issue/102'),
    row(4, 104, 'Find Only (2015)', null),
  ];
  if (viewer) {
    rows.push({
      sourcePosition: 5, sourceIssueReference: 'Service Only #1',
      normalizedSeriesTitle: 'Service Only', seriesYear: 2015, issueNumber: '1',
      seriesId: null, candidateIssueId: null, manualSeriesSelectionApproved: false,
      resolutionStatus: 'exact', resolvedIssueTitle: 'Service Only (2015)', selectedIssueId: null,
      serviceIdentity: {
        appViewer: viewer, url: `https://www.marvelcomicsapp.com/viewer/${viewer}`,
        providerIssueId: null, normalizedSeriesTitle: 'Service Only', seriesYear: 2015,
        issueNumber: '1', evidenceSha256: 'a'.repeat(64),
      },
    });
  }
  const reference = {
    sourcePosition: 3, sourceIssueReference: 'Another title for Linked One #1',
    decisionId: 'test-fixture-decision', canonicalSourcePosition: 1,
    canonicalProviderIssueId: 101, counted: false,
  };
  const packet = {
    ...template, rows, expectedCount: rows.length, sourceOccurrenceCount: rows.length + 1,
    canonicalSourcePositions: true,
    nonCountingSourceReferences: [reference],
    proposedManifest: { ...template.proposedManifest, expect: rows.length },
  };
  for (const field of ['sourceGaps', 'sourceGapResolutions', 'repeatedSourceReferences',
    'excludedSourceRows']) {
    delete packet[field];
  }
  packet.packetDigest = packetDigestFor(packet);
  const mapping = {
    id: packet.id, packetDigest: packet.packetDigest, approvedSourceCount: packet.sourceOccurrenceCount,
    sourceOccurrenceCount: packet.sourceOccurrenceCount, nonCountingSourceReferences: [structuredClone(reference)],
    findOnlySourcePositions: [4], rows: structuredClone(rows),
    sourceUrl: packet.sourceUrl, sourceSection: packet.sourceSection,
    proposedManifest: packet.proposedManifest, reviewStatus: 'approved',
    packetReview: { authorityIdentity: 'test-fixture-only' }, approvedManifest: packet.proposedManifest,
  };
  mapping.mappingDigest = mappingDigestFor(mapping);
  mapping.relationshipReview = {
    packetDigest: packet.packetDigest, mappingDigest: mapping.mappingDigest,
    authorityIdentity: 'test-fixture-only', reviewedAt: '2026-01-01T00:00:00Z',
  };
  mapping.relationshipReview.approvalDigest = approvalDigestFor(mapping.relationshipReview);
  return { packet, mapping };
}

test('a non-counting reference holds its source position without becoming a reading step', async () => {
  const { packet, mapping } = await fixture();
  validateFrozenPacket(packet);
  assertMappingMatchesPacketOccurrences(packet, mapping);
  assert.deepEqual(sourceCountsForPacket(packet), {
    sourceOccurrenceCount: 4, sourceIdentityCount: 3, includedIssueCount: 3, sourceGapCount: 0,
    repeatedSourceReferenceCount: 0, nonCountingSourceReferenceCount: 1,
  });
  assert.deepEqual(selectedIssueIds(mapping), ['101', '102', '104']);
});

test('non-counting references reject recasting, wrong identities and packet drift', async () => {
  for (const [change, pattern] of [
    [(p) => { p.nonCountingSourceReferences[0].counted = true; }, /counted: false/],
    [(p) => { p.nonCountingSourceReferences[0].canonicalProviderIssueId = 102; }, /provider identity/],
    [(p) => { p.nonCountingSourceReferences[0].canonicalSourcePosition = 3; }, /earlier source position/],
    [(p) => { p.nonCountingSourceReferences[0].canonicalRow = 1; }, /unsupported fields/],
    [(p) => { p.nonCountingSourceReferences = []; }, /non-empty array/],
    [(p) => { p.sourceOccurrenceCount = 3; }, /sourceOccurrenceCount/],
    [(p) => { p.canonicalSourcePositions = false; p.rows.forEach((row) => delete row.sourcePosition); },
      /canonical source positions/],
  ]) {
    const { packet } = await fixture();
    change(packet);
    packet.packetDigest = packetDigestFor(packet);
    assert.throws(() => validateFrozenPacket(packet), pattern);
  }
  const { packet, mapping } = await fixture();
  mapping.nonCountingSourceReferences[0].sourceIssueReference = 'Changed';
  assert.throws(() => assertMappingMatchesPacketOccurrences(packet, mapping), /non-counting source references differ/);
  const drifted = await fixture();
  drifted.mapping.rows[0].selectedIssueId = 109;
  drifted.mapping.rows[0].marvelIssueUrl = 'https://www.marvel.com/comics/issue/109';
  assert.throws(() => assertMappingMatchesPacketOccurrences(drifted.packet, drifted.mapping),
    /differs from its mapped canonical issue/);
});

test('Find-only rows must be exactly the reviewed provider rows without an address', async () => {
  for (const [change, pattern] of [
    [(m) => { m.rows[2].marvelIssueUrl = 'https://www.marvel.com/comics/issue/104'; }, /exactly the provider rows/],
    [(m) => { m.rows[1].marvelIssueUrl = null; }, /exactly the provider rows/],
    [(m) => { m.findOnlySourcePositions = [4, 4]; }, /ascending unique/],
    [(m) => { m.rows[2].selectedIssueIds = [104, 105]; }, /one positive provider issue id/],
    [(m) => { delete m.rows[2].marvelIssueUrl; }, /one positive provider issue id/],
  ]) {
    const { mapping } = await fixture();
    change(mapping);
    assert.throws(() => assertFindOnlySourcePositions(mapping), pattern);
  }
  const { mapping } = await fixture();
  delete mapping.findOnlySourcePositions;
  assert.throws(() => selectedIssueIds(mapping), /no exact Marvel issue URL/);
});

test('a Find-only row is authored without a link and vendored under its provider id', async () => {
  const { mapping } = await fixture();
  const markdown = buildMarkdown(mapping);
  assert.match(markdown, /^- \[ \] Find Only \(2015\) #1 <!-- mrt:source-occurrence=4 -->$/m);
  assert.doesNotMatch(markdown, /issue\/104/);
  const parsed = parseChecklist(markdown);
  assert.deepEqual(parsed.unresolved.map(({ sourceKey, url }) => [sourceKey, url]), [['4', null]]);
  const restored = restoreFindOnlyEntries(mapping.id, parsed, mapping);
  assert.equal(restored.unresolved.length, 0);
  assert.deepEqual(restored.entries.map(({ issueId, sourceKey }) => [issueId, sourceKey]),
    [[101, '1'], [102, '2'], [104, '4']]);
  const item = vendorIssueItem(restored.entries[2], {
    detailUrl: 'https://www.marvel.com/comics/issue/104', pageCount: 24,
  });
  assert.equal(item.issueId, 104);
  assert.equal(item.url, null);
  assert.equal(item.findOnly, true);
  assert.equal(item.pageCount, 24);
  assert.equal(item.placeholder, undefined);
  const linked = vendorIssueItem(restored.entries[0], {});
  assert.equal(linked.url, 'https://www.marvel.com/comics/issue/101');
  assert.equal(Object.hasOwn(linked, 'findOnly'), false);

  assert.equal(restoreFindOnlyEntries('legacy', parsed, null), parsed);
  // The real prefix shape: Secret Wars Journal (2015) #10 at the occurrence reviewed as #1.
  const renamed = structuredClone(parsed);
  renamed.unresolved[0].title = 'Find Only (2015) #10';
  assert.throws(() => restoreFindOnlyEntries(mapping.id, renamed, mapping), /differs from its reviewed mapping/);
  const missing = { ...parsed, unresolved: [] };
  assert.throws(() => restoreFindOnlyEntries(mapping.id, missing, mapping), /not plain checklist lines/);
});

test('Find-only restoration trusts only this order\'s approved mapping record', async () => {
  const { mapping } = await fixture();
  const parsed = parseChecklist(buildMarkdown(mapping));
  assert.throws(() => restoreFindOnlyEntries('another-order', parsed, mapping), /approved mapping/);
  for (const [change, pattern] of [
    [(m) => { m.reviewStatus = 'pending-independent-review'; }, /approved mapping/],
    [(m) => { delete m.relationshipReview; }, /approved mapping/],
    [(m) => { m.rows[2].selectedIssueId = 105; m.rows[2].candidateIssueId = 105; }, /mapping digest is stale/],
    [(m) => { m.relationshipReview.mappingDigest = 'a'.repeat(64); }, /approved mapping/],
    [(m) => { m.relationshipReview.authorityIdentity = 'edited'; }, /approval digest is stale/],
  ]) {
    const edited = structuredClone(mapping);
    change(edited);
    assert.throws(() => restoreFindOnlyEntries(mapping.id, parsed, edited), pattern);
  }
});

async function checkReviewedOfflineFields(t, orderId) {
  const viewer = '101';
  const { mapping } = await fixture({ viewer });
  mapping.id = orderId;
  mapping.mappingDigest = mappingDigestFor(mapping);
  mapping.relationshipReview.mappingDigest = mapping.mappingDigest;
  mapping.relationshipReview.approvalDigest = approvalDigestFor(mapping.relationshipReview);
  const order = { id: mapping.id, sourceFile: 'test-fixture.md' };
  const parsedOrder = restoreFindOnlyEntries(order.id, parseChecklist(buildMarkdown(mapping)), mapping);
  const dir = await mkdtemp(join(tmpdir(), 'mrt-reviewed-fields-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'fields.json');
  const context = { order, mapping, parsedOrder, loadResponses: () => assert.fail('Unexpected cache read') };
  const value = '2015-03-04T00:00:00+0000';
  const sourceSha256 = 'a'.repeat(64);
  const rows = mapping.rows.map(({ sourcePosition, selectedIssueId, serviceIdentity }) => (
    serviceIdentity ? { sourcePosition, issueId: viewerKey(viewer), appViewer: viewer }
      : { sourcePosition, issueId: selectedIssueId }
  ));
  const input = {
    version: 1, id: order.id, packetDigest: mapping.packetDigest, mappingDigest: mapping.mappingDigest, rows,
  };
  rows[2].facts = { onSaleDate: {
    value, sourceSha256, fieldDigest: digestCanonicalJson([104, 'onSaleDate', value, sourceSha256]),
  } };
  async function load(candidate, expectedDigest, overrides = {}) {
    const bytes = JSON.stringify(candidate);
    await writeFile(file, bytes);
    const digest = expectedDigest ?? createHash('sha256').update(bytes).digest('hex');
    return loadReviewedVendorFields({ file, digest }, { ...context, ...overrides });
  }
  const { meta, refused } = await load(input);
  assert.equal(refused.size, 0);
  const item = vendorIssueItem(parsedOrder.entries[2], meta.get(104));
  assert.equal(item.onSale, value);
  assert.equal(item.issueId, 104);
  assert.equal(item.url, null);
  assert.equal(item.findOnly, true);
  assert.equal(item.digitalId, null);
  assert.equal(item.detailsRefused, undefined);
  assert.equal(meta.has(viewerKey(viewer)), false);
  const pending = { ...mapping, reviewStatus: 'pending-independent-review' };
  await assert.rejects(load(input, undefined, { mapping: pending }), /approved mapping and relationships/);
  const noReview = { ...mapping };
  delete noReview.relationshipReview;
  await assert.rejects(load(input, undefined, { mapping: noReview }), /approved mapping and relationships/);
  const missingRow = { ...input, rows: rows.slice(0, -1) };
  await assert.rejects(load(missingRow), /must cover every exact checklist row/);
  const other = { ...order, id: 'another-guide' };
  await assert.rejects(load(input, undefined, { order: other, mapping: { ...mapping, id: other.id } }),
    /eligible local checklist/);
  const mixed = structuredClone(input);
  mixed.rows[3].facts = rows[2].facts;
  await assert.rejects(load(mixed), /service-only issue .* cannot receive provider fields/);
  const wrongPosition = structuredClone(input);
  wrongPosition.rows[3].sourcePosition = 3;
  await assert.rejects(load(wrongPosition), /checklist identity at source position 5/);
  const wrongIssue = structuredClone(input);
  wrongIssue.rows[0].issueId = 102;
  await assert.rejects(load(wrongIssue), /checklist identity at source position 1/);
  await assert.rejects(load(wrongIssue, createHash('sha256').update(JSON.stringify(input)).digest('hex')),
    /approved file digest/);
  const wrongSource = { ...input, packetDigest: 'b'.repeat(64) };
  await assert.rejects(load(wrongSource), /source packet and mapping/);
  rows[2].facts.onSaleDate.sourceSha256 = 'c'.repeat(64);
  await assert.rejects(load(input), /invalid provenance or value for onSaleDate/);
}

test('reviewed offline fields bind the source and every issue while leaving unavailable fields absent', (t) => (
  checkReviewedOfflineFields(t, 'secret-wars-2015-event-tie-ins')
));

test('Empyre reviewed offline fields keep provider and service rows separate', (t) => (
  checkReviewedOfflineFields(t, 'empyre')
));

test('Blood Hunt reviewed offline fields require the same evidence for provider and viewer rows', (t) => (
  checkReviewedOfflineFields(t, 'blood-hunt')
));

for (const id of ['secret-wars-2015-event-tie-ins', 'avengers-standoff',
  'civil-war-ii', 'road-to-secret-empire', 'secret-empire-event']) {
  test(`${id} reviewed offline fields bind the source and every issue without implying refusal`, (t) => (
    checkReviewedOfflineFields(t, id)
  ));
}
