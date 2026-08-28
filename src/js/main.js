// Application controller.
//
// Rendering follows the "Longbox Focus" design: a rail of reading orders, one hero card for
// the next unread issue, a short cover shelf, and the full order collapsed behind a summary.
// Cover art is optional everywhere: with it off no cover is requested and every image is
// replaced by a typographic tile.

import {
  createList, deleteList, restoreList, duplicateList, renameList, setActive, addIssuesToList, removeFromList, moveItem,
  toggleRead, markRead, isRead, upNext, listProgress, seriesProgress, listItems, exportBackup,
  setOverride, pendingIssueIds, coverUrl, listForCatalogId, SCHEMA_VERSION,
  setIssueNote, setListNote, MAX_BACKUP_BYTES, orderGapSentences, progressSummary, progressGroups, completionState, orderWord, orderStates, heldCount,
} from './lib/model.js';
import { parseChecklist, serializeChecklist, isSafeMarvelUrl, issueIdFromUrl, digitalIdFromUrl, resolveUniqueExact } from './lib/markdown.js';
import { DEFAULT_LIST_NAME, LIBRARY_VIEWS } from './lib/library.js';
import { availability, describe, localDayString, SHORT, STATE } from './lib/availability.js';
import { compareIssues } from './lib/sort.js';
import {
  parseCatalog, depthLabel, catalogFacets, filterByFacet, facetLabel,
  filterBySpotlightKind, spotlightKindLabel, resetCatalogNarrowing,
  searchCatalog, groupCatalog, variantLabel, sourceLink, sourceLabel, updatedLabel,
  sortSpotlightStories, spotlightSortLabel,
  catalogCoverUrl, readingTimeLabel, collectionsLabel, pickPath, countStories,
  pathPlacements, eraSections, decadeSections, availableHomeCategories, HOME_CATEGORIES,
  availablePublishingCategories, isPublishingCategoryLeaf, publishingAgeGroups, publishingCategoryStories,
  firstSentence, storyYear, timelineYears,
  catalogListShelf, CATALOG_SHELVES, PUBLISHING_CATEGORIES, shelfLists,
  modernTimelineLists, modernTimelineFeaturedList, modernTimelineFeaturedCard, visibleFirstStopGuides,
} from './lib/catalog.js';
import { Store, KEY as STATE_KEY } from './storage.js';
import { MarvelApi, DEFAULT_BASE } from './api.js';
import { ResponseCache } from './cache.js';
import { RateLimiter } from './lib/limiter.js';
import { Hydrator } from './hydrate.js';
import { NO_SYNOPSIS, SessionSynopsis, SynopsisRunner } from './synopsis.js';
import { openIssue as openIssueTab, detailUrl } from './reader.js';
import { APP_VERSION } from './lib/version.js';
import {
  UPDATE_DOWNLOAD_URL, UPDATE_RELEASE_NOTES_URL, checkForUpdate, compareVersions, normaliseReleaseVersion,
} from './lib/updateCheck.js';
import { isAllowedApiBase } from './lib/apiBase.js';
import { shortcutAllowed } from './lib/shortcuts.js';
import { lookupIssue } from './lib/wiki.js';
import { READING_FILTERS, DEFAULT_FILTER, matchesReadingFilter } from './lib/readingFilters.js';
import { DEFAULT_THEME, themeAttribute, normaliseTheme } from './lib/theme.js';
import {
  ADD_VIEWS, VIEWS, breadcrumbHierarchy, formatRoute, parseRoute,
} from './lib/route.js';
import { labelledName } from './lib/accname.js';
import { issuePresentation, resolveIssueFocus } from './lib/issueFocus.js';
import { askConfirm, askText, askNote, wireAsk } from './ask.js';
import {
  SAVE_EDUCATION_KEY, SAVE_EDUCATION_STATE, createSaveEducation,
} from './lib/saveEducation.js';

const SETTINGS_KEY = 'mrt.settings';
export const CACHE_PURGE_KEY = 'mrt.cache-purge.v1';
const SIDEBAR_KEY = 'sidebar.collapsed';
const RING_CIRCUMFERENCE = 119.4; // 2πr for r=19, matching the SVG in index.html
const SHELF_SIZE = 8;
// One binding for the words the catalog uses to add an order, shared by the home card and the
// catalog row. They rendered two different labels for one behaviour before, which is how they
// drifted apart in the first place.
const CATALOG_ADD = '+ Add to library';
// Above this many orders, scanning a browse shelf stops being enough and the reader needs to type.
const CATALOG_FILTER_THRESHOLD = 12;
// Below this viewport width the rail collapses on its own; a manual toggle then wins until
// the breakpoint is crossed again.
const RAIL_BREAKPOINT = 1000;
// What the hero's heading says when there is no next issue to name. The hero is hidden in
// that state, so this is never read aloud or seen; it exists so the heading is never empty.
// It has to match the text in index.html, which is what the document starts out holding.
const HERO_NO_ISSUE = 'Nothing up next';
// The same for the landing page's continue card, whose heading also names its section. Both
// have to match the text index.html starts out holding.
const CONTINUE_NO_LIST = 'Continue reading';
const UPDATE_NOTICE_KEY = 'update-available';
const UPDATE_CHECK_BUTTON_TEXT = 'Check for updates';

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
const hydrator = new Hydrator({ api, store, onProgress: renderHydration });
// One store for the tab, deliberately module-level and deliberately not persisted. It is passed to
// the runner rather than owned by it so the view can read a fetched synopsis without importing the
// thing that fetches it.
const sessionSynopsis = new SessionSynopsis();
const synopsisRunner = new SynopsisRunner({ api, store, session: sessionSynopsis, onProgress: renderSynopsis });

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
    const cleanup = sanitizeStoredIssueDescriptions(readerStore, event.newValue, {
      onFailure: (error) => notify('#save-report', error, 'error'),
    });
    if (!cleanup.needed) readerStore.adoptForeignWrite(event.newValue);
    return;
  }
  if (event.key === SAVE_EDUCATION_KEY) {
    education.adopt(event.newValue);
    renderEducation();
    return;
  }
  if (event.key === null) {
    readerStore.adoptForeignWrite(null);
    education.adopt(null);
    renderEducation();
  }
}

globalThis.addEventListener?.('storage', dispatchStorageEvent);

// One filter, shared by every list, and it now survives a reload. Per list was considered and
// rejected: the filter already crossed lists within a session, so making it per list would have
// changed behaviour a reader has today as well as adding state that grows with the library. A
// reader who sets Unread has said how they want to read, not how they want to read one order.
// Its restored value is applied in wireReading(), which runs before the first render.
let filter = DEFAULT_FILTER;
let view = 'read';
let issueRoute = null;
let issueFocusLoad = null;
let issueFocusResult = null;
let issueSynopsisId = null;
let updateNoticeDismissed = false;
let updateCheckInFlight = false;

// ------------------------------------------------------------------ unreadable-data recovery

// Set once the user has saved a copy of the unreadable data to disk themselves. It is the only
// way out when the browser is too full to hold a second copy, which is exactly the situation
// where the automatic salvage fails.
let downloadedSalvage = false;

// The banner as the last render left it, so its withdrawal can take the notices that were about
// it. While the banner is up, everything the save report can hold is about the block: a refused
// write, the refusal to start fresh, and the empty-download warning are its only writers in that
// state. So the moment saving works again, whatever is still in there points at a banner that is
// no longer on screen. A restore is the path that exposed this, because it reports its own
// success to the restore pane and leaves the save report untouched.
let blockedBannerWasUp = false;

function renderBlocked() {
  const banner = $('#blocked-banner');
  banner.hidden = !store.blocked;
  // Painted from the reason the read failed rather than from the newest error, so a write
  // refused while blocked no longer displaces the one thing on this screen that the standing
  // copy cannot know. Written only when it differs, because this runs on every render and
  // assigning an identical string still replaces the text node inside a role="alert", which
  // invites the same sentence to be read out again on every save the reader makes.
  const why = $('#blocked-why');
  const reason = store.blockedReason ?? '';
  if (why.textContent !== reason) why.textContent = reason;
  // Below the hide, so a cleared reason is never on screen: the banner has already gone by the
  // time the text it held is emptied.
  if (blockedBannerWasUp && !store.blocked) $('#save-report').replaceChildren();
  blockedBannerWasUp = store.blocked;
  // The pre-restore snapshot outlives a reload, so the undo affordance must be restored on
  // boot rather than only after the restore that created it.
  const undo = $('#btn-undo-restore');
  if (undo) undo.hidden = !store.hasPreRestoreSnapshot();
}

