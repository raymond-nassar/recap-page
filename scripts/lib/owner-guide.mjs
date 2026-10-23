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
  approvalDigestFor, assertGapTransition, assertMappingMatchesPacketOccurrences, assertSourceGap, canonicalJson,
  digestCanonicalJson, gapEvidenceDigestFor, mappingDigestFor, packetDigestFor,
  sourceCountsForPacket, sourceGapResolutionDigestFor, sourceIdentityKey, sourcePositionsForPacket,
  validateApprovalDigest, validateFrozenPacket, validateMappingDigest, validatePacketProposal, validateReportDigest,
} from './cbh-inventory.mjs';
import { resolveRow } from './cbh-resolution.mjs';
import { buildCurrentOwnerOverlap, loadCurrentOwnerLibrary } from './owner-current-library.mjs';
import { ownerGuideProvider, readOwnerGuideRegistry } from './owner-guide-registry.mjs';
import {
  assertCbhBaselinePayload, cbhBaselineContractRows, preserveCbhBaselinePlaceholders, updatedCbhBaselineChecklist,
} from './owner-cbh-baseline.mjs';
import { beforeMcuEditorialEntry, mcuEditorial } from './mcu-editorial.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const OWNER_PROVIDER = Object.freeze({
  id: 'owner-authored', hosts: ['github.com'], sourceOrigin: 'Selected by raymond-nassar for MCU Prep',
  requireSourceContentSha256: true, requireSourceProvider: true,
  allowMissingCover: true,
});
const THUNDERBOLTS_MISMATCH = Object.freeze({
  guideId: 'mcu-prep-thunderbolts',
  sourcePosition: 6,
  issueId: 62424,
  label: 'Thunderbolts (1997) #-1',
  url: 'https://www.marvel.com/comics/issue/62424/thunderbolts_1997_1',
  confirmationSource: 'https://github.com/raymond-nassar/recap-page/issues/687#issuecomment-6336250562',
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
  let listIndent = null;
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    if (/^\s*(```|~~~)/.test(line)) throw new Error('Fenced content requires an explicit selection before preparation.');
    const heading = /^ {0,3}(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      group = heading[1].length === 1 ? null : stripInlineMarkdown(heading[2]);
      listIndent = null;
      continue;
    }
    const item = /^([ \t]*)(?:\d+[.)]|[-*+])(?:[ \t]+|$)(.*)$/.exec(line);
    if (!item) {
      if (line.trim() && selections.length) selections.at(-1).continuation.push(line);
      continue;
    }
    if (item[1].includes('\t') || item[1].length > 3
      || (listIndent !== null && listIndent !== item[1].length)) {
      throw new Error('Nested or inconsistent indentation requires an explicit flat owner order.');
    }
    listIndent = item[1].length;
    const parsed = parseChecklist(`- ${item[2]}`);
    const entry = [...parsed.entries, ...parsed.unresolved][0];
    assert.ok(entry, `Markdown selection at line ${index + 1} is empty.`);
    const bold = /^\*\*(.+?)\*\*(?:\s|$)/.exec(item[2]);
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
    assert.ok(selection.group === null || (typeof selection.group === 'string' && selection.group.trim()),
      'An expansion needs its collection group or explicit null for individual originals.');
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
    const group = explicit ? explicit.group : input.group;
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
  const gapOccurrences = [];
  const repeats = [];
  const unresolved = [];
  const seen = new Map();
  const seenGaps = new Map();
  for (const row of expanded) {
    const identity = resolveRow(row, candidates);
    if (row.gap) {
      assert.notEqual(identity.resolutionStatus, 'exact', 'An exactly resolved original cannot be silently filed as a gap.');
      const gap = {
        ...row.gap, sourcePosition: row.sourcePosition, sourceIssueReference: row.sourceIssueReference,
        sourceRangeReference: row.sourceRangeReference,
        normalizedSeriesTitle: row.normalizedSeriesTitle, seriesYear: row.seriesYear, issueNumber: row.issueNumber,
      };
      if (row.sourceRangeReference) gap.sourceGroup = row.sourceRangeReference;
      else delete gap.sourceGroup;
      assert.ok(gap.evidenceSources?.some((entry) =>
        /^https:\/\/github\.com\/raymond-nassar\/recap-page\/issues\/[1-9]\d*$/.test(entry.url)
        && entry.url !== request.sourceUrl.split('#')[0]),
      'Each gap bundle must link a separate repository Issue; its assignee is checked in source review.');
      gap.evidenceDigest = gapEvidenceDigestFor(gap);
      assertSourceGap(gap, gapOccurrences.length);
      gapOccurrences.push(gap);
      const key = sourceIdentityKey(gap);
      const canonical = seenGaps.get(key);
      if (canonical) {
        assert.ok(gap.kind === canonical.kind && gap.status === canonical.status,
          'Repeated originals cannot have conflicting gap dispositions.');
        repeats.push({
          sourcePosition: gap.sourcePosition, canonicalGapPosition: canonical.sourcePosition,
          sourceIssueReference: gap.sourceIssueReference, sourceRangeReference: gap.sourceRangeReference,
          normalizedSeriesTitle: canonical.normalizedSeriesTitle,
          seriesYear: canonical.seriesYear, issueNumber: canonical.issueNumber,
        });
      } else {
        seenGaps.set(key, gap);
        gaps.push(gap);
      }
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
    return { schemaVersion: 1, status: 'needs-resolution', intakeReceipt, intake, selections,
      rows: exact, gaps, gapOccurrences, repeats, unresolved };
  }
  const source = {
    schemaVersion: 1, id: request.id, sourceProvider: OWNER_PROVIDER.id,
    sourceUrl: request.sourceUrl, sourceRetrievedAt: request.sourceRetrievedAt,
    readerDescription: request.description, selections,
    sourceIssueCount: expanded.length, publishedIssueCount: exact.length,
    rows: expanded.map(({ gap: _gap, ...row }) => row), sourceGaps: gaps,
    ...(gapOccurrences.length > gaps.length ? { sourceGapOccurrences: gapOccurrences } : {}),
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
  const confirmedCount = mapping.rows
    .filter((row) => row.identityEvidenceKind === 'owner-confirmed-identity').length;
  const openGapCount = mapping.sourceGaps?.length ?? 0;
  const sourceCredit = source.sourceCredit ?? OWNER_PROVIDER.sourceOrigin;
  const lines = [
    `# ${mapping.proposedManifest.name}`, '',
    `Source: [owner selection](${source.sourceUrl}).`,
    `${sourceCredit}. Exact whole-original identities are retained in supplied order.`,
    ...(confirmedCount ? [
      `${confirmedCount} owner-confirmed identities have no provider details or cover.`,
    ] : []),
    ...(openGapCount ? [
      `${openGapCount} unresolved originals remain explicit in the factual source and linked gap Issues.`,
    ] : []),
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
    const evidence = row.identityEvidenceKind === 'owner-confirmed-identity'
      ? ' <!-- mrt:identity-evidence=owner-confirmed-identity -->' : '';
    const annotation = source.rows.find((entry) => entry.sourcePosition === row.sourcePosition)?.annotation;
    const title = `${row.resolvedIssueTitle}${annotation ? ` (${annotation})` : ''}`;
    lines.push(`- [ ] [${escapeLinkText(title)} <!-- mrt:source-occurrence=${row.sourcePosition} -->${evidence}](${row.marvelIssueUrl})`);
  }
  return `${lines.join('\n')}\n`;
}

export function ownerGuideDisplayGroups(markdown, mapping) {
  const currentChecklist = parseChecklist(markdown);
  const displayGroupBySourceRange = new Map();
  for (const row of mapping.rows) {
    if (!row.sourceRangeReference) continue;
    const entry = currentChecklist.entries.find((candidate) => Number(candidate.sourceKey) === row.sourcePosition);
    assert.ok(entry?.section, `Existing source position ${row.sourcePosition} needs a display group.`);
    const previousLabel = displayGroupBySourceRange.get(row.sourceRangeReference);
    assert.ok(previousLabel === undefined || previousLabel === entry.section,
      `Source range ${row.sourceRangeReference} cannot resolve to multiple display groups.`);
    displayGroupBySourceRange.set(row.sourceRangeReference, entry.section);
  }
  return displayGroupBySourceRange;
}

export function updatedOwnerChecklist(existingMarkdown, source, previousMapping, mapping) {
  let lines = existingMarkdown.replace(/\r\n/g, '\n').split('\n');
  const displayGroupBySourceRange = ownerGuideDisplayGroups(existingMarkdown, previousMapping);
  const confirmedCount = mapping.rows
    .filter((row) => row.identityEvidenceKind === 'owner-confirmed-identity').length;
  const openGapCount = mapping.sourceGaps?.length ?? 0;
  const obsoleteNotice = /(?:supplied positions lack exact provider metadata|supplied identities in this section remain metadata gaps|missing originals remain explicit in the factual source and its linked gap issues|owner-confirmed identities have no provider details or cover|unresolved originals remain explicit in the factual source)/i;
  lines = lines.filter((line) => !obsoleteNotice.test(line));

  const notices = [
    ...(confirmedCount ? [
      `${confirmedCount} owner-confirmed ${confirmedCount === 1 ? 'identity has' : 'identities have'} no provider details or cover.`,
    ] : []),
    ...(openGapCount ? [
      `${openGapCount} unresolved source positions remain explicit in the factual source${source.gapIssueUrl
        ? ` and the [assigned gap issue](${source.gapIssueUrl})` : ''}.`,
    ] : []),
  ];
  if (notices.length) {
    const creditIndex = lines.findIndex((line) => line.startsWith('Selected by '));
    const sourceIndex = lines.findIndex((line) => line.startsWith('Source: '));
    const insertionIndex = creditIndex >= 0 ? creditIndex + 1 : Math.max(sourceIndex + 1, 1);
    lines.splice(insertionIndex, 0, ...notices);
  }

  const currentPositionLines = new Map();
  for (let index = 0; index < lines.length; index++) {
    const match = /<!--\s*mrt:source-occurrence=([1-9]\d*)\s*-->/.exec(lines[index]);
    if (match) currentPositionLines.set(Number(match[1]), index);
  }
  const sourceRows = new Map(source.rows.map((row) => [row.sourcePosition, row]));
  const newRows = mapping.rows.filter((row) => (
    row.identityEvidenceKind === 'owner-confirmed-identity'
      && !currentPositionLines.has(row.sourcePosition)
  ));
  const staleCopyCorrections = {
    'mcu-prep-spider-man-brand-new-day': [
      [
        'This checklist publishes nineteen exactly resolved originals in owner order. It does not replace the broader Spider-Man guides or claim these comics are a direct film adaptation.',
        `This checklist publishes ${mapping.rows.length} exactly resolved originals in owner order. It does not replace the broader Spider-Man guides or claim these comics are a direct film adaptation.`,
      ],
      [
        'Source position 14, selection 2, within-book position 8: **Venom Super Special (1995) #1**, source-identified original **59715**, remains a metadata gap under [Issue #707](https://github.com/raymond-nassar/recap-page/issues/707).',
        'Source position 14, selection 2, within-book position 8: **Venom Super Special (1995) #1**, source-identified original **59715**, is now included by owner-confirmed identity under [Issue #707](https://github.com/raymond-nassar/recap-page/issues/707).',
      ],
      [
        'It is intentionally not a checkbox, placeholder or neighboring special. Its identity and failed lookups remain in the nonempty source-gap ledger. This is not a claim about Marvel Unlimited availability.',
        'Provider details and Marvel Unlimited availability remain unverified; the confirmed identity does not resolve either question.',
      ],
    ],
    'mcu-prep-thunderbolts': [
      [
        'Thunderbolts (1997) #-1, source position 6, remains unresolved under [the assigned provider-gap issue](https://github.com/raymond-nassar/recap-page/issues/687).',
        'Thunderbolts (1997) #-1, source position 6, is now included by owner-confirmed identity under [the assigned provider-gap issue](https://github.com/raymond-nassar/recap-page/issues/687). Its provider record identifies #1, not #-1, so no provider metadata or availability is inferred.',
      ],
      [
        'The import publishes the other 34 originals without replacing that comic, adding a collection ID or making a placeholder identity.',
        `The checklist publishes all ${mapping.rows.length} resolved originals without adding a collection ID or placeholder identity.`,
      ],
    ],
  }[mapping.id];
  if (newRows.length && staleCopyCorrections) {
    for (const [before, after] of staleCopyCorrections) {
      const index = lines.indexOf(before);
      assert.ok(index >= 0, `Expected the stale ${mapping.id} checklist statement to be present.`);
      lines[index] = after;
    }
  }
  const groups = new Map();
  for (const row of newRows) {
    const key = row.sourceRangeReference ?? null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const insertions = [];
  const chunks = [...groups].flatMap(([group, rows]) => {
    const existingPositions = previousMapping.rows
      .filter((row) => row.sourceRangeReference === group)
      .map((row) => row.sourcePosition);
    const parts = [];
    for (const row of rows) {
      const last = parts.at(-1);
      if (!last || existingPositions.some((position) => (
        position > last.at(-1).sourcePosition && position < row.sourcePosition
      ))) parts.push([row]);
      else last.push(row);
    }
    return parts.map((part) => [group, part]);
  });
  for (const [group, rows] of chunks) {
    rows.sort((left, right) => left.sourcePosition - right.sourcePosition);
    const first = rows[0].sourcePosition;
    const last = rows.at(-1).sourcePosition;
    const displayGroup = group ? displayGroupBySourceRange.get(group) ?? group : null;
    const heading = displayGroup ? `## ${escapeLinkText(displayGroup)}` : null;
    const headingIndex = heading ? lines.indexOf(heading) : -1;
    const oldRows = previousMapping.rows
      .filter((row) => row.sourceRangeReference === group && currentPositionLines.has(row.sourcePosition));
    const upper = oldRows
      .filter((row) => row.sourcePosition > last)
      .sort((left, right) => left.sourcePosition - right.sourcePosition)[0];
    const lower = oldRows
      .filter((row) => row.sourcePosition < first)
      .sort((left, right) => right.sourcePosition - left.sourcePosition)[0];
    let index;
    let addHeading = false;
    if (upper) index = currentPositionLines.get(upper.sourcePosition);
    else if (lower) index = currentPositionLines.get(lower.sourcePosition) + 1;
    else if (headingIndex >= 0) {
      index = headingIndex + 1;
      if (lines[index] === '') index++;
    } else {
      const next = previousMapping.rows
        .filter((row) => row.sourcePosition > last && currentPositionLines.has(row.sourcePosition))
        .sort((left, right) => left.sourcePosition - right.sourcePosition)[0];
      if (next) {
        index = currentPositionLines.get(next.sourcePosition);
        while (index > 0 && !/^## /.test(lines[index - 1])) index--;
        if (index > 0) index--;
      } else {
        index = lines.length;
        while (index > 0 && lines[index - 1] === '') index--;
      }
      addHeading = Boolean(heading);
    }
    const renderedRows = rows.map((row) => {
      const annotation = sourceRows.get(row.sourcePosition)?.annotation;
      const title = `${row.resolvedIssueTitle}${annotation ? ` (${annotation})` : ''}`;
      return `- [ ] [${escapeLinkText(title)} <!-- mrt:source-occurrence=${row.sourcePosition} --> <!-- mrt:identity-evidence=owner-confirmed-identity -->](${row.marvelIssueUrl})`;
    });
    insertions.push({
      index,
      start: first,
      lines: [...(addHeading ? [heading, ''] : []), ...renderedRows, ...(addHeading ? [''] : [])],
    });
  }
  const byIndex = new Map();
  for (const insertion of insertions) {
    if (!byIndex.has(insertion.index)) byIndex.set(insertion.index, []);
    byIndex.get(insertion.index).push(insertion);
  }
  for (const [index, blocks] of [...byIndex.entries()].sort(([left], [right]) => right - left)) {
    const block = blocks.sort((left, right) => left.start - right.start).flatMap((entry) => entry.lines);
    lines.splice(index, 0, ...block);
  }
  while (lines.at(-1) === '') lines.pop();
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
    const row = proposal.artifacts.mapping.rows.find((entry) => entry.selectedIssueId === id);
    const candidate = proposal.artifacts.mapping.candidateMetadata.find((entry) => entry.id === id);
    const record = cached.records.get(id);
    if (row?.identityEvidenceKind === 'owner-confirmed-identity') {
      assert.ok(record.status === 404 && !candidate,
        'An owner-confirmed identity must remain separate from unavailable provider metadata.');
      continue;
    }
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

function validDate(value, label) {
  assert.match(value ?? '', /^\d{4}-\d{2}-\d{2}$/, `${label} must be a YYYY-MM-DD date.`);
  assert.ok(Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value,
  `${label} must be a calendar date.`);
}

function ownerIdentityParts(identity) {
  const match = /^(.*?)\s+\((\d{4})\)(?:\s+#(-1|\d+(?:\.\d+)?))?$/.exec(identity.label ?? '');
  assert.ok(match, 'An owner-confirmed label must state the exact series, year, and optional issue number.');
  assert.ok(typeof identity.confirmingActor === 'string' && identity.confirmingActor.trim(),
    'Owner confirmation needs a named actor.');
  validDate(identity.confirmedAt, 'Owner confirmation date');
  validDate(identity.confirmationRetrievedAt, 'Owner confirmation source date');
  if (identity.providerStatus === 404) {
    validDate(identity.provider404At, 'Provider 404 date');
    assert.equal(Object.hasOwn(identity, 'providerMismatchAt'), false);
  } else {
    assert.equal(identity.providerStatus, 200, 'Owner identity needs an exact recorded provider result.');
    assert.equal(Object.hasOwn(identity, 'provider404At'), false);
    validDate(identity.providerMismatchAt, 'Provider mismatch date');
  }
  assert.ok(Number.isSafeInteger(identity.issueId) && identity.issueId > 0);
  assert.equal(issueIdFromUrl(identity.url), identity.issueId,
    'The owner-supplied Marvel URL must identify the confirmed positive issue id.');
  assert.match(identity.url ?? '', /^https:\/\/www\.marvel\.com\/comics\/issue\//,
    'The identity URL must be the exact user-supplied HTTPS Marvel issue page.');
  assert.match(identity.confirmationSource ?? '',
    /^https:\/\/github\.com\/raymond-nassar\/recap-page\/issues\/[1-9]\d*#issuecomment-[1-9]\d+$/,
    'Owner confirmation must link to a repository issue comment.');
  return {
    normalizedSeriesTitle: normalizeTitle(match[1]),
    seriesYear: Number(match[2]),
    issueNumber: match[3] ?? null,
  };
}

function validateIdentityUpdateRequest(request) {
  assert.equal(request?.schemaVersion, 1, 'Identity update schemaVersion must be 1.');
  assert.ok(Object.keys(request).every((key) => (
    ['schemaVersion', 'id', 'generatedAt', 'identities', 'description'].includes(key)
  )), 'Identity update request contains unsupported fields.');
  if (Object.hasOwn(request, 'description')) {
    assert.ok(typeof request.description === 'string' && request.description.trim()
      && !/[\r\n\u2013\u2014]/.test(request.description),
    'The reviewed description must be a nonempty single line with ASCII separators.');
  }
  assert.match(request.id ?? '', /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
  assert.ok(Number.isFinite(Date.parse(request.generatedAt ?? ''))
    && new Date(request.generatedAt).toISOString() === request.generatedAt,
  'Identity update generatedAt must be a canonical ISO timestamp.');
  assert.ok(Array.isArray(request.identities) && request.identities.length > 0,
    'Identity update needs at least one owner-confirmed identity.');
  const allowedIdentityFields = new Set([
    'sourcePosition', 'issueId', 'label', 'url', 'confirmingActor', 'confirmedAt',
    'confirmationSource', 'confirmationRetrievedAt', 'providerStatus', 'provider404At', 'providerMismatchAt',
  ]);
  let previousPosition = 0;
  const ids = new Set();
  for (const identity of request.identities) {
    assert.ok(identity && typeof identity === 'object' && !Array.isArray(identity));
    assert.ok(Object.keys(identity).every((key) => allowedIdentityFields.has(key)),
      'Owner-confirmed identity contains unsupported fields.');
    assert.ok(Number.isInteger(identity.sourcePosition) && identity.sourcePosition > previousPosition,
      'Owner-confirmed identities must be in unique source-position order.');
    previousPosition = identity.sourcePosition;
    assert.ok(!ids.has(identity.issueId), 'Owner-confirmed identities cannot reuse an issue id.');
    ids.add(identity.issueId);
    if (request.id === THUNDERBOLTS_MISMATCH.guideId
      && identity.sourcePosition === THUNDERBOLTS_MISMATCH.sourcePosition) {
      assert.equal(identity.providerStatus, 200,
        'The confirmed Thunderbolts #-1 source position requires its recorded HTTP 200 mismatch evidence.');
    }
    if (identity.providerStatus === 200) {
      assert.equal(request.id, THUNDERBOLTS_MISMATCH.guideId,
        'Only the confirmed Thunderbolts #-1 source record permits an HTTP 200 identity mismatch.');
      for (const [field, value] of Object.entries({
        sourcePosition: THUNDERBOLTS_MISMATCH.sourcePosition,
        issueId: THUNDERBOLTS_MISMATCH.issueId,
        label: THUNDERBOLTS_MISMATCH.label,
        url: THUNDERBOLTS_MISMATCH.url,
        confirmationSource: THUNDERBOLTS_MISMATCH.confirmationSource,
      })) {
        assert.equal(identity[field], value, `Thunderbolts provider mismatch ${field} changed.`);
      }
    }
    ownerIdentityParts(identity);
  }
}

export function assertThunderboltsMismatchSource(sourceLedger) {
  assert.equal(sourceLedger.id, THUNDERBOLTS_MISMATCH.guideId);
  assert.equal(sourceLedger.sourceOccurrenceCount, 35);
  assert.equal(sourceLedger.publishedIssueCount, 34);
  assert.equal(sourceLedger.gapCount, 1);
  assert.deepEqual(sourceLedger.rows.map((row) => row.sourcePosition),
    Array.from({ length: 35 }, (_, index) => index + 1));
  const sourceRow = sourceLedger.rows.find((row) => row.sourcePosition === THUNDERBOLTS_MISMATCH.sourcePosition);
  assert.deepEqual(sourceRow, {
    sourcePosition: 6, selection: 1, reference: THUNDERBOLTS_MISMATCH.label,
    seriesId: 2296, issueId: null, status: 'provider-gap',
  });
  const gap = sourceLedger.gaps.find((entry) => entry.sourcePosition === THUNDERBOLTS_MISMATCH.sourcePosition);
  assert.equal(sourceLedger.gaps.length, 1);
  assert.equal(gap.issueUrl, 'https://github.com/raymond-nassar/recap-page/issues/687');
  assert.equal(gap.relatedGuideGapUrl, 'https://github.com/raymond-nassar/recap-page/issues/558');
  assert.equal(gap.checkedAt, '2026-10-03');
  assert.equal(gap.reference, THUNDERBOLTS_MISMATCH.label);
  assert.deepEqual(gap.failedLookups, [
    {
      url: 'https://marvel.emreparker.com/v1/series/2296/issues?limit=200&offset=0',
      returnedRecords: 83,
      result: 'No issueNumber -1 or exact #-1 title.',
    },
    {
      url: 'https://marvel.emreparker.com/v1/search/issues?q=Thunderbolts%201997%20-1&limit=100',
      returnedRecords: 84,
      result: 'No issueNumber -1 or exact #-1 title.',
    },
  ]);
  assert.deepEqual(gap.rejectedRelabelings.find((entry) => entry.issueId === 62424), {
    issueId: 62424,
    url: 'https://marvel.emreparker.com/v1/issues/62424',
    title: 'Thunderbolts (1997) #1',
    issueNumber: '1',
    onSaleDate: '1997-07-01T00:00:00+0000',
    digitalId: 43367,
  });
  assert.deepEqual(gap.rejectedRelabelings.find((entry) => entry.issueId === 15311), {
    issueId: 15311,
    url: 'https://marvel.emreparker.com/v1/issues/15311',
    title: 'Thunderbolts (1997) #1',
    issueNumber: '1',
    onSaleDate: '1997-04-01T00:00:00+0000',
    digitalId: 3162,
  });
}

function outputBody(file, value) {
  return { file, content: typeof value === 'string' ? value : jsonText(value) };
}

export function assertRelationshipReportExtension(previous, current, laterGuides = []) {
  for (const field of [
    'candidateId', 'packetDigest', 'mappingDigest', 'peerDigests', 'sourceCounts', 'candidateCount',
  ]) {
    assert.equal(canonicalJson(current[field]), canonicalJson(previous[field]),
      `Current relationship report changed its approved ${field}.`);
  }
  const currentById = new Map(current.comparisons.map((entry) => [entry.orderId, entry]));
  for (const comparison of previous.comparisons) {
    if (!currentById.has(comparison.orderId)
      && comparison.orderId === mcuEditorial.withdrawal.manifestEntry.id
      && comparison.relationship === 'none' && comparison.sharedCount === 0
      && comparison.sharedIds.length === 0) continue;
    assert.equal(canonicalJson(currentById.get(comparison.orderId)), canonicalJson(comparison),
      `Current relationship report changed approved overlap with ${comparison.orderId}.`);
  }
  const previousIds = new Set(previous.comparisons.map((entry) => entry.orderId));
  const additions = current.comparisons.filter((entry) => !previousIds.has(entry.orderId));
  for (const entry of additions) {
    if (entry.relationship === 'none' && entry.sharedCount === 0 && entry.sharedIds.length === 0) continue;
    const later = laterGuides.find(({ registeredId, contract }) => (
      registeredId === entry.orderId && contract?.id === entry.orderId
    ));
    assert.ok(later, `New library entries with shared issues require a registered reciprocal review: ${entry.orderId}`);
    const { contract, mapping, report } = later;
    validateMappingDigest(mapping);
    validateReportDigest(report);
    validateApprovalDigest(mapping.relationshipReview, contract.id);
    assert.equal(mapping.id, contract.id);
    assert.equal(report.candidateId, contract.id);
    assert.equal(mapping.reviewStatus, 'approved');
    const review = mapping.relationshipReview;
    assert.equal(review.proposalDigest, contract.proposalDigest);
    assert.equal(review.approvalDigest, contract.approvalDigest);
    assert.equal(review.reportDigest, report.reportDigest);
    assert.equal(review.mappingDigest, mapping.mappingDigest);
    assert.equal(report.mappingDigest, mapping.mappingDigest);
    const reciprocal = report.comparisons.find(({ orderId }) => orderId === current.candidateId);
    const authority = review.dispositions.find(({ orderId }) => orderId === current.candidateId);
    assert.ok(reciprocal && authority, 'Later owner authority must include this earlier guide.');
    assert.equal(authority.decision, 'approved');
    assert.ok(['human', 'stronger-model'].includes(authority.authorityType));
    const inverse = {
      partial: 'partial', 'candidate-subset': 'existing-subset', 'existing-subset': 'candidate-subset',
    };
    assert.equal(entry.relationship, inverse[reciprocal.relationship]);
    for (const value of [reciprocal, authority]) {
      assert.equal(value.sharedCount, entry.sharedCount);
      assert.deepEqual([...value.sharedIds].sort(), [...entry.sharedIds].sort());
      assert.equal(value.relationship, reciprocal.relationship);
    }
  }
}

async function buildOwnerGuideIdentityUpdate(request, { root = ROOT } = {}) {
  validateIdentityUpdateRequest(request);
  const paths = artifactPaths(request.id);
  const manifestFile = path.join(root, 'src', 'data', 'curated-lists.json');
  const catalogFile = path.join(root, 'src', 'data', 'catalog.json');
  const registryFile = path.join(root, 'scripts', 'data', 'owner-deliveries.json');
  const registry = readOwnerGuideRegistry(root);
  const registration = registry.guides.find((entry) => entry.id === request.id);
  assert.ok(registration, 'Only a registered owner guide can receive identity updates.');
  assert.equal(registration.contract, paths.contract, 'The registered contract path differs from the guide identity.');
  const provider = ownerGuideProvider(registration, OWNER_PROVIDER);
  const cbhBaseline = registration.sourceProvider === 'comic-book-herald';
  const currentLibrary = await loadCurrentOwnerLibrary(request.id, { root });
  const currentMappingFile = path.join(root, paths.mapping);
  const currentMappingForPaths = JSON.parse(await readFile(currentMappingFile, 'utf8'));
  const peerMappingFiles = Object.keys(currentMappingForPaths.relationshipReview?.peerDigests ?? {})
    .map((id) => path.join(root, 'scripts', 'data', 'owner-mappings', `${id}.json`));
  const previousReportForPaths = JSON.parse(await readFile(path.join(root, paths.report), 'utf8'));
  const previousOrderIds = new Set(previousReportForPaths.comparisons.map(({ orderId }) => orderId));
  const laterGuidePaths = registry.guides
    .filter(({ id }) => id !== request.id && !previousOrderIds.has(id))
    .map(({ id, contract }) => ({
      id,
      contract: path.join(root, contract),
      mapping: path.join(root, 'scripts', 'data', 'owner-mappings', `${id}.json`),
      report: path.join(root, 'scripts', 'data', 'owner-overlaps', `${id}.json`),
    }));
  const targetPaths = Object.values(paths).map((name) => path.join(root, name));
  const payloadFile = path.join(root, 'src', 'data', `${request.id.replaceAll('-', '_')}.json`);
  const thunderboltsSourcePath = path.join(root, 'scripts', 'data', 'mcu-prep-thunderbolts-source.json');
  const inputPaths = [
    manifestFile, catalogFile, registryFile, payloadFile, ...targetPaths, ...peerMappingFiles,
    ...(request.id === THUNDERBOLTS_MISMATCH.guideId ? [thunderboltsSourcePath] : []),
    ...laterGuidePaths.flatMap(({ contract, mapping, report }) => [contract, mapping, report]),
    ...currentLibrary.descriptors.map((entry) => path.join(root, 'src', 'data', entry.file)),
  ];
  const inputs = await readPublicationInputs({ root, paths: inputPaths });
  const source = inputs.json(path.join(root, paths.source));
  const packet = inputs.json(path.join(root, paths.packet));
  const mapping = inputs.json(path.join(root, paths.mapping));
  const peerMappings = peerMappingFiles.map((file) => inputs.json(file));
  assert.deepEqual(
    peerMappings.map((peer) => peer.id).sort(),
    Object.keys(mapping.relationshipReview?.peerDigests ?? {}).sort(),
    'The approved peer mapping set changed while preparing the identity update.',
  );
  const previousReport = inputs.json(path.join(root, paths.report));
  const contract = inputs.json(path.join(root, paths.contract));
  const manifest = inputs.json(manifestFile);
  const catalog = inputs.json(catalogFile);
  const payload = inputs.json(payloadFile);
  const thunderboltsSource = request.id === THUNDERBOLTS_MISMATCH.guideId
    ? inputs.json(thunderboltsSourcePath) : null;
  assert.equal(source.id, request.id);
  assert.equal(packet.id, request.id);
  assert.equal(mapping.id, request.id);
  assert.equal(contract.id, request.id);
  assert.equal(mapping.reviewStatus, 'approved');
  validateFrozenPacket(packet, { expectedId: request.id, provider });
  validateMappingDigest(mapping);
  validateReportDigest(previousReport);
  assert.equal(mapping.packetDigest, packet.packetDigest);
  assert.equal(canonicalJson(mapping.proposedManifest), canonicalJson(packet.proposedManifest));
  const currentManifestEntry = manifest.lists.find((entry) => entry.id === request.id);
  const approvedManifestEntry = canonicalJson(currentManifestEntry) === canonicalJson(packet.proposedManifest)
    ? currentManifestEntry : beforeMcuEditorialEntry(currentManifestEntry);
  assert.equal(canonicalJson(approvedManifestEntry),
    canonicalJson(packet.proposedManifest), 'The registered manifest differs from its approved packet.');
  assert.equal(contract.proposalDigest, mapping.relationshipReview.proposalDigest);
  assert.equal(contract.approvalDigest, mapping.relationshipReview.approvalDigest);
  assertMappingMatchesPacketOccurrences(packet, mapping);
  if (cbhBaseline) {
    assertCbhBaselinePayload(contract, mapping, payload, inputs.contents.get(paths.markdown).toString('utf8'));
  } else {
    assert.equal(canonicalJson(payload.items.map((item) => item.issueId)),
      canonicalJson(mapping.rows.map((row) => row.selectedIssueId)),
      'The current payload differs from its approved mapping.');
  }
  if (request.identities.some((identity) => identity.providerStatus === 200)) {
    assertThunderboltsMismatchSource(thunderboltsSource);
  }
  const parsedCurrent = parseChecklist(inputs.contents.get(paths.markdown).toString('utf8'));
  assert.deepEqual(parsedCurrent.entries.map((entry) => entry.issueId), mapping.rows.map((row) => row.selectedIssueId));
  assert.deepEqual(parsedCurrent.entries.map((entry) => Number(entry.sourceKey)), mapping.rows.map((row) => row.sourcePosition));

  const { report: verifiedReport } = await buildCurrentOwnerOverlap(mapping, { root, peerMappings });
  assertApprovedRelationshipReview({
    packet, mapping, report: previousReport, currentLibraryDigest: previousReport.libraryDigest,
    peerMappings,
    expectedOrderIds: previousReport.comparisons.map((entry) => entry.orderId),
    packetValidation: { provider },
  });
  assertRelationshipReportExtension(previousReport, verifiedReport, laterGuidePaths.map((entry) => ({
    registeredId: entry.id,
    contract: inputs.json(entry.contract), mapping: inputs.json(entry.mapping), report: inputs.json(entry.report),
  })));

  const gapByPosition = new Map((packet.sourceGaps ?? []).map((gap) => [gap.sourcePosition, gap]));
  const existingIds = new Set(mapping.rows.map((row) => Number(row.selectedIssueId)));
  const identityRows = request.identities.map((identity) => {
    const gap = gapByPosition.get(identity.sourcePosition);
    assert.ok(gap && gap.kind === 'published-metadata-gap' && gap.status === 'open',
      `Source position ${identity.sourcePosition} is not an open published-metadata gap.`);
    assert.ok(!mapping.rows.some((row) => row.sourcePosition === identity.sourcePosition),
      `Source position ${identity.sourcePosition} is already published.`);
    assert.ok(!existingIds.has(identity.issueId), `Issue ${identity.issueId} is already in this guide.`);
    const parts = ownerIdentityParts(identity);
    if (gap.issueNumber != null) {
      assert.equal(parts.issueNumber, String(gap.issueNumber),
        `Confirmed issue number differs from source position ${identity.sourcePosition}.`);
    }
    const identityEvidence = {
      kind: 'owner-confirmed-identity',
      confirmingActor: identity.confirmingActor,
      confirmedAt: identity.confirmedAt,
      issueId: identity.issueId,
      label: identity.label,
      url: identity.url,
      confirmationSource: identity.confirmationSource,
    };
    const providerUrl = `https://marvel.emreparker.com/v1/issues/${identity.issueId}`;
    const providerEvidence = identity.providerStatus === 200
      ? { kind: 'metadata-provider-200-mismatch', url: providerUrl, retrievedAt: identity.providerMismatchAt }
      : { kind: 'metadata-provider-404', url: providerUrl, retrievedAt: identity.provider404At };
    const evidenceSources = [
      ...(gap.evidenceSources ?? []),
      providerEvidence,
      { kind: 'owner-confirmation', url: identity.confirmationSource, retrievedAt: identity.confirmationRetrievedAt },
    ].filter((entry, index, all) => all.findIndex((other) => (
      other.kind === entry.kind && other.url === entry.url && other.retrievedAt === entry.retrievedAt
    )) === index).sort((left, right) => (
      `${left.kind}\u0000${left.url}\u0000${left.retrievedAt}`.localeCompare(
        `${right.kind}\u0000${right.url}\u0000${right.retrievedAt}`,
      )
    ));
    const resolution = {
      sourcePosition: gap.sourcePosition,
      previousSourceIssueReference: gap.sourceIssueReference,
      previousSourceRangeReference: gap.sourceRangeReference ?? null,
      previousNormalizedSeriesTitle: gap.normalizedSeriesTitle,
      previousSeriesYear: gap.seriesYear,
      previousIssueNumber: String(gap.issueNumber),
      resolutionKind: 'owner-confirmed-identity',
      selectedIssueId: identity.issueId,
      resolvedNormalizedSeriesTitle: parts.normalizedSeriesTitle,
      resolvedSeriesYear: parts.seriesYear,
      resolvedIssueNumber: parts.issueNumber,
      checkedAt: identity.providerStatus === 200 ? identity.providerMismatchAt : identity.provider404At,
      auditBasis: identity.providerStatus === 200
        ? `Owner-confirmed identity for ${identity.label}, recorded by ${identity.confirmingActor} on ${identity.confirmedAt}. The stored provider record for ID 62424 returned HTTP 200 for Thunderbolts (1997) #1, issue number 1, digitalId 43367; it is not #-1 and supplies no metadata or reading availability for the confirmed identity.`
        : `Owner-confirmed identity for ${identity.label}, recorded by ${identity.confirmingActor} on ${identity.confirmedAt}. The configured metadata provider returned HTTP 404 on ${identity.provider404At}; no provider metadata or reading availability is inferred.`,
      evidenceSources,
      identityEvidence,
    };
    resolution.evidenceDigest = sourceGapResolutionDigestFor(resolution);
    const packetRow = {
      sourcePosition: gap.sourcePosition,
      sourceIssueReference: gap.sourceIssueReference,
      sourceRangeReference: gap.sourceRangeReference ?? null,
      normalizedSeriesTitle: parts.normalizedSeriesTitle,
      seriesYear: parts.seriesYear,
      issueNumber: parts.issueNumber,
      candidateIssueId: null,
      seriesId: null,
      manualSeriesSelectionApproved: false,
      ...(Object.hasOwn(gap, 'sourceGroup') ? { sourceGroup: gap.sourceGroup } : {}),
    };
    const mappingRow = {
      ...packetRow,
      status: 'exact',
      resolutionStatus: 'exact',
      selectedIssueId: identity.issueId,
      candidateIssueIds: [],
      selectedIssueIds: [String(identity.issueId)],
      resolvedIssueTitle: identity.label,
      marvelIssueUrl: identity.url,
      identityEvidenceKind: 'owner-confirmed-identity',
    };
    return { resolution, packetRow, mappingRow, identity };
  });

  const resolvedPositions = new Set(identityRows.map((entry) => entry.resolution.sourcePosition));
  const nextPacket = structuredClone(packet);
  nextPacket.rows = [...packet.rows, ...identityRows.map((entry) => entry.packetRow)]
    .sort((left, right) => left.sourcePosition - right.sourcePosition);
  const repeatedSourceReferences = (packet.repeatedSourceReferences ?? []).map((reference) => {
    if (!Object.hasOwn(reference, 'canonicalRow')) return reference;
    const canonicalSourcePosition = packet.rows[reference.canonicalRow - 1].sourcePosition;
    const canonicalRow = nextPacket.rows.findIndex((row) => row.sourcePosition === canonicalSourcePosition) + 1;
    assert.ok(canonicalRow > 0, 'Identity update lost a repeated reference canonical row.');
    return { ...reference, canonicalRow };
  });
  if (repeatedSourceReferences.length) nextPacket.repeatedSourceReferences = repeatedSourceReferences;
  else delete nextPacket.repeatedSourceReferences;
  const remainingGaps = (packet.sourceGaps ?? []).filter((gap) => !resolvedPositions.has(gap.sourcePosition));
  if (remainingGaps.length) nextPacket.sourceGaps = remainingGaps;
  else delete nextPacket.sourceGaps;
  nextPacket.sourceGapResolutions = [
    ...(packet.sourceGapResolutions ?? []),
    ...identityRows.map((entry) => entry.resolution),
  ].sort((left, right) => left.sourcePosition - right.sourcePosition);
  nextPacket.expectedCount = nextPacket.rows.length;
  nextPacket.proposedManifest = {
    ...nextPacket.proposedManifest,
    expect: nextPacket.rows.length + (cbhBaseline ? remainingGaps.length : 0),
    ...(Object.hasOwn(request, 'description') ? { description: request.description } : {}),
  };
  nextPacket.packetDigest = packetDigestFor(nextPacket);

  const previousMappingRows = new Map(mapping.rows.map((row) => [row.sourcePosition, row]));
  const identityMappingRows = new Map(identityRows.map((entry) => [entry.mappingRow.sourcePosition, entry.mappingRow]));
  const nextMapping = {
    ...structuredClone(mapping),
    packetDigest: nextPacket.packetDigest,
    proposedManifest: structuredClone(nextPacket.proposedManifest),
    rows: sourcePositionsForPacket(nextPacket).map((position) => (
      identityMappingRows.get(position) ?? previousMappingRows.get(position)
    )),
    sourceGapResolutions: nextPacket.sourceGapResolutions,
    approvedManifest: structuredClone(nextPacket.proposedManifest),
  };
  if (nextPacket.repeatedSourceReferences) {
    nextMapping.repeatedSourceReferences = nextPacket.repeatedSourceReferences;
  } else delete nextMapping.repeatedSourceReferences;
  if (nextPacket.sourceGaps) nextMapping.sourceGaps = nextPacket.sourceGaps;
  else delete nextMapping.sourceGaps;
  assert.ok(nextMapping.rows.every(Boolean), 'Identity update left a missing mapping row.');
  nextMapping.mappingDigest = mappingDigestFor(nextMapping);
  assertMappingMatchesPacketOccurrences(nextPacket, nextMapping);
  assertGapTransition(packet, nextPacket, nextMapping, { provider });

  const { report: nextReport, library: nextLibrary } = await buildCurrentOwnerOverlap(
    nextMapping, { root, peerMappings },
  );
  assert.ok(nextReport.comparisons.every((entry) => entry.relationship !== 'exact'),
    'Owner-confirmed identity update would make this guide an exact duplicate.');
  const updateDigest = digestCanonicalJson({
    schemaVersion: 1,
    id: request.id,
    request,
    inputDigests: [...inputs.contents.entries()]
      .map(([name, content]) => [name, hash(content)]).sort(([left], [right]) => left.localeCompare(right)),
    packetDigest: nextPacket.packetDigest,
    mappingDigest: nextMapping.mappingDigest,
    reportDigest: nextReport.reportDigest,
    libraryDigest: nextReport.libraryDigest,
  });
  const reviewedAt = request.generatedAt;
  const reviewIdentity = {
    authorityType: 'stronger-model',
    authorityIdentity: 'Independent owner-guide relationship review',
    rationale: 'Recomputed exact issue overlap against the complete current library after the owner-directed identity additions. No exact duplicate guide was introduced; each reported partial overlap remains an intentional difference in selected reading scope.',
    reviewedAt,
  };
  const dispositions = nextReport.comparisons.map((comparison) => ({
    ...comparison,
    decision: 'approved',
    authorityType: comparison.relationship === 'none' ? 'policy' : 'stronger-model',
    authorityIdentity: comparison.relationship === 'none'
      ? 'Owner delivery zero-shared-issue policy' : reviewIdentity.authorityIdentity,
    rationale: comparison.relationship === 'none'
      ? 'Complete current comparison has no shared original.'
      : `The owner-directed selected guide remains distinct from ${comparison.orderId}; shared originals are not a claim of equivalent scope.`,
    reviewedAt,
  }));
  const relationshipReview = {
    ...reviewIdentity,
    proposalDigest: updateDigest,
    reportDigest: nextReport.reportDigest,
    packetDigest: nextPacket.packetDigest,
    mappingDigest: nextMapping.mappingDigest,
    libraryDigest: nextReport.libraryDigest,
    peerDigests: structuredClone(mapping.relationshipReview.peerDigests ?? {}),
    sourceCounts: sourceCountsForPacket(nextPacket),
    insertionReview: structuredClone(mapping.relationshipReview.insertionReview),
    dispositions,
  };
  relationshipReview.approvalDigest = approvalDigestFor(relationshipReview);
  nextMapping.relationshipReview = relationshipReview;
  assertApprovedRelationshipReview({
    packet: nextPacket, mapping: nextMapping, report: nextReport,
    currentLibraryDigest: nextReport.libraryDigest,
    peerMappings,
    expectedOrderIds: nextLibrary.orders.map((entry) => entry.orderId),
    packetValidation: { provider },
  });

  const currentChecklistText = inputs.contents.get(paths.markdown).toString('utf8');
  const displayGroupBySourceRange = ownerGuideDisplayGroups(currentChecklistText, mapping);
  const capturedGroups = new Map(contract.rows.map(([position, , , group]) =>
    [position, group == null ? null : contract.groups[group]]));
  const displayGroup = (row) => cbhBaseline ? capturedGroups.get(row.sourcePosition)
    : (row.sourceRangeReference ? displayGroupBySourceRange.get(row.sourceRangeReference) ?? row.sourceRangeReference : null);
  const groups = cbhBaseline ? contract.groups : [...new Set(nextMapping.rows.map(displayGroup).filter(Boolean))];
  const nextContract = {
    ...structuredClone(contract),
    ...(Object.hasOwn(request, 'description') ? { description: request.description } : {}),
    libraryDigest: nextReport.libraryDigest,
    groups,
    rows: cbhBaseline ? cbhBaselineContractRows(contract, nextMapping) : nextMapping.rows.map((row) => [
      row.sourcePosition, row.selectedIssueId, row.resolvedIssueTitle,
      row.sourceRangeReference ? groups.indexOf(displayGroup(row)) : null,
    ]),
    sourceCounts: sourceCountsForPacket(nextPacket),
    proposalDigest: updateDigest,
    approvalDigest: relationshipReview.approvalDigest,
  };
  nextContract.vectorSha256 = hash(JSON.stringify(nextContract.rows.map((row) => row[1])));
  const previousComparisons = new Map(verifiedReport.comparisons.map((entry) => [entry.orderId, entry]));
  const nextComparisons = new Map(nextReport.comparisons.map((entry) => [entry.orderId, entry]));
  const relationshipChanges = [...new Set([
    ...previousComparisons.keys(), ...nextComparisons.keys(),
  ])].sort().flatMap((orderId) => {
    const before = previousComparisons.get(orderId) ?? null;
    const after = nextComparisons.get(orderId) ?? null;
    return canonicalJson(before) === canonicalJson(after) ? [] : [{ orderId, before, after }];
  });
  const markdown = cbhBaseline
    ? updatedCbhBaselineChecklist(currentChecklistText, mapping, nextMapping)
    : updatedOwnerChecklist(currentChecklistText, source, mapping, nextMapping);
  const parsed = parseChecklist(markdown);
  assert.deepEqual(parsed.entries.map((entry) => entry.issueId), nextMapping.rows.map((row) => row.selectedIssueId));
  assert.deepEqual(parsed.entries.map((entry) => Number(entry.sourceKey)), nextMapping.rows.map((row) => row.sourcePosition));
  assert.deepEqual(parsed.entries.map((entry) => entry.identityEvidenceKind ?? null),
    nextMapping.rows.map((row) => row.identityEvidenceKind ?? null));

  const oldItems = new Map(payload.items.map((item) => [Number(item.issueId), structuredClone(item)]));
  const mappedItems = nextMapping.rows.map((row) => {
    const addition = identityRows.find((entry) => entry.mappingRow.sourcePosition === row.sourcePosition);
    if (!addition) {
      const existing = oldItems.get(Number(row.selectedIssueId));
      assert.ok(existing, `Existing published issue ${row.selectedIssueId} is missing from the payload.`);
      return existing;
    }
    const identity = addition.identity;
    return {
      issueId: row.selectedIssueId,
      title: identity.label,
      number: row.issueNumber == null ? null : String(row.issueNumber),
      url: identity.url,
      seriesId: null,
      seriesName: null,
      onSale: null,
      mu: null,
      digitalId: null,
      cover: null,
      description: null,
      pageCount: null,
      creators: [],
      detailsRefused: true,
      identityEvidenceKind: 'owner-confirmed-identity',
      ...(displayGroup(row) ? { collectedIn: cleanText(displayGroup(row)) } : {}),
    };
  });
  const nextItems = cbhBaseline
    ? preserveCbhBaselinePlaceholders(nextContract.rows, payload, mappedItems) : mappedItems;
  const nextPayload = {
    ...payload,
    ...(Object.hasOwn(request, 'description') ? { description: request.description } : {}),
    generatedAt: request.generatedAt,
    count: nextItems.length,
    ...(cbhBaseline ? { placeholders: remainingGaps.length, unresolved: parsed.unresolved } : {}),
    items: nextItems,
    collections: new Set(nextItems.map((item) => item.collectedIn).filter(Boolean)).size,
  };
  const gaps = nextItems.reduce((counts, item) => {
    if (item.placeholder === true && !item.seriesId && !item.digitalId) counts.placeholders += 1;
    else if (item.identityEvidenceKind === 'owner-confirmed-identity'
      && !item.seriesId && !item.digitalId) counts.ownerConfirmed += 1;
    else if (!item.seriesId && !item.digitalId) counts.empty += 1;
    return counts;
  }, { placeholders: 0, empty: 0, ownerConfirmed: 0 });
  const catalogEntry = catalog.lists.find((entry) => entry.id === request.id);
  assert.ok(catalogEntry, 'Registered owner guide is missing from the catalog.');
  const nextCatalog = {
    ...catalog,
    lists: catalog.lists.map((entry) => entry.id !== request.id ? entry : ({
      ...entry,
      ...(Object.hasOwn(request, 'description') ? { description: request.description } : {}),
      count: nextItems.length,
      placeholderCount: gaps.placeholders,
      emptyRecordCount: gaps.empty,
      ...(gaps.ownerConfirmed
        ? { ownerConfirmedIdentityCount: gaps.ownerConfirmed }
        : { ownerConfirmedIdentityCount: 0 }),
      collections: nextPayload.collections,
      updatedAt: request.generatedAt,
    })),
  };
  const nextManifest = {
    ...manifest,
    lists: manifest.lists.map((entry) => entry.id === request.id ? {
      ...nextPacket.proposedManifest,
      description: request.description ?? currentManifestEntry.description,
    } : entry),
  };
  assert.deepEqual(parseManifest(nextManifest).errors, []);
  const outputValues = [
    outputBody(path.join(root, paths.packet), nextPacket),
    outputBody(path.join(root, paths.mapping), nextMapping),
    outputBody(path.join(root, paths.report), nextReport),
    outputBody(path.join(root, paths.contract), nextContract),
    outputBody(path.join(root, paths.markdown), markdown),
    outputBody(payloadFile, nextPayload),
    outputBody(catalogFile, nextCatalog),
    outputBody(manifestFile, nextManifest),
  ];
  const publication = await preflightPublicationWrites({ root, inputs, outputs: outputValues });
  requireCleanPreflight(publication);
  const proposal = {
    schemaVersion: 1,
    status: 'awaiting-owner-approval',
    id: request.id,
    request: structuredClone(request),
    review: {
      identities: identityRows.map(({ mappingRow, identity }) => ({
        sourcePosition: mappingRow.sourcePosition,
        issueId: identity.issueId,
        label: identity.label,
        url: identity.url,
      })),
      relationshipChanges,
      relationshipCounts: nextReport.comparisons.reduce((counts, entry) => {
        counts[entry.relationship] = (counts[entry.relationship] ?? 0) + 1;
        return counts;
      }, {}),
      exactDuplicates: nextReport.comparisons
        .filter((entry) => entry.relationship === 'exact').map((entry) => entry.orderId),
    },
    inputDigests: [...inputs.contents.entries()]
      .map(([name, content]) => ({ path: name, sha256: hash(content) }))
      .sort((left, right) => left.path.localeCompare(right.path)),
    outputs: outputValues.map(({ file, content }) => ({
      path: path.relative(root, file).replaceAll(path.sep, '/'),
      sha256: hash(content),
    })),
    packetDigest: nextPacket.packetDigest,
    mappingDigest: nextMapping.mappingDigest,
    reportDigest: nextReport.reportDigest,
    libraryDigest: nextLibrary.libraryDigest,
    publication,
  };
  proposal.proposalDigest = digestCanonicalJson(proposal);
  return { proposal, inputs, outputs: outputValues };
}

export async function prepareOwnerGuideIdentityUpdate(request, options = {}) {
  const { proposal } = await buildOwnerGuideIdentityUpdate(request, options);
  return proposal;
}

export function ownerGuideIdentityUpdateApprovalRequest(proposal) {
  assert.equal(proposal.status, 'awaiting-owner-approval');
  return {
    schemaVersion: 1,
    proposalDigest: proposal.proposalDigest,
    authorityType: null,
    authorityIdentity: null,
    rationale: null,
    reviewedAt: null,
  };
}

export async function emitOwnerGuideIdentityUpdate(proposal, approval, { root = ROOT } = {}) {
  assert.equal(proposal.status, 'awaiting-owner-approval');
  assert.equal(approval?.schemaVersion, 1);
  assert.equal(approval.proposalDigest, proposal.proposalDigest,
    'Owner authority does not name this exact identity update.');
  assert.equal(approval.authorityType, 'human');
  assert.equal(approval.authorityIdentity, 'raymond-nassar',
    'Only the repository owner can authorize owner-confirmed identity publication.');
  assert.ok(typeof approval.rationale === 'string' && approval.rationale.trim());
  assert.ok(Number.isFinite(Date.parse(approval.reviewedAt ?? '')));
  const fresh = await buildOwnerGuideIdentityUpdate(proposal.request, { root });
  assert.equal(fresh.proposal.proposalDigest, proposal.proposalDigest,
    'Registered guide inputs or outputs changed after identity update approval.');
  await preflightPublicationWrites({ root, inputs: fresh.inputs, outputs: fresh.outputs });
  await writeOutputsAtomically(fresh.outputs.map(({ file, content }) => ({ path: file, content })));
  return {
    status: 'updated',
    id: proposal.id,
    rowsAdded: proposal.request.identities.length,
    files: fresh.outputs.length,
    proposalDigest: proposal.proposalDigest,
  };
}
