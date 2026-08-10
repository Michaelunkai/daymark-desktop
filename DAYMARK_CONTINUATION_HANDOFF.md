# Daymark Continuation Handoff

## Current Session: August 10, 2026

Repository used for this release work:

`C:\Users\micha\Documents\Codex\2026-08-05\daymark-origin-main`

This checkout is a local-first React/Vite Daymark shell with a native Android
WebView wrapper. The current source work adds or preserves:

- Completion and restore controls for notes, list tasks, calendar agenda tasks,
  Order items, and Board task cards.
- Readable text wrapping for task titles and notes, larger task descriptions,
  normalized note previews, and a multi-section diary per date.
- Calendar day selection that opens the selected date and its add-task agenda.
- Workspace navigation with Order alongside the other workspace tabs; the old
  Organize/Before UI is removed. Order now exposes Do now, Later, and After.
- Long-press pointer reorder for tasks, projects, notes, and Order items.
- Android startup loading cover, no blank `about:blank` teardown, persisted sync
  pairing, theme bridge, and Back coordination with overlay/home handling before
  native exit.

Release state:

- Published/device-matching Android version: `1.4.9`, version code `13`.
- Downloadable APK target:
  `https://github.com/Michaelunkai/daymark-desktop/releases/download/v1.4.9/daymark-android-1.4.9.apk`.
- Android release source commit: `60e1273c4e2a1e1f9a6d1b338b065cecbecbdcd9`.
- Release-preparation GitHub `main` commit:
  `d8bf81913354f7a0789b2330664d371a13b31036`.
- GitHub latest published release: `v1.4.9`.
- Last verified Sites saved version `19` is deployed successfully as
  `appgdep_6a728c20c07c819198dbf9fd54591a21` at
  `https://daymark-desktop.michaelovsky55555.chatgpt.site`.
- APK SHA-256:
- `827EF66BFC401DC5D8D6BBAF7550CB214E421A7B0BF229740FAE45B9BC13D770`.
- The tracked APK and published GitHub release asset match byte-for-byte.
- `npm run verify` passed, including the production build and Sites artifact
  checks.
- Android `assembleRelease` passed with Gradle 8.10.2 and JDK 17.0.20 using a
  fresh cache at `work/gradle-user-home`.
- Visible production acceptance passed for note completion, Workspace Order,
  the multi-section Diary, calendar day selection and agenda, and a clean
  browser console.
- Direct wireless ADB verification reported hardware serial `R5CY610XJGV`,
  model `SM-S938B`, package `com.michaelunkai.daymark`, version code `13`,
  version name `1.4.9`, and the expected launcher activity through the mDNS
  endpoint `192.168.1.124:41615`. The captured runtime screen remains
  `android/releases/daymark-android-installed.png`. The durable ADB bridge
  uses server port `5038` and the preserved authorized host key.

Preservation rules:

- Do not discard existing uncommitted changes in this checkout.
- Keep local-first persistence and sync tombstones intact.
- Do not claim deployed or Android-runtime success from source tests alone.
- Record exact commit, APK hash, Sites saved version/deployment, and browser
  evidence after those steps complete.

## Original Goal

Build Daymark into a production-ready local-first task planner.

The product must provide project creation and a polished Upcoming calendar with year, month, and week navigation. Tasks must be addable, editable, movable, reschedulable, completable, searchable, persistent, and visible on their scheduled days. Days containing tasks must show green occupancy markers. The application must support project and section management, rich task editing, reminders, recurrence, global search, offline use, cloud synchronization, optional shared projects, permissions, security, automated testing, deployment, clean rebuild verification, and a final visible launch.

The intended product defaults are:

- React 19 and Vite.
- TypeScript application shell.
- Canonical Upcoming calendar with Week, Month, and Year modes.
- Monday-first configurable calendar.
- Stable 42-cell month grid with actionable outside-month dates.
- Inline quick add from a calendar day.
- Task editing from task chips.
- Desktop drag-and-drop plus accessible Move to date actions.
- Green markers driven by visible task counts, independent from today and selection styling.
- Completed tasks hidden from occupancy counts by default.
- Local-first IndexedDB persistence with retryable synchronization.
- Supabase authentication, PostgreSQL, RLS, realtime, RPCs, and Edge Functions.
- Vercel production hosting.
- PWA manifest, icons, service worker, install/update prompts.
- Full tests, clean rebuild, deployment proof, rollback evidence, and live acceptance.

