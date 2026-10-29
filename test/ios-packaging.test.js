import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EXCLUDED, IOS_ASSET_DIR, IOS_ICON_PATH, IOS_ICON_SIZE, PHONE_FILES, iosAppIcon, iosIndex, iosLauncher,
  prepareIos, readIosIdentity,
} from '../scripts/prepare-ios.mjs';
import { ABOUT_BUILD } from '../scripts/lib/release-identity.mjs';
import { CSP } from '../server.mjs';
import { rootTokens } from '../scripts/check-spacing.mjs';

const ROOT = new URL('../', import.meta.url);
const path = (relativePath) => fileURLToPath(new URL(relativePath, ROOT));
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const policyUrl = 'https://github.com/raymond-nassar/recap-page/blob/main/PRIVACY.md';
const project = read('packaging/ios/RecapPage.xcodeproj/project.pbxproj');
const appSources = ['AppAssets', 'AppDelegate', 'AppSchemeHandler', 'AssetResponder', 'DebugSupport',
  'NavigationCoordinator', 'NavigationPolicy', 'SceneDelegate', 'WebViewController', 'WebViewFactory']
  .map((name) => ({ name, text: read(`packaging/ios/RecapPage/${name}.swift`) }));

let scratch;
let output;
let prepared;
let desktop;

async function filesUnder(directory, prefix = '') {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...await filesUnder(join(directory, entry.name), path));
    else found.push(path);
  }
  return found.sort();
}

function prose(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}

function yourData(html) {
  const match = html.match(/<h3>Your data<\/h3>([\s\S]*?)<h3>This build<\/h3>/);
  assert.ok(match, 'About must retain its Your data section');
  return match[1];
}

