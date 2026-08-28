// Fault-injection harness. Extracted from an inline <script type="module"> so the
// server can send a Content-Security-Policy with a strict `script-src 'self'`.

const KEY = 'mrt.state.v2';
const BACKUP = 'mrt.devtools.backup';
const FILL = '__mrt_fill_';
let fileSavedAs = null;

const $ = (id) => document.getElementById(id);
const bytes = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);

// Every button must visibly report itself. A readout that changes quietly reads as "nothing
// happened", which is exactly how the first version of this page failed.
function say(id, msg, tone = 'ok') {
  const el = $(id);
  el.textContent = msg;
  el.style.color = tone === 'bad' ? '#f3a0a0' : '#9fd3b4';
  el.animate(
    [{ background: tone === 'bad' ? '#3a1720' : '#12351f' }, { background: '#0e0f15' }],
    { duration: 900, easing: 'ease-out' },
  );
}

function summarize(raw) {
  if (raw == null) return 'nothing saved';
  try {
    const s = JSON.parse(raw);
    const lists = Object.keys(s.lists ?? {}).length;
    const read = Object.keys(s.read ?? {}).length;
    const issues = Object.keys(s.issues ?? {}).length;
    return `schema v${s.schemaVersion}, ${lists} list(s), ${issues} issue(s), ${read} marked read, ${bytes(raw.length)}`;
  } catch {
    return `UNREADABLE (${bytes(raw.length)}): ${raw.slice(0, 40)}…`;
  }
}

function refreshSafe(note) {
  const live = localStorage.getItem(KEY);
  const snap = localStorage.getItem(BACKUP);
  const fileNote = fileSavedAs == null
    ? 'file copy  : NONE, press "1. Save a backup file"'
    : `file copy  : saved to your Downloads folder as ${fileSavedAs}`;
  say('out-safe',
    `${note ? `${note}\n\n` : ''}` +
    `live state : ${summarize(live)}\n` +
    `snapshot   : ${snap == null ? 'NONE, press "2. Snapshot inside the browser"' : summarize(snap)}\n` +
    `${fileNote}`,
    note && /could not|failed|refus/i.test(note) ? 'bad' : 'ok');
}

$('b-backup').addEventListener('click', () => {
  const live = localStorage.getItem(KEY);
  if (live == null) {
    refreshSafe('Nothing is saved yet, so there is nothing to snapshot. Use the tracker first.');
    return;
  }
  const existing = localStorage.getItem(BACKUP);
  if (existing != null && !confirm('A snapshot already exists. Overwrite it with the current live state?')) return;
  try {
    localStorage.setItem(BACKUP, live);
    refreshSafe('Snapshot taken inside the browser. No file was created; that is button 1.');
  } catch (e) {
    refreshSafe(`Could not write the snapshot (${e.name}). Free storage first, or rely on the file copy.`);
  }
});

