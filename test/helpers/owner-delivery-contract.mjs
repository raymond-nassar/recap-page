import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertApprovedRelationshipReview } from '../../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences, CBH_SOURCE_PROVIDER, digestCanonicalJson, libraryDigestFor, reportDigestFor, sourceCountsForPacket,
  validateApprovalDigest, validateMappingDigest, validateReportDigest,
} from '../../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport } from '../../scripts/lib/cbh-overlap.mjs';
import { loadCurrentOwnerLibrary } from '../../scripts/lib/owner-current-library.mjs';
import { OWNER_PROVIDER } from '../../scripts/lib/owner-guide.mjs';
import { OWNER_EVENT_PROVIDER } from '../../scripts/lib/owner-guide-registry.mjs';
import { parseChecklist } from '../../src/js/lib/markdown.js';
import { normalizeCover } from '../../src/js/lib/model.js';
import {
  currentReadingCensus, registeredCuratedGuides, registeredOwnerBaselineRows, registeredOwnerContracts,
} from './current-reading-library.mjs';
import { historicalSpiderManSelectionLibraryDigest } from './reading-choice-history.mjs';
import { beforeMcuEditorialEntry } from '../../scripts/lib/mcu-editorial.mjs';
import { recordedEditorialDigest, withRetiredComparisons, withRetiredOrders } from './mcu-editorial-history.mjs';
import { beforeIdentityEntry, beforeIdentityJson, beforeIdentityOrders, beforeIdentityText, identityRevisions } from './owner-identity-history.mjs';
import { assertCbhBaselinePayload } from '../../scripts/lib/owner-cbh-baseline.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');

