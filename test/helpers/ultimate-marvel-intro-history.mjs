import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const correction = JSON.parse(readFileSync(new URL(
  '../../scripts/data/ultimate-marvel-intro-correction.json', import.meta.url,
), 'utf8'));
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const earlierDescription = JSON.parse(readFileSync(new URL(
  '../../scripts/data/description-revisions.json', import.meta.url,
), 'utf8')).entries.find(({ id }) => id === correction.id).before;
export const ultimateIntroCorrectionDelta = 1;
let original;
function baseline() {
  if (!original) {
    const text = execFileSync('git', ['show',
      `${correction.priorCommit}:src/data/${correction.file}`], { encoding: 'utf8' });
    const payload = JSON.parse(text);
    assert.equal(hash(payload), correction.priorPayloadSha256);
    assert.equal(hash(payload.items), correction.priorItemsSha256);
    original = { text, payload, ids: payload.items.map(({ issueId }) => String(issueId)) };
  }
  return original;
}

export function beforeUltimateIntroIssueIds(value) {
  const ids = value.map(String);
  const { ids: before } = baseline();
  if (JSON.stringify(ids) === JSON.stringify(before)) return [...before];
  const after = [...before];
  after.splice(correction.sourcePosition - 1, 0, String(correction.issueId));
  assert.deepEqual(ids, after, 'Intro history accepts only the prior vector or the approved source insertion.');
  return [...before];
}

export function beforeUltimateIntroEntry(entry) {
  if (entry.id !== correction.id) return entry;
  assert.ok([121, 122].includes(entry.expect), 'Unrecorded Intro expected count.');
  assert.ok([correction.beforeDescription, correction.afterDescription,
    earlierDescription].includes(entry.description),
  'Unrecorded Intro description.');
  return { ...entry, expect: 121, description: entry.description === correction.afterDescription
    ? correction.beforeDescription : entry.description };
}

export function beforeUltimateIntroCatalogEntry(entry) {
  if (entry.id !== correction.id) return entry;
  assert.ok([121, 122].includes(entry.count), 'Unrecorded Intro catalog count.');
  return { ...entry, count: 121, updatedAt: correction.beforeCatalogEntry.updatedAt,
    description: entry.description === correction.afterDescription ? correction.beforeDescription : entry.description };
}

export function beforeUltimateIntroPayload(payload) {
  if (payload.id !== correction.id) return payload;
  beforeUltimateIntroIssueIds(payload.items.map(({ issueId }) => issueId));
  const { payload: before } = baseline();
  assert.deepEqual(payload.items.filter(({ issueId }) => issueId !== correction.issueId), before.items,
    'The Intro correction must preserve every prior comic and its metadata.');
  assert.ok([correction.beforeDescription, correction.afterDescription].includes(payload.description));
  const restored = { ...payload, count: before.count, description: before.description,
    generatedAt: before.generatedAt, items: before.items };
  assert.deepEqual(restored, before, 'Only the approved Intro insertion, count and description may change.');
  return before;
}

export function beforeUltimateIntroPayloadText(file, text) {
  if (file !== correction.file) return text;
  beforeUltimateIntroPayload(JSON.parse(text));
  return baseline().text;
}
