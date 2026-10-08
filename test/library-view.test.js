import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLibraryView } from '../src/js/views/library.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function element(tag, props = {}, children = []) {
  return { tag, props, children: [].concat(children) };
}

function resultsBox() {
  return {
    children: [],
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = [...nodes]; },
  };
}

test('Library owns empty, grouped, paged, focused issue presentation', () => {
  let rows = [];
  const heading = { textContent: '' };
  const results = resultsBox();
  const focusCalls = [];
  const focusAnchors = [];
  const covers = [];
  const view = {
    value: 'library-read',
    label: 'Everything read',
    sort: 'Newest first',
    empty: 'Nothing is marked read yet.',
    emptyAction: { label: 'Browse Reading Lists', view: 'catalog' },
    markHandAdded: true,
    select: () => rows,
    summarise: (all) => [{ figure: all.length, label: 'issues read' }],
    group: (slice) => [{ key: 'today', label: 'Today', rows: slice }],
  };
  const listUi = {
    cap: 2,
    summaryBand: (cells) => ({ kind: 'summary', cells }),
    shownLine: (shown, total) => ({ kind: 'shown', shown, total }),
    groupSection: (group, renderRow) => ({
      kind: 'group',
      rows: group.rows.map(renderRow),
    }),
    moreButton: (key, rest, rerender, shownByKey) => ({
      kind: 'more',
      key,
      rest,
      onclick() {
        shownByKey.set(key, (shownByKey.get(key) ?? 2) + 2);
        rerender();
      },
    }),
  };
  const library = createLibraryView({
    el: element,
    elements: () => ({ heading, results }),
    emptyAction: (action) => ({ kind: 'empty-action', action }),
    getState: () => ({}),
    issueFocusAnchor: (issue, options) => {
      focusAnchors.push({ issue, options });
      return { kind: 'focus', issue, options };
    },
    listUi,
    paintCover: (...args) => covers.push(args),
    preservingFocus: (box, rebuild, options) => {
      rebuild();
      focusCalls.push({ box, options });
    },
    seriesOnly: (name) => name.replace(/\s+\(.*/, ''),
    views: [view],
  });

  library.render();
  assert.equal(heading.textContent, 'Everything read');
  assert.deepEqual(results.children[0].children[2], {
    kind: 'empty-action',
    action: view.emptyAction,
  });

  rows = Array.from({ length: 13 }, (_, index) => ({
    issueId: index + 1,
    title: `Issue ${index + 1}`,
    seriesName: 'Series (2026)',
    lists: [],
    readAt: 1000,
    source: index === 0 ? 'manual' : 'curated',
  }));
  library.render();
  assert.deepEqual(results.children.slice(0, 3).map(({ kind }) => kind), [undefined, 'summary', 'shown']);
  assert.equal(results.children[3].kind, 'group');
  assert.equal(results.children[3].rows.length, 2);
  assert.equal(results.children[4].kind, 'more');
  assert.equal(focusAnchors[0].options.surface, 'everything-read');
  assert.equal('context' in focusAnchors[0].options, false);
  assert.match(focusAnchors[0].options.children[1].children[1].children[0].props.text, /In no list/);
  assert.equal(covers.length, 2);

  results.children[4].onclick();
  assert.equal(results.children[3].rows.length, 4);
  assert.equal(focusCalls.length, 3);
  assert.equal(focusCalls[2].options.primary, 'more');
});

test('main constructs Library once and delegates refreshes without a fallback', () => {
  const main = readFileSync(join(ROOT, 'src/js/main.js'), 'utf8');
  assert.match(main, /const libraryView = createLibraryView\(\{/);
  assert.match(main, /function renderAll\(\) \{[\s\S]*?\n {2}libraryView\.render\(\);/);
  assert.match(main, /function setCovers\([\s\S]*?\n {2}libraryView\.render\(\);/);
  assert.doesNotMatch(main, /libraryView\?\.(?:render|wire)|if \(libraryView\)/);
});

function manualRows(state) {
  const results = resultsBox();
  const focused = [];
  const library = createLibraryView({
    el: element, elements: () => ({ heading: {}, results }),
    emptyAction: () => null, getState: () => state,
    issueFocusAnchor: (issue, options) => {
      focused.push({ issue, options });
      return { tag: 'a', props: { href: `#/issue/${issue.issueId}` }, children: [] };
    },
    listUi: { cap: 100, summaryBand: () => null, shownLine: () => null },
    paintCover: () => {}, preservingFocus: (_box, rebuild) => rebuild(),
    seriesOnly: (name) => name,
    views: [{ value: 'library-manual', label: 'Added by hand', sort: 'Newest first',
      select: () => [{ issueId: -7, title: 'Manual comic', lists: ['Same name'], source: 'manual' }],
      summarise: () => [] }],
  });
  library.render();
  return { results, focused };
}

test('manual rows open the existing Issue surface and resolve duplicate membership names from actual IDs', () => {
  const state = { listOrder: ['b/list', 'a'], lists: {
    a: { name: 'Same name', itemIds: [-7] }, 'b/list': { name: 'Same name', itemIds: [-7] },
  } };
  const { results, focused } = manualRows(state);
  const row = results.children.at(-1);
  assert.equal(row.children[0].props.href, '#/issue/-7');
  assert.deepEqual(row.children[1].children.slice(1).map(({ props }) => [props.href, props.text]),
    [['#/read/b%2Flist', 'Same name'], ['#/read/a', 'Same name']]);
  assert.equal(focused[0].options.surface, 'added-by-hand');
  assert.equal('context' in focused[0].options, false);
});

test('orphan manual rows retain Issue details without fabricating a saved list or provider identity', () => {
  const { results, focused } = manualRows({ listOrder: ['other'], lists: {
    other: { name: 'Same name', itemIds: [77] },
  } });
  assert.equal(results.children.at(-1).props.href, '#/issue/-7');
  assert.equal(focused[0].issue.issueId, -7);
  assert.equal(focused[0].issue.url, undefined);
  assert.equal(focused[0].issue.seriesId, undefined);
});
