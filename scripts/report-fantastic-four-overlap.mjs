import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  libraryDigestFor, reportDigestFor, sourceCountsForPacket, validateMappingDigest,
} from './lib/cbh-inventory.mjs';
import { buildComparisonReport, issueIdsFromValue } from './lib/cbh-overlap.mjs';
import { validateResolvedMapping } from './lib/cbh-resolution.mjs';
import { loadLibrarySnapshot } from './report-order-overlap.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = 'mcu-prep-fantastic-four-first-steps';
const evidenceDir = path.join(root, 'scripts', 'data', 'owner-mcu-prep');

export const OWNER_SOURCE_PROVIDER = Object.freeze({
  id: 'owner-authored',
  hosts: ['github.com'],
  sourceOrigin: "Compiled for this project from the owner's selections",
  requireSourceProvider: true,
  requireSourceContentSha256: true,
});

export async function buildFirstStepsOverlap(mapping, { excludedOrderIds = [] } = {}) {
  if (mapping.id !== id) throw new Error('First Steps requires its own exact mapping');
  validateMappingDigest(mapping);
  validateResolvedMapping(mapping.rows);
  const excluded = new Set([id, ...excludedOrderIds]);
  const source = await loadLibrarySnapshot();
  const catalog = JSON.parse(await readFile(path.join(root, 'src', 'data', 'catalog.json'), 'utf8'));
  const visible = await Promise.all(catalog.lists.filter((entry) => !excluded.has(entry.id))
    .map(async (entry) => ({
      orderId: entry.id,
      issueIds: issueIdsFromValue(JSON.parse(
        await readFile(path.join(root, 'src', 'data', entry.file), 'utf8'),
      )),
    })));
  const byId = new Map(source.orders.filter((entry) => !excluded.has(entry.orderId))
    .map((entry) => [entry.orderId, entry]));
  for (const entry of visible) byId.set(entry.orderId, entry);
  const orders = [...byId.values()].sort((left, right) => left.orderId.localeCompare(right.orderId));
  const expected = [...new Set([...source.lists, ...catalog.lists]
    .map((entry) => entry.id).filter((orderId) => !excluded.has(orderId)))].sort();
  if (JSON.stringify(orders.map((entry) => entry.orderId)) !== JSON.stringify(expected)) {
    throw new Error('First Steps overlap snapshot is missing an active source or generated child');
  }
  const manifest = {
    ...source.manifest,
    lists: source.lists.filter((entry) => !excluded.has(entry.id)),
  };
  const report = {
    candidateId: id,
    packetDigest: mapping.packetDigest,
    mappingDigest: mapping.mappingDigest,
    libraryDigest: libraryDigestFor(manifest, orders.map((entry) => ({
      id: entry.orderId, issueIds: entry.issueIds.map(String),
    }))),
    peerDigests: {},
    sourceCounts: sourceCountsForPacket(mapping),
    ...buildComparisonReport({
      candidateIds: mapping.rows.map((row) => row.selectedIssueId), orders,
    }),
  };
  return { ...report, reportDigest: reportDigestFor(report) };
}

async function main() {
  const mapping = JSON.parse(await readFile(path.join(evidenceDir, `${id}.mapping.json`), 'utf8'));
  const report = await buildFirstStepsOverlap(mapping);
  await writeFile(path.join(evidenceDir, `${id}.overlap.json`),
    `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`${id}: ${report.comparisonCount} active-source and visible-child comparisons`);
  for (const entry of report.comparisons.filter((row) => row.relationship !== 'none')) {
    console.log(`${entry.orderId}: ${entry.relationship}, ${entry.sharedCount} shared originals`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
