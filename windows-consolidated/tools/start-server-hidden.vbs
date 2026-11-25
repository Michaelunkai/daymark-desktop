Set shell = CreateObject("WScript.Shell")
Do
  shell.Run """C:\WINDOWS\System32\cmd.exe"" /c ""F:\backup\windowsapps\installed\daymark\tools\server.cmd""", 0, True
  WScript.Sleep 3000
Loop
