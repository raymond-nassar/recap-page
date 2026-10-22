import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { CBH_OWNER_BASELINE_IDS } from '../scripts/register-cbh-owner-baselines.mjs';
import { prepareOwnerGuideIdentityUpdate } from '../scripts/lib/owner-guide.mjs';
import { readOwnerGuideRegistry } from '../scripts/lib/owner-guide-registry.mjs';
import { assertCbhBaselinePayload } from '../scripts/lib/owner-cbh-baseline.mjs';
import { hasDedicatedCbhOwnerScenario } from '../scripts/browser-owner-guide.mjs';

const read = (file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8');
const json = async (file) => JSON.parse(await read(file));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const textHash = async (file) => hash((await read(file)).replace(/\r\n/g, '\n'));
const historicalText = (commit, file) => execFileSync('git', ['show', `${commit}:${file}`], {
  encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
}).replace(/\r\n/g, '\n');

for (const [index, id] of CBH_OWNER_BASELINE_IDS.entries()) {
  test(`${id}: synthetic owner confirmation reaches a no-write proposal and preserves every other published row`, async () => {
    const contract = await json(`test/fixtures/owner-delivery/${id}.json`);
    const mapping = await json(`scripts/data/owner-mappings/${id}.json`);
    const gap = mapping.sourceGaps.find((row) => row.issueNumber != null && Number.isInteger(row.seriesYear));
    assert.ok(gap, 'The dry run needs an existing numbered gap with a recorded year.');
    const issueId = 990000000 + index;
    const label = `${gap.normalizedSeriesTitle} (${gap.seriesYear}) #${gap.issueNumber}`;
    const url = `https://www.marvel.com/comics/issue/${issueId}/synthetic_test_only`;
    const manifest = await json('src/data/curated-lists.json');
    const entry = manifest.lists.find((row) => row.id === id);
    const payloadFile = `src/data/${entry.out}`;
    const payload = await json(payloadFile);
    const protectedFiles = [
      'src/data/catalog.json', 'src/data/curated-lists.json', ...Object.keys(contract.cbhBaseline.files),
      `scripts/data/owner-selections/${id}.json`, `scripts/data/owner-packets/${id}.json`,
      `scripts/data/owner-mappings/${id}.json`, `scripts/data/owner-overlaps/${id}.json`,
      `test/fixtures/owner-delivery/${id}.json`,
    ];
    const before = await Promise.all(protectedFiles.map(textHash));
    const generatedAt = '2026-10-22T20:00:00.000Z';
    const proposal = await prepareOwnerGuideIdentityUpdate({
      schemaVersion: 1, id, generatedAt,
      identities: [{
        sourcePosition: gap.sourcePosition, issueId, label, url,
        confirmingActor: 'raymond-nassar', confirmedAt: '2026-10-22',
        confirmationSource: 'https://github.com/raymond-nassar/recap-page/issues/1000#issuecomment-1000',
        confirmationRetrievedAt: '2026-10-22', providerStatus: 404, provider404At: '2026-10-22',
      }],
    });
    assert.equal(proposal.status, 'awaiting-owner-approval');
    assert.equal(proposal.outputs.length, 8);
    assert.deepEqual(proposal.review.exactDuplicates, []);
    assert.equal(proposal.review.identities[0].issueId, issueId);
    const rowIndex = contract.rows.findIndex((row) => row[0] === gap.sourcePosition);
    const existing = payload.items[rowIndex];
    const nextItems = payload.items.map((item, at) => at !== rowIndex ? item : ({
      issueId, title: label, number: String(gap.issueNumber), url,
      seriesId: null, seriesName: null, onSale: null, mu: null, digitalId: null,
      cover: null, description: null, pageCount: null, creators: [],
      detailsRefused: true, identityEvidenceKind: 'owner-confirmed-identity',
      ...(existing.collectedIn ? { collectedIn: existing.collectedIn } : {}),
    }));
    const expected = {
      ...payload, generatedAt, items: nextItems, count: nextItems.length,
      placeholders: payload.placeholders - 1,
      unresolved: payload.unresolved.filter((row) => Number(row.sourceKey) !== gap.sourcePosition),
      collections: new Set(nextItems.map((item) => item.collectedIn).filter(Boolean)).size,
    };
    assert.equal(proposal.outputs.find((output) => output.path === payloadFile).sha256,
      hash(`${JSON.stringify(expected, null, 2)}\n`),
      'Only the confirmed placeholder may change; every other original, qualifier and placeholder must survive.');
    assert.equal(proposal.outputs.find((output) => output.path === 'src/data/curated-lists.json').sha256,
      hash(`${JSON.stringify(manifest, null, 2)}\n`),
      'A confirmation preserves the published manifest, including later storylines metadata.');
    const markdownFile = `src/data/orders/${id}.md`;
    const expectedMarkdown = (await read(markdownFile)).replace(/\r\n/g, '\n').split('\n')
      .map((line) => line.includes(`<!-- mrt:source-occurrence=${gap.sourcePosition} -->`)
        ? `- [ ] [${label} <!-- mrt:source-occurrence=${gap.sourcePosition} --> <!-- mrt:identity-evidence=owner-confirmed-identity -->](${url})`
        : line).join('\n');
    assert.equal(proposal.outputs.find((output) => output.path === markdownFile).sha256, hash(expectedMarkdown),
      'Only the confirmed gap checkbox changes; every qualifier and unconfirmed gap line remains.');
    assert.deepEqual(await Promise.all(protectedFiles.map(textHash)), before,
      'Dry-run preparation must not write any captured input or shipped output.');
  });
}

test('the five CBH owner registrations preserve exact historical captures and every unmodified shipped row', async () => {
  const registry = await json('scripts/data/owner-deliveries.json');
  for (const id of CBH_OWNER_BASELINE_IDS) {
    const contractFile = `test/fixtures/owner-delivery/${id}.json`;
    const contract = await json(contractFile);
    assert.deepEqual(registry.guides.find((row) => row.id === id), {
      id, contract: contractFile, baselineRowCount: contract.rows.length, sourceProvider: 'comic-book-herald',
    });
    const payloadFile = Object.keys(contract.cbhBaseline.files).find((file) =>
      file.startsWith('src/data/') && file.endsWith('.json'));
    const markdownFile = `src/data/orders/${id}.md`;
    const payload = await json(payloadFile);
    const original = JSON.parse(historicalText(contract.cbhBaseline.sourceCommit, payloadFile));
    const mapping = await json(`scripts/data/owner-mappings/${id}.json`);
    const additions = new Map(mapping.rows.filter((row) =>
      row.identityEvidenceKind === 'owner-confirmed-identity').map((row) => [row.sourcePosition, row]));
    assert.equal(payload.items.length, original.items.length);
    const inverseItems = payload.items.map((item, index) => {
      const position = contract.rows[index][0];
      const addition = additions.get(position);
      if (!addition) return item;
      assert.equal(original.items[index].placeholder, true);
      assert.equal(item.issueId, addition.selectedIssueId);
      assert.equal(item.url, addition.marvelIssueUrl);
      assert.equal(item.identityEvidenceKind, 'owner-confirmed-identity');
      return original.items[index];
    });
    assert.deepEqual(inverseItems, original.items, 'Only confirmed placeholder positions may differ.');
    const originalMarkdown = historicalText(contract.cbhBaseline.sourceCommit, markdownFile);
    const originalLines = new Map(originalMarkdown.split('\n').flatMap((line) => {
      const position = /<!-- mrt:source-occurrence=(\d+) -->/.exec(line);
      return position ? [[Number(position[1]), line]] : [];
    }));
    const inverseMarkdown = (await read(markdownFile)).replace(/\r\n/g, '\n').split('\n').map((line) => {
      const position = /<!-- mrt:source-occurrence=(\d+) -->/.exec(line);
      return position && additions.has(Number(position[1])) ? originalLines.get(Number(position[1])) : line;
    }).join('\n');
    assert.equal(inverseMarkdown, originalMarkdown, 'Every unmodified checklist line must survive.');
    assertCbhBaselinePayload(contract, mapping, payload, await read(markdownFile));
    for (const [file, expected] of Object.entries(contract.cbhBaseline.files)) {
      assert.equal(hash(historicalText(contract.cbhBaseline.sourceCommit, file)), expected, file);
      if (file !== payloadFile && file !== markdownFile) assert.equal(await textHash(file), expected, file);
    }
    const packet = await json(`scripts/data/cbh-packets/${id}.json`);
    const originalMapping = await json(`scripts/data/cbh-mappings/${id}.json`);
    const report = await json(`scripts/data/cbh-overlaps/${id}.json`);
    assert.deepEqual([
      packet.packetDigest, originalMapping.mappingDigest, report.reportDigest, originalMapping.relationshipReview.approvalDigest,
    ], [
      contract.cbhBaseline.packetDigest, contract.cbhBaseline.mappingDigest,
      contract.cbhBaseline.reportDigest, contract.cbhBaseline.approvalDigest,
    ]);
  }
});

test('CBH compatibility rejects non-baseline registrations and altered gap coordinates or groups', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'cbh-owner-registry-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dir = path.join(root, 'scripts', 'data');
  await mkdir(dir, { recursive: true });
  const file = path.join(dir, 'owner-deliveries.json');
  const id = CBH_OWNER_BASELINE_IDS[0];
  const registry = { schemaVersion: 1, guides: [{
    id, contract: `test/fixtures/owner-delivery/${id}.json`, sourceProvider: 'comic-book-herald',
  }] };
  await writeFile(file, JSON.stringify(registry));
  assert.throws(() => readOwnerGuideRegistry(root), /invalid or duplicate guide/);
  registry.guides[0].baselineRowCount = 298;
  await writeFile(file, JSON.stringify(registry));
  assert.deepEqual(readOwnerGuideRegistry(root), registry);
  registry.guides[0].sourceProvider = 'unreviewed-source';
  await writeFile(file, JSON.stringify(registry));
  assert.throws(() => readOwnerGuideRegistry(root), /invalid or duplicate guide/);
  const contract = await json(`test/fixtures/owner-delivery/${id}.json`);
  const mapping = await json(`scripts/data/owner-mappings/${id}.json`);
  const payload = await json(`src/data/${id.replaceAll('-', '_')}.json`);
  const markdown = await read(`src/data/orders/${id}.md`);
  const index = payload.items.findIndex((item) => item.placeholder);
  const moved = structuredClone(contract);
  moved.rows[index][0] += 1;
  assert.throws(() => assertCbhBaselinePayload(moved, mapping, payload, markdown), /checklist positions/);
  const regrouped = structuredClone(payload);
  regrouped.items[index].collectedIn = 'Unreviewed collection';
  assert.throws(() => assertCbhBaselinePayload(contract, mapping, regrouped, markdown));
});

test('registered CBH guides retain dedicated browser coverage rather than inheriting MCU placement', () => {
  const scenarios = [
    'shang-chi-actual-data', 'age-of-apocalypse-actual-data', 'onslaught-actual-data',
    'iron-fist-actual-data', 'namor-actual-data',
  ];
  for (const [index, id] of CBH_OWNER_BASELINE_IDS.entries()) {
    const registration = { id, sourceProvider: 'comic-book-herald' };
    assert.equal(hasDedicatedCbhOwnerScenario(registration, scenarios), true);
    assert.throws(() => hasDedicatedCbhOwnerScenario(registration,
      scenarios.filter((scenario) => scenario !== scenarios[index])), /dedicated actual-data browser scenario/);
  }
  assert.equal(hasDedicatedCbhOwnerScenario({ id: 'mcu-prep-thunderbolts' }, []), false);
  assert.throws(() => hasDedicatedCbhOwnerScenario({
    id: 'unreviewed-cbh-baseline', sourceProvider: 'comic-book-herald',
  }, scenarios), /dedicated actual-data browser scenario/);
});
