param(
  [Parameter(Mandatory = $true)]
  [ValidateScript({ $_ -ge 1 })]
  [uint32]$recapProcessId
)

$ErrorActionPreference = 'Stop'
try {
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
    if ($buffer -eq [IntPtr]::Zero -or $size -lt $rowOffset -or $size -gt $maxTableBytes) {
      throw 'Invalid TCP listener buffer.'
    }
    $count = [uint32][Runtime.InteropServices.Marshal]::ReadInt32($buffer)
    if ($count -gt (($size - $rowOffset) / $rowSize)) { throw 'Invalid TCP listener row count.' }
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
    $size = [uint32]0
    $result = $nativeType::GetExtendedTcpTable([IntPtr]::Zero, [ref]$size, 0, 2, 3, 0)
    if ($result -ne 122) { throw 'TCP listener size query failed.' }
    if ($size -lt $rowOffset -or $size -gt $maxTableBytes) { throw 'Invalid TCP listener table size.' }
    $capacity = $size
    $buffer = [Runtime.InteropServices.Marshal]::AllocHGlobal([int]$capacity)
    try {
      $result = $nativeType::GetExtendedTcpTable($buffer, [ref]$size, 0, 2, 3, 0)
      if ($result -ne 0) { throw 'TCP listener query failed.' }
      if ($size -gt $capacity) { throw 'TCP listener table grew.' }
      return (Test-RecapListener $buffer $size $ownerId)
    } finally {
      [Runtime.InteropServices.Marshal]::FreeHGlobal($buffer)
    }
  }
  if (Test-RecapServerOwner $recapProcessId) {
    $searcher = [System.Management.ManagementObjectSearcher]::new("SELECT ExecutablePath, CommandLine FROM Win32_Process WHERE ProcessId = $recapProcessId")
    try {
      $rows = $searcher.Get()
      try {
        foreach ($process in $rows) {
          try {
            [pscustomobject]@{
              ExecutablePath = $process['ExecutablePath']
              CommandLine = $process['CommandLine']
            } | ConvertTo-Json -Compress
          } finally {
            $process.Dispose()
          }
        }
      } finally {
        $rows.Dispose()
      }
    } finally {
      $searcher.Dispose()
    }
  }
} catch {
  [Console]::Error.WriteLine('Server ownership query failed.')
  exit 1
}
