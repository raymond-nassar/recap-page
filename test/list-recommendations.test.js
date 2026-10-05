import test from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyState } from '../src/js/lib/model.js';
import { createListRecommendationResolver } from '../src/js/lib/listRecommendations.js';

const entry = (id, extra = {}) => ({
  id,
  name: id,
  file: `${id}.json`,
  type: 'character-run',
  depth: 'essential',
  group: null,
  timeline: null,
  characters: [],
  keywords: [],
  ...extra,
});

const issue = (issueId, extra = {}) => ({
  issueId,
  seriesId: 42,
  seriesName: 'Example series',
  onSale: '2020-01-01T00:00:00+0000',
  creators: [],
  ...extra,
});

const writer = (name, role = 'writer') => ({ name, role });

const readingPath = (id, steps) => ({
  id,
  name: `${id} reading path`,
  description: 'An independently ordered sequence.',
  sourceOrigin: 'Compiled for this test.',
  steps,
});

function reader(catalogId = 'source', issues = [issue(1)]) {
  const state = createEmptyState();
  state.lists.source = {
    id: 'source',
    name: 'Saved source',
    catalogId,
    created: 100,
    itemIds: issues.map((item) => item.issueId),
    deferredIssueIds: [],
    note: 'Keep this note.',
  };
  state.listOrder = ['source'];
  state.active = 'source';
  for (const item of issues) state.issues[item.issueId] = item;
  return state;
}

function save(state, id, catalogId, itemIds) {
  state.lists[id] = { id, catalogId, created: 200, itemIds, note: '', deferredIssueIds: [] };
  state.listOrder.push(id);
}

function harness(orders) {
  const calls = [];
  const resolver = createListRecommendationResolver({
    loadBundledOrder: async (file, { signal }) => {
      calls.push(file);
      assert.ok(signal instanceof AbortSignal);
      assert.ok(Object.hasOwn(orders, file), `Unexpected metadata load: ${file}`);
      const order = orders[file];
      if (order instanceof Error) throw order;
      return order;
    },
  });
  return { resolver, calls };
}

const resolve = (resolver, catalog, state, extra = {}) => resolver.resolve({
  catalog,
  state,
  sourceListId: 'source',
  isCompleted: () => false,
  ...extra,
});

const reasonsOf = (result, type) => result.suggestions
  .flatMap((suggestion) => suggestion.reasons.filter((reason) => reason.type === type));

const snapshot = (catalog, state) => JSON.stringify({ catalog, state });
const tick = () => new Promise((settle) => setImmediate(settle));

test('independent Reading Paths deduplicate stories, exclude source siblings, and choose default variants', async () => {
  const catalog = {
    lists: [
      entry('source-core', { group: 'source-story' }),
      entry('source-full', { group: 'source-story', depth: 'complete' }),
      entry('finished'),
      entry('next-full', { group: 'next-story', depth: 'complete' }),
      entry('next-core', { group: 'next-story' }),
      entry('tail'),
      entry('before'),
    ],
    paths: [
      readingPath('source-is-last', ['next-full', 'source-core']),
      readingPath('onward', ['source-full', 'source-core', 'finished', 'next-full', 'next-core', 'tail']),
      readingPath('another', ['before', 'source-core', 'next-core']),
    ],
  };
  const state = reader('source-full');
  save(state, 'done', 'finished', [2]);
  const { resolver, calls } = harness({
    'next-core.json': { items: [issue(3, { seriesId: 99 })] },
    'tail.json': { items: [issue(4, { seriesId: 99 })] },
    'before.json': { items: [issue(5, { seriesId: 99 })] },
  });
  const before = snapshot(catalog, state);
  const result = await resolve(resolver, catalog, state, {
    isCompleted: (actualState, id) => {
      assert.equal(actualState, state);
      return id === 'done';
    },
  });
  assert.deepEqual(result.suggestions.map((suggestion) => suggestion.catalogId), ['next-core']);
  assert.deepEqual(result.suggestions[0].reasons, [
    {
      type: 'reading-path',
      text: 'Next in onward reading path',
      pathId: 'onward',
      pathName: 'onward reading path',
      position: 3,
      total: 4,
      sourcePosition: 1,
    },
    {
      type: 'reading-path',
      text: 'Next in another reading path',
      pathId: 'another',
      pathName: 'another reading path',
      position: 3,
      total: 3,
      sourcePosition: 2,
    },
  ]);
  assert.equal(result.suggestions[0].storyKey, 'next-story');
  assert.equal(Object.hasOwn(result.suggestions[0], 'savedListId'), false);
  assert.deepEqual(result.failures, []);
  assert.equal(result.cancelled, false);
  assert.ok(calls.includes('next-core.json'));
  assert.ok(!calls.some((file) => /source|finished|next-full/.test(file)));
  assert.equal(snapshot(catalog, state), before);
});

