import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  authorizeOwnerGuide, emitOwnerGuide, OWNER_PROVIDER, ownerApprovalRequest, parseOwnerMarkdown, prepareOwnerGuide, verifyOwnerMetadataCache,
} from '../scripts/lib/owner-guide.mjs';
import { validateFrozenPacket, validatePacketProposal } from '../scripts/lib/cbh-inventory.mjs';
import { assertOwnerDeliveryContract } from './helpers/owner-delivery-contract.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));

async function setup(t, markdown = '# My reading list\n\n## First group\n- Sample Comic (2020) #1-2\n') {
  const root = await mkdtemp(path.join(tmpdir(), 'owner-guide-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const directory of ['src/data', 'scripts/data', 'private/cache']) {
    await mkdir(path.join(root, directory), { recursive: true });
  }
  await writeFile(path.join(root, 'private', 'input.md'), markdown);
  const anchor = {
    id: 'baseline', name: 'Baseline', type: 'screen-companion', depth: 'selected', beginner: false,
    timeline: null, description: 'Existing reading list.', out: 'baseline.json', sourceFile: 'baseline.md',
    sourcePage: 'https://github.com/raymond-nassar/recap-page/issues/10',
    sourceOrigin: 'Selected by raymond-nassar for MCU Prep', sourceLicense: null, coverIssueId: 101,
    expect: 2, group: null, groupName: null, variant: null, characters: [], keywords: [],
  };
  await writeFile(path.join(root, 'src', 'data', 'curated-lists.json'), json({
    lists: [anchor, { ...anchor, id: 'hidden-parent', out: 'hidden.json', sourceFile: 'hidden.md',
      sourcePage: 'https://github.com/raymond-nassar/recap-page/issues/11',
      catalog: false, partitionFile: 'synthetic-chapters.json' }],
  }));
  await writeFile(path.join(root, 'src', 'data', 'catalog.json'), json({
    lists: [{ ...anchor, file: anchor.out }, { id: 'generated-child', file: 'child.json' }],
  }));
  for (const [file, issueIds] of [['baseline.json', [101, 201]], ['hidden.json', [201, 202]], ['child.json', [202]]]) {
    await writeFile(path.join(root, 'src', 'data', file), json({ issueIds }));
  }
  await writeFile(path.join(root, 'scripts', 'data', 'owner-deliveries.json'), json({ schemaVersion: 1, guides: [] }));
  const request = {
    schemaVersion: 1, id: 'synthetic-owner-guide', name: 'Synthetic owner guide',
    description: 'Two exact original comics in their selected group.',
    sourceUrl: 'https://github.com/raymond-nassar/recap-page/issues/1000', sourceRetrievedAt: '2026-10-07',
    markdownFile: path.join(root, 'private', 'input.md'), metadataCache: path.join(root, 'private', 'cache'),
    metadataIssueIds: [101, 102], selections: [], publicFiles: [], insertionAnchor: { beforeId: 'baseline' },
    characters: ['Synthetic fixture'], keywords: [],
  };
  async function cache(id, number, status = 200) {
    const url = `https://marvel.emreparker.com/v1/issues/${id}`;
    const body = {
      id, title: `Sample Comic (2020) #${number}`, issueNumber: String(number), seriesId: 900,
      seriesName: 'Sample Comic (2020)', detailUrl: `https://www.marvel.com/comics/issue/${id}/`,
      digitalId: id + 1000, cover: null, description: 'Synthetic private provider prose is not emitted.',
    };
    const record = {
      url, urlSha256: hash(url), fetchedAt: '2026-10-07T01:00:00Z', status,
      ...(status === 404 ? { error: `404 ${url}` } : { body, bodySha256: hash(JSON.stringify(body)) }),
    };
    await writeFile(path.join(request.metadataCache, `${hash(url)}.json`), json(record));
    return record;
  }
  await cache(101, 1);
  await cache(102, 2);
  return { root, request, cache };
}

function actualReview(proposal) {
  const identity = {
    authorityType: 'human', authorityIdentity: 'Synthetic fixture reviewer, not a real approval',
    rationale: 'Synthetic authority fixture for bounded command tests.', reviewedAt: '2026-10-07T02:00:00Z',
  };
  return {
    schemaVersion: 1, proposalDigest: proposal.proposalDigest, sourceReview: identity,
    insertionReview: { ...identity, insertionAnchor: { beforeId: 'baseline' } },
    relationshipReview: {
      ...identity,
      dispositions: proposal.artifacts.report.comparisons.filter((entry) => entry.relationship !== 'none')
        .map((entry) => ({ ...entry, ...identity, decision: 'approved' })),
    },
  };
}

test('numbered owner trades preserve the exact supplied scope without inventing editions or originals', async (t) => {
  const markdown = '# MCU Prep: a synthetic selection\n\n'
    + '1. **Formation event** - a formation-focused compilation, not a trade.\n'
    + '2. **A writer first volume** - not a complete collection.\n';
  const { root, request } = await setup(t, markdown);
  const intake = parseOwnerMarkdown(markdown);
  assert.deepEqual(intake.map((entry) => entry.title), ['Formation event', 'A writer first volume']);
  const unresolved = await prepareOwnerGuide(request, { root });
  assert.equal(unresolved.status, 'needs-resolution');
  assert.deepEqual(unresolved.unresolvedSelections, [1, 2]);
  assert.deepEqual(unresolved.intake.map((entry) => entry.markdown), markdown.trim().split('\n').slice(2));
  assert.equal(unresolved.intakeReceipt.sha256, hash(markdown));
  assert.deepEqual((await readdir(path.join(root, 'scripts', 'data'))).sort(), ['owner-deliveries.json']);
  request.selections = intake.map((entry, index) => ({
    inputPosition: entry.inputPosition, inputSha256: entry.inputSha256, group: entry.title,
    interpretation: index === 0 ? 'Owner compilation' : 'Original first trade',
    evidenceSources: [{ url: 'https://example.org/dated-bibliography', retrievedAt: '2026-10-07' }],
    rows: [{ sourceIssueReference: `Sample Comic (2020) #${index + 1}`,
      normalizedSeriesTitle: 'Sample Comic', seriesYear: 2020, issueNumber: String(index + 1) }],
  }));
  const proposal = await prepareOwnerGuide(request, { root });
  assert.equal(proposal.status, 'awaiting-review');
  assert.deepEqual(proposal.artifacts.mapping.rows.map((entry) => entry.selectedIssueId), [101, 102]);
  assert.deepEqual(proposal.artifacts.source.selections.map((entry) => entry.interpretation),
    ['Owner compilation', 'Original first trade']);
  request.selections[0].inputSha256 = '0'.repeat(64);
  await assert.rejects(() => prepareOwnerGuide(request, { root }), /exact supplied Markdown/);
});

test('plain issue Markdown resolves through genuine cache receipts and every current library descriptor', async (t) => {
  const { root, request } = await setup(t);
  const proposal = await prepareOwnerGuide(request, { root });
  assert.equal(proposal.status, 'awaiting-review');
  assert.deepEqual(proposal.artifacts.mapping.rows.map((entry) => [entry.sourcePosition, entry.selectedIssueId]),
    [[1, 101], [2, 102]]);
  assert.deepEqual(proposal.artifacts.report.comparisons.map((entry) => entry.orderId),
    ['baseline', 'generated-child', 'hidden-parent']);
  assert.deepEqual(proposal.artifacts.report.comparisons[0], {
    orderId: 'baseline', relationship: 'partial', sharedCount: 1, sharedIds: ['101'],
  });
  assert.ok(!JSON.stringify(proposal).includes('Synthetic private provider prose'));
  assert.ok(!JSON.stringify(proposal).includes(request.metadataCache));
  assert.equal(proposal.artifacts.source.preservedResearch.artifacts[0].bytes,
    (await readFile(request.markdownFile)).length);
  assert.equal(validatePacketProposal(proposal.artifacts.packet, {
    provider: OWNER_PROVIDER,
  }), true);
  assert.equal(proposal.artifacts.packet.proposedManifest.coverIssueId, null, 'Missing optional cover data is explicit.');
  assert.throws(() => validatePacketProposal(proposal.artifacts.packet, {
    provider: { ...OWNER_PROVIDER, allowMissingCover: false },
  }), /exact coverIssueId/, 'The owner-only capability does not relax other provider contracts.');
  assert.throws(() => validateFrozenPacket(proposal.artifacts.packet, {
    provider: OWNER_PROVIDER,
  }), /requires human or stronger-model authority/);
  assert.deepEqual(await prepareOwnerGuide(request, { root }), proposal, 'preparation is byte-deterministic');
});

test('emission requires exact source, insertion and non-none authority and preserves other data', async (t) => {
  const { root, request } = await setup(t);
  const proposal = await prepareOwnerGuide(request, { root });
  const approval = actualReview(proposal);
  const pending = ownerApprovalRequest(proposal);
  assert.deepEqual(pending.relationshipReview.dispositions.map((entry) => entry.orderId), ['baseline']);
  await assert.rejects(() => authorizeOwnerGuide(proposal, pending, { root }), /actual authority/);
  const missing = structuredClone(approval);
  missing.relationshipReview.dispositions = [];
  await assert.rejects(() => authorizeOwnerGuide(proposal, missing, { root }), /incomplete/);
  const stale = structuredClone(approval);
  stale.proposalDigest = '0'.repeat(64);
  await assert.rejects(() => authorizeOwnerGuide(proposal, stale, { root }), /exact proposal/);
  const wrong = structuredClone(approval);
  wrong.relationshipReview.dispositions[0].sharedIds = ['102'];
  await assert.rejects(() => authorizeOwnerGuide(proposal, wrong, { root }), /observed comparison/);
  const before = await readFile(path.join(root, 'src', 'data', 'baseline.json'));
  const artifacts = await authorizeOwnerGuide(proposal, approval, { root });
  const emitted = await emitOwnerGuide(proposal, approval, { root });
  assert.equal(emitted.status, 'authored-not-vendored');
  assert.equal(emitted.rows, 2);
  const contract = await readJson(path.join(root, proposal.paths.contract));
  assert.deepEqual(contract.rows, [[1, 101, 'Sample Comic (2020) #1', 0], [2, 102, 'Sample Comic (2020) #2', 0]]);
  assert.deepEqual(contract.groups, ['First group']);
  assert.deepEqual(await readFile(path.join(root, 'src', 'data', 'baseline.json')), before);
  const manifest = await readJson(path.join(root, 'src', 'data', 'curated-lists.json'));
  assert.deepEqual(manifest.lists.map((entry) => entry.id), ['synthetic-owner-guide', 'baseline', 'hidden-parent']);
  const registry = await readJson(path.join(root, 'scripts', 'data', 'owner-deliveries.json'));
  assert.deepEqual(registry.guides, [{ id: request.id, contract: proposal.paths.contract }]);
  const payload = {
    id: request.id, description: request.description, sourceOrigin: artifacts.packet.proposedManifest.sourceOrigin,
    sourceLicense: null, count: 2, placeholders: 0, unresolved: [],
    items: artifacts.mapping.rows.map((row) => ({
      issueId: row.selectedIssueId, title: row.resolvedIssueTitle, collectedIn: row.sourceRangeReference,
      description: null, digitalId: row.selectedIssueId + 1000, seriesId: 900,
      onSale: null, mu: null, cover: null, pageCount: null, creators: [],
    })),
  };
  const payloadFile = path.join(root, 'src', 'data', artifacts.packet.proposedManifest.out);
  await writeFile(payloadFile, json(payload));
  const catalogFile = path.join(root, 'src', 'data', 'catalog.json');
  const catalog = await readJson(catalogFile);
  catalog.lists.unshift({ ...artifacts.packet.proposedManifest,
    file: artifacts.packet.proposedManifest.out, source: request.sourceUrl });
  await writeFile(catalogFile, json(catalog));
  await assertOwnerDeliveryContract(contract, { root, contracts: [contract], peerCount: 3 });
  payload.items[0].issueId = 102;
  await writeFile(payloadFile, json(payload));
  await assert.rejects(() => assertOwnerDeliveryContract(contract, { root, contracts: [contract], peerCount: 3 }));
  await assert.rejects(() => emitOwnerGuide(proposal, approval, { root }), /Only new owner guides/);
});

test('ambiguous identities and explicit metadata gaps never become silently omitted successful rows', async (t) => {
  const { root, request, cache } = await setup(t);
  await cache(103, 1);
  request.metadataIssueIds.push(103);
  const ambiguous = await prepareOwnerGuide(request, { root });
  assert.equal(ambiguous.status, 'needs-resolution');
  assert.equal(ambiguous.unresolved[0].resolutionStatus, 'ambiguous');
  assert.equal(ambiguous.unresolved[0].sourcePosition, 1);
  request.metadataIssueIds = [101, 102, 104];
  await cache(104, 3, 404);
  const input = parseOwnerMarkdown(await readFile(request.markdownFile, 'utf8'))[0];
  request.selections = [{
    inputPosition: 1, inputSha256: input.inputSha256, group: 'First group',
    evidenceSources: [{ url: 'https://example.org/selected-scope', retrievedAt: '2026-10-07' }],
    rows: [1, 3, 2, 1].map((number) => ({
      sourceIssueReference: `Sample Comic (2020) #${number}`, normalizedSeriesTitle: 'Sample Comic',
      seriesYear: 2020, issueNumber: String(number),
      ...(number === 3 ? {
        gap: {
          kind: 'published-metadata-gap', status: 'open', checkedAt: '2026-10-07',
          auditBasis: 'Synthetic exact metadata request returned 404; the original remains selected.',
          evidenceSources: [
            { kind: 'metadata', url: 'https://marvel.emreparker.com/v1/issues/104', retrievedAt: '2026-10-07' },
            { kind: 'tracking', url: 'https://github.com/raymond-nassar/recap-page/issues/1001', retrievedAt: '2026-10-07' },
          ],
        },
      } : {}),
    })),
  }];
  const proposal = await prepareOwnerGuide(request, { root });
  assert.equal(proposal.status, 'awaiting-review');
  assert.deepEqual(proposal.sourceCounts, {
    sourceOccurrenceCount: 4, sourceIdentityCount: 3, includedIssueCount: 2,
    sourceGapCount: 1, repeatedSourceReferenceCount: 1,
  });
  const authored = await authorizeOwnerGuide(proposal, actualReview(proposal), { root });
  assert.deepEqual(authored.contract.rows.map((row) => row.slice(0, 2)), [[1, 101], [3, 102]]);
  assert.equal(authored.source.sourceGaps[0].sourcePosition, 2);
  assert.equal(authored.packet.repeatedSourceReferences[0].sourcePosition, 4);
});

test('unsafe proposed provenance, stale public bytes and forged cache projections stop before emission', async (t) => {
  const { root, request } = await setup(t);
  await mkdir(path.join(root, 'public'));
  await writeFile(path.join(root, 'public', 'facts.json'), '{"fact":"safe"}');
  request.publicFiles = [{ path: 'public/facts.json', dependencies: [] }];
  const proposal = await prepareOwnerGuide(request, { root });
  await writeFile(path.join(root, 'public', 'facts.json'), '{"fact":"changed"}');
  await assert.rejects(() => emitOwnerGuide(proposal, actualReview(proposal), { root }), /unanswered/);
  request.sourceFacts = { privatePath: 'C:' + '\\Users\\synthetic-reader\\cache' };
  await assert.rejects(() => prepareOwnerGuide(request, { root }), /findings/);
  delete request.sourceFacts;
  const url = 'https://marvel.emreparker.com/v1/issues/101';
  const recordFile = path.join(request.metadataCache, `${hash(url)}.json`);
  const record = await readJson(recordFile);
  record.body.title = 'A different issue (2020) #1';
  await writeFile(recordFile, json(record));
  await assert.rejects(() => prepareOwnerGuide(request, { root }), /invalid body digest/);
  record.bodySha256 = hash(JSON.stringify(record.body));
  await writeFile(recordFile, json(record));
  await assert.rejects(() => verifyOwnerMetadataCache(proposal, request.metadataCache), /changed after source review/);
  assert.deepEqual(await readdir(path.join(root, 'scripts', 'data')), ['owner-deliveries.json']);
});

test('incomplete original identities and an explicit identity conflict cannot select a neighboring issue', async (t) => {
  const { root, request, cache } = await setup(t);
  const intake = parseOwnerMarkdown(await readFile(request.markdownFile, 'utf8'));
  request.selections = [{
    inputPosition: 1, inputSha256: intake[0].inputSha256, group: 'First group',
    evidenceSources: [{ url: 'https://example.org/selected-originals', retrievedAt: '2026-10-07' }],
    rows: [{ sourceIssueReference: 'Sample Comic (2020) #1', normalizedSeriesTitle: 'Sample Comic', seriesYear: 2020 }],
  }];
  await assert.rejects(() => prepareOwnerGuide(request, { root }), /explicit series title, year and issue number/);
  await cache(103, 3);
  request.selections[0].rows[0].issueNumber = '1';
  request.selections[0].rows[0].originalIssueId = 103;
  const conflict = await prepareOwnerGuide(request, { root });
  assert.equal(conflict.status, 'needs-resolution');
  assert.equal(conflict.unresolved[0].resolutionStatus, 'identity-conflict');
  assert.equal(conflict.unresolved[0].selectedIssueId, null);
  assert.equal(conflict.unresolved[0].originalIssueId, 103);
});
