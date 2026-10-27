const HEX = /^[a-f0-9]{64}$/;
const PROVIDERS = ['google', 'microsoft'];
const RETRY_DELAYS = [5000, 15000, 60000, 300000];
const WORKER_LOCK = 'mrt.cloud.backup.worker';
const MAX_TIMER_DELAY = 2147483647;

export class CloudBackupError extends Error {
  constructor(code) {
    super(`Cloud backup could not continue (${code}). Saved local data is unchanged.`);
    this.name = 'CloudBackupError';
    this.code = code;
  }
}

function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function positive(value) { return Number.isSafeInteger(value) && value > 0; }

function connection(value) {
  if (!object(value) || !PROVIDERS.includes(value.provider) || !positive(value.epoch)
    || (value.streamId != null && (typeof value.streamId !== 'string' || !HEX.test(value.streamId)))) {
    throw new TypeError('Cloud backup requires an explicitly selected native provider and epoch.');
  }
  return Object.freeze({ provider: value.provider, epoch: value.epoch, streamId: value.streamId ?? null });
}

function acknowledgement(value, owner, expectedDigest) {
  if (!object(value) || value.phase !== 'acknowledged' || value.provider !== owner.provider
    || value.epoch !== owner.epoch || typeof value.streamId !== 'string' || !HEX.test(value.streamId)
    || (owner.streamId !== null && value.streamId !== owner.streamId)
    || !positive(value.attemptEpoch) || value.attemptEpoch > value.epoch || !positive(value.generation)
    || ['attemptId', 'contentDigest', 'byteDigest'].some((key) => typeof value[key] !== 'string' || !HEX.test(value[key]))
    || (expectedDigest !== undefined && value.contentDigest !== expectedDigest)) {
    throw new CloudBackupError('acknowledgement');
  }
  return Object.freeze(Object.fromEntries([
    'provider', 'phase', 'epoch', 'attemptEpoch', 'streamId', 'attemptId', 'generation', 'contentDigest', 'byteDigest',
  ].map((key) => [key, value[key]])));
}

function authority(value, owner) {
  if (value?.phase === 'acknowledged') return acknowledgement(value, owner);
  if (!object(value) || value.provider !== owner.provider || value.epoch !== owner.epoch
    || !['empty', 'failed'].includes(value.phase) || value.acknowledgement !== null) {
    throw new CloudBackupError('reconciliation');
  }
  return null;
}

function unfencedStatus(value, owner) {
  if (!object(value) || value.provider !== owner.provider || value.epoch !== owner.epoch
    || value.state !== 'connected' || value.phase !== 'active') throw new CloudBackupError('connection');
  if (value.acknowledgement === null) return null;
  return acknowledgement({ ...value.acknowledgement, provider: value.provider, phase: 'acknowledged' }, owner);
}

export class CloudBackupCoordinator {
  constructor({
    transport, capture, isBlocked, label, locks = globalThis.navigator?.locks,
    onChange = () => {}, now = () => Date.now(),
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = (timer) => globalThis.clearTimeout(timer),
    isOnline = () => globalThis.navigator?.onLine !== false,
    prepare = async () => true, acknowledged = async () => {},
  } = {}) {
    if (['writeSnapshot', 'reconcile', 'status'].some((key) => typeof transport?.[key] !== 'function')
      || typeof capture !== 'function' || typeof isBlocked !== 'function'
      || typeof label !== 'string' || !label.trim() || label.length > 200
      || [onChange, now, setTimer, clearTimer, isOnline, prepare, acknowledged].some((value) => typeof value !== 'function')) {
      throw new TypeError('Cloud backup requires native transport, coherent capture, recovery guard and scheduling owners.');
    }
    this.transport = transport;
    this.capture = capture;
    this.isBlocked = isBlocked;
    this.label = label;
    this.locks = locks;
    this.onChange = onChange;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.isOnline = isOnline;
    this.prepare = prepare;
    this.acknowledged = acknowledged;
    this.owner = null;
    this.run = null;
    this.timer = null;
    this.requested = false;
    this.revision = 0;
    this.retryCount = 0;
    this.retryAt = 0;
    this.halted = null;
    this.lastAcknowledgement = null;
    this.state = Object.freeze({
      phase: 'disconnected', pending: false, acknowledgement: null, code: null, retryAt: null,
    });
  }

