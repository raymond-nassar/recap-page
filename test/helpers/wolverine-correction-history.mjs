import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  digestCanonicalJson, libraryDigestFor, packetDigestFor, sourcePositionsForPacket,
} from '../../scripts/lib/cbh-inventory.mjs';
import { descriptionRevisions } from '../../scripts/lib/description-revisions.mjs';
import { identityCorrections } from '../../src/data/identityCorrections.js';
import {
  beforeUltimateSelectionEntry, beforeUltimateSelectionOrders,
  beforeUltimateSelectionPayloadText, beforeUltimateSelectionCatalogEntry,
} from './ultimate-spider-man-selection-history.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const ledger = read('scripts/data/cbh-source-ledgers/wolverine-reading-order-series-correction.json');
const prior = ledger.priorPublication;
const successorDir = 'scripts/data/cbh-source-ledgers/wolverine-reading-order-identity-correction-v1';
export const wolverineSuccessorLedger = read(`${successorDir}/correction-ledger.json`);
const { planDigest, ...plan } = read(`${successorDir}/gap-delta-plan.json`);
assert.equal(digestCanonicalJson(plan), planDigest);
assert.equal(planDigest, wolverineSuccessorLedger.planDigest);
export const wolverineGapResolutions = plan.replacements;
export const xgoldCorrections = identityCorrections.filter((row) => row.catalogId === 'wolverine-reading-order'
  && row.evidence?.payloadIndex !== undefined);
export const wolverineSeriesCorrectionReviewCommit = '81103a52e66eed50ce5b7d52ca8f1b2121d1489f';
const show = (file, commit = prior.commit) => execFileSync('git', ['show', `${commit}:${file}`], {
  cwd: root, encoding: 'utf8', maxBuffer: 64 << 20,
});

// The commit that published the eighteen-slot successor, before X-Men Gold #7 and #8 joined it.
export const wolverineSuccessorPublicationCommit = '89360fc3e806b4071107ca1bd8e1bf9130cb7ac0';
export function readPublishedWolverineSuccessor(file) {
  return show(file, wolverineSuccessorPublicationCommit);
}

export function readPreSuccessorWolverinePublication(file) {
  return show(file, wolverineSuccessorLedger.priorPublication.commit);
}

export function firstReleasedWolverineIssueOrders() {
  const unique = new Map();
  for (const tag of ['v2.0.0', 'v2.0.1']) {
    const payload = JSON.parse(execFileSync('git', ['show', `${tag}:src/data/wolverine_reading_order.json`], {
      cwd: root, encoding: 'utf8', maxBuffer: 64 << 20,
    }));
    const ids = payload.items.map(({ issueId }) => issueId);
    unique.set(JSON.stringify(ids), ids);
  }
  return [...unique.values()];
}
export const wolverineCorrectionItemDelta = ledger.correctionReview.corrections
  .filter(({ before, after }) => before.representation !== 'row' && after.representation === 'row').length;

let history;
function correctionHistory() {
  if (history) return history;
  const originalText = show(prior.files.payload).replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(originalText).digest('hex'), prior.payloadSha256);
  const original = JSON.parse(originalText);
  const originalIds = original.items.map(({ issueId }) => String(issueId));
  const packet = JSON.parse(show(prior.files.packet, wolverineSeriesCorrectionReviewCommit));
  assert.equal(packetDigestFor(packet), ledger.correctionReview.packetDigest);
  const positions = sourcePositionsForPacket(packet);
  const rows = packet.rows.map((row, index) => ({
    position: positions[index], id: String(row.candidateIssueId),
  }));
  const placeholders = original.items.filter((item) => item.placeholder);
  const gaps = [...packet.sourceGaps].sort((a, b) => a.sourcePosition - b.sourcePosition);
  assert.equal(gaps.length, placeholders.length);
  const currentIds = [...rows, ...gaps.map((gap, index) => ({
    position: gap.sourcePosition, id: String(placeholders[index].issueId),
  }))].sort((a, b) => a.position - b.position).map(({ id }) => id);
  assert.equal(currentIds.length, ledger.correctionReview.sourceCounts.sourceIdentityCount);
  assert.equal(currentIds.length - originalIds.length, wolverineCorrectionItemDelta);
  assert.equal(digestCanonicalJson(currentIds.map(Number)), wolverineSuccessorLedger.priorPublication.vectorDigest);
  const successorIds = currentIds.slice();
  for (const { index, previousIssueId, issueId } of wolverineGapResolutions) {
    assert.equal(successorIds[index], String(previousIssueId));
    successorIds[index] = String(issueId);
  }
  assert.equal(digestCanonicalJson(successorIds.map(Number)), wolverineSuccessorLedger.correctedCandidate.vectorDigest);
  // Candidate B: only the two X-Men Gold placeholders may join their tagged viewer keys.
  const xgoldIds = successorIds.slice();
  for (const { from, to, evidence } of xgoldCorrections) {
    assert.equal(xgoldIds[evidence.payloadIndex], String(from));
    xgoldIds[evidence.payloadIndex] = String(to);
  }
  history = { originalText, originalIds, currentIds, successorIds, xgoldIds };
  return history;
}

