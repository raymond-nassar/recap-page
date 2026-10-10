import test from 'node:test';
import assert from 'node:assert/strict';
import { completionLifecycle } from '../scripts/browser-completion.mjs';

function fixture({ failWait = false } = {}) {
  const stop = new Error('scenario boundary');
  const primary = Object.assign(new Error('PRIVATE_FAILURE'), { name: 'TimeoutError' });
  let clicks = 0;
  let finalRating = false;
  let waiting = false;
  let navigated = false;
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  const reader = JSON.stringify({
    read: { 610001: 111 },
    lists: { 'completion-source-list': { deferredIssueIds: [610003], note: 'Keep this private note' } },
  });
  const page = {
    __origin: 'http://127.0.0.1:12345',
    url: () => 'PRIVATE_ROUTE',
    on() {},
    async setViewport() {},
    async evaluateOnNewDocument() {},
    async goto() {},
    async reload() {},
    async hover() {},
    async focus() {},
    keyboard: { async press() {} },
    async evaluate(fn, value) {
      const body = String(fn);
      if (body.includes('localStorage.getItem')) {
        return value === 'mrt.state.v2' ? reader : JSON.stringify({ records: [{ rating: 'down' }] });
      }
      if (body.includes('window.__listFeedbackActivation')) return {};
      if (body.includes("href: document.querySelector('#list-feedback-link')")) return {};
      if (value === '#/completed' || body.includes("location.hash = '#/completed'")) {
        navigated = true;
        return;
      }
      return true;
    },
    async $eval(selector, fn) {
      if (selector === '#btn-enjoyed-list' && String(fn).includes('element.click()')) {
        clicks += 1;
        if (clicks === 2) finalRating = true;
      }
      return true;
    },
    async $$eval() { return []; },
    async waitForFunction(fn) {
      const body = String(fn);
      if (finalRating && body.includes('#btn-enjoyed-list') && body.includes('disabled')) {
        waiting = true;
        if (failWait) throw primary;
        await pending;
      }
    },
    async waitForSelector(selector) {
      if (selector === '#view-completed:not([hidden])') throw stop;
    },
  };
  return {
    page, release, stop, primary,
    snapshot: () => ({ finalRating, waiting, navigated }),
  };
}

test('completion waits for the final enjoyment save before Completed navigation', { timeout: 2000 }, async () => {
  const f = fixture();
  let settled = false;
  const result = completionLifecycle.run(f.page, { check() {} }).catch((error) => error)
    .finally(() => { settled = true; });
  while (!f.snapshot().finalRating && !settled) await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(f.snapshot(), { finalRating: true, waiting: true, navigated: false });
  f.release();
  assert.equal(await result, f.stop);
  assert.equal(f.snapshot().navigated, true);
});

test('completion fixed-operation evidence retains the original failed save wait', async () => {
  const f = fixture({ failWait: true });
  const output = [];
  const log = console.log;
  console.log = (...args) => output.push(args.join(' '));
  try {
    await assert.rejects(completionLifecycle.run(f.page, { check() {} }), (error) => error === f.primary);
  } finally {
    console.log = log;
  }
  assert.match(output.join('\n'), /COMPLETION-FAIL .*"stage":"saved-rating".*"code":"TimeoutError"/);
  assert.doesNotMatch(output.join('\n'), /PRIVATE_|127\.0\.0\.1/);
  assert.equal(f.snapshot().navigated, false);
});
