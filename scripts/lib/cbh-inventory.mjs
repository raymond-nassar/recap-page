import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export const GUIDE_TYPES = Object.freeze([
  'event',
  'era',
  'sub-guide',
  'bridge',
  'fast-track',
  'commerce',
  'character-run',
]);

export const DISPOSITIONS = Object.freeze([
  'new-order',
  'reuse-existing',
  'grouped-variant',
  'path-source',
  'deferred',
  'excluded',
]);

export const DELIVERY_STATUSES = Object.freeze([
  'pending',
  'ready',
  'shipped',
  'blocked',
  'not-applicable',
]);

export const BASELINE_COUNT = 86;
export const CHARACTER_INVENTORY_COUNT = 128;
export const CBH_SOURCE_PROVIDER = Object.freeze({
  id: 'comic-book-herald',
  hosts: Object.freeze(['www.comicbookherald.com']),
  sourceOrigin: "Compiled for this project from Comic Book Herald's guide",
  requireSourceProvider: false,
  requireSourceContentSha256: false,
});

const CHARACTER_DISPOSITIONS = new Set([
  'deferred',
  'excluded',
  'blocked',
  'pilot-approved',
]);
const CHARACTER_BOUNDARY_STATUSES = new Set(['exact-page-snapshot']);
const CHARACTER_HORIZON_STATUSES = new Set([
  'blocked-exact-resolution-not-run',
  'blocked-confirmed-post-horizon',
  'approved',
]);

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PACKET_FIELDS = new Set([
  'schemaVersion',
  'id',
  'inventoryId',
  'sourceUrl',
  'sourceSection',
  'sourceRetrievedAt',
  'sourceProvider',
  'sourceContentSha256',
  'sourceIssueBearingBlocksSha256',
  'sourceBoundary',
  'excludedSourceReferences',
  'excludedSourceRows',
  'sourceOccurrenceCount',
  'repeatedSourceReferences',
  'sourceGaps',
  'expectedCount',
  'proposedManifest',
  'insertionAnchor',
  'sourceReview',
  'rows',
  'packetDigest',
]);
const MAPPING_DIGEST_FIELDS = Object.freeze([
  'id',
  'inventoryId',
  'packetDigest',
  'sourceUrl',
  'sourceSection',
  'sourceRetrievedAt',
  'sourceProvider',
  'sourceContentSha256',
  'sourceRetrievalStatus',
  'approvedSourceCount',
  'excludedSourceReferences',
  'excludedSourceRows',
  'sourceOccurrenceCount',
  'repeatedSourceReferences',
  'sourceGaps',
  'proposedManifest',
  'candidateMetadata',
  'rows',
]);
const REPEATED_SOURCE_REFERENCE_FIELDS = new Set([
  'sourcePosition',
  'canonicalRow',
  'sourceIssueReference',
  'sourceRangeReference',
  'normalizedSeriesTitle',
  'seriesYear',
  'issueNumber',
]);
const EXCLUDED_SOURCE_ROW_FIELDS = new Set([
  'sourcePosition',
  'sourceIssueReference',
  'reason',
  'decisionScope',
]);
const SOURCE_GAP_FIELDS = new Set([
  'sourcePosition',
  'sourceIssueReference',
  'sourceRangeReference',
  'sourceGroup',
  'normalizedSeriesTitle',
  'seriesYear',
  'issueNumber',
  'kind',
  'status',
  'checkedAt',
  'auditBasis',
  'evidenceSources',
  'evidenceDigest',
]);
const SOURCE_GAP_OPTIONAL_FIELDS = new Set(['sourceGroup']);
const GAP_EVIDENCE_SOURCE_FIELDS = new Set(['kind', 'url', 'retrievedAt']);
const REPORT_DIGEST_FIELDS = Object.freeze([
  'candidateId',
  'packetDigest',
  'mappingDigest',
  'libraryDigest',
  'peerDigests',
  'candidateCount',
  'sourceCounts',
  'comparisonCount',
  'comparisons',
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map((entry) => canonicalValue(entry));
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function selectedFields(value, fields) {
  return Object.fromEntries(
    fields
      .filter((field) => Object.hasOwn(value, field))
      .map((field) => [field, value[field]]),
  );
}

function assertSha256(value, label) {
  if (!SHA256_PATTERN.test(String(value ?? ''))) {
    throw new Error(`${label} must be a lowercase SHA-256 digest`);
  }
}

function assertNonEmptyString(value, label) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertPacketRow(row, index) {
  const label = `Packet row ${index + 1}`;
  if (!isPlainObject(row)) throw new Error(`${label} must be an object`);
  assertNonEmptyString(row.sourceIssueReference, `${label} sourceIssueReference`);
  assertNonEmptyString(row.normalizedSeriesTitle, `${label} normalizedSeriesTitle`);
  if (row.sourceRangeReference != null) {
    assertNonEmptyString(row.sourceRangeReference, `${label} sourceRangeReference`);
  }
  if (!Number.isInteger(row.seriesYear)) {
    throw new Error(`${label} seriesYear must be an integer`);
  }
  if (row.issueNumber != null) assertNonEmptyString(String(row.issueNumber), `${label} issueNumber`);
  if (row.seriesId != null && !Number.isInteger(row.seriesId)) {
    throw new Error(`${label} seriesId must be an integer or null`);
  }
  if (row.candidateIssueId != null && !Number.isInteger(row.candidateIssueId)) {
    throw new Error(`${label} candidateIssueId must be an integer or null`);
  }
  if (typeof row.manualSeriesSelectionApproved !== 'boolean') {
    throw new Error(`${label} manualSeriesSelectionApproved must be a boolean`);
  }
  if (row.selectionNote != null) assertNonEmptyString(row.selectionNote, `${label} selectionNote`);
  if (row.metadataIssueNumber != null) {
    assertNonEmptyString(String(row.metadataIssueNumber), `${label} metadataIssueNumber`);
  }
}

function packetRowIdentity(row) {
  const issueNumber = String(row.metadataIssueNumber ?? row.issueNumber ?? '').trim();
  if (row.candidateIssueId != null) return `issue:${row.candidateIssueId}`;
  if (row.seriesId != null) return `series:${row.seriesId}#${issueNumber}`;
  return [
    'title',
    String(row.normalizedSeriesTitle ?? '').trim().toLowerCase(),
    String(row.seriesYear ?? ''),
    issueNumber,
  ].join(':');
}

function assertCanonicalPacketRows(rows, packetId) {
  const seen = new Set();
  for (const [index, row] of rows.entries()) {
    const identity = packetRowIdentity(row);
    if (seen.has(identity)) {
      throw new Error(`${packetId} contains a duplicate canonical packet identity at row ${index + 1}: ${identity}`);
    }
    seen.add(identity);
  }
}

function assertRepeatedSourceReference(reference, index, rows) {
  const label = `Repeated source reference ${index + 1}`;
  if (!isPlainObject(reference)) throw new Error(`${label} must be an object`);
  const fields = Object.keys(reference);
  const missing = [...REPEATED_SOURCE_REFERENCE_FIELDS].filter((field) => !Object.hasOwn(reference, field));
  if (missing.length > 0) throw new Error(`${label} is missing required fields: ${missing.join(', ')}`);
  const unexpected = fields.filter((field) => !REPEATED_SOURCE_REFERENCE_FIELDS.has(field));
  if (unexpected.length > 0) throw new Error(`${label} has unsupported fields: ${unexpected.join(', ')}`);
  if (!Number.isInteger(reference.sourcePosition) || reference.sourcePosition < 1) {
    throw new Error(`${label} sourcePosition must be a positive integer`);
  }

  if (!Number.isInteger(reference.canonicalRow)
    || reference.canonicalRow < 1
    || reference.canonicalRow > rows.length) {
    throw new Error(`${label} canonicalRow must name a canonical packet row`);
  }
  assertNonEmptyString(reference.sourceIssueReference, `${label} sourceIssueReference`);
  if (reference.sourceRangeReference != null) {
    assertNonEmptyString(reference.sourceRangeReference, `${label} sourceRangeReference`);
  }
  assertNonEmptyString(reference.normalizedSeriesTitle, `${label} normalizedSeriesTitle`);
  if (!Number.isInteger(reference.seriesYear)) {
    throw new Error(`${label} seriesYear must be an integer`);
  }
  assertNonEmptyString(String(reference.issueNumber ?? ''), `${label} issueNumber`);
}

function assertExcludedSourceRow(row, index) {
  const label = `Excluded source row ${index + 1}`;
  if (!isPlainObject(row)) throw new Error(`${label} must be an object`);
  const fields = Object.keys(row);
  const missing = [...EXCLUDED_SOURCE_ROW_FIELDS].filter((field) => !Object.hasOwn(row, field));
  if (missing.length > 0) throw new Error(`${label} is missing required fields: ${missing.join(', ')}`);
  const unexpected = fields.filter((field) => !EXCLUDED_SOURCE_ROW_FIELDS.has(field));
  if (unexpected.length > 0) throw new Error(`${label} has unsupported fields: ${unexpected.join(', ')}`);
  if (!Number.isInteger(row.sourcePosition) || row.sourcePosition < 1) {
    throw new Error(`${label} sourcePosition must be a positive integer`);
  }
  assertNonEmptyString(row.sourceIssueReference, `${label} sourceIssueReference`);
  assertNonEmptyString(row.reason, `${label} reason`);
  assertNonEmptyString(row.decisionScope, `${label} decisionScope`);
}

function sourceIdentityKey(value) {
  return [
    String(value.normalizedSeriesTitle ?? '').trim().toLowerCase(),
    String(value.seriesYear ?? ''),
    String(value.issueNumber ?? '').trim(),
  ].join('|');
}

function gapEvidencePayload(gap) {
  return {
    sourcePosition: gap.sourcePosition,
    sourceIssueReference: gap.sourceIssueReference,
    sourceRangeReference: gap.sourceRangeReference ?? null,
    sourceGroup: gap.sourceGroup ?? null,
    normalizedSeriesTitle: gap.normalizedSeriesTitle,
    seriesYear: gap.seriesYear,
    issueNumber: String(gap.issueNumber),
    kind: gap.kind,
    status: gap.status,
    checkedAt: gap.checkedAt,
    auditBasis: gap.auditBasis,
    evidenceSources: gap.evidenceSources,
  };
}

export function gapEvidenceDigestFor(gap) {
  return digestCanonicalJson(gapEvidencePayload(gap));
}

function assertSourceGap(gap, index) {
  const label = `Source gap ${index + 1}`;
  if (!isPlainObject(gap)) throw new Error(`${label} must be an object`);
  const missing = [...SOURCE_GAP_FIELDS].filter((field) => (
    !SOURCE_GAP_OPTIONAL_FIELDS.has(field) && !Object.hasOwn(gap, field)
  ));
  if (missing.length > 0) throw new Error(`${label} is missing required fields: ${missing.join(', ')}`);
  const unexpected = Object.keys(gap).filter((field) => !SOURCE_GAP_FIELDS.has(field));
  if (unexpected.length > 0) throw new Error(`${label} has unsupported fields: ${unexpected.join(', ')}`);
  if (!Number.isInteger(gap.sourcePosition) || gap.sourcePosition < 1) {
    throw new Error(`${label} sourcePosition must be a positive integer`);
  }
  assertNonEmptyString(gap.sourceIssueReference, `${label} sourceIssueReference`);
  if (gap.sourceRangeReference != null) {
    assertNonEmptyString(gap.sourceRangeReference, `${label} sourceRangeReference`);
  }
  if (gap.sourceGroup != null) {
    assertNonEmptyString(gap.sourceGroup, `${label} sourceGroup`);
  }
  assertNonEmptyString(gap.normalizedSeriesTitle, `${label} normalizedSeriesTitle`);
  if (gap.seriesYear !== null && !Number.isInteger(gap.seriesYear)) {
    throw new Error(`${label} seriesYear must be an integer or null`);
  }
  assertNonEmptyString(String(gap.issueNumber ?? ''), `${label} issueNumber`);
  const validPair = (gap.kind === 'published-metadata-gap' && gap.status === 'open')
    || (gap.kind === 'availability-exclusion' && gap.status === 'closed')
    || (gap.kind === 'source-correction' && gap.status === 'closed');
  if (!validPair) throw new Error(`${label} kind and status are not a supported pair`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(gap.checkedAt ?? ''))) {
    throw new Error(`${label} checkedAt must be a YYYY-MM-DD date`);
  }
  assertNonEmptyString(gap.auditBasis, `${label} auditBasis`);
  if (!Array.isArray(gap.evidenceSources) || gap.evidenceSources.length === 0) {
    throw new Error(`${label} evidenceSources must be a non-empty array`);
  }
  const keys = gap.evidenceSources.map((source, sourceIndex) => {
    if (!isPlainObject(source)) throw new Error(`${label} evidence source ${sourceIndex + 1} must be an object`);
    const sourceMissing = [...GAP_EVIDENCE_SOURCE_FIELDS].filter((field) => !Object.hasOwn(source, field));
    if (sourceMissing.length > 0) {
      throw new Error(`${label} evidence source ${sourceIndex + 1} is missing required fields: ${sourceMissing.join(', ')}`);
    }
    const sourceUnexpected = Object.keys(source).filter((field) => !GAP_EVIDENCE_SOURCE_FIELDS.has(field));
    if (sourceUnexpected.length > 0) {
      throw new Error(`${label} evidence source ${sourceIndex + 1} has unsupported fields: ${sourceUnexpected.join(', ')}`);
    }
    assertNonEmptyString(source.kind, `${label} evidence source ${sourceIndex + 1} kind`);
    let url;
    try {
      url = new URL(source.url);
    } catch {
      throw new Error(`${label} evidence source ${sourceIndex + 1} url must be https`);
    }
    if (url.protocol !== 'https:') throw new Error(`${label} evidence source ${sourceIndex + 1} url must be https`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(source.retrievedAt ?? ''))) {
      throw new Error(`${label} evidence source ${sourceIndex + 1} retrievedAt must be a YYYY-MM-DD date`);
    }
    return `${source.kind}\u0000${source.url}\u0000${source.retrievedAt}`;
  });
  const sorted = [...keys].sort((left, right) => left.localeCompare(right));
  if (new Set(keys).size !== keys.length) throw new Error(`${label} evidenceSources contains a duplicate`);
  if (canonicalJson(keys) !== canonicalJson(sorted)) {
    throw new Error(`${label} evidenceSources must be sorted by kind, url, and retrievedAt`);
  }
  assertSha256(gap.evidenceDigest, `${label} evidenceDigest`);
  if (gapEvidenceDigestFor(gap) !== gap.evidenceDigest) throw new Error(`${label} evidence digest is stale`);
}

