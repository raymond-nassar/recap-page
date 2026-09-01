// Backup/Data and Settings view presentation.
//
// Owns the event wiring for every control on the Backup & Settings screen: export, restore,
// undo, cover art, theme, update checks, API base, cache clear, and erase. Each handler
// validates locally and delegates the actual state change to an injected callback, so this
// module never touches the Store, cache, API, Hydrator, or SynopsisRunner.

// ------------------------------------------------------------------ erase policy
//
// BL-113's decision, and the reason it is a pair of sentences rather than a wider erase.
//
// The rule at `src/js/storage.js:336-339` stands: nothing but the reader removes a salvage copy,
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
export function eraseDialogBody(copies) {
  const tail = ' Export a backup first if you are not sure. It cannot be undone.';
  const lead = 'This clears every list and all reading progress. Your settings are kept.';
  if (copies === null) {
    return `${lead} This browser will not let the app list what else it has stored, so anything `
      + `kept aside after a failed read is not reached and stays where it is.${tail}`;
  }
  if (copies.length === 0) return `${lead}${tail}`;
  const one = copies.length === 1;
  const where = `${lead} `
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
export function eraseOutcome(snapshotKept, copies) {
  const notes = [];
  if (snapshotKept) {
    notes.push('One copy could not be removed and is still in this browser, behind "Undo last restore".');
  }
  if (copies === null) {
    notes.push('This browser will not list what else it has stored, so anything kept aside after a failed read is still here.');
  } else if (copies.length === 1) {
    notes.push('One copy kept after a failed read is still here, under "Copies kept after a failed read".');
  } else if (copies.length > 1) {
    notes.push(`${copies.length} copies kept after a failed read are still here, under "Copies kept after a failed read".`);
  }
  if (notes.length === 0) return 'All local data erased.';
  return ['Lists and reading progress erased.', ...notes].join(' ');
}

// ------------------------------------------------------------------ view factory

export function createDataView({
  elements,
  getApiBase,
  getSalvageCopies,
  hasPreRestoreSnapshot,
  isAllowedApiBase,
  backupFileRefusal,
  askConfirm,
  notify,
  onExportJson,
  onExportMarkdown,
  onRestore,
  onUndoRestore,
  onSetCovers,
  onSetUpdateChecks,
  onSetTheme,
  onRunUpdateCheck,
  onCheckLocalConnection,
  onApiBaseSubmit,
  onClearCache,
  onErase,
}) {
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
    nodes.apiBase.value = getApiBase();
    nodes.optCovers.addEventListener('change', (e) => onSetCovers(e.target.checked));
    nodes.optUpdateChecks.addEventListener('change', (e) => onSetUpdateChecks(e.target.checked));
    nodes.optTheme.addEventListener('change', (e) => onSetTheme(e.target.value));
    nodes.btnCheckUpdates.addEventListener('click', onRunUpdateCheck);
    nodes.btnCheckLocalConnection.addEventListener('click', () => {
      void onCheckLocalConnection();
    });

    nodes.btnExportJson.addEventListener('click', onExportJson);

    nodes.btnExportMd.addEventListener('click', onExportMarkdown);

    nodes.restoreFile.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      // Asked of the file's declared size, so a file picked by mistake is refused before text()
      // pulls it into memory. The check is here rather than in the store because by the time the
      // store sees a backup it is already a string, which is the cost this avoids.
      const refusal = backupFileRefusal(file);
      if (refusal) {
        notify('#restore-report', refusal, 'error');
        e.target.value = '';
        return;
      }
      const text = await file.text();
      const res = onRestore(text);
      if (res.ok) {
        notify('#restore-report', 'Restored. Your previous data was snapshotted, so this can be undone once.', 'ok');
        // Asked of the store rather than assumed from the success. A first restore into an empty
        // tracker snapshots an empty main key, which is no snapshot at all, and this line used to
        // un-hide the button anyway, after the repaint had correctly hidden it.
        nodes.undoRestore.hidden = !hasPreRestoreSnapshot();
        // The buffered list belongs to the data the restore has just replaced. Offering it back
        // would splice a list out of the old tracker into the restored one.
      } else {
        // The lead sentence comes from what the store found in storage, not from this call site.
        const lead = res.changed === null
          ? 'Restore did not finish, and this browser will not say what your saved data now holds. Reload the page.'
          : 'Restore refused, nothing was changed.';
        notify('#restore-report', `${lead} ${res.errors.join(' ')}`, 'error');
        // Whether an undo is offered is a question about the snapshot slot, which these failures
        // leave in three different states, so it is asked rather than inferred from the failure.
        nodes.undoRestore.hidden = !hasPreRestoreSnapshot();
      }
      e.target.value = '';
    });

    nodes.undoRestore.addEventListener('click', () => {
      const res = onUndoRestore();
      notify('#restore-report', res.ok ? 'Restore undone.' : `Could not undo: ${res.errors.join(' ')}`, res.ok ? 'ok' : 'error');
      // Undoing a restore swaps the whole state back, exactly as the restore did, so the buffered
      // list belongs to data that is no longer here in this direction too.
    });

    // Measured at 200 per cent zoom, the API notice landed 658 px above view, and cache clearing
    // replaced a restore refusal.
    nodes.formSettings.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = nodes.apiBase.value.trim().replace(/\/+$/, '');
      if (!isAllowedApiBase(value)) {
        return notify('#api-report', 'That API URL is not usable: use https, or http against localhost.', 'error');
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
      const yes = await askConfirm({
        title: 'Erase every list and all reading progress?',
        body: eraseDialogBody(getSalvageCopies()),
        confirmLabel: 'Erase everything',
      });
      if (!yes) return;
      onErase();
    });
  }

  return {
    wire,
    clearLocalConnectionReport,
    renderCacheUsage,
    renderLocalConnectionStatus,
  };
}
