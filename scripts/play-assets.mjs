import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { drawIcon, encodePng, crc32 } from './build-icons.mjs';
import { createEmptyState, createList, normalizeIssue, markRead } from '../src/js/lib/model.js';
import { HOST, DEFAULT_PORT } from '../server.mjs';
import { LOCAL_SERVER_HEALTH_PATH, LOCAL_SERVER_HEADER_NAME, LOCAL_SERVER_HEADER_VALUE } from '../src/js/lib/localServer.js';

export const ORIGIN = `http://${HOST}:${DEFAULT_PORT}`;
export const FIXTURE_API = `${ORIGIN}/__play_preview_api__`;
export const VIEWPORT = Object.freeze({ width: 360, height: 640, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
export const SCREENS = Object.freeze([
  { file: '01-library-preview.png', route: '#/library', view: 'view-library', text: ['Library', 'Fictional: Lantern Harbor', 'Fictional: Paper Moons'] },
  { file: '02-reading-preview.png', route: '#/read/play-lantern', view: 'view-read', scroll: '#hero', heading: '#hero-title', text: ['Fictional: Lantern Harbor', '3 of 8 read', 'Cover art off'] },
]);
export const ASSETS = Object.freeze([
  { file: 'icon-preview.png', width: 512, height: 512, channels: 4, alt: 'Original purple page mark on a square background.' },
  { file: 'feature-preview.png', width: 1024, height: 500, channels: 3, alt: 'An original abstract reading checklist with completed rows and a progress bar in purple and lilac.' },
  ...SCREENS.map(({ file, view }) => ({
    file, width: 1080, height: 1920, channels: 3,
    alt: view === 'view-library' ? 'Android library layout with fictional demonstration lists.'
      : 'Android next-issue layout with a fictional issue and original cover-off placeholder.',
  })),
]);
const PURPLE = [109, 40, 217];
const LILAC = [158, 113, 230];
const WHITE = [255, 255, 255];
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function playIcon() {
  const pixels = drawIcon(512);
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3] / 255;
    for (let c = 0; c < 3; c++) pixels[i + c] = Math.round(pixels[i + c] * alpha + PURPLE[c] * (1 - alpha));
    pixels[i + 3] = 255;
  }
  return encodePng(512, pixels, { srgb: true });
}

function rounded(x, y, left, top, width, height, radius) {
  const dx = x - Math.max(left + radius, Math.min(x, left + width - radius));
  const dy = y - Math.max(top + radius, Math.min(y, top + height - radius));
  return dx * dx + dy * dy <= radius * radius;
}

export function featureGraphic() {
  const pixels = Buffer.alloc(1024 * 500 * 3);
  // An abstract checklist, not comic art, a simulated screen or a second copy of the app icon.
  const colourAt = (x, y) => {
    if (rounded(x, y, 218, 84, 588, 332, 28)) {
      for (let row = 0; row < 3; row++) {
        const top = 126 + row * 76;
        if (rounded(x, y, 260, top, 44, 44, 10)) {
          if (row < 2 && ((x >= 271 && x < 280 && y >= top + 20 && y < top + 30)
            || (x >= 280 && x < 291 && y >= top + 12 && y < top + 30))) return WHITE;
          return row < 2 ? PURPLE : LILAC;
        }
        if (rounded(x, y, 336, top + 4, 350 - row * 52, 14, 7)) return PURPLE;
        if (rounded(x, y, 336, top + 28, 240, 10, 5)) return LILAC;
      }
      if (rounded(x, y, 260, 370, 504, 10, 5)) return x < 596 ? PURPLE : LILAC;
      return WHITE;
    }
    if (rounded(x, y, 164, 130, 48, 240, 20) || rounded(x, y, 812, 130, 48, 240, 20)) return LILAC;
    return PURPLE;
  };
  for (let y = 0; y < 500; y++) {
    for (let x = 0; x < 1024; x++) {
      const channels = [0, 0, 0];
      for (const dy of [.25, .75]) {
        for (const dx of [.25, .75]) {
          const colour = colourAt(x + dx, y + dy);
          for (let c = 0; c < 3; c++) channels[c] += colour[c];
        }
      }
      for (let c = 0; c < 3; c++) pixels[(y * 1024 + x) * 3 + c] = Math.round(channels[c] / 4);
    }
  }
  return encodePng(1024, pixels, { height: 500, alpha: false, srgb: true });
}

