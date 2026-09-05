import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import {
  assertMappingMatchesPacketOccurrences,
  validateFrozenPacket,
  validateMappingDigest,
} from '../scripts/lib/cbh-inventory.mjs';
import { parseChecklist } from '../src/js/lib/markdown.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const id = 'doctor-strange-reading-order';
const expectedVector = [
  [418, 22099], [419, 22110], [420, 22111], [421, 22112], [422, 22113],
  [423, 22114], [425, 22116], [426, 22117], [427, 22100], [428, 22101],
  [429, 22102], [430, 22103], [431, 22104], [432, 22105], [433, 22106],
  [434, 22107], [435, 22108], [436, 22109], [691, 62446], [710, 62433],
  [711, 62434], [712, 62435], [713, 62436],
];
const expectedExclusionPositions = [
  176, 177, 202, 243, 268, 269, 289, 319,
  394, 450, 548, 549, 581, 619, 716, 738,
];
const settledPositions = new Set(expectedVector.map(([sourcePosition]) => sourcePosition));
const settledIds = new Set(expectedVector.map(([, issueId]) => issueId));

async function readJson(...segments) {
  return JSON.parse(await readFile(path.join(root, ...segments), 'utf8'));
}

test('Doctor Strange publishes the reviewed 23 exact issues and preserves 16 exclusions', async () => {
  const [packet, mapping, payload, markdown] = await Promise.all([
    readJson('scripts', 'data', 'cbh-packets', `${id}.json`),
    readJson('scripts', 'data', 'cbh-mappings', `${id}.json`),
    readJson('src', 'data', 'doctor_strange_reading_order.json'),
    readFile(path.join(root, 'src', 'data', 'orders', `${id}.md`), 'utf8'),
  ]);
  const parsed = parseChecklist(markdown);
  const exactResolutions = packet.sourceGapResolutions.filter((resolution) => (
    resolution.resolutionKind === 'exact-issue'
  ));
  const exclusionResolutions = packet.sourceGapResolutions.filter((resolution) => (
    resolution.resolutionKind === 'source-exclusion'
  ));
  const mappingVector = mapping.rows
    .filter((row) => settledPositions.has(row.sourcePosition))
    .map((row) => [row.sourcePosition, Number(row.selectedIssueId)]);
  const canonicalIndex = mapping.rows.findIndex((row) => row.sourcePosition === 691);
  const repeated709 = packet.repeatedSourceReferences.find(
    (reference) => reference.sourcePosition === 709,
  );

  assert.equal(
    repeated709.canonicalRow,
    canonicalIndex + 1,
    'position 709 must repeat position 691 through its canonical row',
  );
  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.equal(Object.hasOwn(packet, 'sourceGaps'), false);
  assert.equal(Object.hasOwn(mapping, 'sourceGaps'), false);
  assert.deepEqual(mapping.sourceGapResolutions, packet.sourceGapResolutions);
  assert.deepEqual(mappingVector, expectedVector);
  assert.deepEqual(
    exactResolutions.map((resolution) => [
      resolution.sourcePosition,
      resolution.selectedIssueId,
    ]),
    expectedVector,
  );
  assert.deepEqual(
    exclusionResolutions.map((resolution) => resolution.sourcePosition),
    expectedExclusionPositions,
  );
  assert.deepEqual(
    packet.excludedSourceRows.map((row) => row.sourcePosition),
    expectedExclusionPositions,
  );
  assert.ok(exclusionResolutions.every((resolution) => (
    resolution.decisionScope === 'owner-authorized-unavailable-exclusion'
      && !/never existed|nonexistent/i.test(resolution.auditBasis)
  )));

  assert.equal(packet.rows.length, 734);
  assert.equal(packet.repeatedSourceReferences.length, 182);
  assert.equal(packet.excludedSourceRows.length, 16);
  assert.equal(packet.sourceGapResolutions.length, 39);
  assert.equal(packet.sourceOccurrenceCount, 932);

  const aliasResolution = exactResolutions.find((resolution) => resolution.sourcePosition === 691);
  assert.equal(aliasResolution.previousIssueNumber, '1');
  assert.equal(aliasResolution.resolvedIssueNumber, '0');
  assert.equal(mapping.rows[repeated709.canonicalRow - 1].sourcePosition, 691);
  assert.equal(mapping.rows[canonicalIndex].sourceIssueReference.endsWith('#1'), true);
  assert.equal(mapping.rows[canonicalIndex].issueNumber, '0');

  const candidates = mapping.candidateMetadata.filter((candidate) => (
    settledIds.has(Number(candidate.id))
  ));
  assert.equal(candidates.length, 23);
  assert.ok(candidates.every((candidate) => (
    candidate.detailsRefused === true
      && candidate.onSaleDate === null
      && candidate.detailUrl === `https://www.marvel.com/comics/issue/${candidate.id}/`
  )));

  const published = payload.items.filter((item) => settledIds.has(Number(item.issueId)));
  assert.equal(payload.count, 734);
  assert.equal(payload.placeholders, 0);
  assert.equal(published.length, 23);
  assert.ok(published.every((item) => (
    item.placeholder !== true
      && item.detailsRefused === true
      && item.digitalId === null
      && item.mu === null
      && item.url === `https://www.marvel.com/comics/issue/${item.issueId}/`
  )));
  assert.deepEqual(
    parsed.entries
      .filter((entry) => settledPositions.has(Number(entry.sourceKey)))
      .map((entry) => [Number(entry.sourceKey), Number(entry.issueId)]),
    expectedVector,
  );
  assert.equal(parsed.entries.length, 734);
  assert.equal(parsed.unresolved.length, 0);
});