export function sourcePositionsForPacket(packet) {
  const packetId = String(packet?.id ?? 'Frozen packet');
  const rows = Array.isArray(packet?.rows) ? packet.rows : [];
  assertCanonicalPacketRows(rows, packetId);
  const hasOccurrenceCount = Object.hasOwn(packet ?? {}, 'sourceOccurrenceCount');
  const hasRepeatedReferences = Object.hasOwn(packet ?? {}, 'repeatedSourceReferences');
  const hasExcludedRows = Object.hasOwn(packet ?? {}, 'excludedSourceRows');
  const hasSourceGaps = Object.hasOwn(packet ?? {}, 'sourceGaps');
  if (hasOccurrenceCount !== (hasRepeatedReferences || hasExcludedRows || hasSourceGaps)) {
    throw new Error(`${packetId} sourceOccurrenceCount and supplemental source rows must appear together`);
  }
  if (!hasOccurrenceCount) return rows.map((_, index) => index + 1);

  const references = hasRepeatedReferences ? packet.repeatedSourceReferences : [];
  const excludedRows = hasExcludedRows ? packet.excludedSourceRows : [];
  if (hasRepeatedReferences && (!Array.isArray(references) || references.length === 0)) {
    throw new Error(`${packetId} repeatedSourceReferences must be a non-empty array when present`);
  }
  if (hasExcludedRows && (!Array.isArray(excludedRows) || excludedRows.length === 0)) {
    throw new Error(`${packetId} excludedSourceRows must be a non-empty array when present`);
  }
  const gaps = hasSourceGaps ? packet.sourceGaps : [];
  if (hasSourceGaps && (!Array.isArray(gaps) || gaps.length === 0)) {
    throw new Error(`${packetId} sourceGaps must be a non-empty array when present`);
  }
  if (!Number.isInteger(packet.sourceOccurrenceCount)
    || packet.sourceOccurrenceCount !== rows.length + references.length + excludedRows.length + gaps.length) {
    throw new Error(`${packetId} sourceOccurrenceCount must equal exact rows plus supplemental source rows`);
  }

  const bySourcePosition = new Map();
  let previousSourcePosition = 0;
  for (const [index, reference] of references.entries()) {
    assertRepeatedSourceReference(reference, index, rows);
    if (bySourcePosition.has(reference.sourcePosition)) {
      throw new Error(`${packetId} contains a duplicate repeated source position: ${reference.sourcePosition}`);
    }
    if (reference.sourcePosition <= previousSourcePosition) {
      throw new Error(`${packetId} repeatedSourceReferences must be in sourcePosition order`);
    }
    if (reference.sourcePosition > packet.sourceOccurrenceCount) {
      throw new Error(`${packetId} repeated source position ${reference.sourcePosition} is outside the source occurrence count`);
    }
    bySourcePosition.set(reference.sourcePosition, reference);
    previousSourcePosition = reference.sourcePosition;
  }
  previousSourcePosition = 0;
  for (const [index, excluded] of excludedRows.entries()) {
    assertExcludedSourceRow(excluded, index);
    if (bySourcePosition.has(excluded.sourcePosition)) {
      throw new Error(`${packetId} contains a duplicate supplemental source position: ${excluded.sourcePosition}`);
    }
    if (excluded.sourcePosition <= previousSourcePosition) {
      throw new Error(`${packetId} excludedSourceRows must be in sourcePosition order`);
    }
    if (excluded.sourcePosition > packet.sourceOccurrenceCount) {
      throw new Error(`${packetId} excluded source position ${excluded.sourcePosition} is outside the source occurrence count`);
    }
    bySourcePosition.set(excluded.sourcePosition, excluded);
    previousSourcePosition = excluded.sourcePosition;
  }
  const rowIdentities = new Set(rows.map(sourceIdentityKey));
  const gapIdentities = new Set();
  for (const [index, gap] of gaps.entries()) {
    assertSourceGap(gap, index);
    if (index > 0 && gap.sourcePosition <= gaps[index - 1].sourcePosition) {
      throw new Error(`${packetId} sourceGaps must be in sourcePosition order`);
    }
    if (gap.sourcePosition > packet.sourceOccurrenceCount) {
      throw new Error(`${packetId} source gap position ${gap.sourcePosition} is outside the source occurrence count`);
    }
    if (bySourcePosition.has(gap.sourcePosition)) {
      throw new Error(`${packetId} source position ${gap.sourcePosition} is used more than once`);
    }
    const identity = sourceIdentityKey(gap);
    if (rowIdentities.has(identity) || gapIdentities.has(identity)) {
      throw new Error(`${packetId} source gaps and exact rows must have unique identities`);
    }
    gapIdentities.add(identity);
    bySourcePosition.set(gap.sourcePosition, gap);
  }

  const canonicalSourcePositions = [];
  for (let sourcePosition = 1; sourcePosition <= packet.sourceOccurrenceCount; sourcePosition += 1) {
    const reference = bySourcePosition.get(sourcePosition);
    if (!reference) {
      canonicalSourcePositions.push(sourcePosition);
      continue;
    }
    if (!Object.hasOwn(reference, 'canonicalRow')) continue;
    if (reference.canonicalRow > canonicalSourcePositions.length) {
      throw new Error(`${packetId} repeated source position ${sourcePosition} must target an earlier canonical row`);
    }
    const canonical = rows[reference.canonicalRow - 1];
    const fields = ['normalizedSeriesTitle', 'seriesYear', 'issueNumber'];
    for (const field of fields) {
      if (String(reference[field]) !== String(canonical[field])) {
        throw new Error(`${packetId} repeated source position ${sourcePosition} ${field} differs from canonical row ${reference.canonicalRow}`);
      }
    }
  }
  if (canonicalSourcePositions.length !== rows.length) {
    throw new Error(`${packetId} source occurrence positions do not reconstruct every canonical row`);
  }
  return canonicalSourcePositions;
}

