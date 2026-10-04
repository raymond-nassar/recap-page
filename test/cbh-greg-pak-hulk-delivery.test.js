import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertMappingMatchesPacketOccurrences,
  digestCanonicalJson,
  validateFrozenPacket,
  validateInventoryState,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import {
  assertApprovedRelationshipReview,
  buildMarkdown,
  selectedIssueIds,
} from '../scripts/author-cbh-packet.mjs';
import { buildReportForMapping, loadLibrarySnapshot } from '../scripts/report-order-overlap.mjs';
import { parseCatalog, searchCatalog, shelfKey } from '../src/js/lib/catalog.js';
import { parseManifest } from '../src/js/lib/curated.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide';
const sourceUrl = `https://www.comicbookherald.com/${id}/`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
const printed = (block, first, last = first) => Array.from(
  { length: last - first + 1 },
  (_, offset) => `p${String(block).padStart(3, '0')}-o${String(first + offset).padStart(3, '0')}`,
);

// These source coordinates name printed mentions; their sequence is the separately approved
// directed reading order, including three placements ahead of their printed paragraph.
const selectedPrintedIds = [
  'p015-c001', ...printed(23, 1, 7),
  ...printed(25, 1), ...printed(17, 1), ...printed(25, 2, 4),
  ...printed(25, 15), ...printed(25, 5, 14), ...printed(27, 1),
  ...[38, 39, 40, 41, 42, 43, 44, 46, 47, 48, 49, 50, 51].flatMap((block) => printed(block, 1)),
  ...printed(53, 1, 5), ...printed(58, 1, 5), ...printed(63, 1, 3),
  ...printed(67, 1), ...printed(71, 1, 3), ...printed(71, 7),
  ...printed(71, 4, 6), ...printed(75, 1, 7),
  ...printed(78, 1, 6), ...printed(81, 1, 4), ...printed(84, 1, 3),
  ...printed(87, 1, 6), ...printed(90, 1, 4), ...printed(93, 1, 7),
  ...printed(95, 1, 6), ...printed(99, 1, 4), ...printed(106, 1, 6),
];

const originalIdsByGroup = {
  'Planet Hulk': [
    3105, 3034, 3186, 3502, 3057, 3092, 3205, 3413, 3530, 3984,
    3955, 4081, 4195, 4338, 4446, 4764, 5055, 5207, 5414, 5671,
    5811, 27399, 6099, 6245, 20812,
  ],
  'World War Hulk': [
    13426, 15873, 15807, 15984, 15925, 16168, 16107, 16448, 16557,
    16449, 16560, 17231, 17212, 17361, 23232, 23233, 23234, 23235,
  ],
  'Incredible Hercules': [23067, 20636, 20827, 23911],
  'Son of Hulk and World War Hulks': [
    21371, 21550, 21745, 22050, 22304, 22509, 22916, 24268, 23115, 23609,
    23768, 23769, 24168, 26314, 27645, 27646, 27647, 27648, 27650, 27419,
    29293, 27651, 27652, 27653, 31074, 31076, 31077, 36771, 36774, 30436,
    30437, 30438, 30439, 31236, 34050, 34021, 35101, 36051, 36050, 36049,
    36053, 36047, 36052, 36048, 36044, 36046, 36045, 36909, 36908, 38109,
  ],
  'Totally Awesome Hulk': [
    56083, 56084, 56085, 56086, 56095, 56096, 56097, 56098, 60847, 60848,
  ],
};
const originalIds = Object.values(originalIdsByGroup).flat();
const sourcePositions = Array.from({ length: 112 }, (_, index) => index + 1);
const canonicalPositions = sourcePositions.filter((position) => position < 39 || position > 43);

