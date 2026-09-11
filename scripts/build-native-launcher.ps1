[CmdletBinding()]
param([switch]$IncludeProofTools)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Native builds belong on a controlled Windows Actions runner.'
}
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$visualStudio = @(& $vswhere -latest -products '*' -version '[17.0,18.0)' `
  -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 `
    Microsoft.VisualStudio.Component.VC.Tools.ARM64 -property installationPath)
if ($LASTEXITCODE -ne 0 -or $visualStudio.Count -ne 1) {
  throw 'Visual Studio 2022 with both required native targets was not found.'
}
$visualStudio = $visualStudio[0].Trim()
$toolVersion = (Get-Content -LiteralPath (Join-Path $visualStudio `
  'VC\Auxiliary\Build\Microsoft.VCToolsVersion.default.txt') -Raw).Trim()
$sdk = '10.0.26100.0'
$sdkBin = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin\$sdk\x64"
$resourceCompiler = Join-Path $sdkBin 'rc.exe'
if (-not (Test-Path -LiteralPath $resourceCompiler -PathType Leaf)) {
  throw "The required Windows SDK $sdk is not installed in this runner image."
}
$source = Join-Path $root 'packaging\windows\native'
$production = Join-Path $root 'dist\native-launcher'
$proof = Join-Path $root 'dist\native-proof'
$intermediate = Join-Path $env:RUNNER_TEMP "recap-native-build-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
foreach ($path in @($production, $proof, $intermediate)) {
  if (Test-Path -LiteralPath $path) { Remove-Item -LiteralPath $path -Recurse -Force }
  New-Item -ItemType Directory -Path $path -ErrorAction Stop | Out-Null
}
$targets = @()
$compilerVersion = $null
try {
  $nodeCommand = Get-Command -Name node.exe -CommandType Application -All -ErrorAction Stop |
    Select-Object -First 1
  if (-not $nodeCommand) { throw 'The builder Node executable was not found.' }
  $node = $nodeCommand.Source
  if ($node -isnot [string] -or [string]::IsNullOrWhiteSpace($node) -or
      $node -notmatch '^(?:[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+[\\/])' -or
      $node -notmatch '\.exe$' -or -not (Test-Path -LiteralPath $node -PathType Leaf)) {
    throw 'The builder Node executable path is invalid.'
  }
  if ($IncludeProofTools) {
    $creationReport = Join-Path $intermediate 'creation-tests.tap'
    $creationError = Join-Path $intermediate 'creation-tests.err'
    $arguments = '--test --test-reporter=tap test/msix-packaging.test.js test/server-contract.test.js test/startup-contract.test.js'
    $tests = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $root `
      -NoNewWindow -PassThru -RedirectStandardOutput $creationReport -RedirectStandardError $creationError
    try {
      if (-not $tests.WaitForExit(120000)) {
        Stop-Process -Id $tests.Id -Force -ErrorAction Stop
        throw 'The fixed production-creation test selection exceeded its deadline.'
      }
      $tests.Refresh()
      $creationExit = $tests.ExitCode
      Get-Content -LiteralPath $creationReport | Write-Output
      if ((Get-Item -LiteralPath $creationError).Length) { Get-Content -LiteralPath $creationError | Write-Output }
      if ($creationExit -ne 0) { throw 'The fixed production-creation tests failed.' }
      $versionRecords = [regex]::Matches([IO.File]::ReadAllText($creationReport), '(?m)^# creation-runtime=(v24\.\d+\.\d+)\r?$')
      if ($versionRecords.Count -ne 1) { throw 'The creation-test runtime version was unavailable.' }
      $nodeVersion = $versionRecords[0].Groups[1].Value
      [ordered]@{ exitCode = $creationExit; nodeVersion = $nodeVersion } |
        ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $intermediate 'creation-execution.json') -Encoding utf8
    } finally { $tests.Dispose() }
  }
  foreach ($architecture in @('x64', 'arm64')) {
    $bin = Join-Path $visualStudio "VC\Tools\MSVC\$toolVersion\bin\Hostx64\$architecture"
    $compiler = Join-Path $bin 'cl.exe'
    $linker = Join-Path $bin 'link.exe'
    foreach ($tool in @($compiler, $linker)) {
      if (-not (Test-Path -LiteralPath $tool -PathType Leaf)) { throw "Missing native tool: $tool" }
    }
    $compilerVersion = (Get-Item -LiteralPath $compiler).VersionInfo.FileVersion.Trim()
    $targets += [ordered]@{
      architecture = $architecture
      compiler = (Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash.ToLowerInvariant()
      linker = (Get-FileHash -LiteralPath $linker -Algorithm SHA256).Hash.ToLowerInvariant()
      resources = (Get-FileHash -LiteralPath $resourceCompiler -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $targetWork = Join-Path $intermediate $architecture
    $targetOut = Join-Path $production $architecture
    $proofOut = Join-Path $proof $architecture
    foreach ($path in @($targetWork, $targetOut, $proofOut)) {
      New-Item -ItemType Directory -Path $path -ErrorAction Stop | Out-Null
    }
    $setupName = 'vcvars64.bat'
    if ($architecture -eq 'arm64') { $setupName = 'vcvarsamd64_arm64.bat' }
    $setup = Join-Path $visualStudio "VC\Auxiliary\Build\$setupName"
    $flags = '/nologo /std:c++17 /O2 /MT /EHsc /W4 /WX /utf-8 /GS /sdl /guard:cf /Brepro /DNDEBUG /DUNICODE /D_UNICODE /DNOMINMAX /DWIN32_LEAN_AND_MEAN /D_WIN32_WINNT=0x0A00 /DWINVER=0x0A00'
    $linkFlags = "/MACHINE:$architecture /DYNAMICBASE /NXCOMPAT /HIGHENTROPYVA /GUARD:CF /MANIFEST:NO"
    $commands = @(
      "call `"$setup`" -vcvars_ver=$toolVersion $sdk",
      "cd /d `"$source`"",
      "`"$resourceCompiler`" /nologo /fo `"$targetWork\Launcher.res`" Launcher.rc",
      "`"$compiler`" $flags /Fo`"$targetWork\Launcher.obj`" /Fe`"$targetOut\RecapPageLauncher.exe`" Launcher.cpp `"$targetWork\Launcher.res`" /link $linkFlags /SUBSYSTEM:WINDOWS,10.00 user32.lib gdi32.lib ole32.lib windowscodecs.lib comctl32.lib msimg32.lib"
    )
    if ($IncludeProofTools) {
      $commands += "`"$compiler`" $flags /I`"$source`" /Fo`"$targetWork\StartupTests.obj`" /Fe`"$proofOut\NativeStartupTests.exe`" `"$root\test\native\StartupTests.cpp`" /link $linkFlags /SUBSYSTEM:CONSOLE,10.00 user32.lib gdi32.lib ole32.lib oleaut32.lib uiautomationcore.lib advapi32.lib tdh.lib shell32.lib uuid.lib"
    }
    & $env:ComSpec /d /s /c ($commands -join ' && ')
    if ($LASTEXITCODE -ne 0) { throw "The $architecture native build failed." }
    if ($IncludeProofTools -and $architecture -eq 'x64') {
      $negativeInputs = Join-Path $env:RUNNER_TEMP "recap-native-negative-inputs-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
      New-Item -ItemType Directory -Path $negativeInputs -Force -ErrorAction Stop | Out-Null
      Copy-Item -LiteralPath (Join-Path $targetWork 'Launcher.res') `
        -Destination (Join-Path $negativeInputs 'Launcher.res')
    }
  }
  $metadata = Join-Path $intermediate 'toolchain.json'
  [ordered]@{
    image = "$env:ImageOS $env:ImageVersion".Trim()
    sdk = $sdk
    compilerVersion = $compilerVersion
    targets = $targets
  } | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $metadata -Encoding utf8
  $arguments = @((Join-Path $root 'scripts\lib\native-launcher.mjs'), '--record', $metadata)
  if ($IncludeProofTools) { $arguments += '--proof' }
  & $node @arguments
  if ($LASTEXITCODE -ne 0) { throw 'The native artifact could not be recorded and verified.' }
} finally {
  if (Test-Path -LiteralPath $intermediate) {
    Remove-Item -LiteralPath $intermediate -Recurse -Force
  }
}
