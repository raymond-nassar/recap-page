import test from 'node:test';
import assert from 'node:assert/strict';
import { deferLifecycle } from '../scripts/browser-defer.mjs';

test('Defer keyboard sequence keeps the retained disclosure open before both actions', async () => {
  let expanded = false;
  let focused = false;
  let narrow = false;
  let opens = 0;
  let presses = 0;
  const keys = [510001, 510002, 510003];
  const state = {
    active: 'copy', read: { 510001: 1 },
    lists: {
      defer: { itemIds: keys, deferredIssueIds: keys.slice(0, 2) },
      other: { deferredIssueIds: [] },
      copy: { itemIds: keys, deferredIssueIds: [510002] },
    },
  };
  const page = {
    __origin: 'http://127.0.0.1:12345',
    async setViewport({ width }) { narrow = width === 320; },
    async evaluateOnNewDocument() {},
    async goto() {},
    async waitForSelector() {},
    async waitForFunction() {},
    async reload() {},
    async $eval(selector, fn) {
      if (narrow && selector.includes('[data-act="more"]')) {
        if (String(fn).includes('aria-expanded')) return expanded;
        expanded = !expanded;
        if (expanded) opens += 1;
        else focused = false;
      }
      return true;
    },
    async evaluate(fn) {
      const body = String(fn);
      if (body.includes('localStorage.getItem')) return JSON.stringify(state);
      return {
        tag: focused ? 'BUTTON' : 'BODY', act: focused ? 'defer' : undefined,
        key: focused ? '510002' : undefined, visible: focused,
        moreExpanded: expanded, panelVisible: expanded,
      };
    },
    async focus() {
      assert.ok(expanded, 'keyboard target must not be hidden by a second More toggle');
      focused = true;
    },
    keyboard: { async press(key) {
      assert.equal(key, 'Enter');
      assert.ok(expanded && focused);
      presses += 1;
      state.lists.copy.deferredIssueIds = presses === 1 ? [] : [510002];
    } },
  };
  const checked = [];
  await deferLifecycle.run(page, { check(label, ok) {
    if (label.startsWith('320px')) {
      assert.ok(ok, label);
      checked.push(label);
    }
  } });
  assert.equal(opens, 1);
  assert.equal(presses, 2);
  assert.equal(checked.filter((label) => label.includes('retains visible')).length, 2);
});
