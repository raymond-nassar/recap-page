import test from 'node:test';
import assert from 'node:assert/strict';
import { createNavigationPosition } from '../src/js/lib/navigationPosition.js';

function harness(initial = null) {
  const entries = [{ state: initial, url: '#/home' }];
  const listeners = new Map();
  const calls = [];
  let resize;
  let timer;
  let frame;
  let disconnected = false;
  const history = {
    scrollRestoration: 'auto',
    get state() { return entries.at(-1).state; },
    replaceState(state, _title, url) { entries[entries.length - 1] = { state, url }; },
    pushState(state, _title, url) { entries.push({ state, url }); },
  };
  const window = {
    scrollX: 0, scrollY: 680, location: { href: '#/home' },
    scrollTo(options) { calls.push(options); },
    requestAnimationFrame(fn) { frame = fn; return 1; },
    cancelAnimationFrame() { frame = null; },
    setTimeout(fn) { timer = fn; return 1; },
    clearTimeout() { timer = null; },
    ResizeObserver: class {
      constructor(fn) { resize = fn; }
      observe() {}
      disconnect() { disconnected = true; }
    },
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name) { listeners.delete(name); },
  };
  const navigation = createNavigationPosition({ window, document: { body: {} }, history });
  return {
    navigation, history, window, entries, calls, listeners,
    resize: () => resize(), timer: () => timer(), frame: () => frame(),
    disconnected: () => disconnected,
  };
}

test('capture and passive replacement preserve both opener identities without saved-data writes', () => {
  const issueFocusOpener = { issueId: 7, surface: 'full-order' };
  const pathStopOpener = { pathId: 'modern', catalogId: 'next' };
  const h = harness({ issueFocusOpener, pathStopOpener });
  h.navigation.capture();
  h.navigation.replace('#/catalog?path=modern');
  assert.deepEqual(h.history.state, {
    issueFocusOpener, pathStopOpener, readingPosition: { depth: 0, x: 0, y: 680 },
  });
  assert.equal(h.entries.length, 1);
  assert.equal(h.history.scrollRestoration, 'manual');
});

test('new destinations get their own position and Back depth, never an old opener', () => {
  const h = harness({ issueFocusOpener: { issueId: 7 } });
  h.navigation.capture();
  h.navigation.push('#/read/next');
  assert.equal(h.entries.length, 2);
  assert.equal(h.entries[0].state.readingPosition.y, 680);
  assert.deepEqual(h.history.state, { readingPosition: { depth: 1, x: 0, y: 0 } });
  assert.equal(h.navigation.canGoBack, true);
});

test('Back restores the entry position again as asynchronous content grows and ignores transient scroll', () => {
  const h = harness({ readingPosition: { depth: 2, x: 12, y: 850 } });
  h.navigation.beginRestore();
  h.navigation.capture();
  assert.equal(h.history.state.readingPosition.y, 850);
  h.navigation.restore();
  h.resize();
  h.frame();
  assert.equal(h.calls.length, 3);
  assert.ok(h.calls.every((call) => call.left === 12 && call.top === 850 && call.behavior === 'instant'));
  h.timer();
  assert.equal(h.navigation.restoring, false);
  assert.equal(h.disconnected(), true);
  assert.equal(h.listeners.size, 0);
  const calls = h.calls.length;
  h.resize();
  assert.equal(h.calls.length, calls);
});

test('reader input cancels delayed restoration before later layout changes can move them', () => {
  const h = harness({ readingPosition: { depth: 1, x: 0, y: 900 } });
  h.navigation.restore();
  h.listeners.get('touchstart')();
  assert.equal(h.navigation.restoring, false);
  assert.equal(h.disconnected(), true);
  assert.equal(h.listeners.size, 0);
  h.window.scrollY = 200;
  h.navigation.capture();
  assert.equal(h.history.state.readingPosition.y, 200);
});

test('an old or malformed history entry starts safely at the top without claiming Back', () => {
  const h = harness({ readingPosition: { depth: -1, x: 'bad', y: -7 } });
  h.navigation.restore();
  assert.deepEqual(h.calls[0], { left: 0, top: 0, behavior: 'instant' });
  assert.equal(h.navigation.canGoBack, false);
  h.navigation.cancel();
});
