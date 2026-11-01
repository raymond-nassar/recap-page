import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync, inflateSync } from 'node:zlib';
import { crc32, encodePng } from '../scripts/build-icons.mjs';
import { sha256 } from '../scripts/play-assets.mjs';
import {
  ASSETS, OUTPUT_DIR, SCREEN_DIR, SEARCH_SCREENS, TEMPLATES, decodeScreen, inspectOutput, productPageHeader, searchResults,
} from '../scripts/ios-creative-assets.mjs';

const fakeScreen = (shade) => {
  const width = 132, height = 287;
  return encodePng(width, Buffer.alloc(width * height * 3, shade), { height, alpha: false });
};
const pixel = (image, x, y) => [...image.pixels.subarray((y * image.width + x) * 3, (y * image.width + x) * 3 + 3)];
const chunk = (type, data) => {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  bytes.write(type, 4, 'ascii');
  data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
};
const recompress = (bytes) => {
  const chunks = [], data = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') data.push(bytes.subarray(at + 8, at + 8 + length));
    else if (type !== 'IEND') chunks.push(bytes.subarray(at, at + length + 12));
    at += length + 12;
  }
  return Buffer.concat([
    bytes.subarray(0, 8), ...chunks,
    chunk('IDAT', deflateSync(inflateSync(Buffer.concat(data)), { level: 1 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
};

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
  const unknown = Buffer.concat([good.subarray(0, 33), chunk('ABCD', Buffer.alloc(0)), good.subarray(33)]);
  assert.throws(() => decodeScreen(unknown), /unsupported critical chunk ABCD/);
});

const manifest = () => JSON.parse(readFileSync(join(OUTPUT_DIR, 'manifest.json'), 'utf8'));
const matchesManifest = (spec, fresh) => {
  const committed = readFileSync(join(OUTPUT_DIR, spec.file));
  const row = manifest().files.find((entry) => entry.file === spec.file);
  assert.ok(row, `${spec.file} is missing from the manifest`);
  assert.deepEqual([row.width, row.height, row.bytes, row.sha256], [spec.width, spec.height, committed.length, sha256(committed)]);
  const template = TEMPLATES[spec.template];
  assert.deepEqual(row.safeArea, {
    ...spec.safeArea,
    source: `${template.layer} layer bounds in ${template.url}`,
    templateSha256: template.sha256,
  });
  assert.ok(inspectOutput(committed, spec).pixels.equals(inspectOutput(fresh, spec).pixels), `${spec.file} differs from a fresh build`);
};

test('the committed header is a fresh build', () => {
  matchesManifest(ASSETS[0], productPageHeader());
});

test('freshness accepts identical pixels encoded at a different deflate level', () => {
  for (const spec of ASSETS) {
    const committed = readFileSync(join(OUTPUT_DIR, spec.file));
    const fresh = recompress(committed);
    assert.ok(!committed.equals(fresh), 'the compressed bytes must differ for this proof');
    matchesManifest(spec, fresh);
  }
});

test('freshness rejects a search image built from a changed input screenshot', () => {
  const screens = SEARCH_SCREENS.map((file) => decodeScreen(readFileSync(join(SCREEN_DIR, file))));
  screens[0].pixels.fill(0);
  assert.throws(() => matchesManifest(ASSETS[1], searchResults(screens)), /differs from a fresh build/);
});

test('the committed search results image is a fresh build of the committed screenshots', () => {
  assert.deepEqual(manifest().screens.map(({ file }) => file.split('/').pop()), SEARCH_SCREENS);
  const screens = SEARCH_SCREENS.map((file) => {
    const bytes = readFileSync(join(SCREEN_DIR, file));
    assert.equal(manifest().screens.find((row) => row.file.endsWith(`/${file}`)).sha256, sha256(bytes));
    return decodeScreen(bytes);
  });
  matchesManifest(ASSETS[1], searchResults(screens));
});
