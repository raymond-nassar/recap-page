import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { resolveRow, validateResolvedMapping } from './lib/cbh-resolution.mjs';
import { serviceIdentityFor } from './lib/cbh-service-identity.mjs';

function issueIdOf(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  if (candidate.id != null) return String(candidate.id);
  if (candidate.issueId != null) return String(candidate.issueId);
  if (candidate.marvelId != null) return String(candidate.marvelId);
  return null;
}

function issueIdValue(candidate) {
  if (!candidate || typeof candidate !== 'object') return null;
  if (candidate.id != null) return candidate.id;
  if (candidate.issueId != null) return candidate.issueId;
  if (candidate.marvelId != null) return candidate.marvelId;
  return null;
}

export function buildCandidateMetadataLookup(mapping, metadataLookup) {
  if (typeof metadataLookup === 'function') {
    return metadataLookup;
  }

  const byIssueId = new Map();
  const metadata = Array.isArray(mapping?.candidateMetadata) ? mapping.candidateMetadata : [];
  for (const candidate of metadata) {
    const id = issueIdOf(candidate);
    if (id) byIssueId.set(id, candidate);
  }

  if (mapping && typeof mapping.metadataByIssueId === 'object' && mapping.metadataByIssueId) {
    for (const [id, candidate] of Object.entries(mapping.metadataByIssueId)) {
      if (candidate) byIssueId.set(String(id), candidate);
    }
  }

  return (issueId) => {
    if (issueId == null) return null;
    const key = String(issueId);
    return byIssueId.get(key) ?? null;
  };
}

export async function resolveMapping(mapping, { metadataLookup } = {}) {
  if (!mapping || !Array.isArray(mapping.rows)) {
    throw new Error('The mapping file must contain a rows array');
  }

  const lookup = buildCandidateMetadataLookup(mapping, metadataLookup);
  const resolvedRows = mapping.rows.map((row) => {
    if (serviceIdentityFor(row)) {
      return { ...row, ...resolveRow(row) };
    }
    const issueIds = Array.isArray(row.candidateIssueIds) ? row.candidateIssueIds.map(String) : [];
    const candidates = issueIds
      .map((issueId) => lookup(issueId, row))
      .filter((candidate) => candidate && typeof candidate === 'object');

    const settlement = resolveRow(row, candidates);
    const selectedIssueId = settlement.selectedIssueId ?? row.selectedIssueId ?? null;
    const selectedMatch = candidates.find((candidate) => String(candidate.id ?? candidate.issueId ?? candidate.marvelId ?? '') === String(selectedIssueId ?? ''));
    const resolvedSelectedIssueId = selectedMatch != null
      ? (issueIdValue(selectedMatch) ?? selectedIssueId)
      : selectedIssueId;

    return {
      ...row,
      ...settlement,
      candidateIssueIds: settlement.candidateIssueIds ?? row.candidateIssueIds ?? [],
      selectedIssueId: resolvedSelectedIssueId,
      selectedIssueIds: resolvedSelectedIssueId == null ? [] : [resolvedSelectedIssueId],
      note: settlement.note ?? row.note ?? '',
      resolutionStatus: settlement.resolutionStatus ?? row.resolutionStatus ?? 'unmatched',
    };
  });

  const failures = resolvedRows.filter((row) => row.resolutionStatus !== 'exact' && row.resolutionStatus !== 'approved-exception');
  if (failures.length > 0) {
    const summary = failures.map((row) => `${row.normalizedSeriesTitle ?? row.title ?? 'row'}:${row.resolutionStatus}`).join(', ');
    throw new Error(`Unresolved mapping contains non-exact rows: ${summary}`);
  }

  validateResolvedMapping(resolvedRows);
  return { ...mapping, rows: resolvedRows };
}

async function main() {
  const mappingPath = process.argv[2];
  if (!mappingPath) {
    console.error('Usage: npm run cbh:resolve -- <mapping-path>');
    process.exitCode = 1;
    return;
  }

  const text = await readFile(mappingPath, 'utf8');
  const mapping = JSON.parse(text);
  const resolved = await resolveMapping(mapping);
  await writeFile(mappingPath, `${JSON.stringify(resolved, null, 2)}\n`, 'utf8');
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(thisFile)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
