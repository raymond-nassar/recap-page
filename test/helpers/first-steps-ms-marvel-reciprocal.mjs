import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { assertApprovedRelationshipReview } from '../../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences, digestCanonicalJson, libraryDigestFor,
  validateApprovalDigest, validateFrozenPacket, validateMappingDigest, validateReportDigest,
} from '../../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport, compareIssueSets } from '../../scripts/lib/cbh-overlap.mjs';
import { loadCurrentOwnerLibrary } from '../../scripts/lib/owner-current-library.mjs';
import { OWNER_SOURCE_PROVIDER } from '../../scripts/report-fantastic-four-overlap.mjs';
import { legacyOwnerPeers } from './current-reading-library.mjs';

export const MS_MARVEL_PROVIDER = Object.freeze({
  id: 'owner-authored', hosts: ['github.com'], sourceOrigin: 'Selected by raymond-nassar for MCU Prep',
  requireSourceProvider: true, requireSourceContentSha256: true,
});
const frozenId = 'mcu-prep-fantastic-four-first-steps';
const reviewedId = 'mcu-prep-ms-marvel';
const json = async (file) => JSON.parse(await readFile(new URL(`../../${file}`, import.meta.url), 'utf8'));

function assertIdentity(reference, packet, mapping, report, liveIds, label) {
  assert.equal(reference.id, packet.id, `${label} guide identity changed`);
  assert.equal(reference.packetDigest, packet.packetDigest, `${label} packet identity changed`);
  assert.equal(reference.mappingDigest, mapping.mappingDigest, `${label} mapping identity changed`);
  assert.equal(reference.reportDigest, report.reportDigest, `${label} report identity changed`);
  assert.equal(reference.approvalDigest, mapping.relationshipReview.approvalDigest,
    `${label} reference names a stale approval`);
  assert.equal(reference.vectorSha256, digestCanonicalJson(liveIds.map(String)),
    `${label} live ordered original vector changed`);
  assert.deepEqual(packet.rows.map((row) => String(row.candidateIssueId)), liveIds.map(String));
  assert.deepEqual(mapping.rows.map((row) => String(row.selectedIssueId)), liveIds.map(String));
}

export async function assertFirstStepsMsMarvelReciprocal({ reference, packet, mapping, report }) {
  assert.equal(reference.schemaVersion, 1);
  assert.equal(reference.evidenceKind, 'approved-reciprocal-owner-relationship-reference');
  assert.equal(reference.frozenGuide.id, frozenId);
  assert.equal(reference.reviewedGuide.id, reviewedId);
  assert.equal(packet.id, frozenId);
  validateFrozenPacket(packet, { provider: OWNER_SOURCE_PROVIDER });
  validateMappingDigest(mapping);
  assertMappingMatchesPacketOccurrences(packet, mapping);
  validateReportDigest(report);
  validateApprovalDigest(mapping.relationshipReview, frozenId);
  assert.equal(mapping.packetDigest, packet.packetDigest);
  assert.equal(report.packetDigest, packet.packetDigest);
  assert.equal(report.mappingDigest, mapping.mappingDigest);
  assert.equal(mapping.relationshipReview.reportDigest, report.reportDigest);

  const [reviewedPacket, reviewedMapping, reviewedReport, payload, library] = await Promise.all([
    json(`scripts/data/owner-packets/${reviewedId}.json`),
    json(`scripts/data/owner-mappings/${reviewedId}.json`),
    json(`scripts/data/owner-overlaps/${reviewedId}.json`),
    json('src/data/mcu_prep_ms_marvel.json'),
    loadCurrentOwnerLibrary(reviewedId),
  ]);
  const reviewedIds = payload.items.map((row) => row.issueId);
  const frozenOrder = library.orders.find((row) => row.orderId === frozenId);
  assert.ok(frozenOrder, 'The live First Steps original vector is missing');
  const frozenIds = frozenOrder.issueIds;
  assertIdentity(reference.frozenGuide, packet, mapping, report, frozenIds, 'First Steps');
  assertIdentity(reference.reviewedGuide, reviewedPacket, reviewedMapping, reviewedReport,
    reviewedIds, 'Ms. Marvel reciprocal');

  const recordedIds = new Set(reviewedReport.comparisons.map((row) => row.orderId));
  const recordedOrders = library.orders.filter((row) => recordedIds.has(row.orderId));
  assert.equal(recordedOrders.length, recordedIds.size, 'A reciprocal publication-cohort peer is missing');
  const recordedManifest = {
    ...library.manifest, lists: library.manifest.lists.filter((row) => recordedIds.has(row.id)),
  };
  const recordedDigest = libraryDigestFor(recordedManifest, recordedOrders.map((row) => ({
    id: row.orderId, issueIds: row.issueIds.map(String),
  })));
  assert.equal(reference.recordedLibraryDigest, recordedDigest,
    'The reciprocal reference must bind its recorded post-refresh publication cohort');
  assert.deepEqual(buildComparisonReport({
    candidateIds: reviewedIds, orders: recordedOrders,
  }).comparisons, reviewedReport.comparisons);
  assertApprovedRelationshipReview({
    packet: reviewedPacket, mapping: reviewedMapping, report: reviewedReport,
    currentLibraryDigest: recordedDigest, expectedOrderIds: [...recordedIds],
    packetValidation: { provider: MS_MARVEL_PROVIDER },
  });

  const reciprocal = compareIssueSets(frozenIds, reviewedIds);
  assert.deepEqual(reference.relationship, {
    fromId: frozenId, toId: reviewedId, ...reciprocal,
  }, 'The referenced reciprocal must exactly match the live shared originals');
  assert.deepEqual([reciprocal.relationship, reciprocal.sharedCount, reciprocal.sharedIds],
    ['partial', 1, ['49846']]);
  assert.deepEqual(reviewedReport.comparisons.find((row) => row.orderId === frozenId), {
    orderId: frozenId, ...compareIssueSets(reviewedIds, frozenIds),
  });
  assert.equal(report.comparisons.some((row) => row.orderId === reviewedId), false,
    'The reciprocal is a later relationship, not a rewrite of the frozen First Steps report');

  const current = buildComparisonReport({
    candidateIds: frozenIds,
    orders: [
      ...library.orders.filter((row) => row.orderId !== frozenId),
      { orderId: reviewedId, issueIds: reviewedIds },
    ],
  });
  const approvedDelta = { orderId: reviewedId, ...reciprocal };
  const expectedNonNone = [
    ...report.comparisons.filter((row) => row.relationship !== 'none'), approvedDelta,
  ].sort((left, right) => left.orderId.localeCompare(right.orderId));
  assert.deepEqual(legacyOwnerPeers(current.comparisons).filter((row) => row.relationship !== 'none'),
    expectedNonNone, 'Every other new non-none First Steps relationship requires fresh authority');
  assert.equal(digestCanonicalJson(reference),
    '9f7643ad0d7ab38bc08261747705e038045d0024d9a5ae3e1e925c049160e9cc',
    'The exact parent-approved reciprocal reference changed');
  return { current, approvedDelta, recordedDigest };
}
