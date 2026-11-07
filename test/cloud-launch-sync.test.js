import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { CLOUD_SYNC_CHECK_TIMEOUT_MS, CloudLaunchSync, createCloudSyncMarker } from '../src/js/lib/cloudLaunchSync.js';
import { personalDigest } from '../src/js/lib/cloudCoordinator.js';
import { CLOUD_BACKUP_LOCK } from '../src/js/storage.js';

const context = Object.freeze({ connection: 'account', stream: 'a'.repeat(32), consentId: 'b'.repeat(32) });

function locks() {
  const slots = new Map();
  return {
    async request(name, options, operation) {
      if (!slots.has(name)) slots.set(name, { held: false, waiting: [] });
      const slot = slots.get(name);
      if (options.ifAvailable && slot.held) return operation(null);
      if (slot.held) await new Promise((resolve) => slot.waiting.push(resolve));
      slot.held = true;
      try { return await operation({ name, mode: 'exclusive' }); }
      finally {
        const next = slot.waiting.shift();
        if (next) next();
        else slot.held = false;
      }
    },
  };
}

function fixture() {
  const mutex = locks();
  const markerValues = new Map();
  const marker = createCloudSyncMarker(() => ({
    getItem: (key) => markerValues.get(key) ?? null,
    setItem: (key, value) => markerValues.set(key, value),
    removeItem: (key) => markerValues.delete(key),
  }));
  const data = {
    gate: null, remotes: [], failure: null, seen: [], next: 0, matchedDigest: null, declinedDigest: null, declinedByStream: [],
    kept: null, pendingKept: null,
    snapshot: {
      text: 'snapshot',
      backup: {
        digest: 'c'.repeat(64),
        components: {
          reader: { lists: { one: {} }, listOrder: ['one'], active: 'one', read: { 1: 100 } },
          history: { records: [] }, settings: {}, draft: null,
        },
      },
    },
  };
  const protocol = {
    locks: mutex,
    randomId: () => (++data.next).toString(16).padStart(32, '0'),
    exclusive: (operation) => mutex.request(CLOUD_BACKUP_LOCK, { mode: 'exclusive' }, operation),
    async record() {
      return { stream: context.stream, consent: { connection: context.connection, id: context.consentId, provider: 'onedrive' } };
    },
    async syncGate() { return data.gate; },
    async setSyncGate(next) {
      if (next.signal?.aborted || (next.authorize && !next.authorize())) {
        throw Object.assign(new Error('The cloud check changed.'), { code: 'raced' });
      }
      if (!next.held && data.gate?.epoch !== next.epoch) throw Object.assign(new Error('stale'), { code: 'raced' });
      const pending = next.pending === undefined ? data.gate?.pending : next.pending;
      data.gate = { version: 1, ...next };
      if (pending == null) delete data.gate.pending;
      else data.gate.pending = pending;
      return data.gate;
    },
    async discoverSync() {
      data.seen.push(data.gate?.held);
      if (data.wait) await data.wait;
      if (data.failure) throw Object.assign(new Error('Check failed.'), { code: data.failure });
      return data.remotes.map((remote) => ({
        ...remote, name: `recap-page-backup-v1-${remote.stream}-${remote.generation}.json.gz`,
        listedSize: remote.listedSize ?? null,
      }));
    },
    async syncListing() {
      return data.remotes.map(({ id, stream, generation, listedSize }) => ({
        id, stream, generation, name: `recap-page-backup-v1-${stream}-${generation}.json.gz`, size: listedSize ?? null,
      }));
    },
    async syncState() { return { matchedDigest: data.matchedDigest, declinedDigest: data.declinedDigest, kept: data.kept }; },
    async keptPending() { return data.pendingKept; },
    async syncDeclines() { return structuredClone(data.declinedByStream); },
    async rememberDecline(next) {
      if (next.signal?.aborted || (next.authorize && !next.authorize())) {
        throw Object.assign(new Error('The cloud check changed.'), { code: 'raced' });
      }
      const current = data.declinedByStream.find((entry) => entry.stream === next.remoteStream)?.digest ?? null;
      if (next.expected !== undefined && current !== next.expected) throw Object.assign(new Error('stale'), { code: 'raced' });
      data.declinedByStream = data.declinedByStream.filter((entry) => entry.stream !== next.remoteStream);
      if (next.digest !== null) data.declinedByStream.push({ stream: next.remoteStream, digest: next.digest });
      return structuredClone(data.declinedByStream);
    },
    async keptHistory() { return { unknown: true }; },
    async lastUploaded() { return null; },
    async rememberSync(next) {
      if (next.signal?.aborted || (next.authorize && !next.authorize())) {
        throw Object.assign(new Error('The cloud check changed.'), { code: 'raced' });
      }
      if (next.matchedDigest !== undefined) data.matchedDigest = next.matchedDigest;
      if (next.declinedDigest !== undefined) data.declinedDigest = next.declinedDigest;
      return { ...next };
    },
  };
  const make = (options = {}) => {
    const calls = [];
    const coordinator = {
      holdSync: (code) => calls.push(['hold', code]), releaseSync: () => calls.push(['release']),
      retry: () => calls.push(['retry']),
    };
    const states = [];
    const sync = new CloudLaunchSync({
      protocol, coordinator, capture: async () => data.snapshot, locks: mutex, cryptoProvider: webcrypto, marker,
      isBlocked: () => false, isOnline: () => true, onChange: (state) => states.push(state),
      restoreReady: async () => ({ ok: true }),
      setTimer: () => 1, clearTimer: () => {},
      ...options,
    });
    return { sync, calls, states };
  };
  return { data, protocol, make };
}

