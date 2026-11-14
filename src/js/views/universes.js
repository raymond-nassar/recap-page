import { BROWSE_ONLY_UNIVERSE_ID, DEFAULT_UNIVERSE_SORT, UNIVERSE_SORTS } from '../lib/universes.js';
import { formatRoute, isPlainNavigation } from '../lib/route.js';

export function createUniversesView({
  el, elements, resolver, loadCatalog, isCurrent, onNavigate, onIndexChange, onRetry, presentation, listCover,
  announce, issueFocusAnchor, loadSeriesIndex, onSeries, savedIssue,
  setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let universeQuery = '';
  let universeSort = DEFAULT_UNIVERSE_SORT;
  let universeId = null;
  let generation = 0;
  let announceTimer = null;
  let seriesReady = null;

  function setIndex(route = {}) {
    universeQuery = typeof route.universeQuery === 'string' ? route.universeQuery : '';
    universeSort = UNIVERSE_SORTS.includes(route.universeSort) ? route.universeSort : DEFAULT_UNIVERSE_SORT;
  }

  function setDetail(id) {
    universeId = id;
  }

  function universeLink(universe, className = 'catalog-card-preview') {
    return el('a', {
      href: formatRoute({ view: 'universe', universeId: universe.id }),
      class: className,
      dataset: { universeId: universe.id },
      onclick: (event) => {
        if (!isPlainNavigation(event)) return;
        event.preventDefault();
        onNavigate(universe.id, event.currentTarget);
      },
    }, universe.name);
  }

  function indexCard(universe) {
    const meta = [universe.earth, String(universe.firstPublished)].filter(Boolean).join(' · ');
    return el('article', { class: 'catalog-card universe-card' }, [
      el('div', { class: 'catalog-card-main' }, [
        el('div', { class: 'catalog-card-text' }, [
          el('h2', { class: 'catalog-card-title' }, universeLink(universe)),
          el('p', { class: 'catalog-card-meta', text: meta }),
          el('p', { class: 'catalog-card-desc', text: universe.description }),
        ]),
      ]),
    ]);
  }

  function renderIndex({ announceChange = false } = {}) {
    clearTimer(announceTimer);
    announceTimer = null;
    const nodes = elements().index;
    nodes.query.value = universeQuery;
    nodes.sort.value = universeSort;
    const matches = resolver.sortUniverses(resolver.searchUniverses(universeQuery), universeSort);
    nodes.count.textContent = matches.length
      ? `${matches.length} ${matches.length === 1 ? 'universe' : 'universes'}`
      : 'No universes match. Clear or change your search.';
    nodes.results.replaceChildren(...matches.map(indexCard));
    if (announceChange) {
      announceTimer = setTimer(() => {
        announceTimer = null;
        if (isCurrent('universes')) announce(nodes.count.textContent);
      }, 500);
    }
  }

  function searchRow(universe) {
    const meta = [universe.earth, String(universe.firstPublished)].filter(Boolean).join(' · ');
    return el('article', { class: 'result search-row' }, [
      el('div', { class: 'result-main' }, [
        el('h3', { class: 'result-title' }, universeLink(universe, 'result-title-link universe-target')),
        el('p', { class: 'result-meta', text: meta }),
      ]),
    ]);
  }

  async function renderSeries(nodes, relations, current) {
    nodes.series.hidden = relations.length === 0;
    nodes.seriesResults.replaceChildren();
    nodes.seriesRetry.hidden = true;
    if (!relations.length) return;
    nodes.seriesStatus.textContent = 'Loading series...';
    try {
      const index = await loadSeriesIndex();
      if (!current()) return;
      const rows = relations.flatMap(({ seriesId, scope }) => {
        const entry = index.entries.find((candidate) => candidate.id === seriesId);
        if (!entry) return [];
        return [el('div', { class: 'result' }, [
          el('div', { class: 'result-main' }, [
            el('a', {
              class: 'result-title result-title-link universe-target',
              href: formatRoute({ view: 'add-series', seriesId }),
              dataset: { seriesId },
              onclick: (event) => {
                if (!isPlainNavigation(event)) return;
                event.preventDefault();
                onSeries(seriesId, event.currentTarget);
              },
            }, entry.name),
            el('p', {
              class: 'result-meta',
              text: scope === 'selected-issues' ? 'Selected comics appear in this universe.' : 'Set in this universe.',
            }),
          ]),
        ])];
      });
      nodes.seriesResults.replaceChildren(...rows);
      const missing = relations.length - rows.length;
      nodes.seriesStatus.textContent = missing
        ? `${missing} associated ${missing === 1 ? 'series is' : 'series are'} missing from the local index.`
        : '';
    } catch (error) {
      if (!current()) return;
      nodes.seriesStatus.textContent = `Series details could not be loaded (${error.message}). Use Retry series when the local app connection is available.`;
      nodes.seriesRetry.hidden = false;
    }
  }

  function renderDebut(nodes, universe) {
    const debut = universe.debutIssue;
    nodes.debut.replaceChildren(debut.issueId
      ? issueFocusAnchor(debut, {
        surface: 'universe-debut', className: 'universe-target', children: debut.title,
      })
      : debut.title);
  }

  function renderComics(nodes, universe) {
    const debut = universe.debutIssue;
    const ids = resolver.getUniverseIssueIds(universe.id).filter((id) => id !== debut.issueId);
    nodes.comics.hidden = ids.length === 0;
    nodes.comicsResults.replaceChildren(...ids.map((issueId) => {
      const issue = savedIssue(issueId) ?? resolver.getDebutIssue(issueId) ?? { issueId };
      return el('div', { class: 'result' }, [
        el('div', { class: 'result-main' }, [
          issueFocusAnchor(issue, {
            surface: 'universe-comic',
            className: 'result-title result-title-link universe-target',
            children: issue.title || `Comic details (ID ${issueId})`,
          }),
        ]),
      ]);
    }));
  }

  async function renderDetail({ refresh = false } = {}) {
    const id = universeId;
    const mine = ++generation;
    const current = () => mine === generation && universeId === id && isCurrent('universe');
    const nodes = elements().detail;
    const universe = resolver.getUniverse(id);
    nodes.heading.textContent = universe?.name ?? 'Universe not found';
    nodes.missing.hidden = Boolean(universe);
    nodes.body.hidden = !universe;
    const browseOnly = id === BROWSE_ONLY_UNIVERSE_ID;
    nodes.browse.hidden = !browseOnly;
    nodes.listsSection.hidden = browseOnly;
    nodes.results.replaceChildren();
    nodes.retry.hidden = true;
    nodes.emptyLink.hidden = true;
    nodes.series.hidden = true;
    nodes.comics.hidden = true;
    seriesReady = null;
    if (!universe) return;

    nodes.earth.textContent = universe.earth ?? 'Named reality';
    nodes.year.textContent = String(universe.firstPublished);
    renderDebut(nodes, universe);
    nodes.description.textContent = universe.description;
    if (browseOnly) {
      nodes.seriesResults.replaceChildren();
      nodes.comicsResults.replaceChildren();
      seriesReady = Promise.resolve();
      return;
    }
    renderComics(nodes, universe);
    const series = renderSeries(nodes, resolver.getUniverseSeries(id), current);
    seriesReady = series;
    nodes.status.textContent = 'Loading Reading Lists...';

    try {
      const catalog = await loadCatalog({ refresh });
      if (!current()) return;
      const relations = resolver.getUniverseLists(id, catalog.lists);
      const rows = relations.map(({ list, ...relation }) => el('div', { class: 'universe-list' }, [
        presentation.catalogRow(list, { report: '#universe-report', level: 'h3', cover: listCover }),
        presentation.universeRelationLine(relation, { showUniverse: false }),
      ]));
      nodes.results.replaceChildren(...rows);
      const count = relations.length
        ? `${relations.length} ${relations.length === 1 ? 'Reading List' : 'Reading Lists'}.`
        : catalog.dropped
          ? 'No matching Reading Lists could be confirmed.'
          : 'No Reading Lists are associated with this universe yet.';
      nodes.status.textContent = catalog.dropped
        ? `${count} ${catalog.dropped} incomplete catalog ${catalog.dropped === 1 ? 'entry was' : 'entries were'} omitted, so these results may be incomplete.`
        : count;
      nodes.retry.hidden = !catalog.dropped;
      nodes.emptyLink.hidden = relations.length > 0 || Boolean(catalog.dropped);
    } catch (error) {
      if (!current()) return;
      nodes.status.textContent = `Reading Lists could not be loaded: ${error.message}. Your saved lists are unchanged.`;
      nodes.retry.hidden = false;
    }
    await series;
  }

  function wire() {
    const nodes = elements();
    nodes.index.form.addEventListener('submit', (event) => event.preventDefault());
    nodes.index.query.addEventListener('input', () => {
      universeQuery = nodes.index.query.value;
      renderIndex({ announceChange: true });
      onIndexChange();
    });
    nodes.index.sort.addEventListener('change', () => {
      universeSort = UNIVERSE_SORTS.includes(nodes.index.sort.value)
        ? nodes.index.sort.value : DEFAULT_UNIVERSE_SORT;
      renderIndex({ announceChange: true });
      onIndexChange();
    });
    nodes.detail.retry.addEventListener('click', () => {
      onRetry();
      return renderDetail({ refresh: true });
    });
    nodes.detail.seriesRetry.addEventListener('click', () => {
      onRetry();
      return renderDetail();
    });
  }

  return {
    wire, setIndex, setDetail, renderIndex, renderDetail, searchRow,
    indexState: () => ({ universeQuery, universeSort }),
    detailId: () => universeId,
    seriesReady: () => seriesReady,
    selected: () => resolver.getUniverse(universeId),
  };
}
