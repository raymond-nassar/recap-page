// The Cloud backup card of Backup & settings (#810, P02-T05): what the page's cloud backup reports, and
// the person's answers to it. Like the rest of Backup & settings it checks locally and hands every change
// to an injected callback, so it never touches storage, the transport, the protocol or the restore engine.
//
// The card is hidden until the page learns this build has cloud backup, which it asks when Backup &
// settings opens. Questions go through the shared dialog, Cancel first. Restoring a backup wears the
// danger appearance for the reason a complete backup file's restore does, and deleting this device's
// backups does because the app cannot bring them back, even while OneDrive's recycle bin holds them.

import { completeRestoreQuestion, STOPPED, UNCHANGED, withOutcome } from './data.js';
import { cloudErrorText } from '../lib/cloudCopy.js';

// Each service the card can name: its name, the company that asks for the sign-in, and what it calls the
// place deleted files wait, plus the card's sign-in button for it. A host that offers one service shows
// its button alone, as before there was a choice.
const PROVIDERS = Object.freeze({
  onedrive: Object.freeze({ name: 'OneDrive', company: 'Microsoft', bin: 'recycle bin', button: 'signIn' }),
  googledrive: Object.freeze({ name: 'Google Drive', company: 'Google', bin: 'trash', button: 'signInGoogle' }),
});
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

const own = (provider) => (Object.hasOwn(PROVIDERS, provider) ? PROVIDERS[provider] : null);

export function cloudProviderName(model) {
  return own(model?.provider)?.name ?? 'your cloud account';
}

const companyOf = (model) => own(model?.provider)?.company ?? 'Your cloud account';
const binOf = (model) => own(model?.provider)?.bin ?? 'recycle bin';

// The services a person can sign in to from the card now: every one offered while nobody is connected,
// and only the connected one when it asks for a sign-in again, since a device holds one at a time.
export function cloudSignInChoices(model) {
  if (model?.host === 'needs-sign-in') return own(model.provider) ? [model.provider] : [];
  if (model?.host !== 'not-connected') return [];
  // A host older than the choice names no services and offers OneDrive alone. One that names only services
  // this card cannot show offers no button, rather than one for a service it never offered.
  const named = Array.isArray(model.providers) ? model.providers : [];
  return named.length > 0 ? [...new Set(named.filter(own))] : ['onedrive'];
}

const longTime = (at) => new Date(at).toLocaleString(undefined, {
  year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
});
const shortTime = (at) => new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

// What the backups are doing, for a browser that agreed to back up.
export function cloudBackupStatus({ phase, code, retryAt, lastUploadAt }, { name = 'OneDrive', when = longTime, at = shortTime, scope } = {}) {
  const last = lastUploadAt ? ` Last backed up ${when(lastUploadAt)}.` : '';
  if (phase === 'saving') return 'Backing up now.';
  if (phase === 'up-to-date') return lastUploadAt ? `Backed up ${when(lastUploadAt)}.` : 'Backed up.';
  if (phase === 'pending') return `Changes are waiting to be backed up.${last}`;
  if (phase === 'waiting') return `${WAITS[code] ?? 'Backups are waiting.'}${last}`;
  if (phase === 'retrying') return `The last backup did not finish, so it is tried again${retryAt ? ` at ${at(retryAt)}` : ''}.${last}`;
  if (phase === 'failed') {
    const stopped = code === 'quota' ? `${name} is full, so backups have stopped. Free some space there, then try again.`
      : code === 'oversize' || code === 'too-large' ? 'Your saved data is larger than a cloud backup can be, so backups have stopped.'
        : code === 'unsupported' ? scope === 'device' ? 'Cloud backup cannot work on this device, so backups have stopped.' : 'This browser cannot make cloud backups, so backups have stopped.'
          : code === 'storage' || code === 'unreadable' ? scope === 'device' ? 'Recap Page could not read its saved data or its cloud backup record, so backups have stopped.' : 'This browser could not read its saved data or its cloud backup record, so backups have stopped.'
            : 'A backup could not be made, so backups have stopped until your data changes or you try again.';
    return `${stopped}${last}`;
  }
  return '';
}

