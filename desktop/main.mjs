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
import {
  copyFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  MISSED_ALERT_SPACING_MS,
  normalizeDeliveredReminderIds,
  notificationForSchedule,
  OVERDUE_CATCH_UP_WINDOW_MS,
  normalizeReminderSchedules,
  timerDelayForSchedule,
} from "./reminder-scheduler.mjs";

const PRODUCT_NAME = "Daymark";
const DESKTOP_RELEASE_VERSION = "1.4.44";
const PRODUCTION_ORIGIN = "https://daymark-desktop.michaelovsky55555.chatgpt.site";
const START_URL = `${PRODUCTION_ORIGIN}/`;
const SESSION_PARTITION = "persist:daymark";
const APP_USER_MODEL_ID = "com.michaelunkai.daymark.windows";
const PACKAGED_LAUNCHER_NAME = "Daymark.exe";
const PACKAGED_RUNTIME_NAME = "Daymark Runtime.exe";
const SYNC_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const PAIRING_TIMEOUT_MS = 15_000;
const PACKAGED_CLIENT_DIRECTORY = path.join("dist", "client");
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const iconPath = path.join(__dirname, "assets", "daymark.ico");

let mainWindow = null;
let pendingDeepLink = null;
let lastCanonicalPairingKey = null;
let reminderTray = null;
let isQuitting = false;
let launchHidden = process.argv.includes("--daymark-background");
let rendererNavigationStarted = false;
let rendererNavigationTrusted = false;
let windowVisibleTraced = false;
const shouldExitOnWindowClose = process.env.DAYMARK_VERIFY_EXIT === "1";
const startupTraceEnabled = process.env.DAYMARK_STARTUP_TRACE === "1"
  || process.env.DAYMARK_ACCEPTANCE_EVENTS === "1"
  || process.env.DAYMARK_VERIFY_EXIT === "1";
const startupStartedAt = Date.now();
const startupEvents = [];
let scheduledReminders = [];
let deliveredReminderIds = new Set();
let reminderPersistenceFailure = null;
let lastReminderPersistenceAck = null;
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

function recordAcceptanceEvent(name, details = {}) {
  const event = {
    name,
    version: DESKTOP_RELEASE_VERSION,
    at: new Date().toISOString(),
    ...details,
  };
  startupEvents.push(event);
  if (startupEvents.length > 100) startupEvents.shift();
  console.log(`DAYMARK_ACCEPTANCE_EVENT ${JSON.stringify(event)}`);
  return event;
}

function traceStartup(name, details = {}) {
  if (!startupTraceEnabled) return;
  const event = recordAcceptanceEvent(`startup:${name}`, {
    elapsedMs: Date.now() - startupStartedAt,
    ...details,
  });
  console.log(`DAYMARK_STARTUP_TRACE ${JSON.stringify(event)}`);
}

function persistenceErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function reportPersistenceFailure(kind, error) {
  const message = persistenceErrorMessage(error);
  const signature = `${kind}:${message}`;
  if (reminderPersistenceFailure === signature) return;
  reminderPersistenceFailure = signature;
  recordAcceptanceEvent("reminders:persistence-failed", { kind, message });
}

function persistJsonAtomically(destination, value, kind) {
  const temporary = `${destination}.tmp`;
  try {
    if (existsSync(destination)) {
      try {
        copyFileSync(destination, `${destination}.bak`);
      } catch {
        // The current file is still authoritative if backup rotation fails.
      }
    }
    writeFileSync(temporary, JSON.stringify(value), "utf8");
    renameSync(temporary, destination);
    reminderPersistenceFailure = null;
    return true;
  } catch (error) {
    reportPersistenceFailure(kind, error);
    return false;
  }
}

