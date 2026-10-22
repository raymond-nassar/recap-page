import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { beforeMcuEditorialManifest, mcuEditorial } from '../../scripts/lib/mcu-editorial.mjs';
import { buildComparisonReport, issueIdsFromValue } from '../../scripts/lib/cbh-overlap.mjs';
import { libraryDigestFor } from '../../scripts/lib/cbh-inventory.mjs';

const archived = JSON.parse(readFileSync(new URL('../../src/data/marvel_multiverse.json', import.meta.url), 'utf8'));
const retiredId = mcuEditorial.withdrawal.manifestEntry.id;
assert.equal(archived.id, retiredId);
const archivedIds = issueIdsFromValue(archived);

export function withRetiredOrders(orders, recordedIds) {
  if (!recordedIds.has(retiredId) || orders.some((row) => (row.id ?? row.orderId) === retiredId)) return orders;
  return [...orders, { id: retiredId, orderId: retiredId, issueIds: archivedIds }]
    .sort((left, right) => (left.id ?? left.orderId).localeCompare(right.id ?? right.orderId));
}

export function withRetiredComparisons(comparisons, candidateIds, report) {
  if (!report.comparisons.some(({ orderId }) => orderId === retiredId)
    || comparisons.some(({ orderId }) => orderId === retiredId)) return comparisons;
  return [...comparisons, ...buildComparisonReport({
    candidateIds, orders: [{ orderId: retiredId, issueIds: archivedIds }],
  }).comparisons].sort((left, right) => left.orderId.localeCompare(right.orderId));
}

export function recordedEditorialDigest(manifest, orders) {
  const original = beforeMcuEditorialManifest(manifest, { restoreWithdrawal: true });
  return libraryDigestFor(original, withRetiredOrders(orders, new Set(original.lists.map(({ id }) => id)))
    .map(({ id, issueIds }) => ({ id, issueIds })));
}
