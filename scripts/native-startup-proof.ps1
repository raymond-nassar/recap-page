[CmdletBinding()]
param(
  [ValidateSet('x64', 'arm64')]
  [string]$Architecture = 'x64',
  [switch]$Negatives,
  [switch]$Diagnostic,
  [ValidateSet('console-wack', 'handles', 'f01-smoke')]
  [string]$DiagnosticTarget = 'console-wack'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Native startup proof is confined to controlled Windows Actions runners.'
}
if ($Negatives -and $Diagnostic) { throw 'Native proof modes cannot be combined.' }
if ($Diagnostic -and $Architecture -ne 'x64') { throw 'Diagnostic mode is x64 only.' }
if ($DiagnosticTarget -ne 'console-wack' -and -not $Diagnostic) { throw 'A focused target requires diagnostic mode.' }
$root = Split-Path -Parent $PSScriptRoot
& node (Join-Path $root 'scripts\lib\native-launcher.mjs') --verify --proof
if ($LASTEXITCODE -ne 0) { throw 'Native proof inputs did not validate.' }
$scratch = Join-Path $env:RUNNER_TEMP "recap-native-proof-$Architecture-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
if (Test-Path -LiteralPath $scratch) { throw 'The native proof scratch directory already exists.' }
New-Item -ItemType Directory -Path $scratch -ErrorAction Stop | Out-Null
$driver = Join-Path $root "dist\native-proof\$Architecture\NativeStartupTests.exe"
$launcher = Join-Path $root "dist\native-launcher\$Architecture\RecapPageLauncher.exe"
$fixture = Join-Path $root 'test\native\Launcher.fixture.mjs.in'
$goldens = Join-Path $root 'test\native\startup-frames.txt'
if (-not ('RecapPageProof.FixtureJob' -as [type])) {
  Add-Type -Path (Join-Path $root 'test\native\ProofHost.cs')
}

