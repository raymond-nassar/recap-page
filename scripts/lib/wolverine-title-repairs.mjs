import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeLegacyIdentityKey } from '../../src/js/lib/markdown.js';
import { placeholderId } from './placeholder-id.mjs';

export const wolverineTitleRepairs = JSON.parse(readFileSync(
  new URL('../data/wolverine-title-repairs.json', import.meta.url), 'utf8',
));

const legacyLine = ({ legacyTitle }) => `- [ ] ${legacyTitle}`;
const repairedLine = ({ legacyTitle, title }) => (
  `- [ ] ${title} <!-- mrt:legacy-identity-key=${encodeLegacyIdentityKey(legacyTitle)} -->`
);

// A legacy identity key is honored only where this ledger registered it: same order, the repaired
// label it sits on, and the label the shipped identity was minted from. Anything else would let a
// checklist edit choose an identity, which is the thing the hash exists to stop.
export function registeredLegacyIdentityKey(orderId, title, key) {
  return orderId === wolverineTitleRepairs.orderId && wolverineTitleRepairs.entries
    .some((entry) => entry.title === title && entry.legacyTitle === key);
}

// Held beside the parsed rows rather than on them, so the published unresolved rows keep the shape
// they had before the annotation existed, and refused unless the ledger registered that exact pair.
const legacyIdentityKeys = new WeakMap();

export function legacyIdentityKeyFor(row) {
  return legacyIdentityKeys.get(row) ?? null;
}

export function legacyIdentityChecked(orderId, parsedOrder) {
  for (const entry of parsedOrder.entries) {
    if (entry.legacyIdentityKey != null) {
      throw new Error(`${orderId}: a legacy identity key may only sit on a placeholder line (${entry.title})`);
    }
  }
  const unresolved = parsedOrder.unresolved.map(({ legacyIdentityKey, ...row }) => {
    if (legacyIdentityKey == null) return row;
    if (row.sourceKey) {
      throw new Error(`${orderId}: a legacy identity key cannot be combined with a source occurrence (${row.title})`);
    }
    if (!registeredLegacyIdentityKey(orderId, row.title, legacyIdentityKey)) {
      throw new Error(`${orderId}: legacy identity key for "${row.title}" is not registered in the title repair ledger`);
    }
    legacyIdentityKeys.set(row, legacyIdentityKey);
    return row;
  });
  return { ...parsedOrder, unresolved };
}

// The checklist keeps the shipped identities by naming the double-encoded label each was hashed
// from, while showing the repaired one. Exact lines only, each exactly once, in either direction, so
// the approved generator's output and the shipped file stay provably one overlay apart.
export function repairWolverineChecklist(markdown, { undo = false } = {}) {
  const lines = markdown.split('\n');
  for (const entry of wolverineTitleRepairs.entries) {
    const [from, to] = undo ? [repairedLine(entry), legacyLine(entry)] : [legacyLine(entry), repairedLine(entry)];
    const at = lines.flatMap((line, index) => (line.replace(/\r$/, '') === from ? [index] : []));
    const done = lines.filter((line) => line.replace(/\r$/, '') === to).length;
    assert.ok(at.length + done === 1, 'Checklist title repair must name exactly one line.');
    if (at.length) lines[at[0]] = to + (lines[at[0]].endsWith('\r') ? '\r' : '');
  }
  return lines.join('\n');
}

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
