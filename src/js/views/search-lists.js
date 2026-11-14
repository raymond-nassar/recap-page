import { listSearchTerms, rankLists } from '../lib/listSearch.js';
import { foldName } from '../lib/nameIndex.js';
import { suggestNames } from '../lib/searchSpelling.js';
import { universeResolver } from '../lib/universes.js';

export const SCOPES = ['top', 'lists', 'universes', 'series', 'creators', 'comics'];
export const TOP_PER_GROUP = 3;
export const NAME_PAGE = 40;
export const COMICS_SHOWN_CAP = 50;
const ANNOUNCE_DELAY_MS = 500;
const APP_ICON = './icons/icon.svg';

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

export function listsLine(n) {
  return n ? plural(n, 'Reading List', 'Reading Lists') : 'No Reading Lists match';
}
export function universesLine(n) {
  return n ? plural(n, 'universe', 'universes') : 'No universes match';
}
export function seriesLine(n) {
  return n ? plural(n, 'series', 'series') : 'No series match';
}
export function creatorsLine(n) {
  return n ? plural(n, 'creator', 'creators') : 'No creators match';
}
// A count of comics shown, never a total: the metadata service answers at most fifty, and a
// number that looked like a total would tell a reader that the rest do not exist.
export function comicsLine(n) {
  if (!n) return 'No comics match.';
  return `${plural(n, 'comic', 'comics')} shown.${n >= COMICS_SHOWN_CAP ? ' Add words to narrow.' : ''}`;
}
const comicShort = (n) => (n ? `${plural(n, 'comic', 'comics')} shown` : 'No comics match');
export const OFFLINE_LINE = 'Comics need a connection. Lists, universes, series and creators still work offline.';

const EMPTY_HINTS = {
  lists: 'Type a Reading List name to find it.',
  universes: 'Type a universe name or Earth designation to find it.',
  series: 'Type a series name to find it.',
  creators: 'Type a creator’s name to find them.',
  comics: 'Type a comic title, then press Enter to look it up.',
};

// A row cover: the provider's cover where there is one, and the app icon where there is not, so
// a series or creator row, which has no cover of its own, still lines up with the comics.
export function searchThumb(el, url) {
  const box = el('span', { class: 'search-thumb', 'aria-hidden': 'true' }, [
    el('img', { class: 'search-thumb-icon', src: APP_ICON, alt: '' }),
  ]);
  if (url) {
    const img = el('img', { src: url, alt: '', loading: 'lazy', decoding: 'async' });
    img.addEventListener('error', () => img.remove());
    box.append(img);
  }
  return box;
}