test('a conclusive launch check holds first and releases the shared gate only after checking', async () => {
  const env = fixture();
  const { sync, calls } = env.make();
  await sync.start(context);
  assert.deepEqual(env.data.seen, [true], 'discovery cannot start before the durable hold');
  assert.equal(env.data.gate.held, false);
  assert.equal(sync.state.phase, 'clear');
  assert.deepEqual(calls.at(-1), ['release']);
  sync.stop();
});

test('an inconclusive launch check keeps uploads paused until a later check succeeds', async () => {
  const env = fixture();
  env.data.failure = 'unavailable';
  const { sync, calls } = env.make();
  await sync.start(context);
  assert.equal(sync.state.phase, 'failed');
  assert.equal(env.data.gate.held, true);
  assert.ok(calls.some(([kind, code]) => kind === 'hold' && code === 'check-failed'));
  env.data.failure = null;
  await sync.checkNow();
  assert.equal(sync.state.phase, 'clear');
  assert.equal(env.data.gate.held, false);
  sync.stop();
});

test('a withdrawn choice clears its notice when a later check finds another offer', async () => {
  const env = fixture();
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  const { sync } = env.make();
  await sync.start(context);
  sync.savedChanged();
  assert.match(sync.state.notice, /withdrawn/);
  await sync.checkNow();
  assert.equal(sync.state.phase, 'offer');
  assert.equal(sync.state.notice, null);
  sync.stop();
});

test('a withdrawn choice clears its notice when a later check finds no offer', async () => {
  const env = fixture();
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  const { sync } = env.make();
  await sync.start(context);
  sync.savedChanged();
  assert.match(sync.state.notice, /withdrawn/);
  env.data.remotes = [];
  await sync.checkNow();
  assert.equal(sync.state.phase, 'clear');
  assert.equal(sync.state.notice, null);
  sync.stop();
});

test('a failed Load identifies the action and keeps the upload hold', async () => {
  const env = fixture();
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  env.protocol.fetchBackup = async () => { throw new Error('The selected backup could not be read.'); };
  const { sync } = env.make({ restore: async () => ({ ok: true }) });
  await sync.start(context);
  const result = await sync.loadOffer();
  assert.equal(result.ok, false);
  assert.equal(sync.state.phase, 'failed');
  assert.equal(sync.state.action, 'load');
  assert.equal(env.data.gate.held, true);
  sync.stop();
});

test('one tab owns a pending offer and a follower rechecks after that tab closes', async () => {
  const env = fixture();
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  const first = env.make();
  const second = env.make();
  await first.sync.start(context);
  assert.equal(first.sync.state.phase, 'offer');
  await second.sync.start(context);
  assert.equal(second.sync.state.phase, 'following');
  assert.equal(env.data.gate.held, true);
  first.sync.stop();
  await second.sync.checkNow();
  assert.equal(second.sync.state.phase, 'offer');
  assert.equal(env.data.gate.held, true);
  assert.equal(second.sync.state.offer.remote.id, 'phone');
  second.sync.stop();
});

test('a follower may release only after a newer leader completed its own check', async () => {
  const env = fixture();
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  const first = env.make();
  const follower = env.make();
  await first.sync.start(context);
  await follower.sync.start(context);
  await follower.sync.checkNow();
  assert.equal(follower.sync.state.phase, 'following');
  assert.ok(!follower.calls.some(([kind]) => kind === 'release'));

  first.sync.stop();
  await new Promise((resolve) => { setImmediate(resolve); });
  env.data.remotes = [];
  const newer = env.make();
  await newer.sync.start(context);
  assert.equal(newer.sync.state.phase, 'clear');
  const checks = env.data.seen.length;
  await follower.sync.checkNow();
  assert.equal(follower.sync.state.phase, 'clear');
  assert.equal(env.data.seen.length, checks, 'the follower uses the newer leader result');
  assert.deepEqual(follower.calls.at(-1), ['release']);
  follower.sync.stop();
  newer.sync.stop();
});

