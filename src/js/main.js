// Application controller.
//
// Rendering follows the "Longbox Focus" design: a rail of reading orders, one hero card for
// the next unread issue, a short cover shelf, and the full order collapsed behind a summary.
// Cover art is optional everywhere: with it off no cover is requested and every image is
// replaced by a typographic tile.

import {
  createList, deleteList, setActive, addIssuesToList, isRead, upNext, listProgress, listItems, exportBackup, migrate,
  coverUrl, listForCatalogId, SCHEMA_VERSION, MAX_BACKUP_BYTES, orderGapSentences,
} from './lib/model.js';
import { serializeChecklist } from './lib/markdown.js';
import { DEFAULT_LIST_NAME, LIBRARY_VIEWS } from './lib/library.js';
import {
  parseCatalog, groupCatalog,
  pathPlacements, resolveReadingPaths, availableHomeCategories, HOME_CATEGORIES,
  availablePublishingCategories, isPublishingCategoryLeaf, publishingAgeGroups, publishingCategoryStories,
  timelineYears,
  catalogListShelf, CATALOG_SHELVES, PUBLISHING_CATEGORIES,
  modernTimelineFeaturedList, modernTimelineFeaturedCard,
} from './lib/catalog.js';
import { Store, KEY as STATE_KEY } from './storage.js';
import { MarvelApi, DEFAULT_BASE } from './api.js';
import { ResponseCache } from './cache.js';
import { RateLimiter } from './lib/limiter.js';
import { Hydrator } from './hydrate.js';
import { NO_SYNOPSIS, SessionSynopsis, SynopsisRunner } from './synopsis.js';
import { openIssue as openIssueTab, detailUrl } from './reader.js';
import { APP_VERSION } from './lib/version.js';
import { isAllowedApiBase } from './lib/apiBase.js';
import { lookupIssue } from './lib/wiki.js';
import { DEFAULT_FILTER } from './lib/readingFilters.js';
import { DEFAULT_THEME, themeAttribute, normaliseTheme } from './lib/theme.js';
import {
  ADD_VIEWS, VIEWS, breadcrumbHierarchy, formatRoute, parseRoute,
} from './lib/route.js';
import { labelledName } from './lib/accname.js';
import { askConfirm, askText, askNote, wireAsk } from './ask.js';
import {
  SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE, createSaveEducation,
} from './lib/saveEducation.js';
import { checkLocalServer, LOCAL_SERVER_STATUS } from './lib/localServer.js';
import { createLibraryView } from './views/library.js';
import { createProgressView } from './views/progress.js';
import { createSavedListsPresenter } from './views/shared/saved-lists.js';
import { createIssueView } from './views/issue.js';
import { createReadingView, synopsisFallback } from './views/reading.js';
import { createHomeView } from './views/home.js';
import { createCatalogPresentation } from './views/shared/catalog-presentation.js';
import { createCatalogView } from './views/catalog.js';
import { createPreviewView } from './views/preview.js';
import { createReadingPathsView } from './views/reading-paths.js';
import { createAddView, persistLongAddPage } from './views/add.js';
import { createDataView, eraseOutcome } from './views/data.js';
import { createRecoveryView } from './views/recovery.js';

const SETTINGS_KEY = 'mrt.settings';
export const CACHE_PURGE_KEY = 'mrt.cache-purge.v1';
const SIDEBAR_KEY = 'sidebar.collapsed';
// Below this viewport width the rail collapses on its own; a manual toggle then wins until
// the breakpoint is crossed again.
const RAIL_BREAKPOINT = 1000;
// What the hero's heading says when there is no next issue to name. The hero is hidden in
// that state, so this is never read aloud or seen; it exists so the heading is never empty.
// It has to match the text in index.html, which is what the document starts out holding.
const HERO_NO_ISSUE = 'Nothing up next';

const $ = (sel) => document.querySelector(sel);
// Read on use rather than at module load. This one query was the only thing this module did to
// the document while it was being evaluated, and it was what made the file impossible to import
// in Node: the ReferenceError landed before any test body ran, so no double could be installed
// early enough to prevent it. Resolved once per announcement rather than cached, because
// announcements are user-paced and a lookup costs nothing beside the 30ms wait below.
const announcer = () => $('#announcer');

const settings = loadSettings();
const limiter = new RateLimiter();
let cache = new ResponseCache({ baseUrl: settings.apiBase });
let api = new MarvelApi({ baseUrl: settings.apiBase, limiter, cache, onStatus: onApiStatus });

// A failed write must be visible. The store rolls the change back and reports why, but that
// report was previously discarded here, so the UI would announce "marked read" while the row
// silently reverted on the next paint.
const store = new Store({
  onChange: (_state, err) => {
    renderAll();
    if (err) notify('#save-report', err, 'error');
  },
});
const saveEducation = createSaveEducation({ storage: globalThis.localStorage });
const hydrator = new Hydrator({ api, store, onProgress: onHydrationStatus });
// One store for the tab, deliberately module-level and deliberately not persisted. It is passed to
// the runner rather than owned by it so the view can read a fetched synopsis without importing the
// thing that fetches it.
const sessionSynopsis = new SessionSynopsis();
const synopsisRunner = new SynopsisRunner({ api, store, session: sessionSynopsis, onProgress: onSynopsisStatus });

// One key, every tab. A save in another tab is news here, and taking it is what keeps two tabs
// ordinary: this tab re-renders on their save, so its next edit is built on what is actually stored
// and the store's compare-before-write never has to refuse it.
//
// key is null when the whole origin is cleared rather than one key removed, which is an erase this
// tab must not write its old snapshot back over, so it is passed on as the same absence.
// addEventListener is optional-called because this module is imported by tests in Node, where the
// global has no listener to add and there is no second tab to hear from.
export function dispatchStorageEvent(
  event,
  {
    readerStore = store,
    education = saveEducation,
    renderEducation = renderSaveEducation,
  } = {},
) {
  if (event.key === STATE_KEY) {
    const sanitizeCurrent = () => (sanitizeStoredIssueDescriptions(readerStore, event.newValue, {
      adoptCurrent: true,
      onFailure: (error) => notify('#save-report', error, 'error'),
    }), readingPathsView.refreshProgress());
    if (readerStore === store) {
      clearTimeout(foreignStateSanitationTimer);
      foreignStateSanitationTimer = setTimeout(sanitizeCurrent, 50);
    } else {
      sanitizeCurrent();
    }
    return;
  }
  if (event.key === SAVE_EDUCATION_KEY) {
    education.adopt(event.newValue);
    renderEducation();
    return;
  }
  if (event.key === null) {
    readerStore.adoptForeignWrite(null); readingPathsView.refreshProgress();
    education.adopt(null);
    renderEducation();
  }
}

let foreignStateSanitationTimer = null;

globalThis.addEventListener?.('storage', dispatchStorageEvent);

let view = 'read';
let issueRoute = null;
let issueSynopsisId = null;

// ------------------------------------------------------------------ unreadable-data recovery

