import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("Android release exposes the shared responsive app with the premium launcher icon", async () => {
  const [manifest, gradle, activity, icon, shellStyles, appSource, commandStyles, searchStyles, mainSource, releaseVerifier, escrow, readiness, buildScript, taskEditor, taskEditorStyles, orderWorkspace, orderStyles, calendarGrid, upcomingCalendar, upcomingCalendarStyles, datePickerStyles, datePicker, quickCapture, signingResolver, installer] = await Promise.all([
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
    readFile(new URL("./src/features/task-editor/TaskEditor.tsx", root), "utf8"),
    readFile(new URL("./src/features/task-editor/task-editor.css", root), "utf8"),
    readFile(new URL("./src/features/order/OrderWorkspace.jsx", root), "utf8"),
    readFile(new URL("./src/features/order/order.css", root), "utf8"),
    readFile(new URL("./src/features/calendar/calendar-grid.ts", root), "utf8"),
    readFile(new URL("./src/features/calendar/UpcomingCalendar.tsx", root), "utf8"),
    readFile(new URL("./src/features/calendar/upcoming-calendar.css", root), "utf8"),
    readFile(new URL("./src/features/calendar/date-picker.css", root), "utf8"),
    readFile(new URL("./src/features/calendar/DatePicker.tsx", root), "utf8"),
    readFile(new URL("./src/features/capture/QuickCaptureSheet.jsx", root), "utf8"),
    readFile(new URL("./android/DaymarkSigningResolver.ps1", root), "utf8"),
    readFile(new URL("./android/Install-DaymarkRelease.ps1", root), "utf8"),
  ]);

  assert.match(manifest, /android:icon="@drawable\/ic_daymark_launcher"/);
  assert.match(manifest, /android:roundIcon="@drawable\/ic_daymark_launcher"/);
  assert.match(gradle, /versionCode 34/);
  assert.match(gradle, /versionName "1\.4\.44"/);
  assert.match(gradle, /androidComponents[\s\S]*?withBuildType\("release"\)/);
  assert.match(gradle, /verifyDaymarkReleaseInputs/);
  assert.match(gradle, /A Daymark release requires DAYMARK_SIGNING_STORE/);
  assert.doesNotMatch(gradle, /startParameter\.taskNames/);
  assert.match(gradle, /Debug signing is not valid for updates/);
  assert.match(gradle, /DAYMARK_GIT_COMMIT/);
  assert.match(gradle, /daymarkWebProvenanceFile/);
  assert.match(gradle, /sourceCommit/);
  assert.match(gradle, /filesSha256/);
  assert.match(gradle, /manifestPlaceholders = \[daymarkGitCommit:/);
  assert.doesNotMatch(gradle, /signingConfigs\.debug/);
  assert.match(manifest, /com\.michaelunkai\.daymark\.GIT_COMMIT/);
  assert.match(manifest, /\$\{daymarkGitCommit\}/);
  assert.match(releaseVerifier, /890ddcf80b412cf3145b9ce0841e0d857226022bef20ae637ef0d0a8b5358676/);
  assert.match(releaseVerifier, /does not match the installed Daymark signer/);
  assert.match(releaseVerifier, /exactly one leaf signer/);
  assert.match(releaseVerifier, /assets\/daymark\/\.daymark-web-provenance\.json/);
  assert.match(releaseVerifier, /web asset manifest hash/);
  assert.match(releaseVerifier, /GIT_COMMIT/);
  assert.match(releaseVerifier, /APK is not bound to expected Git commit/);
  assert.match(releaseVerifier, /\$expectedVersionCode = '34'/);
  assert.match(releaseVerifier, /\$expectedVersionName = '1\.4\.44'/);
  assert.match(escrow, /param\(\)/);
  assert.doesNotMatch(escrow, /\[string\]\$ExpectedSigner/);
  assert.match(signingResolver, /Entry type:\\s\*PrivateKeyEntry/);
  assert.match(escrow, /schemaVersion = 3/);
  assert.match(signingResolver, /leafSection/);
  assert.match(escrow, /Clear-DaymarkSigningEnvironment/);
  assert.match(signingResolver, /leafSection/);
  assert.match(signingResolver, /leafFingerprint/);
  assert.match(signingResolver, /Clear-DaymarkSigningEnvironment/);
  assert.match(readiness, /Repository has changes/);
  assert.match(readiness, /Resolve-DaymarkSigningEnvironment/);
  assert.doesNotMatch(readiness, /Require-EnvironmentValue 'DAYMARK_SIGNING_STORE_PASSWORD'/);
  assert.match(readiness, /Daymark signing backups are not stored on separate drive roots/);
  assert.match(readiness, /Verify-DaymarkRelease\.ps1/);
  assert.match(readiness, /-ApkPath \$ApkPath/);
  assert.match(readiness, /-ExpectedCommit \$ExpectedCommit/);
  assert.match(buildScript, /Protect-DaymarkSigningKey\.ps1/);
  assert.match(buildScript, /npm\.cmd'[\s\S]*?run build/);
  assert.match(buildScript, /Write-DaymarkWebProvenance/);
  assert.match(buildScript, /\$env:DAYMARK_GIT_COMMIT = \$ExpectedCommit/);
  assert.match(buildScript, /\$env:DAYMARK_WEB_CLIENT_PREBUILT = '1'/);
  assert.match(buildScript, /Clear-DaymarkReleaseEnvironment/);
  assert.match(buildScript, /Test-DaymarkReleaseReadiness\.ps1/);
  assert.match(installer, /Verify-DaymarkRelease\.ps1/);
  assert.match(installer, /exactly one installed Daymark APK path/);
  assert.match(installer, /application data identity changed/);
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
  assert.match(activity, /onPageCommitVisible\(WebView view, String url\) \{\s*if \(view == webView && !loadingFailed\) \{\s*scheduleAppReadinessCheck\(view\);/);
  assert.doesNotMatch(activity, /Loading Daymark/);
  assert.match(activity, /Daymark could not load/);
  assert.match(activity, /retryCurrentPage/);
  assert.match(activity, /LOAD_CACHE_ELSE_NETWORK/);
  assert.match(activity, /setOffscreenPreRaster\(true\)/);
  assert.match(activity, /NATIVE_RELEASE = "1\.4\.44"/);
  assert.match(activity, /STARTUP_CREATED_MARKER/);
  assert.match(activity, /STARTUP_READY_MARKER/);
  assert.match(activity, /appendQueryParameter\(STARTUP_MARKER_PARAM, STARTUP_CREATED_MARKER\)/);
  assert.match(activity, /withLaunchMarker/);
  assert.match(activity, /resumeRestoredDocument/);
  assert.match(activity, /sameLogicalUrl/);
  assert.match(activity, /logicalUrl/);
  assert.match(activity, /onAppReady/);
  assert.match(activity, /verifyAppRendered/);
  assert.match(activity, /CONTENT_READY_TIMEOUT_MS/);
  assert.match(activity, /scheduleContentTimeout/);
  assert.match(activity, /root\.getAttribute\('data-daymark-ready'\)==='true'/);
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
  assert.match(taskEditor, />\s*Move to date\s*</);
  assert.match(taskEditor, />\s*Copy to date\s*</);
  assert.match(taskEditor, /<DatePicker[\s\S]*?onChange=\{\(date\) => finishDateTransfer\(date\)\}/);
  assert.match(orderWorkspace, />Move to date<\/button>/);
  assert.match(orderWorkspace, />Copy to date<\/button>/);
  assert.match(orderWorkspace, /<DatePicker[\s\S]*?onChange=\{transferOrderItemToDate\}/);
  assert.match(calendarGrid, /Array\.from\(\{ length: 42 \}/);
  assert.match(upcomingCalendar, /return Array\.from\(\{ length: 42 \},/);
  assert.match(upcomingCalendar, /if \(event\.key === "Enter" \|\| event\.key === " "\) \{\s*event\.preventDefault\(\)\s*selectDate\(date\)\s*\}/);
  assert.doesNotMatch(upcomingCalendar, /if \(event\.key === "Enter" \|\| event\.key === " "\) \{[\s\S]*?onTaskAdd\?\.\(date\)/);
  assert.match(upcomingCalendar, /className="upcoming-calendar__viewport"[\s\S]*?role="region"[\s\S]*?tabIndex=\{0\}/);
  assert.match(upcomingCalendarStyles, /\.upcoming-calendar__viewport\s*\{[\s\S]*?overflow-x:\s*auto[\s\S]*?-webkit-overflow-scrolling:\s*touch[\s\S]*?touch-action:\s*pan-x pan-y/);
  assert.match(upcomingCalendarStyles, /@media \(max-width: 620px\)[\s\S]*?\.upcoming-calendar__surface\s*\{[\s\S]*?width:\s*100%[\s\S]*?min-width:\s*0/);
  assert.match(upcomingCalendarStyles, /@media \(max-width: 620px\)[\s\S]*?\.upcoming-calendar__viewport\s*\{[\s\S]*?overflow-x:\s*hidden[\s\S]*?touch-action:\s*pan-y/);
  assert.match(upcomingCalendarStyles, /@media \(max-width: 620px\)[\s\S]*?\.upcoming-calendar__day-number\s*\{[\s\S]*?width:\s*44px[\s\S]*?min-height:\s*44px[\s\S]*?height:\s*44px/);
  assert.match(upcomingCalendarStyles, /@media \(max-width: 620px\)[\s\S]*?\.upcoming-calendar__day-tasks\s*\{[\s\S]*?display:\s*none/);
  assert.match(upcomingCalendarStyles, /@media \(max-width: 620px\)[\s\S]*?\.upcoming-calendar__nav-button,[\s\S]*?\.upcoming-calendar__add-button\s*\{[\s\S]*?width:\s*44px[\s\S]*?min-height:\s*44px/);
  assert.match(upcomingCalendarStyles, /@media \(max-width: 620px\)[\s\S]*?\.upcoming-calendar__view-button\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(upcomingCalendarStyles, /@media \(max-width: 620px\)[\s\S]*?\.upcoming-agenda__check,[\s\S]*?\.upcoming-agenda__edit\s*\{[\s\S]*?width:\s*44px[\s\S]*?min-height:\s*44px[\s\S]*?height:\s*44px/);
  assert.match(upcomingCalendarStyles, /@media \(pointer: coarse\)[\s\S]*?\.upcoming-calendar__today-button,[\s\S]*?\.upcoming-calendar__view-button,[\s\S]*?\.upcoming-calendar__add-button\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(upcomingCalendarStyles, /@media \(max-width: 360px\)[\s\S]*?\.upcoming-calendar__surface\s*\{[\s\S]*?min-width:\s*0/);
  assert.doesNotMatch(upcomingCalendarStyles, /@media \(max-width: 360px\)[\s\S]*?\.upcoming-calendar__surface\s*\{[\s\S]*?min-width:\s*308px/);
  assert.match(upcomingCalendarStyles, /@media \(max-width: 360px\)[\s\S]*?\.upcoming-calendar__day-number\s*\{[\s\S]*?width:\s*min\(40px,\s*100%\)[\s\S]*?min-width:\s*0[\s\S]*?min-height:\s*40px[\s\S]*?height:\s*40px/);
  assert.match(upcomingCalendar, /const nextDate = navigateUpcomingRange\(mode, cursor, amount\) as LocalDate[\s\S]*?setCursor\(nextDate\)[\s\S]*?onDateSelect\?\.\(nextDate\)/);
  assert.match(quickCapture, /className="quick-capture"\s+onPointerDown=/);
  assert.match(datePickerStyles, /\.date-picker__quick-actions button\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(datePickerStyles, /\.date-picker__entry input\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(datePickerStyles, /\.date-picker__header button\s*\{[\s\S]*?height:\s*44px[\s\S]*?width:\s*44px/);
  assert.match(datePickerStyles, /\.date-picker__day\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(datePickerStyles, /@media \(max-width: 620px\)[\s\S]*?\.date-picker\s*\{[\s\S]*?width:\s*100%[\s\S]*?max-width:\s*none/);
  assert.match(datePicker, /const target = shiftMonth\(date, event\.shiftKey \? -12 : -1\)\s*setVisibleMonth\(target\)\s*setPendingFocus\(target\)/);
  assert.match(datePicker, /const target = shiftMonth\(date, event\.shiftKey \? 12 : 1\)\s*setVisibleMonth\(target\)\s*setPendingFocus\(target\)/);
  assert.match(taskEditorStyles, /\.task-editor__content\s*\{[\s\S]*?overflow-y:\s*auto[\s\S]*?-webkit-overflow-scrolling:\s*touch[\s\S]*?touch-action:\s*pan-y/);
  assert.match(taskEditorStyles, /\.task-editor__date-transfer \.date-picker__quick-actions button\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(taskEditorStyles, /@media \(max-width: 680px\)[\s\S]*?\.task-editor__date-transfer \.date-picker__day\s*\{[\s\S]*?height:\s*44px[\s\S]*?min-height:\s*44px/);
  assert.match(orderStyles, /\.order-editor\s*\{[\s\S]*?overflow-y:\s*auto[\s\S]*?touch-action:\s*pan-y[\s\S]*?-webkit-overflow-scrolling:\s*touch/);
  assert.match(orderStyles, /@media \(max-width: 720px\)[\s\S]*?\.order-editor__calendar-transfer \.date-picker__day\s*\{[\s\S]*?height:\s*44px[\s\S]*?min-height:\s*44px/);
  assert.match(orderStyles, /\.order-editor__calendar-transfer \.date-picker__quick-actions button\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(orderStyles, /\.order-editor__date-shortcuts button\s*\{[\s\S]*?min-height:\s*44px/);
});

test("Android reuses an already restored offline-capable document before loading again", async () => {
  const activity = await readFile(
    new URL("./android/app/src/main/java/com/michaelunkai/daymark/MainActivity.java", root),
    "utf8",
  );

  assert.match(
    activity,
    /if \(savedInstanceState == null\) \{\s*loadDaymarkUrl\(urlForIntent\(getIntent\(\)\)\);\s*\} else if \(webView\.restoreState\(savedInstanceState\) == null\) \{\s*loadDaymarkUrl\(urlForIntent\(getIntent\(\)\)\);\s*\} else \{\s*resumeRestoredDocument\(urlForIntent\(getIntent\(\)\)\);/,
  );
  assert.match(
    activity,
    /private void resumeRestoredDocument\(String requestedUrl\) \{[\s\S]*?String restoredUrl = webView == null \? null : webView\.getUrl\(\);[\s\S]*?if \(restoredUrl == null \|\| !sameLogicalUrl\(restoredUrl, requestedUrl\)\) \{[\s\S]*?loadDaymarkUrl\(requestedUrl\);[\s\S]*?return;[\s\S]*?\}[\s\S]*?lastRequestedUrl = requestedUrl;[\s\S]*?hasVisibleDocument = true;[\s\S]*?loadingFailed = false;[\s\S]*?hideLoading\(\);[\s\S]*?scheduleAppReadinessCheck\(webView\);/,
  );
  assert.match(
    activity,
    /private boolean sameLogicalUrl\(String first, String second\) \{\s*return logicalUrl\(first\)\.equals\(logicalUrl\(second\)\);\s*\}/,
  );
  assert.match(
    activity,
    /private String logicalUrl\(String value\) \{[\s\S]*?if \("native"\.equals\(name\) \|\| STARTUP_MARKER_PARAM\.equals\(name\)\) continue;[\s\S]*?builder\.appendQueryParameter\(name, parameterValue\);/,
  );
});

test("Android packages and serves the built client before a network response is needed", async () => {
  const [gradle, activity] = await Promise.all([
    readFile(new URL("./android/app/build.gradle", root), "utf8"),
    readFile(new URL("./android/app/src/main/java/com/michaelunkai/daymark/MainActivity.java", root), "utf8"),
  ]);

  assert.match(gradle, /def daymarkWebClientDir = file\("\.\.\/\.\.\/dist\/client"\)/);
  assert.match(gradle, /tasks\.register\("packageDaymarkWebClient", Sync\)/);
  assert.match(gradle, /Android packaging requires a built Daymark client/);
  assert.match(gradle, /assets\.srcDir\(generatedDaymarkWebAssetsDir\)/);
  assert.match(gradle, /dependsOn\(tasks\.named\("packageDaymarkWebClient"\)\)/);
  assert.match(activity, /private static final String START_HOST/);
  assert.match(activity, /private static final String BUNDLED_ASSET_DIRECTORY = "daymark\/";/);
  assert.match(
    activity,
    /private WebResourceResponse bundledDaymarkResponse\(WebResourceRequest request\) \{[\s\S]*?!START_HOST\.equalsIgnoreCase\(request\.getUrl\(\)\.getHost\(\)\)[\s\S]*?if \(path\.contains\("\.\."\)\) \{[\s\S]*?return null;/,
  );
  assert.match(
    activity,
    /private WebResourceResponse assetResponse\(String path\) throws IOException \{[\s\S]*?getAssets\(\)\.open\([\s\S]*?BUNDLED_ASSET_DIRECTORY \+ path/,
  );
  assert.match(
    activity,
    /public WebResourceResponse shouldInterceptRequest\([\s\S]*?WebResourceResponse bundledResponse = bundledDaymarkResponse\(request\);[\s\S]*?super\.shouldInterceptRequest\(view, request\)/,
  );
});

test("Android reminders sync their definitions and schedule native alerts across restarts", async () => {
  const [manifest, activity, scheduler, receiver, bootReceiver, reminderStore, reminderPlanner, appSource] = await Promise.all([
    readFile(new URL("./android/app/src/main/AndroidManifest.xml", root), "utf8"),
    readFile(new URL("./android/app/src/main/java/com/michaelunkai/daymark/MainActivity.java", root), "utf8"),
    readFile(new URL("./android/app/src/main/java/com/michaelunkai/daymark/ReminderScheduler.java", root), "utf8"),
    readFile(new URL("./android/app/src/main/java/com/michaelunkai/daymark/ReminderAlarmReceiver.java", root), "utf8"),
    readFile(new URL("./android/app/src/main/java/com/michaelunkai/daymark/ReminderBootReceiver.java", root), "utf8"),
    readFile(new URL("./src/features/reminders/local-reminders.ts", root), "utf8"),
    readFile(new URL("./src/features/reminders/ReminderPlanner.jsx", root), "utf8"),
    readFile(new URL("./src/App.jsx", root), "utf8"),
  ]);
  assert.match(manifest, /POST_NOTIFICATIONS/);
  assert.match(manifest, /SCHEDULE_EXACT_ALARM/);
  assert.match(manifest, /RECEIVE_BOOT_COMPLETED/);
  assert.match(manifest, /ReminderAlarmReceiver/);
  assert.match(manifest, /ReminderAlarmReceiver"[\s\S]*?android:directBootAware="true"/);
  assert.match(manifest, /ReminderBootReceiver/);
  assert.match(manifest, /BOOT_COMPLETED/);
  assert.match(manifest, /LOCKED_BOOT_COMPLETED/);
  assert.match(manifest, /SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED/);
  assert.match(manifest, /ReminderBootReceiver"[\s\S]*?android:directBootAware="true"/);
  assert.match(activity, /syncReminders/);
  assert.match(activity, /getNotificationStatus/);
  assert.match(activity, /requestNotificationPermission/);
  assert.match(activity, /openExactAlarmSettings/);
  assert.match(activity, /openReminderNotificationSettings/);
  assert.match(activity, /testReminderSound/);
  assert.match(activity, /public String syncReminders\(String schedules\)/);
  assert.match(activity, /return ReminderScheduler\.replace\(MainActivity\.this, schedules\)/);
  assert.match(activity, /private boolean reminderRescheduledForActivity/);
  assert.match(activity, /protected void onResume\(\)[\s\S]*?if \(!reminderRescheduledForActivity\)[\s\S]*?ReminderScheduler\.reschedule\(this\)/);
  assert.match(activity, /emitAcceptanceEvent\(STARTUP_CREATED_MARKER\)/);
  assert.match(activity, /emitAcceptanceEvent\(STARTUP_READY_MARKER\)/);
  assert.match(activity, /hasVisibleDocument && sameLogicalUrl\(requestedUrl, lastRequestedUrl\)/);
  assert.match(scheduler, /setExactAndAllowWhileIdle/);
  assert.match(scheduler, /setAndAllowWhileIdle/);
  assert.match(scheduler, /JSONArray next = parse\(rawSchedules\);\s*if \(next == null \|\| !validSchedules\(next\)\) \{/);
  assert.match(scheduler, /private static boolean validSchedules\(JSONArray schedules\)/);
  assert.match(scheduler, /createDeviceProtectedStorageContext/);
  assert.match(scheduler, /\.commit\(\)/);
  assert.match(scheduler, /DELIVERED_IDS/);
  assert.match(scheduler, /REQUEST_CODES/);
  assert.match(scheduler, /private static int requestCode\(Context context, String scheduleId\)/);
  assert.match(scheduler, /setData\(reminderUri/);
  assert.match(scheduler, /fingerprint/);
  assert.match(scheduler, /SHA-256/);
  assert.match(scheduler, /pruneDeliveredLedger/);
  assert.match(scheduler, /HashSet<String>/);
  assert.match(scheduler, /MISSED_ALERT_SPACING_MS/);
  assert.match(scheduler, /MAX_OVERDUE_CATCH_UP/);
  assert.match(scheduler, /NOTIFICATION_RETRY_DELAY_MS/);
  assert.match(scheduler, /MAX_NOTIFICATION_RETRIES/);
  assert.match(scheduler, /retryCount/);
  assert.match(scheduler, /SecurityException/);
  assert.match(scheduler, /exactAlarmStatus/);
  assert.match(scheduler, /ACTION_RECONCILE/);
  assert.match(scheduler, /scheduleReconcile/);
  assert.match(scheduler, /catchUpPending/);
  assert.match(scheduler, /alarms\.cancel\(pending\)/);
  assert.match(scheduler, /if \(canScheduleExactAlarms\(context\)\)[\s\S]*?setExactAndAllowWhileIdle[\s\S]*?setAndAllowWhileIdle/);
  assert.match(scheduler, /CHANNEL_VERSION = "v3"/);
  assert.match(scheduler, /daymark\.reminder\./);
  assert.match(scheduler, /daymark_reminder_soft/);
  assert.match(scheduler, /daymark_reminder_alert/);
  assert.match(scheduler, /daymark_reminder_alarm/);
  assert.match(scheduler, /AudioAttributes\.USAGE_ALARM/);
  assert.match(scheduler, /areNotificationsEnabled/);
  assert.match(scheduler, /hasAudibleChannels/);
  assert.match(scheduler, /notificationReady/);
  assert.match(scheduler, /defer/);
  assert.match(scheduler, /ACTION_REMINDER_ACCEPTED/);
  assert.match(scheduler, /sendBroadcast/);
  assert.match(receiver, /Alert /);
  assert.match(receiver, /postTest/);
  assert.match(receiver, /ReminderScheduler\.isScheduled/);
  assert.match(receiver, /ReminderScheduler\.notificationReady/);
  assert.match(receiver, /ReminderScheduler\.defer/);
  assert.match(receiver, /if \(!post\(context, sound, content/);
  assert.match(receiver, /ReminderScheduler\.markDelivered/);
  assert.match(receiver, /ReminderScheduler\.emitAcceptance/);
  assert.match(receiver, /ReminderScheduler\.soundUri/);
  assert.match(scheduler, /static String id\(Intent intent\)/);
  assert.match(scheduler, /static String fingerprint\(Intent intent\)/);
  assert.match(receiver, /post\(context, sound, content, ReminderScheduler\.details\(intent\), scheduleId\)/);
  const readinessIndex = receiver.indexOf("notificationReady");
  const postIndex = receiver.indexOf("if (!post(", readinessIndex);
  const normalDeliveryLedgerIndex = receiver.indexOf("markDelivered", postIndex);
  assert.ok(
    readinessIndex >= 0
      && postIndex > readinessIndex
      && normalDeliveryLedgerIndex > postIndex,
    "normal delivery must verify readiness, post, then consume the durable ledger",
  );
  assert.match(receiver, /isAlreadyPosted\(context,\s*scheduleId\)[\s\S]*?markDelivered/);
  assert.match(bootReceiver, /ReminderScheduler\.reschedule/);
  assert.match(reminderStore, /daymark\.local-reminders\.v1/);
  assert.match(reminderStore, /toNativeReminderSchedules/);
  assert.match(reminderPlanner, /Test \$\{offset\.sound\} sound/);
  assert.match(reminderPlanner, /notificationStatus === 'desktop-ready'/);
  assert.match(
    reminderPlanner,
    /!\['ready', 'desktop-ready', 'browser', 'schedule-failed', 'storage-error'\]\.includes\(notificationStatus\)/,
  );
  assert.match(appSource, /id: 'reminders', label: 'Reminders', icon: 'clock'/);
  assert.match(appSource, /route === 'reminders' \? \(\s*<ReminderPlanner/);
  assert.match(appSource, /state\.reminders/);
  assert.match(appSource, /type:\s*['"]reminder\.upsert['"]/);
  assert.match(appSource, /type:\s*['"]reminder\.delete['"]/);
  assert.doesNotMatch(appSource, /useState\(\(\)\s*=>\s*loadLocalReminders\(\)\)/);
  assert.doesNotMatch(appSource, /aria-label="Diary tabs"/);
  assert.doesNotMatch(reminderStore, /core\/sync/);
});

test("Daymark reminder sounds are moderate twelve-second custom patterns", async () => {
  const sounds = await Promise.all([
    readFile(new URL("./android/app/src/main/res/raw/daymark_reminder_soft.wav", root)),
    readFile(new URL("./android/app/src/main/res/raw/daymark_reminder_alert.wav", root)),
    readFile(new URL("./android/app/src/main/res/raw/daymark_reminder_alarm.wav", root)),
  ]);

  for (const sound of sounds) {
    assert.equal(sound.toString("ascii", 0, 4), "RIFF");
    assert.equal(sound.toString("ascii", 8, 12), "WAVE");
    assert.equal(sound.readUInt16LE(22), 1);
    assert.equal(sound.readUInt16LE(34), 16);
    const sampleRate = sound.readUInt32LE(24);
    const durationSeconds = sound.readUInt32LE(40) / (sampleRate * 2);
    assert.equal(durationSeconds, 12);

    let peak = 0;
    for (let offset = 44; offset < sound.length; offset += 2) {
      peak = Math.max(peak, Math.abs(sound.readInt16LE(offset)));
    }
    assert.ok(peak >= 8_000 && peak <= 21_000);
  }
});
