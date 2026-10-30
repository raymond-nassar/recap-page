import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { assertApprovedRelationshipReview } from '../scripts/author-cbh-packet.mjs';
import { CBH_SOURCE_PROVIDER, libraryDigestExcludingOrders, validateFrozenPacket } from '../scripts/lib/cbh-inventory.mjs';
import { readOwnerGuideRegistry } from '../scripts/lib/owner-guide-registry.mjs';
import { loadLibrarySnapshot } from '../scripts/report-order-overlap.mjs';
import { parseCatalog } from '../src/js/lib/catalog.js';
import { parseChecklist } from '../src/js/lib/markdown.js';

// #898. Reading Lists for younger readers: seven from Comic Book Herald's kids guide and eight from
// the owner's picks in Marvel's young readers guide. The accepted vectors were taken from the
// metadata service's series listings, independently of the packets, mappings and payloads below.
const readJson = async (file) => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const readText = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const GUIDE = 'https://www.comicbookherald.com/best-marvel-comics-for-kids/';
const PICKS = 'https://github.com/raymond-nassar/recap-page/issues/898#issuecomment-6422672109';
const fixture = await readJson('test/fixtures/young-readers-vectors.json');
const lists = fixture.lists;
const cbhIds = lists.filter((entry) => entry.source === 'comic-book-herald').map((entry) => entry.id);
const ownerIds = lists.filter((entry) => entry.source === 'owner').map((entry) => entry.id);

test('the fifteen young readers\' lists, and only they, carry the shared audience', async () => {
  const [manifest, catalogRaw] = await Promise.all([
    readJson('src/data/curated-lists.json'), readJson('src/data/catalog.json'),
  ]);
  assert.deepEqual([cbhIds.length, ownerIds.length], [7, 8]);
  assert.deepEqual(manifest.lists.filter((entry) => Object.hasOwn(entry, 'audience')).map((entry) => entry.id),
    lists.map((entry) => entry.id));
  assert.ok(manifest.lists.filter((entry) => Object.hasOwn(entry, 'audience'))
    .every((entry) => entry.audience === 'young-readers'));
  const catalog = parseCatalog(catalogRaw);
  assert.equal(catalog.dropped, 0);
  assert.deepEqual(catalog.lists.filter((entry) => entry.audience === 'young-readers').map((entry) => entry.id).sort(),
    lists.map((entry) => entry.id).sort());
  assert.ok(catalog.lists.every((entry) => entry.audience === 'young-readers' || entry.audience === null));
  assert.equal(catalogRaw.lists.filter((entry) => Object.hasOwn(entry, 'audience')).length, 15);
});

test('every young readers\' list publishes its accepted vector in order, with gaps kept in place', async () => {
  const [manifest, catalog] = await Promise.all([
    readJson('src/data/curated-lists.json'), readJson('src/data/catalog.json'),
  ]);
  for (const list of lists) {
    const entry = manifest.lists.find((row) => row.id === list.id);
    const card = catalog.lists.find((row) => row.id === list.id);
    const payload = await readJson(`src/data/${entry.out}`);
    const checklist = parseChecklist(await readText(`src/data/orders/${entry.sourceFile}`));
    const total = list.issueIds.length + list.gaps.length;
    assert.deepEqual(payload.items.filter((item) => !item.placeholder).map((item) => item.issueId), list.issueIds, list.id);
    assert.deepEqual(checklist.entries.map((item) => item.issueId), list.issueIds, list.id);
    assert.equal(new Set(list.issueIds).size, list.issueIds.length, `${list.id} repeats an issue`);
    assert.deepEqual([payload.count, card.count, entry.expect], [
      list.source === 'owner' ? list.issueIds.length : total,
      list.source === 'owner' ? list.issueIds.length : total,
      list.source === 'owner' ? list.issueIds.length : total,
    ], list.id);
    if (list.source === 'comic-book-herald') {
      // Comic Book Herald gaps stay at their source positions as placeholders a reader can see.
      assert.deepEqual(payload.items.map((item, index) => [index + 1, item.placeholder === true]).filter(([, gap]) => gap)
        .map(([position]) => position), list.gaps.map(([position]) => position), list.id);
      assert.deepEqual(checklist.unresolved.map((item) => [Number(item.sourceKey), item.title]), list.gaps, list.id);
      assert.equal(card.placeholderCount, list.gaps.length);
    } else {
      assert.equal(payload.items.some((item) => item.placeholder), false);
      assert.equal(card.placeholderCount, 0);
    }
  }
});

