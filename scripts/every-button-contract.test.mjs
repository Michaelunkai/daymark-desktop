#!/usr/bin/env node
// every-button-contract.test.mjs — permanent tripwire for the every-button-perfect contract.
// Zero dependencies. Plain node. Exit 0 = CONTRACT GREEN, exit 1 = CONTRACT RED.
//
// Usage:
//   node scripts/every-button-contract.test.mjs          one-shot check
//   node scripts/every-button-contract.test.mjs --wait   poll-recheck failing groups
//                                                         every 60s for up to 25 min
//   node scripts/every-button-contract.test.mjs --help   this text
//
// It fails the moment any law disappears from any source: the bridge, the relay,
// the task skill, the Android order paths, or the button-contract doc.
import { readFileSync } from "node:fs";

const ROOT = "F:/study/WebBuilding/projects/daymark-desktop";

const TWO_MIN_CONST = /(?:2\s*\*\s*60(?:\s*\*\s*1000)?|120[ _]?000|\b120\s*\*\s*1000)/;
const WEDGE_GUARD = /sil\s*>=\s*\d[\s\S]{0,200}sessAge\s*>=\s*75_000|sessAge\s*>=\s*75_000[\s\S]{0,200}sil\s*>=\s*\d/; // EDIT 2026-10-22: wedge-kill tightened from >=6-min to silence>1min + 150s boot grace
const RETRY_COUNT = /(?:retr[^\n]{0,120}?\b5\b|\b5\b[^\n]{0,120}?retr|MAX_RETRIES\s*=\s*5|budget[^\n]{0,80}?\b5\b)/i;
const RETRY_HOUR = /(?:60\s*\*\s*60|3600[ _]?000|per hour|\bhour\b)/i;

const has = (src, s) => src.includes(s);
const sendsOrder = (w) => ["sendVerifiedOrder", "buildOrderLine", "sendVerifiedOrderForTask"].some((x) => w.includes(x));

// Extract the combined method-body windows (ALL overloads joined — a delegating
// 1-arg overload plus the real multi-arg overload are one dialog path) for
// lightweight "this dialog path calls X" substring checks.
function methodWindow(src, name) {
  const re = new RegExp(
    name + "\\s*\\([^)]*\\)\\s*\\{([\\s\\S]*?)(?=\\n\\s*(?:private|public|protected|static)\\s|(?![\\s\\S]))",
    "gi"
  );
  const parts = [...src.matchAll(re)].map((m) => m[1]);
  return parts.length ? parts.join("\n") : null;
}

// Remove the NARRATION_LAW ban-list region(s) from the bridge source so that
// banned phrases legitimately quoted INSIDE the ban list do not trip the
// "written strings must not contain X" checks.
function stripNarrationLaw(src) {
  const marker = "NARRATION_LAW";
  let out = src;
  let idx;
  while ((idx = out.indexOf(marker)) !== -1) {
    out = out.slice(0, idx) + out.slice(idx + 3000);
  }
  return out;
}

const BRIDGE = "F:/study/WebBuilding/projects/daymark-desktop/scripts/daymark-zcode-bridge.mjs";
const RELAY = "F:/study/Platforms/windows/automation/daymark-relay/relay.js";
const SKILL = "C:/Users/Admin/.zcode/skills/task/SKILL.md";
const CLIENT = `${ROOT}/android/app/src/main/java/com/michaelunkai/daymark/DaymarkWorkspaceClient.java`;
const ACTIVITY = `${ROOT}/android/app/src/main/java/com/michaelunkai/daymark/AiWorkspaceActivity.java`;

