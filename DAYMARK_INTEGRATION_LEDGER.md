# Daymark Integration Ledger

Date: 2026-08-04
Branch: `codex/daymark-organizer-integration`
Remote: `https://github.com/Michaelunkai/daymark-desktop.git`
Baseline: `edc1f5e` (`main`, `origin/codex/daymark-capture-edc1f5e`)

## Accepted Handoffs

- `75471b8104d976dce9b1bb84387a3d7e1472c009` task lifecycle and persistence
- `aac4a34ec1ab3196069a055618647eceb7761e16` Calendar/Upcoming
- `264aa08a617aea1fba8de0b4be90a622831a2aef` shell, Settings, theme, responsive CSS
- `341c13d42cc4987ee9629ef7fa44de732753b1a2` Projects and Order organizer

## Integration Commits

- `267517a` cherry-pick lifecycle handoff
- `ce037f0` cherry-pick Calendar/Upcoming handoff
- `6e1cfba` resolved shell conflict, preserving Completed and Settings filtering
- `624635f` resolved Projects/Order conflicts, preserving completion migration, `orderItems`, Settings, Completed, Order, and Upcoming routes
- `a7b2e5d` corrected the legacy migration fixture to omit `orderItems`

## Conflict Resolutions

- `src/App.jsx`: retained Completed and Settings routes, added Order route, and preserved `showCompleted` filtering semantics.
- `src/core/storage.ts`: combined completion-context backfill with schema-v2/v1/v0 `orderItems` defaults.
- `src/core/store.test.ts`: retained lifecycle, migration, long-text, reorder, project undo, and Order assertions.

## Verification

- `npm ci`: passed; 0 vulnerabilities reported.
- Core and feature tests: 38/38 passed.
- Shell contract tests: 2/2 passed.
- `npm run build`: passed; Vite produced `dist/`.
- `git diff --check`: passed.
- Approved Chrome bridge: exact extension ID and Profile 2 / Person 1 verified.
- Existing deployed Daymark tab: desktop rendered; supplemental 390x844 check had `scrollWidth === clientWidth === 390`; no console warnings/errors.

## Gates and Limitations

- Current integration source was not served in Chrome: Vite could not bind `127.0.0.1:4173` because Windows returned `EACCES`.
- The deployed tab is not provenance-linked to `a7b2e5d`; it is not current-branch acceptance evidence.
- GitHub push is intentionally held until the current integration revision can be served and accepted in the approved browser at desktop and 390px mobile.

## Release Path Retraction (Superseded)

- Codex Sites provisioning was explicitly retracted on 2026-08-04 after project creation.
- The remote Sites project is preserved untouched, but no Sites archive, version, deployment, public URL, or source push is authorized or claimed.
- `.openai/hosting.json` was created before the retraction and is preserved unchanged; it is not an active release target.
- Vercel is restored as the sole intended production provider. Future releases require a clean tested commit, normal non-force GitHub push, exact Vercel deployment, and immutable SHA/content provenance.
- Browser verification remains deferred because Chrome control is disabled for this task.

## Current Release Path Correction

- The later correction on 2026-08-04 restored Codex Sites as the authoritative release provider.
- Existing Sites project: `appgprj_6a72433e80108191b2c3936efd51e00a`, persisted in `.openai/hosting.json`.
- Vercel project `prj_Z7LqWj02YmINmaYJ2VtVJIRPNrUu` remains an isolated secondary record and is not the active deployment target.
- Release handshake: the main agent supplies an exact clean tested SHA and immutable build path; the release sub-agent verifies normal Git push, saves one Sites version with that exact `commit_sha`, deploys only the saved version, polls terminal status, and returns URL/version/deployment/SHA evidence.
- No Sites version or deployment is claimed until the sub-agent returns provider receipts.

## Schema-v4 Gap Work

