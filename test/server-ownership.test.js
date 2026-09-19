import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SERVER_OWNERSHIP_HELPER, serverOwnershipCommand, verifyServerProcess,
  probeServer, coordinateLaunch, encodeGuiResult, verificationDiagnosticLine,
} from '../packaging/windows/Launcher.mjs';

const windowsOnly = { skip: process.platform !== 'win32' };
const helperSource = readFileSync(SERVER_OWNERSHIP_HELPER, 'utf8').replaceAll('\r\n', '\n');
const identity = {
  executable: 'C:\\Package\\runtime\\node.exe',
  server: 'C:\\Package\\server.mjs',
};

function generatedScript(processId = 41) {
  let script;
  verifyServerProcess(processId, {
    execFile: (_file, args) => {
      script = args[3];
      return '';
    },
  });
  assert.equal(typeof script, 'string');
  return script;
}

function replaceOnce(source, before, after) {
  assert.equal(source.split(before).length, 2, `Expected one occurrence of ${before}`);
  return source.replace(before, after);
}

function generatedSetup() {
  const script = helperSource;
  const end = script.indexOf('if (Test-RecapServerOwner $recapProcessId) {');
  assert.ok(end > 0, 'The production verifier must contain the IP Helper implementation');
  return script.slice(script.indexOf("$ErrorActionPreference = 'Stop'"), end);
}

function runFixture(source, harness) {
  return execFileSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `${source}\n${harness}\n} catch { throw }`,
  ], { encoding: 'utf8', timeout: 8000, windowsHide: true, stdio: 'pipe' }).trim();
}

test('ownership loader has one PID and an exactly quoted packaged helper path', () => {
  assert.equal(SERVER_OWNERSHIP_HELPER, fileURLToPath(new URL('../packaging/windows/VerifyServer.ps1', import.meta.url)));
  for (const processId of [1, 41, 123456789, 0xffffffff]) {
    assert.equal(generatedScript(processId), serverOwnershipCommand(processId));
  }
  assert.equal(generatedScript(123456789).match(/123456789/g).length, 1);
  assert.equal(serverOwnershipCommand(41, "C:\\Program Files\\Owner's\\VerifyServer.ps1"),
    "try { Write-Output ('RCPV1 language '+$ExecutionContext.SessionState.LanguageMode); Write-Output 'RCPV1 loader enter 0 -1'; & ([ScriptBlock]::Create([IO.File]::ReadAllText('C:\\Program Files\\Owner''s\\VerifyServer.ps1'))) -recapProcessId 41 } catch { Write-Output 'RCPV1 loader exception -1 -1'; exit 1 }");
  assert.doesNotMatch(generatedScript(), /[\r\n]|ExecutionPolicy|Bypass|Get-CimInstance|Get-WmiObject/);
  assert.doesNotMatch(helperSource.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n'),
    /Get-NetTCPConnection|Get-CimInstance|Get-WmiObject|Add-Type|CodeDom|csc\.exe/);
  assert.match(helperSource, /SELECT ExecutablePath, CommandLine FROM Win32_Process WHERE ProcessId = \$recapProcessId/);
});

test('native ownership matcher binds the exact loader, packaged path and bounded PID', () => {
  const observer = readFileSync(new URL('./native/StartupObserver.h', import.meta.url), 'utf8');
  const literal = (name) => {
    const match = observer.match(new RegExp(`${name}\\[\\] = LR"OWN\\(([\\s\\S]*?)\\)OWN";`));
    assert.ok(match, `${name} must exist`);
    return match[1];
  };
  for (const path of ['C:\\Package\\VerifyServer.ps1', "C:\\Program Files\\Owner's\\VerifyServer.ps1"]) {
    for (const pid of [1, 41, 0xffffffff]) {
      assert.equal(literal('ServerVerifierPrefix') + path.replaceAll("'", "''")
        + literal('ServerVerifierMiddle') + pid + literal('ServerVerifierSuffix'),
      serverOwnershipCommand(pid, path));
    }
  }
  assert.match(observer, /std::stoull\(pid\) > MAXDWORD/);
  assert.match(observer, /layout \+ L"\\\\VerifyServer\.ps1"/);
  assert.match(observer, /path\.size\(\) == expected\.size\(\)/);
  assert.match(observer, /CompareStringOrdinal/);
  assert.match(observer, /args\[3\] == L"-Command" && serverVerifierScript\(args\[4\], layout\)/);
  const native = readFileSync(new URL('./native/StartupTests.cpp', import.meta.url), 'utf8');
  assert.match(native, /void installed\([^\n]+\) \{\s+serverVerifierCases\(\);/);
  assert.match(native, /foreign verifier helper was recognized/);
  assert.match(native, /native verifier argument roundtrip differed/);
});

test('ownership rejects invalid PIDs before creating any verifier command', () => {
  for (const processId of [0, -1, 1.5, NaN, Infinity, 0x100000000, '41', '41; exit 0', null, undefined]) {
    assert.equal(verifyServerProcess(processId, {
      execFile: () => assert.fail('Invalid PID reached PowerShell'),
    }), false);
    assert.throws(() => serverOwnershipCommand(processId), RangeError);
  }
  assert.match(generatedScript(0xffffffff), / -recapProcessId 4294967295 } catch/);
});