test('Modern Timeline follows its actual grouped order and never invents an off-timeline year cursor', async () => {
  const catalog = {
    lists: [
      entry('source', { type: 'event', timeline: 2020 }),
      entry('spotlight', { timeline: 2019 }),
      entry('too-early', { type: 'event', timeline: 2001 }),
      entry('setup', { type: 'era', timeline: 2020 }),
      entry('next-full', { type: 'event', timeline: 2012, group: 'next', depth: 'complete' }),
      entry('next-core', { type: 'event', timeline: 2012, group: 'next' }),
      entry('later', { type: 'event', timeline: 2021 }),
      entry('split-event', { type: 'event', timeline: 2021, group: 'split' }),
      entry('split-run', { timeline: 2021, group: 'split' }),
    ],
    paths: [],
  };
  const orders = Object.fromEntries(catalog.lists
    .filter((list) => !['next-full', 'split-run'].includes(list.id))
    .map((list, index) => [list.file, { items: [issue(index + 10, { seriesId: 99 })] }]));
  const { resolver } = harness(orders);
  const state = reader();
  const before = snapshot(catalog, state);
  const result = await resolve(resolver, catalog, state);
  assert.deepEqual(result.suggestions.map((suggestion) => suggestion.catalogId), ['next-core']);
  assert.deepEqual(reasonsOf(result, 'modern-timeline'), [{
    type: 'modern-timeline',
    text: 'Next in Modern Timeline',
    position: 2,
    total: 3,
    sourcePosition: 1,
  }]);
  assert.equal(snapshot(catalog, state), before);
  state.read[orders['next-core.json'].items[0].issueId] = 1000;
  const skipped = await resolve(resolver, catalog, state);
  assert.deepEqual(skipped.suggestions.map((suggestion) => suggestion.catalogId), ['later']);
  assert.equal(reasonsOf(skipped, 'modern-timeline')[0].position, 3);
  for (const sourceId of ['spotlight', 'too-early', 'setup', null, 'missing-catalog-entry']) {
    const offTimeline = await resolve(resolver, catalog, reader(sourceId));
    assert.deepEqual(reasonsOf(offTimeline, 'modern-timeline'), [], String(sourceId));
    assert.deepEqual(offTimeline.failures, [], String(sourceId));
    assert.deepEqual(offTimeline.suggestions, [], String(sourceId));
  }
});

