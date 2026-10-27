const MAX_BYTES = 32 * 1024 * 1024;
const CODEC_LIMIT = 2 * MAX_BYTES + 8192;
const CHUNK = 32768;
const HEX = /^[a-f0-9]{64}$/;
const PROVIDERS = new Set(['google', 'microsoft']);

function failure(code = 'failed', metadata) {
  const error = new Error('Native cloud work was not confirmed. Local data is unchanged; reconnect or retry when ready.');
  error.code = code;
  if (Number.isSafeInteger(metadata?.retryAfterMs) && metadata.retryAfterMs >= 0) error.retryAfterMs = metadata.retryAfterMs;
  if (Number.isSafeInteger(metadata?.providerStatus) && metadata.providerStatus >= 100 && metadata.providerStatus <= 599) error.status = metadata.providerStatus;
  if (['unknown', 'not-sent', 'read-only'].includes(metadata?.outcome)) error.outcome = metadata.outcome;
  return error;
}

export function createAndroidCloudClient({
  send, loadCodec = () => import('../js/lib/cloudSnapshot.js'), timeoutMs,
  setTimer = globalThis.setTimeout, clearTimer = globalThis.clearTimeout,
}) {
  const requestTimeout = timeoutMs === undefined ? 120000 : timeoutMs;
  const discoveryTimeout = timeoutMs === undefined ? 300000 : timeoutMs;
  if (typeof send !== 'function' || typeof loadCodec !== 'function'
    || !Number.isSafeInteger(requestTimeout) || requestTimeout < 1 || requestTimeout > 300000) throw failure('unsupported');
  let context = null;
  let sequence = 0;
  let codec = null;
  let codecTimer = null;
  const pending = new Map();
  const expiredConnects = new Map();
  const availability = new Set();
  function announceAvailability() {
    for (const listener of availability) listener(context?.configured === true);
  }
  function reset() {
    for (const [id, request] of pending) if (request.operation === 'connect') cancelConnect(id, request);
    context = null;
    codec = null;
    if (codecTimer !== null) clearTimer(codecTimer);
    codecTimer = null;
    for (const request of pending.values()) {
      clearTimer(request.timer);
      request.reject(failure('inactive'));
    }
    pending.clear();
    expiredConnects.clear();
    announceAvailability();
  }
  function current(message) {
    return context && message.generation === context.generation && message.capability === context.capability;
  }
  function cancelConnect(id, request) {
    try {
      send({ v: 1, kind: 'cloud-cancel', id, generation: request.context.generation,
        capability: request.context.capability, epoch: request.epoch, provider: request.provider });
    } catch { /* Page/port withdrawal is also enforced natively; no completion is synthesized. */ }
  }
  function ack(value, epoch) {
    if (!value || value.phase !== 'acknowledged' || value.epoch !== epoch
      || !Number.isSafeInteger(value.attemptEpoch) || value.attemptEpoch < 1
      || !Number.isSafeInteger(value.generation) || value.generation < 1
      || !['streamId', 'attemptId', 'contentDigest', 'byteDigest'].every((key) => typeof value[key] === 'string' && HEX.test(value[key]))) {
      throw failure('invalid');
    }
    return Object.fromEntries(['epoch', 'attemptEpoch', 'streamId', 'attemptId', 'generation', 'contentDigest', 'byteDigest']
      .map((key) => [key, value[key]]));
  }
  function account(value) {
    if (value === null) return null;
    if (!value || typeof value.id !== 'string' || !value.id || value.id.length > 8192
      || typeof value.label !== 'string' || !value.label || value.label.length > 8192) throw failure('invalid');
    return { id: value.id, label: value.label };
  }
  function result(operation, value, request) {
    if (!value || value.provider !== request.provider || !Number.isSafeInteger(value.epoch) || value.epoch < 0) throw failure('invalid');
    if (operation === 'write' || operation === 'reconcile') {
      if (operation === 'reconcile' && ['empty', 'failed'].includes(value.phase) && value.acknowledgement === null) {
        return { provider: value.provider, epoch: value.epoch, phase: value.phase, acknowledgement: null };
      }
      return { provider: value.provider, phase: 'acknowledged', ...ack(value, request.epoch) };
    } else if (operation === 'status') {
      if (!['connected', 'disconnected', 'pending-choice', 'reconnect-required'].includes(value.state)) throw failure('invalid');
      if (!['disconnected', 'connecting', 'discovering', 'awaiting-choice', 'allocating', 'active', 'disconnecting'].includes(value.phase)) throw failure('invalid');
      return { provider: value.provider, state: value.state, phase: value.phase, epoch: value.epoch, account: account(value.account),
        acknowledgement: value.acknowledgement ? ack({ ...value.acknowledgement, phase: 'acknowledged' }, value.epoch) : null };
    } else if (operation === 'connect' || operation === 'disconnect') {
      if (value.state !== (operation === 'connect' ? 'discovering' : 'disconnected')) throw failure('invalid');
      return { provider: value.provider, state: value.state, epoch: value.epoch, account: account(value.account) };
    } else if (operation === 'choose') {
      if (value.state !== 'active' || typeof value.streamId !== 'string' || !HEX.test(value.streamId)) throw failure('invalid');
      return { provider: value.provider, state: 'active', epoch: value.epoch, streamId: value.streamId };
    }
    return value;
  }
  function request(provider, operation, input = {}, expectedEpoch = context?.epoch) {
    if (!context?.configured || !PROVIDERS.has(provider) || expectedEpoch !== context.epoch || pending.size >= 8) {
      return Promise.reject(failure(context?.configured ? 'inactive' : 'unsupported'));
    }
    const id = `cloud-${++sequence}`;
    let message;
    try {
      message = JSON.parse(JSON.stringify({
        v: 1, kind: 'cloud', id, generation: context.generation, capability: context.capability,
        epoch: expectedEpoch, provider, operation, input,
      }));
      if (new TextEncoder().encode(JSON.stringify(message)).byteLength > MAX_BYTES) throw failure('size');
    } catch { return Promise.reject(failure('invalid')); }
    return new Promise((resolve, reject) => {
      const timer = setTimer(() => {
        const expired = pending.get(id);
        pending.delete(id);
        if (expired?.operation === 'connect') {
          if (expiredConnects.size >= 8) expiredConnects.delete(expiredConnects.keys().next().value);
          expiredConnects.set(id, expired);
          cancelConnect(id, expired);
        }
        reject(failure('unknown'));
      }, operation === 'discover' ? discoveryTimeout : requestTimeout);
      pending.set(id, { resolve, reject, timer, epoch: expectedEpoch, provider, operation, context });
      try { send(message); }
      catch {
        pending.delete(id);
        clearTimer(timer);
        reject(failure('inactive'));
      }
    });
  }
  async function codecPart(message) {
    if (!current(message) || !context.configured || message.epoch !== context.epoch
      || typeof message.id !== 'string' || !/^codec-[a-f0-9]{64}$/.test(message.id)
      || typeof message.nonce !== 'string' || !HEX.test(message.nonce)
      || !Number.isSafeInteger(message.part) || !Number.isSafeInteger(message.total)
      || message.total < 1 || message.total > 4096 || typeof message.text !== 'string' || message.text.length > CHUNK) return;
    if (!codec) {
      if (message.part !== 0) return;
      codec = { id: message.id, nonce: message.nonce, next: 0, total: message.total, parts: [], length: 0, bytes: 0 };
      codecTimer = setTimer(() => { codec = null; codecTimer = null; }, 30000);
    }
    const job = codec;
    const bytes = new TextEncoder().encode(message.text).byteLength;
    if (job.id !== message.id || job.nonce !== message.nonce || job.next !== message.part || job.total !== message.total
      || job.length + message.text.length > CODEC_LIMIT || job.bytes + bytes > CODEC_LIMIT) return;
    job.parts.push(message.text);
    job.length += message.text.length;
    job.bytes += bytes;
    job.next++;
    if (job.next !== job.total) return;
    let response;
    try {
      const raw = job.parts.join('');
      if (new TextEncoder().encode(raw).byteLength > CODEC_LIMIT) throw failure('size');
      const input = JSON.parse(raw);
      let owner;
      try { owner = await loadCodec(); } catch { throw failure('unsupported'); }
      if (!current(message) || codec !== job || context.epoch !== message.epoch) return;
      if (input.mode === 'encode') {
        const encoded = await owner.createCloudSnapshot(input.components, input.capture);
        response = { ok: true, text: encoded.text };
      } else if (input.mode === 'decode' && typeof input.text === 'string') {
        await owner.parseCloudSnapshot(input.text);
        response = { ok: true, text: input.text };
      } else throw failure('invalid');
    } catch (error) {
      response = { ok: false, code: error.code === 'unsupported' ? 'unavailable' : 'invalid' };
    }
    try {
      if (!current(message) || codec !== job || context.epoch !== message.epoch) return;
      const raw = JSON.stringify(response);
      if (new TextEncoder().encode(raw).byteLength > CODEC_LIMIT) throw failure('size');
      const total = Math.max(1, Math.ceil(raw.length / CHUNK));
      for (let part = 0; part < total; part++) send({
        v: 1, kind: 'cloud-codec-result', id: message.id, nonce: message.nonce,
        generation: context.generation, capability: context.capability, epoch: message.epoch,
        part, total, text: raw.slice(part * CHUNK, (part + 1) * CHUNK),
      });
    } catch { /* Native expiry retains the unresolved operation; no success is synthesized. */ }
    finally {
      if (codec === job) {
        codec = null;
        if (codecTimer !== null) clearTimer(codecTimer);
        codecTimer = null;
      }
    }
  }
  function receive(message) {
    if (!message?.kind?.startsWith('cloud-')) return false;
    if (message.v !== 1) return true;
    if (message.kind === 'cloud-ready') {
      if (context) return true;
      if (!Number.isSafeInteger(message.generation) || message.generation < 0
        || typeof message.capability !== 'string' || !HEX.test(message.capability)
        || typeof message.configured !== 'boolean' || !Number.isSafeInteger(message.epoch) || message.epoch < 0) return true;
      reset();
      context = { generation: message.generation, capability: message.capability, configured: message.configured, epoch: message.epoch };
      announceAvailability();
      return true;
    }
    if (!current(message)) return true;
    if (message.kind === 'cloud-codec') { codecPart(message).catch(() => {}); return true; }
    if (message.kind !== 'cloud-result') return true;
    const active = pending.get(message.id);
    if (!active) {
      const expired = expiredConnects.get(message.id);
      if (expired?.context === context && Number.isSafeInteger(message.epoch) && message.epoch >= context.epoch) {
        context.epoch = message.epoch;
        expiredConnects.delete(message.id);
      }
      return true;
    }
    pending.delete(message.id);
    clearTimer(active.timer);
    const changingEpoch = ['connect', 'disconnect'].includes(active.operation);
    const stale = message.status === 'ok' && (!Number.isSafeInteger(message.epoch) || message.epoch < context.epoch
      || !changingEpoch && (message.epoch !== active.epoch || context.epoch !== active.epoch));
    if (Number.isSafeInteger(message.epoch) && message.epoch >= context.epoch) context.epoch = message.epoch;
    if (stale) active.reject(failure('inactive'));
    else if (message.status !== 'ok') active.reject(failure(['unsupported', 'busy', 'invalid', 'failed'].includes(message.code) ? message.code : 'failed', message));
    else {
      try {
        if (active.operation === 'read') {
          loadCodec().then((owner) => owner.parseCloudSnapshot(JSON.stringify(message.result))).then((snapshot) => {
            if (context !== active.context || context.epoch !== active.epoch) active.reject(failure('inactive'));
            else active.resolve(snapshot);
          }, () => active.reject(failure('invalid')));
        } else active.resolve(result(active.operation, message.result, active));
      } catch { active.reject(failure('invalid')); }
    }
    return true;
  }
  return {
    receive, reset,
    get supported() { return context?.configured === true; },
    subscribeAvailability(listener) {
      if (typeof listener !== 'function') throw failure('invalid');
      availability.add(listener);
      listener(context?.configured === true);
      return () => availability.delete(listener);
    },
    forProvider(provider) {
      if (!PROVIDERS.has(provider)) throw failure('unsupported');
      return {
        status: () => request(provider, 'status'),
        connect: () => request(provider, 'connect'),
        discover: () => request(provider, 'discover'),
        chooseSeparate: ({ epoch, discoveryId }) => request(provider, 'choose', { discoveryId }, epoch),
        readSnapshot: ({ streamId, selection }) => request(provider, 'read', { streamId, selection }),
        writeSnapshot: ({ epoch, components, label }) => request(provider, 'write', { components, label }, epoch),
        reconcile: () => request(provider, 'reconcile'),
        maintain: () => request(provider, 'maintain'),
        disconnect: () => request(provider, 'disconnect'),
      };
    },
  };
}
