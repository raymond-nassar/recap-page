import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { parseCatalog, STORY_TONES, STORY_TYPES } from '../src/js/lib/catalog.js';
import { parseMcuPrep } from '../src/js/lib/mcuPrep.js';
import { filterSearchLists, listFilterOptions, rankLists, listSearchTerms } from '../src/js/lib/listSearch.js';

const json = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));
const { lists } = parseCatalog(await json('../src/data/catalog.json'));
const metadata = parseMcuPrep(await json('../src/data/mcu-prep.json'));
const ids = (found) => found.map((list) => list.id);
const entry = (id, extra = {}) => ({
  id, name: id, description: '', type: 'event', characters: [], keywords: [], ...extra,
});

test('list facets use recorded values only, label genres and years, and combine every choice with query', () => {
  const sample = [
    entry('a', { name: 'X Story', storyTypes: ['science-fiction'], tones: ['dark'], timeline: 2001, writers: ['Writer A'], sourceOrigin: 'Guide A', characters: ['X-Men'] }),
    entry('b', { name: 'X Other', storyTypes: ['science-fiction'], characters: ['X-Men'] }),
    entry('c', { name: 'Other', tones: ['dark'], timeline: 2002 }),
  ];
  const options = listFilterOptions(sample);
  assert.deepEqual(options.storyTypes, [{ value: 'science-fiction', label: 'Science fiction' }]);
  assert.deepEqual(options.timeline.map((option) => option.value), ['2001', '2002']);
  assert.deepEqual(options.writers, [{ value: 'Writer A', label: 'Writer A' }]);
  assert.deepEqual(ids(filterSearchLists(sample, '', { storyTypes: 'science-fiction' })), ['b', 'a']);
  const filters = {
    storyTypes: 'science-fiction', tones: 'dark', timeline: '2001',
    writers: 'Writer A', sourceOrigin: 'Guide A', characters: 'X-Men', type: 'event',
  };
  assert.deepEqual(ids(filterSearchLists(sample, 'X', filters)), ['a']);
  for (const key of Object.keys(filters)) {
    assert.deepEqual(filterSearchLists(sample, 'X', { ...filters, [key]: 'not recorded' }), [], key);
  }
  assert.deepEqual(filterSearchLists(sample, '', {}), []);
  assert.deepEqual(filterSearchLists(sample, 'not found', filters), []);
  assert.deepEqual(filterSearchLists(sample, 'X', {}), rankLists(sample, 'X'));
});

test('every bundled Reading List is found by its own name and ranked first', () => {
  for (const list of lists) {
    const query = list.variant ? `${list.groupName ?? list.name} ${list.variant}` : list.name;
    const found = rankLists(lists, query);
    assert.ok(found.includes(list), `${list.id} is not found by ${JSON.stringify(query)}`);
    assert.equal(found[0], list, `${list.id} is not first for ${JSON.stringify(query)}`);
  }
});

test('the MCU Prep name finds every screen companion and nothing else', () => {
  const companions = lists.filter((list) => list.type === 'screen-companion');
  assert.equal(companions.length, 37);
  for (const query of ['MCU Prep', 'mcu prep', 'MCU-prep', 'mcuprep']) {
    assert.deepEqual(ids(rankLists(lists, query)).sort(), ids(companions).sort(), query);
  }
});

test('a screen release title finds its companion guide when release metadata is supplied', () => {
  const [id, releases] = [...metadata.guides].find(([, found]) => found.length);
  const title = releases[0].title;
  assert.ok(ids(rankLists(lists, title, { guides: metadata.guides })).includes(id), title);
  // Without metadata a load failure only loses the titles; the lists stay findable by name.
  assert.ok(rankLists(lists, 'mcu prep').length > 0);
});

test('every genre and tone label in use finds the lists that carry it', () => {
  for (const [vocabulary, field] of [[STORY_TYPES, 'storyTypes'], [STORY_TONES, 'tones']]) {
    for (const [tag, label] of Object.entries(vocabulary)) {
      const tagged = lists.filter((list) => list[field]?.includes(tag));
      if (!tagged.length) continue;
      const found = new Set(ids(rankLists(lists, label)));
      for (const list of tagged) assert.ok(found.has(list.id), `${label} misses ${list.id}`);
    }
  }
});

test('matching folds case, accents, punctuation and joined words, and every term must match', () => {
  const sample = [
    entry('civil-war', { name: 'Civil War', characters: ['Spider-Man', 'Iron Man'] }),
    entry('hickman', { name: 'Hickman’s Fantastic Four', characters: ['Black Panther'] }),
    entry('xmen', { name: 'X-Men: Mutant Massacre' }),
  ];
  assert.deepEqual(ids(rankLists(sample, 'spiderman')), ['civil-war']);
  assert.deepEqual(ids(rankLists(sample, 'SPIDER-MAN')), ['civil-war']);
  assert.deepEqual(ids(rankLists(sample, 'hickman’s')), ['hickman']);
  assert.deepEqual(ids(rankLists(sample, 'xmen')), ['xmen']);
  assert.deepEqual(ids(rankLists(sample, 'fantas')), ['hickman']);
  assert.deepEqual(ids(rankLists(sample, 'civil panther')), []);
});

test('results rank exact name, then name, then other fields, then description, then by name', () => {
  const sample = [
    entry('described', { name: 'Alpha', description: 'An infinity story.' }),
    entry('tagged', { name: 'Beta', keywords: ['infinity'] }),
    entry('named-later', { name: 'Infinity War' }),
    entry('named', { name: 'Infinity Gauntlet' }),
    entry('exact', { name: 'Infinity' }),
  ];
  assert.deepEqual(ids(rankLists(sample, 'infinity')),
    ['exact', 'named', 'named-later', 'tagged', 'described']);
});

test('an empty or punctuation-only query finds no Reading Lists', () => {
  for (const query of ['', '   ', '--', '’!?']) {
    assert.deepEqual(listSearchTerms(query), []);
    assert.deepEqual(rankLists(lists, query), []);
  }
});
