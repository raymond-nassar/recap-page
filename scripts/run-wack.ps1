[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string]$X64Package,

  [Parameter(Mandatory)]
  [string]$Bundle,

  [Parameter(Mandatory)]
  [string]$Certificate,

  [ValidateRange(60, 3600)]
  [int]$TimeoutSeconds = 1500
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$packageName = 'PanelStackLabs.RecapPage'
$packageFamily = 'PanelStackLabs.RecapPage_we33aa8nvkpcc'
$publisher = 'CN=F6D9045B-46F0-4EAC-9524-4BFC8A75A472'
$reportRoot = Join-Path $env:TEMP "recap-page-wack-$([guid]::NewGuid())"
$trustedPeople = 'Cert:\LocalMachine\TrustedPeople'
$importedThumbprint = $null
$allowedOptionalResults = @{
  'Blocked executables' = 'FAIL'
  'DPIAwarenessValidation' = 'WARNING'
}

function ConvertTo-PowerShellLiteral {
  param(
    [Parameter(Mandatory)]
    [string]$Value
  )

  "'$($Value.Replace("'", "''"))'"
}

function Invoke-WindowsPowerShell {
  param(
    [Parameter(Mandatory)]
    [string]$Script
  )

  $powershell = Join-Path $env:SystemRoot `
    'System32\WindowsPowerShell\v1.0\powershell.exe'
  $output = & $powershell -NoProfile -NonInteractive -Command $Script 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw 'The inbox Windows PowerShell package or certificate operation failed.'
  }
  $output
}

function Get-RecapPackageCount {
  $name = ConvertTo-PowerShellLiteral $packageName
  $family = ConvertTo-PowerShellLiteral $packageFamily
  $output = Invoke-WindowsPowerShell `
    "@(Get-AppxPackage -Name $name | Where-Object PackageFamilyName -eq $family).Count"
  [int]@($output)[-1]
}

function Remove-RecapPackages {
  $name = ConvertTo-PowerShellLiteral $packageName
  $family = ConvertTo-PowerShellLiteral $packageFamily
  $script = @"
`$packages = @(Get-AppxPackage -Name $name |
  Where-Object PackageFamilyName -eq $family)
foreach (`$package in `$packages) {
  Remove-AppxPackage -Package `$package.PackageFullName
}
if (@(Get-AppxPackage -Name $name |
  Where-Object PackageFamilyName -eq $family).Count -ne 0) {
  throw 'The exact Recap Page package identity remains after WACK cleanup.'
}
"@
  $null = Invoke-WindowsPowerShell $script
}

function Assert-SupportedHost {
  if ($env:PROCESSOR_ARCHITECTURE -ne 'AMD64') {
    throw "WACK requires the supported x64 host; found $env:PROCESSOR_ARCHITECTURE."
  }

  $sessionId = [System.Diagnostics.Process]::GetCurrentProcess().SessionId
  if ($sessionId -eq 0) {
    throw 'WACK cannot run in Session0.'
  }

  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)
  if (-not $principal.IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator
  )) {
    throw 'WACK must run with an administrator token.'
  }

  $os = Get-CimInstance Win32_OperatingSystem
  $client = [int]$os.ProductType -eq 1 -and [version]$os.Version -ge [version]'10.0'
  $server2022 = [int]$os.ProductType -ne 1 -and $os.Version -like '10.0.20348*'
  if (-not $client -and -not $server2022) {
    throw "The current Windows SDK does not list this host for WACK: $($os.Caption) $($os.Version)."
  }

  $appcert = Join-Path ${env:ProgramFiles(x86)} `
    'Windows Kits\10\App Certification Kit\appcert.exe'
  if (-not (Test-Path -LiteralPath $appcert -PathType Leaf)) {
    throw 'The supported host does not provide appcert.exe.'
  }

  $signature = Get-AuthenticodeSignature -FilePath $appcert
  $signedByMicrosoft = $signature.SignerCertificate.Subject `
    -match '(^|, )O=Microsoft Corporation(,|$)'
  if ($signature.Status -ne 'Valid' -or -not $signedByMicrosoft) {
    throw 'appcert.exe is not validly signed by Microsoft Corporation.'
  }

  [pscustomobject]@{
    AppCert = $appcert
    AppCertVersion = (Get-Item -LiteralPath $appcert).VersionInfo.FileVersion
    Image = "$env:ImageOS $env:ImageVersion".Trim()
    OperatingSystem = "$($os.Caption) $($os.Version)"
    Architecture = $env:PROCESSOR_ARCHITECTURE
    SessionId = $sessionId
  }
}

