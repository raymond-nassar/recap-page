import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { legacyReadingOrder } from '../../src/js/lib/legacyReadingOrders.js';
import { buildComparisonReport, issueIdsFromValue } from '../../scripts/lib/cbh-overlap.mjs';
import { curatedLedgerDigestFor, curatedRelationshipReportDigestFor } from '../../scripts/lib/owner-guide.mjs';

const read = (file) => JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));
const retirement = read('scripts/data/curated-source-ledgers/xmen-era-retirement.json');

// Each retired guide's discovery slot passes to the separately addable guide approved for it, so
// the roster keeps its size while the retired payloads stay readable for saved lists.
export const xmenEraReplacements = Object.freeze(new Map([
  ['xmen-claremont', 'xmen-silver-age'],
  ['xmen-claremont-complete', 'xmen-claremont-era'],
]));
assert.deepEqual(retirement.entries.map(({ id }) => id), [...xmenEraReplacements.keys()]);

export function retiredXmenEntry(id) {
  const entry = retirement.entries.find((candidate) => candidate.id === id);
  if (!entry) return null;
  assert.equal(legacyReadingOrder(id)?.file, entry.out, `${id}: the legacy registry must resolve its payload`);
  return entry;
}

const replacementFor = new Map([...xmenEraReplacements].map(([retiredId, id]) => [id, retiredId]));
const retiredOrders = retirement.entries.map(({ id, out }) => ({
  id, issueIds: issueIdsFromValue(read(`src/data/${out}`)),
}));

// The retired pair held exactly the slot their replacements now occupy, so a review recorded before
// the retirement saw the retired entries there. The entries are restored from the retirement record,
// never from the replacements, and only a review that recorded a retired ID ever sees one.
export function beforeXmenEraManifest(manifest, recordedIds = null) {
  if (!manifest.lists.some(({ id }) => replacementFor.has(id))) return manifest;
  const keep = (id) => !recordedIds || recordedIds.has(id);
  return {
    ...manifest,
    lists: manifest.lists.flatMap((entry) => {
      const retiredId = replacementFor.get(entry.id);
      if (!retiredId || recordedIds?.has(entry.id)) return [entry];
      if (manifest.lists.some(({ id }) => id === retiredId) || !keep(retiredId)) return [];
      return [structuredClone(retiredXmenEntry(retiredId))];
    }),
  };
}

// The retirement record keeps manifest entries only, so a catalog projection recorded before the
// retirement is rebuilt from the baseline commit the record names, in the same slots.
let baselineCatalog = null;
export function beforeXmenEraCatalogLists(lists) {
  if (!lists.some(({ id }) => replacementFor.has(id))) return lists;
  baselineCatalog ??= JSON.parse(execFileSync('git', [
    'show', `${retirement.baselineCommit}:src/data/catalog.json`,
  ], { cwd: fileURLToPath(new URL('../../', import.meta.url)), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }));
  return lists.map((entry) => {
    const retiredId = replacementFor.get(entry.id);
    if (!retiredId) return entry;
    const original = baselineCatalog.lists.find(({ id }) => id === retiredId);
    assert.equal(original?.file, retiredXmenEntry(retiredId).out);
    return structuredClone(original);
  });
}

export const retiredXmenIds = Object.freeze([...xmenEraReplacements.keys()]);

// Orders for a review that predates the retirement: each replacement gives its place back to the
// retired guide it replaced, read from the retired guide's own preserved payload.
export function beforeXmenEraOrders(orders) {
  return orders.map((order) => {
    const retiredId = replacementFor.get(order.id ?? order.orderId);
    if (!retiredId) return order;
    const { issueIds } = retiredOrders.find(({ id }) => id === retiredId);
    const stringIds = order.issueIds.every((value) => typeof value === 'string');
    return {
      ...order,
      ...('id' in order ? { id: retiredId } : {}),
      ...('orderId' in order ? { orderId: retiredId } : {}),
      issueIds: stringIds ? issueIds.map(String) : [...issueIds],
    };
  });
}

export function withRetiredXmenComparisons(comparisons, candidateIds, report) {
  const missing = retiredOrders.filter(({ id }) => report.comparisons.some(({ orderId }) => orderId === id)
    && !comparisons.some(({ orderId }) => orderId === id));
  if (!missing.length) return comparisons;
  return [...comparisons, ...buildComparisonReport({
    candidateIds, orders: missing.map(({ id, issueIds }) => ({ orderId: id, issueIds: [...issueIds] })),
  }).comparisons].sort((left, right) => left.orderId.localeCompare(right.orderId));
}

export function withRetiredXmenOrders(orders, recordedIds) {
  const missing = retiredOrders.filter(({ id }) => recordedIds.has(id)
    && !orders.some((row) => (row.id ?? row.orderId) === id));
  if (!missing.length) return orders;
  return [...orders, ...missing.map(({ id, issueIds }) => ({ id, orderId: id, issueIds: [...issueIds] }))]
    .sort((left, right) => (left.id ?? left.orderId).localeCompare(right.id ?? right.orderId));
}

// The replacement pair was reviewed after every earlier guide, so an earlier review that predates it
// accepts it only through the pair's own sealed report and its recorded reciprocal decision.
const inverse = { none: 'none', partial: 'partial', 'candidate-subset': 'existing-subset', 'existing-subset': 'candidate-subset' };
export function assertXmenEraLaterPeer(id, later) {
  if (!replacementFor.has(later.orderId)) return false;
  const ledger = read(`scripts/data/curated-source-ledgers/${later.orderId}.json`);
  assert.equal(ledger.ledgerDigest, curatedLedgerDigestFor(ledger));
  const { report, decisions } = ledger.relationshipReview;
  assert.equal(report.ledgerDigest, ledger.ledgerDigest);
  assert.equal(report.reportDigest, curatedRelationshipReportDigestFor(report));
  const reciprocal = report.comparisons.find((row) => row.orderId === id);
  assert.ok(reciprocal, `${later.orderId}: its review must include the earlier guide ${id}`);
  assert.equal(later.relationship, inverse[reciprocal.relationship]);
  assert.equal(later.sharedCount, reciprocal.sharedCount);
  assert.deepEqual([...later.sharedIds].sort(), [...reciprocal.sharedIds].sort());
  const decision = decisions.find((row) => row.orderId === id);
  if (reciprocal.relationship === 'none') {
    assert.equal(decision, undefined);
  } else {
    assert.ok(decision, `${later.orderId}: a meaningful relationship with ${id} needs its recorded decision`);
    assert.equal(decision.decision, 'approved');
    assert.ok(['human', 'stronger-model'].includes(decision.authorityType));
    assert.deepEqual([decision.relationship, decision.sharedIds],
      [reciprocal.relationship, reciprocal.sharedIds]);
  }
  return true;
}

const gaps = (file) => {
  const { items } = read(`src/data/${file}`);
  return { total: items.length, placeholders: items.filter((item) => item.placeholder).length };
};
const sum = (files) => files.map(gaps).reduce(
  (total, next) => ({ total: total.total + next.total, placeholders: total.placeholders + next.placeholders }),
  { total: 0, placeholders: 0 },
);
const retired = sum(retirement.entries.map(({ out }) => out));
const added = sum([...xmenEraReplacements.values()].map((id) => {
  const entry = read('src/data/curated-lists.json').lists.find((candidate) => candidate.id === id);
  assert.ok(entry, `${id}: the replacement guide must be in the manifest`);
  return entry.out;
}));
export const xmenEraItemDelta = added.total - retired.total;
export const xmenEraPlaceholderDelta = added.placeholders - retired.placeholders;
