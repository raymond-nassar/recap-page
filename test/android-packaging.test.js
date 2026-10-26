import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createAndroidBackHandler, createAndroidBridge, validateExport } from '../packaging/android/web/bridge.js';
import { createHash } from 'node:crypto';
import { homeUpdatesContent } from '../src/js/lib/homeUpdatesContent.js';
import { saveDownload, setDownloadHandler, browserDownload } from '../src/js/lib/download.js';
import { prepareAndroid } from '../scripts/prepare-android.mjs';

function fixture() {
  const listeners = new Map();
  const reports = [];
  const port = {
    sent: [], closed: false,
    start() {},
    close() { this.closed = true; },
    postMessage(raw) { this.sent.push(JSON.parse(raw)); },
    reply(message) { this.onmessage({ data: JSON.stringify(message) }); },
  };
  const bridge = createAndroidBridge({
    host: { addEventListener: (name, fn) => listeners.set(name, fn) },
    report: (message) => reports.push(message),
    handleBack: () => true,
  });
  const connect = (overrides = {}) => listeners.get('message')({
    source: null, origin: '', data: 'recap:connect:v1', ports: [port], ...overrides,
  });
  return { bridge, port, reports, connect, listeners };
}

const file = { filename: 'recap-page-backup.json', type: 'application/json', text: '{"notes":"Caf\u00e9"}' };

test('Android More retains its 48px target over shared bottom-navigation styles', async () => {
  const css = await readFile(new URL('../packaging/android/web/mobile.css', import.meta.url), 'utf8');
  assert.match(css, /body \.rail-header \.rail-toggle \{[^}]*min-height: 48px/);
});

// UX-08 (#836): behind List actions, with Export a second disclosure inside it, most list commands took
// three taps. The sheet opens both groups and hides their summaries, so every command is one tap, and
// puts the reader's own List actions choice back on the way out. Escape closes the sheet itself, because
// List actions would otherwise close with focus inside it and keep the sheet open.
test('Android List options lists every command at once, with both groups open and their summaries hidden', async () => {
  const [css, overlay] = await Promise.all([
    readFile(new URL('../packaging/android/web/mobile.css', import.meta.url), 'utf8'),
    readFile(new URL('../packaging/android/web/mobile-ui.js', import.meta.url), 'utf8'),
  ]);
  assert.match(css, /#android-list-sheet :is\(#list-actions, #list-export\) > summary \{ display: none; \}/);
  assert.match(css, /#android-list-sheet \.list-actions-body \{[^}]*flex-direction: column;/);
  assert.match(overlay, /actionsWereOpen = actions\.open;\s*actions\.open = true;\s*exportChoices\.open = true;\s*sheet\.append\(tools\);/);
  assert.match(overlay, /actions\.open = actionsWereOpen;\s*exportChoices\.open = false;/);
  assert.match(overlay, /if \(event\.key !== 'Escape'\) return;\s*event\.preventDefault\(\);\s*event\.stopPropagation\(\);\s*dismiss\(\);\s*\}, true\);/);
});

test('Android phone catalog cards and timelines keep their composition over shared narrow rules', async () => {
  const css = await readFile(new URL('../packaging/android/web/mobile.css', import.meta.url), 'utf8');
  const start = css.indexOf('@media (max-width: 700px) {');
  assert.notEqual(start, -1, 'the Android 700px block exists');
  const block = css.slice(start, css.indexOf('@media', start + 1));
  assert.match(block, /\.catalog-card-main \{[^}]*flex-direction: row;[^}]*flex-wrap: wrap;/);
  assert.match(block, /\.catalog-card-title \{[^}]*min-width: min-content;[^}]*overflow-wrap: normal;/);
  assert.match(block, /\.timeline-era, \.timeline-year-row \{ padding-left: var\(--space-9\); \}/);
  assert.match(block, /\.timeline-era-head \{ padding-left: var\(--space-5\); \}/);
  assert.match(block, /\.timeline-year-marker \{ padding-left: 0; \}/);
  assert.match(block, /\.timeline-era \.timeline-year-row \{ padding-left: 0; \}/);
});