## Workspace

Repository:

`F:\study\WebBuilding\projects\daymark-desktop`

Git remote:

`https://github.com/Michaelunkai/daymark-desktop.git`

Current main checkout at handoff:

`F:\study\WebBuilding\projects\daymark-desktop`

The original local application checkout remains a separate dirty working tree;
the published GitHub `main` head above contains this release-provenance update.

Important isolated worktrees:

- Integrated application: `C:\Users\micha\.codex\worktrees\6232\daymark-desktop`
- Supabase schema repair: `C:\Users\micha\.codex\worktrees\7a17\daymark-desktop`
- Test harness: `C:\Users\micha\.codex\worktrees\ccd6\daymark-desktop`
- Edge Functions: `C:\Users\micha\.codex\worktrees\8fd6\daymark-desktop`

## Accepted Commits

These commits contain the completed implementation slices and should be preserved:

```text
3a9dcaf8466c3169733b6c0e28c32ff2d7cb5cf9  original Supabase schema and RLS
65d360b3f900555b091f65c28dfbcaec34471170  repository boundary
d4ac19257463cc7394e4dff8071c8579b95e9638  IndexedDB/offline persistence
63a6a4faf72ac949cb8ead2cf1771b154c6032f7  conflict-aware synchronization
038445d9c63123761b14e896ab089646a30b6a06  cloud auth and Supabase transport
2247f420b822dd28c54fa91de3f4e5a00a7a3074  authentication UI
55a103f794c43970b26687e84837bb934a84c7a5  collaboration capabilities
9d875f59f251b8e8b782564a610dc97251c87c8c  collaboration UI
96b64a8fb7922a392baf0c76376ff49778c24074  project, section, bulk, undo, and task workflows
04a5fdcab4fb97f85d4e37214fcaf7afd8d64d6d  canonical Upcoming calendar
b4cc985836e10eaa0c60da682c4a10ca5bdb3f48  global search and filters
8b4e4b8d4c692b16e24be9282d1bb9a2707a319e  reminders and recurrence
95a5715e5487239d1a7b5da0a98375535be20b7e  PWA shell and install/update support
f0f29c870316ad630f810523f65075a7d05bea87  CI, release scripts, headers, and clean rebuild flow
786cf99                                      Supabase Edge Functions
f79dde0a2abfc6b3a2ccee6e6fe6ab7459384e2b  consolidated integration harness
242dc41                                      canonical TypeScript application shell
0437fce                                      corrected Supabase signup behavior
d9b5fe0                                      deferred inactive workspace dialogs and bundle reduction
d3fc7381a1850004932a77c2d71c37294b999f84  final Supabase sync and Edge Function SQL contracts
```

The final Supabase repair is `d3fc7381a1850004932a77c2d71c37294b999f84`. It supersedes the earlier schema-only handoff and must be integrated before release.

## Current Integrated Application

The integrated application worktree contains:

- `src/main.tsx`
- `src/app/DaymarkApp.tsx`
- `src/app/routes.ts`
- `src/app/use-daymark-app.ts`
- `src/app/repository-context.tsx`
- `src/app/sync-status.tsx`
- `src/app/conflict-dialog.tsx`
- `src/app/DaymarkLegacy.jsx`
- `src/types/css.d.ts`

The canonical runtime entry is `src/main.tsx`.

The old `src/App.jsx` is unreachable historical code. Do not restore it as a runtime entry.

The canonical calendar is the accepted W71 implementation:

- `src/features/calendar/UpcomingCalendar.tsx`
- `src/features/calendar/upcoming-calendar.css`
- `src/features/calendar/calendar-grid.ts`
- `src/features/calendar/DatePicker.tsx`

The shell mounts the calendar, inline quick add, auth, collaboration, search, reminders, offline state, conflict handling, and PWA state.

Integrated application commits:

