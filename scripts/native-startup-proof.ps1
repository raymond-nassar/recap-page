[CmdletBinding()]
param(
  [ValidateSet('x64', 'arm64')]
  [string]$Architecture = 'x64',
  [switch]$Negatives,
  [switch]$Diagnostic
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_OS -ne 'Windows') {
  throw 'Native startup proof is confined to controlled Windows Actions runners.'
}
if ($Negatives -and $Diagnostic) { throw 'Native proof modes cannot be combined.' }
if ($Diagnostic -and $Architecture -ne 'x64') { throw 'Diagnostic mode is x64 only.' }
$root = Split-Path -Parent $PSScriptRoot
& node (Join-Path $root 'scripts\lib\native-launcher.mjs') --verify --proof
if ($LASTEXITCODE -ne 0) { throw 'Native proof inputs did not validate.' }
$scratch = Join-Path $env:RUNNER_TEMP "recap-native-proof-$Architecture-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
if (Test-Path -LiteralPath $scratch) { throw 'The native proof scratch directory already exists.' }
New-Item -ItemType Directory -Path $scratch -ErrorAction Stop | Out-Null
$driver = Join-Path $root "dist\native-proof\$Architecture\NativeStartupTests.exe"
$launcher = Join-Path $root "dist\native-launcher\$Architecture\RecapPageLauncher.exe"
$fixture = Join-Path $root 'test\native\Launcher.fixture.mjs.in'
$goldens = Join-Path $root 'test\native\startup-frames.txt'

function Invoke-NativeProof {
  param([string]$Executable, [string[]]$Arguments, [string]$Report)
  $start = [Diagnostics.ProcessStartInfo]::new()
  $start.FileName = $Executable
  $start.UseShellExecute = $false
  $start.CreateNoWindow = $true
  $start.RedirectStandardOutput = $true
  $start.RedirectStandardError = $true
  foreach ($argument in $Arguments) { [void]$start.ArgumentList.Add($argument) }
  $process = [Diagnostics.Process]::new()
  $process.StartInfo = $start
  [void]$process.Start()
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(900000)) {
    $process.Kill()
    $process.WaitForExit()
    throw 'The owned native proof driver exceeded its deadline.'
  }
  $out = $stdout.GetAwaiter().GetResult()
  $err = $stderr.GetAwaiter().GetResult()
  $exitCode = $process.ExitCode
  $process.Dispose()
  if (-not (Test-Path -LiteralPath $Report -PathType Leaf)) {
    throw "Native proof produced no report; exit $exitCode."
  }
  $text = Get-Content -LiteralPath $Report -Raw
  Write-Output $text
  if ($out.Trim() -or $err.Trim()) {
    throw 'The native proof driver produced unexpected uncaptured diagnostics.'
  }
  [pscustomobject]@{ ExitCode = $exitCode; Text = $text }
}

