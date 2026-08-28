import { createHash } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { placeholderId } from './lib/placeholder-id.mjs';
import {
  approvalDigestFor,
  gapEvidenceDigestFor,
  mappingDigestFor,
  packetDigestFor,
} from './lib/cbh-inventory.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = 'inhumans-reading-order';
const CHECKED_AT = '2026-08-27';
const GAP_ISSUE_URL = 'https://github.com/raymond-nassar/recap-page/issues/332';
const API = 'https://marvel.emreparker.com/v1';

const paths = {
  ledger: path.join(ROOT, 'scripts', 'data', 'cbh-source-ledgers', `${ID}.json`),
  settlement: path.join(ROOT, 'scripts', 'data', 'cbh-provider-settlements', `${ID}.json`),
  packet: path.join(ROOT, 'scripts', 'data', 'cbh-packets', `${ID}.json`),
  mapping: path.join(ROOT, 'scripts', 'data', 'cbh-mappings', `${ID}.json`),
  overlap: path.join(ROOT, 'scripts', 'data', 'cbh-overlaps', `${ID}.json`),
  inventory: path.join(ROOT, 'scripts', 'data', 'cbh-character-inventory.json'),
  manifest: path.join(ROOT, 'src', 'data', 'curated-lists.json'),
  catalog: path.join(ROOT, 'src', 'data', 'catalog.json'),
  payload: path.join(ROOT, 'src', 'data', 'inhumans_reading_order.json'),
};

function yearFromCatalogName(name) {
  const match = /\((\d{4})(?:\s*-\s*(?:\d{4}|Present))?\)$/.exec(String(name));
  if (!match) throw new Error(`Cannot read a start year from provider catalog name ${JSON.stringify(name)}`);
  return Number(match[1]);
}

function sourceReference(occurrence) {
  if (typeof occurrence.sourceIssueReference === 'string' && occurrence.sourceIssueReference.trim()) {
    return occurrence.sourceIssueReference;
  }
  if (typeof occurrence.sourceText === 'string' && occurrence.sourceText.trim()) return occurrence.sourceText;
  return `Formatting marker at source position ${occurrence.position}`;
}

function sourceExclusion(occurrence) {
  return {
    sourcePosition: occurrence.position,
    sourceIssueReference: sourceReference(occurrence),
    reason: occurrence.reason ?? 'source exclusion',
    decisionScope: 'source-boundary',
  };
}

function sourceGap(row) {
  const gap = {
    sourcePosition: row.sourcePosition,
    sourceIssueReference: row.sourceIssueReference,
    sourceRangeReference: row.sourceRangeReference,
    sourceGroup: row.sourceGroup,
    normalizedSeriesTitle: row.normalizedSeriesTitle,
    seriesYear: row.seriesYear,
    issueNumber: row.issueNumber,
    kind: 'published-metadata-gap',
    status: 'open',
    checkedAt: CHECKED_AT,
    auditBasis: `Provider settlement: metadata-absent. ${row.reason}`,
    evidenceSources: [
      { kind: 'missing-comics-issue', url: GAP_ISSUE_URL, retrievedAt: CHECKED_AT },
      { kind: 'source-boundary', url: row.sourceUrl, retrievedAt: CHECKED_AT },
    ],
  };
  gap.evidenceDigest = gapEvidenceDigestFor(gap);
  return gap;
}

function cleanText(value) {
  return String(value ?? '').replace(/[\u2013\u2014]/g, '-').replace(/\s+/g, ' ').trim();
}

function coverBase(cover) {
  if (!cover?.path || !cover?.extension) return null;
  return { path: String(cover.path).replace(/^http:/, 'https:'), ext: cover.extension };
}

async function cachedIssue(cacheDirectory, issueId) {
  const url = `${API}/issues/${issueId}`;
  const name = `${createHash('sha256').update(url).digest('hex')}.json`;
  const entry = JSON.parse(await readFile(path.join(cacheDirectory, name), 'utf8'));
  if (entry.url !== url || !entry.body || entry.body.id !== issueId) {
    throw new Error(`Session cache does not contain the expected hydrated issue ${issueId}.`);
  }
  const actualHash = createHash('sha256').update(JSON.stringify(entry.body)).digest('hex');
  if (entry.bodySha256 !== actualHash) throw new Error(`Session cache hash is invalid for issue ${issueId}.`);
  return entry.body;
}

async function atomicWrite(target, value) {
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, target);
}

