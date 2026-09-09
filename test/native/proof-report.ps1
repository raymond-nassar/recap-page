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
$definitions = @($ast.FindAll({
  param($node)
  $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and
    $node.Name -ceq 'Read-ProofProgress'
}, $true))
Assert-Report ($definitions.Count -eq 1) 'progress reader definition is not unique'
. ([scriptblock]::Create($definitions[0].Extent.Text))

$file = [IO.Path]::GetTempFileName()
function Observe-Report {
  param([string[]]$Lines, [switch]$Rethrow)
  [IO.File]::WriteAllText($file, ($Lines -join "`n") + "`n", (New-Object Text.UTF8Encoding $false))
  $state = [pscustomobject]@{
    Position = 0L; Pending = ''; Lines = 0; Text = [Text.StringBuilder]::new()
    Live = $false; LiveHealthLines = 0; Caught = $null
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
    Emitted = ($captured | ForEach-Object { $_.ToString() }) -join "`n"
  }
}

try {
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
    Assert-Report ($rejected.ExitCode -eq 1 -and $rejected.Failure -ceq 'unsafe-proof-report') 'unsafe report payload was accepted'
    Assert-Report ($rejected.Emitted.Contains('unsafe-proof-line-redacted') -and
      -not $rejected.Emitted.Contains($payload) -and -not $rejected.Accepted.Contains($payload)) 'unsafe payload was disclosed'
    Assert-Report ($rejected.Accepted.Contains($envelope[0])) 'later rejection erased the earlier failure checkpoint'
  }
  Write-Output 'PASS unsafe-payloads cases=6 redacted=6 failed=6'

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
  Write-Output "PASS proof-report-fixtures assertions=$script:assertions"
} finally {
  Remove-Item -LiteralPath $file -Force
}
