import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { addIssuesToList, createEmptyState, createList, markRead, setIssueNote } from '../src/js/lib/model.js';
import { KEY, Store } from '../src/js/storage.js';
import { buildComparisonReport } from '../scripts/lib/cbh-overlap.mjs';
import { loadCurrentOwnerLibrary } from '../scripts/lib/owner-current-library.mjs';
import {
  beforeTieInChecklist, beforeTieInPayload, tieInChecklistAtApproval, tieInManifestAtApproval, tieInOrdersAtApproval,
  tieInPayloadAtApproval, tieInRevisions,
} from './helpers/mcu-tie-in-history.mjs';
import { beforeIdentityJson } from './helpers/owner-identity-history.mjs';
import { reviewed2025Pairs } from './helpers/reviewed-2025-viewer-links.mjs';

const read = (file) => JSON.parse(readFileSync(new URL(`../src/data/${file}`, import.meta.url), 'utf8'));
const digest = (ids) => createHash('sha256').update(JSON.stringify(ids)).digest('hex');
const heading = 'Official MCU tie-ins';

// Written out independently of the revision record, so editing the record and a payload together
// to admit another comic still fails. Each row is the complete original vector's length and digest
// on the baseline, then the exact additions in reading order.
const expected = [
  ['mcu-prep-iron-man-2008', 16, '87753dfe488390f94792aa96a87aa13ccb2f6290999fdcdef84b044f82a3e761', [29613, 29967]],
  ['mcu-prep-the-incredible-hulk-2008', 13, 'c13d46166e995897c8158af06ae74f6ccce6cb69ab0d2accabc85999359139ad', [63378]],
  ['mcu-prep-iron-man-2-2010', 29, 'c9ccc10a14367f280eb694fd1e3e3aba86b29709479c81bc1cb91559c62ab7ce',
    [32406, 32408, 32410, 36442, 44053, 45164]],
  ['mcu-prep-thor-2011', 14, '201243e084283e9d8e88dcabb42d9fe882296ee04682b81d3b3005c9656a59c3', [46303, 46304]],
  ['mcu-prep-captain-america-the-first-avenger-2011', 4,
    '16d7b1d828171fff3df06f6c019a90a42a3dc392885e56a100bc8d253f132912', [48313, 48314]],
  ['mcu-prep-the-avengers-2012', 15, '06f2965f57c106415a26c7ed259f9e3ff9001530fafc2a7b1eed2adef5880bc5',
    [43003, 43004, 43005, 52202, 52203]],
  ['mcu-prep-iron-man-3-2013', 24, '3347c7173e402d3e07518cdc7addb2bb0a72d842ffc60dbf32d9809c09113382',
    [42669, 42670, 57724, 57725]],
  ['mcu-prep-thor-the-dark-world-2013', 14, '74e6ad572a2f9fc653a8cfbc0d55916660916de5b2fc47ea6cac48ea086a2b30',
    [42667, 42668, 63981, 64212]],
  ['mcu-prep-captain-america-the-winter-soldier-2014', 18,
    'c8fb14222049e6ef98dbf81bc83841f4e79135868edaee751cca8bfb2a4bce80', [58287, 58211]],
  ['mcu-prep-ant-man-2015', 22, '943d7177f237f7c71d9800a5bae9f4c5d5bcf6c78ddfc9d6b0eeef0c69e4c8ad',
    [52196, 52198, 66444, 66693]],
  ['mcu-prep-captain-america-civil-war-2016', 23, '6c3bfa09b684b729337efa6869e406224191ece3bd79416636f6bd6db5ee4868',
    [61300, 61301, 65916]],
  ['mcu-prep-black-panther-2018', 54, '378fdc66c136947fcfd8c1b733ca0722d8030632dcfebccd3067094f8808d64d', [64930, 65084]],
  ['mcu-prep-avengers-infinity-war-endgame', 19, '6733138250cdd482d3d34ed27c6983082ae8743a36b477106887df3280dd04f2',
    [65916, 66287, 71574, 71575, 74050]],
  ['mcu-prep-doctor-strange-2016', 18, '144021e3ba9416216cae87bce3578045828c5b02b56aa228a997d5c1c3809243', [57945, 57947]],
  ['mcu-prep-guardians-of-the-galaxy', 28, '46ce28e9a41a3dd2b7a9eafbee240e5ac14b50e05becd6586963b387cee55760',
    [49059, 49060, 60666, 60667]],
];