export function sourceOccurrenceCountFor(packet) {
  sourcePositionsForPacket(packet);
  return packet.sourceOccurrenceCount ?? packet.rows.length;
}

export function assertMappingMatchesPacketOccurrences(packet, mapping) {
  const packetId = String(packet?.id ?? mapping?.id ?? 'Candidate');
  const expectedPositions = sourcePositionsForPacket(packet);
  const expectedCount = sourceOccurrenceCountFor(packet);
  const packetReferences = packet.repeatedSourceReferences ?? null;
  const mappingReferences = mapping?.repeatedSourceReferences ?? null;
  const packetExclusions = packet.excludedSourceRows ?? null;
  const mappingExclusions = mapping?.excludedSourceRows ?? null;
  const packetGaps = packet.sourceGaps ?? null;
  const mappingGaps = mapping?.sourceGaps ?? null;
  if ((packet.sourceOccurrenceCount ?? null) !== (mapping?.sourceOccurrenceCount ?? null)
    || canonicalJson(packetReferences) !== canonicalJson(mappingReferences)
    || canonicalJson(packetGaps) !== canonicalJson(mappingGaps)) {
    throw new Error(`${packetId} mapping source position evidence differs from its frozen packet`);
  }
  if (canonicalJson(packetExclusions) !== canonicalJson(mappingExclusions)) {
    throw new Error(`${packetId} mapping excluded source evidence differs from its frozen packet`);
  }
  if (mapping?.approvedSourceCount !== expectedCount) {
    throw new Error(`${packetId} approvedSourceCount differs from its frozen source occurrence count`);
  }
  const mappingRows = Array.isArray(mapping?.rows) ? mapping.rows : [];
  if (mappingRows.length !== expectedPositions.length) {
    throw new Error(`${packetId} mapping row count differs from its canonical packet rows`);
  }
  for (const [index, expectedPosition] of expectedPositions.entries()) {
    if (mappingRows[index]?.sourcePosition !== expectedPosition) {
      throw new Error(`${packetId} mapping row ${index + 1} sourcePosition differs from its frozen packet`);
    }
  }
  return true;
}