- Durable notes and diary entries are now part of the state schema, with migration from current v3 state and legacy `daymark.journal.v1`.
- Malformed imports now report a visible failure and leave the current workspace unchanged.
- Storage and theme preference access are guarded; blocked storage preserves live memory and safe reset still clears the live workspace.
- Calendar includes completed scheduled tasks and passes an accessible restore action through to the Upcoming agenda.
- Saved content inputs have no arbitrary UI character limits; large task, note, diary, project, and Order payloads are covered by core tests.

## Sites Build Contract

- The first Sites baseline package was correctly rejected because plain Vite emitted no `dist/server/index.js`; no version or deployment was created from that invalid archive.
- The source now includes a checked-in Cloudflare-compatible Worker at `worker/index.js`. It serves the Sites `ASSETS` binding, preserves missing-asset 404s, and falls back to `/index.html` only for HTML GET/HEAD SPA navigations.
- `build/sites-vite-plugin.js` copies that real Worker into `dist/server/index.js` after every production build and preserves `.openai/hosting.json` in `dist/.openai/hosting.json`.
- Worker source behavior and post-build artifact identity are covered by `src/sites-build-contract.test.mjs`; `npm run verify` passed after the change.
- Release remains gated on the Sites-only agent saving a version from the exact clean pushed commit and polling its deployment to terminal `succeeded`.

## Verified Sites Release

- Commit `84a30b3edacf01b4c1e2c53244e8be92f7c49a79` was clean, tested, and pushed normally to GitHub branch `codex/daymark-organizer-integration`.
- The same commit was pushed normally to the Sites source branch `main`; Sites version `1` records that exact `source.commit_sha`.
- Sites project: `appgprj_6a72433e80108191b2c3936efd51e00a`.
- Version ID: `appgprj_6a72433e80108191b2c3936efd51e00a~appgver_0c05ca0cf6348191ab71fbbbe30b8f92`.
- Deployment ID: `appgdep_6a7247f39f8c8191943972af73144f71`.
- Independent provider polling returned terminal `succeeded`; production URL: `https://daymark-desktop.michaelovsky55555.chatgpt.site`.
- Public access is confirmed by the Sites project record. Browser/Codex opening remains deferred because browser control is disabled.

## Runtime Routing Correction

- External acceptance found HTTP 404 at the public root even though the first two deployments reported `succeeded`; status alone is therefore not release proof.
- Root cause was confirmed at the runtime boundary: Sites expects static client output under `dist/client`, while the initial Vite build placed it at `dist/index.html` and `dist/assets`. The Worker received `env.ASSETS` but the binding had no matching root asset.
- The build now emits `dist/client/index.html` and `dist/client/assets/**`, retains `dist/server/index.js`, removes the legacy root-level client layout, and tests the archive-facing paths before republishing.
- Corrected Sites version `3` deployed from commit `062d8788f23bc6cca4c3957877328ea04fdec9b9` with terminal status `succeeded`.
- Independent HTTP acceptance passed: `GET /` returned `200 text/html` containing HTML, and `GET /assets/index-CDFecL_g.js` returned `200 text/javascript` with non-empty content.
- A follow-up direct GET to `/workspace/order` with the default `Accept` header exposed one remaining Worker defect: extensionless SPA routes were incorrectly gated on `Accept: text/html`.
- The Worker now falls back for extensionless GET/HEAD routes regardless of `Accept`, while preserving 404s for `/assets/**` and other extension-bearing missing files. Final live acceptance remains pending this correction's deployment.

## Direct SPA Route Correction

- Sites acceptance still observed `404` for `/acceptance-spa-route` after the previous fallback revision, despite `/` and emitted assets returning `200`.
- The Worker now routes extensionless GET/HEAD requests directly to a fresh `/index.html` request with an explicit HTML `Accept` header before consulting the asset path; asset-like requests remain unchanged.
- Sites version `6` from commit `65a8bc2d026cddca69a97b3343d9b3790d886cfd` is terminal `succeeded`; its version record preserves that exact source SHA.
- Final independent HTTP acceptance passed: `/` returned `200 text/html`, `/acceptance-spa-route` returned `200 text/html`, and `/assets/index-CDFecL_g.js` returned `200 text/javascript` with non-empty content.