// ------------------------------------------------------------------ helpers

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    // Presentation goes through the CSSOM, never a style attribute. Writing a style
    // attribute is what `style-src-attr` blocks under the Content-Security-Policy the
    // server sends, so `style` here takes an object of declarations.
    else if (k === 'style') for (const [p, pv] of Object.entries(v)) node.style.setProperty(p, pv);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) {
    if (c == null) continue;
    node.append(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return node;
}

// A list rebuilt with replaceChildren destroys the node that had focus, and the browser drops focus
// to <body>. Measured in Edge with the full order disclosure open: focus a row's checkbox, click it,
// read document.activeElement immediately afterwards, and it reports BODY. A reader working down
// the order lost their place on every mark-read, every reorder and every removal. The hero escapes
// this because its buttons are static markup the re-render leaves in place, which is why the focus
// work in BL-026 stopped where it did.
//
// A node cannot be restored, because the node is gone. What is restored is the identity the node
// carried: which thing the control acts on, and which action it is. Both are written onto every
// control these lists build, so the same pair can be found again in the rebuilt DOM. That thing is
// an issue in the reading lists, a reading order in the rail and a catalog entry on the home grid.
// The key is only ever compared against controls in the same container, so one attribute serves all
// three; it was named `issue` while the reading lists were the only caller, which stopped being
// true in BL-058.
//
// `primary` is the action to land on when that pair no longer exists anywhere, which happens when
// the row is filtered away by the very act that was performed on it. Landing on the same action in
// the row that took its place would put focus on a destructive control the reader did not aim at:
// Enter auto-repeats on a held key, so restoring "Remove" under a finger already on Enter can
// delete the next issue too. The row's primary control is the honest landing instead.
//
// Capture and restore are separate functions because one caller cannot use them around a single
// rebuild. Adding from the home grid disables the button it was launched from, and disabling a
// focused control blurs it there and then, so by the time the grid rebuilds there is nothing left
// to read. That caller captures before the disable. Everyone else wants the pair together, which is
// what preservingFocus still is.

// Entries that carry no control are the filter hint and the "showing n of m" footer. Counting
// them would aim the ordinal at a line that has nothing to focus.
const focusEntries = (container) => [...container.children].filter((n) => n.querySelector('[data-act]'));

function captureFocus(container) {
  const prior = container.contains(document.activeElement) ? document.activeElement : null;
  return {
    container,
    act: prior?.dataset.act ?? null,
    key: prior?.dataset.key ?? null,
    ordinal: prior ? focusEntries(container).indexOf(prior.closest('li')) : -1,
  };
}

function restoreFocus(held, { primary, fallback } = {}) {
  if (!held?.act) return;
  const { container, act, key, ordinal } = held;
  const controls = [...container.querySelectorAll('[data-act]')];
  const exact = controls.find((c) => c.dataset.key === key && c.dataset.act === act) ?? null;
  const remaining = focusEntries(container);
  const heir = ordinal < 0 || remaining.length === 0
    ? null
    : remaining[Math.min(ordinal, remaining.length - 1)];
  const target = exact
    ?? heir?.querySelector(`[data-act="${primary}"]`)
    ?? fallback?.()
    ?? null;
  // The control the reader was already on is by definition where they were looking, so scrolling it
  // into view can only move the page under them. Anything else is somewhere they have not looked
  // yet, so the browser is left to bring it into view.
  target?.focus({ preventScroll: target === exact });
}

function preservingFocus(container, rebuild, opts) {
  const held = captureFocus(container);
  rebuild();
  restoreFocus(held, opts);
}

// Two announcements produced by one action used to leave only the second. Both writes are
// scheduled at the same delay, so they land back to back in one timer phase with no rendering
// opportunity between them, and the accessibility tree observes only the last value written.
// Giving hydration a start announcement made that reachable on every add and every import,
// where it destroyed the confirmation that the issues had been added at all, and that message
// has no visible live surface to fall back on. They are joined instead of replaced, because two
// messages raised by a single action are one thing to say, and saying only the later half of it
// is the failure this channel exists to prevent.
//
// Split from the element it writes to so a whole tick can be replayed against it in a test. The
// node is resolved by open() once per utterance rather than per message, which is what keeps
// both halves of a joined message on the same element.
export function announceChannel(open, after) {
  let pending = null;
  return (msg) => {
    if (pending) {
      pending.msg += ` ${msg}`;
      return;
    }
    const write = open();
    const slot = { msg };
    pending = slot;
    after(() => {
      pending = null;
      write(slot.msg);
    });
  };
}

const announce = announceChannel(
  () => {
    // Resolved once and reused, so both writes land on the same element even if the document
    // changes under us between them.
    const node = announcer();
    node.textContent = '';
    return (msg) => { node.textContent = msg; };
  },
  // Re-setting after a tick makes screen readers re-announce identical messages.
  (fn) => setTimeout(fn, 30),
);

// A success message must never outlive the write it describes. store.update rolls the change
// back when persistence fails, so every announcement has to consult the result first,
// otherwise a screen-reader user hears "List deleted" for a deletion that did not happen.
function announceIfSaved(msg) {
  if (store.lastUpdateOk) announce(msg);
}

const SAVE_EDUCATION_ANNOUNCEMENT =
  'Your lists and progress save automatically in this browser; '
  + 'use Backup & settings for a copy you can restore elsewhere.';

export function withSaveEducation(message, transition) {
  if (transition?.previous !== SAVE_EDUCATION_STATE.UNSEEN || !transition.changed) return message;
  return `${message} ${SAVE_EDUCATION_ANNOUNCEMENT}`;
}

function renderSaveEducation() {
  const host = $('#save-education');
  if (!host) return;
  const listId = activeListId() ?? '';
  const list = Object.hasOwn(store.state.lists, listId) ? store.state.lists[listId] : null;
  const hidden = saveEducation.current() !== SAVE_EDUCATION_STATE.EXPLAINING
    || store.blocked
    || !list
    || list.itemIds.length === 0;
  if (hidden && !host.hidden && host.contains(document.activeElement)) focusViewHeading('read');
  host.hidden = hidden;
}

function recordNonEmptyListSave({ ok, added, listId }) {
  const list = Object.hasOwn(store.state.lists, listId) ? store.state.lists[listId] : null;
  if (!ok || added <= 0 || !list || list.itemIds.length === 0) return null;
  const transition = saveEducation.begin();
  renderSaveEducation();
  return transition;
}

function recordDirectProgressSave({ wasRead, state, issueId }) {
  if (!store.lastUpdateOk || isRead(state, issueId) === wasRead) return null;
  const transition = saveEducation.complete();
  renderSaveEducation();
  return transition;
}

// A passive surface changes without moving focus, so nothing tells a screen reader it changed at
// all. Sending those changes to the announcer needs a guard, because every write that produces one
// repeats: checkHealth runs at boot and again on every API URL save, and renderHydration is called
// once per issue fetched, so a 20-issue run calls it 22 times.
//
// The guard is keyed on the state that matters rather than on the rendered text, so a repeated
// verdict is silent and only a genuine change speaks. Returning whether it spoke is what lets a
// test count what a reader hears across a whole run rather than only observing the first call.

export function stateAnnouncer(speak, seed = []) {
  const seen = new Map(seed);
  return (key, state, msg) => {
    if (seen.get(key) === state) return false;
    seen.set(key, state);
    if (msg) speak(msg);
    return true;
  };
}

// Seeding a key declares the condition assumed to hold already. The metadata service being
// reachable is the ordinary case, so a healthy boot says nothing and only a boot that cannot reach
// it speaks, which also makes "reachable again" the only way the healthy message can be heard.
export function passiveAnnouncer(speak) {
  return stateAnnouncer(speak, [['api', 'ok']]);
}

const announceState = passiveAnnouncer(announce);

// A message goes down exactly one channel. Writing into a container that is itself a live
// region and also copying the text into the announcer made a screen reader say everything
// twice, so the announcer is used only where the message has no live surface of its own.
//
// This is decided by reading the container rather than from a list of ids kept here, so
// marking a container as a live region later cannot quietly reintroduce the double-speak.
function isLive(node) {
  for (let n = node; n && n.getAttribute; n = n.parentElement) {
    const live = n.getAttribute('aria-live');
    if (live && live !== 'off') return true;
    if (['alert', 'status', 'log'].includes(n.getAttribute('role'))) return true;
  }
  return false;
}

// The catalog is loaded once and shown in two views, so a failure is one condition reported into
// whichever pane the reader is at. Keying it by the condition rather than by the pane is what lets
// a later success clear it wherever it was placed.
const CATALOG_LOAD = 'catalog-load';
const LOCAL_CONNECTION_NOTICE = 'local-app-connection';
const LOCAL_CONNECTION_STEPS = 'Your lists and reading progress are safe. Leave this window open, '
  + 'start Recap Page from the copy you downloaded or installed from the Microsoft Store, then return here.';
const generatedCategoryByRoute = new Map([
  ...PUBLISHING_CATEGORIES,
  ...HOME_CATEGORIES.filter((category) => !category.shelf && category.kind !== 'reading-paths'),
].map((category) => [category.route, category]));

// The stored API base is checked once at boot, so the complaint about a bad one is a single
// condition that outlives whichever view the reader happens to land on, and it is cleared by
// saving a usable base rather than by anything that happens in a particular pane.
const API_BASE_REJECTED = 'api-base-rejected';

// alert() reached the reader wherever they were; a pane fixed in one view does not. With
// a curated import in flight, three ways the named pane went unseen were measured: the
// reader switched view, so the pane was inside a hidden one and nothing appeared at all;
// the preview dialog was still open, so the pane sat behind its backdrop and outside the
// top layer; and the grid was scrolled, so the pane was 87px above the viewport.
//
// Each notice is remembered rather than only written into the page, because where it belongs can
// change after it is written. The reader can leave the view while a curated import is still in
// flight, and 219-issue orders make that window real, or a dialog can open over the pane. Placing
// every outstanding notice from this record is what keeps one message in exactly one place;
// moving the nodes about instead left a copy behind in the pane the message started in, and with
// two outstanding it kept whichever came first in the markup rather than the newer one.
const notices = new Map();

// #app-report is above every view, so it is the only pane always available to a message whose own
// pane the reader cannot see. Seven of the nine views carry no pane of their own.
function overflowPane() {
  const box = $('#app-report');
  return box?.offsetParent ? box : null;
}

function placeNotices() {
  const overflow = overflowPane();
  // Every dialog here is opened with showModal(), so an open one is the top layer and anything
  // behind it is inert and dimmed regardless of where it sits on the page.
  const modalPane = $('dialog[open]')?.querySelector('.report') ?? null;
  const placed = new Map();
  const claims = new Map();

  for (const [, note] of notices) {
    const own = $(note.sel);
    if (!own) continue;
    let box = own;
    // A notice carrying a control stays in its own pane. Moving a message into the modal makes it
    // readable where the reader is looking; moving a button there makes it pressable in a context
    // that has nothing to do with it, and acting on it can navigate the inert page behind the
    // dialog to a view the reader never asked for. A dismiss button is not that kind of control:
    // it closes the message it sits in and touches nothing else, so a notice whose only control is
    // a dismiss still travels, and the reader can be rid of it from wherever they read it.
    if (modalPane && !note.action) box = modalPane;
    // offsetParent is null only under a display:none ancestor, which is how a view that is not
    // the current one is hidden.
    else if (!own.offsetParent) box = overflow ?? own;
    placed.set(note.sel, box);
    // Later wins a shared pane, and notices is kept in order of arrival, so what the reader sees
    // is the newest of two outstanding messages rather than whichever pane comes first.
    claims.set(box, note);
  }

  // A message already readable in a view's own pane must not be repeated in the shared one. The
  // same sentence twice on one screen is the visual form of the double-speak BL-027 removed.
  if (overflow && claims.has(overflow)) {
    const dup = [...claims].some(([box, note]) => box !== overflow && note.msg === claims.get(overflow).msg);
    if (dup) claims.delete(overflow);
  }

  for (const pane of document.querySelectorAll('.report')) {
    const note = claims.get(pane);
    pane.replaceChildren(...(note ? [noticeEl(note)] : []));
  }
  return placed;
}

// A notice with an action is a paragraph with a button in it rather than a message and a separate
// control, so that the offer is announced with the words that explain it and so that re-rendering
// the notice cannot leave the button behind in a pane the message has left.
//
// `dismiss` is a second control and not a variant of the first. An action is what the message
// offers; dismissing is the reader saying they are finished with the message, which is a different
// sentence and has to be a different button. It carries visible text rather than a bare glyph
// because the notice already holds a text button, and a word beside a word reads as a choice
// between two things where a symbol beside a word reads as decoration.
// Exported for the test that holds the shape of a notice's controls, which is a rule about what a
// reader is offered rather than about how a paragraph is built, and which no headless run can reach
// through notify() because that needs a document.
function noticeControlEl(control, dismiss) {
  const closing = control === dismiss;
  const props = {
    class: closing ? 'quiet notice-dismiss' : 'quiet',
  };
  return el('button', {
    ...props,
    type: 'button',
    onclick: (e) => {
      const inDialog = closing && e.currentTarget.closest('dialog[open]') !== null;
      control.onClick();
      if (closing) focusAfterDismiss(inDialog);
    },
  }, control.label);
}

export function noticeEl({ msg, kind, action, dismiss }) {
  const controls = [action, dismiss].filter(Boolean);
  return el('p', { class: `notice notice-${kind}${controls.length ? ' notice-act' : ''}` }, [
    el('span', { class: 'grow', text: msg }),
    ...controls.map((c) => noticeControlEl(c, dismiss)),
  ]);
}

// Dismissing removes the button that was pressed, and the browser drops focus to <body> when a
// focused node leaves the document. That is the same silent landing at the top of the page BL-054
// was filed for, so the reader is put where showView puts them: on the heading of the view they are
// looking at. Inside an open dialog the page behind is inert, focus() on it does nothing, and the
// dialog keeps focus itself, so that case is left alone rather than aimed somewhere it cannot go.
function focusAfterDismiss(inDialog) {
  if (inDialog) return;
  focusViewHeading(view);
}

// The key is what a notice is cleared by, and it defaults to the pane so that most callers need
// not think about it. It is separate so that a condition reported into more than one pane, such as
// a catalog load, can be cleared wherever it ended up.
//
// `action` puts a button in the notice, for a message that offers a way back such as the undo
// after a delete. `dismiss` puts a second one there for a message the reader can be finished with
// before anything replaces it, which is the only way a notice under a long-lived key ever leaves
// the screen: these panes hold what they are given until something clears them.
function notify(sel, msg, kind = 'ok', key = sel, action = null, dismiss = null) {
  const own = $(sel);
  if (!own) return;
  // Only the general notice panes move. #save-report sits above every view and is assertive
  // because a persistence failure must not be missed, and the result panes are read alongside the
  // form that filled them, so relocating either would lose the context that makes it actionable
  // and would quietly change which channel it goes out on.
  if (!own.classList.contains('report')) {
    own.replaceChildren(noticeEl({
      msg, kind, action, dismiss,
    }));
    if (!isLive(own)) announce(spoken(msg, action, dismiss));
    return;
  }
  // Re-inserted rather than overwritten in place, because a Map keeps a key at its original
  // position and arrival order is what decides the newest message.
  notices.delete(key);
  notices.set(key, {
    sel, msg, kind, action, dismiss,
  });
  const box = placeNotices().get(sel) ?? own;
  // Nothing else scrolls a pane into view, and "nearest" is a no-op once it is fully visible, so
  // this moves the page only when the message would otherwise be missed.
  box.scrollIntoView?.({ block: 'nearest' });
  if (!isLive(box)) announce(spoken(msg, action, dismiss));
}

// A button that is never spoken is a button a screen reader user cannot know to look for, and the
// undo is the whole point of the message it sits in. The same argument reaches the dismiss, for the
// opposite reason: a message that stays until it is closed is one a reader has to be told they can
// close, and a notice held for a whole session is exactly the one where not knowing costs the most.
export function spoken(msg, action, dismiss) {
  const labels = [action, dismiss].filter(Boolean).map((c) => c.label);
  if (!labels.length) return msg;
  return `${msg} ${labels.join(' and ')} ${labels.length > 1 ? 'are' : 'is'} available.`;
}

function clearNotice(key) {
  notices.delete(key);
  placeNotices();
}

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const stored = typeof raw.apiBase === 'string' && raw.apiBase ? raw.apiBase.trim().replace(/\/+$/, '') : DEFAULT_BASE;
    // A stored base is not a checked base. It was written by whatever build was installed at the
    // time, survives every upgrade after it, and is one devtools edit away from being anything at
    // all, so the rule is applied on the way out of storage as well as on the way in. MarvelApi
    // throws on a base it will not use, and that constructor runs before anything is on screen,
    // so falling back is the only option that leaves a usable app. It is reported rather than
    // done quietly, because it changes which service the reader is talking to.
    const ok = isAllowedApiBase(stored);
    return {
      apiBase: ok ? stored : DEFAULT_BASE,
      covers: raw.covers !== false,
      // An unknown value falls back to following the system rather than to a fixed theme, so a
      // settings file from a future build that adds a theme degrades to the reader's own
      // preference instead of overriding it.
      theme: normaliseTheme(raw.theme),
      // Not checked against the filters that exist here, because that is a question about the
      // document rather than about storage. wireReading() answers it and writes the answer back,
      // which is why a value of the wrong type is passed through rather than coerced: coercing it
      // would produce something a radio matches, and the repair would never fire.
      filter: raw.filter === undefined ? 'all' : raw.filter,
      rejectedApiBase: ok ? null : stored,
    };
  } catch {
    return {
      apiBase: DEFAULT_BASE,
      covers: true,
      theme: DEFAULT_THEME,
      filter: 'all',
      rejectedApiBase: null,
    };
  }
}

function purgeMarkOf(value) {
  if (typeof value === 'string' && !/^[1-9]\d*$/.test(value)) return 0;
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
}

function legacyPurgeMark(raw) {
  if (typeof raw !== 'string' || raw === '') return 0;
  try {
    return purgeMarkOf(JSON.parse(raw)?.cachePurge);
  } catch (err) {
    if (err instanceof SyntaxError) return 0;
    throw err;
  }
}

function cachePurgeMarks(storage) {
  const dedicated = purgeMarkOf(storage.getItem(CACHE_PURGE_KEY));
  const legacy = legacyPurgeMark(storage.getItem(SETTINGS_KEY));
  return { dedicated, legacy, maximum: Math.max(dedicated, legacy) };
}

export function cachePurgeMark(storage = globalThis.localStorage) {
  return cachePurgeMarks(storage).maximum;
}

export async function writeCachePurgeMark(
  storage = globalThis.localStorage,
  marker,
  locks = globalThis.navigator?.locks,
) {
  if (!locks?.request) {
    throw new Error('Browser storage locking is unavailable, so cache cleanup cannot be recorded safely.');
  }
  return locks.request(CACHE_PURGE_KEY, () => {
    const marks = cachePurgeMarks(storage);
    const next = Math.max(marks.maximum, purgeMarkOf(marker));
    if (marks.dedicated >= next) return next;
    storage.setItem(CACHE_PURGE_KEY, String(next));
    if (purgeMarkOf(storage.getItem(CACHE_PURGE_KEY)) < next) {
      throw new Error('The cache cleanup marker write could not be verified.');
    }
    return next;
  });
}

function saveSettings() {
  // Only the real settings are written. rejectedApiBase is a report about this boot, and
  // persisting it would turn a one-off complaint into part of the stored record.
  //
  // The refused value is written back rather than the fallback, because this is not only called
  // by the form that changes the base. setCovers() calls it too, so toggling cover art would
  // otherwise overwrite whatever the reader had configured with the default they were given
  // instead, unrecoverably and without saying so: the settings field already shows the fallback,
  // so there would be nothing left on screen holding the old value.
  const apiBase = settings.rejectedApiBase ?? settings.apiBase;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      apiBase,
      covers: settings.covers,
      theme: settings.theme,
      filter: settings.filter,
    }));
  } catch { /* non-fatal */ }
}

// Bumped when something already in the cache has to go. 1 is BL-134: entries written by builds
// before the synopsis strip carry the prose this tracker has stopped keeping, and a 30 day TTL means
// the oldest of them would have sat there until well into September.
const CACHE_PURGE_VERSION = 1;

// Runs at most once per browser, and only records that it ran if it actually did.
//
// clear() reports its outcome precisely so this can be true. It used to swallow the failure and
// return nothing, so a marker written straight afterwards would say the prose was gone while it was
// still there, permanently and with no second attempt: the marker is what stops the retry. A failed
// clear now leaves the marker alone and the next boot tries again.
export async function purgeStaleCache(cacheRef, marker, current = CACHE_PURGE_VERSION) {
  if (marker >= current) return { ran: false, cleared: false };
  const cleared = await cacheRef.clear({ requireAccess: true });
  return { ran: true, cleared };
}

export async function clearCacheGenerations(cacheRef, { onLegacyBlocked = () => {} } = {}) {
  const firstActiveClear = await cacheRef.clear({ requireAccess: true });
  const legacy = await cacheRef.deleteLegacy({
    onBlocked: () => onLegacyBlocked({ activeCleared: firstActiveClear }),
  });
  const activeCleared = await cacheRef.clear({ requireAccess: true });
  return { activeCleared, legacy };
}

export async function maintainCacheGeneration(
  cacheRef,
  marker,
  current = CACHE_PURGE_VERSION,
  { onLegacyBlocked = () => {} } = {},
) {
  const purge = await purgeStaleCache(cacheRef, marker, current);
  const legacy = await cacheRef.deleteLegacy({
    onBlocked: () => onLegacyBlocked({ activeCleared: !purge.ran || purge.cleared }),
  });
  const denied = ['SecurityError', 'InvalidStateError', 'NotAllowedError'].includes(legacy.error?.name);
  if (!purge.ran && denied && cacheRef.available !== false && typeof cacheRef.open === 'function') await cacheRef.open();
  const legacyUnreachable = legacy.status === 'unavailable'
    // A confirmed deletion proves the factory was reachable and cannot excuse an active clear failure.
    || (legacy.status === 'failed' && denied);
  const storageUnavailable = cacheRef.available === false && legacyUnreachable;
  let activeCleared = storageUnavailable || !purge.ran || purge.cleared;
  if (purge.ran && !storageUnavailable) {
    activeCleared = await cacheRef.clear({ requireAccess: true });
  }
  return {
    ran: purge.ran,
    activeCleared,
    ...(storageUnavailable ? { storageUnavailable: true } : {}),
    legacy,
  };
}

