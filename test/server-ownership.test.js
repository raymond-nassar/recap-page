import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  SERVER_OWNERSHIP_HELPER, parseNativeVerifierRecord, verifyServerProcess,
  probeServer, coordinateLaunch, encodeGuiResult, verificationDiagnosticLine,
} from '../packaging/windows/Launcher.mjs';

function wire(overrides = {}) {
  return JSON.stringify({
    schema: 'RCPN1', owned: true, stage: 'complete', reason: 'ok', code: 0, helperBits: 64,
    ...overrides,
  }) + '\n';
}

test('native verifier invokes only the exact packaged executable with one bounded PID', () => {
  assert.equal(SERVER_OWNERSHIP_HELPER, fileURLToPath(new URL('../packaging/windows/RecapPageVerifier.exe', import.meta.url)));
  for (const pid of [1, 41, 0xffffffff]) {
    let calls = 0;
    assert.equal(verifyServerProcess(pid, {
      execFile: (file, args, options) => {
        calls++;
        assert.equal(file, SERVER_OWNERSHIP_HELPER);
        assert.deepEqual(args, [String(pid)]);
        assert.deepEqual(options, { encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: 'pipe' });
        return wire();
      },
    }), true);
    assert.equal(calls, 1);
  }
  for (const pid of [0, -1, 1.5, NaN, Infinity, 0x100000000, '41', '41; exit 0', null, undefined]) {
    assert.equal(verifyServerProcess(pid, {
      execFile: () => assert.fail('Invalid PID reached the native helper'),
    }), false);
  }
});

