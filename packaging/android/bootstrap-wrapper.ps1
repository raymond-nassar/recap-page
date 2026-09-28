$ErrorActionPreference = 'Stop'
$wrapper = Join-Path $PSScriptRoot 'gradle\wrapper\gradle-wrapper.jar'
$expected = '238e777fcddd7e34f9708186085def2abd6e08e658505b38718d79d74c21abd5'

if (-not (Test-Path -LiteralPath $wrapper)) {
    $download = "$wrapper.download"
    try {
        Invoke-WebRequest -UseBasicParsing `
            -Uri 'https://raw.githubusercontent.com/gradle/gradle/v9.8.0/gradle/wrapper/gradle-wrapper.jar' `
            -OutFile $download
        if ((Get-FileHash -LiteralPath $download -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
            throw 'The Gradle wrapper checksum does not match the official Gradle 9.8.0 release.'
        }
        Move-Item -LiteralPath $download -Destination $wrapper
    } finally {
        if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download }
    }
}

if ((Get-FileHash -LiteralPath $wrapper -Algorithm SHA256).Hash.ToLowerInvariant() -ne $expected) {
    throw 'The Gradle wrapper checksum does not match the official Gradle 9.8.0 release.'
}
Write-Output 'Gradle 9.8.0 wrapper verified.'
