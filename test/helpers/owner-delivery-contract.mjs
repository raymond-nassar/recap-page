import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertApprovedRelationshipReview } from '../../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences, digestCanonicalJson, libraryDigestFor, sourceCountsForPacket,
  validateApprovalDigest, validateMappingDigest, validateReportDigest,
} from '../../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport } from '../../scripts/lib/cbh-overlap.mjs';
import { loadCurrentOwnerLibrary } from '../../scripts/lib/owner-current-library.mjs';
import { OWNER_PROVIDER } from '../../scripts/lib/owner-guide.mjs';
import { OWNER_EVENT_PROVIDER } from '../../scripts/lib/owner-guide-registry.mjs';
import { parseChecklist } from '../../src/js/lib/markdown.js';
import { normalizeCover } from '../../src/js/lib/model.js';
import {
  currentReadingCensus, registeredCuratedPeerContracts, registeredOwnerContracts,
} from './current-reading-library.mjs';
import { readCuratedGuidePeerReview } from './curated-guide-peer-review.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');

export async function assertOwnerDeliveryContract(contract, {
  root = fileURLToPath(new URL('../..', import.meta.url)),
  contracts = registeredOwnerContracts,
  peerCount = currentReadingCensus.peers,
  readJson = null,
} = {}) {
  const text = (name) => readFile(path.join(root, name), 'utf8');
  const json = readJson ?? (async (name) => JSON.parse(await text(name)));
  const { id } = contract;
  const event = contract.surface === 'modern-timeline';
  const provider = event ? OWNER_EVENT_PROVIDER : OWNER_PROVIDER;
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
  assert.equal(packet.sourceIssueBearingBlocksSha256, digestCanonicalJson(source.rows));
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
  assert.deepEqual(payload.items.map((row) => row.issueId), expectedIds);
  assert.deepEqual(payload.items.map((row) => row.collectedIn ?? null), expectedGroups);
  assert.deepEqual(payload.items.map((row) => row.title), contract.rows.map((row) => row[2]));
  assert.deepEqual([payload.count, payload.placeholders, payload.unresolved], [expectedIds.length, 0, []]);
  assert.ok(payload.items.every((row) => row.description === null && !row.placeholder && !row.detailsRefused));
  for (const item of payload.items) {
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
  assert.equal(payload.description, contract.description);
  assert.equal(payload.sourceOrigin, provider.sourceOrigin);
  assert.equal(payload.sourceLicense, null);
  if (event) {
    const entry = manifest.lists.find((row) => row.id === id);
    assert.equal(entry.type, 'event');
    assert.equal(entry.timeline, contract.timeline);
    assert.equal(payload.sourceSection, contract.sourceSection);
    assert.deepEqual(source.rows.map((row) => row.annotation), contract.annotations);
  }
  assert.deepEqual(manifest.lists.find((row) => row.id === id), packet.proposedManifest);
  assert.equal(catalog.lists.filter((row) => row.id === id).length, 1);
  assert.equal(catalog.lists.find((row) => row.id === id).source, contract.sourceUrl);

  const library = await loadCurrentOwnerLibrary(id, { root });
  const current = buildComparisonReport({ candidateIds: expectedIds, orders: library.orders });
  const recordedIds = new Set(report.comparisons.map((row) => row.orderId));
  const peerIds = contract.peerIds ?? [];
  assert.equal(new Set(peerIds).size, peerIds.length);
  assert.ok(!peerIds.includes(id));
  assert.deepEqual(Object.keys(report.peerDigests).sort(), [...peerIds].sort());
  const peerMappings = await Promise.all(peerIds.map(async (peerId) => {
    assert.ok(contracts.some((entry) => entry.id === peerId), 'Selected peers require independent registered contracts.');
    const peer = await json(`scripts/data/owner-mappings/${peerId}.json`);
    assert.equal(peer.id, peerId);
    return peer;
  }));
  const recordedOrders = library.orders.filter((row) => recordedIds.has(row.orderId) && !peerIds.includes(row.orderId));
  const recordedManifest = {
    ...library.manifest,
    lists: library.manifest.lists.filter((row) => recordedIds.has(row.id) && !peerIds.includes(row.id)),
  };
  const currentLibraryDigest = libraryDigestFor(recordedManifest, recordedOrders.map((row) => ({
    id: row.orderId, issueIds: row.issueIds.map(String),
  })));
  assert.deepEqual(current.comparisons.filter((row) => recordedIds.has(row.orderId)), report.comparisons);
  assert.equal(current.comparisonCount, peerCount);
  assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest,
    peerMappings,
    expectedOrderIds: [...recordedOrders.map((row) => row.orderId), ...peerIds], packetValidation: { provider },
  });
  for (const later of current.comparisons.filter((row) => !recordedIds.has(row.orderId))) {
    const laterContract = contracts.find((entry) => entry.id === later.orderId);
    const curatedContract = registeredCuratedPeerContracts.find((entry) => entry.id === later.orderId);
    assert.ok(laterContract || curatedContract, 'Unregistered later peers require a new bounded relationship review.');
    if (curatedContract) {
      const review = await readCuratedGuidePeerReview(curatedContract, { root });
      const reciprocal = review.relationships.find((row) => row.orderId === id);
      assert.equal(review.status, 'approved');
      const inverse = { none: 'none', partial: 'partial', 'candidate-subset': 'existing-subset', 'existing-subset': 'candidate-subset' };
      const reviewedRelationship = reciprocal?.relationship ?? review.unlistedDisposition;
      const reviewedSharedCount = reciprocal?.sharedCount ?? 0;
      const reviewedSharedIds = reciprocal?.sharedIds ?? [];
      assert.equal(later.relationship, inverse[reviewedRelationship]);
      assert.equal(later.sharedCount, reviewedSharedCount);
      const expectedSharedIds = reviewedSharedIds === 'candidate-vector'
        ? (await json(`src/data/${curatedContract.payloadFile.replace(/^src\/data\//, '')}`))
          .items.map((item) => String(item.issueId))
        : reviewedSharedIds;
      assert.deepEqual([...later.sharedIds].sort(), [...expectedSharedIds].sort());
      continue;
    }
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
}
