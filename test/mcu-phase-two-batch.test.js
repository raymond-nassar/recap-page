import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseChecklist, serializeReadingOrder } from '../src/js/lib/markdown.js';
import { launchUrl } from '../src/js/reader.js';
import { sourceCountsForPacket } from '../scripts/lib/cbh-inventory.mjs';
import { registeredOwnerContracts } from './helpers/current-reading-library.mjs';

const json = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const hash = (value) => createHash('sha256').update(value).digest('hex');
const ids = [
  'mcu-prep-thor-the-dark-world-2013', 'mcu-prep-captain-america-the-winter-soldier-2014',
  'mcu-prep-avengers-age-of-ultron-2015', 'mcu-prep-ant-man-2015',
];
const vectors = [
  [33865, 33828, 33838, 33797, 33868, 11665, 11666, 11667, 11668, 11669, 11670, 11671, 11672, 11673],
  [34994, 36179, 36175, 36371, 36177, 91, 1492, 1579, 1668, 1764, 1870, 1978, 2190, 2308, 2421, 2422, 3084, 3188],
  [31151, 31153, 31155, 31156, 31158, 17831, 17832, 17833, 17846, 55073, 55074, 55075, 55076,
    50076, 47001, 47003, 37405, 37406, 37407, 45904, 45905, 45906, 45907, 45908, 47072],
  [32680, 5199, 5360, 5628, 5775, 5938, 6076, 51374, 51382, 51387, 51388, 51389,
    55336, 55338, 55339, 55340, 55341, 55342, 55343, 55344, 55345, 51933],
];
const descriptions = [
  "Ancient evil wakes up, and Thor has to lean on the brother who betrayed him to stop it. This stack traces Thor's origin through the saga that invented Malekith and the Dark Elves, with plenty of prickly, complicated brotherhood along the way.",
  'Steve discovers the system he trusted has been rotten from the inside for decades, and the assassin hunting him turns out to be his best friend. This is spy thriller Marvel at its best, built around the very arc that created the Winter Soldier.',
  "Tony's dream of a peacekeeping AI turns into humanity's worst nightmare the moment Ultron wakes up. This list traces Ultron's twisted origin as Hank Pym's creation straight through to the comic event that gave the film its name.",
  "An ex-con gets a second chance wearing a suit that shrinks him down and hits like a tank, pulled into one last heist by the hero who built it first. These books follow the legacy from Hank and Janet's earliest days through Scott Lang's scrappy, funny rise.",
];
const source = (id) => json(`scripts/data/owner-selections/${id}.json`);
const mapping = (id) => json(`scripts/data/owner-mappings/${id}.json`);
const payload = (id) => json(`src/data/${id.replaceAll('-', '_')}.json`);

test('four Phase Two guides preserve all 79 supplied positions, exact descriptions and independent vectors', () => {
  let total = 0;
  for (const [index, id] of ids.entries()) {
    const expected = vectors[index];
    const data = payload(id);
    const ledger = source(id);
    const packet = json(`scripts/data/owner-packets/${id}.json`);
    const contracts = registeredOwnerContracts.filter((contract) => contract.id === id);
    assert.equal(contracts.length, 1);
    assert.deepEqual(contracts[0].rows.map((row) => row[1]), expected);
    assert.deepEqual(data.items.map((row) => row.issueId), expected);
    assert.equal(new Set(expected).size, expected.length);
    assert.deepEqual(ledger.rows.map((row) => row.suppliedCandidateId), expected);
    assert.deepEqual(ledger.rows.map((row) => row.selectedIssueId), expected);
    assert.deepEqual(ledger.rows.map((row) => row.sourcePosition), expected.map((_, i) => i + 1));
    assert.ok(ledger.rows.every((row) => row.disposition === 'included'));
    assert.equal(ledger.inputReceipt.sourceKind, 'pasted-message-snapshot');
    assert.equal(ledger.inputReceipt.originalFileSha256, null);
    assert.equal(ledger.inputReceipt.originalFileBytes, null);
    assert.notEqual(ledger.inputReceipt.snapshotSha256, ledger.projectionReceipt.sha256);
    assert.equal(ledger.readerDescription, descriptions[index]);
    assert.equal(data.description, descriptions[index]);
    assert.equal(ledger.descriptionReceipt.bodySha256, hash(descriptions[index]));
    assert.equal(sourceCountsForPacket(packet).sourceOccurrenceCount, expected.length);
    for (const field of ['sourceGaps', 'excludedSourceRows', 'repeatedSourceReferences']) assert.deepEqual(ledger[field], []);
    const report = json(`scripts/data/owner-overlaps/${id}.json`);
    assert.equal(report.comparisonCount, 308);
    assert.deepEqual(Object.keys(report.peerDigests).sort(), ids.filter((peer) => peer !== id).sort());
    total += expected.length;
  }
  assert.equal(total, 79);
});

