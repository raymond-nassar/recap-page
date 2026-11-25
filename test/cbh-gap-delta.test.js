import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  approvalDigestFor, digestCanonicalJson, mappingDigestFor,
} from '../scripts/lib/cbh-inventory.mjs';
import { preparePublishedCbhGapDelta } from '../scripts/lib/cbh-gap-delta.mjs';
import { placeholderId } from '../scripts/lib/placeholder-id.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const itemUrl = 'https://www.marvel.com/comics/issue/10/atomic_1';
const serviceUrl = 'https://marvel.emreparker.com/v1/issues/10';

async function fixture(t) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'cbh-gap-delta-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const metadataCache = path.join(dir, 'metadata-cache');
  await mkdir(metadataCache);
  const checklist = [
    '# Atomic Order: Issue-by-Issue Reading Checklist',
    '',
    '- [ ] Atomic #1 <!-- mrt:source-occurrence=1 -->',
    '- [ ] [Kept #2 <!-- mrt:source-occurrence=2 -->](https://www.marvel.com/comics/issue/20/kept_2)',
    '',
  ].join('\n');
  const parsed = parseChecklist(checklist);
  const oldId = placeholderId('atomic-order', parsed.unresolved[0].title, parsed.unresolved[0].sourceKey);
  const payload = {
    id: 'atomic-order',
    generatedAt: '2026-01-01T00:00:00.000Z',
    count: 2,
    placeholders: 1,
    unresolved: parsed.unresolved,
    items: [
      {
        issueId: oldId, title: 'Atomic #1', number: '1', url: null, seriesId: null, seriesName: null,
        onSale: null, mu: null, digitalId: null, cover: null, description: null, pageCount: null,
        creators: [], placeholder: true,
      },
      {
        issueId: 20, title: 'Kept #2', number: '2', url: 'https://www.marvel.com/comics/issue/20/kept_2',
        seriesId: 2, seriesName: 'Kept', onSale: '2020-01-01T00:00:00+0000', mu: null, digitalId: 200,
        cover: { path: 'https://example.test/cover', ext: 'jpg' }, description: null, pageCount: 20,
        creators: [{ name: 'Existing Writer', role: 'writer' }],
      },
    ],
  };
  const body = {
    id: 10,
    title: 'Atomic (2020) #1',
    issueNumber: '1',
    detailUrl: itemUrl,
    seriesId: 1,
    seriesName: 'Atomic (2020)',
    onSaleDate: '2020-01-01T00:00:00+0000',
    unlimitedDate: null,
    digitalId: 100,
    cover: { path: 'http://example.test/cover', extension: 'jpg' },
    pageCount: 22,
    creators: [{ name: 'New Writer', role: 'writer' }, { name: 'New Artist', role: 'penciler' }],
  };
  const metadataBodySha256 = sha256(JSON.stringify(body));
  const urlSha256 = sha256(serviceUrl);
  await writeFile(path.join(metadataCache, `${urlSha256}.json`), JSON.stringify({
    url: serviceUrl,
    urlSha256,
    status: 200,
    fetchedAt: '2026-01-01T00:00:00.000Z',
    bodySha256: metadataBodySha256,
    body,
  }));
  const mapping = {
    id: 'atomic-order',
    inventoryId: 'atomic-order',
    sourceProvider: 'comic-book-herald',
    packetDigest: 'a'.repeat(64),
    rows: [
      {
        sourcePosition: 1, selectedIssueId: 10, resolutionStatus: 'exact',
        resolvedIssueTitle: 'Atomic (2020) #1', issueNumber: '1', marvelIssueUrl: itemUrl,
      },
      {
        sourcePosition: 2, selectedIssueId: 20, resolutionStatus: 'exact',
        resolvedIssueTitle: 'Kept #2', issueNumber: '2',
        marvelIssueUrl: 'https://www.marvel.com/comics/issue/20/kept_2',
      },
    ],
    sourceGaps: [],
    sourceGapResolutions: [{
      sourcePosition: 1,
      resolutionKind: 'exact-issue',
      selectedIssueId: 10,
      previousSourceIssueReference: 'Atomic #1',
    }],
    proposedManifest: { out: 'atomic_order.json' },
  };
  mapping.mappingDigest = mappingDigestFor(mapping);
  mapping.reviewStatus = 'approved';
  mapping.relationshipReview = {
    authorityType: 'stronger-model',
    authorityIdentity: 'independent fixture reviewer',
    reviewedAt: '2026-01-01T00:00:00.000Z',
    rationale: 'Fixture relationship review.',
    reportDigest: 'c'.repeat(64),
    packetDigest: mapping.packetDigest,
    mappingDigest: mapping.mappingDigest,
  };
  mapping.relationshipReview.approvalDigest = approvalDigestFor(mapping.relationshipReview);
  const plan = {
    id: 'atomic-order',
    sourceApprovalBodyDigest: 'b'.repeat(64),
    packetDigest: mapping.packetDigest,
    mappingDigest: mapping.mappingDigest,
    relationshipReportDigest: mapping.relationshipReview.reportDigest,
    relationshipApprovalDigest: mapping.relationshipReview.approvalDigest,
    transitionLedgerDigest: digestCanonicalJson(mapping.sourceGapResolutions),
    payloadSha256: sha256(Buffer.from(JSON.stringify(payload))),
    checklistSha256: sha256(Buffer.from(checklist)),
    vectorDigest: digestCanonicalJson(payload.items.map((item) => item.issueId)),
    replacements: [{
      index: 0,
      sourcePosition: 1,
      previousIssueId: oldId,
      previousSourceIssueReference: 'Atomic #1',
      issueId: 10,
      metadataBodySha256,
    }],
  };
  return {
    dir, metadataCache, payload, checklist, mapping, plan,
    planDigest: digestCanonicalJson(plan),
  };
}