function Read-ProofProgress {
  param([string]$Path, $State)
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
  $file = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read,
    [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
  try {
    $length = $file.Length
    if ($length -gt 1MB -or $length -lt $State.Position) {
      throw 'proof-report-size-or-truncation'
    }
    [void]$file.Seek($State.Position, [IO.SeekOrigin]::Begin)
    $buffer = New-Object byte[] 16384
    while ($file.Position -lt $length) {
      $read = $file.Read($buffer, 0, [Math]::Min($buffer.Length, $length - $file.Position))
      if ($read -eq 0) { throw 'proof-report-read-incomplete' }
      $State.Position += $read
      $State.Pending += [Text.Encoding]::UTF8.GetString($buffer, 0, $read)
      while ($State.Pending.Contains("`n")) {
        $index = $State.Pending.IndexOf("`n")
        $line = $State.Pending.Substring(0, $index).TrimEnd("`r")
        $State.Pending = $State.Pending.Substring($index + 1)
        if (-not $line) { continue }
        $State.Lines += 1
        if ($State.Lines -gt 4096 -or $line.Length -gt 4096 -or
            $line -notmatch '^(CHECK (ENTER|EXIT|FAIL|INFO) |HANDLE |DIAG |PASS |FAIL |selected-font=|dpi-message-cases=)' -or
            $line -match '[^\x20-\x7e]|[\\/:<>]') {
          Write-Host 'CHECK FAIL unsafe-proof-line-redacted'
          throw 'unsafe-proof-report'
        }
        [void]$State.Text.AppendLine($line)
        Write-Host $line
        if ($State.Live -and $line -match '^CHECK ENTER wrapper-health-') { $State.LiveHealthLines += 1 }
      }
      if ($State.Pending.Length -gt 4096) { throw 'unterminated-proof-report-line' }
    }
  } finally { $file.Dispose() }
}

function Receive-ProofStreams {
  param($Streams)
  foreach ($entry in $Streams) {
    if ($entry.Eof -or -not $entry.Task.IsCompleted) { continue }
    try { $count = $entry.Task.GetAwaiter().GetResult() }
    catch { $entry.Eof = $true; throw }
    if ($count -eq 0) {
      $entry.Eof = $true
      continue
    }
    $entry.Bytes += $count
    $entry.Unexpected = $entry.Unexpected -or $count -gt 0
    $entry.Task = $entry.Stream.ReadAsync($entry.Buffer, 0, $entry.Buffer.Length)
  }
}

function Invoke-NativeProof {
  param([string]$Executable, [string[]]$Arguments, [string]$Report, [int]$TotalTimeoutMs = 900000)
  $clock = [Diagnostics.Stopwatch]::StartNew()
  $reserve = [Math]::Min(3000, [Math]::Max(1000, [int]($TotalTimeoutMs / 3)))
  $runDeadline = $TotalTimeoutMs - $reserve
  $progress = [pscustomobject]@{
    Position = 0L; Pending = ''; Lines = 0; Text = [Text.StringBuilder]::new()
    Live = $false; LiveHealthLines = 0
  }
  $failure = $null
  $driverExit = $null
  $exitObservedAt = $null
  $streams = @()
  $process = $null
  $job = $null
  $contrast = [RecapPageProof.HostSettings]::CaptureContrast()
  $cleanup = $false
  $assigned = $false
  $go = "$Report.containment-ready"
  $ack = "$Report.progress-seen"
  Write-Host 'CHECK ENTER wrapper-start'
  try {
    $job = [RecapPageProof.FixtureJob]::new()
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in ($Arguments + @('--containment-go', $go, '--progress-ack', $ack))) {
      [void]$start.ArgumentList.Add($argument)
    }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    [void]$process.Start()
    $job.Assign($process.Handle)
    $assigned = $true
    [IO.File]::WriteAllText($go, 'contained', [Text.UTF8Encoding]::new($false))
    foreach ($stream in @($process.StandardOutput.BaseStream, $process.StandardError.BaseStream)) {
      $buffer = New-Object byte[] 4096
      $streams += [pscustomobject]@{
        Stream = $stream; Buffer = $buffer; Task = $stream.ReadAsync($buffer, 0, $buffer.Length)
        Bytes = 0L; Eof = $false; Unexpected = $false
      }
    }
    Write-Host 'CHECK EXIT wrapper-start'
    Write-Host 'CHECK ENTER process-wait'
    while ($clock.ElapsedMilliseconds -lt $runDeadline) {
      $progress.Live = -not $process.WaitForExit(0)
      Read-ProofProgress -Path $Report -State $progress
      if ($progress.LiveHealthLines -gt 0 -and -not (Test-Path -LiteralPath $ack)) {
        [IO.File]::WriteAllText($ack, 'progress-visible', [Text.UTF8Encoding]::new($false))
      }
      Receive-ProofStreams -Streams $streams
      if (@($streams | Where-Object Unexpected).Count -gt 0) { $failure = 'unexpected-proof-stream'; break }
      if ($process.WaitForExit(0)) {
        if ($null -eq $exitObservedAt) {
          $exitObservedAt = $clock.ElapsedMilliseconds
          $driverExit = $process.ExitCode
          Write-Host "CHECK EXIT process-wait code=$driverExit"
          Write-Host 'CHECK ENTER stream-drain'
        }
        if (@($streams | Where-Object { -not $_.Eof }).Count -eq 0) { break }
        if ($clock.ElapsedMilliseconds - $exitObservedAt -ge 1000) { $failure = 'held-writer-drain'; break }
      }
      Start-Sleep -Milliseconds 20
    }
    if ($null -eq $exitObservedAt -and -not $failure) { $failure = 'proof-total-deadline' }
    if ($null -ne $exitObservedAt -and @($streams | Where-Object { -not $_.Eof }).Count -eq 0) {
      Write-Host 'CHECK EXIT stream-drain'
    }
  } catch {
    $failure = 'proof-wrapper-operation-failed'
    Write-Host "CHECK FAIL wrapper-operation code=$($_.Exception.HResult)"
  } finally {
    Write-Host 'CHECK ENTER owned-cleanup'
    $progress.Live = $false
    try {
      if ($job) {
        if ($job.ActiveProcesses -gt 0) {
          if (-not $failure) { $failure = 'owned-process-residue' }
          $job.Terminate()
        }
        while ($job.ActiveProcesses -gt 0 -and $clock.ElapsedMilliseconds -lt $TotalTimeoutMs) {
          Start-Sleep -Milliseconds 20
        }
        $cleanup = $job.ActiveProcesses -eq 0
      }
      if ($process -and -not $assigned -and -not $process.WaitForExit(0)) {
        $process.Kill()
        $remaining = [Math]::Max(0, $TotalTimeoutMs - $clock.ElapsedMilliseconds)
        $cleanup = $process.WaitForExit([int]$remaining) -and $cleanup
      }
      if (-not $cleanup) { $failure = 'owned-cleanup-incomplete' }
      while (@($streams | Where-Object { -not $_.Eof }).Count -gt 0 -and
          $clock.ElapsedMilliseconds -lt $TotalTimeoutMs) {
        Receive-ProofStreams -Streams $streams
        Start-Sleep -Milliseconds 10
      }
      Read-ProofProgress -Path $Report -State $progress
      if ($progress.Pending) { $failure = 'incomplete-proof-checkpoint' }
      if (@($streams | Where-Object { -not $_.Eof }).Count -gt 0) { $failure = 'stream-cleanup-incomplete' }
    } catch {
      $cleanup = $false
      $failure = 'owned-cleanup-failed'
      Write-Host "CHECK FAIL owned-cleanup code=$($_.Exception.HResult)"
    }
    try {
      if ($job) { $job.Dispose() }
      if ($process -and @($streams | Where-Object { -not $_.Eof }).Count -eq 0) { $process.Dispose() }
    } catch {
      $cleanup = $false
      $failure = 'owned-handle-release-failed'
      Write-Host "CHECK FAIL owned-handle-release code=$($_.Exception.HResult)"
    }
    Write-Host 'CHECK ENTER host-settings-rollback'
    try {
      [RecapPageProof.HostSettings]::RestoreContrast($contrast)
      Write-Host 'CHECK EXIT host-settings-rollback'
    } catch {
      $failure = 'host-settings-rollback-failed'
      Write-Host "CHECK FAIL host-settings-rollback code=$($_.Exception.HResult)"
    }
    if ($clock.ElapsedMilliseconds -gt $TotalTimeoutMs) { $failure = 'proof-total-deadline' }
    if (Test-Path -LiteralPath $go) { Remove-Item -LiteralPath $go -Force }
    if (Test-Path -LiteralPath $ack) { Remove-Item -LiteralPath $ack -Force }
    Write-Host "CHECK EXIT owned-cleanup complete=$cleanup elapsed_ms=$($clock.ElapsedMilliseconds)"
  }
  if ($progress.Lines -eq 0) { $failure = 'missing-proof-progress' }
  if ($failure) { Write-Host "CHECK FAIL $failure" }
  $effectiveExit = $driverExit
  if ($failure -or $null -eq $effectiveExit) { $effectiveExit = 1 }
  [pscustomobject]@{
    ExitCode = $effectiveExit; DriverExitCode = $driverExit; Text = $progress.Text.ToString()
    Failure = $failure; Cleanup = $cleanup; ProgressLines = $progress.Lines
    LiveProgressLines = $progress.LiveHealthLines
    ElapsedMilliseconds = $clock.ElapsedMilliseconds
  }
}

