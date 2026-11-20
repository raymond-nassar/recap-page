import { catalogCoverUrl } from '../lib/catalog.js';
import { formatRoute, isPlainNavigation } from '../lib/route.js';

export function createCreatorsView({
  clearCatalogNotice, el, elements, hueOf, isCurrent, loadCatalog, onLoadFailure, onPreview,
  paintCoverUrl, shortTitle,
}) {
  let catalog = null;
  let creator = '';
  let generation = 0;
  let covers = [];

  function creatorCard(list) {
    const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' });
    const fallback = el('div', { class: 'of cover-fallback', 'aria-hidden': 'true' }, [
      el('span', { class: 'ofs', text: shortTitle(list.name) }),
    ]);
    const paintCover = () => paintCoverUrl(img, fallback, catalogCoverUrl(list), hueOf(list.name), list.name);
    paintCover();
    covers.push(paintCover);
    return el('li', {}, el('a', {
      class: 'catalog-card creator-run-card',
      href: formatRoute({ view: 'new-to-comics', previewId: list.id }),
      dataset: { creatorRun: list.id },
      onclick: (event) => {
        if (!isPlainNavigation(event)) return;
        event.preventDefault();
        onPreview(list);
      },
    }, el('div', { class: 'catalog-card-main' }, [
      el('div', { class: 'ocard-art' }, [img, fallback]),
      el('div', { class: 'catalog-card-text' }, [
        el('h3', { class: 'catalog-card-title' }, [list.name, ' ']),
        el('p', {
          class: 'catalog-card-meta',
          text: `${list.writers.join(', ')} · ${list.count} comic${list.count === 1 ? '' : 's'}`,
        }),
      ]),
    ])));
  }

  function paint(nodes) {
    const lists = catalog.lists.filter((list) => list.type === 'creator-run');
    const creators = [...new Set(lists.flatMap((list) => list.writers))];
    if (!creators.includes(creator)) creator = '';
    nodes.status.textContent = lists.length ? '' : 'No creator runs are bundled with this build.';
    nodes.status.hidden = lists.length > 0;
    nodes.emptyHome.hidden = lists.length > 0;
    const filters = ['', ...creators].map((name) => el('button', {
      type: 'button',
      class: 'search-scope',
      text: name || 'All creators',
      'aria-pressed': String(creator === name),
      onclick: () => {
        creator = name;
        paintCards();
      },
    }));
    function paintCards() {
      covers = [];
      filters.forEach((button, index) => {
        button.setAttribute('aria-pressed', String(creator === (index === 0 ? '' : creators[index - 1])));
      });
      nodes.results.replaceChildren(...lists
        .filter((list) => !creator || list.writers.includes(creator)).map(creatorCard));
    }
    nodes.filters.replaceChildren(...(lists.length ? filters : []));
    paintCards();
  }

  async function render() {
    if (catalog) return;
    const currentGeneration = ++generation;
    const nodes = elements();
    clearCatalogNotice();
    nodes.status.hidden = false;
    nodes.status.textContent = 'Loading Reading Lists...';
    nodes.emptyHome.hidden = true;
    try {
      const loaded = await loadCatalog();
      if (currentGeneration !== generation || !isCurrent()) return;
      catalog = loaded;
      paint(nodes);
    } catch (error) {
      if (currentGeneration !== generation || !isCurrent()) return;
      nodes.status.hidden = true;
      await onLoadFailure({
        error,
        isCurrent: () => currentGeneration === generation && isCurrent(),
        retry: render,
      });
    }
  }

  return { render, refreshCovers: () => covers.forEach((paintCover) => paintCover()) };
}
