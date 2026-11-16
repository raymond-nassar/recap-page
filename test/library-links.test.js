import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { editionCatalog, editionEvidence } from '../src/js/lib/collectedEditions.js';
import { captureCompleteBackup } from '../src/js/lib/completeBackup.js';
import { observeSavedWrites } from '../src/js/lib/cloudCoordinator.js';
import { LIBRARY_LINKS_KEY } from '../src/js/storage.js';
import { catalogEntries } from '../src/js/lib/catalog.js';
import {
  coverageMatches, coverageText, filterStoriesByLinks, linkFilter, listCoverage, listLinkCoverage, readLinkFilter,
  saveLinkFilter, storyCoverage,
} from '../src/js/lib/libraryLinks.js';
import { PAGE_LINK_TEXT, createLibraryLinkFilter, linkNarrower, linkNarrowing } from '../src/js/views/shared/library-link-filter.js';

const approval = 'https://github.com/raymond-nassar/recap-page/issues/1203#issuecomment-6839342560';
const hoopla = { provider: 'hoopla', url: 'https://www.hoopladigital.com/title/123456789', checkedAt: '2026-11-10', confirmedBy: 'owner' };
const libby = { provider: 'libby', url: 'https://share.libbyapp.com/title/1234567', checkedAt: '2026-11-10', confirmedBy: 'owner' };
const catalog = {
  providers: {
    hoopla: { name: 'Hoopla', basis: 'owner-approval', basisEvidence: approval },
    libby: { name: 'Libby', basis: 'owner-approval', basisEvidence: approval },
  },
  editions: {
    both: { title: 'Both', destinations: [hoopla, libby] },
    hooplaOnly: { title: 'Hoopla only', destinations: [hoopla] },
    unlinked: { title: 'No links', destinations: [] },
  },
};
const row = (issueId) => ({ issueId, seriesId: 1, number: String(issueId) });
const relation = (issueId, editionId, extra = {}) => ({
  catalogId: 'list', editionId, ...row(issueId), status: 'verified', portion: 'full', conflicts: [],
  source: 'https://www.comics.org/issue/1/', checkedAt: '2026-11-10', ...extra,
});

test('the library-link choice is device-local and survives damage', async () => {
  const map = new Map();
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  assert.deepEqual(readLinkFilter(storage, LIBRARY_LINKS_KEY), { coverage: 'off', provider: 'either' });
  saveLinkFilter(storage, LIBRARY_LINKS_KEY, { coverage: 'every', provider: 'libby', extra: 1 });
  assert.equal(map.get(LIBRARY_LINKS_KEY), '{"coverage":"every","provider":"libby"}');
  assert.deepEqual(readLinkFilter(storage, LIBRARY_LINKS_KEY), { coverage: 'every', provider: 'libby' });
  map.set(LIBRARY_LINKS_KEY, '{not json');
  assert.deepEqual(readLinkFilter(storage, LIBRARY_LINKS_KEY), { coverage: 'off', provider: 'either' });

  map.set(LIBRARY_LINKS_KEY, '{"coverage":"any","provider":"hoopla"}');
  const withChoice = await captureCompleteBackup({ storage, cryptoProvider: webcrypto });
  const without = await captureCompleteBackup({ storage: { getItem: () => null }, cryptoProvider: webcrypto });
  assert.equal(withChoice.text, without.text);
  const reported = [];
  observeSavedWrites(storage, (key) => reported.push(key)).setItem(LIBRARY_LINKS_KEY, '{}');
  assert.deepEqual(reported, []);
});

test('library-link coverage counts reading positions through the display gate', () => {
  const evidence = {
    relations: [
      relation(1, 'both'),
      relation(2, 'hooplaOnly'),
      relation(3, 'unlinked'),
      relation(4, 'both', { portion: 'partial' }),
      relation(5, 'both', { conflicts: [{ kind: 'x' }] }),
      relation(6, 'both', { catalogId: 'other' }),
    ],
  };
  // Issue 1 appears twice, so it is two linked positions; the placeholder is a gap.
  const items = [row(1), row(2), row(3), row(4), row(5), row(6), row(1), { placeholder: true }];
  assert.deepEqual(listLinkCoverage('list', items, catalog, evidence),
    { positions: 8, either: 3, hoopla: 3, libby: 2 });
});

