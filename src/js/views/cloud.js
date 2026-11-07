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
  icloud: Object.freeze({ name: 'iCloud', company: 'Apple', bin: null, button: 'connectICloud' }),
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

// Each notice says something only when the saved-copy record holds copies, or a check of it or a cleanup
// failed, so a connection that never kept a copy reads exactly as it did before copies could be kept.
function earlierCopiesNotice({ earlierKept, keptProblem } = {}) {
  if (keptProblem) {
    return 'The saved-copy record could not be checked or updated. Kept copies from earlier connections may need deleting by hand in their cloud folders; other kept copies may need the same.';
  }
  if (earlierKept === 1) {
    return 'One recorded kept copy from an earlier connection may remain. Check for this and any other earlier copies, and delete them by hand in their cloud folders.';
  }
  if (Number.isSafeInteger(earlierKept) && earlierKept > 1) {
    return `${earlierKept} recorded kept copies from earlier connections may remain. Check for these and any other earlier copies, and delete them by hand in their cloud folders.`;
  }
  return '';
}

function keptAttentionNotice({ keptAttention } = {}) {
  if (!Number.isSafeInteger(keptAttention) || keptAttention < 1) return '';
  const count = keptAttention === 1 ? 'One saved or attempted cloud copy' : `${keptAttention} saved or attempted cloud copies`;
  return `${count} could not be confirmed or removed. Check your cloud folder and delete any unwanted copies by hand.`;
}

function syncStatus(model) {
  const { sync } = model;
  if (!sync || sync.phase === 'off' || sync.phase === 'clear') return '';
  if (sync.phase === 'failed') {
    if (sync.code === 'hold-unconfirmed') return cloudErrorText(sync.error, model.scope);
    const failure = {
      keep: "This device's progress could not be kept.",
      load: 'The cloud progress could not be loaded.',
      back: 'The kept progress could not be loaded.',
      override: 'Automatic backups could not be resumed.',
      discard: 'The earlier Go back choice could not be cleared.',
    }[sync.action] ?? 'The cloud check did not finish.';
    return `${failure} Backups from this device are paused until Recap Page can check for progress from your other devices. ${cloudErrorText(sync.error, model.scope) ?? 'Check again.'}`;
  }
  if (sync.phase === 'offer') return 'Different progress was found in the cloud. Automatic backups are paused until you choose.';
  if (sync.phase === 'working') return 'Your cloud choice is being completed. Automatic backups are paused.';
  if (sync.phase === 'loaded') return sync.error ?? 'Progress was loaded. Automatic backups wait until the app reopens.';
  return 'Checking cloud progress. Automatic backups are paused.';
}

// The card's persistent line: the account, and what is happening to backups.
function cloudConnectionStatus(model, { when = longTime, at = shortTime } = {}) {
  const name = cloudProviderName(model);
  const device = model.scope === 'device';
  switch (model.host) {
    case 'unavailable': return cloudErrorText(model.message, model.scope) ?? 'Cloud backup is not available right now.';
    case 'not-answering': return device ? "Automatic backup is on, but the app's cloud backup is not answering, so backups wait until it does." : 'Automatic backup is on in this browser, but the Recap Page app is not answering for it, so backups wait until it does.';
    case 'signing-in': {
      const destination = device && model.provider === 'googledrive'
        ? 'on the sign-in screen' : 'in the browser window that opened';
      return `Finish signing in to ${companyOf(model)} ${destination}.${
        Number.isSafeInteger(model.signInExpiresAt) ? ` The sign-in stops by itself at ${at(model.signInExpiresAt)}.` : ''}`;
    }
    case 'not-connected': return cloudErrorText(model.message, model.scope) ?? '';
    case 'needs-sign-in': return `${companyOf(model)} asked for the sign-in to be made again, so backups have stopped. Sign in to carry on.`;
    case 'connected': {
      const connected = model.account ? `Connected to ${name} as ${model.account}.` : `Connected to ${name}.`;
      const account = model.waitingForUpload === true
        ? `${connected} iCloud has not finished uploading the latest backup yet.` : connected;
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
      return `${account} ${syncStatus(model) || cloudBackupStatus(model.backup, { name, when, at, scope: model.scope })}`;
    }
    default: return '';
  }
}

