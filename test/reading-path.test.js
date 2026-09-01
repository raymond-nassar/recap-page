import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseManifest } from '../src/js/lib/curated.js';
import { parseCatalog, pathPlacements, resolveReadingPaths, timelineLabel, storyKey } from '../src/js/lib/catalog.js';

// A minimal valid entry, kept deliberately small: these tests are about the path section, and an
// entry that carries every optional field would make a failure here read as an entry problem.
const entry = (id, extra = {}) => ({
  id,
  name: id,
  description: `${id} description`,
  type: 'event',
  depth: 'essential',
  sourceUrl: `https://example.test/${id}.md`,
  sourceOrigin: 'Vendored from example.test',
  out: `${id}.json`,
  ...extra,
});

const path = (extra = {}) => ({
  id: 'spine',
  name: 'The Spine',
  description: 'One thing after another.',
  sourceOrigin: 'Compiled for this project.',
  steps: ['one', 'two', 'three'],
  ...extra,
});

const lists = [entry('one'), entry('two'), entry('three')];

// A catalog entry as `parseCatalog` would hand it on. Only the fields the resolver reads.
const shelf = (id, extra = {}) => ({
  id,
  file: `${id}.json`,
  name: id,
  description: `${id} description`,
  type: 'event',
  depth: 'essential',
  count: 5,
  ...extra,
});

// ------------------------------------------------------------------ manifest validation

test('a manifest with no paths section parses exactly as it did before', async () => {
  const { entries, paths, errors } = parseManifest({ lists });
  assert.deepEqual(errors, []);
  assert.equal(entries.length, 3);
  assert.deepEqual(paths, []);
});

test('a complete path is accepted and its steps are kept in order', () => {
  const { paths, errors } = parseManifest({ lists, paths: [path()] });
  assert.deepEqual(errors, []);
  assert.equal(paths.length, 1);
  assert.deepEqual(paths[0].steps, ['one', 'two', 'three']);
  assert.equal(paths[0].name, 'The Spine');
});

test('a step naming an order the manifest does not provide is a fatal error', () => {
  const { paths, errors } = parseManifest({ lists, paths: [path({ steps: ['one', 'nope'] })] });
  assert.equal(paths.length, 0);
  assert.match(errors.join('\n'), /step 1 names "nope", which is not a list in this manifest/);
});

// Two readings of one story are one stop, not two. `civil-war` and `civil-war-avengers` are
// separate ids in the same group in the shipped manifest, so this is a mistake in reach.
test('two steps in the same story are refused', () => {
  const grouped = [
    entry('civil-war', { group: 'civil-war', groupName: 'Civil War', variant: 'Main' }),
    entry('civil-war-avengers', { group: 'civil-war', groupName: 'Civil War', variant: 'Avengers' }),
    entry('after'),
  ];
  const { paths, errors } = parseManifest({
    lists: grouped,
    paths: [path({ steps: ['civil-war', 'civil-war-avengers', 'after'] })],
  });
  assert.equal(paths.length, 0);
  assert.match(errors.join('\n'), /step 1 names "civil-war-avengers", which is the same story as step 0/);
});

test('a path with fewer than two steps is refused, because one stop is not a sequence', () => {
  const { errors } = parseManifest({ lists, paths: [path({ steps: ['one'] })] });
  assert.match(errors.join('\n'), /at least two steps/);
});

test('a path with no sourceOrigin is refused, because the chain is this project\u2019s own claim', () => {
  const { paths, errors } = parseManifest({ lists, paths: [path({ sourceOrigin: undefined })] });
  assert.equal(paths.length, 0);
  assert.match(errors.join('\n'), /has no sourceOrigin/);
});

test('a path missing a name or a description is refused', () => {
  assert.match(parseManifest({ lists, paths: [path({ name: '  ' })] }).errors.join('\n'), /has no name/);
  assert.match(parseManifest({ lists, paths: [path({ description: null })] }).errors.join('\n'), /has no description/);
});

test('a malformed path is refused rather than half-read', () => {
  assert.match(parseManifest({ lists, paths: ['nope'] }).errors.join('\n'), /path 0: is not an object/);
  assert.match(parseManifest({ lists, paths: [path({ steps: 'one,two' })] }).errors.join('\n'), /has no steps array/);
  assert.match(parseManifest({ lists, paths: [path({ steps: ['one', ''] })] }).errors.join('\n'), /not a non-empty string/);
  assert.match(parseManifest({ lists, paths: 'nope' }).errors.join('\n'), /"paths" is not an array/);
});

test('two paths cannot share an id', () => {
  const { paths, errors } = parseManifest({ lists, paths: [path(), path({ name: 'Another' })] });
  assert.equal(paths.length, 1);
  assert.match(errors.join('\n'), /duplicate id "spine"/);
});

// ------------------------------------------------------------------ placement

const threeStops = [path()];

