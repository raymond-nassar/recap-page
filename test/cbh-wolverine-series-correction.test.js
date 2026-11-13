import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import {
  approvalDigestFor, mappingDigestFor, packetDigestFor, sourceCountsForPacket,
  sourcePositionsForPacket,
} from '../scripts/lib/cbh-inventory.mjs';

const id = 'wolverine-reading-order';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [packet, mapping, report, payload, ledger] = await Promise.all([
  readJson(`scripts/data/cbh-packets/${id}.json`),
  readJson(`scripts/data/cbh-mappings/${id}.json`),
  readJson(`scripts/data/cbh-overlaps/${id}.json`),
  readJson('src/data/wolverine_reading_order.json'),
  readJson(`scripts/data/cbh-source-ledgers/${id}-series-correction.json`),
]);
const prior = ledger.priorPublication;
const show = (file) => execFileSync('git', ['show', `${prior.commit}:${file}`], {
  encoding: 'utf8', maxBuffer: 64 << 20,
});
const priorPacket = JSON.parse(show(prior.files.packet));
const priorMapping = JSON.parse(show(prior.files.mapping));
const priorReport = JSON.parse(show(prior.files.report));
const priorPayloadText = show(prior.files.payload).replace(/\r\n/g, '\n');

// Every source position of a packet, keyed by position, as the reader sees it: a row with its
// exact comic, a repeat pointing at one, an exclusion, or a gap.
function occurrences(source) {
  const positions = sourcePositionsForPacket(source);
  const byPosition = new Map();
  source.rows.forEach((row, index) => byPosition.set(positions[index], {
    representation: 'row', sourceIssueReference: row.sourceIssueReference,
    seriesYear: row.seriesYear, issueId: row.candidateIssueId,
  }));
  for (const repeat of source.repeatedSourceReferences) {
    byPosition.set(repeat.sourcePosition, {
      representation: 'repeat', sourceIssueReference: repeat.sourceIssueReference,
      seriesYear: repeat.seriesYear, issueId: source.rows[repeat.canonicalRow - 1].candidateIssueId,
      canonicalSourcePosition: positions[repeat.canonicalRow - 1],
    });
  }
  for (const excluded of source.excludedSourceRows) {
    byPosition.set(excluded.sourcePosition, {
      representation: 'exclusion', sourceIssueReference: excluded.sourceIssueReference,
      seriesYear: null, issueId: null,
    });
  }
  for (const gap of source.sourceGaps) {
    byPosition.set(gap.sourcePosition, {
      representation: 'gap', sourceIssueReference: gap.sourceIssueReference,
      seriesYear: gap.seriesYear, issueId: null,
    });
  }
  return byPosition;
}

const corrections = ledger.correctionReview.corrections;
const corrected = new Set(corrections.map((entry) => entry.sourcePosition));

test('the Wolverine series correction ledger names the publication it replaced', () => {
  assert.equal(ledger.correctionIssue, 'https://github.com/raymond-nassar/recap-page/issues/1078');
  assert.equal(priorPacket.packetDigest, prior.packetDigest);
  assert.equal(packetDigestFor(priorPacket), prior.packetDigest);
  assert.equal(priorMapping.mappingDigest, prior.mappingDigest);
  assert.equal(mappingDigestFor(priorMapping), prior.mappingDigest);
  assert.equal(priorReport.reportDigest, prior.reportDigest);
  assert.equal(priorMapping.relationshipReview.approvalDigest, prior.approvalDigest);
  assert.equal(createHash('sha256').update(priorPayloadText).digest('hex'), prior.payloadSha256);
  assert.deepEqual(sourceCountsForPacket(priorPacket), prior.sourceCounts);
  assert.equal(JSON.parse(priorPayloadText).items.length, prior.sourceCounts.sourceIdentityCount);
});

test('each corrected position records its prior and current form exactly', () => {
  const before = occurrences(priorPacket);
  const after = occurrences(packet);
  assert.equal(corrections.length, 95);
  assert.equal(corrected.size, corrections.length);
  const tally = {};
  for (const entry of corrections) {
    const key = `${entry.before.representation}->${entry.after.representation}`;
    tally[key] = (tally[key] ?? 0) + 1;
    const was = before.get(entry.sourcePosition);
    assert.deepEqual(was, entry.before, String(entry.sourcePosition));
    const now = after.get(entry.sourcePosition);
    assert.deepEqual(now, entry.after, String(entry.sourcePosition));
    assert.notDeepEqual(was, now);
    assert.match(entry.after.sourceIssueReference, new RegExp(`^Wolverine \\(${entry.after.seriesYear}\\) #\\d+$`));
    assert.match(entry.sourceText, /Wolverine/);
  }
  assert.deepEqual(tally, {
    'row->row': 28, 'repeat->row': 52, 'repeat->repeat': 2, 'exclusion->row': 13,
  });
});

test('no position outside the ledger changed', () => {
  const before = occurrences(priorPacket);
  const after = occurrences(packet);
  assert.equal(after.size, packet.sourceOccurrenceCount);
  assert.equal(before.size, priorPacket.sourceOccurrenceCount);
  assert.equal(packet.sourceOccurrenceCount, priorPacket.sourceOccurrenceCount);
  for (const [position, was] of before) {
    if (corrected.has(position)) continue;
    assert.deepEqual(after.get(position), was, `source position ${position}`);
  }
  assert.deepEqual(packet.sourceGaps, priorPacket.sourceGaps);
});

test('the corrected rows reach the published payload in source order', () => {
  const after = occurrences(packet);
  const rowIds = [...after.entries()]
    .filter(([, entry]) => entry.representation === 'row')
    .sort(([a], [b]) => a - b)
    .map(([, entry]) => entry.issueId);
  const published = payload.items.filter((item) => !item.placeholder).map((item) => item.issueId);
  assert.deepEqual(published, rowIds);
  assert.equal(payload.items.length, ledger.correctionReview.sourceCounts.sourceIdentityCount);
  assert.equal(payload.count, payload.items.length);
  const priorPlaceholders = JSON.parse(priorPayloadText).items.filter((item) => item.placeholder);
  assert.deepEqual(payload.items.filter((item) => item.placeholder), priorPlaceholders);
});

test('the correction review approves the current Wolverine publication', () => {
  const review = ledger.correctionReview;
  assert.equal(review.packetDigest, packet.packetDigest);
  assert.equal(review.mappingDigest, mapping.mappingDigest);
  assert.equal(review.reportDigest, report.reportDigest);
  assert.equal(review.approvalDigest, mapping.relationshipReview.approvalDigest);
  assert.equal(approvalDigestFor(mapping.relationshipReview), review.approvalDigest);
  assert.deepEqual(review.sourceCounts, sourceCountsForPacket(packet));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: report.libraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));
});
