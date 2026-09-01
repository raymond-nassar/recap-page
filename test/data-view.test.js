import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createDataView, eraseDialogBody, eraseOutcome } from '../src/js/views/data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// -- pure exports importable from data.js --

test('eraseDialogBody and eraseOutcome are importable from the data view module', () => {
  assert.equal(typeof eraseDialogBody, 'function');
  assert.equal(typeof eraseOutcome, 'function');
  assert.match(eraseDialogBody([]), /clears every list/);
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
  assert.doesNotMatch(source, /views\/(?:home|library|progress|issue|catalog|preview|reading-paths|add)\.js/);
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
    onSetUpdateChecks: () => {},
    onSetTheme: () => {},
    onRunUpdateCheck: () => {},
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

test('wire delegates erase confirmation to onErase via askConfirm', async () => {
  const calls = [];
  let confirmCalled = false;
  const nodes = stubElements();
  const view = createDataView(stubDeps({
    elements: () => nodes,
    askConfirm: async (opts) => { confirmCalled = true; assert.match(opts.body, /clears every list/); return true; },
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
  assert.equal(notifications[0].msg, 'too big');
  assert.equal(notifications[0].kind, 'error');
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

// -- helpers --

function stubNode(overrides = {}) {
  const listeners = {};
  return {
    hidden: false,
    disabled: false,
    textContent: '',
    value: '',
    checked: false,
    addEventListener(name, fn) { listeners[name] = fn; },
    _fire(arg) { return listeners[Object.keys(listeners)[0]]?.(arg); },
    ...overrides,
  };
}

function stubElements() {
  return {
    apiBase: stubNode(),
    optCovers: stubNode(),
    optUpdateChecks: stubNode(),
    optTheme: stubNode(),
    btnCheckUpdates: stubNode(),
    btnCheckLocalConnection: stubNode(),
    btnExportJson: stubNode(),
    btnExportMd: stubNode(),
    restoreFile: stubNode(),
    undoRestore: stubNode(),
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
    onSetUpdateChecks: () => {},
    onSetTheme: () => {},
    onRunUpdateCheck: () => {},
    onCheckLocalConnection: () => {},
    onApiBaseSubmit: () => {},
    onClearCache: async () => {},
    onErase: () => {},
    ...overrides,
  };
}
