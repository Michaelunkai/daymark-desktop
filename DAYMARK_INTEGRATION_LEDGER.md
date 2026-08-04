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
