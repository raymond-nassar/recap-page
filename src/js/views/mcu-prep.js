import { catalogEntries, pathPlacements } from '../lib/catalog.js';
import { mcuPrepSections, parseMcuPrep, releaseDateLabel } from '../lib/mcuPrep.js';

const ROUTE = 'marvel-on-screen';

export function createMcuPrepView({
  el, elements, isCurrent, loadMetadata, presentation, clearLoadNotice, onLoadFailure,
}) {
  let catalog = null;
  let metadata = null;
  let metadataPromise = null;
  let generation = 0;
  let ready = false;
  let requestIsCurrent = () => false;
  let query = '';
  let sort = 'oldest';
  let controlsRoot;
  let input;
  let clear;
  let order;
  let retry;

  function controls() {
    if (controlsRoot) return controlsRoot;
    input = el('input', {
      id: `${ROUTE}-q`, type: 'search', autocomplete: 'off',
      placeholder: 'Characters or titles',
      oninput: () => {
        query = input.value.trim();
        clear.hidden = !query;
        paint();
      },
    });
    clear = el('button', {
      id: `${ROUTE}-clear`, type: 'button', class: 'btn btn-g', hidden: true, text: 'Clear',
      onclick: () => {
        query = '';
        input.value = '';
        clear.hidden = true;
        input.focus();
        paint();
      },
    });
    order = el('select', {
      id: `${ROUTE}-sort`, disabled: true,
      'aria-describedby': `${ROUTE}-release-help`,
      onchange: () => {
        sort = order.value;
        paint();
      },
    }, [
      el('option', { value: 'oldest', text: 'Oldest releases first' }),
      el('option', { value: 'newest', text: 'Newest releases first' }),
    ]);
    retry = el('button', {
      id: `${ROUTE}-retry`, type: 'button', class: 'btn btn-g', hidden: true,
      text: 'Retry release details',
      onclick: () => {
        metadataPromise = null;
        input.focus();
        void render(catalog, { isCurrent: requestIsCurrent });
      },
    });
    controlsRoot = el('div', { class: 'mcu-prep-controls' }, [
      el('form', { class: 'stack mcu-prep-search', role: 'search', onsubmit: (event) => event.preventDefault() }, [
        el('label', { for: input.id, text: 'Search MCU Prep by character or title' }),
        el('div', { class: 'field-row' }, [input, clear]),
      ]),
      el('div', { class: 'stack mcu-prep-sort' }, [
        el('label', { for: order.id, text: 'Release order' }),
        order,
      ]),
      el('p', {
        id: `${ROUTE}-release-help`, class: 'rail-hint mcu-prep-date-help',
        text: 'U.S. movie releases and series premieres. Guides appear once, at their earliest associated release.',
      }),
      retry,
    ]);
    return controlsRoot;
  }

  function paint() {
    if (!ready || !isCurrent() || !requestIsCurrent()) return;
    const nodes = elements();
    const sections = mcuPrepSections(catalog.lists, metadata, { query, sort });
    const total = catalog.lists.filter((list) => list.type === 'screen-companion').length;
    const count = sections.reduce((sum, section) => sum + section.entries.length, 0);
    const countText = query
      ? `${count} of ${total} Reading Lists`
      : `${count} ${count === 1 ? 'Reading List' : 'Reading Lists'}`;
    if (nodes.count.textContent !== countText) nodes.count.textContent = countText;
    nodes.results.replaceChildren();
    if (!count) {
      nodes.results.append(el('p', {
        class: 'rail-hint publishing-empty',
        text: query ? `No Reading Lists match "${query}".` : 'No MCU Prep Reading Lists are published yet.',
      }));
      return;
    }
    const placements = pathPlacements(catalog.paths, catalog.lists);
    const allStories = catalogEntries(catalog.lists.filter((list) => list.type === 'screen-companion'));
    const localStoryKeys = new Set(allStories.map((story) => story.groupKey));
    for (const section of sections) {
      const headingId = `${ROUTE}-${section.key}-h`;
      const grid = el('div', { class: 'catalog-grid publishing-grid' });
      for (const entry of section.entries) {
        const [story] = catalogEntries([entry.list]);
        const card = presentation.catalogCard(story, placements.get(story.groupKey), {
          surface: ROUTE, report: `#${ROUTE}-report`, localStoryKeys, level: 'h3',
        });
        if (entry.releases.length) {
          card.querySelector('.catalog-card-title').after(el('ul', { class: 'mcu-prep-releases' },
            entry.releases.map((release) => el('li', {
              dataset: { release: release.id },
              text: `${release.title} · ${release.format === 'movie' ? 'Movie' : 'Series premiere'} · ${releaseDateLabel(release)}`,
            }))));
        }
        grid.append(card);
      }
      nodes.results.append(el('section', {
        class: 'mcu-prep-phase', 'aria-labelledby': headingId, dataset: { phase: section.key },
      }, [
        el('h2', { id: headingId, class: 'shelf-section-title', text: section.heading }),
        ...(section.key === 'unassigned' && metadata
          ? [el('p', { class: 'rail-hint', text: 'No single screen release assigned.' })] : []),
        grid,
      ]));
    }
  }

  async function render(nextCatalog, { isCurrent: currentRequest } = {}) {
    controls();
    catalog = nextCatalog;
    requestIsCurrent = currentRequest ?? isCurrent;
    const currentGeneration = ++generation;
    const current = () => currentGeneration === generation && isCurrent() && requestIsCurrent();
    ready = false;
    order.disabled = true;
    retry.hidden = true;
    clearLoadNotice();
    let failure = null;
    let loadedMetadata = null;
    try {
      metadataPromise ??= Promise.resolve().then(loadMetadata).then(parseMcuPrep);
      loadedMetadata = await metadataPromise;
    } catch (error) {
      failure = error;
    }
    if (!current()) return;
    metadata = loadedMetadata;
    ready = true;
    order.disabled = !metadata;
    retry.hidden = !failure;
    paint();
    if (failure) {
      await onLoadFailure({ error: failure, isCurrent: current });
    }
  }

  return { controls, render };
}
