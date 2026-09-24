# Daymark Windows CLI: install and use on a new PC

The `daymark` command talks to the live Daymark AI API. It does not import or
replace your workspace data. The `1.4.45` Windows **installer** bundles the CLI
and its runtime; the single-file portable app is for launching the GUI and does
not provide a directly accessible CLI command.

## Install on Windows

1. Download the [v1.4.45 Windows installer](https://github.com/Michaelunkai/daymark-desktop/releases/tag/v1.4.45)
   from this repository's Releases page. Compare its SHA-256 with
   `Daymark-SHA256SUMS.txt` on that release before running it. The binaries are
   currently not Authenticode-signed.
2. Run the installer, launch Daymark, and sign in/pair with your existing
   workspace through the normal app UI. Do not copy the old PC's DPAPI
   credential or local app-data directory to establish CLI access.
3. In Daymark **Settings → Daymark AI**, create a new key with the scopes needed
   for your intended commands. Read-only keys cannot create, complete, edit,
   or delete records. Keep the key private; it is shown when generated.
4. Open PowerShell and run the command using the actual installation directory.
   The installer may use a per-user directory or a directory you chose:

   ```powershell
   $DaymarkCli = Join-Path $env:LOCALAPPDATA 'Programs\daymark\daymark.cmd'
   if (-not (Test-Path -LiteralPath $DaymarkCli)) {
     $DaymarkCli = 'C:\Program Files\Daymark\daymark.cmd'
   }
   if (-not (Test-Path -LiteralPath $DaymarkCli)) {
     throw 'Locate daymark.cmd in the installation directory you selected.'
   }
   & $DaymarkCli auth login
   & $DaymarkCli doctor --json
   & $DaymarkCli projects
   ```

   If you chose a custom installation directory, set `$DaymarkCli` to its full
   `daymark.cmd` path instead.
   For a different user profile or machine, generate a **new** key; the saved
   credential is encrypted with Windows DPAPI for the current user and cannot
   simply be copied between PCs. `auth login` opens a hidden-key prompt and
   saves the credential at `%APPDATA%\Daymark\cli\credential.dpapi`.

For a convenient `daymark` command in future terminals, add the Daymark
installation directory to your **user** `PATH` through Windows Environment
Variables, then reopen PowerShell and run `daymark doctor --json`. Do not add
the executable file itself to `PATH`; add its containing directory.

### Source/Node.js option

Install a current Node.js version, clone this repository, run `npm install`,
then use `node cli/daymark.mjs help` from the repository root. `npm link` in
the repository creates a global `daymark` command for that Node installation.
The source option still needs a live Daymark AI key. Check that the target
service is your intended workspace before running write commands.

## Authentication and endpoint

- `daymark auth login` prompts for a key and stores it encrypted on Windows.
- `daymark auth status` reports where the key is expected, not the key itself.
- `DAYMARK_AI_TOKEN` overrides the saved key for process-scoped automation.
  Do not put it in a command argument, committed script, or shared log.
- `DAYMARK_API_URL` optionally selects a Daymark API origin. The default is
  the official production site shown in the main README. Set this only for a
  trusted Daymark server; it receives your bearer key.
- `daymark doctor --json` checks health, readiness, and available API
  capabilities. Its success does not grant write access: the generated key's
  scopes determine which changes are allowed.

## Commands and options

Run `daymark help` for the command summary. Use `--json` with any data command
for machine-readable output. Names containing spaces should be quoted.

| Purpose | Command |
| --- | --- |
| Browse projects and sections | `daymark projects`; `daymark project "Project name" --section "Section name"` |
| Browse tasks | `daymark tasks --project "Project name" --status all` |
| Browse Order lanes | `daymark order --lane "Do now"`; `daymark order --lane Later` |
| Search and schedule | `daymark search words`; `daymark calendar --from YYYY-MM-DD --to YYYY-MM-DD` |
| Diary and safe preferences | `daymark diary [YYYY-MM-DD]`; `daymark prefs` |
| Generic reads | `daymark list RESOURCE`; `daymark get RESOURCE ID`; `daymark schema` |
| Add a task | `daymark task add "Title" --project "Project name" --section "Section name" --due YYYY-MM-DD --time HH:MM` |
| Add an Order item | `daymark order add "Title" --lane "Do now"` |
| Generic writes | `daymark create RESOURCE --data @item.json`; `daymark update RESOURCE ID --data @changes.json` |
| Finish/reopen | `daymark complete tasks ID`; `daymark reopen tasks ID` (also supports notes) |
| Diary/preferences writes | `daymark diary set YYYY-MM-DD --data @entry.json`; `daymark prefs set --data @prefs.json` |
| Archive/restore project | `daymark archive PROJECT_ID`; `daymark archive PROJECT_ID --restore` |
| Delete/undo | `daymark delete RESOURCE ID --confirm`; `daymark undo UNDO_ID` |
| Low-level API | `daymark api GET /api/agent/v1/health` |

`RESOURCE` is `projects`, `sections`, `tasks`, `labels`, `filters`, `notes`, or
`order-items` (singular aliases also work). `--data` accepts a JSON object,
`@file.json`, or `-` for stdin. Task creation also accepts `--description` and
`--priority`. Task reads accept `--status open|completed|all`; Order reads
accept `--status` and `--lane`. All write commands accept
`--idempotency-key KEY` for a deliberate retry. Writes print the generated
key to stderr. After a timeout, check live state before reusing it. Delete
requires `--confirm` and returns an undo ID.

The generic `complete`/`reopen` commands support tasks and notes, not Order
items. To change an Order item's status, use `daymark update order-items ID
--data '{"status":"done"}'` (or `{"status":"open"}` to reopen), then read it
back. This API can operate only on the documented AI resources; it does not
control local reminders, account recovery, pairing, backups, or raw sync.

## Verify and troubleshoot

After setup, run `daymark doctor --json`, `daymark projects --json`, and a
read of the expected project before attempting a write. If a read reports
`pagination_unavailable`, that server has not yet deployed the paginated task
API; do not treat a truncated task list as complete. A 403/permission error
means the key lacks the required scope: create a new appropriately scoped key
in Daymark Settings and run `auth login` again. A missing-credential error
means the key has not been saved for this Windows account. For a test without
live credentials, run `npm run test:cli`; developers can also run
`npm run verify` from the source checkout.
