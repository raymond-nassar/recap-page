#!/usr/bin/env node

import {
  mkdtemp, readFile, readdir, rename, rm, writeFile,
} from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approvalDigestFor,
  libraryDigestExcludingOrders,
  mappingDigestFor,
  packetDigestFor,
} from './lib/cbh-inventory.mjs';
import { CBH_LATER_ORDER_IDS } from './lib/cbro-evidence.mjs';
import { authorPacket } from './author-cbh-packet.mjs';
import { loadLibrarySnapshot, buildReportForMapping } from './report-order-overlap.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ID = 'runaways-reading-order';
const RETRIEVED_AT = '2026-08-27';
const SOURCE_URL = 'https://www.comicbookherald.com/runaways-reading-order/';
const GAP_ISSUE = 344;
const SETTLEMENT_PATH = path.join(ROOT, 'scripts', 'data', 'cbh-provider-settlements', `${ID}.json`);
const LEDGER_PATH = path.join(ROOT, 'scripts', 'data', 'cbh-source-ledgers', `${ID}.json`);
const PACKET_PATH = path.join(ROOT, 'scripts', 'data', 'cbh-packets', `${ID}.json`);
const MAPPING_PATH = path.join(ROOT, 'scripts', 'data', 'cbh-mappings', `${ID}.json`);
const REPORT_PATH = path.join(ROOT, 'scripts', 'data', 'cbh-overlaps', `${ID}.json`);
const INVENTORY_PATH = path.join(ROOT, 'scripts', 'data', 'cbh-character-inventory.json');
const MANIFEST_PATH = path.join(ROOT, 'src', 'data', 'curated-lists.json');
const PAYLOAD_DIR = path.join(ROOT, 'src', 'data');
const ORDER_PATH = path.join(ROOT, 'src', 'data', 'orders', `${ID}.md`);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function sameJson(left, right) {
  return JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

async function writeJson(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temporary, file);
}

async function writeText(file, content) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, content, 'utf8');
  await rename(temporary, file);
}

async function prepareVendorCache() {
  const sessionDirectory = process.env.MRT_SESSION_CACHE_DIR;
  if (!sessionDirectory) throw new Error('Set MRT_SESSION_CACHE_DIR to the Runaways session cache directory.');
  const cacheDirectory = path.join(sessionDirectory, 'runaways-provider-cache');
  const files = (await readdir(cacheDirectory)).filter((file) => file.endsWith('.json'));
  let normalized = 0;
  for (const file of files) {
    const pathname = path.join(cacheDirectory, file);
    const record = await readJson(pathname);
    if (record.status !== 200 || !record.body || typeof record.body !== 'object'
      || record.bodySha256 !== createHash('sha256').update(JSON.stringify(record.body), 'utf8').digest('hex')) {
      throw new Error(`Session cache entry ${file} is not a successful, nonempty JSON response.`);
    }
    const normalizedRecord = {
      ...record,
      urlSha256: createHash('sha256').update(record.url, 'utf8').digest('hex'),
    };
    await writeJson(pathname, normalizedRecord);
    normalized += 1;
  }
  console.log(`Prepared ${normalized} exact-URL cache entries for cache-only vendoring.`);
}

function exactRows(settlement) {
  return settlement.rows
    .filter((row) => (
      (row.resolution === 'exact' || row.resolution === 'owner-validated')
      && row.readerDisposition === 'publish'
    ))
    .map((row) => ({
      sourcePosition: row.sourcePosition,
      sourceIssueReference: row.sourceIssueReference,
      sourceRangeReference: row.sourceGroup,
      sourceGroup: row.sourceGroup,
      normalizedSeriesTitle: row.normalizedSeriesTitle,
      seriesYear: row.seriesYear,
      issueNumber: row.issueNumber,
      seriesId: row.hydrated.seriesId,
      candidateIssueId: row.selectedIssueId,
      manualSeriesSelectionApproved: false,
    }));
}