test('ownership preserves exact executable, server command, empty and unknown result handling', () => {
  const valid = {
    ExecutablePath: identity.executable.toUpperCase(),
    CommandLine: `"${identity.executable}" "${identity.server}"`,
  };
  for (const [candidate, expected] of [
    [valid, true],
    [{ ...valid, ExecutablePath: 'C:\\Other\\node.exe' }, false],
    [{ ...valid, CommandLine: '"C:\\Package\\runtime\\node.exe" C:\\Other\\server.mjs' }, false],
  ]) {
    assert.equal(verifyServerProcess(41, {
      ...identity, execFile: () => JSON.stringify(candidate),
    }), expected);
  }
  assert.equal(verifyServerProcess(41, { execFile: () => '' }), false);
  assert.equal(verifyServerProcess(41, { execFile: () => 'not JSON' }), null);
  assert.equal(verifyServerProcess(41, { execFile: () => { throw new Error('API failure'); } }), null);
});

test('whole ownership loader executes its helper within eight seconds on an owned ephemeral listener', windowsOnly, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "recap-owner's-"));
  const helper = join(directory, 'VerifyServer.ps1');
  const listener = createServer();
  try {
    await new Promise((resolve, reject) => {
      listener.once('error', reject);
      listener.listen(0, '127.0.0.1', resolve);
    });
    const { port } = listener.address();
    const fixtureSource = replaceOnce(helperSource, '$serverPort = 8787', `$serverPort = ${port}`);
    for (const fixture of [
      { id: 1, expected: true },
      { id: 2, expected: false, processId: process.pid + 1, stage: 'ip-owner', reason: 'not-owned', code: 0 },
      { id: 3, expected: false, executable: 'C:\\owned-fixture\\wrong.exe', stage: 'identity', reason: 'mismatch' },
      { id: 4, expected: false, server: '__not_this_owned_fixture__.mjs', stage: 'identity', reason: 'mismatch' },
      { id: 5, expected: null, nativeError: true, stage: 'ip-size', reason: 'native-return', code: 5 },
      { id: 6, expected: null, wmiError: true, stage: 'wmi', reason: 'exception' },
      { id: 7, expected: null, timeout: true, stage: 'wmi', reason: 'timeout', code: -1 },
      { id: 8, expected: null, missingHelper: true, stage: 'loader', reason: 'exception' },
      { id: 9, expected: null, invalidParameter: true, stage: 'loader', reason: 'exception' },
      { id: 10, expected: null, interopError: true, stage: 'interop', reason: 'exception' },
      { id: 11, expected: null, queryError: true, stage: 'ip-query', reason: 'native-return', code: 87 },
      { id: 12, expected: null, decodeError: true, stage: 'ip-decode', reason: 'invalid-buffer', code: -1 },
      { id: 13, expected: null, constrained: true, stage: 'loader', reason: 'exception', code: -1 },
    ]) {
      let source = fixtureSource;
      if (fixture.nativeError) {
        source = replaceOnce(source,
          '$result = $nativeType::GetExtendedTcpTable([IntPtr]::Zero, [ref]$size, 0, 2, 3, 0)',
          '$result = [uint32]5');
      }
      if (fixture.wmiError) source = replaceOnce(source, 'FROM Win32_Process WHERE', 'FROM RecapOwnedMissingClass WHERE');
      if (fixture.timeout) source = replaceOnce(source, '$rows = $searcher.Get()', 'Start-Sleep -Seconds 10\n      $rows = $searcher.Get()');
      if (fixture.interopError) source = replaceOnce(source, '  $assembly = ', "  throw 'private-fixture-message'\n  $assembly = ");
      if (fixture.queryError) {
        source = replaceOnce(source,
          '$result = $nativeType::GetExtendedTcpTable($buffer, [ref]$size, 0, 2, 3, 0)',
          '$result = [uint32]87');
      }
      if (fixture.decodeError) source = replaceOnce(source,
        'return (Test-RecapListener $buffer $size $ownerId)', 'return (Test-RecapListener $buffer 0 $ownerId)');
      writeFileSync(helper, source);
      const ownerId = fixture.processId ?? process.pid;
      let timedOut = false;
      let exitCode = 0;
      let stderr = '';
      let stdout = '';
      let pointerBytes = -1;
      const diagnostics = [];
      const start = performance.now();
      const actual = verifyServerProcess(ownerId, {
        executable: fixture.executable ?? process.execPath,
        server: fixture.server ?? 'server-ownership.test.js',
        onDiagnostic: (fact) => diagnostics.push(fact),
        execFile: (file, args, options) => {
          assert.equal(args[3], serverOwnershipCommand(ownerId));
          assert.equal(options.timeout, 8000);
          assert.equal(options.stdio, 'pipe');
          let command = serverOwnershipCommand(ownerId, fixture.missingHelper ? join(directory, 'missing.ps1') : helper);
          if (fixture.invalidParameter) command = command.replace(/ -recapProcessId \d+(?= } catch)/, ' -recapProcessId 0');
          if (fixture.constrained) command = "$ExecutionContext.SessionState.LanguageMode = 'ConstrainedLanguage'; " + command;
          try {
            const raw = execFileSync(file, [...args.slice(0, 3), command], {
              ...options, stdio: ['pipe', 'pipe', 'pipe'],
            });
            stdout = raw;
            const payload = raw.trimEnd().split(/\r?\n/).at(-1);
            if (payload.startsWith('{')) pointerBytes = JSON.parse(payload).VerifierPointerBytes ?? -1;
            return raw;
          } catch (error) {
            timedOut = error.code === 'ETIMEDOUT';
            exitCode = error.status ?? -1;
            stderr = String(error.stderr ?? '');
            stdout = String(error.stdout ?? '');
            throw error;
          }
        },
      });
      const diagnostic = diagnostics.at(-1);
      t.diagnostic(JSON.stringify({ case: fixture.id, milliseconds: performance.now() - start, timedOut: Number(timedOut), exitCode, pointerBytes, stdoutBytes: Buffer.byteLength(stdout), stderrBytes: Buffer.byteLength(stderr), diagnostic }));
      assert.equal(actual, fixture.expected, `Whole-loader case ${fixture.id}`);
      assert.equal(timedOut, !!fixture.timeout, `Timeout classification for case ${fixture.id}`);
      assert.equal(diagnostics[0], null);
      if (fixture.expected === true) {
        assert.equal(diagnostics.length, 1);
        assert.ok([4, 8].includes(pointerBytes));
      } else {
        assert.equal(diagnostics.length, 2);
        assert.equal(diagnostic.stage, fixture.stage);
        assert.equal(diagnostic.reason, fixture.reason);
        assert.equal(diagnostic.language, fixture.constrained ? 'ConstrainedLanguage' : 'FullLanguage');
        assert.ok(verificationDiagnosticLine(diagnostic));
        assert.equal(diagnostic.ps64 === -1, fixture.stage === 'loader');
        if (fixture.code !== undefined) assert.equal(diagnostic.code, fixture.code);
        if (fixture.reason === 'exception') assert.ok(diagnostic.code < 0);
      }
      if (fixture.expected === null && !fixture.timeout) {
        assert.equal(exitCode, 1);
      }
      if (fixture.expected === null) {
        assert.ok(Buffer.byteLength(stderr) < 1024);
        const packets = stderr.trimEnd().split(/\r?\n/).filter(Boolean);
        assert.ok(packets.length <= 7);
        for (const packet of packets) assert.match(packet, /^RCPV1 [a-z-]+ [a-z-]+ -?\d+ (?:-1|4|8)$/);
        if (fixture.timeout) assert.match(packets.at(-1), /^RCPV1 wmi enter 0 [48]$/);
        assert.doesNotMatch(stderr, /private-fixture|VerifyServer\.ps1|Win32_Process/);
      }
      const outputFrames = stdout.trimEnd().split(/\r?\n/).filter((line) => line.startsWith('RCPV1 '));
      assert.equal(outputFrames[0], `RCPV1 language ${fixture.constrained ? 'ConstrainedLanguage' : 'FullLanguage'}`);
      assert.equal(outputFrames[1], 'RCPV1 loader enter 0 -1');
      assert.ok(Buffer.byteLength(outputFrames.join('\n')) < 1024);
      if (fixture.constrained) {
        assert.equal(stderr.length, 0);
        assert.deepEqual(outputFrames, [
          'RCPV1 language ConstrainedLanguage', 'RCPV1 loader enter 0 -1', 'RCPV1 loader exception -1 -1',
        ]);
      }
    }
  } finally {
    if (listener.listening) {
      await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
    }
    rmSync(directory, { recursive: true, force: true });
  }
});

