import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createEmptyState,
  createList,
  addIssuesToList,
  markRead,
  setActive,
  setIssueNote,
  setListNote,
} from '../src/js/lib/model.js';
import { DEFAULT_FILTER, READING_FILTERS } from '../src/js/lib/readingFilters.js';
import {
  createReadingView,
  commitRows,
  rowCacheKey,
  detailsState,
  DETAILS_BADGE,
  synopsisFallback,
} from '../src/js/views/reading.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function classList(value = '') {
  const names = new Set(value.split(/\s+/).filter(Boolean));
  return {
    contains: (name) => names.has(name),
    toggle(name, force) {
      if (force ?? !names.has(name)) names.add(name);
      else names.delete(name);
    },
    toString: () => [...names].join(' '),
  };
}

function attach(parent, child) {
  if (child && typeof child === 'object') child.parentNode = parent;
  return child;
}

function walk(root, visit) {
  if (!root || typeof root !== 'object') return;
  visit(root);
  for (const child of root.childNodes ?? []) walk(child, visit);
}

function queryAll(root, selector) {
  const found = [];
  walk(root, (node) => {
    if (selector === 'summary' && node.tag === 'summary') found.push(node);
    if (selector === '#reading-filters' && node.id === 'reading-filters') found.push(node);
    if (selector === '.order-strip' && node.className.split(/\s+/).includes('order-strip')) found.push(node);
    if (selector === 'input[name="filter"]' && node.tag === 'input' && node.name === 'filter') found.push(node);
  });
  return found;
}

function queryOne(root, selector) {
  return queryAll(root, selector)[0] ?? null;
}

function node(props = {}, children = []) {
  const result = {
    attributes: {},
    childNodes: [],
    className: props.class ?? '',
    classList: classList(props.class ?? ''),
    dataset: { ...(props.dataset ?? {}) },
    disabled: props.disabled ?? false,
    hidden: props.hidden ?? false,
    id: props.id,
    isConnected: true,
    listeners: {},
    name: props.name,
    open: props.open ?? false,
    parentNode: null,
    role: props.role,
    style: { setProperty(name, value) { this[name] = value; } },
    tag: props.tag ?? 'div',
    textContent: props.text ?? '',
    type: props.type,
    value: props.value ?? '',
    checked: props.checked ?? false,
    addEventListener(name, listener) {
      this.listeners[name] ??= [];
      this.listeners[name].push(listener);
    },
    append(...next) {
      for (const child of next.flat()) this.childNodes.push(attach(this, child));
    },
    contains(target) {
      if (target === this) return true;
      return this.childNodes.some((child) => child?.contains?.(target));
    },
    fire(name, event = {}) {
      const [listener] = this.listeners[name] ?? [];
      if (!listener) return undefined;
      return listener(event);
    },
    focus(options) {
      if (globalThis.document) globalThis.document.activeElement = this;
      this.focused = options ?? true;
    },
    getAttribute(name) { return this.attributes[name]; },
    insertBefore(next, ref) {
      const child = attach(this, next);
      const existing = this.childNodes.indexOf(child);
      if (existing !== -1) this.childNodes.splice(existing, 1);
      const at = ref == null ? this.childNodes.length : this.childNodes.indexOf(ref);
      this.childNodes.splice(at === -1 ? this.childNodes.length : at, 0, child);
      return child;
    },
    querySelector(selector) { return queryOne(this, selector); },
    querySelectorAll(selector) { return queryAll(this, selector); },
    remove() {
      if (!this.parentNode) return;
      const at = this.parentNode.childNodes.indexOf(this);
      if (at !== -1) this.parentNode.childNodes.splice(at, 1);
      this.parentNode = null;
      this.isConnected = false;
    },
    removeAttribute(name) {
      delete this.attributes[name];
      delete this[name];
    },
    replaceChildren(...next) {
      this.childNodes = [];
      this.append(...next);
    },
    setAttribute(name, value) {
      this.attributes[name] = value;
      if (name === 'class') {
        this.className = value;
        this.classList = classList(value);
      }
    },
  };
  for (const [name, value] of Object.entries(props)) {
    if (name.startsWith('aria-')) result.attributes[name] = value;
  }
  result.append(...children);
  return result;
}

