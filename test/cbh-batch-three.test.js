import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  THIRD_PACKET_IDS,
  THIRD_SELECTION_IDS,
  existingEntriesForPacket,
  manifestEntryForMapping,
} from '../scripts/author-cbh-packet.mjs';
import { validateBatchNoDuplicates } from '../scripts/lib/cbh-inventory.mjs';
import { parseCatalog, sortCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'src', 'data');
const mappingsDir = path.join(root, 'scripts', 'data', 'cbh-mappings');
const overlapsDir = path.join(root, 'scripts', 'data', 'cbh-overlaps');
const sharedXMenPage = 'https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/x-men-events-from-messiah-complex-to-avengers-vs-x-men-2007-to-2012/';
const laterReviewedIds = new Set([
  'x-men-utopia',
  'guardians-of-the-galaxy-reading-order',
  'inhumans-reading-order',
]);

const EXPECTED_COUNTS = Object.freeze({
  'x-men-divided-we-stand': 48,
  'x-men-manifest-destiny': 19,
  'x-men-nation-x': 20,
  'x-men-curse-of-the-mutants': 18,
  'wolverine-goes-to-hell': 15,
  'x-men-age-of-x': 11,
  'x-men-schism': 7,
  'x-men-regenesis': 43,
  doomwar: 6,
  'spider-island': 13,
});

const EXPECTED_SECTIONS = Object.freeze({
  'x-men-divided-we-stand': 'X-Men: Divided We Stand',
  'x-men-manifest-destiny': 'X-Men: Manifest Destiny',
  'x-men-nation-x': 'X-Men: Nation X',
  'x-men-curse-of-the-mutants': 'Curse of the Mutants',
  'wolverine-goes-to-hell': 'Wolverine Goes to Hell',
  'x-men-age-of-x': 'Age of X',
  'x-men-schism': 'Schism',
  'x-men-regenesis': 'Regenesis',
});

const EXPECTED_SEQUENCE_SHA256 = Object.freeze({
  'x-men-divided-we-stand': 'bbe41d781a0fae4bfe516ad109285c9578b716745c8f5a179d815645d4c2c1eb',
  'x-men-manifest-destiny': 'b6c3f750b0f1e53c47d9490d148bf66d90cc51e2cb017f7e51c20a7e858fc22b',
  'x-men-nation-x': '3966f7b14ab52213e214fe1726f71b60c25575e4da8d92716f60ae69816012d3',
  'x-men-curse-of-the-mutants': 'be4051e9753acaaad86018a3962601047cdac86f690fb7bca9813c696f239cb6',
  'wolverine-goes-to-hell': 'd6bc0cd07f677a4e4970a5c60f675130ee37e56bdcf98cf19e28961b4c743320',
  'x-men-age-of-x': '6e9a1bb07ee07b063befc00a42294103c6b2eea5daf2b42e844e2e7d244c4b52',
  'x-men-schism': 'cf8b1ca3da74b0c97bbde80bb4b1861d50a461a3e1bd3608c13f059271a620e6',
  'x-men-regenesis': '636e82e3f903944ebc03d462512abd7782cd577a6857ec0e484fbcc80f1dfeba',
  doomwar: '6f9067264736310ee5732b73768b2fc0ef9ee7a21b5b48651b1e093e942441e1',
  'spider-island': '99bda7d96e48e7f753cd910b5f524bd01e314cf0d91cba1b2f8708b46b2a7df6',
});

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function mappedIds(mapping) {
  return mapping.rows.map((row) => String(row.selectedIssueId));
}

function sequenceDigest(ids) {
  return createHash('sha256').update(ids.join('|')).digest('hex');
}

function firstOnSale(mapping) {
  const selected = new Set(mappedIds(mapping));
  return mapping.candidateMetadata
    .filter((candidate) => selected.has(String(candidate.id)))
    .map((candidate) => candidate.onSaleDate)
    .filter(Boolean)
    .sort()[0];
}

