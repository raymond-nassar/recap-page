import {
  STORY_TONES, STORY_TYPES, STORY_TYPES_ROUTE, catalogEntries, storyTypeFacets, storyTypeStories,
} from '../lib/catalog.js';
import { formatRoute, isPlainNavigation } from '../lib/route.js';

const ROUTE = STORY_TYPES_ROUTE;

const known = (vocabulary, value) => (Object.hasOwn(vocabulary, value ?? '') ? value : null);

// Browsing by story type and tone (#1060). Each choice is a link to its own address rather than a
// radio, so a story type can be bookmarked, opened in a new tab, and returned to with Back.
export function createStoryTypesView({
  el, elements, isCurrent, presentation, onNavigate,
}) {
  let type = null;
  let tone = null;
  let catalog = null;
  let requestIsCurrent = () => false;
  let root;

  function controls() {
    root ??= el('nav', { id: `${ROUTE}-choices`, class: 'story-type-choices', 'aria-label': 'Story types and tones' });
    return root;
  }

  function selection() {
    return { storyType: type, tone };
  }

  function set({ storyType = null, tone: nextTone = null } = {}) {
    type = known(STORY_TYPES, storyType);
    tone = known(STORY_TONES, nextTone);
  }

  function choose(next, focusKey) {
    set(next);
    paint();
    onNavigate();
    root?.querySelector(`a[data-choice="${focusKey}"]`)?.focus();
  }

  function pill({ choice, label, count, next, current }) {
    return el('li', {}, el('a', {
      href: formatRoute({ view: ROUTE, ...next }),
      class: 'story-type-pill',
      'aria-current': current ? 'true' : null,
      dataset: { choice },
      text: count == null ? label : `${label} (${count})`,
      onclick: (event) => {
        if (!isPlainNavigation(event)) return;
        event.preventDefault();
        choose(next, choice);
      },
    }));
  }

  function group(id, heading, pills) {
    return el('div', { class: 'story-type-group' }, [
      el('p', { id, class: 'story-type-label', text: heading }),
      el('ul', { class: 'story-type-pills', 'aria-labelledby': id }, pills),
    ]);
  }

  function paintChoices(stories) {
    const facets = storyTypeFacets(stories, { type, tone });
    controls().replaceChildren(
      group(`${ROUTE}-type-h`, 'Story type', [
        pill({ choice: 'type:any', label: 'Any story type', next: { storyType: null, tone }, current: !type }),
        ...facets.types.map(({ key, label, count }) => pill({
          choice: `type:${key}`, label, count, next: { storyType: key, tone }, current: key === type,
        })),
      ]),
      group(`${ROUTE}-tone-h`, 'Tone', [
        pill({ choice: 'tone:any', label: 'Any tone', next: { storyType: type, tone: null }, current: !tone }),
        ...facets.tones.map(({ key, label, count }) => pill({
          choice: `tone:${key}`, label, count, next: { storyType: type, tone: key }, current: key === tone,
        })),
      ]),
    );
  }

  function paint() {
    if (!catalog || !isCurrent() || !requestIsCurrent()) return;
    const nodes = elements();
    const stories = catalogEntries(catalog.lists);
    paintChoices(stories);
    const all = storyTypeStories(stories);
    nodes.results.replaceChildren();
    if (!type && !tone) {
      nodes.count.textContent = `${all.length} ${all.length === 1 ? 'Reading List' : 'Reading Lists'}`;
      nodes.results.append(el('p', {
        class: 'rail-hint',
        text: 'Choose a story type or a tone to see its Reading Lists.',
      }));
      return;
    }
    const matches = storyTypeStories(stories, { type, tone });
    nodes.count.textContent = `${matches.length} of ${all.length} Reading Lists`;
    const heading = [STORY_TYPES[type], STORY_TONES[tone]].filter(Boolean).join(', ');
    if (!matches.length) {
      nodes.results.append(el('p', {
        class: 'rail-hint publishing-empty',
        text: `No Reading Lists are tagged ${heading}. Choose another story type or tone.`,
      }));
      return;
    }
    const grid = el('div', { class: 'catalog-grid publishing-grid' });
    for (const story of matches) {
      grid.append(presentation.catalogCard(story, {
        surface: ROUTE, report: `#${ROUTE}-report`, level: 'h3',
      }));
    }
    nodes.results.append(el('section', { class: 'story-type-results', 'aria-labelledby': `${ROUTE}-results-h` }, [
      el('h2', { id: `${ROUTE}-results-h`, class: 'shelf-section-title', text: heading }),
      grid,
    ]));
  }

  function render(nextCatalog, { isCurrent: currentRequest } = {}) {
    catalog = nextCatalog;
    requestIsCurrent = currentRequest ?? isCurrent;
    paint();
  }

  return {
    controls, render, selection, set,
  };
}
