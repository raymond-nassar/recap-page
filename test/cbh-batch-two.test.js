import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  APPROVED_SELECTION_IDS,
  BLOCKED_SELECTION_IDS,
  PACKET_IDS,
  SUBSTITUTION_IDS,
  existingEntriesForPacket,
  manifestEntryForMapping,
  mergePacketEntries,
} from '../scripts/author-cbh-packet.mjs';
import { validateBatchNoDuplicates } from '../scripts/lib/cbh-inventory.mjs';
import { parseCatalog, sortCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'src', 'data');
const mappingsDir = path.join(root, 'scripts', 'data', 'cbh-mappings');
const overlapsDir = path.join(root, 'scripts', 'data', 'cbh-overlaps');

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function mappedIds(mapping) {
  return mapping.rows.map((row) => String(row.selectedIssueId));
}

function firstOnSale(mapping) {
  const selected = new Set(mappedIds(mapping));
  return mapping.candidateMetadata
    .filter((candidate) => selected.has(String(candidate.id)))
    .map((candidate) => candidate.onSaleDate)
    .filter(Boolean)
    .sort()[0];
}

test('batch two preserves the approved queue, exact substitutions, and catalog chronology', async () => {
  assert.deepEqual(APPROVED_SELECTION_IDS, [
    'maximum-security',
    'decimation',
    'planet-hulk',
    'annihilation-conquest',
    'war-of-kings',
    'realm-of-kings',
    'thanos-imperative',
    'silent-war',
    'messiah-complex',
    'world-war-hulk',
  ]);
  assert.deepEqual(BLOCKED_SELECTION_IDS, [
    'decimation',
    'realm-of-kings',
    'world-war-hulk',
  ]);
  assert.deepEqual(SUBSTITUTION_IDS, [
    'messiah-war',
    'necrosha',
    'second-coming',
  ]);
  assert.deepEqual(PACKET_IDS, [
    'maximum-security',
    'planet-hulk',
    'silent-war',
    'annihilation-conquest',
    'messiah-complex',
    'war-of-kings',
    'messiah-war',
    'necrosha',
    'second-coming',
    'thanos-imperative',
  ]);

  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  assert.equal(
    existingEntriesForPacket(manifest.lists).length,
    manifest.lists.length - PACKET_IDS.length,
  );
  assert.ok(manifest.lists.length >= 66);
  assert.equal(catalog.lists.length, manifest.lists.length);

  const manifestPacket = manifest.lists.filter((entry) => PACKET_IDS.includes(entry.id));
  const catalogPacket = catalog.lists.filter((entry) => PACKET_IDS.includes(entry.id));
  assert.deepEqual(new Set(manifestPacket.map((entry) => entry.id)), new Set(PACKET_IDS));
  assert.deepEqual(new Set(catalogPacket.map((entry) => entry.id)), new Set(PACKET_IDS));

  const sorted = sortCatalog(parseCatalog(catalog).lists);
  const sortedPacket = sorted.filter((entry) => PACKET_IDS.includes(entry.id));
  assert.deepEqual(sortedPacket.map((entry) => entry.id), PACKET_IDS);
  assert.deepEqual(sortedPacket.map((entry) => entry.timeline), [
    2000, 2006, 2007, 2007, 2007, 2009, 2009, 2009, 2010, 2010,
  ]);
  assert.deepEqual(
    sorted.filter((entry) => entry.timeline >= 2000 && entry.timeline <= 2010).map((entry) => entry.id),
    [
      'maximum-security',
      'avengers-disassembled',
      'secret-war',
      'house-of-m',
      'house-of-m-essential',
      'spider-man-the-other',
      'planet-hulk',
      'civil-war',
      'civil-war-essential',
      'annihilation',
      'civil-war-avengers',
      'silent-war',
      'annihilation-conquest',
      'messiah-complex',
      'world-war-hulk-aftersmash',
      'x-men-divided-we-stand',
      'secret-invasion',
      'secret-invasion-essential',
      'x-men-manifest-destiny',
      'dark-reign-avengers',
      'war-of-kings',
      'messiah-war',
      'x-men-nation-x',
      'necrosha',
      'doomwar',
      'second-coming',
      'thanos-imperative',
      'heroic-age-avengers',
      'x-men-curse-of-the-mutants',
      'shadowland',
      'wolverine-goes-to-hell',
      'chaos-war',
    ],
  );

  const expectedFirstDates = [
    '2000-10-01T00:00:00+0000',
    '2006-02-08T00:00:00+0000',
    '2007-01-24T00:00:00+0000',
    '2007-06-20T00:00:00+0000',
    '2007-10-31T00:00:00+0000',
    '2009-02-04T00:00:00+0000',
    '2009-02-04T00:00:00+0000',
    '2009-10-28T00:00:00+0000',
    '2010-02-24T00:00:00+0000',
    '2010-05-26T00:00:00+0000',
  ];
  const mappings = await Promise.all(PACKET_IDS.map((id) => (
    readJson(path.join(mappingsDir, `${id}.json`))
  )));
  assert.deepEqual(mappings.map(firstOnSale), expectedFirstDates);
});

test('packet chronology rejects a missing insertion anchor', () => {
  assert.throws(
    () => mergePacketEntries([], [{ id: 'maximum-security' }]),
    /catalog chronology anchor avengers-disassembled is missing/i,
  );
});

