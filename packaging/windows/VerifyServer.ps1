param(
  [Parameter(Mandatory = $true)]
  [ValidateScript({ $_ -ge 1 })]
  [uint32]$recapProcessId
)

Write-Output ('RCPV1 language '+$ExecutionContext.SessionState.LanguageMode)
$ErrorActionPreference = 'Stop'
$verifierState = @{ Stage = 'interop'; Reason = 'exception'; Code = $null }
function Set-RecapVerifierStage([string]$stage) {
  $verifierState.Stage = $stage
  $verifierState.Reason = 'exception'
  $verifierState.Code = $null
  [Console]::Error.WriteLine(('RCPV1 {0} enter 0 {1}' -f $stage, [IntPtr]::Size))
  [Console]::Error.Flush()
}
function Stop-RecapVerifier([string]$reason, [long]$code) {
  $verifierState.Reason = $reason
  $verifierState.Code = $code
  throw 'Server ownership query failed.'
}
try {
  Set-RecapVerifierStage 'interop'
  # Reflection.Emit avoids the compiler children that Add-Type can launch.
  $assembly = [AppDomain]::CurrentDomain.DefineDynamicAssembly([Reflection.AssemblyName]::new('RecapPageTcpOwner'), [Reflection.Emit.AssemblyBuilderAccess]::Run)
  $module = $assembly.DefineDynamicModule('RecapPageTcpOwner')
  $native = $module.DefineType('Native', 'Public,Sealed,Abstract')
  $parameters = [Type[]]@([IntPtr], [uint32].MakeByRefType(), [int32], [uint32], [int32], [uint32])
  $method = $native.DefinePInvokeMethod('GetExtendedTcpTable', 'iphlpapi.dll', 'Public,Static,PinvokeImpl', 'Standard', [uint32], $parameters, 'Winapi', 'Ansi')
  $method.SetImplementationFlags($method.GetMethodImplementationFlags() -bor [Reflection.MethodImplAttributes]::PreserveSig)
  $nativeType = $native.CreateType()
  $row = $module.DefineType('Row', 'Public,SequentialLayout,Sealed', [ValueType])
  foreach ($field in @('State', 'LocalAddress', 'LocalPort', 'RemoteAddress', 'RemotePort', 'OwningPid')) {
    [void]$row.DefineField($field, [uint32], 'Public')
  }
  $rowType = $row.CreateType()
  $table = $module.DefineType('Table', 'Public,SequentialLayout,Sealed', [ValueType])
  [void]$table.DefineField('Count', [uint32], 'Public')
  [void]$table.DefineField('First', $rowType, 'Public')
  $tableType = $table.CreateType()
  $rowOffset = [Runtime.InteropServices.Marshal]::OffsetOf($tableType, 'First').ToInt32()
  $rowSize = [Runtime.InteropServices.Marshal]::SizeOf([type]$rowType)
  $loopback = [BitConverter]::ToUInt32([byte[]]@(127, 0, 0, 1), 0)
  $serverPort = 8787
  $maxTableBytes = 16777216
  function Test-RecapListener([IntPtr]$buffer, [uint32]$size, [uint32]$ownerId) {
    Set-RecapVerifierStage 'ip-decode'
    if ($buffer -eq [IntPtr]::Zero -or $size -lt $rowOffset -or $size -gt $maxTableBytes) {
      Stop-RecapVerifier 'invalid-buffer' -1
    }
    $count = [uint32][Runtime.InteropServices.Marshal]::ReadInt32($buffer)
    if ($count -gt (($size - $rowOffset) / $rowSize)) { Stop-RecapVerifier 'invalid-buffer' -1 }
    for ($index = 0; $index -lt $count; $index++) {
      $position = [IntPtr]::Add($buffer, $rowOffset + $index * $rowSize)
      $entry = [Runtime.InteropServices.Marshal]::PtrToStructure($position, [type]$rowType)
      $portBytes = [BitConverter]::GetBytes($entry.LocalPort)
      $port = ([int]$portBytes[0] -shl 8) -bor [int]$portBytes[1]
      if ($entry.State -eq 2 -and $entry.LocalAddress -eq $loopback -and $port -eq $serverPort -and $entry.OwningPid -eq $ownerId) {
        return $true
      }
    }
    return $false
  }
  function Test-RecapServerOwner([uint32]$ownerId) {
    Set-RecapVerifierStage 'ip-size'
    $size = [uint32]0
    $result = $nativeType::GetExtendedTcpTable([IntPtr]::Zero, [ref]$size, 0, 2, 3, 0)
    if ($result -ne 122) { Stop-RecapVerifier 'native-return' $result }
    if ($size -lt $rowOffset -or $size -gt $maxTableBytes) { Stop-RecapVerifier 'invalid-buffer' -1 }
    Set-RecapVerifierStage 'ip-query'
    $capacity = $size
    $buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal([int]$capacity)
    try {
      $result = $nativeType::GetExtendedTcpTable($buffer, [ref]$size, 0, 2, 3, 0)
      if ($result -ne 0) { Stop-RecapVerifier 'native-return' $result }
      if ($size -gt $capacity) { Stop-RecapVerifier 'invalid-buffer' -1 }
      return (Test-RecapListener $buffer $size $ownerId)
    } finally {
      [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
    }
  }
  if (Test-RecapServerOwner $recapProcessId) {
    Set-RecapVerifierStage 'wmi'
    $searcher = [System.Management.ManagementObjectSearcher]::new("SELECT ExecutablePath, CommandLine FROM Win32_Process WHERE ProcessId = $recapProcessId")
    try {
      $rows = $searcher.Get()
      try {
        $found = $false
        foreach ($process in $rows) {
          try {
            $found = $true
            [pscustomobject]@{
              ExecutablePath = $process['ExecutablePath']
              CommandLine = $process['CommandLine']
              VerifierPointerBytes = [IntPtr]::Size
            } | ConvertTo-Json -Compress
          } finally {
            $process.Dispose()
          }
        }
      } finally {
        $rows.Dispose()
      }
      if (-not $found) {
        [pscustomobject]@{ VerifierDiagnostic = ('RCPV1 wmi missing 0 {0}' -f [IntPtr]::Size) } | ConvertTo-Json -Compress
      }
    } finally {
      $searcher.Dispose()
    }
  } else {
    [pscustomobject]@{ VerifierDiagnostic = ('RCPV1 ip-owner not-owned 0 {0}' -f [IntPtr]::Size) } | ConvertTo-Json -Compress
  }
} catch {
  $code = $verifierState.Code
  if ($null -eq $code) { $code = $_.Exception.GetBaseException().HResult }
  [Console]::Error.WriteLine(('RCPV1 {0} {1} {2} {3}' -f $verifierState.Stage, $verifierState.Reason, $code, [IntPtr]::Size))
  [Console]::Error.Flush()
  exit 1
}
