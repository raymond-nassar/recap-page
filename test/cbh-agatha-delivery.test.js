import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertApprovedRelationshipReview,
  buildMarkdown,
} from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import {
  addIssuesToList,
  createEmptyState,
  createList,
  deleteList,
  isRead,
  markRead,
} from '../src/js/lib/model.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { reorderHistoricalAgathaEntry } from './helpers/agatha-historical-library.mjs';

const id = 'agatha-harkness-reading-order';
const sourceUrl = 'https://www.comicbookherald.com/agatha-harkness-reading-order/';
const mappingPath = `scripts/data/cbh-mappings/${id}.json`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [packet, mapping, report, ledger, manifest, catalog, payload, historical, inventory] = await Promise.all([
  readJson(`scripts/data/cbh-packets/${id}.json`),
  readJson(mappingPath),
  readJson(`scripts/data/cbh-overlaps/${id}.json`),
  readJson(`scripts/data/cbh-source-ledgers/${id}.json`),
  readJson('src/data/curated-lists.json'),
  readJson('src/data/catalog.json'),
  readJson('src/data/agatha_harkness_reading_order.json'),
  readJson('test/fixtures/agatha-historical-library.json'),
  readJson('scripts/data/cbh-character-inventory.json'),
]);

function assertOriginalScarletIdentities(value) {
  for (const expected of [
    { sourcePosition: 77, selectedIssueId: 54974, issueNumber: '1' },
    { sourcePosition: 78, selectedIssueId: 54977, issueNumber: '3' },
    { sourcePosition: 79, selectedIssueId: 54978, issueNumber: '4' },
  ]) {
    const row = value.rows.find((entry) => entry.sourcePosition === expected.sourcePosition);
    assert.deepEqual(
      {
        sourcePosition: row?.sourcePosition,
        selectedIssueId: row?.selectedIssueId,
        normalizedSeriesTitle: row?.normalizedSeriesTitle,
        seriesYear: row?.seriesYear,
        issueNumber: row?.issueNumber,
      },
      {
        ...expected,
        normalizedSeriesTitle: 'Scarlet Witch',
        seriesYear: 1994,
      },
      `source position ${expected.sourcePosition} must keep its original Scarlet Witch identity`,
    );
  }
}

test('Agatha publishes the complete corrected source vector in its original catalog position', async () => {
  const markdown = await readFile(`src/data/orders/${id}.md`, 'utf8');
  const manifestIndex = manifest.lists.findIndex((entry) => entry.id === id);
  const catalogIndex = catalog.lists.findIndex((entry) => entry.id === id);
  const expectedCorrections = [
    [1, 13304],
    [2, 12899],
    [77, 54974],
    [78, 54977],
    [79, 54978],
    [80, 83685],
    [81, 83686],
    [112, 101172],
    [113, 101173],
    [114, 109670],
  ];

  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.equal(packet.sourceUrl, sourceUrl);
  assert.equal(ledger.sourceUrl, sourceUrl);
  assert.equal(packet.expectedCount, 114);
  assert.equal(ledger.sourceOccurrenceCount, 114);
  assert.equal(packet.rows.length, 114);
  assert.equal(packet.sourceGaps?.length ?? 0, 0);
  assert.equal(packet.repeatedSourceReferences?.length ?? 0, 0);
  assert.equal(ledger.selectedReferences.length, 114);
  assert.deepEqual(
    ledger.selectedReferences.map((entry) => entry.sourcePosition),
    Array.from({ length: 114 }, (_, index) => index + 1),
  );
  assert.deepEqual(
    mapping.rows.map((entry) => [entry.sourcePosition, entry.selectedIssueId]),
    ledger.selectedReferences.map((entry) => [entry.sourcePosition, entry.selectedIssueId]),
  );
  assert.deepEqual(
    expectedCorrections,
    expectedCorrections.map(([sourcePosition]) => {
      const row = mapping.rows.find((entry) => entry.sourcePosition === sourcePosition);
      return [sourcePosition, row.selectedIssueId];
    }),
  );
  assert.equal(new Set(mapping.rows.map((entry) => entry.selectedIssueId)).size, 114);
  assert.deepEqual(
    payload.items.map((entry) => entry.issueId),
    mapping.rows.map((entry) => entry.selectedIssueId),
  );
  assert.equal(payload.count, 114);
  assert.equal(payload.placeholders, 0);
  assert.deepEqual(payload.unresolved, []);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  assert.equal(parseChecklist(markdown).entries.length, 114);
  assert.equal(manifest.lists[manifestIndex - 1].id, 'marvels-best-phoenix-comics');
  assert.equal(manifest.lists[manifestIndex + 1].id, 'punisher-reading-order');
  assert.equal(catalog.lists[catalogIndex - 1].id, 'marvels-best-phoenix-comics');
  assert.equal(catalog.lists[catalogIndex + 1].id, 'punisher-reading-order');
});

