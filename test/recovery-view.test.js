import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRecoveryView, salvageKb, salvageWhen } from '../src/js/views/recovery.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// -- construction uniqueness and forbidden imports --

test('main constructs Recovery once with no controller or forbidden dependency', () => {
  const main = readFileSync(join(ROOT, 'src/js/main.js'), 'utf8');
  const source = readFileSync(join(ROOT, 'src/js/views/recovery.js'), 'utf8');

  assert.match(main, /const recoveryView = createRecoveryView\(\{/);
  assert.match(main, /recoveryView\.wire\(\)/);
  assert.match(main, /recoveryView\.render\(\)/);
  assert.match(main, /recoveryView\.renderSalvage\(\)/);
  // recovery.js must not import controller, Store, MarvelApi, ResponseCache, Hydrator,
  // SynopsisRunner, or concrete sibling views.
  assert.doesNotMatch(source, /(?:main|storage|api|cache|hydrate|synopsis)\.js/);
  assert.doesNotMatch(source, /views\/(?:home|library|progress|issue|catalog|preview|reading-paths|add|data)\.js/);
  assert.doesNotMatch(source, /new Store|new MarvelApi|new ResponseCache|new RateLimiter|new Hydrator|new SynopsisRunner/);
});

// -- render tracks blockedBannerWasUp --

test('render clears save report when banner transitions from shown to hidden', () => {
  let cleared = false;
  const nodes = recoveryNodes({ saveReport: { replaceChildren() { cleared = true; } } });
  let blocked = true;
  const view = makeView({
    isBlocked: () => blocked,
    elements: () => nodes,
  });
  view.render(); // blocked=true, sets blockedBannerWasUp
  assert.ok(!cleared, 'no clear while banner is up');
  view.render(); // blocked=true again
  assert.ok(!cleared);
  blocked = false;
  view.render(); // blocked=false, wasUp=true -> clear
  assert.ok(cleared, 'save report cleared on transition to unblocked');
});

test('render does not clear save report when banner was never shown', () => {
  let cleared = false;
  const view = makeView({
    isBlocked: () => false,
    elements: () => recoveryNodes({ saveReport: { replaceChildren() { cleared = true; } } }),
  });
  view.render();
  view.render();
  assert.ok(!cleared);
});

test('render withdraws a prior incident download confirmation when recovery resolves', async () => {
  const starts = [];
  const nodes = recoveryNodes();
  let blocked = true;
  const view = makeView({
    elements: () => nodes,
    isBlocked: () => blocked,
    salvagedRaw: () => '{"incident":1}',
    download: () => true,
    askConfirm: async () => true,
    startFresh: (options) => {
      starts.push(options);
      return false;
    },
  });
  view.wire();

  view.render();
  await nodes.btnDownloadSalvage._fire();
  await nodes.btnStartFresh._fire();
  blocked = false;
  view.render();
  blocked = true;
  view.render();
  await nodes.btnStartFresh._fire();

  assert.deepEqual(starts, [
    { verifiedCopyRaw: '{"incident":1}' },
    { verifiedCopyRaw: null },
  ]);
});

// -- renderSalvage reads fresh data --

test('recovery waits for a completed download and never trusts cancellation, different or unrepresentable bytes', async () => {
  for (const outcome of ['saved', 'cancelled', 'changed', 'unrepresentable']) {
    const nodes = recoveryNodes();
    const starts = [];
    let raw = outcome === 'unrepresentable' ? '{"incident":"\ud800"}' : '{"incident":1}';
    let complete;
    const view = makeView({
      elements: () => nodes,
      isBlocked: () => true,
      salvagedRaw: () => raw,
      download: () => new Promise((resolve) => { complete = resolve; }),
      askConfirm: async () => true,
      startFresh: (options) => { starts.push(options); return false; },
    });
    view.wire();
    const downloading = nodes.btnDownloadSalvage._fire();
    await nodes.btnStartFresh._fire();
    assert.equal(starts.at(-1).verifiedCopyRaw, null, 'an open picker is not a saved backup');
    if (outcome === 'changed') raw = '{"incident":2}';
    complete(outcome !== 'cancelled');
    await downloading;
    await nodes.btnStartFresh._fire();
    assert.equal(starts.at(-1).verifiedCopyRaw, outcome === 'saved' ? raw : null, outcome);
    raw = '{"incident":3}';
    await nodes.btnStartFresh._fire();
    assert.equal(starts.at(-1).verifiedCopyRaw, null, 'a previous success never confirms other bytes');
  }
});

test('renderSalvage calls salvageCopies on every invocation', () => {
  let callCount = 0;
  const view = makeView({
    salvageCopies: () => { callCount++; return []; },
  });
  view.renderSalvage();
  view.renderSalvage();
  assert.equal(callCount, 2, 'fresh read on every call, not cached');
});

test('a requested browser download never grants recovery permission or announces saved output', async () => {
  const nodes = recoveryNodes();
  const starts = [];
  const said = [];
  const view = makeView({
    elements: () => nodes,
    isBlocked: () => true,
    salvagedRaw: () => 'original',
    download: () => 'requested',
    announce: (message) => said.push(message),
    askConfirm: async () => true,
    startFresh: (options) => { starts.push(options); return false; },
  });
  view.wire();
  await nodes.btnDownloadSalvage._fire();
  await nodes.btnStartFresh._fire();
  assert.deepEqual(starts, [{ verifiedCopyRaw: null }]);
  assert.deepEqual(said, []);
});

test('file verification grants permission only for exact locally readable incident bytes', async () => {
  for (const outcome of ['exact', 'wrong', 'large', 'invalid-utf8', 'unreadable']) {
    const nodes = recoveryNodes();
    const starts = [];
    const reports = [];
    const bytes = new TextEncoder().encode(outcome === 'wrong' ? 'differen' : 'original');
    const file = {
      size: outcome === 'large' ? 100 : bytes.byteLength,
      arrayBuffer: async () => {
        if (outcome === 'unreadable') throw new Error('Permission denied');
        return outcome === 'invalid-utf8' ? new Uint8Array([0xff]).buffer : bytes.buffer;
      },
    };
    const view = makeView({
      elements: () => nodes,
      isBlocked: () => true,
      salvagedRaw: () => 'original',
      askConfirm: async () => true,
      startFresh: (options) => { starts.push(options); return false; },
      notify: (...args) => reports.push(args),
    });
    view.wire();
    const input = { files: [file], value: 'chosen' };
    await nodes.verifySalvage._fire({ target: input });
    await nodes.btnStartFresh._fire();
    assert.equal(starts.at(-1).verifiedCopyRaw, outcome === 'exact' ? 'original' : null, outcome);
    assert.equal(input.value, '', 'the same file can be selected for another check');
    assert.equal(reports.at(-1)[2], outcome === 'exact' ? 'ok'
      : ['invalid-utf8', 'unreadable'].includes(outcome) ? 'error' : 'warn');
  }
});

test('late file verification cannot confirm changed incidents or replace a newer verification', async () => {
  const nodes = recoveryNodes();
  const starts = [];
  const reports = [];
  let raw = 'original';
  let finish;
  const file = { size: 8, arrayBuffer: () => new Promise((resolve) => { finish = resolve; }) };
  const view = makeView({
    elements: () => nodes,
    isBlocked: () => true,
    salvagedRaw: () => raw,
    askConfirm: async () => true,
    startFresh: (options) => { starts.push(options); return false; },
    notify: (...args) => reports.push(args),
  });
  view.wire();
  const pending = nodes.verifySalvage._fire({ target: { files: [file] } });
  raw = 'incident';
  finish(new TextEncoder().encode('original').buffer);
  await pending;
  await nodes.btnStartFresh._fire();
  assert.equal(starts.at(-1).verifiedCopyRaw, null);
  const old = nodes.verifySalvage._fire({ target: { files: [file] } });
  await nodes.verifySalvage._fire({
    target: { files: [{ size: 8, arrayBuffer: async () => new TextEncoder().encode('incident').buffer }] },
  });
  const reportCount = reports.length;
  finish(new TextEncoder().encode('original').buffer);
  await old;
  assert.equal(reports.length, reportCount, 'obsolete async work does not displace current feedback');
  await nodes.btnStartFresh._fire();
  assert.equal(starts.at(-1).verifiedCopyRaw, 'incident');
});

test('empty recovery inventory makes no claim about previous readability', () => {
  const nodes = recoveryNodes();
  makeView({ elements: () => nodes }).renderSalvage();
  assert.equal(nodes.salvageList.children[0].props.text, 'Nothing is being kept aside.');
});

test('renderSalvage shows null-storage message when copies is null', () => {
  const children = [];
  const view = makeView({
    salvageCopies: () => null,
    elements: () => recoveryNodes({ salvageList: { replaceChildren(...args) { children.push(...args); } } }),
  });
  view.renderSalvage();
  assert.ok(children.length > 0);
  assert.match(children[0]?.props?.text ?? '', /will not let the app list/);
});

// -- stale target refresh --

test('wire refreshes and reports a salvage action whose target is no longer present', async () => {
  const notifications = [];
  const nodes = recoveryNodes();
  let reads = 0;
  const view = makeView({
    elements: () => nodes,
    salvageCopies: () => {
      reads += 1;
      return [];
    },
    notify: (...args) => notifications.push(args),
  });
  view.wire();

  await nodes.salvageList._fire({
    target: { closest: () => ({ dataset: { act: 'download', key: 'gone' } }) },
  });

  assert.equal(reads, 2, 'the action read and the refresh each ask storage again');
  assert.match(notifications[0][1], /no longer there/);
  assert.match(nodes.salvageList.children[0].props.text, /Nothing is being kept aside/);
});

// -- failure behavior --

test('wire start-fresh reports success only when the injected recovery succeeds', async () => {
  const notifications = [];
  const nodes = recoveryNodes();
  let succeeds = false;
  const view = makeView({
    elements: () => nodes,
    askConfirm: async () => true,
    startFresh: () => succeeds,
    notify: (...args) => notifications.push(args),
  });
  view.wire();

  await nodes.btnStartFresh._fire();
  assert.deepEqual(notifications, [], 'the failed recovery reports through Store onChange');
  succeeds = true;
  await nodes.btnStartFresh._fire();
  assert.match(notifications[0][1], /Saving is working again/);
});

test('wire salvage download reports when the current bytes are missing', () => {
  const notifications = [];
  const nodes = recoveryNodes();
  const view = makeView({
    elements: () => nodes,
    notify: (...args) => notifications.push(args),
  });
  view.wire();
  nodes.btnDownloadSalvage._fire();
  assert.match(notifications[0][1], /nothing left to download/i);
});

// -- repeated-offer deduplication --

test('downloadedSalvage state is local to the view instance', () => {
  const src = readFileSync(join(ROOT, 'src/js/views/recovery.js'), 'utf8');
  // downloadedSalvage is declared inside createRecoveryView, not at module scope
  const factoryStart = src.indexOf('export function createRecoveryView');
  const declPos = src.indexOf('let downloadedSalvage', factoryStart);
  assert.ok(declPos > factoryStart, 'downloadedSalvage is scoped inside the factory');
});

// -- salvageKb and salvageWhen helpers --

test('salvageKb converts characters to approximate KB at 2 bytes per char', () => {
  assert.equal(salvageKb(512), 1);
  assert.equal(salvageKb(1024), 2);
  assert.equal(salvageKb(0), 1); // minimum 1 KB
});

test('salvageWhen returns null for null and undefined', () => {
  assert.equal(salvageWhen(null), null);
  assert.equal(salvageWhen(undefined), null);
});

test('salvageWhen formats a timestamp to locale string with seconds', () => {
  const result = salvageWhen(1700000000000);
  assert.ok(typeof result === 'string');
  assert.ok(result.length > 10, 'includes date and time');
});

test('salvageWhen formats epoch zero rather than treating it as absent', () => {
  const result = salvageWhen(0);
  assert.ok(result !== null, '0 is a real timestamp, not absence');
});

// -- helpers --

function element(tag, props = {}, children = []) {
  return { tag, props, children: [].concat(children) };
}

function recoveryNodes(overrides = {}) {
  const listenerNode = () => {
    const listeners = {};
    return {
      addEventListener(name, handler) { listeners[name] = handler; },
      _fire(event) { return listeners[Object.keys(listeners)[0]]?.(event); },
    };
  };
  return {
    banner: { hidden: false, ...(overrides.banner || {}) },
    blockedWhy: { textContent: '', ...(overrides.blockedWhy || {}) },
    saveReport: { replaceChildren() {}, ...(overrides.saveReport || {}) },
    undoRestore: { hidden: false, ...(overrides.undoRestore || {}) },
    btnDownloadSalvage: listenerNode(),
    btnStartFresh: listenerNode(),
    verifySalvage: listenerNode(),
    salvageList: {
      ...listenerNode(),
      replaceChildren(...args) { this.children = args; },
      children: [],
      ...(overrides.salvageList || {}),
    },
  };
}

function makeView(overrides = {}) {
  return createRecoveryView({
    el: element,
    elements: () => recoveryNodes(),
    isBlocked: () => false,
    blockedReason: () => null,
    hasPreRestoreSnapshot: () => false,
    salvagedRaw: () => null,
    salvageCopies: () => [],
    salvageRawAt: () => null,
    forgetSalvage: () => true,
    startFresh: () => true,
    notify: () => {},
    announce: () => {},
    askConfirm: async () => false,
    download: () => true,
    ...overrides,
  });
}
