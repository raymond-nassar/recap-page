// Cloud backup as the page runs it (#810, P02-T05). The protocol decides how backups are stored and the
// coordinator when they are made; this module holds the two together with the transport the page was
// given, and keeps what the Backup & settings card shows of them. Three things belong here because
// neither of the others knows them: whether this build has cloud backup at all, whether this
// installation agreed to back up to the connection the host holds now, and the order of the steps each
// of the person's answers starts.
//
// A build without cloud backup must not change: nothing here runs at startup unless this browser's
// cloud backup record already exists, which indexedDB.databases() says without creating it, and opening
// Backup & settings costs one status request that such a build answers 404.

import { CLOUD_BACKUP_DATABASE } from '../storage.js';
import { CloudBackupError, CloudBackupProtocol, cloudDeviceLabel } from './cloudProtocol.js';
import { CloudBackupCoordinator } from './cloudCoordinator.js';

export const CLOUD_BACKUP_CHANNEL = 'mrt.cloud-backup.changes.v1';
// How often the card asks whether a sign-in in the browser has finished. The host answers from memory.
export const CLOUD_SIGN_IN_POLL_MS = 2000;
// Host states that hold a connection.
const LINKED = new Set(['connected', 'needs-sign-in']);
const NOT_ANSWERING = Object.freeze({ enabled: false });
const OFF = Object.freeze({ phase: 'off', code: null, retryAt: null, lastUploadAt: null });
const IDLE = Object.freeze({ state: 'idle', connection: null, result: null, message: null, code: null });
const NOT_LINKED = 'Cloud backup is not connected to an account right now, so nothing was changed.';

// What other devices see in discovery: the browser's brand and the system it runs on, from the client
// hints Chromium gives every page, or the protocol's default where there are none.
export function browserDeviceLabel(nav = globalThis.navigator) {
  const hints = nav?.userAgentData;
  const brands = Array.isArray(hints?.brands) ? hints.brands.map((entry) => String(entry?.brand ?? '').trim()) : [];
  const brand = brands.find((name) => name && !/^chromium$|^not.?a.?brand$/i.test(name))
    ?? brands.find((name) => /^chromium$/i.test(name)) ?? null;
  const platform = typeof hints?.platform === 'string' && hints.platform.trim() ? hints.platform.trim() : null;
  return cloudDeviceLabel(brand && platform ? `${brand} on ${platform}` : brand ?? platform ?? '');
}