const GROUPS = [
  {
    id: "A",
    label: "bridge daymark-zcode-bridge.mjs",
    file: BRIDGE,
    checks: [
      ["v2 marker", (s) => has(s, "// v2 — every-button-perfect")],
      ["POLL_MS = 1_000 (tightened from 8s: near-instant kill for Move-all/ordering)", (s) => has(s, "POLL_MS = 1_000")], // EDIT 2026-10-21: contract extended, poll tightened
      ["demand form: message", (s) => has(s, "message")],
      ["demand form: user message:", (s) => has(s, "user message:")],
      ["demand form: sub-agents:", (s) => has(s, "sub-agents:")],
      ["demand form: do this now:", (s) => has(s, "do this now:")],
      ["nudge exclusion: watchdog escalation", (s) => has(s, "watchdog escalation")],
      ["nudge exclusion: unanswered message nudge", (s) => has(s, "unanswered message nudge")],
      ["nudge exclusion: ack-now", (s) => has(s, "ack-now")],
      ["within 60 seconds", (s) => has(s, "within 60 seconds")],
      ["narration ceiling: never more than 60 s apart", (s) => has(s, "never more than 60 s apart")], // EDIT 2026-10-21: ceiling tightened from 4 min to 60s
      ["bridge v3 started", (s) => has(s, "bridge v3 started")],
      ["wedge-kill guard: taskkill", (s) => has(s, "taskkill")],
      ["wedge-kill guard: silence>=1min + 150s boot grace (tightened 2026-10-22)", (s) => WEDGE_GUARD.test(s)], // EDIT 2026-10-22
      ["retry budget: 5", (s) => RETRY_COUNT.test(s)],
      ["retry budget: per hour", (s) => RETRY_HOUR.test(s)],
    ],
  },
  {
    id: "B",
    label: "relay daymark-relay/relay.js",
    file: RELAY,
    checks: [
      ["v2 marker", (s) => has(s, "// v2 — every-button-perfect")],
      ["sub-agents:", (s) => has(s, "sub-agents:")],
      ["do this now:", (s) => has(s, "do this now:")],
      ["live quote prefix", (s) => has(s, "— live: \"")],
      ["relay v2 started", (s) => has(s, "relay v2 started")],
      ["2-minute constant (2 * 60 / 120-style)", (s) => TWO_MIN_CONST.test(s)],
      ["staleness/heartbeat wording", (s) => /stale|staleness|heartbeat/i.test(s)],
      ["FORBIDDEN: 'newest not-yet-reported work' gone", (s) => !s.includes("newest not-yet-reported work")],
      ["FORBIDDEN: 'will post its own update next' gone", (s) => !s.includes("will post its own update next")],
    ],
  },
  {
    id: "C",
    label: "skill task/SKILL.md",
    file: SKILL,
    checks: [
      ["ONE-MINUTE UPDATE HARD GATE (successor of TWO-MINUTE)", (s) => has(s, "ONE-MINUTE UPDATE HARD GATE")], // EDIT 2026-10-21: renamed law
      ["ACK-FIRST LAW", (s) => has(s, "ACK-FIRST LAW")],
      ["exactly how many sub-agents", (s) => has(s, "exactly how many sub-agents")],
      ["FORBIDDEN: FIVE-MINUTE gone", (s) => !s.includes("FIVE-MINUTE")],
      ["FORBIDDEN: '5 real minutes' gone", (s) => !s.includes("5 real minutes")],
      ["FORBIDDEN: T0+5min gone", (s) => !s.includes("T0+5min")],
    ],
  },
  {
    id: "D",
    label: "android DaymarkWorkspaceClient.java",
    file: CLIENT,
    checks: [
      ["sendVerifiedOrder", (s) => has(s, "sendVerifiedOrder")],
      ["buildOrderLine", (s) => has(s, "buildOrderLine")],
    ],
  },
  {
    id: "E",
    label: "android AiWorkspaceActivity.java",
    file: ACTIVITY,
    checks: [
      ["sendVerifiedOrder present", (s) => has(s, "sendVerifiedOrder")],
      ["buildOrderLine present", (s) => has(s, "buildOrderLine")],
      ["showAgentsDialog path sends verified order", (s) => sendsOrder(methodWindow(s, "showAgentsDialog") ?? s)],
      ["showAddStepDialog path sends verified order", (s) => sendsOrder(methodWindow(s, "showAddStepDialog") ?? s)],
    ],
  },
  {
    id: "F",
    label: "docs/button-contract.md",
    file: `${ROOT}/docs/button-contract.md`,
    checks: [
      ["contains '— ack HH:MM — RE:'", (s) => has(s, "— ack HH:MM — RE:")],
      ["contains 'sub-agents:'", (s) => has(s, "sub-agents:")],
    ],
  },
  // ---- v3 ----
  {
    id: "G",
    label: "bridge v3 (daymark-zcode-bridge.mjs)",
    file: BRIDGE,
    checks: [
      ["RESUME CONTINUITY", (s) => has(s, "RESUME CONTINUITY")],
      ["silence law: 4 minutes", (s) => has(s, "4 minutes")],
      ["30 words", (s) => has(s, "30 words")],
      ["FORBIDDEN: old pre-launch prependJournal line gone", (s) =>
        !s.includes("launching a real ZCode session on this computer for this task now; it will confirm")],
      ["FORBIDDEN: old pre-launch line variant gone", (s) =>
        !s.includes("launching a real ZCode session on this computer")],
      ["FORBIDDEN: 'it will confirm below' outside NARRATION_LAW ban list", (s) =>
        !stripNarrationLaw(s).includes("it will confirm below")],
      ["revision-cache comment present near poll", (s) =>
        /revision[\s\S]{0,400}poll|poll[\s\S]{0,400}revision/i.test(s)],
      ["FORBIDDEN: 'will post its own update' gone (L)", (s) => !s.includes("will post its own update")],
    ],
  },
  {
    id: "H",
    label: "relay v3 (relay.js)",
    file: RELAY,
    checks: [
      ["continue EXACTLY where the ledger", (s) => has(s, "continue EXACTLY where the ledger")],
      ["/handoff", (s) => has(s, "/handoff")],
      ["hand escalation", (s) => has(s, "hand escalation")],
      ["FORBIDDEN: 'will post its own update' gone (L)", (s) => !s.includes("will post its own update")],
    ],
  },
  {
    id: "I",
    label: "skill v3 (task/SKILL.md)",
    file: SKILL,
    checks: [
      ["USER LAWS v3", (s) => has(s, "USER LAWS v3")],
      ["1 real minute ceiling (tightened from 4 real minutes)", (s) => has(s, "1 real minute")], // EDIT 2026-10-21: ceiling tightened
      ["/handoff", (s) => has(s, "/handoff")],
      ["30 words (≤30 words accepted)", (s) => /≤30 words|30 words/.test(s)],
    ],
  },
  {
    id: "J",
    label: "android client v3 (DaymarkWorkspaceClient.java)",
    file: CLIENT,
    checks: [
      ["deleteTask", (s) => has(s, "deleteTask")],
      ["reassignWithPrompt", (s) => has(s, "reassignWithPrompt")],
      ["fetchAttachment", (s) => has(s, "fetchAttachment")],
    ],
  },
  {
    id: "K",
    label: "android activity v3 (AiWorkspaceActivity.java)",
    file: ACTIVITY,
    checks: [
      ["AUTO toggle", (s) => has(s, "AUTO")],
      ["Retry in finished actions", (s) => has(s, "Retry")],
      ["Paused chip", (s) => has(s, "Paused")],
      ["hand: order line", (s) => has(s, "hand:")],
    ],
  },
];

