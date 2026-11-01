// App Store product page screenshots for the iOS app, captured on GitHub's macOS runners because
// there is no Mac here. The iOS workflow runs this in three modes, only when dispatched by hand with
// app_store_screenshots set:
//
//   fixtures <set>   prints that set's screens, each with the page seed and probe the UI test runs
//   device <set>     reads `xcrun simctl list devices available --json` on stdin and prints the
//                    chosen Simulator as JSON
//   finish           checks every exported attachment, removes the alpha channel and writes the
//                    images and their manifest
//
// The data is the Google Play listing's fictional demonstration state, so the two stores show the
// same made-up lists: negative issue ids, covers off, no notes and no account.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync, inflateSync } from 'node:zlib';
import { crc32 } from './build-icons.mjs';
import { demonstrationState, FIXTURE_API, previewResponse, sha256 } from './play-assets.mjs';
import { DEFAULT_BASE } from '../src/js/api.js';
import { createEmptyState } from '../src/js/lib/model.js';
import { KEY, SETTINGS_KEY } from '../src/js/storage.js';

// Apple's screenshot specification, retrieved 2026-10-31:
// https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/
export const SETS = Object.freeze([
  {
    folder: 'ipad-13', slot: '13-inch iPad', width: 2064, height: 2752, screenCount: 7,
    match: (name) => name.startsWith('iPad Pro 13-inch'), wanted: 'an iPad Pro 13-inch Simulator',
  },
  {
    folder: 'iphone-6.3', slot: 'iPhone with Dynamic Island (medium display)', width: 1206, height: 2622, screenCount: 8,
    match: (name) => name === 'iPhone 17 Pro', wanted: 'the iPhone 17 Pro Simulator',
  },
  {
    folder: 'iphone-6.9', slot: '6.9-inch iPhone (large display)', width: 1320, height: 2868, screenCount: 8,
    match: (name) => name === 'iPhone 17 Pro Max', wanted: 'the iPhone 17 Pro Max Simulator',
  },
]);

export const SCREENS = Object.freeze([
  {
    name: '01-home', route: '#/home', view: 'view-home', theme: 'dark', state: 'empty',
    text: ['RECAP PAGE!'], dismissNotice: true,
    caption: 'Start from Home: guided reading paths, storylines and character spotlights.',
  },
  {
    name: '02-modern-timeline', route: '#/catalog?path=modern-avengers', view: 'view-catalog', theme: 'dark',
    text: ['Modern Timeline', 'House of M'],
    caption: 'Follow the Modern Timeline one reading path at a time, starting with The Modern Avengers.',
  },
  {
    name: '03-reading-list', route: '#/read/play-lantern', view: 'view-read', theme: 'dark',
    scroll: '#hero', text: ['Fictional: Lantern Harbor', '3 of 8 read'],
    caption: 'See where you are in a reading list and what to read next.',
  },
  {
    name: '04-storylines', route: '#/lines', view: 'view-lines', theme: 'dark',
    text: ['Storylines', 'Beginner-friendly'],
    caption: 'Browse storylines by era, with beginner-friendly picks marked.',
  },
  {
    name: '05-professor-x', route: '#/spotlights', view: 'view-spotlights', theme: 'light',
    preview: 'Professor X (Charles Xavier)', text: ['Character spotlights'],
    caption: 'Preview a character spotlight, such as Professor X, before adding it.',
  },
  {
    name: '06-library', route: '#/library', view: 'view-library', theme: 'light',
    text: ['Library', 'Fictional: Lantern Harbor', 'Fictional: Paper Moons'],
    caption: 'Keep every reading list in your library, with progress saved on your device.',
  },
  {
    name: '07-backup-settings', route: '#/data', view: 'view-data', theme: 'light',
    text: ['Backup & settings', 'Complete backup'],
    caption: 'Save a complete backup of your lists and progress to Files.',
  },
  {
    name: '08-about-your-data', route: '#/about', view: 'view-about', theme: 'light',
    heading: 'Your data', text: ['About this app', 'Your data'],
    caption: 'Your data stays on your device. No account, no tracking.',
  },
]);

export function pageState(screen) {
  return screen.state === 'empty' ? createEmptyState() : demonstrationState();
}

