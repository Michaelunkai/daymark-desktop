' Supervised silent launcher for the DaymarkRelay scheduled task.
' Restarts the relay if it ever exits (crash or stall self-destruct) after a
' short backoff, so pause/resume enforcement survives without manual care.
Dim shell
Set shell = CreateObject("WScript.Shell")
Do
  shell.Run """C:\Program Files\nodejs\node.exe"" ""F:\study\Platforms\windows\automation\daymark-relay\relay.js""", 0, True
  WScript.Sleep 5000
Loop
