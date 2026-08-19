import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  session,
  shell,
  Tray,
} from "electron";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  notificationForSchedule,
  normalizeReminderSchedules,
  timerDelayForSchedule,
} from "./reminder-scheduler.mjs";

const PRODUCT_NAME = "Daymark";
const PRODUCTION_ORIGIN = "https://daymark-desktop.michaelovsky55555.chatgpt.site";
const START_URL = `${PRODUCTION_ORIGIN}/`;
const SESSION_PARTITION = "persist:daymark";
const APP_USER_MODEL_ID = "com.michaelunkai.daymark.windows";
const PACKAGED_LAUNCHER_NAME = "Daymark.exe";
const PACKAGED_RUNTIME_NAME = "Daymark Runtime.exe";
const SYNC_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconPath = path.join(__dirname, "assets", "daymark.ico");

let mainWindow = null;
let pendingDeepLink = null;
let reminderTray = null;
let isQuitting = false;
let launchHidden = process.argv.includes("--daymark-background");
const shouldExitOnWindowClose = process.argv.includes("--daymark-detached-child")
  || process.env.DAYMARK_VERIFY_EXIT === "1";
let scheduledReminders = [];
const reminderTimers = new Map();

app.setName(PRODUCT_NAME);
app.setAppUserModelId(APP_USER_MODEL_ID);

const userDataArgument = process.argv.find((value) => value.startsWith("--daymark-user-data-dir="));
const requestedUserDataPath = process.env.DAYMARK_USER_DATA_DIR
  ?? userDataArgument?.slice("--daymark-user-data-dir=".length);
if (requestedUserDataPath) {
  const userDataPath = requestedUserDataPath;
  if (path.isAbsolute(userDataPath)) app.setPath("userData", userDataPath);
}

if (process.defaultApp) {
  app.setAsDefaultProtocolClient("daymark", process.execPath, [path.resolve(process.argv[1])]);
} else {
  const executableName = path.basename(process.execPath);
  const protocolExecutable = executableName === PACKAGED_RUNTIME_NAME
    ? path.join(path.dirname(process.execPath), PACKAGED_LAUNCHER_NAME)
    : process.execPath;
  app.setAsDefaultProtocolClient("daymark", protocolExecutable);
}

const singleInstance = app.requestSingleInstanceLock();
if (!singleInstance) {
  app.quit();
}

function syncUrlFromDeepLink(value) {
  try {
    const url = new URL(value);
    const key = url.protocol === "daymark:" && url.hostname === "sync"
      ? url.pathname.replace(/^\/+/, "")
      : "";
    return SYNC_PATTERN.test(key) ? `${START_URL}?sync=${encodeURIComponent(key)}` : null;
  } catch {
    return null;
  }
}

function findDeepLink(argv) {
  return argv.map(syncUrlFromDeepLink).find(Boolean) ?? null;
}

function isTrustedNavigation(value) {
  try {
    return new URL(value).origin === PRODUCTION_ORIGIN;
  } catch {
    return false;
  }
}

function ensureWindowsShortcut() {
  if (process.platform !== "win32" || process.defaultApp) return;

  const applicationDirectory = path.dirname(process.execPath);
  const launcherPath = path.join(applicationDirectory, PACKAGED_LAUNCHER_NAME);
  const startMenuDirectory = path.join(
    process.env.APPDATA ?? app.getPath("appData"),
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
  );
  const shortcutPath = path.join(startMenuDirectory, "Daymark.lnk");
  const written = shell.writeShortcutLink(shortcutPath, "create", {
    target: launcherPath,
    cwd: applicationDirectory,
    description: "Daymark workspace",
    icon: launcherPath,
    iconIndex: 0,
    appUserModelId: APP_USER_MODEL_ID,
  });
  if (!written) console.error(`Daymark shortcut registration failed: ${shortcutPath}`);
}