export function assertGapTransition(previousPacket, proposedPacket, proposedMapping) {
  validateFrozenPacket(previousPacket);
  validateFrozenPacket(proposedPacket);
  assertMappingMatchesPacketOccurrences(proposedPacket, proposedMapping);
  const previousGaps = previousPacket.sourceGaps ?? [];
  if (previousGaps.length === 0) return true;
  const proposedGaps = new Map((proposedPacket.sourceGaps ?? [])
    .map((gap) => [gap.sourcePosition, gap]));
  const proposedPositions = sourcePositionsForPacket(proposedPacket);
  const rowsByPosition = new Map(proposedPositions
    .map((sourcePosition, index) => [sourcePosition, proposedPacket.rows[index]]));
  const mappingByPosition = new Map((proposedMapping.rows ?? [])
    .map((row) => [row.sourcePosition, row]));
  for (const previous of previousGaps) {
    const retained = proposedGaps.get(previous.sourcePosition);
    if (retained) {
      const closesAvailabilityGap = (
        previous.kind === 'published-metadata-gap'
        && previous.status === 'open'
        && retained.kind === 'availability-exclusion'
        && retained.status === 'closed'
      );
      if (sourceIdentityKey(retained) !== sourceIdentityKey(previous)
        || (!closesAvailabilityGap
          && (retained.kind !== previous.kind || retained.status !== previous.status))) {
        throw new Error(`Source gap at position ${previous.sourcePosition} changed identity or disposition`);
      }
      continue;
    }
    if (previous.kind !== 'published-metadata-gap' || previous.status !== 'open') {
      throw new Error(`Closed source gap at position ${previous.sourcePosition} cannot become exact`);
    }
    const row = rowsByPosition.get(previous.sourcePosition);
    const mappingRow = mappingByPosition.get(previous.sourcePosition);
    if (!row || !mappingRow || mappingRow.resolutionStatus !== 'exact') {
      throw new Error(`Open source gap at position ${previous.sourcePosition} disappeared without an exact replacement`);
    }
    if (sourceIdentityKey(row) !== sourceIdentityKey(previous)
      || sourceIdentityKey(mappingRow) !== sourceIdentityKey(previous)) {
      throw new Error(`Open source gap at position ${previous.sourcePosition} changed identity when resolved`);
    }
  }
  return true;
}

