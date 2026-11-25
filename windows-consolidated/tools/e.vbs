Set wmi = GetObject("winmgmts:\\.\root\cimv2")
Set q = wmi.ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name='wscript.exe' AND CommandLine LIKE '%start-server-hidden.vbs%'")
If q.Count = 0 Then
  CreateObject("WScript.Shell").Run "wscript.exe //B //NoLogo ""F:\backup\windowsapps\installed\daymark\tools\start-server-hidden.vbs""", 0, False
End If
