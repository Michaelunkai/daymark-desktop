import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const main = await readFile(new URL("./main.mjs", import.meta.url), "utf8");
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