export function demonstrationState() {
  let state = createEmptyState();
  let issueId = -1;
  for (const [id, name, count] of [
    ['play-lantern', 'Fictional: Lantern Harbor', 8],
    ['play-moons', 'Fictional: Paper Moons', 4],
  ]) {
    const itemIds = [];
    for (let number = 1; number <= count; number++, issueId--) {
      itemIds.push(issueId);
      state.issues[issueId] = normalizeIssue({
        issueId, title: `${name} #${number}`, number, seriesName: name,
        source: 'manual', hydrated: true,
      });
    }
    state = createList(state, {
      id, name, itemIds, description: 'Made-up issues for a layout preview. Not a published reading list.',
    });
    state.lists[id].created = Date.UTC(2026, 0, 1);
  }
  for (const id of [-1, -2, -3]) state = markRead(state, id, true, Date.UTC(2026, 0, 2));
  return state;
}

export function shellPath(path) {
  return path === 'index.html' || path === 'styles.css' || path === 'manifest.webmanifest'
    || /^js\/[a-zA-Z0-9_./-]+\.js$/.test(path)
    || /^android\/(?:app|bridge|mobile-ui)\.js$/.test(path) || path === 'android/mobile.css'
    || /^icons\/icon(?:-(?:192|512)\.png|\.svg)$/.test(path) || path === 'icons/ui.svg';
}

export function previewResponse(url, method, assets) {
  const target = new URL(url);
  if (method !== 'GET' || target.origin !== ORIGIN || target.username || target.password || target.search) {
    throw new Error('Blocked request outside the Play preview allowlist');
  }
  const path = target.pathname === '/' ? 'index.html' : target.pathname.slice(1);
  const json = (value) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
  if (target.href === `${FIXTURE_API}/health`) return { ...json({ issue_count: 12 }), fixture: 'metadata-health' };
  if (target.pathname === LOCAL_SERVER_HEALTH_PATH) {
    return { status: 204, headers: { [LOCAL_SERVER_HEADER_NAME]: LOCAL_SERVER_HEADER_VALUE }, fixture: 'local-health' };
  }
  if (path === 'data/catalog.json') return { ...json({ lists: [], paths: [] }), fixture: 'empty-catalog' };
  if (!shellPath(path) || !assets.has(path)) throw new Error(`Blocked unapproved Play preview resource: ${path}`);
  const contentType = path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css'
    : path.endsWith('.svg') ? 'image/svg+xml' : path.endsWith('.png') ? 'image/png'
      : path.endsWith('.webmanifest') ? 'application/manifest+json' : 'text/html';
  return { status: 200, contentType, body: assets.get(path) };
}

export function completedHealthProbe(url, error, status, headers) {
  return url === `${ORIGIN}${LOCAL_SERVER_HEALTH_PATH}` && error === 'net::ERR_ABORTED'
    && status === 204 && headers?.[LOCAL_SERVER_HEADER_NAME.toLowerCase()] === LOCAL_SERVER_HEADER_VALUE;
}

function requireValue(condition, message) {
  if (!condition) throw new Error(`Play asset: ${message}`);
}

