import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approvalDigestFor,
  libraryDigestFor,
  packetDigestFor,
  sourcePositionsForPacket,
  validateFrozenPacket,
  validateInventoryState,
  validateMappingDigest,
  validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { issueIdsFromValue } from '../scripts/lib/cbh-overlap.mjs';
import { placeholderId } from '../scripts/lib/placeholder-id.mjs';
import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import { CBH_LATER_ORDER_IDS } from '../scripts/lib/cbro-evidence.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { addIssuesToList, createEmptyState, createList } from '../src/js/lib/model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const abominationCandidateId = 'abomination-reading-order';
const candidateId = 'white-tiger-ava-ayala';
const blackPantherCandidateId = 'black-panther-reading-order';
const captainMarvelCandidateId = 'captain-marvel-ms-marvel-reading-order';
const batchCandidateIds = ['phalanx-reading-order', 'marvels-best-phoenix-comics'];
const cosmicCandidateId = 'rocket-raccoon-reading-order';
const grootCandidateId = 'groot-reading-order';
const ironManCandidateId = 'iron-man-reading-order';
const hulkCandidateId = 'question-of-the-week-do-you-have-a-hulk-reading-order';
const doctorStrangeCandidateId = 'doctor-strange-reading-order';
const magnetoCandidateId = 'magneto-reading-order';
const starLordCandidateId = 'star-lord-reading-order';
const starLordInventoryId = 'star-lord-reading-order-complete-peter-quill-comics-timeline';
const modernXMenCandidateId = 'modern-x-men-fast-track';
const venomCandidateId = 'venom-reading-order';
function issueRange(series, year, from, to) {
  return Array.from({ length: to - from + 1 }, (_, index) => `${series}|${year}|${from + index}`);
}

const rocketSourceSequence = [
  'Tales to Astonish|1959|13',
  'Incredible Hulk|1962|271',
  ...issueRange('Rocket Raccoon', 1985, 1, 4),
  'Marvel Preview|1975|7',
  ...issueRange('Annihilators', 2010, 1, 4),
  ...issueRange('Annihilators: Earthfall', 2011, 1, 4),
  ...issueRange('Guardians of the Galaxy', 2008, 1, 25),
  ...issueRange('Rocket Raccoon', 2016, 1, 5),
  ...issueRange('Rocket', 2017, 1, 6),
  'Shuri|2018|3',
  ...issueRange('Avengers No Road Home', 2019, 1, 10),
  ...issueRange('Guardians of the Galaxy', 2019, 1, 12),
  'GUARDIANS OF THE GALAXY ANNUAL 1|2019|1',
];

const grootSourceSequence = [
  'Tales to Astonish|1959|13',
  'Incredible Hulk|1962|271',
  ...issueRange('Rocket Raccoon', 1985, 1, 4),
  'Marvel Preview|1975|7',
  ...issueRange('Annihilators', 2010, 1, 4),
  ...issueRange('Annihilators: Earthfall', 2011, 1, 4),
  ...issueRange('Guardians of the Galaxy', 2008, 1, 25),
  ...issueRange('Groot', 2015, 1, 6),
  ...issueRange('Rocket Raccoon', 2014, 1, 11),
  ...issueRange('Rocket Raccoon & Groot', 2016, 1, 10),
  ...issueRange('Annihilation: Conquest - Starlord', 2007, 1, 4),
  'Shuri|2018|3',
  ...issueRange('Groot', 2023, 1, 4),
];

const starLordSourceSequence = [
  'Marvel Preview|1975|4',
  'Marvel Preview|1975|11',
  'Marvel Preview|1975|14',
  'Marvel Preview|1975|15',
  'Marvel Preview|1975|18',
  'Marvel Comics Super Special|1977|10',
  'Marvel Spotlight|1979|6',
  'Marvel Spotlight|1979|7',
  'Marvel Premiere|1972|61',
  'Starlord|1996|1',
  'Starlord|1996|2',
  'Starlord|1996|3',
  'Guardians of the Galaxy|2008|1',
  'Guardians of the Galaxy|2008|2',
  'Guardians of the Galaxy|2008|3',
  'Guardians of the Galaxy|2008|4',
  'Guardians of the Galaxy|2008|5',
  'Guardians of the Galaxy|2008|6',
  'Guardians of the Galaxy|2008|7',
  'Guardians of the Galaxy|2008|8',
  'Guardians of the Galaxy|2008|9',
  'Guardians of the Galaxy|2008|10',
  'Guardians of the Galaxy|2008|11',
  'Guardians of the Galaxy|2008|12',
  'Guardians of the Galaxy|2008|13',
  'Guardians of the Galaxy|2008|14',
  'Guardians of the Galaxy|2008|15',
  'Guardians of the Galaxy|2008|16',
  'Guardians of the Galaxy|2008|17',
  'Guardians of the Galaxy|2008|18',
  'Guardians of the Galaxy|2008|19',
  'Guardians of the Galaxy|2008|20',
  'Guardians of the Galaxy|2008|21',
  'Guardians of the Galaxy|2008|22',
  'Guardians of the Galaxy|2008|23',
  'Guardians of the Galaxy|2008|24',
  'Guardians of the Galaxy|2008|25',
  'Legendary Star-Lord|2014|1',
  'Legendary Star-Lord|2014|2',
  'Legendary Star-Lord|2014|3',
  'Legendary Star-Lord|2014|4',
  'Legendary Star-Lord|2014|5',
  'Legendary Star-Lord|2014|6',
  'Legendary Star-Lord|2014|7',
  'Legendary Star-Lord|2014|8',
  'Legendary Star-Lord|2014|9',
  'Legendary Star-Lord|2014|10',
  'Star-Lord and Kitty Pryde|2015|1',
  'Star-Lord and Kitty Pryde|2015|2',
  'Star-Lord and Kitty Pryde|2015|3',
  'Star-Lord|2015|1',
  'Star-Lord|2015|2',
  'Star-Lord|2015|3',
  'Star-Lord|2015|4',
  'Star-Lord|2015|5',
  'Star-Lord|2015|6',
  'Star-Lord|2015|7',
  'Star-Lord|2015|8',
  'Star-Lord|2016|1',
  'Star-Lord|2016|2',
  'Star-Lord|2016|3',
  'Star-Lord|2016|4',
  'Star-Lord|2016|5',
  'Star-Lord|2016|6',
  'Free Comic Book Day|2017|1',
  'All-New Guardians of the Galaxy|2017|1',
  'All-New Guardians of the Galaxy|2017|2',
  'All-New Guardians of the Galaxy|2017|4',
  'All-New Guardians of the Galaxy|2017|6',
  'All-New Guardians of the Galaxy|2017|8',
  'All-New Guardians of the Galaxy|2017|10',
  'All-New Guardians of the Galaxy|2017|3',
  'All-New Guardians of the Galaxy|2017|5',
  'All-New Guardians of the Galaxy|2017|7',
  'All-New Guardians of the Galaxy|2017|9',
  'All-New Guardians of the Galaxy|2017|11',
  'All-New Guardians of the Galaxy|2017|12',
  'All-New Guardians of the Galaxy|2017|146',
  'All-New Guardians of the Galaxy|2017|147',
  'All-New Guardians of the Galaxy|2017|148',
  'All-New Guardians of the Galaxy|2017|149',
  'All-New Guardians of the Galaxy|2017|150',
  'The Mighty Captain Marvel|2017|125',
  'The Mighty Captain Marvel|2017|126',
  'The Mighty Captain Marvel|2017|127',
  'The Mighty Captain Marvel|2017|128',
  'The Mighty Captain Marvel|2017|129',
  'Old Man Quill|2019|1',
  'Old Man Quill|2019|2',
  'Old Man Quill|2019|3',
  'Old Man Quill|2019|4',
  'Old Man Quill|2019|5',
  'Old Man Quill|2019|6',
  'Old Man Quill|2019|7',
  'Old Man Quill|2019|8',
  'Old Man Quill|2019|9',
  'Old Man Quill|2019|10',
  'Old Man Quill|2019|11',
  'Old Man Quill|2019|12',
];

function assertRocketSourceBoundary(packet) {
  assert.equal(packet.rows.length, 75);
  assert.deepEqual(
    packet.rows.map((row) => (
      `${row.normalizedSeriesTitle}|${row.seriesYear}|${row.issueNumber}`
    )),
    rocketSourceSequence,
  );
}
function assertGrootSourceBoundary(packet) {
  assert.equal(
    packet.sourceIssueBearingBlocksSha256,
    '2f73854ba172a902a511cb2ae45ee4236bf81367166126667370c482c26478e3',
  );
  assert.equal(packet.sourceRetrievedAt, '2026-08-23');
  assert.equal(packet.sourceOccurrenceCount, 84);
  assert.equal(packet.repeatedSourceReferences.length, 8);
  assert.deepEqual(
    packet.repeatedSourceReferences.map(({ sourcePosition, canonicalRow }) => ({
      sourcePosition,
      canonicalRow,
    })),
    Array.from({ length: 8 }, (_, index) => ({
      sourcePosition: 72 + index,
      canonicalRow: 8 + index,
    })),
  );
  assert.equal(packet.excludedSourceReferences.some((entry) => /already represented/i.test(entry)), false);
  assert.equal(packet.rows.length, 76);
  assert.deepEqual(
    packet.rows.map((row) => (
      `${row.normalizedSeriesTitle}|${row.seriesYear}|${row.issueNumber}`
    )),
    grootSourceSequence,
  );
}

function assertStarLordSourceBoundary(packet) {
  assert.equal(
    packet.sourceIssueBearingBlocksSha256,
    '8e604a0e5f77a1d927be683aa5325da0ede70a658dacf9b7d0661f4213813aa8',
  );
  assert.equal(packet.sourceRetrievedAt, '2026-08-23');
  assert.equal(packet.rows.length, 99);
  assert.deepEqual(
    packet.rows.map((row) => (
      `${row.normalizedSeriesTitle}|${row.seriesYear}|${row.issueNumber}`
    )),
    starLordSourceSequence,
  );
}

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

async function libraryDigestForScope(manifest, excludedIds) {
  const excluded = new Set(excludedIds);
  const lists = manifest.lists.filter((entry) => !excluded.has(entry.id));
  const paths = (manifest.paths ?? []).filter((entry) => (
    !excluded.has(entry.id)
    && !entry.steps?.some((step) => excluded.has(step))
  ));
  const orderIssueIds = await Promise.all(lists.map(async (entry) => {
    const payload = await readJson(path.join('src', 'data', entry.out || `${entry.id}.json`));
    return {
      id: entry.id,
      issueIds: issueIdsFromValue(payload),
    };
  }));
  return libraryDigestFor({ ...manifest, lists, paths }, orderIssueIds);
}

async function historicalReportLibraryDigest(manifest, excludedIds) {
  return libraryDigestForScope(manifest, [
    ...excludedIds,
    'loki-reading-order',
    'silver-surfer-reading-order',
  ]);
}

async function currentPublicationLibraryDigest(manifest, excludedIds) {
  return libraryDigestForScope(manifest, [...excludedIds, ...CBH_LATER_ORDER_IDS]);
}

test('spotlight taxonomy does not rewrite frozen issue-library evidence', () => {
  const manifest = {
    version: 1,
    lists: [{
      id: 'example-character',
      type: 'character-run',
      title: 'Example Character',
    }],
  };
  const classified = {
    ...manifest,
    lists: manifest.lists.map((entry) => ({ ...entry, spotlightKind: 'best-of' })),
  };
  const issueIds = [{ id: 'example-character', issueIds: ['1', '2'] }];

  assert.equal(libraryDigestFor(classified, issueIds), libraryDigestFor(manifest, issueIds));
  assert.notEqual(
    libraryDigestFor({
      ...manifest,
      lists: manifest.lists.map((entry) => ({ ...entry, title: 'Changed Character' })),
    }, issueIds),
    libraryDigestFor(manifest, issueIds),
  );
});

