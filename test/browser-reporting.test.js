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

function diagnosticFixture(fault = '', args = ['--diagnostic=context-export-isolation']) {
  const lock = new URL('../.github/browser-proof/package-lock.json', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { EventEmitter } from 'node:events';
    import { readFileSync as realReadFileSync } from 'node:fs';
    import { constants, tmpdir } from 'node:os';
    import { dirname, join } from 'node:path';
    process.argv = ['node', 'browser-check.mjs', ...process.argv.slice(1)];
    const fault = ${JSON.stringify(fault)};
    const secret = 'PRIVATE_PROFILE https://private.invalid/ PRIVATE_STDERR';
    const failure = () => Object.assign(new Error(secret), { name: 'TargetCloseError' });
    process.env.GITHUB_SHA = 'a'.repeat(40);
    process.env.GITHUB_WORKFLOW_SHA = fault === 'source' ? 'b'.repeat(40) : process.env.GITHUB_SHA;
    process.env.GITHUB_RUN_ID = '123';
    process.env.GITHUB_RUN_ATTEMPT = '1';
    if (fault === 'headed') process.env.MRT_HEADED = '1';
    else delete process.env.MRT_HEADED;
    let launches = 0;
    let created = 0;
    let pages = 0;
    let closes = 0;
    let prepared = 0;
    let readerRuns = 0;
    const events = [];
    const readFileSync = (path) => String(path).endsWith('package-lock.json')
      ? (fault === 'lock' ? 'wrong-lock' : realReadFileSync(new URL(${JSON.stringify(lock)})))
      : JSON.stringify({ name: 'puppeteer-core', version: fault === 'driver' ? 'unknown' : '25.7.0' });
    const existsSync = () => true;
    const resolveDriver = () => secret;
    const resolveEdge = () => secret;
    const pathToFileURL = () => ({ href: 'data:text/javascript,export default globalThis.fixtureDriver' });
    const prerequisiteFailure = () => { throw failure(); };
    const HOST = '127.0.0.1';
    const DEFAULT_PORT = 8787;
    const createStaticServer = () => ({
      listen: (_port, _host, ready) => ready(),
      address: () => ({ port: 12345 }),
      closeAllConnections: () => events.push('connections-close-' + launches),
      close: (done) => { events.push('server-close-' + launches); done(); },
    });
    const fetch = async (url, options) => {
      assert.equal(url.pathname, '/json/protocol');
      assert.equal(url.hostname, '127.0.0.1');
      assert.equal(options.redirect, 'error');
      return { ok: true, json: async () => ({ domains: [{
        domain: 'Page', commands: [{ name: 'enable' }],
        events: fault === 'capability' ? [] : [
          { name: 'downloadWillBegin', parameters: [{ name: 'guid', type: 'string' }] },
          { name: 'downloadProgress', parameters: [
            { name: 'guid', type: 'string' },
            { name: 'state', enum: ['inProgress', 'completed', 'canceled'] },
          ] },
        ],
      }] }) };
    };
    const preparePage = async (page) => {
      prepared += 1;
      assert.equal(page.__denyExternal, true);
      await page.setViewport({ width: 1280, height: 900 });
      events.push('prepare-reader');
    };
    const SCENARIOS = [{
      id: 'reader-round-trip', title: 'existing reader fixture',
      async run(page, t) {
        readerRuns += 1;
        events.push('reader-run');
        if (fault !== 'no-events') {
          page.session.emit('Page.downloadWillBegin', {
            guid: secret, url: secret, suggestedFilename: secret,
          });
          page.session.emit('Page.downloadProgress', {
            guid: secret, state: 'inProgress', receivedBytes: 12, totalBytes: 12,
          });
          if (!['pending', 'late-terminal'].includes(fault)) {
            page.session.emit('Page.downloadProgress', {
              guid: secret, state: fault === 'canceled' ? 'canceled' : 'completed', filePath: secret,
            });
          }
        }
        for (let index = 0; index < 9; index += 1) {
          t.check('reader check ' + index, fault !== 'assertion' || index !== 4);
        }
      },
    }];
    const MUTATIONS = [];
    globalThis.fixtureDriver = { launch: async (options) => {
      const arm = ++launches;
      events.push('launch-' + arm);
      assert.equal(options.headless, true);
      assert.equal(options.pipe, undefined);
      assert.equal(options.userDataDir, undefined);
      assert.equal(options.downloadBehavior, undefined);
      assert.deepEqual(options.args, ['--no-first-run', '--no-default-browser-check']);
      const child = Object.assign(new EventEmitter(), {
        exitCode: null, signalCode: null,
        spawnargs: ['PRIVATE_EXECUTABLE', '--headless=new', '--remote-debugging-port=0',
          '--user-data-dir=' + join(tmpdir(), 'PRIVATE_PROFILE-' + (fault === 'reuse-profile' ? 1 : arm))],
      });
      if (fault === 'pipe') child.spawnargs.push('--remote-debugging-pipe');
      let armContexts = 0;
      const browser = Object.assign(new EventEmitter(), {
        connected: true,
        process: () => child,
        version: async () => fault === 'browser' ? 'unknown' : 'Edg/152.0.4191.66',
        wsEndpoint: () => 'ws://127.0.0.1:12345/devtools/browser/PRIVATE_TOKEN',
        createBrowserContext: async () => {
          created += 1;
          const ordinal = ++armContexts;
          events.push('create-' + arm + '-' + ordinal);
          if ((fault === 'control-sentinel' && arm === 1 && ordinal === 2)
            || (fault === 'reader-sentinel' && arm === 2 && ordinal === 2)) {
            browser.connected = false;
            browser.emit('disconnected');
            throw failure();
          }
          let page;
          return {
            newPage: async () => {
              pages += 1;
              events.push('page-' + arm + '-' + ordinal);
              const session = Object.assign(new EventEmitter(), {
                send: async (method) => {
                  assert.equal(method, 'Page.enable', 'no download-policy command');
                  events.push('observe-' + arm + '-' + ordinal);
                  if (fault === 'observe') throw failure();
                },
              });
              page = {
                session, createCDPSession: async () => session,
                url: () => 'about:blank',
                setViewport: async (viewport) => assert.deepEqual(viewport, { width: 1280, height: 900 }),
              };
              return page;
            },
            close: async () => {
              closes += 1;
              events.push('close-' + arm + '-' + ordinal);
              if (fault === 'late-terminal' && arm === 2 && ordinal === 1) {
                page.session.emit('Page.downloadProgress', { guid: secret, state: 'completed' });
              }
              if (fault === 'context-close' && arm === 2 && ordinal === 1) throw failure();
            },
          };
        },
        close: async () => {
          events.push('browser-close-' + arm);
          child.exitCode = browser.connected ? 0 : 3221225477;
          child.emit('exit', child.exitCode, null);
          browser.emit('disconnected');
          if (fault === 'browser-close') throw failure();
        },
      });
      return browser;
    } };
    ${source.slice(start, end)}
    await main();
    console.log('FIXTURE ' + JSON.stringify({ launches, created, pages, closes, prepared, readerRuns, events }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, '--', ...args], {
    encoding: 'utf8', timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /PRIVATE_|private\.invalid|Error:|file:\/\/|data:text/);
  const record = result.stdout.split(/\r?\n/).find((line) => line.startsWith('FIXTURE '));
  assert.ok(record, output);
  const summary = result.stdout.split(/\r?\n/).find((line) => line.startsWith('DIAGNOSTIC {'));
  return {
    ...result, output, facts: JSON.parse(record.slice(8)),
    summary: summary ? JSON.parse(summary.slice(11)) : null,
    downloads: result.stdout.split(/\r?\n/).filter((line) => line.startsWith('DOWNLOAD '))
      .map((line) => JSON.parse(line.slice(9))),
  };
}

test('context isolation fixes two fresh arms and four contexts without changing the reader scenario', () => {
  const result = diagnosticFixture();
  assert.equal(result.status, 0, result.output);
  assert.equal(result.stderr, '');
  assert.deepEqual({ ...result.facts, events: undefined }, {
    launches: 2, created: 4, pages: 4, closes: 4, prepared: 1, readerRuns: 1, events: undefined,
  });
  assert.deepEqual(result.facts.events, [
    'launch-1',
    'create-1-1', 'page-1-1', 'observe-1-1', 'close-1-1',
    'create-1-2', 'page-1-2', 'observe-1-2', 'close-1-2',
    'browser-close-1', 'connections-close-1', 'server-close-1',
    'launch-2',
    'create-2-1', 'page-2-1', 'observe-2-1', 'prepare-reader', 'reader-run', 'close-2-1',
    'create-2-2', 'page-2-2', 'observe-2-2', 'close-2-2',
    'browser-close-2', 'connections-close-2', 'server-close-2',
  ]);
  assert.deepEqual(result.summary, {
    diagnostic: 'context-export-isolation', qualified: false, outcome: 'both-passed-inconclusive',
    arms: [{ arm: 'browser-only', code: 0 }, { arm: 'reader-path', code: 0 }],
  });
  assert.equal((result.stdout.match(/ok {3}reader check/g) ?? []).length, 9);
  const readerBody = source.slice(source.indexOf("    id: 'reader-round-trip',"), source.indexOf("    id: 'undo-delete-dismiss',"));
  assert.equal((readerBody.match(/t\.check\(/g) ?? []).length, 9);
  assert.match(source.slice(start, end), /SCENARIOS\.find\(\(scenario\) => scenario\.id === 'reader-round-trip'\)/);
  assert.match(result.stdout, /arm=reader-path passed=10 failed=0/);
  assert.ok(result.downloads.every((record) => Number.isFinite(record.elapsedMs) && record.elapsedMs >= 0));
  const completed = result.downloads.find((record) => record.arm === 'reader-path'
    && record.context === 1 && record.stage === 'before-close');
  assert.equal(completed.completed, 1);
  assert.equal(completed.pending, 0);
});

test('context isolation preserves failure status and never retries either planned arm', () => {
  for (const fault of ['control-sentinel', 'reader-sentinel', 'assertion', 'context-close']) {
    const result = diagnosticFixture(fault);
    assert.equal(result.status, 1, result.output);
    assert.equal(result.facts.launches, 2);
    assert.equal(result.facts.readerRuns, 1);
    assert.equal(result.facts.created, ['assertion', 'context-close'].includes(fault) ? 3 : 4);
    assert.equal(result.summary.outcome, 'failure-observed');
    assert.ok(result.summary.arms.some((arm) => arm.code === 1));
    if (fault === 'control-sentinel') assert.equal(result.summary.arms[1].code, 0);
    assert.equal((result.facts.events.filter((event) => event === 'reader-run')).length, 1);
  }
});

test('context isolation aborts common identity capability and cleanup failures', () => {
  for (const fault of ['source', 'lock', 'driver', 'browser', 'pipe', 'capability', 'observe', 'reuse-profile', 'browser-close']) {
    const result = diagnosticFixture(fault);
    assert.equal(result.status, 1, result.output);
    assert.equal(result.summary.outcome, 'setup-aborted');
    assert.equal(result.facts.readerRuns, 0);
    const expectedLaunches = ['source', 'lock', 'driver'].includes(fault) ? 0 : fault === 'reuse-profile' ? 2 : 1;
    assert.equal(result.facts.launches, expectedLaunches);
    assert.equal(result.facts.created, ['reuse-profile', 'browser-close'].includes(fault) ? 2 : fault === 'observe' ? 1 : 0);
  }
});

test('context isolation logs terminal unobserved and pending downloads without waiting or exposing payloads', () => {
  for (const fault of ['pending', 'late-terminal', 'canceled', 'no-events']) {
    const result = diagnosticFixture(fault);
    assert.equal(result.status, 0, result.output);
    const records = result.downloads.filter((record) => record.arm === 'reader-path' && record.context === 1);
    const before = records.find((record) => record.stage === 'before-close');
    const after = records.find((record) => record.stage === 'after-close');
    assert.equal(before.pending, ['pending', 'late-terminal'].includes(fault) ? 1 : 0);
    assert.equal(before.completed, 0);
    assert.equal(before.canceled, fault === 'canceled' ? 1 : 0);
    assert.equal(after.pending, fault === 'pending' ? 1 : 0);
    assert.equal(after.completed, fault === 'late-terminal' ? 1 : 0);
    assert.equal(after.partialAfterClose, true);
    assert.equal(after.observation, fault === 'no-events' ? 'unobserved' : 'observed');
    assert.ok(records.some((record) => record.stage === 'process-exit'));
    assert.ok(records.some((record) => record.stage === 'disconnected'));
  }
});

test('context isolation rejects extra selectors and launch overrides before any launch', () => {
  for (const args of [
    ['--diagnostic=unknown'],
    ['--diagnostic=context-export-isolation', '--only=reader-round-trip'],
    ['--diagnostic=context-export-isolation', '--prove'],
    ['--diagnostic=context-export-isolation', '--forced-colors'],
  ]) {
    const result = diagnosticFixture('', args);
    assert.equal(result.status, 1, result.output);
    assert.equal(result.facts.launches, 0);
    assert.match(result.stderr, /stage=arguments/);
  }
  const headed = diagnosticFixture('headed');
  assert.equal(headed.status, 1, headed.output);
  assert.equal(headed.facts.launches, 0);
});
