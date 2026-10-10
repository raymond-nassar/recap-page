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
  // Expanded lifecycle fixtures exceeded Windows' argument limit; stdin preserves their source.
  const result = spawnSync(process.execPath, ['--input-type=module', '-'], {
    input: script,
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

function diagnosticFixture(
  fault = '', args = ['--diagnostic=context-export-isolation'], expectedDownloads = 1,
  lockText = readFileSync(new URL('../.github/browser-proof/package-lock.json', import.meta.url), 'utf8'),
) {
  // The recorded Windows diagnostic hashes CRLF bytes; Linux CI checks out the same lock with LF.
  const lock = lockText.replace(/\r?\n/g, '\r\n');
  const script = `
    import assert from 'node:assert/strict';
    import { EventEmitter } from 'node:events';
    import { constants, tmpdir } from 'node:os';
    import { dirname, join } from 'node:path';
    process.argv = ['node', 'browser-check.mjs', ...process.argv.slice(2)];
    const fault = ${JSON.stringify(fault)};
    const expectedDownloads = ${JSON.stringify(expectedDownloads)};
    const secret = 'PRIVATE_PROFILE https://private.invalid/ PRIVATE_STDERR';
    const failure = (name = 'TargetCloseError') => Object.assign(new Error(secret), { name });
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
    let recoveryRuns = 0;
    const recoveryMode = process.argv.includes('--diagnostic=recovery-export-completion');
    let activePage;
    let activeBrowser;
    let elapsed = 0;
    const timers = new Set();
    const delays = [];
    const complete = (page, guid = secret) => page.session.emit('Page.downloadProgress', { guid, state: 'completed' });
    const setTimeout = (callback, delay) => {
      assert.equal(delay, 15000);
      delays.push(delay);
      const timer = { callback, delay };
      timers.add(timer);
      queueMicrotask(() => {
        if (!timers.has(timer)) return;
        if (fault === 'late-begin') {
          activePage.session.emit('Page.downloadWillBegin', { guid: secret });
          complete(activePage);
        } else if (['delayed-completion', 'matched'].includes(fault)) {
          complete(activePage);
        } else if (fault === 'disconnect-wait') {
          activeBrowser.connected = false;
          activeBrowser.emit('disconnected');
        }
        if (timers.delete(timer)) {
          elapsed += delay;
          callback();
        }
      });
      return timer;
    };
    const clearTimeout = (timer) => timers.delete(timer);
    const events = [];
    const readFileSync = (path) => String(path).endsWith('package-lock.json')
      ? (fault === 'lock' ? 'wrong-lock' : ${JSON.stringify(lock)})
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
      id: recoveryMode ? 'restore-copy-workflow' : 'reader-round-trip', title: 'existing export fixture',
      nativeDownloads: expectedDownloads,
      async run(page, t) {
        if (recoveryMode) recoveryRuns += 1;
        else readerRuns += 1;
        activePage = page;
        events.push('reader-run');
        const count = fault === 'missing-last' ? expectedDownloads - 1
          : fault === 'extra-download' ? expectedDownloads + 1 : expectedDownloads;
        for (let index = 0; index < count && !['no-events', 'late-begin'].includes(fault); index += 1) {
          const guid = index ? secret + index : secret;
          page.session.emit('Page.downloadWillBegin', {
            guid, url: secret, suggestedFilename: secret,
          });
          page.session.emit('Page.downloadProgress', {
            guid, state: fault === 'invalid-event' ? secret : 'inProgress', receivedBytes: 12, totalBytes: 12,
          });
          if (!['pending', 'late-terminal', 'delayed-completion', 'matched', 'disconnect-wait', 'primary-pending-close'].includes(fault)) {
            page.session.emit('Page.downloadProgress', {
              guid, state: fault === 'canceled' ? 'canceled' : 'completed', filePath: secret,
            });
          }
          if (fault === 'duplicate-begin') page.session.emit('Page.downloadWillBegin', { guid });
          if (fault === 'invalid-state') page.session.emit('Page.downloadProgress', { guid, state: 'inProgress' });
          if (fault === 'reload-six' && index === 4) {
            page.documentDownloads = [];
            page.emit('framenavigated', {});
            events.push('document-reset');
          }
        }
        for (let index = 0; index < 9; index += 1) {
          t.check('reader check ' + index, fault !== 'assertion' || index !== 4);
        }
        if (fault === 'primary-pending-close') throw failure('TypeError');
        if (fault === 'primary-error') throw failure('TypeError');
        if (fault === 'process-loss') {
          activeBrowser.connected = false;
          activeBrowser.emit('disconnected');
          throw failure();
        }
      },
    }, {
      id: 'after-reader', title: 'ordinary continuation',
      async run(_page, t) {
        events.push('ordinary-continuation');
        t.check('following ordinary scenario ran', true);
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
            || (fault === 'reader-sentinel' && arm === 2 && ordinal === 2)
            || (fault === 'matched' && ordinal === 2 && !activePage.nativeCompleted)) {
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
              page = Object.assign(new EventEmitter(), {
                session, createCDPSession: async () => session,
                url: () => 'about:blank',
                setViewport: async (viewport) => assert.deepEqual(viewport, { width: 1280, height: 900 }),
              });
              session.on('Page.downloadProgress', (event) => {
                if (event.state === 'completed') page.nativeCompleted = true;
              });
              return page;
            },
            close: async () => {
              closes += 1;
              events.push('close-' + arm + '-' + ordinal);
              if (fault === 'late-terminal' && arm === 2 && ordinal === 1) {
                page.session.emit('Page.downloadProgress', { guid: secret, state: 'completed' });
              }
              if (fault === 'context-close' && arm === 2 && ordinal === 1) throw failure();
              if (fault === 'primary-pending-close' && ordinal === 1) throw failure();
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
      activeBrowser = browser;
      return browser;
    } };
    ${source.slice(start, end)}
    await main();
    console.log('FIXTURE ' + JSON.stringify({
      launches, created, pages, closes, prepared, readerRuns, events,
      ...(recoveryMode ? { recoveryRuns } : {}),
    }));
    console.log('CLOCK ' + JSON.stringify({ delays, elapsed, pending: timers.size }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-', ...args], {
    input: script, encoding: 'utf8', timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  const output = result.stdout + result.stderr;
  assert.doesNotMatch(output, /PRIVATE_|private\.invalid|Error:|file:\/\/|data:text/);
  const record = result.stdout.split(/\r?\n/).find((line) => line.startsWith('FIXTURE '));
  assert.ok(record, output);
  const summary = result.stdout.split(/\r?\n/).find((line) => line.startsWith('DIAGNOSTIC {'));
  const clock = result.stdout.split(/\r?\n/).find((line) => line.startsWith('CLOCK '));
  return {
    ...result, output, facts: JSON.parse(record.slice(8)),
    clock: JSON.parse(clock.slice(6)),
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
  assert.match(source.slice(start, end), /const exportId = recoveryComparison \? 'restore-copy-workflow' : 'reader-round-trip';/);
  assert.match(source.slice(start, end), /SCENARIOS\.find\(\(scenario\) => scenario\.id === exportId\)/);
  assert.match(result.stdout, /arm=reader-path passed=10 failed=0/);
  assert.ok(result.downloads.every((record) => Number.isFinite(record.elapsedMs) && record.elapsedMs >= 0));
  const completed = result.downloads.find((record) => record.arm === 'reader-path'
    && record.context === 1 && record.stage === 'before-close');
  assert.equal(completed.completed, 1);
  assert.equal(completed.pending, 0);
});

test('Windows diagnostic fixture retains exact hosted lock identity from LF and CRLF checkouts', () => {
  const lf = readFileSync(new URL('../.github/browser-proof/package-lock.json', import.meta.url), 'utf8')
    .replace(/\r\n/g, '\n');
  for (const lock of [lf, lf.replace(/\n/g, '\r\n')]) {
    const result = diagnosticFixture('', ['--diagnostic=context-export-isolation'], 1, lock);
    assert.equal(result.status, 0, result.output);
    assert.equal(result.facts.launches, 2);
    assert.equal(result.facts.created, 4);
    assert.equal(result.summary.outcome, 'both-passed-inconclusive');
  }
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
    ['--diagnosticXnative-export-completion'],
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

test('ordinary native completion requires an observed begin even when no download is pending yet', () => {
  const result = diagnosticFixture('no-events', []);
  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, /stage=complete-native-downloads code=TimeoutError reason=missing-begin/);
  assert.equal(result.facts.created, 1, 'unmet completion stops ordinary continuation');
  assert.equal(result.facts.closes, 1, 'failed completion still closes its context');
  assert.equal(result.clock.elapsed, 15000);
  assert.deepEqual(result.clock.delays, [15000]);
  assert.equal(result.clock.pending, 0);
  assert.doesNotMatch(result.stdout, /SCENARIO id=after-reader/);
});

test('ordinary native completion handles late and pre-observed events with one context deadline', () => {
  for (const fault of ['', 'late-begin', 'delayed-completion']) {
    const result = diagnosticFixture(fault, []);
    assert.equal(result.status, 0, result.output);
    assert.equal(result.facts.created, 2);
    assert.ok(result.facts.events.includes('ordinary-continuation'));
    assert.deepEqual(result.clock, { delays: [15000], elapsed: 0, pending: 0 });
    const complete = result.stdout.indexOf('"stage":"completion-result"');
    const close = result.stdout.indexOf('SCENARIO id=reader-round-trip stage=close-context');
    assert.ok(complete > 0 && complete < close);
    assert.match(result.stdout, /"expected":1,.*"completed":1,.*"result":"completed"/);
  }
});

test('ordinary native completion counts all six downloads across document reset and rejects a late missing last one', () => {
  const complete = diagnosticFixture('reload-six', [], 6);
  assert.equal(complete.status, 0, complete.output);
  assert.ok(complete.facts.events.includes('document-reset'));
  assert.match(complete.stdout, /"expected":6,.*"begun":6,.*"completed":6,.*"result":"completed"/);
  assert.deepEqual(complete.clock, { delays: [15000], elapsed: 0, pending: 0 });
  const missing = diagnosticFixture('missing-last', [], 6);
  assert.equal(missing.status, 1, missing.output);
  assert.match(missing.stdout, /"expected":6,.*"begun":5,.*"completed":5,.*"reason":"missing-begin"/);
  assert.equal(missing.facts.created, 1);
  assert.deepEqual(missing.clock, { delays: [15000], elapsed: 15000, pending: 0 });
});

test('ordinary native completion fails canceled pending invalid count and disconnect evidence explicitly', () => {
  for (const [fault, reason] of [
    ['canceled', 'canceled'], ['pending', 'pending-timeout'],
    ['invalid-event', 'invalid-event'], ['duplicate-begin', 'invalid-event'],
    ['invalid-state', 'invalid-state'], ['extra-download', 'unexpected-count'],
    ['disconnect-wait', 'observer-disconnected'],
  ]) {
    const result = diagnosticFixture(fault, []);
    assert.equal(result.status, 1, result.output);
    assert.match(result.stdout, new RegExp('stage=complete-native-downloads code=\\w+ reason=' + reason));
    assert.equal(result.facts.created, 1);
    assert.equal(result.facts.closes, 1);
    assert.equal(result.clock.pending, 0);
    assert.deepEqual(result.clock.delays, [15000]);
    assert.equal(result.clock.elapsed, fault === 'pending' ? 15000 : 0);
  }
});

test('native completion retains the primary scenario failure and both completion and cleanup failures', () => {
  const result = diagnosticFixture('primary-pending-close', []);
  assert.equal(result.status, 1, result.output);
  assert.match(result.stdout, /FAIL scenario=reader-round-trip stage=run code=TypeError/);
  assert.match(result.stdout, /native download completion\s+stage=complete-native-downloads code=TimeoutError reason=pending-timeout/);
  assert.match(result.stdout, /context cleanup\s+stage=close-context code=TargetCloseError/);
  assert.match(result.stdout, /9 assertion\(s\) passed, 3 failed/);
  assert.match(result.stdout, /SCENARIOS completed=0 planned=2 last-completed=none/);
  assert.ok(result.facts.events.includes('browser-close-1'));
  assert.ok(result.facts.events.includes('server-close-1'));
  assert.equal(result.facts.created, 1);
  assert.equal(result.clock.pending, 0);
});

test('the fixed completion comparison preserves a failing control and uses the ordinary gate only for treatment', () => {
  const result = diagnosticFixture('matched', ['--diagnostic=native-export-completion']);
  assert.equal(result.status, 1, result.output);
  assert.deepEqual(result.summary, {
    diagnostic: 'native-export-completion', qualified: false, outcome: 'failure-observed',
    arms: [{ arm: 'reader-observe-only', code: 1 }, { arm: 'reader-completion', code: 0 }],
  });
  assert.equal(result.facts.launches, 2);
  assert.equal(result.facts.created, 4);
  assert.equal(result.facts.readerRuns, 2);
  assert.equal((result.stdout.match(/ok {3}reader check/g) ?? []).length, 18);
  assert.deepEqual(result.clock, { delays: [15000], elapsed: 0, pending: 0 });
  assert.equal(result.downloads.filter((record) => record.stage === 'completion-wait').length, 1);
  assert.ok(result.downloads.some((record) => record.arm === 'reader-completion'
    && record.stage === 'completion-result' && record.result === 'completed'));
  assert.match(result.stdout, /capability=Page-download-events policy-change=false completion-wait=false/);
  assert.match(result.stdout, /capability=Page-download-events policy-change=false completion-wait=true/);
});

test('recovery completion comparison preserves the failed control and one gated treatment', () => {
  const result = diagnosticFixture('matched', ['--diagnostic=recovery-export-completion']);
  assert.equal(result.status, 1, result.output);
  assert.deepEqual(result.summary, {
    diagnostic: 'recovery-export-completion', qualified: false, outcome: 'failure-observed',
    arms: [
      { arm: 'recovery-observe-only', code: 1, sentinel: { status: 'failed', reason: 'TargetCloseError' } },
      { arm: 'recovery-completion', code: 0, sentinel: { status: 'completed', reason: null } },
    ],
  });
  assert.equal(result.facts.launches, 2);
  assert.equal(result.facts.created, 4);
  assert.equal(result.facts.readerRuns, 0);
  assert.equal(result.facts.recoveryRuns, 2);
  assert.equal(result.downloads.filter((record) => record.stage === 'completion-wait').length, 1);
  const pending = result.downloads.find((record) => record.arm === 'recovery-observe-only'
    && record.stage === 'before-close' && record.context === 1);
  assert.equal(pending.pending, 1);
  const completed = result.downloads.find((record) => record.arm === 'recovery-completion'
    && record.stage === 'before-close' && record.context === 1);
  assert.equal(completed.completed, 1);
  assert.equal(completed.pending, 0);
});

test('recovery sentinels run once after recoverable errors and account for unavailable evidence', () => {
  const recovered = diagnosticFixture('primary-error', ['--diagnostic=recovery-export-completion']);
  assert.equal(recovered.status, 1, recovered.output);
  assert.equal(recovered.facts.created, 4);
  assert.equal(recovered.facts.recoveryRuns, 2);
  assert.equal(recovered.summary.outcome, 'failure-observed');
  assert.ok(recovered.summary.arms.every((arm) => arm.code === 1
    && arm.sentinel.status === 'completed'));
  for (const [fault, reason, launches] of [
    ['process-loss', 'process-unavailable', 2],
    ['observe', 'observer-unavailable', 1],
  ]) {
    const unavailable = diagnosticFixture(fault, ['--diagnostic=recovery-export-completion']);
    assert.equal(unavailable.status, 1, unavailable.output);
    assert.equal(unavailable.facts.launches, launches);
    assert.equal(unavailable.facts.created, launches);
    assert.ok(unavailable.summary.arms.every((arm) => arm.sentinel.status === 'not-run'
      && arm.sentinel.reason === reason));
    assert.equal(unavailable.summary.outcome, fault === 'observe' ? 'setup-aborted' : 'comparison-incomplete');
  }
});

test('all ordinary native-export scenarios declare their complete context totals', () => {
  for (const [file, id, count] of [
    ['browser-check.mjs', 'restore-copy-workflow', 1],
    ['browser-check.mjs', 'reader-round-trip', 1],
    ['browser-check.mjs', 'reading-shortcut', 1],
    ['browser-markdown-export.mjs', 'readable-markdown-export', 4],
    ['browser-order-export.mjs', 'order-only-export', 6],
  ]) {
    const text = readFileSync(new URL('../scripts/' + file, import.meta.url), 'utf8');
    assert.match(text, new RegExp("id: '" + id + "',\\s+nativeDownloads: " + count + ','));
  }
  const invalid = diagnosticFixture('', [], 0);
  assert.equal(invalid.status, 1, invalid.output);
  assert.match(invalid.stdout, /reason=invalid-expectation/);
  assert.equal(invalid.facts.created, 1);
});

test('positive export actions use focused native Enter for every intended file', async () => {
  const markdown = readFileSync(new URL('../scripts/browser-markdown-export.mjs', import.meta.url), 'utf8');
  const order = readFileSync(new URL('../scripts/browser-order-export.mjs', import.meta.url), 'utf8');
  const markdownHelper = markdown.match(/const download = async \(count\) => \{[\s\S]*?\n {4}\};/)?.[0];
  const markdownCalls = [...markdown.matchAll(/const (?:first|second|third) = (await download\(\d+\));/g)]
    .map((match) => match[1] + ';');
  const jsonAction = markdown.match(/ {4}await page\.(?:\$eval|focus)\('#btn-export-json'[\s\S]*?(?= {4}await page\.waitForFunction)/)?.[0];
  const orderHelpers = order.slice(order.indexOf('async function click('), order.indexOf('export const orderOnlyExport'));
  const positiveOrder = order.slice(0, order.indexOf("URL.createObjectURL = () => { throw new Error('Synthetic download refusal')"));
  const orderActions = [...positiveOrder.matchAll(/await \w+\(page, ('#(?:markdown-export button\[type="submit"\]|btn-export-json|ask-ok)')\);/g)]
    .map((match) => match[0]);
  assert.ok(markdownHelper && jsonAction && orderHelpers);
  assert.equal(markdownCalls.length, 3);
  assert.equal(orderActions.length, 6);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  for (const [body, selectors] of [
    [`${markdownHelper}\n${markdownCalls.join('\n')}\n${jsonAction}`, [
      '#markdown-export button[type="submit"]', '#markdown-export button[type="submit"]',
      '#markdown-export button[type="submit"]', '#btn-export-json',
    ]],
    [`${orderHelpers}\n${orderActions.join('\n')}`, [
      '#markdown-export button[type="submit"]', '#btn-export-json', '#ask-ok',
      '#btn-export-json', '#ask-ok', '#ask-ok',
    ]],
  ]) {
    const events = [];
    const page = {
      focus: async (selector) => events.push(['focus', selector]),
      keyboard: { press: async (key) => events.push(['key', key]) },
      $eval: async (selector) => events.push(['script-click', selector]),
      waitForFunction: async () => {},
      evaluate: async () => ({ text: 'captured fixture', type: 'text/markdown' }),
    };
    await new AsyncFunction('page', body)(page);
    assert.deepEqual(events, selectors.flatMap((selector) => [['focus', selector], ['key', 'Enter']]));
  }
  assert.match(markdown, /if \(blob\.type === 'text\/markdown'\) throw new Error\('Synthetic download failure'\)/);
  assert.match(order, /await click\(page, '#ask-cancel'\)/);
  assert.match(order.slice(order.indexOf("URL.createObjectURL = () => { throw new Error('Synthetic download refusal')")),
    /await click\(page, '#ask-ok'\)/);
});
