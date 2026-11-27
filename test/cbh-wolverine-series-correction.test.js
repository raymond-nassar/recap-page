import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { beforeFirstInstallmentManifest } from './helpers/first-installment-history.mjs';
import { beforeLaterModernTimelineManifest } from './helpers/later-modern-timeline-history.mjs';
import {
  assertApprovedRelationshipReview, manifestEntryForMapping, mergePublishedWolverineCorrection,
} from '../scripts/author-cbh-packet.mjs';
import {
  approvalDigestFor, digestCanonicalJson, mappingDigestFor, packetDigestFor, sourceCountsForPacket,
  sourcePositionsForPacket,
} from '../scripts/lib/cbh-inventory.mjs';
import {
  beforeWolverineCorrectionIssueIds, readPreSuccessorWolverinePublication, wolverineGapResolutions,
  wolverineSeriesCorrectionReviewCommit, wolverineSuccessorLedger,
} from './helpers/wolverine-correction-history.mjs';
import {
  registeredLegacyIdentityKey, repairWolverineChecklist, repairWolverineTitles, wolverineTitleRepairs,
} from '../scripts/lib/wolverine-title-repairs.mjs';
import { marvelComicsAppLinkPairs } from '../src/data/marvelComicsAppLinks.js';

const id = 'wolverine-reading-order';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const ledger = await readJson(`scripts/data/cbh-source-ledgers/${id}-series-correction.json`);
const prior = ledger.priorPublication;
const show = (file, commit = prior.commit) => execFileSync('git', ['show', `${commit}:${file}`], {
  encoding: 'utf8', maxBuffer: 64 << 20,
});
const packet = JSON.parse(show(prior.files.packet, wolverineSeriesCorrectionReviewCommit));
const mapping = JSON.parse(show(prior.files.mapping, wolverineSeriesCorrectionReviewCommit));
const report = JSON.parse(show(prior.files.report, wolverineSeriesCorrectionReviewCommit));
const payload = JSON.parse(readPreSuccessorWolverinePublication(prior.files.payload));
const priorPacket = JSON.parse(show(prior.files.packet));
const priorMapping = JSON.parse(show(prior.files.mapping));
const priorReport = JSON.parse(show(prior.files.report));
const priorPayloadText = show(prior.files.payload).replace(/\r\n/g, '\n');

// Every source position of a packet, keyed by position, as the reader sees it: a row with its
// exact comic, a repeat pointing at one, an exclusion, or a gap.
function occurrences(source) {
  const positions = sourcePositionsForPacket(source);
  const byPosition = new Map();
  source.rows.forEach((row, index) => byPosition.set(positions[index], {
    representation: 'row', sourceIssueReference: row.sourceIssueReference,
    seriesYear: row.seriesYear, issueId: row.candidateIssueId,
  }));
  for (const repeat of source.repeatedSourceReferences) {
    byPosition.set(repeat.sourcePosition, {
      representation: 'repeat', sourceIssueReference: repeat.sourceIssueReference,
      seriesYear: repeat.seriesYear, issueId: source.rows[repeat.canonicalRow - 1].candidateIssueId,
      canonicalSourcePosition: positions[repeat.canonicalRow - 1],
    });
  }
  for (const excluded of source.excludedSourceRows) {
    byPosition.set(excluded.sourcePosition, {
      representation: 'exclusion', sourceIssueReference: excluded.sourceIssueReference,
      seriesYear: null, issueId: null,
    });
  }
  for (const gap of source.sourceGaps) {
    byPosition.set(gap.sourcePosition, {
      representation: 'gap', sourceIssueReference: gap.sourceIssueReference,
      seriesYear: gap.seriesYear, issueId: null,
    });
  }
  return byPosition;
}

const corrections = ledger.correctionReview.corrections;
const corrected = new Set(corrections.map((entry) => entry.sourcePosition));

test('Wolverine display repairs preserve every published identity and all non-title data', () => {
  const baseline = JSON.parse(execFileSync('git', [
    'show', `${wolverineTitleRepairs.baselineCommit}:src/data/wolverine_reading_order.json`,
  ], { encoding: 'utf8', maxBuffer: 64 << 20 }));
  assert.equal(wolverineTitleRepairs.entries.length, 25);
  assert.deepEqual(repairWolverineTitles(baseline), payload);
  assert.deepEqual(repairWolverineTitles(payload, { undo: true }), baseline);
  assert.deepEqual(payload.items.map((item) => item.issueId), baseline.items.map((item) => item.issueId));
  assert.equal(payload.items.filter((item, index) => item.title !== baseline.items[index].title).length, 25);
  assert.ok([...payload.items, ...payload.unresolved].every(({ title }) =>
    !/[\u00c3\u2013\u2014]/u.test(title)));
});

