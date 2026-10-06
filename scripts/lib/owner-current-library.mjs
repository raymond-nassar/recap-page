import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  libraryDigestFor, reportDigestFor, sourceCountsForPacket, validateMappingDigest,
  validateReportDigest,
} from './cbh-inventory.mjs';
import { buildComparisonReport, issueIdsFromValue } from './cbh-overlap.mjs';
import { validateResolvedMapping } from './cbh-resolution.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

export async function loadCurrentOwnerLibrary(candidateId) {
  if (typeof candidateId !== 'string' || !candidateId.trim()) {
    throw new Error('Current owner-library coverage requires a candidate id');
  }
  const dataDir = path.join(root, 'src', 'data');
  const [manifest, catalog] = await Promise.all([
    readJson(path.join(dataDir, 'curated-lists.json')),
    readJson(path.join(dataDir, 'catalog.json')),
  ]);
  const sourceRows = manifest.lists.filter((entry) => entry.id !== candidateId);
  const visibleRows = catalog.lists.filter((entry) => entry.id !== candidateId);
  const byId = new Map(sourceRows.map((entry) => [entry.id, {
    id: entry.id, file: entry.out, visible: false,
  }]));
  for (const entry of visibleRows) {
    byId.set(entry.id, { id: entry.id, file: entry.file, visible: true });
  }
  if (new Set(sourceRows.map((entry) => entry.id)).size !== sourceRows.length
    || new Set(visibleRows.map((entry) => entry.id)).size !== visibleRows.length) {
    throw new Error('Current owner-library descriptors contain duplicate ids');
  }
  const descriptors = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  const orders = await Promise.all(descriptors.map(async (entry) => {
    if (!entry.file) throw new Error(`Current owner-library descriptor ${entry.id} has no payload`);
    const payload = await readJson(path.join(dataDir, entry.file));
    return { orderId: entry.id, issueIds: issueIdsFromValue(payload) };
  }));
  const expected = [...new Set([...sourceRows, ...visibleRows].map((entry) => entry.id))].sort();
  if (JSON.stringify(orders.map((entry) => entry.orderId).sort()) !== JSON.stringify(expected)) {
    throw new Error('Current owner-library coverage is missing a source or visible descriptor');
  }
  const currentManifest = { ...manifest, lists: sourceRows };
  return {
    manifest: currentManifest,
    descriptors,
    orders,
    libraryDigest: libraryDigestFor(currentManifest, orders.map((entry) => ({
      id: entry.orderId, issueIds: entry.issueIds.map(String),
    }))),
  };
}

export async function buildCurrentOwnerOverlap(mapping) {
  validateMappingDigest(mapping);
  validateResolvedMapping(mapping.rows);
  if (mapping.rows.some((row) => row.resolutionStatus !== 'exact' || row.selectedIssueId == null)) {
    throw new Error('Current owner-library comparison requires only exactly resolved originals');
  }
  const library = await loadCurrentOwnerLibrary(mapping.id);
  const report = {
    candidateId: mapping.id,
    packetDigest: mapping.packetDigest,
    mappingDigest: mapping.mappingDigest,
    libraryDigest: library.libraryDigest,
    peerDigests: {},
    sourceCounts: sourceCountsForPacket(mapping),
    ...buildComparisonReport({
      candidateIds: mapping.rows.map((row) => row.selectedIssueId),
      orders: library.orders,
    }),
  };
  report.reportDigest = reportDigestFor(report);
  validateReportDigest(report);
  return { report, library };
}
