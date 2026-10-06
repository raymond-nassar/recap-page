// Recovery view: blocked banner and salvage copy presentation.
//
// Owns the blocked-data banner (render, wire) and the salvage copy list (renderSalvage, wire).
// State that matters here -- whether a download has happened, whether the banner was showing on
// the previous render -- is local to this view because no other view reads it.
//
// Everything that touches the Store, the cache, or another view is injected as a getter or
// callback, so this module can be imported in Node without reaching the browser globals.

// Measured in Edge rather than assumed, and the first attempt at this comment got it wrong. The
// largest value a cleared page accepted under a one-character key was 5,242,879 characters, which
// with the key is 5,242,880, and that is 10 MiB at two bytes per character rather than the 5 MiB
// first written here. Two runs filling the same room with 'x' and with an accented character were
// accepted to the identical character, so the cost is per character and does not depend on the
// content. So a copy occupies twice its length, and reporting the length alone would have
// understated every figure by half on the one screen whose subject is running out of room.
const salvageKb = (chars) => Math.max(1, Math.round((chars * 2) / 1024));

// Date and time to the second, not date alone. Copies are keyed to the millisecond and two can be
// taken on one day, and the reader choosing between them in a dialog that calls the removal
// unrecoverable has only this string to choose with. Measured: two copies a few milliseconds apart
// both rendered "Copy taken on 9 August 2026", with identical accessible names and an identical
// confirmation. Seconds separate two incidents; two copies inside one second still read alike, and
// those are the collision case freeArchiveKey() handles, where the copies are moments apart and
// the millisecond that distinguishes them is in the key rather than in anything worth showing.
//
// Compared against null rather than tested for truth, because a copy stamped at the epoch is a
// real case a device with a dead clock produces, and the layer below reports 0 and null as
// different values on purpose. Treating 0 as absent would discard that in the last step.
const salvageWhen = (at) => (at === null || at === undefined
  ? null
  : new Date(at).toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }));

export { salvageKb, salvageWhen };

