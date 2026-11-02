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
const ICLOUD_WEB = join(ROOT, 'packaging', 'ios', 'icloud-web');
export const IOS_FEATURES_PATH = join(ROOT, 'packaging', 'ios', 'features.json');
export const IDENTITY_PATH = join(ROOT, 'packaging', 'ios', 'identity.json');
const MARKER = '.recap-ios-assets';
const MARKER_CONTENT = 'Recap Page generated iOS assets v1\n';
// The Android exclusions omit the development fault harness and offline-shell registration, while
// the bundled app already has its own offline shell. iOS also removes the cloud backup card, so its
// sign-in logo has no remaining caller.
export const EXCLUDED = Object.freeze(['dev-faults.html', 'dev-faults.js', 'dev-faults.css', 'sw.js', 'js/app.js', 'brands/ms-symbollockup_mssymbol_19.svg']);
export const IOS_ASSET_DIR = join(ROOT, 'packaging', 'ios', 'build', 'generated', 'web');
export const IOS_ICON_PATH = join(ROOT, 'packaging', 'ios', 'RecapPage', 'Assets.xcassets', 'AppIcon.appiconset', 'AppIcon.png');
export const IOS_ICON_SIZE = 1024;
const IDENTITY_FIELDS = ['bundleIdentifier', 'displayName', 'host', 'iCloudContainer', 'minimumOS', 'origin',
  'schemaVersion', 'scheme'];
const VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1" />';
// Lets the page draw under the home indicator, so the bottom bar's own safe-area padding applies.
// Without it every env(safe-area-inset-*) value reads zero inside the web view.
const COVER_VIEWPORT = '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />';
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