export function seedScript(screen) {
  const state = JSON.stringify(pageState(screen));
  const settings = JSON.stringify({ covers: false, theme: screen.theme, filter: 'all' });
  const health = previewResponse(`${FIXTURE_API}/health`, 'GET', new Map());
  const healthUrl = JSON.stringify(`${DEFAULT_BASE}/health`);
  const healthBody = JSON.stringify(health.body);
  const healthType = JSON.stringify(health.contentType);
  return `(() => {
  localStorage.clear();
  localStorage.setItem(${JSON.stringify(KEY)}, ${JSON.stringify(state)});
  localStorage.setItem(${JSON.stringify(SETTINGS_KEY)}, ${JSON.stringify(settings)});
  const originalFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, options) => {
    if (typeof input === 'string' && input === ${healthUrl} && String(options?.method ?? 'GET').toUpperCase() === 'GET') {
      return Promise.resolve(new Response(${healthBody}, {
        status: ${health.status}, headers: { 'Content-Type': ${healthType} },
      }));
    }
    return originalFetch(input, options);
  };
})();
`;
}

// The approved capture excludes copyright notices, web addresses and other platform or store names
// from its frames.
export const BANNED = /©|\(c\)|https?:\/\/|www\.|\b[\w-]+\.(?:com|org|net|io|app|dev)\b|Android|Windows|\bEdge\b|Google|Play Store|Microsoft|OneDrive|Dropbox|Chrome|Firefox/;

// Runs through callAsyncJavaScript, so it may await. It returns "ready" only once the screen shows
// every expected phrase; anything else fails the UI test with the reason.
export function probeScript(screen) {
  const options = JSON.stringify({
    route: screen.route, view: screen.view, text: screen.text, scroll: screen.scroll ?? null,
    heading: screen.heading ?? null, preview: screen.preview ?? null, dismissNotice: !!screen.dismissNotice,
  });
  return `
const BANNED = ${BANNED.toString()};
const screen = ${options};
const waitFor = async (condition, name) => {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const value = condition();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for ' + name);
};
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const shown = (element) => !!element && !element.closest('[hidden]') && element.getClientRects().length > 0;
await waitFor(() => document.readyState === 'complete', 'the page');
if (location.hash !== screen.route) location.hash = screen.route;
const view = await waitFor(() => {
  const element = document.getElementById(screen.view);
  return element && !element.hidden ? element : null;
}, screen.view);
if (screen.dismissNotice) {
  const dismiss = document.getElementById('reader-closure-dismiss');
  if (shown(dismiss)) dismiss.click();
  await waitFor(() => !shown(document.getElementById('reader-closure-notice')), 'the dismissed notice');
}
let scope = view;
if (screen.preview) {
  const card = await waitFor(() => [...view.querySelectorAll('button.catalog-card-preview')]
    .find((button) => button.textContent.includes(screen.preview)), screen.preview);
  card.click();
  const dialog = await waitFor(() => {
    const element = document.getElementById('preview');
    return element?.open && document.getElementById('preview-h').textContent.includes(screen.preview) ? element : null;
  }, 'the spotlight preview');
  scope = dialog;
}
for (const phrase of screen.text) {
  await waitFor(() => view.textContent.includes(phrase), phrase);
}
await waitFor(() => document.getElementById('api-status')?.textContent.startsWith('API OK'), 'fixture metadata health');
if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
let target = null;
if (screen.scroll) target = await waitFor(() => document.querySelector(screen.scroll), screen.scroll);
if (screen.heading) {
  target = await waitFor(() => [...view.querySelectorAll('h2, h3')]
    .find((element) => element.textContent.trim() === screen.heading), screen.heading);
}
if (target) {
  target.scrollIntoView({ block: 'start' });
  await nextFrame();
  // Leave a little room above the heading rather than butting it against the top edge.
  const top = target.getBoundingClientRect().top;
  if (top < 24) window.scrollBy(0, top - 24);
} else if (!screen.preview) {
  window.scrollTo(0, 0);
}
// The page footer carries a copyright line, which a store screenshot may not show. Long pages
// scroll it away; on a page shorter than the screen it is hidden in place, keeping the layout.
await nextFrame();
for (const footer of document.querySelectorAll('.app-footer')) {
  const rect = footer.getBoundingClientRect();
  if (rect.bottom > 0 && rect.top < innerHeight) footer.style.visibility = 'hidden';
}
await document.fonts.ready;
await nextFrame();
await new Promise((resolve) => setTimeout(resolve, 750));
if (screen.preview && !document.getElementById('preview').open) throw new Error('The preview closed');
const offenders = [];
const framed = visibleText();
const banned = framed.match(BANNED);
if (banned) throw new Error('The frame shows "' + banned[0] + '" in ' + offenders.join(' | '));
return scope ? 'ready' : 'missing scope';
function visibleText() {
  const parts = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent.trim()) continue;
    const parent = node.parentElement;
    if (!parent || !shown(parent) || getComputedStyle(parent).visibility === 'hidden') continue;
    const closed = parent.closest('details:not([open])');
    const summary = closed && [...closed.children].find((child) => child.tagName === 'SUMMARY');
    if (closed && (!summary || !summary.contains(parent))) continue;
    range.selectNodeContents(node);
    const inView = [...range.getClientRects()].some((rect) => rect.width > 0 && rect.height > 0
      && rect.bottom > 0 && rect.top < innerHeight && rect.right > 0 && rect.left < innerWidth);
    if (inView) parts.push(node.textContent);
    if (inView && BANNED.test(node.textContent)) offenders.push((parent.id || parent.className || parent.tagName) + ': ' + node.textContent.trim().slice(0, 80));
  }
  return parts.join(' ');
}
`;
}

