import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  assertMappingMatchesPacketOccurrences,
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

import { placeholderId } from '../scripts/lib/placeholder-id.mjs';
import { parseCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  buildHistoricalReadingChoiceReport as buildReportForMapping,
  loadHistoricalReadingChoiceLibrary as loadLibrarySnapshot,
} from './helpers/reading-choice-history.mjs';

const id = 'ultimate-spider-man-reading-order';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const packet = await readJson(`scripts/data/cbh-packets/${id}.json`);
const mapping = await readJson(`scripts/data/cbh-mappings/${id}.json`);
const report = await readJson(`scripts/data/cbh-overlaps/${id}.json`);
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}.json`);
const rowAt = (position) => mapping.rows.find((row) => row.sourcePosition === position);
const superSpecialPlaceholderId = -363711502;
const refusedIds = [113900, 113901, 129224, 129225, 129226, 129227, 129228, 127659];

const originalByAlias = {
  'peter-2000': ['Ultimate Spider-Man', 2000, 466],
  'team-up': ['Ultimate Marvel Team-Up', 2001, 2311],
  'super-special': ['Ultimate Spider-Man Super Special', 2002, null],
  'ultimate-six': ['Ultimate Six', 2003, 419],
  'peter-annual': ['Ultimate Spider-Man Annual', 2005, 1054],
  ultimatum: ['Ultimatum', 2008, 6182],
  requiem: ['Ultimatum: Spider-Man Requiem', 2009, 8548],
  'peter-2009': ['Ultimate Spider-Man', 2009, 8509],
  'avengers-ultimates': ['Ultimate Avengers Vs. New Ultimates', 2011, 12615],
  fallout: ['Ultimate Fallout', 2011, 14807],
  'miles-2011': ['Ultimate Comics Spider-Man', 2011, 13831],
  'spider-men': ['Spider-Men', 2012, 16264],
  'ultimates-divided': ['Ultimate Comics Ultimates', 2011, 13936],
  'miles-2014': ['Miles Morales: Ultimate Spider-Man', 2014, 18508],
  'peter-legacy-200': ['Ultimate Spider-Man', 2011, 17580],
  'x-men-adventure': ['All-New X-Men', 2012, 16449],
  'all-new-ultimates': ['All-New Ultimates', 2014, 18524],
  'spider-man-2016': ['Spider-Man', 2016, 20508],
  'champions-2016': ['Champions', 2016, 22552],
  'champions-infinity-countdown': ['Infinity Countdown: Champions', 2018, 24909],
  'champions-annual': ['Champions Annual', 2018, 26270],
  'new-ultimate-2024': ['Ultimate Spider-Man', 2024, 38809],
  'fcbd-2025': ['FREE COMIC BOOK DAY 2025: AMAZING SPIDER-MAN/ULTIMATE UNIVERSE', 2025, 43447],
  'incursion-2025': ['Ultimate Spider-Man: Incursion', 2025, 43373],
  endgame: ['Ultimate Endgame', 2025, null],
  'finale-2026': ['Ultimate Universe: Finale', 2026, null],
};

function expandSourceBlocks(blocks) {
  const occurrences = [];
  for (const [blockIndex, block] of blocks.entries()) {
    for (const [alias, ranges] of block.entries) {
      assert.ok(Object.hasOwn(originalByAlias, alias), `Unknown original-volume alias ${alias}`);
      for (const part of ranges.split(',')) {
        const range = /^(\d+)-(\d+)$/.exec(part);
        if (range) {
          const start = Number(range[1]);
          const end = Number(range[2]);
          assert.ok(start <= end, `Descending source range ${part}`);
          for (let number = start; number <= end; number += 1) {
            occurrences.push({
              sourcePosition: occurrences.length + 1,
              section: block.section,
              sourceBlock: blockIndex + 1,
              seriesAlias: alias,
              sourceRangeReference: `${ledger.seriesAliases[alias]} #${ranges}`,
              sourceIssueReference: `${ledger.seriesAliases[alias]} #${number}`,
              issueNumber: String(number),
              disposition: 'canonical',
            });
          }
        } else {
          assert.match(part, /^\d+(?:\.[A-Za-z0-9]+)?$/, `Invalid source issue ${part}`);
          occurrences.push({
            sourcePosition: occurrences.length + 1,
            section: block.section,
            sourceBlock: blockIndex + 1,
            seriesAlias: alias,
            sourceRangeReference: `${ledger.seriesAliases[alias]} #${ranges}`,
            sourceIssueReference: `${ledger.seriesAliases[alias]} #${part}`,
            issueNumber: part,
            disposition: 'canonical',
          });
        }
      }
    }
  }
  return occurrences;
}

