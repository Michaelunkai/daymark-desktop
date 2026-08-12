import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Android release exposes the shared responsive app with the premium launcher icon", async () => {
  const [manifest, gradle, activity, icon, shellStyles, appSource, commandStyles, searchStyles, mainSource] = await Promise.all([
    readFile(new URL("./android/app/src/main/AndroidManifest.xml", root), "utf8"),
    readFile(new URL("./android/app/build.gradle", root), "utf8"),
    readFile(new URL("./android/app/src/main/java/com/michaelunkai/daymark/MainActivity.java", root), "utf8"),
    readFile(new URL("./android/app/src/main/res/drawable-nodpi/ic_daymark_launcher.png", root)),
    readFile(new URL("./src/styles/app-shell.css", root), "utf8"),
    readFile(new URL("./src/App.jsx", root), "utf8"),
    readFile(new URL("./src/features/command/command.css", root), "utf8"),
    readFile(new URL("./src/features/search/search.css", root), "utf8"),
    readFile(new URL("./src/main.jsx", root), "utf8"),
  ]);

  assert.match(manifest, /android:icon="@drawable\/ic_daymark_launcher"/);
  assert.match(manifest, /android:roundIcon="@drawable\/ic_daymark_launcher"/);
  assert.match(gradle, /versionName "1\.4\.20"/);
  assert.match(activity, /daymark-desktop\.michaelovsky55555\.chatgpt\.site/);
  assert.match(activity, /setDomStorageEnabled\(true\)/);
  assert.match(activity, /addJavascriptInterface/);
  assert.match(activity, /setTheme/);
  assert.match(activity, /Color\.BLACK/);
  assert.match(activity, /applyVantaBlackSystemBars/);
  assert.match(activity, /Color\.BLACK/);
  assert.match(activity, /Color\.WHITE/);
  assert.match(activity, /SharedPreferences/);
  assert.match(activity, /SYNC_KEY_PREF/);
  assert.match(activity, /preferences\.getString\(SYNC_KEY_PREF/);
  assert.match(activity, /onRenderProcessGone/);
  assert.match(activity, /recoverWebView/);
  assert.match(activity, /onPageCommitVisible/);
  assert.match(activity, /Loading Daymark/);
  assert.match(activity, /Daymark could not load/);
  assert.match(activity, /retryCurrentPage/);
  assert.match(activity, /LOAD_DEFAULT/);
  assert.match(activity, /setOffscreenPreRaster\(true\)/);
  assert.match(activity, /NATIVE_RELEASE/);
  assert.match(activity, /withLaunchMarker/);
  assert.match(activity, /onAppReady/);
  assert.match(activity, /verifyAppRendered/);
  assert.match(activity, /CONTENT_READY_TIMEOUT_MS/);
  assert.match(activity, /scheduleContentTimeout/);
  assert.match(activity, /root\.children\.length/);
  assert.match(activity, /monitorRenderedApp/);
  assert.match(activity, /RUNTIME_HEALTH_CHECK_MS/);
  assert.match(activity, /DaymarkChromeClient/);
  assert.doesNotMatch(activity, /loadDataWithBaseURL/);
  assert.deepEqual([...icon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(icon.length > 50_000);
  assert.match(manifest, /android:resizeableActivity="true"/);
  assert.match(manifest, /android:screenOrientation="unspecified"/);
  assert.match(manifest, /android:configChanges="[^"]*orientation[^"]*screenSize/);
  assert.match(manifest, /android:windowSoftInputMode="adjustResize"/);
  assert.match(shellStyles, /--daymark-viewport-height:\s*100dvh/);
  assert.match(shellStyles, /--daymark-topbar-height:\s*64px/);
  assert.match(shellStyles, /var\(--daymark-viewport-height\)/);
  assert.match(shellStyles, /var\(--daymark-topbar-height\)/);
  assert.match(shellStyles, /env\(safe-area-inset-bottom\)/);
  assert.match(shellStyles, /\.main-content\s*\{[\s\S]*?min-height:\s*0[\s\S]*?overflow:\s*auto/);
  assert.match(appSource, /--daymark-topbar-height/);
  assert.match(appSource, /new ResizeObserver\(updateTopbarHeight\)/);
  assert.match(appSource, /<header className="topbar" ref=\{topbarRef\}>/);
  assert.match(shellStyles, /\.thought-capture\s*\{[\s\S]*?max-height:\s*calc\([\s\S]*?--daymark-topbar-height/);
  assert.match(commandStyles, /var\(--daymark-viewport-height,\s*100dvh\)/);
  assert.match(searchStyles, /var\(--daymark-viewport-height,\s*100dvh\)/);
  assert.match(mainSource, /minHeight:\s*'var\(--daymark-viewport-height\)'/);
});
