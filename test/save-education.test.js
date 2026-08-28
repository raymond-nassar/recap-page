import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SAVE_EDUCATION_KEY,
  SAVE_EDUCATION_STATE,
  createSaveEducation,
} from '../src/js/lib/saveEducation.js';

const { UNSEEN, EXPLAINING, COMPLETE } = SAVE_EDUCATION_STATE;
const MAIN = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');

function fakeStorage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
  };
}

test('the lifecycle has only the three approved states and terminal completion', () => {
  const storage = fakeStorage();
  const education = createSaveEducation({ storage });

  assert.equal(education.current(), UNSEEN);
  assert.deepEqual(education.begin(), { previous: UNSEEN, current: EXPLAINING, changed: true });
  assert.deepEqual(education.begin(), { previous: EXPLAINING, current: EXPLAINING, changed: false });
  assert.deepEqual(education.complete(), { previous: EXPLAINING, current: COMPLETE, changed: true });
  assert.deepEqual(education.begin(), { previous: COMPLETE, current: COMPLETE, changed: false });
  assert.equal(storage.getItem(SAVE_EDUCATION_KEY), COMPLETE);
});

test('direct progress can complete an unseen profile without an explaining state', () => {
  const storage = fakeStorage();
  const education = createSaveEducation({ storage });

  assert.deepEqual(education.complete(), { previous: UNSEEN, current: COMPLETE, changed: true });
  assert.equal(storage.getItem(SAVE_EDUCATION_KEY), COMPLETE);
});

test('unknown stored values are unseen and a stored complete value outranks a stale begin', () => {
  const storage = fakeStorage({ [SAVE_EDUCATION_KEY]: 'future-value' });
  const education = createSaveEducation({ storage });
  assert.equal(education.current(), UNSEEN);

  storage.setItem(SAVE_EDUCATION_KEY, COMPLETE);
  assert.deepEqual(education.begin(), { previous: COMPLETE, current: COMPLETE, changed: false });
  assert.equal(storage.getItem(SAVE_EDUCATION_KEY), COMPLETE);
});

test('active tabs converge and a complete tab repairs a lower incoming value', () => {
  const storage = fakeStorage();
  const first = createSaveEducation({ storage });
  const second = createSaveEducation({ storage });

  first.complete();
  assert.deepEqual(second.adopt(COMPLETE), { previous: UNSEEN, current: COMPLETE, changed: true });

  storage.setItem(SAVE_EDUCATION_KEY, EXPLAINING);
  assert.deepEqual(second.adopt(EXPLAINING), { previous: COMPLETE, current: COMPLETE, changed: false });
  assert.equal(storage.getItem(SAVE_EDUCATION_KEY), COMPLETE);
});

test('missing or failing preference storage preserves the most advanced session state', () => {
  const missing = createSaveEducation();
  assert.equal(missing.begin().current, EXPLAINING);
  assert.equal(missing.complete().current, COMPLETE);

  const throwing = {
    getItem() { throw new Error('read refused'); },
    setItem() { throw new Error('write refused'); },
  };
  const education = createSaveEducation({ storage: throwing });
  assert.equal(education.begin().current, EXPLAINING);
  assert.equal(education.complete().current, COMPLETE);
  assert.equal(education.current(), COMPLETE);
});

test('a recovered preference write is retried and survives a new session', () => {
  let fails = true;
  const storage = fakeStorage();
  const unreliable = {
    getItem: (key) => storage.getItem(key),
    setItem(key, value) {
      if (fails) throw new Error('full');
      storage.setItem(key, value);
    },
  };
  const education = createSaveEducation({ storage: unreliable });

  assert.equal(education.begin().current, EXPLAINING);
  assert.equal(storage.getItem(SAVE_EDUCATION_KEY), null);
  fails = false;
  assert.equal(education.current(), EXPLAINING);
  assert.equal(createSaveEducation({ storage }).current(), EXPLAINING);
});

test('a silent no-op write does not erase the truthful in-memory transition', () => {
  const storage = {
    getItem() { return null; },
    setItem() {},
  };
  const education = createSaveEducation({ storage });

  assert.equal(education.begin().current, EXPLAINING);
  assert.equal(education.complete().current, COMPLETE);
  assert.equal(education.current(), COMPLETE);
});

