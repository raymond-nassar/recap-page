import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

export const ultimateSelection = JSON.parse(readFileSync(
  new URL('../data/ultimate-spider-man-selection.json', import.meta.url), 'utf8',
));

export function excludedUltimatePositions(selection = ultimateSelection) {
  assert.equal(selection.schemaVersion, 1);
  assert.equal(selection.id, 'ultimate-spider-man-reading-order');
  assert.equal(selection.sourceCount, 352);
  const positions = new Map();
  for (const block of selection.exclusions) {
    assert.equal(typeof block.enabled, 'boolean');
    assert.ok(Number.isInteger(block.firstSourcePosition) && block.firstSourcePosition >= 317);
    for (const [offset, issueId] of block.issueIds.entries()) {
      const position = block.firstSourcePosition + offset;
      assert.ok(position <= selection.sourceCount && Number.isInteger(issueId) && issueId > 0);
      assert.ok(!positions.has(position), 'Owner exclusions overlap.');
      positions.set(position, { issueId, enabled: block.enabled });
    }
  }
  assert.deepEqual([...positions.keys()], Array.from({ length: 36 }, (_, index) => index + 317),
    'Owner exclusions must account for the entire original new-universe tail.');
  return new Map([...positions].filter(([, value]) => value.enabled)
    .map(([position, { issueId }]) => [position, issueId]));
}

export const ultimateSelectionDelta = -excludedUltimatePositions().size;
export const ultimateSelectionEmptyDelta = -ultimateSelection.exclusions
  .filter((block) => block.enabled)
  .reduce((count, block) => count + (block.detailsRefusedIssueIds?.length ?? 0), 0);

export function selectedUltimateRows(mapping, selection = ultimateSelection) {
  if (mapping.id !== selection.id) return mapping.rows;
  const excluded = excludedUltimatePositions(selection);
  for (const [position, issueId] of excluded) {
    assert.equal(mapping.rows.find((row) => row.sourcePosition === position)?.selectedIssueId, issueId,
      `Owner exclusion differs from the frozen source at position ${position}.`);
  }
  return mapping.rows.filter((row) => !excluded.has(row.sourcePosition));
}

export function selectedUltimateEntry(entry, selection = ultimateSelection) {
  assert.equal(entry.id, selection.id);
  return {
    ...entry,
    description: selection.description,
    sourceOrigin: selection.sourceOrigin,
    keywords: selection.keywords,
    expect: selection.sourceCount - excludedUltimatePositions(selection).size,
  };
}

export function selectedUltimatePayload(original, selection = ultimateSelection) {
  assert.equal(original.id, selection.id);
  assert.equal(original.items.length, selection.sourceCount);
  const excluded = excludedUltimatePositions(selection);
  for (const [position, issueId] of excluded) {
    assert.equal(original.items[position - 1].issueId, issueId,
      `Owner exclusion differs from the pinned payload at position ${position}.`);
  }
  const items = original.items.filter((_, index) => !excluded.has(index + 1));
  return {
    ...original,
    description: selection.description,
    sourceOrigin: selection.sourceOrigin,
    count: items.length,
    collections: new Set(items.map((item) => item.collectedIn).filter(Boolean)).size,
    items,
  };
}
