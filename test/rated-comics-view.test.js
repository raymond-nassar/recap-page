import test from 'node:test';
import assert from 'node:assert/strict';

import { createRatedComicsView } from '../src/js/views/rated-comics.js';

function element(tag, props = {}, children = []) {
  return { tag, props, children: [].concat(children) };
}

function box() {
  return {
    children: [],
    textContent: '',
    append(...nodes) { this.children.push(...nodes); },
    appendChild(node) { this.children.push(node); return node; },
    replaceChildren(...nodes) { this.children = [...nodes]; },
  };
}

function control(value = '') {
  const listeners = {};
  return {
    value,
    dataset: {},
    children: [],
    focused: 0,
    addEventListener(type, fn) { listeners[type] = fn; },
    fire(type, event = { preventDefault() {} }) { listeners[type](event); },
    replaceChildren(...nodes) { this.children = nodes; },
    focus() { this.focused += 1; },
  };
}

function walk(node, visit) {
  if (node == null || typeof node !== 'object') return;
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function texts(root) {
  const out = [];
  walk(root, (node) => {
    if (node.props?.text) out.push(node.props.text);
    for (const child of node.children ?? []) if (typeof child === 'string') out.push(child);
  });
  return out.join(' | ');
}

function find(root, predicate) {
  let hit = null;
  walk(root, (node) => { if (!hit && predicate(node)) hit = node; });
  return hit;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

const INDEX = {
  guides: [
    { id: 'spidey', name: 'Spider-Man Guide', characters: ['Spider-Man'] },
    { id: 'xmen', name: 'X-Men Guide', characters: ['Wolverine', 'Storm'] },
  ],
  byIssue: new Map([[1, [0]], [2, [0, 1]], [3, [1]]]),
};

function deferredLoader() {
  const loader = { loaded: null, calls: 0, settle: null };
  loader.load = () => {
    loader.calls += 1;
    return new Promise((resolve, reject) => {
      loader.settle = (ok) => {
        if (ok) { loader.loaded = INDEX; resolve(INDEX); } else reject(new Error('offline'));
      };
    });
  };
  return loader;
}

function harness({ ratings = {}, issues = {}, cap = 120, loader = null, blocked = false } = {}) {
  const state = { ratings, issues };
  const els = {
    shelfStatus: { textContent: '' },
    shelfList: box(),
    form: control(),
    min: control(''),
    q: control(''),
    character: control(''),
    sort: control('rating'),
    clear: control(),
    count: { textContent: '' },
    notice: box(),
    results: box(),
    panel: { hidden: false },
  };
  const docListeners = {};
  const doc = { activeElement: null, addEventListener: (type, fn) => { docListeners[type] = fn; } };
  const log = { commits: 0, announced: [], focused: [] };
  const view = createRatedComicsView({
    el: element,
    elements: () => els,
    emptyAction: (action) => ({ kind: 'empty-action', action, children: [] }),
    getState: () => state,
    isBlocked: () => blocked,
    issueFocusAnchor: (issue, options) => ({
      kind: 'focus', issue, options, children: options.children, isConnected: true,
      focus() { log.focused.push(issue.issueId); },
    }),
    listUi: {
      cap,
      shownLine: (shown, total) => ({ kind: 'shown', shown, total, children: [] }),
      moreButton: (key, rest, rerender, shownByKey) => ({ kind: 'more', key, rest, rerender, shownByKey, children: [] }),
      summaryBand: () => null,
    },
    paintCover: () => {},
    preservingFocus: (_box, rebuild) => rebuild(),
    seriesOnly: (name) => name,
    announce: (text) => log.announced.push(text),
    loader,
    focusViewHeading: () => {},
    matchingIssueOpener: (opener) => find(els.results, (n) => n.kind === 'focus' && n.issue.issueId === Number(opener.issueId)),
    onCommit: () => { log.commits += 1; },
    nextFrame: (fn) => fn(),
    doc,
  });
  return { view, els, log, state, docListeners, doc };
}

const issue = (id, title, extra = {}) => ({ issueId: id, title, ...extra });

test('the shelf reports no ratings, none high enough, and only the six highest of many', () => {
  const h = harness();
  h.view.renderShelf();
  assert.match(h.els.shelfStatus.textContent, /Comics you rate/);
  assert.equal(h.els.shelfList.children.length, 0);

  h.state.ratings = { 1: 3, 2: 2 };
  h.view.renderShelf();
  assert.equal(h.els.shelfStatus.textContent, 'None of your 2 rated comics are at 4 stars or higher yet.');

  h.state.ratings = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, i < 7 ? 5 : 4]));
  h.view.renderShelf();
  assert.equal(h.els.shelfList.children.length, 6);
  assert.equal(h.els.shelfStatus.textContent, 'Your 6 highest of 8 comics rated 4 stars and up.');
  assert.ok(h.els.shelfList.children.every((row) => row.options.surface === 'top-rated'));
  assert.match(texts(h.els.shelfList), /Your rating: 5 out of 5/);
});