test('tie-in additions extend fifteen MCU Prep guides as an unchanged prefix plus the exact recorded suffix', () => {
  assert.equal(tieInRevisions.baselineCommit, 'ad0360073ed8d2c16f6736e5813f6655c984c30d');
  assert.equal(tieInRevisions.heading, heading);
  assert.deepEqual(tieInRevisions.credit, {
    before: 'Selected by raymond-nassar for MCU Prep',
    after: 'Reading list selected by Recap Page team',
  });
  assert.deepEqual(tieInRevisions.guides.map(({ id, originalCount, originalIssueIdsSha256, additionIssueIds }) =>
    [id, originalCount, originalIssueIdsSha256, additionIssueIds]), expected);
  for (const [id, originalCount, originalDigest, additions] of expected) {
    const revision = tieInRevisions.guides.find((guide) => guide.id === id);
    const payload = read(revision.file);
    const ids = payload.items.map(({ issueId }) => issueId);
    assert.equal(digest(ids.slice(0, originalCount)), originalDigest, id);
    assert.deepEqual(ids.slice(originalCount), additions, id);
    assert.equal(new Set(ids).size, ids.length, `${id} lists a comic twice`);
    assert.ok(payload.items.slice(0, originalCount).every(({ collectedIn }) => collectedIn !== heading));
    assert.equal(payload.sourceOrigin, tieInRevisions.credit.after, id);
    assert.equal(beforeTieInPayload(payload, revision).sourceOrigin, tieInRevisions.credit.before, id);
  }
  assert.equal(expected.flatMap(([, , , additions]) => additions).length, 48);
});

test('pinned historical approvals permit browser startup without Git history', (t) => {
  const registry = beforeIdentityJson('scripts/data/owner-deliveries.json', tieInRevisions.baselineCommit);
  const original = Object.fromEntries(registry.guides.map(({ id, contract }) => {
    const approval = beforeIdentityJson(contract, tieInRevisions.baselineCommit);
    assert.equal(approval.id, id);
    assert.match(approval.approvalDigest, /^[a-f0-9]{64}$/);
    return [id, approval.approvalDigest];
  }));
  assert.deepEqual(tieInRevisions.preExtensionApprovalDigests, original);

  const objects = mkdtempSync(join(tmpdir(), 'mrt-tie-in-objects-'));
  t.after(() => rmSync(objects, { recursive: true, force: true }));
  const env = {
    ...process.env, GIT_OBJECT_DIRECTORY: objects, GIT_ALTERNATE_OBJECT_DIRECTORIES: '',
  };
  const cwd = fileURLToPath(new URL('..', import.meta.url));
  const probe = spawnSync('git', ['cat-file', '-e', tieInRevisions.baselineCommit], { cwd, env, encoding: 'utf8' });
  assert.equal(probe.error, undefined);
  assert.notEqual(probe.status, 0, 'The fixture must not have access to the historical commit.');
  const run = spawnSync(process.execPath, ['scripts/browser-check.mjs', '--diagnostic=not-a-mode'], {
    cwd, env, encoding: 'utf8', timeout: 60000,
  });
  assert.equal(run.error, undefined);
  // Both the old eager cutoff and an argument refusal exit 1. Only the refusal is printed after every
  // scenario has registered, so it must be the whole of stderr and the baseline must go unnamed.
  assert.equal(run.status, 1, run.stderr);
  assert.ok(!run.stderr.includes(tieInRevisions.baselineCommit), run.stderr);
  assert.equal(run.stderr.trim(), 'FAIL diagnostic=context-export-isolation stage=arguments');
});

