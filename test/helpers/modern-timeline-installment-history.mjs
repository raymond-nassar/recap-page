import assert from 'node:assert/strict';
import { assertApprovedRelationshipReview, selectedIssueIds } from '../../scripts/author-cbh-packet.mjs';
import { compareIssueSets, issueIdsFromValue } from '../../scripts/lib/cbh-overlap.mjs';
import { validateMappingDigest } from '../../scripts/lib/cbh-inventory.mjs';
import { deriveSectionalPartMappings } from '../../scripts/lib/cbh-sectional-parts.mjs';

export const installmentParentId = 'civil-war-to-secret-invasion';
export const installmentPartIds = Object.freeze(Array.from({ length: 14 }, (_, index) =>
  `${installmentParentId}-part-${index + 1}`));
export const installmentSources = Object.freeze([
  { id: 'secret-wars-2015-event-tie-ins', insertionAnchor: { beforeId: 'monsters-unleashed' }, rowCount: 226 },
  { id: installmentParentId, insertionAnchor: { beforeId: 'silent-war' }, rowCount: 903 },
  { id: 'world-war-hulk', insertionAnchor: { beforeId: 'annihilation-conquest' }, rowCount: 39 },
]);
export const installmentVisibleIds = Object.freeze([
  installmentSources[0].id, ...installmentPartIds, installmentSources[2].id,
]);
export const installmentIds = new Set([...installmentSources.map(({ id }) => id), ...installmentPartIds]);
export const installmentPartSizes = Object.freeze([69, 70, 72, 63, 73, 67, 71, 18, 70, 66, 75, 46, 75, 68]);
export const installmentItemDelta = installmentSources.filter(({ id }) => id !== installmentParentId)
  .reduce((sum, entry) => sum + entry.rowCount, 0)
  + installmentPartSizes.reduce((sum, count) => sum + count, 0);
// The census counts the eight service-native readings as empty metadata records, not placeholders.
export const installmentCompleteDelta = installmentItemDelta - 8;

export function assertInstallmentVisibleRoster(catalog) {
  const entries = catalog.lists.filter(({ id }) => installmentIds.has(id));
  assert.deepEqual(entries.map(({ id }) => id), installmentVisibleIds,
    'The installment visible roster needs both events and exactly fourteen distinct addable parts, never the parent.');
  for (const [index, id] of installmentPartIds.entries()) {
    const entry = entries.find((row) => row.id === id);
    assert.equal(entry.file, `civil_war_to_secret_invasion_part_${index + 1}.json`);
    assert.equal(entry.count, installmentPartSizes[index]);
  }
}

export function beforeInstallmentOwnerManifest(manifest, recordedIds) {
  if (!Object.hasOwn(manifest, 'sectionalGuides')) return manifest;
  assert.ok(Array.isArray(manifest.sectionalGuides));
  const sectionalGuides = manifest.sectionalGuides.filter(({ id }) =>
    id !== installmentParentId || recordedIds.has(id));
  if (sectionalGuides.length === manifest.sectionalGuides.length) return manifest;
  const original = { ...manifest };
  if (sectionalGuides.length) original.sectionalGuides = sectionalGuides;
  else delete original.sectionalGuides;
  return original;
}

const approvalDigests = new Map([
  ['secret-wars-2015-event-tie-ins', 'ee7b3ac9b09dfa824df1e6cdfd1451de5e45ec99001c6b95686a18a4eec2ce05'],
  ['world-war-hulk', 'cb412f5d8cd02c59a3c104b854fd37bba1ce8d9078360ed04c41372af40dbb91'],
  [installmentParentId, '22c49553840bb72f5787f301ca7e366a95738b9370344af26092071298cad4f4'],
]);
const authoritiesByReader = new WeakMap();

async function installmentAuthority(id, json) {
  if (!authoritiesByReader.has(json)) authoritiesByReader.set(json, new Map());
  const authorities = authoritiesByReader.get(json);
  if (!authorities.has(id)) authorities.set(id, (async () => {
    const [packet, mapping, report] = await Promise.all([
      json(`scripts/data/cbh-packets/${id}.json`),
      json(`scripts/data/cbh-mappings/${id}.json`),
      json(`scripts/data/cbh-overlaps/${id}.json`),
    ]);
    assert.equal(mapping.relationshipReview.approvalDigest, approvalDigests.get(id),
      `${id}: later-peer authority must remain the independently reviewed installment approval.`);
    const peerMappings = await Promise.all(Object.keys(report.peerDigests)
      .map((peerId) => json(`scripts/data/cbh-mappings/${peerId}.json`)));
    assertApprovedRelationshipReview({
      packet, mapping, report, peerMappings, currentLibraryDigest: report.libraryDigest,
      expectedOrderIds: report.comparisons.map(({ orderId }) => orderId),
    });
    return { packet, mapping, report };
  })());
  return authorities.get(id);
}

export async function assertInstallmentLaterPeer(candidateId, later, { json, candidateIds, currentCandidateIds }) {
  if (!installmentIds.has(later.orderId)) return false;
  const partIndex = installmentPartIds.indexOf(later.orderId);
  const sourceId = partIndex < 0 ? later.orderId : installmentParentId;
  const { packet, mapping, report } = await installmentAuthority(sourceId, json);
  const reciprocal = report.comparisons.find(({ orderId }) => orderId === candidateId);
  const disposition = mapping.relationshipReview.dispositions.find(({ orderId }) => orderId === candidateId);
  assert.ok(reciprocal && disposition, `${sourceId}: later authority must include the earlier owner guide.`);
  assert.equal(disposition.decision, 'approved');
  assert.equal(disposition.relationship, reciprocal.relationship);
  assert.equal(disposition.sharedCount, reciprocal.sharedCount);
  assert.deepEqual(disposition.sharedIds, reciprocal.sharedIds);
  const sourceKeys = selectedIssueIds(mapping);
  assert.deepEqual(reciprocal, {
    orderId: candidateId, ...compareIssueSets(sourceKeys, currentCandidateIds),
  }, `${sourceId}: reciprocal authority must still describe the actual owner vector.`);
  let keys = sourceKeys;
  if (partIndex >= 0) {
    const part = await json(`scripts/data/cbh-mappings/${later.orderId}.json`);
    validateMappingDigest(part);
    const derived = deriveSectionalPartMappings({
      packet, mapping, ...packet.sectionalGuide,
    })[partIndex].mapping;
    assert.deepEqual(part, derived, 'A part derives authority from its approved parent, never a separate source approval.');
    assert.equal(part.rows.length, installmentPartSizes[partIndex]);
    keys = selectedIssueIds(part);
    const payload = await json(`src/data/civil_war_to_secret_invasion_part_${partIndex + 1}.json`);
    assert.deepEqual(issueIdsFromValue(payload), keys.map(String),
      `${later.orderId}: an addable part must keep its exact approved source identities.`);
  }
  assert.deepEqual(later, {
    orderId: later.orderId, ...compareIssueSets(candidateIds, keys),
  }, `${later.orderId}: current overlap must be the exact projection of the approved later source.`);
  return true;
}
