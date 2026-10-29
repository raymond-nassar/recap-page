// The Cloud backup card of Backup & settings (#810, P02-T05): what the page's cloud backup reports, and
// the person's answers to it. Like the rest of Backup & settings it checks locally and hands every change
// to an injected callback, so it never touches storage, the transport, the protocol or the restore engine.
//
// The card is hidden until the page learns this build has cloud backup, which it asks when Backup &
// settings opens. Questions go through the shared dialog, Cancel first. Restoring a backup wears the
// danger appearance for the reason a complete backup file's restore does, and deleting this device's
// backups does because the app cannot bring them back, even while OneDrive's recycle bin holds them.

import { completeRestoreQuestion, STOPPED, UNCHANGED, withOutcome } from './data.js';

const PROVIDER_NAMES = Object.freeze({ onedrive: 'OneDrive' });
const DELETED = /\bnothing was deleted\b/i;
const WAITS = Object.freeze({
  offline: 'Backups wait for a network connection.',
  paused: 'Backups wait for the restore to finish.',
  pending: 'Backups wait for the import to finish saving.',
  unsaved: 'Backups wait until the import draft can be saved.',
});
const LINKED = new Set(['connected', 'needs-sign-in', 'signing-in', 'unavailable']);

function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

export function cloudProviderName(model) {
  return PROVIDER_NAMES[model?.provider] ?? 'your cloud account';
}

