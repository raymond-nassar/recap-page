import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseChecklist, serializeReadingOrder } from '../src/js/lib/markdown.js';
import { launchUrl } from '../src/js/reader.js';
import { sourceCountsForPacket } from '../scripts/lib/cbh-inventory.mjs';
import { registeredOwnerContracts } from './helpers/current-reading-library.mjs';

const json = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const ids = [
  'mcu-prep-captain-america-civil-war-2016', 'mcu-prep-thor-ragnarok-2017',
  'mcu-prep-black-panther-2018', 'mcu-prep-avengers-infinity-war-endgame',
  'mcu-prep-captain-marvel-2019', 'mcu-prep-doctor-strange-2016',
];
const digests = [
  '6c3bfa09b684b729337efa6869e406224191ece3bd79416636f6bd6db5ee4868',
  '68c73e0545adc3bfe05d876c6e865b605c767991d10853dfd493715ea4c05358',
  '378fdc66c136947fcfd8c1b733ca0722d8030632dcfebccd3067094f8808d64d',
  '6733138250cdd482d3d34ed27c6983082ae8743a36b477106887df3280dd04f2',
  '1726eff1660db09b4bd542c633cf0b813bb3a6d98d4b2f59280b2d408c86d1df',
  '1776bc809ac57dfafc9a73882550be1cbb114fd5ebe60505bb2c78e8d1f240de',
];
const counts = [23, 30, 54, 19, 24, 16];
const supplied = [23, 30, 54, 19, 24, 18];
const blocks = [[7, 3, 3, 4, 6], [1, 9, 6, 14], [6, 13, 17, 12, 6], [5, 2, 6, 6], [9, 6, 5, 4], [1, 5, 5, 6, 1]];
const source = (id) => json(`scripts/data/owner-selections/${id}.json`);
const packet = (id) => json(`scripts/data/owner-packets/${id}.json`);
const payload = (id) => json(`src/data/${id.replaceAll('-', '_')}.json`);

test('six Phase Three guides retain independent exact vectors and all168 source positions', () => {
  const totals = { included: 0, gap: 0 };
  for (const [index, id] of ids.entries()) {
    const contract = registeredOwnerContracts.filter((row) => row.id === id);
    assert.equal(contract.length, 1);
    const data = payload(id);
    assert.equal(data.items.length, counts[index]);
    assert.equal(createHash('sha256').update(JSON.stringify(data.items.map((row) => row.issueId))).digest('hex'), digests[index]);
    const ledger = source(id);
    const frozen = packet(id);
    assert.equal(ledger.inputReceipt.sourceKind, 'pasted-message-snapshot');
    assert.equal(ledger.inputReceipt.originalFileSha256, null);
    assert.equal(ledger.inputReceipt.originalFileBytes, null);
    assert.notEqual(ledger.inputReceipt.snapshotSha256, ledger.projectionReceipt.sha256);
    assert.deepEqual(ledger.rows.map((row) => row.sourcePosition), Array.from({ length: supplied[index] }, (_, n) => n + 1));
    assert.equal(sourceCountsForPacket(frozen).sourceOccurrenceCount, supplied[index]);
    assert.deepEqual(ledger.rows.filter((row) => row.disposition === 'included').map((row) => row.selectedIssueId),
      data.items.map((row) => row.issueId));
    const groups = [];
    for (const row of ledger.rows) {
      assert.ok(Object.hasOwn(totals, row.disposition));
      totals[row.disposition]++;
      const evidence = row.disposition === 'gap' ? frozen.sourceGaps : frozen.rows;
      assert.equal(evidence.filter((entry) => entry.sourcePosition === row.sourcePosition).length, 1);
      if (groups.at(-1)?.number !== row.originalGroupNumber) groups.push({ number: row.originalGroupNumber, count: 0 });
      groups.at(-1).count++;
    }
    assert.deepEqual(groups.map((row) => row.count), blocks[index]);
    assert.deepEqual(ledger.excludedSourceRows, []);
    assert.deepEqual(ledger.repeatedSourceReferences, []);
    const report = json(`scripts/data/owner-overlaps/${id}.json`);
    assert.equal(report.comparisonCount, 314);
    assert.deepEqual(Object.keys(report.peerDigests).sort(), ids.filter((peer) => peer !== id).sort());
  }
  assert.deepEqual(totals, { included: 166, gap: 2 });
});

