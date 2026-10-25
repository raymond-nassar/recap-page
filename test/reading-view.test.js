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
  setDeferred, isDeferred, listReadingProgress, deleteList,
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
  DONE_RESULT_MS,
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
    if (selector === '.row-actions' && node.classList.contains('row-actions')) found.push(node);
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
    // Done's result is placed beside a static anchor and replaced where it stands, so the stub
    // needs both sibling operations, and connection follows the node in and out of a parent.
    after(...next) {
      const parent = this.parentNode;
      if (!parent) return;
      for (const [offset, child] of next.entries()) {
        child.parentNode?.childNodes.splice(child.parentNode.childNodes.indexOf(child), 1);
        parent.childNodes.splice(parent.childNodes.indexOf(this) + 1 + offset, 0, attach(parent, child));
        child.isConnected = true;
      }
    },
    replaceWith(next) {
      const parent = this.parentNode;
      if (!parent) return;
      parent.childNodes.splice(parent.childNodes.indexOf(this), 1, attach(parent, next));
      next.isConnected = true;
      this.parentNode = null;
      this.isConnected = false;
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
    // A hidden ancestor hides its descendants, which is what lets the result tell an end state
    // that has been replaced by the hero from one still on screen.
    getClientRects() {
      for (let at = this; at; at = at.parentNode) if (at.hidden) return [];
      return [{}];
    },
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
    retireReaderHelp: 0,
    saveSettings: 0,
    showView: [],
    synopsis: [],
  };
  let writeFailures = 0;
  const notices = new Map();
  const nodes = {
    documentElement: node({ tag: 'html' }),
    readingFilters: node({ id: 'reading-filters', tag: 'fieldset' }),
    saveEducationSettings: node({ id: 'save-education-settings', tag: 'a', href: '#/data' }),
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
    heroReaderTemporary: node({ id: 'hero-reader-temporary', hidden: true }),
    btnHeroInspect: node({ id: 'btn-hero-inspect', tag: 'button' }),
    btnHeroDone: node({ id: 'btn-hero-done', tag: 'button' }),
    btnRenameList: node({ id: 'btn-rename-list', tag: 'button' }),
    btnListNote: node({ id: 'btn-list-note', tag: 'button' }),
    btnDeleteList: node({ id: 'btn-delete-list', tag: 'button' }),
    btnDuplicateList: node({ id: 'btn-duplicate-list', tag: 'button' }),
    btnExportMd: node({ id: 'btn-export-md', tag: 'button' }),
    btnExportOrder: node({ id: 'btn-export-order', tag: 'button' }),
    btnHydrate: node({ id: 'btn-hydrate', tag: 'button' }),
    btnCancelHydrate: node({ id: 'btn-cancel-hydrate', tag: 'button' }),
    btnSynopsis: node({ id: 'btn-synopsis', tag: 'button' }),
    btnCancelSynopsis: node({ id: 'btn-cancel-synopsis', tag: 'button' }),
    readingBody: node({ id: 'reading-body' }),
    viewRead: node({ id: 'view-read' }),
    ringWrap: node({ id: 'ring-wrap' }),
    shelf: node({ id: 'shelf', tag: 'ul' }),
    rows: node({ id: 'rows', tag: 'ul' }),
    hydrationStatus: node({ id: 'hydration-status' }),
    synopsisStatus: node({ id: 'synopsis-status' }),
    allReadHeading: node({ id: 'all-read-h', tag: 'h2' }),
  };
  nodes.full = node({ id: 'full', tag: 'details', open: overrides.fullOpen ?? true }, [nodes.fullSummary, nodes.fullAction, nodes.fullCount, nodes.readingFilters]);
  nodes.listActionsSummary = node({ tag: 'summary', text: 'List actions' });
  nodes.listExport = node({ id: 'list-export', tag: 'details' }, [
    node({ tag: 'summary', text: 'Export' }), nodes.btnExportMd, nodes.btnExportOrder,
  ]);
  nodes.listActions = node({ id: 'list-actions', tag: 'details' }, [
    nodes.listActionsSummary,
    node({ class: 'list-actions-body' }, [
      nodes.btnRenameList, nodes.btnListNote, nodes.btnDuplicateList, nodes.listExport,
      nodes.btnHydrate, nodes.btnSynopsis, nodes.btnDeleteList,
    ]),
  ]);
  nodes.listTools = node({ class: 'list-tools' }, [nodes.listActions]);
  nodes.listWork = node({ class: 'list-work' }, [
    nodes.hydrationStatus, nodes.btnCancelHydrate, nodes.synopsisStatus, nodes.btnCancelSynopsis,
  ]);

  const selectorMap = new Map([
    ['#list-actions', nodes.listActions],
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
    ['#btn-export-order', nodes.btnExportOrder],
    ['#btn-hydrate', nodes.btnHydrate],
    ['#btn-cancel-hydrate', nodes.btnCancelHydrate],
    ['#btn-synopsis', nodes.btnSynopsis],
    ['#btn-cancel-synopsis', nodes.btnCancelSynopsis],
    ['#btn-hero-read', nodes.btnHeroRead],
    ['#hero-reader-temporary', nodes.heroReaderTemporary],
    ['#btn-hero-inspect', nodes.btnHeroInspect],
    ['#btn-hero-done', nodes.btnHeroDone],
    ['#reading-body', nodes.readingBody],
    ['#view-read', nodes.viewRead],
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
    'review-close', 'review-full-order', 'all-deferred', 'all-deferred-h', 'all-deferred-count',
    'btn-review-deferred', 'btn-hero-defer']) {
    nodes[id] = node({ id, hidden: id === 'review-earlier' });
    selectorMap.set(`#${id}`, nodes[id]);
  }
  // The document nests each end-state heading in its section and the hero's two commands in one
  // group, which is what Done's result is placed against and what hiding a section hides.
  nodes.heroPrimaryActions = node({ id: 'hero-primary-actions' }, [nodes.btnHeroRead, nodes.btnHeroDone]);
  nodes.hero.append(node({ class: 'hero-body' }, [nodes.heroPrimaryActions, nodes.heroReaderTemporary]));
  nodes.allRead.append(nodes.allReadHeading);
  nodes['all-deferred'].append(nodes['all-deferred-h']);
  selectorMap.set('#hero-primary-actions', nodes.heroPrimaryActions);

  const documentStub = {
    activeElement: null,
    documentElement: nodes.documentElement,
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
    isCompleted: overrides.isCompleted,
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
    readerPresentation: overrides.readerPresentation,
    renderSaveEducation: () => { calls.renderSaveEducation += 1; },
    retireReaderHelp: () => { calls.retireReaderHelp += 1; },
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

  const previousDocument = globalThis.document;
  const previousMatchMedia = globalThis.matchMedia;
  const previousResizeObserver = globalThis.ResizeObserver;
  const observers = [];
  globalThis.document = documentStub;
  globalThis.ResizeObserver = class {
    constructor(callback) { this.callback = callback; observers.push(this); }
    observe(target) { this.target = target; }
  };
  globalThis.matchMedia = (media) => {
    assert.equal(media, '(max-width: 700px)');
    return {
      media, matches: false,
      addEventListener(type, listener) {
        assert.equal(type, 'change');
        assert.equal(typeof listener, 'function');
        this.listener = listener;
      },
    };
  };
  if (readerStore) {
    readerStore.onChange = (next, error) => {
      state = next;
      view.render();
      calls.storeChanges.push({ error, offered: notices.has('undo-remove'), blocked: readerStore.blocked });
    };
  }
  // Done's result retires on a ten-second timer. A test that wants to move time installs these
  // before pressing Done; every other test has its timer cleared on restore, so no pending timer
  // keeps the test process alive.
  const realTimers = { set: globalThis.setTimeout, clear: globalThis.clearTimeout };
  const timers = new Map();
  let clock = 0;
  let timerIds = 0;
  return {
    calls,
    nodes,
    observers,
    notices,
    settings,
    setActive(listId) { state = setActive(state, listId); },
    setWriteFailures(count) { writeFailures = count; },
    setDialogOpen(open) { selectorMap.set('dialog[open]', open ? node() : null); },
    state: () => state,
    view,
    useFakeTimers() {
      globalThis.setTimeout = (fn, ms = 0) => {
        timerIds += 1;
        timers.set(timerIds, { fn, at: clock + ms });
        return timerIds;
      };
      globalThis.clearTimeout = (id) => { timers.delete(id); };
    },
    advance(ms) {
      clock += ms;
      for (const [id, timer] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (timer.at > clock || !timers.has(id)) continue;
        timers.delete(id);
        timer.fn();
      }
    },
    pendingTimers: () => timers.size,
    restore() {
      view.retireDoneResult?.();
      globalThis.setTimeout = realTimers.set;
      globalThis.clearTimeout = realTimers.clear;
      if (previousDocument === undefined) delete globalThis.document;
      else globalThis.document = previousDocument;
      if (previousMatchMedia === undefined) delete globalThis.matchMedia;
      else globalThis.matchMedia = previousMatchMedia;
      if (previousResizeObserver === undefined) delete globalThis.ResizeObserver;
      else globalThis.ResizeObserver = previousResizeObserver;
    },
  };
}

