import {
  STORY_TONES, STORY_TYPES, depthLabel, foldSearchText, searchCatalog, squeezeSearchText, typeLabel,
} from './catalog.js';

// Home files every screen companion under "MCU Prep", but no list carries those words. Measured on
// the bundled catalog, a search for the shelf's own name found none of its 37 lists, and "MCU"
// alone found 31, only where a description happened to say it.
export const MCU_PREP_ALIAS = 'MCU Prep';

export const LIST_FILTERS = Object.freeze([
  { key: 'storyTypes', label: 'Genre', labels: STORY_TYPES },
  { key: 'tones', label: 'Tone', labels: STORY_TONES },
  { key: 'characters', label: 'Character or team' },
  { key: 'writers', label: 'Writer' },
  { key: 'type', label: 'List kind', labelFor: typeLabel },
  { key: 'timeline', label: 'Story year' },
  { key: 'sourceOrigin', label: 'Source guide' },
]);

function filterValues(list, key) {
  const value = list[key];
  return (Array.isArray(value) ? value : [value])
    .filter((entry) => entry != null && entry !== '').map(String);
}

export function listFilterOptions(lists) {
  return Object.fromEntries(LIST_FILTERS.map(({ key, labels, labelFor }) => [
    key,
    [...new Set(lists.flatMap((list) => filterValues(list, key)))]
      .map((value) => ({ value, label: labels?.[value] ?? labelFor?.(value) ?? value }))
      .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true })),
  ]));
}

export function filterSearchLists(lists, query, filters = {}, options = {}) {
  const active = LIST_FILTERS.filter(({ key }) => filters[key]);
  const matches = lists.filter((list) => active.every(({ key }) => filterValues(list, key).includes(filters[key])));
  if (listSearchTerms(query).length) return rankLists(matches, query, options);
  return active.length ? matches.slice().sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)) : [];
}

export function listSearchTerms(query) {
  return foldSearchText(query).split(' ').filter(Boolean);
}

function enrich(list, guides) {
  if (list.type !== 'screen-companion') return list;
  const releases = guides?.get(list.id) ?? [];
  return {
    ...list,
    keywords: [...(list.keywords ?? []), MCU_PREP_ALIAS, ...releases.map((release) => release.title)],
  };
}

function covers(fields, terms) {
  const text = foldSearchText(fields.filter(Boolean).join(' '));
  const squeezed = squeezeSearchText(text);
  return terms.every((term) => text.includes(term) || squeezed.includes(term));
}

// A reader who types a list's name expects that list first, then lists named for it, then lists
// that only mention it. Alphabetical order inside each tier keeps the same query stable.
function tier(list, query, terms) {
  const titles = [list.name, list.groupName, list.variant];
  const exact = [list.name, list.groupName, `${list.groupName ?? list.name} ${list.variant ?? ''}`]
    .map((title) => foldSearchText(title));
  if (exact.includes(query) || exact.map(squeezeSearchText).includes(squeezeSearchText(query))) return 0;
  if (covers(titles, terms)) return 1;
  if (covers([
    ...titles,
    typeLabel(list.type),
    depthLabel(list.depth),
    ...(list.storyTypes ?? []).map((tag) => STORY_TYPES[tag]),
    ...(list.tones ?? []).map((tag) => STORY_TONES[tag]),
    ...(list.characters ?? []),
    ...(list.keywords ?? []),
  ], terms)) return 2;
  return 3;
}

export function rankLists(lists, query, { guides = null } = {}) {
  const terms = listSearchTerms(query);
  if (!terms.length) return [];
  const folded = terms.join(' ');
  const enriched = lists.map((list) => enrich({ characters: [], keywords: [], ...list }, guides));
  const original = new Map(enriched.map((list, index) => [list, lists[index]]));
  return searchCatalog(enriched, query)
    .map((list) => ({ list, tier: tier(list, folded, terms) }))
    .sort((a, b) => a.tier - b.tier
      || a.list.name.localeCompare(b.list.name)
      || (a.list.variant ?? '').localeCompare(b.list.variant ?? '')
      || a.list.id.localeCompare(b.list.id))
    .map(({ list }) => original.get(list));
}
