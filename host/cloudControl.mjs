import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { setTimeout, clearTimeout } from 'node:timers';
import { TextDecoder } from 'node:util';
import { parseCloudSnapshot } from '../src/js/lib/cloudSnapshot.js';
import { copyCloudFailureMetadata } from './cloudFailure.mjs';

const PREFIX = '/api/cloud';
const ORIGIN = 'http://127.0.0.1:8787';
const COOKIE = 'recap_cloud_profile';
const LIFETIME = 10 * 60 * 1000;
const LIMIT = 4096;
const SNAPSHOT_LIMIT = 32 * 1024 * 1024;
const HEX = /^[a-f0-9]{64}$/;
const OPERATIONS = ['session', 'status', 'connect', 'disconnect', 'discover', 'choose', 'read', 'write', 'reconcile', 'maintain'];
const HEADERS = Object.freeze({
  'content-type': 'application/json; charset=utf-8',
  'cache-control': 'no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
  'x-frame-options': 'DENY',
});

function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

function reply(res, status, value, headers = {}) {
  res.writeHead(status, { ...HEADERS, ...(status >= 400 ? { connection: 'close' } : {}), ...headers });
  res.end(JSON.stringify(value));
}

async function readBody(req, limit) {
  const chunks = [];
  let length = 0;
  const timer = setTimeout(() => req.destroy(), 5000);
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      length += chunk.length;
      if (length > limit) {
        req.resume();
        return { error: 413 };
      }
      chunks.push(chunk);
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value)
      ? { value } : { error: 400 };
  } catch {
    return { error: 400 };
  } finally {
    clearTimeout(timer);
  }
}

function publicStatus(status, provider) {
  if (!status || status.provider !== provider) throw new Error('Invalid native status');
  let account = null;
  if (status.account !== null) {
    const { id, label } = status.account || {};
    if (typeof id !== 'string' || !id || id.length > 8192
      || typeof label !== 'string' || !label || label.length > 8192) {
      throw new Error('Invalid native account');
    }
    account = { id, label };
  }
  const state = status.state;
  if (!['connected', 'disconnected', 'reconnect-required', 'pending-choice'].includes(state)) {
    throw new Error('Invalid native connection state');
  }
  const result = { provider, state, account };
  if (status.epoch !== undefined) {
    if (!Number.isSafeInteger(status.epoch) || status.epoch < 0
      || !['disconnected', 'connecting', 'discovering', 'awaiting-choice', 'allocating', 'active', 'disconnecting'].includes(status.phase)) {
      throw new Error('Invalid native connection');
    }
    result.epoch = status.epoch;
    result.phase = status.phase;
    result.acknowledgement = status.acknowledgement === null || status.acknowledgement === undefined
      ? null : acknowledgement(status.acknowledgement, status.epoch);
  }
  return result;
}

function acknowledgement(value, epoch) {
  if (!value || !['attemptId', 'byteDigest', 'contentDigest', 'streamId'].every((key) => typeof value[key] === 'string' && HEX.test(value[key]))
    || !Number.isSafeInteger(value.generation) || value.generation < 1
    || !Number.isSafeInteger(value.epoch) || value.epoch < 1 || (epoch !== undefined && value.epoch !== epoch)
    || !Number.isSafeInteger(value.attemptEpoch) || value.attemptEpoch < 1) throw new Error('Invalid native acknowledgement');
  return { epoch: value.epoch, attemptEpoch: value.attemptEpoch, streamId: value.streamId, attemptId: value.attemptId,
    generation: value.generation, contentDigest: value.contentDigest, byteDigest: value.byteDigest };
}

function selection(value) {
  if (!value || typeof value.id !== 'string' || !/^[A-Za-z0-9!_.:-]{1,256}$/.test(value.id)
    || typeof value.name !== 'string' || !/^recap-backup-[a-f0-9]{64}-[01]\.json$/.test(value.name)
    || !Number.isSafeInteger(value.size) || value.size < 1 || value.size > SNAPSHOT_LIMIT
    || !['digest', 'attemptId'].every((key) => typeof value[key] === 'string' && HEX.test(value[key]))
    || !Number.isSafeInteger(value.generation) || value.generation < 1) throw new Error('Invalid native selection');
  return { id: value.id, name: value.name, size: value.size, digest: value.digest,
    attemptId: value.attemptId, generation: value.generation };
}

