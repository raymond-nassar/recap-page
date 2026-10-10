import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { approvalDigestFor, mappingDigestFor } from '../scripts/lib/cbh-inventory.mjs';
import { readOwnerGuideRegistry } from '../scripts/lib/owner-guide-registry.mjs';
import {
  groupCatalog, HOME_CATEGORIES, modernTimelineLists, parseCatalog,
} from '../src/js/lib/catalog.js';
import { assertOwnerDeliveryContract } from './helpers/owner-delivery-contract.mjs';
import {
  currentReadingCensus, registeredEventContracts, registeredOwnerContracts,
} from './helpers/current-reading-library.mjs';

const json = async (file) => JSON.parse(await readFile(new URL(`../${file}`, import.meta.url), 'utf8'));
const legacyEventIds = ['the-death-of-ms-marvel', 'contest-of-chaos', 'gang-war'];
const eventIds = [...legacyEventIds, 'one-world-under-doom'];

test('four independently registered events extend the library without becoming MCU or Storylines selections', async () => {
  assert.deepEqual(registeredEventContracts.map((entry) => entry.id), eventIds);
  const laterMcu = registeredOwnerContracts.filter((entry) => entry.surface !== 'modern-timeline').length - 2;
  assert.deepEqual([currentReadingCensus.sources, currentReadingCensus.visible, currentReadingCensus.allOrders],
    [220 + laterMcu + 1, 297 + laterMcu + 1, 298 + laterMcu + 1]);
  assert.deepEqual([currentReadingCensus.mcu, currentReadingCensus.storylines], [20 + laterMcu, 66 + laterMcu]);
  const catalog = parseCatalog(await json('src/data/catalog.json'));
  assert.equal(catalog.dropped, 0);
  const doomIndex = catalog.lists.findIndex((entry) => entry.id === 'one-world-under-doom');
  const anchorIndex = catalog.lists.findIndex((entry) => entry.id === 'marvel-zombies-reading-order');
  assert.ok(doomIndex >= 0 && anchorIndex >= 0);
  assert.ok(doomIndex < anchorIndex);
  const stories = groupCatalog(catalog.lists);
  for (const category of ['marvel-on-screen', 'storylines']) {
    const selected = HOME_CATEGORIES.find((entry) => entry.key === category).select(stories);
    assert.ok(selected.every((story) => story.lists.every((list) => !eventIds.includes(list.id))));
  }
  const timeline = modernTimelineLists(catalog.lists);
  assert.equal(timeline.length, 152);
  assert.deepEqual(timeline.filter((entry) => entry.timeline === 2023).map((entry) => entry.id), legacyEventIds);
  assert.equal(timeline.at(-1).id, 'one-world-under-doom');
  assert.equal(timeline.at(-1).timeline, 2025);
  assert.ok(legacyEventIds.every((id) => timeline.findIndex((entry) => entry.id === id)
    < timeline.findIndex((entry) => entry.id === 'fall-house-x-rise-powers-x')));
});

test('the supplied 47 legacy positions keep their exact identities, source sections and short annotations', async () => {
  const legacyContracts = registeredEventContracts.filter((entry) => entry.id !== 'one-world-under-doom');
  assert.deepEqual(legacyContracts.map((entry) => entry.rows.length), [7, 9, 31]);
  assert.deepEqual(legacyContracts.map((entry) => entry.vectorSha256), [
    '35e4df4e24b0df864cfc9e93ca78ad9906e6ad89128dbe34b494b7b1df44ea3c',
    'a5bc36445edade26663f44e178c654349e33912c8cb19a6d69552bf33bec6b3d',
    '2bfad41f7eb1e2a318261286c1bd15a4edcc09866c8cee0bc5ebc448dba66d04',
  ]);
  for (const contract of legacyContracts) {
    const source = await json(`scripts/data/owner-selections/${contract.id}.json`);
    assert.deepEqual(source.rows.map((row) => row.suppliedIssueId), contract.rows.map((row) => row[1]));
    assert.deepEqual(source.rows.map((row) => row.sourcePosition),
      Array.from({ length: contract.rows.length }, (_, index) => index + 1));
    assert.equal(source.inputReceipt.sourceKind, 'pasted-message-snapshot');
    assert.equal(source.inputReceipt.originalFileSha256, null);
    assert.deepEqual(source.sourceGaps, []);
    assert.deepEqual(source.repeatedSourceReferences, []);
  }
  const gang = await json('scripts/data/owner-selections/gang-war.json');
  assert.deepEqual(gang.rows.map((row) => row.sourceRangeReference), [
    ...Array(6).fill('Prelude: First Strike'), ...Array(24).fill('Main Event'), 'Aftermath',
  ]);
  const contest = await json('scripts/data/owner-selections/contest-of-chaos.json');
  assert.deepEqual(contest.rows.map((row) => row.annotation), [
    'prelude: Agatha vs. Wanda', 'Spider-Man vs. Wolverine', 'Iron Man vs. Storm',
    'Ghost Rider vs. Human Torch', 'Moon Knight vs. Taegukgi', 'Ghost-Spider vs. White Fox',
    'Venom vs. Deadpool', 'Captain Marvel vs. Cyclops', 'finale',
  ]);
  const death = await json('scripts/data/owner-selections/the-death-of-ms-marvel.json');
  assert.equal(death.rows.at(-1).suppliedIssueId, 110195);
  assert.deepEqual(death.rows.slice(-2).map((row) => row.annotation), [
    'Ms. Marvel dies in this issue', '"Fallen Friend: The Death of Ms. Marvel" - tribute one-shot',
  ]);
});