async function publishFromCache({ mapping, manifest }) {
  const cacheDirectory = process.env.MRT_SESSION_CACHE_DIR;
  if (!cacheDirectory) throw new Error('Set MRT_SESSION_CACHE_DIR to the accepted session-only provider cache.');
  const resolved = mapping.rows;
  const gaps = mapping.sourceGaps;
  const details = new Map();
  for (const row of resolved) details.set(row.selectedIssueId, await cachedIssue(cacheDirectory, row.selectedIssueId));

  const unresolved = gaps.map((gap) => ({
    title: gap.sourceIssueReference,
    sourceKey: String(gap.sourcePosition),
  }));
  const all = [
    ...resolved.map((row) => {
      const detail = details.get(row.selectedIssueId);
      return {
        position: row.sourcePosition,
        item: {
          issueId: row.selectedIssueId,
          title: cleanText(detail.title),
          number: row.issueNumber,
          url: detail.detailUrl,
          seriesId: detail.seriesId,
          seriesName: cleanText(detail.seriesName),
          onSale: detail.onSaleDate ?? null,
          mu: detail.unlimitedDate ?? null,
          digitalId: detail.digitalId ?? null,
          cover: coverBase(detail.cover),
          description: null,
          pageCount: detail.pageCount ?? null,
          creators: Array.isArray(detail.creators)
            ? detail.creators.filter((creator) => /writer|penciler|artist/i.test(creator.role ?? ''))
              .map(({ name, role }) => ({ name, role }))
            : [],
          collectedIn: cleanText(row.sourceRangeReference),
        },
      };
    }),
    ...gaps.map((gap) => ({
      position: gap.sourcePosition,
      item: {
        issueId: placeholderId(ID, gap.sourceIssueReference, String(gap.sourcePosition)),
        title: gap.sourceIssueReference,
        number: gap.issueNumber,
        url: null,
        seriesId: null,
        seriesName: null,
        onSale: null,
        mu: null,
        digitalId: null,
        cover: null,
        description: null,
        pageCount: null,
        creators: [],
        placeholder: true,
        collectedIn: cleanText(gap.sourceRangeReference),
      },
    })),
  ].sort((left, right) => left.position - right.position);
  if (new Set(all.map(({ item }) => String(item.issueId))).size !== all.length) {
    throw new Error('Cache-only payload would contain duplicate issue identifiers.');
  }
  const order = manifest.lists.find((entry) => entry.id === ID);
  if (!order) throw new Error('Manifest is missing the authored Inhumans entry.');
  const payload = {
    id: ID,
    name: order.name,
    description: order.description,
    source: order.sourcePage,
    sourceOrigin: order.sourceOrigin,
    sourceLicense: order.sourceLicense,
    generatedAt: new Date().toISOString(),
    apiBase: API,
    count: all.length,
    collections: new Set(all.map(({ item }) => item.collectedIn).filter(Boolean)).size,
    placeholders: gaps.length,
    unresolved,
    items: all.map(({ item }) => item),
  };
  if (payload.count !== order.expect || payload.placeholders !== gaps.length) {
    throw new Error('Cache-only payload count disagrees with the approved manifest.');
  }
  const existingCatalog = JSON.parse(await readFile(paths.catalog, 'utf8'));
  const cover = payload.items.find((item) => item.issueId === order.coverIssueId)?.cover;
  if (!cover) throw new Error(`Approved cover issue ${order.coverIssueId} has no cached cover.`);
  const entry = {
    id: order.id,
    file: order.out,
    name: order.name,
    description: order.description,
    type: order.type,
    depth: order.depth,
    spotlightKind: order.spotlightKind,
    count: payload.count,
    collections: payload.collections,
    characters: order.characters,
    keywords: order.keywords,
    group: order.group,
    groupName: order.groupName,
    variant: order.variant,
    beginner: order.beginner,
    timeline: order.timeline,
    coverIssueId: order.coverIssueId,
    cover,
    source: payload.source,
    sourceOrigin: payload.sourceOrigin,
    sourceLicense: payload.sourceLicense,
    updatedAt: payload.generatedAt,
  };
  const catalog = {
    ...existingCatalog,
    generatedAt: payload.generatedAt,
    lists: [...existingCatalog.lists],
  };
  const insertionIndex = catalog.lists.findIndex((candidate) => candidate.id === 'xmen-claremont');
  if (insertionIndex < 0) throw new Error('Catalog is missing the approved chronology anchor.');
  if (catalog.lists.some((candidate) => candidate.id === ID)) throw new Error('Catalog already contains the Inhumans entry.');
  catalog.lists.splice(insertionIndex, 0, entry);
  await Promise.all([atomicWrite(paths.payload, payload), atomicWrite(paths.catalog, catalog)]);
  console.log(`Published ${payload.count} cache-only items with ${payload.placeholders} placeholders.`);
}