export function decodePng(bytes) {
  requireValue(Buffer.isBuffer(bytes) && bytes.subarray(0, 8).equals(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  ), 'not a PNG');
  const chunks = [];
  const data = [];
  let header;
  let at = 8;
  while (at < bytes.length) {
    requireValue(at + 12 <= bytes.length, 'truncated chunk');
    const length = bytes.readUInt32BE(at);
    const end = at + length + 12;
    requireValue(end <= bytes.length, 'invalid chunk length');
    const type = bytes.toString('ascii', at + 4, at + 8);
    const value = bytes.subarray(at + 8, end - 4);
    requireValue(['IHDR', 'sRGB', 'IDAT', 'IEND'].includes(type), 'unexpected PNG metadata');
    requireValue(crc32(bytes.subarray(at + 4, end - 4)) === bytes.readUInt32BE(end - 4), 'bad chunk checksum');
    if (type === 'IHDR') {
      requireValue(chunks.length === 0 && length === 13, 'invalid IHDR');
      header = value;
    } else if (type === 'IDAT') {
      requireValue(header && !chunks.includes('IEND'), 'misplaced image data');
      data.push(value);
    } else if (type === 'sRGB') {
      requireValue(header && !data.length && !chunks.includes('sRGB') && length === 1 && value[0] <= 3, 'invalid sRGB');
    } else {
      requireValue(data.length && length === 0 && end === bytes.length, 'invalid IEND');
    }
    chunks.push(type);
    at = end;
  }
  requireValue(header && chunks.at(-1) === 'IEND', 'incomplete PNG');
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  requireValue(width > 0 && height > 0 && width <= 3840 && height <= 3840, 'invalid dimensions');
  requireValue(header[8] === 8 && [2, 6].includes(header[9]) && header.subarray(10).every((v) => v === 0), 'unsupported PNG encoding');
  const channels = header[9] === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(data), { maxOutputLength: (stride + 1) * height });
  requireValue(raw.length === (stride + 1) * height, 'invalid pixel length');
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    requireValue(filter <= 4, 'invalid row filter');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const left = x >= channels ? pixels[i - channels] : 0;
      const up = y ? pixels[i - stride] : 0;
      const corner = y && x >= channels ? pixels[i - stride - channels] : 0;
      const p = left + up - corner;
      const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : a <= b && a <= c ? left : b <= c ? up : corner;
      pixels[i] = raw[y * (stride + 1) + x + 1] + predictor;
    }
  }
  return { width, height, channels, chunks, pixels };
}

export function inspectAsset(file, bytes) {
  const spec = ASSETS.find((asset) => asset.file === file);
  requireValue(spec, 'unrecognized output file');
  const image = decodePng(bytes);
  requireValue(image.width === spec.width && image.height === spec.height
    && image.channels === spec.channels, `${file} dimensions or color type do not match`);
  if (spec.channels === 4) {
    requireValue(bytes.length <= 1024 * 1024 && image.chunks.includes('sRGB'), 'icon exceeds size limit or lacks sRGB');
    requireValue(image.pixels.every((v, i) => i % 4 !== 3 || v === 255), 'icon must be full-bleed opaque');
  }
  const first = image.pixels.subarray(0, image.channels);
  let different = 0;
  for (let i = 0; i < image.pixels.length; i += image.channels) {
    if (!image.pixels.subarray(i, i + 3).equals(first.subarray(0, 3))) different++;
  }
  requireValue(different > spec.width * spec.height * .05, `${file} is blank or nearly blank`);
  return { ...spec, bytes: bytes.length, sha256: sha256(bytes) };
}

export function previewManifest({ source, androidManifestSha256, rendererVersion, files, fixtureResponses }) {
  requireValue(files.length === ASSETS.length && ASSETS.every((spec) => files.some((file) => (
    file.file === spec.file && file.width === spec.width && file.height === spec.height
      && file.channels === spec.channels && /^[a-f0-9]{64}$/.test(file.sha256)
  ))) && new Set(files.map((file) => file.file)).size === files.length, 'incomplete asset inventory');
  return {
    schemaVersion: 1, status: 'preview-unapproved', releaseAcceptance: false,
    source, androidManifestSha256,
    renderer: {
      name: 'Microsoft Edge', version: rendererVersion,
      method: 'Desktop Edge rendering generated Android web assets with an emulated phone viewport.',
      viewport: VIEWPORT, nativeDevice: null, nativeBridge: false,
      screens: SCREENS.map(({ file, route, scroll }) => ({ file, route, scrollTarget: scroll ?? 'top' })),
    },
    data: {
      method: 'Wholly fictional negative-ID issue records, synthetic progress, empty catalog, covers off, no notes.',
      sha256: sha256(JSON.stringify(demonstrationState())),
    },
    network: { method: 'Every page request fulfilled locally from an allowlist or aborted; no request continued to the network.', fixtureResponses },
    approvals: {
      finalScreenshots: false, rights: false, privacy: false, releaseArtifact: false, owner: false,
    },
    files,
  };
}
