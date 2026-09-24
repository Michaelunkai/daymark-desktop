@echo off
setlocal
set "ELECTRON_RUN_AS_NODE=1"
"%~dp0Daymark Runtime.exe" "%~dp0resources\app.asar\cli\daymark.mjs" %*
exit /b %ERRORLEVEL%
