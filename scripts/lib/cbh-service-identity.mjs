import assert from 'node:assert/strict';
import { appViewerFromUrl, viewerKey } from '../../src/js/lib/marvelComicsAppUrl.js';

// Source review authorizes the evidence, not the viewer's bare number as a provider identity.
export function serviceIdentityFor(row) {
  if (!Object.hasOwn(row, 'serviceIdentity')) return null;
  const identity = row.serviceIdentity;
  assert(identity && typeof identity === 'object' && !Array.isArray(identity), 'Service identity must be an object');
  assert.deepEqual(Object.keys(identity).sort(), [
    'appViewer', 'evidenceSha256', 'issueNumber', 'normalizedSeriesTitle',
    'providerIssueId', 'seriesYear', 'url',
  ].sort(), 'Service identity has unsupported or missing fields');
  const viewer = appViewerFromUrl(identity.url);
  assert(viewer && identity.appViewer === viewer, 'Service identity requires a canonical viewer link');
  assert.equal(identity.providerIssueId, null, 'Service identity must explicitly have no provider binding');
  assert.equal(row.candidateIssueId, null, 'Service identity cannot select a provider candidate');
  assert.equal(row.seriesId, null, 'Service identity cannot claim a provider series');
  assert(row.selectedIssueId == null && row.marvelIssueUrl == null, 'Service identity cannot claim a provider issue or URL');
  assert((row.candidateIssueIds?.length ?? 0) === 0 && (row.selectedIssueIds?.length ?? 0) === 0,
    'Service identity cannot carry provider candidates or selections');
  assert(!Object.hasOwn(row, 'metadataIssueNumber') || row.metadataIssueNumber === identity.issueNumber,
    'Service identity cannot change its reviewed issue number');
  assert(typeof identity.evidenceSha256 === 'string' && /^[a-f0-9]{64}$/.test(identity.evidenceSha256),
    'Service identity requires a pinned evidence receipt');
  assert(typeof identity.normalizedSeriesTitle === 'string' && identity.normalizedSeriesTitle.trim(),
    'Service identity requires an exact series title');
  assert(Number.isInteger(identity.seriesYear), 'Service identity requires an exact series year');
  assert(typeof identity.issueNumber === 'string' && identity.issueNumber.trim(),
    'Service identity requires an exact issue number');
  for (const field of ['normalizedSeriesTitle', 'seriesYear', 'issueNumber']) {
    assert.equal(row[field], identity[field], `Service identity ${field} differs from its source row`);
  }
  return { issueId: viewerKey(viewer), appViewer: viewer, url: identity.url };
}

export function mappedTrackingId(row) {
  return serviceIdentityFor(row)?.issueId ?? row.selectedIssueId ?? null;
}
