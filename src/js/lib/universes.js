import {
  universeDefinitions, universeIssueOverrides, universeSeries,
} from '../../data/universeCatalog.js';
import { foldSearchText, squeezeSearchText } from './catalog.js';
import { universeListProblems, universeRegistryProblems } from './universeSchema.js';

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

  function searchUniverses(query) {
    const folded = foldSearchText(query);
    if (!folded) return [...definitions];
    const terms = folded.split(' ');
    return definitions.filter((universe) => {
      const text = foldSearchText([universe.name, universe.earth, ...universe.aliases].join(' '));
      const squeezed = squeezeSearchText(text);
      return terms.every((term) => text.includes(term) || squeezed.includes(squeezeSearchText(term)));
    });
  }

  function sortUniverses(items, order = 'publication-history') {
    if (!['publication-history', 'alphabetical', 'recently-added'].includes(order)) {
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
    searchUniverses,
    sortUniverses,
  };
}

export const universeResolver = createUniverseResolver();