export async function assertOwnerDeliveryContract(contract, {
  root = fileURLToPath(new URL('../..', import.meta.url)),
  contracts = registeredOwnerContracts,
  peerCount = currentReadingCensus.peers,
  readJson = null,
  readText = null,
} = {}) {
  const text = readText ?? ((name) => readFile(path.join(root, name), 'utf8'));
  const json = readJson ?? (async (name) => JSON.parse(await text(name)));
  if (contract.sourceProvider === CBH_SOURCE_PROVIDER.id) {
    return assertCbhOwnerBaselineContract(contract, { root, text, json, peerCount, contracts });
  }
  const { id } = contract;
  const event = contract.surface === 'modern-timeline';
  const provider = event ? OWNER_EVENT_PROVIDER : (contract.sourceOrigin
    ? { ...OWNER_PROVIDER, sourceOrigin: contract.sourceOrigin }
    : OWNER_PROVIDER);
  const [sourceText, packet, mapping, report, manifest, catalog, markdown] = await Promise.all([
    text(`scripts/data/owner-selections/${id}.json`), json(`scripts/data/owner-packets/${id}.json`),
    json(`scripts/data/owner-mappings/${id}.json`), json(`scripts/data/owner-overlaps/${id}.json`),
    json('src/data/curated-lists.json'), json('src/data/catalog.json'), text(`src/data/orders/${id}.md`),
  ]);
  const source = JSON.parse(sourceText);
  const payload = await json(`src/data/${packet.proposedManifest.out}`);
  const expectedIds = contract.rows.map((row) => row[1]);
  const expectedPositions = contract.rows.map((row) => row[0]);
  const expectedGroups = contract.rows.map((row) => row[3] == null ? null : contract.groups[row[3]]);
  // Fresh Windows checkouts convert generated LF source JSON to CRLF without changing its approved content.
  assert.equal(hash(sourceText.replace(/\r\n/g, '\n')), contract.sourceSha256);
  assert.equal(packet.sourceContentSha256, contract.sourceSha256);
  assert.equal(
    packet.sourceIssueBearingBlocksSha256,
    contract.sourceIssueBearingBlocksSha256 ?? digestCanonicalJson(source.rows),
  );
  assert.deepEqual(sourceCountsForPacket(packet), contract.sourceCounts);
  assertMappingMatchesPacketOccurrences(packet, mapping);
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), expectedIds);
  assert.deepEqual(mapping.rows.map((row) => row.sourcePosition), expectedPositions);
  assert.equal(mapping.relationshipReview.proposalDigest, contract.proposalDigest);
  assert.equal(mapping.relationshipReview.approvalDigest, contract.approvalDigest);
  const parsed = parseChecklist(markdown);
  assert.deepEqual(parsed.unresolved, []);
  assert.deepEqual(parsed.entries.map((row) => row.issueId), expectedIds);
  assert.deepEqual(parsed.entries.map((row) => Number(row.sourceKey)), expectedPositions);
  assert.deepEqual(parsed.entries.map((row) => row.section), expectedGroups);
  assert.deepEqual(parsed.entries.map((row) => row.identityEvidenceKind ?? null),
    mapping.rows.map((row) => row.identityEvidenceKind ?? null));
  assert.deepEqual(payload.items.map((row) => row.issueId), expectedIds);
  assert.deepEqual(payload.items.map((row) => row.collectedIn ?? null), expectedGroups);
  assert.deepEqual(payload.items.map((row) => row.title), contract.rows.map((row) => row[2]));
  assert.deepEqual([payload.count, payload.placeholders, payload.unresolved], [expectedIds.length, 0, []]);
  assert.ok(payload.items.every((row) => row.description === null && !row.placeholder));
  for (const [index, item] of payload.items.entries()) {
    const row = mapping.rows[index];
    if (row.identityEvidenceKind === 'owner-confirmed-identity') {
      assert.equal(item.detailsRefused, true);
      assert.equal(item.identityEvidenceKind, 'owner-confirmed-identity');
      assert.equal(item.url, row.marvelIssueUrl);
      assert.equal(item.seriesId, null);
      assert.equal(item.seriesName, null);
      assert.equal(item.onSale, null);
      assert.equal(item.mu, null);
      assert.equal(item.digitalId, null);
      assert.equal(item.cover, null);
      assert.equal(item.pageCount, null);
      assert.deepEqual(item.creators, []);
      assert.equal(mapping.candidateMetadata.some((candidate) => candidate.id === item.issueId), false);
      continue;
    }
    assert.ok(!item.detailsRefused);
    const metadata = mapping.candidateMetadata.find((row) => row.id === item.issueId)?.providerProjection;
    assert.ok(metadata, 'Every published original needs its approved metadata projection.');
    assert.equal(item.digitalId, metadata.digitalId);
    assert.equal(item.seriesId, metadata.seriesId);
    assert.equal(item.onSale, metadata.onSaleDate);
    assert.equal(item.mu, metadata.unlimitedDate);
    assert.equal(item.pageCount, metadata.pageCount);
    assert.deepEqual(item.cover, normalizeCover(metadata.cover));
    assert.deepEqual(item.creators, (metadata.creators ?? [])
      .filter((credit) => /writer|penciler|artist/i.test(credit.role))
      .map(({ name, role }) => ({ name, role })));
  }
  assert.equal(payload.description === contract.description
    ? payload.description : beforeMcuEditorialEntry(payload).description, contract.description);
  assert.equal(payload.sourceOrigin, contract.sourceOrigin ?? provider.sourceOrigin);
  assert.equal(payload.sourceLicense, null);
  if (event) {
    const entry = manifest.lists.find((row) => row.id === id);
    assert.equal(entry.type, 'event');
    assert.equal(entry.timeline, contract.timeline);
    assert.equal(payload.sourceSection, contract.sourceSection);
    assert.deepEqual(source.rows.map((row) => row.annotation), contract.annotations);
  }
  const currentEntry = manifest.lists.find((row) => row.id === id);
  assert.deepEqual(currentEntry.description === packet.proposedManifest.description
    ? currentEntry : beforeMcuEditorialEntry(currentEntry), packet.proposedManifest);
  assert.equal(catalog.lists.filter((row) => row.id === id).length, 1);
  assert.equal(catalog.lists.find((row) => row.id === id).source, contract.sourceUrl);
  assert.equal(
    catalog.lists.find((row) => row.id === id).ownerConfirmedIdentityCount ?? 0,
    mapping.rows.filter((row) => row.identityEvidenceKind === 'owner-confirmed-identity').length,
  );

  const library = await loadCurrentOwnerLibrary(id, { root });
  const current = buildComparisonReport({ candidateIds: expectedIds, orders: library.orders });
  const recordedIds = new Set(report.comparisons.map((row) => row.orderId));
  const peerIds = contract.peerIds ?? [];
  assert.equal(new Set(peerIds).size, peerIds.length);
  assert.ok(!peerIds.includes(id));
  assert.deepEqual(Object.keys(report.peerDigests).sort(), [...peerIds].sort());
  const peerMappings = await Promise.all(peerIds.map(async (peerId) => {
    assert.ok(contracts.some((entry) => entry.id === peerId), 'Selected peers require independent registered contracts.');
    let peer = await json(`scripts/data/owner-mappings/${peerId}.json`);
    assert.equal(peer.id, peerId);
    if (identityRevisions.guides.some((entry) => entry.id === peerId)
      && peer.mappingDigest !== report.peerDigests[peerId]) {
      peer = beforeIdentityJson(`scripts/data/owner-mappings/${peerId}.json`);
      assert.equal(peer.mappingDigest, report.peerDigests[peerId]);
    }
    return peer;
  }));
  const recordedOrders = withRetiredOrders(library.orders.filter((row) =>
    recordedIds.has(row.orderId) && !peerIds.includes(row.orderId)), recordedIds);
  const recordedManifest = {
    ...library.manifest,
    lists: library.manifest.lists.filter((row) => recordedIds.has(row.id) && !peerIds.includes(row.id)),
  };
  const digestLibrary = contract.libraryDigest == null
    ? historicalSpiderManSelectionLibraryDigest : recordedEditorialDigest;
  const recordedVectors = recordedOrders.map((row) => ({ id: row.orderId, issueIds: row.issueIds.map(String) }));
  const identityUpdate = identityRevisions.guides.some((entry) => entry.id === id);
  const cutoff = identityUpdate ? mapping.relationshipReview.reviewedAt : '';
  const recordedCurrentDigest = libraryDigestFor({
    ...recordedManifest, lists: recordedManifest.lists.map((entry) => beforeIdentityEntry(entry, cutoff)),
  }, beforeIdentityOrders(recordedVectors, cutoff));
  // A guide reviewed after every recorded identity and editorial revision saw today's library as it
  // stood, so its recorded subset needs no historical reconstruction. Only its own stated digest can
  // select this, and the digest must still match.
  const plainRecordedDigest = libraryDigestFor(recordedManifest, recordedVectors);
  const currentLibraryDigest = registeredOwnerBaselineRows.has(id)
    ? report.libraryDigest
    : (contract.libraryDigest === recordedCurrentDigest
      ? recordedCurrentDigest
      : (contract.libraryDigest != null && contract.libraryDigest === plainRecordedDigest
        ? plainRecordedDigest : digestLibrary(recordedManifest, recordedVectors)));
  if (contract.libraryDigest != null) assert.equal(currentLibraryDigest, contract.libraryDigest);
  assert.deepEqual(withRetiredComparisons(current.comparisons.filter((row) =>
    recordedIds.has(row.orderId)), expectedIds, report), report.comparisons);
  assert.equal(current.comparisonCount, peerCount);
  assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest,
    peerMappings,
    expectedOrderIds: [...recordedOrders.map((row) => row.orderId), ...peerIds], packetValidation: { provider },
  });
  for (const later of (registeredOwnerBaselineRows.has(id)
    ? [] : current.comparisons.filter((row) => !recordedIds.has(row.orderId)))) {
    await assertRegisteredLaterPeer(id, later, { contracts, json });
  }
}

