import {
  deleteList,
  duplicateList,
  isRead,
  listForCatalogId,
  listItems,
  listProgress,
  markRead,
  moveItem,
  pendingIssueIds,
  removeFromList,
  renameList,
  restoreList,
  setActive,
  setIssueNote,
  setListNote,
  setOverride,
  toggleRead,
  upNext,
  coverUrl,
} from '../lib/model.js';
import { availability, describe, localDayString, SHORT, STATE } from '../lib/availability.js';
import { labelledName } from '../lib/accname.js';
import { issuePresentation } from '../lib/issueFocus.js';
import { DEFAULT_FILTER, READING_FILTERS, matchesReadingFilter } from '../lib/readingFilters.js';
import { shortcutAllowed } from '../lib/shortcuts.js';

export const RING_CIRCUMFERENCE = 119.4; // 2πr for r=19, matching the SVG in index.html
const UNDO_DELETE = 'undo-delete';
const SHORT_LABEL = {
  [STATE.SCHEDULED]: 'scheduled',
  [STATE.UNKNOWN]: 'unknown',
  [STATE.OVERRIDE_AVAILABLE]: 'yours: available',
  [STATE.OVERRIDE_UNAVAILABLE]: 'yours: not in MU',
};

export function commitRows(container, desired) {
  const wanted = new Set(desired);
  for (const node of [...container.childNodes]) if (!wanted.has(node)) node.remove();
  let i = 0;
  for (const node of desired) {
    if (container.childNodes[i] !== node) container.insertBefore(node, container.childNodes[i] ?? null);
    i += 1;
  }
}

export function rowCacheKey(item, currentId, today, covers) {
  return `${JSON.stringify(item)}|${item.issueId === currentId}|${today}|${covers !== false}`;
}

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

function detailsBadge(el, item) {
  const state = detailsState(item);
  if (!state) return null;
  const { text, hint } = DETAILS_BADGE[state];
  return el('span', { class: `badge badge-${state}` }, [
    text,
    el('span', { class: 'visually-hidden', text: `. ${hint}` }),
  ]);
}

export function synopsisFallback(issue, sessionEntry = null, noSynopsisMarker = undefined) {
  if (typeof sessionEntry === 'string' && sessionEntry.trim()) return sessionEntry;
  if (sessionEntry === noSynopsisMarker || (noSynopsisMarker === undefined && sessionEntry != null && typeof sessionEntry !== 'string')) {
    return 'No synopsis is recorded for this issue.';
  }
  if (issue?.hydrated) return 'No synopsis is recorded for this issue.';
  if (issue?.detailsRefused) return DETAILS_BADGE.norecord.hint;
  return 'Details have not been fetched yet.';
}