test('Agatha keeps the original Scarlet Witch identities distinct from the modern issue', () => {
  assertOriginalScarletIdentities(mapping);
  const originalIds = [54974, 54977, 54978];
  const byId = new Map(payload.items.map((entry) => [entry.issueId, entry]));
  for (const issueId of originalIds) {
    const item = byId.get(issueId);
    assert.equal(item.seriesId, null);
    assert.equal(item.detailsRefused, true);
    assert.match(item.title, /^Scarlet Witch \(1994\) #[134]$/);
    assert.match(item.url, new RegExp(`/issue/${issueId}/scarlet_witch_1994_`));
  }
  const modern = mapping.rows.find((entry) => entry.sourcePosition === 94);
  assert.deepEqual(
    [modern.selectedIssueId, modern.seriesYear, modern.issueNumber],
    [57094, 2015, '1'],
  );
  assert.deepEqual(
    [byId.get(101172).seriesId, byId.get(101173).seriesId, byId.get(109670).seriesId],
    [34645, 34645, 37548],
  );

  const mutated = structuredClone(mapping);
  mutated.rows.find((entry) => entry.sourcePosition === 77).selectedIssueId = 57094;
  assert.throws(
    () => assertOriginalScarletIdentities(mutated),
    /source position 77 must keep its original Scarlet Witch identity/,
  );
});

test('Agatha current inventory follows the corrected source and relationship lifecycle', () => {
  const inventoryEntry = inventory.find((entry) => entry.id === id);
  const overlapIds = report.comparisons
    .filter((entry) => entry.relationship !== 'none')
    .map((entry) => entry.orderId)
    .sort();

  assert.deepEqual(
    {
      reason: inventoryEntry.reason,
      sourceRetrievedAt: inventoryEntry.sourceRetrievedAt,
      sourceContentSha256: inventoryEntry.sourceContentSha256,
      overlapIds: inventoryEntry.overlapIds,
    },
    {
      reason: 'The corrected exact source snapshot preserves 114 occurrences as 114 distinct exact rows with no repeats, and the guide remains distinct across 19 current partial overlaps.',
      sourceRetrievedAt: packet.sourceRetrievedAt,
      sourceContentSha256: packet.sourceContentSha256,
      overlapIds,
    },
  );
  assert.equal(packet.sourceReview.authorityIdentity,
    'GPT-6 Astra coordinator, guide review for issue #557');
});

test('Agatha historical replay refuses to guess a missing insertion anchor', () => {
  assert.throws(
    () => reorderHistoricalAgathaEntry(
      [{ id: 'marvels-best-phoenix-comics' }, { id: 'punisher-reading-order' }],
      { id },
      'missing-historical-anchor',
    ),
    /Missing historical Agatha insertion anchor missing-historical-anchor/,
  );
});

test('Agatha relationship approval covers every source order present at review', async () => {
  const current = await buildReportForMapping(mappingPath, [], {
    excludedOrderIds: [
      'mcu-prep-thunderbolts', 'thunderbolts-reading-order',
      'nebula-reading-order',
      'hope-summers-reading-order',

      'x-23-reading-order', 'ms-marvel-kamala-khan-reading-order', 'marvel-zombies-reading-order', 'hawkeye-reading-order', 'silk-cindy-moon-reading-order', 'marvels-infinity-saga-gauntlet-wars-crusade-reading-order', 'nova-reading-order', 'ultimate-spider-man-reading-order', 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide',
      'shang-chi-master-of-kung-fu-reading-order', 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order', 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order', 'namor-sub-mariner-reading-order', 'iron-fist-reading-order', 'mcu-prep-deadpool-and-wolverine',
    ],
  });
  const expectedOrderIds = manifest.lists
    .filter((entry) => entry.id !== 'shang-chi-master-of-kung-fu-reading-order' && entry.id !== 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order' && entry.id !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order' && entry.id !== id && entry.id !== 'nova-reading-order' && entry.id !== 'ultimate-spider-man-reading-order' && entry.id !== 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide' && entry.id !== 'iron-fist-reading-order' && entry.id !== 'mcu-prep-deadpool-and-wolverine' && entry.id !== 'mcu-prep-thunderbolts'
      && ![
        'thunderbolts-reading-order',
        'nebula-reading-order',
        'hope-summers-reading-order',

        'x-23-reading-order', 'ms-marvel-kamala-khan-reading-order', 'marvel-zombies-reading-order', 'hawkeye-reading-order', 'silk-cindy-moon-reading-order', 'marvels-infinity-saga-gauntlet-wars-crusade-reading-order',

      ].includes(entry.id)).filter((row) => row.id !== 'namor-sub-mariner-reading-order')
    .map((entry) => entry.id);

  assert.deepEqual(current, report);
  assert.equal(report.comparisonCount, 185);
  assert.deepEqual(
    report.comparisons.reduce((counts, entry) => {
      counts[entry.relationship] = (counts[entry.relationship] ?? 0) + 1;
      return counts;
    }, {}),
    { partial: 19, none: 166 },
  );
  assert.deepEqual(
    new Set(report.comparisons.map((entry) => entry.orderId)),
    new Set(expectedOrderIds),
  );
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: current.libraryDigest,
    expectedOrderIds,
  }));
});

