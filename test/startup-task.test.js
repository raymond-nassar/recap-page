import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { connect } from 'node:net';

import {
  CONSENT_MS, ENABLE_TOKEN, STARTUP_API_HEADER, STARTUP_API_PREFIX, STARTUP_STATES, STATE_TOKEN, createStartupHost, stateFromExit,
} from '../host/startupTask.mjs';

// The startup endpoint changes operating-system state for a web page (#1412, decision 13), so these drive
// it over real loopback connections, with a fake launcher standing in for the packaged one. The fake
// records every token it is given, which is the whole of what this host can make the launcher do.
function fakeLauncher(exits) {
  const calls = [];
  const queue = [...exits];
  const run = async (file, token) => {
    calls.push([file, token]);
    return queue.length ? queue.shift() : 13;
  };
  return { calls, run };
}

async function hostServer(options) {
  const host = createStartupHost({ launcher: 'C:\\app\\RecapPageLauncher.exe', sessionCheck: async () => true, ...options });
  const server = createServer((req, res) => {
    if (String(req.url).startsWith(STARTUP_API_PREFIX)) host.handle(req, res);
    else res.writeHead(404).end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  async function call(operation, body = {}, headers = {}, { method = 'POST', raw } = {}) {
    const merged = {
      host: `127.0.0.1:${port}`, origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json',
      [STARTUP_API_HEADER]: '1', 'sec-fetch-site': 'same-origin', ...headers,
    };
    for (const key of Object.keys(merged)) if (merged[key] === undefined) delete merged[key];
    return new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: `${STARTUP_API_PREFIX}${operation}`, method, headers: merged, agent: false, setHost: false }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null });
        });
      });
      req.on('error', reject);
      req.end(method === 'GET' ? undefined : raw ?? JSON.stringify(body));
    });
  }
  return { port, call, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('the launcher exit code maps to the five startup task states and nothing else', () => {
  assert.deepEqual([0, 1, 2, 3, 4].map(stateFromExit), [...STARTUP_STATES]);
  for (const code of [10, 12, 13, 5, -1, null, undefined, 1.5, '2']) assert.equal(stateFromExit(code), 'unavailable', String(code));
});

test('a request that is not this page\'s own same-origin fetch is refused before the launcher runs', async () => {
  const launcher = fakeLauncher([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const server = await hostServer({ run: launcher.run });
  try {
    const cases = [
      ['GET', {}, { method: 'GET' }, 405, 'method'],
      ['foreign host', { host: 'example.test' }, {}, 403, 'host'],
      ['another port', { host: '127.0.0.1:8788' }, {}, 403, 'host'],
      ['foreign origin', { origin: 'https://example.test' }, {}, 403, 'origin'],
      ['no origin', { origin: undefined }, {}, 403, 'origin'],
      ['cross-site fetch', { 'sec-fetch-site': 'cross-site' }, {}, 403, 'site'],
      ['same-site fetch', { 'sec-fetch-site': 'same-site' }, {}, 403, 'site'],
      ['no fetch metadata', { 'sec-fetch-site': undefined }, {}, 403, 'site'],
      ['no API header', { [STARTUP_API_HEADER]: undefined }, {}, 403, 'header'],
      ['a form post', { 'content-type': 'application/x-www-form-urlencoded' }, {}, 415, 'type'],
    ];
    for (const [label, headers, options, status, code] of cases) {
      for (const operation of ['state', 'enable']) {
        const res = await server.call(operation, {}, headers, options);
        assert.equal(res.status, status, `${label} ${operation}`);
        assert.deepEqual(res.body, { ok: false, error: { code } }, `${label} ${operation}`);
        assert.equal(res.headers['cache-control'], 'no-store');
      }
    }
    assert.equal((await server.call('unknown')).status, 404);
    assert.equal((await server.call('state?x=1')).status, 404, 'an operation is named exactly');
    assert.deepEqual(launcher.calls, [], 'the launcher never ran');
  } finally {
    await server.close();
  }
});

test('a caller in another Windows session is refused before the launcher runs', async () => {
  const launcher = fakeLauncher([0]);
  const server = await hostServer({ run: launcher.run, sessionCheck: async () => false });
  try {
    for (const operation of ['state', 'enable']) {
      const res = await server.call(operation);
      assert.deepEqual([res.status, res.body.error.code], [403, 'session'], operation);
    }
    assert.deepEqual(launcher.calls, []);
  } finally {
    await server.close();
  }
});

test('the task is enabled only with the consent value a Disabled read issued, once', async () => {
  let n = 0;
  const issue = () => (++n).toString(16).padStart(64, '0');
  const launcher = fakeLauncher([0, 2, 0, 0, 2]);
  const server = await hostServer({ run: launcher.run, issue });
  try {
    assert.deepEqual((await server.call('enable', {})).body, { ok: false, error: { code: 'consent' } }, 'nothing was issued yet');
    const read = await server.call('state');
    assert.deepEqual(read.body, { ok: true, state: 'disabled', consent: '1'.padStart(64, '0') });
    const enabled = await server.call('enable', { consent: read.body.consent });
    assert.deepEqual(enabled.body, { ok: true, state: 'enabled' });
    assert.equal((await server.call('enable', { consent: read.body.consent })).body.error.code, 'consent', 'a value is spent by its first use');
    // A new read replaces the value before it, so only the question on screen can be answered.
    const first = (await server.call('state')).body.consent;
    const second = (await server.call('state')).body.consent;
    assert.notEqual(first, second);
    assert.equal((await server.call('enable', { consent: first })).body.error.code, 'consent');
    assert.equal((await server.call('enable', { consent: second })).body.error.code, 'consent', 'and a wrong value spends the one held');
    for (const consent of [undefined, '', 'x'.repeat(64), second.toUpperCase(), 7, [second]]) {
      assert.equal((await server.call('enable', { consent })).body.error.code, 'consent');
    }
    assert.deepEqual(launcher.calls.map(([, token]) => token), [STATE_TOKEN, ENABLE_TOKEN, STATE_TOKEN, STATE_TOKEN]);
    assert.ok(launcher.calls.every(([file]) => file === 'C:\\app\\RecapPageLauncher.exe'));
  } finally {
    await server.close();
  }
});

test('no state but Disabled issues a consent value, so the reader\'s and the policy\'s choices are never overridden', async () => {
  for (const [code, state] of [[1, 'disabledByUser'], [2, 'enabled'], [3, 'disabledByPolicy'], [4, 'enabledByPolicy'], [10, 'unavailable'], [12, 'unavailable'], [13, 'unavailable'], [null, 'unavailable']]) {
    const launcher = fakeLauncher([code]);
    const server = await hostServer({ run: launcher.run, issue: () => 'a'.repeat(64) });
    try {
      assert.deepEqual((await server.call('state')).body, { ok: true, state }, String(code));
      assert.equal((await server.call('enable', { consent: 'a'.repeat(64) })).body.error.code, 'consent', String(code));
      assert.deepEqual(launcher.calls.map(([, token]) => token), [STATE_TOKEN], String(code));
    } finally {
      await server.close();
    }
  }
});

test('a consent value expires', async () => {
  let clock = 1_000;
  const launcher = fakeLauncher([0, 0, 2]);
  const server = await hostServer({ run: launcher.run, now: () => clock });
  try {
    const late = (await server.call('state')).body.consent;
    clock += CONSENT_MS + 1;
    assert.equal((await server.call('enable', { consent: late })).body.error.code, 'consent');
    const timely = (await server.call('state')).body.consent;
    clock += CONSENT_MS;
    assert.deepEqual((await server.call('enable', { consent: timely })).body, { ok: true, state: 'enabled' });
  } finally {
    await server.close();
  }
});

test('one operation runs at a time, and a caller that stops sending cannot hold that turn', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const server = await hostServer({ run: async () => { await held; return 0; }, bodyMs: 200 });
  try {
    const first = server.call('state');
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    assert.deepEqual((await server.call('state')).body, { ok: false, error: { code: 'busy' } });
    release();
    assert.equal((await first).body.state, 'disabled');
    for (const [label, raw] of [['not JSON', '{'], ['an array', '[]'], ['too large', JSON.stringify({ pad: 'x'.repeat(300) })]]) {
      const res = await server.call('state', {}, {}, { raw });
      assert.equal(res.status, 400, label);
    }
    // Headers and a promised body that never arrives.
    const stalled = await new Promise((resolve, reject) => {
      const socket = connect(server.port, '127.0.0.1');
      let text = '';
      socket.on('data', (chunk) => { text += chunk.toString('utf8'); });
      socket.on('close', () => resolve(text));
      socket.on('error', reject);
      socket.write([`POST ${STARTUP_API_PREFIX}state HTTP/1.1`, `Host: 127.0.0.1:${server.port}`, `Origin: http://127.0.0.1:${server.port}`,
        'Sec-Fetch-Site: same-origin', `${STARTUP_API_HEADER}: 1`, 'Content-Type: application/json', 'Content-Length: 20', '', '{'].join('\r\n'));
    });
    assert.match(stalled, /^HTTP\/1\.1 400 /);
    assert.equal((await server.call('state')).body.state, 'disabled', 'the turn was given back');
  } finally {
    await server.close();
  }
});

test('the host needs the launcher path it is given and takes no other from a request', () => {
  assert.throws(() => createStartupHost({}), TypeError);
  assert.throws(() => createStartupHost({ launcher: '' }), TypeError);
});
