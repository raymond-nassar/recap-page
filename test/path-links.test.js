// UX-11 (#830): a catalog card no longer shows the reading path a story is on. Its "Start" or "Step"
// disclosure was a third keyboard stop on about a hundred cards, and since #897 paths are followed
// on Modern Timeline, where every stop is numbered in the path's own order. The two links this file
// used to hold to account went with it, so it now holds the card to what replaced them: no path
// line and no link but the source credit, and every bundled path still reachable at its address.
//
// Exercised rather than scanned, as before: these build the shipped catalog's cards and read what
// was built.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  catalogEntries, parseCatalog, pathPlacements, resolveReadingPaths, shelfKey, sourceLink,
} from '../src/js/lib/catalog.js';
import { formatRoute, parseRoute } from '../src/js/lib/route.js';
import { createCatalogPresentation } from '../src/js/views/shared/catalog-presentation.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = parseCatalog(JSON.parse(readFileSync(join(ROOT, 'src', 'data', 'catalog.json'), 'utf8')));

function el(tag, props = {}, children = []) {
  return { tag, children: [].concat(children), ...props };
}
const descendants = (node) => (typeof node === 'object' && node !== null
  ? [node, ...node.children.flatMap(descendants)] : []);
const text = (node) => (typeof node === 'string' ? node
  : node?.text ?? node?.children.map(text).join('') ?? '');

const presentation = createCatalogPresentation({
  el,
  hueOf: () => 0,
  isInLibrary: () => false,
  paintCoverUrl: () => {},
  shortTitle: (title) => title,
});

const placements = pathPlacements(catalog.paths, catalog.lists);
const stops = catalogEntries(catalog.lists).filter((story) => placements.has(story.groupKey));

test('no path stop\'s card draws a path line or links anywhere but its source', () => {
  // The count this decision was made on: 98 cards on Modern Timeline, 7 on Storylines and 1 on
  // Character spotlights.
  const byShelf = {};
  for (const story of stops) byShelf[shelfKey(story)] = (byShelf[shelfKey(story)] ?? 0) + 1;
  assert.deepEqual(byShelf, { catalog: 98, lines: 7, spotlights: 1 });

  for (const story of stops) {
    const card = presentation.catalogCard(story, { surface: shelfKey(story) });
    const nodes = descendants(card);
    const name = story.lists[0].name;
    assert.equal(nodes.some((node) => node.tag === 'details'), false, `${name} carries a disclosure`);
    assert.doesNotMatch(text(card), /Start here|Step \d+|Next: |Last stop/, `${name} draws its path step`);
    const links = nodes.filter((node) => node.tag === 'a');
    const source = sourceLink(story.lists[0]);
    assert.deepEqual(links.map((link) => link.href), source ? [source] : [], `${name} links past its credit`);
  }
});

test('every bundled path is still followed at its address and at the retired page\'s', () => {
  const paths = resolveReadingPaths(catalog.paths, catalog.lists);
  assert.deepEqual(paths.map(({ id }) => id), ['modern-avengers', 'x-men-messiah-to-avx', 'marvel-knights-to-planet-x']);
  for (const { id } of paths) {
    const hash = formatRoute({ view: 'catalog', pathId: id });
    assert.equal(hash, `#/catalog?path=${id}`);
    assert.equal(parseRoute(hash).pathId, id);
    for (const retired of [`#/reading-paths/${id}`, `#/reading-paths?path=${id}`]) {
      const route = parseRoute(retired);
      assert.equal(route.view, 'catalog', retired);
      assert.equal(route.pathId, id, retired);
    }
  }
});
