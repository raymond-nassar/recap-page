import {
  CATALOG_SHELVES,
  catalogFacets,
  countStories,
  decadeSections,
  eraSections,
  facetLabel,
  filterByFacet,
  filterBySpotlightKind,
  groupCatalog,
  modernTimelineFeaturedCard,
  modernTimelineLists,
  pathPlacements,
  searchCatalog,
  shelfLists,
  sortSpotlightStories,
  spotlightKindLabel,
  spotlightSortLabel,
  visibleFirstStopGuides,
} from '../lib/catalog.js';

const FILTER_THRESHOLD = 12;

export function createCatalogView({
  announce,
  clearLoadNotice,
  el,
  elements,
  loadCatalog,
  notifyDropped,
  onLoadFailure,
  onSortChange,
  presentation,
}) {
  const stateByShelf = new Map(CATALOG_SHELVES.map((shelf) => [
    shelf.key,
    { facet: 'all', query: '', spotlight: 'all', sort: null },
  ]));
  const generationByShelf = new Map();
  let announceTimer = null;

  function announceResult(message) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => announce(message), 500);
  }

  function narrowingLabel(key, lists, state) {
    const labels = [];
    if (key === 'spotlights' && state.spotlight !== 'all') {
      labels.push(spotlightKindLabel(state.spotlight));
    }
    if (state.facet !== 'all') labels.push(facetLabel(lists, state.facet));
    return labels.length ? ` in ${labels.join(' and ')}` : '';
  }

  function renderFilters(key, lists, searchable) {
    const state = stateByShelf.get(key);
    const nodes = elements.shelf(key);
    const options = catalogFacets(lists);
    nodes.filters.hidden = !searchable || options.length < 2;
    if (nodes.filters.hidden) {
      state.facet = 'all';
      return;
    }
    if (state.facet !== 'all' && !options.some((candidate) => candidate.key === state.facet)) {
      state.facet = 'all';
    }
    const existing = [...nodes.filters.querySelectorAll(`input[name="${key}-category"]`)];
    if (existing.length === options.length
      && existing.every((radio, index) => radio.value === options[index].key)) {
      for (const radio of existing) radio.checked = radio.value === state.facet;
      return;
    }
    nodes.filters.replaceChildren(
      el('legend', { class: 'visually-hidden', text: 'Filter the catalog by category' }),
      ...options.map(({ key: facet, label, count }) => el('label', { class: 'fp' }, [
        el('input', {
          type: 'radio',
          name: `${key}-category`,
          value: facet,
          checked: facet === state.facet,
          onchange: () => {
            state.facet = facet;
            void render(key);
          },
        }),
        el('span', { text: `${label} (${count})` }),
      ])),
    );
  }

  function syncSpotlightControls() {
    const state = stateByShelf.get('spotlights');
    const checked = state.sort === 'popularity' ? 'popularity' : 'current-order';
    for (const radio of elements.spotlightSorts()) radio.checked = radio.value === checked;
  }

  async function render(key) {
    const generation = (generationByShelf.get(key) ?? 0) + 1;
    generationByShelf.set(key, generation);
    const shelf = CATALOG_SHELVES.find((candidate) => candidate.key === key);
    const state = stateByShelf.get(key);
    const nodes = elements.shelf(key);
    nodes.results.replaceChildren(el('p', { class: 'rail-hint', text: 'Loading the catalog…' }));
    clearLoadNotice();
    nodes.clear.hidden = !state.query;

    let catalog;
    try {
      catalog = await loadCatalog();
    } catch (error) {
      nodes.results.replaceChildren();
      nodes.filters.hidden = true;
      nodes.filters.replaceChildren();
      nodes.search.hidden = true;
      await onLoadFailure({
        error,
        key,
        retry: () => render(key),
        isCurrent: () => generation === generationByShelf.get(key),
      });
      return;
    }

    if (catalog.dropped) notifyDropped(key, catalog.dropped);
    if (key === 'catalog') {
      presentation.ensureSetupGuideFeature(catalog.lists, key, modernTimelineFeaturedCard);
    }

    const mine = key === 'catalog'
      ? modernTimelineLists(catalog.lists)
      : shelfLists(catalog.lists, key);
    nodes.results.replaceChildren();
    if (!mine.length) {
      nodes.filters.hidden = true;
      nodes.search.hidden = true;
      nodes.results.append(el('p', { class: 'rail-hint', text: shelf.empty }));
      return;
    }

    const searchable = countStories(mine) > FILTER_THRESHOLD;
    nodes.search.hidden = !searchable;
    if (!searchable && state.query) {
      state.query = '';
      nodes.query.value = '';
      nodes.clear.hidden = true;
    }
    renderFilters(key, mine, searchable);
    if (key === 'spotlights') syncSpotlightControls();

    const inSpotlight = key === 'spotlights'
      ? filterBySpotlightKind(mine, state.spotlight)
      : mine;
    const shown = searchCatalog(filterByFacet(inSpotlight, state.facet), state.query);
    const sortSentence = key === 'spotlights'
      ? ` Sorted by ${spotlightSortLabel(state.sort).toLowerCase()}.`
      : '';
    if (!shown.length) {
      const where = narrowingLabel(key, mine, state);
      const message = state.query
        ? `No Reading Lists match “${state.query}”${where}.`
        : `No Reading Lists${where || ' in that category'}.`;
      nodes.results.append(el('p', { class: 'rail-hint', text: message }));
      announceResult(`${message}${sortSentence}`);
      return;
    }

    const stories = key === 'spotlights'
      ? sortSpotlightStories(groupCatalog(shown), state.sort)
      : groupCatalog(shown);
    const placements = pathPlacements(catalog.paths, catalog.lists);
    const firstStops = visibleFirstStopGuides(stories, placements, presentation.chosenPath);
    if (firstStops.length) {
      const directions = firstStops.map(({ guide, placement }, index) => (
        `${index === 0 ? 'Start' : 'start'} ${placement.pathName} with ${guide.name}`
      ));
      nodes.results.append(el('p', {
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
      presentation.renderTimelineSections(nodes.results, sections, placements, {
        idPrefix: 'timeline',
        showEmptyYears: state.facet === 'all' && !state.query,
        sectionBlurb: true,
        sectionLevel: 'h2',
        yearLevel: 'h3',
        cardLevel: 'h4',
        undatedCardLevel: 'h3',
        cardOptions: { surface: 'catalog' },
      });
    } else {
      for (const section of sections) {
        if (grouped) nodes.results.append(presentation.shelfSectionHead(section, { blurb: false }));
        const grid = el('div', { class: 'catalog-grid' });
        for (const story of section.stories) {
          grid.append(presentation.catalogCard(story, placements.get(story.key), {
            surface: key,
            level: grouped ? 'h3' : 'h2',
          }));
        }
        nodes.results.append(grid);
      }
    }
    if (!catalog.dropped) {
      const where = narrowingLabel(key, mine, state);
      const match = state.query ? ` matching “${state.query}”` : '';
      announceResult(`${shelf.heading} shows ${stories.length} ${stories.length === 1 ? 'Reading List' : 'Reading Lists'}${match}${where}.${sortSentence}`);
    }
  }

  function clearNarrowing(key) {
    const state = stateByShelf.get(key);
    if (!state) return;
    state.facet = 'all';
    state.query = '';
    state.spotlight = 'all';
    const nodes = elements.shelf(key);
    nodes.query.value = '';
    nodes.clear.hidden = true;
    for (const radio of elements.spotlightKinds()) radio.checked = radio.value === 'all';
  }

  function wire(key) {
    const state = stateByShelf.get(key);
    const nodes = elements.shelf(key);
    nodes.search.addEventListener('submit', (event) => event.preventDefault());
    nodes.query.addEventListener('input', () => {
      state.query = nodes.query.value.trim();
      void render(key);
    });
    nodes.clear.addEventListener('click', () => {
      nodes.query.value = '';
      state.query = '';
      nodes.query.focus();
      void render(key);
    });
    if (key === 'spotlights') {
      for (const radio of elements.spotlightKinds()) {
        radio.addEventListener('change', () => {
          state.spotlight = radio.value;
          void render(key);
        });
      }
      for (const radio of elements.spotlightSorts()) {
        radio.addEventListener('change', () => {
          state.sort = radio.value === 'popularity' ? 'popularity' : null;
          void render(key);
          onSortChange();
        });
      }
    }
  }

  function setSort(value) {
    stateByShelf.get('spotlights').sort = value === 'popularity' ? 'popularity' : null;
  }

  return {
    clearNarrowing,
    render,
    sort: () => stateByShelf.get('spotlights').sort,
    setSort,
    wire,
  };
}
