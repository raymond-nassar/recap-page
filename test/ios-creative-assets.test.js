import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodePng } from '../scripts/build-icons.mjs';
import { sha256 } from '../scripts/play-assets.mjs';
import {
  ASSETS, OUTPUT_DIR, SCREEN_DIR, SEARCH_SCREENS, TEMPLATES, decodeScreen, inspectOutput, productPageHeader, searchResults,
} from '../scripts/ios-creative-assets.mjs';

const fakeScreen = (shade) => {
  const width = 132, height = 287;
  return encodePng(width, Buffer.alloc(width * height * 3, shade), { height, alpha: false });
};
const pixel = (image, x, y) => [...image.pixels.subarray((y * image.width + x) * 3, (y * image.width + x) * 3 + 3)];

test('safe areas are the centered rectangles read from Apple\'s templates', () => {
  for (const spec of ASSETS) {
    const { left, top, right, bottom } = spec.safeArea;
    assert.equal(left + right, spec.width);
    assert.ok(Math.abs(top + bottom - spec.height) <= 1);
    assert.match(TEMPLATES[spec.template].url, /^https:\/\/devimages-cdn\.apple\.com\/.+\.psd$/);
    assert.match(TEMPLATES[spec.template].sha256, /^[a-f0-9]{64}$/);
    assert.ok(spec.alt.length <= 140 && !/[\u2013\u2014]/u.test(spec.alt));
  }
  assert.deepEqual(ASSETS.map(({ width, height }) => [width, height]), [[3840, 1646], [3840, 2560]]);
});

test('the header is opaque RGB at 3840 by 1646 with the icon centered in the safe area', () => {
  const bytes = productPageHeader();
  const image = inspectOutput(bytes, ASSETS[0]);
  assert.deepEqual(image.ancillary, ['sRGB']);
  assert.equal(bytes[25], 2, 'color type 2 is RGB without alpha');
  // The icon's white header bar sits just above the middle; its purple tile surrounds it.
  assert.deepEqual(pixel(image, 1920, 700), [255, 255, 255]);
  assert.deepEqual(pixel(image, 1920, 1080), [0x6d, 0x28, 0xd9]);
  assert.deepEqual(productPageHeader(), bytes);
});

test('the search results image puts every screen inside the safe area', () => {
  const screens = [fakeScreen(250), fakeScreen(10), fakeScreen(250)].map(decodeScreen);
  const bytes = searchResults(screens);
  const image = inspectOutput(bytes, ASSETS[1]);
  assert.equal(bytes[25], 2);
  assert.deepEqual(pixel(image, 1920, 1280), [10, 10, 10]);
  assert.deepEqual(pixel(image, 1280, 1280), [250, 250, 250]);
  assert.deepEqual(pixel(image, 2560, 1280), [250, 250, 250]);
  assert.throws(() => searchResults(screens.slice(1)), /three screens/);
});

test('screen decoding refuses alpha, corruption and unknown critical chunks', () => {
  const good = fakeScreen(100);
  assert.equal(decodeScreen(good).width, 132);
  assert.throws(() => decodeScreen(encodePng(4, Buffer.alloc(64))), /without alpha/);
  const corrupt = Buffer.from(good);
  corrupt[40] ^= 1;
  assert.throws(() => decodeScreen(corrupt), /checksum/);
  assert.throws(() => decodeScreen(good.subarray(0, 30)), /truncated|incomplete|invalid/);
});

const manifest = () => JSON.parse(readFileSync(join(OUTPUT_DIR, 'manifest.json'), 'utf8'));
const matchesManifest = (spec, fresh) => {
  const committed = readFileSync(join(OUTPUT_DIR, spec.file));
  const row = manifest().files.find((entry) => entry.file === spec.file);
  assert.ok(row, `${spec.file} is missing from the manifest`);
  assert.deepEqual([row.width, row.height, row.bytes, row.sha256], [spec.width, spec.height, committed.length, sha256(committed)]);
  assert.deepEqual(row.safeArea.left, spec.safeArea.left);
  assert.ok(committed.equals(fresh), `${spec.file} differs from a fresh build`);
};

test('the committed header is a fresh build', () => {
  matchesManifest(ASSETS[0], productPageHeader());
});

// Skipped only while the iPhone screens are not on the branch. Once they are, a missing or stale
// search results image fails here.
test('the committed search results image is a fresh build of the committed screenshots', {
  skip: !existsSync(SCREEN_DIR) && 'the iPhone 6.9-inch screenshots are not committed yet',
}, () => {
  assert.deepEqual(manifest().screens.map(({ file }) => file.split('/').pop()), SEARCH_SCREENS);
  const screens = SEARCH_SCREENS.map((file) => {
    const bytes = readFileSync(join(SCREEN_DIR, file));
    assert.equal(manifest().screens.find((row) => row.file.endsWith(`/${file}`)).sha256, sha256(bytes));
    return decodeScreen(bytes);
  });
  matchesManifest(ASSETS[1], searchResults(screens));
});
