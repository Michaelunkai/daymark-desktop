const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("DaymarkDesktop", {
  getReminderStatus: () => "desktop-ready",
  getDesktopVersion: () => "1.4.44",
  getDesktopDiagnostics: () => ipcRenderer.invoke("daymark:desktop:diagnostics"),
  getCanonicalPairingKey: () => ipcRenderer.invoke("daymark:canonical-pairing-key"),
  onCanonicalPaired: (callback) => {
    const listener = (_event, syncKey) => callback(syncKey);
    ipcRenderer.on("daymark:canonical-paired", listener);
    return () => ipcRenderer.removeListener("daymark:canonical-paired", listener);
  },
  onAppReady: () => ipcRenderer.send("daymark:renderer-ready"),
  syncReminders: (schedules) => ipcRenderer.invoke("daymark:reminders:replace", schedules),
  testReminderSound: (sound) => ipcRenderer.send("daymark:reminders:test-sound", sound),
});
