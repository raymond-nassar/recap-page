import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildComparisonReport, issueIdsFromValue } from './lib/cbh-overlap.mjs';
import {
  libraryDigestExcludingOrders,
  libraryDigestFor,
  reportDigestFor,
  validateMappingDigest,
} from './lib/cbh-inventory.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(rootDir, 'src', 'data', 'curated-lists.json');
const dataDir = path.join(rootDir, 'src', 'data');

function normalizeIssueId(value) {
  if (value == null) return null;
  const string = String(value).trim();
  return string.length === 0 ? null : string;
}

function validateMappingRows(rows, label) {
  if (!Array.isArray(rows)) {
    throw new Error(`${label} must contain a rows array`);
  }

  const seenIds = new Set();
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object') {
      throw new Error(`${label} row ${index + 1} is not an object`);
    }

    const status = row.resolutionStatus ?? row.status ?? null;
    const selectedIssueId = normalizeIssueId(row.selectedIssueId ?? row.issueId ?? null);
    if (status === 'approved-exception' || row.status === 'approved-exception') {
      throw new Error(`${label} row ${index + 1} uses an approved exception, which MRT-004 rejects`);
    }

    if (status === 'exact') {
      if (!selectedIssueId) {
        throw new Error(`${label} row ${index + 1} is exact but has no selected issue id`);
      }
      if (seenIds.has(selectedIssueId)) {
        throw new Error(`Duplicate selected issue id in ${label}: ${selectedIssueId}`);
      }
      seenIds.add(selectedIssueId);
      continue;
    }

    if (status === 'ambiguous' || status === 'unmatched') {
      throw new Error(`${label} row ${index + 1} is unresolved (${status}) and cannot produce a report`);
    }

    if (status != null && !['exact', 'ambiguous', 'unmatched', 'approved-exception'].includes(status)) {
      throw new Error(`${label} row ${index + 1} has an invalid resolution status: ${status}`);
    }

    if (selectedIssueId != null && status == null) {
      throw new Error(`${label} row ${index + 1} is missing a resolution status`);
    }

    if (status == null && selectedIssueId == null) {
      throw new Error(`${label} row ${index + 1} is missing both a selected issue id and a resolution status`);
    }
  }
}

export async function loadManifest(manifestPath) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const lists = Array.isArray(manifest.lists) ? manifest.lists : [];
  return lists;
}

export async function loadLibrarySnapshot({
  manifestFile = manifestPath,
  payloadDir = dataDir,
} = {}) {
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const lists = Array.isArray(manifest.lists) ? manifest.lists : [];
  const orders = await Promise.all(lists.map(async (item) => {
    const filePath = path.join(payloadDir, item.out || `${item.id}.json`);
    let payload;
    try {
      payload = JSON.parse(await readFile(filePath, 'utf8'));
    } catch (error) {
      throw new Error(`Missing generated payload for ${item.id}: ${error.message}`, { cause: error });
    }
    const issueIds = issueIdsFromValue(payload);
    return { orderId: item.id, issueIds };
  }));
  const orderIssueIds = orders.map((order) => ({
    id: String(order.orderId),
    issueIds: order.issueIds.map(String),
  }));
  return {
    manifest,
    lists,
    orders,
    orderIssueIds,
    libraryDigest: libraryDigestFor(manifest, orderIssueIds),
  };
}

export async function buildReportForMapping(mappingPath, peerPaths = [], options = {}) {
  const mapping = JSON.parse(await readFile(mappingPath, 'utf8'));
  const rows = Array.isArray(mapping.rows) ? mapping.rows : [];
  validateMappingRows(rows, 'candidate mapping');
  const usesFreshnessContract = mapping.packetDigest != null || mapping.mappingDigest != null;
  if (usesFreshnessContract) {
    if (typeof mapping.id !== 'string' || !mapping.id.trim()) {
      throw new Error('Fresh candidate mapping must name an id');
    }
    if (mapping.packetDigest == null || mapping.mappingDigest == null) {
      throw new Error(`${mapping.id ?? 'Candidate mapping'} has incomplete packet or mapping digest evidence`);
    }
    validateMappingDigest(mapping);
  }

  const candidateIds = rows
    .map((row) => normalizeIssueId(row.selectedIssueId ?? row.issueId ?? null))
    .filter((value) => value != null);

  if (candidateIds.length === 0) {
    throw new Error('Candidate mapping is empty or has no exact selected issue ids');
  }

  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error('Duplicate candidate issue ids in the mapping');
  }

  const peerMappings = await Promise.all(peerPaths.map(async (peerPath) => {
    const peer = JSON.parse(await readFile(peerPath, 'utf8'));
    const peerRows = Array.isArray(peer.rows) ? peer.rows : [];
    validateMappingRows(peerRows, `peer mapping ${path.basename(peerPath)}`);
    const ids = peerRows
      .map((row) => normalizeIssueId(row.selectedIssueId ?? row.issueId ?? null))
      .filter((value) => value != null);
    if (ids.length === 0) {
      throw new Error(`Peer mapping ${path.basename(peerPath)} is empty or has no exact selected issue ids`);
    }
    if (new Set(ids).size !== ids.length) {
      throw new Error(`Duplicate comparison ids in peer mapping ${path.basename(peerPath)}`);
    }
    if (usesFreshnessContract) validateMappingDigest(peer);
    if (usesFreshnessContract && (typeof peer.id !== 'string' || !peer.id.trim())) {
      throw new Error(`Peer mapping ${path.basename(peerPath)} must name an id`);
    }
    return {
      mapping: peer,
      order: {
        orderId: peer.id ?? path.basename(peerPath, path.extname(peerPath)),
        issueIds: ids,
      },
    };
  }));

  const peers = peerMappings.map((peer) => peer.order);
  const candidateOrderId = String(mapping.id ?? path.basename(mappingPath, path.extname(mappingPath)));
  const peerOrderIds = new Set(peers.map((peer) => String(peer.orderId)));
  const excludedIds = new Set([candidateOrderId, ...peerOrderIds]);
  const library = await loadLibrarySnapshot(options);
  const orders = library.orders.filter((item) => (
    item.orderId !== candidateOrderId && !peerOrderIds.has(String(item.orderId))
  ));
  const factualReport = buildComparisonReport({ candidateIds, orders, peerOrders: peers });
  if (!usesFreshnessContract) return factualReport;

  const peerDigests = Object.fromEntries(peerMappings
    .map(({ mapping: peer }) => [String(peer.id), peer.mappingDigest])
    .sort(([left], [right]) => left.localeCompare(right)));
  const report = {
    candidateId: candidateOrderId,
    packetDigest: mapping.packetDigest,
    mappingDigest: mapping.mappingDigest,
    libraryDigest: libraryDigestExcludingOrders(library, excludedIds),
    peerDigests,
    ...factualReport,
  };
  return { ...report, reportDigest: reportDigestFor(report) };
}

async function main() {
  const mappingPath = process.argv[2];
  if (!mappingPath) {
    console.error('Usage: npm run orders:overlap -- <mapping-path> [peer-mapping-path...]');
    process.exitCode = 1;
    return;
  }

  const peerPaths = process.argv.slice(3);
  const report = await buildReportForMapping(mappingPath, peerPaths);
  const outputDir = path.join(rootDir, 'scripts', 'data', 'cbh-overlaps');
  const outPath = path.join(outputDir, `${path.basename(mappingPath, path.extname(mappingPath))}.json`);
  await mkdir(outputDir, { recursive: true });
  await writeFile(outPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(thisFile)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
