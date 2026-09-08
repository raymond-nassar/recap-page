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

test('series bars are decorative while zero, partial and fully read tracked counts follow both scopes', () => {
  let state = createEmptyState();
  state = createList(state, { id: 'first', name: 'First list' });
  state = createList(state, { id: 'second', name: 'Second list' });
  const issues = ['Alpha', 'Beta', 'Gamma'].flatMap((seriesName, series) => (
    Array.from({ length: 3 }, (_, issue) => ({
      issueId: series * 3 + issue + 1,
      title: `${seriesName} #${issue + 1}`,
      seriesId: series + 1,
      seriesName,
    }))
  ));
  state = addIssuesToList(state, 'first', issues.filter((_, index) => index % 3 !== 2)).state;
  state = addIssuesToList(state, 'second', issues.filter((_, index) => index % 3 !== 1)).state;
  for (const id of [4, 7, 8, 9]) state = markRead(state, id, true, 1000);

  const harness = fixture();
  const progress = createProgressView({
    ...harness.viewOptions,
    getActiveListId: () => 'first',
    getState: () => state,
  });
  progress.wire();

  for (const scope of ['list', 'all']) {
    for (const radio of harness.nodes.radios) radio.checked = radio.value === scope;
    harness.nodes.radios.find((radio) => radio.checked).listener();
    const tracked = scope === 'list' ? 2 : 3;
    const groups = harness.nodes.results.children.filter((node) => node.kind === 'group');
    assert.deepEqual(groups.map((group) => group.key), ['active', 'unstarted', 'done']);
    const rows = groups.flatMap((group) => group.rows);
    assert.deepEqual(rows.map(({ children: [main, bar] }) => ({
      name: main.children[0].children[0].props.text,
      count: main.children[1].props.text,
      bar,
    })), [
      {
        name: 'Beta',
        count: `1 of ${tracked} tracked issues read (${scope === 'list' ? 50 : 33}%)`,
        bar: element('progress', { max: String(tracked), value: '1', 'aria-hidden': 'true' }),
      },
      {
        name: 'Alpha',
        count: `0 of ${tracked} tracked issues read (0%)`,
        bar: element('progress', { max: String(tracked), value: '0', 'aria-hidden': 'true' }),
      },
      {
        name: 'Gamma',
        count: `${tracked} of ${tracked} tracked issues read (100%)`,
        bar: element('progress', { max: String(tracked), value: String(tracked), 'aria-hidden': 'true' }),
      },
    ], scope);
  }
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
