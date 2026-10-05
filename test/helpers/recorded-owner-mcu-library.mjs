import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';
import { historicalReadingChoiceIssueIds } from './reading-choice-history.mjs';

export async function recordedOwnerMcuLibrary({ orders, extension, candidateId, originalReport }) {
  const added = extension.extensions.find((entry) => entry.candidateId === candidateId);
  assert.ok(added, `${candidateId}: recorded extension is missing`);
  const recordedIds = [
    candidateId,
    ...originalReport.comparisons.map((entry) => entry.orderId),
    ...added.laterComparisons.map((entry) => entry.orderId),
  ];
  assert.equal(new Set(recordedIds).size, recordedIds.length);
  assert.equal(recordedIds.length, extension.libraryOrderCount);
  const available = new Map(orders.map((order) => [order.id ?? order.orderId, order]));
  assert.equal(available.size, orders.length);
  const packet = JSON.parse(await readFile(new URL(
    '../../scripts/data/owner-mcu-prep/spider-man-no-way-home-owner-selected.packet.json',
    import.meta.url,
  ), 'utf8'));
  const archived = packet.proposedManifest;
  assert.equal(archived.id, 'spider-man-no-way-home-owner-selected');
  assert.ok(recordedIds.includes(archived.id), 'The frozen cohort must retain its retired peer');
  if (!available.has(archived.id)) {
    const payload = JSON.parse(await readFile(new URL(`../../src/data/${archived.out}`, import.meta.url), 'utf8'));
    assert.equal(payload.id, archived.id);
    available.set(archived.id, {
      id: archived.id,
      issueIds: payload.items.map((item) => String(item.issueId)),
    });
  }
  return recordedIds.map((id) => {
    const order = available.get(id);
    assert.ok(order, `Recorded peer ${id} is missing`);
    return { ...order, issueIds: historicalReadingChoiceIssueIds(id, order.issueIds) };
  });
}