test('later-series proof uses exact series IDs and every relevant publication date, with roster-restricted source fallback', async () => {
  const sourceIssues = [
    issue(1, { onSale: '2020-01-01' }),
    issue(2, { onSale: '2020-02-01T00:00:00+00:00' }),
  ];
  const cases = [
    ['later', [
      issue(10, { onSale: '2020-02-02T00:00:00+0000' }),
      issue(11, { onSale: '2020-03-01' }),
      issue(12, { seriesId: 99, onSale: null }),
    ], true],
    ['equal', [issue(10, { onSale: '2020-02-01' })], false],
    ['overlap', [issue(10, { onSale: '2019-12-01' }), issue(11, { onSale: '2021-01-01' })], false],
    ['bad-date', [issue(10, { onSale: '2020-02-30' }), issue(11, { onSale: '2021-01-01' })], false],
    ['year-only', [issue(10, { onSale: '2021' })], false],
    ['availability-only', [issue(10, { onSale: null, mu: '2022-01-01', unlimitedDate: '2023-01-01' })], false],
    ['missing-series', [issue(10, { seriesId: null, onSale: '2021-01-01' })], false],
    ['unknown-extra-series', [issue(10, { onSale: '2021-01-01' }), issue(11, { seriesId: null })], false],
    ['string-series', [issue(10, { seriesId: '42', onSale: '2021-01-01' })], false],
    ['other-series', [issue(10, { seriesId: 99, onSale: '2021-01-01' })], false],
  ];
  for (const [id, items, expected] of cases) {
    const catalog = { lists: [entry('source'), entry(id)], paths: [] };
    const state = reader('source', sourceIssues);
    const { resolver, calls } = harness({ [`${id}.json`]: { items } });
    const before = snapshot(catalog, state);
    const result = await resolve(resolver, catalog, state);
    assert.equal(reasonsOf(result, 'later-series').length, Number(expected), id);
    assert.deepEqual(result.failures, [], id);
    assert.deepEqual(calls, [`${id}.json`]);
    assert.equal(snapshot(catalog, state), before);
    if (expected) {
      assert.deepEqual(reasonsOf(result, 'later-series')[0], {
        type: 'later-series',
        text: 'Later comics in Example series',
        seriesId: 42,
        seriesName: 'Example series',
        sourceEnd: '2020-02-01T00:00:00.000Z',
        candidateStart: '2020-02-02T00:00:00.000Z',
      });
    }
  }
  const catalog = { lists: [entry('source'), entry('later')], paths: [] };
  const state = reader('source', [
    issue(1, { creators: [writer('Saved Writer')] }),
    issue(2, { onSale: '2020-02-01', creators: null }),
  ]);
  const { resolver, calls } = harness({
    'source.json': {
      items: [
        issue(1, { onSale: '2099-01-01', creators: [writer('Replacement Writer')] }),
        issue(2, { onSale: '2020-02-01', creators: [writer('Saved Writer')] }),
        issue(99, { onSale: '2099-12-31', creators: [writer('Outside Writer')] }),
      ],
    },
    'later.json': { items: [issue(10, { onSale: '2021-01-01', creators: [writer('Saved Writer')] })] },
  });
  const before = snapshot(catalog, state);
  const result = await resolve(resolver, catalog, state);
  assert.equal(reasonsOf(result, 'later-series').length, 1);
  assert.deepEqual(reasonsOf(result, 'same-writer').map((reason) => reason.writer), ['Saved Writer']);
  assert.deepEqual(calls, ['source.json', 'later.json']);
  assert.equal(snapshot(catalog, state), before);
  for (const missing of [null, 'not-a-date']) {
    const incomplete = reader('source', [issue(1), issue(2, { onSale: missing, mu: '2020-02-01' })]);
    const loaded = harness({
      'source.json': { items: [issue(1), issue(99, { onSale: '2020-02-01' })] },
      'later.json': { items: [issue(10, { onSale: '2021-01-01' })] },
    });
    assert.deepEqual(reasonsOf(await resolve(loaded.resolver, catalog, incomplete), 'later-series'), []);
    assert.deepEqual(loaded.calls, ['source.json']);
  }
});