$('b-download').addEventListener('click', () => {
  const raw = localStorage.getItem(BACKUP) ?? localStorage.getItem(KEY);
  if (raw == null) { refreshSafe('Nothing is saved yet, so there is nothing to download.'); return; }
  const name = `mrt-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
  const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
  fileSavedAs = name;
  refreshSafe(`Saved ${name}. Check your Downloads folder now and confirm it is there before continuing.`);
});

$('b-restore').addEventListener('click', () => {
  const snap = localStorage.getItem(BACKUP);
  if (snap == null) { refreshSafe('No snapshot exists, so nothing was changed. Use "Restore from a file…" instead.'); return; }
  applyRestore(snap, 'snapshot');
});

$('b-restore-file').addEventListener('click', () => $('f-restore').click());

$('f-restore').addEventListener('change', async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = ''; // let the same file be picked again
  if (!file) return;
  const text = await file.text();
  try { JSON.parse(text); } catch {
    refreshSafe(`${file.name} is not valid JSON, so it was refused. Nothing was changed.`);
    return;
  }
  applyRestore(text, file.name);
});

// Deliberately bypasses the app's own schema check: this is the escape hatch for the case where
// the app refuses a backup it cannot read, so the user is never left with no way back.
function applyRestore(raw, sourceLabel) {
  freeFill(); // a full quota would otherwise block the restore
  try {
    localStorage.setItem(KEY, raw);
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('mrt.state.salvage') || k === 'mrt.state.prerestore' || k === 'mrt.state.restore.tmp') {
        localStorage.removeItem(k);
      }
    }
    refreshSafe(`Restored from ${sourceLabel}. Reload the tracker tab to see it.`);
  } catch (e) {
    refreshSafe(`Restore failed (${e.name}). Try "Free storage again" in section 3c first.`);
  }
}

$('b-report').addEventListener('click', async () => {
  const rows = Object.keys(localStorage)
    .map((k) => [k, (localStorage.getItem(k) ?? '').length])
    .sort((a, b) => b[1] - a[1])
    .map(([k, n]) => `  ${k.padEnd(34)} ${bytes(n)}`);
  let quota = '';
  try {
    const est = await navigator.storage.estimate();
    quota = `\nbrowser estimate: ${bytes(est.usage ?? 0)} used of ${bytes(est.quota ?? 0)} (covers IndexedDB too)`;
  } catch { /* not supported */ }
  say('out-safe', `${rows.length} key(s) on this origin:\n${rows.join('\n')}${quota}`);
});

$('b-corrupt').addEventListener('click', () => {
  if (!guard()) return;
  localStorage.setItem(KEY, '{ not valid json');
  say('out-3a', 'Saved state replaced with invalid JSON.\nNow switch to the tracker tab and reload it (Ctrl+Shift+R).');
  refreshSafe();
});

$('b-newer').addEventListener('click', () => {
  if (!guard()) return;
  const raw = localStorage.getItem(BACKUP) ?? localStorage.getItem(KEY);
  let obj;
  try { obj = JSON.parse(raw); } catch {
    say('out-3b', 'Your current state is not readable, so it cannot be stamped. Restore your backup first.');
    return;
  }
  obj.schemaVersion = 99;
  localStorage.setItem(KEY, JSON.stringify(obj));
  say('out-3b',
    'State stamped as schema v99 with your real data intact.\n' +
    'Switch to the tracker and reload. The copy it offers you should contain the lists and\n' +
    'progress listed above. Check the downloaded file to be sure.');
  refreshSafe();
});

$('b-fill').addEventListener('click', () => {
  const chunk = 'x'.repeat(100000);
  let written = 0;
  try {
    for (let i = 0; i < 5000; i += 1) { localStorage.setItem(FILL + i, chunk); written += 1; }
    say('out-3c', `Wrote ${written} chunks without hitting a limit. Storage may be unusually large here.`);
    return;
  } catch (e) {
    say('out-3c',
      `Storage is now full after ${written} chunks (${e.name}).\n` +
      'Go to the tracker (no reload needed) and try marking something read.\n' +
      'Press "Free storage again" when you are done.');
  }
});

function freeFill() {
  let removed = 0;
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith(FILL)) { localStorage.removeItem(k); removed += 1; }
  }
  return removed;
}

$('b-free').addEventListener('click', () => {
  const removed = freeFill();
  say('out-3c', `Freed ${removed} chunk(s). Saving should work again, so try the same action in the tracker.`);
});

function deleteCacheDatabase(name, onBlocked) {
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.deleteDatabase(name);
    } catch (error) {
      resolve({ name, status: 'failed', error });
      return;
    }
    request.onblocked = () => onBlocked(name);
    request.onsuccess = () => resolve({ name, status: 'deleted' });
    request.onerror = () => resolve({
      name,
      status: 'failed',
      error: request.error ?? new Error('Deletion failed.'),
    });
  });
}

$('b-wipe').addEventListener('click', async () => {
  if (!confirm('Remove ALL tracker data on this origin, including the harness backup?\n\nThis cannot be undone from here.')) return;
  let removed = 0;
  for (const k of Object.keys(localStorage)) {
    if (k.startsWith('mrt.') || k.startsWith(FILL)) { localStorage.removeItem(k); removed += 1; }
  }
  const pending = new Set();
  const onBlocked = (name) => {
    pending.add(name);
    say('out-wipe', `Removed ${removed} key(s). Close other tracker tabs to finish deleting ${[...pending].join(' and ')}.`, 'bad');
  };
  const results = await Promise.all([
    deleteCacheDatabase('mrt-cache-v2', onBlocked),
    deleteCacheDatabase('mrt-cache', onBlocked),
  ]);
  const failed = results.filter((result) => result.status === 'failed');
  say(
    'out-wipe',
    failed.length
      ? `Removed ${removed} key(s), but could not delete ${failed.map((result) => result.name).join(' and ')} (${failed[0].error.message}).`
      : `Removed ${removed} key(s) and deleted both metadata cache generations.`,
    failed.length ? 'bad' : 'ok',
  );
  refreshSafe();
});

// Refuses to break anything until a copy exists, since that is the whole point of the safety net.
function guard() {
  if (localStorage.getItem(KEY) == null) return true; // nothing to lose
  if (localStorage.getItem(BACKUP) != null || fileSavedAs != null) return true;
  alert('Take a backup first (step 0). That is what makes these faults safe to run.');
  return false;
}

refreshSafe();
