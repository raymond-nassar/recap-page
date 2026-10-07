import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  libraryDigestFor, reportDigestFor, sourceCountsForPacket, validateMappingDigest,
  validateReportDigest,
} from './cbh-inventory.mjs';
import { buildComparisonReport, issueIdsFromValue } from './cbh-overlap.mjs';
import { validateResolvedMapping } from './cbh-resolution.mjs';
import { resolvePublicFile } from '../check-publication.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = async (root, file) => JSON.parse(await readFile(await resolvePublicFile(root, file), 'utf8'));

export async function loadCurrentOwnerLibrary(candidateId, { root = ROOT } = {}) {
  if (typeof candidateId !== 'string' || !candidateId.trim()) {
    throw new Error('Current owner-library coverage requires a candidate id');
  }
  const dataDir = path.join(root, 'src', 'data');
  const [manifest, catalog] = await Promise.all([
    readJson(root, 'src/data/curated-lists.json'),
    readJson(root, 'src/data/catalog.json'),
  ]);
  if (!Array.isArray(manifest.lists) || !manifest.lists.length
    || !Array.isArray(catalog.lists) || !catalog.lists.length) {
    throw new Error('Current owner-library coverage requires complete source and visible rosters');
  }
  const sourceRows = manifest.lists.filter((entry) => entry.id !== candidateId);
  const visibleRows = catalog.lists.filter((entry) => entry.id !== candidateId);
  const byId = new Map(sourceRows.map((entry) => [entry.id, {
    id: entry.id, file: entry.out, visible: false,
  }]));
  for (const entry of visibleRows) {
    if (byId.has(entry.id) && byId.get(entry.id).file !== entry.file) {
      throw new Error('Current source and visible payload identities disagree');
    }
    byId.set(entry.id, { id: entry.id, file: entry.file, visible: true });
  }
  if (new Set(sourceRows.map((entry) => entry.id)).size !== sourceRows.length
    || new Set(visibleRows.map((entry) => entry.id)).size !== visibleRows.length) {
    throw new Error('Current owner-library descriptors contain duplicate ids');
  }
  const descriptors = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  const orders = await Promise.all(descriptors.map(async (entry) => {
    if (typeof entry.file !== 'string' || path.basename(entry.file) !== entry.file
      || !entry.file.endsWith('.json')) throw new Error('Current owner-library payload must be a plain JSON filename');
    const payload = await readJson(root, path.relative(root, path.join(dataDir, entry.file)));
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

export async function buildCurrentOwnerOverlap(mapping, options = {}) {
  validateMappingDigest(mapping);
  validateResolvedMapping(mapping.rows);
  if (mapping.rows.some((row) => row.resolutionStatus !== 'exact' || row.selectedIssueId == null)) {
    throw new Error('Current owner-library comparison requires only exactly resolved originals');
  }
  const library = await loadCurrentOwnerLibrary(mapping.id, options);
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
