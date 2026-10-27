import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createAndroidBackHandler, createAndroidBridge, validateExport } from '../packaging/android/web/bridge.js';
import { createHash, randomUUID } from 'node:crypto';
import { homeUpdatesContent } from '../src/js/lib/homeUpdatesContent.js';
import { saveDownload, setDownloadHandler, browserDownload } from '../src/js/lib/download.js';
import { prepareAndroid } from '../scripts/prepare-android.mjs';
import { captureCloudContent, createCloudSnapshot, parseCloudSnapshot } from '../src/js/lib/cloudSnapshot.js';
import { createAndroidCloudClient } from '../packaging/android/web/cloud.js';

function fixture(options = {}) {
  const listeners = new Map();
  const reports = [];
  const port = {
    sent: [], closed: false,
    start() {},
    close() { this.closed = true; },
    postMessage(raw) { this.sent.push(JSON.parse(raw)); },
    reply(message) { this.onmessage({ data: JSON.stringify(message) }); },
  };
  function nextMessage(kind) {
    const send = port.postMessage;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        port.postMessage = send;
        reject(new Error(`Expected ${kind} was not posted`));
      }, 5000);
      port.postMessage = function (raw) {
        send.call(this, raw);
        if (JSON.parse(raw).kind !== kind) return;
        clearTimeout(timer);
        port.postMessage = send;
        resolve();
      };
    });
  }
  const bridge = createAndroidBridge({
    host: { addEventListener: (name, fn) => listeners.set(name, fn) },
    report: (message) => reports.push(message),
    handleBack: () => true,
    ...options,
  });
  const connect = (overrides = {}) => listeners.get('message')({
    source: null, origin: '', data: 'recap:connect:v1', ports: [port], ...overrides,
  });
  return { bridge, port, reports, connect, listeners, nextMessage };
}

const file = { filename: 'recap-page-backup.json', type: 'application/json', text: '{"notes":"Caf\u00e9"}' };

