const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("DaymarkDesktop", {
  getReminderStatus: () => "desktop",
  syncReminders: (schedules) => ipcRenderer.send("daymark:reminders:replace", schedules),
  testReminderSound: (sound) => ipcRenderer.send("daymark:reminders:test-sound", sound),
});
