# Daymark Desktop

Daymark is a local, desktop-oriented task manager built with React and Vite.
It stores task state in the browser and provides focused task capture,
navigation, scheduling, reminders, search, and keyboard-driven workflows.

## Live website

Daymark is deployed through Codex Sites:

https://daymark-desktop.michaelovsky55555.chatgpt.site

## Android app

Download the installable Android package from the repository:

[Daymark Android 1.0.0 APK](android/releases/daymark-android-1.0.0.apk)

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
- Long-press reorder mode for projects and tasks, with accessible Move earlier,
  Move later, Escape, and Done controls
- Order workspace for before, now, later, and after planning
- Persisted dark mode and application settings, including backup import/export
- Search, command palette, and keyboard navigation
- Responsive list and board task layouts for desktop and mobile screens

## Release verification

The current Sites release was built and verified from commit
`a5052546aa6619837c97ae545b0efecf9f9cc88f` on branch
`codex/daymark-long-press-reorder`.

Before release, the project passed `npm run verify`, which includes the core
and feature tests, the long-press reorder tests, production build, and Sites
worker artifact checks. The public root, `/workspace/order`, and the emitted
JavaScript and CSS assets were independently verified with HTTP 200 responses.