async function androidBootstrapReadiness(configured, late = false) {
  const directory = await mkdtemp(join(tmpdir(), 'recap-android-bootstrap-'));
  const key = `__androidBootstrap_${randomUUID().replaceAll('-', '')}`;
  const previous = ['window', 'document'].map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]);
  const listeners = new Map();
  let releaseMain, enterMain;
  const wait = new Promise((resolve) => { releaseMain = resolve; });
  const entered = new Promise((resolve) => { enterMain = resolve; });
  const fixture = { wait, enterMain, calls: [] };
  globalThis[key] = fixture;
  let app;
  try {
    await mkdir(join(directory, 'web'), { recursive: true });
    await mkdir(join(directory, 'js', 'lib'), { recursive: true });
    await writeFile(join(directory, 'package.json'), '{"type":"module"}');
    for (const name of ['app.js', 'bridge.js', 'cloud.js']) {
      await writeFile(join(directory, 'web', name),
        await readFile(new URL(`../packaging/android/web/${name}`, import.meta.url)));
    }
    await writeFile(join(directory, 'js', 'lib', 'download.js'),
      await readFile(new URL('../src/js/lib/download.js', import.meta.url)));
    await writeFile(join(directory, 'web', 'mobile-ui.js'),
      `export function wireMobileUi() { globalThis.${key}.calls.push('mobile'); }\n`);
    await writeFile(join(directory, 'js', 'main.js'), [
      `const fixture = globalThis.${key};`,
      'fixture.enterMain();',
      'await fixture.wait;',
      'export function boot() { fixture.calls.push("boot"); }',
      'export function closeHomeUpdatesPanel(options) { fixture.calls.push(options); return true; }',
      'export async function configureCloudProviders(options) { fixture.calls.push("configure"); fixture.cloud = options; }',
    ].join('\n'));
    globalThis.window = {
      addEventListener: (name, listener) => listeners.set(name, listener),
      matchMedia: () => ({ matches: false }),
    };
    globalThis.document = {
      createElement: () => ({ setAttribute() {}, scrollIntoView() {} }),
      querySelector: (selector) => selector === '.wrap' ? { prepend() {} } : null,
    };
    app = import(pathToFileURL(join(directory, 'web', 'app.js')).href);
    let timer;
    try {
      await Promise.race([
        entered,
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Main import did not start')), 5000); }),
      ]);
    } finally { clearTimeout(timer); }
    const port = {
      starts: 0, sent: [],
      start() { this.starts++; },
      close() {},
      postMessage(raw) { this.sent.push(JSON.parse(raw)); },
    };
    const nativeHandshake = listeners.get('message');
    assert.equal(typeof nativeHandshake, 'function', 'the one-shot native message listener must precede main readiness');
    nativeHandshake({ source: null, origin: '', data: 'recap:connect:v1', ports: [port] });
    assert.equal(port.starts, 1);
    assert.deepEqual(fixture.calls, [], 'main is still suspended');
    const ready = () => port.onmessage({ data: JSON.stringify({ v: 1, kind: 'cloud-ready', generation: 3,
      capability: 'a'.repeat(64), configured, epoch: 0 }) });
    if (!late) ready();
    const { saveDownload } = await import(pathToFileURL(join(directory, 'js', 'lib', 'download.js')).href);
    const saved = saveDownload('synthetic.json', '{}', 'application/json');
    const request = port.sent.at(-1);
    assert.equal(request.kind, 'save', 'the native download handler is installed before importing main');
    port.onmessage({ data: JSON.stringify({ v: 1, kind: 'save-result', id: request.id, status: 'saved' }) });
    assert.equal(await saved, true);
    releaseMain();
    await app;
    if (late) ready();
    assert.deepEqual(fixture.calls, configured ? ['boot', 'mobile', 'configure'] : ['boot', 'mobile']);
    if (configured) {
      assert.equal(fixture.cloud.qualification, true);
      assert.equal(typeof fixture.cloud.client.forProvider, 'function');
    }
    ready();
    assert.equal(fixture.calls.filter((call) => call === 'configure').length, Number(configured),
      'duplicate readiness must not reconfigure the shared owner');
    assert.equal(port.sent.filter((message) => message.kind === 'cloud').length, 0,
      'native readiness alone must never acquire an account or call a provider');
    port.onmessage({ data: JSON.stringify({ v: 1, kind: 'back', id: 'after-main' }) });
    assert.deepEqual(fixture.calls.at(-1), { restoreFocus: true });
    assert.deepEqual(port.sent.at(-1), { v: 1, kind: 'back-result', id: 'after-main', handled: true });
    assert.equal(port.starts, 1, 'startup never replays the native handshake');
    listeners.get('pagehide')();
  } finally {
    releaseMain();
    if (app) await app;
    for (const [name, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
    delete globalThis[key];
    await rm(directory, { recursive: true, force: true });
  }
}

test('Android bootstrap receives its native handshake before main and binds only configured native readiness', async () => {
  await androidBootstrapReadiness(false);
  await androidBootstrapReadiness(true);
  await androidBootstrapReadiness(true, true);
});

test('Android native auth timeout withdraws only its exact pending connect without accepting a late result', async () => {
  const messages = [], timers = [];
  const client = createAndroidCloudClient({
    send: (message) => messages.push(message),
    setTimer: (callback) => { timers.push(callback); return timers.length; },
    clearTimer() {},
  });
  client.receive({ v: 1, kind: 'cloud-ready', generation: 7, capability: 'b'.repeat(64), configured: true, epoch: 0 });
  const provider = client.forProvider('google');
  const connecting = provider.connect();
  const original = messages[0];
  timers[0]();
  await assert.rejects(connecting, { code: 'unknown' });
  assert.deepEqual(messages[1], { v: 1, kind: 'cloud-cancel', id: original.id, generation: 7,
    capability: 'b'.repeat(64), epoch: 0, provider: 'google' });
  client.receive({ v: 1, kind: 'cloud-result', id: original.id, generation: 7, capability: 'b'.repeat(64),
    status: 'error', code: 'failed', epoch: 1 });
  const status = provider.status();
  assert.equal(messages.at(-1).epoch, 1, 'the exact late native cancellation receipt retains the new epoch without resolving connect');
  client.reset();
  await assert.rejects(status, { code: 'inactive' });
});

test('native qualification budgets distinct discovery and mutation RPC ceilings without extending writes', async () => {
  const timers = [];
  const client = createAndroidCloudClient({
    send() {},
    setTimer: (_callback, delay) => { timers.push(delay); return timers.length; },
    clearTimer() {},
  });
  client.receive({ v: 1, kind: 'cloud-ready', generation: 7, capability: 'b'.repeat(64), configured: true, epoch: 1 });
  const request = client.forProvider('microsoft').reconcile();
  const discovery = client.forProvider('microsoft').discover();
  const write = client.forProvider('microsoft').writeSnapshot({ epoch: 1, components: {}, label: 'Synthetic' });
  client.reset();
  await assert.rejects(request, { code: 'inactive' });
  await assert.rejects(discovery, { code: 'inactive' });
  await assert.rejects(write, { code: 'inactive' });
  assert.deepEqual(timers, [120000, 300000, 120000], 'Only read-only discovery gets the longer bounded window');
  const overridden = [], customMessages = [];
  let expire;
  const custom = createAndroidCloudClient({
    send(message) { customMessages.push(message); }, timeoutMs: 5000,
    setTimer: (callback, delay) => { expire = callback; overridden.push(delay); return 1; }, clearTimer() {},
  });
  custom.receive({ v: 1, kind: 'cloud-ready', generation: 7, capability: 'b'.repeat(64), configured: true, epoch: 1 });
  const customDiscovery = custom.forProvider('microsoft').discover();
  let outcome = 'pending';
  customDiscovery.then(() => { outcome = 'fulfilled'; }, () => { outcome = 'rejected'; });
  const rejected = assert.rejects(customDiscovery, { code: 'unknown' });
  expire();
  await rejected;
  custom.receive({ v: 1, kind: 'cloud-result', id: customMessages[0].id, generation: 7,
    capability: 'b'.repeat(64), status: 'ok', epoch: 1, result: { provider: 'microsoft', epoch: 1, streams: [] } });
  await Promise.resolve();
  assert.equal(outcome, 'rejected', 'A late read-only result cannot turn expiry into confirmation');
  assert.equal(customMessages.length, 1, 'Discovery expiry does not retry or cancel a write');
  custom.reset();
  assert.deepEqual(overridden, [5000], 'An explicit timeout remains an override for every operation');
  const source = await readFile(new URL(
    '../packaging/android/app/src/androidTest/java/io/github/raymondnassar/recappage/prototype/CloudAuthIntegrationTest.java',
    import.meta.url), 'utf8');
  const expression = source.match(/private static final long SDK_CHANGE_WAIT_MS = ([0-9+* ]+);/)?.[1];
  assert(expression);
  const qualificationBudget = new Function(`return (${expression});`)();
  assert.equal(qualificationBudget, 2 * timers[0] + 30000,
    'One pipeline wait must not cancel a valid write while its separate RPC ceiling remains');
  assert.equal((source.match(/waitSdkScope\(parent, input, fixture, SDK_CHANGE_WAIT_MS,/g) ?? []).length, 2);
  const readbackExpression = source.match(/private static final long SDK_READBACK_WAIT_MS = ([0-9+* ]+);/)?.[1];
  assert(readbackExpression, 'Readback must account for startup reconciliation followed by discovery');
  assert.equal(new Function(`return (${readbackExpression});`)(), timers[0] + timers[1] + 30000);
  assert.equal((source.match(/waitSdkScope\(parent, input, fixture, SDK_READBACK_WAIT_MS,/g) ?? []).length, 1);
});

function cloudReady(f, overrides = {}) {
  f.connect();
  f.port.reply({ v: 1, kind: 'cloud-ready', generation: 3, capability: 'a'.repeat(64), configured: true, epoch: 1, ...overrides });
  return f.bridge.cloud.forProvider('google');
}

test('Android cloud native fixture retains exact Unicode and the actual shared component contract', async () => {
  const fixture = JSON.parse(await readFile(new URL('../packaging/android/app/src/androidTest/assets/cloud-source-fixture.json', import.meta.url), 'utf8'));
  const snapshot = await parseCloudSnapshot(fixture.text);
  assert.equal(snapshot.contentDigest, fixture.contentDigest);
  assert.deepEqual(JSON.parse(JSON.stringify(snapshot.components)), fixture.components);
  assert.equal(snapshot.components.reader.notes[999], 'Synthetic caf\u00e9 \u2028 \ud83d\ude3a');
});

test('Android cloud RPC keeps epochs and exact portable acknowledgements separate from envelope bytes', async () => {
  const f = fixture();
  await assert.rejects(f.bridge.cloud.forProvider('google').status(), (error) => error.code === 'unsupported');
  const cloud = cloudReady(f);
  const pending = cloud.status();
  const sent = f.port.sent.at(-1);
  assert.equal(sent.kind, 'cloud');
  assert.equal(sent.epoch, 1);
  f.port.reply({ v: 1, kind: 'cloud-result', id: sent.id, generation: 2, capability: sent.capability, status: 'ok', result: {} });
  let settled = false;
  pending.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  f.port.reply({ v: 1, kind: 'cloud-result', id: sent.id, generation: 3, capability: sent.capability, epoch: 1, status: 'ok',
    result: { provider: 'google', state: 'connected', phase: 'active', epoch: 1, account: { id: 'synthetic', label: 'Synthetic', token: 'PRIVATE' }, acknowledgement: null, token: 'PRIVATE' } });
  assert.equal(JSON.stringify(await pending).includes('PRIVATE'), false);
  const saving = cloud.writeSnapshot({ epoch: 1, components: {}, label: 'Synthetic' });
  const write = f.port.sent.at(-1);
  const ack = { provider: 'google', phase: 'acknowledged', epoch: 1, attemptEpoch: 1, streamId: 'b'.repeat(64),
    attemptId: 'c'.repeat(64), generation: 7, contentDigest: 'd'.repeat(64), byteDigest: 'e'.repeat(64), token: 'PRIVATE' };
  f.port.reply({ v: 1, kind: 'cloud-result', id: write.id, generation: 3, capability: write.capability, epoch: 1, status: 'ok', result: ack });
  const result = await saving;
  assert.notEqual(result.contentDigest, result.byteDigest);
  assert.equal(result.generation, 7);
  assert.equal(result.token, undefined);
  const wrong = cloud.reconcile();
  const request = f.port.sent.at(-1);
  f.port.reply({ v: 1, kind: 'cloud-result', id: request.id, generation: 3, capability: request.capability, epoch: 2, status: 'ok', result: { ...ack, epoch: 2 } });
  await assert.rejects(wrong, (error) => error.code === 'inactive');
  f.bridge.disconnect();
});

test('Android cloud codec uses the actual shared validator and refuses inactive or mismatched codec jobs', async () => {
  const f = fixture({ loadCloudCodec: async () => ({ createCloudSnapshot, parseCloudSnapshot }) });
  cloudReady(f);
  const captured = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
  const capture = { captureId: 'b'.repeat(64), streamId: 'c'.repeat(64), attemptId: 'd'.repeat(64), slotId: 'fixed-a',
    generation: 1, capturedAt: '2026-10-23T00:00:00.000Z', label: 'Synthetic native' };
  const message = { v: 1, kind: 'cloud-codec', id: `codec-${'e'.repeat(64)}`, nonce: 'f'.repeat(64),
    generation: 3, capability: 'a'.repeat(64), epoch: 1, part: 0, total: 1,
    text: JSON.stringify({ mode: 'encode', components: captured.components, capture }) };
  f.port.reply({ ...message, capability: '1'.repeat(64) });
  assert.equal(f.port.sent.length, 0);
  const encodedReply = f.nextMessage('cloud-codec-result');
  f.port.reply(message);
  await encodedReply;
  const response = f.port.sent.filter((message) => message.kind === 'cloud-codec-result');
  assert(response.length > 0);
  const encoded = JSON.parse(response.map((message) => message.text).join(''));
  assert.equal(encoded.ok, true);
  assert.equal((await parseCloudSnapshot(encoded.text)).contentDigest, captured.contentDigest);
  f.port.sent.length = 0;
  const invalid = structuredClone(captured.components);
  invalid.reader.notes[999] = 'x'.repeat(40000);
  const invalidText = JSON.stringify({ mode: 'encode', components: invalid, capture });
  const parts = Math.ceil(invalidText.length / 32768);
  const invalidReply = f.nextMessage('cloud-codec-result');
  for (let part = 0; part < parts; part++) f.port.reply({
    ...message, id: `codec-${'1'.repeat(64)}`, nonce: '2'.repeat(64), part, total: parts,
    text: invalidText.slice(part * 32768, (part + 1) * 32768),
  });
  await invalidReply;
  const refused = JSON.parse(f.port.sent.filter((message) => message.kind === 'cloud-codec-result').map((message) => message.text).join(''));
  assert.deepEqual(refused, { ok: false, code: 'invalid' }, 'the real shared owner rejects, rather than truncates, an overlong note');
  const before = f.port.sent.length;
  f.bridge.disconnect();
  f.port.reply(message);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.port.sent.length, before);
});

test('Android cloud pending work is withdrawn on port replacement without changing export or back semantics', async () => {
  const f = fixture();
  const cloud = cloudReady(f);
  const pending = cloud.reconcile();
  f.listeners.get('pagehide')();
  await assert.rejects(pending, (error) => error.code === 'inactive');
  assert.equal(f.bridge.cloud.supported, false);
  const unsupported = fixture();
  cloudReady(unsupported, { configured: false });
  await assert.rejects(unsupported.bridge.cloud.forProvider('google').connect(), (error) => error.code === 'unsupported');
  assert.equal(unsupported.port.sent.length, 0);
  unsupported.bridge.disconnect();
});

test('Android cloud drops late decoded reads and carries only safe retry metadata', async () => {
  let release;
  let entered;
  const enteredCodec = new Promise((resolve) => { entered = resolve; });
  const codec = new Promise((resolve) => { release = resolve; });
  const f = fixture({ loadCloudCodec: async () => { entered(); return codec; } });
  const cloud = cloudReady(f);
  const captured = await captureCloudContent({ storage: { getItem: () => null }, isBlocked: () => false });
  const encoded = await createCloudSnapshot(captured.components, {
    captureId: 'b'.repeat(64), streamId: 'c'.repeat(64), attemptId: 'd'.repeat(64), slotId: 'fixed-a',
    generation: 1, capturedAt: '2026-10-23T00:00:00.000Z', label: 'Synthetic',
  });
  const reading = cloud.readSnapshot({ streamId: encoded.snapshot.streamId, selection: {} });
  const request = f.port.sent.at(-1);
  f.port.reply({ v: 1, kind: 'cloud-result', id: request.id, generation: 3, capability: request.capability,
    epoch: 1, status: 'ok', result: encoded.snapshot });
  await enteredCodec;
  f.bridge.disconnect();
  release({ parseCloudSnapshot });
  await assert.rejects(reading, (error) => error.code === 'inactive');
  const next = fixture();
  const connected = cloudReady(next);
  const pending = connected.reconcile();
  const retry = next.port.sent.at(-1);
  next.port.reply({ v: 1, kind: 'cloud-result', id: retry.id, generation: 3, capability: retry.capability, epoch: 1,
    status: 'error', code: 'failed', outcome: 'unknown', retryAfterMs: 3600000, providerStatus: 429, token: 'PRIVATE' });
  await assert.rejects(pending, (error) => error.outcome === 'unknown' && error.retryAfterMs === 3600000
    && error.status === 429 && !error.message.includes('PRIVATE') && error.token === undefined);
  next.bridge.disconnect();
});

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
