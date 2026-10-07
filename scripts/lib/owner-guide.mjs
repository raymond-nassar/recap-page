import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertApprovedRelationshipReview, mergePacketEntries } from '../author-cbh-packet.mjs';
import {
  preflightPublication, preflightPublicationWrites, readPublicationInputs, requireCleanPreflight,
} from '../check-publication.mjs';
import { cleanText, loadCachedMetadata, writeOutputsAtomically } from '../vendor-orders.mjs';
import { parseManifest } from '../../src/js/lib/curated.js';
import { escapeLinkText, issueIdFromUrl, normalizeTitle, parseChecklist, stripInlineMarkdown } from '../../src/js/lib/markdown.js';
import {
  approvalDigestFor, assertMappingMatchesPacketOccurrences, canonicalJson, digestCanonicalJson, gapEvidenceDigestFor,
  mappingDigestFor, packetDigestFor, sourceCountsForPacket,
  sourcePositionsForPacket, validatePacketProposal,
} from './cbh-inventory.mjs';
import { resolveRow } from './cbh-resolution.mjs';
import { buildCurrentOwnerOverlap, loadCurrentOwnerLibrary } from './owner-current-library.mjs';
import { readOwnerGuideRegistry } from './owner-guide-registry.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const OWNER_PROVIDER = Object.freeze({
  id: 'owner-authored', hosts: ['github.com'], sourceOrigin: 'Selected by raymond-nassar for MCU Prep',
  requireSourceContentSha256: true, requireSourceProvider: true,
  allowMissingCover: true,
});
const hash = (value) => createHash('sha256').update(value).digest('hex');
const jsonText = (value) => `${JSON.stringify(value, null, 2)}\n`;
const same = (left, right, reason) => assert.equal(canonicalJson(left), canonicalJson(right), reason);
const positiveId = (id) => Number.isSafeInteger(id) && id > 0;

export function parseOwnerMarkdown(text) {
  assert.equal(typeof text, 'string', 'Owner Markdown must be text.');
  assert.ok(!/data:image\//i.test(text), 'Comic image bytes cannot be part of a reading-list input.');
  const selections = [];
  let group = null;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (/^\s*(```|~~~)/.test(line)) throw new Error('Fenced content requires an explicit selection before preparation.');
    const heading = /^ {0,3}(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      group = heading[1].length === 1 ? null : stripInlineMarkdown(heading[2]);
      continue;
    }
    const item = /^ {0,3}(?:\d+[.)]|[-*])\s+(.+)$/.exec(line);
    if (!item) {
      if (/^\s+(?:\d+[.)]|[-*])\s+/.test(line)) {
        throw new Error('Nested selections require an explicit flat owner order.');
      }
      if (line.trim() && selections.length) selections.at(-1).continuation.push(line);
      continue;
    }
    const parsed = parseChecklist(`- ${item[1]}`);
    const entry = [...parsed.entries, ...parsed.unresolved][0];
    assert.ok(entry, `Markdown selection at line ${index + 1} is empty.`);
    const bold = /^\*\*(.+?)\*\*(?:\s|$)/.exec(item[1]);
    selections.push({
      inputPosition: selections.length + 1, line: index + 1, markdown: line,
      title: bold ? stripInlineMarkdown(bold[1]) : entry.title,
      group, issueId: positiveId(entry.issueId) ? entry.issueId : null, continuation: [],
    });
  }
  assert.ok(selections.length, 'Owner Markdown has no selections.');
  return selections.map((selection) => ({
    ...selection, inputSha256: hash([selection.markdown, ...selection.continuation].join('\n')),
  }));
}

function directIssues(selection) {
  const match = /^(.*?)\s+\((\d{4})\)\s+#(\d+(?:\.\d+)?)(?:-(\d+))?$/.exec(selection.title);
  if (!match) return null;
  const first = Number(match[3]);
  const last = match[4] ? Number(match[4]) : first;
  if (last < first || last - first > 9999 || (match[4] && !Number.isInteger(first))) {
    throw new Error('An issue range needs an explicit, bounded ascending selection.');
  }
  return Array.from({ length: last - first + 1 }, (_, offset) => ({
    sourceIssueReference: `${match[1]} (${match[2]}) #${first + offset}`,
    normalizedSeriesTitle: normalizeTitle(match[1]), seriesYear: Number(match[2]),
    issueNumber: String(first + offset),
    ...(selection.issueId ? { candidateIssueId: selection.issueId } : {}),
  }));
}

