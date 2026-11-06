import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { withoutDiscoveryTags } from '../../scripts/lib/cbh-inventory.mjs';
import { descriptionRevisions } from '../../scripts/lib/description-revisions.mjs';
import { beforeIdentityText } from './owner-identity-history.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const { captureSha256, ...baseline } = JSON.parse(readFileSync(
  new URL('../fixtures/amazing-spider-man-before-supplement.json', import.meta.url), 'utf8',
));
const { sha256, ...supplement } = JSON.parse(readFileSync(
  new URL('../../scripts/data/owner-selections/amazing-spider-man-early-supplement.json', import.meta.url),
  'utf8',
));
assert.equal(baseline.sourceCommit, '95f02a62e64bd072ab103cca5a0e4716c7478dec');
assert.equal(captureSha256, '0dd8649e375b1c6a59ff21ad99cd663869a4390df2700f011a533f778ced9f6a');
assert.equal(hash(JSON.stringify(baseline)), captureSha256);
assert.equal(sha256, 'f3126307a66389013f7ffc5c9c661a95f37bb92909dce6ac67d03515d9a64749');
assert.equal(hash(JSON.stringify(supplement)), sha256);
assert.equal(supplement.originalGuide.baselineCommit, baseline.sourceCommit);
assert.equal(supplement.originalGuide.payloadSha256, baseline.payloadSha256);
assert.equal(supplement.originalGuide.itemVectorSha256, baseline.itemVectorSha256);
assert.equal(supplement.rows.length, 103);
assert.equal(baseline.issueIds.length, 2041);
export const amazingSpiderManGuideId = supplement.guideId;
export const amazingSpiderManSupplementRows = supplement.rows;
export const amazingSpiderManSupplementIds = new Set(supplement.rows.map(({ issueId }) => issueId));
export const amazingSpiderManSupplementDelta = amazingSpiderManSupplementIds.size;
assert.equal(amazingSpiderManSupplementDelta, 103);
assert.equal(baseline.manifestEntry.id, amazingSpiderManGuideId);
assert.equal(baseline.catalogEntry.id, amazingSpiderManGuideId);

const origin = "Compiled for this project from Comic Book Herald's guide, with owner-selected additions";
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const descriptionRevision = descriptionRevisions.entries.find(({ id }) => id === amazingSpiderManGuideId);
assert.equal(descriptionRevision?.after, baseline.manifestEntry.description);
const knownDescriptions = new Set([descriptionRevision.before, descriptionRevision.after]);

function assertKnownDescription(entry) {
  assert.ok(knownDescriptions.has(entry.description), 'The historical description must be a recorded revision.');
}

function withoutDescription(entry) {
  const result = withoutDiscoveryTags(entry);
  delete result.description;
  return result;
}

export function beforeAmazingSpiderManSupplementEntry(entry) {
  if (entry.id !== amazingSpiderManGuideId) return entry;
  assert.ok([baseline.manifestEntry.sourceOrigin, origin].includes(entry.sourceOrigin));
  assert.ok([baseline.manifestEntry.expect, baseline.manifestEntry.expect + amazingSpiderManSupplementDelta]
    .includes(entry.expect));
  const original = {
    ...entry,
    sourceOrigin: baseline.manifestEntry.sourceOrigin,
    expect: baseline.manifestEntry.expect,
  };
  assertKnownDescription(original);
  assert.deepEqual(withoutDescription(original), withoutDescription(baseline.manifestEntry),
    'Only the approved supplement changes may be removed from the historical manifest.');
  return original;
}

export function beforeAmazingSpiderManSupplementCatalogEntry(entry) {
  if (entry.id !== amazingSpiderManGuideId) return entry;
  assertKnownDescription(entry);
  assert.ok([baseline.catalogEntry.sourceOrigin, origin].includes(entry.sourceOrigin));
  assert.ok([baseline.catalogEntry.count, baseline.catalogEntry.count + amazingSpiderManSupplementDelta]
    .includes(entry.count));
  const original = {
    ...entry,
    sourceOrigin: baseline.catalogEntry.sourceOrigin,
    count: baseline.catalogEntry.count,
    updatedAt: baseline.catalogEntry.updatedAt,
    contains: baseline.catalogEntry.contains,
  };
  const comparable = withoutDescription(original);
  if (Object.hasOwn(comparable, 'out')) {
    assert.equal(comparable.out, baseline.catalogEntry.file);
    delete comparable.out;
  }
  assert.deepEqual(comparable, withoutDescription(baseline.catalogEntry),
    'Only the approved supplement changes may be removed from the historical catalog entry.');
  return original;
}

export function beforeAmazingSpiderManSupplementManifest(manifest) {
  return { ...manifest, lists: manifest.lists.map(beforeAmazingSpiderManSupplementEntry) };
}

export function beforeAmazingSpiderManSupplementIssueIds(currentIds) {
  const ids = currentIds.map(String);
  if (same(ids, baseline.issueIds)) return [...baseline.issueIds];
  assert.equal(ids.length, baseline.issueIds.length + amazingSpiderManSupplementDelta);
  const retained = ids.filter((id) => !amazingSpiderManSupplementIds.has(Number(id)));
  assert.deepEqual(retained, baseline.issueIds, 'The previous issue vector must remain intact.');
  const added = ids.filter((id) => amazingSpiderManSupplementIds.has(Number(id)));
  const expected = [...supplement.rows].sort((a, b) => a.guidePosition - b.guidePosition)
    .map(({ issueId }) => String(issueId));
  assert.deepEqual(added, expected, 'Every owner-selected issue must retain its approved position.');
  return retained;
}

export function beforeAmazingSpiderManSupplementOrders(orders) {
  return orders.map((order) => (order.id ?? order.orderId) === amazingSpiderManGuideId
    ? { ...order, issueIds: beforeAmazingSpiderManSupplementIssueIds(order.issueIds) }
    : order);
}

export function beforeAmazingSpiderManSupplementPayloadText(text) {
  const current = JSON.parse(text);
  assert.equal(current.id, amazingSpiderManGuideId);
  beforeAmazingSpiderManSupplementIssueIds(current.items.map(({ issueId }) => issueId));
  const originalText = beforeIdentityText(supplement.originalGuide.payloadFile, baseline.sourceCommit);
  assert.equal(hash(originalText), baseline.payloadSha256);
  const original = JSON.parse(originalText);
  const originalItems = current.items.filter(({ issueId }) => !amazingSpiderManSupplementIds.has(issueId));
  assert.equal(hash(JSON.stringify(originalItems)), baseline.itemVectorSha256);
  const unresolved = current.unresolved.map((entry) => ({
    ...entry,
    index: entry.index - current.items.slice(0, entry.index)
      .filter(({ issueId }) => amazingSpiderManSupplementIds.has(issueId)).length,
  }));
  assert.deepEqual({
    ...current,
    sourceOrigin: original.sourceOrigin,
    generatedAt: original.generatedAt,
    count: original.count,
    unresolved,
    items: originalItems,
  }, original, 'The inverse must restore the exact prior payload, not rewrite historical metadata.');
  return originalText;
}

export function beforeAmazingSpiderManSupplementPayloadFileText(file, text) {
  return path.basename(file) === baseline.manifestEntry.out
    ? beforeAmazingSpiderManSupplementPayloadText(text) : text;
}
