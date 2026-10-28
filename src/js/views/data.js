// Backup/Data and Settings view presentation.
//
// Owns the event wiring for every control on the Backup & Settings screen: export, restore,
// undo, cover art, theme, API base, cache clear, and erase. Each handler
// validates locally and delegates the actual state change to an injected callback, so this
// module never touches the Store, cache, API, Hydrator, or SynopsisRunner.

import { wireFieldValidation } from './shared/field-validation.js';

// ------------------------------------------------------------------ reading-data contents
//
// What a reading-data backup holds, and so what every restore of one replaces. A restore swaps the
// whole saved value for the backup's, and exportBackup() in the model names each map it carries:
// lists with their order, notes and deferrals, issue notes, ratings, read marks, availability
// overrides, and the issue records, of which only those added by hand were written by the reader.
//
// One phrase, because two copies drifted. The backup card named ratings and deferrals while the
// restore, Undo and saved-copy questions said only "lists, notes and reading progress", so a reader
// restoring an older backup could lose ratings the question never mentioned. The card and all three
// questions read this string now, as do the erase question and the line beside its button, and the
// data view tests hold it to the keys a backup carries.
const READING_DATA_CONTENTS = 'lists, notes, issue ratings, reading progress, deferrals, availability overrides and issues added by hand';

// ------------------------------------------------------------------ erase policy
//
// BL-113's decision, and the reason it is a pair of sentences rather than a wider erase.
//
// The rule at `src/js/storage.js:637-640` stands: nothing but the reader removes a salvage copy,
// because no rule this app could apply would know whether they still want data it could not read
// itself. So the erase is not widened to reach those copies, and the wording is narrowed to stop
// claiming that it does. They are not undisclosed either way, which is what separates them from
// the undo snapshot BL-101 did withdraw: they are listed on this same screen, directly above this
// button, each with its own Remove.
//
// Narrowing is also the half of the choice that can be taken back. A dialog that overstates can be
// corrected later against copies that still exist; an erase that has already destroyed the last
// record of data nobody could open cannot be.
//
// Three answers rather than two, the same three renderSalvage() gives and for the same reason. A
// browser that will not enumerate its own storage has not said there is nothing, it has declined
// to say, and promising that everything is gone on the strength of a refusal is the one answer
// that can be wrong in the direction that matters.
//
// A fourth thing to read, and the one the first version of this got wrong: whether a copy is
// live. renderSalvage() puts a note where the Remove button would be on a live copy, so naming
// that button while one is live sends the reader to a control the screen is withholding, and it
// does it in the state where a copy is likeliest to exist at all. Location is claimed either
// way, because that half is true either way; only the button is conditional.
//
// Settings are named because they outlive every one of these answers. Erasing never removes
// mrt.settings or sidebar.collapsed (of the data routes, only a complete restore, or putting back
// what one replaced, touches them), so this branch's old sentence, that the route clears
// everything this browser has stored for the tracker, was false for any reader who had ever
// changed the theme. docs/ARCHITECTURE.md holds the whole list and calls those two preferences
// rather than data, which is why the message said afterwards still reports all local data erased
// and only the promise made beforehand had to be narrowed.
//
// #851 widened the other half, what the erase does reach. It writes an empty value over the whole
// of the saved reading data, so the lead names everything a backup holds, from the phrase the
// restore questions use, rather than the lists and progress alone: availability overrides and
// issues added by hand went unnamed. It also removes the saved reading-data copy behind Undo,
// and naming the copies it leaves while leaving out the one it destroys read as if that one
// survived. The copy gets the same three answers as the kept-aside ones, with storage that will
// not say treated as not knowing, and it is named before the settings sentence so that what is
// erased and what is kept never share a sentence.
export function eraseDialogBody(copies, { completionHistory = false, savedCopy = false } = {}) {
  const tail = ' Export a backup first if you are not sure. It cannot be undone.';
  const lead = `This clears all ${READING_DATA_CONTENTS}.`;
  const history = completionHistory ? ' Completion and enjoyment history will also be erased.' : '';
  const saved = savedCopy === null
    ? ' The app could not check for a saved reading-data copy. If there is one, it will be erased too.'
    : savedCopy ? ' The saved reading-data copy will be erased too.' : '';
  const scope = `${lead}${history}${saved} Your settings are kept.`;
  if (copies === null) {
    return `${scope} This browser will not let the app list what else it has stored, so anything `
      + `kept aside after a failed read is not reached and stays where it is.${tail}`;
  }
  if (copies.length === 0) return `${scope}${tail}`;
  const one = copies.length === 1;
  const where = `${scope} `
    + `${one ? 'One copy' : `${copies.length} copies`} of data this app could not read `
    + `${one ? 'is' : 'are'} kept aside, and this does not reach ${one ? 'it' : 'them'}. `
    + `${one ? 'It stays' : 'They stay'} under "Copies kept after a failed read" above`;
  if (copies.some((c) => c.live)) {
    return `${where}, and only you can remove ${one ? 'it' : 'them'}.${tail}`;
  }
  return `${where}, with ${one ? 'its' : 'their'} own Remove button.${tail}`;
}