test('applying and clearing commits the drafts once, rewrites the address and announces the count', () => {
  const h = harness({
    ratings: { 1: 5, 2: 3, 3: 4.5 },
    issues: { 1: issue(1, 'Amazing'), 2: issue(2, 'Uncanny'), 3: issue(3, 'Astonishing') },
  });
  h.view.renderBrowser();
  assert.equal(h.els.count.textContent, '3 rated comics.');
  assert.equal(h.log.announced.length, 0);

  h.els.min.value = '4';
  h.els.q.value = 'a';
  h.els.form.fire('submit');
  assert.deepEqual(h.view.committed(), { min: 4, q: 'a', character: '', sort: 'rating' });
  assert.equal(h.log.commits, 1);
  assert.equal(h.els.count.textContent, '2 of 3 rated comics match.');
  assert.deepEqual(h.log.announced, ['2 of 3 rated comics match.']);
  assert.deepEqual(h.els.results.children.map((r) => r.issue.issueId), [1, 3]);

  h.els.clear.fire('click');
  assert.equal(h.els.min.value, '');
  assert.equal(h.els.q.value, '');
  assert.equal(h.els.count.textContent, '3 rated comics.');
  assert.equal(h.log.commits, 2);
});

test('a title search reports rated comics with no saved details instead of hiding them silently', () => {
  const h = harness({ ratings: { 1: 5, 9: 4 }, issues: { 1: issue(1, 'Amazing') } });
  h.view.renderBrowser();
  assert.match(texts(h.els.results), /Issue 9/);
  assert.match(texts(h.els.results), /Details not saved/);

  h.view.setCommitted({ q: 'amazing' });
  h.view.renderBrowser();
  assert.equal(h.els.count.textContent, '1 of 2 rated comics match. 1 rated comic has no saved title to search.');
});

test('a character filter waits for the guide data and never presents an unfiltered count as filtered', async () => {
  const loader = deferredLoader();
  const h = harness({
    ratings: { 1: 5, 2: 4, 3: 3, 4: 5 },
    issues: { 1: issue(1, 'A'), 2: issue(2, 'B'), 3: issue(3, 'C'), 4: issue(4, 'D') },
    loader,
  });
  h.view.setCommitted({ character: 'Spider-Man' });
  h.view.renderBrowser();
  assert.equal(loader.calls, 1);
  assert.match(texts(h.els.notice), /Loading Character guide data/);
  assert.equal(h.els.count.textContent, '4 rated comics. This count reflects rating and title matches only.');

  h.els.form.fire('submit');
  assert.equal(h.log.announced.length, 0, 'no announcement while the filter is still pending');

  loader.settle(true);
  await tick();
  assert.equal(h.els.notice.children.length, 0);
  assert.equal(h.els.count.textContent, '2 of 4 rated comics match.');
  assert.deepEqual(h.log.announced, ['2 of 4 rated comics match.']);
  assert.match(texts(h.els.results), /In Character guide: Spider-Man Guide/);
  assert.ok(h.els.character.children.some((o) => o.props.value === 'Storm'));
});

test('a failed guide load says the filter is not applied and Retry loads again', async () => {
  const loader = deferredLoader();
  const h = harness({ ratings: { 1: 5 }, issues: { 1: issue(1, 'A') }, loader });
  h.view.setCommitted({ character: 'Spider-Man' });
  h.view.renderBrowser();
  loader.settle(false);
  await tick();
  assert.match(texts(h.els.notice), /Character guide filter not applied\. The Character guide data could not be loaded/);
  const retry = find(h.els.notice, (n) => n.props?.dataset?.act === 'retry');
  retry.props.onclick();
  assert.equal(loader.calls, 2);
  loader.settle(true);
  await tick();
  assert.equal(h.els.notice.children.length, 0);
  assert.equal(h.els.count.textContent, '1 of 1 rated comic match.');
});

