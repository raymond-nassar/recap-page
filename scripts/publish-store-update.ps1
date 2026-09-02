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
  [string]$WorkDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Require-EnvironmentValue {
  param([Parameter(Mandatory = $true)][string]$Name)

  $value = [Environment]::GetEnvironmentVariable($Name)
  if ([string]::IsNullOrWhiteSpace($value)) {
    throw "Required environment value $Name is missing."
  }
  return $value
}

function Invoke-SingleHttpRequest {
  param(
    [Parameter(Mandatory = $true)][string]$Method,
    [Parameter(Mandatory = $true)][string]$Uri,
    [hashtable]$Headers = @{},
    [string]$Body,
    [string]$ContentType,
    [Parameter(Mandatory = $true)][int[]]$ExpectedStatus
  )

  $handler = [Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $client = [Net.Http.HttpClient]::new($handler)
  $request = [Net.Http.HttpRequestMessage]::new(
    [Net.Http.HttpMethod]::new($Method),
    $Uri
  )
  try {
    foreach ($entry in $Headers.GetEnumerator()) {
      if (-not $request.Headers.TryAddWithoutValidation($entry.Key, [string]$entry.Value)) {
        throw "Could not set required request header $($entry.Key)."
      }
    }
    if ($PSBoundParameters.ContainsKey('Body')) {
      $request.Content = [Net.Http.StringContent]::new(
        $Body,
        [Text.Encoding]::UTF8,
        $ContentType
      )
    }

    $response = $client.SendAsync(
      $request,
      [Net.Http.HttpCompletionOption]::ResponseContentRead
    ).GetAwaiter().GetResult()
    try {
      $responseBody = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
      $status = [int]$response.StatusCode
      if ($ExpectedStatus -notcontains $status) {
        throw "Store request failed with HTTP $status. Inspect Partner Center before retrying."
      }
      return $responseBody
    } finally {
      $response.Dispose()
    }
  } finally {
    $request.Dispose()
    $client.Dispose()
    $handler.Dispose()
  }
}

function Send-SingleBlobUpload {
  param(
    [Parameter(Mandatory = $true)][string]$Uri,
    [Parameter(Mandatory = $true)][string]$Path
  )

  $handler = [Net.Http.HttpClientHandler]::new()
  $handler.AllowAutoRedirect = $false
  $client = [Net.Http.HttpClient]::new($handler)
  $request = [Net.Http.HttpRequestMessage]::new([Net.Http.HttpMethod]::Put, $Uri)
  $stream = [IO.File]::OpenRead($Path)
  try {
    $request.Headers.TryAddWithoutValidation('x-ms-blob-type', 'BlockBlob') | Out-Null
    $request.Content = [Net.Http.StreamContent]::new($stream)
    $request.Content.Headers.ContentType = [Net.Http.Headers.MediaTypeHeaderValue]::new(
      'application/zip'
    )
    $response = $client.SendAsync(
      $request,
      [Net.Http.HttpCompletionOption]::ResponseHeadersRead
    ).GetAwaiter().GetResult()
    try {
      if ([int]$response.StatusCode -ne 201) {
        throw "Store package upload failed with HTTP $([int]$response.StatusCode). Inspect Partner Center before retrying."
      }
    } finally {
      $response.Dispose()
    }
  } finally {
    $stream.Dispose()
    $request.Dispose()
    $client.Dispose()
    $handler.Dispose()
  }
}

function Write-PrivateText {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Value
  )

  [IO.File]::WriteAllText(
    $Path,
    $Value,
    [Text.UTF8Encoding]::new($false)
  )
}

function Invoke-StoreCheck {
  param([Parameter(Mandatory = $true)][string[]]$Arguments)

  & node './scripts/check-store-release.mjs' @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw 'A Microsoft Store response failed local validation.'
  }
}

function Read-JsonObject {
  param([Parameter(Mandatory = $true)][string]$Path)

  return Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json -Depth 100
}

$tenantId = Require-EnvironmentValue 'PARTNER_CENTER_TENANT_ID'
$clientId = Require-EnvironmentValue 'PARTNER_CENTER_CLIENT_ID'
$clientSecret = Require-EnvironmentValue 'PARTNER_CENTER_CLIENT_SECRET'
foreach ($secret in @($tenantId, $clientId, $clientSecret)) {
  "::add-mask::$secret" | Write-Output
}

if (-not (Test-Path -LiteralPath $BundlePath -PathType Leaf)) {
  throw 'The validated Store bundle is missing.'
}
New-Item -ItemType Directory -Path $WorkDirectory -Force | Out-Null