```text
242dc41
0437fce
d9b5fe0
```

The integrated worktree previously passed:

- clean install
- lint
- typecheck
- existing test suite
- consolidated integration suite
- clean delete-and-rebuild
- dependency audit
- local HTTP 200 smoke check when its preview server was running

## Backend Contract

Supabase migration and tests:

- `supabase/migrations/202608020001_daymark_core.sql`
- `supabase/seed.sql`
- `supabase/tests/rls.sql`

The final database contract is in commit `d3fc7381a1850004932a77c2d71c37294b999f84`.

It includes:

- workspace-scoped string IDs
- composite workspace references
- profiles, workspaces, members, projects, sections, tasks, labels, reminders, comments, activity, invitations, receipts, preferences, sync, exports, deletion, and rate-limit records
- owner/editor/viewer RLS
- personal workspace bootstrap
- `daymark_bootstrap_workspace`
- `daymark_get_workspace_snapshot`
- `daymark_apply_workspace_mutations`
- `workspace_changes`
- `consume_rate_limit`
- `create_workspace_invitation`
- `accept_workspace_invitation`
- `enqueue_reminder_delivery`
- `create_data_export`
- `request_account_deletion`
- `confirm_account_deletion`
- ownership transfer protections
- idempotency and stale-revision checks
- deterministic SQL policy and contract tests

Important limitation:

Live Postgres/Supabase execution has not been proven in this environment because local Supabase Postgres at `127.0.0.1:54322` is unavailable and Docker's Linux engine is not running.

## Cloud Client

Cloud client files:

- `src/core/cloud/env.ts`
- `src/core/cloud/supabase-client.ts`
- `src/core/cloud/supabase-repository.ts`
- `src/core/cloud/workspace-service.ts`
- `src/core/cloud/auth-service.ts`
- `src/core/cloud/index.ts`
- `src/core/cloud/cloud.test.ts`

Required client behavior:

- provide a real `@supabase/supabase-js` `createClient`
- use `VITE_SUPABASE_URL`
- use `VITE_SUPABASE_ANON_KEY`
- configure the W61 RPC names exactly
- subscribe to `workspace_changes`
- preserve optimistic mutation IDs and deduplicate realtime events

## Edge Functions

Edge Function files:

- `supabase/functions/_shared/auth.ts`
- `supabase/functions/_shared/rate-limit.ts`
- `supabase/functions/_shared/validation.ts`
- `supabase/functions/invitations/index.ts`
- `supabase/functions/reminders/index.ts`
- `supabase/functions/data-export/index.ts`
- `supabase/functions/account-delete/index.ts`
- `supabase/functions/functions.test.ts`

Required server-only secrets:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `ALLOWED_ORIGIN`

Never place the service-role key in browser code or committed files.

## Local Persistence And Sync

Primary files:

- `src/core/repository/types.ts`
- `src/core/repository/local-repository.ts`
- `src/core/storage.ts`
- `src/core/sync`
- `src/core/cloud`

Required behavior:

- IndexedDB is the working copy.
- localStorage is migration-only and for small device preferences.
- mutations have stable IDs and ordered retry metadata.
- local optimistic writes remain usable offline.
- retries are idempotent.
- stale revisions produce explicit conflicts.
- remote events do not duplicate optimistic events.
- localStorage import has preview, merge, rollback, and no data loss.

## Frontend Work Remaining

1. Merge the final integrated application branch into the main checkout.
2. Cherry-pick the final Supabase repair `d3fc7381a1850004932a77c2d71c37294b999f84`.
3. Confirm W69 imports and runtime data shapes still match the final SQL contract.
4. Keep only `src/main.tsx` as the application entry.
5. Verify the Upcoming route visibly renders:
   - Week, Month, Year modes
   - previous, Today, next navigation
   - year/month/week range labels
   - stable 42-cell month grid
   - outside-month date actions
   - green task-day markers
   - completed-task marker semantics
   - inline quick add
   - task editing
   - desktop drag movement
   - accessible Move to date action
   - selected-day agenda on narrow screens
   - Plan tray for overdue and unscheduled work