test('native fixture failures retain only a bounded condition and fixed native result', () => {
  const fixture = readFileSync(new URL('./native/ServerVerifierTests.h', import.meta.url), 'utf8');
  const driver = readFileSync(new URL('./native/StartupTests.cpp', import.meta.url), 'utf8');
  assert.match(fixture, /class FixtureFailure : public std::runtime_error/);
  assert.match(fixture, /value\.find_first_not_of\("abcdefghijklmnopqrstuvwxyz0123456789-"/);
  assert.match(fixture, /throw FixtureFailure\("server-verifier\/owned-fixture", result\)/);
  assert.match(driver, /return "native-verifier-fixture-failed"/);
  assert.match(driver, /DIAG native-verifier-fixture condition=/);
  assert.match(driver, /recap::ownership::record\(verifier->result\)/);
  assert.match(driver, /privateFailure\.condition == "unknown"/);
  assert.doesNotMatch(driver, /report << .*verifier->what\(\)/);
});

test('native verifier protocol preserves true false and unknown without claiming PowerShell bitness', () => {
  for (const helperBits of [32, 64]) {
    for (const entry of [
      { owned: true, stage: 'complete', reason: 'ok', code: 0 },
      { owned: false, stage: 'ip-owner', reason: 'not-owned', code: 0 },
      { owned: false, stage: 'identity', reason: 'mismatch', code: 0 },
      { owned: null, stage: 'wmi', reason: 'native-return', code: -2147024891 },
      { owned: null, stage: 'wmi', reason: 'timeout', code: 262148 },
      { owned: null, stage: 'identity', reason: 'missing', code: 1067 },
      { owned: null, stage: 'ip-query', reason: 'invalid-buffer', code: 13 },
    ]) {
      const facts = [];
      assert.equal(verifyServerProcess(41, {
        execFile: () => wire({ ...entry, helperBits }),
        onDiagnostic: (fact) => facts.push(fact),
      }), entry.owned);
      assert.equal(facts[0], null);
      if (entry.owned === true) {
        assert.equal(facts.length, 1);
      } else {
        assert.equal(facts.length, 2);
        assert.deepEqual(
          [facts[1].stage, facts[1].reason, facts[1].code, facts[1].exit, facts[1].ps64, facts[1].language],
          [entry.stage, entry.reason, entry.code, 0, -1, 'Unknown'],
        );
      }
    }
  }
});

test('native verifier rejects noncanonical, partial, extra and contradictory records', () => {
  const valid = wire();
  for (const raw of [
    '', 'null\n', '[]\n', 'true\n', 'private-message',
    valid.slice(0, -1), valid + '\n', valid.replaceAll('\n', '\r\n'),
    ' ' + valid, '\ufeff' + valid, valid + 'private-path',
    valid.replace('"owned":true', '"owned":false,"owned":true'),
    valid.replace('"code":0', '"code":0e0'), valid.replace('"code":0', '"code":-0'),
    wire({ schema: 'RCPV1' }), wire({ owned: 'true' }), wire({ helperBits: 128 }),
    wire({ helperBits: '64' }), wire({ code: 1 }), wire({ code: null }),
    wire({ stage: 'identity' }), wire({ reason: 'mismatch' }),
    wire({ extra: 'private-path' }), wire({ ExecutablePath: 'private-path' }),
    wire({ owned: false, stage: 'wmi', reason: 'missing' }),
    wire({ owned: null, stage: 'complete' }), wire({ owned: null, reason: 'ok' }),
    wire({ owned: null, stage: 'private-stage', reason: 'exception' }),
    wire({ owned: null, stage: 'wmi', reason: 'exception', code: 4294967296 }),
    wire({ owned: null, stage: 'wmi', reason: 'exception', code: -2147483649 }),
    'x'.repeat(257),
  ]) {
    assert.equal(parseNativeVerifierRecord(raw), null);
    let fact;
    assert.equal(verifyServerProcess(41, {
      execFile: () => raw, onDiagnostic: (value) => { fact = value; },
    }), null);
    assert.equal(fact.reason, 'invalid-response');
    assert.doesNotMatch(verificationDiagnosticLine(fact), /private|RCPV1/);
  }
});

test('native verifier crashes and timeouts never accept even a complete owned record', () => {
  for (const properties of [
    { code: 'ETIMEDOUT', status: null, expected: 'timeout' },
    { code: 'ENOENT', errno: -4058, status: null, expected: 'spawn' },
    { status: 1, expected: 'exception' },
    { status: 3221225477, expected: 'exception' },
  ]) {
    let fact;
    assert.equal(verifyServerProcess(41, {
      execFile: () => {
        throw Object.assign(new Error('private-path private-command'), properties, {
          stdout: wire(), stderr: 'private-message',
        });
      },
      onDiagnostic: (value) => { fact = value; },
    }), null);
    assert.equal(fact.stage, 'process');
    assert.equal(fact.reason, properties.expected);
    assert.equal(fact.ps64, -1);
    assert.equal(fact.language, 'Unknown');
    assert.doesNotMatch(verificationDiagnosticLine(fact), /private/);
  }
  for (const thrown of [null, undefined]) {
    assert.equal(verifyServerProcess(41, { execFile: () => { throw thrown; } }), null);
  }
});

test('native verifier bridge enforces the real eight-second process deadline despite successful early output', (t) => {
  let fact;
  let timedOut = false;
  const started = performance.now();
  assert.equal(verifyServerProcess(41, {
    onDiagnostic: (value) => { fact = value; },
    execFile: (_file, _args, options) => {
      assert.equal(options.timeout, 8000);
      try {
        return execFileSync(process.execPath, [
          '-e', `process.stdout.write(${JSON.stringify(wire())}); setTimeout(() => {}, 10000);`,
        ], options);
      } catch (error) {
        timedOut = error.code === 'ETIMEDOUT';
        assert.equal(error.stdout, wire());
        throw error;
      }
    },
  }), null);
  assert.equal(timedOut, true);
  assert.equal(fact.reason, 'timeout');
  assert.equal(fact.ps64, -1);
  t.diagnostic(JSON.stringify({ milliseconds: performance.now() - started, diagnostic: fact }));
});

test('native verifier sources use direct APIs and production fixtures rather than a managed fallback', () => {
  assert.equal(existsSync(new URL('../packaging/windows/VerifyServer.ps1', import.meta.url)), false);
  const source = readFileSync(new URL('../packaging/windows/native/ServerVerifier.cpp', import.meta.url), 'utf8');
  const core = readFileSync(new URL('../packaging/windows/native/ServerOwnership.h', import.meta.url), 'utf8');
  const fixture = readFileSync(new URL('./native/ServerVerifierTests.h', import.meta.url), 'utf8');
  assert.match(source, /int WINAPI wWinMain/);
  assert.match(source, /WriteFile\(output/);
  assert.match(source, /count != 2 \|\| !parsePid/);
  assert.doesNotMatch(source + core, /powershell|Get-CimInstance|ScriptBlock|MessageBox|CreateWindow|AllocConsole/i);
  for (const symbol of ['GetExtendedTcpTable', 'QueryFullProcessImageNameW', 'GetProcessTimes',
    'WBEM_FLAG_FORWARD_ONLY', 'WBEM_FLAG_RETURN_IMMEDIATELY', 'CommandLineToArgvW']) {
    assert.ok(core.includes(symbol));
  }
  assert.match(core, /offsetof\(MIB_TCPTABLE_OWNER_PID, table\)/);
  assert.match(core, /Next\(static_cast<long>\(remaining\), 2/);
  assert.match(fixture, /inline void run\(const std::wstring& nodeRuntime, const std::filesystem::path& scratchDirectory\)/);
  assert.match(fixture, /server\.listen\(0,'127\.0\.0\.1'/);
  assert.match(fixture, /JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE/);
  assert.match(fixture, /api\.changedCreation = mode == 2/);
});

function health() {
  return {
    status: 204,
    headers: new Map([
      ['X-Recap-Page-Server', '1'], ['X-Recap-Page-Generation', 'fixture'], ['X-Recap-Page-Process', '41'],
    ]),
  };
}

test('native verification diagnostics reach failed GUI frames without stale or private facts', async () => {
  const diagnostic = { stage: 'wmi', reason: 'native-return', exit: 0, code: -2147024891, elapsed: 80, node64: 1, ps64: -1, language: 'Unknown' };
  const candidate = await probeServer('fixture', {
    fetchImpl: async () => health(),
    verifyProcess: (_pid, { onDiagnostic }) => { onDiagnostic({ ...diagnostic, private: 'private-path' }); return null; },
  });
  assert.deepEqual(candidate, { status: 'verifying', processId: 41, diagnostic });
  const result = await coordinateLaunch({
    exists: () => true, generation: 'fixture', probe: async () => candidate, readyTimeoutMs: 0, now: () => 0,
  });
  assert.equal(result.lines[0], 'Recap Page answered, but Windows could not verify its server process.');
  assert.equal(result.lines.at(-1), verificationDiagnosticLine(diagnostic));
  const frame = encodeGuiResult(result);
  assert.equal(frame.exitCode, 1);
  assert.ok(frame.frame.subarray(12).toString('utf8').endsWith(verificationDiagnosticLine(diagnostic)));
  assert.doesNotMatch(frame.frame.subarray(12).toString('utf8'), /private/);
  assert.deepEqual(await probeServer('fixture', {
    fetchImpl: async () => health(), verifyProcess: () => null,
  }), { status: 'verifying', processId: 41 });
  assert.deepEqual(await probeServer('fixture', {
    fetchImpl: async () => health(),
    verifyProcess: (_pid, { onDiagnostic }) => { onDiagnostic(diagnostic); return true; },
  }), { status: 'ready', processId: 41 });
  let clock = 0;
  let attempt = 0;
  const retried = await coordinateLaunch({
    exists: () => true, generation: 'fixture', readyTimeoutMs: 2, now: () => clock++, sleep: async () => {},
    probe: async () => ++attempt === 1 ? candidate : { status: 'verifying', processId: 41 },
  });
  assert.equal(retried.lines.length, 2);
});

test('native verification facts cannot claim PowerShell language or pointer width', () => {
  const base = { stage: 'process', reason: 'timeout', exit: -1, code: -1, elapsed: 8000, node64: 1, ps64: -1, language: 'Unknown' };
  assert.equal(verificationDiagnosticLine(base),
    'Verification diagnostic: stage=process reason=timeout exit=-1 code=-1 elapsed=8000 node64=1 ps64=-1 language=Unknown');
  for (const invalid of [
    { ...base, ps64: 1 }, { ...base, language: 'FullLanguage' }, { ...base, stage: 'loader' },
    { ...base, reason: 'private-message' }, { ...base, exit: Infinity },
    { ...base, code: 4294967296 }, { ...base, elapsed: -1 },
  ]) assert.equal(verificationDiagnosticLine(invalid), null);
});
