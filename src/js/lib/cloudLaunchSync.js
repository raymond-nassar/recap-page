import { CLOUD_SYNC_OFFER_LOCK, CLOUD_SYNC_PENDING_KEY } from '../storage.js';
import { canonical, settingsFromStorage } from './completeBackup.js';
import { compareCloudBackups, personalDigest } from './cloudSync.js';
import { createEmptyState, exportBackup } from './model.js';
import { CLOUD_BACKUP_CADENCE } from './cloudCoordinator.js';
import { CloudBackupError } from './cloudProtocol.js';

export const CLOUD_SYNC_CHECK_TIMEOUT_MS = 30_000;
export const CLOUD_SYNC_OFFER_RECHECK_MS = 5_000;

const HOLD_UNCONFIRMED = 'The cloud upload hold could not be confirmed. Turn automatic backup off on this device until the check can finish.';
const OFFER_WATCH_DELAYS = [CLOUD_SYNC_OFFER_RECHECK_MS, 15_000, 60_000, 5 * 60_000];
const emptyReader = exportBackup(createEmptyState());
delete emptyReader.exportedAt;
delete emptyReader.active;

function localFacts(backup) {
  const marks = Object.values(backup.components.reader.read);
  return { readCount: marks.length, lastReadAt: marks.reduce((last, time) => Math.max(last, time), 0) || null };
}

function isEmpty(backup) {
  const { reader, history, settings, draft } = backup.components;
  const personal = { ...reader };
  delete personal.active;
  return canonical(personal) === canonical(emptyReader) && history.records.length === 0 && draft === null
    && canonical(settings) === canonical(settingsFromStorage(null, null));
}

function offerIdentity(offer) {
  return canonical({
    epoch: offer.epoch, remote: offer.remote, localDigest: offer.localDigest,
    localContentDigest: offer.localContentDigest, comparison: offer.comparison,
    othersDiffering: offer.othersDiffering, listing: offer.listing,
    keepLocal: offer.keepLocal, priorKept: offer.priorKept,
  });
}

export function createCloudSyncMarker(getStorage = () => globalThis.localStorage) {
  function access(operation) {
    try {
      const storage = getStorage();
      if (typeof storage?.getItem !== 'function' || typeof storage.setItem !== 'function'
        || typeof storage.removeItem !== 'function') throw new Error('Storage is unavailable.');
      return operation(storage);
    } catch {
      throw new CloudBackupError('The cloud check marker could not be saved or checked.', 'storage');
    }
  }
  return {
    pending: () => access((storage) => storage.getItem(CLOUD_SYNC_PENDING_KEY) !== null),
    arm: (epoch) => access((storage) => {
      storage.setItem(CLOUD_SYNC_PENDING_KEY, epoch);
      if (storage.getItem(CLOUD_SYNC_PENDING_KEY) !== epoch) throw new Error('The marker did not persist.');
    }),
    release: (epoch) => access((storage) => {
      if (storage.getItem(CLOUD_SYNC_PENDING_KEY) !== epoch) throw new Error('The marker changed.');
      storage.removeItem(CLOUD_SYNC_PENDING_KEY);
      if (storage.getItem(CLOUD_SYNC_PENDING_KEY) !== null) throw new Error('The marker remains.');
    }),
    erase: () => access((storage) => {
      storage.removeItem(CLOUD_SYNC_PENDING_KEY);
      if (storage.getItem(CLOUD_SYNC_PENDING_KEY) !== null) throw new Error('The marker remains.');
    }),
  };
}

export class CloudLaunchSync {
  constructor({
    protocol, coordinator, capture, locks = globalThis.navigator?.locks, cryptoProvider = globalThis.crypto,
    marker = createCloudSyncMarker(),
    isBlocked = () => false, isOnline = () => globalThis.navigator?.onLine !== false,
    hasInteracted = () => false, connectionCurrent = async () => true, snapshotCurrent = () => true,
    restore = null, restoreReady = null,
    setTimer = (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimer = (timer) => globalThis.clearTimeout(timer), onChange = () => {}, announce = () => {},
  } = {}) {
    if (!protocol || !coordinator
      || [capture, isBlocked, isOnline, hasInteracted, connectionCurrent, snapshotCurrent, setTimer, clearTimer, onChange, announce]
        .some((value) => typeof value !== 'function') || (restore !== null && typeof restore !== 'function')
      || (restoreReady !== null && typeof restoreReady !== 'function')) {
      throw new TypeError('Cloud sync needs its protocol, backup coordinator and saved-data owners.');
    }
    Object.assign(this, {
      protocol, coordinator, capture, locks, cryptoProvider, marker, isBlocked, isOnline, hasInteracted,
      connectionCurrent, snapshotCurrent, restore, restoreReady,
      setTimer, clearTimer, onChange, announce,
    });
    this.active = false;
    this.sequence = 0;
    this.attempt = 0;
    this.leader = false;
    this.epoch = null;
    this.timer = null;
    this.retryCount = 0;
    this.election = null;
    this.starting = null;
    this.running = null;
    this.probe = null;
    this.watch = null;
    this.offerWatchCount = 0;
    this.cancelCheck = null;
    this.cancelArm = null;
    this.followerRead = null;
    this.followerEpoch = undefined;
    this.gateRelease = null;
    this.queuedCheck = false;
    this.uncertainPending = null;
    this.holdUnconfirmed = false;
    this.action = null;
    this.reserving = false;
    this.kept = null;
    this.historyUnknown = false;
    this.notice = null;
    this.releaseLease = null;
    this.interacted = this.hasInteracted();
    this.state = Object.freeze({ phase: 'off', offer: null, error: null, kept: null, historyUnknown: false });
  }

  publish(phase, offer = null, error = null, code = null, action = null) {
    if (['off', 'clear', 'ready', 'offer', 'failed', 'loaded'].includes(phase)) this.notice = null;
    this.state = Object.freeze({
      phase, offer, error, code, action, kept: this.kept, historyUnknown: this.historyUnknown,
      notice: this.notice,
      canOverride: phase === 'failed',
    });
    this.onChange(this.state);
  }

  async current(sequence = this.sequence, attempt = this.attempt) {
    if (!this.active || sequence !== this.sequence || attempt !== this.attempt || !this.leader) {
      throw new CloudBackupError('The cloud check is no longer current. Check again.', 'raced');
    }
    const record = await this.protocol.record();
    const context = this.context;
    if (!this.active || sequence !== this.sequence || attempt !== this.attempt || !this.leader
      || record?.stream !== context.stream || record.consent?.connection !== context.connection
      || record.consent?.id !== context.consentId || record.consent?.provider !== 'onedrive'
      || !this.isOnline() || !await this.connectionCurrent(context)) {
      throw new CloudBackupError('Cloud backup changed, so the earlier choice was withdrawn.', 'needs-consent');
    }
    const gate = await this.protocol.syncGate(context);
    if (!this.active || sequence !== this.sequence || attempt !== this.attempt || !this.leader
      || gate?.epoch !== this.epoch || !gate.held) {
      throw new CloudBackupError('The cloud check changed, so the earlier choice was withdrawn.', 'raced');
    }
  }

  cancelTimer() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
  }