function discovery(value, provider) {
  if (!value || value.provider !== provider || !['active', 'awaiting-choice'].includes(value.state)
    || !Number.isSafeInteger(value.epoch) || value.epoch < 1 || !Array.isArray(value.streams)
    || value.streams.length > 128 || !Array.isArray(value.rejected) || value.rejected.length > 128
    || (value.state === 'awaiting-choice' && (typeof value.discoveryId !== 'string' || !HEX.test(value.discoveryId)))) {
    throw new Error('Invalid native discovery');
  }
  function summary(value) {
    const result = selection(value);
    if (!['captureId', 'contentDigest'].every((key) => typeof value[key] === 'string' && HEX.test(value[key]))
      || typeof value.label !== 'string' || !value.label || value.label.length > 200
      || value.version !== 1 || typeof value.capturedAt !== 'string' || value.capturedAt.length > 64
      || (value.modifiedAt !== null && (typeof value.modifiedAt !== 'string' || value.modifiedAt.length > 64))) {
      throw new Error('Invalid native summary');
    }
    return { ...result, captureId: value.captureId, contentDigest: value.contentDigest, label: value.label,
      version: value.version, capturedAt: value.capturedAt, modifiedAt: value.modifiedAt };
  }
  return { provider, state: value.state, epoch: value.epoch,
    ...(value.state === 'awaiting-choice' ? { discoveryId: value.discoveryId } : {}),
    streams: value.streams.map((stream) => {
      if (typeof stream?.streamId !== 'string' || !HEX.test(stream.streamId)) throw new Error('Invalid native stream');
      return { streamId: stream.streamId, current: summary(stream.current), previous: stream.previous === null ? null : summary(stream.previous) };
    }),
    rejected: value.rejected.map((file) => {
      if (typeof file?.id !== 'string' || !/^[A-Za-z0-9!_.:-]{1,256}$/.test(file.id)
        || !['invalid-snapshot', 'ambiguous-stream'].includes(file.reason)) throw new Error('Invalid native rejection');
      return { id: file.id, reason: file.reason };
    }) };
}

function inputFields(operation, value) {
  const fields = Object.keys(value).sort().join(',');
  if (operation === 'session') return fields === '';
  if (!['microsoft', 'google'].includes(value.provider)) return false;
  if (operation === 'choose') return fields === 'discoveryId,epoch,provider'
    && Number.isSafeInteger(value.epoch) && value.epoch >= 1 && typeof value.discoveryId === 'string' && HEX.test(value.discoveryId);
  if (operation === 'write') return fields === 'components,epoch,label,provider'
    && Number.isSafeInteger(value.epoch) && value.epoch >= 1
    && typeof value.label === 'string' && value.label.trim().length > 0 && value.label.length <= 200
    && value.components && typeof value.components === 'object' && !Array.isArray(value.components)
    && Object.keys(value.components).sort().join(',') === 'draft,history,reader,settings';
  if (operation === 'read') {
    if (fields !== 'provider,selection,streamId' || typeof value.streamId !== 'string' || !HEX.test(value.streamId)) return false;
    try {
      selection(value.selection);
      return Object.keys(value.selection).every((key) => ['id', 'name', 'size', 'digest', 'generation', 'attemptId',
        'captureId', 'contentDigest', 'label', 'version', 'capturedAt', 'modifiedAt'].includes(key));
    } catch { return false; }
  }
  return fields === 'provider';
}