// Each build configuration's settings, by the configuration's object id.
function configurations(text) {
  const result = new Map();
  for (const match of text.matchAll(/([0-9A-F]{24}) \/\* (\w+) \*\/ = \{\s*isa = XCBuildConfiguration;\s*buildSettings = \{([\s\S]*?)\n\s*\};\s*name = (\w+);/g)) {
    result.set(match[1], { name: match[4], settings: match[3] });
  }
  return result;
}

function targetConfigurations(text, target) {
  const list = new RegExp(`/\\* Build configuration list for PBXNativeTarget "${target}" \\*/ = \\{[\\s\\S]*?buildConfigurations = \\(([\\s\\S]*?)\\);`).exec(text);
  assert.ok(list, `the project lists configurations for ${target}`);
  const all = configurations(text);
  return [...list[1].matchAll(/([0-9A-F]{24})/g)].map(([id]) => all.get(id));
}

const setting = (settings, name) => new RegExp(`\\b${name} = ("[^"]*"|[^;]+);`).exec(settings)?.[1].replace(/^"|"$/g, '');

before(async () => {
  scratch = await mkdtemp(join(tmpdir(), 'recap-ios-assets-'));
  output = join(scratch, 'web');
  prepared = await prepareIos(output);
  desktop = await readFile(new URL('src/index.html', ROOT), 'utf8');
});

after(async () => {
  if (scratch) await rm(scratch, { recursive: true, force: true });
});

test('iOS preparation leaves out the same five files as the Android app and copies the rest exactly', async () => {
  const android = /const EXCLUDED = new Set\(\[([^\]]+)\]\)/.exec(read('scripts/prepare-android.mjs'))?.[1];
  assert.ok(android, 'the Android exclusions are still a literal set');
  assert.deepEqual([...EXCLUDED].sort(), [...android.matchAll(/'([^']+)'/g)].map((match) => match[1]).sort());
  assert.equal(EXCLUDED.length, 5);
  const shared = await filesUnder(path('src'));
  const generated = new Set(await filesUnder(output));
  for (const path of shared) {
    if (EXCLUDED.includes(path)) {
      assert.ok(!generated.has(path), `${path} is left out`);
      continue;
    }
    assert.ok(generated.has(path), `${path} is bundled`);
    if (path === 'index.html' || path === 'open.html') continue;
    assert.deepEqual(await readFile(join(output, path)), await readFile(new URL(`src/${path}`, ROOT)), path);
  }
  for (const name of PHONE_FILES) {
    assert.deepEqual(await readFile(join(output, 'mobile', name)), await readFile(new URL(`packaging/android/web/${name}`, ROOT)), name);
  }
  for (const name of await readdir(new URL('packaging/ios/web', ROOT))) {
    assert.deepEqual(await readFile(join(output, 'ios', name)), await readFile(new URL(`packaging/ios/web/${name}`, ROOT)), name);
  }
});

test('the iOS manifest lists every bundled file once with its exact digest', async () => {
  const listed = prepared.manifest.files.map(({ path }) => path);
  assert.equal(new Set(listed).size, listed.length);
  const onDisk = (await filesUnder(output)).filter((path) => !['ios-assets.json', '.recap-ios-assets'].includes(path));
  assert.deepEqual([...listed].sort(), onDisk);
  for (const entry of prepared.manifest.files) {
    assert.equal(entry.sha256, sha256(await readFile(join(output, entry.path))), entry.path);
    // The native policy serves only plain paths, so a bundled name it would refuse is a broken page.
    assert.match(`/${entry.path}`, /^\/[A-Za-z0-9_./-]+$/, entry.path);
  }
  assert.equal(prepared.manifest.build.platform, 'ios');
});

test('the iOS page loads the phone layer and the iOS overlay after the shared styles, at the cover viewport', async () => {
  const page = await readFile(join(output, 'index.html'), 'utf8');
  assert.equal(page.split('viewport-fit=cover').length, 2);
  const styles = page.indexOf('href="./styles.css"');
  const phone = page.indexOf('href="./mobile/mobile.css"');
  const overlay = page.indexOf('href="./ios/ios.css"');
  assert.ok(styles > 0 && styles < phone && phone < overlay, 'shared styles, then the phone layer, then the overlay');
  assert.equal(page.split('<script type="module" src="./ios/app.js"></script>').length, 2);
  assert.doesNotMatch(page, /src="\.\/js\/app\.js"/);
  assert.doesNotMatch(desktop, /ios\/(?:ios\.css|app\.js)|viewport-fit/);
  const launcher = await readFile(join(output, 'open.html'), 'utf8');
  assert.equal(launcher.split('viewport-fit=cover').length, 2);
  assert.match(launcher, /<script type="module" src="\.\/open\.js"><\/script>/);
  const entry = await readFile(join(output, 'ios', 'app.js'), 'utf8');
  for (const match of entry.matchAll(/^import .* from '(\.\.\/[^']+)';$/gm)) {
    await assert.doesNotReject(readFile(join(output, 'ios', match[1])), `generated iOS import must resolve: ${match[1]}`);
  }
  assert.match(entry, /wireMobileUi\(\{ arrivalHeading \}\)/);
  assert.match(entry, /\['preview-offline', 'preview-offline-status'\]/);
  // The flag the shell sets before any page script runs after an ending is the one the page reads.
  assert.match(entry, /^if \(window\.recapIosRestarted === true\) \{$/m);
  assert.match(read('packaging/ios/RecapPage/WebViewController.swift'),
    /source: "window\.recapIosRestarted = true;", injectionTime: \.atDocumentStart, forMainFrameOnly: true/);
});

test('iOS About and its build report name an unreserved development build', async () => {
  const build = JSON.parse(await readFile(join(output, 'build-info.json'), 'utf8'));
  assert.equal(build.platform, 'ios');
  assert.equal(build.channel, 'development');
  assert.equal(build.packageVersion, 1);
  const page = await readFile(join(output, 'index.html'), 'utf8');
  assert.ok(page.includes(`ios 1; development; source ${build.sourceRevision}`));
  assert.ok(desktop.includes(ABOUT_BUILD));
});

test('iOS About states private app storage, device backups and what the requests carry', async () => {
  const page = await readFile(join(output, 'index.html'), 'utf8');
  const text = prose(yourData(page));
  assert.match(text, /private storage inside this app on your iPhone or iPad/);
  assert.match(text, /separate from Safari and from any desktop browser/);
  assert.match(text, /no account/i);
  assert.match(text, /no analytics or tracking/i);
  assert.match(text, /automatic service requests do not upload your saved lists, progress or notes/i);
  assert.match(text, /Backups of this device to iCloud or to a computer include this app's saved data/);
  assert.match(text, /Deleting the app removes its private storage/);
  assert.match(text, /keep a backup outside the app/);
  assert.doesNotMatch(text, /progress and your notes are never sent anywhere/i);
  const links = [...yourData(page).matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.equal(links.length, 1, 'the added disclosure has one explicit policy destination');
  assert.equal(links[0][1], policyUrl);
  assert.match(links[0][0], /target="_blank"/);
  assert.match(links[0][0], /rel="noopener noreferrer"/);
  assert.match(links[0][0], /referrerpolicy="no-referrer"/);
  const details = (html) => yourData(html).match(/<details\b[\s\S]*?<\/details>/)?.[0];
  assert.ok(details(desktop));
  assert.equal(details(page), details(desktop), 'the request-by-request enumeration is the shared one');
});

test('iOS preparation refuses a changed shared entry, overlapping output and a directory it does not own', async () => {
  const build = prepared.manifest.build;
  const page = await readFile(new URL('src/index.html', ROOT), 'utf8');
  assert.doesNotThrow(() => iosIndex(page, build));
  for (const changed of [
    page.replace('<script type="module" src="./js/app.js"></script>', ''),
    page.replace('<link rel="stylesheet" href="./styles.css" />', '<link rel="stylesheet" href="./main.css" />'),
    page.replace('initial-scale=1" />', 'initial-scale=1, maximum-scale=1" />'),
    page.replace('</head>', '<script type="module" src="./js/app.js"></script></head>'),
  ]) {
    assert.throws(() => iosIndex(changed, build), /Shared index entry changed; iOS injection needs review/);
  }
  assert.throws(() => iosIndex(page.replace('<h3>Your data</h3>', '<h3>Data</h3>'), build), /Shared privacy introduction changed/);
  const launcher = await readFile(new URL('src/open.html', ROOT), 'utf8');
  assert.doesNotThrow(() => iosLauncher(launcher));
  assert.throws(() => iosLauncher(launcher.replace('./open.js', './launch.js')), /Shared launcher entry changed/);
  await assert.rejects(prepareIos(path('src/generated')), /overlap/);
  await assert.rejects(prepareIos(path('packaging/ios/web/generated')), /overlap/);
  const unowned = join(scratch, 'unowned');
  await mkdir(unowned);
  await writeFile(join(unowned, 'keep.txt'), 'not generated');
  await assert.rejects(prepareIos(unowned), /unowned/);
  assert.equal(await readFile(join(unowned, 'keep.txt'), 'utf8'), 'not generated');
});

test('the iOS configuration serves the identity file\'s origin with the shared security headers', async () => {
  const identity = await readIosIdentity();
  const config = JSON.parse(await readFile(join(output, 'ios-config.json'), 'utf8'));
  assert.equal(config.origin, identity.origin);
  assert.equal(config.scheme, identity.scheme);
  assert.equal(config.host, identity.host);
  assert.equal(config.securityHeaders['content-security-policy'], `${CSP}; frame-src 'none'; worker-src 'none'`);
  assert.equal(config.securityHeaders['x-content-type-options'], 'nosniff');
  assert.equal(config.health.path, '/__recap_page_health__');
  assert.deepEqual(config.health.headers, { 'X-Recap-Page-Server': '1' });
  assert.equal(relative(path('packaging/ios'), IOS_ASSET_DIR).split(sep).join('/'), 'build/generated/web');
  assert.match(project, /name = web; path = build\/generated\/web; sourceTree = SOURCE_ROOT;/);
});

test('every permanent iOS name agrees with the identity file', async () => {
  const identity = await readIosIdentity();
  assert.deepEqual(identity, JSON.parse(read('packaging/ios/identity.json')));
  assert.equal(identity.origin, 'recappage://localhost');
  for (const { name, settings } of targetConfigurations(project, 'RecapPage')) {
    assert.equal(setting(settings, 'PRODUCT_BUNDLE_IDENTIFIER'), identity.bundleIdentifier, name);
    assert.equal(setting(settings, 'IPHONEOS_DEPLOYMENT_TARGET'), identity.minimumOS, name);
    assert.equal(setting(settings, 'INFOPLIST_FILE'), 'RecapPage-Info.plist', name);
  }
  for (const target of ['RecapPageTests', 'RecapPageUITests']) {
    for (const { name, settings } of targetConfigurations(project, target)) {
      assert.ok(setting(settings, 'PRODUCT_BUNDLE_IDENTIFIER').startsWith(`${identity.bundleIdentifier}.`), `${target} ${name}`);
    }
  }
  const targets = [...project.matchAll(/IPHONEOS_DEPLOYMENT_TARGET = ([\d.]+);/g)].map((match) => match[1]);
  assert.ok(targets.length >= 2);
  assert.deepEqual([...new Set(targets)], [identity.minimumOS]);
  const plist = read('packaging/ios/RecapPage-Info.plist');
  assert.equal(/<key>CFBundleDisplayName<\/key>\s*<string>([^<]+)<\/string>/.exec(plist)?.[1], identity.displayName);
  assert.doesNotMatch(plist, /UIRequiresFullScreen/);
  const assets = appSources.find(({ name }) => name === 'AppAssets').text;
  assert.equal(/static let permanentOrigin = "([^"]+)"/.exec(assets)?.[1], identity.origin);
});

test('the Xcode project holds the app and its two test targets, and no package of any kind', () => {
  assert.match(project, /objectVersion = 77;/);
  assert.doesNotMatch(project, /XCRemoteSwiftPackageReference|XCLocalSwiftPackageReference|XCSwiftPackageProductDependency/);
  for (const match of project.matchAll(/packageProductDependencies = \(([^)]*)\);/g)) assert.equal(match[1].trim(), '');
  const targets = [...project.matchAll(/isa = PBXNativeTarget;[\s\S]*?name = (\w+);[\s\S]*?productType = "([^"]+)";/g)]
    .map((match) => [match[1], match[2]]);
  assert.deepEqual(targets, [
    ['RecapPage', 'com.apple.product-type.application'],
    ['RecapPageTests', 'com.apple.product-type.bundle.unit-test'],
    ['RecapPageUITests', 'com.apple.product-type.bundle.ui-testing'],
  ]);
  const scheme = read('packaging/ios/RecapPage.xcodeproj/xcshareddata/xcschemes/RecapPage.xcscheme');
  for (const name of ['RecapPageTests', 'RecapPageUITests']) assert.match(scheme, new RegExp(`BlueprintName = "${name}"`));
});

// Apple's required-reason API categories, each with the calls in this app's Swift that would need a
// declared reason. A category the sources use and the manifest omits fails, and so does the reverse.
const REQUIRED_REASON = new Map([
  ['NSPrivacyAccessedAPICategoryUserDefaults', /\bUserDefaults\b|\bNSUserDefaults\b/],
  ['NSPrivacyAccessedAPICategoryFileTimestamp', /\b(?:creationDate|modificationDate|contentModificationDate|fileModificationDate|attributesOfItem|getattrlist|fstat|lstat)\b/],
  ['NSPrivacyAccessedAPICategorySystemBootTime', /\b(?:systemUptime|mach_absolute_time)\b/],
  ['NSPrivacyAccessedAPICategoryDiskSpace', /\b(?:volumeAvailableCapacity\w*|systemFreeSize|systemSize|statfs|statvfs)\b/],
  ['NSPrivacyAccessedAPICategoryActiveKeyboards', /\bactiveInputModes\b/],
]);

test('the privacy manifest declares exactly the required-reason APIs the app calls, and no tracking', () => {
  const manifest = read('packaging/ios/RecapPage/PrivacyInfo.xcprivacy');
  assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/);
  assert.match(manifest, /<key>NSPrivacyTrackingDomains<\/key>\s*<array\/>/);
  assert.match(manifest, /<key>NSPrivacyCollectedDataTypes<\/key>\s*<array\/>/);
  const declared = [...manifest.matchAll(/<string>(NSPrivacyAccessedAPICategory\w+)<\/string>/g)].map((match) => match[1]).sort();
  const used = [...REQUIRED_REASON].filter(([, pattern]) => appSources.some(({ text }) => pattern.test(text)))
    .map(([category]) => category).sort();
  assert.deepEqual(declared, used);
});