export function screensForSet(folder) {
  const set = SETS.find((entry) => entry.folder === folder);
  if (!set) fail(`unknown set ${folder}`);
  return SCREENS.slice(0, set.screenCount);
}

export function fixtures(folder) {
  return screensForSet(folder).map((screen) => ({
    name: screen.name,
    appearance: screen.theme === 'dark' ? 'Dark' : 'Light',
    seed: seedScript(screen),
    probe: probeScript(screen),
  }));
}

function fail(message) {
  throw new Error(`App Store screenshots: ${message}`);
}

export function chooseDevice(listing, folder) {
  const set = SETS.find((entry) => entry.folder === folder);
  if (!set) fail(`unknown set ${folder}`);
  const { devices } = typeof listing === 'string' ? JSON.parse(listing) : listing;
  const runtimes = Object.keys(devices ?? {})
    .filter((runtime) => runtime.startsWith('com.apple.CoreSimulator.SimRuntime.iOS-'))
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  const runtime = runtimes.at(-1);
  const matches = (devices?.[runtime] ?? []).filter((entry) => set.match(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  if (!matches.length) fail(`${set.wanted} is not available on the newest iOS runtime`);
  const device = matches.at(-1);
  const version = runtime.slice('com.apple.CoreSimulator.SimRuntime.iOS-'.length).split('-').join('.');
  return { set: folder, udid: device.udid, name: device.name, runtime: `iOS ${version}` };
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// Color information is carried over so the flattened file shows the same colors as the capture.
const KEPT_CHUNKS = new Set(['iCCP', 'sRGB', 'cHRM', 'gAMA']);

// A decoder for what the Simulator writes: 8 or 16 bits, RGB or RGBA, not interlaced. Ancillary
// chunks are read past; the color ones are returned so the output can keep them.
export function decodeCapture(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.subarray(0, 8).equals(SIGNATURE)) fail('not a PNG');
  let header = null;
  const data = [];
  const kept = [];
  let at = 8;
  let ended = false;
  while (at < bytes.length && !ended) {
    if (at + 12 > bytes.length) fail('truncated chunk');
    const length = bytes.readUInt32BE(at);
    const end = at + length + 12;
    if (end > bytes.length) fail('invalid chunk length');
    const type = bytes.toString('ascii', at + 4, at + 8);
    if (crc32(bytes.subarray(at + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail(`bad ${type} checksum`);
    const value = bytes.subarray(at + 8, end - 4);
    if (type === 'IHDR') header = value;
    else if (type === 'IDAT') data.push(value);
    else if (type === 'IEND') ended = true;
    else if (type === 'tRNS') fail('PNG transparency is not supported');
    else if (KEPT_CHUNKS.has(type) && !data.length) kept.push({ type, value: Buffer.from(value) });
    else if (!(bytes[at + 4] & 0x20)) fail(`unsupported critical chunk ${type}`);
    at = end;
  }
  if (!header || !ended || !data.length) fail('incomplete PNG');
  const width = header.readUInt32BE(0);
  const height = header.readUInt32BE(4);
  const depth = header[8];
  const colorType = header[9];
  if (![8, 16].includes(depth) || ![2, 6].includes(colorType) || header[10] || header[11] || header[12]) {
    fail(`unsupported PNG encoding (depth ${depth}, color type ${colorType}, interlace ${header[12]})`);
  }
  const channels = colorType === 6 ? 4 : 3;
  const bpp = channels * depth / 8;
  const stride = width * bpp;
  const raw = inflateSync(Buffer.concat(data));
  if (raw.length !== (stride + 1) * height) fail('invalid pixel data length');
  const unfiltered = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    if (filter > 4) fail('invalid row filter');
    for (let x = 0; x < stride; x++) {
      const i = y * stride + x;
      const left = x >= bpp ? unfiltered[i - bpp] : 0;
      const up = y ? unfiltered[i - stride] : 0;
      const corner = y && x >= bpp ? unfiltered[i - stride - bpp] : 0;
      const p = left + up - corner;
      const a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - corner);
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up
        : filter === 3 ? Math.floor((left + up) / 2) : a <= b && a <= c ? left : b <= c ? up : corner;
      unfiltered[i] = (raw[y * (stride + 1) + x + 1] + predictor) & 0xff;
    }
  }
  // Every sample as 8 bits, RGBA, whatever the source carried.
  const pixels = Buffer.alloc(width * height * 4);
  const sample = depth === 16
    ? (index) => Math.round(unfiltered.readUInt16BE(index * 2) / 257)
    : (index) => unfiltered[index];
  let nonOpaque = 0;
  for (let p = 0; p < width * height; p++) {
    for (let c = 0; c < 3; c++) pixels[p * 4 + c] = sample(p * channels + c);
    if (channels === 4) {
      const alphaIndex = p * channels + 3;
      const alpha = depth === 16 ? unfiltered.readUInt16BE(alphaIndex * 2) : unfiltered[alphaIndex];
      if (alpha !== (depth === 16 ? 65535 : 255)) nonOpaque++;
      pixels[p * 4 + 3] = sample(alphaIndex);
    } else {
      pixels[p * 4 + 3] = 255;
    }
  }
  return { width, height, depth, channels, kept, pixels, nonOpaque };
}

function chunk(type, value) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(value.length, 0);
  head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), value])), 0);
  return Buffer.concat([head, value, tail]);
}

