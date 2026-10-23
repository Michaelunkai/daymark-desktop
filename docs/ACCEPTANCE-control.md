# ACCEPTANCE-control.md — Acceptance Map for the Control-Board Slice

Purpose: prove, demand by demand, that nothing from the user's demand list was
missed. Each demand keeps its verbatim wording, carries testable acceptance
criteria (given/when/then, concrete values), names WHERE it is implemented, and
HOW it is verified. A demand is "covered" only when a stranger can run the
verification and get the same result.

How to run everything at once (from repo root
`F:\study\WebBuilding\projects\daymark-desktop`):

```
npm test
node scripts/verify-control-features.mjs --full
```

Manual visual checks assume the app is running (`npm run dev`, or launch the
packaged `release\windows\win-unpacked\Daymark.exe`) with the workspace/control
board visible and at least one In Progress session.

---

## DEMAND 1 — Delete all finished, only finished

**(a) Verbatim demand:** "add button in finished 'delete all' to immediately
delete only the finished ones"

**(b) Acceptance criteria**

- AC1.1 — GIVEN the Finished column contains 3 finished tasks, and To do has 1
  task, and In Progress has 2 running sessions, WHEN the user clicks the
  "Delete all" button in the Finished section header, THEN exactly those 3
  finished tasks are removed (Finished count becomes 0) and the 1 To do task
  and both In Progress sessions are untouched (same ids, same order, same
  journal text).
- AC1.2 — GIVEN the Finished column is empty, WHEN the board renders, THEN the
  "Delete all" affordance is not clickable (hidden or disabled state) and no
  error is thrown.
- AC1.3 — GIVEN the user clicks "Delete all", WHEN the click resolves, THEN the
  deletion is immediate — no confirmation dialog, no undo prompt — and each
  removed task goes through the same `task.delete` path as the per-card X (one
  delete message per finished task, count equals the Finished count before
  click).
- AC1.4 — GIVEN 3 finished tasks were deleted, WHEN the app is reloaded, THEN
  the Finished column is still empty (deletion was persisted, not visual-only)
  and In Progress sessions still show their full journal history.
- AC1.5 — GIVEN a finished task is deleted while a sync is pending, WHEN sync
  completes, THEN the task is gone on both sides and no "finished task
  resurrected" state appears (no zombie card after refresh).

**(c) WHERE implemented**
- `src/App.jsx` — delete wiring: `deleteBoardTask` / `deleteControlTask`
  handlers send `type: 'task.delete', taskId` per task; the delete-all handler
  batches over the Finished column's task ids.
- `src/features/workspace/board-model.ts` — Finished-column model exposes the
  finished task id list consumed by delete-all.
- `src/features/workspace/icons.tsx` — the trash glyph used by the Delete-all
  button (same icon family/stroke as every other board action).
- `src/styles/app-shell.css` — `.board-column__delete-all` (danger-styled
  header button) and its disabled state.
- Android parity: `android/app/src/main/java/com/michaelunkai/daymark/AiWorkspaceActivity.java`
  — Finished section header carries the same Delete-all action.

**(d) HOW verified**
- Automated: `npm run test:sites` (runs `src/control-panel-contract.test.mjs`,
  which asserts the delete affordances and `task.delete` wiring in `App.jsx`)
  and `node scripts/verify-control-features.mjs --full` (delete-all fixture:
  3 finished + 2 in-progress + 1 todo in, asserts exactly 3 removed).
- Manual: create 3 finished, 2 in-progress, 1 todo task; click "Delete all" in
  Finished; observe only the 3 vanish; reload the app (Ctrl+R) and re-check.

---

## DEMAND 2 — Every In Progress session shows progress/freshness, 5-minute law, no exceptions

**(a) Verbatim demand:** "make extra sure all sessions that are in progress
exactly every 5 minutes will show progress and updates no exceptions no delays
ever"

**(b) Acceptance criteria**

- AC2.1 — GIVEN an In Progress session whose last journal update was 4 minutes
  ago, WHEN the board renders, THEN its age chip shows the FRESH state (e.g.
  "updated 4m ago", fresh styling). GIVEN the same session at 6 minutes, THEN
  the chip flips to the DUE state labeled "update due". GIVEN 11 minutes, THEN
  the chip shows the LATE state labeled "overdue 11m".
