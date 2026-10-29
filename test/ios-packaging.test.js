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
import { createIosBridge, validateIosExport } from '../packaging/ios/web/bridge.js';
import { ABOUT_BUILD } from '../scripts/lib/release-identity.mjs';
import { CSP } from '../server.mjs';
import { rootTokens } from '../scripts/check-spacing.mjs';

const ROOT = new URL('../', import.meta.url);
const path = (relativePath) => fileURLToPath(new URL(relativePath, ROOT));
const read = (path) => readFileSync(new URL(path, ROOT), 'utf8');
const terminationTests = read('packaging/ios/RecapPageTests/TerminationTests.swift');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const policyUrl = 'https://github.com/raymond-nassar/recap-page/blob/main/PRIVACY.md';
const project = read('packaging/ios/RecapPage.xcodeproj/project.pbxproj');

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

// The app target is a synchronized folder group with no list of files of its own, so a Swift file
// added to its folder is compiled into the app with no project edit. The checks that read the app's
// code walk the same folder for the same reason. Each use asserts the walk found the files it names,
// so a walk that comes back empty fails instead of passing with nothing read.
const appSources = (await filesUnder(path('packaging/ios/RecapPage')))
  .filter((file) => file.endsWith('.swift'))
  .map((file) => ({ name: file.slice(0, -'.swift'.length), text: read(`packaging/ios/RecapPage/${file}`) }));

function appSwift() {
  assert.ok(appSources.some(({ name }) => name === 'DebugSupport'), 'the walk of the app folder found DebugSupport.swift');
  return appSources;
}