// A list published after a guide was reviewed is not in that guide's recorded comparisons. It is
// accepted only as a registered curated addition, or as a registered owner guide whose own authority
// records the reciprocal relationship with this one.
async function assertRegisteredLaterPeer(id, later, { contracts, json }) {
  if (registeredCuratedGuides.some((entry) => entry.id === later.orderId)) return;
  const laterContract = contracts.find((entry) => entry.id === later.orderId);
  assert.ok(laterContract, `${later.orderId}: unregistered later peers require a new bounded relationship review.`);
  const laterReport = await json(`scripts/data/owner-overlaps/${later.orderId}.json`);
  const laterMapping = await json(`scripts/data/owner-mappings/${later.orderId}.json`);
  validateMappingDigest(laterMapping);
  validateReportDigest(laterReport);
  validateApprovalDigest(laterMapping.relationshipReview, later.orderId);
  assert.equal(laterMapping.reviewStatus, 'approved');
  assert.equal(laterMapping.relationshipReview.approvalDigest, laterContract.approvalDigest);
  assert.equal(laterMapping.relationshipReview.reportDigest, laterReport.reportDigest);
  const reciprocal = laterReport.comparisons.find((row) => row.orderId === id);
  const authority = laterMapping.relationshipReview.dispositions.find((row) => row.orderId === id);
  assert.ok(reciprocal, 'New owner authority must include the complete earlier library.');
  assert.ok(authority, 'New owner authority needs an explicit reciprocal disposition.');
  assert.equal(authority.decision, 'approved');
  assert.equal(authority.relationship, reciprocal.relationship);
  assert.equal(authority.sharedCount, reciprocal.sharedCount);
  assert.deepEqual(authority.sharedIds, reciprocal.sharedIds);
  if (later.relationship !== 'none') {
    assert.ok(['human', 'stronger-model'].includes(authority.authorityType));
  }
  const inverse = { none: 'none', partial: 'partial', 'candidate-subset': 'existing-subset', 'existing-subset': 'candidate-subset' };
  assert.equal(later.relationship, inverse[reciprocal.relationship]);
  assert.equal(later.sharedCount, reciprocal.sharedCount);
  assert.deepEqual([...later.sharedIds].sort(), [...reciprocal.sharedIds].sort());
}

