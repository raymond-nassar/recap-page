// The capacity probe: how much of the app's saved data WebKit's localStorage holds at the owner's
// data size, measured through the app's own storage and restore code rather than estimated.
//
// WebKit allows each origin 5 MiB of localStorage and charges a string one or two bytes per
// character by the form the engine holds it in. A string with any character above U+00FF is held in
// the two-byte form, and on the iOS 26.5 and 18.5 Simulators the app's saved reading data was held in
// it even when every character was Latin-1, which is why this probe measures the width as well. A
// reading-data restore holds up to three copies of that data at once: the saved data, the restore's
// staged copy, and the copy kept for Undo. The owner's complete backup is 1,183 KB, so whether a
// restore fits is the question this answers, on whatever engine runs it.
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
  // An estimate from the characters alone: one byte per character when every character fits in
  // Latin-1, otherwise two. The engine can charge more, which the width measurement below finds.
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

  // Whether a Latin-1 value still costs one byte per character once it is stored. The iOS 26.5
  // Simulator refused a Latin-1 restore whose three copies come to well under the quota at one byte
  // each, so the room left beside a held 1 MiB value is measured three ways: at once, after a pause
  // long enough for the engine to commit it, and when the held value is a string read back from
  // storage, as the copy a restore keeps for Undo is. Beside a value counted at one byte per
  // character the room is about the quota less 1 MiB; at two, less 2 MiB.
  const heldKey = 'recap-capacity-held';
  const held = 1024 * 1024;
  const roomBeside = async ({ pause = 0, readBack = false } = {}) => {
    let value = 'a'.repeat(held);
    if (readBack) {
      localStorage.setItem(heldKey, value);
      value = localStorage.getItem(heldKey);
      localStorage.removeItem(heldKey);
    }
    localStorage.setItem(heldKey, value);
    try {
      if (pause) await new Promise((resolve) => setTimeout(resolve, pause));
      return largest('a');
    } finally {
      localStorage.removeItem(heldKey);
    }
  };
  let accounting;
  try {
    accounting = {
      heldLatin1Chars: held,
      roomAtOnce: await roomBeside(),
      roomAfterPause: await roomBeside({ pause: 1500 }),
      roomBesideReadBack: await roomBeside({ readBack: true }),
    };
  } catch (error) {
    accounting = { error: String(error?.message ?? error) };
  }

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

  // The width the engine charges for the saved reading data itself, read from the room left beside
  // it: about 1 byte per character for a string held at one byte, 2 for one held at two. A string
  // can be held at two bytes when every character is Latin-1, if it was built from text the engine
  // decoded that way, and then the Latin-1 case above costs what the wide one does. The second
  // figure is a copy with every character above U+007F escaped as JSON allows, rebuilt from its
  // ASCII bytes, which is one way the app could store the same data at one byte per character.
  const width = (value) => {
    localStorage.clear();
    try {
      localStorage.setItem(heldKey, value);
      const room = largest('a');
      return Number(((quota.latin1Chars - heldKey.length - room) / value.length).toFixed(3));
    } catch (error) {
      return `error: ${error?.message ?? error}`;
    } finally {
      localStorage.clear();
    }
  };
  let widths;
  try {
    const ascii = savedRaw.replace(/[\u0080-\uffff]/g, (character) =>
      `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`);
    const rebuilt = new TextDecoder('latin1').decode(new TextEncoder().encode(ascii));
    widths = {
      saved: width(savedRaw),
      escaped: width(ascii),
      escapedRebuilt: width(rebuilt),
      escapedChars: rebuilt.length,
      escapedSameData: JSON.stringify(JSON.parse(rebuilt)) === JSON.stringify(JSON.parse(savedRaw)),
    };
  } catch (error) {
    widths = { error: String(error?.message ?? error) };
  }

  // Asked only after the measurement, so the answer cannot affect what was measured.
  let persist = 'unavailable';
  try {
    if (navigator.storage?.persist) persist = await navigator.storage.persist();
  } catch (error) {
    persist = `error: ${error?.message ?? error}`;
  }

  const readerStoredBytes = storedBytes(savedRaw);
  // The bytes the engine actually charges, from the measured width where it was measured.
  const readerChargedBytes = typeof widths?.saved === 'number'
    ? Math.round(savedRaw.length * widths.saved) : readerStoredBytes;
  return JSON.stringify({
    probe: 'recap-capacity-v1',
    variant: wideText ? 'wide' : 'latin1',
    engine: navigator.userAgent,
    origin: location.origin,
    persist,
    quota,
    accounting,
    widths,
    owner: {
      targetBytes,
      completeBackupBytes,
      completeBackupError,
      reached: completeBackupBytes !== null && completeBackupBytes >= targetBytes,
      readerChars: savedRaw.length,
      readerWide: wide(savedRaw),
      readerStoredBytes,
      readerChargedBytes,
      lists: lists.length,
      issues: issueIds.length,
      // Arithmetic, not a measurement: how many copies of this reading data the measured quota
      // holds at the charged width, against the three a populated restore needs at its peak.
      copiesThatFit: readerChargedBytes ? Math.floor(quota.latin1Bytes / readerChargedBytes) : null,
    },
    save,
    restoreIntoEmpty,
    restoreIntoPopulated,
    repeatRestore,
    durationMs: Date.now() - started,
  });
};
