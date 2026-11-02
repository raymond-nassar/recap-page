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
import { CloudBackupError, CloudBackupProtocol, cloudDeviceLabel, isUnreadableRecord } from './cloudProtocol.js';
import { CloudBackupCoordinator } from './cloudCoordinator.js';
import { cloudErrorText } from './cloudCopy.js';

export const CLOUD_BACKUP_CHANNEL = 'mrt.cloud-backup.changes.v1';
// How often the card asks whether a sign-in in the browser has finished. The host answers from memory.
export const CLOUD_SIGN_IN_POLL_MS = 2000;
// Host states that hold a connection.
const LINKED = new Set(['connected', 'needs-sign-in']);
const NOT_ANSWERING = Object.freeze({ enabled: false, transient: true });
const OFF = Object.freeze({ phase: 'off', code: null, retryAt: null, lastUploadAt: null });
const IDLE = Object.freeze({ state: 'idle', connection: null, result: null, message: null, code: null });
const NOT_LINKED = 'Cloud backup is not connected to an account right now, so nothing was changed.';
// The owner's words, approved 2026-10-28 (stage 3 review, S3a-1), and pinned in the privacy copy tests.
export const ERASE_HOST_SILENT = 'The Recap Page app did not answer, so cloud backup may still be connected for every browser profile on this Windows account.';
// The same, from the Android app, whose sign-in reaches only this device (#810, P03-T03).
export const ERASE_HOST_SILENT_DEVICE = 'The Recap Page app did not answer, so cloud backup may still be connected on this device.';
// Why an erase did not start, after "Nothing was erased." (stage 4 review, S4c-1). The owner's words,
// approved 2026-10-29 with an edit, and pinned in the privacy copy tests.
// Added to that refusal when the consent the erase set aside could not be put back.
export const ERASE_LEFT_OFF = 'Automatic backup is now off until you turn it on again.';
export const ERASE_NOT_STOPPED = 'Automatic backup could not be stopped first, so erasing now could let a backup of the erased data replace your earlier backups.';
// The host states the erase question names as disconnected, as cloudEraseNote reads them.
const DISCONNECT_NAMED = new Set(['connected', 'needs-sign-in', 'signing-in', 'unavailable']);