export function createCloudControlHandler({ signingKey, loadSigningKey, adapterForProfile, now = Date.now } = {}) {
  if (signingKey !== undefined && (!Buffer.isBuffer(signingKey) || signingKey.length !== 32)) {
    throw new TypeError('Cloud profile signing requires a protected 32-byte host key.');
  }
  if (loadSigningKey !== undefined && (typeof loadSigningKey !== 'function' || signingKey !== undefined)) {
    throw new TypeError('Cloud profile signing requires one native key authority.');
  }
  if (adapterForProfile !== undefined && (typeof adapterForProfile !== 'function' || (!signingKey && !loadSigningKey))) {
    throw new TypeError('Cloud adapters require signed host profiles.');
  }
  let key = signingKey ? Buffer.from(signingKey) : null;
  let keyInitialization = null;
  async function initializeKey() {
    if (key) return;
    if (!keyInitialization) {
      keyInitialization = Promise.resolve().then(loadSigningKey).then((value) => {
        if (!Buffer.isBuffer(value) || value.length !== 32) throw new TypeError('Invalid protected cloud host key.');
        key = Buffer.from(value);
      });
    }
    await keyInitialization;
  }
  const sessions = new Map();
  function sign(value) {
    return createHmac('sha256', key).update(value).digest('hex');
  }
  function profile(req) {
    const cookies = (req.headers.cookie || '').split(';').map((part) => part.trim())
      .filter((part) => part.startsWith(`${COOKIE}=`));
    if (!cookies.length) return null;
    if (cookies.length !== 1) return false;
    const value = cookies[0].slice(COOKIE.length + 1);
    if (!/^[a-f0-9]{64}\.[a-f0-9]{64}$/.test(value)) return false;
    const [id, signature] = value.split('.');
    return { id, signature };
  }
  return {
    handles: (req) => req.url === PREFIX || req.url?.startsWith(`${PREFIX}/`),
    async handle(req, res) {
      if (req.headers.host !== '127.0.0.1:8787' || req.headers.origin !== ORIGIN
        || (req.headers['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
        return reply(res, 403, { error: 'Cloud requests require the exact app origin.' });
      }
      if (req.method !== 'POST') {
        return reply(res, 405, { error: 'Cloud controls require POST.' }, { allow: 'POST' });
      }
      const operation = req.url.slice(PREFIX.length + 1);
      if (!OPERATIONS.includes(operation)) {
        return reply(res, 404, { error: 'Unknown cloud operation.' });
      }
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(req.headers['content-type'] || '')) {
        return reply(res, 415, { error: 'Cloud controls require UTF-8 JSON.' });
      }
      const limit = operation === 'write' ? SNAPSHOT_LIMIT : LIMIT;
      if (req.headers['content-encoding'] || Number(req.headers['content-length']) > limit) {
        return reply(res, 413, { error: 'Cloud request exceeds the supported input limits.' });
      }
      const input = await readBody(req, limit);
      if (input.error) return reply(res, input.error, { error: 'Invalid or oversized cloud request.' });
      const provider = input.value.provider;
      if (!inputFields(operation, input.value)) {
        return reply(res, 400, { error: 'Unsupported cloud request fields.' });
      }
      if ((!key && !loadSigningKey) || !adapterForProfile) {
        return reply(res, 503, { error: 'Native cloud support is not configured. Local reading remains available.' });
      }
      const supplied = profile(req);
      if (supplied === false) return reply(res, 403, { error: 'Invalid cloud profile cookie.' });
      try {
        await initializeKey();
      } catch {
        return reply(res, 503, {
          error: 'Native cloud protection is unavailable. Local reading remains available. Preserve existing native files and check the host configuration.',
        });
      }
      let id = null;
      if (supplied) {
        if (!equal(supplied.signature, sign(supplied.id))) return reply(res, 403, { error: 'Invalid cloud profile cookie.' });
        id = supplied.id;
      }
      if (operation === 'session') {
        for (const [existing, session] of sessions) {
          if (session.expires <= now()) sessions.delete(existing);
        }
        if (!id) id = randomBytes(32).toString('hex');
        if (!sessions.has(id) && sessions.size >= 256) {
          return reply(res, 503, { error: 'Cloud session limit reached. Retry after sessions expire.' });
        }
        let session = sessions.get(id);
        if (!session) {
          session = { csrf: randomBytes(32).toString('hex'), expires: now() + LIFETIME };
          sessions.set(id, session);
        }
        return reply(res, 200, { csrf: session.csrf, profileId: createHash('sha256').update(id).digest('hex') }, {
          'set-cookie': `${COOKIE}=${id}.${sign(id)}; Path=${PREFIX}; HttpOnly; SameSite=Strict; Max-Age=31536000`,
        });
      }
      const session = sessions.get(id);
      if (!session || session.expires <= now() || !equal(session.csrf, req.headers['x-recap-csrf'])) {
        return reply(res, 403, { code: 'session-required',
          error: 'Cloud session expired or request capability is invalid. Reopen cloud controls.' });
      }
      try {
        const profileId = createHash('sha256').update(id).digest('hex');
        const adapter = await adapterForProfile({ profileId, provider });
        if (operation === 'disconnect') {
          await adapter.disconnect();
          return reply(res, 200, { provider, state: 'disconnected', account: null });
        }
        if (operation === 'connect') await adapter.connect();
        if (operation === 'discover') return reply(res, 200, discovery(await adapter.discover(), provider));
        if (operation === 'choose') {
          const result = await adapter.chooseSeparate({ epoch: input.value.epoch, discoveryId: input.value.discoveryId });
          if (result?.provider !== provider || result.state !== 'active' || result.epoch !== input.value.epoch
            || typeof result.streamId !== 'string' || !HEX.test(result.streamId)) throw new Error('Invalid native choice');
          return reply(res, 200, { provider, state: result.state, epoch: result.epoch, streamId: result.streamId });
        }
        if (operation === 'read') {
          const result = await adapter.readSnapshot({ streamId: input.value.streamId, selection: selection(input.value.selection) });
          const snapshot = await parseCloudSnapshot(JSON.stringify(result));
          return reply(res, 200, snapshot);
        }
        if (operation === 'write' || operation === 'reconcile') {
          const result = operation === 'write'
            ? await adapter.writeSnapshot({ epoch: input.value.epoch, components: input.value.components, label: input.value.label })
            : await adapter.reconcile();
          if (result?.provider !== provider) throw new Error('Invalid native result');
          if (operation === 'reconcile' && ['empty', 'failed'].includes(result.phase) && result.acknowledgement === null
            && Number.isSafeInteger(result.epoch) && result.epoch >= 1) {
            return reply(res, 200, { provider, phase: result.phase, epoch: result.epoch, acknowledgement: null });
          }
          if (result.phase !== 'acknowledged') throw new Error('Invalid native result');
          return reply(res, 200, { provider, phase: result.phase, ...acknowledgement(result, input.value.epoch) });
        }
        if (operation === 'maintain') {
          const result = await adapter.maintain();
          if (result?.provider !== provider || !Number.isSafeInteger(result.epoch) || result.epoch < 1
            || !Number.isSafeInteger(result.sequence) || result.sequence < 0
            || result.capacity?.maximumRecords !== 8192 || !Number.isSafeInteger(result.capacity.remainingTransitions)
            || result.capacity.remainingTransitions < 0 || result.capacity.remainingTransitions > 8192
            || typeof result.capacity.canPrepare !== 'boolean'
            || ![result.sessionsPruned?.removed, result.sessionsPruned?.retained].every((value) => Number.isSafeInteger(value) && value >= 0)) {
            throw new Error('Invalid native maintenance');
          }
          return reply(res, 200, { provider, epoch: result.epoch, sequence: result.sequence,
            capacity: { maximumRecords: 8192, remainingTransitions: result.capacity.remainingTransitions, canPrepare: result.capacity.canPrepare },
            sessionsPruned: { removed: result.sessionsPruned.removed, retained: result.sessionsPruned.retained } });
        }
        return reply(res, 200, publicStatus(await adapter.status(), provider));
      } catch (error) {
        const metadata = copyCloudFailureMetadata({}, error);
        const { status, ...safe } = metadata;
        return reply(res, 503, { error: 'Native cloud operation failed. Reconnect or check the host configuration. Local data is unchanged.',
          ...safe, ...(status !== undefined ? { providerStatus: status } : {}) });
      }
    },
  };
}
