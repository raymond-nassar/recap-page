import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const read = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
export const thorCorrection = read('scripts/data/thor-celestial-correction.json');
const captain = read('scripts/data/captain-marvel-description-correction.json');
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const show = (file, commit = thorCorrection.priorCommit) => execFileSync('git', [
  'show', `${commit}:${file}`,
], { cwd: root, encoding: 'utf8', maxBuffer: 32 << 20 }).replace(/\r\n/g, '\n');
let original;
function baseline() {
  if (!original) {
    const text = show('src/data/thor_best_of.json');
    const payload = JSON.parse(text);
    assert.equal(digest(payload), thorCorrection.priorPayloadSha256);
    assert.equal(digest(payload.items), thorCorrection.priorItemsSha256);
    original = { text, payload, catalog: JSON.parse(show('src/data/catalog.json')).lists
      .find(({ id }) => id === thorCorrection.id) };
  }
  return original;
}
export const thorCorrectionItemDelta = thorCorrection.replacements.length - thorCorrection.removed.length;

export function beforeThorCorrectionIssueIds(ids) {
  const before = baseline().payload.items.map(({ issueId }) => String(issueId));
  const after = [...before];
  after.splice(thorCorrection.removed[0].sourcePosition - 1, thorCorrection.removed.length,
    ...thorCorrection.replacements.map(({ issueId }) => String(issueId)));
  assert.ok([before, after].some((vector) => JSON.stringify(vector) === JSON.stringify(ids.map(String))),
    'Thor history accepts only the captured prior vector or the exact source correction.');
  return before;
}

export function beforeReadingListCorrectionEntry(entry) {
  if (entry.id !== thorCorrection.id) return entry;
  assert.ok([131, 144].includes(entry.expect), 'Unrecorded Thor expected count.');
  return { ...entry, expect: 131 };
}

export function beforeReadingListCorrectionOrders(orders) {
  return orders.map((order) => (order.id ?? order.orderId) === thorCorrection.id
    ? { ...order, issueIds: beforeThorCorrectionIssueIds(order.issueIds) } : order);
}

export function beforeReadingListCorrectionCatalogEntry(entry) {
  if (entry.id !== thorCorrection.id) return entry;
  assert.ok([131, 144].includes(entry.count), 'Unrecorded Thor catalog count.');
  return { ...entry, count: 131, updatedAt: baseline().catalog.updatedAt };
}

export function beforeReadingListCorrectionPayloadText(file, text) {
  if (path.basename(file) === 'thor_best_of.json') {
    const payload = JSON.parse(text);
    assert.ok([thorCorrection.priorPayloadSha256, thorCorrection.correctedPayloadSha256].includes(digest(payload)),
      'Thor payload differs from both exact captured publications.');
    return baseline().text;
  }
  if (path.basename(file) === captain.file) {
    const payload = JSON.parse(text);
    assert.ok([captain.priorPayloadSha256, captain.correctedPayloadSha256].includes(digest(payload)),
      'Captain Marvel correction must change only the captured description.');
    return show(`src/data/${captain.file}`, captain.priorCommit);
  }
  return text;
}
