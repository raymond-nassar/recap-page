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
$proofRecord = Get-Content -LiteralPath (Join-Path $root 'dist\native-proof\build.json') -Raw | ConvertFrom-Json
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

function Reject-ProofReport {
  param($State, [ValidateSet('proof-report-size', 'proof-report-truncated', 'proof-report-line-count',
    'proof-report-line-length', 'unsafe-proof-report', 'proof-report-read-incomplete',
    'unterminated-proof-report-line', 'proof-report-read-failed')][string]$Code, [long]$Cause = 0)
  if (-not $State.Failure) {
    $State.Failure = $Code
    $State.FailureCause = $Cause
    $label = $Code
    if ($Code -eq 'unsafe-proof-report') { $label = 'unsafe-proof-line-redacted' }
    Write-Host "CHECK FAIL $label"
  }
  throw $State.Failure
}

function Read-ProofProgress {
  param([string]$Path, $State)
  if ($State.Failure) { throw $State.Failure }
  $State.Reads += 1
  $file = $null
  try {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    $file = [IO.File]::Open($Path, [IO.FileMode]::Open, [IO.FileAccess]::Read,
      [IO.FileShare]::ReadWrite -bor [IO.FileShare]::Delete)
    $length = $file.Length
    if ($length -gt 1MB) { Reject-ProofReport $State 'proof-report-size' }
    if ($length -lt $State.Position) { Reject-ProofReport $State 'proof-report-truncated' }
    [void]$file.Seek($State.Position, [IO.SeekOrigin]::Begin)
    $buffer = New-Object byte[] 16384
    while ($file.Position -lt $length) {
      $read = $file.Read($buffer, 0, [Math]::Min($buffer.Length, $length - $file.Position))
      if ($read -eq 0) { Reject-ProofReport $State 'proof-report-read-incomplete' }
      $State.Position += $read
      $State.Pending += [Text.Encoding]::UTF8.GetString($buffer, 0, $read)
      while ($State.Pending.Contains("`n")) {
        $index = $State.Pending.IndexOf("`n")
        $line = $State.Pending.Substring(0, $index).TrimEnd("`r")
        $State.Pending = $State.Pending.Substring($index + 1)
        if (-not $line) { continue }
        $State.Lines += 1
        if ($State.Lines -gt 4096) { Reject-ProofReport $State 'proof-report-line-count' }
        if ($line.Length -gt 4096) { Reject-ProofReport $State 'proof-report-line-length' }
        if ($line -notmatch '^(CHECK (ENTER|EXIT|FAIL|INFO) |HANDLE |DIAG |PASS |FAIL |selected-font=|dpi-message-cases=)' -or
            $line -match '[^\x20-\x7e]|[\\/:<>]') {
          Reject-ProofReport $State 'unsafe-proof-report'
        }
        [void]$State.Text.AppendLine($line)
        Write-Host $line
        if (-not $State.NativeFailure -and $line -match '^FAIL code=([a-z][a-z0-9-]{0,79}) stage=([A-Za-z][A-Za-z0-9-]{0,79})$') {
          $State.NativeFailure = $Matches[1]
          $State.NativeStage = $Matches[2]
        }
        if ($State.Live -and $line -match '^CHECK ENTER wrapper-health-') { $State.LiveHealthLines += 1 }
      }
      if ($State.Pending.Length -gt 4096) { Reject-ProofReport $State 'unterminated-proof-report-line' }
    }
  } catch {
    if (-not $State.Failure) { Reject-ProofReport $State 'proof-report-read-failed' $_.Exception.HResult }
    throw $State.Failure
  } finally { if ($file) { $file.Dispose() } }
}

function New-ProofOutcome {
  [pscustomobject]@{
    Failure = $null; PrimaryCause = 0L; PrimaryOrigin = 'none'
    SecondaryFailures = [Collections.Generic.List[object]]::new()
    Resources = [ordered]@{
      job = $false; process = $false; streams = $false; 'job-handle' = $false
      'process-handle' = $false; settings = $false; files = $false
    }
  }
}

function Add-ProofFailure {
  param($State, [ValidatePattern('^[a-z][a-z0-9-]{0,79}$')][string]$Code,
    [long]$Cause = 0, [switch]$AlreadyReported,
    [ValidateSet('native','report','wrapper','cleanup')][string]$Origin = 'wrapper')
  $secondary = [bool]$State.Failure
  if ($secondary) {
    $State.SecondaryFailures.Add([pscustomobject]@{ Code = $Code; Cause = $Cause; Origin = $Origin })
  } else {
    $State.Failure = $Code
    $State.PrimaryCause = $Cause
    $State.PrimaryOrigin = $Origin
  }
  if (-not $AlreadyReported) { Write-Host "CHECK FAIL $Code secondary=$secondary cause=$Cause" }
}

