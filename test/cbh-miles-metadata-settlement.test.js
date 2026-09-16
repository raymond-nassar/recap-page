import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  assertMappingMatchesPacketOccurrences,
  digestCanonicalJson,
  sourceCountsForPacket,
  validateFrozenPacket,
  validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { coverUrl, normalizeIssue } from '../src/js/lib/model.js';

const id = 'miles-morales-spider-man-reading-order';
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const [packet, mapping, ledger, payload] = await Promise.all([
  readJson(`scripts/data/cbh-packets/${id}.json`),
  readJson(`scripts/data/cbh-mappings/${id}.json`),
  readJson(`scripts/data/cbh-source-ledgers/${id}.json`),
  readJson('src/data/miles_morales_spider_man_reading_order.json'),
]);
const expected = [
  {
    issueId: 64259, sourcePosition: 234, pages: 39, credits: 14, sourceCredits: 14, onSale: '2017-08-23',
    sourceCreditsDigest: 'd46c20f4fd87921b8e3ad44aa4f9665edf0e745518ae950b064ab7f625a57fb4',
    pinnedFieldsDigest: 'edfedaa007a201717b995ab3bce3912bf0dcca807f5124f8fdace88cbc38b4ac',
  },
  {
    issueId: 64285, sourcePosition: 235, pages: 41, credits: 24, sourceCredits: 25, onSale: '2017-08-30',
    sourceCreditsDigest: 'aa586df0b9f93d4506598de54f5e2e2c7558921643fc9d6e46df4393bac0f07e',
    pinnedFieldsDigest: 'f5ca5d9e473e79470ec96954a52389d5dff45e3811943b077f169b5e10a5d345',
  },
];

test('Miles approved omission preserves source position 67 and the exact published vector', () => {
  assert.equal(packet.sourceGaps?.length ?? 0, 0);
  assert.equal(ledger.ownerApprovedExclusions.length, 1);
  const exclusion = ledger.ownerApprovedExclusions[0];
  assert.equal(exclusion.sourcePosition, 67);
  assert.equal(exclusion.sourceIssueReference, 'Ultimate Prologue (2013) #1');
  assert.equal(exclusion.previousGap.sourcePosition, 67);
  assert.equal(exclusion.previousGap.kind, 'published-metadata-gap');
  assert.deepEqual(packet.excludedSourceRows, [{
    sourcePosition: 67,
    sourceIssueReference: exclusion.sourceIssueReference,
    reason: exclusion.reason,
    decisionScope: exclusion.decisionScope,
  }]);
  assert.equal(packet.sourceGapResolutions[0].resolutionKind, 'source-exclusion');
  assert.ok(packet.sourceGapResolutions[0].evidenceSources.some((source) => (
    source.url === 'https://github.com/raymond-nassar/recap-page/issues/500#issuecomment-5693130623'
  )));
  assert.deepEqual(sourceCountsForPacket(packet), {
    sourceOccurrenceCount: 395,
    sourceIdentityCount: 385,
    includedIssueCount: 385,
    sourceGapCount: 0,
    repeatedSourceReferenceCount: 9,
    excludedSourceRowCount: 1,
  });
  validateFrozenPacket(packet);
  validateMappingDigest(mapping);
  assertMappingMatchesPacketOccurrences(packet, mapping);
  assert.equal(payload.count, 385);
  assert.equal(payload.items.length, 385);
  assert.equal(payload.placeholders, 0);
  assert.deepEqual(payload.unresolved, []);
  assert.ok(payload.items.every((item) => !item.placeholder));
  assert.equal(digestCanonicalJson(payload.items.map((item) => item.issueId)),
    '3891d1a8c3e7427bd02b1cb13077c4ff5f48395b5a01b4ca09343b324959c129');
  const untouched = payload.items.filter((item) => !expected.some((row) => row.issueId === item.issueId));
  assert.equal(untouched.length, 383);
  assert.equal(digestCanonicalJson(untouched),
    '96b84da728031883382307b0a81f9b2ee9d4101f956be19bf8e2d34178e34b00');
});

