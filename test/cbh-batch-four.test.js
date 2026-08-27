import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FOURTH_PACKET_IDS,
  FOURTH_SELECTION_IDS,
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
const laterReviewedIds = new Set([
  'captain-marvel-ms-marvel-reading-order',
  'wolverine-reading-order',
  'doctor-strange-reading-order',
  'star-lord-reading-order',
  'thanos-reading-order',
  'amazing-spider-man-reading-order-modern-marvel-era',
  'loki-reading-order',
  'silver-surfer-reading-order',
  'venom-reading-order',
  'moon-knight-reading-order',
  'guardians-of-the-galaxy-reading-order',
]);
const marvelNowPage = 'https://www.comicbookherald.com/the-complete-marvel-reading-order-guide/marvel-now-checklist/';
const xMenPage = 'https://www.comicbookherald.com/question-of-the-week-ok-what-the-heck-is-the-right-order-for-x-men-events/';

const EXPECTED_COUNTS = Object.freeze({
  'minimum-carnage': 6,
  'x-termination': 8,
  'avengers-enemy-within': 5,
  'x-men-battle-of-the-atom': 10,
  'revolutionary-war': 8,
  'x-men-trial-of-jean-grey': 6,
  'monsters-unleashed': 13,
  venomverse: 11,
  'infinity-countdown-wars': 46,
  damnation: 15,
});

const EXPECTED_SECTIONS = Object.freeze({
  'minimum-carnage': 'Minimum Carnage',
  'x-termination': 'X-Termination',
  'avengers-enemy-within': 'Avengers: The Enemy Within',
  'x-men-battle-of-the-atom': 'Battle of the Atom',
  'revolutionary-war': 'Event: Revolutionary War',
  'x-men-trial-of-jean-grey': 'Trial of Jean Grey',
});