test('Ultimate Spider-Man preserves its measured source projection and every selected position', () => {
  const digest = createHash('sha256')
    .update(JSON.stringify(ledger.sourceProjection.blocks), 'utf8').digest('hex');
  assert.equal(digest, 'e79aafcfbba7a97411fcf7983adee3e903243ff341e75ac35a21accb9f91815c');
  assert.equal(ledger.sourceContentSha256, digest);
  assert.equal(ledger.sourceIssueBearingBlocksSha256, digest);
  assert.equal(packet.sourceContentSha256, digest);
  assert.equal(packet.sourceIssueBearingBlocksSha256, digest);
  assert.deepEqual(ledger.sections.map((section) => section.occurrenceCount), [197, 72, 47, 36]);
  assert.deepEqual(ledger.sections.map((section) => section.universe), [
    'Earth-1610, original and 2009 relaunch through Ultimate Fallout',
    'Earth-1610 Miles through Secret Wars pointer',
    'post-Secret-Wars Miles, 2016 Spider-Man and Champions selections',
    'new Ultimate universe, separate from the earlier Earth-1610 and post-Secret-Wars routes',
  ]);
  assert.equal(ledger.blocks.length, 46);
  assert.equal(ledger.blocks.reduce((total, block) => total + block.occurrenceCount, 0), 352);
  assert.equal(ledger.occurrences.length, 352);
  assert.deepEqual(ledger.occurrences.map((row) => row.sourcePosition),
    Array.from({ length: 352 }, (_, index) => index + 1));
  assert.ok(ledger.occurrences.every((row) => row.disposition === 'canonical'));
  assert.equal(packet.sourceOccurrenceCount, 352);
  assert.equal(packet.rows.length, 351);
  assert.equal(packet.expectedCount, 351);
  assert.equal(packet.proposedManifest.expect, 352);
  assert.equal(packet.sourceGaps.length, 1);
  assert.equal(packet.sourceGaps[0].sourcePosition, 44);
  assert.equal(packet.repeatedSourceReferences, undefined);
  assert.deepEqual([...mapping.rows, ...mapping.sourceGaps]
    .sort((left, right) => left.sourcePosition - right.sourcePosition)
    .map((row) => row.sourcePosition), Array.from({ length: 352 }, (_, index) => index + 1));
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
});

test('all 46 source blocks independently expand to the exact 352-position original-volume sequence', () => {
  const expanded = expandSourceBlocks(ledger.sourceProjection.blocks);
  assert.equal(expanded.length, 352);
  assert.deepEqual(Object.keys(originalByAlias).sort(), Object.keys(ledger.seriesAliases).sort());
  assert.deepEqual(expanded, ledger.occurrences);
  let start = 1;
  for (const [index, block] of ledger.blocks.entries()) {
    const fromSource = expanded.filter((row) => row.sourceBlock === index + 1);
    assert.deepEqual(
      [block.block, block.section, block.firstSourcePosition, block.lastSourcePosition, block.occurrenceCount],
      [index + 1, ledger.sourceProjection.blocks[index].section,
        start, start + fromSource.length - 1, fromSource.length],
    );
    assert.deepEqual(block.entries, ledger.sourceProjection.blocks[index].entries);
    start += fromSource.length;
  }
  assert.equal(start, 353);
  const exact = new Map(packet.rows.map((row) => [row.sourcePosition, row]));
  const mapped = new Map(mapping.rows.map((row) => [row.sourcePosition, row]));
  for (const occurrence of expanded) {
    const { sourcePosition, seriesAlias, issueNumber, sourceIssueReference } = occurrence;
    const packetRow = exact.get(sourcePosition) ?? packet.sourceGaps.find((row) => (
      row.sourcePosition === sourcePosition
    ));
    const mappingRow = mapped.get(sourcePosition) ?? mapping.sourceGaps.find((row) => (
      row.sourcePosition === sourcePosition
    ));
    assert.ok(packetRow && mappingRow, `Source position ${sourcePosition} has no reviewed resolution`);
    const [title, year, seriesId] = originalByAlias[seriesAlias];
    const expectedOriginal = `${title} (${year}) #${issueNumber}`;
    for (const row of [packetRow, mappingRow]) {
      assert.equal(row.sourcePosition, sourcePosition);
      assert.equal(row.sourceIssueReference, expectedOriginal);
      assert.deepEqual([row.normalizedSeriesTitle, row.seriesYear, row.seriesId ?? null],
        [title, year, seriesId], sourceIssueReference);
      assert.equal(row.issueNumber, sourcePosition === 304 ? '1.1' : issueNumber,
        sourceIssueReference);
    }
    if (sourcePosition === 304) {
      assert.equal(issueNumber, '1.MU');
      assert.equal(mappingRow.metadataIssueNumber, '1.1');
    }
    assert.equal(mappingRow.selectedIssueId ?? null, packetRow.candidateIssueId ?? null,
      sourceIssueReference);
  }
});

