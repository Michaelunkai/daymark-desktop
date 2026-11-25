# suspend-tree.ps1 - suspend or resume an explicit list of pids via ntdll
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File suspend-tree.ps1 -PidsCsv 1234,5678 [-Resume]
param(
    [Parameter(Mandatory=$true)][string]$PidsCsv,
    [switch]$Resume
)
$Pids = @($PidsCsv -split ',' | ForEach-Object { [int]$_ })
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class NT {
    [DllImport("ntdll.dll")] public static extern int NtSuspendProcess(IntPtr h);
    [DllImport("ntdll.dll")] public static extern int NtResumeProcess(IntPtr h);
    [DllImport("kernel32.dll", SetLastError=true)] public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
    [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);
}
"@

$tree = $Pids

foreach ($procId in $tree) {
    try {
        $h = [NT]::OpenProcess(0x1F0FFF, $false, $procId) # PROCESS_ALL_ACCESS
        if ($h -eq [IntPtr]::Zero) { Write-Output "$procId open-failed"; continue }
        $rc = if ($Resume) { [NT]::NtResumeProcess($h) } else { [NT]::NtSuspendProcess($h) }
        [void][NT]::CloseHandle($h)
        $verb = if ($Resume) { 'resumed' } else { 'suspended' }
        if ($rc -eq 0) { Write-Output "$procId $verb" } else { Write-Output "$procId ntstatus-0x$($rc.ToString('X'))" }
    } catch {
        Write-Output "$procId error $($_.Exception.Message)"
    }
}
