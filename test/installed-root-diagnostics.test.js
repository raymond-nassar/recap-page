import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import { waitForSettledRoots } from '../scripts/msix-proof.mjs';

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
  assert.match(native, /return completeInstalledWait\(waitState,[\s\S]*fs::exists\(control \/ L"finish\.txt"\)[\s\S]*fs::exists\(control \/ L"root-timeout\.txt"\)/);
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
  assert.match(cases, /std::current_exception\(\) == original/);
  assert.match(cases, /PRIVATE category/);
  assert.match(cases, /installedPoll\(broken/);
});
