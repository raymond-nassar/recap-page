import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { assertColdSearchIndexes, waitForSettledRoots, waitForStaleOffline } from '../scripts/msix-proof.mjs';

test('installed lifecycle diagnostics retain exact count acceptance and the existing deadline', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'recap-root-counts-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const outputs = [];
  const timeout = new Error('bounded fixture timeout');
  for (const [text, expected] of [
    [undefined, 'present=0 parsed=0 started=unknown ended=unknown'],
    ['started=1\nended=1\n', 'present=1 parsed=1 started=1 ended=1'],
    ['started=2\nended=1\n', 'present=1 parsed=1 started=2 ended=1'],
    ['PRIVATE untrusted text', 'present=1 parsed=0 started=unknown ended=unknown'],
  ]) {
    if (text !== undefined) writeFileSync(join(root, 'counts.txt'), text);
    const waiter = async (check, message, deadline) => {
      assert.equal(message, 'native activation lifecycle did not settle');
      assert.equal(deadline, 30000);
      assert.equal(await check(), false);
      throw timeout;
    };
    await assert.rejects(waitForSettledRoots(2, () => {}, root, waiter, (text) => outputs.push(text)),
      (error) => error === timeout);
    assert.equal(outputs.at(-1),
      `DIAG installed-root-wait expected=2 ${expected} observer_alive=1`);
    assert.equal(readFileSync(join(root, 'root-timeout.txt'), 'utf8'), 'observe');
    rmSync(join(root, 'root-timeout.txt'));
  }
  writeFileSync(join(root, 'counts.txt'), 'started=2\nended=2\n');
  const before = outputs.length;
  assert.equal(await waitForSettledRoots(2, () => {}, root, async (check) => check(),
    (text) => outputs.push(text)), true);
  assert.equal(outputs.length, before);
  assert.doesNotMatch(outputs.join('\n'), /PRIVATE|counts\.txt|recap-root-counts/);
  const source = readFileSync(new URL('../scripts/msix-proof.mjs', import.meta.url), 'utf8');
  assert.match(source, /waitForSettledRoots: \(count\) => waitForSettledRoots\(count, assertAlive, root\)/);
});

