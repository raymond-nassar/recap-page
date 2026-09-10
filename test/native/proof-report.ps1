Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$proofPath = Join-Path $root 'scripts\native-startup-proof.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($proofPath, [ref]$tokens, [ref]$parseErrors)
$script:assertions = 0
function Assert-Report {
  param([bool]$Condition, [string]$Failure)
  $script:assertions += 1
  if (-not $Condition) { throw $Failure }
}
Assert-Report ($parseErrors.Count -eq 0) 'proof script did not parse'
foreach ($functionName in @('Reject-ProofReport', 'Read-ProofProgress', 'New-ProofOutcome',
    'Add-ProofFailure', 'Invoke-ProofCleanupStep', 'Complete-ProofOutcome')) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -ceq $functionName
  }, $true))
  Assert-Report ($definitions.Count -eq 1) 'progress or outcome definition is not unique'
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}

$file = [IO.Path]::GetTempFileName()
function Observe-Report {
  param([string[]]$Lines, [switch]$Rethrow)
  [IO.File]::WriteAllText($file, ($Lines -join "`n") + "`n", (New-Object Text.UTF8Encoding $false))
  $state = [pscustomobject]@{
    Position = 0L; Pending = ''; Lines = 0; Text = [Text.StringBuilder]::new()
    Live = $false; LiveHealthLines = 0; Caught = $null; Failure = $null; FailureCause = 0L; Reads = 0
  }
  $captured = @(& {
    try {
      Read-ProofProgress -Path $file -State $state
      if ($Rethrow) { throw 'fixture-primary-failure' }
    } catch {
      $state.Caught = $_.Exception.Message
    }
  } 6>&1)
  $exitCode = 0
  if ($state.Caught) { $exitCode = 1 }
  [pscustomobject]@{
    Failure = $state.Caught; ExitCode = $exitCode; Accepted = $state.Text.ToString()
    State = $state
    Emitted = ($captured | ForEach-Object { $_.ToString() }) -join "`n"
  }
}