async function assertCbhOwnerBaselineContract(contract, { root, text, json, peerCount, contracts }) {
  const { id } = contract;
  const [sourceText, packet, mapping, report, markdown, manifest, catalog] = await Promise.all([
    text(`scripts/data/owner-selections/${id}.json`),
    json(`scripts/data/owner-packets/${id}.json`),
    json(`scripts/data/owner-mappings/${id}.json`),
    json(`scripts/data/owner-overlaps/${id}.json`),
    text(`src/data/orders/${id}.md`),
    json('src/data/curated-lists.json'), json('src/data/catalog.json'),
  ]);
  const payload = await json(`src/data/${packet.proposedManifest.out}`);
  const originalPacket = await json(`scripts/data/cbh-packets/${id}.json`);
  const originalMapping = await json(`scripts/data/cbh-mappings/${id}.json`);
  assert.deepEqual(packet.sourceReview, originalPacket.sourceReview);
  const identities = mapping.rows.filter((row) => row.identityEvidenceKind === 'owner-confirmed-identity');
  const identityPositions = new Set(identities.map((row) => row.sourcePosition));
  assert.deepEqual(mapping.rows.filter((row) => !identityPositions.has(row.sourcePosition)), originalMapping.rows);
  assert.ok(identities.every((row) => originalPacket.sourceGaps.some((gap) =>
    gap.sourcePosition === row.sourcePosition)));
  assert.deepEqual(packet.sourceGaps, originalPacket.sourceGaps.filter((gap) =>
    !identityPositions.has(gap.sourcePosition)));
  assert.equal(mapping.reviewStatus, 'approved');
  assert.equal(hash(sourceText.replace(/\r\n/g, '\n')), contract.sourceSha256);
  assert.equal(packet.sourceContentSha256, originalPacket.sourceContentSha256);
  assert.equal(packet.sourceIssueBearingBlocksSha256, contract.sourceIssueBearingBlocksSha256);
  assert.deepEqual(sourceCountsForPacket(packet), contract.sourceCounts);
  assertMappingMatchesPacketOccurrences(packet, mapping);
  assertCbhBaselinePayload(contract, mapping, payload, markdown);
  assert.equal(payload.description, contract.description);
  assert.equal(payload.sourceOrigin, contract.sourceOrigin);
  assert.equal(contract.sourceOrigin, CBH_SOURCE_PROVIDER.sourceOrigin);
  assert.deepEqual(manifest.lists.find((entry) => entry.id === id), packet.proposedManifest);
  assert.equal(catalog.lists.filter((entry) => entry.id === id).length, 1);
  for (const [file, digest] of Object.entries(contract.cbhBaseline.files)) {
    assert.equal(hash(beforeIdentityText(file, contract.cbhBaseline.sourceCommit).replace(/\r\n/g, '\n')), digest, file);
  }
  const library = await loadCurrentOwnerLibrary(id, { root });
  const publication = identityRevisions.guides.filter((revision) =>
    revision.id === id && revision.placeholderReplacement).at(-1);
  if (publication) assert.equal(mapping.relationshipReview.reviewedAt, publication.generatedAt);
  const allOrders = beforeIdentityOrders(library.orders, '',
    identityRevisions.guides.filter((revision) => revision.placeholderReplacement
      && revision.publicationOrder > (publication?.publicationOrder ?? 0)));
  // The recorded report covers the library this guide was reviewed against. Anything published
  // since is held to the same registered-later-peer rule as an ordinary owner guide.
  const recordedIds = new Set(report.comparisons.map((entry) => entry.orderId));
  const orders = allOrders.filter((entry) => recordedIds.has(entry.orderId));
  const recordedManifest = {
    ...library.manifest, lists: library.manifest.lists.filter((entry) => recordedIds.has(entry.id)),
  };
  const current = {
    candidateId: id, packetDigest: mapping.packetDigest, mappingDigest: mapping.mappingDigest,
    libraryDigest: libraryDigestFor(recordedManifest,
      orders.map((entry) => ({ id: entry.orderId, issueIds: entry.issueIds.map(String) }))),
    peerDigests: {}, sourceCounts: sourceCountsForPacket(mapping),
    ...buildComparisonReport({ candidateIds: mapping.rows.map((row) => row.selectedIssueId), orders }),
  };
  current.reportDigest = reportDigestFor(current);
  assert.deepEqual(current, report);
  const full = buildComparisonReport({ candidateIds: mapping.rows.map((row) => row.selectedIssueId), orders: allOrders });
  assert.equal(full.comparisonCount, peerCount);
  for (const later of full.comparisons.filter((entry) => !recordedIds.has(entry.orderId))) {
    await assertRegisteredLaterPeer(id, later, { contracts, json });
  }
  assert.equal(contract.proposalDigest, mapping.relationshipReview.proposalDigest);
  assert.equal(contract.approvalDigest, mapping.relationshipReview.approvalDigest);
  assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: current.libraryDigest,
    expectedOrderIds: current.comparisons.map((entry) => entry.orderId),
    packetValidation: { provider: CBH_SOURCE_PROVIDER },
  });
}