async function main() {
  const [ledger, settlement, inventory] = await Promise.all(
    [paths.ledger, paths.settlement, paths.inventory].map(async (file) => JSON.parse(await readFile(file, 'utf8'))),
  );
  const catalogById = new Map(settlement.provider.directSeries
    .map((series) => [series.seriesId, yearFromCatalogName(series.catalogName)]));
  const settlementRows = settlement.rows;
  const selectedRows = settlementRows.filter((row) => row.selectedIssueId != null);
  const unresolvedRows = settlementRows.filter((row) => row.selectedIssueId == null);
  if (selectedRows.length !== 217 || unresolvedRows.length !== 42) {
    throw new Error(`Settlement must contain 217 selected and 42 unresolved rows, got ${selectedRows.length} and ${unresolvedRows.length}`);
  }

  const rows = selectedRows.map((row) => {
    const seriesYear = catalogById.get(row.hydrated.seriesId);
    if (!Number.isInteger(seriesYear)) throw new Error(`No catalog year for source position ${row.sourcePosition}`);
    return {
      sourcePosition: row.sourcePosition,
      sourceIssueReference: row.sourceIssueReference,
      sourceRangeReference: row.sourceRangeReference,
      sourceGroup: row.sourceGroup,
      normalizedSeriesTitle: row.normalizedSeriesTitle,
      seriesYear,
      issueNumber: row.issueNumber,
      seriesId: row.hydrated.seriesId,
      candidateIssueId: row.selectedIssueId,
      manualSeriesSelectionApproved: row.resolution === 'context-resolved',
      selectionNote: row.reason,
    };
  });
  const rowsByPosition = new Map(rows.map((row, index) => [row.sourcePosition, { row, index }]));
  const occurrences = ledger.issueOccurrences;
  const repeatedSourceReferences = occurrences
    .filter((occurrence) => occurrence.provisionalDisposition === 'repeat')
    .map((occurrence) => {
      const target = rowsByPosition.get(occurrence.repeatOfPosition);
      if (!target) throw new Error(`Repeat ${occurrence.position} has no selected canonical row`);
      return {
        sourcePosition: occurrence.position,
        canonicalRow: target.index + 1,
        sourceIssueReference: occurrence.sourceIssueReference,
        sourceRangeReference: occurrence.sourceRangeReference,
        normalizedSeriesTitle: target.row.normalizedSeriesTitle,
        seriesYear: target.row.seriesYear,
        issueNumber: target.row.issueNumber,
      };
    });
  const excludedSourceRows = occurrences
    .filter((occurrence) => occurrence.provisionalDisposition === 'exclusion')
    .map(sourceExclusion);
  const sourceGaps = unresolvedRows.map((row) => sourceGap({ ...row, sourceUrl: ledger.sourceUrl }));
  const manifest = {
    id: ID,
    name: 'Inhumans',
    description: 'A complete Inhumans reading path from their earliest Fantastic Four appearances through their modern era.',
    type: 'character-run',
    spotlightKind: 'complete-guide',
    depth: 'complete',
    beginner: false,
    group: null,
    groupName: null,
    variant: null,
    sourceFile: `${ID}.md`,
    sourcePage: ledger.sourceUrl,
    sourceOrigin: "Compiled for this project from Comic Book Herald's guide",
    sourceLicense: null,
    out: 'inhumans_reading_order.json',
    characters: ['Inhumans', 'Black Bolt', 'Medusa', 'Maximus'],
    keywords: ['Inhumans', 'Black Bolt', 'Medusa', 'Marvel Comics', 'Comic Book Herald'],
    expect: 259,
    timeline: 1965,
    coverIssueId: 13183,
  };
  const packet = {
    schemaVersion: 1,
    id: ID,
    inventoryId: ID,
    sourceUrl: ledger.sourceUrl,
    sourceRetrievedAt: ledger.sourceRetrievedAt,
    sourceProvider: ledger.sourceProvider,
    sourceContentSha256: ledger.sourceBoundary.contentSha256,
    sourceIssueBearingBlocksSha256: ledger.sourceBoundary.issueBearingBlocksSha256,
    sourceBoundary: ledger.sourceBoundary.reason,
    excludedSourceReferences: [...new Set(excludedSourceRows.map((row) => row.reason))],
    excludedSourceRows,
    sourceOccurrenceCount: ledger.sourceOccurrenceCount,
    canonicalSourcePositions: true,
    repeatedSourceReferences,
    sourceGaps,
    expectedCount: rows.length,
    proposedManifest: manifest,
    insertionAnchor: { beforeId: 'xmen-claremont' },
    sourceReview: {
      authorityType: 'stronger-model',
      authorityIdentity: 'Inhumans source-audit coordinator',
      rationale: 'The coordinator accepted the frozen full-page source audit and exhaustive provider settlement before packet construction.',
      reviewedAt: CHECKED_AT,
    },
    rows,
  };
  packet.packetDigest = packetDigestFor(packet);

  const candidateMetadata = selectedRows.map((row) => ({
    id: row.selectedIssueId,
    title: row.normalizedSeriesTitle,
    issueTitle: row.hydrated.title,
    seriesTitle: row.normalizedSeriesTitle,
    seriesId: row.hydrated.seriesId,
    issueNumber: row.hydrated.issueNumber,
    seriesYear: catalogById.get(row.hydrated.seriesId),
    detailUrl: row.hydrated.detailUrl,
  }));
  const mappingRows = rows.map((row) => {
    const settled = settlementRows.find((candidate) => candidate.sourcePosition === row.sourcePosition);
    return {
      ...row,
      resolutionStatus: 'exact',
      candidateIssueIds: [row.candidateIssueId],
      selectedIssueId: row.candidateIssueId,
      marvelIssueUrl: settled.hydrated.detailUrl,
      resolvedIssueTitle: settled.hydrated.title,
      note: 'Catalog, reviewed direct series, paginated series issue, and hydrated issue identities agree.',
    };
  });
  const mapping = {
    id: ID,
    inventoryId: ID,
    packetDigest: packet.packetDigest,
    sourceUrl: ledger.sourceUrl,
    sourceRetrievedAt: ledger.sourceRetrievedAt,
    sourceProvider: ledger.sourceProvider,
    sourceContentSha256: ledger.sourceBoundary.contentSha256,
    sourceRetrievalStatus: 'retrieved',
    approvedSourceCount: ledger.sourceOccurrenceCount,
    excludedSourceReferences: packet.excludedSourceReferences,
    excludedSourceRows,
    sourceOccurrenceCount: ledger.sourceOccurrenceCount,
    repeatedSourceReferences,
    sourceGaps,
    reviewStatus: 'approved',
    proposedManifest: manifest,
    candidateMetadata,
    rows: mappingRows,
    packetReview: 'Accepted source audit and provider settlement translated without substitution; the packet preserves every metadata absence as an open source gap.',
    approvedManifest: manifest,
  };
  mapping.mappingDigest = mappingDigestFor(mapping);

  const nextInventory = inventory.map((record) => record.id !== ID ? record : {
    ...record,
    disposition: 'new-order',
    reason: 'The frozen full-page guide now publishes 217 exact metadata rows and 42 explicit metadata gaps, preserving every source position and current-library relationship.',
    sourceRetrievedAt: ledger.sourceRetrievedAt,
    overlapIds: [],
    catalogIds: [ID],
    deliveryStatus: 'ready',
    centralDisposition: 'pilot-approved',
    sourceContentSha256: ledger.sourceBoundary.contentSha256,
    metadataHorizonStatus: 'approved',
  });
  await Promise.all([
    writeFile(paths.packet, `${JSON.stringify(packet, null, 2)}\n`, 'utf8'),
    writeFile(paths.mapping, `${JSON.stringify(mapping, null, 2)}\n`, 'utf8'),
    writeFile(paths.inventory, `${JSON.stringify(nextInventory, null, 2)}\n`, 'utf8'),
  ]);
  console.log(`Prepared ${rows.length} exact rows and ${sourceGaps.length} metadata gaps for ${ID}.`);

  if (!process.argv.includes('--approve-overlap')) return;

  const report = JSON.parse(await readFile(paths.overlap, 'utf8'));
  if (report.packetDigest !== packet.packetDigest || report.mappingDigest !== mapping.mappingDigest) {
    throw new Error('Overlap report does not match the generated packet and mapping.');
  }
  const reviewedAt = CHECKED_AT;
  const nonNoneRationale = {
    'amazing-spider-man-reading-order-modern-marvel-era': 'Fantastic Four (2011) issues 5 through 11 are a source-listed Inhumans run segment; the peer remains otherwise distinct.',
    axis: 'Inhuman (2014) issues 9 and 10 are source-listed Inhumans run material; the event guide remains otherwise distinct.',
    'civil-war-avengers': 'The source directly lists New Avengers: Illuminati issues 1 through 5, where Black Bolt is a founding member.',
    'doctor-strange-multiverse-of-madness': 'The shared New Avengers: Illuminati issues are source-listed Inhumans material and the peer retains its separate scope.',
    'fantastic-four-reading-order': 'The source begins with Fantastic Four appearances and continues through later shared runs; omitting them would break source-order coverage.',
    'hickman-full': 'The shared Fantastic Four, New Avengers, and Infinity issues are source-listed Inhumans material; the creator guide has a distinct complete scope.',
    'hickman-minimal': 'The shared New Avengers issues are source-listed Inhumans material; the condensed creator guide has a distinct scope.',
    'inhumans-vs-x-men': 'The source lists Uncanny Inhumans issues 18 through 20 while deliberately links to, rather than absorbs, the larger event order.',
    'loki-reading-order': 'Thor (1966) issues 146 through 152 are source-listed Inhumans appearances and do not widen the character guide.',
    'magneto-reading-order': 'Son of M issues 1 through 6 are source-listed Inhumans material and the peer remains otherwise distinct.',
    'question-of-the-week-do-you-have-a-hulk-reading-order': 'The three shared comics are source-listed Inhumans material and do not change either guide boundary.',
    'secret-invasion': 'Secret Invasion: Inhumans issues 1 through 4 are a source-listed Inhumans tie-in mini-series.',
    'silent-war': 'The complete Silent War order is a source-listed Inhumans mini-series; retaining it preserves both guides without treating either as a duplicate.',
    'silver-surfer-reading-order': 'The two origin-era Fantastic Four appearances are source-listed Inhumans material and incidental to the peer.',
    'war-of-kings': 'War of Kings issues 1 through 6 are source-listed Attilan material and the event guide remains otherwise distinct.',
    'white-tiger-ava-ayala': 'Infinity issue 3 is an incidental source-listed overlap and the peer remains otherwise distinct.',
  };
  const dispositions = report.comparisons.map((comparison) => ({
    orderId: comparison.orderId,
    relationship: comparison.relationship,
    decision: 'approved',
    authorityType: comparison.relationship === 'none' ? 'policy' : 'stronger-model',
    authorityIdentity: comparison.relationship === 'none'
      ? 'Complete-library comparison policy'
      : 'Independent Inhumans relationship review',
    rationale: comparison.relationship === 'none'
      ? 'No shared selected issue identities were found in the full-library comparison.'
      : nonNoneRationale[comparison.orderId],
    reviewedAt,
  }));
  if (dispositions.some((disposition) => !disposition.rationale)) {
    throw new Error('A non-none relationship has no reviewed rationale.');
  }
  const relationshipReview = {
    authorityType: 'stronger-model',
    authorityIdentity: 'Independent Inhumans relationship review',
    rationale: 'A full-library, source-position-preserving comparison reviewed every relationship after the cache-only settlement and retained all source-listed shared comics.',
    reviewedAt,
    reportDigest: report.reportDigest,
    packetDigest: packet.packetDigest,
    mappingDigest: mapping.mappingDigest,
    libraryDigest: report.libraryDigest,
    peerDigests: report.peerDigests,
    dispositions,
  };
  relationshipReview.approvalDigest = approvalDigestFor(relationshipReview);
  mapping.relationshipReview = relationshipReview;
  const reviewedInventory = nextInventory.map((record) => record.id !== ID ? record : {
    ...record,
    overlapIds: report.comparisons
      .filter((comparison) => comparison.relationship !== 'none')
      .map((comparison) => comparison.orderId),
  });
  await Promise.all([
    writeFile(paths.mapping, `${JSON.stringify(mapping, null, 2)}\n`, 'utf8'),
    writeFile(paths.inventory, `${JSON.stringify(reviewedInventory, null, 2)}\n`, 'utf8'),
  ]);
  console.log(`Approved ${report.comparisonCount} full-library overlap dispositions.`);
  if (process.argv.includes('--publish')) {
    await publishFromCache({ mapping, manifest: JSON.parse(await readFile(paths.manifest, 'utf8')) });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