// What is said once the erase has landed, composed rather than chosen, because the snapshot and
// the salvage copies survive independently and either, both or neither can be left. The plain
// sentence is kept for the case where nothing was, so an ordinary erase still reports plainly.
//
// Every clause is said only when it is true. A storage that refuses the removal leaves a whole
// copy of the tracker behind a live button, after a dialog that promised nothing would survive,
// and the reader can act on that only if they are told which button it is. The same holds for the
// copies this route deliberately does not reach: naming where they are is the difference between
// disclosing them and merely not having lied.
export function eraseOutcome(snapshotKept, copies, {
  historyKept = false, historyError = null, readerChanged = false, cacheFailure = null, currentFacts = false, draftKept = false,
} = {}) {
  const notes = [];
  if (draftKept === null) {
    notes.push('The import draft could not be checked after the erase. Do not assume its source was removed; check the separate import draft in Backup & settings.');
  } else if (draftKept) {
    notes.push('An import draft and its source are still saved. Check the separate import draft in Backup & settings.');
  }
  if (cacheFailure) notes.push(cacheFailure);
  if (historyKept === null) {
    notes.push('Completion history could not be checked after the erase. Retry reading completion history in Backup & settings.');
  } else if (historyKept) {
    notes.push(historyError || (currentFacts
      ? 'Completion and enjoyment history is still saved. Check Completion history in Backup & settings.'
      : 'Completion and enjoyment history could not be cleared and may still be saved. Check Completion history in Backup & settings.'));
  }
  if (snapshotKept === null) {
    notes.push('The pre-restore copy could not be checked. Do not assume it was removed; check the saved reading-data copy controls before erasing again.');
  } else if (snapshotKept) {
    notes.push(currentFacts
      ? 'One pre-restore copy is still saved in this browser, under the saved reading-data copy controls.'
      : 'One copy could not be removed and is still in this browser, under the saved reading-data copy controls.');
  }
  if (copies === null) {
    notes.push('This browser will not list what else it has stored, so anything kept aside after a failed read is still here.');
  } else if (copies.length === 1) {
    notes.push('One copy kept after a failed read is still here, under "Copies kept after a failed read".');
  } else if (copies.length > 1) {
    notes.push(`${copies.length} copies kept after a failed read are still here, under "Copies kept after a failed read".`);
  }
  if (notes.length === 0 && readerChanged === false) return 'All local data erased.';
  const lead = readerChanged === null
    ? 'Reading data could not be checked after the erase. Reload and check your library before erasing again.'
    : readerChanged ? 'Reading data changed after the erase. Check your library before erasing again.' : 'Lists and reading progress erased.';
  return [lead, ...notes].join(' ');
}

// ------------------------------------------------------------------ view factory

