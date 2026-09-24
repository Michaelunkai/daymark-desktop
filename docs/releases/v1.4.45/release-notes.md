# Daymark Desktop 1.4.45

This Windows update adds a first-party command-line interface for the
documented Daymark AI API. The installer bundles `daymark.cmd` beside the
application; it needs no separate Node.js installation. The single-file
portable download launches the GUI but does not expose the CLI directly.

The CLI supports project, section, task, Order, diary, calendar, preference,
search, and generic resource commands; scoped reads and writes; JSON output;
idempotency keys; and explicit delete/undo. Windows stores an interactively
entered API key with current-user DPAPI protection. For a new PC, generate a
new key in Daymark Settings instead of copying the encrypted key from the old
machine. See the [Windows CLI setup and options guide](../../windows-cli.md).

The source update includes task-list pagination in the Sites worker and a
CLI that refuses to silently truncate a large workspace. The live Daymark
service must deploy that worker update for complete task enumeration. Until
then, a CLI read of more than 250 tasks reports `pagination_unavailable` rather
than presenting an incomplete list as complete. The Windows desktop itself
continues to use the live Daymark workspace.

Windows source, CLI tests, desktop packaging contract, the detached launcher,
and the packaged CLI were verified on Windows. The binaries are not
Authenticode-signed. Compare your download to the included
`Daymark-SHA256SUMS.txt` before running it. This release does not include a new
Android APK; the last verified original-signer Android download remains v1.4.36.
