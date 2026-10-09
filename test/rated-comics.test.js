import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RATING_THRESHOLDS,
  buildRatedGuideIndex,
  characterOptions,
  createRatedGuideIndexLoader,
  filterRatedComics,
  parseRatedGuideIndex,
  ratedComics,
  serializeRatedGuideIndex,
  sortRatedComics,
  topRatedComics,
} from '../src/js/lib/ratedComics.js';

const issue = (id, title, extra = {}) => ({ id, title, seriesName: null, number: null, ...extra });

function sampleState() {
  return {
    issues: {
      1: issue(1, 'Astonishing X-Men #1', { seriesName: 'Astonishing X-Men (2004)' }),
      2: issue(2, 'Daredevil #1', { seriesName: 'Daredevil (1998)' }),
      3: issue(3, 'Amazing Spider-Man #300'),
      5: issue(5, 'Unrated issue'),
    },
    ratings: { 1: 5, 2: 4.5, 3: 2, 4: 4 },
  };
}

function sampleIndex() {
  return parseRatedGuideIndex(JSON.parse(serializeRatedGuideIndex(buildRatedGuideIndex(
    [
      { id: 'x-men', name: 'X-Men', characters: ['X-Men', 'Wolverine'] },
      { id: 'devil', name: 'Daredevil', characters: ['Daredevil'] },
    ],
    new Map([
      ['x-men', { items: [{ issueId: 1 }, { issueId: 4 }] }],
      ['devil', { items: [{ issueId: 2 }, { issueId: 1 }] }],
    ]),
  ))));
}

test('every saved rating is a rated comic, including one with no saved issue metadata', () => {
  const rows = ratedComics(sampleState());
  assert.deepEqual(rows.map((row) => row.issueId).sort(), [1, 2, 3, 4]);
  const orphan = rows.find((row) => row.issueId === 4);
  assert.equal(orphan.known, false);
  assert.equal(orphan.title, 'Issue 4');
  assert.equal(rows.some((row) => row.issueId === 5), false, 'an unrated issue is not a rated comic');
  assert.deepEqual(ratedComics({ ratings: { 0: 4, x: 4, 7: 4.2, 8: 3 } }).map((row) => row.issueId), [8]);
});

test('Highest rated orders by score, then title, then id; Title orders by title first', () => {
  const rows = ratedComics({
    issues: { 1: issue(1, 'Beta'), 2: issue(2, 'Alpha'), 3: issue(3, 'Alpha') },
    ratings: { 1: 5, 2: 3, 3: 5 },
  });
  assert.deepEqual(sortRatedComics(rows).map((row) => row.issueId), [3, 1, 2]);
  assert.deepEqual(sortRatedComics(rows, 'title').map((row) => row.issueId), [3, 2, 1]);
});

test('the Top-rated shelf holds at most six comics rated four or higher', () => {
  const ratings = Object.fromEntries(Array.from({ length: 9 }, (_, i) => [i + 1, i < 7 ? 4 + (i % 3) / 2 : 3.5]));
  const top = topRatedComics(ratedComics({ issues: {}, ratings }));
  assert.equal(top.length, 6);
  assert.ok(top.every((row) => row.score >= 4));
  assert.equal(top[0].score, 5);
  assert.deepEqual(RATING_THRESHOLDS, [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]);
});

test('minimum score is inclusive and text search reports the unknown comics it cannot match', () => {
  const rows = ratedComics(sampleState());
  assert.deepEqual(filterRatedComics(rows, { min: 4.5 }).rows.map((row) => row.issueId).sort(), [1, 2]);
  const found = filterRatedComics(rows, { min: 4, q: 'astonishing 2004' });
  assert.deepEqual(found.rows.map((row) => row.issueId), [1]);
  assert.equal(found.total, 4);
  assert.equal(found.unknownExcluded, 1, 'issue 4 has no metadata and is counted, not hidden silently');
  assert.equal(filterRatedComics(rows, { q: 'spider man' }).rows[0].issueId, 3);
});

