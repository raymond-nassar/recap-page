import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertRelationshipReportExtension, authorizeOwnerGuide, emitOwnerGuide, emitOwnerGuideIdentityUpdate,
  OWNER_PROVIDER, ownerApprovalRequest,
  ownerGuideDisplayGroups, parseOwnerMarkdown, prepareOwnerGuide, prepareOwnerGuideIdentityUpdate, updatedOwnerChecklist,
  verifyOwnerMetadataCache,
} from '../scripts/lib/owner-guide.mjs';
import { approvalDigestFor, validateFrozenPacket, validatePacketProposal } from '../scripts/lib/cbh-inventory.mjs';
import { assertOwnerDeliveryContract } from './helpers/owner-delivery-contract.mjs';
import { ownerPresentation } from '../scripts/browser-owner-guide.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { mcuEditorial } from '../scripts/lib/mcu-editorial.mjs';
import { beforeIdentityText } from './helpers/owner-identity-history.mjs';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const withoutChecklistIndex = (entry) => Object.fromEntries(
  Object.entries(entry).filter(([key]) => key !== 'index'),
);
const REPOSITORY_ROOT = fileURLToPath(new URL('../', import.meta.url));

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

test('identity checklist insertion retains the existing Brand New Day group qualifiers', async () => {
  const id = 'mcu-prep-spider-man-brand-new-day';
  const source = await readJson(path.join(REPOSITORY_ROOT, 'scripts', 'data', 'owner-selections', `${id}.json`));
  const mapping = JSON.parse(beforeIdentityText(`scripts/data/owner-mappings/${id}.json`));
  const markdown = beforeIdentityText(`src/data/orders/${id}.md`);
  const displayGroups = ownerGuideDisplayGroups(markdown, mapping);
  assert.equal(displayGroups.get('Amazing Spider-Man: Brand New Day Vol. 1'),
    'Amazing Spider-Man: Brand New Day Vol. 1 (whole Swing Shift original; Venom material gap)');
  const identity = {
    sourcePosition: 14,
    selectedIssueId: 59715,
    resolvedIssueTitle: 'Venom Super Special (1995) #1',
    marvelIssueUrl: 'https://www.marvel.com/comics/issue/59715/venom_super_special_1995_1',
    sourceRangeReference: 'Amazing Spider-Man: Brand New Day Vol. 1',
    identityEvidenceKind: 'owner-confirmed-identity',
  };
  const nextMapping = {
    ...mapping,
    sourceGaps: mapping.sourceGaps.filter((gap) => gap.sourcePosition !== identity.sourcePosition),
    rows: [...mapping.rows, identity].sort((left, right) => left.sourcePosition - right.sourcePosition),
  };
  const updated = updatedOwnerChecklist(markdown, source, mapping, nextMapping);
  const beforeEntries = parseChecklist(markdown).entries;
  const afterEntries = parseChecklist(updated).entries;
  const withoutPosition = (entries) => entries
    .filter((entry) => Number(entry.sourceKey) !== identity.sourcePosition)
    .map(withoutChecklistIndex);
  assert.deepEqual(withoutPosition(afterEntries), withoutPosition(beforeEntries));
  assert.equal(afterEntries.find((entry) => Number(entry.sourceKey) === identity.sourcePosition).section,
    'Amazing Spider-Man: Brand New Day Vol. 1 (whole Swing Shift original; Venom material gap)');
  assert.ok(updated.includes('Amazing Spider-Man: Brand New Day Vol. 1 (whole Swing Shift original; Venom material gap)'));
  assert.ok(updated.includes('Amazing Spider-Man by Nick Spencer Vol. 1: Back to Basics (whole FCBD original; Spider-Man material)'));
  assert.ok(updated.includes('This checklist publishes 20 exactly resolved originals in owner order.'));
  assert.ok(!updated.includes('This checklist publishes nineteen exactly resolved originals in owner order.'));
  assert.ok(updated.includes('is now included by owner-confirmed identity under [Issue #707]'));
  assert.ok(!updated.includes('is intentionally not a checkbox'));
});