function appSource(name) {
  const source = appSwift().find((file) => file.name === name);
  assert.ok(source, `the walk of the app folder found ${name}.swift`);
  return source.text;
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
  assert.match(plist, /<key>UIApplicationSupportsMultipleScenes<\/key>\s*<false\/>/);
  const ipadOrientations = /<key>UISupportedInterfaceOrientations~ipad<\/key>\s*<array>([\s\S]*?)<\/array>/.exec(plist)?.[1];
  assert.ok(ipadOrientations, 'the iPad orientation list is explicit');
  assert.deepEqual([...ipadOrientations.matchAll(/<string>([^<]+)<\/string>/g)].map((match) => match[1]), [
    'UIInterfaceOrientationPortrait',
    'UIInterfaceOrientationPortraitUpsideDown',
    'UIInterfaceOrientationLandscapeLeft',
    'UIInterfaceOrientationLandscapeRight',
  ]);
  const assets = appSource('AppAssets');
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
  const sources = appSwift();
  const used = [...REQUIRED_REASON].filter(([, pattern]) => sources.some(({ text }) => pattern.test(text)))
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

// What has to stay in Debug builds: the Debug-only surfaces themselves, and any call that reaches a
// method by its name. WebKit's private test hooks are reached that way, and a private selector in the
// shipped binary is a use of non-public API, so the dynamic call and the private name are each held
// to Debug wherever they appear.
const DEBUG_ONLY = [
  ['a Debug-only surface', /DebugSupport|RECAP_PROBE|RECAP_ISOLATE|RECAP_IOS_|XCTest/],
  ['a method called by name', /\bNSSelectorFromString\b|\bperform\s*\(/],
  ['a private selector name', /"_[A-Za-z_][\w:]*"/],
];

test('Debug-only test surfaces and methods called by name cannot reach a Release build', () => {
  const debugSupport = appSource('DebugSupport').trim().split(/\r?\n/);
  assert.equal(debugSupport[0], '#if DEBUG', 'the whole file is inside one Debug block');
  assert.equal(debugSupport.at(-1), '#endif');
  assert.equal(debugSupport.filter((line) => /^\s*#endif\b/.test(line)).length, 1);
  let uses = 0;
  const outside = [];
  for (const { name, text } of appSwift().filter(({ name: file }) => file !== 'DebugSupport')) {
    const { lines, inside } = debugLines(text);
    lines.forEach((line, index) => {
      const kinds = DEBUG_ONLY.filter(([, pattern]) => pattern.test(line)).map(([kind]) => kind);
      if (!kinds.length) return;
      uses += 1;
      if (!inside.has(index)) outside.push(`${name}.swift line ${index + 1}: ${kinds.join(' and ')} outside #if DEBUG`);
    });
  }
  assert.deepEqual(outside, []);
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

test('the termination test fails visibly if the pinned WebKit hook is absent', () => {
  assert.match(terminationTests, /guard webView\.responds\(to: kill\) else \{\s*XCTFail\("The pinned WebKit is missing _killWebContentProcess; termination behavior was not exercised\."\)\s*return\s*\}/);
  assert.doesNotMatch(terminationTests, /XCTSkip(?:Unless|If)/);
});

test('the iOS overlay names only shared design tokens, never a raw color', () => {
  const css = read('packaging/ios/web/ios.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i);
  assert.doesNotMatch(css, /\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(\s*(?!var\()/i);
  const shared = rootTokens(read('src/styles.css'));
  for (const [, name] of css.matchAll(/var\(\s*(--[-\w]+)/g)) {
    if (name !== '--ios-text-scale') assert.ok(shared.has(name), `${name} is a shared token`);
  }
});

test('iOS Dynamic Type scales only the shared text tokens and survives a WebKit process restart', () => {
  const sharedTypes = [...read('src/styles.css').matchAll(/^\s*(--t-[\w-]+):\s*([\d.]+)px;\s*$/gm)]
    .map(([, token, size]) => [token, Number(size)]);
  const css = read('packaging/ios/web/ios.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const scaledTypes = [...css.matchAll(/^\s*(--t-[\w-]+):\s*calc\(var\(--ios-text-scale\)\s*\*\s*([\d.]+)px\);\s*$/gm)]
    .map(([, token, size]) => [token, Number(size)]);
  assert.deepEqual(scaledTypes, sharedTypes, 'every shared type token is scaled from its unchanged default size');
  assert.match(css, /--ios-text-scale:\s*1\s*;/);
  assert.doesNotMatch(css, /\b(?:font-size|zoom)\s*:/, 'root rem dimensions and page zoom stay unchanged');
  const controller = appSource('WebViewController');
  assert.match(controller, /UIFont\.preferredFont\(forTextStyle:\s*\.body,\s*compatibleWith:\s*traits\)\.pointSize/);
  assert.match(controller, /registerForTraitChanges\(\[UITraitPreferredContentSizeCategory\.self\]/);
  assert.match(controller, /document\.documentElement\?\.style\.setProperty\('--ios-text-scale'/);
  assert.match(controller, /removeAllUserScripts\(\)[\s\S]*?installPageScripts\(in:\s*webView\.configuration\.userContentController\)/,
    'the persistent app scripts are restored after the restart-only flag is removed');
  assert.match(controller, /webView\.topAnchor\.constraint\(equalTo:\s*guide\.topAnchor\)/);
  assert.match(controller, /webView\.leadingAnchor\.constraint\(equalTo:\s*guide\.leadingAnchor\)/);
  assert.match(controller, /webView\.trailingAnchor\.constraint\(equalTo:\s*guide\.trailingAnchor\)/);
  assert.match(controller, /contentInsetAdjustmentBehavior = \.never/);
});

test('the iOS token overlay matches the phone layer root specificity', () => {
  const phone = read('packaging/android/web/mobile.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const overlay = read('packaging/ios/web/ios.css').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(phone, /^:root\s*\{/m, 'the phone layer declares its tokens on :root');
  assert.match(overlay, /^:root\s*\{/m, 'the later iOS overlay must not lose token overrides to :root');
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

test('iOS export validation mirrors Android for bounded text files and basenames', () => {
  const file = { filename: 'backup.json', type: 'application/json', text: 'saved bytes' };
  assert.doesNotThrow(() => validateIosExport(file));
  assert.doesNotThrow(() => validateIosExport({ filename: 'reading-list.md', type: 'text/markdown', text: '' }));
  for (const invalid of [
    { filename: '../secret.json' }, { filename: 'bad\\name.json' }, { filename: '.json' },
    { filename: 'backup.html' }, { filename: 'x'.repeat(181) + '.json' },
    { type: 'image/png' }, { text: null }, { text: '\u00e9'.repeat(17 * 1024 * 1024) },
  ]) assert.throws(() => validateIosExport({ ...file, ...invalid }));
});

test('iOS download waits for native confirmation and refuses a second pending export', async () => {
  let resolveNative;
  const messages = [];
  const reports = [];
  const host = { addEventListener() {} };
  const bridge = createIosBridge({
    host,
    native: { postMessage: (message) => { messages.push(message); return new Promise((resolve) => { resolveNative = resolve; }); } },
    report: (message) => reports.push(message),
  });
  let settled = false;
  const result = bridge.save({ filename: 'backup.json', type: 'application/json', text: '{"kept":true}' })
    .then((value) => { settled = true; return value; });
  assert.deepEqual(messages, [{
    v: 1, kind: 'save', id: 'save-1', filename: 'backup.json', type: 'application/json', text: '{"kept":true}',
  }]);
  assert.equal(await bridge.save({ filename: 'second.json', type: 'application/json', text: '{}' }), false);
  assert.equal(messages.length, 1);
  assert.equal(settled, false, 'a picker request is not a saved file');
  resolveNative({ v: 1, kind: 'save-result', id: 'save-1', status: 'saved' });
  assert.equal(await result, true);
  assert.match(reports.at(-1), /saved to the location you chose/);
});

test('the shipping iOS web view installs a reply-capable download handler', () => {
  const factory = appSource('WebViewFactory');
  const controller = appSource('WebViewController');
  const handler = appSource('IosBridgeHandler');
  assert.match(factory, /addScriptMessageHandler\(\s*bridgeHandler,\s*contentWorld:\s*\.page,\s*name:\s*IosBridgeHandler\.name/s);
  assert.match(controller, /IosBridgeHandler\(policy:\s*policy,\s*presenter:\s*self,\s*dataLossState:\s*dataLossState\)/);
  assert.match(handler, /WKScriptMessageHandlerWithReply/);
  assert.match(handler, /isTrustedPage\(/);
  assert.match(handler, /UIDocumentPickerViewController\(forExporting:\s*\[fileURL\],\s*asCopy:\s*true\)/);
  assert.match(handler, /case \.cancelled: status = "cancelled"/);
});

test('the Read child is guarded before its launcher can navigate', () => {
  const controller = appSource('WebViewController');
  const childCreation = controller.slice(controller.indexOf('    func webView('), controller.indexOf('    private func presentNextReadSheet()'));
  const sheet = appSource('ReadSheetController');
  const initializer = sheet.slice(sheet.indexOf('    init('), sheet.indexOf('    required init'));
  assert.match(childCreation, /let child = WKWebView\(frame: \.zero, configuration: configuration\)/);
  assert.match(initializer, /super\.init[\s\S]*webView\.navigationDelegate = self[\s\S]*webView\.uiDelegate = self/);
  assert.match(sheet, /policy\.decideLauncher\(/);
  assert.match(sheet, /case \.openExternally:[\s\S]*return \.cancel/);
  assert.match(sheet, /WebViewFactory\.configure\(webView\)/);
});

test('iOS cancellation, failure, malformed replies and teardown never confirm an export', async () => {
  for (const status of ['cancelled', 'failed', 'unrecognized']) {
    const reports = [];
    const bridge = createIosBridge({
      host: { addEventListener() {} },
      native: { postMessage: async ({ id }) => ({ v: 1, kind: 'save-result', id, status, message: 'Provider unavailable.' }) },
      report: (message) => reports.push(message),
    });
    assert.equal(await bridge.save({ filename: 'backup.json', type: 'application/json', text: '{}' }), false);
    assert.match(reports.at(-1), /cancelled|not confirmed saved/);
  }

  let resolveNative;
  let pagehide;
  const reports = [];
  const bridge = createIosBridge({
    host: { addEventListener: (name, listener) => { if (name === 'pagehide') pagehide = listener; } },
    native: { postMessage: () => new Promise((resolve) => { resolveNative = resolve; }) },
    report: (message) => reports.push(message),
  });
  const result = bridge.save({ filename: 'backup.json', type: 'application/json', text: '{}' });
  pagehide();
  assert.equal(await result, false);
  resolveNative({ v: 1, kind: 'save-result', id: 'save-1', status: 'saved' });
  await Promise.resolve();
  assert.match(reports.at(-1), /interrupted|not confirmed saved/);
});