// The line ranges inside `#if DEBUG` blocks, so a use of a Debug-only surface can be placed.
function debugLines(text) {
  const lines = text.split(/\r?\n/);
  const inside = new Set();
  const stack = [];
  lines.forEach((line, index) => {
    const directive = line.trim();
    if (/^#if\b/.test(directive)) stack.push(directive === '#if DEBUG');
    else if (/^#else\b/.test(directive) && stack.length) stack[stack.length - 1] = false;
    else if (/^#endif\b/.test(directive)) stack.pop();
    else if (stack.includes(true)) inside.add(index);
  });
  return { lines, inside };
}

test('Debug-only test surfaces cannot reach a Release build', () => {
  const debugSupport = appSources.find(({ name }) => name === 'DebugSupport').text.trim().split(/\r?\n/);
  assert.equal(debugSupport[0], '#if DEBUG', 'the whole file is inside one Debug block');
  assert.equal(debugSupport.at(-1), '#endif');
  assert.equal(debugSupport.filter((line) => /^\s*#endif\b/.test(line)).length, 1);
  let uses = 0;
  for (const { name, text } of appSources.filter(({ name: file }) => file !== 'DebugSupport')) {
    const { lines, inside } = debugLines(text);
    lines.forEach((line, index) => {
      if (!/DebugSupport|RECAP_PROBE|RECAP_ISOLATE|XCTest/.test(line)) return;
      uses += 1;
      assert.ok(inside.has(index), `${name}.swift line ${index + 1} uses a Debug-only surface outside #if DEBUG`);
    });
  }
  assert.ok(uses >= 3, `found ${uses} uses of the Debug-only surfaces, so this would barely check`);
  const all = configurations(project);
  const release = [...all.values()].filter(({ name }) => name === 'Release');
  const debug = [...all.values()].filter(({ name }) => name === 'Debug');
  assert.equal(release.length, 4);
  for (const { settings } of release) assert.doesNotMatch(settings, /\bDEBUG\b/, 'Release defines no DEBUG condition');
  assert.ok(debug.some(({ settings }) => setting(settings, 'SWIFT_ACTIVE_COMPILATION_CONDITIONS') === 'DEBUG $(inherited)'));
});

test('the Swift code reaches WebKit only through methods iOS 18 has', async () => {
  // Built with the iOS 26 SDK, WebKit's Swift refinements of its Objective-C methods live in
  // libswiftWebKit.dylib, which iOS 18 does not have. One call to them stopped the app at launch on
  // the iOS 18.5 Simulator, so the code calls the double-underscore Objective-C forms instead.
  const refined = [
    /(?<!\w)callAsyncJavaScript\s*\(/,
    /(?<!\w)evaluateJavaScript\s*\([^)]*\bin:/,
    /(?<!\w)(?:createPDF|createWebArchiveData)\s*\(/,
  ];
  let objectiveC = 0;
  for (const directory of ['RecapPage', 'RecapPageTests', 'RecapPageUITests']) {
    const files = (await filesUnder(path(`packaging/ios/${directory}`))).filter((name) => name.endsWith('.swift'));
    for (const file of files) {
      const text = read(`packaging/ios/${directory}/${file}`);
      objectiveC += (text.match(/\.__callAsyncJavaScript\(/g) ?? []).length;
      text.split(/\r?\n/).forEach((line, index) => {
        for (const pattern of refined) assert.doesNotMatch(line, pattern, `${directory}/${file} line ${index + 1}`);
      });
    }
  }
  assert.ok(objectiveC >= 2, `found ${objectiveC} Objective-C calls into the page, so this would barely check`);
});

test('the iOS overlay names only shared design tokens, never a raw color', () => {
  const css = read('packaging/ios/web/ios.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?!var\()/i);
  const shared = rootTokens(read('src/styles.css'));
  for (const [, name] of css.matchAll(/var\(\s*(--[-\w]+)/g)) assert.ok(shared.has(name), `${name} is a shared token`);
});

test('the iOS app icon is the web app mark drawn opaque from the same geometry', async () => {
  const committed = await readFile(IOS_ICON_PATH);
  assert.equal(committed.readUInt32BE(16), IOS_ICON_SIZE);
  assert.equal(committed.readUInt32BE(20), IOS_ICON_SIZE);
  assert.equal(committed[25], 2, 'color type 2 is RGB with no alpha channel, which iOS requires');
  assert.deepEqual(committed, iosAppIcon(), 'regenerate with node scripts/prepare-ios.mjs --icon');
  const catalog = JSON.parse(read('packaging/ios/RecapPage/Assets.xcassets/AppIcon.appiconset/Contents.json'));
  assert.deepEqual(catalog.images, [{ filename: 'AppIcon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }]);
});

test('the capacity probe lives where the unit test that runs it looks', () => {
  const testSource = read('packaging/ios/RecapPageTests/CapacityProbeTests.swift');
  assert.match(testSource, /appendingPathComponent\("probes\/capacity\.js"\)/);
  const probe = read('packaging/ios/probes/capacity.js');
  assert.match(probe, /^window\.recapCapacityProbe = async function recapCapacityProbe\(/m);
  assert.match(testSource, /ownerBytes = 1183 \* 1024/);
});
