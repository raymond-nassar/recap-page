#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createJsonFetcher } from './lib/fetch-json.mjs';
import { resolveMapping } from './resolve-cbh-order.mjs';
import { normalizeTitle } from '../src/js/lib/markdown.js';
import {
  CBRO_RELEASE_IDS,
  CBRO_RELEASES,
  cbroReleaseForIds,
  mappingDigestFor,
  sourceOccurrenceCountFor,
  sourcePositionsForPacket,
  validateCbroHistoricalInventory,
  validateCbroPacket,
  writeFilesAtomically,
} from './lib/cbro-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = 'https://marvel.emreparker.com/v1';
const INVENTORY_PATH = path.join(ROOT, 'scripts', 'data', 'cbro-historical-inventory.json');
const PACKETS_DIR = path.join(ROOT, 'scripts', 'data', 'cbro-packets');
const MAPPINGS_DIR = path.join(ROOT, 'scripts', 'data', 'cbro-mappings');
const MANIFEST_PATH = path.join(ROOT, 'src', 'data', 'curated-lists.json');
const PREPARE_JOURNAL = path.join(ROOT, 'scripts', 'data', '.cbro-prepare-transaction.json');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseOnly(args) {
  const values = args.filter((arg) => arg.startsWith('--only='));
  const releases = args.filter((arg) => arg.startsWith('--release='));
  if (values.length > 1) throw new Error('Use --only once with a comma-separated CBRO id list');
  if (releases.length > 1) throw new Error('Use --release once');
  if (values.length > 0 && releases.length > 0) {
    throw new Error('Use --only or --release, not both');
  }
  if (releases.length > 0) {
    const releaseId = releases[0].slice('--release='.length);
    const release = CBRO_RELEASES[releaseId];
    assert(release, `Unknown CBRO release: ${releaseId}`);
    return [...release.sourceIds];
  }
  const ids = values.length === 0
    ? [...CBRO_RELEASES[CBRO_RELEASE_IDS.original].sourceIds]
    : values[0].slice('--only='.length).split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error('--only must name at least one CBRO id');
  if (new Set(ids).size !== ids.length) throw new Error('--only contains a duplicate CBRO id');
  return ids;
}

function seriesTitle(seriesName) {
  return String(seriesName ?? '').replace(/\s+\(\d{4}(?:\s*-\s*[^)]*)?\)\s*$/, '').trim();
}

