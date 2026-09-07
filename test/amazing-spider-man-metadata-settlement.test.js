import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { placeholderId } from '../scripts/lib/placeholder-id.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const orderId = 'amazing-spider-man-reading-order-modern-marvel-era';

async function readJson(...parts) {
  return JSON.parse(await readFile(path.join(root, ...parts), 'utf8'));
}

test('Amazing Spider-Man settlement conserves all 103 source rows and retained identities', async () => {
  const [
    settlement,
    payload,
    catalog,
    manifest,
    inventory,
    source,
  ] = await Promise.all([
    readJson('scripts', 'data', 'cbh-provider-settlements', `${orderId}.json`),
    readJson('src', 'data', 'amazing_spider_man_reading_order_modern_marvel_era.json'),
    readJson('src', 'data', 'catalog.json'),
    readJson('src', 'data', 'curated-lists.json'),
    readJson('scripts', 'data', 'cbh-character-inventory.json'),
    readFile(path.join(root, 'src', 'data', 'orders', `${orderId}.md`), 'utf8'),
  ]);
  const parsed = parseChecklist(source);
  const rowsByOrdinal = new Map(settlement.rows.map((row) => [row.unresolvedOrdinal, row]));

  assert.deepEqual({
    sourceRows: settlement.sourceRowCount,
    exactRows: settlement.exactSourceRowCount,
    exactAtomicIdentities: settlement.exactAtomicIdentityCount,
    repeats: settlement.repeatedSourceReferenceCount,
    exclusions: settlement.sourceSemanticExclusionCount,
    providerUnavailable: settlement.providerUnavailabilityCount,
    availabilityOnly: settlement.availabilityOnlyCount,
    ownerLookups: settlement.ownerLookupCount,
  }, {
    sourceRows: 103,
    exactRows: 88,
    exactAtomicIdentities: 90,
    repeats: 3,
    exclusions: 5,
    providerUnavailable: 6,
    availabilityOnly: 1,
    ownerLookups: 0,
  });
  assert.equal(settlement.rows.length, 103);

  const exactIds = settlement.rows.flatMap((row) => row.selectedIssueIds ?? []);
  assert.equal(exactIds.length, 90);
  assert.equal(new Set(exactIds).size, 90);
  assert.deepEqual(
    [50, 51, 52, 53, 54].flatMap((ordinal) => rowsByOrdinal.get(ordinal).selectedIssueIds),
    [295, 357, 296, 355, 328],
  );
  assert.deepEqual(rowsByOrdinal.get(50).rejectedIssueIds, [354]);

  assert.deepEqual(rowsByOrdinal.get(14), {
    unresolvedOrdinal: 14,
    guideItem: 391,
    sourceIssueReference: 'Marvel Graphic Novel: Amazing Spider-Man - Parallel Lives',
    classification: 'availability-only',
    disposition: 'Preserve the original 1989 identity; issue 40361 remains a rejected later-edition substitute',
    rejectedIssueIds: [40361],
    sourceEdition: 1989,
  });
  assert.deepEqual(
    {
      classification: rowsByOrdinal.get(31).classification,
      labels: rowsByOrdinal.get(31).preservedLabels,
      rejected: rowsByOrdinal.get(31).rejectedIssueIds,
    },
    {
      classification: 'source-semantic-exclusion',
      labels: ["Annual '96", "Annual '97"],
      rejected: [22636, 59367],
    },
  );

  const unavailable = settlement.rows.filter((row) => row.classification === 'provider-unavailability');
  assert.equal(unavailable.length, 6);
  assert.ok(unavailable.every((row) => (
    row.nonexistenceClaim === false && row.substitutionAuthorized === false
  )));

  const retained = [
    ['Peter Parker, The Spectacular Spider-Man #112', -2106195269],
    ['Peter Parker, The Spectacular Spider-Man #114', -2005529555],
    ['Peter Parker, The Spectacular Spider-Man Annual #5', -938181069],
    ['Marvel Graphic Novel: Amazing Spider-Man - Parallel Lives', -734556372],
    ['Avengers #329', -722540133],
    ['Mighty Avengers #4.1', -2132547036],
    ['Mighty Avengers #5.1', -1666885343],
  ];
  assert.deepEqual(
    settlement.retainedPlaceholderIds.map((entry) => [
      entry.sourceIssueReference,
      entry.issueId,
    ]),
    retained,
  );
  for (const [title, issueId] of retained) {
    assert.equal(placeholderId(orderId, title), issueId);
  }

  assert.deepEqual(
    {
      count: payload.count,
      items: payload.items.length,
      placeholders: payload.placeholders,
      unresolved: payload.unresolved.length,
      parsedEntries: parsed.entries.length,
      parsedUnresolved: parsed.unresolved.length,
    },
    {
      count: 2041,
      items: 2041,
      placeholders: 7,
      unresolved: 7,
      parsedEntries: 2034,
      parsedUnresolved: 7,
    },
  );

  const parsedItems = [...parsed.entries, ...parsed.unresolved]
    .sort((left, right) => left.index - right.index);
  let offset = 0;
  for (const row of settlement.rows) {
    const index = row.guideItem - 1 + offset;
    if (row.classification === 'exact') {
      assert.deepEqual(
        payload.items.slice(index, index + row.selectedIssueIds.length).map((item) => item.issueId),
        row.selectedIssueIds,
        row.sourceIssueReference,
      );
      assert.deepEqual(
        parsedItems.slice(index, index + row.selectedIssueIds.length).map((item) => item.issueId),
        row.selectedIssueIds,
        `${row.sourceIssueReference} canonical source`,
      );
      offset += row.selectedIssueIds.length - 1;
    } else if (row.classification === 'repeat' || row.classification === 'source-semantic-exclusion') {
      offset -= 1;
    } else {
      const expectedId = placeholderId(orderId, row.sourceIssueReference);
      assert.equal(payload.items[index].issueId, expectedId, row.sourceIssueReference);
      assert.equal(payload.items[index].title, row.sourceIssueReference, row.sourceIssueReference);
      assert.equal(payload.items[index].placeholder, true, row.sourceIssueReference);
    }
  }
  assert.equal(offset, -6);
  assert.deepEqual(
    parsedItems.map((entry) => entry.issueId ?? placeholderId(orderId, entry.title, entry.sourceKey)),
    payload.items.map((item) => item.issueId),
  );

  const catalogEntry = catalog.lists.find((entry) => entry.id === orderId);
  const manifestEntry = manifest.lists.find((entry) => entry.id === orderId);
  const inventoryEntry = inventory.find((entry) => entry.id === orderId);
  assert.deepEqual(
    [manifestEntry.expect, catalogEntry.count, catalogEntry.placeholderCount],
    [2041, 2041, 7],
  );
  assert.match(
    inventoryEntry.reason,
    /2,041.+2,034.+90 atomic identities.+three repeats.+five source-semantic exclusions.+six provider-unavailability.+one availability-only/i,
  );
});
