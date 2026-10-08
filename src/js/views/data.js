// Backup/Data and Settings view presentation.
//
// Owns the event wiring for every control on the Backup & Settings screen: export, restore,
// undo, cover art, theme, API base, cache clear, and erase. Each handler
// validates locally and delegates the actual state change to an injected callback, so this
// module never touches the Store, cache, API, Hydrator, or SynopsisRunner.

import { wireFieldValidation } from './shared/field-validation.js';

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
// Settings are named because they outlive every one of these answers. Nothing in the app removes
// mrt.settings or sidebar.collapsed, so this branch's old sentence, that the route clears
// everything this browser has stored for the tracker, was false for any reader who had ever
// changed the theme. docs/ARCHITECTURE.md holds the whole list and calls those two preferences
// rather than data, which is why the message said afterwards still reports all local data erased
// and only the promise made beforehand had to be narrowed.
export function eraseDialogBody(copies, { completionHistory = false } = {}) {
  const tail = ' Export a backup first if you are not sure. It cannot be undone.';
  const lead = 'This clears every list and all reading progress. Notes and issue ratings are also erased. Your settings are kept.';
  const scope = completionHistory ? `${lead} Completion and enjoyment history will also be erased.` : lead;
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
          ? 'Import draft restored. Reading data was not changed. Review Resume saved import in Add comics.'
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
          body: 'This replaces all lists, notes and reading progress. Your current reading data will be kept as a saved copy. Completion history and settings stay unchanged. Import draft source stays saved but needs Resume review before more comics can be applied.',
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
          body: `${offer?.summary || ''} This replaces all current lists, notes and reading progress.${offer?.edited ? ' Reading data has changed since the restore; these intervening edits will be replaced.' : ''} The data you replace stays as the next saved copy, not another Undo. Completion history and settings stay unchanged. Import draft source is retained and needs Resume review.`,
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
        const yes = await askConfirm({
          title: eraseHistory ? 'Erase every list, reading progress and completion history?' : 'Erase every list and all reading progress?',
          body: `${eraseDialogBody(getSalvageCopies(), { completionHistory: eraseHistory })} The saved import draft and its retained source snapshots will also be removed after the reading-data erase is verified.`,
          confirmLabel: 'Erase everything',
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