test('Wolverine title overlay is repeatable and rejects unknown text or identity', () => {
  assert.deepEqual(repairWolverineTitles(payload), payload);
  const unrelated = { id: 'unrelated' };
  assert.equal(repairWolverineTitles(unrelated), unrelated);
  for (const field of ['title', 'issueId', 'placeholder']) {
    const invalid = structuredClone(payload);
    invalid.items[wolverineTitleRepairs.entries[0].position - 1][field] = 'unexpected';
    assert.throws(() => repairWolverineTitles(invalid));
  }
  const missing = { ...payload, unresolved: [] };
  assert.throws(() => repairWolverineTitles(missing), /one unresolved label/);
});

test('Wolverine checklist overlay keeps each repaired line one registered identity key from its source', () => {
  const shipped = readPreSuccessorWolverinePublication(`src/data/orders/${id}.md`);
  const legacy = repairWolverineChecklist(shipped, { undo: true });
  assert.equal(repairWolverineChecklist(legacy), shipped);
  assert.equal(repairWolverineChecklist(shipped), shipped);
  assert.equal(repairWolverineChecklist(legacy.replace(/\n/g, '\r\n')), shipped.replace(/\n/g, '\r\n'));
  assert.doesNotMatch(shipped, /[\u0080-\uffff]/u);
  const { legacyTitle } = wolverineTitleRepairs.entries[0];
  assert.throws(() => repairWolverineChecklist(legacy.replace(`- [ ] ${legacyTitle}\n`, '')), /exactly one line/);
  assert.throws(() => repairWolverineChecklist(`${legacy}\n- [ ] ${legacyTitle}`), /exactly one line/);
  for (const entry of wolverineTitleRepairs.entries) {
    assert.ok(registeredLegacyIdentityKey(id, entry.title, entry.legacyTitle));
    assert.ok(!registeredLegacyIdentityKey('another-order', entry.title, entry.legacyTitle));
    assert.ok(!registeredLegacyIdentityKey(id, entry.legacyTitle, entry.title));
  }
});

test('current reading census imports without Git history and replay reads it lazily', () => {
  const censusUrl = new URL('./helpers/current-reading-library.mjs', import.meta.url).href;
  const replayUrl = new URL('./helpers/wolverine-correction-history.mjs', import.meta.url).href;
  execFileSync(process.execPath, ['--input-type=module', '-e', `
    import assert from 'node:assert/strict';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    childProcess.execFileSync = () => { throw new Error('Historical Git read requested'); };
    syncBuiltinESMExports();
    await import(${JSON.stringify(censusUrl)});
    const { beforeWolverineCorrectionIssueIds } = await import(${JSON.stringify(replayUrl)});
    assert.throws(() => beforeWolverineCorrectionIssueIds([]), /Historical Git read requested/);
  `], { encoding: 'utf8' });
});

test('the Wolverine series correction ledger names the publication it replaced', () => {
  assert.equal(ledger.correctionIssue, 'https://github.com/raymond-nassar/recap-page/issues/1078');
  assert.equal(priorPacket.packetDigest, prior.packetDigest);
  assert.equal(packetDigestFor(priorPacket), prior.packetDigest);
  assert.equal(priorMapping.mappingDigest, prior.mappingDigest);
  assert.equal(mappingDigestFor(priorMapping), prior.mappingDigest);
  assert.equal(priorReport.reportDigest, prior.reportDigest);
  assert.equal(priorMapping.relationshipReview.approvalDigest, prior.approvalDigest);
  assert.equal(createHash('sha256').update(priorPayloadText).digest('hex'), prior.payloadSha256);
  assert.deepEqual(sourceCountsForPacket(priorPacket), prior.sourceCounts);
  assert.equal(JSON.parse(priorPayloadText).items.length, prior.sourceCounts.sourceIdentityCount);
});

