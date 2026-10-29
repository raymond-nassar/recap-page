import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSourceUnchanged, iosBuild, stampAbout } from './lib/release-identity.mjs';
import { SVG_CONTENT, drawIcon, encodePng } from './build-icons.mjs';
import { CSP } from '../server.mjs';
import {
  LOCAL_SERVER_HEADER_NAME,
  LOCAL_SERVER_HEADER_VALUE,
  LOCAL_SERVER_HEALTH_PATH,
} from '../src/js/lib/localServer.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'src');
// The phone layer the Android app wears. It is web code with no Android dependency, so the iOS app
// wears the same files rather than a copy that would drift from them.
const PHONE = join(ROOT, 'packaging', 'android', 'web');
export const PHONE_FILES = Object.freeze(['mobile-ui.js', 'mobile.css']);
const WEB = join(ROOT, 'packaging', 'ios', 'web');
export const IDENTITY_PATH = join(ROOT, 'packaging', 'ios', 'identity.json');
const MARKER = '.recap-ios-assets';
const MARKER_CONTENT = 'Recap Page generated iOS assets v1\n';
// The five files the Android app leaves out, for the same reasons: the fault harness is a developer
// tool, and the app bundle already holds the offline shell, so neither the service worker nor the
// entry that registers it belongs in it.
export const EXCLUDED = Object.freeze(['dev-faults.html', 'dev-faults.js', 'dev-faults.css', 'sw.js', 'js/app.js']);
export const IOS_ASSET_DIR = join(ROOT, 'packaging', 'ios', 'build', 'generated', 'web');
export const IOS_ICON_PATH = join(ROOT, 'packaging', 'ios', 'RecapPage', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon.png');
export const IOS_ICON_SIZE = 1024;
const IDENTITY_FIELDS = ['bundleIdentifier', 'displayName', 'host', 'iCloudContainer', 'minimumOS', 'origin',
  'schemaVersion', 'scheme'];
const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1" />';
// Lets the page draw under the home indicator, so the bottom bar's own safe-area padding applies.
// Without it every env(safe-area-inset-*) value reads zero inside the web view.
const COVER_VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />';
const PRIVACY_POLICY = 'https://github.com/raymond-nassar/recap-page/blob/main/PRIVACY.md';

function inside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel));
}

async function filesIn(directory, prefix = '') {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error(`iOS assets cannot contain a symbolic link: ${entry.name}`);
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await filesIn(join(directory, entry.name), path));
    else if (entry.isFile()) result.push(path);
    else throw new Error(`Unsupported iOS asset: ${path}`);
  }
  return result.sort();
}

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

// The app icon: the same mark the web app's icons draw, from the same geometry. iOS cuts its own
// rounded shape and refuses an icon with transparency, so the mark is drawn full bleed, with the
// transparent corners of its rounded square filled with the square's own purple.
export function iosAppIcon() {
  const purple = /<rect width="32" height="32" rx="[\d.]+" fill="#([0-9a-f]{6})"\/>/.exec(SVG_CONTENT)?.[1];
  if (!purple) throw new Error('The icon geometry no longer names its background color');
  const background = [0, 2, 4].map((at) => Number.parseInt(purple.slice(at, at + 2), 16));
  const rgba = drawIcon(IOS_ICON_SIZE);
  const rgb = Buffer.alloc(IOS_ICON_SIZE * IOS_ICON_SIZE * 3);
  for (let from = 0, to = 0; from < rgba.length; from += 4, to += 3) {
    const alpha = rgba[from + 3] / 255;
    for (let channel = 0; channel < 3; channel += 1) {
      rgb[to + channel] = Math.round(rgba[from + channel] * alpha + background[channel] * (1 - alpha));
    }
  }
  return encodePng(IOS_ICON_SIZE, rgb, { alpha: false });
}

