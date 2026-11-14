import {
  universeDefinitions, universeIssueOverrides, universeSeries,
} from '../../data/universeCatalog.js';

const isRecord = (value) => value != null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '' && value === value.trim();
const isId = (value) => isText(value) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
const isPositiveId = (value) => Number.isSafeInteger(value) && value > 0;

function isDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isHttpsUrl(value) {
  if (!isText(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

function referenceProblems(ids, known, label) {
  if (!Array.isArray(ids)) return [`${label} must be an array`];
  const problems = [];
  if (new Set(ids).size !== ids.length) problems.push(`${label} must not contain duplicates`);
  for (const id of ids) {
    if (!isId(id) || !known.has(id)) problems.push(`${label} names an unknown universe: ${String(id)}`);
  }
  return problems;
}

export function universeRegistryProblems({ definitions, series, issueOverrides }) {
  const problems = [];
  if (!Array.isArray(definitions) || !Array.isArray(series) || !Array.isArray(issueOverrides)) {
    return ['Universe definitions, series and issue overrides must be arrays'];
  }
  const known = new Set();
  for (const definition of definitions) {
    if (!isRecord(definition)) {
      problems.push('A universe definition must be an object');
      continue;
    }
    const { id, name, earth, firstPublished, debutIssue, description, aliases, addedAt } = definition;
    if (!isId(id)) problems.push(`Invalid universe id: ${String(id)}`);
    else if (known.has(id)) problems.push(`Duplicate universe id: ${id}`);
    else known.add(id);
    if (!isText(name) || !isText(description)) problems.push(`${id} needs a name and description`);
    if (earth !== null && !isText(earth)) problems.push(`${id} needs a valid reality designation or null`);
    if (!Number.isInteger(firstPublished) || firstPublished < 1 || firstPublished > 9999) {
      problems.push(`${id} has an invalid publication year`);
    }
    if (!isDate(addedAt)) problems.push(`${id} has an invalid addedAt date`);
    if (!isRecord(debutIssue) || !isText(debutIssue.title)
      || (debutIssue.issueId !== null && !isPositiveId(debutIssue.issueId))
      || (Object.hasOwn(debutIssue, 'url') && !isHttpsUrl(debutIssue.url))) {
      problems.push(`${id} has an invalid debut issue`);
    }
    if (!Array.isArray(aliases) || aliases.some((alias) => !isText(alias))
      || new Set(aliases.map((alias) => typeof alias === 'string' ? alias.toLowerCase() : alias)).size !== aliases.length) {
      problems.push(`${id} has invalid or duplicate aliases`);
    }
    if (Object.hasOwn(definition, 'status') && !isText(definition.status)) {
      problems.push(`${id} has an invalid continuity status`);
    }
  }
  for (const definition of definitions.filter(isRecord)) {
    if (Object.hasOwn(definition, 'relatedUniverseIds')) {
      problems.push(...referenceProblems(definition.relatedUniverseIds, known, `${definition.id} relatedUniverseIds`));
    }
  }
  for (const [entries, key, label] of [
    [series, 'seriesId', 'series'],
    [issueOverrides, 'issueId', 'issue override'],
  ]) {
    const seen = new Set();
    for (const entry of entries) {
      if (!isRecord(entry) || !isPositiveId(entry[key])) {
        problems.push(`A ${label} has an invalid ${key}`);
        continue;
      }
      if (seen.has(entry[key])) problems.push(`Duplicate ${label} ${entry[key]}`);
      seen.add(entry[key]);
      problems.push(...referenceProblems(entry.universeIds, known, `${label} ${entry[key]} universeIds`));
      if (key === 'seriesId' && !['entire-series', 'selected-issues'].includes(entry.scope)) {
        problems.push(`Series ${entry[key]} has an invalid scope`);
      }
    }
  }
  return problems;
}

const registryProblems = universeRegistryProblems({
  definitions: universeDefinitions,
  series: universeSeries,
  issueOverrides: universeIssueOverrides,
});
if (registryProblems.length) throw new Error(`Invalid Universe registry: ${registryProblems.join('; ')}`);

const knownUniverseIds = new Set(universeDefinitions.map(({ id }) => id));

export function universeListProblems(raw, known = knownUniverseIds) {
  const problems = [];
  const hasIds = Object.hasOwn(raw, 'universeIds');
  const ids = hasIds && Array.isArray(raw.universeIds) ? raw.universeIds : [];
  if (hasIds) problems.push(...referenceProblems(raw.universeIds, known, 'universeIds'));
  if (!Object.hasOwn(raw, 'universeScopes')) return problems;
  if (!isRecord(raw.universeScopes)) return [...problems, 'universeScopes must be an object'];
  for (const [id, scope] of Object.entries(raw.universeScopes)) {
    if (!ids.includes(id)) problems.push(`universeScopes names an unassociated universe: ${id}`);
    if (!isRecord(scope) || !['representative', 'related-realities'].includes(scope.kind)
      || Object.keys(scope).some((key) => key !== 'kind' && key !== 'note')) {
      problems.push(`universeScopes ${id} has an invalid kind or fields`);
      continue;
    }
    if ((Object.hasOwn(scope, 'note') && !isText(scope.note))
      || (scope.kind === 'related-realities' && !isText(scope.note))) {
      problems.push(`universeScopes ${id} needs a nonempty note`);
    }
  }
  return problems;
}

export function copyUniverseListFields(raw) {
  return {
    ...(Object.hasOwn(raw, 'universeIds') ? { universeIds: [...raw.universeIds] } : {}),
    ...(Object.hasOwn(raw, 'universeScopes')
      ? { universeScopes: Object.fromEntries(Object.entries(raw.universeScopes).map(([id, scope]) => [id, { ...scope }])) }
      : {}),
  };
}
