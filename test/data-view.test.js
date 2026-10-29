import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDataView, eraseDialogBody, eraseOutcome } from '../src/js/views/data.js';
import {
  cloudBackupStatus, cloudCardStatus, cloudEraseNote, createCloudBackupView,
} from '../src/js/views/cloud.js';
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

// -- the cloud backup card (#810, P02-T05) --

const STREAM = 'a'.repeat(32);
const NEWEST = Object.freeze({ id: 'item-9', stream: STREAM, generation: 9, device: 'Phone', createdAt: 900, size: 40, summary: { lists: 2, records: 3, draft: false } });
const EARLIER = Object.freeze({ ...NEWEST, id: 'item-8', generation: 8, createdAt: 800, summary: { lists: 1, records: 3, draft: false } });
const FOUND = Object.freeze({
  state: 'ready', connection: 'c'.repeat(32), message: null, code: null,
  result: { own: null, devices: [{ stream: STREAM, own: false, current: NEWEST, previous: EARLIER, invalid: 1, files: 3 }], omitted: 0, unrecognized: 2 },
});
const CLOUD = Object.freeze({
  shown: true, provider: 'onedrive', host: 'connected', account: 'reader@example.test', message: null, signInExpiresAt: null,
  agreed: false, on: false, askedAgain: false, hasStream: false, recordProblem: null,
  backup: { phase: 'off', code: null, retryAt: null, lastUploadAt: null },
  discovery: { state: 'idle', connection: null, result: null, message: null, code: null },
});
const CONTROLS = ['intro', 'status', 'progress', 'primary', 'signIn', 'retry', 'auto', 'discovery', 'actions', 'remove', 'disconnect'];
const when = (at) => `T${at}`;
const settled = async () => { for (let turn = 0; turn < 8; turn += 1) await new Promise((resolve) => { setImmediate(resolve); }); };

// Enough of document.createElement for the card: tags, text, attributes and data, and the buttons below.
function fakeEl(tag, props = {}, children = []) {
  const node = stubNode({ tag, dataset: {}, children: [].concat(children).filter((child) => child != null) });
  for (const [key, value] of Object.entries(props)) {
    if (value == null || value === false) continue;
    if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else node.attributes[key] = value;
  }
  node.closest = (selector) => (selector === 'button' && tag === 'button' ? node : null);
  return node;
}

function buttonsIn(node) {
  return (node.children ?? []).flatMap((child) => [...(child.tag === 'button' ? [child] : []), ...buttonsIn(child)]);
}

function cloudNodes() {
  const nodes = Object.fromEntries(['card', ...CONTROLS, 'autoInput', 'discoverySummary'].map((key) => [key, stubNode()]));
  nodes.found = stubNode({
    children: [],
    replaceChildren(...parts) { this.children = parts; },
    querySelectorAll() { return buttonsIn(this); },
  });
  return nodes;
}

function cloudCard(model, overrides = {}) {
  const nodes = cloudNodes();
  const state = { model, asked: [], notices: [], calls: [] };
  const record = (name, value) => async (...args) => { state.calls.push([name, ...args]); return typeof value === 'function' ? value(...args) : value; };
  const view = createCloudBackupView({
    el: fakeEl, elements: () => nodes, getModel: () => state.model, when, at: when,
    askConfirm: async (options) => { state.asked.push(options); return state.answers.shift() ?? false; },
    askConfirmChoice: async (options) => { state.asked.push(options); return state.answers.shift() ?? null; },
    notify: (selector, message, kind) => state.notices.push([selector, message, kind]),
    onConnect: record('connect'), onTurnOn: record('on'), onTurnOff: record('off'), onDiscover: record('discover'),
    onFetch: record('fetch', (copy) => ({ ...copy, text: '{"backup":true}' })), onRestore: record('restore', { ok: true }),
    onDeleteOwn: record('delete', { deleted: 2, failed: [] }), onDisconnect: record('disconnect'), onRetry: () => state.calls.push(['retry']),
    onFinished: (message) => state.calls.push(['finished', message]),
    ...overrides,
  });
  state.answers = [];
  view.wire();
  const shown = () => CONTROLS.filter((key) => !nodes[key].hidden);
  return { nodes, view, state, shown, show(next) { state.model = next; view.render(next); } };
}