test('provenance and classification follow the delivery decisions, and the copy claims no availability', async () => {
  const [manifest, catalog] = await Promise.all([
    readJson('src/data/curated-lists.json'), readJson('src/data/catalog.json'),
  ]);
  for (const list of lists) {
    const entry = manifest.lists.find((row) => row.id === list.id);
    const card = catalog.lists.find((row) => row.id === list.id);
    const gapped = list.gaps.length > 0;
    assert.deepEqual([entry.type, entry.spotlightKind, entry.audience, entry.depth, entry.beginner, entry.timeline,
      entry.group, entry.sourceLicense], [
      'character-run', 'other', 'young-readers', gapped ? 'partial' : 'complete', true, null, null, null,
    ], list.id);
    if (list.source === 'comic-book-herald') {
      assert.deepEqual([entry.sourceOrigin, entry.sourcePage, entry.sourceSection],
        [CBH_SOURCE_PROVIDER.sourceOrigin, GUIDE, list.section], list.id);
      assert.deepEqual([card.source, card.sourceSection], [GUIDE, list.section]);
    } else {
      assert.deepEqual([entry.sourceOrigin, entry.sourcePage, Object.hasOwn(entry, 'sourceSection')],
        ['Selected by the project owner', PICKS, false], list.id);
    }
    for (const text of [entry.name, entry.description]) {
      assert.doesNotMatch(text, /[\u2013\u2014]/, `${list.id} copy contains a typographic dash`);
      assert.doesNotMatch(text, /unlimited|availab/i, `${list.id} copy makes an availability claim`);
    }
  }
  // Decided on #898: the full 2005 to 2010 Power Pack line, the fifteen Franklin Richards one-shots
  // without the 2018 compilation, and the five Marvel Super Hero Adventures specials in row order.
  const powerPack = await readJson('src/data/power_pack_pack_attack_and_team_ups.json');
  assert.equal(powerPack.count, 44);
  assert.equal(new Set(powerPack.items.map((item) => item.seriesId)).size, 11);
  const franklin = await readJson('scripts/data/cbh-packets/franklin-richards-one-shots.json');
  assert.equal(franklin.rows.length, 15);
  assert.ok(franklin.excludedSourceReferences.some((reference) => reference.startsWith('Franklin Richards: A Fantastic Year (2018)')));
  const specials = await readJson('src/data/marvel_super_hero_adventures.json');
  assert.deepEqual(specials.items.map((item) => item.seriesId), [26232, 26233, 26904, 25749, 25752]);
});

test('every gap names its tracking Issue, and the shared owner picks are not duplicated', async () => {
  const spidey = await readJson('scripts/data/cbh-packets/spidey.json');
  const spideyMapping = await readJson('scripts/data/cbh-mappings/spidey.json');
  assert.deepEqual(spidey.sourceGaps.map((gap) => [gap.sourcePosition, gap.sourceIssueReference, gap.kind, gap.status]),
    [1, 2, 3, 4, 5, 6].map((n) => [12 + n, `Spidey: School's Out (2018) #${n}`, 'published-metadata-gap', 'open']));
  assert.deepEqual(spideyMapping.sourceGaps, spidey.sourceGaps);
  assert.ok(spidey.sourceGaps.every((gap) => gap.evidenceSources.some((source) =>
    source.kind === 'tracking-issue' && source.url === 'https://github.com/raymond-nassar/recap-page/issues/900')));
  const actionAvengers = await readJson('scripts/data/owner-selections/marvel-action-avengers.json');
  assert.deepEqual(actionAvengers.sourceGaps.map((gap) => [gap.sourcePosition, gap.sourceIssueReference]),
    [[5, 'Marvel Action Avengers (2018) #5']]);
  assert.ok(actionAvengers.sourceGaps[0].evidenceSources.some((source) =>
    source.url === 'https://github.com/raymond-nassar/recap-page/issues/901'));

  // Owner rows 1 and 12 share the Comic Book Herald lists for Moon Girl and Spidey rather than
  // becoming copies: no owner registration names either, and the shared list holds the owner's series.
  const registered = readOwnerGuideRegistry().guides.filter((guide) => guide.surface === 'young-readers');
  assert.deepEqual(registered.map((guide) => guide.id), ownerIds);
  const moonGirl = await readJson('src/data/moon_girl_and_devil_dinosaur.json');
  assert.ok(moonGirl.items.every((item) => item.seriesId === 20839));
  for (const guide of registered) {
    assert.equal((await readJson(guide.contract)).surface, 'young-readers');
  }
});

test('the Comic Book Herald inventory, packets and relationship approvals stay current', async () => {
  const inventory = await readJson('scripts/data/cbh-young-readers-inventory.json');
  assert.deepEqual(inventory.map((record) => [record.id, record.url, record.sourceSection, record.deliveryStatus]),
    lists.filter((entry) => entry.source === 'comic-book-herald')
      .map((entry) => [entry.id, GUIDE, entry.section, 'shipped']));
  const manifest = await readJson('src/data/curated-lists.json');
  const library = await loadLibrarySnapshot();
  // The approvals were given before the owner lists existed, so the reviewed library is today's
  // without any of the fifteen, or any curated guide registered after them.
  const registry = await readJson('test/fixtures/curated-guide-additions.json');
  const later = registry.guides.slice(registry.guides.findLastIndex((guide) => cbhIds.includes(guide.id)) + 1)
    .map((guide) => guide.id);
  const reviewedDigest = libraryDigestExcludingOrders(library, [...cbhIds, ...ownerIds, ...later]);
  const mappings = Object.fromEntries(await Promise.all(cbhIds.map(async (id) => [id,
    await readJson(`scripts/data/cbh-mappings/${id}.json`)])));
  for (const record of inventory) {
    const packet = await readJson(`scripts/data/cbh-packets/${record.id}.json`);
    const report = await readJson(`scripts/data/cbh-overlaps/${record.id}.json`);
    validateFrozenPacket(packet, {
      expectedId: record.id, inventoryRecord: record,
      catalogEntries: manifest.lists.filter((entry) => !cbhIds.includes(entry.id)),
    });
    assert.deepEqual(record.overlapIds, report.comparisons.filter((row) => row.relationship !== 'none')
      .map((row) => row.orderId));
    assertApprovedRelationshipReview({
      packet, mapping: mappings[record.id], report, currentLibraryDigest: reviewedDigest,
      peerMappings: cbhIds.filter((id) => id !== record.id).map((id) => mappings[id]),
      expectedOrderIds: report.comparisons.map((row) => row.orderId),
    });
    assert.ok(report.comparisons.every((row) => ['none', 'partial'].includes(row.relationship)));
  }
});
