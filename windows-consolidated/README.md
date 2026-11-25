# Daymark consolidated Windows deployment

Sanitized copy of the live single-folder deployment. No session data, cookies,
DPAPI credential, sync keys, keys file, logs, or 195 MB binaries are included.

## Layout

- `tools/` — hidden supervisor, idempotent launcher, guard, local server
- `cli/` — local server CLI wrappers
- `skills/mark/scripts/` — dm-ops, dm, handoff helpers
- `gmenu/` — gdaymark restore wrapper
- `legacy/` — archived helper scripts
- `relay/` — relay source
- `dist/client/` — static web client
- `source-site/` — Android/site source, excluding data, binaries, and releases
- `docs/` — migration and deletion journals
- `setup/` — rewiring script

## Restore

1. Install the official Daymark Windows binaries into an empty folder.
2. Copy `tools`, `cli`, `skills`, `gmenu`, `legacy`, `relay`, `dist`, `i.ico`, and your own `data`, `UserData`, and `tools\cred` into that folder.
3. Replace every `REPLACE_WITH_LOCAL_SYNC_KEY` placeholder with the sync key from your local server data.
4. Run `setup\Install-Daymark-Consolidated.ps1 -Root <folder>` from an elevated PowerShell.
5. Verify `Invoke-RestMethod http://127.0.0.1:18780/api/agent/v1/health` returns `status: ok`.

The setup script writes the HKCU Run key, rewires the Daymark scheduled tasks,
sets the `daymark:` protocol and pinned shortcuts to pass
`--daymark-user-data-dir=<Root>\UserData`, and starts the hidden supervisor.
