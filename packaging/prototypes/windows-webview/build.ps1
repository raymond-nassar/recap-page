param(
    [ValidateSet('x64', 'ARM64')]
    [string]$Architecture = 'ARM64'
)

$ErrorActionPreference = 'Stop'
$prototype = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = [IO.Path]::GetFullPath((Join-Path $prototype '..\..\..'))
$output = Join-Path $prototype 'out'
$packageRoot = Join-Path $env:USERPROFILE '.nuget\packages\microsoft.web.webview2\1.0.4078.44'
$manifest = Get-Content (Join-Path $prototype 'prototype.json') -Raw | ConvertFrom-Json
$packagePath = Join-Path $packageRoot 'microsoft.web.webview2.1.0.4078.44.nupkg'
$hashFile = Join-Path $packageRoot 'microsoft.web.webview2.1.0.4078.44.nupkg.sha512'
$kits = 'C:\Program Files (x86)\Windows Kits\10'
$windowsSdkVersion = $manifest.windowsSdk.version
$includeRoot = Join-Path $packageRoot 'build\native\include'
$library = Join-Path $packageRoot ("build\native\{0}\WebView2LoaderStatic.lib" -f $Architecture.ToLowerInvariant())
$msvcRoot = 'C:\BuildTools\VC\Auxiliary\Build'
$vcvars = Join-Path $msvcRoot 'vcvarsall.bat'
$compilerEnvironment = Join-Path $msvcRoot 'Microsoft.VCToolsVersion.default.txt'

if (-not (Test-Path $vcvars -PathType Leaf)) {
    throw "Visual Studio Build Tools is missing at C:\BuildTools. Install the approved C++ ARM64 and x64 components before building."
}
if (-not (Test-Path $packagePath -PathType Leaf) -or -not (Test-Path $hashFile -PathType Leaf)) {
    throw "Cached Microsoft.Web.WebView2 1.0.4078.44 package is required. This build does not download SDKs."
}
$actualHash = (Get-FileHash $packagePath -Algorithm SHA512).Hash
$expectedHash = [BitConverter]::ToString([Convert]::FromBase64String($manifest.webView2Sdk.sha512Base64)).Replace('-', '')
$cachedHashBase64 = (Get-Content $hashFile -Raw).Trim()
if ($actualHash -ne $expectedHash -or $cachedHashBase64 -ne $manifest.webView2Sdk.sha512Base64) {
    throw 'Cached WebView2 NuGet SHA-512 does not match prototype.json.'
}
if (-not (Test-Path (Join-Path $kits ("Include\{0}\um\windows.h" -f $windowsSdkVersion)) -PathType Leaf)) {
    throw "Windows SDK $windowsSdkVersion is not installed; this build does not install SDKs."
}
if (-not (Test-Path (Join-Path $includeRoot 'WebView2.h') -PathType Leaf) -or -not (Test-Path $library -PathType Leaf)) {
    throw "The cached WebView2 SDK is missing the $Architecture native headers or library."
}

$defaultMsvcVersion = (Get-Content $compilerEnvironment -Raw).Trim()
$compiler = Join-Path 'C:\BuildTools\VC\Tools\MSVC' (Join-Path $defaultMsvcVersion ("bin\HostARM64\{0}\cl.exe" -f $Architecture))
if (-not (Test-Path $compiler -PathType Leaf)) {
    throw "The ARM64-hosted MSVC $Architecture compiler is missing: $compiler"
}
$linkerDirectory = Split-Path -Parent $compiler
if (-not (Test-Path (Join-Path $linkerDirectory 'link.exe') -PathType Leaf)) {
    throw "The ARM64-hosted MSVC linker for $Architecture is missing from $linkerDirectory."
}

if (Test-Path $output) {
    Remove-Item -LiteralPath $output -Recurse -Force
}
New-Item -ItemType Directory -Path $output | Out-Null
$assets = Join-Path $output 'assets'
New-Item -ItemType Directory -Path $assets | Out-Null
Copy-Item -Path (Join-Path $repo 'src\*') -Destination $assets -Recurse -Force
$configHeader = Join-Path $output 'PrototypeConfig.generated.h'
& node (Join-Path $prototype 'generate-config.mjs') $configHeader
if ($LASTEXITCODE -ne 0) { throw 'Could not generate the scratch WebView configuration header.' }

$source = Join-Path $prototype 'native\Prototype.cpp'
$binary = Join-Path $output 'RecapPageWebViewPrototype.exe'
$object = Join-Path $output 'Prototype.obj'
$sdkLib = Join-Path $kits ("Lib\{0}\um\{1}" -f $windowsSdkVersion, $Architecture.ToLowerInvariant())
$compile = "`"$compiler`" /nologo /std:c++17 /EHsc /W4 /WX /permissive- /DUNICODE /D_UNICODE /DWIN32_LEAN_AND_MEAN /DNOMINMAX /I`"$includeRoot`" /I`"$output`" /Fo`"$object`" /Fe`"$binary`" `"$source`" /link /SUBSYSTEM:WINDOWS /LIBPATH:`"$sdkLib`" /LIBPATH:`"$($packageRoot)\build\native\$($Architecture.ToLowerInvariant())`" WebView2LoaderStatic.lib ole32.lib oleaut32.lib shell32.lib shlwapi.lib comdlg32.lib user32.lib advapi32.lib"
$vcEnvironment = if ($Architecture -eq 'ARM64') { 'amd64_arm64' } else { 'amd64' }
$installerPath = 'C:\Program Files (x86)\Microsoft Visual Studio\Installer'
$command = "set `"PATH=$linkerDirectory;$installerPath;%PATH%`" && call `"$vcvars`" $vcEnvironment $windowsSdkVersion >nul && $compile"
& $env:ComSpec /d /s /c $command
if ($LASTEXITCODE -ne 0) {
    throw "MSVC failed with exit code $LASTEXITCODE."
}

Write-Output "Build succeeded: $binary"
Write-Output "MSVC version: $defaultMsvcVersion"
Write-Output "Windows SDK: $windowsSdkVersion"
Write-Output "WebView2 SDK: $($manifest.webView2Sdk.version)"
