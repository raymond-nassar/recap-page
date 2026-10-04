import assert from 'node:assert/strict';

import { digestCanonicalJson, validateReportDigest } from '../../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport } from '../../scripts/lib/cbh-overlap.mjs';

function normalizedOrders(orders) {
  const normalized = orders.map((order) => {
    const id = order.id ?? order.orderId;
    assert.equal(typeof id, 'string');
    assert.ok(id.length > 0 && Array.isArray(order.issueIds));
    return { id, issueIds: order.issueIds.map(String) };
  }).sort((left, right) => left.id.localeCompare(right.id));
  assert.equal(new Set(normalized.map((order) => order.id)).size, normalized.length);
  return normalized;
}

export function libraryVectorDigest(orders) {
  return digestCanonicalJson(normalizedOrders(orders));
}

export function assertCurrentLibraryExtension({
  extension, candidateId, candidateIds, orders, originalReport, originalApprovalDigest,
}) {
  assert.equal(extension.schemaVersion, 1);
  assert.equal(extension.evidenceKind, 'derived-current-library-extension');
  assert.match(extension.publishedBase, /^[a-f0-9]{40}$/);
  assert.equal(Object.hasOwn(extension, 'relationshipReview'), false);
  const { extensionDigest, ...unsigned } = extension;
  assert.equal(extensionDigest, digestCanonicalJson(unsigned), 'Current extension digest is stale');
  const normalized = normalizedOrders(orders);
  assert.equal(extension.libraryOrderCount, normalized.length);
  assert.equal(extension.libraryVectorDigest, libraryVectorDigest(normalized),
    'Current coverage must include every visible, generated and hidden order');
  const candidate = normalized.find((order) => order.id === candidateId);
  assert.ok(candidate, 'The actual candidate payload is missing');
  assert.deepEqual(candidate.issueIds, candidateIds.map(String));
  assert.equal(extension.extensions.filter((entry) => entry.candidateId === candidateId).length, 1);
  const added = extension.extensions.find((entry) => entry.candidateId === candidateId);
  assert.equal(added.originalReportDigest, originalReport.reportDigest);
  assert.equal(added.originalApprovalDigest, originalApprovalDigest);
  assert.equal(added.packetDigest, originalReport.packetDigest);
  assert.equal(added.mappingDigest, originalReport.mappingDigest);
  assert.equal(added.originalPeerCount, originalReport.comparisonCount);
  validateReportDigest(originalReport);

  const originalIds = new Set(originalReport.comparisons.map((entry) => entry.orderId));
  const laterIds = added.laterComparisons.map((entry) => entry.orderId);
  assert.equal(new Set(laterIds).size, laterIds.length);
  assert.deepEqual(Object.keys(added.laterIssueVectorDigests).sort(), [...laterIds].sort());
  for (const comparison of added.laterComparisons) {
    assert.equal(originalIds.has(comparison.orderId), false, 'An original peer is not a later publication');
    const peer = normalized.find((order) => order.id === comparison.orderId);
    assert.ok(peer, `Later peer ${comparison.orderId} is missing`);
    assert.equal(added.laterIssueVectorDigests[comparison.orderId], digestCanonicalJson(peer.issueIds));
    assert.deepEqual([comparison.relationship, comparison.sharedCount, comparison.sharedIds],
      ['none', 0, []], 'New meaningful relationships require bounded review');
  }

  const current = buildComparisonReport({
    candidateIds, orders: normalized.filter((order) => order.id !== candidateId),
  });
  assert.equal(added.currentPeerCount, current.comparisonCount);
  assert.equal(current.comparisonCount, originalReport.comparisonCount + laterIds.length);
  assert.deepEqual(current.comparisons,
    [...originalReport.comparisons, ...added.laterComparisons]
      .sort((left, right) => left.orderId.localeCompare(right.orderId)),
    'Current comparison must cover the complete unfiltered peer union');
  return { current, laterIds };
}
