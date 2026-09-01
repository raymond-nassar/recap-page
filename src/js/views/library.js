import { LIBRARY_VIEWS } from '../lib/library.js';

const GROUP_MIN = 12;

export function createLibraryView({
  el,
  elements,
  emptyAction,
  getState,
  issueFocusAnchor,
  listUi,
  paintCover,
  preservingFocus,
  seriesOnly,
  views = LIBRARY_VIEWS,
}) {
  const shownByKey = new Map();

  function row(issue, view) {
    const meta = [
      issue.readAt ? `Read ${new Date(issue.readAt).toLocaleDateString()}` : null,
      issue.seriesName ? seriesOnly(issue.seriesName) : null,
      issue.lists.length ? `In ${issue.lists.join(', ')}` : 'In no list',
    ].filter(Boolean).join(' · ');

    const badge = view.markHandAdded && issue.source === 'manual'
      ? [' ', el('span', { class: 'badge badge-unknown' }, 'by hand')]
      : [];
    const img = el('img', { class: 'rcov-i', alt: '', loading: 'lazy', decoding: 'async' });
    const fallback = el('div', { class: 'rcov-f cover-fallback', 'aria-hidden': true });
    paintCover(img, fallback, issue, 'portrait_incredible');

    const contents = [
      el('div', { class: 'rcov' }, [img, fallback]),
      el('div', { class: 'result-main' }, [
        el('div', { class: 'result-title', text: issue.title }),
        el('div', { class: 'result-meta' }, [el('span', { text: meta }), ...badge]),
      ]),
    ];
    return view.value === 'library-read'
      ? issueFocusAnchor(issue, {
        surface: 'everything-read',
        className: 'result result-cov result-focus',
        children: contents,
      })
      : el('div', { class: 'result result-cov' }, contents);
  }

  function render() {
    const state = getState();
    for (const view of views) {
      const { heading, results } = elements(view);
      heading.textContent = view.label;
      const rows = view.select(state);
      let countLine = null;
      preservingFocus(results, () => {
        results.replaceChildren();
        if (!rows.length) {
          results.append(el('div', { class: 'empty-state' }, [
            el('div', { class: 'empty-glyph', 'aria-hidden': 'true', text: '☐' }),
            el('p', { text: view.empty }),
            ...(view.emptyAction ? [emptyAction(view.emptyAction)] : []),
          ]));
          return;
        }
        const shown = Math.min(shownByKey.get(view.value) ?? listUi.cap, rows.length);
        const slice = rows.slice(0, shown);
        results.append(el('p', { class: 'library-sort', text: view.sort }));
        results.append(listUi.summaryBand(view.summarise(rows)));
        if (rows.length > listUi.cap) {
          countLine = results.appendChild(listUi.shownLine(shown, rows.length));
        }
        if (rows.length < GROUP_MIN) {
          for (const issue of slice) results.append(row(issue, view));
        } else {
          for (const group of view.group(slice, Date.now())) {
            results.append(listUi.groupSection(group, (issue) => row(issue, view)));
          }
        }
        if (shown < rows.length) {
          results.append(listUi.moreButton(
            view.value,
            rows.length - shown,
            render,
            shownByKey,
          ));
        }
      }, { primary: 'more', fallback: () => countLine });
    }
  }

  return { render };
}
