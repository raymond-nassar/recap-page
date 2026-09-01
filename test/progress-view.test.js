import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  addIssuesToList,
  createEmptyState,
  createList,
  markRead,
} from '../src/js/lib/model.js';
import { createProgressView } from '../src/js/views/progress.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function element(tag, props = {}, children = []) {
  return { tag, props, children: [].concat(children) };
}

function fixture() {
  const results = {
    children: [],
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = [...nodes]; },
  };
  const radios = [
    { value: 'list', checked: true, addEventListener(_name, listener) { this.listener = listener; } },
    { value: 'all', checked: false, addEventListener(_name, listener) { this.listener = listener; } },
  ];
  const nodes = {
    method: { hidden: true },
    methodText: { textContent: '' },
    results,
    scope: { hidden: false },
    radios,
  };
  const focusCalls = [];
  const listUi = {
    cap: 120,
    groupSection: (group, renderRow) => ({
      kind: 'group',
      key: group.key,
      label: group.label,
      rows: group.rows.map(renderRow),
    }),
    moreButton: (key, rest, rerender, shown) => ({
      kind: 'more',
      key,
      rest,
      rerender,
      shown,
    }),
    shownLine: (shown, total) => ({ kind: 'shown', shown, total }),
    summaryBand: (cells) => ({ kind: 'summary', cells }),
  };
  const preservingFocus = (box, rebuild, options) => {
    rebuild();
    focusCalls.push({ box, options });
  };
  return {
    focusCalls,
    listUi,
    nodes,
    viewOptions: {
      elements: () => nodes,
      el: element,
      emptyAction: (action) => ({ kind: 'empty-action', action }),
      listUi,
      preservingFocus,
    },
  };
}

function seededState() {
  let state = createEmptyState();
  state = createList(state, { id: 'first', name: 'First list' });
  state = addIssuesToList(state, 'first', [
    { issueId: 1, title: 'One', seriesId: 10, seriesName: 'Alpha' },
    { issueId: 2, title: 'Two', seriesId: 10, seriesName: 'Alpha' },
  ]).state;
  state = createList(state, { id: 'second', name: 'Second list' });
  state = addIssuesToList(state, 'second', [
    { issueId: 3, title: 'Three', seriesId: 20, seriesName: 'Beta' },
  ]).state;
  state = markRead(state, 1, true, 1000);
  return { ...state, active: 'first' };
}

test('the Progress controller owns scope changes and renders list and all-list counts', () => {
  const harness = fixture();
  let state = seededState();
  const progress = createProgressView({
    ...harness.viewOptions,
    getActiveListId: () => state.active,
    getState: () => state,
  });

  progress.wire();
  progress.render();

  assert.equal(harness.nodes.scope.hidden, false);
  assert.deepEqual(harness.nodes.radios.map(({ value, checked }) => ({ value, checked })), [
    { value: 'list', checked: true },
    { value: 'all', checked: false },
  ]);
  assert.equal(
    harness.nodes.methodText.textContent,
    'This list counts the issues in “First list”. Tracked means issues you added, not the size of each complete series.',
  );
  assert.deepEqual(harness.nodes.results.children[0], {
    kind: 'summary',
    cells: [
      { figure: 1, label: 'series' },
      { figure: '1 of 2', label: 'tracked issues read' },
      { figure: 0, label: 'series fully read' },
    ],
  });

  harness.nodes.radios[0].checked = false;
  harness.nodes.radios[1].checked = true;
  harness.nodes.radios[1].listener();

  assert.equal(
    harness.nodes.methodText.textContent,
    'All lists counts each issue once, even when it appears in more than one list. Tracked means issues you added, not the size of each complete series.',
  );
  assert.equal(harness.nodes.results.children[0].cells[0].figure, 2);
  assert.equal(harness.focusCalls.length, 2);
  state = createEmptyState();
  progress.render();
  assert.equal(harness.nodes.scope.hidden, true);
  assert.equal(harness.nodes.method.hidden, true);
  assert.equal(harness.nodes.radios[1].checked, true);
  assert.deepEqual(harness.nodes.results.children[0].children[2], {
    kind: 'empty-action',
    action: { label: 'Browse Reading Lists', view: 'catalog' },
  });
});

test('main constructs Progress once and delegates every load-time render without a fallback', () => {
  const main = readFileSync(join(ROOT, 'src/js/main.js'), 'utf8');
  assert.match(main, /const progressView = createProgressView\(\{/);
  assert.match(main, /function renderAll\(\) \{[\s\S]*?\n {2}progressView\.render\(\);/);
  assert.doesNotMatch(main, /progressView\?\.(?:render|wire)|if \(progressView\)/);

  const boot = main.slice(main.indexOf('export function boot()'));
  assert.ok(
    boot.indexOf('progressView.wire();') < boot.indexOf('store.load();'),
    'Progress must be wired before Store load can trigger renderAll',
  );
});
