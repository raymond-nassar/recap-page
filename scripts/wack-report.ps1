Set-StrictMode -Version Latest

$script:wackAllowedOptionalResults = [ordered]@{
  'Blocked executables' = 'FAIL'
  'DPIAwarenessValidation' = 'WARNING'
}

function Get-WackAllowedOptionalResults {
  $copy = [ordered]@{}
  foreach ($entry in $script:wackAllowedOptionalResults.GetEnumerator()) {
    $copy[$entry.Key] = $entry.Value
  }
  $copy
}

function Read-WackReport {
  param(
    [Parameter(Mandatory)]
    [string]$Path,

    [Parameter(Mandatory)]
    [string]$Label,

    [Parameter(Mandatory)]
    [string]$Sha256
  )

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "WACK did not create the $Label report."
  }
  if ((Get-Item -LiteralPath $Path).Length -gt 16MB) {
    throw "The $Label WACK report exceeded the 16 MiB parser boundary."
  }

  $settings = [Xml.XmlReaderSettings]::new()
  $settings.DtdProcessing = [Xml.DtdProcessing]::Prohibit
  $settings.XmlResolver = $null
  $settings.MaxCharactersInDocument = 16MB
  $reader = [Xml.XmlReader]::Create($Path, $settings)
  try {
    $document = [Xml.XmlDocument]::new()
    $document.XmlResolver = $null
    $document.Load($reader)
  } finally {
    $reader.Dispose()
  }

  $root = $document.DocumentElement
  if ($null -eq $root -or $root.LocalName -ne 'REPORT') {
    throw "The $Label report does not have the expected REPORT root."
  }

  $overall = $root.GetAttribute('OVERALL_RESULT').Trim().ToUpperInvariant()
  $partial = $root.GetAttribute('PARTIAL_RUN').Trim().ToUpperInvariant()
  $latest = $root.GetAttribute('LATEST_VERSION').Trim().ToUpperInvariant()
  if (-not $partial) {
    $partial = 'NOT REPORTED'
  }
  if (-not $latest) {
    $latest = 'NOT REPORTED'
  }
  $safeSummary = $overall -match '^[A-Z][A-Z _-]{0,31}$' `
    -and $partial -match '^[A-Z][A-Z _-]{0,31}$' `
    -and $latest -match '^[A-Z][A-Z _-]{0,31}$'
  if (-not $safeSummary) {
    throw "The $Label report has missing or unsafe summary fields."
  }
  if ($partial -notin @('FALSE', 'NOT REPORTED')) {
    throw "The $Label report is partial."
  }
  if ($latest -notin @('TRUE', 'NOT REPORTED')) {
    throw "The $Label report explicitly marks WACK as outdated."
  }

  $tests = @()
  foreach ($test in $root.SelectNodes('.//TEST')) {
    $name = $test.GetAttribute('NAME').Trim()
    $resultNode = $test.SelectSingleNode('./RESULT')
    if ($null -eq $resultNode) {
      throw "The $Label report contains a test with no RESULT."
    }
    $result = $resultNode.InnerText.Trim().ToUpperInvariant()
    $safeTest = $name -match "^[A-Za-z0-9][A-Za-z0-9 &()+,.'_-]{0,159}$" `
      -and $result -match '^[A-Z][A-Z _-]{0,31}$'
    if (-not $safeTest) {
      throw "The $Label report contains an unsafe test summary."
    }
    $tests += [pscustomobject]@{ Name = $name; Result = $result }
  }
  if ($tests.Count -eq 0) {
    throw "The $Label report contains no test results."
  }

  $nonPass = @($tests | Where-Object Result -ne 'PASS')
  $optionalOnly = $nonPass.Count -eq $script:wackAllowedOptionalResults.Count
  $seenOptionalNames = [Collections.Generic.HashSet[string]]::new(
    [StringComparer]::Ordinal
  )
  foreach ($test in $nonPass) {
    $expected = @($script:wackAllowedOptionalResults.GetEnumerator() |
      Where-Object Key -CEQ $test.Name)
    $allowedResult = $expected.Count -eq 1 `
      -and $expected[0].Value -ceq $test.Result `
      -and $seenOptionalNames.Add($test.Name)
    if (-not $allowedResult) {
      $optionalOnly = $false
    }
  }
  foreach ($expected in $script:wackAllowedOptionalResults.GetEnumerator()) {
    if (-not $seenOptionalNames.Contains($expected.Key)) {
      $optionalOnly = $false
    }
  }

  $disposition = if ($overall -eq 'PASS' -and $nonPass.Count -eq 0) {
    'PASS'
  } elseif ($overall -eq 'WARNING' -and $optionalOnly) {
    'PASS WITH OPTIONAL WARNINGS'
  } else {
    throw "$Label contains non-pass results outside the exact optional allowlist."
  }

  [pscustomobject]@{
    Label = $Label
    Sha256 = $Sha256
    Overall = $overall
    PartialRun = $partial
    LatestVersion = $latest
    Disposition = $disposition
    Tests = $tests
  }
}