function element(tag, props = {}, children = []) {
  const out = node({ tag, ...props }, []);
  for (const [name, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (name === 'onclick') out.addEventListener('click', value);
    else if (name === 'style') {
      for (const [styleName, styleValue] of Object.entries(value)) out.style.setProperty(styleName, styleValue);
    } else if (!['class', 'dataset', 'hidden', 'id', 'name', 'open', 'role', 'tag', 'text', 'type', 'value', 'checked'].includes(name) && !name.startsWith('aria-')) {
      out[name] = value;
    }
  }
  out.append(...[].concat(children));
  return out;
}

function issue(issueId, title, extra = {}) {
  return {
    issueId,
    title,
    number: String(issueId),
    onSale: '2025-01-01',
    seriesName: 'Series (2025)',
    source: 'curated',
    hydrated: true,
    ...extra,
  };
}

function seededState() {
  let state = createEmptyState();
  state = createList(state, { id: 'list-a', name: 'List A', description: 'First list', catalogId: 'cat-a' });
  state = createList(state, { id: 'list-b', name: 'List B', description: 'Second list', catalogId: 'cat-b' });
  state = addIssuesToList(state, 'list-a', [
    issue(1, 'Issue One'),
    issue(2, 'Issue Two', { collectedIn: 'Trade One' }),
    issue(3, 'Issue Three', { hydrated: false, collectedIn: 'Trade One' }),
  ], {}).state;
  state = addIssuesToList(state, 'list-b', [
    issue(4, 'Issue Four'),
    issue(5, 'Issue Five'),
  ], {}).state;
  state = markRead(state, 1, true);
  state = setListNote(state, 'list-a', 'List note');
  state = setIssueNote(state, 2, 'Issue note');
  state = setActive(state, 'list-a');
  return state;
}

function installDate(isoText) {
  const RealDate = Date;
  const fixed = new RealDate(isoText);
  class FakeDate extends RealDate {
    constructor(...args) {
      super(...(args.length ? args : [fixed.getTime()]));
    }
    static now() { return fixed.getTime(); }
  }
  globalThis.Date = FakeDate;
  return () => { globalThis.Date = RealDate; };
}

function harness(overrides = {}) {
  let state = overrides.state ?? seededState();
  const settings = overrides.settings ?? { covers: true, filter: DEFAULT_FILTER };
  const calls = {
    announce: [],
    announceIfSaved: [],
    announceState: [],
    clearNotice: [],
    hydrate: [],
    issueFocus: [],
    launch: [],
    notify: [],
    paintBackground: 0,
    paintCover: 0,
    renderSaveEducation: 0,
    saveSettings: 0,
    showView: [],
    synopsis: [],
  };
  let writeFailures = 0;
  const nodes = {
    readingFilters: node({ id: 'reading-filters', tag: 'fieldset' }),
    saveEducationSettings: node({ id: 'save-education-settings', tag: 'button' }),
    fullSummary: node({ tag: 'summary' }),
    fullAction: node({ id: 'full-action' }),
    fullCount: node({ id: 'full-count' }),
    orderName: node({ id: 'order-name' }),
    orderSub: node({ id: 'order-sub' }),
    orderDesc: node({ id: 'order-desc', open: true }),
    orderDescText: node({ id: 'order-desc-text' }),
    listNote: node({ id: 'list-note' }),
    ringArc: node({ id: 'ring-arc' }),
    ringLabel: node({ id: 'ring-label' }),
    ringSub: node({ id: 'ring-sub' }),
    hero: node({ id: 'hero' }),
    allRead: node({ id: 'all-read', hidden: true }),
    shelfSec: node({ id: 'shelf-sec' }),
    shelfNote: node({ id: 'shelf-note' }),
    heroTitle: node({ id: 'hero-title' }),
    heroImg: node({ id: 'hero-img', tag: 'img' }),
    heroFb: node({ id: 'hero-fb' }),
    heroFs: node({ id: 'hero-fs' }),
    heroFn: node({ id: 'hero-fn' }),
    heroBg: node({ id: 'hero-bg' }),
    heroBy: node({ id: 'hero-by' }),
    heroDesc: node({ id: 'hero-desc' }),
    heroFacts: node({ id: 'hero-facts' }),
    btnHeroInfo: node({ id: 'btn-hero-info', text: 'Info', tag: 'a' }),
    btnHeroRead: node({ id: 'btn-hero-read', tag: 'button' }),
    btnHeroInspect: node({ id: 'btn-hero-inspect', tag: 'button' }),
    btnHeroDone: node({ id: 'btn-hero-done', tag: 'button' }),
    btnRenameList: node({ id: 'btn-rename-list', tag: 'button' }),
    btnListNote: node({ id: 'btn-list-note', tag: 'button' }),
    btnDeleteList: node({ id: 'btn-delete-list', tag: 'button' }),
    btnDuplicateList: node({ id: 'btn-duplicate-list', tag: 'button' }),
    btnExportMd: node({ id: 'btn-export-md', tag: 'button' }),
    btnHydrate: node({ id: 'btn-hydrate', tag: 'button' }),
    btnCancelHydrate: node({ id: 'btn-cancel-hydrate', tag: 'button' }),
    btnSynopsis: node({ id: 'btn-synopsis', tag: 'button' }),
    btnCancelSynopsis: node({ id: 'btn-cancel-synopsis', tag: 'button' }),
    readingBody: node({ id: 'reading-body' }),
    ringWrap: node({ id: 'ring-wrap' }),
    shelf: node({ id: 'shelf', tag: 'ul' }),
    rows: node({ id: 'rows', tag: 'ul' }),
    hydrationStatus: node({ id: 'hydration-status' }),
    synopsisStatus: node({ id: 'synopsis-status' }),
    allReadHeading: node({ id: 'all-read-h', tag: 'h2' }),
  };
  nodes.full = node({ id: 'full', tag: 'details', open: overrides.fullOpen ?? true }, [nodes.fullSummary, nodes.fullAction, nodes.fullCount, nodes.readingFilters]);

  const selectorMap = new Map([
    ['#reading-filters', nodes.readingFilters],
    ['#save-education-settings', nodes.saveEducationSettings],
    ['#full', nodes.full],
    ['#full > summary', nodes.fullSummary],
    ['#full-action', nodes.fullAction],
    ['#full-count', nodes.fullCount],
    ['#btn-rename-list', nodes.btnRenameList],
    ['#btn-list-note', nodes.btnListNote],
    ['#btn-delete-list', nodes.btnDeleteList],
    ['#btn-duplicate-list', nodes.btnDuplicateList],
    ['#btn-export-md', nodes.btnExportMd],
    ['#btn-hydrate', nodes.btnHydrate],
    ['#btn-cancel-hydrate', nodes.btnCancelHydrate],
    ['#btn-synopsis', nodes.btnSynopsis],
    ['#btn-cancel-synopsis', nodes.btnCancelSynopsis],
    ['#btn-hero-read', nodes.btnHeroRead],
    ['#btn-hero-inspect', nodes.btnHeroInspect],
    ['#btn-hero-done', nodes.btnHeroDone],
    ['#reading-body', nodes.readingBody],
    ['#ring-wrap', nodes.ringWrap],
    ['#order-name', nodes.orderName],
    ['#order-sub', nodes.orderSub],
    ['#order-desc', nodes.orderDesc],
    ['#order-desc-text', nodes.orderDescText],
    ['#list-note', nodes.listNote],
    ['#ring-arc', nodes.ringArc],
    ['#ring-label', nodes.ringLabel],
    ['#ring-sub', nodes.ringSub],
    ['#hero', nodes.hero],
    ['#all-read', nodes.allRead],
    ['#shelf-sec', nodes.shelfSec],
    ['#shelf-note', nodes.shelfNote],
    ['#hero-title', nodes.heroTitle],
    ['#hero-img', nodes.heroImg],
    ['#hero-fb', nodes.heroFb],
    ['#hero-fs', nodes.heroFs],
    ['#hero-fn', nodes.heroFn],
    ['#hero-bg', nodes.heroBg],
    ['#hero-by', nodes.heroBy],
    ['#hero-desc', nodes.heroDesc],
    ['#hero-facts', nodes.heroFacts],
    ['#btn-hero-info', nodes.btnHeroInfo],
    ['#shelf', nodes.shelf],
    ['#rows', nodes.rows],
    ['#hydration-status', nodes.hydrationStatus],
    ['#synopsis-status', nodes.synopsisStatus],
    ['#all-read-h', nodes.allReadHeading],
    ['dialog[open]', null],
  ]);

  const documentStub = {
    activeElement: null,
    listeners: {},
    createElement(tag) { return node({ tag }); },
    createTextNode(text) { return { text, textContent: text }; },
    addEventListener(name, listener) { this.listeners[name] = listener; },
    querySelector(selector) { return selectorMap.get(selector) ?? null; },
    querySelectorAll(selector) {
      if (selector === 'input[name="filter"]') return queryAll(nodes.readingFilters, selector);
      return [];
    },
  };

  const view = createReadingView({
    $: (selector) => documentStub.querySelector(selector),
    activeListId: () => state.active,
    announce: (msg) => calls.announce.push(msg),
    announceIfSaved: (msg) => calls.announceIfSaved.push(msg),
    announceState: (name, value, msg) => calls.announceState.push({ name, value, msg }),
    askConfirm: overrides.askConfirm ?? (async () => true),
    askNote: overrides.askNote ?? (async () => null),
    askText: overrides.askText ?? (async () => null),
    clearNotice: (key) => calls.clearNotice.push(key),
    detailUrl: (item) => item.url ?? `https://example.test/${item.issueId}`,
    el: element,
    fact: (key, value, className) => ({ key, value, className }),
    getSettings: () => settings,
    getState: () => state,
    getSynopsis: overrides.getSynopsis ?? (() => null),
    hydrationAnnouncement: (status) => ({ state: status?.phase ?? 'idle', msg: status?.phase ?? null }),
    isCurrent: overrides.isCurrent ?? (() => true),
    isHydrationActive: overrides.isHydrationActive ?? (() => false),
    isSynopsisActive: overrides.isSynopsisActive ?? (() => false),
    issueFocusAnchor: (item, options) => element('a', {
      class: options.className,
      dataset: {
        focusSource: options.surface,
        issueId: String(item.issueId),
        contextId: options.context?.id ?? '',
        focusControl: options.control ?? '',
      },
    }, options.children),
    launch: (...args) => calls.launch.push(args),
    noSynopsisMarker: Symbol('no-synopsis'),
    notify: (selector, msg, kind, key, action, dismiss) => {
      calls.notify.push({ selector, msg, kind, key, action, dismiss });
    },
    onCancelHydrate: () => calls.hydrate.push('cancel'),
    onCancelSynopsis: () => calls.synopsis.push('cancel'),
    onExportMarkdown: () => calls.showView.push({ export: true }),
    onHydrate: (listId) => calls.hydrate.push(listId),
    onStartSynopsis: () => calls.synopsis.push('start'),
    openIssueFocus: (...args) => calls.issueFocus.push(args),
    paintCover: () => { calls.paintCover += 1; },
    paintHeroBackground: () => { calls.paintBackground += 1; },
    preservingFocus: (_container, fn) => fn(),
    recordDirectProgressSave: overrides.recordDirectProgressSave ?? (() => ({ kind: 'saved' })),
    renderSaveEducation: () => { calls.renderSaveEducation += 1; },
    saveSettings: () => { calls.saveSettings += 1; },
    seriesOnly: (name) => name?.replace(/\s+\(.*/, '') ?? '',
    shortTitle: (title) => title,
    showView: (name, opts) => calls.showView.push({ name, opts }),
    syncHash: (opts) => calls.showView.push({ sync: opts ?? {} }),
    synopsisAnnouncement: (status) => ({ state: status?.phase ?? 'idle', msg: status?.phase ?? null }),
    synopsisStatusLine: (status) => status ? `${status.phase}:${status.done ?? 0}/${status.total ?? 0}` : '',
    updateState: (updater) => {
      if (writeFailures > 0) {
        writeFailures -= 1;
        return { ok: false, state };
      }
      state = updater(state);
      return { ok: true, state };
    },
    withSaveEducation: (msg) => msg,
    ymd: (value) => (typeof value === 'string' ? value.slice(0, 10) : ''),
  });

  globalThis.document = documentStub;
  return {
    calls,
    nodes,
    settings,
    setActive(listId) { state = setActive(state, listId); },
    setWriteFailures(count) { writeFailures = count; },
    state: () => state,
    view,
    restore() { delete globalThis.document; },
  };
}

test('reading view exports helpers and keeps forbidden dependencies out of the module', () => {
  assert.equal(typeof createReadingView, 'function');
  assert.equal(typeof commitRows, 'function');
  assert.equal(typeof rowCacheKey, 'function');
  assert.equal(typeof detailsState, 'function');
  assert.equal(typeof synopsisFallback, 'function');
  assert.equal(typeof DETAILS_BADGE.pending.hint, 'string');

  const main = readFileSync(join(ROOT, 'src/js/main.js'), 'utf8');
  const source = readFileSync(join(ROOT, 'src/js/views/reading.js'), 'utf8');
  assert.match(main, /const readingView = createReadingView\(\{/);
  assert.doesNotMatch(source, /\bfrom\s+['"].*(?:main|storage|api|cache|hydrate|synopsis|reader)\.js['"]/);
  assert.doesNotMatch(source, /\bfrom\s+['"]\.\/(?:issue|home|library|add|data|catalog|progress|recovery|reading-paths)\.js['"]/);
  assert.doesNotMatch(source, /new Store|new MarvelApi|new ResponseCache|new RateLimiter|new Hydrator|new SynopsisRunner/);
});

test('wire and render build reading controls and call launch inside the same gesture turn', () => {
  const h = harness();
  try {
    h.view.wire();
    h.view.render();

    assert.equal(h.nodes.orderName.textContent, 'List A');
    assert.equal(h.nodes.listNote.textContent, 'List note');
    assert.equal(h.nodes.btnListNote.textContent, 'Edit note');
    assert.equal(h.nodes.heroTitle.textContent, 'Issue Two');
    assert.equal(h.nodes.readingFilters.querySelectorAll('input[name="filter"]').length, READING_FILTERS.length);
    assert.equal(typeof h.nodes.btnHeroRead.listeners.click[0], 'function');

    h.calls.launch.length = 0;
    h.nodes.btnHeroRead.fire('click', { preventDefault() {} });
    assert.equal(h.calls.launch.length, 1, 'launch must happen during the click, not after a later tick');
    assert.equal(h.calls.launch[0][0].title, 'Issue Two');

    h.nodes.saveEducationSettings.fire('click');
    assert.deepEqual(h.calls.showView.at(-1), { name: 'data', opts: { push: true } });
    h.nodes.btnHydrate.fire('click');
    h.nodes.btnSynopsis.fire('click');
    h.nodes.btnCancelHydrate.fire('click');
    h.nodes.btnCancelSynopsis.fire('click');
    assert.deepEqual(h.calls.hydrate, ['list-a', 'cancel']);
    assert.deepEqual(h.calls.synopsis, ['start', 'cancel']);
  } finally {
    h.restore();
  }
});

test('wireShortcuts keeps Reading-local launch and done actions inside the view', () => {
  const h = harness();
  try {
    h.view.wireShortcuts();
    const event = { key: 'Enter', preventDefault() { this.prevented = true; }, altKey: false, ctrlKey: false, metaKey: false };
    globalThis.document.listeners.keydown(event);
    assert.equal(event.prevented, true);
    assert.equal(h.calls.launch.length, 1);

    const done = { key: 'd', preventDefault() { this.prevented = true; }, altKey: false, ctrlKey: false, metaKey: false };
    globalThis.document.listeners.keydown(done);
    assert.equal(done.prevented, true);
    assert.match(h.calls.announce[0], /Issue Two marked read/);
  } finally {
    h.restore();
  }
});

test('renderRows reuses cached nodes until the list, day, or cover setting changes', () => {
  const RealDate = Date;
  const restoreDate = installDate('2025-01-01T12:00:00');
  const h = harness({ fullOpen: true });
  try {
    h.view.renderRows();
    const firstRow = h.nodes.rows.childNodes.find((entry) => entry.className?.includes('row'));
    const firstPaints = h.calls.paintCover;

    h.view.renderRows();
    const secondRow = h.nodes.rows.childNodes.find((entry) => entry.className?.includes('row'));
    assert.equal(secondRow, firstRow);
    assert.equal(h.calls.paintCover, firstPaints, 'cached rows should not repaint unchanged covers');

    restoreDate();
    const restoreNextDate = installDate('2025-01-02T12:00:00');
    h.view.renderRows();
    const thirdRow = h.nodes.rows.childNodes.find((entry) => entry.className?.includes('row'));
    assert.notEqual(thirdRow, firstRow);

    h.settings.covers = false;
    h.view.renderRows();
    const fourthRow = h.nodes.rows.childNodes.find((entry) => entry.className?.includes('row'));
    assert.notEqual(fourthRow, thirdRow);
    const afterCovers = h.calls.paintCover;

    h.setActive('list-b');
    h.view.renderRows();
    const otherListRow = h.nodes.rows.childNodes.find((entry) => entry.className?.includes('row'));
    assert.notEqual(otherListRow, fourthRow);
    assert.ok(h.calls.paintCover > afterCovers);

    restoreNextDate();
  } finally {
    h.restore();
    globalThis.Date = RealDate;
  }
});

test('hydration and synopsis status painting stay behind injected announcers and button state', () => {
  let hydrateActive = false;
  let synopsisActive = false;
  const h = harness({
    isHydrationActive: () => hydrateActive,
    isSynopsisActive: () => synopsisActive,
  });
  try {
    h.view.wire();
    h.view.render();

    hydrateActive = true;
    h.view.renderHydration({ phase: 'running', done: 1, total: 3 });
    assert.equal(h.nodes.hydrationStatus.hidden, false);
    assert.equal(h.nodes.hydrationStatus.textContent, 'Fetching details 1 of 3…');
    assert.deepEqual(h.calls.announceState.at(-1), { name: 'hydration', value: 'running', msg: 'running' });
    assert.equal(h.nodes.btnCancelHydrate.hidden, false);

    synopsisActive = true;
    h.view.renderSynopsis({ phase: 'running', done: 1, total: 2, failed: 0 });
    assert.equal(h.nodes.synopsisStatus.hidden, false);
    assert.equal(h.nodes.synopsisStatus.textContent, 'running:1/2');
    assert.deepEqual(h.calls.announceState.at(-1), { name: 'synopsis', value: 'running', msg: 'running' });
    assert.equal(h.nodes.btnCancelSynopsis.hidden, false);
  } finally {
    h.restore();
  }
});

test('delete keeps the chosen list buffered, ignores stale catalog ids, and clears on matching replacement', async () => {
  let resolveConfirm;
  const confirm = new Promise((resolve) => { resolveConfirm = resolve; });
  const h = harness({ askConfirm: async () => confirm });
  try {
    h.view.wire();
    const deleting = h.nodes.btnDeleteList.fire('click');
    h.setActive('list-b');
    resolveConfirm(true);
    await deleting;

    assert.equal(Boolean(h.state().lists['list-a']), false);
    assert.equal(Boolean(h.state().lists['list-b']), true);
    const notice = h.calls.notify.at(-1);
    assert.match(notice.msg, /Deleted List A/);

    assert.equal(h.view.forgetDeletedFor('cat-b', 'List B'), null);
    notice.action.onClick();
    assert.equal(Boolean(h.state().lists['list-a']), true, 'a stale catalog write must not spend the undo for another order');

    h.setActive('list-a');
    await h.nodes.btnDeleteList.fire('click');
    const second = h.calls.notify.at(-1);
    const message = h.view.forgetDeletedFor('cat-a', 'Catalog copy');
    assert.match(message, /Catalog copy is back from the catalog/);
    second.action.onClick();
    assert.equal(Boolean(h.state().lists['list-a']), false, 'a matching catalog replacement spends the buffered undo');
  } finally {
    h.restore();
  }
});

test('undo delete stays inside the view through retry, dismiss, and controller invalidation', async () => {
  const h = harness();
  try {
    h.view.wire();
    await h.nodes.btnDeleteList.fire('click');
    const deleted = h.calls.notify.at(-1);

    h.setWriteFailures(1);
    deleted.action.onClick();
    const failed = h.calls.notify.at(-1);
    assert.match(failed.msg, /could not be put back/);
    assert.equal(Boolean(h.state().lists['list-a']), false);

    failed.action.onClick();
    assert.equal(Boolean(h.state().lists['list-a']), true);
    assert.match(h.calls.announce.at(-1), /back in your sidebar/);

    await h.nodes.btnDeleteList.fire('click');
    const again = h.calls.notify.at(-1);
    again.dismiss.onClick();
    again.action.onClick();
    assert.equal(Boolean(h.state().lists['list-a']), false, 'dismiss spends the undo instead of hiding its notice only');

    h.view.forgetDeleted();
    assert.equal(h.calls.clearNotice.at(-1), 'undo-delete');
  } finally {
    h.restore();
  }
});

test('main constructs Reading once and delegates reading-owned work through the view', () => {
  const main = readFileSync(join(ROOT, 'src/js/main.js'), 'utf8');
  assert.equal((main.match(/const readingView = createReadingView\(\{/g) ?? []).length, 1);
  for (const pattern of [
    /readingView\.render\(\)/,
    /readingView\.wire\(\)/,
    /readingView\.wireShortcuts\(\)/,
    /readingView\.filterTraversalSnapshot\(\{ push \}\)/,
    /readingView\.currentFilter\(\)/,
    /readingView\.endFilterRun\(\{ commit: false \}\)/,
    /readingView\.setFilterAddressed\(route\.filter !== null\)/,
    /readingView\.setFilter\(route\.filter \?\? filterIfAbsent\)/,
    /readingView\.setFullOrderFromRoute\(openFromRoute\)/,
    /readingView\.renderHydration\(status\)/,
    /readingView\.renderSynopsis\(status\)/,
    /readingView\.forgetDeleted\(\)/,
    /readingView\.forgetDeletedFor\(catalogId, order\.name\)/,
  ]) {
    assert.match(main, pattern);
  }
});
