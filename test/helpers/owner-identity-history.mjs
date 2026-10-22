import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const identityRevisions = JSON.parse(readFileSync(
  new URL('../../scripts/data/owner-identity-revisions.json', import.meta.url), 'utf8',
));
const root = fileURLToPath(new URL('../..', import.meta.url));
const cache = new Map();
export function beforeIdentityText(file) {
  if (!cache.has(file)) cache.set(file, execFileSync('git', [
    'show', `${identityRevisions.baselineCommit}:${file}`,
  ], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  return cache.get(file);
}
export const beforeIdentityJson = (file) => JSON.parse(beforeIdentityText(file));

export function beforeIdentityEntry(entry, cutoff = '') {
  if (!identityRevisions.guides.some(({ id, generatedAt }) => id === entry.id && generatedAt > cutoff)) return entry;
  const file = entry.out ?? entry.file;
  const old = beforeIdentityJson('src/data/curated-lists.json').lists.find(({ id }) => id === entry.id);
  assert.equal(file, old.out);
  return { ...entry, description: old.description, ...(Object.hasOwn(entry, 'expect') ? { expect: old.expect } : {}) };
}

export function beforeIdentityPayload(file, payload) {
  const revision = identityRevisions.guides.find(({ id }) => id === payload.id);
  if (!revision) return payload;
  const original = beforeIdentityJson(`src/data/${file}`);
  const originalIds = new Set(original.items.map(({ issueId }) => issueId));
  assert.deepEqual(payload.items.filter(({ issueId }) => originalIds.has(issueId)), original.items,
    'Identity publication must preserve every previous item record.');
  const added = payload.items.filter(({ issueId }) => !originalIds.has(issueId));
  assert.deepEqual(added.map(({ issueId }) => issueId), revision.issueIds);
  assert.ok(added.every(({ identityEvidenceKind }) => identityEvidenceKind === 'owner-confirmed-identity'));
  return original;
}

export function beforeIdentityOrders(orders, cutoff = '') {
  return orders.map((entry) => {
    const revision = identityRevisions.guides.find(({ id, generatedAt }) =>
      id === (entry.id ?? entry.orderId) && generatedAt > cutoff);
    return !revision ? entry : {
      ...entry, issueIds: entry.issueIds.filter((id) => !revision.issueIds.includes(Number(id))),
    };
  });
}