test('each corrected position records its prior and current form exactly', () => {
  const before = occurrences(priorPacket);
  const after = occurrences(packet);
  assert.equal(corrections.length, 95);
  assert.equal(corrected.size, corrections.length);
  const tally = {};
  for (const entry of corrections) {
    const key = `${entry.before.representation}->${entry.after.representation}`;
    tally[key] = (tally[key] ?? 0) + 1;
    const was = before.get(entry.sourcePosition);
    assert.deepEqual(was, entry.before, String(entry.sourcePosition));
    const now = after.get(entry.sourcePosition);
    assert.deepEqual(now, entry.after, String(entry.sourcePosition));
    assert.notDeepEqual(was, now);
    assert.match(entry.after.sourceIssueReference, new RegExp(`^Wolverine \\(${entry.after.seriesYear}\\) #\\d+$`));
    assert.match(entry.sourceText, /Wolverine/);
  }
  assert.deepEqual(tally, {
    'row->row': 28, 'repeat->row': 52, 'repeat->repeat': 2, 'exclusion->row': 13,
  });
});

test('no position outside the ledger changed', () => {
  const before = occurrences(priorPacket);
  const after = occurrences(packet);
  assert.equal(after.size, packet.sourceOccurrenceCount);
  assert.equal(before.size, priorPacket.sourceOccurrenceCount);
  assert.equal(packet.sourceOccurrenceCount, priorPacket.sourceOccurrenceCount);
  for (const [position, was] of before) {
    if (corrected.has(position)) continue;
    assert.deepEqual(after.get(position), was, `source position ${position}`);
  }
  assert.deepEqual(packet.sourceGaps, priorPacket.sourceGaps);
});

test('the corrected rows reach the published payload in source order', () => {
  const after = occurrences(packet);
  const rowIds = [...after.entries()]
    .filter(([, entry]) => entry.representation === 'row')
    .sort(([a], [b]) => a - b)
    .map(([, entry]) => entry.issueId);
  const published = payload.items.filter((item) => !item.placeholder).map((item) => item.issueId);
  assert.deepEqual(published, rowIds);
  assert.equal(payload.items.length, ledger.correctionReview.sourceCounts.sourceIdentityCount);
  assert.equal(payload.count, payload.items.length);
  const priorPlaceholders = JSON.parse(priorPayloadText).items.filter((item) => item.placeholder);
  assert.deepEqual(repairWolverineTitles(payload, { undo: true }).items
    .filter((item) => item.placeholder), priorPlaceholders);
});

test('the correction review binds the published 95-position Wolverine correction', () => {
  const review = ledger.correctionReview;
  assert.equal(review.packetDigest, packet.packetDigest);
  assert.equal(review.mappingDigest, mapping.mappingDigest);
  assert.equal(review.reportDigest, report.reportDigest);
  assert.equal(review.approvalDigest, mapping.relationshipReview.approvalDigest);
  assert.equal(approvalDigestFor(mapping.relationshipReview), review.approvalDigest);
  assert.deepEqual(review.sourceCounts, sourceCountsForPacket(packet));
  assert.doesNotThrow(() => assertApprovedRelationshipReview({
    packet, mapping, report, currentLibraryDigest: report.libraryDigest,
    expectedOrderIds: report.comparisons.map((comparison) => comparison.orderId),
  }));
});

test('historical replay rejects issue vectors outside the reviewed correction', () => {
  const currentIds = payload.items.map(({ issueId }) => issueId);
  const priorIds = JSON.parse(priorPayloadText).items.map(({ issueId }) => String(issueId));
  assert.deepEqual(beforeWolverineCorrectionIssueIds(currentIds), priorIds);
  assert.deepEqual(beforeWolverineCorrectionIssueIds(priorIds), priorIds);
  const changed = [...currentIds];
  changed[0] = 1;
  assert.throws(() => beforeWolverineCorrectionIssueIds(changed), /exact reviewed correction/);
  assert.throws(() => beforeWolverineCorrectionIssueIds(currentIds.slice(1)), /exact reviewed correction/);
});