test('writer hints require exact writer-role credits and only the two most frequent source writers', async () => {
  const sourceIssues = [1, 2, 3, 4, 5].map((id) => issue(id, {
    creators: [
      ...(id <= 4 ? [writer('Alpha')] : []),
      ...(id <= 3 ? [writer('Beta')] : []),
      ...(id === 5 ? Array.from({ length: 8 }, () => writer('Gamma')) : []),
      writer('Artist', 'penciler'),
    ],
  }));
  const candidates = ['alpha', 'beta', 'third-writer', 'artist-credit', 'fuzzy-name', 'keyword-only'];
  const catalog = {
    lists: [entry('source'), ...candidates.map((id) => entry(id, { keywords: ['Alpha', 'Beta'] }))],
    paths: [],
  };
  const orders = {
    'alpha.json': { items: [issue(10, { seriesId: 99, creators: [writer('Alpha'), writer('Other')] })] },
    'beta.json': { items: [issue(11, { seriesId: 99, creators: [writer('Beta')] })] },
    'third-writer.json': { items: [issue(12, { seriesId: 99, creators: [writer('Gamma')] })] },
    'artist-credit.json': { items: [issue(13, { seriesId: 99, creators: [writer('Alpha', 'penciler'), writer('Artist')] })] },
    'fuzzy-name.json': { items: [issue(14, { seriesId: 99, creators: [writer('alpha'), writer('Alpha Jr.')] })] },
    'keyword-only.json': { items: [issue(15, { seriesId: 99, creators: [writer('Other')] })] },
  };
  const { resolver, calls } = harness(orders);
  const state = reader('source', sourceIssues);
  const before = snapshot(catalog, state);
  const result = await resolve(resolver, catalog, state);
  assert.deepEqual(result.suggestions.map((suggestion) => suggestion.catalogId), ['alpha', 'beta']);
  assert.deepEqual(reasonsOf(result, 'same-writer'), [
    { type: 'same-writer', text: 'Includes comics by Alpha', writer: 'Alpha' },
    { type: 'same-writer', text: 'Includes comics by Beta', writer: 'Beta' },
  ]);
  assert.deepEqual(calls, candidates.map((id) => `${id}.json`));
  assert.deepEqual(result.failures, []);
  assert.equal(snapshot(catalog, state), before);

  const sequence = Array.from({ length: 8 }, (_, index) => entry(`event-${index}`, {
    type: 'event',
    timeline: 2011 + index,
  }));
  const rankedCatalog = {
    lists: [
      entry('source', { type: 'event', timeline: 2010 }),
      ...sequence,
      entry('outside-author', { keywords: ['Alpha'] }),
    ],
    paths: [readingPath('long-path', ['source', ...sequence.map((list) => list.id)])],
  };
  const ranked = harness({
    ...Object.fromEntries(sequence.map((list, index) => [
      list.file,
      { items: [issue(index + 100, { seriesId: 99 })] },
    ])),
    'outside-author.json': { items: [issue(200, { seriesId: 99, creators: [writer('Alpha')] })] },
  });
  const rankedBefore = snapshot(rankedCatalog, state);
  const rankedResult = await resolve(ranked.resolver, rankedCatalog, state);
  assert.deepEqual(ranked.calls.slice(0, 2), ['event-0.json', 'outside-author.json']);
  assert.equal(ranked.calls.length, 6);
  assert.deepEqual(rankedResult.suggestions.map((suggestion) => suggestion.catalogId), ['event-0', 'outside-author']);
  assert.equal(snapshot(rankedCatalog, state), rankedBefore);
});

test('saved active variants win while completed, all-read, removed, and overlapping all-read orders are excluded', async () => {
  const catalog = {
    lists: [
      entry('source'),
      entry('completed-core', { group: 'completed' }),
      entry('completed-full', { group: 'completed', depth: 'complete' }),
      entry('read-core', { group: 'read-story' }),
      entry('read-full', { group: 'read-story', depth: 'complete' }),
      entry('removed'),
      entry('overlapping'),
      entry('partly-unread'),
      entry('active-core', { group: 'active-story' }),
      entry('active-full', { group: 'active-story', depth: 'complete' }),
    ],
    paths: [
      readingPath('progress', ['source', 'completed-core', 'read-full', 'removed', 'overlapping', 'partly-unread']),
      readingPath('saved', ['source', 'active-core']),
    ],
  };
  const state = reader();
  save(state, 'completed-save', 'completed-full', [10]);
  save(state, 'read-save', 'read-core', [11]);
  save(state, 'active-save', 'active-full', [20, 21]);
  save(state, 'overlap-save', null, [14, 15]);
  for (const id of [11, 12, 13, 14, 15, 16, 20]) state.read[id] = 1000;
  state.issues[20] = issue(20, { seriesId: 99 });
  state.issues[21] = issue(21, { seriesId: 99 });
  const { resolver, calls } = harness({
    'removed.json': { items: [issue(12), issue(13)] },
    'overlapping.json': { items: [issue(14), issue(15)] },
    'partly-unread.json': { items: [issue(16, { seriesId: 99 }), issue(17, { seriesId: 99 })] },
    'active-full.json': { items: [issue(20, { seriesId: 99 }), issue(21, { seriesId: 99 })] },
  });
  const before = snapshot(catalog, state);
  const result = await resolve(resolver, catalog, state, {
    isCompleted: (actualState, id) => {
      assert.equal(actualState, state);
      return id === 'completed-save';
    },
  });
  assert.deepEqual(new Set(result.suggestions.map((suggestion) => suggestion.catalogId)),
    new Set(['partly-unread', 'active-full']));
  assert.equal(result.suggestions.find((suggestion) => suggestion.catalogId === 'active-full').savedListId, 'active-save');
  assert.equal(result.suggestions.find((suggestion) => suggestion.catalogId === 'partly-unread')
    .reasons[0].pathId, 'progress');
  assert.equal(calls.length, 4);
  assert.ok(calls.includes('removed.json') && calls.includes('overlapping.json'));
  assert.ok(!calls.some((file) => /completed|read-core|read-full|active-core/.test(file)));
  assert.equal(snapshot(catalog, state), before);

  for (const order of [{ items: [] }, {}, { items: [issue(12), null] }, { items: [{ issueId: '12' }] }]) {
    const unknownCatalog = {
      lists: [entry('source'), entry('unknown-roster')],
      paths: [readingPath('unknown', ['source', 'unknown-roster'])],
    };
    const unknownState = reader();
    save(unknownState, 'empty-save', 'unknown-roster', []);
    unknownState.read[12] = 1000;
    const unknown = harness({ 'unknown-roster.json': order });
    const unchanged = snapshot(unknownCatalog, unknownState);
    const answer = await resolve(unknown.resolver, unknownCatalog, unknownState);
    assert.deepEqual(answer.suggestions.map((suggestion) => suggestion.catalogId), ['unknown-roster']);
    assert.equal(answer.suggestions[0].savedListId, 'empty-save');
    assert.equal(answer.failures.length, Array.isArray(order.items) && !order.items.length ? 0 : 1);
    assert.equal(snapshot(unknownCatalog, unknownState), unchanged);
  }
});

