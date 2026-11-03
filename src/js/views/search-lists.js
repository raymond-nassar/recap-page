import { listSearchTerms, rankLists } from '../lib/listSearch.js';

export const LIST_RESULTS_INITIAL = 6;
const ANNOUNCE_DELAY_MS = 500;

const counted = (n) => (n === 1 ? '1 Reading List matches' : `${n} Reading Lists match`);

// Reading Lists are matched on the device from the bundled catalog as the reader types. Nothing
// here talks to the metadata service or writes anything, so a list search is never recorded.
// Issue search stays on its own submit, unchanged, because it needs the network.
export function createSearchListsView({
  elements, loadCatalog, loadGuides, presentation, announce,
  setTimer = setTimeout, clearTimer = clearTimeout,
}) {
  let generation = 0;
  let query = '';
  let found = [];
  let expanded = false;
  let timer = null;

  function quiet() {
    clearTimer(timer);
    timer = null;
  }

  // Every keystroke re-renders, but a count read out per keystroke talks over the reader's own
  // typing, so only the count standing when typing pauses is announced.
  function say(message) {
    quiet();
    timer = setTimer(() => {
      timer = null;
      announce(message);
    }, ANNOUNCE_DELAY_MS);
  }

  function card(list) {
    return presentation.catalogRow(list, { report: '#search-lists-report', level: 'h3' });
  }

  function render() {
    const nodes = elements();
    const shown = expanded ? found : found.slice(0, LIST_RESULTS_INITIAL);
    nodes.section.hidden = false;
    nodes.count.textContent = found.length ? counted(found.length) : 'No Reading Lists match';
    nodes.grid.replaceChildren(...shown.map(card));
    nodes.grid.hidden = !shown.length;
    nodes.more.hidden = shown.length === found.length;
    nodes.more.textContent = `Show all ${found.length} Reading Lists`;
    return nodes;
  }

  async function update(next) {
    if (next !== query) expanded = false;
    query = next;
    const mine = ++generation;
    if (!listSearchTerms(query).length) {
      found = [];
      quiet();
      elements().section.hidden = true;
      return;
    }
    let catalog;
    let guides;
    try {
      [catalog, guides] = await Promise.all([loadCatalog(), loadGuides().catch(() => null)]);
    } catch (error) {
      if (mine !== generation) return;
      found = [];
      const nodes = render();
      nodes.count.textContent = `Reading Lists could not be loaded: ${error.message}. Comic search still works.`;
      say(nodes.count.textContent);
      return;
    }
    if (mine !== generation) return;
    found = rankLists(catalog.lists, query, { guides });
    say(render().count.textContent);
  }

  async function showAll() {
    const from = expanded ? found.length : LIST_RESULTS_INITIAL;
    expanded = true;
    const nodes = render();
    nodes.grid.children[from]?.querySelector('.catalog-card-preview')?.focus();
  }

  // After Preview adds a list its card has to turn from Add into Open without losing the group.
  async function refresh() {
    if (found.length) render();
  }

  return { update, showAll, refresh };
}