test('timeout observation uses only retained exact-image root instances and fixed result labels', () => {
  const observer = readFileSync(new URL('../test/native/StartupObserver.h', import.meta.url), 'utf8');
  const method = observer.match(/std::vector<RootState> rootStates\([\s\S]*?return states;\s*\}/)?.[0];
  assert.ok(method);
  assert.match(method, /recap::samePath\(item\.image, expected\)/);
  assert.match(method, /graph\.unique\(item\.pid, static_cast<LONGLONG>\(item\.witnessed\)\) == instance/);
  assert.match(method, /WaitForSingleObject\(retained->process\.get\(\), 0\)/);
  assert.doesNotMatch(method, /OpenProcess|CreateProcess|TerminateProcess/);
  const native = readFileSync(new URL('../test/native/StartupTests.cpp', import.meta.url), 'utf8');
  const report = native.match(/void reportInstalledRootTimeout\([\s\S]*?report\.flush\(\);\s*\}/)?.[0];
  assert.ok(report);
  assert.match(report, /item\.owner == state\.pid && item\.kind == proof::WindowKind::startup/);
  assert.match(report, /owner == state\.pid/);
  assert.match(report, /if \(emitted\+\+ == 16\) break/);
  assert.doesNotMatch(report, /<< (?:detail|button|executable)|EnumWindows|OpenProcess/);
  assert.match(native, /const bool complete = completeInstalledWait\(waitState,[\s\S]*fs::exists\(control \/ L"finish\.txt"\)[\s\S]*fs::exists\(control \/ L"root-timeout\.txt"\)[\s\S]*?return complete;/);
});

test('a missing retained root reports what its window anchor attempts found before failing', () => {
  const observer = readFileSync(new URL('../test/native/StartupObserver.h', import.meta.url), 'utf8');
  const hook = observer.match(/fact\.kind == WindowKind::startup && fact\.owner &&[\s\S]*?noteRootCandidate\([^;]*;/)?.[0];
  assert.ok(hook);
  for (const outcome of ['open-failed', 'exited', 'image-differs', 'thread-unmatched', 'bound'])
    assert.match(hook, new RegExp(`"${outcome}"`));
  assert.match(hook, /current_->bindRoot\(fact\.owner, process\.get\(\), primary\.get\(\)\);\s*outcome = "bound";/);
  assert.match(observer, /if \(rootCandidates_\.size\(\) >= 64\) \{ \+\+rootCandidatesDropped_; return; \}/);
  assert.match(observer, /if \(retained == rootAnchors_\.end\(\)\) reportRootCandidate\(value\);\s*finalRequire\(retained != rootAnchors_\.end\(\), "final-root-retained-instance-missing"/);
  const native = readFileSync(new URL('../test/native/StartupTests.cpp', import.meta.url), 'utf8');
  assert.match(native, /if \(finished - pollBegin >= 500 && \+\+slowPolls <= 16\) \{\s*report << "DIAG installed-poll-slow /);
});

test('actual native handoff ordering observes a timeout published at the finish boundary once', () => {
  const native = readFileSync(new URL('../test/native/StartupTests.cpp', import.meta.url), 'utf8');
  const body = native.match(/bool completeInstalledWait\([^\n]+\) \{([\s\S]*?)^\}/m)?.[1];
  assert.ok(body);
  // The helper body is shared syntax apart from its declaration; hosted tests compile the C++ caller.
  const invoke = runInNewContext(`(state, finished, pending, emit) => {
    ${body.replace('const bool complete', 'const complete')}
  }`);
  const state = { timeoutReported: false };
  const rows = [];
  let published = false;
  assert.equal(invoke(state, () => { published = true; return true; },
    () => published, () => rows.push('observed')), true);
  assert.deepEqual(rows, ['observed']);
  assert.equal(invoke(state, () => true, () => true, () => rows.push('duplicate')), true);
  assert.deepEqual(rows, ['observed']);
  assert.equal(invoke({ timeoutReported: false }, () => false, () => false,
    () => assert.fail('no marker')), false);
});

test('installed poll failures expose fixed operations and numeric errors, never exception text', () => {
  const native = readFileSync(new URL('../test/native/StartupTests.cpp', import.meta.url), 'utf8');
  const helper = native.match(/bool installedPoll\([^\n]+\) \{([\s\S]*?)^\}/m)?.[1];
  assert.ok(helper, 'the installed poll must retain the failing operation');
  assert.match(helper, /return poll\(operation\)/);
  assert.match(helper, /catch \(const std::exception& failure\)/);
  assert.match(helper, /dynamic_cast<const fs::filesystem_error\*>/);
  assert.match(helper, /dynamic_cast<const std::ios_base::failure\*>/);
  assert.match(helper, /dynamic_cast<const std::bad_alloc\*>/);
  assert.match(helper, /std::system_category\(\)/);
  assert.match(helper, /std::generic_category\(\)/);
  assert.match(helper, /std::iostream_category\(\)/);
  assert.match(helper, /"DIAG installed-poll-failure operation="/);
  assert.match(helper, /system->code\(\)\.value\(\)/);
  assert.match(helper, /catch \(\.\.\.\) \{\}\s*throw;/);
  assert.doesNotMatch(helper, /\.what\(|\.name\(|\.message\(|\.path[12]\(|typeid/);

  const installed = native.slice(native.indexOf('void installed('), native.indexOf('} // namespace'));
  assert.match(installed, /return installedPoll\(report, \[&\]\(const char\*& operation\)/);
  for (const [operation, action] of [
    ['root-count', 'const auto counts = observer.entryCounts(executable)'],
    ['counts-publish', 'write(control / L"counts.txt"'],
    ['busy-feedback', 'if (busy && !dismissed)'],
    ['finish-query', 'return busy ? dismissed : fs::exists(control / L"finish.txt")'],
    ['timeout-query', 'return fs::exists(control / L"root-timeout.txt")'],
    ['root-diagnostic', 'reportInstalledRootTimeout(observer, executable, report)'],
  ]) {
    const marker = `operation = "${operation}";`;
    assert.ok(installed.includes(marker), `missing fixed operation ${operation}`);
    assert.ok(installed.indexOf(marker) < installed.indexOf(action),
      `${operation} must be recorded before it can fail`);
  }
  assert.match(helper, /operation = "semantic-collect"/);
  assert.match(installed, /"installed observer deadline exceeded", 600000/);
  assert.match(native, /void serverVerifierCases\(\) \{\s*installedPollCases\(\);/);
  const cases = native.match(/void installedPollCases\(\) \{([\s\S]*?)^\}/m)?.[1];
  assert.ok(cases);
  assert.doesNotMatch(cases, /std::current_exception|std::make_exception_ptr|std::rethrow_exception/);
  assert.equal((cases.match(/original = &injected; throw;/g) || []).length, 2);
  assert.equal((cases.match(/check\(&propagated == original/g) || []).length, 2);
  assert.match(cases, /PRIVATE category/);
  assert.match(cases, /installedPoll\(broken/);
});

test('semantic handshake reads retry only bounded transient stream failures', () => {
  const native = readFileSync(new URL('../test/native/StartupTests.cpp', import.meta.url), 'utf8');
  const retry = native.match(/auto retrySemanticRecordRead\([^{]+\{([\s\S]*?)^\}/m)?.[1];
  assert.ok(retry);
  assert.match(retry, /catch \(const std::ios_base::failure&\)/);
  assert.match(retry, /retry == SemanticRecordReadRetryLimit/);
  assert.match(retry, /pause\(\)/);
  assert.doesNotMatch(retry, /catch \(\.\.\.\)|catch \(const std::exception/);

  const reader = native.match(/std::string readSemanticRecord\([^{]+\{([\s\S]*?)^\}/m)?.[1];
  assert.ok(reader);
  assert.match(reader, /retrySemanticRecordRead\(\[&\]/);
  assert.match(reader, /\[\] \{ Sleep\(20\); \}/);
  assert.match(native, /void serverVerifierCases\(\) \{\s*installedPollCases\(\);\s*semanticRecordReadCases\(\);/);
  const verifierCases = native.match(/void serverVerifierCases\(\) \{([\s\S]*?)^\}/m)?.[1];
  assert.match(verifierCases, /nativeVerifierDiagnosticCases\(\*liveReport\);/);
  const cases = native.match(/void semanticRecordReadCases\(\) \{([\s\S]*?)^\}/m)?.[1];
  assert.ok(cases);
  assert.match(cases, /transient semantic record read did not recover/);
  assert.match(cases, /persistent semantic record read failure exceeded its retry bound/);
  assert.match(cases, /non-I\/O semantic record failure was retried/);
});

test('proof DPI context is configured before COM initialization', () => {
  const native = readFileSync(new URL('../test/native/StartupTests.cpp', import.meta.url), 'utf8');
  const startup = native.slice(native.indexOf('int wmain('));
  assert.ok(startup.indexOf('SetThreadDpiAwarenessContext') < startup.indexOf('CoInitializeEx'));
});

test('the stopped-server proof refuses a cached creator or series index but permits a cached shell', async () => {
  const cached = new Set(['/index.html']);
  const page = {
    evaluate: (read, paths) => runInNewContext(`(${read})(paths)`, {
      paths, URL, location: { origin: 'http://127.0.0.1:8787' },
      caches: { match: async (url) => cached.has(url.pathname) ? {} : undefined },
    }),
  };
  await assertColdSearchIndexes(page);
  for (const name of ['creators', 'series']) {
    const path = `/data/${name}-index.json`;
    cached.add(path);
    await assert.rejects(assertColdSearchIndexes(page), (error) => error.message.includes(path));
    cached.delete(path);
  }
});

test('a stale offline wait timeout records the page state and rethrows the same error', async (t) => {
  const lines = [];
  t.mock.method(console, 'log', (line) => { lines.push(line); });
  const timeout = Object.assign(new Error('Waiting failed: 30000ms exceeded'), { name: 'TimeoutError' });
  const page = (failure, state) => ({
    waitForFunction: async () => { if (failure) throw failure; },
    evaluate: async () => {
      if (state instanceof Error) throw state;
      return state;
    },
  });

  await assert.rejects(
    waitForStaleOffline(page(timeout, { results: 'Searching…', cached: { '/data/creators-index.json': true } }),
      '#creator-results', 'creator', { listener: () => 4242 }),
    (error) => error === timeout,
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^DIAG stale-offline-wait-timeout \{/);
  const record = JSON.parse(lines[0].slice('DIAG stale-offline-wait-timeout '.length));
  assert.equal(record.label, 'creator');
  assert.equal(record.listenerPid, 4242);
  assert.equal(record.results, 'Searching…');
  assert.equal(record.cached['/data/creators-index.json'], true);

  await assert.rejects(
    waitForStaleOffline(page(timeout, new Error('page gone')), '#series-results', 'series', {
      listener: () => { throw new Error('query failed'); },
    }),
    (error) => error === timeout,
  );
  const second = JSON.parse(lines[1].slice('DIAG stale-offline-wait-timeout '.length));
  assert.equal(second.stateError, 'page gone');
  assert.equal(second.listenerPid, 'error: query failed');

  const other = new Error('target closed');
  await assert.rejects(waitForStaleOffline(page(other, {}), '#creator-results', 'creator', {
    listener: () => { throw new Error('must not be queried'); },
  }), (error) => error === other);
  await waitForStaleOffline(page(null, {}), '#creator-results', 'creator', {
    listener: () => { throw new Error('must not be queried'); },
  });
  assert.equal(lines.length, 2);
});
