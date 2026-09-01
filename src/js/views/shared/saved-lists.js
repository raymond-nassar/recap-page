import {
  completionState,
  listProgress,
  orderStates,
  orderWord,
} from '../../lib/model.js';
import { labelledName } from '../../lib/accname.js';

export function createSavedListsPresenter({
  el,
  getState,
  openList,
  paintCover,
}) {
  function tile(list, state, read, total, count) {
    const pct = total ? (read / total) * 100 : 0;
    const cells = [0, 1, 2].map((index) => {
      const issue = state.issues[list.itemIds[index]] ?? null;
      const img = el('img', { class: 'mosaic-i', alt: '', loading: 'lazy', decoding: 'async' });
      const fallback = el('span', { class: 'mosaic-f cover-fallback' });
      paintCover(img, fallback, issue, 'portrait_incredible');
      return el('span', { class: 'mosaic-c' }, [img, fallback]);
    });
    const stateKey = completionState(read, total);
    return [
      el('span', { class: 'mosaic', 'aria-hidden': 'true' }, cells),
      el('span', { class: 'yours-name', text: list.name }),
      el('span', { class: 'pbar', 'aria-hidden': 'true' },
        el('i', { style: { width: `${pct.toFixed(1)}%` } })),
      el('span', { class: 'yours-count', text: count }),
      el('span', {
        class: `badge${stateKey === 'done' ? ' badge-done' : stateKey === 'unstarted' ? ' badge-none' : ''}`,
        text: orderWord(stateKey),
      }),
    ];
  }

  function tiles(state) {
    return state.listOrder.map((id) => {
      const list = state.lists[id];
      const { read, total } = listProgress(state, id);
      const count = `${read} / ${total}`;
      const context = `issues read, ${orderWord(completionState(read, total))}. Open this list`;
      return el('li', {}, el('button', {
        type: 'button',
        'aria-label': labelledName(`${list.name} ${count}`, context),
        onclick: () => openList(id),
      }, tile(list, state, read, total, count)));
    });
  }

  function writeSummary(section, state) {
    const head = section.querySelector('.sec-h');
    const note = head.querySelector('.sec-note')
      ?? head.appendChild(el('span', { class: 'sec-note' }));
    const summary = orderStates(state.listOrder.map((id) => listProgress(state, id)));
    const parts = [`${summary.orders} ${summary.orders === 1 ? 'order' : 'orders'}`];
    if (summary.active) parts.push(`${summary.active} in progress`);
    if (summary.done) parts.push(`${summary.done} finished`);
    if (summary.unstarted) parts.push(`${summary.unstarted} not started`);
    note.textContent = parts.join(' · ');
  }

  function render(section, results) {
    const state = getState();
    section.hidden = state.listOrder.length === 0;
    if (section.hidden) return;
    writeSummary(section, state);
    results.replaceChildren(...tiles(state));
  }

  return { render };
}
