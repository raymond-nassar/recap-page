import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { shouldRevealMobileNavigation } from '../src/js/lib/mobileNavigation.js';

const viewport = (changes = {}) => ({
  size: '375,667,1', offset: '0,0', zoomed: false, scrollY: 200, ...changes,
});

function navigation() {
  const source = readFileSync(new URL('../src/js/main.js', import.meta.url), 'utf8');
  const start = source.indexOf('function wireMobileNavigation() {');
  const end = source.indexOf('\nlet tooltips;', start);
  assert.ok(start >= 0 && end > start);
  const classes = new Set();
  const header = {
    children: [], clientWidth: 375, contains: () => false, querySelectorAll: () => [],
    getBoundingClientRect: () => ({ height: 48 }),
    classList: {
      add: (name) => classes.add(name), remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
      toggle(name, on) { if (on) classes.add(name); else classes.delete(name); },
    },
  };
  const listeners = new Map();
  const viewportListeners = new Map();
  const frames = [];
  const window = {
    scrollY: 200, innerHeight: 667,
    addEventListener: (name, callback) => listeners.set(name, callback),
    visualViewport: {
      width: 375, height: 667, scale: 1, offsetLeft: 0, offsetTop: 0,
      addEventListener: (name, callback) => viewportListeners.set(name, callback),
    },
  };
  runInNewContext(`let revealMobileNavigation; ${source.slice(start, end)}; wireMobileNavigation();`, {
    window, shouldRevealMobileNavigation, isNarrow: true, narrowOpen: false,
    document: {
      activeElement: null, querySelector: () => header, addEventListener() {},
      documentElement: { style: { setProperty() {} } },
    },
    $: () => ({ contains: () => false }),
    getComputedStyle: () => ({ columnGap: '0', paddingLeft: '0', paddingRight: '0' }),
    ResizeObserver: class { observe() {} },
    requestAnimationFrame: (callback) => frames.push(callback),
  });
  return {
    window,
    hidden: () => classes.has('mobile-nav-hidden'),
    scroll() {
      listeners.get('scroll')();
      while (frames.length) frames.shift()();
    },
    viewportScroll: () => viewportListeners.get('scroll')(),
  };
}

for (const order of ['window first', 'visualViewport first']) {
  test(`document scrolling reveals navigation with ${order}`, () => {
    const nav = navigation();
    nav.window.scrollY = 460;
    if (order === 'window first') {
      nav.scroll();
      assert.equal(nav.hidden(), true);
      nav.viewportScroll();
    } else {
      nav.viewportScroll();
      nav.scroll();
    }
    assert.equal(nav.hidden(), false);
    nav.window.scrollY = 500;
    nav.scroll();
    assert.equal(nav.hidden(), true);
    nav.viewportScroll();
    assert.equal(nav.hidden(), false);
  });
}

test('unchanged document position and unzoomed viewport settling do not reveal navigation', () => {
  assert.equal(shouldRevealMobileNavigation(viewport(), viewport()), false);
  assert.equal(shouldRevealMobileNavigation(viewport(), viewport({ offset: '0,12' })), false);
});

test('viewport dimensions and scale changes still reveal navigation', () => {
  for (const size of ['375,333,1', '667,375,1', '375,667,2']) {
    assert.equal(shouldRevealMobileNavigation(viewport(), viewport({ size })), true, size);
  }
});

test('zoomed panning reveals navigation, but an unchanged zoomed viewport does not', () => {
  const previous = viewport({ size: '187.5,333.5,2', zoomed: true });
  assert.equal(shouldRevealMobileNavigation(previous, { ...previous, offset: '0,12' }), true);
  assert.equal(shouldRevealMobileNavigation(previous, { ...previous }), false);
});

test('missing viewport snapshots cannot reveal navigation', () => {
  assert.equal(shouldRevealMobileNavigation(null, viewport()), false);
  assert.equal(shouldRevealMobileNavigation(viewport(), null), false);
});
