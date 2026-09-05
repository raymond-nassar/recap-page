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
const id = 'venom-reading-order';
const expectedVector = [
  [898, 121341], [899, 130716], [900, 130717], [901, 130718], [902, 130719],
  [903, 130720], [905, 128933], [906, 128934], [907, 128935], [908, 128936],
  [909, 133540], [910, 127576], [911, 127577], [912, 127578], [913, 127579],
  [914, 127580], [915, 128937], [916, 128938], [917, 128939], [918, 136126],
  [920, 133101], [921, 133102], [922, 133103], [923, 133104], [924, 133105],
  [925, 135829], [926, 135245], [927, 135246], [928, 135247], [929, 135242],
  [930, 135243], [931, 135244], [932, 135830],
];
const settledPositions = new Set(expectedVector.map(([sourcePosition]) => sourcePosition));
const settledIds = new Set(expectedVector.map(([, issueId]) => issueId));

async function readJson(...segments) {
  return JSON.parse(await readFile(path.join(root, ...segments), 'utf8'));
}

test('Venom publishes the reviewed 33-issue settlement without the #251 variant', async () => {
  const [packet, mapping, payload, markdown] = await Promise.all([
    readJson('scripts', 'data', 'cbh-packets', `${id}.json`),
    readJson('scripts', 'data', 'cbh-mappings', `${id}.json`),
    readJson('src', 'data', 'venom_reading_order.json'),
    readFile(path.join(root, 'src', 'data', 'orders', `${id}.md`), 'utf8'),
  ]);
  const parsed = parseChecklist(markdown);
  const mappingVector = mapping.rows
    .filter((row) => settledPositions.has(row.sourcePosition))
    .map((row) => [row.sourcePosition, Number(row.selectedIssueId)]);
  const resolutionVector = packet.sourceGapResolutions
    .map((resolution) => [resolution.sourcePosition, resolution.selectedIssueId]);

  assert.doesNotThrow(() => validateFrozenPacket(packet));
  assert.doesNotThrow(() => validateMappingDigest(mapping));
  assert.doesNotThrow(() => assertMappingMatchesPacketOccurrences(packet, mapping));
  assert.equal(Object.hasOwn(packet, 'sourceGaps'), false);
  assert.equal(Object.hasOwn(mapping, 'sourceGaps'), false);
  assert.deepEqual(mappingVector, expectedVector);
  assert.deepEqual(resolutionVector, expectedVector);
  assert.ok(packet.sourceGapResolutions.every((resolution) => (
    resolution.resolutionKind === 'exact-issue'
  )));

  const candidates = mapping.candidateMetadata.filter((candidate) => (
    settledIds.has(Number(candidate.id))
  ));
  assert.equal(candidates.length, 33);
  assert.deepEqual(
    candidates.map((candidate) => Number(candidate.id)).sort((left, right) => left - right),
    [...settledIds].sort((left, right) => left - right),
  );
  assert.ok(candidates.every((candidate) => (
    candidate.detailsRefused === true
      && candidate.onSaleDate === null
      && candidate.detailUrl === `https://www.marvel.com/comics/issue/${candidate.id}/`
  )));

  const published = payload.items.filter((item) => settledIds.has(Number(item.issueId)));
  assert.equal(published.length, 33);
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
  assert.equal(mapping.rows.some((row) => Number(row.selectedIssueId) === 132507), false);
  assert.equal(payload.items.some((item) => Number(item.issueId) === 132507), false);
});
