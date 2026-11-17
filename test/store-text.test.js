import { test } from 'node:test';
import assert from 'node:assert/strict';
import { approvedStoreText, textLength, STORE_LIMITS } from '../scripts/lib/store-text.mjs';

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
