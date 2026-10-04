import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertApprovedRelationshipReview, buildMarkdown } from '../scripts/author-cbh-packet.mjs';
import { validateInventoryState } from '../scripts/lib/cbh-inventory.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import {
  catalogListShelf, decadeSections, groupCatalog, parseCatalog, shelfLists, shelfStories,
} from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { countOrderGaps } from '../src/js/lib/model.js';

const id = 'marvel-zombies-reading-order';
const readJson = async (path) => JSON.parse(await readFile(new URL(`../${path}`, import.meta.url), 'utf8'));
const sortedJson = (value) => JSON.stringify(value, (_key, entry) => (
  entry && !Array.isArray(entry) && typeof entry === 'object'
    ? Object.fromEntries(Object.entries(entry).sort(([a], [b]) => a.localeCompare(b)))
    : entry
));
const digest = (value) => createHash('sha256').update(sortedJson(value)).digest('hex');

test('Marvel Zombies maintained source ledger independently accounts for every frozen occurrence', async () => {
  const [ledger, packet, mapping] = await Promise.all([
    readJson(`scripts/data/cbh-source-ledgers/${id}.json`),
    readJson(`scripts/data/cbh-packets/${id}.json`),
    readJson(`scripts/data/cbh-mappings/${id}.json`),
  ]);
  assert.equal(ledger.sourceContent.sha256, packet.sourceContentSha256);
  assert.equal(ledger.sourceContent.issueBearingSha256, packet.sourceIssueBearingBlocksSha256);
  assert.equal(ledger.sourceRetrievedAt, packet.sourceRetrievedAt);
  assert.equal(ledger.sourceContent.nodeCount, 66);
  assert.equal(ledger.sourceContent.issueBearingNodeIndexes.length, 52);
  assert.match(ledger.sourceContent.normalization, /NFC.*final LF/);
  assert.equal(digest({
    sections: ledger.sections,
    blocks: ledger.blocks,
    occurrences: ledger.occurrences,
    excludedReferences: ledger.excludedReferences,
  }), ledger.factualProjectionSha256);
  assert.equal(ledger.factualProjectionSha256,
    '90f209fa3f37a11602d73081e1d326012a8db8c1c8aae9a49e6c4b7c4bfd75ed');
  assert.equal(digest(ledger.occurrences), ledger.sourceVectorSha256);
  assert.equal(ledger.sourceVectorSha256,
    '7fea637b4dc11983a1bcaed70e09bbb72084cef0d846252d02e66e47b04e3d06');

  const issueBearingNodes = new Set(ledger.sourceContent.issueBearingNodeIndexes);
  const sourceRows = ledger.blocks.flatMap((block) => block.runs.flatMap((run) => {
    assert(issueBearingNodes.has(run.sourceNodeIndex));
    assert(block.sourceNodeIndexes.includes(run.sourceNodeIndex));
    const [first, last] = run.positions;
    assert.equal(last - first + 1, run.issueNumbers.length);
    const prefix = run.raw.includes('#')
      ? run.raw.split('#')[0].trim()
      : run.raw.replace(/\s+\d+(?:-\d+)?$/, '');
    assert(prefix.toLowerCase().startsWith(run.sourceSeries.toLowerCase()));
    return run.issueNumbers.map((number, index) => ({
      sourcePosition: first + index,
      blockId: block.id,
      sourceNodeIndex: run.sourceNodeIndex,
      sourceIssueReference: `${prefix} #${number}`,
      sourceIssueNumber: number,
      originalSeriesId: run.originalSeriesId,
      originalSeriesYear: run.originalSeriesYear,
      ...(run.canonicalSourcePosition
        ? { canonicalSourcePosition: run.canonicalSourcePosition } : {}),
      section: block.section,
    }));
  }));
  assert.deepEqual(sourceRows.map((row) => row.sourcePosition),
    Array.from({ length: 95 }, (_, index) => index + 1));
  assert.deepEqual(sourceRows.map(({ section: _section, ...row }) => row),
    ledger.occurrences.map(({
      disposition: _disposition, selectedIssueId: _selectedIssueId, ...row
    }) => row));
  assert.deepEqual(ledger.sections.map((section) => section.occurrenceCount), [63, 9, 8, 6, 9]);
  assert.deepEqual(ledger.sections.map((section) => section.label), [
    'Marvel Zombies Comic Book Reading Order',
    'Deadpool Vs. Zombies',
    "Zombies In Marvel's Secret Wars (2015)",
    'Marvel Zombies Resurrection Era',
    'Out of Continuity Additions:',
  ]);
  assert.deepEqual(ledger.sections.map((section) =>
    sourceRows.filter((row) => row.section === section.label).length),
  ledger.sections.map((section) => section.occurrenceCount));

  const mapped = new Map(mapping.rows.map((row) => [row.sourcePosition, row]));
  const packetRows = new Map(packet.rows.map((row) => [row.sourcePosition, row]));
  const gaps = new Map(packet.sourceGaps.map((row) => [row.sourcePosition, row]));
  const repeats = new Map(packet.repeatedSourceReferences.map((row) =>
    [row.sourcePosition, row]));
  assert.equal(ledger.counts.rawBlockCount, 17);
  assert.equal(ledger.counts.sourceOccurrenceCount, packet.sourceOccurrenceCount);
  assert.equal(mapping.approvedSourceCount, ledger.counts.sourceOccurrenceCount);
  assert.equal(ledger.counts.canonicalIdentityCount, packetRows.size + gaps.size);
  assert.equal(ledger.counts.exactOriginalCount, mapped.size);
  assert.equal(ledger.counts.openMetadataGapCount, gaps.size);
  assert.equal(ledger.counts.backwardRepeatCount, repeats.size);
  assert.deepEqual([...gaps.keys()], [93, 94, 95]);
  assert.deepEqual([...repeats.keys()], [73]);
  assert.equal(repeats.get(73).canonicalRow, 4);
  assert.equal(sourceRows[72].originalSeriesId, sourceRows[3].originalSeriesId);
  assert.equal(mapped.get(4).selectedIssueId, 3220);
  assert.equal(ledger.excludedReferences.length, 9);
  assert(ledger.excludedReferences.some((entry) => (
    entry.rawReference === 'Marvel Apes: Prime Eight 1'
    && entry.disposition === 'collection-only nonselection'
  )));

  for (const occurrence of ledger.occurrences) {
    const { sourcePosition: position, sourceIssueReference: reference } = occurrence;
    const row = mapped.get(position);
    const gap = gaps.get(position);
    const repeat = repeats.get(position);
    assert.equal(Number(Boolean(row)) + Number(Boolean(gap)) + Number(Boolean(repeat)), 1,
      `Source position ${position} must have exactly one packet disposition`);
    assert.equal(occurrence.disposition,
      repeat ? 'backward-repeat' : gap ? 'open-metadata-gap' : 'canonical-original');
    assert.equal(occurrence.selectedIssueId, row?.selectedIssueId
      ?? (repeat ? mapped.get(repeat.canonicalRow)?.selectedIssueId : null));
    assert.equal(reference, (row ?? gap ?? repeat).sourceIssueReference);
    if (row) {
      assert.equal(occurrence.originalSeriesId, row.seriesId);
      assert.equal(occurrence.originalSeriesYear, row.seriesYear);
      assert.equal(packetRows.get(position).sourceIssueReference, reference);
    }
    if (gap) {
      assert.equal(occurrence.originalSeriesId, 44562);
      assert.equal(occurrence.originalSeriesYear, gap.seriesYear);
    }
    if (repeat) {
      assert.equal(occurrence.canonicalSourcePosition, repeat.canonicalRow);
      assert.equal(occurrence.originalSeriesId, mapped.get(repeat.canonicalRow).seriesId);
    }
  }
});