// The permanent names, read from the one file that holds them. Each must be a plain value, and the
// origin must be exactly the scheme and host it is made of, so no copy can be edited apart from it.
export async function readIosIdentity(path = IDENTITY_PATH) {
  const identity = JSON.parse(await readFile(path, 'utf8'));
  const fields = identity && typeof identity === 'object' && !Array.isArray(identity) ? Object.keys(identity).sort() : [];
  if (fields.join() !== IDENTITY_FIELDS.join() || identity.schemaVersion !== 1) {
    throw new Error('iOS identity has unexpected fields');
  }
  if (!/^[a-z][a-z0-9]*$/.test(identity.scheme) || ['http', 'https', 'file', 'about', 'data', 'blob'].includes(identity.scheme)
    || !/^[a-z][a-z0-9.-]*$/.test(identity.host) || identity.origin !== `${identity.scheme}://${identity.host}`) {
    throw new Error('iOS identity origin must be its own scheme and host');
  }
  if (!/^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z0-9-]+)+$/.test(identity.bundleIdentifier)
    || identity.iCloudContainer !== `iCloud.${identity.bundleIdentifier}`
    || !/^\d+\.\d+$/.test(identity.minimumOS) || typeof identity.displayName !== 'string' || !identity.displayName) {
    throw new Error('iOS identity names are malformed');
  }
  return identity;
}

async function cleanOwnedOutput(directory) {
  for (let current = directory; ; current = dirname(current)) {
    const info = await lstat(current).catch((error) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (info?.isSymbolicLink()) throw new Error('iOS output cannot traverse symbolic links');
    if (current === dirname(current)) break;
  }
  // Tests may choose an empty directory; never turn an arbitrary nonempty path into a clean target.
  const entries = await readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (entries.length) {
    const marker = await readFile(join(directory, MARKER), 'utf8').catch(() => '');
    if (marker !== MARKER_CONTENT) throw new Error('Refusing to clean an unowned iOS asset directory');
    await rm(directory, { recursive: true });
  }
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, MARKER), MARKER_CONTENT);
}

function once(text, marker, message) {
  if (text.split(marker).length !== 2) throw new Error(message);
}

// The shared page with the iOS entry, phone layer, overlay, viewport and privacy introduction. Each
// marker must appear exactly once, so a change to the shared entry stops preparation for review
// rather than producing a page that silently lost one of them.
export function iosIndex(html, build) {
  let index = stampAbout(html, build);
  const stylesheet = '<link rel="stylesheet" href="./styles.css" />';
  const entry = '<script type="module" src="./js/app.js"></script>';
  for (const marker of [VIEWPORT, stylesheet, entry]) {
    once(index, marker, 'Shared index entry changed; iOS injection needs review');
  }
  index = index.replace(VIEWPORT, COVER_VIEWPORT)
    .replace(stylesheet, `${stylesheet}\n    <link rel="stylesheet" href="./mobile/mobile.css" />`
      + '\n    <link rel="stylesheet" href="./ios/ios.css" />')
    .replace(entry, '<script type="module" src="./ios/app.js"></script>');
  const privacyHeading = '<h3>Your data</h3>';
  const privacyIntro = /<h3>Your data<\/h3>\s*<p class="rail-hint">[\s\S]*?<\/p>/g;
  if (index.split(privacyHeading).length !== 2 || [...index.matchAll(privacyIntro)].length !== 1) {
    throw new Error('Shared privacy introduction changed; iOS disclosure needs review');
  }
  return index.replace(privacyIntro, `${privacyHeading}
              <p class="rail-hint">
                Your lists, progress and notes live in private storage inside this app on your iPhone or iPad, separate from Safari and from any desktop browser.
                There is no account to create and no analytics or tracking. The automatic service requests do not upload your saved lists, progress or notes.
                Backups of this device to iCloud or to a computer include this app's saved data.
                Deleting the app removes its private storage, so export and keep a backup outside the app first.
              </p>
              <p class="rail-hint">
                <a href="${PRIVACY_POLICY}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">Privacy policy (opens in your browser)</a>
              </p>`);
}

// The launcher keeps the shared open.js. Only its viewport changes, for the same reason as Home's.
export function iosLauncher(html) {
  once(html, VIEWPORT, 'Shared launcher entry changed; iOS injection needs review');
  once(html, '<script type="module" src="./open.js"></script>', 'Shared launcher entry changed; iOS injection needs review');
  return html.replace(VIEWPORT, COVER_VIEWPORT);
}