test('reading filter geometry reserves actual sticky clearance without changing saved state', () => {
  const h = harness();
  try {
    h.view.wire();
    const observer = h.observers.find((entry) => entry.target === h.nodes.readingFilters);
    assert.ok(observer, 'the actual filter band has no size observation');
    const before = JSON.stringify(h.state());
    for (const height of [93.75, 54, 0]) {
      h.nodes.readingFilters.getBoundingClientRect = () => ({ height });
      observer.callback();
      assert.equal(h.nodes.documentElement.style['--reading-filter-height'], `${height}px`);
      assert.equal(JSON.stringify(h.state()), before);
    }
  } finally {
    h.restore();
  }
});

test('list actions remain closed until opened and Escape restores focus before closing', () => {
  const h = harness();
  try {
    h.view.wire();
    assert.equal(h.nodes.listActions.open, false);
    const before = JSON.stringify(h.state());
    let open = true;
    const closing = [];
    Object.defineProperty(h.nodes.listActions, 'open', {
      get: () => open,
      set(value) {
        if (!value && open) closing.push(globalThis.document.activeElement);
        open = value;
      },
    });
    h.nodes.listExport.open = true;
    h.nodes.btnExportMd.focus();
    let prevented = false;
    h.nodes.listActions.fire('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
    assert.equal(prevented, true);
    assert.equal(h.nodes.listActions.open, false);
    assert.deepEqual(closing, [h.nodes.listActionsSummary]);
    assert.equal(h.nodes.listExport.open, true);
    assert.equal(JSON.stringify(h.state()), before);
  } finally {
    h.restore();
  }
});

test('an open row command disclosure survives its own saved-state rerender', () => {
  const h = harness();
  try {
    const findAction = (act) => {
      let found;
      walk(h.nodes.rows, (entry) => {
        if (entry.dataset?.key === 2 && entry.dataset.act === act) found = entry;
      });
      return found;
    };
    h.view.renderRows();
    findAction('more').fire('click');
    assert.equal(findAction('more').getAttribute('aria-expanded'), 'true');
    findAction('override-available').fire('click');
    h.view.renderRows();
    assert.equal(findAction('more').getAttribute('aria-expanded'), 'true');
    assert.equal(h.state().overrides[2], 'available');
  } finally {
    h.restore();
  }
});

test('UX05 reorder announces the persisted comic position and never claims a failed move', () => {
  const h = harness();
  try {
    h.view.renderRows();
    const action = (id, act) => {
      let found;
      walk(h.nodes.rows, (entry) => {
        if (entry.dataset?.key === id && entry.dataset?.act === act) found = entry;
      });
      return found;
    };
    action(2, 'up').fire('click');
    assert.deepEqual(h.state().lists['list-a'].itemIds, [2, 1, 3]);
    assert.deepEqual(h.calls.announce, ['Moved Issue Two to position 1 of 3.']);
    h.setWriteFailures(1);
    action(2, 'down').fire('click');
    assert.deepEqual(h.state().lists['list-a'].itemIds, [2, 1, 3]);
    assert.equal(h.calls.announce.length, 1);
    action(2, 'up').fire('click');
    assert.equal(h.calls.announce.length, 1, 'boundary no-op is not a move');
  } finally { h.restore(); }
});

test('UX05 rows keep expected access hedged and offer explicit yes no and clear choices', () => {
  const h = harness();
  try {
    h.state().issues[2].mu = '2000-01-01';
    h.view.renderRows();
    let badge;
    const actions = [];
    walk(h.nodes.rows, (entry) => {
      if (entry.className?.includes('badge-expected')) badge = entry;
      if (entry.dataset?.key === 2 && entry.dataset?.act?.startsWith('override')) actions.push(entry);
    });
    assert.equal(badge.childNodes[0], 'Expected in Unlimited');
    assert.deepEqual(actions.map((entry) => entry.dataset.act), ['override-available', 'override-unavailable', 'override-clear']);
    const before = structuredClone(h.state().read);
    actions[1].fire('click');
    assert.equal(h.state().overrides[2], 'unavailable');
    actions[0].fire('click');
    assert.equal(h.state().overrides[2], 'available');
    actions[2].fire('click');
    assert.equal(Object.hasOwn(h.state().overrides, 2), false);
    assert.deepEqual(h.state().read, before);
  } finally { h.restore(); }
});

test('UX05 synopsis copy distinguishes not loaded from a completed empty result and held text', () => {
  const empty = Symbol('empty');
  assert.equal(synopsisFallback({ hydrated: true }, null, empty), 'Story summary has not been loaded.');
  assert.equal(synopsisFallback({ hydrated: false }, undefined, empty), 'Story summary has not been loaded.');
  assert.equal(synopsisFallback({ hydrated: true }, empty, empty), 'No synopsis is recorded for this issue.');
  assert.equal(synopsisFallback({ hydrated: true }, 'Held plot', empty), 'Held plot');
});

test('UX05 empty lists retain Add comics without review filters or no-match results', () => {
  const state = createList(createEmptyState(), { id: 'empty', name: 'Empty' });
  const h = harness({ state });
  try {
    h.view.render();
    assert.equal(h.nodes.readingEmpty.hidden, false);
    assert.equal(h.nodes['btn-review-earlier'].hidden, true);
    assert.equal(h.nodes.full.hidden, true);
    assert.equal(h.nodes.readingFilters.hidden, true);
    assert.equal(h.nodes.rows.childNodes.length, 0);
    assert.deepEqual(h.state().read, {});
  } finally { h.restore(); }
});

test('completed lists suppress queued hero, shelf and continuation banners without hiding the full order', () => {
  const state = setDeferred(seededState(), 'list-a', 3, true);
  const h = harness({ state, isCompleted: () => true });
  try {
    const before = JSON.stringify(h.state());
    h.view.render();
    assert.equal(h.nodes.hero.hidden, true);
    assert.equal(h.nodes.shelfSec.hidden, true);
    assert.equal(h.nodes.allRead.hidden, true);
    assert.equal(h.nodes['all-deferred'].hidden, true);
    assert.equal(h.nodes.readingBody.hidden, false);
    assert.equal(h.nodes.rows.childNodes.filter((entry) => entry.className.split(/\s+/).includes('row')).length, 3);
    assert.equal(h.nodes.ringSub.textContent, '1 of 3 read. 1 deferred');
    assert.equal(JSON.stringify(h.state()), before);
  } finally { h.restore(); }
});

test('completed lists ignore hidden Enter and D shortcuts until explicitly reopened', () => {
  let completed = true;
  const h = harness({ isCompleted: () => completed });
  try {
    h.view.wire();
    h.view.wireShortcuts();
    globalThis.document.activeElement = h.nodes.orderName;
    const before = JSON.stringify(h.state());
    for (const key of ['Enter', 'd', 'D']) {
      globalThis.document.listeners.keydown({ key, preventDefault() { throw new Error('Completed shortcut acted'); } });
    }
    assert.equal(h.calls.launch.length, 0);
    assert.equal(JSON.stringify(h.state()), before);
    completed = false;
    globalThis.document.listeners.keydown({ key: 'Enter', preventDefault() {} });
    assert.equal(h.calls.launch.length, 1);
    globalThis.document.listeners.keydown({ key: 'd', preventDefault() {} });
    assert.ok(h.state().read[2]);
  } finally { h.restore(); }
});

test('completed direct hero actions are guarded while manual rows and honest library removal remain usable', async () => {
  let confirmation;
  const h = harness({
    isCompleted: () => true,
    askConfirm: async (options) => { confirmation = options; return false; },
  });
  try {
    h.view.wire();
    h.view.render();
    const before = JSON.stringify(h.state());
    for (const button of [h.nodes.btnHeroRead, h.nodes.btnHeroDone, h.nodes.btnHeroInspect, h.nodes['btn-hero-defer']]) {
      button.fire('click', { preventDefault() {} });
    }
    assert.equal(h.calls.launch.length, 0);
    assert.equal(h.calls.issueFocus.length, 0);
    assert.equal(JSON.stringify(h.state()), before);
    let manual;
    walk(h.nodes.rows, (entry) => {
      if (entry.dataset?.act === 'read' && Number(entry.dataset.key) === 2) manual = entry;
    });
    assert.ok(manual);
    manual.fire('click');
    assert.ok(h.state().read[2]);
    await h.nodes.btnDeleteList.fire('click');
    assert.equal(confirmation.confirmLabel, 'Remove from library');
    assert.match(confirmation.body, /personal note and custom order.*read progress is kept.*Bundled Reading Lists are unchanged/);
  } finally { h.restore(); }
});

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
    h.view.renderReview();
    assert.equal(h.nodes['review-earlier'].hidden, true);
    assert.equal(h.nodes['btn-review-earlier'].hidden, true);
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

test('453 reader presentation invalidates memoized buttons without changing stored rows', () => {
  let temporary = false;
  const h = harness({ readerPresentation: () => ({ launchable: temporary, temporary }) });
  try {
    h.view.wire();
    h.view.render();
    const state = JSON.stringify(h.state());
    const oldRows = [...h.nodes.rows.childNodes];
    const oldDescription = h.nodes.heroDesc.textContent;
    assert.equal(h.nodes.btnHeroRead.hidden, true);
    temporary = true;
    h.view.refreshReader();
    assert.equal(h.nodes.btnHeroRead.hidden, false);
    assert.equal(h.nodes.btnHeroRead.textContent, 'Read');
    assert.match(h.nodes.btnHeroRead.attributes['aria-label'], /^Read: .* with temporary link$/);
    assert.equal(h.nodes.heroReaderTemporary.hidden, false);
    assert.equal(h.nodes.heroReaderTemporary.textContent, 'Using a temporary reader link.');
    assert.notDeepEqual(h.nodes.rows.childNodes, oldRows, 'effective presentation participates in cache key');
    const actions = [];
    walk(h.nodes.rows, (entry) => { if (entry.dataset?.act === 'open') actions.push(entry); });
    assert.ok(actions.length);
    for (const action of actions) {
      assert.equal(action.hidden, false);
      // This double keeps append() text in childNodes instead of aggregating textContent.
      assert.equal(action.textContent || action.childNodes.join(''), 'Read');
      assert.match(action.attributes['aria-label'], /temporary/);
      action.fire('click', {});
      assert.equal(h.calls.launch.at(-1)[2], 'saved');
    }
    const notices = [];
    for (const container of [h.nodes.rows, h.nodes.shelf]) {
      walk(container, (entry) => {
        if (entry.dataset?.readerTemporary) notices.push(entry);
        if (entry.dataset?.act === 'open') assert.equal(entry.textContent || entry.childNodes.join(''), 'Read');
      });
    }
    assert.ok(notices.length);
    assert.ok(notices.every((entry) => entry.textContent === 'Temporary reader link'));
    temporary = false;
    h.view.refreshReader();
    assert.equal(h.nodes.heroReaderTemporary.hidden, true);
    assert.equal(h.nodes.heroReaderTemporary.textContent, '');
    assert.equal(h.nodes.heroDesc.textContent, oldDescription);
    assert.equal(JSON.stringify(h.state()), state);
  } finally {
    h.restore();
  }
});

test('wire and render build reading controls and call launch inside the same gesture turn', () => {
  const h = harness();
  const originalWindow = globalThis.window;
  const originalStyle = globalThis.getComputedStyle;
  try {
    h.view.wire();
    h.view.render();

    assert.equal(h.nodes.orderName.textContent, 'List A');
    assert.equal(h.nodes.listNote.textContent, 'List note');
    assert.equal(h.nodes.btnListNote.textContent, 'Edit note');
    assert.equal(h.nodes.heroTitle.textContent, 'Issue Two');
    assert.equal(h.nodes.btnHeroRead.textContent, 'Read');
    assert.equal(h.nodes.btnHeroRead.attributes['aria-label'], 'Read: Issue Two in Marvel Unlimited');
    assert.equal(h.nodes.heroReaderTemporary.hidden, true);
    assert.equal(h.nodes.readingFilters.querySelectorAll('input[name="filter"]').length, READING_FILTERS.length);
    assert.equal(typeof h.nodes.btnHeroRead.listeners.click[0], 'function');

    h.calls.launch.length = 0;
    h.nodes.btnHeroRead.fire('click', { preventDefault() {} });
    assert.equal(h.calls.launch.length, 1, 'launch must happen during the click, not after a later tick');
    assert.equal(h.calls.launch[0][0].title, 'Issue Two');

    let navigationPrevented = false;
    h.nodes.saveEducationSettings.fire('click', {
      button: 0, preventDefault() { navigationPrevented = true; },
    });
    assert.equal(navigationPrevented, true);
    assert.deepEqual(h.calls.showView.at(-1), { name: 'data', opts: { push: true } });
    h.nodes.btnHydrate.fire('click');
    h.nodes.btnSynopsis.fire('click');
    h.nodes.btnCancelHydrate.fire('click');
    h.nodes.btnCancelSynopsis.fire('click');
    assert.deepEqual(h.calls.hydrate, ['list-a', 'cancel']);
    assert.deepEqual(h.calls.synopsis, ['start', 'cancel']);
    let toggle;
    walk(h.nodes.rows, (control) => { if (!toggle && control.dataset?.act === 'more') toggle = control; });
    assert.ok(toggle);
    const actions = toggle.parentNode;
    const scrolls = [];
    globalThis.window = { innerHeight: 900, scrollBy: (options) => scrolls.push(options) };
    let outline = 5;
    globalThis.getComputedStyle = () => ({ outlineWidth: `${outline - 2}px`, outlineOffset: '2px' });
    toggle.getBoundingClientRect = () => ({ left: 42, right: 278, top: 120.125, bottom: 164.125 });
    const filters = h.nodes.readingFilters;
    let bounds = { left: 17, right: 303, top: 0, bottom: 133.171875 };
    filters.getBoundingClientRect = () => bounds;
    const before = JSON.stringify(h.state());
    const announcements = h.calls.announce.length;
    const launches = h.calls.launch.length;
    for (const config of [
      { bottom: 133.171875, outline: 5, delta: 115.125 - 133.171875 },
      { bottom: 280.5, outline: 9, delta: 111.125 - 280.5 },
      { bottom: 280.5, hidden: true },
      { bottom: 90 },
      { bottom: 280.5, left: 290 },
    ]) {
      outline = config.outline ?? 5;
      bounds = { left: config.left ?? 17, right: 303, top: 0, bottom: config.bottom };
      filters.hidden = config.hidden ?? false;
      toggle.fire('click');
      assert.equal(actions.classList.contains('is-open'), true);
      let prevented = false;
      const count = scrolls.length;
      actions.fire('keydown', { key: 'Escape', preventDefault() { prevented = true; } });
      assert.equal(prevented, true);
      assert.equal(globalThis.document.activeElement, toggle, 'Escape retains the exact More toggle');
      assert.equal(actions.classList.contains('is-open'), false);
      assert.deepEqual(toggle.scrolled, { block: 'nearest' }, 'nearest reveal retains bottom clearance');
      assert.deepEqual(scrolls.slice(count), config.delta === undefined ? []
        : [{ top: config.delta, left: 0, behavior: 'instant' }]);
    }
    assert.equal(JSON.stringify(h.state()), before);
    assert.equal(h.calls.announce.length, announcements);
    assert.equal(h.calls.launch.length, launches);
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
    if (originalStyle === undefined) delete globalThis.getComputedStyle;
    else globalThis.getComputedStyle = originalStyle;
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

test('Done and D retire the reader hint, and Enter places it beside the hero Read', () => {
  const h = harness();
  try {
    h.view.wire();
    h.view.wireShortcuts();
    h.view.render();
    globalThis.document.listeners.keydown({ key: 'Enter', preventDefault() {}, altKey: false, ctrlKey: false, metaKey: false });
    assert.equal(h.calls.launch.length, 1);
    assert.equal(h.calls.launch[0][3], h.nodes.btnHeroRead, 'Enter launches what the hero offers, so its hint goes there');
    h.nodes.btnHeroRead.fire('click', { preventDefault() {} });
    assert.equal(h.calls.launch.length, 2);
    assert.equal(h.calls.launch[1][3], undefined, 'a click names its own control through the event');
    assert.equal(h.calls.retireReaderHelp, 0, 'reading and rendering leave the hint in place');
    h.nodes.btnHeroDone.fire('click');
    assert.equal(h.calls.retireReaderHelp, 1, 'Done retires the hint');
    assert.ok(h.state().read['2'], 'and still marks the comic it was pressed for');
    globalThis.document.listeners.keydown({ key: 'd', preventDefault() {}, altKey: false, ctrlKey: false, metaKey: false });
    assert.equal(h.calls.retireReaderHelp, 2, 'D retires the hint');
    assert.ok(h.state().read['3']);
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
    assert.match(notice.msg, /Removed List A from your library/);

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
    assert.match(h.calls.announce.at(-1), /back in your library/);

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

test('arriving with no list leaves focus alone, while removing the active list still focuses Home', async () => {
  const arrival = harness({ state: createEmptyState() });
  try {
    arrival.nodes.viewRead.hidden = true;
    arrival.view.render();
    assert.deepEqual(arrival.calls.showView.filter((call) => call.name), [{ name: 'home', opts: { focus: false } }],
      'boot renders before any view is shown, so there is no reading view to leave');
  } finally {
    arrival.restore();
  }

  let solo = createList(createEmptyState(), { id: 'solo', name: 'Solo' });
  solo = setActive(addIssuesToList(solo, 'solo', [issue(1, 'Issue One')], {}).state, 'solo');
  const h = removalHarness({ state: solo });
  try {
    h.calls.showView.length = 0;
    h.nodes.btnDeleteList.focus();
    await h.nodes.btnDeleteList.fire('click');
    assert.equal(Boolean(h.state().lists.solo), false);
    assert.deepEqual(h.calls.showView.filter((call) => call.name), [{ name: 'home', opts: { focus: true } }],
      'the reader was on the reading view, so the Home heading takes focus');
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
    /function showView\([^)]*\) \{\s*retireReaderHelp\(\); readingView\.retireDoneResult\(\);/,
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

test('510 Reading deferral, Done, shelf and review agree without false completion or source changes', () => {
  const h = removalHarness({ fullOpen: false, state: markRead(seededState(), 1, false) });
  try {
    const ids = [...h.state().lists['list-a'].itemIds];
    h.nodes['btn-hero-defer'].fire('click');
    assert.equal(isDeferred(h.state(), 'list-a', 1), true);
    assert.equal(h.nodes.heroTitle.textContent, h.state().issues[2].title);
    assert.equal(h.nodes.shelf.childNodes.length, 1);
    h.nodes['btn-hero-defer'].fire('click');
    h.nodes.btnHeroDone.fire('click');
    assert.equal(h.nodes.allRead.hidden, true);
    assert.equal(h.nodes['all-deferred'].hidden, false);
    assert.equal(globalThis.document.activeElement, h.nodes['all-deferred-h']);
    assert.match(h.calls.announce.at(-1), /Nothing queued.*2 unread issues are deferred/);
    assert.deepEqual(listReadingProgress(h.state(), 'list-a'), { read: 1, total: 3, deferred: 2, queued: 0 });
    assert.deepEqual(h.state().lists['list-a'].itemIds, ids);
    h.nodes['btn-review-deferred'].fire('click');
    assert.equal(h.nodes.full.open, true);
    assert.equal(h.view.currentFilter(), 'deferred');
    assert.equal(globalThis.document.activeElement.value, 'deferred');
    assert.deepEqual(h.calls.showView.at(-1), { name: 'read', opts: { push: true, focus: false } });
    const actions = [];
    walk(h.nodes.rows, (entry) => { if (entry.dataset?.act === 'defer') actions.push(entry); });
    assert.equal(actions.length, 2);
    actions[0].fire('click');
    assert.equal(isDeferred(h.state(), 'list-a', 1), false);
    assert.equal(h.nodes.heroTitle.textContent, h.state().issues[1].title);
    assert.deepEqual(h.state().lists['list-a'].itemIds, ids);
  } finally { h.restore(); }
});

test('510 failed deferral keeps the same hero, focus and bytes without a success announcement', () => {
  const h = removalHarness();
  try {
    h.nodes['btn-hero-defer'].focus();
    const before = h.storage.getItem(KEY);
    const title = h.nodes.heroTitle.textContent;
    h.storage.failWrites = 1;
    h.nodes['btn-hero-defer'].fire('click');
    assert.equal(h.storage.getItem(KEY), before);
    assert.equal(h.nodes.heroTitle.textContent, title);
    assert.equal(globalThis.document.activeElement, h.nodes['btn-hero-defer']);
    assert.match(h.calls.announce.at(-1), /could not be saved/);
  } finally { h.restore(); }
});

test('510 membership Undo retains later member choices and latent intent through global read changes', () => {
  const h = removalHarness();
  try {
    h.store.update((state) => setDeferred(state, 'list-a', 2));
    removalAction(h, 2).fire('click');
    const offer = removalOffer(h);
    h.store.update((state) => markRead(setDeferred(state, 'list-a', 3), 2, true, 510));
    assert.equal(removalOffer(h), offer);
    offer.action.onClick();
    assert.deepEqual(h.state().lists['list-a'].deferredIssueIds, [2, 3]);
    assert.equal(h.state().read[2], 510);
    assert.equal(listReadingProgress(h.state(), 'list-a').deferred, 1);
    h.store.update((state) => markRead(state, 2, false));
    assert.equal(listReadingProgress(h.state(), 'list-a').deferred, 2);
  } finally { h.restore(); }
});

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

test('renderRows separates individual issues after an edition without changing saved metadata', () => {
  let state = createList(createEmptyState(), { id: 'mixed', name: 'Mixed originals' });
  state = addIssuesToList(state, 'mixed', [
    issue(1, 'First individual issue'),
    issue(2, 'First collected issue', { collectedIn: 'Edition One' }),
    issue(3, 'Later individual issue'),
    issue(4, 'Later collected issue', { collectedIn: 'Edition One' }),
  ]).state;
  const h = harness({ state, fullOpen: true });
  try {
    const original = JSON.stringify(h.state());
    h.view.renderRows();
    const headings = () => h.nodes.rows.childNodes
      .filter((entry) => entry.classList.contains('row-group'));
    assert.deepEqual(headings().map((entry) => entry.childNodes[0].textContent),
      ['Edition One', 'Individual issues', 'Edition One']);
    assert.equal(h.nodes.rows.childNodes[0].classList.contains('row'), true,
      'leading individual issues keep their existing presentation');
    const individual = headings()[1];
    assert.equal(individual.childNodes[1].textContent, '0 of 1 read');
    h.view.renderRows();
    assert.equal(headings()[1], individual, 'the individual-issue boundary is cached like an edition boundary');
    assert.equal(JSON.stringify(h.state()), original);
  } finally {
    h.restore();
  }
  for (const [edition, expected] of [[null, []], ['Edition One', ['Edition One']]]) {
    let grouped = createList(createEmptyState(), { id: 'uniform', name: 'Uniform originals' });
    grouped = addIssuesToList(grouped, 'uniform', [
      issue(1, 'Issue One', { collectedIn: edition }),
      issue(2, 'Issue Two', { collectedIn: edition }),
    ]).state;
    const uniform = harness({ state: grouped, fullOpen: true });
    try {
      uniform.view.renderRows();
      assert.deepEqual(uniform.nodes.rows.childNodes
        .filter((entry) => entry.classList.contains('row-group'))
        .map((entry) => entry.childNodes[0].textContent), expected);
    } finally {
      uniform.restore();
    }
  }
});

// UX-02 (#829): Done's visible result and Undo. Undo is recovery code in the progress path, so most
// of these press it in the states that make recovery dangerous rather than in the easy one.

function doneResultNode(h) {
  const found = [];
  for (const root of [h.nodes.hero, h.nodes.allRead, h.nodes['all-deferred']]) {
    walk(root, (entry) => { if (entry.id === 'done-result') found.push(entry); });
  }
  assert.ok(found.length <= 1, `at most one result is on the page, found ${found.length}`);
  return found[0] ?? null;
}

function doneParts(h) {
  const result = doneResultNode(h);
  if (!result) return null;
  const [message, button = null] = result.childNodes;
  return {
    result, button, kind: result.className, message: message.textContent,
    label: button?.childNodes.filter((child) => typeof child === 'string').join('') ?? null,
    name: button?.attributes['aria-label'] ?? null,
  };
}

const nextAfter = (anchor) => anchor.parentNode.childNodes[anchor.parentNode.childNodes.indexOf(anchor) + 1];
const keyPress = (key, extra = {}) => ({
  key, altKey: false, ctrlKey: false, metaKey: false, ...extra, preventDefault() { this.prevented = true; },
});

// The saved reading data minus the two stamps every write renews, so equal means nothing a reader
// owns differs.
const withoutStamps = ({ writeToken: _token, exportedAt: _stamp, ...content }) => content;
const savedContent = (h) => JSON.stringify(withoutStamps(JSON.parse(h.storage.getItem(KEY))));

function pressDone(h) {
  h.nodes.btnHeroDone.focus();
  h.nodes.btnHeroDone.fire('click');
  return doneParts(h);
}

// The production save path answers null when the mark was not saved, which is what stops a refused
// Done from being announced. The ordinary stub always answers yes.
const savedOnly = ({ wasRead, state, issueId }) => (Object.hasOwn(state.read, issueId) === wasRead ? null : {});

test('UX-02 Done and D show one result naming the comic under the commands, and say Undo once', () => {
  const h = removalHarness();
  try {
    h.view.wireShortcuts();
    const done = pressDone(h);
    assert.ok(done, 'Done leaves a visible result');
    assert.equal(nextAfter(h.nodes.heroPrimaryActions), done.result, 'directly under Read and Done, so neither moves');
    assert.equal(done.message, 'Marked Issue Two read.');
    assert.equal(done.label, 'Undo');
    assert.equal(done.name, 'Undo: mark Issue Two unread', 'the name keeps the visible label and adds the comic');
    assert.equal(done.kind, 'notice notice-ok notice-act', 'the shared notice pattern');
    assert.equal(done.result.attributes['aria-live'] ?? done.result.role ?? null, null, 'not a second live region');
    assert.deepEqual(h.calls.announce, ['Issue Two marked read. Next up: Issue Three. Undo is available.']);
    assert.equal(h.calls.notify.length, 0, 'no notice pane says it a second time');
    assert.equal(globalThis.document.activeElement, h.nodes.btnHeroDone, 'focus stays on Done');

    globalThis.document.listeners.keydown(keyPress('d'));
    const last = doneParts(h);
    assert.equal(done.result.isConnected, false, 'the next Done retires the earlier result');
    assert.equal(last.message, 'Marked Issue Three read.');
    assert.equal(nextAfter(h.nodes.allReadHeading), last.result, 'with the hero gone it goes under the heading that replaced it');
    assert.equal(globalThis.document.activeElement, h.nodes.allReadHeading, 'the end state keeps its heading focus');
    assert.deepEqual(h.calls.announce.slice(1), ['Issue Three marked read. That is the whole order finished. Undo is available.']);
  } finally { h.restore(); }
});

test('UX-02 Undo puts back every saved byte, deferral, hero and focus, then confirms in place', () => {
  for (const [name, state] of [
    ['next comic', seededState()],
    ['nothing left queued', setDeferred(seededState(), 'list-a', 3)],
  ]) {
    const h = removalHarness({ state });
    try {
      const before = savedContent(h);
      const done = pressDone(h);
      assert.notEqual(savedContent(h), before, `${name}: Done saved`);
      done.button.focus();
      done.button.fire('click');
      assert.equal(savedContent(h), before, `${name}: Undo restores exactly what Done replaced`);
      assert.equal(h.nodes.hero.hidden, false, name);
      assert.equal(h.nodes.heroTitle.textContent, 'Issue Two', `${name}: the previous hero is back`);
      assert.equal(globalThis.document.activeElement, h.nodes.btnHeroDone, `${name}: focus returns to Done`);
      const confirmed = doneParts(h);
      assert.equal(confirmed.message, 'Marked Issue Two unread. It is up next again.', name);
      assert.equal(confirmed.button, null, `${name}: the confirmation offers nothing to press twice`);
      assert.equal(nextAfter(h.nodes.heroPrimaryActions), confirmed.result, `${name}: under the commands again`);
      assert.equal(h.calls.announce.length, 2, `${name}: one announcement for Done and one for Undo`);
      assert.equal(h.calls.announce[1], 'Marked Issue Two unread. It is up next again.', name);
    } finally { h.restore(); }
  }
});

test('UX-02 a second Undo press changes nothing and says so', () => {
  const h = removalHarness();
  try {
    const done = pressDone(h);
    done.button.fire('click');
    const undone = savedContent(h);
    const confirmation = doneResultNode(h);
    done.button.fire('click');
    assert.equal(savedContent(h), undone, 'the stale button cannot write');
    assert.equal(doneResultNode(h), confirmation, 'the confirmation stays as it was');
    assert.equal(h.calls.announce.at(-1), 'Undo is no longer available for Issue Two.');
  } finally { h.restore(); }
});

test('UX-02 any change Undo could not reverse exactly withdraws the offer on the repaint that makes it', () => {
  const edits = [
    ['reorder', (state) => moveItem(state, 'list-a', 3, -1)],
    ['add an issue', (state) => addIssuesToList(state, 'list-a', [issue(6, 'Six')]).state],
    ['remove another issue', (state) => removeFromList(state, 'list-a', 3)],
    ['defer another issue', (state) => setDeferred(state, 'list-a', 3)],
    ['marked unread another way', (state) => markRead(state, 2, false)],
    ['marked read again another way', (state) => markRead(markRead(state, 2, false), 2, true, 829)],
    ['an earlier comic marked unread', (state) => markRead(state, 1, false)],
    ['list removed', (state) => deleteList(state, 'list-a')],
    ['another list opened', (state) => setActive(state, 'list-b')],
    ['another tab saved', null],
  ];
  for (const [name, edit] of edits) {
    const h = removalHarness();
    try {
      const done = pressDone(h);
      if (edit) {
        h.store.update(edit);
      } else {
        const foreign = JSON.stringify({ writeToken: 'foreign-829', ...exportBackup(h.state()) });
        h.storage.map.set(KEY, foreign);
        h.store.adoptForeignWrite(foreign);
      }
      assert.equal(doneParts(h), null, `${name}: withdrawn`);
      assert.equal(done.result.isConnected, false, name);
      const raw = h.storage.getItem(KEY);
      done.button.fire('click');
      assert.equal(h.storage.getItem(KEY), raw, `${name}: the withdrawn button cannot write`);
      assert.equal(h.calls.announce.at(-1), 'Undo is no longer available for Issue Two.', name);
    } finally { h.restore(); }
  }
});

test('UX-02 a rename, notes and changes outside the list keep the offer, and Undo still restores exactly', () => {
  const h = removalHarness();
  try {
    const done = pressDone(h);
    h.store.update((state) => {
      let next = renameList(state, 'list-a', 'Renamed list');
      next = setListNote(next, 'list-a', 'Later list note');
      next = setIssueNote(next, 2, 'Later issue note');
      next = setOverride(next, 2, 'available');
      next = upsertIssue(next, { issueId: 3, title: 'Issue Three', hydrated: true });
      return markRead(next, 4, true, 829);
    });
    assert.equal(doneResultNode(h), done.result, 'the same offer stays');
    const edited = h.state();
    done.button.fire('click');
    const restored = h.state();
    assert.equal(restored.read[2], undefined);
    for (const key of ['issues', 'notes', 'overrides', 'lists', 'listOrder', 'active']) {
      assert.equal(restored[key], edited[key], `${key} is untouched by Undo`);
    }
    assert.equal(restored.read[4], 829, 'a read change in another list survives');
    assert.equal(h.nodes.heroTitle.textContent, 'Issue Two');
  } finally { h.restore(); }
});

test('UX-02 a refused Undo save keeps the comic read and offers Try again beside it until one succeeds', () => {
  const h = removalHarness();
  try {
    const done = pressDone(h);
    const marked = savedContent(h);
    done.button.focus();
    h.storage.failWrites = 1;
    done.button.fire('click');
    assert.equal(savedContent(h), marked, 'nothing was written');
    assert.ok(h.state().read[2], 'the comic is still marked read');
    assert.match(h.calls.storeChanges.at(-1).error, /not saved/, 'the Store reported why');
    const retry = doneParts(h);
    assert.equal(retry.message, 'Issue Two is still marked read: that change could not be saved.');
    assert.equal(retry.label, 'Try again');
    assert.equal(retry.name, 'Try again: mark Issue Two unread');
    assert.equal(retry.kind, 'notice notice-error notice-act');
    assert.equal(globalThis.document.activeElement, retry.button, 'focus moves to the retry it replaced');
    assert.equal(h.calls.announce.length, 1, 'the Store alert explains the failure, so the view adds no second announcement');
    retry.button.fire('click');
    assert.equal(h.state().read[2], undefined);
    assert.equal(doneParts(h).message, 'Marked Issue Two unread. It is up next again.');
  } finally { h.restore(); }
});

test('UX-02 another tab saving under the press refuses Undo without writing over its data', () => {
  const h = removalHarness();
  try {
    const done = pressDone(h);
    done.button.focus();
    // Written but not yet adopted: the storage event reaches this tab 50 ms later.
    const foreign = JSON.stringify({ writeToken: 'foreign-829', ...exportBackup(markRead(h.state(), 3, true, 829)) });
    h.storage.map.set(KEY, foreign);
    done.button.fire('click');
    assert.equal(h.storage.getItem(KEY), foreign, 'the other tab keeps its save');
    assert.match(h.calls.storeChanges.at(-1).error, /Another tab saved newer data/);
    const refused = doneParts(h);
    assert.equal(refused.message, 'Undo is no longer available because the Reading List changed. You can still mark Issue Two unread in the full Reading List.');
    assert.equal(refused.button, null);
    assert.equal(nextAfter(h.nodes.allReadHeading), refused.result, 'the refusal moves to where the reader now is');
    assert.equal(globalThis.document.activeElement, h.nodes.allReadHeading, 'focus leaves the removed Undo');
    assert.equal(h.calls.announce.length, 1, 'the Store alert has already spoken');
  } finally { h.restore(); }
});

test('UX-02 Undo refuses and says so when the context changed without a repaint', () => {
  let completed = false;
  const h = removalHarness({ isCompleted: () => completed });
  try {
    const done = pressDone(h);
    done.button.focus();
    completed = true;
    const before = savedContent(h);
    done.button.fire('click');
    assert.equal(savedContent(h), before);
    const refused = doneParts(h);
    assert.match(refused.message, /^Undo is no longer available because the Reading List changed\./);
    assert.equal(h.calls.announce.at(-1), refused.message, 'nothing else has explained it, so it is announced');
    assert.equal(globalThis.document.activeElement, h.nodes.btnHeroDone);
  } finally { h.restore(); }
});

test('UX-02 navigation and the set time retire the result; pointing at or focusing it holds the time', () => {
  const linger = DONE_RESULT_MS * 6;
  for (const hold of ['none', 'pointer', 'focus', 'both']) {
    const h = removalHarness();
    try {
      h.useFakeTimers();
      const { result } = pressDone(h);
      if (hold === 'pointer' || hold === 'both') result.fire('pointerenter');
      if (hold === 'focus' || hold === 'both') result.fire('focusin');
      h.advance(DONE_RESULT_MS - 1);
      assert.equal(result.isConnected, true, `${hold}: still there just before the set time`);
      h.advance(1);
      assert.equal(result.isConnected, hold !== 'none', `${hold}: retired at the set time unless held`);
      if (hold === 'none') continue;
      h.advance(linger);
      assert.equal(result.isConnected, true, `${hold}: held as long as the reader is there`);
      if (hold === 'both') {
        result.fire('pointerleave');
        h.advance(linger);
        assert.equal(result.isConnected, true, 'focus still holds it after the pointer leaves');
      }
      result.fire('focusout', { relatedTarget: doneParts(h).button });
      if (hold !== 'pointer') {
        h.advance(linger);
        assert.equal(result.isConnected, true, `${hold}: focus moving within it still holds it`);
      }
      result.fire(hold === 'pointer' ? 'pointerleave' : 'focusout', { relatedTarget: null });
      h.advance(DONE_RESULT_MS - 1);
      assert.equal(result.isConnected, true, `${hold}: the time restarts in full when the reader leaves`);
      h.advance(1);
      assert.equal(result.isConnected, false, hold);
    } finally { h.restore(); }
  }

  const h = removalHarness();
  try {
    h.useFakeTimers();
    const done = pressDone(h);
    h.view.retireDoneResult();
    assert.equal(done.result.isConnected, false, 'navigation retires it');
    assert.equal(h.pendingTimers(), 0, 'and its timer');
    h.view.render();
    assert.equal(doneParts(h), null, 'returning to the list does not bring it back');
    const raw = h.storage.getItem(KEY);
    done.button.fire('click');
    assert.equal(h.storage.getItem(KEY), raw, 'nor can its button write');
    assert.ok(h.state().read[2], 'and the mark stays saved');
  } finally { h.restore(); }
});

test('UX-02 a held Enter on Done acts once, as a held D does', () => {
  const h = removalHarness();
  try {
    const held = keyPress('Enter', { repeat: true });
    h.nodes.btnHeroDone.fire('keydown', held);
    assert.equal(held.prevented, true, 'an auto-repeated Enter does not activate Done again');
    for (const press of [keyPress('Enter', { repeat: false }), keyPress(' ', { repeat: true })]) {
      h.nodes.btnHeroDone.fire('keydown', press);
      assert.equal(press.prevented, undefined, `${JSON.stringify(press.key)} keeps its native activation`);
    }
  } finally { h.restore(); }
});

test('UX-02 a refused Done offers nothing, and Undo lands on Done wherever D was pressed', () => {
  const h = removalHarness({ recordDirectProgressSave: savedOnly });
  try {
    const first = pressDone(h);
    h.storage.failWrites = 1;
    pressDone(h);
    assert.equal(h.state().read[3], undefined);
    assert.equal(doneParts(h), null, 'no result claims a mark that was not saved');
    assert.equal(first.result.isConnected, false, 'the next Done retired the earlier offer');
    assert.equal(h.calls.announce.length, 1, 'and nothing was announced for it');
  } finally { h.restore(); }

  const longer = removalHarness({
    state: addIssuesToList(seededState(), 'list-a', [issue(6, 'Issue Six'), issue(7, 'Issue Seven')]).state,
  });
  try {
    longer.view.wireShortcuts();
    const done = pressDone(longer);
    done.button.focus();
    globalThis.document.listeners.keydown(keyPress('d'));
    assert.equal(done.result.isConnected, false);
    assert.equal(globalThis.document.activeElement, longer.nodes.btnHeroDone, 'focus lands on the control the press belongs to');
    assert.equal(doneParts(longer).message, 'Marked Issue Three read.');
    longer.nodes.btnHeroRead.focus();
    globalThis.document.listeners.keydown(keyPress('d'));
    assert.equal(globalThis.document.activeElement, longer.nodes.btnHeroRead, 'D leaves focus where it was');
    doneParts(longer).button.fire('click');
    assert.equal(longer.nodes.heroTitle.textContent, 'Issue Six');
    assert.equal(globalThis.document.activeElement, longer.nodes.btnHeroDone, 'after Undo focus is on Done, wherever D was pressed');
  } finally { longer.restore(); }
});