export function createReadingView({
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
  getSettings,
  getState,
  getSynopsis,
  hydrationAnnouncement,
  isCurrent,
  isHydrationActive,
  isSynopsisActive,
  issueFocusAnchor,
  launch,
  noSynopsisMarker,
  notify,
  onCancelHydrate,
  onCancelSynopsis,
  onExportMarkdown,
  onHydrate,
  onStartSynopsis,
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
  updateState,
  withSaveEducation,
  ymd,
}) {
  // The hero is hidden when there is no next issue, but its heading stays non-empty so the
  // document never holds an invalid heading state. This must match the initial text in index.html.
  const HERO_NO_ISSUE = 'Nothing up next';
  const SHELF_SIZE = 8;

  let filter = DEFAULT_FILTER;
  let filterRunOpen = false;
  let filterRunBase = null;
  let filterRunAddressed = false;
  let filterAddressed = false;
  let applyingRouteToDisclosure = false;
  let lastDeleted = null;
  let rowCache = new Map();
  let rowCacheListId = null;
  let rowsPending = false;
  let arrowing = false;

  const dismissUndoDelete = { label: 'Dismiss', onClick: forgetDeleted };
  const giveUpUndoDelete = { label: 'Give up', onClick: forgetDeleted };

  function setFilter(next) {
    const wanted = READING_FILTERS.some((candidate) => candidate.value === next) ? next : DEFAULT_FILTER;
    if (wanted === filter) return;
    filter = wanted;
    getSettings().filter = wanted;
    saveSettings();
    const radio = [...document.querySelectorAll('input[name="filter"]')].find((entry) => entry.value === wanted);
    if (radio) radio.checked = true;
    renderRows();
  }

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

  function wire() {
    // Build this group once from the shared filter definitions. Rebuilding it with the rows would
    // destroy the active radio and drop keyboard focus, while accepting authored radios would let
    // the controls and predicates disagree.
    const stray = [...document.querySelectorAll('input[name="filter"]')];
    if (stray.length) {
      throw new Error(`The document holds reading filters (${stray.map((r) => r.value).join(', ')}). `
        + 'They are rendered from READING_FILTERS in src/js/lib/readingFilters.js; add it there instead.');
    }
    $('#reading-filters').append(...READING_FILTERS.map((option) => el('label', { class: 'fp' }, [
      el('input', { type: 'radio', name: 'filter', value: option.value }),
      el('span', { text: option.label }),
    ])));
    $('#save-education-settings').addEventListener('click', () => showView('data', { push: true }));

    // The toggle event can arrive after an already queued animation frame. Filling pending rows in
    // the click microtask keeps the opened disclosure ready for that frame; toggle still owns URL state.
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
    // Persisted settings are editable data and may name a filter removed by a later build, so only
    // a value represented by the current controls is admitted.
    const wanted = radios.find((radio) => radio.value === getSettings().filter);
    filter = wanted ? wanted.value : DEFAULT_FILTER;
    if (!wanted) {
      getSettings().filter = filter;
      saveSettings();
    }
    const active = radios.find((radio) => radio.value === filter);
    if (active) active.checked = true;

    for (const radio of radios) {
      radio.addEventListener('keydown', (e) => {
        if (e.key.startsWith('Arrow') && !e.ctrlKey && !e.altKey && !e.metaKey) arrowing = true;
      });
      radio.addEventListener('change', (e) => {
        if (arrowing) {
          if (!filterRunOpen) {
            filterRunBase = filter;
            filterRunAddressed = filterAddressed;
            filterRunOpen = true;
          }
          setFilter(e.target.value);
        } else {
          endFilterRun({ commit: true });
          setFilter(e.target.value);
          filterAddressed = true;
          syncHash({ push: true });
        }
        arrowing = false;
      });
    }

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
      const list = getState().lists[id];
      if (!list) return;
      const name = await askText({ title: 'Rename list', label: 'List name', value: list.name });
      if (!name) return;
      updateState((state) => renameList(state, id, name));
      announceIfSaved(`Renamed to ${name}.`);
    });

    $('#btn-list-note').addEventListener('click', async () => {
      const id = activeListId();
      const list = getState().lists[id];
      if (!list) return;
      const note = await askNote({
        title: `Note on "${list.name}"`,
        body: 'Only you see this. It is saved on this device and travels in your backup file.',
        label: 'Your note about this Reading List',
        value: list.note || '',
      });
      if (note === null) return;
      updateState((state) => setListNote(state, id, note));
      announceIfSaved(note ? 'Note saved.' : 'Note removed.');
    });

    $('#btn-delete-list').addEventListener('click', async () => {
      const id = activeListId();
      const list = getState().lists[id];
      if (!list) return;
      const yes = await askConfirm({
        title: `Delete "${list.name}"?`,
        body: 'Your read progress is kept, and only the list is removed. This can be undone.',
        confirmLabel: 'Delete list',
      });
      if (!yes) return;
      const deleted = { list, index: getState().listOrder.indexOf(id), wasActive: getState().active === id };
      const { ok } = updateState((state) => deleteList(state, id));
      if (!ok) return;
      offerUndoDelete(deleted);
    });
    $('#btn-duplicate-list').addEventListener('click', () => {
      const id = activeListId();
      const list = getState().lists[id];
      if (!list) return;
      let copyId = null;
      const { ok, state } = updateState((current) => {
        const result = duplicateList(current, id);
        copyId = result.listId;
        return result.state;
      });
      if (!ok || !copyId) {
        announce('That copy could not be saved, so nothing changed.');
        return;
      }
      updateState((current) => setActive(current, copyId));
      announceIfSaved(`Duplicated as ${state.lists[copyId].name}. You are now editing the copy, and read progress stays shared with the original.`);
    });

    $('#btn-export-md').addEventListener('click', onExportMarkdown);
    $('#btn-hydrate').addEventListener('click', () => onHydrate(activeListId()));
    $('#btn-cancel-hydrate').addEventListener('click', onCancelHydrate);
    $('#btn-synopsis').addEventListener('click', onStartSynopsis);
    $('#btn-cancel-synopsis').addEventListener('click', onCancelSynopsis);

    $('#btn-hero-read').addEventListener('click', (e) => {
      const issue = upNext(getState(), activeListId());
      if (issue) launch(issue, e);
    });
    $('#btn-hero-inspect').addEventListener('click', () => {
      const issue = upNext(getState(), activeListId());
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

  // Every notice under this key travels between views, so dismissal must withdraw both the notice
  // and its offer. A failed restore uses "Give up" because the buffer may be the only copy left.
  function offerUndoDelete(deleted) {
    lastDeleted = deleted;
    notify('#app-report', `Deleted ${deleted.list.name}. Reading progress was kept.`, 'ok', UNDO_DELETE, {
      label: 'Undo delete',
      onClick: undoDelete,
    }, dismissUndoDelete);
  }

  function forgetDeleted() {
    lastDeleted = null;
    clearNotice(UNDO_DELETE);
  }

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
    // Refuse both an exact ID collision and a catalog-equivalent list. Restoring either would make
    // navigation choose between two lists that claim the same source order.
    const blocker = getState().lists[list.id] ?? listForCatalogId(getState(), list.catalogId);
    if (blocker) {
      forgetDeleted();
      notify('#app-report', `${list.name} was not put back: ${blocker.name} is in your sidebar already.`, 'ok', UNDO_DELETE, null, dismissUndoDelete);
      return;
    }
    const { ok } = updateState((state) => restoreList(state, list, { index, active: wasActive }));
    if (!ok) {
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
    const issue = upNext(getState(), activeListId());
    if (!issue) return;
    const wasRead = isRead(getState(), issue.issueId);
    const { state } = updateState((current) => markRead(current, issue.issueId, true));
    const transition = recordDirectProgressSave({ wasRead, state, issueId: issue.issueId });
    if (!transition) return;
    const next = upNext(getState(), activeListId());
    announce(withSaveEducation(next
      ? `${issue.title} marked read. Next up: ${next.title}.`
      : `${issue.title} marked read. That is the whole order finished.`, transition));
    if (!next) $('#all-read-h').focus({ preventScroll: true });
  }

  function render() {
    const id = activeListId();
    const list = getState().lists[id];

    $('#reading-body').hidden = !list;
    $('#ring-wrap').hidden = !list;
    renderSaveEducation();

    if (!list) {
      $('#order-name').textContent = 'Recap Page';
      $('#order-sub').textContent = 'Curated Reading Lists, tracked locally, linked into the Unlimited reader.';
      if (isCurrent()) showView('home');
      return;
    }

    const { read, total } = listProgress(getState(), id);
    const seriesCount = new Set(
      list.itemIds.map((issueId) => getState().issues[issueId]?.seriesName).filter(Boolean),
    ).size;

    $('#order-name').textContent = list.name;
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
    const issue = upNext(getState(), id);
    const finished = !issue;

    $('#hero').hidden = finished;
    $('#all-read').hidden = !finished;
    $('#shelf-sec').hidden = finished;
    if (finished) {
      $('#hero-title').textContent = HERO_NO_ISSUE;
      return;
    }

    const override = getState().overrides[issue.issueId];
    const position = (getState().lists[id]?.itemIds.indexOf(issue.issueId) ?? -1) + 1;
    const total = getState().lists[id]?.itemIds.length ?? 0;
    const presentation = issuePresentation(issue, {
      override,
      position,
      total,
      description: synopsisFallback(issue, getSynopsis(issue.issueId), noSynopsisMarker),
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
  function renderShelf() {
    const id = activeListId();
    const shelf = $('#shelf');

    const upcoming = listItems(getState(), id).filter((item) => !item.read).slice(1, SHELF_SIZE + 1);
    $('#shelf-sec').hidden = upcoming.length === 0;
    $('#shelf-note').textContent = `${upcoming.length} ${upcoming.length === 1 ? 'issue' : 'issues'}`;

    preservingFocus(shelf, () => {
      shelf.replaceChildren();

      for (const item of upcoming) {
        const img = el('img', { alt: '', loading: 'lazy' });
        const fb = el('div', { class: 'tf cover-fallback', 'aria-hidden': true }, [
          el('span', { class: 's', text: seriesOnly(item.seriesName) }),
          el('span', { class: 'n', text: item.number ? `#${item.number}` : '?' }),
        ]);
        paintCover(img, fb, item, 'portrait_incredible');

        const short = shortTitle(item.title);
        const year = ymd(item.onSale).slice(0, 4);
        const label = [short, year].filter(Boolean).join(' ');
        const readContext = 'Open in Marvel Unlimited';
        const readName = labelledName(label, readContext);
        const context = { kind: 'list', id };

        shelf.append(el('li', { class: 'tile' }, [
          issueFocusAnchor(item, {
            context,
            surface: 'coming',
            className: 'tile-focus',
            children: [
              el('div', { class: 'ph' }, [img, fb]),
              el('div', { class: 'lab' }, [
                el('b', { text: short }),
                year,
              ]),
            ],
          }),
          el('button', {
            type: 'button',
            class: 'tile-read',
            title: `${label}: ${readContext}`,
            'aria-label': readName,
            dataset: { key: item.issueId, act: 'open' },
            onclick: (e) => launch(item, e),
          }, 'Read'),
        ]));
      }
    }, {
      primary: 'open',
      fallback: () => ($('#hero').hidden ? null : $('#btn-hero-done')),
    });
  }

  function renderRows() {
    const id = activeListId();
    const rows = $('#rows');
    if (id !== rowCacheListId) { rowCache = new Map(); rowCacheListId = id; }

    preservingFocus(rows, () => {
      const desired = [];
      const list = getState().lists[id];
      if (!list) { commitRows(rows, desired); return; }

      const all = listItems(getState(), id);
      const unread = all.length - all.filter((item) => item.read).length;
      // The summary stays visible while the order is closed, so its count must be current even when
      // the expensive row build below is deferred.
      writeFullSummary(all, unread);

      // A closed 219-row order has nothing to paint. Opening the native disclosure calls this again,
      // preserving output while avoiding hidden row construction on every progress update.
      if (!$('#full').open) { rowsPending = true; return; }
      rowsPending = false; writeOrderStrip($('#full'), all, filter);

      const currentId = upNext(getState(), id)?.issueId ?? null;
      // Read the local day once so every row in this pass is judged against one cacheable value.
      const today = localDayString();
      const items = all.filter((item) => matchesReadingFilter(filter, item));

      // Edition progress is computed from the full list, not the filtered subset, so the same book
      // does not report a different total when the reader changes filters.
      const runs = [];
      const runOf = new Map();
      for (const item of all) {
        const last = runs[runs.length - 1];
        if (last && last.name === item.collectedIn) {
          last.total += 1;
          if (item.read) last.read += 1;
        } else {
          runs.push({ name: item.collectedIn, total: 1, read: item.read ? 1 : 0 });
        }
        runOf.set(item.issueId, runs.length - 1);
      }
      const hasEditions = runs.some((run) => run.name);

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

        const rowKey = rowCacheKey(item, currentId, today, getSettings().covers);
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
              const wasRead = isRead(getState(), item.issueId);
              const { state } = updateState((current) => toggleRead(current, item.issueId));
              const transition = recordDirectProgressSave({
                wasRead,
                state,
                issueId: item.issueId,
              });
              if (transition) {
                announce(withSaveEducation(
                  `${item.title} ${isRead(state, item.issueId) ? 'marked read' : 'marked unread'}.`,
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
              el('span', { class: `badge ${badgeClass}` }, [
                `${SHORT[av.state]} ${av.state === STATE.EXPECTED ? 'Unlimited' : SHORT_LABEL[av.state] ?? 'unknown'}`,
                el('span', { class: 'visually-hidden', text: `. ${describe(item, { override, today })}.` }),
              ]),
              detailsBadge(el, item),
              item.source === 'manual' ? el('span', { class: 'badge badge-unknown' }, 'by hand') : null,
              ymd(item.onSale) ? el('span', { text: ymd(item.onSale) }) : null,
            ]),
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
      fallback: () => [...document.querySelectorAll('input[name="filter"]')].find((radio) => radio.checked),
    });
  }

  function writeFullSummary(all, unread) {
    const total = all.length;
    $('#full-action').textContent = $('#full').open
      ? 'Hide full Reading List'
      : `View all ${total} issue${total === 1 ? '' : 's'}`;
    $('#full-count').textContent = !total ? 'No issues yet' : unread ? `${unread} unread` : 'All read';
  }

  function writeOrderStrip(details, all, activeFilter) {
    const filters = details.querySelector('#reading-filters');
    let strip = details.querySelector('.order-strip');
    if (!strip) strip = details.insertBefore(el('div', { class: 'order-strip' }), filters);
    const total = all.length;
    if (!total) { strip.hidden = true; return; }
    strip.hidden = false;
    const read = all.filter((item) => item.read).length;
    const pct = Math.round((read / total) * 100);
    const children = [
      el('span', { class: 'pbar', 'aria-hidden': 'true' }, el('i', { style: { width: `${pct}%` } })),
      el('span', { class: 'order-pct', text: `${pct}% read` }),
    ];
    if (activeFilter !== DEFAULT_FILTER) {
      const shown = all.filter((item) => matchesReadingFilter(activeFilter, item)).length;
      children.push(el('span', { class: 'order-shown', text: `Showing ${shown} of ${total} issues.` }));
    }
    strip.replaceChildren(...children);
  }

  function cycleOverride(item) {
    const next = item.override === 'available' ? 'unavailable' : item.override === 'unavailable' ? null : 'available';
    updateState((state) => setOverride(state, item.issueId, next));
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
      el('button', { type: 'button', class: 'mini', 'aria-label': `Read ${item.title} in Marvel Unlimited`, dataset: { key: item.issueId, act: 'open' }, onclick: (e) => launch(item, e) }, 'Read'),
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
        onclick: () => updateState((state) => moveItem(state, listId, item.issueId, -1)),
      }, [
        el('span', { class: 'mini-icon', 'aria-hidden': true, text: '↑' }),
        el('span', { class: 'mini-label', text: 'Move up' }),
      ]),
      el('button', {
        type: 'button',
        class: 'mini has-tooltip',
        'aria-label': `Move ${item.title} down`,
        dataset: { key: item.issueId, act: 'down', tooltip: 'Move down' },
        onclick: () => updateState((state) => moveItem(state, listId, item.issueId, 1)),
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
          updateState((state) => removeFromList(state, listId, item.issueId));
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

  async function editIssueNote(item) {
    const note = await askNote({
      title: `Note on "${item.title}"`,
      body: 'Only you see this. It is saved on this device and travels in your backup file.',
      label: 'Your note about this issue',
      value: item.note || '',
    });
    if (note === null) return;
    updateState((state) => setIssueNote(state, item.issueId, note));
    announceIfSaved(note ? `Note saved on ${item.title}.` : `Note removed from ${item.title}.`);
  }

  function wireShortcuts() {
    document.addEventListener('keydown', (e) => {
      if (!isCurrent() || e.metaKey || e.ctrlKey || e.altKey) return;
      if ($('dialog[open]')) return;
      const target = document.activeElement;
      if (!shortcutAllowed(target, e.key)) return;
      if (!getState().lists[activeListId()]) return;

      if (e.key === 'Enter') {
        const issue = upNext(getState(), activeListId());
        if (!issue) return;
        e.preventDefault();
        launch(issue, e);
      } else if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        markCurrentRead();
      }
    });
  }
  function renderHydrateButton() {
    const pending = pendingIssueIds(getState()).length;
    $('#btn-hydrate').hidden = pending === 0 || isHydrationActive();
    $('#btn-hydrate').textContent = `Fetch details for ${pending} issue${pending === 1 ? '' : 's'}`;
    $('#btn-cancel-hydrate').hidden = !isHydrationActive();
  }

  function renderHydration(status) {
    const box = $('#hydration-status');
    const said = hydrationAnnouncement(status);
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

  function renderSynopsisButtons() {
    const list = getState().lists[activeListId()];
    const has = (list?.itemIds ?? []).length > 0;
    $('#btn-synopsis').hidden = !has || isSynopsisActive();
    $('#btn-cancel-synopsis').hidden = !isSynopsisActive();
  }

  function renderSynopsis(status) {
    const box = $('#synopsis-status');
    const said = synopsisAnnouncement(status);
    announceState('synopsis', said.state, said.msg);
    if (!status || status.phase === 'idle') { box.hidden = true; renderSynopsisButtons(); return; }
    box.hidden = false;
    box.textContent = synopsisStatusLine(status);
    renderSynopsisButtons();
    renderHero();
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

  function filterTraversalSnapshot({ push = false } = {}) {
    return {
      shown: filterRunOpen && !push ? filterRunBase : filter,
      showFilter: filterRunOpen && !push ? filterRunAddressed : filterAddressed,
    };
  }

  function invalidateRowCache() {
    rowCache = new Map();
    rowCacheListId = null;
    rowsPending = false;
  }

  return {
    currentFilter: () => filter,
    endFilterRun,
    filterTraversalSnapshot,
    forgetDeleted,
    forgetDeletedFor,
    hasRowsPending: () => rowsPending,
    invalidateRowCache,
    render,
    renderHero,
    renderHydration,
    renderRows,
    renderSynopsis,
    setFilter,
    setFilterAddressed: (value) => { filterAddressed = value; },
    setFullOrderFromRoute,
    wire,
    wireShortcuts,
  };
}