export function cacheCleanupFailureMessage(result) {
  const failures = [];
  if (!result.activeCleared) failures.push('Cached metadata used by this version could not be cleared.');
  if (result.savedStateCleared === false) {
    failures.push('Saved issue summaries written by an older tab could not be removed.');
  }
  if (result.legacy.status === 'unavailable' && !result.storageUnavailable) {
    failures.push('Older cached metadata could not be checked because browser storage is unavailable.');
  } else if (result.legacy.status === 'failed' && !result.storageUnavailable) {
    failures.push(`Older cached metadata could not be removed (${result.legacy.error?.message ?? 'unknown error'}).`);
  }
  return failures.join(' ');
}

function rawCarriesIssueDescriptions(raw) {
  if (typeof raw !== 'string' || raw === '') return false;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) return false;
    throw err;
  }
  return Object.values(parsed?.issues ?? {}).some((issue) => (
    issue && typeof issue === 'object'
    && Object.prototype.hasOwnProperty.call(issue, 'description')
  ));
}

function verifySavedStateSanitation(storage, onFailure) {
  let raw;
  try {
    raw = storage?.getItem(STATE_KEY);
  } catch (err) {
    onFailure(`Could not verify saved-state cleanup (${err.message}).`);
    return false;
  }
  if (typeof raw !== 'string' || raw === '') {
    onFailure('The saved-state cleanup write could not be verified.');
    return false;
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    onFailure('The saved-state cleanup write could not be verified.');
    return false;
  }
  const issues = parsed?.issues;
  const clean = issues && typeof issues === 'object'
    && !Object.values(issues).some((issue) => (
      issue && typeof issue === 'object'
      && Object.prototype.hasOwnProperty.call(issue, 'description')
    ));
  if (!clean) onFailure('The saved-state cleanup write could not be verified.');
  return Boolean(clean);
}

export function sanitizeStoredIssueDescriptions(
  readerStore,
  sourceRaw,
  {
    adoptCurrent = false,
    onFailure = () => {},
    retryConflict = true,
  } = {},
) {
  let currentRaw;
  if (typeof readerStore.storage?.getItem !== 'function') {
    currentRaw = sourceRaw;
  } else {
    try {
      currentRaw = readerStore.storage.getItem(STATE_KEY);
    } catch (err) {
      onFailure(`Could not read saved data for cleanup (${err.message}).`);
      return { needed: rawCarriesIssueDescriptions(sourceRaw), cleared: false };
    }
  }
  const needed = rawCarriesIssueDescriptions(currentRaw);
  if (!needed) {
    if (adoptCurrent && !readerStore.blocked) readerStore.adoptForeignWrite(currentRaw);
    return { needed: false, cleared: true };
  }

  const sanitizer = new Store({ storage: readerStore.storage });
  try {
    sanitizer.state = migrate(JSON.parse(currentRaw));
  } catch (err) {
    onFailure(`Saved issue summaries written by an older tab could not be read safely (${err.message}).`);
    return { needed: true, cleared: false };
  }
  const cleared = sanitizer.persist(sanitizer.state, currentRaw);
  if (!cleared) {
    if (sanitizer.conflicted && retryConflict) {
      return sanitizeStoredIssueDescriptions(readerStore, sourceRaw, {
        adoptCurrent,
        onFailure,
        retryConflict: false,
      });
    }
    if (sanitizer.conflicted) {
      onFailure('Saved data kept changing while old issue summaries were being removed. The app will try again.');
      return { needed: true, cleared: false };
    }
    onFailure(sanitizer.lastError);
    return { needed: true, cleared: false };
  }
  const result = {
    needed: true,
    cleared: verifySavedStateSanitation(readerStore.storage, onFailure),
  };
  let durableRaw = null;
  if (result.cleared) {
    try {
      durableRaw = readerStore.storage.getItem(STATE_KEY);
    } catch (err) {
      onFailure(`Could not read the cleaned saved data (${err.message}).`);
      result.cleared = false;
    }
  }
  if (result.cleared) {
    if (adoptCurrent && !readerStore.blocked) readerStore.adoptForeignWrite(durableRaw);
  }
  return result;
}

function reportBlockedLegacyCleanup({ activeCleared }) {
  notify(
    '#cache-report',
    activeCleared
      ? 'Cached metadata used by this version is clear. Close other tabs running an older version to finish removing their separate cached metadata.'
      : 'Cached metadata used by this version could not be cleared, and an older tab is also delaying removal of its separate cached metadata.',
    'warn',
  );
}

async function runCachePurge() {
  const marker = cachePurgeMark(localStorage);
  sanitizeStoredIssueDescriptions(store, localStorage.getItem(STATE_KEY), {
    adoptCurrent: true,
    onFailure: (error) => notify('#save-report', error, 'error'),
  });
  const result = await maintainCacheGeneration(cache, marker, CACHE_PURGE_VERSION, {
    onLegacyBlocked: reportBlockedLegacyCleanup,
  });
  // The same argument as the cache, one storage layer over. normalizeIssue drops a saved synopsis
  // when the state is read, but load() does not write back, so the prose stays in mrt.state.v2 until
  // some unrelated edit happens to rewrite it. For a reader who marks something read that is the
  // next click; for one who opens the app, looks at it and closes it, it is never. One forced write
  // closes the gap, and a blocked store refuses it, which is what should happen while it is holding
  // a salvage copy of data it could not read.
  const stateCleanup = sanitizeStoredIssueDescriptions(store, localStorage.getItem(STATE_KEY), {
    adoptCurrent: true,
    onFailure: (error) => notify('#save-report', error, 'error'),
  });
  const complete = { ...result, savedStateCleared: stateCleanup.cleared };
  const cleanupFailure = cacheCleanupFailureMessage(complete);
  if (cleanupFailure) {
    notify('#cache-report', `${cleanupFailure} The app will try again next time.`, 'warn');
    return;
  }
  await writeCachePurgeMark(localStorage, Math.max(marker, CACHE_PURGE_VERSION));
  if (result.legacy.blocked) {
    notify('#cache-report', 'Older cached metadata was removed after the other tab closed.', 'ok');
  }
  refreshCacheUsage();
}

function activeListId() {
  return store.state.active;
}

function ymd(v) {
  return v ? String(v).slice(0, 10) : '';
}

function seriesOnly(name) {
  return String(name || '').replace(/\s*\(.*\)\s*$/, '');
}

function shortTitle(t) {
  return String(t || '').replace(/\s*\(\d{4}(\s*-\s*\d{4})?\)/, '');
}

// ------------------------------------------------------------------ cover art

