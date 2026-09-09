import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createIssueView } from '../src/js/views/issue.js';
import { ApiError } from '../src/js/api.js';
import { createSynopsisDisclosure } from '../src/js/lib/synopsisDisclosure.js';

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
    focus() { this.ownerDocument.activeElement = this; },
    getClientRects() { return this.hidden || this.viewHidden ? [] : [{}]; },
  };
}

function harness({
  apiIssue, state, synopsis = null, loadCatalog, loadOrder,
  disclosure = createSynopsisDisclosure(), onStartSynopsis,
  readerPresentation, onReaderContext,
} = {}) {
  const nodes = {
    background: node(),
    byline: node(),
    cancelSynopsis: node(),
    card: node(),
    context: node(),
    description: node(),
    disclosure: node(),
    facts: node(),
    fallback: node(),
    heading: node(),
    image: node(),
    info: node('Info'),
    note: node(),
    number: node(),
    read: node(),
    retry: node(),
    series: node(),
    status: node(),
    synopsis: node(),
    synopsisStatus: node(),
  };
  const document = { activeElement: null };
  for (const value of Object.values(nodes)) value.ownerDocument = document;
  nodes.retry.hidden = true;
  nodes.description.id = 'issue-focus-desc';
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
    getSynopsis: (id) => typeof synopsis === 'function' ? synopsis(id) : synopsis,
    isSynopsisActive: () => synopsisActive,
    loadCatalog: loadCatalog ?? (async () => ({ lists: [] })),
    loadOrder: loadOrder ?? (async () => ({ items: [] })),
    onCancelSynopsis: () => { calls.cancelSynopsis += 1; },
    onRead: (...args) => calls.read.push(args),
    onReaderContext,
    readerPresentation,
    onStaleContext: (route) => calls.stale.push(route),
    onStartSynopsis: onStartSynopsis ?? (() => { calls.startSynopsis += 1; }),
    paintBackground: () => {},
    paintCover: () => { calls.covers += 1; },
    renderBreadcrumbs: () => { calls.breadcrumbs += 1; },
    seriesOnly: (name) => name.replace(/\s+\(.*/, ''),
    synopsisFallback: (_issue, entry) => entry ?? 'No synopsis.',
    synopsisDisclosure: disclosure,
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

test('445 a mode reset during explicit fetching keeps returned text without reviving old reveal choices', async () => {
  let hiding = true;
  let text = null;
  let finish;
  const disclosure = createSynopsisDisclosure({ hiding: () => hiding });
  const h = harness({
    apiIssue: async () => issue(),
    synopsis: () => text,
    disclosure,
    onStartSynopsis: () => new Promise((resolve) => { finish = resolve; }),
  });
  h.view.wire();
  await h.view.render({ issueId: 42 });
  const pending = h.nodes.synopsis.listeners.click();
  hiding = false;
  disclosure.clear();
  hiding = true;
  disclosure.clear();
  text = 'Newly fetched synthetic plot';
  finish(true);
  await pending;
  assert.equal(disclosure.isRevealed(42), false);
  assert.equal(h.nodes.description.textContent, '');
  hiding = false;
  disclosure.clear();
  h.view.refreshDescription();
  assert.equal(h.nodes.description.textContent, text);
  assert.equal(h.nodes.disclosure.hidden, true);
  assert.equal(h.calls.cancelSynopsis, 0);
});

test('445 unchanged mode preserves explicit fetching and refresh never fetches or changes identity', async () => {
  let hiding = true;
  const disclosure = createSynopsisDisclosure({ hiding: () => hiding });
  const h = harness({
    apiIssue: async () => issue(),
    synopsis: 'Held synthetic plot',
    disclosure,
    onStartSynopsis: async () => true,
  });
  await h.view.render({ issueId: 42 });
  h.view.wire();
  await h.nodes.synopsis.listeners.click();
  assert.equal(disclosure.isRevealed(42), true);
  hiding = false;
  disclosure.clear();
  h.nodes.disclosure.focus();
  h.view.refreshDescription();
  assert.equal(h.nodes.disclosure.ownerDocument.activeElement, h.nodes.heading);
  assert.equal(h.view.result().issue.issueId, 42);
  assert.equal(h.nodes.description.textContent, 'Held synthetic plot');
  assert.equal(h.calls.startSynopsis, 0);
});

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
  assert.equal(h.nodes.description.textContent, '');
  assert.equal(h.nodes.description.hidden, true);
  assert.equal(h.nodes.disclosure.attributes['aria-expanded'], 'false');
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
  assert.deepEqual(h.calls.read, [[h.view.result().issue, event, 'saved']]);
  assert.equal(h.calls.startSynopsis, 1);
  assert.equal(h.calls.cancelSynopsis, 1);
});