function Invoke-ProofCleanupStep {
  param($State, [ValidateSet('job', 'process', 'streams', 'job-handle', 'process-handle', 'settings', 'files')]
    [string]$Stage, [scriptblock]$Action)
  Write-Host "CHECK ENTER cleanup-$Stage"
  try {
    & $Action
    $State.Resources[$Stage] = $true
    Write-Host "CHECK EXIT cleanup-$Stage"
  } catch {
    $State.Resources[$Stage] = $false
    Add-ProofFailure -State $State -Code "cleanup-$Stage-failed" -Cause $_.Exception.HResult -Origin cleanup
  }
}

function Complete-ProofOutcome {
  param($State, $Progress, $DriverExitCode, [long]$ElapsedMilliseconds)
  $cleanup = @($State.Resources.Values | Where-Object { -not $_ }).Count -eq 0
  $reportValid = -not $Progress.Failure -and -not $Progress.Pending
  $exitCode = $DriverExitCode
  $nonNative = ($State.Failure -and $State.PrimaryOrigin -ne 'native') -or
    @($State.SecondaryFailures | Where-Object { $_.Origin -ne 'native' }).Count -gt 0
  if ($State.Failure -or -not $cleanup -or -not $reportValid -or $null -eq $exitCode) { $exitCode = 1 }
  [pscustomobject]@{
    ExitCode = $exitCode; DriverExitCode = $DriverExitCode; Text = $Progress.Text.ToString()
    Failure = $State.Failure; PrimaryCause = $State.PrimaryCause
    PrimaryOrigin = $State.PrimaryOrigin; NonNativeFailure = $nonNative
    SecondaryFailures = @($State.SecondaryFailures.ToArray()); Cleanup = $cleanup
    Resources = [pscustomobject]$State.Resources; ReportValid = $reportValid
    ProgressLines = $Progress.Lines; LiveProgressLines = $Progress.LiveHealthLines
    ElapsedMilliseconds = $ElapsedMilliseconds
  }
}

function Test-NativeSuiteResult {
  param($Result)
  if ($Result.ExitCode -ne 0 -or $null -eq $Result.DriverExitCode -or $Result.DriverExitCode -ne 0 -or
      -not $Result.ReportValid -or -not $Result.Cleanup -or $Result.Failure -or
      $Result.NonNativeFailure -or $Result.SecondaryFailures.Count -ne 0) { return $false }
  $labels = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
  foreach ($line in $Result.Text.Replace("`r`n", "`n").Split("`n")) {
    if ($line -match '^FAIL ') { return $false }
    if ($line -notmatch '^PASS +F') { continue }
    if ($line -cnotmatch '^PASS F(0[1-9]|1[01])$' -or -not $labels.Add($line)) { return $false }
  }
  return $labels.Count -eq 11
}

function Assert-ComposerCompletion {
  param([object[]]$Lines, [int]$ExitCode)
  $expected = 'PASS app-startup-contract-v2 profile=native-inert verdict=pass'
  $complete = $Lines.Count -eq 1 -and $Lines[0] -is [string] -and $Lines[0] -ceq $expected
  if ($complete) {
    Write-Output $Lines[0]
  } else {
    Write-Output "DIAG composer-output-redacted records=$($Lines.Count)"
  }
  if ($ExitCode -ne 0 -or -not $complete) {
    Write-Output "DIAG composer-result exit_code=$ExitCode complete=$complete"
    throw 'The composed native startup contract did not pass.'
  }
}