// Apple refuses a screenshot with an alpha channel, so the output is 8-bit RGB. The capture must
// already be opaque: compositing a transparent pixel onto a guessed background would be inventing it.
export function flatten(image) {
  const { width, height, pixels, nonOpaque } = image;
  if (!Number.isInteger(nonOpaque) || nonOpaque < 0) fail('missing source opacity');
  if (nonOpaque) fail(`${nonOpaque} pixels are not opaque`);
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (stride + 1);
    raw[row] = 1;
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) {
        const value = pixels[(y * width + x) * 4 + c];
        const left = x ? pixels[(y * width + x - 1) * 4 + c] : 0;
        raw[row + 1 + x * 3 + c] = (value - left) & 0xff;
      }
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const color = image.kept.length ? image.kept : [{ type: 'sRGB', value: Buffer.from([0]) }];
  return Buffer.concat([
    SIGNATURE,
    chunk('IHDR', ihdr),
    ...color.map(({ type, value }) => chunk(type, value)),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function inspectOutput(bytes, set) {
  const image = decodeCapture(bytes);
  if (image.width !== set.width || image.height !== set.height) {
    fail(`${set.folder} expects ${set.width} x ${set.height} but found ${image.width} x ${image.height}`);
  }
  if (image.channels !== 3 || image.depth !== 8) fail('output must be 8-bit RGB with no alpha channel');
  const first = image.pixels.subarray(0, 3);
  let different = 0;
  for (let p = 0; p < image.pixels.length; p += 4) if (!image.pixels.subarray(p, p + 3).equals(first)) different++;
  if (different < image.width * image.height * 0.05) fail(`${set.folder} has a blank or nearly blank image`);
  return image;
}

// xcresulttool writes a manifest of the tests and the attachments each one exported.
export function attachmentFiles(directory, screens) {
  const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
  const found = [];
  const walk = (value) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === 'object') {
      if (typeof value.exportedFileName === 'string' && typeof value.suggestedHumanReadableName === 'string') {
        found.push({ file: join(directory, value.exportedFileName), name: value.suggestedHumanReadableName });
      }
      Object.values(value).forEach(walk);
    }
  };
  walk(manifest);
  return screens.map((screen) => {
    const candidates = found.filter(({ name }) => name === `${screen.name}.png` || name.startsWith(`${screen.name}_`)
      || name.startsWith(`${screen.name}.png`));
    if (candidates.length !== 1) fail(`expected one ${screen.name} attachment in ${directory}, found ${candidates.length}`);
    return candidates[0].file;
  });
}

