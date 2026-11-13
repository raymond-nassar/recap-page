import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sourcePositionsForPacket } from '../../scripts/lib/cbh-inventory.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const ledger = read('scripts/data/cbh-source-ledgers/wolverine-reading-order-series-correction.json');
const prior = ledger.priorPublication;
const show = (file) => execFileSync('git', ['show', `${prior.commit}:${file}`], {
  cwd: root, encoding: 'utf8', maxBuffer: 64 << 20,
});
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

export function beforeWolverineCorrectionEntry(entry) {
  if (entry.id !== ledger.id) return entry;
  assert.ok([originalIds.length, currentIds.length].includes(entry.expect));
  return { ...entry, expect: originalIds.length };
}

export function beforeWolverineCorrectionManifest(manifest) {
  return { ...manifest, lists: manifest.lists.map(beforeWolverineCorrectionEntry) };
}

export function beforeWolverineCorrectionIssueIds(ids) {
  const actual = ids.map(String);
  assert.ok(JSON.stringify(actual) === JSON.stringify(originalIds)
    || JSON.stringify(actual) === JSON.stringify(currentIds),
  'Wolverine history accepts only the captured prior vector or the exact reviewed correction.');
  return [...originalIds];
}

export function beforeWolverineCorrectionOrders(orders) {
  return orders.map((order) => (order.id ?? order.orderId) === ledger.id
    ? { ...order, issueIds: beforeWolverineCorrectionIssueIds(order.issueIds) } : order);
}

export function beforeWolverineCorrectionPayloadText(file, text) {
  if (path.basename(file) !== path.basename(prior.files.payload)) return text;
  beforeWolverineCorrectionIssueIds(JSON.parse(text).items.map(({ issueId }) => issueId));
  return originalText;
}

export function beforeWolverineCorrectionCatalogEntry(entry) {
  if (entry.id !== ledger.id) return entry;
  const catalog = JSON.parse(show('src/data/catalog.json'));
  const baseline = catalog.lists.find(({ id }) => id === ledger.id);
  assert.ok([originalIds.length, currentIds.length].includes(entry.count));
  return { ...entry, count: baseline.count, contains: baseline.contains, updatedAt: baseline.updatedAt };
}
