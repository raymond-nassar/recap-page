import {
  progressGroups,
  progressSummary,
  seriesProgress,
} from '../lib/model.js';

export function createProgressView({
  el,
  elements,
  emptyAction,
  getActiveListId,
  getState,
  listUi,
  preservingFocus,
}) {
  // Scope follows the active list on every page load. Persisting it would carry an answer about one
  // reading session into another, unlike the reading filter that a reader uses across many days.
  let scope = 'list';
  const shownByKey = new Map();

  // A full bar only means every tracked issue was read, not that the series itself has ended.
  function progressRow(row, state) {
    const pct = row.tracked ? Math.round((row.read / row.tracked) * 100) : 0;
    const chip = state === 'done'
      ? [' ', el('span', { class: 'badge badge-done' }, [el('span', { 'aria-hidden': 'true', text: '✓' }), ' Fully read'])]
      : state === 'unstarted'
        ? [' ', el('span', { class: 'badge badge-none', text: 'Not started' })]
        : [];
    return el('div', { class: 'result' }, [
      el('div', { class: 'result-main' }, [
        el('div', { class: 'result-title' }, [el('span', { text: row.seriesName }), ...chip]),
        el('div', { class: 'result-meta', text: `${row.read} of ${row.tracked} tracked issues read (${pct}%)` }),
      ]),
      el('progress', { max: String(Math.max(1, row.tracked)), value: String(row.read) }),
    ]);
  }

  function wire() {
    for (const radio of elements().radios) {
      radio.addEventListener('change', () => {
        if (!radio.checked) return;
        scope = radio.value;
        render();
      });
    }
  }

  function render() {
    const state = getState();
    const activeId = getActiveListId();
    const list = state.lists[activeId];
    const {
      method,
      methodText,
      radios,
      results,
      scope: scopeControl,
    } = elements();
    // With no active list, list scope has no subject and would render the same empty result as all
    // lists. Hide the choice rather than presenting a disabled pill that looks interactive.
    const scoped = scope === 'list' && Boolean(list);
    scopeControl.hidden = !list;
    for (const radio of radios) radio.checked = radio.value === (scoped ? 'list' : 'all');
    methodText.textContent = scoped
      ? `This list counts the issues in “${list.name}”. Tracked means issues you added, not the size of each complete series.`
      : 'All lists counts each issue once, even when it appears in more than one list. Tracked means issues you added, not the size of each complete series.';

    const rows = scoped ? seriesProgress(state, activeId) : seriesProgress(state);
    method.hidden = rows.length === 0;
    // Expansion belongs to both the scope and active list, so changing either starts at the cap.
    const key = `${scope}:${activeId}`;
    let countLine = null;
    preservingFocus(results, () => {
      results.replaceChildren();
      if (!rows.length) {
        // Methodology explains a table. Without rows, the shared empty-state shape is the useful
        // answer and the disclosure stays hidden.
        results.append(el('div', { class: 'empty-state' }, [
          el('div', { class: 'empty-glyph', 'aria-hidden': 'true', text: '☐' }),
          el('p', { text: 'Nothing tracked yet.' }),
          emptyAction({ label: 'Browse Reading Lists', view: 'catalog' }),
        ]));
        return;
      }
      const shown = Math.min(shownByKey.get(key) ?? listUi.cap, rows.length);
      const slice = rows.slice(0, shown);
      const sum = progressSummary(rows);
      results.append(listUi.summaryBand([
        { figure: sum.series, label: 'series' },
        { figure: `${sum.read.toLocaleString()} of ${sum.tracked.toLocaleString()}`, label: 'tracked issues read' },
        { figure: sum.done, label: 'series fully read' },
      ]));
      if (rows.length > listUi.cap) {
        countLine = results.appendChild(listUi.shownLine(shown, rows.length));
      }
      for (const group of progressGroups(slice)) {
        results.append(listUi.groupSection(group, (row) => progressRow(row, group.key)));
      }
      if (shown < rows.length) {
        results.append(listUi.moreButton(key, rows.length - shown, render, shownByKey));
      }
    }, { primary: 'more', fallback: () => countLine });
  }

  return { render, wire };
}
