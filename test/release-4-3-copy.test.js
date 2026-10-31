import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const digest = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

function field(document, heading) {
  const marker = `### ${heading}\n\n`;
  const from = document.indexOf(marker);
  assert.notEqual(from, -1, `Missing approved field: ${heading}`);
  const remainder = document.slice(from + marker.length);
  const end = remainder.search(/\n\n(?=#{1,3} )/);
  assert.notEqual(end, -1, `Missing end of approved field: ${heading}`);
  return remainder.slice(0, end);
}

// These hashes bind the released fields to the owner's approved r5 packet on #810.
// Normalize line endings only; the copy, punctuation and paragraph breaks remain exact.
const STORE_FIELDS = [
  ['Product name', '9788b641c5da1860151ba10cca83bb529559e65b4a8c92e5ac92d0ccf7bd23c5'],
  ['Short description', 'c471d668394be0890c520c96053d33b070520e7a96f698130f5f8534b5c84093'],
  ['Long description', '6a103f50043a41a41f1b946a1e8765fa6a0bcdad9afa1329ec6c70437c2be548'],
  ['Feature fields', '475aa25b03dadf5d3833619a7e3d3aaf6eb8981bdb5e6f359d8d29893696d079'],
  ['Keywords', 'f5f8a40484472e0265ab86eabfae5d76841462dc3d9d80c1561f9728de009aad'],
  ['Customer-facing requirements', '85f33317a5a89642b72f3d046dbb02c284da640a41bb857e5cc6fd6eceee9fc8'],
  ['Personal-information answer and package-data declaration', 'c83391c909b2a0787fe20ef028858d25d9c2fbc3513d377a18ccba7e828be268'],
  ['Restricted-capability explanation', '426f8a8936ae3e148b902bfae96dabab41fe825bbcec6c70e3b0df89571b8b8e'],
  ['Notes for certification: fixed text', '1b78e284188ba0b2710513a51ea4575f5962154668777f2614fa67b8d0b3b0c4'],
  ["What's new in this version: proposed exact field", '02119021374627a945544137d3478f70a01da1359d835d14b961d3f331fe1c06'],
];

const PLAY_FIELDS = [
  ['App name', '9788b641c5da1860151ba10cca83bb529559e65b4a8c92e5ac92d0ccf7bd23c5'],
  ['Short description', '99683e070b9de7363e6ac31b375ca579ef505c8e4b65e0e5bb81403b4a21dbb7'],
  ['Full description', 'f080ecdff3e6aa8214d78d6417a47db8e4fea17261ddb60446bbf9185dbece57'],
  ['Privacy-policy URL', '1d318b30cd380ea3b872eb287a81934b0ae0ff8794b4d728ee03ab495688dbf6'],
  ['Release notes: proposed exact field', '8b891497380a58c9620db1cde82db0975cc8d37c7e6d5586d401671b9c95e6f3'],
  ['Top-level answers', '178eb228ca8b2bef22ce34b6caad74aa22148d65010ffce79a1f471fc5478f52'],
  ['Per-type selections for coordinator review', 'cc42d422c05da249087cfe2444c557f9b7516592b1544b8dc2b2bda49e206c2d'],
  ['Exact deletion instructions for a form field or linked policy', '763ff53806ac046215ae26a8166cbc5444a220dd8bb59949b2052c3531f79a89'],
];

test('approved field extraction preserves trailing whitespace and blank lines', () => {
  const fieldWithSpace = '### Example\n\nvalue \n\n### Next\n\n';
  const fieldWithBlankLine = '### Example\n\nvalue\n\n\n### Next\n\n';
  assert.equal(field(fieldWithSpace, 'Example'), 'value ');
  assert.equal(field(fieldWithBlankLine, 'Example'), 'value\n');
});

test('the 4.3.0 privacy policy is the approved text', () => {
  assert.equal(digest(read('PRIVACY.md')), '23eb5374e446adb36bcf908b5ac3525bfa91548a36eb2333948503a298a1efe0');
});

test('the 4.3.0 Microsoft Store fields are the approved text', () => {
  const document = read('docs/MICROSOFT_STORE_SUBMISSION.md');
  for (const [heading, expected] of STORE_FIELDS) {
    assert.equal(digest(field(document, heading)), expected, heading);
  }
});

test('the 4.3.0 Play listing and Data safety selections are the approved text', () => {
  const document = read('docs/GOOGLE_PLAY_PUBLISHING.md');
  for (const [heading, expected] of PLAY_FIELDS) {
    assert.equal(digest(field(document, heading)), expected, heading);
  }
  assert.ok([...field(document, 'Short description')].length <= 80);
  assert.ok([...field(document, 'Full description')].length <= 4000);
  assert.ok([...field(document, 'Release notes: proposed exact field')].length <= 500);
});

test('the 4.3.0 Store publisher uses the approved release notes', () => {
  const document = read('docs/MICROSOFT_STORE_SUBMISSION.md');
  const payload = JSON.parse(read('docs/releases/4.3.0-store.json'));
  assert.equal(payload.version, '4.3.0');
  assert.equal(payload.locale, 'en-us');
  const bullets = payload.text.split('\n');
  assert.equal(bullets.length, 4);
  assert.ok(bullets.every((bullet) => /^- \S.*\.$/.test(bullet)));
  assert.equal(bullets.map((bullet) => bullet.slice(2)).join(' '),
    field(document, "What's new in this version: proposed exact field"));
});
