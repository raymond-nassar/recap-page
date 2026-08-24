#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertApprovedRelationshipReview,
  existingEntriesForPacket,
  mergePacketEntries,
  selectedIssueIds,
} from './author-cbh-packet.mjs';
import {
  approvalDigestFor,
  canonicalJson,
  libraryDigestExcludingOrders,
  validateSourceIdentities,
} from './lib/cbh-inventory.mjs';
import {
  CBRO_SELECTED_IDS,
  CBRO_PACKET_REVIEW,
  CBRO_SOURCE_ORIGIN,
  CBRO_SOURCE_PROVIDER,
  validateCbroHistoricalInventory,
  validateCbroPacket,
  validateCbroReviewIdentity,
  writeFilesAtomically,
} from './lib/cbro-evidence.mjs';
import { buildReportForMapping, loadLibrarySnapshot } from './report-order-overlap.mjs';
import { escapeLinkText } from '../src/js/lib/markdown.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INVENTORY_PATH = path.join(ROOT, 'scripts', 'data', 'cbro-historical-inventory.json');
const PACKETS_DIR = path.join(ROOT, 'scripts', 'data', 'cbro-packets');
const MAPPINGS_DIR = path.join(ROOT, 'scripts', 'data', 'cbro-mappings');
const OVERLAPS_DIR = path.join(ROOT, 'scripts', 'data', 'cbro-overlaps');
const ORDERS_DIR = path.join(ROOT, 'src', 'data', 'orders');
const MANIFEST_PATH = path.join(ROOT, 'src', 'data', 'curated-lists.json');
const APPROVE_JOURNAL = path.join(ROOT, 'scripts', 'data', '.cbro-approve-transaction.json');
const AUTHOR_JOURNAL = path.join(ROOT, 'scripts', 'data', '.cbro-author-transaction.json');

export const CBRO_AUTHOR_IDS = Object.freeze([
  'muir-island-saga',
  'midnight-massacre',
  'bloodties',
  'childs-play',
  'eighth-day',
]);

const MANIFEST_FIELDS = new Set([
  'id',
  'name',
  'description',
  'type',
  'depth',
  'beginner',
  'coverIssueId',
  'group',
  'groupName',
  'variant',
  'sourcePage',
  'sourceSection',
  'sourceOrigin',
  'sourceLicense',
  'out',
  'characters',
  'keywords',
  'expect',
  'timeline',
  'sourceFile',
]);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseOnly(args) {
  const values = args.filter((arg) => arg.startsWith('--only='));
  if (values.length > 1) throw new Error('Use --only once with a comma-separated CBRO id list');
  const ids = values.length === 0
    ? [...CBRO_AUTHOR_IDS]
    : values[0].slice('--only='.length).split(',').map((id) => id.trim()).filter(Boolean);
  if (ids.length === 0) throw new Error('--only must name at least one CBRO id');
  if (new Set(ids).size !== ids.length) throw new Error('--only contains a duplicate CBRO id');
  for (const id of ids) assert(CBRO_SELECTED_IDS.includes(id), `Unknown selected CBRO id: ${id}`);
  return ids;
}

function assertCompleteReleaseIds(ids) {
  assert(canonicalJson(ids) === canonicalJson(CBRO_AUTHOR_IDS),
    `CBRO approval and authoring require the complete ${CBRO_AUTHOR_IDS.length}-guide release in chronology order`);
}

function readJson(filePath) {
  return readFile(filePath, 'utf8').then(JSON.parse);
}

function manifestEntryForCbroMapping(mapping) {
  assert(mapping?.reviewStatus === 'approved', `${mapping?.id ?? 'mapping'} is not approved`);
  assert(typeof mapping.packetReview === 'string' && mapping.packetReview.trim(),
    `${mapping.id} has no packet review evidence`);
  assert(mapping.approvedManifest && typeof mapping.approvedManifest === 'object',
    `${mapping.id} has no approved manifest`);
  const entry = { ...mapping.approvedManifest };
  const unexpected = Object.keys(entry).filter((key) => !MANIFEST_FIELDS.has(key));
  assert(unexpected.length === 0,
    `${mapping.id} has unsupported manifest fields: ${unexpected.join(', ')}`);
  assert(entry.sourceOrigin === CBRO_SOURCE_ORIGIN, `${mapping.id} has the wrong source origin`);
  assert(entry.sourceLicense === null, `${mapping.id} must keep sourceLicense null`);
  assert(entry.sourcePage === mapping.sourceUrl, `${mapping.id} source page differs from its mapping`);
  assert(entry.expect === mapping.rows.length, `${mapping.id} expected count differs from its mapping`);
  selectedIssueIds(mapping);
  return entry;
}

