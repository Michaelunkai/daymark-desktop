# Daymark Desktop

Daymark is a local, desktop-oriented task manager built with React and Vite.
It stores task state in the browser and provides focused task capture,
navigation, scheduling, reminders, search, and keyboard-driven workflows.

## Live website

Daymark is deployed through Codex Sites:

https://daymark-desktop.michaelovsky55555.chatgpt.site

## Android app

Download the installable Android package from the repository:

[Daymark Android 1.4.2 APK](android/releases/daymark-android-1.4.2.apk)

The Android shell targets Android 6.0+ and opens the same responsive Daymark
application used by Windows and mobile browsers.

The deployed application supports the root route and client-side workspace
routes, including:

https://daymark-desktop.michaelovsky55555.chatgpt.site/workspace/order

## Run locally

```powershell
npm install
npm run dev -- --host 127.0.0.1 --port 4173
```

Open `http://127.0.0.1:4173/` in a desktop browser.

## Verify

```powershell
npm run build
npx --yes tsx --test src\core\store.test.ts src\core\dates\dates.test.ts src\features\reminders\scheduler.test.ts
```

## Included behavior

- Inbox, Today, Upcoming, project, and label views
- Completed workspace with completion timestamps and one-click restore
- Task creation, completion, priority, local persistence, and reminders
- Natural-language due-date parsing and recurring scheduling helpers
- Calendar and Upcoming views for scheduled work
- Project create, edit, delete, and durable ordering controls
- Long-press reorder mode for projects, tasks, and notes, with accessible Move
  earlier, Move later, Escape, and Done controls
- Order workspace grouped with the main workspace navigation: Do now, Later,
  and After, with completion controls and drag/long-press movement
- Notes and Board task cards include direct completion and restore controls
- Diary entries include date navigation plus start-of-day, highlights,
  reflection, tomorrow, and free-notes sections
- Calendar day selection opens that date's agenda immediately and provides
  inline add-task access
- Persisted dark mode and application settings, including backup import/export
- Search, command palette, and keyboard navigation
- Responsive list and board task layouts for desktop and mobile screens

## Cross-device sync invariants

These rules are part of the product behavior and must remain true in every
future release:

- The website and Android app share a workspace only after using the private
  `daymark://sync/<22-character-pairing-code>` link from Settings.
- Android must persist the accepted pairing code and reuse it on ordinary
  launcher starts. Never silently generate a second Android-only workspace
  after a device has already been paired.
- Local edits are saved first, then pushed to `/api/sync/<pairing-code>`.
  Remote state is polled while the page is open and merged by entity
  `updatedAt` timestamps. Deletions must remain represented by sync
  tombstones so they cannot reappear on another device.
- The worker's `expectedRevision` is the revision currently stored in D1.
  A `409` is a normal concurrent-edit conflict: merge the remote state,
  increment the rebased revision, and retry. Do not remove conflict handling
  or replace it with last-write-wins whole-state replacement.
- Diary entries, notes, tasks, projects, order items, filters, labels,
  preferences, and deletion tombstones all travel through the same sync state.
  Do not add a new local-only persistence path for any user-editable data.
- Before publishing, run `npm run verify`, build the Android release, install
  it on an Android runtime, and test both Android-to-Windows and
  Windows-to-Android edits using one identical pairing code.
- Keep the Android release version, README download link, GitHub release
  asset, `main`, and the deployed Sites source revision aligned. A green local
  test or HTTP 200 alone is not deployment proof.

## Release verification

For each release, record the exact Git commit, Sites saved version/deployment,
Android version, APK SHA-256, and the browser/Android acceptance results here.
The current source changes are prepared for Android `1.4.2`; the final commit
and deployment identifiers are added after the GitHub and Sites release steps.

The required local gates are:

```powershell
npm run verify
$env:JAVA_HOME='C:\path\to\jdk17'
gradle --gradle-user-home .\work\gradle-user-home assembleRelease
```
