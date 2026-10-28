// The capacity probe: how much of the app's saved data WebKit's localStorage holds at the owner's
// data size, measured through the app's own storage and restore code rather than estimated.
//
// WebKit allows each origin 5 MiB of localStorage and counts a string at two bytes per character
// once any character in it is above U+00FF, which titles in the bundled lists are. A reading-data
// restore holds up to three copies of that data at once: the saved data, the restore's staged copy,
// and the copy kept for Undo. The owner's complete backup is 1,183 KB, so whether a restore fits is
// the question this answers, on whatever engine runs it.
//
// It runs inside the app's own page and leaves localStorage empty when it finishes. Nothing here
// ships in the app: the iOS unit tests load it from the repository, and so can any WebKit browser.
window.recapCapacityProbe = async function recapCapacityProbe({ targetBytes = 1183 * 1024, wideText = true } = {}) {
  const started = Date.now();
  const base = new URL('./', location.href);
  const load = (path) => import(new URL(path, base).href);
  const [storage, model, complete] = await Promise.all([
    load('js/storage.js'), load('js/lib/model.js'), load('js/lib/completeBackup.js'),
  ]);
  // How WebKit counts a stored string: one byte per character when every character fits in Latin-1,
  // otherwise two for every character.
  const wide = (text) => /[\u0100-\uffff]/.test(text);
  const storedBytes = (text) => text.length * (wide(text) ? 2 : 1);
  const usage = () => {
    let total = 0;
    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      total += storedBytes(key) + storedBytes(localStorage.getItem(key) ?? '');
    }
    return total;
  };
  const outcome = (result) => ({
    ok: result.ok === true,
    changed: result.changed ?? null,
    errors: result.errors ?? [],
    usageAfter: usage(),
  });

  localStorage.clear();

  // The largest single value of each width that the engine accepts, found by halving.
  const quotaKey = 'recap-capacity-probe';
  const largest = (unit) => {
    let low = 0;
    let high = 8 * 1024 * 1024;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      try {
        localStorage.setItem(quotaKey, unit.repeat(middle));
        low = middle;
      } catch (error) {
        if (error?.name !== 'QuotaExceededError') throw error;
        high = middle - 1;
      } finally {
        localStorage.removeItem(quotaKey);
      }
    }
    return low;
  };
  const latin1Chars = largest('a');
  const wideChars = largest('\u2019');
  const quota = {
    latin1Chars,
    wideChars,
    latin1Bytes: latin1Chars + quotaKey.length,
    wideBytes: wideChars * 2 + quotaKey.length,
  };

  // Reading data at the owner's size, made the way Add to library makes it: curated lists from the
  // bundled files, in catalog order, until the export reaches the target.
  const catalog = await (await fetch(new URL('data/catalog.json', base))).json();
  let state = model.createEmptyState();
  const lists = [];
  const exported = () => JSON.stringify(model.exportBackup(state));
  // Within half a percent to three percent over the target: the complete backup that the target
  // describes is measured afterwards from what was saved, and its reading-data part is not byte for
  // byte this export. A list that would overshoot is skipped for a smaller one, so the data is the
  // owner's size rather than whatever the last large list happened to make it.
  //
  // wideText false keeps every character in Latin-1, by leaving out the lists whose files hold any
  // character above it, which is the best case: the same data stored at one byte per character.
  const enough = targetBytes * 1.005;
  const ceiling = targetBytes * 1.03;
  for (const entry of catalog.lists) {
    if (exported().length >= enough) break;
    const order = await (await fetch(new URL(`data/${entry.file}`, base))).json();
    if (!wideText && wide(JSON.stringify(order))) continue;
    let candidate = model.createList(state, { name: order.name, description: order.description, catalogId: entry.id });
    const listId = candidate.listOrder[candidate.listOrder.length - 1];
    candidate = model.addIssuesToList(candidate, listId, order.items.map((item) => ({ ...item, source: 'curated' })), {}).state;
    if (JSON.stringify(model.exportBackup(candidate)).length > ceiling) continue;
    state = candidate;
    lists.push(entry.id);
  }
  const issueIds = Object.keys(state.issues).sort();
  issueIds.forEach((id, index) => {
    if (index % 2 === 0) state = model.markRead(state, id, true, Date.UTC(2026, 0, 1) + index * 60000);
  });
  // A note typed on an iPhone carries curly punctuation, so real saved data is wide even when every
  // chosen title is not.
  if (wideText && !wide(exported())) state = model.setIssueNote(state, issueIds[0], 'Reread before the crossover\u2019s finale.');
  const stateA = state;
  let stateB = stateA;
  issueIds.forEach((id, index) => {
    stateB = model.markRead(stateB, id, index % 2 === 1, Date.UTC(2026, 1, 1) + index * 60000);
  });
  const fileA = JSON.stringify(model.exportBackup(stateA), null, 2);
  const fileB = JSON.stringify(model.exportBackup(stateB), null, 2);

  // A restore into an installation that holds no reading data yet.
  localStorage.clear();
  let store = new storage.Store({ storage: localStorage });
  store.load();
  const restoreIntoEmpty = outcome(store.restore(fileB, { expected: store.captureRestore() }));

  // An ordinary save at the owner's size, then the owner's route between devices: a restore of a
  // same-size file into the populated installation, and a second one once a copy for Undo exists.
  localStorage.clear();
  store = new storage.Store({ storage: localStorage });
  store.load();
  store.update(() => stateA);
  const savedRaw = localStorage.getItem(storage.KEY) ?? '';
  const save = { ok: store.lastUpdateOk === true, error: store.lastError ?? null, usageAfter: usage() };
  let completeBackupBytes = null;
  let completeBackupError = null;
  try {
    const captured = await complete.captureCompleteBackup({ storage: localStorage });
    completeBackupBytes = new TextEncoder().encode(captured.text).length;
  } catch (error) {
    completeBackupError = String(error?.message ?? error);
  }
  const usageBeforePopulated = usage();
  const restoreIntoPopulated = {
    usageBefore: usageBeforePopulated,
    ...outcome(store.restore(fileB, { expected: store.captureRestore() })),
  };
  const usageBeforeRepeat = usage();
  const repeatRestore = {
    usageBefore: usageBeforeRepeat,
    ...outcome(store.restore(fileA, { expected: store.captureRestore() })),
  };
  localStorage.clear();
  // Asked only after the measurement, so the answer cannot affect what was measured.
  let persist = 'unavailable';
  try {
    if (navigator.storage?.persist) persist = await navigator.storage.persist();
  } catch (error) {
    persist = `error: ${error?.message ?? error}`;
  }

  const readerStoredBytes = storedBytes(savedRaw);
  return JSON.stringify({
    probe: 'recap-capacity-v1',
    variant: wideText ? 'wide' : 'latin1',
    engine: navigator.userAgent,
    origin: location.origin,
    persist,
    quota,
    owner: {
      targetBytes,
      completeBackupBytes,
      completeBackupError,
      reached: completeBackupBytes !== null && completeBackupBytes >= targetBytes,
      readerChars: savedRaw.length,
      readerWide: wide(savedRaw),
      readerStoredBytes,
      lists: lists.length,
      issues: issueIds.length,
      // Arithmetic, not a measurement: how many copies of this reading data the measured quota
      // holds, against the three a populated restore needs at its peak.
      copiesThatFit: readerStoredBytes ? Math.floor(Math.min(quota.latin1Bytes, quota.wideBytes) / readerStoredBytes) : null,
    },
    save,
    restoreIntoEmpty,
    restoreIntoPopulated,
    repeatRestore,
    durationMs: Date.now() - started,
  });
};
