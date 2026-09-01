import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createIssueView } from '../src/js/views/issue.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function node(textContent = '') {
  return {
    hidden: false,
    textContent,
    attributes: {},
    addEventListener(name, listener) { this.listeners ??= {}; this.listeners[name] = listener; },
    removeAttribute(name) { delete this.attributes[name]; delete this[name]; },
    replaceChildren(...children) { this.children = children; },
    setAttribute(name, value) { this.attributes[name] = value; },
  };
}

function harness({ apiIssue, state, synopsis = null } = {}) {
  const nodes = {
    background: node(),
    byline: node(),
    cancelSynopsis: node(),
    card: node(),
    context: node(),
    description: node(),
    facts: node(),
    fallback: node(),
    heading: node(),
    image: node(),
    info: node('Info'),
    note: node(),
    number: node(),
    read: node(),
    series: node(),
    status: node(),
    synopsis: node(),
    synopsisStatus: node(),
  };
  const calls = {
    breadcrumbs: 0,
    cancelSynopsis: 0,
    covers: 0,
    read: [],
    stale: [],
    startSynopsis: 0,
  };
  let synopsisActive = false;
  const view = createIssueView({
    coverUrl: (issue) => issue.cover || null,
    decorateResult: (result) => ({ ...result, breadcrumbShelf: 'validated-shelf' }),
    elements: () => nodes,
    fact: (key, value, className) => ({ key, value, className }),
    getApi: () => ({ issue: apiIssue ?? (async () => null) }),
    getState: () => state ?? {
      issues: {},
      lists: {},
      read: {},
      notes: {},
      overrides: {},
    },
    getSynopsis: () => synopsis,
    isSynopsisActive: () => synopsisActive,
    loadCatalog: async () => ({ lists: [] }),
    loadOrder: async () => ({ items: [] }),
    onCancelSynopsis: () => { calls.cancelSynopsis += 1; },
    onRead: (...args) => calls.read.push(args),
    onStaleContext: (route) => calls.stale.push(route),
    onStartSynopsis: () => { calls.startSynopsis += 1; },
    paintBackground: () => {},
    paintCover: () => { calls.covers += 1; },
    renderBreadcrumbs: () => { calls.breadcrumbs += 1; },
    seriesOnly: (name) => name.replace(/\s+\(.*/, ''),
    synopsisFallback: (_issue, entry) => entry ?? 'No synopsis.',
    synopsisStatusLine: (status) => status?.text ?? '',
  });
  return {
    calls,
    nodes,
    setSynopsisActive(value) { synopsisActive = value; },
    view,
  };
}

function issue(issueId = 42) {
  return {
    issueId,
    title: 'Issue title',
    number: '7',
    seriesId: 10,
    seriesName: 'Series (2026)',
    cover: 'https://cdn.example.test/cover.jpg',
    url: `https://www.marvel.com/comics/issue/${issueId}/issue`,
    hydrated: true,
  };
}

test('Issue view owns loading, resolved paint, current result, and local controls', async () => {
  const saved = issue();
  const route = { view: 'issue', issueId: 42, context: { kind: 'list', id: 'a' } };
  const h = harness({
    synopsis: 'Held for this tab.',
    state: {
      issues: { 42: saved },
      lists: { a: { id: 'a', name: 'A list', itemIds: [42] } },
      read: {},
      notes: { 42: 'Remember this' },
      overrides: {},
    },
  });
  h.view.wire();
  const rendering = h.view.render(route);
  assert.equal(h.nodes.heading.textContent, 'Loading issue details');
  assert.equal(h.nodes.card.hidden, true);
  await rendering;

  assert.equal(h.view.result().issue.title, 'Issue title');
  assert.equal(h.nodes.heading.textContent, 'Issue title');
  assert.equal(h.nodes.context.textContent, 'A list · 1 of 1');
  assert.equal(h.nodes.description.textContent, 'Held for this tab.');
  assert.equal(h.nodes.note.textContent, 'Remember this');
  assert.equal(h.nodes.card.hidden, false);
  assert.equal(h.nodes.read.hidden, false);
  assert.equal(h.nodes.info.hidden, false);
  assert.equal(h.nodes.info.attributes['aria-label'], 'Info: Issue title on marvel.com');
  assert.equal(h.calls.covers, 1);
  assert.equal(h.calls.breadcrumbs, 1);

  const event = {};
  h.nodes.read.listeners.click(event);
  h.nodes.synopsis.listeners.click();
  h.nodes.cancelSynopsis.listeners.click();
  assert.deepEqual(h.calls.read, [[h.view.result().issue, event]]);
  assert.equal(h.calls.startSynopsis, 1);
  assert.equal(h.calls.cancelSynopsis, 1);
});

test('Issue view validates stale context before decoration and delegates route correction', async () => {
  const route = { view: 'issue', issueId: 42, context: { kind: 'order', id: 'missing' } };
  const h = harness({ apiIssue: async () => issue() });
  await h.view.render(route);

  assert.equal(h.view.result().contextStatus, 'stale');
  assert.equal(h.view.result().breadcrumbShelf, 'validated-shelf');
  assert.deepEqual(h.calls.stale, [route]);
  assert.match(h.nodes.status.textContent, /no longer contains this issue/);
});

test('Issue view paints unavailable detail errors without inventing an action', async () => {
  const h = harness({ apiIssue: async () => { throw new TypeError('offline'); } });
  await h.view.render({ view: 'issue', issueId: 42, context: null });

  assert.equal(h.view.result().source, 'unavailable');
  assert.equal(h.nodes.heading.textContent, 'Issue unavailable');
  assert.equal(h.nodes.card.hidden, true);
  assert.match(h.nodes.status.textContent, /could not be loaded/);
  assert.equal(h.calls.breadcrumbs, 1);
});

test('Issue view cancellation suppresses a pending result and synopsis repaint stays local', async () => {
  let requested = false;
  let aborted = false;
  const h = harness({
    apiIssue: (_id, { signal }) => new Promise((resolve, reject) => {
      requested = true;
      const timer = setTimeout(() => resolve(issue()), 20);
      signal.addEventListener('abort', () => {
        aborted = true;
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      });
    }),
  });
  const rendering = h.view.render({ view: 'issue', issueId: 42, context: null });
  await Promise.resolve();
  assert.equal(requested, true);
  h.view.cancel();
  await rendering;
  assert.equal(aborted, true);
  assert.equal(h.view.result(), null);
  assert.equal(h.nodes.heading.textContent, 'Loading issue details');

  const painted = harness({
    state: {
      issues: { 42: issue() },
      lists: {},
      read: {},
      notes: {},
      overrides: {},
    },
  });
  await painted.view.render({ view: 'issue', issueId: 42, context: null });
  painted.setSynopsisActive(true);
  painted.view.repaintSynopsis({ text: 'Fetching synopsis 0 of 1.' });
  assert.equal(painted.nodes.synopsisStatus.textContent, 'Fetching synopsis 0 of 1.');
  assert.equal(painted.nodes.synopsis.hidden, true);
  assert.equal(painted.nodes.cancelSynopsis.hidden, false);
});

test('main constructs Issue Details once and delegates without moving shared policy', () => {
  const main = readFileSync(join(ROOT, 'src/js/main.js'), 'utf8');
  assert.match(main, /const issueView = createIssueView\(\{/);
  assert.match(main, /if \(next === 'issue'\) void issueView\.render\(issueRoute\);/);
  assert.match(main, /if \(next !== 'issue' && view === 'issue'\) \{[\s\S]*?issueView\.cancel\(\);/);
  assert.match(main, /const issueResult = issueView\.result\(\);/);
  assert.match(main, /if \(view === 'issue'\) issueView\.repaintSynopsis\(status\);/);
  assert.match(main, /issueView\.wire\(\);/);
  assert.doesNotMatch(main, /issueView\?\.(?:render|cancel|result|repaintSynopsis|wire)|if \(issueView\)/);

  const route = main.slice(main.indexOf('function applyRoute'), main.indexOf('function setFullOrderFromRoute'));
  assert.match(route, /issueRoute = route;/);
  assert.match(route, /showView\('issue'/);
  const navigation = main.slice(main.indexOf('function openIssueFocus'), main.indexOf('function issueFocusAnchor'));
  assert.match(navigation, /history\.replaceState/);
  assert.match(navigation, /history\.pushState/);
  assert.match(main, /const store = new Store\(\{/);
  assert.match(main, /const synopsisRunner = new SynopsisRunner\(\{/);
});