test('Phase Two source corrections preserve distinct epilogue identity, shared comics and supplied groups', () => {
  const thor = payload(ids[0]);
  const earlierThor = payload('mcu-prep-thor-2011');
  assert.deepEqual(thor.items.filter((item) => earlierThor.items.some((prior) => prior.issueId === item.issueId))
    .map((item) => item.issueId), vectors[0].slice(5));
  const captain = source(ids[1]);
  assert.ok(captain.originalGroupLabels.every((label) => label.includes('\\*\\*')));
  assert.match(captain.originalGroupLabels[2], /same issues as Phase 1 list above/);
  assert.equal(captain.rows[9].selectedIssueId, 1764);
  assert.deepEqual(payload(ids[1]).items.slice(5).map((item) => item.number),
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '11', '12', '13', '14']);
  const ultron = payload(ids[2]);
  assert.deepEqual(ultron.items.slice(-2).map((item) => [item.issueId, item.number, item.title]), [
    [45908, '10', 'Age of Ultron (2013) #10'],
    [47072, '10AI', 'Age of Ultron (2013) #10AI'],
  ]);
  const epilogue = mapping(ids[2]).rows.at(-1);
  assert.equal(epilogue.issueNumber, '10AI');
  assert.equal(epilogue.metadataIssueNumber, '10');
  assert.equal(epilogue.candidateIssueId, epilogue.selectedIssueId);
  assert.match(source(ids[2]).originalGroupLabels[1], /not a standalone Ultron miniseries/);
  const ant = payload(ids[3]);
  assert.deepEqual(ant.items.slice(-5).map((item) => item.issueId), [55342, 55343, 55344, 55345, 51933]);
  assert.ok(ant.items.slice(-5).every((item) => item.collectedIn === 'Astonishing Ant-Man Vol. 3: The Trial of Ant-Man'));
  assert.notEqual(ant.items[11].seriesId, ant.items[12].seriesId);
  assert.deepEqual([ant.items[11].number, ant.items[12].number], ['5', '5']);
  assert.match(source(ids[3]).originalGroupLabels[4], /Family Business/);
});

test('Rage of Ultron remains one unnumbered whole work with exact reader and export identity', () => {
  const item = payload(ids[2]).items[13];
  assert.equal(item.issueId, 50076);
  assert.equal(item.number, null);
  assert.equal(item.title, 'Avengers: Rage of Ultron (2015)');
  const row = mapping(ids[2]).rows[13];
  assert.equal(row.issueNumber, null);
  assert.equal(row.metadataIssueNumber, '0');
  assert.match(source(ids[2]).rows[13].suppliedReference, /#1$/);
  const url = new URL(launchUrl(item, 'http://127.0.0.1:8787'));
  assert.equal(url.searchParams.get('i'), '50076');
  assert.equal(url.searchParams.get('d'), String(item.digitalId));
  const exported = parseChecklist(serializeReadingOrder({ name: ids[2], items: [item] }));
  assert.deepEqual(exported.entries.map((entry) => entry.issueId), [50076]);
  assert.deepEqual(exported.unresolved, []);
});

test('four Phase Two film associations retain verified US dates around the unchanged Guardians association', () => {
  const data = json('src/data/mcu-prep.json');
  const releases = ['thor-the-dark-world', 'captain-america-the-winter-soldier', 'avengers-age-of-ultron', 'ant-man'];
  const dates = ['2013-11-08', '2014-04-04', '2015-05-01', '2015-07-17'];
  for (const [index, id] of ids.entries()) {
    assert.deepEqual(data.guides.filter((guide) => guide.id === id).map((guide) => guide.releases), [[releases[index]]]);
    const release = data.releases.find((entry) => entry.id === releases[index]);
    assert.deepEqual([release.date, release.phase, release.format, release.status], [dates[index], 2, 'movie', 'released']);
  }
  const guardians = 'mcu-prep-guardians-of-the-galaxy';
  assert.deepEqual(data.guides.find((guide) => guide.id === guardians), {
    id: guardians, releases: ['guardians-of-the-galaxy'],
    note: 'Associated with the title-matching original movie, not inferred sequels.',
  });
  const order = json('test/fixtures/mcu-prep-release-order.json').oldestFirst;
  assert.deepEqual(order.filter((id) => ids.includes(id) || id === guardians), [
    ids[0], ids[1], guardians, ids[2], ids[3],
  ]);
});