function assertManifestProposal(packet, provider) {
  const manifest = packet.proposedManifest;
  if (!isPlainObject(manifest)) throw new Error(`${packet.id} proposedManifest must be an object`);
  if (manifest.id !== packet.id) throw new Error(`${packet.id} proposedManifest id does not match the packet`);
  if (manifest.sourcePage !== packet.sourceUrl) {
    throw new Error(`${packet.id} proposedManifest sourcePage does not match the packet`);
  }
  if ((manifest.sourceSection ?? null) !== (packet.sourceSection ?? null)) {
    throw new Error(`${packet.id} proposedManifest sourceSection does not match the packet`);
  }
  const publishedAndGapCount = packet.expectedCount + (packet.sourceGaps?.length ?? 0);
  if (manifest.expect !== packet.expectedCount && manifest.expect !== publishedAndGapCount) {
    throw new Error(`${packet.id} proposedManifest expect does not match its published rows or published and gap rows`);
  }
  if (manifest.sourceOrigin !== provider.sourceOrigin) {
    throw new Error(`${packet.id} proposedManifest has the wrong source origin`);
  }
  if (manifest.sourceLicense !== null) {
    throw new Error(`${packet.id} proposedManifest must keep sourceLicense null`);
  }
  if (manifest.sourceFile !== `${packet.id}.md`) {
    throw new Error(`${packet.id} proposedManifest sourceFile must be ${packet.id}.md`);
  }
  if (manifest.out !== `${packet.id.replaceAll('-', '_')}.json`) {
    throw new Error(`${packet.id} proposedManifest out does not match its id`);
  }
  if (!Number.isInteger(Number(manifest.coverIssueId))) {
    throw new Error(`${packet.id} proposedManifest must name an exact coverIssueId`);
  }
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function digestCanonicalJson(value) {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}

export function packetDigestFor(packet) {
  const payload = { ...packet };
  delete payload.packetDigest;
  return digestCanonicalJson(payload);
}

export function mappingDigestFor(mapping) {
  return digestCanonicalJson(selectedFields(mapping, MAPPING_DIGEST_FIELDS));
}

export function reportDigestFor(report) {
  return digestCanonicalJson(selectedFields(report, REPORT_DIGEST_FIELDS));
}

export function approvalDigestFor(relationshipReview) {
  const payload = { ...relationshipReview };
  delete payload.approvalDigest;
  return digestCanonicalJson(payload);
}

export function libraryDigestFor(manifest, orderIssueIds) {
  const reviewedManifest = {
    ...manifest,
    lists: manifest.lists.map(({ spotlightKind: _spotlightKind, ...entry }) => entry),
  };
  return digestCanonicalJson({ manifest: reviewedManifest, orderIssueIds });
}

export function libraryDigestExcludingOrders(library, excludedOrderIds = []) {
  const excluded = new Set(excludedOrderIds);
  const lists = (library?.manifest?.lists ?? [])
    .filter((entry) => !excluded.has(entry.id));
  const paths = Array.isArray(library?.manifest?.paths)
    ? library.manifest.paths.filter((entry) => (
      !excluded.has(entry.id)
      && !entry.steps?.some((step) => excluded.has(step))
    ))
    : library?.manifest?.paths;
  const orderIssueIds = Array.isArray(library?.orderIssueIds)
    ? library.orderIssueIds.filter((entry) => !excluded.has(entry.id))
    : Object.fromEntries(
      Object.entries(library?.orderIssueIds ?? {})
        .filter(([id]) => !excluded.has(id)),
    );
  return libraryDigestFor({ ...library.manifest, lists, paths }, orderIssueIds);
}

export function validateMappingDigest(mapping) {
  assertSha256(mapping?.mappingDigest, `${mapping?.id ?? 'Mapping'} mappingDigest`);
  const actual = mappingDigestFor(mapping);
  if (actual !== mapping.mappingDigest) {
    throw new Error(`${mapping?.id ?? 'Mapping'} mapping digest is stale`);
  }
  return true;
}

export function validateReportDigest(report) {
  assertSha256(report?.reportDigest, `${report?.candidateId ?? 'Report'} reportDigest`);
  const actual = reportDigestFor(report);
  if (actual !== report.reportDigest) {
    throw new Error(`${report?.candidateId ?? 'Report'} report digest is stale`);
  }
  return true;
}

export function validateApprovalDigest(relationshipReview, candidateId = 'Candidate') {
  assertSha256(relationshipReview?.approvalDigest, `${candidateId} approvalDigest`);
  const actual = approvalDigestFor(relationshipReview);
  if (actual !== relationshipReview.approvalDigest) {
    throw new Error(`${candidateId} approval digest is stale`);
  }
  return true;
}

export function validateFrozenPacket(packet, {
  expectedId = null,
  inventoryRecord = null,
  catalogEntries = [],
  provider = CBH_SOURCE_PROVIDER,
} = {}) {
  if (!isPlainObject(packet)) throw new Error('Frozen packet must be an object');
  const unexpected = Object.keys(packet).filter((field) => !PACKET_FIELDS.has(field));
  if (unexpected.length > 0) {
    throw new Error(`Frozen packet has unsupported fields: ${unexpected.join(', ')}`);
  }
  if (packet.schemaVersion !== 1) throw new Error('Frozen packet schemaVersion must be 1');
  assertNonEmptyString(packet.id, 'Frozen packet id');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(packet.id)) {
    throw new Error('Frozen packet id must be lower-kebab-case');
  }
  if (expectedId != null && packet.id !== expectedId) {
    throw new Error(`Frozen packet id ${packet.id} does not match requested id ${expectedId}`);
  }
  assertNonEmptyString(packet.inventoryId, `${packet.id} inventoryId`);
  assertNonEmptyString(packet.sourceUrl, `${packet.id} sourceUrl`);
  if (!isPlainObject(provider)
    || typeof provider.id !== 'string'
    || !Array.isArray(provider.hosts)
    || provider.hosts.length === 0
    || typeof provider.sourceOrigin !== 'string') {
    throw new Error(`${packet.id} source provider configuration is invalid`);
  }
  if (provider.requireSourceProvider && packet.sourceProvider !== provider.id) {
    throw new Error(`${packet.id} sourceProvider must be ${provider.id}`);
  }
  if (packet.sourceProvider != null && packet.sourceProvider !== provider.id) {
    throw new Error(`${packet.id} sourceProvider does not match ${provider.id}`);
  }
  let sourceUrl;
  try {
    sourceUrl = new URL(packet.sourceUrl);
  } catch {
    throw new Error(`${packet.id} sourceUrl must be an exact ${provider.id} page`);
  }
  if (sourceUrl.protocol !== 'https:' || !provider.hosts.includes(sourceUrl.hostname)) {
    throw new Error(`${packet.id} sourceUrl must be an exact ${provider.id} page`);
  }
  if (provider.requireSourceContentSha256) {
    assertSha256(packet.sourceContentSha256, `${packet.id} sourceContentSha256`);
  } else if (packet.sourceContentSha256 != null) {
    assertSha256(packet.sourceContentSha256, `${packet.id} sourceContentSha256`);
  }
  if (packet.sourceSection != null) {
    assertNonEmptyString(packet.sourceSection, `${packet.id} sourceSection`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(packet.sourceRetrievedAt ?? ''))) {
    throw new Error(`${packet.id} sourceRetrievedAt must be a YYYY-MM-DD date`);
  }
  if (packet.sourceIssueBearingBlocksSha256 != null) {
    assertSha256(
      packet.sourceIssueBearingBlocksSha256,
      `${packet.id} sourceIssueBearingBlocksSha256`,
    );
  }
  assertNonEmptyString(packet.sourceBoundary, `${packet.id} sourceBoundary`);
  if (!Array.isArray(packet.excludedSourceReferences)
    || packet.excludedSourceReferences.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`${packet.id} excludedSourceReferences must be an array of non-empty strings`);
  }
  if (new Set(packet.excludedSourceReferences).size !== packet.excludedSourceReferences.length) {
    throw new Error(`${packet.id} excludedSourceReferences contains a duplicate`);
  }
  if (!Array.isArray(packet.rows) || packet.rows.length === 0) {
    throw new Error(`${packet.id} rows must be a non-empty array`);
  }
  packet.rows.forEach((row, index) => assertPacketRow(row, index));
  sourcePositionsForPacket(packet);
  if (!Number.isInteger(packet.expectedCount) || packet.expectedCount !== packet.rows.length) {
    throw new Error(`${packet.id} expectedCount must equal its row count`);
  }
  assertManifestProposal(packet, provider);
  if (!isPlainObject(packet.insertionAnchor)
    || Object.keys(packet.insertionAnchor).length !== 1
    || typeof packet.insertionAnchor.beforeId !== 'string'
    || !packet.insertionAnchor.beforeId.trim()
    || packet.insertionAnchor.beforeId === packet.id) {
    throw new Error(`${packet.id} insertionAnchor must name one different beforeId`);
  }
  const sourceReview = packet.sourceReview;
  if (!isPlainObject(sourceReview)
    || !['human', 'stronger-model'].includes(sourceReview.authorityType)) {
    throw new Error(`${packet.id} sourceReview requires human or stronger-model authority`);
  }
  assertNonEmptyString(sourceReview.authorityIdentity, `${packet.id} sourceReview authorityIdentity`);
  assertNonEmptyString(sourceReview.rationale, `${packet.id} sourceReview rationale`);
  assertNonEmptyString(sourceReview.reviewedAt, `${packet.id} sourceReview reviewedAt`);
  assertSha256(packet.packetDigest, `${packet.id} packetDigest`);
  if (packetDigestFor(packet) !== packet.packetDigest) {
    throw new Error(`${packet.id} packet digest is stale`);
  }

  if (inventoryRecord) {
    if (inventoryRecord.id !== packet.inventoryId) {
      throw new Error(`${packet.id} inventory identity does not match ${packet.inventoryId}`);
    }
    const inventorySourceUrl = inventoryRecord.url ?? inventoryRecord.sourceUrl;
    if (inventorySourceUrl !== packet.sourceUrl) {
      throw new Error(`${packet.id} source URL differs from inventory record ${packet.inventoryId}`);
    }
    if (['blocked', 'not-applicable'].includes(inventoryRecord.deliveryStatus)) {
      throw new Error(`${packet.id} inventory record is not eligible for preparation`);
    }
  }

  const catalogEntriesForPacket = catalogEntries.filter((entry) => entry.id === packet.id);
  if (catalogEntriesForPacket.length > 1) {
    throw new Error(`${packet.id} has duplicate catalog entries`);
  }
  const existingRecords = catalogEntries
    .filter((entry) => entry.id !== packet.id)
    .map((entry) => ({
      id: entry.id,
      url: entry.sourcePage,
      sourceSection: entry.sourceSection,
      catalogIds: [entry.id],
    }));
  validateBatchNoDuplicates([{
    id: packet.id,
    url: packet.sourceUrl,
    sourceSection: packet.sourceSection,
    catalogIds: [packet.proposedManifest.id],
  }], existingRecords);
  return true;
}