// The order published at 89360fc3, with the eighteen corrections and both X-Men Gold placeholders.
export function publishedBeforeXgoldIssueIds() {
  return correctionHistory().successorIds.map(Number);
}

export function beforeWolverineCorrectionEntry(entry) {
  entry = beforeUltimateSelectionEntry(entry);
  if (entry.id !== ledger.id) return entry;
  const { originalIds, currentIds } = correctionHistory();
  assert.ok([originalIds.length, currentIds.length].includes(entry.expect));
  return { ...entry, expect: originalIds.length };
}

export function beforeWolverineCorrectionManifest(manifest) {
  return { ...manifest, lists: manifest.lists.map(beforeWolverineCorrectionEntry) };
}

export function beforeWolverineCorrectionIssueIds(ids) {
  const { originalIds, currentIds, successorIds, xgoldIds } = correctionHistory();
  const actual = JSON.stringify(ids.map(String));
  assert.ok([originalIds, currentIds, successorIds, xgoldIds].some((order) => JSON.stringify(order) === actual),
    'Wolverine history accepts only the captured prior vector or the exact reviewed correction.');
  return [...originalIds];
}

export function beforeWolverineCorrectionOrders(orders) {
  orders = beforeUltimateSelectionOrders(orders);
  return orders.map((order) => (order.id ?? order.orderId) === ledger.id
    ? { ...order, issueIds: beforeWolverineCorrectionIssueIds(order.issueIds) } : order);
}

export function wolverineLibraryAtReview(manifest, orders, expectedDigest) {
  const matches = (projected) => {
    const vectors = projected.map((order) => ({
      id: order.id ?? order.orderId, issueIds: order.issueIds.map(String),
    }));
    return [manifest, descriptionRevisions.undoManifest(manifest)]
      .some((value) => libraryDigestFor(value, vectors) === expectedDigest);
  };
  const current = (value) => value;
  if (matches(orders)) return { manifest, orders, projectOrders: current };
  // Reviews recorded before the X-Men Gold correction saw both comics as placeholders. Only the
  // exact corrected vector maps back, and only a recorded digest can then select it.
  const beforeXgold = (value) => value.map((order) => {
    if ((order.id ?? order.orderId) !== ledger.id) return order;
    const { successorIds, xgoldIds } = correctionHistory();
    if (JSON.stringify(order.issueIds.map(String)) !== JSON.stringify(xgoldIds)) return order;
    return { ...order, issueIds: successorIds.map((id) =>
      typeof order.issueIds[0] === 'string' ? id : Number(id)) };
  });
  const published = beforeXgold(orders);
  if (matches(published)) return { manifest, orders: published, projectOrders: beforeXgold };

  // Armageddon saw the corrected series order but still saw the eighteen unresolved comics
  // as placeholders. Only the exact reviewed digest may select that intermediate vector.
  const beforeSuccessor = (value) => value.map((order) => {
    if ((order.id ?? order.orderId) !== ledger.id) return order;
    const { currentIds, successorIds } = correctionHistory();
    const actual = JSON.stringify(order.issueIds.map(String));
    if (actual !== JSON.stringify(successorIds)) return order;
    return { ...order, issueIds: currentIds.map((id) =>
      typeof order.issueIds[0] === 'string' ? id : Number(id)) };
  });
  const intermediate = beforeSuccessor(published);
  if (matches(intermediate)) return { manifest, orders: intermediate,
    projectOrders: (value) => beforeSuccessor(beforeXgold(value)) };
  return {
    manifest: beforeWolverineCorrectionManifest(manifest),
    orders: beforeWolverineCorrectionOrders(orders),
    projectOrders: beforeWolverineCorrectionOrders,
  };
}

