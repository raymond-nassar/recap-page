import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

test('native observer initializes a GUI thread before demanding the exact DPI context', () => {
  const source = readFileSync(new URL('./native/StartupTests.cpp', import.meta.url), 'utf8');
  const main = source.slice(source.indexOf('int wmain('));
  const initialize = main.indexOf('IsGUIThread(TRUE)');
  const set = main.indexOf('SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2)');
  const verify = main.indexOf('AreDpiAwarenessContextsEqual(GetThreadDpiAwarenessContext()');
  assert.ok(initialize !== -1 && initialize < set && set < verify);
  assert.match(main, /IsGUIThread\(TRUE\) != FALSE/);
  assert.match(main, /SetThreadDpiAwarenessContext\(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2\) != nullptr/);
  assert.match(main, /AreDpiAwarenessContextsEqual\(GetThreadDpiAwarenessContext\(\),\s*DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2\)/);
  assert.match(main, /if \(options\[L"--mode"\] == L"dpi-awareness"\) \{\s*observed\("installed-poll-cases", \[\] \{ installedPollCases\(\); \}\);/);
  assert.match(main, /CoGetApartmentType\(&apartment, &qualifier\)/);
  assert.match(main, /apartment == APTTYPE_STA \|\| apartment == APTTYPE_MAINSTA/);
  assert.match(main, /CoInitializeEx\(nullptr, apartmentModel\)/);
  const wrapper = readFileSync(new URL('../scripts/native-startup-proof.ps1', import.meta.url), 'utf8');
  assert.match(wrapper, /\$env:MRT_NATIVE_DPI_PROOF = '1'\s*& node --test/);
  assert.match(wrapper, /finally \{ \$env:MRT_NATIVE_DPI_PROOF = \$previousDpiProof \}/);
  assert.match(wrapper, /& node --test \(Join-Path \$root 'test\\native-dpi-awareness\.test\.js'\)\s*if \(\$LASTEXITCODE -ne 0\) \{ throw/);
});

test('hidden redirected native observer respects an existing STA and establishes per-monitor-v2 DPI awareness', {
  skip: process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true'
    || process.env.MRT_NATIVE_DPI_PROOF !== '1',
}, (t) => {
  const scratch = mkdtempSync(join(tmpdir(), 'recap-dpi-proof-'));
  t.after(() => rmSync(scratch, { recursive: true, force: true }));
  const report = join(scratch, 'result.txt');
  const driver = fileURLToPath(new URL(
    `../dist/native-proof/${process.arch}/NativeStartupTests.exe`, import.meta.url));
  const child = spawnSync(driver, [
    '--mode', 'dpi-awareness', '--com-apartment', 'sta', '--report', report,
  ], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, timeout: 10000,
    encoding: 'utf8', maxBuffer: 65536,
  });
  assert.ifError(child.error);
  const text = readFileSync(report, 'utf8');
  assert.equal(child.status, 0, text);
  assert.equal(child.stdout, '');
  assert.equal(child.stderr, '');
  assert.match(text, /CHECK EXIT proof-gui-thread/);
  assert.match(text, /CHECK EXIT proof-dpi-awareness/);
  assert.match(text, /CHECK EXIT installed-poll-cases/);
  assert.match(text, /^PASS hidden-observer-dpi-awareness\r?$/m);
  assert.doesNotMatch(text, /^FAIL /m);
});