test('verification diagnostics classify process failures and reject noncanonical or private packets', () => {
  const directory = mkdtempSync(join(tmpdir(), 'recap-spawn-witness-'));
  try {
    let fact;
    assert.equal(verifyServerProcess(41, {
      onDiagnostic: (value) => { fact = value; },
      execFile: (_file, args, options) => execFileSync(join(directory, 'missing.exe'), args, options),
    }), null);
    assert.deepEqual([fact.stage, fact.reason, fact.exit, fact.ps64], ['process', 'spawn', -1, -1]);
    assert.ok(Number.isInteger(fact.code));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  for (const thrown of [null, undefined]) {
    let fact;
    assert.equal(verifyServerProcess(41, {
      onDiagnostic: (value) => { fact = value; },
      execFile: () => { throw thrown; },
    }), null);
    assert.equal(fact.reason, 'exception');
  }
  const cases = [
    [{ code: 'ENOENT', errno: -4058, stderr: 'private-path' }, 'process', 'spawn', -4058, -1],
    [{ code: 'ETIMEDOUT', stderr: 'private-message' }, 'process', 'timeout', -1, -1],
    [{ status: 1, stderr: Buffer.from('RCPV1 wmi exception -2147217392 8\r\n') }, 'wmi', 'exception', -2147217392, 1],
    [{ status: 1, stderr: 'RCPV1 loader enter 0 -1\nRCPV1 loader exception -1 -1\n' }, 'loader', 'exception', -1, -1],
  ];
  for (const [properties, stage, reason, code, ps64] of cases) {
    const facts = [];
    assert.equal(verifyServerProcess(41, {
      onDiagnostic: (fact) => facts.push(fact),
      execFile: () => { throw Object.assign(new Error('private-message'), properties); },
    }), null);
    assert.equal(facts[0], null);
    const fact = facts[1];
    assert.deepEqual([fact.stage, fact.reason, fact.code, fact.ps64], [stage, reason, code, ps64]);
    assert.doesNotMatch(verificationDiagnosticLine(fact), /private/);
  }
  for (const stderr of [
    'private-path', 'RCPV1 private exception -1 8', 'RCPV1 wmi private -1 8',
    'RCPV1 wmi exception +1 8', 'RCPV1 wmi exception -0 8',
    'RCPV1 wmi exception 01 8', 'RCPV1 wmi exception 4294967296 8',
    'RCPV1 wmi exception -2147483649 8', 'RCPV1 wmi exception -1 16',
    'RCPV1 wmi exception -1 8\nprivate-path', 'RCPV1 wmi exception -1 8\n\n',
    'RCPV1 wmi exception -1 8\nRCPV1 loader exception -1 8', 'x'.repeat(129),
    'RCPV1 wmi exception -1 -1', 'RCPV1 loader exception 5 -1', 'RCPV1 loader mismatch -1 -1',
  ]) {
    let fact;
    assert.equal(verifyServerProcess(41, {
      onDiagnostic: (value) => { fact = value; },
      execFile: () => { throw Object.assign(new Error('private-message'), { status: 1, stderr }); },
    }), null);
    assert.deepEqual([fact.stage, fact.reason, fact.code, fact.ps64], ['process', 'invalid-response', -1, -1]);
    assert.doesNotMatch(verificationDiagnosticLine(fact), /private|RCPV1/);
  }
});

test('verification diagnostics clear per attempt and never attach to successful verification', () => {
  let fact;
  const options = { ...identity, onDiagnostic: (value) => { fact = value; } };
  assert.equal(verifyServerProcess(41, { ...options, execFile: () => 'private invalid JSON' }), null);
  assert.equal(fact.reason, 'invalid-response');
  assert.equal(verifyServerProcess(41, {
    ...options,
    execFile: () => JSON.stringify({ ExecutablePath: identity.executable, CommandLine: identity.server, VerifierPointerBytes: 8 }),
  }), true);
  assert.equal(fact, null);
  assert.equal(verifyServerProcess(41, { ...options, execFile: () => '' }), false);
  assert.deepEqual([fact.stage, fact.reason, fact.ps64], ['identity', 'missing', -1]);
});

test('verification diagnostics retain the last entered phase on timeout within bounded transcripts', () => {
  const diagnose = (stderr) => {
    let fact;
    assert.equal(verifyServerProcess(41, {
      onDiagnostic: (value) => { fact = value; },
      execFile: () => { throw Object.assign(new Error('private-message'), { code: 'ETIMEDOUT', stderr }); },
    }), null);
    assert.equal(fact.reason, 'timeout');
    assert.equal(fact.code, -1);
    assert.doesNotMatch(verificationDiagnosticLine(fact), /private|enter/);
    return fact;
  };
  const stages = ['loader', 'interop', 'ip-size', 'ip-query', 'ip-decode', 'wmi'];
  const entries = stages.map((stage) => `RCPV1 ${stage} enter 0 8`);
  for (const [index, stage] of stages.entries()) {
    const fact = diagnose(entries.slice(0, index + 1).join('\r\n') + '\r\n');
    assert.deepEqual([fact.stage, fact.ps64], [stage, 1]);
    assert.equal(verificationDiagnosticLine({ ...fact, reason: 'enter' }), null);
  }
  assert.equal(diagnose('RCPV1 loader enter 0 4\n').ps64, 0);
  assert.deepEqual(
    [diagnose('RCPV1 loader enter 0 -1\n').stage, diagnose('RCPV1 loader enter 0 -1\n').ps64],
    ['loader', -1],
  );
  assert.equal(diagnose(entries.slice(0, 5).join('\n') + '\nRCPV1 wmi ent').stage, 'ip-decode');
  assert.equal(diagnose(entries.join('\n') + '\nprivate-path').stage, 'wmi');
  assert.equal(diagnose(entries.join('\n') + '\nRCPV1 wmi exception -1 8\n').stage, 'wmi');
  for (const invalid of [
    '', 'private-path', 'RCPV1 private enter 0 8\n', 'RCPV1 wmi enter 5 8\n',
    'RCPV1 wmi enter 0 16\n', 'RCPV1 wmi enter 0 -1\n', 'RCPV1 wmi exception -1 8\n', 'RCPV1 wmi enter 0 8\r',
    entries.join('\n') + '\n' + 'x'.repeat(1024),
    Buffer.from('RCPV1 wmi enter 0 8\n' + 'x'.repeat(1024)),
    Array(8).fill('RCPV1 wmi enter 0 8').join('\n'),
  ]) {
    const fact = diagnose(invalid);
    assert.deepEqual([fact.stage, fact.ps64], ['process', -1]);
  }
});

test('verification stdout frames report only allowlisted language modes and cannot turn errors into success', () => {
  const candidate = JSON.stringify({ ExecutablePath: identity.executable, CommandLine: identity.server });
  const mode = 'RCPV1 language FullLanguage\n';
  const entry = 'RCPV1 loader enter 0 -1\n';
  let fact;
  const options = { ...identity, onDiagnostic: (value) => { fact = value; } };
  assert.equal(verifyServerProcess(41, { ...options, execFile: () => mode + entry + mode + candidate }), true);
  assert.equal(fact, null);
  for (const language of ['FullLanguage', 'ConstrainedLanguage', 'RestrictedLanguage', 'NoLanguage']) {
    const stdout = `RCPV1 language ${language}\n` + entry + 'RCPV1 loader exception -1 -1\n';
    assert.equal(verifyServerProcess(41, {
      ...options,
      execFile: () => { throw Object.assign(new Error('private-message'), { status: 1, stdout, stderr: 'private-path' }); },
    }), null);
    assert.deepEqual([fact.stage, fact.reason, fact.language], ['loader', 'exception', language]);
    assert.doesNotMatch(verificationDiagnosticLine(fact), /private/);
  }
  for (const stdout of [
    mode + entry,
    mode + entry + 'RCPV1 loader exception -1 -1\n' + candidate,
    'RCPV1 language private-mode\n' + candidate,
    mode + entry + 'private-message\n' + candidate,
    candidate + '\n' + mode,
    mode.repeat(3) + candidate,
    mode + entry.repeat(4) + candidate,
    'RCPV1 language FullLanguage' + candidate,
  ]) {
    assert.equal(verifyServerProcess(41, { ...options, execFile: () => stdout }), null);
    assert.doesNotMatch(verificationDiagnosticLine(fact), /private/);
  }
  assert.equal(verifyServerProcess(41, {
    ...options,
    execFile: () => { throw Object.assign(new Error('private-message'), {
      code: 'ETIMEDOUT', stdout: 'RCPV1 language ConstrainedLanguage\n' + entry, stderr: '',
    }); },
  }), null);
  assert.deepEqual([fact.stage, fact.reason, fact.ps64, fact.language], ['loader', 'timeout', -1, 'ConstrainedLanguage']);
  assert.equal(verifyServerProcess(41, {
    ...options,
    execFile: () => { throw Object.assign(new Error('private-message'), {
      code: 'ETIMEDOUT', stdout: mode + entry, stderr: 'RCPV1 wmi enter 0 8\n',
    }); },
  }), null);
  assert.deepEqual([fact.stage, fact.reason, fact.ps64, fact.language], ['wmi', 'timeout', 1, 'FullLanguage']);
  assert.equal(verifyServerProcess(41, { ...options, execFile: () => '' }), false);
  assert.equal(fact.language, 'Unknown');
});

function diagnosticHealth() {
  return {
    status: 204,
    headers: new Map([
      ['X-Recap-Page-Server', '1'], ['X-Recap-Page-Generation', 'fixture'],
      ['X-Recap-Page-Process', '41'],
    ]),
  };
}

test('verification diagnostics reach only failed GUI frames and do not survive later attempts', async () => {
  const diagnostic = { stage: 'process', reason: 'timeout', exit: -1, code: -1, elapsed: 8020, node64: 1, ps64: -1, language: 'Unknown' };
  const expected = 'Verification diagnostic: stage=process reason=timeout exit=-1 code=-1 elapsed=8020 node64=1 ps64=-1 language=Unknown';
  const probe = (result, value = diagnostic) => probeServer('fixture', {
    fetchImpl: async () => diagnosticHealth(),
    verifyProcess: (_pid, { onDiagnostic }) => {
      if (value !== undefined) onDiagnostic({ ...value, private: 'private-marker' });
      return result;
    },
  });
  const candidate = await probe(null);
  assert.deepEqual(candidate, { status: 'verifying', processId: 41, diagnostic });
  const result = await coordinateLaunch({
    exists: () => true, generation: 'fixture', probe: async () => candidate,
    readyTimeoutMs: 0, now: () => 0,
  });
  assert.equal(result.lines[0], 'Recap Page answered, but Windows could not verify its server process.');
  assert.equal(result.lines.at(-1), expected);
  const encoded = encodeGuiResult(result);
  assert.equal(encoded.exitCode, 1);
  assert.ok(encoded.frame.subarray(12).toString('utf8').endsWith(expected));
  assert.doesNotMatch(encoded.frame.subarray(12).toString('utf8'), /private-marker/);
  assert.deepEqual(await probe(true), { status: 'ready', processId: 41 });
  assert.deepEqual(await probeServer('fixture', {
    fetchImpl: async () => diagnosticHealth(), verifyProcess: () => null,
  }), { status: 'verifying', processId: 41 });
  for (const bad of [
    { ...diagnostic, stage: 'private-marker' }, { ...diagnostic, reason: 'timeout\nprivate-marker' },
    { ...diagnostic, exit: Infinity }, { ...diagnostic, code: 0x100000000 },
    { ...diagnostic, elapsed: -1 }, { ...diagnostic, node64: 2 }, { ...diagnostic, ps64: '1' },
    { ...diagnostic, language: 'private-mode' },
  ]) {
    assert.equal(verificationDiagnosticLine(bad), null);
    assert.deepEqual(await probe(null, bad), { status: 'verifying', processId: 41 });
  }
  let attempt = 0;
  let clock = 0;
  const retried = await coordinateLaunch({
    exists: () => true, generation: 'fixture', readyTimeoutMs: 2, now: () => clock++,
    sleep: async () => {},
    probe: async () => ++attempt === 1 ? candidate : { status: 'verifying', processId: 41 },
  });
  assert.equal(retried.lines.length, 2);
});

test('verification diagnostics cover foreign and post-spawn failure paths without adding success lines', async () => {
  const diagnostic = { stage: 'wmi', reason: 'exception', exit: 1, code: -2147217392, elapsed: 90, node64: 1, ps64: 1 };
  const foreign = await coordinateLaunch({
    exists: () => true, generation: 'fixture',
    probe: async () => ({ status: 'foreign', diagnostic }),
  });
  assert.equal(foreign.lines[0], 'Port 8787 is already in use.');
  assert.equal(foreign.lines.at(-1), verificationDiagnosticLine(diagnostic));
  for (const ownsChild of [false, true]) {
    let call = 0;
    let clock = 0;
    const result = await coordinateLaunch({
      exists: () => true, generation: 'fixture', readyTimeoutMs: 2, now: () => clock++,
      portOccupied: async () => false, openBrowser: async () => {},
      startServer: () => ({ pid: 42, exitCode: 0, once() {}, unref() {} }),
      probe: async () => ++call === 1
        ? { status: 'unreachable' }
        : { status: 'verifying', processId: ownsChild ? 42 : 41, diagnostic },
    });
    if (ownsChild) {
      assert.equal(result.status, 'opened');
      assert.equal(Object.hasOwn(result, 'lines'), false);
      assert.equal(encodeGuiResult(result).frame.length, 12);
    } else {
      assert.equal(result.lines.at(-1), verificationDiagnosticLine(diagnostic));
    }
  }
});

test('generated IP Helper decoder binds listener state, address, port and PID within buffer bounds', windowsOnly, () => {
  const result = runFixture(generatedSetup(), `
$checks = 0
function Assert-Fixture([bool]$condition) {
  if (-not $condition) { throw "Decoder assertion failed: $script:checks" }
  $script:checks++
}
function Assert-Invalid([IntPtr]$buffer, [uint32]$size) {
  $failed = $false
  try { [void](Test-RecapListener $buffer $size 41) } catch { $failed = $true }
  Assert-Fixture $failed
}
function Write-Row([IntPtr]$buffer, [int]$offset, [uint32[]]$values) {
  for ($i = 0; $i -lt $values.Length; $i++) {
    $bytes = [BitConverter]::GetBytes($values[$i])
    [Runtime.InteropServices.Marshal]::Copy($bytes, 0, [IntPtr]::Add($buffer, $offset + $i * 4), 4)
  }
}
Assert-Fixture ($rowSize -eq 24)
Assert-Fixture ($rowOffset -eq 4)
Assert-Fixture $assembly.IsDynamic
Assert-Fixture (($nativeType.GetMethod('GetExtendedTcpTable').GetMethodImplementationFlags() -band [Reflection.MethodImplAttributes]::PreserveSig) -ne 0)
$fields = @('State', 'LocalAddress', 'LocalPort', 'RemoteAddress', 'RemotePort', 'OwningPid')
for ($i = 0; $i -lt $fields.Length; $i++) {
  Assert-Fixture ([Runtime.InteropServices.Marshal]::OffsetOf($rowType, $fields[$i]).ToInt32() -eq $i * 4)
}
$buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal(52)
try {
  $good = [uint32[]]@(2, 0x0100007f, 0x5322, 0, 0, 41)
  [Runtime.InteropServices.Marshal]::WriteInt32($buffer, 1)
  Write-Row $buffer 4 $good
  Assert-Fixture (Test-RecapListener $buffer 28 41)
  foreach ($bad in @(@(0, 5), @(1, 0), @(1, 0x7f000001), @(1, 0x0200007f), @(2, 8787), @(2, 0x5422), @(5, 42))) {
    $values = $good.Clone()
    $values[$bad[0]] = $bad[1]
    Write-Row $buffer 4 $values
    Assert-Fixture (-not (Test-RecapListener $buffer 28 41))
  }
  Write-Row $buffer 28 $good
  [Runtime.InteropServices.Marshal]::WriteInt32($buffer, 2)
  Assert-Fixture (Test-RecapListener $buffer 52 41)
  Assert-Invalid $buffer 51
  [Runtime.InteropServices.Marshal]::WriteInt32($buffer, -1)
  Assert-Invalid $buffer 52
  [Runtime.InteropServices.Marshal]::WriteInt32($buffer, 1)
  Assert-Invalid $buffer 4
  Assert-Invalid $buffer 3
  Assert-Invalid $buffer 16777217
  Assert-Invalid ([IntPtr]::Zero) 28
  Write-Row $buffer 4 ([uint32[]]@(2, 0x0100007f, 2882360098, 99, 99, 41))
  Assert-Fixture (Test-RecapListener $buffer 28 41)
  [Runtime.InteropServices.Marshal]::WriteInt32($buffer, 0)
  Assert-Fixture (-not (Test-RecapListener $buffer 4 41))
} finally {
  [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
}
$checks`);
  assert.equal(Number(result), 27);
});

test('generated IP Helper query rejects API failures, oversized allocations and growing tables', windowsOnly, () => {
  let source = generatedSetup();
  for (const buffer of ['[IntPtr]::Zero', '$buffer']) {
    source = replaceOnce(source,
      `$nativeType::GetExtendedTcpTable(${buffer}, [ref]$size, 0, 2, 3, 0)`,
      `Invoke-FixtureTable (${buffer}) ([ref]$size) 0 2 3 0`);
  }
  const result = runFixture(source, `
function Invoke-FixtureTable([IntPtr]$buffer, [ref]$size, $order, $family, $class, $reserved) {
  $script:calls++
  if ($order -ne 0 -or $family -ne 2 -or $class -ne 3 -or $reserved -ne 0) {
    throw 'Wrong IP Helper query contract.'
  }
  if ($buffer -eq [IntPtr]::Zero) {
    if ($size.Value -ne 0) { throw 'Size query must start empty.' }
    $size.Value = [uint32]28
    if ($mode -eq 3) { $size.Value = [uint32]3 }
    if ($mode -eq 4) { $size.Value = [uint32]16777217 }
    if ($mode -eq 1) { return 5 }
    if ($mode -eq 2) { return 0 }
    return 122
  }
  if ($size.Value -ne 28) { throw 'Unexpected allocation.' }
  if ($mode -eq 5 -or $mode -eq 7) { $size.Value = [uint32]52 }
  if ($mode -eq 8) { $size.Value = [uint32]3 }
  if ($mode -eq 5) { return 122 }
  if ($mode -eq 6) { return 5 }
  $count = 0
  if ($mode -eq 9) { $count = 2 }
  [Runtime.InteropServices.Marshal]::WriteInt32($buffer, $count)
  return 0
}
$checks = 0
for ($mode = 0; $mode -le 9; $mode++) {
  $calls = 0
  $failed = $false
  $owned = $false
  try { $owned = Test-RecapServerOwner 41 } catch { $failed = $true }
  if ($owned -or $failed -ne ($mode -ne 0)) { throw "Wrong query outcome: $mode" }
  $expectedCalls = 2
  if ($mode -ge 1 -and $mode -le 4) { $expectedCalls = 1 }
  if ($calls -ne $expectedCalls) { throw "Unexpected query count: $mode" }
  $checks += 2
}
$checks`);
  assert.equal(Number(result), 20);
});
