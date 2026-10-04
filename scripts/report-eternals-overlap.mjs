import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  libraryDigestFor,
  reportDigestFor,
  sourceCountsForPacket,
  validateMappingDigest,
} from './lib/cbh-inventory.mjs';
import { buildComparisonReport, issueIdsFromValue } from './lib/cbh-overlap.mjs';
import { validateResolvedMapping } from './lib/cbh-resolution.mjs';
import { loadLibrarySnapshot } from './report-order-overlap.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'scripts', 'data', 'owner-mcu-prep');
const id = 'mcu-prep-eternals';

export const OWNER_SOURCE_PROVIDER = Object.freeze({
  id: 'owner-authored',
  hosts: ['github.com'],
  sourceOrigin: 'Compiled for this project',
  requireSourceProvider: true,
});

export async function buildEternalsOverlap(mapping, { excludedOrderIds = [] } = {}) {
  if (mapping.id !== id) throw new Error('The Eternals report requires its own mapping');
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
      candidateIds: mapping.rows.map((row) => row.selectedIssueId),
      orders,
    }),
  };
  return { ...report, reportDigest: reportDigestFor(report) };
}

async function main() {
  const mapping = JSON.parse(await readFile(path.join(evidenceDir, 'eternals-mapping.json'), 'utf8'));
  const report = await buildEternalsOverlap(mapping);
  await writeFile(path.join(evidenceDir, 'eternals-overlap.json'),
    `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`${id}: ${report.comparisonCount} source and visible-child comparisons`);
  for (const comparison of report.comparisons.filter((entry) => entry.relationship !== 'none')) {
    console.log(`${comparison.orderId}: ${comparison.relationship}, ${comparison.sharedCount} shared originals`);
  }
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(thisFile)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
