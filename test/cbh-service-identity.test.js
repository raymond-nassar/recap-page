import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildMarkdown, selectedIssueIds } from '../scripts/author-cbh-packet.mjs';
import { resolveMapping } from '../scripts/resolve-cbh-order.mjs';
import { buildReportForMapping } from '../scripts/report-order-overlap.mjs';
import {
  assertMappingMatchesPacketOccurrences, mappingDigestFor, packetDigestFor, validateFrozenPacket,
  sourceGapResolutionDigestFor,
  assertGapTransition, gapEvidenceDigestFor,
} from '../scripts/lib/cbh-inventory.mjs';
import { serviceIdentityFor } from '../scripts/lib/cbh-service-identity.mjs';
import { validateResolvedMapping } from '../scripts/lib/cbh-resolution.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { viewerKey } from '../src/js/lib/marvelComicsAppUrl.js';
import { providerIssueIdsFor, vendorIssueItem } from '../scripts/vendor-orders.mjs';

function serviceRow(viewer = '21710', position = 2) {
  return {
    sourcePosition: position, sourceIssueReference: 'Captain America: The Chosen #5',
    normalizedSeriesTitle: 'Captain America: The Chosen', seriesYear: 2007, issueNumber: '5',
    seriesId: null, candidateIssueId: null, manualSeriesSelectionApproved: false,
    resolutionStatus: 'exact', resolvedIssueTitle: 'Captain America: The Chosen (2007)',
    serviceIdentity: {
      appViewer: viewer, url: `https://www.marvelcomicsapp.com/viewer/${viewer}`,
      providerIssueId: null, normalizedSeriesTitle: 'Captain America: The Chosen',
      seriesYear: 2007, issueNumber: '5', evidenceSha256: 'a'.repeat(64),
    },
  };
}

async function fixture() {
  const template = JSON.parse(await readFile('scripts/data/cbh-packets/thanos-reading-order.json', 'utf8'));
  const provider = {
    ...template.rows[0], sourcePosition: 1, candidateIssueId: 21710,
    resolutionStatus: 'exact', selectedIssueId: 21710,
    marvelIssueUrl: 'https://www.marvel.com/comics/issue/21710',
    resolvedIssueTitle: 'Provider comic', issueNumber: '1',
  };
  const rows = [provider, serviceRow()];
  const packet = {
    ...template, rows, expectedCount: 2, sourceOccurrenceCount: 2,
    canonicalSourcePositions: true, sourceGaps: [], sourceGapResolutions: [],
    repeatedSourceReferences: [], excludedSourceRows: [], excludedSourceReferences: [],
    proposedManifest: { ...template.proposedManifest, expect: 2 },
  };
  for (const field of ['sourceGaps', 'sourceGapResolutions', 'repeatedSourceReferences', 'excludedSourceRows',
    'sourceOccurrenceCount', 'canonicalSourcePositions']) {
    delete packet[field];
  }
  packet.packetDigest = packetDigestFor(packet);
  const mapping = {
    id: packet.id, packetDigest: packet.packetDigest, approvedSourceCount: 2,
    rows: structuredClone(rows),
    sourceUrl: packet.sourceUrl, sourceSection: packet.sourceSection,
    proposedManifest: packet.proposedManifest,
    reviewStatus: 'approved', packetReview: { authorityIdentity: 'test-fixture-only' },
    approvedManifest: packet.proposedManifest,
  };
  mapping.mappingDigest = mappingDigestFor(mapping);
  return { packet, mapping };
}

test('service-only source rows pass the real packet, mapping, checklist and offline vendor path', async () => {
  const { packet, mapping } = await fixture();
  validateFrozenPacket(packet);
  assertMappingMatchesPacketOccurrences(packet, mapping);
  const resolved = await resolveMapping({ rows: [serviceRow()] }, {
    metadataLookup: () => { throw new Error('A viewer must never be looked up as a provider issue'); },
  });
  assert.equal(resolved.rows[0].selectedIssueId, null);
  assert.deepEqual(selectedIssueIds(mapping), ['21710', String(viewerKey('21710'))]);
  const parsed = parseChecklist(buildMarkdown(mapping));
  assert.equal(parsed.unresolved.length, 0);
  assert.deepEqual(parsed.entries.map(({ issueId }) => issueId), [21710, viewerKey('21710')]);
  assert.deepEqual(providerIssueIdsFor(parsed.entries), [21710]);
  const item = vendorIssueItem(parsed.entries[1], {});
  assert.equal(item.appViewer, '21710');
  assert.equal(item.issueId, viewerKey('21710'));
  assert.equal(item.placeholder, undefined);
  assert.equal(item.digitalId, null);
  assert.equal(item.mu, null);
  assert.equal(item.url, 'https://www.marvelcomicsapp.com/viewer/21710');
});