function readJsonWithSalvage(destination, fallback) {
  const candidates = [destination, `${destination}.tmp`, `${destination}.bak`]
    .filter((candidate) => existsSync(candidate))
    .sort((left, right) => {
      try {
        return statSync(right).mtimeMs - statSync(left).mtimeMs;
      } catch {
        return 0;
      }
    });

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(readFileSync(candidate, "utf8"));
      if (candidate !== destination) {
        recordAcceptanceEvent("reminders:store-salvaged", {
          destination,
          source: candidate,
        });
      }
      return value;
    } catch {
      // Try the next durable or interrupted-write copy.
    }
  }
  return fallback;
}

function withTimeout(promise, timeoutMs, message) {
  let timeoutHandle;
  const timeout = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => reject(new Error(message)), timeoutMs);
    timeoutHandle.unref?.();
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timeoutHandle));
}

function desktopSession() {
  return session.fromPartition(SESSION_PARTITION);
}

function contentTypeForClientFile(filePath) {
  const contentTypes = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  };
  return contentTypes[path.extname(filePath).toLowerCase()]
    ?? "application/octet-stream";
}

function packagedClientFileForUrl(requestUrl, clientDirectory) {
  if (requestUrl.origin !== PRODUCTION_ORIGIN || requestUrl.pathname.startsWith("/api/")) {
    return null;
  }

  let relativePath;
  try {
    relativePath = decodeURIComponent(requestUrl.pathname)
      .replace(/^\/+/, "")
      .replace(/\\/g, "/");
  } catch {
    return null;
  }

  if (
    relativePath.includes("\0")
    || relativePath.split("/").includes("..")
  ) {
    return null;
  }

  const requestedPath = path.resolve(
    clientDirectory,
    relativePath || "index.html",
  );
  const relativeRequestedPath = path.relative(clientDirectory, requestedPath);
  const isWithinClientDirectory = relativeRequestedPath === ""
    || (
      !relativeRequestedPath.startsWith("..")
      && !path.isAbsolute(relativeRequestedPath)
    );
  if (!isWithinClientDirectory) return null;

  if (existsSync(requestedPath)) {
    try {
      if (statSync(requestedPath).isFile()) return requestedPath;
    } catch {
      return null;
    }
  }

  if (!path.extname(relativePath)) {
    const indexPath = path.join(clientDirectory, "index.html");
    if (existsSync(indexPath)) return indexPath;
  }
  return null;
}

