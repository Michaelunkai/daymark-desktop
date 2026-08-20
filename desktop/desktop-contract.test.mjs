import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("./main.mjs", import.meta.url), "utf8");
const preload = await readFile(new URL("./preload.cjs", import.meta.url), "utf8");
const reminderScheduler = await readFile(
  new URL("./reminder-scheduler.mjs", import.meta.url),
  "utf8",
);
const windowsLauncher = await readFile(
  new URL("./windows-launcher.cs", import.meta.url),
  "utf8",
).catch(() => "");
const afterPack = await readFile(
  new URL("../scripts/after-pack-windows.mjs", import.meta.url),
  "utf8",
).catch(() => "");
const scrollVerifier = await readFile(
  new URL("../scripts/verify-windows-scroll.mjs", import.meta.url),
  "utf8",
);
const detachedLaunchVerifier = await readFile(
  new URL("../scripts/verify-windows-detached-launch.mjs", import.meta.url),
  "utf8",
);
const syncVerifier = await readFile(
  new URL("../scripts/verify-windows-sync.mjs", import.meta.url),
  "utf8",
);
const reminderVerifier = await readFile(
  new URL("../scripts/verify-windows-reminders.mjs", import.meta.url),
  "utf8",
);
const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

test("desktop shell uses the exact production Daymark origin", () => {
  assert.match(main, /https:\/\/daymark-desktop\.michaelovsky55555\.chatgpt\.site/);
  assert.match(main, /persist:daymark/);
  assert.match(main, /pairCanonicalWorkspace/);
  assert.match(main, /session\.fromPartition/);
  assert.match(main, /\/api\/sync\/pair-canonical/);
  assert.match(main, /desktopPartition\.cookies\.set/);
  assert.match(main, /\.\.\.structuredSetCookies/);
  assert.match(main, /response\.headers\.get\("set-cookie"\)/);
});

