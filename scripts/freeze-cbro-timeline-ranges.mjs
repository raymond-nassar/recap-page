#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packetDigestFor } from './lib/cbro-evidence.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = path.join(ROOT, 'scripts', 'data', 'cbro-timeline-batch-two.json');
const DEFAULT_OUTPUT = path.join(ROOT, 'scripts', 'data', 'cbro-packets');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function parseArgs(args) {
  const file = args.find((arg) => arg.startsWith('--file='));
  const output = args.find((arg) => arg.startsWith('--output='));
  assert(args.every((arg) => arg.startsWith('--file=') || arg.startsWith('--output=')),
    'Usage: freeze-cbro-timeline-ranges.mjs [--file=<specification>] [--output=<directory>]');
  return {
    file: file ? path.resolve(ROOT, file.slice('--file='.length)) : DEFAULT_FILE,
    output: output ? path.resolve(ROOT, output.slice('--output='.length)) : DEFAULT_OUTPUT,
  };
}

export function packetForTimelineRange(specification, event) {
  const issueIds = event.candidateIssueIds;
  assert(Array.isArray(issueIds) && issueIds.length > 0, `${event.id} has no candidate issue IDs`);
  assert(Number.isInteger(event.firstIssueNumber), `${event.id} has no first issue number`);
  assert(issueIds.every((issueId) => Number.isInteger(issueId)), `${event.id} has an invalid issue ID`);
  assert(new Set(issueIds).size === issueIds.length, `${event.id} has duplicate issue IDs`);
  const rows = issueIds.map((candidateIssueId, index) => {
    const issueNumber = String(event.firstIssueNumber + index);
    return {
      sourceIssueReference: `${event.sourceSeriesTitle} #${issueNumber}`,
      sourceRangeReference: event.sourceRangeReference,
      normalizedSeriesTitle: event.sourceSeriesTitle,
      seriesYear: event.seriesYear,
      issueNumber,
      seriesId: event.seriesId,
      candidateIssueId,
      manualSeriesSelectionApproved: true,
      selectionNote: event.manualSeriesSelectionNote,
    };
  });
  const packet = {
    schemaVersion: 1,
    id: event.id,
    inventoryId: event.id,
    sourceProvider: specification.sourceProvider,
    sourceUrl: specification.sourceUrl,
    sourceSection: event.sourceSection,
    sourceRetrievedAt: specification.sourceRetrievedAt,
    sourceContentSha256: specification.sourceContentSha256,
    sourceBoundary: specification.sourceBoundary,
    excludedSourceReferences: specification.excludedSourceReferences,
    expectedCount: rows.length,
    proposedManifest: {
      id: event.id,
      name: event.name,
      description: event.description,
      type: 'event',
      depth: 'complete',
      beginner: false,
      group: null,
      groupName: null,
      variant: null,
      sourceFile: `${event.id}.md`,
      sourcePage: specification.sourceUrl,
      sourceSection: event.sourceSection,
      sourceOrigin: 'Compiled for this project from Comic Book Reading Orders',
      sourceLicense: null,
      out: `${event.id.replaceAll('-', '_')}.json`,
      characters: event.characters,
      keywords: event.keywords,
      expect: rows.length,
      timeline: event.timeline,
      coverIssueId: issueIds[0],
    },
    insertionAnchor: { beforeId: 'maximum-security' },
    sourceReview: specification.sourceReview,
    rows,
  };
  return { ...packet, packetDigest: packetDigestFor(packet) };
}

export async function freezeTimelineRangePackets({ file = DEFAULT_FILE, output = DEFAULT_OUTPUT } = {}) {
  const specification = JSON.parse(await readFile(file, 'utf8'));
  assert(specification?.sourceProvider === 'comic-book-reading-orders',
    'Timeline specification must identify Comic Book Reading Orders');
  assert(Array.isArray(specification.events) && specification.events.length > 0,
    'Timeline specification must contain events');
  assert(new Set(specification.events.map((event) => event.id)).size === specification.events.length,
    'Timeline specification contains duplicate event IDs');
  const packets = specification.events.map((event) => packetForTimelineRange(specification, event));
  await mkdir(output, { recursive: true });
  await Promise.all(packets.map((packet) => (
    writeFile(path.join(output, `${packet.id}.json`), `${JSON.stringify(packet, null, 2)}\n`, 'utf8')
  )));
  return packets;
}

async function main() {
  const result = await freezeTimelineRangePackets(parseArgs(process.argv.slice(2)));
  console.log(`froze ${result.length} CBRO timeline packets with ${result.reduce((sum, packet) => sum + packet.rows.length, 0)} rows`);
}

const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(thisFile)) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
