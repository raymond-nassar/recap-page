import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { addIssuesToList, createEmptyState, createList, markRead } from '../src/js/lib/model.js';
import { createSavedListsPresenter } from '../src/js/views/shared/saved-lists.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function element(tag, props = {}, children = []) {
  return { tag, props, children: [].concat(children) };
}

function sectionFixture() {
  const head = {
    note: null,
    querySelector() { return this.note; },
    appendChild(node) { this.note = node; return node; },
  };
  return {
    section: {
      hidden: false,
      querySelector(selector) {
        assert.equal(selector, '.sec-h');
        return head;
      },
    },
    head,
    results: {
      children: [],
      replaceChildren(...nodes) { this.children = nodes; },
    },
  };
}

function stateFixture() {
  let state = createEmptyState();
  state = createList(state, { id: 'first', name: 'First list' });
  state = addIssuesToList(state, 'first', [
    { issueId: 1, title: 'One', seriesName: 'Alpha' },
    { issueId: 2, title: 'Two', seriesName: 'Alpha' },
  ]).state;
  state = markRead(state, 1, true, 1000);
  state = createList(state, { id: 'second', name: 'Second list' });
  state = addIssuesToList(state, 'second', [
    { issueId: 3, title: 'Three', seriesName: 'Beta' },
  ]).state;
  return state;
}

test('saved-list selection scopes active cards and its progress summary without changing default data', () => {
  const state = stateFixture();
  const before = JSON.stringify(state);
  const presenter = createSavedListsPresenter({
    el: element, getState: () => state, openList: () => {}, paintCover: () => {},
  });
  const target = sectionFixture();
  presenter.render(target.section, target.results, { ids: ['second'] });
  assert.equal(target.results.children.length, 1);
  assert.equal(target.head.note.textContent, '1 order · 1 not started');
  assert.equal(target.results.children[0].children[0].children[1].props.text, 'Second list');
  presenter.render(target.section, target.results, { ids: [] });
  assert.equal(target.section.hidden, true);
  assert.equal(JSON.stringify(state), before);
});

test('completed-list presentation overrides status and details without falsifying partial read or deferred counts', () => {
  const state = stateFixture();
  state.lists.first.deferredIssueIds = [2];
  const presenter = createSavedListsPresenter({
    el: element, getState: () => state, openList: () => {}, paintCover: () => {},
  });
  const target = sectionFixture();
  presenter.render(target.section, target.results, {
    ids: ['first'],
    status: () => ({ text: 'Completed', className: 'badge-done' }),
    detail: () => 'Enjoyed. Completed today',
    summary: () => '1 completed list',
  });
  const button = target.results.children[0].children[0];
  assert.equal(button.children[3].props.text, '1 / 2. 1 deferred');
  assert.equal(button.children[4].props.text, 'Completed');
  assert.equal(button.children[5].props.text, 'Enjoyed. Completed today');
  assert.match(button.props['aria-label'], /1 deferred.*Completed.*Enjoyed/);
  assert.equal(target.head.note.textContent, '1 completed list');
});

test('one saved-list presenter paints Home and Library and delegates opening', () => {
  let state = stateFixture();
  const opened = [];
  const covers = [];
  const presenter = createSavedListsPresenter({
    el: element,
    getState: () => state,
    openList: (id) => opened.push(id),
    paintCover: (...args) => covers.push(args),
  });
  const home = sectionFixture();
  const library = sectionFixture();

  presenter.render(home.section, home.results);
  presenter.render(library.section, library.results);

  assert.equal(home.section.hidden, false);
  assert.equal(home.head.note.props.text, undefined);
  assert.equal(home.head.note.textContent, '2 orders · 1 in progress · 1 not started');
  assert.equal(library.head.note.textContent, home.head.note.textContent);
  assert.deepEqual(
    library.results.children.map((item) => item.children[0].children[1].props.text),
    home.results.children.map((item) => item.children[0].children[1].props.text),
  );
  assert.equal(
    home.results.children[0].children[0].props['aria-label'],
    'First list 1 2: issues read, Reading. Open this list',
  );
  home.results.children[1].children[0].props.onclick();
  assert.deepEqual(opened, ['second']);
  assert.equal(covers.length, 12);

  state = createEmptyState();
  presenter.render(home.section, home.results);
  assert.equal(home.section.hidden, true);
});

test('shared saved lists never depend on Library and main composes both consumers', () => {
  const shared = readFileSync(join(ROOT, 'src/js/views/shared/saved-lists.js'), 'utf8');
  const main = readFileSync(join(ROOT, 'src/js/main.js'), 'utf8');
  assert.doesNotMatch(shared, /views\/library|lib\/library/);
  assert.match(main, /const savedLists = createSavedListsPresenter\(\{/);
  assert.match(main, /openList: openSavedList/);
  assert.match(main, /function selectSavedList[\s\S]*activeListId\(\) === id[\s\S]*setActive\(state, id\)[\s\S]*return store\.lastUpdateOk/);
  assert.match(main, /function openSavedList[\s\S]*!selectSavedList\(id\)[\s\S]*showView\('read', \{ push: true \}\)/);
  assert.match(main, /renderSavedLists: \(section, results\) => savedLists\.render\(section, results, \{ ids: listHistory\.activeIds\(store\.state\) \}\)/);
  assert.match(main, /const homeView = createHomeView\(\{/);
  assert.match(main, /function renderLibraryHub\([\s\S]*savedLists\.render\(/);
  assert.doesNotMatch(main, /savedLists\?\.(?:render)|if \(savedLists\)/);
});