test('current Civil War and Infinity War guides both retain the reviewed shared issue', async () => {
  const civilId = 'mcu-prep-captain-america-civil-war-2016';
  const infinityId = 'mcu-prep-avengers-infinity-war-endgame';
  const { manifest, orders } = await loadCurrentOwnerLibrary('__tie-in-current-review__');
  const civil = orders.find(({ orderId }) => orderId === civilId);
  const infinity = orders.find(({ orderId }) => orderId === infinityId);
  const civilPayload = read('mcu_prep_captain_america_civil_war_2016.json');
  const infinityPayload = read('mcu_prep_avengers_infinity_war_endgame.json');
  assert.deepEqual(civilPayload.items.find(({ issueId }) => issueId === 65916),
    infinityPayload.items.find(({ issueId }) => issueId === 65916));
  assert.deepEqual(
    (({ digitalId, mu }) => ({ digitalId, mu }))(civilPayload.items.find(({ issueId }) => issueId === 65916)),
    { digitalId: 47122, mu: '2018-07-30T00:00:00+0000' },
  );
  assert.equal(civil.issueIds.filter((id) => Number(id) === 65916).length, 1);
  assert.equal(infinity.issueIds.filter((id) => Number(id) === 65916).length, 1);
  for (const [candidate, payload, peer] of [
    [civil, civilPayload, infinity], [infinity, infinityPayload, civil],
  ]) {
    const contract = JSON.parse(readFileSync(
      new URL(`./fixtures/owner-delivery/${candidate.orderId}.json`, import.meta.url), 'utf8',
    ));
    const markdown = readFileSync(new URL(`../src/data/orders/${candidate.orderId}.md`, import.meta.url), 'utf8');
    assert.ok(!tieInPayloadAtApproval(payload, contract).items.some(({ issueId }) => issueId === 65916));
    assert.ok(!tieInOrdersAtApproval([peer], contract)[0].issueIds.some((id) => Number(id) === 65916));
    assert.ok(!tieInChecklistAtApproval(candidate.orderId, markdown, contract).includes('/65916/'));
    const oldManifest = tieInManifestAtApproval(manifest, contract);
    for (const [id, originalCount] of expected) {
      const old = oldManifest.lists.find((entry) => entry.id === id);
      assert.equal(old.expect, originalCount, id);
      assert.equal(old.sourceOrigin, tieInRevisions.credit.before, id);
    }
    for (const currentApproval of [null, { ...contract, approvalDigest: 'f'.repeat(64) }]) {
      const currentPayload = tieInPayloadAtApproval(payload, currentApproval);
      const currentPeer = tieInOrdersAtApproval([peer], currentApproval);
      assert.strictEqual(tieInManifestAtApproval(manifest, currentApproval), manifest);
      for (const [id, originalCount, , additions] of expected) {
        const entry = manifest.lists.find((item) => item.id === id);
        assert.equal(entry.expect, originalCount + additions.length, id);
        assert.equal(entry.sourceOrigin, tieInRevisions.credit.after, id);
      }
      assert.equal(currentPayload.items.filter(({ issueId }) => issueId === 65916).length, 1);
      assert.equal(currentPeer[0].issueIds.filter((id) => Number(id) === 65916).length, 1);
      assert.ok(tieInChecklistAtApproval(candidate.orderId, markdown, currentApproval).includes('/65916/'));
      const [comparison] = buildComparisonReport({
        candidateIds: currentPayload.items.map(({ issueId }) => issueId), orders: currentPeer,
      }).comparisons;
      assert.equal(comparison.relationship, 'partial');
      assert.equal(comparison.sharedCount, 1);
      assert.deepEqual(comparison.sharedIds, ['65916']);
    }
  }
});

test('historical expectations refuse a changed count or payload identity', () => {
  const contract = JSON.parse(readFileSync(
    new URL('./fixtures/owner-delivery/mcu-prep-captain-america-civil-war-2016.json', import.meta.url), 'utf8',
  ));
  const manifest = read('curated-lists.json');
  for (const change of [
    (entry) => { entry.expect--; },
    (entry) => { entry.out = 'another_payload.json'; },
  ]) {
    const modified = structuredClone(manifest);
    change(modified.lists.find((entry) => entry.id === contract.id));
    assert.throws(() => tieInManifestAtApproval(modified, contract));
    assert.strictEqual(tieInManifestAtApproval(modified, null), modified);
  }
});

