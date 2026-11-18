import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvedStoreText, textLength, STORE_LIMITS, StoreTextError } from '../scripts/lib/store-text.mjs';
import { approvedDescriptions, approvedDescriptionsAt } from '../scripts/lib/store-descriptions.mjs';
import { approvedReviewNotes, approvedReviewNotesAt } from '../scripts/lib/app-store-review-notes.mjs';

const file = (text, version = '4.6.0') => JSON.stringify({ locale: 'en-us', text, version });

test('the approved text is returned exactly as written', () => {
  const result = approvedStoreText(Buffer.from(file('- One.\n- Two.')), '4.6.0', 'google-play');
  assert.equal(result.text, '- One.\n- Two.');
  assert.equal(result.path, 'docs/releases/4.6.0-store.json');
});

test('text over a store limit stops with the counts rather than being truncated', () => {
  const longest = `- ${'a'.repeat(STORE_LIMITS['google-play'] - 2)}`;
  assert.equal(approvedStoreText(file(longest), '4.6.0', 'google-play').text, longest);
  assert.throws(() => approvedStoreText(file(`${longest}a`), '4.6.0', 'google-play'),
    /at most 500 characters .* holds 501\. .*nothing was sent or truncated/);
});

test('characters outside the basic plane count by the larger of code points and UTF-16 units', () => {
  assert.equal(textLength('- \u{1F600}'), 4);
  const text = `- ${'\u{1F600}'.repeat(249)}`;
  assert.equal(approvedStoreText(file(text), '4.6.0', 'google-play').length, 500);
  assert.throws(() => approvedStoreText(file(`${text}\u{1F600}`), '4.6.0', 'google-play'), /holds 502\./);
});

test('a file for another version, a malformed file or an unknown store is refused', () => {
  assert.throws(() => approvedStoreText(file('- One.', '4.5.0'), '4.6.0', 'google-play'), /store text: docs/);
  assert.throws(() => approvedStoreText('{', '4.6.0', 'google-play'), /not valid JSON/);
  assert.throws(() => approvedStoreText(file('- One.'), '4.6.0', 'amazon'), /unknown store/);
  assert.throws(() => approvedStoreText(file('- One.'), '4.6', 'google-play'), /not x\.y\.z/);
});

test('description file requires both approved texts, exact keys, locale and version', () => {
  const value = { version: '4.6.0', locale: 'en-us', appStore: 'Fake Apple text', googlePlay: 'Fake Play text' };
  assert.equal(approvedDescriptions(JSON.stringify(value), '4.6.0').appStore, value.appStore);
  for (const bad of [{ ...value, extra: true }, { ...value, googlePlay: '' }, { ...value, locale: 'en-US' },
    { ...value, version: '4.5.0' }, { ...value, appStore: 'x'.repeat(4001) },
    { ...value, googlePlay: 'x'.repeat(4001) }, { ...value, appStore: 'bad\rtext' },
    { ...value, appStore: '\ud800' }, { ...value, googlePlay: ' bad' }, { ...value, googlePlay: 'bad\u0085text' },
    { version: value.version, locale: value.locale, appStore: value.appStore }]) {
    assert.throws(() => approvedDescriptions(JSON.stringify(bad), '4.6.0'), StoreTextError);
  }
  assert.equal(approvedDescriptions(JSON.stringify({ ...value, appStore: 'x'.repeat(4000) }), '4.6.0').appStore.length, 4000);
  assert.equal(approvedDescriptions(JSON.stringify({ ...value, googlePlay: '\u{1f600}'.repeat(2000) }),
    '4.6.0').googlePlay.length, 4000);
  assert.throws(() => approvedDescriptions('{', '4.6.0'), StoreTextError);
});

test('only an absent tree entry means no description change', () => {
  const value = JSON.stringify({ version: '4.6.0', locale: 'en-us', appStore: 'Fake Apple', googlePlay: 'Fake Play' });
  const path = 'docs/releases/4.6.0-store-descriptions.json';
  const calls = [];
  const git = (...args) => { calls.push(args); return args[0] === 'ls-tree' ? path : value; };
  assert.equal(approvedDescriptionsAt({ revision: 'abc', version: '4.6.0', git }).googlePlay, 'Fake Play');
  assert.deepEqual(calls, [['ls-tree', '--name-only', 'abc', '--', path], ['show', `abc:${path}`]]);
  assert.equal(approvedDescriptionsAt({ revision: 'abc', version: '4.6.0', git: () => '' }), null);
  assert.throws(() => approvedDescriptionsAt({ revision: 'abc', version: '4.6.0', git: () => 'unexpected' }),
    StoreTextError);
  assert.throws(() => approvedDescriptionsAt({ revision: 'abc', version: '../bad', git: () => '' }), StoreTextError);
  assert.throws(() => approvedDescriptionsAt({ revision: 'abc', version: '4.6.0',
    git: () => { throw new Error('Fake unreadable revision'); } }), /Fake unreadable revision/);
});

test('App Review notes need exactly version and notes, and stop over 4,000 UTF-8 bytes', () => {
  const value = { version: '4.6.0', notes: 'Fake reviewer note.\nSecond fake line.' };
  const result = approvedReviewNotes(JSON.stringify(value), '4.6.0');
  assert.equal(result.notes, value.notes);
  assert.equal(result.path, 'docs/releases/4.6.0-app-store-review-notes.json');
  assert.equal(approvedReviewNotes(JSON.stringify({ ...value, notes: 'x'.repeat(4000) }), '4.6.0').bytes, 4000);
  // 1,334 three-byte characters are 4,002 bytes but only 1,334 characters, so only a byte count stops them.
  for (const bad of [{ ...value, locale: 'en-us' }, { notes: value.notes }, { ...value, version: '4.5.0' },
    { ...value, notes: '' }, { ...value, notes: ' padded' }, { ...value, notes: 'bad\rtext' }, { ...value, notes: '\ud800' },
    { ...value, notes: 'x'.repeat(4001) }, { ...value, notes: '\u20ac'.repeat(1334) }, [value]]) {
    assert.throws(() => approvedReviewNotes(JSON.stringify(bad), '4.6.0'), StoreTextError);
  }
  assert.throws(() => approvedReviewNotes('{', '4.6.0'), StoreTextError);
});

test('only an absent tree entry means no App Review notes change', () => {
  const value = JSON.stringify({ version: '4.6.0', notes: 'Fake reviewer note.' });
  const path = 'docs/releases/4.6.0-app-store-review-notes.json';
  const calls = [];
  const git = (...args) => { calls.push(args); return args[0] === 'ls-tree' ? path : value; };
  assert.equal(approvedReviewNotesAt({ revision: 'abc', version: '4.6.0', git }).notes, 'Fake reviewer note.');
  assert.deepEqual(calls, [['ls-tree', '--name-only', 'abc', '--', path], ['show', `abc:${path}`]]);
  assert.equal(approvedReviewNotesAt({ revision: 'abc', version: '4.6.0', git: () => '' }), null);
  assert.throws(() => approvedReviewNotesAt({ revision: 'abc', version: '4.6.0', git: () => 'unexpected' }),
    StoreTextError);
  assert.throws(() => approvedReviewNotesAt({ revision: 'abc', version: '../bad', git: () => '' }), StoreTextError);
});