// Search design B (#1204). Reading Lists, universes, series and creators are matched on the device as the
// reader types, from the bundled catalog and name indexes, so they work offline and are never
// recorded. Comics need the metadata service, so they are looked up once per query on Enter or
// when opening the Comics scope.
// A scope switch only hides and shows groups that are already
// built: the comic rows and their checkboxes are never rebuilt, so picks survive, and a switch
// sends nothing unless Comics has not yet been looked up for this query.
export function createSearchListsView({
  el,
  elements,
  loadCatalog,
  loadGuides,
  searchNames,
  presentation,
  thumb,
  universeRow,
  comics,
  openNamed,
  announce,
  isOnline = () => globalThis.navigator?.onLine !== false,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
}) {
  let generation = 0;
  let query = '';
  let scope = 'top';
  let timer = null;
  let settled = false;
  let suggested = { lists: [], universes: [], series: [], creators: [] };
  let renderedSuggestions = '';
  let limits = { series: NAME_PAGE, creators: NAME_PAGE };
  const found = {
    lists: [], universes: [], series: null, creators: null, error: {},
  };
  // The comic lookup the results pane currently holds, as reported by the add view's runner.
  let comic = { query: null, phase: null, count: 0 };

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

  const terms = () => listSearchTerms(query).length > 0;
  const comicsHere = () => comic.query === query.trim() && query.trim() !== '';
  const total = (kind) => (kind === 'lists' || kind === 'universes' ? found[kind].length : found[kind]?.matched ?? 0);

  function comicsCount() {
    if (comicsHere()) {
      if (comic.phase === 'running') return 'Looking up comics…';
      if (comic.phase === 'complete') return comicsLine(comic.count);
      if (comic.phase === 'failed' || comic.phase === 'cancelled') {
        return 'Comics could not be looked up. Press Enter to try again.';
      }
    }
    if (!isOnline()) return OFFLINE_LINE;
    return `Press Enter to look up comics matching “${query.trim()}”.`;
  }

  function lineFor(kind) {
    if (found.error[kind]) return found.error[kind];
    if (kind === 'lists') return listsLine(total('lists'));
    if (kind === 'universes') return universesLine(total('universes'));
    if (kind === 'series') return seriesLine(total('series'));
    if (kind === 'creators') return creatorsLine(total('creators'));
    return comicsCount();
  }

  function countText() {
    if (!terms()) return EMPTY_HINTS[scope] ?? '';
    if (scope === 'top') return `Top results for “${query.trim()}”`;
    if (scope === 'universes' && !total('universes')) return 'No universes match. Try another name or Earth designation.';
    return lineFor(scope);
  }

  function suggestions() {
    if (!settled || !terms() || scope === 'comics') return [];
    // Comics found for the typed title show the spelling was a real one, so Top stops doubting it.
    if (scope === 'top' && comicsHere() && comic.phase === 'complete' && comic.count > 0) return [];
    const kinds = scope === 'top' ? ['lists', 'universes', 'series', 'creators'] : [scope];
    if (kinds.some((kind) => found.error[kind] || total(kind) > 0)) return [];
    const unique = new Map();
    for (const kind of kinds) {
      for (const name of suggested[kind]) if (!unique.has(foldName(name))) unique.set(foldName(name), name);
    }
    const names = [...unique.values()];
    if (scope === 'top') names.sort((a, b) => a.length - b.length || a.localeCompare(b));
    return names.slice(0, 3);
  }

  function announcement() {
    let message = countText();
    if (terms() && scope === 'top') {
      const parts = ['lists', 'universes', 'series', 'creators'].map(lineFor);
      if (comicsHere() && comic.phase === 'complete') parts.push(comicShort(comic.count));
      message = `${message}. ${parts.join(', ')}.`;
    }
    const names = suggestions();
    return names.length ? `${message.replace(/\.$/, '')}. Did you mean ${names.join(', ')}?` : message;
  }

  function chooseSuggestion(name) {
    const input = elements().input;
    input.value = name;
    input.focus({ preventScroll: true });
    return update(name);
  }

  function renderSuggestions(nodes) {
    const names = suggestions();
    nodes.suggestions.hidden = !names.length;
    const key = names.join('\0');
    if (key === renderedSuggestions) return;
    renderedSuggestions = key;
    nodes.suggestions.replaceChildren(...(names.length ? [
      el('span', { text: 'Did you mean' }),
      ...names.map((name) => el('button', {
        type: 'button', class: 'btn btn-g', 'aria-label': `Search for ${name}`,
        onclick: () => chooseSuggestion(name),
      }, name)),
    ] : []));
  }

  function nameRow(kind, item) {
    const meta = item.issueCount == null
      ? 'An unknown number of comics'
      : plural(item.issueCount, 'comic', 'comics');
    return el('article', { class: 'result search-row' }, [
      thumb(null),
      el('div', { class: 'result-main' }, [
        el('h3', { class: 'result-title', text: item.name }),
        el('p', { class: 'result-meta', text: `${kind === 'series' ? 'Series' : 'Creator'}, ${meta}` }),
      ]),
      el('button', {
        type: 'button',
        class: 'btn btn-g',
        'aria-label': `Open ${item.name}`,
        dataset: { act: 'open-named' },
        onclick: () => openNamed(kind === 'series' ? 'series' : 'creator', item),
      }, 'Open'),
    ]);
  }

  function renderGroup(kind, nodes, rebuild) {
    const group = nodes[kind];
    const show = scope === 'top' ? total(kind) > 0 : scope === kind;
    group.section.hidden = !show || !terms();
    if (group.section.hidden || !rebuild) return;
    const all = kind === 'lists' || kind === 'universes' ? found[kind] : found[kind]?.items ?? [];
    const rows = scope === 'top' ? all.slice(0, TOP_PER_GROUP) : all;
    group.grid.replaceChildren(...rows.map((item) => {
      if (kind === 'lists') return presentation.catalogRow(item, { report: '#search-lists-report', level: 'h3', cover: thumb });
      if (kind === 'universes') return universeRow(item);
      return nameRow(kind, item);
    }));
    const count = total(kind);
    if (scope === 'top') {
      group.more.hidden = count <= TOP_PER_GROUP;
      group.more.textContent = `See all ${lineFor(kind)}`;
    } else {
      group.more.hidden = kind === 'lists' || kind === 'universes' || rows.length >= count;
      group.more.textContent = kind === 'series' ? 'Show more series' : 'Show more creators';
    }
  }

  // A comic lookup settling changes only the comic pane and the count, so it leaves the local rows
  // standing: rebuilding them would drop the focus of a reader already working down them.
  function render({ rebuild = true, preserveUniverses = false } = {}) {
    const nodes = elements();
    const active = terms();
    nodes.card.dataset.scope = scope;
    nodes.browse.hidden = active || scope !== 'top';
    nodes.scopes.hidden = !active && scope === 'top';
    for (const button of nodes.scopes.querySelectorAll('[data-scope]')) {
      button.setAttribute('aria-pressed', String(button.dataset.scope === scope));
    }
    nodes.count.hidden = nodes.scopes.hidden;
    nodes.count.textContent = countText();
    renderSuggestions(nodes);
    nodes.panes.hidden = !active;
    for (const kind of ['lists', 'universes', 'series', 'creators']) {
      renderGroup(kind, nodes, rebuild && !(kind === 'universes' && preserveUniverses));
    }
    nodes.empty.hidden = !(active && settled && scope === 'top'
      && ['lists', 'universes', 'series', 'creators'].every((kind) => !found.error[kind] && total(kind) === 0)
      && !(comicsHere() && comic.phase === 'complete' && comic.count > 0));
    nodes.empty.textContent = 'No local results match. Try another name or Earth designation.';
    const comicsShown = active && comicsHere() && (scope === 'top' ? comic.phase !== 'cancelled' : scope === 'comics');
    nodes.comics.section.hidden = !comicsShown;
    nodes.comics.more.hidden = scope !== 'top' || !(comic.phase === 'complete' && comic.count > TOP_PER_GROUP);
    nodes.comics.more.textContent = `See all ${plural(comic.count, 'comic', 'comics')}`;
    nodes.panes.classList.toggle('has-comics', comicsShown && scope === 'top');
    return nodes;
  }

  async function update(next) {
    quiet();
    settled = false;
    suggested = { lists: [], universes: [], series: [], creators: [] };
    renderSuggestions(elements());
    if (next !== query) {
      limits = { series: NAME_PAGE, creators: NAME_PAGE };
      found.lists = [];
      found.series = null;
      found.creators = null;
      found.error = {};
    }
    query = next;
    const mine = ++generation;
    found.universes = terms() ? universeResolver.searchUniverses(query) : [];
    if (!terms()) {
      found.lists = [];
      found.series = null;
      found.creators = null;
      found.error = {};
      settled = true;
      quiet();
      render();
      return;
    }
    render();
    const settle = (promise) => promise.then((value) => ({ value }), (error) => ({ error }));
    const [catalog, guides, series, creators] = await Promise.all([
      settle(loadCatalog()),
      settle(loadGuides()),
      settle(searchNames('series', query, { limit: limits.series, suggest: true })),
      settle(searchNames('creators', query, { limit: limits.creators, suggest: true })),
    ]);
    if (mine !== generation) return;
    found.error = {};
    if (catalog.error) {
      found.lists = [];
      found.error.lists = `Reading Lists could not be loaded: ${catalog.error.message}.`;
    } else {
      found.lists = rankLists(catalog.value.lists, query, { guides: guides.value ?? null });
    }
    found.series = series.value ?? null;
    if (series.error) found.error.series = `Series could not be loaded: ${series.error.message}.`;
    found.creators = creators.value ?? null;
    if (creators.error) found.error.creators = `Creators could not be loaded: ${creators.error.message}.`;
    suggested = {
      lists: !catalog.error && !found.lists.length ? suggestNames(catalog.value.lists, query) : [],
      universes: !found.universes.length ? suggestNames(universeResolver.searchUniverses(''), query) : [],
      series: series.value?.suggestions ?? [],
      creators: creators.value?.suggestions ?? [],
    };
    settled = true;
    render({ preserveUniverses: true });
    say(announcement());
  }

  function setScope(next, { focus = true } = {}) {
    if (!SCOPES.includes(next)) return;
    scope = next;
    const started = scope === 'comics' && terms() && !comicsHere() && isOnline();
    if (started) comics.lookup(query.trim());
    const nodes = render();
    // Top with an empty box hides the scope buttons, so the pressed one cannot keep focus and the
    // box takes it rather than letting it fall to the page.
    if (focus) {
      const target = nodes.scopes.hidden ? nodes.input : nodes.scopes.querySelector(`[data-scope="${scope}"]`);
      target?.focus({ preventScroll: true });
    }
    quiet();
    // A lookup this switch started speaks its own busy notice, so the count line would say it twice.
    if (terms() && !started && settled) announce(announcement());
  }

  // Enter in the box. Offline sends nothing and says so; the local groups are already showing.
  // The field is read again because a browser can restore or fill it without an input event.
  function submit(value = query) {
    if (value !== query) void update(value);
    const q = query.trim();
    if (!terms() || !['top', 'comics'].includes(scope)) return;
    if (!isOnline()) {
      render();
      quiet();
      announce(OFFLINE_LINE);
      return;
    }
    if (!comicsHere() || comic.phase === 'failed' || comic.phase === 'cancelled') comics.lookup(q, { reveal: true });
  }

  // A Browse tile for a local scope: press the scope and hand the reader the box.
  function startScope(next, input) {
    setScope(next, { focus: false });
    input.focus();
  }

  async function showMore(kind) {
    if (scope === 'top') {
      setScope(kind);
      return;
    }
    if (kind !== 'series' && kind !== 'creators') return;
    const from = found[kind]?.items.length ?? 0;
    limits = { ...limits, [kind]: limits[kind] + NAME_PAGE };
    const mine = ++generation;
    try {
      found[kind] = await searchNames(kind, query, { limit: limits[kind] });
    } catch {
      return;
    }
    if (mine !== generation) return;
    const nodes = render();
    nodes[kind].grid.children[from]?.querySelector('button')?.focus();
  }

  function comicStatus(status) {
    comic = {
      query: status.item?.name ?? null,
      phase: status.phase,
      count: status.items?.length ?? 0,
    };
    render({ rebuild: false });
  }

  function canReportComicStatus(status) {
    return ['top', 'comics'].includes(scope) && terms() && status.item?.name === query.trim();
  }

  // After Preview adds a list its row has to turn from Add into Open without losing the group.
  async function refresh() {
    if (terms()) render();
  }

  return {
    update, setScope, submit, startScope, showMore, comicStatus, canReportComicStatus, refresh,
    get scope() { return scope; },
  };
}
