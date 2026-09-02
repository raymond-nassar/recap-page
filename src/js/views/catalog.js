import {
  CATALOG_SHELVES,
  catalogFacets,
  countStories,
  decadeSections,
  defaultPath,
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
import { completionState, listProgress } from '../lib/model.js';

const FILTER_THRESHOLD = 12;

export function modernTimelinePosition(state, stories, { dropped = 0 } = {}) {
  if (Number.isInteger(dropped) && dropped > 0) return { kind: 'unavailable', dropped };

  const ordered = Array.isArray(stories) ? stories : [];
  const total = ordered.length;
  if (!total) return { kind: 'empty', completed: 0, total: 0 };

  // One index preserves listForCatalogId's first-listOrder answer without repeating its linear
  // scan for every story, which is material at the accepted saved-list ceiling.
  const savedByCatalogId = new Map();
  for (const id of Array.isArray(state?.listOrder) ? state.listOrder : []) {
    const saved = state?.lists?.[id];
    if (saved?.catalogId && !savedByCatalogId.has(saved.catalogId)) {
      savedByCatalogId.set(saved.catalogId, saved);
    }
  }

  for (let completed = 0; completed < total; completed += 1) {
    const story = ordered[completed];
    const list = defaultPath(story, (candidate) => savedByCatalogId.has(candidate.id));
    const saved = list ? savedByCatalogId.get(list.id) : null;
    if (!saved) {
      return {
        kind: 'current',
        storyKey: story?.key ?? null,
        storyName: story?.name ?? list?.name ?? 'Reading List',
        completed,
        total,
      };
    }
    const progress = listProgress(state, saved.id);
    if (completionState(progress.read, progress.total) !== 'done') {
      return {
        kind: 'current',
        storyKey: story?.key ?? null,
        storyName: story?.name ?? list?.name ?? saved.name ?? 'Reading List',
        completed,
        total,
      };
    }
  }

  return { kind: 'complete', completed: total, total };
}

export function createCatalogView({
  announce,
  clearLoadNotice,
  el,
  elements,
  getState = () => ({ listOrder: [], lists: {}, read: {} }),
  isCurrent = () => true,
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
  let timelineContext = null;
  let timelinePendingGeneration = null;
  let timelinePositionSignature = null;

  function announceResult(message, key) {
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => {
      if (isCurrent(key)) announce(message);
    }, 500);
  }

  function timelineProgressText(position) {
    const stop = position.total === 1 ? 'timeline stop' : 'timeline stops';
    return `${position.completed} of ${position.total} ${stop} complete.`;
  }

  function timelinePositionMessage(position, context) {
    if (position.kind === 'current') {
      const progress = timelineProgressText(position);
      return context.visibleStoryKeys.has(position.storyKey)
        ? `You are here: ${position.storyName}. ${progress}`
        : `Your current timeline stop, ${position.storyName}, is hidden by the current search or filter. ${progress}`;
    }
    if (position.kind === 'complete') {
      const stop = position.total === 1 ? 'timeline stop is' : 'timeline stops are';
      return `Modern Timeline complete. All ${position.total} ${stop} complete.`;
    }
    if (position.kind === 'unavailable') {
      const entry = position.dropped === 1 ? 'entry is' : 'entries are';
      return `Your timeline position is unavailable because ${position.dropped} catalog ${entry} incomplete and cannot be shown.`;
    }
    return null;
  }

  function timelineSignature(position, context) {
    return JSON.stringify([
      position.kind,
      position.storyKey ?? null,
      position.completed ?? null,
      position.total ?? null,
      position.dropped ?? null,
      position.kind === 'current' ? context.visibleStoryKeys.has(position.storyKey) : null,
      context.narrowed,
    ]);
  }

  function paintTimelineContext(context, { announceChange = false } = {}) {
    const position = modernTimelinePosition(getState(), context.stories, {
      dropped: context.dropped,
    });
    const signature = timelineSignature(position, context);
    const message = timelinePositionMessage(position, context);
    if (announceChange && signature === timelinePositionSignature) {
      return { changed: false, message, position };
    }
    presentation.paintTimelinePosition?.(context.root, position, {
      message,
      narrowed: context.narrowed,
      visibleStoryKeys: context.visibleStoryKeys,
    });
    timelinePositionSignature = signature;
    if (announceChange && message) announceResult(message, 'catalog');
    return { changed: true, message, position };
  }

  function commitTimelineContext({
    dropped,
    generation,
    narrowed,
    root,
    stories,
    visibleStories,
  }) {
    if (generation !== generationByShelf.get('catalog')) return null;
    timelinePendingGeneration = null;
    timelineContext = {
      dropped,
      narrowed,
      root,
      stories,
      visibleStoryKeys: new Set(visibleStories.map((story) => story.key)),
    };
    return paintTimelineContext(timelineContext);
  }

  function refreshProgress() {
    if (!isCurrent('catalog') || !timelineContext || timelinePendingGeneration !== null) return false;
    return paintTimelineContext(timelineContext, { announceChange: true }).changed;
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
    if (key === 'catalog') {
      timelineContext = null;
      timelinePendingGeneration = generation;
      timelinePositionSignature = null;
    }
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
      if (generation !== generationByShelf.get(key)) return;
      if (key === 'catalog') {
        timelineContext = null;
        timelinePendingGeneration = null;
      }
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
    if (generation !== generationByShelf.get(key)) return;

    if (catalog.dropped) notifyDropped(key, catalog.dropped);
    if (key === 'catalog') {
      presentation.ensureSetupGuideFeature(catalog.lists, key, modernTimelineFeaturedCard);
    }

    const mine = key === 'catalog'
      ? modernTimelineLists(catalog.lists)
      : shelfLists(catalog.lists, key);
    const canonicalTimelineStories = key === 'catalog' ? groupCatalog(mine) : null;
    nodes.results.replaceChildren();
    if (!mine.length) {
      nodes.filters.hidden = true;
      nodes.search.hidden = true;
      nodes.results.append(el('p', { class: 'rail-hint', text: shelf.empty }));
      if (key === 'catalog') {
        commitTimelineContext({
          dropped: catalog.dropped,
          generation,
          narrowed: false,
          root: nodes.results,
          stories: canonicalTimelineStories,
          visibleStories: [],
        });
      }
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
      const position = key === 'catalog'
        ? commitTimelineContext({
          dropped: catalog.dropped,
          generation,
          narrowed: state.facet !== 'all' || Boolean(state.query),
          root: nodes.results,
          stories: canonicalTimelineStories,
          visibleStories: [],
        })
        : null;
      announceResult(`${message}${sortSentence}${position?.message ? ` ${position.message}` : ''}`, key);
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
    const position = key === 'catalog'
      ? commitTimelineContext({
        dropped: catalog.dropped,
        generation,
        narrowed: state.facet !== 'all' || Boolean(state.query),
        root: nodes.results,
        stories: canonicalTimelineStories,
        visibleStories: stories,
      })
      : null;
    if (!catalog.dropped) {
      const where = narrowingLabel(key, mine, state);
      const match = state.query ? ` matching “${state.query}”` : '';
      announceResult(
        `${shelf.heading} shows ${stories.length} ${stories.length === 1 ? 'Reading List' : 'Reading Lists'}${match}${where}.${sortSentence}${position?.message ? ` ${position.message}` : ''}`,
        key,
      );
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
    refreshProgress,
    render,
    sort: () => stateByShelf.get('spotlights').sort,
    setSort,
    wire,
  };
}
