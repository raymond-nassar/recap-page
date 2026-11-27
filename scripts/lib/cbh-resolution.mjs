import { normalizeTitle, resolveUniqueExact } from '../../src/js/lib/markdown.js';
import { mappedTrackingId, serviceIdentityFor } from './cbh-service-identity.mjs';

function toIssueId(candidate) {
  if (candidate == null) return null;
  if (candidate.id != null) return String(candidate.id);
  if (candidate.issueId != null) return String(candidate.issueId);
  if (candidate.marvelId != null) return String(candidate.marvelId);
  return null;
}

export function candidateHasExactMetadata(candidate) {
  if (!candidate || typeof candidate !== 'object') return false;
  const id = toIssueId(candidate);
  if (!id) return false;
  const title = normalizeTitle(candidate?.title ?? candidate?.seriesTitle ?? candidate?.normalizedSeriesTitle ?? '');
  if (!title) return false;
  const issueNumber = candidate?.issueNumber ?? candidate?.number ?? candidate?.issue ?? null;
  if (issueNumber == null || String(issueNumber).trim() === '') return false;
  return true;
}

export function normalisedTitleForRow(row) {
  return normalizeTitle(row?.normalizedSeriesTitle ?? row?.seriesTitle ?? row?.title ?? '');
}

export function exactMatchesForRow(row, candidates) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const rowTitle = normalisedTitleForRow(row);
  if (!rowTitle) return [];

  return rows.filter((candidate) => {
    if (!candidateHasExactMetadata(candidate)) return false;
    const candidateTitle = normalizeTitle(candidate?.title ?? candidate?.seriesTitle ?? candidate?.normalizedSeriesTitle ?? '');
    const candidateSeriesId = candidate?.seriesId ?? candidate?.series_id ?? null;
    const rowSeriesId = row?.seriesId ?? row?.series_id ?? null;
    if (rowSeriesId != null && (candidateSeriesId == null || String(candidateSeriesId) !== String(rowSeriesId))) {
      return false;
    }
    const manualSeriesSelection = (
      candidate?.manualSeriesSelection === true
      && candidate?.manualSeriesSelectionApproved === true
      && row?.manualSeriesSelectionApproved === true
      && rowSeriesId != null
      && candidateSeriesId != null
      && String(candidateSeriesId) === String(rowSeriesId)
      && typeof row?.note === 'string'
      && row.note.trim().length > 0
    );
    if (!candidateTitle || (candidateTitle !== rowTitle && !manualSeriesSelection)) return false;

    const rowNumber = row?.metadataIssueNumber ?? row?.issueNumber ?? row?.number ?? row?.issue ?? null;
    const candidateNumber = candidate?.issueNumber ?? candidate?.number ?? candidate?.issue ?? null;
    if (rowNumber != null) {
      if (candidateNumber == null || String(rowNumber) !== String(candidateNumber)) return false;
    }

    const rowYear = row?.seriesYear ?? row?.year ?? null;
    const candidateYear = candidate?.seriesYear ?? candidate?.year ?? null;
    if (rowYear != null) {
      if (candidateYear == null || String(rowYear) !== String(candidateYear)) return false;
    }

    return true;
  });
}

export function resolveRow(row, candidates = []) {
  if (serviceIdentityFor(row)) {
    return {
      status: 'exact', resolutionStatus: 'exact', selectedIssueId: null,
      candidateIssueIds: [], selectedIssueIds: [], serviceIdentity: row.serviceIdentity,
    };
  }
  const list = Array.isArray(candidates) ? candidates.filter(candidateHasExactMetadata) : [];
  if (row?.resolutionStatus === 'approved-exception') {
    return {
      status: 'approved-exception',
      resolutionStatus: 'approved-exception',
      selectedIssueId: row.selectedIssueId ?? null,
      candidateIssueIds: Array.isArray(row.candidateIssueIds) ? row.candidateIssueIds.slice() : [],
      selectedIssueIds: Array.isArray(row.selectedIssueIds) ? row.selectedIssueIds.slice() : [],
      note: row.note ?? 'Approved exception preserved',
    };
  }

  const exact = exactMatchesForRow(row, list);
  const title = normalisedTitleForRow(row);
  const unique = resolveUniqueExact(title, exact.map((candidate) => ({ title: candidate?.title ?? candidate?.seriesTitle ?? candidate?.normalizedSeriesTitle ?? '' })));
  const reviewedManualSelection = exact.length === 1 && exact[0]?.manualSeriesSelection === true;

  if (exact.length === 1 && (unique.status === 'resolved' || reviewedManualSelection)) {
    const selectedIssueId = toIssueId(exact[0]);
    return {
      status: 'exact',
      resolutionStatus: 'exact',
      selectedIssueId,
      candidateIssueIds: [selectedIssueId].filter(Boolean),
      selectedIssueIds: [selectedIssueId].filter(Boolean),
      note: row.note ?? '',
    };
  }

  if (exact.length === 0) {
    return {
      status: 'unmatched',
      resolutionStatus: 'unmatched',
      selectedIssueId: null,
      candidateIssueIds: list.map((candidate) => toIssueId(candidate)).filter(Boolean),
      selectedIssueIds: [],
      note: row.note ?? 'No exact normalized match found',
    };
  }

  return {
    status: 'ambiguous',
    resolutionStatus: 'ambiguous',
    selectedIssueId: null,
    candidateIssueIds: exact.map((candidate) => toIssueId(candidate)).filter(Boolean),
    selectedIssueIds: [],
    note: row.note ?? 'Multiple exact normalized matches found',
  };
}

export function validateResolvedMapping(rows) {
  const seen = new Set();
  for (const row of rows) {
    if (serviceIdentityFor(row) && row.resolutionStatus !== 'exact') {
      throw new Error('Service identity requires an exact resolution');
    }
    const selectedIssueId = mappedTrackingId(row);
    if (selectedIssueId != null) {
      const key = String(selectedIssueId);
      if (seen.has(key)) {
        throw new Error(`Duplicate selected issue id in resolved mapping: ${key}`);
      }
      seen.add(key);
    }

    if (row.resolutionStatus === 'ambiguous' || row.resolutionStatus === 'unmatched') {
      if (row.selectedIssueId != null) {
        throw new Error(`Row with status ${row.resolutionStatus} must not select an issue id`);
      }
      continue;
    }

    if (row.resolutionStatus === 'approved-exception') {
      continue;
    }

    if (row.resolutionStatus !== 'exact') {
      throw new Error(`Unknown resolution status: ${row.resolutionStatus}`);
    }
    if (mappedTrackingId(row) == null) {
      throw new Error('Exact resolution without a selected issue id');
    }
  }
}