test('the Wolverine successor resolves only the 18 reviewed slots and links each exact viewer', async () => {
  const checklistFile = `src/data/orders/${id}.md`;
  const [nextText, checklistText, nextSource] = await Promise.all([
    readFile(prior.files.payload, 'utf8'),
    readFile(checklistFile, 'utf8'),
    readJson(prior.files.packet),
  ]);
  const next = JSON.parse(nextText);
  const expected = wolverineSuccessorLedger.correctedCandidate;
  const sha256 = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
  assert.equal(sha256(nextText), expected.payloadSha256);
  assert.equal(sha256(checklistText), expected.checklistSha256);
  const transitions = new Map(wolverineGapResolutions.map((entry) => [entry.index, entry]));
  assert.equal(transitions.size, 18);
  const before = occurrences(packet);
  const after = occurrences(nextSource);
  assert.equal(after.size, before.size);
  const byPosition = new Map(wolverineGapResolutions.map((entry) => [entry.sourcePosition, entry]));
  for (const [position, was] of before) {
    const transition = byPosition.get(position);
    if (!transition) {
      assert.deepEqual(after.get(position), was, `Source position ${position}`);
    } else {
      assert.equal(was.representation, 'gap');
      assert.equal(after.get(position).representation, 'row');
      assert.equal(after.get(position).issueId, transition.issueId);
    }
  }
  const viewers = new Map(marvelComicsAppLinkPairs);
  for (const [index, item] of payload.items.entries()) {
    const transition = transitions.get(index);
    if (!transition) {
      assert.deepEqual(next.items[index], item, `Item ${index}`);
    } else {
      assert.equal(item.issueId, transition.previousIssueId);
      assert.equal(item.placeholder, true);
      assert.equal(next.items[index].issueId, transition.issueId);
      assert.notEqual(next.items[index].placeholder, true);
      assert.equal(String(viewers.get(transition.issueId)), transition.appViewer);
    }
  }
  assert.equal(next.items.length, payload.items.length);
  assert.equal(next.placeholders, payload.placeholders - transitions.size);
  const beforeLines = readPreSuccessorWolverinePublication(checklistFile).split('\n');
  const afterLines = checklistText.split(/\r?\n/);
  assert.equal(afterLines.length, beforeLines.length);
  assert.equal(afterLines.filter((line, index) => line !== beforeLines[index]).length, transitions.size);
  assert.equal(repairWolverineChecklist(checklistText), checklistText);
  assert.deepEqual(repairWolverineTitles(next), next);
  assert.deepEqual(beforeWolverineCorrectionIssueIds(next.items.map(({ issueId }) => issueId)),
    JSON.parse(priorPayloadText).items.map(({ issueId }) => String(issueId)));
});

test('the Wolverine successor binds fresh reviews without changing the published manifest', async () => {
  const completeFile = `scripts/data/cbh-overlaps/${id}-complete-catalog.json`;
  const dispositionFile = `scripts/data/cbh-source-ledgers/${id}-complete-catalog-dispositions.json`;
  const [nextPacket, nextMapping, active, completeText, dispositionText, manifest] = await Promise.all([
    readJson(prior.files.packet), readJson(prior.files.mapping), readJson(prior.files.report),
    readFile(completeFile, 'utf8'), readFile(dispositionFile, 'utf8'), readJson('src/data/curated-lists.json'),
  ]);
  const { correctionReview, transitionLedgerDigest, readerCatalog } = wolverineSuccessorLedger;
  assert.equal(packetDigestFor(nextPacket), correctionReview.packetDigest);
  assert.equal(mappingDigestFor(nextMapping), correctionReview.mappingDigest);
  assert.equal(active.reportDigest, correctionReview.reportDigest);
  assert.equal(active.comparisonCount, 275);
  assert.equal(approvalDigestFor(nextMapping.relationshipReview), correctionReview.approvalDigest);
  assert.equal(digestCanonicalJson(nextPacket.sourceGapResolutions), transitionLedgerDigest);
  assert.deepEqual(sourceCountsForPacket(nextPacket), wolverineSuccessorLedger.sourceCounts);
  assert.deepEqual(beforeFirstInstallmentManifest(beforeLaterModernTimelineManifest(manifest)),
    JSON.parse(readPreSuccessorWolverinePublication('src/data/curated-lists.json')));
  assert.deepEqual(mergePublishedWolverineCorrection(manifest, manifestEntryForMapping(nextMapping),
    nextPacket.insertionAnchor), manifest);

  const { reportDigest, ...completeBody } = JSON.parse(completeText);
  const { approvalDigest, ...dispositions } = JSON.parse(dispositionText);
  assert.equal(digestCanonicalJson(completeBody), readerCatalog.reportDigest);
  assert.equal(reportDigest, readerCatalog.reportDigest);
  assert.equal(completeBody.comparisonCount, 352);
  assert.equal(completeBody.catalog.payloadPins.length, 349);
  assert.equal(digestCanonicalJson(dispositions), approvalDigest);
  assert.equal(dispositions.reportDigest, reportDigest);
  const sha256 = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
  assert.equal(sha256(completeText), readerCatalog.reportFileSha256);
  assert.equal(sha256(dispositionText), readerCatalog.dispositionFileSha256);
});