test('Marvel Zombies named author preserves all five distinct source sections', async () => {
  const mapping = JSON.parse(await readFile(new URL(
    `../scripts/data/cbh-mappings/${id}.json`, import.meta.url,
  ), 'utf8'));
  const markdown = await readFile(new URL(
    `../src/data/orders/${id}.md`, import.meta.url,
  ), 'utf8');
  assert.equal(markdown.replace(/\r\n/g, '\n'), buildMarkdown(mapping));

  const expectedSections = [
    'Marvel Zombies Comic Book Reading List',
    'Deadpool Vs. Zombies',
    "Zombies In Marvel's Secret Wars (2015)",
    'Marvel Zombies Resurrection Era',
    'Out of Continuity Additions:',
  ];
  const headings = markdown.split(/\r?\n/).filter((line) => line.startsWith('## '));
  const actualSections = headings.map((heading) => expectedSections.find((section) => (
    heading.startsWith(`## ${section} | `)
  )));
  assert(actualSections.every(Boolean), 'Every generated heading must identify its source universe');
  assert.deepEqual([...new Set(actualSections)], expectedSections);

  const parsed = parseChecklist(markdown);
  assert.equal(parsed.entries.length, 91);
  assert.equal(parsed.unresolved.length, 3);
  assert.deepEqual(parsed.unresolved.map((row) => row.sourceKey), ['93', '94', '95']);
});