function candidateFromRecord(record) {
  const body = record.body;
  const identity = /^(.*?)\s+\((\d{4})\)\s+#/.exec(body.title);
  assert.ok(identity, 'Exact cached issue metadata must identify its series title and year.');
  assert.ok(Number.isFinite(Date.parse(record.fetchedAt)), 'Cached metadata needs its actual retrieval timestamp.');
  assert.equal(issueIdFromUrl(body.detailUrl), body.id, 'Cached metadata link changed its original identity.');
  assert.equal(new URL(body.detailUrl).pathname.split('/')[3], String(body.id),
    'Cached metadata needs an exact original-issue URL segment.');
  const fields = [
    'id', 'title', 'issueNumber', 'detailUrl', 'seriesId', 'seriesName', 'digitalId',
    'onSaleDate', 'unlimitedDate', 'cover', 'pageCount', 'creators',
  ];
  return {
    id: body.id, title: identity[1], seriesId: body.seriesId, seriesYear: Number(identity[2]),
    issueNumber: String(body.issueNumber), digitalId: body.digitalId ?? null,
    providerProjection: Object.fromEntries(fields.map((field) => [field, body[field] ?? null])),
    recordedHttpReceipt: {
      url: record.url, urlSha256: record.urlSha256, status: record.status,
      fetchedAt: record.fetchedAt, bodySha256: record.bodySha256,
    },
  };
}