test('a story is linked when any reading is and fully linked only when every position is', () => {
  const coverage = { a: { positions: 4, either: 4, hoopla: 4, libby: 1 }, b: { positions: 2, either: 1, hoopla: 0, libby: 1 } };
  const a = { id: 'a', count: 4 };
  const b = { id: 'b', count: 2 };
  const none = { id: 'none', count: 3 };
  assert.deepEqual(listCoverage(none, 'either', coverage), { linked: 0, total: 3 });
  assert.deepEqual(storyCoverage([a, b], 'either', coverage), { linked: 5, total: 6 });
  assert.deepEqual(storyCoverage([a, b], 'libby', coverage), { linked: 2, total: 6 });
  assert.equal(coverageMatches(storyCoverage([a], 'hoopla', coverage), 'every'), true);
  assert.equal(coverageMatches(storyCoverage([a, b], 'either', coverage), 'every'), false);
  assert.equal(coverageMatches({ linked: 0, total: 0 }, 'every'), false);
  const stories = [{ lists: [a] }, { lists: [b] }, { lists: [none] }, { lists: [none, b] }];
  const kept = (filter) => filterStoriesByLinks(stories, filter, { coverage }).map((story) => stories.indexOf(story));
  assert.deepEqual(kept({ coverage: 'any', provider: 'either' }), [0, 1, 3]);
  assert.deepEqual(kept({ coverage: 'any', provider: 'hoopla' }), [0]);
  assert.deepEqual(kept({ coverage: 'every', provider: 'either' }), [0]);
  assert.deepEqual(kept({ coverage: 'off', provider: 'libby' }), [0, 1, 2, 3]);
  assert.deepEqual(linkFilter({ coverage: 'bogus', provider: 'amazon' }), { coverage: 'off', provider: 'either' });
  assert.equal(coverageText({ linked: 1, total: 1 }, 'libby'), '1 of 1 comic with a checked Libby link');
});

test('shipped library-link counts match the reading lists they describe', () => {
  const read = (file) => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8'));
  const entries = read('catalog.json').lists;
  const named = new Set(editionEvidence.relations.map((entry) => entry.catalogId));
  const shipped = editionEvidence.linkCoverage;
  assert.ok(Object.keys(shipped).length > 0);
  for (const entry of entries.filter((candidate) => named.has(candidate.id))) {
    const items = read(entry.file).items;
    const counts = listLinkCoverage(entry.id, items, editionCatalog, editionEvidence);
    assert.equal(counts.positions, entry.count, entry.id);
    assert.deepEqual(shipped[entry.id], counts.either ? counts : undefined, entry.id);
  }
  for (const id of Object.keys(shipped)) assert.ok(named.has(id), id);
});

test("Thor War's End contributes only its selected positions to three library-link counts", () => {
  const expected = {
    'war-of-the-realms': { positions: 66, either: 16, hoopla: 16, libby: 16 },
    'thor-best-of': { positions: 144, either: 5, hoopla: 5, libby: 5 },
    'loki-reading-order': { positions: 656, either: 5, hoopla: 5, libby: 5 },
  };
  const lists = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8')).lists;
  for (const [id, counts] of Object.entries(expected)) {
    const list = lists.find((entry) => entry.id === id);
    const items = JSON.parse(readFileSync(new URL(`../src/data/${list.file}`, import.meta.url), 'utf8')).items;
    assert.deepEqual(listLinkCoverage(id, items, editionCatalog, editionEvidence), counts);
    assert.deepEqual(editionEvidence.linkCoverage[id], counts);
  }
});

test('each card counts the list it opens, not the other readings of its story', () => {
  const catalogLists = JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8')).lists;
  const card = (id) => catalogEntries(catalogLists.filter((list) => list.id === id))[0];
  const every = linkNarrower({ coverage: 'every', provider: 'either' });
  const any = linkNarrower({ coverage: 'any', provider: 'either' });
  // Civil War: Essential is fully linked on its own, though the stop's other readings are not.
  assert.equal(every.linkText(card('civil-war-essential')), '7 of 7 comics with a checked Hoopla or Libby link');
  assert.equal(every.keep(card('civil-war-essential')), true);
  // Secret Invasion: Essential has no linked comic, though another reading of its story does.
  assert.equal(any.keep(card('secret-invasion-essential')), false);
  assert.equal(any.keep(card('secret-invasion')), true);
});

