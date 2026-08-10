# Daymark Desktop

Daymark is a local, desktop-oriented task manager built with React and Vite.
It stores task state in the browser and provides focused task capture,
navigation, scheduling, reminders, search, and keyboard-driven workflows.

## Live website

Daymark is deployed through Codex Sites:

https://daymark-desktop.michaelovsky55555.chatgpt.site

## Android app

Download the installable Android package from the repository:

[Daymark Android 1.4.9 APK](https://github.com/Michaelunkai/daymark-desktop/releases/download/v1.4.9/daymark-android-1.4.9.apk)

The Android shell targets Android 6.0+ and opens the same responsive Daymark
application used by Windows and mobile browsers.

The latest published package is `1.4.9`, matching the directly verified device
package `com.michaelunkai.daymark` version code `13`, version name `1.4.9`.
The older `1.4.6` release remains documented below as historical provenance.

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

## Daymark AI API

Daymark exposes a durable, authenticated OpenAPI integration for Codex and
compatible AI clients. It does not depend on the legacy in-page `DaymarkAI`
browser bridge, so a fresh client can discover and reconnect after a browser,
Codex, or device session restart.

1. In Daymark **Settings**, generate a **Daymark AI key** and copy the secret
   when it is shown. Daymark stores only its SHA-256 hash; the secret cannot be
   shown again after it is hidden.
2. Start a fresh client from the public discovery document:
   `https://daymark-desktop.michaelovsky55555.chatgpt.site/.well-known/daymark-ai.json`.
3. Check `/api/agent/v1/health` and `/api/agent/v1/ready`, then load the
   versioned OpenAPI document at `/api/agent/v1/openapi.json`. The
   machine-readable connector configuration is `/daymark-ai-client.json`; the
   dependency-free connector scaffold is `/daymark-ai-connector.mjs`.
4. Configure the generated secret as a Bearer token. Do not send the pairing
   code to AI clients. Revoke a lost or expired key in Settings and generate a
   replacement.

The full persisted user-level surface covers projects, sections, labels, saved
filters, tasks, scheduled/calendar tasks, notes, diary entries, Order items,
safe preferences, and search. Writes require an `Idempotency-Key` and use the
current D1 workspace revision; a `409` is a conflict signal, not permission to
blindly repeat a mutation with a new key. Reuse the same idempotency key after a
transport failure or retryable conflict.

Task, project, note, diary, and Order-item deletion are deliberately guarded:
the request must include `{"confirm":"delete"}` and returns a short-lived undo
token. Undo only succeeds when no later workspace revision has intervened.

The API intentionally excludes raw sync state, pairing codes, backups,
database administration, account administration, activity/comments, and
reminders. Reminders are local presentational scheduler data in this product,
not a durable shared entity. Scheduled tasks are available through the
calendar endpoint instead.

Production uses the existing D1 binding. The Worker creates its four
integration tables on first authenticated use, so this release requires no
separate application secret or manual database migration. A D1 binding failure
is exposed by `/api/agent/v1/ready`; a network, hosting, device, or credential
outage remains outside the application’s control.

Existing task-assistant keys remain valid with their original task-only scopes.
Generate a new Daymark AI key when a client needs the expanded capability set.

The legacy `DaymarkAI` browser object is retained only for local compatibility.
It is not an authenticated remote API and is never required for new clients.

## Release verification

For each release, record the exact Git commit, Sites saved version/deployment,
Android version, APK SHA-256, and the browser/Android acceptance results here.
Release `1.4.9` evidence from August 10, 2026:

- Android release source commit: `60e1273c4e2a1e1f9a6d1b338b065cecbecbdcd9`.
- Release-preparation GitHub `main` commit:
  `d8bf81913354f7a0789b2330664d371a13b31036`.
- GitHub latest published release: `v1.4.9`, targeting the current `main`
  reconciliation commit above.
- Last verified Sites saved version: `19`
  (`appgprj_6a72433e80108191b2c3936efd51e00a~appgver_713d42d4e4c48191bb4cc27c69e19093`).
- Last verified Sites production deployment:
  `appgdep_6a728c20c07c819198dbf9fd54591a21`.
- Production URL: `https://daymark-desktop.michaelovsky55555.chatgpt.site`.
- APK: `android/releases/daymark-android-1.4.9.apk`.
- APK SHA-256:
- `EBCBB1F4415EAF547C771DFD10D5177EDAB1415C2D6FF0C39B0F37A9DFCCADF2`.
- The tracked `1.4.9` APK matches the published GitHub release asset
  byte-for-byte.
- APK metadata: package `com.michaelunkai.daymark`, version code `13`,
  version name `1.4.9`, launch activity
  `com.michaelunkai.daymark.MainActivity`.
- `npm run verify` passed, including the production build and Sites artifact
  checks.
- Visible production acceptance passed for note completion controls, Workspace
  Order with Do now/Later/After, the multi-section Diary, calendar day
  selection with task agenda and Add task, and a clean browser console.
- Direct wireless ADB verification reported hardware serial `R5CY610XJGV`,
  model `SM-S938B`, package `com.michaelunkai.daymark`, version code `13`,
  version name `1.4.9`, and the expected launcher activity. The device was
  reached through the current mDNS endpoint `192.168.1.124:41615`; no Android
  app data was reset or changed.

Historical `1.4.6` provenance remains available in Git history and prior
release records; it is no longer the download target.

The required local gates are:

```powershell
npm run verify
$env:JAVA_HOME='C:\path\to\jdk17'
gradle --gradle-user-home .\work\gradle-user-home assembleRelease
```
