# Button Contract — canonical line formats and SLAs (v3)

Every button in the Daymark AIControlPanel (Android app, PC board, relay, bridge) speaks
through journal lines prepended to the task description. This document is the single
source of truth for those formats. **If code and this document disagree, file a bug
against the code and update both together — never silently.**

Ground rules that apply to every line:

- The dash is always an em-dash, **U+2014** (`—`), never a hyphen or en-dash.
- `HH:MM` is always **local time** read live at write time (CLOCK law, section 3).
- Journal is **newest-first**: every new line is prepended at the very top (below a
  `— pinned —` marker when present). Never delete or reorder existing lines.
- **v3 hard ceiling:** an In Progress card may NEVER go more than **4 real minutes**
  without a new journal line; target cadence is every 2 minutes (SKILL:127, bridge:153).
- Sources cited below:
  - `bridge` = `F:\study\WebBuilding\projects\daymark-desktop\scripts\daymark-zcode-bridge.mjs`
    (feature level v3 — generic-line ban bridge:212-214, resume continuity bridge:204-211,
    4-min law bridge:153; NOTE the file header at bridge:2 still reads `// v2` — cosmetic, see section 7)
  - `relay` = `F:\study\Platforms\windows\automation\daymark-relay\relay.js`
    (feature level v3 — resume ORDER relay:327-334, hand escalation relay:403-409;
    header at relay:2 still reads `// v2` — cosmetic, see section 7)
  - `AIW` = `F:\study\WebBuilding\projects\daymark-desktop\android\app\src\main\java\com\michaelunkai\daymark\AiWorkspaceActivity.java`
  - `DWC` = `F:\study\WebBuilding\projects\daymark-desktop\android\app\src\main\java\com\michaelunkai\daymark\DaymarkWorkspaceClient.java`
  - `SKILL` = `C:\Users\Admin\.zcode\skills\task\SKILL.md` (USER LAWS v3 block at SKILL:123-130)

---

## 1. Contract table

