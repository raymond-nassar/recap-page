import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { issueIdsFromValue } from '../../scripts/lib/cbh-overlap.mjs';

const ledger = JSON.parse(readFileSync(
  new URL('../../scripts/data/curated-source-ledgers/xmen-claremont-first-class.json', import.meta.url), 'utf8',
));
const root = new URL('../..', import.meta.url);
const show = (file) => execFileSync('git', ['show', `${ledger.baselineCommit}:${file}`], {
  cwd: root, encoding: 'utf8', maxBuffer: 64 << 20,
});
const digest = (text) => createHash('sha256').update(text).digest('hex');
export const xmenFirstClassDelta = ledger.added.length - ledger.removed.length;
let captured;
function history() {
  if (captured) return captured;
  const originalText = show('src/data/xmen_claremont.json');
  const expandedText = show('src/data/xmen_claremont_complete.json');
  assert.equal(digest(originalText), ledger.baselinePayloadSha256);
  assert.equal(digest(expandedText), ledger.expandedPayloadSha256);
  const original = JSON.parse(originalText);
  const expanded = JSON.parse(expandedText);
  const firstClass = ledger.added.map(({ issueId }) => {
    const found = expanded.items.filter((item) => item.issueId === issueId);
    assert.equal(found.length, 1);
    return found[0];
  });
  assert.equal(ledger.removed.length, 72);
  assert.equal(firstClass.length, 28);
  assert.deepEqual(ledger.removed.map(({ issueId }) => issueId),
    original.items.slice(0, 72).map(({ issueId }) => issueId));
  assert.deepEqual(ledger.added.map(({ issueId, seriesId, number }) => ({ issueId, seriesId, number })),
    firstClass.map(({ issueId, seriesId, number }) => ({ issueId, seriesId, number })));
  const updated = {
    ...original,
    description: ledger.descriptions.core.after,
    count: 274,
    unresolved: original.unresolved.map((entry) => ({ ...entry, index: entry.index + xmenFirstClassDelta })),
    items: [...firstClass, ...original.items.slice(72)],
  };
  captured = { originalText, expandedText, original, expanded, firstClass, updated,
    oldIds: issueIdsFromValue(original), newIds: issueIdsFromValue(updated) };
  return captured;
}

export function beforeXmenFirstClassIssueIds(ids) {
  const { oldIds, newIds } = history();
  const actual = ids.map(String);
  assert.ok([oldIds, newIds].some((value) => JSON.stringify(actual) === JSON.stringify(value)),
    'X-Men history accepts only the captured prior vector or the approved replacement.');
  return [...oldIds];
}

export function beforeXmenFirstClassEntry(entry) {
  const isCore = entry.id === ledger.id;
  const isExpanded = entry.id === 'xmen-claremont-complete';
  if (!isCore && !isExpanded) return entry;
  const revision = isCore ? ledger.descriptions.core : ledger.descriptions.expanded;
  if (entry.description !== revision.after) return entry;
  if (!isCore) return { ...entry, description: revision.before };
  assert.equal(entry.expect, 274);
  assert.equal(entry.coverIssueId, 5144);
  assert.equal(entry.variant, 'First Class origins, then Claremont');
  return { ...entry, description: revision.before, expect: 318, coverIssueId: 12413,
    variant: 'The spine, without the optional reading' };
}

export function beforeXmenFirstClassOrders(orders) {
  return orders.map((order) => (order.id ?? order.orderId) === ledger.id
    ? { ...order, issueIds: beforeXmenFirstClassIssueIds(order.issueIds) } : order);
}

export function beforeXmenFirstClassPayloadText(file, text) {
  const name = path.basename(file);
  if (name === 'xmen_claremont.json') {
    const { original, updated, originalText } = history();
    const value = JSON.parse(text);
    assert.ok([original, updated].some((candidate) => JSON.stringify(candidate) === JSON.stringify(value)),
      'X-Men payload must be the exact original or approved replacement.');
    return originalText;
  }
  if (name === 'xmen_claremont_complete.json') {
    const { expanded, expandedText } = history();
    const value = JSON.parse(text);
    assert.ok([expanded, { ...expanded, description: ledger.descriptions.expanded.after }]
      .some((candidate) => JSON.stringify(candidate) === JSON.stringify(value)),
    'Expanded X-Men payload may change only its approved description.');
    return expandedText;
  }
  return text;
}

export function beforeXmenFirstClassCatalogEntry(entry) {
  if (entry.id === 'xmen-claremont-complete' && entry.description === ledger.descriptions.expanded.after) {
    return { ...entry, description: ledger.descriptions.expanded.before };
  }
  if (entry.id !== ledger.id || entry.description !== ledger.descriptions.core.after) return entry;
  const { firstClass, original } = history();
  assert.equal(entry.count, 274);
  assert.equal(entry.coverIssueId, 5144);
  assert.equal(entry.variant, 'First Class origins, then Claremont');
  assert.deepEqual(entry.cover, firstClass[0].cover);
  return { ...entry, description: ledger.descriptions.core.before, count: 318,
    coverIssueId: 12413, cover: original.items[0].cover,
    variant: 'The spine, without the optional reading' };
}
