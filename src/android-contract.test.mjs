import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Android release exposes the shared responsive app with a launcher icon", async () => {
  const [manifest, gradle, activity, icon, shellStyles] = await Promise.all([
    readFile(new URL("./android/app/src/main/AndroidManifest.xml", root), "utf8"),
    readFile(new URL("./android/app/build.gradle", root), "utf8"),
    readFile(new URL("./android/app/src/main/java/com/michaelunkai/daymark/MainActivity.java", root), "utf8"),
    readFile(new URL("./android/app/src/main/res/drawable/ic_daymark.xml", root), "utf8"),
    readFile(new URL("./src/styles/app-shell.css", root), "utf8"),
  ]);

  assert.match(manifest, /android:icon="@drawable\/ic_daymark"/);
  assert.match(manifest, /android:roundIcon="@drawable\/ic_daymark"/);
  assert.match(gradle, /versionName "1\.4\.12"/);
  assert.match(activity, /daymark-desktop\.michaelovsky55555\.chatgpt\.site/);
  assert.match(activity, /setDomStorageEnabled\(true\)/);
  assert.match(activity, /addJavascriptInterface/);
  assert.match(activity, /setTheme/);
  assert.match(activity, /Color\.BLACK/);
  assert.match(activity, /applyVantaBlackSystemBars/);
  assert.match(activity, /#000000/);
  assert.match(activity, /#fff/);
  assert.match(activity, /SharedPreferences/);
  assert.match(activity, /SYNC_KEY_PREF/);
  assert.match(activity, /preferences\.getString\(SYNC_KEY_PREF/);
  assert.match(activity, /onRenderProcessGone/);
  assert.match(activity, /recoverWebView/);
  assert.match(activity, /onPageCommitVisible/);
  assert.match(activity, /Loading Daymark/);
  assert.match(icon, /android:pathData/);
  assert.doesNotMatch(icon, /#267553|#C44536|#F4F2EF|#1E2A25/);
  assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
  assert.match(shellStyles, /--daymark-viewport-height:\s*100dvh/);
  assert.match(shellStyles, /var\(--daymark-viewport-height\)/);
  assert.match(shellStyles, /\.main-content\s*\{[\s\S]*?min-height:\s*0[\s\S]*?overflow:\s*auto/);
});