function New-StartupInvocation {
  param([string]$Report, [string]$Context, [string]$InputsDigest)
  $binding = [ordered]@{
    commit = $proofRecord.commit; tree = $proofRecord.creationReceipt.tree
    captureId = [Guid]::NewGuid().ToString('N'); architecture = $Architecture
    proofInputDigest = $proofRecord.inputDigest; creationReceiptDigest = $proofRecord.creationReceiptDigest
    startupInputsDigest = $InputsDigest
    deployment = [ordered]@{ kind = 'fixed-fixture'; architecture = $Architecture }
  }
  $path = "$Report.startup-context"
  $fields = @('RCPAPP2', $Context, $binding.captureId, $binding.commit, $binding.tree, $Architecture,
    $binding.proofInputDigest, $binding.creationReceiptDigest, $InputsDigest)
  [IO.File]::WriteAllText($path, ($fields -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
  [pscustomobject]@{ Binding = $binding; Path = $path; Context = $Context }
}

function Test-HostCompletion {
  param([string]$Text, $Expected)
  $lines = @($Text.Replace("`r`n", "`n").Split("`n") | Where-Object { $_.StartsWith('DIAG host-completion-v2') })
  if ($lines.Count -ne 1 -or $lines[0].Length -gt 4096 -or $lines[0] -match '[^\x20-\x7e]|[\\/:<>]') { return $false }
  $keys = @('context','captureId','commit','tree','architecture','proofInputDigest','creationReceiptDigest',
    'beginEvaluated','endEvaluated','beginState','endState','registryView','hiveSamplesBefore',
    'hiveSamplesAfter','helperSnapshotPairs','helpersUnchanged','hostState','primaryReason')
  $parts = $lines[0].Split(' ')
  if ($parts.Count -ne $keys.Count + 2) { return $false }
  $values = @{}
  for ($index = 0; $index -lt $keys.Count; $index += 1) {
    $pair = $parts[$index + 2].Split('=')
    if ($pair.Count -ne 2 -or $pair[0] -cne $keys[$index] -or -not $pair[1]) { return $false }
    $values[$pair[0]] = $pair[1]
  }
  if ($values.context -cne $Expected.Context -or $values.context -cnotmatch '^(preflight|N2|N3|LC-001)$') { return $false }
  foreach ($key in @('captureId','commit','tree','architecture','proofInputDigest','creationReceiptDigest')) {
    if ($values[$key] -cne $Expected.Binding[$key]) { return $false }
  }
  if ($values.captureId -cnotmatch '^[0-9a-f]{32}$' -or $values.commit -cnotmatch '^[0-9a-f]{40}$' -or
      $values.tree -cnotmatch '^[0-9a-f]{40}$' -or $values.proofInputDigest -cnotmatch '^[0-9a-f]{64}$' -or
      $values.creationReceiptDigest -cnotmatch '^[0-9a-f]{64}$' -or $values.architecture -cnotmatch '^(x64|arm64)$') { return $false }
  return $values.beginEvaluated -ceq '1' -and $values.endEvaluated -ceq '1' -and
    $values.beginState -ceq 'satisfied' -and $values.endState -ceq 'satisfied' -and
    $values.registryView -ceq 'native64' -and $values.hiveSamplesBefore -ceq '2' -and
    $values.hiveSamplesAfter -ceq '2' -and $values.helperSnapshotPairs -ceq '2' -and
    $values.helpersUnchanged -ceq '1' -and $values.hostState -ceq 'satisfied' -and $values.primaryReason -ceq 'none'
}

function Test-StartupControlResult {
  param($Result, $Expected, [string]$ExpectedFailure)
  if (-not $Result.Cleanup -or -not $Result.ReportValid -or $Result.NonNativeFailure) { return $false }
  if ($Expected.Context -eq 'N1') {
    return $Result.ExitCode -eq 1 -and $Result.Text.Contains($ExpectedFailure)
  }
  if (-not (Test-HostCompletion $Result.Text $Expected)) { return $false }
  if ($Expected.Context -eq 'preflight') {
    return $Result.ExitCode -eq 0 -and $Result.Text.Contains('PASS calibration-preflight;controls=2;product-starts=0;node-starts=0')
  }
  return $Result.ExitCode -eq 1 -and $Result.Text.Contains($ExpectedFailure)
}

function Receive-NativeFailure {
  param($State, $Progress)
  if ($Progress.NativeFailure -and -not $Progress.NativeRecorded) {
    Add-ProofFailure -State $State -Code $Progress.NativeFailure -Origin native -AlreadyReported
    $Progress.NativeRecorded = $true
  }
}

function Receive-CompletedProof {
  param($State, $Progress, [string]$Path, $DriverExitCode)
  if (-not $Progress.Failure) {
    try {
      Read-ProofProgress -Path $Path -State $Progress
      Receive-NativeFailure $State $Progress
      if ($Progress.Pending) { Add-ProofFailure $State 'incomplete-proof-checkpoint' }
    } catch {
      Receive-NativeFailure $State $Progress
      if ($Progress.Failure) {
        Add-ProofFailure -State $State -Code $Progress.Failure -Cause $Progress.FailureCause -AlreadyReported -Origin report
      } else {
        Add-ProofFailure -State $State -Code 'proof-report-read-failed' -Cause $_.Exception.HResult
      }
    }
  } else {
    Receive-NativeFailure $State $Progress
  }
  if ($null -ne $DriverExitCode -and $DriverExitCode -ne 0 -and -not $Progress.NativeRecorded) {
    Add-ProofFailure -State $State -Code 'native-exit-failed' -Cause $DriverExitCode -Origin native
  }
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
    Live = $false; LiveHealthLines = 0; Failure = $null; FailureCause = 0L; Reads = 0
    NativeFailure = $null; NativeStage = $null; NativeRecorded = $false
  }
  $outcome = New-ProofOutcome
  $driverExit = $null
  $exitObservedAt = $null
  $completionRead = $false
  $streams = @()
  $process = $null
  $job = $null
  $contrast = [RecapPageProof.HostSettings]::CaptureContrast()
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
      Receive-NativeFailure $outcome $progress
      if ($progress.LiveHealthLines -gt 0 -and -not (Test-Path -LiteralPath $ack)) {
        [IO.File]::WriteAllText($ack, 'progress-visible', [Text.UTF8Encoding]::new($false))
      }
      Receive-ProofStreams -Streams $streams
      if (@($streams | Where-Object Unexpected).Count -gt 0) {
        Add-ProofFailure $outcome 'unexpected-proof-stream'
        break
      }
      if ($process.WaitForExit(0)) {
        if ($null -eq $exitObservedAt) {
          $exitObservedAt = $clock.ElapsedMilliseconds
          $driverExit = $process.ExitCode
          $completionRead = $true
          Receive-CompletedProof -State $outcome -Progress $progress -Path $Report -DriverExitCode $driverExit
          Write-Host "CHECK EXIT process-wait code=$driverExit"
          Write-Host 'CHECK ENTER stream-drain'
        }
        if (@($streams | Where-Object { -not $_.Eof }).Count -eq 0) { break }
        if ($clock.ElapsedMilliseconds - $exitObservedAt -ge 1000) {
          Add-ProofFailure $outcome 'held-writer-drain'
          break
        }
      }
      Start-Sleep -Milliseconds 20
    }
    if ($null -eq $exitObservedAt -and -not $outcome.Failure) { Add-ProofFailure $outcome 'proof-total-deadline' }
    if ($null -ne $exitObservedAt -and @($streams | Where-Object { -not $_.Eof }).Count -eq 0) {
      Write-Host 'CHECK EXIT stream-drain'
    }
  } catch {
    Receive-NativeFailure $outcome $progress
    if ($progress.Failure) {
      Add-ProofFailure -State $outcome -Code $progress.Failure -Cause $progress.FailureCause -AlreadyReported -Origin report
    } else {
      Add-ProofFailure -State $outcome -Code 'proof-wrapper-operation-failed' -Cause $_.Exception.HResult
    }
  } finally {
    Write-Host 'CHECK ENTER owned-cleanup'
    $progress.Live = $false
    Invoke-ProofCleanupStep $outcome 'job' {
      if ($job) {
        if ($job.ActiveProcesses -gt 0) {
          Add-ProofFailure -State $outcome -Code 'owned-process-residue' -Origin cleanup
          $job.Terminate()
        }
        while ($job.ActiveProcesses -gt 0 -and $clock.ElapsedMilliseconds -lt $TotalTimeoutMs) {
          Start-Sleep -Milliseconds 20
        }
        if ($job.ActiveProcesses -ne 0) { throw 'owned-job-cleanup-incomplete' }
      }
    }
    Invoke-ProofCleanupStep $outcome 'process' {
      if ($process -and -not $process.WaitForExit(0)) {
        $process.Kill()
        $remaining = [Math]::Max(0, $TotalTimeoutMs - $clock.ElapsedMilliseconds)
        if (-not $process.WaitForExit([int]$remaining)) { throw 'owned-process-cleanup-incomplete' }
      }
    }
    Invoke-ProofCleanupStep $outcome 'streams' {
      $streamFault = $false
      while (@($streams | Where-Object { -not $_.Eof }).Count -gt 0 -and
          $clock.ElapsedMilliseconds -lt $TotalTimeoutMs) {
        foreach ($entry in $streams) {
          try { Receive-ProofStreams -Streams @($entry) }
          catch {
            $streamFault = $true
            Add-ProofFailure -State $outcome -Code 'proof-stream-read-failed' -Cause $_.Exception.HResult
          }
        }
        Start-Sleep -Milliseconds 10
      }
      if ($streamFault -or @($streams | Where-Object { -not $_.Eof }).Count -gt 0) {
        throw 'stream-cleanup-incomplete'
      }
    }
    if (-not $progress.Failure) {
      if (-not $completionRead) {
        Receive-CompletedProof -State $outcome -Progress $progress -Path $Report -DriverExitCode $driverExit
      }
    }
    Invoke-ProofCleanupStep $outcome 'job-handle' { if ($job) { $job.Dispose() } }
    Invoke-ProofCleanupStep $outcome 'process-handle' {
      if ($process) {
        if (@($streams | Where-Object { -not $_.Eof }).Count -gt 0) { throw 'owned-process-streams-still-active' }
        $process.Dispose()
      }
    }
    Write-Host 'CHECK ENTER host-settings-rollback'
    Invoke-ProofCleanupStep $outcome 'settings' {
      [RecapPageProof.HostSettings]::RestoreContrast($contrast)
      Write-Host 'CHECK EXIT host-settings-rollback'
    }
    Invoke-ProofCleanupStep $outcome 'files' {
      $fileFault = $false
      foreach ($path in @($go, $ack)) {
        try { if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Force } }
        catch {
          $fileFault = $true
          Add-ProofFailure -State $outcome -Code 'proof-control-file-cleanup-failed' -Cause $_.Exception.HResult
        }
      }
      if ($fileFault) { throw 'proof-control-file-cleanup-incomplete' }
    }
    if ($clock.ElapsedMilliseconds -gt $TotalTimeoutMs) { Add-ProofFailure $outcome 'proof-total-deadline' }
  }
  if ($progress.Lines -eq 0) { Add-ProofFailure $outcome 'missing-proof-progress' }
  $result = Complete-ProofOutcome $outcome $progress $driverExit $clock.ElapsedMilliseconds
  Write-Host "CHECK EXIT owned-cleanup complete=$($result.Cleanup) elapsed_ms=$($result.ElapsedMilliseconds)"
  $primary = 'none'
  if ($result.Failure) { $primary = $result.Failure }
  Write-Host "DIAG proof-outcome primary=$primary origin=$($result.PrimaryOrigin) secondary=$($result.SecondaryFailures.Count) report_valid=$($result.ReportValid) report_reads=$($progress.Reads) resource_cleanup=$($result.Cleanup)"
  return $result
}

