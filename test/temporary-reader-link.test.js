import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createTemporaryReaderLinks,
  originalReaderDescription,
  parseTemporaryReaderLink,
  readerLinkReport,
  REPORT_LINK,
  savedReaderIssue,
} from '../src/js/lib/temporaryReaderLink.js';
import { createReaderLinkView } from '../src/js/views/reader-link.js';
import { isLaunchable, launchUrl } from '../src/js/reader.js';
import { readerIssueId } from '../src/js/lib/markdown.js';
import { exportBackup } from '../src/js/lib/model.js';

function fixture() {
  return {
    schemaVersion: 2,
    issues: {
      7: { issueId: 7, title: 'Fixture comic #1', digitalId: 11, url: 'https://www.marvel.com/comics/issue/7/' },
      '-8': { issueId: -8, title: 'Manual fixture #2', digitalId: null },
    },
    read: { 7: 123 },
    overrides: { 7: 'unavailable' },
    notes: { 7: 'Private note must not enter a report' },
    lists: { a: { id: 'a', itemIds: [7, -8], name: 'Private list' }, b: { id: 'b', itemIds: [7], name: 'Second list' } },
    listOrder: ['a', 'b'],
    active: 'a',
  };
}

function node(id, ownerDocument) {
  const handlers = new Map();
  const attributes = new Map();
  return {
    id,
    ownerDocument,
    children: [],
    hidden: false,
    disabled: false,
    isConnected: true,
    value: '',
    textContent: '',
    focus() { ownerDocument.activeElement = this; },
    contains(target) { return this === target || this.children.some((child) => child.contains(target)); },
    setAttribute(key, value) { attributes.set(key, String(value)); },
    getAttribute(key) { return attributes.get(key) ?? null; },
    removeAttribute(key) { attributes.delete(key); },
    addEventListener(type, handler) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(handler);
    },
    removeEventListener(type, handler) { handlers.get(type)?.delete(handler); },
    fire(type, extra = {}) {
      const event = {
        prevented: false,
        stopped: false,
        preventDefault() { this.prevented = true; },
        stopPropagation() { this.stopped = true; },
        ...extra,
      };
      for (const handler of handlers.get(type) ?? []) handler(event);
      return event;
    },
  };
}

function harness() {
  let state = fixture();
  const doc = { activeElement: null };
  const nodes = Object.fromEntries([
    'root', 'summary', 'edit', 'form', 'label', 'input', 'preview', 'error',
    'apply', 'cancel', 'revert', 'status', 'reportToggle', 'reportPanel',
    'reportText', 'reportStatus', 'regenerate', 'reportLink', 'reportDisclosure',
  ].map((key) => [key, node(`test-${key}`, doc)]));
  nodes.form.children = [nodes.input, nodes.apply, nodes.cancel];
  nodes.reportPanel.children = [nodes.reportText, nodes.regenerate, nodes.reportLink];
  const links = createTemporaryReaderLinks();
  const messages = [];
  let changes = 0;
  let fallback = 0;
  const view = createReaderLinkView({
    elements: () => nodes,
    getState: () => state,
    links,
    announce: (message) => messages.push(message),
    onChange: () => { changes += 1; },
    focusFallback: () => { fallback += 1; },
  });
  view.wire();
  view.show(7);
  return {
    nodes, links, messages, view, doc,
    state: () => state,
    replace: (next) => { state = next; },
    changes: () => changes,
    fallback: () => fallback,
    paste(value) {
      nodes.input.value = value;
      nodes.input.fire('input');
    },
  };
}

