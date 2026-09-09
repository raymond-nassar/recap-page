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

    [string]$MessagePattern,

    [scriptblock]$Inspect
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
  if ($Inspect -and -not (& $Inspect $caught)) {
    throw "$Name did not retain the required safe rejection facts."
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

  Assert-Throws `
    -Name 'sanitized rejected categories' `
    -MessagePattern 'outside the exact optional allowlist' `
    -Action { Read-Fixture $unknown } `
    -Inspect {
      param($Failure)
      $detail = $Failure.Data['WackRejectedSummary']
      $null -ne $detail -and $detail.Overall -eq 'WARNING' `
        -and $detail.NonPassCount -eq 3 -and $detail.Omitted -eq 0 `
        -and $detail.NonPass[2].Name -eq 'Unknown category' `
        -and $detail.NonPass[2].Result -eq 'FAIL'
    }

  $zeroNonPass = Write-Fixture -Name 'overall-fail-without-nonpass' -Xml @'
<REPORT OVERALL_RESULT="FAIL" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">
  <TEST NAME="App manifest"><RESULT>PASS</RESULT></TEST>
</REPORT>
'@
  Assert-Throws `
    -Name 'zero non-pass overall rejection facts' `
    -Action { Read-Fixture $zeroNonPass } `
    -Inspect {
      param($Failure)
      $detail = $Failure.Data['WackRejectedSummary']
      $null -ne $detail -and $detail.Overall -eq 'FAIL' `
        -and $detail.NonPassCount -eq 0 -and $detail.NonPass.Count -eq 0
    }

  $manyTests = (1..21 | ForEach-Object {
    '<TEST NAME="Category {0}"><RESULT>FAIL</RESULT></TEST>' -f $_
  }) -join ''
  $many = Write-Fixture -Name 'bounded-rejection' -Xml (
    '<REPORT OVERALL_RESULT="FAIL" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">' `
      + $manyTests + '<DETAIL>DO_NOT_REPORT_RAW_DETAIL</DETAIL></REPORT>'
  )
  Assert-Throws `
    -Name 'bounded rejected category list' `
    -Action { Read-Fixture $many } `
    -Inspect {
      param($Failure)
      $detail = $Failure.Data['WackRejectedSummary']
      $null -ne $detail -and $detail.NonPassCount -eq 21 `
        -and $detail.NonPass.Count -eq 20 -and $detail.Omitted -eq 1 `
        -and $detail.NonPass[19].Name -eq 'Category 20' `
        -and ($detail | ConvertTo-Json -Depth 5 -Compress) -notmatch 'DO_NOT_REPORT|Category 21'
    }

  $unsafeName = Write-Fixture -Name 'unsafe-name' -Xml @'
<REPORT OVERALL_RESULT="FAIL" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">
  <TEST NAME="C:\DO_NOT_REPORT_PRIVATE_PATH"><RESULT>FAIL</RESULT></TEST>
</REPORT>
'@
  Assert-Throws `
    -Name 'unsafe category is not disclosed' `
    -MessagePattern 'unsafe test summary' `
    -Action { Read-Fixture $unsafeName } `
    -Inspect {
      param($Failure)
      $null -eq $Failure.Data['WackRejectedSummary'] `
        -and $Failure.Message -notmatch 'DO_NOT_REPORT'
    }

  $unsafeOverall = Write-Fixture -Name 'unsafe-summary' -Xml @'
<REPORT OVERALL_RESULT="FAIL:DO_NOT_REPORT_PRIVATE_SUMMARY" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">
  <TEST NAME="App manifest"><RESULT>FAIL</RESULT></TEST>
</REPORT>
'@
  Assert-Throws `
    -Name 'unsafe overall is not disclosed' `
    -MessagePattern 'unsafe summary fields' `
    -Action { Read-Fixture $unsafeOverall } `
    -Inspect {
      param($Failure)
      $null -eq $Failure.Data['WackRejectedSummary'] `
        -and $Failure.Message -notmatch 'DO_NOT_REPORT'
    }

  $passBlocked = Write-Fixture -Name 'pass-with-sole-blocked' -Xml @'
<REPORT OVERALL_RESULT="PASS" PARTIAL_RUN="FALSE">
  <TEST NAME="App manifest"><RESULT>PASS</RESULT></TEST>
  <TEST NAME="Blocked executables"><RESULT>FAIL</RESULT></TEST>
</REPORT>
'@
  $passBlockedResult = Read-Fixture $passBlocked
  Assert-True `
    -Name 'qualified PASS with sole optional Blocked result' `
    -Condition (
      $passBlockedResult.Disposition -eq 'PASS WITH OPTIONAL WARNINGS' `
      -and $passBlockedResult.Overall -eq 'PASS' `
      -and $passBlockedResult.Tests[1].Result -eq 'FAIL'
    )

  $passBlockedLatest = Write-Fixture -Name 'pass-blocked-current-kit' -Xml @'
<REPORT OVERALL_RESULT="PASS" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">
  <TEST NAME="Blocked executables"><RESULT>FAIL</RESULT></TEST>
</REPORT>
'@
  Assert-True `
    -Name 'qualified PASS with explicit latest kit' `
    -Condition ((Read-Fixture $passBlockedLatest).Disposition -eq 'PASS WITH OPTIONAL WARNINGS')

  $passBlockedUnknownPartial = Write-Fixture -Name 'pass-blocked-unknown-partial' -Xml @'
<REPORT OVERALL_RESULT="PASS" LATEST_VERSION="TRUE">
  <TEST NAME="Blocked executables"><RESULT>FAIL</RESULT></TEST>
</REPORT>
'@
  Assert-Throws `
    -Name 'new optional PASS requires explicit complete run' `
    -Action { Read-Fixture $passBlockedUnknownPartial } `
    -MessagePattern 'outside the exact optional allowlist'

  $passBlockedDuplicate = Write-Fixture -Name 'pass-blocked-duplicate' -Xml @'
<REPORT OVERALL_RESULT="PASS" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">
  <TEST NAME="Blocked executables"><RESULT>FAIL</RESULT></TEST>
  <TEST NAME="Blocked executables"><RESULT>FAIL</RESULT></TEST>
</REPORT>
'@
  Assert-Throws `
    -Name 'new optional PASS rejects duplicate Blocked' `
    -Action { Read-Fixture $passBlockedDuplicate } `
    -MessagePattern 'outside the exact optional allowlist'

  $passDpi = Write-Fixture -Name 'pass-dpi-only' -Xml @'
<REPORT OVERALL_RESULT="PASS" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">
  <TEST NAME="DPIAwarenessValidation"><RESULT>WARNING</RESULT></TEST>
</REPORT>
'@
  Assert-Throws `
    -Name 'new optional PASS is not general subset acceptance' `
    -Action { Read-Fixture $passDpi } `
    -MessagePattern 'outside the exact optional allowlist'

  $passChangedBlocked = Write-Fixture -Name 'pass-blocked-changed-result' -Xml @'
<REPORT OVERALL_RESULT="PASS" PARTIAL_RUN="FALSE" LATEST_VERSION="TRUE">
  <TEST NAME="Blocked executables"><RESULT>WARNING</RESULT></TEST>
</REPORT>
'@
  Assert-Throws `
    -Name 'new optional PASS requires the exact Blocked result' `
    -Action { Read-Fixture $passChangedBlocked } `
    -MessagePattern 'outside the exact optional allowlist'

  if ($passed -ne 22) {
    throw "Expected 22 fixture tests, observed $passed."
  }
  '22 WACK report parser fixture tests passed.'
} finally {
  Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