test('453 reader refresh preserves facts and disclosure and reports explicit result lifecycle', async () => {
  const saved = { ...issue(-8), digitalId: null, url: null };
  const state = { issues: { '-8': saved }, lists: {}, read: {}, overrides: {}, notes: {} };
  let temporary = false;
  const contexts = [];
  const h = harness({
    state, synopsis: 'Synthetic hidden description',
    onReaderContext: (result) => contexts.push(result),
    readerPresentation: (base, source) => {
      assert.equal(base.issueId, saved.issueId);
      assert.equal(base.digitalId, null);
      assert.equal(source, 'saved');
      return { launchable: temporary, temporary };
    },
  });
  h.view.wire();
  await h.view.render({ issueId: -8 });
  assert.equal(contexts[0], null, 'loading clears editor context');
  assert.equal(contexts.at(-1).source, 'saved');
  assert.equal(h.nodes.read.hidden, true);
  const facts = h.nodes.facts.children;
  const info = h.nodes.info.href;
  temporary = true;
  h.view.refreshReader();
  assert.equal(h.nodes.read.hidden, false);
  assert.equal(h.nodes.read.textContent, 'Read with temporary link');
  assert.equal(h.nodes.facts.children, facts);
  assert.equal(h.nodes.info.href, info);
  assert.equal(h.nodes.description.textContent, '');
  h.nodes.read.listeners.click({});
  assert.equal(h.calls.read[0][2], 'saved');
  assert.equal(saved.digitalId, null);
  h.nodes.read.focus();
  temporary = false;
  h.view.refreshReader();
  assert.equal(h.nodes.read.ownerDocument.activeElement, h.nodes.heading, 'disappearing Read rescues focus');
  temporary = true;
  h.view.refreshReader();
  h.nodes.info.focus();
  temporary = false;
  h.view.refreshReader();
  assert.equal(h.nodes.info.ownerDocument.activeElement, h.nodes.info, 'unrelated focus is preserved');
  temporary = true;
  h.view.refreshReader();
  h.nodes.read.focus();
  h.nodes.read.viewHidden = true;
  temporary = false;
  h.view.refreshReader();
  assert.equal(h.nodes.read.ownerDocument.activeElement, h.nodes.read, 'a hidden view does not redirect focus');
  h.view.cancel();
  assert.equal(contexts.at(-1), null, 'leaving clears editor without inventing unavailable provenance');
});

