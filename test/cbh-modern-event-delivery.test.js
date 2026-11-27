import test from 'node:test';
import { beforeFirstInstallmentManifest } from './helpers/first-installment-history.mjs';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { buildMarkdown, assertApprovedRelationshipReview, selectedIssueIds } from '../scripts/author-cbh-packet.mjs';
import { buildComparisonReport } from '../scripts/lib/cbh-overlap.mjs';
import {
  digestCanonicalJson, gapEvidenceDigestFor, libraryDigestFor, validateFrozenPacket,
  validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { loadCurrentOwnerLibrary } from '../scripts/lib/owner-current-library.mjs';
import { descriptionRevisions } from '../scripts/lib/description-revisions.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { selectPreparationGuides } from '../scripts/prepare-cbh-batch.mjs';
import { firstSentence, modernTimelineLists, parseCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  beforeWolverineCorrectionManifest, beforeWolverineCorrectionOrders,
} from './helpers/wolverine-correction-history.mjs';
import { beforeXmenEraManifest, beforeXmenEraOrders } from './helpers/xmen-era-history.mjs';
import { loadBeforeWolverineCorrectionLibrary } from './helpers/reading-choice-history.mjs';
import { beforeTieInManifest, beforeTieInOrders } from './helpers/mcu-tie-in-history.mjs';

const readJson = async (file) => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const contract = await readJson('test/fixtures/cbh-modern-event-review.json');
const ids = contract.guides.map((guide) => guide.id);
const digestVector = (values) => createHash('sha256').update(JSON.stringify(values)).digest('hex');
const reviewedPathIds = new Set(['modern-avengers', 'x-men-messiah-to-avx', 'professor-x-and-the-x-men']);

async function guideEvidence(id) {
  const [packet, mapping, report] = await Promise.all([
    readJson(`scripts/data/cbh-packets/${id}.json`),
    readJson(`scripts/data/cbh-mappings/${id}.json`),
    readJson(`scripts/data/cbh-overlaps/${id}.json`),
  ]);
  return { packet, mapping, report };
}

test('Civil War II distinguishes the supplied unnumbered FCBD label and viewer from retained page witnesses', async () => {
  const { mapping } = await guideEvidence('civil-war-ii');
  const generated = buildMarkdown(mapping);
  assert.match(generated, /153 positions have retained page witnesses; position 20 uses the maintainer-supplied transcription "Free Comic Book Day Civil War II", with no printed issue number/);
  assert.match(generated, /between Captain Marvel #6 and Ultimates #8/);
  assert.match(generated, /Viewer 28308 was supplied separately, not as an article link/);
  assert.match(generated, /Provider edition 58711 remains the same; its edition number #1 is metadata, not a number printed in the supplied label/);
  const rows = parseChecklist(generated).entries;
  assert.equal(Number(rows[19].issueId), 58711);
  assert.equal(Number(rows[18].issueId), 56589);
  assert.equal(Number(rows[20].issueId), 57262);
});

test('the four early Modern Timeline guides preserve the reviewed payloads and reciprocal peer overlaps', async () => {
  const ids = ['avengers-standoff', 'civil-war-ii', 'road-to-secret-empire', 'secret-empire-event'];
  const reviewedOccurrences = [26, 154, 99, 85];
  const emptyCounts = [3, 11, 8, 19];
  const all = [...ids, 'wolverine-reading-order'];
  const evidence = new Map(await Promise.all(all.map(async (id) => [id, await guideEvidence(id)])));
  const guides = await selectPreparationGuides(ids);
  assert.deepEqual(guides.map(({ id, isFrozenPacket, approvedSourceCount }) =>
    [id, isFrozenPacket, approvedSourceCount]), ids.map((id, index) => [id, true, reviewedOccurrences[index]]));
  await assert.rejects(selectPreparationGuides(['secret-empire']), /multiple frozen packets/);

  const { lists } = await readJson('src/data/catalog.json');
  const vectors = new Map(await Promise.all(all.map(async (id) => {
    const entry = lists.find((entry) => entry.id === id);
    const payload = await readJson(`src/data/${entry.file}`);
    return [id, payload.items.map(({ issueId }) => String(issueId))];
  })));
  for (const [index, id] of ids.entries()) {
    const { packet, mapping, report } = evidence.get(id);
    const peers = all.filter((peer) => peer !== id);
    const list = lists.find((entry) => entry.id === id);
    assert.equal(list.emptyRecordCount, emptyCounts[index]);
    assert.equal(list.placeholderCount, 0);
    assert.deepEqual(vectors.get(id), selectedIssueIds(mapping));
    assert.deepEqual(Object.keys(report.peerDigests).sort(), peers.sort());
    assertApprovedRelationshipReview({
      packet, mapping, report, currentLibraryDigest: report.libraryDigest,
      peerMappings: peers.map((peer) => evidence.get(peer).mapping),
      expectedOrderIds: report.comparisons.map(({ orderId }) => orderId),
    });
    const checklist = await readFile(new URL(`../src/data/orders/${id}.md`, import.meta.url), 'utf8');
    assert.equal(checklist.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
    for (const peer of peers) {
      const forward = report.comparisons.find(({ orderId }) => orderId === peer);
      const backward = evidence.get(peer).report.comparisons.find(({ orderId }) => orderId === id);
      const peerSet = new Set(vectors.get(peer));
      const shared = vectors.get(id).filter((issueId) => peerSet.has(issueId)).sort();
      assert.deepEqual(forward.sharedIds.slice().sort(), shared, `${id} to ${peer}`);
      assert.deepEqual(backward.sharedIds.slice().sort(), shared, `${peer} to ${id}`);
    }
  }
});

test('the owner-approved event packets preserve both ordered vectors and the open MODOK gap', async () => {
  const { contractDigest, ...unsigned } = contract;
  assert.equal(contractDigest, digestCanonicalJson(unsigned));
  assert.equal(contractDigest, 'c1ab8f772fb32552caaeb92621a8f1218f4045f2246de503ef720d818b02ee67');
  assert.deepEqual(ids, ['realm-of-kings', 'fall-of-the-hulks']);
  assert.equal(contract.reviewer, '@raymond-nassar');
  assert.equal(contract.reviewedBaseCommit, '0525d8aacd8354af8977103c3e93d3597b72f22d');
  for (const guide of contract.guides) {
    const { packet, mapping } = await guideEvidence(guide.id);
    validateFrozenPacket(packet);
    validateMappingDigest(mapping);
    assert.equal(packet.sourceReview.authorityType, 'human');
    assert.equal(packet.sourceReview.authorityIdentity, contract.reviewer);
    assert.equal(packet.packetDigest, guide.packetDigest);
    assert.equal(mapping.mappingDigest, guide.mappingDigest);
    assert.deepEqual(packet.insertionAnchor, { beforeId: 'siege-dark-reign-prelude' });
    const positions = Array(guide.id === 'fall-of-the-hulks' ? 29 : 28).fill(null);
    for (const [index, row] of mapping.rows.entries()) {
      assert.equal(row.resolutionStatus, 'exact');
      positions[(row.sourcePosition ?? index + 1) - 1] = Number(row.selectedIssueId);
    }
    assert.equal(digestVector(positions), guide.sourceVectorSha256);
  }
  const realm = await guideEvidence('realm-of-kings');
  assert.equal(realm.packet.sourceExpansion.kind, 'trade-anthology-index');
  assert.match(realm.packet.sourceBoundary, /not been verified against the physical book/);
  assert.equal(realm.mapping.rows.length, 28);
  const fall = await guideEvidence('fall-of-the-hulks');
  assert.equal(fall.mapping.rows.length, 28);
  assert.equal(fall.mapping.sourceOccurrenceCount, 29);
  assert.deepEqual(fall.mapping.sourceGaps.map((gap) => gap.sourcePosition), [3]);
  const gap = fall.mapping.sourceGaps[0];
  assert.equal(gap.evidenceDigest, gapEvidenceDigestFor(gap));
  assert.equal(gap.kind, 'published-metadata-gap');
  assert.equal(gap.status, 'open');
  assert.ok(gap.evidenceSources.some((source) => source.url === 'https://github.com/raymond-nassar/recap-page/issues/1155'));
  assert.deepEqual(fall.mapping.rows.filter((row) => row.manualSeriesSelectionApproved)
    .map((row) => row.sourcePosition), [22, 23, 24, 25]);
});

test('the signed comparisons cover the complete reviewed library and both mapped peers', async () => {
  const library = await loadCurrentOwnerLibrary(ids[0]);
  const reviewedIds = new Set(contract.orderIds);
  assert.equal(reviewedIds.size, 341);
  // The review predates the X-Men era replacement, so the retired pair takes its slot back. The
  // other inverses are exact: each refuses anything but its own recorded change, so the signed
  // library comes back only when the suffixes are precisely the reviewed additions.
  const orders = beforeWolverineCorrectionOrders(beforeTieInOrders(
    beforeXmenEraOrders(library.orders)
      .sort((left, right) => left.orderId.localeCompare(right.orderId)).filter((order) => reviewedIds.has(order.orderId)),
  ));
  assert.deepEqual(orders.map((order) => order.orderId), contract.orderIds);
  const manifest = beforeWolverineCorrectionManifest(beforeTieInManifest({
    ...beforeFirstInstallmentManifest(library.manifest),
    lists: beforeXmenEraManifest(library.manifest).lists.filter((entry) => reviewedIds.has(entry.id)),
    paths: library.manifest.paths.filter((entry) => reviewedPathIds.has(entry.id)),
  }));
  assert.equal(libraryDigestFor(manifest, orders.map((order) => ({
    id: order.orderId, issueIds: order.issueIds.map(String),
  }))), contract.libraryDigest);
  const manifestLibrary = await loadBeforeWolverineCorrectionLibrary();
  const laterOrderIds = manifestLibrary.orders
    .filter((order) => !reviewedIds.has(order.orderId) && !ids.includes(order.orderId))
    .map((order) => order.orderId);
  for (const guide of contract.guides) {
    const { packet, mapping, report } = await guideEvidence(guide.id);
    const peer = (await guideEvidence(guide.peerId)).mapping;
    assert.equal(peer.mappingDigest, guide.peerMappingDigest);
    const complete = buildComparisonReport({
      candidateIds: mapping.rows.map((row) => row.selectedIssueId),
      orders,
      peerOrders: [{ orderId: peer.id, issueIds: peer.rows.map((row) => row.selectedIssueId) }],
    });
    assert.equal(complete.comparisonCount, 342);
    assert.equal(digestCanonicalJson(complete), guide.completeReportDigest);
    const liveReport = await buildReportForMapping(
      `scripts/data/cbh-mappings/${guide.id}.json`,
      [`scripts/data/cbh-mappings/${peer.id}.json`],
      {
        excludedOrderIds: laterOrderIds,
        manifest: manifestLibrary.manifest,
        payloadDir: manifestLibrary.payloadDir,
      },
    );
    assert.deepEqual(liveReport, report);
    assert.equal(report.reportDigest, guide.manifestReportDigest);
    assert.equal(mapping.relationshipReview.approvalDigest, guide.manifestApprovalDigest);
    assertApprovedRelationshipReview({
      packet, mapping, report, peerMappings: [peer],
      currentLibraryDigest: report.libraryDigest,
      expectedOrderIds: [
        ...manifestLibrary.orders
          .filter((order) => !ids.includes(order.orderId) && !laterOrderIds.includes(order.orderId))
          .map((order) => order.orderId),
        peer.id,
      ],
    });
    const approved = new Map(mapping.relationshipReview.dispositions.map((entry) => [entry.orderId, entry]));
    const meaningful = complete.comparisons.filter((entry) => entry.relationship !== 'none');
    assert.equal(meaningful.length, guide.id === 'realm-of-kings' ? 9 : 2);
    for (const comparison of meaningful) {
      const disposition = approved.get(comparison.orderId);
      assert.equal(comparison.relationship, 'partial');
      assert.equal(disposition.authorityType, 'human');
      assert.equal(disposition.authorityIdentity, contract.reviewer);
      assert.equal(disposition.decision, 'approved');
      assert.equal(disposition.sharedCount, comparison.sharedCount);
      assert.deepEqual(disposition.sharedIds, comparison.sharedIds);
    }
  }
});

test('both event checklists, payloads and timeline cards preserve the approved source order', async () => {
  const [manifest, rawCatalog] = await Promise.all([
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
  ]);
  const catalog = parseCatalog(rawCatalog);
  assert.equal(catalog.dropped, 0);
  const selected = modernTimelineLists(catalog.lists);
  const positions = ids.map((id) => selected.findIndex((entry) => entry.id === id));
  assert.ok(positions[0] >= 0);
  assert.equal(positions[1], positions[0] + 1);
  assert.equal(selected[positions[1] + 1].id, 'siege-dark-reign-prelude');
  for (const id of ids) {
    const { packet, mapping } = await guideEvidence(id);
    const entry = manifest.lists.find((item) => item.id === id);
    const card = selected.find((item) => item.id === id);
    assert.ok(entry && card);
    assert.equal(entry.timeline, 2009);
    assert.equal(card.count, 28);
    const markdown = await readFile(new URL(`../src/data/orders/${entry.sourceFile}`, import.meta.url), 'utf8');
    const parsed = parseChecklist(markdown);
    const payload = await readJson(`src/data/${entry.out}`);
    const expected = mapping.rows.map((row) => Number(row.selectedIssueId));
    assert.equal(markdown.replace(/\r\n?/g, '\n'), buildMarkdown(mapping));
    assert.deepEqual(parsed.entries.map((row) => Number(row.issueId)), expected);
    assert.deepEqual(payload.items.map((row) => row.issueId), expected);
    assert.equal(parsed.unresolved.length, 0);
    assert.equal(payload.placeholders, 0);
    assert.equal(payload.count, 28);
    assert.equal(entry.sourcePage, packet.sourceUrl);
    assert.equal(card.description, entry.description);
    assert.equal(payload.description, entry.description);
    assert.equal(descriptionRevisions.undoEntry(entry).description, packet.proposedManifest.description);
    if (id === 'realm-of-kings') {
      assert.match(markdown, /numbered \[League of Comic Geeks Realm of Kings hardcover\]/);
      assert.match(markdown, /not verified as the physical order/);
    } else {
      assert.match(entry.description, /MODOK one-shot is not included/);
      assert.match(firstSentence(card.description), /MODOK one-shot is not included/);
      assert.ok(!payload.items.some((row) => /Fall of the Hulks: MODOK/i.test(row.title)));
    }
  }
});