test('work stays within six cards and seven existing safe metadata files without guessing filenames', async () => {
  const source = entry('not-the-source-filename', { file: 'source_snapshot.json' });
  const candidates = Array.from({ length: 20 }, (_, index) => entry(`catalog-${index}`, {
    file: `bounded_${index}.json`,
    keywords: ['Verified Writer'],
  }));
  const catalog = { lists: [source, ...candidates], paths: [] };
  const state = reader(source.id, [issue(1, { creators: null, seriesId: null, onSale: null })]);
  const orders = {
    'source_snapshot.json': { items: [issue(1, { creators: [writer('Verified Writer')] })] },
    ...Object.fromEntries(candidates.map((candidate, index) => [
      candidate.file,
      { items: [issue(index + 10, { onSale: '2021-01-01', creators: [writer('Verified Writer')] })] },
    ])),
  };
  const { resolver, calls } = harness(orders);
  const before = snapshot(catalog, state);
  const result = await resolve(resolver, catalog, state);
  assert.equal(result.suggestions.length, 6);
  assert.equal(calls.length, 7);
  assert.deepEqual(calls, ['source_snapshot.json', ...candidates.slice(0, 6).map((candidate) => candidate.file)]);
  assert.deepEqual(result.suggestions.map((suggestion) => suggestion.catalogId), candidates.slice(0, 6).map((candidate) => candidate.id));
  assert.equal(snapshot(catalog, state), before);
  for (const file of ['../outside.json', 'nested\\order.json', 'https://example.test/order.json', '.hidden.json', 'bad%2Fname.json', null]) {
    const unsafeCatalog = {
      lists: [entry('source', { file }), entry('safe', { file: 'the_actual_file.json' })],
      paths: [readingPath('safe-path', ['source', 'safe'])],
    };
    const unsafeState = reader('source', [issue(1, { creators: null })]);
    const checked = harness({ 'the_actual_file.json': { items: [issue(10, { seriesId: 99 })] } });
    const answer = await resolve(checked.resolver, unsafeCatalog, unsafeState);
    assert.deepEqual(checked.calls, ['the_actual_file.json']);
    assert.deepEqual(answer.failures.map((failure) => [failure.stage, failure.code, failure.file]),
      [['source', 'invalid-file', null]]);
    assert.equal(answer.suggestions[0].catalogId, 'safe');
    const unsafeCandidate = {
      lists: [entry('source'), entry('bad', { file }), entry('good', { file: 'the_actual_file.json' })],
      paths: [readingPath('bad-path', ['source', 'bad']), readingPath('good-path', ['source', 'good'])],
    };
    const bounded = harness({ 'the_actual_file.json': { items: [issue(10, { seriesId: 99 })] } });
    const candidateAnswer = await resolve(bounded.resolver, unsafeCandidate, reader());
    assert.deepEqual(bounded.calls, ['the_actual_file.json']);
    assert.equal(candidateAnswer.failures[0].code, 'invalid-file');
    assert.equal(candidateAnswer.failures[0].stage, 'candidate');
  }
});

