import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { catalogContains, catalogWriters } from '../scripts/vendor-orders.mjs';
import { parseCatalog } from '../src/js/lib/catalog.js';
import { MAX_SIMILAR_LISTS, nearEnd, similarLists } from '../src/js/lib/similarLists.js';

const list = (id, extra = {}) => ({
  id,
  name: extra.name ?? id,
  file: `${id.replaceAll('-', '_')}.json`,
  count: 3,
  placeholderCount: 0,
  emptyRecordCount: 0,
  type: 'event',
  ...extra,
});

const fixture = (lists, paths = []) => parseCatalog({ lists, paths });
const saved = (catalogId, itemIds = [1, 2, 3]) => ({ catalogId, itemIds });
const stateFor = (lists, read = {}) => ({
  lists,
  listOrder: Object.keys(lists),
  read,
  issues: {},
  active: Object.keys(lists)[0],
});
const notCompleted = () => false;
const ids = (results) => results.map((row) => row.catalogId);

test('ranks by shared story types, then tones, then writers, and explains each match', () => {
  const catalog = fixture([
    list('source', { storyTypes: ['espionage', 'thriller'], tones: ['dark'], writers: ['Ed Brubaker'] }),
    list('one-type', { storyTypes: ['espionage'], tones: ['dark'], writers: ['Ed Brubaker'] }),
    list('two-types', { storyTypes: ['thriller', 'espionage'] }),
    list('tone-only', { storyTypes: ['thriller'], tones: ['dark'] }),
    list('writer-only', { storyTypes: ['thriller'], writers: ['Ed Brubaker'] }),
    list('unrelated', { storyTypes: ['comedy'], tones: ['dark'], writers: ['Ed Brubaker'] }),
  ]);
  const results = similarLists({
    catalog, state: stateFor({ a: saved('source') }), sourceListId: 'a', isCompleted: notCompleted, limit: 5,
  });
  assert.deepEqual(ids(results), ['two-types', 'one-type', 'tone-only', 'writer-only']);
  assert.deepEqual(results[1].reasons.map((reason) => reason.text), [
    'Same story type: Espionage', 'Same tone: Dark', 'Same writer: Ed Brubaker',
  ]);
  assert.deepEqual(results[0].reasons.map((reason) => reason.text), ['Same story type: Espionage, Thriller']);
});

test('returns at most three by default and breaks ties by timeline nearness, then name', () => {
  const catalog = fixture([
    list('source', { storyTypes: ['horror'], timeline: 2000 }),
    list('far', { name: 'A far', storyTypes: ['horror'], timeline: 1970 }),
    list('near', { name: 'Z near', storyTypes: ['horror'], timeline: 2002 }),
    list('undated', { name: 'B undated', storyTypes: ['horror'] }),
    list('mid', { name: 'M mid', storyTypes: ['horror'], timeline: 1990 }),
  ]);
  const results = similarLists({
    catalog, state: stateFor({ a: saved('source') }), sourceListId: 'a', isCompleted: notCompleted,
  });
  assert.equal(MAX_SIMILAR_LISTS, 3);
  assert.deepEqual(ids(results), ['near', 'mid', 'far']);
});

test('leaves out MCU Prep, untagged lists, the source story and every story on its Reading Path', () => {
  const catalog = fixture([
    list('source', { storyTypes: ['war'], group: 'big-war' }),
    list('source-essential', { storyTypes: ['war'], group: 'big-war' }),
    list('screen', { storyTypes: ['war'], type: 'screen-companion' }),
    list('untagged'),
    list('before', { storyTypes: ['war'] }),
    list('after', { storyTypes: ['war'] }),
    list('elsewhere', { storyTypes: ['war'] }),
  ], [{
    id: 'path', name: 'A path', description: 'A path.', sourceOrigin: 'https://example.com/',
    steps: ['before', 'source', 'after'],
  }]);
  const results = similarLists({
    catalog, state: stateFor({ a: saved('source') }), sourceListId: 'a', isCompleted: notCompleted,
  });
  assert.deepEqual(ids(results), ['elsewhere']);
});

