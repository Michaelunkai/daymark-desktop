' Silent launcher for DaymarkZcodeBridge scheduled task (prevents console window)
CreateObject("WScript.Shell").Run """C:\Program Files\nodejs\node.exe"" ""F:\study\WebBuilding\projects\daymark-desktop\scripts\daymark-zcode-bridge.mjs""", 0, False
