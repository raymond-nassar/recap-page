import { labelledName } from '../../lib/accname.js';
import {
  catalogCoverUrl,
  catalogGapLabels,
  firstSentence,
  pickPath,
  sourceLabel,
  sourceLink,
  storyYear,
  updatedLabel,
  variantLabel,
} from '../../lib/catalog.js';
const CATALOG_ADD = '+ Add to library';

function domEl(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  const entries = Object.entries(props);
  for (const [key, value] of entries) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (key in node && key !== 'aria-label') node[key] = value;
    else node.setAttribute(key, value === true ? '' : String(value));
  }
  const values = Array.isArray(children) ? children : [children];
  for (const child of values) {
    if (child == null || child === false) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

function stopLink(stop, surface, {
  el = domEl,
  onGoToStop = () => {},
  text = stop.name,
  label = null,
  localStoryKeys = null,
  hrefForStop = (entry) => `#/${entry.shelf}`,
} = {}) {
  const dest = stop.shelf;
  if (dest === surface || localStoryKeys?.has(stop.key)) return null;
  return el('a', {
    href: hrefForStop(stop),
    'aria-label': label,
    onclick: (event) => {
      event.preventDefault();
      onGoToStop(stop);
    },
  }, text);
}

export function pathLine(
  placement,
  surface,
  { showBadge = true, localStoryKeys = null } = {},
  {
    el = domEl,
    onGoToStop = () => {},
    hrefForStop = (entry) => `#/${entry.shelf}`,
  } = {},
) {
  if (!placement) return null;
  const opens = placement.previous === null;
  const start = stopLink(placement.first, surface, {
    el,
    onGoToStop,
    text: placement.pathName,
    label: labelledName(placement.pathName, `Start at ${placement.first.name}`),
    localStoryKeys,
    hrefForStop,
  });
  const link = placement.next
    ? stopLink(placement.next, surface, {
      el, onGoToStop, localStoryKeys, hrefForStop,
    })
    : null;
  const lead = opens ? ` · Step 1 of ${placement.total} · ` : ' · ';
  const badge = showBadge ? el('span', {
    class: opens ? 'pill pill-start' : 'pill',
    text: opens ? 'Start here' : `Step ${placement.position} of ${placement.total}`,
  }) : null;
  return el('p', { class: 'result-meta path-step' }, [
    badge,
    el('span', {}, [
      start ?? placement.pathName,
      lead,
      ...(placement.next ? ['Next: ', link ?? placement.next.name] : ['Last stop']),
    ]),
  ].filter(Boolean));
}

export function createCatalogPresentation({
  el,
  elements,
  hueOf,
  isInLibrary,
  onAdd,
  onGoToStop,
  onOpen,
  onPreview,
  pathHref,
  paintCoverUrl,
  shortTitle,
}) {
  const pathChoice = new Map();

  function chosenPath(story) {
    return pickPath(story, pathChoice.get(story.key), (list) => isInLibrary(list.id));
  }

  function pathLabel(list) {
    return isInLibrary(list.id)
      ? `${variantLabel(list)} · in your library`
      : variantLabel(list);
  }

  function pathChooser(story, scope, paint) {
    if (story.lists.length < 2) return null;
    const selected = chosenPath(story);
    return el('fieldset', {
      class: 'paths',
      'aria-label': labelledName('Pick how much you want to read', story.name),
    }, [
      el('legend', { text: 'Pick how much you want to read' }),
      ...story.lists.map((list) => el('label', { class: 'fp path' }, [
        el('input', {
          type: 'radio',
          name: `${scope}-path-${story.key}`,
          checked: list === selected,
          dataset: { key: list.id, act: `path-${scope}` },
          onchange: () => {
            pathChoice.set(story.key, list.id);
            paint(list);
          },
        }),
        el('span', { text: pathLabel(list) }),
      ])),
    ]);
  }

  function markOwnedPaths(root, story) {
    if (!story) return;
    for (const input of root.querySelectorAll('input[type="radio"]')) {
      const list = story.lists.find((candidate) => candidate.id === input.dataset.key);
      if (list) input.nextElementSibling.textContent = pathLabel(list);
    }
  }

  function primaryButton(list, reportTarget) {
    const saved = isInLibrary(list.id);
    if (saved) {
      const text = 'Open →';
      return el('button', {
        class: 'btn',
        type: 'button',
        'aria-label': labelledName(text, list.name),
        dataset: { key: list.id, act: 'open' },
        onclick: () => onOpen(list, saved, reportTarget),
      }, text);
    }
    return el('button', {
      class: 'btn',
      type: 'button',
      'aria-label': labelledName(CATALOG_ADD, list.name),
      dataset: { key: list.id, act: 'import' },
      onclick: (event) => onAdd(list, event.currentTarget, reportTarget),
    }, CATALOG_ADD);
  }

  function attributionLine(list) {
    const label = sourceLabel(list);
    const href = sourceLink(list);
    const section = typeof list.sourceSection === 'string' && list.sourceSection.trim()
      ? list.sourceSection.trim()
      : null;
    const updated = updatedLabel(list);
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
    return el('details', { class: 'result-src' }, [
      el('summary', { 'aria-label': `Source of ${list.name}` }, 'Source'),
      el('p', { class: 'result-meta result-source' }, parts),
    ]);
  }

  function pathDisclosure(placement, surface, { localStoryKeys = null } = {}) {
    if (!placement) return null;
    const opens = placement.previous === null;
    const summary = opens ? `Start · 1/${placement.total}` : `Step ${placement.position}/${placement.total}`;
    return el('details', { class: 'result-path' }, [
      el('summary', {
        'aria-label': `${summary}. Show path details for ${placement.pathName}`,
      }, summary),
      pathLine(
        placement,
        surface,
        { showBadge: false, localStoryKeys },
        { el, onGoToStop, hrefForStop: pathHref },
      ),
    ]);
  }

  function catalogCard(story, placement, {
    surface = 'catalog',
    report = null,
    localStoryKeys = null,
    level = 'h3',
    titleId = null,
  } = {}) {
    const reportTarget = report ?? `#${surface}-report`;
    const title = story.name ?? story.lists[0].name;
    const img = el('img', { alt: '', loading: 'lazy', decoding: 'async' });
    const fallback = el('div', { class: 'of cover-fallback', 'aria-hidden': true }, [
      el('span', { class: 'ofs', text: shortTitle(title) }),
    ]);
    const desc = el('p', { class: 'catalog-card-desc' });
    const meta = el('p', { class: 'catalog-card-meta' });
    const source = el('div', { class: 'result-source' });
    const path = pathDisclosure(placement, surface, { localStoryKeys });
    const disclosures = el('div', { class: 'catalog-card-disclosures' }, [path, source].filter(Boolean));
    const actions = el('div', { class: 'catalog-card-actions' });

    const paint = (list) => {
      paintCoverUrl(img, fallback, catalogCoverUrl(list), hueOf(title), title);
      desc.textContent = firstSentence(list.description);
      desc.hidden = !desc.textContent;
      meta.textContent = [
        `${list.count} issue${list.count === 1 ? '' : 's'}`,
        ...catalogGapLabels(list),
      ].join(' · ');
      source.replaceChildren(...[attributionLine(list)].filter(Boolean));
      const previewText = story.lists.length > 1 ? `${story.lists.length} reading options` : 'Preview';
      actions.replaceChildren(
        primaryButton(list, reportTarget),
        el('button', {
          class: 'btn btn-g',
          type: 'button',
          'aria-label': labelledName(previewText, title),
          dataset: { key: story.key, act: 'preview' },
          onclick: () => onPreview(list, story),
        }, previewText),
      );
    };
    paint(chosenPath(story));

    const year = storyYear(story);
    return el('article', {
      class: 'catalog-card',
      dataset: { story: story.key, year: year ?? '' },
    }, [
      el('div', { class: 'catalog-card-main' }, [
        el('div', { class: 'ocard-art' }, [img, fallback]),
        el('div', { class: 'catalog-card-text' }, [
          el(level, { id: titleId, class: 'catalog-card-title', text: title }),
          desc,
          meta,
          disclosures,
        ]),
      ]),
      actions,
    ]);
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

  function renderTimelineSections(box, sections, placements, {
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
          grid.append(catalogCard(story, placements.get(story.key), {
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
          grid.append(catalogCard(story, placements.get(story.key), {
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

  function ensureSetupGuideFeature(lists, surface, featuredCard) {
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
    const context = surface === 'catalog'
      ? 'This app chooses 1998 as the start of its Modern Timeline. It is not an official Marvel editorial-era boundary.'
      : 'Read this orientation guide first for the earlier stories that lead into this age.';
    const feature = el('section', {
      id: featureId,
      class: 'setup-guide-feature',
      'aria-labelledby': titleId,
      dataset: { featuredList: list.id },
    }, [
      el('div', { class: 'setup-guide-context' }, [
        el('p', { class: 'eyebrow', text: surface === 'catalog' ? 'Recommended start' : 'Earlier context' }),
        el('p', { text: context }),
      ]),
      el('div', { class: 'catalog-grid setup-guide-grid' }, [
        catalogCard(story, null, {
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
    catalogCard,
    chosenPath,
    ensureSetupGuideFeature,
    markOwnedPaths,
    pathChooser,
    renderTimelineSections,
    shelfSectionHead,
  };
}
