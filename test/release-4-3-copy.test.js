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
// The restricted-capability explanation and the fixed certification notes were revised for the
// Windows app window, approved on #1412:
// https://github.com/raymond-nassar/recap-page/issues/1412#issuecomment-6931922442
// The What's new field uses the owner's approved 4.7.0 v3 release text from 18 November 2026.
const STORE_FIELDS = [
  ['Product name', '9788b641c5da1860151ba10cca83bb529559e65b4a8c92e5ac92d0ccf7bd23c5'],
  ['Short description', 'c471d668394be0890c520c96053d33b070520e7a96f698130f5f8534b5c84093'],
  ['Long description', '6a103f50043a41a41f1b946a1e8765fa6a0bcdad9afa1329ec6c70437c2be548'],
  ['Feature fields', '475aa25b03dadf5d3833619a7e3d3aaf6eb8981bdb5e6f359d8d29893696d079'],
  ['Keywords', 'f5f8a40484472e0265ab86eabfae5d76841462dc3d9d80c1561f9728de009aad'],
  ['Customer-facing requirements', '85f33317a5a89642b72f3d046dbb02c284da640a41bb857e5cc6fd6eceee9fc8'],
  ['Personal-information answer and package-data declaration', 'c83391c909b2a0787fe20ef028858d25d9c2fbc3513d377a18ccba7e828be268'],
  ['Restricted-capability explanation', 'cef30f63c959c5298c1cb44dc957279697aef1d6544b09ae9975edbe6c3dbe63'],
  ['Notes for certification: fixed text', '2a2a85b85490fac9b46c8345d20fc19c9b28ae913a60f433a8f7e78471fe5ed2'],
  ["What's new in this version: proposed exact field", '0d32271f8bb57542b50b7ae52be3a3e20276accf686cf2a5ff696e6a412d1098'],
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

// The owner approved this privacy policy paragraph on #1079:
// https://github.com/raymond-nassar/recap-page/issues/1079#issuecomment-6591655469
// Its iCloud backup and iPhone and iPad device-storage wording was approved on #1101:
// https://github.com/raymond-nassar/recap-page/pull/1101
// The cloud backup wording was approved on #1158:
// https://github.com/raymond-nassar/recap-page/issues/1158#issuecomment-6709789692
// The launch-check wording revised after that review was approved on #1158 too:
// https://github.com/raymond-nassar/recap-page/issues/1158#issuecomment-6713935238
// The collected-book link wording was approved on #1203:
// https://github.com/raymond-nassar/recap-page/issues/1203#issuecomment-6842253465
// The Read wording was subsequently approved on 18 November 2026.
test('the privacy policy preserves its approved wording', () => {
  const privacy = read('PRIVACY.md');
  assert.match(privacy, /It normally backs up no more than once every five\s+minutes\./);
  assert.match(privacy, /after a progress check confirms that\s+this device's data needs backing up\./);
  assert.equal(digest(privacy), '847770f554afd29ce601c2d29489880abf122be122a5b69358f32f6b66b3a3e1');
});

test('the Microsoft Store packet fields are the approved text', () => {
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

test('the 4.7.0 Store publisher uses the approved release notes', () => {
  const document = read('docs/MICROSOFT_STORE_SUBMISSION.md');
  const payload = JSON.parse(read('docs/releases/4.7.0-store.json'));
  assert.equal(payload.version, '4.7.0');
  assert.equal(payload.locale, 'en-us');
  const bullets = payload.text.split('\n');
  assert.equal(bullets.length, 5);
  assert.ok(bullets.every((bullet) => /^- \S.*\.$/.test(bullet)));
  assert.equal(payload.text, field(document, "What's new in this version: proposed exact field"));
});