test('First Vengeance keeps its four places in the First Avenger guide and is not added again', () => {
  const ids = read('mcu_prep_captain_america_the_first_avenger_2011.json').items.map(({ issueId }) => issueId);
  assert.deepEqual(ids.slice(0, 4), [38423, 38428, 38825, 38824]);
  assert.deepEqual(ids.slice(4), [48313, 48314]);
});

test('tie-in reader links keep the exact matched viewers and preserve every earlier approval', () => {
  const links = JSON.parse(readFileSync(new URL('../scripts/data/marvel-comics-app-links/links.json', import.meta.url), 'utf8'));
  const mu = JSON.parse(readFileSync(new URL('../scripts/data/marvel-comics-app-links/mu-issues.json', import.meta.url), 'utf8'));
  const additions = new Set(expected.flatMap(([, , , ids]) => ids));
  const selected = links.links.filter(({ issueId }) => additions.has(issueId));
  assert.deepEqual(selected.map(({ issueId, viewer }) => [issueId, viewer]), [
    [29613, 14402], [29967, 14407], [32406, 14605], [32408, 14609], [32410, 14613],
    [36442, 15123], [42669, 17018], [42670, 17019], [43003, 16475], [43004, 16476],
    [43005, 16481], [44053, 16750], [45164, 16748], [46303, 17089], [46304, 36670],
    [48313, 17468], [48314, 17471], [49059, 17804], [49060, 17802], [52196, 12305],
    [52198, 12307], [52202, 12199], [52203, 12207], [57724, 27973], [57725, 27975],
    [57945, 28413], [57947, 28418], [58211, 27978], [58287, 27979], [61300, 28905],
    [61301, 28907], [63378, 29325], [63981, 29327], [64212, 29328], [64930, 29468],
    [65084, 29476], [65916, 29563], [66287, 29564], [66444, 29611], [66693, 29615],
    [71574, 30260], [71575, 30261], [74050, 30263],
  ]);
  assert.ok(selected.every(({ basis, source }) =>
    basis === 'exact' && source === 'continuity-guide-discord-2026-11-19'));
  // The X-Men era delivery added these three links independently; keeping them out of the frozen
  // set lets the digest still prove that no earlier link moved under either change.
  const xmenEra = new Map([[12363, 6891], [19872, 19401], [23510, 19719]]);
  assert.ok([...xmenEra].every(([issueId, viewer]) => !additions.has(issueId)
    && links.links.some((link) => link.issueId === issueId && link.viewer === viewer)));
  const reviewed2025 = new Map(reviewed2025Pairs);
  assert.equal(digest(reviewed2025Pairs), 'c37466b019ec7ee51a0612db07e74db0f3873a0c4eeabb10f47c06f3f2a883f5');
  assert.ok([...reviewed2025.keys()].every((issueId) => !additions.has(issueId) && !xmenEra.has(issueId)));
  assert.deepEqual(links.links.filter(({ issueId }) => reviewed2025.has(issueId)),
    reviewed2025Pairs.map(([issueId, viewer]) => ({
      issueId, viewer, basis: 'exact', source: 'continuity-guide-discord-2026-11-19',
    })));
  const reviewedViewers = new Set(reviewed2025.values());
  assert.ok(links.links.every(({ issueId, viewer }) => reviewed2025.has(issueId) || !reviewedViewers.has(viewer)));
  // Combined-branch correction: the Wolverine guide correction added these 18 reviewed viewers
  // independently of the 2025 links. Written out rather than read from its ledger, so the frozen
  // digest below still proves that no earlier link moved under either change.
  const wolverine18 = new Map([
    [16114, 9350], [16144, 21447], [16507, 21448], [16508, 21449], [17243, 21450], [17379, 21451],
    [17619, 21452], [20664, 21456], [20859, 21454], [20994, 21455], [21206, 21453], [21350, 21459],
    [21531, 21457], [21962, 21458], [22284, 21460], [22492, 21462], [22896, 21463], [23103, 21461],
  ]);
  assert.ok([...wolverine18].every(([issueId, viewer]) => !additions.has(issueId) && !xmenEra.has(issueId)
    && !reviewed2025.has(issueId) && links.links.filter((link) => link.issueId === issueId).length === 1
    && links.links.some((link) => link.issueId === issueId && link.viewer === viewer
      && link.basis === 'exact' && link.source === 'continuity-guide-discord-2026-11-19')));
  const fcbd = 52986;
  assert.ok(!additions.has(fcbd) && !xmenEra.has(fcbd) && !reviewed2025.has(fcbd) && !wolverine18.has(fcbd));
  assert.deepEqual(links.links.filter(({ issueId, viewer }) => issueId === fcbd || viewer === 12467), [{
    issueId: fcbd, viewer: 12467, basis: 'exact', source: 'continuity-guide-discord-2026-11-19',
  }]);
  const modernTimeline189 = new Set([
    5242, 5544, 5666, 5804, 5967, 6002, 6030, 6111, 6129, 6192, 6267,
    6290, 6340, 13431, 13433, 13475, 15813, 15814, 15854, 15879, 15889, 15931,
    15964, 15988, 15999, 16006, 16149, 16173, 16174, 16183, 16189, 16569, 16570,
    16596, 16597, 17653, 20665, 20698, 20860, 20890, 20995, 21022, 21023, 21207,
    21237, 21351, 21379, 21532, 21556, 21731, 21751, 21752, 21963, 21987, 22286,
    22311, 22312, 22493, 22516, 22898, 22923, 22924, 23104, 23121, 23599, 23615,
    23760, 23958, 24158, 25289, 25290, 25291, 25292, 25293, 25294, 51198, 51199,
    51200, 51201, 51208, 51211, 51212, 51213, 51214, 51538, 51539, 51573, 51574,
    51575, 51576, 51579, 51580, 51712, 51714, 51715, 51716, 51802, 51803, 51804,
    51808, 51810, 51811, 51812, 51835, 51837, 51838, 51839, 51840, 51935, 51936,
    51937, 51938, 51939, 51947, 51948, 51949, 51950, 51961, 51971, 51972, 51973,
    51974, 51975, 51994, 51996, 51997, 51998, 51999, 52055, 52056, 52057, 52058,
    52059, 52072, 52074, 52075, 52076, 52240, 52241, 52242, 52243, 52303, 52307,
    52308, 52309, 52327, 52328, 52329, 52330, 52333, 52335, 52336, 52337, 52338,
    52486, 52487, 52488, 52489, 52575, 52578, 52579, 52580, 52593, 52595, 52596,
    52597, 52824, 52825, 52826, 52827, 52891, 52892, 52893, 52894, 52968, 52971,
    52972, 52973, 52974, 53702, 53704, 53705, 53706, 54775, 54777, 54778, 55847,
    56004, 57531,
  ]);
  const modernLinks = links.links.filter(({ issueId }) => modernTimeline189.has(issueId));
  assert.equal(modernLinks.length, 189);
  assert.equal(digest(modernLinks.map(({ issueId, viewer }) => [issueId, viewer])),
    '9806b905fe4c769b52845adc9b872c8a040d314538931ca7a99948498590bd72');
  assert.ok(modernLinks.every(({ issueId, basis, source }) => !additions.has(issueId) && !xmenEra.has(issueId)
    && !reviewed2025.has(issueId) && !wolverine18.has(issueId) && issueId !== fcbd
    && basis === 'exact' && source === 'continuity-guide-discord-2026-11-19'));
  const empyreViewers = new Map([[82353, 32598], [88625, 32628], [88626, 32630], [88627, 32631], [88648, 32637]]);
  const empyreLinks = links.links.filter(({ issueId }) => empyreViewers.has(issueId));
  assert.deepEqual(empyreLinks, [...empyreViewers].map(([issueId, viewer]) => ({
    issueId, viewer, basis: 'exact', source: 'continuity-guide-discord-2026-11-19',
  })));
  const previous = links.links.filter(({ issueId }) => !additions.has(issueId) && !xmenEra.has(issueId)
    && !reviewed2025.has(issueId) && !wolverine18.has(issueId) && issueId !== fcbd
    && !modernTimeline189.has(issueId) && !empyreViewers.has(issueId));
  assert.equal(previous.length, 17663);
  assert.equal(digest(previous), '0bec147ce327f7287cd5d6a02f6c303295a5f51c78da9f43a9a3be6e981d219f');
  const { unapprovedIssueIds, ...frozenMu } = mu;
  // Only these reviewed comics moved from MU to direct viewers; reconstruct the earlier approval
  // rather than replacing its digest with one that could hide an unrelated edit.
  assert.equal(new Set(mu.issueIds).size, mu.issueIds.length);
  assert.deepEqual(mu.issueIds, [...mu.issueIds].sort((a, b) => a - b));
  assert.ok(mu.issueIds.every((issueId) => !reviewed2025.has(issueId) && issueId !== fcbd));
  const previousMu = {
    ...frozenMu, issueIds: [...mu.issueIds, ...reviewed2025.keys(), fcbd].sort((a, b) => a - b),
  };
  assert.equal(digest(previousMu), '9fc9fe6d314b2786e16c6b6772e0104091efaa6defd59142b91f5521388e4e55');
  const installmentRows = read('catalog.json').lists.filter(({ id }) =>
    id === 'world-war-hulk' || id === 'secret-wars-2015-event-tie-ins' || /^civil-war-to-secret-invasion-part-\d+$/.test(id))
    .flatMap(({ file }) => read(file).items);
  const installmentIds = new Set(installmentRows.map(({ issueId }) => issueId));
  const modernPending = unapprovedIssueIds.filter((id) => installmentIds.has(id));
  assert.equal(digest(modernPending), 'cc476d8503549aa3411db8603c92dba8a122ba5fa08c65a2ba1c017fa8499725');
  const empyrePending = new Set([
    77220, 85304, 86495, 86496, 86497, 87440, 88624, 88628, 88629, 88630, 88631, 88667,
  ]);
  const empyreIds = new Set(read('empyre.json').items.map(({ issueId }) => issueId));
  assert.deepEqual(unapprovedIssueIds.filter((id) => empyreIds.has(id)), [...empyrePending]);
  assert.ok([...empyrePending].every((id) => !mu.issueIds.includes(id) && !empyreViewers.has(id)));
  assert.deepEqual(unapprovedIssueIds.filter((id) => !installmentIds.has(id) && !empyrePending.has(id)), [
    17293, 42667, 42668, 51951, 51955, 55498, 55499, 60666, 60667, 62843, 101513, 101520, 129237,
  ]);
  const held = installmentRows.filter(({ findOnly }) => findOnly === true);
  assert.deepEqual(held.map(({ issueId }) => issueId).sort((a, b) => a - b), [
    51403, 51405, 51406, 51407, 51408, 51855, 51856, 51857, 51858, 52466, 52467, 52964, 52965,
    52966, 52967, 52977, 52978, 52979, 52980, 53633, 53634, 53635, 56003, 56306, 56326,
  ]);
  const linked = new Set([...links.links.map(({ issueId }) => issueId), ...mu.issueIds]);
  assert.ok(held.every(({ issueId, url }) => url === null && !linked.has(issueId) && modernPending.includes(issueId)));
  for (const id of [42667, 42668, 60666, 60667]) {
    assert.ok(!links.links.some(({ issueId }) => issueId === id));
    assert.ok(!mu.issueIds.includes(id));
  }
});