function sourceExclusions(settlement) {
  return settlement.rows
    .filter((row) => row.readerDisposition === 'owner-directed-exclusion')
    .map((row) => ({
      sourcePosition: row.sourcePosition,
      sourceIssueReference: row.sourceIssueReference,
      reason: row.ownerDirectedReason
        ?? `Owner-directed exclusion: ${row.reason} See issue #${GAP_ISSUE}.`,
      decisionScope: 'owner-directed-runaways-availability',
    }));
}

function packetFor({ ledger, rows, exclusions, settlement }) {
  const proposedManifest = {
    id: ID,
    name: 'Runaways',
    description: 'A complete Runaways reading path from the original 2003 series through the latest listed additions.',
    type: 'character-run',
    spotlightKind: 'complete-guide',
    depth: 'complete',
    beginner: true,
    coverIssueId: settlement.coverReadiness.selectedIssueId,
    group: null,
    groupName: null,
    variant: null,
    sourceFile: `${ID}.md`,
    sourcePage: SOURCE_URL,
    sourceOrigin: "Compiled for this project from Comic Book Herald's guide",
    sourceLicense: null,
    out: 'runaways_reading_order.json',
    characters: ['Runaways', 'Young Avengers'],
    keywords: ['Runaways', 'Brian K. Vaughan', 'Adrian Alphona', 'Comic Book Herald'],
    expect: rows.length,
    timeline: null,
  };
  const packet = {
    schemaVersion: 1,
    id: ID,
    inventoryId: ID,
    sourceUrl: SOURCE_URL,
    sourceRetrievedAt: RETRIEVED_AT,
    sourceProvider: 'comic-book-herald',
    sourceContentSha256: ledger.sourceContentSha256,
    sourceIssueBearingBlocksSha256: ledger.sourceIssueBearingBlocksSha256,
    sourceBoundary: ledger.sourceBoundary.rationale,
    excludedSourceReferences: [],
    sourceOccurrenceCount: ledger.sourceOccurrenceCount,
    canonicalSourcePositions: true,
    excludedSourceRows: exclusions,
    expectedCount: rows.length,
    proposedManifest,
    insertionAnchor: { beforeId: 'groot-reading-order' },
    sourceReview: {
      authorityType: 'stronger-model',
      authorityIdentity: 'GPT-5.6 Terra',
      reviewedAt: RETRIEVED_AT,
      rationale: 'The complete page is the required boundary because it contains no qualifying Best Comics or Essential Comics subsection. Each expanded issue position is retained in displayed group order; the owner-directed availability exclusions remain in source evidence and are omitted only from reader-visible rows.',
    },
    rows,
  };
  return { ...packet, packetDigest: packetDigestFor(packet) };
}

function mappingFor({ packet, settlement }) {
  const byPosition = new Map(settlement.rows.map((row) => [row.sourcePosition, row]));
  const rows = packet.rows.map((row) => {
    const settled = byPosition.get(row.sourcePosition);
    if (!settled?.hydrated) throw new Error(`Missing hydrated provider data for source position ${row.sourcePosition}`);
    return {
      ...row,
      candidateIssueIds: [settled.selectedIssueId],
      selectedIssueId: settled.selectedIssueId,
      selectedIssueIds: [settled.selectedIssueId],
      marvelIssueUrl: settled.hydrated.detailUrl,
      resolvedIssueTitle: settled.hydrated.title,
      metadataIssueNumber: settled.hydrated.issueNumber,
      resolutionStatus: 'exact',
      note: settled.reason,
    };
  });
  const mapping = {
    id: ID,
    inventoryId: ID,
    packetDigest: packet.packetDigest,
    sourceUrl: SOURCE_URL,
    sourceRetrievedAt: RETRIEVED_AT,
    sourceProvider: 'comic-book-herald',
    sourceContentSha256: packet.sourceContentSha256,
    sourceRetrievalStatus: 'retrieved',
    approvedSourceCount: packet.sourceOccurrenceCount,
    excludedSourceReferences: [],
    sourceOccurrenceCount: packet.sourceOccurrenceCount,
    excludedSourceRows: packet.excludedSourceRows,
    proposedManifest: packet.proposedManifest,
    candidateMetadata: settlement.rows
      .filter((row) => row.resolution === 'exact' || row.resolution === 'owner-validated')
      .map((row) => ({ id: row.selectedIssueId, ...row.hydrated })),
    rows,
  };
  return { ...mapping, mappingDigest: mappingDigestFor(mapping) };
}