try {
  $packageRuntime = $null
  if (-not $Negatives) {
    $version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
    $package = Join-Path $root "dist\msix\RecapPage_${version}.0_$Architecture.msix"
    $layout = Join-Path $scratch 'package'
    & winapp tool makeappx unpack /p $package /d $layout /o
    if ($LASTEXITCODE -ne 0) { throw 'The native fixture package could not be unpacked.' }
    if ((Get-FileHash -LiteralPath (Join-Path $layout 'RecapPageLauncher.exe') -Algorithm SHA256).Hash -ne
        (Get-FileHash -LiteralPath $launcher -Algorithm SHA256).Hash) {
      throw 'The fixture launcher differs from the inspected package.'
    }
    $packageRuntime = Join-Path $layout 'runtime\node.exe'
  }
  if ($Negatives -or $Diagnostic) {
    if ($Architecture -ne 'x64') { throw 'Aimed negatives run only on the x64 producer.' }
    if ($Negatives) {
      $runtimeInfo = (& node -p 'JSON.stringify({path:process.execPath,version:process.version,architecture:process.arch})') |
        ConvertFrom-Json
      if ($LASTEXITCODE -ne 0 -or $runtimeInfo.architecture -ne 'x64') {
        throw 'The producer fixture requires its resolved x64 setup-node runtime.'
      }
      $runtimeHash = (Get-FileHash -LiteralPath $runtimeInfo.path -Algorithm SHA256).Hash.ToLowerInvariant()
      $sums = (Invoke-WebRequest -Uri "https://nodejs.org/dist/$($runtimeInfo.version)/SHASUMS256.txt").Content
      if (-not ($sums -match "(?m)^$runtimeHash\s+win-x64/node\.exe\s*$")) {
        throw 'The producer fixture runtime differs from its published executable hash.'
      }
      Write-Output "producer-runtime=$($runtimeInfo.version);architecture=x64;sha256=$runtimeHash"
    }
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    $vs = @(& $vswhere -latest -products '*' -version '[17.0,18.0)' `
      -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath)
    if ($LASTEXITCODE -ne 0 -or $vs.Count -ne 1) { throw 'The producer compiler could not be resolved.' }
    $toolVersion = (Get-Content -LiteralPath (Join-Path $vs[0] `
      'VC\Auxiliary\Build\Microsoft.VCToolsVersion.default.txt') -Raw).Trim()
    $compiler = Join-Path $vs[0] "VC\Tools\MSVC\$toolVersion\bin\Hostx64\x64\cl.exe"
    $setup = Join-Path $vs[0] 'VC\Auxiliary\Build\vcvars64.bat'
    $record = Get-Content -LiteralPath (Join-Path $root 'dist\native-launcher\build.json') -Raw | ConvertFrom-Json
    if ((Get-FileHash -LiteralPath $compiler -Algorithm SHA256).Hash.ToLowerInvariant() -ne $record.toolchain.targets[0].compiler) {
      throw 'The negative compiler differs from the production compiler.'
    }
    $resources = Join-Path $env:RUNNER_TEMP "recap-native-negative-inputs-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT\Launcher.res"
    if (-not (Test-Path -LiteralPath $resources -PathType Leaf)) { throw 'The producer resource object is missing.' }
    $mutations = @('N1', 'N2', 'N3')
    if ($Diagnostic) { $mutations = @('N3') }
    foreach ($negative in $mutations) {
      $copy = Join-Path $scratch $negative
      New-Item -ItemType Directory -Path $copy -ErrorAction Stop | Out-Null
      foreach ($name in @('Launcher.cpp', 'StartupProcess.h', 'StartupProtocol.h')) {
        Copy-Item -LiteralPath (Join-Path $root "packaging\windows\native\$name") -Destination (Join-Path $copy $name)
      }
      $changed = Join-Path $copy 'StartupProtocol.h'
      $before = '    const auto frame = decodeFrame(capture);'
      $after = '    if (capture.output.empty() && exitKnown && exitCode == 0) return { true, {} };' + "`n" + $before
      $case = 'N1'
      $expectedFailure = 'N1 missing frame was accepted as opened'
      if ($negative -eq 'N2') {
        $changed = Join-Path $copy 'Launcher.cpp'
        $before = 'ShowWindow(window, SW_HIDE);'
        $after = 'DestroyWindow(window);'
        $case = 'F03'
        $expectedFailure = 'F03 pending close lost the startup owner'
      } elseif ($negative -eq 'N3') {
        $changed = Join-Path $copy 'StartupProcess.h'
        $before = 'CREATE_NO_WINDOW | EXTENDED_STARTUPINFO_PRESENT'
        $after = 'EXTENDED_STARTUPINFO_PRESENT'
        $case = 'F01'
        $expectedFailure = 'F01 coordinator created a visible terminal'
      }
      $text = [IO.File]::ReadAllText($changed)
      if ([regex]::Matches($text, [regex]::Escape($before)).Count -ne 1) {
        throw "$negative does not target exactly one predicate."
      }
      [IO.File]::WriteAllText($changed, $text.Replace($before, $after), [Text.UTF8Encoding]::new($false))
      $mutant = Join-Path $copy 'mutant.exe'
      $flags = "/nologo /std:c++17 /O2 /MT /EHsc /W4 /WX /utf-8 /GS /sdl /guard:cf /Brepro /DNDEBUG /DUNICODE /D_UNICODE /DNOMINMAX /DWIN32_LEAN_AND_MEAN /D_WIN32_WINNT=0x0A00 /DWINVER=0x0A00 /I`"$copy`" /Fo`"$copy\mutant.obj`" /Fe`"$mutant`""
      $compile = "`"$compiler`" $flags `"$copy\Launcher.cpp`" `"$resources`" /link /MACHINE:X64 /DYNAMICBASE /NXCOMPAT /HIGHENTROPYVA /GUARD:CF /MANIFEST:NO /SUBSYSTEM:WINDOWS,10.00 user32.lib gdi32.lib ole32.lib windowscodecs.lib comctl32.lib msimg32.lib"
      if ($negative -eq 'N1') {
        $compile = "`"$compiler`" $flags `"$root\test\native\StartupTests.cpp`" /link /MACHINE:X64 /DYNAMICBASE /NXCOMPAT /HIGHENTROPYVA /GUARD:CF /MANIFEST:NO /SUBSYSTEM:CONSOLE,10.00 user32.lib gdi32.lib ole32.lib oleaut32.lib uiautomationcore.lib advapi32.lib tdh.lib shell32.lib uuid.lib"
      }
      & $env:ComSpec /d /s /c "call `"$setup`" -vcvars_ver=$toolVersion 10.0.26100.0 && $compile"
      if ($LASTEXITCODE -ne 0) { throw "$negative compilation failed; this is not a proven negative." }
      if ($Diagnostic) { continue }
      $report = Join-Path $copy 'result.txt'
      $runDriver = $driver
      $runLauncher = $mutant
      if ($negative -eq 'N1') { $runDriver = $mutant; $runLauncher = $launcher }
      $arguments = @('--case', $case, '--report', $report, '--goldens', $goldens,
        '--root', (Join-Path $copy 'fixtures'), '--launcher', $runLauncher,
        '--runtime', $runtimeInfo.path, '--fixture', $fixture, '--console-only', 'true')
      $results = @(Invoke-NativeProof -Executable $runDriver -Arguments $arguments -Report $report)
      $result = $results[-1]
      $results | Select-Object -SkipLast 1 | Write-Output
      if ($result.ExitCode -ne 1 -or -not $result.Text.Contains($expectedFailure)) {
        throw "$negative did not fail its intended assertion."
      }
      Write-Output "PASS aimed-negative=$negative;case=$case;expected-failure-observed=true"
    }
    if ($Diagnostic) {
      $runtimeHash = (Get-FileHash -LiteralPath $packageRuntime -Algorithm SHA256).Hash.ToLowerInvariant()
      $runtimeInfo = (& $packageRuntime -p 'JSON.stringify({version:process.version,architecture:process.arch})') |
        ConvertFrom-Json
      if ($LASTEXITCODE -ne 0 -or $runtimeInfo.architecture -ne 'x64') {
        throw 'The inspected package runtime did not report native x64.'
      }
      $report = Join-Path $scratch 'diagnostic.txt'
      $diagnosticRoot = Join-Path $scratch 'diagnostic'
      $arguments = @('--mode', 'diagnostic', '--root', $diagnosticRoot,
        '--report', $report, '--launcher', $launcher, '--mutant', $mutant,
        '--runtime', $packageRuntime, '--fixture', $fixture,
        '--runtime-hash', $runtimeHash, '--runtime-version', $runtimeInfo.version)
      $results = @(Invoke-NativeProof -Executable $driver -Arguments $arguments -Report $report)
      $result = $results[-1]
      $results | Select-Object -SkipLast 1 | Write-Output
      foreach ($case in @('D1', 'D2', 'D3')) {
        $copy = Join-Path $diagnosticRoot "$case space $([char]0x03a9)\runtime\node.exe"
        if (-not (Test-Path -LiteralPath $copy -PathType Leaf)) {
          throw "$case did not acquire its fixed diagnostic runtime."
        }
        if ((Get-FileHash -LiteralPath $copy -Algorithm SHA256).Hash.ToLowerInvariant() -ne $runtimeHash) {
          throw "$case runtime bytes differ from the inspected package."
        }
        Write-Output "DIAG runtime-copy case=$case sha256=$runtimeHash"
      }
      if ($result.ExitCode -ne 0 -or -not $result.Text.Contains('PASS diagnostic-facts-only')) {
        throw 'The diagnostic acquisition was incomplete; this is not a feature acceptance result.'
      }
      Write-Output 'DIAG acquisition complete; feature-acceptance=not-evaluated'
    }
  } else {
    $report = Join-Path $scratch 'result.txt'
    $arguments = @('--report', $report, '--goldens', $goldens, '--root', (Join-Path $scratch 'fixtures'),
      '--launcher', $launcher, '--runtime', $packageRuntime, '--fixture', $fixture)
    $results = @(Invoke-NativeProof -Executable $driver -Arguments $arguments -Report $report)
    $result = $results[-1]
    $results | Select-Object -SkipLast 1 | Write-Output
    if ($result.ExitCode -ne 0 -or ([regex]::Matches($result.Text, '(?m)^PASS F\d\d$').Count -ne 11)) {
      throw "The $Architecture native suite failed or did not run all 11 release fixtures."
    }
    Write-Output "PASS native-suite=$Architecture;gui-activations=11;coordinator-fixtures=9;sentinels=2"
  }
} finally {
  if (Test-Path -LiteralPath $scratch) { Remove-Item -LiteralPath $scratch -Recurse -Force }
  if ($Negatives -or $Diagnostic) {
    $negativeInputs = Join-Path $env:RUNNER_TEMP "recap-native-negative-inputs-$env:GITHUB_RUN_ID-$env:GITHUB_RUN_ATTEMPT"
    if (Test-Path -LiteralPath $negativeInputs) { Remove-Item -LiteralPath $negativeInputs -Recurse -Force }
  }
}
