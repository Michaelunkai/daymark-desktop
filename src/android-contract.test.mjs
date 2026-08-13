import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Android release exposes the shared responsive app with the premium launcher icon", async () => {
  const [manifest, gradle, activity, icon, shellStyles, appSource, commandStyles, searchStyles, mainSource, releaseVerifier, escrow, readiness, buildScript] = await Promise.all([
    readFile(new URL("./android/app/src/main/AndroidManifest.xml", root), "utf8"),
    readFile(new URL("./android/app/build.gradle", root), "utf8"),
    readFile(new URL("./android/app/src/main/java/com/michaelunkai/daymark/MainActivity.java", root), "utf8"),
    readFile(new URL("./android/app/src/main/res/drawable-nodpi/ic_daymark_launcher.png", root)),
    readFile(new URL("./src/styles/app-shell.css", root), "utf8"),
    readFile(new URL("./src/App.jsx", root), "utf8"),
    readFile(new URL("./src/features/command/command.css", root), "utf8"),
    readFile(new URL("./src/features/search/search.css", root), "utf8"),
    readFile(new URL("./src/main.jsx", root), "utf8"),
    readFile(new URL("./android/Verify-DaymarkRelease.ps1", root), "utf8"),
    readFile(new URL("./android/Protect-DaymarkSigningKey.ps1", root), "utf8"),
    readFile(new URL("./android/Test-DaymarkReleaseReadiness.ps1", root), "utf8"),
    readFile(new URL("./scripts/build-android.ps1", root), "utf8"),
  ]);

  assert.match(manifest, /android:icon="@drawable\/ic_daymark_launcher"/);
  assert.match(manifest, /android:roundIcon="@drawable\/ic_daymark_launcher"/);
  assert.match(gradle, /versionName "1\.4\.22"/);
  assert.match(gradle, /def isReleaseRequested = gradle\.startParameter\.taskNames\.any/);
  assert.match(gradle, /if \(isReleaseRequested && !hasDaymarkSigning\)/);
  assert.match(gradle, /A Daymark release requires DAYMARK_SIGNING_STORE/);
  assert.match(gradle, /Debug signing is not valid for updates/);
  assert.match(gradle, /DAYMARK_GIT_COMMIT/);
  assert.match(gradle, /manifestPlaceholders = \[daymarkGitCommit:/);
  assert.doesNotMatch(gradle, /signingConfigs\.debug/);
  assert.match(manifest, /com\.michaelunkai\.daymark\.GIT_COMMIT/);
  assert.match(manifest, /\$\{daymarkGitCommit\}/);
  assert.match(releaseVerifier, /Missing \$name\. A release must use the original Daymark signing key/);
  assert.match(releaseVerifier, /JAVA_HOME is required to verify the release signer/);
  assert.match(releaseVerifier, /890ddcf80b412cf3145b9ce0841e0d857226022bef20ae637ef0d0a8b5358676/);
  assert.match(releaseVerifier, /does not match the installed Daymark signer/);
  assert.match(releaseVerifier, /exactly one signer/);
  assert.match(releaseVerifier, /GIT_COMMIT/);
  assert.match(releaseVerifier, /APK is not bound to expected Git commit/);
  assert.match(escrow, /param\(\)/);
  assert.doesNotMatch(escrow, /\[string\]\$ExpectedSigner/);
  assert.match(escrow, /Entry type:\\s\*PrivateKeyEntry/);
  assert.match(escrow, /schemaVersion = 2/);
  assert.match(escrow, /Signing backup could not be reopened/);
  assert.match(readiness, /Repository has tracked changes/);
  assert.match(readiness, /Daymark signing backups are not stored on separate drive roots/);
  assert.match(readiness, /Verify-DaymarkRelease\.ps1'\) -ApkPath \$ApkPath -ExpectedCommit \$ExpectedCommit/);
  assert.match(buildScript, /Protect-DaymarkSigningKey\.ps1/);
  assert.match(buildScript, /\$env:DAYMARK_GIT_COMMIT = \$ExpectedCommit/);
  assert.match(buildScript, /Test-DaymarkReleaseReadiness\.ps1/);
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
  assert.match(activity, /onPageCommitVisible[\s\S]*?hideLoading\(\)/);
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
  assert.match(shellStyles, /@media \(max-width: 720px\)[\s\S]*?--daymark-topbar-height:\s*156px/);
  assert.match(shellStyles, /\.topbar__controls\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4,\s*minmax\(34px,\s*1fr\)\)[\s\S]*?grid-template-rows:\s*44px 34px/);
  assert.match(shellStyles, /\.global-search\s*\{[\s\S]*?grid-column:\s*1\s*\/\s*-1[\s\S]*?grid-row:\s*1/);
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
