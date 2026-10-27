import { KEY, IMPORT_DRAFT_KEY, personalRevisionOf } from '../storage.js';
import { LIST_HISTORY_KEY } from './listHistory.js';
import { captureCloudContent, CLOUD_SETTINGS_KEYS, MAX_CLOUD_SNAPSHOT_BYTES } from './cloudSnapshot.js';
import { CloudBackupCoordinator, CloudBackupError } from './cloudBackup.js';

export const CLOUD_COMMIT_KEY = 'mrt.cloud.commits.v1';
const HEX = /^[a-f0-9]{64}$/;
const KEYS = [KEY, LIST_HISTORY_KEY, IMPORT_DRAFT_KEY, ...Object.values(CLOUD_SETTINGS_KEYS)];

async function witnessOf(held, cryptoProvider) {
  const values = [personalRevisionOf(held.witness[KEY]),
    ...KEYS.slice(1).map((key) => held.witness[key])];
  const bytes = await cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(values)));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('');
}

function checkpoint(value) {
  return value === null || (value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === 'contentDigest,provenance'
    && [value.contentDigest, value.provenance].every((item) => typeof item === 'string' && HEX.test(item)));
}

// Intent precedes network dispatch. Reconciliation can recover an ACK lost before local checkpointing.
export function createCloudCommitTracker({ storage, provider, epoch, accountId, cryptoProvider = globalThis.crypto }) {
  const account = cryptoProvider.subtle.digest('SHA-256', new TextEncoder().encode(accountId))
    .then((bytes) => [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join(''));
  function read() {
    const raw = storage.getItem(CLOUD_COMMIT_KEY);
    if (raw === null) return null;
    if (raw.length > 2048) throw new CloudBackupError('commit-checkpoint');
    const value = JSON.parse(raw);
    if (!value || value.version !== 1 || !['google', 'microsoft'].includes(value.provider)
      || !(value.streamId === null || typeof value.streamId === 'string' && HEX.test(value.streamId))
      || !Number.isSafeInteger(value.epoch) || value.epoch < 1 || !HEX.test(value.account)
      || !checkpoint(value.saved) || !checkpoint(value.pending)
      || Object.keys(value).sort().join(',') !== 'account,epoch,pending,provider,saved,streamId,version') {
      throw new CloudBackupError('commit-checkpoint');
    }
    return value;
  }
  function write(value) {
    const raw = JSON.stringify(value);
    storage.setItem(CLOUD_COMMIT_KEY, raw);
    if (storage.getItem(CLOUD_COMMIT_KEY) !== raw) throw new CloudBackupError('commit-checkpoint');
  }
  async function bound(value, ack) {
    return !!ack && value?.provider === provider && value.account === await account
      && (value.streamId === ack.streamId || value.streamId === null
        && value.epoch === ack.attemptEpoch && value.pending?.contentDigest === ack.contentDigest);
  }
  return {
    async prepare(held, prior) {
      const provenance = await witnessOf(held, cryptoProvider);
      const value = read();
      const matches = await bound(value, prior);
      const saved = matches
        ? [value.saved, value.pending].find((item) => item?.contentDigest === prior.contentDigest) : null;
      // Earlier checkpoints could discard the ACK witness while retaining the next personal intent.
      const pendingIntent = matches && value.pending?.provenance === provenance;
      if (prior && !saved && !pendingIntent) throw new CloudBackupError('commit-provenance');
      if (matches) {
        if (saved?.provenance === provenance) return false;
      }
      write({
        version: 1, provider, epoch, account: await account, streamId: prior?.streamId ?? null,
        saved: saved ?? null,
        pending: { contentDigest: held.contentDigest, provenance },
      });
      return true;
    },
    async acknowledged(held, ack) {
      if (ack.contentDigest !== held.contentDigest) throw new CloudBackupError('commit-checkpoint');
      write({
        version: 1, provider, epoch, account: await account, streamId: ack.streamId,
        saved: { contentDigest: held.contentDigest, provenance: await witnessOf(held, cryptoProvider) },
        pending: null,
      });
    },
  };
}

export function savePersonalValue(storage, key, value, onCommit = () => {}) {
  if (!Object.values(CLOUD_SETTINGS_KEYS).includes(key) || typeof value !== 'string') {
    throw new TypeError('Only saved preferences use this persistence owner.');
  }
  try {
    const before = storage.getItem(key);
    if (before === value) return true;
    storage.setItem(key, value);
    if (storage.getItem(key) !== value) return false;
    try { onCommit({ component: 'settings', before, after: value }); }
    catch { /* Backup observation cannot turn a saved preference into a failed save. */ }
    return true;
  } catch { return false; }
}

function requireDependencies({ qualification, consent, interlocks }) {
  if (qualification !== true || consent !== true
    || ['isReady', 'isBlocked', 'subscribe', 'beforeErase'].some((key) => typeof interlocks?.[key] !== 'function')
    || interlocks.isReady() !== true) {
    throw new CloudBackupError('integration-required');
  }
}

export async function createCloudBackupSession({
  transport, provider, epoch, streamId, storage, owners, label, qualification, consent, interlocks,
  events = globalThis, documentRef = globalThis.document, cryptoProvider = globalThis.crypto, ...scheduler
}) {
  requireDependencies({ qualification, consent, interlocks });
  if (!['google', 'microsoft'].includes(provider) || !Number.isSafeInteger(epoch) || epoch < 1
    || !storage || !owners?.reader || !owners?.history || !owners?.draft) throw new CloudBackupError('integration-required');
  const isBlocked = () => interlocks.isReady() !== true || interlocks.isBlocked() !== false
    || owners.reader.blocked || owners.history.blocked || !owners.history.known
    || owners.history.busy || owners.draft.blocked || owners.draft.uncertain
    || owners.draft.recovery.length > 0 || owners.draft.draft?.pending != null;
  if (isBlocked()) throw new CloudBackupError('paused');
  const status = await transport.status();
  requireDependencies({ qualification, consent, interlocks });
  if (isBlocked() || status.provider !== provider || status.state !== 'connected' || status.phase !== 'active'
    || status.epoch !== epoch || typeof status.account?.id !== 'string' || !status.account.id
    || typeof status.account.label !== 'string' || !status.account.label) throw new CloudBackupError('connection');
  const tracker = createCloudCommitTracker({ storage, provider, epoch, accountId: status.account.id, cryptoProvider });
  const coordinator = new CloudBackupCoordinator({
    ...scheduler, transport, label, isBlocked, prepare: tracker.prepare, acknowledged: tracker.acknowledged,
    capture: () => captureCloudContent({ storage, isBlocked, cryptoProvider }),
  });
  let closed = false;
  function resume() { if (!closed) coordinator.resume(); }
  function storageChanged(event) {
    if (event.storageArea && event.storageArea !== (storage.source ?? storage)) return;
    if (event.key === null) { stop(); return; }
    if (KEYS.includes(event.key)) resume();
  }
  function visible() { if (documentRef?.visibilityState !== 'hidden') resume(); }
  function pagehide() { coordinator.stop(); }
  function pageshow() {
    if (!closed) coordinator.start({ provider, epoch, ...(streamId ? { streamId } : {}) });
  }
  const listeners = [
    [events, 'storage', storageChanged], [events, 'online', resume], [events, 'pageshow', pageshow],
    [events, 'pagehide', pagehide], [documentRef, 'visibilitychange', visible],
  ];
  let unsubscribe = () => {};
  function stop() {
    closed = true;
    coordinator.stop();
    if (typeof unsubscribe === 'function') unsubscribe();
    for (const [target, name, listener] of listeners) target?.removeEventListener?.(name, listener);
  }
  try {
    unsubscribe = interlocks.subscribe(resume);
    if (typeof unsubscribe !== 'function') throw new CloudBackupError('integration-required');
    for (const [target, name, listener] of listeners) target?.addEventListener?.(name, listener);
    if (isBlocked()) throw new CloudBackupError('paused');
    coordinator.start({ provider, epoch, ...(streamId ? { streamId } : {}) });
  } catch (error) { stop(); throw error; }
  return {
    coordinator, stop, resume,
    committed() { if (!closed) coordinator.committed(); },
    async beforeErase() {
      stop();
      if (await interlocks.beforeErase() !== true) throw new CloudBackupError('erase-interlock');
      await transport.disconnect();
      const status = await transport.status();
      if (status.state !== 'disconnected') throw new CloudBackupError('erase-interlock');
    },
  };
}

export function createWindowsCloudClient({ fetchImpl = globalThis.fetch, origin = globalThis.location?.origin } = {}) {
  if (origin !== 'http://127.0.0.1:8787' || typeof fetchImpl !== 'function') throw new CloudBackupError('unsupported');
  let capability = null;
  let opening = null;
  let profileId = null;
  const sessionRefusal = Symbol('native-control-session-refusal');
  async function request(operation, body = '{}', csrf = null) {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => controller.abort(), operation === 'discover' ? 300000 : 120000);
    try {
      const response = await fetchImpl(`${origin}/api/cloud/${operation}`, {
        method: 'POST', mode: 'same-origin', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
        headers: { 'content-type': 'application/json', ...(csrf ? { 'x-recap-csrf': csrf } : {}) },
        body, signal: controller.signal,
      });
      const reader = response.body?.getReader();
      if (!reader) throw new CloudBackupError('control');
      let length = 0;
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let text = '';
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          length += part.value.byteLength;
          if (length > MAX_CLOUD_SNAPSHOT_BYTES) throw new CloudBackupError('control');
          text += decoder.decode(part.value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); }
      const value = JSON.parse(text);
      if (!response.ok) {
        const error = new CloudBackupError('control');
        if (response.status === 403 && value.code === 'session-required'
          && typeof value.error === 'string' && Object.keys(value).sort().join(',') === 'code,error') {
          error[sessionRefusal] = true;
        }
        if (['unknown', 'not-sent', 'read-only'].includes(value.outcome)) error.outcome = value.outcome;
        if (Number.isInteger(value.providerStatus) && value.providerStatus >= 100 && value.providerStatus <= 599) error.providerStatus = value.providerStatus;
        if (Number.isSafeInteger(value.retryAfterMs) && value.retryAfterMs >= 0) error.retryAfterMs = value.retryAfterMs;
        // HTTP 503 here is a control refusal, not evidence of a provider outage.
        throw error;
      }
      return value;
    } catch (error) {
      if (error instanceof CloudBackupError) throw error;
      throw Object.assign(new Error('Native cloud response was not confirmed.'), { outcome: 'unknown' });
    } finally { globalThis.clearTimeout(timer); }
  }
  async function session() {
    if (capability) return;
    if (!opening) opening = request('session').then((value) => {
      if (!value || !['csrf', 'profileId'].every((key) => typeof value[key] === 'string' && HEX.test(value[key]))) {
        throw new CloudBackupError('control');
      }
      if (profileId !== null && value.profileId !== profileId) throw new CloudBackupError('connection');
      profileId = value.profileId;
      capability = value.csrf;
    }).finally(() => { opening = null; });
    await opening;
  }
  return {
    forProvider(provider) {
      if (!['google', 'microsoft'].includes(provider)) throw new CloudBackupError('unsupported');
      const call = async (operation, input) => {
        let body;
        try { body = JSON.stringify({ ...input, provider }); }
        catch { throw new CloudBackupError('capture'); }
        if (new TextEncoder().encode(body).length > MAX_CLOUD_SNAPSHOT_BYTES) throw new CloudBackupError('capture');
        await session();
        const sentCapability = capability;
        try { return await request(operation, body, sentCapability); }
        catch (error) {
          if (!error?.[sessionRefusal]) throw error;
          // Only this native predispatch refusal proves the original operation did not run.
          if (capability === sentCapability) capability = null;
          await session();
          return request(operation, body, capability);
        }
      };
      return {
        status: () => call('status'), connect: () => call('connect'), disconnect: () => call('disconnect'),
        discover: () => call('discover'), chooseSeparate: (value) => call('choose', value),
        readSnapshot: (value) => call('read', value), writeSnapshot: (value) => call('write', value),
        reconcile: () => call('reconcile'), maintain: () => call('maintain'),
      };
    },
  };
}
