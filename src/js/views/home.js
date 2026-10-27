import { uiIcon } from '../lib/uiIcon.js';
import { isLaunchable } from '../reader.js';
import { deferredCount } from '../lib/model.js';
import { paintGlance } from '../lib/progressGlance.js';
import { formatRoute, isPlainNavigation } from '../lib/route.js';
import { shownName } from '../lib/accname.js';

const CONTINUE_NO_LIST = 'Continue reading';
const CATEGORY_ICONS = {
  E736: 'timeline',
  E8FD: 'storylines',
  E77B: 'characters',
  E714: 'screen',
  E8F1: 'books',
  E81C: 'ages',
};

export function createHomeView({
  categoriesForCatalog,
  createIcon = uiIcon,
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
  onDone,
  onNavigateCategory,
  onNavigateHub,
  onOpen,
  onRead,
  onReview,
  onReviewDeferred,
  paintCover,
  paintCoverUrl,
  readerPresentation = (issue) => ({ launchable: isLaunchable(issue), temporary: false }),
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
      if (issue) onRead(issue, event, 'saved');
    });
    // Done here marks the comic this card names, through the same result and Undo as the reading
    // view's Done. A held Enter is ignored as it is there: each repeat would otherwise mark the comic
    // that had just moved up.
    nodes.continueDone.addEventListener('click', () => onDone());
    nodes.continueDone.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && event.repeat) event.preventDefault();
    });
    nodes.continueOpen.addEventListener('click', (event) => {
      if (!isPlainNavigation(event)) return;
      event?.preventDefault();
      onOpen();
    });
    nodes.continueReview.addEventListener('click', onReview);
    nodes.continueDeferred.addEventListener('click', onReviewDeferred);
  }

  function ensureFirstRun() {
    const current = elements();
    if (current.firstRun) return current.firstRun;
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
      el('div', { class: 'cta home-start-actions' }, [
        el('a', {
          href: formatRoute({ view: 'catalog' }),
          class: 'btn',
          id: 'btn-home-browse',
          onclick: (event) => {
            if (!isPlainNavigation(event)) return;
            event?.preventDefault();
            onNavigateHub('catalog');
          },
        }, 'Browse Reading Lists'),
        el('a', {
          href: formatRoute({ view: 'add' }),
          class: 'btn btn-g',
          id: 'btn-home-add',
          onclick: (event) => {
            if (!isPlainNavigation(event)) return;
            event?.preventDefault();
            onNavigateHub('add');
          },
        }, 'Add comics'),
      ]),
    ]);
    current.categoriesRoot.prepend(section);
    return section;
  }

  function renderContinue(populated) {
    const nodes = elements();
    const id = getActiveListId();
    const list = getState().lists[id];
    nodes.continueOpen.setAttribute('href', formatRoute({ view: 'read', listId: id }));
    nodes.continueSection.hidden = !populated || !list;
    if (nodes.continueSection.hidden) {
      nodes.continueHeading.textContent = CONTINUE_NO_LIST;
      return;
    }

    const { read, total } = listProgress(getState(), id);
    nodes.continueSection.classList.toggle('continue-empty', total === 0);
    const deferred = deferredCount(getState(), id);
    const issue = upNext(getState(), id);
    nodes.continueHeading.textContent = list.name;
    // The count is the card's one reading of its progress (#876). The bar under it repeats the same
    // numbers for the eye and is hidden from assistive technology in the markup, where it used to be a
    // named progress bar that a screen reader read straight before the identical count.
    paintGlance(el, { count: nodes.continueCount, fill: nodes.continueFill }, { read, total },
      ` of ${total} issue${total === 1 ? '' : 's'} read${deferred ? `. ${deferred} deferred` : ''}`);
    nodes.continueBar.hidden = total === 0;
    nodes.continueDeferred.hidden = deferred === 0;
    nodes.continueReview.hidden = total === 0;

    if (issue) {
      const reader = readerPresentation(issue, 'saved');
      nodes.continueNext.textContent = `Next: ${issue.title}${reader.temporary ? ' (temporary reader link)' : ''}`;
      paintCover(nodes.continueImage, nodes.continueFallback, issue, 'portrait_incredible');
      nodes.continueSeries.textContent = seriesOnly(issue.seriesName);
      nodes.continueNumber.textContent = issue.number ? `#${issue.number}` : '';
      nodes.continueRead.hidden = false;
      nodes.continueRead.disabled = !reader.launchable;
      nodes.continueRead.textContent = 'Read';
      nodes.continueRead.setAttribute(
        'aria-label',
        labelledName('Read', `${issue.title} in Marvel Unlimited${reader.temporary ? ' with temporary link' : ''}`),
      );
      // Marking a comic read needs no reader link, so Done stays usable when Read cannot launch.
      nodes.continueDone.hidden = false;
    } else {
      nodes.continueNext.textContent = total === 0
        ? 'No issues in this Reading List yet. Open it to add comics.'
        : deferred ? `Nothing queued. ${deferred} unread issue${deferred === 1 ? ' is' : 's are'} deferred.`
          : 'You have read every issue in this order.';
      nodes.continueRead.hidden = true;
      nodes.continueDone.hidden = true;
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
    const count = `${category.count} ${category.count === 1
      ? (category.singular ?? 'Reading List')
      : (category.plural ?? 'Reading Lists')}`;
    return el('li', {}, el('a', {
      href: formatRoute({ view: category.route }),
      class: `home-path home-path-${category.tier}`,
      'aria-label': shownName([category.label, category.heading, count]),
      dataset: { category: category.key },
      onclick: (event) => {
        if (!isPlainNavigation(event)) return;
        event?.preventDefault();
        onNavigateCategory(category);
      },
    }, [
      createIcon(CATEGORY_ICONS[category.icon], 'gi home-path-icon'),
      // Each piece but the last ends in a space, which is not drawn because it ends a line, so the
      // pieces stay separate words for anything that reads the card's text rather than its boxes.
      // The axe rules pass is one: it joins sibling text as it finds it, and read this card as
      // "Browse by yearModern Timeline152 Reading Lists", which no name can contain (#905). The space
      // is inside each piece rather than between them because on Home the wrapper is laid out with
      // `display: contents`, and axe drops text whose parent draws no box of its own.
      el('span', { class: 'home-path-copy' }, [
        el('span', { class: 'eyebrow home-path-label' }, [category.label, ' ']),
        el('span', { class: 'home-path-title' }, [category.heading, ' ']),
        el('span', { class: 'home-path-count', text: count }),
      ]),
      createIcon('arrow-right', 'gi home-path-arrow'),
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
    refreshReader: () => renderContinue(getState().listOrder.length > 0),
    renderGateways,
    wire,
  };
}