| # | Button (Android + PC) | Exact line format (verbatim from code) | Who detects it | Detection regex (verbatim) | SLA | Required reply format |
|---|---|---|---|---|---|---|
| 1 | Message | `— message HH:MM — <text>` — writer `"\u2014 message " + stamp + " \u2014 " + text` (AIW:2107 region; DWC guaranteed-message channel) | bridge + relay + session duty-cycle | bridge `DEMAND_RE` alt 1: `—\s*message\s+(\d\d:\d\d)\s+—` (bridge:32); relay: word `message` via `JOURNAL_RE` (relay:22), `isDemandLine` `l.word === 'message'` (relay:363) | **dispatch ≤ 1 min** (relay unanswered-demand nudge at `orderAge >= 1`, relay:394); ack ≤ 2 min (SKILL:121); bridge dispatches a session after the demand is ≥ 2 min old (bridge demand gate) | `— ack HH:MM — RE: <their words> — <exactly what was done about it>` (SKILL:121, bridge NARRATION_LAW bridge:151-155) |
| 2 | Agents (Sub-agents) | `— ORDER HH:MM — sub-agents: <choice>` — writer `"\u2014 ORDER " + nowHHMM() + " \u2014 sub-agents: " + choice` via `DWC.buildOrderLine("agents", …)` (DWC:550-551); `<choice>` is `create N agents`, `stop all agents`, or `custom: <text>`; sent via `DWC.sendVerifiedOrder` (DWC:567) | bridge + relay + session duty-cycle | bridge `DEMAND_RE` alt 3: `ORDER\s+(\d\d:\d\d)\s+—\s*(?:sub-agents:|do this now:|hand:)` (bridge:32); relay: `l.word === 'order'` + `/^(sub-agents:|do this now:|hand:)/i` (relay:365) | **dispatch ≤ 1 min** (relay:394); ack ≤ 2 min; `create N agents` must create **exactly N** sub-agents via the Agent tool IMMEDIATELY (SKILL:129: receipts "within 1 minute") | `— ack HH:MM — RE: <their words> — <exactly what was done>`; agent orders: the ack must state exactly how many sub-agents were created and that they are running (SKILL:129) |
| 3 | Add-step | `— ORDER HH:MM — do this now: <text>; when finished continue exactly where you left off` — writer `DWC.buildOrderLine` default branch: `"\u2014 ORDER " + nowHHMM() + " \u2014 do this now: " + payload + "; when finished continue exactly where you left off"` (DWC:553-554) | bridge + relay + session duty-cycle | same as row 2 (bridge:32 alt 3; relay:365) | **dispatch ≤ 1 min** (relay:394); ack ≤ 2 min; execute the step, ack with the result, then continue exactly where left off | `— ack HH:MM — RE: <their words> — <exactly what was done>` |
| 4 | Board-relayed user text (PC) | `— update HH:MM — user message: <text>` (convention consumed by bridge `DEMAND_RE` alt 2, bridge:32, and SKILL duty-cycle) | bridge + relay + session duty-cycle | bridge `DEMAND_RE` alt 2: `update\s+(\d\d:\d\d)\s+—\s+user message:` (bridge:32); relay: `update` word + `user message:` prefix in `isDemandLine` | **dispatch ≤ 1 min** (relay:394); ack ≤ 2 min (SKILL:121) | `— ack HH:MM — RE: <their words> — <exactly what was done about it>` |
| 5 | **Hand** (✋ Hand, AIW:958-963) | `— ORDER HH:MM — hand: stop whatever you are doing right now and run /hand immediately` — writer `DWC.buildOrderLine("hand", …)`: `"\u2014 ORDER " + nowHHMM() + " \u2014 hand: stop whatever you are doing right now and run /hand immediately"` (DWC:554-556); sent via `sendVerifiedOrderForTask` (AIW:2690, DWC:567) | bridge + relay + session duty-cycle | bridge `DEMAND_RE` alt 3 includes `hand:` (bridge:32); relay: `/^(sub-agents:|do this now:|hand:)/i` (relay:365) plus `isHandDemand = pendingDemand && /hand:/i.test(pendingDemand.text \|\| '')` (relay:389) | **dispatch ≤ 1 min**: relay nudge at `orderAge >= 1` uses the hand-specific text (relay:394-398); **hand escalation**: acked but card still In Progress at `orderAge >= 5` → ONE absolute re-order per demand (relay:403-409) | run `/handoff` immediately (write the full handoff prompt, move the task to Finished, stop) and prepend `— ack HH:MM — RE: hand — <handoff written, task Finished>` (SKILL:130; relay:398) |
| 6 | **Retry** (↻ Retry, finished cards, AIW:1062-1063) | compound write: `— REOPENED HH:MM — continued by user order` + `— pinned —` + `— update HH:MM — session assigned and pinned for this task` (DWC `assignSession`, DWC:51, DWC:922-923 region), plus when a prompt was typed `— ORDER HH:MM — do this now: <prompt>; when finished continue exactly where you left off` (AIW:2588-2598, `DWC.buildOrderLine("step", prompt)`) | bridge `assignedNow` (structural: `— pinned —` in first non-empty lines) + bridge/relay demand paths for the optional ORDER line | structural `— pinned —` match (bridge `assignedNow`); ORDER line per row 3 | session spawned with `/task <title>` + laws (bridge `NARRATION_LAW`, bridge:151-155); **first narration ≤ 60 s after spawn**; if the card was PAUSED before, the prompt carries the RESUME CONTINUITY clause (bridge:204-211) | first `— update HH:MM —` within 60 s; optional prompt answered per row 3 |
| 7 | Assign-session | two-line write: `— pinned —` (DWC:51) then `— update HH:MM — session assigned and pinned for this task` (DWC:922-923 region) | bridge `assignedNow`; **launch signature cache** prevents relaunch on unchanged description (bridge:352-356) | structural match, no regex | session spawned with `/task <title>` + laws; **first narration ≤ 60 s**; **NO pre-launch journal line** — the card stays silent during the ≤ 20 s spawn window (v3 generic-line ban, bridge:212-214); wedge kill unchanged (demand ≥ 6 min + silent ≥ 5 min → kill + relaunch, once per task per 10 min) | not a demand — the session's first `— update HH:MM —` within 60 s is the response |
| 8 | Pause | `— PAUSED HH:MM —` — writer `"\u2014 " + marker + " " + stamp + " \u2014"` with `marker = "PAUSED"` (AIW pause/resume writer, AIW:1167-1168) | relay suspends the session process tree; bridge does NOTHING for the task while the newest marker is PAUSED (bridge:345-349); session duty-cycle stands down | relay `JOURNAL_RE` word `paused`, newest-of paused/resumed wins (relay:300-301); bridge `/—\s*(PAUSED\|RESUMED)\s+\d{1,2}:\d{2}\s+—/i` (bridge:288); Android read-back `\u2014\s*PAUSED\s+(?:[01]?\d\|2[0-3]):[0-5]\d\s*\u2014` (AIW:146-147) | effective on the next relay poll (POLL_MS = 20000); session must do nothing while newest pause line is PAUSED | none — machine-enforced suspension, not a demand |
| 9 | Resume | `— RESUMED HH:MM —` — same writer with `marker = "RESUMED"` (AIW:1167-1168). Relay then writes a **machine ORDER** (section 4): `— ORDER HH:MM — resumed: continue EXACTLY where the ledger below left off — …` (relay:330-332) | relay resumes the suspended process tree (relay:335-344) and injects the resume ORDER once per pause episode, keyed on the RESUMED line (relay:328-332) | relay word `resumed` (relay:300-301); resume-order gate `state.resumeOrders[task.id] !== newestPause.raw` (relay:329) | effective on the next relay poll; the session's FIRST update must quote the newest concrete ledger line and continue that exact work (SKILL:128 RESUME CONTINUITY; bridge:209) | `— ack HH:MM — resuming exactly where the ledger below left off: <quote of newest concrete line>` (bridge:209) |
| 10 | Pause-all / Resume-all (header pill, AIW:636-645) | per-task `— PAUSED HH:MM —` or `— RESUMED HH:MM —` on every currently-affected task — same writer as rows 8/9 (AIW:669: `"\u2014 " + (pausing ? "PAUSED" : "RESUMED") + " " + stamp + " \u2014"`) | same detectors as rows 8/9, applied per task | same as rows 8/9 | same as rows 8/9, per task; toast reports acted/failed counts (AIW:722-727) | none — machine-enforced |
| 11 | **Delete all** (finished header, AIW:780-781) | **no journal line** — machine UI action: arm-then-confirm ("Delete all" → "Tap again to delete N", 4 s disarm, AIW:787-796) → confirm dialog (AIW:808-813) → `DaymarkWorkspaceClient.deleteTask(syncKey, id)` per task (AIW:809 region; DWC:503-504 `applyWithRetry(syncKey, state -> state.getJSONObject("tasks").remove(taskId))`), then forced refresh | nothing — the tasks cease to exist; no session interaction | n/a | immediate after the two-tap confirm; nothing survives that belongs to the Finished bucket (full-snapshot scope guard, AIW:798-805) | none — no journal write, no demand |
| 12 | **Paused chip** (smart tab, AIW:479-486) | **no journal write** — read-only filter: shown only while ≥ 1 unfinished task is paused; membership `!task.completed && isTaskPaused(task)` (AIW:585-586); blink-free via the reused chip-signature render guard (AIW:437-505) | nothing — pure view state over the row-8 `PAUSED_MARKER` regex (AIW:146-147) | n/a | appears/disappears on state refresh only; writes nothing | none |
| 13 | **AUTO toggle** (To do header, "AUTO ○/●", AIW:777-785) | **no journal write of its own** — persists the `auto_run` pref (AIW:816-818) and assigns the first To do task through the same Assign-session path as row 7 ("no journal writes are made here", AIW:811-814); at most one assign per refresh, new task only after the previous one leaves In Progress (AIW:836-855) | same as row 7 once it assigns (structural `— pinned —`) | same as row 7 | same as row 7 for each task it assigns (first narration ≤ 60 s) | same as row 7 |
| 14 | Note / "What changed?" | `— update HH:MM — <text>` — the plain journal narration line (AIW note field label "What changed? (prepends — update HH:MM —)", AIW:2599+; `DWC.logUpdate` prepends the line) | counts as an **answer** to any demand above it (bridge `RESPONSE_RE`, bridge:38) but is itself never a demand | bridge `RESPONSE_RE`: `^—\s*(?:update|ack|heartbeat)\s/i` (bridge:38); relay words `update/heartbeat/ack` | narration law: ≥ 1 new line every 2 real minutes, **never more than 4** (SKILL:127, bridge:153); relay watchdog flags staleness and escalates on generic-only cards (relay:420-434) | n/a — this IS the narration/answer format |