test("packaged startup serves bundled client assets without changing the production origin", () => {
  assert.match(main, /PACKAGED_CLIENT_DIRECTORY\s*=\s*path\.join\("dist",\s*"client"\)/);
  assert.match(main, /installPackagedClientProtocol/);
  assert.match(main, /desktopPartition\.protocol\.handle\("https"/);
  assert.match(main, /requestUrl\.origin\s*!==\s*PRODUCTION_ORIGIN/);
  assert.match(main, /packagedClientFileForUrl/);
  assert.match(main, /readFileSync\(clientFile\)/);
  assert.match(main, /new Response\(body/);
  assert.match(main, /"Cache-Control"/);
  assert.match(main, /"Content-Type"/);
  assert.match(main, /desktopPartition\.fetch\(request,\s*\{\s*bypassCustomProtocolHandlers:\s*true/);
  assert.match(main, /pair-canonical[\s\S]*?bypassCustomProtocolHandlers:\s*true/);
  assert.match(main, /requestUrl\.pathname\.startsWith\("\/api\/"\)/);
  assert.doesNotMatch(main, /webSecurity\s*:\s*false/);
  assert.match(main, /show:\s*false/);
  assert.match(main, /mainWindow\.once\("ready-to-show", revealFailureWindow\)/);
  assert.match(main, /rendererNavigationStarted\s*&&\s*!rendererNavigationTrusted/);
  assert.match(main, /rendererNavigationTrusted\s*&&\s*!windowVisibleTraced/);
  assert.match(main, /rendererNavigationTrusted\s*=\s*false/);
  assert.match(main, /traceStartup\("window-visible"\)/);
  assert.match(main, /ipcMain\.on\("daymark:renderer-ready"/);
  assert.match(main, /traceStartup\("renderer-ready-visible"\)/);
  assert.match(preload, /onAppReady:\s*\(\)\s*=>\s*ipcRenderer\.send\("daymark:renderer-ready"\)/);
  assert.match(preload, /getCanonicalPairingKey/);
  assert.match(preload, /onCanonicalPaired/);
  assert.match(main, /webContents\.send\("daymark:canonical-paired",\s*syncKey\)/);
});

test("startup reuses existing canonical pairing before any network pairing", () => {
  assert.match(
    main,
    /if\s*\(await hasCanonicalPairing\(\)\)\s*\{\s*recordAcceptanceEvent\("sync:canonical-pairing-reused"/,
  );
  assert.match(main, /return START_URL;/);
  assert.match(main, /recordAcceptanceEvent\("sync:canonical-pairing-deferred"/);
  assert.match(main, /void pairCanonicalWorkspace\(\)\.catch/);
  assert.doesNotMatch(main, /return await pairCanonicalWorkspace\(\);/);
});

test("desktop shell persists native Windows reminder schedules and keeps them alive in the tray", () => {
  assert.match(main, /ipcMain\.handle\("daymark:reminders:replace"/);
  assert.match(main, /readReminderSchedules/);
  assert.match(main, /persistReminderSchedules/);
  assert.match(main, /rescheduleReminders/);
  assert.match(main, /completeReminder/);
  assert.match(main, /MISSED_ALERT_SPACING_MS/);
  assert.match(main, /OVERDUE_CATCH_UP_WINDOW_MS/);
  assert.match(main, /reminder-delivered\.json/);
  assert.match(main, /readJsonWithSalvage/);
  assert.match(main, /SoundPlayer/);
  assert.match(main, /SystemSounds/);
  assert.match(main, /silent:\s*true/);
  assert.match(main, /PAIRING_TIMEOUT_MS/);
  assert.match(main, /withTimeout/);
  assert.match(main, /show:\s*false/);
  assert.match(main, /shouldKeepRunningInTray/);
  assert.doesNotMatch(main, /shouldExitOnWindowClose\s*=\s*process\.argv\.includes\("--daymark-detached-child"\)/);
  assert.match(main, /shouldExitOnWindowClose\s*=\s*process\.env\.DAYMARK_VERIFY_EXIT\s*===\s*"1"/);
  assert.match(main, /persisted:\s*true/);
  assert.match(main, /DAYMARK_ACCEPTANCE_EVENT/);
  assert.match(main, /DAYMARK_STARTUP_TRACE/);
  assert.match(main, /1\.4\.44/);
  assert.match(main, /new Notification/);
  assert.match(main, /new Tray/);
  assert.match(main, /setLoginItemSettings/);
  assert.match(main, /preload:\s*path\.join\(__dirname, "preload\.cjs"\)/);
  assert.match(preload, /contextBridge\.exposeInMainWorld\("DaymarkDesktop"/);
  assert.match(preload, /getReminderStatus:\s*\(\)\s*=>\s*"desktop-ready"/);
  assert.match(preload, /getDesktopDiagnostics/);
  assert.match(preload, /ipcRenderer\.invoke\("daymark:reminders:replace"/);
  assert.match(preload, /daymark:reminders:replace/);
  assert.match(reminderScheduler, /normalizeReminderSchedules/);
  assert.match(reminderScheduler, /includePast/);
  assert.match(reminderScheduler, /notificationForSchedule/);
  assert.match(reminderVerifier, /DaymarkDesktop\.syncReminders/);
  assert.match(reminderVerifier, /reminder-schedules\.json/);
  assert.match(reminderVerifier, /DAYMARK_LOCAL_CLIENT_PATH/);
  assert.match(reminderVerifier, /pathname\.startsWith\("\/api\/"\)/);
  assert.match(reminderVerifier, /DAYMARK_REMINDER_VERIFY_ROOT/);
  assert.match(reminderVerifier, /1\.4\.44/);
  assert.match(reminderVerifier, /daymark_reminder_\$\{sound\}\.wav/);
  assert.equal(packageJson.build.extraResources[0].to, "assets");
});

test("desktop shell accepts only valid Daymark pairing deep links", () => {
  assert.match(main, /daymark:/);
  assert.match(main, /\[A-Za-z0-9_-\]\{22\}/);
  assert.match(main, /\?sync=/);
});

test("desktop shell blocks untrusted in-app navigation", () => {
  assert.match(main, /isTrustedNavigation/);
  assert.match(main, /will-navigate/);
  assert.match(main, /shell\.openExternal/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
});

test("Windows minimum size still permits responsive layouts at 150% scaling", () => {
  assert.match(main, /minWidth:\s*640/);
  assert.match(main, /minHeight:\s*400/);
});

test("Windows packaging preserves local data on uninstall", () => {
  assert.equal(packageJson.build.appId, "com.michaelunkai.daymark.windows");
  assert.equal(packageJson.build.nsis.deleteAppDataOnUninstall, false);
  assert.deepEqual(packageJson.build.protocols[0].schemes, ["daymark"]);
});

test("packaged Windows starts through a native detached launcher before Electron bootstraps", () => {
  assert.equal(packageJson.build.afterPack, "scripts/after-pack-windows.mjs");
  assert.match(afterPack, /Daymark Runtime\.exe/);
  assert.match(afterPack, /windows-launcher\.cs/);
  assert.match(windowsLauncher, /CreateProcessW/);
  assert.match(windowsLauncher, /DetachedProcess/);
  assert.match(windowsLauncher, /CreateNewProcessGroup/);
  assert.match(windowsLauncher, /NODE_OPTIONS/);
  assert.match(windowsLauncher, /ELECTRON_RUN_AS_NODE/);
  assert.match(windowsLauncher, /--daymark-detached-child/);
  assert.match(windowsLauncher, /AssemblyFileVersion\("1\.4\.44\.0"\)/);
  assert.match(main, /Daymark Runtime\.exe/);
  assert.match(main, /Daymark\.exe/);
});

test("packaged runtime keeps the Daymark identity used by the pinned taskbar window", () => {
  assert.match(afterPack, /rcedit\.exe/);
  assert.match(afterPack, /--set-icon/);
  assert.match(afterPack, /FileDescription/);
  assert.match(afterPack, /ProductName/);
  assert.match(afterPack, /OriginalFilename/);
  assert.match(afterPack, /Daymark Runtime\.exe/);
});

test("Windows registers a Daymark shortcut matching the pinned taskbar identity", () => {
  assert.match(main, /APP_USER_MODEL_ID/);
  assert.match(main, /Start Menu/);
  assert.match(main, /writeShortcutLink/);
  assert.match(main, /appUserModelId:\s*APP_USER_MODEL_ID/);
  assert.match(main, /icon:\s*launcherPath/);
});

test("desktop window becomes visible after a successful detached load", () => {
  assert.match(main, /function showMainWindow\(\)/);
  assert.match(main, /mainWindow\.webContents\.once\("did-finish-load", revealFailureWindow\)/);
  assert.match(main, /mainWindow\.once\("ready-to-show", revealFailureWindow\)/);
  assert.match(main, /rendererNavigationStarted\s*=\s*true/);
  assert.match(
    detachedLaunchVerifier,
    /if \(window\?\.responding && window\.title\) return window;/,
  );
});

test("packaged scroll verification counts movement from the known start position", () => {
  assert.match(scrollVerifier, /const start = await page\.locator\(target\.selector\)\.evaluate/);
  assert.match(scrollVerifier, /distinctPositions\(\[start, \.\.\.down\]\)/);
  assert.match(scrollVerifier, /distinctPositions\(\[downEnd, \.\.\.up\]\)/);
  assert.match(scrollVerifier, /upEnd\.y > start\.y \+ 2/);
  assert.match(scrollVerifier, /verifyReadableLayout/);
  assert.match(scrollVerifier, /minimumBodyWidth >= 120/);
  assert.match(scrollVerifier, /minimumTitleWidth >= 120/);
  assert.match(scrollVerifier, /actionsBelowBody/);
});

test("packaged sync verification exercises task and every Order lane date calendar", () => {
  assert.match(syncVerifier, /DAYMARK_LOCAL_CLIENT_PATH/);
  assert.match(syncVerifier, /getByRole\("button", \{ name: "Move to date"/);
  assert.match(syncVerifier, /getByRole\("button", \{ name: "Copy to date"/);
  assert.match(syncVerifier, /calendarMoveToDate: true/);
  assert.match(syncVerifier, /calendarCopyToDate: true/);
  assert.match(syncVerifier, /lane: "now"/);
  assert.match(syncVerifier, /lane: "later"/);
  assert.match(syncVerifier, /lane: "after"/);
  assert.match(syncVerifier, /orderCalendarTransfers: orderDateResults/);
  assert.match(syncVerifier, /copyRetainedSource: true/);
  assert.match(syncVerifier, /moveRemovedSource: true/);
  assert.match(syncVerifier, /temporaryRecordsRemaining/);
  assert.match(syncVerifier, /temporaryOrderRecordsRemaining/);
});
