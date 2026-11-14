import {
  universeDefinitions, universeIssueOverrides, universeSeries,
} from '../../data/universeCatalog.js';
import { foldSearchText, squeezeSearchText } from './catalog.js';
import { universeListProblems, universeRegistryProblems } from './universeSchema.js';

export const UNIVERSE_SORTS = ['publication-history', 'alphabetical', 'recently-added'];
export const DEFAULT_UNIVERSE_SORT = UNIVERSE_SORTS[0];

export function createUniverseResolver({
  definitions = universeDefinitions,
  series = universeSeries,
  issueOverrides = universeIssueOverrides,
} = {}) {
  const problems = universeRegistryProblems({ definitions, series, issueOverrides });
  if (problems.length) throw new Error(`Invalid Universe registry: ${problems.join('; ')}`);
  const byId = new Map(definitions.map((definition) => [definition.id, definition]));
  const knownIds = new Set(byId.keys());
  const bySeries = new Map(series.map((entry) => [entry.seriesId, entry]));
  const byIssue = new Map(issueOverrides.map((entry) => [entry.issueId, entry.universeIds]));

  function getUniverse(id) {
    return byId.get(id) ?? null;
  }

  function resolveIssueUniverses(issue) {
    if (!Number.isSafeInteger(issue?.issueId) || issue.issueId <= 0) return [];
    if (byIssue.has(issue.issueId)) return byIssue.get(issue.issueId).map((id) => byId.get(id));
    const entry = bySeries.get(issue.seriesId);
    return entry?.scope === 'entire-series' ? entry.universeIds.map((id) => byId.get(id)) : [];
  }

  function getSeriesUniverseRelations(seriesId) {
    const entry = bySeries.get(seriesId);
    return entry ? entry.universeIds.map((id) => ({ universe: byId.get(id), scope: entry.scope })) : [];
  }

  function getListUniverseRelations(list) {
    if (!list || typeof list !== 'object') return [];
    const problems = universeListProblems(list, knownIds);
    if (problems.length) throw new Error(`Invalid Reading List universe metadata: ${problems.join('; ')}`);
    return (list.universeIds ?? []).map((id) => {
      const scope = list.universeScopes?.[id];
      return {
        universe: byId.get(id),
        kind: scope?.kind ?? 'representative',
        note: scope?.note ?? null,
      };
    });
  }

  function getUniverseLists(universeId, lists) {
    if (!byId.has(universeId)) return [];
    return lists.flatMap((list) => getListUniverseRelations(list)
      .filter(({ universe }) => universe.id === universeId)
      .map((relation) => ({ list, ...relation })));
  }

  function getUniverseSeries(universeId) {
    if (!byId.has(universeId)) return [];
    return series.filter((entry) => entry.universeIds.includes(universeId))
      .map(({ seriesId, scope }) => ({ seriesId, scope }));
  }

  function getUniverseIssueIds(universeId) {
    if (!byId.has(universeId)) return [];
    return issueOverrides.filter((entry) => entry.universeIds.includes(universeId))
      .map(({ issueId }) => issueId);
  }

  function getDebutIssue(issueId) {
    return definitions.find((entry) => entry.debutIssue.issueId === issueId)?.debutIssue ?? null;
  }

  function searchUniverses(query) {
    const folded = foldSearchText(query);
    if (!folded) return [...definitions];
    const terms = folded.split(' ');
    const squeezedQuery = squeezeSearchText(folded);
    return definitions.map((universe) => {
      const fields = [universe.name, universe.earth, ...universe.aliases].map(foldSearchText);
      const text = fields.join(' ');
      const squeezed = squeezeSearchText(text);
      return {
        universe,
        matches: terms.every((term) => text.includes(term) || squeezed.includes(squeezeSearchText(term))),
        exact: fields.some((field) => field === folded || squeezeSearchText(field) === squeezedQuery),
      };
    }).filter(({ matches }) => matches)
      .sort((a, b) => Number(b.exact) - Number(a.exact))
      .map(({ universe }) => universe);
  }

  function sortUniverses(items, order = DEFAULT_UNIVERSE_SORT) {
    if (!UNIVERSE_SORTS.includes(order)) {
      throw new Error(`Unknown Universe sort order: ${String(order)}`);
    }
    return [...items].sort((a, b) => {
      const byName = a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id, 'en');
      if (order === 'publication-history') return a.firstPublished - b.firstPublished || byName;
      if (order === 'recently-added') return b.addedAt.localeCompare(a.addedAt) || byName;
      return byName;
    });
  }

  return {
    getUniverse,
    resolveIssueUniverses,
    getSeriesUniverseRelations,
    getListUniverseRelations,
    getUniverseLists,
    getUniverseSeries,
    getUniverseIssueIds,
    getDebutIssue,
    searchUniverses,
    sortUniverses,
  };
}

export const universeResolver = createUniverseResolver();
