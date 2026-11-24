import { catalogEntries, shelfStories, sortSpotlightStories } from '../lib/catalog.js';

const FAMILIARITY = new Set(['new', 'experienced']);

// The two answers live only in this closure, so they last for the visit and never reach the saved
// library, progress, a backup, storage or the address (the owner's rule for this guide). A reload
// starts the questions again, and render() writes them back over any form state a browser restored.
export function createStartingPointView({
  el, elements, isCurrent, loadCatalog, presentation,
  announce = () => {}, onLoadFailure = async () => {}, clearLoadNotice = () => {},
}) {
  let familiarity = null;
  let favorite = '';
  let catalog = null;
  let generation = 0;
  let wired = false;

  function favorites() {
    return catalog ? sortSpotlightStories(shelfStories(catalogEntries(catalog.lists), 'spotlights'), 'popularity') : [];
  }

  function chosenStory() {
    return favorite ? favorites().find((story) => story.lists[0].id === favorite) ?? null : null;
  }

  function outcome() {
    const story = chosenStory();
    if (story) return { kind: 'match', story };
    return { kind: familiarity === 'experienced' ? 'timeline' : 'starters' };
  }

  function paintAnswers() {
    const nodes = elements();
    for (const radio of nodes.familiarity) radio.checked = radio.value === familiarity;
    const stories = favorites();
    nodes.favorite.replaceChildren(
      el('option', { value: '', text: 'No preference' }),
      ...stories.map((story) => el('option', { value: story.lists[0].id, text: story.lists[0].name })),
    );
    nodes.favorite.value = stories.some((story) => story.lists[0].id === favorite) ? favorite : '';
  }

  function paintResult() {
    const nodes = elements();
    const result = outcome();
    nodes.starters.hidden = result.kind !== 'starters';
    nodes.timeline.hidden = result.kind !== 'timeline';
    nodes.match.hidden = result.kind !== 'match';
    nodes.match.replaceChildren(...(result.kind === 'match'
      ? [presentation.catalogCard(result.story, {
        surface: 'new-to-comics', report: '#guide-preview-report', level: 'h3',
      })]
      : []));
    return result;
  }

  // Focus stays on the answer being changed, so the reader hears which result now follows it.
  function answered() {
    const result = paintResult();
    const nodes = elements();
    announce(result.kind === 'match'
      ? result.story.lists[0].name
      : (result.kind === 'timeline' ? nodes.timeline : nodes.starters).textContent.trim());
  }

  function wire() {
    if (wired) return;
    wired = true;
    const nodes = elements();
    for (const radio of nodes.familiarity) {
      radio.addEventListener('change', () => {
        if (!radio.checked || !FAMILIARITY.has(radio.value)) return;
        familiarity = radio.value;
        answered();
      });
    }
    nodes.favorite.addEventListener('change', () => {
      favorite = nodes.favorite.value;
      answered();
    });
  }

  async function render() {
    wire();
    const current = ++generation;
    const live = () => current === generation && isCurrent();
    paintAnswers();
    paintResult();
    let next;
    try {
      next = await loadCatalog();
    } catch (error) {
      if (!live()) return;
      await onLoadFailure({ error, isCurrent: live, retry: () => render() });
      return;
    }
    if (!live()) return;
    clearLoadNotice();
    catalog = next;
    paintAnswers();
    paintResult();
  }

  return { render, answers: () => ({ familiarity, favorite }) };
}
