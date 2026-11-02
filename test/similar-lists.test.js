import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { catalogWriters } from '../scripts/vendor-orders.mjs';
import { parseCatalog } from '../src/js/lib/catalog.js';
import { MAX_SIMILAR_LISTS, similarLists } from '../src/js/lib/similarLists.js';

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
