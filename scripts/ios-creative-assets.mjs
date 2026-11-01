// The App Store's optional creative assets for the iOS product page: a product page header and a
// search results image. Both are drawn here from geometry, the way scripts/build-icons.mjs draws the
// app icon, and the search results image places three of the committed iPhone screenshots from
// docs/ios-app-store-assets on that artwork. Nothing is hand edited, and nothing is uploaded.
//
//   node scripts/ios-creative-assets.mjs
//
// Apple's specification, retrieved 2026-10-31:
// https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications
// The header is 3840 x 1646 and the search results image 3840 x 2560, PNG with no alpha channel.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';
import { crc32, drawIcon, encodePng } from './build-icons.mjs';
import { sha256 } from './play-assets.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const ASSET_DIR = join(ROOT, 'docs', 'ios-app-store-assets');
export const OUTPUT_DIR = join(ASSET_DIR, 'creative');
export const SCREEN_DIR = join(ASSET_DIR, 'iphone-6.9');

// Read from the "Art Safe Area" layer bounds in Apple's two static Photoshop templates, downloaded
// 2026-10-31 and not committed. Each rectangle is centered on its canvas. Everything a visitor must
// see sits inside it; what lies outside is decoration that may be cropped.
export const TEMPLATES = Object.freeze({
  header: {
    url: 'https://devimages-cdn.apple.com/design/resources/download/app-store/creative_assets-product_page_header_template-static.psd',
    sha256: '4200f416adcf3affb70d5847c1d0554fc39b7405110ec527bdea92bfb82f93b0',
    layer: 'Art Safe Area',
  },
  search: {
    url: 'https://devimages-cdn.apple.com/design/resources/download/app-store/creative_assets-search_results_template-static.psd',
    sha256: '7bb57a3c33cc4402d1c82e85a0211cf0f2f2b1c05cf7f36e4710092226dea056',
    layer: 'Art Safe Area',
  },
});

// Left and right edges of the iPhone screens, chosen for content free of real comic names: a
// reading list partway through in the middle, with the library and backup screens either side.
export const SEARCH_SCREENS = Object.freeze(['06-library.png', '03-reading-list.png', '07-backup-settings.png']);

export const ASSETS = Object.freeze([
  {
    file: 'product-page-header.png', template: 'header', width: 3840, height: 1646,
    safeArea: { left: 1097, top: 493, right: 2743, bottom: 1154 },
    alt: 'The app icon between a row of white checked tiles and lilac unread tiles on deep purple.',
  },
  {
    file: 'search-results.png', template: 'search', width: 3840, height: 2560,
    safeArea: { left: 836, top: 765, right: 3004, bottom: 1795 },
    alt: 'Three iPhone screens of the app with made-up reading lists on deep purple.',
  },
]);

const PURPLE = [0x6d, 0x28, 0xd9];
const LILAC = [0x9e, 0x71, 0xe6];
const WHITE = [0xff, 0xff, 0xff];
// The brand purple at 45 percent brightness, so the purple icon still reads against its ground.
const DEEP = PURPLE.map((c) => Math.round(c * 0.45));
const BEZEL = [20, 16, 28];
const BLACK = [0, 0, 0];

function fail(message) {
  throw new Error(`creative assets: ${message}`);
}

function canvas(width, height) {
  return { width, height, pixels: new Float32Array(width * height * 3) };
}

// A radial glow of the brand purple over the deep ground, centered on the safe area. The 4 x 4
// ordered dither keeps a gradient this wide from banding into visible steps at 8 bits.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
function background(image, radius) {
  const { width, height, pixels } = image;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const d = Math.hypot(x + 0.5 - width / 2, (y + 0.5 - height / 2) * 1.6) / radius;
      const t = 0.7 * Math.max(0, 1 - d) ** 2;
      const i = (y * width + x) * 3;
      const dither = (BAYER[(y % 4) * 4 + (x % 4)] + 0.5) / 16 - 0.5;
      for (let c = 0; c < 3; c++) pixels[i + c] = DEEP[c] + (PURPLE[c] - DEEP[c]) * t + dither;
    }
  }
}

