Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'wack-report.ps1')

$scratch = Join-Path $env:TEMP "recap-page-wack-fixtures-$([guid]::NewGuid())"
$passed = 0
$sha256 = 'A' * 64

function Write-Fixture {
  param(
    [Parameter(Mandatory)]
    [string]$Name,

    [Parameter(Mandatory)]
    [string]$Xml
  )

  $path = Join-Path $scratch "$Name.xml"
  [IO.File]::WriteAllText(
    $path,
    $Xml,
    [Text.UTF8Encoding]::new($false)
  )
  $path
}

function Assert-True {
  param(
    [Parameter(Mandatory)]
    [bool]$Condition,

    [Parameter(Mandatory)]
    [string]$Name
  )

  if (-not $Condition) {
    throw "$Name did not hold."
  }
  $script:passed += 1
}

function Assert-Throws {
  param(
    [Parameter(Mandatory)]
    [scriptblock]$Action,

    [Parameter(Mandatory)]
    [string]$Name,

    [string]$MessagePattern
  )

  $caught = $null
  try {
    & $Action
  } catch {
    $caught = $_.Exception
  }
  if ($null -eq $caught) {
    throw "$Name did not throw."
  }
  if ($MessagePattern -and $caught.Message -notmatch $MessagePattern) {
    throw "$Name threw an unexpected error: $($caught.Message)"
  }
  $script:passed += 1
}

function Read-Fixture {
  param(
    [Parameter(Mandatory)]
    [string]$Path
  )

  Read-WackReport -Path $Path -Label 'fixture' -Sha256 $sha256
}

New-Item -ItemType Directory -Path $scratch | Out-Null
try {
  $allowlist = Get-WackAllowedOptionalResults
  Assert-True `
    -Name 'exact optional allowlist' `
    -Condition (
      $allowlist.Count -eq 2 `
      -and $allowlist['Blocked executables'] -eq 'FAIL' `
      -and $allowlist['DPIAwarenessValidation'] -eq 'WARNING' `
      -and @($allowlist.Keys | Sort-Object) -join ',' `
        -eq 'Blocked executables,DPIAwarenessValidation'
    )

  $clean = Write-Fixture -Name 'clean-pass' -Xml @'
<REPORT OVERALL_RESULT="PASS" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">
  <TEST NAME="App manifest"><RESULT>PASS</RESULT></TEST>
</REPORT>
'@
  $cleanResult = Read-Fixture $clean
  Assert-True `
    -Name 'clean PASS' `
    -Condition ($cleanResult.Disposition -eq 'PASS')

  $optional = Write-Fixture -Name 'optional-results' -Xml @'
<REPORT OVERALL_RESULT="WARNING" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">
  <TEST NAME="App manifest"><RESULT>PASS</RESULT></TEST>
  <TEST NAME="Blocked executables"><RESULT>FAIL</RESULT></TEST>
  <TEST NAME="DPIAwarenessValidation"><RESULT>WARNING</RESULT></TEST>
</REPORT>
'@
  $optionalResult = Read-Fixture $optional
  Assert-True `
    -Name 'exact optional results' `
    -Condition ($optionalResult.Disposition -eq 'PASS WITH OPTIONAL WARNINGS')

  $unknown = Write-Fixture -Name 'unknown-result' -Xml @'
<REPORT OVERALL_RESULT="WARNING" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">
  <TEST NAME="Blocked executables"><RESULT>FAIL</RESULT></TEST>
  <TEST NAME="DPIAwarenessValidation"><RESULT>WARNING</RESULT></TEST>
  <TEST NAME="Unknown category"><RESULT>FAIL</RESULT></TEST>
</REPORT>
'@
  Assert-Throws `
    -Name 'unknown third non-pass' `
    -MessagePattern 'outside the exact optional allowlist' `
    -Action { Read-Fixture $unknown }

  $duplicate = Write-Fixture -Name 'duplicate-missing' -Xml @'
<REPORT OVERALL_RESULT="WARNING" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">
  <TEST NAME="Blocked executables"><RESULT>FAIL</RESULT></TEST>
  <TEST NAME="Blocked executables"><RESULT>FAIL</RESULT></TEST>
</REPORT>
'@
  Assert-Throws `
    -Name 'duplicate Blocked with missing DPI' `
    -MessagePattern 'outside the exact optional allowlist' `
    -Action { Read-Fixture $duplicate }

  $missing = Write-Fixture -Name 'single-missing' -Xml @'
<REPORT OVERALL_RESULT="WARNING" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">
  <TEST NAME="Blocked executables"><RESULT>FAIL</RESULT></TEST>
</REPORT>
'@
  Assert-Throws `
    -Name 'single missing optional member' `
    -MessagePattern 'outside the exact optional allowlist' `
    -Action { Read-Fixture $missing }

  $partial = Write-Fixture -Name 'partial-run' -Xml @'
<REPORT OVERALL_RESULT="PASS" PARTIAL_RUN="TRUE" LATEST_VERSION="TRUE">
  <TEST NAME="App manifest"><RESULT>PASS</RESULT></TEST>
</REPORT>
'@
  Assert-Throws `
    -Name 'partial run' `
    -MessagePattern 'partial' `
    -Action { Read-Fixture $partial }

  $outdated = Write-Fixture -Name 'outdated-kit' -Xml @'
<REPORT OVERALL_RESULT="PASS" PARTIAL_RUN="FALSE" LATEST_VERSION="FALSE">
  <TEST NAME="App manifest"><RESULT>PASS</RESULT></TEST>
</REPORT>
'@
  Assert-Throws `
    -Name 'explicit outdated kit' `
    -MessagePattern 'outdated' `
    -Action { Read-Fixture $outdated }

  $malformed = Write-Fixture -Name 'malformed' -Xml @'
<REPORT OVERALL_RESULT="PASS"><TEST NAME="App manifest"></REPORT>
'@
  Assert-Throws -Name 'malformed XML' -Action { Read-Fixture $malformed }

  $entity = Write-Fixture -Name 'dtd-entity' -Xml @'
<!DOCTYPE REPORT [<!ENTITY marker "expanded">]>
<REPORT OVERALL_RESULT="PASS" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">
  <TEST NAME="App manifest"><RESULT>&marker;</RESULT></TEST>
</REPORT>
'@
  Assert-Throws -Name 'DTD and entity' -Action { Read-Fixture $entity }

  $missingResult = Write-Fixture -Name 'missing-result' -Xml @'
<REPORT OVERALL_RESULT="PASS" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">
  <TEST NAME="App manifest"></TEST>
</REPORT>
'@
  Assert-Throws `
    -Name 'missing RESULT' `
    -MessagePattern 'no RESULT' `
    -Action { Read-Fixture $missingResult }

  if ($passed -ne 11) {
    throw "Expected 11 fixture tests, observed $passed."
  }
  '11 WACK report parser fixture tests passed.'
} finally {
  Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
