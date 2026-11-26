import { labelledName, shownName } from '../../lib/accname.js';
import { formatRoute, isPlainNavigation } from '../../lib/route.js';
import { BROWSE_ONLY_UNIVERSE_ID, universeResolver } from '../../lib/universes.js';
import {
  catalogCoverUrl,
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
  onUniverse,
  paintCoverUrl,
  resolver = universeResolver,
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

  // Readers want the description and how many comics a guide covers. The gap and hand-check counts
  // served only the guide's maintainer, so the owner asked for them off every card and search row
  // (#1601); Preview still states them for a reader who opens a guide's details.
  function catalogMeta(list) {
    const saved = isInLibrary(list.id);
    const savedCount = Array.isArray(saved?.itemIds) ? saved.itemIds.length : null;
    return [
      `${list.count} comic${list.count === 1 ? '' : 's'}`,
      ...(savedCount != null && savedCount !== list.count
        ? [`Saved copy: ${savedCount} comic${savedCount === 1 ? '' : 's'}`] : []),
    ].join(' · ');
  }

  function universeLink(universe, focusKey) {
    return el('a', {
      class: 'universe-target',
      href: formatRoute({ view: 'universe', universeId: universe.id }),
      dataset: { universeId: universe.id, act: 'universe', key: focusKey ?? universe.id },
      onclick: (event) => {
        if (!onUniverse || !isPlainNavigation(event)) return;
        event.preventDefault();
        onUniverse(universe.id, event.currentTarget);
      },
    }, universe.name);
  }

  function universeRelationLine(relation, { showUniverse = true, prefix = 'Universe: ', focusKey } = {}) {
    const related = relation.kind === 'related-realities';
    if (!showUniverse && !related) return null;
    const children = showUniverse ? [
      el('span', { text: prefix }),
      universeLink(relation.universe, focusKey),
    ] : [];
    if (related) children.push(el('span', {
      text: `${showUniverse ? '. ' : ''}Spans related realities: ${relation.note}`,
    }));
    return el('p', { class: 'rail-hint universe-list-note' }, children);
  }

  function listUniverseLines(list) {
    return resolver.getListUniverseRelations(list).map((relation) => universeRelationLine(relation));
  }

  function issueUniverseLines(issue) {
    return resolver.resolveIssueUniverses(issue)
      .map((universe) => universeRelationLine({ universe }));
  }

  function seriesUniverseLines(seriesId) {
    const raw = typeof seriesId === 'number' ? String(seriesId) : seriesId;
    if (typeof raw !== 'string' || !/^[1-9]\d*$/.test(raw)) return [];
    const id = Number(raw);
    if (!Number.isSafeInteger(id) || String(id) !== raw) return [];
    return resolver.getSeriesUniverseRelations(id)
      .filter(({ universe }) => universe.id !== BROWSE_ONLY_UNIVERSE_ID)
      .map(({ universe, scope }) => universeRelationLine(
        { universe },
        {
          prefix: scope === 'selected-issues' ? 'Selected comics in: ' : 'Universe: ',
          focusKey: `series:${id}:${universe.id}`,
        },
      ));
  }

  // The linked source stays compact on cards; additions selected elsewhere need separate credit.
  function attributionLine(list, { compact = false } = {}) {
    const href = sourceLink(list);
    const label = compact && href ? sourceSiteName(href) : sourceLabel(list);
    const ownerAdditions = compact && href && typeof list.sourceOrigin === 'string'
      && list.sourceOrigin.includes('with owner-selected additions');
    const section = !compact && typeof list.sourceSection === 'string' && list.sourceSection.trim()
      ? list.sourceSection.trim()
      : null;
    const updated = compact ? null : updatedLabel(list);
    if (!label && !section && !updated) return null;

    const parts = [];
    if (label) {
      parts.push(el('span', {}, 'Source: '));
      parts.push(href
        ? el('a', {
          href,
          target: '_blank',
          rel: 'noopener noreferrer',
          'aria-label': `Source of ${list.name}: ${label}${section ? `, section ${section}` : ''}`,
        }, label)
        : el('span', { text: label }));
      if (ownerAdditions) parts.push(el('span', { text: ', with owner-selected additions' }));
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
    linkText = null,
    previewHref = null,
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
    const previewData = { key: story.key, act: 'preview' };
    const preview = el(previewHref ? 'a' : 'button', {
      class: 'catalog-card-preview',
      'aria-label': shownName([title], 'Preview'),
      ...(previewHref
        ? { href: previewHref, dataset: { ...previewData, previewId: list.id } }
        : { type: 'button', dataset: previewData, onclick: () => onPreview(list) }),
    }, el('span', { id: titleId, text: title }));
    return el('article', {
      class: 'catalog-card',
      dataset: { story: story.key, year: year ?? '' },
    }, [
      el('div', { class: 'catalog-card-main' }, [
        el('div', { class: 'ocard-art' }, [img, fallback]),
        el('div', { class: 'catalog-card-text' }, [
          el(level, { class: 'catalog-card-title' }, preview),
          desc ? el('p', { class: 'catalog-card-desc', text: desc }) : el('p', { class: 'catalog-card-desc', hidden: true }),
          el('p', {
            class: 'catalog-card-meta',
            text: catalogMeta(list),
          }),
          // Measured against the stop's full order, every reading of it, so a filter never makes a
          // partly linked list look complete (decisions 3 and 7, P3).
          ...(linkText ? [el('p', {
            class: 'catalog-card-links',
            text: linkText(story),
          })] : []),
          el('div', { class: 'result-source' }, source ? [source] : []),
        ]),
      ]),
      el('div', { class: 'catalog-card-actions' }, primaryButton(list, reportTarget)),
    ]);
  }

  // Search answers with rows rather than cards, so six matching lists still leave the comics a
  // reader asked for within one phone screen (#1083). The row keeps the card's title Preview, its
  // credit line and its one action, and drops only the description, which Preview shows. The cover
  // is a small thumbnail so a list lines up with the series, creators and comics around it (#1204).
  function catalogRow(list, { report, level = 'h3', cover = null }) {
    return el('article', { class: 'result catalog-row search-row', dataset: { story: `list:${list.id}` } }, [
      ...(cover ? [cover(catalogCoverUrl(list, 'portrait_medium'))] : []),
      el('div', { class: 'result-main' }, [
        el(level, { class: 'catalog-card-title result-title' }, el('button', {
          class: 'catalog-card-preview',
          type: 'button',
          'aria-label': shownName([list.name], 'Preview'),
          dataset: { key: `list:${list.id}`, act: 'preview' },
          onclick: () => onPreview(list),
        }, el('span', { text: list.name }))),
        el('p', {
          class: 'result-meta',
          text: catalogMeta(list),
        }),
        el('div', { class: 'result-source' }, [attributionLine(list, { compact: true })].filter(Boolean)),
      ]),
      primaryButton(list, report),
    ]);
  }

  function paintTimelinePosition(root, position, {
    message = '',
    narrowed = false,
    progress = null,
    showFull = null,
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
        const note = status('hidden', message);
        root.prepend(note);
        // The way back to the whole timeline sits beside the sentence that says the stop is hidden
        // (decision 15), and carries the marker so the next paint removes it with the note.
        if (showFull) {
          note.after(el('button', {
            type: 'button',
            class: 'btn btn-g timeline-position-show-full',
            dataset: { timelinePosition: 'show-full' },
            text: 'Show full timeline',
            onclick: showFull,
          }));
        }
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
    catalogRow,
    chosenPath,
    ensureSetupGuideFeature,
    setSetupGuideVisibility,
    paintTimelinePosition,
    renderTimelineSections,
    resolver,
    issueUniverseLines,
    listUniverseLines,
    seriesUniverseLines,
    shelfSectionHead,
    universeRelationLine,
  };
}

export function sourceButton(el, list, createIcon = null) {
  const href = sourceLink(list);
  if (!href) return null;
  const site = sourceSiteName(href);
  if (site === 'Recap Page') return null;
  const label = `Visit ${site}`;
  return el('a', {
    class: 'btn btn-g list-source-link',
    href,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': `${label}, source of ${list.name} (opens in your browser)`,
  }, visitContent(label, createIcon));
}

export const PROJECT_HOME = 'https://raymond-nassar.github.io/recap-page/';

// The owner's decision on 2026-11-16: every Reading List screen carries a Visit button. A list with
// no outside website (a project selection, a reader's own list, a retired one) links the project's
// home page, and its name claims to be no list's source.
export function homeButton(el, createIcon = null) {
  return el('a', {
    class: 'btn btn-g list-home-link',
    href: PROJECT_HOME,
    target: '_blank',
    rel: 'noopener noreferrer',
    'aria-label': 'Visit the Recap Page website (opens in your browser)',
  }, visitContent('Visit the Recap Page website', createIcon));
}

export function visitButton(el, list, createIcon = null) {
  return (list && sourceButton(el, list, createIcon)) || homeButton(el, createIcon);
}

// The glyph marks the one button that leaves the app. It is decorative: the accessible name already
// says the link opens in your browser.
function visitContent(label, createIcon) {
  const glyph = createIcon?.('external', 'gi list-visit-glyph');
  return glyph ? [label, glyph] : label;
}

// Owner direction on 2026-11-16: readers see a site's everyday name, never a web address or a
// repository path. The fallback to the bare host exists only for a future source nobody has named
// yet, and the catalog test fails until that source is added here.
const SITE_NAMES = new Map([
  ['comicbookherald.com', 'Comic Book Herald'],
  ['comicbookreadingorders.com', 'Comic Book Reading Orders'],
  ['reddit.com', 'Reddit'],
  ['overdrive.com', 'OverDrive'],
  ['wikipedia.org', 'Wikipedia'],
  ['github.com', 'GitHub'],
]);

function sourceSiteName(href) {
  const url = new URL(href);
  const host = url.hostname.replace(/^www\./, '');
  if (host === 'github.com'
    && url.pathname.split('/').slice(1, 3).join('/') === 'raymond-nassar/recap-page') return 'Recap Page';
  const site = SITE_NAMES.get(host) || SITE_NAMES.get(host.replace(/^[a-z]{2,3}\.(?=wikipedia\.org$)/, ''));
  return site || host;
}