test('published Thunderbolts identity preserves the exact #-1 source and rejects substitutions', async () => {
  const [source, mapping, payload] = await Promise.all([
    readJson(path.join(REPOSITORY_ROOT, 'scripts', 'data', 'mcu-prep-thunderbolts-source.json')),
    readJson(path.join(REPOSITORY_ROOT, 'scripts', 'data', 'owner-mappings', 'mcu-prep-thunderbolts.json')),
    readJson(path.join(REPOSITORY_ROOT, 'src', 'data', 'mcu_prep_thunderbolts.json')),
  ]);
  const row = mapping.rows.find((entry) => entry.sourcePosition === 6);
  const item = payload.items.find((entry) => entry.issueId === 62424);
  assert.equal(row.sourceIssueReference, 'Thunderbolts (1997) #-1');
  assert.equal(row.identityEvidenceKind, 'owner-confirmed-identity');
  assert.equal(item.title, 'Thunderbolts (1997) #-1');
  assert.equal(item.number, '-1');
  assert.equal(item.url, 'https://www.marvel.com/comics/issue/62424/thunderbolts_1997_1');
  assert.equal(item.seriesId, null);
  assert.equal(item.seriesName, null);
  assert.equal(item.onSale, null);
  assert.equal(item.mu, null);
  assert.equal(item.digitalId, null);
  assert.equal(item.cover, null);
  assert.equal(item.detailsRefused, true);
  assert.equal(mapping.rows.some((entry) => entry.sourcePosition === 6 && entry.selectedIssueId === 15311), false);

  const { assertThunderboltsMismatchSource } = await import('../scripts/lib/owner-guide.mjs');
  assert.doesNotThrow(() => assertThunderboltsMismatchSource(source));
  const missingRecord = structuredClone(source);
  missingRecord.gaps[0].rejectedRelabelings = missingRecord.gaps[0].rejectedRelabelings
    .filter((entry) => entry.issueId !== 62424);
  assert.throws(() => assertThunderboltsMismatchSource(missingRecord));
  const changedRecord = structuredClone(source);
  changedRecord.gaps[0].rejectedRelabelings
    .find((entry) => entry.issueId === 62424).digitalId = 3162;
  assert.throws(() => assertThunderboltsMismatchSource(changedRecord));
});