function wireBlockedBanner() {
  $('#btn-download-salvage').addEventListener('click', () => {
    const raw = store.salvagedRaw();
    if (!raw) return notify('#save-report', 'There was nothing left to download.', 'warn');
    const when = new Date().toISOString().slice(0, 10);
    download(`recap-page-unreadable-${when}.json`, raw, 'application/json');
    downloadedSalvage = true;
    announce('Downloaded a copy of the unreadable data.');
  });

  $('#btn-start-fresh').addEventListener('click', async () => {
    const yes = await askConfirm({
      title: 'Start fresh?',
      body: 'This replaces the unreadable saved data with an empty tracker. Download a copy first if you have not already.',
      confirmLabel: 'Start fresh',
    });
    if (!yes) return;
    // Not reported on failure: both failing exits assign lastError and then call onChange,
    // which already notifies here. Measured in Edge, 2 identical strings per refusal, now 1.
    if (store.startFresh({ confirmedDownloaded: downloadedSalvage })) {
      notify('#save-report', 'Started fresh. Saving is working again.', 'ok');
    }
  });
}

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
const generatedCategoryByRoute = new Map([
  ...PUBLISHING_CATEGORIES,
  ...HOME_CATEGORIES.filter((category) => !category.shelf),
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
  if (control.href) {
    return el('a', {
      ...props,
      href: control.href,
      target: control.target ?? '_blank',
      rel: control.rel ?? 'noopener noreferrer',
      onclick: control.onClick,
    }, control.label);
  }
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

export function noticeEl({ msg, kind, action, dismiss, links = [] }) {
  const controls = [action, ...links, dismiss].filter(Boolean);
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
function notify(sel, msg, kind = 'ok', key = sel, action = null, dismiss = null, links = []) {
  const own = $(sel);
  if (!own) return;
  // Only the general notice panes move. #save-report sits above every view and is assertive
  // because a persistence failure must not be missed, and the result panes are read alongside the
  // form that filled them, so relocating either would lose the context that makes it actionable
  // and would quietly change which channel it goes out on.
  if (!own.classList.contains('report')) {
    own.replaceChildren(noticeEl({ msg, kind, action, dismiss, links }));
    if (!isLive(own)) announce(spoken(msg, action, dismiss, links));
    return;
  }
  // Re-inserted rather than overwritten in place, because a Map keeps a key at its original
  // position and arrival order is what decides the newest message.
  notices.delete(key);
  notices.set(key, { sel, msg, kind, action, dismiss, links });
  const box = placeNotices().get(sel) ?? own;
  // Nothing else scrolls a pane into view, and "nearest" is a no-op once it is fully visible, so
  // this moves the page only when the message would otherwise be missed.
  box.scrollIntoView?.({ block: 'nearest' });
  if (!isLive(box)) announce(spoken(msg, action, dismiss, links));
}

// A button that is never spoken is a button a screen reader user cannot know to look for, and the
// undo is the whole point of the message it sits in. The same argument reaches the dismiss, for the
// opposite reason: a message that stays until it is closed is one a reader has to be told they can
// close, and a notice held for a whole session is exactly the one where not knowing costs the most.
export function spoken(msg, action, dismiss, links = []) {
  const labels = [action, ...links, dismiss].filter(Boolean).map((c) => c.label);
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
      updateChecks: raw.updateChecks !== false,
      updateCheckedAt: updateCheckedAtOf(raw),
      updateSeenVersion: normaliseReleaseVersion(raw.updateSeenVersion) ?? '',
      rejectedApiBase: ok ? null : stored,
    };
  } catch {
    return {
      apiBase: DEFAULT_BASE,
      covers: true,
      theme: DEFAULT_THEME,
      filter: 'all',
      updateChecks: true,
      updateCheckedAt: 0,
      updateSeenVersion: '',
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

function updateCheckedAtOf(raw) {
  const n = Number(raw?.updateCheckedAt);
  return Number.isFinite(n) && n > 0 ? n : 0;
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
  const updateCheckedAt = updateCheckedAtOf(settings);
  settings.updateCheckedAt = updateCheckedAt;
  const updateSeenVersion = normaliseReleaseVersion(settings.updateSeenVersion) ?? '';
  settings.updateSeenVersion = updateSeenVersion;
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      apiBase,
      covers: settings.covers,
      theme: settings.theme,
      filter: settings.filter,
      updateChecks: settings.updateChecks !== false,
      updateCheckedAt,
      updateSeenVersion,
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
  const activeCleared = legacy.blocked
    ? await cacheRef.clear({ requireAccess: true })
    : firstActiveClear;
  return { activeCleared, legacy };
}

export async function maintainCacheGeneration(
  cacheRef,
  marker,
  current = CACHE_PURGE_VERSION,
  { onLegacyBlocked = () => {} } = {},
) {
  const purge = await purgeStaleCache(cacheRef, marker, current);
  const activeCleared = !purge.ran || purge.cleared;
  const legacy = await cacheRef.deleteLegacy({
    onBlocked: () => onLegacyBlocked({ activeCleared }),
  });
  return { ran: purge.ran, activeCleared, legacy };
}

function cleanupFailureMessage(result) {
  const failures = [];
  if (!result.activeCleared) failures.push('Cached metadata used by this version could not be cleared.');
  if (result.savedStateCleared === false) {
    failures.push('Saved issue summaries written by an older tab could not be removed.');
  }
  if (result.legacy.status === 'unavailable') {
    failures.push('Older cached metadata could not be checked because browser storage is unavailable.');
  } else if (result.legacy.status === 'failed') {
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

export function sanitizeStoredIssueDescriptions(
  readerStore,
  raw,
  { onFailure = () => {} } = {},
) {
  if (!rawCarriesIssueDescriptions(raw)) return { needed: false, cleared: true };
  if (readerStore.blocked) {
    const sanitizer = new Store({ storage: readerStore.storage });
    sanitizer.load();
    if (sanitizer.blocked) {
      const error = sanitizer.blockedReason ?? sanitizer.lastError
        ?? 'Saved issue summaries written by an older tab could not be read safely.';
      onFailure(error);
      return { needed: true, cleared: false };
    }
    const cleared = sanitizer.persist();
    if (!cleared) onFailure(sanitizer.lastError);
    return { needed: true, cleared };
  }
  if (!readerStore.adoptForeignWrite(raw)) return { needed: true, cleared: false };
  const cleared = readerStore.persist();
  if (!cleared) {
    readerStore.onChange?.(readerStore.state, readerStore.lastError);
    onFailure(readerStore.lastError);
  }
  return { needed: true, cleared };
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
  const stateCleanup = sanitizeStoredIssueDescriptions(store, localStorage.getItem(STATE_KEY));
  const complete = { ...result, savedStateCleared: stateCleanup.cleared };
  const cleanupFailure = cleanupFailureMessage(complete);
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
  renderReading();
  renderHome();
  renderLibrary();
  announce(settings.covers ? 'Cover art on.' : 'Cover art off. Covers are shown as text tiles.');
}

function applyUpdateCheckSetting() {
  const opt = $('#opt-update-checks');
  if (opt) opt.checked = settings.updateChecks !== false;
}

function setUpdateChecks(on) {
  settings.updateChecks = Boolean(on);
  saveSettings();
  applyUpdateCheckSetting();
  if (!settings.updateChecks) {
    updateNoticeDismissed = true;
    clearNotice(UPDATE_NOTICE_KEY);
  }
  announce(settings.updateChecks
    ? 'Update checks on. The app will ask GitHub once a day for the latest version number.'
    : 'Update checks off. The app will not ask GitHub for updates unless you press Check for updates.');
}

function updateIsNewer(version) {
  return compareVersions(version, APP_VERSION) > 0;
}

function updateNoticeMessage(latestVersion) {
  return `Version ${latestVersion} is available. You have ${APP_VERSION}. Unzip it anywhere and double-click "Start on Windows.cmd" inside. Your reading progress is saved by your browser rather than in this folder, so it will all still be here. Once the new version opens, you can delete the old folder.`;
}

function updateLinks(latestVersion) {
  return {
    action: { label: `Download version ${latestVersion}`, href: UPDATE_DOWNLOAD_URL },
    links: [{ label: 'What changed', href: UPDATE_RELEASE_NOTES_URL }],
  };
}

function dismissUpdateNotice() {
  updateNoticeDismissed = true;
  clearNotice(UPDATE_NOTICE_KEY);
}

function showUpdateNotice(latestVersion) {
  if (updateNoticeDismissed || !updateIsNewer(latestVersion)) return;
  const { action, links } = updateLinks(latestVersion);
  notify(
    '#app-report',
    updateNoticeMessage(latestVersion),
    'warn',
    UPDATE_NOTICE_KEY,
    action,
    { label: 'Dismiss', onClick: dismissUpdateNotice },
    links,
  );
}

function renderUpdateReport(note, { announceIt = true } = {}) {
  const box = $('#update-check-report');
  if (!box) return;
  if (!note) {
    box.replaceChildren();
    return;
  }
  box.replaceChildren(noticeEl(note));
  if (announceIt) announce(spoken(note.msg, note.action, note.dismiss, note.links));
}

function showStoredUpdateResult({ announceReport = false, notice = true } = {}) {
  const latestVersion = settings.updateSeenVersion;
  if (!updateIsNewer(latestVersion)) return;
  const { action, links } = updateLinks(latestVersion);
  const note = { msg: updateNoticeMessage(latestVersion), kind: 'warn', action, links, dismiss: null };
  renderUpdateReport(note, { announceIt: announceReport });
  if (notice) showUpdateNotice(latestVersion);
}

function rememberUpdateResult(result) {
  if (result.status === 'not-due') return;
  if (Number.isFinite(result.checkedAt) && result.checkedAt > 0) settings.updateCheckedAt = result.checkedAt;
  if (result.latestVersion) settings.updateSeenVersion = result.latestVersion;
  saveSettings();
}

async function runAutomaticUpdateCheck() {
  if (settings.updateChecks === false) return;
  const result = await checkForUpdate({
    fetchImpl: globalThis.fetch?.bind(globalThis),
    now: () => Date.now(),
    lastCheckedAt: settings.updateCheckedAt,
  });
  rememberUpdateResult(result);
  if (result.available) {
    showStoredUpdateResult({ announceReport: false, notice: true });
  }
}

function updateFailureNote() {
  return {
    msg: 'The update check could not be completed. You can visit the releases page directly.',
    kind: 'warn',
    action: { label: 'Open releases', href: UPDATE_RELEASE_NOTES_URL },
    links: [],
    dismiss: null,
  };
}

async function runExplicitUpdateCheck() {
  if (updateCheckInFlight) return;
  const button = $('#btn-check-updates');
  updateCheckInFlight = true;
  if (button) {
    button.disabled = true;
    button.textContent = 'Checking...';
  }
  renderUpdateReport({ msg: 'Checking GitHub for the latest version...', kind: 'ok', action: null, links: [], dismiss: null });
  try {
    const result = await checkForUpdate({
      fetchImpl: globalThis.fetch?.bind(globalThis),
      now: () => Date.now(),
      lastCheckedAt: settings.updateCheckedAt,
      force: true,
    });
    rememberUpdateResult(result);
    if (result.available) {
      showStoredUpdateResult({ announceReport: true, notice: false });
    } else if (result.status === 'current') {
      renderUpdateReport({
        msg: `This is the latest version. You have ${APP_VERSION}.`,
        kind: 'ok',
        action: null,
        links: [],
        dismiss: null,
      });
    } else {
      renderUpdateReport(updateFailureNote());
    }
  } finally {
    updateCheckInFlight = false;
    if (button) {
      button.disabled = false;
      button.textContent = UPDATE_CHECK_BUTTON_TEXT;
    }
  }
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
let applyingRouteToDisclosure = false;

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
// True while a keyboard traversal of the filter group is open, meaning the reader is part way
// through choosing and the address has deliberately not been written yet. Kept beside syncHash
// rather than inside wireReading because syncHash and applyRoute both have to see it.
//
// The first design pushed on the traversal's first stop and replaced on every stop after it. Review
// found that a traversal returning to the filter it started from then replaced the top entry with a
// copy of the one below it, and a same-document Back between two identical fragments fires no
// hashchange at all, so the press did nothing. Measured on that tree: ArrowRight then ArrowLeft left
// history ["#/read/list-a", "#/read/list-a"] and the following Back reported 0 hashchange events
// with the rows unmoved. That is the very failure the paragraph above says the guard exists to
// prevent, reached from the other side. A replace cannot remove an entry the run has already
// pushed, and history.back() is async and races the next arrow press, so the write is held until
// the traversal ends instead.
let filterRunOpen = false;
// What the address claims while a traversal is open, which is the filter in force when it began.
// Not the same as `filter`, which follows the rows immediately.
let filterRunBase = null;
let filterRunAddressed = false;
// A restored setting can filter closed rows without turning a plain address into opening intent.
// Only a route token or a filter choice makes the current filter part of the address.
let filterAddressed = false;

function syncHash({ push = false } = {}) {
  if (!routeReady || applyingRoute) return;
  // While a traversal is open the address lags the rows on purpose: the entry on top is the one the
  // reader arrived on and Back has to return to it. A passive sync fired by something else in that
  // window would otherwise replace it with the half-chosen address and destroy it. That is reachable
  // rather than theoretical: background hydration writes through store.update on its own timer, and
  // every store.update reaches renderAll, which syncs.
  const shown = filterRunOpen && !push ? filterRunBase : filter;
  const showFilter = filterRunOpen && !push ? filterRunAddressed : filterAddressed;
  const spotlightState = shelfState.get('spotlights');
  const sort = view === 'spotlights' && spotlightState ? spotlightState.sort : null;
  const next = view === 'issue' && issueRoute
    ? formatRoute(issueRoute)
    : formatRoute({
      view,
      listId: activeListId(),
      filter: showFilter ? shown : DEFAULT_FILTER,
      full: view === 'read' && $('#full').open,
      sort,
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

// Committing writes the traversal's one entry; discarding drops it because something else has
// already decided the address. A commit that lands back on the address the traversal started from
// meets the compare in syncHash and correctly writes nothing, which is why the whole sweep can
// leave zero entries as well as one.
function endFilterRun({ commit }) {
  if (!filterRunOpen) return;
  filterRunOpen = false;
  filterRunBase = null;
  filterRunAddressed = false;
  if (commit) {
    filterAddressed = true;
    syncHash({ push: true });
  }
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
      endFilterRun({ commit: false });
      issueRoute = route;
      showView('issue', { focus });
      return;
    }
    issueFocusLoad?.abort();
    issueFocusLoad = null;
    issueFocusResult = null;
    issueRoute = null;
    if (route.listId && route.listId !== activeListId() && Object.hasOwn(store.state.lists, route.listId)) {
      store.update((s) => setActive(s, route.listId));
    }
    const spotlightState = shelfState.get('spotlights');
    if (route.view === 'spotlights' && spotlightState) {
      spotlightState.sort = route.sort === 'popularity' ? 'popularity' : null;
    }
    // Before showView, so the passive sync at the end of showView computes the address this route
    // already describes and returns early rather than writing one and being corrected a moment later.
    filterAddressed = route.filter !== null;
    setFilter(route.filter ?? filterIfAbsent);
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
    endFilterRun({ commit: false });
    if (route.view === 'read') {
      const openFromRoute = route.full === true || route.filter !== null;
      setFullOrderFromRoute(openFromRoute);
      if (openFromRoute && rowsPending) renderRows();
    }
    showView(route.view, { focus });
  } finally {
    applyingRoute = false;
  }
  if (focus) void restoreIssueFocusOpener(route.view);
}

function setFullOrderFromRoute(open) {
  const full = $('#full');
  if (full.open === open) return;
  const active = document.activeElement;
  if (!open && active && full.contains(active) && active !== full.querySelector('summary')) {
    full.querySelector('summary').focus({ preventScroll: true });
  }
  applyingRouteToDisclosure = true;
  full.open = open;
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
    issueFocusLoad?.abort();
    issueFocusLoad = null;
    issueFocusResult = null;
    issueRoute = null;
    if (issueSynopsisId != null) {
      synopsisRunner.cancel();
      issueSynopsisId = null;
    }
  }

  view = next;
  warmNameIndexForView(next);
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
  if (shelf) renderCatalogShelf(shelf.key);
  if (generatedCategoryByRoute.has(next)) renderPublishingCategory(next);
  if (next === 'home') renderHome();
  if (next === 'library') renderLibraryHub();
  if (next === 'browse') renderHomeCategories();
  if (next === 'issue') void renderIssueFocus();
  renderBreadcrumbs();
  // Here rather than in renderAll, because what this list reports is not part of the state every
  // render repaints: it changes when a read fails at boot, when the reader removes a copy, and in
  // another tab. Rebuilding it on arrival covers all three and leaves renderAll's fan-out alone.
  // Erasing everything is a fourth, and the one arrival cannot cover, because it happens on this
  // screen rather than before reaching it, so that route repaints at its own call site.
  if (next === 'data') renderSalvage();
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
  const resolvedContext = issueFocusResult?.contextStatus === 'valid'
    ? {
      ...issueFocusResult.context,
      shelf: issueFocusResult.breadcrumbShelf ?? null,
    }
    : null;
  const trail = breadcrumbHierarchy({
    view,
    list: active ? { id: active.id, name: active.name } : null,
    issueTitle: issueFocusResult?.issue?.title ?? null,
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
    $('#full').open = true;
    renderRows();
  }
  if (opener.surface === 'preview' && opener.contextId) {
    try {
      const catalog = await loadCatalog();
      const list = catalog.lists.find((entry) => entry.id === opener.contextId);
      if (list) await openPreview(list);
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

function issueContextText(context) {
  if (!context) return '';
  const position = context.total ? `${context.position} of ${context.total}` : '';
  return [context.name, context.collectedIn, position].filter(Boolean).join(' · ');
}

function paintIssueFocus(result) {
  const card = $('#issue-focus-card');
  const status = $('#issue-focus-status');
  const issue = result?.issue;
  issueFocusResult = result;
  if (!issue) {
    card.hidden = true;
    $('#issue-focus-h').textContent = 'Issue unavailable';
    $('#issue-focus-context').textContent = '';
    status.textContent = issueRoute?.issueId < 0
      ? 'This local issue is no longer in saved data or the bundled order named by the link.'
      : 'Issue details could not be loaded. Your saved lists and progress are unchanged.';
    renderBreadcrumbs();
    return;
  }

  const context = result.context;
  const override = context?.override ?? store.state.overrides[issue.issueId] ?? null;
  const presentation = issuePresentation(issue, {
    override,
    position: context?.position ?? null,
    total: context?.total ?? null,
    description: synopsisFallback(issue, sessionSynopsis.get(issue.issueId)),
  });
  $('#issue-focus-h').textContent = presentation.title;
  $('#issue-focus-context').textContent = issueContextText(context);
  status.textContent = result.contextStatus === 'stale'
    ? 'The list or bundled order in this link no longer contains this issue. Showing issue details without that context.'
    : '';
  card.hidden = false;
  paintCover($('#issue-focus-img'), $('#issue-focus-fb'), issue, 'portrait_uncanny');
  $('#issue-focus-img').alt = coverUrl(issue, 'portrait_uncanny') ? `Cover of ${issue.title}` : '';
  $('#issue-focus-fs').textContent = seriesOnly(issue.seriesName);
  $('#issue-focus-fn').textContent = presentation.number;
  paintHeroBackground($('#issue-focus-bg'), issue);
  $('#issue-focus-by').textContent = presentation.byline;
  $('#issue-focus-desc').textContent = presentation.description;
  $('#issue-focus-facts').replaceChildren(...presentation.facts.map((item) => (
    fact(item.key, item.value, item.className)
  )));
  const note = $('#issue-focus-note');
  note.textContent = context?.note ?? '';
  note.hidden = !note.textContent;
  $('#btn-issue-read').hidden = !presentation.launchable;
  const info = $('#btn-issue-info');
  info.hidden = !presentation.detailUrl;
  if (presentation.detailUrl) {
    info.href = presentation.detailUrl;
    info.setAttribute('aria-label', labelledName(info.textContent, `${issue.title} on marvel.com`));
  } else {
    info.removeAttribute('href');
    info.removeAttribute('aria-label');
  }
  $('#btn-issue-synopsis').hidden = issue.issueId < 0 || synopsisRunner.active;
  $('#btn-cancel-issue-synopsis').hidden = true;
  renderBreadcrumbs();
}

async function renderIssueFocus() {
  if (!issueRoute) return;
  issueFocusLoad?.abort();
  const controller = new AbortController();
  issueFocusLoad = controller;
  issueFocusResult = null;
  $('#issue-focus-card').hidden = true;
  $('#issue-focus-h').textContent = 'Loading issue details';
  $('#issue-focus-context').textContent = '';
  $('#issue-focus-status').textContent = 'Loading issue details…';
  let catalog = null;
  if (issueRoute.context?.kind === 'order') {
    try {
      catalog = await loadCatalog();
    } catch {
      catalog = null;
    }
  }
  try {
    const result = await resolveIssueFocus({
      issueId: issueRoute.issueId,
      context: issueRoute.context,
      state: store.state,
      catalog,
      loadOrder: loadBundledOrder,
      api,
      signal: controller.signal,
    });
    if (issueFocusLoad !== controller || controller.signal.aborted) return;
    const breadcrumbShelf = result.contextStatus === 'valid' && result.context?.kind === 'order'
      ? catalogListShelf(catalog?.lists, result.context.id)
      : null;
    paintIssueFocus({ ...result, breadcrumbShelf });
    if (result.contextStatus === 'stale' && issueRoute.context) {
      issueRoute = { ...issueRoute, context: null };
      syncHash();
    }
  } catch (error) {
    if (error?.name === 'AbortError' || issueFocusLoad !== controller) return;
    paintIssueFocus({ issue: null, source: 'unavailable', context: null, contextStatus: 'none', error });
  }
}

function wireIssueFocus() {
  $('#btn-issue-read').addEventListener('click', (event) => {
    if (issueFocusResult?.issue) openInReader(issueFocusResult.issue, event);
  });
  $('#btn-issue-synopsis').addEventListener('click', startIssueSynopsis);
  $('#btn-cancel-issue-synopsis').addEventListener('click', () => synopsisRunner.cancel());
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

// ------------------------------------------------------------------ landing page

// The parsed catalog is shared by later Home renders. Category availability changes only when the
// bundled data changes, so a library update does not need to fetch or rebuild it.
let homeCatalog = null;
// Catalog ids that were just added, so the button can show "✓ In library" for a beat before
// settling into "Open →". Transient by design; a reload shows the settled state.
const justAdded = new Set();

function wireHome() {
  $('#btn-chero-read').addEventListener('click', (e) => {
    const issue = upNext(store.state, activeListId());
    if (issue) openInReader(issue, e);
  });
  $('#btn-chero-open').addEventListener('click', () => showView('read', { push: true }));
}

function renderHome() {
  if ($('#view-home').hidden) return;
  const populated = store.state.listOrder.length > 0;
  const firstRun = ensureHomeFirstRun();

  // The masthead remains the app name whether or not Continue reading is present.
  $('#home-cat-h').classList.toggle('visually-hidden', !populated);
  firstRun.hidden = populated;

  renderContinue(populated);
  renderYours(populated);
  renderHomeCategories();

  // The attribution is required wherever Marvel data is shown, and the year has to be the
  // current one rather than a string baked into the markup.
  for (const label of document.querySelectorAll('[data-marvel-copyright]')) {
    label.textContent = `© ${new Date().getFullYear()} MARVEL`;
  }
}

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
      ...(category.kind === 'publishing-index' ? [] : [el('section', { id: `${category.route}-categories`, class: 'publishing-periods', hidden: true, 'aria-labelledby': `${category.route}-categories-h` }, [
        el('div', { class: 'sec-h' }, el('h2', { id: `${category.route}-categories-h`, text: 'Choose a Period' })),
        el('ul', { id: `${category.route}-category-list`, class: 'home-paths home-paths-secondary' })])]),
      el('div', { id: `${category.route}-results`, class: 'results' }),
    ]), $('.app-footer'));
  }
}

// State B's hero: the list being read, how far through it the reader is, and what is next.
// There are no read timestamps in the state, so "where you left off" is the active list —
// the one the reader last opened — rather than a guess at recency.
function renderContinue(populated) {
  const sec = $('#home-continue');
  const id = activeListId();
  const list = store.state.lists[id];
  sec.hidden = !populated || !list;
  // Hidden rather than emptied, so the heading keeps text. It labels this section, so an
  // empty one costs the section its name too.
  if (sec.hidden) {
    $('#chero-h').textContent = CONTINUE_NO_LIST;
    return;
  }

  const { read, total } = listProgress(store.state, id);
  const issue = upNext(store.state, id);

  $('#chero-h').textContent = list.name;

  const bar = $('#chero-bar');
  bar.setAttribute('aria-valuemax', String(total));
  bar.setAttribute('aria-valuenow', String(read));
  // The percentage alone would be a bare number to a screen reader; the text is what says
  // what the number counts, and it is on screen too rather than being audio-only.
  bar.setAttribute('aria-valuetext', `${read} of ${total} issues read`);
  $('#chero-fill').style.setProperty('width', `${total ? ((read / total) * 100).toFixed(1) : 0}%`);
  $('#chero-count').textContent = `${read} of ${total} issue${total === 1 ? '' : 's'} read`;

  if (issue) {
    $('#chero-next').textContent = `Next: ${issue.title}`;
    paintCover($('#chero-img'), $('#chero-fb'), issue, 'portrait_incredible');
    $('#chero-fs').textContent = seriesOnly(issue.seriesName);
    $('#chero-fn').textContent = issue.number ? `#${issue.number}` : '';
    $('#btn-chero-read').hidden = false;
    // The label is read off the button rather than repeated here, so editing the markup cannot
    // leave the name behind still claiming the old words.
    $('#btn-chero-read').setAttribute('aria-label', labelledName($('#btn-chero-read').textContent, `${issue.title} in Marvel Unlimited`));
  } else {
    $('#chero-next').textContent = 'You have read every issue in this order.';
    // Nothing to open, so the button goes rather than sitting there disabled with no
    // explanation of why it cannot be used.
    $('#btn-chero-read').hidden = true;
    paintCoverUrl($('#chero-img'), $('#chero-fb'), null, hueOf(list.name), list.name);
    $('#chero-fs').textContent = shortTitle(list.name);
    $('#chero-fn').textContent = '';
  }
  $('#btn-chero-open').setAttribute('aria-label', labelledName($('#btn-chero-open').textContent, list.name));
}

function renderYours(populated) {
  const sec = $('#home-yours');
  sec.hidden = !populated;
  if (sec.hidden) return;

  // The section heading gains a one line summary of the whole shelf: how many orders there are
  // and how far along they are, written once beside the heading before the tiles are read.
  writeYoursSummary(sec, store.state);

  const box = $('#home-yours-list');
  box.replaceChildren(...savedListTiles());
}

function savedListTiles() {
  return store.state.listOrder.map((id) => {
    const list = store.state.lists[id];
    const { read, total } = listProgress(store.state, id);
    // The tile prints the count as "3 / 20" and the old name said "3 of 20", so the inserted
    // word split the run the tile shows. The name is built from that painted text, and gains
    // the state word now painted on the tile, which is what a visible label must also carry.
    const count = `${read} / ${total}`;
    const context = `issues read, ${orderWord(completionState(read, total))}. Open this list`;
    return el('li', {}, el('button', {
      type: 'button',
      'aria-label': labelledName(`${list.name} ${count}`, context),
      onclick: () => { store.update((s) => setActive(s, id)); showView('read', { push: true }); },
    }, yoursTile(list, store.state, read, total, count)));
  });
}

function renderLibraryHub() {
  const populated = store.state.listOrder.length > 0;
  $('#library-yours').hidden = !populated;
  $('#library-empty').hidden = populated;
  if (!populated) return;
  writeYoursSummary($('#library-yours'), store.state);
  $('#library-yours-list').replaceChildren(...savedListTiles());
}

function ensureHomeFirstRun() {
  let section = $('#home-first-run');
  if (section) return section;
  const recommendation = el('div', { id: 'home-recommended', class: 'notice notice-act', hidden: true }, [
    el('div', { class: 'grow' }, [
      el('h3', { id: 'home-recommended-h', text: 'Recommended start: Setup to Modern Timeline' }),
      el('p', { text: "A guided path through the earlier stories that prepare you for this app's Modern Timeline." }),
    ]),
    el('button', { type: 'button', id: 'btn-home-recommended', class: 'btn' }, 'Preview this Reading List'),
  ]);
  section = el('section', { id: 'home-first-run', class: 'sec', hidden: true, 'aria-labelledby': 'home-first-run-h' }, [
    el('div', { class: 'sec-h' }, el('h2', { id: 'home-first-run-h', text: 'Where do you want to start?' })),
    el('p', { class: 'home-first-run-copy', text: 'Browse curated Reading Lists. Add individual issues or your own list.' }), recommendation,
  ]);
  $('#home-categories').prepend(section);
  return section;
}

async function renderHomeCategories() {
  const gateways = [...document.querySelectorAll('[data-category-gateway]')]; for (const label of document.querySelectorAll('[data-marvel-copyright]')) label.textContent = `© ${new Date().getFullYear()} MARVEL`;
  if (!homeCatalog) {
    for (const gateway of gateways) { const status = gateway.querySelector('[data-paths-status]'); status.classList.remove('visually-hidden'); status.hidden = false; status.textContent = 'Loading ways to read…'; }
    try {
      homeCatalog = await loadCatalog();
    } catch (err) {
      for (const gateway of gateways) {
        gateway.querySelector('[data-primary-paths]').hidden = true; gateway.querySelector('[data-more-paths]').hidden = true; gateway.querySelector('[data-paths-status]').hidden = true;
      }
      const report = view === 'browse' ? '#browse-cat-report' : '#home-cat-report'; notify(report, `The catalog could not be loaded: ${err.message}. Your lists are unchanged.`, 'error', CATALOG_LOAD);
      return;
    }
    clearNotice(CATALOG_LOAD);
  }

  const recommendation = $('#home-recommended'); if (recommendation) {
    const list = modernTimelineFeaturedList(homeCatalog.lists); recommendation.hidden = !list; if (list) $('#btn-home-recommended').onclick = () => openPreview(list);
  }
  if (homeCatalog.dropped) {
    const report = view === 'browse' ? '#browse-cat-report' : '#home-cat-report';
    notify(report, `${homeCatalog.dropped} catalog ${homeCatalog.dropped === 1 ? 'entry is' : 'entries are'} incomplete and cannot be shown.`, 'warn');
  }

  const categories = availableHomeCategories(groupCatalog(homeCatalog.lists)); const primaryCategories = categories.filter(({ tier }) => tier === 'primary'); const secondaryCategories = categories.filter(({ tier }) => tier === 'secondary');
  for (const gateway of gateways) {
    const primary = gateway.querySelector('[data-primary-paths]');
    const secondary = gateway.querySelector('[data-secondary-paths]');
    const more = gateway.querySelector('[data-more-paths]'); const status = gateway.querySelector('[data-paths-status]');
    primary.replaceChildren(...primaryCategories.map(homeCategoryTile)); secondary.replaceChildren(...secondaryCategories.map(homeCategoryTile));
    primary.hidden = primaryCategories.length === 0; more.hidden = secondaryCategories.length === 0;
    const statusText = categories.length ? `${categories.length} ways to read available.` : 'No reading paths are bundled with this build.';
    status.classList.toggle('visually-hidden', categories.length > 0); status.hidden = false;
    if (status.textContent !== statusText) status.textContent = statusText;
  }
}

function homeCategoryTile(category) {
  const glyph = String.fromCodePoint(Number.parseInt(category.icon, 16));
  const count = `${category.count} ${category.count === 1 ? 'Reading List' : 'Reading Lists'}`;
  return el('li', {}, el('button', {
    type: 'button',
    class: `home-path home-path-${category.tier}`,
    'aria-label': `${category.heading}. ${category.label}. ${count}.`,
    dataset: { category: category.key },
    onclick: () => showView(category.route, { push: true }),
  }, [
    el('span', { class: 'gi home-path-icon', 'aria-hidden': 'true', text: glyph }),
    el('span', { class: 'home-path-copy' }, [
      el('span', { class: 'eyebrow home-path-label', text: category.label }),
      el('span', { class: 'home-path-title', text: category.heading }),
      el('span', { class: 'home-path-count', text: count }),
    ]),
    el('span', {
      class: 'gi home-path-arrow',
      'aria-hidden': 'true',
      text: String.fromCodePoint(0xE72A),
    }),
  ]));
}

function renderPublishingIndex(category, allStories) {
  const box = $(`#${category.route}-results`); const { count, earlier, modern, modernChildren } = publishingAgeGroups(allStories);
  $(`#${category.route}-count`).textContent = `${count} ${count === 1 ? 'Reading List' : 'Reading Lists'}`; box.replaceChildren();
  if (count === 0) { box.append(el('p', { class: 'rail-hint publishing-empty', text: 'No Reading Lists are published by age yet.' })); return; }
  if (earlier.length) box.append(el('section', { id: 'marvel-ages-earlier', class: 'publishing-periods marvel-ages-group', 'aria-labelledby': 'marvel-ages-earlier-h' }, [el('div', { class: 'sec-h' }, el('h2', { id: 'marvel-ages-earlier-h', text: 'Earlier Marvel' })), el('ul', { id: 'marvel-ages-earlier-list', class: 'home-paths home-paths-secondary' }, earlier.map((child) => homeCategoryTile({ ...child, tier: 'secondary' })))]));
  if (modern) { const aggregateLabel = labelledName('Browse all Modern Age Reading Lists', `${modern.label}, ${modern.count} Reading Lists`); box.append(el('section', { id: 'marvel-ages-modern', class: 'publishing-periods marvel-ages-group', 'aria-labelledby': 'marvel-ages-modern-h' }, [el('div', { class: 'sec-h' }, [el('h2', { id: 'marvel-ages-modern-h', text: 'Modern Age' }), el('button', { id: 'marvel-ages-modern-all', type: 'button', class: 'quiet', text: 'Browse all Modern Age Reading Lists', 'aria-label': aggregateLabel, onclick: () => showView('age-modern', { push: true }) })]), el('ul', { id: 'marvel-ages-modern-list', class: 'home-paths home-paths-secondary' }, modernChildren.map((child) => homeCategoryTile({ ...child, tier: 'secondary' })))])); }
}

async function renderPublishingCategory(route) {
  const category = generatedCategoryByRoute.get(route);
  if (!category) return;
  const box = $(`#${route}-results`);
  const periods = $(`#${route}-categories`);
  const periodList = $(`#${route}-category-list`);
  box.replaceChildren(el('p', {
    class: 'rail-hint',
    'aria-hidden': 'true',
    text: 'Loading Reading Lists…',
  }));
  if (periods) periods.hidden = true; if (periodList) periodList.replaceChildren();
  clearNotice(CATALOG_LOAD);

  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (err) {
    box.replaceChildren();
    notify(
      `#${route}-report`,
      `The catalog could not be loaded: ${err.message}. Your lists are unchanged.`,
      'error',
      CATALOG_LOAD,
    );
    return;
  }

  const allStories = groupCatalog(catalog.lists);
  if (category.kind === 'publishing-index') {
    renderPublishingIndex(category, allStories);
    return;
  }
  ensureSetupGuideFeature(catalog.lists, route);
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
    periodList.replaceChildren(...children.map((child) => homeCategoryTile({
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
    renderTimelineSections(box, [{
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
    grid.append(catalogCard(story, placements.get(story.key), {
      surface: route, report: `#${route}-report`, localStoryKeys, level: 'h2',
    }));
  }
  box.append(grid);
}

// Which reading path the reader has chosen through a story, keyed by the story rather than by the
// card, so a choice made in the preview is the one the catalog then shows. Deliberately not
// persisted: it is a decision about what to add next, not a setting, and it stops meaning anything
// the moment the order is in the library.
const pathChoice = new Map();

function chosenPath(story) {
  return pickPath(story, pathChoice.get(story.key), (l) => !!listForCatalogId(store.state, l.id));
}

// What one reading path is called in a chooser, plus whether it is already in the library.
// Ownership is said inside the label rather than beside it, so it is part of the radio's
// accessible name. It is information, not prevention: keeping both the main series and the
// complete order is a reasonable thing to want, and this only stops a reader adding the same
// path twice without noticing.
function pathLabel(list) {
  return listForCatalogId(store.state, list.id)
    ? `${variantLabel(list)} · in your library`
    : variantLabel(list);
}

// The choice between reading paths through one story. Native radios in a fieldset, so the group,
// its name and its checked state are what a screen reader already knows how to read, and the arrow
// keys move between paths without a line of ARIA re-implementing any of it.
//
// `scope` is what keeps the radio name unique per surface. The catalog pane and the preview dialog
// are both in the document at once, so a name shared between them would join two separate choosers
// into one radio group, and choosing a path in one would silently uncheck the other.
function pathChooser(story, scope, paint) {
  if (story.lists.length < 2) return null;
  const selected = chosenPath(story);
  return el('fieldset', {
    class: 'paths',
    // The legend says what the choice is but not what it is about, and the catalog pane shows six
    // of these at once. Three bundled stories offer paths labelled identically, so without the
    // story in the group's name a reader hears "The main series only, 1 of 2, Pick how much you
    // want to read" three times with nothing to tell the three apart. Every other control in the
    // row already carries the story this way.
    'aria-label': labelledName('Pick how much you want to read', story.name),
  }, [
    el('legend', { text: 'Pick how much you want to read' }),
    ...story.lists.map((list) => el('label', { class: 'fp path' }, [
      el('input', {
        type: 'radio',
        name: `${scope}-path-${story.key}`,
        checked: list === selected,
        // Keyed by the path, not the story: the key is what focus restoration matches on, and
        // keying every radio in the group alike would put focus back on the first of them.
        dataset: { key: list.id, act: `path-${scope}` },
        onchange: () => {
          pathChoice.set(story.key, list.id);
          paint(list);
        },
      }),
      el('span', { text: pathLabel(list) }),
    ])),
  ]);
}

// Ownership is written into the labels a chooser already has, rather than the chooser being
// rebuilt. Rebuilding a radio group destroys the radio holding focus, and a group that loses its
// focused radio hands focus to the first one, which silently looks like the choice moving.
function markOwnedPaths(root, story) {
  if (!story) return;
  for (const input of root.querySelectorAll('input[type="radio"]')) {
    const list = story.lists.find((l) => l.id === input.dataset.key);
    if (list) input.nextElementSibling.textContent = pathLabel(list);
  }
}

// One card, now one story rather than one reading path. Where a story has a single path this is the
// card it always was; where it has several, the card says so and the choice itself is made in the
// preview dialog, which is full width and is where a reader goes once they are interested.
//
// The chooser used to sit here. Measured in Edge at 1280x900 with storage cleared: it cost 123px on
// a 277px card, took the grid from 1149px to 1458px, the tallest card from 293px to 445px and the
// grid's focusable controls from 24 to 33, and it asked four times on one screen a question the
// reader will answer at most once. Moving it left the grid at 1169px and 24 controls, which is the
// density the shelf had before any of this.
//
// The title is a heading and the description is a <p>, so neither can sit inside a button: that is
function addButton(list, inLibrary) {
  // One act name for both states because it is the slot that persists, not the action. Adding
  // replaces this button with "✓ In library" and then with "Open →", and the reader who pressed
  // it should land on whatever the card's main control has become.
  if (inLibrary) {
    const settled = !justAdded.has(list.id);
    const text = settled ? 'Open →' : '✓ In library';
    return el('button', {
      type: 'button',
      class: settled ? 'btn btn-g' : 'btn btn-added',
      'aria-label': labelledName(text, list.name),
      dataset: { key: list.id, act: 'main' },
      onclick: () => {
        store.update((s) => setActive(s, inLibrary.id));
        if ($('#preview').open) $('#preview').close();
        showView('read', { push: true });
      },
    }, text);
  }
  const text = CATALOG_ADD;
  return el('button', {
    type: 'button',
    class: 'btn',
    // Read out of context, "Add to library" says nothing about which order, so the name adds it
    // after the label rather than inside it, which is what left the label unsayable before.
    'aria-label': labelledName(text, list.name),
    dataset: { key: list.id, act: 'main' },
    onclick: (e) => addFromCatalog(list, e.currentTarget),
  }, text);
}

async function addFromCatalog(list, btn) {
  // Read before importCurated disables this button. The only shared Add button now lives in the
  // preview dialog, so focus is captured from that stable slot rather than from the retired Home grid.
  const held = captureFocus($('#preview-add'));
  justAdded.add(list.id);
  const listId = await importCurated(list, btn, { navigate: false, report: '#home-cat-report' });
  if (!listId) {
    justAdded.delete(list.id);
    syncPreviewAdd();
    returnFocus(held);
    return;
  }
  syncPreviewAdd();
  returnFocus(held);
  setTimeout(() => {
    const settleFocus = captureFocus($('#preview-add'));
    justAdded.delete(list.id);
    syncPreviewAdd();
    returnFocus(settleFocus);
  }, 1500);
}

// A rebuild can finish after the reader has moved. BODY is the state left by disabling a focused
// button; any other active element is somewhere the reader chose, so it must not be replaced.
function returnFocus(held) {
  if (document.activeElement !== document.body) return;
  restoreFocus(held, { primary: 'main' });
}

// ------------------------------------------------------------------ preview

let previewLoad = null;
let previewList = null;
let previewStory = null;

function syncPreviewAdd() {
  if (!previewList || !$('#preview').open) return;
  $('#preview-add').replaceChildren(addButton(previewList, listForCatalogId(store.state, previewList.id)));
  markOwnedPaths($('#preview-paths'), previewStory);
}

function wirePreview() {
  $('#preview-close').addEventListener('click', () => $('#preview').close());
  // Clicking the backdrop closes, matching the Escape key that <dialog> gives us free.
  $('#preview').addEventListener('click', (e) => {
    if (e.target === $('#preview')) $('#preview').close();
  });
  $('#preview').addEventListener('close', async () => {
    const chose = previewStory;
    previewList = null;
    previewStory = null;
    placeNotices();
    // The card behind the dialog names one path, and the dialog is where that choice is now made,
    // so a choice made here has to reach the shelf card that sent the reader in.
    if (chose && (CATALOG_SHELVES.some((shelf) => shelf.key === view)
      || generatedCategoryByRoute.has(view))) {
      const root = $(`#view-${view}`);
      const held = captureFocus(root);
      if (generatedCategoryByRoute.has(view)) await renderPublishingCategory(view);
      else await renderCatalogShelf(view);
      returnFocus(held);
    }
  });
}

async function openPreview(list, story = null) {
  const dlg = $('#preview');
  previewStory = story && story.lists.length > 1 ? story : null;
  // Built once, outside the repaint below, because rebuilding a radio group destroys the radio the
  // reader just activated, and a group with no focused radio hands focus to its first one.
  $('#preview-paths').replaceChildren(...(previewStory
    ? [pathChooser(previewStory, 'preview', (next) => {
      paintPreview(next);
      loadPreviewIssues(next);
    })]
    : []));
  paintPreview(list);
  dlg.showModal();
  await loadPreviewIssues(list);
}

// Everything in the dialog that describes one reading path. Split from openPreview so that choosing
// a different path repaints the dialog rather than reopening it, which would close and reshow a
// modal the reader is already inside.
function paintPreview(list) {
  previewList = list;
  $('#preview-h').textContent = previewStory ? previewStory.name : list.name;
  const readingTime = readingTimeLabel(list.count);
  $('#preview-meta').textContent = [
    // With a chooser present the heading is the story, so the path has to be named somewhere or
    // the dialog would describe a reading path it never identifies.
    previewStory ? variantLabel(list) : null,
    `${list.count} issue${list.count === 1 ? '' : 's'}`,
    collectionsLabel(list),
    readingTime,
    depthLabel(list.depth),
  ].filter(Boolean).join(' · ');
  $('#preview-desc').textContent = list.description || '';
  $('#preview-add').replaceChildren(addButton(list, listForCatalogId(store.state, list.id)));
}

async function loadPreviewIssues(list) {
  $('#preview-body').replaceChildren(el('p', { class: 'rail-hint', text: 'Loading the issue list…' }));
  // A second preview opened while the first is still loading would otherwise race it and
  // could paint the wrong order's issues into the dialog. A path chosen in the dialog starts
  // another load against the same guard, so arrowing quickly through the paths cannot leave the
  // issues of one path under the heading of another.
  const token = {};
  previewLoad = token;
  try {
    const res = await fetch(`./data/${list.file}`, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const order = await res.json();
    if (previewLoad !== token) return;
    // Sub-headings for a trade order, so the reader can see the books before importing, which
    // is the whole reason to pick this variant over the issue-by-issue one. The number keeps
    // counting across a heading because it numbers the reading order, not the book.
    let shown = null;
    const nodes = [];
    order.items.forEach((item, i) => {
      const edition = typeof item.collectedIn === 'string' ? item.collectedIn : null;
      if (edition && edition !== shown) {
        shown = edition;
        nodes.push(el('li', { class: 'preview-group' }, [el('h4', { text: edition })]));
      }
      nodes.push(el('li', {}, [
        // Numbered because the order is the point; the reading order is what the reader came
        // to the preview to see.
        el('span', { class: 'pn', text: String(i + 1) }),
        issueFocusAnchor(item, {
          context: { kind: 'order', id: list.id },
          surface: 'preview',
          className: 'preview-issue-link',
          children: item.title || 'Untitled issue',
        }),
      ]));
    });
    $('#preview-body').replaceChildren(el('ol', { class: 'preview-list' }, nodes));
  } catch (err) {
    if (previewLoad !== token) return;
    $('#preview-body').replaceChildren(el('p', {
      class: 'rail-hint',
      text: `The issue list could not be loaded: ${err.message}. You can still add the order.`,
    }));
  }
}

// ------------------------------------------------------------------ reading view

// The one way the filter in force changes, whether the reader chose a radio, arrived on a link, or
// pressed Back. Three copies of this were the alternative, and the copies would have differed:
// setting it from a route has to move the radio, and setting it from the radio has to store it.
//
// The filter is stored wherever it comes from, including from an address. That matches what
// applyRoute already does with the active list, which setActive writes into persisted state, and it
// is what makes Back consistent: if pressing Back moved the rows but not the preference, closing
// the tab and reopening it would show something other than what was last on screen.
//
// Returns early when nothing changed, so navigating between views does not rewrite settings on
// every hop or rebuild rows that are already correct.
function setFilter(next) {
  const wanted = READING_FILTERS.some((f) => f.value === next) ? next : DEFAULT_FILTER;
  if (wanted === filter) return;
  filter = wanted;
  settings.filter = wanted;
  saveSettings();
  const radio = [...document.querySelectorAll('input[name="filter"]')].find((r) => r.value === wanted);
  if (radio) radio.checked = true;
  renderRows();
}

function wireReading() {
  // Rendered from READING_FILTERS rather than authored in index.html, so the labels a reader can
  // choose from and the predicates that decide a row are one list and cannot disagree. Rendered
  // once, here, and never from renderRows(): rebuilding a radio group destroys the radio the
  // reader just activated and drops the keyboard out of the filter, which is the defect BL-054
  // fixed for the rows below and the reason the catalog's own filters are left alone on re-render.
  //
  // A radio written into the markup by hand would otherwise survive this append and sit beside the
  // rendered five, offering a filter with no predicate and no listener behind it, which is the
  // failure this item exists to end rather than one to reintroduce here. Measured on the tree
  // before this change, with a sixth radio authored into the fieldset: selecting it showed all 8
  // rows of an 8 row fixture, stored itself as the active filter, and threw nothing.
  const stray = [...document.querySelectorAll('input[name="filter"]')];
  if (stray.length) {
    throw new Error(`The document holds reading filters (${stray.map((r) => r.value).join(', ')}). `
      + 'They are rendered from READING_FILTERS in src/js/lib/readingFilters.js; add it there instead.');
  }
  $('#reading-filters').append(...READING_FILTERS.map((f) => el('label', { class: 'fp' }, [
    el('input', { type: 'radio', name: 'filter', value: f.value }),
    el('span', { text: f.label }),
  ])));
  $('#save-education-settings').addEventListener('click', () => showView('data', { push: true }));

  // The native toggle event may be delivered after an animation frame that was already queued by
  // the activation. The click microtask runs after the summary's default action has opened the
  // details and fills pending rows before that frame. Toggle remains the source of URL state.
  $('#full > summary').addEventListener('click', () => {
    queueMicrotask(() => { if ($('#full').open && rowsPending) renderRows(); });
  });
  $('#full').addEventListener('toggle', () => {
    const routeDriven = applyingRouteToDisclosure;
    applyingRouteToDisclosure = false;
    renderRows();
    if (!routeDriven) syncHash();
  });

  const radios = [...document.querySelectorAll('input[name="filter"]')];
  // Set by a keydown just before the change the same press produces, and read by that change to
  // tell one stop of a traversal from a decision.
  let arrowing = false;

  // A stored value is honoured only when the list offers it. There is no longer a second
  // enumeration for it to disagree with, but the check earns its place for a reason the markup
  // never covered: settings are a file the reader can edit and an older build could have written
  // a filter this one has since dropped. The group cannot be empty here, because it was just
  // filled from a list that is checked at load for holding the default, so a document missing the
  // fieldset fails at that append rather than arriving as a value quietly corrected in storage.
  const wanted = radios.find((r) => r.value === settings.filter);
  filter = wanted ? wanted.value : DEFAULT_FILTER;
  // An unrecognised value is corrected in storage rather than left there. It is unlike a refused
  // API base, which is kept because a reader typed it and may want to repair a typo; no control
  // here can produce this, none can show it, and nothing would ever clear it, so it would sit in
  // the record being ignored on every boot.
  if (!wanted) {
    settings.filter = filter;
    saveSettings();
  }
  // The control is set from the state rather than left to the browser's own form restoration on a
  // reload, which restores it without telling this module. The rendered group starts with nothing
  // checked, so this is also what puts the first mark on the filter in force.
  const active = radios.find((r) => r.value === filter);
  if (active) active.checked = true;

  for (const radio of radios) {
    // Arrow keys move a radio group one stop at a time and fire change at every stop. Measured in
    // Edge on this tree: three presses of ArrowRight left three history entries, and one Back
    // landed two filters short of where the reader began, walking them back through filters they
    // only passed over on the way to the one they wanted. So a traversal writes nothing until it
    // ends and then writes one entry, which leaves the address the reader arrived on underneath it.
    // A change that no arrow key produced is a decision on its own and writes immediately, so two
    // pointer clicks still get an entry each.
    //
    // Modifiers are excluded because the radio group does not consume them, so no change follows and
    // the flag would survive into whatever came next. Measured in Edge on this tree: Ctrl+ArrowRight
    // on a checked radio left the selection where it was and fired no change.
    radio.addEventListener('keydown', (e) => {
      if (e.key.startsWith('Arrow') && !e.ctrlKey && !e.altKey && !e.metaKey) arrowing = true;
    });
    radio.addEventListener('change', (e) => {
      if (arrowing) {
        // Captured before setFilter moves it, because this is the address the traversal has to be
        // able to return to and what a passive sync must keep claiming while it runs.
        if (!filterRunOpen) {
          filterRunBase = filter;
          filterRunAddressed = filterAddressed;
          filterRunOpen = true;
        }
        setFilter(e.target.value);
      } else {
        // Commits before adopting the new filter, so the traversal's entry records the filter the
        // traversal actually reached rather than the one replacing it. A pointer press has already
        // committed through pointerdown and finds nothing to do here; a click with no pointerdown,
        // which is what assistive technology activating a radio produces, reaches it here instead.
        // Both routes therefore leave the same two entries.
        endFilterRun({ commit: true });
        setFilter(e.target.value);
        // Pushes rather than replaces. Choosing a filter is a deliberate act, like clicking the
        // rail, and pushing is the whole of what "Back works across filter changes" means. The
        // passive paths still replace, so marking twenty issues read does not put twenty entries in
        // the way.
        filterAddressed = true;
        syncHash({ push: true });
      }
      arrowing = false;
    });
  }

  // The traversal ends when the reader leaves the group or reaches for the pointer, and that is when
  // its one entry is written. focusout bubbles, so moving between two radios inside the group would
  // otherwise end it at the first stop; relatedTarget outside the group is what distinguishes
  // leaving from traversing, and a missing one is a window or address bar blur, which is leaving.
  //
  // pointerdown is not redundant with the change handler above. Pressing the radio that is already
  // checked fires no change and does not move focus out of the group, so neither of the other two
  // would ever run and the traversal would stay open behind a press the reader has plainly finished
  // making.
  const group = $('#reading-filters');
  group.addEventListener('pointerdown', () => {
    arrowing = false;
    endFilterRun({ commit: true });
  });
  group.addEventListener('focusout', (e) => {
    if (e.relatedTarget && group.contains(e.relatedTarget)) return;
    arrowing = false;
    endFilterRun({ commit: true });
  });

  $('#btn-rename-list').addEventListener('click', async () => {
    const id = activeListId();
    const list = store.state.lists[id];
    if (!list) return;
    const name = await askText({ title: 'Rename list', label: 'List name', value: list.name });
    if (!name) return;
    store.update((s) => renameList(s, id, name));
    announceIfSaved(`Renamed to ${name}.`);
  });

  $('#btn-list-note').addEventListener('click', async () => {
    const id = activeListId();
    const list = store.state.lists[id];
    if (!list) return;
    const note = await askNote({
      title: `Note on "${list.name}"`,
      body: 'Only you see this. It is saved on this device and travels in your backup file.',
      label: 'Your note about this Reading List',
      value: list.note || '',
    });
    // null is backing out, "" is deleting the note. askText folds those together; askNote does
    // not, which is the whole reason it exists.
    if (note === null) return;
    store.update((s) => setListNote(s, id, note));
    announceIfSaved(note ? 'Note saved.' : 'Note removed.');
  });

  $('#btn-delete-list').addEventListener('click', async () => {
    const id = activeListId();
    const list = store.state.lists[id];
    if (!list) return;
    const yes = await askConfirm({
      title: `Delete "${list.name}"?`,
      body: 'Your read progress is kept, and only the list is removed. This can be undone.',
      confirmLabel: 'Delete list',
    });
    if (!yes) return;
    // Captured before the delete, because the state afterwards is the one thing that no longer
    // knows either the list or where in the rail it sat.
    const deleted = { list, index: store.state.listOrder.indexOf(id), wasActive: store.state.active === id };
    store.update((s) => deleteList(s, id));
    if (!store.lastUpdateOk) return;
    offerUndoDelete(deleted);
  });

  $('#btn-duplicate-list').addEventListener('click', () => {
    const id = activeListId();
    const list = store.state.lists[id];
    if (!list) return;
    // The updater runs exactly once, before the write, so capturing the id here is safe. It is
    // still only trustworthy after lastUpdateOk confirms the write survived.
    let copyId = null;
    const next = store.update((s) => {
      const res = duplicateList(s, id);
      copyId = res.listId;
      return res.state;
    });
    if (!store.lastUpdateOk || !copyId) {
      return announce('That copy could not be saved, so nothing changed.');
    }
    store.update((s) => setActive(s, copyId));
    // Saying where you landed matters more than usual here: the rail now holds two lists with
    // near-identical names, and the shared read progress surprises people who expect a copy to
    // start empty.
    announceIfSaved(`Duplicated as ${next.lists[copyId].name}. You are now editing the copy, and read progress stays shared with the original.`);
  });

  $('#btn-export-md').addEventListener('click', exportMarkdown);
  $('#btn-hydrate').addEventListener('click', () => hydrator.start(activeListId()));
  $('#btn-cancel-hydrate').addEventListener('click', () => hydrator.cancel());
  $('#btn-synopsis').addEventListener('click', startSynopsisRun);
  $('#btn-cancel-synopsis').addEventListener('click', () => synopsisRunner.cancel());

  $('#btn-hero-read').addEventListener('click', (e) => {
    const issue = upNext(store.state, activeListId());
    if (issue) openInReader(issue, e);
  });
  $('#btn-hero-inspect').addEventListener('click', () => {
    const issue = upNext(store.state, activeListId());
    const listId = activeListId();
    if (issue && listId) {
      openIssueFocus(issue.issueId, { kind: 'list', id: listId }, {
        view: 'read',
        surface: 'hero',
        issueId: issue.issueId,
        contextId: listId,
      });
    }
  });

  $('#btn-hero-done').addEventListener('click', () => markCurrentRead());
}

// A deleted list is held for the rest of the session rather than for a few seconds. The undo
// notice sits above the views because deleting the list you were reading moves you elsewhere,
// and a timer would take the only way back at the moment the reader was still deciding.
//
// What a timer was doing badly, though, still needed doing. Nothing withdrew the offer except
// taking it, so a reader who had moved on kept the banner on every screen for as long as the tab
// stayed open: reported here after hours of it. The answer is to let the reader end it rather than
// to let a clock end it for them. The undo lives exactly as long as it did, and the reader decides
// when that is over, which is the one judgement a timer was never in a position to make.
//
// Dismissing spends the undo rather than only hiding the words, because a live buffer behind a
// notice the reader has closed is an offer they can no longer see and cannot take, and it would
// still speak up later: putting the same order back from the catalog raises a message about a
// deletion they had already finished with.
//
// Only the most recent delete is held. Keeping every one would offer to restore a list the
// reader has since deliberately replaced, and nothing here can tell those two cases apart.
const UNDO_DELETE = 'undo-delete';
let lastDeleted = null;

// Every message under this key outlives the screen it was raised on, so every one of them carries
// the same way out. Built here rather than written at each call so the four cannot drift apart.
const dismissUndoDelete = { label: 'Dismiss', onClick: forgetDeleted };

// The same withdrawal under an honest name, for the one message that is not settled. A reader
// looking at "could not be put back" has already asked for the list, and the buffer behind the
// retry is the only copy of it left. "Dismiss" there would name closing an error while spending
// that copy, which is a destructive act wearing the label of a tidy-up. The other three report
// something already finished, where being done with the message and being done with the offer are
// the same sentence and one word can carry both.
const giveUpUndoDelete = { label: 'Give up', onClick: forgetDeleted };

function offerUndoDelete(deleted) {
  lastDeleted = deleted;
  notify('#app-report', `Deleted ${deleted.list.name}. Reading progress was kept.`, 'ok', UNDO_DELETE, {
    label: 'Undo delete',
    onClick: undoDelete,
  }, dismissUndoDelete);
}

// Wholesale replacements of the state, erasing and restoring, drop the offer rather than
// leaving it pointing into data that is no longer there.
function forgetDeleted() {
  lastDeleted = null;
  clearNotice(UNDO_DELETE);
}

// An order that is back in the sidebar does not need an offer to bring back the deleted copy of
// it. Taking that offer would leave two lists answering to one catalog entry, which is the state
// `duplicateList` clears `catalogId` to avoid: "in library" and "Continue reading" would both
// resolve to whichever came first in the rail, and the rail would show two entries with the same
// name and the same progress.
//
// It must not be withdrawn in silence. Deleting the list you were reading hands you to the home
// view, where the card for that order has already reverted to "+ Add to library", so the wrong
// way back and the right one sit on the same screen. A reader who had renamed or reordered their
// copy would press it, be told the order is in their sidebar, and lose the route back to that copy
// in the same tick with nothing said about it. The sentence is returned as well as shown, so the
// caller can fold it into the announcement it is about to make: two announcements in one tick
// leave only the last.
//
// Both names are needed. What came back is the order under its own name; what cannot be put back
// is the reader's copy, which they may have renamed. Naming the copy as the thing that returned
// would report the loss and deny it in the same breath, and send the reader looking in the rail
// for a list that is not there.
function forgetDeletedFor(catalogId, orderName) {
  if (!catalogId || lastDeleted?.list?.catalogId !== catalogId) return null;
  const { name } = lastDeleted.list;
  forgetDeleted();
  const mine = name === orderName ? 'The copy you deleted' : `Your copy, ${name},`;
  const msg = `${orderName} is back from the catalog. ${mine} with any changes you had made to it, cannot be put back now.`;
  notify('#app-report', msg, 'ok', UNDO_DELETE, null, dismissUndoDelete);
  return msg;
}

function undoDelete() {
  if (!lastDeleted) return;
  const { list, index, wasActive } = lastDeleted;
  // `restoreList` refuses rather than overwrite a live list, and a refusal returns the state
  // unchanged, which a successful write is indistinguishable from once it is done. So the
  // blocker is looked for first: reading back afterwards would report the list that blocked
  // the restore as the list the restore put there.
  const blocker = store.state.lists[list.id] ?? listForCatalogId(store.state, list.catalogId);
  if (blocker) {
    forgetDeleted();
    notify('#app-report', `${list.name} was not put back: ${blocker.name} is in your sidebar already.`, 'ok', UNDO_DELETE, null, dismissUndoDelete);
    return;
  }
  store.update((s) => restoreList(s, list, { index, active: wasActive }));
  if (!store.lastUpdateOk) {
    // The buffer is deliberately kept, and the notice keeps a button, because a write that failed
    // for want of space can succeed after the reader frees some. Dropping the offer here would
    // make a recoverable failure permanent. Giving up does drop it, which is not the same thing:
    // that is the reader saying the retry is not wanted, rather than the app deciding for them,
    // and the word says so rather than promising only to take the message away.
    notify('#app-report', `${list.name} could not be put back: that change could not be saved.`, 'error', UNDO_DELETE, {
      label: 'Try again',
      onClick: undoDelete,
    }, giveUpUndoDelete);
    return;
  }
  forgetDeleted();
  if (wasActive) showView('read');
  announce(`${list.name} is back in your sidebar, in the position it had.`);
}

function markCurrentRead() {
  const issue = upNext(store.state, activeListId());
  if (!issue) return;
  const wasRead = isRead(store.state, issue.issueId);
  // Only announce success if the write actually stuck, because store.update rolls back on failure
  // and the error is surfaced separately by the onChange handler.
  const saved = store.update((s) => markRead(s, issue.issueId, true));
  const transition = recordDirectProgressSave({ wasRead, state: saved, issueId: issue.issueId });
  if (!transition) return;
  const next = upNext(store.state, activeListId());
  announce(withSaveEducation(next
    ? `${issue.title} marked read. Next up: ${next.title}.`
    : `${issue.title} marked read. That is the whole order finished.`, transition));
  // The hero's own buttons are static markup that the re-render leaves in place, so pressing D
  // from the hero keeps focus and stays live on the next press. The shelf and the full order are
  // rebuilt with replaceChildren, which used to destroy a control focused there and drop focus to
  // <body>; preservingFocus now restores it by identity, on the click route as well, which is what
  // BL-054 closed. Finishing the order hides the whole
  // hero, which drops the focused button out of the document and sends focus back to <body>,
  // silently and at the top of the page. The heading that replaced it is the honest place to
  // land: it is what the reader needs to hear, and it is where the remaining actions are. The
  // render has already run, synchronously, inside store.update.
  if (!next) $('#all-read-h').focus({ preventScroll: true });
}

function renderReading() {
  const id = activeListId();
  const list = store.state.lists[id];

  $('#reading-body').hidden = !list;
  $('#ring-wrap').hidden = !list;
  renderSaveEducation();

  if (!list) {
    // Reaching the reading view with no list means the last one was just deleted. The
    // landing page is the honest place to be, so hand over rather than sit on an empty frame.
    $('#order-name').textContent = 'Recap Page';
    $('#order-sub').textContent = 'Curated Reading Lists, tracked locally, linked into the Unlimited reader.';
    if (view === 'read') showView('home');
    return;
  }

  const { read, total } = listProgress(store.state, id);
  const seriesCount = new Set(
    list.itemIds.map((i) => store.state.issues[i]?.seriesName).filter(Boolean),
  ).size;

  $('#order-name').textContent = list.name;
  // Facts only. The description used to be welded onto the end of this line, which made a single
  // 543 character run of the subtitle: three sentences of blurb inside a 62ch column, with the
  // right two fifths of the header band empty beside it. It has its own disclosure below now.
  $('#order-sub').textContent = [
    `${total} issue${total === 1 ? '' : 's'}`,
    seriesCount ? `${seriesCount} series` : null,
  ].filter(Boolean).join(' · ');
  const desc = $('#order-desc');
  const descText = $('#order-desc-text');
  descText.textContent = list.description || '';
  desc.hidden = !list.description;
  if (!list.description) desc.open = false;

  const pct = total ? read / total : 0;
  const listNote = $('#list-note');
  listNote.textContent = list.note || '';
  listNote.hidden = !list.note;
  $('#btn-list-note').textContent = list.note ? 'Edit note' : 'Note';
  $('#ring-arc').setAttribute('stroke-dashoffset', String(RING_CIRCUMFERENCE * (1 - pct)));
  // One statement, not two. The ring used to read "0 of 120 read" over "120 to go · 0%", which is
  // the same fact said twice and subtracted once, in a 44px circle.
  //
  // The word "read" stays in the second line even though the first line is now a percentage. The
  // svg is aria-hidden, so these two spans are the whole programmatic statement of progress: drop
  // the verb and a screen reader announces "13%, 12 of 89" with nothing saying what was counted.
  $('#ring-label').textContent = total ? `${Math.round(pct * 100)}%` : '';
  $('#ring-sub').textContent = !total ? 'Nothing in this list' : read === total ? 'All read' : `${read} of ${total} read`;

  renderHero();
  renderShelf();
  renderRows();
  renderHydrateButton();
  renderSynopsisButtons();
}

function renderHero() {
  const id = activeListId();
  const issue = upNext(store.state, id);
  const finished = !issue;

  $('#hero').hidden = finished;
  $('#all-read').hidden = !finished;
  $('#shelf-sec').hidden = finished;
  // The hero is hidden rather than emptied, so its heading has to be given text back. A
  // heading with no content fails whether or not it is on screen, and the tools that say so
  // read the document, not what is painted.
  if (finished) {
    $('#hero-title').textContent = HERO_NO_ISSUE;
    return;
  }

  const override = store.state.overrides[issue.issueId];
  const position = (store.state.lists[id]?.itemIds.indexOf(issue.issueId) ?? -1) + 1;
  const total = store.state.lists[id]?.itemIds.length ?? 0;
  const presentation = issuePresentation(issue, {
    override,
    position,
    total,
    description: synopsisFallback(issue, sessionSynopsis.get(issue.issueId)),
  });

  paintCover($('#hero-img'), $('#hero-fb'), issue, 'portrait_uncanny');
  $('#hero-img').alt = coverUrl(issue, 'portrait_uncanny') ? `Cover of ${issue.title}` : '';
  $('#hero-fs').textContent = seriesOnly(issue.seriesName);
  $('#hero-fn').textContent = issue.number ? `#${issue.number}` : '';

  paintHeroBackground($('#hero-bg'), issue);

  $('#hero-title').textContent = issue.title;
  const inspect = $('#btn-hero-inspect');
  inspect.dataset.focusSource = 'hero';
  inspect.dataset.issueId = String(issue.issueId);
  inspect.dataset.contextId = id;

  $('#hero-by').textContent = presentation.byline;

  // Three states, not two. "Details have not been fetched yet" is a promise that something is
  // coming, and for an issue the snapshot has no record of, nothing is.
  $('#hero-desc').textContent = presentation.description;
  $('#hero-facts').replaceChildren(...presentation.facts.map((item) => (
    fact(item.key, item.value, item.className)
  )));

  const info = $('#btn-hero-info');
  const infoHref = presentation.detailUrl;
  info.hidden = !infoHref;
  if (infoHref) {
    info.href = infoHref;
    info.setAttribute('aria-label', labelledName(info.textContent, `${issue.title} on marvel.com`));
  } else {
    info.removeAttribute('href');
  }
}

function fact(key, value, cls = '') {
  return el('div', {}, [
    el('dt', { text: key }),
    el('dd', { class: cls || null, text: value }),
  ]);
}

function renderShelf() {
  const id = activeListId();
  const shelf = $('#shelf');

  const upcoming = listItems(store.state, id).filter((it) => !it.read).slice(1, SHELF_SIZE + 1);
  $('#shelf-sec').hidden = upcoming.length === 0;
  $('#shelf-note').textContent = `${upcoming.length} ${upcoming.length === 1 ? 'issue' : 'issues'}`;

  preservingFocus(shelf, () => {
    shelf.replaceChildren();

    for (const it of upcoming) {
      const img = el('img', { alt: '', loading: 'lazy' });
      // The fallback is drawn whenever the cover is missing, either because it failed to load or
      // because the reader turned cover art off, so it is a first-class state rather than an error
      // path. Either way it stands in for an image the markup already declares decorative with
      // alt="". Left exposed it joins the button's visible label, and its series name and issue
      // number then bracket the caption's title, which is the same split this change exists to
      // remove.
      const fb = el('div', { class: 'tf cover-fallback', 'aria-hidden': true }, [
        el('span', { class: 's', text: seriesOnly(it.seriesName) }),
        el('span', { class: 'n', text: it.number ? `#${it.number}` : '?' }),
      ]);
      paintCover(img, fb, it, 'portrait_incredible');

      // The tile prints the title with its year stripped out and then prints the year separately,
      // so a name built from the unshortened title splices "(2005)" back into the middle. The year
      // is absent for 34 of the Ultimate order's 138 issues, so it joins rather than interpolates.
      const short = shortTitle(it.title);
      const year = ymd(it.onSale).slice(0, 4);
      const label = [short, year].filter(Boolean).join(' ');
      const readContext = 'Open in Marvel Unlimited';
      // The tooltip is painted text, so it carries the label exactly as the caption prints it.
      // Only the accessible name goes through labelWords, and its symbol stripping is licensed
      // for names rather than for anything visible: a tooltip reading "House of M 1 2005" two
      // pixels above a caption reading "House of M #1" would be a fresh mismatch of the same
      // kind this change removes. Both are built from one binding so they cannot drift apart.
      const readName = labelledName(label, readContext);
      const context = { kind: 'list', id };

      shelf.append(el('li', { class: 'tile' }, [
        issueFocusAnchor(it, {
          context,
          surface: 'coming',
          className: 'tile-focus',
          children: [
            el('div', { class: 'ph' }, [img, fb]),
            el('div', { class: 'lab' }, [
              el('b', { text: short }),
              year,
            ]),
          ] }),
        el('button', {
          type: 'button',
          class: 'tile-read',
          title: `${label}: ${readContext}`,
          'aria-label': readName,
          dataset: { key: it.issueId, act: 'open' },
          onclick: (e) => openInReader(it, e),
        }, 'Read'),
      ]));
    }
  }, {
    primary: 'open',
    // The shelf empties when at most one unread issue is left, and the section is hidden with it,
    // so there is nothing inside to land on. "Done, next" continues the same activity and is the
    // control the shelf was helping the reader reach. When the order is finished the hero is hidden
    // too, and markCurrentRead claims the heading that replaced it when store.update later returns.
    fallback: () => ($('#hero').hidden ? null : $('#btn-hero-done')),
  });
}

// Rows are kept and reused unless their own data changed, because rebuilding all of them to
// record that one was ticked is most of the cost of ticking it. Measured in Edge on the 219 issue
// Hickman list with the order open: a read toggle replaced 219 of 219 rows and the handler ran for
// 14.8ms. Reusing them takes it to 2 rows and 2.8ms, the two being the ticked row and the one that
// becomes "up next".
let rowCache = new Map();
let rowCacheListId = null;
// Set when a render was skipped because the full order was closed, so that opening it renders
// what the reader missed. Without it, opening the details after any change shows the order as it
// stood when it was last open.
let rowsPending = false;

// Nodes already in the right place are left where they are. Whatever the new order does not ask
// for is removed first, because a stale node left in front of the reused ones shifts every later
// index by one and turns a single rebuilt row into a move of all the rest. insertBefore then moves
// a node already in the tree rather than copying it, so a reordered item costs one move.
export function commitRows(container, desired) {
  const wanted = new Set(desired);
  for (const node of [...container.childNodes]) if (!wanted.has(node)) node.remove();
  let i = 0;
  for (const node of desired) {
    if (container.childNodes[i] !== node) container.insertBefore(node, container.childNodes[i] ?? null);
    i += 1;
  }
}

// The key is the whole item rather than a list of the fields a row happens to read. An
// enumerated list is one somebody has to keep complete, and a field left out of it is a row
// that silently stops updating, which is the defect this cache would otherwise buy.
//
// Two inputs are not in the item and so have to be named: whether this is the up next row,
// and today's date, which is what decides whether a badge reads "soon" or "MU". Without the
// date a tab left open across midnight reuses the row it built yesterday for good.
//
// The cover setting is the third, and it is here because BL-108 made the setting decide whether
// the row's <img> is given a src at all. Before that it decided only whether the image was
// painted over, so a reused row was correct either way; now a row built with covers off carries
// an image that was never requested, and reusing it after the setting comes back on is what
// would make the switch one way until a reload.
export function rowCacheKey(item, currentId, today, covers) {
  return `${JSON.stringify(item)}|${item.issueId === currentId}|${today}|${covers !== false}`;
}

// Three states where a row had two, split out from the row builder so the decision can be measured
// directly rather than through a DOM. There is nothing pending about an issue upstream has already
// answered about, and saying "details pending" over it was a promise the app could not keep: the
// same 404 arrives every time it is asked again.
//
// The visible text carries the state and the hidden half carries the reason, which is the same
// division the availability badge beside it uses. Both are short enough not to wrap a row at 320
// pixels, and "no details held" is deliberately about the snapshot rather than about the issue: the
// comic exists, the record of it does not.
//
// A held record answers before a refusal does. normalizeIssue keeps the two apart, but the merge
// does not: hydrated is OR-preserved across an upsert while detailsRefused is last write wins, so
// an issue can carry both after it is added twice from unlike sources. Asking the refusal first
// then reported "no record" over a record the tracker was holding. Reproduced by adding issue 7
// from a search and then importing an Ultimate order whose entry for it is empty.
export function detailsState(item) {
  if (item?.hydrated) return null;
  if (item?.detailsRefused) return 'norecord';
  if (item?.source !== 'manual') return 'pending';
  return null;
}

export const DETAILS_BADGE = {
  norecord: {
    text: 'no details held',
    hint: 'The metadata snapshot has no record of this issue, so there are no details to fetch.',
  },
  pending: { text: 'details pending', hint: 'Details have not been fetched yet.' },
};

function detailsBadge(item) {
  const state = detailsState(item);
  if (!state) return null;
  const { text, hint } = DETAILS_BADGE[state];
  return el('span', { class: `badge badge-${state}` }, [
    text,
    el('span', { class: 'visually-hidden', text: `. ${hint}` }),
  ]);
}

// The same three states on the issue page, where the sentence stands alone rather than beside a
// label. "Details have not been fetched yet" told a reader to wait for something that was never
// coming, which is the whole of what this item was about. The order matches detailsState for the
// same reason: a record the tracker holds is not one the snapshot has no record of.
//
// `sessionText` is a synopsis fetched during this session. It is passed in rather than read off the
// issue because it is not on the issue and must never be: nothing stored carries prose any more, so
// there is no `issue.description` branch here either. A run that asked and got nothing back is the
// same answer as a snapshot that holds nothing, so it falls through to the existing sentences.
export function synopsisFallback(issue, sessionEntry = null) {
  if (typeof sessionEntry === 'string' && sessionEntry.trim()) return sessionEntry;
  // A run that asked and was told there is nothing has answered the question. Falling through to
  // "Details have not been fetched yet" would send the reader to wait for a fetch that has already
  // happened, which is the exact sentence this function was written to stop saying.
  if (sessionEntry === NO_SYNOPSIS) return 'No synopsis is recorded for this issue.';
  if (issue?.hydrated) return 'No synopsis is recorded for this issue.';
  if (issue?.detailsRefused) return DETAILS_BADGE.norecord.hint;
  return 'Details have not been fetched yet.';
}

// Sizes appear in a refusal, which is the one place a reader has to be able to compare two numbers
// at a glance, so both sides of the sentence are written in the same unit and to one decimal. A
// megabyte here is the 1,048,576 the file manager shows, not the round million.
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

function renderRows() {
  const id = activeListId();
  const rows = $('#rows');
  if (id !== rowCacheListId) { rowCache = new Map(); rowCacheListId = id; }

  preservingFocus(rows, () => {
    const desired = [];
    const list = store.state.lists[id];
    if (!list) { commitRows(rows, desired); return; }

    const all = listItems(store.state, id);
    const unread = all.length - all.filter((it) => it.read).length;
    // The count lives in the <summary>, which is on screen whether or not the order below it is,
    // so it is written before the early return rather than alongside the rows it counts.
    writeFullSummary(all, unread);

    // The full order is inside a <details> that starts closed, so on a first visit every one of
    // these rows is built for a container the reader has not opened. Measured in Edge on the 219
    // issue Hickman list with the order closed: marking one issue read spent 12.7ms building 219
    // rows that were never shown. Reopening the details renders them, so nothing is lost by
    // waiting until then.
    if (!$('#full').open) { rowsPending = true; return; }
    rowsPending = false; writeOrderStrip($('#full'), all, filter);

    const currentId = upNext(store.state, id)?.issueId ?? null;
    // Read once per render and passed in rather than defaulted per call, so that every row in one
    // pass is judged against the same day and the day is a value the cache key can name.
    const today = localDayString();
    const items = all.filter((it) => matchesReadingFilter(filter, it));

    // Collected editions, as runs of consecutive items. Progress is counted over every item in
    // the run and not over the filtered rows below it, because a book is a fixed thing you own:
    // "2 of 6 read" has to mean the same under every filter, or the heading becomes a second,
    // quieter reading filter that the reader never set.
    const runs = [];
    const runOf = new Map();
    for (const it of all) {
      const last = runs[runs.length - 1];
      if (last && last.name === it.collectedIn) {
        last.total += 1;
        if (it.read) last.read += 1;
      } else {
        runs.push({ name: it.collectedIn, total: 1, read: it.read ? 1 : 0 });
      }
      runOf.set(it.issueId, runs.length - 1);
    }
    const hasEditions = runs.some((r) => r.name);

    if (!items.length) {
      desired.push(el('li', { class: 'rail-hint', text: 'Nothing matches this filter.' }));
      commitRows(rows, desired);
      return;
    }

    let shownRun = -1;
    for (const item of items) {
      const runIndex = runOf.get(item.issueId);
      if (hasEditions && runIndex !== shownRun) {
        shownRun = runIndex;
        const run = runs[runIndex];
        // An item with no edition gets no heading rather than a heading saying so. In a trade
        // order that only happens to something the reader added by hand, and inventing a book
        // to put it in would be a claim about what Marvel collected.
        if (run.name) {
          const headKey = `${run.name}|${run.read}|${run.total}`;
          const cachedHead = rowCache.get(`heading:${runIndex}`);
          if (cachedHead && cachedHead.key === headKey) desired.push(cachedHead.node);
          else {
            const head = el('li', { class: `row-group${run.read === run.total ? ' is-done' : ''}` }, [
              el('h3', { class: 'rg-name', text: run.name }),
              el('span', { class: 'rg-count', text: `${run.read} of ${run.total} read` }),
              el('progress', { value: String(run.read), max: String(run.total), 'aria-hidden': 'true' }),
            ]);
            rowCache.set(`heading:${runIndex}`, { key: headKey, node: head });
            desired.push(head);
          }
        }
      }

      const rowKey = rowCacheKey(item, currentId, today, settings.covers);
      const cached = rowCache.get(item.issueId);
      if (cached && cached.key === rowKey) { desired.push(cached.node); continue; }

      const override = item.override;
      const av = availability(item, { override, today });
      const badgeClass = {
        [STATE.EXPECTED]: 'badge-expected',
        [STATE.SCHEDULED]: 'badge-scheduled',
        [STATE.UNKNOWN]: 'badge-unknown',
        [STATE.OVERRIDE_AVAILABLE]: 'badge-override-available',
        [STATE.OVERRIDE_UNAVAILABLE]: 'badge-override-unavailable',
      }[av.state];

      const img = el('img', { alt: '', loading: 'lazy' });
      const fb = el('div', { class: 'rf cover-fallback', 'aria-hidden': true });
      paintCover(img, fb, item, 'portrait_incredible');

      const node = el('li', {
        class: `row${item.read ? ' is-read' : ''}${item.issueId === currentId ? ' now' : ''}`,
      }, [
        el('button', {
          type: 'button',
          class: 'cb has-tooltip',
          'aria-pressed': String(item.read),
          'aria-label': `Mark ${item.title} as ${item.read ? 'unread' : 'read'}`,
          dataset: {
            key: item.issueId,
            act: 'read',
            tooltip: item.read ? 'Mark as unread' : 'Mark as read',
          },
          onclick: () => {
            const wasRead = isRead(store.state, item.issueId);
            const saved = store.update((s) => toggleRead(s, item.issueId));
            const transition = recordDirectProgressSave({
              wasRead,
              state: saved,
              issueId: item.issueId,
            });
            if (transition) {
              announce(withSaveEducation(
                `${item.title} ${isRead(saved, item.issueId) ? 'marked read' : 'marked unread'}.`,
                transition,
              ));
            }
          },
        }, item.read ? '✓' : ''),
        issueFocusAnchor(item, {
          context: { kind: 'list', id },
          surface: 'full-order',
          control: 'cover',
          className: 'thumb row-focus-cover',
          tabIndex: '-1', ariaLabel: `Inspect ${item.title}`,
          children: [img, fb],
        }),
        el('div', {}, [
          issueFocusAnchor(item, {
            context: { kind: 'list', id },
            surface: 'full-order',
            control: 'title',
            className: 'rt row-focus-title',
            children: item.title,
          }),
          el('div', { class: 'rm' }, [
            item.seriesName ? el('span', { text: seriesOnly(item.seriesName) }) : null,
            // The full availability wording is text inside the badge, not a title attribute.
            // A title is not reachable by touch, is skipped by several screen readers, and
            // here it was the only place the hedge behind a two-word badge was written down,
            // so "Not in Unlimited" read as a fact rather than as what the snapshot shows.
            el('span', { class: `badge ${badgeClass}` }, [
              `${SHORT[av.state]} ${av.state === STATE.EXPECTED ? 'Unlimited' : SHORT_LABEL[av.state] ?? 'unknown'}`,
              el('span', { class: 'visually-hidden', text: `. ${describe(item, { override, today })}.` }),
            ]),
            detailsBadge(item),
            item.source === 'manual' ? el('span', { class: 'badge badge-unknown' }, 'by hand') : null,
            ymd(item.onSale) ? el('span', { text: ymd(item.onSale) }) : null,
          ]),
          // The note control sits in the text column, not in `.ract`, which already carries six
          // buttons and wraps at 320 pixels. One control both shows the note and opens the
          // editor, so a row with a note is not a row with an extra thing beside it.
          //
          // The note is repeated into the label rather than left to name the button by its
          // contents, because an aria-label replaces the contents in the accessible name. With
          // the label naming only the action, a screen reader announced "Edit your note on X"
          // and never the note, so the one reader who cannot see the row would have had to open
          // the editor on every issue to find out what they had written.
          //
          // The note goes last because it is the one part the app does not punctuate. A note
          // typed as "Wanda breaks reality." read as "here.. Select to edit it." with the action
          // trailing, so the action leads instead and nothing follows the user's own words.
          el('button', {
            type: 'button',
            class: `rnote${item.note ? ' has-note' : ''}`,
            'aria-label': item.note
              ? `Edit your note on ${item.title}. It says: ${item.note}`
              : `Add a note on ${item.title}`,
            dataset: { key: item.issueId, act: 'note' },
            onclick: () => editIssueNote(item),
          }, item.note ? item.note : 'Add a note'),
        ]),
        issueRowActions(item, id),
      ]);
      rowCache.set(item.issueId, { key: rowKey, node });
      desired.push(node);
    }

    if (items.length !== all.length) {
      desired.push(el('li', { class: 'rail-hint', text: `Showing ${items.length} of ${all.length}.` }));
    }
    commitRows(rows, desired);
  }, {
    primary: 'read',
    // Nothing is left to land on only when the filter now excludes everything, which is usually
    // the reader's own act of marking the last matching issue read. The checked filter is both the
    // reason the list is empty and the control that undoes it, and it sits inside the same
    // disclosure, so focus stays where the reader was working.
    fallback: () => [...document.querySelectorAll('input[name="filter"]')].find((r) => r.checked),
  });
}

const SHORT_LABEL = {
  [STATE.SCHEDULED]: 'scheduled',
  [STATE.UNKNOWN]: 'unknown',
  [STATE.OVERRIDE_AVAILABLE]: 'yours: available',
  [STATE.OVERRIDE_UNAVAILABLE]: 'yours: not in MU',
};

function cycleOverride(item) {
  const next = item.override === 'available' ? 'unavailable' : item.override === 'unavailable' ? null : 'available';
  store.update((s) => setOverride(s, item.issueId, next));
  announceIfSaved(`${item.title}: ${next ? `marked ${next}` : 'override cleared'}.`);
}

function availabilityOverrideAction(override) {
  if (override === 'available') return 'Mark as unavailable';
  if (override === 'unavailable') return 'Clear availability override';
  return 'Mark as available';
}

function issueRowActions(item, listId) {
  const panelId = `row-actions-${item.issueId}`;
  const panel = el('div', { class: 'ract', id: panelId }, [
    el('button', { type: 'button', class: 'mini', 'aria-label': `Read ${item.title} in Marvel Unlimited`, dataset: { key: item.issueId, act: 'open' }, onclick: (e) => openInReader(item, e) }, 'Read'),
    detailUrl(item)
      ? el('a', {
        class: 'mini has-tooltip',
        href: detailUrl(item),
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': labelledName('Info', `${item.title} on marvel.com`),
        dataset: { key: item.issueId, act: 'info', tooltip: 'Open issue page on marvel.com' },
      }, 'Info')
      : null,
    el('button', {
      type: 'button',
      class: 'mini has-tooltip',
      'aria-label': `Move ${item.title} up`,
      dataset: { key: item.issueId, act: 'up', tooltip: 'Move up' },
      onclick: () => store.update((s) => moveItem(s, listId, item.issueId, -1)),
    }, [
      el('span', { class: 'mini-icon', 'aria-hidden': true, text: '↑' }),
      el('span', { class: 'mini-label', text: 'Move up' }),
    ]),
    el('button', {
      type: 'button',
      class: 'mini has-tooltip',
      'aria-label': `Move ${item.title} down`,
      dataset: { key: item.issueId, act: 'down', tooltip: 'Move down' },
      onclick: () => store.update((s) => moveItem(s, listId, item.issueId, 1)),
    }, [
      el('span', { class: 'mini-icon', 'aria-hidden': true, text: '↓' }),
      el('span', { class: 'mini-label', text: 'Move down' }),
    ]),
    el('button', {
      type: 'button',
      class: 'mini has-tooltip',
      'aria-label': `${availabilityOverrideAction(item.override)} for ${item.title}`,
      dataset: {
        key: item.issueId,
        act: 'override',
        tooltip: availabilityOverrideAction(item.override),
      },
      onclick: () => cycleOverride(item),
    }, [
      el('span', { class: 'mini-icon', 'aria-hidden': true, text: '⚑' }),
      el('span', { class: 'mini-label', text: 'Change Unlimited status' }),
    ]),
    el('button', {
      type: 'button',
      class: 'mini mini-danger has-tooltip',
      'aria-label': `Remove ${item.title} from this list`,
      dataset: { key: item.issueId, act: 'remove', tooltip: 'Remove from this list' },
      onclick: () => {
        store.update((s) => removeFromList(s, listId, item.issueId));
        announceIfSaved(`Removed ${item.title}.`);
      },
    }, [
      el('span', { class: 'mini-icon', 'aria-hidden': true, text: '✕' }),
      el('span', { class: 'mini-label', text: 'Remove from list' }),
    ]),
  ]);
  const toggle = el('button', {
    type: 'button',
    class: 'mini row-actions-toggle',
    'aria-expanded': 'false',
    'aria-controls': panelId, 'aria-label': `More actions for ${item.title}`,
    text: 'More actions', dataset: { key: item.issueId, act: 'more' },
  });
  const root = el('div', { class: 'row-actions' }, [toggle, panel]);
  const setOpen = (open) => {
    root.classList.toggle('is-open', open);
    toggle.setAttribute('aria-expanded', String(open));
  };
  toggle.addEventListener('click', () => setOpen(!root.classList.contains('is-open')));
  root.addEventListener('focusout', (event) => {
    if (!root.contains(event.relatedTarget)) setOpen(false);
  });
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !root.classList.contains('is-open')) return;
    event.preventDefault();
    setOpen(false);
    toggle.focus();
  });
  return root;
}

// The editor is a modal dialog rather than a field in the row. Editing a note changes the item,
// so `renderRows` rebuilds that row, and `preservingFocus` restores focus by key and act alone,
// not the caret or an uncommitted value, so an inline field would lose whatever had been typed
// into it the moment anything else changed.
async function editIssueNote(item) {
  const note = await askNote({
    title: `Note on "${item.title}"`,
    body: 'Only you see this. It is saved on this device and travels in your backup file.',
    label: 'Your note about this issue',
    value: item.note || '',
  });
  if (note === null) return;
  store.update((s) => setIssueNote(s, item.issueId, note));
  announceIfSaved(note ? `Note saved on ${item.title}.` : `Note removed from ${item.title}.`);
}

// ------------------------------------------------------------------ shortcuts

function wireShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (view !== 'read' || e.metaKey || e.ctrlKey || e.altKey) return;
    // A modal dialog makes the rest of the document inert, but a keydown raised inside it still
    // bubbles to here, and the view behind the backdrop is still 'read'. Refusing every
    // interactive element used to block this by accident; asking the narrower question exposes
    // it. Measured in Edge: D at the "Delete list?" prompt, where showModal() has put focus on
    // Cancel, marked an issue read behind the backdrop and swallowed the key.
    if ($('dialog[open]')) return;
    const t = document.activeElement;
    // Only text entry silences a shortcut outright, and Enter is left to whatever the browser
    // would activate. Refusing every interactive element, as this once did, killed the D the
    // hero advertises for the rest of the session the moment the reader clicked "Done, next".
    if (!shortcutAllowed(t, e.key)) return;
    if (!store.state.lists[activeListId()]) return;

    if (e.key === 'Enter') {
      const issue = upNext(store.state, activeListId());
      if (!issue) return;
      e.preventDefault();
      openInReader(issue, e);
    } else if (e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      markCurrentRead();
    }
  });
}

// ------------------------------------------------------------------ reader deep links

function openInReader(issue, event) {
  event?.preventDefault();
  // window.open must happen synchronously inside the gesture. The digitalId lookup, when one
  // is needed, happens in the opened tab rather than here. See reader.js.
  const res = openIssueTab(issue);
  if (!res.ok) {
    announce(`${issue.title} has no Marvel reference recorded, so it cannot be opened.`);
    return;
  }
  announce(res.target === 'reader'
    ? `Opening ${issue.title} in Marvel Unlimited in a new tab.`
    : `Opening ${issue.title} in a new tab and looking up its Unlimited link.`);
}

// ------------------------------------------------------------------ hydration

function renderHydrateButton() {
  const pending = pendingIssueIds(store.state).length;
  $('#btn-hydrate').hidden = pending === 0 || hydrator.active;
  $('#btn-hydrate').textContent = `Fetch details for ${pending} issue${pending === 1 ? '' : 's'}`;
  $('#btn-cancel-hydrate').hidden = !hydrator.active;
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

function renderHydration(status) {
  const box = $('#hydration-status');
  const said = hydrationAnnouncement(status);
  // Above the early return, so the key follows the hydrator's phase even through the reports that
  // write nothing. It is not what unblocks the next run: 'complete' and 'running' already differ.
  announceState('hydration', said.state, said.msg);
  if (!status || status.phase === 'idle') { box.hidden = true; renderHydrateButton(); return; }
  box.hidden = false;
  if (status.phase === 'running') {
    box.textContent = `Fetching details ${status.done} of ${status.total}…`;
  } else if (status.phase === 'cancelled') {
    box.textContent = `Stopped after ${status.done} of ${status.total}. Progress was kept.`;
  } else {
    box.textContent = 'All details fetched.';
  }
  renderHydrateButton();
}

// ------------------------------------------------------------------ synopsis fetching

export const SYNOPSIS_SERVICE_FALLBACK = 'the community Marvel metadata service';

// Names the service the run will actually contact, rather than the one this file was written
// against. The API base is the reader's to change, and a dialog whose whole job is to say where the
// prose comes from is worse than no dialog at all when it names a third party the request will not
// go to.
export function synopsisServiceName(baseUrl) {
  try {
    return new URL(String(baseUrl)).host || SYNOPSIS_SERVICE_FALLBACK;
  } catch {
    return SYNOPSIS_SERVICE_FALLBACK;
  }
}

// Said in full every time a run is started, not once and then remembered. The reader is being asked
// to agree to text arriving from somewhere else, and an agreement recorded months ago in a settings
// file is not the reader agreeing now. It costs one press of a button they only reach by choosing
// to press another one.
export function synopsisDisclaimer(baseUrl) {
  return {
    title: 'Fetch synopses from the community metadata service?',
    body: 'Issue synopses are not part of this tracker. They come from the community Marvel metadata '
      + `service at ${synopsisServiceName(baseUrl)}, which is not affiliated with Marvel, and the text `
      + 'itself is Marvel\u2019s. Nothing fetched is saved: the synopses are held for this browser tab '
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

function renderSynopsisButtons() {
  // Offered on any list with issues in it, unlike the hydrate button, which is offered only while
  // something is pending. There is no pending count to show here: what has been fetched is not
  // recorded anywhere the button could count, which is the point of the feature.
  const list = store.state.lists[activeListId()];
  const has = (list?.itemIds ?? []).length > 0;
  $('#btn-synopsis').hidden = !has || synopsisRunner.active;
  $('#btn-cancel-synopsis').hidden = !synopsisRunner.active;
}

export function synopsisStatusLine(status) {
  // done counts attempts, not answers, so every branch below that reports a count subtracts the
  // failures and names them. Doing it in only some of them is worse than doing it in none: while
  // the running line reported attempts and the endings reported answers, pressing stop on a run
  // that had lost two of three rewrote 3 to 1 in front of the reader, and the number appeared to
  // go backwards at the one moment they were looking at it.
  const phase = status?.phase;
  // renderSynopsis hides the box without setting any text for these, so the empty string is what
  // this function has always effectively returned for them. It is exported now, and a caller that
  // did not replicate that guard would otherwise be told a run that never started had finished.
  if (!status || phase === 'idle') return '';
  if (phase === 'running') {
    const failed = Number(status.failed ?? 0);
    const line = `Fetching synopses ${status.done - failed} of ${status.total}\u2026`;
    return failed ? `${line} ${failed} could not be reached.` : line;
  }
  if (phase === 'cancelled') {
    // A stop after three requests of which two were refused would otherwise read "Stopped after 3
    // of 5" beside a hero still saying no synopsis is recorded, which is the same untruth the
    // partial ending was added to stop telling. Same subtraction it makes.
    const failed = Number(status.failed ?? 0);
    if (!failed) return `Stopped after ${status.done} of ${status.total}.`;
    return `Stopped after ${status.done - failed} of ${status.total}. ${failed} could not be reached.`;
  }
  if (phase === 'partial') {
    return `Fetched ${status.total - status.failed} of ${status.total}, for this tab only. ${status.failed} could not be reached.`;
  }
  return 'All synopses fetched, for this tab only.';
}

function renderSynopsis(status) {
  const box = $('#synopsis-status');
  const said = synopsisAnnouncement(status);
  announceState('synopsis', said.state, said.msg);
  if (!status || status.phase === 'idle') { box.hidden = true; renderSynopsisButtons(); return; }
  box.hidden = false;
  box.textContent = synopsisStatusLine(status);
  renderSynopsisButtons();
  // The hero is showing a sentence that may have just been answered, and nothing else repaints on a
  // synopsis arriving: none of this is in the store, so no update() fires.
  renderHero();
  if (view === 'issue' && issueFocusResult) {
    const focusStatus = $('#issue-synopsis-status');
    focusStatus.textContent = synopsisStatusLine(status);
    focusStatus.hidden = !focusStatus.textContent;
    paintIssueFocus(issueFocusResult);
    $('#btn-issue-synopsis').hidden = issueFocusResult.issue.issueId < 0 || synopsisRunner.active;
    $('#btn-cancel-issue-synopsis').hidden = !synopsisRunner.active;
  }
}

async function startSynopsisRun() {
  // The list is captured before the question, not after. Nothing can move the reader while a modal
  // dialog is open, but starting a run against whatever is active when the answer arrives would be
  // the wrong shape regardless: they agreed to fetch this order.
  const list = store.state.lists[activeListId()];
  if (!list) return;
  const yes = await askConfirm(synopsisDisclaimer(settings.apiBase));
  if (!yes) return;
  synopsisRunner.start(list.id);
}

async function startIssueSynopsis() {
  const issueId = issueFocusResult?.issue?.issueId;
  if (!Number.isInteger(issueId) || issueId < 1) return;
  const yes = await askConfirm(synopsisDisclaimer(settings.apiBase));
  if (!yes || view !== 'issue' || issueRoute?.issueId !== issueId) return;
  issueSynopsisId = issueId;
  await synopsisRunner.startIssue(issueId);
  if (!synopsisRunner.active) issueSynopsisId = null;
}

// ------------------------------------------------------------------ add view

function wireAdd() {
  $('#form-search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#search-q').value.trim();
    if (!q) return;
    notify('#search-results', 'Searching…', 'busy');
    try {
      const items = await api.searchIssues(q, { limit: 50 });
      renderResults('#search-results', items, (it) => `${it.seriesName ?? ''}${it.onSale ? ` · ${ymd(it.onSale)}` : ''}`);
    } catch (err) {
      notify('#search-results', friendly(err), 'error');
    }
  });

  // Series and creator search reads a vendored index rather than the API, because the API
  // ignores `q` on those routes (see api.js). The two cards are otherwise identical, so they
  // are wired once: the only differences are which index they read and what "Add all issues"
  // does with the result.
  wireNameSearch({
    section: '#sec-series', form: '#form-series', input: '#series-q', results: '#series-results',
    kind: 'series', many: 'series', btnClass: 'btn btn-g',
    search: (q, opts) => api.searchSeries(q, opts), onAdd: addSeries,
    active: () => seriesAddRunner.active,
  });

  wireNameSearch({
    section: '#sec-creator', form: '#form-creator', input: '#creator-q', results: '#creator-results',
    kind: 'creators', many: 'creators', btnClass: 'btn btn-g',
    search: (q, opts) => api.searchCreators(q, opts), onAdd: addCreator,
    active: () => creatorAddRunner.active,
  });

  $('#form-import').addEventListener('submit', (e) => { e.preventDefault(); doImport(); });
  $('#form-manual').addEventListener('submit', (e) => { e.preventDefault(); doManual(); });
  $('#btn-manual-lookup').addEventListener('click', () => { doManualLookup(); });
  // An accepted match describes one specific comic. Once the title no longer names that comic the
  // offer has stopped making sense, so it is withdrawn here rather than refused at Add time, and
  // the reader is told why while the box is still in front of them.
  $('#manual-title').addEventListener('input', () => {
    if (manualMatch && $('#manual-title').value.trim() !== manualMatch.title) {
      clearManualMatch();
      notify('#manual-candidates', 'The title changed, so the details from the wiki were dropped. Look it up again to fill them in.', 'warn');
    }
  });
}

const NAME_SEARCH_LIMIT = 40;

export function mergeLongAddPage(state, context, issues) {
  let { listId, insertAt } = context;
  const { ownedIds = [] } = context;
  let next = state;
  if (!listId) {
    next = createList(next, { name: DEFAULT_LIST_NAME });
    listId = next.listOrder[next.listOrder.length - 1];
    next = setActive(next, listId);
    insertAt = 0;
  }
  const list = next.lists[listId];
  if (!list) {
    return { state, added: 0, skipped: 0, context, missing: true };
  }

  const before = new Set(list.itemIds);
  const merged = addIssuesToList(next, listId, issues);
  const mergedList = merged.state.lists[listId];
  const fresh = mergedList.itemIds.filter((id) => !before.has(id));
  const present = new Set(mergedList.itemIds);
  const nextOwned = [...new Set([...ownedIds, ...fresh])].filter((id) => present.has(id));
  const owned = new Set(nextOwned);
  const stable = mergedList.itemIds.filter((id) => !owned.has(id));
  const at = Math.max(0, Math.min(Number(insertAt) || 0, stable.length));
  nextOwned.sort((a, b) => compareIssues(merged.state.issues[a], merged.state.issues[b]));

  return {
    state: {
      ...merged.state,
      lists: Object.assign(Object.create(null), merged.state.lists, {
        [listId]: {
          ...mergedList,
          itemIds: stable.slice(0, at).concat(nextOwned, stable.slice(at)),
        },
      }),
    },
    added: merged.added,
    skipped: merged.skipped,
    context: { ...context, listId, insertAt, ownedIds: nextOwned },
    missing: false,
  };
}

export class LongAddRunner {
  constructor({ load, savePage, onStatus = () => {} } = {}) {
    this.load = load;
    this.savePage = savePage;
    this.onStatus = onStatus;
    this.current = null;
  }

  get active() {
    return this.current !== null;
  }

  status(run, phase, error = null) {
    return {
      phase,
      item: run.item,
      context: run.context,
      received: run.received,
      persisted: run.persisted,
      total: run.total,
      pages: run.pages,
      added: run.added,
      skipped: run.skipped,
      error,
      running: phase === 'running',
    };
  }

  cancel() {
    const run = this.current;
    if (!run) return null;
    const status = this.status(run, 'cancelled');
    run.terminal = status;
    this.current = null;
    run.controller.abort();
    this.onStatus(status);
    return status;
  }

  async start(item, context = {}) {
    if (this.current) return this.status(this.current, 'running');

    const run = {
      item,
      context,
      controller: new AbortController(),
      received: 0,
      persisted: 0,
      total: Number(item?.issueCount) || null,
      pages: 0,
      added: 0,
      skipped: 0,
      terminal: null,
    };
    this.current = run;
    this.onStatus(this.status(run, 'running'));
    if (this.current !== run) return run.terminal;

    const { signal } = run.controller;
    try {
      await this.load(item, {
        signal,
        onPage: (items, progress = {}) => {
          if (signal.aborted || this.current !== run) return;
          run.received = Number.isFinite(Number(progress.loaded))
            ? Number(progress.loaded)
            : run.received + items.length;
          run.total = progress.total == null ? run.total : Number(progress.total);
          const saved = this.savePage(items, run.context);
          if (signal.aborted || this.current !== run) return;
          if (!saved?.ok) {
            const error = new Error(saved?.error || 'That page could not be saved.');
            error.name = 'SaveError';
            throw error;
          }
          run.context = saved.context ?? run.context;
          run.persisted += Number(saved.persisted ?? items.length);
          run.pages += 1;
          run.added += Number(saved.added) || 0;
          run.skipped += Number(saved.skipped) || 0;
          this.onStatus(this.status(run, 'running'));
        },
      });
    } catch (error) {
      if (this.current !== run) return run.terminal;
      this.current = null;
      const phase = signal.aborted || error?.name === 'AbortError' ? 'cancelled' : 'failed';
      const status = this.status(run, phase, error);
      run.terminal = status;
      this.onStatus(status);
      return status;
    }

    if (this.current !== run) return run.terminal;
    this.current = null;
    const status = this.status(run, signal.aborted ? 'cancelled' : 'complete');
    run.terminal = status;
    this.onStatus(status);
    return status;
  }
}

function longAddContext() {
  const listId = activeListId();
  return {
    listId,
    insertAt: listId ? (store.state.lists[listId]?.itemIds.length ?? 0) : 0,
    ownedIds: [],
    transition: null,
  };
}

export function persistLongAddPage(readerStore, items, context, onSaved = () => null) {
  if (!items.length) return { ok: true, added: 0, skipped: 0, persisted: 0, context };
  let merged;
  readerStore.update((state) => {
    merged = mergeLongAddPage(state, context, items);
    return merged.state;
  });
  if (merged.missing) {
    return {
      ok: false,
      error: 'The destination list no longer exists. No later pages were added.',
      context,
    };
  }
  if (!readerStore.lastUpdateOk) {
    return { ok: false, error: readerStore.lastError, context };
  }

  const transition = context.transition
    ?? onSaved({ ok: true, added: merged.added, listId: merged.context.listId });
  return {
    ok: true,
    added: merged.added,
    skipped: merged.skipped,
    persisted: merged.added + merged.skipped,
    context: { ...merged.context, transition },
  };
}

function saveLongAddPage(items, context) {
  return persistLongAddPage(store, items, context, recordNonEmptyListSave);
}

export function longAddStatusLine(status, { name, kind }) {
  const total = status.total ? ` of ${status.total}` : '';
  const savedIssues = `${status.persisted}${total} issue${status.total || status.persisted !== 1 ? 's' : ''}`;
  if (status.phase === 'running') {
    if (!status.received) {
      return kind === 'creator'
        ? `Loading issues credited to ${name}\u2026`
        : `Loading all issues of ${name}\u2026`;
    }
    return `${name}: ${savedIssues} saved so far.`;
  }
  if (status.phase === 'cancelled') {
    if (!status.persisted) return `${name}: stopped before the first page was saved.`;
    return `${name}: stopped after ${savedIssues} ${status.total || status.persisted !== 1 ? 'were' : 'was'} saved. `
      + `${status.added} added${status.skipped ? `, ${status.skipped} skipped as duplicates` : ''}.`;
  }
  if (status.phase === 'failed') {
    const kept = status.persisted
      ? `${savedIssues} ${status.total || status.persisted !== 1 ? 'were' : 'was'} saved.`
      : 'No completed page was saved.';
    const unsaved = status.received > status.persisted
      ? ` ${status.received - status.persisted} received issue${status.received - status.persisted === 1 ? '' : 's'} could not be saved.`
      : '';
    return `${name}: loading failed. ${kept}${unsaved} ${friendly(status.error)}`;
  }
  const duplicate = status.skipped
    ? `, ${status.skipped} ${kind === 'creator' ? 'duplicates' : 'skipped as duplicates'}`
    : '';
  const ending = `${name}: ${status.added} ${kind === 'series' ? `issue${status.added === 1 ? '' : 's'} ` : ''}added${duplicate}.`;
  return kind === 'creator'
    ? `${ending} Creator records omit Unlimited dates, so availability shows as unknown until details are fetched.`
    : ending;
}

function renderLongAddStatus(config, runner, status) {
  const box = $(config.results);
  const focusedCancel = box?.querySelector('.notice-act button') === document.activeElement;
  const running = status.phase === 'running';
  const message = running
    ? longAddStatusLine(status, { ...config, name: status.item.name })
    : withSaveEducation(
      longAddStatusLine(status, { ...config, name: status.item.name }),
      status.context?.transition,
    );
  notify(
    config.results,
    message,
    running ? 'busy' : status.phase === 'failed' ? 'error' : status.phase === 'cancelled' ? 'warn' : 'ok',
    config.results,
    running ? { label: `Cancel ${config.kind} import`, onClick: () => runner.cancel() } : null,
  );

  if (running && focusedCancel) {
    box.querySelector('.notice-act button')?.focus({ preventScroll: true });
  } else if (!running && focusedCancel) {
    $(config.input)?.focus({ preventScroll: true });
  }
  if (!running && status.added > 0 && status.context?.listId) {
    queueLongAddHydration(status.context.listId);
  }
}

let longAddHydration = Promise.resolve();
function queueLongAddHydration(listId) {
  longAddHydration = longAddHydration.then(() => hydrator.start(listId));
}

function createLongAddRunner(config) {
  const runner = new LongAddRunner({
    load: (item, options) => config.load(item.id, options),
    savePage: saveLongAddPage,
    onStatus: (status) => renderLongAddStatus(config, runner, status),
  });
  return runner;
}

const seriesAddRunner = createLongAddRunner({
  kind: 'series',
  input: '#series-q',
  results: '#series-results',
  load: (id, options) => api.seriesIssues(id, options),
});
const creatorAddRunner = createLongAddRunner({
  kind: 'creator',
  input: '#creator-q',
  results: '#creator-results',
  load: (id, options) => api.creatorIssues(id, options),
});

function wireNameSearch({
  section: _section, form, input, results, kind, many, btnClass, search, onAdd, active,
}) {
  $(form).addEventListener('submit', async (e) => {
    e.preventDefault();
    if (active?.()) {
      $(results).querySelector('.notice-act button')?.focus({ preventScroll: true });
      announce(`Cancel the current ${kind === 'series' ? 'series' : 'creator'} import before searching again.`);
      return;
    }
    const q = $(input).value.trim();
    if (!q) return;
    notify(results, 'Searching…', 'busy');
    try {
      const { items, matched, total, generatedAt } = await search(q, { limit: NAME_SEARCH_LIMIT });
      const box = $(results);
      box.replaceChildren();

      if (!items.length) {
        return notify(results, `No ${many} match “${q}”. Searched all ${count(total)} in the index.`, 'warn');
      }

      // A capped list that does not say it is capped tells the reader the other matches do not
      // exist. The snapshot date is here for the same reason: this index is pinned at build
      // time, so a series added upstream last week is genuinely missing until it is rebuilt.
      const summary = matched > items.length
        ? `Showing the ${items.length} closest matches of ${count(matched)}. Narrow your search to see the rest.`
        : `${count(matched)} ${matched === 1 ? 'match' : 'matches'}.`;
      box.append(el('p', { class: 'rail-hint', text: summary }));
      box.append(el('details', { class: 'setting-more search-index-note' }, [
        el('summary', { text: 'About these results' }),
        el('p', {
          class: 'rail-hint',
          text: `Filtered on this device from an index of ${count(total)} ${many}${snapshot(generatedAt)}.`,
        }),
      ]));
      announce(summary);

      for (const item of items) {
        box.append(el('div', { class: 'result' }, [
          el('div', { class: 'result-main' }, [
            el('div', { class: 'result-title', text: item.name }),
            el('div', { class: 'result-meta', text: `${item.issueCount ?? 'an unknown number of'} issues` }),
          ]),
          el('button', {
            type: 'button', class: btnClass,
            'aria-label': `Add all issues of ${item.name}`,
            onclick: () => onAdd(item),
          }, 'Add all issues'),
        ]));
      }
    } catch (err) {
      notify(results, friendly(err), 'error');
    }
  });
}

// Route entry is the reliable signal: direct hashes and browser history can reveal these pages
// without either a pointer crossing the section or focus entering one of its controls.
function warmNameIndexForView(name) {
  const kind = name === 'add-series' ? 'series' : name === 'add-creator' ? 'creators' : null;
  if (kind) void api.warmNameIndex(kind);
}

const count = (n) => Number(n ?? 0).toLocaleString();

// Reuses the curated catalog's UTC date formatting, for the same reason: a snapshot taken at
// 06:14Z reads as the previous day everywhere west of UTC-6:14, which is all of the Americas.
function snapshot(generatedAt) {
  const when = updatedLabel({ updatedAt: generatedAt });
  return when ? `, taken ${when}` : '';
}

function addDestination() {
  const target = store.state.lists[activeListId()];
  return target
    ? `Adding to: ${target.name}`
    : `Adding to: new ${DEFAULT_LIST_NAME}`;
}

function renderResults(sel, items, metaFn) {
  const box = $(sel);
  box.replaceChildren();
  if (!items.length) return notify(sel, 'Nothing matched that search.', 'warn');

  const held = heldCount(store.state, items);
  const summary = `${count(items.length)} ${items.length === 1 ? 'result' : 'results'}, ${count(held)} already in your library.`;
  box.append(el('div', { class: 'res-head', text: summary }));

  // This pane stopped being a live region, so the outcome has to be said here. The empty case
  // below goes through notify() and still speaks, so without this line a search that found
  // nothing announced itself and a search that worked did not, which reads as a broken search.
  announce(summary);

  for (const it of items) {
    // The confirmation belongs on the control that was clicked. Previously the only feedback
    // was a screen-reader announcement, so a sighted user had to open the list to find out
    // whether anything had happened.
    const btn = el('button', { type: 'button', class: 'btn btn-g' }, 'Add');
    btn.addEventListener('click', () => {
      const res = addToActive([it], `Added ${it.title}.`);
      if (!res.ok) {
        btn.textContent = 'Could not add';
        return;
      }
      btn.disabled = true;
      btn.classList.add('btn-added');
      btn.textContent = res.added ? `Added to ${res.listName}` : 'Already in that list';
    });

    box.append(el('div', { class: 'result' }, [
      el('div', { class: 'result-main' }, [
        issueFocusAnchor(it, {
          surface: 'search',
          className: 'result-title result-title-link',
          children: it.title,
        }),
        el('div', { class: 'result-meta', text: metaFn(it) }),
      ]),
      ...(heldCount(store.state, [it]) ? [el('span', { class: 'pill-held', text: 'Already in your library' })] : []),
      btn,
    ]));
  }
}

// Carries every setup write, because lastUpdateOk describes only the most recent one and a later
// successful issue write must not hide a failed create or active-list write.
function ensureList(name) {
  let id = activeListId();
  if (!id) {
    const created = store.update((s) => createList(s, { name }));
    if (!store.lastUpdateOk) return { listId: null, ok: false };
    id = created.listOrder[created.listOrder.length - 1];
    store.update((s) => setActive(s, id));
    if (!store.lastUpdateOk) return { listId: id, ok: false };
  }
  return { listId: id, ok: true };
}

function addToActive(issues, message, { sort = false } = {}) {
  const setup = ensureList(DEFAULT_LIST_NAME);
  const id = setup.listId;
  if (!setup.ok) return { added: 0, skipped: 0, ok: false, listName: null };
  let added = 0, skipped = 0;
  store.update((s) => {
    const res = addIssuesToList(s, id, issues, { sort });
    added = res.added; skipped = res.skipped;
    return res.state;
  });
  // added/skipped are counted inside the updater, which runs before the write. If the write
  // failed the change was rolled back, so those counts describe nothing that survived.
  const ok = setup.ok && store.lastUpdateOk;
  if (!ok) return { added: 0, skipped: 0, ok: false, listName: null };
  const listName = store.state.lists[id]?.name ?? 'your list';
  const transition = recordNonEmptyListSave({ ok, added, listId: id });
  announce(withSaveEducation(
    `${message} ${added} added${skipped ? `, ${skipped} already in the list` : ''}.`,
    transition,
  ));

  // Search, series and creator results come from list endpoints, which return neither `cover`
  // nor `digitalId`; only /v1/issues/{id} does. Without hydration the issue lands with no art
  // and, worse, no way to open it in Marvel Unlimited, until the user happens to notice the
  // "Fetch details" button. Import already did this; every other add path was missing it.
  // start() is a no-op while a run is in flight, so rapid adds cannot stack up.
  if (added > 0) hydrator.start(id);

  return { added, skipped, ok: true, listName };
}

async function addSeries(series) {
  return seriesAddRunner.start(series, longAddContext());
}

async function addCreator(creator) {
  return creatorAddRunner.start(creator, longAddContext());
}

function doImport() {
  const text = $('#import-text').value;
  if (!text.trim()) return notify('#import-report', 'Paste a Reading List first.', 'warn');

  const { entries, unresolved, headings } = parseChecklist(text);
  const box = $('#import-report');
  box.replaceChildren();

  if (!entries.length && !unresolved.length) {
    return notify('#import-report', 'Could not find any issues in that text.', 'warn');
  }

  const intoNew = $('#import-new-list').checked;
  let listId;
  let setupOk;
  if (intoNew) {
    const name = headings[0] || `Imported ${new Date().toLocaleDateString()}`;
    const created = store.update((s) => createList(s, { name, description: 'Imported from a pasted Reading List.' }));
    if (!store.lastUpdateOk) {
      return notify('#import-report', 'Could not create the list, so nothing was imported.', 'error');
    }
    listId = created.listOrder[created.listOrder.length - 1];
    store.update((s) => setActive(s, listId));
    setupOk = store.lastUpdateOk;
    if (!setupOk) return;
  } else {
    const setup = ensureList(DEFAULT_LIST_NAME);
    listId = setup.listId;
    setupOk = setup.ok;
    if (!setupOk) return notify('#import-report', 'Could not create a list, so nothing was imported.', 'error');
  }

  // Markdown carries only a title and an id, so metadata starts as pending and is
  // filled in later rather than guessed at now. The sub-heading each line sat under is the
  // exception: it is structure the reader wrote, not metadata to be looked up, so it comes
  // straight across and a pasted trade order keeps its books.
  const staged = entries.map((e) => ({
    issueId: e.issueId,
    title: e.title,
    url: e.url,
    source: 'import',
    hydrated: false,
    collectedIn: e.section ?? null,
  }));

  let added = 0, skipped = 0;
  store.update((s) => {
    const res = addIssuesToList(s, listId, staged, {});
    added = res.added; skipped = res.skipped;
    let next = res.state;
    for (const e of entries) if (e.read) next = markRead(next, e.issueId, true);
    return next;
  });

  // The counts were taken inside the updater, before the write. A rolled-back write means
  // nothing was imported, whatever they say.
  const operationOk = setupOk && store.lastUpdateOk;
  if (!operationOk) {
    return notify('#import-report', 'Nothing was imported: that change could not be saved.', 'error');
  }

  box.append(el('p', { class: 'notice notice-ok', text: `Imported ${added} issue${added === 1 ? '' : 's'}${skipped ? `, ${skipped} already present` : ''}. Details will be fetched in the background.` }));

  if (unresolved.length) {
    box.append(el('p', { class: 'notice notice-warn', text: `${unresolved.length} line${unresolved.length === 1 ? '' : 's'} had no Marvel issue link. They are listed below rather than dropped, so you can resolve each one deliberately.` }));
    const wrap = el('div', { class: 'results' });
    for (const u of unresolved) wrap.append(unresolvedRow(u, listId));
    box.append(wrap);
  }

  const transition = recordNonEmptyListSave({ ok: operationOk, added, listId });
  announce(withSaveEducation(`Imported ${added} issues.`, transition));
  hydrator.start(listId);
}

function unresolvedRow(entry, listId) {
  const row = el('div', { class: 'result' });
  const main = el('div', { class: 'result-main' }, [
    el('div', { class: 'result-title', text: entry.title }),
    el('div', { class: 'result-meta', text: 'No issue link, search to resolve' }),
  ]);
  const btn = el('button', { type: 'button', class: 'btn btn-g' }, 'Find match');
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const candidates = await api.searchIssues(entry.title, { limit: 25 });
      const res = resolveUniqueExact(entry.title, candidates);
      if (res.status === 'resolved') {
        // Auto-accept only a single exact normalized match. Anything else is a choice
        // for you to make, because silently picking result #1 files the wrong comic.
        let added = 0;
        store.update((s) => {
          const result = addIssuesToList(s, listId, [res.match], {});
          added = result.added;
          return result.state;
        });
        if (!store.lastUpdateOk) {
          btn.disabled = false;
          row.append(el('p', { class: 'notice notice-error', text: 'That match could not be saved.' }));
          return;
        }
        let operationOk = true;
        if (entry.read) {
          store.update((s) => markRead(s, res.match.issueId, true));
          operationOk = store.lastUpdateOk;
          if (!operationOk) {
            btn.disabled = false;
            return;
          }
        }
        const transition = recordNonEmptyListSave({ ok: operationOk, added, listId });
        row.replaceChildren(el('p', { class: 'notice notice-ok', text: `Matched: ${res.match.title}` }));
        announce(withSaveEducation(`Matched ${entry.title}.`, transition));
        return;
      }
      const choices = el('div', { class: 'results' });
      const list = res.matches.slice(0, 8);
      if (!list.length) {
        row.replaceChildren(el('p', { class: 'notice notice-warn', text: `No candidates found for “${entry.title}”. Add it by hand if you still want to track it.` }));
        // The report pane around this row is no longer live, and the sibling outcomes below
        // announce themselves, so this one has to as well or the button just goes quiet.
        announce(`No candidates found for ${entry.title}.`);
        return;
      }
      choices.append(el('p', { class: 'rail-hint', text: `Pick the right issue for “${entry.title}”:` }));
      for (const c of list) {
        choices.append(el('div', { class: 'result' }, [
          el('div', { class: 'result-main' }, [
            el('div', { class: 'result-title', text: c.title }),
            el('div', { class: 'result-meta', text: `${c.seriesName ?? ''}${c.onSale ? ` · ${ymd(c.onSale)}` : ''}` }),
          ]),
          el('button', {
            type: 'button', class: 'btn btn-g',
            onclick: () => {
              let added = 0;
              store.update((s) => {
                const result = addIssuesToList(s, listId, [c], {});
                added = result.added;
                return result.state;
              });
              if (!store.lastUpdateOk) {
                row.replaceChildren(el('p', { class: 'notice notice-error', text: `${c.title} could not be saved.` }));
                return;
              }
              let operationOk = true;
              if (entry.read) {
                store.update((s) => markRead(s, c.issueId, true));
                operationOk = store.lastUpdateOk;
                if (!operationOk) return;
              }
              const transition = recordNonEmptyListSave({ ok: operationOk, added, listId });
              row.replaceChildren(el('p', { class: 'notice notice-ok', text: `Added ${c.title}.` }));
              announce(withSaveEducation(`Added ${c.title}.`, transition));
            },
          }, 'This one'),
        ]));
      }
      row.replaceChildren(choices);
    } catch (err) {
      btn.disabled = false;
      // Re-enabling the button is the only other cue that this failed, and a disabled state
      // returning to enabled is not announced. Without this the lookup fails in silence.
      const why = friendly(err);
      row.append(el('p', { class: 'notice notice-error', text: why }));
      announce(why);
    }
  });
  row.append(main, btn);
  return row;
}

// The metadata snapshot stops in 2025, so for anything newer this form is the only way in and a
// bare title is all it can carry. The Marvel Fandom wiki holds the release date, the page count,
// the credits and Marvel's own issue id for comics well past that boundary, and reading them at
// the moment the reader asks turns a bare row into an entry that looks like every other one.
//
// The issue id is not a route into Marvel Unlimited and nothing here should read as though it
// were. It builds the official marvel.com page for the comic, which is live for issues the
// snapshot has never heard of: 129648 answers 200 and an invented id answers 404, measured on
// 2026-08-19. So Info gains a destination it does not have today, because detailUrl returns null
// for the negative synthetic id a hand entry otherwise carries, and Read reaches that same page
// through the launcher's existing fallback. Opening the comic itself still needs the digital book
// id, and the address box below remains the only thing that supplies one.
//
// Held here rather than written anywhere: a lookup the reader walks away from leaves nothing
// behind, and the tracker is unchanged until Add issue is pressed.
let manualMatch = null;

function clearManualMatch() {
  manualMatch = null;
  $('#manual-candidates').replaceChildren();
}

function factsSummary(facts) {
  const credits = facts.creators?.length ?? 0;
  return [
    facts.onSale ? `released ${ymd(facts.onSale)}` : null,
    facts.pageCount ? `${facts.pageCount} pages` : null,
    credits ? `${credits} credit${credits === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(', ');
}

function acceptManualMatch(candidate) {
  const facts = {
    onSale: candidate.onSale,
    pageCount: candidate.pageCount,
    seriesName: candidate.seriesName,
    number: candidate.number,
    creators: candidate.creators.length ? candidate.creators : null,
  };
  manualMatch = { title: candidate.title, marvelIssueId: candidate.marvelIssueId, facts };
  // The box shows exactly what will be stored, and it is still editable, so a wiki title the
  // reader does not care for is theirs to change before anything is saved.
  $('#manual-title').value = candidate.title;
  const summary = factsSummary(facts);
  notify(
    '#manual-candidates',
    summary
      ? `Filled from “${candidate.title}” on the wiki: ${summary}. Press Add issue to keep it.`
      : `“${candidate.title}” carried no release date, page count or credits, so only the title was filled.`,
    summary ? 'ok' : 'warn',
    '#manual-candidates',
    { label: 'Discard', onClick: () => { clearManualMatch(); announce('Details from the wiki discarded.'); } },
  );
}

async function doManualLookup() {
  const phrase = $('#manual-title').value.trim();
  if (!phrase) return notify('#manual-report', 'Type a title first, then look it up.', 'warn');

  const btn = $('#btn-manual-lookup');
  btn.disabled = true;
  clearManualMatch();
  try {
    const found = await lookupIssue(phrase);
    if (!found.length) {
      return notify(
        '#manual-candidates',
        `Nothing on the wiki matched “${phrase}”. Its pages are named like “X-Men Vol 7 26”, so the series and the issue number usually find it. You can still add the issue without any details.`,
        'warn',
      );
    }
    // Never picked automatically. The search is fuzzy: asking it for one issue routinely returns
    // the series page and the issue before it above the one that was meant, so choosing the top
    // hit would quietly file the wrong comic's release date against this entry.
    const choices = el('div', { class: 'results' }, [
      el('p', { class: 'rail-hint', text: 'Pick the issue you meant. Nothing is added until you press Add issue.' }),
    ]);
    for (const candidate of found) {
      choices.append(el('div', { class: 'result' }, [
        el('div', { class: 'result-main' }, [
          el('div', { class: 'result-title', text: candidate.title }),
          el('div', {
            class: 'result-meta',
            text: factsSummary(candidate) || 'No release date, page count or credits on that page',
          }),
        ]),
        el('button', { type: 'button', class: 'btn btn-g', onclick: () => acceptManualMatch(candidate) }, 'Use this'),
      ]));
    }
    $('#manual-candidates').replaceChildren(choices);
    announce(`${found.length} match${found.length === 1 ? '' : 'es'} from the wiki. Pick the issue you meant.`);
  } catch (err) {
    // Naming what was not sent matters as much as naming the failure: the reader agreed to a
    // request about a title, and a failed request must not leave them wondering what else went.
    notify(
      '#manual-candidates',
      `Could not reach the wiki, so nothing was filled in. ${friendly(err)} Nothing about your lists was sent, and your entry is unchanged.`,
      'error',
    );
  } finally {
    btn.disabled = false;
  }
}

// A reader address is not a detail page, so it is not kept as one. Stored as the issue url it
// would satisfy the detail check in the reader module and light up the Info control, which names
// itself "<title> on marvel.com" and would open the very reader the Read button already opens.
// The row would then offer one destination twice under two names, one of them wrong. With no url
// and a synthetic negative id there is no detail link at all, which is the honest answer: nothing
// here knows a marvel.com page for an issue this new.
export function manualDetailUrl(url, digitalId) {
  return digitalId ? null : (url || null);
}

function doManual() {
  const title = $('#manual-title').value.trim();
  const url = $('#manual-url').value.trim();
  if (!title) return notify('#manual-report', 'A title is required.', 'warn');
  if (url && !isSafeMarvelUrl(url)) {
    return notify('#manual-report', 'That URL is not a marvel.com address. Leave it blank if you do not have one.', 'error');
  }

  const wikiId = manualMatch?.marvelIssueId ?? null;
  // A negative synthetic id for entries with no marvel.com URL; namespaced away from real
  // Marvel ids so the two can never collide.
  const issueId = issueIdFromUrl(url) ?? wikiId ?? -Date.now();

  // Facts from a wiki lookup are refused when the tracker already holds the issue they would be
  // written against, and the entry is refused with them. addIssuesToList merges into state.issues
  // BEFORE it decides whether the list already had the id, so a collision overwrites the held
  // issue's title, series, release date, page count and credits whether or not anything is added
  // to a list. Measured against a curated issue: seven fields replaced while the call reported
  // added=0 skipped=1, so the reader is told "already in that list, so nothing was added" at the
  // exact moment that sentence stops being true.
  //
  // The test is the id that will actually be WRITTEN, not the id the wiki supplied. Those differ:
  // a pasted address outranks the wiki id on the line above, and the accepted match's facts are
  // spread into the payload either way. Guarding the wiki id alone therefore left this route open:
  // look up one comic, press Use this, then paste an address naming another, and that other issue
  // is what gets rewritten.
  //
  // There is no escape from that sequence once it starts, which is what makes it worth guarding
  // rather than merely worth noting. What withdraws an accepted match is the title box changing,
  // and acceptManualMatch sets that box programmatically, which fires no input event. So the
  // listener is unreachable on this path and no keystroke anywhere in the sequence can withdraw
  // the match.
  //
  // Gated on there being an accepted match rather than on where the id came from, which keeps the
  // deliberate exemption intact: a pasted address with no lookup behind it names one specific
  // issue the reader chose to point at, so merging into it is what they asked for. What can never
  // happen is facts produced by a fuzzy search this code ran landing on something already held.
  //
  // Refusing rather than adding under a synthetic id follows what this form already does when the
  // list holds the issue, and it is the recoverable choice: nothing is lost and the reader is told
  // something true, where a second row for a comic they already track would sit in the reading
  // list for good.
  if (manualMatch && store.state.issues?.[issueId]) {
    const holders = Object.values(store.state.lists ?? {})
      .filter((l) => l.itemIds?.includes(issueId))
      .map((l) => l.name)
      .filter(Boolean);
    return notify(
      '#manual-report',
      holders.length
        ? `That is the issue you already have in ${holders.join(', ')}, so nothing was added and nothing was changed.`
        : 'The tracker already holds that issue, so nothing was added and nothing was changed.',
      'warn',
    );
  }

  // The reader address carries the digital book id, and that id is the only thing that makes the
  // Read button work. A hand-added issue is by definition newer than the metadata snapshot, so the
  // lookup /open.html would otherwise perform has nothing to find and the launch degrades to the
  // marvel.com page. Taking the id from the address the reader is already looking at needs no key,
  // no account and no request to anyone.
  const digitalId = digitalIdFromUrl(url);
  const detail = manualDetailUrl(url, digitalId);
  const setup = ensureList(DEFAULT_LIST_NAME);
  const listId = setup.listId;
  if (!setup.ok) return notify('#manual-report', 'Could not create a list, so nothing was added.', 'error');

  // Report what actually happened rather than assuming success. This previously announced
  // "Added" even when the entry had been silently discarded.
  let added = 0;
  let skipped = 0;
  const filled = manualMatch ? factsSummary(manualMatch.facts) : '';
  store.update((s) => {
    const res = addIssuesToList(s, listId, [{
      issueId,
      title,
      url: detail,
      digitalId,
      source: 'manual',
      hydrated: true,
      ...(manualMatch?.facts ?? {}),
    }], {});
    added = res.added;
    skipped = res.skipped;
    return res.state;
  });

  const operationOk = setup.ok && store.lastUpdateOk;
  if (!operationOk || added === 0) {
    return notify(
      '#manual-report',
      skipped > 0
        ? `“${title}” is already in that list, so nothing was added.`
        : `“${title}” could not be added. Your other lists are unchanged.`,
      skipped > 0 ? 'warn' : 'error',
    );
  }

  $('#manual-title').value = '';
  $('#manual-url').value = '';
  clearManualMatch();
  // Three different outcomes that used to read as two. Whether Read will reach Marvel Unlimited is
  // decided entirely by which address was pasted, and that is the one thing the reader cannot see
  // from the row afterwards, so it is said here rather than left to be discovered by clicking. An
  // entry that took the wiki's issue id now has a Read button where it had none, and saying it
  // opens marvel.com is the difference between a working link and a disappointment.
  const transition = recordNonEmptyListSave({ ok: operationOk, added, listId });
  notify(
    '#manual-report',
    withSaveEducation([
      `Added “${title}”.`,
      digitalId
        ? 'Read opens it in Marvel Unlimited.'
        : wikiId
          ? 'Read has no Marvel Unlimited link to use, so it opens the issue page on marvel.com instead. Paste the reader address above to change that.'
          : null,
      filled ? `Filled from the wiki: ${filled}.` : null,
      digitalId
        ? 'Availability still shows as unknown, because that is a separate field the metadata snapshot would have supplied.'
        : 'Availability shows as unknown because it is not in the metadata snapshot.',
    ].filter(Boolean).join(' '), transition),
    'ok',
  );
}

// ------------------------------------------------------------------ curated orders

let catalogLoad = null;
// One search box and one facet choice per shelf, rather than one shared by all three. The shelves
// hold different kinds of reading, so a query typed to find an event says nothing about which
// character spotlight is wanted, and carrying it across would empty the screen a reader had just
// arrived at. Keyed by the table so a new shelf needs no state added here.
const shelfState = new Map(CATALOG_SHELVES.map((shelf) => [
  shelf.key,
  { facet: 'all', query: '', spotlight: 'all', sort: null },
]));
let catalogAnnounceTimer = null;

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

// The catalog re-renders on every keystroke, so announcing each render would read a fresh result
// count into a screen reader for every letter typed, and each announcement would cut off the one
// before it. Waiting for a pause means the reader hears the result of what they actually typed.
function announceCatalog(msg) {
  clearTimeout(catalogAnnounceTimer);
  catalogAnnounceTimer = setTimeout(() => announce(msg), 500);
}

function ensureSetupGuideFeature(lists, surface = 'catalog') {
  const featureId = surface === 'catalog'
    ? 'modern-timeline-feature'
    : `${surface}-setup-guide-feature`;
  const existing = $(`#${featureId}`);
  const list = modernTimelineFeaturedCard(lists, surface);
  if (!list) {
    existing?.remove();
    return;
  }

  const [story] = groupCatalog([list]);
  const titleId = `${featureId}-h`;
  const context = surface === 'catalog'
    ? 'This app chooses 1998 as the start of its Modern Timeline. It is not an official Marvel editorial-era boundary.'
    : 'Read this orientation guide first for the earlier stories that lead into this age.';
  const feature = el('section', {
    id: featureId,
    class: 'setup-guide-feature',
    'aria-labelledby': titleId,
    dataset: { featuredList: list.id },
  }, [
    el('div', { class: 'setup-guide-context' }, [
      el('p', {
        class: 'eyebrow',
        text: surface === 'catalog' ? 'Recommended start' : 'Earlier context',
      }),
      el('p', { text: context }),
    ]),
    el('div', { class: 'catalog-grid setup-guide-grid' }, [
      catalogCard(story, null, {
        surface,
        report: `#${surface}-report`,
        level: 'h2',
        titleId,
      }),
    ]),
  ]);
  if (existing) existing.replaceWith(feature);
  else $(`#${surface}-results`).before(feature);
}

// One renderer for all three catalog screens. The shelves differ in what they hold and in what
// they are called, and in nothing else, so the differences live in `CATALOG_SHELVES` and the
// element ids are derived from the shelf key rather than written out three times. Writing this
// three times is how the three screens would drift apart, and the first thing to drift would be
// whichever of them the next change forgot.
async function renderCatalogShelf(key) {
  const shelf = CATALOG_SHELVES.find((s) => s.key === key);
  const state = shelfState.get(key);
  const box = $(`#${key}-results`);
  box.replaceChildren(el('p', { class: 'rail-hint', text: 'Loading the catalog…' }));
  // Cleared by condition rather than by pane, because the same load failure may have been placed
  // in the shared pane above the views. Emptying only this pane left the reader looking at a
  // loaded catalog under a banner saying it could not be loaded.
  clearNotice(CATALOG_LOAD);
  // Tied to the query rather than to a successful load, so the button cannot be left behind
  // offering to clear a search box that an empty or failed catalog still shows.
  $(`#${key}-clear`).hidden = !state.query;

  let catalog;
  try {
    catalog = await loadCatalog();
  } catch (err) {
    box.replaceChildren();
    $(`#${key}-filters`).hidden = true;
    $(`#${key}-filters`).replaceChildren();
    $(`#form-${key}-search`).hidden = true;
    notify(`#${key}-report`, `The catalog could not be loaded: ${err.message}. Your lists are unchanged.`, 'error', CATALOG_LOAD);
    return;
  }

  // A dropped entry means the bundled data is wrong, not that the list does not exist. Saying
  // so is better than showing a shorter catalog that looks complete.
  if (catalog.dropped) {
    notify(
      `#${key}-report`,
      `${catalog.dropped} catalog ${catalog.dropped === 1 ? 'entry is' : 'entries are'} incomplete and cannot be shown.`,
      'warn',
    );
  }

  if (key === 'catalog') ensureSetupGuideFeature(catalog.lists, key);

  // This shelf's own share of the catalog, taken before anything else looks at it, so the facets
  // count what this screen can show and the search never turns up a row that belongs elsewhere.
  const mine = key === 'catalog'
    ? modernTimelineLists(catalog.lists)
    : shelfLists(catalog.lists, key);

  box.replaceChildren();
  if (!mine.length) {
    $(`#${key}-filters`).hidden = true;
    $(`#form-${key}-search`).hidden = true;
    box.append(el('p', { class: 'rail-hint', text: shelf.empty }));
    return;
  }

  // The same rule the landing page uses, and for the same reason: scanning works up to about a
  // dozen orders, and below that a search box is a control with nothing to do. Applied per shelf
  // rather than to the catalog as a whole, because a reader on a six-row screen has no use for a
  // box just because a different screen is long. The owner intends to grow all three, so the box
  // appears on its own when a shelf passes the threshold rather than having to be added then.
  const totalStories = countStories(mine);
  const searchable = totalStories > CATALOG_FILTER_THRESHOLD;
  $(`#form-${key}-search`).hidden = !searchable;
  if (!searchable && state.query) {
    state.query = '';
    $(`#${key}-q`).value = '';
    $(`#${key}-clear`).hidden = true;
  }

  // The facets describe the whole shelf, not the current search, so searching never
  // makes a filter vanish from under the reader's cursor.
  renderCatalogShelfFilters(key, mine, searchable);
  if (key === 'spotlights') syncCatalogShelfSort(key);

  // Character Spotlight's editorial subset is applied before every generic narrowing step. It is
  // separate from the generic facets because it is always available on this one shelf, including
  // while the shelf remains below the size threshold that reveals search and category controls.
  const inSpotlight = key === 'spotlights'
    ? filterBySpotlightKind(mine, state.spotlight)
    : mine;

  // Filtering narrows which lists are shown; every list that is shown keeps the full detail a
  // reader needs to choose, so searching or switching filters never hides a description,
  // reading depth, or issue count.
  const inFacet = filterByFacet(inSpotlight, state.facet);
  const shown = searchCatalog(inFacet, state.query);

  const sortSentence = key === 'spotlights'
    ? ` Sorted by ${spotlightSortLabel(state.sort).toLowerCase()}.`
    : '';

  if (!shown.length) {
    const where = catalogNarrowingLabel(key, mine, state);
    const msg = state.query
      ? `No Reading Lists match “${state.query}”${where}.`
      : `No Reading Lists${where || ' in that category'}.`;
    box.append(el('p', { class: 'rail-hint', text: msg }));
    announceCatalog(`${msg}${sortSentence}`);
    return;
  }

  const stories = key === 'spotlights'
    ? sortSpotlightStories(groupCatalog(shown), state.sort)
    : groupCatalog(shown);
  // Resolved once for the whole shelf rather than per row: nineteen rows each searching every
  // path is the same work nineteen times, and the answer cannot differ between them. Resolved
  // against the whole catalog rather than this shelf, because a path runs through orders this
  // screen does not list and a placement computed from a slice of it would number the stops wrong.
  const placements = pathPlacements(catalog.paths, catalog.lists);
  const firstStops = visibleFirstStopGuides(stories, placements, chosenPath);
  if (firstStops.length) {
    const directions = firstStops.map(({ guide, placement }, index) => (
      `${index === 0 ? 'Start' : 'start'} ${placement.pathName} with ${guide.name}`
    ));
    box.append(el('p', {
      class: 'rail-hint shelf-orientation',
      text: `${directions.join('; ')}.`,
    }));
  }
  const sections = shelf.sections === 'eras'
    ? eraSections(stories)
    : shelf.sections === 'decades'
      ? decadeSections(stories)
      : [{ ...shelf, stories }];
  const grouped = Boolean(shelf.sections);
  if (key === 'catalog') {
    renderTimelineSections(box, sections, placements, {
      idPrefix: 'timeline',
      showEmptyYears: state.facet === 'all' && !state.query,
      sectionBlurb: true,
      sectionLevel: 'h2',
      yearLevel: 'h3',
      cardLevel: 'h4',
      undatedCardLevel: 'h3',
      cardOptions: { surface: 'catalog' },
    });
  }
  for (const section of sections) {
    if (key === 'catalog') break;
    // A shelf that is not divided draws no heading over its single group: the screen's own h1 and
    // cards already say what is on it, and a lone section title repeating them would be a second
    // heading standing over the same thing. Decade headings need no sentence restating the decade.
    if (grouped) box.append(shelfSectionHead(section, { blurb: false }));
    const grid = el('div', { class: 'catalog-grid' });
    for (const story of section.stories) {
      grid.append(catalogCard(story, placements.get(story.key), {
        surface: key,
        level: grouped ? 'h3' : 'h2',
      }));
    }
    box.append(grid);
  }

  // The dropped-entry warning already announced itself; a second announcement would replace it.
  if (!catalog.dropped) {
    const where = catalogNarrowingLabel(key, mine, state);
    const match = state.query ? ` matching “${state.query}”` : '';
    announceCatalog(`${shelf.heading} shows ${stories.length} ${stories.length === 1 ? 'Reading List' : 'Reading Lists'}${match}${where}.${sortSentence}`);
  }
}

// The divider over one part of the shelf. A heading rather than a styled line, because the thing a
// reader needs here is navigable.
//
// The level is passed in rather than fixed, because the same head is drawn on two screens at two
// depths. On the browse screen it sits directly under the view's h1, so it is an h2 and closes a
// heading skip that was there before the sections were. On the landing page it sits inside a
// section that already has an h2, so it is an h3 and the cards under it are h4. Hard-coding h2
// would have put two same-level headings in a parent-child relationship on the landing page.
function shelfSectionHead(
  section,
  {
    level = 'h2', className = 'shelf-section', blurb = true, headingId = null,
  } = {},
) {
  const children = [el(level, {
    id: headingId, class: 'shelf-section-title', text: section.heading,
  })];
  if (blurb) children.push(el('p', { class: 'shelf-section-blurb', text: section.blurb }));
  return el('div', { class: className }, children);
}

// The Timeline is content now, not a separate strip of links. Era milestones, year markers and
// cards share one vertical axis, so the chronology stays beside the stories it describes.
function emptyTimelineYear(year) {
  return el('div', { class: 'timeline-year-row is-empty' }, [
    el('div', { class: 'timeline-year-marker is-empty' }, [
      el('span', { 'aria-hidden': 'true', text: `${year}` }),
      el('span', { class: 'visually-hidden', text: `${year}, no Reading Lists` }),
    ]),
  ]);
}

function renderTimelineSections(box, sections, placements, {
  idPrefix = 'timeline', showEmptyYears, sectionBlurb = true,
  sectionLevel = 'h2', yearLevel = 'h3', cardLevel = 'h4', undatedCardLevel = 'h3',
  cardOptions = {},
}) {
  const flow = el('div', { class: 'timeline-flow' });
  let previousYear = null;
  for (const section of sections) {
    const byYear = new Map();
    for (const story of section.stories) {
      const year = storyYear(story);
      if (year === null) continue;
      if (!byYear.has(year)) byYear.set(year, []);
      byYear.get(year).push(story);
    }

    const years = showEmptyYears && Number.isInteger(section.from) && Number.isInteger(section.to)
      ? Array.from({ length: section.to - section.from + 1 }, (_, offset) => section.from + offset)
      : [...byYear.keys()].sort((a, b) => a - b);
    if (showEmptyYears && Number.isInteger(section.from) && previousYear !== null && years[0] > previousYear + 1) {
      const gap = el('div', { class: 'timeline-year-list' });
      for (let year = previousYear + 1; year < years[0]; year += 1) {
        gap.append(emptyTimelineYear(year));
      }
      flow.append(gap);
    }

    const sectionId = `${idPrefix}-era-${section.key}`;
    const era = el('section', {
      class: 'timeline-era',
      'aria-labelledby': sectionId,
    }, [
      el('div', { class: 'timeline-era-node', 'aria-hidden': 'true' }),
      shelfSectionHead(section, {
        className: 'shelf-section timeline-era-head',
        level: sectionLevel,
        blurb: sectionBlurb,
        headingId: sectionId,
      }),
    ]);

    const yearList = el('div', { class: 'timeline-year-list' });
    for (const year of years) {
      const yearStories = byYear.get(year) ?? [];
      if (!yearStories.length) {
        yearList.append(emptyTimelineYear(year));
        continue;
      }

      const yearId = `${idPrefix}-year-${year}`;
      const grid = el('div', { class: 'catalog-grid timeline-year-cards' });
      for (const story of yearStories) {
        grid.append(catalogCard(story, placements.get(story.key), {
          ...cardOptions, level: cardLevel,
        }));
      }
      yearList.append(el('section', {
        class: 'timeline-year-row',
        'aria-labelledby': yearId,
      }, [
        el('div', { class: 'timeline-year-marker' }, [
          el(yearLevel, { id: yearId, class: 'timeline-year-label', text: `${year}` }),
        ]),
        grid,
      ]));
    }

    if (!years.length) {
      const grid = el('div', { class: 'catalog-grid timeline-year-cards' });
      for (const story of section.stories) {
        grid.append(catalogCard(story, placements.get(story.key), {
          ...cardOptions, level: undatedCardLevel,
        }));
      }
      yearList.append(grid);
    }
    era.append(yearList);
    flow.append(era);
    if (Number.isInteger(section.from) && Number.isInteger(section.to)) previousYear = years[years.length - 1];
  }
  box.append(flow);
}

// One card per story. The complete description, collection metadata and reading-path choice remain
// in the preview dialog; this surface carries only what is needed to decide whether to open it.
//
// `surface` is the shelf this row is being drawn on. The report pane is derived from it rather
// than passed alongside it, because the two were separate arguments and a row reporting an import
// into another screen's pane is a failure with no symptom on the screen the reader is looking at.
function catalogCard(
  story,
  placement,
  {
    surface = 'catalog', report = null, localStoryKeys = null, level = 'h3', titleId = null,
  } = {},
) {
  const reportTarget = report ?? `#${surface}-report`;
  const title = story.name ?? story.lists[0].name;
  const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' });
  const fallback = el('div', { class: 'of cover-fallback', 'aria-hidden': true }, [
    el('span', { class: 'ofs', text: shortTitle(title) }),
  ]);
  const desc = el('p', { class: 'catalog-card-desc' });
  const meta = el('p', { class: 'catalog-card-meta' });
  const source = el('div', { class: 'result-source' });
  const path = pathDisclosure(placement, surface, { localStoryKeys });
  const disclosures = el('div', { class: 'catalog-card-disclosures' }, [path, source].filter(Boolean));
  const actions = el('div', { class: 'catalog-card-actions' });

  // One updater for every part that names a reading path. A choice made in Preview repaints the card
  // on close, so Add, the issue count and the Source disclosure cannot describe different paths.
  const paint = (list) => {
    paintCoverUrl(img, fallback, catalogCoverUrl(list), hueOf(title), title);
    desc.textContent = firstSentence(list.description);
    desc.hidden = !desc.textContent;
    meta.textContent = `${list.count} issue${list.count === 1 ? '' : 's'}`;
    source.replaceChildren(...[attributionLine(list)].filter(Boolean));
    const previewText = story.lists.length > 1 ? `${story.lists.length} reading options` : 'Preview';
    actions.replaceChildren(
      catalogPrimaryButton(list, reportTarget),
      el('button', {
        class: 'btn btn-g',
        type: 'button',
        'aria-label': labelledName(previewText, title),
        dataset: { key: story.key, act: 'preview' },
        onclick: () => openPreview(list, story),
      }, previewText),
    );
  };
  paint(chosenPath(story));

  const year = storyYear(story);
  return el('article', {
    class: 'catalog-card',
    dataset: { story: story.key, year: year ?? '' },
  }, [
    el('div', { class: 'catalog-card-main' }, [
      el('div', { class: 'ocard-art' }, [img, fallback]),
      el('div', { class: 'catalog-card-text' }, [
        el(level, { id: titleId, class: 'catalog-card-title', text: title }),
        desc,
        meta,
        disclosures,
      ]),
    ]),
    actions,
  ]);
}

function catalogPrimaryButton(list, reportTarget) {
  const saved = listForCatalogId(store.state, list.id);
  if (saved) {
    const text = 'Open →';
    return el('button', {
      class: 'btn',
      type: 'button',
      'aria-label': labelledName(text, list.name),
      dataset: { key: list.id, act: 'open' },
      onclick: () => {
        store.update((state) => setActive(state, saved.id));
        if (!store.lastUpdateOk) {
          notify(reportTarget, `${list.name} could not be opened because that selection could not be saved.`, 'error', `open:${list.id}`);
          return;
        }
        showView('read', { push: true });
      },
    }, text);
  }
  return el('button', {
    class: 'btn',
    type: 'button',
    'aria-label': labelledName(CATALOG_ADD, list.name),
    dataset: { key: list.id, act: 'import' },
    onclick: (event) => importCurated(list, event.currentTarget, { report: reportTarget }),
  }, CATALOG_ADD);
}

function pathDisclosure(placement, surface, { localStoryKeys = null } = {}) {
  if (!placement) return null;
  const opens = placement.previous === null;
  const summary = opens ? `Start · 1/${placement.total}` : `Step ${placement.position}/${placement.total}`;
  return el('details', { class: 'result-path' }, [
    el('summary', {
      'aria-label': `${summary}. Show path details for ${placement.pathName}`,
    }, summary),
    pathLine(placement, surface, { showBadge: false, localStoryKeys }),
  ]);
}

// Where this story sits on a named reading path, when it sits on one. Built outside `paint`
// because it is keyed on the story rather than on the reading the chooser has selected: House of
// M is the third stop whichever of its two readings a reader picks, so repainting the row must
// not be able to recompute it into a different answer.
//
// The badge on the first stop reads "Start here" rather than "Step 1 of 10". A reader who does
// not know where to begin is the entire reason this exists, and a position only answers them if
// something on the shelf is the answer at a glance rather than after reading a sentence.
//
// It does not say what comes before. On a single shelf sorted by year a stop's predecessor was
// almost always the row directly above it, and printing it made the longest element on the line a
// restatement of the previous one. What a reader cannot get by looking up is what comes next.
//
// Splitting the catalog into three screens by kind of reading gave that half a boundary condition
// rather than falsifying it. The one bundled path runs through all three screens, so seven of its
// nine hops still have the predecessor directly above and two of them do not. A backward stop link
// on those two was costed and declined: the orientation it buys is bought instead by the path's
// own name, which is already printed on all ten rows, so the same gap closes for no added words.
//
// Two links, one rule. "Next" is a link on exactly the hops that cross a screen, and the path name
// is a link to the first stop on exactly the rows drawn away from it, so both go through stopLink
// rather than through two functions holding one idea. Where the screen already holds the stop, a
// link would land the reader at the top of the screen they are standing on, which is further from
// the row than they started. Measured against the shipped path: nine rows take a linked name and
// two take a linked "Next", and one row, step five, takes both.
//
// The words are identical either way. Nothing is appended to say where either link goes, because
// the screen it lands on says that on arrival and the complaint this whole change answers was that
// these screens carry too much text. Both links sit inside one span rather than beside the badge,
// because .path-step is a flex row and a link parented directly by it becomes an item with a gap
// each side, which reads as a control strip rather than as a sentence.
//
// The <p> takes no aria-label: every word of it is already on screen, and `aria-label` on a <p>
// has no role to attach to, so it is markup that reads correctly in a review and is dropped by the
// accessibility tree. An <a> is the opposite case, and the path name is the one that needs it,
// because "The Modern Avengers" alone does not say that pressing it goes to the start. Its name is
// built out of the visible words rather than beside them, which is what accname.js exists to hold.
export function pathLine(
  placement,
  surface,
  { showBadge = true, localStoryKeys = null } = {},
) {
  if (!placement) return null;
  const opens = placement.previous === null;
  const start = stopLink(placement.first, surface, {
    text: placement.pathName,
    label: labelledName(placement.pathName, `Start at ${placement.first.name}`),
    localStoryKeys,
  });
  const link = placement.next ? stopLink(placement.next, surface, { localStoryKeys }) : null;
  const lead = opens ? ` · Step 1 of ${placement.total} · ` : ' · ';
  const badge = showBadge ? el('span', {
    class: opens ? 'pill pill-start' : 'pill',
    text: opens ? 'Start here' : `Step ${placement.position} of ${placement.total}`,
  }) : null;
  return el('p', { class: 'result-meta path-step' }, [
    badge,
    el('span', {}, [
      start ?? placement.pathName,
      lead,
      ...(placement.next ? ['Next: ', link ?? placement.next.name] : ['Last stop']),
    ]),
  ].filter(Boolean));
}

// Null when the stop is on the screen already showing this row, which is what keeps the offer
// honest: a link is only drawn where pressing it takes the reader somewhere they are not.
//
// An <a> with a real hash href rather than a button, so the destination is in the status bar,
// middle-click opens it, and Back returns to the row that named it without this code owning any of
// that. Constraint 5 makes the origin load-bearing, so the address it writes is a fragment and
// nothing else. The click is taken over only to clear the destination's narrowing first.
function stopLink(
  stop,
  surface,
  {
    text = stop.name, label = null, localStoryKeys = null,
  } = {},
) {
  const dest = stop.shelf;
  if (dest === surface || localStoryKeys?.has(stop.key)) return null;
  const href = { view: dest };
  if (dest === 'spotlights') {
    const spotlightState = shelfState.get(dest);
    href.sort = spotlightState ? spotlightState.sort : null;
  }
  return el('a', {
    href: formatRoute(href),
    'aria-label': label,
    onclick: (e) => {
      e.preventDefault();
      goToStop(stop);
    },
  }, text);
}

// Following the path across a screen boundary. Clearing the destination's narrowing is the
// decision this function exists to make rather than a tidy-up, and it is the dangerous part of
// this change: a reader who presses a control naming one specific order and lands on a screen that
// does not contain it has been told something untrue, which is worse than never having been
// offered the link.
//
// The hazard is live rather than theoretical. Browse-by-era holds 46 stories, passes the search
// threshold of 12 and so ships a search box and facet chips, and a query or a chip left behind
// from an earlier visit survives until that screen is rendered again. Measured against the shipped
// catalog, three of its facet chips and most queries drop the row a crossing lands on.
//
// Withdrawing the offer instead was the alternative and it is the weaker one, because the offer is
// good and only the leftover state is not. Arriving by a path link is an explicit new intent, so
// clearing makes the offer true; refusing would make a working link vanish for a reason the reader
// cannot see. What this cannot fix is a stop no screen holds, and nothing can be: the shelf a stop
// names is computed from the whole catalog by the same rule the renderer uses, so the row is on
// the destination by construction, and `catalog.test.js` holds that for every stop of every path.
function goToStop(stop) {
  const dest = stop.shelf;
  clearNarrowing(dest);
  // Pushed rather than replaced: this is a place the reader chose to go, so Back returns them to
  // the row they pressed. Focus goes to the destination's heading, which is where every other
  // arrival in this app puts it, so a screen reader is told which screen it is now on rather than
  // being moved silently. showView draws the destination shelf itself, after the clearing above.
  showView(dest, { focus: true, push: true });
}

// The destination's search box and facet chips, put back to showing everything. Only a catalogue
// shelf is ever the destination: a link is drawn only when the next stop is on another screen, and
// the landing page is another screen only when the reader is not already on it, which is a
// direction no link points. So this addresses a shelf and nothing else.
function clearNarrowing(dest) {
  const state = shelfState.get(dest);
  if (!state) return;
  resetCatalogNarrowing(state);
  $(`#${dest}-q`).value = '';
  $(`#${dest}-clear`).hidden = true;
  for (const radio of document.querySelectorAll(`input[name="${dest}-kind"]`)) {
    radio.checked = radio.value === state.spotlight;
  }
}

function syncCatalogShelfSort(key) {
  if (key !== 'spotlights') return;
  const state = shelfState.get(key);
  if (!state) return;
  const checked = state.sort === 'popularity' ? 'popularity' : 'current-order';
  for (const radio of document.querySelectorAll('input[name="spotlights-sort"]')) {
    radio.checked = radio.value === checked;
  }
}

function catalogNarrowingLabel(key, lists, state) {
  const labels = [];
  if (key === 'spotlights' && state.spotlight !== 'all') {
    labels.push(spotlightKindLabel(state.spotlight));
  }
  if (state.facet !== 'all') labels.push(facetLabel(lists, state.facet));
  return labels.length ? ` in ${labels.join(' and ')}` : '';
}

// Where an order came from and when it was pinned. A reader deciding whether to trust a curated
// order needs both: the credit tells them who made it, the date bounds how recent it can be.
// The stamp is when the vendor script fetched the order, not when its curator last revised it,
// so it is labelled as a snapshot rather than claiming the list itself was updated that day.
function attributionLine(list) {
  const label = sourceLabel(list);
  const href = sourceLink(list);
  const section = typeof list.sourceSection === 'string' && list.sourceSection.trim()
    ? list.sourceSection.trim()
    : null;
  const updated = updatedLabel(list);
  if (!label && !section && !updated) return null;

  const parts = [];
  if (label) {
    parts.push('Source: ');
    parts.push(href
      ? el('a', {
        href,
        target: '_blank',
        rel: 'noopener noreferrer',
        'aria-label': `Source of ${list.name}: ${label}${section ? `, section ${section}` : ''}`,
      }, label)
      : el('span', { text: label }));
  }
  if (section) parts.push(el('span', { text: `${label ? ' · ' : ''}Section: ${section}` }));
  if (updated) parts.push(el('span', { text: `${label || section ? ' · ' : ''}Snapshot taken ${updated}` }));
  // Folded away rather than printed. Provenance is a thing a reader checks once about one order,
  // never a thing they read on every row, and measured on the Timeline screen at 1280x900 the 46
  // rows each carrying this line put 267 small-font nodes on one screen. A disclosure rather than a
  // hover tooltip, because a tooltip reaches neither the keyboard nor touch, and Chromium expands a
  // closed details for find-in-page, so the text stays findable while it is out of the way.
  //
  // The summary names the order it belongs to. Forty-six controls all announcing "Source" and
  // nothing else is a list a screen reader user cannot navigate; the visible word stays inside the
  // spoken name, so the two do not disagree.
  return el('details', { class: 'result-src' }, [
    el('summary', { 'aria-label': `Source of ${list.name}` }, 'Source'),
    el('p', { class: 'result-meta result-source' }, parts),
  ]);
}

function wireCatalogShelfSearch(key) {
  const state = shelfState.get(key);
  const input = $(`#${key}-q`);
  // Submitting is a no-op because results already track what has been typed; without this the
  // form would reload the page and throw the reader back to an empty catalog.
  $(`#form-${key}-search`).addEventListener('submit', (e) => e.preventDefault());
  input.addEventListener('input', () => {
    state.query = input.value.trim();
    renderCatalogShelf(key);
  });
  $(`#${key}-clear`).addEventListener('click', () => {
    input.value = '';
    state.query = '';
    input.focus();
    renderCatalogShelf(key);
  });
  if (key === 'spotlights') {
    for (const radio of document.querySelectorAll('input[name="spotlights-kind"]')) {
      radio.addEventListener('change', () => {
        state.spotlight = radio.value;
        renderCatalogShelf(key);
      });
    }
    for (const radio of document.querySelectorAll('input[name="spotlights-sort"]')) {
      radio.addEventListener('change', () => {
        state.sort = radio.value === 'popularity' ? 'popularity' : null;
        renderCatalogShelf(key);
        syncHash({ push: true });
      });
    }
  }
}

// `searchable` rather than a second look at the count: the search box and the chips are both
// controls for narrowing a long shelf, and a shelf short enough not to need typing does not need
// chips either. Tying them to one answer keeps a screen from offering half of a way to narrow.
function renderCatalogShelfFilters(key, lists, searchable) {
  const state = shelfState.get(key);
  const box = $(`#${key}-filters`);
  const options = catalogFacets(lists);

  // One option is no choice at all, so the filter would only add noise.
  box.hidden = !searchable || options.length < 2;
  if (box.hidden) {
    state.facet = 'all';
    return;
  }

  // A facet can disappear when the bundled data changes; falling back to "all" keeps the
  // reader looking at a populated catalog instead of a permanently empty one.
  if (state.facet !== 'all' && !options.some((c) => c.key === state.facet)) {
    state.facet = 'all';
  }

  // Selecting a filter re-renders the view. Rebuilding the radios then would destroy the
  // one the reader just activated and drop keyboard focus out of the filter, so when the
  // options are unchanged we only move the selection.
  const existing = [...box.querySelectorAll(`input[name="${key}-category"]`)];
  if (existing.length === options.length && existing.every((r, i) => r.value === options[i].key)) {
    for (const radio of existing) radio.checked = radio.value === state.facet;
    return;
  }

  box.replaceChildren(
    el('legend', { class: 'visually-hidden', text: 'Filter the catalog by category' }),
    ...options.map(({ key: facet, label, count }) => el('label', { class: 'fp' }, [
      el('input', {
        type: 'radio',
        name: `${key}-category`,
        value: facet,
        checked: facet === state.facet,
        onchange: () => { state.facet = facet; renderCatalogShelf(key); },
      }),
      el('span', { text: `${label} (${count})` }),
    ])),
  );
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
    // order's own `placeholders` field, which counts only the first kind and reads 0 for every
    // order this app currently ships while 63 items across two of them hold nothing at all.
    const parts = [`${navigate ? 'Imported' : 'Added'} ${order.name}: ${added} issues.`];
    parts.push(...orderGapSentences(order));
    parts.push('Any issues you had already read stay read.');
    if (!navigate) parts.push('It is now in your Library.');
    const withdrawn = forgetDeletedFor(catalogId, order.name);
    if (withdrawn) parts.push(withdrawn);
    // A failure from a previous attempt would otherwise sit under a successful import,
    // contradicting it. Cleared by the order's key, not by this pane, so an attempt that failed
    // from the other entry point is cleared too.
    clearNotice(importKey);
    announce(withSaveEducation(parts.join(' '), transition));
    return listId;
  } catch (err) {
    notify(report, `Could not load ${list.name}: ${err.message}. Your lists are unchanged.`, 'error', importKey);
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

// ------------------------------------------------------------------ progress

// Not persisted, unlike the reading filter in BL-037. That one is a lens on a long order a reader
// works through over days; this one is answered by whichever list they are reading now, so the
// useful default is the active list every time the view is opened.
let progressScope = 'list';

function wireProgressScope() {
  for (const radio of document.querySelectorAll('input[name="progress-scope"]')) {
    radio.addEventListener('change', () => {
      if (!radio.checked) return;
      progressScope = radio.value;
      renderProgress();
    });
  }
}

function renderProgress() {
  const box = $('#series-progress');
  const list = store.state.lists[activeListId()];
  // `active` is null only when no list exists, so "This list" has no subject to name: the subtitle
  // below would dereference it, and the choice would be between two options that both render
  // "Nothing tracked yet." The whole fieldset is hidden rather than one radio disabled, matching
  // the browse filters, which hide for the same reason. A disabled chip was the first
  // attempt and was wrong: .fp paints the adjacent span, and with no :disabled rule it rendered
  // identically to a live one, hover lift included.
  const scoped = progressScope === 'list' && Boolean(list);
  $('#progress-scope').hidden = !list;
  for (const radio of document.querySelectorAll('input[name="progress-scope"]')) {
    radio.checked = radio.value === (scoped ? 'list' : 'all');
  }
  $('#progress-method-text').textContent = scoped
    ? `This list counts the issues in “${list.name}”. Tracked means issues you added, not the size of each complete series.`
    : 'All lists counts each issue once, even when it appears in more than one list. Tracked means issues you added, not the size of each complete series.';

  const rows = scoped ? seriesProgress(store.state, activeListId()) : seriesProgress(store.state);
  // Methodology is available on demand beside the scope control, and absent when there is no table
  // for it to explain.
  $('#progress-method').hidden = rows.length === 0;
  // Both the scope and the active list are in the key. One number would let expanding All lists
  // carry into This list, and one list's expansion onto the next list opened under the same scope,
  // so switching either restarts at the cap, which is what a reader expects when the list changes.
  const key = `${progressScope}:${activeListId()}`;
  let countLine = null;
  preservingFocus(box, () => {
    box.replaceChildren();
    if (!rows.length) {
      // The same shape the library sub-views and the finished-order panel use, rather than a bare
      // hint line. It also drops the two sentences of methodology that sat above it: how unique
      // issues are counted and what "tracked" means are answers about a table, and there is no
      // table, so on this screen they explained a measurement of nothing.
      box.append(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-glyph', 'aria-hidden': 'true', text: '☐' }),
        el('p', { text: 'Nothing tracked yet.' }),
        emptyAction({ label: 'Browse Reading Lists', view: 'catalog' }),
      ]));
      return;
    }
    const shown = Math.min(listShown.get(key) ?? LIBRARY_CAP, rows.length);
    const slice = rows.slice(0, shown);
    const sum = progressSummary(rows);
    // "of" between the two figures is the same phrasing the rows use, so the band and a row cannot
    // read as counting different things. "fully read" not "complete": the app knows only what the
    // reader tracks, never whether a series has ended.
    box.append(summaryBand([
      { figure: sum.series, label: 'series' },
      { figure: `${sum.read.toLocaleString()} of ${sum.tracked.toLocaleString()}`, label: 'tracked issues read' },
      { figure: sum.done, label: 'series fully read' },
    ]));
    if (rows.length > LIBRARY_CAP) countLine = box.appendChild(shownLine(shown, rows.length));
    for (const group of progressGroups(slice)) {
      box.append(groupSection(group, (r) => progressRow(r, group.key)));
    }
    if (shown < rows.length) box.append(moreButton(key, rows.length - shown, renderProgress));
  }, { primary: 'more', fallback: () => countLine });
}

// ------------------------------------------------------------------ library sub-views

// Both sub-views are rendered by one function reading LIBRARY_VIEWS, rather than one function
// each. Two renderers would be two places for a heading, a subtitle and an empty state to be
// written, and the second view would be the one that quietly stopped matching the first.
function renderLibrary() {
  for (const v of LIBRARY_VIEWS) {
    const section = $(`#view-${v.value}`);
    section.querySelector('h1').textContent = v.label;

    const box = section.querySelector('.results');
    const rows = v.select(store.state);
    // These views gained the first focusable control they have ever held, the show-more button, so
    // the whole-container rebuild that ran silently until now can drop focus to the body. The pair
    // it restores by is written onto the button below; without it a press would lose the reader.
    let countLine = null;
    preservingFocus(box, () => {
      box.replaceChildren();
      if (!rows.length) {
        // .empty-state is reused rather than a second rule written: its dashed edge is a shape
        // difference, not a colour one, so the view reads as deliberately empty under forced colours.
        box.append(el('div', { class: 'empty-state' }, [
          el('div', { class: 'empty-glyph', 'aria-hidden': 'true', text: '☐' }),
          el('p', { text: v.empty }),
          ...(v.emptyAction ? [emptyAction(v.emptyAction)] : []),
        ]));
        return;
      }
      const shown = Math.min(listShown.get(v.value) ?? LIBRARY_CAP, rows.length);
      const slice = rows.slice(0, shown);
      box.append(el('p', { class: 'library-sort', text: v.sort }));
      box.append(summaryBand(v.summarise(rows)));
      if (rows.length > LIBRARY_CAP) countLine = box.appendChild(shownLine(shown, rows.length));
      if (rows.length < GROUP_MIN) {
        for (const row of slice) box.append(libraryRow(row, v));
      } else {
        for (const group of v.group(slice, Date.now())) {
          box.append(groupSection(group, (row) => libraryRow(row, v)));
        }
      }
      if (shown < rows.length) box.append(moreButton(v.value, rows.length - shown, renderLibrary));
    }, { primary: 'more', fallback: () => countLine });
  }
}

// "In no list" is said out loud rather than left blank. An issue can be read, or added by hand,
// and belong to nothing: deleting a list keeps both the issue record and its read state, by the
// deliberate choice `deleteList` records, and until these views there was no screen anywhere in
// the app on which such an issue appeared. A blank where the list names go would read as a
// rendering fault rather than as the fact it is.
function libraryRow(row, v) {
  const meta = [
    row.readAt ? `Read ${new Date(row.readAt).toLocaleDateString()}` : null,
    row.seriesName ? seriesOnly(row.seriesName) : null,
    row.lists.length ? `In ${row.lists.join(', ')}` : 'In no list',
  ].filter(Boolean).join(' · ');

  // The same badge the reading view puts on a hand-added row, so an entry is recognisable as the
  // same thing in both places. A badge marks a row as unlike its neighbours, which is why the
  // view where every row is hand-added switches it off rather than repeating it down the page.
  const badge = v.markHandAdded && row.source === 'manual'
    ? [' ', el('span', { class: 'badge badge-unknown' }, 'by hand')]
    : [];

  // No chip repeats this. The meta line already says "In no list" in words, so a chip saying it
  // again is heard twice by a screen reader and, on the hand-added view where every row is in no
  // list, prints a column that distinguishes nothing.

  // The variant the reading rows already request, so no new image size enters the cache, and the
  // fallback is the reading row's bordered tile rather than the larger gradient ones.
  const img = el('img', { class: 'rcov-i', alt: '', loading: 'lazy', decoding: 'async' });
  const fb = el('div', { class: 'rcov-f cover-fallback', 'aria-hidden': true });
  paintCover(img, fb, row, 'portrait_incredible');

  const contents = [
    el('div', { class: 'rcov' }, [img, fb]),
    el('div', { class: 'result-main' }, [
      el('div', { class: 'result-title', text: row.title }),
      el('div', { class: 'result-meta' }, [el('span', { text: meta }), ...badge]),
    ]),
  ];
  return v.value === 'library-read'
    ? issueFocusAnchor(row, {
      surface: 'everything-read',
      className: 'result result-cov result-focus',
      children: contents,
    })
    : el('div', { class: 'result result-cov' }, contents);
}

// ------------------------------------------------------------------ data view

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

// BL-113's decision, and the reason it is a pair of sentences rather than a wider erase.
//
// The rule at `src/js/storage.js:336-339` stands: nothing but the reader removes a salvage copy,
// because no rule this app could apply would know whether they still want data it could not read
// itself. So the erase is not widened to reach those copies, and the wording is narrowed to stop
// claiming that it does. They are not undisclosed either way, which is what separates them from
// the undo snapshot BL-101 did withdraw: they are listed on this same screen, directly above this
// button, each with its own Remove.
//
// Narrowing is also the half of the choice that can be taken back. A dialog that overstates can be
// corrected later against copies that still exist; an erase that has already destroyed the last
// record of data nobody could open cannot be.
//
// Three answers rather than two, the same three renderSalvage() gives and for the same reason. A
// browser that will not enumerate its own storage has not said there is nothing, it has declined
// to say, and promising that everything is gone on the strength of a refusal is the one answer
// that can be wrong in the direction that matters.
//
// A fourth thing to read, and the one the first version of this got wrong: whether a copy is
// live. renderSalvage() puts a note where the Remove button would be on a live copy, so naming
// that button while one is live sends the reader to a control the screen is withholding, and it
// does it in the state where a copy is likeliest to exist at all. Location is claimed either
// way, because that half is true either way; only the button is conditional.
//
// Settings are named because they outlive every one of these answers. Nothing in the app removes
// mrt.settings or sidebar.collapsed, so this branch's old sentence, that the route clears
// everything this browser has stored for the tracker, was false for any reader who had ever
// changed the theme. docs/ARCHITECTURE.md holds the whole list and calls those two preferences
// rather than data, which is why the message said afterwards still reports all local data erased
// and only the promise made beforehand had to be narrowed.
export function eraseDialogBody(copies) {
  const tail = ' Export a backup first if you are not sure. It cannot be undone.';
  const lead = 'This clears every list and all reading progress. Your settings are kept.';
  if (copies === null) {
    return `${lead} This browser will not let the app list what else it has stored, so anything `
      + `kept aside after a failed read is not reached and stays where it is.${tail}`;
  }
  if (copies.length === 0) return `${lead}${tail}`;
  const one = copies.length === 1;
  const where = `${lead} `
    + `${one ? 'One copy' : `${copies.length} copies`} of data this app could not read `
    + `${one ? 'is' : 'are'} kept aside, and this does not reach ${one ? 'it' : 'them'}. `
    + `${one ? 'It stays' : 'They stay'} under "Copies kept after a failed read" above`;
  if (copies.some((c) => c.live)) {
    return `${where}, and only you can remove ${one ? 'it' : 'them'}.${tail}`;
  }
  return `${where}, with ${one ? 'its' : 'their'} own Remove button.${tail}`;
}

// What is said once the erase has landed, composed rather than chosen, because the snapshot and
// the salvage copies survive independently and either, both or neither can be left. The plain
// sentence is kept for the case where nothing was, so an ordinary erase still reports plainly.
//
// Every clause is said only when it is true. A storage that refuses the removal leaves a whole
// copy of the tracker behind a live button, after a dialog that promised nothing would survive,
// and the reader can act on that only if they are told which button it is. The same holds for the
// copies this route deliberately does not reach: naming where they are is the difference between
// disclosing them and merely not having lied.
export function eraseOutcome(snapshotKept, copies) {
  const notes = [];
  if (snapshotKept) {
    notes.push('One copy could not be removed and is still in this browser, behind "Undo last restore".');
  }
  if (copies === null) {
    notes.push('This browser will not list what else it has stored, so anything kept aside after a failed read is still here.');
  } else if (copies.length === 1) {
    notes.push('One copy kept after a failed read is still here, under "Copies kept after a failed read".');
  } else if (copies.length > 1) {
    notes.push(`${copies.length} copies kept after a failed read are still here, under "Copies kept after a failed read".`);
  }
  if (notes.length === 0) return 'All local data erased.';
  return ['Lists and reading progress erased.', ...notes].join(' ');
}

function wireData() {
  $('#api-base').value = settings.apiBase;
  $('#opt-covers').addEventListener('change', (e) => setCovers(e.target.checked));
  $('#opt-update-checks').addEventListener('change', (e) => setUpdateChecks(e.target.checked));
  $('#opt-theme').addEventListener('change', (e) => setTheme(e.target.value));
  $('#btn-check-updates').addEventListener('click', runExplicitUpdateCheck);

  $('#btn-export-json').addEventListener('click', () => {
    download('recap-page-backup.json', JSON.stringify(exportBackup(store.state), null, 2), 'application/json');
    announce('Backup downloaded.');
  });

  $('#btn-export-md-2').addEventListener('click', exportMarkdown);

  $('#restore-file').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Asked of the file's declared size, so a file picked by mistake is refused before `text()`
    // pulls it into memory. The check is here rather than in the store because by the time the
    // store sees a backup it is already a string, which is the cost this avoids.
    const refusal = backupFileRefusal(file);
    if (refusal) {
      notify('#restore-report', refusal, 'error');
      e.target.value = '';
      return;
    }
    const text = await file.text();
    const res = store.restore(text);
    if (res.ok) {
      notify('#restore-report', 'Restored. Your previous data was snapshotted, so this can be undone once.', 'ok');
      // Asked of the store rather than assumed from the success. A first restore into an empty
      // tracker snapshots an empty main key, which is no snapshot at all, and this line used to
      // un-hide the button anyway, after the repaint had correctly hidden it. Clicking it answered
      // "No pre-restore snapshot available."
      $('#btn-undo-restore').hidden = !store.hasPreRestoreSnapshot();
      // The buffered list belongs to the data the restore has just replaced. Offering it back
      // would splice a list out of the old tracker into the restored one.
      forgetDeleted();
    } else {
      // The lead sentence comes from what the store found in storage, not from this call site.
      // It used to read "nothing was changed" whatever had happened, including after a swap that
      // had already landed.
      const lead = res.changed === null
        ? 'Restore did not finish, and this browser will not say what your saved data now holds. Reload the page.'
        : 'Restore refused, nothing was changed.';
      notify('#restore-report', `${lead} ${res.errors.join(' ')}`, 'error');
      // Whether an undo is offered is a question about the snapshot slot, which these failures
      // leave in three different states, so it is asked rather than inferred from the failure.
      $('#btn-undo-restore').hidden = !store.hasPreRestoreSnapshot();
    }
    e.target.value = '';
  });

  $('#btn-undo-restore').addEventListener('click', () => {
    const res = store.undoRestore();
    notify('#restore-report', res.ok ? 'Restore undone.' : `Could not undo: ${res.errors.join(' ')}`, res.ok ? 'ok' : 'error');
    // Undoing a restore swaps the whole state back, exactly as the restore did, so the buffered
    // list belongs to data that is no longer here in this direction too.
    if (res.ok) forgetDeleted();
  });
  // Measured at 200 per cent zoom, the API notice landed 658 px above view, and cache clearing replaced a restore refusal.
  $('#form-settings').addEventListener('submit', (e) => {
    e.preventDefault();
    const value = $('#api-base').value.trim().replace(/\/+$/, '');
    if (!isAllowedApiBase(value)) {
      return notify('#api-report', 'That API URL is not usable: use https, or http against localhost.', 'error');
    }
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
    // The synopsis runner holds its own reference for the same reason the hydrator does, so it needs
    // the same rebinding. Without it a run started after this point would go on asking the service
    // the reader has just stopped using, telling it which issues they are reading, which is the one
    // failure the base URL check exists to prevent.
    //
    // A run already in flight is stopped rather than switched, and what it fetched is dropped: the
    // reader agreed to a dialog naming the old service, and that agreement does not carry over to a
    // different one. Prose on screen has to have come from the service the reader was told about.
    if (synopsisRunner.active) synopsisRunner.cancel();
    synopsisRunner.api = api;
    sessionSynopsis.clear();
    renderSynopsis(null);
    renderHero();
    notify('#api-report', 'API URL saved. Cached data from the previous URL is kept separate.', 'ok');
    checkHealth();
  });

  $('#btn-clear-cache').addEventListener('click', async () => {
    const button = $('#btn-clear-cache');
    button.disabled = true;
    try {
      const result = await clearCacheGenerations(cache, {
        onLegacyBlocked: reportBlockedLegacyCleanup,
      });
      await refreshCacheUsage();
      const failure = cleanupFailureMessage(result);
      notify(
        '#cache-report',
        failure || 'Cached metadata cleared. Lists and reading progress are untouched.',
        failure ? 'warn' : 'ok',
      );
    } catch (err) {
      notify('#cache-report', `Cached metadata could not be cleared (${err?.message ?? err}).`, 'error');
    } finally {
      button.disabled = false;
    }
  });

  $('#btn-wipe').addEventListener('click', async () => {
    const yes = await askConfirm({
      title: 'Erase every list and all reading progress?',
      body: eraseDialogBody(store.salvageCopies()),
      confirmLabel: 'Erase everything',
    });
    if (!yes) return;
    const { snapshotKept } = store.eraseAll();
    cache.clear();
    // The undo buffer points at a list from the data that has just been erased, so putting it
    // back would resurrect one list out of a tracker the reader asked to be emptied.
    forgetDeleted();
    // The button's visibility belongs to renderBlocked(), and the withdrawal happens after the
    // repaint the erase itself triggered, so the question is put again here rather than left to
    // whatever unrelated render comes next.
    renderBlocked();
    // The fourth trigger, and the one arrival cannot cover, because this button sits on the screen
    // that list is already showing. Both outcomes move a row, in opposite directions.
    //
    // An erase that lands replaces the bytes a live copy was taken of, so that copy stops being
    // live and trades its note for a Remove button. This was written here first as unreachable, on
    // the grounds that an erase cannot land while a copy is live, and that was wrong: persist()
    // compares write tokens rather than bytes and a token is read from the head of the value, so a
    // tab that wrote it still matches after something truncates the tail. A schema downgrade is the
    // everyday shape of that, and the tab that shortened the value is not the tab that cannot read
    // it afterwards.
    //
    // An erase that is refused moves a row the other way. The refusal rolls back by re-reading, the
    // read fails on the bytes that caused it, and the failure salvages, so this press can create the
    // first copy this browser has ever held on a screen that is at that moment saying nothing is
    // being kept aside. Nothing announces then, because nothing was saved, which leaves this and
    // the banner as the only surfaces carrying it.
    renderSalvage();
    // Asked of storage again rather than reused from what the dialog was built with: the dialog
    // sits open for as long as the reader leaves it, and another tab can take a copy or remove one
    // in that time. Same reason snapshotKept is read back rather than inferred from the removal.
    announceIfSaved(eraseOutcome(snapshotKept, store.salvageCopies()));
  });
}

// Measured in Edge rather than assumed, and the first attempt at this comment got it wrong. The
// largest value a cleared page accepted under a one-character key was 5,242,879 characters, which
// with the key is 5,242,880, and that is 10 MiB at two bytes per character rather than the 5 MiB
// first written here. Two runs filling the same room with 'x' and with an accented character were
// accepted to the identical character, so the cost is per character and does not depend on the
// content. So a copy occupies twice its length, and reporting the length alone would have
// understated every figure by half on the one screen whose subject is running out of room.
const salvageKb = (chars) => Math.max(1, Math.round((chars * 2) / 1024));

// Date and time to the second, not date alone. Copies are keyed to the millisecond and two can be
// taken on one day, and the reader choosing between them in a dialog that calls the removal
// unrecoverable has only this string to choose with. Measured: two copies a few milliseconds apart
// both rendered "Copy taken on 9 August 2026", with identical accessible names and an identical
// confirmation. Seconds separate two incidents; two copies inside one second still read alike, and
// those are the collision case freeArchiveKey() handles, where the copies are moments apart and
// the millisecond that distinguishes them is in the key rather than in anything worth showing.
//
// Compared against null rather than tested for truth, because a copy stamped at the epoch is a
// real case a device with a dead clock produces, and the layer below reports 0 and null as
// different values on purpose. Treating 0 as absent would discard that in the last step.
const salvageWhen = (at) => (at === null || at === undefined
  ? null
  : new Date(at).toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }));

// The reader's view of what is being kept on their behalf. Read from storage on every call rather
// than from anything held in memory, because another tab can have taken a copy or removed one
// since this tab booted, and a stale list here offers a Remove for a copy that is already gone.
function renderSalvage() {
  const box = $('#salvage-list');
  if (!box) return;
  const copies = store.salvageCopies();

  // Three answers, not two. A browser that will not enumerate its own storage has not told us
  // there is nothing; it has declined to say, and a reader whose copies are all still there must
  // not be shown an empty list. The download in the recovery banner is unaffected either way,
  // because it reads one known key rather than walking them.
  if (copies === null) {
    box.replaceChildren(el('p', {
      class: 'rail-hint',
      text: 'This browser will not let the app list what it has stored, so any copies it is holding '
        + 'cannot be shown here. Nothing has been removed.',
    }));
    return;
  }
  if (copies.length === 0) {
    box.replaceChildren(el('p', { class: 'rail-hint', text: 'Nothing is being kept aside. Your saved data has always been readable.' }));
    return;
  }

  const total = copies.reduce((n, c) => n + c.chars, 0);
  box.replaceChildren(
    el('p', {
      class: 'rail-hint',
      text: `${copies.length} ${copies.length === 1 ? 'copy is' : 'copies are'} being kept, `
        + `taking about ${salvageKb(total)} KB.`,
    }),
    el('ul', { class: 'rows' }, copies.map((c) => {
      const when = salvageWhen(c.at);
      return el('li', { class: 'salvage-row' }, [
        el('div', { class: 'salvage-what' }, [
          el('span', { class: 'salvage-when', text: when ? `Copy taken on ${when}` : 'Copy with no date recorded' }),
          el('span', { class: 'salvage-size', text: `about ${salvageKb(c.chars)} KB` }),
        ]),
        el('div', { class: 'field-row' }, [
          el('button', {
            type: 'button',
            class: 'quiet',
            dataset: { act: 'download', key: c.key },
            'aria-label': `Download the ${when ? `copy taken on ${when}` : 'copy with no date recorded'}`,
            text: 'Download',
          }),
          // The offer is withdrawn rather than refused: while this copy is the last record of data
          // the app cannot read, removing it is the one thing that would leave the reader with
          // nothing, and a button that explains itself only after the click has already asked them
          // to try. The sentence depends on whether this tab is the one that is blocked, because
          // liveness is a property of storage and the banner is a property of the tab: a second
          // tab that read the data before it went bad shows the row with no warning above it.
          c.live
            ? el('span', {
              class: 'rail-hint',
              text: store.blocked
                ? 'Kept until the warning above is resolved'
                : 'Kept while the data it copies is still saved here',
            })
            : el('button', {
              type: 'button',
              class: 'quiet quiet-danger',
              dataset: { act: 'forget', key: c.key },
              'aria-label': `Remove the ${when ? `copy taken on ${when}` : 'copy with no date recorded'}`,
              text: 'Remove',
            }),
        ]),
      ]);
    })),
  );
}

function wireSalvage() {
  // One listener on the container, because the rows are rebuilt after every removal and listeners
  // bound to the buttons would go with them.
  $('#salvage-list').addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const { act, key } = btn.dataset;
    const copies = store.salvageCopies();
    const copy = copies?.find((c) => c.key === key);
    if (!copy) {
      renderSalvage();
      // Two reasons the copy is not in the list, and only one of them means it is gone. A browser
      // that declined to enumerate has not told us anything was removed, and saying so would be
      // the one wrong thing to say on the screen whose subject is what is still being kept.
      return notify('#salvage-report', copies === null
        ? 'This browser will not let the app list what it has stored, so that copy cannot be acted on here. Nothing has been removed.'
        : 'That copy is no longer there. The list has been refreshed.', 'warn');
    }
    const when = salvageWhen(copy.at);
    const named = when ? `taken on ${when}` : 'with no date recorded';

    if (act === 'download') {
      const raw = store.salvageRawAt(key);
      if (!raw) return notify('#salvage-report', 'That copy could not be read back, so nothing was downloaded.', 'warn');
      // To the second, for the same reason the row is: two copies taken on one day would otherwise
      // arrive as one name and a browser-appended (1), leaving the reader unable to tell which is
      // which after the screen that could have told them is closed.
      const stamp = copy.at === null ? 'undated' : new Date(copy.at).toISOString().slice(0, 19).replace(/:/g, '-');
      download(`recap-page-unreadable-${stamp}.json`, raw, 'application/json');
      return notify('#salvage-report', `Downloaded the copy ${named}. It is still being kept here as well.`, 'ok');
    }

    const yes = await askConfirm({
      title: 'Remove this copy?',
      body: `This deletes the copy ${named}. It is a copy of saved data this app could not read, so `
        + 'there is nothing else to recover it from. Download it first if you are not sure.',
      confirmLabel: 'Remove copy',
    });
    if (!yes) return;
    const gone = store.forgetSalvage(key);
    renderSalvage();
    notify('#salvage-report', gone
      ? `Removed the copy ${named}, freeing about ${salvageKb(copy.chars)} KB.`
      : 'That copy could not be removed, so it is still being kept.', gone ? 'ok' : 'warn');
  });
}