// Paints color at the coverage a signed distance gives. Soft spreads the edge for shadows.
function paint(image, box, distance, color, alpha = 1, soft = 1) {
  const { width, height, pixels } = image;
  const x0 = Math.max(0, Math.floor(box[0])), x1 = Math.min(width, Math.ceil(box[2]));
  const y0 = Math.max(0, Math.floor(box[1])), y1 = Math.min(height, Math.ceil(box[3]));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const coverage = Math.min(1, Math.max(0, 0.5 - distance(x + 0.5, y + 0.5) / soft)) * alpha;
      if (!coverage) continue;
      const i = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) pixels[i + c] += (color[c] - pixels[i + c]) * coverage;
    }
  }
}

const roundedRect = (cx, cy, w, h, r) => (x, y) => {
  const qx = Math.abs(x - cx) - w / 2 + r;
  const qy = Math.abs(y - cy) - h / 2 + r;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
};

const capsule = (ax, ay, bx, by, r) => (x, y) => {
  const px = x - ax, py = y - ay, dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, (px * dx + py * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - dx * t, py - dy * t) - r;
};

function rectBox(cx, cy, w, h, pad = 2) {
  return [cx - w / 2 - pad, cy - h / 2 - pad, cx + w / 2 + pad, cy + h / 2 + pad];
}

// A tile stands for one issue in a reading order: white with a purple check once read, lilac until.
function tile(image, cx, cy, size, read, alpha) {
  const w = size, h = size * 4 / 3, r = size * 0.12;
  paint(image, rectBox(cx, cy, w, h), roundedRect(cx, cy, w, h, r), read ? WHITE : LILAC, alpha);
  if (!read) return;
  const s = size / 300;
  const stroke = 22 * s;
  const ax = cx - 62 * s, ay = cy + 4 * s, bx = cx - 18 * s, by = cy + 48 * s, ex = cx + 70 * s, ey = cy - 52 * s;
  const box = [cx - 100 * s, cy - 90 * s, cx + 100 * s, cy + 90 * s];
  paint(image, box, (x, y) => Math.min(capsule(ax, ay, bx, by, stroke)(x, y), capsule(bx, by, ex, ey, stroke)(x, y)), PURPLE, alpha);
}

function tileRow(image, cy, size, step, gap, alpha) {
  const cx = image.width / 2;
  for (let k = 1; cx - gap - (k - 1) * step + size > 0; k++) {
    const fade = alpha * Math.max(0.18, 1 - (k - 1) * 0.24);
    tile(image, cx - gap - (k - 1) * step, cy, size, true, fade);
    tile(image, cx + gap + (k - 1) * step, cy, size, false, fade);
  }
}

function placeIcon(image, cx, cy, size) {
  paint(image, rectBox(cx, cy + size * 0.06, size, size, size * 0.12),
    roundedRect(cx, cy + size * 0.06, size, size, size * 0.22), BLACK, 0.45, size * 0.12);
  const icon = drawIcon(size);
  const left = Math.round(cx - size / 2), top = Math.round(cy - size / 2);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const s = (y * size + x) * 4;
      const a = icon[s + 3] / 255;
      if (!a) continue;
      const i = ((top + y) * image.width + left + x) * 3;
      for (let c = 0; c < 3; c++) image.pixels[i + c] += (icon[s + c] - image.pixels[i + c]) * a;
    }
  }
}

// Area-weighted resampling, so a screenshot shrinks without aliasing its text.
function resample(source, sw, sh, dw, dh) {
  const weights = (from, to) => {
    const scale = from / to;
    return Array.from({ length: to }, (_, d) => {
      const start = d * scale, end = start + scale, taps = [];
      for (let s = Math.floor(start); s < Math.min(from, Math.ceil(end)); s++) {
        taps.push([s, (Math.min(end, s + 1) - Math.max(start, s)) / scale]);
      }
      return taps;
    });
  };
  const wx = weights(sw, dw), wy = weights(sh, dh);
  const rows = new Float32Array(dw * sh * 3);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < dw; x++) {
      for (const [s, w] of wx[x]) {
        for (let c = 0; c < 3; c++) rows[(y * dw + x) * 3 + c] += source[(y * sw + s) * 3 + c] * w;
      }
    }
  }
  const out = new Float32Array(dw * dh * 3);
  for (let y = 0; y < dh; y++) {
    for (const [s, w] of wy[y]) {
      for (let x = 0; x < dw * 3; x++) out[y * dw * 3 + x] += rows[s * dw * 3 + x] * w;
    }
  }
  return out;
}