export function createRecoveryView({
  el,
  elements,
  isBlocked,
  blockedReason,
  hasPreRestoreSnapshot,
  clearRecoveryNotice,
  salvagedRaw,
  salvageCopies,
  salvageRawAt,
  forgetSalvage,
  startFresh,
  notify,
  announce,
  askConfirm,
  download,
}) {
  // Exact incident bytes confirmed by native output or file read-back, not an anchor request.
  let downloadedSalvage = null;
  let verificationGeneration = 0;

  // Resolution withdraws only recovery's notice. Reader and completion-history save failures
  // have their own keys and may still need attention, even while this banner is up.
  let blockedBannerWasUp = false;

  function render() {
    const nodes = elements();
    const blocked = isBlocked();
    nodes.banner.hidden = !blocked;
    // Painted from the reason the read failed rather than from the newest error, so a write
    // refused while blocked no longer displaces the one thing on this screen that the standing
    // copy cannot know. Written only when it differs, because this runs on every render and
    // assigning an identical string still replaces the text node inside a role="alert", which
    // invites the same sentence to be read out again on every save the reader makes.
    const reason = blockedReason() ?? '';
    if (nodes.blockedWhy.textContent !== reason) nodes.blockedWhy.textContent = reason;
    // Below the hide, so a cleared reason is never on screen: the banner has already gone by the
    // time the text it held is emptied.
    if (blockedBannerWasUp && !blocked) {
      if (clearRecoveryNotice) clearRecoveryNotice();
      else nodes.saveReport.replaceChildren();
      // A download confirms only the incident whose banner was showing. Carrying it into a later
      // incident could let Start fresh replace different unreadable bytes with no copy of them.
      downloadedSalvage = null;
      verificationGeneration += 1;
    }
    blockedBannerWasUp = blocked;
    // The pre-restore snapshot outlives a reload, so the undo affordance must be restored on
    // boot rather than only after the restore that created it.
    if (nodes.undoRestore) nodes.undoRestore.hidden = !hasPreRestoreSnapshot();
  }

  // The reader's view of what is being kept on their behalf. Read from storage on every call
  // rather than from anything held in memory, because another tab can have taken a copy or removed
  // one since this tab booted, and a stale list here offers a Remove for a copy that is already
  // gone.
  function renderSalvage() {
    const box = elements().salvageList;
    if (!box) return;
    const copies = salvageCopies();

    // Three answers, not two. A browser that will not enumerate its own storage has not told us
    // there is nothing; it has declined to say, and a reader whose copies are all still there must
    // not be shown an empty list. The download in the recovery banner is unaffected either way,
    // because it reads one known key rather than walking them.
    if (copies === null) {
      box.replaceChildren(el('p', {
        class: 'rail-hint',
        text: 'This browser will not let the app list what it has stored, so any copies it is holding '
          + 'cannot be shown here. Nothing has been removed.',
      }));
      return;
    }
    if (copies.length === 0) {
      box.replaceChildren(el('p', { class: 'rail-hint', text: 'Nothing is being kept aside.' }));
      return;
    }

    const total = copies.reduce((n, c) => n + c.chars, 0);
    box.replaceChildren(
      el('p', {
        class: 'rail-hint',
        text: `${copies.length} ${copies.length === 1 ? 'copy is' : 'copies are'} being kept, `
          + `taking about ${salvageKb(total)} KB.`,
      }),
      el('ul', { class: 'rows' }, copies.map((c) => {
        const when = salvageWhen(c.at);
        return el('li', { class: 'salvage-row' }, [
          el('div', { class: 'salvage-what' }, [
            el('span', { class: 'salvage-when', text: when ? `Copy taken on ${when}` : 'Copy with no date recorded' }),
            el('span', { class: 'salvage-size', text: `about ${salvageKb(c.chars)} KB` }),
          ]),
          el('div', { class: 'field-row' }, [
            el('button', {
              type: 'button',
              class: 'btn btn-g',
              dataset: { act: 'download', key: c.key },
              'aria-label': `Download the ${when ? `copy taken on ${when}` : 'copy with no date recorded'}`,
              text: 'Download',
            }),
            // The offer is withdrawn rather than refused: while this copy is the last record of
            // data the app cannot read, removing it is the one thing that would leave the reader
            // with nothing, and a button that explains itself only after the click has already
            // asked them to try. The sentence depends on whether this tab is the one that is
            // blocked, because liveness is a property of storage and the banner is a property of
            // the tab: a second tab that read the data before it went bad shows the row with no
            // warning above it.
            c.live
              ? el('span', {
                class: 'rail-hint',
                text: isBlocked()
                  ? 'Kept until the warning above is resolved'
                  : 'Kept while the data it copies is still saved here',
              })
              : el('button', {
                type: 'button',
                class: 'btn btn-danger',
                dataset: { act: 'forget', key: c.key },
                'aria-label': `Remove the ${when ? `copy taken on ${when}` : 'copy with no date recorded'}`,
                text: 'Remove',
              }),
          ]),
        ]);
      })),
    );
  }

  function wire() {
    const nodes = elements();

    // Blocked banner: download + start fresh
    nodes.btnDownloadSalvage.addEventListener('click', async () => {
      const raw = salvagedRaw();
      if (!raw) return notify('#save-report', 'There was nothing left to download.', 'warn', 'recovery-copy');
      const when = new Date().toISOString().slice(0, 10);
      const result = await download(`recap-page-unreadable-${when}.json`, raw, 'application/json');
      if (!result) return;
      if (result === true && new TextDecoder('utf-8', { ignoreBOM: true }).decode(new TextEncoder().encode(raw)) !== raw) {
        return notify('#save-report', 'The file save completed, but this data cannot be preserved exactly in a UTF-8 file. Nothing was cleared. Keep the original browser data; starting fresh still requires an in-browser recovery copy.', 'warn', 'recovery-copy');
      }
      // A picker can outlive this incident. Its success cannot confirm different unreadable data.
      if (result === true && isBlocked() && salvagedRaw() === raw) downloadedSalvage = raw;
      if (result === true) announce('Downloaded a copy of the unreadable data.');
      else notify('#save-report', 'Download requested, not confirmed saved. Check your browser\'s downloads, then select the saved file with "Verify downloaded copy". Nothing has been cleared.', 'warn', 'recovery-copy');
    });

    nodes.verifySalvage?.addEventListener('change', async (event) => {
      const input = event.target;
      const file = input.files?.[0];
      if (!file) return;
      const generation = ++verificationGeneration;
      const raw = salvagedRaw();
      downloadedSalvage = null;
      try {
        if (!isBlocked() || typeof raw !== 'string' || file.size !== new Blob([raw]).size) {
          return notify('#save-report', 'That file does not match the unreadable data. Nothing was cleared. Download this incident\'s copy and try again.', 'warn', 'recovery-copy');
        }
        const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
        if (generation !== verificationGeneration) return;
        if (!isBlocked() || salvagedRaw() !== raw) {
          return notify('#save-report', 'The recovery data changed while the file was being checked. Nothing was cleared. Download the current copy and try again.', 'warn', 'recovery-copy');
        }
        if (text !== raw) return notify('#save-report', 'That file does not match the unreadable data. Nothing was cleared. Download this incident\'s copy and try again.', 'warn', 'recovery-copy');
        downloadedSalvage = raw;
        notify('#save-report', 'Verified the saved file matches this unreadable data. You can now start fresh.', 'ok', 'recovery-copy');
      } catch (error) {
        if (generation !== verificationGeneration) return;
        notify('#save-report', `That file could not be verified (${error.message}). Nothing was cleared. Select the downloaded copy and try again.`, 'error', 'recovery-copy');
      } finally {
        if (generation === verificationGeneration) input.value = '';
      }
    });

    nodes.btnStartFresh.addEventListener('click', async () => {
      const yes = await askConfirm({
        title: 'Start fresh?',
        body: 'This replaces the unreadable saved data with an empty tracker. '
          + 'An in-browser recovery copy or a verified saved file must survive before anything is replaced.',
        confirmLabel: 'Start fresh',
      });
      if (!yes) return;
      // Not reported on failure: both failing exits assign lastError and then call onChange,
      // which already notifies here. Measured in Edge, 2 identical strings per refusal, now 1.
      if (startFresh({ verifiedCopyRaw: downloadedSalvage !== null && downloadedSalvage === salvagedRaw() ? downloadedSalvage : null })) {
        notify('#save-report', 'Started fresh. Saving is working again.', 'ok', 'recovery-copy');
      }
    });

    // Salvage list: one listener on the container, because the rows are rebuilt after every
    // removal and listeners bound to the buttons would go with them.
    nodes.salvageList.addEventListener('click', async (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const { act, key } = btn.dataset;
      const copies = salvageCopies();
      const copy = copies?.find((c) => c.key === key);
      if (!copy) {
        renderSalvage();
        // Two reasons the copy is not in the list, and only one of them means it is gone. A
        // browser that declined to enumerate has not told us anything was removed, and saying so
        // would be the one wrong thing to say on the screen whose subject is what is still being
        // kept.
        return notify('#salvage-report', copies === null
          ? 'This browser will not let the app list what it has stored, so that copy cannot be '
            + 'acted on here. Nothing has been removed.'
          : 'That copy is no longer there. The list has been refreshed.', 'warn');
      }
      const when = salvageWhen(copy.at);
      const named = when ? `taken on ${when}` : 'with no date recorded';

      if (act === 'download') {
        const raw = salvageRawAt(key);
        if (!raw) return notify('#salvage-report', 'That copy could not be read back, so nothing was downloaded.', 'warn');
        // To the second, for the same reason the row is: two copies taken on one day would
        // otherwise arrive as one name and a browser-appended (1), leaving the reader unable to
        // tell which is which after the screen that could have told them is closed.
        const stamp = copy.at === null ? 'undated' : new Date(copy.at).toISOString().slice(0, 19).replace(/:/g, '-');
        const result = await download(`recap-page-unreadable-${stamp}.json`, raw, 'application/json');
        if (!result) return;
        return notify('#salvage-report', result === true
          ? `Downloaded the copy ${named}. It is still being kept here as well.`
          : `Download requested for the copy ${named}. Check your browser's downloads to confirm it was saved. It is still being kept here.`, result === true ? 'ok' : 'warn');
      }

      const yes = await askConfirm({
        title: 'Remove this copy?',
        body: `This deletes the copy ${named}. It is a copy of saved data this app could not read, so `
          + 'there is nothing else to recover it from. Download it first if you are not sure.',
        confirmLabel: 'Remove copy',
      });
      if (!yes) return;
      const gone = forgetSalvage(key);
      renderSalvage();
      notify('#salvage-report', gone
        ? `Removed the copy ${named}, freeing about ${salvageKb(copy.chars)} KB.`
        : 'That copy could not be removed, so it is still being kept.', gone ? 'ok' : 'warn');
    });
  }

  return { wire, render, renderSalvage };
}