- AC2.2 — GIVEN a board with 3 In Progress sessions where 2 have a journal
  event within the last 5 minutes and 1 does not, WHEN the board renders, THEN
  the board-level stat reads exactly "5-min law: 2/3 on time" and it updates on
  the next re-render after the underlying state changes (no stale value after
  refresh).
- AC2.3 — GIVEN the freshness clock, WHEN any journal marker line ("— update",
  "— heartbeat", "— REOPENED", "— PAUSED", "— RESUMED") is appended to a
  session's journal, THEN that session's age chip immediately resets to fresh —
  all five marker kinds count, no exceptions.
- AC2.4 — GIVEN an In Progress session with no journal events at all, WHEN the
  board renders, THEN the chip shows the explicit "none" state (never blank,
  never a fake 0m) so every card always reports freshness.
- AC2.5 — GIVEN the machine clock advances past a threshold while the app is
  open and focused, WHEN the periodic tick fires, THEN chip states transition
  on the very next tick without requiring a manual reload (watch a 4m chip turn
  "update due" at 5-6m with the app untouched).

**(c) WHERE implemented**
- `src/features/workspace/health.ts` — `sessionHealth` state machine:
  `"fresh" | "due" | "late" | "none"`, the 5m/10m boundaries, and
  `JOURNAL_MARKERS` (all five marker strings); `boardHealth(descriptions,
  nowMs)` produces the X/Y on-time aggregate.
- `src/features/workspace/board-model.ts` — per-column health rollup feeding
  the "5-min law: X/Y on time" stat line.
- `src/App.jsx` — board wiring passes journal descriptions + now-ms into the
  health functions and renders chip + stat.
- `src/styles/app-shell.css` — `.board-task__update` chip variants
  (`.is-new` / due / late coloring per danger tokens).
- Android parity: `SessionUpdateParser.java` recognizes the same journal
  markers; `AiWorkspaceActivity.java` renders the age chip and law stat.

**(d) HOW verified**
- Automated: `node --test src/features/workspace/health.test.ts` (threshold
  table: 4m fresh / 6m due / 11m late / no-events none / boardHealth 2-of-3)
  plus `npm run test:sites` for the render wiring; Android side covered by
  `npm run test:sites` → `src/android-contract.test.mjs` for parser markers.
- Manual: open the board with a running session; watch the chip for 6+ minutes
  without touching the app; confirm fresh → "update due" → "overdue Xm"
  transitions and the board stat denominator counts every In Progress card.

---

## DEMAND 3 — Best-in-class design, smooth scrolling, professional non-AI look

**(a) Verbatim demand:** "with today best stacks make every single aspect of
the app as beautiful as it can possibly be... easily scroll between the
sections and the running progresses and sessions... never looks in any way
like AI worked on it"

**(b) Acceptance criteria**

