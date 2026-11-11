import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { HOST, createStaticServer } from '../server.mjs';
import { SIZES, SVG_CONTENT, drawIcon, iconPath, svgPath } from '../scripts/build-icons.mjs';

// The manifest is what makes the browser offer to install this, and every claim in it is about a
// file or an origin rather than about taste. A manifest that names an icon which is not there, or
// that is served as something other than a manifest, fails silently: the install control simply
// does not appear, and there is nothing on screen to say why. So each claim is checked against the
// thing it claims about.
//
// The origin assertions are Constraint 5 in a second place. `start_url` and `scope` decide where an
// installed window lands, and an absolute address written here would pin that window to whichever
// port was typed on the day the manifest was written, which is a different storage bucket and so a
// silent loss of reading progress for anyone running on another port.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const MANIFEST_FILE = join(SRC, 'manifest.webmanifest');
const manifest = JSON.parse(readFileSync(MANIFEST_FILE, 'utf8'));

function fetchPath(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: HOST, port, path, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.setTimeout(5000, () => req.destroy(new Error(`no complete reply for ${path}`)));
    req.on('error', reject);
    req.end();
  });
}

async function withServer(body) {
  const server = createStaticServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, HOST, resolve);
  });
  try {
    return await body(server.address().port);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}

// Enough of a PNG reader to answer what the manifest asserts. IHDR is fixed at byte 8 and the
// image data is the concatenation of every IDAT, which our encoder writes as one.
function decodePng(bytes) {
  assert.deepEqual(
    [...bytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    'not a PNG',
  );
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  const depth = bytes[24];
  const colour = bytes[25];

  const idat = [];
  let at = 8;
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const type = bytes.toString('ascii', at + 4, at + 8);
    if (type === 'IDAT') idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += length + 12;
  }
  const raw = inflateSync(Buffer.concat(idat));

  // Every row is filter 0, which the encoder's comment explains and this asserts rather than
  // assumes: a row under any other filter would need reversing, and quietly comparing filtered
  // bytes against unfiltered ones would report a difference that is not there.
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    assert.equal(raw[row], 0, `row ${y} is not filter 0`);
    raw.copy(pixels, y * stride, row + 1, row + 1 + stride);
  }
  return { width, height, depth, colour, pixels };
}

test('the page asks the browser to install it', () => {
  const html = readFileSync(join(SRC, 'index.html'), 'utf8');
  assert.match(html, /<link rel="manifest" href="\.\/manifest\.webmanifest"/, 'index.html does not reference the manifest');
});

test('the manifest carries what Chromium requires before it offers an install', () => {
  assert.equal(manifest.name, 'Recap Page');
  // short_name is what a Start menu or Dock label shows, where the full name does not fit. It is
  // required to be shorter than the name, or it is not doing the one job it has.
  assert.equal(manifest.short_name, 'Recap');
  assert.ok(manifest.short_name.length < manifest.name.length, 'short_name is no shorter than name');
  assert.equal(manifest.display, 'standalone');

  // Chromium wants both of these present at these exact sizes with purpose "any". A maskable
  // icon is deliberately absent: it is cropped to a circle on Android, and this app cannot run
  // on a phone at all, because it needs the local server on the same machine.
  for (const size of SIZES) {
    const icon = manifest.icons.find((i) => i.sizes === `${size}x${size}`);
    assert.ok(icon, `the manifest names no ${size}x${size} icon`);
    assert.equal(icon.type, 'image/png');
    assert.equal(icon.purpose, 'any');
  }
});