test('CBH gap delta changes only reviewed slots and uses the vendor transformation', async (t) => {
  const f = await fixture(t);
  const result = await preparePublishedCbhGapDelta({
    payloadBytes: Buffer.from(JSON.stringify(f.payload)),
    checklistBytes: Buffer.from(f.checklist),
    mapping: f.mapping,
    plan: f.plan,
    reviewedPlanDigest: f.planDigest,
    metadataCacheDir: f.metadataCache,
    generatedAt: '2026-01-02T00:00:00.000Z',
  });
  assert.equal(result.payload.items.length, 2);
  assert.equal(result.payload.items[0].issueId, 10);
  assert.equal(result.payload.items[0].digitalId, 100);
  assert.equal(result.payload.items[0].seriesName, 'Atomic (2020)');
  assert.deepEqual(result.payload.items[1], f.payload.items[1]);
  assert.equal(result.payload.placeholders, 0);
  assert.deepEqual(result.payload.unresolved, []);
  const beforeLines = f.checklist.split('\n');
  const afterLines = result.checklist.split('\n');
  assert.equal(afterLines.length, beforeLines.length);
  assert.equal(afterLines[3], beforeLines[3]);
  assert.match(result.checklist, /Atomic \(2020\) #1 <!-- mrt:source-occurrence=1 -->/);
  assert.match(result.checklist, /Kept #2 <!-- mrt:source-occurrence=2 -->/);
});

test('CBH gap delta rejects stale payload bytes and unreviewed changes outside a slot', async (t) => {
  const f = await fixture(t);
  const base = {
    payloadBytes: Buffer.from(JSON.stringify(f.payload)),
    checklistBytes: Buffer.from(f.checklist),
    mapping: f.mapping,
    plan: f.plan,
    reviewedPlanDigest: f.planDigest,
    metadataCacheDir: f.metadataCache,
    generatedAt: '2026-01-02T00:00:00.000Z',
  };
  await assert.rejects(() => preparePublishedCbhGapDelta({
    ...base,
    payloadBytes: Buffer.from(JSON.stringify({ ...f.payload, generatedAt: 'stale' })),
  }), /Stale published payload bytes/);

  const changedMapping = structuredClone(f.mapping);
  changedMapping.rows[1].selectedIssueId = 21;
  changedMapping.mappingDigest = mappingDigestFor(changedMapping);
  changedMapping.relationshipReview.mappingDigest = changedMapping.mappingDigest;
  changedMapping.relationshipReview.approvalDigest = approvalDigestFor(changedMapping.relationshipReview);
  const changedPlan = {
    ...f.plan,
    mappingDigest: changedMapping.mappingDigest,
    relationshipApprovalDigest: changedMapping.relationshipReview.approvalDigest,
  };
  await assert.rejects(() => preparePublishedCbhGapDelta({
    ...base,
    mapping: changedMapping,
    plan: changedPlan,
    reviewedPlanDigest: digestCanonicalJson(changedPlan),
  }), /Mapping changes the issue at index 1/);
});

test('CBH gap delta requires the exact approved relationship review', async (t) => {
  const f = await fixture(t);
  const base = {
    payloadBytes: Buffer.from(JSON.stringify(f.payload)),
    checklistBytes: Buffer.from(f.checklist),
    mapping: f.mapping,
    plan: f.plan,
    reviewedPlanDigest: f.planDigest,
    metadataCacheDir: f.metadataCache,
    generatedAt: '2026-01-02T00:00:00.000Z',
  };
  const missingReview = structuredClone(f.mapping);
  delete missingReview.relationshipReview;
  await assert.rejects(() => preparePublishedCbhGapDelta({
    ...base,
    mapping: missingReview,
  }), /approved relationship review/);

  const changedReview = structuredClone(f.mapping);
  changedReview.relationshipReview.reportDigest = 'e'.repeat(64);
  changedReview.relationshipReview.approvalDigest = approvalDigestFor(changedReview.relationshipReview);
  await assert.rejects(() => preparePublishedCbhGapDelta({
    ...base,
    mapping: changedReview,
  }), /relationship report differs from review/);
});

test('CBH gap delta rejects absent or mismatched genuine detail receipts', async (t) => {
  const f = await fixture(t);
  const cached = path.join(f.metadataCache, `${sha256(serviceUrl)}.json`);
  const record = JSON.parse(await readFile(cached, 'utf8'));
  record.bodySha256 = 'f'.repeat(64);
  await writeFile(cached, JSON.stringify(record));
  await assert.rejects(() => preparePublishedCbhGapDelta({
    payloadBytes: Buffer.from(JSON.stringify(f.payload)),
    checklistBytes: Buffer.from(f.checklist),
    mapping: f.mapping,
    plan: f.plan,
    reviewedPlanDigest: f.planDigest,
    metadataCacheDir: f.metadataCache,
    generatedAt: '2026-01-02T00:00:00.000Z',
  }), /invalid body digest/);
});
