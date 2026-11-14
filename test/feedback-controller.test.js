import test from 'node:test';
import assert from 'node:assert/strict';

import { createFeedback, watchNoticeOverflow } from '../src/js/views/shared/feedback.js';

function fixture({ live = false } = {}) {
  const scheduled = [];
  const announcer = { textContent: '' };
  let modal = null;
  const observers = [];
  const pane = {
    classList: { contains: () => false },
    attributes: live ? { 'aria-live': 'polite' } : {},
    children: [],
    parentElement: null,
    getAttribute(name) { return this.attributes[name] ?? null; },
    replaceChildren(...children) { this.children = children; },
  };
  const document = {
    defaultView: {
      MutationObserver: class {
        constructor(callback) { this.callback = callback; this.records = []; observers.push(this); }
        observe(node) { this.node = node; }
        takeRecords() { return this.records.splice(0); }
      },
    },
    activeElement: { closest: () => modal },
    createElement(tag) {
      return {
        tag,
        className: '',
        textContent: '',
        children: [],
        handlers: {},
        setAttribute(name, value) { this[name] = value; },
        addEventListener(name, handler) { this.handlers[name] = handler; },
        append(child) { this.children.push(child); },
      };
    },
    createTextNode: (text) => ({ text }),
    querySelector(selector) {
      if (selector === '#announcer') return announcer;
      if (selector === '#save-report' || selector === '#report') return pane;
      return null;
    },
    querySelectorAll: (selector) => selector === 'dialog[open]' && modal ? [modal] : [],
  };
  const createElement = (tag, props = {}, children = []) => {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
      if (key === 'class') node.className = value;
      else if (key === 'text') node.textContent = value;
      else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
      else node.setAttribute(key, value === true ? '' : String(value));
    }
    for (const child of [].concat(children)) {
      if (child != null) node.append(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return node;
  };
  const feedback = createFeedback({
    query: (selector) => document.querySelector(selector),
    getDocument: () => document,
    el: createElement,
    schedule: (fn) => scheduled.push(fn),
    focusViewHeading: () => {},
    getCurrentView: () => 'read',
  });
  return {
    announcer,
    feedback,
    pane,
    open(dialog = null) {
      modal = dialog ?? {
        children: [],
        append(node) { this.children.push(node); },
        contains(node) { return node.parentElement === this; },
      };
      return modal;
    },
    close() {
      for (const observer of observers.filter((entry) => entry.node === modal)) observer.records.push({ oldValue: '' });
      modal = null;
    },
    flush: () => {
      for (const observer of observers) {
        const records = observer.takeRecords();
        if (records.length) observer.callback(records);
      }
      for (const fn of scheduled.splice(0)) fn();
    },
  };
}

test('feedback instances keep notice records and clearing independent', () => {
  const first = fixture();
  const second = fixture();
  first.feedback.notify('#save-report', 'First failure.', 'error', 'shared');
  second.feedback.notify('#save-report', 'Second failure.', 'error', 'shared');

  first.feedback.clearNotice('shared');

  assert.equal(first.feedback.fixedNotices.has('shared'), false);
  assert.equal(second.feedback.fixedNotices.get('shared').msg, 'Second failure.');
  assert.equal(first.pane.children.length, 0);
  assert.equal(second.pane.children.length, 1);
});

test('a modal gets one local live region and joined speech, not the inert page announcer', () => {
  const h = fixture();
  const dialog = h.open();
  h.feedback.announce('Gap notes.');
  h.feedback.announce('Already-read comics stay read.');
  h.flush();
  assert.equal(dialog.children.length, 1);
  const region = dialog.children[0];
  assert.equal(region.role, 'status');
  assert.equal(region['aria-live'], 'polite');
  assert.equal(region.textContent, 'Gap notes. Already-read comics stay read.');
  assert.equal(h.announcer.textContent, '');
});

test('closing and reopening the same modal discards pending speech but accepts a new utterance', () => {
  const h = fixture();
  const dialog = h.open();
  h.feedback.announce('Stale save note.');
  h.close();
  h.open(dialog);
  h.flush();
  assert.equal(dialog.children[0].textContent, '');
  h.feedback.announce('New question.');
  h.flush();
  assert.equal(dialog.children[0].textContent, 'New question.');
  h.close();
  h.feedback.announce('Back on the page.');
  h.flush();
  assert.equal(h.announcer.textContent, 'Back on the page.');
  assert.equal(dialog.children[0].textContent, '');
});

test('a closed modal never redirects its queued speech to the page', () => {
  const h = fixture();
  const dialog = h.open();
  h.feedback.announce('Cancelled operation.');
  h.close();
  h.flush();
  assert.equal(dialog.children[0].textContent, '');
  assert.equal(h.announcer.textContent, '');
});

test('a modal notice already in a live pane stays in its own channel', () => {
  const h = fixture({ live: true });
  const dialog = h.open();
  h.pane.parentElement = dialog;
  h.feedback.notify('#report', 'Saved.', 'ok');
  h.flush();
  assert.equal(dialog.children.length, 0);
  assert.equal(h.announcer.textContent, '');
});

test('a live pane behind a modal falls back to the modal channel', () => {
  const h = fixture({ live: true });
  const dialog = h.open();
  h.feedback.notify('#save-report', 'Save failed.', 'error');
  h.flush();
  assert.equal(dialog.children[0].textContent, 'Save failed.');
  assert.equal(h.announcer.textContent, '');
});

test('feedback speaks a non-live notice once and leaves a live notice in its own channel', () => {
  const visible = fixture();
  visible.feedback.notify('#report', 'Saved.', 'ok');
  assert.equal(visible.announcer.textContent, '');
  visible.flush();
  assert.equal(visible.announcer.textContent, 'Saved.');

  const live = fixture({ live: true });
  live.feedback.notify('#report', 'Saved.', 'ok');
  live.flush();
  assert.equal(live.announcer.textContent, '');
  assert.equal(live.pane.children.length, 1);
});

test('the app controller can be imported before a document exists', async () => {
  assert.equal(globalThis.document, undefined);
  const { boot } = await import('../src/js/main.js');
  assert.equal(typeof boot, 'function');
});

test('notice scrolling is focusable only while content overflows and stops observing removed messages', () => {
  const attributes = new Map();
  const message = {
    nodeType: 1, isConnected: true, clientWidth: 100, scrollWidth: 100, clientHeight: 40, scrollHeight: 40,
    matches: () => true,
    querySelectorAll: () => [],
    closest() { return this; },
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name),
    toggleAttribute(name, on) { if (on) attributes.set(name, ''); else attributes.delete(name); },
  };
  const body = {
    nodeType: 1, matches: () => false, querySelectorAll: () => [message], closest: () => null,
  };
  let resize;
  let mutate;
  const observed = [];
  const unobserved = [];
  class ResizeObserver {
    constructor(callback) { resize = callback; }
    observe(target) { observed.push(target); }
    unobserve(target) { unobserved.push(target); }
  }
  class MutationObserver {
    constructor(callback) { mutate = callback; }
    observe() {}
  }
  watchNoticeOverflow({ body, defaultView: { ResizeObserver, MutationObserver } });
  assert.deepEqual(observed, [message]);
  assert.equal(attributes.has('tabindex'), false);

  message.scrollWidth = 200;
  mutate([{ target: message, addedNodes: [] }]);
  assert.equal(attributes.get('tabindex'), '0');
  assert.equal(attributes.has('data-horizontal-scroll'), true);

  message.scrollWidth = 100;
  message.scrollHeight = 80;
  resize([{ target: message }]);
  assert.equal(attributes.get('tabindex'), '0');
  assert.equal(attributes.has('data-horizontal-scroll'), false);

  message.scrollHeight = 40;
  resize([{ target: message }]);
  assert.equal(attributes.has('tabindex'), false);

  message.isConnected = false;
  mutate([{ target: body, addedNodes: [] }]);
  assert.deepEqual(unobserved, [message]);
});