### Rows added 2026-10-22 (every-button audit slice)

| # | Button (Android) | Exact line format (verbatim from code) | Write path | Honest-success verdict |
|---|---|---|---|---|
| 15 | **Move all** (header pill, AIW `showMoveAllDialog`/`runMoveAll`) | `— ORDER HH:MM — move-all: <section name>` prepended to ONE carrier card's FULL description, after a parallel volley of direct `sectionId` PATCHes (6 workers × 3 attempts, AIW `runMoveAll`) | instant direct PATCH + verified journal line | HONEST: the "Moved N cards" toast fires only when every PATCH landed AND the carrier journal PATCH returned without error; any failure toasts "Move-all did not fully land · restoring" and `refreshNow()` reverts the optimistic state |
| 16 | **⬡ Model** per-task override (card action, AIW `showModelDialog(task)` → `savePerTaskModel`) | `— ORDER HH:MM — model: <model id>` prepended to the task description; the override is also stored locally under `TASK_MODEL_PREF_PREFIX + taskId` | local pref + queue patch (`mutate` → direct per-task PATCH) | HONEST: the "Model … ordered for this session" toast fires only from `drainPendingOps` after an exception-free PATCH. The header ⬡ Model chip (no task) is a local pref + `publishModelChoice` write to the workspace "model" card — same verified-queue path |
| 17 | **█ Attach files (multi-select)** (create/message dialogs, AIW `attachButton` → `uploadQueueAndJournal`) | ONE journal line listing every uploaded id: `— update HH:MM — attachments: [attachment id=<id> name=<name>] [attachment id=… …]*` (AIW `uploadQueueAndJournal`; the per-file retry prepends the same single-id format) | direct upload per file (`DWC.uploadAttachment`; only a real server id marks a file done) + direct `prependJournalLine` | HONEST: failed uploads stay in the visible queue ("failed · tap to retry"); if the journal line fails, the id markers are appended to the message text instead — a file is never reported done without a server attachment id |
| 18 | **⎯ # Order** (To do AND In Progress cards, AIW `showTodoOrderDialog` → `reorderTodoTo`) | marker `— ORDER HH:MM — reorder: position <n>` + a parallel volley rewriting every sibling card's `order` (`DWC.patchOrdersParallel`); success is gated on the `verifyServerOrder` server read-back | instant direct PATCH volley + server read-back verify + one bridge-marker auto-retry | HONEST: "Order applied" toasts ONLY when the server's stored `order` equals the chosen position; on mismatch the verified marker line retries via `prependJournalLine` ("Order sent via bridge — applying"); total failure toasts "Could not apply the order · try again" — never a fake "applied" |

