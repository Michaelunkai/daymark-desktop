# Daymark consolidation — 2026-09-06

Daymark Windows 1.4.41 is running from `F:\backup\windowsapps\installed\daymark\Daymark.exe` / `Daymark Runtime.exe`. This is the version that was running and pinned before the move. The active profile is `daymark\UserData`.

## Verified behavior

- Opened the existing taskbar pinned shortcut through Windows Shell after gracefully closing the previous app process. New main process: 26084. This tests the pinned shortcut target; it is not a claim of a physical taskbar-button click.
- The taskbar and Start-menu shortcuts target the consolidated `Daymark.exe`, use its directory as working directory, and retain AppUserModelID `com.michaelunkai.daymark.windows`.
- The `daymark:` protocol points to the consolidated launcher. Removed the obsolete Daymark 1.0.0 uninstall registration whose old uninstaller no longer existed; its values are archived in Migration.
- The launcher selects the colocated `UserData` directory for both Chromium early storage and Daymark application storage, and detaches the app from the launching terminal. Six PowerShell 5 launcher tests passed, including profile selection, argument quoting, and removing inherited Electron/Node execution variables.
- All 75 original runtime files other than the deliberately rebuilt launcher match the archived original by SHA-256. Runtime version is 1.4.41.0.
- The saved workspace pairing reached the sync service successfully: 375 tasks, 8 projects, revision 3624. Its fingerprint matches the original profile. The session verifier needs the app closed because the live Chromium cookie database cannot be opened by SQLite on this machine.
- After reopening, the visible application displayed the populated workspace and `Device sync: up to date`. See `Migration\Daymark-final.png`.
- The app stayed alive after the launching command ended. Final duration and process evidence are in `Migration\Final-running-verification.json`.
- The old C: roaming profile and local installation were absent after reopening.

## Consolidated files

- All 1,210 supplied paths were checked. Six already belonged to the destination; 1,204 referred outside it. Only the four intentional exceptions below still exist outside it.
- All 210 planned move roots completed successfully. Two additional empty Daymark plugin roots were hash-verified and archived, and their stale plugin loading registrations were removed.
- Old releases, Android builds, projects, worktrees, recovery files, profiles, logs and backups are under `Archive\C` or `Archive\F`, retaining the original path after the drive letter.
- The primary Git repository and its five active worktrees have repaired paths, and all six HEADs resolve. User files and histories were preserved.
- The recovery shadow link was removed as a link only; its target metadata is archived. Its entire system-volume snapshot was not copied or deleted.
- Shared directories containing unrelated projects were retained; their identified Daymark items were moved individually.

## Explicit exceptions and verification limits

These four original paths remain outside the consolidated directory:

1. `C:\Users\micha\AppData\Roaming\Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Daymark.lnk` — required Windows pin, updated to F:.
2. `C:\Users\micha\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Daymark.lnk` — Windows shortcut, updated to F:.
3. `C:\Users\micha\.codex\memories\extensions\ad_hoc\notes\2026-08-09-135239-daymark-session-access.md`.
4. `C:\Users\micha\.codex\memories\skills\daymark-live-task-operations`.

The session's developer memory rule forbids directly moving or editing managed-memory originals; memory changes can only be submitted as update notes. Therefore the two managed-memory originals were not moved. They are not runtime dependencies of the Daymark application.

The final C:/F: name scan found exactly these four matching roots outside the destination. It encountered 35 unreadable entries and skipped traversal through 1,470 reparse points. This is evidence for the supplied path list and accessible file names, not a claim that every Windows history/database reference or protected filesystem location contains zero mentions.

## Docker Hub phase gate

Waiting for the user to push to Docker Hub and explicitly confirm the repository/tag. No `gdaymark` has been created in this phase, no Daymark image has been pushed by this task, and the consolidated directory has not been deleted. Restore-function implementation, a real missing-folder restore test, and final folder deletion come only after that confirmation.

The consolidated directory contains private workspace/session data and historical source/profile archives. Current-machine launch verification does not prove session portability to another Windows account or permanent server-side authorization. Those are separate checks for the restore phase.

Detailed evidence: `Migration\Move-journal.jsonl`, `Listed-path-audit.json`, `Final-drive-scan.json`, `Runtime-verification.json`, `Launcher-test-result.json`, `Session-verification.json`, and `Final-running-verification.json`.