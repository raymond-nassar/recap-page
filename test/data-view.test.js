import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDataView, eraseDialogBody, eraseOutcome } from '../src/js/views/data.js';
import { createEmptyState, createList, exportBackup } from '../src/js/lib/model.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// -- pure exports importable from data.js --

test('eraseDialogBody and eraseOutcome are importable from the data view module', () => {
  assert.equal(typeof eraseDialogBody, 'function');
  assert.equal(typeof eraseOutcome, 'function');
  assert.match(eraseDialogBody([]), /^This clears all lists, notes, issue ratings, reading progress/);
  assert.equal(eraseOutcome(false, []), 'All local data erased.');
});

// -- construction uniqueness --

test('main constructs Data once with no controller or forbidden dependency', () => {
  const main = readFileSync(join(ROOT, 'src/js/main.js'), 'utf8');
  const source = readFileSync(join(ROOT, 'src/js/views/data.js'), 'utf8');

  assert.match(main, /const dataView = createDataView\(\{/);
  assert.match(main, /dataView\.wire\(\)/);
  // data.js must not import the controller, Store, MarvelApi, ResponseCache, Hydrator,
  // SynopsisRunner, or concrete sibling views. The backticked citation of storage.js in
  // a comment is not an import.
  assert.doesNotMatch(source, /\bfrom\s+['"].*(?:main|storage|api|cache|hydrate|synopsis)\.js['"]/);
  assert.doesNotMatch(source, /\bimport\b.*(?:main|storage|api|cache|hydrate|synopsis)\.js/);
  assert.doesNotMatch(source, /views\/(?:home|library|progress|issue|catalog|preview|add)\.js/);
  assert.doesNotMatch(source, /new Store|new MarvelApi|new ResponseCache|new RateLimiter|new Hydrator|new SynopsisRunner/);
});

// -- callback delegation --

test('wire delegates settings form submission to onApiBaseSubmit', () => {
  const calls = [];
  const nodes = stubElements();
  const view = createDataView({
    elements: () => nodes,
    getApiBase: () => 'https://example.com',
    getSalvageCopies: () => [],
    hasPreRestoreSnapshot: () => false,
    isAllowedApiBase: () => true,
    backupFileRefusal: () => null,
    askConfirm: async () => false,
    notify: () => {},
    onExportJson: () => {},
    onExportMarkdown: () => {},
    onRestore: () => ({ ok: true, errors: [] }),
    onUndoRestore: () => ({ ok: true, errors: [] }),
    onSetCovers: () => {},
    onSetTheme: () => {},
    onCheckLocalConnection: () => {},
    onApiBaseSubmit: (v) => calls.push({ action: 'apiBase', value: v }),
    onClearCache: async () => {},
    onErase: () => {},
  });
  view.wire();

  assert.equal(nodes.apiBase.value, 'https://example.com', 'wire sets the initial API base');
  nodes.formSettings._fire({ preventDefault: () => {} });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, 'apiBase');
});

test('wire delegates cover toggle to onSetCovers', () => {
  const calls = [];
  const nodes = stubElements();
  const view = createDataView(stubDeps({
    elements: () => nodes,
    onSetCovers: (on) => calls.push(on),
  }));
  view.wire();
  nodes.optCovers._fire({ target: { checked: true } });
  assert.deepEqual(calls, [true]);
});

test('wire keeps order-only, personal Markdown and JSON callbacks separate', () => {
  const calls = [];
  const nodes = stubElements();
  const view = createDataView(stubDeps({
    elements: () => nodes,
    onExportOrder: () => calls.push('order'),
    onExportMarkdown: () => calls.push('personal'),
    onExportJson: () => calls.push('json'),
  }));
  view.wire();
  nodes.btnExportOrder._fire();
  nodes.btnExportMd._fire();
  nodes.btnExportJson._fire();
  assert.deepEqual(calls, ['order', 'personal', 'json']);
});

test('wire delegates both reading shortcut choices to onSetReadingShortcut', () => {
  const calls = [];
  const nodes = stubElements();
  const view = createDataView(stubDeps({
    elements: () => nodes,
    onSetReadingShortcut: (on) => calls.push(on),
  }));
  view.wire();
  nodes.optReadingShortcut._fire({ target: { checked: false } });
  nodes.optReadingShortcut._fire({ target: { checked: true } });
  assert.deepEqual(calls, [false, true]);
});

test('wire delegates erase confirmation to onErase via askConfirm', async () => {
  const calls = [];
  let confirmCalled = false;
  const nodes = stubElements();
  const view = createDataView(stubDeps({
    elements: () => nodes,
    askConfirm: async (opts) => { confirmCalled = true; assert.match(opts.body, /^This clears all lists, notes/); return true; },
    getSalvageCopies: () => [],
    onErase: () => calls.push('erase'),
  }));
  view.wire();
  await nodes.btnWipe._fire();
  assert.ok(confirmCalled);
  assert.deepEqual(calls, ['erase']);
});

test('wire does not call onErase when askConfirm returns false', async () => {
  const calls = [];
  const nodes = stubElements();
  const view = createDataView(stubDeps({
    elements: () => nodes,
    askConfirm: async () => false,
    onErase: () => calls.push('erase'),
  }));
  view.wire();
  await nodes.btnWipe._fire();
  assert.deepEqual(calls, []);
});

test('wire disables cache clear button during async operation', async () => {
  const nodes = stubElements();
  let resolveCache;
  const cachePromise = new Promise((r) => { resolveCache = r; });
  const view = createDataView(stubDeps({
    elements: () => nodes,
    onClearCache: () => cachePromise,
  }));
  view.wire();
  const clickPromise = nodes.btnClearCache._fire();
  assert.equal(nodes.btnClearCache.disabled, true, 'disabled while in flight');
  resolveCache();
  await clickPromise;
  assert.equal(nodes.btnClearCache.disabled, false, 're-enabled after completion');
});

test('Data paints local connection and cache status through its interface', () => {
  const nodes = stubElements();
  const view = createDataView(stubDeps({ elements: () => nodes }));

  view.renderLocalConnectionStatus('checking', 'ready');
  assert.equal(nodes.localConnectionStatus.textContent, 'Checking the local app connection…');
  view.renderLocalConnectionStatus('ready', 'ready');
  assert.equal(nodes.localConnectionStatus.textContent, 'Connected to the local app.');
  view.renderLocalConnectionStatus('down', 'ready');
  assert.equal(nodes.localConnectionStatus.textContent, 'The local app connection needs attention.');

  view.renderCacheUsage({ count: 2, bytes: 1024 * 1024, budget: 10 * 1024 * 1024 });
  assert.equal(nodes.cacheUsage.textContent, '2 cached responses, about 1.00 MB of a 10 MB budget.');
  view.renderCacheUsage(null);
  assert.match(nodes.cacheUsage.textContent, /Cache unavailable/);
});

test('restore notifies error for oversized file', async () => {
  const notifications = [];
  const nodes = stubElements();
  const view = createDataView(stubDeps({
    elements: () => nodes,
    backupFileRefusal: () => 'too big',
    notify: (sel, msg, kind) => notifications.push({ sel, msg, kind }),
  }));
  view.wire();
  await nodes.restoreFile._fire({ target: { files: [{ size: 999999999 }], value: 'x' } });
  assert.equal(notifications.length, 1);
  assert.match(notifications[0].msg, /^Reading data is unchanged\..*Choose.*too big/);
  assert.equal(notifications[0].kind, 'error');
});

test('restore confirms captured replacement, cancels safely and restores focus after reenable', async () => {
  const nodes = stubElements();
  const expected = { ok: true, main: 'current', snapshot: 'copy', available: true, kind: 'undo', edited: true, summary: '5 lists.' };
  const calls = [];
  let yes = false;
  const view = createDataView(stubDeps({
    elements: () => nodes, getRestoreOffer: () => expected,
    inspectBackup: () => ({ ok: true }),
    askConfirm: async (options) => { calls.push(options); return yes; },
    onRestore: (text, captured) => { calls.push({ text, captured }); return { ok: true }; },
    onUndoRestore: (captured) => { calls.push({ captured }); return { ok: true }; },
  }));
  view.wire();
  nodes.restoreFile.files = [{ text: async () => 'backup' }];
  await nodes.restoreFile._fire({ target: nodes.restoreFile });
  assert.equal(nodes.restoreFile.disabled, false);
  assert.equal(nodes.restoreFile.focused, true);
  assert.equal(calls.length, 1);
  yes = true;
  await nodes.restoreFile._fire({ target: nodes.restoreFile });
  assert.equal(calls[2].captured, expected);
  assert.equal(calls[2].text, 'backup');
  yes = false;
  await nodes.undoRestore._fire();
  assert.match(calls.at(-1).body, /intervening edits/);
  assert.equal(nodes.undoRestore.focused, true);
  assert.equal(nodes.undoRestore.disabled, false);
});

test('invalid reading backups and failed file reads lead with non-mutation and next action', async () => {
  for (const mode of ['invalid', 'read']) {
    const nodes = stubElements();
    const notices = [];
    let applied = 0;
    const view = createDataView(stubDeps({
      elements: () => nodes,
      inspectBackup: () => ({ ok: false, errors: ['Technical parser detail'] }),
      onRestore: () => { applied += 1; },
      notify: (_target, message) => notices.push(message),
    }));
    view.wire();
    nodes.restoreFile.files = [{ text: async () => { if (mode === 'read') throw new Error('Cannot read'); return 'bad'; } }];
    await nodes.restoreFile._fire({ target: nodes.restoreFile });
    assert.equal(applied, 0);
    assert.match(notices[0], /^Reading data is unchanged\..*Choose/);
    assert.equal(nodes.restoreFile.getAttribute('aria-invalid'), 'true');
    assert.ok(nodes.restoreFile.getAttribute('aria-describedby').includes('restore-report'));
  }
});

test('unknown or changed restore outcomes never claim unchanged reading data', async () => {
  for (const changed of [null, true]) {
    const nodes = stubElements();
    const notices = [];
    const view = createDataView(stubDeps({
      elements: () => nodes,
      askConfirm: async () => true,
      onRestore: () => ({ ok: false, changed, errors: ['Verification failed'] }),
      notify: (_target, message) => notices.push(message),
    }));
    view.wire();
    nodes.restoreFile.files = [{ text: async () => 'backup' }];
    await nodes.restoreFile._fire({ target: nodes.restoreFile });
    assert.doesNotMatch(notices[0], /unchanged|nothing was changed/i);
    assert.match(notices[0], changed === null ? /unknown/ : /Reading data changed/);
  }
});

// -- what a reading-data restore replaces --

// Taken from the model rather than from any copy on screen: every map a reading-data backup
// carries, and the words the screens use for it. A restore swaps the whole saved value for the
// backup's, so each of these is replaced. Deferrals are stored on each list but named apart, as
// the backup card already named them. Of the issue map, only the entries added by hand were
// written by the reader; the rest are details that arrive with the lists holding those comics.
const BACKUP_ENVELOPE = ['schemaVersion', 'exportedAt', 'app'];
const REPLACED = {
  lists: ['lists', 'deferrals'],
  listOrder: ['lists'],
  active: ['lists'],
  issues: ['issues added by hand'],
  read: ['reading progress'],
  overrides: ['availability overrides'],
  notes: ['notes'],
  ratings: ['issue ratings'],
};
const REPLACED_WORDS = [...new Set(Object.values(REPLACED).flat())];

test('every map a reading-data backup carries is named for the reader', () => {
  const carried = Object.keys(exportBackup(createEmptyState())).filter((key) => !BACKUP_ENVELOPE.includes(key));
  assert.deepEqual(carried.sort(), Object.keys(REPLACED).sort());
  const [list] = Object.values(exportBackup(createList(createEmptyState(), { name: 'Fixture' })).lists);
  assert.ok(Object.hasOwn(list, 'deferredIssueIds'), 'deferrals travel inside each saved list');
});

// The three questions asked before reading data is replaced: a chosen backup file, the one-shot
// Undo, and the retained copy offered after Undo or a reload. Each is cancelled, so nothing applies.
async function restoreQuestions() {
  const nodes = stubElements();
  const asked = [];
  let offer = { ok: true, available: true, kind: 'copy', main: 'current', snapshot: 'copy', summary: '5 lists.' };
  const view = createDataView(stubDeps({
    elements: () => nodes,
    getRestoreOffer: () => offer,
    inspectBackup: () => ({ ok: true }),
    askConfirm: async (options) => { asked.push(options); return false; },
  }));
  view.wire();
  nodes.restoreFile.files = [{ text: async () => 'backup' }];
  await nodes.restoreFile._fire({ target: nodes.restoreFile });
  offer = { ...offer, kind: 'undo' };
  await nodes.undoRestore._fire();
  offer = { ...offer, kind: 'copy' };
  await nodes.undoRestore._fire();
  return { nodes, asked };
}

test('restore, Undo and saved-copy confirmations name every kind of data they replace', async () => {
  const { asked } = await restoreQuestions();
  assert.deepEqual(asked.map(({ title, confirmLabel }) => [title, confirmLabel]), [
    ['Replace reading data with this backup?', 'Restore reading data'],
    ['Undo the last reading-data restore?', 'Undo restore'],
    ['Replace reading data with the saved copy?', 'Restore saved copy'],
  ]);
  for (const { title, body } of asked) {
    for (const words of REPLACED_WORDS) assert.ok(body.includes(words), `"${title}" does not name ${words}: ${body}`);
  }
});

test('one phrase feeds the backup card and all three restore confirmations', async () => {
  const { nodes, asked } = await restoreQuestions();
  const card = nodes.backupContents.textContent;
  const contents = /^Reading-data backups contain (.+)\.$/.exec(card)?.[1];
  assert.ok(contents, `the backup card names no contents: "${card}"`);
  for (const words of REPLACED_WORDS) assert.ok(contents.includes(words), `the backup card does not name ${words}`);
  const [file, undo, copy] = asked.map(({ body }) => body);
  assert.ok(file.includes(`This replaces all ${contents}.`), file);
  assert.ok(undo.includes(`This replaces all current ${contents}.`), undo);
  assert.ok(copy.includes(`This replaces all current ${contents}.`), copy);
});

// -- what erasing clears --

// Erasing writes an empty saved value over the whole of the reading data, so every map a backup
// carries is cleared, and the question names each with the words a restore uses. The rest of the
// map is what the route removes beside it: completion history, the import draft once the erase is
// verified, and the saved reading-data copy behind Undo. #851: the question named lists, progress,
// notes and ratings, and none of the rest, while it already named the copies an erase leaves.
const ERASED_WORDS = [...REPLACED_WORDS, 'Completion and enjoyment history', 'import draft'];
const SAVED_COPY = {
  present: {
    offer: { ok: true, available: true, kind: 'copy', main: 'current', snapshot: 'copy', summary: '5 lists.' },
    said: 'The saved reading-data copy will be erased too.',
  },
  unknown: {
    offer: { ok: false, available: false, errors: ['Could not check saved reading data and its recovery copy (read refused). Reload and try again.'] },
    said: 'The app could not check for a saved reading-data copy. If there is one, it will be erased too.',
  },
  absent: { offer: { ok: true, available: false, main: 'current', snapshot: null }, said: null },
};

async function eraseQuestion(offer) {
  const nodes = stubElements();
  const asked = [];
  const view = createDataView(stubDeps({
    elements: () => nodes,
    eraseHistory: true,
    getRestoreOffer: () => offer,
    askConfirm: async (options) => { asked.push(options); return false; },
  }));
  view.wire();
  await nodes.btnWipe._fire();
  assert.equal(asked.length, 1, 'one question, cancelled, so nothing is erased');
  return { nodes, body: asked[0].body };
}

test('erasing empties every map a reading-data backup carries', () => {
  const erased = exportBackup(createEmptyState());
  for (const key of Object.keys(REPLACED)) {
    const value = erased[key];
    assert.ok(value === null || Object.keys(value).length === 0, `${key} survives an erase: ${JSON.stringify(value)}`);
  }
});

test('the erase question names everything erasing clears, and the saved copy whenever one may exist', async () => {
  for (const [state, { offer, said }] of Object.entries(SAVED_COPY)) {
    const { body } = await eraseQuestion(offer);
    for (const words of ERASED_WORDS) assert.ok(body.includes(words), `with the saved copy ${state}, the question does not name ${words}: ${body}`);
    if (said) assert.ok(body.includes(said), `with the saved copy ${state}, the question does not say: ${said}\n${body}`);
    else assert.ok(!body.includes('saved reading-data copy'), `with no saved copy, the question names one: ${body}`);
  }
});

test('the line beside Erase all local data names what the question names, from the same phrase', async () => {
  const { nodes, body } = await eraseQuestion(SAVED_COPY.present.offer);
  const line = nodes.eraseContents.textContent;
  for (const words of [...ERASED_WORDS, 'saved reading-data copy']) {
    assert.ok(line.toLowerCase().includes(words.toLowerCase()), `the Danger zone line does not name ${words}: ${line}`);
  }
  const contents = /^Reading-data backups contain (.+)\.$/.exec(nodes.backupContents.textContent)?.[1];
  assert.ok(line.startsWith(`Erasing removes all ${contents}, `), line);
  assert.ok(body.startsWith(`This clears all ${contents}.`), body);
});

// -- service replacement ownership in main --

test('main retains API replacement and service rebinding in the onApiBaseSubmit callback', () => {
  const src = readFileSync(join(ROOT, 'src/js/main.js'), 'utf8');
  const callback = src.indexOf('onApiBaseSubmit:');
  assert.ok(callback !== -1, 'onApiBaseSubmit callback must exist in main');
  const block = src.slice(callback, callback + 1600);
  assert.match(block, /new ResponseCache/);
  assert.match(block, /new MarvelApi/);
  assert.match(block, /hydrator\.api\s*=\s*api/);
  assert.match(block, /synopsisRunner\.api\s*=\s*api/);
  assert.match(block, /synopsisRunner\.cancel/);
  assert.match(block, /sessionSynopsis\.clear/);
});

test('a restored import draft sends the reader to Search to resume it', async () => {
  const notices = [];
  const nodes = { ...stubElements(), restoreDraft: stubNode() };
  const view = createDataView(stubDeps({
    elements: () => nodes,
    askConfirm: async () => true,
    captureDraft: () => 'draft-1',
    draftFileRefusal: () => null,
    onRestoreDraft: async () => ({ ok: true }),
    notify: (selector, message, tone) => notices.push([selector, message, tone]),
  }));
  view.wire();
  const field = { files: [{ text: async () => '{}' }], value: 'draft.json', focus() {} };
  await nodes.restoreDraft._fire({ target: field });
  // The page that resumes a draft is named Search everywhere now (#831, #924).
  assert.deepEqual(notices.at(-1), ['#draft-transfer-report',
    'Import draft restored. Reading data was not changed. Review Resume saved import in Search.', 'ok']);
});

// -- helpers --

function stubNode(overrides = {}) {
  const listeners = {};
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    value: '',
    checked: false,
    isConnected: true,
    attributes: {},
    getAttribute(name) { return this.attributes[name] ?? null; },
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    closest() { return null; },
    focus() { this.focused = true; },
    addEventListener(name, fn) { listeners[name] = fn; },
    _fire(arg) { return (listeners.change || listeners[Object.keys(listeners)[0]])?.(arg); },
    ...overrides,
  };
}

function stubElements() {
  return {
    apiBase: stubNode(),
    optCovers: stubNode(),
    optTheme: stubNode(),
    optReadingShortcut: stubNode(),
    optDescriptionHiding: stubNode(),
    btnCheckLocalConnection: stubNode(),
    btnExportJson: stubNode(),
    backupContents: stubNode(),
    eraseContents: stubNode(),
    btnExportMd: stubNode(),
    btnExportOrder: stubNode(),
    restoreFile: stubNode(),
    undoRestore: stubNode(),
    restoreCopySummary: stubNode(),
    btnExportRestoreCopy: stubNode(),
    formSettings: stubNode(),
    btnClearCache: stubNode(),
    btnWipe: stubNode(),
    cacheUsage: stubNode(),
    localConnectionReport: stubNode({ replaceChildren() {} }),
    localConnectionStatus: stubNode(),
  };
}

function stubDeps(overrides = {}) {
  return {
    elements: () => stubElements(),
    getApiBase: () => '',
    getSalvageCopies: () => [],
    hasPreRestoreSnapshot: () => false,
    isAllowedApiBase: () => true,
    backupFileRefusal: () => null,
    askConfirm: async () => false,
    notify: () => {},
    onExportJson: () => {},
    onExportMarkdown: () => {},
    onRestore: () => ({ ok: true, errors: [] }),
    onUndoRestore: () => ({ ok: true, errors: [] }),
    onSetCovers: () => {},
    onSetTheme: () => {},
    onSetReadingShortcut: () => {},
    onSetDescriptionHiding: () => {},
    onCheckLocalConnection: () => {},
    onApiBaseSubmit: () => {},
    onClearCache: async () => {},
    onErase: () => {},
    ...overrides,
  };
}
