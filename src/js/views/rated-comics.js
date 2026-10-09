import { foldName } from '../lib/nameIndex.js';
import {
  characterOptions,
  filterRatedComics,
  ratedComics,
  sortRatedComics,
  topRatedComics,
} from '../lib/ratedComics.js';
import { normalizeRatedRoute } from '../lib/route.js';

const VIEW = 'library-rated';
const GUIDES_INLINE = 3;

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;
const filterKey = ({ min, q, character, sort }) => JSON.stringify([min, foldName(q), foldName(character), sort]);

// The Library's view of individual ratings: a short Top-rated shelf on the hub and a full browser
// at #/library-rated. Both read saved state on every paint, so a rating changed anywhere, restored
// from a backup or rolled back after a failed save shows here without a reload. Nothing in this
// module writes reader data; its own memory is the committed filter set and the reveal counts,
// both of which live only for the document.
export function createRatedComicsView({
  el,
  elements,
  emptyAction,
  getState,
  isBlocked = () => false,
  issueFocusAnchor,
  listUi,
  paintCover,
  preservingFocus,
  seriesOnly,
  announce = () => {},
  loader,
  focusViewHeading = () => {},
  matchingIssueOpener = () => null,
  onCommit = () => {},
  nextFrame = (fn) => globalThis.requestAnimationFrame(fn),
  doc = globalThis.document,
}) {
  let committed = normalizeRatedRoute({});
  // Bumped on every committed filter change. A guide request or a pending focus return that began
  // under an older value may still finish, but it settles against the current filters only.
  let generation = 0;
  let indexState = loader?.loaded ? 'ready' : 'idle';
  let pendingAnnounce = null;
  let ticket = null;
  let last = { rows: [], key: '' };
  let wired = false;
  const shownByKey = new Map();

  // The pending return is a promise to put the reader back on the comic they opened, made only
  // while they have not done anything else. Route generation alone was not enough: a reader who
  // starts typing a new title filter while the guide data is still loading has moved on, and
  // focusing a row then would pull them out of the field mid-word. Any deliberate input withdraws
  // it. Focus events are not listened for, because the arrival's own heading focus fires them.
  if (doc?.addEventListener) {
    const withdraw = () => { ticket = null; };
    for (const type of ['pointerdown', 'keydown', 'input']) doc.addEventListener(type, withdraw, true);
  }

  function row(data, surface) {
    const issue = data.issue ?? { issueId: data.issueId, title: data.title };
    const img = el('img', { class: 'rcov-i', alt: '', loading: 'lazy', decoding: 'async' });
    const fallback = el('div', { class: 'rcov-f cover-fallback', 'aria-hidden': true });
    paintCover(img, fallback, issue, 'portrait_incredible');
    const meta = [
      data.seriesName ? seriesOnly(data.seriesName) : null,
      data.known ? null : 'Details not saved',
    ].filter(Boolean).join(' \u00b7 ');
    const anchor = issueFocusAnchor(issue, {
      surface,
      className: 'result result-cov result-focus',
      children: [
        el('div', { class: 'rcov' }, [img, fallback]),
        el('div', { class: 'result-main' }, [
          el('div', { class: 'result-title', text: data.title }),
          el('div', { class: 'result-meta' }, [
            el('span', { class: 'rated-score' }, [
              el('span', { 'aria-hidden': 'true', text: `${data.score}/5` }),
              el('span', { class: 'visually-hidden', text: `Your rating: ${data.score} out of 5` }),
            ]),
            ...(meta ? [' \u00b7 ', el('span', { text: meta })] : []),
          ]),
        ]),
      ],
    });
    if (!data.guides?.length) return anchor;
    return el('div', { class: 'library-issue' }, [anchor, guideLine(data.guides)]);
  }

  // Outside the link, because a disclosure inside an anchor is a control nested in a control.
  function guideLine(guides) {
    const names = guides.map((guide) => guide.name);
    if (names.length <= GUIDES_INLINE) {
      return el('p', { class: 'rated-guides', text: `In Character guide: ${names.join(', ')}` });
    }
    return el('details', { class: 'rated-guides' }, [
      el('summary', { text: `In ${names.length} Character guides, including ${names.slice(0, GUIDES_INLINE).join(', ')}` }),
      el('p', { text: names.join(', ') }),
    ]);
  }

  function renderShelf() {
    const { shelfStatus, shelfList } = elements();
    shelfList.replaceChildren();
    if (isBlocked()) {
      shelfStatus.textContent = 'Your ratings are not shown while your saved data needs recovery.';
      return;
    }
    const rows = ratedComics(getState());
    const top = topRatedComics(rows);
    if (!rows.length) {
      shelfStatus.textContent = 'Comics you rate from their Issue details will appear here.';
    } else if (!top.length) {
      shelfStatus.textContent = `None of your ${plural(rows.length, 'rated comic is', 'rated comics are')} at 4 stars or higher yet.`;
    } else {
      const qualifying = rows.filter((r) => r.score >= 4).length;
      shelfStatus.textContent = qualifying > top.length
        ? `Your ${top.length} highest of ${qualifying.toLocaleString()} comics rated 4 stars and up.`
        : `${plural(qualifying, 'comic', 'comics')} rated 4 stars and up.`;
      for (const data of top) shelfList.append(row(data, 'top-rated'));
    }
  }

  function wire() {
    if (wired) return;
    wired = true;
    const els = elements();
    els.form.addEventListener('submit', (event) => {
      event.preventDefault();
      commit({
        min: els.min.value === '' ? null : els.min.value,
        q: els.q.value,
        character: els.character.value,
        sort: els.sort.value,
      });
    });
    els.clear.addEventListener('click', () => commit({}));
  }

  function writeDrafts() {
    const els = elements();
    els.min.value = committed.min == null ? '' : String(committed.min);
    els.q.value = committed.q;
    els.sort.value = committed.sort;
    syncCharacterOptions(els.character, loader?.loaded, ratedComics(getState()), committed.character);
  }

  // Rebuilt only when the set of choices changes, so a reader holding the control open is not
  // disturbed by a background repaint. A value that is no longer offered stays selectable rather
  // than silently becoming "Any".
  function syncCharacterOptions(select, index, rows, value) {
    const labels = characterOptions(index, rows);
    if (value && !labels.some((label) => foldName(label) === foldName(value))) labels.push(value);
    const signature = labels.join('\n');
    if (select.dataset.signature !== signature) {
      select.dataset.signature = signature;
      select.replaceChildren(
        el('option', { value: '', text: 'Any character guide' }),
        ...labels.map((label) => el('option', { value: label, text: label })),
      );
    }
    select.value = value;
  }

  function commit(next) {
    committed = normalizeRatedRoute(next);
    generation += 1;
    ticket = null;
    pendingAnnounce = generation;
    writeDrafts();
    renderBrowser();
    onCommit();
  }

  function ensureIndex() {
    if (!loader) return;
    if (loader.loaded) { indexState = 'ready'; return; }
    if (indexState === 'loading' || indexState === 'error') return;
    indexState = 'loading';
    loader.load().then(
      () => { indexState = 'ready'; },
      () => { indexState = 'error'; },
    ).then(() => {
      if (!elements().panel.hidden) renderBrowser();
      settleTicket();
    });
  }

  function isStale(index) {
    if (!index || !committed.character) return false;
    const want = foldName(committed.character);
    return !index.guides.some((guide) => guide.characters.some((label) => foldName(label) === want));
  }

  function notice(text, action) {
    return el('div', { class: 'notice notice-warn' }, [
      el('p', { text }),
      el('button', { type: 'button', class: 'btn btn-g notice-act', dataset: { act: action.act }, text: action.label, onclick: action.run }),
    ]);
  }

  function renderBrowser() {
    wire();
    const els = elements();
    if (isBlocked()) {
      els.count.textContent = '';
      els.notice.replaceChildren();
      els.results.replaceChildren(el('div', { class: 'empty-state' }, [
        el('div', { class: 'empty-glyph', 'aria-hidden': 'true', text: '\u2606' }),
        el('p', { text: 'Your ratings cannot be shown until your saved data is recovered.' }),
        emptyAction({ label: 'Backup & settings', view: 'data' }),
      ]));
      return;
    }
    ensureIndex();
    const index = loader?.loaded ?? null;
    const all = ratedComics(getState());
    syncCharacterOptions(els.character, index, all, els.character.value || '');
    const stale = isStale(index);
    const result = filterRatedComics(all, stale ? { ...committed, character: '' } : committed, index);
    const notApplied = Boolean(committed.character) && !result.characterApplied;
    const rows = sortRatedComics(result.rows, committed.sort);
    const key = filterKey(committed);
    last = { rows, key };

    els.notice.replaceChildren();
    const retry = {
      act: 'retry',
      label: 'Retry',
      run: () => { indexState = 'idle'; renderBrowser(); focusViewHeading(VIEW); },
    };
    if (committed.character && indexState === 'error') {
      els.notice.append(notice('Character guide filter not applied. The Character guide data could not be loaded.', retry));
    } else if (indexState === 'error') {
      els.notice.append(notice('Character guide choices could not be loaded.', retry));
    } else if (stale) {
      els.notice.append(notice(`Character guide filter not applied. No reading guide uses "${committed.character}" now.`, {
        act: 'clear-character',
        label: 'Clear character filter',
        run: () => { commit({ ...committed, character: '' }); els.character.focus(); },
      }));
    } else if (notApplied) {
      els.notice.append(el('p', { class: 'rail-hint', text: 'Loading Character guide data.' }));
    }

    const filtered = committed.min != null || committed.q || (committed.character && !notApplied);
    let count = filtered
      ? `${rows.length.toLocaleString()} of ${plural(all.length, 'rated comic', 'rated comics')} match.`
      : `${plural(all.length, 'rated comic', 'rated comics')}.`;
    if (notApplied) count += ' This count reflects rating and title matches only.';
    if (result.unknownExcluded) {
      count += ` ${plural(result.unknownExcluded, 'rated comic has', 'rated comics have')} no saved title to search.`;
    }
    els.count.textContent = all.length ? count : '';

    let countLine = null;
    // preservingFocus only restores controls carrying data-act, and a result row has none. After a
    // reload the guide index lands after a Back has already focused the returned row, and its
    // re-render detached that row and left focus on the body in 2 of 6 runs measured here.
    const held = doc?.activeElement;
    const heldId = held?.dataset?.focusSource === 'rated-results' ? held.dataset.issueId : null;
    preservingFocus(els.results, () => {
      els.results.replaceChildren();
      if (!all.length) {
        els.results.append(el('div', { class: 'empty-state' }, [
          el('div', { class: 'empty-glyph', 'aria-hidden': 'true', text: '\u2606' }),
          el('p', { text: 'You have not rated any comics yet. Open a comic\u2019s Issue details to give it a score.' }),
          emptyAction({ label: 'Browse Reading Lists', view: 'catalog' }),
        ]));
        return;
      }
      if (!rows.length) {
        const byGuide = result.characterApplied && result.baseCount > 0;
        els.results.append(el('div', { class: 'empty-state' }, [
          el('div', { class: 'empty-glyph', 'aria-hidden': 'true', text: '\u2606' }),
          el('p', { text: byGuide ? 'No rated comics match this Character guide.' : 'No rated comics match these filters.' }),
        ]));
        return;
      }
      const shown = Math.min(shownByKey.get(key) ?? listUi.cap, rows.length);
      if (rows.length > listUi.cap) countLine = els.results.appendChild(listUi.shownLine(shown, rows.length));
      for (const data of rows.slice(0, shown)) els.results.append(row(data, 'rated-results'));
      if (shown < rows.length) {
        els.results.append(listUi.moreButton(key, rows.length - shown, renderBrowser, shownByKey));
      }
    }, { primary: 'more', fallback: () => countLine });
    if (heldId != null && !held.isConnected) {
      matchingIssueOpener({ surface: 'rated-results', issueId: heldId })?.focus({ preventScroll: true });
    }

    const settled = !(committed.character && indexState === 'loading');
    if (pendingAnnounce === generation && settled) {
      pendingAnnounce = null;
      announce(els.count.textContent || 'No rated comics.');
    }
  }

  // Reveals the batch holding the comic the reader opened, then focuses it, but only while the
  // pending return is still theirs to claim.
  function settleTicket() {
    if (!ticket) return;
    if (ticket.generation !== generation) { ticket = null; return; }
    if (committed.character && indexState === 'loading') return;
    const { opener } = ticket;
    const at = last.rows.findIndex((r) => r.issueId === Number(opener.issueId));
    if (at >= 0) {
      const needed = Math.ceil((at + 1) / listUi.cap) * listUi.cap;
      if (needed > (shownByKey.get(last.key) ?? listUi.cap)) {
        shownByKey.set(last.key, needed);
        renderBrowser();
      }
    }
    const held = ticket;
    nextFrame(() => {
      if (ticket !== held) return;
      ticket = null;
      const target = matchingIssueOpener(opener);
      if (target?.isConnected) target.focus();
      else elements().clear.focus();
    });
  }

  return {
    renderShelf,
    renderBrowser,
    committed: () => ({ ...committed }),
    setCommitted(rated) {
      const next = normalizeRatedRoute(rated);
      if (filterKey(next) !== filterKey(committed)) {
        generation += 1;
        ticket = null;
      }
      committed = next;
      writeDrafts();
    },
    restoreOpener(opener) {
      if (!opener || opener.view !== VIEW) return;
      ticket = { generation, opener };
      settleTicket();
    },
  };
}
