Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "F:\study\WebBuilding\projects\daymark-desktop"
sh.Run """node.exe"" ""F:\study\WebBuilding\projects\daymark-desktop\scripts\provider-config-guard.mjs""", 0, False
