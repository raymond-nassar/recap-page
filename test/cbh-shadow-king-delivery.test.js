import assert from 'node:assert/strict';
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
import { historicalAgathaLibrarySnapshot } from './helpers/agatha-historical-library.mjs';

const id = 'shadow-king-reading-order';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = async (relativePath) => JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));

const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);

const rowsFor = (seriesId) => mapping.rows.filter((row) => row.seriesId === seriesId);

test('Shadow King keeps the approved source cuts and section boundaries', () => {
  assert.equal(ledger.counts.issueBearingBlocks, 19);
  assert.equal(ledger.counts.orderedSelections, 21);
  assert.equal(ledger.counts.canonicalIssueRows, 74);
  assert.equal(
    ledger.orderedSelections.find((entry) => entry.collection === 'New Mutants Omnibus Vol. 1').selectionPolicy,
    'explicit-cut',
  );
  assert.deepEqual(
    ledger.orderedSelections.filter((entry) => (
      entry.collection === 'Astonishing X-Men by Charles Soule Vol. 1: Life of X'
      || entry.collection === 'Astonishing X-Men by Charles Soule Vol. 2: A Man Called X'
      || entry.collection === 'Age Of X-Man: Prisoner X'
      || entry.collection === 'Empyre: X-Men'
    )).map(({ section, collection, selectionPolicy }) => [section, collection, selectionPolicy]),
    [
      ['Psylocke and Storm', 'Astonishing X-Men by Charles Soule Vol. 1: Life of X', 'full-collection'],
      ['Psylocke and Storm', 'Astonishing X-Men by Charles Soule Vol. 2: A Man Called X', 'explicit-cut'],
      ['Psylocke and Storm', 'Age Of X-Man: Prisoner X', 'full-collection'],
      ['Farouk and the Shadow King', 'Empyre: X-Men', 'explicit-cut'],
    ],
  );
});

test('Shadow King keeps Nightcrawler on the 2014 run and the approved candidate ids', () => {
  assert.deepEqual(rowsFor(18875).map((row) => [row.issueNumber, row.selectedIssueId, row.resolvedIssueTitle]), [
    ['8', 50504, 'Nightcrawler (2014) #8'],
    ['9', 50505, 'Nightcrawler (2014) #9'],
    ['10', 50506, 'Nightcrawler (2014) #10'],
  ]);
  assert.deepEqual(
    packet.rows.filter((row) => row.seriesId === 18875).map((row) => row.candidateIssueId),
    [50504, 50505, 50506],
  );
  assert.deepEqual(
    packet.rows.filter((row) => row.seriesId === 18875).map((row) => row.sourceIssueReference),
    ['Nightcrawler #8', 'Nightcrawler #9', 'Nightcrawler #10'],
  );
});