Every detector shares the same *unanswered* rule: a demand is unanswered while it sits
**above** the newest `— update —`/`— ack —`/`— heartbeat —` line (journal is
newest-first), and machine nudges answer nothing (bridge `demandAnswered`; relay
`isNewer` compare, relay:391-392).

Graduated enforcement for unanswered demands (all demand rows):

- **≥ 1 min unanswered** → relay prepends ONE demand-specific ORDER per distinct demand, tracked by `demandKey` (relay:382, 394-400); for hand demands the nudge text is the hand-specific `/handoff` order (relay:396-398).
- **≥ 2 min, no live session** → bridge dispatches one (retry budget: 5 per task per hour).
- **≥ 2 min, live session** → bridge nudges with `— ORDER HH:MM — ack-now: …`, max 2 per exact demand line; machine nudge lines never count as answers.
- **Silence wedge-kill (tightened 2026-10-22, was ≥ 6 min + silent ≥ 5 min)** → journal silent ≥ 1 min with a 150 s boot grace and ≥ 120 s between kills → the bridge wedge-kills the session tree. **kill → confirm-death → spawn law:** the kill is `taskkill /PID <pid> /T /F`, then the bridge POLLS the pid every 250 ms for up to ~3 s (`pidAlive`; `EPERM` = alive) and only after the old pid is confirmed dead (or the 3 s window lapses, replacement claim already held) does any replacement session spawn — zero overlap, bridge `killTreeConfirmed`.
- **Boilerplate-only card** → relay watchdog escalation every 5 min demanding fresh concrete work; a line matching `GENERIC_RE` (relay:420) is not "fresh work" (relay:432-434, 462).