test('Agatha delete and reimport preserves prior issue identities and read progress', () => {
  const currentById = new Map(payload.items.map((entry) => [entry.issueId, entry]));
  const priorItems = historical.issueIds.map((issueId) => {
    const item = currentById.get(issueId);
    assert.ok(item, `current Agatha payload lost prior issue ${issueId}`);
    return { ...item, source: 'curated' };
  });
  let state = createList(createEmptyState(), {
    id: 'prior-agatha',
    name: 'Agatha Harkness',
    catalogId: id,
  });
  state = addIssuesToList(state, 'prior-agatha', priorItems).state;
  state = markRead(state, historical.issueIds[0], true, 1000);
  state = markRead(state, 57094, true, 2000);
  state = deleteList(state, 'prior-agatha');

  assert.ok(historical.issueIds.every((issueId) => state.issues[issueId]));
  assert.equal(state.read[historical.issueIds[0]], 1000);
  assert.equal(state.read[57094], 2000);

  state = createList(state, {
    id: 'current-agatha',
    name: payload.name,
    description: payload.description,
    catalogId: id,
  });
  const imported = addIssuesToList(
    state,
    'current-agatha',
    payload.items.map((entry) => ({ ...entry, source: 'curated' })),
  );
  state = imported.state;

  assert.equal(imported.added, 114);
  assert.deepEqual(
    state.lists['current-agatha'].itemIds,
    payload.items.map((entry) => entry.issueId),
  );
  assert.ok(historical.issueIds.every((issueId) => state.lists['current-agatha'].itemIds.includes(issueId)));
  assert.equal(payload.items.filter((entry) => !historical.issueIds.includes(entry.issueId)).length, 10);
  assert.equal(isRead(state, historical.issueIds[0]), true);
  assert.equal(isRead(state, 57094), true);
  assert.equal(state.read[historical.issueIds[0]], 1000);
  assert.equal(state.read[57094], 2000);
});
