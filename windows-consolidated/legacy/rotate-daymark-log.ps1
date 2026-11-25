# ralp fd95 P10b: Daymark local server holds server.log open via cmd '>>' (no copy-truncate possible), it reached 1.5 GB.
# Over the limit (default 100 MB): gzip-copy it, verify the gzip, then end only that server's node+cmd; its wscript supervisor restarts it
# 3 s later onto a fresh log. Keeps the 3 newest archives. Never touches anything else.
param([int64]$LimitMB = 100)
$dir = 'F:\backup\AI\daymark-local-server'
$log = Join-Path $dir 'server.log'
if (-not (Test-Path -LiteralPath $log)) { 'daymark log: none'; return }
$len = (Get-Item -LiteralPath $log).Length
if ($len -le $LimitMB * 1MB) { "daymark log: $([int]($len/1MB)) MB under limit"; return }
$gz = Join-Path $dir ("server.log." + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.gz')
$in = [IO.File]::Open($log, 'Open', 'Read', 'ReadWrite')
$out = [IO.File]::Create($gz)
$g = New-Object IO.Compression.GZipStream($out, [IO.Compression.CompressionLevel]::Fastest)
$in.CopyTo($g); $g.Close(); $out.Close(); $in.Close()
# verify gzip is readable end to end
$chk = [IO.File]::OpenRead($gz); $gs = New-Object IO.Compression.GZipStream($chk, [IO.Compression.CompressionMode]::Decompress)
$buf = New-Object byte[] 1MB; $n = 0; while (($r = $gs.Read($buf, 0, $buf.Length)) -gt 0) { $n += $r }; $gs.Close(); $chk.Close()
if ($n -lt $len * 0.99) { "daymark log: gzip verify FAILED ($n of $len) - log kept"; Remove-Item -LiteralPath $gz -Force; return }
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -match 'daymark-local-server\.mjs' -and $_.Name -match '^(node|cmd)\.exe$' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 400
$old = "$log.rotating"
try { Move-Item -LiteralPath $log -Destination $old -Force -ErrorAction Stop; Remove-Item -LiteralPath $old -Force } catch { "daymark log: rename failed: $($_.Exception.Message)" }
Get-ChildItem $dir -Filter 'server.log.*.gz' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 3 | Remove-Item -Force -ErrorAction SilentlyContinue
"daymark log: rotated $([int]($len/1MB)) MB -> $gz (verified $([int]($n/1MB)) MB)"