const longTime = (at) => new Date(at).toLocaleString(undefined, {
  year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
const shortTime = (at) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

// What the backups are doing, for a browser that agreed to back up.
export function cloudBackupStatus({ phase, code, retryAt, lastUploadAt }, { name = 'OneDrive', when = longTime, at = shortTime } = {}) {
  const last = lastUploadAt ? ` Last backed up ${when(lastUploadAt)}.` : '';
  if (phase === 'saving') return 'Backing up now.';
  if (phase === 'up-to-date') return lastUploadAt ? `Backed up ${when(lastUploadAt)}.` : 'Backed up.';
  if (phase === 'pending') return `Changes are waiting to be backed up.${last}`;
  if (phase === 'waiting') return `${WAITS[code] ?? 'Backups are waiting.'}${last}`;
  if (phase === 'retrying') return `The last backup did not finish, so it is tried again${retryAt ? ` at ${at(retryAt)}` : ''}.${last}`;
  if (phase === 'failed') {
    const stopped = code === 'quota' ? `${name} is full, so backups have stopped. Free some space there, then try again.`
      : code === 'oversize' || code === 'too-large' ? 'Your saved data is larger than a cloud backup can be, so backups have stopped.'
        : code === 'unsupported' ? 'This browser cannot make cloud backups, so backups have stopped.'
          : code === 'storage' || code === 'unreadable' ? 'This browser could not read its saved data or its cloud backup record, so backups have stopped.'
            : 'A backup could not be made, so backups have stopped until your data changes or you try again.';
    return `${stopped}${last}`;
  }
  return '';
}

// The card's persistent line: the account, and what is happening to backups.
export function cloudCardStatus(model, { when = longTime, at = shortTime } = {}) {
  const name = cloudProviderName(model);
  switch (model.host) {
    case 'unavailable': return model.message ?? 'Cloud backup is not available right now.';
    case 'not-answering': return 'Automatic backup is on in this browser, but the Recap Page app is not answering for it, so backups wait until it does.';
    case 'signing-in': return `Finish signing in to Microsoft in the browser window that opened.${
      Number.isSafeInteger(model.signInExpiresAt) ? ` The sign-in stops by itself at ${at(model.signInExpiresAt)}.` : ''}`;
    case 'not-connected': return model.message ?? '';
    case 'needs-sign-in': return 'Microsoft asked for the sign-in to be made again, so backups have stopped. Sign in to carry on.';
    case 'connected': {
      const account = model.account ? `Connected to ${name} as ${model.account}.` : `Connected to ${name}.`;
      if (model.askedAgain) {
        return model.reason ? `${account} ${model.reason}`
          : `${account} ${name} was connected again since this browser agreed to back up, so check the backups below before turning automatic backup on again.`;
      }
      if (!model.on) return account;
      return `${account} ${cloudBackupStatus(model.backup, { name, when, at })}`;
    }
    default: return '';
  }
}

// Said in the erase question only while erasing changes cloud backup.
export function cloudEraseNote(model) {
  if (!model?.shown) return null;
  const name = cloudProviderName(model);
  if (LINKED.has(model.host)) return `Cloud backup is disconnected too, for every browser profile on this Windows account. Backups already in ${name} stay there.`;
  if (model.agreed || model.hasStream) return `This browser's cloud backup settings are erased too. Backups already in ${name} stay there.`;
  return null;
}

// Added to what an erase reports when cloud backup could not be turned off everywhere it said.
export function cloudEraseOutcome(result) {
  if (result?.ok !== false) return '';
  return ` Cloud backup could not be fully turned off. ${result.problems.join(' ')} Check Cloud backup in Backup & settings.`;
}

// The privacy sentences, wherever they are, in the variant true of this build (P02-T06). The markup carries
// both: data-cloud-copy="off" is what a build without cloud backup says, and "on" starts hidden. Only an
// answer from the host, or this browser's own consent, shows the "on" words, so a build that never learns
// it has cloud backup says exactly what it said before cloud backup existed.
export function renderCloudCopy(model, root = globalThis.document) {
  const on = Boolean(model?.shown);
  for (const node of root?.querySelectorAll?.('[data-cloud-copy]') ?? []) {
    node.hidden = (node.dataset?.cloudCopy === 'on') !== on;
  }
}

export function createCloudBackupView({
  el, elements, askConfirm, askConfirmChoice, notify, getModel,
  onConnect, onTurnOn, onTurnOff, onDiscover, onFetch, onRestore, onDeleteOwn, onDisconnect, onRetry, onFinished,
  when = longTime, at = shortTime,
}) {
  let working = false;
  // The person's answer while turning automatic backup on or off, so the switch does not flick back
  // while the change is made.
  let toggling = null;
  let shownDiscovery = null;
  let opened = false;
  const report = (message, kind = 'error') => notify('#cloud-backup-report', message, kind);

  function copyRow(device, copy, which, from) {
    const made = when(copy.createdAt);
    return el('li', { class: 'cloud-copy' }, [
      el('span', { text: `${which === 'current' ? 'Newest' : 'Before that'}: ${made}, ${plural(copy.summary.lists, 'list')}` }),
      el('button', {
        type: 'button', class: 'btn btn-g', id: `cloud-copy-${device.stream}-${which}`, text: 'Restore',
        'aria-label': `Restore the ${which === 'current' ? 'newest' : 'earlier'} backup from ${from}, made ${made}`,
        dataset: { cloudStream: device.stream, cloudCopy: which, cloudGeneration: String(copy.generation) },
      }),
    ]);
  }

  function deviceSection(device) {
    const from = device.current?.device ?? device.previous?.device ?? 'a device whose backups could not be read';
    const rows = [];
    if (device.current) rows.push(copyRow(device, device.current, 'current', from));
    if (device.previous) rows.push(copyRow(device, device.previous, 'previous', from));
    const heading = device.current || device.previous ? from : 'Backups that could not be read';
    return el('section', { class: 'cloud-device' }, [
      el('h4', { text: device.own ? `${heading} (this browser)` : heading }),
      rows.length ? el('ul', { class: 'cloud-copies' }, rows) : null,
      device.invalid > 0
        ? el('p', { class: 'rail-hint', text: `${plural(device.invalid, 'more backup')} could not be read, so ${device.invalid === 1 ? 'it is' : 'they are'} not offered.` })
        : null,
    ]);
  }

  // Redrawn only when what was found changes, so a Restore button keeps focus while backups go on.
  function renderDiscovery(nodes, model) {
    const { discovery } = model;
    if (discovery === shownDiscovery) return;
    shownDiscovery = discovery;
    const name = cloudProviderName(model);
    nodes.discoverySummary.textContent = `Backups in this ${name}`;
    const parts = [];
    if (discovery.state === 'loading') parts.push(el('p', { class: 'rail-hint', text: `Checking ${name}.` }));
    if (discovery.state === 'failed') parts.push(el('p', { class: 'rail-hint', text: discovery.message }));
    const result = discovery.result;
    if (result) {
      if (result.devices.length === 0) parts.push(el('p', { class: 'rail-hint', text: `There are no Recap Page backups in this ${name} yet.` }));
      for (const device of result.devices) parts.push(deviceSection(device));
      if (result.omitted > 0) parts.push(el('p', { class: 'rail-hint', text: `${plural(result.omitted, 'more device')} not shown.` }));
      if (result.unrecognized > 0) parts.push(el('p', { class: 'rail-hint', text: `${plural(result.unrecognized, 'other file')} in the folder ${result.unrecognized === 1 ? 'was' : 'were'} left alone.` }));
    }
    if (discovery.state !== 'loading') {
      parts.push(el('button', { type: 'button', class: 'btn btn-g', text: 'Check again', dataset: { cloudAction: 'check' } }));
    }
    nodes.found.replaceChildren(...parts);
  }

  function render(model = getModel()) {
    const nodes = elements();
    if (!nodes.card) return;
    nodes.card.hidden = !model.shown;
    if (!model.shown) return;
    const { host } = model;
    const connected = host === 'connected';
    nodes.intro.hidden = !(host === 'not-connected' || host === 'signing-in');
    const said = cloudCardStatus(model, { when, at });
    nodes.status.textContent = said;
    nodes.status.hidden = !said;
    nodes.progress.hidden = !(model.on && model.backup.phase === 'saving');
    nodes.signIn.hidden = !(host === 'not-connected' || host === 'needs-sign-in');
    nodes.retry.hidden = !(model.on && (model.backup.phase === 'failed' || model.backup.phase === 'retrying'));
    nodes.primary.hidden = nodes.signIn.hidden && nodes.retry.hidden;
    const agreed = model.agreed && !model.askedAgain;
    nodes.auto.hidden = !(connected || (model.agreed && host !== 'not-connected' && host !== 'signing-in'));
    nodes.autoInput.checked = toggling ?? agreed;
    nodes.discovery.hidden = !connected;
    // A browser asked to agree sees what the account holds first; the person's own opening and closing
    // is left alone after that.
    if (connected && !model.on && !opened) {
      nodes.discovery.open = true;
      opened = true;
    }
    if (model.on) opened = false;
    renderDiscovery(nodes, model);
    nodes.remove.hidden = !(connected && model.hasStream);
    nodes.disconnect.hidden = !(connected || host === 'needs-sign-in' || host === 'unavailable');
    nodes.actions.hidden = nodes.remove.hidden && nodes.disconnect.hidden;
    for (const control of [nodes.signIn, nodes.retry, nodes.remove, nodes.disconnect, ...(nodes.found.querySelectorAll?.('button') ?? [])]) {
      control.disabled = working;
    }
    nodes.autoInput.disabled = working || (!nodes.autoInput.checked && !connected);
  }

  // The control that started an action is disabled while it runs, so the shared question cannot hand
  // focus back to it when it closes. It is handed back here once usable, or to the card's status when
  // the action has moved the card on and the control is gone.
  async function run(action) {
    if (working) return;
    const opener = globalThis.document?.activeElement ?? null;
    working = true;
    render();
    try { await action(); }
    finally {
      working = false;
      render();
      const lost = !globalThis.document?.activeElement || globalThis.document.activeElement === globalThis.document.body;
      if (lost) {
        const usable = opener?.isConnected && !opener.disabled && !opener.closest?.('[hidden]');
        const status = elements().status;
        if (usable) opener.focus();
        else if (status?.isConnected && !status.closest?.('[hidden]')) status.focus();
      }
    }
  }

  function signIn() {
    return run(async () => {
      try { await onConnect(); }
      catch (error) { report(`Sign-in did not start. ${error.message}`); }
    });
  }

  function toggle(event) {
    // The switch is disabled while another action runs; should a change arrive anyway, the card is put back.
    if (working) {
      render();
      return undefined;
    }
    const on = event.target.checked;
    const name = cloudProviderName(getModel());
    toggling = on;
    return run(async () => {
      try {
        if (on) {
          await onTurnOn();
          report('Automatic backup is on for this browser.', 'ok');
        } else {
          await onTurnOff();
          report(`Automatic backup is off for this browser. Backups already in ${name} stay there.`, 'ok');
        }
      } catch (error) {
        report(on ? `Automatic backup was not turned on. ${error.message}` : `Automatic backup was not turned off. ${error.message}`);
      } finally {
        toggling = null;
      }
    });
  }

  function restore(button) {
    const model = getModel();
    const device = model.discovery.result?.devices.find((entry) => entry.stream === button.dataset.cloudStream);
    const copy = device?.[button.dataset.cloudCopy];
    if (!copy || String(copy.generation) !== button.dataset.cloudGeneration) return undefined;
    return run(async () => {
      let checked;
      try { checked = await onFetch(copy); }
      catch (error) {
        report(withOutcome('Nothing was changed.', error.message, UNCHANGED));
        return;
      }
      const yes = await askConfirm({
        title: 'Replace all saved data with this backup?',
        body: `From ${checked.device}, made ${when(checked.createdAt)}. ${completeRestoreQuestion(checked.summary, { source: 'backup' })}`,
        confirmLabel: 'Restore this backup',
        danger: true,
      });
      if (!yes) return;
      const result = await onRestore(checked.text);
      if (result.ok) {
        onFinished(`Backup restored from ${cloudProviderName(model)}. Any import draft from it waits in Search for your review.`);
        return;
      }
      if (result.invalid) {
        report(withOutcome('Nothing was changed.', result.error, UNCHANGED));
        return;
      }
      report(result.changed === false ? withOutcome('Nothing was replaced.', result.error, UNCHANGED)
        : withOutcome('The restore stopped part way.', result.error, STOPPED));
    });
  }

  // True when every one of this device's backups is gone.
  async function deleteOwnBackups(name) {
    let result;
    try { result = await onDeleteOwn(); }
    catch (error) {
      report(withOutcome('Nothing was deleted.', error.message, DELETED));
      return false;
    }
    const total = result.deleted + result.failed.length;
    if (result.failed.length === 0) {
      report(result.deleted === 0 ? `No backups of this browser were in ${name}. Automatic backup is off for this browser.`
        : `Deleted ${plural(result.deleted, 'backup')} of this browser from ${name}, where ${result.deleted === 1 ? 'it stays' : 'they stay'} in the recycle bin until it is emptied. Automatic backup is off for this browser.`, 'ok');
      return true;
    }
    const reason = result.failed[0].code === 'needs-sign-in' ? 'sign in again first'
      : result.failed[0].code === 'timeout' ? `${name} did not answer in time` : `${name} did not delete ${result.failed.length === 1 ? 'it' : 'them'}`;
    report(`Deleted ${result.deleted} of ${plural(total, 'backup')} of this browser. ${plural(result.failed.length, 'backup')} could not be deleted (${reason}). Automatic backup is off for this browser; delete again to finish.`, 'warn');
    return false;
  }

  function deleteOwn() {
    return run(async () => {
      const name = cloudProviderName(getModel());
      const yes = await askConfirm({
        title: 'Delete this device\'s cloud backups?',
        body: `This turns automatic backup off for this browser and deletes every backup it made in ${name}. Backups from other devices are kept. Deleted backups stay in ${name}'s recycle bin until it is emptied, but Recap Page cannot bring them back.`,
        confirmLabel: 'Delete cloud backups',
        danger: true,
      });
      if (yes) await deleteOwnBackups(name);
    });
  }

  function disconnect() {
    return run(async () => {
      const model = getModel();
      const name = cloudProviderName(model);
      const title = `Disconnect ${name}?`;
      const body = `Recap Page forgets the ${name} sign-in for every browser profile on this Windows account, and automatic backup stops in each of them. Backups already in ${name} stay there unless you also delete this device's.`;
      let deleteFirst = false;
      if (model.host === 'connected' && model.hasStream) {
        const answer = await askConfirmChoice({
          title, body, confirmLabel: 'Disconnect',
          choiceLabel: 'Also delete this device\'s cloud backups', choiceConfirmLabel: 'Delete and disconnect',
        });
        if (!answer) return;
        deleteFirst = answer.choice;
      } else {
        const yes = await askConfirm({
          title, body, confirmLabel: 'Disconnect',
        });
        if (!yes) return;
      }
      // One question at a time: should the deletion stop part way, disconnecting is asked again on its own.
      if (deleteFirst && !(await deleteOwnBackups(name))) {
        const anyway = await askConfirm({
          title: 'Disconnect anyway?',
          body: `Some of this device's backups are still in ${name}. To delete them later, connect again and use Delete this device's cloud backups, or delete them in ${name} itself.`,
          confirmLabel: 'Disconnect anyway',
        });
        if (!anyway) return;
      }
      try {
        await onDisconnect();
        report(`Disconnected from ${name}.`, 'ok');
      } catch (error) {
        report(`${name} is still connected. ${error.message}`);
      }
    });
  }

  function wire() {
    const nodes = elements();
    if (!nodes.card) return;
    nodes.signIn.addEventListener('click', () => { void signIn(); });
    nodes.retry.addEventListener('click', () => onRetry());
    nodes.autoInput.addEventListener('change', (event) => { void toggle(event); });
    nodes.discovery.addEventListener('toggle', () => {
      if (nodes.discovery.open && getModel().discovery.state === 'idle') void onDiscover();
    });
    nodes.found.addEventListener('click', (event) => {
      const button = event.target?.closest?.('button');
      if (!button || working) return;
      if (button.dataset.cloudCopy) void restore(button);
      else if (button.dataset.cloudAction === 'check') void run(() => onDiscover());
    });
    nodes.remove.addEventListener('click', () => { void deleteOwn(); });
    nodes.disconnect.addEventListener('click', () => { void disconnect(); });
    render();
  }

  return { wire, render };
}
