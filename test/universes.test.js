import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { universeDefinitions, universeIssueOverrides, universeSeries } from '../src/data/universeCatalog.js';
import { createUniverseResolver, universeResolver } from '../src/js/lib/universes.js';
import { universeRegistryProblems } from '../src/js/lib/universeSchema.js';
import { parseCatalog } from '../src/js/lib/catalog.js';
import { createUniversesView } from '../src/js/views/universes.js';

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

test('exact Universe designations and aliases precede partial matches', () => {
  assert.equal(universeResolver.searchUniverses('Earth-616')[0].id, 'earth-616');
  assert.equal(universeResolver.searchUniverses('Earth1610')[0].id, 'ultimate-marvel');
  assert.equal(universeResolver.searchUniverses('Heroes Reborn 1996')[0].id, 'heroes-reborn-1996');
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

function universeViewHarness({ loadCatalog = async () => ({ lists: [] }) } = {}) {
  const calls = { navigation: [], changes: 0, rows: [] };
  let current = 'universes';
  const el = (tag, props = {}, children = []) => {
    const node = {
      tag, children: [], hidden: false, textContent: '', dataset: {}, listeners: {},
      append(...items) { this.children.push(...items); },
      replaceChildren(...items) { this.children = [...items]; },
      addEventListener(name, callback) { this.listeners[name] = callback; },
      ...props,
    };
    if (props.text !== undefined) node.textContent = props.text;
    node.append(...[].concat(children));
    return node;
  };
  const nodes = {
    index: {
      form: el('form'), query: el('input'), sort: el('select'),
      count: el('p'), results: el('div'),
    },
    detail: {
      heading: el('h1'), missing: el('div'), body: el('div'), earth: el('dd'),
      year: el('dd'), debut: el('dd'), description: el('p'),
      status: el('p'), results: el('div'), retry: el('button'), emptyLink: el('a'),
    },
  };
  const view = createUniversesView({
    el, elements: () => nodes, resolver: universeResolver, loadCatalog,
    isCurrent: (name) => current === name,
    onNavigate: (id) => calls.navigation.push(id),
    onIndexChange: () => { calls.changes += 1; },
    onRetry: () => {},
    presentation: {
      catalogRow(list, options) {
        calls.rows.push({ list, options });
        return el('article', { list });
      },
    },
    listCover: () => el('span'),
  });
  view.wire();
  return { view, nodes, calls, setCurrent: (next) => { current = next; } };
}

test('the index searches and sorts locally, keeping native detail links', () => {
  const h = universeViewHarness();
  h.view.setIndex({ universeQuery: 'Earth1610', universeSort: 'alphabetical' });
  h.view.renderIndex();
  assert.equal(h.nodes.index.count.textContent, '1 universe');
  const link = h.nodes.index.results.children[0].children[0].children[0].children[0].children[0];
  assert.equal(link.href, '#/universe/ultimate-marvel');
  let prevented = false;
  link.onclick({ button: 0, preventDefault: () => { prevented = true; } });
  assert.equal(prevented, true);
  assert.deepEqual(h.calls.navigation, ['ultimate-marvel']);
  link.onclick({ button: 0, ctrlKey: true, preventDefault: () => assert.fail('modified click intercepted') });
  assert.deepEqual(h.calls.navigation, ['ultimate-marvel']);

  h.nodes.index.query.value = 'no such reality';
  h.nodes.index.query.listeners.input();
  assert.match(h.nodes.index.count.textContent, /No universes match/);
  assert.deepEqual(h.view.indexState(), { universeQuery: 'no such reality', universeSort: 'alphabetical' });
  assert.equal(h.calls.changes, 1);
});

test('detail keeps static facts and permits retry when the catalog fails', async () => {
  let fail = true;
  const h = universeViewHarness({
    loadCatalog: async () => {
      if (fail) throw new Error('offline');
      return { lists: [] };
    },
  });
  h.setCurrent('universe');
  h.view.setDetail('ultimate-marvel');
  await h.view.renderDetail();
  assert.equal(h.nodes.detail.heading.textContent, 'Ultimate Marvel');
  assert.equal(h.nodes.detail.earth.textContent, 'Earth-1610');
  assert.match(h.nodes.detail.status.textContent, /could not be loaded.*offline/i);
  assert.equal(h.nodes.detail.retry.hidden, false);
  assert.equal(h.nodes.detail.emptyLink.hidden, true, 'failure is not an empty catalog');
  fail = false;
  await h.nodes.detail.retry.listeners.click();
  assert.match(h.nodes.detail.status.textContent, /No Reading Lists/);
  assert.equal(h.nodes.detail.retry.hidden, true);
  assert.equal(h.nodes.detail.emptyLink.hidden, false);
});

test('detail shows related-reality scope and warns when catalog entries were dropped', async () => {
  const list = {
    id: 'zombies', name: 'Marvel Zombies', universeIds: ['marvel-zombies'],
    universeScopes: { 'marvel-zombies': { kind: 'related-realities', note: 'Includes stories in other realities.' } },
  };
  const h = universeViewHarness({ loadCatalog: async () => ({ lists: [list], dropped: 2 }) });
  h.setCurrent('universe');
  h.view.setDetail('marvel-zombies');
  await h.view.renderDetail();
  assert.equal(h.calls.rows[0].list, list);
  assert.equal(h.calls.rows[0].options.report, '#universe-report');
  assert.match(h.nodes.detail.results.children[0].children[1].textContent, /Related realities: Includes stories/);
  assert.match(h.nodes.detail.status.textContent, /incomplete/i);
  assert.equal(h.nodes.detail.retry.hidden, false);
});

test('retry requests a fresh catalog after incomplete entries were omitted', async () => {
  const refreshes = [];
  const h = universeViewHarness({
    loadCatalog: async ({ refresh = false } = {}) => {
      refreshes.push(refresh);
      return { lists: [], dropped: refresh ? 0 : 1 };
    },
  });
  h.setCurrent('universe');
  h.view.setDetail('marvel-zombies');
  await h.view.renderDetail();
  await h.nodes.detail.retry.listeners.click();
  assert.deepEqual(refreshes, [false, true]);
  assert.equal(h.nodes.detail.retry.hidden, true);
  assert.equal(h.nodes.detail.emptyLink.hidden, false);
});

test('an incomplete catalog does not claim that a universe has no associated lists', async () => {
  const h = universeViewHarness({ loadCatalog: async () => ({ lists: [], dropped: 1 }) });
  h.setCurrent('universe');
  h.view.setDetail('marvel-zombies');
  await h.view.renderDetail();
  assert.match(h.nodes.detail.status.textContent, /No matching Reading Lists could be confirmed/);
  assert.match(h.nodes.detail.status.textContent, /results may be incomplete/);
  assert.equal(h.nodes.detail.emptyLink.hidden, true);
});

test('unknown details have a return path and a departed load cannot repaint', async () => {
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const h = universeViewHarness({ loadCatalog: () => pending });
  h.setCurrent('universe');
  h.view.setDetail('ultimate-marvel');
  const loading = h.view.renderDetail();
  h.setCurrent('universes');
  release({ lists: [] });
  await loading;
  assert.match(h.nodes.detail.status.textContent, /Loading/);

  h.setCurrent('universe');
  h.view.setDetail('unknown-reality');
  await h.view.renderDetail();
  assert.equal(h.nodes.detail.heading.textContent, 'Universe not found');
  assert.equal(h.nodes.detail.missing.hidden, false);
  assert.equal(h.nodes.detail.body.hidden, true);
});
