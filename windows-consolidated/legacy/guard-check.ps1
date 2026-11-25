$ErrorActionPreference = 'SilentlyContinue'
$log = 'F:\DaymarkAccess\guard.log'
if ((Test-Path $log) -and ((Get-Item $log).Length -gt 5MB)) { Move-Item $log ($log + '.old') -Force }
function L($m) { Add-Content -Path $log -Value ((Get-Date -Format 's') + ' ' + $m) }
$listen = Get-NetTCPConnection -LocalPort 18780 -State Listen
$ok = $false
if ($listen) {
  try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:18780/api/agent/v1/health' -TimeoutSec 8; if ($r.status -eq 'ok') { $ok = $true } } catch {}
  }
  if ($ok) { L 'healthy'; exit 0 }
  if ($listen) { L 'port busy but unhealthy, not spawning'; exit 0 }
  L 'no listener, starting server'
  $res = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = 'cmd.exe /c F:\DaymarkAccess\start-daymark-server.cmd' }
  L ('start rc=' + $res.ReturnValue + ' pid=' + $res.ProcessId)