function Export-NativePreview {
  param([string]$Layout, [string]$Runtime, [bool]$F01Completed)
  $image = Join-Path $Layout 'startup-dark.bmp'
  $facts = Join-Path $Layout 'render-evidence.json'
  if (-not (Test-Path -LiteralPath $image -PathType Leaf) -or
      -not (Test-Path -LiteralPath $facts -PathType Leaf)) {
    Write-Host 'CHECK INFO pending-preview-unavailable'
    return $false
  }
  if ((Get-Item -LiteralPath $facts).Length -gt 4096) { throw 'Native preview facts exceed their bound.' }
  $render = Get-Content -LiteralPath $facts -Raw | ConvertFrom-Json
  $keys = @(
    'pendingOnly', 'nameRoleVerified', 'pendingControlsVerified', 'errorDetailsHidden',
    'wordmarkUnclipped', 'width', 'height', 'dpi', 'fillPixels', 'outlinePixels',
    'shadowPixels', 'fontPatternAvailable', 'renderedReviewRequired', 'expectedFirstCandidate', 'fontAvailability',
    'iconTop', 'iconBottom', 'rowCentered', 'footerTextVerified', 'footerVisible', 'footerBoundsVerified',
    'footerInkPixels', 'footerLeft', 'footerTop', 'footerRight', 'footerBottom'
  )
  if (@(Compare-Object ($render.PSObject.Properties.Name | Sort-Object) ($keys | Sort-Object)).Count -ne 0) {
    throw 'Native preview facts contain unexpected fields.'
  }
  foreach ($flag in @('pendingOnly', 'nameRoleVerified', 'pendingControlsVerified',
      'errorDetailsHidden', 'wordmarkUnclipped', 'renderedReviewRequired', 'rowCentered',
      'footerTextVerified', 'footerVisible', 'footerBoundsVerified')) {
    if ($render.$flag -isnot [bool] -or -not $render.$flag) { throw 'Native preview safety gate did not hold.' }
  }
  if ($render.fontPatternAvailable -isnot [bool]) { throw 'Native preview optional metadata status is invalid.' }
  $names = @('Impact', 'Haettenschweiler', 'Arial Narrow Bold', 'Segoe UI')
  if ($render.fontAvailability.Count -ne 4) { throw 'Native preview font scope differs.' }
  $expectedFirst = $null
  for ($index = 0; $index -lt 4; $index++) {
    $font = $render.fontAvailability[$index]
    if ($font.name -cne $names[$index] -or $font.available -isnot [bool] -or
        @($font.PSObject.Properties).Count -ne 2) { throw 'Native preview font facts are unsafe.' }
    if ($font.available -and -not $expectedFirst) { $expectedFirst = $font.name }
  }
  if (-not $expectedFirst -or $render.expectedFirstCandidate -cne $expectedFirst) {
    throw 'Native preview expected font candidate differs.'
  }
  foreach ($number in @('width', 'height', 'dpi', 'fillPixels', 'outlinePixels', 'shadowPixels', 'footerInkPixels')) {
    if ($render.$number -le 0 -or $render.$number -ne [Math]::Truncate($render.$number)) {
      throw 'Native preview numeric facts are invalid.'
    }
  }
  if ($render.dpi -gt 768 -or $render.width -gt 4096 -or $render.height -gt 4096 -or
      $render.fillPixels + $render.outlinePixels + $render.shadowPixels -gt $render.width * $render.height) {
    throw 'Native preview dimensions or ink counts exceed their bound.'
  }
  foreach ($coordinate in @('iconTop', 'iconBottom')) {
    if (($render.$coordinate -isnot [int] -and $render.$coordinate -isnot [long]) -or
        $render.$coordinate -lt 0 -or $render.$coordinate -ge $render.height) {
      throw 'Native preview icon coordinates are invalid.'
    }
  }
  if ($render.iconTop -lt 0 -or $render.iconBottom -ge $render.height -or
      $render.iconBottom -lt $render.iconTop -or
      [Math]::Abs($render.iconTop + $render.iconBottom - ($render.height - 1)) -gt 2) {
    throw 'Native preview row is not centered within one device pixel.'
  }
  foreach ($coordinate in @('footerLeft', 'footerTop', 'footerRight', 'footerBottom')) {
    if (($render.$coordinate -isnot [int] -and $render.$coordinate -isnot [long]) -or $render.$coordinate -lt 0) {
      throw 'Native preview footer coordinates are invalid.'
    }
  }
  if ($render.footerRight -gt $render.width -or $render.footerBottom -gt $render.height -or
      $render.footerLeft -ge $render.footerRight -or $render.footerTop -ge $render.footerBottom -or
      $render.footerInkPixels -lt 64 -or
      $render.footerInkPixels -gt ($render.footerRight - $render.footerLeft) * ($render.footerBottom - $render.footerTop)) {
    throw 'Native preview footer bounds or actual text ink are invalid.'
  }
  $bytes = [IO.File]::ReadAllBytes($image)
  if ($bytes.Length -gt 4MB -or $bytes.Length -lt 54 -or
      [Text.Encoding]::ASCII.GetString($bytes, 0, 2) -cne 'BM' -or
      [BitConverter]::ToUInt32($bytes, 2) -ne $bytes.Length -or
      [BitConverter]::ToUInt32($bytes, 10) -ne 54 -or
      [BitConverter]::ToInt32($bytes, 18) -ne $render.width -or
      -[BitConverter]::ToInt32($bytes, 22) -ne $render.height -or
      [BitConverter]::ToUInt16($bytes, 28) -ne 32 -or
      $bytes.Length -ne (54 + $render.width * $render.height * 4)) {
    throw 'Native preview bitmap does not match bounded client evidence.'
  }
  $nativeRecord = Get-Content -LiteralPath (Join-Path $root 'dist\native-launcher\build.json') -Raw | ConvertFrom-Json
  $output = Join-Path $root "dist\native-preview\$Architecture"
  if (Test-Path -LiteralPath $output) { throw 'A native preview already exists for this architecture.' }
  New-Item -ItemType Directory -Path $output -ErrorAction Stop | Out-Null
  Copy-Item -LiteralPath $image -Destination (Join-Path $output 'pending-dark.bmp')
  $sidecar = [ordered]@{
    schemaVersion = 1
    commit = $nativeRecord.commit
    architecture = $Architecture
    launcherSha256 = (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash.ToLowerInvariant()
    proofSha256 = (Get-FileHash -LiteralPath $driver -Algorithm SHA256).Hash.ToLowerInvariant()
    runtimeSha256 = (Get-FileHash -LiteralPath $Runtime -Algorithm SHA256).Hash.ToLowerInvariant()
    imageSha256 = (Get-FileHash -LiteralPath $image -Algorithm SHA256).Hash.ToLowerInvariant()
    imageBytes = $bytes.Length
    f01Completed = $F01Completed
    render = $render
  }
  $json = $sidecar | ConvertTo-Json -Depth 6
  if ($json.Length -gt 8192) { throw 'Native preview sidecar exceeds its bound.' }
  [IO.File]::WriteAllText((Join-Path $output 'evidence.json'), $json, [Text.UTF8Encoding]::new($false))
  if ($env:GITHUB_OUTPUT) {
    'preview_ready=true' | Out-File -LiteralPath $env:GITHUB_OUTPUT -Encoding utf8 -Append
  }
  Write-Host "CHECK INFO pending-preview-ready architecture=$Architecture"
  return $true
}

try {
  if ($Negatives) {
    if ($Architecture -ne 'x64') { throw 'The calibration preflight requires the native x64 producer.' }
    $report = Join-Path $scratch 'calibration-preflight.txt'
    $invocation = New-StartupInvocation $report 'preflight' $proofRecord.inputDigest
    $results = @(Invoke-NativeProof -Executable $driver `
      -Arguments @('--mode', 'calibration', '--report', $report, '--contract', $invocation.Path) -Report $report -TotalTimeoutMs 60000)
    $result = $results[-1]
    $results | Select-Object -SkipLast 1 | Write-Output
    if (-not (Test-StartupControlResult $result $invocation '')) {
      throw 'The calibration preflight failed; no mutation or product fixture was started.'
    }
  }
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
    $mutations = @('N1', 'N2', 'N3', 'LC-001')
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
      $expectedFailure = 'FAIL code=n1-missing-frame-accepted'
      if ($negative -eq 'N2') {
        $changed = Join-Path $copy 'Launcher.cpp'
        $before = 'ShowWindow(window, SW_HIDE);'
        $after = 'DestroyWindow(window);'
        $case = 'F03'
        $expectedFailure = 'FAIL code=n2-pending-owner-lost'
      } elseif ($negative -eq 'N3') {
        $changed = Join-Path $copy 'StartupProcess.h'
        $before = 'CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT'
        $after = 'EXTENDED_STARTUPINFO_PRESENT'
        $case = 'F01'
        $expectedFailure = 'FAIL code=n3-visible-coordinator-terminal'
      } elseif ($negative -eq 'LC-001') {
        $changed = Join-Path $copy 'Launcher.cpp'
        $placement = [regex]::Matches([IO.File]::ReadAllText($changed),
          '(?ms)^bool placeFailureWindow\(App& app\) \{.*?^\}')
        if ($placement.Count -ne 1) { throw 'The LC-001 placement seam is not unique.' }
        $before = $placement[0].Value
        $after = @'
bool placeFailureWindow(App& app) {
    RECT work{};
    if (!SystemParametersInfoW(SPI_GETWORKAREA, 0, &work, 0)) return false;
    const int width = std::min(app.scale(640), static_cast<int>(work.right - work.left));
    const int height = std::min(app.scale(520), static_cast<int>(work.bottom - work.top));
    return SetWindowPos(app.window, nullptr, 0, 0, width, height, SWP_NOMOVE | SWP_NOZORDER) != FALSE;
}
'@
        $case = 'F03'
        $expectedFailure = 'FAIL code=lc001-failure-outside-work-area'
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
      $invocation = [pscustomobject]@{ Context = 'N1' }
      if ($negative -ne 'N1') {
        $invocation = New-StartupInvocation $report $negative $proofRecord.inputDigest
        $arguments += @('--contract', $invocation.Path)
      }
      $results = @(Invoke-NativeProof -Executable $runDriver -Arguments $arguments -Report $report)
      $result = $results[-1]
      $results | Select-Object -SkipLast 1 | Write-Output
      if (-not (Test-StartupControlResult $result $invocation $expectedFailure)) {
        throw "$negative did not fail its intended assertion."
      }
      $kind = 'aimed-negative'
      if ($negative -eq 'LC-001') { $kind = 'review-original-condition' }
      Write-Output "PASS $kind=$negative;case=$case;expected-failure-observed=true"
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
    $preview = Export-NativePreview -Layout (Join-Path (Join-Path $scratch 'fixture') "fixture space $([char]0x03a9)") `
      -Runtime $packageRuntime -F01Completed ($result.ExitCode -eq 0)
    if ($result.ExitCode -ne 0 -or -not $result.Text.Contains('PASS focused-handle-diagnostic')) {
      throw 'The focused handle diagnostic did not establish conclusive exclusion and its permitted visual checks.'
    }
    if (-not $preview) { throw 'The focused F01 preview evidence is missing.' }
    Write-Output 'HANDLE diagnostic complete; feature-acceptance=not-evaluated'
  } else {
    $report = Join-Path $scratch 'result.txt'
    $nodeHash = (Get-FileHash -LiteralPath $packageRuntime -Algorithm SHA256).Hash.ToLowerInvariant()
    $expectedNode = '3602f2bb1a10f2cbab4c36886218a33c1ab3db87290e73b033c46c77147d0237'
    if ($Architecture -eq 'arm64') { $expectedNode = '3958e4bb3f2d4ef37c938215dfc65a9d3c9d839b5060fec103bd2345fa78e951' }
    if ($nodeHash -cne $expectedNode) { throw 'The native fixture runtime is not the official architecture input.' }
    $fixtureHash = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash.ToLowerInvariant()
    $digest = [Security.Cryptography.SHA256]::Create()
    try {
      $inputHash = [BitConverter]::ToString($digest.ComputeHash(
        [Text.Encoding]::ASCII.GetBytes("$($proofRecord.productionDigest)|$fixtureHash|$nodeHash"))).Replace('-','').ToLowerInvariant()
    } finally { $digest.Dispose() }
    $invocation = New-StartupInvocation $report 'native-inert' $inputHash
    $arguments = @('--report', $report, '--goldens', $goldens, '--root', (Join-Path $scratch 'fixtures'),
      '--launcher', $launcher, '--runtime', $packageRuntime, '--fixture', $fixture, '--contract', $invocation.Path)
    $results = @(Invoke-NativeProof -Executable $driver -Arguments $arguments -Report $report)
    $result = $results[-1]
    $results | Select-Object -SkipLast 1 | Write-Output
    $preview = Export-NativePreview -Layout (Join-Path (Join-Path $scratch 'fixtures') "fixture space $([char]0x03a9)") `
      -Runtime $packageRuntime -F01Completed ($result.ExitCode -eq 0)
    if (-not (Test-NativeSuiteResult $result)) {
      throw "The $Architecture native suite failed or did not run all 11 release fixtures."
    }
    if (-not $preview) { throw 'The native F01 preview evidence is missing.' }
    $records = @($result.Text.Replace("`r`n", "`n").Split("`n") | Where-Object {
      $_.StartsWith('DIAG app-capture-v2') -or $_.StartsWith('DIAG host-sample ')
    })
    if (@($records | Where-Object { $_.StartsWith('DIAG app-capture-v2') }).Count -ne 1) {
      throw 'The native mandatory app capture record is missing or duplicated.'
    }
    Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction Stop
    $composition = [ordered]@{
      bindings = $invocation.Binding; profile = 'native-inert'; record = $records -join "`n"
      inputs = $true; creation = $true; behavior = $true
      cleanup = [ordered]@{ scope = 'capture'; completed = $result.Cleanup; reportValid = $result.ReportValid; closingInputs = $true }
      failures = @()
    }
    $composerOutput = @($composition | ConvertTo-Json -Depth 8 -Compress |
      & node (Join-Path $root 'scripts\lib\startup-contract.mjs') --compose-native)
    $composerExit = $LASTEXITCODE
    Assert-ComposerCompletion -Lines $composerOutput -ExitCode $composerExit
    Write-Output "PASS native-suite=$Architecture;gui-activations=11;coordinator-fixtures=9;sentinels=2"
  }
} finally {
  if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
  if ($Negatives -or $Diagnostic) {
    $negativeInputs = Join-Path $env:RUNNER_TEMP "recap-native-negative-inputs-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
    if (Test-Path -LiteralPath $negativeInputs) { Remove-Item -LiteralPath $negativeInputs -Recurse -Force }
  }
}
