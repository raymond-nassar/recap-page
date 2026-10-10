import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approvalDigestFor,
} from '../../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport } from '../../scripts/lib/cbh-overlap.mjs';
import { loadCurrentOwnerLibrary } from '../../scripts/lib/owner-current-library.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = async (root, file) => JSON.parse(await readFile(path.join(root, file), 'utf8'));

export async function readCuratedGuidePeerReview(contract, { root = ROOT } = {}) {
  const review = await readJson(root, contract.reviewFile);
  assert.equal(review.schemaVersion, 1);
  assert.equal(review.id, contract.id);
  assert.equal(review.status, 'approved');
  assert.equal(review.approvalDigest, approvalDigestFor(review));
  assert.ok(/^[a-f0-9]{64}$/.test(review.vectorSha256));
  assert.ok(/^[a-f0-9]{64}$/.test(review.libraryDigest));
  return review;
}

export async function assertCuratedGuidePeerReview(contract, { root = ROOT } = {}) {
  const [manifest, catalog, payload, review, library] = await Promise.all([
    readJson(root, 'src/data/curated-lists.json'),
    readJson(root, 'src/data/catalog.json'),
    readJson(root, contract.payloadFile),
    readCuratedGuidePeerReview(contract, { root }),
    loadCurrentOwnerLibrary(contract.id, { root }),
  ]);
  const source = manifest.lists.find((entry) => entry.id === contract.id);
  const visible = catalog.lists.find((entry) => entry.id === contract.id);
  assert.equal(source?.sourceFile, path.basename(contract.sourceFile));
  assert.equal(source?.out, path.basename(contract.payloadFile));
  assert.equal(visible?.file, path.basename(contract.payloadFile));

  const candidateIds = payload.items.map((item) => String(item.issueId));
  assert.equal(candidateIds.length, contract.rowCount);
  assert.equal(new Set(candidateIds).size, candidateIds.length);
  assert.equal(review.candidateCount, candidateIds.length);
  assert.equal(review.vectorSha256,
    createHash('sha256').update(JSON.stringify(candidateIds)).digest('hex'));
  assert.equal(review.libraryDigest, library.libraryDigest);

  const report = buildComparisonReport({ candidateIds, orders: library.orders });
  assert.equal(review.comparisonCount, report.comparisonCount);
  const counts = Object.fromEntries(['candidate-subset', 'partial', 'none', 'exact', 'existing-subset']
    .map((relationship) => [
      relationship, report.comparisons.filter((entry) => entry.relationship === relationship).length,
    ]));
  assert.deepEqual(counts, review.relationshipCounts);

  const authority = review.authority;
  assert.equal(authority.type, 'human');
  assert.equal(authority.evidence, contract.sourceFile);
  assert.ok(authority.identity && authority.rationale);
  assert.equal(review.unlistedDisposition, 'none');

  const expected = review.relationships.map((entry) => ({
    orderId: entry.orderId,
    relationship: entry.relationship,
    sharedCount: entry.sharedCount,
    sharedIds: entry.sharedIds === 'candidate-vector' ? candidateIds : entry.sharedIds,
  }));
  for (const [index, row] of review.relationships.entries()) {
    assert.equal(review.status, 'approved');
    assert.ok(row.rationale);
    if (row.relationship !== 'none') assert.equal(authority.type, 'human');
    if (index > 0) assert.ok(review.relationships[index - 1].orderId < row.orderId);
  }
  assert.deepEqual(report.comparisons
    .filter((entry) => entry.relationship !== 'none'), expected);

  return { report, review };
}