test('temporary reader URLs normalize only complete numeric book segments', () => {
  for (const value of [
    'https://read.marvel.com/#/book/22',
    ' http://READ.MARVEL.COM:80/#/book/00022/4?view=page ',
    'https://read.marvel.com:443/?private=discarded#/book/22/page/4',
  ]) {
    assert.deepEqual(parseTemporaryReaderLink(value), {
      ok: true, digitalId: 22, url: 'https://read.marvel.com/#/book/22',
    });
  }
  for (const value of [
    '', null, {}, 'https://read.marvel.com/#/book/0',
    'https://read.marvel.com/#/book/22abc', 'https://read.marvel.com/#/book/%32%32',
    'https://read.marvel.com/#/book/1234567890123',
    'https://read.marvel.com/#/book/0000000000022',
    'https://read.marvel.com:8443/#/book/22', 'https://read.marvel.com/other#/book/22',
    'https://user:password@read.marvel.com/#/book/22',
    'https://read.marvel.com.evil.example/#/book/22',
    'https://www.marvel.com/comics/issue/22/', '/#/book/22',
    'javascript:alert(1)', 'file://read.marvel.com/#/book/22',
    'https:\\\\read.marvel.com\\#/book/22', 'https://read.marvel.com/\n#/book/22',
    `https://read.marvel.com/?${'x'.repeat(500)}#/book/22`,
  ]) {
    const result = parseTemporaryReaderLink(value);
    assert.equal(result.ok, false, String(value));
    assert.equal(typeof result.error, 'string');
    assert.equal(Object.hasOwn(result, 'digitalId'), false);
  }
  assert.equal(parseTemporaryReaderLink('https://read.marvel.com/#/book/999999999999').ok, true);
});

