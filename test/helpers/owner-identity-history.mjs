import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const identityRevisions = JSON.parse(readFileSync(
  new URL('../../scripts/data/owner-identity-revisions.json', import.meta.url), 'utf8',
));
const root = fileURLToPath(new URL('../..', import.meta.url));
const cache = new Map();
export function beforeIdentityText(file, commit = identityRevisions.baselineCommit) {
  const key = `${commit}:${file}`;
  if (!cache.has(key)) cache.set(key, execFileSync('git', [
    'show', key,
  ], { cwd: root, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));
  return cache.get(key);
}
export const beforeIdentityJson = (file, commit) => JSON.parse(beforeIdentityText(file, commit));

export function beforeIdentityEntry(entry, cutoff = '') {
  if (!identityRevisions.guides.some(({ id, generatedAt }) => id === entry.id && generatedAt > cutoff)) return entry;
  const file = entry.out ?? entry.file;
  const old = beforeIdentityJson('src/data/curated-lists.json').lists.find(({ id }) => id === entry.id);
  assert.equal(file, old.out);
  return { ...entry, description: old.description, ...(Object.hasOwn(entry, 'expect') ? { expect: old.expect } : {}) };
}

export function beforeIdentityPayload(file, payload) {
  const revisions = identityRevisions.guides.filter(({ id }) => id === payload.id);
  if (!revisions.length) return payload;
  const original = beforeIdentityJson(`src/data/${file}`, revisions[0].baselineCommit);
  if (revisions[0].placeholderReplacement) {
    const confirmed = revisions.flatMap(({ issueIds }) => issueIds);
    const replaced = [];
    assert.equal(payload.items.length, original.items.length);
    const inverse = payload.items.map((item, index) => {
      if (!confirmed.includes(item.issueId)) return item;
      assert.equal(original.items[index].placeholder, true);
      assert.equal(item.identityEvidenceKind, 'owner-confirmed-identity');
      replaced.push(item.issueId);
      return original.items[index];
    });
    assert.deepEqual([...replaced].sort((a, b) => a - b), [...confirmed].sort((a, b) => a - b));
    assert.deepEqual(inverse, original.items, 'Only approved placeholder positions may differ.');
    return original;
  }
  const originalIds = new Set(original.items.map(({ issueId }) => issueId));
  assert.deepEqual(payload.items.filter(({ issueId }) => originalIds.has(issueId)), original.items,
    'Identity publication must preserve every previous item record.');
  const added = payload.items.filter(({ issueId }) => !originalIds.has(issueId));
  assert.deepEqual(added.map(({ issueId }) => issueId), revisions.flatMap(({ issueIds }) => issueIds));
  assert.ok(added.every(({ identityEvidenceKind }) => identityEvidenceKind === 'owner-confirmed-identity'));
  return original;
}

export function beforeIdentityChecklist(id, markdown) {
  const revisions = identityRevisions.guides.filter((entry) => entry.id === id && entry.placeholderReplacement);
  if (!revisions.length) return markdown;
  const original = beforeIdentityText(`src/data/orders/${id}.md`, revisions[0].baselineCommit)
    .replace(/\r\n/g, '\n');
  const originalLines = new Map(original.split('\n').flatMap((line) => {
    const position = /<!-- mrt:source-occurrence=(\d+) -->/.exec(line);
    return position ? [[Number(position[1]), line]] : [];
  }));
  const mapping = JSON.parse(readFileSync(new URL(`../../scripts/data/owner-mappings/${id}.json`, import.meta.url), 'utf8'));
  const confirmed = new Set(revisions.flatMap(({ issueIds }) => issueIds));
  const replacements = new Map(mapping.rows.filter((row) => confirmed.has(row.selectedIssueId))
    .map((row) => [row.sourcePosition, row]));
  assert.equal(replacements.size, confirmed.size);
  const inverse = markdown.replace(/\r\n/g, '\n').split('\n').map((line) => {
    const position = Number(/<!-- mrt:source-occurrence=(\d+) -->/.exec(line)?.[1]);
    const row = replacements.get(position);
    if (!row) return line;
    assert.ok(line.includes(`](${row.marvelIssueUrl})`)
      && line.includes('mrt:identity-evidence=owner-confirmed-identity'));
    return originalLines.get(position);
  }).join('\n');
  assert.equal(inverse, original, 'Only approved placeholder checklist lines may differ.');
  return inverse;
}

export function beforeIdentityCatalogEntry(entry) {
  const revised = identityRevisions.guides.filter((entry) => entry.placeholderReplacement);
  const revision = revised.find(({ id }) => id === entry.id);
  if (!revision) return entry;
  const previous = beforeIdentityJson('src/data/catalog.json', revision.baselineCommit).lists
    .find(({ id }) => id === entry.id);
  const { ownerConfirmedIdentityCount, ...rest } = entry;
  assert.equal(ownerConfirmedIdentityCount,
    revised.filter(({ id }) => id === entry.id).flatMap(({ issueIds }) => issueIds).length);
  assert.equal(entry.placeholderCount, previous.placeholderCount - ownerConfirmedIdentityCount);
  const inverse = { ...rest, placeholderCount: previous.placeholderCount, updatedAt: previous.updatedAt };
  assert.deepEqual(Object.fromEntries(Object.keys(previous).map((key) => [key, inverse[key]])), previous);
  return inverse;
}

export function beforeIdentityCatalog(catalog) {
  return {
    ...catalog, lists: catalog.lists.map(beforeIdentityCatalogEntry),
  };
}

export function beforeIdentityOrders(orders, cutoff = '', revisions = identityRevisions.guides) {
  return orders.map((entry) => {
    const later = revisions.filter(({ id, generatedAt }) =>
      id === (entry.id ?? entry.orderId) && generatedAt > cutoff);
    const removed = new Set(later.flatMap(({ issueIds }) => issueIds));
    if (later[0]?.placeholderReplacement) {
      const id = entry.id ?? entry.orderId;
      const original = beforeIdentityJson(`test/fixtures/owner-delivery/${id}.json`, later[0].baselineCommit);
      const mapping = JSON.parse(readFileSync(new URL(`../../scripts/data/owner-mappings/${id}.json`, import.meta.url), 'utf8'));
      const replacements = new Map([...removed].map((issueId) => {
        const row = mapping.rows.find((candidate) => candidate.selectedIssueId === issueId);
        assert.equal(row?.identityEvidenceKind, 'owner-confirmed-identity');
        const previous = original.rows.find(([position]) => position === row.sourcePosition);
        assert.ok(previous && previous[1] < 0, 'Each inverse must name an original placeholder.');
        return [issueId, previous[1]];
      }));
      return {
        ...entry, issueIds: entry.issueIds.map((id) => {
          const replacement = replacements.get(Number(id));
          return replacement == null ? id : (typeof id === 'string' ? String(replacement) : replacement);
        }),
      };
    }
    return !later.length ? entry : {
      ...entry, issueIds: entry.issueIds.filter((id) => !removed.has(Number(id))),
    };
  });
}