export async function prepareIos(output = IOS_ASSET_DIR) {
  const directory = resolve(output);
  for (const protectedPath of [SOURCE, PHONE, WEB, join(ROOT, 'scripts')]) {
    if (inside(directory, protectedPath) || inside(protectedPath, directory)) {
      throw new Error('iOS output must not overlap maintained source files');
    }
  }
  if (inside(directory, ROOT)) throw new Error('iOS output must not contain the repository');
  const [sharedPaths, webPaths, packageText, identity] = await Promise.all([
    filesIn(SOURCE),
    filesIn(WEB),
    readFile(join(ROOT, 'package.json'), 'utf8'),
    readIosIdentity(),
  ]);
  for (const required of ['app.js', 'ios.css']) {
    if (!webPaths.includes(required)) throw new Error(`Missing iOS entry asset: ${required}`);
  }
  const { version } = JSON.parse(packageText);
  const { identity: build } = await iosBuild();
  const config = {
    version,
    origin: identity.origin,
    scheme: identity.scheme,
    host: identity.host,
    securityHeaders: {
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'content-security-policy': `${CSP}; frame-src 'none'; worker-src 'none'`,
      'x-frame-options': 'DENY',
    },
    health: {
      path: LOCAL_SERVER_HEALTH_PATH,
      headers: { [LOCAL_SERVER_HEADER_NAME]: LOCAL_SERVER_HEADER_VALUE },
    },
  };

  const index = iosIndex(await readFile(join(SOURCE, 'index.html'), 'utf8'), build);
  const launcher = iosLauncher(await readFile(join(SOURCE, 'open.html'), 'utf8'));

  await cleanOwnedOutput(directory);
  const entries = [];
  for (const path of sharedPaths) {
    if (EXCLUDED.includes(path)) continue;
    const source = join(SOURCE, path);
    const destination = join(directory, path);
    await mkdir(dirname(destination), { recursive: true });
    if (path === 'index.html') await writeFile(destination, index);
    else if (path === 'open.html') await writeFile(destination, launcher);
    else await cp(source, destination);
    const sha256 = hash(await readFile(destination));
    const sourceSha256 = hash(await readFile(source));
    if (path !== 'index.html' && path !== 'open.html' && sha256 !== sourceSha256) {
      throw new Error(`Shared source changed during iOS preparation: ${path}. Run preparation again.`);
    }
    entries.push({ path, sha256, source: `src/${path}`, sourceSha256 });
  }
  for (const [folder, base, paths, sourceRoot] of [
    ['mobile', PHONE, PHONE_FILES, 'packaging/android/web'],
    ['ios', WEB, webPaths, 'packaging/ios/web'],
  ]) {
    for (const path of paths) {
      const destination = join(directory, folder, path);
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(base, path), destination);
      const sha256 = hash(await readFile(destination));
      entries.push({ path: `${folder}/${path}`, sha256, source: `${sourceRoot}/${path}`, sourceSha256: sha256 });
    }
  }
  await writeFile(join(directory, 'ios-config.json'), `${JSON.stringify(config, null, 2)}\n`);
  entries.push({ path: 'ios-config.json', sha256: hash(await readFile(join(directory, 'ios-config.json'))) });
  await writeFile(join(directory, 'build-info.json'), `${JSON.stringify(build, null, 2)}\n`);
  entries.push({ path: 'build-info.json', sha256: hash(await readFile(join(directory, 'build-info.json'))) });
  const manifest = { version, build, files: entries.sort((a, b) => a.path.localeCompare(b.path, 'en')) };
  await writeFile(join(directory, 'ios-assets.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  assertSourceUnchanged(build);
  return { directory: await realpath(directory), manifest, config };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--icon')) {
    await writeFile(IOS_ICON_PATH, iosAppIcon());
    console.log(`Wrote ${IOS_ICON_PATH}`);
  } else {
    const result = await prepareIos();
    console.log(`Prepared ${result.manifest.files.length} iOS assets in ${result.directory}`);
  }
}
