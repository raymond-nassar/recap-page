import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAndroidBridge } from '../packaging/android/web/bridge.js';
import { createAndroidCloudTransport, createCloudPort } from '../packaging/android/web/cloudPort.js';
import { cloudTransport, installCloudTransport } from '../src/js/lib/cloudTransports.js';
import { createCloudHostTransport } from '../src/js/lib/cloudHostTransport.js';

// The page's half of the Android cloud route (#810, P03-T03): each transport call is one message on the
// app's port, in the exact shape MainActivity reads, and the answer comes back by id.
function nativePort() {
  return { sent: [], postMessage(raw) { this.sent.push(raw); } };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('a cloud request is one message in the exact shape the app reads, answered by its id', async () => {
  const cloud = createCloudPort();
  const port = nativePort();
  cloud.attach(port);
  const answer = cloud.fetch('list', { body: '{"connection":"c1"}' });
  assert.deepEqual(port.sent, ['{"v":1,"kind":"cloud","id":"cloud-1","op":"list","body":"{\\"connection\\":\\"c1\\"}"}']);
  assert.ok(port.sent[0].startsWith('{"v":1,"kind":"cloud","id":"'), 'MainActivity checks this prefix before parsing');
  cloud.receive({ v: 1, kind: 'cloud-result', id: 'cloud-9', status: 200, body: { ok: true } });
  cloud.receive({ v: 1, kind: 'cloud-result', id: 'cloud-1', status: 200, body: { ok: true, items: [] } });
  const response = await answer;
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, items: [] });
});

test('a request made before the port arrives waits for it, and one in flight fails when the port goes', async () => {
  const cloud = createCloudPort();
  const waiting = cloud.fetch('status', { body: '{}' });
  const port = nativePort();
  cloud.attach(port);
  assert.equal(port.sent.length, 1);
  cloud.receive({ v: 1, kind: 'cloud-result', id: 'cloud-1', status: 404, body: null });
  assert.equal((await waiting).status, 404);

  const lost = cloud.fetch('status', { body: '{}' });
  cloud.detach();
  await assert.rejects(lost, /connection/i);
  const replaced = cloud.fetch('status', { body: '{}' });
  const next = nativePort();
  cloud.attach(next);
  const stale = cloud.fetch('status', { body: '{}' });
  cloud.attach(nativePort());
  await assert.rejects(stale, /connection/i, 'the app answers only its current port');
  assert.equal(next.sent.length, 2, 'the waiting request went to the port that arrived first');
  await assert.rejects(replaced, /connection/i);
});

test('an aborted request is dropped, and its late answer is ignored', async () => {
  const cloud = createCloudPort();
  const port = nativePort();
  cloud.attach(port);
  const controller = new AbortController();
  const answer = cloud.fetch('read', { body: '{}', signal: controller.signal });
  controller.abort();
  await assert.rejects(answer, { name: 'AbortError' });
  cloud.receive({ v: 1, kind: 'cloud-result', id: 'cloud-1', status: 200, body: { ok: true } });

  const already = new AbortController();
  already.abort();
  await assert.rejects(cloud.fetch('read', { body: '{}', signal: already.signal }), { name: 'AbortError' });
  assert.equal(port.sent.length, 1, 'nothing is sent for a request already given up');
});

test('the Android transport reads a dormant app as no cloud backup, and says its sign-in reaches this device', async () => {
  const cloud = createCloudPort();
  const port = nativePort();
  cloud.attach(port);
  const transport = createAndroidCloudTransport(cloud, createCloudHostTransport);
  assert.equal(transport.scope, 'device');
  const status = transport.status();
  await settle();
  const sent = JSON.parse(port.sent[0]);
  assert.deepEqual([sent.op, sent.body], ['status', '{}']);
  cloud.receive({ v: 1, kind: 'cloud-result', id: sent.id, status: 404, body: null });
  assert.deepEqual(await status, { enabled: false });

  const connected = transport.status();
  await settle();
  cloud.receive({
    v: 1, kind: 'cloud-result', id: JSON.parse(port.sent[1]).id, status: 200,
    body: { ok: true, status: { state: 'connected', provider: 'onedrive', connection: 'c1', account: 'reader@example.test' } },
  });
  assert.deepEqual([(await connected).enabled, (await connected).state], [true, 'connected']);
});

test('the bridge hands the cloud half its port and its answers, and takes the port back', () => {
  const listeners = new Map();
  const calls = [];
  const port = { start() {}, close() {}, postMessage() {} };
  createAndroidBridge({
    host: { addEventListener: (name, fn) => listeners.set(name, fn) },
    report: () => {},
    handleBack: () => true,
    cloud: {
      attach: (attached) => calls.push(['attach', attached === port]),
      detach: () => calls.push(['detach']),
      receive: (message) => calls.push(['receive', message.id]),
    },
  });
  listeners.get('message')({ source: null, origin: '', data: 'recap:connect:v1', ports: [port] });
  port.onmessage({ data: JSON.stringify({ v: 1, kind: 'cloud-result', id: 'cloud-1', status: 404, body: null }) });
  listeners.get('pagehide')();
  assert.deepEqual(calls, [['detach'], ['attach', true], ['receive', 'cloud-1'], ['detach']]);
});

test('the page has one cloud transport, the Windows host unless an app installed its own first', () => {
  const windows = cloudTransport();
  assert.equal(typeof windows.status, 'function');
  assert.equal(windows.scope, undefined);
  const own = { status() {}, connect() {}, disconnect() {}, scope: 'device' };
  installCloudTransport(own);
  assert.equal(cloudTransport(), own);
  assert.throws(() => installCloudTransport(own), /already/);
  const main = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /transport: cloudTransport\(\),/);
  const app = readFileSync(new URL('../packaging/android/web/app.js', import.meta.url), 'utf8');
  assert.ok(app.indexOf("from './cloud.js'") >= 0 && app.indexOf("from './cloud.js'") < app.indexOf("from '../js/main.js'"),
    'the Android transport is installed before the page module that reads it is evaluated');
});
