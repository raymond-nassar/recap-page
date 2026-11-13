import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestNames } from '../src/js/lib/searchSpelling.js';

const names = (...values) => values.map((name) => ({ name }));

test('spelling suggestions accept one insertion, deletion, replacement or adjacent swap', () => {
  for (const query of ['avenggers', 'avngers', 'avengars', 'avengres']) {
    assert.deepEqual(suggestNames(names('Avengers'), query), ['Avengers'], query);
  }
  assert.deepEqual(suggestNames(names('Jonathan Hickman'), 'hickamn'), ['Jonathan Hickman']);
  assert.deepEqual(suggestNames(names('José Núñez'), 'jose nunnez'), ['José Núñez']);
});

test('suggestions protect short words, numbers, contiguous words and the normalized length boundary', () => {
  for (const [query, name] of [
    ['cap', 'Cape'], ['spider wman', 'Spider-Man'], ['marvel 1603', 'Marvel 1602'],
    ['spidre mn', 'Spider-Man'], ['hickman jonatthan', 'Jonathan Hickman'], ['zzzzzz', 'Avengers'],
  ]) assert.deepEqual(suggestNames(names(name), query), [], query);
  const query = `${'x '.repeat(38)}civl`;
  assert.equal(query.length, 80);
  assert.deepEqual(suggestNames(names(`${'x '.repeat(38)}Civil`), query), [`${'x '.repeat(38)}Civil`]);
  assert.deepEqual(suggestNames(names(`x${'x '.repeat(38)}Civil`), `x${query}`), []);
  for (const query of ['', '!?', '1234']) assert.deepEqual(suggestNames(names('Avengers'), query), []);
});

test('only series numeric year suffixes are removed, not meaningful parenthesized names', () => {
  const rows = names('Avengers (1963 - 1996)', 'Avengers (2010)', 'Avengers (Present)',
    'Marvel (Team-Up)', 'Jonathan Hickman (Writer)');
  assert.deepEqual(suggestNames(rows, 'avengres', { series: true }), ['Avengers', 'Avengers (Present)']);
  assert.deepEqual(suggestNames(rows, 'hickamn'), ['Jonathan Hickman (Writer)']);
  assert.deepEqual(suggestNames(rows, 'marvle team up', { series: true }), ['Marvel (Team-Up)']);
});

test('deduplicated suggestions prefer the closest name then body of work and cap at three', () => {
  const rows = [
    { name: 'Avengers Academy', issueCount: 999 },
    { name: 'Avengers', issueCount: 1 },
    { name: 'AVENGERS', issueCount: 40 },
    { name: 'New Avengers', issueCount: 100 },
    { name: 'Young Avengers', issueCount: 12 },
    { name: 'Dark Avengers', issueCount: 8 },
  ];
  assert.deepEqual(suggestNames(rows, 'avengres'), ['AVENGERS', 'Avengers Academy', 'New Avengers']);
  assert.deepEqual(suggestNames([...rows].reverse(), 'avengres'), ['AVENGERS', 'Avengers Academy', 'New Avengers']);
});
