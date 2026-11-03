import assert from 'node:assert/strict';
import test from 'node:test';
import { assertRelationshipReportExtension } from '../scripts/lib/owner-guide.mjs';
import { approvalDigestFor, digestCanonicalJson } from '../scripts/lib/cbh-inventory.mjs';

function fixture() {
  const ledger = {
    schemaVersion: 1, id: 'later-curated', resolvedVector: [2, 3, 4],
    source: { url: 'https://example.org/factual-order' },
  };
  ledger.ledgerDigest = digestCanonicalJson(ledger);
  const report = {
    candidateId: ledger.id, ledgerDigest: ledger.ledgerDigest, candidateCount: 3,
    comparisonCount: 1,
    comparisons: [{ orderId: 'earlier-owner', relationship: 'partial', sharedCount: 2, sharedIds: ['2', '3'] }],
  };
  report.reportDigest = digestCanonicalJson(report);
  ledger.relationshipReview = {
    status: 'approved', report,
    dispositions: [{
      orderId: 'earlier-owner', decision: 'approved', authorityType: 'stronger-model',
      authority: 'Synthetic stronger-model reviewer', relationship: 'partial',
      sharedCount: 2, sharedIds: ['2', '3'],
      ledgerDigest: ledger.ledgerDigest, reportDigest: report.reportDigest,
    }],
  };
  ledger.relationshipReview.approvalDigest = approvalDigestFor(ledger.relationshipReview);
  const previous = { candidateId: 'earlier-owner', comparisons: [] };
  const current = {
    ...previous,
    comparisons: [{ orderId: ledger.id, relationship: 'partial', sharedCount: 2, sharedIds: ['2', '3'] }],
  };
  return { ledger, previous, current };
}

function check({ ledger, previous, current }) {
  assertRelationshipReportExtension(previous, current, [], [], [{ registeredId: ledger.id, ledger }]);
}

function resignReview(ledger) {
  const { report } = ledger.relationshipReview;
  const { reportDigest, ...body } = report;
  assert.ok(reportDigest);
  report.reportDigest = digestCanonicalJson(body);
  for (const disposition of ledger.relationshipReview.dispositions) {
    disposition.reportDigest = report.reportDigest;
  }
  ledger.relationshipReview.approvalDigest = approvalDigestFor(ledger.relationshipReview);
}

test('a local curated ledger accepts a digest-bound stronger-model reciprocal disposition', () => {
  assert.doesNotThrow(() => check(fixture()));
});

test('a local curated reciprocal review rejects agent-only authority', () => {
  const value = fixture();
  value.ledger.relationshipReview.dispositions[0].authorityType = 'agent-content-review';
  resignReview(value.ledger);
  assert.throws(() => check(value), /authority|stronger-model/i);
});

test('a local curated reciprocal review rejects changed factual ledger bytes', () => {
  const value = fixture();
  value.ledger.source.url = 'https://example.org/changed-order';
  assert.throws(() => check(value), /ledger digest/i);
});

test('a local curated reciprocal review rejects a changed report digest', () => {
  const value = fixture();
  value.ledger.relationshipReview.report.comparisonCount += 1;
  assert.throws(() => check(value), /report digest/i);
});

test('a local curated reciprocal review rejects the wrong inverse relationship', () => {
  const value = fixture();
  value.current.comparisons[0].relationship = 'existing-subset';
  assert.throws(() => check(value));
});

test('a local curated reciprocal review rejects wrong shared IDs despite valid digests', () => {
  const value = fixture();
  value.ledger.relationshipReview.report.comparisons[0].sharedIds = ['2', '4'];
  value.ledger.relationshipReview.dispositions[0].sharedIds = ['2', '4'];
  resignReview(value.ledger);
  assert.throws(() => check(value));
});

test('a local curated reciprocal review rejects a declined disposition despite valid digests', () => {
  const value = fixture();
  value.ledger.relationshipReview.dispositions[0].decision = 'declined';
  resignReview(value.ledger);
  assert.throws(() => check(value));
});