---

## 2. The BANNED-PHRASES registry (v3) — NEVER-WRITE

No journal line may ever contain any of these 8 phrases (SKILL:125, USER LAWS v3 law 1;
mirrored in the bridge `NARRATION_LAW` "BANNED PHRASES — using any of them is a hard
failure", bridge:153). Every line must instead carry a concrete fact (step, number,
path, result) in ≤ 30 words:

| # | Banned phrase | Status |
|---|---|---|
| 1 | `launching a real ZCode session` | NEVER-WRITE |
| 2 | `a real ZCode session has been launched` | NEVER-WRITE |
| 3 | `it will confirm below` | NEVER-WRITE |
| 4 | `narrates its exact steps` | NEVER-WRITE |
| 5 | `working on it` | NEVER-WRITE |
| 6 | `still in progress` | NEVER-WRITE |
| 7 | `task is alive` | NEVER-WRITE |
| 8 | `will post its own update` | NEVER-WRITE |

Enforcement beyond the duty cycle: the v3 **generic-line ban** removed the bridge's
canned pre-launch journal line entirely — the card stays silent during the ≤ 20 s spawn
window instead of showing a canned launch phrase (bridge:212-214). The relay's
watchdog additionally refuses to count lines matching its `GENERIC_RE`
(`/(pinned|has been launched|will post its own updates|session assigned|still in progress|alive in progress|watchdog: task|no journal lines yet)/i`,
relay:420) as evidence of work (relay:432-434, 462).

---

## 3. The laws (verbatim summaries)

Every spawned session receives these as `HARD RULES, no exceptions` in its prompt
(bridge `NARRATION_LAW`, bridge:151-155); the session-side duty cycle repeats them every
2 minutes, and USER LAWS v3 live at SKILL:123-130.

1. **FIRST-UPDATE-FAST** — first `— update HH:MM —` line within 60 seconds of session
   start, right after reading the task (bridge NARRATION_LAW; on resume-after-pause the
   first line is instead the resume-continuity ack quoting the newest concrete ledger
   line, bridge:204-211).
2. **NARRATION + 4-MIN CEILING** — "at least every 2 and NEVER more than 4 real minutes
   (a card may never go 4+ minutes without a new line) prepend `— update HH:MM — <text>`"
   (bridge:153; SKILL:85, SKILL:127). Text = the EXACT step executing now plus its ACTUAL
   output, ≤ 30 words, new facts only. Banned phrases are a hard failure (section 2).
3. **ACK-FIRST** — the very next journal line after any unanswered user demand
   (`— message —`, `— ORDER —` sub-agents:/do this now:/hand:, user message:) MUST be the
   direct `— ack HH:MM — RE:` reply about exactly that demand (SKILL:121).
4. **CLOCK** — every `HH:MM` is the machine's LOCAL time read live at write time via
   `powershell -NoProfile -Command "Get-Date -Format 'HH:mm'"`; never computed, cached,
   or UTC (SKILL:122, bridge:153).
5. **USER LAWS v3 extras** (SKILL:126-130): TOKEN DIET (shortest lines, one GET serves
   read+prepend); AUTO-FINISH (move to Finished the millisecond the demand is implemented
   AND live-tested, no post-Finish writes); RESUME CONTINUITY (law 1 above); AGENT
   RECEIPTS within 1 minute; **HAND = /handoff** (a hand order means run /handoff
   immediately, write the handoff, move the task to Finished, stop — SKILL:130).

---

## 4. Machine-line registry — NEVER treat as a user demand

These prefixes are machine-written. Detectors MUST skip them (bridge `MACHINE_NUDGE_RE`
= `/watchdog escalation|unanswered message nudge|ack-now/i`, bridge:36; relay exclusion
`/watchdog escalation|unanswered message nudge|ack-now/i`, relay:361) and sessions MUST
NOT count them as work. v3 adds three machine ORDER lines (hand escalation, resume order)
to this registry — they are machine-written enforcement lines, never user demands:

| Prefix | Written by | Where |
|---|---|---|
| `— heartbeat HH:MM — watchdog: <newest work>` and `— heartbeat HH:MM — live: "<quoted work>"` | relay watchdog | relay watchdog block |
| `— ORDER HH:MM — watchdog escalation on task "<t>": …` | relay watchdog | relay:412-414 |
| `— ORDER HH:MM — REPLY NOW to the <word> above …` | relay unanswered-demand enforcer | relay:399 |
| `— ORDER HH:MM — hand order: run /handoff now (the handoff skill: perfect continuation handoff — write the full handoff prompt, move the task to Finished, stop) and prepend an ack.` | relay hand-demand nudge (≤ 1 min) | relay:396-398 |
| `— ORDER HH:MM — hand escalation: /handoff was ordered — produce the handoff, move this task to Finished and stop; a hand order is absolute.` | relay hand escalation (acked but In Progress ≥ 5 min; ONE per demand via `state.handEscalated`) | relay:405-409 |
| `— ORDER HH:MM — resumed: continue EXACTLY where the ledger below left off — re-read the full description, quote the newest concrete line in your first update, and continue that work with zero shortcuts and zero repeated work.` | relay RESUME-CONTINUITY ENFORCER (once per pause episode) | relay:327-332 |
| `— ORDER HH:MM — unanswered message nudge: reply to the message above now` | Android (max 2 per message) | AIW message channel |
| `— ORDER HH:MM — ack-now: the user's demand above still has no direct reply — …` | bridge nudge (max 2 per demand) | bridge |
| `— PAUSED HH:MM —` / `— RESUMED HH:MM —` | Android pause/resume buttons (single and all) | AIW:1167-1168, AIW:669 |
| `— REOPENED HH:MM — continued by user message` / `— continued by user order` | Android guaranteed channels (reopen-if-finished; also written by Retry) | DWC:569-571 region |
| `— pinned —` | Assign-session / Retry / AUTO (first line) | DWC:51 |
| `— update HH:MM — session assigned and pinned for this task` | Assign-session / Retry / AUTO | DWC:922-923 region |
| (v3: none — the bridge no longer writes a pre-launch line) | bridge launch (generic-line ban) | bridge:212-214 |

Structural note: `PAUSED`/`RESUMED`/`REOPENED`/`pinned`/`session assigned`/`resumed:`/
`hand order:`/`hand escalation:` never match a user demand *shape* except via the relay's
explicit verb list (`sub-agents:|do this now:|hand:` — relay:365), which the machine
prefixes above do not use as their payload start. Machine nudge lines additionally must
never be read as a session's answer (`demandAnswered` skips them).

---

## 5. Board limits and the compression rule

A task description is capped at **20,000 characters** (board size limit; a PATCH that
would exceed it fails with a size error — the failure the bridge prompt handles). When
the limit is hit:

- **Merge the OLDEST update lines (at the bottom) into one summary line preserving their
  meaning** (SKILL compression rule; bridge NARRATION_LAW: "if PATCH fails with a size
  error, first compress the OLDEST bottom lines into one summary line then retry").
- The **newest-at-top** ordering and the **2-minute narration cadence (4-min ceiling) are
  never relaxed** to make room.
- Never delete or reorder surviving lines; compression only collapses bottom history.

---

## 6. Adding a new button — checklist (unchanged)

1. **Pick the line prefix.** One em-dash-delimited word + `HH:MM` + payload, so
   `JOURNAL_RE` (relay:22) parses it: `^—\s*([A-Za-z]+)\s+(\d{1,2}:\d{2})\s+—\s*(.*)$`.
   User demands go through `— message —` / `— ORDER … — <verb>: …`; machine lines get
   their own word (see section 4) and must be added to BOTH exclusion regexes
   (bridge:36, relay:361) so no detector ever answers itself.
2. **Add the writer.** Android: build the exact line (prefer a `DWC.buildOrderLine`
   branch) and send it through `DWC.sendVerifiedOrder` / the guaranteed-message channel
   (read-back verified, reopen if finished). PC/other writers must prepend at the very
   top (below `— pinned —`) with a live local `HH:MM`.
3. **Add the detector.** Bridge: extend `DEMAND_RE` (bridge:32) if it is a demand, and
   update `assignedNow`/wedge logic if it changes session ownership; relay: extend
   `isDemandLine` (relay:360-366) or the pause/resume word handling.
4. **Add the skill law.** Update the duty-cycle ORDER CHECK, MESSAGE SLA, and USER LAWS
   block in `C:\Users\Admin\.zcode\skills\task\SKILL.md` (and the bridge `NARRATION_LAW`,
   bridge:151-155) so sessions know the new demand and its ack.
5. **Update this document** — new row in the contract table (section 1) with verbatim
   writer, detector, regex, SLA, and reply format, plus a registry row if machine-written.
6. **Add a row to the contract test.** `scripts/every-button-contract.test.mjs` must
   assert the exact line format byte-for-byte (em-dash U+2014) and that every documented
   regex matches the writer's output. A button without a passing test row is not shipped.

---

## 7. CHANGELOG v3 (2026-10-20 evening)

- Added row 5 **Hand** button: `— ORDER HH:MM — hand: stop whatever you are doing right now and run /hand immediately` (DWC:554-556, AIW:958-963); detected by bridge:32 `hand:` and relay:365/389.
- Added relay **hand escalation**: acked hand demand still In Progress ≥ 5 min → one absolute `/handoff` re-order per demand (relay:403-409); registered as a machine line (section 4).
- Added row 6 **Retry** on finished cards: reopen + pinned + optional `do this now:` ORDER in one write (AIW:2575-2607).
- Added row 11 **Delete all** (finished header): arm-then-confirm → immediate `DWC.deleteTask` per task, no journal write (AIW:787-820, DWC:503-504).
- Added row 12 **Paused chip** smart tab: read-only filter over `PAUSED_MARKER`, blink-free via reused signature guard (AIW:479-486, AIW:146-147, AIW:437-505).
- Added row 13 **AUTO toggle** in To do header: persists `auto_run`, assigns first To do task via the Assign path, writes no journal lines itself (AIW:777-855).
- Added row 10 **Pause-all / Resume-all** documentation (per-task PAUSED/RESUMED writes, AIW:636-669).
- Added relay **resume ORDER** machine line: `— ORDER HH:MM — resumed: continue EXACTLY where the ledger below left off …` once per pause episode (relay:327-332); SKILL law 5 RESUME CONTINUITY (SKILL:128).
- Added bridge **resume continuity** in the spawn prompt (pause-aware RESUME clause, bridge:204-211).
- **Generic-line ban:** bridge no longer writes a canned pre-launch journal line; silent ≤ 20 s spawn window (bridge:212-214).
- **4-min law** codified in the table header, law 2, and NARRATION_LAW (SKILL:127, bridge:153).
- Added section 2 BANNED-PHRASES registry (8 phrases, SKILL:125, bridge:153) and relay `GENERIC_RE` enforcement (relay:420).
- SLA tightened: relay demand nudge now fires at **≥ 1 min** (dispatch ≤ 1 min), previously ≥ 2 min (relay:394).
- Launch **signature cache** documented: bridge skips relaunch while `assignedNow` signature is unchanged (bridge:352-356).
- Machine-line registry: added hand order, hand escalation, and resume ORDER lines; removed the bridge pre-launch line (banned).

---

## 8. CHANGELOG 2026-10-22 (every-button audit slice)

- Added rows 15-18: **Move all**, **⬡ Model per-task override** (`— ORDER HH:MM — model: <id>`), **bulk attachments** (multi-select queue + a single `attachments:` journal line listing every attachment id), **# Order** (now on To do AND In Progress, success gated on the `verifyServerOrder` server read-back).
- Wedge-kill law tightened and documented: silence ≥ 1 min (150 s boot grace, one kill per 120 s per task), executed with the **kill → confirm-death → spawn** sequence — `taskkill /T /F`, then poll the pid every 250 ms up to ~3 s; no replacement spawns until the old pid is confirmed dead (bridge `killTreeConfirmed`; POLL_MS = 1_000).
- All four new paths audited HONEST-success: no toast reports success without a verified server write (rows 15-18).

---

*Verified against sources on 2026-10-20 (evening, feature level v3). Known cosmetic
mismatch: bridge:2 and relay:2 still read `// v2 — every-button-perfect` although all v3
features above are present in the code; relay's demand-format comment block (relay:349-352)
also omits `hand:` while the code at relay:365 handles it. The bridge's banned list
(bridge:153) lists `pinned` as its 8th phrase where SKILL:125 lists `will post its own
update` — the SKILL list is canonical for sessions; both treat all section-2 phrases as
hard failures.*