test('existing saved MCU lists and shared reading progress survive the new catalog copies', () => {
  for (const revision of tieInRevisions.guides) {
    const payload = read(revision.file);
    const original = beforeTieInPayload(payload, revision);
    const curated = (items) => items.map((item) => ({ ...item, source: 'curated' }));
    let state = createList(createEmptyState(), { id: 'saved', name: payload.name, catalogId: revision.id });
    state = addIssuesToList(state, 'saved', curated(original.items)).state;
    state = createList(state, { id: 'other', name: 'Another list' });
    const shared = payload.items[revision.originalCount];
    state = addIssuesToList(state, 'other', curated([shared])).state;
    state = markRead(state, original.items[0].issueId, true, 123456);
    state = markRead(state, shared.issueId, true, 123457);
    state = setIssueNote(state, original.items[0].issueId, 'Keep my place');
    state = setIssueNote(state, shared.issueId, 'Already read');
    const values = new Map([[KEY, JSON.stringify(state)]]);
    const storage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    };
    const store = new Store({ storage });
    const initialBytes = storage.getItem(KEY);
    const loaded = store.load();
    assert.equal(storage.getItem(KEY), initialBytes, `${revision.id}: load must not rewrite saved data`);
    const saved = structuredClone(loaded.lists.saved);
    const progress = structuredClone(loaded.read);
    const notes = structuredClone(loaded.notes);
    const expectedIds = [...original.items.map(({ issueId }) => issueId), ...revision.additionIssueIds];
    const importCopy = (input, items, listId) => addIssuesToList(
      createList(input, { id: listId, name: payload.name, catalogId: revision.id }), listId, curated(items),
    ).state;
    const oldOnly = importCopy(loaded, original.items, 'baseline-only');
    assert.throws(() => assert.deepEqual(oldOnly.lists['baseline-only'].itemIds, expectedIds),
      undefined, `${revision.id}: the pre-extension copy must not satisfy the completed vector`);
    store.update((current) => importCopy(current, payload.items, 'new-copy'));
    assert.equal(store.lastUpdateOk, true, revision.id);
    const reloaded = new Store({ storage }).load();
    assert.deepEqual(reloaded.lists.saved, saved, revision.id);
    assert.deepEqual(reloaded.read, progress, revision.id);
    assert.deepEqual(reloaded.notes, notes, revision.id);
    assert.deepEqual(reloaded.lists['new-copy'].itemIds, expectedIds, revision.id);
    for (const id of revision.additionIssueIds) {
      assert.equal(reloaded.lists['new-copy'].collectedIn[id], heading, revision.id);
    }
  }
});