test('placement gives each stop its position, its total and its neighbours', () => {
  const placed = pathPlacements(threeStops, [shelf('one'), shelf('two'), shelf('three')]);
  assert.equal(placed.size, 3);
  const second = placed.get('list:two');
  assert.equal(second.position, 2);
  assert.equal(second.total, 3);
  assert.equal(second.previous.name, 'one');
  assert.equal(second.next.name, 'three');
  assert.equal(second.pathName, 'The Spine');
});

test('the first stop has nothing before it and the last has nothing after it', () => {
  const placed = pathPlacements(threeStops, [shelf('one'), shelf('two'), shelf('three')]);
  assert.equal(placed.get('list:one').previous, null);
  assert.equal(placed.get('list:one').next.name, 'two');
  assert.equal(placed.get('list:three').next, null);
  assert.equal(placed.get('list:three').previous.name, 'two');
});

test('a story on no path has no placement', () => {
  const placed = pathPlacements(threeStops, [shelf('one'), shelf('two'), shelf('three'), shelf('elsewhere')]);
  assert.equal(placed.get('list:elsewhere'), undefined);
});

// `parseCatalog` drops entries it cannot use, so a path that was valid when the manifest was
// written can arrive here with a hole in it. Numbering over what survived is the difference
// between a shelf a reader can count and a total the app cannot account for.
test('a stop whose order was dropped is skipped and the rest are renumbered', () => {
  const placed = pathPlacements(threeStops, [shelf('one'), shelf('three')]);
  assert.equal(placed.size, 2);
  assert.equal(placed.get('list:one').total, 2);
  assert.equal(placed.get('list:one').next.name, 'three');
  assert.equal(placed.get('list:three').position, 2);
  assert.equal(placed.get('list:two'), undefined);
});

test('a path left with fewer than two resolvable stops places nothing', () => {
  assert.equal(pathPlacements(threeStops, [shelf('two')]).size, 0);
});

// The step names one reading, but the shelf shows one row per story, so the stop has to be named
// the way the row is named or the path would point at a row that is not on screen.
test('a grouped stop is named by its story, not by the reading the step named', () => {
  const placed = pathPlacements(
    [path({ steps: ['one', 'cw-avengers'] })],
    [
      shelf('one'),
      shelf('cw-main', { group: 'civil-war', groupName: 'Civil War' }),
      shelf('cw-avengers', { group: 'civil-war', groupName: 'Civil War' }),
    ],
  );
  assert.equal(placed.get('civil-war').position, 2);
  assert.equal(placed.get('list:one').next.name, 'Civil War');
  // Keyed on the story, so both readings of it resolve to the same placement. This is what makes
  // the row safe to compute once, outside its repaint.
  assert.equal(storyKey(shelf('cw-main', { group: 'civil-war' })), 'civil-war');
  assert.equal(storyKey(shelf('cw-avengers', { group: 'civil-war' })), 'civil-war');
});

test('placement tolerates a missing or malformed paths section', () => {
  assert.equal(pathPlacements(undefined, [shelf('one')]).size, 0);
  assert.equal(pathPlacements([], [shelf('one')]).size, 0);
  assert.equal(pathPlacements([{ id: 'x' }], [shelf('one')]).size, 0);
  assert.equal(pathPlacements(threeStops, []).size, 0);
});

// ------------------------------------------------------------------ the start year

test('the start year is a phrase, and an order that ranges across the timeline has none', () => {
  assert.equal(timelineLabel({ timeline: 2005 }), 'Starts 2005');
  assert.equal(timelineLabel({ timeline: null }), null);
  assert.equal(timelineLabel({}), null);
});

// ------------------------------------------------------------------ the shipped data

test('manifest and generated paths resolve end to end', async () => {
  const manifest = JSON.parse(await readFile(new URL('../src/data/curated-lists.json', import.meta.url), 'utf8'));
  const { paths, errors } = parseManifest(manifest);
  assert.deepEqual(errors, []);
  assert.equal(paths.length, 2);

  const catalogRaw = JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8'));
  const catalog = parseCatalog(catalogRaw);
  assert.equal(catalog.dropped, 0);
  assert.equal(catalog.paths.length, 3);
  const generated = catalog.paths.find((readingPath) => readingPath.id === 'marvel-knights-to-planet-x');
  assert.equal(generated.steps.length, 78);
  const placed = pathPlacements(catalog.paths, catalog.lists);

  // Every step resolves, so the rendered total is the declared one. A step that stopped resolving
  // would renumber the path silently, which is exactly the drift this asserts against.
  const expectedTotal = catalog.paths.reduce((total, readingPath) => total + readingPath.steps.length, 0);
  assert.equal(placed.size, expectedTotal);
  for (const readingPath of catalog.paths) {
    const pathPlacementsForPath = [...placed.values()].filter((placement) => placement.pathId === readingPath.id);
    assert.equal(pathPlacementsForPath.length, readingPath.steps.length);
    assert.ok(pathPlacementsForPath.every((placement) => placement.total === readingPath.steps.length));
    assert.equal(pathPlacementsForPath.filter((p) => p.previous === null).length, 1);
    assert.equal(pathPlacementsForPath.filter((p) => p.next === null).length, 1);
  }
});

