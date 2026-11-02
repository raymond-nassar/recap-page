import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudHostTransport } from '../src/js/lib/cloudHostTransport.js';
import { createICloudFetch, createICloudTransport, iosDeviceLabel } from '../packaging/ios/icloud-web/icloudTransport.js';

// The page's half of iCloud backup in the iOS app (#949, P04): each transport call is one message to the
// app's script handler, in the shape IosBridgeHandler's "cloud" case reads, and its reply carries the
// status and the JSON text the transport parses.
function nativeHandler(answer) {
  return {
    sent: [],
    postMessage(message) {
      this.sent.push(message);
      return answer(message);
    },
  };
}

const reply = (status, body) => ({ v: 1, kind: 'cloud-result', status, body: JSON.stringify(body) });

test('a cloud request is one message in the shape the app reads, and the reply is read as the host is', async () => {
  const native = nativeHandler(() => reply(200, { ok: true, items: [] }));
  const response = await createICloudFetch(native)('list', { body: '{"connection":"c1"}' });
  assert.deepEqual(native.sent, [{ v: 1, kind: 'cloud', op: 'list', body: '{"connection":"c1"}' }]);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, items: [] });
});

test('through the shared transport, a build without iCloud reads as not enabled and a refusal keeps its code', async () => {
  const dormant = createICloudTransport({
    native: nativeHandler(() => ({ v: 1, kind: 'cloud-result', status: 404, body: 'null' })),
    nav: { userAgent: 'iPhone' },
    createTransport: createCloudHostTransport,
  });
  const dormantHost = createCloudHostTransport({ fetchImpl: async () => ({ status: 404, json: async () => null }) });
  assert.deepEqual(await dormant.status(), await dormantHost.status(), 'the same answer a host without a client configuration gives');

  const native = nativeHandler((message) => (message.op === 'status'
    ? reply(200, { ok: true, status: { provider: 'icloud', state: 'connected', connection: 'a'.repeat(32), account: null } })
    : reply(200, { ok: false, error: { code: 'quota', message: 'iCloud is full.' } })));
  const transport = createICloudTransport({ native, nav: { userAgent: 'iPhone' }, createTransport: createCloudHostTransport });
  assert.equal((await transport.status()).state, 'connected');
  await assert.rejects(transport.create('x.json', new Uint8Array([1]), { connection: 'a'.repeat(32) }), { code: 'quota' });
  await assert.rejects(dormant.list({ connection: 'a'.repeat(32) }), /not part of this build/);
  assert.equal(native.sent[0].op, 'status');
  assert.equal(native.sent[0].body, '{}');
});

test('a reply in any other shape, or a handler that cannot be reached, is a fault rather than an answer', async () => {
  for (const bad of [null, { v: 2, kind: 'cloud-result', status: 200, body: '{}' }, { v: 1, kind: 'other', status: 200, body: '{}' },
    { v: 1, kind: 'cloud-result', status: '200', body: '{}' }, { v: 1, kind: 'cloud-result', status: 200, body: { ok: true } }]) {
    await assert.rejects(createICloudFetch(nativeHandler(() => bad))('status', { body: '{}' }), /does not expect/);
  }
  await assert.rejects(createICloudFetch(undefined)('status', { body: '{}' }), /could not be reached/);
  await assert.rejects(createICloudFetch(nativeHandler(() => { throw new Error('gone'); }))('status', { body: '{}' }), /gone/);
  await assert.rejects(createICloudFetch(nativeHandler(() => Promise.reject(new Error('refused'))))('status', { body: '{}' }), /refused/);
});

test('an aborted request settles at once, before or after it was sent', async () => {
  const early = new AbortController();
  early.abort();
  const unsent = nativeHandler(() => reply(200, { ok: true }));
  await assert.rejects(createICloudFetch(unsent)('read', { body: '{}', signal: early.signal }), { name: 'AbortError' });
  assert.equal(unsent.sent.length, 0);

  const late = new AbortController();
  const pending = createICloudFetch(nativeHandler(() => new Promise(() => {})))('read', { body: '{}', signal: late.signal });
  late.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});

test('the transport reaches this device alone and names it as the iOS app, an iPad included', () => {
  const transport = createICloudTransport({ native: nativeHandler(() => null), nav: { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }, createTransport: createCloudHostTransport });
  assert.equal(transport.scope, 'device');
  assert.equal(transport.device, 'Recap Page on iPhone');
  assert.equal(iosDeviceLabel({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' }), 'Recap Page on iPad');
  assert.equal(iosDeviceLabel({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 5 }), 'Recap Page on iPad');
  assert.equal(iosDeviceLabel({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', maxTouchPoints: 0 }), 'Recap Page on iPhone');
  for (const label of ['Recap Page on iPhone', 'Recap Page on iPad']) {
    assert.doesNotMatch(label, /android|windows|google|microsoft/i, 'the iOS app names no other platform or service');
  }
});