export function buildCbroMarkdown(mapping) {
  const manifest = manifestEntryForCbroMapping(mapping);
  const repeatedCount = mapping.repeatedSourceReferences?.length ?? 0;
  const trail = [
    `Generated for this project from the reviewed ${mapping.id} Comic Book Reading Orders packet.`,
    `Source: [Comic Book Reading Orders](${mapping.sourceUrl}).`,
    'The checklist retains only factual issue identities and preserves the reviewed source order.',
    ...(repeatedCount === 0 ? [] : [
      `The frozen source records ${mapping.sourceOccurrenceCount} issue occurrences, including ${repeatedCount} intentional ${repeatedCount === 1 ? 'repeat' : 'repeats'}; this checklist lists each distinct comic once at its first source occurrence.`,
    ]),
    'No source commentary, branding, layout, or images are copied. Issue metadata and exact links come from the configured Marvel metadata snapshot.',
    'See [the data provenance record](../../../docs/DATA_PROVENANCE.md) for the permission and publication boundary.',
  ].join('\n');
  const checklist = mapping.rows.map((row) => (
    `- [ ] [${escapeLinkText(row.resolvedIssueTitle)}](${row.marvelIssueUrl})`
  ));
  return `# ${manifest.name}: Issue-by-Issue Reading Checklist\n\n${trail}\n\n${checklist.join('\n')}\n`;
}

export async function approveCbroMappings(ids = CBRO_AUTHOR_IDS, {
  inventoryFile = INVENTORY_PATH,
  mappingsDir = MAPPINGS_DIR,
  overlapsDir = OVERLAPS_DIR,
  packetsDir = PACKETS_DIR,
  reviewedAt = new Date().toISOString(),
  journalFile = APPROVE_JOURNAL,
} = {}) {
  assertCompleteReleaseIds(ids);
  const inventory = await readJson(inventoryFile);
  validateCbroHistoricalInventory(inventory);
  const mappingPaths = Object.fromEntries(ids.map((id) => (
    [id, path.join(mappingsDir, `${id}.json`)]
  )));
  const mappings = await Promise.all(ids.map((id) => readJson(mappingPaths[id])));
  const packets = await Promise.all(ids.map((id) => readJson(path.join(packetsDir, `${id}.json`))));
  const reports = [];
  for (const id of ids) {
    const peerPaths = ids.filter((peerId) => peerId !== id).map((peerId) => mappingPaths[peerId]);
    const report = await buildReportForMapping(mappingPaths[id], peerPaths);
    const nonNone = report.comparisons.filter((comparison) => comparison.relationship !== 'none');
    assert(nonNone.length === 0,
      `${id} has relationships requiring a new central decision: ${nonNone.map((item) => (
        `${item.orderId}:${item.relationship}`
      )).join(', ')}`);
    reports.push(report);
  }

  const approvedMappings = mappings.map((mapping, index) => {
    const packet = packets[index];
    const report = reports[index];
    validateCbroPacket(packet, {
      expectedId: mapping.id,
      inventoryRecord: inventory.find((record) => record.id === mapping.id),
    });
    assert(mapping.packetDigest === packet.packetDigest,
      `${mapping.id} mapping names a stale packet digest`);
    assert(mapping.sourceProvider === packet.sourceProvider,
      `${mapping.id} mapping names a different provider`);
    assert(mapping.sourceContentSha256 === packet.sourceContentSha256,
      `${mapping.id} mapping names stale source content`);
    assert(canonicalJson(mapping.proposedManifest) === canonicalJson(packet.proposedManifest),
      `${mapping.id} mapping manifest differs from its packet`);
    const dispositions = report.comparisons.map((comparison) => ({
      orderId: comparison.orderId,
      relationship: comparison.relationship,
      decision: 'approved',
      rationale: 'The current report contains no shared issue for this order.',
      authorityType: 'policy',
      authorityIdentity: 'MRT-003 none-overlap policy',
      reviewedAt,
    }));
    const relationshipReview = {
      reportDigest: report.reportDigest,
      packetDigest: packet.packetDigest,
      mappingDigest: mapping.mappingDigest,
      libraryDigest: report.libraryDigest,
      peerDigests: report.peerDigests,
      dispositions,
      sourceProvider: CBRO_SOURCE_PROVIDER.id,
      packetReview: CBRO_PACKET_REVIEW,
      authorityType: 'stronger-model',
      authorityIdentity: 'MRT-003 coordinator',
      rationale: 'Every current library and selected peer comparison was reviewed; all relationships are none.',
      reviewedAt,
    };
    relationshipReview.approvalDigest = approvalDigestFor(relationshipReview);
    return {
      ...mapping,
      reviewStatus: 'approved',
      packetReview: CBRO_PACKET_REVIEW,
      approvedManifest: structuredClone(packet.proposedManifest),
      relationshipReview,
    };
  });

  for (const [index, mapping] of approvedMappings.entries()) {
    const packet = packets[index];
    const report = reports[index];
    const peerMappings = approvedMappings.filter((candidate) => candidate.id !== mapping.id);
    validateCbroReviewIdentity(mapping);
    assertApprovedRelationshipReview({
      packet,
      mapping,
      report,
      currentLibraryDigest: report.libraryDigest,
      peerMappings,
      expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
      packetValidation: { provider: CBRO_SOURCE_PROVIDER },
    });
  }

  await writeFilesAtomically(approvedMappings.flatMap((mapping, index) => ([
    {
      file: path.join(mappingsDir, `${mapping.id}.json`),
      content: `${JSON.stringify(mapping, null, 2)}\n`,
    },
    {
      file: path.join(overlapsDir, `${mapping.id}.json`),
      content: `${JSON.stringify(reports[index], null, 2)}\n`,
    },
  ])), { journalFile });
  return { mappings: approvedMappings, packets, reports };
}

