import { labelledName, shownName } from '../../lib/accname.js';
import { formatRoute, isPlainNavigation } from '../../lib/route.js';
import {
  catalogCoverUrl,
  catalogGapLabels,
  defaultPath,
  firstSentence,
  sourceLabel,
  sourceLink,
  storyYear,
  updatedLabel,
} from '../../lib/catalog.js';
const CATALOG_ADD = '+ Add to library';

export function createCatalogPresentation({
  el,
  elements,
  hueOf,
  isInLibrary,
  onAdd,
  onOpen,
  onPreview,
  paintCoverUrl,
  shortTitle,
}) {
  function chosenPath(story) {
    return defaultPath(story, (list) => isInLibrary(list.id));
  }

  function primaryButton(list, reportTarget) {
    const saved = isInLibrary(list.id);
    if (saved) {
      const text = 'Open →';
      return el('a', {
        class: 'btn',
        href: formatRoute({ view: 'read', listId: saved.id }),
        'aria-label': labelledName(text, list.name),
        dataset: { key: list.id, act: 'open' },
        onclick: (event) => {
          if (!isPlainNavigation(event)) return;
          event?.preventDefault();
          onOpen(list, saved, reportTarget);
        },
      }, text);
    }
    return el('button', {
      class: 'btn btn-g',
      type: 'button',
      'aria-label': labelledName(CATALOG_ADD, list.name),
      dataset: { key: list.id, act: 'import' },
      onclick: (event) => onAdd(list, event.currentTarget, reportTarget),
    }, CATALOG_ADD);
  }

  // The card keeps the credit the sources' permissions rest on, the linked site name, and leaves the
  // snapshot date and section to Preview, which shows the full attribution (UX-11, #830).
  function attributionLine(list, { compact = false } = {}) {
    const href = sourceLink(list);
    const label = compact && href ? sourceSiteName(href) : sourceLabel(list);
    const section = !compact && typeof list.sourceSection === 'string' && list.sourceSection.trim()
      ? list.sourceSection.trim()
      : null;
    const updated = compact ? null : updatedLabel(list);
    if (!label && !section && !updated) return null;

    const parts = [];
    if (label) {
      parts.push('Source: ');
      parts.push(href
        ? el('a', {
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
          'aria-label': `Source of ${list.name}: ${label}${section ? `, section ${section}` : ''}`,
        }, label)
        : el('span', { text: label }));
    }
    if (section) parts.push(el('span', { text: `${label ? ' · ' : ''}Section: ${section}` }));
    if (updated) parts.push(el('span', { text: `${label || section ? ' · ' : ''}Snapshot taken ${updated}` }));
    return el('p', { class: 'result-meta result-source' }, parts);
  }

  // One prominent action per card (UX-11, #830). The title opens Preview, named by the title it
  // shows and then by what it does (#905); Add is the one compact secondary action, and a saved list
  // keeps its primary Open. The title's own words carry the id a section is labelled by, so that
  // label stays the title rather than the button's name.
  function catalogCard(story, {
    surface = 'catalog',
    report = null,
    level = 'h3',
    titleId = null,
  } = {}) {
    const reportTarget = report ?? `#${surface}-report`;
    const list = story.lists[0];
    const title = list.name;
    const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' });
    const fallback = el('div', { class: 'of cover-fallback', 'aria-hidden': 'true' }, [
      el('span', { class: 'ofs', text: shortTitle(title) }),
    ]);
    paintCoverUrl(img, fallback, catalogCoverUrl(list), hueOf(title), title);
    const desc = firstSentence(list.description);
    const source = attributionLine(list, { compact: true });

    const year = storyYear(story);
    return el('article', {
      class: 'catalog-card',
      dataset: { story: story.key, year: year ?? '' },
    }, [
      el('div', { class: 'catalog-card-main' }, [
        el('div', { class: 'ocard-art' }, [img, fallback]),
        el('div', { class: 'catalog-card-text' }, [
          el(level, { class: 'catalog-card-title' }, el('button', {
            class: 'catalog-card-preview',
            type: 'button',
            'aria-label': shownName([title], 'Preview'),
            dataset: { key: story.key, act: 'preview' },
            onclick: () => onPreview(list),
          }, el('span', { id: titleId, text: title }))),
          desc ? el('p', { class: 'catalog-card-desc', text: desc }) : el('p', { class: 'catalog-card-desc', hidden: true }),
          el('p', {
            class: 'catalog-card-meta',
            text: [`${list.count} issue${list.count === 1 ? '' : 's'}`, ...catalogGapLabels(list)].join(' · '),
          }),
          el('div', { class: 'result-source' }, source ? [source] : []),
        ]),
      ]),
      el('div', { class: 'catalog-card-actions' }, primaryButton(list, reportTarget)),
    ]);
  }

  function paintTimelinePosition(root, position, {
    message = '',
    narrowed = false,
    progress = null,
    visibleStoryKeys = new Set(),
  } = {}) {
    if (!root || !position) return;
    for (const card of root.querySelectorAll('[aria-current="step"]')) {
      card.removeAttribute('aria-current');
    }
    for (const marker of root.querySelectorAll('[data-timeline-position]')) marker.remove();

    const status = (kind, text, extraClass = '') => el('p', {
      class: `timeline-position timeline-position-status${extraClass ? ` ${extraClass}` : ''}`,
      dataset: { timelinePosition: kind },
      text,
    });

    if (position.kind === 'current') {
      const card = visibleStoryKeys.has(position.storyKey)
        ? [...root.querySelectorAll('.catalog-card')]
          .find((candidate) => candidate.dataset.story === position.storyKey)
        : null;
      if (!card) {
        root.prepend(status('hidden', message));
        return;
      }
      card.setAttribute('aria-current', 'step');
      const stop = position.total === 1 ? 'timeline stop' : 'timeline stops';
      const marker = el('p', {
        class: 'timeline-position timeline-position-current',
        dataset: { timelinePosition: 'current' },
      }, [
        el('span', { class: 'timeline-position-label', text: 'You are here' }),
        el('span', {
          class: 'timeline-position-progress',
          text: progress ?? `${position.completed} of ${position.total} ${stop} complete`,
        }),
      ]);
      (card.querySelector('.catalog-card-text') ?? card).prepend(marker);
      return;
    }

    if (position.kind === 'complete') {
      const marker = status('complete', message, 'timeline-position-complete');
      if (narrowed) root.prepend(marker);
      else (root.querySelector('.timeline-flow') ?? root).append(marker);
      return;
    }

    if (position.kind === 'unavailable') root.prepend(status('unavailable', message));
  }

  function shelfSectionHead(section, {
    level = 'h2',
    className = 'shelf-section',
    blurb = true,
    headingId = null,
  } = {}) {
    const children = [el(level, {
      id: headingId,
      class: 'shelf-section-title',
      text: section.heading,
    })];
    if (blurb) children.push(el('p', { class: 'shelf-section-blurb', text: section.blurb }));
    return el('div', { class: className }, children);
  }

  function emptyTimelineYear(year) {
    return el('div', { class: 'timeline-year-row is-empty' }, [
      el('div', { class: 'timeline-year-marker is-empty' }, [
        el('span', { 'aria-hidden': 'true', text: `${year}` }),
        el('span', { class: 'visually-hidden', text: `${year}, no Reading Lists` }),
      ]),
    ]);
  }

  function renderTimelineSections(box, sections, {
    idPrefix = 'timeline',
    showEmptyYears,
    sectionBlurb = true,
    sectionLevel = 'h2',
    yearLevel = 'h3',
    cardLevel = 'h4',
    undatedCardLevel = 'h3',
    cardOptions = {},
  }) {
    const flow = el('div', { class: 'timeline-flow' });
    let previousYear = null;
    for (const section of sections) {
      const byYear = new Map();
      for (const story of section.stories) {
        const year = storyYear(story);
        if (year === null) continue;
        if (!byYear.has(year)) byYear.set(year, []);
        byYear.get(year).push(story);
      }
      const years = showEmptyYears && Number.isInteger(section.from) && Number.isInteger(section.to)
        ? Array.from({ length: section.to - section.from + 1 }, (_, offset) => section.from + offset)
        : [...byYear.keys()].sort((a, b) => a - b);
      if (showEmptyYears && Number.isInteger(section.from)
        && previousYear !== null && years[0] > previousYear + 1) {
        const gap = el('div', { class: 'timeline-year-list' });
        for (let year = previousYear + 1; year < years[0]; year += 1) gap.append(emptyTimelineYear(year));
        flow.append(gap);
      }
      const sectionId = `${idPrefix}-era-${section.key}`;
      const era = el('section', {
        class: 'timeline-era',
        'aria-labelledby': sectionId,
      }, [
        el('div', { class: 'timeline-era-node', 'aria-hidden': 'true' }),
        shelfSectionHead(section, {
          className: 'shelf-section timeline-era-head',
          level: sectionLevel,
          blurb: sectionBlurb,
          headingId: sectionId,
        }),
      ]);
      const yearList = el('div', { class: 'timeline-year-list' });
      for (const year of years) {
        const yearStories = byYear.get(year) ?? [];
        if (!yearStories.length) {
          yearList.append(emptyTimelineYear(year));
          continue;
        }
        const yearId = `${idPrefix}-year-${year}`;
        const grid = el('div', { class: 'catalog-grid timeline-year-cards' });
        for (const story of yearStories) {
          grid.append(catalogCard(story, {
            ...cardOptions,
            level: cardLevel,
          }));
        }
        yearList.append(el('section', {
          class: 'timeline-year-row',
          'aria-labelledby': yearId,
        }, [
          el('div', { class: 'timeline-year-marker' }, [
            el(yearLevel, { id: yearId, class: 'timeline-year-label', text: `${year}` }),
          ]),
          grid,
        ]));
      }
      if (!years.length) {
        const grid = el('div', { class: 'catalog-grid timeline-year-cards' });
        for (const story of section.stories) {
          grid.append(catalogCard(story, {
            ...cardOptions,
            level: undatedCardLevel,
          }));
        }
        yearList.append(grid);
      }
      era.append(yearList);
      flow.append(era);
      if (Number.isInteger(section.from) && Number.isInteger(section.to)) {
        previousYear = years[years.length - 1];
      }
    }
    box.append(flow);
  }

  function setSetupGuideVisibility(surface, visible) {
    const id = surface === 'catalog' ? 'modern-timeline-feature' : `${surface}-setup-guide-feature`;
    const existing = elements.query(`#${id}`);
    if (existing) existing.hidden = !visible;
  }

  function ensureSetupGuideFeature(lists, surface, featuredCard, { hidden = false } = {}) {
    const featureId = surface === 'catalog'
      ? 'modern-timeline-feature'
      : `${surface}-setup-guide-feature`;
    const existing = elements.query(`#${featureId}`);
    const list = featuredCard(lists, surface);
    if (!list) {
      existing?.remove();
      return;
    }
    const story = { key: `list:${list.id}`, name: list.name, lists: [list] };
    const titleId = `${featureId}-h`;
    const intro = surface === 'catalog'
      ? 'An optional guide to earlier stories. You can start the Modern Timeline directly.'
      : 'An optional guide to earlier stories. You can start this age directly.';
    const context = surface === 'catalog'
      ? 'New to Marvel? Explore earlier stories for historical context on the characters and events ahead. Setup is optional; you can enter the Modern Timeline directly. This app chooses 1998 as the start of its Modern Timeline. It is not an official Marvel editorial-era boundary.'
      : 'New to Marvel? Explore earlier stories for historical context on the characters and events ahead. Setup is optional; you can enter this age directly.';
    const feature = el('section', {
      id: featureId,
      hidden,
      class: 'setup-guide-feature',
      'aria-labelledby': titleId,
      dataset: { featuredList: list.id },
    }, [
      el('div', { class: 'setup-guide-context' }, [
        el('p', { class: 'eyebrow', text: 'Earlier stories (optional)' }),
        el('p', { text: intro }),
        el('details', { class: 'field-disclosure action-disclosure setup-guide-about' }, [
          el('summary', { text: 'About this starting point' }),
          el('p', { text: context }),
        ]),
      ]),
      el('div', { class: 'catalog-grid setup-guide-grid' }, [
        catalogCard(story, {
          surface,
          report: `#${surface}-report`,
          level: 'h2',
          titleId,
        }),
      ]),
    ]);
    if (existing) existing.replaceWith(feature);
    else elements.query(`#${surface}-results`).before(feature);
  }

  return {
    attributionLine,
    catalogCard,
    chosenPath,
    ensureSetupGuideFeature,
    setSetupGuideVisibility,
    paintTimelinePosition,
    renderTimelineSections,
    shelfSectionHead,
  };
}

function sourceSiteName(href) {
  const url = new URL(href);
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'comicbookherald.com') return 'Comic Book Herald';
  if (host === 'comicbookreadingorders.com') return 'Comic Book Reading Orders';
  if (host === 'github.com') {
    const repository = url.pathname.split('/').slice(1, 3).join('/');
    if (repository === 'raymond-nassar/recap-page') return 'Recap Page';
    if (repository && !repository.endsWith('/')) return repository;
  }
  return host;
}