export function createDataView({
  elements,
  getApiBase,
  getSalvageCopies,
  hasPreRestoreSnapshot,
  getRestoreOffer,
  inspectBackup,
  isAllowedApiBase,
  backupFileRefusal,
  askConfirm,
  notify,
  onExportJson,
  onExportMarkdown,
  onExportOrder,
  onRestore,
  onUndoRestore,
  onExportRestoreCopy,
  onSetCovers,
  onSetTheme,
  onSetReadingShortcut,
  onSetDescriptionHiding,
  onCheckLocalConnection,
  onApiBaseSubmit,
  onClearCache,
  onErase,
  captureDraft,
  draftFileRefusal,
  onExportDraft,
  onRestoreDraft,
  getRecoveryCopy = null,
  eraseHistory = false,
}) {
  let restoring = false;

  function renderRestoreOffer() {
    if (!getRestoreOffer) return;
    const nodes = elements();
    const offer = getRestoreOffer();
    nodes.undoRestore.hidden = !offer.available;
    nodes.undoRestore.disabled = restoring || !!offer.identical;
    nodes.undoRestore.textContent = offer.kind === 'undo' ? 'Undo last restore' : 'Restore saved reading-data copy';
    if (nodes.restoreCopySummary) {
      nodes.restoreCopySummary.textContent = !offer.ok ? offer.errors.join(' ')
        : !offer.available ? 'No saved reading-data copy is available.'
          : `${offer.summary} ${offer.kind === 'undo'
            ? 'This is your reading data from before the last restore in this tab.'
            : 'Direction is not recorded for this retained copy. Restoring it replaces your current reading data.'}`
            + (offer.edited ? ' Reading data has changed since that restore; Undo would replace those edits.' : '')
            + (offer.identical ? ' This copy already matches your saved data.' : '');
    }
    if (nodes.btnExportRestoreCopy) {
      nodes.btnExportRestoreCopy.hidden = !offer.available;
      nodes.btnExportRestoreCopy.disabled = restoring;
    }
  }

  // Whether the erase question should name the saved reading-data copy: true when one exists,
  // false when none does, and null when storage would not say, which the question reports as not
  // knowing rather than as nothing to lose.
  function savedCopyState() {
    try {
      const offer = getRestoreOffer ? getRestoreOffer() : { ok: true, available: hasPreRestoreSnapshot?.() ?? false };
      return offer.ok ? Boolean(offer.available) : null;
    } catch {
      return null;
    }
  }

  function reportRestore(res, success) {
    if (res.ok) notify('#restore-report', success, 'ok');
    else {
      const lead = res.changed === null
        ? 'Restore did not finish. The saved reading-data outcome is unknown. Keep this page open, download any retained copy, then reload and check your library.'
        : res.changed === true ? 'Reading data changed, but restore did not finish. Check your library and retained copy.'
          : 'Reading data is unchanged. Choose a reading-data JSON backup from this app and try again.';
      notify('#restore-report', `${lead} ${res.errors.join(' ')}`, 'error');
    }
    renderRestoreOffer();
  }

  function renderLocalConnectionStatus(status, readyStatus) {
    const line = elements().localConnectionStatus;
    if (!line) return;
    if (status === readyStatus) {
      line.textContent = 'Connected to the local app.';
      return;
    }
    if (status === 'checking') {
      line.textContent = 'Checking the local app connection…';
      return;
    }
    line.textContent = 'The local app connection needs attention.';
  }

  function clearLocalConnectionReport() {
    elements().localConnectionReport?.replaceChildren();
  }

  function renderCacheUsage(usage) {
    const line = elements().cacheUsage;
    if (!line) return;
    line.textContent = usage
      ? (usage.count
        ? `${usage.count} cached responses, about ${(usage.bytes / 1024 / 1024).toFixed(2)} MB of a ${(usage.budget / 1024 / 1024).toFixed(0)} MB budget.`
        : 'Nothing cached yet.')
      : 'Cache unavailable in this browser. The app still works, just with more network requests.';
  }

  function wire() {
    const nodes = elements();
    const apiValidation = wireFieldValidation({
      field: nodes.apiBase,
      reportId: 'api-report',
      reportError: (message) => notify('#api-report', message, 'error'),
      invalidMessage: 'Enter a complete metadata API URL.',
    });
    nodes.apiBase.value = getApiBase();
    nodes.optCovers.addEventListener('change', (e) => onSetCovers(e.target.checked));
    nodes.optTheme.addEventListener('change', (e) => onSetTheme(e.target.value));
    nodes.optReadingShortcut.addEventListener('change', (e) => onSetReadingShortcut(e.target.checked));
    nodes.optDescriptionHiding.addEventListener('change', (e) => onSetDescriptionHiding(e.target.checked));
    nodes.btnCheckLocalConnection.addEventListener('click', () => {
      void onCheckLocalConnection();
    });

    nodes.btnExportJson.addEventListener('click', onExportJson);
    if (nodes.backupContents) nodes.backupContents.textContent = `Reading-data backups contain ${READING_DATA_CONTENTS}.`;
    if (nodes.eraseContents) {
      nodes.eraseContents.textContent = `Erasing removes all ${READING_DATA_CONTENTS}, plus ${eraseHistory ? 'completion and enjoyment history, ' : ''}the import draft and any saved reading-data copy.`;
    }
    nodes.btnExportRestoreCopy?.addEventListener('click', onExportRestoreCopy);
    const restoreValidation = wireFieldValidation({
      field: nodes.restoreFile, reportId: 'restore-report',
      reportError: (message) => notify('#restore-report', message, 'error'),
      invalidMessage: 'Choose a reading-data JSON backup from this app.',
    });
    const draftValidation = nodes.restoreDraft ? wireFieldValidation({
      field: nodes.restoreDraft, reportId: 'draft-transfer-report',
      reportError: (message) => notify('#draft-transfer-report', message, 'error'),
      invalidMessage: 'Choose a supported import draft file.',
    }) : null;
    nodes.btnExportDraft?.addEventListener('click', onExportDraft);
    nodes.restoreDraft?.addEventListener('change', async (event) => {
      const file = event.target.files?.[0];
      if (!file) return;
      const expected = captureDraft();
      try {
        const refusal = draftFileRefusal(file);
        if (refusal) throw new Error(refusal);
        const text = await file.text();
        const yes = await askConfirm({
          title: 'Restore this separate import draft?',
          body: 'Reading data and completion history stay unchanged. Any current draft source is retained inside the new draft file, within its size limit. Restored work needs explicit Resume review before applying anything.',
          confirmLabel: 'Restore draft',
        });
        if (!yes) return;
        const result = await onRestoreDraft(text, expected);
        if (result.invalid) {
          draftValidation.fail(result.error);
          return;
        }
        notify('#draft-transfer-report', result.ok
          ? 'Import draft restored. Reading data was not changed. Review Resume saved import in Search.'
          : `${result.changed === null ? 'Draft storage outcome is unknown; export retained source before reloading.' : 'Draft restore did not finish.'} ${result.error}`, result.ok ? 'ok' : 'error');
      } catch (error) {
        draftValidation.fail(`Import draft restore refused: ${error.message}`);
      } finally {
        event.target.value = '';
        event.target.focus();
      }
    });

    nodes.btnExportMd.addEventListener('click', onExportMarkdown);
    nodes.btnExportOrder.addEventListener('click', onExportOrder);

    nodes.restoreFile.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file || restoring) return;
      const expected = getRestoreOffer?.();
      // Asked of the file's declared size, so a file picked by mistake is refused before text()
      // pulls it into memory. The check is here rather than in the store because by the time the
      // store sees a backup it is already a string, which is the cost this avoids.
      const refusal = backupFileRefusal(file);
      if (refusal) {
        restoreValidation.fail(`Reading data is unchanged. Choose a reading-data JSON backup from this app and try again. ${refusal}`);
        e.target.value = '';
        return;
      }
      restoring = true;
      nodes.restoreFile.disabled = true;
      let cancelled = false;
      let replacementReached = false;
      try {
        if (expected && !expected.ok) {
          reportRestore({ ...expected, changed: false }, '');
          return;
        }
        const text = await file.text();
        const checked = inspectBackup?.(text);
        if (checked && !checked.ok) {
          restoreValidation.fail(`Reading data is unchanged. Choose a reading-data JSON backup from this app and try again. ${checked.errors.join(' ')}`);
          return;
        }
        const yes = await askConfirm({
          title: 'Replace reading data with this backup?',
          body: `This replaces all ${READING_DATA_CONTENTS}. Your current reading data will be kept as a saved copy. Completion history and settings stay unchanged. Import draft source stays saved but needs Resume review before more comics can be applied.`,
          confirmLabel: 'Restore reading data',
        });
        if (!yes) { cancelled = true; return; }
        restoreValidation.clear();
        replacementReached = true;
        const res = onRestore(text, expected);
        reportRestore(res, 'Reading data restored. Check the saved-copy summary for recovery. Completion history is unchanged.');
        if (!getRestoreOffer) nodes.undoRestore.hidden = !hasPreRestoreSnapshot();
      } catch (error) {
        if (replacementReached) reportRestore({ ok: false, changed: null, errors: [error.message] }, '');
        else restoreValidation.fail(`Reading data is unchanged. The backup file could not be read (${error.message}). Choose the file again or try another reading-data backup.`);
      } finally {
        restoring = false;
        nodes.restoreFile.disabled = false;
        e.target.value = '';
        renderRestoreOffer();
        if ((cancelled || nodes.restoreFile.getAttribute('aria-invalid') === 'true')
          && nodes.restoreFile.isConnected && !nodes.restoreFile.closest('[hidden]')) nodes.restoreFile.focus();
      }
    });

    nodes.undoRestore.addEventListener('click', async () => {
      if (restoring) return;
      const offer = getRestoreOffer?.();
      if (offer && (!offer.ok || !offer.available)) {
        reportRestore({ ok: false, changed: false, errors: offer.errors || ['No saved reading-data copy is available.'] }, '');
        return;
      }
      restoring = true;
      renderRestoreOffer();
      let cancelled = false;
      try {
        const yes = await askConfirm({
          title: offer?.kind === 'undo' ? 'Undo the last reading-data restore?' : 'Replace reading data with the saved copy?',
          body: `${offer?.summary || ''} This replaces all current ${READING_DATA_CONTENTS}.${offer?.edited ? ' Reading data has changed since the restore; these intervening edits will be replaced.' : ''} The data you replace stays as the next saved copy, not another Undo. Completion history and settings stay unchanged. Import draft source is retained and needs Resume review.`,
          confirmLabel: offer?.kind === 'undo' ? 'Undo restore' : 'Restore saved copy',
        });
        if (!yes) { cancelled = true; return; }
        const res = onUndoRestore(offer);
        reportRestore(res, offer?.kind === 'undo'
          ? 'Restore undone. The replaced reading data is retained as a saved copy, not another Undo.'
          : 'Saved reading-data copy restored. The replaced data is retained as the next saved copy.');
      } catch (error) {
        reportRestore({ ok: false, changed: null, errors: [error.message] }, '');
      } finally {
        restoring = false;
        renderRestoreOffer();
        if (cancelled && nodes.undoRestore.isConnected && !nodes.undoRestore.closest('[hidden]')) nodes.undoRestore.focus();
      }
    });

    // Measured at 200 per cent zoom, the API notice landed 658 px above view, and cache clearing
    // replaced a restore refusal.
    nodes.formSettings.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = nodes.apiBase.value.trim().replace(/\/+$/, '');
      if (!isAllowedApiBase(value)) {
        apiValidation.fail('That API URL is not usable: use https, or http against a loopback address.');
        return;
      }
      onApiBaseSubmit(value);
    });

    nodes.btnClearCache.addEventListener('click', async () => {
      nodes.btnClearCache.disabled = true;
      try {
        await onClearCache();
      } finally {
        nodes.btnClearCache.disabled = false;
      }
    });

    nodes.btnWipe.addEventListener('click', async () => {
      if (nodes.btnWipe.disabled) return;
      nodes.btnWipe.disabled = true;
      let cancelled = false;
      const draftExpected = captureDraft?.();
      try {
        // Asked of the journal itself, so the question names a recovery copy only while one is held:
        // true names it, false leaves it out, and null says the app could not check.
        let recoveryCopy = false;
        try { recoveryCopy = getRecoveryCopy ? await getRecoveryCopy() : false; } catch { recoveryCopy = null; }
        const recovery = recoveryCopy === null
          ? ' The app could not check for a recovery copy kept by a complete restore, so one may still be kept after the erase.'
          : recoveryCopy ? ' The recovery copy kept by a complete restore is erased too.' : '';
        const yes = await askConfirm({
          title: eraseHistory ? 'Erase every list, reading progress and completion history?' : 'Erase every list and all reading progress?',
          body: `${eraseDialogBody(getSalvageCopies(), { completionHistory: eraseHistory, savedCopy: savedCopyState() })} The saved import draft and its retained source snapshots will also be removed after the reading-data erase is verified.${recovery}`,
          confirmLabel: 'Erase everything',
          danger: true,
        });
        if (!yes) {
          cancelled = true;
          return;
        }
        await onErase(draftExpected);
      } finally {
        nodes.btnWipe.disabled = false;
        if (cancelled && nodes.btnWipe.isConnected && !nodes.btnWipe.closest('[hidden]')) nodes.btnWipe.focus();
      }
    });
  }

  return {
    wire,
    clearLocalConnectionReport,
    renderCacheUsage,
    renderLocalConnectionStatus,
    renderRestoreOffer,
  };
}