test('the tie-in inverse refuses an omitted, extra, reordered or altered comic', () => {
  const revision = tieInRevisions.guides.find(({ id }) => id === 'mcu-prep-the-avengers-2012');
  const payload = read(revision.file);
  const changed = (edit) => {
    const copy = structuredClone(payload);
    edit(copy);
    return copy;
  };
  assert.doesNotThrow(() => beforeTieInPayload(payload, revision));
  assert.throws(() => beforeTieInPayload(changed((copy) => {
    copy.items.pop();
    copy.count--;
  }), revision));
  assert.throws(() => beforeTieInPayload(changed((copy) => {
    copy.items.push({ ...copy.items.at(-1), issueId: 1 });
    copy.count++;
  }), revision));
  assert.throws(() => beforeTieInPayload(changed((copy) => {
    const tail = copy.items.splice(-2);
    copy.items.push(tail[1], tail[0]);
  }), revision));
  assert.throws(() => beforeTieInPayload(changed((copy) => {
    [copy.items[0], copy.items[1]] = [copy.items[1], copy.items[0]];
  }), revision));
  assert.throws(() => beforeTieInPayload(changed((copy) => {
    copy.items[3].title = `${copy.items[3].title} (edited)`;
  }), revision));
  assert.throws(() => beforeTieInPayload(changed((copy) => {
    copy.items.at(-1).collectedIn = 'Another heading';
  }), revision));
  assert.throws(() => beforeTieInPayload(changed((copy) => {
    copy.sourceOrigin = tieInRevisions.credit.before;
  }), revision), /current credit/);
});

