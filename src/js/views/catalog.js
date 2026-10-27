import {
  CATALOG_SHELVES,
  catalogEntries,
  catalogEntryKey,
  catalogFacets,
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
  resolveReadingPaths,
  searchCatalog,
  shelfLists,
  storylinesLists,
  sortSpotlightStories,
  spotlightKindLabel,
  spotlightSortLabel,
  visibleFirstStopGuides,
} from '../lib/catalog.js';
import { completionState, listForCatalogId, listProgress } from '../lib/model.js';
import { createCollectionNavigation } from './shared/collection-navigation.js';

const FILTER_THRESHOLD = 12;

// One index preserves listForCatalogId's first-listOrder answer without repeating its linear scan
// for every story, which is material at the accepted saved-list ceiling.
function savedByCatalog(state) {
  const saved = new Map();
  for (const id of Array.isArray(state?.listOrder) ? state.listOrder : []) {
    const list = state?.lists?.[id];
    if (list?.catalogId && !saved.has(list.catalogId)) saved.set(list.catalogId, list);
  }
  return saved;
}

// The reading a stop is shown and counted by, and whether it is finished: its first saved reading,
// else its first. Timeline stories list the shallowest first, a followed stop the one its path names.
function storyStep(state, story, saved, isCompleted) {
  const list = defaultPath(story, (candidate) => saved.has(candidate.id));
  const own = list ? saved.get(list.id) : null;
  const key = list ? catalogEntryKey(list) : story?.key ?? null;
  const name = list?.name ?? story?.name ?? own?.name ?? 'Reading List';
  if (!own) return { key, name, done: false };
  const progress = listProgress(state, own.id);
  return {
    key,
    name,
    done: Boolean(isCompleted(state, own.id)) || completionState(progress.read, progress.total) === 'done',
  };
}

export function modernTimelinePosition(state, stories, { dropped = 0, isCompleted = () => false } = {}) {
  if (Number.isInteger(dropped) && dropped > 0) return { kind: 'unavailable', dropped };

  const ordered = Array.isArray(stories) ? stories : [];
  const total = ordered.length;
  if (!total) return { kind: 'empty', completed: 0, total: 0 };

  const saved = savedByCatalog(state);
  for (let completed = 0; completed < total; completed += 1) {
    const step = storyStep(state, ordered[completed], saved, isCompleted);
    if (!step.done) {
      return { kind: 'current', storyKey: step.key, storyName: step.name, completed, total };
    }
  }

  return { kind: 'complete', completed: total, total };
}

// Where the reader is on one bundled path: its first unfinished stop, and how many of its stops are
// finished in all. The whole timeline counts the run finished before its first open stop; a path
// counts a stop finished out of order too, because "3 of 10 stops complete" is read as a total
// (#897).
export function followedPathPosition(state, stories, { dropped = 0, isCompleted = () => false } = {}) {
  if (Number.isInteger(dropped) && dropped > 0) return { kind: 'unavailable', dropped };

  const ordered = Array.isArray(stories) ? stories : [];
  const total = ordered.length;
  if (!total) return { kind: 'empty', completed: 0, total: 0 };

  const saved = savedByCatalog(state);
  let current = null;
  let completed = 0;
  ordered.forEach((story, index) => {
    const step = storyStep(state, story, saved, isCompleted);
    if (step.done) completed += 1;
    else current ??= { storyKey: step.key, storyName: step.name, stop: index + 1 };
  });
  return current
    ? { kind: 'current', ...current, completed, total }
    : { kind: 'complete', completed: total, total };
}

// A bundled path's stops as the stories the follow mode shows, in the path's order. Each leads with
// the reading the path names, so a stop with nothing saved shows that reading rather than whichever
// sibling the catalog lists first.
export function followedPathStories(path) {
  return (path?.stops ?? []).map((stop) => {
    const named = stop.lists.find((list) => list.id === stop.stepId) ?? stop.lists[0];
    return {
      key: stop.key,
      name: stop.name,
      lists: [named, ...stop.lists.filter((list) => list !== named)],
    };
  });
}

