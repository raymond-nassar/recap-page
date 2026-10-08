import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertApprovedRelationshipReview } from '../../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences, digestCanonicalJson, libraryDigestFor, sourceCountsForPacket,
} from '../../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport } from '../../scripts/lib/cbh-overlap.mjs';
import { loadCurrentOwnerLibrary } from '../../scripts/lib/owner-current-library.mjs';
import { OWNER_PROVIDER } from '../../scripts/lib/owner-guide.mjs';
import { parseChecklist } from '../../src/js/lib/markdown.js';
import { normalizeCover } from '../../src/js/lib/model.js';
import {
  currentReadingCensus, registeredOwnerContracts,
} from './current-reading-library.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');

export async function assertOwnerDeliveryContract(contract, {
  root = fileURLToPath(new URL('../..', import.meta.url)),
  contracts = registeredOwnerContracts,
  peerCount = currentReadingCensus.peers,
} = {}) {
  const text = (name) => readFile(path.join(root, name), 'utf8');
  const json = async (name) => JSON.parse(await text(name));
  const { id } = contract;
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
  assert.equal(payload.sourceOrigin, OWNER_PROVIDER.sourceOrigin);
  assert.equal(payload.sourceLicense, null);
  assert.deepEqual(manifest.lists.find((row) => row.id === id), packet.proposedManifest);
  assert.equal(catalog.lists.filter((row) => row.id === id).length, 1);
  assert.equal(catalog.lists.find((row) => row.id === id).source, contract.sourceUrl);

  const library = await loadCurrentOwnerLibrary(id, { root });
  const current = buildComparisonReport({ candidateIds: expectedIds, orders: library.orders });
  const recordedIds = new Set(report.comparisons.map((row) => row.orderId));
  const recordedOrders = library.orders.filter((row) => recordedIds.has(row.orderId));
  const recordedManifest = { ...library.manifest, lists: library.manifest.lists.filter((row) => recordedIds.has(row.id)) };
  const currentLibraryDigest = libraryDigestFor(recordedManifest, recordedOrders.map((row) => ({
    id: row.orderId, issueIds: row.issueIds.map(String),
  })));
  assert.deepEqual(current.comparisons.filter((row) => recordedIds.has(row.orderId)), report.comparisons);
  assert.equal(current.comparisonCount, peerCount);
  assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest,
    expectedOrderIds: recordedOrders.map((row) => row.orderId), packetValidation: { provider: OWNER_PROVIDER },
  });
  for (const later of current.comparisons.filter((row) => !recordedIds.has(row.orderId))) {
    const laterContract = contracts.find((entry) => entry.id === later.orderId);
    assert.ok(laterContract, 'Unregistered later peers require a new bounded relationship review.');
    const laterReport = await json(`scripts/data/owner-overlaps/${later.orderId}.json`);
    const reciprocal = laterReport.comparisons.find((row) => row.orderId === id);
    assert.ok(reciprocal, 'New owner authority must include the complete earlier library.');
    const inverse = { none: 'none', partial: 'partial', 'candidate-subset': 'existing-subset', 'existing-subset': 'candidate-subset' };
    assert.equal(later.relationship, inverse[reciprocal.relationship]);
    assert.equal(later.sharedCount, reciprocal.sharedCount);
    assert.deepEqual([...later.sharedIds].sort(), [...reciprocal.sharedIds].sort());
  }
}
