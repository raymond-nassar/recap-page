import test from 'node:test';
import assert from 'node:assert/strict';
import { drawIcon, encodePng } from '../scripts/build-icons.mjs';
import {
  ASSETS, ORIGIN, FIXTURE_API, VIEWPORT, SCREENS, playIcon, featureGraphic, decodePng,
  demonstrationState, previewResponse, completedHealthProbe, inspectAsset, previewManifest,
} from '../scripts/play-assets.mjs';
import { migrate } from '../src/js/lib/model.js';
import { LOCAL_SERVER_HEALTH_PATH } from '../src/js/lib/localServer.js';

const icon = playIcon();
const feature = featureGraphic();

test('Play icon preserves the authored mark with opaque full-bleed square corners', () => {
  const image = decodePng(icon);
  assert.deepEqual([image.width, image.height, image.channels], [512, 512, 4]);
  assert.ok(image.chunks.includes('sRGB'));
  assert.ok(icon.length <= 1024 * 1024);
  const original = drawIcon(512);
  for (let i = 0; i < original.length; i += 4) {
    assert.equal(image.pixels[i + 3], 255);
    if (original[i + 3] === 255) assert.deepEqual(image.pixels.subarray(i, i + 4), original.subarray(i, i + 4));
  }
  for (const offset of [0, 511 * 4, 511 * 512 * 4, (512 * 512 - 1) * 4]) {
    assert.deepEqual([...image.pixels.subarray(offset, offset + 4)], [109, 40, 217, 255]);
  }
  assert.equal(inspectAsset('icon-preview.png', icon).bytes, icon.length);
});

test('Play feature artwork has measured RGB pixels at 1024 by 500, without metadata', () => {
  const image = decodePng(feature);
  assert.deepEqual([image.width, image.height, image.channels], [1024, 500, 3]);
  assert.deepEqual(image.chunks, ['IHDR', 'sRGB', 'IDAT', 'IEND']);
  const pixel = (x, y) => [...image.pixels.subarray((y * 1024 + x) * 3, (y * 1024 + x) * 3 + 3)];
  assert.deepEqual(pixel(0, 0), [109, 40, 217]);
  assert.deepEqual(pixel(240, 250), [255, 255, 255]);
  assert.deepEqual(pixel(180, 250), [158, 113, 230]);
  assert.deepEqual(pixel(450, 132), [109, 40, 217]);
  assert.deepEqual(pixel(450, 158), [158, 113, 230]);
  assert.deepEqual(decodePng(featureGraphic()).pixels, image.pixels);
  assert.equal(inspectAsset('feature-preview.png', feature).height, 500);
});

test('PNG inspection rejects corrupt, truncated, wrong-size, alpha and blank outputs', () => {
  const corrupt = Buffer.from(feature);
  corrupt[corrupt.length - 1] ^= 1;
  for (const bad of [Buffer.from('not an image'), feature.subarray(0, 30), corrupt, Buffer.concat([feature, Buffer.from([0])])]) {
    assert.throws(() => inspectAsset('feature-preview.png', bad));
  }
  assert.throws(() => inspectAsset('feature-preview.png', icon), /dimensions or color type/);
  assert.throws(() => inspectAsset('feature-preview.png', encodePng(1024, Buffer.alloc(1024 * 500 * 4), { height: 500 })), /color type/);
  assert.throws(() => inspectAsset('feature-preview.png', encodePng(1024, Buffer.alloc(1024 * 500 * 3), { height: 500, alpha: false })), /blank/);
  assert.throws(() => encodePng(1024, Buffer.alloc(3), { height: 500, alpha: false }), /do not agree/);
});

test('phone previews satisfy the current minimum count, dimensions and aspect ratio', () => {
  assert.equal(SCREENS.length, 2);
  for (const spec of ASSETS.slice(2)) {
    assert.equal(spec.width, VIEWPORT.width * VIEWPORT.deviceScaleFactor);
    assert.equal(spec.height, VIEWPORT.height * VIEWPORT.deviceScaleFactor);
    assert.ok(Math.min(spec.width, spec.height) >= 320);
    assert.ok(Math.max(spec.width, spec.height) <= 3840);
    assert.ok(Math.max(spec.width, spec.height) <= 2 * Math.min(spec.width, spec.height));
    assert.equal(spec.channels, 3);
  }
  assert.ok(ASSETS.every(({ alt }) => alt.length <= 140 && !/[\u2013\u2014]/u.test(alt)));
});