async function pairCanonicalWorkspace() {
  const desktopSession = session.fromPartition(SESSION_PARTITION);
  const response = await desktopSession.fetch(`${PRODUCTION_ORIGIN}/api/sync/pair-canonical`, {
    method: "POST",
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Canonical pairing failed (${response.status}).`);
  const setCookies = response.headers.getSetCookie?.()
    ?? [response.headers.get("set-cookie")].filter(Boolean);
  const joinedCookies = setCookies.join(",");
  const syncKey = joinedCookies.match(/daymark\.sync-key=([^;,]+)/)?.[1] ?? "";
  if (!SYNC_PATTERN.test(syncKey)) throw new Error("Canonical pairing did not return a valid sync key.");
  const expirationDate = Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 365 * 10);
  await Promise.all([
    desktopSession.cookies.set({
      url: PRODUCTION_ORIGIN,
      name: "daymark.sync-key",
      value: syncKey,
      path: "/",
      secure: true,
      sameSite: "strict",
      expirationDate,
    }),
    desktopSession.cookies.set({
      url: PRODUCTION_ORIGIN,
      name: "daymark.canonical-workspace",
      value: "1",
      path: "/",
      secure: true,
      sameSite: "strict",
      expirationDate,
    }),
  ]);
  return `${START_URL}?sync=${encodeURIComponent(syncKey)}`;
}

function showMainWindow() {
  if (launchHidden) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
}

function revealMainWindow() {
  launchHidden = false;
  showMainWindow();
}

function reminderStorePath() {
  return path.join(app.getPath("userData"), "reminder-schedules.json");
}

function readReminderSchedules() {
  try {
    return normalizeReminderSchedules(JSON.parse(readFileSync(reminderStorePath(), "utf8")));
  } catch {
    return [];
  }
}

function persistReminderSchedules() {
  const destination = reminderStorePath();
  const temporary = `${destination}.tmp`;
  writeFileSync(temporary, JSON.stringify(scheduledReminders), "utf8");
  renameSync(temporary, destination);
}

function reminderSoundPath(sound) {
  const filename = `daymark_reminder_${sound === "alarm" ? "alarm" : sound === "alert" ? "alert" : "soft"}.wav`;
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", filename)
    : path.join(__dirname, "assets", filename);
}

function playReminderSound(sound) {
  if (process.platform !== "win32") return;
  const audioPath = reminderSoundPath(sound);
  if (!existsSync(audioPath)) return;
  const powershell = path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
  const player = spawn(
    powershell,
    [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-WindowStyle",
      "Hidden",
      "-Command",
      "$player = [System.Media.SoundPlayer]::new($args[0]); $player.PlaySync()",
      audioPath,
    ],
    { stdio: "ignore", windowsHide: true },
  );
  player.unref();
}

function deliverReminder(schedule) {
  const payload = notificationForSchedule(schedule);
  playReminderSound(schedule.sound);
  const notification = new Notification({
    ...payload,
    silent: false,
  });
  notification.on("click", revealMainWindow);
  notification.show();
}

function scheduleReminder(schedule) {
  const timer = setTimeout(() => {
    if (Date.now() + 500 < schedule.alertAt) {
      scheduleReminder(schedule);
      return;
    }
    reminderTimers.delete(schedule.id);
    deliverReminder(schedule);
  }, timerDelayForSchedule(schedule));
  reminderTimers.set(schedule.id, timer);
}

function rescheduleReminders() {
  for (const timer of reminderTimers.values()) clearTimeout(timer);
  reminderTimers.clear();
  for (const schedule of scheduledReminders) scheduleReminder(schedule);
}

function replaceReminderSchedules(rawSchedules) {
  try {
    const parsed = typeof rawSchedules === "string" ? JSON.parse(rawSchedules) : rawSchedules;
    scheduledReminders = normalizeReminderSchedules(parsed);
    persistReminderSchedules();
    rescheduleReminders();
  } catch {
    // Keep the last known valid native schedule if a renderer payload is malformed.
  }
}

function createReminderTray() {
  if (process.platform !== "win32" || reminderTray) return;
  reminderTray = new Tray(iconPath);
  reminderTray.setToolTip("Daymark reminders");
  reminderTray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Daymark", click: revealMainWindow },
    {
      label: "Quit Daymark",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  reminderTray.on("click", revealMainWindow);
}

function enableWindowsBackgroundReminders() {
  if (process.platform !== "win32" || process.defaultApp) return;
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: true,
    args: ["--daymark-background"],
  });
}

async function createWindow() {
  nativeTheme.themeSource = "dark";
  let launchUrl = pendingDeepLink ?? findDeepLink(process.argv);
  pendingDeepLink = null;
  if (!launchUrl) {
    try {
      launchUrl = await pairCanonicalWorkspace();
    } catch {
      // Existing persistent pairing remains usable while the service is offline.
    }
  }

  mainWindow = new BrowserWindow({
    title: PRODUCT_NAME,
    width: 1440,
    height: 960,
    minWidth: 640,
    minHeight: 400,
    backgroundColor: "#000000",
    autoHideMenuBar: true,
    show: false,
    icon: iconPath,
    webPreferences: {
      partition: SESSION_PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      spellcheck: true,
      devTools: false,
    },
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isTrustedNavigation(url)) {
      void mainWindow.loadURL(url);
    } else {
      void shell.openExternal(url);
    }
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedNavigation(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });

  mainWindow.webContents.on("will-attach-webview", (event) => event.preventDefault());
  mainWindow.webContents.on("render-process-gone", () => {
    if (!mainWindow?.isDestroyed()) void mainWindow.reload();
  });
  mainWindow.webContents.on("did-fail-load", (_event, errorCode, _description, url, isMainFrame) => {
    if (isMainFrame && errorCode !== -3 && isTrustedNavigation(url)) {
      setTimeout(() => {
        if (!mainWindow?.isDestroyed()) void mainWindow.loadURL(url);
      }, 1000);
    }
  });

  mainWindow.webContents.once("did-finish-load", showMainWindow);
  mainWindow.once("ready-to-show", showMainWindow);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("close", (event) => {
    if (isQuitting || shouldExitOnWindowClose || process.platform !== "win32") return;
    event.preventDefault();
    mainWindow.hide();
  });

  void mainWindow.loadURL(launchUrl ?? START_URL);
}

app.on("second-instance", (_event, argv) => {
  const deepLink = findDeepLink(argv);
  if (deepLink && mainWindow && !mainWindow.isDestroyed()) {
    void mainWindow.loadURL(deepLink);
  } else if (deepLink) {
    pendingDeepLink = deepLink;
  }
  if (mainWindow?.isMinimized()) mainWindow.restore();
  revealMainWindow();
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  const deepLink = syncUrlFromDeepLink(url);
  if (!deepLink) return;
  if (mainWindow && !mainWindow.isDestroyed()) void mainWindow.loadURL(deepLink);
  else pendingDeepLink = deepLink;
});

app.whenReady().then(() => {
  scheduledReminders = readReminderSchedules();
  rescheduleReminders();
  ipcMain.on("daymark:reminders:replace", (_event, schedules) => {
    replaceReminderSchedules(schedules);
  });
  ipcMain.on("daymark:reminders:test-sound", (_event, sound) => {
    playReminderSound(sound);
  });
  enableWindowsBackgroundReminders();
  createReminderTray();
  ensureWindowsShortcut();
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  isQuitting = true;
  for (const timer of reminderTimers.values()) clearTimeout(timer);
  reminderTimers.clear();
  reminderTray?.destroy();
  reminderTray = null;
});
