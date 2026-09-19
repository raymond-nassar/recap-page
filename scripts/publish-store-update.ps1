[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('Validate', 'Submit')]
  [string]$Mode,

  [Parameter(Mandatory = $true)]
  [string]$ProductId,

  [Parameter(Mandatory = $true)]
  [string]$BundlePath,

  [Parameter(Mandatory = $true)]
  [string]$ExpectedVersion,

  [Parameter(Mandatory = $true)]
  [string]$ReleaseNotesPath,

  [Parameter(Mandatory = $true)]
  [string]$WorkDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$archivePath = Join-Path $WorkDirectory 'store-upload.zip'
try {
  if (-not (Test-Path -LiteralPath $BundlePath -PathType Leaf)) {
    throw 'The validated Store bundle is missing.'
  }
  New-Item -ItemType Directory -Path $WorkDirectory -Force | Out-Null
  if ($Mode -eq 'Submit') {
    Compress-Archive -LiteralPath $BundlePath -DestinationPath $archivePath -CompressionLevel Optimal
  }
  & node (Join-Path $PSScriptRoot 'store-release.mjs') `
    $Mode $ProductId $BundlePath $ExpectedVersion $ReleaseNotesPath $archivePath
  if ($LASTEXITCODE -ne 0) {
    throw 'Store automation stopped. Inspect the reported stage and submission; do not rerun.'
  }
} catch {
  $message = 'Store release stopped. Inspect the stage and submission above before further action. No automatic retry was performed.'
  Write-Output $message
  if ($env:GITHUB_STEP_SUMMARY) {
    Add-Content -LiteralPath $env:GITHUB_STEP_SUMMARY -Value $message
  }
  throw $message
} finally {
  if (Test-Path -LiteralPath $archivePath) {
    Remove-Item -LiteralPath $archivePath -Force
  }
}