function seriesYear(seriesName) {
  const year = Number(String(seriesName ?? '').match(/\((\d{4})/)?.[1]);
  return Number.isInteger(year) ? year : null;
}

export async function loadCbroPackets(
  ids = CBRO_RELEASES[CBRO_RELEASE_IDS.original].sourceIds,
  {
    inventoryFile = INVENTORY_PATH,
    packetsDir = PACKETS_DIR,
    manifestFile = MANIFEST_PATH,
  } = {},
) {
  cbroReleaseForIds(ids, { order: 'source' });
  const inventory = JSON.parse(await readFile(inventoryFile, 'utf8'));
  validateCbroHistoricalInventory(inventory);
  const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
  const catalogEntries = Array.isArray(manifest.lists) ? manifest.lists : [];
  return Promise.all(ids.map(async (id) => {
    const packet = JSON.parse(await readFile(path.join(packetsDir, `${id}.json`), 'utf8'));
    const inventoryRecord = inventory.find((record) => record.id === id);
    validateCbroPacket(packet, {
      expectedId: id,
      inventoryRecord,
      catalogEntries,
    });
    return packet;
  }));
}

export async function buildCbroMapping(packet, metadataById) {
  validateCbroPacket(packet, { expectedId: packet.id });
  const candidateMetadata = [];
  const sourcePositions = sourcePositionsForPacket(packet);
  const rows = packet.rows.map((sourceRow, index) => {
    const item = metadataById.get(String(sourceRow.candidateIssueId));
    assert(item, `${packet.id} row ${index + 1} has no metadata for ${sourceRow.candidateIssueId}`);
    assert(Number(item.id) === Number(sourceRow.candidateIssueId),
      `${packet.id} row ${index + 1} returned a different issue id`);
    const candidateTitle = seriesTitle(item.seriesName);
    const candidateYear = seriesYear(item.seriesName);
    const manualSeriesSelection = (
      normalizeTitle(candidateTitle) !== normalizeTitle(sourceRow.normalizedSeriesTitle)
    );
    const candidate = {
      id: item.id,
      title: candidateTitle,
      issueTitle: item.title,
      seriesTitle: candidateTitle,
      apiSeriesName: item.seriesName,
      seriesId: item.seriesId,
      issueNumber: String(item.issueNumber),
      seriesYear: candidateYear,
      manualSeriesSelection,
      manualSeriesSelectionApproved: (
        manualSeriesSelection && sourceRow.manualSeriesSelectionApproved === true
      ),
      detailUrl: item.detailUrl,
      onSaleDate: item.onSaleDate,
    };
    candidateMetadata.push(candidate);
    return {
      sourcePosition: sourcePositions[index],
      ...sourceRow,
      resolutionStatus: null,
      candidateIssueIds: [item.id],
      selectedIssueId: null,
      marvelIssueUrl: item.detailUrl,
      resolvedIssueTitle: item.title,
      note: sourceRow.selectionNote ?? '',
    };
  });
  const mapping = {
    id: packet.id,
    inventoryId: packet.inventoryId,
    packetDigest: packet.packetDigest,
    sourceProvider: packet.sourceProvider,
    sourceUrl: packet.sourceUrl,
    sourceRetrievedAt: packet.sourceRetrievedAt,
    sourceContentSha256: packet.sourceContentSha256,
    sourceRetrievalStatus: 'retrieved',
    approvedSourceCount: sourceOccurrenceCountFor(packet),
    excludedSourceReferences: packet.excludedSourceReferences,
    ...(packet.excludedSourceRows == null
      ? {}
      : { excludedSourceRows: packet.excludedSourceRows }),
    ...(packet.sourceOccurrenceCount == null
      ? {}
      : { sourceOccurrenceCount: packet.sourceOccurrenceCount }),
    ...(packet.repeatedSourceReferences == null
      ? {}
      : { repeatedSourceReferences: packet.repeatedSourceReferences }),
    reviewStatus: 'pending-independent-review',
    proposedManifest: packet.proposedManifest,
    candidateMetadata,
    rows,
  };
  const resolved = await resolveMapping(mapping);
  return { ...resolved, mappingDigest: mappingDigestFor(resolved) };
}

export async function prepareCbroMappings(
  ids = CBRO_RELEASES[CBRO_RELEASE_IDS.original].sourceIds,
  {
    fetchIssue = null,
    inventoryFile = INVENTORY_PATH,
    packetsDir = PACKETS_DIR,
    mappingsDir = MAPPINGS_DIR,
    manifestFile = MANIFEST_PATH,
    journalFile = PREPARE_JOURNAL,
  } = {},
) {
  const packets = await loadCbroPackets(ids, { inventoryFile, packetsDir, manifestFile });
  const getIssue = fetchIssue ?? (() => {
    const { getJson } = createJsonFetcher();
    return async (issueId) => {
      for (let attempt = 0; ; attempt += 1) {
        try {
          return await getJson(`${API}/issues/${issueId}`);
        } catch (error) {
          if (error?.status != null || attempt >= 2) {
            throw new Error(`Issue ${issueId}: ${error.message}`, { cause: error });
          }
          await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
        }
      }
    };
  })();
  const issueIds = [...new Set(packets.flatMap((packet) => (
    packet.rows.map((row) => String(row.candidateIssueId))
  )))];
  const metadataById = new Map();
  for (const issueId of issueIds) {
    metadataById.set(issueId, await getIssue(issueId));
  }
  const mappings = [];
  for (const packet of packets) {
    mappings.push(await buildCbroMapping(packet, metadataById));
  }
  await writeFilesAtomically(mappings.map((mapping) => ({
    file: path.join(mappingsDir, `${mapping.id}.json`),
    content: `${JSON.stringify(mapping, null, 2)}\n`,
  })), { journalFile });
  return mappings;
}

async function main() {
  const ids = parseOnly(process.argv.slice(2));
  const mappings = await prepareCbroMappings(ids);
  for (const mapping of mappings) {
    console.log(`${mapping.id}: ${mapping.rows.length} exact rows`);
  }
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(thisFile)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
