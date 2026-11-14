import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { libraryDigestFor, sourcePositionsForPacket } from '../../scripts/lib/cbh-inventory.mjs';
import { descriptionRevisions } from '../../scripts/lib/description-revisions.mjs';
import {
  beforeUltimateSelectionEntry, beforeUltimateSelectionOrders,
  beforeUltimateSelectionPayloadText, beforeUltimateSelectionCatalogEntry,
} from './ultimate-spider-man-selection-history.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const ledger = read('scripts/data/cbh-source-ledgers/wolverine-reading-order-series-correction.json');
const prior = ledger.priorPublication;
const show = (file) => execFileSync('git', ['show', `${prior.commit}:${file}`], {
  cwd: root, encoding: 'utf8', maxBuffer: 64 << 20,
});
export const wolverineCorrectionItemDelta = ledger.correctionReview.corrections
  .filter(({ before, after }) => before.representation !== 'row' && after.representation === 'row').length;

let history;
function correctionHistory() {
  if (history) return history;
  const originalText = show(prior.files.payload).replace(/\r\n/g, '\n');
  assert.equal(createHash('sha256').update(originalText).digest('hex'), prior.payloadSha256);
  const original = JSON.parse(originalText);
  const originalIds = original.items.map(({ issueId }) => String(issueId));
  const packet = read(prior.files.packet);
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
  history = { originalText, originalIds, currentIds };
  return history;
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
  const { originalIds, currentIds } = correctionHistory();
  const actual = ids.map(String);
  assert.ok(JSON.stringify(actual) === JSON.stringify(originalIds)
    || JSON.stringify(actual) === JSON.stringify(currentIds),
  'Wolverine history accepts only the captured prior vector or the exact reviewed correction.');
  return [...originalIds];
}

export function beforeWolverineCorrectionOrders(orders) {
  orders = beforeUltimateSelectionOrders(orders);
  return orders.map((order) => (order.id ?? order.orderId) === ledger.id
    ? { ...order, issueIds: beforeWolverineCorrectionIssueIds(order.issueIds) } : order);
}

export function wolverineLibraryAtReview(manifest, orders, expectedDigest) {
  const vectors = orders.map((order) => ({
    id: order.id ?? order.orderId, issueIds: order.issueIds.map(String),
  }));
  const current = [manifest, descriptionRevisions.undoManifest(manifest)]
    .some((value) => libraryDigestFor(value, vectors) === expectedDigest);
  return {
    manifest: current ? manifest : beforeWolverineCorrectionManifest(manifest),
    orders: current ? orders : beforeWolverineCorrectionOrders(orders),
    current,
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
  return { ...entry, count: baseline.count, contains: baseline.contains, updatedAt: baseline.updatedAt };
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
  const existingLists = [...new Set(pairs.map(({ existingListId }) => existingListId))]
    .sort().map((id) => ({
      id, sharedCount: pairs.filter(({ existingListId }) => existingListId === id)
        .reduce((sum, { sharedCount }) => sum + sharedCount, 0),
    }));
  const expected = {
    ...baseline,
    generatedAt: report.generatedAt,
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
  assert.deepEqual(report, expected, 'Only the reviewed Wolverine identities may change chapter overlaps.');
  return baseline;
}