export async function readIosFeatures(path = IOS_FEATURES_PATH) {
  const features = JSON.parse(await readFile(path, 'utf8'));
  if (!features || typeof features !== 'object' || Array.isArray(features)
    || Object.keys(features).sort().join() !== 'iCloudBackup,schemaVersion'
    || features.schemaVersion !== 1 || typeof features.iCloudBackup !== 'boolean') {
    throw new Error('iOS features have unexpected fields');
  }
  return features;
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

function replaceIosCopy(html, source, replacement) {
  once(html, source, `iOS static copy changed: ${source}`);
  return html.replace(source, replacement);
}

function replaceIosPattern(html, pattern, replacement, message) {
  if ([...html.matchAll(pattern)].length !== 1) throw new Error(message);
  return html.replace(pattern, replacement);
}

function removeDivById(html, id, message) {
  const marker = `id="${id}"`;
  once(html, marker, message);
  const start = html.lastIndexOf('<div', html.indexOf(marker));
  if (start < 0) throw new Error(message);
  const tags = /<\/?div\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 0;
  let match;
  while ((match = tags.exec(html))) {
    depth += match[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return html.slice(0, start) + html.slice(tags.lastIndex);
  }
  throw new Error(message);
}

function iosCloudCard(html) {
  let index = html;
  for (const id of ['btn-cloud-sign-in', 'btn-cloud-sign-in-google']) {
    index = replaceIosPattern(index, new RegExp(`<button\\b[^>]*id="${id}"[^>]*>[\\s\\S]*?<\\/button>`, 'g'), '',
      `iOS cloud sign-in action changed: ${id}`);
  }
  const copy = [
    ['Keep a complete backup in your own OneDrive, made automatically as you read.',
      'Keep a complete backup in your own iCloud, made automatically as you read.'],
    ['Back up this browser automatically', 'Back up this device automatically'],
    ['Backups in this OneDrive', 'Backups in this iCloud'],
    ['A backup is made shortly after you make changes, and when you leave Recap Page. The two newest from this browser are kept, and older ones go to OneDrive\'s recycle bin. Restoring one replaces everything it holds.',
      'A backup is made shortly after you make changes, and when you leave Recap Page. The two newest from this device are kept, and older backups are deleted only after a newer backup has uploaded. Restoring one replaces everything it holds.'],
  ];
  for (const [source, replacement] of copy) index = replaceIosCopy(index, source, replacement);
  return replaceIosPattern(index, /<p class="rail-hint" id="cloud-backup-privacy">[\s\S]*?<\/p>/g,
    '<p class="rail-hint" id="cloud-backup-privacy">Backups go to the Recap Page folder in your iCloud Drive. Recap Page does not encrypt them, so treat them like other files in your iCloud Drive. Disconnecting stops backups on this device without signing out of iCloud; backups already in iCloud stay until you delete them.</p>',
    'iOS cloud privacy copy changed');
}

function iosStaticCopy(html, iCloudBackup) {
  let index = iCloudBackup ? iosCloudCard(html) : removeDivById(html, 'cloud-backup', 'iOS cloud backup card changed');
  const cloudCopy = /<span data-cloud-copy="on"\s+hidden>[\s\S]*?<\/span>/g;
  const cloudCopies = [...index.matchAll(cloudCopy)].length;
  if (cloudCopies !== 4) throw new Error(`iOS cloud copy changed: expected 4 spans, found ${cloudCopies}`);
  const enabledCopy = [
    'This is app storage. Your saved data is uploaded only if you turn on cloud backup, and then only to your own iCloud.',
    'Your reading progress is saved privately in this app and is sent only to your own iCloud, if you turn on cloud backup below.',
    'This choice is saved in this app and included in a backup to your own iCloud, if you turn cloud backup on.',
    'Cloud backup is the one exception, and only once you turn it on. Recap Page sends a complete backup of what you save to your own iCloud after you make changes. It also lists and reads the backups there, and deletes older backups only after a newer backup has uploaded. Apple processes these files as part of your iCloud storage.',
  ];
  let cloudAt = 0;
  index = index.replace(cloudCopy, () => iCloudBackup ? `<span data-cloud-copy="on" hidden>${enabledCopy[cloudAt++]}</span>` : '');

  const copy = [
    ['in this browser, verify the downloaded file', 'in this app, verify the downloaded file'],
    ['Your lists and progress save automatically in this browser.', 'Your lists and progress save automatically in this app.'],
    ['This is browser storage', 'This is app storage'],
    ['browser profile or computer.', 'device.'],
    ['Your reading progress lives in this browser, at this exact address, and is never sent anywhere.', 'Your reading progress is saved privately in this app.'],
    ['The choice is stored in this browser', 'The choice is stored in this app'],
    ['Open Recap Page in its own window, using this browser\'s saved progress.', 'Open Recap Page in its own window, using this app\'s saved progress.'],
    ['Close other Recap Page tabs before restoring.', 'Close other copies of Recap Page before restoring.'],
    ['Undo is offered once, until you reload; after that, download the saved copy instead.',
      'Undo is offered once, until you close and reopen the app; after that, download the saved copy instead.'],
    ['What leaves this machine, request by request', 'What leaves this device, request by request'],
    ['What does leave this machine is the ordinary business', 'What leaves this device is the ordinary business'],
    ['Otherwise the launch tab asks', 'Otherwise Recap Page asks'],
    ['opens the web reader if found', 'opens Marvel\'s reader if found'],
  ];
  for (const [source, replacement] of copy) index = replaceIosCopy(index, source, replacement);
  index = replaceIosPattern(index, /Android uses your installed browser, not the Marvel Unlimited app, on both sides\s+of that date\./g,
    '', 'iOS static copy changed');
  index = replaceIosPattern(index, /<p id="local-connection-help" class="rail-hint">[\s\S]*?<\/p>/g,
    '<p id="local-connection-help" class="rail-hint">Your saved data is safe. Restart the app and check again.</p>',
    'iOS local connection help changed');
  return index;
}

// The shared page with the iOS entry, phone layer, overlay, viewport and privacy introduction. Each
// marker must appear exactly once, so a change to the shared entry stops preparation for review
// rather than producing a page that silently lost one of them.
export function iosIndex(html, build, { iCloudBackup = false } = {}) {
  let index = stampAbout(html, build);
  const documentTag = '<html lang="en">';
  once(index, documentTag, 'Shared document entry changed; iOS projection needs review');
  index = index.replace(documentTag, '<html lang="en" data-platform="ios">');
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
  index = index.replace(privacyIntro, `${privacyHeading}
              <p class="rail-hint">
                Your lists, progress and notes live in private storage inside this app on your iPhone or iPad, separate from Safari and from any desktop browser.
                There is no account to create and no analytics or tracking. ${iCloudBackup
                  ? 'Your saved lists, progress and notes are uploaded only if you turn on cloud backup in Backup & settings, and then only to your own iCloud.'
                  : 'The automatic service requests do not upload your saved lists, progress or notes.'}
                Backups of this device to iCloud or to a computer include this app's saved data.
                Deleting the app removes its private storage, and iOS can also clear it when the device is very low on storage, so export and keep a backup outside the app first.
                An export gives the place you choose the file's contents, which can include progress and notes. Deleting the app does not remove exported files.
              </p>
              <p class="rail-hint">
                If you test this app through TestFlight, Apple shares some information with the developer: crash reports, usage information such as your device model and how often you open the app, and any feedback you send. If you were invited by email, it can include your name and email address.
              </p>`);
  return iosStaticCopy(index, iCloudBackup);
}

// The launcher keeps shared open.js; its iOS-only target overlay sits after open.css.
export function iosLauncher(html) {
  once(html, VIEWPORT, 'Shared launcher entry changed; iOS injection needs review');
  const stylesheet = '<link rel="stylesheet" href="./open.css" />';
  const overlay = '<link rel="stylesheet" href="./ios/launcher.css" />';
  once(html, stylesheet, 'Shared launcher entry changed; iOS injection needs review');
  if (html.split(overlay).length !== 1) {
    throw new Error('Shared launcher entry changed; iOS injection needs review');
  }
  once(html, '<script type="module" src="./open.js"></script>', 'Shared launcher entry changed; iOS injection needs review');
  return html.replace(VIEWPORT, COVER_VIEWPORT)
    .replace(stylesheet, `${stylesheet}\n    ${overlay}`);
}

export async function prepareIos(output = IOS_ASSET_DIR, { featuresPath = IOS_FEATURES_PATH } = {}) {
  if (resolve(featuresPath) !== IOS_FEATURES_PATH && process.env.RECAP_IOS_BUILD_NUMBER) {
    throw new Error('iOS feature previews cannot be used for a reserved release build');
  }
  const features = await readIosFeatures(featuresPath);
  const directory = resolve(output);
  for (const protectedPath of [SOURCE, PHONE, WEB, ICLOUD_WEB, join(ROOT, 'scripts')]) {
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
  for (const required of ['app.js', 'ios.css', 'launcher.css']) {
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

  const index = iosIndex(await readFile(join(SOURCE, 'index.html'), 'utf8'), build, features);
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
    ...(features.iCloudBackup ? [['ios', ICLOUD_WEB, await filesIn(ICLOUD_WEB), 'packaging/ios/icloud-web']] : []),
  ]) {
    for (const path of paths) {
      const destination = join(directory, folder, path);
      await mkdir(dirname(destination), { recursive: true });
      await cp(join(base, path), destination);
      if (features.iCloudBackup && base === WEB && path === 'app.js') {
        await writeFile(destination, `import './cloud.js';\n${await readFile(destination, 'utf8')}`);
      }
      const sha256 = hash(await readFile(destination));
      entries.push({ path: `${folder}/${path}`, sha256, source: `${sourceRoot}/${path}`, sourceSha256: hash(await readFile(join(base, path))) });
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
