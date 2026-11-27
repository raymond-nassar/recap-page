import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createNoticeDismissal, NOTICE_DISMISSAL_KEY, readerClosureNoticeId } from '../src/js/lib/noticeDismissal.js';
import { readerClosureNotice } from '../src/js/lib/readerDestination.js';

const BEFORE = new Date(2026, 11, 6, 23, 59, 59, 999);
const AFTER = new Date(2026, 11, 7);
const READER_CLOSURE_NOTICE = readerClosureNoticeId();
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

// #1601: the approved notice, byte for byte, curly apostrophe included.
const APPROVED = 'Read opens a comic directly in the Marvel Comics app. If there’s no direct link, use Find on Marvel Comics to open the website.';

test('the approved notice has the approved dismiss control and no obsolete FAQ link', () => {
  const html = readFileSync(new URL('../src/index.html', import.meta.url), 'utf8');
  assert.match(html, /aria-label="Dismiss reading link notice" data-tooltip="Dismiss reading link notice"/);
  assert.doesNotMatch(html, /reader-closure-faq|Marvel's FAQ/);
});

test('the app-link notice is the one approved text with one identity on both sides of December 7', () => {
  assert.equal(readerClosureNotice(BEFORE), APPROVED);
  assert.equal(readerClosureNotice(AFTER), APPROVED);
  assert.equal(readerClosureNotice(), APPROVED);
  assert.doesNotMatch(APPROVED, /Unlimited|December/);
  assert.equal(readerClosureNoticeId(BEFORE), READER_CLOSURE_NOTICE);
  assert.equal(readerClosureNoticeId(AFTER), READER_CLOSURE_NOTICE);
  assert.notEqual(READER_CLOSURE_NOTICE, 'marvel-comics-app-unlimited');
  assert.notEqual(READER_CLOSURE_NOTICE, 'marvel-comics-app-comics');
});

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

test('a dismissal of the earlier Marvel Unlimited notice does not hide the app-link notice', () => {
  for (const raw of ['marvel-unlimited-closure-unlimited', 'marvel-unlimited-closure-comics']) {
    assert.equal(createNoticeDismissal(fixture(raw)).dismissed(), false, raw);
  }
});

test('a dismissal of either earlier app-link notice does not hide the approved notice', () => {
  // Before #1601 these identities named the Marvel Unlimited warning and its post-cutoff text, so
  // dismissing either must not hide the new words.
  for (const raw of ['marvel-comics-app-unlimited', 'marvel-comics-app-comics']) {
    assert.equal(createNoticeDismissal(fixture(raw)).dismissed(), false, raw);
  }
});

test('a dismissal no longer expires at the cutoff, open page or reload', () => {
  const h = fixture();
  let now = BEFORE;
  const seen = createNoticeDismissal({ ...h, notice: () => readerClosureNoticeId(now) });
  seen.dismiss();
  assert.equal(seen.dismissed(), true);
  now = AFTER;
  assert.equal(seen.dismissed(), true, 'the page left open across December 7 keeps the dismissal');
  assert.equal(createNoticeDismissal({ ...h, notice: () => readerClosureNoticeId(AFTER) }).dismissed(), true,
    'a reload after December 7 keeps the dismissal');
});

test('a dismissal after the cutoff stays dismissed across reloads', () => {
  const h = fixture();
  const notice = () => readerClosureNoticeId(AFTER);
  createNoticeDismissal({ ...h, notice }).dismiss();
  assert.equal(h.map.get(NOTICE_DISMISSAL_KEY), READER_CLOSURE_NOTICE);
  assert.equal(createNoticeDismissal({ ...h, notice }).dismissed(), true);
  for (const raw of ['marvel-unlimited-closure-v1', 'marvel-unlimited-closure-unlimited', 'marvel-unlimited-closure-comics', 'marvel-comics-app-unlimited', 'marvel-comics-app-comics']) {
    assert.equal(createNoticeDismissal({ ...fixture(raw), notice }).dismissed(), false, raw);
  }
});

test('a page-only dismissal is not withdrawn at the cutoff', () => {
  let now = BEFORE;
  const seen = createNoticeDismissal({ storage: undefined, notice: () => readerClosureNoticeId(now) });
  seen.dismiss();
  assert.equal(seen.dismissed(), true);
  now = AFTER;
  assert.equal(seen.dismissed(), true);
});
