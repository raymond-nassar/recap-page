import { editionEvidence, editionRelations } from './collectedEditions.js';
import { DESTINATION_PROVIDERS } from './editionDestinations.js';

// Library-link browsing (#1333). A comic counts for a provider only when one of its exact, full,
// conflict-free book relations carries an accepted link for that provider, which is the gate the
// reading screen already shows links through. A relation with no accepted link counts for nothing.
export const LINK_PROVIDERS = Object.freeze(['either', ...DESTINATION_PROVIDERS]);
export const LINK_COVERAGE = Object.freeze(['off', 'any', 'every']);
export const DEFAULT_LINK_FILTER = Object.freeze({ coverage: 'off', provider: 'either' });

const PROVIDER_NAMES = Object.freeze({ either: 'Hoopla or Libby', hoopla: 'Hoopla', libby: 'Libby' });

export function linkFilter(value) {
  const coverage = LINK_COVERAGE.includes(value?.coverage) ? value.coverage : DEFAULT_LINK_FILTER.coverage;
  const provider = LINK_PROVIDERS.includes(value?.provider) ? value.provider : DEFAULT_LINK_FILTER.provider;
  return { coverage, provider };
}

// Anything unreadable falls back to the default rather than failing, since this is only a browsing
// preference and a damaged value must never stop a shelf from drawing.
export function readLinkFilter(storage, key) {
  try { return linkFilter(JSON.parse(storage?.getItem(key) ?? 'null')); } catch { return { ...DEFAULT_LINK_FILTER }; }
}

export function saveLinkFilter(storage, key, value) {
  const filter = linkFilter(value);
  try { storage?.setItem(key, JSON.stringify(filter)); } catch { /* the choice still applies until reload */ }
  return filter;
}

// The providers one position in one list has a checked link with. Several books or several links
// for one comic still make it one linked comic.
export function positionProviders(catalogId, item, catalog, evidence) {
  const providers = new Set();
  for (const relation of editionRelations(catalogId, item, catalog, evidence)) {
    for (const link of relation.links) providers.add(link.provider);
  }
  return providers;
}

export function positionMatches(providers, provider) {
  return provider === 'either' ? providers.size > 0 : providers.has(provider);
}

// Counted by position, as a list counts its own length, so a comic the list repeats counts each
// time and a position the source could not resolve stays in the total as a gap (P2, decision 20).
export function listLinkCoverage(catalogId, items, catalog, evidence) {
  const rows = Array.isArray(items) ? items : [];
  const counts = { positions: rows.length, either: 0 };
  for (const provider of DESTINATION_PROVIDERS) counts[provider] = 0;
  for (const item of rows) {
    const providers = positionProviders(catalogId, item, catalog, evidence);
    if (providers.size) counts.either += 1;
    for (const provider of providers) counts[provider] += 1;
  }
  return counts;
}

// One reading's linked positions against its full length. A list the build recorded nothing for
// has no checked links; its length comes from the catalog entry, which counts every position.
export function listCoverage(list, provider = 'either', coverage = editionEvidence.linkCoverage) {
  const recorded = coverage && list?.id && Object.hasOwn(coverage, list.id) ? coverage[list.id] : null;
  const total = Number.isInteger(list?.count) && list.count >= 0 ? list.count : recorded?.positions ?? 0;
  const linked = recorded && Number.isInteger(recorded[provider]) ? Math.min(recorded[provider], total) : 0;
  return { linked, total };
}

// A stop with several readings is counted across all of them, and matches any-link when any one of
// them has a linked comic. It is fully linked only when every position of every reading is (P3).
export function storyCoverage(lists, provider = 'either', coverage = editionEvidence.linkCoverage) {
  let linked = 0;
  let total = 0;
  for (const list of Array.isArray(lists) ? lists : []) {
    const counts = listCoverage(list, provider, coverage);
    linked += counts.linked;
    total += counts.total;
  }
  return { linked, total };
}

export function coverageMatches({ linked, total }, mode) {
  if (mode === 'any') return linked > 0;
  if (mode === 'every') return total > 0 && linked === total;
  return true;
}

export function filterStoriesByLinks(stories, filter, { listsOf = (story) => story?.lists, coverage } = {}) {
  const { coverage: mode, provider } = linkFilter(filter);
  const all = Array.isArray(stories) ? stories : [];
  if (mode === 'off') return all;
  return all.filter((story) => coverageMatches(storyCoverage(listsOf(story), provider, coverage), mode));
}

// Each browsing card shows one reading, but a timeline stop is every reading of one story (P3).
// The readings are gathered from the page's whole pool rather than what a search left, so a search
// that matches one reading never shrinks the stop its count is measured against.
export function readingsOfStory(pool, keyOf) {
  const byKey = new Map();
  for (const list of Array.isArray(pool) ? pool : []) {
    const key = keyOf(list);
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(list);
  }
  return (list) => byKey.get(keyOf(list)) ?? [list];
}

export function providerPhrase(provider) {
  return PROVIDER_NAMES[provider] ?? PROVIDER_NAMES.either;
}

export function coverageText({ linked, total }, provider = 'either') {
  const comics = `${total} comic${total === 1 ? '' : 's'}`;
  return `${linked} of ${comics} with a checked ${providerPhrase(provider)} link`;
}