export function cloudCardStatus(model, options = {}) {
  const history = model.sync?.kept && model.sync.historyUnknown
    ? 'Earlier kept copies may exist. Check their cloud folders for copies the app cannot account for.' : '';
  const pending = model.sync?.keptUnavailable
    ? 'The last cloud recovery copy could not be confirmed, so Go back is unavailable. Choose Continue without Go back to load other progress.' : '';
  return [cloudConnectionStatus(model, options), earlierCopiesNotice(model), keptAttentionNotice(model), history, pending].filter(Boolean).join(' ');
}

// Stopped and failed states, which wear the warning notice, whose mark does not rely on color.
export function cloudCardWarns(model) {
  const { host } = model;
  if (model.sync?.phase === 'failed' || model.sync?.keptUnavailable) return true;
  if (model.keptProblem || model.keptAttention > 0) return true;
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
  if (host === 'connected' && model.sync?.phase === 'failed') return `sync-failed:${model.sync.error}`;
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
// it, and say where any backups made in another account are. A saved-copy notice is added only when there is one.
export function cloudDeleteQuestion(model) {
  const name = cloudProviderName(model);
  const recovery = model.provider === 'icloud' ? 'Recap Page cannot bring deleted backups back.'
    : `Deleted backups stay in ${name}'s ${binOf(model)} for up to 30 days, but Recap Page cannot bring them back.`;
  const rest = [`Backups from other devices or other accounts are kept; delete those in ${name}.`,
    earlierCopiesNotice(model), keptAttentionNotice(model), recovery].filter(Boolean).join(' ');
  if (model.scope === 'device') return `This turns automatic backup off and deletes every backup made on this device in ${accountIn(model)}. ${rest}`;
  return `This turns automatic backup off and deletes every backup this browser made in ${accountIn(model)}. ${rest}`;
}

export function cloudDeleteReport({ deleted, failed, earlier, attention: unresolved }, model) {
  const name = cloudProviderName(model);
  const where = accountIn(model);
  const device = model.scope === 'device';
  const from = device ? 'made on this device' : 'of this browser';
  const off = device ? 'Automatic backup is off' : 'Automatic backup is off for this browser';
  const remaining = failed.filter((entry) => !entry.deleted);
  let message;
  if (remaining.length === 0) {
    message = deleted === 0
      ? `No backups ${from} were in ${where}. Any ${device ? 'made' : 'it made'} in another account are still there. ${off}.`
      : model.provider === 'icloud'
        ? `Deleted ${plural(deleted, 'backup')} ${from} from ${where}. Recap Page cannot bring deleted backups back. ${off}.`
        : `Deleted ${plural(deleted, 'backup')} ${from} from ${where}, where ${deleted === 1 ? 'it stays' : 'they stay'} in the ${binOf(model)} for up to 30 days unless it is emptied. ${off}.`;
  } else {
    const reason = remaining[0].code === 'needs-sign-in' ? 'sign in again first'
      : remaining[0].code === 'timeout' ? `${name} did not answer in time`
        : remaining[0].code === 'unconfirmed' ? 'the kept copy could not be confirmed'
          : remaining[0].code === 'changed' ? 'a kept copy changed outside the app or could not be checked'
            : remaining[0].code === 'storage' ? 'the saved-copy record could not be updated'
              : `${name} did not delete ${remaining.length === 1 ? 'it' : 'them'}`;
    message = `Deleted ${deleted} of ${plural(deleted + remaining.length, 'backup')} ${from} from ${where}. ${plural(remaining.length, 'backup')} could not be deleted (${reason}). ${off}; delete again to finish.`;
  }
  const attention = failed.some((entry) => entry.changedOutside)
    ? 'A kept copy changed outside the app or could not be checked. Check it in its cloud folder.' : '';
  const recordAttention = failed.some((entry) => entry.deleted)
    ? 'The saved-copy record could not be updated after a deletion. Check the cloud folder before trying again.' : '';
  return [message, attention, recordAttention, earlierCopiesNotice({ earlierKept: earlier }),
    keptAttentionNotice({ keptAttention: unresolved })].filter(Boolean).join(' ');
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
  const lead = model.provider === 'icloud'
    ? 'Recap Page forgets its iCloud connection on this device, and automatic backup stops. This does not sign you out of iCloud.'
    : model.scope === 'device'
      ? `Recap Page forgets the ${name} sign-in on this device, and automatic backup stops.`
      : `Recap Page forgets the ${name} sign-in for every browser profile on this Windows account, and automatic backup stops in each of them.`;
  if (choice) {
    return [`${lead} Backups already in ${name} stay there unless you also delete this device's.`,
      earlierCopiesNotice(model), keptAttentionNotice(model)].filter(Boolean).join(' ');
  }
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

export function cloudSyncQuestion(offer, { when = longTime } = {}) {
  const different = offer.quiet || offer.kind !== 'remote-ahead';
  const { remote, local } = offer;
  const marked = (time) => time === null ? 'not marked read yet' : `last marked read ${when(time)}`;
  const facts = [
    `${remote.device} saved progress at ${when(remote.createdAt)}: ${remote.readCount} comics read, ${marked(remote.lastReadAt)}.`,
    `This device: ${local.readCount} comics read, ${marked(local.lastReadAt)}.`,
  ];
  const others = offer.othersDiffering > 0
    ? `${plural(offer.othersDiffering, 'other device')} also ${offer.othersDiffering === 1 ? 'has' : 'have'} different progress.` : '';
  const loadDisabled = Boolean(offer.priorPending);
  const warning = loadDisabled
    ? 'The earlier cloud recovery copy could not be confirmed, so Load is unavailable. In Backup & settings, choose Continue without Go back to allow another Load.'
    : different
      ? `Choose which progress to keep using.${offer.keepLocal === false ? '' : ' The other is kept as a copy.'}`
      : `Loading replaces what is on this device.${offer.keepLocal === false ? '' : " A copy of this device's progress is kept, and you can go back to it from Backup & settings."}`;
  return {
    title: different ? 'Your progress differs between devices' : 'Newer progress found',
    body: [...facts, others, warning].filter(Boolean).join('\n\n'),
    keepLabel: "Keep this device's progress",
    loadLabel: different ? "Load the other device's progress" : 'Load newer progress',
    focusKeep: different || loadDisabled, loadDisabled,
  };
}

export function cloudSyncDiscardQuestion() {
  return {
    title: 'Continue without Go back?',
    body: "The app will no longer offer Go back for the earlier restore. This does not change this device's progress or delete the cloud copies now. If you later load other progress or go back, the app may remove older kept copies.",
    confirmLabel: 'Continue without Go back',
  };
}

function syncOfferId(offer) {
  return JSON.stringify([
    offer.epoch, offer.remote, offer.localContentDigest, offer.kind, offer.othersDiffering, offer.keepLocal,
    offer.priorKept, offer.priorPending,
  ]);
}

export function createCloudSyncPrompt({
  elements, getModel, ask, withdraw, onKeep, onLoad, onFinished, report, announce = () => {},
  focusSuccessor = () => {}, onQuestionChange = () => {}, when = longTime,
}) {
  let question = null;
  let pendingQuestions = 0;
  let attempted = null;
  let announcedOffer = null;

  const currentOffer = () => {
    const sync = getModel()?.sync;
    return sync?.phase === 'offer' ? sync.offer : null;
  };

  function rescueFocus() {
    const document = globalThis.document;
    if (!document || document.querySelector('dialog[open]')) return;
    const active = document.activeElement;
    if (active?.isConnected && active !== document.body && active !== document.documentElement
      && !active.closest?.('[hidden], [inert], dialog:not([open])')) return;
    const { notice, review } = elements();
    if (currentOffer() && review && !review.disabled && !review.hidden && !notice?.hidden) {
      review.focus();
    } else {
      focusSuccessor();
    }
  }

  async function show(offer) {
    const id = syncOfferId(offer);
    if (question || syncOfferId(currentOffer() ?? offer) !== id || !currentOffer()) return;
    const ticket = { id, withdrawn: false };
    question = ticket;
    attempted = id;
    pendingQuestions += 1;
    try {
      onQuestionChange(true);
      render();
      let answer;
      try { answer = await ask(cloudSyncQuestion(offer, { when })); }
      catch (error) {
        report(error?.message ?? 'The cloud choice could not be opened.');
      }
      if (question !== ticket) return;
      question = null;
      const current = currentOffer();
      if (ticket.withdrawn || !current || syncOfferId(current) !== id || (answer !== 'keep' && answer !== 'load')) {
        render();
        if (answer !== 'busy') rescueFocus();
        return;
      }
      try {
        const result = await (answer === 'keep' ? onKeep() : onLoad());
        if (!result?.ok) report(result?.error ?? 'The cloud choice could not be completed. Check again.');
        else if (answer === 'load') onFinished(result.warning ?? 'Progress loaded from your cloud backup.');
        else announce("This device's progress was kept.");
      } catch (error) {
        report(error?.message ?? 'The cloud choice could not be completed. Check again.');
      }
      render();
      rescueFocus();
    } finally {
      if (question === ticket) question = null;
      pendingQuestions -= 1;
      onQuestionChange(pendingQuestions > 0);
    }
  }

  function render() {
    const { notice, message, review } = elements();
    if (!notice) return;
    const offer = currentOffer();
    const id = offer ? syncOfferId(offer) : null;
    if (question && question.id !== id && !question.withdrawn) {
      question.withdrawn = true;
      withdraw();
      const withdrawn = getModel()?.sync?.notice;
      if (withdrawn) announce(withdrawn);
    }
    if (!offer) {
      attempted = null;
      const withdrawn = getModel()?.sync?.notice;
      if (['clear', 'off'].includes(getModel()?.sync?.phase)) announcedOffer = null;
      notice.hidden = !withdrawn;
      if (review) review.hidden = true;
      if (message && withdrawn) message.textContent = withdrawn;
      return;
    }
    if (message) message.textContent = 'Your progress differs between devices.';
    if (review) review.hidden = false;
    if (!offer.quiet && !question && attempted !== id) {
      attempted = id;
      void show(offer);
    }
    notice.hidden = false;
    const announcement = JSON.stringify([offer.remote.stream ?? offer.remote.device, offer.kind]);
    if (!question && announcedOffer !== announcement) {
      announcedOffer = announcement;
      announce('Your progress differs between devices. Review progress.');
    }
  }

  function wire() {
    elements().review?.addEventListener('click', () => {
      const offer = currentOffer();
      if (offer) void show(offer);
    });
    render();
  }

  return { wire, render };
}

export function createCloudBackupView({
  el, elements, askConfirm, askConfirmChoice, notify, getModel, announce = () => {},
  onConnect, onTurnOn, onTurnOff, onDiscover, onFetch, onRestore, onDeleteOwn, onDisconnect, onRetry, onFinished,
  onSyncCheck, onSyncOverride, onSyncBack, onSyncDiscard,
  when = longTime, at = shortTime,
}) {
  let working = false;
  let syncQuestionPending = false;
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
  let lastSyncFailure = null;
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
      lastSyncFailure = null;
      return;
    }
    const { host } = model;
    const connected = host === 'connected';
    if (nodes.syncAbout) nodes.syncAbout.hidden = model.provider !== 'onedrive';
    nodes.intro.hidden = !(host === 'not-connected' || host === 'signing-in');
    const said = cloudCardStatus(model, { when, at });
    nodes.status.textContent = said;
    nodes.status.hidden = !said;
    const warns = cloudCardWarns(model);
    nodes.status.classList?.toggle('notice', warns);
    nodes.status.classList?.toggle('notice-warn', warns);
    const notice = noticeOf(model, heard?.host);
    const newKeptProblem = model.keptProblem && !heard?.keptProblem;
    const newKeptAttention = model.keptAttention > (heard?.keptAttention ?? 0);
    const syncFailed = connected && model.sync?.phase === 'failed';
    const newNotice = syncFailed
      ? !model.sync.action && notice !== lastSyncFailure
      : notice && notice !== heard?.notice;
    if (heard && said && (newKeptProblem || newKeptAttention || newNotice)) announce(said);
    if (syncFailed) lastSyncFailure = notice;
    else if (!connected || !model.on || ['off', 'clear', 'offer', 'ready', 'loaded'].includes(model.sync?.phase)) {
      lastSyncFailure = null;
    }
    heard = { host, notice, keptProblem: Boolean(model.keptProblem), keptAttention: model.keptAttention ?? 0 };
    nodes.progress.hidden = !(model.on && model.backup.phase === 'saving');
    const choices = cloudSignInChoices(model);
    for (const [provider, { button }] of Object.entries(PROVIDERS)) {
      if (nodes[button]) nodes[button].hidden = !choices.includes(provider);
    }
    if (nodes.intro && introText === null) introText = nodes.intro.textContent;
    if (nodes.intro) {
      nodes.intro.textContent = choices.length > 0
        ? `Keep a complete backup in your own ${choices.map((provider) => PROVIDERS[provider].name).join(' or ')}, made automatically as you read.`
        : introText;
    }
    nodes.retry.hidden = !(model.on && (model.backup.phase === 'failed' || model.backup.phase === 'retrying'));
    nodes.primary.hidden = choices.length === 0 && nodes.retry.hidden;
    const agreed = model.agreed && !model.askedAgain;
    nodes.auto.hidden = !(connected || (model.agreed && host !== 'not-connected' && host !== 'signing-in'));
    nodes.autoInput.checked = toggling ?? agreed;
    if (nodes.syncActions) {
      const sync = model.sync;
      nodes.syncCheck.hidden = sync?.phase !== 'failed';
      nodes.syncOverride.hidden = sync?.phase !== 'failed';
      nodes.syncOverride.disabled = working || !sync?.canOverride;
      nodes.syncBack.hidden = !(sync?.phase === 'clear' && sync.kept && !sync.keptUnavailable);
      if (nodes.syncDiscard) {
        nodes.syncDiscard.hidden = !sync?.keptUnavailable || !['clear', 'offer', 'failed'].includes(sync.phase);
        nodes.syncDiscard.disabled = working || syncQuestionPending;
      }
      nodes.syncActions.hidden = nodes.syncCheck.hidden && nodes.syncOverride.hidden && nodes.syncBack.hidden
        && (nodes.syncDiscard?.hidden ?? true);
      nodes.syncCheck.disabled = working;
      nodes.syncBack.disabled = working;
    }
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
    for (const control of [nodes.signIn, nodes.signInGoogle, nodes.connectICloud, nodes.retry, nodes.remove, nodes.disconnect, ...(nodes.found.querySelectorAll?.('button') ?? [])]) {
      if (control) control.disabled = working;
    }
    nodes.autoInput.disabled = working || (!nodes.autoInput.checked && !connected);
  }

  // The control that started an action is disabled while it runs, so the shared question cannot hand
  // focus back to it when it closes. It is handed back here once usable; when the action has moved the
  // card on and the control is gone, focus goes to the card's status, or, when that says nothing, to the
  // report of what was done, so it never falls to the page (stage 3 review, S3b-1).
  async function run(action, { reportWhenGone = false } = {}) {
    if (working) return;
    const opener = globalThis.document?.activeElement ?? null;
    working = true;
    render();
    try { await action(); }
    finally {
      working = false;
      render();
      const active = globalThis.document?.activeElement;
      const lost = !active || active === globalThis.document.body || active === globalThis.document.documentElement
        || !active.isConnected || active.closest?.('[hidden], [inert], dialog:not([open])');
      if (lost) {
        const usable = (node) => node?.isConnected && node !== globalThis.document?.body
          && node !== globalThis.document?.documentElement && !node.disabled && !node.closest?.('[hidden]')
          && !node.closest?.('[inert], dialog:not([open])');
        const { status, report: line } = elements();
        if (usable(opener)) opener.focus();
        else if (reportWhenGone && usable(line)) line.focus();
        else if (usable(status)) status.focus();
        else line?.focus?.();
      }
    }
  }

  // OneDrive's button signs in with no service named, which every host takes as OneDrive.
  function signIn(provider) {
    return run(async () => {
      try { await (provider === undefined ? onConnect() : onConnect(provider)); }
      catch (error) {
        const stopped = provider === 'icloud' ? 'iCloud could not be connected.' : 'Sign-in did not start.';
        report(`${stopped} ${cloudErrorText(error.message, getModel().scope)}`);
      }
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
    }, { reportWhenGone: true });
  }

  function syncOverride() {
    return run(async () => {
      const yes = await askConfirm({
        title: 'Back up this device anyway?',
        body: 'This device may not have the newest cloud progress. Backing it up now may offer older progress to your other devices.',
        confirmLabel: 'Back up this device anyway',
      });
      if (!yes) return;
      const result = await onSyncOverride();
      if (!result.ok) report(result.error);
      else announce('Automatic backups can continue.');
    });
  }

  function syncBack() {
    return run(async () => {
      const yes = await askConfirm({
        title: 'Go back to what was on this device before?',
        body: "Loading the kept copy replaces what is on this device. A separate cloud copy of this device's current progress is kept first.",
        confirmLabel: 'Go back to what was on this device before',
      });
      if (!yes) return;
      const result = await onSyncBack();
      if (!result.ok) report(result.error);
      else onFinished(result.warning ?? 'Kept progress loaded from your cloud backup.');
    });
  }

  function syncDiscard() {
    if (syncQuestionPending) return undefined;
    return run(async () => {
      const yes = await askConfirm(cloudSyncDiscardQuestion());
      if (!yes) return;
      const result = await onSyncDiscard();
      if (!result.ok) report(result.error);
      else announce('The earlier Go back choice was cleared. Cloud copies were not deleted.');
    });
  }

  function wire() {
    const nodes = elements();
    if (!nodes.card) return;
    nodes.signIn?.addEventListener('click', () => { void signIn(); });
    nodes.signInGoogle?.addEventListener('click', () => { void signIn('googledrive'); });
    nodes.connectICloud?.addEventListener('click', () => { void signIn('icloud'); });
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
    nodes.syncCheck?.addEventListener('click', () => { void run(() => onSyncCheck()); });
    nodes.syncOverride?.addEventListener('click', () => { void syncOverride(); });
    nodes.syncBack?.addEventListener('click', () => { void syncBack(); });
    nodes.syncDiscard?.addEventListener('click', () => { void syncDiscard(); });
    render();
  }

  function setSyncQuestionPending(pending) {
    if (syncQuestionPending === pending) return;
    syncQuestionPending = pending;
    render();
  }

  return { wire, render, setSyncQuestionPending };
}