test('overlap treats a provider number and the same viewer number as two different comics', async () => {
  const { mapping } = await fixture();
  const directory = await mkdtemp(path.join(tmpdir(), 'cbh-service-'));
  try {
    const mappingPath = path.join(directory, 'mapping.json');
    const manifestFile = path.join(directory, 'manifest.json');
    await writeFile(mappingPath, JSON.stringify(mapping));
    await writeFile(manifestFile, JSON.stringify({ lists: [{ id: 'provider-only', out: 'provider.json' }] }));
    await writeFile(path.join(directory, 'provider.json'), JSON.stringify({ items: [{ issueId: 21710 }] }));
    const report = await buildReportForMapping(mappingPath, [], {
      manifestFile, payloadDir: directory,
    });
    assert.equal(report.candidateCount, 2);
    assert.deepEqual(report.comparisons.find(({ orderId }) => orderId === 'provider-only').sharedIds, ['21710']);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('service identities reject unproven, mixed, malformed and changed source bindings', async () => {
  for (const change of [
    (row) => { delete row.serviceIdentity.providerIssueId; },
    (row) => { row.serviceIdentity.providerIssueId = 21710; },
    (row) => { row.selectedIssueId = 21710; },
    (row) => { row.candidateIssueIds = [21710]; },
    (row) => { row.serviceIdentity.url += '?issue=5'; },
    (row) => { row.serviceIdentity.appViewer = '21713'; },
    (row) => { row.serviceIdentity.evidenceSha256 = ''; },
    (row) => { row.issueNumber = '6'; },
    (row) => { row.metadataIssueNumber = null; },
  ]) {
    const row = serviceRow();
    change(row);
    assert.throws(() => serviceIdentityFor(row));
    assert.throws(() => selectedIssueIds({ id: 'invalid', rows: [row] }));
  }
  const { packet, mapping } = await fixture();
  mapping.rows[1].serviceIdentity.evidenceSha256 = 'b'.repeat(64);
  assert.throws(() => assertMappingMatchesPacketOccurrences(packet, mapping), /frozen packet/);
  const parsed = parseChecklist(buildMarkdown((await fixture()).mapping)).entries[1];
  assert.throws(() => vendorIssueItem(parsed, { digitalId: 21710 }), /conflicting/);
  assert.throws(() => vendorIssueItem({ ...parsed, issueId: 21710 }, {}), /conflicting/);
  assert.throws(() => providerIssueIdsFor([{ ...parsed, issueId: 21710 }]), /conflicting/);
  assert.throws(() => validateResolvedMapping([serviceRow(), serviceRow('21710', 3)]), /Duplicate/);
  assert.throws(() => validateResolvedMapping([{ ...serviceRow(), resolutionStatus: 'unmatched' }]), /exact resolution/);
});

test('service gap transitions bind the exact reviewed evidence without supplying a provider identity', async () => {
  const { packet, mapping } = await fixture();
  const row = mapping.rows[1];
  const resolution = {
    sourcePosition: 2, previousSourceIssueReference: row.sourceIssueReference,
    previousSourceRangeReference: null, previousNormalizedSeriesTitle: row.normalizedSeriesTitle,
    previousSeriesYear: row.seriesYear, previousIssueNumber: row.issueNumber,
    resolutionKind: 'exact-service-issue', serviceIdentity: row.serviceIdentity,
    resolvedNormalizedSeriesTitle: row.normalizedSeriesTitle,
    resolvedSeriesYear: row.seriesYear, resolvedIssueNumber: row.issueNumber,
    checkedAt: '2026-11-25', auditBasis: 'Exact service record independently reviewed.',
    evidenceSources: [{ kind: 'service-viewer', url: row.serviceIdentity.url, retrievedAt: '2026-11-25' }],
  };
  resolution.evidenceDigest = sourceGapResolutionDigestFor(resolution);
  packet.sourceGapResolutions = [resolution];
  packet.sourceOccurrenceCount = 2;
  packet.packetDigest = packetDigestFor(packet);
  mapping.sourceGapResolutions = structuredClone(packet.sourceGapResolutions);
  mapping.sourceOccurrenceCount = 2;
  validateFrozenPacket(packet);
  assertMappingMatchesPacketOccurrences(packet, mapping);
  const previous = structuredClone(packet);
  previous.rows = [previous.rows[0]];
  previous.expectedCount = 1;
  delete previous.sourceGapResolutions;
  const gap = {
    sourcePosition: 2, sourceIssueReference: row.sourceIssueReference, sourceRangeReference: null,
    normalizedSeriesTitle: row.normalizedSeriesTitle, seriesYear: row.seriesYear, issueNumber: row.issueNumber,
    kind: 'published-metadata-gap', status: 'open', checkedAt: '2026-11-25',
    auditBasis: 'No provider binding was established.',
    evidenceSources: [{ kind: 'service-viewer', url: row.serviceIdentity.url, retrievedAt: '2026-11-25' }],
  };
  gap.evidenceDigest = gapEvidenceDigestFor(gap);
  previous.sourceGaps = [gap];
  previous.packetDigest = packetDigestFor(previous);
  assertGapTransition(previous, packet, mapping);
  const changed = structuredClone(packet);
  changed.sourceGapResolutions[0].serviceIdentity.evidenceSha256 = 'c'.repeat(64);
  changed.packetDigest = packetDigestFor(changed);
  assert.throws(() => validateFrozenPacket(changed), /evidence digest is stale/);
  const mixed = structuredClone(packet);
  mixed.sourceGapResolutions[0].selectedIssueId = 21710;
  mixed.sourceGapResolutions[0].evidenceDigest = sourceGapResolutionDigestFor(mixed.sourceGapResolutions[0]);
  mixed.packetDigest = packetDigestFor(mixed);
  assert.throws(() => validateFrozenPacket(mixed), /unsupported disposition/);
  const missingApproval = structuredClone(mapping);
  delete missingApproval.packetReview;
  assert.throws(() => buildMarkdown(missingApproval), /no packet review/);
});