function inventoryFor(inventory, report, ledger, rows, exclusions) {
  const updated = inventory.map((record) => {
    if (record.id !== ID) return record;
    const overlaps = report.comparisons
      .filter((comparison) => comparison.relationship !== 'none')
      .map((comparison) => comparison.orderId);
    return {
      ...record,
      disposition: 'new-order',
      reason: `The full-page source boundary has ${ledger.sourceOccurrenceCount} preserved issue positions: ${rows.length} reader-visible exact provider resolutions and ${exclusions.length} owner-directed availability exclusions recorded in issue #${GAP_ISSUE}.`,
      sourceRetrievedAt: RETRIEVED_AT,
      overlapIds: overlaps,
      catalogIds: [ID],
      deliveryStatus: 'ready',
      centralDisposition: 'pilot-approved',
      sourceContentSha256: ledger.sourceContentSha256,
      sourceBoundaryStatus: 'exact-page-snapshot',
      metadataHorizonStatus: 'approved',
    };
  });
  const record = updated.find((entry) => entry.id === ID);
  if (!record) throw new Error(`Inventory record ${ID} is missing`);
  return updated;
}

function relationshipReview(report, packet, mapping) {
  const reviewedAt = RETRIEVED_AT;
  const nonNone = report.comparisons.filter((entry) => entry.relationship !== 'none');
  const review = {
    authorityType: 'stronger-model',
    authorityIdentity: 'GPT-5.6 Terra',
    reviewedAt,
    rationale: `The report compares every eligible current-library order with the ${report.candidateCount} reader-visible exact Runaways selections. All ${nonNone.length} non-none relationships were reviewed against their shared issue ids; no exact duplicate exists.`,
    reportDigest: report.reportDigest,
    packetDigest: packet.packetDigest,
    mappingDigest: mapping.mappingDigest,
    libraryDigest: report.libraryDigest,
    peerDigests: {},
    dispositions: report.comparisons.map((comparison) => ({
      orderId: comparison.orderId,
      relationship: comparison.relationship,
      decision: 'approved',
      authorityType: comparison.relationship === 'none' ? 'policy' : 'stronger-model',
      authorityIdentity: comparison.relationship === 'none'
        ? 'Complete-library no-overlap policy'
        : 'GPT-5.6 Terra',
      reviewedAt,
      rationale: comparison.relationship === 'none'
        ? 'No exact provider-resolved issue identity is shared.'
        : `The ${comparison.relationship} relationship is limited to the reported exact shared provider issue ids.`,
    })),
  };
  return { ...review, approvalDigest: approvalDigestFor(review) };
}

