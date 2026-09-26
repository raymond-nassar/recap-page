$ErrorActionPreference = 'Stop'
$wrapper = Join-Path $PSScriptRoot 'gradle\wrapper\gradle-wrapper.jar'
$expected = '81a82aaea5abcc8ff68b3dfcb58b3c3c429378efd98e7433460610fecd7ae45f'

if (-not (Test-Path -LiteralPath $wrapper)) {
    $download = "$wrapper.download"
    try {
        Invoke-WebRequest -UseBasicParsing `
            -Uri 'https://raw.githubusercontent.com/gradle/gradle/v8.13.0/gradle/wrapper/gradle-wrapper.jar' `
            -OutFile $download
        if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
            throw 'The Gradle wrapper checksum does not match the official Gradle 8.13 release.'
        }
        Move-Item -LiteralPath $download -Destination $wrapper
    } finally {
        if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download }
    }
}

if ((Get-FileHash -LiteralPath $wrapper -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    throw 'The Gradle wrapper checksum does not match the official Gradle 8.13 release.'
}
Write-Output 'Gradle 8.13 wrapper verified.'
