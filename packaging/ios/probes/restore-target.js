// Whether a complete restore of reading data at the capacity target fits in WebKit's localStorage,
// measured through the app's own storage and restore code on the engine that runs it (#960).
//
// The target is 1.2 times the owner's reading data, which measured 1,361,156 characters on
// 8 November 2026, almost all of it cached issue metadata in ASCII. It is measured into an empty app,
// over data of the same size saved by this version, over a two-byte prior written as 4.5.0 did in the
// same launch, and over this version's data after a relaunch. The legacy-wide prior measures the first
// restore after upgrading. Each runs in mostly ASCII and with CJK notes, generated not copied.
//
// It runs inside the app's own page. A phase that restores leaves localStorage empty; the seed phase
// leaves the prior data saved for the launch after it. Nothing here ships in the app: the iOS UI tests
// load it from the repository, and so can any WebKit browser.
window.recapRestoreTargetProbe = (() => {
  const TARGET_CHARS = 1_633_400;
  const OWNER_CHARS = 1_361_156;
  const base = new URL('./', location.href);
  const load = (path) => import(new URL(path, base).href);
  const modules = () => Promise.all([
    load('js/storage.js'),
    load('js/lib/model.js'),
    load('js/lib/completeBackup.js'),
    load('js/lib/completeRestore.js'),
  ]);

  const seeded = (seed) => {
    let value = seed >>> 0;
    return () => {
      value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
      return value / 4294967296;
    };
  };

  // The same generator as the Node capacity tests in test/complete-restore.test.js: issue metadata in
  // ASCII with a typographic apostrophe in one title in forty, then notes up to the target. The CJK mix
  // writes two in three note characters as CJK, about two percent of the whole.
  const generated = new Map();
  const readerOfSize = (model, target, { cjk = false, seed = 1 } = {}) => {
    const memo = `${target}:${cjk}:${seed}`;
    if (generated.has(memo)) return generated.get(memo);
    const next = seeded(seed);
    let state = model.createEmptyState();
    const size = () => JSON.stringify(model.exportBackup(state)).length;
    const issue = (issueId) => {
      const series = `Generated Series ${issueId % 97} (${2000 + (issueId % 25)})`;
      return {
        issueId, number: String(issueId % 500), seriesId: 1000 + (issueId % 97), seriesName: series,
        title: `${series} #${issueId % 500}${issueId % 40 === 0 ? ' It\u2019s a caf\u00e9' : ''}`,
        onSale: `20${10 + (issueId % 15)}-0${1 + (issueId % 9)}-1${issueId % 10}`, digitalId: 40000 + issueId,
        cover: { path: `https://i.annihil.us/u/prod/marvel/i/mg/${issueId % 10}/${issueId % 90}/${Math.floor(next() * 0xffffff).toString(16)}`, ext: 'jpg' },
        pageCount: 20 + Math.floor(next() * 30),
        creators: ['writer', 'penciler', 'inker', 'colorist', 'letterer'].map((role) => ({ name: `Creator ${Math.floor(next() * 5000)}`, role })),
      };
    };
    let issueId = seed * 1_000_000;
    const bulk = target * (cjk ? 0.97 : 0.985);
    for (let list = 0; size() < bulk; list += 1) {
      const id = `generated-${seed}-${list}`;
      const count = size() < bulk - 120_000 ? 150 : 10;
      state = model.createList(state, { id, name: `Generated list ${list}` });
      state = model.addIssuesToList(state, id, Array.from({ length: count }, () => issue(++issueId))).state;
    }
    const ids = Object.keys(state.issues);
    for (let index = 0, current = size(); current < target; index += 1, current = size()) {
      const length = Math.min(2000, target - current);
      state.notes[ids[index]] = Array.from({ length }, (_, at) => (cjk && at % 3
        ? String.fromCharCode(0x4e00 + Math.floor(next() * 2000))
        : 'note text '[at % 10])).join('');
    }
    generated.set(memo, state);
    return state;
  };

  // The largest one-byte value the engine still accepts beside what is stored: the room left, as the
  // engine itself counts it.
  const roomKey = 'recap-restore-target-room';
  const room = () => {
    let low = 0;
    let high = 8 * 1024 * 1024;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      try {
        localStorage.setItem(roomKey, 'a'.repeat(middle));
        low = middle;
      } catch (error) {
        if (error?.name !== 'QuotaExceededError') throw error;
        high = middle - 1;
      } finally {
        localStorage.removeItem(roomKey);
      }
    }
    return low;
  };

  const save = (storage, state) => {
    const store = new storage.Store({ storage: localStorage });
    store.load();
    store.update(() => structuredClone(state));
    if (!store.lastUpdateOk) throw new Error(`The prior reading data was not saved: ${store.lastError}`);
  };

  // The restore refuses with "could not check for a recovery copy" whenever its journal read fails, and
  // the app says the same thing for an open error, a blocked open, its open deadline or an aborted read
  // (#1249). The probe watches the open requests and the read beside the app's own handlers, so a
  // refusal names which of the four it was rather than leaving it to be inferred from a phase's length.
  const observedJournal = (restoreEngine, factory, options) => {
    const opens = [];
    const reads = [];
    const journal = restoreEngine.createRestoreJournal({
      open: (name, version) => {
        const startedAt = performance.now();
        const seen = { events: [] };
        opens.push(seen);
        let request;
        try {
          request = factory.open(name, version);
        } catch (error) {
          seen.threw = true;
          seen.error = error?.name ?? 'unknown';
          throw error;
        }
        for (const type of ['upgradeneeded', 'blocked', 'error', 'success']) {
          request.addEventListener(type, () => {
            seen.events.push({ type, ms: Math.round(performance.now() - startedAt) });
            if (type === 'error') seen.error = request.error?.name ?? 'unknown';
          });
        }
        return request;
      },
    }, options);
    const read = async () => {
      const startedAt = performance.now();
      try {
        const value = await journal.read();
        reads.push({ ok: true, ms: Math.round(performance.now() - startedAt) });
        return value;
      } catch (error) {
        const message = error?.message ?? String(error);
        const open = opens.at(-1);
        const types = new Set(open?.events.map((event) => event.type));
        // The journal uses the same message for a transaction abort and a transaction error.
        let failure = message === 'The recovery copy could not be saved or read.' ? 'aborted-read' : 'read-error';
        if (message === restoreEngine.RESTORE_MESSAGES.noJournal) {
          if (open?.threw || types.has('error')) failure = 'open-error';
          else if (types.has('blocked')) failure = 'blocked-open';
          else failure = 'deadline';
        }
        reads.push({ ok: false, ms: Math.round(performance.now() - startedAt), error: message, failure });
        throw error;
      }
    };
    return { journal: { ...journal, read }, check: () => ({ failure: reads.find((attempt) => !attempt.ok)?.failure ?? null, opens, reads }) };
  };

  // An open that outlives its deadline can also block deletion. Bound test-only cleanup so the
  // probe can report the original failure rather than waiting indefinitely for the database.
  const removeProbeJournal = (factory, name) => new Promise((resolve) => {
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'deadline' }), 5000);
    try {
      const request = factory.deleteDatabase(name);
      request.onsuccess = () => finish({ ok: true });
      request.onerror = () => finish({ ok: false, reason: `error: ${request.error?.name ?? 'unknown'}` });
      request.onblocked = () => finish({ ok: false, reason: 'blocked' });
    } catch (error) {
      finish({ ok: false, reason: `error: ${error?.name ?? String(error)}` });
    }
  });

  // The first case is the launch's first IndexedDB open after its data was cleared, and the one failure
  // seen spent about the app's 5000 ms open deadline longer than a passing run (#1249). That delay may
  // be the engine starting its storage, so each launch waits here, with a far longer limit,
  // until a database opens, and records how long that took.
  const journalReady = (factory, { limitMs = 60_000 } = {}) => new Promise((resolve) => {
    const startedAt = performance.now();
    const name = `mrt-complete-restore-target-ready-${crypto.randomUUID()}`;
    const elapsed = () => Math.round(performance.now() - startedAt);
    let settled = false;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ ms: elapsed(), ...outcome });
    };
    const timer = setTimeout(() => finish({ ok: false, reason: 'limit' }), limitMs);
    let request;
    try { request = factory.open(name, 1); }
    catch (error) { finish({ ok: false, reason: `open threw: ${error?.name ?? error}` }); return; }
    request.addEventListener('blocked', () => finish({ ok: false, reason: 'blocked' }));
    request.addEventListener('error', () => finish({ ok: false, reason: `error: ${request.error?.name ?? 'unknown'}` }));
    request.addEventListener('success', async () => {
      const openMs = elapsed();
      request.result.close();
      const cleanup = await removeProbeJournal(factory, name);
      finish(cleanup.ok ? { ok: true, openMs } : { ok: false, reason: `cleanup-${cleanup.reason}`, openMs });
    });
  });

  const completeRestore = async ([storage, model, complete, restoreEngine], { targetChars, cjk }) => {
    const incoming = readerOfSize(model, targetChars, { cjk, seed: 1 });
    const raw = JSON.stringify({ writeToken: 'generated', ...model.exportBackup(incoming) });
    const captured = await complete.captureCompleteBackup({
      storage: { getItem: (key) => key === storage.KEY ? raw : null },
    });
    const priorMain = localStorage.getItem(storage.KEY);
    const roomBefore = room();
    const databaseName = `mrt-complete-restore-target-${crypto.randomUUID()}`;
    const { journal, check } = observedJournal(restoreEngine, {
      open: (_name, version) => indexedDB.open(databaseName, version),
    });
    const locks = { request: async (_name, _options, callback) => callback({}) };
    const engine = new restoreEngine.CompleteRestore({
      storage: localStorage, locks, journal, events: null, reload: () => {},
    });
    let result;
    let journalCleanup;
    try {
      await engine.start();
      result = await engine.restore(captured.text);
    } finally {
      await engine.releaseShared();
      await journal.close();
      journalCleanup = await removeProbeJournal(indexedDB, databaseName);
    }
    const saved = localStorage.getItem(storage.KEY);
    const kept = localStorage.getItem(storage.PRERESTORE_KEY);
    // Key order is not part of the data: the capture writes lists in its own canonical order.
    const canonical = (value) => JSON.stringify(value, (_key, item) => (item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item));
    const lists = (text) => canonical(JSON.parse(text).lists);
    const measured = {
      mix: cjk ? 'cjk' : 'ascii',
      readerChars: raw.length,
      completeBackupBytes: new TextEncoder().encode(captured.text).length,
      priorChars: priorMain?.length ?? 0,
      roomBefore,
      ok: result?.ok === true && journalCleanup.ok,
      error: result?.error ?? (journalCleanup.ok ? null : `The target journal could not be removed (${journalCleanup.reason}).`),
      journalCheck: check(),
      journalCleanup,
      restoredMatches: saved !== null && lists(saved) === canonical(captured.backup.components.reader.lists),
      undoKept: priorMain === null ? null : kept !== null && lists(kept) === lists(priorMain),
      savedChars: saved?.length ?? 0,
      roomAfter: room(),
    };
    localStorage.clear();
    return measured;
  };

  // The time an ordinary save takes at the owner's size, as 4.5.0 wrote it and as this version does,
  // so a slower Done mark would show. Medians of several marks.
  const persistTiming = async ([storage, model], { cjk, marks = 5 }) => {
    localStorage.clear();
    const state = readerOfSize(model, OWNER_CHARS, { cjk, seed: 3 });
    const ids = Object.keys(state.issues);
    const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const timed = (run) => {
      const startedAt = performance.now();
      run();
      return performance.now() - startedAt;
    };
    const legacy = [];
    const narrowed = [];
    const update = [];
    let current = state;
    for (let mark = 0; mark < marks; mark += 1) {
      current = model.markRead(current, ids[mark], true, Date.UTC(2026, 10, 8) + mark);
      const written = { writeToken: crypto.randomUUID(), ...model.exportBackup(current) };
      legacy.push(timed(() => localStorage.setItem(storage.KEY, JSON.stringify(written))));
      narrowed.push(timed(() => localStorage.setItem(storage.KEY, storage.narrowJson(JSON.stringify(written)))));
    }
    localStorage.clear();
    const store = new storage.Store({ storage: localStorage });
    store.load();
    store.update(() => structuredClone(state));
    let ok = store.lastUpdateOk === true;
    for (let mark = 0; mark < marks; mark += 1) {
      const id = ids[marks + mark];
      update.push(timed(() => store.update((draft) => model.markRead(draft, id, true, Date.UTC(2026, 10, 9) + mark))));
      ok = ok && store.lastUpdateOk === true;
    }
    localStorage.clear();
    const round = (value) => Math.round(value * 10) / 10;
    return {
      mix: cjk ? 'cjk' : 'ascii',
      chars: JSON.stringify(model.exportBackup(state)).length,
      marks,
      legacyWriteMs: round(median(legacy)),
      narrowedWriteMs: round(median(narrowed)),
      doneMarkMs: round(median(update)),
      ok,
    };
  };

  // The Node tests drive the journal and restore through a stand-in IndexedDB.
  window.recapRestoreTargetJournal = { observedJournal, journalReady, completeRestore };

  return async function recapRestoreTargetProbe({
    phase = 'in-place',
    targetChars = TARGET_CHARS,
    cjk = false,
  } = {}) {
    const started = Date.now();
    const loaded = await modules();
    const [storage, model] = loaded;
    if (phase === 'seed') {
      localStorage.clear();
      save(storage, readerOfSize(model, targetChars, { cjk, seed: 2 }));
      // WebKit commits stored values in batches, so the write is given time to land before the app ends.
      await new Promise((resolve) => setTimeout(resolve, 2000));
      return JSON.stringify({
        probe: 'recap-restore-target-v1', phase, mix: cjk ? 'cjk' : 'ascii',
        seededChars: localStorage.getItem(storage.KEY)?.length ?? 0,
        durationMs: Date.now() - started,
      });
    }
    if (phase === 'relaunched') {
      const journalReadiness = await journalReady(indexedDB);
      const relaunched = await completeRestore(loaded, { targetChars, cjk });
      return JSON.stringify({
        probe: 'recap-restore-target-v1', phase, targetChars, journalReadiness, relaunched, durationMs: Date.now() - started,
      });
    }
    const journalReadiness = await journalReady(indexedDB);
    const cases = [];
    for (const mix of [false, true]) {
      for (const prior of ['empty', 'saved', 'legacy-wide']) {
        localStorage.clear();
        if (prior === 'saved') save(storage, readerOfSize(model, targetChars, { cjk: mix, seed: 2 }));
        if (prior === 'legacy-wide') {
          const state = readerOfSize(model, targetChars, { cjk: mix, seed: 2 });
          const raw = JSON.stringify({ writeToken: 'generated-legacy', ...model.exportBackup(state) });
          if (!raw.includes('\u2019')) throw new Error('The legacy prior must contain text above Latin-1.');
          localStorage.setItem(storage.KEY, raw);
        }
        cases.push({ prior, ...await completeRestore(loaded, { targetChars, cjk: mix }) });
      }
    }
    const timing = [await persistTiming(loaded, { cjk: false }), await persistTiming(loaded, { cjk: true })];
    localStorage.clear();
    return JSON.stringify({
      probe: 'recap-restore-target-v1', phase, engine: navigator.userAgent, targetChars, journalReadiness, cases, timing,
      durationMs: Date.now() - started,
    });
  };
})();