// A deterministic hue per series so the typographic fallback still distinguishes runs
// at a glance when cover art is switched off.
function hueOf(s) {
  let h = 0;
  for (const c of String(s)) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function fallbackHue(issue, fallbackName = '') {
  return hueOf(fallbackName || issue?.seriesName || issue?.title || '');
}

// Wires an <img>/fallback pair. The fallback is shown when there is no cover URL at all, when the
// image fails to load, or when the reader has cover art switched off.
function paintCover(img, fb, issue, variant, fallbackName = issue?.seriesName || issue?.title || '') {
  paintCoverUrl(img, fb, coverUrl(issue, variant), fallbackHue(issue, fallbackName), fallbackName);
}

function paintHeroBackground(target, issue) {
  const url = settings.covers ? coverUrl(issue, 'detail') : null;
  target.style.backgroundImage = url ? `url("${url}")` : 'none';
}

// The hue is passed in rather than derived, because a catalog card's cover belongs to a
// reading order, not to a single issue.
function paintCoverUrl(img, fb, url, hue, fallbackName = '') {
  // Set the hue as a custom property rather than writing a style attribute. Assigning a
  // style attribute is what `style-src-attr` blocks under the server's Content-Security-
  // Policy, and it fired on every cover paint; setting a property through the CSSOM is
  // not a policy violation, so the gradient in styles.css does the drawing.
  fb.style.setProperty('--h', String(hue));
  setFallbackInitials(fb, fallbackName);
  // The setting is read here rather than at the five call sites because this line, `img.src = url`,
  // is what makes the request, and hiding what it fetched is not the same as not fetching it. The
  // rules that hide a cover under `body.nocovers` are `display: none`, which suppresses nothing.
  // Measured in Edge at 1280x900 with House of M imported, counting requests to `i.annihil.us`
  // from the first paint of a reload: 10 with the setting on, 9 with it off before this gate, 0
  // with it off after. The one the old code already saved is the hero backdrop, which is a CSS
  // background whose computed `none` is never fetched, and that is what makes the omission on the
  // `<img>` beside it read as an oversight rather than a decision. Reading `settings` rather than
  // the body class also makes the gate independent of whether the class has been applied yet.
  if (!url || !settings.covers) {
    img.removeAttribute('src');
    img.hidden = true;
    fb.classList.add('show');
    return;
  }
  img.hidden = false;
  fb.classList.remove('show');
  img.onerror = () => { img.hidden = true; fb.classList.add('show'); };
  img.src = url;
}

function applyCoversSetting() {
  document.body.classList.toggle('nocovers', !settings.covers);
  // There is a toggle on the reading view and another on the landing page, and they are one
  // setting, so both are written rather than whichever happens to be on screen.
  for (const btn of document.querySelectorAll('[data-covers-toggle]')) {
    btn.setAttribute('aria-pressed', String(settings.covers));
    const label = btn.querySelector('.covers-label');
    if (label) label.textContent = settings.covers ? 'Cover art on' : 'Cover art off';
  }
  const opt = $('#opt-covers');
  if (opt) opt.checked = settings.covers;
}

function setCovers(on) {
  settings.covers = Boolean(on);
  saveSettings();
  applyCoversSetting();
  // renderReading has no hidden-view check and repaints regardless, which covers the reading rows;
  // renderHome repaints the landing mosaics. renderLibrary is added because a library row now holds
  // a cover too, and paintCoverUrl set no src while covers were off, so those rows need repainting.
  readingView.render();
  homeView.render();
  libraryView.render();
  announce(settings.covers ? 'Cover art on.' : 'Cover art off. Covers are shown as text tiles.');
}

// ------------------------------------------------------------------ theme

function applyThemeSetting() {
  const attr = themeAttribute(settings.theme);
  if (attr) document.documentElement.setAttribute('data-theme', attr);
  else document.documentElement.removeAttribute('data-theme');
  // The meta tag tells the browser what to paint the scrollbars and form controls before any CSS
  // applies. Left saying "dark" it contradicts a light page for the first frame.
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.setAttribute('content', attr ?? 'dark light');
  const opt = $('#opt-theme');
  if (opt) opt.value = settings.theme;
}

function setTheme(next) {
  settings.theme = normaliseTheme(next);
  saveSettings();
  applyThemeSetting();
  announce(
    settings.theme === 'system'
      ? 'Theme follows your system setting.'
      : `Theme set to ${settings.theme}.`,
  );
}

// No matchMedia listener. One was written here, and deleting it changed nothing a browser could
// show: with the stylesheet carrying its own `prefers-color-scheme` block, a reader on 'system'
// already sees the page follow a live preference change with no JavaScript involved. The listener
// only ever called applyThemeSetting(), and for 'system' every one of that function's effects is a
// no-op: the attribute is already absent, the meta tag already says "dark light", and the control
// already reads 'system'. It was found by mutation, not by review: removing it left a browser
// check that was written to catch exactly that still reporting a pass.

// ------------------------------------------------------------------ sidebar

// Collapsed means a 48px icon rail, not a hidden pane: nothing leaves the tab order and no
// destination becomes unreachable. See docs/ux/sidebar-flow.md.
let railed = false;
// Tracked so the responsive rule fires only when the breakpoint is actually crossed. Without
// it every resize event would re-apply the default and undo a deliberate toggle.
let wasNarrow = null;

function loadRailed() {
  try {
    const raw = localStorage.getItem(SIDEBAR_KEY);
    if (raw === 'true') return true;
    if (raw === 'false') return false;
  } catch { /* private mode; fall through to the responsive default */ }
  return null;
}

// Only a deliberate toggle is a preference, so persisting is opt-in. The responsive rule and
// the first-run default also move the sidebar, and writing those to storage would let the act
// of resizing a window overwrite a choice the reader actually made.
function setRailed(next, { announceIt = false, persist = false } = {}) {
  railed = Boolean(next);
  $('#shell').classList.toggle('railed', railed);
  const toggle = $('#btn-rail-toggle');
  const label = railed ? 'Expand sidebar' : 'Collapse sidebar';
  toggle.setAttribute('aria-expanded', String(!railed));
  toggle.setAttribute('aria-label', label);
  toggle.dataset.tip = `${label} · Ctrl+\\`;
  if (!railed) hideRailTip();
  if (persist) {
    try { localStorage.setItem(SIDEBAR_KEY, String(railed)); } catch { /* non-fatal */ }
  }
  if (announceIt) announce(railed ? 'Sidebar collapsed.' : 'Sidebar expanded.');
}

function wireSidebar() {
  const saved = loadRailed();
  wasNarrow = window.innerWidth < RAIL_BREAKPOINT;
  // A saved choice is a deliberate one and outranks the responsive default, so a reader who
  // expanded the sidebar on a narrow window does not find it collapsed again on every visit.
  // The default itself is not written back: until the reader touches the toggle there is no
  // preference to record, and recording one would freeze the first window size they happened
  // to open the app at.
  setRailed(saved !== null ? saved : wasNarrow);

  $('#btn-rail-toggle').addEventListener('click', () => setRailed(!railed, { announceIt: true, persist: true }));

  document.addEventListener('keydown', (e) => {
    // Ctrl+\ and nothing else: the sidebar is chrome, so its shortcut must not fight a
    // text field the way the single-letter reading shortcuts would.
    if (e.key !== '\\' || !e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    e.preventDefault();
    setRailed(!railed, { announceIt: true, persist: true });
  });

  window.addEventListener('resize', () => {
    const isNarrow = window.innerWidth < RAIL_BREAKPOINT;
    // Only on the crossing. Applying this on every resize event would undo a toggle the
    // reader had just made, and a window drag fires hundreds of them.
    if (isNarrow === wasNarrow) return;
    wasNarrow = isNarrow;
    // A narrow window has no room for the full sidebar, so it always collapses. Widening
    // restores what the reader chose rather than assuming they want it open, so dragging a
    // window wide does not undo a deliberate collapse.
    setRailed(isNarrow || (loadRailed() ?? false));
  });

  wireRailTips();
}

// The rail is a scroll container, so a tooltip drawn inside it would be clipped at 48px.
// One fixed-position element outside the rail avoids that. It is decorative: the button's
// own label stays in the DOM as its accessible name, visually hidden in rail mode.
function wireRailTips() {
  const rail = $('#sidebar');
  const show = (e) => {
    const target = e.target instanceof Element ? e.target.closest('.ri, .brand, .pill, .rail-toggle') : null;
    if (!target || (!railed && !target.matches('.rail-toggle'))) return hideRailTip();
    const text = (target.dataset.tip || target.querySelector('.lbl')?.textContent || target.textContent || '').trim();
    if (!text) return hideRailTip();
    const tip = $('#rail-tip');
    tip.textContent = text;
    tip.hidden = false;
    const box = target.getBoundingClientRect();
    tip.style.setProperty('left', `${Math.round(box.right + 8)}px`);
    tip.style.setProperty('top', `${Math.round(box.top + box.height / 2 - tip.offsetHeight / 2)}px`);
  };
  rail.addEventListener('pointerover', show);
  rail.addEventListener('pointerout', hideRailTip);
  // Focus as well as hover, or the rail is unusable to anyone navigating by keyboard.
  rail.addEventListener('focusin', show);
  rail.addEventListener('focusout', hideRailTip);
  window.addEventListener('scroll', hideRailTip, true);
}

function hideRailTip() {
  const tip = $('#rail-tip');
  if (tip) tip.hidden = true;
}

// ------------------------------------------------------------------ navigation

// Extracted so a control created after boot can navigate the same way a rail button does.
// wireNav only ever runs once, over the markup present at load, so an empty-state button built
// during a render would carry data-view and do nothing at all.
function navigateTo(view) {
  // A click on the rail is the archetypal navigation, so this is the one that has to leave a
  // history entry for Back to come back to.
  showView(view, { push: true });
}

function issueFocusHref(issueId, context = null) {
  return formatRoute({ view: 'issue', issueId, context });
}

function openIssueFocus(issueId, context, opener) {
  const route = { view: 'issue', issueId: Number(issueId), context };
  const href = formatRoute(route);
  if (!href) return;
  const current = history.state && typeof history.state === 'object' ? history.state : {};
  history.replaceState({ ...current, issueFocusOpener: opener }, '', location.href);
  issueRoute = route;
  history.pushState(null, '', href);
  if ($('#preview').open) $('#preview').close();
  showView('issue', { focus: true });
}

function issueFocusAnchor(issue, {
  context = null, surface, control = null, className = null, tabIndex = null, ariaLabel = null, children,
} = {}) {
  return el('a', {
    class: className,
    href: issueFocusHref(issue.issueId, context),
    tabindex: tabIndex, 'aria-label': ariaLabel,
    dataset: {
      focusSource: surface,
      focusControl: control ?? '',
      issueId: issue.issueId,
      contextId: context?.id ?? '',
    },
    onclick: (event) => {
      if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      openIssueFocus(issue.issueId, context, {
        view,
        surface,
        control,
        issueId: issue.issueId,
        contextId: context?.id ?? null,
      });
    },
  }, children);
}

// The action an empty state offers. A screen with nothing on it is the one place a reader has no
// context to work from, so it hands over the next step rather than naming a control elsewhere.
function emptyAction({ label, view }) {
  return el('button', {
    class: 'btn btn-g',
    type: 'button',
    onclick: () => navigateTo(view),
  }, label);
}

function wireNav() {
  for (const btn of document.querySelectorAll('[data-view]')) {
    btn.addEventListener('click', () => navigateTo(btn.dataset.view));
  }

  $('#btn-new-list').addEventListener('click', newEmptyList);

  for (const btn of document.querySelectorAll('[data-covers-toggle]')) {
    btn.addEventListener('click', () => setCovers(!settings.covers));
  }
}

async function newEmptyList() {
  const name = await askText({
    title: 'New Reading List',
    label: 'Name for the new list',
    value: DEFAULT_LIST_NAME,
    confirmLabel: 'Create list',
  });
  if (!name) return;
  // The id has to come from the state the store returned, not from store.state afterwards.
  // A failed write rolls the creation back, and listOrder's last entry would then be an
  // unrelated pre-existing list that we would silently switch the user to while telling
  // them their new list was created.
  const created = store.update((s) => createList(s, { name }));
  if (!store.lastUpdateOk) return;
  const id = created.listOrder[created.listOrder.length - 1];
  store.update((s) => setActive(s, id));
  showView('read', { push: true });
  announceIfSaved(`Created list ${name}.`);
}

// Every section the rail can reach now lives in lib/route.js, so that one list backs both what
// showView can display and what a URL can address.

// The URL is written from the state, never the other way round, except at boot and on a Back press.
// Nothing may be written before boot has had its chance to read the incoming hash: renderAll runs
// once before the route is restored, and an ungated sync there would overwrite the very address the
// reader arrived on.
let routeReady = false;
let applyingRoute = false;

// `push` separates a deliberate navigation from a passive correction, and the distinction is what
// keeps Back usable. A reader who marks twenty issues read must not have to press Back twenty times
// to leave the view, so every passive sync replaces.
//
// Both branches write history rather than assigning location.hash, and that is the difference that
// lets a reading filter be pushed. Assigning the hash fires hashchange synchronously, which re-runs
// applyRoute and moves focus to the view heading. Every caller that pushes a view already reached
// showView with focus of its own, so that second pass was redundant for them; for a filter radio it
// would have thrown the keyboard out of the control the reader just pressed, which is the defect
// BL-054 and BL-058 fixed for the rows. pushState fires no hashchange, and Back over an entry it
// made still does, both measured in Edge before this was relied on.
//
// The compare against the current hash is not an optimisation. pushState given the address already
// showing would stack a duplicate entry, so Back would appear to do nothing once per navigation.

function syncHash({ push = false } = {}) {
  if (!routeReady || applyingRoute) return;
  // While a traversal is open the address lags the rows on purpose: the entry on top is the one the
  // reader arrived on and Back has to return to it. A passive sync fired by something else in that
  // window would otherwise replace it with the half-chosen address and destroy it. That is reachable
  // rather than theoretical: background hydration writes through store.update on its own timer, and
  // every store.update reaches renderAll, which syncs.
  const { shown, showFilter } = readingView.filterTraversalSnapshot({ push });
  const sort = view === 'spotlights' ? catalogView.sort() : null;
  const next = view === 'issue' && issueRoute
    ? formatRoute(issueRoute)
    : formatRoute({
      view,
      listId: activeListId(),
      filter: showFilter ? shown : DEFAULT_FILTER,
      full: view === 'read' && $('#full').open && !(showFilter && shown !== DEFAULT_FILTER),
      sort, pathId: view === 'reading-paths' ? requestedReadingPathId : null,
    });
  if (!next || next === location.hash) return;

  // A hash that is not ours is someone else's anchor, and index.html ships one: the skip link
  // targets #main and pushes a history entry, so an ordinary keyboard user lands here. A passive
  // sync leaves it alone rather than yanking the page away from where they just jumped. A
  // deliberate navigation does overwrite it, because the anchor is no longer where they are.
  if (!push && location.hash && !parseRoute(location.hash)) return;

  if (push) {
    const current = history.state && typeof history.state === 'object' ? { ...history.state } : {};
    if (Object.hasOwn(current, 'issueFocusOpener')) {
      delete current.issueFocusOpener;
      history.replaceState(Object.keys(current).length ? current : null, '', location.href);
    }
    history.pushState(null, '', next);
  }
  else history.replaceState(null, '', next);
}

// Adopting the list first means the redirect inside showView sees the list the URL asked for
// rather than whichever one happened to be active. A list id that no longer exists is left to
// setActive, which returns the state untouched, so the trailing sync inside showView corrects the
// address instead of leaving it claiming a list that is not on screen.
//
// `filterIfAbsent` is what an address saying nothing about the filter means, and it is not the same
// answer in the two places this is called from. Back and Forward hand over an address this app
// wrote, and this app omits the filter only when it is the default, so absent there really does
// mean All: without that, pressing Back over the moment a filter was chosen would leave the filter
// in force and rewrite the address to match, which is the one thing this task exists to fix. Boot
// is the opposite. An address with no filter can be a bookmark made before this shipped, and
// answering it with All would discard the setting BL-037 exists to keep across a reload, so boot
// passes whatever was restored from settings.
// `route.listId` is a string a reader can type, and the list map used to be an ordinary object, so a
// bare lookup answered `__proto__`, `constructor` or `toString` with something from Object.prototype
// and this guard would pass on a list that does not exist. Measured on the tree before this line
// changed: opening `#/read/__proto__` persisted `active: "__proto__"` and then threw a TypeError out
// of listProgress, and because the id survives in storage the same throw happened on the next boot,
// during module evaluation, which left the hashchange listener unregistered. `Object.hasOwn` asks
// the question the guard means. BL-068 has since given the map a null prototype, so this now holds
// twice over, and it stays because it states the question rather than relying on the map's type.
function applyRoute(route, { focus, filterIfAbsent }) {
  applyingRoute = true;
  try {
    if (issueSynopsisId != null && (route.view !== 'issue' || route.issueId !== issueSynopsisId)) {
      synopsisRunner.cancel();
      issueSynopsisId = null;
    }
    if (route.view === 'issue') {
      readingView.endFilterRun({ commit: false });
      issueRoute = route;
      showView('issue', { focus });
      return;
    }
    issueView.cancel();
    issueRoute = null; if (route.view === 'reading-paths') requestedReadingPathId = route.pathId;
    if (route.listId && route.listId !== activeListId() && Object.hasOwn(store.state.lists, route.listId)) {
      store.update((s) => setActive(s, route.listId));
    }
    if (route.view === 'spotlights') catalogView.setSort(route.sort);
    // Before showView, so the passive sync at the end of showView computes the address this route
    // already describes and returns early rather than writing one and being corrected a moment later.
    if (route.view !== 'reading-paths') { readingView.setFilterAddressed(route.filter !== null);
      readingView.setFilter(route.filter ?? filterIfAbsent); }
    // A traversal cannot span a navigation, and Back is a navigation. Discarded rather than committed,
    // because the address this route describes is the authoritative one and writing the traversal's
    // would fight it.
    //
    // Above showView, and that is the whole of it. Below the trailing sync, the run would still be open
    // when that sync ran, so it would format the address from filterRunBase and leave the address
    // claiming a filter the rows are not showing. Measured on a modelled stack: pending in force,
    // ArrowRight once, then Alt+Left leaves the address saying pending over rows showing all, and puts
    // the same address in two adjacent entries, which is the dead Back this whole design exists to
    // close.
    readingView.endFilterRun({ commit: false });
    if (route.view === 'read') {
      const openFromRoute = route.full === true || route.filter !== null;
      readingView.setFullOrderFromRoute(openFromRoute);
      if (openFromRoute && readingView.hasRowsPending()) readingView.renderRows();
    }
    showView(route.view, { focus }); if (route.view === 'reading-paths') void readingPathsView.render();
  } finally {
    applyingRoute = false;
  }
  if (focus) void restoreIssueFocusOpener(route.view);
}

// Moving focus to the new view's heading is what makes the rail usable with a keyboard or a
// screen reader. Without it, focus stays on the rail button and the view change is silent, so
// the next Tab continues from the old position and nothing announces where you now are.
function showView(next, { focus = true, push = false } = {}) {
  // There is nothing to read without an active list, so the reading view hands over to the
  // landing page rather than showing an empty frame with a heading over it. `Object.hasOwn` for
  // the same reason as in applyRoute, and past tense for the same reason: the map used to answer a
  // bare lookup with a prototype member, and BL-068 has since given it none to answer with.
  if (next === 'read' && !Object.hasOwn(store.state.lists, activeListId() ?? '')) next = 'home';
  if (next !== 'issue' && view === 'issue') {
    issueView.cancel();
    issueRoute = null;
    if (issueSynopsisId != null) {
      synopsisRunner.cancel();
      issueSynopsisId = null;
    }
  }

  view = next;
  addView.enter(next);
  for (const name of VIEWS) {
    const panel = $(`#view-${name}`);
    if (panel) panel.hidden = name !== next;
  }
  const parent = railParentView(next);
  for (const btn of document.querySelectorAll('.ri[data-view]')) {
    if (btn.dataset.view === parent) btn.setAttribute('aria-current', 'page');
    else btn.removeAttribute('aria-current');
  }
  renderRail();
  const shelf = CATALOG_SHELVES.find((s) => s.key === next);
  if (shelf) void catalogView.render(shelf.key);
  if (generatedCategoryByRoute.has(next)) renderPublishingCategory(next);
  if (next === 'home') homeView.render();
  if (next === 'library') renderLibraryHub();
  if (next === 'browse') void homeView.renderGateways();
  if (next === 'issue') void issueView.render(issueRoute);
  renderBreadcrumbs();
  // Here rather than in renderAll, because what this list reports is not part of the state every
  // render repaints: it changes when a read fails at boot, when the reader removes a copy, and in
  // another tab. Rebuilding it on arrival covers all three and leaves renderAll's fan-out alone.
  // Erasing everything is a fourth, and the one arrival cannot cover, because it happens on this
  // screen rather than before reaching it, so that route repaints at its own call site.
  if (next === 'data') recoveryView.renderSalvage();
  window.scrollTo({ top: 0 });
  // After the scroll to the top, so that bringing a message into view is not undone. Which pane
  // each outstanding notice belongs in has just changed, because a different view is showing.
  placeNotices();
  // Above the focus-free early return, or every call that passes focus:false would leave the
  // address bar behind. Boot is one such call.
  syncHash({ push });

  if (!focus) return;
  focusViewHeading(next);
}

function renderBreadcrumbs() {
  const section = $(`#view-${view}`);
  for (const breadcrumb of document.querySelectorAll('.breadcrumb')) {
    if (!section?.contains(breadcrumb)) breadcrumb.remove();
  }
  const head = section?.querySelector(':scope > .head');
  if (!head) return;

  const activeId = activeListId();
  const active = Object.hasOwn(store.state.lists, activeId ?? '')
    ? store.state.lists[activeId]
    : null;
  const issueResult = issueView.result();
  const resolvedContext = issueResult?.contextStatus === 'valid'
    ? {
      ...issueResult.context,
      shelf: issueResult.breadcrumbShelf ?? null,
    }
    : null;
  const trail = breadcrumbHierarchy({
    view,
    list: active ? { id: active.id, name: active.name } : null,
    issueTitle: issueResult?.issue?.title ?? null,
    context: resolvedContext,
  });
  const existing = section.querySelector(':scope > .breadcrumb');
  if (!trail.length) {
    existing?.remove();
    return;
  }
  const trailKey = JSON.stringify(trail);
  if (existing?.dataset.trail === trailKey) return;

  const list = el('ol', {}, trail.map((item) => el('li', {}, item.href
    ? el('a', { href: item.href }, item.label)
    : el('span', { 'aria-current': item.current ? 'page' : null }, item.label))));
  const breadcrumb = existing || el('nav', { class: 'breadcrumb', 'aria-label': 'Breadcrumb' });
  breadcrumb.dataset.trail = trailKey;
  breadcrumb.replaceChildren(list);
  if (!existing) head.before(breadcrumb);
}

function railParentView(next) {
  if (next === 'browse' || HOME_CATEGORIES.some(({ route }) => route === next)
    || generatedCategoryByRoute.has(next)) return 'browse';
  if (next === 'add' || ADD_VIEWS.includes(next)) return 'add';
  if (next === 'library' || next === 'progress' || LIBRARY_VIEWS.some(({ value }) => value === next)) return 'library';
  return next;
}

// Where a view puts the reader when it arrives. Separate because dismissing a notice destroys the
// button that had focus without navigating anywhere, and the honest landing for that is the same
// heading: it names the screen the reader is on and sits above everything they can do next.
function focusViewHeading(name) {
  const section = $(`#view-${name}`);
  const heading = section && document.getElementById(section.getAttribute('aria-labelledby'));
  if (!heading) return;
  heading.setAttribute('tabindex', '-1');
  heading.focus({ preventScroll: true });
}

function matchingIssueOpener(opener) {
  return [...document.querySelectorAll('[data-focus-source][data-issue-id]')].find((node) => (
    node.dataset.focusSource === opener.surface
    && (node.dataset.focusControl || null) === (opener.control || null)
    && Number(node.dataset.issueId) === Number(opener.issueId)
    && (node.dataset.contextId || null) === (opener.contextId || null)
  )) ?? null;
}

async function restoreIssueFocusOpener(sourceView) {
  const opener = history.state?.issueFocusOpener;
  if (!opener || opener.view !== sourceView) return;
  if (opener.surface === 'full-order') {
    readingView.setFullOrderFromRoute(true);
    readingView.renderRows();
  }
  if (opener.surface === 'preview' && opener.contextId) {
    try {
      const catalog = await loadCatalog();
      const list = catalog.lists.find((entry) => entry.id === opener.contextId);
      if (list) await previewView.open(list);
    } catch {
      focusViewHeading(sourceView);
      return;
    }
  }
  await new Promise((resolve) => requestAnimationFrame(resolve));
  const target = matchingIssueOpener(opener);
  if (target?.isConnected) {
    target.focus({ preventScroll: true });
    return;
  }
  if (sourceView === 'read' && view === 'read') {
    const checked = [...document.querySelectorAll('input[name="filter"]')].find((radio) => radio.checked);
    if (checked?.isConnected) {
      checked.focus({ preventScroll: true });
      return;
    }
    const summary = $('#full').querySelector('summary');
    if (summary?.isConnected) {
      summary.focus({ preventScroll: true });
      return;
    }
  }
  focusViewHeading(view);
}

function loadBundledOrder(file, { signal } = {}) {
  return fetch(`./data/${file}`, { cache: 'no-cache', signal }).then(async (res) => {
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  });
}

// ------------------------------------------------------------------ rail

function renderRail() {
  const nav = $('#list-nav');
  // renderAll rebuilds the rail on every store.update, with no navigation, so a reader who
  // pressed `d` on the read view with a rail button focused lost focus to <body>. Measured in
  // Edge at 1280x900: the order went from 0 of 89 read to 1 of 89, the view did not change, and
  // document.activeElement reported BODY. The other route here is showView, which focuses the
  // new view's heading afterwards and so is unaffected either way.
  preservingFocus(nav, () => {
    nav.replaceChildren();
    const id = activeListId();
    const list = store.state.lists[id];
    if (list) {
      const { read, total } = listProgress(store.state, id);
      const pct = total ? (read / total) * 100 : 0;
      const current = view === 'read';

      nav.append(el('li', {}, el('button', {
        type: 'button',
        class: 'ri',
        'aria-current': current ? 'page' : null,
        dataset: { key: id, act: 'open', tip: ['Continue reading', `${list.name}:`, read, 'of', total, 'read'].join(' ') },
        onclick: () => showView('read', { push: true }),
      }, [
        el('span', { class: 'init', 'aria-hidden': true, text: (list.name || '?').trim().charAt(0) }),
        el('span', { class: 'lbl' }, [
          el('span', { class: 't' }, [
            el('span', { text: 'Continue reading' }),
            el('span', { class: 'n', text: `${read} / ${total}` }),
          ]),
          el('span', { class: 'rail-list-name', text: list.name }),
          el('span', { class: 'bar' }, el('i', { style: { width: `${pct.toFixed(1)}%` } })),
        ]),
      ])));
    }
  }, { primary: 'open' });
}

// ------------------------------------------------------------------ reading view

function fact(key, value, cls = '') {
  return el('div', {}, [
    el('dt', { text: key }),
    el('dd', { class: cls || null, text: value }),
  ]);
}

function onHydrationStatus(status) {
  readingView.renderHydration(status);
}

// The phase a run is in, and what a reader should hear on reaching it, kept apart from the DOM
// writes so the whole sequence a run produces can be exercised. A 219-issue order calls
// renderHydration 221 times; what matters is that a reader hears two of them.
export function hydrationAnnouncement(status) {
  const phase = !status || status.phase === 'idle' ? 'idle' : status.phase;
  if (phase === 'idle') return { state: 'idle', msg: null };
  if (phase === 'running') {
    const n = Number(status.total ?? 0);
    return { state: 'running', msg: `Fetching details for ${n} issue${n === 1 ? '' : 's'}.` };
  }
  if (phase === 'cancelled') return { state: 'cancelled', msg: 'Detail fetching stopped. Progress was kept.' };
  return { state: 'complete', msg: 'All issue details fetched.' };
}

// ------------------------------------------------------------------ reader deep links

function openInReader(issue, event) {
  event?.preventDefault();
  const res = openIssueTab(issue);
  if (!res.ok) {
    announce(`${issue.title} has no Marvel reference recorded, so it cannot be opened.`);
    return;
  }
  announce(res.target === 'reader'
    ? `Opening ${issue.title} in Marvel Unlimited in a new tab.`
    : `Opening ${issue.title} in a new tab and looking up its Unlimited link.`);
}

// ------------------------------------------------------------------ synopsis fetching

export const SYNOPSIS_SERVICE_FALLBACK = 'the community Marvel metadata service';

export function synopsisServiceName(baseUrl) {
  try {
    return new URL(String(baseUrl)).host || SYNOPSIS_SERVICE_FALLBACK;
  } catch {
    return SYNOPSIS_SERVICE_FALLBACK;
  }
}

export function synopsisDisclaimer(baseUrl) {
  return {
    title: 'Fetch synopses from the community metadata service?',
    body: 'Issue synopses are not part of this tracker. They come from the community Marvel metadata '
      + `service at ${synopsisServiceName(baseUrl)}, which is not affiliated with Marvel, and the text `
      + 'itself is Marvel’s. Nothing fetched is saved: the synopses are held for this browser tab '
      + 'only, they are not written into your lists, they are not included in a backup, and they are '
      + 'gone when you reload. Fetching a whole Reading List takes a few minutes and uses your '
      + 'request allowance.',
    confirmLabel: 'Fetch synopses',
  };
}

export function synopsisAnnouncement(status) {
  const phase = !status || status.phase === 'idle' ? 'idle' : status.phase;
  if (phase === 'idle') return { state: 'idle', msg: null };
  if (phase === 'running') {
    const n = Number(status.total ?? 0);
    return { state: 'running', msg: `Fetching synopses for ${n} issue${n === 1 ? '' : 's'}.` };
  }
  if (phase === 'cancelled') {
    const failed = Number(status.failed ?? 0);
    const unreached = failed ? ` ${failed} issue${failed === 1 ? '' : 's'} could not be reached.` : '';
    return { state: 'cancelled', msg: `Synopsis fetching stopped.${unreached} What arrived is on screen until you reload.` };
  }
  if (phase === 'partial') {
    const failed = Number(status.failed ?? 0);
    return {
      state: 'partial',
      msg: `Synopsis fetching finished. ${failed} issue${failed === 1 ? '' : 's'} could not be reached. What arrived is held for this tab only.`,
    };
  }
  return { state: 'complete', msg: 'All synopses fetched. They are held for this tab only.' };
}

export function synopsisStatusLine(status) {
  const phase = status?.phase;
  if (!status || phase === 'idle') return '';
  if (phase === 'running') {
    const failed = Number(status.failed ?? 0);
    const line = `Fetching synopses ${status.done - failed} of ${status.total}…`;
    return failed ? `${line} ${failed} could not be reached.` : line;
  }
  if (phase === 'cancelled') {
    const failed = Number(status.failed ?? 0);
    if (!failed) return `Stopped after ${status.done} of ${status.total}.`;
    return `Stopped after ${status.done - failed} of ${status.total}. ${failed} could not be reached.`;
  }
  if (phase === 'partial') {
    return `Fetched ${status.total - status.failed} of ${status.total}, for this tab only. ${status.failed} could not be reached.`;
  }
  return 'All synopses fetched, for this tab only.';
}

function onSynopsisStatus(status) {
  readingView.renderSynopsis(status);
  if (view === 'issue') issueView.repaintSynopsis(status);
}

async function startSynopsisRun() {
  const list = store.state.lists[activeListId()];
  if (!list) return;
  const yes = await askConfirm(synopsisDisclaimer(settings.apiBase));
  if (!yes) return;
  synopsisRunner.start(list.id);
}

async function startIssueSynopsis() {
  const issueId = issueView.result()?.issue?.issueId;
  if (!Number.isInteger(issueId) || issueId < 1) return;
  const yes = await askConfirm(synopsisDisclaimer(settings.apiBase));
  if (!yes || view !== 'issue' || issueRoute?.issueId !== issueId) return;
  issueSynopsisId = issueId;
  await synopsisRunner.startIssue(issueId);
  if (!synopsisRunner.active) issueSynopsisId = null;
}

// ------------------------------------------------------------------ curated orders

let catalogLoad = null;

// Typing in the search box re-renders on every keystroke, so a slow first load could otherwise
// start a second fetch while the first is still in flight and let the two renders finish out of
// order. Sharing one promise keeps every render behind the same load; a failure clears it so
// reopening the view can retry.
function loadCatalog() {
  catalogLoad ??= (async () => {
    // Served from our own origin, so the catalog works with no internet connection.
    const res = await fetch('./data/catalog.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseCatalog(await res.json());
  })().catch((err) => {
    catalogLoad = null;
    throw err;
  });
  return catalogLoad;
}

function goToStop(stop) {
  catalogView.clearNarrowing(stop.shelf);
  showView(stop.shelf, { focus: true, push: true });
}

// A second click while the first import is still fetching runs the whole import again and mints a
// second list with the same name and the same issues, because createList() always allocates a new
// id. Nothing is lost, but the reader is left to notice and delete the duplicate. Latching the
// run also covers the twin entry shown under a grouped story, where two different buttons import
// two different files.
let importing = null;

// `navigate` is false in the preview dialog, where adding an order keeps the reader with the
// order they were inspecting. Library still updates, and the dialog action confirms the save.
//
// `report` is where a failure is written. This used to be alert(), which was the only path in
// the app that stopped the page to report a failure, and the one place a reader could not read
// the reason and the catalog at the same time.
async function importCurated(list, btn, { navigate = true, report = '#catalog-report' } = {}) {
  if (importing) return null;
  const file = list.file;
  const catalogId = list.id;
  // Keyed by the order rather than by the pane, for the reason CATALOG_LOAD is. The same order can
  // be added from the landing page and from the catalog row, so a failure written into one pane is
  // the same failure the other entry point would report. Keying by pane left the reader looking at
  // the list open in front of them under a banner saying it could not be loaded.
  const importKey = `import:${catalogId}`;
  clearNotice(importKey);
  importing = file;
  const label = btn?.textContent;
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Adding…';
  }
  try {
    // Served from our own origin, so this works with no internet connection.
    const res = await fetch(`./data/${file}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const order = await res.json();

    const created = store.update((s) => createList(s, { name: order.name, description: order.description, catalogId }));
    if (!store.lastUpdateOk) {
      notify(report, `${order.name} could not be saved, so nothing was imported.`, 'error', importKey);
      return null;
    }
    const listId = created.listOrder[created.listOrder.length - 1];
    let added = 0;
    store.update((s) => {
      // No `hydrated: true` here. It was asserted over the whole file, which is right for the 688
      // items that carry metadata and a false statement about the 63 that carry none. normalizeIssue
      // infers it from the item instead, and marks the empty ones as refused rather than pending.
      // Those 63 now say so on themselves: the vendoring run records which lookups upstream refused
      // and aborts rather than writing an item for one it never got an answer about, so this is
      // reading what the run was told rather than reading emptiness and calling it an answer.
      const r = addIssuesToList(s, listId, order.items.map((i) => ({ ...i, source: 'curated' })), {});
      added = r.added;
      return r.state;
    });
    if (!store.lastUpdateOk) {
      // The list record is written before its issues, so a failure here leaves a shell claiming
      // the catalog entry with nothing in it. That is not merely untidy: it blocks the undo offer
      // for a deleted copy of the same order, and `undoDelete` would then discard the reader's
      // real list in favour of an artefact of a write that failed. Storage being full is the
      // expected reason to land here, and this second write is the larger of the two, so the
      // half-import is rolled back rather than left standing.
      store.update((s) => deleteList(s, listId));
      notify(report, store.lastUpdateOk
        ? `${order.name} could not be saved, so nothing was imported.`
        : `${order.name} was created but its issues could not be saved.`, 'error', importKey);
      return null;
    }
    if (navigate) {
      store.update((s) => setActive(s, listId));
      if (!store.lastUpdateOk) {
        clearNotice(importKey);
        return listId;
      }
      showView('read', { push: true });
    } else if (!store.state.active) {
      // Nothing was being read, so the first order added becomes the one "Continue reading"
      // resumes. It does not steal the active list from a reader who already had one.
      store.update((s) => setActive(s, listId));
      if (!store.lastUpdateOk) {
        clearNotice(importKey);
        return listId;
      }
    }
    const transition = recordNonEmptyListSave({ ok: true, added, listId });

    // Some curated orders are short of metadata, in two ways that look nothing alike to a reader
    // and had been reported as one. Saying so is the difference between a known gap and a list
    // that looks wrong for no reason. The counts come from the items rather than from the
    // order's own `placeholders` field, which records raw flags but not whether an item later
    // gained launch metadata, and carries no count for records that arrived empty.
    const parts = [`${navigate ? 'Imported' : 'Added'} ${order.name}: ${added} issues.`];
    parts.push(...orderGapSentences(order));
    parts.push('Any issues you had already read stay read.');
    if (!navigate) parts.push('It is now in your Library.');
    const withdrawn = readingView.forgetDeletedFor(catalogId, order.name);
    if (withdrawn) parts.push(withdrawn);
    // A failure from a previous attempt would otherwise sit under a successful import,
    // contradicting it. Cleared by the order's key, not by this pane, so an attempt that failed
    // from the other entry point is cleared too.
    clearNotice(importKey);
    announce(withSaveEducation(parts.join(' '), transition));
    return listId;
  } catch (err) {
    const failureReport = report === '#preview-report' && !$('#preview').open
      ? '#home-cat-report'
      : report;
    await reportBundledLoadFailure({
      report: failureReport,
      failure: `Could not load ${list.name}: ${err.message}. Your lists are unchanged.`,
      key: importKey,
      subject: list.name,
      retry: () => (navigate
        ? importCurated(list, btn, { navigate, report })
        : importCurated(list, $('#preview-add [data-act="main"]'), {
          navigate: false,
          report: '#preview-report',
        })),
    });
    return null;
  } finally {
    importing = null;
    // The button survives a successful import only when the reader stays on the catalog; after
    // showView('read') it is off screen but still in the DOM, so restoring it keeps the catalog
    // usable when they come back rather than leaving a dead "Importing…" control behind.
    if (btn) {
      btn.disabled = false;
      btn.textContent = label;
    }
  }
}

// ------------------------------------------------------------------ data view

export function describeSize(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n < 0) return 'an unknown size';
  if (n < 1024) return `${Math.round(n)} bytes`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Returns the sentence to show, or null to go ahead and read the file. Split out from the handler
// so the decision can be measured directly: a test that reads the handler's source instead would
// still pass with the comparison deleted, because the constant's name survives in the import list.
export function backupFileRefusal(file) {
  const size = Number(file?.size);
  if (!Number.isFinite(size) || size <= MAX_BACKUP_BYTES) return null;
  return `That file is ${describeSize(size)}. A backup this app writes is far smaller than the ${describeSize(MAX_BACKUP_BYTES)} limit, so this one was not read and nothing was changed.`;
}

function exportMarkdown() {
  const id = activeListId();
  const list = store.state.lists[id];
  if (!list) return notify('#restore-report', 'No list is selected.', 'warn');
  const md = serializeChecklist({
    name: list.name,
    description: list.description,
    note: list.note,
    items: listItems(store.state, id),
  });
  download(`${slug(list.name)}.md`, md, 'text/markdown');
  announce('Markdown checklist downloaded.');
}

const recoveryView = createRecoveryView({
  el,
  elements: () => ({
    banner: $('#blocked-banner'),
    blockedWhy: $('#blocked-why'),
    saveReport: $('#save-report'),
    undoRestore: $('#btn-undo-restore'),
    btnDownloadSalvage: $('#btn-download-salvage'),
    btnStartFresh: $('#btn-start-fresh'),
    salvageList: $('#salvage-list'),
  }),
  isBlocked: () => store.blocked,
  blockedReason: () => store.blockedReason,
  hasPreRestoreSnapshot: () => store.hasPreRestoreSnapshot(),
  salvagedRaw: () => store.salvagedRaw(),
  salvageCopies: () => store.salvageCopies(),
  salvageRawAt: (key) => store.salvageRawAt(key),
  forgetSalvage: (key) => store.forgetSalvage(key),
  startFresh: (opts) => store.startFresh(opts),
  notify,
  announce,
  askConfirm,
  download,
});

const dataView = createDataView({
  elements: () => ({
    apiBase: $('#api-base'),
    optCovers: $('#opt-covers'),
    optTheme: $('#opt-theme'),
    btnCheckLocalConnection: $('#btn-check-local-connection'),
    btnExportJson: $('#btn-export-json'),
    btnExportMd: $('#btn-export-md-2'),
    restoreFile: $('#restore-file'),
    undoRestore: $('#btn-undo-restore'),
    formSettings: $('#form-settings'),
    btnClearCache: $('#btn-clear-cache'),
    btnWipe: $('#btn-wipe'),
    cacheUsage: $('#cache-usage'),
    localConnectionReport: $('#local-connection-report'),
    localConnectionStatus: $('#local-connection-status'),
  }),
  getApiBase: () => settings.apiBase,
  getSalvageCopies: () => store.salvageCopies(),
  hasPreRestoreSnapshot: () => store.hasPreRestoreSnapshot(),
  isAllowedApiBase,
  backupFileRefusal,
  askConfirm,
  notify,
  onExportJson: () => {
    download('recap-page-backup.json', JSON.stringify(exportBackup(store.state), null, 2), 'application/json');
    announce('Backup downloaded.');
  },
  onExportMarkdown: exportMarkdown,
  onRestore: (text) => {
    const res = store.restore(text);
    if (res.ok) readingView.forgetDeleted();
    return res;
  },
  onUndoRestore: () => {
    const res = store.undoRestore();
    if (res.ok) readingView.forgetDeleted();
    return res;
  },
  onSetCovers: (on) => setCovers(on),
  onSetTheme: (value) => setTheme(value),
  onCheckLocalConnection: () => refreshLocalConnection({ explicit: true }),
  onApiBaseSubmit: (value) => {
    settings.apiBase = value;
    // Cleared before the write, not after. saveSettings() prefers the refused value precisely so
    // that an unrelated write cannot discard it, which would also discard this one if the order
    // here were the other way round.
    if (settings.rejectedApiBase) {
      settings.rejectedApiBase = null;
      clearNotice(API_BASE_REJECTED);
    }
    saveSettings();
    cache = new ResponseCache({ baseUrl: value });
    api = new MarvelApi({ baseUrl: value, limiter, cache, onStatus: onApiStatus });
    hydrator.api = api;
    // The synopsis runner holds its own reference for the same reason the hydrator does, so it
    // needs the same rebinding. A run already in flight is stopped rather than switched, and what
    // it fetched is dropped: the reader agreed to a dialog naming the old service, and that
    // agreement does not carry over to a different one.
    if (synopsisRunner.active) synopsisRunner.cancel();
    synopsisRunner.api = api;
    sessionSynopsis.clear();
    readingView.renderSynopsis(null);
    readingView.renderHero();
    notify('#api-report', 'API URL saved. Cached data from the previous URL is kept separate.', 'ok');
    checkHealth();
  },
  onClearCache: async () => {
    try {
      const result = await clearCacheGenerations(cache, {
        onLegacyBlocked: reportBlockedLegacyCleanup,
      });
      await refreshCacheUsage();
      const failure = cacheCleanupFailureMessage(result);
      notify(
        '#cache-report',
        failure || 'Cached metadata cleared. Lists and reading progress are untouched.',
        failure ? 'warn' : 'ok',
      );
    } catch (err) {
      notify('#cache-report', `Cached metadata could not be cleared (${err?.message ?? err}).`, 'error');
    }
  },
  onErase: () => {
    const { snapshotKept } = store.eraseAll();
    cache.clear();
    // The undo buffer points at a list from the data that has just been erased, so putting it
    // back would resurrect one list out of a tracker the reader asked to be emptied.
    readingView.forgetDeleted();
    // The button's visibility belongs to recoveryView.render(), and the withdrawal happens after
    // the repaint the erase itself triggered, so the question is put again here rather than left
    // to whatever unrelated render comes next.
    recoveryView.render();
    // Both outcomes move a row, in opposite directions: an erase that lands makes a live copy
    // removable, and an erase that is refused can create the first copy this browser has held.
    recoveryView.renderSalvage();
    // Asked of storage again rather than reused from what the dialog was built with: the dialog
    // sits open for as long as the reader leaves it, and another tab can take a copy or remove
    // one in that time.
    announceIfSaved(eraseOutcome(snapshotKept, store.salvageCopies()));
  },
});

// Deliberately not announced and not a live region. The only change here worth hearing is the one
// after Clear cached metadata, and that handler already speaks through notify(), so a live region
// on this element would say it twice. At boot it only resolves a placeholder nobody has asked
// about yet.
async function refreshCacheUsage() {
  try {
    dataView.renderCacheUsage(await cache.usage());
  } catch {
    dataView.renderCacheUsage(null);
  }
}

function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'list';
}

// ------------------------------------------------------------------ status

let localConnectionGeneration = 0;
let localConnectionInFlight = null;

function paintLocalConnectionStatus(status) {
  dataView.renderLocalConnectionStatus(status, LOCAL_SERVER_STATUS.READY);
}

function runLocalConnectionProbe({ fresh = false } = {}) {
  if (!fresh && localConnectionInFlight) return localConnectionInFlight;
  const generation = ++localConnectionGeneration;
  const request = checkLocalServer()
    .then((status) => {
      const current = generation === localConnectionGeneration;
      if (current) {
        paintLocalConnectionStatus(status);
        if (status === LOCAL_SERVER_STATUS.READY) clearNotice(LOCAL_CONNECTION_NOTICE);
        else dataView.clearLocalConnectionReport();
      }
      return { status, current, generation };
    });
  const tracked = request.finally(() => {
    if (localConnectionInFlight === tracked) localConnectionInFlight = null;
  });
  localConnectionInFlight = tracked;
  return tracked;
}

function localRecoveryAction(label, key, retry) {
  return {
    label,
    onClick: () => {
      clearNotice(key);
      clearNotice(LOCAL_CONNECTION_NOTICE);
      void retry();
    },
  };
}

async function refreshLocalConnection({ explicit = false } = {}) {
  if (explicit) {
    clearNotice(LOCAL_CONNECTION_NOTICE);
    dataView.clearLocalConnectionReport();
  }
  paintLocalConnectionStatus('checking');
  const result = await runLocalConnectionProbe({ fresh: explicit });
  if (!result.current) return result;

  if (result.status === LOCAL_SERVER_STATUS.READY) {
    clearNotice(LOCAL_CONNECTION_NOTICE);
    if (explicit) notify('#local-connection-report', 'The local app connection is ready.', 'ok');
  } else {
    notify(
      '#app-report',
      `The local app connection is not available. ${LOCAL_CONNECTION_STEPS} Then check again.`,
      'warn',
      LOCAL_CONNECTION_NOTICE,
      localRecoveryAction(
        'Check again',
        LOCAL_CONNECTION_NOTICE,
        () => refreshLocalConnection({ explicit: true }),
      ),
    );
  }
  return result;
}

async function reportBundledLoadFailure({
  report, failure, key, subject, retry, isCurrent = () => true,
}) {
  const result = await runLocalConnectionProbe();
  if (!isCurrent()) return false;
  if (!result.current || result.status === LOCAL_SERVER_STATUS.READY) {
    notify(report, failure, 'error', key);
    return false;
  }
  notify(
    report,
    `The local app connection is not available, so ${subject} could not be loaded. ${LOCAL_CONNECTION_STEPS}`,
    'warn',
    key,
    localRecoveryAction('Try again', key, retry),
  );
  return true;
}

async function checkHealth() {
  const pill = $('#api-status');
  pill.className = 'pill pill-muted';
  pill.textContent = 'Checking API…';
  try {
    const h = await api.health();
    pill.className = 'pill pill-ok';
    pill.textContent = `API OK · ${Number(h.issue_count ?? 0).toLocaleString()} issues`;
    announceState('api', 'ok', 'The metadata service is reachable again.');
  } catch {
    pill.className = 'pill pill-warn';
    pill.textContent = 'API unreachable. Lists and progress still work';
    announceState('api', 'down', 'The metadata service is unreachable. Your lists and reading progress still work.');
  }
}

// A backoff is worth hearing. The same backoff four hundred times is not.
//
// Measured in Edge on 2026-08-15 against a service stubbed to answer 503: one request announced
// four waits and the first two were both "Waiting 1 seconds", because backoff() draws attempt 0
// from [500, 1000) and attempt 1 from [1000, 2000) and both round to 1. That is one request.
// attempt resets to 0 on every get() and the hydrator continues past a failed lookup rather than
// stopping, so a 219-issue order against a service that never answers reaches 876 announcements
// drawn from eight distinct sentences.
//
// So the repeat cannot be bounded by the retry chain, which is four long and starts again on the
// next issue, and it cannot be bounded by queue depth either: the hydrator awaits one issue at a
// time, so depth returns to zero between every pair of requests and anything edged on that would
// reset 219 times. What separates "still stalled" from "stalled again" is an answer from the
// service, which is why api.js reports one and this is the only thing that clears the memory.
//
// A set rather than the last-value guard stateAnnouncer uses, because the waits inside one stall
// are not monotonic. Attempt 1 can draw one second after attempt 0 drew one, and the first
// attempt of the next request draws from [500, 1000) again after the last one drew eight seconds,
// so a guard that only remembers the previous wait lets the repeat through in both directions.
export function backoffAnnouncer(speak) {
  const said = new Set();
  return (s) => {
    if (s?.kind === 'ok') {
      said.clear();
      return false;
    }
    if (s?.kind !== 'backoff') return false;
    const secs = Math.round(s.ms / 1000);
    if (said.has(secs)) return false;
    said.add(secs);
    speak(`The metadata service asked us to slow down. Waiting ${secs} second${secs === 1 ? '' : 's'}.`);
    return true;
  };
}

const announceBackoff = backoffAnnouncer(announce);

function onApiStatus(s) {
  announceBackoff(s);
  renderQueue();
}

// Deliberately not announced and not a live region. The hydrator awaits one issue at a time, so
// the queue empties between every pair of requests: a 219-issue order crosses the empty boundary
// 219 times, and anything edge-triggered here would speak on each crossing. What a reader needs
// from a run is its start and its end, and #hydration-status carries both. The one queue
// condition worth hearing is a backoff, which onApiStatus hands to the announcer above.
function renderQueue() {
  const pill = $('#queue-status');
  const depth = limiter.depth;
  pill.hidden = depth === 0;
  pill.textContent = depth ? `${depth} request${depth === 1 ? '' : 's'} queued` : '';
}

function friendly(err) {
  if (err?.name === 'AbortError') return 'Cancelled.';
  if (err?.status === 404) return 'Not found in the metadata snapshot.';
  if (err?.transient) return 'The metadata service is busy. Try again in a moment.';
  if (err instanceof TypeError) return 'Could not reach the metadata service. Check your connection; your saved lists still work.';
  return err?.message || 'Something went wrong.';
}

let publishingCategoryGeneration = 0;

// Category panels are generated from the same registry the router reads. Repeating twelve hidden
// sections in the document would create a second list of routes, headings and ids that could drift
// while still leaving every individual panel looking valid.
function ensurePublishingViews() {
  const root = $('#main .wrap');
  for (const category of generatedCategoryByRoute.values()) {
    if ($(`#view-${category.route}`)) continue;
    root.insertBefore(el('section', {
      id: `view-${category.route}`,
      class: 'view view-wide publishing-view',
      hidden: true,
      'aria-labelledby': `${category.route}-h`,
    }, [
      el('div', { class: 'head' }, [
        el('div', { class: 'head-left' }, [
          el('h1', { id: `${category.route}-h`, text: `Browse ${category.heading}` }),
        ]),
      ]),
      el('div', { class: 'publishing-meta' }, [
        el('span', { class: 'publishing-range', text: category.label }),
        el('span', {
          id: `${category.route}-count`,
          class: 'publishing-count',
          role: 'status',
          text: 'Loading Reading Lists',
        }),
      ]),
      el('ul', { class: 'publishing-highlights', 'aria-label': `${category.heading} highlights` },
        category.highlights.map((highlight) => el('li', { text: highlight }))),
      el('div', { id: `${category.route}-report`, class: 'report' }),
      ...(category.kind === 'publishing-index' ? [] : [el('section', {
        id: `${category.route}-categories`,
        class: 'publishing-periods',
        hidden: true,
        'aria-labelledby': `${category.route}-categories-h`,
      }, [
        el('div', { class: 'sec-h' }, el('h2', { id: `${category.route}-categories-h`, text: 'Choose a Period' })),
        el('ul', { id: `${category.route}-category-list`, class: 'home-paths home-paths-secondary' }),
      ])]),
      el('div', { id: `${category.route}-results`, class: 'results' }),
    ]), $('.app-footer'));
  }
}

function renderLibraryHub() {
  const yours = $('#library-yours');
  savedLists.render(yours, $('#library-yours-list'));
  $('#library-empty').hidden = !yours.hidden;
}

function renderPublishingIndex(category, allStories) {
  const box = $(`#${category.route}-results`);
  const { count, earlier, modern, modernChildren } = publishingAgeGroups(allStories);
  $(`#${category.route}-count`).textContent = `${count} ${count === 1 ? 'Reading List' : 'Reading Lists'}`;
  box.replaceChildren();
  if (count === 0) {
    box.append(el('p', { class: 'rail-hint publishing-empty', text: 'No Reading Lists are published by age yet.' }));
    return;
  }
  if (earlier.length) box.append(el('section', {
    id: 'marvel-ages-earlier',
    class: 'publishing-periods marvel-ages-group',
    'aria-labelledby': 'marvel-ages-earlier-h',
  }, [
    el('div', { class: 'sec-h' }, el('h2', { id: 'marvel-ages-earlier-h', text: 'Earlier Marvel' })),
    el('ul', { id: 'marvel-ages-earlier-list', class: 'home-paths home-paths-secondary' }, earlier.map((child) => homeView.categoryTile({ ...child, tier: 'secondary' }))),
  ]));
  if (modern) {
    const aggregateLabel = labelledName('Browse all Modern Age Reading Lists', `${modern.label}, ${modern.count} Reading Lists`);
    box.append(el('section', {
      id: 'marvel-ages-modern',
      class: 'publishing-periods marvel-ages-group',
      'aria-labelledby': 'marvel-ages-modern-h',
    }, [
      el('div', { class: 'sec-h' }, [
        el('h2', { id: 'marvel-ages-modern-h', text: 'Modern Age' }),
        el('button', {
          id: 'marvel-ages-modern-all',
          type: 'button',
          class: 'quiet',
          text: 'Browse all Modern Age Reading Lists',
          'aria-label': aggregateLabel,
          onclick: () => showView('age-modern', { push: true }),
        }),
      ]),
      el('ul', { id: 'marvel-ages-modern-list', class: 'home-paths home-paths-secondary' }, modernChildren.map((child) => homeView.categoryTile({ ...child, tier: 'secondary' }))),
    ]));
  }
}

async function renderPublishingCategory(route) {
  const category = generatedCategoryByRoute.get(route);
  if (!category) return;
  const generation = ++publishingCategoryGeneration;
  const box = $(`#${route}-results`);
  const periods = $(`#${route}-categories`);
  const periodList = $(`#${route}-category-list`);
  box.replaceChildren(el('p', {
    class: 'rail-hint',
    'aria-hidden': 'true',
    text: 'Loading Reading Lists…',
  }));
  if (periods) periods.hidden = true;
  if (periodList) periodList.replaceChildren();
  clearNotice(CATALOG_LOAD);

  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (err) {
    box.replaceChildren();
    await reportBundledLoadFailure({
      report: `#${route}-report`,
      failure: `The catalog could not be loaded: ${err.message}. Your lists are unchanged.`,
      key: CATALOG_LOAD,
      subject: 'the catalog',
      retry: () => renderPublishingCategory(route),
      isCurrent: () => generation === publishingCategoryGeneration,
    });
    return;
  }

  const allStories = groupCatalog(catalog.lists);
  if (category.kind === 'publishing-index') {
    renderPublishingIndex(category, allStories);
    return;
  }
  catalogPresentation.ensureSetupGuideFeature(catalog.lists, route, modernTimelineFeaturedCard);
  const stories = typeof category.select === 'function'
    ? category.select(allStories)
    : publishingCategoryStories(allStories, category.key);
  const count = stories.reduce((total, story) => total + story.lists.length, 0);
  $(`#${route}-count`).textContent = `${count} ${count === 1 ? 'Reading List' : 'Reading Lists'}`;

  const children = availablePublishingCategories(allStories, category.key);
  const isPublishingCategory = PUBLISHING_CATEGORIES.some(
    (candidate) => candidate.key === category.key && candidate.route === category.route,
  );
  if (isPublishingCategory && !isPublishingCategoryLeaf(category)) {
    box.replaceChildren();
    periodList.replaceChildren(...children.map((child) => homeView.categoryTile({
      ...child,
      tier: 'secondary',
    })));
    periods.hidden = false;
    return;
  }

  box.replaceChildren();
  if (!stories.length) {
    box.append(el('p', {
      class: 'rail-hint publishing-empty',
      text: 'No Reading Lists are published for this period yet.',
    }));
    return;
  }

  const placements = pathPlacements(catalog.paths, catalog.lists);
  const localStoryKeys = new Set(stories.map((story) => story.key));
  if (isPublishingCategoryLeaf(category)) {
    const years = timelineYears(stories);
    catalogPresentation.renderTimelineSections(box, [{
      ...category, stories, from: years[0].year, to: years[years.length - 1].year,
    }], placements, {
      idPrefix: route, showEmptyYears: true, sectionBlurb: false,
      cardOptions: {
        surface: route,
        report: `#${route}-report`,
        localStoryKeys,
      },
    });
    return;
  }
  const grid = el('div', { class: 'catalog-grid publishing-grid' });
  for (const story of stories) {
    grid.append(catalogPresentation.catalogCard(story, placements.get(story.key), {
      surface: route, report: `#${route}-report`, localStoryKeys, level: 'h2',
    }));
  }
  box.append(grid);
}

// ------------------------------------------------------------------ render

function renderAll() {
  renderRail();
  readingView.render();
  homeView.render();
  renderLibraryHub();
  progressView.render();
  libraryView.render();
  renderQueue();
  addView.renderDestination();
  // Kept in renderAll so the banner cannot go stale. In particular a successful restore
  // clears the block, and leaving the banner up would push the user toward "Start fresh",
  // which would then wipe the backup they had just restored.
  recoveryView.render();
  renderBreadcrumbs();
  // The active list changes at more than a dozen places that never navigate, among them
  // duplicating a list and restoring a backup. This is the one point every one of them passes
  // through, so syncing here is what stops the address naming a list that is no longer on screen.
  // It replaces rather than pushes, so none of them can put an entry in front of Back.
  syncHash();
}

// ------------------------------------------------------------------ boot

// Everything above defines; this does. Keeping the two apart is what lets the module be
// imported at all: evaluating it used to run the whole sequence below, so a test that wanted
// one render function got a booting application instead, and in Node it got a ReferenceError
// before that. src/js/app.js is the entry the page loads, and calling boot() is all it does.
//
// Still last in the file, and still for the original reason. Booting from the top would run
// before the module's `let` bindings are initialised, and reading one of those from inside a
// boot call is a ReferenceError rather than an undefined, because the temporal dead zone does
// not hoist the way function declarations do.
export function boot() {
  setInterval(renderQueue, 1000);

  progressView.wire();
  store.load();
  applyCoversSetting();
  applyThemeSetting();
  ensurePublishingViews();
  wireSidebar();
  wireNav();
  readingView.wireShortcuts();
  issueView.wire();
  addView.wire();
  dataView.wire();
  recoveryView.wire();
  readingView.wire();
  for (const shelf of CATALOG_SHELVES) catalogView.wire(shelf.key);
  homeView.wire();
  readingPathsView.wire();
  previewView.wire();
  wireAsk();
  renderAll();
  // The address bar is now allowed to be written, but not before: renderAll has just run once, and
  // an ungated sync inside it would have overwritten the incoming hash before it was read.
  routeReady = true;
  // A reader with nothing to read has no reading view to show, so the landing page is where
  // they start. One with an active list resumes it, which is the whole point of the app.
  // An address that names a view wins over both, which is what makes a bookmark, a shared link and
  // a reload land where they say they will. focus:false either way, so arriving at the page never
  // takes focus off the document the reader has not started interacting with yet.
  const bootRoute = parseRoute(location.hash);
  if (bootRoute) applyRoute(bootRoute, { focus: false, filterIfAbsent: readingView.currentFilter() });
  else showView(store.state.lists[activeListId()] ? 'read' : 'home', { focus: false });

  // Back and Forward arrive here, as does anyone editing the address by hand. A hash that is not one
  // of ours is left entirely alone: index.html ships a skip link to #main, and answering that with a
  // view change would throw a keyboard user somewhere they did not ask to go.
  //
  // Focus does move here, unlike at boot, because a Back press is a navigation the reader made. A
  // screen reader that is told nothing after it has no way to know the page changed under it.
  window.addEventListener('hashchange', () => {
    const route = parseRoute(location.hash);
    if (route) applyRoute(route, { focus: true, filterIfAbsent: DEFAULT_FILTER });
  });
  checkHealth();
  void refreshLocalConnection();
  refreshCacheUsage();
  // After the first render, because it is slow, it is not urgent, and nothing on screen waits on it.
  void runCachePurge().catch((err) => {
    notify(
      '#cache-report',
      `Cache cleanup could not be completed (${err?.message ?? err}). The app will try again next time.`,
      'error',
    );
  });

  // Nothing reports store.lastError here. Every writer of it calls onChange in the same step, and
  // that callback already notifies #save-report, so a line here can only repeat what is on screen.
  // Measured in Edge with a route write failing during boot: 2 writes of the identical string into
  // a region that is role="alert" aria-live="assertive". It read as a backstop while a failed load
  // also set lastError, and that stopped being true when the reason moved to its own slot.

  // Reported after the first render, because a notice placed before there is a view to place it in
  // has nowhere to go. #app-report follows the reader between views, unlike the settings pane this
  // value is edited in, which is only seen by someone who already went looking for it.
  //
  // The launch page reads the same stored value and refuses it too, but it has no default to fall
  // back on and no reason to invent one, so it skips the lookup and sends the tab to marvel.com.
  // That degradation is named here because it happens in a tab this app does not control, where
  // nothing would otherwise explain it.
  if (settings.rejectedApiBase) {
    notify(
      '#app-report',
      `The saved API URL ${settings.rejectedApiBase} is not usable. The tracker is using ${DEFAULT_BASE} for this session, and any issue without a stored Marvel Unlimited link will open on marvel.com rather than in the reader. Set a usable URL under Backup & settings: use https, or http against localhost.`,
      'warn',
      API_BASE_REJECTED,
    );
  }

  // Written once at startup rather than from renderAll, because neither number can change
  // while the page is open, and a bug report needs them to be there whether or not the user
  // has touched anything.
  $('#about-version').textContent = APP_VERSION;
  $('#about-schema').textContent = String(SCHEMA_VERSION);
}

// ------------------------------------------------------------------ library and progress bands

// The cap and its counter are shared by both library sub-views and the progress view. A const at
// the end of the module is not hoisted, but it is only read inside functions that run long after
// the module has finished evaluating, so it may live here beside the functions that read it.
//
// 120 is a page a reader can scan without the list itself becoming the work. Below it nothing is
// held back and no control appears; above it the list is sliced and a show-more button reveals the
// next 120, so a several-hundred issue read history opens instantly rather than laying out at once.
const LIBRARY_CAP = 120;

// A cell's figure is a count unless it is already a phrase, as the progress band's "read of
// tracked" cell is, so a number is given its thousands separator and a string is left alone.
function summaryBand(cells) {
  return el('div', { class: 'sumbar' }, cells.map((cell) => el('div', { class: 'sumcell' }, [
    el('div', { class: 'sumfig', text: typeof cell.figure === 'number' ? cell.figure.toLocaleString() : String(cell.figure) }),
    el('div', { class: 'sumlab', text: cell.label }),
  ])));
}

// Carries tabindex="-1" so it can take focus when the last show-more press removes the button that
// had it. It is the honest landing: the reader was expanding the list and this line reports the
// result of that, whereas the summary band above counts something they were not acting on.
function shownLine(shown, total) {
  return el('p', {
    class: 'rail-hint',
    tabindex: '-1',
    text: `Showing ${shown.toLocaleString()} of ${total.toLocaleString()}.`,
  });
}

// The act and key pair is what restoreFocus matches on, so a button that survives its own press is
// re-focused in the rebuilt DOM rather than dropping focus to the body. rerender is passed in so
// the one builder serves both views, each re-rendering itself.
function moreButton(key, rest, rerender, shownByKey) {
  return el('button', {
    type: 'button',
    class: 'btn btn-g',
    dataset: { act: 'more', key },
    text: `Show ${Math.min(LIBRARY_CAP, rest).toLocaleString()} more`,
    onclick: () => {
      shownByKey.set(key, (shownByKey.get(key) ?? LIBRARY_CAP) + LIBRARY_CAP);
      rerender();
    },
  });
}

// A real h2 under the view's h1, so the screen-reader outline gains a level rather than losing one.
// The count sits in its own span so the label stays a plain heading a reader can jump between.
function groupSection(group, renderRow) {
  return el('section', { class: 'lgroup' }, [
    el('h2', { class: 'lgroup-h' }, [
      group.label,
      ' ',
      el('span', { class: 'lgroup-n', text: String(group.rows.length) }),
    ]),
    ...group.rows.map(renderRow),
  ]);
}
function ensureAddList(name) {
  let id = activeListId();
  if (!id) {
    const created = store.update((state) => createList(state, { name }));
    if (!store.lastUpdateOk) return { listId: null, ok: false };
    id = created.listOrder[created.listOrder.length - 1];
    store.update((state) => setActive(state, id));
    if (!store.lastUpdateOk) return { listId: id, ok: false };
  }
  return { listId: id, ok: true };
}

const addView = createAddView({
  $,
  announce,
  el,
  ensureList: ensureAddList,
  friendly,
  getActiveListId: activeListId,
  getState: () => store.state,
  hydrate: (listId) => hydrator.start(listId),
  issueFocusAnchor,
  lookupManual: lookupIssue,
  notify,
  onNonEmptyListSave: recordNonEmptyListSave,
  reportBundledLoadFailure,
  saveLongAddPage: (items, context) => persistLongAddPage(
    store,
    items,
    context,
    recordNonEmptyListSave,
  ),
  search: {
    creatorIssues: (id, options) => api.creatorIssues(id, options),
    creators: (query, options) => api.searchCreators(query, options),
    issues: (query, options) => api.searchIssues(query, options),
    series: (query, options) => api.searchSeries(query, options),
    seriesIssues: (id, options) => api.seriesIssues(id, options),
  },
  updateState: (updater) => {
    const state = store.update(updater);
    return { ok: store.lastUpdateOk, state };
  },
  warmNameIndex: (kind) => api.warmNameIndex(kind),
  withSaveEducation,
  ymd,
});

const readingView = createReadingView({
  $,
  activeListId,
  announce,
  announceIfSaved,
  announceState,
  askConfirm,
  askNote,
  askText,
  clearNotice,
  detailUrl,
  el,
  fact,
  getSettings: () => settings,
  getState: () => store.state,
  getSynopsis: (issueId) => sessionSynopsis.get(issueId),
  hydrationAnnouncement,
  isCurrent: () => view === 'read',
  isHydrationActive: () => hydrator.active,
  isSynopsisActive: () => synopsisRunner.active,
  issueFocusAnchor,
  launch: openInReader,
  noSynopsisMarker: NO_SYNOPSIS,
  notify,
  onCancelHydrate: () => hydrator.cancel(),
  onCancelSynopsis: () => synopsisRunner.cancel(),
  onExportMarkdown: exportMarkdown,
  onHydrate: (listId) => hydrator.start(listId),
  onStartSynopsis: startSynopsisRun,
  openIssueFocus,
  paintCover,
  paintHeroBackground,
  preservingFocus,
  recordDirectProgressSave,
  renderSaveEducation,
  saveSettings,
  seriesOnly,
  shortTitle,
  showView,
  syncHash,
  synopsisAnnouncement,
  synopsisStatusLine,
  updateState: (updater) => {
    const state = store.update(updater);
    return { ok: store.lastUpdateOk, state };
  },
  withSaveEducation,
  ymd,
});

const issueView = createIssueView({
  coverUrl,
  decorateResult: (result, { catalog }) => ({
    ...result,
    breadcrumbShelf: result.contextStatus === 'valid' && result.context?.kind === 'order'
      ? catalogListShelf(catalog?.lists, result.context.id)
      : null,
  }),
  elements: () => ({
    background: $('#issue-focus-bg'),
    byline: $('#issue-focus-by'),
    cancelSynopsis: $('#btn-cancel-issue-synopsis'),
    card: $('#issue-focus-card'),
    context: $('#issue-focus-context'),
    description: $('#issue-focus-desc'),
    facts: $('#issue-focus-facts'),
    fallback: $('#issue-focus-fb'),
    heading: $('#issue-focus-h'),
    image: $('#issue-focus-img'),
    info: $('#btn-issue-info'),
    note: $('#issue-focus-note'),
    number: $('#issue-focus-fn'),
    read: $('#btn-issue-read'),
    series: $('#issue-focus-fs'),
    status: $('#issue-focus-status'),
    synopsis: $('#btn-issue-synopsis'),
    synopsisStatus: $('#issue-synopsis-status'),
  }),
  fact,
  getApi: () => api,
  getState: () => store.state,
  getSynopsis: (issueId) => sessionSynopsis.get(issueId),
  isSynopsisActive: () => synopsisRunner.active,
  loadCatalog,
  loadOrder: loadBundledOrder,
  onCancelSynopsis: () => synopsisRunner.cancel(),
  onRead: openInReader,
  onStaleContext: (route) => {
    if (issueRoute !== route) return;
    issueRoute = { ...route, context: null };
    syncHash();
  },
  onStartSynopsis: startIssueSynopsis,
  paintBackground: paintHeroBackground,
  paintCover,
  renderBreadcrumbs,
  seriesOnly,
  synopsisFallback,
  synopsisStatusLine,
});

const progressView = createProgressView({
  el,
  elements: () => ({
    method: $('#progress-method'),
    methodText: $('#progress-method-text'),
    radios: document.querySelectorAll('input[name="progress-scope"]'),
    results: $('#series-progress'),
    scope: $('#progress-scope'),
  }),
  emptyAction,
  getActiveListId: activeListId,
  getState: () => store.state,
  listUi: {
    cap: LIBRARY_CAP,
    groupSection,
    moreButton,
    shownLine,
    summaryBand,
  },
  preservingFocus,
});

const savedLists = createSavedListsPresenter({
  el,
  getState: () => store.state,
  openList: (id) => {
    store.update((state) => setActive(state, id));
    showView('read', { push: true });
  },
  paintCover,
});

const homeView = createHomeView({
  categoriesForCatalog: (catalog) => availableHomeCategories(
    groupCatalog(catalog.lists),
    HOME_CATEGORIES,
    resolveReadingPaths(catalog.paths, catalog.lists),
  ),
  clearCatalogNotice: () => clearNotice(CATALOG_LOAD),
  el,
  elements: () => ({
    home: $('#view-home'),
    categoriesHeading: $('#home-cat-h'),
    categoriesRoot: $('#home-categories'),
    continueSection: $('#home-continue'),
    continueHeading: $('#chero-h'),
    continueBar: $('#chero-bar'),
    continueFill: $('#chero-fill'),
    continueCount: $('#chero-count'),
    continueNext: $('#chero-next'),
    continueImage: $('#chero-img'),
    continueFallback: $('#chero-fb'),
    continueSeries: $('#chero-fs'),
    continueNumber: $('#chero-fn'),
    continueRead: $('#btn-chero-read'),
    continueOpen: $('#btn-chero-open'),
    yoursSection: $('#home-yours'),
    yoursList: $('#home-yours-list'),
    firstRun: $('#home-first-run'),
    recommendation: $('#home-recommended'),
    recommendationButton: $('#btn-home-recommended'),
    gateways: [...document.querySelectorAll('[data-category-gateway]')],
    copyrights: [...document.querySelectorAll('[data-marvel-copyright]')],
  }),
  getActiveListId: activeListId,
  getState: () => store.state,
  hueOf,
  labelledName,
  listProgress,
  loadCatalog,
  onCatalogDropped: (count) => {
    const report = view === 'browse' ? '#browse-cat-report' : '#home-cat-report';
    notify(report, `${count} catalog ${count === 1 ? 'entry is' : 'entries are'} incomplete and cannot be shown.`, 'warn');
  },
  onCatalogLoadFailure: ({ error, isCurrent, retry }) => reportBundledLoadFailure({
    report: view === 'browse' ? '#browse-cat-report' : '#home-cat-report',
    failure: `The catalog could not be loaded: ${error.message}. Your lists are unchanged.`,
    key: CATALOG_LOAD,
    subject: 'the catalog',
    retry,
    isCurrent,
  }),
  onNavigateCategory: (category) => {
    if (category.route === 'reading-paths') requestedReadingPathId = null;
    showView(category.route, { push: true });
    if (category.route === 'reading-paths') void readingPathsView.render();
  },
  onOpen: () => showView('read', { push: true }),
  onRead: openInReader,
  openPreview: (list, story) => previewView.open(list, story),
  paintCover,
  paintCoverUrl,
  recommendedList: modernTimelineFeaturedList,
  renderSavedLists: (section, results) => savedLists.render(section, results),
  seriesOnly,
  shortTitle,
  upNext,
});

const libraryView = createLibraryView({
  el,
  elements: (entry) => {
    const section = $(`#view-${entry.value}`);
    return {
      heading: section.querySelector('h1'),
      results: section.querySelector('.results'),
    };
  },
  emptyAction,
  getState: () => store.state,
  issueFocusAnchor,
  listUi: {
    cap: LIBRARY_CAP,
    groupSection,
    moreButton,
    shownLine,
    summaryBand,
  },
  paintCover,
  preservingFocus,
  seriesOnly,
});

let requestedReadingPathId = null;

const catalogPresentation = createCatalogPresentation({
  el,
  elements: { query: $ },
  hueOf,
  isInLibrary: (catalogId) => listForCatalogId(store.state, catalogId),
  onAdd: (list, button, report) => importCurated(list, button, { report }),
  onGoToStop: goToStop,
  onOpen: (list, saved, report) => {
    store.update((state) => setActive(state, saved.id));
    if (!store.lastUpdateOk) {
      notify(
        report,
        `${list.name} could not be opened because that selection could not be saved.`,
        'error',
        `open:${list.id}`,
      );
      return;
    }
    showView('read', { push: true });
  },
  onPreview: (list, story) => previewView.open(list, story),
  pathHref: (stop) => formatRoute({
    view: stop.shelf,
    sort: stop.shelf === 'spotlights' ? catalogView.sort() : null,
  }),
  paintCoverUrl,
  shortTitle,
});

const catalogView = createCatalogView({
  announce,
  clearLoadNotice: () => clearNotice(CATALOG_LOAD),
  el,
  elements: {
    shelf: (key) => ({
      clear: $(`#${key}-clear`),
      filters: $(`#${key}-filters`),
      query: $(`#${key}-q`),
      results: $(`#${key}-results`),
      search: $(`#form-${key}-search`),
    }),
    spotlightKinds: () => document.querySelectorAll('input[name="spotlights-kind"]'),
    spotlightSorts: () => document.querySelectorAll('input[name="spotlights-sort"]'),
  },
  loadCatalog,
  notifyDropped: (key, count) => notify(
    `#${key}-report`,
    `${count} catalog ${count === 1 ? 'entry is' : 'entries are'} incomplete and cannot be shown.`,
    'warn',
  ),
  onLoadFailure: ({ error, key, retry, isCurrent }) => reportBundledLoadFailure({
    report: `#${key}-report`,
    failure: `The catalog could not be loaded: ${error.message}. Your lists are unchanged.`,
    key: CATALOG_LOAD,
    subject: 'the catalog',
    retry,
    isCurrent,
  }),
  onSortChange: () => syncHash({ push: true }),
  presentation: catalogPresentation,
});

const previewView = createPreviewView({
  captureFocus,
  el,
  elements: () => ({
    add: $('#preview-add'),
    body: $('#preview-body'),
    close: $('#preview-close'),
    description: $('#preview-desc'),
    dialog: $('#preview'),
    heading: $('#preview-h'),
    meta: $('#preview-meta'),
    paths: $('#preview-paths'),
  }),
  isInLibrary: (catalogId) => listForCatalogId(store.state, catalogId),
  issueFocusAnchor,
  loadOrder: loadBundledOrder,
  onAdd: (list, button) => importCurated(list, button, {
    navigate: false,
    report: '#preview-report',
  }),
  onClose: async (chose) => {
    placeNotices();
    if (!chose || (!CATALOG_SHELVES.some((shelf) => shelf.key === view)
      && !generatedCategoryByRoute.has(view))) return;
    const root = $(`#view-${view}`);
    const held = captureFocus(root);
    if (generatedCategoryByRoute.has(view)) await renderPublishingCategory(view);
    else await catalogView.render(view);
    if (document.activeElement === document.body) restoreFocus(held, { primary: 'main' });
  },
  onIssueLoadFailure: async ({
    error, list: _list, isCurrent, retry,
  }) => {
    const result = await runLocalConnectionProbe();
    if (!isCurrent()) return;
    if (result.current && result.status !== LOCAL_SERVER_STATUS.READY) {
      $('#preview-body').replaceChildren(noticeEl({
        msg: `The local app connection is not available, so the issue list could not be loaded. ${LOCAL_CONNECTION_STEPS} You can still add the Reading List.`,
        kind: 'warn',
        action: { label: 'Try again', onClick: () => { void retry(); } },
      }));
      return;
    }
    $('#preview-body').replaceChildren(el('p', {
      class: 'rail-hint',
      text: `The issue list could not be loaded: ${error.message}. You can still add the order.`,
    }));
  },
  onOpen: (_list, saved) => {
    store.update((state) => setActive(state, saved.id));
    if ($('#preview').open) $('#preview').close();
    showView('read', { push: true });
  },
  presentation: catalogPresentation,
  restoreFocus,
});

const readingPathsView = createReadingPathsView({
  clearLoadNotice: () => clearNotice(CATALOG_LOAD),
  el,
  elements: () => ({
    count: $('#reading-path-count'),
    description: $('#reading-path-description'),
    details: $('#reading-path-details'),
    name: $('#reading-path-name'),
    progressOutputs: () => document.querySelectorAll('[data-reading-path-progress]'),
    select: $('#reading-path-select'),
    source: $('#reading-path-source'),
    spine: $('#reading-path-spine'),
    status: $('#reading-path-status'),
  }),
  getRequestedPathId: () => requestedReadingPathId,
  getState: () => store.state,
  isCurrent: () => view === 'reading-paths',
  loadCatalog,
  onCanonicalPath: (pathId) => {
    requestedReadingPathId = pathId;
    syncHash();
    clearNotice(CATALOG_LOAD);
  },
  onLoadFailure: ({ error, retry, isCurrent }) => reportBundledLoadFailure({
    report: '#reading-paths-report',
    failure: `Reading paths could not be loaded: ${error.message}. Try this view again.`,
    key: CATALOG_LOAD,
    subject: 'Reading paths',
    retry,
    isCurrent,
  }),
  onSelectedPath: (pathId) => {
    requestedReadingPathId = pathId;
    syncHash({ push: true });
  },
});

export function fallbackInitials(value) {
  const words = String(value || '')
    .replace(/\(\d{4}(?:\s*-\s*\d{4})?\)/g, ' ')
    .match(/[a-z0-9]+/gi) ?? [];
  return words
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('');
}

function setFallbackInitials(fallback, value) {
  const [first = '', second = ''] = fallbackInitials(value);
  fallback.dataset.initialFirst = first;
  fallback.dataset.initialSecond = second;
  fallback.classList.toggle('one-initial', !second);
}