function phone(image, screen, cx, cy, screenHeight) {
  const screenWidth = Math.round(screenHeight * screen.width / screen.height);
  const bezel = Math.round(screenHeight * 0.018);
  const w = screenWidth + bezel * 2, h = screenHeight + bezel * 2;
  // iPhone 17 Pro screen corners measure about an eighth of the screen's width.
  const radius = screenWidth * 0.125;
  paint(image, rectBox(cx, cy + 30, w, h, 90), roundedRect(cx, cy + 30, w, h, radius + bezel), BLACK, 0.5, 80);
  paint(image, rectBox(cx, cy, w, h), roundedRect(cx, cy, w, h, radius + bezel), BEZEL);
  const pixels = resample(screen.pixels, screen.width, screen.height, screenWidth, screenHeight);
  const left = Math.round(cx - screenWidth / 2), top = Math.round(cy - screenHeight / 2);
  const clip = roundedRect(screenWidth / 2, screenHeight / 2, screenWidth, screenHeight, radius);
  for (let y = 0; y < screenHeight; y++) {
    for (let x = 0; x < screenWidth; x++) {
      const coverage = Math.min(1, Math.max(0, 0.5 - clip(x + 0.5, y + 0.5)));
      if (!coverage) continue;
      const i = ((top + y) * image.width + left + x) * 3, s = (y * screenWidth + x) * 3;
      for (let c = 0; c < 3; c++) image.pixels[i + c] += (pixels[s + c] - image.pixels[i + c]) * coverage;
    }
  }
  return { left: cx - w / 2, top: cy - h / 2, right: cx + w / 2, bottom: cy + h / 2 };
}

function encode(image) {
  const bytes = Buffer.alloc(image.pixels.length);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Math.max(0, Math.min(255, Math.round(image.pixels[i])));
  return encodePng(image.width, bytes, { height: image.height, alpha: false, srgb: true });
}

function within(box, safe) {
  if (box.left < safe.left || box.top < safe.top || box.right > safe.right || box.bottom > safe.bottom) {
    fail(`key content ${JSON.stringify(box)} leaves the safe area ${JSON.stringify(safe)}`);
  }
}

// One idea: the app keeps your place in a reading order. Read tiles lead in from the left, unread
// ones carry on to the right, and the icon sits where the reader is now.
export function productPageHeader() {
  const spec = ASSETS[0];
  const image = canvas(spec.width, spec.height);
  background(image, 1500);
  const cy = (spec.safeArea.top + spec.safeArea.bottom) / 2;
  tileRow(image, cy, 300, 380, 520, 1);
  const size = 560;
  placeIcon(image, image.width / 2, cy, size);
  within({ left: image.width / 2 - size / 2, top: cy - size / 2, right: image.width / 2 + size / 2, bottom: cy + size / 2 }, spec.safeArea);
  return encode(image);
}

// The real interface, so the app's purpose is plain at a glance: three iPhone screens, all inside
// the safe area, over the same tile row the header uses, faded so it stays behind them.
export function searchResults(screens) {
  const spec = ASSETS[1];
  if (screens.length !== 3) fail('the search results image needs three screens');
  const image = canvas(spec.width, spec.height);
  background(image, 2200);
  const safe = spec.safeArea;
  const cy = (safe.top + safe.bottom) / 2;
  tileRow(image, cy, 420, 520, 900, 0.35);
  const screenHeight = 960;
  const step = 640;
  screens.forEach((screen, k) => within(phone(image, screen, image.width / 2 + (k - 1) * step, cy, screenHeight), safe));
  return encode(image);
}