test('demonstration state is deterministic, schema-compatible and wholly fictional without reader links', () => {
  const state = demonstrationState();
  assert.deepEqual(state, demonstrationState());
  assert.deepEqual(migrate(state), state);
  assert.equal(state.listOrder.length, 2);
  assert.equal(Object.keys(state.issues).length, 12);
  assert.equal(Object.keys(state.read).length, 3);
  assert.deepEqual(state.notes, {});
  assert.deepEqual(state.overrides, {});
  for (const issue of Object.values(state.issues)) {
    assert.ok(issue.issueId < 0 && issue.title.startsWith('Fictional: '));
    for (const field of ['cover', 'url', 'digitalId', 'mu', 'creators']) assert.equal(issue[field], null);
  }
  for (const list of Object.values(state.lists)) {
    assert.equal(list.note, '');
    assert.equal(list.catalogId, null);
    assert.match(list.description, /Made-up/);
  }
});

test('capture allowlist serves only the generated shell and named local fixtures, never readers or real data', () => {
  const assets = new Map([
    ['index.html', Buffer.from('<html></html>')], ['android/app.js', Buffer.from('boot();')],
    ['data/house_of_m.json', Buffer.from('real metadata must not escape')],
    ['open.html', Buffer.from('reader must not open')],
  ]);
  assert.equal(previewResponse(`${ORIGIN}/`, 'GET', assets).body, assets.get('index.html'));
  assert.equal(previewResponse(`${ORIGIN}/android/app.js`, 'GET', assets).body, assets.get('android/app.js'));
  assert.deepEqual(JSON.parse(previewResponse(`${ORIGIN}/data/catalog.json`, 'GET', assets).body), { lists: [], paths: [] });
  assert.equal(previewResponse(`${FIXTURE_API}/health`, 'GET', assets).fixture, 'metadata-health');
  assert.equal(previewResponse(`${ORIGIN}${LOCAL_SERVER_HEALTH_PATH}`, 'GET', assets).status, 204);
  for (const url of [
    'https://bifrost.marvel.com/fixture', 'https://read.marvel.com/', 'https://www.marvel.com/',
    'https://i.annihil.us/fixture.png', 'https://marvel.emreparker.com/v1/health',
    'http://127.0.0.1.example:8787/', `${ORIGIN}/data/house_of_m.json`, `${ORIGIN}/open.html`,
    `${ORIGIN}/android/reader.js`, `${ORIGIN}/sw.js`, `${ORIGIN}/missing.js`,
    `${FIXTURE_API}/issues/1`, `${ORIGIN}/data/catalog.json?unreviewed=1`,
  ]) assert.throws(() => previewResponse(url, 'GET', assets), /Blocked/);
  assert.throws(() => previewResponse(`${ORIGIN}/`, 'POST', assets), /Blocked/);
});

test('manifest labels the renderer and unset approvals without embedding profiles or demonstration state', () => {
  const files = ASSETS.map((spec) => ({ ...spec, bytes: 123, sha256: 'a'.repeat(64) }));
  const args = {
    source: { sourceRevision: 'b'.repeat(40), sourceTree: 'c'.repeat(40), sourceDirty: true, files: [] },
    androidManifestSha256: 'd'.repeat(64), rendererVersion: 'Synthetic test version', files, fixtureResponses: {},
  };
  const result = previewManifest(args);
  assert.equal(result.status, 'preview-unapproved');
  assert.equal(result.releaseAcceptance, false);
  assert.equal(result.renderer.nativeDevice, null);
  assert.equal(result.renderer.nativeBridge, false);
  assert.match(result.renderer.method, /Desktop Edge/);
  assert.ok(Object.values(result.approvals).every((value) => value === false));
  assert.doesNotMatch(JSON.stringify(result), /Users[\\/]|userDataDir|mrt\.state|notes":\{/);
  assert.throws(() => previewManifest({ ...args, files: files.slice(1) }), /inventory/);
  assert.throws(() => previewManifest({ ...args, files: [files[0], files[0], ...files.slice(2)] }), /inventory/);
});

test('only the fulfilled identity-checked bodyless local health response tolerates Chromium abort reporting', () => {
  const url = `${ORIGIN}${LOCAL_SERVER_HEALTH_PATH}`;
  const headers = { 'x-recap-page-server': '1' };
  assert.equal(completedHealthProbe(url, 'net::ERR_ABORTED', 204, headers), true);
  assert.equal(completedHealthProbe(url, 'net::ERR_FAILED', 204, headers), false);
  assert.equal(completedHealthProbe(url, 'net::ERR_ABORTED', undefined, undefined), false);
  assert.equal(completedHealthProbe(url, 'net::ERR_ABORTED', 500, headers), false);
  assert.equal(completedHealthProbe(url, 'net::ERR_ABORTED', 204, {}), false);
  assert.equal(completedHealthProbe(`${ORIGIN}/open.html`, 'net::ERR_ABORTED', 204, headers), false);
});