// The card's persistent line: the account, and what is happening to backups.
export function cloudCardStatus(model, { when = longTime, at = shortTime } = {}) {
  const name = cloudProviderName(model);
  const device = model.scope === 'device';
  switch (model.host) {
    case 'unavailable': return cloudErrorText(model.message, model.scope) ?? 'Cloud backup is not available right now.';
    case 'not-answering': return device ? "Automatic backup is on, but the app's cloud backup is not answering, so backups wait until it does." : 'Automatic backup is on in this browser, but the Recap Page app is not answering for it, so backups wait until it does.';
    case 'signing-in': return `Finish signing in to ${companyOf(model)} in the browser window that opened.${
      Number.isSafeInteger(model.signInExpiresAt) ? ` The sign-in stops by itself at ${at(model.signInExpiresAt)}.` : ''}`;
    case 'not-connected': return cloudErrorText(model.message, model.scope) ?? '';
    case 'needs-sign-in': return `${companyOf(model)} asked for the sign-in to be made again, so backups have stopped. Sign in to carry on.`;
    case 'connected': {
      const account = model.account ? `Connected to ${name} as ${model.account}.` : `Connected to ${name}.`;
      if (model.askedAgain) {
        return model.reason ? `${account} ${cloudErrorText(model.reason, model.scope)}`
          : device ? `${account} ${name} was connected again after you turned on automatic backup, so check the backups below before turning it on again.`
            : `${account} ${name} was connected again since this browser agreed to back up, so check the backups below before turning automatic backup on again.`;
      }
      // Consent an erase set aside (stage 3 review, S3a-7); the owner's words, approved 2026-10-28.
      if (model.suspended) {
        return `${account} Automatic backup stopped while ${device ? "Recap Page's data on this device" : "this browser's data"} was being erased. If that erase did not finish, check your data before you turn automatic backup on again, because new backups replace older ones.`;
      }
      // A record that fails its checks (stage 3 review, S3b-7); the owner's words, approved 2026-10-28.
      if (model.recordUnreadable) {
        return device
          ? `${account} Recap Page could not read its cloud backup settings, so backups have stopped. Turning automatic backup on starts them again. Backups made earlier on this device will then be listed as another device's.`
          : `${account} This browser could not read its cloud backup settings, so backups have stopped. Turning automatic backup on starts them again. This browser's earlier backups will then be listed as another device's.`;
      }
      if (!model.on) return account;
      return `${account} ${cloudBackupStatus(model.backup, { name, when, at, scope: model.scope })}`;
    }
    default: return '';
  }
}

// Stopped and failed states, which wear the warning notice, whose mark does not rely on color.
export function cloudCardWarns(model) {
  const { host } = model;
  if (host === 'needs-sign-in' || host === 'unavailable' || host === 'not-answering') return true;
  if (host === 'not-connected') return Boolean(model.message);
  if (host === 'connected') return Boolean(model.askedAgain || model.suspended || model.recordUnreadable || (model.on && model.backup.phase === 'failed'));
  return false;
}

// The changes a person must hear as they happen: signing in, a sign-in that failed, a sign-in to make
// again, and backups that stopped. Each is named so it is said once while it lasts.
function noticeOf(model, previous) {
  const { host } = model;
  if (host === 'needs-sign-in') return 'needs-sign-in';
  if (previous === 'signing-in' && host === 'not-connected' && model.message) return 'sign-in-failed';
  if (previous === 'signing-in' && host === 'connected') return 'signed-in';
  if (host === 'unavailable' && model.agreed) return `unavailable:${model.message}`;
  if (host === 'connected' && model.askedAgain) return 'asked-again';
  if (host === 'connected' && model.recordUnreadable) return 'record-unreadable';
  if (host === 'connected' && model.on && model.backup.phase === 'failed') return `failed:${model.backup.code}`;
  return null;
}

// Said in the erase question only while erasing changes cloud backup.
export function cloudEraseNote(model) {
  if (!model?.shown) return null;
  const name = cloudProviderName(model);
  if (LINKED.has(model.host)) return `Cloud backup is disconnected too, ${model.scope === 'device' ? 'on this device' : 'for every browser profile on this Windows account'}. Backups already in ${name} stay there.`;
  if (model.agreed || model.hasStream) return `${model.scope === 'device' ? 'Cloud backup settings' : "This browser's cloud backup settings"} are erased too. Backups already in ${name} stay there.`;
  return null;
}

