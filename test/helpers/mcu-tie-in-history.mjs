import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseChecklist } from '../../src/js/lib/markdown.js';
import { beforeIdentityJson, beforeIdentityText } from './owner-identity-history.mjs';

export const tieInRevisions = JSON.parse(readFileSync(
  new URL('../../scripts/data/mcu-prep-tie-in-revisions.json', import.meta.url), 'utf8',
));

const vectorDigest = (items) => createHash('sha256')
  .update(JSON.stringify(items.map(({ issueId }) => issueId))).digest('hex');

export const tieInRevisionFor = (id) => tieInRevisions.guides.find((guide) => guide.id === id);

function beforeTieInCredit(value, revision = tieInRevisionFor(value.id)) {
  if (!revision) return value;
  for (const field of ['file', 'out']) {
    if (Object.hasOwn(value, field)) assert.equal(value[field], revision.file, `${revision.id}: credit file changed`);
  }
  assert.ok([tieInRevisions.credit.before, tieInRevisions.credit.after].includes(value.sourceOrigin),
    `${revision.id}: unrecorded credit`);
  return value.sourceOrigin === tieInRevisions.credit.before
    ? value : { ...value, sourceOrigin: tieInRevisions.credit.before };
}

// A re-review of the same guide is not its earlier approval. Only an exact approval from the
// captured registry, or an earlier one it superseded that is named beside it, may reconstruct the
// pre-extension library.
const originalApprovals = new Map(Object.entries(tieInRevisions.preExtensionApprovalDigests));
const supersededApprovals = new Map(Object.entries(tieInRevisions.supersededPreExtensionApprovalDigests ?? {}));

export function isPreTieInOwnerApproval(contract) {
  return typeof contract?.approvalDigest === 'string'
    && [originalApprovals, supersededApprovals].some((approvals) => approvals.get(contract.id) === contract.approvalDigest);
}

// The tie-in extension may only append. Every earlier record must come back byte for byte from the
// baseline commit, in its original position, and the suffix must be exactly the recorded additions
// under the one approved heading, so a dropped, extra or reordered comic all fail here.
export function beforeTieInPayload(payload, revision = tieInRevisionFor(payload.id)) {
  if (!revision) return payload;
  const original = beforeIdentityJson(`src/data/${revision.file}`, tieInRevisions.baselineCommit);
  assert.equal(original.items.length, revision.originalCount);
  assert.equal(vectorDigest(original.items), revision.originalIssueIdsSha256);
  assert.deepEqual(payload.items.slice(0, revision.originalCount), original.items,
    'Tie-in additions must leave every earlier item record unchanged and in place.');
  const added = payload.items.slice(revision.originalCount);
  assert.deepEqual(added.map(({ issueId }) => issueId), revision.additionIssueIds,
    'Only the recorded tie-in additions may follow the original list.');
  assert.ok(added.every(({ collectedIn }) => collectedIn === tieInRevisions.heading));
  const guideFields = (value) => Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['items', 'count', 'collections'].includes(key)));
  assert.equal(payload.sourceOrigin, tieInRevisions.credit.after, `${revision.id}: current credit`);
  assert.equal(original.sourceOrigin, tieInRevisions.credit.before, `${revision.id}: original credit`);
  const rest = guideFields(beforeTieInCredit(payload, revision));
  const originalRest = guideFields(original);
  assert.deepEqual(rest, originalRest, 'Tie-in additions must not change any guide-level field.');
  assert.equal(payload.count, original.count + added.length);
  assert.equal(payload.collections, original.collections + 1);
  return original;
}

// Only the exact recorded suffix can be removed from a historical review.
export function beforeTieInIssueIds(id, issueIds) {
  const revision = tieInRevisionFor(id);
  if (!revision) return issueIds;
  assert.deepEqual(issueIds.slice(revision.originalCount).map(Number), revision.additionIssueIds,
    `${revision.id} must end with exactly its recorded tie-in additions`);
  return issueIds.slice(0, revision.originalCount);
}

export function beforeTieInOrders(orders) {
  return orders.map((entry) => {
    const issueIds = beforeTieInIssueIds(entry.id ?? entry.orderId, entry.issueIds);
    return issueIds === entry.issueIds ? entry : { ...entry, issueIds };
  });
}

// A manifest read back from before the extension still holds the original credit and is returned
// unchanged, whatever count it recorded then: the Hulk guide listed 12 at the Agatha identity
// baseline and 13 when the extension began. A current entry must carry the team credit and the
// complete suffix.
export function beforeTieInManifest(manifest) {
  return {
    ...manifest,
    lists: manifest.lists.map((entry) => {
      const revision = tieInRevisionFor(entry.id);
      if (!revision) return entry;
      assert.equal(entry.out, revision.file, `${revision.id}: payload identity`);
      if (entry.sourceOrigin === tieInRevisions.credit.before) {
        assert.ok(entry.expect <= revision.originalCount, `${revision.id}: an original credit with tie-in additions`);
        return entry;
      }
      assert.equal(entry.sourceOrigin, tieInRevisions.credit.after, `${revision.id}: current credit`);
      assert.equal(entry.expect, revision.originalCount + revision.additionIssueIds.length,
        `${revision.id}: the current expectation must include the complete tie-in suffix`);
      return { ...beforeTieInCredit(entry, revision), expect: revision.originalCount };
    }),
  };
}

// The checklist is the vendored source, so it carries the same append-only extension. The baseline
// text must come back exactly, and what follows it must parse to exactly the recorded additions.
export function beforeTieInChecklist(id, markdown) {
  const revision = tieInRevisionFor(id);
  if (!revision) return markdown;
  const crlf = markdown.includes('\r\n');
  const current = markdown.replace(/\r\n/g, '\n');
  const original = beforeIdentityText(`src/data/orders/${id}.md`, tieInRevisions.baselineCommit).replace(/\r\n/g, '\n');
  assert.equal(current.slice(0, original.length), original, `${id}: the original checklist text must be unchanged`);
  const added = parseChecklist(current).entries.slice(parseChecklist(original).entries.length);
  assert.deepEqual(added.map(({ issueId, section }) => [Number(issueId), section]),
    revision.additionIssueIds.map((issueId) => [issueId, tieInRevisions.heading]));
  return crlf ? original.replace(/\n/g, '\r\n') : original;
}

export const tieInOrdersAtApproval = (orders, contract) => (
  isPreTieInOwnerApproval(contract) ? beforeTieInOrders(orders) : orders
);
export const tieInManifestAtApproval = (manifest, contract) => (
  isPreTieInOwnerApproval(contract) ? beforeTieInManifest(manifest) : manifest
);
export const tieInPayloadAtApproval = (payload, contract) => (
  isPreTieInOwnerApproval(contract) ? beforeTieInPayload(payload) : payload
);
export const tieInChecklistAtApproval = (id, markdown, contract) => (
  isPreTieInOwnerApproval(contract) ? beforeTieInChecklist(id, markdown) : markdown
);
