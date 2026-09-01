import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { issuePresentation, resolveIssueFocus } from '../src/js/lib/issueFocus.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(ROOT, path), 'utf8');

const issue = (issueId, title = `Issue ${issueId}`) => ({
  issueId,
  title,
  seriesName: 'Test Series',
  hydrated: true,
});

function state(overrides = {}) {
  return {
    issues: {},
    lists: {},
    read: {},
    notes: {},
    overrides: {},
    ...overrides,
  };
}

test('saved issues resolve without a request or state write', async () => {
  let requests = 0;
  let writes = 0;
  const saved = issue(42, 'Saved issue');
  const result = await resolveIssueFocus({
    issueId: 42,
    state: state({ issues: { 42: saved } }),
    api: { issue: async () => { requests += 1; } },
    store: { update: () => { writes += 1; } },
  });
  assert.equal(result.source, 'saved');
  assert.equal(result.issue.title, 'Saved issue');
  assert.equal(result.contextStatus, 'none');
  assert.equal(requests, 0);
  assert.equal(writes, 0);
});

test('saved-list context is valid only when the list contains the issue', async () => {
  const base = state({
    issues: { 42: issue(42) },
    lists: { a: { id: 'a', name: 'A list', itemIds: [7, 42] } },
    read: { 42: 123 },
    notes: { 42: 'Remember this' },
    overrides: { 42: 'available' },
  });
  const valid = await resolveIssueFocus({
    issueId: 42,
    context: { kind: 'list', id: 'a' },
    state: base,
  });
  assert.deepEqual(valid.context, {
    kind: 'list',
    id: 'a',
    name: 'A list',
    position: 2,
    total: 2,
    collectedIn: null,
    read: true,
    readAt: 123,
    note: 'Remember this',
    override: 'available',
  });
  assert.equal(valid.contextStatus, 'valid');

  const stale = await resolveIssueFocus({
    issueId: 42,
    context: { kind: 'list', id: 'missing' },
    state: base,
  });
  assert.equal(stale.issue.title, 'Issue 42');
  assert.equal(stale.context, null);
  assert.equal(stale.contextStatus, 'stale');
});

test('bundled-order context resolves positive and negative items by issueId', async () => {
  const catalog = { lists: [{ id: 'order-a', name: 'Order A', file: 'order_a.json' }] };
  const order = {
    items: [
      { ...issue(42), collectedIn: 'Volume one' },
      issue(-99, 'Bundled placeholder'),
    ],
  };
  const loaded = [];
  const loadOrder = async (file) => {
    loaded.push(file);
    return order;
  };
  for (const [issueId, title, position] of [[42, 'Issue 42', 1], [-99, 'Bundled placeholder', 2]]) {
    const result = await resolveIssueFocus({
      issueId,
      context: { kind: 'order', id: 'order-a' },
      state: state(),
      catalog,
      loadOrder,
      api: { issue: async () => assert.fail('bundled issues do not use the API') },
    });
    assert.equal(result.source, 'bundled');
    assert.equal(result.issue.title, title);
    assert.equal(result.context.position, position);
    assert.equal(result.context.total, 2);
    assert.equal(result.contextStatus, 'valid');
  }
  assert.deepEqual(loaded, ['order_a.json', 'order_a.json']);
});

test('stale bundled context falls through to one positive issue request', async () => {
  let requests = 0;
  const result = await resolveIssueFocus({
    issueId: 42,
    context: { kind: 'order', id: 'missing' },
    state: state(),
    catalog: { lists: [] },
    loadOrder: async () => assert.fail('a missing catalog entry has no file to load'),
    api: {
      issue: async (id) => {
        requests += 1;
        assert.equal(id, 42);
        return issue(42, 'From API');
      },
    },
  });
  assert.equal(result.source, 'api');
  assert.equal(result.contextStatus, 'stale');
  assert.equal(result.issue.title, 'From API');
  assert.equal(requests, 1);
});

test('an unresolved negative id never makes an API request', async () => {
  let requests = 0;
  const result = await resolveIssueFocus({
    issueId: -42,
    state: state(),
    api: { issue: async () => { requests += 1; } },
  });
  assert.equal(result.source, 'unavailable');
  assert.equal(result.issue, null);
  assert.equal(requests, 0);
});

test('order failures are reported while a saved issue still renders without an API request', async () => {
  let requests = 0;
  const failure = new Error('offline');
  const result = await resolveIssueFocus({
    issueId: 42,
    context: { kind: 'order', id: 'order-a' },
    state: state({ issues: { 42: issue(42) } }),
    catalog: { lists: [{ id: 'order-a', name: 'Order A', file: 'order_a.json' }] },
    loadOrder: async () => { throw failure; },
    api: { issue: async () => { requests += 1; } },
  });
  assert.equal(result.source, 'saved');
  assert.equal(result.contextStatus, 'stale');
  assert.equal(result.contextError, failure);
  assert.equal(requests, 0);
});

test('aborted order and API work is propagated', async () => {
  const controller = new AbortController();
  const error = new DOMException('Aborted', 'AbortError');
  await assert.rejects(resolveIssueFocus({
    issueId: 42,
    context: { kind: 'order', id: 'order-a' },
    state: state(),
    catalog: { lists: [{ id: 'order-a', name: 'Order A', file: 'order_a.json' }] },
    loadOrder: async () => { throw error; },
    signal: controller.signal,
  }), { name: 'AbortError' });
});

