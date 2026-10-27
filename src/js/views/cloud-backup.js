import { parseCloudSnapshot } from '../lib/cloudSnapshot.js';

const CONSENT_KEY = 'mrt.cloud.consent.v1';
const HEX = /^[a-f0-9]{64}$/;
const NAMES = { google: 'Google Drive', microsoft: 'OneDrive' };
const UNAVAILABLE = 'Cloud backup is unavailable in this app build. Native provider setup is not qualified or configured. Local backups and reading remain available.';
const PHASES = {
  checking: 'Checking the last remote result…', pending: 'Saved changes are waiting for backup.',
  saving: 'Saving a complete backup…', 'up-to-date': 'All current saved data is backed up.',
  'metadata-only': 'Personal changes are backed up. New metadata will be included with your next saved change.',
  offline: 'Offline. Saved changes remain on this device and will retry while the app is open.',
  'pending-offline': 'Offline. Saved changes remain on this device and will retry while the app is open.',
  'outcome-unknown': 'The last upload result is unknown. It must be reconciled before another upload; newest changes remain queued.',
  'reconnect-required': 'Provider access needs attention. Disconnect, then Connect again. Your local data and remote backups are kept.',
  unavailable: 'Cloud backup cannot run in this environment. Local data is unchanged. Check browser locking and the native provider configuration.',
  paused: 'Backup is paused until local recovery or import review is settled.',
  failed: 'Backup was not confirmed. Retry, or reconnect if provider access needs attention. Local data and previous backups are kept.',
  unknown: 'The previous upload result is unknown. It must be reconciled before another upload.',
};