test('Miles owner metadata agrees with its evidence without claiming provider success', () => {
  assert.equal(ledger.ownerMetadataSupplements?.length, 2);
  assert.equal(packet.sourceReview.metadataSupplementDigest,
    digestCanonicalJson(ledger.ownerMetadataSupplements));
  for (const row of expected) {
    const supplement = ledger.ownerMetadataSupplements.find((entry) => entry.issueId === row.issueId);
    const item = payload.items.find((entry) => entry.issueId === row.issueId);
    const candidate = mapping.candidateMetadata.find((entry) => entry.id === row.issueId);
    const { evidenceDigest, ...evidence } = supplement;
    assert.equal(digestCanonicalJson(evidence), evidenceDigest);
    assert.equal(digestCanonicalJson(supplement.pinnedFields), row.pinnedFieldsDigest);
    assert.equal(supplement.sourcePosition, row.sourcePosition);
    assert.deepEqual(
      Object.fromEntries(Object.keys(supplement.pinnedFields).map((key) => [key, item[key]])),
      supplement.pinnedFields,
    );
    assert.equal(item.onSale, row.onSale);
    assert.equal(item.pageCount, row.pages);
    assert.equal(item.seriesId, 23020);
    assert.equal(item.seriesName, 'Secret Empire (2017)');
    assert.equal(item.detailsRefused, true);
    assert.equal(item.digitalId, null);
    assert.equal(item.mu, null);
    assert.equal(item.description, null);
    assert.equal(supplement.providerRefusal.status, 404);
    assert.equal(supplement.providerRefusal.response.detail, `Issue ${row.issueId} not found`);
    assert.equal(candidate.detailsRefused, true);
    assert.equal(candidate.metadataProvenance.kind, 'owner-reviewed-supplement');
    assert.equal(candidate.metadataProvenance.evidenceDigest, evidenceDigest);
    assert.equal(candidate.metadataProvenance.configuredProviderStatus, 404);
    assert.equal(candidate.onSaleDate, item.onSale);
    assert.equal(candidate.pageCount, item.pageCount);
    assert.deepEqual(candidate.creators, item.creators);
    assert.equal(candidate.digitalId, null);
    assert.equal(candidate.unlimitedDate, null);
    assert.equal(mapping.rows.find((entry) => entry.selectedIssueId === row.issueId).marvelIssueUrl, item.url);
  }
});

test('Miles credits retain the full source and apply only the approved 24-entry projection', () => {
  assert.equal(ledger.ownerMetadataSupplements?.length, 2);
  for (const row of expected) {
    const supplement = ledger.ownerMetadataSupplements.find((entry) => entry.issueId === row.issueId);
    const item = payload.items.find((entry) => entry.issueId === row.issueId);
    assert.equal(supplement.sourceCredits.length, row.sourceCredits);
    assert.equal(digestCanonicalJson(supplement.sourceCredits), row.sourceCreditsDigest);
    assert.equal(item.creators.length, row.credits);
    assert.deepEqual(item.creators, supplement.sourceCredits.slice(0, 24));
    assert.deepEqual(normalizeIssue(item).creators, item.creators);
    assert.equal(supplement.creditProjection.maximumEntries, 24);
    assert.equal(supplement.creditProjection.retainedEntries, row.credits);
    assert.deepEqual(supplement.creditProjection.omittedEntries,
      row.issueId === 64285 ? [{ name: 'Ron Lim', role: 'penciler' }] : []);
    assert.equal(coverUrl(item, 'portrait_uncanny'), supplement.coverHeaderEvidence.requests[2].url);
    assert.ok(supplement.coverHeaderEvidence.requests.every((request) => (
      request.method === 'HEAD' && request.status === 200 && request.bodyRead === false
    )));
    assert.equal(new URL(item.cover.path).host, 'i.annihil.us');
    assert.equal(item.cover.ext, 'webp');
  }
});
