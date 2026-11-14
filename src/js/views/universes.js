import { DEFAULT_UNIVERSE_SORT, UNIVERSE_SORTS } from '../lib/universes.js';
import { formatRoute, isPlainNavigation } from '../lib/route.js';

export function createUniversesView({
  el, elements, resolver, loadCatalog, isCurrent, onNavigate, onIndexChange, onRetry, presentation, listCover,
}) {
  let universeQuery = '';
  let universeSort = DEFAULT_UNIVERSE_SORT;
  let universeId = null;
  let generation = 0;

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
        onNavigate(universe.id);
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

  function renderIndex() {
    const nodes = elements().index;
    nodes.query.value = universeQuery;
    nodes.sort.value = universeSort;
    const matches = resolver.sortUniverses(resolver.searchUniverses(universeQuery), universeSort);
    nodes.count.textContent = matches.length
      ? `${matches.length} ${matches.length === 1 ? 'universe' : 'universes'}`
      : 'No universes match. Clear or change your search.';
    nodes.results.replaceChildren(...matches.map(indexCard));
  }

  function searchRow(universe) {
    const meta = [universe.earth, String(universe.firstPublished)].filter(Boolean).join(' · ');
    return el('article', { class: 'result search-row' }, [
      el('div', { class: 'result-main' }, [
        el('h3', { class: 'result-title' }, universeLink(universe, 'result-title-link')),
        el('p', { class: 'result-meta', text: meta }),
      ]),
    ]);
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
    nodes.results.replaceChildren();
    nodes.retry.hidden = true;
    nodes.emptyLink.hidden = true;
    if (!universe) return;

    nodes.earth.textContent = universe.earth ?? 'Named reality';
    nodes.year.textContent = String(universe.firstPublished);
    nodes.debut.textContent = universe.debutIssue.title;
    nodes.description.textContent = universe.description;
    nodes.status.textContent = 'Loading Reading Lists...';

    try {
      const catalog = await loadCatalog({ refresh });
      if (!current()) return;
      const relations = resolver.getUniverseLists(id, catalog.lists);
      const rows = relations.map(({ list, kind, note }) => el('div', { class: 'universe-list' }, [
        presentation.catalogRow(list, { report: '#universe-report', level: 'h3', cover: listCover }),
        ...(kind === 'related-realities'
          ? [el('p', { class: 'rail-hint universe-list-note', text: `Related realities: ${note}` })]
          : []),
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
  }

  function wire() {
    const nodes = elements();
    nodes.index.form.addEventListener('submit', (event) => event.preventDefault());
    nodes.index.query.addEventListener('input', () => {
      universeQuery = nodes.index.query.value;
      renderIndex();
      onIndexChange();
    });
    nodes.index.sort.addEventListener('change', () => {
      universeSort = UNIVERSE_SORTS.includes(nodes.index.sort.value)
        ? nodes.index.sort.value : DEFAULT_UNIVERSE_SORT;
      renderIndex();
      onIndexChange();
    });
    nodes.detail.retry.addEventListener('click', () => {
      onRetry();
      return renderDetail({ refresh: true });
    });
  }

  return {
    wire, setIndex, setDetail, renderIndex, renderDetail, searchRow,
    indexState: () => ({ universeQuery, universeSort }),
    detailId: () => universeId,
    selected: () => resolver.getUniverse(universeId),
  };
}
