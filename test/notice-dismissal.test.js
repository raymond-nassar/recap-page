import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createNoticeDismissal, NOTICE_DISMISSAL_KEY, READER_CLOSURE_NOTICE } from '../src/js/lib/noticeDismissal.js';
import { captureCompleteBackup, prepareCompleteRestore, RESTORE_KEYS } from '../src/js/lib/completeBackup.js';
import { KEY, Store } from '../src/js/storage.js';
import { createEmptyState, exportBackup } from '../src/js/lib/model.js';

function fixture(raw = null) {
  const map = new Map(raw === null ? [] : [[NOTICE_DISMISSAL_KEY, raw]]);
  const storage = {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
  return { map, storage };
}

test('only an exact valid notice identity is dismissed on load', () => {
  for (const raw of [null, '', 'true', '1', '{}', 'null', `"${READER_CLOSURE_NOTICE}"`,
    `${READER_CLOSURE_NOTICE} `, 'marvel-unlimited-closure-v2']) {
    assert.equal(createNoticeDismissal(fixture(raw)).dismissed(), false, String(raw));
  }
  assert.equal(createNoticeDismissal(fixture(READER_CLOSURE_NOTICE)).dismissed(), true);
  assert.equal(createNoticeDismissal({
    ...fixture(READER_CLOSURE_NOTICE), notice: 'marvel-unlimited-closure-v2',
  }).dismissed(), false, 'a materially new notice shows');
});

test('dismissal writes only its own key and verifies durability across instances', () => {
  const h = fixture();
  h.map.set(KEY, 'untouched');
  const seen = createNoticeDismissal(h);
  assert.equal(seen.dismissed(), false);
  assert.deepEqual(seen.dismiss(), { remembered: true, reason: 'remembered', error: null });
  assert.equal(seen.dismissed(), true);
  assert.equal(h.map.get(NOTICE_DISMISSAL_KEY), READER_CLOSURE_NOTICE);
  assert.equal(h.map.get(KEY), 'untouched');
  assert.equal(createNoticeDismissal(h).dismissed(), true);
});

test('missing or unreadable storage shows the notice and keeps dismissal in this page only', () => {
  for (const storage of [undefined, {
    getItem() { throw new Error('read refused'); },
    setItem() { throw new Error('write refused'); },
  }]) {
    const seen = createNoticeDismissal({ storage });
    assert.equal(seen.dismissed(), false);
    const result = seen.dismiss();
    assert.equal(result.remembered, false);
    assert.ok(result.error instanceof Error);
    assert.equal(seen.dismissed(), true);
    assert.equal(createNoticeDismissal({ storage }).dismissed(), false);
  }
});

test('failed, silent and unverifiable saves are explicit but dismiss for this page', () => {
  for (const mode of ['throw', 'silent', 'read-back']) {
    const h = fixture();
    const read = h.storage.getItem;
    let written = false;
    h.storage.setItem = () => {
      written = true;
      if (mode === 'throw') throw new Error('quota');
    };
    h.storage.getItem = (key) => {
      if (written && mode === 'read-back') throw new Error('verification refused');
      return read(key);
    };
    const seen = createNoticeDismissal(h);
    const result = seen.dismiss();
    assert.equal(result.remembered, false, mode);
    assert.notEqual(result.reason, 'remembered', mode);
    assert.equal(seen.dismissed(), true, mode);
    assert.equal(createNoticeDismissal(fixture()).dismissed(), false, mode);
  }
});

test('complete/cloud capture excludes dismissal and recovery writes never replace it', async () => {
  const h = fixture(READER_CLOSURE_NOTICE);
  h.map.set(KEY, JSON.stringify(exportBackup(createEmptyState())));
  const capture = await captureCompleteBackup({ storage: h.storage, cryptoProvider: webcrypto });
  assert.equal(capture.text.includes(READER_CLOSURE_NOTICE), false);
  assert.equal(capture.text.includes(NOTICE_DISMISSAL_KEY), false);
  assert.equal(RESTORE_KEYS.includes(NOTICE_DISMISSAL_KEY), false);
  const prepared = prepareCompleteRestore({
    backup: capture.backup, storage: h.storage, isExclusive: () => true,
  });
  for (const owner of prepared.owners) {
    for (const effect of owner.effects) {
      if (effect.value === null) h.storage.removeItem(effect.key);
      else h.storage.setItem(effect.key, effect.value);
    }
  }
  const reader = new Store(h);
  reader.load();
  assert.equal(reader.salvage(), true);
  assert.equal(reader.restore(JSON.stringify(exportBackup(createEmptyState()))).ok, true);
  assert.equal(h.map.get(NOTICE_DISMISSAL_KEY), READER_CLOSURE_NOTICE);
  assert.equal(createNoticeDismissal(h).dismissed(), true);
});
