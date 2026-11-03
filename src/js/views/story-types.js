import {
  STORY_TONES, STORY_TYPES, STORY_TYPES_ROUTE, catalogEntries, storyTypeFacets, storyTypeStarters,
  storyTypeStories,
} from '../lib/catalog.js';

const ROUTE = STORY_TYPES_ROUTE;

const known = (vocabulary, value) => (Object.hasOwn(vocabulary, value ?? '') ? value : null);

// Choices remain in the address, so the filtered shelf can be bookmarked and restored with Back.
export function createStoryTypesView({
  el, elements, isCurrent, presentation, onNavigate,
}) {
  let type = null;
  let tone = null;
  let catalog = null;
  let requestIsCurrent = () => false;
  let root;
  let typeSelect;
  let toneSelect;
  let keyboardRun = false;
  let runAddressed = false;

  function endRun() {
    keyboardRun = false;
    runAddressed = false;
  }

  function keyboardChoice(event) {
    if (!event.ctrlKey && !event.altKey && !event.metaKey
      && (event.key.startsWith('Arrow') || ['Home', 'End', 'PageUp', 'PageDown'].includes(event.key)
        || event.key.length === 1)) keyboardRun = true;
  }

  function controls() {
    if (!root) {
      typeSelect = el('select', {
        id: `${ROUTE}-type`,
        onkeydown: keyboardChoice,
        onpointerdown: endRun,
        onfocusout: endRun,
        onchange: (event) => choose({ storyType: event.currentTarget.value, tone }),
      });
      toneSelect = el('select', {
        id: `${ROUTE}-tone`,
        onkeydown: keyboardChoice,
        onpointerdown: endRun,
        onfocusout: endRun,
        onchange: (event) => choose({ storyType: type, tone: event.currentTarget.value }),
      });
      root = el('div', { id: `${ROUTE}-choices`, class: 'story-type-choices' }, [
        group('Genre', typeSelect),
        group('Tone', toneSelect),
      ]);
    }
    return root;
  }

  function selection() {
    return { storyType: type, tone };
  }

  function set({ storyType = null, tone: nextTone = null } = {}) {
    type = known(STORY_TYPES, storyType);
    tone = known(STORY_TONES, nextTone);
  }

  function choose(next) {
    set(next);
    paint();
    onNavigate({ push: !keyboardRun || !runAddressed });
    if (keyboardRun) runAddressed = true;
  }

  function group(heading, select) {
    return el('div', { class: 'story-type-group' }, [
      el('label', { for: select.id, class: 'story-type-label', text: heading }),
      select,
    ]);
  }

  function paintChoices(stories) {
    const facets = storyTypeFacets(stories, { type, tone });
    controls();
    for (const [select, any, choices, value] of [
      [typeSelect, 'Any genre', facets.types, type],
      [toneSelect, 'Any tone', facets.tones, tone],
    ]) {
      select.replaceChildren(
        el('option', { value: '', text: any }),
        ...choices.map(({ key, label, count }) => el('option', { value: key, text: `${label} (${count})` })),
      );
      select.value = value ?? '';
    }
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
      const starters = storyTypeStarters(stories);
      if (!starters.length) {
        nodes.results.append(el('p', {
          class: 'rail-hint',
          text: 'Choose a genre or a tone to see its Reading Lists.',
        }));
        return;
      }
      nodes.results.append(results(starters, 'Popular places to start', 'Or choose a genre or tone above.'));
      return;
    }
    const matches = storyTypeStories(stories, { type, tone });
    nodes.count.textContent = `${matches.length} of ${all.length} Reading Lists`;
    const heading = [STORY_TYPES[type], STORY_TONES[tone]].filter(Boolean).join(', ');
    if (!matches.length) {
      nodes.results.append(el('p', {
        class: 'rail-hint publishing-empty',
        text: `No Reading Lists are tagged ${heading}. Choose another genre or tone.`,
      }));
      return;
    }
    nodes.results.append(results(matches, heading));
  }

  function results(stories, heading, hint = null) {
    const grid = el('div', { class: 'catalog-grid publishing-grid' });
    for (const story of stories) {
      grid.append(presentation.catalogCard(story, {
        surface: ROUTE, report: `#${ROUTE}-report`, level: 'h3',
      }));
    }
    return el('section', { class: 'story-type-results', 'aria-labelledby': `${ROUTE}-results-h` }, [
      el('h2', { id: `${ROUTE}-results-h`, class: 'shelf-section-title', text: heading }),
      ...(hint ? [el('p', { class: 'rail-hint', text: hint })] : []),
      grid,
    ]);
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
