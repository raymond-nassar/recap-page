$ErrorActionPreference = 'Stop'
$wrapper = Join-Path (Join-Path (Join-Path $PSScriptRoot 'gradle') 'wrapper') 'gradle-wrapper.jar'
$source = 'https://raw.githubusercontent.com/gradle/gradle/v9.8.2/gradle/wrapper/gradle-wrapper.jar'
$expected = '3b8a25775a69158b5ad2b1d17a80a88dc7b40a352a73eb27d06c612a7ce68e98'

# PowerShell 7 removes its own module path entries only from a Windows PowerShell it starts
# directly, so one started through cmd.exe, as gradlew.bat is from a PowerShell 7 prompt, loads
# PowerShell 7's Utility manifest in place of its own. That manifest lists Get-FileHash as a
# compiled cmdlet that Windows PowerShell's assembly lacks, and never loads the script defining
# Windows PowerShell's own, so the first hash below was refused as an unrecognized command (#929).
# Importing the copy under the running PowerShell's own $PSHOME first hashes the same way however
# this one was started.
Import-Module (Join-Path (Join-Path $PSHOME 'Modules') 'Microsoft.PowerShell.Utility')

function Get-Sha256([string] $path) {
    (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}

# The JAR is ignored by git, so a wrapper version bump leaves the previous version's JAR in place.
# It is a genuine earlier wrapper, but not the pinned one, and refusing it outright broke every
# local build that had run before the bump (#904). So a JAR that does not match is replaced, never
# run: the pinned JAR is downloaded beside it, and only a download that matches the pin is moved
# over it. A download that does not match is deleted, and the old JAR is left unused.
$present = Test-Path -LiteralPath $wrapper
if (-not $present -or (Get-Sha256 $wrapper) -ne $expected) {
    $download = "$wrapper.download"
    try {
        Invoke-WebRequest -UseBasicParsing -Uri $source -OutFile $download
        if ((Get-Sha256 $download) -ne $expected) {
            $remedy = if ($present) {
                "The existing wrapper does not match either, so it was not run: delete $wrapper, then run the build again once the official download is reachable."
            } else {
                'Run the build again once the official download is reachable.'
            }
            throw "The downloaded Gradle wrapper does not match the official Gradle 9.8.2 release, so it was deleted and nothing was run. $remedy"
        }
        Move-Item -LiteralPath $download -Destination $wrapper -Force
    } finally {
        if (Test-Path -LiteralPath $download) { Remove-Item -LiteralPath $download -Force }
    }
}

if ((Get-Sha256 $wrapper) -ne $expected) {
    throw "The Gradle wrapper at $wrapper does not match the official Gradle 9.8.2 release. Delete it, then run the build again."
}
Write-Output 'Gradle 9.8.2 wrapper verified.'