test('presentation derives shared facts without up-next or progress actions', () => {
  const futureMuDate = `${new Date().getFullYear() + 1}-09-01`;
  const shown = issuePresentation({
    ...issue(42, 'Shared facts'),
    number: '7',
    onSale: '2026-08-26T00:00:00Z',
    pageCount: 24,
    mu: futureMuDate,
    url: 'https://www.marvel.com/comics/issue/42/test',
    creators: [
      { name: 'Writer One', role: 'writer' },
      { name: 'Cover One', role: 'cover artist' },
      { name: 'Artist One', role: 'penciler' },
    ],
  }, {
    position: 2,
    total: 5,
    description: 'Held for this tab.',
  });
  assert.equal(shown.title, 'Shared facts');
  assert.equal(shown.byline, 'Test Series · Writer One & Artist One');
  assert.equal(shown.description, 'Held for this tab.');
  assert.deepEqual(shown.facts.map(({ key, value }) => [key, value]), [
    ['In Unlimited', `soon Scheduled ${futureMuDate}`],
    ['Pages', '24'],
    ['Released', '2026-08-26'],
    ['Position', '2 of 5'],
  ]);
  assert.equal(shown.launchable, true);
  assert.equal(shown.detailUrl, 'https://www.marvel.com/comics/issue/42/test');
  assert.equal('done' in shown, false);
  assert.equal('upNext' in shown, false);
});

test('the dedicated view has one heading and distinct Read, synopsis, and Info actions', () => {
  const html = read('src/index.html');
  const view = html.match(/<section id="view-issue"[\s\S]*?<\/section>\s*<\/section>/)?.[0] ?? '';
  assert.match(view, /aria-labelledby="issue-focus-h"/);
  assert.match(view, /<h1 id="issue-focus-h">Issue details<\/h1>/);
  assert.match(view, /id="btn-issue-read"/);
  assert.match(view, /id="btn-issue-synopsis"/);
  assert.match(view, /id="btn-issue-info"[^>]*target="_blank"/);
  assert.equal((view.match(/<h1/g) ?? []).length, 1);
});

test('an issue route branches before list adoption and never calls setActive', () => {
  const main = read('src/js/main.js');
  const branch = main.slice(main.indexOf('function applyRoute'), main.indexOf('if (route.listId'));
  assert.match(branch, /route\.view === 'issue'/);
  assert.match(branch, /showView\('issue'/);
  assert.doesNotMatch(branch, /setActive|store\.update/);
});

test('every issue-bearing surface uses the shared focus route without replacing Read or Add', () => {
  const main = read('src/js/main.js');
  const shelf = main.slice(main.indexOf('function renderShelf'), main.indexOf('// Rows are kept'));
  assert.match(shelf, /surface: 'coming'/);
  assert.match(shelf, /class: 'tile-read'/);
  assert.match(shelf, /openInReader\(it, e\)/);

  const preview = main.slice(main.indexOf('async function loadPreviewIssues'), main.indexOf('function setFilter'));
  assert.match(preview, /kind: 'order', id: list\.id/);
  assert.match(preview, /surface: 'preview'/);

  const rows = main.slice(main.indexOf('function renderRows'), main.indexOf('function openInReader'));
  assert.match(rows, /surface: 'full-order'/);
  assert.match(rows, /kind: 'list', id/);
  assert.match(rows, /control: 'cover'/);
  assert.match(rows, /control: 'title'/);
  assert.match(rows, /openInReader\(item, e\)/);

  const search = main.slice(main.indexOf('function renderResults'), main.indexOf('function ensureList'));
  assert.match(search, /surface: 'search'/);
  assert.match(search, /btn\.addEventListener\('click'/);

  const library = read('src/js/views/library.js');
  assert.match(library, /view\.value === 'library-read'/);
  assert.match(library, /surface: 'everything-read'/);
  assert.doesNotMatch(library, /kind: 'list'/);
});

test('same-tab focus navigation stores an ephemeral opener and pushes exactly one destination', () => {
  const main = read('src/js/main.js');
  const navigate = main.slice(main.indexOf('function openIssueFocus'), main.indexOf('function issueFocusAnchor'));
  assert.match(navigate, /history\.replaceState\(\{ \.\.\.current, issueFocusOpener: opener \}/);
  assert.match(navigate, /history\.pushState\(null, '', href\)/);
  assert.doesNotMatch(navigate, /localStorage|store\.update/);
  const restore = main.slice(main.indexOf('async function restoreIssueFocusOpener'), main.indexOf('function loadBundledOrder'));
  assert.match(restore, /target\.focus\(\{ preventScroll: true \}\)/);
  assert.match(restore, /focusViewHeading\(view\)/);
  const sync = main.slice(main.indexOf('function syncHash'), main.indexOf('function endFilterRun'));
  assert.match(sync, /delete current\.issueFocusOpener/);
  assert.match(sync, /history\.replaceState\(Object\.keys\(current\)\.length \? current : null/);
});

test('leaving issue focus cancels pending detail and synopsis work', () => {
  const main = read('src/js/main.js');
  const show = main.slice(main.indexOf('function showView'), main.indexOf('function railParentView'));
  assert.match(show, /next !== 'issue' && view === 'issue'/);
  assert.match(show, /issueView\.cancel\(\)/);
  assert.match(show, /synopsisRunner\.cancel\(\)/);
});

test('issue focus repaints dynamic breadcrumbs only after context validation', () => {
  const main = read('src/js/main.js');
  const construction = main.slice(main.indexOf('const issueView = createIssueView'), main.indexOf('const progressView'));
  assert.match(construction, /result\.contextStatus === 'valid' && result\.context\?\.kind === 'order'/);
  assert.match(construction, /catalogListShelf\(catalog\?\.lists, result\.context\.id\)/);
  assert.match(construction, /renderBreadcrumbs,/);
  const issueView = read('src/js/views/issue.js');
  assert.ok((issueView.match(/renderBreadcrumbs\(\)/g) ?? []).length >= 2);
});