test('temporary reader link drives current saved Read', () => {
  const state = fixture();
  const before = structuredClone(state);
  const backupBefore = exportBackup(state);
  const links = createTemporaryReaderLinks();
  assert.equal(links.use(state, 7, 'https://read.marvel.com/#/book/22').changed, true);
  assert.equal(links.use(state, '7', 'http://read.marvel.com/#/book/022/page').changed, false);
  const stale = state.issues[7];
  const updated = { ...state, issues: { ...state.issues, 7: { ...stale, digitalId: 33, title: 'Updated base title' } } };
  links.reconcile(updated);
  for (const source of ['saved', 'bundled', 'api']) {
    const result = links.resolve(updated, stale, { source });
    assert.equal(result.ok, true);
    assert.equal(result.issue.digitalId, 22);
    assert.equal(result.issue.title, 'Updated base title');
    assert.equal(result.temporary, true);
    assert.equal(new URL(launchUrl(result.issue, 'http://127.0.0.1:8787')).searchParams.get('d'), '22');
  }
  assert.equal(links.remove(updated, 7).changed, true);
  assert.equal(links.resolve(updated, stale, { source: 'saved' }).issue.digitalId, 33);
  assert.equal(links.remove(updated, 7).changed, false);
  assert.equal(links.use(state, -8, 'https://read.marvel.com/#/book/44').ok, true);
  const manual = links.resolve(state, state.issues[-8], { source: 'saved' });
  assert.equal(manual.issue.issueId, -8);
  assert.equal(isLaunchable(manual.issue), true);
  assert.equal(new URL(launchUrl(manual.issue, 'http://127.0.0.1:8787')).searchParams.has('i'), false);
  const readerOnly = readerIssueId(55);
  const withReaderOnly = {
    ...state, issues: { ...state.issues, [readerOnly]: { issueId: readerOnly, digitalId: 55, title: 'Reader-only fixture' } },
  };
  links.use(withReaderOnly, readerOnly, 'https://read.marvel.com/#/book/66');
  assert.equal(links.resolve(withReaderOnly, withReaderOnly.issues[readerOnly], { source: 'saved' }).issue.issueId, readerOnly);
  for (const id of [0, 9, '07', '7.0', {}, null, Symbol('invalid'), Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(savedReaderIssue(state, id), null);
    assert.equal(links.use(state, id, 'https://read.marvel.com/#/book/22').ok, false);
  }
  const missing = { ...state, issues: {}, lists: {} };
  assert.equal(links.resolve(missing, stale, { source: 'saved' }).ok, false);
  assert.equal(links.resolve(missing, stale, { source: 'bundled' }).issue, stale);
  const listedGap = { ...missing, lists: { current: { itemIds: [7] } } };
  assert.deepEqual(links.resolve(listedGap, stale, { source: 'saved' }), {
    ok: true, issue: { issueId: 7, title: 'Issue 7' }, temporary: false,
  }, 'current listed metadata gap uses fresh lookup placeholder without captured digitalId');
  assert.equal(links.use(listedGap, 7, 'https://read.marvel.com/#/book/22').ok, false);
  assert.equal(links.resolve({ ...listedGap, lists: {} }, stale, { source: 'saved' }).ok, false, 'removed captured target stays refused');
  assert.equal(links.resolve(state, stale).ok, false, 'missing provenance refuses rather than assuming saved');
  assert.equal(links.resolve(state, stale, { source: undefined }).ok, false);
  assert.equal(links.resolve(state, stale, { source: 'untrusted' }).ok, false);
  assert.deepEqual(state, before);
  const backupAfter = exportBackup(state);
  delete backupBefore.exportedAt;
  delete backupAfter.exportedAt;
  assert.deepEqual(backupAfter, backupBefore);
  assert.equal(JSON.stringify(backupAfter).includes('temporary'), false);
});

test('temporary memory retains valid bindings through unchanged outcomes and invalidates real replacements', () => {
  const links = createTemporaryReaderLinks();
  const state = fixture();
  links.use(state, 7, 'https://read.marvel.com/#/book/22');
  links.use(state, -8, 'https://read.marvel.com/#/book/44');
  const foreign = structuredClone(state);
  foreign.read[7] = 456;
  foreign.notes[7] = 'Changed elsewhere';
  foreign.overrides[7] = 'available';
  foreign.issues[7].digitalId = 99;
  assert.equal(links.reconcile(foreign, { changed: false }).removed, 0);
  assert.equal(links.get(foreign, 7), 22);
  assert.equal(links.get(foreign, -8), 44);
  assert.equal(links.reconcile(foreign, { changed: false }).removed, 0, 'known-unchanged failed operation');
  const mismatch = { ...foreign, issues: { ...foreign.issues, 7: { issueId: 9 } } };
  assert.equal(links.reconcile(mismatch).removed, 1);
  assert.equal(links.get(mismatch, 7), null);
  assert.equal(links.get(mismatch, -8), 44);
  assert.equal(links.reconcile(state, { changed: true }).removed, 1, 'actual same-looking replacement');
  links.use(state, 7, 'https://read.marvel.com/#/book/22');
  assert.equal(links.reconcile(state, { changed: null }).known, false);
  assert.equal(links.use(state, 7, 'https://read.marvel.com/#/book/22').ok, false);
  assert.equal(links.resolve(state, state.issues[7], { source: 'saved' }).ok, false);
  assert.equal(links.resolve(state, { issueId: 9 }, { source: 'saved' }).ok, false);
  assert.equal(links.resolve(state, { issueId: 9 }, { source: 'untrusted' }).ok, false);
  for (const source of ['bundled', 'api']) {
    assert.equal(links.resolve(state, null, { source }).ok, false);
    for (const issueId of [9, 7]) {
      const supplied = { issueId, title: 'Unsaved source comic', digitalId: 88 };
      const resolved = links.resolve(state, supplied, { source });
      assert.equal(resolved.ok, true, `${source} unsaved base ${issueId} remains readable`);
      assert.equal(resolved.issue, supplied, 'use supplied base, never the uncertain saved snapshot');
      assert.equal(resolved.temporary, false);
    }
  }
  assert.equal(links.remove(state, 7).ok, false);
  links.reconcile(state, { changed: false });
  assert.equal(links.use(state, 7, 'https://read.marvel.com/#/book/22').ok, true);
  assert.equal(createTemporaryReaderLinks().get(state, 7), null, 'a separate document has its own memory');
  assert.equal(links.clear(), 1);
  assert.equal(links.get(state, 7), null);
  assert.throws(() => links.reconcile(state, { changed: 'unknown' }), TypeError);
});

test('manual report opens a static project URL without private context', () => {
  const h = harness();
  assert.deepEqual(REPORT_LINK, {
    href: 'https://github.com/raymond-nassar/recap-page/issues/new?template=data-order.yml',
    target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer',
  });
  for (const [key, value] of Object.entries(REPORT_LINK)) assert.equal(h.nodes.reportLink.getAttribute(key), value);
  h.nodes.edit.fire('click');
  h.paste('https://read.marvel.com/?secret=discarded#/book/22/page/private');
  h.nodes.reportToggle.fire('click');
  assert.match(h.nodes.reportText.value, /Proposed reader link: Not supplied/);
  h.nodes.form.fire('submit');
  h.nodes.regenerate.fire('click');
  const report = h.nodes.reportText.value;
  assert.match(report, /Original reader link: https:\/\/read.marvel.com\/#\/book\/11/);
  assert.match(report, /Proposed reader link: https:\/\/read.marvel.com\/#\/book\/22/);
  assert.match(report, /Marvel comic ID: 7/);
  for (const secret of ['secret', 'discarded', 'page/private', 'Private note', 'Private list', 'Second list', '127.0.0.1']) {
    assert.equal(report.includes(secret), false, secret);
  }
  h.nodes.reportText.value = 'My manually reviewed report';
  h.view.refresh();
  assert.equal(h.nodes.reportText.value, 'My manually reviewed report');
  h.links.use(h.state(), 7, 'https://read.marvel.com/#/book/33');
  h.view.refresh();
  assert.match(h.nodes.reportStatus.textContent, /earlier context/);
  assert.equal(h.nodes.reportText.value, 'My manually reviewed report');
  assert.equal(h.nodes.reportLink.getAttribute('href'), REPORT_LINK.href);
  assert.equal(h.nodes.reportLink.fire('click').prevented, false, 'native external link, no submission handler');
  const manualReport = readerLinkReport(h.state().issues[-8], 44);
  assert.equal(manualReport.includes('-8'), false);
  assert.match(manualReport, /local manual\/reader-only entry/);
  assert.equal(originalReaderDescription({ issueId: -8, digitalId: 'not a book' }), 'No original reader reference');
  assert.match(readerLinkReport({ title: 'Fixture\ninjected line', issueId: 7, digitalId: null }), /^Comic: Fixture injected line\n/);
  for (const path of ['../src/js/lib/temporaryReaderLink.js', '../src/js/views/reader-link.js']) {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /\b(?:localStorage|sessionStorage|indexedDB|clipboard)\b|\bfetch\s*\(|window\.open|\.update\s*\(/);
  }
});

test('injected reader form retains invalid drafts and never saves or opens automatically', () => {
  const h = harness();
  const before = structuredClone(h.state());
  h.view.wire();
  h.nodes.edit.fire('click');
  assert.equal(h.doc.activeElement, h.nodes.input);
  assert.equal(h.nodes.form.hidden, false);
  h.paste('https://wrong.example/book/22');
  assert.equal(h.nodes.form.fire('submit').prevented, true);
  assert.equal(h.links.size, 0);
  assert.equal(h.nodes.form.hidden, false);
  assert.equal(h.nodes.input.getAttribute('aria-invalid'), 'true');
  assert.match(h.nodes.error.textContent, /read.marvel.com/);
  h.paste('http://read.marvel.com/#/book/022/5');
  assert.match(h.nodes.preview.textContent, /https:\/\/read.marvel.com\/#\/book\/22/);
  assert.equal(h.links.size, 0);
  h.nodes.form.fire('submit');
  assert.equal(h.links.get(h.state(), 7), 22);
  assert.equal(h.changes(), 1, 'wire is idempotent');
  assert.equal(h.nodes.form.hidden, true);
  assert.equal(h.doc.activeElement, h.nodes.edit);
  assert.match(h.nodes.status.textContent, /Nothing was saved/);
  h.nodes.edit.fire('click');
  h.paste('https://read.marvel.com/#/book/33');
  const escape = h.nodes.form.fire('keydown', { key: 'Escape' });
  assert.equal(escape.prevented, true);
  assert.equal(escape.stopped, true);
  assert.equal(h.links.get(h.state(), 7), 22);
  h.view.leave();
  h.view.show(7);
  assert.equal(h.links.get(h.state(), 7), 22);
  h.nodes.revert.fire('click');
  assert.equal(h.links.get(h.state(), 7), null);
  assert.equal(h.nodes.revert.hidden, true);
  h.view.show(-8);
  h.nodes.edit.fire('click');
  h.paste('https://read.marvel.com/#/book/44');
  h.nodes.form.fire('submit');
  assert.equal(h.links.resolve(h.state(), h.state().issues[-8], { source: 'saved' }).issue.digitalId, 44);
  assert.deepEqual(h.state(), before);
  assert.equal(h.nodes.reportPanel.hidden, true, 'applying does not open report details');
  h.view.destroy();
  h.nodes.edit.fire('click');
  assert.equal(h.nodes.form.hidden, true, 'destroy removes listeners without erasing active links');
  assert.equal(h.links.get(h.state(), -8), 44);
});

test('injected reader form reconciles outcomes without discarding unrelated temporary links', () => {
  const h = harness();
  h.links.use(h.state(), 7, 'https://read.marvel.com/#/book/22');
  h.nodes.edit.fire('click');
  h.paste('https://read.marvel.com/#/book/33');
  h.view.reconcile({ changed: false });
  assert.equal(h.nodes.apply.disabled, false, 'known-unchanged failed replacement preserves draft');
  assert.equal(h.links.get(h.state(), 7), 22);
  const foreign = structuredClone(h.state());
  foreign.read[7] = 999;
  h.replace(foreign);
  h.view.reconcile({ changed: false });
  assert.equal(h.links.get(h.state(), 7), 22, 'foreign progress retains binding');
  assert.equal(h.nodes.apply.disabled, true, 'new held record requires draft comparison again');
  h.nodes.form.fire('submit');
  assert.equal(h.links.get(h.state(), 7), 22);
  h.nodes.cancel.fire('click');
  h.nodes.edit.fire('click');
  h.paste('https://read.marvel.com/#/book/33');
  h.nodes.form.fire('submit');
  assert.equal(h.links.get(h.state(), 7), 33);
  h.nodes.edit.fire('click');
  h.view.reconcile({ changed: true });
  assert.equal(h.links.size, 0);
  assert.equal(h.nodes.form.hidden, true);
  assert.equal(h.doc.activeElement, h.nodes.edit);
  h.links.use(h.state(), 7, 'https://read.marvel.com/#/book/22');
  h.nodes.edit.fire('click');
  h.view.reconcile({ changed: null });
  assert.equal(h.links.known, false);
  assert.equal(h.nodes.edit.disabled, true);
  assert.equal(h.fallback(), 1);
  h.view.reconcile({ changed: false });
  h.nodes.edit.fire('click');
  h.paste('https://read.marvel.com/#/book/22');
  h.nodes.form.fire('submit');
  h.view.clearDocument();
  assert.equal(h.links.size, 0);
  assert.equal(h.nodes.reportPanel.hidden, true);
  h.replace({ ...h.state(), issues: {} });
  h.view.refresh();
  assert.equal(h.nodes.edit.disabled, true);
  h.nodes.edit.fire('click');
  assert.match(h.messages.at(-1), /matching saved comic/);
});