test('Marvel Zombies publishes every approved original and open gap in its exact source position', async () => {
  const [mapping, packet, payload, markdown] = await Promise.all([
    readJson(`scripts/data/cbh-mappings/${id}.json`),
    readJson(`scripts/data/cbh-packets/${id}.json`),
    readJson('src/data/marvel_zombies_reading_order.json'),
    readFile(new URL(`../src/data/orders/${id}.md`, import.meta.url), 'utf8'),
  ]);
  const parsed = parseChecklist(markdown);
  const expected = [
    ...mapping.rows.map((row) => ({
      sourceKey: String(row.sourcePosition),
      issueId: row.selectedIssueId,
      title: row.resolvedIssueTitle,
    })),
    ...packet.sourceGaps.map((gap) => ({
      sourceKey: String(gap.sourcePosition),
      issueId: null,
      title: gap.sourceIssueReference,
    })),
  ].sort((a, b) => Number(a.sourceKey) - Number(b.sourceKey));
  const projected = [...parsed.entries, ...parsed.unresolved]
    .map((entry) => ({
      sourceKey: entry.sourceKey,
      issueId: entry.issueId ?? null,
      title: entry.title,
    }))
    .sort((a, b) => Number(a.sourceKey) - Number(b.sourceKey));

  assert.equal(payload.count, 94);
  assert.equal(payload.items.length, 94);
  assert.equal(payload.collections, 26);
  assert.equal(payload.placeholders, 3);
  assert.deepEqual(expected, projected);
  assert.deepEqual(payload.items.map((item, index) => ({
    sourceKey: expected[index].sourceKey,
    issueId: item.placeholder ? null : item.issueId,
    title: item.title,
  })), expected);
  assert.deepEqual(payload.unresolved.map((row) => [
    row.sourceKey, row.index, payload.items[row.index]?.issueId, row.title,
  ]), [
    ['93', 91, -213508517, 'Marvel Zombies (2025) #3'],
    ['94', 92, -129620422, 'Marvel Zombies (2025) #4'],
    ['95', 93, -112842803, 'Marvel Zombies (2025) #5'],
  ]);
  assert.deepEqual(payload.items.slice(-3).map((item) =>
    [item.placeholder, item.url, item.digitalId]), [
    [true, null, null], [true, null, null], [true, null, null],
  ]);
  assert.equal(payload.items[3].issueId, 3220);
  assert.equal(payload.items.filter((item) => item.issueId === 3220).length, 1);
  assert.equal(payload.items.find((item) => item.issueId === 73360).title,
    'Marvel Zombie (2018) #1');
  assert.ok(payload.items.every((item) => item.description === null));
});

test('Marvel Zombies renewed relationship receipt covers every current library peer', async () => {
  const [packet, mapping, report, manifest] = await Promise.all([
    readJson(`scripts/data/cbh-packets/${id}.json`),
    readJson(`scripts/data/cbh-mappings/${id}.json`),
    readJson(`scripts/data/cbh-overlaps/${id}.json`),
    readJson('src/data/curated-lists.json'),
  ]);
  const current = await buildReportForMapping(
    `scripts/data/cbh-mappings/${id}.json`, [], {
      excludedOrderIds: ['ms-marvel-kamala-khan-reading-order', 'nova-reading-order', 'ultimate-spider-man-reading-order', 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide', 'shang-chi-master-of-kung-fu-reading-order', 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order', 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order', 'namor-sub-mariner-reading-order', 'iron-fist-reading-order', 'mcu-prep-thunderbolts', 'spider-man-no-way-home-owner-selected', 'mcu-prep-daredevil-born-again', 'mcu-prep-moon-knight', 'mcu-prep-deadpool-and-wolverine', 'mcu-prep-eternals'],
    },
  );
  const expectedOrderIds = manifest.lists.filter((entry) => entry.id !== 'shang-chi-master-of-kung-fu-reading-order' && entry.id !== 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order' && entry.id !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order' && entry.id !== id).filter((row) => row.id !== 'namor-sub-mariner-reading-order' && row.id !== 'iron-fist-reading-order' && row.id !== 'mcu-prep-daredevil-born-again' && row.id !== 'mcu-prep-moon-knight' && row.id !== 'mcu-prep-deadpool-and-wolverine' && row.id !== 'mcu-prep-eternals' && row.id !== 'spider-man-no-way-home-owner-selected' && row.id !== 'mcu-prep-thunderbolts')
    .filter((entry) => entry.id !== 'ms-marvel-kamala-khan-reading-order'
      && entry.id !== 'nova-reading-order'
      && entry.id !== 'ultimate-spider-man-reading-order' && entry.id !== 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide')
    .map((entry) => entry.id);
  assert.deepEqual(current, report);
  assert.equal(report.comparisonCount, 193);
  assert.deepEqual(new Set(report.comparisons.map((entry) => entry.orderId)),
    new Set(expectedOrderIds));
  assert.equal(mapping.reviewStatus, 'approved');
  assert.deepEqual(mapping.approvedManifest, manifest.lists.find((entry) => entry.id === id));
  assert.equal(mapping.relationshipReview.approvalDigest,
    '1d41cde7518c02234a7a00c91c7cae17f3dd038685a74f7eb9d293692034f02f');
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: current.libraryDigest, expectedOrderIds,
  }));
  for (const peer of [
    'hawkeye-reading-order',
    'silk-cindy-moon-reading-order',
    'marvels-infinity-saga-gauntlet-wars-crusade-reading-order',
  ]) {
    assert.deepEqual(report.comparisons.find((entry) => entry.orderId === peer), {
      orderId: peer, sharedCount: 0, sharedIds: [], relationship: 'none',
    });
  }
});