const EXPECTED_SEQUENCE_SHA256 = Object.freeze({
  'minimum-carnage': '3226222f01cc0adc4de1835afe4ab2a4470ddc4a2059cee56ae9a9c522139eb1',
  'x-termination': 'be2ec4ad14178e542cd5b14938199879ff57af9037eb2aa0bba2111614d1c379',
  'avengers-enemy-within': 'd2714316c4f0e89d65ac6405587fbe6b8a39c36f5002ee7fd968c48565783021',
  'x-men-battle-of-the-atom': 'f42b84c85f078e4d1c58f8b139b6934640128f21d0d39b8b715d3352a4de3074',
  'revolutionary-war': '96fa7f00b684107f3474112778a9c961413f0667dc16b44583346f2f3f1f28ef',
  'x-men-trial-of-jean-grey': 'dde59e968c2ceab349f0dc567bc6b7dda92e4aeeed661fa4600255187da5e919',
  'monsters-unleashed': 'cf31dd54908628613eba14a61a927cb3339c6d516c7276942728d25facb76487',
  venomverse: '05f23166a1be6d70cbe3a8f13e80c154dfb791779f6fb20450703785d72b49e8',
  'infinity-countdown-wars': '45ba0ef3608d125e2800505c6bbea42ef98a75d08f12edc8efd79ebffa5ef758',
  damnation: '63b3dcc207307975b6c888aaa5787487ea5ed7723491d748c938fb03b8f0e275',
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

test('batch four preserves source order and independently verified shelf chronology', async () => {
  assert.deepEqual(FOURTH_SELECTION_IDS, [
    'minimum-carnage',
    'x-termination',
    'avengers-enemy-within',
    'x-men-battle-of-the-atom',
    'revolutionary-war',
    'x-men-trial-of-jean-grey',
    'monsters-unleashed',
    'venomverse',
    'infinity-countdown-wars',
    'damnation',
  ]);
  assert.deepEqual(FOURTH_PACKET_IDS, FOURTH_SELECTION_IDS);

  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  assert.equal(
    existingEntriesForPacket(manifest.lists, FOURTH_PACKET_IDS).length,
    manifest.lists.length - FOURTH_PACKET_IDS.length,
  );
  assert.ok(manifest.lists.length >= 66);
  assert.equal(catalog.lists.length, 242);

  const sorted = sortCatalog(parseCatalog(catalog).lists);
  assert.deepEqual(
    sorted.filter((entry) => FOURTH_PACKET_IDS.includes(entry.id)).map((entry) => entry.id),
    FOURTH_PACKET_IDS,
  );
  assert.deepEqual(
    sorted.filter((entry) => FOURTH_PACKET_IDS.includes(entry.id)).map((entry) => entry.timeline),
    [2012, 2013, 2013, 2013, 2014, 2014, 2017, 2017, 2018, 2018],
  );

  const mappings = await Promise.all(FOURTH_PACKET_IDS.map((id) => (
    readJson(path.join(mappingsDir, `${id}.json`))
  )));
  assert.deepEqual(mappings.map(firstOnSale), [
    '2012-10-03T00:00:00+0000',
    '2013-03-06T00:00:00+0000',
    '2013-05-15T00:00:00+0000',
    '2013-09-04T00:00:00+0000',
    '2014-01-08T00:00:00+0000',
    '2014-01-22T00:00:00+0000',
    '2017-01-18T00:00:00+0000',
    '2017-06-28T00:00:00+0000',
    '2018-01-03T00:00:00+0000',
    '2018-02-21T00:00:00+0000',
  ]);
});

test('batch four stays exact through mapping, Markdown, payload, catalog, and inventory', async () => {
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const catalog = await readJson(path.join(dataDir, 'catalog.json'));
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbh-modern-inventory.json'));
  const groupedInventoryIds = new Set(['avx-to-marvel-now', 'marvel-now']);
  const allIds = [];

  for (const id of FOURTH_SELECTION_IDS) {
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
    assert.deepEqual(
      payload.items.map((item) => item.title),
      mapping.rows.map((row) => row.resolvedIssueTitle),
    );
    assert.equal(payload.count, expectedIds.length);
    assert.equal(payload.placeholders, 0);
    assert.deepEqual(payload.unresolved, []);
    assert.ok(payload.items.every((item) => item.digitalId != null));
    assert.ok(payload.items.every((item) => item.cover?.path && item.cover?.ext));
    assert.equal(catalogEntry.count, expectedIds.length);
    assert.equal(catalogEntry.source, mapping.sourceUrl);
    assert.equal(catalogEntry.sourceSection ?? null, mapping.sourceSection ?? null);
    assert.equal(payload.sourceSection ?? null, mapping.sourceSection ?? null);
    assert.equal(catalogEntry.sourceOrigin, "Compiled for this project from Comic Book Herald's guide");
    assert.equal(catalogEntry.sourceLicense, null);
    assert.equal(catalogEntry.coverIssueId, approved.coverIssueId);
    assert.ok(catalogEntry.cover?.path && catalogEntry.cover?.ext);
    assert.ok(inventoryEntry);
    assert.equal(inventoryEntry.deliveryStatus, 'shipped');
    assert.equal(
      inventoryEntry.disposition,
      groupedInventoryIds.has(mapping.inventoryId) ? 'grouped-variant' : 'new-order',
    );
    assert.ok(inventoryEntry.catalogIds.includes(id));
    allIds.push(...expectedIds);
  }

  assert.equal(allIds.length, 128);
  assert.equal(new Set(allIds).size, 128);
});

test('six shared-page guides use visible section identities without invented fragments', async () => {
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const packetEntries = manifest.lists.filter((entry) => FOURTH_PACKET_IDS.includes(entry.id));
  const sharedEntries = packetEntries.filter((entry) => EXPECTED_SECTIONS[entry.id]);
  const dedicatedEntries = packetEntries.filter((entry) => !EXPECTED_SECTIONS[entry.id]);

  assert.equal(sharedEntries.length, 6);
  assert.deepEqual(
    Object.fromEntries(sharedEntries.map((entry) => [entry.id, entry.sourceSection])),
    EXPECTED_SECTIONS,
  );
  assert.deepEqual(
    sharedEntries.filter((entry) => entry.sourcePage === marvelNowPage).map((entry) => entry.id),
    ['minimum-carnage', 'x-termination', 'avengers-enemy-within', 'revolutionary-war'],
  );
  assert.deepEqual(
    sharedEntries.filter((entry) => entry.sourcePage === xMenPage).map((entry) => entry.id),
    ['x-men-battle-of-the-atom', 'x-men-trial-of-jean-grey'],
  );
  assert.ok(sharedEntries.every((entry) => !entry.sourcePage.includes('#')));
  assert.equal(new Set(sharedEntries.map((entry) => (
    `${entry.sourcePage}\n${entry.sourceSection}`
  ))).size, 6);
  assert.equal(dedicatedEntries.length, 4);
  assert.ok(dedicatedEntries.every((entry) => !entry.sourceSection));
  assert.equal(new Set(dedicatedEntries.map((entry) => entry.sourcePage)).size, 4);
});

test('batch four has no aggregate identity, source, sequence, or issue overlap', async () => {
  const manifest = await readJson(path.join(dataDir, 'curated-lists.json'));
  const inventory = await readJson(path.join(root, 'scripts', 'data', 'cbh-modern-inventory.json'));
  const packetSet = new Set(FOURTH_PACKET_IDS);
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
  assert.equal(
    existingRecords.length,
    manifest.lists.length - packetRecords.length - laterReviewedIds.size,
  );
  assert.doesNotThrow(() => validateBatchNoDuplicates(packetRecords, existingRecords));

  const packetIssueIds = packetRecords.flatMap((record) => record.selectedIssueIds);
  const existingIssueIds = new Set(existingRecords.flatMap((record) => record.selectedIssueIds));
  const declaredOverlapCatalogIds = new Set([
    'black-widow-reading-order',
    ...inventory.flatMap((record) => (
      record.overlapIds?.some((id) => packetSet.has(id)) ? record.catalogIds : []
    )),
  ]);
  const declaredOverlapIssueIds = new Set(existingRecords
    .filter((record) => declaredOverlapCatalogIds.has(record.id))
    .flatMap((record) => record.selectedIssueIds));
  assert.deepEqual(
    packetIssueIds.filter((id) => existingIssueIds.has(id)),
    packetIssueIds.filter((id) => declaredOverlapIssueIds.has(id)),
  );

  for (const id of FOURTH_PACKET_IDS) {
    const report = await readJson(path.join(overlapsDir, `${id}.json`));
    assert.equal(report.comparisonCount, 135);
    assert.equal(report.comparisons.length, 135);
    const approved = new Map([
      ['infinity-countdown-wars', new Map([
        ['black-widow-reading-order', ['partial', 16, ['66416', '66684', '67022', '67347', '67346', '68653', '68659', '68662', '68663', '68656', '67145', '67147', '67148', '67149', '67150', '67151']]],
        ['hunt-for-wolverine', ['partial', 1, ['66416']]],
        ['star-lord-reading-order', ['partial', 1, ['65547']]],
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

test('the reviewed count boundaries and special issue identities remain explicit', async () => {
  const minimumCarnage = await readJson(path.join(mappingsDir, 'minimum-carnage.json'));
  const monsters = await readJson(path.join(mappingsDir, 'monsters-unleashed.json'));
  const venomverse = await readJson(path.join(mappingsDir, 'venomverse.json'));
  const infinity = await readJson(path.join(mappingsDir, 'infinity-countdown-wars.json'));
  const damnation = await readJson(path.join(mappingsDir, 'damnation.json'));

  assert.equal(minimumCarnage.approvedSourceCount, 6);
  assert.equal(minimumCarnage.rows.length, 6);
  assert.equal(minimumCarnage.rows.some((row) => (
    row.normalizedSeriesTitle === 'Scarlet Spider' && row.issueNumber === '12'
  )), false);
  assert.equal(minimumCarnage.excludedSourceReferences.length, 1);

  const muRows = monsters.rows.filter((row) => row.issueNumber === '1.MU');
  assert.equal(muRows.length, 8);
  assert.ok(muRows.every((row) => row.metadataIssueNumber === '1.1'));
  assert.ok(muRows.every((row) => row.resolvedIssueTitle.endsWith('#1.MU')));
  assert.equal(monsters.rows.find((row) => row.normalizedSeriesTitle === 'Avengers')?.selectedIssueId, 62507);

  assert.equal(venomverse.rows.length, 11);
  assert.equal(venomverse.rows[4].selectedIssueId, 64250);
  assert.equal(venomverse.rows.at(-1).sourceIssueReference, 'Venomverse #5');
  assert.equal(venomverse.excludedSourceReferences.length, 1);

  assert.equal(infinity.approvedSourceCount, 46);
  assert.equal(infinity.rows.length, 46);
  assert.equal(infinity.rows[0].sourceIssueReference, 'Guardians of the Galaxy #150');
  assert.equal(infinity.rows.some((row) => (
    row.seriesId === 23058 && ['146', '147', '148', '149'].includes(row.issueNumber)
  )), false);
  assert.equal(infinity.rows.at(-1).sourceIssueReference, 'Infinity Wars: Infinity #1');
  assert.equal(infinity.excludedSourceReferences.length, 1);

  assert.equal(damnation.rows.length, 15);
  assert.equal(damnation.rows.at(-1).sourceIssueReference, 'Doctor Strange #389');
  assert.equal(damnation.rows.some((row) => row.sourceIssueReference === 'Doctor Strange #390'), false);
  assert.deepEqual(
    damnation.rows
      .filter((row) => row.sourceIssueReference.startsWith('Scarlet Spider #'))
      .map((row) => row.seriesId),
    [23021, 23021, 23021],
  );
});