test('a follower refreshes the recovery warning before publishing a newer leader result', async () => {
  const env = fixture();
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  const leader = env.make();
  const follower = env.make();
  await leader.sync.start(context);
  await follower.sync.start(context);
  await follower.sync.checkNow();
  assert.equal(follower.sync.state.phase, 'following');
  leader.sync.stop();
  await new Promise((resolve) => { setImmediate(resolve); });
  env.data.remotes = [];
  env.data.kept = { id: 'old-copy' };
  env.data.pendingKept = { id: 'unconfirmed-replacement' };
  const newer = env.make();
  await newer.sync.start(context);
  await follower.sync.checkNow();
  assert.equal(follower.sync.state.phase, 'clear');
  assert.equal(follower.sync.state.kept.id, 'old-copy');
  assert.equal(follower.sync.state.keptUnavailable, true);
  follower.sync.stop();
  newer.sync.stop();
});

test('a late follower read cannot release the hold after that tab restarts', { timeout: 1000 }, async () => {
  const env = fixture();
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  const leader = env.make();
  const follower = env.make();
  await leader.sync.start(context);
  await follower.sync.start(context);
  assert.equal(follower.sync.state.phase, 'following');
  let release;
  let entered;
  let first = true;
  const waiting = new Promise((resolve) => { release = resolve; });
  const reading = new Promise((resolve) => { entered = resolve; });
  const readGate = env.protocol.syncGate;
  env.protocol.syncGate = async (...args) => {
    if (first) {
      first = false;
      entered();
      await waiting;
      return { held: false };
    }
    return readGate(...args);
  };
  const oldCheck = follower.sync.checkNow();
  await reading;
  follower.sync.stop();
  await follower.sync.start(context);
  assert.equal(follower.sync.state.phase, 'following');
  release();
  await oldCheck;

  assert.equal(follower.sync.state.phase, 'following');
  assert.ok(!follower.calls.some(([kind]) => kind === 'release'));
  follower.sync.stop();
  leader.sync.stop();
});

test('a change before hold release commits withdraws Keep and restores its pending decision', { timeout: 1000 }, async () => {
  const env = fixture();
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  const { sync, calls } = env.make();
  await sync.start(context);
  assert.equal(sync.state.phase, 'offer');

  let release;
  let prepared;
  const waiting = new Promise((resolve) => { release = resolve; });
  const gateReady = new Promise((resolve) => { prepared = resolve; });
  const setGate = env.protocol.setSyncGate;
  env.protocol.setSyncGate = async (next) => {
    if (!next.held) {
      assert.equal(next.authorize(), true);
      prepared();
      await waiting;
      if (next.signal?.aborted) throw Object.assign(new Error('The cloud choice changed.'), { code: 'raced' });
    }
    const result = await setGate(next);
    if (!next.held) next.onCommitted?.();
    return result;
  };
  const keeping = sync.keepOffer();
  await gateReady;
  sync.savedChanged();
  release();
  const result = await keeping;

  assert.equal(result.ok, false);
  assert.equal(env.data.gate.held, true, 'the durable upload hold is rearmed before the worker lock is released');
  assert.deepEqual(env.data.declinedByStream, [], 'the invalidated choice does not suppress the other device');
  assert.notEqual(sync.state.phase, 'clear');
  assert.ok(!calls.some(([kind]) => kind === 'release'));
  sync.stop();
});

test('a change after hold release commits is a later edit, not a withdrawn Keep', { timeout: 1000 }, async () => {
  const env = fixture();
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  const { sync } = env.make();
  await sync.start(context);
  let release;
  let committed;
  const waiting = new Promise((resolve) => { release = resolve; });
  const gateCleared = new Promise((resolve) => { committed = resolve; });
  const setGate = env.protocol.setSyncGate;
  env.protocol.setSyncGate = async (next) => {
    const result = await setGate(next);
    if (!next.held) {
      next.onCommitted?.();
      committed();
      await waiting;
    }
    return result;
  };
  const keeping = sync.keepOffer();
  await gateCleared;
  sync.savedChanged();
  release();
  const result = await keeping;

  assert.equal(result.ok, true);
  assert.equal(env.data.gate.held, false);
  assert.deepEqual(env.data.declinedByStream, [{ stream: 'd'.repeat(32), digest: 'e'.repeat(64) }]);
  assert.equal(sync.state.phase, 'clear');
  assert.equal(sync.state.notice, null, 'a completed choice is not announced as withdrawn');
  sync.stop();
});

