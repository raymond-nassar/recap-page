import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { buildMarkdown, selectedIssueIds } from '../scripts/author-cbh-packet.mjs';
import {
  assertFindOnlySourcePositions, assertMappingMatchesPacketOccurrences, approvalDigestFor, mappingDigestFor,
  packetDigestFor, sourceCountsForPacket, validateFrozenPacket,
} from '../scripts/lib/cbh-inventory.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { restoreFindOnlyEntries, vendorIssueItem } from '../scripts/vendor-orders.mjs';

// Synthetic shape of Secret Wars (2015) r3 in miniature: two linked rows, one owner-directed
// non-counting reference back to the first, and one exact provider row the source gave no address.
async function fixture() {
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
  const reference = {
    sourcePosition: 3, sourceIssueReference: 'Another title for Linked One #1',
    decisionId: 'test-fixture-decision', canonicalSourcePosition: 1,
    canonicalProviderIssueId: 101, counted: false,
  };
  const packet = {
    ...template, rows, expectedCount: 3, sourceOccurrenceCount: 4, canonicalSourcePositions: true,
    nonCountingSourceReferences: [reference],
    proposedManifest: { ...template.proposedManifest, expect: 3 },
  };
  for (const field of ['sourceGaps', 'sourceGapResolutions', 'repeatedSourceReferences',
    'excludedSourceRows']) {
    delete packet[field];
  }
  packet.packetDigest = packetDigestFor(packet);
  const mapping = {
    id: packet.id, packetDigest: packet.packetDigest, approvedSourceCount: 4,
    sourceOccurrenceCount: 4, nonCountingSourceReferences: [structuredClone(reference)],
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
  const item = vendorIssueItem(restored.entries[2], {});
  assert.equal(item.issueId, 104);
  assert.equal(item.url, null);
  assert.equal(item.placeholder, undefined);

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
