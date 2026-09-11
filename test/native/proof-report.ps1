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
    'Add-ProofFailure', 'Invoke-ProofCleanupStep', 'Complete-ProofOutcome', 'Receive-NativeFailure')) {
  $definitions = @($ast.FindAll({
    param($node)
    $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $node.Name -ceq $functionName
  }, $true))
  Assert-Report ($definitions.Count -eq 1) 'progress or outcome definition is not unique'
  . ([scriptblock]::Create($definitions[0].Extent.Text))
}
$suiteDefinitions = @($ast.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -ceq 'Test-NativeSuiteResult'
}, $true))
Assert-Report ($suiteDefinitions.Count -le 1) 'suite adapter definition is not unique'
if ($suiteDefinitions.Count -eq 1) { . ([scriptblock]::Create($suiteDefinitions[0].Extent.Text)) }
$suiteGates = @($ast.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.IfStatementAst] -and
    $node.Clauses.Count -eq 1 -and
    $node.Clauses[0].Item2.Extent.Text.Contains('native suite failed or did not run all 11 release fixtures.')
}, $true))
Assert-Report ($suiteGates.Count -eq 1) 'actual release suite result gate is not unique'
$rejectSuite = [scriptblock]::Create($suiteGates[0].Clauses[0].Item1.Extent.Text)