test('the cloud card shows only what each state allows, and nothing at all in a build without cloud backup', () => {
  const card = cloudCard({ ...CLOUD, shown: false });
  assert.equal(card.nodes.card.hidden, true);

  card.show({ ...CLOUD, host: 'not-connected', account: null });
  assert.equal(card.nodes.card.hidden, false);
  assert.deepEqual(card.shown(), ['intro', 'primary', 'signIn'], 'signed out: what it does, and Sign in with Microsoft');

  card.show({ ...CLOUD, host: 'signing-in', account: null, signInExpiresAt: 300 });
  assert.deepEqual(card.shown(), ['intro', 'status']);
  assert.equal(card.nodes.status.textContent, 'Finish signing in to Microsoft in the browser window that opened. The sign-in stops by itself at T300.');

  card.show({ ...CLOUD, discovery: FOUND });
  assert.deepEqual(card.shown(), ['status', 'auto', 'discovery', 'actions', 'disconnect'], 'connected, not agreed: the account first');
  assert.deepEqual([card.nodes.autoInput.checked, card.nodes.discovery.open], [false, true]);
  assert.equal(card.nodes.status.textContent, 'Connected to OneDrive as reader@example.test.');

  const on = { ...CLOUD, agreed: true, on: true, hasStream: true, discovery: FOUND };
  card.show({ ...on, backup: { phase: 'saving', code: null, retryAt: null, lastUploadAt: 500 } });
  assert.deepEqual(card.shown(), ['status', 'progress', 'auto', 'discovery', 'actions', 'remove', 'disconnect']);
  assert.equal(card.nodes.autoInput.checked, true);
  card.show({ ...on, backup: { phase: 'failed', code: 'quota', retryAt: null, lastUploadAt: 500 } });
  assert.ok(card.shown().includes('retry'));
  assert.match(card.nodes.status.textContent, /OneDrive is full, so backups have stopped\. .* Last backed up T500\.$/);

  card.show({ ...on, host: 'needs-sign-in' });
  assert.deepEqual(card.shown(), ['status', 'primary', 'signIn', 'auto', 'actions', 'disconnect'], 'sign in again, or turn off, or disconnect');
  card.show({ ...on, host: 'not-answering', account: null });
  assert.deepEqual(card.shown(), ['status', 'auto'], 'the app is not answering: only turning it off here');
  card.show({ ...CLOUD, host: 'unavailable', account: null, message: 'Windows is restricting PowerShell.' });
  assert.deepEqual(card.shown(), ['status', 'actions', 'disconnect']);
  assert.equal(card.nodes.status.textContent, 'Windows is restricting PowerShell.');
  card.show({ ...CLOUD, agreed: true, askedAgain: true, discovery: FOUND });
  assert.equal(card.nodes.autoInput.checked, false, 'agreed to another connection: asked again');
  assert.match(card.nodes.status.textContent, /connected again since this browser agreed/);
});

test('what backups are doing is said in words for every state the coordinator reports', () => {
  const said = (phase, code = null, retryAt = null, lastUploadAt = 7) => cloudBackupStatus({ phase, code, retryAt, lastUploadAt }, { when, at: when });
  assert.equal(said('saving'), 'Backing up now.');
  assert.equal(said('up-to-date'), 'Backed up T7.');
  assert.equal(said('pending'), 'Changes are waiting to be backed up. Last backed up T7.');
  assert.equal(said('waiting', 'offline'), 'Backups wait for a network connection. Last backed up T7.');
  assert.equal(said('waiting', 'paused', null, null), 'Backups wait for the restore to finish.');
  assert.equal(said('retrying', 'timeout', 99), 'The last backup did not finish, so it is tried again at T99. Last backed up T7.');
  for (const code of ['oversize', 'too-large']) assert.match(said('failed', code), /^Your saved data is larger than a cloud backup can be/);
  assert.match(said('failed', 'storage'), /could not read its saved data or its cloud backup record/);
  assert.match(said('failed', 'hash'), /^A backup could not be made, so backups have stopped until your data changes or you try again\./);
  assert.equal(cloudCardStatus({ ...CLOUD, host: 'needs-sign-in' }), 'Microsoft asked for the sign-in to be made again, so backups have stopped. Sign in to carry on.');
  assert.equal(cloudCardStatus({ ...CLOUD, host: 'not-connected', message: 'Sign-in was cancelled.' }), 'Sign-in was cancelled.');
});

