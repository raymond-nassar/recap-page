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
    nativeEnvironmentAllowed = '6b8193a41d5e3a7c6dd60512c14506f5bb849282d354d715854b734a1aab0259'
    visibleIn = '30eb5e1b19c3f428cf7b4068947b54a92cdea0ae64bc8ca4e4c165219c94a0dc'
    visibleBoundConsole = '48599faaf6450608d2c6d3fbcf298b3b8f9d15e31aa1f9c558befade9b2bb22f'
    bindingReady = '0e155c4c6a212651289cdd42b8d2d0f2726f9cb0958629286d2fdbdaf5bc8bf3'
    ambientConsoleScoped = '39e7f599457e8540210f41b1163663d9f0fdd1b2b7dee9dc317fc4c12b16fc91'
    verifiedHelperSurface = '1a3d8154ad98c96b16c3ac1756b6bbbb403f41ea0e6a9415cfb35dac65f9b4ea'
    completeNonPresenterTransient = '357011e39b1e79a0257e63dc359e06c563db116d0e5d767f236d49d214ce50b8'
    correlateWindows = '94faa76da67796b33e80906a6f03d377422e79f4f258db97b387b4a8c26cf3f3'
    helperScope = '63d70b5194784b4269041fa8e89d96924128f91cc28e6347383cc0c4ab3aeea9'
    transientSource = 'a4e4de939371c7382479832a2921acf9293ab93b5068e9f8cd5e780f67d3b5c3'
    environmentWindow = '4e06a73bfd03550f515c929759c41583f16d3c488986bac1c58e5104343627bf'
    assertNoVisibleTerminals = '5186dab4370c23b3a7bc9bb55a24205b66bd18124a344c88332101e04457b998'
    requireCalibrationLifetimes = '7f51724f7e38120cf885fe032dddcb2f365af06d72aa0c43417c89be7e09a236'
  }
  $methods = @('helperScope','transientSource','environmentWindow','assertNoVisibleTerminals','requireCalibrationLifetimes')
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
        if ($name -ceq 'assertNoVisibleTerminals') {
          $printing = @'
            const auto failures = collectFailureRows(unboundConsole, inconclusive, visible);
            if (!failures.rows.empty()) {
                reportCategories_ = failures.categories;
                report << "DIAG offender-groups unbound_console=" << unboundConsole.size()
                       << " inconclusive=" << inconclusive.size() << " visible_product=" << visible.size() << "\n";
                reportRows(failures.rows);
                reportConsoleContext(report, resolution, failures.rows);
            }
'@
          $printing = $printing.Replace("`r`n", "`n")
          Assert-Report ([regex]::Matches($value, [regex]::Escape($printing)).Count -eq 1) 'approved reporting block changed or disappeared'
          $value = $value.Replace($printing + "`n", '')
          foreach ($category in @('unboundConsole','inconclusive','visible')) {
            $condition = "            if (!${category}.empty()) {"
            Assert-Report ([regex]::Matches($value, [regex]::Escape($condition)).Count -eq 1) 'primary failure condition changed'
            $value = $value.Replace($condition, $condition + "`n                reportRows($category);")
          }
        }
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
  Write-Output 'PASS semantic-diagnostics frozen-definitions=13 separate-registration=1'
  Write-Output 'PASS caller-context reporting-only-delta=1 primary-precedence-unchanged=1 existing-console-records=1'
  Write-Output "PASS proof-report-fixtures assertions=$script:assertions"
} finally {
  Remove-Item -LiteralPath $file -Force
}