test('the character inventory preserves every central disposition, ships twenty-one spotlights, and prepares five', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  assert.doesNotThrow(() => validateInventoryState(inventory));
  assert.equal(inventory.length, 128);
  assert.equal(new Set(inventory.map((record) => record.id)).size, 128);
  assert.equal(new Set(inventory.map((record) => record.url)).size, 128);

  const dispositionCounts = inventory.reduce((counts, record) => {
    counts[record.centralDisposition] = (counts[record.centralDisposition] ?? 0) + 1;
    return counts;
  }, {});
  assert.equal(dispositionCounts.deferred, 94);
  assert.equal(dispositionCounts.excluded, 7);
  assert.equal(dispositionCounts.blocked, 1);
  assert.equal(dispositionCounts['pilot-approved'], 26);

  const shipped = inventory.filter((record) => record.deliveryStatus === 'shipped');
  assert.deepEqual(shipped.map((record) => record.id), [
    abominationCandidateId,
    'adam-warlock-reading-order',
    'agatha-harkness-reading-order',
    'amazing-spider-man-reading-order-modern-marvel-era',
    'ant-man-reading-order',
    'captain-america-reading-order-modern-marvel-era',
    'daredevil-reading-order',
    'deadpool-reading-order',
    'doctor-strange-reading-order',
    grootCandidateId,
    hulkCandidateId,
    ironManCandidateId,
    'loki-reading-order',
    magnetoCandidateId,
    'phalanx-reading-order',
    'marvels-best-phoenix-comics',
    'rocket-raccoon-reading-order',
    starLordInventoryId,
    'the-complete-thanos-reading-order-guide',
    'white-tiger-ava-ayala',
    'wolverine-reading-order',
  ]);
  const ready = inventory.find((record) => record.id === 'black-panther-reading-order');
  assert.equal(ready?.centralDisposition, 'pilot-approved');
  assert.equal(ready?.deliveryStatus, 'ready');
  const punisher = inventory.find((record) => record.id === 'punisher-reading-order');
  assert.equal(punisher?.centralDisposition, 'pilot-approved');
  assert.equal(punisher?.deliveryStatus, 'ready');
  const venom = inventory.find((record) => record.id === venomCandidateId);
  assert.equal(venom?.centralDisposition, 'pilot-approved');
  assert.equal(venom?.deliveryStatus, 'ready');
  const magneto = inventory.find((record) => record.id === magnetoCandidateId);
  assert.equal(magneto?.centralDisposition, 'pilot-approved');
  assert.equal(magneto?.deliveryStatus, 'shipped');
  const silverSurfer = inventory.find((record) => record.id === 'silver-surfer-reading-order');
  assert.equal(silverSurfer?.centralDisposition, 'pilot-approved');
  assert.equal(silverSurfer?.deliveryStatus, 'ready');
  const shippedById = new Map(shipped.map((record) => [record.id, record]));
  assert.deepEqual(shippedById.get('daredevil-reading-order').catalogIds, ['daredevil-reading-order']);
  assert.deepEqual(shippedById.get(abominationCandidateId).catalogIds, [abominationCandidateId]);
  assert.deepEqual(shippedById.get(abominationCandidateId).overlapIds, [
    'atlantis-attacks',
    'essential-avengers',
    'maximum-security',
  ]);
  assert.deepEqual(
    shippedById.get('amazing-spider-man-reading-order-modern-marvel-era').catalogIds,
    ['amazing-spider-man-reading-order-modern-marvel-era'],
  );
  assert.deepEqual(
    shippedById.get('amazing-spider-man-reading-order-modern-marvel-era').overlapIds,
    [
      'spider-man-best-of', 'hickman-full', 'spider-man-no-way-home', 'spider-verse',
      'original-clone-saga', 'spider-geddon', 'dark-web', 'spider-man-identity-crisis',
      'civil-war', 'civil-war-essential', 'kravens-last-hunt', 'civil-war-avengers',
      'doctor-doom-primer', 'inferno', 'war-of-the-realms', 'house-of-m', 'secret-war',
      'damnation', 'secret-wars-ii', 'maximum-security', 'absolute-carnage',
      'white-tiger-ava-ayala', 'the-night-gwen-stacy-died', 'monsters-unleashed',
      'new-ultimate-universe', 'new-ultimate-universe-trades', 'judgment-day',
      'xmen-claremont-complete', 'eighth-day', 'evolutionary-war', 'atlantis-attacks',
      'heroic-age-avengers',
    ],
  );
  assert.deepEqual(shippedById.get('phalanx-reading-order').catalogIds, ['phalanx-reading-order']);
  assert.deepEqual(
    shippedById.get('phalanx-reading-order').overlapIds,
    ['xmen-claremont', 'xmen-claremont-complete'],
  );
  assert.deepEqual(shippedById.get(grootCandidateId).catalogIds, [grootCandidateId]);
  assert.deepEqual(shippedById.get(grootCandidateId).overlapIds, [
    'annihilation-conquest',
    cosmicCandidateId,
    starLordCandidateId,
    'war-of-kings',
  ]);
  assert.deepEqual(shippedById.get(starLordInventoryId).catalogIds, [starLordCandidateId]);
  assert.deepEqual(shippedById.get(starLordInventoryId).overlapIds, [
    cosmicCandidateId,
    grootCandidateId,
    'infinity-countdown-wars',
    'war-of-kings',
  ]);
  assert.deepEqual(
    shippedById.get('marvels-best-phoenix-comics').catalogIds,
    ['marvels-best-phoenix-comics'],
  );
  assert.deepEqual(shippedById.get('marvels-best-phoenix-comics').overlapIds, ['thanos-reading-order']);
  assert.deepEqual(shippedById.get(cosmicCandidateId).catalogIds, [cosmicCandidateId]);
  assert.deepEqual(shippedById.get(cosmicCandidateId).overlapIds, [
    'groot-reading-order',
    'marvel-fresh-start-avengers',
    'scarlet-witch-best-of',
    'star-lord-reading-order',
    'thanos-reading-order',
    'war-of-kings',
  ]);
  assert.deepEqual(shippedById.get(candidateId).catalogIds, [candidateId]);
  assert.deepEqual(shippedById.get(candidateId).overlapIds, [
    'all-new-all-different-avengers',
    'axis',
    'hickman-full',
    'x-men-regenesis',
  ]);
});

