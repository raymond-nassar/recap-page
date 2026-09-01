const CONTINUE_NO_LIST = 'Continue reading';

export function createHomeView({
  categoriesForCatalog,
  clearCatalogNotice,
  el,
  elements,
  getActiveListId,
  getState,
  hueOf,
  labelledName,
  listProgress,
  loadCatalog,
  onCatalogDropped,
  onCatalogLoadFailure,
  onNavigateCategory,
  onOpen,
  onRead,
  openPreview,
  paintCover,
  paintCoverUrl,
  recommendedList,
  renderSavedLists,
  seriesOnly,
  shortTitle,
  upNext,
}) {
  let catalog = null;
  let generation = 0;

  function wire() {
    const nodes = elements();
    nodes.continueRead.addEventListener('click', (event) => {
      const issue = upNext(getState(), getActiveListId());
      if (issue) onRead(issue, event);
    });
    nodes.continueOpen.addEventListener('click', onOpen);
  }

  function ensureFirstRun() {
    const current = elements();
    if (current.firstRun) return current.firstRun;
    const recommendation = el('div', {
      id: 'home-recommended',
      class: 'notice notice-act',
      hidden: true,
    }, [
      el('div', { class: 'grow' }, [
        el('h3', {
          id: 'home-recommended-h',
          text: 'Recommended start: Setup to Modern Timeline',
        }),
        el('p', {
          text: "A guided path through the earlier stories that prepare you for this app's Modern Timeline.",
        }),
      ]),
      el('button', {
        type: 'button',
        id: 'btn-home-recommended',
        class: 'btn',
      }, 'Preview this Reading List'),
    ]);
    const section = el('section', {
      id: 'home-first-run',
      class: 'sec',
      hidden: true,
      'aria-labelledby': 'home-first-run-h',
    }, [
      el('div', { class: 'sec-h' }, el('h2', {
        id: 'home-first-run-h',
        text: 'Where do you want to start?',
      })),
      el('p', {
        class: 'home-first-run-copy',
        text: 'Browse curated Reading Lists. Add individual issues or your own list.',
      }),
      recommendation,
    ]);
    current.categoriesRoot.prepend(section);
    return section;
  }

  function renderContinue(populated) {
    const nodes = elements();
    const id = getActiveListId();
    const list = getState().lists[id];
    nodes.continueSection.hidden = !populated || !list;
    if (nodes.continueSection.hidden) {
      nodes.continueHeading.textContent = CONTINUE_NO_LIST;
      return;
    }

    const { read, total } = listProgress(getState(), id);
    const issue = upNext(getState(), id);
    nodes.continueHeading.textContent = list.name;
    nodes.continueBar.setAttribute('aria-valuemax', String(total));
    nodes.continueBar.setAttribute('aria-valuenow', String(read));
    nodes.continueBar.setAttribute('aria-valuetext', `${read} of ${total} issues read`);
    nodes.continueFill.style.setProperty('width', `${total ? ((read / total) * 100).toFixed(1) : 0}%`);
    nodes.continueCount.textContent = `${read} of ${total} issue${total === 1 ? '' : 's'} read`;

    if (issue) {
      nodes.continueNext.textContent = `Next: ${issue.title}`;
      paintCover(nodes.continueImage, nodes.continueFallback, issue, 'portrait_incredible');
      nodes.continueSeries.textContent = seriesOnly(issue.seriesName);
      nodes.continueNumber.textContent = issue.number ? `#${issue.number}` : '';
      nodes.continueRead.hidden = false;
      nodes.continueRead.setAttribute(
        'aria-label',
        labelledName(nodes.continueRead.textContent, `${issue.title} in Marvel Unlimited`),
      );
    } else {
      nodes.continueNext.textContent = 'You have read every issue in this order.';
      nodes.continueRead.hidden = true;
      paintCoverUrl(
        nodes.continueImage,
        nodes.continueFallback,
        null,
        hueOf(list.name),
        list.name,
      );
      nodes.continueSeries.textContent = shortTitle(list.name);
      nodes.continueNumber.textContent = '';
    }
    nodes.continueOpen.setAttribute(
      'aria-label',
      labelledName(nodes.continueOpen.textContent, list.name),
    );
  }

  function render() {
    const nodes = elements();
    if (nodes.home.hidden) return;
    const populated = getState().listOrder.length > 0;
    const firstRun = ensureFirstRun();
    nodes.categoriesHeading.classList.toggle('visually-hidden', !populated);
    firstRun.hidden = populated;
    renderContinue(populated);
    renderSavedLists(nodes.yoursSection, nodes.yoursList);
    void renderGateways();
  }

  function categoryTile(category) {
    const glyph = String.fromCodePoint(Number.parseInt(category.icon, 16));
    const count = `${category.count} ${category.count === 1
      ? (category.singular ?? 'Reading List')
      : (category.plural ?? 'Reading Lists')}`;
    return el('li', {}, el('button', {
      type: 'button',
      class: `home-path home-path-${category.tier}`,
      'aria-label': `${category.heading}. ${category.label}. ${count}.`,
      dataset: { category: category.key },
      onclick: () => onNavigateCategory(category),
    }, [
      el('span', {
        class: 'gi home-path-icon',
        'aria-hidden': 'true',
        text: glyph,
      }),
      el('span', { class: 'home-path-copy' }, [
        el('span', { class: 'eyebrow home-path-label', text: category.label }),
        el('span', { class: 'home-path-title', text: category.heading }),
        el('span', { class: 'home-path-count', text: count }),
      ]),
      el('span', {
        class: 'gi home-path-arrow',
        'aria-hidden': 'true',
        text: String.fromCodePoint(0xE72A),
      }),
    ]));
  }

  async function renderGateways() {
    const currentGeneration = ++generation;
    let nodes = elements();
    for (const label of nodes.copyrights) {
      label.textContent = `© ${new Date().getFullYear()} MARVEL`;
    }
    if (!catalog) {
      clearCatalogNotice();
      for (const gateway of nodes.gateways) {
        const status = gateway.querySelector('[data-paths-status]');
        status.classList.remove('visually-hidden');
        status.hidden = false;
        status.textContent = 'Loading ways to read…';
      }
      try {
        catalog = await loadCatalog();
      } catch (error) {
        for (const gateway of nodes.gateways) {
          gateway.querySelector('[data-primary-paths]').hidden = true;
          gateway.querySelector('[data-more-paths]').hidden = true;
          gateway.querySelector('[data-paths-status]').hidden = true;
        }
        await onCatalogLoadFailure({
          error,
          isCurrent: () => currentGeneration === generation,
          retry: renderGateways,
        });
        return;
      }
      clearCatalogNotice();
    }

    nodes = elements();
    if (nodes.recommendation) {
      const list = recommendedList(catalog.lists);
      nodes.recommendation.hidden = !list;
      if (list) nodes.recommendationButton.onclick = () => openPreview(list);
    }
    if (catalog.dropped) onCatalogDropped(catalog.dropped);

    const categories = categoriesForCatalog(catalog);
    const primaryCategories = categories.filter(({ tier }) => tier === 'primary');
    const secondaryCategories = categories.filter(({ tier }) => tier === 'secondary');
    for (const gateway of nodes.gateways) {
      const primary = gateway.querySelector('[data-primary-paths]');
      const secondary = gateway.querySelector('[data-secondary-paths]');
      const more = gateway.querySelector('[data-more-paths]');
      const status = gateway.querySelector('[data-paths-status]');
      primary.replaceChildren(...primaryCategories.map(categoryTile));
      secondary.replaceChildren(...secondaryCategories.map(categoryTile));
      primary.hidden = primaryCategories.length === 0;
      more.hidden = secondaryCategories.length === 0;
      const statusText = categories.length
        ? `${categories.length} ways to read available.`
        : 'No reading paths are bundled with this build.';
      status.classList.toggle('visually-hidden', categories.length > 0);
      status.hidden = false;
      if (status.textContent !== statusText) status.textContent = statusText;
    }
  }

  return {
    categoryTile,
    render,
    renderGateways,
    wire,
  };
}
