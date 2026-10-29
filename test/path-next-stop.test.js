import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEmptyState } from '../src/js/lib/model.js';
import { defaultPath, groupCatalog, parseCatalog, resolveReadingPaths } from '../src/js/lib/catalog.js';
import { createListRecommendationResolver } from '../src/js/lib/listRecommendations.js';

// #897 item 2. When a Reading List that is a stop on a path is finished, its wrap-up offers that
// path's next stop. The owner's decision, through the coordinating session on 2026-10-26, is that
// the wrap-up's existing "Next in <path>" suggestion is that offer, so these hold it to each point
// of the Issue's acceptance on every stop of the bundled paths, with the shipped catalog: it
// appears only for path stops, names the right next stop, offers Preview or Open, and is absent
// after a path's last stop.

const catalog = parseCatalog(JSON.parse(readFileSync(new URL('../src/data/catalog.json', import.meta.url), 'utf8')));
const paths = resolveReadingPaths(catalog.paths, catalog.lists);
const stories = groupCatalog(catalog.lists);

const issue = (issueId, seriesId) => ({
  issueId, seriesId, seriesName: `Series ${seriesId}`, onSale: '2020-01-01T00:00:00+0000', creators: [],
});

// The finished list, saved from one catalog reading with an issue of its own, so the resolver needs
// no file for it.
function finished(catalogId) {
  const state = createEmptyState();
  state.issues[1] = issue(1, 1);
  state.lists.source = { id: 'source', name: 'Finished', catalogId, created: 1, itemIds: [1], deferredIssueIds: [] };
  state.listOrder = ['source'];
  state.active = 'source';
  state.read[1] = 2;
  return state;
}

// Each candidate's issue list is one unread issue in a series of its own, so a candidate is kept
// and no writer or series hint adds a reason beside the path's.
function resolver() {
  let next = 9_000_000;
  const orders = new Map();
  return createListRecommendationResolver({
    loadBundledOrder: async (file) => {
      if (!orders.has(file)) {
        next += 1;
        orders.set(file, { items: [issue(next, next)] });
      }
      return orders.get(file);
    },
  });
}

const onPath = (result) => result.suggestions
  .filter((suggestion) => suggestion.reasons.some((reason) => reason.type === 'reading-path'));

test('the four bundled paths are the ones these checks walk', () => {
  assert.deepEqual(paths.map((path) => [path.id, path.stops.length]), [
    ['modern-avengers', 10], ['x-men-messiah-to-avx', 12], ['professor-x-and-the-x-men', 4],
    ['marvel-knights-to-planet-x', 78],
  ]);
});

for (const path of paths) {
  test(`finishing each stop of ${path.name} offers its next stop first, and nothing after the last`, async () => {
    const r = resolver();
    for (const [index, stop] of path.stops.entries()) {
      const result = await r.resolve({
        catalog, state: finished(stop.stepId), sourceListId: 'source', isCompleted: (_state, id) => id === 'source',
      });
      const offers = onPath(result);
      if (index === path.stops.length - 1) {
        assert.deepEqual(offers, [], `${path.id} stop ${index + 1} is the last, so nothing follows it`);
        continue;
      }
      const next = path.stops[index + 1];
      assert.equal(offers.length, 1, `${path.id} stop ${index + 1} offers one next stop`);
      assert.equal(result.suggestions[0], offers[0], `${path.id} stop ${index + 1}: the path's next stop leads`);
      assert.equal(offers[0].storyKey, next.key, `${path.id} stop ${index + 1} names stop ${index + 2}`);
      assert.deepEqual(offers[0].reasons.find((reason) => reason.type === 'reading-path'), {
        type: 'reading-path',
        text: `Next in ${path.name}`,
        pathId: path.id,
        pathName: path.name,
        position: index + 2,
        total: path.stops.length,
        sourcePosition: index + 1,
      });
      assert.equal(Object.hasOwn(offers[0], 'savedListId'), false, 'nothing is saved, so it is previewed');
    }
  });
}

test('a finished list on no path is offered no path stop', async () => {
  const onAnyPath = new Set(paths.flatMap((path) => path.stops.map((stop) => stop.key)));
  const off = stories.filter((story) => !onAnyPath.has(story.key));
  const samples = [
    off.find((story) => story.lists.some((list) => list.type === 'event')),
    off.find((story) => story.lists.some((list) => list.audience === 'young-readers')),
    off.find((story) => story.lists.some((list) => list.type === 'character-run' && !list.audience)),
  ];
  assert.ok(samples.every(Boolean), 'the catalog has stories off every path to try');
  const r = resolver();
  for (const story of samples) {
    const result = await r.resolve({
      catalog, state: finished(story.lists[0].id), sourceListId: 'source', isCompleted: (_state, id) => id === 'source',
    });
    assert.deepEqual(onPath(result), [], `${story.key} is on no path`);
  }
});

test('a next stop already saved is offered to open, and a finished next stop is passed over', async () => {
  const path = paths.find(({ id }) => id === 'modern-avengers');
  const [, source, next, after] = path.stops;
  const reading = defaultPath(stories.find((story) => story.key === next.key));
  const r = resolver();

  const saved = finished(source.stepId);
  saved.issues[2] = issue(2, 2);
  saved.lists.next = { id: 'next', name: 'Saved next stop', catalogId: reading.id, created: 2, itemIds: [2], deferredIssueIds: [] };
  saved.listOrder.push('next');
  const open = onPath(await r.resolve({ catalog, state: saved, sourceListId: 'source', isCompleted: (_state, id) => id === 'source' }));
  assert.equal(open[0].storyKey, next.key);
  assert.equal(open[0].savedListId, 'next', 'a saved next stop is opened rather than previewed');

  saved.read[2] = 3;
  const passed = onPath(await r.resolve({ catalog, state: saved, sourceListId: 'source', isCompleted: (_state, id) => id === 'source' }));
  assert.equal(passed[0].storyKey, after.key, 'a next stop already read is passed over for the one after it');
  assert.equal(passed[0].reasons.find((reason) => reason.type === 'reading-path').position, 4);
});
