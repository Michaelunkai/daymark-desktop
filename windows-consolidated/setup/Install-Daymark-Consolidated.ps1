param([Parameter(Mandatory = $true)][string]$Root)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $Root)) { throw "Missing root: $Root" }

$tools = Join-Path $Root 'tools'
$exe = Join-Path $Root 'Daymark.exe'
$userData = Join-Path $Root 'UserData'
$launcherArg = '--daymark-user-data-dir=' + $userData

Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name 'DaymarkLocalServer' -Value ('wscript.exe //B //NoLogo "' + (Join-Path $tools 'e.vbs') + '"')
Set-Item -Path 'Registry::HKEY_CLASSES_ROOT\daymark\shell\open\command' -Value ('"' + $exe + '" ' + $launcherArg + ' "%1"')

$shell = New-Object -ComObject WScript.Shell
$shortcuts = @(
  (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Daymark.lnk'),
  (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Daymark.lnk')
)
foreach ($lnk in $shortcuts) {
  if (Test-Path -LiteralPath $lnk) {
    $s = $shell.CreateShortcut($lnk)
    $s.TargetPath = $exe
    $s.Arguments = $launcherArg
    $s.WorkingDirectory = $Root
    $s.Save()
  }
}

$tasks = @(
  @('DaymarkGuard', 'powershell.exe', '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $tools 'guard-check.ps1') + '"'),
  @('DaymarkLocalSyncServer', 'wscript.exe', '//B //NoLogo "' + (Join-Path $tools 'start-server-hidden.vbs') + '"'),
  @('DaymarkProviderGuard', 'wscript.exe', '//B //NoLogo "' + (Join-Path $Root 'legacy\provider-config-guard.hidden.vbs') + '"'),
  @('DaymarkRelay', 'wscript.exe', '//B "' + (Join-Path $Root 'relay\relay-hidden.vbs') + '"'),
  @('DaymarkSyncWatchdog', 'wscript.exe', '//B //NoLogo "' + (Join-Path $Root 'legacy\daymark-sync-watchdog.vbs') + '"'),
  @('DaymarkZcodeBridge', 'wscript.exe', '//B "' + (Join-Path $Root 'legacy\daymark-zcode-bridge-hidden.vbs') + '"'),
  @('DaymarkSnap', 'powershell.exe', '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $Root 'legacy\snap.ps1') + '"')
)
foreach ($t in $tasks) {
  if (Get-ScheduledTask -TaskName $t[0] -ErrorAction SilentlyContinue) {
    Set-ScheduledTask -TaskName $t[0] -Action (New-ScheduledTaskAction -Execute $t[1] -Argument $t[2]) | Out-Null
  }
}

[Environment]::SetEnvironmentVariable('DAYMARK_USER_DATA_DIR', $userData, 'User')
& (Join-Path $env:SystemRoot 'System32\wscript.exe') //B //NoLogo (Join-Path $tools 'e.vbs')
