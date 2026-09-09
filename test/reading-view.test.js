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
  renameList, moveItem, removeFromList, setOverride, upsertIssue, exportBackup,
} from '../src/js/lib/model.js';
import { Store, KEY } from '../src/js/storage.js';
import { DEFAULT_FILTER, READING_FILTERS } from '../src/js/lib/readingFilters.js';
import { createSynopsisDisclosure } from '../src/js/lib/synopsisDisclosure.js';
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
    if (selector === '[data-act="read"]' && node.dataset?.act === 'read') found.push(node);
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
    getClientRects() { return this.hidden ? [] : [{}]; },
    scrollIntoView(options) { this.scrolled = options; },
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
  const readerStore = overrides.store;
  let state = readerStore?.state ?? overrides.state ?? seededState();
  const settings = overrides.settings ?? { covers: true, filter: DEFAULT_FILTER };
  const calls = {
    announce: [],
    announceIfSaved: [],
    announceState: [],
    clearNotice: [],
    focusCurrentView: 0,
    storeChanges: [],
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
  const notices = new Map();
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
    readingEmpty: node({ id: 'reading-empty', hidden: true }),
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
    btnHeroDescription: node({ id: 'btn-hero-description', tag: 'button' }),
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
    ['#reading-empty', nodes.readingEmpty],
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
    ['#btn-hero-description', nodes.btnHeroDescription],
    ['#hero-facts', nodes.heroFacts],
    ['#btn-hero-info', nodes.btnHeroInfo],
    ['#shelf', nodes.shelf],
    ['#rows', nodes.rows],
    ['#hydration-status', nodes.hydrationStatus],
    ['#synopsis-status', nodes.synopsisStatus],
    ['#all-read-h', nodes.allReadHeading],
    ['dialog[open]', null],
  ]);
  for (const id of ['review-earlier', 'btn-review-earlier', 'review-h', 'review-context',
    'review-position', 'review-candidate', 'review-earlier-button', 'review-later-button',
    'review-close', 'review-full-order']) {
    nodes[id] = node({ id, hidden: id === 'review-earlier' });
    selectorMap.set(`#${id}`, nodes[id]);
  }

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
    clearNotice: (key) => { calls.clearNotice.push(key); notices.delete(key); },
    detailUrl: (item) => item.url ?? `https://example.test/${item.issueId}`,
    el: element,
    fact: (key, value, className) => ({ key, value, className }),
    focusCurrentView: () => { calls.focusCurrentView += 1; nodes.orderName.focus(); },
    getSettings: () => settings,
    getState: () => state,
    getSynopsis: overrides.getSynopsis ?? (() => null),
    hydrationAnnouncement: (status) => ({ state: status?.phase ?? 'idle', msg: status?.phase ?? null }),
    isCurrent: overrides.isCurrent ?? (() => true),
    isHydrationActive: overrides.isHydrationActive ?? (() => false),
    isStateBlocked: () => readerStore?.blocked ?? false,
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
      const notice = { selector, msg, kind, key, action, dismiss };
      calls.notify.push(notice);
      notices.set(key, notice);
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
    synopsisDisclosure: overrides.synopsisDisclosure ?? createSynopsisDisclosure(),
    synopsisStatusLine: (status) => status ? `${status.phase}:${status.done ?? 0}/${status.total ?? 0}` : '',
    updateState: (updater) => {
      if (readerStore) {
        const next = readerStore.update(updater);
        return { ok: readerStore.lastUpdateOk, state: next };
      }
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
  if (readerStore) {
    readerStore.onChange = (next, error) => {
      state = next;
      view.render();
      calls.storeChanges.push({ error, offered: notices.has('undo-remove'), blocked: readerStore.blocked });
    };
  }
  return {
    calls,
    nodes,
    notices,
    settings,
    setActive(listId) { state = setActive(state, listId); },
    setWriteFailures(count) { writeFailures = count; },
    setDialogOpen(open) { selectorMap.set('dialog[open]', open ? node() : null); },
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

test('445 picker preserves exact candidate, traversal and full-order escape without writes or requests', () => {
  const h = harness();
  try {
    h.view.wire();
    h.view.openReview();
    const before = structuredClone(h.state());
    assert.equal(h.view.restoreReview({ issueId: 1, contextId: h.state().active }), true);
    h.nodes['review-earlier-button'].fire('click');
    h.nodes['review-later-button'].fire('click');
    assert.equal(h.view.restoreReview({ issueId: 1, contextId: h.state().active }), true);
    h.nodes['review-full-order'].fire('click');
    assert.equal(h.nodes.full.open, true);
    assert.deepEqual(structuredClone(h.state()), before);
    assert.deepEqual(h.calls.launch, []);
    assert.deepEqual(h.calls.synopsis, []);
    h.nodes['review-close'].fire('click');
    assert.equal(h.nodes['review-earlier'].hidden, true);
  } finally { h.restore(); }
});

test('445 picker withdraws reordered or removed candidates and never resurrects a different list on Back', () => {
  const h = harness();
  try {
    h.view.wire();
    h.view.openReview();
    const id = h.state().active;
    h.state().lists[id].itemIds = [2, 1, 3];
    h.view.renderReview();
    assert.equal(h.view.restoreReview({ issueId: 1, contextId: id }), false);
    assert.match(h.nodes['review-position'].textContent, /no longer valid/);
    h.state().lists.b = { id: 'b', name: 'Other', itemIds: [1] };
    h.setActive('b');
    h.view.renderReview();
    h.setActive(id);
    assert.equal(h.view.restoreReview({ issueId: 1, contextId: id }), false);
  } finally { h.restore(); }
});

test('445 picker handles completion, empty ranges and missing identity metadata', () => {
  const h = harness();
  try {
    h.view.wire();
    const list = h.state().lists[h.state().active];
    for (const id of list.itemIds) h.state().read[id] = 1;
    delete h.state().issues[list.itemIds.at(-1)];
    h.view.openReview();
    assert.equal(h.view.restoreReview({ issueId: list.itemIds.at(-1), contextId: list.id }), true);
    list.itemIds = [];
    h.view.openReview();
    assert.match(h.nodes['review-position'].textContent, /no comics in/);
    list.itemIds = [20];
    h.view.openReview();
    assert.match(h.nodes['review-position'].textContent, /no comics before/);
  } finally { h.restore(); }
});

test('447 hero bulk prose starts hidden and disclosure stays isolated through Done and revisiting', () => {
  const disclosure = createSynopsisDisclosure();
  const h = harness({ getSynopsis: (id) => `Synthetic hero description ${id}.`, synopsisDisclosure: disclosure });
  try {
    h.view.wire();
    h.view.render();
    const before = structuredClone(h.state());
    assert.equal(h.nodes.heroDesc.textContent, '');
    assert.equal(h.nodes.heroDesc.hidden, true);
    assert.equal(h.nodes.btnHeroDescription.attributes['aria-expanded'], 'false');
    h.nodes.btnHeroDescription.focus();
    h.nodes.btnHeroDescription.fire('click');
    assert.equal(h.nodes.heroDesc.textContent, 'Synthetic hero description 2.');
    assert.equal(h.nodes.btnHeroDescription.attributes['aria-expanded'], 'true');
    assert.equal(globalThis.document.activeElement, h.nodes.btnHeroDescription);
    assert.deepEqual(structuredClone(h.state()), before);
    assert.deepEqual(h.calls.launch, []);
    assert.deepEqual(h.calls.synopsis, []);
    h.nodes.btnHeroDone.fire('click');
    h.view.renderHero();
    assert.equal(h.nodes.heroDesc.textContent, '', 'Done does not reveal the next issue');
    assert.equal(disclosure.isRevealed(2), true, 'read flag change does not erase the explicit choice');
    assert.equal(disclosure.isRevealed(3), false);
    disclosure.reveal(3);
    h.view.renderHero();
    assert.equal(h.nodes.heroDesc.textContent, 'Synthetic hero description 3.', 'another view can reveal the exact issue');
    h.nodes.btnHeroDescription.fire('click');
    assert.equal(h.nodes.heroDesc.textContent, '');
    assert.equal(disclosure.isRevealed(3), false);
    disclosure.clear();
    h.view.resetSynopsis();
    assert.equal(h.nodes.heroDesc.textContent, '');
    assert.equal(h.nodes.btnHeroDescription.hidden, true);
  } finally {
    h.restore();
  }
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

test('441 Reading distinguishes empty, partial and completed lists without changing state', () => {
  for (const phase of ['empty', 'partial', 'completed']) {
    let state = createList(createEmptyState(), { id: 'empty-441', name: 'Empty 441' });
    if (phase !== 'empty') {
      state = addIssuesToList(state, 'empty-441', [issue(1, 'First'), issue(2, 'Second')]).state;
      state = markRead(state, 1, true);
      if (phase === 'completed') state = markRead(state, 2, true);
    }
    state = setActive(state, 'empty-441');
    const before = structuredClone(state);
    const h = harness({ state });
    try {
      h.view.render();
      assert.equal(h.nodes.readingEmpty.hidden, phase !== 'empty', phase);
      assert.equal(h.nodes.allRead.hidden, phase !== 'completed', phase);
      assert.equal(h.nodes.hero.hidden, phase !== 'partial', phase);
      assert.equal(h.nodes.heroTitle.textContent, phase === 'partial' ? 'Second' : 'Nothing up next');
      assert.equal(h.nodes.ringSub.textContent, {
        empty: 'Nothing in this list', partial: '1 of 2 read', completed: 'All read',
      }[phase]);
      assert.equal(h.nodes.fullCount.textContent, {
        empty: 'No issues yet', partial: '1 unread', completed: 'All read',
      }[phase]);
      assert.deepEqual(structuredClone(h.state()), before, 'render must not add or mark issues');
      assert.deepEqual(h.calls.launch, []);
    } finally {
      h.restore();
    }
  }
});

test('441 removing the last issue restores the empty state without deleting the list or progress', () => {
  let state = createList(createEmptyState(), { id: 'last-441', name: 'Last 441' });
  state = addIssuesToList(state, 'last-441', [issue(1, 'Last issue')]).state;
  state = markRead(state, 1, true);
  state = setActive(state, 'last-441');
  const h = harness({ state });
  try {
    h.view.render();
    assert.equal(h.nodes.allRead.hidden, false);
    let remove;
    walk(h.nodes.rows, (entry) => {
      if (entry.dataset?.act === 'remove') remove = entry;
    });
    assert.ok(remove, 'the rendered row must expose a real removal action');
    remove.fire('click');
    const afterRemoval = structuredClone(h.state());
    h.view.render();
    assert.equal(h.nodes.readingEmpty.hidden, false);
    assert.equal(h.nodes.allRead.hidden, true);
    assert.equal(h.nodes.hero.hidden, true);
    assert.equal(h.nodes.fullCount.textContent, 'No issues yet');
    assert.deepEqual(h.state().lists['last-441'].itemIds, []);
    assert.deepEqual(h.state().read, state.read, 'removal does not discard global reading progress');
    assert.deepEqual(structuredClone(h.state()), afterRemoval, 'render is read-only after removal too');
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

test('disabled D leaves progress and the key alone, while re-enabled D works on Done next', () => {
  const h = harness();
  try {
    h.view.wire();
    h.view.wireShortcuts();
    h.settings.readingShortcut = false;
    globalThis.document.activeElement = { tagName: 'BUTTON' };
    const before = h.state();
    for (const key of ['d', 'D']) {
      const event = { key, preventDefault() { this.prevented = true; } };
      globalThis.document.listeners.keydown(event);
      assert.equal(event.prevented, undefined);
      assert.equal(h.state(), before);
      assert.equal(h.calls.announce.length, 0);
    }
    h.nodes.btnHeroDone.fire('click');
    assert.ok(h.state().read['2'], 'the button remains usable with D off');
    h.settings.readingShortcut = true;
    globalThis.document.listeners.keydown({ key: 'D', preventDefault() {} });
    assert.ok(h.state().read['3'], 'D still works after clicking Done next');
  } finally {
    h.restore();
  }
});

test('repeated D keydown never saves or announces another issue, but a fresh press does', () => {
  const h = harness();
  try {
    h.view.wireShortcuts();
    const press = (repeat) => {
      const event = { key: 'd', repeat, preventDefault() { this.prevented = true; } };
      globalThis.document.listeners.keydown(event);
      return event;
    };
    assert.equal(press(false).prevented, true);
    const afterFirst = h.state();
    for (let i = 0; i < 3; i += 1) {
      assert.equal(press(true).prevented, undefined);
      assert.equal(h.state(), afterFirst);
      assert.equal(h.calls.announce.length, 1);
    }
    assert.equal(press(false).prevented, true);
    assert.ok(h.state().read['3']);
    assert.equal(h.calls.announce.length, 2);
  } finally {
    h.restore();
  }
});

test('enabled reading shortcuts retain typing, modifier, dialog and native Enter guards', () => {
  let current = true;
  const h = harness({ isCurrent: () => current });
  try {
    h.view.wireShortcuts();
    const before = h.state();
    const refused = (key, extra = {}) => {
      const event = { key, ...extra, preventDefault() { this.prevented = true; } };
      globalThis.document.listeners.keydown(event);
      assert.equal(event.prevented, undefined);
      assert.equal(h.state(), before);
      assert.equal(h.calls.launch.length, 0);
    };
    for (const target of [
      { tagName: 'INPUT', type: 'search' }, { tagName: 'TEXTAREA' },
      { tagName: 'SELECT' }, { tagName: 'DIV', isContentEditable: true },
    ]) {
      globalThis.document.activeElement = target;
      refused('d');
      refused('Enter');
    }
    for (const target of [{ tagName: 'BUTTON' }, { tagName: 'A', href: 'https://example.test' }]) {
      globalThis.document.activeElement = target;
      refused('Enter');
    }
    globalThis.document.activeElement = null;
    for (const modifier of ['ctrlKey', 'altKey', 'metaKey']) refused('d', { [modifier]: true });
    h.setDialogOpen(true);
    refused('d');
    refused('Enter');
    h.setDialogOpen(false);
    current = false;
    refused('d');
    refused('Enter');
    current = true;
    globalThis.document.listeners.keydown({ key: 'Enter', preventDefault() {} });
    assert.equal(h.calls.launch.length, 1, 'unclaimed Enter still launches synchronously');
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

function removalHarness(overrides = {}) {
  const storage = {
    map: new Map([[KEY, JSON.stringify(exportBackup(overrides.state ?? seededState()))]]),
    writes: [],
    failWrites: 0,
    failKey: null,
    restoreMode: null,
    unreadable: false,
    thirdParty: null,
    getItem(key) {
      if (key === KEY && this.unreadable) throw new Error('Unknown saved state');
      return this.map.get(key) ?? null;
    },
    setItem(key, value) {
      this.writes.push(key);
      if (key === this.failKey || (key === KEY && this.failWrites > 0)) {
        if (key === KEY) this.failWrites -= 1;
        throw new DOMException('Refused fixture write', 'QuotaExceededError');
      }
      if (key === KEY && this.restoreMode === 'unchanged') return;
      this.map.set(key, key === KEY && this.restoreMode === 'third-party' ? this.thirdParty : String(value));
      if (key === KEY && this.restoreMode === 'unknown') this.unreadable = true;
    },
    removeItem(key) { this.map.delete(key); },
  };
  const store = new Store({ storage });
  store.load();
  const h = harness({ ...overrides, store });
  h.view.wire();
  h.view.render();
  return { ...h, store, storage };
}

function removalAction(h, issueId) {
  let found;
  walk(h.nodes.rows, (entry) => {
    if (entry.dataset?.act === 'remove' && Number(entry.dataset.key) === issueId) found = entry;
  });
  assert.ok(found, `Remove control for ${issueId} exists`);
  return found;
}

function removalOffer(h) {
  const notice = h.notices.get('undo-remove');
  assert.ok(notice?.action, 'the saved removal offers an actionable Undo');
  assert.equal(notice.dismiss.label, 'Dismiss');
  return notice;
}

test('444 removal Undo survives synchronous Store repaint without replaying later metadata or progress', () => {
  const h = removalHarness();
  try {
    removalAction(h, 2).fire('click');
    const offer = removalOffer(h);
    assert.equal(offer.action.label, 'Undo remove');
    assert.deepEqual(h.state().lists['list-a'].itemIds, [1, 3]);
    assert.equal(h.state().lists['list-a'].collectedIn[2], undefined);
    assert.match(offer.msg, /Reading progress was kept/);
    assert.equal(h.calls.storeChanges.length, 1, 'actual Store synchronously repainted before offering Undo');

    h.store.update((state) => {
      let next = upsertIssue(state, { issueId: 2, title: 'Later metadata', hydrated: true });
      next = markRead(next, 2, true, 444);
      next = setOverride(next, 2, 'unavailable');
      next = setIssueNote(next, 2, 'Later issue note');
      next = renameList(next, 'list-a', 'Renamed', 'Later description');
      next = setListNote(next, 'list-a', 'Later list note');
      return setActive(next, 'list-b');
    });
    const current = h.state();
    assert.equal(removalOffer(h), offer, 'independent and list-metadata changes retain the same offer');
    offer.action.onClick();
    const restored = h.state();
    assert.deepEqual(restored.lists['list-a'].itemIds, [1, 2, 3]);
    assert.equal(restored.lists['list-a'].collectedIn[2], 'Trade One');
    assert.equal(restored.lists['list-a'].name, 'Renamed');
    assert.equal(restored.lists['list-a'].note, 'Later list note');
    for (const key of ['issues', 'read', 'notes', 'overrides', 'listOrder', 'active']) {
      assert.equal(restored[key], current[key], key);
    }
    assert.equal(restored.lists['list-b'], current.lists['list-b']);
    assert.equal(h.notices.has('undo-remove'), false);
    assert.match(h.calls.announce.at(-1), /back in Renamed, in its original position/);
    assert.equal(h.calls.storeChanges.at(-1).offered, false, 'success consumed the record during repaint');
    assert.deepEqual(JSON.parse(h.storage.getItem(KEY)).lists['list-a'].itemIds, [1, 2, 3]);
  } finally { h.restore(); }
});

test('444 latest removal binds Undo and Dismiss to their own record across different active lists', () => {
  const h = removalHarness();
  try {
    removalAction(h, 2).fire('click');
    const older = removalOffer(h);
    h.store.update((state) => setActive(state, 'list-b'));
    removalAction(h, 4).fire('click');
    const latest = removalOffer(h);
    const raw = h.storage.getItem(KEY);
    older.action.onClick();
    older.dismiss.onClick();
    assert.equal(h.storage.getItem(KEY), raw, 'stale controls cannot write or spend the newer record');
    assert.equal(removalOffer(h), latest);
    latest.action.onClick();
    assert.deepEqual(h.state().lists['list-a'].itemIds, [1, 3]);
    assert.deepEqual(h.state().lists['list-b'].itemIds, [4, 5]);
    assert.equal(h.state().active, 'list-b');
    const restored = h.storage.getItem(KEY);
    latest.action.onClick();
    older.action.onClick();
    assert.equal(h.storage.getItem(KEY), restored, 'repeated controls cannot duplicate either issue');
  } finally { h.restore(); }
});

test('444 failed removal and stale row no-op preserve an earlier valid offer without announcing success', () => {
  const h = removalHarness();
  try {
    h.storage.failWrites = 1;
    removalAction(h, 2).fire('click');
    assert.equal(h.notices.has('undo-remove'), false);
    assert.deepEqual(h.state().lists['list-a'].itemIds, [1, 2, 3]);
    assert.match(h.calls.announce.at(-1), /could not be removed/);
    const row = removalAction(h, 2);
    row.fire('click');
    const offer = removalOffer(h);
    const raw = h.storage.getItem(KEY);
    const notices = h.calls.notify.length;
    row.fire('click');
    assert.equal(h.store.lastUpdateOk, true, 'actual Store calls the stale model no-op successful');
    assert.match(h.calls.announce.at(-1), /Nothing was removed/);
    h.storage.failWrites = 1;
    removalAction(h, 3).fire('click');
    assert.equal(h.store.lastUpdateOk, false);
    assert.match(h.calls.storeChanges.at(-1).error, /not saved/);
    assert.match(h.calls.announce.at(-1), /could not be removed/);
    assert.equal(h.calls.notify.length, notices);
    assert.equal(h.storage.getItem(KEY), raw);
    assert.equal(removalOffer(h), offer);
    offer.action.onClick();
    assert.deepEqual(h.state().lists['list-a'].itemIds, [1, 2, 3]);
  } finally { h.restore(); }
});

test('444 a refused Undo retains a retry only until success or explicit dismissal', () => {
  const h = removalHarness();
  try {
    for (const dismiss of [false, true]) {
      removalAction(h, 2).fire('click');
      const offer = removalOffer(h);
      const raw = h.storage.getItem(KEY);
      h.storage.failWrites = 1;
      offer.action.onClick();
      const retry = removalOffer(h);
      assert.equal(retry.action.label, 'Try again');
      assert.equal(retry.kind, 'error');
      assert.equal(h.storage.getItem(KEY), raw);
      assert.equal(h.calls.storeChanges.at(-1).offered, true, 'failed write rollback preserved the offer through repaint');
      assert.ok(h.calls.focusCurrentView > 0);
      if (dismiss) retry.dismiss.onClick();
      retry.action.onClick();
      if (dismiss) {
        assert.equal(h.storage.getItem(KEY), raw, 'dismissal spends the retry, not only its notice');
      } else {
        assert.deepEqual(h.state().lists['list-a'].itemIds, [1, 2, 3]);
      }
      assert.equal(h.notices.has('undo-remove'), false);
    }
  } finally { h.restore(); }
});

test('444 navigation, filters, disclosure and unrelated list edits do not inherently lose Undo', () => {
  let reading = true;
  const h = removalHarness({ isCurrent: () => reading });
  try {
    removalAction(h, 2).fire('click');
    const offer = removalOffer(h);
    reading = false;
    h.view.setFilter('read');
    h.view.setFullOrderFromRoute(false);
    h.store.update((state) => moveItem(setIssueNote(state, 3, 'Independent note'), 'list-b', 5, -1));
    h.view.render();
    assert.equal(removalOffer(h), offer);
    const before = h.state();
    offer.action.onClick();
    assert.deepEqual(h.state().lists['list-a'].itemIds, [1, 2, 3]);
    assert.equal(h.state().lists['list-b'], before.lists['list-b']);
    assert.equal(h.view.currentFilter(), 'read');
    assert.equal(h.nodes.full.open, false);
    assert.equal(h.state().read, before.read);
    assert.ok(h.calls.focusCurrentView > 0, 'off-route Undo uses the current view instead of a hidden row');
  } finally { h.restore(); }
});

test('444 structural source edits withdraw Undo immediately even when the list ID survives', () => {
  const edits = [
    ['reorder', (state) => moveItem(state, 'list-a', 3, -1)],
    ['add', (state) => addIssuesToList(state, 'list-a', [issue(6, 'Six')]).state],
    ['re-add removed issue', (state) => addIssuesToList(state, 'list-a', [issue(2, 'Two')]).state],
    ['remove another issue', (state) => removeFromList(state, 'list-a', 3)],
    ['edition edit', (state) => ({
      ...state,
      lists: Object.assign(Object.create(null), state.lists, {
        'list-a': { ...state.lists['list-a'], collectedIn: { 3: 'Later edition' } },
      }),
    })],
    ['same-ID replacement', (state) => ({
      ...state,
      lists: Object.assign(Object.create(null), state.lists, {
        'list-a': { ...state.lists['list-a'], itemIds: [...state.lists['list-a'].itemIds] },
      }),
    })],
  ];
  for (const [name, edit] of edits) {
    const h = removalHarness({ isCurrent: () => false });
    try {
      removalAction(h, 2).fire('click');
      const offer = removalOffer(h);
      const changes = h.calls.storeChanges.length;
      h.store.update(edit);
      assert.equal(h.calls.storeChanges.length, changes + 1, name);
      assert.equal(h.calls.storeChanges.at(-1).offered, false, name);
      assert.equal(h.notices.has('undo-remove'), false, name);
      const raw = h.storage.getItem(KEY);
      offer.action.onClick();
      assert.equal(h.storage.getItem(KEY), raw, name);
    } finally { h.restore(); }
  }
});

test('444 foreign adoption and conflicting Undo writes withdraw offers without rewriting adopted data', () => {
  for (const conflict of [false, true]) {
    const h = removalHarness({ isCurrent: () => false });
    try {
      removalAction(h, 2).fire('click');
      const offer = removalOffer(h);
      const foreign = JSON.stringify({ writeToken: 'foreign-444', ...exportBackup(h.state()) });
      h.storage.map.set(KEY, foreign);
      if (!conflict) {
        h.store.adoptForeignWrite(foreign);
        assert.equal(h.notices.has('undo-remove'), false, 'same-content adoption is still a different context');
      }
      offer.action.onClick();
      assert.equal(h.storage.getItem(KEY), foreign);
      assert.equal(h.notices.has('undo-remove'), false);
      assert.equal(h.calls.storeChanges.at(-1).offered, false);
      assert.equal(h.calls.notify.some((n) => n.action?.label === 'Try again'), false);
    } finally { h.restore(); }
  }
});

test('444 restore reconciliation distinguishes early refusals, reconstructed unchanged state and both unknown outcomes', () => {
  const cases = [
    { name: 'invalid backup', input: '{invalid', changed: false, retains: true, same: true },
    { name: 'pre-swap refusal', failKey: 'mrt.state.restore.tmp', changed: false, retains: true, same: true },
    { name: 'unchanged after swap', mode: 'unchanged', changed: false },
    { name: 'successful restore', changed: true },
    { name: 'unknown durable data', mode: 'unknown', changed: null, blocked: true, same: true },
    { name: 'third-party reconciliation', mode: 'third-party', changed: null },
  ];
  for (const entry of cases) {
    const h = removalHarness({ isCurrent: () => false });
    try {
      removalAction(h, 2).fire('click');
      const offer = removalOffer(h);
      const source = h.state().lists['list-a'];
      const changes = h.calls.storeChanges.length;
      h.storage.restoreMode = entry.mode;
      h.storage.failKey = entry.failKey;
      h.storage.thirdParty = JSON.stringify({
        writeToken: 'other-restore-444',
        ...exportBackup(renameList(h.state(), 'list-a', 'Third-party list')),
      });
      const result = h.store.restore(entry.input ?? exportBackup(h.state()));
      assert.equal(result.changed, entry.changed, entry.name);
      assert.equal(result.ok, entry.changed === true, entry.name);
      assert.equal(h.store.blocked, entry.blocked ?? false, entry.name);
      assert.equal(h.state().lists['list-a'].itemIds === source.itemIds, entry.same ?? false, entry.name);
      assert.equal(h.notices.has('undo-remove'), entry.retains ?? false, entry.name);
      if (entry.retains) {
        assert.equal(h.calls.storeChanges.length, changes, 'early refusal has no repaint or replacement');
        offer.action.onClick();
        assert.deepEqual(h.state().lists['list-a'].itemIds, [1, 2, 3]);
      } else {
        assert.equal(h.calls.storeChanges.length, changes + 1, entry.name);
        assert.equal(h.calls.storeChanges.at(-1).offered, false, entry.name);
        const raw = h.storage.map.get(KEY);
        offer.action.onClick();
        assert.equal(h.storage.map.get(KEY), raw, entry.name);
        assert.equal(h.notices.has('undo-remove'), false, entry.name);
      }
    } finally { h.restore(); }
  }
});

test('444 whole-list Undo cannot resurrect a removed-issue offer and a new view has no removal history', async () => {
  const h = removalHarness();
  try {
    removalAction(h, 2).fire('click');
    const offer = removalOffer(h);
    await h.nodes.btnDeleteList.fire('click');
    const deleted = h.notices.get('undo-delete');
    assert.ok(deleted?.action);
    assert.equal(h.notices.has('undo-remove'), false);
    deleted.action.onClick();
    assert.deepEqual(h.state().lists['list-a'].itemIds, [1, 3]);
    const raw = h.storage.getItem(KEY);
    offer.action.onClick();
    assert.equal(h.storage.getItem(KEY), raw);
    assert.equal(h.notices.has('undo-remove'), false);
    assert.equal(h.notices.has('undo-delete'), false);
    const reloaded = removalHarness({ state: h.state() });
    try {
      assert.equal(reloaded.notices.has('undo-remove'), false);
      assert.deepEqual(reloaded.state().lists['list-a'].itemIds, [1, 3]);
      assert.deepEqual(Object.keys(exportBackup(reloaded.state())), Object.keys(exportBackup(createEmptyState())));
    } finally { reloaded.restore(); }
  } finally { h.restore(); }
});