6. Verify project creation:
   - dialog opens
   - name validation stays open on failure
   - color selection is accessible
   - optional first section is created
   - success navigates to the new project
7. Verify search is global and updates after create, edit, move, complete, project change, reload, and sync.
8. Verify reminders and recurrence around DST and timezone boundaries.

## Backend And Deployment Work Remaining

1. Create or select a Supabase project.
2. Apply the final migration and seed.
3. Run live RLS and RPC tests against that project.
4. Deploy the four Edge Functions.
5. Configure Vercel production environment variables.
6. Create a new Vercel project for `daymark-desktop`.
7. Push the exact verified source commit to GitHub.
8. Deploy only that immutable commit.
9. Record production URL, deployment ID, migration version, function versions, health checks, and rollback identifiers.
10. Verify no secret values appear in artifacts.

Current deployment prerequisites not present in the shell:

- `SUPABASE_ACCESS_TOKEN`
- `SUPABASE_PROJECT_REF`
- `VERCEL_TOKEN`
- `VERCEL_ORG_ID`
- `VERCEL_PROJECT_ID`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Vercel account/team discovered:

- team: `michael's projects`
- team slug: `michaels-projects-ef5cc570`
- team ID: `team_7ZmLR4K01KAN4cwQ587yK0Qu`

No existing Vercel project named Daymark was found.

## Verification Commands

Run from:

`F:\study\WebBuilding\projects\daymark-desktop`

Use the repository's scripts after merging the integrated commits:

```powershell
npm ci
npm run lint
npm run typecheck
npm test
npm run build
Remove-Item -Recurse -Force -LiteralPath dist
npm run build
npm audit --audit-level=high
```

Run the consolidated harness:

```powershell
npx --yes --package vitest@4.1.10 --package @vitest/coverage-v8@4.1.10 vitest run --config vitest.config.ts --coverage
```

Run the Edge Function tests after installing or using Deno:

```powershell
deno test supabase/functions/functions.test.ts
```

Run Supabase checks only after project linking and environment verification:

```powershell
npx supabase db push
npx supabase db reset
psql -f supabase/tests/rls.sql
npx supabase functions deploy invitations
npx supabase functions deploy reminders
npx supabase functions deploy data-export
npx supabase functions deploy account-delete
```

Run local production preview on an unused port:

```powershell
npm run preview -- --host 127.0.0.1 --port 4176
```

## Required Live Acceptance

Use only the approved visible Chrome installation:

- executable: `C:\Program Files\Google\Chrome\Application\chrome.exe`
- profile: `Profile 2`
- visible identity: `Person 1`
- extension ID: `hehggadaopoacecdllhhajmbjkdcmajg`

If Chrome is closed, run:

`C:\Users\micha\.codex\hooks\Ensure-VisibleChromeProfile2.ps1`

Then discover the connected extension instance fresh. Do not reuse an old instance ID.

Verify production visibly:

1. Open the deployed production URL.
2. Sign up or sign in.
3. Confirm personal workspace bootstrap.
4. Create a project and section.
5. Create tasks from Upcoming.
6. Move tasks across dates and views.
7. Confirm green occupancy markers.
8. Edit, complete, undo, and search tasks.
9. Reload and confirm persistence.
10. Disable network, create/edit a task, restore network, and confirm sync.
11. Invite owner/editor/viewer test users.
12. Verify permissions.
13. Verify reminders and recurrence.
14. Verify responsive layouts at:
    - 1440x900
    - 1180x800
    - 1024x768
    - 820x1180
    - 720x900
    - 390x844
    - 320x568
15. Confirm no document overflow, critical accessibility failures, or console errors.
16. Leave the verified Upcoming view open.

## Push And Release

After final verification:

```powershell
$git='C:\Program Files\Git\cmd\git.exe'
& $git status
& $git add .
& $git commit -m "release: Daymark production planner"
& $git push origin main
```

Do not push until:

- the final integrated source is merged into the main checkout
- the final Supabase repair is included
- clean rebuild has passed twice
- the live database contract has been exercised
- production deployment succeeds
- rollback evidence exists

## Explicit Known Risks