function validateRequest(request) {
  assert.equal(request?.schemaVersion, 1, 'Owner request schemaVersion must be 1.');
  const fields = new Set([
    'schemaVersion', 'id', 'name', 'description', 'sourceUrl', 'sourceRetrievedAt',
    'markdownFile', 'metadataCache', 'metadataIssueIds', 'selections', 'publicFiles',
    'insertionAnchor', 'characters', 'keywords', 'coverIssueId', 'sourceFacts',
  ]);
  assert.ok(Object.keys(request).every((key) => fields.has(key)), 'Owner request contains unsupported fields.');
  assert.match(request.id ?? '', /^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Owner id must be lower-kebab-case.');
  assert.match(request.sourceUrl ?? '', /^https:\/\/github\.com\/raymond-nassar\/recap-page\/issues\/[1-9]\d*(?:#issuecomment-\d+)?$/,
    'Owner source must be the exact repository intake Issue or decision comment.');
  assert.match(request.sourceRetrievedAt ?? '', /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(Number.isFinite(Date.parse(request.sourceRetrievedAt))
    && new Date(request.sourceRetrievedAt).toISOString().slice(0, 10) === request.sourceRetrievedAt,
  'The source retrieval date must be an actual calendar date.');
  assert.ok(typeof request.description === 'string' && request.description.trim());
  assert.ok(!/[\u2013\u2014]/.test(request.description), 'Shipped owner copy uses ASCII separators.');
  assert.ok(typeof request.name === 'string' && request.name.trim());
  assert.ok(Array.isArray(request.metadataIssueIds) && request.metadataIssueIds.every(positiveId),
    'Name the exact candidate metadata ids, including rejected candidates. No metadata search is implied.');
  assert.equal(new Set(request.metadataIssueIds).size, request.metadataIssueIds.length);
  assert.ok(Array.isArray(request.selections), 'Owner expansions must be an explicit array, including when empty.');
  assert.ok(Array.isArray(request.publicFiles), 'Declare any additional public provenance files, including when empty.');
  assert.ok(Array.isArray(request.characters) && request.characters.length > 0
    && request.characters.every((value) => typeof value === 'string' && value.trim()),
  'Supply factual character/discovery tags before preparing the source.');
  assert.ok(request.keywords == null || (Array.isArray(request.keywords)
    && request.keywords.every((value) => typeof value === 'string' && value.trim())),
  'Keywords must be an array of nonempty strings.');
  for (const field of ['name', 'description']) {
    assert.ok(!/[\r\n\u2013\u2014]/.test(request[field]), 'Reader-facing owner text must be a single line without typographic dashes.');
  }
}

function manifestFor(request, rows, candidates) {
  const withCover = rows.filter((row) => {
    const cover = candidates.find((candidate) => candidate.id === row.selectedIssueId)?.providerProjection.cover;
    return typeof cover?.path === 'string' && cover.path && typeof cover.extension === 'string' && cover.extension;
  });
  const coverIssueId = request.coverIssueId ?? withCover[0]?.selectedIssueId ?? null;
  assert.ok(request.coverIssueId == null || withCover.some((row) => row.selectedIssueId === request.coverIssueId),
    'The explicit representative original needs recorded cover metadata before source review.');
  const manifest = {
    id: request.id, name: request.name, description: request.description,
    type: 'screen-companion', depth: 'selected', beginner: false, timeline: null,
    sourceFile: `${request.id}.md`, out: `${request.id.replaceAll('-', '_')}.json`,
    sourcePage: request.sourceUrl, sourceOrigin: OWNER_PROVIDER.sourceOrigin, sourceLicense: null,
    group: null, groupName: null, variant: null,
    characters: request.characters ?? [], keywords: request.keywords ?? [],
    coverIssueId, expect: rows.length,
  };
  const parsed = parseManifest({ lists: [manifest] });
  assert.deepEqual(parsed.errors, [], 'Owner manifest proposal is invalid.');
  return manifest;
}

function artifactPaths(id) {
  return {
    source: `scripts/data/owner-selections/${id}.json`,
    packet: `scripts/data/owner-packets/${id}.json`,
    mapping: `scripts/data/owner-mappings/${id}.json`,
    report: `scripts/data/owner-overlaps/${id}.json`,
    contract: `test/fixtures/owner-delivery/${id}.json`,
    markdown: `src/data/orders/${id}.md`,
  };
}

function preparedFiles(artifacts, paths, extraFiles, libraryFiles) {
  const files = [
    { path: paths.source, dependencies: extraFiles.map((entry) => entry.path) },
    { path: paths.packet, dependencies: [paths.source] },
    { path: paths.mapping, dependencies: [paths.packet] },
    { path: paths.report, dependencies: [paths.mapping, ...libraryFiles] },
    ...extraFiles,
    ...libraryFiles.map((path) => ({ path, dependencies: [] })),
  ];
  const proposed = new Map(Object.entries(artifacts).map(([kind, value]) => [paths[kind], jsonText(value)]));
  return { files, proposed };
}

export async function prepareOwnerGuide(request, { root = ROOT, markdown, onPhase } = {}) {
  validateRequest(request);
  const original = markdown == null ? await readFile(request.markdownFile) : Buffer.from(markdown);
  const intake = parseOwnerMarkdown(new TextDecoder('utf-8', { fatal: true }).decode(original));
  const expansions = new Map();
  for (const selection of request.selections) {
    assert.ok(Number.isInteger(selection.inputPosition) && intake[selection.inputPosition - 1],
      'Expansion names a missing supplied selection.');
    assert.ok(!expansions.has(selection.inputPosition), 'Duplicate supplied selection expansion.');
    assert.equal(selection.inputSha256, intake[selection.inputPosition - 1].inputSha256,
      'Expansion does not bind the exact supplied Markdown selection.');
    assert.ok(typeof selection.group === 'string' && selection.group.trim());
    assert.ok(Array.isArray(selection.rows) && selection.rows.length, 'An expanded selection cannot be empty.');
    assert.ok(Array.isArray(selection.evidenceSources) && selection.evidenceSources.length,
      'Trade or compilation expansion requires dated bibliography and a scope decision.');
    assert.ok(selection.evidenceSources.every((entry) => {
      try { return new URL(entry.url).protocol === 'https:' && Number.isFinite(Date.parse(entry.retrievedAt)); }
      catch { return false; }
    }), 'Expansion evidence must name exact HTTPS sources and retrieval dates.');
    expansions.set(selection.inputPosition, selection);
  }
  const unresolvedSelections = [];
  const expanded = [];
  const selections = intake.map((input) => {
    const explicit = expansions.get(input.inputPosition);
    const rows = explicit?.rows ?? directIssues(input);
    if (!rows) unresolvedSelections.push(input.inputPosition);
    const group = explicit?.group ?? input.group;
    for (const row of rows ?? []) {
      expanded.push({
        ...row, sourcePosition: expanded.length + 1, inputPosition: input.inputPosition,
        sourceRangeReference: group,
        manualSeriesSelectionApproved: row.manualSeriesSelectionApproved ?? false,
      });
    }
    return {
      inputPosition: input.inputPosition, suppliedTitle: input.title, inputSha256: input.inputSha256,
      group, interpretation: explicit?.interpretation
        ?? (rows ? 'Explicit original issue selection' : 'Unresolved collection or compilation boundary'),
      evidenceSources: explicit?.evidenceSources ?? [], originalCount: rows?.length ?? null,
    };
  });
  const intakeReceipt = {
    name: path.basename(request.markdownFile ?? 'owner-input.md'), sha256: hash(original), bytes: original.length,
  };
  if (unresolvedSelections.length) {
    return { schemaVersion: 1, status: 'needs-resolution', intakeReceipt, intake, selections, unresolvedSelections };
  }
  const ids = [...new Set([
    ...request.metadataIssueIds,
    ...expanded.flatMap((row) => [row.candidateIssueId, row.originalIssueId]).filter(positiveId),
  ])];
  for (const row of expanded) {
    assert.ok(typeof row.sourceIssueReference === 'string' && row.sourceIssueReference.trim(),
      'Every expanded original needs its original source reference.');
    assert.ok(typeof row.normalizedSeriesTitle === 'string' && row.normalizedSeriesTitle.trim()
      && Number.isInteger(row.seriesYear) && row.issueNumber != null && String(row.issueNumber).trim(),
    'Every expanded original needs an explicit series title, year and issue number.');
    assert.equal(typeof row.manualSeriesSelectionApproved, 'boolean', 'A manual-selection flag must be explicit boolean data.');
    for (const field of ['seriesId', 'candidateIssueId', 'originalIssueId']) {
      assert.ok(row[field] == null || positiveId(row[field]), 'Explicit metadata identities must be positive integers.');
    }
    assert.ok(row.sourceRangeReference == null
      || (typeof row.sourceRangeReference === 'string' && !/[\r\n\u2013\u2014]/.test(row.sourceRangeReference)),
    'A collection group must be a single source label without typographic dashes.');
  }
  await onPhase?.('resolution');
  const cached = await loadCachedMetadata(ids, request.metadataCache);
  const candidates = [...cached.records.values()].filter((record) => record.status === 200).map(candidateFromRecord);
  const exact = [];
  const gaps = [];
  const repeats = [];
  const unresolved = [];
  const seen = new Map();
  for (const row of expanded) {
    const identity = resolveRow(row, candidates);
    if (row.gap) {
      assert.notEqual(identity.resolutionStatus, 'exact', 'An exactly resolved original cannot be silently filed as a gap.');
      const gap = {
        ...row.gap, sourcePosition: row.sourcePosition, sourceIssueReference: row.sourceIssueReference,
        sourceRangeReference: row.sourceRangeReference, sourceGroup: row.sourceRangeReference,
        normalizedSeriesTitle: row.normalizedSeriesTitle, seriesYear: row.seriesYear, issueNumber: row.issueNumber,
      };
      assert.ok(gap.evidenceSources?.some((entry) =>
        /^https:\/\/github\.com\/raymond-nassar\/recap-page\/issues\/[1-9]\d*$/.test(entry.url)
        && entry.url !== request.sourceUrl.split('#')[0]),
      'Each gap bundle must link a separate repository Issue; its assignee is checked in source review.');
      gap.evidenceDigest = gapEvidenceDigestFor(gap);
      gaps.push(gap);
      continue;
    }
    const identityConflict = [row.candidateIssueId, row.originalIssueId]
      .some((id) => id != null && identity.selectedIssueId != null && String(id) !== identity.selectedIssueId);
    if (identity.resolutionStatus !== 'exact' || identityConflict) {
      unresolved.push({ ...row, ...identity, ...(identityConflict ? {
        status: 'identity-conflict', resolutionStatus: 'identity-conflict',
        selectedIssueId: null, selectedIssueIds: [], note: 'Explicit original identity conflicts with exact metadata.',
      } : {}) });
      continue;
    }
    const candidate = candidates.find((entry) => String(entry.id) === identity.selectedIssueId);
    if (seen.has(candidate.id)) {
      repeats.push({
        sourcePosition: row.sourcePosition, canonicalRow: seen.get(candidate.id),
        sourceIssueReference: row.sourceIssueReference, sourceRangeReference: row.sourceRangeReference,
        normalizedSeriesTitle: row.normalizedSeriesTitle, seriesYear: row.seriesYear, issueNumber: row.issueNumber,
      });
      continue;
    }
    seen.set(candidate.id, exact.length + 1);
    const originalRow = Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'gap'));
    exact.push({
      ...originalRow, ...identity, selectedIssueId: candidate.id,
      candidateIssueId: candidate.id, candidateIssueIds: [String(candidate.id)], selectedIssueIds: [String(candidate.id)],
      seriesId: candidate.seriesId, resolvedIssueTitle: cleanText(candidate.providerProjection.title),
      marvelIssueUrl: candidate.providerProjection.detailUrl.replace(/^http:/, 'https:'),
      recordedHttpReceipt: candidate.recordedHttpReceipt,
    });
  }
  if (unresolved.length || !exact.length) {
    return { schemaVersion: 1, status: 'needs-resolution', intakeReceipt, intake, selections, rows: exact, gaps, repeats, unresolved };
  }
  const source = {
    schemaVersion: 1, id: request.id, sourceProvider: OWNER_PROVIDER.id,
    sourceUrl: request.sourceUrl, sourceRetrievedAt: request.sourceRetrievedAt,
    readerDescription: request.description, selections,
    sourceIssueCount: expanded.length, publishedIssueCount: exact.length,
    rows: expanded.map(({ gap: _gap, ...row }) => row), sourceGaps: gaps,
    preservedResearch: {
      publicSourceSelfContained: true, publicArtifactReadRequired: false, originalBytesChanged: false,
      artifacts: [intakeReceipt],
    },
    ...(request.sourceFacts ? { facts: request.sourceFacts } : {}),
    publicDependencies: request.publicFiles.map((entry) => entry.path),
  };
  const manifest = manifestFor(request, exact, candidates);
  const packet = {
    schemaVersion: 1, id: request.id, inventoryId: request.id,
    sourceUrl: request.sourceUrl, sourceRetrievedAt: request.sourceRetrievedAt,
    sourceProvider: OWNER_PROVIDER.id, sourceContentSha256: hash(jsonText(source)),
    sourceIssueBearingBlocksSha256: digestCanonicalJson(source.rows),
    sourceBoundary: 'Every explicitly selected original, in supplied selection and expansion order; unresolved positions remain provenance.',
    excludedSourceReferences: [], expectedCount: exact.length, proposedManifest: manifest,
    insertionAnchor: request.insertionAnchor,
    rows: exact.map(({ resolutionStatus: _status, status: _statusAlias, selectedIssueId: _selected,
      candidateIssueIds: _candidates, selectedIssueIds: _selectedIds, note: _note,
      resolvedIssueTitle: _resolved, marvelIssueUrl: _url, recordedHttpReceipt: _http, ...input }) => input),
    ...(gaps.length || repeats.length ? {
      sourceOccurrenceCount: expanded.length,
      ...(gaps.length ? { sourceGaps: gaps } : {}),
      ...(repeats.length ? { repeatedSourceReferences: repeats } : {}),
    } : {}),
  };
  validatePacketProposal(packet, { provider: OWNER_PROVIDER });
  packet.packetDigest = packetDigestFor(packet);
  const mapping = {
    id: request.id, inventoryId: request.id, packetDigest: packet.packetDigest,
    sourceUrl: packet.sourceUrl, sourceRetrievedAt: packet.sourceRetrievedAt,
    sourceProvider: packet.sourceProvider, sourceContentSha256: packet.sourceContentSha256,
    sourceRetrievalStatus: 'frozen-owner-selection', approvedSourceCount: expanded.length,
    excludedSourceReferences: [], proposedManifest: manifest, candidateMetadata: candidates,
    rows: exact, reviewStatus: 'pending',
    ...(gaps.length || repeats.length ? {
      sourceOccurrenceCount: expanded.length,
      ...(gaps.length ? { sourceGaps: gaps } : {}),
      ...(repeats.length ? { repeatedSourceReferences: repeats } : {}),
    } : {}),
  };
  mapping.mappingDigest = mappingDigestFor(mapping);
  assertMappingMatchesPacketOccurrences(packet, mapping);
  const { report, library } = await buildCurrentOwnerOverlap(mapping, { root });
  assert.ok(library.manifest.lists.some((entry) => entry.id === packet.insertionAnchor.beforeId),
    'The proposed insertion anchor is missing from the actual library.');
  assert.ok(!library.descriptors.some((entry) => entry.id === request.id));
  const paths = artifactPaths(request.id);
  const artifacts = { source, packet, mapping, report };
  const libraryFiles = [
    'src/data/curated-lists.json', 'src/data/catalog.json',
    ...library.descriptors.map((entry) => `src/data/${entry.file}`),
  ];
  const publication = requireCleanPreflight(await preflightPublication({
    root, ...preparedFiles(artifacts, paths, request.publicFiles, libraryFiles),
  }));
  const proposal = {
    schemaVersion: 1, status: 'awaiting-review', id: request.id, paths, artifacts, publication,
    libraryDigest: library.libraryDigest, sourceCounts: sourceCountsForPacket(packet),
    publicFiles: request.publicFiles, libraryFiles,
  };
  return { ...proposal, proposalDigest: digestCanonicalJson(proposal) };
}

function reviewIdentity(review, label) {
  assert.ok(review && ['human', 'stronger-model'].includes(review.authorityType), `${label} needs actual authority.`);
  for (const field of ['authorityIdentity', 'rationale', 'reviewedAt']) {
    assert.ok(typeof review[field] === 'string' && review[field].trim(), `${label} needs ${field}.`);
  }
  assert.ok(Number.isFinite(Date.parse(review.reviewedAt)), `${label} needs a valid review timestamp.`);
}

export function ownerApprovalRequest(proposal) {
  assert.equal(proposal.status, 'awaiting-review', 'Resolve the complete supplied scope before requesting authority.');
  const pending = {
    authorityType: null, authorityIdentity: null, rationale: null, reviewedAt: null,
  };
  return {
    schemaVersion: 1, proposalDigest: proposal.proposalDigest,
    sourceReview: { ...pending },
    insertionReview: { ...pending, insertionAnchor: proposal.artifacts.packet.insertionAnchor },
    relationshipReview: {
      ...pending,
      dispositions: proposal.artifacts.report.comparisons.filter((entry) => entry.relationship !== 'none')
        .map((entry) => ({ ...entry, decision: 'pending', ...pending })),
    },
  };
}

export function ownerChecklist(source, mapping) {
  const lines = [
    `# ${mapping.proposedManifest.name}`, '',
    `Source: [owner selection](${source.sourceUrl}).`,
    `${OWNER_PROVIDER.sourceOrigin}. Exact whole-original identities are retained in supplied order.`,
    'Missing originals remain explicit in the factual source and its linked gap Issues, not silently substituted.',
    'See [data provenance](../../../docs/DATA_PROVENANCE.md) for the publication boundary.', '',
  ];
  let group;
  for (const row of mapping.rows) {
    if (row.sourceRangeReference !== group) {
      const previous = group;
      group = row.sourceRangeReference;
      if (group) lines.push(`## ${escapeLinkText(group)}`, '');
      else if (previous) lines.push('# Continued order', '');
    }
    lines.push(`- [ ] [${escapeLinkText(row.resolvedIssueTitle)} <!-- mrt:source-occurrence=${row.sourcePosition} -->](${row.marvelIssueUrl})`);
  }
  return `${lines.join('\n')}\n`;
}

export async function authorizeOwnerGuide(proposal, approval, { root = ROOT } = {}) {
  const { proposalDigest, ...unsigned } = proposal;
  assert.equal(proposal.status, 'awaiting-review', 'An unresolved intake cannot be authorized.');
  assert.equal(proposalDigest, digestCanonicalJson(unsigned), 'Owner proposal is stale.');
  same(proposal.paths, artifactPaths(proposal.id), 'Owner artifact destinations must match the selected guide.');
  assert.equal(approval?.schemaVersion, 1);
  assert.equal(approval.proposalDigest, proposalDigest, 'Authority does not name this exact proposal.');
  reviewIdentity(approval.sourceReview, 'Source review');
  reviewIdentity(approval.insertionReview, 'Insertion review');
  reviewIdentity(approval.relationshipReview, 'Relationship review');
  same(approval.insertionReview.insertionAnchor, proposal.artifacts.packet.insertionAnchor,
    'Insertion authority differs from the proposal.');
  requireCleanPreflight(await preflightPublication({
    root, ...preparedFiles(proposal.artifacts, proposal.paths, proposal.publicFiles, proposal.libraryFiles),
    expected: proposal.publication,
  }));
  const { source } = proposal.artifacts;
  const packet = structuredClone(proposal.artifacts.packet);
  packet.sourceReview = { ...approval.sourceReview, proposalDigest };
  packet.packetDigest = packetDigestFor(packet);
  const mapping = {
    ...structuredClone(proposal.artifacts.mapping), packetDigest: packet.packetDigest,
    reviewStatus: 'approved', packetReview: `Actual source, insertion and relationship review of proposal ${proposalDigest}`,
    approvedManifest: structuredClone(packet.proposedManifest),
  };
  mapping.mappingDigest = mappingDigestFor(mapping);
  const { report, library } = await buildCurrentOwnerOverlap(mapping, { root });
  assert.equal(library.libraryDigest, proposal.libraryDigest, 'The complete current library changed after proposal review.');
  same(report.comparisons, proposal.artifacts.report.comparisons, 'Current relationships changed after proposal review.');
  const actual = approval.relationshipReview;
  assert.ok(Array.isArray(actual.dispositions), 'Supply every actual non-none disposition.');
  const observed = report.comparisons.filter((entry) => entry.relationship !== 'none');
  assert.equal(actual.dispositions.length, observed.length, 'Meaningful relationship authority is incomplete.');
  assert.equal(new Set(actual.dispositions.map((entry) => entry.orderId)).size, observed.length);
  const dispositions = report.comparisons.map((comparison) => {
    assert.notEqual(comparison.relationship, 'exact', 'An exact duplicate has no approval path.');
    if (comparison.relationship === 'none') return {
      ...comparison, decision: 'approved', authorityType: 'policy',
      authorityIdentity: 'Owner delivery zero-shared-issue policy',
      rationale: 'The complete current comparison has no shared original.', reviewedAt: actual.reviewedAt,
    };
    const disposition = actual.dispositions.find((entry) => entry.orderId === comparison.orderId);
    assert.ok(disposition, 'A meaningful relationship has no actual decision.');
    for (const field of ['relationship', 'sharedCount', 'sharedIds']) {
      same(disposition[field], comparison[field], 'Relationship authority changed the observed comparison.');
    }
    assert.equal(disposition.decision, 'approved');
    reviewIdentity(disposition, 'Meaningful disposition');
    assert.equal(disposition.reviewedAt, actual.reviewedAt);
    return disposition;
  });
  const relationshipReview = {
    ...actual, dispositions, reportDigest: report.reportDigest, packetDigest: packet.packetDigest,
    mappingDigest: mapping.mappingDigest, libraryDigest: library.libraryDigest, peerDigests: {},
    proposalDigest, insertionReview: approval.insertionReview,
  };
  relationshipReview.approvalDigest = approvalDigestFor(relationshipReview);
  mapping.relationshipReview = relationshipReview;
  assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: library.libraryDigest,
    expectedOrderIds: library.orders.map((entry) => entry.orderId), packetValidation: { provider: OWNER_PROVIDER },
  });
  const groups = [...new Set(mapping.rows.map((row) => row.sourceRangeReference).filter(Boolean))];
  const contract = {
    schemaVersion: 1, id: packet.id, name: packet.proposedManifest.name,
    description: packet.proposedManifest.description, sourceUrl: source.sourceUrl, groups,
    rows: mapping.rows.map((row) => [
      row.sourcePosition, row.selectedIssueId, row.resolvedIssueTitle,
      row.sourceRangeReference ? groups.indexOf(row.sourceRangeReference) : null,
    ]),
    sourceCounts: sourceCountsForPacket(packet), sourceSha256: packet.sourceContentSha256,
    proposalDigest, approvalDigest: relationshipReview.approvalDigest, insertionAnchor: packet.insertionAnchor,
    publicDependencies: Object.values(proposal.paths).filter((file) => file !== proposal.paths.contract
      && file !== proposal.paths.markdown),
  };
  contract.vectorSha256 = hash(JSON.stringify(contract.rows.map((row) => row[1])));
  const markdown = ownerChecklist(source, mapping);
  const parsed = parseChecklist(markdown);
  same(parsed.entries.map((entry) => entry.issueId), mapping.rows.map((row) => row.selectedIssueId),
    'Authored checklist changed an original identity.');
  same(parsed.entries.map((entry) => Number(entry.sourceKey)), sourcePositionsForPacket(packet),
    'Authored checklist changed source positions.');
  return { source, packet, mapping, report, contract, markdown };
}

