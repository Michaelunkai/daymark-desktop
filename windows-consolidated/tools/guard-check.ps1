$ErrorActionPreference = 'SilentlyContinue'
$root = 'F:\backup\windowsapps\installed\daymark'
$log = Join-Path $root 'logs\guard.log'
function L($m) { Add-Content -Path $log -Value ((Get-Date -Format 's') + ' ' + $m) }
$listen = Get-NetTCPConnection -LocalPort 18780 -State Listen
$ok = $false
if ($listen) {
  try { $r = Invoke-RestMethod -Uri 'http://127.0.0.1:18780/api/agent/v1/health' -TimeoutSec 8; if ($r.status -eq 'ok') { $ok = $true } } catch {}
}
if ($ok) { L 'healthy'; exit 0 }
if ($listen) { L 'port busy but unhealthy, not spawning'; exit 0 }
L 'no listener, starting hidden server'
$supervisor = Join-Path $root 'tools\start-server-hidden.vbs'
$p = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\wscript.exe') -ArgumentList '//B','//NoLogo',('"' + $supervisor + '"') -WindowStyle Hidden -PassThru
L ('start pid=' + $p.Id)