test('Greg Pak source retains all printed mentions and the complete directed vector', () => {
  assert.equal(ledger.printedFactualMentions.length, 196);
  assert.deepEqual(ledger.printedFactualMentions.map((row) => row.printedMentionSequence),
    Array.from({ length: 196 }, (_, index) => index + 1));
  assert.equal(new Set(ledger.printedFactualMentions.map((row) => row.printedOccurrenceId)).size, 196);
  assert.equal(digestCanonicalJson(ledger.printedFactualMentions),
    'e023e6067b4b48a74f5d5038b6e532544b9f7ba6468ecd91b00fcc7fe3c64cb3');
  assert.equal(digestCanonicalJson(ledger.selectedOccurrences),
    '6d44fc0b7fd1436654a16996004a834591288588500f803c64471b0ac1704ebd');
  assert.deepEqual(ledger.selectedOccurrences.map((row) => row.printedOccurrenceId), selectedPrintedIds);
  assert.deepEqual(ledger.selectedOccurrences.map((row) => row.sourcePosition), sourcePositions);
  const printedById = new Map(ledger.printedFactualMentions.map((row) => [row.printedOccurrenceId, row]));
  assert.ok(ledger.selectedOccurrences.every((row) =>
    printedById.get(row.printedOccurrenceId)?.printedMentionSequence === row.printedMentionSequence
    && row.printedBlockId === printedById.get(row.printedOccurrenceId)?.printedBlockId));
  assert.deepEqual(ledger.selectedOccurrences.map((row) => row.sourceDisposition === 'backward-repeat'
    ? row.canonicalRow : null).filter((row) => row != null), [27, 29, 31, 34, 36]);
  assert.deepEqual(ledger.selectedOccurrences.filter((row) => row.sourceDisposition !== 'backward-repeat')
    .map((row) => row.sourcePosition), canonicalPositions);
  assert.equal(ledger.selectedOccurrences[0].factualQualification,
    'Selected for its Amadeus Cho story; the checklist represents the whole original issue.');
  assert.deepEqual(ledger.selectedOccurrences.filter((row) => row.sourcePosition === 10
    || row.sourcePosition === 14 || row.sourcePosition === 56)
    .map((row) => row.printedOccurrenceId), ['p017-o001', 'p025-o015', 'p071-o007']);
  assert.deepEqual(ledger.unselectedPrintedCategories, {
    'planet-omnibus-collection-alternative': 22,
    'unnumbered-here-numbered-later': 1,
    'unnumbered-collection-alternative': 1,
    'fragment-only-collection-mention': 1,
    'collection-mention-repeated-in-story-paragraph': 1,
    'context-only': 9,
    'broad-omnibus-named-alternative': 2,
    'broad-omnibus-selected-later': 16,
    'broad-omnibus-alternative-only': 29,
    'aftersmash-named-here-selected-later': 1,
    'linked-unnumbered-collection-no-inferred-issues': 1,
  });
  assert.equal(ledger.sourceContentSha256,
    'dc18ad8bb3300611dca6d8c16e1ef0409a3d3324680c370156ec33df0bc71a7b');
  assert.equal(ledger.sourceIssueBearingBlocksSha256,
    'eec7e58db9187fb01ce110d5ad49275399249cd45e7b6aa113daa895ba8d67f3');
  assert.equal(packet.sourceOccurrenceCount, 112);
  assert.equal(packet.expectedCount, 107);
  assert.equal(packet.sourceGaps?.length ?? 0, 0);
  assert.deepEqual(packet.sourceReview, {
    authorityType: 'stronger-model',
    authorityIdentity: 'Independent source coordinator for guide issue #613',
    rationale: 'The coordinator independently read the complete source, selected its explicit detailed creator-focused route rather than broad omnibus alternatives, and verified the revised112-position directed vector,107 provisional original identities,five backward repeats and every printed-source correspondence. Amazing Fantasy15 is included from the separate numbered Cho-origin recommendation with a visible story qualification. This is source approval only, not metadata or relationship approval.',
    reviewedAt: '2026-09-29',
  });
});

test('Greg Pak maps every selected original exactly once without expanding the omnibus', () => {
  assert.equal(originalIds.length, 107);
  assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), originalIds);
  assert.deepEqual(mapping.rows.map((row) => row.sourceGroup),
    Object.entries(originalIdsByGroup).flatMap(([group, ids]) => ids.map(() => group)));
  assert.deepEqual(mapping.rows.map((row) => row.sourcePosition), canonicalPositions);
  assert.deepEqual(packet.rows.map((row) => row.sourcePosition), canonicalPositions);
  assert.deepEqual(mapping.repeatedSourceReferences.map((row) => [row.sourcePosition, row.canonicalRow]),
    [[39, 27], [40, 29], [41, 31], [42, 34], [43, 36]]);
  assert.deepEqual(mapping.rows.map((row) => row.sourceIssueReference),
    ledger.selectedOccurrences.filter((row) => row.sourceDisposition !== 'backward-repeat')
      .map((row) => row.sourceIssueReference));
  assert.equal(mapping.rows[0].sourceIssueReference, 'Amazing Fantasy (2004) #15');
  assert.deepEqual([mapping.rows[8].seriesId, mapping.rows[9].seriesId, mapping.rows[13].seriesId],
    [465, 43504, 1108]);
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 8842)
    .map((row) => row.issueNumber), [
    ...Array.from({ length: 21 }, (_, index) => String(601 + index)),
    ...Array.from({ length: 13 }, (_, index) => String(623 + index)),
  ]);
  assert.deepEqual(mapping.rows.filter((row) => row.seriesId === 20614)
    .map((row) => row.issueNumber), ['1', '2', '3', '4', '13', '14', '15', '16', '17', '18']);
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.deepEqual(selectedIssueIds(mapping).map(Number), originalIds);
});

