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
  'mcu-prep-iron-man-2008', 'mcu-prep-the-incredible-hulk-2008', 'mcu-prep-iron-man-2-2010',
  'mcu-prep-thor-2011', 'mcu-prep-captain-america-the-first-avenger-2011',
  'mcu-prep-the-avengers-2012', 'mcu-prep-iron-man-3-2013',
];
const digests = [
  '87753dfe488390f94792aa96a87aa13ccb2f6290999fdcdef84b044f82a3e761',
  '96b26a021df26644b089e3d5b2a5b7c322fe90ceca7abf02284b1f5dc8e40d70',
  'c9ccc10a14367f280eb694fd1e3e3aba86b29709479c81bc1cb91559c62ab7ce',
  '201243e084283e9d8e88dcabb42d9fe882296ee04682b81d3b3005c9656a59c3',
  '16d7b1d828171fff3df06f6c019a90a42a3dc392885e56a100bc8d253f132912',
  '06f2965f57c106415a26c7ed259f9e3ff9001530fafc2a7b1eed2adef5880bc5',
  '3347c7173e402d3e07518cdc7addb2bb0a72d842ffc60dbf32d9809c09113382',
];
const counts = [16, 12, 29, 14, 4, 15, 24];
const occurrenceCounts = [22, 13, 29, 14, 9, 15, 24];
const source = (id) => json(`scripts/data/owner-selections/${id}.json`);
const packet = (id) => json(`scripts/data/owner-packets/${id}.json`);
const payload = (id) => json(`src/data/${id.replaceAll('-', '_')}.json`);

test('seven film guides retain independently accepted vectors and complete source position accounting', () => {
  const totals = { included: 0, gap: 0, 'owner-excluded': 0 };
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
    assert.deepEqual(ledger.rows.map((row) => row.sourcePosition),
      Array.from({ length: occurrenceCounts[index] }, (_, position) => position + 1));
    assert.equal(ledger.rows.length, ledger.sourceIssueCount);
    assert.deepEqual(ledger.rows.filter((row) => row.disposition === 'included').map((row) => row.selectedIssueId),
      data.items.map((row) => row.issueId));
    for (const row of ledger.rows) {
      assert.ok(Object.hasOwn(totals, row.disposition));
      totals[row.disposition]++;
      const relevant = row.disposition === 'included' ? frozen.rows
        : row.disposition === 'gap' ? frozen.sourceGaps : frozen.excludedSourceRows;
      assert.equal(relevant.filter((entry) => entry.sourcePosition === row.sourcePosition).length, 1);
    }
    assert.equal(sourceCountsForPacket(frozen).sourceOccurrenceCount, occurrenceCounts[index]);
    assert.deepEqual(ledger.repeatedSourceReferences, []);
    const report = json(`scripts/data/owner-overlaps/${id}.json`);
    assert.equal(report.comparisonCount, 304);
    assert.deepEqual(Object.keys(report.peerDigests).sort(), ids.filter((peer) => peer !== id).sort());
  }
  assert.deepEqual(totals, { included: 114, gap: 2, 'owner-excluded': 10 });
  assert.equal(Object.values(totals).reduce((sum, count) => sum + count), 126);
});

test('film guide source corrections retain original links, fenced selections, aliases and both metadata gaps', () => {
  const iron = source(ids[0]);
  assert.deepEqual(iron.excludedSourceRows.map((row) => row.sourcePosition), [1, 2, 3, 4, 5, 6]);
  assert.deepEqual(iron.originalGroupLabels.map((label) => Number(label.match(/^\d+/)[0])), [1, 2, 4]);
  const captain = source(ids[4]);
  assert.deepEqual(captain.rows.slice(0, 4).map((row) => row.selectedIssueId), [38423, 38428, 38825, 38824]);
  assert.equal(captain.rows[3].suppliedCandidateId, 39298);
  assert.deepEqual(captain.excludedSourceRows.map((row) => row.sourcePosition), [5, 6, 7, 8]);
  assert.equal(captain.sourceGaps[0].sourcePosition, 9);
  assert.equal(source(ids[1]).sourceGaps[0].sourcePosition, 1);
  assert.equal(source(ids[1]).sourceGaps[0].issueNumber, null);
  for (const [id, issue] of [[ids[1], 762], [ids[4], 763]]) {
    assert.ok(source(id).sourceGaps[0].evidenceSources.some((row) => row.url.endsWith(`/issues/${issue}`)));
  }
  const sequel = source(ids[2]);
  assert.equal(sequel.rows.filter((row) => row.insideFormattingFence).length, 9);
  assert.deepEqual(sequel.originalGroupLabels.map((label) => Number(label.match(/^\d+/)[0])), [1, 3, 4]);
  const extremis = source(ids[6]).rows.slice(0, 6);
  assert.deepEqual(extremis.map((row) => row.suppliedCandidateId), [92, 93, 1764, 1765, 1766, 3881]);
  assert.deepEqual(extremis.map((row) => row.selectedIssueId), [92, 1493, 1580, 1765, 3347, 3881]);
  assert.deepEqual(source(ids[5]).rows.at(-1).selectedIssueId, 90);
  assert.match(source(ids[5]).rows.at(-1).suppliedReference, /2005/);
  assert.match(payload(ids[5]).items.at(-1).title, /2004/);
});

test('standalone film selections preserve unnumbered titles, exact metadata and reader/export identity', () => {
  for (const [id, issueId, digitalId] of [[ids[3], 46516, 31694], [ids[5], 47697, 28799]]) {
    const item = payload(id).items[0];
    assert.equal(item.issueId, issueId);
    assert.equal(item.number, null);
    assert.doesNotMatch(item.title, /#\d/);
    const mapping = json(`scripts/data/owner-mappings/${id}.json`);
    assert.equal(mapping.rows[0].issueNumber, null);
    assert.equal(mapping.rows[0].metadataIssueNumber, '0');
    const metadata = mapping.candidateMetadata.find((row) => row.id === issueId).providerProjection;
    assert.equal(item.url, metadata.detailUrl);
    assert.equal(item.digitalId, digitalId);
    const dispatch = new URL(launchUrl(item, 'http://127.0.0.1:8787'));
    assert.equal(dispatch.searchParams.get('d'), String(digitalId));
    assert.equal(dispatch.searchParams.get('i'), String(issueId));
    const exported = parseChecklist(serializeReadingOrder({ name: id, items: [item] }));
    assert.deepEqual(exported.entries.map((row) => row.issueId), [issueId]);
    assert.deepEqual(exported.unresolved, []);
  }
});

test('seven film associations retain independently verified US dates and phases', () => {
  const data = json('src/data/mcu-prep.json');
  const releaseIds = ['iron-man', 'the-incredible-hulk', 'iron-man-2', 'thor',
    'captain-america-the-first-avenger', 'the-avengers', 'iron-man-3'];
  const dates = ['2008-05-02', '2008-06-13', '2010-05-07', '2011-05-06', '2011-07-22', '2012-05-04', '2013-05-03'];
  for (const [index, id] of ids.entries()) {
    const guide = data.guides.filter((row) => row.id === id);
    assert.equal(guide.length, 1);
    assert.deepEqual(guide[0].releases, [releaseIds[index]]);
    const release = data.releases.find((row) => row.id === releaseIds[index]);
    assert.equal(release.date, dates[index]);
    assert.equal(release.phase, index < 6 ? 1 : 2);
    assert.equal(release.status, 'released');
    assert.equal(release.format, 'movie');
  }
});
