import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAndroidBridge, validateExport } from '../packaging/android/web/bridge.js';
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

test('Android betas have a distinct package version and advance beyond Beta 1', async () => {
  const build = await readFile(new URL('../packaging/android/app/build.gradle', import.meta.url), 'utf8');
  assert.match(build, /def betaRevision = [1-9]\d*\b/);
  assert.match(build, /versionCode 3000000 \+ betaRevision/);
  const revision = Number(build.match(/def betaRevision = (\d+)/)[1]);
  assert.ok(3000000 + revision > 3000001 && 3000000 + revision <= 2100000000);
  assert.ok(build.includes('versionName "${metadata.version}-beta.${betaRevision}"'));
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
    for (const name of ['js/main.js', 'js/storage.js', 'js/reader.js', 'js/lib/model.js', 'js/lib/download.js', 'js/views/recovery.js', 'open.js', 'styles.css']) {
      assert.deepEqual(await readFile(join(output, name)), await readFile(join('src', name)), name);
    }
    const generated = await readFile(join(output, 'index.html'), 'utf8');
    assert.match(generated, /\.\/android\/mobile\.css/);
    assert.match(generated, /\.\/android\/app\.js/);
    assert.ok(generated.indexOf('styles.css') < generated.indexOf('android/mobile.css'));
    assert.doesNotMatch(generated, /src="\.\/js\/app\.js"/);
    assert.doesNotMatch(await readFile(join('src', 'index.html'), 'utf8'), /android\/(?:mobile\.css|app\.js)/);
    await assert.rejects(readFile(join(output, 'dev-faults.html')), { code: 'ENOENT' });
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
});