test('a Character guide filter matches guide associations and names the guides', () => {
  const rows = ratedComics(sampleState());
  const index = sampleIndex();
  const result = filterRatedComics(rows, { character: 'wolverine' }, index);
  assert.equal(result.characterApplied, true);
  assert.deepEqual(result.rows.map((row) => row.issueId).sort(), [1, 4]);
  assert.deepEqual(result.rows.find((row) => row.issueId === 1).guides.map((g) => g.id), ['x-men']);
  assert.deepEqual(characterOptions(index, rows), ['Daredevil', 'Wolverine', 'X-Men']);
});

test('without the guide data the character filter is pending, never an empty or full match', () => {
  const rows = ratedComics(sampleState());
  const result = filterRatedComics(rows, { min: 4, character: 'Wolverine' }, null);
  assert.equal(result.characterApplied, false);
  assert.equal(result.characterPending, true);
  assert.equal(result.rows.length, result.baseCount);
  assert.equal(result.baseCount, 3);
});

test('the index builder is deterministic and refuses malformed catalog or payload input', () => {
  const catalog = [
    { id: 'b', name: 'B', characters: ['Thor', 'thor'] },
    { id: 'a', name: 'A', characters: ['Hulk'] },
  ];
  const payloads = new Map([['a', { items: [{ issueId: 9 }, { issueId: -3 }] }], ['b', { items: [{ issueId: 9 }] }]]);
  const built = buildRatedGuideIndex(catalog, payloads);
  assert.deepEqual(built, {
    version: 1,
    guides: [['a', 'A', ['Hulk']], ['b', 'B', ['Thor']]],
    issueGuides: [[-3, [0]], [9, [0, 1]]],
  });
  assert.equal(serializeRatedGuideIndex(built), serializeRatedGuideIndex(buildRatedGuideIndex([...catalog].reverse(), payloads)));
  assert.throws(() => buildRatedGuideIndex(catalog, new Map([['a', payloads.get('a')]])), /no payload items/);
  assert.throws(() => buildRatedGuideIndex(catalog, new Map([...payloads, ['a', { items: [{ issueId: 0 }] }]])), /invalid issue id/);
});

test('a malformed index is unavailable rather than an index with no associations', () => {
  const good = { version: 1, guides: [['a', 'A', ['Hulk']]], issueGuides: [[1, [0]]] };
  assert.equal(parseRatedGuideIndex(good).byIssue.get(1)[0], 0);
  for (const bad of [
    null,
    { ...good, version: 2 },
    { ...good, guides: [['a', 'A']] },
    { ...good, issueGuides: [[1, [1]]] },
    { ...good, issueGuides: [[1, []]] },
    { ...good, issueGuides: [[1, [0]], [1, [0]]] },
    { ...good, guides: [['a', 'A', ['Hulk', 'hulk']]] },
  ]) {
    assert.throws(() => parseRatedGuideIndex(bad), /not valid/);
  }
});

test('the loader fetches once, shares a pending request, and lets Retry start a fresh one', async () => {
  const calls = [];
  let fail = true;
  const loader = createRatedGuideIndexLoader({
    url: 'index.json',
    fetchImpl: async (url, init) => {
      calls.push([url, init.cache]);
      if (fail) return { ok: false, status: 503 };
      return { ok: true, json: async () => ({ version: 1, guides: [], issueGuides: [] }) };
    },
  });
  assert.equal(calls.length, 0, 'creating the loader fetches nothing');
  const [a, b] = [loader.load(), loader.load()];
  assert.equal(a, b);
  await assert.rejects(a, /HTTP 503/);
  fail = false;
  const index = await loader.load();
  assert.equal(index.byIssue.size, 0);
  assert.equal(await loader.load(), index);
  assert.deepEqual(calls, [['index.json', 'no-cache'], ['index.json', 'no-cache']]);
});