$tokenBody = @(
  'grant_type=client_credentials'
  "client_id=$([Uri]::EscapeDataString($clientId))"
  "client_secret=$([Uri]::EscapeDataString($clientSecret))"
  'resource=https%3A%2F%2Fmanage.devcenter.microsoft.com'
) -join '&'
$tokenResponse = Invoke-SingleHttpRequest `
  -Method 'POST' `
  -Uri "https://login.microsoftonline.com/$([Uri]::EscapeDataString($tenantId))/oauth2/token" `
  -Body $tokenBody `
  -ContentType 'application/x-www-form-urlencoded' `
  -ExpectedStatus @(200)
$accessToken = ($tokenResponse | ConvertFrom-Json).access_token
if ([string]::IsNullOrWhiteSpace($accessToken)) {
  throw 'Microsoft Entra authentication returned no access token.'
}
"::add-mask::$accessToken" | Write-Output

$headers = @{
  Authorization = "Bearer $accessToken"
  Accept = 'application/json'
}
$escapedProductId = [Uri]::EscapeDataString($ProductId)
$applicationUrl = "https://manage.devcenter.microsoft.com/v1.0/my/applications/$escapedProductId"
$applicationPath = Join-Path $WorkDirectory 'application.json'
$applicationBody = Invoke-SingleHttpRequest `
  -Method 'GET' -Uri $applicationUrl -Headers $headers -ExpectedStatus @(200)
Write-PrivateText -Path $applicationPath -Value $applicationBody
Invoke-StoreCheck -Arguments @('application', $applicationPath, $ProductId)

$application = Read-JsonObject $applicationPath
$publishedId = [string]$application.lastPublishedApplicationSubmission.id
if ([string]::IsNullOrWhiteSpace($publishedId)) {
  throw 'The Store application has no last published submission ID.'
}
$submissionBase = "$applicationUrl/submissions"
$publishedPath = Join-Path $WorkDirectory 'published-submission.json'
$publishedBody = Invoke-SingleHttpRequest `
  -Method 'GET' `
  -Uri "$submissionBase/$([Uri]::EscapeDataString($publishedId))" `
  -Headers $headers `
  -ExpectedStatus @(200)
Write-PrivateText -Path $publishedPath -Value $publishedBody
Invoke-StoreCheck -Arguments @('api-package', $publishedPath, (Split-Path $BundlePath -Leaf))
Invoke-StoreCheck -Arguments @('submission', $publishedPath, $ExpectedVersion)
if ($Mode -eq 'Validate') {
  Write-Output 'Microsoft Store read-only activation rehearsal passed.'
  exit 0
}

$createdPath = Join-Path $WorkDirectory 'created-submission.json'
$createdBody = Invoke-SingleHttpRequest `
  -Method 'POST' -Uri $submissionBase -Headers $headers -ExpectedStatus @(200)
Write-PrivateText -Path $createdPath -Value $createdBody
$created = Read-JsonObject $createdPath
$submissionId = [string]$created.id
$uploadUrl = [string]$created.fileUploadUrl
if ([string]::IsNullOrWhiteSpace($submissionId) -or [string]::IsNullOrWhiteSpace($uploadUrl)) {
  throw 'The created Store submission did not include its ID and upload URL.'
}

$bundleName = Split-Path $BundlePath -Leaf
$preparedPath = Join-Path $WorkDirectory 'prepared-submission.json'
Invoke-StoreCheck -Arguments @(
  'prepare-api-draft',
  $createdPath,
  $preparedPath,
  $bundleName,
  $submissionId
)

$archivePath = Join-Path $WorkDirectory 'store-upload.zip'
Compress-Archive -LiteralPath $BundlePath -DestinationPath $archivePath -CompressionLevel Optimal
Send-SingleBlobUpload -Uri $uploadUrl -Path $archivePath

$submissionUrl = "$submissionBase/$([Uri]::EscapeDataString($submissionId))"
$preparedBody = Get-Content -LiteralPath $preparedPath -Raw
Invoke-SingleHttpRequest `
  -Method 'PUT' `
  -Uri $submissionUrl `
  -Headers $headers `
  -Body $preparedBody `
  -ContentType 'application/json' `
  -ExpectedStatus @(200) | Out-Null

$verifiedPath = Join-Path $WorkDirectory 'verified-submission.json'
$verifiedBody = Invoke-SingleHttpRequest `
  -Method 'GET' -Uri $submissionUrl -Headers $headers -ExpectedStatus @(200)
Write-PrivateText -Path $verifiedPath -Value $verifiedBody
Invoke-StoreCheck -Arguments @('verify-draft', $verifiedPath, $bundleName, $submissionId)

$commitPath = Join-Path $WorkDirectory 'commit-response.json'
$commitBody = Invoke-SingleHttpRequest `
  -Method 'POST' -Uri "$submissionUrl/commit" -Headers $headers -ExpectedStatus @(200)
Write-PrivateText -Path $commitPath -Value $commitBody
Invoke-StoreCheck -Arguments @('commit', $commitPath)

Write-Output 'Microsoft Store submission was accepted for certification.'