test('the backups found are listed by device with Restore buttons named for what they restore, kept while backups go on', () => {
  const card = cloudCard({ ...CLOUD, discovery: FOUND });
  const [device, unrecognized] = card.nodes.found.children.filter((child) => child.tag !== 'button').slice(-2);
  assert.equal(device.children[0].textContent, 'Phone');
  const buttons = card.nodes.found.querySelectorAll('button');
  assert.deepEqual(buttons.map((button) => [button.attributes.id, button.textContent, button.dataset.cloudCopy, button.dataset.cloudGeneration]), [
    [`cloud-copy-${STREAM}-current`, 'Restore', 'current', '9'], [`cloud-copy-${STREAM}-previous`, 'Restore', 'previous', '8'], [undefined, 'Check again', undefined, undefined],
  ]);
  assert.deepEqual(buttons.slice(0, 2).map((button) => button.attributes['aria-label']), [
    'Restore the newest backup from Phone, made T900', 'Restore the earlier backup from Phone, made T800',
  ], 'each name starts with what the button says');
  assert.match(device.children.at(-1).textContent, /^1 more backup could not be read, so it is not offered\.$/);
  assert.equal(unrecognized.textContent, '2 other files in the folder were left alone.');
  const drawn = card.nodes.found.children;
  card.show({ ...CLOUD, discovery: FOUND, on: true, agreed: true, backup: { phase: 'saving', code: null, retryAt: null, lastUploadAt: null } });
  assert.equal(card.nodes.found.children, drawn, 'not redrawn, so a focused Restore keeps focus');
});

test('restoring a backup from the account reads it again and asks with the danger answer; Cancel applies nothing', async () => {
  const card = cloudCard({ ...CLOUD, discovery: FOUND });
  const [newest] = card.nodes.found.querySelectorAll('button');
  card.nodes.found._fire({ target: newest });
  await settled();
  assert.deepEqual(card.state.calls.map(([name]) => name), ['fetch'], 'read and checked again first');
  const [question] = card.state.asked;
  assert.deepEqual([question.title, question.confirmLabel, question.danger], ['Replace all saved data with this backup?', 'Restore this backup', true]);
  assert.ok(question.body.startsWith('From Phone, made T900. This replaces your reading data with this backup\'s 2 lists,'), question.body);
  assert.ok(!question.body.includes('file'), 'a backup from the account is never called a file');

  card.state.answers.push(true);
  card.nodes.found._fire({ target: newest });
  await settled();
  assert.deepEqual(card.state.calls.slice(-2), [['restore', '{"backup":true}'], ['finished', 'Backup restored from OneDrive. Any import draft from it waits in Search for your review.']]);

  const gone = cloudCard({ ...CLOUD, discovery: FOUND }, {
    onFetch: async () => { throw new Error('That backup is no longer in the cloud account. Nothing was changed.'); },
  });
  gone.nodes.found._fire({ target: gone.nodes.found.querySelectorAll('button')[0] });
  await settled();
  assert.deepEqual(gone.state.notices, [['#cloud-backup-report', 'That backup is no longer in the cloud account. Nothing was changed.', 'error']]);
  assert.deepEqual(gone.state.asked, [], 'nothing is asked about a backup that is gone');
});