export async function authorCbroPacket(ids = CBRO_AUTHOR_IDS, {
  inventoryFile = INVENTORY_PATH,
  mappingsDir = MAPPINGS_DIR,
  overlapsDir = OVERLAPS_DIR,
  packetsDir = PACKETS_DIR,
  ordersDir = ORDERS_DIR,
  manifestFile = MANIFEST_PATH,
  payloadDir = path.dirname(MANIFEST_PATH),
  journalFile = AUTHOR_JOURNAL,
} = {}) {
  assertCompleteReleaseIds(ids);
  const inventory = await readJson(inventoryFile);
  validateCbroHistoricalInventory(inventory);
  const library = await loadLibrarySnapshot({ manifestFile, payloadDir });
  const currentLibraryDigest = libraryDigestExcludingOrders(library, ids);
  const currentLists = library.manifest.lists;
  const existing = existingEntriesForPacket(currentLists, ids);
  const mappings = await Promise.all(ids.map(async (id) => ({
    id,
    mapping: await readJson(path.join(mappingsDir, `${id}.json`)),
    report: await readJson(path.join(overlapsDir, `${id}.json`)),
    packet: await readJson(path.join(packetsDir, `${id}.json`)),
  })));
  const mappingById = new Map(mappings.map(({ id, mapping }) => [id, mapping]));
  const entries = [];
  const insertionAnchors = {};
  const aggregateIssueIds = [];
  for (const { id, mapping, report, packet } of mappings) {
    validateCbroPacket(packet, {
      expectedId: id,
      inventoryRecord: inventory.find((record) => record.id === id),
      catalogEntries: currentLists,
    });
    validateCbroReviewIdentity(mapping);
    const peerMappings = ids.filter((peerId) => peerId !== id).map((peerId) => mappingById.get(peerId));
    const expectedOrderIds = [
      ...existing.map((entry) => entry.id),
      ...ids.filter((peerId) => peerId !== id),
    ];
    assertApprovedRelationshipReview({
      packet,
      mapping,
      report,
      currentLibraryDigest,
      peerMappings,
      expectedOrderIds,
      packetValidation: { provider: CBRO_SOURCE_PROVIDER },
    });
    const issueIds = selectedIssueIds(mapping);
    aggregateIssueIds.push(...issueIds);
    entries.push(manifestEntryForCbroMapping(mapping));
    insertionAnchors[id] = packet.insertionAnchor;
  }
  assert(new Set(aggregateIssueIds).size === aggregateIssueIds.length,
    'CBRO packet contains duplicate issue ids across selected peers');
  validateSourceIdentities(entries, existing);
  const merged = mergePacketEntries(existing, entries, insertionAnchors);
  const shippedInventory = inventory.map((record) => (
    ids.includes(record.id)
      ? { ...record, catalogIds: [record.id], deliveryStatus: 'shipped' }
      : record
  ));
  validateCbroHistoricalInventory(shippedInventory);
  await writeFilesAtomically([
    ...mappings.map(({ mapping }) => ({
      file: path.join(ordersDir, mapping.approvedManifest.sourceFile),
      content: buildCbroMarkdown(mapping),
    })),
    {
      file: manifestFile,
      content: `${JSON.stringify({ ...library.manifest, lists: merged }, null, 2)}\n`,
    },
    {
      file: inventoryFile,
      content: `${JSON.stringify(shippedInventory, null, 2)}\n`,
    },
  ], { journalFile });
  return { entries, issueCount: aggregateIssueIds.length };
}

async function main() {
  const args = process.argv.slice(2);
  const ids = parseOnly(args);
  const approve = args.includes('--approve');
  const author = args.includes('--author');
  if (approve === author) throw new Error('Use exactly one of --approve or --author');
  if (approve) {
    const result = await approveCbroMappings(ids);
    console.log(`approved ${result.mappings.length} CBRO mappings`);
    return;
  }
  const result = await authorCbroPacket(ids);
  console.log(`authored ${result.entries.length} CBRO orders with ${result.issueCount} issues`);
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(thisFile)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