test('Phase Three corrections preserve source identities, approved copy and standalone gaps', () => {
  const civil = source(ids[0]);
  assert.deepEqual(civil.rows.slice(7, 14).map((row) => row.selectedIssueId), [4216, 4313, 4468, 5086, 5239, 5402, 4786]);
  assert.deepEqual([...new Set(civil.rows.map((row) => row.sourceSection))], ['Lead-up to Civil War', 'Civil War', 'Death of Captain America']);
  assert.deepEqual([...new Set(source(ids[1]).rows.map((row) => row.originalGroupNumber))], [1, 2, 3, 5]);
  assert.equal(source(ids[1]).rows[27].selectedIssueId, 27399);
  const strange = source(ids[5]);
  assert.deepEqual(strange.rows.slice(3, 6).map((row) => row.suppliedCandidateId), [5399, 5400, 5401]);
  assert.deepEqual(strange.rows.slice(3, 6).map((row) => row.selectedIssueId), [5662, 5801, 5957]);
  assert.match(strange.rows[4].identityCorrection.reason, /Friendly Neighborhood Spider-Man/);
  assert.equal(strange.rows[4].identityCorrection.rejectedCandidateStatus, 200);
  assert.deepEqual(strange.sourceGaps.map((row) => row.sourcePosition), [1, 18]);
  assert.ok(strange.sourceGaps.every((row) => row.issueNumber === null
    && row.evidenceSources.some((entry) => entry.url === 'https://github.com/raymond-nassar/recap-page/issues/767')));
  assert.equal(strange.rows[16].selectedIssueId, 58278);
  const mapping = json(`scripts/data/owner-mappings/${ids[5]}.json`);
  assert.equal(mapping.candidateMetadata.find((row) => row.id === 5400).providerProjection.title,
    'Friendly Neighborhood Spider-Man (2005) #14');
  assert.ok(!mapping.rows.some((row) => row.selectedIssueId === 5400));
  assert.deepEqual(strange.rows.filter((row) => row.disposition === 'gap').map((row) => row.suppliedCandidateId), [41511, 62446]);
  const panther = source(ids[2]);
  assert.equal(panther.readerDescription, panther.suppliedDescription.replace(
    "and his own cousin thinks he's unfit to rule", 'and rivals challenge his right to rule'));
  const captain = source(ids[4]);
  assert.equal(captain.readerDescription, captain.suppliedDescription.replace(
    'watch her claim the Captain Marvel name', 'follow her adventures as Captain Marvel'));
  assert.deepEqual([...new Set(captain.rows.map((row) => row.group))].slice(1), [
    'Captain Marvel: Higher, Further, Faster, More', 'Captain Marvel: Stay Fly', 'Captain Marvel: Alis Volat Propriis',
  ]);
  for (const id of [ids[0], ids[1], ids[3], ids[5]]) assert.equal(source(id).readerDescription, source(id).suppliedDescription);
  assert.equal(panther.rows[19].group, 'Black Panther by Christopher Priest: Black Panther (1998) #1-17');
  assert.equal(panther.rows[36].group, 'Black Panther: A Nation Under Our Feet (2016) #1-12');
  const thor = payload(ids[1]).items[0];
  assert.equal(thor.issueId, 46516);
  assert.equal(thor.number, null);
  assert.doesNotMatch(thor.title, /#\d/);
  const dispatch = new URL(launchUrl(thor, 'http://127.0.0.1:8787'));
  assert.equal(dispatch.searchParams.get('i'), '46516');
  assert.equal(dispatch.searchParams.get('d'), String(thor.digitalId));
  const exported = parseChecklist(serializeReadingOrder({ name: ids[1], items: [thor] }));
  assert.deepEqual(exported.entries.map((row) => row.issueId), [46516]);
  const report = json(`scripts/data/owner-overlaps/${ids[1]}.json`);
  assert.equal(report.comparisons.find((row) => row.orderId === 'mcu-prep-thor-2011').sharedCount, 10);
  assert.deepEqual(report.comparisons.find((row) => row.orderId === 'mcu-prep-thor-the-dark-world-2013').sharedIds,
    ['11665', '11666', '11667', '11668', '11669', '11670', '11671', '11672', '11673']);
  assert.equal(json(`scripts/data/owner-overlaps/${ids[4]}.json`).comparisons
    .find((row) => row.orderId === 'mcu-prep-the-avengers-2012').sharedCount, 9);
});

test('Phase Three film associations preserve two Avengers releases on one independent guide', () => {
  const data = json('src/data/mcu-prep.json');
  const expected = [
    [['captain-america-civil-war', '2016-05-06']],
    [['thor-ragnarok', '2017-11-03']],
    [['black-panther', '2018-02-16']],
    [['avengers-infinity-war', '2018-04-27'], ['avengers-endgame', '2019-04-26']],
    [['captain-marvel', '2019-03-08']],
    [['doctor-strange', '2016-11-04']],
  ];
  for (const [index, id] of ids.entries()) {
    const associations = data.guides.filter((row) => row.id === id);
    assert.equal(associations.length, 1);
    assert.deepEqual(associations[0].releases, expected[index].map((row) => row[0]));
    const contract = registeredOwnerContracts.find((row) => row.id === id);
    assert.deepEqual(contract.screenReleases.map((row) => [row.id, row.date]), expected[index]);
    for (const [releaseId, date] of expected[index]) {
      const release = data.releases.find((row) => row.id === releaseId);
      assert.equal(release.date, date);
      assert.equal(release.phase, 3);
      assert.equal(release.format, 'movie');
      assert.equal(release.status, 'released');
    }
  }
  assert.deepEqual(data.guides.filter((row) => row.releases.includes('avengers-endgame')).map((row) => row.id), [ids[3]]);
});