function installPackagedClientProtocol() {
  const desktopPartition = desktopSession();
  if (!app.isPackaged) return desktopPartition;

  const clientDirectory = path.join(app.getAppPath(), PACKAGED_CLIENT_DIRECTORY);
  const indexPath = path.join(clientDirectory, "index.html");
  if (!existsSync(indexPath)) {
    throw new Error(`Packaged Daymark client is missing: ${indexPath}`);
  }

  desktopPartition.protocol.handle("https", async (request) => {
    let requestUrl;
    try {
      requestUrl = new URL(request.url);
    } catch {
      return desktopPartition.fetch(request, {
        bypassCustomProtocolHandlers: true,
      });
    }

    const isStaticRequest = request.method === "GET" || request.method === "HEAD";
    const clientFile = isStaticRequest
      ? packagedClientFileForUrl(requestUrl, clientDirectory)
      : null;
    if (!clientFile) {
      return desktopPartition.fetch(request, {
        bypassCustomProtocolHandlers: true,
      });
    }

    try {
      const body = request.method === "HEAD" ? null : readFileSync(clientFile);
      const cacheControl = path.basename(clientFile) === "index.html"
        ? "no-store"
        : "public, max-age=31536000, immutable";
      return new Response(body, {
        headers: {
          "Cache-Control": cacheControl,
          "Content-Type": contentTypeForClientFile(clientFile),
        },
      });
    } catch (error) {
      recordAcceptanceEvent("startup:packaged-client-read-failed", {
        path: clientFile,
        message: persistenceErrorMessage(error),
      });
      return new Response("Daymark client asset unavailable.", {
        status: 500,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  });
  traceStartup("packaged-client-intercepted", {
    clientDirectory,
    origin: PRODUCTION_ORIGIN,
  });
  return desktopPartition;
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
  const desktopPartition = desktopSession();
  const response = await withTimeout(
    desktopPartition.fetch(`${PRODUCTION_ORIGIN}/api/sync/pair-canonical`, {
      method: "POST",
      headers: { Accept: "application/json" },
      cache: "no-store",
      bypassCustomProtocolHandlers: true,
    }),
    PAIRING_TIMEOUT_MS,
    `Canonical pairing timed out after ${PAIRING_TIMEOUT_MS}ms.`,
  );
  if (!response.ok) throw new Error(`Canonical pairing failed (${response.status}).`);
  const structuredSetCookies = response.headers.getSetCookie?.() ?? [];
  const combinedSetCookie = response.headers.get("set-cookie");
  const joinedCookies = [
    ...structuredSetCookies,
    combinedSetCookie,
  ].filter(Boolean).join(",");
  const syncKey = joinedCookies.match(/daymark\.sync-key=([^;,]+)/)?.[1] ?? "";
  if (!SYNC_PATTERN.test(syncKey)) throw new Error("Canonical pairing did not return a valid sync key.");
  const expirationDate = Math.floor(Date.now() / 1000) + (60 * 60 * 24 * 365 * 10);
  await Promise.all([
    desktopPartition.cookies.set({
      url: PRODUCTION_ORIGIN,
      name: "daymark.sync-key",
      value: syncKey,
      path: "/",
      secure: true,
      sameSite: "strict",
      expirationDate,
    }),
    desktopPartition.cookies.set({
      url: PRODUCTION_ORIGIN,
      name: "daymark.canonical-workspace",
      value: "1",
      path: "/",
      secure: true,
      sameSite: "strict",
      expirationDate,
    }),
  ]);
  lastCanonicalPairingKey = syncKey;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("daymark:canonical-paired", syncKey);
  }
  recordAcceptanceEvent("sync:canonical-paired", { paired: true });
  return `${START_URL}?sync=${encodeURIComponent(syncKey)}`;
}

async function hasCanonicalPairing() {
  try {
    const cookies = await desktopSession().cookies.get({
      url: PRODUCTION_ORIGIN,
    });
    return cookies.some((cookie) => (
      cookie.name === "daymark.canonical-workspace"
      && cookie.value === "1"
    )) && cookies.some((cookie) => (
      cookie.name === "daymark.sync-key"
      && SYNC_PATTERN.test(cookie.value)
    ));
  } catch {
    return false;
  }
}

async function resolveLaunchUrl() {
  const deepLink = pendingDeepLink ?? findDeepLink(process.argv);
  pendingDeepLink = null;
  if (deepLink) return deepLink;

  if (await hasCanonicalPairing()) {
    recordAcceptanceEvent("sync:canonical-pairing-reused", { paired: true });
    return START_URL;
  }

  recordAcceptanceEvent("sync:canonical-pairing-deferred", { paired: false });
  void pairCanonicalWorkspace().catch((error) => {
    recordAcceptanceEvent("sync:canonical-pairing-required", {
      message: persistenceErrorMessage(error),
    });
  });
  return START_URL;
}

function loadPairingFailurePage(error) {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const message = persistenceErrorMessage(error).replace(/[<>&"]/g, "");
  rendererNavigationStarted = true;
  rendererNavigationTrusted = false;
  void mainWindow.loadURL(
    `data:text/html,<meta charset="utf-8"><title>Daymark pairing required</title><body style="background:%23000;color:%23fff;font:16px sans-serif;padding:32px"><h1>Daymark pairing required</h1><p>${encodeURIComponent(message)}</p></body>`,
  );
}

function showMainWindow() {
  if (launchHidden) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.show();
  mainWindow.focus();
  if (rendererNavigationTrusted && !windowVisibleTraced) {
    windowVisibleTraced = true;
    traceStartup("window-visible");
  }
}

function revealMainWindow() {
  launchHidden = false;
  showMainWindow();
}

function reminderStorePath() {
  return path.join(app.getPath("userData"), "reminder-schedules.json");
}

function reminderDeliveredPath() {
  return path.join(app.getPath("userData"), "reminder-delivered.json");
}

function filterDeliveredSchedules(schedules) {
  return schedules.filter((schedule) => !deliveredReminderIds.has(schedule.id));
}

function readDeliveredReminderIds() {
  return new Set(normalizeDeliveredReminderIds(
    readJsonWithSalvage(reminderDeliveredPath(), []),
  ));
}

function readReminderSchedules() {
  const raw = readJsonWithSalvage(reminderStorePath(), []);
  try {
    return filterDeliveredSchedules(normalizeReminderSchedules(
      raw,
      Date.now(),
      { includePast: true },
    ));
  } catch {
    recordAcceptanceEvent("reminders:store-invalid", { path: reminderStorePath() });
    return [];
  }
}

function persistReminderSchedules(schedules = scheduledReminders) {
  return persistJsonAtomically(reminderStorePath(), schedules, "schedules");
}

function reminderSoundPath(sound) {
  const filename = `daymark_reminder_${sound === "alarm" ? "alarm" : sound === "alert" ? "alert" : "soft"}.wav`;
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", filename)
    : path.join(__dirname, "assets", filename);
}

function windowsPowerShellPath() {
  return path.join(
    process.env.SystemRoot ?? "C:\\Windows",
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

function playWindowsFallbackSound() {
  recordAcceptanceEvent("reminders:sound-fallback", { sound: "system" });
  try {
    const fallback = spawn(
      windowsPowerShellPath(),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        "[System.Media.SystemSounds]::Exclamation.Play()",
      ],
      { stdio: "ignore", windowsHide: true },
    );
    fallback.unref();
    return true;
  } catch (error) {
    recordAcceptanceEvent("reminders:sound-fallback-failed", {
      message: persistenceErrorMessage(error),
    });
    return false;
  }
}

function playReminderSound(sound) {
  if (process.platform !== "win32") {
    recordAcceptanceEvent("reminders:sound-skipped", { reason: "non-windows" });
    return false;
  }
  const audioPath = reminderSoundPath(sound);
  if (!existsSync(audioPath)) {
    recordAcceptanceEvent("reminders:sound-custom-missing", { sound, audioPath });
    return playWindowsFallbackSound();
  }

  let fallbackStarted = false;
  const startFallback = (reason) => {
    if (fallbackStarted) return;
    fallbackStarted = true;
    recordAcceptanceEvent("reminders:sound-custom-failed", { sound, reason });
    playWindowsFallbackSound();
  };

  try {
    recordAcceptanceEvent("reminders:sound-custom-start", { sound, audioPath });
    const player = spawn(
      windowsPowerShellPath(),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        "-Command",
        "try { $player = [System.Media.SoundPlayer]::new($args[0]); $player.PlaySync(); exit 0 } catch { exit 1 }",
        audioPath,
      ],
      { stdio: "ignore", windowsHide: true },
    );
    player.once("error", (error) => startFallback(persistenceErrorMessage(error)));
    player.once("close", (code) => {
      if (code === 0) {
        recordAcceptanceEvent("reminders:sound-custom-complete", { sound });
      } else {
        startFallback(`exit:${code}`);
      }
    });
    player.unref();
    return true;
  } catch (error) {
    startFallback(persistenceErrorMessage(error));
    return false;
  }
}

function deliverReminder(schedule) {
  if (deliveredReminderIds.has(schedule.id)) {
    return { ok: true, alreadyDelivered: true, persisted: true };
  }
  const payload = notificationForSchedule(schedule);
  try {
    const notification = new Notification({
      ...payload,
      silent: true,
    });
    notification.on("click", revealMainWindow);
    notification.show();
  } catch (error) {
    recordAcceptanceEvent("reminders:notification-failed", {
      id: schedule.id,
      message: persistenceErrorMessage(error),
    });
    return { ok: false, retry: true, reason: "notification-show-failed" };
  }

  playReminderSound(schedule.sound);

  const nextDeliveredIds = new Set(deliveredReminderIds);
  nextDeliveredIds.add(schedule.id);
  const persisted = persistJsonAtomically(
    reminderDeliveredPath(),
    [...nextDeliveredIds],
    "delivered-ledger",
  );
  deliveredReminderIds = nextDeliveredIds;
  completeReminder(schedule);
  if (!persisted) {
    recordAcceptanceEvent("reminders:delivery-persistence-failed", {
      id: schedule.id,
      reason: "delivered-ledger-persistence-failed-after-show",
    });
  }
  recordAcceptanceEvent("reminders:delivered", {
    id: schedule.id,
    persisted,
  });
  return { ok: true, delivered: true, persisted };
}

function completeReminder(schedule) {
  const nextSchedules = scheduledReminders.filter((candidate) => candidate.id !== schedule.id);
  const persisted = persistReminderSchedules(nextSchedules);
  scheduledReminders = nextSchedules;
  if (!persisted) {
    recordAcceptanceEvent("reminders:schedule-removal-deferred", { id: schedule.id });
  }
  return persisted;
}

function scheduleReminder(schedule, delayOverride = null) {
  const timer = setTimeout(() => {
    if (delayOverride === null && Date.now() + 500 < schedule.alertAt) {
      scheduleReminder(schedule);
      return;
    }
    reminderTimers.delete(schedule.id);
    const delivery = deliverReminder(schedule);
    if (!delivery.ok && delivery.retry) {
      scheduleReminder(schedule, MISSED_ALERT_SPACING_MS);
    }
  }, delayOverride ?? timerDelayForSchedule(schedule));
  reminderTimers.set(schedule.id, timer);
}

function rescheduleReminders() {
  for (const timer of reminderTimers.values()) clearTimeout(timer);
  reminderTimers.clear();
  const now = Date.now();
  let missedIndex = 0;
  for (const schedule of filterDeliveredSchedules(scheduledReminders)) {
    scheduleReminder(
      schedule,
      schedule.alertAt <= now ? 250 + missedIndex++ * MISSED_ALERT_SPACING_MS : null,
    );
  }
}

function replaceReminderSchedules(rawSchedules) {
  try {
    const parsed = typeof rawSchedules === "string" ? JSON.parse(rawSchedules) : rawSchedules;
    const now = Date.now();
    const missed = filterDeliveredSchedules(
      scheduledReminders.filter((schedule) => schedule.alertAt <= now),
    );
    const incoming = normalizeReminderSchedules(parsed, now, { includePast: true });
    const incomingIds = new Set(incoming.map((schedule) => schedule.id));
    const nextSchedules = filterDeliveredSchedules(normalizeReminderSchedules(
      [...missed.filter((schedule) => !incomingIds.has(schedule.id)), ...incoming],
      now,
      { includePast: true },
    ));
    if (!persistReminderSchedules(nextSchedules)) {
      const acknowledgement = {
        ok: false,
        persisted: false,
        error: "Reminder schedule persistence failed.",
      };
      lastReminderPersistenceAck = acknowledgement;
      return acknowledgement;
    }
    scheduledReminders = nextSchedules;
    rescheduleReminders();
    recordAcceptanceEvent("reminders:replaced", { count: scheduledReminders.length });
    const acknowledgement = {
      ok: true,
      persisted: true,
      count: scheduledReminders.length,
      path: reminderStorePath(),
    };
    lastReminderPersistenceAck = acknowledgement;
    recordAcceptanceEvent("reminders:persisted", {
      count: acknowledgement.count,
      path: acknowledgement.path,
    });
    return acknowledgement;
  } catch (error) {
    // Keep the last known valid native schedule if a renderer payload is malformed.
    const acknowledgement = {
      ok: false,
      persisted: false,
      error: persistenceErrorMessage(error),
    };
    lastReminderPersistenceAck = acknowledgement;
    recordAcceptanceEvent("reminders:replace-rejected", {
      message: acknowledgement.error,
    });
    return acknowledgement;
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
  traceStartup("window-create-start");
  rendererNavigationStarted = false;
  rendererNavigationTrusted = false;
  windowVisibleTraced = false;

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

  const revealFailureWindow = () => {
    if (rendererNavigationStarted && !rendererNavigationTrusted) showMainWindow();
  };
  mainWindow.webContents.once("did-finish-load", revealFailureWindow);
  mainWindow.once("ready-to-show", revealFailureWindow);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.on("close", (event) => {
    if (!shouldKeepRunningInTray()) return;
    event.preventDefault();
    mainWindow.hide();
    recordAcceptanceEvent("tray:window-hidden");
  });

  traceStartup("window-created");
  let launchUrl;
  try {
    launchUrl = await resolveLaunchUrl();
  } catch (error) {
    traceStartup("pairing-blocked", { message: persistenceErrorMessage(error) });
    loadPairingFailurePage(error);
    return;
  }

  traceStartup("renderer-load-start", { launchUrl });
  rendererNavigationStarted = true;
  rendererNavigationTrusted = true;
  void mainWindow.loadURL(launchUrl).then(
    () => traceStartup("renderer-load-complete", { launchUrl }),
    (error) => traceStartup("renderer-load-failed", {
      message: persistenceErrorMessage(error),
    }),
  );
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
  traceStartup("app-ready");
  installPackagedClientProtocol();
  deliveredReminderIds = readDeliveredReminderIds();
  if (!existsSync(reminderDeliveredPath())) {
    persistJsonAtomically(reminderDeliveredPath(), [], "delivered-ledger");
  }
  scheduledReminders = readReminderSchedules();
  rescheduleReminders();
  ipcMain.handle("daymark:reminders:replace", (_event, schedules) => (
    replaceReminderSchedules(schedules)
  ));
  ipcMain.on("daymark:reminders:test-sound", (_event, sound) => {
    playReminderSound(sound);
  });
  ipcMain.handle("daymark:desktop:diagnostics", () => ({
    version: DESKTOP_RELEASE_VERSION,
    scheduledReminderCount: scheduledReminders.length,
    deliveredReminderCount: deliveredReminderIds.size,
    deliveredReminderIds: [...deliveredReminderIds],
    reminderStorePath: reminderStorePath(),
    reminderDeliveredPath: reminderDeliveredPath(),
    overdueCatchUpWindowMs: OVERDUE_CATCH_UP_WINDOW_MS,
    lastReminderPersistenceAck,
    startupEvents: startupEvents.slice(),
  }));
  ipcMain.handle("daymark:canonical-pairing-key", () => lastCanonicalPairingKey);
  ipcMain.on("daymark:renderer-ready", (event) => {
    if (
      !mainWindow
      || mainWindow.isDestroyed()
      || event.sender !== mainWindow.webContents
      || !rendererNavigationTrusted
    ) {
      return;
    }
    showMainWindow();
    traceStartup("renderer-ready-visible");
  });
  enableWindowsBackgroundReminders();
  createReminderTray();
  ensureWindowsShortcut();
  traceStartup("window-create-dispatched");
  void createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow();
  });
});

app.on("window-all-closed", () => {
  if (shouldKeepRunningInTray()) return;
  if (process.platform !== "darwin") app.quit();
});

function shouldKeepRunningInTray() {
  return process.platform === "win32"
    && app.isPackaged
    && !isQuitting
    && !shouldExitOnWindowClose;
}

app.on("before-quit", () => {
  isQuitting = true;
  for (const timer of reminderTimers.values()) clearTimeout(timer);
  reminderTimers.clear();
  reminderTray?.destroy();
  reminderTray = null;
});