  start(selected) {
    const next = connection(selected);
    this.invalidate();
    this.owner = next;
    this.lastAcknowledgement = null;
    this.halted = null;
    this.retryCount = 0;
    this.retryAt = 0;
    this.requested = true;
    this.publish('pending');
    this.schedule();
  }

  stop() {
    this.invalidate();
    this.owner = null;
    this.requested = false;
    this.lastAcknowledgement = null;
    this.publish('disconnected');
  }

  committed() {
    if (!this.owner) return;
    this.revision++;
    this.requested = true;
    if (this.halted === 'capture') this.halted = null;
    this.schedule();
  }

  resume() {
    if (!this.owner) return;
    this.requested = true;
    this.schedule();
  }

  retry() {
    if (!this.owner) return;
    this.halted = null;
    this.resume();
  }

  invalidate() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.run?.controller.abort();
  }

  current(run) { return this.owner === run.owner; }

  publish(phase, code = null) {
    const next = {
      phase, pending: !['disconnected', 'up-to-date', 'metadata-only'].includes(phase),
      acknowledgement: this.lastAcknowledgement, code, retryAt: this.retryAt || null,
    };
    if (JSON.stringify(next) === JSON.stringify(this.state)) return;
    this.state = Object.freeze(next);
    this.onChange(this.state);
  }

  schedule() {
    if (!this.owner || !this.requested || this.run || this.timer !== null || this.halted) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      if (this.retryAt > this.now()) { this.schedule(); return; }
      return this.work();
    }, Math.min(MAX_TIMER_DELAY, Math.max(0, this.retryAt - this.now())));
  }

  guard(run) {
    if (!this.current(run)) return false;
    if (this.isBlocked() !== false) throw new CloudBackupError('paused');
    if (this.isOnline() !== true) throw new CloudBackupError('offline');
    return true;
  }

  async work() {
    if (!this.owner || !this.requested || this.halted) return;
    const run = { owner: this.owner, controller: new AbortController(), stage: 'guard', again: false };
    this.run = run;
    try {
      if (!this.guard(run)) return;
      if (typeof this.locks?.request !== 'function') throw new CloudBackupError('exclusive-worker');
      run.stage = 'lock';
      await this.locks.request(WORKER_LOCK, { mode: 'exclusive', signal: run.controller.signal }, async () => {
        if (!this.guard(run)) return;
        this.requested = false;
        this.publish('checking');
        run.stage = 'reconcile';
        // Only native reconciliation can withdraw an outstanding durable mutation fence.
        const verified = await this.transport.reconcile();
        if (!this.guard(run)) return;
        const expectedOwner = this.lastAcknowledgement
          ? { ...run.owner, streamId: this.lastAcknowledgement.streamId } : run.owner;
        let prior = authority(verified, expectedOwner);
        if (prior === null) {
          const status = await this.transport.status();
          if (!this.guard(run)) return;
          prior = unfencedStatus(status, expectedOwner);
        }
        if (prior && this.lastAcknowledgement && prior.generation < this.lastAcknowledgement.generation) {
          throw new CloudBackupError('acknowledgement');
        }
        const revision = this.revision;
        run.stage = 'capture';
        const held = await this.capture();
        if (!this.guard(run)) return;
        if (!object(held) || !object(held.components) || typeof held.contentDigest !== 'string'
          || !HEX.test(held.contentDigest)) throw new CloudBackupError('capture');
        if (prior?.contentDigest === held.contentDigest) {
          this.lastAcknowledgement = prior;
        } else {
          run.stage = 'capture';
          const eligible = await this.prepare(held, prior);
          if (!this.guard(run)) return;
          if (eligible === false) {
            this.lastAcknowledgement = prior;
            if (this.requested || revision !== this.revision) {
              this.requested = true;
              run.again = true;
              this.publish('pending');
            } else this.publish('metadata-only');
            return;
          }
          if (eligible !== true) throw new CloudBackupError('capture');
          run.stage = 'write';
          this.publish('saving');
          if (!this.guard(run)) return;
          const result = await this.transport.writeSnapshot({
            components: held.components, label: this.label, epoch: run.owner.epoch,
          });
          if (!this.guard(run)) return;
          this.lastAcknowledgement = acknowledgement(result,
            prior ? { ...expectedOwner, streamId: prior.streamId } : expectedOwner, held.contentDigest);
        }
        run.stage = 'capture';
        await this.acknowledged(held, this.lastAcknowledgement);
        if (!this.guard(run)) return;
        this.retryCount = 0;
        this.retryAt = 0;
        if (this.requested || revision !== this.revision) {
          this.requested = true;
          run.again = true;
          this.publish('pending');
        } else {
          this.publish('up-to-date');
        }
      });
    } catch (error) {
      if (this.current(run)) this.failed(error, run);
    } finally {
      if (this.run === run) this.run = null;
      if (this.owner && this.requested && !this.halted
        && (run.again || !this.current(run) || this.retryAt > this.now())) this.schedule();
    }
  }

  failed(error, run) {
    this.requested = true;
    if (error instanceof CloudBackupError && ['paused', 'offline'].includes(error.code)) {
      this.publish(error.code === 'paused' ? 'paused' : 'pending-offline', error.code);
      return;
    }
    if (run.stage === 'capture') {
      const code = ['blocked', 'pending', 'raced'].includes(error?.code) ? 'paused' : 'capture';
      if (code !== 'paused') this.halted = 'capture';
      this.publish(code === 'paused' ? 'paused' : 'failed', code);
      return;
    }
    if (error instanceof CloudBackupError) {
      this.halted = 'protocol';
      this.publish(error.code === 'exclusive-worker' ? 'unavailable' : 'failed', error.code);
      return;
    }
    if (run.stage === 'guard') {
      this.halted = 'capture';
      this.publish('failed', 'local-guard');
      return;
    }
    const status = error?.providerStatus ?? error?.status;
    if (status === 401 || error?.code === 'reconnect-required') {
      this.halted = 'transport';
      this.publish('reconnect-required', 'authentication');
      return;
    }
    if ((Number.isInteger(status) && status >= 400 && status < 500 && status !== 408 && status !== 429)
      || status === 507 || error?.code === 'unsupported') {
      this.halted = 'transport';
      this.publish(error?.code === 'unsupported' ? 'unavailable' : 'failed', 'provider-refusal');
      return;
    }
    const unknown = error?.outcome === 'unknown' || error?.code === 'unknown';
    if (!unknown && status !== 408 && status !== 429 && !(Number.isInteger(status) && status >= 500 && status <= 599)) {
      this.halted = 'transport';
      this.publish('failed', 'native-unclassified');
      return;
    }
    const delay = RETRY_DELAYS[Math.min(this.retryCount++, RETRY_DELAYS.length - 1)];
    const providerDelay = error?.retryAfterMs ?? 0;
    const retryAt = this.now() + Math.max(delay, providerDelay);
    if (!Number.isSafeInteger(providerDelay) || providerDelay < 0 || !Number.isSafeInteger(retryAt)) {
      this.halted = 'protocol';
      this.publish('failed', 'retry-delay');
      return;
    }
    this.retryAt = retryAt;
    this.publish(unknown || run.stage === 'write' ? 'outcome-unknown' : 'pending',
      'provider-unresolved');
  }
}
