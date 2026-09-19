import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { readFileSync } from 'node:fs';
import { verifyServerProcess } from '../packaging/windows/Launcher.mjs';

const windowsOnly = { skip: process.platform !== 'win32' };
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
  const script = generatedScript();
  const end = script.indexOf('if (Test-RecapServerOwner $recapProcessId) {');
  assert.ok(end > 0, 'The production verifier must contain the IP Helper implementation');
  return script.slice(0, end);
}

function runFixture(source, harness) {
  return execFileSync('powershell', [
    '-NoProfile', '-NonInteractive', '-Command',
    `${source}\n${harness}\n} catch { throw }`,
  ], { encoding: 'utf8', timeout: 8000, windowsHide: true }).trim();
}

test('ownership script has one PID prefix and an exported invariant body', async () => {
  const { SERVER_OWNERSHIP_SCRIPT_BODY } = await import('../packaging/windows/Launcher.mjs');
  assert.equal(typeof SERVER_OWNERSHIP_SCRIPT_BODY, 'string');
  for (const processId of [1, 41, 123456789, 0xffffffff]) {
    assert.equal(generatedScript(processId), `$recapProcessId = ${processId};\n${SERVER_OWNERSHIP_SCRIPT_BODY}`);
  }
  assert.equal(generatedScript(123456789).match(/123456789/g).length, 1);
  assert.match(SERVER_OWNERSHIP_SCRIPT_BODY, /if \(Test-RecapServerOwner \$recapProcessId\)/);
  assert.match(SERVER_OWNERSHIP_SCRIPT_BODY, /-Filter "ProcessId = \$recapProcessId"/);
  const observer = readFileSync(new URL('./native/StartupObserver.h', import.meta.url), 'utf8');
  const approved = observer.match(/ServerOwnershipBody\[\] = LR"OWN\(([\s\S]*?)\)OWN";/)?.[1];
  assert.equal(approved?.replaceAll('\r\n', '\n'), SERVER_OWNERSHIP_SCRIPT_BODY);
  assert.match(observer, /return script == prefix \+ pid \+ L";\\n" \+ ServerOwnershipBody;/);
  assert.match(observer, /std::stoull\(pid\) > MAXDWORD/);
});

test('ownership rejects invalid PIDs before creating any verifier command', () => {
  for (const processId of [0, -1, 1.5, NaN, Infinity, 0x100000000, '41', '41; exit 0', null, undefined]) {
    assert.equal(verifyServerProcess(processId, {
      execFile: () => assert.fail('Invalid PID reached PowerShell'),
    }), false);
  }
  assert.match(generatedScript(0xffffffff), /^\$recapProcessId = 4294967295;\n/);
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

test('generated ownership verifier works without NetTCPIP or compiler on an owned ephemeral listener', windowsOnly, async () => {
  const listener = createServer();
  await new Promise((resolve, reject) => {
    listener.once('error', reject);
    listener.listen(0, '127.0.0.1', resolve);
  });
  try {
    const { port } = listener.address();
    let observed;
    const invoke = (processId, prefix = '') => verifyServerProcess(processId, {
      executable: process.execPath,
      server: 'server-ownership.test.js',
      execFile: (file, args, options) => {
        // Only the isolated fixture uses an ephemeral port; product input stays fixed.
        const script = args[3].replace('$serverPort = 8787', `$serverPort = ${port}`);
        observed = execFileSync(file, [
          ...args.slice(0, 3),
          "function Get-NetTCPConnection { throw 'NetTCPIP must not load' }\n"
          + "function Add-Type { throw 'Compiler must not start' }\n" + prefix + script,
        ], options);
        return observed;
      },
    });
    assert.equal(invoke(process.pid), true, observed);
    assert.equal(invoke(process.pid + 1, "function Get-CimInstance { throw 'Wrong owner reached CIM' }\n"), false);
    assert.equal(invoke(process.pid, "function Get-CimInstance { throw 'CIM unavailable' }\n"), null);
  } finally {
    await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
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