// Deliberately not announced and not a live region. The only change here worth hearing is the one
// after Clear cached metadata, and that handler already speaks through notify(), so a live region
// on this element would say it twice. At boot it only resolves a placeholder nobody has asked
// about yet.
async function refreshCacheUsage() {
  try {
    const u = await cache.usage();
    $('#cache-usage').textContent = u.count
      ? `${u.count} cached responses, about ${(u.bytes / 1024 / 1024).toFixed(2)} MB of a ${(u.budget / 1024 / 1024).toFixed(0)} MB budget.`
      : 'Nothing cached yet.';
  } catch {
    $('#cache-usage').textContent = 'Cache unavailable in this browser. The app still works, just with more network requests.';
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

// ------------------------------------------------------------------ render

function renderAll() {
  renderRail();
  renderReading();
  renderHome();
  renderLibraryHub();
  renderProgress();
  renderLibrary();
  renderQueue();
  for (const target of document.querySelectorAll('.add-target')) {
    target.textContent = addDestination();
  }
  // Kept in renderAll so the banner cannot go stale. In particular a successful restore
  // clears the block, and leaving the banner up would push the user toward "Start fresh",
  // which would then wipe the backup they had just restored.
  renderBlocked();
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
  void runAutomaticUpdateCheck();

  store.load();
  applyCoversSetting();
  applyUpdateCheckSetting();
  applyThemeSetting();
  ensurePublishingViews();
  wireSidebar();
  wireNav();
  wireReading();
  wireIssueFocus();
  wireAdd();
  wireData();
  wireSalvage();
  wireShortcuts();
  wireBlockedBanner();
  for (const shelf of CATALOG_SHELVES) wireCatalogShelfSearch(shelf.key);
  wireHome();
  wirePreview();
  wireAsk();
  wireProgressScope();
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
  if (bootRoute) applyRoute(bootRoute, { focus: false, filterIfAbsent: filter });
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
  showStoredUpdateResult({ announceReport: false, notice: true });
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

// Below this, the rows are rendered in one run with no headings. The library groupings are derived
// buckets rather than states: by date read, and by first letter. On a short collection they degrade
// into a heading per row, which is not a grouping, it is the same list with twice the vertical
// space and a count of 1 printed beside every entry. Measured on the hand-added view with four
// entries: four headings, four counts, all of them 1. The progress groupings are deliberately not
// subject to this, because there the group is the state itself and "Not started" is worth saying
// about one series.
const GROUP_MIN = 12;

// Keyed by the view value for the library, and by "scope:listId" for progress, which cannot
// collide because a library value is never of that shape. The count is not persisted: a fresh
// visit to a long list starts at the cap, which is the honest default for a glance.
const listShown = new Map();

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
function moreButton(key, rest, rerender) {
  return el('button', {
    type: 'button',
    class: 'btn btn-g',
    dataset: { act: 'more', key },
    text: `Show ${Math.min(LIBRARY_CAP, rest).toLocaleString()} more`,
    onclick: () => {
      listShown.set(key, (listShown.get(key) ?? LIBRARY_CAP) + LIBRARY_CAP);
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

// One progress row. The chip repeats what the bar and figures already imply, for a reader scanning
// rather than reading each line, and it names the two ends the bar cannot: a full bar could be a
// series finished or one issue of one tracked, and an empty one could be nothing read or nothing
// tracked. An active row gets no chip, because its bar is between the ends and already says so. The
// word is "Fully read" not "Finished": a series is not a fixed list, so the app cannot claim it ends.
function progressRow(r, state) {
  const pct = r.tracked ? Math.round((r.read / r.tracked) * 100) : 0;
  const chip = state === 'done'
    ? [' ', el('span', { class: 'badge badge-done' }, [el('span', { 'aria-hidden': 'true', text: '✓' }), ' Fully read'])]
    : state === 'unstarted'
      ? [' ', el('span', { class: 'badge badge-none', text: 'Not started' })]
      : [];
  return el('div', { class: 'result' }, [
    el('div', { class: 'result-main' }, [
      el('div', { class: 'result-title' }, [el('span', { text: r.seriesName }), ...chip]),
      el('div', { class: 'result-meta', text: `${r.read} of ${r.tracked} tracked issues read (${pct}%)` }),
    ]),
    el('progress', { max: String(Math.max(1, r.tracked)), value: String(r.read) }),
  ]);
}

// ------------------------------------------------------------------ landing page order tiles

// A restrained three cover mosaic, then the name, bar, count and a state word. The mosaic is
// recognition rather than information, so it is aria-hidden and the tile's own name carries every
// word. Always three cells, so a tile does not change height with the data: a list of fewer than
// three issues, or covers switched off, shows the fallback tile in the spare cells rather than a gap.
function yoursTile(list, state, read, total, count) {
  const pct = total ? (read / total) * 100 : 0;
  const ids = list.itemIds.slice(0, 3);
  const cells = [0, 1, 2].map((i) => {
    const issue = state.issues[ids[i]] ?? null;
    const img = el('img', { class: 'mosaic-i', alt: '', loading: 'lazy', decoding: 'async' });
    const fb = el('span', { class: 'mosaic-f cover-fallback' });
    // paintCover tolerates a null issue and a coverless one alike, yielding no URL for both, which is
    // the no-cover state a spare cell needs: it hides the image and shows the fallback tile instead.
    paintCover(img, fb, issue, 'portrait_incredible');
    return el('span', { class: 'mosaic-c' }, [img, fb]);
  });
  const cstate = completionState(read, total);
  return [
    el('span', { class: 'mosaic', 'aria-hidden': 'true' }, cells),
    el('span', { class: 'yours-name', text: list.name }),
    el('span', { class: 'pbar', 'aria-hidden': 'true' }, el('i', { style: { width: `${pct.toFixed(1)}%` } })),
    el('span', { class: 'yours-count', text: count }),
    el('span', { class: `badge${cstate === 'done' ? ' badge-done' : cstate === 'unstarted' ? ' badge-none' : ''}`, text: orderWord(cstate) }),
  ];
}

// The one line beside the shelf heading. orderStates is written as a middle dot separated sentence:
// the order count always, then each non-zero state, so a shelf of finished orders carries no zeroes.
// The span is created once and its text rewritten, because the heading it sits in is static markup
// the render leaves in place, and appending a fresh note on every render would stack them.
function writeYoursSummary(sec, state) {
  const head = sec.querySelector('.sec-h');
  const note = head.querySelector('.sec-note') ?? head.appendChild(el('span', { class: 'sec-note' }));
  const s = orderStates(state.listOrder.map((id) => listProgress(state, id)));
  const parts = [`${s.orders} ${s.orders === 1 ? 'order' : 'orders'}`];
  if (s.active) parts.push(`${s.active} in progress`);
  if (s.done) parts.push(`${s.done} finished`);
  if (s.unstarted) parts.push(`${s.unstarted} not started`);
  note.textContent = parts.join(' · ');
}

// The full order summary in its <summary>, on screen whether or not the order is open. An empty
// order is said plainly rather than as "0 of 0 read", which reads as a fault, not as the fact it is.
// The unread half used to be spelled out beside the read half. It is the same fact subtracted, and
// this line is the fifth place on the screen that the same fact appears, so it says one of them.
function writeFullSummary(all, unread) {
  const total = all.length;
  $('#full-action').textContent = $('#full').open
    ? 'Hide full Reading List'
    : `View all ${total} issue${total === 1 ? '' : 's'}`;
  $('#full-count').textContent = !total ? 'No issues yet' : unread ? `${unread} unread` : 'All read';
}

// A quiet row above the reading filters: a bar for the whole order and its percentage, and, when a
// filter is set, how much of the order it is showing. The percentage is of the whole order and not
// of the filtered rows, for the same reason a collected-edition heading counts its whole run: a
// figure that changes meaning when a filter is set is a second filter the reader never chose. The
// node is built once and its children rewritten, because it sits outside the container
// preservingFocus watches and holds nothing focusable, so an insert on every render would be churn.
function writeOrderStrip(details, all, activeFilter) {
  const filters = details.querySelector('#reading-filters');
  let strip = details.querySelector('.order-strip');
  if (!strip) strip = details.insertBefore(el('div', { class: 'order-strip' }), filters);
  const total = all.length;
  // No denominator when the order is empty: the percentage would be NaN, and the summary above
  // already says "No issues yet", which is the whole of what there is to say.
  if (!total) { strip.hidden = true; return; }
  strip.hidden = false;
  const read = all.filter((it) => it.read).length;
  const pct = Math.round((read / total) * 100);
  const children = [
    el('span', { class: 'pbar', 'aria-hidden': 'true' }, el('i', { style: { width: `${pct}%` } })),
    el('span', { class: 'order-pct', text: `${pct}% read` }),
  ];
  // The all-issues filter is removed rather than left saying something trivially true.
  if (activeFilter !== DEFAULT_FILTER) {
    const shown = all.filter((it) => matchesReadingFilter(activeFilter, it)).length;
    children.push(el('span', { class: 'order-shown', text: `Showing ${shown} of ${total} issues.` }));
  }
  strip.replaceChildren(...children);
}

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
