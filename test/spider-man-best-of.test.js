import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { parseCatalog, catalogListShelf, filterBySpotlightKind } from '../src/js/lib/catalog.js';
import {
  createEmptyState, createList, addIssuesToList, markRead, setIssueNote, listItems,
} from '../src/js/lib/model.js';

const root = new URL('../', import.meta.url);
const json = (file) => JSON.parse(readFileSync(new URL(file, root), 'utf8'));
const payload = json('src/data/spider_man_best_of.json');
const catalog = parseCatalog(json('src/data/catalog.json'));
const manifest = json('src/data/curated-lists.json');
const source = readFileSync(new URL('src/data/orders/spider-man-best-of.md', root), 'utf8');
const title = '10 Best Spider-Man (Peter Parker) Comics Reading List';
const range = (seriesId, first, last) => Array.from(
  { length: last - first + 1 }, (_, index) => `${seriesId}:${first + index}`,
);
const groups = [
  ['1. The Lee-Ditko Era: Origins & Destiny', ['2987:15', ...range(1987, 1, 38)]],
  ['2. The Opening Chapters of the Lee-Romita Run', range(1987, 39, 110)],
  ['3. Origin of the Hobgoblin', [
    '2271:43', ...range(2271, 45, 52), ...range(2271, 54, 61), ...range(1987, 224, 251),
  ]],
  ['4. The Death of Jean DeWolff', [...range(2271, 107, 110), ...range(2271, 134, 136)]],
  ["5. Kraven's Last Hunt", ['2092:31', '1987:293', '2271:131', '2092:32', '1987:294', '2271:132']],
  ['6. The Decline & Death of Harry Osborn', ['2271:178', ...range(2271, 188, 190), ...range(2271, 199, 200)]],
  ['7. Coming Home', range(454, 30, 35)],
  ['8. The Gauntlet / Shed / Grim Hunt (optional prelude: #600, #606, #611)', [
    '454:600', '454:606', '454:611', ...range(454, 612, 637),
  ]],
  ['9. Dying Wish / My Own Worst Enemy / Troubled Mind (optional Big Time: #648-652)', [
    ...range(454, 648, 652), ...range(454, 698, 700), ...range(17554, 1, 9),
  ]],
  ['10. Life Story', range(26911, 1, 6)],
];

test('Peter Parker best-of preserves the exact ten owner selections and optional boundaries', () => {
  assert.equal(payload.count, 233);
  assert.equal(payload.collections, 10);
  assert.equal(new Set(payload.items.map((item) => item.issueId)).size, 233);
  const actualGroups = new Map();
  for (const item of payload.items) {
    if (!actualGroups.has(item.collectedIn)) actualGroups.set(item.collectedIn, []);
    actualGroups.get(item.collectedIn).push(`${item.seriesId}:${item.number}`);
  }
  assert.deepEqual([...actualGroups], groups);
  assert.deepEqual([...actualGroups.values()].map((items) => items.length),
    [39, 72, 45, 7, 6, 6, 6, 29, 17, 6]);
  assert.ok(payload.items.every((item) => Number.isSafeInteger(item.issueId)
    && item.issueId > 0 && item.url && item.seriesName && !item.placeholder));
  assert.deepEqual(payload.unresolved, []);
});

test('Peter Parker best-of source, manifest and discoverable spotlight agree', () => {
  const entry = catalog.lists.find((list) => list.id === payload.id);
  const authored = manifest.lists.find((list) => list.id === payload.id);
  assert.equal(payload.name, title);
  assert.equal(entry.name, title);
  assert.equal(authored.name, title);
  assert.equal(entry.count, 233);
  assert.equal(authored.expect, 233);
  assert.equal(catalogListShelf(catalog.lists, payload.id), 'spotlights');
  assert.equal(filterBySpotlightKind(catalog.lists, 'best-of')
    .filter((list) => list.id === payload.id).length, 1);
  const parsed = parseChecklist(source);
  assert.deepEqual(parsed.unresolved, []);
  assert.deepEqual(parsed.entries.map((item) => [item.issueId, item.section]),
    payload.items.map((item) => [item.issueId, item.collectedIn]));
  for (const note of ['If This Be My Destiny', "Green Goblin's identity",
    'Nothing Can Stop the Juggernaut', 'Great Power', 'Child Within', 'Best of Enemies']) {
    assert.ok(source.includes(note), `Missing supplied guidance: ${note}`);
  }
  assert.equal(entry.file, 'spider_man_best_of.json');
  assert.equal(payload.sourceLicense, null);
});

test('a previously saved 230-comic Peter Parker snapshot survives separate candidate import', () => {
  const { payload: baseline } = json('test/fixtures/spider-man-best-of-saved.json');
  const itemIds = baseline.items.map((item) => item.issueId);
  const collectedIn = Object.fromEntries(baseline.items.map((item) => [item.issueId, item.collectedIn]));
  assert.equal(itemIds.length, 230);
  let state = createList(createEmptyState(), {
    name: baseline.name, catalogId: baseline.id, id: 'saved-before-update', itemIds, collectedIn,
  });
  state = addIssuesToList(state, 'saved-before-update',
    itemIds.map((issueId) => ({ issueId, title: `Saved comic ${issueId}` }))).state;
  state = markRead(state, itemIds[0], true, 123456);
  state = setIssueNote(state, itemIds[0], 'Keep my place');
  const saved = structuredClone(state.lists['saved-before-update']);
  const read = structuredClone(state.read);
  const note = state.issues[itemIds[0]].note;
  assert.ok(catalog.lists.some((list) => list.id === baseline.id));
  state = createList(state, { id: 'candidate', name: payload.name, catalogId: payload.id });
  state = addIssuesToList(state, 'candidate', payload.items).state;
  assert.deepEqual(state.lists['saved-before-update'], saved);
  assert.deepEqual(state.read, read);
  assert.equal(state.issues[itemIds[0]].note, note);
  assert.equal(listItems(state, 'saved-before-update').length, 230);
  assert.equal(listItems(state, 'candidate').length, 233);
});
