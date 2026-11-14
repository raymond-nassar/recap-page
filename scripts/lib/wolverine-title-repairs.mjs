import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { placeholderId } from './placeholder-id.mjs';

export const wolverineTitleRepairs = JSON.parse(readFileSync(
  new URL('../data/wolverine-title-repairs.json', import.meta.url), 'utf8',
));

export function repairWolverineTitles(payload, { undo = false } = {}) {
  const { orderId, entries } = wolverineTitleRepairs;
  if (payload.id !== orderId) return payload;
  const items = [...payload.items];
  const unresolved = [...payload.unresolved];
  for (const { position, issueId, legacyTitle, title } of entries) {
    assert.equal(placeholderId(orderId, legacyTitle), issueId, 'Legacy title identity changed.');
    const index = undo ? items.findIndex((item) => item.issueId === issueId) : position - 1;
    const item = items[index];
    assert.equal(item?.issueId, issueId, 'Title repair position or identity changed.');
    assert.equal(item.placeholder, true, 'Title repair must remain a placeholder.');
    assert.ok([legacyTitle, title].includes(item.title), 'Unexpected title for a registered repair.');
    const gaps = unresolved.map((gap, at) => ({ gap, at }))
      .filter(({ gap }) => [legacyTitle, title].includes(gap.title));
    assert.equal(gaps.length, 1, 'Title repair must name one unresolved label.');
    const display = undo ? legacyTitle : title;
    items[index] = { ...item, title: display };
    unresolved[gaps[0].at] = { ...gaps[0].gap, title: display };
  }
  return { ...payload, items, unresolved };
}
