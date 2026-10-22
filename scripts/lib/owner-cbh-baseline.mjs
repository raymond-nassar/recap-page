import assert from 'node:assert/strict';
import { escapeLinkText, parseChecklist } from '../../src/js/lib/markdown.js';

export function assertCbhBaselinePayload(contract, mapping, payload, markdown) {
  const parsed = parseChecklist(markdown);
  const entries = [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index);
  assert.deepEqual(entries.map((row) => Number(row.sourceKey)), contract.rows.map((row) => row[0]),
    'CBH baseline checklist positions differ from the captured contract.');
  assert.deepEqual(payload.items.map((item) => item.issueId), contract.rows.map((row) => row[1]),
    'CBH baseline payload differs from the captured contract.');
  const originals = new Map(mapping.rows.map((row) => [row.sourcePosition, row]));
  const gaps = new Map((mapping.sourceGaps ?? []).map((row) => [row.sourcePosition, row]));
  assert.equal(contract.rows.length, originals.size + gaps.size);
  for (const [index, [position, issueId, title, group]] of contract.rows.entries()) {
    const item = payload.items[index];
    const entry = entries[index];
    assert.equal(item.title, title);
    assert.equal(item.collectedIn ?? null, group == null ? null : contract.groups[group]);
    assert.equal(entry.section, item.collectedIn ?? null);
    if (originals.has(position)) {
      assert.equal(issueId, originals.get(position).selectedIssueId);
      assert.equal(entry.issueId, issueId);
      assert.ok(!item.placeholder);
    } else {
      assert.ok(gaps.has(position) && item.placeholder === true && issueId < 0,
        'A CBH placeholder must retain its exact captured gap position and identity.');
      assert.equal(entry.title, title);
      assert.equal(entry.url, null);
    }
  }
  assert.equal(payload.placeholders, gaps.size);
}

export function updatedCbhBaselineChecklist(markdown, previousMapping, mapping) {
  const previousPositions = new Set(previousMapping.rows.map((row) => row.sourcePosition));
  const added = new Map(mapping.rows.filter((row) => !previousPositions.has(row.sourcePosition))
    .map((row) => [row.sourcePosition, row]));
  const replaced = new Set();
  const lines = markdown.replace(/\r\n/g, '\n').split('\n').map((line) => {
    const position = Number(/<!--\s*mrt:source-occurrence=([1-9]\d*)\s*-->/.exec(line)?.[1]);
    if (!added.has(position)) return line;
    assert.ok(!replaced.has(position), 'CBH baseline has a repeated placeholder coordinate.');
    replaced.add(position);
    const row = added.get(position);
    return `- [ ] [${escapeLinkText(row.resolvedIssueTitle)} <!-- mrt:source-occurrence=${position} --> <!-- mrt:identity-evidence=owner-confirmed-identity -->](${row.marvelIssueUrl})`;
  });
  assert.equal(replaced.size, added.size, 'Every confirmed CBH gap must replace its existing checkbox.');
  return lines.join('\n');
}

export function cbhBaselineContractRows(contract, mapping) {
  const rows = new Map(mapping.rows.map((row) => [row.sourcePosition, row]));
  return contract.rows.map(([position, id, title, group]) => {
    const row = rows.get(position);
    return row?.identityEvidenceKind === 'owner-confirmed-identity'
      ? [position, row.selectedIssueId, row.resolvedIssueTitle, group]
      : [position, id, title, group];
  });
}

export function preserveCbhBaselinePlaceholders(contractRows, previousPayload, nextItems) {
  const existing = new Map(previousPayload.items.map((item) => [item.issueId, item]));
  const next = new Map(nextItems.map((item) => [item.issueId, item]));
  return contractRows.map(([, id]) => {
    const item = next.get(id) ?? existing.get(id);
    assert.ok(item, `CBH baseline lost published item ${id}.`);
    return structuredClone(item);
  });
}