test('a character no guide uses any more is named, kept selectable, and clearable from the notice', async () => {
  const loader = deferredLoader();
  const h = harness({ ratings: { 1: 5, 2: 4 }, issues: { 1: issue(1, 'A'), 2: issue(2, 'B') }, loader });
  h.view.renderBrowser();
  loader.settle(true);
  await tick();
  h.view.setCommitted({ character: 'Hulk' });
  h.view.renderBrowser();
  assert.match(texts(h.els.notice), /No reading guide uses "Hulk" now/);
  assert.equal(h.els.count.textContent, '2 rated comics. This count reflects rating and title matches only.');
  assert.ok(h.els.character.children.some((o) => o.props.value === 'Hulk'));

  find(h.els.notice, (n) => n.props?.dataset?.act === 'clear-character').props.onclick();
  assert.equal(h.view.committed().character, '');
  assert.equal(h.els.character.focused, 1);
  assert.equal(h.els.notice.children.length, 0);
});

test('a focus return is dropped when the filters change or the reader acts before the data arrives', async () => {
  const loader = deferredLoader();
  const h = harness({ ratings: { 1: 5, 2: 4 }, issues: { 1: issue(1, 'A'), 2: issue(2, 'B') }, loader });
  h.view.setCommitted({ character: 'Spider-Man' });
  h.view.renderBrowser();
  h.view.restoreOpener({ view: 'library-rated', issueId: 1 });
  h.view.setCommitted({ character: 'Storm' });
  loader.settle(true);
  await tick();
  assert.deepEqual(h.log.focused, [], 'an obsolete filter cannot claim focus');
  assert.equal(h.els.clear.focused, 0);

  const second = deferredLoader();
  const typing = harness({ ratings: { 1: 5 }, issues: { 1: issue(1, 'A') }, loader: second });
  typing.view.setCommitted({ character: 'Spider-Man' });
  typing.view.renderBrowser();
  typing.view.restoreOpener({ view: 'library-rated', issueId: 1 });
  typing.docListeners.input();
  second.settle(true);
  await tick();
  assert.deepEqual(typing.log.focused, [], 'typing in a field withdraws the pending return');

  const other = harness({ ratings: { 1: 5 }, issues: { 1: issue(1, 'A') } });
  other.view.renderBrowser();
  other.view.restoreOpener({ view: 'library', issueId: 1 });
  assert.deepEqual(other.log.focused, [], 'an opener from another view is ignored');
});

test('returning to a comic beyond the first batch reveals its batch and focuses it, or falls back to Clear', () => {
  const ratings = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [i + 1, 5 - i]));
  const issues = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [i + 1, issue(i + 1, `T${i + 1}`)]));
  const h = harness({ ratings, issues, cap: 2 });
  h.view.renderBrowser();
  assert.equal(h.els.results.children.filter((n) => n.kind === 'focus').length, 2);

  h.view.restoreOpener({ view: 'library-rated', issueId: 5 });
  assert.equal(h.els.results.children.filter((n) => n.kind === 'focus').length, 5);
  assert.deepEqual(h.log.focused, [5]);

  h.view.restoreOpener({ view: 'library-rated', issueId: 77 });
  assert.equal(h.els.clear.focused, 1);
});

test('a re-render that detaches the focused result row focuses the same comic in the new list', () => {
  const h = harness({ ratings: { 1: 5, 2: 4 }, issues: { 1: issue(1, 'A'), 2: issue(2, 'B') } });
  h.view.renderBrowser();
  h.doc.activeElement = { dataset: { focusSource: 'rated-results', issueId: '2' }, isConnected: false };
  h.view.renderBrowser();
  assert.deepEqual(h.log.focused, [2]);

  h.doc.activeElement = { dataset: { focusSource: 'rated-results', issueId: '2' }, isConnected: true };
  h.view.renderBrowser();
  assert.deepEqual(h.log.focused, [2], 'a row that survived the rebuild keeps its own focus');

  h.doc.activeElement = { dataset: {}, isConnected: false };
  h.view.renderBrowser();
  assert.deepEqual(h.log.focused, [2], 'focus outside the results is left to preservingFocus');
});

test('a blocked store shows recovery guidance instead of ratings on both surfaces', () => {
  const h = harness({ ratings: { 1: 5 }, issues: { 1: issue(1, 'A') }, blocked: true });
  h.view.renderShelf();
  assert.match(h.els.shelfStatus.textContent, /needs recovery/);
  assert.equal(h.els.shelfList.children.length, 0);
  h.view.renderBrowser();
  assert.equal(h.els.count.textContent, '');
  const action = find(h.els.results, (n) => n.kind === 'empty-action');
  assert.equal(action.action.view, 'data');
  assert.doesNotMatch(texts(h.els.results), /Your rating: /);
});
