import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeTheme,
  Notification,
  powerMonitor,
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
import { createDecipheriv, createHash } from "node:crypto";
import os from "node:os";
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
const DESKTOP_RELEASE_VERSION = "1.4.45";
// Origin override: when DAYMARK_ORIGIN is set (persistently, via the hidden
// launcher), the app talks to that server instead of the cloud host. This keeps
// sync alive with zero user action when the cloud platform degrades, and needs
// no Codex / ChatGPT account — ever.
const PRODUCTION_ORIGIN = process.env.DAYMARK_ORIGIN
  ?? "https://daymark-desktop.michaelovsky55555.chatgpt.site";
const START_URL = `${PRODUCTION_ORIGIN}/`;
const SESSION_PARTITION = "persist:daymark";
const APP_USER_MODEL_ID = "com.michaelunkai.daymark.windows";
const PACKAGED_LAUNCHER_NAME = "Daymark.exe";
const PACKAGED_RUNTIME_NAME = "Daymark Runtime.exe";
const SYNC_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const PAIRING_TIMEOUT_MS = 15_000;
const PACKAGED_CLIENT_DIRECTORY = path.join("dist", "client");
// Re-validate reminder timers on this cadence so system sleep, timer drift, or a
// lost timeout can never silently skip a reminder.
const REMINDER_SWEEP_INTERVAL_MS = 60_000;
const ALARM_SOUND_REPEATS = 5;
// ZCode CLI keeps per-request token accounting in this local SQLite database
// (table `model_usage`: completed_at epoch-ms, computed_total_tokens). Read
// strictly read-only; usage never leaves this machine.
const ZCODE_USAGE_DB_PATH = process.env.DAYMARK_USAGE_DB_PATH
  ?? path.join(process.env.USERPROFILE ?? process.env.HOME ?? ".", ".zcode", "cli", "db", "db.sqlite");
// Trailing windows the usage meters show. 7d is bounded by whatever history
// the local database happens to retain (currently ~1 day) - the sum is still
// correct, it just cannot include usage older than the retained rows.
const USAGE_FIVE_HOUR_WINDOW_MS = 5 * 60 * 60 * 1000;
const USAGE_SEVEN_DAY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// Re-read the (live, WAL-backed) database at most this often per process.
const USAGE_CACHE_TTL_MS = 3_000;
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
let activeReminderSoundPlayer = null;

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

// Always-visible diagnostics for the reminder timer lifecycle: every arm and
// every fire is printed to the console (and mirrored to the acceptance event
// log) so a silently dropped alarm is diagnosable after the fact.
function logReminderEvent(name, details = {}) {
  console.log(`DAYMARK_REMINDER_LOG ${JSON.stringify({
    name,
    at: new Date().toISOString(),
    ...details,
  })}`);
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
  persistCanonicalPairingKey(syncKey);
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
    // Cache-bust per launch: index.html must refetch after every asar redeploy.
    return `${START_URL}?launch=${Date.now().toString(36)}`;
  }

  recordAcceptanceEvent("sync:canonical-pairing-deferred", { paired: false });
  void pairCanonicalWorkspace().catch((error) => {
    recordAcceptanceEvent("sync:canonical-pairing-required", {
      message: persistenceErrorMessage(error),
    });
  });
  return `${START_URL}?launch=${Date.now().toString(36)}`;
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
  logReminderEvent("sound-fallback", { sound: "system" });
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
        // Console::Beep uses the speaker directly and is audible even when the
        // Windows sound scheme mutes SystemSounds, so the fallback can never
        // be silent.
        "try { for ($i = 0; $i -lt 3; $i++) { [console]::beep(880, 450); Start-Sleep -Milliseconds 200 }; [System.Media.SystemSounds]::Exclamation.Play(); exit 0 } catch { exit 1 }",
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