function Start-CapturedProcess {
  param(
    [Parameter(Mandatory)]
    [string]$FilePath,

    [Parameter(Mandatory)]
    [string[]]$ArgumentList,

    [Parameter(Mandatory)]
    [string]$OutputPrefix
  )

  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $FilePath
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  foreach ($argument in $ArgumentList) {
    [void]$start.ArgumentList.Add($argument)
  }

  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  [void]$process.Start()
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
    $process.Kill($true)
    $process.WaitForExit()
    throw "appcert.exe exceeded the $TimeoutSeconds second command deadline."
  }

  [IO.File]::WriteAllText(
    "$OutputPrefix.stdout.txt",
    $stdout.GetAwaiter().GetResult(),
    [Text.UTF8Encoding]::new($false)
  )
  [IO.File]::WriteAllText(
    "$OutputPrefix.stderr.txt",
    $stderr.GetAwaiter().GetResult(),
    [Text.UTF8Encoding]::new($false)
  )
  $process.ExitCode
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

  $tests = @()
  foreach ($test in $root.SelectNodes('.//TEST')) {
    $name = $test.GetAttribute('NAME').Trim()
    $resultNode = $test.SelectSingleNode('./RESULT')
    $result = if ($null -eq $resultNode) { '' } else { $resultNode.InnerText.Trim() }
    $result = $result.ToUpperInvariant()
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
  $optionalOnly = $nonPass.Count -gt 0
  foreach ($test in $nonPass) {
    $allowedResult = $allowedOptionalResults.ContainsKey($test.Name) `
      -and $allowedOptionalResults[$test.Name] -eq $test.Result
    if (-not $allowedResult) {
      $optionalOnly = $false
    }
  }
  $disposition = if ($overall -eq 'PASS' -and $nonPass.Count -eq 0) {
    'PASS'
  } elseif ($overall -eq 'WARNING' -and $optionalOnly) {
    'PASS WITH OPTIONAL WARNINGS'
  } else {
    'REJECT'
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

function Write-WackSummary {
  param(
    [Parameter(Mandatory)]
    [object]$Summary
  )

  "$($Summary.Label) SHA-256: $($Summary.Sha256)"
  "$($Summary.Label) overall result: $($Summary.Overall)"
  "$($Summary.Label) partial run: $($Summary.PartialRun)"
  "$($Summary.Label) latest WACK: $($Summary.LatestVersion)"
  "$($Summary.Label) disposition: $($Summary.Disposition)"
  foreach ($test in $Summary.Tests) {
    "  $($test.Result): $($test.Name)"
  }

  if ($env:GITHUB_STEP_SUMMARY) {
    $lines = @(
      "### $($Summary.Label)"
      ''
      "| Field | Result |"
      "|---|---|"
      "| SHA-256 | ``$($Summary.Sha256)`` |"
      "| Overall | $($Summary.Overall) |"
      "| Partial run | $($Summary.PartialRun) |"
      "| Latest WACK | $($Summary.LatestVersion) |"
      "| Disposition | $($Summary.Disposition) |"
      ''
      '| Test | Result |'
      '|---|---|'
    )
    foreach ($test in $Summary.Tests) {
      $lines += "| $($test.Name) | $($test.Result) |"
    }
    Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $lines
  }
}

function Invoke-Wack {
  param(
    [Parameter(Mandatory)]
    [string]$AppCert,

    [Parameter(Mandatory)]
    [string]$InputPath,

    [Parameter(Mandatory)]
    [string]$Label
  )

  $report = Join-Path $reportRoot "$($Label.Replace(' ', '-')).xml"
  $prefix = Join-Path $reportRoot $Label.Replace(' ', '-')
  $resetExit = Start-CapturedProcess `
    -FilePath $AppCert `
    -ArgumentList @('reset') `
    -OutputPrefix "$prefix-reset"
  if ($resetExit -ne 0) {
    throw "appcert.exe reset failed before the $Label run with exit code $resetExit."
  }

  $testExit = Start-CapturedProcess `
    -FilePath $AppCert `
    -ArgumentList @(
      'test',
      '-appxpackagepath',
      $InputPath,
      '-reportoutputpath',
      $report
    ) `
    -OutputPrefix "$prefix-test"
  $sha256 = (Get-FileHash -LiteralPath $InputPath -Algorithm SHA256).Hash
  $summary = Read-WackReport -Path $report -Label $Label -Sha256 $sha256
  Write-WackSummary -Summary $summary

  if ($testExit -ne 0) {
    throw "$Label appcert.exe test exited with code $testExit."
  }
  $acceptedReport = $summary.Disposition -ne 'REJECT' `
    -and $summary.PartialRun -ne 'TRUE' `
    -and $summary.LatestVersion -ne 'FALSE'
  if (-not $acceptedReport) {
    throw "$Label contains a blocking, partial, or explicitly outdated WACK result."
  }
}

$primaryFailure = $null
$cleanupFailures = @()
try {
  $hostEvidence = Assert-SupportedHost
  "Runner image: $($hostEvidence.Image)"
  "Runner OS: $($hostEvidence.OperatingSystem)"
  "Runner architecture: $($hostEvidence.Architecture)"
  "PowerShell process session: $($hostEvidence.SessionId)"
  "WACK tool version: $($hostEvidence.AppCertVersion)"
  'WACK signature: Valid, Microsoft Corporation'

  $x64Path = (Resolve-Path -LiteralPath $X64Package).Path
  $bundlePath = (Resolve-Path -LiteralPath $Bundle).Path
  $certificatePath = (Resolve-Path -LiteralPath $Certificate).Path

  if ((Get-RecapPackageCount) -ne 0) {
    throw 'The WACK host already has the exact Recap Page package identity registered.'
  }

  $proofCertificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new(
    $certificatePath
  )
  if ($proofCertificate.Subject -ne $publisher) {
    throw "The proof certificate publisher does not match $publisher."
  }
  $thumbprint = $proofCertificate.Thumbprint
  if (Test-Path -LiteralPath "$trustedPeople\$thumbprint") {
    throw 'The generated proof certificate was already trusted before this run.'
  }

  $certificateLiteral = ConvertTo-PowerShellLiteral $certificatePath
  $storeLiteral = ConvertTo-PowerShellLiteral $trustedPeople
  $imported = Invoke-WindowsPowerShell `
    "(Import-Certificate -FilePath $certificateLiteral -CertStoreLocation $storeLiteral).Thumbprint"
  if (@($imported)[-1].Trim() -ne $thumbprint) {
    throw 'The trusted proof certificate thumbprint changed during import.'
  }
  $importedThumbprint = $thumbprint
  New-Item -ItemType Directory -Path $reportRoot | Out-Null

  Invoke-Wack `
    -AppCert $hostEvidence.AppCert `
    -InputPath $x64Path `
    -Label 'x64 package'
  Invoke-Wack `
    -AppCert $hostEvidence.AppCert `
    -InputPath $bundlePath `
    -Label 'x64 ARM64 bundle'
} catch {
  $primaryFailure = $_.Exception
} finally {
  try {
    Remove-RecapPackages
  } catch {
    $cleanupFailures += $_.Exception
  }

  if ($null -ne $importedThumbprint) {
    try {
      $trustedLiteral = ConvertTo-PowerShellLiteral `
        "$trustedPeople\$importedThumbprint"
      $null = Invoke-WindowsPowerShell @"
Remove-Item -LiteralPath $trustedLiteral
if (Test-Path -LiteralPath $trustedLiteral) {
  throw 'The temporary WACK certificate remains trusted after cleanup.'
}
"@
    } catch {
      $cleanupFailures += $_.Exception
    }
  }

  try {
    Remove-Item -LiteralPath $reportRoot -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path -LiteralPath $reportRoot) {
      throw 'The raw WACK report directory remains after cleanup.'
    }
  } catch {
    $cleanupFailures += $_.Exception
  }
}

if ($null -ne $primaryFailure -and $cleanupFailures.Count -ne 0) {
  $allFailures = @($primaryFailure) + $cleanupFailures
  throw [AggregateException]::new(
    'WACK execution and cleanup both failed.',
    [Exception[]]$allFailures
  )
}
if ($null -ne $primaryFailure) {
  throw $primaryFailure
}
if ($cleanupFailures.Count -ne 0) {
  throw [AggregateException]::new(
    'WACK cleanup failed.',
    [Exception[]]$cleanupFailures
  )
}