test('request and parse failures remain visible without discarding independent proofs and can be retried', async () => {
  const ids = ['path-request', 'path-parse', 'path-shape', 'writer-good', 'optional-fault', 'missing-evidence'];
  const catalog = {
    lists: [entry('source'), ...ids.map((id) => entry(id, { keywords: ['Alpha'] }))],
    paths: ids.slice(0, 3).map((id) => readingPath(id, ['source', id])),
  };
  const state = reader('source', [issue(1, { creators: [writer('Alpha')], seriesId: null })]);
  const orders = {
    'source.json': new Error('HTTP 500'),
    'path-request.json': new Error('Offline'),
    'path-parse.json': new SyntaxError('Invalid JSON'),
    'path-shape.json': { issues: [issue(10)] },
    'writer-good.json': { items: [issue(11, { seriesId: 99, creators: [writer('Alpha')] })] },
    'optional-fault.json': new Error('HTTP 404'),
    'missing-evidence.json': { items: [issue(12, { seriesId: null, onSale: null, creators: null })] },
  };
  const { resolver, calls } = harness(orders);
  const before = snapshot(catalog, state);
  const result = await resolve(resolver, catalog, state);
  assert.deepEqual(result.suggestions.map((suggestion) => suggestion.catalogId), ids.slice(0, 4));
  assert.equal(reasonsOf(result, 'reading-path').length, 3);
  assert.deepEqual(reasonsOf(result, 'same-writer'), [{ type: 'same-writer', text: 'Includes comics by Alpha', writer: 'Alpha' }]);
  assert.deepEqual(result.failures.map((failure) => [failure.stage, failure.catalogId, failure.file, failure.code]), [
    ['source', 'source', 'source.json', 'request-failed'],
    ['candidate', 'path-request', 'path-request.json', 'request-failed'],
    ['candidate', 'path-parse', 'path-parse.json', 'parse-failed'],
    ['candidate', 'path-shape', 'path-shape.json', 'parse-failed'],
    ['candidate', 'optional-fault', 'optional-fault.json', 'request-failed'],
  ]);
  assert.ok(result.failures.every((failure) => typeof failure.message === 'string' && failure.message.length > 0));
  assert.match(result.failures[0].message, /HTTP 500/);
  assert.equal(result.cancelled, false);
  assert.equal(calls.length, 7);
  assert.equal(snapshot(catalog, state), before);
  for (const file of ['source.json', 'path-request.json', 'path-parse.json', 'path-shape.json', 'optional-fault.json']) {
    orders[file] = { items: [issue(20, { seriesId: 99, creators: [writer('Alpha')] })] };
  }
  const retried = await resolve(resolver, catalog, state);
  assert.deepEqual(retried.failures, []);
  assert.equal(calls.length, 12);
  assert.equal(calls.filter((file) => file === 'writer-good.json').length, 1);
  assert.equal(calls.filter((file) => file === 'missing-evidence.json').length, 1);
  assert.throws(() => createListRecommendationResolver(), TypeError);
  const missingSource = await resolve(resolver, catalog, state, { sourceListId: 'removed-source' });
  assert.equal(missingSource.failures[0].code, 'source-not-found');
});