export async function verifyOwnerMetadataCache(proposal, cacheDir) {
  const ids = proposal.artifacts.mapping.rows.map((row) => row.selectedIssueId);
  const cached = await loadCachedMetadata(ids, cacheDir);
  for (const id of ids) {
    const candidate = proposal.artifacts.mapping.candidateMetadata.find((row) => row.id === id);
    const record = cached.records.get(id);
    assert.ok(record.status === 200 && candidate, 'An approved original lost its exact metadata.');
    assert.equal(record.bodySha256, candidate.recordedHttpReceipt.bodySha256,
      'Metadata bytes changed after source review. Prepare and review a new proposal.');
  }
  return true;
}

export async function emitOwnerGuide(proposal, approval, { root = ROOT } = {}) {
  const manifestFile = path.join(root, 'src', 'data', 'curated-lists.json');
  const registryFile = path.join(root, 'scripts', 'data', 'owner-deliveries.json');
  const before = await loadCurrentOwnerLibrary(proposal.id, { root });
  const inputPaths = [
    manifestFile, registryFile, path.join(root, 'src', 'data', 'catalog.json'),
    ...before.descriptors.map((entry) => path.join(root, 'src', 'data', entry.file)),
    ...proposal.publicFiles.map((entry) => path.join(root, entry.path)),
  ];
  const inputs = await readPublicationInputs({ root, paths: inputPaths });
  const registry = readOwnerGuideRegistry(root);
  const manifest = inputs.json(manifestFile);
  assert.ok(!manifest.lists.some((entry) => entry.id === proposal.id), 'Only new owner guides use this author.');
  assert.ok(!registry.guides.some((entry) => entry.id === proposal.id), 'Owner guide is already registered.');
  const artifacts = await authorizeOwnerGuide(proposal, approval, { root });
  const outputs = Object.entries(artifacts).map(([kind, value]) => ({
    file: path.join(root, proposal.paths[kind]), content: kind === 'markdown' ? value : jsonText(value),
  }));
  for (const output of outputs) {
    try {
      await stat(output.file);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error('Owner emission would overwrite an existing source, approval or checklist.');
  }
  const nextManifest = {
    ...manifest, lists: mergePacketEntries(manifest.lists, [artifacts.packet.proposedManifest],
      { [proposal.id]: artifacts.packet.insertionAnchor }),
  };
  assert.deepEqual(parseManifest(nextManifest).errors, []);
  outputs.push({ file: manifestFile, content: jsonText(nextManifest) });
  outputs.push({
    file: registryFile,
    content: jsonText({ ...registry, guides: [...registry.guides, { id: proposal.id, contract: proposal.paths.contract }] }),
  });
  await preflightPublicationWrites({ root, inputs, outputs });
  await Promise.all([...new Set(outputs.map((entry) => path.dirname(entry.file)))]
    .map((directory) => mkdir(directory, { recursive: true })));
  await writeOutputsAtomically(outputs.map(({ file, content }) => ({ path: file, content })));
  return { status: 'authored-not-vendored', id: proposal.id, files: outputs.length, rows: artifacts.mapping.rows.length };
}