test('Ultimate Spider-Man preserves directed optional tie-ins, source omissions and the deferred finale', () => {
  assert.deepEqual([rowAt(1).selectedIssueId, rowAt(304).selectedIssueId, rowAt(352).selectedIssueId],
    [4372, 62604, 127659]);
  assert.equal(rowAt(30).sourceIssueReference, 'Ultimate Marvel Team-Up (2001) #9');
  assert.deepEqual([150, 152, 154, 156, 158].map((position) => rowAt(position).issueNumber),
    ['1', '2', '3', '4', '5']);
  assert.deepEqual(Array.from({ length: 9 }, (_, index) => rowAt(index + 183).issueNumber),
    ['1', '2', '3', '4', '158', '159', '160', '5', '6']);
  assert.deepEqual([226, 227, 228, 229].map((position) => rowAt(position).issueNumber),
    ['18', '18.1', '16.1', '19']);
  assert.equal(rowAt(304).sourceIssueReference, 'Champions (2016) #1.MU');
  assert.equal(rowAt(304).issueNumber, '1.1');
  assert.equal(rowAt(304).metadataIssueNumber, '1.1');
  assert.match(rowAt(335).sourceRangeReference, /Ultimate Universe story only/);
  assert.match(rowAt(352).sourceRangeReference, /Spider-Man story only; after Ultimate Endgame #1-5/);
  assert.deepEqual(mapping.rows.slice(-8).map((row) => row.selectedIssueId),
    [113900, 113901, 129224, 129225, 129226, 129227, 129228, 127659]);
  assert.deepEqual(ledger.displayQualifications.map((row) => row.sourcePosition), [335, 352]);
  for (const position of [335, 352]) {
    assert.equal(rowAt(position).sourceRangeReference,
      ledger.displayQualifications.find((row) => row.sourcePosition === position).sourceRangeReference);
  }
  assert.ok(packet.excludedSourceReferences.some((reference) => reference.includes('#47-53')));
  assert.ok(packet.excludedSourceReferences.some((reference) => reference.includes('(2009) #15')));
  assert.ok(packet.excludedSourceReferences.some((reference) => reference.includes('Cataclysm:')));
  assert.equal(mapping.rows.some((row) => row.seriesYear === 2009 && row.issueNumber === '15'), false);
  assert.deepEqual(selectedIssueIds(mapping).map(Number),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.deepEqual(packet.proposedManifest.characters,
    ['Spider-Man', 'Peter Parker', 'Miles Morales', 'Ultimate Spider-Man']);
  assert.equal(packet.proposedManifest.timeline, null);
  assert.equal(packet.proposedManifest.coverIssueId, 4372);
});

test('Ultimate Spider-Man binds every current library peer to its independent approval', async () => {
  const library = await loadLibrarySnapshot();
  const current = await buildReportForMapping(`scripts/data/cbh-mappings/${id}.json`, [], {
    excludedOrderIds: ['mcu-prep-thunderbolts', 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide',
      'shang-chi-master-of-kung-fu-reading-order',
      'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order',
      'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order', 'namor-sub-mariner-reading-order',
      'iron-fist-reading-order', 'mcu-prep-shang-chi-and-the-legend-of-the-ten-rings', 'spider-man-no-way-home-owner-selected', 'mcu-prep-daredevil-born-again', 'mcu-prep-moon-knight', 'mcu-prep-deadpool-and-wolverine', 'mcu-prep-eternals', 'mcu-prep-fantastic-four-first-steps', 'mcu-prep-spider-man-brand-new-day', 'mcu-prep-she-hulk'],
  });
  const expectedOrderIds = library.lists.filter((entry) => entry.id !== id
    && entry.id !== 'planet-hulk-reading-order-and-greg-pak-hulk-comics-guide'
    && entry.id !== 'shang-chi-master-of-kung-fu-reading-order'
    && entry.id !== 'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order'
    && entry.id !== 'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order'
    && entry.id !== 'namor-sub-mariner-reading-order' && entry.id !== 'iron-fist-reading-order' && entry.id !== 'mcu-prep-shang-chi-and-the-legend-of-the-ten-rings' && entry.id !== 'mcu-prep-daredevil-born-again' && entry.id !== 'mcu-prep-moon-knight' && entry.id !== 'mcu-prep-deadpool-and-wolverine' && entry.id !== 'mcu-prep-eternals' && entry.id !== 'mcu-prep-fantastic-four-first-steps' && entry.id !== 'mcu-prep-spider-man-brand-new-day' && entry.id !== 'mcu-prep-she-hulk' && entry.id !== 'spider-man-no-way-home-owner-selected' && entry.id !== 'mcu-prep-thunderbolts')
    .map((entry) => entry.id);
  assert.deepEqual(current, report);
  assert.equal(report.comparisonCount, 196);
  assert.deepEqual(report.comparisons.reduce((counts, row) => {
    counts[row.relationship] = (counts[row.relationship] ?? 0) + 1;
    return counts;
  }, {}), { none: 182, partial: 14 });
  assert.deepEqual(report.comparisons.filter((row) => row.relationship !== 'none')
    .map((row) => [row.orderId, row.sharedCount]), [
    ['amazing-spider-man-reading-order-modern-marvel-era', 1],
    ['black-widow-reading-order', 2],
    ['emma-frost-reading-order', 1],
    ['hickman-full', 6],
    ['infinity-countdown-wars', 2],
    ['inhumans-reading-order', 1],
    ['miles-morales-spider-man-reading-order', 116],
    ['monsters-unleashed', 1],
    ['ms-marvel-kamala-khan-reading-order', 15],
    ['new-ultimate-universe', 36],
    ['new-ultimate-universe-trades', 36],
    ['nova-reading-order', 18],
    ['ultimate-marvel-intro', 54],
    ['venom-reading-order', 1],
  ]);
  assert.deepEqual(report.comparisons.find((row) => row.orderId === 'silk-cindy-moon-reading-order')
    .sharedIds, []);
  assert.equal(mapping.relationshipReview.approvalDigest,
    '8e3be000139ef26009ed70702c4625bf089e9072a3d67d8a90373ea24443929c');
  assert.equal(mapping.reviewStatus, 'approved');
  assert.doesNotThrow(() => validateReportDigest(report));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: current.libraryDigest, expectedOrderIds,
  }));
});

