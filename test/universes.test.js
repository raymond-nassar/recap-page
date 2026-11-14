import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { universeDefinitions, universeIssueOverrides, universeSeries } from '../src/data/universeCatalog.js';
import { createUniverseResolver, universeResolver } from '../src/js/lib/universes.js';
import { universeRegistryProblems } from '../src/js/lib/universeSchema.js';
import { parseCatalog } from '../src/js/lib/catalog.js';

const ids = (definitions) => definitions.map(({ id }) => id);
const definition = (id) => universeDefinitions.find((value) => value.id === id);

test('Universe records preserve field-level sources, owner descriptions and alternative dates', async () => {
  const ledger = JSON.parse(await readFile(new URL('../scripts/data/universe-sources.json', import.meta.url), 'utf8'));
  const byId = new Map(ledger.universes.map((entry) => [entry.id, entry]));
  assert.equal(byId.size, universeDefinitions.length);
  for (const universe of universeDefinitions) {
    const row = byId.get(universe.id);
    assert.ok(row, `no source record for ${universe.id}`);
    assert.deepEqual(row.selected, universe);
    assert.equal(universe.firstPublished, row.namedLine.coverYear);
    if (row.ownerInput) assert.equal(universe.description, row.ownerInput.description);
    for (const field of ['name', 'earth', 'firstPublished', 'debutIssue', 'description']) {
      assert.ok(row.evidence[field]?.length, `${universe.id} ${field} has no evidence`);
      for (const source of row.evidence[field]) assert.ok(ledger.sources[source], `${universe.id} ${source}`);
    }
    for (const candidate of [row.namedLine, row.referenceRealityFirst, ...row.alternatives]) {
      assert.ok(candidate.sources.every((source) => ledger.sources[source]?.url?.startsWith('https://')));
    }
  }
  assert.ok(byId.get('earth-616').alternatives.some(({ coverYear }) => coverYear === 1936));
  assert.ok(byId.get('killraven').alternatives.some(({ coverYear }) => coverYear === 1969));
});

test('reviewed Universe associations survive the manifest and generated catalog without additions', async () => {
  const [ledger, manifest, catalog] = await Promise.all([
    '../scripts/data/universe-sources.json',
    '../src/data/curated-lists.json',
    '../src/data/catalog.json',
  ].map(async (file) => JSON.parse(await readFile(new URL(file, import.meta.url), 'utf8'))));
  const relationship = (entry) => ({
    id: entry.listId ?? entry.id,
    universeIds: entry.universeIds,
    ...(entry.universeScopes ? { universeScopes: entry.universeScopes } : {}),
  });
  const sorted = (entries) => entries.map(relationship).sort((a, b) => a.id.localeCompare(b.id));
  const expected = sorted(ledger.listAssociations);
  for (const lists of [manifest.lists, parseCatalog(catalog).lists]) {
    assert.deepEqual(sorted(lists.filter((list) => Object.hasOwn(list, 'universeIds'))), expected);
  }
  assert.deepEqual(universeSeries, ledger.seriesAssociations.map(({ seriesId, universeIds, scope }) =>
    ({ seriesId, universeIds, scope })));
  assert.deepEqual(universeIssueOverrides, ledger.issueAssociations.map(({ issueId, universeIds }) =>
    ({ issueId, universeIds })));
  for (const entry of [...ledger.listAssociations, ...ledger.seriesAssociations, ...ledger.issueAssociations]) {
    assert.ok(entry.sources.length > 0);
    for (const source of entry.sources) assert.ok(ledger.sources[source], source);
  }
});

test('issue overrides replace series defaults, including explicit unknown and multiple universes', () => {
  const resolver = createUniverseResolver({
    definitions: [definition('earth-616'), definition('days-of-future-past'), definition('marvel-zombies')],
    series: [
      { seriesId: 1, universeIds: ['earth-616'], scope: 'entire-series' },
      { seriesId: 2, universeIds: ['marvel-zombies'], scope: 'selected-issues' },
    ],
    issueOverrides: [
      { issueId: 10, universeIds: ['days-of-future-past', 'earth-616'] },
      { issueId: 11, universeIds: [] },
    ],
  });
  assert.deepEqual(ids(resolver.resolveIssueUniverses({ issueId: 10, seriesId: 1 })), ['days-of-future-past', 'earth-616']);
  assert.deepEqual(ids(resolver.resolveIssueUniverses({ issueId: 11, seriesId: 1 })), []);
  assert.deepEqual(ids(resolver.resolveIssueUniverses({ issueId: 12, seriesId: 1 })), ['earth-616']);
  assert.deepEqual(ids(resolver.resolveIssueUniverses({ issueId: 12, seriesId: 2 })), []);
  assert.deepEqual(ids(resolver.resolveIssueUniverses({ issueId: -1, seriesId: 1 })), []);
  assert.equal(resolver.getSeriesUniverseRelations(2)[0].scope, 'selected-issues');
});