test('Daredevil publishes the audited full-page guide without hiding provider gaps', async () => {
  const id = 'daredevil-reading-order';
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
  const generated = await readJson('src/data/daredevil_reading_order.json');
  const markdown = await readFile(path.join(root, `src/data/orders/${id}.md`), 'utf8');
  const record = inventory.find((candidate) => candidate.id === id);
  const parsed = parseChecklist(markdown);

  assert.equal(record.deliveryStatus, 'shipped');
  assert.equal(record.centralDisposition, 'pilot-approved');
  assert.deepEqual(record.catalogIds, [id]);
  assert.equal(manifest.lists.some((entry) => entry.id === id), true);
  assert.equal(catalog.lists.find((entry) => entry.id === id).count, 876);
  assert.equal(catalog.lists.find((entry) => entry.id === id).coverIssueId, 8073);
  assert.equal(Object.hasOwn(packet, 'sourceGroups'), false);
  assert.equal(Object.hasOwn(mapping, 'sourceGroups'), false);
  assert.equal(packet.sourceReview.authorityIdentity, 'GPT-5.6 Terra');
  assert.equal(packet.proposedManifest.coverIssueId, 8073);
  assert.equal(mapping.approvedManifest.coverIssueId, 8073);
  assert.equal(packet.sourceOccurrenceCount, 909);
  assert.equal(packet.rows.length, 868);
  assert.equal(packet.repeatedSourceReferences.length, 33);
  assert.equal(packet.sourceGaps.length, 8);
  assert.equal(report.comparisonCount, 153);
  assert.equal(mapping.relationshipReview.dispositions.length, 153);
  assert.ok(packet.rows.every((row) => typeof row.sourceGroup === 'string' && row.sourceGroup));
  assert.ok(packet.sourceGaps.every((gap) => typeof gap.sourceGroup === 'string' && gap.sourceGroup));
  assert.equal(
    packet.sourceGaps.find((gap) => gap.sourcePosition === 867).sourceIssueReference,
    'Marvel Team-Up #56',
  );
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: id,
    inventoryRecord: record,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.deepEqual(
    parsed.entries.map((entry) => String(entry.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.deepEqual(
    generated.items.filter((item) => !item.placeholder).map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.equal(generated.items.find((item) => item.issueId === 8073).cover.path.length > 0, true);
  assert.equal(generated.count, 876);
  assert.equal(generated.placeholders, 8);
  assert.deepEqual(
    generated.unresolved.map((gap) => gap.title),
    packet.sourceGaps.map((gap) => gap.sourceIssueReference),
  );
});

test('the Black Panther packet preserves the full source ledger through publication evidence', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson(`scripts/data/cbh-packets/${blackPantherCandidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${blackPantherCandidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${blackPantherCandidateId}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/black_panther_reading_order.json');
  const markdown = await readFile(path.join(root, 'src/data/orders/black-panther-reading-order.md'), 'utf8');
  const inventoryRecord = inventory.find((record) => record.id === blackPantherCandidateId);
  const catalogEntry = manifest.lists.find((entry) => entry.id === blackPantherCandidateId);
  const parsed = parseChecklist(markdown);

  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: blackPantherCandidateId,
    inventoryRecord,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.equal(packet.sourceOccurrenceCount, 424);
  assert.equal(packet.rows.length, 363);
  assert.equal(packet.repeatedSourceReferences.length, 57);
  assert.equal(packet.sourceGaps.length, 4);
  assert.deepEqual(packet.sourceGaps.map((gap) => gap.sourcePosition), [292, 338, 339, 340]);
  assert.equal(mapping.rows.length, 363);
  assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
  assert.equal(mapping.candidateMetadata.length, 363);
  assert.equal(report.candidateCount, 363);
  assert.equal(report.comparisonCount, 150);
  assert.equal(report.comparisons.filter((comparison) => comparison.relationship === 'partial').length, 9);
  assert.equal(catalogEntry.expect, 367);
  assert.equal(catalogEntry.coverIssueId, 13258);
  const catalogList = catalog.lists.find((entry) => entry.id === blackPantherCandidateId);
  assert.equal(catalogEntry.out, 'black_panther_reading_order.json');
  assert.equal(catalogList.file, 'black_panther_reading_order.json');
  assert.equal(catalogList.count, 367);
  assert.equal(generated.count, 367);
  assert.equal(generated.items.filter((item) => item.issueId > 0).length, 363);
  assert.equal(generated.items.filter((item) => item.issueId < 0).length, 4);
  assert.equal(generated.placeholders, 4);
  await assert.rejects(
    readFile(path.join(root, 'src', 'data', 'black-panther-reading-order.json'), 'utf8'),
    { code: 'ENOENT' },
  );
  assert.equal(parsed.entries.length, 363);
  assert.equal(parsed.unresolved.length, 4);
  assert.match(markdown, /^## Introductory prose$/m);
  assert.match(markdown, /^## Latest Additions$/m);
});

test('the Punisher guide preserves its full source ledger through publication', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson('scripts/data/cbh-packets/punisher-reading-order.json');
  const mapping = await readJson('scripts/data/cbh-mappings/punisher-reading-order.json');
  const report = await readJson('scripts/data/cbh-overlaps/punisher-reading-order.json');
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/punisher_reading_order.json');
  const markdown = await readFile(path.join(root, 'src/data/orders/punisher-reading-order.md'), 'utf8');
  const inventoryRecord = inventory.find((record) => record.id === 'punisher-reading-order');
  const parsed = parseChecklist(markdown);
  const regeneratedReport = await buildReportForMapping(
    path.join(root, 'scripts', 'data', 'cbh-mappings', 'punisher-reading-order.json'),
    [],
    { excludedOrderIds: [magnetoCandidateId, 'loki-reading-order', 'silver-surfer-reading-order'] },
  );
  const reviewedLibraryDigest = await historicalReportLibraryDigest(
    manifest,
    ['punisher-reading-order', magnetoCandidateId],
  );

  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: 'punisher-reading-order',
    inventoryRecord,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  const exactPositions = sourcePositionsForPacket(packet);
  const repeatedPositions = packet.repeatedSourceReferences.map((reference) => reference.sourcePosition);
  const gapPositions = packet.sourceGaps.map((gap) => gap.sourcePosition);
  const excludedPositions = packet.excludedSourceRows.map((row) => row.sourcePosition);
  const allPositions = [
    ...exactPositions,
    ...repeatedPositions,
    ...gapPositions,
    ...excludedPositions,
  ];

  assert.equal(packet.sourceOccurrenceCount, 857);
  assert.equal(packet.rows.length, 480);
  assert.equal(packet.repeatedSourceReferences.length, 145);
  assert.equal(packet.sourceGaps.length, 158);
  assert.equal(packet.excludedSourceRows.length, 74);
  assert.equal(new Set([
    ...packet.rows,
    ...packet.sourceGaps,
  ].map((entry) => entry.sourceGroup).filter(Boolean)).size, 11);
  assert.deepEqual(
    mapping.rows.map((row) => row.sourcePosition),
    packet.rows.map((row) => row.sourcePosition),
  );
  assert.deepEqual(
    mapping.rows.map((row) => row.sourceGroup),
    packet.rows.map((row) => row.sourceGroup),
  );
  assert.ok(packet.sourceGaps.every((gap) => gap.normalizedSeriesTitle && gap.issueNumber));
  const sourceLedger = [
    ...packet.rows,
    ...packet.repeatedSourceReferences,
    ...packet.sourceGaps,
    ...packet.excludedSourceRows,
  ].sort((left, right) => left.sourcePosition - right.sourcePosition);
  assert.deepEqual(
    sourceLedger.slice(0, 13).map((entry) => entry.sourceIssueReference),
    [
      'Punisher: Back to the War Omnibus (trade header)',
      'Amazing Spider-Man (1963) #129',
      'Amazing Spider-Man (1963) #134',
      'Amazing Spider-Man (1963) #135',
      'Amazing Spider-Man (1963) #161',
      'Amazing Spider-Man (1963) #162',
      'Amazing Spider-Man (1963) #174',
      'Amazing Spider-Man (1963) #175',
      'Amazing Spider-Man (1963) #201',
      'Amazing Spider-Man (1963) #202',
      'Amazing Spider-Man Annual (1964) #15',
      'Marvel Preview (1975) #2',
      'Marvel Super Action (1975) #1',
    ],
  );
  const jasonAaronGaps = packet.sourceGaps.filter(
    (gap) => gap.sourceGroup === "III) Jason Aaron's Punisher MAX",
  );
  assert.deepEqual(
    jasonAaronGaps.map((gap) => gap.sourceIssueReference),
    Array.from({ length: 22 }, (_, index) => `Punisher MAX (2009) #${index + 1}`),
  );
  assert.deepEqual(
    packet.sourceGaps
      .filter((gap) => gap.normalizedSeriesTitle === 'Punisher Presents: Barracuda MAX')
      .map((gap) => [gap.sourcePosition, gap.sourceIssueReference, gap.seriesYear, gap.kind, gap.status]),
    Array.from({ length: 5 }, (_, index) => [
      392 + index,
      `Punisher Presents: Barracuda MAX (2007) #${index + 1}`,
      2007,
      'published-metadata-gap',
      'open',
    ]),
  );
  assert.deepEqual(
    packet.repeatedSourceReferences
      .filter((reference) => Object.hasOwn(reference, 'canonicalGapPosition'))
      .map((reference) => [reference.sourcePosition, reference.canonicalGapPosition]),
    [
      [571, 436],
      ...Array.from({ length: 22 }, (_, index) => [572 + index, 549 + index]),
    ],
  );
  assert.equal(packet.sourceReview.authorityIdentity, 'GPT-5.6 Terra');
  assert.equal(
    packet.excludedSourceRows.filter((row) => row.sourceIssueReference.includes('trade header')).length,
    58,
  );
  assert.equal(packet.excludedSourceRows.filter((row) => (
    /(section header|section marker|series intro|cross-link)/.test(row.sourceIssueReference)
  )).length, 9);
  assert.equal(packet.excludedSourceRows.filter((row) => row.sourceIssueReference.includes('DC co-publication')).length, 2);
  assert.equal(packet.excludedSourceRows.filter((row) => (
    /(trade header|section header|section marker|series intro|cross-link|DC co-publication)/.test(
      row.sourceIssueReference,
    )
  )).length, 69);
  assert.equal(packet.excludedSourceRows.filter((row) => (
    !/(trade header|section header|section marker|series intro|cross-link|DC co-publication)/.test(
      row.sourceIssueReference,
    )
  )).length, 5);
  assert.deepEqual(
    packet.excludedSourceRows
      .filter((row) => !/(trade header|section header|section marker|series intro|cross-link|DC co-publication)/.test(
        row.sourceIssueReference,
      ))
      .map(({ sourcePosition, sourceIssueReference, reason }) => ({
        sourcePosition,
        sourceIssueReference,
        reason,
      })),
    [
      {
        sourcePosition: 782,
        sourceIssueReference: 'Punisher: World War Frank',
        reason: 'The source names the collection but supplies neither an issue number nor a Collects statement, so it does not identify a publishable issue.',
      },
      {
        sourcePosition: 783,
        sourceIssueReference: 'Cosmic Ghost Rider',
        reason: 'The source names the collection but supplies neither an issue number nor a Collects statement, so it does not identify a publishable issue.',
      },
      {
        sourcePosition: 784,
        sourceIssueReference: 'War of the Realms',
        reason: 'The source names the event but supplies neither an issue number nor a Collects statement, so it does not identify a publishable issue.',
      },
      {
        sourcePosition: 785,
        sourceIssueReference: 'Punisher: Kill Krew',
        reason: 'The source names the collection but supplies neither an issue number nor a Collects statement, so it does not identify a publishable issue.',
      },
      {
        sourcePosition: 792,
        sourceIssueReference: 'Punisher/Captain America: Blood & Glory (1992)',
        reason: 'The source names the crossover but supplies neither an issue number nor a Collects statement, so it does not identify a publishable issue.',
      },
    ],
  );
  assert.equal(mapping.rows.length, 480);
  assert.equal(mapping.approvedSourceCount, 857);
  assert.equal(report.candidateCount, 480);
  assert.equal(report.comparisonCount, 156);
  assert.equal(report.comparisonCount, manifest.lists.length - 4);
  assert.deepEqual(regeneratedReport, report);
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));
  assert.equal(parsed.entries.length, 480);
  assert.equal(parsed.unresolved.length, 158);
  assert.equal(generated.count, 638);
  assert.equal(generated.items.filter((item) => item.issueId > 0).length, 480);
  assert.equal(generated.placeholders, 158);
  assert.equal(new Set(generated.items.map((item) => item.issueId)).size, 638);
  assert.deepEqual(
    generated.items
      .filter((item) => item.title.startsWith('Punisher Presents: Barracuda MAX'))
      .map((item) => [item.title, item.placeholder]),
    Array.from({ length: 5 }, (_, index) => [
      `Punisher Presents: Barracuda MAX (2007) #${index + 1}`,
      true,
    ]),
  );
  assert.equal(catalog.lists.find((entry) => entry.id === 'punisher-reading-order').count, 638);
  assert.equal(new Set(allPositions).size, allPositions.length);
  assert.deepEqual(
    [...allPositions].sort((left, right) => left - right),
    Array.from({ length: packet.sourceOccurrenceCount }, (_, index) => index + 1),
  );
  const missingCanonicalPosition = structuredClone(packet);
  delete missingCanonicalPosition.rows[0].sourcePosition;
  missingCanonicalPosition.packetDigest = packetDigestFor(missingCanonicalPosition);
  assert.throws(
    () => validateFrozenPacket(missingCanonicalPosition),
    /must either all define sourcePosition or all omit it/i,
  );
  const duplicateCanonicalPosition = structuredClone(packet);
  duplicateCanonicalPosition.rows[0].sourcePosition = packet.sourceGaps[0].sourcePosition;
  duplicateCanonicalPosition.packetDigest = packetDigestFor(duplicateCanonicalPosition);
  assert.throws(
    () => validateFrozenPacket(duplicateCanonicalPosition),
    /source position .* is used more than once/i,
  );
  assert.equal(inventoryRecord?.deliveryStatus, 'ready');
  assert.equal(inventoryRecord?.centralDisposition, 'pilot-approved');
  assert.match(markdown, /^## Punisher: Back to the War Omnibus$/m);
  assert.match(markdown, /^## Punisher War Journal by Carl Potts & Jim Lee$/m);
  assert.match(markdown, /Marvel Super Action \(1975\) #1/);
});

test('the Doctor Strange guide preserves its complete source ledger through publication', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson(`scripts/data/cbh-packets/${doctorStrangeCandidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${doctorStrangeCandidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${doctorStrangeCandidateId}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/doctor_strange_reading_order.json');
  const markdown = await readFile(
    path.join(root, 'src/data/orders/doctor-strange-reading-order.md'),
    'utf8',
  );
  const inventoryRecord = inventory.find((record) => record.id === doctorStrangeCandidateId);
  const manifestEntry = manifest.lists.find((entry) => entry.id === doctorStrangeCandidateId);
  const catalogEntry = catalog.lists.find((entry) => entry.id === doctorStrangeCandidateId);
  const parsed = parseChecklist(markdown);
  const reviewedLibraryDigest = await currentPublicationLibraryDigest(manifest, [
    doctorStrangeCandidateId,
  ]);

  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: doctorStrangeCandidateId,
    inventoryRecord,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));

  assert.equal(packet.sourceOccurrenceCount, 932);
  assert.equal(packet.rows.length, 711);
  assert.equal(packet.sourceGaps.length, 39);
  assert.equal(packet.repeatedSourceReferences.length, 181);
  assert.equal(packet.excludedSourceRows.length, 1);
  assert.equal(new Set(
    [...packet.rows, ...packet.sourceGaps].map((entry) => entry.sourceGroup),
  ).size, 72);
  assert.match(packet.sourceBoundary, /all 76 issue-bearing blocks/);
  assert.equal(
    packet.sourceBoundary.match(/\b(?:I|II|III|IV|V|VI|VII|VIII)\)/g)?.length,
    8,
  );
  assert.match(packet.sourceBoundary, /Latest Additions:/);
  assert.equal(mapping.rows.length, 711);
  assert.equal(mapping.sourceGaps.length, 39);
  assert.equal(mapping.candidateMetadata.length, 711);
  assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
  assert.equal(report.candidateCount, 711);
  assert.equal(report.comparisonCount, 136);
  assert.equal(mapping.relationshipReview.dispositions.length, 136);
  assert.equal(report.comparisons.filter((comparison) => comparison.relationship === 'none').length, 112);
  assert.equal(report.comparisons.filter((comparison) => comparison.relationship === 'existing-subset').length, 3);
  assert.equal(report.comparisons.filter((comparison) => comparison.relationship === 'partial').length, 21);
  assert.equal(manifestEntry.expect, 750);
  assert.equal(manifestEntry.spotlightKind, 'complete-guide');
  assert.equal(catalogEntry.count, 750);
  assert.equal(generated.count, 750);
  assert.equal(generated.items.filter((item) => item.issueId > 0).length, 711);
  assert.equal(generated.items.filter((item) => item.issueId < 0).length, 39);
  assert.equal(generated.placeholders, 39);
  assert.equal(parsed.entries.length, 711);
  assert.equal(parsed.unresolved.length, 39);
  assert.deepEqual(
    generated.items.filter((item) => item.issueId > 0).map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.match(markdown, /^## I\) Dr\. Strange Origins and The 1960's \| Collects:/m);
  assert.match(markdown, /^## Latest Additions:/m);
  const doctorIndex = manifest.lists.findIndex((entry) => entry.id === doctorStrangeCandidateId);
  assert.equal(manifest.lists[doctorIndex - 1].id, hulkCandidateId);
  assert.equal(manifest.lists[doctorIndex + 1].id, 'daredevil-reading-order');
  assert.equal(manifest.lists[doctorIndex + 2].id, venomCandidateId);
  assert.equal(manifest.lists[doctorIndex + 3].id, magnetoCandidateId);
  assert.equal(manifest.lists[doctorIndex + 4].id, 'loki-reading-order');
  assert.equal(manifest.lists[doctorIndex + 5].id, 'xmen-claremont');
});

test('the Loki source ledger preserves every occurrence and boundary decision', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const ledger = await readJson('scripts/data/cbh-source-ledgers/loki-reading-order.json');
  const expandedLedger = await readJson('scripts/data/cbh-source-ledgers/loki-reading-order-expanded.json');
  const inventoryRecord = inventory.find((record) => record.id === 'loki-reading-order');
  const repeatPositions = [
    4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 20, 23, 30, 31, 32, 33, 34, 35,
    36, 39, 95, 128, 129, 130, 131, 132, 134, 135, 136, 137, 138, 139, 140, 141, 142,
  ];
  const exclusionClasses = [
    {
      rationale: 'Trade header or collected-edition label without an issue identity.',
      positions: [
        1, 18, 21, 24, 27, 37, 42, 44, 46, 48, 51, 54, 57, 60, 65, 67, 69, 72, 74, 76,
        79, 82, 84, 86, 91, 94, 97, 99, 102, 105, 107, 111, 114, 116, 118, 121, 123, 125,
        143, 146, 148, 151, 154, 157, 158, 160, 162, 165, 168, 171, 174, 177, 179, 183,
        186, 189, 192, 195, 198, 201, 207, 210, 213, 216, 219, 221, 223, 225, 227, 229, 231,
      ],
    },
    {
      rationale: 'Narrative or descriptive prose without an issue identity.',
      positions: [
        3, 26, 50, 53, 56, 59, 71, 78, 81, 88, 93, 96, 104, 110, 113, 145, 164, 167, 170,
        173, 176, 181, 182, 185, 188, 191, 194, 197, 200, 203, 206, 209, 212, 215, 218,
      ],
    },
    {
      rationale: 'Section heading, event label, or reading-order cross-link without an issue identity.',
      positions: [29, 62, 89, 101, 120, 127, 133, 150, 153, 156, 204],
    },
    {
      rationale: 'Empty Collects marker without an issue identity.',
      positions: [87],
    },
  ];
  const gapBlockPositions = [77, 92, 108, 122, 126, 149, 172, 184, 205];

  function validateLedgerShape(candidateLedger) {
    assert.equal(candidateLedger.sourceUrl, 'https://www.comicbookherald.com/loki-reading-order/');
    assert.equal(candidateLedger.sourceRetrievedAt, '2026-08-27');
    assert.equal(candidateLedger.sourceGroupCount, 11);
    assert.equal(candidateLedger.sourceOccurrenceCount, candidateLedger.occurrences.length);
    assert.equal(
      candidateLedger.counts.exact
        + candidateLedger.counts.repeat
        + candidateLedger.counts.gap
        + candidateLedger.counts.exclusion,
      candidateLedger.sourceOccurrenceCount,
    );
    assert.match(candidateLedger.sourceBoundary, /No complete Best Comics or Essential Comics section exists/i);
    assert.match(candidateLedger.sourceBoundary, /full page is the correct owner-policy boundary/i);
    assert.equal(candidateLedger.boundaryEvidence.length, 3);
    assert.match(candidateLedger.boundaryEvidence[1].text, /incidental prose words/i);

    const positions = candidateLedger.occurrences.map((entry) => entry.position);
    assert.equal(new Set(positions).size, positions.length);
    assert.equal(
      new Set(candidateLedger.occurrences.map((entry) => entry.sourceGroup)).size,
      candidateLedger.sourceGroupCount,
    );
    assert.deepEqual(
      [...positions].sort((left, right) => left - right),
      Array.from({ length: candidateLedger.sourceOccurrenceCount }, (_, index) => index + 1),
    );
    const derivedCounts = {
      exact: 0,
      repeat: 0,
      gap: 0,
      exclusion: 0,
    };
    for (const entry of candidateLedger.occurrences) {
      derivedCounts[entry.disposition] += 1;
    }
    assert.deepEqual(derivedCounts, candidateLedger.counts);

    const exclusionPositions = exclusionClasses.flatMap((entry) => entry.positions);
    const expectedExactBlockPositions = Array.from(
      { length: candidateLedger.sourceOccurrenceCount },
      (_, index) => index + 1,
    ).filter((position) => !repeatPositions.includes(position)
      && !exclusionPositions.includes(position)
      && !gapBlockPositions.includes(position));
    const expectedCounts = {
      exact: expectedExactBlockPositions.length,
      repeat: repeatPositions.length,
      gap: gapBlockPositions.length,
      exclusion: exclusionPositions.length,
    };
    assert.deepEqual(candidateLedger.counts, expectedCounts);
    assert.deepEqual(candidateLedger.classificationSummary, {
      repeats: {
        rationale: 'Each occurrence contains only issue identities already named by an earlier source occurrence.',
        positions: repeatPositions,
      },
      gaps: {
        rationale: 'Provider lookup did not establish every issue identity in the source block.',
        positions: gapBlockPositions,
      },
      exclusions: exclusionClasses,
    });
    assert.deepEqual(
      candidateLedger.occurrences
        .filter((entry) => entry.disposition === 'exact')
        .map((entry) => entry.position),
      expectedExactBlockPositions,
    );
    assert.deepEqual(
      candidateLedger.occurrences
        .filter((entry) => entry.disposition === 'repeat')
        .map((entry) => entry.position),
      repeatPositions,
    );
    assert.deepEqual(
      candidateLedger.occurrences
        .filter((entry) => entry.disposition === 'gap')
        .map((entry) => entry.position),
      gapBlockPositions,
    );
    assert.deepEqual(
      candidateLedger.occurrences
        .filter((entry) => entry.disposition === 'exclusion')
        .map((entry) => entry.position),
      exclusionPositions.sort((left, right) => left - right),
    );

    const byText = new Map(candidateLedger.occurrences.map((entry) => [entry.sourceText, entry]));
    assert.equal(byText.get('Thor Epic Collection: The God of Thunder').disposition, 'exclusion');
    assert.equal(byText.get('Thor & Loki: Blood Brothers').disposition, 'exclusion');
    assert.equal(byText.get('Jack Kirby and Stan Lee launch Thor, Loki, and the Gods of Asgard into the Marvel Universe!').disposition, 'exclusion');
    assert.equal(byText.get('Loki centric issues can be found in:').disposition, 'exclusion');
    assert.equal(byText.get('Loki by Kibblesmith & Bazaldua').disposition, 'exclusion');
    assert.deepEqual(byText.get('Collects: Loki #1-4, Journey Into Mystery #85, Journey Into Mystery #112').repeatOfPositions, [2, 4, 25, 55]);
    assert.deepEqual(byText.get('Collects: Thor #173 to #183').repeatOfPositions, [38]);
    assert.deepEqual(byText.get('Collects: Loki (2019) #1 to #5, material from War of the Realms: Omega (2019) #1').repeatOfPositions, [214]);
    assert.deepEqual(byText.get('Thor #426 to #432, #440 to #442').issueReferences, [
      'Thor #426 to #432',
      'Thor #440 to #442',
    ]);

    for (const entry of candidateLedger.occurrences) {
      assert.equal(typeof entry.sourceText, 'string');
      assert.ok(entry.sourceText.length > 0);
      assert.equal(typeof entry.sourceReference, 'string');
      assert.ok(entry.sourceReference.length > 0);
      assert.equal(typeof entry.sourceGroup, 'string');
      assert.ok(entry.sourceGroup.length > 0);
      assert.ok([
        'exact',
        'repeat',
        'gap',
        'exclusion',
      ].includes(entry.disposition));
      if (entry.disposition === 'gap') {
        assert.equal(entry.providerSettlement.status, 'gap');
        assert.ok(entry.providerSettlement.unresolved.length > 0);
      }
      if (entry.disposition === 'exclusion') {
        assert.equal(typeof entry.exclusionReason, 'string');
        assert.ok(entry.exclusionReason.length > 0);
      }
      if (Array.isArray(entry.repeatOfPositions)) {
        assert.ok(entry.repeatOfPositions.every((position) => position < entry.position));
      }
      if (entry.disposition === 'repeat') {
        assert.ok(Array.isArray(entry.repeatOfPositions));
        assert.ok(entry.repeatOfPositions.length > 0);
      }
    }
  }

  assert.equal(inventoryRecord.centralDisposition, 'pilot-approved');
  assert.equal(inventoryRecord.deliveryStatus, 'shipped');
  assert.equal(inventoryRecord.metadataHorizonStatus, 'approved');
  assert.equal(inventoryRecord.sourceRetrievedAt, '2026-08-27');
  assert.equal(inventoryRecord.sourceContentSha256, ledger.sourceContentSha256);
  assert.match(inventoryRecord.reason, /830 issue and marker occurrences/i);
  assert.match(inventoryRecord.reason, /638 exact issue rows/i);
  assert.match(inventoryRecord.reason, /18 explicit metadata gaps/i);
  assert.match(inventoryRecord.reason, /53 repeated issue occurrences/i);
  assert.match(inventoryRecord.reason, /121 exclusions/i);

  assert.doesNotThrow(() => validateLedgerShape(ledger));
  assert.equal(expandedLedger.sourceBlockCount, ledger.sourceOccurrenceCount);
  assert.equal(expandedLedger.sourceOccurrenceCount, expandedLedger.occurrences.length);
  assert.deepEqual(expandedLedger.counts, {
    exact: 638,
    repeat: 53,
    gap: 18,
    exclusion: 121,
  });
  assert.equal(
    Object.values(expandedLedger.counts).reduce((sum, value) => sum + value, 0),
    expandedLedger.sourceOccurrenceCount,
  );
  assert.deepEqual(
    expandedLedger.occurrences.map((entry) => entry.position),
    Array.from({ length: expandedLedger.sourceOccurrenceCount }, (_, index) => index + 1),
  );
  assert.deepEqual(
    [...new Set(expandedLedger.occurrences.map((entry) => entry.sourceBlockPosition))].sort(
      (left, right) => left - right,
    ),
    Array.from({ length: ledger.sourceOccurrenceCount }, (_, index) => index + 1),
  );
  assert.equal(
    expandedLedger.occurrences.filter((entry) => (
      entry.sourceBlockPosition === 149 && entry.disposition === 'gap'
    )).length,
    5,
  );
  for (const disposition of ['exact', 'repeat', 'gap', 'exclusion']) {
    const removed = JSON.parse(JSON.stringify(expandedLedger));
    removed.occurrences.splice(removed.occurrences.findIndex((entry) => entry.disposition === disposition), 1);
    assert.notEqual(removed.occurrences.length, expandedLedger.sourceOccurrenceCount);
  }

  for (const position of [1, 2, 4]) {
    const removed = JSON.parse(JSON.stringify(ledger));
    removed.occurrences.splice(removed.occurrences.findIndex((entry) => entry.position === position), 1);
    assert.throws(() => validateLedgerShape(removed));
  }

  const duplicated = JSON.parse(JSON.stringify(ledger));
  duplicated.occurrences.splice(3, 0, duplicated.occurrences[3]);
  assert.throws(() => validateLedgerShape(duplicated));
});

test('Loki publishes every cached exact issue and preserves its source gaps', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson('scripts/data/cbh-packets/loki-reading-order.json');
  const mapping = await readJson('scripts/data/cbh-mappings/loki-reading-order.json');
  const report = await readJson('scripts/data/cbh-overlaps/loki-reading-order.json');
  const manifest = await readJson('src/data/curated-lists.json');
  const payload = await readJson('src/data/loki_reading_order.json');
  const markdown = await readFile(path.join(root, 'src/data/orders/loki-reading-order.md'), 'utf8');
  const inventoryRecord = inventory.find((record) => record.id === 'loki-reading-order');
  const manifestEntry = manifest.lists.find((entry) => entry.id === 'loki-reading-order');

  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: 'loki-reading-order',
    inventoryRecord,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.equal(packet.sourceOccurrenceCount, 830);
  assert.equal(packet.rows.length, 638);
  assert.equal(packet.repeatedSourceReferences.length, 53);
  assert.equal(packet.sourceGaps.length, 18);
  assert.equal(packet.excludedSourceRows.length, 121);
  assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
  assert.equal(new Set(mapping.rows.map((row) => row.selectedIssueId)).size, 638);
  assert.ok(mapping.repeatedSourceReferences.every((entry) => entry.canonicalRow > 0));
  assert.equal(mapping.reviewStatus, 'approved');
  assert.equal(report.comparisonCount, 136);
  assert.equal(report.comparisons.filter((entry) => entry.relationship === 'exact').length, 0);
  assert.equal(manifestEntry.expect, 656);
  assert.equal(payload.count, 656);
  assert.equal(payload.placeholders, 18);
  assert.equal(payload.items.filter((item) => item.issueId > 0).length, 638);
  assert.equal(payload.items.filter((item) => item.issueId < 0).length, 18);
  assert.equal(payload.collections, 75);
  assert.deepEqual(
    [...new Set(payload.items.map((item) => item.collectedIn))],
    parseChecklist(markdown).headings.slice(1),
  );
  assert.match(markdown, /^## Journey Into Mystery \(1952\) 83-109$/m);
  assert.ok(packet.sourceGaps.every((gap) => /issue #302/.test(gap.auditBasis)));
});

test('Loki source-gap identities survive re-vendoring and import without collapsing', async () => {
  const markdown = await readFile(path.join(root, 'src/data/orders/loki-reading-order.md'), 'utf8');
  const mapping = await readJson('scripts/data/cbh-mappings/loki-reading-order.json');
  const payload = await readJson('src/data/loki_reading_order.json');
  const { entries, unresolved } = parseChecklist(markdown);
  const items = [...entries, ...unresolved].sort((left, right) => left.index - right.index).map((entry) => ({
    issueId: entry.issueId ?? placeholderId('loki-reading-order', entry.title, entry.sourceKey),
    title: entry.title,
    url: entry.url,
    collectedIn: entry.section,
    ...(entry.issueId == null ? { placeholder: true } : {}),
  }));
  let state = createList(createEmptyState(), { name: 'Loki re-vendor regression' });
  const listId = state.listOrder[0];
  state = addIssuesToList(state, listId, items).state;

  assert.equal(items.length, 656);
  assert.ok(items.every((item) => !item.title.includes('mrt:source-occurrence=')));
  assert.deepEqual(
    unresolved.map((entry) => entry.sourceKey),
    mapping.sourceGaps.map((gap) => String(gap.sourcePosition)),
  );
  assert.equal(new Set(items.map((item) => item.issueId)).size, 656);
  assert.deepEqual(
    items.map((item) => item.issueId),
    payload.items.map((item) => item.issueId),
  );
  assert.equal(state.lists[listId].itemIds.length, 656);
  assert.equal(items.filter((item) => item.placeholder).length, 18);
  assert.equal(
    placeholderId('unchanged-order', 'Existing unique placeholder'),
    placeholderId('unchanged-order', 'Existing unique placeholder', null),
  );
});

test('Silver Surfer preserves all 426 source occurrences and the four issue #304 gap records', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson('scripts/data/cbh-packets/silver-surfer-reading-order.json');
  const mapping = await readJson('scripts/data/cbh-mappings/silver-surfer-reading-order.json');
  const report = await readJson('scripts/data/cbh-overlaps/silver-surfer-reading-order.json');
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/silver_surfer_reading_order.json');
  const markdown = await readFile(path.join(root, 'src/data/orders/silver-surfer-reading-order.md'), 'utf8');
  const record = inventory.find((entry) => entry.id === 'silver-surfer-reading-order');
  const manifestEntry = manifest.lists.find((entry) => entry.id === 'silver-surfer-reading-order');
  const catalogEntry = catalog.lists.find((entry) => entry.id === 'silver-surfer-reading-order');
  const expectedOrderIds = manifest.lists
    .map((entry) => entry.id)
    .filter((id) => id !== 'silver-surfer-reading-order')
    .sort();
  const reviewedLibraryDigest = await libraryDigestForScope(
    manifest,
    ['silver-surfer-reading-order'],
  );
  const regeneratedReport = await buildReportForMapping(
    path.join(root, 'scripts/data/cbh-mappings/silver-surfer-reading-order.json'),
    [],
    { excludedOrderIds: [] },
  );

  assert.equal(packet.sourceOccurrenceCount, 426);
  assert.equal(packet.rows.length, 294);
  assert.equal(packet.repeatedSourceReferences.length, 17);
  assert.equal(packet.sourceGaps.length, 4);
  assert.equal(packet.excludedSourceRows.length, 111);
  assert.equal(
    packet.rows.length
      + packet.repeatedSourceReferences.length
      + packet.sourceGaps.length
      + packet.excludedSourceRows.length,
    packet.sourceOccurrenceCount,
  );
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
  for (const sourceGaps of [packet.sourceGaps, mapping.sourceGaps]) {
    assert.equal(sourceGaps.length, 4);
    assert.ok(sourceGaps.every((gap) => (
      gap.auditBasis.includes('issue #304')
      && gap.evidenceSources.some((source) => (
        source.kind === 'gap-tracking-issue'
        && source.url === 'https://github.com/raymond-nassar/recap-page/issues/304'
      ))
    )));
  }
  assert.equal(record?.centralDisposition, 'pilot-approved');
  assert.equal(record?.deliveryStatus, 'ready');
  assert.equal(manifestEntry?.expect, 298);
  assert.equal(catalogEntry?.count, 298);
  assert.equal(generated.count, 298);
  assert.equal(generated.placeholders, 4);
  assert.equal(generated.items.filter((item) => item.issueId > 0).length, 294);
  assert.equal(generated.items.filter((item) => item.issueId < 0).length, 4);
  assert.equal(parseChecklist(markdown).entries.length, 294);
  assert.equal(parseChecklist(markdown).unresolved.length, 4);
  assert.equal(report.candidateCount, 294);
  assert.equal(report.comparisonCount, expectedOrderIds.length);
  assert.deepEqual(
    report.comparisons.map((comparison) => comparison.orderId).sort(),
    expectedOrderIds,
  );
  assert.deepEqual(
    report.comparisons.find((comparison) => comparison.orderId === 'loki-reading-order'),
    {
      orderId: 'loki-reading-order',
      relationship: 'partial',
      sharedCount: 17,
      sharedIds: [
        '16099', '6970', '6971', '6972', '6973', '20392', '20403', '20263',
        '20274', '61093', '66283', '66416', '66684', '67022', '68653', '68656', '66158',
      ],
    },
  );
  assert.equal(report.libraryDigest, reviewedLibraryDigest);
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.deepEqual(report, regeneratedReport);
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds,
  }));
  assert.doesNotMatch(markdown, /\b(?:TODO|TBD|placeholder|implementation)\b/i);
});

test('the Captain Marvel packet preserves its legacy run boundary, exclusion, and source order evidence', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson(`scripts/data/cbh-packets/${captainMarvelCandidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${captainMarvelCandidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${captainMarvelCandidateId}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/captain_marvel_ms_marvel_reading_order.json');
  const markdown = await readFile(path.join(root, 'src/data/orders/captain-marvel-ms-marvel-reading-order.md'), 'utf8');
  const parsed = parseChecklist(markdown);
  const record = inventory.find((candidate) => candidate.id === captainMarvelCandidateId);
  const reviewedLibraryDigest = await historicalReportLibraryDigest(
    manifest,
    [captainMarvelCandidateId, 'punisher-reading-order', magnetoCandidateId],
  );

  assert.equal(record.centralDisposition, 'pilot-approved');
  assert.equal(record.deliveryStatus, 'ready');
  assert.equal(record.metadataHorizonStatus, 'approved');
  assert.deepEqual(record.catalogIds, [captainMarvelCandidateId]);
  assert.match(
    record.reason,
    /599 issue occurrences as 527 exact rows, 71 repeats, and 1 owner-authorized non-existent-identity exclusion/i,
  );
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: captainMarvelCandidateId,
    inventoryRecord: record,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.equal(report.libraryDigest, reviewedLibraryDigest);
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));

  assert.equal(packet.sourceOccurrenceCount, 599);
  assert.equal(packet.rows.length, 527);
  assert.equal(packet.repeatedSourceReferences.length, 71);
  assert.equal(packet.sourceGaps, undefined);
  assert.deepEqual(packet.excludedSourceRows, [{
    sourcePosition: 548,
    sourceIssueReference: 'Captain Marvel #130',
    reason: 'Owner-authorized exclusion after closed issue #290 confirmed that this explicit source occurrence names no existing comic identity.',
    decisionScope: 'owner-authorized non-existent identity',
  }]);
  assert.equal(mapping.rows.length, 527);
  assert.equal(report.candidateCount, 527);
  assert.equal(report.comparisonCount, 155);
  assert.equal(report.comparisons.filter((comparison) => comparison.relationship !== 'none').length, 28);
  assert.equal(generated.count, 527);
  assert.equal(generated.placeholders, 0);
  assert.deepEqual(generated.unresolved, []);
  assert.equal(generated.items.filter((item) => item.issueId > 0).length, 527);
  assert.equal(generated.items.filter((item) => item.issueId < 0).length, 0);
  assert.equal(parsed.entries.length, 527);
  assert.deepEqual(parsed.unresolved, []);
  assert.doesNotMatch(markdown, /^- \[ \] Captain Marvel #130$/m);
  const catalogEntry = catalog.lists.find((entry) => entry.id === captainMarvelCandidateId);
  assert.equal(catalogEntry.count, 527);
  assert.equal(catalogEntry.coverIssueId, 15423);
  assert.deepEqual(
    generated.items.filter((item) => item.issueId > 0).map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
});

test('the Deadpool Best of guide preserves its source groups, repeats, metadata gaps, and complete-library approval', async () => {
  const packet = await readJson('scripts/data/cbh-packets/deadpool-best-of.json');
  const mapping = await readJson('scripts/data/cbh-mappings/deadpool-best-of.json');
  const report = await readJson('scripts/data/cbh-overlaps/deadpool-best-of.json');
  const manifest = await readJson('src/data/curated-lists.json');
  const generated = await readJson('src/data/deadpool_best_of.json');
  const markdown = await readFile(path.join(root, 'src/data/orders/deadpool-best-of.md'), 'utf8');
  const reviewedLibraryDigest = await currentPublicationLibraryDigest(manifest, ['deadpool-best-of']);

  assert.equal(packet.sourceOccurrenceCount, 56);
  assert.equal(packet.rows.length, 38);
  assert.equal(packet.sourceGaps.length, 2);
  assert.equal(packet.repeatedSourceReferences.length, 16);
  assert.equal(new Set([
    ...packet.rows,
    ...packet.sourceGaps,
    ...packet.repeatedSourceReferences,
  ].map((entry) => entry.sourceRangeReference)).size, 13);
  assert.deepEqual(
    mapping.sourceGaps.map((gap) => gap.sourceIssueReference),
    ['Deadpool MAX (2010) #1', 'Deadpool MAX (2010) #2'],
  );
  assert.equal(generated.count, 40);
  assert.equal(generated.placeholders, 2);
  assert.equal(parseChecklist(markdown).entries.length, 38);
  assert.equal(report.comparisonCount, 136);
  assert.deepEqual(
    report.comparisons.filter((comparison) => comparison.relationship !== 'none'),
    [],
  );
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));
  assert.deepEqual(parseChecklist(markdown).headings.slice(1), [
    '1. Deadpool - The Joe Kelly Run',
    '2. Deadpool Classic Omnibus Vol. 1',
    '3. Cable & Deadpool',
    '4. Deadpool: The Adamantium Collection',
    '5. Deadpool - The Daniel Way Run',
    '6. Uncanny X-Force - The Rick Remender Run',
    '7. Deadpool MAX',
    '8. Deadpool (Marvel NOW!) - The Gerry Duggan and Brian Posehn run',
    '9. Deadpool Minibus',
  ]);
  assert.equal(new Set(generated.items.map((item) => item.collectedIn).filter(Boolean)).size, 9);
});

test('the character inventory rejects incomplete evidence and source sets', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const missingField = inventory.map((record) => ({ ...record }));
  delete missingField[0].sourceContentSha256;
  assert.throws(() => validateInventoryState(missingField), /sourceContentSha256/i);
  assert.throws(() => validateInventoryState(inventory.slice(0, -1)), /exactly 128 records/i);
  assert.throws(
    () => validateInventoryState([
      ...inventory.slice(0, -1),
      { ...inventory[0], position: 128 },
    ]),
    /duplicate inventory id/i,
  );
});

test('Iron Man ships with its exact boundary and generated surfaces', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const packet = await readJson(`scripts/data/cbh-packets/${ironManCandidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${ironManCandidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${ironManCandidateId}.json`);
  const generated = await readJson('src/data/iron_man_reading_order.json');
  const record = inventory.find((candidate) => candidate.id === ironManCandidateId);

  assert.equal(record.centralDisposition, 'pilot-approved');
  assert.equal(record.deliveryStatus, 'shipped');
  assert.equal(record.metadataHorizonStatus, 'approved');
  assert.match(record.reason, /815-occurrence source boundary reduces to 811 distinct issues/i);
  for (const required of [
    'Tony Stark: Iron Man (2018) #15/#16',
    'Crimson Dynamo #1-4',
    'Iron Man: Viva Las Vegas #3-4',
    'Iron Man Legacy #2, #5, and #10',
  ]) {
    assert.match(record.reason, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.equal(manifest.lists.some((entry) => entry.id === 'iron-man-2020'), true);
  assert.equal(catalog.lists.some((entry) => entry.id === 'iron-man-2020'), true);
  for (const relativePath of [
    `scripts/data/cbh-packets/${ironManCandidateId}.json`,
    `scripts/data/cbh-mappings/${ironManCandidateId}.json`,
    `scripts/data/cbh-overlaps/${ironManCandidateId}.json`,
    `src/data/orders/${ironManCandidateId}.md`,
    'src/data/iron_man_reading_order.json',
  ]) {
    await assert.doesNotReject(() => readFile(path.join(root, relativePath), 'utf8'));
  }

  // The 815-occurrence source boundary reduces to 811 canonical rows: two later
  // occurrences repeat an earlier Tony Stark: Iron Man #15/#16 read, and two
  // solicited-but-never-published Viva Las Vegas #3/#4 rows are excluded, so
  // 815 - 2 repeats - 2 excluded = 811 distinct issues placed once each.
  assert.equal(packet.sourceOccurrenceCount, 815);
  assert.equal(packet.rows.length, 811);
  assert.equal(packet.expectedCount, 811);
  assert.deepEqual(
    packet.repeatedSourceReferences.map((entry) => (
      [entry.sourcePosition, entry.canonicalRow, entry.sourceIssueReference]
    )),
    [
      [716, 706, 'Tony Stark: Iron Man #15'],
      [717, 707, 'Tony Stark: Iron Man #16'],
    ],
  );
  assert.deepEqual(
    packet.excludedSourceRows.map((entry) => [entry.sourcePosition, entry.sourceIssueReference]),
    [
      [507, 'Iron Man: Viva Las Vegas #3'],
      [508, 'Iron Man: Viva Las Vegas #4'],
    ],
  );
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: ironManCandidateId,
    inventoryRecord: record,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.equal(mapping.rows.length, 811);
  assert.equal(new Set(mapping.rows.map((row) => String(row.selectedIssueId))).size, 811);
  assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
  assert.deepEqual(
    mapping.rows.map((row) => row.sourceIssueReference),
    packet.rows.map((row) => row.sourceIssueReference),
  );

  const ownerSuppliedIds = {
    'Tony Stark: Iron Man #15': 70799,
    'Tony Stark: Iron Man #16': 70800,
    'Iron Man: Viva Las Vegas #1': 21234,
    'Iron Man: Viva Las Vegas #2': 21377,
    'Iron Man Legacy #2': 30104,
    'Iron Man Legacy #5': 30107,
    'Iron Man Legacy #10': 30101,
    'Crimson Dynamo #1': 72824,
    'Crimson Dynamo #2': 72825,
    'Crimson Dynamo #3': 391,
    'Crimson Dynamo #4': 390,
  };
  const rowBySourceReference = new Map(
    mapping.rows.map((row) => [row.sourceIssueReference, row]),
  );
  for (const [reference, issueId] of Object.entries(ownerSuppliedIds)) {
    const row = rowBySourceReference.get(reference);
    assert.ok(row, `expected a mapping row for ${reference}`);
    assert.equal(String(row.selectedIssueId), String(issueId), `${reference} should resolve to ${issueId}`);
  }

  const parsed = parseChecklist(await readFile(
    path.join(root, `src/data/orders/${ironManCandidateId}.md`),
    'utf8',
  ));
  assert.deepEqual(
    parsed.entries.map((entry) => String(entry.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.deepEqual(
    generated.items.map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );

  const catalogEntry = catalog.lists.find((entry) => entry.id === 'iron-man-2020');
  assert.equal(catalogEntry.count, 18);
  assert.equal(catalogEntry.type, 'event');
  assert.equal(catalogEntry.depth, 'complete');
});

test('Hulk preserves all reviewed source positions and distinguishes provider gaps from parser markers', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const packet = await readJson(`scripts/data/cbh-packets/${hulkCandidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${hulkCandidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${hulkCandidateId}.json`);
  const generated = await readJson('src/data/question_of_the_week_do_you_have_a_hulk_reading_order.json');
  const record = inventory.find((candidate) => candidate.id === hulkCandidateId);
  const reviewedLibraryDigest = await currentPublicationLibraryDigest(manifest, [hulkCandidateId]);

  assert.equal(record.centralDisposition, 'pilot-approved');
  assert.equal(record.deliveryStatus, 'shipped');
  assert.equal(record.metadataHorizonStatus, 'approved');
  assert.match(record.reason, /1,140 distinct verified issues/i);
  assert.match(record.reason, /19 explicit provider gaps/i);
  assert.match(record.reason, /eight excluded collection or Issues parser markers/i);
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: hulkCandidateId,
    inventoryRecord: record,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));

  assert.equal(packet.sourceOccurrenceCount, 1242);
  assert.equal(packet.rows.length, 1140);
  assert.equal(packet.repeatedSourceReferences.length, 75);
  assert.equal(packet.sourceGaps.length, 19);
  assert.deepEqual(packet.excludedSourceRows.map((entry) => entry.sourcePosition),
    [121, 318, 591, 597, 734, 735, 854, 883]);
  assert.equal(new Set(mapping.rows.map((row) => row.sourceGroup)).size, 12);
  assert.deepEqual(
    mapping.rows.filter((row) => [76, 801, 937, 938, 939, 1046, 1173, 1242].includes(row.sourcePosition))
      .map((row) => [row.sourcePosition, row.selectedIssueId, row.marvelIssueUrl]),
    [
      [76, 17173, 'https://www.marvel.com/comics/issue/17173/incredible_hulk_king-size_special_1968_1'],
      [801, 26316, 'https://www.marvel.com/comics/issue/26316/son_of_hulk_2009_13'],
      [937, 48652, 'https://www.marvel.com/comics/issue/48652/indestructible_hulk_2012_17'],
      [938, 48653, 'https://www.marvel.com/comics/issue/48653/indestructible_hulk_2012_18'],
      [939, 48654, 'https://www.marvel.com/comics/issue/48654/indestructible_hulk_2012_19'],
      [1046, 15873, 'https://www.marvel.com/comics/issue/15873/world_war_hulk_2007_1'],
      [1173, 88707, 'https://www.marvel.com/comics/issue/88707/immortal_hulk_2020'],
      [1242, 128406, 'https://www.marvel.com/comics/issue/128406/imperial_war_black_panther_2025_1'],
    ],
  );
  assert.equal(generated.items.length, 1159);
  assert.equal(generated.items.filter((item) => item.issueId > 0).length, 1140);
  assert.equal(generated.items.filter((item) => item.issueId < 0 && item.placeholder).length, 19);
  assert.deepEqual(
    generated.items.filter((item) => item.issueId > 0).map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.equal(manifest.lists.find((entry) => entry.id === hulkCandidateId).expect, 1159);
  assert.equal(catalog.lists.find((entry) => entry.id === hulkCandidateId).count, 1159);
});


test('the frozen White Tiger evidence stays exact through every generated surface', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson(`scripts/data/cbh-packets/${candidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${candidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${candidateId}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/white_tiger_ava_ayala.json');
  const markdown = await readFile(path.join(root, 'src/data/orders/white-tiger-ava-ayala.md'), 'utf8');
  const parsed = parseChecklist(markdown);
  const inventoryRecord = inventory.find((record) => record.id === candidateId);
  const reviewedLibraryDigest = await currentPublicationLibraryDigest(manifest, [candidateId]);
  const regeneratedReport = await buildReportForMapping(
    path.join(root, 'scripts', 'data', 'cbh-mappings', `${candidateId}.json`),
  );

  assert.equal(reviewedLibraryDigest, '8df15c1bb4ddba19126ef6129d758c6edc69fa78ae067228396420f52dc04cf2');
  assert.equal(report.libraryDigest, reviewedLibraryDigest);
  assert.deepEqual(regeneratedReport, report);
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: candidateId,
    inventoryRecord,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));

  assert.equal(packet.rows.length, 82);
  assert.equal(mapping.rows.length, 82);
  assert.equal(report.candidateCount, 82);
  assert.equal(report.comparisonCount, 135);
  assert.equal(new Set(mapping.rows.map((row) => String(row.selectedIssueId))).size, 82);
  assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));

  const partials = report.comparisons
    .filter((comparison) => comparison.relationship !== 'none')
    .map(({ orderId, relationship, sharedCount }) => ({ orderId, relationship, sharedCount }));
  assert.deepEqual(partials, [
    { orderId: 'all-new-all-different-avengers', relationship: 'partial', sharedCount: 6 },
    { orderId: 'axis', relationship: 'partial', sharedCount: 4 },
    { orderId: 'hickman-full', relationship: 'partial', sharedCount: 1 },
    { orderId: 'silver-surfer-reading-order', relationship: 'partial', sharedCount: 1 },
    { orderId: 'x-men-regenesis', relationship: 'partial', sharedCount: 1 },
  ]);

  const community = mapping.rows.at(-1);
  assert.equal(community.selectedIssueId, 103954);
  assert.equal(community.sourceIssueReference, "Marvel's Voices: Community (2021) #1");
  assert.equal(community.resolvedIssueTitle, "Marvel's Voices: Community (2022) #1");
  assert.match(community.note, /source labels the one-shot 2021/i);

  const manifestIndex = manifest.lists.findIndex((entry) => entry.id === candidateId);
  assert.ok(manifestIndex >= 0);
  assert.deepEqual(
    manifest.lists.slice(manifestIndex + 1, manifestIndex + 6).map((entry) => entry.id),
    [
      'phalanx-reading-order',
      'marvels-best-phoenix-comics',
      'agatha-harkness-reading-order',
      'punisher-reading-order',
      cosmicCandidateId,
    ],
  );
  assert.equal(manifest.lists[manifestIndex].type, 'character-run');
  assert.equal(manifest.lists[manifestIndex].group, null);
  assert.equal(catalog.lists.find((entry) => entry.id === candidateId).count, 82);
  assert.deepEqual(
    parsed.entries.map((entry) => String(entry.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.deepEqual(
    generated.items.map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
});

test('the frozen Rocket evidence stays complete, fresh, and exact through every generated surface', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson(`scripts/data/cbh-packets/${cosmicCandidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${cosmicCandidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${cosmicCandidateId}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/rocket_raccoon_reading_order.json');
  const markdown = await readFile(
    path.join(root, 'src/data/orders/rocket-raccoon-reading-order.md'),
    'utf8',
  );
  const parsed = parseChecklist(markdown);
  const inventoryRecord = inventory.find((record) => record.id === cosmicCandidateId);
  const reviewedLibraryDigest = await currentPublicationLibraryDigest(manifest, [cosmicCandidateId]);
  const regeneratedReport = await buildReportForMapping(
    path.join(root, 'scripts', 'data', 'cbh-mappings', `${cosmicCandidateId}.json`),
  );

  assert.equal(packet.packetDigest, '99d180656af7f429d8bfb6b40e736f8ba30d0f9334da27799cec8f31ff20b384');
  assert.equal(mapping.mappingDigest, '6f87747f42b979377176e8be7ef6f2c761beeed2aaad297f2af3f53e44deef40');
  assert.equal(reviewedLibraryDigest, '05729498f22c3dbc2f93f675455dad8d03342d6b51376a6cbc4009da96798202');
  assert.equal(report.reportDigest, '573e2f25e262a4b6076bc99a677743325527b4164839f524d1af720a5121606d');
  assert.equal(
    mapping.relationshipReview.approvalDigest,
    'd47ebb2d6d88f1f8d04222438816c78d80cc4fe32524a1eab6c1d8289243541f',
  );
  assert.equal(report.libraryDigest, reviewedLibraryDigest);
  assert.deepEqual(regeneratedReport.comparisons, report.comparisons);
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: cosmicCandidateId,
    inventoryRecord,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));

  assertRocketSourceBoundary(packet);
  assert.equal(mapping.rows.length, 75);
  assert.equal(report.candidateCount, 75);
  assert.equal(report.comparisonCount, 135);
  assert.equal(mapping.relationshipReview.dispositions.length, 135);
  assert.equal(new Set(mapping.rows.map((row) => String(row.selectedIssueId))).size, 75);
  assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
  assert.deepEqual(
    mapping.rows.map((row) => row.sourceIssueReference),
    packet.rows.map((row) => row.sourceIssueReference),
  );
  assert.deepEqual(
    [0, 14, 15, 39, 40, 51, 61, 74].map((index) => mapping.rows[index].selectedIssueId),
    [11353, 39979, 21268, 32551, 62061, 71797, 71987, 76749],
  );

  assert.deepEqual(
    report.comparisons
      .filter((comparison) => comparison.relationship !== 'none')
      .map(({ orderId, relationship, sharedCount }) => ({ orderId, relationship, sharedCount })),
    [
      { orderId: grootCandidateId, relationship: 'partial', sharedCount: 41 },
      { orderId: 'marvel-fresh-start-avengers', relationship: 'partial', sharedCount: 10 },
      { orderId: 'scarlet-witch-best-of', relationship: 'partial', sharedCount: 10 },
      { orderId: 'silver-surfer-reading-order', relationship: 'partial', sharedCount: 4 },
      { orderId: starLordCandidateId, relationship: 'partial', sharedCount: 25 },
      { orderId: 'thanos-reading-order', relationship: 'partial', sharedCount: 6 },
      { orderId: 'war-of-kings', relationship: 'partial', sharedCount: 7 },
    ],
  );
  assert.deepEqual(
    mapping.relationshipReview.dispositions.map((disposition) => (
      [disposition.orderId, disposition.relationship]
    )),
    report.comparisons.map((comparison) => [comparison.orderId, comparison.relationship]),
  );

  const manifestEntry = manifest.lists.find((entry) => entry.id === cosmicCandidateId);
  const catalogEntry = catalog.lists.find((entry) => entry.id === cosmicCandidateId);
  assert.equal(manifestEntry.type, 'character-run');
  assert.equal(manifestEntry.spotlightKind, 'complete-guide');
  assert.equal(manifestEntry.group, null);
  assert.equal(catalogEntry.type, 'character-run');
  assert.equal(catalogEntry.spotlightKind, 'complete-guide');
  assert.equal(catalogEntry.count, 75);
  assert.deepEqual(
    parsed.entries.map((entry) => String(entry.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.deepEqual(
    generated.items.map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );

  const omittedSourceRow = structuredClone(packet);
  omittedSourceRow.rows.splice(1, 1);
  omittedSourceRow.expectedCount = 74;
  omittedSourceRow.proposedManifest.expect = 74;
  assert.throws(() => assertRocketSourceBoundary(omittedSourceRow));

  const stalePacket = structuredClone(packet);
  stalePacket.rows[0].issueNumber = '14';
  assert.throws(() => validateFrozenPacket(stalePacket), /packet digest is stale/i);

  const staleMapping = structuredClone(mapping);
  staleMapping.rows.pop();
  assert.throws(() => validateMappingDigest(staleMapping), /mapping digest is stale/i);

  const staleReport = structuredClone(report);
  staleReport.comparisons.pop();
  assert.throws(() => validateReportDigest(staleReport), /report digest is stale/i);

  const omittedDisposition = structuredClone(mapping);
  omittedDisposition.relationshipReview.dispositions.pop();
  omittedDisposition.relationshipReview.approvalDigest = approvalDigestFor(
    omittedDisposition.relationshipReview,
  );
  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping: omittedDisposition,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /relationship dispositions are incomplete/i);

  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: '0'.repeat(64),
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /library changed since relationship review/i);
});

test('the frozen Groot evidence stays complete, fresh, distinct, and exact', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson(`scripts/data/cbh-packets/${grootCandidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${grootCandidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${grootCandidateId}.json`);
  const rocketMapping = await readJson(`scripts/data/cbh-mappings/${cosmicCandidateId}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/groot_reading_order.json');
  const markdown = await readFile(
    path.join(root, 'src/data/orders/groot-reading-order.md'),
    'utf8',
  );
  const parsed = parseChecklist(markdown);
  const inventoryRecord = inventory.find((record) => record.id === grootCandidateId);
  const reviewedLibraryDigest = await currentPublicationLibraryDigest(
    manifest,
    [grootCandidateId, cosmicCandidateId],
  );
  const regeneratedReport = await buildReportForMapping(
    path.join(root, 'scripts', 'data', 'cbh-mappings', `${grootCandidateId}.json`),
    [path.join(root, 'scripts', 'data', 'cbh-mappings', `${cosmicCandidateId}.json`)],
  );

  assert.equal(packet.packetDigest, 'b9cd22d29d38539fa16d44d15db0cea8108ad414319828c0108845d0f3d267c7');
  assert.equal(mapping.mappingDigest, '8f693cbf39f09350230965373d28a9bf3cb4fc34175ed848b751778a41d16523');
  assert.equal(reviewedLibraryDigest, '2f49b301a5c58db4879e99a0a79ce53abbcdd75885617ff2f0764d5561e54054');
  assert.equal(report.reportDigest, '59905ad14263c6215178f49ab3fbf53bce77070b3f19d26fb7ceb741712fbf0e');
  assert.equal(
    mapping.relationshipReview.approvalDigest,
    '62539ac5c7e228ca5edf38f6b3d2f551adb2b6416c6eb738e4c58c3ebdf77964',
  );
  assert.deepEqual(report.peerDigests, {
    [cosmicCandidateId]: '6f87747f42b979377176e8be7ef6f2c761beeed2aaad297f2af3f53e44deef40',
  });
  assert.deepEqual(regeneratedReport.comparisons, report.comparisons);
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: grootCandidateId,
    inventoryRecord,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    peerMappings: [rocketMapping],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));

  assertGrootSourceBoundary(packet);
  assert.equal(mapping.rows.length, 76);
  assert.equal(report.candidateCount, 76);
  assert.equal(report.comparisonCount, 135);
  assert.equal(mapping.relationshipReview.dispositions.length, 135);
  assert.equal(new Set(mapping.rows.map((row) => String(row.selectedIssueId))).size, 76);
  assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
  assert.equal(mapping.approvedSourceCount, 84);
  assert.equal(mapping.sourceOccurrenceCount, 84);
  assert.equal(mapping.rows[70].sourcePosition, 71);
  assert.equal(mapping.rows[71].sourcePosition, 80);
  assert.deepEqual(
    mapping.rows.map((row) => row.sourceIssueReference),
    packet.rows.map((row) => row.sourceIssueReference),
  );
  assert.deepEqual(
    mapping.rows.map((row) => row.selectedIssueId),
    [
      11353, 9082, 22811, 22812, 22813, 22814, 19779, 36644, 36647, 36646, 36645,
      39982, 39981, 39980, 39979, 21268, 21412, 21586, 21783, 22025, 22352, 22544,
      22957, 23148, 23636, 23792, 23793, 23986, 24188, 25303, 25304, 25305, 25306,
      25307, 25308, 25309, 29022, 29009, 29010, 32551, 53697, 53699, 53700, 53701,
      54929, 54930, 50221, 50223, 50224, 50225, 50788, 51150, 52393, 52396, 52399,
      52400, 52401, 55597, 55599, 55601, 55602, 55603, 55604, 55605, 55606, 55607,
      55608, 16009, 16191, 16598, 16599, 71797, 107816, 107817, 107818, 107819,
    ],
  );

  const partials = report.comparisons
    .filter((comparison) => comparison.relationship !== 'none')
    .map(({ orderId, relationship, sharedCount }) => ({ orderId, relationship, sharedCount }));
  assert.deepEqual(partials, [
    { orderId: 'annihilation-conquest', relationship: 'partial', sharedCount: 4 },
    { orderId: cosmicCandidateId, relationship: 'partial', sharedCount: 41 },
    { orderId: 'silver-surfer-reading-order', relationship: 'partial', sharedCount: 4 },
    { orderId: starLordCandidateId, relationship: 'partial', sharedCount: 25 },
    { orderId: 'war-of-kings', relationship: 'partial', sharedCount: 7 },
  ]);
  const grootIds = new Set(mapping.rows.map((row) => String(row.selectedIssueId)));
  const sharedRocketIds = rocketMapping.rows
    .map((row) => String(row.selectedIssueId))
    .filter((id) => grootIds.has(id));
  assert.equal(sharedRocketIds.length, 41);
  assert.deepEqual(
    new Set(report.comparisons.find((comparison) => (
      comparison.orderId === cosmicCandidateId
    )).sharedIds),
    new Set(sharedRocketIds),
  );

  const manifestEntry = manifest.lists.find((entry) => entry.id === grootCandidateId);
  const catalogEntry = catalog.lists.find((entry) => entry.id === grootCandidateId);
  assert.equal(manifestEntry.type, 'character-run');
  assert.equal(manifestEntry.spotlightKind, 'complete-guide');
  assert.equal(manifestEntry.group, null);
  assert.equal(manifestEntry.expect, 76);
  assert.equal(catalogEntry.type, 'character-run');
  assert.equal(catalogEntry.spotlightKind, 'complete-guide');
  assert.equal(catalogEntry.count, 76);
  assert.deepEqual(
    parsed.entries.map((entry) => String(entry.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.match(markdown, /84 issue occurrences, including 8 intentional repeats/);
  assert.match(markdown, /each distinct comic once at its first source occurrence/);
  assert.deepEqual(
    generated.items.map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );

  const malformedBoundary = structuredClone(packet);
  malformedBoundary.sourceIssueBearingBlocksSha256 = 'not-a-digest';
  malformedBoundary.packetDigest = packetDigestFor(malformedBoundary);
  assert.throws(
    () => validateFrozenPacket(malformedBoundary),
    /sourceIssueBearingBlocksSha256 must be a lowercase SHA-256 digest/i,
  );

  const staleBoundary = structuredClone(packet);
  staleBoundary.sourceIssueBearingBlocksSha256 = '0'.repeat(64);
  staleBoundary.packetDigest = packetDigestFor(staleBoundary);
  assert.doesNotThrow(() => validateFrozenPacket(staleBoundary));
  assert.throws(() => assertGrootSourceBoundary(staleBoundary));

  const stalePeer = structuredClone(rocketMapping);
  stalePeer.rows[0].selectedIssueId = 9999;
  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    peerMappings: [stalePeer],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /mapping digest is stale/i);
});

test('the frozen Star-Lord evidence stays complete, fresh, distinct, and exact', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson(`scripts/data/cbh-packets/${starLordCandidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${starLordCandidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${starLordCandidateId}.json`);
  const rocketMapping = await readJson(`scripts/data/cbh-mappings/${cosmicCandidateId}.json`);
  const grootMapping = await readJson(`scripts/data/cbh-mappings/${grootCandidateId}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/star_lord_reading_order.json');
  const markdown = await readFile(
    path.join(root, 'src/data/orders/star-lord-reading-order.md'),
    'utf8',
  );
  const parsed = parseChecklist(markdown);
  const inventoryRecord = inventory.find((record) => (
    record.id === starLordInventoryId
  ));
  const reviewedLibraryDigest = await currentPublicationLibraryDigest(
    manifest,
    [starLordCandidateId, cosmicCandidateId, grootCandidateId],
  );
  const regeneratedReport = await buildReportForMapping(
    path.join(root, 'scripts', 'data', 'cbh-mappings', `${starLordCandidateId}.json`),
    [
      path.join(root, 'scripts', 'data', 'cbh-mappings', `${cosmicCandidateId}.json`),
      path.join(root, 'scripts', 'data', 'cbh-mappings', `${grootCandidateId}.json`),
    ],
  );

  assert.equal(packet.packetDigest, 'a19869d4e6e5250df9c8fba6f4c65cb485fd63124cd104020c6af310e1abc4ac');
  assert.equal(mapping.mappingDigest, '731a3399ed455840723712deeffa4dc4a9a0ef2cc11d6fd093da6e3af97552da');
  assert.equal(reviewedLibraryDigest, '2364599c45a87148d0e77730843b5f74fd110dbbf833adaef0b509697a38345a');
  assert.equal(report.reportDigest, '65e04cf558b3c977bcc556f0cd3467538a416cf2279bffabe40d2df713ea3111');
  assert.equal(
    mapping.relationshipReview.approvalDigest,
    'f550ef741a54e6c1e3efe235fae24f680073b20152bf86cff0ecd9b37b6cc14d',
  );
  assert.deepEqual(report.peerDigests, {
    [grootCandidateId]: '8f693cbf39f09350230965373d28a9bf3cb4fc34175ed848b751778a41d16523',
    [cosmicCandidateId]: '6f87747f42b979377176e8be7ef6f2c761beeed2aaad297f2af3f53e44deef40',
  });
  assert.deepEqual(regeneratedReport.comparisons, report.comparisons);
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: starLordCandidateId,
    inventoryRecord,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    peerMappings: [rocketMapping, grootMapping],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));

  assertStarLordSourceBoundary(packet);
  assert.equal(mapping.rows.length, 99);
  assert.equal(report.candidateCount, 99);
  assert.equal(report.comparisonCount, 135);
  assert.equal(mapping.relationshipReview.dispositions.length, 135);
  assert.equal(new Set(mapping.rows.map((row) => String(row.selectedIssueId))).size, 99);
  assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
  assert.deepEqual(
    mapping.rows.map((row) => row.sourceIssueReference),
    packet.rows.map((row) => row.sourceIssueReference),
  );
  assert.deepEqual(
    mapping.rows.map((row) => row.selectedIssueId),
    [
      19776, 19760, 19763, 19764, 19767, 50896, 10263, 82621, 10252, 50897, 50898,
      50899, 21268, 21412, 21586, 21783, 22025, 22352, 22544, 22957, 23148, 23636,
      23792, 23793, 23986, 24188, 25303, 25304, 25305, 25306, 25307, 25308, 25309,
      29022, 29009, 29010, 32551, 50887, 50929, 50952, 50966, 51052, 51141, 53276,
      52028, 52029, 52032, 53710, 53712, 53713, 56180, 56181, 56182, 56183, 56184,
      56185, 56186, 56187, 61681, 61682, 61683, 61684, 61685, 61686, 62818, 61513,
      61514, 61516, 61518, 61520, 61522, 61515, 61517, 61519, 61521, 61523, 61524,
      65074, 65075, 65282, 65283, 65547, 64961, 65062, 65271, 65902, 66271, 73829,
      73830, 73831, 73832, 73833, 73834, 73835, 73836, 73837, 73838, 73839, 73840,
    ],
  );

  const partials = report.comparisons
    .filter((comparison) => comparison.relationship !== 'none')
    .map(({ orderId, relationship, sharedCount }) => ({ orderId, relationship, sharedCount }));
  assert.deepEqual(partials, [
    { orderId: grootCandidateId, relationship: 'partial', sharedCount: 25 },
    { orderId: 'infinity-countdown-wars', relationship: 'partial', sharedCount: 1 },
    { orderId: cosmicCandidateId, relationship: 'partial', sharedCount: 25 },
    { orderId: 'war-of-kings', relationship: 'partial', sharedCount: 7 },
  ]);
  assert.equal(report.comparisons.filter((comparison) => comparison.relationship === 'none').length, 131);

  const starLordIds = new Set(mapping.rows.map((row) => String(row.selectedIssueId)));
  for (const peerMapping of [rocketMapping, grootMapping]) {
    const sharedIds = peerMapping.rows
      .map((row) => String(row.selectedIssueId))
      .filter((id) => starLordIds.has(id));
    assert.equal(sharedIds.length, 25);
    assert.deepEqual(
      new Set(report.comparisons.find((comparison) => (
        comparison.orderId === peerMapping.id
      )).sharedIds),
      new Set(sharedIds),
    );
  }

  const superSpecial = mapping.rows.find((row) => (
    row.sourceIssueReference === 'Marvel Super Special #10'
  ));
  assert.equal(superSpecial.selectedIssueId, 50896);
  const fcbd = mapping.rows.find((row) => row.sourceIssueReference.startsWith('FCBD 2017'));
  assert.equal(fcbd.selectedIssueId, 62818);
  assert.equal(fcbd.issueNumber, '1');
  assert.equal(fcbd.metadataIssueNumber, '0');
  assert.match(fcbd.note, /source calls this issue #1/i);

  const manifestEntry = manifest.lists.find((entry) => entry.id === starLordCandidateId);
  const catalogEntry = catalog.lists.find((entry) => entry.id === starLordCandidateId);
  assert.equal(manifestEntry.type, 'character-run');
  assert.equal(manifestEntry.spotlightKind, 'complete-guide');
  assert.equal(manifestEntry.group, null);
  assert.equal(manifestEntry.expect, 99);
  assert.equal(catalogEntry.type, 'character-run');
  assert.equal(catalogEntry.spotlightKind, 'complete-guide');
  assert.equal(catalogEntry.count, 99);
  assert.deepEqual(
    parsed.entries.map((entry) => String(entry.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.deepEqual(
    generated.items.map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  const starLordIndex = manifest.lists.findIndex((entry) => entry.id === starLordCandidateId);
  assert.equal(manifest.lists[starLordIndex - 1].id, grootCandidateId);
  assert.equal(manifest.lists[starLordIndex + 1].id, 'thanos-reading-order');
  assert.equal(manifest.lists[starLordIndex + 2].id, 'ant-man-reading-order');
  assert.equal(manifest.lists[starLordIndex + 3].id, 'wolverine-reading-order');
  assert.equal(manifest.lists[starLordIndex + 4].id, hulkCandidateId);
  assert.equal(manifest.lists[starLordIndex + 5].id, doctorStrangeCandidateId);
  assert.equal(manifest.lists[starLordIndex + 6].id, 'daredevil-reading-order');
  assert.equal(manifest.lists[starLordIndex + 7].id, venomCandidateId);
  assert.equal(manifest.lists[starLordIndex + 8].id, magnetoCandidateId);
  assert.equal(manifest.lists[starLordIndex + 9].id, 'loki-reading-order');
  assert.equal(manifest.lists[starLordIndex + 10].id, 'xmen-claremont');

  const reordered = structuredClone(packet);
  const numeric = reordered.rows.slice(65, 77)
    .sort((left, right) => Number(left.issueNumber) - Number(right.issueNumber));
  reordered.rows.splice(65, 12, ...numeric);
  reordered.packetDigest = packetDigestFor(reordered);
  assert.doesNotThrow(() => validateFrozenPacket(reordered));
  assert.throws(() => assertStarLordSourceBoundary(reordered));

  const omittedSourceRow = structuredClone(packet);
  omittedSourceRow.rows.splice(1, 1);
  omittedSourceRow.expectedCount = 98;
  omittedSourceRow.proposedManifest.expect = 98;
  omittedSourceRow.packetDigest = packetDigestFor(omittedSourceRow);
  assert.throws(() => assertStarLordSourceBoundary(omittedSourceRow));

  const stalePacket = structuredClone(packet);
  stalePacket.rows[0].issueNumber = '5';
  assert.throws(() => validateFrozenPacket(stalePacket), /packet digest is stale/i);

  const staleMapping = structuredClone(mapping);
  staleMapping.rows.pop();
  assert.throws(() => validateMappingDigest(staleMapping), /mapping digest is stale/i);

  const staleReport = structuredClone(report);
  staleReport.comparisons.pop();
  assert.throws(() => validateReportDigest(staleReport), /report digest is stale/i);

  const staleRocket = structuredClone(rocketMapping);
  staleRocket.rows[0].selectedIssueId = 9999;
  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    peerMappings: [staleRocket, grootMapping],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /mapping digest is stale/i);

  const staleGroot = structuredClone(grootMapping);
  staleGroot.rows[0].selectedIssueId = 9999;
  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    peerMappings: [rocketMapping, staleGroot],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /mapping digest is stale/i);

  const omittedDisposition = structuredClone(mapping);
  omittedDisposition.relationshipReview.dispositions.pop();
  omittedDisposition.relationshipReview.approvalDigest = approvalDigestFor(
    omittedDisposition.relationshipReview,
  );
  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping: omittedDisposition,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    peerMappings: [rocketMapping, grootMapping],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /relationship dispositions are incomplete/i);

  const staleApproval = structuredClone(mapping);
  staleApproval.relationshipReview.rationale = 'Changed after approval.';
  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping: staleApproval,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    peerMappings: [rocketMapping, grootMapping],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /approval digest is stale/i);

  assert.throws(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: '0'.repeat(64),
    peerMappings: [rocketMapping, grootMapping],
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }), /library changed since relationship review/i);
});

test('the Modern X-Men fast-track preserves its selected source boundary and overlaps', async () => {
  const packet = await readJson(`scripts/data/cbh-packets/${modernXMenCandidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${modernXMenCandidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${modernXMenCandidateId}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/modern_x_men_fast_track.json');
  const markdown = await readFile(
    path.join(root, 'src/data/orders/modern-x-men-fast-track.md'),
    'utf8',
  );
  const parsed = parseChecklist(markdown);
  const reviewedLibraryDigest = await currentPublicationLibraryDigest(manifest, [modernXMenCandidateId]);
  const regeneratedReport = await buildReportForMapping(
    path.join(root, 'scripts', 'data', 'cbh-mappings', `${modernXMenCandidateId}.json`),
  );

  assert.equal(packet.packetDigest, '7ad93b8af0104c6b889e5ceafe49dacde155fe2ec93348e9ae9a2e3c7cc5e46a');
  assert.equal(packet.sourceIssueBearingBlocksSha256, 'f0c54ad986cc4b07f06cc0345d3d909d4e95e2926b2e69aebf8b077c9672c9b5');
  assert.equal(packet.sourceRetrievedAt, '2026-08-25');
  assert.equal(mapping.mappingDigest, '06aaeaf6f659dfd659bcde59ed9ff5dd8df7c6dbb99b456697f47c008fcf3271');
  assert.equal(report.reportDigest, '922f3577b5a4cd06a09fbc43da85f0766c3f14043a4096b9109832a2b3832754');
  assert.equal(reviewedLibraryDigest, '4db363bf73b101913d86ca057d94277324ff63689eb2a6b10923bbe7594b3b4c');
  assert.equal(report.libraryDigest, reviewedLibraryDigest);
  assert.equal(
    mapping.relationshipReview.approvalDigest,
    'ee682d3ce13facbc0b1a64bab256431d6f809a192222cfc951b1f629748b1be8',
  );
  assert.deepEqual(regeneratedReport, report);
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: modernXMenCandidateId,
    catalogEntries: manifest.lists.filter((entry) => entry.id !== modernXMenCandidateId),
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));

  assert.equal(packet.sourceUrl, 'https://www.comicbookherald.com/question-of-the-week-ok-what-the-heck-is-the-right-order-for-x-men-events/');
  assert.equal(packet.sourceSection, 'X-Men Events & Major Stories (2001 to 2015)');
  assert.equal(packet.rows.length, 278);
  assert.equal(mapping.rows.length, 278);
  assert.equal(report.candidateCount, 278);
  assert.equal(report.comparisonCount, 136);
  assert.equal(mapping.relationshipReview.dispositions.length, 136);
  assert.equal(new Set(mapping.rows.map((row) => String(row.selectedIssueId))).size, 278);
  assert.ok(mapping.rows.every((row) => row.resolutionStatus === 'exact'));
  assert.deepEqual(
    mapping.rows.map((row) => row.sourceIssueReference),
    packet.rows.map((row) => row.sourceIssueReference),
  );
  assert.deepEqual(
    [0, 74, 75, 151, 152, 223, 277].map((index) => mapping.rows[index].selectedIssueId),
    [14933, 213, 438, 24631, 27253, 32577, 48632],
  );

  assert.deepEqual(packet.excludedSourceReferences, [
    'House of M, Decimation, Avengers vs. X-Men, Death of Wolverine, Axis, and Marvel Now launch rows are linked event or era references without issue rows on this page',
    'Messiah CompleX links to a separate review instead of printing issue rows on this page',
    'X-Infernus and X-Necrosha are collection-only references with contextual prose but no exact issue range on this page',
    'Guardians of the Galaxy and X-Men: Black Vortex points to a forum reading order instead of printing the issue rows on this page',
    'Classic X-Men and modern X-Men hub links are contextual navigation, not issue-bearing recommendations in the selected section',
  ]);
  assert.deepEqual(
    packet.rows.filter((row) => row.manualSeriesSelectionApproved).map((row) => ({
      reference: row.sourceIssueReference,
      series: row.normalizedSeriesTitle,
      issueId: row.candidateIssueId,
      note: row.selectionNote,
    })),
    [{
      reference: 'Astonishing X-Men Annual #1',
      series: 'Giant-Size Astonishing X-Men',
      issueId: 20674,
      note: 'The source labels the post-#25 capstone as Astonishing X-Men Annual #1; Marvel metadata identifies the 2008 capstone as Giant-Size Astonishing X-Men #1, while Astonishing X-Men Annual #1 is a later 2012 issue.',
    }],
  );

  assert.deepEqual(
    report.comparisons
      .filter((comparison) => comparison.relationship !== 'none')
      .map(({ orderId, relationship, sharedCount }) => ({ orderId, relationship, sharedCount })),
    [
      { orderId: 'dark-reign-avengers', relationship: 'partial', sharedCount: 3 },
      { orderId: 'marvels-best-phoenix-comics', relationship: 'partial', sharedCount: 9 },
      { orderId: 'messiah-war', relationship: 'existing-subset', sharedCount: 10 },
      { orderId: 'second-coming', relationship: 'existing-subset', sharedCount: 23 },
      { orderId: 'x-men-age-of-x', relationship: 'partial', sharedCount: 9 },
      { orderId: 'x-men-battle-of-the-atom', relationship: 'existing-subset', sharedCount: 10 },
      { orderId: 'x-men-curse-of-the-mutants', relationship: 'partial', sharedCount: 6 },
      { orderId: 'x-men-divided-we-stand', relationship: 'partial', sharedCount: 10 },
      { orderId: 'x-men-nation-x', relationship: 'partial', sharedCount: 12 },
      { orderId: 'x-men-regenesis', relationship: 'partial', sharedCount: 6 },
      { orderId: 'x-men-schism', relationship: 'partial', sharedCount: 5 },
      { orderId: 'x-men-trial-of-jean-grey', relationship: 'existing-subset', sharedCount: 6 },
    ],
  );

  const manifestEntry = manifest.lists.find((entry) => entry.id === modernXMenCandidateId);
  const catalogEntry = catalog.lists.find((entry) => entry.id === modernXMenCandidateId);
  assert.equal(manifestEntry, undefined);
  assert.equal(catalogEntry, undefined);
  assert.deepEqual(
    parsed.entries.map((entry) => String(entry.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.deepEqual(
    generated.items.map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.equal(manifest.lists.findIndex((entry) => entry.id === modernXMenCandidateId), -1);
});

test('the first character batch stays exact through evidence, catalog, and generated data', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const reviewedLibraryDigest = await currentPublicationLibraryDigest(manifest, batchCandidateIds);
  const evidence = await Promise.all(batchCandidateIds.map(async (id) => ({
    id,
    packet: await readJson(`scripts/data/cbh-packets/${id}.json`),
    mapping: await readJson(`scripts/data/cbh-mappings/${id}.json`),
    report: await readJson(`scripts/data/cbh-overlaps/${id}.json`),
    generated: await readJson(`src/data/${id.replaceAll('-', '_')}.json`),
    markdown: await readFile(path.join(root, 'src', 'data', 'orders', `${id}.md`), 'utf8'),
  })));
  const expected = {
    'phalanx-reading-order': {
      count: 28,
      checkpoints: [10353, 8664, 102527],
      partials: [
        { orderId: 'phalanx-covenant', relationship: 'existing-subset', sharedCount: 9 },
        { orderId: 'xmen-claremont', relationship: 'partial', sharedCount: 8 },
        { orderId: 'xmen-claremont-complete', relationship: 'partial', sharedCount: 8 },
      ],
    },
    'marvels-best-phoenix-comics': {
      count: 53,
      checkpoints: [8605, 70250, 109787],
      partials: [
        { orderId: 'thanos-reading-order', relationship: 'partial', sharedCount: 1 },
      ],
    },
  };

  assert.equal(reviewedLibraryDigest, 'd6ec86d326d603674be92e884aa6973ff844f6dca8ac7bf77ef00f8533bf083e');
  for (const item of evidence) {
    const peer = evidence.find((candidate) => candidate.id !== item.id);
    const inventoryRecord = inventory.find((record) => record.id === item.id);
    const parsed = parseChecklist(item.markdown);
    const config = expected[item.id];
    assert.doesNotThrow(() => validateFrozenPacket(item.packet, {
      expectedId: item.id,
      inventoryRecord,
      catalogEntries: manifest.lists,
    }));
    assert.doesNotThrow(() => validateMappingDigest(item.mapping));
    assert.doesNotThrow(() => validateReportDigest(item.report));
    assert.doesNotThrow(() => assertApprovedRelationshipReview({
      packet: item.packet,
      mapping: item.mapping,
      report: item.report,
      currentLibraryDigest: reviewedLibraryDigest,
      peerMappings: [peer.mapping],
      expectedOrderIds: item.report.comparisons.map((comparison) => comparison.orderId),
    }));

    assert.equal(item.mapping.rows.length, config.count);
    assert.equal(item.report.candidateCount, config.count);
    assert.equal(item.report.comparisonCount, 135);
    assert.ok(item.mapping.rows.every((row) => row.resolutionStatus === 'exact'));
    assert.equal(new Set(item.mapping.rows.map((row) => String(row.selectedIssueId))).size, config.count);
    assert.deepEqual(
      [item.mapping.rows[0], item.mapping.rows[Math.floor(config.count / 2)], item.mapping.rows.at(-1)]
        .map((row) => row.selectedIssueId),
      config.checkpoints,
    );
    assert.deepEqual(
      item.report.comparisons
        .filter((comparison) => comparison.relationship !== 'none')
        .map(({ orderId, relationship, sharedCount }) => ({ orderId, relationship, sharedCount })),
      config.partials,
    );
    assert.equal(manifest.lists.find((entry) => entry.id === item.id).group, null);
    assert.equal(catalog.lists.find((entry) => entry.id === item.id).count, config.count);
    assert.deepEqual(
      parsed.entries.map((entry) => String(entry.issueId)),
      item.mapping.rows.map((row) => String(row.selectedIssueId)),
    );
    assert.deepEqual(
      item.generated.items.map((row) => String(row.issueId)),
      item.mapping.rows.map((row) => String(row.selectedIssueId)),
    );
  }

  const allBatchIds = evidence.flatMap((item) => item.mapping.rows.map((row) => String(row.selectedIssueId)));
  assert.equal(new Set(allBatchIds).size, 81);
  assert.equal(catalog.lists.length, 237);
  const characterRuns = catalog.lists.filter((entry) => entry.type === 'character-run');
  assert.equal(characterRuns.length, 33);
  assert.equal(new Set(characterRuns.map((entry) => entry.group ?? entry.id)).size, 32);
});

test('Venom preserves every source occurrence through its published guide', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const packet = await readJson(`scripts/data/cbh-packets/${venomCandidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${venomCandidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${venomCandidateId}.json`);
  const generated = await readJson('src/data/venom_reading_order.json');
  const markdown = await readFile(path.join(root, 'src/data/orders/venom-reading-order.md'), 'utf8');
  const parsed = parseChecklist(markdown);
  const record = inventory.find((entry) => entry.id === venomCandidateId);
  const reviewedLibraryDigest = await currentPublicationLibraryDigest(manifest, [venomCandidateId]);

  assert.equal(record?.centralDisposition, 'pilot-approved');
  assert.equal(record?.deliveryStatus, 'ready');
  assert.equal(record?.metadataHorizonStatus, 'approved');
  assert.match(record?.reason ?? '', /610 exact provider-resolved comics/i);
  assert.match(record?.reason ?? '', /33 explicit open metadata gaps/i);
  assert.match(record?.reason ?? '', /22 approved non-none relationships/i);
  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: venomCandidateId,
    inventoryRecord: record,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));

  assert.equal(packet.sourceOccurrenceCount, 932);
  assert.equal(packet.rows.length, 610);
  assert.equal(packet.repeatedSourceReferences.length, 286);
  assert.equal(packet.sourceGaps.length, 33);
  assert.equal(new Set([
    ...packet.rows,
    ...packet.repeatedSourceReferences,
    ...packet.sourceGaps,
  ].map((entry) => entry.sourceRangeReference)).size, 125);
  assert.deepEqual(packet.excludedSourceRows.map((entry) => [
    entry.sourcePosition,
    entry.sourceIssueReference,
  ]), [
    [29, 'Marvel Graphic Novel #68'],
    [99, 'Silver Sable & the Wild Pack #18'],
    [100, 'Silver Sable & the Wild Pack #19'],
  ]);
  assert.deepEqual(packet.sourceGaps.map((entry) => entry.sourcePosition), [
    898, 899, 900, 901, 902, 903, 905, 906, 907, 908, 909, 910, 911, 912, 913, 914,
    915, 916, 917, 918, 920, 921, 922, 923, 924, 925, 926, 927, 928, 929, 930, 931, 932,
  ]);
  assert.equal(mapping.rows.length, 610);
  assert.equal(new Set(mapping.rows.map((row) => String(row.selectedIssueId))).size, 610);
  assert.deepEqual(mapping.sourceGaps, packet.sourceGaps);
  assert.equal(report.candidateCount, 610);
  assert.equal(report.comparisonCount, 136);
  assert.equal(report.libraryDigest, reviewedLibraryDigest);
  assert.equal(record?.overlapIds.length, 22);
  const reportOverlapIds = report.comparisons
    .filter((comparison) => comparison.relationship !== 'none')
    .map((comparison) => comparison.orderId);
  assert.equal(reportOverlapIds.length, 13);
  assert.ok(reportOverlapIds.every((id) => record?.overlapIds.includes(id)));
  assert.equal(mapping.relationshipReview.authorityIdentity, 'GPT-5.6 Terra');
  assert.equal(mapping.relationshipReview.dispositions.length, 136);
  assert.match(mapping.relationshipReview.rationale, /155 current catalog orders/);
  assert.match(mapping.relationshipReview.rationale, /Twenty-two non-none relationships/);

  const manifestEntry = manifest.lists.find((entry) => entry.id === venomCandidateId);
  const catalogEntry = catalog.lists.find((entry) => entry.id === venomCandidateId);
  assert.equal(manifestEntry?.expect, 643);
  assert.equal(catalogEntry?.count, 643);
  assert.equal(generated.items.length, 643);
  assert.equal(generated.placeholders, 33);
  assert.deepEqual(
    generated.items.filter((item) => !item.placeholder).map((item) => String(item.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.deepEqual(
    parsed.entries.map((entry) => String(entry.issueId)),
    mapping.rows.map((row) => String(row.selectedIssueId)),
  );
  assert.equal(parsed.unresolved.length, 33);
});

test('Magneto preserves cache-only source accounting through publication', async () => {
  const inventory = await readJson('scripts/data/cbh-character-inventory.json');
  const packet = await readJson(`scripts/data/cbh-packets/${magnetoCandidateId}.json`);
  const mapping = await readJson(`scripts/data/cbh-mappings/${magnetoCandidateId}.json`);
  const report = await readJson(`scripts/data/cbh-overlaps/${magnetoCandidateId}.json`);
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const generated = await readJson('src/data/magneto_reading_order.json');
  const markdown = await readFile(path.join(root, 'src/data/orders/magneto-reading-order.md'), 'utf8');
  const ledger = await readJson('scripts/data/cbh-source-ledgers/magneto-occurrences.json');
  const record = inventory.find((entry) => entry.id === magnetoCandidateId);
  const parsed = parseChecklist(markdown);
  const reviewedLibraryDigest = await historicalReportLibraryDigest(
    manifest,
    [magnetoCandidateId],
  );
  const positions = [
    ...sourcePositionsForPacket(packet),
    ...packet.repeatedSourceReferences.map((entry) => entry.sourcePosition),
    ...packet.sourceGaps.map((entry) => entry.sourcePosition),
    ...packet.excludedSourceRows.map((entry) => entry.sourcePosition),
  ];

  assert.doesNotThrow(() => validateFrozenPacket(packet, {
    expectedId: magnetoCandidateId,
    inventoryRecord: record,
    catalogEntries: manifest.lists,
  }));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet,
    mapping,
    report,
    currentLibraryDigest: reviewedLibraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));

  assert.equal(packet.sourceOccurrenceCount, 811);
  assert.equal(packet.rows.length, 695);
  assert.equal(packet.repeatedSourceReferences.length, 47);
  assert.equal(packet.sourceGaps.length, 58);
  assert.equal(packet.excludedSourceRows.length, 11);
  assert.equal(new Set(positions).size, 811);
  assert.deepEqual(
    [...positions].sort((left, right) => left - right),
    Array.from({ length: 811 }, (_, index) => index + 1),
  );
  assert.equal(new Set(mapping.rows.map((row) => String(row.selectedIssueId))).size, 695);
  const originalRepeatPositions = new Set(
    ledger.occurrences
      .filter((entry) => entry.disposition === 'repeat')
      .map((entry) => entry.sourcePosition),
  );
  const resolvedDuplicateRepeats = packet.repeatedSourceReferences.filter((entry) => (
    !originalRepeatPositions.has(entry.sourcePosition)
  ));
  assert.equal(resolvedDuplicateRepeats.length, 16);
  assert.equal(
    new Set(resolvedDuplicateRepeats.map((entry) => entry.canonicalRow)).size,
    16,
  );
  assert.ok(resolvedDuplicateRepeats.every((entry) => (
    Number.isInteger(entry.canonicalRow)
      && packet.rows[entry.canonicalRow - 1]?.candidateIssueId != null
  )));
  assert.equal(
    packet.repeatedSourceReferences.filter((entry) => Object.hasOwn(entry, 'canonicalGapSourcePosition')).length,
    1,
  );
  assert.ok(packet.sourceGaps.every((gap) => gap.auditBasis.includes('Issue #306')));
  assert.equal(report.comparisonCount, 157);
  assert.equal(report.comparisons.filter((entry) => entry.relationship !== 'none').length, 48);
  assert.equal(mapping.relationshipReview.authorityIdentity, 'GPT-5.6 Terra');
  assert.equal(record?.deliveryStatus, 'shipped');
  assert.equal(manifest.lists.find((entry) => entry.id === magnetoCandidateId)?.expect, 753);
  assert.equal(catalog.lists.find((entry) => entry.id === magnetoCandidateId)?.count, 753);
  assert.equal(generated.items.length, 753);
  assert.equal(parsed.entries.length, 695);
  assert.equal(parsed.unresolved.length, 58);
});