test('batch three preserves the approved source queue and independently verified shelf chronology', async () => {
  assert.deepEqual(THIRD_SELECTION_IDS, [
    'x-men-divided-we-stand',
    'x-men-manifest-destiny',
    'x-men-nation-x',
    'x-men-curse-of-the-mutants',
    'wolverine-goes-to-hell',
    'x-men-age-of-x',
    'x-men-schism',
    'x-men-regenesis',
    'doomwar',
    'spider-island',
  ]);
  assert.deepEqual(THIRD_PACKET_IDS, [
    'x-men-divided-we-stand',
    'x-men-manifest-destiny',
    'x-men-nation-x',
    'doomwar',
    'x-men-curse-of-the-mutants',
    'wolverine-goes-to-hell',
    'x-men-age-of-x',
    'x-men-schism',
    'spider-island',
    'x-men-regenesis',
  ]);

  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  assert.equal(
    existingEntriesForPacket(manifest.lists, THIRD_PACKET_IDS).length,
    manifest.lists.length - THIRD_PACKET_IDS.length,
  );
  assert.ok(manifest.lists.length >= 66);
  assert.equal(catalog.lists.length, 248);

  const sorted = sortCatalog(parseCatalog(catalog).lists);
  assert.deepEqual(
    sorted.filter((entry) => THIRD_PACKET_IDS.includes(entry.id)).map((entry) => entry.id),
    THIRD_PACKET_IDS,
  );
  assert.deepEqual(
    sorted.filter((entry) => THIRD_PACKET_IDS.includes(entry.id)).map((entry) => entry.timeline),
    [2008, 2008, 2009, 2010, 2010, 2010, 2011, 2011, 2011, 2011],
  );

  const mappings = await Promise.all(THIRD_PACKET_IDS.map((id) => (
    readJson(path.join(mappingsDir, `${id}.json`))
  )));
  assert.deepEqual(mappings.map(firstOnSale), [
    '2008-02-06T00:00:00+0000',
    '2008-04-16T00:00:00+0000',
    '2009-09-02T00:00:00+0000',
    '2010-02-17T00:00:00+0000',
    '2010-07-07T00:00:00+0000',
    '2010-09-01T00:00:00+0000',
    '2011-01-26T00:00:00+0000',
    '2011-07-13T00:00:00+0000',
    '2011-07-27T00:00:00+0000',
    '2011-10-12T00:00:00+0000',
  ]);
});

