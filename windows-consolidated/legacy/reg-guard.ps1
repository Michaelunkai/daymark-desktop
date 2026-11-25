$a = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File F:\DaymarkAccess\guard-check.ps1'
$t1 = New-ScheduledTaskTrigger -AtLogOn
$t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
$s = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$p = New-ScheduledTaskPrincipal -UserId 'WIN-3J258HUL6HD\Admin' -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName 'DaymarkGuard' -Action $a -Trigger @($t1,$t2) -Settings $s -Principal $p -Force | Out-Null
Get-ScheduledTask -TaskName DaymarkGuard | Select-Object TaskName,State | Format-List
(Get-ScheduledTask -TaskName DaymarkGuard).Triggers | Select-Object CimClass,Repetition | Format-List
Start-ScheduledTask -TaskName DaymarkGuard
Start-Sleep 8
Get-ScheduledTaskInfo -TaskName DaymarkGuard | Select-Object LastRunTime,LastTaskResult | Format-List
Get-Content F:\DaymarkAccess\guard.log -Tail 3