function stopReminderSound() {
  const player = activeReminderSoundPlayer;
  activeReminderSoundPlayer = null;
  if (player && player.exitCode === null && !player.killed) {
    try {
      player.kill();
    } catch {
      // Process already exited; nothing left to stop.
    }
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
    if (activeReminderSoundPlayer === player) activeReminderSoundPlayer = null;
    recordAcceptanceEvent("reminders:sound-custom-failed", { sound, reason });
    playWindowsFallbackSound();
  };

  // The alarm tone repeats until dismissed or until its repeat budget runs out.
  const repeats = sound === "alarm" ? ALARM_SOUND_REPEATS : 1;

  try {
    recordAcceptanceEvent("reminders:sound-custom-start", { sound, audioPath, repeats });
    const player = spawn(
      windowsPowerShellPath(),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-WindowStyle",
        "Hidden",
        // powershell.exe -Command does NOT bind trailing arguments to the
        // automatic argument array, so the previous form handed SoundPlayer a
        // null path and PlaySync silently played nothing while still exiting 0.
        // Invoking a scriptblock with param() binds the trailing arguments
        // correctly, and Test-Path turns a missing wav into exit 1 so the loud
        // fallback runs.
        "-Command",
        "& { param($path, $count) if (-not (Test-Path -LiteralPath $path)) { exit 1 }; try { $player = [System.Media.SoundPlayer]::new($path); for ($i = 0; $i -lt [int]$count; $i++) { $player.PlaySync() }; exit 0 } catch { exit 1 } }",
        audioPath,
        String(repeats),
      ],
      { stdio: "ignore", windowsHide: true },
    );
    player.once("error", (error) => startFallback(persistenceErrorMessage(error)));
    player.once("close", (code) => {
      if (activeReminderSoundPlayer === player) activeReminderSoundPlayer = null;
      if (code === 0) {
        recordAcceptanceEvent("reminders:sound-custom-complete", { sound });
      } else {
        startFallback(`exit:${code}`);
      }
    });
    player.unref();
    activeReminderSoundPlayer = player;
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
    notification.on("click", () => {
      stopReminderSound();
      revealMainWindow();
    });
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
  const delay = delayOverride ?? timerDelayForSchedule(schedule);
  logReminderEvent("timer-armed", {
    id: schedule.id,
    sound: schedule.sound,
    alertAt: new Date(schedule.alertAt).toISOString(),
    delayMs: delay,
    overdue: schedule.alertAt <= Date.now(),
    retry: delayOverride !== null,
  });
  const timer = setTimeout(() => {
    if (delayOverride === null && Date.now() + 500 < schedule.alertAt) {
      logReminderEvent("timer-early-drift", {
        id: schedule.id,
        driftMs: schedule.alertAt - Date.now(),
      });
      scheduleReminder(schedule);
      return;
    }
    reminderTimers.delete(schedule.id);
    logReminderEvent("timer-fired", {
      id: schedule.id,
      sound: schedule.sound,
      scheduledAlertAt: new Date(schedule.alertAt).toISOString(),
      firedAt: new Date().toISOString(),
      deltaMs: Date.now() - schedule.alertAt,
    });
    const delivery = deliverReminder(schedule);
    if (!delivery.ok && delivery.retry) {
      scheduleReminder(schedule, MISSED_ALERT_SPACING_MS);
    }
  }, delay);
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

// Sweep cadence independent of setTimeout: recovers reminders lost to system
// sleep, timer coalescing, or clock adjustments. Idempotent — deliverReminder
// dedupes via deliveredReminderIds, and overdue alerts stay spaced apart.
function sweepReminderTimers(reason) {
  if (!scheduledReminders.length) return;
  rescheduleReminders();
  logReminderEvent("sweep", {
    reason,
    scheduled: scheduledReminders.length,
  });
  recordAcceptanceEvent("reminders:swept", { reason });
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

// ---------------------------------------------------------------------------
// Usage meters source: trailing 5h/7d token windows from the ZCode CLI local
// database. The snapshot maps to the renderer contract
// { fiveHour, sevenDay, updatedAtMs } where each window is { usedPct } or
// null when not derivable.
//
// usedPct needs a plan quota and NO quota is persisted anywhere local (the
// entitlement snapshot is fetched from the remote zcode-host via RPC - only
// log lines reference it). Limits are therefore opt-in via env vars so the
// meters never display a fabricated percentage:
//   DAYMARK_USAGE_5H_LIMIT_TOKENS, DAYMARK_USAGE_7D_LIMIT_TOKENS
// Without them both windows are null and the meters hide gracefully.
// resetsAtMs is not derivable from local data (no window anchor): omitted.
let usageSnapshotCache = null;
let usageSnapshotCachedAt = 0;

function readUsageWindowTokens(database, windowMs) {
  const row = database
    .prepare(
      "SELECT SUM(COALESCE(computed_total_tokens, provider_total_tokens, 0)) AS tokens "
        + "FROM model_usage WHERE completed_at >= ?",
    )
    .get(Date.now() - windowMs);
  return typeof row?.tokens === "number" ? row.tokens : 0;
}

function usageWindowFor(tokens, limitTokens) {
  if (!Number.isFinite(limitTokens) || limitTokens <= 0) return null;
  const usedPct = Math.min(100, Math.max(0, Math.round((tokens / limitTokens) * 100)));
  return { usedPct };
}

async function computeUsageSnapshot() {
  const now = Date.now();
  if (usageSnapshotCache && now - usageSnapshotCachedAt < USAGE_CACHE_TTL_MS) {
    return usageSnapshotCache;
  }
  let fiveHour = null;
  let sevenDay = null;
  let database = null;
  try {
    // Dynamic import so a runtime without node:sqlite degrades to nulls
    // instead of crashing app startup.
    const { DatabaseSync } = await import("node:sqlite");
    database = new DatabaseSync(ZCODE_USAGE_DB_PATH, { readOnly: true });
    fiveHour = usageWindowFor(
      readUsageWindowTokens(database, USAGE_FIVE_HOUR_WINDOW_MS),
      Number(process.env.DAYMARK_USAGE_5H_LIMIT_TOKENS),
    );
    sevenDay = usageWindowFor(
      readUsageWindowTokens(database, USAGE_SEVEN_DAY_WINDOW_MS),
      Number(process.env.DAYMARK_USAGE_7D_LIMIT_TOKENS),
    );
  } catch (error) {
    console.log(`DAYMARK_USAGE_LOG ${JSON.stringify({
      name: "usage-read-failed",
      reason: String(error?.message ?? error),
      at: new Date().toISOString(),
    })}`);
  } finally {
    try {
      database?.close();
    } catch {
      // Already closed - nothing to do.
    }
  }
  usageSnapshotCache = { fiveHour, sevenDay, updatedAtMs: now };
  usageSnapshotCachedAt = now;
  return usageSnapshotCache;
}

// ---------------------------------------------------------------------------
// Live ZAI subscription quota (mirrors windows/functions/used.ps1 exactly).
// The OAuth access token is decrypted from ~/.zcode/v2/credentials.json using
// ZCode's enc:v1: AES-256-GCM fallback scheme (key = SHA256 of a deterministic
// machine-specific secret), then https://api.z.ai/api/monitor/usage/quota/limit
// is queried with a bare `authorization` header (no Bearer prefix). The
// token is NEVER logged, cached to disk, or sent anywhere except api.z.ai.
const ZAI_QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const ZAI_CREDENTIALS_PATH = path.join(
  os.homedir(),
  ".zcode",
  "v2",
  "credentials.json",
);
const QUOTA_REFRESH_INTERVAL_MS = 20 * 1000;
// The quota is fetched every 20s but only pushed to the sync server when the
// numbers actually changed — a PUT on every fetch would churn the sync
// revision nonstop for identical readings, so pushes are change-driven only.
const QUOTA_FIRST_REFRESH_DELAY_MS = 3_000;
const QUOTA_SYNC_PUSH_MAX_ATTEMPTS = 3;
const QUOTA_HTTP_TIMEOUT_MS = 10_000;
// The token material must never appear in diagnostics or event logs.
const USAGE_QUOTA_LOG_PREFIX = "DAYMARK_USAGE_QUOTA_LOG";

function logUsageQuotaEvent(name, details = {}) {
  console.log(`${USAGE_QUOTA_LOG_PREFIX} ${JSON.stringify({
    name,
    at: new Date().toISOString(),
    ...details,
  })}`);
}

// ZCode credential fallback decryption: enc:v1:<iv>.<tag>.<payload>, all
// base64url, AES-256-GCM with a SHA-256 key derived from machine identity.
function decryptEncV1Credential(value) {
  if (typeof value !== "string" || !value.startsWith("enc:v1:")) return value ?? "";
  const parts = value.slice("enc:v1:".length).split(".");
  if (parts.length !== 3) return "";
  const secret = `zcode-credential-fallback:${os.platform()}:${os.homedir()}:${os.userInfo().username}`;
  const key = createHash("sha256").update(secret).digest();
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(parts[0], "base64url"),
  );
  decipher.setAuthTag(Buffer.from(parts[1], "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(parts[2], "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function readZaiAccessToken() {
  try {
    if (!existsSync(ZAI_CREDENTIALS_PATH)) return "";
    const credentials = JSON.parse(readFileSync(ZAI_CREDENTIALS_PATH, "utf8"));
    return decryptEncV1Credential(credentials["oauth:zai:access_token"] ?? "");
  } catch {
    return "";
  }
}

// The API's percentage field is the USED percent (currentValue 423 of usage
// 2000 reports percentage 21). Remaining is derived from remaining/usage when
// present, otherwise 100 - percentage, clamped to [0, 100].
function quotaRemainingPctForLimit(limit) {
  const usage = Number(limit?.usage);
  let remaining;
  if (Number.isFinite(usage) && usage > 0 && limit?.remaining != null) {
    remaining = (Number(limit.remaining) / usage) * 100;
  } else {
    remaining = 100 - Number(limit?.percentage);
  }
  if (!Number.isFinite(remaining)) return 100;
  return Math.round(Math.min(100, Math.max(0, remaining)));
}

// Window identity comes from the row's unit field, NOT row order:
// unit 3 (number 5) = rolling 5-hour window; unit 6 (number 1) = weekly.
function quotaWindowKindForLimit(limit) {
  const unit = Number.parseInt(String(limit?.unit), 10);
  const number = Number.parseInt(String(limit?.number), 10);
  if (unit === 3 || number === 5) return "fiveHour";
  if (unit === 6 || number === 1) return "sevenDay";
  return "unknown";
}

function emptyQuotaWindow(updatedAt) {
  return { remainingPct: 100, resetsAtMs: 0, updatedAt };
}

function quotaSnapshotFromLimits(limits, updatedAt) {
  const windows = { fiveHour: null, sevenDay: null };
  for (const limit of Array.isArray(limits) ? limits : []) {
    // Free "Start" plan entries and rows without a reset time are excluded.
    if (limit?.planId || !limit?.nextResetTime) continue;
    const kind = quotaWindowKindForLimit(limit);
    if (kind === "unknown" || windows[kind]) continue;
    windows[kind] = {
      remainingPct: quotaRemainingPctForLimit(limit),
      resetsAtMs: Number(limit.nextResetTime) || 0,
      updatedAt,
    };
  }
  // A window with no row (freshly reset / nothing used) stays at 100%.
  return {
    fiveHour: windows.fiveHour ?? emptyQuotaWindow(updatedAt),
    sevenDay: windows.sevenDay ?? emptyQuotaWindow(updatedAt),
    updatedAt,
  };
}

let usageQuotaCache = null;
let usageQuotaRefreshInFlight = false;
let lastQuotaSyncPush = { signature: "", at: 0 };

function usageQuotaStorePath() {
  return path.join(app.getPath("userData"), "usage-quota.json");
}

function loadUsageQuotaFromDisk() {
  if (usageQuotaCache) return usageQuotaCache;
  try {
    const persisted = readJsonWithSalvage(usageQuotaStorePath(), null);
    if (persisted?.fiveHour && persisted?.sevenDay) {
      usageQuotaCache = persisted;
    }
  } catch {
    // No salvageable snapshot - the defaults below apply.
  }
  return usageQuotaCache;
}

function currentUsageQuotaSnapshot() {
  return loadUsageQuotaFromDisk();
}

async function fetchUsageQuotaSnapshot() {
  const token = readZaiAccessToken();
  if (!token) throw new Error("zai-access-token-unavailable");
  const response = await withTimeout(
    fetch(ZAI_QUOTA_URL, {
      headers: { authorization: token },
      cache: "no-store",
    }),
    QUOTA_HTTP_TIMEOUT_MS,
    `ZAI quota request timed out after ${QUOTA_HTTP_TIMEOUT_MS}ms.`,
  );
  if (!response.ok) throw new Error(`zai-quota-http-${response.status}`);
  const payload = await response.json();
  const updatedAt = new Date().toISOString();
  return quotaSnapshotFromLimits(payload?.data?.limits, updatedAt);
}

// Merge the latest quota into the synced workspace state so the Android app
// can read it. Uses the same optimistic-concurrency pattern as the renderer:
// read current state, PUT {state, expectedRevision}, re-read + retry on 409.
function canonicalPairingKeyPath() {
  try {
    return path.join(app.getPath("userData"), "canonical-sync-key.txt");
  } catch {
    return null;
  }
}

function persistCanonicalPairingKey(syncKey) {
  try {
    const keyPath = canonicalPairingKeyPath();
    if (keyPath && SYNC_PATTERN.test(syncKey)) {
      writeFileSync(keyPath, syncKey, { encoding: "utf8", mode: 0o600 });
    }
  } catch {
    // Best-effort persistence; the push falls back to cookies.
  }
}

function loadCanonicalPairingKeyFromDisk() {
  try {
    const keyPath = canonicalPairingKeyPath();
    if (!keyPath || !existsSync(keyPath)) return null;
    const value = fs.readFileSync(keyPath, "utf8").trim();
    return SYNC_PATTERN.test(value) ? value : null;
  } catch {
    return null;
  }
}

async function pushUsageQuotaToSync(snapshot) {
  let syncKey = null;
  if (lastCanonicalPairingKey && SYNC_PATTERN.test(lastCanonicalPairingKey)) {
    syncKey = lastCanonicalPairingKey;
  } else {
    syncKey = loadCanonicalPairingKeyFromDisk();
    if (syncKey) lastCanonicalPairingKey = syncKey;
  }
  if (!syncKey) {
    try {
      const cookies = await desktopSession().cookies.get({ url: PRODUCTION_ORIGIN });
      syncKey = cookies.find((cookie) => (
        cookie.name === "daymark.sync-key" && SYNC_PATTERN.test(cookie.value)
      ))?.value ?? null;
    } catch {
      return;
    }
    if (syncKey) persistCanonicalPairingKey(syncKey);
  }
  if (!syncKey) return;

  const usagePayload = {
    fiveHour: snapshot.fiveHour,
    sevenDay: snapshot.sevenDay,
    updatedAt: Date.parse(snapshot.updatedAt),
  };
  const syncEndpoint = `${PRODUCTION_ORIGIN}/api/sync/${encodeURIComponent(syncKey)}`;

  for (let attempt = 0; attempt < QUOTA_SYNC_PUSH_MAX_ATTEMPTS; attempt += 1) {
    let currentState = null;
    try {
      const readResponse = await withTimeout(
        desktopSession().fetch(syncEndpoint, {
          headers: { Accept: "application/json" },
          cache: "no-store",
          bypassCustomProtocolHandlers: true,
        }),
        QUOTA_HTTP_TIMEOUT_MS,
        `Quota sync read timed out after ${QUOTA_HTTP_TIMEOUT_MS}ms.`,
      );
      if (readResponse.ok) {
        currentState = (await readResponse.json())?.state ?? null;
      }
    } catch {
      return; // Offline - the next refresh retries.
    }

    const fallbackState = {
      schemaVersion: 6,
      revision: 0,
      updatedAt: new Date().toISOString(),
      clientId: "daymark-desktop",
      projects: {},
      sections: {},
      filters: {},
      tasks: {},
      orderItems: {},
      notes: {},
      reminders: {},
      diaryEntries: {},
      syncTombstones: {},
      preferences: {},
      undoStack: [],
    };
    // The server's mergeSyncStates allowlist drops unknown top-level fields,
    // so usage rides inside the merged `preferences` object instead.
    const baseState = structuredClone(currentState ?? fallbackState);
    baseState.preferences = { ...(baseState.preferences ?? {}), usage: usagePayload };
    // Mark the state newer so the server's authoritative-state pick keeps our
    // preferences (the merge compares whole-state updatedAt on ties).
    baseState.updatedAt = new Date().toISOString();
    const nextState = baseState;

    try {
      const writeResponse = await withTimeout(
        desktopSession().fetch(syncEndpoint, {
          method: "PUT",
          headers: { Accept: "application/json", "Content-Type": "application/json" },
          body: JSON.stringify({
            state: nextState,
            expectedRevision: Number(currentState?.revision ?? 0),
          }),
          bypassCustomProtocolHandlers: true,
        }),
        QUOTA_HTTP_TIMEOUT_MS,
        `Quota sync write timed out after ${QUOTA_HTTP_TIMEOUT_MS}ms.`,
      );
      if (writeResponse.ok) {
        logUsageQuotaEvent("sync-pushed", { attempt });
        return;
      }
      if (writeResponse.status === 409) continue; // Re-read and retry.
      logUsageQuotaEvent("sync-push-failed", { status: writeResponse.status });
      return;
    } catch (error) {
      logUsageQuotaEvent("sync-push-failed", {
        reason: persistenceErrorMessage(error),
      });
      return;
    }
  }
  logUsageQuotaEvent("sync-push-exhausted", { attempts: QUOTA_SYNC_PUSH_MAX_ATTEMPTS });
}

function refreshUsageQuota() {
  if (usageQuotaRefreshInFlight) return;
  usageQuotaRefreshInFlight = true;
  void (async () => {
    try {
      const snapshot = await fetchUsageQuotaSnapshot();
      usageQuotaCache = snapshot;
      persistJsonAtomically(usageQuotaStorePath(), snapshot, "usage-quota");
      logUsageQuotaEvent("refreshed", {
        fiveHourRemainingPct: snapshot.fiveHour.remainingPct,
        sevenDayRemainingPct: snapshot.sevenDay.remainingPct,
      });
      const quotaSignature = `${snapshot.fiveHour.remainingPct}/${snapshot.sevenDay.remainingPct}/${snapshot.fiveHour.resetsAtMs}/${snapshot.sevenDay.resetsAtMs}`;
      // Push ONLY on a real quota change: a periodic keep-alive re-push bumped
      // the workspace revision every couple of minutes and woke every sync
      // client for no data. Unchanged values are still accurate on clients.
      if (quotaSignature !== lastQuotaSyncPush.signature) {
        lastQuotaSyncPush = { signature: quotaSignature, at: Date.now() };
        void pushUsageQuotaToSync(snapshot);
      }
    } catch (error) {
      // On failure keep the last good value (with its old updatedAt); if there
      // is none, fall back to the on-disk snapshot from a previous session.
      logUsageQuotaEvent("refresh-failed", {
        reason: persistenceErrorMessage(error),
      });
      loadUsageQuotaFromDisk();
    } finally {
      usageQuotaRefreshInFlight = false;
    }
  })();
}

app.whenReady().then(() => {
  traceStartup("app-ready");
  installPackagedClientProtocol();
  deliveredReminderIds = readDeliveredReminderIds();
  if (!existsSync(reminderDeliveredPath())) {
    persistJsonAtomically(reminderDeliveredPath(), [], "delivered-ledger");
  }
  scheduledReminders = readReminderSchedules();
  rescheduleReminders();
  // Re-arm after sleep/resume and re-check on a fixed cadence so reminders fire
  // at the exact time even if a single setTimeout was lost or coalesced.
  powerMonitor.on("resume", () => sweepReminderTimers("resume"));
  powerMonitor.on("unlock", () => sweepReminderTimers("unlock"));
  const reminderSweepTimer = setInterval(
    () => sweepReminderTimers("interval"),
    REMINDER_SWEEP_INTERVAL_MS,
  );
  reminderSweepTimer.unref?.();
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
  ipcMain.handle("daymark:usage", () => computeUsageSnapshot());
  ipcMain.handle("daymark:usage-quota", () => currentUsageQuotaSnapshot());
  // Background quota refresh: never blocks startup; the first fetch runs a few
  // seconds after ready, then every 20 seconds. A single interval + in-flight
  // guard means no timer stacking.
  setTimeout(refreshUsageQuota, QUOTA_FIRST_REFRESH_DELAY_MS).unref?.();
  const quotaRefreshTimer = setInterval(refreshUsageQuota, QUOTA_REFRESH_INTERVAL_MS);
  quotaRefreshTimer.unref?.();
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
  stopReminderSound();
  reminderTray?.destroy();
  reminderTray = null;
});

// SLICE-DONE: data-engineer
