import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../scripts/browser-check.mjs', import.meta.url), 'utf8');
const start = source.indexOf('function tally()');
const end = source.indexOf('\nasync function seedRemovalFixture(', start);
const entry = source.lastIndexOf('\nmain().catch(');
assert.ok(start > 0 && end > start && entry > end, 'browser runner boundaries exist');

function fixture(failAt) {
  // Run the actual lifecycle and command entry, not a second implementation of its reporter.
  const script = `
    import assert from 'node:assert/strict';
    import { EventEmitter } from 'node:events';
    import { constants } from 'node:os';
    import { dirname, join } from 'node:path';
    const failAt = ${JSON.stringify(failAt)};
    const secret = 'PRIVATE_PROFILE https://private.invalid/ PRIVATE_STDERR';
    const failure = (name) => Object.assign(new Error(secret), { name });
    const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null });
    let contexts = 0;
    let closed = 0;
    let prepared = 0;
    const events = [];
    const browser = Object.assign(new EventEmitter(), {
      connected: true,
      process: () => child,
      version: async () => failAt === 1 ? secret : 'HeadlessChrome/140.0.7339.0',
      createBrowserContext: async () => {
        contexts += 1;
        // This also proves the scenario/stage was written before the rejecting call.
        console.log('FIXTURE create-context=' + contexts);
        if (contexts === failAt) {
          browser.connected = false;
          if (failAt === 2) {
            child.exitCode = 37;
            child.emit('exit', 37, null);
          }
          browser.emit('disconnected');
          throw failure('TargetCloseError');
        }
        events.push('context-' + contexts);
        return {
          newPage: async () => { events.push('page-' + contexts); return {}; },
          close: async () => { closed += 1; events.push('close-' + contexts); },
        };
      },
      close: async () => {
        assert.equal(closed, contexts - (failAt ? 1 : 0));
        assert.equal(prepared, closed);
        console.log('FIXTURE browser-cleanup');
        if (failAt) throw failure('ProtocolError');
        child.exitCode = 0;
        child.emit('exit', 0, null);
        browser.emit('disconnected');
      },
    });
    globalThis.fixtureDriver = { launch: async () => browser };
    const resolveDriver = () => secret;
    const resolveEdge = () => secret;
    const existsSync = () => true;
    const readFileSync = () => JSON.stringify({
      name: 'puppeteer-core', version: failAt === 1 ? secret : '24.31.0',
    });
    const pathToFileURL = () => ({
      href: 'data:text/javascript,export default globalThis.fixtureDriver',
    });
    const prerequisiteFailure = () => { throw failure('UnexpectedPrerequisite'); };
    const HOST = '127.0.0.1';
    const DEFAULT_PORT = 8787;
    const createStaticServer = () => ({
      listen: (_port, _host, ready) => ready(),
      address: () => ({ port: 12345 }),
      closeAllConnections: () => console.log('FIXTURE connections-cleanup'),
      close: (done) => {
        console.log('FIXTURE server-cleanup');
        console.log('FIXTURE events=' + events.join(','));
        done(failAt ? failure(secret) : undefined);
      },
    });
    const preparePage = async (page) => {
      assert.equal(page.__denyExternal, true);
      prepared += 1;
      events.push('prepare-' + contexts);
    };
    const SCENARIOS = ['first', 'second'].map((id) => ({
      id, title: 'Fixture ' + id,
      run: async (_page, t) => {
        events.push('run-' + id);
        t.check(id + ' assertion', true);
      },
    }));
    const MUTATIONS = [];
    ${source.slice(start, end)}
    ${source.slice(entry)}
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  const output = result.stdout + result.stderr;
  assert.match(output, /FIXTURE browser-cleanup/);
  assert.match(output, /FIXTURE connections-cleanup/);
  assert.match(output, /FIXTURE server-cleanup/);
  return { ...result, output };
}

test('browser reporting retains completed evidence and primary context failure with exit 1', () => {
  for (const failAt of [2, 1]) {
    const result = fixture(failAt);
    assert.equal(result.status, 1, result.output);
    const id = failAt === 2 ? 'second' : 'first';
    const announced = result.stdout.indexOf('SCENARIO id=' + id + ' stage=create-context');
    assert.ok(announced >= 0 && announced < result.stdout.indexOf('FIXTURE create-context=' + failAt));
    const primary = result.stdout.indexOf('FAIL scenario=' + id + ' stage=create-context code=TargetCloseError');
    assert.ok(primary >= 0 && primary < result.stdout.indexOf('FIXTURE browser-cleanup'));
    assert.match(result.stdout, new RegExp('FAIL ' + id + ' ran to the end\\s+stage=create-context code=TargetCloseError'));
    assert.match(result.stdout, new RegExp((failAt - 1) + ' assertion\\(s\\) passed, 1 failed'));
    assert.match(result.stdout, new RegExp('SCENARIOS completed=' + (failAt - 1)
      + ' planned=2 last-completed=' + (failAt === 2 ? 'first' : 'none')));
    assert.doesNotMatch(result.output, /PRIVATE_|private\.invalid|Error:|file:\/\/|data:text/);
    assert.match(result.stderr, /FAIL stage=close-browser code=ProtocolError/);
    assert.match(result.stderr, /FAIL stage=close-server code=unknown/);
    if (failAt === 2) {
      const firstResult = result.stdout.indexOf('ok   first assertion');
      assert.ok(firstResult >= 0 && firstResult < announced);
      assert.match(result.stdout, /BROWSER stage=failure cleanup=false browser=HeadlessChrome\/140\.0\.7339\.0 driver=24\.31\.0 exit=37 signal=unknown/);
    } else {
      assert.doesNotMatch(result.stdout, /SCENARIO id=second/);
      assert.match(result.stdout, /BROWSER stage=failure cleanup=false browser=unknown driver=unknown exit=unknown signal=unknown/);
    }
  }
});

test('browser reporting preserves successful scenario order, totals and isolated cleanup', () => {
  const result = fixture(null);
  assert.equal(result.status, 0, result.output);
  assert.equal(result.stderr, '');
  assert.doesNotMatch(result.output, /PRIVATE_|private\.invalid|Error:|file:\/\/|data:text/);
  assert.match(result.stdout, /2 assertion\(s\) passed, 0 failed, across 2 scenario\(s\)/);
  assert.match(result.stdout, /SCENARIOS completed=2 planned=2 last-completed=second/);
  assert.match(result.stdout, /FIXTURE events=context-1,page-1,prepare-1,run-first,close-1,context-2,page-2,prepare-2,run-second,close-2/);
  assert.match(result.stdout, /BROWSER stage=process-exit cleanup=true browser=HeadlessChrome\/140\.0\.7339\.0 driver=24\.31\.0 exit=0 signal=unknown/);
  assert.doesNotMatch(result.stdout, /stage=failure|stage=failed/);
});