// Vendoring rebuilds each payload from its checklist, so the additions must live there too or the
// next vendor run would quietly drop them. The old checklist must survive as an exact text prefix.
test('each checklist keeps its original text and lists exactly the payload additions under the heading', () => {
  const lf = (value) => value.replace(/\r\n/g, '\n');
  const manifest = read('curated-lists.json').lists;
  for (const [id, originalCount, , additions] of expected) {
    const { sourceFile } = manifest.find((entry) => entry.id === id);
    const current = lf(readFileSync(new URL(`../src/data/orders/${sourceFile}`, import.meta.url), 'utf8'));
    const original = lf(execFileSync('git', ['show', `${tieInRevisions.baselineCommit}:src/data/orders/${sourceFile}`],
      { encoding: 'utf8' }));
    assert.ok(current.startsWith(original.trimEnd()), `${id}: the original checklist text must be unchanged`);
    const { entries, unresolved } = parseChecklist(current);
    assert.deepEqual(unresolved, []);
    assert.deepEqual(parseChecklist(original).entries, entries.slice(0, originalCount), id);
    assert.deepEqual(entries.slice(originalCount).map(({ issueId, section }) => [Number(issueId), section]),
      additions.map((issueId) => [issueId, heading]), id);
    const payload = read(tieInRevisions.guides.find((guide) => guide.id === id).file);
    assert.deepEqual(entries.map(({ issueId }) => Number(issueId)), payload.items.map(({ issueId }) => issueId), id);
  }
});