- AC3.1 — GIVEN the board has more content than the viewport, WHEN the user
  scrolls with the mouse wheel, THEN scrolling is smooth (animated via the
  smooth-wheel path in `src/core/smooth-wheel.test.ts`'s subject code), not the
  OS default 3-line jump; and WHEN the user enables OS reduced-motion
  (Windows: Settings → Accessibility → Visual effects → Animation effects off),
  THEN smooth scroll and card lift animations are disabled and content snaps
  (no motion).
- AC3.2 — GIVEN the user scrolls a long board, WHEN a column header leaves the
  viewport top, THEN the header sticks (sticky positioning) so To do / In
  Progress / Finished labels and column actions remain visible mid-scroll.
- AC3.3 — GIVEN any color, spacing, radius, or shadow in the board shell, WHEN
  the CSS is audited, THEN every value resolves from a design token in
  `src/styles/tokens.css` (zero new raw hex literals in `app-shell.css` board
  rules; dark and light themes both read the same token names).
- AC3.4 — GIVEN the running In Progress cards, WHEN the user scrolls the
  section, THEN live session cards keep rendering their progress content
  during scroll (no blank/frozen cards mid-scroll) and hover lift is subtle
  (max 1-2px translate) with visible keyboard focus rings on every
  interactive element.
- AC3.5 — GIVEN the finished board, WHEN reviewed by a human reviewer, THEN
  typography, spacing rhythm, and card styling are consistent across To do /
  In Progress / Finished (same card radius, same header height, same chip
  sizing) — mechanical AI tells (random radii, inconsistent paddings, emoji
  icons, gradient soup) are absent; `npm run verify` includes the layout audit
  (`scripts/layout-audit.mjs`) and passes.

**(c) WHERE implemented**
- `src/styles/tokens.css` — the full token set (color/space/radius/shadow/
  motion), single source for both themes.
- `src/styles/app-shell.css` — board layout, sticky column headers
  (`.board-column__header` sticky), card polish, hover lift, focus rings,
  reduced-motion guards under `@media (prefers-reduced-motion: reduce)`.
- `src/features/workspace/scroll.ts` + `src/core` smooth-wheel — smooth wheel
  scrolling with reduced-motion bypass.
- `src/features/workspace/icons.tsx` — the single hand-tuned icon set (uniform
  stroke weight, no emoji glyphs) behind the professional look.
- `src/App.jsx` / `src/features/views/TaskBoardView.tsx` — board structure the
  shell styles attach to.

**(d) HOW verified**
- Automated: `npm run test:core` (includes `src/core/smooth-wheel.test.ts`),
  `npm run test:sites` (shell contract asserts the board shell CSS rules),
  `node scripts/layout-audit.mjs`, and
  `node scripts/verify-control-features.mjs --full` (token usage +
  reduced-motion assertions).
- Manual: run the app; wheel-scroll the full board; toggle Windows
  reduced-motion off/on and re-scroll; Tab through board controls and confirm
  focus rings; visually compare the three column headers for identical rhythm.

---

## DEMAND 4 — Pause and resume In Progress tasks at any point

**(a) Verbatim demand:** "for in progress tasks make sure to add the option to
pause and resume at every point that I want"

**(b) Acceptance criteria**

- AC4.1 — GIVEN an In Progress card with existing journal text, WHEN the user
  clicks Pause, THEN the journal line "— PAUSED HH:MM —" is PREPENDED as the
  FIRST line and every prior character of the journal is preserved byte-for-byte
  (append-only, zero mutation of prior content).
- AC4.2 — GIVEN a paused card, WHEN the user clicks Resume, THEN "— RESUMED
  HH:MM —" is likewise prepended as the first line, prior content intact, and
  the button toggles back to Pause.
- AC4.3 — GIVEN a paused session, WHEN the board renders, THEN the card is
  visibly dimmed (paused state class, e.g. `.is-paused` reduced opacity) while
  remaining fully readable and interactive — and the paused card's freshness
  chip reflects the PAUSED marker per AC2.3 (the PAUSED line is a recognized
  journal event).
- AC4.4 — GIVEN an In Progress session at ANY point — just started, mid-cycle,
  seconds before its 5-minute boundary, or while late/overdue — WHEN Pause is
  clicked, THEN it pauses on that exact click (no window where pause is
  rejected); WHEN Resume is clicked, THEN it resumes on that exact click.
  Pause/Resume is available on every In Progress card without exception.
- AC4.5 — GIVEN a session is paused then resumed, WHEN the app is reloaded,
  THEN both journal lines persist and the card is active again (state survives
  restart; not lost to a visual-only toggle).
- AC4.6 — GIVEN the Android companion shows the same session, WHEN the session
  is paused on desktop, THEN the Android card renders the same PAUSED state and
  offers the matching Resume action (parser parity).

**(c) WHERE implemented**
- `src/App.jsx` — pause/resume handlers on the In Progress card; toggle wiring
  and journal prepend calls.
- `src/features/workspace/board-model.ts` — pause state derivation from the
  leading journal marker (`— PAUSED HH:MM —` / `— RESUMED HH:MM —`).
- `src/features/workspace/health.ts` — `"— PAUSED"` / `"— RESUMED"` in
  `JOURNAL_MARKERS` (paused cards still report freshness).
- `src/features/workspace/icons.tsx` — pause/play toggle glyphs for the card
  action button.
- `src/styles/app-shell.css` — `.is-paused` dimming and pause button styling.
- Android: `AiWorkspaceActivity.java` (pause/resume action on the session
  card), `SessionUpdateParser.java` (parses PAUSED/RESUMED markers),
  `DaymarkWorkspaceClient.java` (syncs the journal lines).

**(d) HOW verified**
- Automated: `node --test src/features/workspace/board-model.test.ts`
  (prepend-as-first-line, prior-characters-preserved assertions, toggle
  sequence PAUSED→RESUMED→PAUSED); `npm run test:sites`
  (`src/control-panel-contract.test.mjs` for desktop wiring,
  `src/android-contract.test.mjs` for parser/client parity);
  `node scripts/verify-control-features.mjs --full` (pause-at-any-point
  fixture: pause at 0m, 4m59s, and overdue states).
- Manual: run a session, click Pause at three different moments, verify the
  journal line each time (HH:MM matches wall clock), reload, confirm lines
  persist; check the same session on the Android companion.

---

## DEMAND 5 — Always-visible real-time 5-hour and 7-day usage percentages

**(a) Verbatim demand:** "always show me real-time percentages of usage left
for the 7-Day usage and the five hour usage"

**(b) Acceptance criteria**

- AC5.1 — GIVEN a usage snapshot with `usedPct = 27`, WHEN the panel header
  renders, THEN the meter shows exactly "73% left" for that window (remaining =
  100 − usedPct), and the meter's accessible label reads
  "5-hour usage: 73% left" / "7-day usage: 73% left" accordingly
  (`role="status"` on the meter group).
- AC5.2 — GIVEN remaining is 25% or less, WHEN the meter renders, THEN the
  warn modifier class applies (`usage-meter--warn` at remaining ≤ 25); GIVEN
  remaining is 10% or less, THEN the crit modifier applies
  (`usage-meter--crit` at remaining ≤ 10) — e.g. usedPct=75 → warn,
  usedPct=90 → crit, usedPct=27 → neither.
- AC5.3 — GIVEN the usage window has a reset time, WHEN the meter renders,
  THEN it displays "Resets at HH:MM" (locale time) so "usage left" is
  actionable, not just a number.
- AC5.4 — GIVEN both windows report data, WHEN the header renders, THEN BOTH
  the "5-hour" and "7-day" meters are always visible in the panel header — no
  tab, hover, or click required; GIVEN one window has no data, THEN that meter
  renders a calm placeholder instead of "NaN% left" (never a broken number).
- AC5.5 — GIVEN the local usage source updates (new snapshot pushed via IPC or
  refresh), WHEN the next render occurs, THEN the percentages update in place
  without a page reload (values track the source within one refresh cycle).

**(c) WHERE implemented**
- `src/features/workspace/UsageMeters.tsx` — `remainingFrom(usedPct)`,
  `modifierFor(remaining)` (warn ≤ 25, crit ≤ 10), meter captions "5-hour" /
  "7-day", "% left" label, `aria-label`, "Resets at" formatting.
- `src/features/workspace/usage-source.ts` — local usage pipeline computing
  the fiveHour/sevenDay snapshot (usedPct, resetsAtMs) for the renderer.
- `desktop/main.mjs` — IPC channel delivering usage snapshots to the
  renderer.
- `src/App.jsx` — mounts `<UsageMeters>` in the panel header so both meters
  are permanently on screen.
- `src/styles/tokens.css` + `src/styles/app-shell.css` — meter bar, fill
  width, warn/crit colors.

**(d) HOW verified**
- Automated: `node --test src/features/workspace/usage-source.test.ts`
  (usedPct=27 → 73 left; warn at 75 used; crit at 90 used; null window →
  placeholder); `npm run test:sites` (render wiring in `App.jsx`);
  `node scripts/verify-control-features.mjs --full` (IPC end-to-end:
  snapshot in → header text out).
- Manual: run the app; confirm both meters sit in the panel header at all
  times across board/list/calendar views; watch a value change after a usage
  refresh without reloading.

---

## SIGN-OFF CHECKLIST

- [ ] Demand 1 — "Delete all" in Finished removes ONLY finished tasks, immediately, persisted (AC1.1–AC1.5)
- [ ] Demand 2 — Every In Progress card reports freshness (4m fresh / 6m due / 11m late) and the board shows "5-min law: X/Y on time" (AC2.1–AC2.5)
- [ ] Demand 3 — Token-driven redesign, smooth board scroll, sticky headers, reduced-motion respected, consistent non-AI aesthetic (AC3.1–AC3.5)
- [ ] Demand 4 — Pause/Resume on every In Progress card at any point; "— PAUSED HH:MM —" / "— RESUMED HH:MM —" prepended as first line, prior characters preserved; card dims; Android parity (AC4.1–AC4.6)
- [ ] Demand 5 — 5-hour and 7-day meters always visible in the panel header: "73% left" at usedPct=27, warn at 25, crit at 10, reset times shown (AC5.1–AC5.5)
- [ ] All five demands live-verified in the running PC app (`npm test` + `node scripts/verify-control-features.mjs --full` green, manual visual pass done)

<!-- SLICE-DONE: product-manager -->
