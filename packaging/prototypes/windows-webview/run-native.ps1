param(
    [ValidateSet('x64', 'ARM64')]
    [string]$Architecture = 'ARM64'
)

$ErrorActionPreference = 'Stop'
$prototype = Split-Path -Parent $MyInvocation.MyCommand.Path
$binary = Join-Path $prototype ("out\RecapPageWebViewPrototype.exe")
if (-not (Test-Path $binary -PathType Leaf)) {
    throw "Build the $Architecture prototype first with build.ps1."
}

$startedAt = [DateTime]::UtcNow
$app = Start-Process -FilePath $binary -PassThru
$observations = @()
Write-Output "Prototype PID $($app.Id) started. Exercise the manual native journey, then close every prototype window."

while (-not $app.HasExited) {
    $all = Get-CimInstance Win32_Process -ErrorAction Stop
    $ids = New-Object 'System.Collections.Generic.HashSet[int]'
    [void]$ids.Add([int]$app.Id)
    do {
        $changed = $false
        foreach ($process in $all) {
            if ($ids.Contains([int]$process.ParentProcessId) -and $ids.Add([int]$process.ProcessId)) {
                $changed = $true
            }
        }
    } while ($changed)

    $listeners = Get-NetTCPConnection -State Listen -ErrorAction Stop |
        Where-Object { $ids.Contains([int]$_.OwningProcess) }
    $observations += [pscustomobject]@{
        AtUtc = [DateTime]::UtcNow.ToString('o')
        ProcessIds = @($ids)
        ListenerCount = @($listeners).Count
        ListeningEndpoints = @($listeners | ForEach-Object { "$($_.LocalAddress):$($_.LocalPort) (PID $($_.OwningProcess))" })
    }
    Start-Sleep -Seconds 2
    $app.Refresh()
}

$result = [pscustomobject]@{
    StartedAtUtc = $startedAt.ToString('o')
    ExitedAtUtc = [DateTime]::UtcNow.ToString('o')
    ExitCode = $app.ExitCode
    Architecture = $Architecture
    Observations = $observations
}
$destination = Join-Path $prototype 'out\native-observation.json'
$result | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $destination -Encoding UTF8
if (@($observations | Where-Object { $_.ListenerCount -gt 0 }).Count -gt 0) {
    throw "A process in the prototype tree opened a TCP listener. See $destination"
}
Write-Output "No TCP listeners were observed in the prototype process tree. Evidence: $destination"