test('the checklist inverse refuses an extra, missing, reordered or altered line', () => {
  const id = 'mcu-prep-the-avengers-2012';
  const markdown = readFileSync(new URL(`../src/data/orders/${id}.md`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
  const lines = markdown.trimEnd().split('\n');
  const extra = lines.at(-1).replace('52203', '52204');
  assert.doesNotThrow(() => beforeTieInChecklist(id, markdown));
  assert.throws(() => beforeTieInChecklist(id, `${markdown}${extra}\n`));
  assert.throws(() => beforeTieInChecklist(id, `${lines.slice(0, -1).join('\n')}\n`));
  assert.throws(() => beforeTieInChecklist(id, `${[...lines.slice(0, -2), lines.at(-1), lines.at(-2)].join('\n')}\n`));
  const first = lines.findIndex((line) => line.startsWith('- [ ]'));
  assert.throws(() => beforeTieInChecklist(id, markdown.replace(lines[first], lines[first].replace('- [ ]', '- [x]'))));
  assert.throws(() => beforeTieInChecklist(id, markdown.replace('## Official MCU tie-ins', '## Tie-ins')));
});

test('browser owner scenarios expect the complete current guide, including exact tie-in additions', async () => {
  const { ownerGuideExpectedRows, ownerGuideSavedCopyItems } = await import('../scripts/browser-owner-guide.mjs');
  assert.equal(typeof ownerGuideExpectedRows, 'function');
  for (const [id, originalCount, , additions] of expected) {
    const revision = tieInRevisions.guides.find((guide) => guide.id === id);
    const contract = JSON.parse(readFileSync(new URL(`./fixtures/owner-delivery/${id}.json`, import.meta.url), 'utf8'));
    const payload = read(revision.file);
    const rows = ownerGuideExpectedRows(contract, payload);
    assert.deepEqual(rows.map(({ issueId }) => issueId), payload.items.map(({ issueId }) => issueId), id);
    assert.deepEqual(rows.slice(originalCount).map(({ issueId }) => issueId), additions, id);
    assert.ok(rows.slice(originalCount).every(({ group }) => group === heading), id);
    assert.deepEqual(ownerGuideSavedCopyItems(payload, contract).map(({ issueId }) => issueId),
      payload.items.slice(0, originalCount)
        .filter((item) => item.identityEvidenceKind !== 'owner-confirmed-identity')
        .map(({ issueId }) => issueId), id);
    const changed = structuredClone(payload);
    changed.items.push(structuredClone(changed.items.at(-1)));
    assert.throws(() => ownerGuideExpectedRows(contract, changed), /tie-in additions/, id);
    const future = { ...contract, approvalDigest: 'f'.repeat(64) };
    assert.throws(() => ownerGuideExpectedRows(future, payload), /current guide/, id);
    const futureGroup = future.groups.length;
    future.groups = [...future.groups, heading];
    future.rows = [
      ...future.rows,
      ...payload.items.slice(originalCount).map((item, index) =>
        [originalCount + index + 1, item.issueId, item.title, futureGroup]),
    ];
    assert.deepEqual(ownerGuideExpectedRows(future, payload), rows, id);
    assert.deepEqual(ownerGuideSavedCopyItems(payload, future),
      payload.items.filter((item) => item.identityEvidenceKind !== 'owner-confirmed-identity'), id);
  }
});
