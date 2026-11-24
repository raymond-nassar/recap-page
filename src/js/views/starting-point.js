import {
  catalogEntries, shelfStories, sortSpotlightStories, spotlightRankForStory, SPOTLIGHT_POPULARITY_RANKS,
} from '../lib/catalog.js';

const FAMILIARITY = new Set(['new', 'experienced']);

const RANKED_SUBJECTS = new Map(SPOTLIGHT_POPULARITY_RANKS.map(({ rank, label }) => [rank, label]));

// The question asks who to read about, so each choice is named for its subject rather than its
// guide. A ranked guide takes the owner's ranking label; the rest of the spotlight titles already
// read as a name, except these, each checked by hand against the guide's own title and the
// headline character it lists first. Nothing here is guessed from a character the guide merely
// includes.
const SUBJECT_BY_LIST = new Map([
  ['amazing-spider-man-reading-order-modern-marvel-era', 'Spider-Man (Peter Parker)'],
  ['nightcrawler-best-of', 'Nightcrawler'],
  ['miles-morales-best-of', 'Miles Morales'],
  ['miles-morales-spider-man-reading-order', 'Miles Morales'],
  ['question-of-the-week-do-you-have-a-hulk-reading-order', 'Hulk'],
  ['modern-x-men-fast-track', 'X-Men'],
  ['the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order', 'Apocalypse'],
  ['captain-america-reading-order-modern-marvel-era', 'Captain America'],
  ['doctor-doom-primer', 'Doctor Doom'],
  ['deadpool-best-of', 'Deadpool'],
]);

function subjectOf(story) {
  const list = story.lists[0];
  return RANKED_SUBJECTS.get(spotlightRankForStory(story)) ?? SUBJECT_BY_LIST.get(list.id) ?? list.name;
}

// One choice per subject, in the spotlights' popularity order. A subject with several guides
// offers the first of them, so every choice still leads to exactly one result.
export function favoriteChoices(stories) {
  const seen = new Set();
  const choices = [];
  for (const story of stories) {
    const subject = subjectOf(story);
    if (seen.has(subject)) continue;
    seen.add(subject);
    choices.push({ value: story.lists[0].id, subject, story });
  }
  return choices;
}

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
    return catalog
      ? favoriteChoices(sortSpotlightStories(shelfStories(catalogEntries(catalog.lists), 'spotlights'), 'popularity'))
      : [];
  }

  function chosenStory() {
    return favorite ? favorites().find((choice) => choice.value === favorite)?.story ?? null : null;
  }

  function outcome() {
    const story = chosenStory();
    if (story) return { kind: 'match', story };
    return { kind: familiarity === 'experienced' ? 'timeline' : 'starters' };
  }

  function paintAnswers() {
    const nodes = elements();
    for (const radio of nodes.familiarity) radio.checked = radio.value === familiarity;
    const choices = favorites();
    nodes.favorite.replaceChildren(
      el('option', { value: '', text: 'No preference' }),
      ...choices.map((choice) => el('option', { value: choice.value, text: choice.subject })),
    );
    nodes.favorite.value = choices.some((choice) => choice.value === favorite) ? favorite : '';
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