$file = [IO.Path]::GetTempFileName()
function Observe-Report {
  param([string[]]$Lines, [switch]$Rethrow)
  [IO.File]::WriteAllText($file, ($Lines -join "`n") + "`n", (New-Object Text.UTF8Encoding $false))
  $state = [pscustomobject]@{
    Position = 0L; Pending = ''; Lines = 0; Text = [Text.StringBuilder]::new()
    Live = $false; LiveHealthLines = 0; Caught = $null; Failure = $null; FailureCause = 0L; Reads = 0
    NativeFailure = $null; NativeStage = $null; NativeRecorded = $false
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
  $fixtureLines = @(1..11 | ForEach-Object { 'PASS F{0:00}' -f $_ })
  $fixtureReport = Observe-Report -Lines $fixtureLines
  $fixtureOutcome = New-ProofOutcome
  foreach ($stage in @($fixtureOutcome.Resources.Keys)) { $fixtureOutcome.Resources[$stage] = $true }
  $result = Complete-ProofOutcome $fixtureOutcome $fixtureReport.State 0 2000
  Assert-Report ($result.Text.Contains("`r`n") -and -not (& $rejectSuite)) 'actual Windows AppendLine fixture results were rejected'
  Write-Output 'PASS windows-appendline-adapter exact-fixtures=11 accepted=1'
  $validSuite = $result
  $result = $validSuite.PSObject.Copy()
  $result.Text = $result.Text.Replace("`r`n", "`n")
  Assert-Report (-not (& $rejectSuite)) 'LF fixture results were rejected'
  $invalidLabels = @(
    (($fixtureLines | Select-Object -First 10) -join "`r`n"),
    (($fixtureLines + 'PASS F11') -join "`r`n"),
    ((@($fixtureLines | Select-Object -First 10) + 'PASS F10') -join "`r`n"),
    (($fixtureLines + 'PASS F12') -join "`r`n"),
    (($fixtureLines + 'PASS F00') -join "`r`n"),
    (($fixtureLines + 'PASS F1') -join "`r`n"),
    (($fixtureLines + 'pass f01') -join "`r`n"),
    (($fixtureLines + 'PASS  F01') -join "`r`n"),
    (($fixtureLines + 'PASS F01 trailing') -join "`r`n")
  )
  foreach ($text in $invalidLabels) {
    $result = $validSuite.PSObject.Copy()
    $result.Text = $text + "`r`n"
    Assert-Report ([bool](& $rejectSuite)) 'missing duplicate extra or malformed fixture labels were accepted'
  }
  $invalidOutcomes = @(
    @{ DriverExitCode = 1 }, @{ DriverExitCode = $null }, @{ ExitCode = 1 },
    @{ ReportValid = $false }, @{ Cleanup = $false }, @{ Failure = 'native-fixed-failure' },
    @{ SecondaryFailures = @('cleanup-fixed-failure') }, @{ NonNativeFailure = $true }
  )
  foreach ($change in $invalidOutcomes) {
    $result = $validSuite.PSObject.Copy()
    foreach ($key in $change.Keys) { $result.$key = $change[$key] }
    Assert-Report ([bool](& $rejectSuite)) 'failed driver report or cleanup was accepted as a complete suite'
  }
  Write-Output 'PASS suite-result-shapes accepted=2 invalid-labels=9 invalid-outcomes=8'

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

  $nativeFailure = Observe-Report -Lines @('FAIL code=fixture-observed-shape stage=fixture-observed-parse')
  $nativeState = New-ProofOutcome
  Receive-NativeFailure $nativeState $nativeFailure.State
  Assert-Report ($nativeState.Failure -ceq 'fixture-observed-shape' -and $nativeState.PrimaryOrigin -ceq 'native') 'native setup failure was not captured as primary'
  Assert-Report ($nativeFailure.State.NativeStage -ceq 'fixture-observed-parse') 'native setup stage was lost'
  Add-ProofFailure -State $nativeState -Code 'owned-process-residue' -Origin cleanup -AlreadyReported
  foreach ($stage in @($nativeState.Resources.Keys)) { $nativeState.Resources[$stage] = $true }
  $residue = Complete-ProofOutcome $nativeState $nativeFailure.State 1 2000
  Assert-Report ($residue.Failure -ceq 'fixture-observed-shape' -and $residue.SecondaryFailures.Count -eq 1 -and
    $residue.SecondaryFailures[0].Code -ceq 'owned-process-residue') 'residue replaced the native setup failure'
  Assert-Report ($residue.ExitCode -eq 1 -and $residue.Cleanup -and $residue.NonNativeFailure) 'cleanup upgraded native failure or accepted residue as an intended negative'
  Write-Output 'PASS native-primary-preserved residue-secondary=1 cleanup-does-not-upgrade=1'

  $invokeDefinitions = @($ast.FindAll({
    param($item)
    $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $item.Name -ceq 'Invoke-NativeProof'
  }, $true))
  if ($invokeDefinitions.Count -ne 1) { throw 'actual native wrapper is missing or ambiguous' }
  $completedSeams = @($invokeDefinitions[0].FindAll({
    param($item)
    $item -is [System.Management.Automation.Language.IfStatementAst] -and
      $item.Clauses.Count -eq 1 -and $item.Clauses[0].Item1.Extent.Text -ceq '$null -eq $exitObservedAt' -and
      $item.Clauses[0].Item2.Extent.Text.Contains('CHECK EXIT process-wait code=')
  }, $true))
  $finalReadSeams = @($invokeDefinitions[0].FindAll({
    param($item)
    $item -is [System.Management.Automation.Language.IfStatementAst] -and
      $item.Clauses.Count -eq 1 -and $item.Clauses[0].Item1.Extent.Text.Contains('$progress.Failure') -and
      ($item.Clauses[0].Item2.Extent.Text.Contains('proof-report-read-failed') -or
       $item.Clauses[0].Item2.Extent.Text.Contains('Receive-CompletedProof'))
  }, $true))
  $completionHelpers = @($ast.FindAll({
    param($item)
    $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $item.Name -ceq 'Receive-CompletedProof'
  }, $true))
  if ($completedSeams.Count -ne 1 -or $finalReadSeams.Count -ne 1 -or $completionHelpers.Count -gt 1) {
    throw 'actual completed-driver report seams are missing or ambiguous'
  }
  if ($completionHelpers.Count) { . ([scriptblock]::Create($completionHelpers[0].Extent.Text)) }
  $completedSeam = [scriptblock]::Create($completedSeams[0].Extent.Text)
  $finalReadSeam = [scriptblock]::Create($finalReadSeams[0].Extent.Text)
  function Invoke-CompletionCase {
    param([string]$Mode)
    $initial = 'CHECK ENTER fixture-live-poll'
    if ($Mode -eq 'recorded') { $initial = 'FAIL code=actor-unexpected stage=app-startup-reduction' }
    if ($Mode -eq 'poisoned') { $initial = 'unsafe fixture payload' }
    $seen = Observe-Report -Lines @($initial)
    $progress = $seen.State
    $outcome = New-ProofOutcome
    foreach ($stage in @($outcome.Resources.Keys)) { $outcome.Resources[$stage] = $true }
    if ($Mode -eq 'recorded') { Receive-NativeFailure $outcome $progress }
    if ($Mode -eq 'poisoned') {
      Add-ProofFailure -State $outcome -Code $progress.Failure -Origin report -AlreadyReported
    }
    if ($Mode -eq 'earlier') { Add-ProofFailure $outcome 'earlier-wrapper-fault' -AlreadyReported }
    $tail = ''
    if ($Mode -in @('late','cleanup','earlier')) {
      $tail = "FAIL code=actor-unexpected stage=app-startup-reduction`n"
    }
    if ($Mode -eq 'incomplete') { $tail = 'FAIL code=actor-unexpected' }
    [IO.File]::AppendAllText($file, $tail, (New-Object Text.UTF8Encoding $false))
    $reads = $progress.Reads
    $Report = $file
    $process = [pscustomobject]@{ ExitCode = 1 }
    $clock = [pscustomobject]@{ ElapsedMilliseconds = 100 }
    $exitObservedAt = $null
    $driverExit = $null
    $completionRead = $false
    $captured = @{ Result = $null }
    $output = @(& {
      . $completedSeam
      if ($Mode -eq 'cleanup') {
        Invoke-ProofCleanupStep $outcome 'files' { throw 'inert-late-cleanup-fault' }
      }
      . $finalReadSeam
      $captured.Result = Complete-ProofOutcome $outcome $progress $driverExit 2000
    } 6>&1)
    [pscustomobject]@{
      State = $outcome; Progress = $progress; Result = $captured.Result; ReadsBefore = $reads
      Emitted = ($output | ForEach-Object { $_.ToString() }) -join "`n"
    }
  }
  $late = Invoke-CompletionCase late
  if ($late.State.Failure -ceq 'native-exit-failed') {
    Write-Output "CHECK completion-original generic-primary=1 native_recorded=$($late.Progress.NativeRecorded) specific_available=$([bool]$late.Progress.NativeFailure)"
  }
  Assert-Report ($late.State.Failure -ceq 'actor-unexpected' -and $late.State.PrimaryOrigin -ceq 'native') 'actual completion suppressed the available specific native failure'
  Assert-Report ($late.Progress.NativeRecorded -and $late.Result.ExitCode -eq 1 -and
    $late.State.SecondaryFailures.Count -eq 0) 'specific native completion duplicated or upgraded the failed exit'
  $recorded = Invoke-CompletionCase recorded
  Assert-Report ($recorded.State.Failure -ceq 'actor-unexpected' -and $recorded.Progress.NativeRecorded -and
    $recorded.State.SecondaryFailures.Count -eq 0) 'already imported native failure was duplicated at completion'
  $generic = Invoke-CompletionCase generic
  Assert-Report ($generic.State.Failure -ceq 'native-exit-failed' -and -not $generic.Progress.NativeRecorded -and
    $generic.Result.ExitCode -eq 1) 'generic failed exit was lost or marked as an imported native record'
  $poisoned = Invoke-CompletionCase poisoned
  Assert-Report ($poisoned.State.Failure -ceq 'unsafe-proof-report' -and
    $poisoned.Progress.Reads -eq $poisoned.ReadsBefore -and -not $poisoned.Result.ReportValid -and
    $poisoned.Result.ExitCode -eq 1) 'completion reread or upgraded a poisoned report'
  $incomplete = Invoke-CompletionCase incomplete
  Assert-Report (-not $incomplete.Result.ReportValid -and $incomplete.Result.ExitCode -eq 1 -and
    $incomplete.State.Failure -ceq 'incomplete-proof-checkpoint') 'incomplete completion report became a valid result'
  $lateCleanup = Invoke-CompletionCase cleanup
  Assert-Report ($lateCleanup.State.Failure -ceq 'actor-unexpected' -and $lateCleanup.State.SecondaryFailures.Count -eq 1 -and
    $lateCleanup.State.SecondaryFailures[0].Code -ceq 'cleanup-files-failed' -and -not $lateCleanup.Result.Cleanup) 'late cleanup replaced the specific completed native failure'
  $earlier = Invoke-CompletionCase earlier
  Assert-Report ($earlier.State.Failure -ceq 'earlier-wrapper-fault' -and $earlier.State.SecondaryFailures.Count -eq 1 -and
    $earlier.State.SecondaryFailures[0].Code -ceq 'actor-unexpected') 'completed native record replaced an earlier real primary'
  Write-Output 'PASS completed-native-report configurations=7 assertions=8 specific-before-fallback=1'

  $composerDefinitions = @($ast.FindAll({
    param($item)
    $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
      $item.Name -ceq 'Assert-ComposerCompletion'
  }, $true))
  if ($composerDefinitions.Count -ne 1) { throw 'actual composer completion guard is missing or ambiguous' }
  . ([scriptblock]::Create($composerDefinitions[0].Extent.Text))
  $passLine = 'PASS app-startup-contract-v2 profile=native-inert verdict=pass'
  $composerCases = @(
    @{ Lines=@($passLine); Exit=0; Accept=$true },
    @{ Lines=@(); Exit=0; Accept=$false },
    @{ Lines=@($passLine,$passLine); Exit=0; Accept=$false },
    @{ Lines=@($passLine+' malformed'); Exit=0; Accept=$false },
    @{ Lines=@($passLine,'synthetic-private-composer-output'); Exit=0; Accept=$false },
    @{ Lines=@($passLine); Exit=7; Accept=$false }
  )
  $composerReporting = $true
  foreach ($case in $composerCases) {
    $observed = @{ Accepted=$false; Failure=$null }
    $output = @(& {
      try {
        Assert-ComposerCompletion -Lines $case.Lines -ExitCode $case.Exit
        $observed.Accepted = $true
      } catch { $observed.Failure = $_.Exception.Message }
    })
    Assert-Report ($observed.Accepted -eq $case.Accept -and
      ($case.Accept -or $observed.Failure -ceq 'The composed native startup contract did not pass.')) 'actual composer guard accepted missing invalid or failed completion'
    $text = $output -join "`n"
    $composerReporting = $composerReporting -and -not $text.Contains('synthetic-private-composer-output')
    if (-not $case.Accept) {
      $composerReporting = $composerReporting -and $text.Contains("exit_code=$($case.Exit)")
    } else { $composerReporting = $composerReporting -and $output.Count -eq 1 -and $output[0] -ceq $passLine }
  }
  Assert-Report $composerReporting 'composer completion reporting lost the numeric exit or exposed unknown output'
  $composerCalls = @($ast.FindAll({
    param($item)
    $item -is [System.Management.Automation.Language.AssignmentStatementAst] -and
      $item.Left.Extent.Text -ceq '$composerOutput'
  }, $true))
  if ($composerCalls.Count -ne 1) { throw 'actual composer invocation capture is missing or ambiguous' }
  $statements = @($composerCalls[0].Parent.Statements)
  $position = [array]::IndexOf($statements, $composerCalls[0])
  Assert-Report ($position -ge 0 -and $position + 2 -lt $statements.Count -and
    $composerCalls[0].Right.Extent.Text.Contains('--compose-native') -and
    $statements[$position+1].Extent.Text -ceq '$composerExit = $LASTEXITCODE' -and
    $statements[$position+2].Extent.Text -ceq 'Assert-ComposerCompletion -Lines $composerOutput -ExitCode $composerExit') 'composer stdout and immediate native status do not feed the actual guard'
  Write-Output 'PASS composer-completion-guard configurations=6 assertions=8 stdout-and-exit-required=1'

  $workflow = [IO.File]::ReadAllText((Join-Path $root '.github\workflows\wack.yml'))
  $journeyStep = [regex]::Match($workflow, '(?ms)^      - name: Exercise installed certification journey\r?\n.*?        run: \|\r?\n(.*?)(?=^      - name:)')
  if (-not $journeyStep.Success) { throw 'actual installed journey workflow step is missing' }
  $journeyScript = [regex]::Replace($journeyStep.Groups[1].Value, '(?m)^          ', '')
  $journeyScript = $journeyScript.Replace('${{ matrix.architecture }}', 'x64').Replace('${{ matrix.source }}', 'package')
  $journeyTokens = $null
  $journeyErrors = $null
  $journeyAst = [System.Management.Automation.Language.Parser]::ParseInput(
    $journeyScript, [ref]$journeyTokens, [ref]$journeyErrors)
  if ($journeyErrors.Count) { throw 'actual installed journey workflow step did not parse' }
  foreach ($name in @('New-JourneyOutput','Write-JourneyProgress','Assert-InstalledJourneyCompletion')) {
    $definitions = @($journeyAst.FindAll({
      param($item)
      $item -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $item.Name -ceq $name
    }, $true))
    if ($definitions.Count -ne 1) { throw 'actual installed journey output guard is missing or ambiguous' }
    . ([scriptblock]::Create($definitions[0].Extent.Text))
  }
  $journeyPass = 'PASS installed-journey scenario=busy-port-refusal architecture=x64 source=package cleanup=complete'
  $journeyCases = @(
    @{ Lines=@('DIAG busy-holder-cleanup phase=completed',$journeyPass); Exit=0; Accept=$true },
    @{ Lines=@(); Exit=0; Accept=$false },
    @{ Lines=@($journeyPass,$journeyPass); Exit=0; Accept=$false },
    @{ Lines=@($journeyPass.Replace('busy-port-refusal','certification-functionality').Replace('source=package','source=bundle')); Exit=0; Accept=$false },
    @{ Lines=@('{"phase":"behavior"}','PASS app-startup-contract-v2 profile=installed-busy scope=capture'); Exit=0; Accept=$false },
    @{ Lines=@($journeyPass); Exit=9; Accept=$false }
  )
  $journeyReporting = $true
  foreach ($case in $journeyCases) {
    $state = New-JourneyOutput
    $forwarded = @($case.Lines | Write-JourneyProgress -State $state)
    $outcome = @{ Accepted=$false; Failure=$null }
    $diagnostics = @(& {
      try {
        Assert-InstalledJourneyCompletion $state $case.Exit 'busy-port-refusal' 'x64' 'package'
        $outcome.Accepted = $true
      } catch { $outcome.Failure = $_.Exception.Message }
    } 6>&1)
    Assert-Report ($outcome.Accepted -eq $case.Accept -and
      ($case.Accept -or $outcome.Failure -ceq 'The installed journey did not finish its expected cleanup.')) 'workflow accepted an incomplete or mismatched installed journey'
    $journeyReporting = $journeyReporting -and (($forwarded -join "`n") -ceq ($case.Lines -join "`n"))
    if (-not $case.Accept) {
      $text = ($diagnostics | ForEach-Object { $_.ToString() }) -join "`n"
      $journeyReporting = $journeyReporting -and $text.Contains("exit_code=$($case.Exit)")
    }
  }
  Assert-Report $journeyReporting 'workflow suppressed live output or lost the actual failed exit'
  $journeyCalls = @($journeyAst.FindAll({
    param($item)
    $item -is [System.Management.Automation.Language.PipelineAst] -and
      $item.Extent.Text.StartsWith('npm run msix:prove --')
  }, $true))
  $journeyWiring = $journeyCalls.Count -eq 3
  foreach ($call in $journeyCalls) {
    $statements = @($call.Parent.Statements)
    $position = [array]::IndexOf($statements, $call)
    $journeyWiring = $journeyWiring -and $call.Extent.Text.Contains('Write-JourneyProgress -State $journey') -and
      $position -ge 0 -and $position + 2 -lt $statements.Count -and
      $statements[$position+1].Extent.Text -ceq '$journeyExit = $LASTEXITCODE' -and
      $statements[$position+2].Extent.Text.StartsWith('Assert-InstalledJourneyCompletion $journey $journeyExit ')
  }
  Assert-Report $journeyWiring 'the actual installed commands do not immediately bind exit and output to the workflow guard'
  Write-Output 'PASS installed-journey-workflow configurations=6 assertions=8 live-output=1 final-record-and-exit=1'

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
  Assert-Report ($digest -ceq '300a0d2d3b1c195bddea2ccca076658f82ce1db6249b9cb5ec2d15163d8fc01d') 'the closed fixture capability source changed'
  Assert-Report ($native.Contains('ObservationProfile::nativeFixture, verifyFixedFixture(options[L"--fixture"])')) 'native profile lacks actual fixed-source verification'
  Assert-Report (-not $observer.Contains('const std::vector<DWORD>& roots, bool installed')) 'closed observation still overloads the installed flag'
  Assert-Report ($observer.Contains('unknown_object_metadata=') -and $observer.Contains('unassessed_global=')) 'raw object uncertainty and unassessed global observations are not separate'
  Assert-Report ($native.Contains('ObservationProfile::installedBusy') -and $native.Contains('ObservationProfile::installedFunctionality')) 'real installed contexts are not explicit'
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
  Assert-Report ($observer.Contains('EVENT_TRACE_FLAG_PROCESS | EVENT_TRACE_FLAG_THREAD') -and
    $observer.Contains('EVENT_TRACE_TYPE_DC_START') -and $observer.Contains('EVENT_TRACE_TYPE_DC_END')) 'minimal thread or process rundown capture is missing'
  Assert-Report ($observer.Contains('property(event, L"TThreadId")') -and
    $observer.Contains('EventHeader.EventDescriptor.Version') -and
    $observer.Contains('IsEqualGUID(event->EventHeader.ProviderId, threadClass)')) 'thread identity does not use its class/version payload'
  Assert-Report ($observer.Contains('creationObserved') -and $observer.Contains('coverage_begin_qpc=') -and
    $observer.Contains('if (!value.creationObserved) continue;')) 'rundown coverage is confused with actual process creation'
  Assert-Report ($observer.Contains('ThreadRecordLimit = 65536, ThreadIdentityLimit = 32768') -and
    $observer.Contains('appendThreadEvent(self->threads_')) 'finite thread capture limits are not wired'
  Assert-Report ($observer -notmatch 'property\(event, L"(UniqueProcessKey|UserSID|StackBase|StackLimit|UserStackBase|UserStackLimit|StartAddr|Win32StartAddr|TebBase|SubProcessTag)"') 'unnecessary sensitive identity fields are decoded'
  Assert-Report ($observer.Contains('source_error=') -and $observer.Contains('recovered_source_known=') -and
    $observer.Contains('source_reason=') -and $observer.Contains('lifecycle_only=')) 'raw query gaps and recovered source provenance are not separate'
  Assert-Report ($native.Contains('source-lifetime-cases cases=24 passed=24') -and
    $native.Contains('observed("source-lifetime-cases", [] { sourceLifetimeCases(); });')) 'finite lifetime rows are not in the existing preflight'
  $ordered = $true
  foreach ($pair in @(
    @('struct LifecycleEvent', 'struct LifetimeRange'),
    @('struct LifetimeRange', 'inline std::vector<LifetimeRange> lifetimeRanges'),
    @('struct ThreadEvent', 'struct ThreadGraph'),
    @('struct ThreadGraph', 'struct WindowFact'),
    @('struct WindowFact', 'struct SourceWitness'),
    @('struct SourceResolution', 'inline SourceResolution resolveSource'),
    @('inline SourceResolution resolveSource', 'class Observer')
  )) {
    $first = $observer.IndexOf($pair[0])
    $second = $observer.IndexOf($pair[1])
    $ordered = $ordered -and $first -ge 0 -and $second -gt $first
  }
  Assert-Report $ordered 'source lifetime helpers precede their complete prerequisite types'
  Assert-Report ($observer.Contains('SemanticOperationLimit = 256, SemanticRecordLimit = 16384') -and
    $observer.Contains('std::min<size_t>(20, context.size())')) 'semantic input or context bounds differ'
  $callerMethod = [regex]::Match($observer, '(?ms)^    void bindSemanticCaller\(.*?^    \}')
  Assert-Report ($callerMethod.Success -and $callerMethod.Value -notmatch 'registerProcess|retainActor|bindRoot|bindHelper|bindClient') 'diagnostic caller entered acceptance registration'
  Assert-Report ($observer.Contains('opaque_image_group=') -and $observer.Contains('delegated_association_known=0') -and
    $observer.Contains('semantic_acceptance_input=0')) 'safe image or unresolved-delegation reporting is missing'
  Assert-Report ($observer.Contains('std::wstring diagnosticCommand;') -and
    $observer.Contains('rundown == Rundown::none ? command : std::wstring{}')) 'private rundown commands changed the acceptance command field'
  Assert-Report ($native.Contains('semantic-cases cases=16 passed=16') -and
    $native.Contains('observed("semantic-evidence-cases", [] { semanticEvidenceCases(); });')) 'bounded semantic cases are not in existing preflight'
  Assert-Report ($native.Contains('collectSemanticOperations(observer, control, operationOrdinal, operationActive)') -and
    $native.Contains('fs::rename(temporary, path)') -and $native.Contains('semantic channel did not finish", 10000')) 'atomic bounded semantic channel is not wired'
  $frozen = [ordered]@{
    visibleIn = '30eb5e1b19c3f428cf7b4068947b54a92cdea0ae64bc8ca4e4c165219c94a0dc'
    visibleBoundConsole = '48599faaf6450608d2c6d3fbcf298b3b8f9d15e31aa1f9c558befade9b2bb22f'
    bindingReady = '0e155c4c6a212651289cdd42b8d2d0f2726f9cb0958629286d2fdbdaf5bc8bf3'
    completeNonPresenterTransient = '357011e39b1e79a0257e63dc359e06c563db116d0e5d767f236d49d214ce50b8'
    correlateWindows = '94faa76da67796b33e80906a6f03d377422e79f4f258db97b387b4a8c26cf3f3'
    requireCalibrationLifetimes = '7f51724f7e38120cf885fe032dddcb2f365af06d72aa0c43417c89be7e09a236'
  }
  $methods = @('requireCalibrationLifetimes')
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    foreach ($name in $frozen.Keys) {
      $prefix = '^inline '
      $end = '^\}'
      if ($name -in $methods) { $prefix = '^    [^ \t\r\n]'; $end = '^    \}' }
      $matches = [regex]::Matches($observer.Replace("`r`n", "`n"), "(?ms)$prefix[^\r\n]*\b$name\(.*?$end")
      $digest = ''
      if ($matches.Count -eq 1) {
        $value = $matches[0].Value
        $digest = [BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($value))).Replace('-','').ToLowerInvariant()
      }
      Assert-Report ($digest -ceq $frozen[$name]) "frozen acceptance definition changed: $name"
    }
  } finally { $sha.Dispose() }
  $installed = [IO.File]::ReadAllText((Join-Path $root 'scripts\msix-proof.mjs'))
  Assert-Report ($installed.Contains('createSemanticCapture(root, architecture, mode, source)') -and
    -not $installed.Contains("process.argv.indexOf('--source')")) 'descriptor still reparses the source option'
  Assert-Report ($observer.Contains('first_failed=') -and $observer.Contains('semanticCli(args)') -and
    $native.Contains('caller-context-cases rows=8 passed=8')) 'bounded caller recognition or guard evidence is missing'
  Assert-Report ($observer.Contains('id_object_process=') -and $observer.Contains('shared_principal_limit=20') -and
    $observer.Contains('consoleFactInSegment(event, windows_[row], resolution[row])')) 'bounded existing-console context is missing'
  foreach ($name in @('Test-HostCompletion','Test-StartupControlResult')) {
    $definition = @($ast.FindAll({
      param($node)
      $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -ceq $name
    }, $true))
    if ($definition.Count -ne 1) { throw 'host acceptance function is not unique' }
    . ([scriptblock]::Create($definition[0].Extent.Text))
  }
  $expected = [pscustomobject]@{ Context = 'N3'; Binding = @{
    captureId = 'a' * 32; commit = 'b' * 40; tree = 'c' * 40
    architecture = 'x64'; proofInputDigest = 'd' * 64; creationReceiptDigest = 'e' * 64
  } }
  $h = $expected.Binding
  $hostLine = "DIAG host-completion-v2 context=N3 captureId=$($h.captureId) commit=$($h.commit) tree=$($h.tree) architecture=x64 proofInputDigest=$($h.proofInputDigest) creationReceiptDigest=$($h.creationReceiptDigest) beginEvaluated=1 endEvaluated=1 beginState=satisfied endState=satisfied registryView=native64 hiveSamplesBefore=2 hiveSamplesAfter=2 helperSnapshotPairs=2 helpersUnchanged=1 hostState=satisfied primaryReason=none"
  $nativeError = 'FAIL code=n3-visible-coordinator-terminal'
  $controlCases = @(
    @{ Context='preflight'; Text=$hostLine.Replace('context=N3','context=preflight')+"`nPASS calibration-preflight;controls=2;product-starts=0;node-starts=0"; Exit=0; Accept=$true },
    @{ Context='preflight'; Text='PASS calibration-preflight;controls=2;product-starts=0;node-starts=0'; Exit=0; Accept=$false },
    @{ Context='N3'; Text=$hostLine; Exit=1; Accept=$true },
    @{ Context='N3'; Text=''; Exit=1; Accept=$false },
    @{ Context='N3'; Text=$hostLine.Replace('endState=satisfied','endState=unknown'); Exit=1; Accept=$false },
    @{ Context='N3'; Text=$hostLine.Replace('helpersUnchanged=1','helpersUnchanged=0').Replace('hostState=satisfied','hostState=violated'); Exit=1; Accept=$false },
    @{ Context='N3'; Text=$hostLine+"`n"+$hostLine; Exit=1; Accept=$false },
    @{ Context='N3'; Text=$hostLine.Replace($h.proofInputDigest,('f'*64)); Exit=1; Accept=$false },
    @{ Context='N3'; Text=$hostLine.Replace('architecture=x64','architecture=arm64'); Exit=1; Accept=$false },
    @{ Context='N3'; Text=$hostLine.Replace($h.captureId,('f'*32)); Exit=1; Accept=$false },
    @{ Context='N3'; Text=$hostLine.Replace('beginEvaluated=1','beginEvaluated=0'); Exit=1; Accept=$false },
    @{ Context='N1'; Text=''; Exit=1; Accept=$true }
  )
  foreach ($case in $controlCases) {
    $expected.Context = $case.Context
    $control = [pscustomobject]@{
      ExitCode=$case.Exit; Cleanup=$true; ReportValid=$true; NonNativeFailure=$false
      Failure=$nativeError; Text=$case.Text+"`n"+$nativeError
    }
    $accepted = Test-StartupControlResult $control $expected $nativeError
    Assert-Report ($accepted -eq $case.Accept -and $control.Failure -ceq $nativeError) 'host completion did not govern the actual control acceptance independently'
  }
  Write-Output 'PASS semantic-diagnostics frozen-definitions=6 separate-registration=1'
  Write-Output 'PASS host-completion-consumer configurations=12 expected-native-primary-preserved=1'

  $builderTokens = $null
  $builderErrors = $null
  $builderAst = [System.Management.Automation.Language.Parser]::ParseFile(
    (Join-Path $root 'scripts\build-native-launcher.ps1'), [ref]$builderTokens, [ref]$builderErrors)
  if ($builderErrors.Count) { throw 'builder fixture source did not parse' }
  $resolution = @($builderAst.FindAll({
    param($item)
    if ($item -is [System.Management.Automation.Language.AssignmentStatementAst]) {
      return $item.Left -is [System.Management.Automation.Language.VariableExpressionAst] -and
        $item.Left.VariablePath.UserPath -in @('nodeCommand', 'node')
    }
    if ($item -is [System.Management.Automation.Language.IfStatementAst]) {
      foreach ($clause in $item.Clauses) {
        if (@($clause.Item1.FindAll({
          param($value)
          $value -is [System.Management.Automation.Language.VariableExpressionAst] -and
            $value.VariablePath.UserPath -in @('nodeCommand', 'node')
        }, $true)).Count) { return $true }
      }
    }
    return $false
  }, $true))
  $creationCommands = @($builderAst.FindAll({
    param($item)
    $item -is [System.Management.Automation.Language.CommandAst] -and $item.GetCommandName() -ceq 'Start-Process'
  }, $true))
  $recordCommands = @($builderAst.FindAll({
    param($item)
    $item -is [System.Management.Automation.Language.CommandAst] -and
      $item.InvocationOperator -eq [System.Management.Automation.Language.TokenKind]::Ampersand -and
      $item.CommandElements[0].Extent.Text -cin @('node', '$node')
  }, $true))
  if ($resolution.Count -lt 1 -or $creationCommands.Count -ne 1 -or $recordCommands.Count -ne 1) {
    throw 'actual builder Node seams are missing or ambiguous'
  }
  $creationSeam = [scriptblock]::Create($creationCommands[0].Extent.Text)
  $recordTarget = $recordCommands[0].CommandElements[0]
  function Invoke-BuilderNodeCase {
    param($Case)
    $state = [pscustomobject]@{
      Created = [Collections.Generic.List[object]]::new()
      Recorded = [Collections.Generic.List[object]]::new()
      Lookups = [Collections.Generic.List[object]]::new()
      PathChecks = [Collections.Generic.List[object]]::new()
      Error = $null
    }
    function Get-Command {
      [CmdletBinding()]
      param([string]$Name, [string]$CommandType, [switch]$All)
      $state.Lookups.Add([pscustomobject]@{ Name=$Name; Type=$CommandType; All=[bool]$All })
      $Case.Commands
    }
    function Test-Path {
      param([object]$LiteralPath, [string]$PathType)
      $state.PathChecks.Add([pscustomobject]@{ Path=$LiteralPath; Type=$PathType })
      $Case.ValidPaths -ccontains $LiteralPath
    }
    function Start-Process {
      param([object]$FilePath, $ArgumentList, $WorkingDirectory,
        [switch]$NoNewWindow, [switch]$PassThru, $RedirectStandardOutput, $RedirectStandardError)
      $state.Created.Add($FilePath)
      [pscustomobject]@{ Inert = $true }
    }
    function Record-Node {
      param([object]$FilePath)
      $state.Recorded.Add($FilePath)
    }
    $IncludeProofTools = $Case.Proof
    $root = 'C:\inert\source'
    $arguments = 'fixed-inert-arguments'
    $creationReport = 'C:\inert\output.tap'
    $creationError = 'C:\inert\output.err'
    try {
      foreach ($statement in $resolution) {
        $parent = $statement.Parent
        $proofOnly = $false
        while ($null -ne $parent) {
          if ($parent -is [System.Management.Automation.Language.IfStatementAst] -and
              $parent.Clauses[0].Item1.Extent.Text -ceq '$IncludeProofTools') { $proofOnly = $true }
          $parent = $parent.Parent
        }
        if ($proofOnly -and -not $IncludeProofTools) { continue }
        . ([scriptblock]::Create($statement.Extent.Text))
      }
      if ($IncludeProofTools) { $ignored = & $creationSeam }
      if ($recordTarget -is [System.Management.Automation.Language.VariableExpressionAst]) {
        Record-Node -FilePath (Get-Variable -Name $recordTarget.VariablePath.UserPath -ValueOnly)
      } elseif ($recordTarget -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
        Record-Node -FilePath $recordTarget.Value
      } else { throw 'unsupported recording target expression' }
    } catch { $state.Error = $_.Exception.Message }
    return $state
  }
  $firstPath = 'C:\inert\first\node.exe'
  $secondPath = 'C:\inert\second\node.exe'
  $missingPath = 'C:\inert\missing\node.exe'
  $firstCommand = [pscustomobject]@{ Source=$firstPath }
  $secondCommand = [pscustomobject]@{ Source=$secondPath }
  $nodeCases = @(
    @{ Name='ordered'; Proof=$true; Commands=@($firstCommand,$secondCommand); ValidPaths=@($firstPath,$secondPath); Expected=$firstPath; Checks=@($firstPath); Error=$null },
    @{ Name='single-production'; Proof=$false; Commands=@($firstCommand); ValidPaths=@($firstPath); Expected=$firstPath; Checks=@($firstPath); Error=$null },
    @{ Name='missing'; Proof=$true; Commands=@(); ValidPaths=@(); Expected=$null; Checks=@(); Error='The builder Node executable was not found.' },
    @{ Name='array'; Proof=$true; Commands=@([pscustomobject]@{ Source=@($firstPath,$secondPath) }); ValidPaths=@($firstPath,$secondPath); Expected=$null; Checks=@(); Error='The builder Node executable path is invalid.' },
    @{ Name='blank'; Proof=$true; Commands=@([pscustomobject]@{ Source='  ' }); ValidPaths=@(); Expected=$null; Checks=@(); Error='The builder Node executable path is invalid.' },
    @{ Name='numeric'; Proof=$true; Commands=@([pscustomobject]@{ Source=42 }); ValidPaths=@(); Expected=$null; Checks=@(); Error='The builder Node executable path is invalid.' },
    @{ Name='relative'; Proof=$true; Commands=@([pscustomobject]@{ Source='node.exe' }); ValidPaths=@('node.exe'); Expected=$null; Checks=@(); Error='The builder Node executable path is invalid.' },
    @{ Name='no-fallback'; Proof=$true; Commands=@([pscustomobject]@{ Source=$missingPath },$secondCommand); ValidPaths=@($secondPath); Expected=$null; Checks=@($missingPath); Error='The builder Node executable path is invalid.' }
  )
  foreach ($case in $nodeCases) {
    $observed = Invoke-BuilderNodeCase $case
    if ($case.Name -ceq 'ordered' -and $observed.Created.Count -eq 1 -and $observed.Created[0] -is [array]) {
      Write-Output 'CHECK builder-node-original collection-filepath=1 selected-scalar=0'
    }
    if ($case.Expected) {
      if ($case.Proof) {
        Assert-Report ($observed.Created.Count -eq 1 -and $observed.Created[0] -is [string] -and
          $observed.Created[0] -ceq $case.Expected) 'actual builder FilePath is not the first scalar executable'
      } else {
        Assert-Report ($observed.Created.Count -eq 0 -and $observed.Recorded.Count -eq 1 -and
          $observed.Recorded[0] -is [string] -and $observed.Recorded[0] -ceq $case.Expected) 'production-only recording did not use the resolved scalar'
      }
    } else {
      Assert-Report ($observed.Error -ceq $case.Error -and $observed.Created.Count -eq 0 -and
        $observed.Recorded.Count -eq 0) "invalid builder Node metadata was accepted: $($case.Name)"
    }
    $validTrace = $observed.Lookups.Count -eq 1 -and $observed.Lookups[0].Name -ceq 'node.exe' -and
      $observed.Lookups[0].Type -ceq 'Application' -and $observed.Lookups[0].All -and
      $observed.PathChecks.Count -eq $case.Checks.Count
    for ($i = 0; $i -lt $observed.PathChecks.Count; $i++) {
      $validTrace = $validTrace -and $i -lt $case.Checks.Count -and
        $observed.PathChecks[$i].Path -ceq $case.Checks[$i] -and $observed.PathChecks[$i].Type -ceq 'Leaf'
    }
    if ($case.Expected) {
      $validTrace = $validTrace -and $null -eq $observed.Error -and $observed.Recorded.Count -eq 1 -and
        $observed.Recorded[0] -is [string] -and $observed.Recorded[0] -ceq $case.Expected
    }
    Assert-Report $validTrace "builder selection, common reuse or no-fallback contract differs: $($case.Name)"
  }
  Write-Output 'PASS builder-node-resolution configurations=8 assertions=16 proof-and-production=1 native-starts=0'
  Write-Output "PASS proof-report-fixtures assertions=$script:assertions"
} finally {
  Remove-Item -LiteralPath $file -Force
}