export function createCloudBackup({
  transport, protocol = new CloudBackupProtocol({ transport }), capture, isBlocked = () => false, savedChanges = null,
  databases = () => globalThis.indexedDB?.databases?.(),
  device = browserDeviceLabel(), channel = null, setTimer = (callback, ms) => globalThis.setTimeout(callback, ms),
  coordinator: coordinatorOptions = {}, onChange = () => {},
} = {}) {
  if (['status', 'connect', 'disconnect'].some((operation) => typeof transport?.[operation] !== 'function')) {
    throw new TypeError('Cloud backup on this page needs a transport that reports the account and can connect and disconnect it.');
  }
  let status = null;
  let record = null;
  let recordProblem = null;
  let coordinator = null;
  let discovery = IDLE;
  let discoveries = 0;
  let poll = null;
  let queue = Promise.resolve();
  // Set from just before an erase writes until it has finished, so nothing restarts backups meanwhile,
  // whatever another tab says.
  let held = false;
  let wasRunning = false;
  let model = null;

  const enabled = () => status?.enabled === true;
  const linkedConnection = () => (enabled() && LINKED.has(status.state) && status.connection ? status.connection : null);
  const consent = () => record?.consent ?? null;
  const isOn = () => {
    const agreed = consent();
    return Boolean(agreed && linkedConnection() && agreed.connection === status.connection);
  };

  function compose() {
    const agreed = consent();
    const linked = linkedConnection() !== null;
    return Object.freeze({
      shown: enabled() || agreed !== null,
      provider: (enabled() && status.provider) || agreed?.provider || 'onedrive',
      host: enabled() ? status.state : agreed ? 'not-answering' : 'absent',
      account: enabled() ? status.account : null,
      message: enabled() ? status.message : null,
      signInExpiresAt: enabled() ? status.signInExpiresAt : null,
      agreed: agreed !== null,
      on: isOn(),
      askedAgain: Boolean(agreed && linked && !isOn()),
      hasStream: record !== null,
      recordProblem,
      backup: coordinator?.state ?? OFF,
      discovery,
    });
  }

  function publish() {
    model = compose();
    try { onChange(model); } catch { /* a view's failure changes nothing here */ }
  }

  // true or false when the browser can say whether the record's database exists, null when it cannot.
  async function recordExists() {
    try {
      const listed = await databases();
      return Array.isArray(listed) ? listed.some((entry) => entry?.name === CLOUD_BACKUP_DATABASE) : null;
    } catch {
      return null;
    }
  }

  function backups() {
    if (coordinator) return coordinator;
    coordinator = new CloudBackupCoordinator({
      capture, isBlocked,
      upload: (snapshot) => protocol.upload(snapshot),
      // The connection the host holds at this run, so a backup made under another one never counts here.
      lastUploaded: async () => {
        const now = await transport.status().catch(() => NOT_ANSWERING);
        return protocol.lastUploaded({ connection: now.enabled ? now.connection : null });
      },
      onChange: (state) => {
        publish();
        // Stopped for something the card has to show: another profile reconnected the host, consent was
        // withdrawn in another tab, or the sign-in has to be made again.
        if (state.phase === 'needs-consent' || state.phase === 'needs-sign-in' || (state.phase === 'failed' && state.code === 'refused')) {
          void refresh();
        }
      },
      ...coordinatorOptions,
    });
    // Saved changes are listened for from the first time backups start, so a browser that never turns
    // cloud backup on hears none of them.
    savedChanges?.subscribe(() => coordinator.notify());
    return coordinator;
  }

  // Runs one at a time, each reading everything afresh, so an answer given meanwhile is never lost.
  function refresh() {
    const run = queue.then(async () => {
      const before = status?.state ?? null;
      try { status = await transport.status(); } catch { status = NOT_ANSWERING; }
      const exists = await recordExists();
      recordProblem = null;
      record = null;
      // A build without cloud backup never opens the database: it is read only where it already exists,
      // or where the browser cannot say and the host answers.
      if (exists === true || (exists === null && enabled())) {
        try { record = await protocol.record(); } catch (error) { recordProblem = error?.message ?? null; }
      }
      if (isOn() && !held) {
        const running = backups();
        if (!running.active) running.start();
        // Signed in again after Microsoft asked for it: backups go on at once.
        else if (before !== 'connected' && status.state === 'connected' && running.state.phase === 'needs-sign-in') running.retry();
      } else coordinator?.stop();
      if (discovery.connection !== null && discovery.connection !== linkedConnection()) {
        discoveries += 1;
        discovery = IDLE;
      }
      publish();
      return model;
    });
    queue = run.catch(() => {});
    return run;
  }

  function announce() {
    try { channel?.postMessage('changed'); } catch { /* other tabs catch up when they next look */ }
  }
  if (channel) {
    channel.onmessage = () => { void refresh(); };
    // Listening never keeps anything alive on its own. Node's channel would hold open any process that
    // imports the page's modules, as the tests do; a browser's has no unref, and needs none.
    channel.unref?.();
  }

  function watchSignIn() {
    if (poll !== null || status?.state !== 'signing-in') return;
    poll = setTimer(async () => {
      poll = null;
      await refresh();
      if (status?.state === 'signing-in') watchSignIn();
      else {
        announce();
        if (status?.state === 'connected' && !isOn()) void discover();
      }
    }, CLOUD_SIGN_IN_POLL_MS);
  }

  async function discover() {
    const connection = enabled() && status.state === 'connected' ? status.connection : null;
    if (!connection) return model;
    discoveries += 1;
    const ticket = discoveries;
    discovery = Object.freeze({ ...IDLE, state: 'loading', connection, result: discovery.connection === connection ? discovery.result : null });
    publish();
    let next;
    try {
      next = { ...IDLE, state: 'ready', connection, result: await protocol.discover({ connection }) };
    } catch (error) {
      next = {
        ...IDLE, state: 'failed', connection, code: typeof error?.code === 'string' ? error.code : null,
        message: error?.message ?? 'The backups in this account could not be listed.',
      };
    }
    if (ticket !== discoveries) return model;
    discovery = Object.freeze(next);
    publish();
    if (next.code === 'needs-consent' || next.code === 'not-connected' || next.code === 'needs-sign-in') await refresh();
    return model;
  }

  return {
    get model() { return model ?? compose(); },

    // Backup & settings opened: what the host and this browser hold now, and, for a browser that has not
    // agreed to this connection, what is already in the account.
    async enter() {
      await refresh();
      watchSignIn();
      if (status?.state === 'connected' && !isOn() && discovery.connection !== status.connection) await discover();
      return model;
    },

    // At startup, once saving is open and the page is idle: backups go on only where this browser
    // already agreed, which its record says, and a browser without one makes no request at all.
    async resume() {
      if (await recordExists() !== true) return model ?? compose();
      return refresh();
    },

    refresh,
    discover,

    // Settles once every refresh asked for so far, and any backup under way, has finished.
    async idle() {
      await queue;
      await coordinator?.idle();
      await queue;
    },

    // A saved change of anything a backup holds.
    notify() { coordinator?.notify(); },
    retry() { coordinator?.retry(); },

    async connect() {
      status = await transport.connect();
      publish();
      watchSignIn();
      return model;
    },

    // Consent for the connection the card showed. Should the host hold another one by now, the first
    // backup is refused and this browser is asked again, so consent never reaches an account nobody saw.
    async turnOn() {
      const connection = enabled() && status.state === 'connected' ? status.connection : null;
      if (!connection) throw new CloudBackupError(NOT_LINKED, 'not-connected');
      await protocol.recordConsent({ connection, provider: status.provider ?? 'onedrive', device });
      held = false;
      announce();
      await refresh();
      // The first backup goes at once rather than after the quiet period.
      if (isOn()) coordinator?.retry();
      return model;
    },

    async turnOff() {
      coordinator?.stop();
      try { await protocol.withdrawConsent(); }
      finally {
        announce();
        await refresh();
      }
      return model;
    },

    // A backup chosen in discovery, read and checked again, for the complete restore engine.
    async fetchBackup(copy) {
      const connection = linkedConnection();
      if (!connection) throw new CloudBackupError(NOT_LINKED, 'not-connected');
      return protocol.fetchBackup(copy, { connection });
    },

    // Every file of this installation's stream. Consent is withdrawn first, by the protocol.
    async deleteOwn() {
      const connection = linkedConnection();
      if (!connection) throw new CloudBackupError(NOT_LINKED, 'not-connected');
      coordinator?.stop();
      try { return await protocol.deleteOwnBackups({ connection }); }
      finally {
        announce();
        await refresh();
        if (discovery.state !== 'idle') await discover();
      }
    },

    // The host forgets the sign-in for every browser profile on this Windows account. Files stay.
    async disconnect() {
      coordinator?.stop();
      try { await transport.disconnect(); }
      finally {
        announce();
        await refresh();
      }
      return model;
    },

    // Before an erase writes anything, so the erased state is never backed up as the newest copy.
    beforeErase() {
      held = true;
      wasRunning = Boolean(coordinator?.active);
      coordinator?.stop();
    },

    // After the erase: when it erased the reading data, this browser forgets cloud backup and the host
    // its sign-in, for every profile, as the erase question said. When it did not, backups go on.
    async afterErase(erased) {
      const resume = wasRunning;
      wasRunning = false;
      if (!erased) {
        held = false;
        if (resume) await refresh();
        return { ok: true, problems: [] };
      }
      // A build without cloud backup, in a browser that never had it: nothing to forget, and no request.
      if (!enabled() && record === null && await recordExists() !== true) {
        held = false;
        return { ok: true, problems: [] };
      }
      const problems = [];
      let kept = false;
      const exists = await recordExists();
      if (exists === true || (exists === null && (record !== null || enabled()))) {
        try { await protocol.forget(); } catch (error) {
          kept = true;
          problems.push(error?.message ?? 'This browser could not forget its cloud backup record.');
          // Consent at least, so the erased state is never backed up over what was there before.
          await protocol.withdrawConsent().catch(() => {});
        }
      }
      if (status === null || enabled()) {
        try {
          const now = await transport.status();
          if (now.enabled && now.state !== 'not-connected') await transport.disconnect();
        } catch (error) {
          problems.push(error?.message ?? 'Cloud backup could not be disconnected.');
        }
      }
      discoveries += 1;
      discovery = IDLE;
      // A record that could not be forgotten keeps backups held in this page until the person turns them on.
      held = kept;
      announce();
      await refresh();
      return { ok: problems.length === 0, problems };
    },
  };
}
