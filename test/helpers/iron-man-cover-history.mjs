import assert from 'node:assert/strict';
import path from 'node:path';

// #1289 repaired one stored cover base that named its own image file, so every builder asked
// the host for a file inside a file. Approvals recorded before that repair hashed the old
// address, and a corrected address is not a new source approval, so replay only this exact
// inverse: one catalog entry and one payload row, and nothing else in either.
const LIST_ID = 'iron-man-reading-order';
const PAYLOAD = 'iron_man_reading_order.json';
const ISSUE_ID = 11280;
const AFTER = 'https://i.annihil.us/u/prod/marvel/i/mg/d/03/58dd080719806';
const BEFORE = `${AFTER}/clean.jpg`;

export function beforeIronManCoverCatalogEntry(entry) {
  if (entry.id !== LIST_ID) return entry;
  assert.equal(entry.coverIssueId, ISSUE_ID);
  assert.ok([AFTER, BEFORE].includes(entry.cover?.path),
    'Iron Man cover history accepts only the captured prior address or its exact repair.');
  return { ...entry, cover: { ...entry.cover, path: BEFORE } };
}

export function beforeIronManCoverPayloadText(file, text) {
  if (path.basename(file) !== PAYLOAD) return text;
  const row = JSON.parse(text).items.find(({ issueId }) => issueId === ISSUE_ID);
  assert.ok([AFTER, BEFORE].includes(row?.cover?.path),
    'Iron Man cover history accepts only the captured prior address or its exact repair.');
  const field = `"path": ${JSON.stringify(AFTER)}`;
  const count = text.split(field).length - 1;
  if (row.cover.path === BEFORE) {
    assert.equal(count, 0);
    return text;
  }
  assert.equal(count, 1, 'The repaired Iron Man cover address must occur exactly once.');
  return text.replace(field, () => `"path": ${JSON.stringify(BEFORE)}`);
}