test('batch three stays exact through mapping, Markdown, payload, catalog, and inventory', async () => {
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbh-modern-inventory.json'));
  const allIds = [];

  for (const id of THIRD_SELECTION_IDS) {
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const approved = manifestEntryForMapping(mapping);
    const manifestEntry = manifest.lists.find((entry) => entry.id === id);
    const catalogEntry = catalog.lists.find((entry) => entry.id === id);
    const markdown = await readFile(path.join(dataDir, 'orders', approved.sourceFile), 'utf8');
    const parsed = parseChecklist(markdown);
    const payload = await readJson(path.join(dataDir, approved.out));
    const expectedIds = mappedIds(mapping);
    const inventoryEntry = inventory.find((entry) => entry.id === mapping.inventoryId);

    assert.equal(mapping.reviewStatus, 'approved');
    assert.equal(
      mapping.packetReview,
      '.copilot-tracking/changes/2026-08-20/modern-marvel-continuity-guides-changes.md',
    );
    assert.equal(mapping.rows.length, EXPECTED_COUNTS[id]);
    assert.equal(sequenceDigest(expectedIds), EXPECTED_SEQUENCE_SHA256[id]);
    assert.equal(new Set(expectedIds).size, expectedIds.length);
    assert.deepEqual(manifestEntry, approved);
    assert.equal(Object.hasOwn(manifestEntry, 'coverSourcePosition'), false);
    assert.equal(Object.hasOwn(manifestEntry, 'coverSourceReference'), false);
    assert.equal(parsed.unresolved.length, 0);
    assert.equal(/^## /m.test(markdown), false);
    assert.doesNotMatch(markdown, /[\u2013\u2014]/);
    assert.deepEqual(parsed.entries.map((entry) => String(entry.issueId)), expectedIds);
    assert.doesNotMatch(JSON.stringify(payload), /[\u2013\u2014]/);
    assert.deepEqual(payload.items.map((item) => String(item.issueId)), expectedIds);
    assert.deepEqual(
      payload.items.map((item) => String(item.number)),
      mapping.rows.map((row) => String(row.issueNumber)),
    );
    assert.equal(payload.count, expectedIds.length);
    assert.equal(payload.placeholders, 0);
    assert.deepEqual(payload.unresolved, []);
    assert.equal(catalogEntry.count, expectedIds.length);
    assert.equal(catalogEntry.source, mapping.sourceUrl);
    assert.equal(catalogEntry.sourceSection ?? null, mapping.sourceSection ?? null);
    assert.equal(payload.sourceSection ?? null, mapping.sourceSection ?? null);
    assert.equal(catalogEntry.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
    assert.equal(catalogEntry.sourceLicense, null);
    assert.equal(catalogEntry.coverIssueId, approved.coverIssueId);
    assert.ok(inventoryEntry);
    assert.equal(inventoryEntry.deliveryStatus, 'shipped');
    assert.equal(inventoryEntry.disposition, 'grouped-variant');
    assert.ok(inventoryEntry.catalogIds.includes(id));
    allIds.push(...expectedIds);
  }

  assert.equal(allIds.length, 200);
  assert.equal(new Set(allIds).size, 200);
});

test('the shared source uses exact page and section identities without invented fragments', async () => {
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const sharedEntries = manifest.lists.filter((entry) => EXPECTED_SECTIONS[entry.id]);

  assert.equal(sharedEntries.length, 8);
  assert.ok(sharedEntries.every((entry) => entry.sourcePage === sharedXMenPage));
  assert.ok(sharedEntries.every((entry) => !entry.sourcePage.includes('#')));
  assert.deepEqual(
    Object.fromEntries(sharedEntries.map((entry) => [entry.id, entry.sourceSection])),
    EXPECTED_SECTIONS,
  );
  assert.equal(new Set(sharedEntries.map((entry) => (
    `${entry.sourcePage}\n${entry.sourceSection}`
  ))).size, 8);
});

test('batch three keeps its original identities, sequence, and no-overlap reports', async () => {
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const packetSet = new Set(THIRD_PACKET_IDS);
  const packetRecords = [];
  const existingRecords = [];

  for (const entry of manifest.lists) {
    const payload = await readJson(path.join(dataDir, entry.out));
    const record = {
      id: entry.id,
      url: entry.sourcePage,
      sourceSection: entry.sourceSection,
      selectedIssueIds: payload.items.map((item) => String(item.issueId)),
      catalogIds: [entry.id],
    };
    if (packetSet.has(entry.id)) packetRecords.push(record);
    else if (!laterReviewedIds.has(entry.id)) existingRecords.push(record);
  }

  assert.equal(packetRecords.length, 10);
  assert.equal(existingRecords.length, manifest.lists.length - packetRecords.length - laterReviewedIds.size);
  assert.doesNotThrow(() => validateBatchNoDuplicates(packetRecords, existingRecords));

  for (const id of THIRD_PACKET_IDS) {
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    assert.equal(report.comparisonCount, 135);
    assert.equal(report.comparisons.length, 135);
    const approved = new Map([
      ['x-men-regenesis', new Map([
        ['white-tiger-ava-ayala', ['partial', 1, ['36485']]],
      ])],
    ]);
    const allowed = approved.get(id) ?? new Map();
    assert.ok(report.comparisons.every((comparison) => {
      const expected = allowed.get(comparison.orderId);
      if (expected) {
        const [relationship, sharedCount, sharedIds] = expected;
        return comparison.relationship === relationship
          && comparison.sharedCount === sharedCount
          && JSON.stringify(comparison.sharedIds) === JSON.stringify(sharedIds);
      }
      return comparison.relationship === 'none'
        && comparison.sharedCount === 0
        && comparison.sharedIds.length === 0;
    }), `${id} has an unapproved overlap`);
  }
});

test('ambiguous source material is resolved by issue evidence rather than omission or duplication', async () => {
  const manifestDestiny = await readJson(path.join(mappingsDir, 'x-men-manifest-destiny.json'));
  const regenesis = await readJson(path.join(mappingsDir, 'x-men-regenesis.json'));
  const spiderIsland = await readJson(path.join(mappingsDir, 'spider-island.json'));

  assert.deepEqual(
    manifestDestiny.rows
      .filter((row) => row.sourceRangeReference?.startsWith('Manifest Destiny anthology material'))
      .map((row) => row.sourceIssueReference),
    [
      'X-Men: Manifest Destiny #1',
      'X-Men: Manifest Destiny #2',
      'X-Men: Manifest Destiny #3',
      'X-Men: Manifest Destiny #4',
      'X-Men: Manifest Destiny #5',
    ],
  );
  assert.equal(manifestDestiny.excludedSourceReferences.length, 1);

  assert.deepEqual(
    regenesis.rows
      .filter((row) => row.seriesId === 14914)
      .map((row) => row.sourceIssueReference),
    ['Uncanny X-Men #1', 'Uncanny X-Men #2', 'Uncanny X-Men #3', 'Uncanny X-Men #4'],
  );
  assert.equal(regenesis.excludedSourceReferences.length, 1);

  assert.equal(spiderIsland.approvedSourceCount, 14);
  assert.equal(spiderIsland.rows.length, 13);
  assert.equal(spiderIsland.rows.some((row) => String(row.selectedIssueId) === '38457'), false);
  assert.deepEqual(spiderIsland.excludedSourceReferences, [
    'Spider-Island Spotlight, a non-story companion magazine whose archived Marvel issue 38457 is absent from the live metadata contract',
  ]);
});
