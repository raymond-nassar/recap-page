import test from 'node:test';
import assert from 'node:assert/strict';
import { libraryRatingsFailures } from '../scripts/browser-library-ratings.mjs';

async function fixture(failAt, snapshot = 'ready') {
  const primary = Object.assign(new Error('PRIVATE_PRIMARY'), { name: 'TimeoutError' });
  const output = [];
  let malformed = false;
  let mode = 'pass';
  let gotos = 0;
  const page = {
    __origin: 'http://127.0.0.1:12345',
    on() {},
    async setViewport() {},
    async evaluateOnNewDocument() {},
    async goto(url) {
      gotos += 1;
      if (malformed && ((failAt === 'malformed-blank' && url === 'about:blank')
        || (failAt === 'malformed-library' && url.endsWith('/#/library')))) throw primary;
    },
    async evaluate(fn, value) {
      const body = String(fn);
      if (body.includes('model.createList')) return { character: 'Fixture', associated: [1], total: 1 };
      if (body.includes("sessionStorage.setItem('ratedMode'")) {
        mode = value;
        malformed = value === 'malformed';
        return;
      }
      if (malformed && body.includes("location.hash = '#/library-rated'")) {
        if (failAt === 'malformed-navigation') throw primary;
        return;
      }
      if (malformed && body.includes('requests:')) {
        if (snapshot === 'reject') throw new Error('PRIVATE_SNAPSHOT');
        if (snapshot === 'pending') return new Promise(() => {});
        return {
          mode: 'PRIVATE_MODE', requests: -7, ratedVisible: true,
          libraryVisible: false, retry: false,
        };
      }
      return true;
    },
    async $eval(selector) {
      if (selector === '#library-rated-count') return '1 rated comic. This count reflects rating and title matches only.';
      return true;
    },
    async $$eval() { return [1]; },
    async waitForSelector() {
      if (malformed) throw primary;
    },
    async waitForFunction() {},
  };
  const original = console.log;
  console.log = (...args) => output.push(args.join(' '));
  try {
    await assert.rejects(libraryRatingsFailures.run(page, { check() {} }), (error) => error === primary);
  } finally {
    console.log = original;
  }
  return { output: output.join('\n'), gotos, mode };
}

test('ratings evidence identifies each malformed operation without leaking private values', async () => {
  for (const stage of ['malformed-blank', 'malformed-library', 'malformed-navigation', 'malformed-notice']) {
    const result = await fixture(stage);
    assert.match(result.output, new RegExp(`RATINGS-FAIL .*"stage":"${stage}".*"code":"TimeoutError"`));
    assert.match(result.output, /RATINGS-STATE .*"mode":"unknown".*"requests":"unknown"/);
    assert.doesNotMatch(result.output, /PRIVATE_|127\.0\.0\.1|Fixture/);
    assert.equal(result.mode, 'malformed');
  }
});

test('ratings observation rejects or times out without replacing the scenario failure', async () => {
  for (const [snapshot, code] of [['reject', 'Error'], ['pending', 'observation-timeout']]) {
    const before = performance.now();
    const result = await fixture('malformed-notice', snapshot);
    assert.match(result.output, new RegExp(`RATINGS-OBSERVATION .*"code":"${code}"`));
    assert.match(result.output, /RATINGS-FAIL .*"code":"TimeoutError"/);
    assert.doesNotMatch(result.output, /PRIVATE_/);
    assert.ok(performance.now() - before < 3000, 'observation has a bounded budget');
  }
});