- Supabase credentials and project access are not currently available through the shell.
- Local Docker/Postgres is unavailable, so migration execution is not proven locally.
- Production cloud acceptance must not be claimed from static SQL or frontend build output alone.
- The old `src/App.jsx` must remain unreachable.
- The production bundle warning was reduced by `d9b5fe0`; recheck the final build after the SQL and shell merge.
- Any mismatch between W65 payload casing and the final SQL return shapes must be fixed before deployment.

## Continuation Order

1. Merge the integrated application commits into the main checkout.
2. Add `d3fc7381a1850004932a77c2d71c37294b999f84`.
3. Run the full local verification sequence.
4. Provision/link Supabase and configure environment values.
5. Apply migrations and seed.
6. Execute live RLS/RPC checks.
7. Deploy Edge Functions.
8. Push the verified source.
9. Create and deploy the Vercel production project.
10. Run the full live acceptance matrix.
11. Rebuild after deleting generated output.
12. Leave the production Upcoming calendar visible.

## Latest Continuation State

This document was updated on August 2, 2026 after the user explicitly requested a complete handoff containing every detail needed for another session to continue without waiting for routine clarification.

The original user goal remains authoritative:

> Add project creation and a beautiful Upcoming calendar with year, month, and week navigation. Allow tasks to be added, moved, or edited on any day, marking days containing tasks in green. Perfect the UI, frontend, backend, functionality, and useful task-management features. Research current implementation ideas and route findings to the appropriate workers. Build and verify the application end to end. Finally compile, recompile, and launch it for me to see.

The later approved scope expands that goal into a production-ready local-first planner with:

- React 19, Vite, and a TypeScript application shell.
- One canonical Upcoming calendar, with Week, Month, and Year modes.
- Project creation and complete project/section lifecycle management.
- Rich task editing, subtasks, recurrence, reminders, labels, priorities, completion, undo, bulk actions, and search.
- Stable 42-cell month grids, actionable outside-month dates, inline quick add, task editing, validated drag movement, keyboard movement, overflow lists, plan tray, green occupancy markers, responsive layouts, and accessibility.
- IndexedDB offline persistence, optimistic mutations, retry queues, conflict handling, realtime synchronization, and localStorage migration.
- Supabase authentication, PostgreSQL, RLS, realtime, RPCs, invitations, roles, Edge Functions, reminders, exports, deletion, and audit events.
- Vercel deployment, PWA installation, CI/CD, clean rebuild verification, observability, rollback evidence, and live production acceptance.

## Exact Invocation Continuation Record

The previously running coordinator invocation is preserved and must not be replaced:

- invocation ID: `8b432d19-b1d1-45a6-b227-efdf2be278ce`
- coordinator thread ID: `019fc316-acef-7431-9a8e-051fe405a6e0`
- team ID: `team-73d69b1e-8b432d19`
- workspace ID: `ws-73d69b1ebc1ed0f3`
- project ID: `project-ws-73d69b1ebc1ed0f3`
- project path: `F:\study\WebBuilding\projects\daymark-desktop`
- required roster: `W01` through `W80`
- latest gate state reported by the coordinator hook: `registered_workers=0/80`, `missing_slots=W01` through `W80`, `unrecovered_failures=none`, phase `waiting-for-user`

The next session must reconcile exact existing visible threads before creating anything. Use the current top-level Codex thread controls only:

1. `list_threads` with `limit:50`, twice when a missing-slot decision depends on inventory.
2. Filter by the exact Daymark project path, invocation ID, title, and slot.
3. `read_thread` every matching thread and preserve any real assistant turn, final report, commit, worktree, and evidence.
4. Use `wait_threads` for active or resumed threads.
5. For stopped, interrupted, partial, timed-out, or acceptance-failing exact slots, send a valid same-thread recovery envelope and monitor that same thread.
6. Never create a replacement invocation.
7. Never alter routes, contribution ownership, model, effort, project, workspace, or original rendered prompts.
8. Recreate only a slot proven absent after the required consecutive inventories, using the exact original rendered prompt and attempt suffix required by the team skill.

Stable command resources:

- helper scripts: `C:\Users\micha\plugins\codex-team\skills\team\scripts`
- bundled Python: `C:\Users\micha\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe`
- bundled Node: `C:\Users\micha\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`
- team skill: `C:\Users\micha\.codex\plugins\cache\micha-local-plugins\codex-team\0.3.18+codex.20260802215000\skills\team\SKILL.md`

Do not use shell input redirection with `<` in PowerShell. For JSON validation, use:

```powershell
Get-Content -Raw -LiteralPath $planPath | & $pythonPath $validatorPath
```

The final completion gate requires a validated outcome ledger and a completion receipt. Run the validators from the stable helper root and preserve their generated JSON artifacts. The final coordinator response is forbidden until validation passes and must contain:

`TEAM_COMPLETION_RECEIPT: <absolute-json-path>`

If and only if a genuinely indispensable user authority or physical owner action remains after all local work and verification, end with:

`TEAM_WAITING_FOR_USER: <single exact action>`

Do not ask for routine clarification. Derive all ordinary decisions from this document, the repository, accepted commits, and current live evidence.

## Known Existing Daymark Threads

These exact Daymark slots and reports were previously observed and must be reconciled rather than blindly recreated:

- W61 `019fc39e-1625-7643-a631-5651ef4aacb7`, Supabase schema/RLS, final repair commit `d3fc7381a1850004932a77c2d71c37294b999f84`
- W62 `019fc3b9-707e-7233-a745-91921a4d0e58`, repository contract, commit `65d360b3f900555b091f65c28dfbcaec34471170`
- W63 `019fc391-d2cf-7ef3-ac9b-806de4b4df70`, IndexedDB/offline persistence, commit `d4ac19257463cc7394e4dff8071c8579b95e9638`
- W64 `019fc39e-2963-7ad3-8c29-60a382a19d7a`, synchronization/conflicts, commit `63a6a4faf72ac949cb8ead2cf1771b154c6032f7`
- W65 `019fc399-dfe2-7262-9483-0b98d7cdb8a5`, cloud auth/transport, commit `038445d9c63123761b14e896ab089646a30b6a06`
- W66 `019fc3aa-f4cb-7792-973a-826c7ca66765`, authentication UI, commit `2247f420b822dd28c54fa91de3f4e5a00a7a3074`
- W67 `019fc3b4-c9b6-7c73-b74d-897f20a6cc24`, collaboration capabilities, commit `55a103f794c43970b26687e84837bb934a84c7a5`
- W68 `019fc3b6-402c-71e1-9a16-db8fd55a1e0d`, collaboration UI, commit `9d875f59f251b8e8b782564a610dc97251c87c8c`
- W69 `019fc3d0-cd59-7b61-8a34-142ca78961b6`, TypeScript application shell integration, worktree `C:\Users\micha\.codex\worktrees\6232\daymark-desktop`
- W70 `019fc3b7-6c5e-73d2-ae8e-92db2a8d505a`, core task/project workflows, commit `96b64a8fb7922a392baf0c76376ff49778c24074`
- W71 `019fc3be-b582-7a33-9e5c-5ea844cf582d`, canonical Upcoming calendar, commit `04a5fdcab4fb97f85d4e37214fcaf7afd8d64d6d`
- W72-R02 `019fc3c7-055d-7e83-9a65-7ecacacdf989`, global search/filters, commit `b4cc985836e10eaa0c60da682c4a10ca5bdb3f48`
- W73 `019fc3c6-1c08-70f3-b978-3472bb2d1f0b`, reminders/recurrence, commit `8b4e4b8d4c692b16e24be9282d1bb9a2707a319e`
- W74 `019fc3b9-c514-74d1-8510-d28d696b7743`, PWA/offline shell, commit `95a5715e5487239d1a7b5da0a98375535be20b7e`
- W75 `019fc3bb-d248-7351-aac1-cdbecc794d7f`, CI/Vercel configuration, commit `f0f29c870316ad630f810523f65075a7d05bea87`
- W76 `019fc3ca-5627-71a3-8343-8cfdd7206d79`, Supabase Edge Functions, commit `786cf99`
- W77-R02 `019fc3ce-4650-7a53-aeaf-84e728a66a8a`, consolidated integration harness, commit `f79dde0a2abfc6b3a2ccee6e6fe6ab7459384e2b`
- W78, W79, and W80 were previously unlaunched and require exact roster recovery only if two inventories prove they are absent.