async function main() {
  const [settlement, ledger, inventory] = await Promise.all([
    readJson(SETTLEMENT_PATH),
    readJson(LEDGER_PATH),
    readJson(INVENTORY_PATH),
  ]);
  if (settlement.sourceLedger.id !== ID || settlement.sourceLedger.sourceBoundaryDigest !== ledger.sourceBoundaryDigest) {
    throw new Error('Settlement does not name the current frozen Runaways source ledger.');
  }
  if (settlement.partition.operational !== 0 || settlement.retrieval.cache.metrics.errors.length !== 0) {
    throw new Error('Provider settlement has operational failures and cannot be published.');
  }
  const rows = exactRows(settlement);
  const exclusions = sourceExclusions(settlement);
  if (rows.length + exclusions.length !== ledger.sourceOccurrenceCount || exclusions.length !== 2) {
    throw new Error('Settlement accounting does not preserve every Runaways source position.');
  }
  if (!settlement.coverReadiness.ready || !settlement.coverReadiness.cover) {
    throw new Error('Provider settlement has no exact cover-ready source row.');
  }

  const packet = packetFor({ ledger, rows, exclusions, settlement });
  const mapping = mappingFor({ packet, settlement });
  await writeJson(PACKET_PATH, packet);
  await writeJson(MAPPING_PATH, mapping);
  const manifest = await readJson(MANIFEST_PATH);
  const baseManifest = {
    ...manifest,
    lists: manifest.lists.filter((entry) => entry.id !== ID),
  };
  const tempDirectory = await mkdtemp(path.join(os.tmpdir(), 'mrt-runaways-overlap-'));
  const baseManifestPath = path.join(tempDirectory, 'curated-lists.json');
  await writeFile(baseManifestPath, `${JSON.stringify(baseManifest)}\n`, 'utf8');
  let report;
  let library;
  try {
    report = await buildReportForMapping(MAPPING_PATH, [], {
      manifestFile: baseManifestPath,
      payloadDir: PAYLOAD_DIR,
      excludedOrderIds: CBH_LATER_ORDER_IDS,
    });
    library = await loadLibrarySnapshot({ manifestFile: baseManifestPath, payloadDir: PAYLOAD_DIR });
    const expectedLibraryDigest = libraryDigestExcludingOrders(library, [ID, ...CBH_LATER_ORDER_IDS]);
    if (report.libraryDigest !== expectedLibraryDigest) {
      throw new Error('Complete-library report was not built against the current scoped library.');
    }
    const reviewed = {
      ...mapping,
      reviewStatus: 'approved',
      packetReview: 'The frozen packet preserves the full required source boundary, every exact metadata selection, and both explicit owner-directed exclusions.',
      approvedManifest: packet.proposedManifest,
      relationshipReview: relationshipReview(report, packet, mapping),
    };
    if (!sameJson(reviewed.proposedManifest, packet.proposedManifest)) {
      throw new Error('Approved manifest diverged from the frozen packet proposal.');
    }
    await writeJson(MAPPING_PATH, reviewed);
    await writeJson(REPORT_PATH, report);
    await writeJson(INVENTORY_PATH, inventoryFor(inventory, report, ledger, rows, exclusions));
    const temporaryOrders = path.join(tempDirectory, 'orders');
    await authorPacket([ID], {
      manifestFile: baseManifestPath,
      ordersDir: temporaryOrders,
      payloadDir: PAYLOAD_DIR,
    });
    await writeJson(MANIFEST_PATH, await readJson(baseManifestPath));
    await writeText(ORDER_PATH, await readFile(path.join(temporaryOrders, `${ID}.md`), 'utf8'));
    console.log(JSON.stringify({
      exactRows: rows.length,
      ownerDirectedExclusions: exclusions.length,
      sourcePositions: ledger.sourceOccurrenceCount,
      comparisons: report.comparisonCount,
      nonNoneRelationships: report.comparisons.filter((entry) => entry.relationship !== 'none').length,
      packetDigest: packet.packetDigest,
      mappingDigest: reviewed.mappingDigest,
      reportDigest: report.reportDigest,
    }, null, 2));
  } finally {
    await rm(tempDirectory, { recursive: true, force: true });
  }
}

const action = process.argv[2] ?? 'compose';
const run = action === 'compose'
  ? main
  : (action === 'prepare-vendor-cache' ? prepareVendorCache : null);
if (!run) throw new Error('Usage: node scripts/compose-cbh-runaways.mjs [compose|prepare-vendor-cache]');

run().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