test('a failed release verification re-arms the hold and rolls back an unconfirmed Keep', { timeout: 1000 }, async () => {
  const env = fixture();
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  const { sync, calls } = env.make();
  await sync.start(context);
  const setGate = env.protocol.setSyncGate;
  env.protocol.setSyncGate = async (next) => {
    const result = await setGate(next);
    if (!next.held) {
      next.onCommitted?.();
      throw Object.assign(new Error('The saved hold could not be checked.'), { code: 'storage' });
    }
    return result;
  };
  const result = await sync.keepOffer();
  assert.equal(result.ok, false);
  assert.equal(env.data.gate.held, true);
  assert.deepEqual(env.data.declinedByStream, []);
  assert.equal(sync.state.phase, 'failed');
  assert.ok(!calls.some(([kind]) => kind === 'release'));
  sync.stop();
});

test('a late release failure cannot re-arm a replacement connection', { timeout: 1000 }, async () => {
  const env = fixture();
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  const { sync } = env.make();
  await sync.start(context);
  let release;
  let committed;
  let staleRearm = null;
  const waiting = new Promise((resolve) => { release = resolve; });
  const gateCleared = new Promise((resolve) => { committed = resolve; });
  const setGate = env.protocol.setSyncGate;
  env.protocol.setSyncGate = async (next) => {
    if (next.held && !sync.active) staleRearm = next;
    const result = await setGate(next);
    if (!next.held) {
      next.onCommitted?.();
      committed();
      await waiting;
      throw Object.assign(new Error('The saved hold could not be checked.'), { code: 'storage' });
    }
    return result;
  };
  const keeping = sync.keepOffer();
  await gateCleared;
  sync.stop();
  sync.context = { connection: 'replacement', stream: '2'.repeat(32), consentId: '3'.repeat(32) };
  sync.epoch = '4'.repeat(32);
  release();
  await keeping;

  assert.equal(staleRearm, null, 'the stopped choice cannot write a hold for a later connection');
});

for (const choice of ['check', 'request', 'override', 'raced repair']) {
  test(`an unconfirmed hold is repaired before ${choice}`, { timeout: 1000 }, async () => {
    const env = fixture();
    env.data.remotes = [{
      id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
      byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
    }];
    const { sync } = env.make();
    await sync.start(context);
    const setGate = env.protocol.setSyncGate;
    let failed = false;
    env.protocol.setSyncGate = async (next) => {
      if (failed && next.held) throw Object.assign(new Error('The hold cannot be written.'), { code: 'storage' });
      const result = await setGate(next);
      if (!next.held) {
        next.onCommitted?.();
        failed = true;
        throw Object.assign(new Error('The hold cannot be checked.'), { code: 'storage' });
      }
      return result;
    };
    const result = await sync.keepOffer();
    assert.equal(result.ok, false);
    assert.equal(sync.state.code, 'hold-unconfirmed');
    assert.match(result.error, /turn automatic backup off/i);
    env.protocol.setSyncGate = setGate;
    if (choice === 'raced repair') {
      env.protocol.exclusive = async () => { throw Object.assign(new Error('The check changed.'), { code: 'raced' }); };
      await sync.checkNow();
      assert.equal(sync.state.code, 'hold-unconfirmed', 'a failed repair cannot claim the hold is confirmed');
      sync.stop();
      return;
    }
    if (choice === 'check' || choice === 'request') {
      if (choice === 'check') await sync.checkNow();
      else await sync.requestCheck();
      assert.equal(sync.state.phase, 'offer');
      assert.equal(env.data.gate.held, true);
    } else {
      assert.equal((await sync.overrideFailure()).ok, true);
      assert.equal(sync.state.phase, 'clear');
      assert.equal(env.data.gate.held, false);
    }
    assert.deepEqual(env.data.declinedByStream, [], 'the unconfirmed Keep did not suppress the offered backup');
    sync.stop();
  });
}

