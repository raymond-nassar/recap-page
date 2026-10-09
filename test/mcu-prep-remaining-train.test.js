import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import {
  assertMappingMatchesPacketOccurrences, sourceCountsForPacket,
  validateApprovalDigest, validateMappingDigest, validateReportDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { buildComparisonReport } from '../scripts/lib/cbh-overlap.mjs';
import { loadCurrentOwnerLibrary } from '../scripts/lib/owner-current-library.mjs';
import { OWNER_PROVIDER } from '../scripts/lib/owner-guide.mjs';
import { catalogEntries, HOME_CATEGORIES, parseCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  assertCurrentReadingRoster, currentReadingCensus, registeredOwnerIds,
} from './helpers/current-reading-library.mjs';
import { assertFirstStepsMsMarvelReciprocal } from './helpers/first-steps-ms-marvel-reciprocal.mjs';
import {
  historicalMcuDescriptionManifest, historicalSpiderManSelectionLibraryDigest,
} from './helpers/reading-choice-history.mjs';

const text = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const json = async (file) => JSON.parse(await text(file));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const agathaId = 'mcu-prep-agatha-all-along';
const gapUrl = 'https://github.com/raymond-nassar/recap-page/issues/728';
const correctionUrl = 'https://github.com/raymond-nassar/recap-page/issues/703#issuecomment-6011367864';
const agatha = {
  id: agathaId,
  name: 'MCU Prep: Agatha All Along',
  sourceUrl: 'https://github.com/raymond-nassar/recap-page/issues/703',
  description: "Agatha Harkness's witchy first appearance leads into a mentor-turned-rival showdown with Scarlet Witch. Magic, grudges, and a complicated teacher-student bond set the mood. The five selected House of Harkness school-rivalry chapters are still missing provider details and aren't included yet.",
  groups: [
    'Fantastic Four by Lee/Kirby: Agatha Harkness introduction',
    'Scarlet Witch by Steve Orlando Vol. 1: The Last Door',
  ],
  rows: [
    [1, 13304, 'Fantastic Four (1961) #94', 0],
    [2, 97133, 'Scarlet Witch (2023) #1', 1],
    [3, 97135, 'Scarlet Witch (2023) #2', 1],
    [4, 97136, 'Scarlet Witch (2023) #3', 1],
    [5, 97137, 'Scarlet Witch (2023) #4', 1],
    [6, 97138, 'Scarlet Witch (2023) #5', 1],
    [7, 109670, 'Scarlet Witch Annual (2023) #1', 1],
  ],
};
const cohort = [
  'mcu-prep-spider-man-brand-new-day', 'mcu-prep-she-hulk', 'mcu-prep-ms-marvel',
  'mcu-prep-captain-america-brave-new-world', 'mcu-prep-guardians-of-the-galaxy', agathaId,
];
const sourceCounts = [20, 13, 18, 19, 28, 12];
const intendedGroups = [[6, 8, 6], [1, 6, 6], [6, 6, 6], [7, 6, 6], [11, 6, 6, 5], [1, 6, 5]];
const publishedGroups = [[6, 7, 6], [1, 6, 6], [6, 6, 6], [7, 6, 6], [11, 6, 6, 5], [1, 6, 0]];
const gapPositions = [[14], [], [], [], [], [8, 9, 10, 11, 12]];

async function evidence(id) {
  const [source, packet, mapping, report] = await Promise.all([
    json(`scripts/data/owner-selections/${id}.json`), json(`scripts/data/owner-packets/${id}.json`),
    json(`scripts/data/owner-mappings/${id}.json`), json(`scripts/data/owner-overlaps/${id}.json`),
  ]);
  return { source, packet, mapping, report };
}

test('remaining MCU Prep train preserves six independent guides, six gaps and complete current authority', async () => {
  const [brand, sheHulk, msMarvel, brave, guardians, manifest, catalog, library] = await Promise.all([
    json('test/fixtures/mcu-prep-brand-new-day-vector.json'),
    json('test/fixtures/mcu-prep-she-hulk-vector.json'),
    json('test/fixtures/mcu-prep-ms-marvel-vector.json'),
    json('test/fixtures/mcu-prep-captain-america-brave-new-world-vector.json'),
    json('test/fixtures/owner-delivery/mcu-prep-guardians-of-the-galaxy.json'),
    json('src/data/curated-lists.json'), json('src/data/catalog.json'),
    loadCurrentOwnerLibrary('remaining-mcu-prep-audit'),
  ]);
  const fixtures = [brand, sheHulk, msMarvel, brave, guardians, agatha];
  assert.deepEqual(fixtures.map((fixture) => fixture.id), cohort);
  assertCurrentReadingRoster(manifest, catalog);
  const union = [...new Set([...manifest.lists, ...catalog.lists].map((row) => row.id))].sort();
  assert.deepEqual(library.orders.map((row) => row.orderId).sort(), union);
  assert.equal(union.length, currentReadingCensus.allOrders);
  assert.equal(library.descriptors.filter((row) => /^marvel-knights-to-planet-x-\d{2}$/.test(row.id)).length, 78);
  assert.deepEqual(library.descriptors.filter((row) => !row.visible).map((row) => row.id), ['marvel-knights-to-planet-x']);
  const parsedCatalog = parseCatalog(catalog);
  assert.equal(parsedCatalog.dropped, 0);
  const choices = catalogEntries(parsedCatalog.lists);
  const mcu = HOME_CATEGORIES.find((category) => category.key === 'marvel-on-screen').select(choices);
  const allEvidence = new Map(await Promise.all([...new Set([...cohort, ...registeredOwnerIds])]
    .map(async (id) => [id, await evidence(id)])));
  const missing = [];
  let totalOriginals = 0;
  let totalPositions = 0;

  for (const [index, fixture] of fixtures.entries()) {
    const { id, rows, groups } = fixture;
    const { source, packet, mapping, report } = allEvidence.get(id);
    const expectedIds = rows.map((row) => row[1]);
    const expectedPositions = rows.map((row) => row[0]);
    const expectedGroups = rows.map((row) => groups[row[3]]);
    const gaps = source.sourceGaps ?? [];
    assert.deepEqual(gaps.map((row) => row.sourcePosition), gapPositions[index],
      `${id}: every missing source position must remain explicit`);
    assert.deepEqual(packet.sourceGaps ?? [], gaps);
    assert.deepEqual(mapping.sourceGaps ?? [], gaps);
    assert.deepEqual(sourceCountsForPacket(packet), {
      sourceOccurrenceCount: sourceCounts[index], sourceIdentityCount: sourceCounts[index],
      includedIssueCount: expectedIds.length, sourceGapCount: gapPositions[index].length,
      repeatedSourceReferenceCount: 0,
    });
    assertMappingMatchesPacketOccurrences(packet, mapping);
    assert.deepEqual(source.rows.map((row) => row.sourcePosition),
      Array.from({ length: sourceCounts[index] }, (_, position) => position + 1));
    assert.equal(source.publishedIssueCount, expectedIds.length);
    assert.deepEqual(source.sourceGroupCounts ?? source.selections.map((row) => row.originalCount),
      intendedGroups[index]);
    assert.deepEqual(source.publishedGroupCounts ?? source.facts?.publishedGroupCounts
      ?? groups.map((_, group) => rows.filter((row) => row[3] === group).length), publishedGroups[index]);
    assert.deepEqual(mapping.rows.map((row) => row.selectedIssueId), expectedIds);
    assert.deepEqual(mapping.rows.map((row) => row.sourcePosition), expectedPositions);
    if (registeredOwnerIds.includes(id)) {
      assert.deepEqual(mapping.rows.map((row) => row.sourceRangeReference), expectedGroups);
    }
    if (source.publishedGroupLabels) assert.deepEqual(source.publishedGroupLabels, groups);
    if (fixture.vectorSha256) assert.equal(hash(JSON.stringify(expectedIds)), fixture.vectorSha256);

    const entries = manifest.lists.filter((row) => row.id === id);
    const cards = catalog.lists.filter((row) => row.id === id);
    assert.equal(entries.length, 1, `${id}: exactly one source registration`);
    assert.equal(cards.length, 1, `${id}: exactly one visible card`);
    assert.equal(mcu.filter((choice) => choice.key === `list:${id}`).length, 1, `${id}: exactly one MCU Prep choice`);
    const [payload, markdown] = await Promise.all([
      json(`src/data/${entries[0].out}`), text(`src/data/orders/${entries[0].sourceFile}`),
    ]);
    const checklist = parseChecklist(markdown);
    assert.deepEqual(checklist.unresolved, []);
    assert.deepEqual(checklist.entries.map((row) => row.issueId), expectedIds);
    assert.deepEqual(checklist.entries.map((row) => Number(row.sourceKey)), expectedPositions);
    assert.deepEqual(checklist.entries.map((row) => row.section), expectedGroups);
    assert.deepEqual(payload.items.map((row) => row.issueId), expectedIds);
    assert.deepEqual(payload.items.map((row) => row.title), rows.map((row) => row[2]));
    assert.deepEqual(payload.items.map((row) => row.collectedIn), expectedGroups);
    assert.deepEqual([payload.count, payload.placeholders, payload.unresolved], [expectedIds.length, 0, []]);
    assert.ok(payload.items.every((row) => !row.placeholder && !row.detailsRefused));
    for (const row of [entries[0], cards[0], payload]) {
      assert.equal(row.name, fixture.name);
      assert.equal(row.description, fixture.description);
      assert.equal(row.sourceOrigin, OWNER_PROVIDER.sourceOrigin);
      assert.equal(row.sourceLicense, null);
      assert.equal(row.sourcePage ?? row.source, fixture.sourceUrl);
    }
    assert.equal(source.sourceUrl, fixture.sourceUrl);
    assert.equal(source.readerDescription, fixture.description);
    assert.ok(markdown.includes(fixture.sourceUrl));
    for (const gap of gaps) {
      const issue = id === brand.id ? brand.gapUrl : gapUrl;
      assert.equal(gap.kind, 'published-metadata-gap');
      assert.equal(gap.status, 'open');
      if (id === brand.id) {
        const detail = source.sourceGapDetails.find((row) => row.sourcePosition === gap.sourcePosition);
        assert.equal(detail.issue.url, issue);
        assert.equal(detail.receipt.httpStatus, 404);
        assert.equal(detail.originalIssueId, 59715);
        assert.equal(detail.selectedIssueId, null);
      } else {
        assert.ok(gap.evidenceSources.some((row) => row.url === issue));
      }
      missing.push([id, gap.sourcePosition, issue]);
    }

    const peerIds = union.filter((peerId) => peerId !== id);
    const current = buildComparisonReport({
      candidateIds: expectedIds, orders: library.orders.filter((row) => row.orderId !== id),
    });
    assert.deepEqual(current.comparisons.map((row) => row.orderId).sort(), peerIds);
    const recordedIds = new Set(report.comparisons.map((row) => row.orderId));
    const recordedOrders = library.orders.filter((row) => recordedIds.has(row.orderId));
    assert.equal(recordedOrders.length, recordedIds.size, `${id}: recorded peer missing from the current union`);
    let recordedManifest = { ...manifest, lists: manifest.lists.filter((row) => recordedIds.has(row.id)) };
    if (id === brand.id) recordedManifest = historicalMcuDescriptionManifest(recordedManifest);
    const recordedDigest = historicalSpiderManSelectionLibraryDigest(recordedManifest, recordedOrders.map((row) => ({
      id: row.orderId, issueIds: row.issueIds.map(String),
    })));
    assert.deepEqual(current.comparisons.filter((row) => recordedIds.has(row.orderId)), report.comparisons);
    assertApprovedRelationshipReview({
      packet, mapping, report, currentLibraryDigest: recordedDigest,
      expectedOrderIds: [...recordedIds], packetValidation: { provider: OWNER_PROVIDER },
    });
    for (const disposition of mapping.relationshipReview.dispositions.filter((row) => row.relationship !== 'none')) {
      assert.ok(['human', 'stronger-model'].includes(disposition.authorityType),
        `${id}: a non-none relationship cannot inherit the none-only policy`);
      assert.equal(disposition.decision, 'approved');
      assert.ok(disposition.authorityIdentity && disposition.rationale && disposition.reviewedAt);
    }
    for (const later of current.comparisons.filter((row) => !recordedIds.has(row.orderId))) {
      const reviewed = allEvidence.get(later.orderId);
      assert.ok(reviewed, `${id}: later peer ${later.orderId} needs actual current authority`);
      validateMappingDigest(reviewed.mapping);
      validateReportDigest(reviewed.report);
      validateApprovalDigest(reviewed.mapping.relationshipReview, later.orderId);
      const reciprocal = reviewed.report.comparisons.find((row) => row.orderId === id);
      const authority = reviewed.mapping.relationshipReview.dispositions.find((row) => row.orderId === id);
      assert.ok(reciprocal && authority, `${id}: new owner review must include the earlier guide`);
      const inverse = { none: 'none', partial: 'partial', 'candidate-subset': 'existing-subset', 'existing-subset': 'candidate-subset' };
      assert.equal(later.relationship, inverse[reciprocal.relationship]);
      assert.equal(later.sharedCount, reciprocal.sharedCount);
      assert.deepEqual([...later.sharedIds].sort(), [...reciprocal.sharedIds].sort());
      assert.equal(authority.decision, 'approved');
      assert.equal(authority.relationship, reciprocal.relationship);
      assert.equal(reviewed.mapping.relationshipReview.reportDigest, reviewed.report.reportDigest);
      if (registeredOwnerIds.includes(later.orderId)) {
        assert.equal(authority.sharedCount, reciprocal.sharedCount);
        assert.deepEqual(authority.sharedIds, reciprocal.sharedIds);
      }
      if (later.relationship !== 'none') assert.ok(['human', 'stronger-model'].includes(authority.authorityType));
    }
    totalOriginals += expectedIds.length;
    totalPositions += sourceCounts[index];
  }
  assert.deepEqual([totalPositions, totalOriginals, missing.length], [110, 104, 6]);
  assert.deepEqual(missing, [
    [brand.id, 14, 'https://github.com/raymond-nassar/recap-page/issues/707'],
    ...[8, 9, 10, 11, 12].map((position) => [agathaId, position, gapUrl]),
  ]);

  const { source: agathaSource, mapping: agathaMapping } = allEvidence.get(agathaId);
  assert.deepEqual(agathaSource.facts.intendedGroupCounts, [1, 6, 5]);
  assert.deepEqual(agathaSource.facts.publishedGroupCounts, [1, 6, 0]);
  assert.deepEqual(agathaSource.selections.map((row) => row.group),
    [...agatha.groups, 'House of Harkness Infinity Comic (2024) #1-5']);
  assert.equal(agathaSource.facts.sourceChoice.correction, correctionUrl);
  assert.equal(agathaSource.facts.correctedHandoff.derivedCorrectedHandoff, true);
  assert.equal(agathaSource.facts.bibliography.isbn13, '9780785194743');
  assert.deepEqual(agathaMapping.candidateMetadata.map((row) => row.id), agatha.rows.map((row) => row[1]));
  assert.deepEqual(agathaSource.facts.gapDetails.map((row) => [
    row.sourcePosition, row.ownerSuppliedIssueId, row.providerIdentityVerified, row.status,
    row.seriesId, row.providerDetailUrl, row.coverUrl, row.gapIssue,
  ]), [121656, 121657, 121658, 121659, 121660].map((id, index) =>
    [index + 8, id, false, 404, null, null, null, gapUrl]));
  const gapHashes = [
    'a4df43e65bdd826a389ca9d0640f988804c9c85d52308605cde35a4fd490f229',
    '3bc7739f12f7097e6794cc3b480c2bef0010edee18e504839619470cc8a5c9fa',
    '8d64875ff169b0dd03a6f901d52c30a2075915b513a3688fddaae3e06da579e7',
    '1c3620459de02a36e7dad98ed03832acc3a6ec519fa8a75da50672734ec05e86',
    '4474a72a6f6e31e7ad85b1e6e2a730795524bde61aa466805809d5fd3529e7c9',
  ];
  assert.deepEqual(agathaSource.facts.gapDetails.map((row) => row.responseBodySha256), gapHashes);
  for (const gap of agathaSource.facts.gapDetails) {
    assert.match(gap.fetchedAt, /^2026-10-06T06:50:25\.\d{3}Z$/);
    assert.equal(gap.metadataUrl, `https://marvel.emreparker.com/v1/issues/${gap.ownerSuppliedIssueId}`);
    assert.equal(gap.urlSha256, hash(gap.metadataUrl));
    assert.ok(gap.suppliedUrl.startsWith(`https://www.marvel.com/comics/issue/${gap.ownerSuppliedIssueId}/`));
  }

  const frozenId = 'mcu-prep-fantastic-four-first-steps';
  const [packet, mapping, report, reference] = await Promise.all([
    ...['packet', 'mapping', 'overlap'].map((kind) => json(`scripts/data/owner-mcu-prep/${frozenId}.${kind}.json`)),
    json(`scripts/data/owner-mcu-prep/${frozenId}.ms-marvel-reciprocal.json`),
  ]);
  const reciprocal = await assertFirstStepsMsMarvelReciprocal({ packet, mapping, report, reference });
  assert.deepEqual(reciprocal.approvedDelta,
    { orderId: msMarvel.id, relationship: 'partial', sharedCount: 1, sharedIds: ['49846'] });

  const activeId = 'spider-man-no-way-home';
  const retiredId = 'spider-man-no-way-home-owner-selected';
  const activeIds = [43170, 43171, 277, 5960, 6174, 6323, 15806, 15924, 6017, 6089, 6225, 13444, 15828, 15945, 20798, 13498, 67330];
  const retiredIds = [4372, 14846, 14857, 14868, 14879, 14890, 14901, 45808, 45809, 45810, 45811, 50350, 51320, 51324, 34135, 30324, 30325, 30326];
  assert.equal(manifest.lists.filter((row) => row.id === activeId).length, 1);
  assert.equal(catalog.lists.filter((row) => row.id === activeId).length, 1);
  assert.equal(mcu.filter((choice) => choice.key === `list:${activeId}`).length, 1);
  assert.ok(!union.includes(retiredId));
  assert.equal(choices.filter((choice) => choice.key === `list:${retiredId}`).length, 0);
  const [active, retiredText, activeMarkdown, retiredMarkdown] = await Promise.all([
    json('src/data/spider_man_no_way_home.json'), text('src/data/spider_man_no_way_home_owner_selected.json'),
    text(`src/data/orders/${activeId}.md`), text(`src/data/orders/${retiredId}.md`),
  ]);
  const retired = JSON.parse(retiredText);
  assert.deepEqual(active.items.map((row) => row.issueId), activeIds);
  assert.deepEqual(retired.items.map((row) => row.issueId), retiredIds);
  assert.deepEqual([active.count, retired.count], [17, 18]);
  assert.deepEqual(parseChecklist(activeMarkdown).entries.map((row) => row.issueId), activeIds);
  assert.deepEqual(parseChecklist(retiredMarkdown).entries.map((row) => row.issueId), retiredIds);
  assert.equal(hash(retiredText.replace(/\r\n/g, '\n')),
    '7d6eadd3d92da6ae4048b3d5711f29803c4edfea2f7ec250f382817e1b7b937c');
  assert.equal(hash(retiredMarkdown.replace(/\r\n/g, '\n')),
    '03db2728489533d09ed73eaf9575c0cd4e5d5329aabf984039669a109ff72c44');
});