// The chain is only honest if a reader who works through it is never sent the same issue twice,
// and that has to hold for every depth they might pick at each stop, not just the readings the
// steps happen to name.
test('no two stops on a shipped path share an issue, at any reading depth', async () => {
  const catalog = parseCatalog(JSON.parse(await readFile(new URL('../src/data/catalog.json', import.meta.url), 'utf8')));
  const listsById = new Map(catalog.lists.map((list) => [list.id, list]));
  const issues = new Map();
  let pairs = 0;

  for (const readingPath of catalog.paths) {
    const byStory = new Map();
    for (const step of readingPath.steps) {
      const list = listsById.get(step);
      const key = storyKey(list);
      if (!byStory.has(key)) byStory.set(key, []);
      byStory.get(key).push(list);
    }

    for (const group of byStory.values()) {
      for (const list of group) {
        if (!issues.has(list.id)) {
          const file = JSON.parse(await readFile(new URL(`../src/data/${list.file}`, import.meta.url), 'utf8'));
          issues.set(list.id, new Set((file.items ?? []).map((i) => i.issueId)));
        }
      }
    }

    const stories = [...byStory.values()];
    for (let a = 0; a < stories.length; a += 1) {
      for (let b = a + 1; b < stories.length; b += 1) {
        for (const x of stories[a]) {
          for (const y of stories[b]) {
            pairs += 1;
            const shared = [...issues.get(x.id)].filter((id) => issues.get(y.id).has(id));
            assert.deepEqual(shared, [], `${readingPath.id}: ${x.id} and ${y.id} share ${shared.length} issues`);
          }
        }
      }
    }
  }
  assert.equal(pairs, 3114);
});

test('aggregate paths retain shared stories independently with catalog-ordered siblings', () => {
  const catalogLists = [
    shelf('one', { timeline: 2001 }),
    shelf('shared-main', { group: 'shared', groupName: 'Shared', timeline: 2002 }),
    shelf('shared-exact', { group: 'shared', groupName: 'Shared', timeline: 2002 }),
    shelf('other', { timeline: 2003 }),
  ];
  const resolved = resolveReadingPaths([
    path({ id: 'alpha', name: 'Alpha', steps: ['one', 'shared-exact'] }),
    path({ id: 'beta', name: 'Beta', steps: ['shared-main', 'other'] }),
  ], catalogLists);

  assert.deepEqual(resolved.map(({ id }) => id), ['alpha', 'beta']);
  assert.equal(resolved[0].stops[1].position, 2);
  assert.equal(resolved[1].stops[0].position, 1);
  assert.equal(resolved[0].stops[1].stepId, 'shared-exact');
  assert.deepEqual(resolved[0].stops[1].lists.map(({ id }) => id), ['shared-main', 'shared-exact']);
  assert.equal(resolved[0].stops[1].previous.name, 'one');
  assert.equal(resolved[1].stops[0].next.name, 'other');
});

test('aggregate progress prefers the exact import, then catalog-order sibling, then nothing', async () => {
  const { readingPathProgress } = await import('../src/js/views/reading-paths.js');
  const stop = resolveReadingPaths(
    [path({ steps: ['one', 'shared-exact'] })],
    [
      shelf('one'),
      shelf('shared-main', { group: 'shared', groupName: 'Shared' }),
      shelf('shared-exact', { group: 'shared', groupName: 'Shared' }),
    ],
  )[0].stops[1];
  const imported = (id, catalogId, itemIds) => ({
    id, name: id, catalogId, itemIds, collectedIn: {},
  });
  const state = {
    lists: {
      sibling: imported('sibling', 'shared-main', [1, 2, 3]),
      exact: imported('exact', 'shared-exact', [4, 5]),
    },
    listOrder: ['sibling', 'exact'],
    read: { 1: 1, 2: 1, 3: 1 },
  };

  assert.deepEqual(readingPathProgress(state, stop), {
    listId: 'exact',
    catalogId: 'shared-exact',
    name: 'exact',
    read: 0,
    total: 2,
    state: 'unstarted',
    match: 'exact',
  });
  const siblingOnly = { ...state, lists: { sibling: state.lists.sibling }, listOrder: ['sibling'] };
  assert.equal(readingPathProgress(siblingOnly, stop).catalogId, 'shared-main');
  assert.equal(readingPathProgress(siblingOnly, stop).read, 3);
  assert.equal(readingPathProgress({ ...state, lists: {}, listOrder: [] }, stop), null);
});

test('aggregate paths reject duplicate identities and sequences with fewer than two surviving stops', () => {
  const catalogLists = [shelf('one'), shelf('two')];
  const resolved = resolveReadingPaths([
    path({ id: 'kept', steps: ['one', 'missing', 'two'] }),
    path({ id: 'kept', name: 'Duplicate' }),
    path({ id: 'short', steps: ['missing', 'one'] }),
    path({ id: 'uncredited', sourceOrigin: '' }),
  ], catalogLists);
  assert.deepEqual(resolved.map(({ id }) => id), ['kept']);
  assert.deepEqual(resolved[0].stops.map(({ stepId }) => stepId), ['one', 'two']);
});