export function createCatalogView({
  announce,
  clearLoadNotice,
  el,
  elements,
  getState = () => ({ listOrder: [], lists: {}, read: {} }),
  isCurrent = () => true,
  isCompleted = () => false,
  loadCatalog,
  notifyDropped,
  onFollowChange = () => {},
  onFollowCanonical = () => {},
  onLoadFailure,
  onSortChange,
  presentation,
}) {
  const stateByShelf = new Map(CATALOG_SHELVES.map((shelf) => [
    shelf.key,
    { facet: 'all', query: '', spotlight: 'all', sort: null, path: null },
  ]));
  const generationByShelf = new Map();
  let announceTimer = null;
  let followFirst = false;
  let stopOpener = null;
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

  function pathCount(position) {
    return `${position.completed} of ${position.total} stop${position.total === 1 ? '' : 's'} complete`;
  }

  function pathProgressText(position) {
    return `${pathCount(position)}.`;
  }

  function timelinePositionMessage(position, context) {
    if (context.follow) return followedPositionMessage(position, context);
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

  function followedPositionMessage(position, context) {
    if (position.kind === 'current') {
      const progress = pathProgressText(position);
      return context.visibleStoryKeys.has(position.storyKey)
        ? `You are here: ${position.storyName}, stop ${position.stop} of ${position.total}. ${progress}`
        : `Your current stop, ${position.storyName}, is hidden by the current search or filter. ${progress}`;
    }
    if (position.kind === 'complete') {
      return `${context.follow.name} complete. All ${position.total} stops are complete.`;
    }
    if (position.kind === 'unavailable') {
      const entry = position.dropped === 1 ? 'entry is' : 'entries are';
      return `Your place on this path is unavailable because ${position.dropped} catalog ${entry} incomplete and cannot be shown.`;
    }
    return null;
  }

  function timelineSignature(position, context) {
    return JSON.stringify([
      context.follow?.id ?? null,
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
    const locate = context.follow ? followedPathPosition : modernTimelinePosition;
    let position = locate(getState(), context.stories, {
      dropped: context.dropped,
      isCompleted,
    });
    // A followed path draws one card for each stop, as the reading it was counted by when drawn. A
    // save in another tab can count the stop by another of its readings without redrawing it, so the
    // place stays on the card the stop has rather than reading as hidden by a search (#897).
    const drawn = position.kind === 'current' ? context.drawn?.get(position.stop) : null;
    if (drawn) position = { ...position, storyKey: drawn.key, storyName: drawn.title };
    const signature = timelineSignature(position, context);
    const message = timelinePositionMessage(position, context);
    if (announceChange && signature === timelinePositionSignature) {
      return { changed: false, message, position };
    }
    presentation.paintTimelinePosition?.(context.root, position, {
      message,
      narrowed: context.narrowed,
      visibleStoryKeys: context.visibleStoryKeys,
      // A path's own progress, beside "You are here" on the card it marks (#897).
      ...(context.follow && position.kind === 'current'
        ? { progress: `Stop ${position.stop} of ${position.total} · ${pathCount(position)}` }
        : {}),
    });
    timelinePositionSignature = signature;
    if (announceChange && message) announceResult(message, 'catalog');
    return { changed: true, message, position };
  }

  function commitTimelineContext({
    drawn = null,
    dropped,
    follow = null,
    generation,
    narrowed,
    root,
    stories,
    visibleStories,
  }) {
    if (generation !== generationByShelf.get('catalog')) return null;
    timelinePendingGeneration = null;
    timelineContext = {
      drawn,
      dropped,
      follow,
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
    if (state.facet !== 'all' && lists.length
      && filterByFacet(lists, state.facet).length === lists.length) {
      state.facet = 'all';
      announceResult('That filter includes every Reading List here. Showing all.', key);
    }
    if (nodes.filters.hidden) return;
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

  // The choice of path, and what the chosen one is, kept outside the results so a search typed into
  // a long path does not close "About this path" with every keystroke.
  function paintFollowControl(paths, followed) {
    const nodes = elements.follow?.();
    if (!nodes) return;
    nodes.wrap.hidden = paths.length === 0;
    const signature = paths.map((path) => `${path.id}:${path.stops.length}`).join('|');
    if (nodes.select.dataset.paths !== signature) {
      nodes.select.replaceChildren(
        el('option', { value: '', text: 'Whole timeline' }),
        ...paths.map((path) => el('option', {
          value: path.id,
          text: `${path.name} (${path.stops.length} stops)`,
        })),
      );
      nodes.select.dataset.paths = signature;
    }
    nodes.select.value = followed?.id ?? '';
    nodes.about.hidden = !followed;
    nodes.description.textContent = followed?.description ?? '';
    nodes.source.textContent = followed ? `Source: ${followed.sourceOrigin}` : '';
  }

  // One numbered list in the path's order rather than era and year rows: a path is read in its own
  // order, and Marvel Knights to Planet X's chapters are not in year order. Each stop keeps the
  // path's numbering however far a search narrows the list, and says the year it starts. Returns
  // each drawn stop's card by its step, for the jump and for a return from a stop.
  function renderFollowedPath(root, path, entries, jump = null) {
    const stopOf = new Map(path.stops.map((stop) => [stop.key, stop]));
    const cards = new Map();
    const list = el('ol', { class: 'path-stops', 'aria-label': `${path.name} stops` });
    for (const entry of entries) {
      const stop = stopOf.get(entry.groupKey);
      if (!stop) continue;
      const card = presentation.catalogCard(entry, null, { surface: 'catalog', level: 'h2' });
      cards.set(stop.stepId, {
        card, key: entry.key, position: stop.position, title: entry.lists[0]?.name ?? stop.name,
      });
      list.append(el('li', {
        class: 'path-stop',
        value: String(stop.position),
        dataset: { pathStop: stop.stepId },
      }, [
        el('span', { class: 'path-stop-marker', 'aria-hidden': 'true', text: String(stop.position) }),
        el('p', {
          class: 'path-stop-meta',
          text: `Stop ${stop.position} of ${stop.total}${stop.year == null ? '' : ` · Starts ${stop.year}`}`,
        }),
        card,
      ]));
    }
    if (jump) root.append(jump(cards));
    root.append(list);
    return cards;
  }

  // The jump the path's own page had, moved with it (#897): to any stop by name, or to the next
  // unfinished one, which is the stop marked You are here. Drawn only while the whole path is shown,
  // because a search or filter would leave its numbering contradicting the list beneath it.
  function pathJump(path, stories, isLive) {
    return (cards) => el('div', { class: 'path-jump', id: 'catalog-path-navigation' }, [
      createCollectionNavigation({
        el,
        id: 'catalog-path-jump',
        label: 'Jump to stop',
        entries: path.stops.map((stop) => ({ id: stop.stepId, name: cards.get(stop.stepId)?.title ?? stop.name })),
        isCurrent: isLive,
        getTarget: (id) => {
          const title = cards.get(id)?.card.querySelector?.('.catalog-card-title') ?? null;
          title?.setAttribute('tabindex', '-1');
          return title;
        },
        getNext: () => {
          const state = getState();
          const saved = savedByCatalog(state);
          const index = stories.findIndex((story) => !storyStep(state, story, saved, isCompleted).done);
          return index < 0 ? { kind: 'complete' } : { kind: 'target', id: path.stops[index].stepId };
        },
      }),
    ]);
  }

  // Back to a path from a stop opened or previewed on it returns focus to that stop's Open or Preview,
  // as the path's own page did, and brings it into view, because arriving scrolls to the top of a list
  // that can run to 78. A Preview reopened by Back then returns focus there when it closes.
  function restoreStopOpener(opener, path, cards) {
    if (opener?.pathId !== path.id) return;
    const card = [...cards.values()].map((entry) => entry.card)
      .find((candidate) => candidate.dataset?.story === `list:${opener.catalogId}`);
    const control = card?.querySelector?.(`[data-act="${opener.act}"]`);
    if (!control?.isConnected) return;
    control.focus({ preventScroll: true });
    control.scrollIntoView?.({ block: 'center' });
  }

  async function render(key, { isCurrent: isRequestCurrent = () => true } = {}) {
    const generation = (generationByShelf.get(key) ?? 0) + 1;
    generationByShelf.set(key, generation);
    const current = () => generation === generationByShelf.get(key) && isCurrent(key) && isRequestCurrent();
    if (key === 'catalog') {
      timelineContext = null;
      timelinePendingGeneration = generation;
      timelinePositionSignature = null;
    }
    const shelf = CATALOG_SHELVES.find((candidate) => candidate.key === key);
    const state = stateByShelf.get(key);
    const nodes = elements.shelf(key);
    // Taken by this render alone, so a later one, for a search typed meanwhile, cannot move focus.
    const opener = key === 'catalog' ? stopOpener : null;
    if (key === 'catalog') stopOpener = null;
    nodes.results.replaceChildren(el('p', { class: 'rail-hint', text: 'Loading the catalog…' }));
    presentation.setSetupGuideVisibility?.(key, false);
    clearLoadNotice();
    nodes.clear.hidden = !state.query;

    let catalog;
    try {
      catalog = await loadCatalog();
    } catch (error) {
      if (!current()) return;
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
        isCurrent: current,
      });
      return;
    }
    if (!current()) return;

    if (catalog.dropped) notifyDropped(key, catalog.dropped);
    // Following a bundled path narrows the Modern Timeline to that path's stops, every one of them
    // and in the path's own order, including a stop no other screen places on the Timeline (#897).
    // A path that no longer resolves, because the catalog dropped it, is let go rather than shown as
    // an empty timeline, and the address is corrected to say so. An address from the retired Reading
    // paths page follows the path it names, or the first path when it names none, as that page did,
    // and is rewritten as the Timeline's own.
    const paths = key === 'catalog' ? resolveReadingPaths(catalog.paths, catalog.lists) : [];
    const named = paths.find((candidate) => candidate.id === state.path) ?? null;
    const retired = key === 'catalog' && followFirst;
    const followed = named ?? (retired ? paths[0] ?? null : null);
    if (key === 'catalog') followFirst = false;
    if (key === 'catalog' && (retired || state.path !== (followed?.id ?? null))) {
      state.path = followed?.id ?? null;
      onFollowCanonical();
    }
    if (key === 'catalog') paintFollowControl(paths, followed);
    const followedStories = followed ? followedPathStories(followed) : null;
    const owned = (list) => Boolean(listForCatalogId(getState(), list.id));
    const mine = followed
      ? followedStories.map((story) => defaultPath(story, owned))
      : key === 'catalog'
        ? modernTimelineLists(catalog.lists)
        : key === 'lines' ? storylinesLists(catalog.lists) : shelfLists(catalog.lists, key);
    const canonicalTimelineStories = key === 'catalog' ? followedStories ?? groupCatalog(mine) : null;
    nodes.results.replaceChildren();
    if (!mine.length) {
      nodes.filters.hidden = true;
      nodes.search.hidden = true;
      nodes.results.append(el('p', { class: 'rail-hint', text: shelf.empty }));
      if (key === 'catalog') {
        commitTimelineContext({
          dropped: catalog.dropped,
          follow: followed,
          generation,
          narrowed: false,
          root: nodes.results,
          stories: canonicalTimelineStories,
          visibleStories: [],
        });
      }
      return;
    }

    const searchable = mine.length > FILTER_THRESHOLD;
    nodes.search.hidden = !searchable;
    if (!searchable && state.query) {
      state.query = '';
      nodes.query.value = '';
      nodes.clear.hidden = true;
    }
    renderFilters(key, mine, searchable);
    if (key === 'catalog') {
      presentation.ensureSetupGuideFeature(catalog.lists, key, modernTimelineFeaturedCard, {
        hidden: Boolean(followed) || state.facet !== 'all' || Boolean(state.query),
      });
    }
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
      const message = followed
        ? state.query
          ? `No stops on ${followed.name} match “${state.query}”${where}.`
          : `No stops on ${followed.name}${where || ' in that category'}.`
        : state.query
          ? `No Reading Lists match “${state.query}”${where}.`
          : `No Reading Lists${where || ' in that category'}.`;
      nodes.results.append(el('p', { class: 'rail-hint', text: message }));
      const position = key === 'catalog'
        ? commitTimelineContext({
          dropped: catalog.dropped,
          follow: followed,
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
      ? sortSpotlightStories(catalogEntries(shown), state.sort)
      : catalogEntries(shown);
    const placements = pathPlacements(catalog.paths, catalog.lists);
    const firstStops = followed ? [] : visibleFirstStopGuides(stories, placements, presentation.chosenPath);
    if (firstStops.length) {
      const startsByPath = new Map();
      for (const { guide, placement } of firstStops) {
        const start = startsByPath.get(placement.pathId) ?? { name: placement.pathName, guides: [] };
        start.guides.push(guide.name);
        startsByPath.set(placement.pathId, start);
      }
      const directions = [...startsByPath.values()].map(({ name, guides }, index) => (
        `${index === 0 ? 'Start' : 'start'} ${name} with ${guides.join(' or ')}`
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
    let cards = null;
    if (followed) {
      const whole = state.facet === 'all' && !state.query;
      cards = renderFollowedPath(nodes.results, followed, stories, whole
        ? pathJump(followed, followedStories, () => current() && state.path === followed.id)
        : null);
    } else if (key === 'catalog') {
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
          grid.append(presentation.catalogCard(story, placements.get(story.groupKey), {
            surface: key,
            level: grouped ? 'h3' : 'h2',
          }));
        }
        nodes.results.append(grid);
      }
    }
    const position = key === 'catalog'
      ? commitTimelineContext({
        drawn: cards ? new Map([...cards.values()].map(({ position: stop, key: story, title }) => [stop, { key: story, title }])) : null,
        dropped: catalog.dropped,
        follow: followed,
        generation,
        narrowed: state.facet !== 'all' || Boolean(state.query),
        root: nodes.results,
        stories: canonicalTimelineStories,
        visibleStories: stories,
      })
      : null;
    if (cards && opener) restoreStopOpener(opener, followed, cards);
    if (!catalog.dropped) {
      const where = narrowingLabel(key, mine, state);
      const match = state.query ? ` matching “${state.query}”` : '';
      const total = followed?.stops.length;
      const lead = followed
        ? `${shelf.heading} follows ${followed.name}: ${stories.length === total ? `${total} stops` : `${stories.length} of ${total} stops`}${match}${where}.`
        : `${shelf.heading} shows ${stories.length} ${stories.length === 1 ? 'Reading List' : 'Reading Lists'}${match}${where}.`;
      announceResult(
        `${lead}${sortSentence}${position?.message ? ` ${position.message}` : ''}`,
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
    // A stop reached from a card is shown on its whole screen, so a followed path is let go too.
    state.path = null;
    if (key === 'catalog') followFirst = false;
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
    const follow = key === 'catalog' ? elements.follow?.() : null;
    // Focus stays on the choice, and the narrowed result is announced as the other narrowing is. A
    // search or filter chosen for the last path is let go, since it was not chosen for these stops.
    follow?.select.addEventListener('change', () => {
      state.path = follow.select.value || null;
      state.facet = 'all';
      state.query = '';
      nodes.query.value = '';
      nodes.clear.hidden = true;
      void render(key);
      onFollowChange();
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

  function setFollowedPath(value, { orFirst = false, opener = null } = {}) {
    stateByShelf.get('catalog').path = typeof value === 'string' && value ? value : null;
    followFirst = orFirst === true;
    stopOpener = opener && typeof opener.pathId === 'string' && typeof opener.catalogId === 'string'
      && ['open', 'preview'].includes(opener.act)
      ? { pathId: opener.pathId, catalogId: opener.catalogId, act: opener.act }
      : null;
  }

  return {
    clearNarrowing,
    followedPath: () => stateByShelf.get('catalog').path,
    refreshProgress,
    render,
    setFollowedPath,
    sort: () => stateByShelf.get('spotlights').sort,
    setSort,
    wire,
  };
}
