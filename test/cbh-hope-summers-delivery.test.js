import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences,
  validateFrozenPacket,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { parseCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const id = 'hope-summers-reading-order';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (relativePath) => JSON.parse(
  await readFile(path.join(root, relativePath), 'utf8'),
);
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const occurrences = ledger.resolvedOccurrences;
const identitiesAt = (first, last) => occurrences.slice(first - 1, last)
  .map((row) => [row.normalizedSeriesTitle, row.seriesYear, row.issueNumber]);
const numbers = (seriesId) => mapping.rows.filter((row) => row.seriesId === seriesId)
  .map((row) => row.issueNumber);
const range = (first, last) => Array.from(
  { length: last - first + 1 },
  (_, index) => String(first + index),
);

test('Hope Summers conserves the complete 264-position source vector', () => {
  assert.deepEqual(
    ledger.blocks.reduce((counts, block) => {
      counts[block.section] = (counts[block.section] ?? 0) + block.issues.length;
      return counts;
    }, {}),
    {
      'The Messiah Is Born': 46,
      'The Messiah Shows Her Powers': 83,
      'Hope Summers From Marvel NOW! Until Krakoa': 59,
      'The Savior in Krakoa': 25,
      'Latest Additions': 51,
    },
  );
  assert.deepEqual(
    occurrences.reduce((counts, row) => {
      counts[row.disposition] = (counts[row.disposition] ?? 0) + 1;
      return counts;
    }, {}),
    { canonical: 255, 'canonical-repeat': 3, 'published-metadata-gap': 6 },
  );
  assert.deepEqual(
    [...packet.rows, ...packet.repeatedSourceReferences, ...packet.sourceGaps]
      .map((row) => row.sourcePosition)
      .sort((left, right) => left - right),
    Array.from({ length: 264 }, (_, index) => index + 1),
  );
  const vector = occurrences.map((row) => [
    row.sourcePosition,
    row.normalizedSeriesTitle,
    row.seriesYear,
    row.issueNumber,
    row.disposition,
    row.issueId ?? null,
  ]);
  assert.equal(
    createHash('sha256').update(JSON.stringify(vector)).digest('hex'),
    '8d23077c0c37f482cee4990815ba34b14d86db65a26553ff644a34cc1c758dc9',
  );
  assert.deepEqual(
    mapping.rows.map((row) => [row.sourcePosition, row.selectedIssueId]),
    occurrences.filter((row) => row.disposition === 'canonical')
      .map((row) => [row.sourcePosition, row.issueId]),
  );
  assert.deepEqual(
    packet.repeatedSourceReferences.map((row) => [
      row.sourcePosition,
      packet.rows[row.canonicalRow - 1].sourcePosition,
    ]),
    [[41, 40], [96, 84], [214, 205]],
  );
  assert.doesNotThrow(() => validateFrozenPacket(packet, { expectedId: id }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
});

test('Hope Summers keeps every source-directed interleave, placement and original volume', () => {
  assert.deepEqual(identitiesAt(1, 13), [
    ['X-Men: Messiah Complex', 2007, '1'],
    ['Uncanny X-Men', 1963, '492'],
    ['X-Factor', 2005, '25'],
    ['New X-Men', 2004, '44'],
    ['X-Men', 2004, '205'],
    ['Uncanny X-Men', 1963, '493'],
    ['X-Factor', 2005, '26'],
    ['New X-Men', 2004, '45'],
    ['X-Men', 2004, '206'],
    ['Uncanny X-Men', 1963, '494'],
    ['X-Factor', 2005, '27'],
    ['New X-Men', 2004, '46'],
    ['X-Men', 2004, '207'],
  ]);
  assert.deepEqual(identitiesAt(19, 21), [
    ['Cable', 2008, '6'],
    ['CABLE KING-SIZE SPECTACULAR 1', 2008, '1'],
    ['Cable', 2008, '7'],
  ]);
  assert.deepEqual(identitiesAt(47, 60), [
    ['X-Men: Second Coming', 2010, '1'],
    ['Uncanny X-Men', 1963, '523'],
    ['New Mutants', 2009, '12'],
    ['X-Men: Legacy', 2008, '235'],
    ['X-Force', 2008, '26'],
    ['Uncanny X-Men', 1963, '524'],
    ['New Mutants', 2009, '13'],
    ['X-Men: Legacy', 2008, '236'],
    ['X-Force', 2008, '27'],
    ['Uncanny X-Men', 1963, '525'],
    ['New Mutants', 2009, '14'],
    ['X-Men: Legacy', 2008, '237'],
    ['X-Force', 2008, '28'],
    ['X-Men: Second Coming', 2010, '2'],
  ]);
  assert.deepEqual(
    identitiesAt(113, 129).map(([title, , number]) => [title, number]),
    [
      ...range(0, 12).map((number) => ['Avengers Vs. X-Men', number]),
      ['AVX: Consequences', '1'],
      ['AVX: Consequences', '3'],
      ['AVX: Consequences', '4'],
      ['AVX: Consequences', '5'],
    ],
  );
  assert.deepEqual(
    identitiesAt(144, 150).map(([title, , number]) => [title, number]),
    [
      ['Cable and X-Force', '15'],
      ['Cable and X-Force', '16'],
      ['Cable and X-Force', '17'],
      ['Cable and X-Force', '18'],
      ['Uncanny X-Force', '16'],
      ['Cable and X-Force', '19'],
      ['Uncanny X-Force', '17'],
    ],
  );
  assert.deepEqual(numbers(23044), [...range(1, 6), '9', '10']);
  assert.deepEqual(numbers(4002), [...range(1, 10), ...range(13, 24)]);
  assert.deepEqual(numbers(9746), ['25']);
  assert.deepEqual(numbers(22386), ['155', '156', '159']);
  assert.deepEqual(numbers(27555), [...range(1, 5), ...range(7, 12)]);
  assert.deepEqual(numbers(31375), [...range(1, 5), ...range(7, 13)]);
  assert.ok(!occurrences.some((row) => row.seriesYear === 2022
    && row.normalizedSeriesTitle === 'X-Men: Hellfire Gala'));
  assert.deepEqual(
    mapping.rows.filter((row) => [71, 72].includes(row.sourcePosition))
      .map((row) => [row.seriesId, row.seriesYear, row.issueNumber]),
    [[13193, 2011, '3'], [13192, 2010, '1']],
  );
  assert.deepEqual(
    mapping.rows.find((row) => row.sourcePosition === 249)
      && identitiesAt(249, 249)[0],
    ['Invincible Iron Man', 2022, '8'],
  );
});

test('Hope Summers publishes 255 exact originals and six explicit gap placeholders once each', async () => {
  const payload = await readJson(`src/data/${packet.proposedManifest.out}`);
  const canonical = [...mapping.rows, ...mapping.sourceGaps]
    .sort((left, right) => left.sourcePosition - right.sourcePosition);
  const expectedGaps = [
    [241, 'X-Men: Hellfire Gala (2023) #1'],
    [244, 'X-Men Unlimited Infinity Comic (2021) #101'],
    [245, 'X-Men Unlimited Infinity Comic (2021) #102'],
    [246, 'X-Men Unlimited Infinity Comic (2021) #103'],
    [247, 'X-Men Unlimited Infinity Comic (2021) #104'],
    [248, 'X-Men Unlimited Infinity Comic (2021) #105'],
  ];

  assert.deepEqual(
    packet.sourceGaps.map((row) => [row.sourcePosition, row.sourceIssueReference]),
    expectedGaps,
  );
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
  assert.ok(packet.sourceGaps.every((row) => row.kind === 'published-metadata-gap'
    && row.status === 'open'
    && row.evidenceSources.some((source) => source.kind === 'tracking-issue'
      && source.url === 'https://github.com/raymond-nassar/recap-page/issues/563')));
  assert.equal(payload.items.length, 261);
  assert.equal(new Set(payload.items.map((row) => row.issueId)).size, 261);
  assert.equal(payload.items.filter((row) => row.issueId > 0).length, 255);
  assert.equal(payload.items.filter((row) => row.placeholder).length, 6);
  canonical.forEach((row, index) => {
    if (row.selectedIssueId) {
      assert.equal(payload.items[index].issueId, row.selectedIssueId);
    } else {
      assert.ok(payload.items[index].issueId < 0);
      assert.equal(payload.items[index].title, row.sourceIssueReference);
    }
  });
  for (const repeat of packet.repeatedSourceReferences) {
    const issueId = packet.rows[repeat.canonicalRow - 1].candidateIssueId;
    assert.equal(payload.items.filter((row) => row.issueId === issueId).length, 1);
  }
  assert.ok(payload.items.every((row) => row.description == null));
});

test('Hope Summers keeps the approved publication-time library relationships', async () => {
  const [report, manifest, inventory] = await Promise.all([
    readJson(`scripts/data/cbh-overlaps/${id}.json`),
    readJson('src/data/curated-lists.json'),
    readJson('scripts/data/cbh-character-inventory.json'),
  ]);
  const regenerated = await buildReportForMapping(
    `scripts/data/cbh-mappings/${id}.json`,
    [],
    { excludedOrderIds: ['x-23-reading-order', 'ms-marvel-kamala-khan-reading-order', 'marvel-zombies-reading-order', 'hawkeye-reading-order', 'silk-cindy-moon-reading-order', 'marvels-infinity-saga-gauntlet-wars-crusade-reading-order', 'nova-reading-order', 'ultimate-spider-man-reading-order', 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide', 'shang-chi-master-of-kung-fu-reading-order', 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order', 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order', 'namor-sub-mariner-reading-order', 'iron-fist-reading-order', 'mcu-prep-thunderbolts', 'spider-man-no-way-home-owner-selected', 'mcu-prep-daredevil-born-again', 'mcu-prep-moon-knight', 'mcu-prep-deadpool-and-wolverine', 'mcu-prep-eternals'] },
  );
  const expectedOrderIds = manifest.lists
    .filter((row) => row.id !== 'shang-chi-master-of-kung-fu-reading-order' && row.id !== 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order' && row.id !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order' && row.id !== id && row.id !== 'nova-reading-order' && row.id !== 'ultimate-spider-man-reading-order' && row.id !== 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide' && row.id !== 'x-23-reading-order' && row.id !== 'ms-marvel-kamala-khan-reading-order'
      && row.id !== 'marvel-zombies-reading-order'
      && row.id !== 'hawkeye-reading-order' && row.id !== 'silk-cindy-moon-reading-order'
      && row.id !== 'marvels-infinity-saga-gauntlet-wars-crusade-reading-order').filter((row) => row.id !== 'namor-sub-mariner-reading-order' && row.id !== 'iron-fist-reading-order' && row.id !== 'mcu-prep-daredevil-born-again' && row.id !== 'mcu-prep-moon-knight' && row.id !== 'mcu-prep-deadpool-and-wolverine' && row.id !== 'mcu-prep-eternals' && row.id !== 'spider-man-no-way-home-owner-selected' && row.id !== 'mcu-prep-thunderbolts')

    .map((row) => row.id);
  const expectedNonNone = new Map([
    ['emma-frost-reading-order', ['partial', 103]],
    ['hickman-x-men', ['partial', 5]],
    ['iron-man-reading-order', ['partial', 1]],
    ['judgment-day', ['partial', 7]],
    ['magneto-reading-order', ['partial', 61]],
    ['messiah-complex', ['existing-subset', 13]],
    ['messiah-war', ['existing-subset', 10]],
    ['modern-x-men-fast-track', ['partial', 29]],
    ['question-of-the-week-do-you-have-a-hulk-reading-order', ['partial', 4]],
    ['second-coming', ['partial', 15]],
    ['sins-of-sinister', ['partial', 3]],
    ['war-of-the-realms', ['partial', 3]],
    ['wolverine-reading-order', ['partial', 47]],
    ['x-force-reading-order', ['partial', 60]],
    ['x-men-divided-we-stand', ['partial', 6]],
    ['x-men-inferno', ['partial', 1]],
    ['x-men-regenesis', ['partial', 10]],
    ['x-men-schism', ['partial', 5]],
    ['young-avengers-reading-order', ['partial', 6]],
  ]);

  assert.deepEqual(regenerated, report);
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.equal(report.comparisonCount, 188);
  assert.deepEqual(new Set(report.comparisons.map((row) => row.orderId)), new Set(expectedOrderIds));
  assert.deepEqual(
    report.comparisons.reduce((counts, row) => {
      counts[row.relationship] = (counts[row.relationship] ?? 0) + 1;
      return counts;
    }, {}),
    { none: 169, partial: 17, 'existing-subset': 2 },
  );
  assert.deepEqual(
    new Map(report.comparisons.filter((row) => row.relationship !== 'none')
      .map((row) => [row.orderId, [row.relationship, row.sharedCount]])),
    expectedNonNone,
  );
  assert.equal(report.libraryDigest, 'b87c5cf3d3ea6b92c4e8d72458e1eda1740646902f16e4f9ef2d4d92bc1b3873');
  assert.equal(report.reportDigest, 'ea6b87125402dc345c0b1fd024f66cac95822211313a571e4a39059061557023');
  assert.equal(mapping.reviewStatus, 'approved');
  assert.equal(
    mapping.relationshipReview.approvalDigest,
    '5514b7b9c37bb681dc6d112edfd8683cead776d78503fa9daf4e5772d5b20285',
  );
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: report.libraryDigest,
    expectedOrderIds,
  }));
  const inventoryRecord = inventory.find((row) => row.id === id);
  assert.deepEqual(inventoryRecord.overlapIds, [...expectedNonNone.keys()].sort());
  assert.equal(inventoryRecord.deliveryStatus, 'shipped');
  assert.equal(inventoryRecord.centralDisposition, 'pilot-approved');
});

test('Hope Summers publishes the credited partial guide and approved cover', async () => {
  const [payload, markdown, manifest, rawCatalog] = await Promise.all([
    readJson(`src/data/${packet.proposedManifest.out}`),
    readFile(path.join(root, 'src/data/orders', `${id}.md`), 'utf8'),
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
  ]);
  const parsed = parseChecklist(markdown);
  const manifestEntry = manifest.lists.find((row) => row.id === id);
  const catalogEntry = parseCatalog(rawCatalog).lists.find((row) => row.id === id);

  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  assert.equal(parsed.entries.length, 255);
  assert.equal(parsed.unresolved.length, 6);
  assert.deepEqual(
    payload.items.filter((row) => row.issueId > 0).map((row) => row.issueId),
    mapping.rows.map((row) => row.selectedIssueId),
  );
  assert.deepEqual(
    {
      expect: manifestEntry.expect,
      depth: manifestEntry.depth,
      spotlightKind: manifestEntry.spotlightKind,
      coverIssueId: manifestEntry.coverIssueId,
    },
    { expect: 261, depth: 'partial', spotlightKind: 'other', coverIssueId: 16600 },
  );
  assert.deepEqual(
    {
      count: catalogEntry.count,
      placeholderCount: catalogEntry.placeholderCount,
      emptyRecordCount: catalogEntry.emptyRecordCount,
      coverIssueId: catalogEntry.coverIssueId,
      source: catalogEntry.source,
      sourceOrigin: catalogEntry.sourceOrigin,
    },
    {
      count: 261,
      placeholderCount: 6,
      emptyRecordCount: 0,
      coverIssueId: 16600,
      source: 'https://www.comicbookherald.com/hope-summers-reading-order/',
      sourceOrigin: "Compiled for this project from Comic Book Herald's guide",
    },
  );
  assert.deepEqual(packet.sourceReview, {
    authorityType: 'stronger-model',
    authorityIdentity: 'GPT-6 Astra coordinator, guide review for issue #562',
    reviewedAt: '2026-09-28T23:22:15.865Z',
    rationale: "The coordinator independently reread the complete credited article including Latest Additions, re-expanded each section and verified the corrected264-position partition. Explicit character cuts replace broader contents; the source's stated Cable, Messiah, AVX and Vendetta reading directions govern placement. The2022 Hellfire Gala link identifies an unnumbered collected edition, not a supplied issue sequence, and is retained as a nonselection rather than expanded. The selected original one-shots remain bounded original identities, including the later Onslaught repeat. Metadata resolution and relationship approval are separate gates.",
  });
});