test('the shared filter remembers one choice, and the category always filters', () => {
  const map = new Map();
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  const filter = createLibraryLinkFilter({ el: () => null, storage, key: LIBRARY_LINKS_KEY });
  const changes = [];
  filter.mount('catalog', null, { onChange: (value) => changes.push(value) });
  filter.mount('library-links', null, { always: true });
  assert.deepEqual(filter.current('catalog'), { coverage: 'off', provider: 'either' });
  assert.deepEqual(filter.current('library-links'), { coverage: 'any', provider: 'either' });
  assert.equal(map.has(LIBRARY_LINKS_KEY), false);

  map.set(LIBRARY_LINKS_KEY, '{"coverage":"every","provider":"libby"}');
  filter.reload();
  assert.deepEqual(filter.current('young-readers'), { coverage: 'every', provider: 'libby' });
  assert.equal(linkNarrowing(filter.current('catalog')), ' where every comic has a checked Libby link');

  filter.reset('catalog');
  assert.deepEqual(changes, [{ coverage: 'off', provider: 'libby' }]);
  assert.equal(map.get(LIBRARY_LINKS_KEY), '{"coverage":"off","provider":"libby"}');
  assert.equal(linkNarrowing(filter.current('catalog')), '');
  map.set(LIBRARY_LINKS_KEY, '{"coverage":"any","provider":"libby"}');
  filter.reload();
  filter.reset('catalog', { silent: true });
  assert.equal(changes.length, 1);
  assert.equal(linkNarrowing({ coverage: 'any', provider: 'either' }), ' with at least one checked Hoopla or Libby link');
});

test('choosing on the Library links page saves only the provider', () => {
  const map = new Map();
  const storage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
  const el = (tag, props = {}, children = []) => ({ tag, props, children });
  const container = { nodes: [], replaceChildren(...nodes) { this.nodes = nodes; }, contains: () => false, querySelectorAll: () => [] };
  const pick = (name, value) => {
    const walk = (node) => (node?.props?.name === name && node.props.value === value
      ? node : (node?.children ?? []).map(walk).find(Boolean));
    container.nodes.map(walk).find(Boolean).props.onchange();
  };
  const filter = createLibraryLinkFilter({ el, storage, key: LIBRARY_LINKS_KEY });
  filter.mount('catalog', null);
  filter.mount('library-links', container, { always: true });
  pick('library-links-links-coverage', 'every');
  assert.deepEqual(filter.current('library-links'), { coverage: 'every', provider: 'either' });
  assert.deepEqual(filter.current('catalog'), { coverage: 'off', provider: 'either' });
  assert.equal(map.has(LIBRARY_LINKS_KEY), false);
  pick('library-links-links-provider', 'libby');
  assert.deepEqual(filter.current('library-links'), { coverage: 'every', provider: 'libby' });
  assert.deepEqual(filter.current('catalog'), { coverage: 'off', provider: 'libby' });
  assert.equal(map.get(LIBRARY_LINKS_KEY), '{"coverage":"off","provider":"libby"}');
});

test('every browsing filter links to the Library links page, and the page itself does not', () => {
  const el = (tag, props = {}, children = []) => ({ tag, props, children });
  const box = () => ({ nodes: [], replaceChildren(...nodes) { this.nodes = nodes; }, contains: () => false, querySelectorAll: () => [] });
  const links = (node) => (node?.tag === 'link' ? [node] : (node?.children ?? []).flatMap(links));
  const filter = createLibraryLinkFilter({ el, storage: null, key: LIBRARY_LINKS_KEY, pageLink: (text) => el('link', {}, [text]) });
  const browsing = box();
  const page = box();
  filter.mount('catalog', browsing);
  filter.mount('library-links', page, { always: true });
  assert.deepEqual(browsing.nodes.flatMap(links).map((node) => node.children[0]), [PAGE_LINK_TEXT]);
  assert.deepEqual(page.nodes.flatMap(links), []);
});