  scheduleRetry() {
    this.cancelTimer();
    if (!this.active) return;
    const delays = CLOUD_BACKUP_CADENCE.retryMs;
    const delay = delays[Math.min(this.retryCount, delays.length - 1)];
    this.retryCount += 1;
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.checkNow();
    }, delay);
  }

  async start(context) {
    this.stop();
    this.context = { ...context };
    this.active = true;
    this.interacted = this.hasInteracted();
    this.coordinator.holdSync('checking');
    this.publish('checking');
    return this.begin();
  }

  stop() {
    this.active = false;
    this.sequence += 1;
    this.attempt += 1;
    this.cancelTimer();
    this.cancelCheck?.();
    this.cancelCheck = null;
    this.cancelArm?.();
    this.cancelArm = null;
    this.followerRead?.cancel();
    this.followerRead = null;
    this.followerEpoch = undefined;
    const release = this.gateRelease;
    this.gateRelease = null;
    release?.controller.abort();
    this.queuedCheck = false;
    this.uncertainPending = null;
    this.holdUnconfirmed = false;
    this.watch?.cancel?.();
    this.watch = null;
    this.offerWatchCount = 0;
    if (this.action) this.action.invalid = true;
    this.action = null;
    this.reserving = false;
    this.kept = null;
    this.historyUnknown = false;
    this.notice = null;
    this.releaseLease?.();
    this.releaseLease = null;
    this.leader = false;
    this.election = null;
    this.starting = null;
    this.running = null;
    this.probe = null;
  }

  async begin() {
    if (!this.active) return;
    if (this.starting) return this.starting;
    const operation = this.beginElection();
    this.starting = operation;
    try { await operation; }
    finally { if (this.starting === operation) this.starting = null; }
  }

  async armGate(sequence, { epoch, force = false, pending, authorize = () => true } = {}) {
    const context = { ...this.context };
    const controller = new AbortController();
    let active = true;
    const current = () => active && this.active && sequence === this.sequence && !controller.signal.aborted && authorize();
    const operation = this.protocol.exclusive(async () => {
      let abort;
      const stopped = new Promise((resolve, reject) => {
        abort = () => reject(new CloudBackupError('The cloud check is no longer current.', 'raced'));
        if (controller.signal.aborted) abort();
        else controller.signal.addEventListener('abort', abort, { once: true });
      });
      try {
        await Promise.race([(async () => {
          if (!current()) return;
          const gate = force ? null : await this.protocol.syncGate(context);
          if (!current()) return;
          if (force || !gate?.held) {
            let markerError = null;
            try { this.marker.arm(epoch); } catch (error) { markerError = error; }
            await this.protocol.setSyncGate({
              ...context, epoch, held: true, authorize: current, signal: controller.signal,
              ...(pending === undefined ? {} : { pending }),
            });
            if (markerError) throw markerError;
          }
        })(), stopped]);
      } finally {
        controller.signal.removeEventListener('abort', abort);
      }
    }, { signal: controller.signal });
    let deadline;
    let cancel;
    const timeout = new Promise((resolve, reject) => {
      deadline = this.setTimer(() => {
        controller.abort();
        reject(new CloudBackupError('The cloud check took too long. Try again.', 'timeout'));
      }, CLOUD_SYNC_CHECK_TIMEOUT_MS);
    });
    const stopped = new Promise((resolve, reject) => {
      cancel = () => {
        controller.abort();
        reject(new CloudBackupError('The cloud check is no longer current.', 'raced'));
      };
      this.cancelArm = cancel;
    });
    try { await Promise.race([operation, timeout, stopped]); }
    finally {
      active = false;
      controller.abort();
      this.clearTimer(deadline);
      if (this.cancelArm === cancel) this.cancelArm = null;
    }
  }

  async beginElection() {
    if (!this.active || this.election) return;
    if (typeof this.locks?.request !== 'function' || typeof this.protocol.exclusive !== 'function') {
      this.fail(new CloudBackupError('This browser cannot safely coordinate cloud checks, so backups stay paused.', 'unsupported'));
      return;
    }
    const sequence = this.sequence;
    let finishInitial;
    const initial = new Promise((resolve) => { finishInitial = resolve; });
    this.election = this.locks.request(CLOUD_SYNC_OFFER_LOCK, { mode: 'exclusive', ifAvailable: true }, async (lock) => {
      if (!lock || !this.active || sequence !== this.sequence) {
        if (this.active && sequence === this.sequence) {
          if (this.state.phase !== 'following') this.followerEpoch = undefined;
          this.publish('following');
          this.scheduleRetry();
        }
        finishInitial();
        return;
      }
      this.leader = true;
      const lease = new Promise((resolve) => { this.releaseLease = resolve; });
      try {
        this.epoch = this.protocol.randomId();
        await this.armGate(sequence, {
          epoch: this.epoch, force: true,
          ...(this.uncertainPending === null ? {} : { pending: this.uncertainPending }),
        });
        if (this.active && sequence === this.sequence) {
          this.holdUnconfirmed = false;
          this.uncertainPending = null;
        }
        if (this.active && sequence === this.sequence) await this.checkLeader(sequence);
      } catch (error) {
        if (this.active && sequence === this.sequence) {
          this.holdUnconfirmed = true;
          this.fail(error);
        }
      } finally {
        finishInitial();
      }
      if (this.active && sequence === this.sequence && this.state.phase !== 'clear') await lease;
    }).catch((error) => {
      if (this.active && sequence === this.sequence) this.fail(error);
      finishInitial();
    }).finally(() => {
      if (sequence === this.sequence) {
        this.election = null;
        this.leader = false;
        this.releaseLease = null;
      }
    });
    await initial;
  }

  async checkNow() {
    if (!this.active) return;
    const sequence = this.sequence;
    this.cancelTimer();
    if (this.holdUnconfirmed && !this.leader) {
      this.coordinator.holdSync('checking');
      this.publish('checking');
      return this.begin();
    }
    if (this.leader) {
      if (this.holdUnconfirmed) {
        this.coordinator.holdSync('checking');
        this.publish('checking');
        try { await this.restoreUnconfirmed(); }
        catch (error) {
          if (this.active && sequence === this.sequence) this.fail(error);
          return;
        }
      }
      if (!this.active || sequence !== this.sequence) return;
      return this.checkLeader(sequence);
    }
    return this.checkFollower(sequence);
  }

  async checkFollower(sequence) {
    if (this.followerRead) return this.followerRead.operation;
    const ticket = { sequence, phase: this.state.phase, cancel: () => {}, operation: null };
    const current = () => this.followerRead === ticket && this.active && sequence === this.sequence
      && !this.leader && this.state.phase === ticket.phase;
    this.followerRead = ticket;
    ticket.operation = (async () => {
      let deadline;
      try {
        const timeout = new Promise((resolve, reject) => {
          deadline = this.setTimer(() => reject(new CloudBackupError('The cloud check took too long. Try again.', 'timeout')),
            CLOUD_SYNC_CHECK_TIMEOUT_MS);
        });
        const stopped = new Promise((resolve, reject) => {
          ticket.cancel = () => reject(new CloudBackupError('The cloud check is no longer current.', 'raced'));
        });
        const gate = await Promise.race([this.protocol.syncGate({ ...this.context }), timeout, stopped]);
        if (!current()) return;
        if (this.followerEpoch === undefined) this.followerEpoch = gate?.epoch ?? null;
        else if (gate && !gate.held && gate.epoch !== this.followerEpoch && !this.marker.pending()) {
          this.coordinator.releaseSync();
          this.publish('clear');
          return;
        }
        return this.begin();
      } catch (error) {
        if (current()) {
          this.holdUnconfirmed = true;
          this.fail(error);
        }
      } finally {
        this.clearTimer(deadline);
        if (this.followerRead === ticket) this.followerRead = null;
      }
    })();
    return ticket.operation;
  }

  scheduleOfferWatch() {
    this.cancelTimer();
    if (!this.active || this.state.phase !== 'offer') return;
    const delay = OFFER_WATCH_DELAYS[Math.min(this.offerWatchCount, OFFER_WATCH_DELAYS.length - 1)];
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.watchOffer();
    }, delay);
  }

  watchCurrent(ticket) {
    return this.active && this.leader && this.watch === ticket && !this.action
      && this.sequence === ticket.sequence && this.attempt === ticket.attempt && this.epoch === ticket.epoch
      && this.state.phase === 'offer' && offerIdentity(this.state.offer) === ticket.identity;
  }

  async watchOffer() {
    if (!this.active || !this.leader || this.state.phase !== 'offer' || this.watch || this.action) return;
    const offer = this.state.offer;
    const ticket = {
      sequence: this.sequence, attempt: this.attempt, epoch: this.epoch,
      identity: offerIdentity(offer), cancel: null,
    };
    this.watch = ticket;
    let deadline = null;
    try {
      const probe = (async () => {
        await this.current(ticket.sequence, ticket.attempt);
        const snapshot = await this.capture();
        const remembered = await this.protocol.syncState({ connection: this.context.connection });
        const listing = await this.protocol.syncListing(this.context);
        await this.current(ticket.sequence, ticket.attempt);
        if (this.isBlocked() || snapshot.backup.digest !== offer.localContentDigest
          || !this.snapshotCurrent(snapshot.witness)
          || canonical(remembered?.kept ?? null) !== canonical(offer.priorKept)) return true;
        return canonical(listing) !== canonical(offer.listing);
      })();
      const timeout = new Promise((resolve, reject) => {
        deadline = this.setTimer(() => reject(new CloudBackupError('The cloud check took too long. Try again.', 'timeout')),
          CLOUD_SYNC_CHECK_TIMEOUT_MS);
      });
      const stopped = new Promise((resolve, reject) => {
        ticket.cancel = () => reject(new CloudBackupError('The cloud check is no longer current.', 'raced'));
      });
      const changed = await Promise.race([probe, timeout, stopped]);
      if (!this.watchCurrent(ticket)) return;
      if (changed) {
        this.notice = 'The cloud backup changed, so the earlier choice was withdrawn.';
        this.publish('checking');
        await this.checkLeader(ticket.sequence);
      } else this.offerWatchCount += 1;
    } catch (error) {
      if (this.watchCurrent(ticket)) {
        this.attempt += 1;
        this.fail(error);
      }
    } finally {
      if (deadline !== null) this.clearTimer(deadline);
      const currentWatch = this.watch === ticket;
      if (currentWatch) this.watch = null;
      if (currentWatch && this.active && this.leader && this.state.phase === 'offer' && !this.action) this.scheduleOfferWatch();
    }
  }

  async requestCheck() {
    if (!this.active) return;
    if (this.action?.restoring) {
      this.queuedCheck = true;
      return;
    }
    if (this.holdUnconfirmed && this.leader && !this.action && !this.gateRelease) return this.checkNow();
    const sequence = this.sequence;
    const release = this.gateRelease;
    if (release && !release.committed) release.controller.abort();
    if (release?.committed) {
      this.queuedCheck = true;
      return;
    }
    if (this.action) this.action.invalid = true;
    if (release) this.queuedCheck = true;
    const wasClear = this.state.phase === 'clear';
    this.coordinator.holdSync('checking');
    this.publish('checking');
    this.cancelTimer();
    if (this.action) return;
    if (this.starting) await this.starting;
    if (!this.active || sequence !== this.sequence) return;
    if (this.leader && !wasClear) return this.checkLeader(sequence);
    if (this.election) await this.election;
    if (!this.active || sequence !== this.sequence) return;
    return this.begin();
  }

  flushQueuedCheck() {
    if (this.state.phase === 'loaded') {
      this.queuedCheck = false;
      return;
    }
    if (!this.active || !this.queuedCheck || this.action || this.gateRelease || this.running || this.reserving) return;
    this.queuedCheck = false;
    void this.requestCheck();
  }

  finishAction(action) {
    if (this.action !== action) return;
    this.action = null;
    if (this.queuedCheck) this.flushQueuedCheck();
    else if (this.active && action.invalid && this.state.phase === 'checking') {
      this.timer = this.setTimer(() => { this.timer = null; void this.checkNow(); }, 1000);
    }
  }

  follow() {
    if (!this.active || this.leader) return;
    return this.checkNow();
  }

  async checkLeader(sequence) {
    if (this.running) return this.running;
    const operation = (async () => {
      this.coordinator.holdSync('checking');
      this.publish('checking');
      const attempt = ++this.attempt;
      const controller = new AbortController();
      let deadline = null;
      let cancel = null;
      let probe = null;
      try {
        if (this.probe) throw new CloudBackupError('The earlier cloud check is still waiting for a response.', 'unavailable');
        probe = (async () => {
          const current = () => this.active && this.leader && sequence === this.sequence
            && attempt === this.attempt && !controller.signal.aborted;
          const assertCurrent = () => {
            if (!current()) throw new CloudBackupError('The cloud check is no longer current. Check again.', 'raced');
          };
          await this.recoverPending(sequence, attempt, controller.signal);
          await this.current(sequence, attempt);
          assertCurrent();
          if (!this.isOnline()) throw new CloudBackupError('The cloud check needs a connection. Try again when online.', 'offline');
          if (this.isBlocked()) throw new CloudBackupError('Finish recovery before checking cloud progress.', 'paused');
          const snapshot = await this.capture();
          const digest = await personalDigest(snapshot.backup, this.cryptoProvider);
          const remembered = await this.protocol.syncState({ connection: this.context.connection });
          const declinedByStream = await this.protocol.syncDeclines(this.context);
          const history = await this.protocol.keptHistory({ connection: this.context.connection });
          const last = await this.protocol.lastUploaded({ connection: this.context.connection });
          const remotes = await this.protocol.discoverSync(this.context);
          await this.current(sequence, attempt);
          assertCurrent();
          const after = await this.capture();
          assertCurrent();
          if (after.backup.digest !== snapshot.backup.digest || this.isBlocked()) {
            throw new CloudBackupError('Saved data changed during the cloud check. Check again.', 'raced');
          }
          const result = compareCloudBackups({
            ownStream: this.context.stream, localDigest: digest, localEmpty: isEmpty(snapshot.backup), remotes,
            matchedDigest: remembered?.matchedDigest ?? null, declinedDigest: remembered?.declinedDigest ?? null,
            declinedByStream,
            keptDigest: remembered?.kept?.personalDigest ?? null, lastUploadedDigest: last?.personalDigest ?? null,
          });
          const comparison = {
            matchedDigest: remembered?.matchedDigest ?? null, declinedDigest: remembered?.declinedDigest ?? null,
            declinedByStream,
            keptDigest: remembered?.kept?.personalDigest ?? null, lastUploadedDigest: last?.personalDigest ?? null,
          };
          await this.current(sequence, attempt);
          assertCurrent();
          if (this.isBlocked() || !this.snapshotCurrent(after.witness)) {
            throw new CloudBackupError('Saved data changed during the cloud check. Check again.', 'raced');
          }
          this.retryCount = 0;
          this.kept = remembered?.kept ?? null;
          this.historyUnknown = history.unknown;
          if (result.offer) {
            this.offerWatchCount = 0;
            const listing = remotes.map(({ id, name, stream, generation, listedSize }) =>
              ({ id, name, stream, generation, size: listedSize }));
            const offer = {
              kind: result.kind, quiet: this.interacted, remote: result.offer,
              local: localFacts(after.backup), localDigest: digest, localContentDigest: after.backup.digest,
              othersDiffering: result.othersDiffering, epoch: this.epoch, comparison, listing,
              keepLocal: !isEmpty(after.backup) || Boolean(this.kept), priorKept: this.kept,
            };
            this.coordinator.holdSync('awaiting-choice');
            this.publish('offer', offer);
            this.scheduleOfferWatch();
            this.announce();
            return;
          }
          if (result.observedMatch) {
            await this.protocol.rememberSync({
              ...this.context, matchedDigest: digest,
              authorize: current, signal: controller.signal,
            });
            assertCurrent();
            await this.current(sequence, attempt);
            assertCurrent();
          }
          if (this.reserving) {
            this.publish('ready');
            return;
          }
          await this.releaseGate(sequence, attempt, {
            authorize: () => current() && !this.isBlocked() && this.snapshotCurrent(after.witness),
            signal: controller.signal,
          });
          if ((result.observedMatch || remembered?.matchedDigest === digest || remembered?.kept)
            && last?.personalDigest !== digest) {
            this.coordinator.retry();
          }
        })();
        this.probe = probe;
        void probe.then(() => { if (this.probe === probe) this.probe = null; }, () => {
          if (this.probe === probe) this.probe = null;
        });
        const timeout = new Promise((resolve, reject) => {
          deadline = this.setTimer(() => {
            controller.abort();
            if (this.gateRelease) this.holdUnconfirmed = true;
            reject(new CloudBackupError('The cloud check took too long. Try again.', 'timeout'));
          }, CLOUD_SYNC_CHECK_TIMEOUT_MS);
        });
        const stopped = new Promise((resolve, reject) => {
          cancel = () => {
            controller.abort();
            reject(new CloudBackupError('The cloud check is no longer current.', 'raced'));
          };
          this.cancelCheck = cancel;
        });
        await Promise.race([probe, timeout, stopped]);
      } catch (error) {
        if (this.active && sequence === this.sequence && attempt === this.attempt) {
          this.attempt += 1;
          this.fail(error);
        }
      } finally {
        if (deadline !== null) this.clearTimer(deadline);
        if (this.cancelCheck === cancel) this.cancelCheck = null;
        if (controller.signal.aborted && this.probe === probe) this.probe = null;
      }
    })();
    this.running = operation;
    try { await operation; }
    finally {
      if (this.running === operation) this.running = null;
      this.flushQueuedCheck();
    }
  }

  async recoverPending(sequence, attempt = this.attempt, signal) {
    const authorized = () => this.active && this.leader && sequence === this.sequence
      && attempt === this.attempt && !signal?.aborted;
    const assertCurrent = () => {
      if (!authorized()) throw new CloudBackupError('The cloud check is no longer current. Check again.', 'raced');
    };
    await this.current(sequence, attempt);
    assertCurrent();
    const gate = await this.protocol.syncGate(this.context);
    assertCurrent();
    if (!gate?.pending) return;
    const stream = gate.pending.stream;
    const declined = stream === undefined
      ? (await this.protocol.syncState({ connection: this.context.connection }))?.declinedDigest ?? null
      : (await this.protocol.syncDeclines({ ...this.context, signal })).find((entry) => entry.stream === stream)?.digest ?? null;
    if (declined !== gate.pending.previous && declined !== gate.pending.intended) {
      throw new CloudBackupError('The earlier cloud choice could not be checked, so backups stay paused.', 'raced');
    }
    if (declined !== gate.pending.previous) {
      if (stream === undefined) {
        await this.protocol.rememberSync({ ...this.context, declinedDigest: gate.pending.previous, authorize: authorized, signal });
      } else {
        await this.protocol.rememberDecline({
          ...this.context, remoteStream: stream, digest: gate.pending.previous, expected: gate.pending.intended,
          authorize: authorized, signal,
        });
      }
    }
    assertCurrent();
    await this.current(sequence, attempt);
    assertCurrent();
    await this.protocol.setSyncGate({
      ...this.context, epoch: this.epoch, held: true, pending: null, authorize: authorized, signal,
    });
  }

  async releaseGate(sequence, attempt = this.attempt, options = {}) {
    if (this.gateRelease) throw new CloudBackupError('The cloud check is already finishing. Check again.', 'raced');
    const { pendingOnFailure, signal, ...gateOptions } = options;
    const context = { ...this.context };
    const epoch = this.epoch;
    const release = { controller: new AbortController(), committed: false };
    const cancel = () => release.controller.abort();
    if (signal?.aborted) cancel();
    else signal?.addEventListener('abort', cancel, { once: true });
    this.gateRelease = release;
    try {
      await this.protocol.exclusive(async () => {
        let abort;
        const stopped = new Promise((resolve, reject) => {
          abort = () => reject(new CloudBackupError('The cloud choice changed. Check again.', 'raced'));
          if (release.controller.signal.aborted) abort();
          else release.controller.signal.addEventListener('abort', abort, { once: true });
        });
        try {
          await Promise.race([(async () => {
            await this.current(sequence, attempt);
            if (release.controller.signal.aborted) {
              throw new CloudBackupError('The cloud choice changed. Check again.', 'raced');
            }
            if (gateOptions.authorize && !gateOptions.authorize()) {
              throw new CloudBackupError('The cloud choice changed. Check again.', 'raced');
            }
            this.marker.release(epoch);
            await this.protocol.setSyncGate({
              ...context, epoch, held: false, ...gateOptions, signal: release.controller.signal,
              onCommitted: () => { release.committed = true; },
            });
          })(), stopped]);
        } catch (error) {
          if (release.committed && this.active && sequence === this.sequence && epoch === this.epoch) {
            const repair = new AbortController();
            let repairDeadline;
            try {
              let markerError = null;
              try { this.marker.arm(epoch); } catch (markerFailure) { markerError = markerFailure; }
              const timeout = new Promise((resolve, reject) => {
                repairDeadline = this.setTimer(() => {
                  repair.abort();
                  reject(new CloudBackupError('The cloud check took too long. Try again.', 'timeout'));
                }, CLOUD_SYNC_CHECK_TIMEOUT_MS);
              });
              await Promise.race([
                this.protocol.setSyncGate({
                  ...context, epoch, held: true,
                  ...(pendingOnFailure === undefined ? {} : { pending: pendingOnFailure }),
                  authorize: () => this.active && this.leader && sequence === this.sequence && epoch === this.epoch
                    && !repair.signal.aborted && !release.controller.signal.aborted,
                  signal: repair.signal,
                }),
                stopped,
                timeout,
              ]);
              if (markerError) throw markerError;
            } catch {
              if (this.active && this.leader && sequence === this.sequence && epoch === this.epoch) {
                this.uncertainPending = pendingOnFailure ?? null;
                this.holdUnconfirmed = true;
              }
              throw new CloudBackupError(HOLD_UNCONFIRMED, 'hold-unconfirmed');
            } finally {
              repair.abort();
              this.clearTimer(repairDeadline);
            }
          }
          throw error;
        } finally {
          release.controller.signal.removeEventListener('abort', abort);
        }
      }, { signal: release.controller.signal });
      if (!this.active || sequence !== this.sequence) return;
      this.coordinator.releaseSync();
      this.publish('clear');
      this.announce();
      this.releaseLease?.();
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (this.gateRelease === release) this.gateRelease = null;
      this.flushQueuedCheck();
    }
  }

  async restoreUnconfirmed(action = null) {
    const sequence = this.sequence;
    const epoch = this.epoch;
    const pending = this.uncertainPending;
    try {
      await this.armGate(sequence, {
        epoch, force: true, ...(pending === null ? {} : { pending }),
        authorize: () => this.leader && epoch === this.epoch && (!action || this.actionCurrent(action)),
      });
      if (this.active && this.leader && sequence === this.sequence && epoch === this.epoch
        && (!action || this.actionCurrent(action))) {
        this.uncertainPending = null;
        this.holdUnconfirmed = false;
      } else {
        throw new CloudBackupError('The cloud choice changed. Check again.', 'raced');
      }
    } catch (error) {
      if (error?.code === 'raced') throw error;
      throw new CloudBackupError(HOLD_UNCONFIRMED, 'hold-unconfirmed');
    }
  }

  fail(error, action = null) {
    this.coordinator.holdSync('check-failed');
    const failure = this.holdUnconfirmed ? new CloudBackupError(HOLD_UNCONFIRMED, 'hold-unconfirmed') : error;
    this.publish('failed', null, failure?.message ?? 'Cloud progress could not be checked. Try again.', failure?.code ?? null, action);
    this.scheduleRetry();
  }

  actionCurrent(action) {
    return this.active && this.leader && this.action === action && !action.invalid
      && action.sequence === this.sequence && action.attempt === this.attempt && action.epoch === this.epoch;
  }

  assertActionCurrent(action) {
    if (!this.actionCurrent(action)) throw new CloudBackupError('The cloud choice changed. Check again.', 'raced');
  }

  async assertAction(action) {
    this.assertActionCurrent(action);
    await this.current(action.sequence, action.attempt);
    this.assertActionCurrent(action);
  }

  async validateOffer(action) {
    await this.assertAction(action);
    if (this.isBlocked()) throw new CloudBackupError('Finish recovery before choosing cloud progress.', 'paused');
    const snapshot = await this.capture();
    const digest = await personalDigest(snapshot.backup, this.cryptoProvider);
    if (snapshot.backup.digest !== action.offer.localContentDigest || digest !== action.offer.localDigest
      || !this.snapshotCurrent(snapshot.witness)) {
      throw new CloudBackupError('Saved data changed, so the earlier cloud choice was withdrawn.', 'raced');
    }
    const remembered = await this.protocol.syncState({ connection: this.context.connection });
    if (canonical(remembered?.kept ?? null) !== canonical(action.offer.priorKept)) {
      throw new CloudBackupError('The kept cloud copy changed, so the earlier choice was withdrawn. Check again.', 'raced');
    }
    const remotes = await this.protocol.discoverSync(this.context);
    await this.assertAction(action);
    const after = await this.capture();
    if (after.backup.digest !== snapshot.backup.digest || !this.snapshotCurrent(after.witness) || this.isBlocked()) {
      throw new CloudBackupError('Saved data changed, so the earlier cloud choice was withdrawn.', 'raced');
    }
    const result = compareCloudBackups({
      ownStream: this.context.stream, localDigest: digest, localEmpty: isEmpty(snapshot.backup),
      remotes, ...action.offer.comparison,
    });
    if (!result.offer || canonical(result.offer) !== canonical(action.offer.remote)
      || result.othersDiffering !== action.offer.othersDiffering) {
      throw new CloudBackupError('The cloud backup changed, so the earlier choice was withdrawn. Check again.', 'raced');
    }
    return after;
  }

  async runOffer(actionName, operation) {
    if (!this.active || !this.leader || this.state.phase !== 'offer' || this.action) {
      return { ok: false, error: 'That cloud choice is no longer available. Check again.' };
    }
    const action = {
      sequence: this.sequence, attempt: this.attempt, epoch: this.epoch, offer: this.state.offer, invalid: false,
    };
    this.action = action;
    this.notice = null;
    this.cancelTimer();
    this.publish('working', action.offer);
    try {
      return (await operation(action)) ?? { ok: true };
    } catch (error) {
      if (this.active && action.sequence === this.sequence && this.action === action
        && (!action.invalid || error?.code === 'hold-unconfirmed')) this.fail(error, actionName);
      return { ok: false, error: error?.message ?? 'The cloud choice could not be completed. Check again.' };
    } finally {
      this.finishAction(action);
    }
  }

  async keepOffer() {
    return this.runOffer('keep', async (action) => {
      let pending = false;
      try {
        await this.validateOffer(action);
        await this.assertAction(action);
        const remoteStream = action.offer.remote.stream;
        const previous = action.offer.comparison.declinedByStream.find((entry) => entry.stream === remoteStream)?.digest ?? null;
        const decision = { stream: remoteStream, previous, intended: action.offer.remote.digest };
        await this.protocol.setSyncGate({
          ...this.context, epoch: action.epoch, held: true,
          pending: decision,
        });
        pending = true;
        await this.assertAction(action);
        await this.protocol.rememberDecline({
          ...this.context, remoteStream, digest: decision.intended, expected: previous,
        });
        const snapshot = await this.validateOffer(action);
        if (action.offer.othersDiffering > 0) {
          await this.protocol.setSyncGate({
            ...this.context, epoch: action.epoch, held: true, pending: null,
            authorize: () => this.actionCurrent(action) && this.snapshotCurrent(snapshot.witness),
          });
          pending = false;
          await this.checkLeader(action.sequence);
          return;
        }
        await this.releaseGate(action.sequence, action.attempt, {
          pending: null, authorize: () => this.actionCurrent(action) && this.snapshotCurrent(snapshot.witness),
          pendingOnFailure: decision,
        });
        pending = false;
      } catch (error) {
        if (error?.code !== 'hold-unconfirmed' && pending && this.active && this.leader
          && action.sequence === this.sequence && action.attempt === this.attempt) {
          try { await this.recoverPending(action.sequence, action.attempt); }
          catch {
            throw new CloudBackupError('The cloud choice could not be confirmed, so backups stay paused. Check again.', 'storage');
          }
        }
        throw error;
      }
    });
  }

  async overrideFailure() {
    if (!this.active || this.state.phase !== 'failed' || this.action) {
      return { ok: false, error: 'The failed cloud check is no longer available. Check again.' };
    }
    if (!this.leader) {
      const sequence = this.sequence;
      this.coordinator.holdSync('checking');
      this.publish('checking');
      await this.begin();
      if (!this.active || sequence !== this.sequence) {
        return { ok: false, error: 'The cloud choice changed. Check again.' };
      }
      if (this.state.phase === 'clear') return { ok: true };
      if (this.state.phase === 'offer') {
        return { ok: false, error: 'Different cloud progress was found. Review it before continuing.' };
      }
      if (!this.leader || this.state.phase !== 'failed') {
        return { ok: false, error: 'Another cloud check is still running. Check again.' };
      }
    }
    const repair = this.holdUnconfirmed;
    const action = { sequence: this.sequence, attempt: this.attempt, epoch: this.epoch, invalid: false };
    this.action = action;
    this.notice = null;
    this.cancelTimer();
    this.publish('working');
    try {
      if (repair) {
        await this.restoreUnconfirmed(action);
        await this.assertAction(action);
        await this.recoverPending(action.sequence, action.attempt);
      }
      await this.assertAction(action);
      await this.releaseGate(action.sequence, action.attempt, { authorize: () => this.actionCurrent(action) });
      return { ok: true };
    } catch (error) {
      if (this.active && action.sequence === this.sequence && this.action === action
        && (!action.invalid || error?.code === 'hold-unconfirmed')) this.fail(error, 'override');
      return { ok: false, error: error?.message ?? 'Backups could not be resumed. Check again.' };
    } finally {
      this.finishAction(action);
    }
  }

  async loadOffer() {
    return this.runOffer('load', async (action) => {
      if (!this.restore || !this.restoreReady) {
        throw new CloudBackupError('Cloud restore cannot be checked, so nothing was replaced.', 'unsupported');
      }
      const local = await this.validateOffer(action);
      const offered = action.offer.remote;
      await this.protocol.fetchBackup(offered, { connection: this.context.connection, expectedByteDigest: offered.byteDigest });
      await this.assertAction(action);
      const readiness = await this.restoreReady();
      if (!readiness?.ok) throw new CloudBackupError(readiness?.error ?? 'Cloud restore is not ready, so nothing was replaced.', 'paused');
      await this.assertAction(action);
      const kept = !action.offer.keepLocal ? null : await this.protocol.prepareKeptSnapshot({
        ...this.context, snapshot: local, personalDigest: action.offer.localDigest,
        authorize: async () => {
          await this.assertAction(action);
          if (this.isBlocked() || !this.snapshotCurrent(local.witness)) {
            throw new CloudBackupError('Saved data changed, so the earlier cloud choice was withdrawn.', 'raced');
          }
        },
      });
      await this.assertAction(action);
      if (kept && (kept.contentDigest !== action.offer.localContentDigest || kept.personalDigest !== action.offer.localDigest)) {
        throw new CloudBackupError('The cloud safety copy could not be verified, so nothing was replaced.', 'verify');
      }
      await this.validateOffer(action);
      const selected = await this.protocol.fetchBackup(offered, {
        connection: this.context.connection, expectedByteDigest: offered.byteDigest,
      });
      await this.assertAction(action);
      const restored = await this.restore(selected.text, {
        expectedPriorDigest: action.offer.localContentDigest,
        assertAuthorized: () => this.assertAction(action),
        assertStillAuthorized: () => this.assertActionCurrent(action),
        onApplyStart: () => { this.assertActionCurrent(action); action.restoring = true; },
      });
      if (!restored?.ok) {
        throw new CloudBackupError(restored?.error ?? 'Cloud progress could not be loaded. Recovery may be available.', 'restore');
      }
      let warning = null;
      try {
        this.assertActionCurrent(action);
        if (kept) this.kept = await this.protocol.activateKept({
          ...this.context, kept, authorize: () => this.actionCurrent(action), prune: this.isOnline(),
        });
        await this.assertAction(action);
        await this.protocol.rememberSync({ ...this.context, matchedDigest: offered.digest });
      } catch {
        warning = 'Progress was loaded, but the cloud check is still pending. Backups stay paused until it can be checked again.';
      }
      if (this.active && action.sequence === this.sequence) {
        this.coordinator.holdSync('loaded');
        this.publish('loaded', null, warning);
      }
      return { ok: true, changed: true, ...(warning ? { warning } : {}) };
    });
  }

  async goBack() {
    if (!this.active || this.state.phase !== 'clear' || !this.kept || this.action || this.reserving || !this.restore || !this.restoreReady) {
      return { ok: false, error: 'The kept cloud copy is no longer available. Check again.' };
    }
    const target = this.kept;
    this.reserving = true;
    try {
      await this.requestCheck();
      if (!this.active || !this.leader || this.state.phase !== 'ready'
        || canonical(this.kept) !== canonical(target)) {
        return { ok: false, error: 'Cloud progress changed. Review the current check before going back.' };
      }
      const action = { sequence: this.sequence, attempt: this.attempt, epoch: this.epoch, invalid: false };
      this.action = action;
      this.publish('working');
      try {
        await this.assertAction(action);
        if (this.isBlocked()) throw new CloudBackupError('Finish recovery before going back.', 'paused');
        const readiness = await this.restoreReady();
        if (!readiness?.ok) throw new CloudBackupError(readiness?.error ?? 'Cloud restore is not ready, so nothing was replaced.', 'paused');
        await this.assertAction(action);
        const snapshot = await this.capture();
        const digest = await personalDigest(snapshot.backup, this.cryptoProvider);
        const prepared = await this.protocol.prepareKeptRestore({
          ...this.context, kept: target, snapshot, personalDigest: digest,
          authorize: async () => {
            await this.assertAction(action);
            if (this.isBlocked() || !this.snapshotCurrent(snapshot.witness)) {
              throw new CloudBackupError('Saved data changed, so the earlier cloud choice was withdrawn.', 'raced');
            }
          },
        });
        await this.assertAction(action);
        const remotes = await this.protocol.discoverSync(this.context);
        const after = await this.capture();
        const latest = await this.protocol.syncState({ connection: this.context.connection });
        const declinedByStream = await this.protocol.syncDeclines(this.context);
        const last = await this.protocol.lastUploaded({ connection: this.context.connection });
        await this.assertAction(action);
        if (after.backup.digest !== snapshot.backup.digest || !this.snapshotCurrent(after.witness) || this.isBlocked()) {
          throw new CloudBackupError('Saved data changed, so the earlier cloud choice was withdrawn.', 'raced');
        }
        const comparison = compareCloudBackups({
          ownStream: this.context.stream, localDigest: digest, localEmpty: isEmpty(snapshot.backup), remotes,
          matchedDigest: latest?.matchedDigest ?? null, declinedDigest: latest?.declinedDigest ?? null,
          declinedByStream,
          keptDigest: latest?.kept?.personalDigest ?? null, lastUploadedDigest: last?.personalDigest ?? null,
        });
        if (comparison.offer) throw new CloudBackupError('Cloud progress changed. Review the new choice before going back.', 'raced');
        const restored = await this.restore(prepared.target.text, {
          expectedPriorDigest: snapshot.backup.digest, assertAuthorized: () => this.assertAction(action),
          assertStillAuthorized: () => this.assertActionCurrent(action),
          onApplyStart: () => { this.assertActionCurrent(action); action.restoring = true; },
        });
        if (!restored?.ok) {
          throw new CloudBackupError(restored?.error ?? 'The kept progress could not be loaded. Recovery may be available.', 'restore');
        }
        let warning = null;
        try {
          this.assertActionCurrent(action);
          this.kept = await this.protocol.activateKept({
            ...this.context, kept: prepared.replacement, authorize: () => this.actionCurrent(action),
            prune: this.isOnline(),
          });
        } catch {
          warning = 'Progress was loaded, but the cloud check is still pending. Backups stay paused until it can be checked again.';
        }
        if (this.active && action.sequence === this.sequence) {
          this.coordinator.holdSync('loaded');
          this.publish('loaded', null, warning);
        }
        return { ok: true, changed: true, ...(warning ? { warning } : {}) };
      } catch (error) {
        if (error?.code === 'gone') this.kept = null;
        if (this.active && action.sequence === this.sequence && this.action === action && !action.invalid) this.fail(error, 'back');
        return { ok: false, error: error?.message ?? 'The kept cloud copy could not be loaded. Check again.' };
      } finally {
        this.finishAction(action);
      }
    } finally {
      this.reserving = false;
      this.flushQueuedCheck();
    }
  }

  markActivity() {
    this.interacted = true;
    if (this.state.phase === 'offer' && !this.state.offer.quiet) {
      this.publish('offer', { ...this.state.offer, quiet: true });
    }
  }

  savedChanged() {
    if (!this.active) return;
    const release = this.gateRelease;
    if (release && !release.committed) release.controller.abort();
    if (release?.committed || !['offer', 'working'].includes(this.state.phase)) return;
    if (this.action) this.action.invalid = true;
    this.notice = 'Saved data changed, so the earlier cloud choice was withdrawn.';
    this.coordinator.holdSync('checking');
    this.publish('checking');
    this.announce();
    this.cancelTimer();
    if (this.action) return;
    this.timer = this.setTimer(() => {
      this.timer = null;
      void this.checkNow();
    }, 1000);
  }
}