test('batch two stays exact through mapping, Markdown, generated data, catalog, and inventory', async () => {
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbh-modern-inventory.json'));
  const allIds = [];

  for (const id of PACKET_IDS) {
    const mapping = await readJson(path.join(mappingsDir, `${id}.json`));
    const approved = manifestEntryForMapping(mapping);
    const manifestEntry = manifest.lists.find((entry) => entry.id === id);
    const catalogEntry = catalog.lists.find((entry) => entry.id === id);
    const markdown = await readFile(path.join(dataDir, 'orders', approved.sourceFile), 'utf8');
    const parsed = parseChecklist(markdown);
    const generated = await readJson(path.join(dataDir, approved.out));
    const expectedIds = mappedIds(mapping);
    const inventoryEntry = inventory.find((entry) => entry.id === mapping.inventoryId);

    assert.equal(mapping.reviewStatus, 'approved');
    assert.equal(
      mapping.packetReview,
      '.copilot-tracking/changes/2026-08-20/modern-marvel-continuity-guides-changes.md',
    );
    assert.ok(inventoryEntry, `${id} has no inventory parent`);
    assert.equal(inventoryEntry.deliveryStatus, 'shipped');
    assert.equal(inventoryEntry.disposition, 'grouped-variant');
    assert.ok(inventoryEntry.catalogIds.includes(id), `${id} is absent from its inventory parent`);
    assert.deepEqual(manifestEntry, approved);
    assert.equal(Object.hasOwn(manifestEntry, 'coverSourcePosition'), false);
    assert.equal(Object.hasOwn(manifestEntry, 'coverSourceReference'), false);
    assert.equal(parsed.unresolved.length, 0);
    assert.equal(/^## /m.test(markdown), false);
    assert.deepEqual(parsed.entries.map((entry) => String(entry.issueId)), expectedIds);
    assert.deepEqual(generated.items.map((item) => String(item.issueId)), expectedIds);
    assert.deepEqual(
      generated.items.map((item) => String(item.number)),
      mapping.rows.map((row) => String(row.issueNumber)),
    );
    assert.equal(generated.count, expectedIds.length);
    assert.equal(generated.placeholders, 0);
    assert.deepEqual(generated.unresolved, []);
    assert.equal(catalogEntry.count, expectedIds.length);
    assert.equal(catalogEntry.source, mapping.sourceUrl);
    assert.equal(catalogEntry.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
    assert.equal(catalogEntry.sourceLicense, null);
    assert.equal(catalogEntry.coverIssueId, approved.coverIssueId);
    allIds.push(...expectedIds);
  }

  assert.equal(allIds.length, 178);
  assert.equal(new Set(allIds).size, 178);
});

test('batch two has no aggregate identity, source, sequence, or issue overlap', async () => {
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const packetSet = new Set(PACKET_IDS);
  const packetRecords = [];
  const existingRecords = [];

  for (const entry of manifest.lists) {
    const generated = await readJson(path.join(dataDir, entry.out));
    const record = {
      id: entry.id,
      url: entry.sourcePage,
      selectedIssueIds: generated.items.map((item) => String(item.issueId)),
      catalogIds: [entry.id],
    };
    if (packetSet.has(entry.id)) packetRecords.push(record);
    else existingRecords.push(record);
  }

  assert.equal(packetRecords.length, 10);
  assert.equal(existingRecords.length, manifest.lists.length - packetRecords.length);
  assert.doesNotThrow(() => validateBatchNoDuplicates(packetRecords, existingRecords));

  const packetIssueIds = packetRecords.flatMap((record) => record.selectedIssueIds);
  const existingIssueIds = new Set(existingRecords.flatMap((record) => record.selectedIssueIds));
  assert.deepEqual(packetIssueIds.filter((id) => existingIssueIds.has(id)), []);

  for (const id of PACKET_IDS) {
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    assert.equal(report.comparisonCount, 45);
    assert.equal(report.comparisons.length, 45);
    assert.ok(report.comparisons.every((comparison) => (
      comparison.relationship === 'none'
      && comparison.sharedCount === 0
      && comparison.sharedIds.length === 0
    )), `${id} has an unapproved overlap`);
  }
});

test('blocked approved candidates retain exact blocker evidence', async () => {
  const decimation = await readJson(path.join(mappingsDir, 'decimation.json'));
  const realm = await readJson(path.join(overlapsDir, 'realm-of-kings.json'));
  const worldWarHulk = await readJson(path.join(overlapsDir, 'world-war-hulk.json'));

  assert.equal(decimation.rows.length, 57);
  assert.deepEqual(
    decimation.rows.filter((row) => row.resolutionStatus === 'unmatched')
      .map((row) => row.sourceIssueReference),
    ['Generation M #1', 'Generation M #2', 'Generation M #3', 'Generation M #4', 'Generation M #5'],
  );
  assert.deepEqual(
    realm.comparisons.filter((comparison) => comparison.relationship !== 'none'),
    [{
      orderId: 'war-of-kings',
      sharedCount: 3,
      sharedIds: ['26094', '26095', '26096'],
      relationship: 'partial',
    }],
  );
  assert.deepEqual(
    worldWarHulk.comparisons.filter((comparison) => comparison.relationship !== 'none'),
    [
      {
        orderId: 'civil-war-avengers',
        sharedCount: 2,
        sharedIds: ['15976', '16162'],
        relationship: 'partial',
      },
      {
        orderId: 'world-war-hulk-aftersmash',
        sharedCount: 1,
        sharedIds: ['17231'],
        relationship: 'partial',
      },
    ],
  );
});