// "the OneDrive account reader@example.test", or "this OneDrive account" where the host gave no name.
function accountIn(model) {
  const name = cloudProviderName(model);
  return model.account ? `the ${name} account ${model.account}` : `this ${name} account`;
}

// Deleting this device's backups, in the owner's words approved 2026-10-28 (stage 3 review, S3a-2 and
// S3b-5) and shortened with the owner's approval on 2026-10-30 (#810, P03-T04 session): the deletion reaches only the account the host holds now, so the question and the reports name
// it, and say where any backups made in another account are.
export function cloudDeleteQuestion(model) {
  const name = cloudProviderName(model);
  const rest = `Backups from other devices or other accounts are kept; delete those in ${name}. Deleted backups stay in ${name}'s ${binOf(model)} for up to 30 days, but Recap Page cannot bring them back.`;
  if (model.scope === 'device') return `This turns automatic backup off and deletes every backup made on this device in ${accountIn(model)}. ${rest}`;
  return `This turns automatic backup off and deletes every backup this browser made in ${accountIn(model)}. ${rest}`;
}

export function cloudDeleteReport({ deleted, failed }, model) {
  const name = cloudProviderName(model);
  const where = accountIn(model);
  const device = model.scope === 'device';
  const from = device ? 'made on this device' : 'of this browser';
  const off = device ? 'Automatic backup is off' : 'Automatic backup is off for this browser';
  if (failed.length === 0) {
    return deleted === 0
      ? `No backups ${from} were in ${where}. Any ${device ? 'made' : 'it made'} in another account are still there. ${off}.`
      : `Deleted ${plural(deleted, 'backup')} ${from} from ${where}, where ${deleted === 1 ? 'it stays' : 'they stay'} in the ${binOf(model)} for up to 30 days unless it is emptied. ${off}.`;
  }
  const reason = failed[0].code === 'needs-sign-in' ? 'sign in again first'
    : failed[0].code === 'timeout' ? `${name} did not answer in time` : `${name} did not delete ${failed.length === 1 ? 'it' : 'them'}`;
  return `Deleted ${deleted} of ${plural(deleted + failed.length, 'backup')} ${from} from ${where}. ${plural(failed.length, 'backup')} could not be deleted (${reason}). ${off}; delete again to finish.`;
}

// A deletion that stopped before deleting anything, which says automatic backup is off only when it is,
// because consent was withdrawn before the step that failed (stage 3 review, S3a-4).
export function cloudDeleteFailure(message, off, model = {}) {
  return `${withOutcome('Nothing was deleted.', cloudErrorText(message, model.scope), DELETED)}${off ? model.scope === 'device' ? ' Automatic backup is off.' : ' Automatic backup is off for this browser.' : ''}`;
}

// The disconnect question, in the owner's words approved 2026-10-28 (stage 3 review, S3a-5 and S3b-6).
// Deleting is a choice only while connected with backups of this browser, so only that question says
// "unless"; after Microsoft asked for the sign-in again, the backups can be deleted only by signing in.
export function cloudDisconnectQuestion(model, choice) {
  const name = cloudProviderName(model);
  // The Android app holds one sign-in for itself alone (#810, P03-T03).
  const lead = model.scope === 'device'
    ? `Recap Page forgets the ${name} sign-in on this device, and automatic backup stops.`
    : `Recap Page forgets the ${name} sign-in for every browser profile on this Windows account, and automatic backup stops in each of them.`;
  if (choice) return `${lead} Backups already in ${name} stay there unless you also delete this device's.`;
  const first = model.host === 'needs-sign-in' && model.hasStream
    ? ' To delete this device\'s backups first, sign in again, then choose Delete this device\'s cloud backups.' : '';
  return `${lead} Backups already in ${name} stay there.${first}`;
}

// Added to what an erase reports when cloud backup could not be turned off everywhere it said.
export function cloudEraseOutcome(result) {
  if (result?.ok !== false) return '';
  return ` Cloud backup could not be fully turned off. ${result.problems.join(' ')} Check Cloud backup in Backup & settings.`;
}