test('known issues and mixed guides do not assign their universes to unrelated issues', async () => {
  assert.deepEqual(ids(universeResolver.resolveIssueUniverses({ issueId: 12460, seriesId: 2258 })),
    ['days-of-future-past', 'earth-616']);
  assert.deepEqual(universeResolver.resolveIssueUniverses({ issueId: 12459, seriesId: 2258 }), []);
  const raw = JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
  const lists = parseCatalog(raw).lists;
  const zombies = lists.find(({ id }) => id === 'marvel-zombies-reading-order');
  const relations = universeResolver.getListUniverseRelations(zombies);
  assert.equal(relations[0].kind, 'related-realities');
  assert.match(relations[0].note, /other realities/);
  assert.equal(universeResolver.getUniverseLists('marvel-zombies', lists)[0].note, relations[0].note);
  assert.deepEqual(universeResolver.resolveIssueUniverses({ issueId: 3220, seriesId: 1 }), []);
  const ultimate = lists.find(({ id }) => id === 'ultimate-spider-man-reading-order');
  assert.deepEqual(ids(universeResolver.getListUniverseRelations(ultimate).map(({ universe }) => universe)),
    ['ultimate-marvel', 'ultimate-universe']);
});

test('local Universe search shares folding and keeps similarly named realities separate', () => {
  for (const [query, expected] of [
    ['Earth-1610', 'ultimate-marvel'], ['Ultimate Marvel', 'ultimate-marvel'],
    ['MC2', 'mc2'], ['Marvel Comics 2', 'mc2'], ['Earth-982', 'mc2'],
    ['2099', 'marvel-2099'], ['Earth-65', 'spider-gwen'], ['Earth1610', 'ultimate-marvel'],
    ['Spider-Gwen', 'spider-gwen'], ['Counter-Earth', 'heroes-reborn-1996'],
  ]) {
    assert.ok(ids(universeResolver.searchUniverses(query)).includes(expected), query);
  }
  assert.deepEqual(ids(universeResolver.searchUniverses('Ultimate')).sort(), ['ultimate-marvel', 'ultimate-universe']);
  assert.deepEqual(universeResolver.searchUniverses('not a universe'), []);
  const sorted = universeResolver.sortUniverses([
    definition('ultimate-universe'), definition('earth-616'), definition('ultimate-marvel'),
  ]);
  assert.deepEqual(ids(sorted), ['earth-616', 'ultimate-marvel', 'ultimate-universe']);
  const candidates = [
    { ...definition('ultimate-universe'), firstPublished: 2000, addedAt: '2026-01-02' },
    { ...definition('ultimate-marvel'), firstPublished: 2000, addedAt: '2026-01-02' },
    { ...definition('earth-616'), firstPublished: 1939, addedAt: '2026-01-01' },
  ];
  assert.deepEqual(ids(universeResolver.sortUniverses(candidates, 'recently-added')),
    ['ultimate-marvel', 'ultimate-universe', 'earth-616']);
  assert.deepEqual(ids(universeResolver.sortUniverses(candidates, 'alphabetical')),
    ['earth-616', 'ultimate-marvel', 'ultimate-universe']);
  assert.deepEqual(ids(candidates), ['ultimate-universe', 'ultimate-marvel', 'earth-616']);
  assert.throws(() => universeResolver.sortUniverses(sorted, 'invalid'), /sort order/);
});

test('invalid Universe definitions and references are reported instead of silently dropped', () => {
  const base = definition('earth-616');
  const entry = { ...base, earth: null };
  assert.deepEqual(universeRegistryProblems({ definitions: [entry], series: [], issueOverrides: [] }), []);
  for (const bad of [
    { ...entry, firstPublished: '1939' },
    { ...entry, addedAt: '2026-02-30' },
    { ...entry, aliases: ['Duplicate', 'duplicate'] },
    { ...entry, debutIssue: { title: 'Comic', issueId: 1, url: 'javascript:alert(1)' } },
    { ...entry, relatedUniverseIds: ['unknown'] },
  ]) {
    assert.ok(universeRegistryProblems({ definitions: [bad], series: [], issueOverrides: [] }).length);
  }
  assert.throws(() => createUniverseResolver({ definitions: [entry, entry], series: [], issueOverrides: [] }), /Duplicate universe/);
  assert.throws(() => createUniverseResolver({
    definitions: [entry], series: [], issueOverrides: [
      { issueId: 1, universeIds: ['earth-616'] },
      { issueId: 1, universeIds: [] },
    ],
  }), /Duplicate issue override/);
});