export function finish({ input, output, source, run, xcode, sets = SETS }) {
  const rows = [];
  for (const set of sets) {
    const directory = join(output, set.folder);
    if (!existsSync(directory)) continue;
    const expected = new Set(screensForSet(set.folder).map(({ name }) => `${name}.png`));
    const unexpected = readdirSync(directory).find((name) => /\.png$/i.test(name) && !expected.has(name));
    if (unexpected) fail(`unexpected image ${set.folder}/${unexpected}; remove it before regenerating`);
  }
  for (const set of sets) {
    const directory = join(input, set.folder);
    const device = JSON.parse(readFileSync(join(directory, 'device.json'), 'utf8'));
    if (device.set !== set.folder) fail(`device record for ${set.folder} names ${device.set}`);
    const screens = screensForSet(set.folder);
    const files = attachmentFiles(directory, screens);
    mkdirSync(join(output, set.folder), { recursive: true });
    screens.forEach((screen, index) => {
      const captured = decodeCapture(readFileSync(files[index]));
      if (captured.width !== set.width || captured.height !== set.height) {
        fail(`${set.folder}/${screen.name} is ${captured.width} x ${captured.height}, not ${set.width} x ${set.height}`);
      }
      const bytes = flatten(captured);
      inspectOutput(bytes, set);
      const file = `${set.folder}/${screen.name}.png`;
      writeFileSync(join(output, file), bytes);
      rows.push({
        file, set: set.folder, slot: set.slot, width: set.width, height: set.height, bytes: bytes.length,
        sha256: sha256(bytes), appearance: screen.theme, route: screen.route, caption: screen.caption,
        device: device.name, runtime: device.runtime,
      });
    });
  }
  const manifest = {
    schemaVersion: 1,
    purpose: 'App Store product page screenshots of the iOS app, captured in the iOS Simulator.',
    specification: 'https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/',
    source, captureRun: run, xcode,
    framing: {
      footer: 'When the app footer would be visible, it is hidden with visibility hidden without changing the layout.',
      ipad: 'The iPad set ends at Backup & settings. About is omitted because its data source credit would be in the frame.',
    },
    data: {
      method: 'Fictional negative-ID issue records from the Google Play listing fixtures, covers off, no notes, no account. '
        + 'Metadata health uses the local Play preview response; other web requests outside the app bundle were blocked.',
      sha256: sha256(JSON.stringify(demonstrationState())),
    },
    files: rows,
  };
  writeFileSync(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

function option(args, name) {
  const index = args.indexOf(name);
  if (index < 0 || !args[index + 1]) fail(`missing ${name}`);
  return args[index + 1];
}

function main(args) {
  const [mode] = args;
  if (mode === 'fixtures') {
    process.stdout.write(JSON.stringify(fixtures(args[1])));
  } else if (mode === 'device') {
    process.stdout.write(JSON.stringify(chooseDevice(readFileSync(0, 'utf8'), args[1])));
  } else if (mode === 'finish') {
    const input = resolve(option(args, '--input'));
    if (!existsSync(input) || !readdirSync(input).length) fail(`nothing to finish in ${input}`);
    const manifest = finish({
      input, output: resolve(option(args, '--output')),
      source: option(args, '--source'), run: option(args, '--run'), xcode: option(args, '--xcode'),
    });
    for (const row of manifest.files) console.log(`${row.file} ${row.width} x ${row.height} ${row.bytes} bytes ${row.sha256}`);
  } else {
    fail('usage: fixtures <set> | device <set> | finish --input <dir> --output <dir> --source <sha> --run <id> --xcode <version>');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
