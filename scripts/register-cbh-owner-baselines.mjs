#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  approvalDigestFor, digestCanonicalJson, mappingDigestFor, packetDigestFor, sourceCountsForPacket,
} from './lib/cbh-inventory.mjs';
import { buildCurrentOwnerOverlap } from './lib/owner-current-library.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const BASELINE_COMMIT = 'f2c60a9410ba1b9eba76b8dd83a4b8ad01b167f9';
export const CBH_OWNER_BASELINE_IDS = Object.freeze([
  'shang-chi-master-of-kung-fu-reading-order',
  'the-complete-marvel-reading-order-guide-age-of-apocalypse-reading-order',
  'the-complete-marvel-reading-order-guide-x-men-onslaught-reading-order',
  'iron-fist-reading-order',
  'namor-sub-mariner-reading-order',
]);
const text = async (file) => (await readFile(path.join(ROOT, file), 'utf8')).replace(/\r\n/g, '\n');
const json = async (file) => JSON.parse(await text(file));
// Preserve historical separators as decoded evidence without introducing them into new copy.
const body = (value) => `${JSON.stringify(value, null, 2)
  .replace(/\u2013/g, '\\u2013').replace(/\u2014/g, '\\u2014')}\n`;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export async function capturedCbhOwnerBaseline(id) {
  assert.ok(CBH_OWNER_BASELINE_IDS.includes(id), 'Only the five reviewed existing CBH guides are registration targets.');
  const manifest = await json('src/data/curated-lists.json');
  const entry = manifest.lists.find((row) => row.id === id);
  const files = [
    `scripts/data/cbh-source-ledgers/${id}.json`,
    `scripts/data/cbh-packets/${id}.json`,
    `scripts/data/cbh-mappings/${id}.json`,
    `scripts/data/cbh-overlaps/${id}.json`,
    `src/data/orders/${id}.md`,
    `src/data/${entry.out}`,
  ];
  assert.equal(execFileSync('git', ['diff', '--exit-code', BASELINE_COMMIT, '--', ...files], {
    cwd: ROOT, encoding: 'utf8', maxBuffer: 1024 * 1024,
  }), '', 'Baseline evidence must still match its captured source commit.');
  const [ledger, originalPacket, originalMapping, originalReport, markdown, payload] =
    await Promise.all(files.map((file) => file.endsWith('.md') ? text(file) : json(file)));
  const source = {
    ...ledger,
    sourceCredit: entry.sourceOrigin,
    rows: [...originalPacket.rows, ...(originalPacket.sourceGaps ?? [])]
      .sort((a, b) => a.sourcePosition - b.sourcePosition),
  };
  const packet = { ...originalPacket, proposedManifest: entry };
  packet.packetDigest = packetDigestFor(packet);
  const mapping = {
    ...originalMapping, packetDigest: packet.packetDigest,
    proposedManifest: entry, approvedManifest: entry,
  };
  mapping.mappingDigest = mappingDigestFor(mapping);
  const { report } = await buildCurrentOwnerOverlap(mapping);
  assert.ok(report.comparisons.every((comparison) => comparison.relationship !== 'exact'),
    'A baseline registration cannot authorize an exact duplicate.');
  const capturedFiles = Object.fromEntries(await Promise.all(files.map(async (file) => [file, sha256(await text(file))])));
  const proposalDigest = digestCanonicalJson({ id, capturedFiles, reportDigest: report.reportDigest });
  const authority = {
    authorityType: 'stronger-model',
    authorityIdentity: 'Independent CBH baseline registration review',
    rationale: 'Retain the existing published source selection and every original approval. Current complete-library overlaps describe distinct reading scopes; registration adds no comics and changes no published rows.',
    reviewedAt: '2026-10-22',
  };
  mapping.relationshipReview = {
    ...authority,
    proposalDigest,
    packetDigest: packet.packetDigest,
    mappingDigest: mapping.mappingDigest,
    reportDigest: report.reportDigest,
    libraryDigest: report.libraryDigest,
    peerDigests: {},
    sourceCounts: sourceCountsForPacket(packet),
    insertionReview: originalMapping.relationshipReview.insertionReview ?? {
      ...authority, insertionAnchor: { beforeId: manifest.lists[manifest.lists.indexOf(entry) + 1].id },
    },
    dispositions: report.comparisons.map((comparison) => ({
      ...comparison, decision: 'approved',
      ...(comparison.relationship === 'none' ? {
        authorityType: 'policy', authorityIdentity: 'Owner delivery zero-shared-issue policy',
        rationale: 'Complete current comparison has no shared original.', reviewedAt: authority.reviewedAt,
      } : authority),
    })),
  };
  mapping.relationshipReview.approvalDigest = approvalDigestFor(mapping.relationshipReview);
  const parsed = parseChecklist(markdown);
  const checklist = [...parsed.entries, ...parsed.unresolved].sort((a, b) => a.index - b.index);
  assert.equal(checklist.length, payload.items.length);
  const groups = [...new Set(checklist.map((row) => row.section).filter(Boolean))];
  const rows = checklist.map((row, index) => {
    const item = payload.items[index];
    assert.equal(row.section, item.collectedIn ?? null);
    assert.equal(row.issueId ?? null, item.placeholder ? null : item.issueId);
    return [Number(row.sourceKey), item.issueId, item.title, row.section ? groups.indexOf(row.section) : null];
  });
  const contract = {
    id, name: entry.name, description: entry.description,
    sourceUrl: originalPacket.sourceUrl, sourceOrigin: entry.sourceOrigin,
    sourceProvider: 'comic-book-herald',
    groups, rows,
    vectorSha256: sha256(JSON.stringify(rows.map((row) => row[1]))),
    sourceSha256: sha256(body(source)),
    sourceIssueBearingBlocksSha256: packet.sourceIssueBearingBlocksSha256,
    sourceCounts: sourceCountsForPacket(packet),
    libraryDigest: report.libraryDigest,
    proposalDigest, approvalDigest: mapping.relationshipReview.approvalDigest,
    cbhBaseline: {
      sourceCommit: BASELINE_COMMIT,
      files: capturedFiles,
      packetDigest: originalPacket.packetDigest,
      mappingDigest: originalMapping.mappingDigest,
      reportDigest: originalReport.reportDigest,
      approvalDigest: originalMapping.relationshipReview.approvalDigest,
    },
  };
  return {
    registration: { id, contract: `test/fixtures/owner-delivery/${id}.json`, baselineRowCount: rows.length, sourceProvider: 'comic-book-herald' },
    outputs: new Map([
      [`scripts/data/owner-selections/${id}.json`, body(source)],
      [`scripts/data/owner-packets/${id}.json`, body(packet)],
      [`scripts/data/owner-mappings/${id}.json`, body(mapping)],
      [`scripts/data/owner-overlaps/${id}.json`, body(report)],
      [`test/fixtures/owner-delivery/${id}.json`, body(contract)],
    ]),
  };
}

async function main() {
  assert.deepEqual(process.argv.slice(2), ['--write'], 'Use --write to materialize the five evidence-only registrations.');
  const registry = await json('scripts/data/owner-deliveries.json');
  for (const id of CBH_OWNER_BASELINE_IDS) {
    const { registration, outputs } = await capturedCbhOwnerBaseline(id);
    for (const [file, content] of outputs) {
      await mkdir(path.dirname(path.join(ROOT, file)), { recursive: true });
      await writeFile(path.join(ROOT, file), content);
    }
    const existing = registry.guides.find((guide) => guide.id === id);
    if (existing) assert.deepEqual(existing, registration);
    else registry.guides.push(registration);
    console.log(`${id}: captured ${registration.baselineRowCount} published rows`);
  }
  await writeFile(path.join(ROOT, 'scripts/data/owner-deliveries.json'), body(registry));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.stack); process.exitCode = 1; });
}