test('deleting this device\'s backups asks first, says the recycle bin keeps them, and says what is left when it stops part way', async () => {
  const card = cloudCard({ ...CLOUD, agreed: true, on: true, hasStream: true });
  card.nodes.remove._fire();
  await settled();
  const [question] = card.state.asked;
  assert.deepEqual([question.title, question.confirmLabel, question.danger], ['Delete this device\'s cloud backups?', 'Delete cloud backups', true]);
  assert.match(question.body, /Deleted backups stay in OneDrive's recycle bin until it is emptied, but Recap Page cannot bring them back\./);
  assert.deepEqual(card.state.calls, [], 'Cancel deletes nothing');

  const partial = cloudCard({ ...CLOUD, agreed: true, on: true, hasStream: true }, {
    onDeleteOwn: async () => ({ deleted: 1, failed: [{ id: 'item-2', name: 'b', code: 'timeout' }] }),
  });
  partial.state.answers.push(true);
  partial.nodes.remove._fire();
  await settled();
  assert.deepEqual(partial.state.notices.at(-1), ['#cloud-backup-report',
    'Deleted 1 of 2 backups of this browser. 1 backup could not be deleted (OneDrive did not answer in time). Automatic backup is off for this browser; delete again to finish.', 'warn']);
});

test('disconnecting offers deleting this device\'s backups as an unchecked choice, and asks again before leaving some behind', async () => {
  const model = { ...CLOUD, agreed: true, on: true, hasStream: true };
  const plain = cloudCard(model);
  plain.state.answers.push({ choice: false });
  plain.nodes.disconnect._fire();
  await settled();
  const [question] = plain.state.asked;
  assert.deepEqual([question.title, question.confirmLabel, question.choiceLabel, question.choiceConfirmLabel],
    ['Disconnect OneDrive?', 'Disconnect', 'Also delete this device\'s cloud backups', 'Delete and disconnect']);
  assert.match(question.body, /for every browser profile on this Windows account/);
  assert.deepEqual(plain.state.calls.map(([name]) => name), ['disconnect'], 'the box left unchecked deletes nothing');

  const stuck = cloudCard(model, { onDeleteOwn: async () => ({ deleted: 0, failed: [{ id: 'x', name: 'x', code: 'needs-sign-in' }] }) });
  stuck.state.answers.push({ choice: true }, false);
  stuck.nodes.disconnect._fire();
  await settled();
  assert.deepEqual(stuck.state.asked.map((asked) => asked.title), ['Disconnect OneDrive?', 'Disconnect anyway?'], 'one question at a time');
  assert.equal(stuck.state.asked[1].danger, undefined, 'disconnecting can be undone by signing in again');
  assert.deepEqual(stuck.state.calls, [], 'declined: still connected');
  stuck.state.answers.push({ choice: true }, true);
  stuck.nodes.disconnect._fire();
  await settled();
  assert.deepEqual(stuck.state.calls.map(([name]) => name), ['disconnect']);

  const backedOut = cloudCard(model);
  backedOut.nodes.disconnect._fire();
  await settled();
  assert.deepEqual(backedOut.state.calls, [], 'Cancel changes nothing');
});

test('the erase question names cloud backup only while erasing changes it', async () => {
  assert.equal(cloudEraseNote({ ...CLOUD, shown: false }), null);
  assert.equal(cloudEraseNote({ ...CLOUD, host: 'not-connected', account: null }), null);
  for (const host of ['connected', 'needs-sign-in', 'signing-in', 'unavailable']) {
    assert.equal(cloudEraseNote({ ...CLOUD, host }), 'Cloud backup is disconnected too, for every browser profile on this Windows account. Backups already in OneDrive stay there.', host);
  }
  assert.equal(cloudEraseNote({ ...CLOUD, host: 'not-answering', agreed: true }), 'This browser\'s cloud backup settings are erased too. Backups already in OneDrive stay there.');

  const nodes = stubElements();
  const asked = [];
  const view = createDataView(stubDeps({
    elements: () => nodes,
    getCloudEraseNote: () => cloudEraseNote(CLOUD),
    askConfirm: async (options) => { asked.push(options); return false; },
  }));
  view.wire();
  await nodes.btnWipe._fire();
  assert.ok(asked[0].body.endsWith(' Cloud backup is disconnected too, for every browser profile on this Windows account. Backups already in OneDrive stay there.'), asked[0].body);
});

test('the cloud card imports nothing that stores, sends or restores', () => {
  const source = readFileSync(join(ROOT, 'src/js/views/cloud.js'), 'utf8');
  const imported = [...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]);
  assert.deepEqual(imported, ['./data.js'], 'only the shared restore wording');
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