export function sourceIdentityForRecord(record) {
  if (!record || typeof record !== 'object') return null;
  const rawUrl = record.url ?? record.sourceUrl ?? record.sourcePage;
  const sourceUrl = rawUrl == null ? null : String(rawUrl).trim() || null;
  if (!sourceUrl) return null;
  const rawSection = record.sourceSection;
  const sourceSection = rawSection == null ? null : String(rawSection).trim() || null;
  return {
    key: JSON.stringify(sourceSection ? [sourceUrl, sourceSection] : [sourceUrl]),
    sourceUrl,
    sourceSection,
  };
}

function rememberSource(identity, seen) {
  if (!identity) return;
  seen.urls.add(identity.sourceUrl);
  if (identity.sourceSection) seen.sections.add(identity.key);
  else seen.wholePages.add(identity.sourceUrl);
}

export function validateSourceIdentities(batchRecords = [], existingRecords = []) {
  const seen = {
    urls: new Set(),
    wholePages: new Set(),
    sections: new Set(),
  };
  for (const record of existingRecords) rememberSource(sourceIdentityForRecord(record), seen);

  for (const record of batchRecords) {
    const identity = sourceIdentityForRecord(record);
    if (!identity) continue;
    if (identity.sourceSection) {
      if (seen.wholePages.has(identity.sourceUrl)) {
        throw new Error(`Duplicate source URL: ${identity.sourceUrl}`);
      }
      if (seen.sections.has(identity.key)) {
        throw new Error(`Duplicate source page and section: ${identity.sourceUrl} :: ${identity.sourceSection}`);
      }
    } else if (seen.urls.has(identity.sourceUrl)) {
      throw new Error(`Duplicate source URL: ${identity.sourceUrl}`);
    }
    rememberSource(identity, seen);
  }
  return true;
}

function assertField(name, value, predicate, message) {
  if (!predicate(value)) {
    throw new Error(`${name}: ${message}`);
  }
}

export function validateBatchNoDuplicates(batchRecords = [], existingRecords = [], peerRecords = []) {
  const seenIds = new Set();
  const seenIssueSequences = new Set();
  const seenCatalogIds = new Set();

  const keysFor = (record) => {
    if (!record || typeof record !== 'object') {
      return null;
    }
    const recordId = record.id != null ? String(record.id) : null;
    const sourceIdentity = sourceIdentityForRecord(record);
    const selectedIssueIds = Array.isArray(record.selectedIssueIds)
      ? record.selectedIssueIds.map((entry) => String(entry))
      : (Array.isArray(record.issueIds)
        ? record.issueIds.map((entry) => String(entry))
        : (record.selectedIssueId != null ? [String(record.selectedIssueId)] : []));
    const catalogIds = Array.isArray(record.catalogIds)
      ? record.catalogIds.map((entry) => String(entry))
      : (record.catalogId != null ? [String(record.catalogId)] : []);
    return {
      recordId,
      sourceIdentity,
      sequenceKey: selectedIssueIds.length > 0 ? selectedIssueIds.join('|') : null,
      catalogIds,
    };
  };

  for (const record of existingRecords) {
    const keys = keysFor(record);
    if (!keys) continue;
    if (keys.recordId) seenIds.add(keys.recordId);
    if (keys.sequenceKey) seenIssueSequences.add(keys.sequenceKey);
    for (const catalogId of keys.catalogIds) seenCatalogIds.add(catalogId);
  }

  const candidateRecords = [...batchRecords, ...peerRecords];
  validateSourceIdentities(candidateRecords, existingRecords);
  for (const record of candidateRecords) {
    const keys = keysFor(record);
    if (!keys) continue;
    if (keys.recordId && seenIds.has(keys.recordId)) {
      throw new Error(`Duplicate batch id: ${keys.recordId}`);
    }
    if (keys.recordId) seenIds.add(keys.recordId);
    if (keys.sequenceKey && seenIssueSequences.has(keys.sequenceKey)) {
      throw new Error(`Duplicate selected issue sequence: ${keys.sequenceKey}`);
    }
    if (keys.sequenceKey) seenIssueSequences.add(keys.sequenceKey);
    for (const catalogId of keys.catalogIds) {
      if (seenCatalogIds.has(catalogId)) {
        throw new Error(`Duplicate catalog id: ${catalogId}`);
      }
      seenCatalogIds.add(catalogId);
    }
  }

  return true;
}

