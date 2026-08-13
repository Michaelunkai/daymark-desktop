import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("./main.mjs", import.meta.url), "utf8");
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
const syncVerifier = await readFile(
  new URL("../scripts/verify-windows-sync.mjs", import.meta.url),
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
  assert.match(main, /desktopSession\.cookies\.set/);
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
  assert.match(main, /Daymark Runtime\.exe/);
  assert.match(main, /Daymark\.exe/);
});

test("desktop window becomes visible after a successful detached load", () => {
  assert.match(main, /function showMainWindow\(\)/);
  assert.match(main, /mainWindow\.webContents\.once\("did-finish-load", showMainWindow\)/);
  assert.match(main, /mainWindow\.once\("ready-to-show", showMainWindow\)/);
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
