import {
  completionState,
  listProgress,
  orderStates,
  orderWord,
  deferredCount,
} from '../../lib/model.js';
import { shownName } from '../../lib/accname.js';
import { formatRoute, isPlainNavigation } from '../../lib/route.js';

export function createSavedListsPresenter({
  el,
  getState,
  openList,
  paintCover,
}) {
  function tile(list, state, read, total, count, status, detail) {
    const pct = total ? (read / total) * 100 : 0;
    const cells = [0, 1, 2].map((index) => {
      const issue = state.issues[list.itemIds[index]] ?? null;
      const img = el('img', { class: 'mosaic-i', alt: '', loading: 'lazy', decoding: 'async' });
      const fallback = el('span', { class: 'mosaic-f cover-fallback' });
      paintCover(img, fallback, issue, 'portrait_incredible');
      return el('span', { class: 'mosaic-c' }, [img, fallback]);
    });
    const stateKey = completionState(read, total);
    // White space between the pieces, which the tile's grid does not draw, keeps them separate words
    // for anything reading the tile's text, as the category cards do (#905).
    return [
      el('span', { class: 'mosaic', 'aria-hidden': 'true' }, cells),
      el('span', { class: 'yours-name', text: list.name }),
      ' ',
      el('span', { class: 'pbar', 'aria-hidden': 'true' },
        el('i', { style: { width: `${pct.toFixed(1)}%` } })),
      el('span', { class: 'yours-count', text: count }),
      ' ',
      el('span', {
        class: `badge${status ? ` ${status.className || ''}` : stateKey === 'done' ? ' badge-done' : stateKey === 'unstarted' ? ' badge-none' : ''}`,
        text: status?.text ?? orderWord(stateKey),
      }),
      ...(detail ? [' ', el('span', { class: 'yours-detail', text: detail })] : []),
    ];
  }

  function tiles(state, ids, options) {
    return ids.map((id) => {
      const list = state.lists[id];
      const { read, total } = listProgress(state, id);
      const deferred = deferredCount(state, id);
      const count = `${read} / ${total}${deferred ? `. ${deferred} deferred` : ''}`;
      const status = options.status?.(state, id);
      const detail = options.detail?.(state, id);
      const badge = status?.text ?? orderWord(completionState(read, total));
      return el('li', {}, el('a', {
        href: formatRoute({ view: 'read', listId: id }),
        // The tile's own text first, as shown, so the bare count it prints is followed rather than
        // interrupted by what it counts (#905).
        'aria-label': shownName([list.name, count, badge, detail],
          `${read} of ${total} issue${total === 1 ? '' : 's'} read. Open this list`),
        onclick: (event) => {
          if (!isPlainNavigation(event)) return;
          event?.preventDefault();
          openList(id);
        },
      }, tile(list, state, read, total, count, status, detail)));
    });
  }

  function writeSummary(section, state, ids, options) {
    const head = section.querySelector('.sec-h');
    const note = head.querySelector('.sec-note')
      ?? head.appendChild(el('span', { class: 'sec-note' }));
    if (options.summary) {
      note.textContent = options.summary(state, ids);
      return;
    }
    const summary = orderStates(ids.map((id) => listProgress(state, id)));
    // Counted in the app's own word for the thing (UX-25, #830).
    const parts = [`${summary.orders} ${summary.orders === 1 ? 'Reading List' : 'Reading Lists'}`];
    if (summary.active) parts.push(`${summary.active} in progress`);
    if (summary.done) parts.push(`${summary.done} finished`);
    if (summary.unstarted) parts.push(`${summary.unstarted} not started`);
    note.textContent = parts.join(' · ');
  }

  function render(section, results, options = {}) {
    const state = getState();
    const ids = options.ids ?? state.listOrder;
    section.hidden = ids.length === 0;
    if (section.hidden) return;
    writeSummary(section, state, ids, options);
    results.replaceChildren(...tiles(state, ids, options));
  }

  return { render };
}