test('Doom independently accounts for exact rows, gaps, repeat and optional positions', async () => {
  const contract = registeredEventContracts.find((entry) => entry.id === 'one-world-under-doom');
  assert.ok(contract);
  await assertOwnerDeliveryContract(contract);
  assert.equal(contract.sourceOccurrenceCount, 86);
  assert.equal(contract.sourceIdentityCount, 85);
  assert.equal(contract.rows.length, 75);
  assert.deepEqual(contract.gapSourcePositions, [27, 28, 29, 30, 31, 32, 83, 84, 85, 86]);
  assert.deepEqual(contract.optionalSourcePositions, [10, 11, 12, 13, 14]);
  assert.deepEqual(contract.repeatedSourceReferences, [{
    sourcePosition: 70,
    canonicalRow: 36,
    sourceIssueReference: 'Fantastic Four (2025) #1',
    sourceRangeReference: 'Chunk 5',
    normalizedSeriesTitle: 'Fantastic Four',
    seriesYear: 2025,
    issueNumber: '1',
  }]);

  const source = await json('scripts/data/owner-selections/one-world-under-doom.json');
  assert.equal(source.rows.length, 86);
  assert.deepEqual(source.rows.map((row) => row.sourcePosition),
    Array.from({ length: 86 }, (_, index) => index + 1));
  assert.deepEqual(source.rows.reduce((counts, row) => {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
    return counts;
  }, {}), { exact: 75, gap: 10, repeat: 1 });
  assert.equal(new Set(source.rows.map((row) => row.sourceIdentity)).size, 85);
  assert.deepEqual(source.rows.filter((row) => row.status === 'gap')
    .map((row) => [row.sourcePosition, row.sourceIdentity]), [
    [27, 'Avengers Academy Infinity Comic #43'],
    [28, 'Avengers Academy Infinity Comic #44'],
    [29, 'Avengers Academy Infinity Comic #45'],
    [30, 'Astonishing Avengers Infinity Comic #21'],
    [31, 'Astonishing Avengers Infinity Comic #22'],
    [32, 'Astonishing Avengers Infinity Comic #23'],
    [83, 'Red Hulk (2025) #10'],
    [84, 'One World Under Doom (2025) #9'],
    [85, 'The Will of Doom (2025) #1'],
    [86, 'Captain America (2025) #6'],
  ]);
  const repeat = source.rows.find((row) => row.status === 'repeat');
  assert.deepEqual([
    repeat.sourcePosition,
    repeat.canonicalSourcePosition,
    repeat.sourceIdentity,
    repeat.section,
  ], [70, 42, 'Fantastic Four (2025) #1', 'Chunk 5']);
  assert.deepEqual(source.rows.filter((row) => row.optional).map((row) => row.sourcePosition),
    contract.optionalSourcePositions);
  assert.ok(source.rows.filter((row) => row.optional)
    .every((row) => row.annotation === 'optional tie-in'));
});

test('the common event contract rejects a changed current peer mapping even when its issue set is unchanged', async () => {
  const contract = registeredEventContracts[0];
  await assertOwnerDeliveryContract(contract);
  const peerFile = 'scripts/data/owner-mappings/contest-of-chaos.json';
  const changed = await json(peerFile);
  const originalIds = changed.rows.map((row) => row.selectedIssueId);
  changed.sourceRetrievalStatus = 'changed-factual-retrieval-evidence';
  changed.mappingDigest = mappingDigestFor(changed);
  assert.deepEqual(changed.rows.map((row) => row.selectedIssueId), originalIds);
  await assert.rejects(assertOwnerDeliveryContract(contract, {
    readJson: (file) => file === peerFile ? structuredClone(changed) : json(file),
  }), /peer mapping set changed/);
});

test('the common earlier-owner contract rejects missing meaningful reciprocal authority for a new event', async () => {
  const agatha = registeredOwnerContracts.find((entry) => entry.id === 'mcu-prep-agatha-all-along');
  const peerFile = 'scripts/data/owner-mappings/contest-of-chaos.json';
  const changed = await json(peerFile);
  changed.relationshipReview.dispositions = changed.relationshipReview.dispositions
    .filter((entry) => entry.orderId !== agatha.id);
  changed.relationshipReview.approvalDigest = approvalDigestFor(changed.relationshipReview);
  const contracts = registeredOwnerContracts.map((entry) => entry.id === changed.id
    ? { ...entry, approvalDigest: changed.relationshipReview.approvalDigest } : entry);
  await assert.rejects(assertOwnerDeliveryContract(agatha, {
    contracts, readJson: (file) => file === peerFile ? structuredClone(changed) : json(file),
  }), /explicit reciprocal disposition/);
});

test('owner registration preserves the MCU default and rejects unknown event surfaces', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'modern-event-registry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'scripts', 'data'), { recursive: true });
  const guide = { id: 'sample', contract: 'test/fixtures/owner-delivery/sample.json' };
  const file = path.join(root, 'scripts', 'data', 'owner-deliveries.json');
  await writeFile(file, JSON.stringify({ schemaVersion: 1, guides: [guide] }));
  assert.deepEqual(readOwnerGuideRegistry(root).guides, [guide]);
  await writeFile(file, JSON.stringify({ schemaVersion: 1, guides: [{ ...guide, surface: 'unreviewed' }] }));
  assert.throws(() => readOwnerGuideRegistry(root), /invalid or duplicate guide/);
});