try {
  $overflow = Observe-Report -Lines @(1..4097 | ForEach-Object { 'CHECK ENTER window-message tick=1' })
  $accepted = @($overflow.Accepted -split "`n" | Where-Object { $_.Length -gt 0 }).Count
  Assert-Report ($accepted -eq 4096 -and $overflow.ExitCode -eq 1) 'original repeated-message witness did not retain the line bound'
  Write-Output 'PASS original-poll-emitter-witness accepted=4096 rejected=1'
  Assert-Report ($overflow.Failure -ceq 'proof-report-line-count' -and
    $overflow.State.Failure -ceq 'proof-report-line-count') 'line-count limit does not retain its distinct primary code'
  $reads = $overflow.State.Reads
  $poisonedOutput = @(& {
    try { Read-ProofProgress -Path $file -State $overflow.State }
    catch { $overflow.State.Caught = $_.Exception.Message }
  } 6>&1)
  Assert-Report ($overflow.State.Caught -ceq 'proof-report-line-count') 'poisoned report changed its first failure'
  Assert-Report ($overflow.State.Reads -eq $reads -and $poisonedOutput.Count -eq 0) 'poisoned report was reread or re-reported'
  $oversize = Observe-Report -Lines @('x' * (1MB + 1))
  Assert-Report ($oversize.Failure -ceq 'proof-report-size' -and $oversize.ExitCode -eq 1) 'report size limit lost its distinct fatal cause'
  Write-Output 'PASS report-limits line-count=4096 size=1048576 poisoned-reparse=0'

  $candidate = 'FAIL calibration window create/show events were incomplete'
  $original = Observe-Report -Lines @($candidate)
  Assert-Report ($original.ExitCode -eq 1 -and $original.Failure -ceq 'unsafe-proof-report') 'fixed slash candidate was not rejected'
  Assert-Report ($original.Emitted.Contains('unsafe-proof-line-redacted')) 'fixed slash rejection was not reported'
  Assert-Report (-not $original.Emitted.Contains($candidate) -and -not $original.Accepted.Contains($candidate)) 'rejected candidate leaked'
  Write-Output 'PASS fixed-slash-candidate rejected=1 disclosed=0 source-candidate-only=1'

  $envelope = @(
    'CHECK FAIL calibration tick=1',
    'DIAG calibration-failure code=calibration-window-events-incomplete stage=calibration-window-events primary=1',
    'DIAG calibration-control pid=9 creation_known=1 creation=1234 wait_known=1 wait=258 wait_error=0 attachment_known=1 attached=1 attach_attempts=1 attach_error=0 members_known=1 members=2'
  )
  $fixed = Observe-Report -Lines $envelope -Rethrow
  Assert-Report ($fixed.ExitCode -eq 1 -and $fixed.Failure -ceq 'fixture-primary-failure') 'safe envelope swallowed the primary failure'
  Assert-Report ($fixed.Accepted.Contains($envelope[0]) -and $fixed.Accepted.Contains($envelope[1])) 'safe failure envelope was not retained'
  Assert-Report ($fixed.Emitted.IndexOf($envelope[0]) -ge 0 -and
    $fixed.Emitted.IndexOf($envelope[1]) -gt $fixed.Emitted.IndexOf($envelope[0])) 'safe envelope was not emitted before rethrow'
  Assert-Report (-not $fixed.Emitted.Contains('CHECK EXIT calibration')) 'failure fabricated a success checkpoint'
  Write-Output 'PASS safe-envelope emitted-before-rethrow=1 failed-exit=1 failed-checkpoint=1'

  $unsafe = @(
    'DIAG path=C:\private\fixture.txt',
    'DIAG url=https://example.invalid/fixture',
    ('DIAG text=' + [char]0x03a9),
    ('DIAG ' + ('a' * 4096)),
    'UNKNOWN fixture-payload',
    ('DIAG control=' + [char]1)
  )
  foreach ($payload in $unsafe) {
    $rejected = Observe-Report -Lines @($envelope[0], $payload)
    $expected = 'unsafe-proof-report'
    $label = 'unsafe-proof-line-redacted'
    if ($payload.Length -gt 4096) { $expected = 'proof-report-line-length'; $label = $expected }
    Assert-Report ($rejected.ExitCode -eq 1 -and $rejected.Failure -ceq $expected) 'unsafe report payload was accepted'
    Assert-Report ($rejected.Emitted.Contains($label) -and
      -not $rejected.Emitted.Contains($payload) -and -not $rejected.Accepted.Contains($payload)) 'unsafe payload was disclosed'
    Assert-Report ($rejected.Accepted.Contains($envelope[0])) 'later rejection erased the earlier failure checkpoint'
  }
  Write-Output 'PASS unsafe-payloads cases=6 redacted=6 failed=6'

  $clean = New-ProofOutcome
  Add-ProofFailure -State $clean -Code $overflow.State.Failure -AlreadyReported
  $cleanOutput = @(& {
    foreach ($stage in @($clean.Resources.Keys)) {
      Invoke-ProofCleanupStep -State $clean -Stage $stage -Action {}
    }
  } 6>&1)
  $cleanResult = Complete-ProofOutcome $clean $overflow.State 0 2000
  Assert-Report ($cleanResult.ExitCode -eq 1 -and $cleanResult.Failure -ceq 'proof-report-line-count' -and
    $cleanResult.Cleanup -and -not $cleanResult.ReportValid) 'report rejection became a cleanup failure or successful exit'
  Assert-Report ($clean.Resources.Count -eq 7 -and $cleanOutput.Count -eq 14 -and
    $cleanResult.SecondaryFailures.Count -eq 0) 'independent successful cleanup stages were not all reported'

  $broken = New-ProofOutcome
  Add-ProofFailure -State $broken -Code 'proof-report-line-count' -AlreadyReported
  $attempts = [Collections.Generic.List[string]]::new()
  $brokenOutput = @(& {
    foreach ($stage in @($broken.Resources.Keys)) {
      Invoke-ProofCleanupStep -State $broken -Stage $stage -Action {
        $attempts.Add($Stage)
        if ($Stage -eq 'job' -or $Stage -eq 'settings') { throw 'fixed-inert-cleanup-failure' }
      }
    }
  } 6>&1)
  $brokenResult = Complete-ProofOutcome $broken $overflow.State 0 2000
  Assert-Report ($brokenResult.Failure -ceq 'proof-report-line-count' -and
    $brokenResult.SecondaryFailures.Count -eq 2) 'secondary cleanup faults replaced the report primary'
  Assert-Report (-not $brokenResult.Cleanup -and -not $brokenResult.Resources.job -and
    -not $brokenResult.Resources.settings -and $brokenResult.ExitCode -eq 1) 'cleanup or rollback failure was hidden'
  Assert-Report ($attempts.Count -eq 7 -and (($brokenOutput | ForEach-Object { $_.ToString() }) -join "`n").Contains('cleanup-settings-failed')) 'cleanup failure prevented later stages or its own reporting'
  Write-Output 'PASS cleanup-accounting report-fatal-clean=1 secondary-faults=2 stages-attempted=7'

  $native = [IO.File]::ReadAllText((Join-Path $root 'test\native\StartupTests.cpp'))
  $observer = [IO.File]::ReadAllText((Join-Path $root 'test\native\StartupObserver.h'))
  $proof = [IO.File]::ReadAllText($proofPath)
  Assert-Report ($native.Contains('reportCalibrationFailure(')) 'calibration failure boundary is not implemented'
  Assert-Report ($native.Contains('checkpoint("FAIL", "calibration");')) 'calibration failure checkpoint is missing'
  Assert-Report ($native.Contains('{ "calibration window create/show events were incomplete", "calibration-window-events-incomplete" }')) 'fixed source failure mapping is missing'
  Assert-Report ($native.Contains('failureCode(failure)')) 'terminal failure does not use the fixed code mapping'
  Assert-Report ($native -match 'calibration\(proof::Observer& observer, std::ofstream& report') 'calibration report sink is not required'
  Assert-Report ($observer.Contains('reportCalibrationWindows(')) 'early window context reporter is missing'
  Assert-Report ($proof.Contains('-TotalTimeoutMs 60000')) 'calibration preflight lacks its total bound'
  Assert-Report ($proof.IndexOf('calibration-preflight') -lt $proof.IndexOf('$runtimeInfo = (& node')) 'preflight does not precede runtime work'
  Assert-Report ($native.Contains('void pollingObservationCases()')) 'deterministic polling cardinality cases are missing'
  Assert-Report ($native.Contains('observedWait("error-feedback-wait"')) 'error feedback does not use a bounded reporting scope'
  Assert-Report ($native.Contains('id == "F10" ? 190000 : 15000')) 'the real watchdog fixture deadline changed'
  Assert-Report ($proof.Contains('if (-not $progress.Failure)')) 'cleanup does not avoid the poisoned report'
  Assert-Report ($proof.Contains('Invoke-ProofCleanupStep $outcome')) 'independent cleanup accounting is not wired'
  Assert-Report (-not $observer.Contains('check(!starts.count(event.pid), "PID reuse made trace identity ambiguous")')) 'final observer still rejects global PID reuse before relevance'
  Assert-Report ($observer.Contains('struct ProcessGraph')) 'process-instance reducer is missing'
  Assert-Report ($observer.Contains('CHECK ENTER final-observer-closure') -and $observer.Contains('FinalConditions[]')) 'fixed final-observer boundaries are missing'
  Assert-Report ($native.Contains('observer.bindHelper(worker.pid, worker.process.get(), worker.primaryThread.get())')) 'created helper registration is missing'
  Assert-Report ($native.Contains('pending footer text ink was not captured') -and $native.Contains('Closing this window lets startup continue in the background.')) 'actual footer property or ink evidence is missing'
  Assert-Report ($proof.Contains('footerInkPixels') -and $proof.Contains('footerBoundsVerified')) 'safe footer artifact fields are not validated'
  Assert-Report ($native.Contains('RDW_INVALIDATE | RDW_UPDATENOW | RDW_ALLCHILDREN')) 'settled real child/window capture is missing'
  Assert-Report ($observer.Contains('enum class ObservationProfile')) 'terminal observation still lacks explicit activation profiles'
  $fixture = [IO.File]::ReadAllText((Join-Path $root 'test\native\Launcher.fixture.mjs.in')).Replace("`r`n","`n")
  $sha = [Security.Cryptography.SHA256]::Create()
  try { $digest = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($fixture))).Replace('-','').ToLowerInvariant() }
  finally { $sha.Dispose() }
  Assert-Report ($digest -ceq '1f370a079387f32d8d9d755bb8a63c18bd485800f5eab50ebcfa7193a1c1432a') 'the closed fixture capability source changed'
  Assert-Report ($native.Contains('ObservationProfile::nativeFixture, verifyFixedFixture(options[L"--fixture"])')) 'native profile lacks actual fixed-source verification'
  Assert-Report (-not $observer.Contains('const std::vector<DWORD>& roots, bool installed')) 'closed observation still overloads the installed flag'
  Assert-Report ($observer.Contains('raw_unknown_metadata=') -and $observer.Contains('visible_ambient_consoles=')) 'raw metadata and ambient visibility are not reported separately'
  Assert-Report ($native.Contains('ObservationProfile::installedBusy') -and $native.Contains('ObservationProfile::installedFunctionality')) 'real installed contexts are not explicit'
  Assert-Report ($observer.Contains('ambientConsoleScoped(ObservationProfile profile')) 'ambient binding lacks its explicit profile guard'
  $definition = [regex]::Matches($observer, '(?ms)^inline bool completeNonPresenterTransient\(.*?^\}')
  $types = @('WindowKind', 'WindowFact', 'HelperScopeEvidence', 'WindowLifetime')
  $typeEnds = @($types | ForEach-Object {
    $pattern = "(?ms)^struct $_\b.*?^};"
    if ($_ -eq 'WindowKind') { $pattern = '(?m)^enum class WindowKind \{[^\r\n]*};' }
    $match = [regex]::Match($observer, $pattern)
    if ($match.Success) { $match.Index + $match.Length } else { [int]::MaxValue }
  })
  Assert-Report ($definition.Count -eq 1 -and
    $definition[0].Index -ge ($typeEnds | Measure-Object -Maximum).Maximum -and
    $definition[0].Index -lt $observer.IndexOf('inline std::vector<WindowLifetime> windowLifetimes')) 'transient helper precedes its complete prerequisite types'
  Write-Output "PASS proof-report-fixtures assertions=$script:assertions"
} finally {
  Remove-Item -LiteralPath $file -Force
}