// #857: at 800 by 360 the two-row head put Continue reading's Read under the bottom bar. Four of the
// rules below override the 880px block's at the same specificity, so the order is the contract too.
test('A short landscape phone gives Home the one-row head, with What\'s new opening in place', async () => {
  const css = await readFile(new URL('../packaging/android/web/mobile.css', import.meta.url), 'utf8');
  const start = css.indexOf('@media (max-width: 880px) and (max-height: 500px) {');
  assert.notEqual(start, -1, 'the short landscape block exists');
  assert.ok(start > css.indexOf('@media (max-width: 880px) {'), 'it follows the narrow rules it overrides');
  const next = css.indexOf('@media', start + 1);
  const block = css.slice(start, next === -1 ? undefined : next);
  assert.match(block, /#view-home > \.head \{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\);/);
  assert.match(block, /\.home-lockup \{[^}]*grid-column: 2;/);
  assert.match(block, /body #view-home #home-updates \{[^}]*grid-column: 3;/);
  assert.match(block, /body #view-home #home-updates\[open\] \{[^}]*width: auto;/);
  assert.match(block, /body #view-home #home-updates-panel \{[^}]*position: absolute;[^}]*max-height: calc\(100dvh - var\(--mobile-nav-height, 80px\)/);
});

// #892: on a phone Home's Done result is a bar fixed above the bottom navigation. Its height reaches the
// stylesheet from the overlay, which focus clearance needs, so the overlay's wiring is pinned with it.
test('A phone shows Home\'s Done result in a bar above the navigation that focus keeps clear of', async () => {
  const [css, overlay] = await Promise.all([
    readFile(new URL('../packaging/android/web/mobile.css', import.meta.url), 'utf8'),
    readFile(new URL('../packaging/android/web/mobile-ui.js', import.meta.url), 'utf8'),
  ]);
  assert.match(css, /#home-continue #done-result \{[^}]*position: fixed;[^}]*bottom: calc\(var\(--mobile-nav-height, 80px\) \+ var\(--space-4\)\);/);
  assert.match(css, /main :focus \{ scroll-margin-bottom: calc\(var\(--mobile-nav-height, 80px\) \+ var\(--done-bar-height, 0px\) \+ var\(--space-6\)\); \}/);
  assert.match(css, /body:has\(#btn-rail-toggle\[aria-expanded="true"\]\) #home-continue #done-result \{ visibility: hidden; \}/);
  const short = css.lastIndexOf('@media (max-width: 880px) and (max-height: 500px) {');
  assert.match(css.slice(short), /#home-continue #done-result \{ left: max\(24rem, /);
  assert.match(overlay.slice(0, overlay.indexOf('\nfunction ')), /\n {2}wireDoneBar\(\);/);
  assert.match(overlay, /root\.style\.setProperty\('--done-bar-height', /);
});

test('Android package identity comes from the shared reserved-build contract', async () => {
  const [build, rootBuild, properties] = await Promise.all([
    readFile(new URL('../packaging/android/app/build.gradle', import.meta.url), 'utf8'),
    readFile(new URL('../packaging/android/build.gradle', import.meta.url), 'utf8'),
    readFile(new URL('../packaging/android/gradle.properties', import.meta.url), 'utf8'),
  ]);
  assert.match(rootBuild, /id 'com\.android\.application' version '9\.4\.1'/);
  assert.match(build, /android \{\s+enableKotlin = false/);
  assert.doesNotMatch(properties, /^\s*android\.builtInKotlin\s*=/m);
  assert.match(build, /commandLine 'node', 'scripts\/android-release.mjs', 'version'/);
  assert.match(build, /versionCode buildMetadata\.versionCode/);
  assert.match(build, /versionName buildMetadata\.versionName/);
  assert.match(build, /inputs\.property 'buildIdentity'/);
  assert.doesNotMatch(build, /betaRevision/);
});

test('Android wrapper bootstrap matches the distribution and runs before the Windows launcher', async () => {
  const [properties, bootstrap, windows] = await Promise.all([
    readFile(new URL('../packaging/android/gradle/wrapper/gradle-wrapper.properties', import.meta.url), 'utf8'),
    readFile(new URL('../packaging/android/bootstrap-wrapper.ps1', import.meta.url), 'utf8'),
    readFile(new URL('../packaging/android/gradlew.bat', import.meta.url), 'utf8'),
  ]);
  const version = properties.match(/gradle-(\d+\.\d+(?:\.\d+)?)-bin\.zip/)[1];
  const tag = version.split('.').length === 2 ? `${version}.0` : version;
  assert.ok(bootstrap.includes(`/gradle/v${tag}/gradle/wrapper/gradle-wrapper.jar`),
    'The pinned bootstrap JAR must follow the distribution version');
  assert.match(bootstrap, /\$expected = '[0-9a-f]{64}'/);
  assert.match(windows, /powershell\.exe[^\r\n]*bootstrap-wrapper\.ps1"\r?\nif errorlevel 1 goto exitWithErrorLevel/);
  assert.ok(windows.indexOf('bootstrap-wrapper.ps1') < windows.indexOf('-jar "%APP_HOME%'),
    'Verify or restore the wrapper before executing it');
});

// #904. The JAR is ignored by git, so a wrapper version bump left the previous version's JAR in
// place, and the bootstrap refused it: every local build that had run before the bump failed until
// someone deleted the file by hand. This runs a copy of the real script whose source and pin point
// at a local server, under the PowerShell that runs it for real: Windows PowerShell on Windows, and
// PowerShell on the Linux runners CI's tests use.
function wrapperShell() {
  for (const shell of process.platform === 'win32' ? ['powershell.exe', 'pwsh'] : ['pwsh']) {
    const probe = spawnSync(shell, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { stdio: 'ignore', timeout: 30000 });
    if (probe.status === 0) return shell;
  }
  return null;
}
const wrapperPowerShell = wrapperShell();

test('the wrapper bootstrap replaces a stale JAR only with a verified download, and runs nothing unverified',
  { skip: wrapperPowerShell ? false : 'no PowerShell to run the bootstrap with' }, async (t) => {
    const shipped = await readFile(new URL('../packaging/android/bootstrap-wrapper.ps1', import.meta.url), 'utf8');
    const source = /'(https:\/\/raw\.githubusercontent\.com\/gradle\/gradle\/v[\d.]+\/gradle\/wrapper\/gradle-wrapper\.jar)'/.exec(shipped);
    const pin = /^\$expected = '([0-9a-f]{64})'\r?$/m.exec(shipped);
    assert.ok(source && pin, 'the bootstrap names its source and its pin');
    const official = Buffer.from('the pinned wrapper JAR');
    const stale = Buffer.from("the previous version's wrapper JAR");
    const tampered = Buffer.from('a download that does not match the pin');
    let served = official;
    let requests = 0;
    const server = createServer((request, response) => {
      requests += 1;
      response.writeHead(200, { 'content-type': 'application/java-archive' }).end(served);
    });
    await new Promise((done) => server.listen(0, '127.0.0.1', done));
    t.after(() => {
      server.closeAllConnections();
      return new Promise((done) => server.close(done));
    });
    const root = await mkdtemp(join(tmpdir(), 'recap-wrapper-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const copy = join(root, 'bootstrap-wrapper.ps1');
    await writeFile(copy, shipped
      .replaceAll(source[1], `http://127.0.0.1:${server.address().port}/gradle-wrapper.jar`)
      .replace(pin[0], `$expected = '${createHash('sha256').update(official).digest('hex')}'`));
    const jar = join(root, 'gradle', 'wrapper', 'gradle-wrapper.jar');
    const download = `${jar}.download`;
    await mkdir(dirname(jar), { recursive: true });
    // The script's own output and the message of anything it throws, each on a line of its own, read
    // from the exception rather than from the error view, which a console host wraps mid-path.
    const driver = join(root, 'driver.ps1');
    await writeFile(driver, `$ErrorActionPreference = 'Stop'
try { & '${copy.replace(/'/g, "''")}' | ForEach-Object { [Console]::Out.WriteLine("OUT $_") } }
catch { [Console]::Out.WriteLine('REFUSED ' + $_.Exception.Message) }
`);
    const run = () => new Promise((resolve, reject) => {
      const child = spawn(wrapperPowerShell, [
        '-NoProfile', '-NonInteractive', ...(process.platform === 'win32' ? ['-ExecutionPolicy', 'Bypass'] : []),
        '-File', driver,
      ], { stdio: ['ignore', 'pipe', 'pipe'] });
      let out = '';
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.stderr.on('data', (chunk) => { out += chunk; });
      const timer = setTimeout(() => child.kill(), 60000);
      child.on('error', reject);
      child.on('close', () => {
        clearTimeout(timer);
        resolve(out);
      });
    });
    const current = async () => (existsSync(jar) ? readFile(jar) : null);

    // The case #904 reports: the previous version's JAR is replaced, verified, and the build may go on.
    await writeFile(jar, stale);
    let out = await run();
    assert.match(out, /^OUT Gradle 9\.8\.2 wrapper verified\.\r?$/m, out);
    assert.deepEqual(await current(), official);
    assert.equal(requests, 1);
    assert.equal(existsSync(download), false, 'no download is left beside the JAR');

    // A replacement that does not match the pin is deleted, the stale JAR is left unused, and the
    // message names the file to delete.
    await writeFile(jar, stale);
    served = tampered;
    out = await run();
    assert.match(out, /^REFUSED The downloaded Gradle wrapper does not match the official Gradle 9\.8\.2 release, so it was deleted and nothing was run\./m, out);
    assert.ok(out.includes(`delete ${jar}, then run the build again`), out);
    assert.doesNotMatch(out, /^OUT /m);
    assert.deepEqual(await current(), stale);
    assert.equal(existsSync(download), false, 'the refused download is deleted');

    // With no JAR at all, a download that does not match installs nothing.
    await rm(jar);
    out = await run();
    assert.match(out, /^REFUSED The downloaded Gradle wrapper does not match/m, out);
    assert.equal(existsSync(jar), false);
    assert.equal(existsSync(download), false);

    // A clean checkout downloads and verifies the pinned JAR, and a JAR that already matches is
    // verified without asking for it again.
    served = official;
    out = await run();
    assert.match(out, /^OUT Gradle 9\.8\.2 wrapper verified\.\r?$/m, out);
    assert.deepEqual(await current(), official);
    requests = 0;
    out = await run();
    assert.match(out, /^OUT Gradle 9\.8\.2 wrapper verified\.\r?$/m, out);
    assert.equal(requests, 0, 'a matching JAR is not downloaded again');
  });

test('Android generated assets and icons carry their producer tasks through the variant API', async () => {
  const build = await readFile(new URL('../packaging/android/app/build.gradle', import.meta.url), 'utf8');
  assert.match(build, /variant\.sources\.assets\.addGeneratedSourceDirectory\(prepareAssets\)/);
  assert.match(build, /variant\.sources\.res\.addGeneratedSourceDirectory\(prepareIcon\)/);
  assert.doesNotMatch(build, /sourceSets\.main\.(?:assets|res)\.srcDir/);
});

test('Android browser discovery is host-independent and retains all browser choices', async () => {
  const activity = await readFile(new URL('../packaging/android/app/src/main/java/io/github/raymondnassar/recappage/prototype/MainActivity.java', import.meta.url), 'utf8');
  const discovery = activity.match(/static ArrayList<ResolveInfo> readerBrowsers\(PackageManager manager\) \{([\s\S]*?)\n {4}\}/)?.[1];
  assert.ok(discovery, 'Browser discovery must be separate from destination dispatch');
  assert.match(discovery, /Uri\.parse\("https:"\)/);
  assert.match(discovery, /addCategory\(Intent\.CATEGORY_DEFAULT\)/);
  assert.match(discovery, /queryIntentActivities\(discovery,\s*PackageManager\.MATCH_ALL \| PackageManager\.GET_RESOLVED_FILTER\)/);
  assert.doesNotMatch(discovery, /MATCH_DEFAULT_ONLY|marvel\.com|\burl\b/);
  assert.match(discovery, /countDataAuthorities\(\) == 0/);
  assert.match(discovery, /hasDataScheme\("https"\)/);
  assert.doesNotMatch(activity, /handleAllWebDataURI/);
  assert.ok(activity.includes('ArrayList<ResolveInfo> choices = readerBrowsers(getPackageManager());'));
  assert.ok(activity.includes('new Intent(Intent.ACTION_VIEW, Uri.parse(url))'));
  assert.ok(activity.includes('intent.setPackage(browser.activityInfo.packageName);'));
});

test('Android export permits only bounded text files and basenames', () => {
  assert.doesNotThrow(() => validateExport(file));
  assert.doesNotThrow(() => validateExport({ filename: 'my-list.md', type: 'text/markdown', text: '' }));
  for (const invalid of [
    { filename: '../secret.json' }, { filename: 'bad\\name.json' }, { filename: '.json' },
    { filename: 'backup.html' }, { filename: 'x'.repeat(181) + '.json' },
    { type: 'image/png' }, { text: null }, { text: '\u00e9'.repeat(17 * 1024 * 1024) },
  ]) assert.throws(() => validateExport({ ...file, ...invalid }));
});

test('Android bridge refuses page or external messages and absent native connection', async () => {
  for (const invalid of [
    { source: {} }, { origin: 'https://example.com' }, { origin: 'http://127.0.0.1:8787' },
    { data: 'other' }, { ports: [] },
  ]) {
    const f = fixture();
    f.connect(invalid);
    assert.equal(await f.bridge.save(file), false);
    assert.equal(f.port.sent.length, 0);
    assert.match(f.reports.at(-1), /not ready/);
  }
});

test('Android download waits for the matching native completion and preserves exact text', async () => {
  const f = fixture();
  f.connect();
  let settled = false;
  const result = f.bridge.save(file).then((value) => { settled = true; return value; });
  const request = f.port.sent[0];
  assert.deepEqual(request, { v: 1, kind: 'save', id: 'save-1', ...file });
  f.port.reply({ v: 1, kind: 'save-result', id: 'not-this-request', status: 'saved' });
  await Promise.resolve();
  assert.equal(settled, false);
  assert.equal(await f.bridge.save(file), false, 'a second export cannot replace the first picker');
  f.port.reply({ v: 1, kind: 'save-result', id: request.id, status: 'saved' });
  assert.equal(await result, true);
});

test('Android cancellation, failure and invalid replies never confirm a download', async () => {
  for (const status of ['cancelled', 'failed', 'unrecognized']) {
    const f = fixture();
    f.connect();
    const result = f.bridge.save(file);
    f.port.reply({ v: 1, kind: 'save-result', id: 'save-1', status, message: 'Provider unavailable.' });
    assert.equal(await result, false);
    assert.match(f.reports.at(-1), /cancelled|not confirmed saved/);
  }
  const f = fixture();
  f.connect();
  const result = f.bridge.save(file);
  f.port.onmessage({ data: 'not JSON' });
  assert.equal(await result, false);
  assert.match(f.reports.at(-1), /unreadable response/);
});

test('Android page teardown settles outstanding requests and ignores stale ports', async () => {
  const f = fixture();
  f.connect();
  const result = f.bridge.save(file);
  f.listeners.get('pagehide')();
  assert.equal(await result, false);
  assert.equal(f.port.closed, true);
  f.port.reply({ v: 1, kind: 'save-result', id: 'save-1', status: 'saved' });
  assert.match(f.reports.at(-1), /interrupted/);
});

test('Android message errors disconnect the failed port without breaking a newer connection', async () => {
  const f = fixture();
  f.connect();
  const first = f.bridge.save(file);
  const oldPort = f.port;
  oldPort.onmessageerror();
  assert.equal(await first, false);
  assert.equal(oldPort.closed, true, 'the failed transport is closed');
  assert.equal(await f.bridge.save(file), false, 'a retry must refuse the failed connection');
  assert.equal(oldPort.sent.length, 1, 'a retry never posts into the failed port');
  assert.match(f.reports.at(-1), /not ready/);

  const fresh = fixture().port;
  f.connect({ ports: [fresh] });
  const next = f.bridge.save(file);
  oldPort.onmessageerror();
  assert.equal(fresh.closed, false, 'a stale error cannot disconnect the new transport');
  fresh.reply({ v: 1, kind: 'save-result', id: fresh.sent[0].id, status: 'saved' });
  assert.equal(await next, true);
});

test('Android Back reports page handling with the native request identity', () => {
  const f = fixture();
  f.connect();
  f.port.reply({ v: 1, kind: 'back', id: 'native-back-7' });
  assert.deepEqual(f.port.sent, [{ v: 1, kind: 'back-result', id: 'native-back-7', handled: true }]);
});

test('Android Back preserves dialog and visible narrow-menu priority before synchronous Home news', () => {
  let dialog;
  let menu = false;
  let narrow = true;
  let hidden = false;
  let news = true;
  const calls = [];
  const toggle = {
    get hidden() { return hidden; },
    getAttribute: () => String(menu),
    click: () => { calls.push('menu'); menu = false; },
  };
  const back = createAndroidBackHandler({
    document: { querySelector: (selector) => selector === 'dialog[open]' ? dialog : toggle },
    isNarrow: () => narrow,
    closeHomeUpdates: (options) => { assert.deepEqual(options, { restoreFocus: true }); calls.push('news'); return news; },
  });
  dialog = { dispatchEvent: (event) => { assert.equal(event.type, 'cancel'); return true; }, close: () => calls.push('dialog') };
  menu = true;
  assert.equal(back(), true);
  assert.deepEqual(calls, ['dialog']);
  dialog = { dispatchEvent: () => false, close: () => assert.fail('cancel was prevented') };
  assert.equal(back(), true);
  dialog = null;
  assert.equal(back(), true);
  assert.deepEqual(calls, ['dialog', 'menu']);
  assert.equal(back(), true);
  assert.equal(calls.at(-1), 'news');
  menu = true;
  hidden = true;
  news = false;
  assert.equal(back(), false);
  hidden = false;
  narrow = false;
  assert.equal(back(), false);
});

test('Android preparation copies and evaluates the immutable highlights with exact manifest digests', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'recap-android-news-'));
  try {
    const { directory, manifest } = await prepareAndroid(join(scratch, 'recap'));
    for (const parts of [
      ['js', 'lib', 'homeUpdatesContent.js'],
      ['js', 'lib', 'homeUpdatesSeen.js'],
      ['js', 'views', 'home-updates.js'],
    ]) {
      const source = await readFile(join('src', ...parts));
      const bytes = await readFile(join(directory, ...parts));
      assert.deepEqual(bytes, source);
      const entry = manifest.files.find((item) => item.path === parts.join('/'));
      assert.ok(entry);
      assert.equal(entry.sha256, createHash('sha256').update(source).digest('hex'));
      assert.equal(entry.sourceSha256, entry.sha256);
      if (parts.at(-1) === 'homeUpdatesContent.js') {
        const output = await import(`data:text/javascript;base64,${bytes.toString('base64')}`);
        assert.deepEqual(output.homeUpdatesContent, homeUpdatesContent);
        if (output.homeUpdatesContent.batch) {
          assert.ok(Object.isFrozen(output.homeUpdatesContent.batch));
          assert.ok(Object.isFrozen(output.homeUpdatesContent.batch.listIds));
        } else assert.equal(output.homeUpdatesContent.batch, null);
      }
    }
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});

test('shared downloads require explicit completion before returning success', async () => {
  try {
    let complete;
    setDownloadHandler(() => new Promise((resolve) => { complete = resolve; }));
    let settled = false;
    const result = saveDownload(file.filename, file.text, file.type).then((value) => { settled = true; return value; });
    await Promise.resolve();
    assert.equal(settled, false);
    complete(true);
    assert.equal(await result, true);
    for (const value of [false, undefined, null]) {
      setDownloadHandler(() => value);
      assert.equal(await saveDownload(file.filename, file.text, file.type), false);
    }
  } finally {
    setDownloadHandler(browserDownload);
  }
});

test('Android assets preserve every catalog payload and the shared feature modules', async () => {
  const scratch = await mkdtemp(join(tmpdir(), 'recap-android-assets-'));
  const output = join(scratch, 'recap');
  try {
    await prepareAndroid(output);
    async function compareData(relative = 'data') {
      for (const entry of await readdir(join('src', relative), { withFileTypes: true })) {
        const name = join(relative, entry.name);
        if (entry.isDirectory()) await compareData(name);
        else assert.deepEqual(await readFile(join(output, name)), await readFile(join('src', name)), name);
      }
    }
    await compareData();
    for (const name of ['js/main.js', 'js/storage.js', 'js/reader.js', 'js/lib/issuePageUrl.js',
      'js/lib/model.js', 'js/lib/download.js', 'js/views/recovery.js', 'open.js', 'styles.css']) {
      assert.deepEqual(await readFile(join(output, name)), await readFile(join('src', name)), name);
    }
    const generated = await readFile(join(output, 'index.html'), 'utf8');
    const identity = JSON.parse(await readFile(join(output, 'build-info.json'), 'utf8'));
    assert.equal(identity.platform, 'android');
    assert.equal(identity.channel, 'development');
    assert.ok(generated.includes(`source ${identity.sourceRevision}`));
    assert.match(generated, /\.\/android\/mobile\.css/);
    assert.match(generated, /\.\/android\/app\.js/);
    assert.ok(generated.indexOf('styles.css') < generated.indexOf('android/mobile.css'));
    assert.doesNotMatch(generated, /src="\.\/js\/app\.js"/);
    assert.doesNotMatch(await readFile(join('src', 'index.html'), 'utf8'), /android\/(?:mobile\.css|app\.js)/);
    assert.match(generated, /digital issue ID to Marvel's Bifrost service/);
    const launcher = await readFile(join(output, 'open.html'), 'utf8');
    assert.match(launcher, /src="\.\/android\/launcher\.js"/);
    assert.doesNotMatch(launcher, /src="\.\/open\.js"/);
    assert.match(await readFile(join('src', 'open.html'), 'utf8'), /src="\.\/open\.js"/);
    for (const name of ['launcher.js', 'reader.js']) {
      assert.deepEqual(await readFile(join(output, 'android', name)), await readFile(join('packaging', 'android', 'web', name)));
    }
    const launcherModule = await readFile(join(output, 'android', 'launcher.js'), 'utf8');
    for (const match of launcherModule.matchAll(/^import .* from '(\.\.\/[^']+)';$/gm)) {
      await assert.doesNotReject(readFile(join(output, 'android', match[1])),
        `generated launcher import must resolve: ${match[1]}`);
    }
    assert.match(launcherModule, /import \{ issuePageUrl \} from '\.\.\/js\/lib\/issuePageUrl\.js'/);
    await assert.rejects(readFile(join(output, 'dev-faults.html')), { code: 'ENOENT' });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