test('cancellation isolates shared pending loads, rejects stale cache fills, and bounds reusable metadata', async () => {
  const state = reader();
  state.read[1] = 1000;
  const catalogFor = (id, file = `${id}.json`) => ({
    lists: [entry('source'), entry(id, { file })],
    paths: [readingPath('next', ['source', id])],
  });
  const loads = [];
  const resolver = createListRecommendationResolver({
    loadBundledOrder: (file, { signal }) => new Promise((fulfill, reject) => {
      assert.ok(signal instanceof AbortSignal);
      loads.push({ file, signal, fulfill, reject });
    }),
  });
  const catalog = catalogFor('next');
  const before = snapshot(catalog, state);
  const oldController = new AbortController();
  const freshController = new AbortController();
  const old = resolve(resolver, catalog, state, { signal: oldController.signal });
  const fresh = resolve(resolver, catalog, state, { signal: freshController.signal });
  await tick();
  assert.equal(loads.length, 1);
  oldController.abort();
  assert.deepEqual(await old, { suggestions: [], failures: [], cancelled: true });
  assert.equal(loads[0].signal.aborted, false);
  loads[0].fulfill({ items: [issue(10, { seriesId: 99 })] });
  const answer = await fresh;
  assert.equal(answer.cancelled, false);
  assert.deepEqual(answer.failures, []);
  assert.equal(answer.suggestions[0].catalogId, 'next');
  assert.equal(snapshot(catalog, state), before);
  assert.equal((await resolve(resolver, catalog, state)).suggestions.length, 1);
  assert.equal(loads.length, 1);
  const preAborted = new AbortController();
  preAborted.abort();
  assert.deepEqual(await resolve(resolver, catalog, state, { signal: preAborted.signal }),
    { suggestions: [], failures: [], cancelled: true });
  assert.equal(loads.length, 1);

  const abandonedController = new AbortController();
  const otherCatalog = catalogFor('other');
  const abandoned = resolve(resolver, otherCatalog, state, { signal: abandonedController.signal });
  await tick();
  abandonedController.abort();
  const replacement = resolve(resolver, otherCatalog, state);
  assert.deepEqual(await abandoned, { suggestions: [], failures: [], cancelled: true });
  await tick();
  assert.equal(loads.length, 3);
  assert.equal(loads[1].signal.aborted, true);
  assert.notEqual(loads[1].signal, loads[2].signal);
  loads[2].fulfill({ items: [issue(11, { seriesId: 99 })] });
  assert.equal((await replacement).suggestions[0].catalogId, 'other');
  loads[1].fulfill({ items: [issue(1)] });
  await tick();
  assert.equal((await resolve(resolver, otherCatalog, state)).suggestions[0].catalogId, 'other');
  assert.equal(loads.length, 3);

  const doubleCatalog = {
    lists: [entry('source'), entry('one', { file: 'shared.json' }), entry('two', { file: 'shared.json' })],
    paths: [readingPath('one-path', ['source', 'one']), readingPath('two-path', ['source', 'two'])],
  };
  const double = resolve(resolver, doubleCatalog, state);
  await tick();
  assert.equal(loads.length, 4);
  loads[3].fulfill({ items: [issue(12, { seriesId: 99 })] });
  assert.equal((await double).suggestions.length, 2);

  const abortedLoad = resolve(resolver, catalogFor('loader-aborted'), state);
  await tick();
  const abort = new Error('Transport aborted.');
  abort.name = 'AbortError';
  loads[4].reject(abort);
  assert.deepEqual(await abortedLoad, { suggestions: [], failures: [], cancelled: true });

  const calls = [];
  const bounded = createListRecommendationResolver({
    loadBundledOrder: async (file) => {
      calls.push(file);
      return {
        items: file === 'large.json'
          ? Array.from({ length: 4097 }, (_, index) => issue(index + 100, { seriesId: 99 }))
          : [issue(10, { seriesId: 99 })],
      };
    },
  });
  for (let index = 0; index < 13; index += 1) {
    assert.equal((await resolve(bounded, catalogFor(`cached-${index}`), state)).suggestions.length, 1);
  }
  assert.equal(calls.length, 13);
  await resolve(bounded, catalogFor('cached-12'), state);
  assert.equal(calls.length, 13);
  await resolve(bounded, catalogFor('cached-0'), state);
  assert.equal(calls.length, 14);
  await resolve(bounded, catalogFor('large'), state);
  await resolve(bounded, catalogFor('large'), state);
  assert.equal(calls.filter((file) => file === 'large.json').length, 2);
});