test('a stalled unconfirmed-hold repair keeps the failed-check controls available', { timeout: 1000 }, async () => {
  const env = fixture();
  env.data.failure = 'unavailable';
  const timers = new Map();
  let next = 0;
  const { sync } = env.make({
    setTimer: (callback, ms) => { const id = ++next; timers.set(id, { callback, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  await sync.start(context);
  sync.holdUnconfirmed = true;
  let entered;
  const repairing = new Promise((resolve) => { entered = resolve; });
  env.protocol.setSyncGate = async () => { entered(); return new Promise(() => {}); };
  const checking = sync.checkNow();
  await repairing;
  const deadline = [...timers.values()].find((timer) => timer.ms === CLOUD_SYNC_CHECK_TIMEOUT_MS);
  assert.ok(deadline, 'repairing an uncertain hold is covered by the check deadline');
  deadline.callback();
  await checking;
  assert.equal(sync.state.phase, 'failed');
  assert.equal(sync.state.code, 'hold-unconfirmed');
  assert.equal(sync.state.canOverride, true);
  sync.stop();
});

test('a stalled re-arm after an unverified release cannot hold the worker lock forever', { timeout: 1000 }, async () => {
  const env = fixture();
  let release;
  let entered;
  const waiting = new Promise((resolve) => { release = resolve; });
  const repairing = new Promise((resolve) => { entered = resolve; });
  const setGate = env.protocol.setSyncGate;
  let failedRelease = false;
  let delayedRepair = false;
  env.protocol.setSyncGate = async (next) => {
    if (failedRelease && next.held && !delayedRepair) {
      delayedRepair = true;
      entered();
      await waiting;
    }
    const result = await setGate(next);
    if (!next.held && !failedRelease) {
      failedRelease = true;
      next.onCommitted?.();
      throw Object.assign(new Error('The saved hold could not be checked.'), { code: 'storage' });
    }
    return result;
  };
  const timers = new Map();
  let next = 0;
  const { sync } = env.make({
    setTimer: (callback, ms) => { const id = ++next; timers.set(id, { callback, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  try {
    const starting = sync.start(context);
    await repairing;
    [...timers.values()].find((timer) => timer.ms === CLOUD_SYNC_CHECK_TIMEOUT_MS).callback();
    await starting;
    assert.equal(sync.state.phase, 'failed');
    let result;
    const retry = sync.overrideFailure().then((value) => { result = value; });
    for (let count = 0; count < 30 && !result; count += 1) {
      await new Promise((resolve) => { setImmediate(resolve); });
    }
    assert.equal(result?.ok, true, 'repair can retry after the first re-arm timed out');
    await retry;
    release();
    await new Promise((resolve) => { setImmediate(resolve); });
    assert.equal(env.data.gate.held, false, 'the expired re-arm cannot overwrite the later override');
  } finally {
    release();
    sync.stop();
  }
});

test('a late re-arm failure cannot mark a replacement session uncertain', { timeout: 1000 }, async () => {
  const env = fixture();
  let release;
  let entered;
  const waiting = new Promise((resolve) => { release = resolve; });
  const repairing = new Promise((resolve) => { entered = resolve; });
  const setGate = env.protocol.setSyncGate;
  let failedRelease = false;
  env.protocol.setSyncGate = async (next) => {
    if (failedRelease && next.held) {
      entered();
      await waiting;
    }
    const result = await setGate(next);
    if (!next.held) {
      failedRelease = true;
      next.onCommitted?.();
      throw Object.assign(new Error('The saved hold could not be checked.'), { code: 'storage' });
    }
    return result;
  };
  const { sync } = env.make();
  const starting = sync.start(context);
  await repairing;
  sync.stop();
  sync.active = true;
  sync.context = { connection: 'replacement', stream: '2'.repeat(32), consentId: '3'.repeat(32) };
  sync.epoch = '4'.repeat(32);
  release();
  await starting;
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.equal(sync.holdUnconfirmed, false, 'a stale repair cannot change the replacement context');
  assert.equal(sync.uncertainPending, null);
  sync.stop();
});

test('a save before a clear check commits leaves the durable hold in place', { timeout: 1000 }, async () => {
  const env = fixture();
  const { sync, calls } = env.make();
  let release;
  let prepared;
  const waiting = new Promise((resolve) => { release = resolve; });
  const gateReady = new Promise((resolve) => { prepared = resolve; });
  const setGate = env.protocol.setSyncGate;
  env.protocol.setSyncGate = async (next) => {
    if (!next.held) {
      assert.equal(next.authorize(), true);
      prepared();
      await waiting;
      if (next.signal?.aborted) throw Object.assign(new Error('The saved data changed.'), { code: 'raced' });
    }
    const result = await setGate(next);
    if (!next.held) next.onCommitted?.();
    return result;
  };
  const checking = sync.start(context);
  await gateReady;
  sync.savedChanged();
  release();
  await checking;

  assert.equal(env.data.gate.held, true);
  assert.equal(sync.state.phase, 'failed');
  assert.ok(!calls.some(([kind]) => kind === 'release'));
  sync.stop();
});

test('a change before an override commits keeps the durable hold', { timeout: 1000 }, async () => {
  const env = fixture();
  env.data.failure = 'unavailable';
  const { sync } = env.make();
  await sync.start(context);
  assert.equal(sync.state.phase, 'failed');
  let release;
  let prepared;
  const waiting = new Promise((resolve) => { release = resolve; });
  const gateReady = new Promise((resolve) => { prepared = resolve; });
  const setGate = env.protocol.setSyncGate;
  env.protocol.setSyncGate = async (next) => {
    if (!next.held) {
      assert.equal(next.authorize(), true);
      prepared();
      await waiting;
      if (next.signal?.aborted) throw Object.assign(new Error('The cloud choice changed.'), { code: 'raced' });
    }
    const result = await setGate(next);
    if (!next.held) next.onCommitted?.();
    return result;
  };
  const overriding = sync.overrideFailure();
  await gateReady;
  sync.savedChanged();
  release();
  const result = await overriding;

  assert.equal(result.ok, false);
  assert.equal(env.data.gate.held, true);
  assert.notEqual(sync.state.phase, 'clear');
  sync.stop();
});

test('a new check before Keep commits invalidates the in-flight release', { timeout: 1000 }, async () => {
  const env = fixture();
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  const { sync, calls } = env.make();
  await sync.start(context);
  let release;
  let prepared;
  const waiting = new Promise((resolve) => { release = resolve; });
  const gateReady = new Promise((resolve) => { prepared = resolve; });
  const setGate = env.protocol.setSyncGate;
  env.protocol.setSyncGate = async (next) => {
    if (!next.held) {
      assert.equal(next.authorize(), true);
      prepared();
      await waiting;
      if (next.signal?.aborted) throw Object.assign(new Error('The cloud check changed.'), { code: 'raced' });
    }
    const result = await setGate(next);
    if (!next.held) next.onCommitted?.();
    return result;
  };
  const keeping = sync.keepOffer();
  await gateReady;
  const checking = sync.requestCheck();
  release();
  const result = await keeping;
  await checking;

  assert.equal(result.ok, false);
  assert.equal(env.data.gate.held, true);
  assert.ok(!calls.some(([kind]) => kind === 'release'));
  sync.stop();
});

test('a new check after Keep commits waits for the choice and checks again', { timeout: 1000 }, async () => {
  const env = fixture();
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  const { sync } = env.make();
  await sync.start(context);
  let release;
  let committed;
  const waiting = new Promise((resolve) => { release = resolve; });
  const gateCleared = new Promise((resolve) => { committed = resolve; });
  const setGate = env.protocol.setSyncGate;
  let delayed = false;
  env.protocol.setSyncGate = async (next) => {
    const result = await setGate(next);
    if (!next.held) {
      next.onCommitted?.();
      if (!delayed) {
        delayed = true;
        committed();
        await waiting;
      }
    }
    return result;
  };
  const keeping = sync.keepOffer();
  await gateCleared;
  const before = env.data.seen.length;
  const checking = sync.requestCheck();
  release();
  assert.equal((await keeping).ok, true);
  await checking;
  for (let count = 0; count < 30 && env.data.seen.length === before; count += 1) {
    await new Promise((resolve) => { setImmediate(resolve); });
  }
  assert.equal(env.data.seen.length, before + 1, 'the return check discovers again after the committed choice');
  sync.stop();
});

test('a timed-out check stays paused and its late answer cannot release the hold', async () => {
  const env = fixture();
  let release;
  env.data.wait = new Promise((resolve) => { release = resolve; });
  const timers = new Map();
  let next = 0;
  const { sync } = env.make({
    setTimer: (callback, ms) => { const id = ++next; timers.set(id, { callback, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  const starting = sync.start(context);
  while (env.data.seen.length === 0) await new Promise((resolve) => { setImmediate(resolve); });
  const deadline = [...timers.values()].find((timer) => timer.ms === CLOUD_SYNC_CHECK_TIMEOUT_MS);
  assert.ok(deadline, 'the check has an overall deadline');
  deadline.callback();
  await starting;
  assert.equal(sync.state.phase, 'failed');
  assert.equal(env.data.gate.held, true);
  release();
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.equal(sync.state.phase, 'failed', 'a late answer is not treated as a successful check');
  assert.equal(env.data.gate.held, true);
  sync.stop();
});

test('a stalled pending-choice record still reaches the failed-check controls', { timeout: 1000 }, async () => {
  const env = fixture();
  let entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  env.protocol.record = async () => { entered(); return new Promise(() => {}); };
  const timers = new Map();
  let next = 0;
  const { sync } = env.make({
    setTimer: (callback, ms) => { const id = ++next; timers.set(id, { callback, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  const starting = sync.start(context);
  await waiting;
  const deadline = [...timers.values()].find((timer) => timer.ms === CLOUD_SYNC_CHECK_TIMEOUT_MS);
  assert.ok(deadline, 'pending-choice recovery is covered by the check deadline');
  deadline.callback();
  await starting;
  assert.equal(sync.state.phase, 'failed');
  assert.equal(sync.state.canOverride, true);
  assert.equal(env.data.gate.held, true);
  sync.stop();
});

test('a late interrupted-choice recovery cannot overwrite a subsequent Keep', { timeout: 1000 }, async () => {
  const env = fixture();
  const digest = 'e'.repeat(64);
  env.data.gate = {
    version: 1, ...context, epoch: '9'.repeat(32), held: true, pending: { previous: null, intended: digest },
  };
  env.data.declinedDigest = digest;
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest, contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  let release;
  let entered;
  const waiting = new Promise((resolve) => { release = resolve; });
  const reading = new Promise((resolve) => { entered = resolve; });
  const readSync = env.protocol.syncState;
  let first = true;
  env.protocol.syncState = async (...args) => {
    const result = await readSync(...args);
    if (first) {
      first = false;
      entered();
      await waiting;
    }
    return result;
  };
  const timers = new Map();
  let next = 0;
  const { sync } = env.make({
    setTimer: (callback, ms) => { const id = ++next; timers.set(id, { callback, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  try {
    const starting = sync.start(context);
    await reading;
    [...timers.values()].find((timer) => timer.ms === CLOUD_SYNC_CHECK_TIMEOUT_MS).callback();
    await starting;
    assert.equal(sync.state.phase, 'failed');
    await sync.checkNow();
    assert.equal(sync.state.phase, 'offer');
    assert.equal((await sync.keepOffer()).ok, true);
    assert.deepEqual(env.data.declinedByStream, [{ stream: 'd'.repeat(32), digest }]);
    release();
    await new Promise((resolve) => { setImmediate(resolve); });
    assert.deepEqual(env.data.declinedByStream, [{ stream: 'd'.repeat(32), digest }],
      'the obsolete rollback cannot erase the newer choice');
    assert.equal(env.data.gate.held, false, 'the obsolete rollback cannot re-arm or clear a newer gate');
  } finally {
    release();
    sync.stop();
  }
});

test('a stalled matched-state write still reaches the failed-check controls', { timeout: 1000 }, async () => {
  const env = fixture();
  const digest = await personalDigest(env.data.snapshot.backup, webcrypto);
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest, contentDigest: 'c'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 1, lastReadAt: 100,
  }];
  let entered;
  const writing = new Promise((resolve) => { entered = resolve; });
  env.protocol.rememberSync = async () => { entered(); return new Promise(() => {}); };
  const timers = new Map();
  let next = 0;
  const { sync } = env.make({
    setTimer: (callback, ms) => { const id = ++next; timers.set(id, { callback, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  const starting = sync.start(context);
  await writing;
  const deadline = [...timers.values()].find((timer) => timer.ms === CLOUD_SYNC_CHECK_TIMEOUT_MS);
  assert.ok(deadline, 'remembering a match is covered by the check deadline');
  deadline.callback();
  await starting;
  assert.equal(sync.state.phase, 'failed');
  assert.equal(sync.state.canOverride, true);
  assert.equal(env.data.gate.held, true);
  sync.stop();
});

test('a stalled check release still reaches the failed-check controls', { timeout: 1000 }, async () => {
  const env = fixture();
  let entered;
  const releasing = new Promise((resolve) => { entered = resolve; });
  const setGate = env.protocol.setSyncGate;
  env.protocol.setSyncGate = async (next) => {
    if (!next.held) { entered(); return new Promise(() => {}); }
    return setGate(next);
  };
  const timers = new Map();
  let next = 0;
  const { sync } = env.make({
    setTimer: (callback, ms) => { const id = ++next; timers.set(id, { callback, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  const starting = sync.start(context);
  await releasing;
  const deadline = [...timers.values()].find((timer) => timer.ms === CLOUD_SYNC_CHECK_TIMEOUT_MS);
  assert.ok(deadline, 'releasing a checked hold is covered by the check deadline');
  deadline.callback();
  await starting;
  assert.equal(sync.state.phase, 'failed');
  assert.equal(sync.state.canOverride, true);
  assert.equal(env.data.gate.held, true);
  sync.stop();
});

test('a stalled initial hold still reaches the failed-check controls', { timeout: 1000 }, async () => {
  const env = fixture();
  let entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  env.protocol.setSyncGate = async () => { entered(); return new Promise(() => {}); };
  const timers = new Map();
  let next = 0;
  const { sync, calls } = env.make({
    setTimer: (callback, ms) => { const id = ++next; timers.set(id, { callback, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  const starting = sync.start(context);
  await waiting;
  const deadline = [...timers.values()].find((timer) => timer.ms === CLOUD_SYNC_CHECK_TIMEOUT_MS);
  assert.ok(deadline, 'arming the hold is covered by the check deadline');
  deadline.callback();
  await starting;
  assert.equal(sync.state.phase, 'failed');
  assert.equal(sync.state.canOverride, true);
  assert.ok(!calls.some(([kind]) => kind === 'release'));
  sync.stop();
});

test('retrying a stalled initial hold releases the worker lock before an explicit override', { timeout: 1000 }, async () => {
  const env = fixture();
  env.data.failure = 'unavailable';
  let release;
  let entered;
  const waiting = new Promise((resolve) => { release = resolve; });
  const reading = new Promise((resolve) => { entered = resolve; });
  const setGate = env.protocol.setSyncGate;
  let first = true;
  env.protocol.setSyncGate = async (value) => {
    if (first && value.held) {
      first = false;
      entered();
      await waiting;
    }
    return setGate(value);
  };
  const timers = new Map();
  let next = 0;
  const { sync } = env.make({
    setTimer: (callback, ms) => { const id = ++next; timers.set(id, { callback, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  try {
    const starting = sync.start(context);
    await reading;
    [...timers.values()].find((timer) => timer.ms === CLOUD_SYNC_CHECK_TIMEOUT_MS).callback();
    await starting;
    assert.equal(sync.state.phase, 'failed');
    let result;
    const overriding = sync.overrideFailure().then((value) => { result = value; });
    assert.equal(sync.state.phase, 'working', 'the failed controls are withdrawn while the hold is repaired');
    const duplicate = sync.overrideFailure();
    for (let count = 0; count < 30 && !result; count += 1) {
      await new Promise((resolve) => { setImmediate(resolve); });
    }
    assert.equal(result?.ok, true, 'the reader can retry and explicitly back up without waiting for the old read');
    await overriding;
    assert.equal((await duplicate).ok, false, 'a repeated click cannot start a second override');
    assert.equal(env.data.gate.held, false);
    release();
    await new Promise((resolve) => { setImmediate(resolve); });
    assert.equal(env.data.gate.held, false, 'the old hold cannot be written after the newer override');
  } finally {
    release();
    sync.stop();
  }
});

test('a stalled follower gate read reaches the failed-check controls without bypassing the leader', { timeout: 1000 }, async () => {
  const env = fixture();
  env.data.remotes = [{
    id: 'phone', stream: 'd'.repeat(32), generation: 1, digest: 'e'.repeat(64), contentDigest: 'f'.repeat(64),
    byteDigest: '1'.repeat(64), createdAt: 123, device: 'Phone', readCount: 2, lastReadAt: 122,
  }];
  const timers = new Map();
  let next = 0;
  const leader = env.make();
  const follower = env.make({
    setTimer: (callback, ms) => { const id = ++next; timers.set(id, { callback, ms }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  await leader.sync.start(context);
  await follower.sync.start(context);
  assert.equal(follower.sync.state.phase, 'following');
  let entered;
  const reading = new Promise((resolve) => { entered = resolve; });
  const readGate = env.protocol.syncGate;
  env.protocol.syncGate = async () => { entered(); return new Promise(() => {}); };
  const checking = follower.sync.checkNow();
  await reading;
  const deadline = [...timers.values()].find((timer) => timer.ms === CLOUD_SYNC_CHECK_TIMEOUT_MS);
  assert.ok(deadline, 'following the leader is covered by the check deadline');
  deadline.callback();
  await checking;
  assert.equal(follower.sync.state.phase, 'failed');
  assert.equal(follower.sync.state.canOverride, true);
  assert.equal(env.data.gate.held, true);
  assert.ok(!follower.calls.some(([kind]) => kind === 'release'));
  env.protocol.syncGate = readGate;
  assert.equal((await follower.sync.overrideFailure()).ok, false);
  assert.equal(follower.sync.state.phase, 'following');
  assert.equal(env.data.gate.held, true, 'an override cannot bypass the other tab offer');
  assert.ok(!follower.calls.some(([kind]) => kind === 'release'));
  follower.sync.stop();
  leader.sync.stop();
});

test('stopping an unanswered check releases the election so a restarted check can proceed', { timeout: 1000 }, async () => {
  const env = fixture();
  let release;
  env.data.wait = new Promise((resolve) => { release = resolve; });
  const { sync } = env.make();
  const first = sync.start(context);
  while (env.data.seen.length === 0) await new Promise((resolve) => { setImmediate(resolve); });
  sync.stop();
  env.data.wait = null;
  await sync.start(context);
  await first;
  if (sync.state.phase === 'following') await sync.checkNow();
  assert.equal(sync.state.phase, 'clear');
  assert.equal(env.data.gate.held, false);
  release();
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.equal(sync.state.phase, 'clear', 'the old check cannot overwrite the restarted result');
  sync.stop();
});
