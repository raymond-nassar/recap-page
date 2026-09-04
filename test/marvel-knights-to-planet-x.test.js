import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseChecklist } from '../src/js/lib/markdown.js';
import {
  addIssuesToList,
  createEmptyState,
  createList,
  hasMetadata,
  isRead,
  listProgress,
  markRead,
  SCHEMA_VERSION,
} from '../src/js/lib/model.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.join(root, 'src', 'data');
const guideId = 'marvel-knights-to-planet-x';
const guideFile = 'marvel_knights_to_planet_x.json';
const groupNames = ['1998-1999', '2000-2001', 'Planet X Crossover Cluster'];
const originalApprovedOverlaps = [
  ['amazing-spider-man-reading-order-modern-marvel-era', 53],
  ['captain-america-reading-order-modern-marvel-era', 1],
  ['doctor-doom-primer', 1],
  ['marvels-best-phoenix-comics', 9],
  ['spider-man-best-of', 6],
  ['spider-man-no-way-home', 3],
  ['wolverine-reading-order', 42],
];
const currentOverlaps = [
  ...originalApprovedOverlaps,
  ['daredevil-reading-order', 73],
  ['fantastic-four-reading-order', 23],
  ['iron-man-reading-order', 6],
  ['loki-reading-order', 2],
  ['magneto-reading-order', 13],
  ['modern-x-men-fast-track', 42],
  ['punisher-reading-order', 38],
  ['question-of-the-week-do-you-have-a-hulk-reading-order', 32],
  ['runaways-reading-order', 12],
  ['silver-surfer-reading-order', 1],
  ['venom-reading-order', 5],
  ['young-avengers-reading-order', 4],
].sort(([left], [right]) => left.localeCompare(right));

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(root, relativePath), 'utf8'));
}

function sourcePositionsByGroup(markdown) {
  const positions = new Map(groupNames.map((group) => [group, []]));
  let group = null;
  for (const line of markdown.split(/\r?\n/)) {
    const heading = /^## (.+)$/.exec(line);
    if (heading) group = positions.has(heading[1]) ? heading[1] : null;
    if (group && line.startsWith('> ')) positions.get(group).push(line.slice(2).trim());
  }
  return positions;
}

test('Marvel Knights to Planet X preserves the exact owner source vector and group boundaries', async () => {
  const markdown = await readFile(
    path.join(dataDir, 'orders', 'marvel-knights-to-planet-x.md'),
    'utf8',
  );
  const positions = sourcePositionsByGroup(markdown);
  const sourceVector = groupNames.flatMap((group) => positions.get(group));
  assert.deepEqual(groupNames.map((group) => positions.get(group).length), [4, 87, 8]);
  assert.equal(
    createHash('sha256').update(JSON.stringify(sourceVector)).digest('hex'),
    '437d917e2e469bdf33ccc855c4d88366a688758e497cdaea569b8f421465c6c5',
  );

  const parsed = parseChecklist(markdown);
  const parsedGroups = groupNames.map((group) => (
    parsed.entries.filter((entry) => entry.section === group)
  ));
  assert.deepEqual(parsedGroups.map((entries) => entries.length), [21, 441, 25]);
  assert.deepEqual(parsedGroups.map((entries) => entries[0].issueId), [15609, 18977, 14965]);
  assert.equal(parsed.entries.length, 487);
  assert.equal(new Set(parsed.entries.map((entry) => entry.issueId)).size, 487);
  assert.equal(
    createHash('sha256')
      .update(JSON.stringify(parsed.entries.map((entry) => entry.issueId)))
      .digest('hex'),
    '0223bbdca9912019ebe609de5dcdfc6f703682787e6ff59fc7e863bfc52dd00d',
  );
  assert.deepEqual(parsed.unresolved, []);
});