test('Ultimate Spider-Man refuses a pending review even with unchanged rows and report', () => {
  const pending = structuredClone(mapping);
  pending.reviewStatus = 'pending-independent-review';
  delete pending.relationshipReview;
  delete pending.approvedManifest;
  delete pending.packetReview;
  assert.throws(() => assertApprovedRelationshipReview({
    packet, mapping: pending, report, currentLibraryDigest: report.libraryDigest,
    expectedOrderIds: report.comparisons.map((row) => row.orderId),
  }), /approved|review|pending/i);
});

test('Ultimate Spider-Man named checklist reproduces approved groups and 351 originals plus one gap', async () => {
  const [markdown, manifest, inventory, payload, catalogRaw] = await Promise.all([
    readFile(`src/data/orders/${id}.md`, 'utf8'),
    readJson('src/data/curated-lists.json'),
    readJson('scripts/data/cbh-character-inventory.json'),
    readJson(`src/data/${packet.proposedManifest.out}`),
    readJson('src/data/catalog.json'),
  ]);
  const authored = buildMarkdown(mapping);
  assert.equal(markdown.replace(/\r\n/g, '\n'), authored);
  const parsed = parseChecklist(authored);
  const all = [...parsed.entries, ...parsed.unresolved]
    .sort((left, right) => left.index - right.index);
  assert.deepEqual(all.map((row) => Number(row.sourceKey)),
    Array.from({ length: 352 }, (_, index) => index + 1));
  assert.equal(parsed.entries.length, 351);
  assert.equal(parsed.unresolved.length, 1);
  assert.equal(parsed.unresolved[0].index + 1, 44);
  assert.deepEqual(parsed.entries.map((row) => row.issueId),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.match(all[0].section, /^Peter Parker, original Ultimate universe:/);
  assert.match(all[197].section, /^Miles Morales Reading List:/);
  assert.match(all[269].section, /^All-New All-Different Miles Morales:/);
  assert.match(all[316].section, /^The New Ultimate Spider-Man \(2024-2026\):/);
  assert.match(all[334].section, /Ultimate Universe story only/);
  assert.match(all[351].section, /Spider-Man story only; after Ultimate Endgame #1-5/);
  assert.match(all[350].section, /Ultimate Endgame/);
  assert.notEqual(all[350].section, all[351].section);
  assert.equal(payload.items.length, 352);
  const superSpecial = payload.items[43];
  assert.equal(placeholderId(id, 'Ultimate Spider-Man Super Special (2002) #1', '44'),
    superSpecialPlaceholderId);
  assert.deepEqual(
    [superSpecial.issueId, superSpecial.title, superSpecial.number, superSpecial.placeholder],
    [superSpecialPlaceholderId, 'Ultimate Spider-Man Super Special (2002) #1', '1', true],
  );
  assert.deepEqual(payload.items.filter((item) => item.placeholder).map((item) => item.issueId),
    [superSpecialPlaceholderId]);
  const expectedBrowserIds = Array.from({ length: 352 }, (_, index) => (
    index === 43 ? superSpecialPlaceholderId : rowAt(index + 1)?.selectedIssueId
  ));
  assert.ok(expectedBrowserIds.every((issueId) => Number.isInteger(issueId)));
  assert.deepEqual(payload.items.map((item) => item.issueId), expectedBrowserIds);
  assert.deepEqual(payload.items.filter((item) => !item.placeholder).map((item) => item.issueId),
    mapping.rows.map((row) => row.selectedIssueId));
  assert.deepEqual(payload.items.map((item) => item.collectedIn), all.map((row) => row.section));
  assert.deepEqual(payload.items.map((item) => item.title), all.map((row) => row.title));
  const late = payload.items.filter((item) => refusedIds.includes(item.issueId));
  assert.deepEqual(late.map((item) => item.issueId), refusedIds);
  assert.deepEqual(payload.items.filter((item) => item.detailsRefused === true)
    .map((item) => item.issueId), refusedIds);
  assert.ok(late.every((item) => item.detailsRefused === true && !item.placeholder
    && item.seriesId === null
    && item.digitalId === null && item.cover === null && item.url?.startsWith('https://www.marvel.com/comics/issue/')));
  const card = parseCatalog(catalogRaw).lists.find((entry) => entry.id === id);
  assert.equal(card.count, 352);
  assert.equal(card.placeholderCount, 1);
  assert.equal(card.emptyRecordCount, 8);
  assert.equal(card.collections, 47);
  assert.equal(card.coverIssueId, 4372);
  assert.equal(card.source, packet.sourceUrl);
  assert.equal(manifest.lists.length, 213);
  const position = manifest.lists.findIndex((entry) => entry.id === id);
  assert.equal(manifest.lists[position + 1].id, 'venom-reading-order');
  assert.deepEqual(manifest.lists[position], mapping.approvedManifest);
  assert.doesNotThrow(() => validateInventoryState(inventory));
  const record = inventory.find((row) => row.id === id);
  assert.equal(record.position, 113);
  assert.equal(record.deliveryStatus, 'shipped');
  assert.deepEqual(record.catalogIds, [id]);
  assert.deepEqual(record.overlapIds, report.comparisons.filter((comparison) => (
    comparison.relationship !== 'none'
  )).map((comparison) => comparison.orderId));
});

test('Ultimate Spider-Man checkpoint gates reject an altered original, dropped gap or lost peer', () => {
  const wrongOriginal = structuredClone(mapping);
  wrongOriginal.rows[0].selectedIssueId = 14846;
  assert.throws(() => validateMappingDigest(wrongOriginal), /mapping digest is stale/i);

  const lostGap = structuredClone(packet);
  lostGap.sourceGaps.pop();
  assert.throws(() => validateFrozenPacket(lostGap), /packet|gap|source/i);

  const lostPeer = structuredClone(report);
  lostPeer.comparisons.pop();
  assert.throws(() => validateReportDigest(lostPeer), /report digest is stale/i);
});