// The privacy sentences, wherever they are, in the variant true of this build (P02-T06). The markup carries
// both: data-cloud-copy="off" is what a build without cloud backup says, and "on" starts hidden. Only an
// answer from the host, or this browser's own consent, shows the "on" words, so a build that never learns
// it has cloud backup says exactly what it said before cloud backup existed. Only those two values are
// switched: a Restore button names its copy in the same attribute, and switching every value hid them all
// in the owner's session (P02-T07, step 9).
export function renderCloudCopy(model, root = globalThis.document) {
  const on = Boolean(model?.shown);
  for (const node of root?.querySelectorAll?.('[data-cloud-copy="on"], [data-cloud-copy="off"]') ?? []) {
    node.hidden = (node.dataset?.cloudCopy === 'on') !== on;
  }
}

export function createCloudBackupView({
  el, elements, askConfirm, askConfirmChoice, notify, getModel, announce = () => {},
  onConnect, onTurnOn, onTurnOff, onDiscover, onFetch, onRestore, onDeleteOwn, onDisconnect, onRetry, onFinished,
  when = longTime, at = shortTime,
}) {
  let working = false;
  // The person's answer while turning automatic backup on or off, so the switch does not flick back
  // while the change is made.
  let toggling = null;
  let shownDiscovery = null;
  let opened = false;
  // The intro as the page wrote it, for when one service is offered.
  let introText = null;
  // Whether the line under the card says automatic backup is on (true) or off (false) for this browser.
  // It is withdrawn once the switch shows otherwise, as when the folder is deleted or another profile
  // reconnects and this browser is asked again, so the card never says on beside an unticked switch.
  let claimed = null;
  // What the card last showed, so each change worth hearing is said once, as it happens, and never what a
  // page finds already true when it opens (stage 3 review, S3b-2).
  let heard = null;
  const report = (message, kind = 'error', claims = null) => {
    claimed = claims;
    notify('#cloud-backup-report', cloudErrorText(message, getModel().scope), kind);
  };

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

  function deviceSection(device, scope) {
    const from = device.current?.device ?? device.previous?.device ?? 'a device whose backups could not be read';
    const rows = [];
    if (device.current) rows.push(copyRow(device, device.current, 'current', from));
    if (device.previous) rows.push(copyRow(device, device.previous, 'previous', from));
    const heading = device.current || device.previous ? from : 'Backups that could not be read';
    return el('section', { class: 'cloud-device' }, [
      el('h4', { text: device.own ? `${heading} (${scope === 'device' ? 'this device' : 'this browser'})` : heading }),
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
    if (discovery.state === 'failed') parts.push(el('p', { class: 'rail-hint', text: cloudErrorText(discovery.message, model.scope) }));
    const result = discovery.result;
    if (result) {
      if (result.devices.length === 0) parts.push(el('p', { class: 'rail-hint', text: `There are no Recap Page backups in this ${name} yet.` }));
      for (const device of result.devices) parts.push(deviceSection(device, model.scope));
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
    if (!model.shown) {
      heard = null;
      return;
    }
    const { host } = model;
    const connected = host === 'connected';
    nodes.intro.hidden = !(host === 'not-connected' || host === 'signing-in');
    const said = cloudCardStatus(model, { when, at });
    nodes.status.textContent = said;
    nodes.status.hidden = !said;
    const warns = cloudCardWarns(model);
    nodes.status.classList?.toggle('notice', warns);
    nodes.status.classList?.toggle('notice-warn', warns);
    const notice = noticeOf(model, heard?.host);
    if (heard && notice && notice !== heard.notice && said) announce(said);
    heard = { host, notice };
    nodes.progress.hidden = !(model.on && model.backup.phase === 'saving');
    const choices = cloudSignInChoices(model);
    for (const [provider, { button }] of Object.entries(PROVIDERS)) {
      if (nodes[button]) nodes[button].hidden = !choices.includes(provider);
    }
    if (nodes.intro && introText === null) introText = nodes.intro.textContent;
    if (nodes.intro) {
      nodes.intro.textContent = choices.length > 1
        ? `Keep a complete backup in your own ${choices.map((provider) => PROVIDERS[provider].name).join(' or ')}, made automatically as you read.`
        : introText;
    }
    nodes.retry.hidden = !(model.on && (model.backup.phase === 'failed' || model.backup.phase === 'retrying'));
    nodes.primary.hidden = choices.length === 0 && nodes.retry.hidden;
    const agreed = model.agreed && !model.askedAgain;
    nodes.auto.hidden = !(connected || (model.agreed && host !== 'not-connected' && host !== 'signing-in'));
    nodes.autoInput.checked = toggling ?? agreed;
    // A hidden switch is off: with nobody connected, backups are not on here.
    if (claimed !== null && toggling === null && claimed !== (!nodes.auto.hidden && nodes.autoInput.checked)) {
      claimed = null;
      nodes.report?.replaceChildren();
    }
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
    for (const control of [nodes.signIn, nodes.signInGoogle, nodes.retry, nodes.remove, nodes.disconnect, ...(nodes.found.querySelectorAll?.('button') ?? [])]) {
      if (control) control.disabled = working;
    }
    nodes.autoInput.disabled = working || (!nodes.autoInput.checked && !connected);
  }

  // The control that started an action is disabled while it runs, so the shared question cannot hand
  // focus back to it when it closes. It is handed back here once usable; when the action has moved the
  // card on and the control is gone, focus goes to the card's status, or, when that says nothing, to the
  // report of what was done, so it never falls to the page (stage 3 review, S3b-1).
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
        const usable = (node) => node?.isConnected && !node.disabled && !node.closest?.('[hidden]');
        const { status, report: line } = elements();
        if (usable(opener)) opener.focus();
        else if (usable(status)) status.focus();
        else line?.focus?.();
      }
    }
  }

  // OneDrive's button signs in with no service named, which every host takes as OneDrive.
  function signIn(provider) {
    return run(async () => {
      try { await (provider === undefined ? onConnect() : onConnect(provider)); }
      catch (error) { report(`Sign-in did not start. ${cloudErrorText(error.message, getModel().scope)}`); }
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
          // Should the host hold another connection by now, this browser is asked again instead, which the
          // card's status says, so it is never told that backups are on.
          if (getModel().on) report(getModel().scope === 'device' ? 'Automatic backup is on.' : 'Automatic backup is on for this browser.', 'ok', true);
        } else {
          await onTurnOff();
          report(`Automatic backup is off${getModel().scope === 'device' ? '' : ' for this browser'}. Backups already in ${name} stay there.`, 'ok', false);
        }
      } catch (error) {
        const message = cloudErrorText(error.message, getModel().scope);
        report(on ? `Automatic backup was not turned on. ${message}` : `Automatic backup was not turned off. ${message}`);
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
        report(withOutcome('Nothing was changed.', cloudErrorText(error.message, getModel().scope), UNCHANGED));
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
        report(withOutcome('Nothing was changed.', cloudErrorText(result.error, getModel().scope), UNCHANGED));
        return;
      }
      report(result.changed === false ? withOutcome('Nothing was replaced.', cloudErrorText(result.error, getModel().scope), UNCHANGED)
        : withOutcome('The restore stopped part way.', result.error, STOPPED));
    });
  }

  // True when every one of this device's backups is gone. The reports name the account the question did.
  async function deleteOwnBackups(model) {
    let result;
    try { result = await onDeleteOwn(); }
    catch (error) {
      const off = !getModel().agreed;
      report(cloudDeleteFailure(error.message, off, getModel()), 'error', off ? false : null);
      return false;
    }
    const done = result.failed.length === 0;
    report(cloudDeleteReport(result, model), done ? 'ok' : 'warn', false);
    return done;
  }

  function deleteOwn() {
    return run(async () => {
      const model = getModel();
      const yes = await askConfirm({
        title: 'Delete this device\'s cloud backups?',
        body: cloudDeleteQuestion(model),
        confirmLabel: 'Delete cloud backups',
        danger: true,
      });
      if (yes) await deleteOwnBackups(model);
    });
  }

  function disconnect() {
    return run(async () => {
      const model = getModel();
      const name = cloudProviderName(model);
      const title = `Disconnect ${name}?`;
      const choice = model.host === 'connected' && model.hasStream;
      const body = cloudDisconnectQuestion(model, choice);
      let deleteFirst = false;
      if (choice) {
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
      if (deleteFirst && !(await deleteOwnBackups(model))) {
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
        report(`${name} is still connected. ${cloudErrorText(error.message, getModel().scope)}`);
      }
    });
  }

  function wire() {
    const nodes = elements();
    if (!nodes.card) return;
    nodes.signIn.addEventListener('click', () => { void signIn(); });
    nodes.signInGoogle?.addEventListener('click', () => { void signIn('googledrive'); });
    nodes.retry.addEventListener('click', () => { void run(async () => { onRetry(); }); });
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
