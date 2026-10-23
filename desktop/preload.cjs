const { contextBridge, ipcRenderer } = require("electron");

// window.__daymarkUsage must return a synchronous snapshot (the renderer polls
// it on an interval without awaiting), while the real read happens over the
// asynchronous "daymark:usage" IPC channel. Bridge the gap with a last-known
// cache that a background refresh keeps at most 30s stale: null until the
// first round-trip resolves, then always the most recent snapshot.
const USAGE_REFRESH_INTERVAL_MS = 5_000;
let latestUsageSnapshot = null;
let usageRefreshInFlight = false;

function refreshUsageSnapshot() {
  if (usageRefreshInFlight) return;
  usageRefreshInFlight = true;
  ipcRenderer.invoke("daymark:usage")
    .then((snapshot) => {
      latestUsageSnapshot = snapshot ?? null;
    })
    .catch(() => {
      // Keep the last known snapshot; a transient IPC failure must not blank
      // the meters. It stays null if we never had a good value.
    })
    .finally(() => {
      usageRefreshInFlight = false;
    });
}

refreshUsageSnapshot();
setInterval(refreshUsageSnapshot, USAGE_REFRESH_INTERVAL_MS);

contextBridge.exposeInMainWorld("__daymarkUsage", () => {
  refreshUsageSnapshot();
  return latestUsageSnapshot;
});

// window.__daymarkUsageQuota is the PREFERRED meters contract (remaining % +
// reset times from the live quota API). Same sync-cache pattern as above; the
// underlying IPC read is an instant cache hit in main, refreshed there every
// 20s from the quota API, so a 3s bridge poll keeps the meters near-live.
const USAGE_QUOTA_REFRESH_INTERVAL_MS = 3_000;
let latestUsageQuotaSnapshot = null;
let usageQuotaRefreshInFlight = false;

function refreshUsageQuotaSnapshot() {
  if (usageQuotaRefreshInFlight) return;
  usageQuotaRefreshInFlight = true;
  ipcRenderer.invoke("daymark:usage-quota")
    .then((snapshot) => {
      latestUsageQuotaSnapshot = snapshot ?? null;
    })
    .catch(() => {
      // Keep the last known snapshot; a transient IPC failure must not blank
      // the meters.
    })
    .finally(() => {
      usageQuotaRefreshInFlight = false;
    });
}

refreshUsageQuotaSnapshot();
setInterval(refreshUsageQuotaSnapshot, USAGE_QUOTA_REFRESH_INTERVAL_MS);

contextBridge.exposeInMainWorld("__daymarkUsageQuota", () => {
  refreshUsageQuotaSnapshot();
  return latestUsageQuotaSnapshot;
});

contextBridge.exposeInMainWorld("DaymarkDesktop", {
  getReminderStatus: () => "desktop-ready",
  getDesktopVersion: () => "1.4.45",
  getUsageSnapshot: () => latestUsageSnapshot,
  getUsageQuota: () => ipcRenderer.invoke("daymark:usage-quota"),
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

// SLICE-DONE: data-engineer
