import test from 'node:test';
import assert from 'node:assert/strict';

import {
  checkLocalServer,
  LOCAL_SERVER_HEADER_NAME,
  LOCAL_SERVER_HEADER_VALUE,
  LOCAL_SERVER_HEALTH_PATH,
  LOCAL_SERVER_STATUS,
  LOCAL_SERVER_TIMEOUT_MS,
} from '../src/js/lib/localServer.js';

function response(status, identity = LOCAL_SERVER_HEADER_VALUE) {
  return {
    status,
    headers: {
      get: (name) => (name === LOCAL_SERVER_HEADER_NAME ? identity : null),
    },
  };
}

test('the probe requires the exact cache-proof server identity', async () => {
  const calls = [];
  const status = await checkLocalServer({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return response(204);
    },
  });

  assert.equal(status, LOCAL_SERVER_STATUS.READY);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, LOCAL_SERVER_HEALTH_PATH);
  assert.equal(calls[0].options.cache, 'no-store');
  assert.equal(calls[0].options.signal instanceof AbortSignal, true);
  assert.equal(LOCAL_SERVER_TIMEOUT_MS, 2500);
});

test('a reachable response with the wrong contract is unexpected', async () => {
  for (const candidate of [
    response(200),
    response(204, null),
    response(204, 'wrong-app'),
    { status: 204 },
    null,
  ]) {
    const status = await checkLocalServer({ fetchImpl: async () => candidate });
    assert.equal(status, LOCAL_SERVER_STATUS.UNEXPECTED);
  }
});

test('a refused request reports the local server as unreachable', async () => {
  const status = await checkLocalServer({
    fetchImpl: async () => {
      throw new TypeError('Failed to fetch');
    },
  });
  assert.equal(status, LOCAL_SERVER_STATUS.UNREACHABLE);
});

test('the deadline aborts a hung request and reports it as unreachable', async () => {
  let receivedSignal = null;
  const status = await checkLocalServer({
    timeoutMs: 5,
    fetchImpl: (_url, { signal }) => {
      receivedSignal = signal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
  });

  assert.equal(status, LOCAL_SERVER_STATUS.UNREACHABLE);
  assert.equal(receivedSignal.aborted, true);
});

test('every settled path clears its deadline', async () => {
  for (const candidate of [
    async () => response(204),
    async () => response(500),
    async () => { throw new TypeError('refused'); },
  ]) {
    const timers = [];
    const cleared = [];
    await checkLocalServer({
      fetchImpl: candidate,
      setTimeoutImpl: (callback, ms) => {
        const timer = { callback, ms };
        timers.push(timer);
        return timer;
      },
      clearTimeoutImpl: (timer) => cleared.push(timer),
    });
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, LOCAL_SERVER_TIMEOUT_MS);
    assert.deepEqual(cleared, timers);
  }
});