test('finishing an MCU Prep list may suggest comics, but never another MCU Prep list', () => {
  const catalog = fixture([
    list('prep', { storyTypes: ['war'], type: 'screen-companion' }),
    list('other-prep', { storyTypes: ['war'], type: 'screen-companion' }),
    list('comic', { storyTypes: ['war'] }),
  ]);
  const results = similarLists({
    catalog, state: stateFor({ a: saved('prep') }), sourceListId: 'a', isCompleted: notCompleted,
  });
  assert.deepEqual(ids(results), ['comic']);
});

test('near the end means the smaller of 5 issues or a tenth of the list, at least 1, past halfway', () => {
  const at = (total) => Array.from({ length: total + 1 }, (_, read) => read)
    .filter((read) => nearEnd({ read, total }))
    .map((read) => total - read);
  assert.deepEqual(at(1), [], 'one unread issue of one is not past halfway');
  assert.deepEqual(at(3), [1]);
  assert.deepEqual(at(19), [1], 'a tenth rounds down, so 19 issues leave a window of 1');
  assert.deepEqual(at(20), [2, 1], 'House of M: the last 2 of 20');
  assert.deepEqual(at(80), [5, 4, 3, 2, 1], 'a tenth of 80 is 8, so the 5-issue cap applies');
  assert.equal(nearEnd({ read: 20, total: 20 }), false, 'a finished list is not near the end');
  assert.equal(nearEnd({ read: 0, total: 0 }), false);
  assert.equal(nearEnd(), false);
});

test('skips finished saved lists and ids already shown, and points at an unfinished saved copy', () => {
  const catalog = fixture([
    list('source', { storyTypes: ['comedy'] }),
    list('completed', { storyTypes: ['comedy'] }),
    list('all-read', { storyTypes: ['comedy'] }),
    list('shown', { storyTypes: ['comedy'] }),
    list('started', { storyTypes: ['comedy'] }),
  ]);
  const state = stateFor({
    a: saved('source'),
    b: saved('completed'),
    c: saved('all-read', [7, 8]),
    d: saved('started', [9]),
  }, { 7: true, 8: true });
  const results = similarLists({
    catalog,
    state,
    sourceListId: 'a',
    isCompleted: (_state, id) => id === 'b',
    exclude: new Set(['shown']),
  });
  assert.deepEqual(ids(results), ['started']);
  assert.equal(results[0].savedListId, 'd');
});

test('a source with no story types, or no catalog entry, suggests nothing', () => {
  const catalog = fixture([list('source'), list('other', { storyTypes: ['comedy'] })]);
  const call = (lists) => similarLists({
    catalog, state: stateFor(lists), sourceListId: 'a', isCompleted: notCompleted,
  });
  assert.deepEqual(call({ a: saved('source') }), []);
  assert.deepEqual(call({ a: saved('missing') }), []);
  assert.deepEqual(similarLists({}), []);
});

test('catalogWriters keeps writers on at least a quarter of the issues, most credited first', () => {
  const issue = (...names) => ({ creators: [
    ...names.map((name) => ({ name, role: 'writer' })),
    { name: 'An Artist', role: 'penciler' },
  ] });
  assert.deepEqual(catalogWriters({ items: [
    issue('B Writer'), issue('A Writer'), issue('A Writer', 'A Writer'), issue('C Writer'),
    issue('B Writer'), issue('D Writer'), issue('A Writer'), issue('E Writer'),
  ] }), ['A Writer', 'B Writer']);
  assert.deepEqual(catalogWriters({ items: [issue('W'), issue('X'), issue('Y'), issue('Z')] }),
    ['W', 'X', 'Y']);
  assert.deepEqual(catalogWriters({ items: [{ creators: [{ name: 'Only Art', role: 'inker' }] }] }), []);
  assert.deepEqual(catalogWriters(null), []);
});