test('adopting a higher state repairs a lower durable value', () => {
  const storage = fakeStorage({ [SAVE_EDUCATION_KEY]: EXPLAINING });
  const education = createSaveEducation({ storage });

  assert.equal(education.adopt(COMPLETE).current, COMPLETE);
  assert.equal(storage.getItem(SAVE_EDUCATION_KEY), COMPLETE);
});

test('an unreadable preference is never overwritten with a lower state', () => {
  const storage = fakeStorage({ [SAVE_EDUCATION_KEY]: COMPLETE });
  let unreadable = true;
  const unreliable = {
    getItem(key) {
      if (unreadable) throw new Error('unreadable');
      return storage.getItem(key);
    },
    setItem: (key, value) => storage.setItem(key, value),
  };
  const education = createSaveEducation({ storage: unreliable });

  assert.equal(education.begin().current, EXPLAINING);
  assert.equal(storage.getItem(SAVE_EDUCATION_KEY), COMPLETE);
  unreadable = false;
  assert.equal(education.current(), COMPLETE);
});

test('every approved list path records only its final cumulative operation result', () => {
  for (const symbol of ['addToActive', 'doImport', 'unresolvedRow', 'doManual', 'importCurated']) {
    const start = MAIN.indexOf(`function ${symbol}(`);
    assert.notEqual(start, -1, `expected ${symbol} to remain a named integration boundary`);
  }

  assert.match(MAIN, /return \{ listId: id, ok: true \};/);
  assert.equal(
    [...MAIN.matchAll(/recordNonEmptyListSave\(/g)].length,
    7,
    'one definition and the add, import, two unresolved, manual, and curated paths must be explicit',
  );
  assert.match(
    MAIN,
    /persistLongAddPage\(store, items, context, recordNonEmptyListSave\)/,
    'the long-add page path no longer records its completed cumulative result',
  );
  assert.doesNotMatch(MAIN, /const listId = ensureList\(/);
  assert.match(MAIN, /const operationOk = setupOk && store\.lastUpdateOk;/);
  assert.match(MAIN, /const operationOk = setup\.ok && store\.lastUpdateOk;/);
});

test('a curated partial success keeps the list without consuming save education', () => {
  const start = MAIN.indexOf('async function importCurated(');
  const end = MAIN.indexOf('// ------------------------------------------------------------------ progress', start);
  const body = MAIN.slice(start, end);
  assert.equal(
    [...body.matchAll(/if \(!store\.lastUpdateOk\) \{\s*clearNotice\(importKey\);\s*return listId;/g)].length,
    2,
    'both catalog entry modes must retain the durable list when selecting it fails',
  );
  assert.match(
    body,
    /setActive\(s, listId\)[\s\S]*?return listId;[\s\S]*?setActive\(s, listId\)[\s\S]*?return listId;[\s\S]*?const transition = recordNonEmptyListSave\(\{ ok: true, added, listId \}\);/,
  );
});

test('withdrawing focused education moves focus before hiding its host', () => {
  const start = MAIN.indexOf('function renderSaveEducation()');
  const end = MAIN.indexOf('function recordNonEmptyListSave', start);
  const body = MAIN.slice(start, end);
  assert.match(
    body,
    /host\.contains\(document\.activeElement\)\) focusViewHeading\('read'\);\s*host\.hidden = hidden;/,
  );
});

test('both direct progress handlers require saved before and after state', () => {
  assert.match(
    MAIN,
    /if \(!store\.lastUpdateOk \|\| isRead\(state, issueId\) === wasRead\) return null;/,
  );
  assert.equal(
    [...MAIN.matchAll(/recordDirectProgressSave\(\{/g)].length,
    3,
    'one definition and two direct handlers must remain',
  );
  assert.match(MAIN, /const wasRead = isRead\(store\.state, issue\.issueId\);/);
  assert.match(MAIN, /const wasRead = isRead\(store\.state, item\.issueId\);/);
});