export function createCloudBackupView({
  elements, el, restore, storage, askConfirm, notify, download,
  startBackup, stopBackup, getBackupState, draftRecovery = () => [],
}) {
  let configuration = null;
  let transport = null;
  let provider = null;
  let account = null;
  let discovery = null;
  let active = false;
  let busy = false;
  let epoch = 0;
  let message = UNAVAILABLE;
  let consent = false;
  let wired = false;

  function status(text, error = false) {
    message = text;
    render();
    if (error) notify('#cloud-report', text, 'error');
  }
  function validStatus(value) {
    if (value?.provider !== provider || !Number.isSafeInteger(value.epoch) || value.epoch < 1
      || !value.account || typeof value.account.id !== 'string' || !value.account.id
      || typeof value.account.label !== 'string' || !value.account.label) throw new Error('connection');
    return value;
  }
  function live(token) {
    if (token !== epoch) throw new Error('cancelled');
  }
  async function disconnectNative() {
    stopBackup();
    if (transport) {
      await transport.disconnect();
      if ((await transport.status()).state !== 'disconnected') throw new Error('disconnect');
    }
    storage.removeItem(CONSENT_KEY);
    transport = null; account = null; discovery = null; active = false; consent = false;
  }
  async function activate(token) {
    live(token);
    stopBackup();
    active = false;
    const value = validStatus(await transport.status());
    live(token);
    if (value.state !== 'connected' || value.phase !== 'active') throw new Error('connection');
    account = value.account;
    await startBackup({
      transport, provider, epoch: value.epoch, label: configuration.label,
      qualification: true, consent: true,
    });
    live(token);
    active = true;
  }
  async function discover(token) {
    const value = await transport.discover();
    live(token);
    if (value?.provider !== provider || !['active', 'awaiting-choice'].includes(value.state)
      || !Number.isSafeInteger(value.epoch) || value.epoch < 1
      || !Array.isArray(value.streams) || value.streams.length > 128
      || !Array.isArray(value.rejected) || value.rejected.length > 128
      || value.state === 'awaiting-choice' && !HEX.test(value.discoveryId)) throw new Error('discovery');
    for (const stream of value.streams) {
      if (!HEX.test(stream?.streamId) || !stream.current) throw new Error('discovery');
      for (const summary of [stream.current, stream.previous].filter(Boolean)) {
        if (typeof summary.label !== 'string' || !summary.label || summary.label.length > 200
          || summary.version !== 1 || !Number.isSafeInteger(summary.generation) || summary.generation < 1
          || !HEX.test(summary.contentDigest) || !HEX.test(summary.captureId)
          || !HEX.test(summary.digest) || !HEX.test(summary.attemptId)) throw new Error('discovery');
      }
    }
    discovery = value;
    if (value.state === 'active') await activate(token);
    status(value.state === 'active' ? 'Connected. Automatic backup is enabled.'
      : 'Choose a backup to restore, or back up this device separately. Nothing has been uploaded.');
  }
  async function perform(action, failure) {
    if (busy) return;
    busy = true;
    const token = ++epoch;
    render();
    try { await action(token); }
    catch {
      if (token === epoch) status(failure, true);
    } finally {
      if (token === epoch) { busy = false; render(); }
    }
  }

  async function connect() {
    if (!configuration || !restore?.isReady()) {
      status(restore?.state.error || UNAVAILABLE, true);
      return;
    }
    await perform(async (token) => {
      const selected = elements().provider.value;
      if (!NAMES[selected]) return;
      const yes = await askConfirm({
        title: `Connect to ${NAMES[selected]}?`,
        body: 'Automatic backup sends reading data (including notes and ratings), completion history, settings and saved import drafts, including arbitrary pasted source, to this provider. '
          + 'Every saved change backs up while the app is open. This is not live synchronization. Two copies per device are retained. '
          + 'You will choose Restore or Back up this device separately before the first upload. Disconnect keeps local data and remote copies.',
        confirmLabel: 'Connect and discover',
      });
      live(token);
      if (!yes) { status('Connection cancelled. Nothing was uploaded.'); return; }
      provider = selected;
      transport = configuration.client.forProvider(provider);
      consent = true;
      storage.setItem(CONSENT_KEY, JSON.stringify({ version: 1, provider }));
      if (storage.getItem(CONSENT_KEY) !== JSON.stringify({ version: 1, provider })) throw new Error('consent');
      status(`Connecting to ${NAMES[provider]}…`);
      const value = validStatus(await transport.connect());
      live(token);
      account = value.account;
      status('Discovering existing backups before enabling automatic backup…');
      await discover(token);
    }, 'Connection was not confirmed. Retry or cancel the connection. Local data and remote backups are unchanged.');
  }

  async function separate(token) {
    if (discovery?.state !== 'awaiting-choice') throw new Error('choice');
    const result = await transport.chooseSeparate({ epoch: discovery.epoch, discoveryId: discovery.discoveryId });
    live(token);
    if (result?.provider !== provider || result.state !== 'active' || result.epoch !== discovery.epoch
      || !HEX.test(result.streamId)) throw new Error('choice');
    await activate(token);
    discovery = null;
    status('Connected. This device has its own automatic backup stream.');
  }
  async function chooseSeparate() {
    await perform(async (token) => {
      if (!await askConfirm({
        title: 'Back up this device separately?',
        body: 'This saves your current local data in a new device stream. Existing backups on other devices are not replaced.',
        confirmLabel: 'Back up this device',
      })) return;
      live(token);
      await separate(token);
    }, 'A separate backup was not confirmed. Retry discovery before choosing again. No other device stream was selected for writing.');
  }
  async function selectRestore(stream, selection) {
    await perform(async (token) => {
      status('Downloading and validating the complete backup…');
      const value = await transport.readSnapshot({ streamId: stream.streamId, selection });
      live(token);
      const text = JSON.stringify(value);
      const snapshot = await parseCloudSnapshot(text);
      live(token);
      if (snapshot.streamId !== stream.streamId || snapshot.generation !== selection.generation
        || snapshot.attemptId !== selection.attemptId || snapshot.contentDigest !== selection.contentDigest
        || snapshot.captureId !== selection.captureId) throw new Error('selection');
      const { reader, history, draft } = snapshot.components;
      const yes = await askConfirm({
        title: `Restore complete backup from ${selection.label}?`,
        body: `This replaces reading data (${reader.listOrder.length} lists), completion history (${history.records.length} records), settings and ${draft ? 'a saved import draft' : 'the saved import draft with no draft'}. `
          + 'An exact prior copy is kept in recovery until all replacements and on-screen readbacks agree. Restored drafts stay paused for review. '
          + 'There is no single-component Undo for this complete restore. Download local backups first if you want to keep them after it finishes. '
          + (discovery.state === 'awaiting-choice' ? 'After success, this device gets its own automatic backup stream. ' : '')
          + 'Close other app tabs and windows before continuing.',
        confirmLabel: 'Restore complete backup',
      });
      live(token);
      if (!yes) { status('Restore cancelled. Local data is unchanged.'); elements().status.focus(); return; }
      stopBackup();
      const result = await restore.restore(text, { draftRecovery: draftRecovery() });
      live(token);
      if (!result.ok) { status(result.error, true); return; }
      if (discovery.state === 'awaiting-choice') await separate(token);
      else await activate(token);
      status('Complete backup restored. Any saved import draft is paused for review. Automatic backup is enabled.');
      elements().status.focus();
    }, 'The selected backup could not be restored or the new connection could not be confirmed. Check recovery and retry discovery. Local recovery copies remain available if replacement started.');
  }

  async function cancel({ confirm = false } = {}) {
    if (confirm && !await askConfirm({
      title: 'Disconnect cloud backup?',
      body: 'Automatic backup stops. Local reading data and existing remote backups stay intact. This does not delete provider files or revoke your OS account.',
      confirmLabel: 'Disconnect',
    })) return false;
    ++epoch;
    busy = true;
    stopBackup();
    render();
    try {
      await disconnectNative();
      status('Disconnected. Local data and remote backups are kept.');
      return true;
    } catch {
      status('Disconnect was not confirmed. Retry disconnect before switching providers or erasing local data. Existing remote backups remain.', true);
      return false;
    } finally {
      busy = false;
      render();
      if (!transport) (elements().connect.disabled ? elements().status : elements().connect).focus();
    }
  }
  async function recover(direction) {
    await perform(async (token) => {
      const yes = await askConfirm({
        title: direction === 'forward' ? 'Finish the interrupted restore?' : 'Restore exact prior data?',
        body: 'Only exact prior or prepared values can be replaced. Unknown edits stop recovery. Saving and uploads remain paused until all data and on-screen readbacks agree.',
        confirmLabel: direction === 'forward' ? 'Finish restore' : 'Restore prior data',
      });
      live(token);
      if (!yes) return;
      stopBackup();
      const result = await restore.recover(direction);
      live(token);
      status(result.ok ? 'Recovery finished. Check the restored data, then reconnect cloud backup when ready.' : result.error, !result.ok);
      if (result.ok) elements().status.focus();
    }, 'Recovery did not finish. The prior copy is retained and saving remains paused.');
  }

  function render() {
    const nodes = elements();
    if (!nodes.group) return;
    const pending = restore?.state.pending || restore?.state.phase === 'unknown';
    nodes.provider.disabled = !configuration || busy || !!transport || pending;
    nodes.connect.disabled = !configuration || busy || !!transport || !restore?.isReady();
    nodes.connect.textContent = busy && !transport ? 'Connecting…' : 'Connect';
    nodes.identity.textContent = account ? `${NAMES[provider]}: ${account.label}` : 'Not connected.';
    const backup = getBackupState();
    nodes.status.textContent = pending ? restore.state.error
      : busy ? message : active && backup ? (PHASES[backup.phase] ?? message) : message;
    nodes.disconnect.hidden = !transport;
    nodes.disconnect.disabled = busy;
    nodes.cancel.hidden = !transport || active;
    nodes.cancel.disabled = false;
    nodes.retry.hidden = !transport || busy || pending;
    nodes.retry.textContent = active ? 'Retry backup' : 'Retry discovery';
    nodes.find.hidden = !active;
    nodes.find.disabled = busy || pending;
    nodes.separate.hidden = discovery?.state !== 'awaiting-choice';
    nodes.separate.disabled = busy || pending;
    nodes.recovery.hidden = !pending;
    nodes.finish.disabled = busy || !restore?.recoverable;
    nodes.prior.disabled = busy || !restore?.recoverable;
    nodes.exportPrior.disabled = !restore?.recoverable;
    nodes.recoveryStatus.textContent = restore?.state.error ?? '';
    nodes.streams.replaceChildren();
    if (discovery) {
      if (!discovery.streams.length) nodes.streams.append(el('p', { class: 'rail-hint', text: 'No valid existing backups were found. Back up this device separately, or cancel.' }));
      if (discovery.rejected.length) nodes.streams.append(el('p', { class: 'rail-hint', text: `${discovery.rejected.length} remote files could not be validated and cannot be restored.` }));
      for (const stream of discovery.streams) for (const [kind, selection] of [['Current', stream.current], ['Previous', stream.previous]]) {
        if (!selection) continue;
        const copy = kind.toLowerCase();
        nodes.streams.append(el('div', { class: 'stack' }, [
          el('p', { class: 'rail-hint', text: `${selection.label}: ${kind.toLowerCase()} copy, generation ${selection.generation}, schema ${selection.version}. Provider time: ${selection.modifiedAt ?? 'unavailable'}. Captured: ${selection.capturedAt}.` }),
          el('button', { id: `cloud-copy-${stream.streamId}-${copy}`, type: 'button', class: 'btn btn-g',
            dataset: { cloudStream: stream.streamId, cloudCopy: copy, cloudGeneration: String(selection.generation) },
            text: `Restore ${copy} from ${selection.label}`,
            disabled: busy || pending, onclick: () => { void selectRestore(stream, selection); } }),
        ]));
      }
    }
  }

  function wire() {
    if (wired) return;
    wired = true;
    const nodes = elements();
    nodes.connect.addEventListener('click', () => { void connect(); });
    nodes.separate.addEventListener('click', () => { void chooseSeparate(); });
    nodes.disconnect.addEventListener('click', () => { void cancel({ confirm: true }); });
    nodes.cancel.addEventListener('click', () => { void cancel(); });
    nodes.retry.addEventListener('click', () => {
      if (active) startBackup.retry?.();
      else void perform(discover, 'Discovery could not be confirmed. Retry or cancel the connection.');
    });
    nodes.find.addEventListener('click', () => { void perform(discover, 'Backups could not be checked. Retry discovery.'); });
    nodes.finish.addEventListener('click', () => { void recover('forward'); });
    nodes.prior.addEventListener('click', () => { void recover('prior'); });
    nodes.exportPrior.addEventListener('click', async () => {
      try { await download('recap-cloud-restore-prior.json', restore.exportPrior(), 'application/json'); }
      catch { status('The prior recovery copy could not be downloaded. Keep this page open and try again.', true); }
    });
    restore?.subscribe(render);
    render();
  }

  return {
    wire, render, cancel,
    async beforeErase() {
      if (restore && !await restore.beforeErase()) return false;
      return transport ? cancel() : !busy;
    },
    async configure(options) {
      if (configuration || transport || busy || options?.qualification !== true
        || typeof options.client?.forProvider !== 'function' || typeof options.label !== 'string'
        || !options.label.trim() || options.label.length > 200 || !restore?.isReady()) throw new Error(UNAVAILABLE);
      configuration = options;
      status('Cloud backup is optional. Choose a provider and Connect to review the data and automatic-backup consent.');
      let remembered = null;
      try { remembered = JSON.parse(storage.getItem(CONSENT_KEY)); } catch { /* No verified consent means no native call. */ }
      if (remembered?.version === 1 && NAMES[remembered.provider]) {
        await perform(async (token) => {
          provider = remembered.provider;
          elements().provider.value = provider;
          transport = configuration.client.forProvider(provider);
          consent = true;
          const value = validStatus(await transport.status());
          live(token);
          account = value.account;
          if (value.state === 'connected' && value.phase === 'active') await activate(token);
          else await discover(token);
        }, 'Reconnect is required. Cancel this connection, then Connect again to review provider access.');
      }
    },
    get connected() { return active && consent; },
  };
}