test('Shadow King keeps the frozen packet, mapping and full report aligned', async () => {
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const regenerated = await buildReportForMapping(`scripts/data/cbh-mappings/${id}.json`, [], {
    ...await historicalAgathaLibrarySnapshot(),
    excludedOrderIds: [
      'mcu-prep-thunderbolts', 'thunderbolts-reading-order',
      'nebula-reading-order',
      'hope-summers-reading-order',

      'x-23-reading-order', 'ms-marvel-kamala-khan-reading-order', 'marvel-zombies-reading-order', 'hawkeye-reading-order', 'silk-cindy-moon-reading-order', 'marvels-infinity-saga-gauntlet-wars-crusade-reading-order', 'nova-reading-order', 'ultimate-spider-man-reading-order', 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide',
      'shang-chi-master-of-kung-fu-reading-order', 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order', 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order', 'namor-sub-mariner-reading-order', 'iron-fist-reading-order', 'spider-man-no-way-home-owner-selected', 'mcu-prep-daredevil-born-again', 'mcu-prep-deadpool-and-wolverine', 'mcu-prep-eternals',
    ],
  });
  const manifest = await readJson('src/data/curated-lists.json');
  const expectedOrderIds = manifest.lists
    .filter((row) => row.id !== 'shang-chi-master-of-kung-fu-reading-order' && row.id !== 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order' && row.id !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order' && row.id !== id && row.id !== 'nova-reading-order' && row.id !== 'ultimate-spider-man-reading-order' && row.id !== 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide'
      && ![
        'thunderbolts-reading-order',
        'nebula-reading-order',
        'hope-summers-reading-order',

        'x-23-reading-order', 'ms-marvel-kamala-khan-reading-order', 'marvel-zombies-reading-order', 'hawkeye-reading-order', 'silk-cindy-moon-reading-order', 'marvels-infinity-saga-gauntlet-wars-crusade-reading-order',

      ].includes(row.id)).filter((row) => row.id !== 'namor-sub-mariner-reading-order' && row.id !== 'iron-fist-reading-order' && row.id !== 'mcu-prep-daredevil-born-again' && row.id !== 'mcu-prep-deadpool-and-wolverine' && row.id !== 'mcu-prep-eternals' && row.id !== 'spider-man-no-way-home-owner-selected' && row.id !== 'mcu-prep-thunderbolts')
    .map((row) => row.id);

  assert.deepEqual(regenerated, report);
  assert.doesNotThrow(() => validateFrozenPacket(packet, { expectedId: id }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.equal(report.candidateCount, 74);
  assert.equal(report.comparisonCount, 185);
  assert.deepEqual(
    report.comparisons.reduce((counts, row) => {
      counts[row.relationship] = (counts[row.relationship] ?? 0) + 1;
      return counts;
    }, {}),
    { none: 174, partial: 11 },
  );
  assert.deepEqual(new Set(report.comparisons.map((row) => row.orderId)), new Set(expectedOrderIds));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: report.libraryDigest,
    expectedOrderIds,
  }));
});

test('Shadow King inventory lifecycle matches the approved source and relationships', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const record = inventory.find((row) => row.id === id);
  const expectedOverlapIds = report.comparisons
    .filter((row) => row.relationship !== 'none')
    .map((row) => row.orderId)
    .sort();

  assert.ok(record);
  assert.deepEqual(record.overlapIds, expectedOverlapIds);
  assert.deepEqual(
    {
      url: record.url,
      sourceRetrievedAt: record.sourceRetrievedAt,
      sourceContentSha256: record.sourceContentSha256,
      catalogIds: record.catalogIds,
      deliveryStatus: record.deliveryStatus,
      centralDisposition: record.centralDisposition,
    },
    {
      url: packet.sourceUrl,
      sourceRetrievedAt: packet.sourceRetrievedAt,
      sourceContentSha256: packet.sourceContentSha256,
      catalogIds: [report.candidateId],
      deliveryStatus: 'shipped',
      centralDisposition: 'pilot-approved',
    },
  );
});

test('Shadow King publishes the complete checklist, payload and catalog entry', async () => {
  const payload = await readJson(`src/data/${packet.proposedManifest.out}`);
  const markdown = await readFile(path.join(root, 'src/data/orders', `${id}.md`), 'utf8');
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = parseCatalog(await readJson('src/data/catalog.json'));
  const manifestEntry = manifest.lists.find((row) => row.id === id);
  const catalogEntry = catalog.lists.find((row) => row.id === id);
  const parsed = parseChecklist(markdown);

  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));
  assert.equal(parsed.entries.length, 74);
  assert.equal(parsed.unresolved.length, 0);
  assert.equal(payload.items.length, 74);
  assert.equal(payload.items.filter((row) => row.placeholder).length, 0);
  assert.deepEqual(payload.items.map((row) => row.issueId), mapping.rows.map((row) => row.selectedIssueId));
  assert.equal(manifestEntry.expect, 74);
  assert.equal(catalogEntry.count, 74);
  assert.equal(catalogEntry.placeholderCount, 0);
  assert.equal(catalogEntry.emptyRecordCount, 0);
  assert.equal(catalogEntry.coverIssueId, 12433);
  assert.equal(catalogEntry.source, 'https://www.comicbookherald.com/shadow-king-reading-order/');
  assert.equal(catalogEntry.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
});