// The Android app's approved name avoids exposing the unfamiliar WebView brand. Windows keeps the
// browser's client hints, or the protocol's default where there are none.
export function browserDeviceLabel(nav = globalThis.navigator, scope) {
  if (scope === 'device') return 'Recap Page on Android';
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
  device = transport?.device ?? browserDeviceLabel(globalThis.navigator, transport?.scope), channel = null, setTimer = (callback, ms) => globalThis.setTimeout(callback, ms),
  coordinator: coordinatorOptions = {}, onChange = () => {},
} = {}) {
  if (['status', 'connect', 'disconnect'].some((operation) => typeof transport?.[operation] !== 'function')) {
    throw new TypeError('Cloud backup on this page needs a transport that reports the account and can connect and disconnect it.');
  }
  // Where a sign-in reaches: every browser profile on the Windows account the host runs in, or, from the
  // Android app, this device alone. The card and the erase say which.
  const scope = transport.scope === 'device' ? 'device' : 'profiles';
  let status = null;
  let record = null;
  let recordProblem = null;
  let recordUnreadable = false;
  let coordinator = null;
  let discovery = IDLE;
  let discoveries = 0;
  let poll = null;
  let queue = Promise.resolve();
  // Set from just before an erase writes until it has finished, so nothing restarts backups meanwhile,
  // whatever another tab says.
  let held = false;
  let wasRunning = false;
  // Whether the erase question named the disconnect, as the card read the host when it was asked.
  let promised = false;
  // The erase's own part of the record: its setting consent aside under the worker lock, whether it did,
  // and the lock's release (stage 3 review, S3a-7).
  let erasing = null;
  let setAside = false;
  let releaseErase = null;
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
      // The services this device can sign in to; the card offers a choice only when there are several.
      providers: enabled() && Array.isArray(status.providers) ? status.providers : [],
      host: enabled() ? status.state : agreed ? 'not-answering' : 'absent',
      account: enabled() ? status.account : null,
      message: enabled() ? status.message : null,
      // Why this browser is asked again, when the host knows: the person deleted the app folder.
      reason: enabled() ? status.reason ?? null : null,
      signInExpiresAt: enabled() ? status.signInExpiresAt : null,
      ...(enabled() && status.waitingForUpload === true ? { waitingForUpload: true } : {}),
      agreed: agreed !== null,
      on: isOn(),
      askedAgain: Boolean(agreed && linked && !isOn()),
      // Consent an erase set aside and has not put back or forgotten: running in another tab, or a page
      // that died during it, which nothing resumes by itself (stage 3 review, S3a-7).
      suspended: Boolean(record && record.consent === null && record.suspended),
      hasStream: record !== null,
      recordProblem,
      // Turning on starts a new stream only for a record that fails its checks (stage 3 review, S3b-7).
      recordUnreadable,
      backup: coordinator?.state ?? OFF,
      discovery,
      scope,
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
      recordUnreadable = false;
      record = null;
      // A build without cloud backup never opens the database: it is read only where it already exists,
      // or where the browser cannot say and the host answers.
      if (exists === true || (exists === null && enabled())) {
        try { record = await protocol.record(); } catch (error) {
          recordProblem = error?.message ?? null;
          recordUnreadable = isUnreadableRecord(error);
        }
      }
      // A host that did not answer, or was too busy to, is not a host that said no: backups this browser
      // agreed to keep running, or start, and their own backoff carries the outage until it answers. Only
      // a definite answer stops them (stage 3 review, S3a-3).
      const waiting = status.transient === true && consent() !== null;
      if ((isOn() || waiting) && !held) {
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
        // Not again where the card, or another tab's news, already set this connection discovering.
        if (status?.state === 'connected' && !isOn() && discovery.connection !== status.connection) void discover();
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
    // already agreed, which its record says, and a browser without consent makes no request at all, so
    // one that turned backups off, deleted its backups or was erased asks nothing (stage 3 review, S3a-6).
    // A record that cannot be read is said when Backup & settings opens.
    async resume() {
      if (await recordExists() !== true) return model ?? compose();
      const held = await protocol.record().catch(() => null);
      if (!held?.consent) return model ?? compose();
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

    // Signs in to the service the person chose, or the transport's own when there was no choice to make.
    async connect(provider) {
      status = await (provider === undefined ? transport.connect() : transport.connect({ provider }));
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

    // Before an erase writes anything, so the erased state is never backed up as the newest copy: this
    // page's backups stop at once, then the worker lock is taken, after any backup another tab has under
    // way, and this browser's consent is set aside in the shared record. Until the erase forgets or
    // restores the record, no tab's backup runs and none can take a number, even one where backups are
    // turned on meanwhile (stage 3 review, S3a-7). A page that dies during the erase releases the lock
    // with it and leaves consent set aside, which the card says. Callers await this before the first write.
    // It resolves to null once the record is confirmed to give no tab a number: no consent in it, consent
    // set aside and read back, or a record that fails its checks, from which no tab takes one and which the
    // erase forgets. Otherwise it resolves to why, and the caller erases nothing, because the lock alone ends
    // with the page that holds it (stage 4 review, S4c-1). Before that it puts back any consent it set aside,
    // and when it cannot, why also says automatic backup is now off (#996, S5-1).
    beforeErase() {
      held = true;
      wasRunning = Boolean(coordinator?.active);
      promised = enabled() && DISCONNECT_NAMED.has(status.state);
      coordinator?.stop();
      erasing = (async () => {
        const exists = await recordExists();
        if (exists === true || (exists === null && (record !== null || enabled()))) {
          let why = null;
          let mine = false;
          try {
            releaseErase = await protocol.hold();
            setAside = await protocol.suspendConsent(() => { mine = true; });
          } catch (error) {
            // Only a record that fails its checks, read under the lock, lets the erase go on: no tab takes a
            // number from it, and the erase forgets it.
            if (!(releaseErase && isUnreadableRecord(error))) {
              why = error instanceof CloudBackupError ? `${ERASE_NOT_STOPPED} ${cloudErrorText(error.message, scope)}` : ERASE_NOT_STOPPED;
            }
          }
          if (why !== null) {
            let resume = wasRunning;
            // Setting consent aside can commit before its read-back fails, so whatever is still set aside goes
            // back under the same lock, but only when this erase found consent to set aside. Consent an earlier
            // erase left set aside when its page died stays so, because putting it back would back up partly
            // erased data (S3a-7). When even that fails, the refusal says backups are off rather than leaving
            // it to be found later (#996, S5-1).
            if (releaseErase && mine) {
              try {
                if (await protocol.resumeConsent()) {
                  resume = true;
                  announce();
                }
              } catch {
                // A resume that failed only because storage is failing may have nothing to put back: the
                // sentence is added only when the record still shows consent set aside, or cannot be read.
                let off = true;
                try {
                  const now = await protocol.record();
                  off = Boolean(now && now.consent === null && now.suspended !== null);
                } catch { /* unread, so it may be off */ }
                if (off) {
                  why = `${why} ${ERASE_LEFT_OFF}`;
                  resume = true;
                  announce();
                }
              }
            }
            releaseErase?.();
            releaseErase = null;
            held = false;
            wasRunning = false;
            promised = false;
            if (resume) await refresh();
            return why;
          }
        }
        if (setAside) announce();
        return null;
      })();
      return erasing;
    },

    // After the erase: when it erased the reading data, this browser forgets cloud backup and the host
    // its sign-in, for every profile, as the erase question said. When it did not, backups go on.
    async afterErase(erased) {
      // Whatever beforeErase started finishes first, so the lock and the consent put back are its own.
      await erasing;
      erasing = null;
      const resume = wasRunning;
      const named = promised;
      const restore = setAside;
      const release = releaseErase ?? (() => {});
      wasRunning = false;
      promised = false;
      setAside = false;
      releaseErase = null;
      if (!erased) {
        // Nothing was erased: the same consent goes back before any tab's backup may run again.
        if (restore) await protocol.resumeConsent().catch(() => {});
        release();
        held = false;
        if (restore) announce();
        if (resume || restore) await refresh();
        return { ok: true, problems: [] };
      }
      // A build without cloud backup, in a browser that never had it: nothing to forget, and no request.
      if (!enabled() && record === null && await recordExists() !== true) {
        release();
        held = false;
        return { ok: true, problems: [] };
      }
      const problems = [];
      let kept = false;
      let had = record !== null;
      const exists = await recordExists();
      if (exists === true || (exists === null && (record !== null || enabled()))) {
        // A record that cannot be read was still this browser's cloud backup.
        had = had || await protocol.record().then((value) => value !== null, () => true);
        try { await protocol.forget(); } catch (error) {
          kept = true;
          problems.push(cloudErrorText(error?.message ?? 'This browser could not forget its cloud backup record.', scope));
          // Consent given in another tab during the erase too, so the erased state is never backed up under it.
          await protocol.withdrawConsent().catch(() => {});
        }
      }
      // Forgotten, withdrawn, or still set aside as beforeErase confirmed before the first write: this
      // browser's consent gives no tab a number, so the lock goes. Consent the person gave in another tab
      // during the erase, should this browser then be able neither to forget the record nor to withdraw it,
      // is the one case left; the report then says cloud backup may still be on (stage 4 review, S4c-1).
      release();
      // Promised in the question, or this browser had cloud backup: a host that does not answer now, or
      // answers that this build has none, has not been disconnected, and saying nothing would leave that
      // promise silently broken (stage 3 review, S3a-1).
      const expected = named || had;
      if (status === null || enabled() || expected) {
        try {
          const now = await transport.status();
          if (now.enabled && now.state !== 'not-connected') await transport.disconnect();
          else if (!now.enabled && expected) problems.push(scope === 'device' ? ERASE_HOST_SILENT_DEVICE : ERASE_HOST_SILENT);
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