test('Thunderbolts identity checklist update replaces only its stale gap and count copy', async () => {
  const id = 'mcu-prep-thunderbolts';
  const source = await readJson(path.join(REPOSITORY_ROOT, 'scripts', 'data', `${id}-source.json`));
  const mapping = await readJson(path.join(REPOSITORY_ROOT, 'scripts', 'data', 'owner-mappings', `${id}.json`));
  const markdown = beforeIdentityText(`src/data/orders/${id}.md`);
  const currentMarkdown = await readFile(path.join(REPOSITORY_ROOT, 'src', 'data', 'orders', `${id}.md`), 'utf8');
  const previousMapping = {
    ...mapping,
    rows: mapping.rows.filter((row) => row.identityEvidenceKind !== 'owner-confirmed-identity'),
  };
  const updated = updatedOwnerChecklist(markdown, source, previousMapping, mapping);
  const beforeEntries = parseChecklist(markdown).entries;
  const afterEntries = parseChecklist(updated).entries;
  assert.deepEqual(updated, currentMarkdown.replace(/\r\n/g, '\n'));
  assert.deepEqual(afterEntries.filter((entry) => Number(entry.sourceKey) !== 6)
    .map(withoutChecklistIndex), beforeEntries.map(withoutChecklistIndex));
  assert.match(updated, /Thunderbolts \(1997\) #-1, source position 6, is now included by owner-confirmed identity/);
  assert.match(updated, /Its provider record identifies #1, not #-1, so no provider metadata or availability is inferred\./);
  assert.match(updated, /The checklist publishes all 35 resolved originals/);
  assert.doesNotMatch(updated, /remains unresolved under|other 34 originals/);
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

// #898. The owner's young readers' picks are whole runs filed beside other character runs, and one
// of them ends in two chapters the metadata titles without a number. Each position names its exact
// original, so the two are told apart by their pinned identities and never by a guessed number.
test('young readers\' picks file as owner-credited character runs and keep pinned unnumbered originals apart', async (t) => {
  const { root, request, cache } = await setup(t, '# Young readers\n\n- Sample Comic (2020), starting issue #1\n');
  for (const id of [103, 104]) {
    const url = `https://marvel.emreparker.com/v1/issues/${id}`;
    const body = {
      id, title: 'Sample Comic (2020)', issueNumber: '0', seriesId: 900, seriesName: 'Sample Comic (2020)',
      detailUrl: `https://www.marvel.com/comics/issue/${id}/`, digitalId: id + 1000, cover: null,
    };
    await writeFile(path.join(request.metadataCache, `${hash(url)}.json`), json({
      url, urlSha256: hash(url), fetchedAt: '2026-10-07T01:00:00Z', status: 200,
      body, bodySha256: hash(JSON.stringify(body)),
    }));
  }
  await cache(105, 3, 404);
  const input = parseOwnerMarkdown(await readFile(request.markdownFile, 'utf8'))[0];
  const row = (number, candidateIssueId) => ({
    sourceIssueReference: `Sample Comic (2020) #${number}`, normalizedSeriesTitle: 'Sample Comic',
    seriesYear: 2020, issueNumber: String(number), seriesId: 900, manualSeriesSelectionApproved: false,
    ...(candidateIssueId ? { candidateIssueId } : {}),
  });
  Object.assign(request, {
    surface: 'young-readers', metadataIssueIds: [101, 102, 103, 104, 105],
    selections: [{
      inputPosition: 1, inputSha256: input.inputSha256, group: null,
      interpretation: 'The whole series, from its first issue',
      evidenceSources: [{ url: 'https://example.org/series-listing', retrievedAt: '2026-10-07' }],
      rows: [row(1, 101), row(2, 102), {
        ...row(3), gap: {
          kind: 'published-metadata-gap', status: 'open', checkedAt: '2026-10-07',
          auditBasis: 'Synthetic exact metadata request returned 404; the original remains selected.',
          evidenceSources: [
            { kind: 'metadata', url: 'https://marvel.emreparker.com/v1/issues/105', retrievedAt: '2026-10-07' },
            { kind: 'tracking', url: 'https://github.com/raymond-nassar/recap-page/issues/1001', retrievedAt: '2026-10-07' },
          ],
        },
      }, row(0), row(0)],
    }],
  });
  const unpinned = await prepareOwnerGuide(request, { root });
  assert.equal(unpinned.status, 'needs-resolution');
  assert.deepEqual(unpinned.unresolved.map((entry) => [entry.sourcePosition, entry.resolutionStatus]),
    [[4, 'ambiguous'], [5, 'ambiguous']]);

  request.selections[0].rows.splice(3, 2, row(0, 104), row(0, 103));
  const proposal = await prepareOwnerGuide(request, { root });
  assert.equal(proposal.status, 'awaiting-review');
  assert.equal(proposal.surface, 'young-readers');
  assert.deepEqual(proposal.artifacts.mapping.rows.map((entry) => [entry.sourcePosition, entry.selectedIssueId]),
    [[1, 101], [2, 102], [4, 104], [5, 103]]);
  const manifest = proposal.artifacts.packet.proposedManifest;
  assert.deepEqual([manifest.type, manifest.spotlightKind, manifest.audience, manifest.depth,
    manifest.beginner, manifest.timeline, manifest.sourceOrigin, manifest.expect], [
    'character-run', 'other', 'young-readers', 'partial', true, null, 'Selected by the project owner', 4,
  ]);
  assert.equal(proposal.artifacts.source.surface, 'young-readers');
  assert.equal(proposal.artifacts.source.sourceCredit, 'Selected by the project owner');

  const emitted = await emitOwnerGuide(proposal, actualReview(proposal), { root });
  assert.equal(emitted.rows, 4);
  const registry = await readJson(path.join(root, 'scripts', 'data', 'owner-deliveries.json'));
  assert.deepEqual(registry.guides, [{ id: request.id, contract: proposal.paths.contract, surface: 'young-readers' }]);
  const contract = await readJson(path.join(root, proposal.paths.contract));
  assert.deepEqual([contract.surface, contract.sourceOrigin], ['young-readers', 'Selected by the project owner']);
  assert.deepEqual(contract.rows.map((entry) => entry.slice(0, 3)), [
    [1, 101, 'Sample Comic (2020) #1'], [2, 102, 'Sample Comic (2020) #2'],
    [4, 104, 'Sample Comic (2020)'], [5, 103, 'Sample Comic (2020)'],
  ]);
  const markdown = await readFile(path.join(root, proposal.paths.markdown), 'utf8');
  assert.match(markdown, /^Selected by the project owner\. /m);
  assert.deepEqual(parseChecklist(markdown).entries.map((entry) => entry.issueId), [101, 102, 104, 103]);

  await assert.rejects(() => prepareOwnerGuide({ ...request, surface: 'kids' }, { root }), /young-readers, or absent/);
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

test('review regression: plus bullets retain every original and source selection', async (t) => {
  const { root, request } = await setup(t);
  for (const markers of [['-', '+'], ['+', '-'], ['+', '+']]) {
    const markdown = `# Selections\n\n${markers[0]} Sample Comic (2020) #1\n${markers[1]} Sample Comic (2020) #2\n`;
    await writeFile(request.markdownFile, markdown);
    const proposal = await prepareOwnerGuide(request, { root });
    assert.equal(proposal.status, 'awaiting-review');
    assert.equal(proposal.artifacts.source.sourceIssueCount, 2);
    assert.deepEqual(proposal.artifacts.mapping.rows.map((row) => row.selectedIssueId), [101, 102]);
    assert.deepEqual(proposal.artifacts.source.selections.map((row) => row.inputPosition), [1, 2]);
  }
});

test('review regression: nested and unsupported indentation never becomes a flat selection', () => {
  for (const marker of ['-', '*', '+', '1.']) {
    for (const indent of ['  ', '    ', '\t']) {
      assert.throws(() => parseOwnerMarkdown(`- Sample Comic (2020) #1\n${indent}${marker} Sample Comic (2020) #2\n`),
        /Nested|indent/);
    }
  }
  assert.equal(parseOwnerMarkdown('  + Sample Comic (2020) #1\n  + Sample Comic (2020) #2\n').length, 2);
});

test('review regression: repeated missing originals preserve canonical gap references and each group', async (t) => {
  const { root, request, cache } = await setup(t, '# Selections\n\n1. First trade\n2. Second trade\n');
  await cache(104, 3, 404);
  request.metadataIssueIds.push(104);
  const inputs = parseOwnerMarkdown(await readFile(request.markdownFile, 'utf8'));
  const gap = {
    kind: 'published-metadata-gap', status: 'open', checkedAt: '2026-10-07',
    auditBasis: 'Synthetic exact metadata request returned 404.',
    evidenceSources: [
      { kind: 'metadata', url: 'https://marvel.emreparker.com/v1/issues/104', retrievedAt: '2026-10-07' },
      { kind: 'tracking', url: 'https://github.com/raymond-nassar/recap-page/issues/1001', retrievedAt: '2026-10-07' },
    ],
  };
  request.selections = inputs.map((input, index) => ({
    inputPosition: input.inputPosition, inputSha256: input.inputSha256,
    group: index === 0 ? 'Volume One' : 'Volume Two',
    evidenceSources: [{ url: 'https://example.org/selected-scope', retrievedAt: '2026-10-07' }],
    rows: (index === 0 ? [1, 3] : [3, 2]).map((number) => ({
      sourceIssueReference: `Sample Comic (2020) #${number}`, normalizedSeriesTitle: 'Sample Comic',
      seriesYear: 2020, issueNumber: String(number), ...(number === 3 ? { gap: structuredClone(gap) } : {}),
    })),
  }));
  const proposal = await prepareOwnerGuide(request, { root });
  assert.equal(proposal.status, 'awaiting-review');
  assert.deepEqual(proposal.sourceCounts, {
    sourceOccurrenceCount: 4, sourceIdentityCount: 3, includedIssueCount: 2,
    sourceGapCount: 1, repeatedSourceReferenceCount: 1,
  });
  assert.deepEqual(proposal.artifacts.packet.sourceGaps.map((row) => row.sourcePosition), [2]);
  assert.deepEqual(proposal.artifacts.packet.repeatedSourceReferences, [{
    sourcePosition: 3, canonicalGapPosition: 2, sourceIssueReference: 'Sample Comic (2020) #3',
    sourceRangeReference: 'Volume Two', normalizedSeriesTitle: 'Sample Comic', seriesYear: 2020, issueNumber: '3',
  }]);
  assert.deepEqual(proposal.artifacts.source.sourceGapOccurrences.map((row) => [row.sourcePosition, row.sourceGroup]),
    [[2, 'Volume One'], [3, 'Volume Two']]);
  const authored = await authorizeOwnerGuide(proposal, actualReview(proposal), { root });
  assert.deepEqual(authored.contract.rows.map((row) => row.slice(0, 2)), [[1, 101], [4, 102]]);
  request.selections[1].group = null;
  const ungrouped = await prepareOwnerGuide(request, { root });
  assert.equal(ungrouped.artifacts.packet.repeatedSourceReferences[0].sourceRangeReference, null);
  assert.equal(Object.hasOwn(ungrouped.artifacts.source.sourceGapOccurrences[1], 'sourceGroup'), false);
  request.selections[1].rows[0].gap.kind = 'availability-exclusion';
  request.selections[1].rows[0].gap.status = 'closed';
  await assert.rejects(() => prepareOwnerGuide(request, { root }), /conflicting gap dispositions/);
});

test('review regression: mixed collection presentation does not rewrite null stored groups', () => {
  const stored = [
    { issueId: 101, group: null }, { issueId: 102, group: 'Volume One' },
    { issueId: 103, group: null }, { issueId: 104, group: 'Volume One' },
  ];
  const before = structuredClone(stored);
  assert.deepEqual(ownerPresentation(stored), {
    rows: [{ issueId: 101, group: null }, { issueId: 102, group: 'Volume One' },
      { issueId: 103, group: 'Individual issues' }, { issueId: 104, group: 'Volume One' }],
    headings: ['Volume One', 'Individual issues', 'Volume One'],
  });
  assert.deepEqual(stored, before);
  assert.deepEqual(ownerPresentation([{ group: null }, { group: null }]),
    { rows: [{ group: null }, { group: null }], headings: [] });
  assert.deepEqual(ownerPresentation([{ group: 'Individual issues' }, { group: null }]).headings,
    ['Individual issues', 'Individual issues']);
});

for (const replaceDescription of [false, true]) {
  test(`owner-confirmed identity preparation preserves editorial copy or binds its replacement (${replaceDescription})`, async (t) => {
    const root = await mkdtemp(path.join(tmpdir(), 'owner-identity-guide-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    await Promise.all([
      cp(path.join(REPOSITORY_ROOT, 'src', 'data'), path.join(root, 'src', 'data'), { recursive: true }),
      cp(path.join(REPOSITORY_ROOT, 'scripts', 'data'), path.join(root, 'scripts', 'data'), { recursive: true }),
      cp(path.join(REPOSITORY_ROOT, 'test', 'fixtures', 'owner-delivery'),
        path.join(root, 'test', 'fixtures', 'owner-delivery'), { recursive: true }),
    ]);
    const fixtureId = 'mcu-prep-the-incredible-hulk-2008';
    for (const file of [
      `scripts/data/owner-packets/${fixtureId}.json`,
      `scripts/data/owner-mappings/${fixtureId}.json`,
      `scripts/data/owner-overlaps/${fixtureId}.json`,
      `test/fixtures/owner-delivery/${fixtureId}.json`,
      `src/data/orders/${fixtureId}.md`,
      'src/data/mcu_prep_the_incredible_hulk_2008.json',
      'src/data/curated-lists.json', 'src/data/catalog.json',
    ]) await writeFile(path.join(root, file), beforeIdentityText(file));
    const manifestFile = path.join(root, 'src', 'data', 'curated-lists.json');
    const originalManifest = await readJson(manifestFile);
    const liveDescription = originalManifest.lists.find(({ id }) =>
      id === 'mcu-prep-the-incredible-hulk-2008').description;
    const originalContract = await readJson(path.join(root,
      'test/fixtures/owner-delivery/mcu-prep-the-incredible-hulk-2008.json'));
    const request = {
      schemaVersion: 1,
      id: 'mcu-prep-the-incredible-hulk-2008',
      generatedAt: '2026-10-22T12:00:00.000Z',
      ...(replaceDescription
        ? { description: 'An owner-confirmed original with provider details still unavailable.' } : {}),
      identities: [{
        sourcePosition: 1,
        issueId: 999999,
        label: 'Hulk: Season One (2012)',
        url: 'https://www.marvel.com/comics/issue/999999/hulk_season_one_2012',
        confirmingActor: 'raymond-nassar',
        confirmedAt: '2026-10-21',
        confirmationSource: 'https://github.com/raymond-nassar/recap-page/issues/1000#issuecomment-1000',
        confirmationRetrievedAt: '2026-10-22',
        providerStatus: 404,
        provider404At: '2026-10-21',
      }],
    };
    const markdownFile = path.join(root, 'src', 'data', 'orders', 'mcu-prep-the-incredible-hulk-2008.md');
    const originalMarkdown = await readFile(markdownFile, 'utf8');
    const annotatedMarkdown = originalMarkdown.replace(
      'See [data provenance]',
      'This source-specific note must survive identity publication.\nSee [data provenance]',
    );
    await writeFile(markdownFile, annotatedMarkdown);
    const proposal = await prepareOwnerGuideIdentityUpdate(request, { root });
    assert.equal(proposal.status, 'awaiting-owner-approval');
    assert.deepEqual(proposal.review.identities, [{
      sourcePosition: 1,
      issueId: 999999,
      label: 'Hulk: Season One (2012)',
      url: request.identities[0].url,
    }]);
    assert.deepEqual(proposal.review.exactDuplicates, []);
    assert.ok(!proposal.review.relationshipChanges.some(({ orderId, after }) =>
      orderId === mcuEditorial.withdrawal.manifestEntry.id && after !== null));
    assert.ok(proposal.outputs.every((output) => /^[a-f0-9]{64}$/.test(output.sha256)));

    const catalogFile = path.join(root, 'src', 'data', 'catalog.json');
    const originalCatalog = await readFile(catalogFile, 'utf8');
    const catalog = await readJson(catalogFile);
    catalog.generatedAt = '2026-10-22T12:01:00.000Z';
    await writeFile(catalogFile, json(catalog));
    await assert.rejects(() => emitOwnerGuideIdentityUpdate(proposal, {
      schemaVersion: 1,
      proposalDigest: proposal.proposalDigest,
      authorityType: 'human',
      authorityIdentity: 'raymond-nassar',
      rationale: 'Synthetic owner approval for stale-input rejection.',
      reviewedAt: '2026-10-22T12:00:00.000Z',
    }, { root }), /Registered guide inputs or outputs changed after identity update approval/);

    await assert.rejects(() => prepareOwnerGuideIdentityUpdate({
      ...request,
      identities: [{ ...request.identities[0], providerStatus: 200 }],
    }, { root }), /Only the confirmed Thunderbolts #-1 source record permits an HTTP 200 identity mismatch/);
    await assert.rejects(() => prepareOwnerGuideIdentityUpdate({
      ...request, description: 'Invalid\nmultiline copy',
    }, { root }), /reviewed description/);
    await writeFile(catalogFile, originalCatalog);
    const freshProposal = await prepareOwnerGuideIdentityUpdate(request, { root });
    await emitOwnerGuideIdentityUpdate(freshProposal, {
      schemaVersion: 1,
      proposalDigest: freshProposal.proposalDigest,
      authorityType: 'human',
      authorityIdentity: 'raymond-nassar',
      rationale: 'Synthetic owner approval for identity-only guide publication.',
      reviewedAt: '2026-10-22T12:00:00.000Z',
    }, { root });
    const updatedMarkdown = await readFile(markdownFile, 'utf8');
    assert.match(updatedMarkdown, /Selected by raymond-nassar for MCU Prep/);
    assert.match(updatedMarkdown, /This source-specific note must survive identity publication\./);
    assert.match(updatedMarkdown, /1 owner-confirmed identity has no provider details or cover\./);
    assert.ok(updatedMarkdown.indexOf('## Hulk: Season One') < updatedMarkdown.indexOf('## Hulk: Gray'));
    assert.match(updatedMarkdown,
      /Hulk: Season One \(2012\) <!-- mrt:source-occurrence=1 --> <!-- mrt:identity-evidence=owner-confirmed-identity -->/);
    assert.equal((await readJson(path.join(root, 'src/data/mcu_prep_the_incredible_hulk_2008.json')))
      .description, request.description ?? liveDescription);
    assert.equal((await readJson(path.join(root,
      'test/fixtures/owner-delivery/mcu-prep-the-incredible-hulk-2008.json')))
      .description, request.description ?? originalContract.description);
    const updatedManifest = await readJson(manifestFile);
    assert.equal(updatedManifest.lists.find(({ id }) => id === request.id).description,
      request.description ?? liveDescription);
    assert.ok(!updatedManifest.lists.some(({ id }) => id === mcuEditorial.withdrawal.manifestEntry.id));
    const updatedCatalog = await readJson(catalogFile);
    assert.equal(updatedCatalog.lists.find(({ id }) => id === request.id).description,
      request.description ?? liveDescription);
    assert.ok(!updatedCatalog.lists.some(({ id }) => id === mcuEditorial.withdrawal.manifestEntry.id));
    assert.equal((await readJson(path.join(root, 'scripts/data/owner-packets', `${request.id}.json`)))
      .proposedManifest.description, request.description ?? originalContract.description);
  });
}

test('identity checklist insertion keeps interleaved existing originals in exact source order', () => {
  const row = (sourcePosition, confirmed = false) => ({
    sourcePosition, selectedIssueId: 1000 + sourcePosition, sourceRangeReference: 'Same group',
    resolvedIssueTitle: `Sample (2020) #${sourcePosition}`,
    marvelIssueUrl: `https://www.marvel.com/comics/issue/${1000 + sourcePosition}/sample`,
    ...(confirmed ? { identityEvidenceKind: 'owner-confirmed-identity' } : {}),
  });

  const previous = { rows: [row(2), row(7), row(9)] };
  const mapping = { rows: [row(2), row(3, true), row(4, true), row(5, true),
    row(6, true), row(7), row(8, true), row(9)] };
  const markdown = '# Sample\n\nSource: owner selection.\nSelected by owner.\n\n## Same group\n\n'
    + previous.rows.map((entry) =>
      `- [ ] [${entry.resolvedIssueTitle} <!-- mrt:source-occurrence=${entry.sourcePosition} -->](${entry.marvelIssueUrl})\n`).join('');
  const parsed = parseChecklist(updatedOwnerChecklist(markdown, { rows: [] }, previous, mapping));
  assert.deepEqual(parsed.unresolved, []);
  assert.deepEqual(parsed.entries.map(({ sourceKey }) => Number(sourceKey)), [2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(parsed.entries.map(({ issueId }) => issueId), mapping.rows.map(({ selectedIssueId }) => selectedIssueId));
  assert.ok(parsed.entries.every(({ section }) => section === 'Same group'));
});

test('Agatha accepts only the recorded reciprocal Contest of Chaos prelude authority', async () => {
  const jsonAt = (file) => readJson(path.join(REPOSITORY_ROOT, file));
  const later = {
    registeredId: 'contest-of-chaos',
    contract: await jsonAt('test/fixtures/owner-delivery/contest-of-chaos.json'),
    mapping: await jsonAt('scripts/data/owner-mappings/contest-of-chaos.json'),
    report: await jsonAt('scripts/data/owner-overlaps/contest-of-chaos.json'),
  };
  const previous = { candidateId: 'mcu-prep-agatha-all-along', comparisons: [] };
  const overlap = { orderId: 'contest-of-chaos', sharedCount: 1, sharedIds: ['109670'], relationship: 'partial' };
  const current = { ...previous, comparisons: [overlap] };
  assert.doesNotThrow(() => assertRelationshipReportExtension(previous, current, [later]));
  assert.throws(() => assertRelationshipReportExtension(previous, current), /registered reciprocal review/);
  assert.throws(() => assertRelationshipReportExtension(previous, {
    ...current, comparisons: [{ ...overlap, sharedIds: ['999999'] }],
  }, [later]));
  assert.throws(() => assertRelationshipReportExtension({ ...previous, candidateId: 'another-guide' }, {
    ...current, candidateId: 'another-guide',
  }, [later]));
  assert.throws(() => assertRelationshipReportExtension(previous, current, [{
    ...later, registeredId: 'unregistered-guide',
  }]), /registered reciprocal review/);
  const stale = structuredClone(later);
  stale.contract.approvalDigest = '0'.repeat(64);
  assert.throws(() => assertRelationshipReportExtension(previous, current, [stale]));
  const staleMapping = structuredClone(later);
  staleMapping.mapping.mappingDigest = '0'.repeat(64);
  assert.throws(() => assertRelationshipReportExtension(previous, current, [staleMapping]));
  const staleReport = structuredClone(later);
  staleReport.report.reportDigest = '0'.repeat(64);
  assert.throws(() => assertRelationshipReportExtension(previous, current, [staleReport]));
  const staleApproval = structuredClone(later);
  staleApproval.mapping.relationshipReview.approvalDigest = '0'.repeat(64);
  assert.throws(() => assertRelationshipReportExtension(previous, current, [staleApproval]));
  const rejected = structuredClone(later);
  rejected.mapping.relationshipReview.dispositions.find(({ orderId }) =>
    orderId === previous.candidateId).decision = 'rejected';
  rejected.mapping.relationshipReview.approvalDigest = approvalDigestFor(rejected.mapping.relationshipReview);
  rejected.contract.approvalDigest = rejected.mapping.relationshipReview.approvalDigest;
  assert.throws(() => assertRelationshipReportExtension(previous, current, [rejected]));
});

// #981: Professor X is a Comic Book Herald guide, not an owner registration, and shares the five
// New Avengers: Illuminati issues with Namor. Its own approved review is the reciprocal authority.
test('Namor accepts a later Comic Book Herald guide only through its exact approved reciprocal review', async () => {
  const jsonAt = (file) => readJson(path.join(REPOSITORY_ROOT, file));
  const later = {
    registeredId: 'professor-x-reading-order',
    mapping: await jsonAt('scripts/data/cbh-mappings/professor-x-reading-order.json'),
    report: await jsonAt('scripts/data/cbh-overlaps/professor-x-reading-order.json'),
  };
  const previous = { candidateId: 'namor-sub-mariner-reading-order', comparisons: [] };
  const overlap = {
    orderId: 'professor-x-reading-order', sharedCount: 5,
    sharedIds: ['5723', '5864', '13481', '15968', '17254'], relationship: 'partial',
  };
  const current = { ...previous, comparisons: [overlap] };
  assert.doesNotThrow(() => assertRelationshipReportExtension(previous, current, [], [later]));
  assert.throws(() => assertRelationshipReportExtension(previous, current), /registered reciprocal review/);
  assert.throws(() => assertRelationshipReportExtension(previous, current, [], [{
    ...later, registeredId: 'unregistered-guide',
  }]), /registered reciprocal review/);
  assert.throws(() => assertRelationshipReportExtension(previous, {
    ...current, comparisons: [{ ...overlap, sharedIds: ['5723', '5864', '13481', '15968', '999999'] }],
  }, [], [later]));
  assert.throws(() => assertRelationshipReportExtension(previous, {
    ...current, comparisons: [{ ...overlap, relationship: 'existing-subset' }],
  }, [], [later]));
  assert.throws(() => assertRelationshipReportExtension({ ...previous, candidateId: 'another-guide' }, {
    ...current, candidateId: 'another-guide',
  }, [], [later]), /must include this earlier guide/);
  const staleMapping = structuredClone(later);
  staleMapping.mapping.mappingDigest = '0'.repeat(64);
  assert.throws(() => assertRelationshipReportExtension(previous, current, [], [staleMapping]));
  const staleReport = structuredClone(later);
  staleReport.report.reportDigest = '0'.repeat(64);
  assert.throws(() => assertRelationshipReportExtension(previous, current, [], [staleReport]));
  const staleApproval = structuredClone(later);
  staleApproval.mapping.relationshipReview.approvalDigest = '0'.repeat(64);
  assert.throws(() => assertRelationshipReportExtension(previous, current, [], [staleApproval]));
  for (const change of [{ decision: 'rejected' }, { authorityType: 'policy' }]) {
    const weakened = structuredClone(later);
    Object.assign(weakened.mapping.relationshipReview.dispositions.find(({ orderId }) =>
      orderId === previous.candidateId), change);
    weakened.mapping.relationshipReview.approvalDigest = approvalDigestFor(weakened.mapping.relationshipReview);
    assert.throws(() => assertRelationshipReportExtension(previous, current, [], [weakened]));
  }
});