test('447 Issue Details hides fetched prose until explicit reveal and retains only exact-issue choices', async () => {
  const disclosure = createSynopsisDisclosure();
  const state = {
    issues: { 42: issue(), 43: issue(43) }, lists: {},
    read: { 42: 123 }, notes: { 42: 'Keep this note' }, overrides: {},
  };
  const before = structuredClone(state);
  const h = harness({ state, synopsis: (id) => `Synthetic description ${id}.`, disclosure });
  h.view.wire();
  await h.view.render({ issueId: 42, context: null });
  assert.equal(h.nodes.description.textContent, '', 'already-read descriptions also start empty');
  assert.equal(h.nodes.description.hidden, true);
  assert.equal(h.nodes.disclosure.hidden, false);
  assert.equal(h.nodes.synopsis.hidden, true, 'held prose needs no duplicate fetch consent');
  assert.equal(h.nodes.disclosure.attributes['aria-controls'], 'issue-focus-desc');
  assert.match(h.nodes.disclosure.attributes['aria-label'], /Reveal description.*may contain spoilers.*Issue title/);
  h.nodes.disclosure.focus();
  h.nodes.disclosure.listeners.click();
  assert.equal(h.nodes.description.textContent, 'Synthetic description 42.');
  assert.equal(h.nodes.description.hidden, false);
  assert.equal(h.nodes.disclosure.attributes['aria-expanded'], 'true');
  assert.equal(h.nodes.disclosure.ownerDocument.activeElement, h.nodes.disclosure);
  await h.view.render({ issueId: 43, context: null });
  assert.equal(h.nodes.description.textContent, '', 'reveal never propagates to another issue');
  await h.view.render({ issueId: 42, context: null });
  assert.equal(h.nodes.description.textContent, 'Synthetic description 42.', 'revisit remembers the exact issue');
  h.nodes.disclosure.listeners.click();
  assert.equal(h.nodes.description.textContent, '');
  assert.equal(h.nodes.disclosure.attributes['aria-expanded'], 'false');
  assert.deepEqual(state, before, 'disclosure changes neither read flags nor notes');
  assert.deepEqual(h.calls.read, []);
  assert.equal(h.calls.startSynopsis, 0);
  h.nodes.disclosure.listeners.click();
  h.view.cancel();
  assert.equal(h.nodes.description.textContent, '', 'leaving clears dormant DOM but not the choice');
  assert.equal(disclosure.isRevealed(42), true);
  disclosure.clear();
  h.view.resetSynopsis();
  assert.equal(h.nodes.description.textContent, '', 'reset clears dormant prose with no current result');
  await h.view.render({ issueId: 42, context: null });
  assert.equal(h.nodes.description.textContent, '', 'source reset discards old choices');
});

test('447 untracked fetched descriptions start collapsed and missing messages stay visible', async () => {
  const h = harness({ apiIssue: async () => issue(), synopsis: 'An authored untracked fixture.' });
  h.view.wire();
  await h.view.render({ issueId: 42, context: null });
  assert.equal(h.nodes.description.hidden, true);
  assert.equal(h.nodes.description.textContent, '');
  assert.equal(h.nodes.read.hidden, false);
  const missing = harness({ apiIssue: async () => issue() });
  await missing.view.render({ issueId: 42, context: null });
  assert.equal(missing.nodes.description.hidden, false);
  assert.equal(missing.nodes.description.textContent, 'No synopsis.');
  assert.equal(missing.nodes.disclosure.hidden, true);
});

test('447 individual fetch reveals once while cancelled, reset and obsolete continuations cannot reveal', async () => {
  for (const departure of ['success', 'decline', 'stop', 'reset', 'navigate-back', 'restart']) {
    const pending = [];
    let text = null;
    const h = harness({
      apiIssue: async () => issue(),
      synopsis: () => text,
      onStartSynopsis: (isCurrent) => new Promise((resolve) => pending.push({ isCurrent, resolve })),
    });
    h.view.wire();
    await h.view.render({ issueId: 42, context: null });
    const first = h.nodes.synopsis.listeners.click();
    assert.equal(pending[0].isCurrent(), true);
    if (departure === 'stop' || departure === 'restart') h.nodes.cancelSynopsis.listeners.click();
    if (departure === 'reset') h.view.resetSynopsis();
    if (departure === 'navigate-back') {
      h.view.cancel();
      await h.view.render({ issueId: 42, context: null });
    }
    let second;
    if (departure === 'restart') second = h.nodes.synopsis.listeners.click();
    text = 'Synthetic individual result.';
    pending[0].resolve(departure !== 'decline');
    await first;
    assert.equal(h.nodes.description.textContent === text, departure === 'success', departure);
    if (second) {
      assert.equal(pending[0].isCurrent(), false);
      assert.equal(pending[1].isCurrent(), true, 'old completion cannot invalidate its replacement');
      pending[1].resolve(true);
      await second;
      assert.equal(h.nodes.description.textContent, text);
    }
  }
});

