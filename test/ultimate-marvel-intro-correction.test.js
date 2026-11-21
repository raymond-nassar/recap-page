import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseChecklist } from '../src/js/lib/markdown.js';
import { validateMappingDigest, validateFrozenPacket } from '../scripts/lib/cbh-inventory.mjs';
import { beforeUltimateIntroIssueIds, beforeUltimateIntroPayload } from './helpers/ultimate-marvel-intro-history.mjs';

const json = (file) => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const correction = json('scripts/data/ultimate-marvel-intro-correction.json');
const payload = json('src/data/ultimate_marvel_intro.json');
const prior = JSON.parse(execFileSync('git', [
  'show', `${correction.priorCommit}:src/data/ultimate_marvel_intro.json`,
], { encoding: 'utf8' }));

test('Ultimate Marvel Intro adds the exact source comic at position 106 without changing its prior comics', () => {
  assert.equal(payload.count, 122);
  assert.equal(payload.items.length, 122);
  assert.equal(new Set(payload.items.map(({ issueId }) => issueId)).size, 122);
  assert.deepEqual(payload.items.slice(104, 107).map(({ issueId }) => issueId), [686, 15783, 14861]);
  assert.deepEqual(payload.items.filter(({ issueId }) => issueId !== 15783), prior.items);
  const { collectedIn, ...existing } = json('src/data/ultimate_spider_man_reading_order.json')
    .items.find(({ issueId }) => issueId === 15783);
  void collectedIn;
  assert.deepEqual(payload.items[105], existing);
});

test('the checklist, packet, mapping and catalog include all 122 source positions', () => {
  const packet = json('scripts/data/cbh-packets/ultimate-marvel-intro.json');
  const mapping = json('scripts/data/cbh-mappings/ultimate-marvel-intro.json');
  validateFrozenPacket(packet, { expectedId: correction.id });
  validateMappingDigest(mapping);
  assert.equal(packet.rows.length, 122);
  assert.equal(packet.expectedCount, 122);
  assert.deepEqual(packet.excludedSourceReferences, []);
  assert.equal(packet.rows[105].candidateIssueId, 15783);
  assert.deepEqual(mapping.rows.map(({ sourcePosition }) => sourcePosition),
    Array.from({ length: 122 }, (_, index) => index + 1));
  assert.equal(mapping.rows[105].selectedIssueId, 15783);
  const checklist = parseChecklist(readFileSync(new URL(
    '../src/data/orders/ultimate-marvel-intro.md', import.meta.url,
  ), 'utf8'));
  assert.deepEqual(checklist.entries.map(({ issueId }) => issueId), payload.items.map(({ issueId }) => issueId));
  for (const [file, field] of [['src/data/curated-lists.json', 'expect'], ['src/data/catalog.json', 'count']]) {
    const entry = json(file).lists.find(({ id }) => id === correction.id);
    assert.equal(entry[field], 122);
    assert.equal(entry.description, correction.afterDescription);
  }
  assert.equal(payload.description, correction.afterDescription);
  assert.doesNotMatch(payload.description, /omits an entry/);
});

test('historical reviews replay only the exact approved insertion and reject unrelated edits', () => {
  const ids = payload.items.map(({ issueId }) => issueId);
  assert.deepEqual(beforeUltimateIntroIssueIds(ids), prior.items.map(({ issueId }) => String(issueId)));
  assert.deepEqual(beforeUltimateIntroPayload(payload), prior);
  const reordered = [...ids];
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(() => beforeUltimateIntroIssueIds(reordered), /approved source insertion/);
  const changed = structuredClone(payload);
  changed.items[0].title += ' changed';
  assert.throws(() => beforeUltimateIntroPayload(changed), /preserve every prior comic/);
});