try {
  $packageRuntime = $null
  if ($Diagnostic -and $DiagnosticTarget -in @('handles', 'f01-smoke')) {
    $packageRuntime = Join-Path $scratch 'node.exe'
    Invoke-WebRequest -Uri 'https://nodejs.org/dist/v24.19.0/win-x64/node.exe' -OutFile $packageRuntime
    $runtimeHash = (Get-FileHash -LiteralPath $packageRuntime -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($runtimeHash -cne '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237') {
      throw 'The focused diagnostic Node executable differs from the inspected official bytes.'
    }
  } elseif (-not $Negatives) {
    $version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
    $package = Join-Path $root "dist\msix\RecapPage_${version}.0_$Architecture.msix"
    $layout = Join-Path $scratch 'package'
    & winapp tool makeappx unpack /p $package /d $layout /o
    if ($LASTEXITCODE -ne 0) { throw 'The native fixture package could not be unpacked.' }
    if ((Get-FileHash -LiteralPath (Join-Path $layout 'RecapPageLauncher.exe') -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash) {
      throw 'The fixture launcher differs from the inspected package.'
    }
    $packageRuntime = Join-Path $layout 'runtime\node.exe'
  }
  if ($Negatives -or ($Diagnostic -and $DiagnosticTarget -eq 'console-wack')) {
    if ($Architecture -ne 'x64') { throw 'Aimed negatives run only on the x64 producer.' }
    if ($Negatives) {
      $runtimeInfo = (& node -p 'JSON.stringify({path:process.execPath,version:process.version,architecture:process.arch})') |
        ConvertFrom-Json
      if ($LASTEXITCODE -ne 0 -or $runtimeInfo.architecture -ne 'x64') {
        throw 'The producer fixture requires its resolved x64 setup-node runtime.'
      }
      $runtimeHash = (Get-FileHash -LiteralPath $runtimeInfo.path -Algorithm SHA256).Hash.ToLowerInvariant()
      $sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$($runtimeInfo.version)/SHASUMS256.txt").Content
      if (-not ($sums -match "(?m)^$runtimeHash\s+win-x64/node\.exe\s*$")) {
        throw 'The producer fixture runtime differs from its published executable hash.'
      }
      Write-Output "producer-runtime=$($runtimeInfo.version);architecture=x64;sha256=$runtimeHash"
    }
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $vs = @(& $vswhere -latest -products '*' -version '[17.0,18.0)' `
      -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
    if ($LASTEXITCODE -ne 0 -or $vs.Count -ne 1) { throw 'The producer compiler could not be resolved.' }
    $toolVersion = (Get-Content -LiteralPath (Join-Path $vs[0] `
      'VC\Auxiliary\Build\Microsoft.VCToolsVersion.default.txt') -Raw).Trim()
    $compiler = Join-Path $vs[0] "VC\Tools\MSVC\$toolVersion\bin\Hostx64\x64\cl.exe"
    $setup = Join-Path $vs[0] 'VC\Auxiliary\Build\vcvars64.bat'
    $record = Get-Content -LiteralPath (Join-Path $root 'dist\native-launcher\build.json') -Raw | ConvertFrom-Json
    if ((Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.toolchain.targets[0].compiler) {
      throw 'The negative compiler differs from the production compiler.'
    }
    $resources = Join-Path $env:RUNNER_TEMP "recap-native-negative-inputs-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT\Launcher.res"
    if (-not (Test-Path -LiteralPath $resources -PathType Leaf)) { throw 'The producer resource object is missing.' }
    $mutations = @('N1', 'N2', 'N3')
    if ($Diagnostic) { $mutations = @('N3') }
    foreach ($negative in $mutations) {
      $copy = Join-Path $scratch $negative
      New-Item -ItemType Directory -Path $copy -ErrorAction Stop | Out-Null
      foreach ($name in @('Launcher.cpp', 'StartupProcess.h', 'StartupProtocol.h')) {
        Copy-Item -LiteralPath (Join-Path $root "packaging\windows\native\$name") -Destination (Join-Path $copy $name)
      }
      $changed = Join-Path $copy 'StartupProtocol.h'
      $before = '    const auto frame = decodeFrame(capture);'
      $after = '    if (capture.output.empty() && exitKnown && exitCode == 0) return { true, {} };' + "`n" + $before
      $case = 'N1'
      $expectedFailure = 'N1 missing frame was accepted as opened'
      if ($negative -eq 'N2') {
        $changed = Join-Path $copy 'Launcher.cpp'
        $before = 'ShowWindow(window, SW_HIDE);'
        $after = 'DestroyWindow(window);'
        $case = 'F03'
        $expectedFailure = 'F03 pending close lost the startup owner'
      } elseif ($negative -eq 'N3') {
        $changed = Join-Path $copy 'StartupProcess.h'
        $before = 'CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT'
        $after = 'EXTENDED_STARTUPINFO_PRESENT'
        $case = 'F01'
        $expectedFailure = 'F01 coordinator created a visible terminal'
      }
      $text = [IO.File]::ReadAllText($changed)
      if ([regex]::Matches($text, [regex]::Escape($before)).Count -ne 1) {
        throw "$negative does not target exactly one predicate."
      }
      [IO.File]::WriteAllText($changed, $text.Replace($before, $after), [Text.UTF8Encoding]::new($false))
      $mutant = Join-Path $copy 'mutant.exe'
      $flags = "/nologo /std:c++17 /O2 /MT /EHsc /W4 /WX /utf-8 /GS /sdl /guard:cf /Brepro /DNDEBUG /DUNICODE /D_UNICODE /DNOMINMAX /DWIN32_LEAN_AND_MEAN /D_WIN32_WINNT=0x0A00 /DWINVER=0x0A00 /I`"$copy`" /Fo`"$copy\mutant.obj`" /Fe`"$mutant`""
      $compile = "`"$compiler`" $flags `"$copy\Launcher.cpp`" `"$resources`" /link /MACHINE:X64 /DYNAMICBASE /NXCOMPAT /HIGHENTROPYVA /GUARD:CF /MANIFEST:NO /SUBSYSTEM:WINDOWS,10.00 user32.lib gdi32.lib ole32.lib windowscodecs.lib comctl32.lib msimg32.lib"
      if ($negative -eq 'N1') {
        $compile = "`"$compiler`" $flags `"$root\test\native\StartupTests.cpp`" /link /MACHINE:X64 /DYNAMICBASE /NXCOMPAT /HIGHENTROPYVA /GUARD:CF /MANIFEST:NO /SUBSYSTEM:CONSOLE,10.00 user32.lib gdi32.lib ole32.lib oleaut32.lib uiautomationcore.lib advapi32.lib tdh.lib shell32.lib uuid.lib"
      }
      & $env:ComSpec /d /s /c "call `"$setup`" -vcvars_ver=$toolVersion 10.0.26100.0 && $compile"
      if ($LASTEXITCODE -ne 0) { throw "$negative compilation failed; this is not a proven negative." }
      if ($Diagnostic) { continue }
      $report = Join-Path $copy 'result.txt'
      $runDriver = $driver
      $runLauncher = $mutant
      if ($negative -eq 'N1') { $runDriver = $mutant; $runLauncher = $launcher }
      $arguments = @('--case', $case, '--report', $report, '--goldens', $goldens,
        '--root', (Join-Path $copy 'fixtures'), '--launcher', $runLauncher,
        '--runtime', $runtimeInfo.path, '--fixture', $fixture, '--console-only', 'true')
      $results = @(Invoke-NativeProof -Executable $runDriver -Arguments $arguments -Report $report)
      $result = $results[-1]
      $results | Select-Object -SkipLast 1 | Write-Output
      if ($result.ExitCode -ne 1 -or -not $result.Text.Contains($expectedFailure)) {
        throw "$negative did not fail its intended assertion."
      }
      Write-Output "PASS aimed-negative=$negative;case=$case;expected-failure-observed=true"
    }
    if ($Diagnostic) {
      $runtimeHash = (Get-FileHash -LiteralPath $packageRuntime -Algorithm SHA256).Hash.ToLowerInvariant()
      $runtimeInfo = (& $packageRuntime -p 'JSON.stringify({version:process.version,architecture:process.arch})') |
        ConvertFrom-Json
      if ($LASTEXITCODE -ne 0 -or $runtimeInfo.architecture -ne 'x64') {
        throw 'The inspected package runtime did not report native x64.'
      }
      $report = Join-Path $scratch 'diagnostic.txt'
      $diagnosticRoot = Join-Path $scratch 'diagnostic'
      $arguments = @('--mode', 'diagnostic', '--root', $diagnosticRoot,
        '--report', $report, '--launcher', $launcher, '--mutant', $mutant,
        '--runtime', $packageRuntime, '--fixture', $fixture,
        '--runtime-hash', $runtimeHash, '--runtime-version', $runtimeInfo.version)
      $results = @(Invoke-NativeProof -Executable $driver -Arguments $arguments -Report $report)
      $result = $results[-1]
      $results | Select-Object -SkipLast 1 | Write-Output
      foreach ($case in @('D1', 'D2', 'D3')) {
        $copy = Join-Path $diagnosticRoot "$case space $([char]0x03a9)\runtime\node.exe"
        if (-not (Test-Path -LiteralPath $copy -PathType Leaf)) {
          throw "$case did not acquire its fixed diagnostic runtime."
        }
        if ((Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtimeHash) {
          throw "$case runtime bytes differ from the inspected package."
        }
        Write-Output "DIAG runtime-copy case=$case sha256=$runtimeHash"
      }
      if ($result.ExitCode -ne 0 -or -not $result.Text.Contains('PASS diagnostic-facts-only')) {
        throw 'The diagnostic acquisition was incomplete; this is not a feature acceptance result.'
      }
      Write-Output 'DIAG acquisition complete; feature-acceptance=not-evaluated'
    }
  } elseif ($Diagnostic -and $DiagnosticTarget -in @('handles', 'f01-smoke')) {
    $runtimeInfo = (& $packageRuntime -p 'JSON.stringify({version:process.version,architecture:process.arch})') |
      ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or $runtimeInfo.version -cne 'v24.19.0' -or $runtimeInfo.architecture -cne 'x64') {
      throw 'The focused diagnostic runtime did not report the required version and architecture.'
    }
    Write-Output "HANDLE runtime version=$($runtimeInfo.version) architecture=x64 sha256=$runtimeHash"
    if ($DiagnosticTarget -eq 'f01-smoke') {
      foreach ($health in @('wrapper-stall', 'wrapper-held-writer')) {
        $healthReport = Join-Path $scratch "$health.txt"
        $healthResult = Invoke-NativeProof -Executable $driver `
          -Arguments @('--mode', $health, '--report', $healthReport) `
          -Report $healthReport -TotalTimeoutMs 4000
        $expected = 'proof-total-deadline'
        if ($health -eq 'wrapper-held-writer') { $expected = 'held-writer-drain' }
        if ($healthResult.Failure -ne $expected -or -not $healthResult.Cleanup -or
            $healthResult.LiveProgressLines -lt 1 -or $healthResult.ElapsedMilliseconds -gt 4000) {
          throw "The $health wrapper-health case did not return its bounded expected failure."
        }
        Write-Host "CHECK INFO wrapper-health-passed case=$health"
      }
    }
    $report = Join-Path $scratch 'handles.txt'
    $arguments = @('--mode', 'handles', '--report', $report, '--root', (Join-Path $scratch 'fixture'),
      '--launcher', $launcher, '--runtime', $packageRuntime, '--fixture', $fixture)
    $limit = 900000
    if ($DiagnosticTarget -eq 'f01-smoke') { $limit = 290000 }
    $results = @(Invoke-NativeProof -Executable $driver -Arguments $arguments -Report $report -TotalTimeoutMs $limit)
    $result = $results[-1]
    $results | Select-Object -SkipLast 1 | Write-Output
    if ($result.ExitCode -ne 0 -or -not $result.Text.Contains('PASS focused-handle-diagnostic')) {
      throw 'The focused handle diagnostic did not establish conclusive exclusion and its permitted visual checks.'
    }
    Write-Output 'HANDLE diagnostic complete; feature-acceptance=not-evaluated'
  } else {
    $report = Join-Path $scratch 'result.txt'
    $arguments = @('--report', $report, '--goldens', $goldens, '--root', (Join-Path $scratch 'fixtures'),
      '--launcher', $launcher, '--runtime', $packageRuntime, '--fixture', $fixture)
    $results = @(Invoke-NativeProof -Executable $driver -Arguments $arguments -Report $report)
    $result = $results[-1]
    $results | Select-Object -SkipLast 1 | Write-Output
    if ($result.ExitCode -ne 0 -or ([regex]::Matches($result.Text, '(?m)^PASS F\d\d$').Count -ne 11)) {
      throw "The $Architecture native suite failed or did not run all 11 release fixtures."
    }
    Write-Output "PASS native-suite=$Architecture;gui-activations=11;coordinator-fixtures=9;sentinels=2"
  }
} finally {
  if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
  if ($Negatives -or $Diagnostic) {
    $negativeInputs = Join-Path $env:RUNNER_TEMP "recap-native-negative-inputs-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
    if (Test-Path -LiteralPath $negativeInputs) { Remove-Item -LiteralPath $negativeInputs -Recurse -Force }
  }
}