export function validateInventory(records) {
  if (!Array.isArray(records)) {
    throw new Error('The inventory must be an array');
  }
  if (records.length !== BASELINE_COUNT) {
    throw new Error(`The baseline inventory must contain ${BASELINE_COUNT} records, found ${records.length}`);
  }

  const counts = {
    event: 0,
    era: 0,
    'sub-guide': 0,
    bridge: 0,
    'fast-track': 0,
    commerce: 0,
  };

  const seenIds = new Set();
  const seenUrls = new Set();
  const positions = [];

  for (const [index, record] of records.entries()) {
    const position = index + 1;
    assertField(`Record ${position}`, record && typeof record === 'object', Boolean, 'must be an object');
    assertField(`Record ${position} position`, record.position, (value) => Number.isInteger(value) && value === position, 'must be the next integer position');
    positions.push(record.position);

    assertField(`Record ${position} id`, record.id, (value) => typeof value === 'string' && value.trim().length > 0, 'must be a non-empty string');
    if (seenIds.has(record.id)) {
      throw new Error(`Duplicate inventory id: ${record.id}`);
    }
    seenIds.add(record.id);

    assertField(`Record ${position} title`, record.title, (value) => typeof value === 'string' && value.trim().length > 0, 'must be a non-empty string');
    assertField(`Record ${position} url`, record.url, (value) => typeof value === 'string' && /^https?:\/\//.test(value.trim()), 'must be an absolute URL');
    if (seenUrls.has(record.url)) {
      throw new Error(`Duplicate inventory url: ${record.url}`);
    }
    seenUrls.add(record.url);

    assertField(`Record ${position} guideType`, record.guideType, (value) => GUIDE_TYPES.includes(value), 'must be a known guide type');
    assertField(`Record ${position} window`, record.window, (value) => /^Q[1-7]$/.test(value), 'must use Q1 through Q7');
    assertField(`Record ${position} disposition`, record.disposition, (value) => DISPOSITIONS.includes(value), 'must be a known disposition');
    assertField(`Record ${position} reason`, record.reason, (value) => typeof value === 'string' && value.trim().length > 0, 'must be a non-empty string');
    assertField(`Record ${position} sourceRetrievedAt`, record.sourceRetrievedAt, (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)), 'must be a YYYY-MM-DD date string');
    assertField(`Record ${position} overlapIds`, record.overlapIds, Array.isArray, 'must be an array');
    assertField(`Record ${position} catalogIds`, record.catalogIds, Array.isArray, 'must be an array');
    assertField(`Record ${position} deliveryStatus`, record.deliveryStatus, (value) => DELIVERY_STATUSES.includes(value), 'must be a known delivery status');

    counts[record.guideType] += 1;

    validateInventoryRecord(record);
    if (record.guideType === 'commerce' && record.disposition !== 'excluded') {
      throw new Error(`commerce record ${record.id} must be excluded`);
    }
    if (record.id === 'armageddon-2026' && record.disposition !== 'deferred') {
      throw new Error('armageddon-2026 must remain deferred');
    }
    if (new Set(record.overlapIds).size !== record.overlapIds.length) {
      throw new Error(`Record ${record.id} contains duplicate overlap ids`);
    }
    if (new Set(record.catalogIds).size !== record.catalogIds.length) {
      throw new Error(`Record ${record.id} contains duplicate catalog ids`);
    }
  }

  const expectedCounts = {
    event: 42,
    era: 14,
    'sub-guide': 14,
    bridge: 10,
    'fast-track': 3,
    commerce: 3,
  };

  const mismatchedCounts = Object.entries(expectedCounts).filter(([key, count]) => counts[key] !== count);
  if (mismatchedCounts.length > 0) {
    throw new Error(`Inventory totals do not match the contract: ${JSON.stringify(mismatchedCounts)}`);
  }

  if (positions.length !== BASELINE_COUNT || positions.some((value, idx) => value !== idx + 1)) {
    throw new Error(`Positions must be exactly 1 through ${BASELINE_COUNT}`);
  }

  return counts;
}

export async function readInventory(sourcePath) {
  const text = await readFile(sourcePath, 'utf8');
  const records = JSON.parse(text);
  validateInventory(records);
  return records;
}