test('never suggests a list wholly inside the source or a finished saved list, but keeps one that contains more', () => {
  const catalog = fixture([
    list('source', { storyTypes: ['war'], contains: ['inside'] }),
    list('inside', { storyTypes: ['war'] }),
    list('wider', { storyTypes: ['war'], contains: ['source', 'inside'] }),
    list('finished', { storyTypes: ['comedy'], contains: ['inside-finished'] }),
    list('inside-finished', { storyTypes: ['war'] }),
    list('elsewhere', { storyTypes: ['war'] }),
  ]);
  const state = stateFor({ a: saved('source'), b: saved('finished', [7]) }, { 7: 1 });
  const results = similarLists({ catalog, state, sourceListId: 'a', isCompleted: notCompleted, limit: 5 });
  assert.deepEqual(ids(results).sort(), ['elsewhere', 'wider']);
});

// The four cases code review 5800239b found by finishing each shipped list in turn: every one of
// these suggestions named a list whose every issue the reader had just read.
for (const [sourceId, readId] of [
  ['planet-hulk-reading-order-and-greg-pak-hulk-comics-guide', 'planet-hulk'],
  ['miles-morales-spider-man-reading-order', 'miles-morales-best-of'],
  ['mcu-prep-captain-america-civil-war-2016', 'civil-war-essential'],
  ['captain-america-best-of', 'captain-america-reading-order-modern-marvel-era'],
]) {
  test(`finishing ${sourceId} never suggests ${readId}, already read inside it`, async () => {
    const raw = JSON.parse(await readFile(path.join('src', 'data', 'catalog.json'), 'utf8'));
    const catalog = parseCatalog(raw);
    const entry = (id) => catalog.lists.find((row) => row.id === id);
    const order = async (id) => JSON.parse(await readFile(path.join('src', 'data', entry(id).file), 'utf8'))
      .items.map((item) => item.issueId);
    const itemIds = await order(sourceId);
    assert.ok((await order(readId)).every((id) => itemIds.includes(id)), `${readId} is inside ${sourceId}`);
    const state = stateFor({ a: { catalogId: sourceId, itemIds } },
      Object.fromEntries(itemIds.map((id) => [id, 1])));
    for (const limit of [1, MAX_SIMILAR_LISTS, 50]) {
      const results = similarLists({ catalog, state, sourceListId: 'a', isCompleted: () => true, limit });
      assert.ok(!ids(results).includes(readId), `${readId} suggested at limit ${limit}: ${ids(results)}`);
    }
  });
}

test('every catalog entry records exactly the other bundled lists its own order wholly contains', async () => {
  const catalog = JSON.parse(await readFile(path.join('src', 'data', 'catalog.json'), 'utf8'));
  const payloads = new Map();
  for (const entry of catalog.lists) {
    payloads.set(entry.id, JSON.parse(await readFile(path.join('src', 'data', entry.file), 'utf8')));
  }
  const expected = catalogContains(payloads);
  for (const entry of catalog.lists) assert.deepEqual(entry.contains ?? [], expected.get(entry.id) ?? [], entry.id);
  assert.ok(catalog.lists.some((entry) => entry.contains?.length));
});

test('catalogContains needs every issue inside, ignores empty orders, and keeps catalog order', () => {
  const payload = (...issueIds) => ({ items: issueIds.map((issueId) => ({ issueId })) });
  const contains = catalogContains(new Map([
    ['big', payload(1, 2, 3, 4)],
    ['part', payload(2, 3)],
    ['same', payload(1, 2, 3, 4)],
    ['partly-outside', payload(3, 9)],
    ['empty', payload()],
  ]));
  assert.deepEqual(contains.get('big'), ['part', 'same']);
  assert.deepEqual(contains.get('same'), ['big', 'part']);
  assert.equal(contains.has('part'), false);
  assert.equal(contains.has('empty'), false);
});

test('every catalog entry carries the writers its own bundled order credits', async () => {
  const catalog = JSON.parse(await readFile(path.join('src', 'data', 'catalog.json'), 'utf8'));
  let withWriters = 0;
  for (const entry of catalog.lists) {
    const payload = JSON.parse(await readFile(path.join('src', 'data', entry.file), 'utf8'));
    const writers = catalogWriters(payload);
    assert.deepEqual(entry.writers ?? [], writers, entry.id);
    if (writers.length) withWriters += 1;
  }
  assert.ok(withWriters > catalog.lists.length / 2);
});