// ------------------------------------------------------------------ complete backup
//
// The Complete backup card: one file holding every kind of saved data, its restore, and the recovery
// section an interrupted restore leaves behind. Like the rest of this module it checks locally and
// hands every change to an injected callback, so it never touches storage or the restore engine.
//
// The restore question wears the danger appearance because a finished complete restore cannot be undone
// as a whole: its recovery copy is for an interrupted restore, not an Undo. Putting the earlier data
// back during recovery does not, because the backup file is still there to restore again.

function plural(count, one, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

// Each report states its outcome once. Messages from the backup file and the restore engine often end
// by saying what happened, so the lead-in that says the same thing is added only when they do not.
const UNCHANGED = /\bnothing (?:further |more )?was (?:changed|replaced|removed)\b/i;
const STOPPED = /\bstopped\b/i;
export function withOutcome(lead, message, said) {
  return said.test(message) ? message : `${lead} ${message}`;
}

// The counts belong to the file, so they are attached to it: a device with ten lists restoring a file
// with two is replacing its ten with the file's two, not "your reading data (2 lists)".
export function completeRestoreQuestion({ lists, records, draft }) {
  const counted = `This replaces your reading data with this file's ${plural(lists, 'list')}, your completion history with its ${plural(records, 'record')}`;
  return `${counted}${draft
    ? ', your display and reading preferences with the ones in this file, and your import draft with the one in this file. '
    : ' and your display and reading preferences with the ones in this file, and removes any import draft, because this file has none. '}`
    + 'A finished complete restore cannot be undone as a whole, so download a complete backup first if you might want the current data back. '
    + 'Close any other Recap Page tabs and windows first, including ones running an older version.';
}

// Keeping the current data deletes the recovery copy only when one can be read, so the question says
// what happens to the copy this recovery actually has. The exact prior copy can be downloaded but not
// restored by this version, so the question says so before the copy goes.
export function keepCurrentQuestion(recovery) {
  const lead = 'Recovery ends and saving starts again with the data this browser holds now, which may mix restored and earlier data.';
  if (recovery?.download === 'prior') {
    return `${lead} The recovery copy is then deleted, so download the exact prior copy first if you might need it. `
      + 'This version cannot restore that copy: it is for recovering the earlier data by hand or with help.';
  }
  if (recovery?.download === 'raw') {
    return `${lead} The recovery copy, which this version cannot read, is then deleted, so download it first if you might need it. `
      + 'Its data can only be recovered by hand or with help.';
  }
  if (recovery?.kind === 'unchecked') {
    return `${lead} The recovery copy could not be checked, so it is not deleted, and a later start offers it again once it can be read.`;
  }
  return `${lead} There is no recovery copy left to delete.`;
}

export function createCompleteBackupView({
  elements, askConfirm, notify, getState, onExport, parse, summarize, fileRefusal,
  onRestore, onRecover, onKeepCurrent, onDownloadPrior, onFinished,
}) {
  let working = false;
  let validation = null;
  const report = (message, kind = 'error') => notify('#complete-backup-report', message, kind);

  function render(state = getState()) {
    const nodes = elements();
    if (!nodes.card) return;
    const recovery = state.recovery;
    // A file made while a restore is running or waiting for recovery would mix two moments.
    nodes.download.disabled = working || !['open', 'unavailable'].includes(state.phase);
    nodes.restore.disabled = working || !state.available;
    nodes.unavailable.hidden = !state.unavailableReason;
    nodes.unavailable.textContent = state.unavailableReason ?? '';
    nodes.recovery.hidden = !recovery;
    nodes.status.textContent = recovery?.message ?? '';
    nodes.priorCopy.hidden = !recovery?.download;
    nodes.finish.hidden = !recovery?.canFinish;
    nodes.restorePrior.hidden = !recovery?.canRestorePrior;
    nodes.keep.hidden = !recovery?.canKeep;
    for (const button of [nodes.priorCopy, nodes.finish, nodes.restorePrior, nodes.keep]) {
      button.disabled = working || state.busy;
    }
  }

  // The control that started an action is disabled while it runs, so the shared question cannot hand
  // focus back to it when it closes. It is handed back here once the control is usable again.
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
      if (lost && opener?.isConnected && !opener.disabled && !opener.closest?.('[hidden]')) opener.focus();
    }
  }

  function exportBackup() {
    return run(async () => {
      try { await onExport(); }
      catch (error) { report(`The complete backup was not made. ${error.message}`); }
    });
  }

  async function restoreFile(event) {
    const field = event.target;
    const file = field.files?.[0];
    if (!file || working) return;
    const refusal = fileRefusal(file);
    if (refusal) {
      validation.fail(refusal);
      field.value = '';
      return;
    }
    let cancelled = false;
    await run(async () => {
      try {
        const text = await file.text();
        let backup;
        try { backup = await parse(text); }
        catch (error) {
          validation.fail(withOutcome('Nothing was changed.', error.message, UNCHANGED));
          return;
        }
        const yes = await askConfirm({
          title: 'Replace all saved data with this complete backup?',
          body: completeRestoreQuestion(summarize(backup)),
          confirmLabel: 'Restore complete backup',
          danger: true,
        });
        if (!yes) { cancelled = true; return; }
        validation.clear();
        const result = await onRestore(text);
        if (result.ok) { onFinished('Complete backup restored. Any import draft from it waits in Search for your review.'); return; }
        if (result.invalid) { validation.fail(withOutcome('Nothing was changed.', result.error, UNCHANGED)); return; }
        report(result.changed === false ? withOutcome('Nothing was replaced.', result.error, UNCHANGED)
          : withOutcome('The restore stopped part way.', result.error, STOPPED));
      } catch (error) {
        report(`The backup file could not be read (${error.message}). Nothing was changed.`);
      } finally {
        field.value = '';
      }
    });
    // Cancel leaves the restore unapplied and the reader where they chose the file.
    if (cancelled && field.isConnected && !field.disabled) field.focus();
  }

  function recover(direction) {
    const finish = direction === 'forward';
    return run(async () => {
      // Two questions rather than one with a computed style: finishing cannot be taken back as a whole,
      // while putting the earlier data back can, because the backup file is still there to restore.
      let yes;
      if (finish) {
        yes = await askConfirm({
          title: 'Finish the complete restore?',
          body: 'This writes the rest of the restored data. A finished complete restore cannot be undone as a whole, so download the exact prior copy first if you might want the earlier data.',
          confirmLabel: 'Finish restore',
          danger: true,
        });
      } else {
        yes = await askConfirm({
          title: 'Put the earlier data back?',
          body: 'This writes back exactly the data from before the restore. The backup file you restored from is unchanged, so you can restore it again later.',
          confirmLabel: 'Restore prior data',
        });
      }
      if (!yes) return;
      const result = await onRecover(direction);
      if (result.ok) {
        onFinished(finish ? 'The complete restore is finished. Any import draft from it waits in Search for your review.'
          : 'The earlier data is back, and saving has started again.');
        return;
      }
      report(result.error);
    });
  }

  function keepCurrent() {
    return run(async () => {
      const yes = await askConfirm({
        title: 'Keep the data that is here now?',
        body: keepCurrentQuestion(getState().recovery),
        confirmLabel: 'Keep current data',
        danger: true,
      });
      if (!yes) return;
      const result = await onKeepCurrent();
      if (result.ok) { onFinished('Recovery ended. Saving has started again with the data that was here.'); return; }
      report(result.error);
    });
  }

  function downloadPrior() {
    return run(async () => {
      try { await onDownloadPrior(); }
      catch (error) { report(`The prior copy could not be downloaded. ${error.message}`); }
    });
  }

  function wire() {
    const nodes = elements();
    if (!nodes.card) return;
    validation = wireFieldValidation({
      field: nodes.restore, reportId: 'complete-backup-report',
      reportError: (message) => report(message),
      invalidMessage: 'Choose a complete backup file from this app.',
    });
    nodes.download.addEventListener('click', () => { void exportBackup(); });
    nodes.restore.addEventListener('change', (event) => { void restoreFile(event); });
    nodes.priorCopy.addEventListener('click', () => { void downloadPrior(); });
    nodes.finish.addEventListener('click', () => { void recover('forward'); });
    nodes.restorePrior.addEventListener('click', () => { void recover('prior'); });
    nodes.keep.addEventListener('click', () => { void keepCurrent(); });
    render();
  }

  return { wire, render };
}