test('nothing in the manifest pins an origin, so an installed window follows the port it was installed from', () => {
  assert.deepEqual([manifest.id, manifest.start_url, manifest.scope], ['/', '/', '/']);
  const paths = [manifest.id, manifest.start_url, manifest.scope, ...manifest.icons.map((i) => i.src)];
  for (const path of paths) {
    assert.ok(path.startsWith('/'), `${path} is not origin-relative`);
    assert.doesNotMatch(path, /^\/\//, `${path} names another host`);
  }
});

test('every icon the manifest names is on disk at the size it claims', () => {
  for (const icon of manifest.icons) {
    const file = join(SRC, icon.src.replace(/^\//, ''));
    const png = decodePng(readFileSync(file));
    const [width, height] = icon.sizes.split('x').map(Number);
    assert.equal(png.width, width, `${icon.src} is ${png.width} wide, not ${width}`);
    assert.equal(png.height, height, `${icon.src} is ${png.height} tall, not ${height}`);
    assert.equal(png.depth, 8);
    assert.equal(png.colour, 6, `${icon.src} is not 8-bit RGBA, so its rounded corners are not transparent`);
  }
});

// Compared as pixels rather than as bytes. The compressed form depends on the zlib the build ran
// against, and this suite runs on two Node versions, so asserting on file bytes would go red for a
// reason that has nothing to do with the picture.
test('the committed icons are what the generator draws', () => {
  for (const size of SIZES) {
    const file = iconPath(size);
    const png = decodePng(readFileSync(file));
    assert.deepEqual(
      [...png.pixels],
      [...drawIcon(size)],
      `${basename(file)} is not what scripts/build-icons.mjs draws. Run npm run icons.`,
    );
  }
});

test('the generated SVG is the favicon, rail mark, About lockup and launcher mark, from the same source as the PNGs', () => {
  const html = readFileSync(join(SRC, 'index.html'), 'utf8');
  const launcher = readFileSync(join(SRC, 'open.html'), 'utf8');
  assert.equal(readFileSync(svgPath, 'utf8').replace(/\r\n/g, '\n'), SVG_CONTENT);
  assert.match(html, /<link rel="icon" href="\.\/icons\/icon\.svg" type="image\/svg\+xml"/);
  assert.match(html, /<img class="mark" src="\.\/icons\/icon\.svg" alt="" aria-hidden="true"/);
  assert.match(html, /<img class="about-icon" src="\.\/icons\/icon\.svg" alt="" aria-hidden="true"/);
  assert.equal([...html.matchAll(/\.\/icons\/icon\.svg/g)].length, 3);
  assert.match(launcher, /<img class="mark" src="\.\/icons\/icon\.svg" alt="" aria-hidden="true"/);
  assert.match(SVG_CONTENT, /<rect x="8" y="5\.5" width="16" height="7\.5" rx="1\.625" fill="#ffffff"/);
  assert.match(SVG_CONTENT, /<polygon points="8,15\.5 16,15\.5 13\.25,26\.5 8,26\.5" fill="#ffffff"/);
  assert.match(SVG_CONTENT, /<polygon points="18,15\.5 24,15\.5 24,26\.5 15\.75,26\.5" fill="#9e71e6"/);
});

test('the approved purple page mark is drawn inside transparent corners', () => {
  const size = 192;
  const pixels = drawIcon(size);
  const at = (x, y) => pixels.subarray((y * size + x) * 4, (y * size + x) * 4 + 4);

  assert.deepEqual([...at(0, 0)], [0, 0, 0, 0], 'the top left corner is not transparent');
  assert.equal(at(size / 2, size / 2)[3], 255, 'the middle of the mark is not opaque');

  const wanted = new Map([
    ['109,40,217', 0],
    ['255,255,255', 0],
    ['158,113,230', 0],
  ]);
  for (let i = 0; i < size * size; i++) {
    const [r, g, b, a] = pixels.subarray(i * 4, i * 4 + 4);
    if (a !== 255) continue;
    const key = `${r},${g},${b}`;
    if (wanted.has(key)) wanted.set(key, wanted.get(key) + 1);
  }
  for (const [colour, count] of wanted) {
    assert.ok(count > 100, `${colour} covers only ${count} pixels`);
  }
});

test('the server hands the manifest and the icons back as themselves', async () => {
  await withServer(async (port) => {
    const res = await fetchPath(port, '/manifest.webmanifest');
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/manifest+json');
    assert.deepEqual(JSON.parse(res.body.toString('utf8')), manifest);

    for (const icon of manifest.icons) {
      const got = await fetchPath(port, icon.src);
      assert.equal(got.status, 200, `${icon.src} is not served`);
      assert.equal(got.headers['content-type'], 'image/png');
    }
  });
});