test('447 synopsis completion moves only disappearing fetch controls to the disclosure or fallback', async () => {
  let text = null;
  const h = harness({ apiIssue: async () => issue(), synopsis: () => text });
  h.view.wire();
  await h.view.render({ issueId: 42, context: null });
  h.nodes.synopsis.focus();
  h.setSynopsisActive(true);
  h.view.repaintSynopsis({ text: 'Fetching.' });
  assert.equal(h.nodes.synopsis.ownerDocument.activeElement, h.nodes.cancelSynopsis);
  text = 'Synthetic focus fixture.';
  h.setSynopsisActive(false);
  h.view.repaintSynopsis({ text: 'Finished.' });
  assert.equal(h.nodes.synopsis.ownerDocument.activeElement, h.nodes.disclosure);
  h.nodes.read.focus();
  h.view.repaintSynopsis({ text: 'Finished.' });
  assert.equal(h.nodes.synopsis.ownerDocument.activeElement, h.nodes.read, 'unrelated focus stays put');
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

test('Issue view offers in-place Retry for a transient positive lookup failure', async () => {
  const h = harness({ apiIssue: async () => { throw new TypeError('offline'); } });
  await h.view.render({ view: 'issue', issueId: 42, context: null });

  assert.equal(h.view.result().source, 'unavailable');
  assert.equal(h.nodes.heading.textContent, 'Issue unavailable');
  assert.equal(h.nodes.card.hidden, true);
  assert.match(h.nodes.status.textContent, /could not be loaded/);
  assert.equal(h.calls.breadcrumbs, 1);
  assert.equal(h.nodes.retry.hidden, false);
  assert.equal(h.nodes.retry.textContent, 'Retry');
});

test('Retry keeps the exact issue and valid context, blocks duplicates, and restores focused details', async () => {
  const requested = [];
  let finish;
  const state = {
    issues: {}, lists: { a: { name: 'List A', itemIds: [42] } },
    activeListId: 'a', read: { 42: 123 }, notes: { 42: 'Keep this' }, overrides: {},
  };
  const before = structuredClone(state);
  const h = harness({
    state,
    apiIssue: (id) => {
      requested.push(id);
      if (requested.length === 1) throw new ApiError('Busy', 503, true);
      return new Promise((resolve) => { finish = resolve; });
    },
  });
  h.view.wire();
  await h.view.render({ issueId: 42, context: { kind: 'list', id: 'a' } });
  h.nodes.retry.focus();
  const retry = h.nodes.retry.listeners.click();
  h.nodes.retry.listeners.click();
  assert.deepEqual(requested, [42, 42]);
  assert.equal(h.nodes.retry.hidden, false);
  assert.equal(h.nodes.retry.attributes['aria-disabled'], 'true');
  assert.equal(h.nodes.retry.attributes['aria-busy'], 'true');
  assert.equal(h.nodes.retry.textContent, 'Retrying…');
  finish(issue());
  await retry;
  assert.equal(h.nodes.heading.textContent, 'Issue title');
  assert.equal(h.nodes.heading.ownerDocument.activeElement, h.nodes.heading);
  assert.equal(h.nodes.retry.hidden, true);
  assert.equal(h.nodes.note.textContent, 'Keep this');
  assert.equal(h.view.result().context.id, 'a');
  assert.deepEqual(state, before);
});

test('Repeated failure keeps Retry focused and discards invalid context before retrying', async () => {
  let requests = 0;
  const h = harness({ apiIssue: async () => { requests += 1; throw new TypeError('offline'); } });
  h.view.wire();
  await h.view.render({ issueId: 42, context: { kind: 'list', id: 'missing' } });
  h.nodes.retry.focus();
  await h.nodes.retry.listeners.click();
  assert.equal(requests, 2);
  assert.equal(h.nodes.retry.hidden, false);
  assert.equal(h.nodes.retry.attributes['aria-disabled'], undefined);
  assert.equal(h.nodes.retry.ownerDocument.activeElement, h.nodes.retry);
  assert.equal(h.view.result().context, null);
  assert.equal(h.view.result().contextStatus, 'none');
  assert.equal(h.calls.stale.length, 1);
});

test('Only recoverable API failures offer Retry; local-only identities never request it', async () => {
  for (const [issueId, error, retryable, message] of [
    [42, new ApiError('Busy', 429, true), true, /try again/],
    [42, new ApiError('Timeout', 408, false), true, /try again/],
    [42, new ApiError('Missing', 404, false), false, /has no details/],
    [42, new ApiError('Gone', 410, false), false, /has no details/],
    [42, new ApiError('Forbidden', 403, false), false, /could not be loaded/],
    [42, new SyntaxError('Malformed JSON'), false, /could not be loaded/],
    [42, null, false, /could not be loaded/],
    [-42, new TypeError('offline'), false, /local issue is no longer/],
  ]) {
    let requests = 0;
    const h = harness({ apiIssue: async () => {
      requests += 1;
      if (error) throw error;
      return null;
    } });
    h.view.wire();
    await h.view.render({ issueId });
    assert.equal(h.nodes.retry.hidden, !retryable);
    assert.match(h.nodes.status.textContent, message);
    assert.equal(requests, issueId > 0 ? 1 : 0);
    if (!retryable) {
      await h.nodes.retry.listeners.click();
      assert.equal(requests, issueId > 0 ? 1 : 0);
    }
  }
});

test('Navigation aborts Retry and a late result cannot replace the newer issue', async () => {
  let finish;
  let signal;
  let requests = 0;
  const h = harness({ apiIssue: async (id, opts) => {
    if (id === 7) return issue(7);
    requests += 1;
    if (requests === 1) throw new TypeError('offline');
    signal = opts.signal;
    return new Promise((resolve) => { finish = resolve; });
  } });
  h.view.wire();
  await h.view.render({ issueId: 42 });
  const pending = h.nodes.retry.listeners.click();
  h.view.cancel();
  await h.view.render({ issueId: 7 });
  finish(issue(42));
  await pending;
  assert.equal(signal.aborted, true);
  assert.equal(h.view.result().issue.issueId, 7);
  assert.equal(h.nodes.retry.hidden, true);
});

test('Cancelled catalog work cannot start an API lookup after navigation', async () => {
  let finish;
  const h = harness({
    loadCatalog: () => new Promise((resolve) => { finish = resolve; }),
    apiIssue: () => assert.fail('cancelled route must not request metadata'),
  });
  const pending = h.view.render({ issueId: 42, context: { kind: 'order', id: 'order-a' } });
  h.view.cancel();
  finish({ lists: [] });
  await pending;
  assert.equal(h.view.result(), null);
});

test('Retry completion does not steal focus after the reader moves elsewhere', async () => {
  let requests = 0;
  const h = harness({ apiIssue: async () => {
    if (++requests === 1) throw new TypeError('offline');
    return issue();
  } });
  h.view.wire();
  await h.view.render({ issueId: 42 });
  h.nodes.retry.focus();
  const pending = h.nodes.retry.listeners.click();
  h.nodes.info.focus();
  await pending;
  assert.equal(h.nodes.info.ownerDocument.activeElement, h.nodes.info);
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

  const route = main.slice(main.indexOf('function applyRoute'), main.indexOf('function showView'));
  assert.match(route, /issueRoute = route;/);
  assert.match(route, /showView\('issue'/);
  const navigation = main.slice(main.indexOf('function openIssueFocus'), main.indexOf('function issueFocusAnchor'));
  assert.match(navigation, /history\.replaceState/);
  assert.match(navigation, /history\.pushState/);
  assert.match(main, /const store = new Store\(\{/);
  assert.match(main, /const synopsisRunner = new SynopsisRunner\(\{/);
});