test('Marvel Knights to Planet X remains a hidden 487-issue partition parent', async () => {
  const markdown = await readFile(
    path.join(dataDir, 'orders', 'marvel-knights-to-planet-x.md'),
    'utf8',
  );
  const parsed = parseChecklist(markdown);
  const manifest = await readJson('src/data/curated-lists.json');
  const catalog = await readJson('src/data/catalog.json');
  const payload = await readJson(`src/data/${guideFile}`);
  const manifestIndex = manifest.lists.findIndex((entry) => entry.id === guideId);
  const catalogIndex = catalog.lists.findIndex((entry) => entry.id === guideId);
  const children = catalog.lists.filter((entry) => /^marvel-knights-to-planet-x-\d{2}$/.test(entry.id));

  assert.ok(manifestIndex >= 0);
  assert.equal(manifest.lists[manifestIndex + 1].id, 'spider-man-identity-crisis');
  assert.equal(manifest.lists[manifestIndex].sourceFile, 'marvel-knights-to-planet-x.md');
  assert.equal(manifest.lists[manifestIndex].out, guideFile);
  assert.equal(manifest.lists[manifestIndex].partitionFile, 'marvel-knights-to-planet-x-lists.json');
  assert.equal(manifest.lists[manifestIndex].catalog, false);
  assert.equal(manifest.lists[manifestIndex].timeline, 1998);
  assert.equal(manifest.lists[manifestIndex].expect, 487);

  assert.equal(catalogIndex, -1);
  assert.equal(children.length, 78);
  assert.equal(payload.count, 487);
  assert.equal(payload.placeholders, 0);
  assert.deepEqual(payload.unresolved, []);
  assert.equal(payload.items.some((item) => item.detailsRefused === true), false);
  assert.equal(payload.items.every((item) => hasMetadata(item)), true);
  assert.equal(
    payload.items.filter((item) => Number.isInteger(item.seriesId) && item.seriesId > 0).length,
    487,
  );
  assert.equal(
    payload.items.filter((item) => Number.isInteger(item.digitalId) && item.digitalId > 0).length,
    487,
  );
  assert.deepEqual(
    payload.items.map((item) => item.issueId),
    parsed.entries.map((entry) => entry.issueId),
  );
  assert.deepEqual(
    groupNames.map((group) => payload.items.filter((item) => item.collectedIn === group).length),
    [21, 441, 25],
  );
});

test('Marvel Knights to Planet X preserves approved and current-library overlaps', async () => {
  const catalog = await readJson('src/data/catalog.json');
  const payload = await readJson(`src/data/${guideFile}`);
  const guideIssueIds = new Set(payload.items.map((item) => String(item.issueId)));
  const overlaps = [];

  for (const list of catalog.lists) {
    if (list.id === guideId || /^marvel-knights-to-planet-x-\d{2}$/.test(list.id)) continue;
    const peer = await readJson(`src/data/${list.file}`);
    const sharedCount = peer.items.filter((item) => guideIssueIds.has(String(item.issueId))).length;
    if (sharedCount > 0) overlaps.push([list.id, sharedCount]);
  }

  assert.equal(originalApprovedOverlaps.length, 7);
  assert.deepEqual(
    overlaps.sort(([left], [right]) => left.localeCompare(right)),
    currentOverlaps,
  );
});

test('a saved umbrella stays intact and shares read progress with a later chapter', async () => {
  const parent = await readJson(`src/data/${guideFile}`);
  const chapter = await readJson('src/data/marvel_knights_to_planet_x_01.json');
  let state = createEmptyState();
  state = createList(state, {
    id: 'legacy-umbrella',
    name: parent.name,
    description: parent.description,
    catalogId: guideId,
  });
  state = addIssuesToList(
    state,
    'legacy-umbrella',
    parent.items.map((item) => ({ ...item, source: 'curated' })),
  ).state;
  state = markRead(state, parent.items[0].issueId, true, 1234);
  const legacyIds = [...state.lists['legacy-umbrella'].itemIds];

  state = createList(state, {
    id: 'chapter-01',
    name: chapter.name,
    description: chapter.description,
    catalogId: chapter.id,
  });
  state = addIssuesToList(
    state,
    'chapter-01',
    chapter.items.map((item) => ({ ...item, source: 'curated' })),
  ).state;

  assert.equal(state.schemaVersion, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 2);
  assert.deepEqual(state.lists['legacy-umbrella'].itemIds, legacyIds);
  assert.equal(state.lists['legacy-umbrella'].catalogId, guideId);
  assert.deepEqual(listProgress(state, 'legacy-umbrella'), { read: 1, total: 487 });
  assert.deepEqual(listProgress(state, 'chapter-01'), { read: 1, total: 21 });
  assert.equal(isRead(state, chapter.items[0].issueId), true);
  assert.equal(state.listOrder.length, 2);
});