test('Greg Pak relationship review is current, real and not inherited by a pending clone', async () => {
  const library = await loadLibrarySnapshot();
  const current = await buildReportForMapping(`scripts/data/cbh-mappings/${id}.json`, [], {
    excludedOrderIds: ['mcu-prep-thunderbolts', 'shang-chi-master-of-kung-fu-reading-order',
      'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order',
      'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order',
      'namor-sub-mariner-reading-order', 'iron-fist-reading-order', 'spider-man-no-way-home-owner-selected', 'mcu-prep-moon-knight'],
  });
  const expectedOrderIds = library.lists.filter((entry) =>
    entry.id !== id && entry.id !== 'shang-chi-master-of-kung-fu-reading-order'
      && entry.id !== 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order'
      && entry.id !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order'
      && entry.id !== 'namor-sub-mariner-reading-order'
      && entry.id !== 'iron-fist-reading-order' && entry.id !== 'mcu-prep-moon-knight' && entry.id !== 'spider-man-no-way-home-owner-selected' && entry.id !== 'mcu-prep-thunderbolts')
    .map((entry) => entry.id);
  assert.deepEqual(current, report);
  assert.equal(report.comparisonCount, 197);
  assert.deepEqual(report.comparisons.reduce((counts, row) => {
    counts[row.relationship] = (counts[row.relationship] ?? 0) + 1;
    return counts;
  }, {}), { none: 187, partial: 9, 'existing-subset': 1 });
  assert.deepEqual(report.comparisons.filter((row) => row.relationship === 'existing-subset')
    .map((row) => [row.orderId, row.sharedCount]), [['planet-hulk', 15]]);
  assert.equal(mapping.relationshipReview.approvalDigest,
    'c5c8c9923c7bd2edbb2958c58c53c405a37b1a32cbd3c8b03f6cc53b85b77b5f');
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: current.libraryDigest, expectedOrderIds,
  }));
  const pending = structuredClone(mapping);
  pending.reviewStatus = 'pending-independent-review';
  delete pending.packetReview;
  delete pending.approvedManifest;
  delete pending.relationshipReview;
  assert.throws(() => assertApprovedRelationshipReview({
    packet, mapping: pending, report, currentLibraryDigest: report.libraryDigest, expectedOrderIds,
  }), /approved|review|pending/i);
});

test('Greg Pak publishes the exact 107-row creator route without replacing Planet Hulk', async () => {
  const [markdown, payload, originalPlanetHulk, manifest, catalogRaw, inventory] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson(`src/data/${packet.proposedManifest.out}`),
    readJson('src/data/planet_hulk.json'),
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
    readJson('scripts/data/cbh-character-inventory.json'),
  ]);
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 107);
  assert.equal(parsed.unresolved.length, 0);
  assert.deepEqual(parsed.entries.map((row) => [Number(row.sourceKey), row.issueId]),
    mapping.rows.map((row) => [row.sourcePosition, row.selectedIssueId]));
  assert.match(parsed.entries[0].section, /Amadeus Cho short-story recommendation/);
  assert.deepEqual(payload.items.map((item) => item.issueId), originalIds);
  assert.deepEqual(payload.items.map((item) => item.title), mapping.rows.map((row) => row.resolvedIssueTitle));
  assert.deepEqual(payload.items.map((item) => item.collectedIn),
    parsed.entries.map((row) => row.section));
  assert.ok(payload.items.every((item) => item.description == null && !item.placeholder));
  assert.ok(payload.items.every((item) => item.detailsRefused === true
    ? item.cover === null && item.seriesId === null && item.digitalId === null
    : item.cover?.path && item.cover.ext));
  assert.equal(originalPlanetHulk.items.length, 15);
  assert.deepEqual(originalPlanetHulk.items.map((item) => item.issueId),
    report.comparisons.find((row) => row.orderId === 'planet-hulk').sharedIds.map(Number));
  assert.equal(manifest.lists.length, 206);
  assert.deepEqual(parseManifest(manifest).errors, []);
  const position = manifest.lists.findIndex((entry) => entry.id === id);
  assert.equal(manifest.lists[position - 1].id, 'planet-hulk');
  assert.equal(manifest.lists[position + 1].id, 'civil-war');
  assert.deepEqual(manifest.lists[position], mapping.approvedManifest);
  assert.equal(manifest.lists[position].spotlightKind, undefined);
  const card = parseCatalog(catalogRaw).lists.find((entry) => entry.id === id);
  assert.equal(card.count, 107);
  assert.equal(card.coverIssueId, 3530);
  assert.deepEqual(card.cover, payload.items.find((item) => item.issueId === 3530).cover);
  assert.equal(card.source, sourceUrl);
  assert.equal(card.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
  assert.equal(card.sourceLicense, null);
  assert.equal(card.type, 'creator-run');
  assert.equal(card.depth, 'selected');
  assert.equal(card.timeline, null);
  assert.equal(card.spotlightKind, null);
  assert.equal(shelfKey({ lists: [card] }), 'lines');
  for (const query of ['Greg Pak', 'Planet Hulk', 'Amadeus Cho']) {
    assert.ok(searchCatalog(parseCatalog(catalogRaw).lists, query).some((entry) => entry.id === id));
  }
  assert.doesNotThrow(() => validateInventoryState(inventory));
  const record = inventory.find((entry) => entry.id === id);
  assert.deepEqual([record.position, record.guideType, record.deliveryStatus, record.catalogIds],
    [91, 'creator-run', 'shipped', [id]]);
  assert.deepEqual(record.overlapIds, report.comparisons.filter((comparison) =>
    comparison.relationship !== 'none').map((comparison) => comparison.orderId));
});
