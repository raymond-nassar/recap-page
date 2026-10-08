import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