export function beforeWolverineCorrectionPayloadText(file, text) {
  text = beforeUltimateSelectionPayloadText(file, text);
  if (path.basename(file) !== path.basename(prior.files.payload)) return text;
  beforeWolverineCorrectionIssueIds(JSON.parse(text).items.map(({ issueId }) => issueId));
  return correctionHistory().originalText;
}

export function beforeWolverineCorrectionCatalogEntry(entry) {
  entry = beforeUltimateSelectionCatalogEntry(entry);
  if (entry.id !== ledger.id) return entry;
  const { originalIds, currentIds } = correctionHistory();
  const catalog = JSON.parse(show('src/data/catalog.json'));
  const baseline = catalog.lists.find(({ id }) => id === ledger.id);
  assert.ok([originalIds.length, currentIds.length].includes(entry.count));
  // The identity successor turns its resolved placeholders into rows without moving the count, so
  // the earlier reviews' digests still need the placeholder total from before it.
  const resolved = wolverineGapResolutions.length;
  assert.ok([baseline.placeholderCount, baseline.placeholderCount - resolved,
    baseline.placeholderCount - resolved - xgoldCorrections.length].includes(entry.placeholderCount));
  return {
    ...entry, count: baseline.count, contains: baseline.contains, updatedAt: baseline.updatedAt,
    placeholderCount: baseline.placeholderCount, emptyRecordCount: baseline.emptyRecordCount,
  };
}

export function beforeWolverineCorrectionChapterOverlaps(report) {
  const { currentIds } = correctionHistory();
  const baseline = JSON.parse(show('scripts/data/marvel-knights-to-planet-x-overlaps.json'));
  const knownIds = new Set(currentIds);
  const catalog = read('src/data/catalog.json');
  const pairs = baseline.pairs.filter(({ existingListId }) => existingListId !== ledger.id);
  for (const chapter of catalog.lists.filter(({ id }) => id.startsWith(`${baseline.parentId}-`))) {
    const sharedIssueIds = read(`src/data/${chapter.file}`).items
      .map(({ issueId }) => issueId).filter((id) => knownIds.has(String(id)));
    if (sharedIssueIds.length) pairs.push({
      chapterId: chapter.id, existingListId: ledger.id,
      sharedCount: sharedIssueIds.length, sharedIssueIds,
    });
  }
  pairs.sort((a, b) => a.chapterId.localeCompare(b.chapterId)
    || a.existingListId.localeCompare(b.existingListId));
  // Lists published after the correction bring their own reviewed overlaps; setting them aside
  // keeps this comparison to the Wolverine identities alone.
  const baselineListIds = new Set(JSON.parse(show('src/data/catalog.json')).lists.map(({ id }) => id));
  const priorReport = chapterOverlapSummary(report, report.generatedAt,
    report.pairs.filter(({ existingListId }) => baselineListIds.has(existingListId)));
  assert.deepEqual(priorReport, chapterOverlapSummary(baseline, report.generatedAt, pairs),
    'Only the reviewed Wolverine identities may change chapter overlaps.');
  return baseline;
}

function chapterOverlapSummary(baseline, generatedAt, pairs) {
  const existingLists = [...new Set(pairs.map(({ existingListId }) => existingListId))]
    .sort().map((id) => ({
    id, sharedCount: pairs.filter(({ existingListId }) => existingListId === id)
      .reduce((sum, { sharedCount }) => sum + sharedCount, 0),
  }));
  return {
    ...baseline,
    generatedAt,
    pairCount: pairs.length,
    chapterCountWithOverlap: new Set(pairs.map(({ chapterId }) => chapterId)).size,
    existingListCount: existingLists.length,
    sharedOccurrenceCount: pairs.reduce((sum, { sharedCount }) => sum + sharedCount, 0),
    matrixSha256: createHash('sha256').update(JSON.stringify(pairs.map((pair) => [
      pair.chapterId, pair.existingListId, pair.sharedCount, pair.sharedIssueIds,
    ]))).digest('hex'),
    existingLists,
    pairs,
  };
}
