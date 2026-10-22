import test from 'node:test';
import assert from 'node:assert/strict';

import { createFeedback } from '../src/js/views/shared/feedback.js';

function fixture({ live = false } = {}) {
  const scheduled = [];
  const announcer = { textContent: '' };
  const pane = {
    classList: { contains: () => false },
    attributes: live ? { 'aria-live': 'polite' } : {},
    children: [],
    parentElement: null,
    getAttribute(name) { return this.attributes[name] ?? null; },
    replaceChildren(...children) { this.children = children; },
  };
  const document = {
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
    querySelectorAll: () => [],
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
    flush: () => { for (const fn of scheduled.splice(0)) fn(); },
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
