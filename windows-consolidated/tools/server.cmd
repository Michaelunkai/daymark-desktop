@echo off
setlocal
set DAYMARK_LOCAL_DATA=F:\backup\windowsapps\installed\daymark\data
set DAYMARK_CLAUDE_LIVE=F:\backup\windowsapps\installed\daymark\bridges\claude\live.json
set DAYMARK_CLIENT_DIR=F:\backup\windowsapps\installed\daymark\dist\client
set DAYMARK_NO_CHILDREN=1
"C:\Program Files\nodejs\node.exe" "F:\backup\windowsapps\installed\daymark\tools\daymark-local-server.mjs" >> "F:\backup\windowsapps\installed\daymark\logs\server.log" 2>&1