Preserve failed admission evidence, including the first W72/W77 failed shells, but do not resume an unmaterialized shell as if it had contributed work.

## Current External Gates

The following facts were checked previously and must be rechecked before claiming release:

- No `.openai/hosting.json` or existing Daymark Vercel project was present in the main checkout.
- Vercel team: slug `michaels-projects-ef5cc570`, team ID `team_7ZmLR4K01KAN4cwQ587yK0Qu`.
- Shell environment did not contain `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`, `SENTRY_AUTH_TOKEN`, or `VITE_SENTRY_DSN`.
- `npx supabase@latest projects list --output json` previously failed because no Supabase access token was available.
- Local Docker/Postgres was unavailable, so local migration execution was not proof of live cloud behavior.
- Never print secret values. Use secure environment configuration and validate only presence/shape.

## Final Handoff Requirement

The next session must preserve this file and continue from it. It must not replace the repository with a competing implementation, discard accepted commits, or claim that a build alone proves production readiness. It must complete the dependency order, verify every acceptance criterion, record exact evidence paths, regenerate the completion receipt, and only then report the receipt path.

## Latest Verified Recovery Results

The preserved W61 and W69 threads were resumed on August 2, 2026 without replacement.

W61 recovery:

- thread: `019fc39e-1625-7643-a631-5651ef4aacb7`
- final repair: `d3fc7381a1850004932a77c2d71c37294b999f84`
- commit identity, clean worktree, whitespace, sync RPCs, realtime contract, seven W76 RPC signatures, execute grants, RLS, and restricted reminder-queue privileges passed offline verification
- deterministic seed/test coverage for sync, rate limits, invitations, reminders, exports, and staged deletion passed offline
- remaining limitation: local Supabase/Postgres validation requires Docker Desktop's Linux engine listening on `127.0.0.1:54322`

W69 recovery:

- thread: `019fc3d0-cd59-7b61-8a34-142ca78961b6`
- worktree: `C:\Users\micha\.codex\worktrees\6232\daymark-desktop`
- final integration commits: `de9acd5` and `9b721a0`
- preserved shell commits: `242dc41`, `0437fce`, and `d9b5fe0`
- final integrated HEAD: `9b721a0 fix(cloud): align workspace RPC parameters`
- W65 now sends `p_workspace_id`, `p_client_id`, `p_expected_revision`, `p_mutations`, and `p_workspace_name`
- W76 Edge Function payloads match the final migration contract
- clean `npm ci` passed
- lint passed
- typecheck passed
- tests passed: 33 unit, 7 native integration, and 13 W77 tests across 5 files
- two clean production rebuilds passed and matched
- dependency audit reported zero vulnerabilities
- initial bundle is `492.05 kB` and `139.82 kB` gzip, below the previous warning threshold
- local launch returned HTTP 200 at `http://127.0.0.1:4175/` and served the canonical `src/main.tsx` shell
- code-level W69 acceptance passed
- no production deployment was performed

## Remaining Release Gate

The only known indispensable external release action is authenticated access to the intended Supabase and Vercel projects. The next session must:

1. Validate secure presence of Supabase project URL, anonymous key, access token, and project reference.
2. Validate secure presence of Vercel token, organization/team ID, and project ID or create/link the Daymark project under the known Vercel team.
3. Apply the final W61 migration and seed to the intended Supabase project.
4. Deploy W76 Edge Functions.
5. Execute live RLS, RPC, realtime, authentication, offline recovery, invitation, reminder, export, and deletion checks.
6. Push the verified source state.
7. Deploy the immutable tested source to Vercel.
8. Run health checks and preserve deployment and rollback receipts.
9. Run the full visible Chrome acceptance matrix and leave Upcoming open.

Never print secret values or place them in this markdown file. If those credentials are not available to the next session, the exact required owner action is to authenticate/link the intended Supabase and Vercel projects through their secure environment or connector flows. All local implementation and verification work above is already complete at the stated evidence boundary.