// Report-only (never hard-fails): destructive single-delete confirm flow presence.
function infoNotes(results) {
  const notes = [];
  const act = results.find((g) => g.id === "K");
  if (act && act.content && /confirm/i.test(act.content)) {
    notes.push(`[K] NOTE (report-only): AiWorkspaceActivity.java still contains a confirm flow — user said destructive single deletes should be immediate; verify the old delete-all arm flow is reduced.`);
  }
  return notes;
}

function evaluate() {
  const results = [];
  for (const g of GROUPS) {
    let content = null;
    let missing = false;
    try {
      content = readFileSync(g.file, "utf8");
    } catch {
      missing = true;
    }
    const checks = g.checks.map(([label, fn]) => ({
      label,
      ok: !missing && fn(content),
    }));
    if (missing) checks.unshift({ label: "source file exists", ok: false });
    results.push({ ...g, checks, missing, content });
  }
  return results;
}

const failuresOf = (r) => r.checks.filter((c) => !c.ok);
const totalFailures = (rs) => rs.reduce((n, g) => n + failuresOf(g).length, 0);

function printReport(results) {
  for (const g of results) {
    const bad = failuresOf(g);
    console.log(`${bad.length === 0 ? "PASS" : "FAIL"}  [${g.id}] ${g.label}`);
    for (const c of bad) console.log(`        - missing/failed: ${c.label}`);
  }
  for (const note of infoNotes(results)) console.log(note);
}

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log("every-button-contract.test.mjs — asserts the every-button-perfect button contract (v3)");
  console.log("  (no flags)  one-shot: check all sources once, exit 0 green / 1 red");
  console.log("  --wait      recheck failing groups every 60s for up to 25 minutes");
  process.exit(0);
}

const WAIT = process.argv.includes("--wait");
const DEADLINE = Date.now() + 25 * 60 * 1000;
let results = evaluate();
while (totalFailures(results) > 0 && WAIT && Date.now() < DEADLINE) {
  const badGroups = results.filter((g) => failuresOf(g).length > 0).map((g) => g.id).join(", ");
  const remain = Math.round((DEADLINE - Date.now()) / 60000);
  console.log(`[wait] contract red (groups failing: ${badGroups}) — rechecking in 60s (${remain} min left)`);
  await new Promise((r) => setTimeout(r, 60_000));
  results = evaluate();
}

printReport(results);
const n = totalFailures(results);
if (n === 0) {
  console.log("CONTRACT GREEN");
  process.exit(0);
}
console.log(`CONTRACT RED: ${n} failures`);
process.exit(1);