// The #1039 captures are 8-bit RGB without alpha. Ancillary chunks such as a color profile are
// read past rather than refused, and their names are reported so the manifest can record them.
export function decodeScreen(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) fail('not a PNG');
  let header = null;
  const data = [], ancillary = [];
  let at = 8, ended = false;
  while (at < bytes.length && !ended) {
    if (at + 12 > bytes.length) fail('truncated chunk');
    const length = bytes.readUInt32BE(at), end = at + length + 12;
    if (end > bytes.length) fail('invalid chunk length');
    const type = bytes.toString('ascii', at + 4, at + 8);
    if (crc32(bytes.subarray(at + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail(`bad ${type} checksum`);
    if (type === 'IHDR') header = bytes.subarray(at + 8, end - 4);
    else if (type === 'IDAT') data.push(bytes.subarray(at + 8, end - 4));
    else if (type === 'IEND') ended = true;
    else if (bytes[at + 4] & 0x20) ancillary.push(type);
    else fail(`unsupported critical chunk ${type}`);
    at = end;
  }
  if (!header || !ended || !data.length) fail('incomplete PNG');
  const width = header.readUInt32BE(0), height = header.readUInt32BE(4);
  if (header[8] !== 8 || header[9] !== 2 || header[10] || header[11] || header[12]) fail('screens must be 8-bit RGB without alpha');
  const stride = width * 3;
  const raw = inflateSync(Buffer.concat(data));
  if (raw.length !== (stride + 1) * height) fail('invalid pixel data length');
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) fail('invalid row filter');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const left = x >= 3 ? pixels[i - 3] : 0, up = y ? pixels[i - stride] : 0;
      const corner = y && x >= 3 ? pixels[i - stride - 3] : 0;
      const p = left + up - corner;
      const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? (left + up) >> 1 : a <= b && a <= c ? left : b <= c ? up : corner;
      pixels[i] = (raw[y * (stride + 1) + x + 1] + predictor) & 0xff;
    }
  }
  return { width, height, ancillary, pixels };
}

export function inspectOutput(bytes, spec) {
  const image = decodeScreen(bytes);
  if (image.width !== spec.width || image.height !== spec.height) fail(`${spec.file} is not ${spec.width} x ${spec.height}`);
  if (image.ancillary.join() !== 'sRGB') fail(`${spec.file} carries unexpected metadata`);
  return image;
}

export function build({ screenDir = SCREEN_DIR, output = OUTPUT_DIR } = {}) {
  const inputs = SEARCH_SCREENS.map((file) => {
    const path = join(screenDir, file);
    const bytes = readFileSync(path);
    const screen = decodeScreen(bytes);
    return { screen, row: { file: relative(ROOT, path).replaceAll('\\', '/'), width: screen.width, height: screen.height, sha256: sha256(bytes), chunks: screen.ancillary } };
  });
  const outputs = [productPageHeader(), searchResults(inputs.map(({ screen }) => screen))];
  mkdirSync(output, { recursive: true });
  const files = ASSETS.map((spec, k) => {
    inspectOutput(outputs[k], spec);
    writeFileSync(join(output, spec.file), outputs[k]);
    const template = TEMPLATES[spec.template];
    return {
      file: spec.file, width: spec.width, height: spec.height, bytes: outputs[k].length, sha256: sha256(outputs[k]),
      alt: spec.alt, safeArea: { ...spec.safeArea, source: `${template.layer} layer bounds in ${template.url}`, templateSha256: template.sha256 },
      inputs: k === 0 ? ['scripts/ios-creative-assets.mjs', 'scripts/build-icons.mjs'] : ['scripts/ios-creative-assets.mjs', 'scripts/build-icons.mjs', ...inputs.map(({ row }) => row.file)],
    };
  });
  const manifest = {
    schemaVersion: 1,
    specification: 'https://developer.apple.com/help/app-store-connect/reference/app-information/creative-assets-specifications',
    command: 'node scripts/ios-creative-assets.mjs',
    method: 'Drawn from geometry in the brand colors of src/icons/icon.svg. No text, no cover art and no hand editing.',
    screens: inputs.map(({ row }) => row),
    files,
  };
  writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const at = process.argv.indexOf('--screens');
  const manifest = build(at > 0 ? { screenDir: resolve(process.argv[at + 1]) } : {});
  for (const row of manifest.files) console.log(`${row.file} ${row.width} x ${row.height} ${row.bytes} bytes ${row.sha256}`);
}