function validateInventoryRecord(record, { baseline = false } = {}) {
  const position = record?.position ?? 'unknown';
  assertField(`Record ${position}`, record && typeof record === 'object', Boolean, 'must be an object');
  assertField(`Record ${position} id`, record.id, (value) => typeof value === 'string' && value.trim().length > 0, 'must be a non-empty string');
  assertField(`Record ${position} title`, record.title, (value) => typeof value === 'string' && value.trim().length > 0, 'must be a non-empty string');
  assertField(`Record ${position} url`, record.url, (value) => typeof value === 'string' && /^https?:\/\//.test(value.trim()), 'must be an absolute URL');
  assertField(`Record ${position} guideType`, record.guideType, (value) => GUIDE_TYPES.includes(value), 'must be a known guide type');
  assertField(
    `Record ${position} window`,
    record.window,
    (value) => (!baseline && value == null) || /^Q[1-7]$/.test(value),
    baseline ? 'must use Q1 through Q7' : 'must use Q1 through Q7 or null',
  );
  assertField(`Record ${position} disposition`, record.disposition, (value) => DISPOSITIONS.includes(value), 'must be a known disposition');
  assertField(`Record ${position} reason`, record.reason, (value) => typeof value === 'string' && value.trim().length > 0, 'must be a non-empty string');
  assertField(`Record ${position} sourceRetrievedAt`, record.sourceRetrievedAt, (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)), 'must be a YYYY-MM-DD date string');
  assertField(`Record ${position} overlapIds`, record.overlapIds, (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string'), 'must be an array of strings');
  assertField(`Record ${position} catalogIds`, record.catalogIds, (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string'), 'must be an array of strings');
  assertField(`Record ${position} deliveryStatus`, record.deliveryStatus, (value) => DELIVERY_STATUSES.includes(value), 'must be a known delivery status');

  if (baseline) {
    if (record.disposition === 'new-order' && record.deliveryStatus !== 'pending') {
      throw new Error(`new-order record ${record.id} must use deliveryStatus 'pending'`);
    }
    if (record.disposition !== 'new-order' && record.deliveryStatus !== 'not-applicable') {
      throw new Error(`non-new-order record ${record.id} must use deliveryStatus 'not-applicable'`);
    }
    if (record.overlapIds.length !== 0 || record.catalogIds.length !== 0) {
      throw new Error(`Baseline record ${record.id} must keep overlapIds and catalogIds empty`);
    }
    return;
  }

  if (record.disposition === 'new-order' && !['pending', 'ready', 'shipped', 'blocked'].includes(record.deliveryStatus)) {
    throw new Error(`new-order record ${record.id} has an invalid deliveryStatus: ${record.deliveryStatus}`);
  }
  if (record.disposition !== 'new-order' && !['not-applicable', 'blocked', 'ready', 'shipped'].includes(record.deliveryStatus)) {
    throw new Error(`Record ${record.id} has a deliveryStatus that does not fit its disposition: ${record.deliveryStatus}`);
  }
  if (record.deliveryStatus === 'blocked' && !record.reason?.trim()) {
    throw new Error(`Blocked record ${record.id} must include a blocker reason`);
  }
}

function validateCharacterInventoryRecord(record) {
  const label = `Character inventory ${record.id}`;
  if (!CHARACTER_DISPOSITIONS.has(record.centralDisposition)) {
    throw new Error(`${label} has invalid centralDisposition`);
  }
  if (!Array.isArray(record.labels) || record.labels.length === 0
      || record.labels.some((value) => typeof value !== 'string' || !value.trim())
      || new Set(record.labels).size !== record.labels.length) {
    throw new Error(`${label} labels must be unique non-empty strings`);
  }
  if (!Array.isArray(record.sourcePositions)
      || record.sourcePositions.length !== record.labels.length
      || record.sourcePositions.some((value) => !Number.isInteger(value) || value < 1)
      || new Set(record.sourcePositions).size !== record.sourcePositions.length) {
    throw new Error(`${label} sourcePositions must uniquely match labels`);
  }
  if (!Array.isArray(record.duplicateFlags)
      || (record.duplicateFlags.length !== 0
        && record.duplicateFlags.length !== record.sourcePositions.length)
      || record.duplicateFlags.some((value) => typeof value !== 'string' || !value.trim())) {
    throw new Error(`${label} duplicateFlags must be empty or match source positions`);
  }
  assertSha256(record.sourceContentSha256, `${label} sourceContentSha256`);
  if (!CHARACTER_BOUNDARY_STATUSES.has(record.sourceBoundaryStatus)) {
    throw new Error(`${label} has invalid sourceBoundaryStatus`);
  }
  if (!CHARACTER_HORIZON_STATUSES.has(record.metadataHorizonStatus)) {
    throw new Error(`${label} has invalid metadataHorizonStatus`);
  }

  const expectedState = {
    deferred: ['deferred', 'not-applicable', 'blocked-exact-resolution-not-run'],
    excluded: ['excluded', 'not-applicable', 'blocked-exact-resolution-not-run'],
    blocked: ['deferred', 'blocked', 'blocked-confirmed-post-horizon'],
    'pilot-approved': ['new-order', ['ready', 'shipped'], 'approved'],
  }[record.centralDisposition];
  const actualState = [record.disposition, record.deliveryStatus, record.metadataHorizonStatus];
  if (actualState.some((value, index) => (
    Array.isArray(expectedState[index])
      ? !expectedState[index].includes(value)
      : value !== expectedState[index]
  ))) {
    throw new Error(`${label} state conflicts with centralDisposition`);
  }
}

export function validateInventoryState(records) {
  if (!Array.isArray(records)) {
    throw new Error('The inventory must be an array');
  }
  if (records.length === 0) throw new Error('The inventory must not be empty');
  const counts = {};
  const ids = new Set();
  const seenSources = {
    urls: new Set(),
    wholePages: new Set(),
    sections: new Set(),
  };
  for (const [index, record] of records.entries()) {
    validateInventoryRecord(record, { baseline: false });
    if (record.position !== index + 1) {
      throw new Error(`Record ${record.id} position must be ${index + 1}`);
    }
    if (ids.has(record.id)) throw new Error(`Duplicate inventory id: ${record.id}`);
    try {
      validateSourceIdentities([record], []);
    } catch (error) {
      throw new Error(`Record ${record.id} has an invalid source identity: ${error.message}`, { cause: error });
    }
    const sourceIdentity = sourceIdentityForRecord(record);
    if (sourceIdentity?.sourceSection) {
      if (seenSources.wholePages.has(sourceIdentity.sourceUrl)) {
        throw new Error(`Duplicate inventory url: ${sourceIdentity.sourceUrl}`);
      }
      if (seenSources.sections.has(sourceIdentity.key)) {
        throw new Error(`Duplicate inventory source section: ${sourceIdentity.sourceUrl} :: ${sourceIdentity.sourceSection}`);
      }
      seenSources.sections.add(sourceIdentity.key);
      seenSources.urls.add(sourceIdentity.sourceUrl);
    } else {
      if (seenSources.urls.has(record.url)) throw new Error(`Duplicate inventory url: ${record.url}`);
      seenSources.wholePages.add(record.url);
      seenSources.urls.add(record.url);
    }
    ids.add(record.id);
    if (new Set(record.overlapIds).size !== record.overlapIds.length) {
      throw new Error(`Record ${record.id} contains duplicate overlap ids`);
    }
    if (new Set(record.catalogIds).size !== record.catalogIds.length) {
      throw new Error(`Record ${record.id} contains duplicate catalog ids`);
    }
    const key = record.guideType;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  const isCharacterInventory = records.some((record) => (
    record.guideType === 'character-run'
    || Object.hasOwn(record, 'centralDisposition')
    || Object.hasOwn(record, 'sourceBoundaryStatus')
    || Object.hasOwn(record, 'metadataHorizonStatus')
  ));
  if (isCharacterInventory) {
    if (records.length !== CHARACTER_INVENTORY_COUNT) {
      throw new Error(`Character inventory must contain exactly ${CHARACTER_INVENTORY_COUNT} records`);
    }
    for (const record of records) validateCharacterInventoryRecord(record);
  }
  return counts;
}

export const validateLiveInventory = validateInventoryState;
export const validateInventorySchema = validateInventoryState;