test('Marvel Zombies appears once on the across-eras Storylines shelf with its approved cover', async () => {
  const [manifest, rawCatalog, payload, inventory, report, packet] = await Promise.all([
    readJson('src/data/curated-lists.json'),
    readJson('src/data/catalog.json'),
    readJson('src/data/marvel_zombies_reading_order.json'),
    readJson('scripts/data/cbh-character-inventory.json'),
    readJson(`scripts/data/cbh-overlaps/${id}.json`),
    readJson(`scripts/data/cbh-packets/${id}.json`),
  ]);
  const catalog = parseCatalog(rawCatalog);
  const card = catalog.lists.find((entry) => entry.id === id);
  const manifestIndex = manifest.lists.findIndex((entry) => entry.id === id);
  const record = inventory.find((entry) => entry.id === id);
  const peers = report.comparisons.filter((entry) => entry.relationship !== 'none')
    .map((entry) => entry.orderId).sort();

  assert.equal(catalog.dropped, 0);
  assert.equal(manifest.lists[manifestIndex + 1].id, 'house-of-m');
  assert.equal(card.file, manifest.lists[manifestIndex].out);
  assert.equal(manifest.lists[manifestIndex].sourcePage, packet.sourceUrl);
  assert.equal(manifest.lists[manifestIndex].sourceOrigin,
    "Compiled for this project from Comic Book Herald's guide");
  assert.equal(manifest.lists[manifestIndex].sourceLicense, null);
  assert.equal(card.source, packet.sourceUrl);
  assert.equal(card.sourceOrigin, manifest.lists[manifestIndex].sourceOrigin);
  assert.equal(card.type, 'era');
  assert.equal(card.depth, 'partial');
  assert.equal(card.timeline, null);
  assert.equal(Object.hasOwn(rawCatalog.lists.find((entry) => entry.id === id), 'spotlightKind'), false);
  assert.equal(card.spotlightKind, null);
  assert.equal(card.count, 94);
  assert.equal(card.placeholderCount, 3);
  assert.equal(card.emptyRecordCount, 0);
  assert.equal(card.collections, 26);
  assert.deepEqual(countOrderGaps(payload), { placeholders: 3, empty: 0 });
  assert.equal(card.coverIssueId, 3220);
  assert.deepEqual(card.cover, payload.items.find((item) => item.issueId === 3220).cover);
  assert.match(card.cover.path, /^https:\/\//);
  assert.equal(catalogListShelf(catalog.lists, id), 'lines');
  assert.equal(shelfLists(catalog.lists, 'spotlights').some((entry) => entry.id === id), false);
  const story = shelfStories(groupCatalog(catalog.lists), 'lines')
    .find((entry) => entry.lists.some((list) => list.id === id));
  assert.ok(story);
  const sections = decadeSections([story]);
  assert.deepEqual(sections.map((section) => section.heading), ['Across eras']);

  assert.equal(record.position, 70);
  assert.equal(record.guideType, 'era');
  assert.equal(record.deliveryStatus, 'shipped');
  assert.deepEqual(record.catalogIds, [id]);
  assert.equal(record.sourceRetrievedAt, packet.sourceRetrievedAt);
  assert.equal(record.sourceContentSha256, packet.sourceContentSha256);
  assert.equal(peers.length, 8);
  assert.deepEqual(record.overlapIds, peers);
  assert.doesNotThrow(() => validateInventoryState(inventory));
});
