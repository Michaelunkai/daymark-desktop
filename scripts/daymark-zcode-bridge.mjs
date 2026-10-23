#!/usr/bin/env node
// v2 — every-button-perfect
// Daymark → ZCode session bridge.
// Watches the AIControlPanel workspace; when a task carries an assigned session
// (server field `assignedSession`, or the client-side `— pinned —` first line the
// Assign-session button writes), launches a REAL ZCode session on this PC that
// runs that exact task (`/task <title>`), then journal-logs the launch.
import { spawn, spawnSync } from "node:child_process";
import { randomUUID, createHash, createDecipheriv } from "node:crypto";
import os from "node:os";
import { existsSync, mkdirSync, readFileSync, writeFileSync, openSync, appendFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

delete process.env.DAYMARK_AI_TOKEN;
// BACKEND LAW (2026-10-23): the Daymark local server on this PC is the
// permanent backend (cloud origin is dead for writes). No Codex / ChatGPT
// account is ever needed.
const DAYMARK_LOCAL_API_URL = "http://127.0.0.1:18780";
const DAYMARK_LOCAL_SYNC_KEY = "vY4K5cwv-slGKV-Of7E3bB";

const HOME = "C:/Users/Admin";
const STATE_DIR = "F:/backup/ai/daymark-zcode-bridge";
const STATE_FILE = join(STATE_DIR, "state.json");
const LOG_FILE = join(STATE_DIR, "bridge.log");
const LOCK_FILE = join(STATE_DIR, "bridge.lock");
const ZCODE_CLI = "F:/backup/windowsapps/installed/ZCode/resources/glm/zcode.cjs";
// Free OpenCode models run through the local opencode CLI (its free tier
// only serves the genuine opencode client; raw API gets 403 FreeTierError).
const OPENCODE_CLI = "F:/backup/opencode/bin/opencode.exe";
const CLI_DIR = "F:/study/WebBuilding/projects/daymark-desktop/cli";
// NEVER-DIE NET: a single unhandled rejection or stray throw must never kill
// the bridge — sessions, cards, and the user's live board depend on this
// process staying up. Every crash is logged and the loop continues.
process.on("unhandledRejection", (r) => {
  try { log("unhandledRejection:", String(r && r.message || r).slice(0, 300)); } catch {}
});
process.on("uncaughtException", (e) => {
  try { log("uncaughtException (continuing):", String(e && e.message || e).slice(0, 300)); } catch {}
});

const POLL_MS = 1_000; // 1s: a card moved out of In Progress is killed within ~1 s
const nvidiaRuns = new Map(); // taskId -> {aborted} — in-process NVIDIA agent runs

const PROJECT = "AIControlPanel";
// The workspace's "In Progress" section id — tasks outside it (Finished/To do)
// are never auto-launched or revived. Unset sectionId (defensive) is treated
// as In Progress so a schema surprise can never silently disable the bridge.
const IN_PROGRESS_SECTION = "section-f4273c48bb921753b1b6e73a";

// v2 demand detection — ONE pattern covering every user-originated demand line
// the AIControlPanel buttons write: message button ("— message HH:MM —"),
// board-relayed user text ("— update HH:MM — user message:"), Android Agents
// button ("— ORDER HH:MM — sub-agents:") and Add-step button
// ("— ORDER HH:MM — do this now:"). Em-dash is U+2014, like every journal line.
const DEMAND_RE = /—\s*(?:message\s+(\d\d:\d\d)\s+—|update\s+(\d\d:\d\d)\s+—\s+user message:|ORDER\s+(\d\d:\d\d)\s+—\s*(?:sub-agents:|do this now:|hand:))/i;
// Machine nudges (this bridge's ack-now, the watchdog's escalation, the message
// nudge) are NEVER user demands and NEVER count as answers — matching them
// would make the bridge respond to its own writes and feedback-loop forever.
const MACHINE_NUDGE_RE = /watchdog escalation|unanswered message nudge|ack-now/i;
// A session's answer to a demand: an update/ack/heartbeat line ABOVE it.
const RESPONSE_RE = /^—\s*(?:update|ack|heartbeat)\s/i;

const { createDaymarkClient, DEFAULT_API_URL } = await import(
  pathToFileURL(join(CLI_DIR, "client.mjs")).href
);
const { getAgentToken } = await import(pathToFileURL(join(CLI_DIR, "credential.mjs")).href);

mkdirSync(STATE_DIR, { recursive: true });
const log = (...a) => {
  const line = `[${new Date().toISOString()}] ${a.join(" ")}\n`;
  appendFileSync(openSync(LOG_FILE, "a"), line);
  if (process.env.BRIDGE_VERBOSE) process.stdout.write(line);
};

// single instance
try {
  const lock = JSON.parse(readFileSync(LOCK_FILE, "utf8"));
  if (lock.pid && lock.pid !== process.pid) {
    try { process.kill(lock.pid, 0); console.error("another bridge instance is running"); process.exit(0); } catch {}
  }
} catch {}
writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));

const state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : { launched: {} };

// In-process NVIDIA runs never survive a bridge restart (they live in this
// process): purge their records at boot so the launch gate re-arms cleanly.
if (state.launched || state.pending) {
  for (const store of [state.launched, state.pending]) {
    for (const tid of Object.keys(store || {})) {
      if (store[tid] && store[tid].nvidia) delete store[tid]; // in-memory only: the first periodic saveState persists it
    }
  }
}
const saveState = () => writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));

// STARTUP LOG CAP (4.13): bridge.log grows unbounded (session stdout pipes into
// it). Once per startup only: if it exceeds ~5 MB, keep the last 2000 lines.
try {
  if (statSync(LOG_FILE).size > 5 * 1024 * 1024) {
    const allLines = readFileSync(LOG_FILE, "utf8").split("\n");
    writeFileSync(LOG_FILE, allLines.slice(-2000).join("\n"));
    console.error("bridge.log truncated to last 2000 lines at startup");
  }
} catch {}

// ZERO-OVERLAP KILL (4.3): taskkill the tree, then CONFIRM the pid is really
// gone (poll process existence every 250 ms, up to ~3 s) BEFORE any replacement
// session spawns. EPERM means the process exists but is not ours => alive.
function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return !!(e && e.code === "EPERM"); }
}
const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));
async function killTreeConfirmed(pid, taskId) {
  for (let round = 0; round < 3; round++) {
    try {
      const k = spawn("taskkill", ["/PID", String(pid), "/T", "/F"]);
    k.on("error", (e) => log("taskkill failed for task", taskId, e.message || e));
  } catch (e) { log("taskkill spawn threw for task", taskId, e.message || e); }
    for (let i = 0; i < 8; i++) {
      await sleepMs(250);
      if (!pidAlive(pid)) { log("old pid " + pid + " confirmed dead for task " + taskId); return true; }
    }
    if (round === 1) {
      try { spawn("powershell", ["-NoProfile", "-Command", "Stop-Process -Id " + Number(pid) + " -Force"]); } catch (e) {}
      await sleepMs(1000);
      if (!pidAlive(pid)) { log("old pid " + pid + " confirmed dead (Stop-Process) for task " + taskId); return true; }
    }
  }
  log("old pid " + pid + " STILL ALIVE after ~10s for task " + taskId + " — ABORTING relaunch; retry next poll");
  return false;
}

const api = await createDaymarkClient({ apiUrl: DAYMARK_LOCAL_API_URL, token: DAYMARK_LOCAL_SYNC_KEY });
const V = "/api/agent/v1";
const withTimeout = (p, ms = 20_000) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), ms))]);
const req = async (method, path, opts) => {
  const r = await withTimeout(api.request(method, path, opts));
  if (r === null) { log("request timeout:", method, path); throw new Error("request timeout"); }
  return r;
};

// The board rejects descriptions over ~20,000 chars ("does not match the
// documented schema"). When a write would exceed the cap, compress the OLDEST
// (bottom) lines into one summary line — the newest-at-top journal and the
// mission ledger header are never touched. Returns the compressed description.
const DESC_CAP = 19_500;
function compressDescription(desc) {
  const lines = desc.split("\n");
  const pinned = lines[0] && lines[0].trim() === "— pinned —" ? lines[0] + "\n" : "";
  const body = pinned ? lines.slice(1) : lines;
  let cut = body.length - 1;
  while (cut >= 0) {
    const kept = body.slice(0, cut);
    const summary = "— update — older activity compressed to stay under the board size cap; full details: earlier lines of this card's history and its project ledger.";
    const candidate = pinned + kept.join("\n") + "\n" + summary + "\n" + body.slice(cut).slice(-2).join("\n");
    if (candidate.length <= DESC_CAP || cut === 0) return candidate;
    cut -= Math.max(4, Math.floor(cut / 10));
  }
  return desc;
}

async function prependJournal(taskId, prevDesc, line) {
  let desc = line + "\n" + prevDesc;
  try {
    await req("PATCH", `${V}/tasks/${encodeURIComponent(taskId)}`, {
      body: { description: desc },
      idempotencyKey: randomUUID(),
    });
    return;
  } catch (e) {
    const msg = String(e && e.message || e);
    if (!/schema|20\s*000|too large|size/i.test(msg)) throw e;
    // Board cap hit: compress oldest lines and retry once.
    log("description at board cap for task", taskId, "— compressing oldest lines and retrying");
    desc = compressDescription(desc);
    await req("PATCH", `${V}/tasks/${encodeURIComponent(taskId)}`, {
      body: { description: desc },
      idempotencyKey: randomUUID(),
    });
  }
}

const localHHMM = () => {
  const d = new Date();
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
};

// Age of a "HH:MM" journal stamp in minutes vs the live LOCAL clock; a negative
// age means the line was written before midnight → add 24h (midnight wrap).
// Returns null for impossible times (never trust a bad stamp).
function hhmmAgeMin(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  if (h > 23 || m > 59) return null;
  const now = new Date();
  let age = (now.getHours() * 60 + now.getMinutes()) - (h * 60 + m);
  if (age < 0) age += 24 * 60;
  return age;
}

// Newest user demand = first demand line from the TOP (journal is newest-first:
// prepends go on top). Machine nudges are skipped so the bridge never reacts
// to its own or the watchdog's writes.
function newestDemand(lines) {
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (MACHINE_NUDGE_RE.test(l)) continue;
    const m = l.match(DEMAND_RE);
    if (m) return { idx: i, line: l, time: m[1] || m[2] || m[3] };
  }
  return null;
}

// A demand is answered when an update/ack/heartbeat line sits strictly ABOVE it
// (i.e. newer). Machine nudges answer nothing.
function demandAnswered(lines, idx) {
  for (let i = 0; i < idx; i++) {
    const l = lines[i];
    if (MACHINE_NUDGE_RE.test(l)) continue;
    if (RESPONSE_RE.test(l)) return true;
  }
  return false;
}

// Minutes since the newest real journal activity. Bridge-written machine nudges
// are skipped: a nudge is not the session narrating, so it must not mask a wedge.
// No timestamped line at all → nothing recent → Infinity (fully wedged).
// META_FILLER_RE: session-churn boilerplate the bridge/relay themselves write.
// These lines are NOT progress - counting them as narration is how cards sat
// "updated" while nothing real was said (observed live: 7 cards, all filler).
const META_FILLER_RE = /took the task|was replaced|continues from the ledger|executing the mission ledger|watchdog escalation|unanswered message nudge|session assigned and pinned|silent session|resuming exactly where|mission ledger from the top/i;
function journalSilenceMin(lines) {
  for (const l of lines) {
    if (MACHINE_NUDGE_RE.test(l)) continue;
    if (META_FILLER_RE.test(l)) continue;
    // App-side broadcaster lines ("— progress HH:MM —") are status mirrors,
    // NOT session work: they must never reset the silence clock, or a card
    // with a dead session shows forever-fresh progress and never revives.
    if (/^\s*—\s*progress\s+\d\d:\d\d\s*—/.test(l)) continue;
    const m = l.match(/(\d\d:\d\d)/);
    if (m) {
      const age = hhmmAgeMin(m[1]);
      if (age !== null) return age;
    }
  }
  return Infinity;
}

if (!state.pending) state.pending = {};
if (!state.finishedAt) state.finishedAt = {};
if (!state.retries) state.retries = {};
if (!state.nudges) state.nudges = {};
if (!state.demandReplaced) state.demandReplaced = {};
if (!state.lastWedgeKill) state.lastWedgeKill = {};

function retryAllowed(taskId) {
  const now = Date.now();
  state.retries[taskId] = (state.retries[taskId] || []).filter((t) => now - t < 60 * 60 * 1000);
  // 12/hour: with the tightened revive cooldowns a task can legitimately
  // need a relaunch every ~5 min; the old budget of 5 left cards orphaned.
  return state.retries[taskId].length < 12;
}

const NARRATION_LAW_METERED = `METERED SESSION - EFFICIENCY LAW (prepaid credit: maximum token economy, zero capability loss):
(1) First update within 60 s: "- update HH:MM - <exact concrete first action>". No meta words (session, pid, bridge, ledger, resuming, replaced).
(2) CARD UPDATES: prepend one every 45-55 s (never let 60 s pass - the watchdog kills silent sessions): <=20 words, one NEW concrete fact (file:line, number, command result). Never repeat earlier lines.
(3) CONTEXT DIET (the big one - your transcript is re-billed every turn): use targeted reads only (grep/outline/read_slice, pipe long output through head -50); NEVER read a whole file when a range answers the question; never re-read a file you already read; never paste large outputs into your context - extract the number/line you need and move on. Keep tool loops short and delegate bulk multi-file work to sub-agents.
(4) ACK law: any user demand above your newest line gets an ack within 60 s, then execute it. No narration while a tool runs - one line before, one after with its output.
(5) MODEL LAW: sub-agents on account:zai-individual-coding-plan/GLM-5.3-Flash, thinking low.
(6) COMPLETION: fully implemented + live-verified -> move the card to Finished yourself and end. Paths in card text use forward slashes. PATCH updates via temp JSON payload, full description, newest line first.`;

const NARRATION_LAW = `HARD RULES, no exceptions:
(1) FIRST UPDATE FAST: prepend your first "— update HH:MM —" line within 60 seconds of session start and BEFORE YOUR FIRST TOOL CALL - the very first thing you do after reading the task is PATCH that line, then start working — name the EXACT concrete first action (file/command/step from the ledger). ZERO meta words in ANY line, first included: never write session, pid, bridge, ledger, resume/resuming, took the task, replaced — only the work itself.
(2) NARRATION LAW (10x FREQUENCY): prepend a - update line at least every 30 SECONDS and never more than 60 s apart for the WHOLE session - a card may never go 1+ minute without a new line) prepend "— update HH:MM — <text>" where HH:MM is LOCAL time read live with powershell -NoProfile -Command "Get-Date -Format 'HH:mm'" (never UTC, never computed, never future). ANTI-GENERIC LAW: every line must carry a NEW concrete artifact - a file path, a number, a command + its output, or a test result. Boilerplate (took the task, session replaced, continues from the ledger, working on X, still in progress) is FORBIDDEN and counts as silence to the bridge. TOKEN DIET: each update line ≤ 30 words, facts only, zero filler. Text = the EXACT step executing now plus its ACTUAL output (command, file:line, measured number, test result) in plain English. Every line carries NEW facts — never repeat earlier lines; during long waits report elapsed/ETA numbers. LONG-COMMAND RULE: before starting ANY command/tool step you expect to run longer than ~90 seconds (builds, installs, scans), FIRST prepend a line naming the exact command and its expected duration (e.g. "gradle assembleCompanionDebug, ~4 min"), and the moment it finishes prepend its real output. A step without a before-line and an after-line is a silence violation. BANNED PHRASES — using any of them is a hard failure: "launching a real ZCode session", "a real ZCode session has been launched", "it will confirm below", "narrates its exact steps", "working on it", "still in progress", "task is alive", "pinned".
(3) ACK-FIRST LAW (1-MINUTE SLA): re-read the description EVERY 60 SECONDS — schedule work in chunks that never block you longer than a minute. If ANY "— message —", "— ORDER —" or "user message:" line sits ABOVE your newest line, your VERY NEXT prepend — within ONE MINUTE of that demand landing — must be "— ack HH:MM — RE: <their words> — <exactly how you will work according to this demand, then what you already did>" about exactly that demand — no unrelated update may come first. For "sub-agents: create N agents": create exactly N sub-agents via the Agent tool IMMEDIATELY, then the ack line states exactly how many were created and are running. For "do this now:": execute it, ack with the result, then continue exactly where you left off. For "hand:": STOP your current step at once, run the /hand skill, and ack with what /hand took over.
(4) MODEL LAW: every sub-agent you create (Agent tool) must run on model account:zai-individual-coding-plan/GLM-5.3-Flash with thinking level low — set both "model:" and "thoughtLevel: low" in the agent definition file (or dispatch args) before dispatch. Never dispatch any agent on another model or higher thinking level.
(5) COMPLETION LAW: the moment your demand is fully implemented AND you personally ran the real deliverable live (actual command/test with captured output, not a code-read), move the task to the Finished section yourself via the API and END the session — no more narration after Finished. Never mark Finished with any aspect untested.
(5z) HAND COMPLETION LAW (absolute, under 5 minutes): a hand order means: (a) STOP your current step at once;
(b) run the /handoff skill NOW and save the handoff (the handoff task carries the full continuation prompt);
(c) prepend as the VERY FIRST line of THIS card exactly: /hand <name of the handoff you saved>  (that literal command plus the handoff name, nothing above it);
(d) move THIS card to the To do section via the API;
(e) end - the bridge will stop your process automatically once the card is out of In Progress.
The whole sequence must complete in under 5 minutes. Do not post anything above the /hand line.
(5a) LIVE AGENT COUNTS: while your sub-agents are working, EVERY update line must state the exact number still running, e.g. "...3 agents running (1 done, 1 streaming)" — the user watches that number in real time; when they finish, say so ("all 3 agents done").
(5b) ATTACHMENTS: if any line references "[attachment id=attXXXX name=…]", fetch it BEFORE acting: run "node C:/Temp/dmrun.mjs GET /api/agent/v1/attachments/attXXXX" (JSON contains dataBase64 + mimeType) and decode it (node: Buffer.from(dataBase64,"base64")) — read images with your vision, documents as text — then act on the user request that came with it.
(6a) ARTIFACT TRUTH LAW (absolute): when the user asks for the path to ANY script/executable/file you created, you MUST NOT quote it from memory, from the ledger, or from earlier conversation - the ledger records OLD artifacts and repeating them is a hard failure. Instead: enumerate the actual files on disk NOW (dir/Get-ChildItem/glob over the exact folders where you worked, or search for the script by what it does), sort by LastWriteTime, take the NEWEST one, LIVE-verify it exists this minute (Get-Item), and only then output that verified path. If a newer artifact replaced an older one, the newest wins - always.
(6b) PATH-SAFE LAW: card lines travel through JSON - raw backslashes in Windows paths get eaten (F:\\backup became F:ackup - observed live). Write every path in card text with FORWARD SLASHES (F:/backup/windowsapps/installed/...). The path still works in every tool and terminal.
(7) VISIBLE DELIVERABLES (user law): when the user asks for a script/executable/path "in a visible terminal", open a REAL new visible terminal window (start powershell/cmd with the output printed), keep it open, print the full forward-slash path, and name the window (title) after the task so the user can find it.
(6) Write card updates with node C:/Users/Admin/.zcode/skills/mark/scripts/dm-ops.mjs — GET the task, then PATCH via temp JSON payload file with the FULL description, your new line prepended at the very top (never delete/reorder existing lines); if PATCH fails with a size error, first compress the OLDEST bottom lines into one summary line then retry.`;

// Newest CONCRETE ledger line (skips machine nudges and pause markers), quoted
// for resume/revive lines — capped at 100 chars.
function newestLedgerQuote(desc) {
  const marker = /—\s*(?:PAUSED|RESUMED)\s+\d{1,2}:\d{2}\s+—/i;
  for (const l of String(desc || "").split("\n")) {
    const t = l.trim();
    if (!t || MACHINE_NUDGE_RE.test(t) || marker.test(t)) continue;
    if (!/\d\d:\d\d/.test(t)) continue;
    return t.length > 100 ? t.slice(0, 100) : t;
  }
  return "the mission ledger below";
}

// SPECIFIC first action for the 20s-survival line, derived from the task title
// and the newest 2 ledger lines. NEVER the banned launch phrases.
function firstAction(task, desc) {
  const hay = (String(task.content || task.title || "") + " " + String(desc || "").split("\n").slice(0, 2).join(" ")).toLowerCase();
  if (/qbittorrent|torrent|media|download|sonarr|radarr/.test(hay)) return "re-verifying the qBittorrent batch adds";
  if (/job|resume|application|career|hiring|lead/.test(hay)) return "screening the next job lead";
  if (/deploy|build|server|api|bug|fix|refactor/.test(hay)) return "running the next build/verify step in the ledger";
  return "executing the mission ledger from the top";
}


// ==== DAYMARK-USAGE-QUOTA BEGIN ====
// Always-on live quota feed for the app's 5h/7d meters. Mirrors the desktop
// app's recipe (main.mjs): decrypt the z.ai OAuth token from ZCode's
// credentials file (enc:v1 AES-256-GCM fallback), query
// api.z.ai/api/monitor/usage/quota/limit every 10s, and PUT the snapshot into
// the sync doc's preferences.usage ONLY when a number actually moved (or the
// heartbeat aged out) so the sync revision never churns on identical readings.
// The token is NEVER logged or persisted anywhere but in memory.
const ZAI_QUOTA_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
const ZAI_CREDENTIALS_PATH = "C:/Users/Admin/.zcode/v2/credentials.json";
const DAYMARK_SYNCKEY_PATH = "C:/Users/Admin/.zcode/synckey.txt";
const DAYMARK_USAGE_POLL_MS = 10_000;
let daymarkLastUsagePush = { signature: "", at: 0 };
let daymarkUsageInFlight = false;
function daymarkDecryptEncV1(value) {
  if (typeof value !== "string" || !value.startsWith("enc:v1:")) return value ?? "";
  const parts = value.slice("enc:v1:".length).split(".");
  if (parts.length !== 3) return "";
  try {
    const secret = "zcode-credential-fallback:" + os.platform() + ":" + os.homedir() + ":" + os.userInfo().username;
    const key = createHash("sha256").update(secret).digest();
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[0], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[1], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[2], "base64url")), decipher.final()]).toString("utf8");
  } catch { return ""; }
}
function daymarkZaiToken() {
  try {
    const credentials = JSON.parse(readFileSync(ZAI_CREDENTIALS_PATH, "utf8"));
    return daymarkDecryptEncV1(credentials["oauth:zai:access_token"] ?? "");
  } catch { return ""; }
}
function daymarkQuotaRemainingPct(limit) {
  const usage = Number(limit && limit.usage);
  let remaining;
  if (Number.isFinite(usage) && usage > 0 && limit.remaining != null) {
    remaining = (Number(limit.remaining) / usage) * 100;
  } else {
    remaining = 100 - Number(limit && limit.percentage);
  }
  if (!Number.isFinite(remaining)) return 100;
  return Math.round(Math.min(100, Math.max(0, remaining)));
}
function daymarkQuotaWindowKind(limit) {
  const unit = Number.parseInt(String(limit && limit.unit), 10);
  const number = Number.parseInt(String(limit && limit.number), 10);
  if (unit === 3 || number === 5) return "fiveHour";
  if (unit === 6 || number === 1) return "sevenDay";
  return "unknown";
}
async function daymarkUsageTick() {
  if (daymarkUsageInFlight) return;
  daymarkUsageInFlight = true;
  try {
    const token = daymarkZaiToken();
    if (!token) return;
    const response = await fetch(ZAI_QUOTA_URL, {
      headers: { authorization: token }, cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return;
    const payload = await response.json();
    const updatedAt = new Date().toISOString();
    const windows = { fiveHour: null, sevenDay: null };
    for (const limit of Array.isArray(payload && payload.data && payload.data.limits) ? payload.data.limits : []) {
      if (!limit || limit.planId || !limit.nextResetTime) continue;
      const kind = daymarkQuotaWindowKind(limit);
      if (kind === "unknown" || windows[kind]) continue;
      windows[kind] = { remainingPct: daymarkQuotaRemainingPct(limit), resetsAtMs: Number(limit.nextResetTime) || 0, updatedAt };
    }
    const snap = {
      fiveHour: windows.fiveHour || { remainingPct: 100, resetsAtMs: 0, updatedAt },
      sevenDay: windows.sevenDay || { remainingPct: 100, resetsAtMs: 0, updatedAt },
      updatedAt,
    };
    const signature = snap.fiveHour.remainingPct + "/" + snap.sevenDay.remainingPct + "/"
      + snap.fiveHour.resetsAtMs + "/" + snap.sevenDay.resetsAtMs;
    // Push ONLY when a quota value actually changed: every push bumps the
    // workspace revision and wakes every long-poll client (phone + PC app),
    // so a keep-alive re-push here churned revisions every ~10s and drowned
    // real sync traffic. Values stay accurate without re-pushing, and a failed
    // push leaves daymarkLastUsagePush untouched, so the next tick retries.
    if (signature === daymarkLastUsagePush.signature) return;
    const syncKey = readFileSync(DAYMARK_SYNCKEY_PATH, "utf8").trim();
    if (!syncKey) return;
    const syncEndpoint = DAYMARK_LOCAL_API_URL.replace(/\/+$/, "") + "/api/sync/" + encodeURIComponent(syncKey || DAYMARK_LOCAL_SYNC_KEY);
    const headers = { Accept: "application/json", "X-Daymark-Sync-Key": syncKey, Authorization: "Bearer " + syncKey };
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let currentState = null;
      const readResponse = await fetch(syncEndpoint, { headers, cache: "no-store", signal: AbortSignal.timeout(10_000) });
      if (!readResponse.ok) return;
      currentState = (await readResponse.json());
      const state = currentState && currentState.state ? currentState.state : null;
      if (!state) return;
      const nextState = JSON.parse(JSON.stringify(state));
      nextState.preferences = { ...(nextState.preferences ?? {}), usage: {
        fiveHour: snap.fiveHour, sevenDay: snap.sevenDay, updatedAt: Date.parse(snap.updatedAt),
      } };
      nextState.updatedAt = new Date().toISOString();
      const writeResponse = await fetch(syncEndpoint, {
        method: "PUT",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ state: nextState, expectedRevision: Number(state.revision ?? 0) }),
        signal: AbortSignal.timeout(10_000),
      });
      if (writeResponse.ok) {
        log("usage quota pushed:", signature);
        daymarkLastUsagePush = { signature, at: Date.now() };
        break;
      }
      if (writeResponse.status !== 409) { log("usage quota push failed with HTTP", writeResponse.status); return; }
    }
  } catch (error) {
    log("usage quota tick failed:", error && error.message);
  } finally {
    daymarkUsageInFlight = false;
  }
}
setInterval(() => { void daymarkUsageTick(); }, DAYMARK_USAGE_POLL_MS);
setTimeout(() => { void daymarkUsageTick(); }, 4_000);
// ==== DAYMARK-USAGE-QUOTA END ====

// ==== DAYMARK-MODEL-OVERRIDE-HELPERS BEGIN ====
// Per-task model override: a card journal line "\u2014 ORDER HH:MM \u2014 model: <id>"
// makes ONLY that task's session run on the chosen model via
// ZCODE_PERSONAL_PROVIDER_CONFIG_FILE. Accepted forms:
//   zai-metered-api/glm-5.3-flash | metered | payg | api  -> Z.ai Metered API (PAYG)
//   <anything>-free                                        -> OpenCode Zen free tier
//   <providerId>/<modelId>                                 -> generic pass-through
// No token -> default session untouched (zai-headless / GLM-5.3-Flash / low).
const DAYMARK_MODEL_LINE_RE = /^.*\u2014\s*ORDER[^\n]*\bmodel:\s*([A-Za-z0-9._:\/-]+).*$/m;
const DAYMARK_OVERRIDE_DIR = join(STATE_DIR, "model-overrides");
const PROVIDER_CONFIG_SRC = "C:/Users/Admin/.zcode/v2/provider_config.json";
const METERED_ZAI_API_KEY = "391f37c35bcf40f19cd6f8cd4d449774.C4v2oEkD86xgeem6";
let daymarkFreeModels = null; // cached id set from the live OpenCode catalog
function daymarkRefreshFreeModels() {
  fetch("https://opencode.ai/zen/v1/models", { signal: AbortSignal.timeout(8000) })
    .then((r) => r.json())
    .then((list) => {
      const ids = (Array.isArray(list) ? list : (list && list.data) || [])
        .map((m) => (typeof m === "string" ? m : m && m.id)).filter(Boolean);
      daymarkFreeModels = new Set(ids.filter((id) => id.includes("-free")));
      if (daymarkFreeModels.size) log("model override catalog:", daymarkFreeModels.size, "free models");
    })
    .catch(() => {});
}
function daymarkClassifyModel(raw) {
  const id = String(raw || "").trim();
  if (!id) return null;
  if (/^(metered|payg|api|glm-5\.3-flash)$/i.test(id)) return { providerId: "zai-metered-api", modelId: "glm-5.3-flash" };
  // OPENCODE REMOVED (user order): the opencode executor is out of the stack.
  // Any free/opencode token resolves to NO override -> the subscription
  // default runs, so a card can never be routed to the dead executor.
  if (id.endsWith("-free")) return null;
  if (/^opencode/i.test(id)) return null;
  if (id.includes("/")) {
    const i = id.indexOf("/");
    const providerId = id.slice(0, i);
    if (/^opencode/i.test(providerId)) return null;
    return { providerId, modelId: id.slice(i + 1) };
  }
  return null; // bare display names run the subscription default
}
// GLOBAL MODEL SWITCH: the workspace "model" card's newest "model: <id>"
// line is the master default for EVERY session without its own per-card
// override. The Android header chip / desktop app publishes there; flipping
// it re-routes all running sessions via the model-switch law within one poll.
let daymarkGlobalModelCache = { token: null, at: 0 };
function daymarkGlobalModelRaw() {
  const now = Date.now();
  if (daymarkGlobalModelCache.token !== null && now - daymarkGlobalModelCache.at < 15_000) return daymarkGlobalModelCache.token;
  if (daymarkGlobalModelCache.token === null) daymarkGlobalModelCache.at = now - 10_000; // retry the fetch every ~5 s until populated
  req("GET", V + "/tasks?limit=100")
    .then((r) => req("GET", V + "/tasks?limit=100&offset=100").catch(() => null).then((r2) => [r, r2]))
    .then(([r, r2]) => {
      const tasks = [((r && r.tasks) || []), ((r2 && r2.tasks) || [])].flat();
      const card = tasks.find((t) => String(t.content || t.title || "").toLowerCase() === "model");
      const desc = card ? String(card.description || "") : "";
      let m = desc.match(/^\s*model:\s*(.+)$/m);
      if (!m && state.globalModel) m = [null, state.globalModel]; // card churned - keep last known global choice
      if (m) {
        daymarkGlobalModelCache.token = m[1].trim();
        state.globalModel = daymarkGlobalModelCache.token;
        saveState();
      }
      daymarkGlobalModelCache.at = Date.now();
      log("global model card:", daymarkGlobalModelCache.token || ("(churned - keeping " + (state.globalModel || "none") + ")"), "| card:", card ? card.id : "NOT FOUND", "| descLen:", desc.length);
    })
    .catch(() => {});
  return daymarkGlobalModelCache.token;
}
function daymarkGlobalModel() {
  const token = daymarkGlobalModelRaw();
  if (!token || /^default$/i.test(token)) return null;
  const pick = daymarkClassifyModel(token);
  return pick ? pick.providerId + "/" + pick.modelId : null;
}
function daymarkPeekModel(taskId, description) {
  // Classified model token for a card ("provider/model"), or null when the
  // card carries no override (or an explicit "default" reset). Used by the
  // model-switch law to compare against the launched session's record.
  const m = String(description || "").match(DAYMARK_MODEL_LINE_RE);
  if (!m) return null;
  const token = m[1].trim();
  if (!token || /^default$/i.test(token)) return null;
  const pick = daymarkClassifyModel(token);
  return pick ? pick.providerId + "/" + pick.modelId : null;
}
function daymarkResolveModelForTask(taskId, description) {
  let m = String(description || "").match(DAYMARK_MODEL_LINE_RE);
  if (!m && state.taskModels && state.taskModels[taskId]) {
    // PERMANENT CHOICE: the pick outlives journal compression/churn - once
    // the user (or failover) chose a model for a task it never silently
    // falls back to default. Only an explicit "model: default" line clears it.
    m = [null, String(state.taskModels[taskId]).replace(/^opencode\//, "")];
  }
  if (!m) return null;
  const pick = daymarkClassifyModel(m[1]);
  if (!pick) return null;
  if (/^default$/i.test(m[1].trim())) {
    // OUTAGE OVERRIDES DEFAULT: while the subscription/API provider refuses
    // model resolution, an explicit default pick still rides the keyless
    // free model so the session never stalls (window: 30 min from last outage).
    if (state.providerModelBrokenAt && Date.now() - state.providerModelBrokenAt < 30 * 60_000) {
      // OPENCODE REMOVED: the free executor is gone — an explicit default pick is simply no override.
      return null;
    }
    return null; // explicit reset -> no override
  }
  if (pick.providerId === "opencode-zen-chat" && daymarkFreeModels && daymarkFreeModels.size >= 10 && !daymarkFreeModels.has(pick.modelId) && !daymarkFreeModels.has("opencode/" + pick.modelId) && !pick.modelId.endsWith("-free")) {
    log("model override rejected for task", taskId, "\u2014 id not in free catalog:", pick.modelId);
    return null;
  }
  try {
    mkdirSync(DAYMARK_OVERRIDE_DIR, { recursive: true });
    const base = JSON.parse(readFileSync(PROVIDER_CONFIG_SRC, "utf-8"));
    if (pick.providerId !== "opencode-zen-chat") {
      // Template-based providers (e.g. zai-standard-api) must be declared as a
      // MINIMAL personal rule: templateId + group + access.apiKey + personalModelIds.
      // Overriding api{baseUrl,type} here breaks model resolution in the CLI.
      const rules = (base.config && base.config.providerConfigRules && base.config.providerConfigRules.providerRules) || [];
      if (!rules.some((x) => x.providerId === pick.providerId)) {
        rules.push({ providerId: pick.providerId, templateId: pick.providerId,
          providerName: pick.providerId,
          config: { group: "standard-personal",
            access: { type: "api-key", apiKey: METERED_ZAI_API_KEY },
            personalModelIds: [pick.modelId] } });
        base.config.providerConfigRules = base.config.providerConfigRules || {};
        base.config.providerConfigRules.providerRules = rules;
      }
      const order = base.config.providerOrder || [];
      if (!order.includes(pick.providerId)) order.push(pick.providerId);
    } else {
      const rules = (base.config && base.config.providerConfigRules && base.config.providerConfigRules.providerRules) || [];
      if (!rules.some((r) => r.providerId === "opencode-zen-chat")) {
        rules.push({ providerId: "opencode-zen-chat", templateId: "opencode-zen-chat",
          providerName: "OpenCode Zen (Chat)", config: { group: "standard-personal", personalModelIds: [], modelOrder: [] } });
        base.config.providerConfigRules = base.config.providerConfigRules || {};
        base.config.providerConfigRules.providerRules = rules;
      }
      const order = base.config.providerOrder || [];
      if (!order.includes("opencode-zen-chat")) order.push("opencode-zen-chat");
    }
    base.config.defaultModelSelection = {
      providerId: pick.providerId, modelId: pick.modelId, options: { reasoningLevel: "low" }
    };
    const safe = (pick.providerId + "-" + pick.modelId).replace(/[^A-Za-z0-9._-]/g, "_");
    const file = join(DAYMARK_OVERRIDE_DIR, "prov-" + safe + ".json");
    writeFileSync(file, JSON.stringify(base));
    return { modelId: pick.providerId + "/" + pick.modelId, file };
  } catch (e) { log("model override config build failed:", e && e.message); return null; }
}
daymarkRefreshFreeModels();
// ==== DAYMARK-FAILOVER-ENGINE BEGIN ====
// DUAL-PROVIDER NEVER-STOP LAW: sessions must never stop for a limit while
// EITHER side has capacity. Two exhaustion detectors drive forced overrides:
//  - metered exhaustion: session stderr shows insufficient credit/balance
//    (Z.ai codes 1113/402) -> forcedModel[task] = subscription (default).
//  - subscription exhaustion: the live quota monitor reports both windows
//    exhausted -> forcedModel[task] = zai-metered-api/GLM-5.3-Flash.
// forcedModel clears automatically when that side recovers (probe / quota).
const FAILOVER_STATE = () => {
  if (!state.forcedModel) state.forcedModel = {};
  return state.forcedModel;
};
const METERED_EXHAUST_RE = /1113|insufficient|out of credit|credit.*exhaust|balance.*insufficient|402|1002|invalid api key|api key.*invalid|unauthorized|authentication/i;
const SUB_EXHAUST_RE = /quota|limit reached|exhaust|rate.?limit.*cap|subscription.*limit/i;
function daymarkFailoverJournal(taskId, text) {
  // Best-effort real-time visibility on the card itself (paused cards stay frozen).
  (async () => {
    try {
      const r = await req("GET", V + "/tasks/" + encodeURIComponent(taskId));
      if (!r || !r.task || typeof r.task.description !== "string") return;
      if (isNewestPaused(r.task.description)) return;
      const stamp = new Date().toLocaleTimeString("en-GB", { hour12: false }).slice(0, 5);
      const line = "— update " + stamp + " — " + text;
      let desc = String(r.task.description || "");
      // BOARD CAP SAFETY: the server rejects descriptions over 20k chars —
      // drop oldest (bottom) lines until the prepended result fits.
      while (line.length + 1 + desc.length > 19_500 && desc.includes("\n")) {
        desc = desc.slice(0, desc.lastIndexOf("\n"));
      }
      if (line.length + 1 + desc.length > 19_500) desc = desc.slice(0, Math.max(0, 19_500 - line.length - 1));
      await req("PATCH", V + "/tasks/" + encodeURIComponent(taskId), {
        body: { description: line + "\n" + desc },
        idempotencyKey: randomUUID(),
      });
    } catch (e) { log("failover journal failed:", e && e.message); }
  })();
}
function daymarkBuildMeteredOverride() {
  try {
    const base = JSON.parse(readFileSync(PROVIDER_CONFIG_SRC, "utf-8"));
    base.config.defaultModelSelection = { providerId: "zai-metered-api", modelId: "GLM-5.3-Flash", options: { reasoningLevel: "low" } };
    mkdirSync(DAYMARK_OVERRIDE_DIR, { recursive: true });
    const file = join(DAYMARK_OVERRIDE_DIR, "prov-failover-metered.json");
    writeFileSync(file, JSON.stringify(base));
    return { modelId: "zai-metered-api/GLM-5.3-Flash", file };
  } catch (e) { log("failover build failed:", e && e.message); return null; }
}
function daymarkApplyFailover(task, child, modelOverride) {
  // PROVIDER-OUTAGE HARD RULE: while the paid providers refuse model
  // resolution (30 min from last confirmed outage), EVERY launch resolves
  // to the keyless free model - no forced state, no flip-flop, no exceptions.
  if (state.providerModelBrokenAt && Date.now() - state.providerModelBrokenAt < 30 * 60_000) {
    if (modelOverride && String(modelOverride.modelId || "").endsWith("-free")) return modelOverride;
    const forcedFree = daymarkResolveModelForTask(task.id, "\u2014 ORDER \u2014 model: glm-5.3-flash-free");
    if (forcedFree) { log("failover: task", task.id, "-> PROVIDER OUTAGE: forcing free glm-5.3-flash-free"); return forcedFree; }
  }
  // FREE-MODEL SUPREMACY: a free override is keyless and always available -
  // it outranks every failover force (metered/subscription) without exception.
  // The session must NEVER be null-ed onto a dead paid provider while a free
    // model is picked on the card.
  if (modelOverride && String(modelOverride.modelId || "").endsWith("-free")) return modelOverride;
  const forced = FAILOVER_STATE()[task.id];
  // AUTO-RETRY: a forced provider releases after 10 minutes so the other side
  // is periodically re-tried; a healthy release returns to the card's choice.
  if (forced === "subscription" && state.forcedAt && state.forcedAt[task.id] && Date.now() - state.forcedAt[task.id] > 10 * 60 * 1000) {
    delete FAILOVER_STATE()[task.id];
    delete state.forcedAt[task.id];
    saveState();
    log("failover: 10-minute hold elapsed for task", task.id, "— retrying the card's chosen model");
    if (modelOverride && String(modelOverride.modelId || "").startsWith("zai-metered-api")) {
      log("failover: task", task.id, "-> hold released but metered pick has no explicit card ORDER — subscription default wins");
      return null;
    }
    return daymarkApplyFailover(task, child, modelOverride);
  }
  // Subscription exhausted + the card carries no explicit model choice ->
  // route to the metered API so the session never stops for a limit.
  if (!forced && !modelOverride && state.subExhausted) {
    log("failover: task", task.id, "-> metered (subscription exhausted, default card)");
    const m = daymarkBuildMeteredOverride();
    if (m) return m;
  }
  if (forced === "metered") {
    if (modelOverride && (modelOverride.free || (state.providerModelBrokenAt && Date.now() - state.providerModelBrokenAt < 30 * 60_000))) {
      log("failover: task", task.id, "-> free override outranks forced metered (provider outage)");
      return modelOverride;
    }
    if (!modelOverride || !String(modelOverride.modelId).startsWith("zai-metered-api")) {
      const m = daymarkBuildMeteredOverride();
      if (m) { log("failover: task", task.id, "-> metered (subscription exhausted)"); return m; }
      return modelOverride;
    }
    return modelOverride;
  }
  if (FAILOVER_STATE()[task.id] === "subscription" && modelOverride && String(modelOverride.modelId || "").startsWith("zai-metered-api") && !state.subExhausted) {
    log("failover: task", task.id, "-> subscription hold active — metered override suppressed, default wins");
    return null;
  }
  if (forced === "subscription" && modelOverride) {
    // OUTAGE WINS: a free override during a provider outage always runs -
    // the session must never be nulled onto a dead subscription.
    if (modelOverride.free || (state.providerModelBrokenAt && Date.now() - state.providerModelBrokenAt < 30 * 60_000)) {
      log("failover: task", task.id, "-> free override outranks forced subscription (provider outage)");
      return modelOverride;
    }
    log("failover: task", task.id, "-> subscription (metered exhausted)");
    return null;
  }
  return modelOverride;
}
function daymarkHandleSessionDeath(taskId, errText) {
  if (!errText || String(errText).length > 4000) return;
  if (/Select a model before sending/i.test(String(errText))) {
    if (state.forcedModel) { delete state.forcedModel[taskId]; saveState(); }
    // Provider refused model resolution (quota/auth outage): fall this task
    // over to the keyless free opencode model so it keeps RUNNING. Only the
    // user picking a model (or default) overrides this again.
    if ((state.taskModels || {})[taskId] !== "opencode/glm-5.3-flash-free") {
      state.taskModels = state.taskModels || {};
      state.taskModels[taskId] = "opencode/glm-5.3-flash-free";
      state.providerModelBrokenAt = Date.now();
      saveState();
      log("FAILOVER: provider refused model on task", taskId, "-> opencode/glm-5.3-flash-free (free)");
      daymarkFailoverJournal(taskId, "the API/subscription model stopped resolving (out of credit or limit) — this session automatically switched to the free glm-5.3-flash-free so it never stalls. Pick any model on the card to change it.");
    }
    return;
  }
  const text = String(errText);
  if (METERED_EXHAUST_RE.test(text)) {
    FAILOVER_STATE()[taskId] = "subscription";
    saveState();
    log("FAILOVER: metered exhausted on task", taskId, "-> subscription");
    daymarkFailoverJournal(taskId, "metered API out of credit — switched this session to the subscription automatically");
    daymarkMeteredProbe();
  } else if (SUB_EXHAUST_RE.test(text)) {
    FAILOVER_STATE()[taskId] = "metered";
    saveState();
    log("FAILOVER: subscription limit on task", taskId, "-> metered");
    daymarkFailoverJournal(taskId, "subscription limit hit — switched this session to the metered API automatically");
  }
}
// Subscription capacity watch: clears metered-forced entries when a window
// has room again. Runs at most once a minute inside the poll loop.
let daymarkLastQuotaCheck = 0;
function daymarkQuotaWatch() {
  const now = Date.now();
  if (now - daymarkLastQuotaCheck < 60_000) return;
  daymarkLastQuotaCheck = now;
  try {
    const credFile = "C:/Users/Admin/.zcode/v2/credentials.json";
    const c = JSON.parse(readFileSync(credFile, "utf-8"));
    const k = createHash("sha256").update("zcode-credential-fallback:" + process.platform + ":" + "C:\\Users\\Admin" + ":" + "Admin").digest();
    function d(v) { if (!v.startsWith("enc:v1:")) return v; const q = v.slice(7).split("."); if (q.length !== 3) return "";
      const dec = createDecipheriv("aes-256-gcm", k, Buffer.from(q[0], "base64url")); dec.setAuthTag(Buffer.from(q[1], "base64url"));
      return Buffer.concat([dec.update(Buffer.from(q[2], "base64url")), dec.final()]).toString("utf8"); }
    const token = d(c["oauth:zai:access_token"] || "");
    if (!token) { log("quota watch: no token"); return; }
    fetch("https://api.z.ai/api/monitor/usage/quota/limit", { headers: { authorization: token }, signal: AbortSignal.timeout(8000) })
      .then((r) => r.json())
      .then((j) => {
        const limits = (j.data && j.data.limits) || [];
        const exhausted = limits.length > 0 && limits.every((l) => (Number(l.remaining) || 0) <= 0 || (Number(l.percentage) || 0) >= 100);
        state.subExhausted = exhausted;
        // Recovery probe: while any task is forced to the subscription, keep
        // testing the metered key so a top-up restores the chosen model automatically.
        const forcedNow = FAILOVER_STATE();
        if (Object.values(forcedNow).some((v) => v === "subscription")) daymarkMeteredProbe();
        if (!exhausted) {
          const forced = FAILOVER_STATE();
          let cleared = 0;
          for (const tid of Object.keys(forced)) if (forced[tid] === "metered") { delete forced[tid]; cleared++; }
          if (cleared) { saveState(); log("failover: subscription has capacity again — cleared", cleared, "metered overrides"); }
        } else saveState();
      })
      .catch((e) => log("quota watch fetch failed:", e && e.message));
  } catch (e) { log("quota watch setup failed:", e && e.message); }
}
// Metered liveness probe: on suspected exhaustion, try a 1-token call; a
// success (e.g. after a top-up) clears the forced-subscription overrides.
let daymarkLastMeteredProbe = 0;
function daymarkMeteredProbe(deadTaskId) {
  const now = Date.now();
  if (!deadTaskId && now - daymarkLastMeteredProbe < 120_000) return;
  if (deadTaskId && now - (daymarkLastMeteredProbe + 120_000) < 0 && FAILOVER_STATE()[deadTaskId] === "metered-probe") { /* still probing */ }
  daymarkLastMeteredProbe = now;
  fetch("https://api.z.ai/api/paas/v4/chat/completions", {
    method: "POST",
    headers: { "Authorization": "Bearer " + METERED_ZAI_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "glm-5.3-flash", messages: [{ role: "user", content: "1" }], max_tokens: 1, thinking: { type: "enabled", reasoning_effort: "low" } }),
    signal: AbortSignal.timeout(15000),
  }).then((r) => r.json()).then((j) => {
    const forced = FAILOVER_STATE();
    if (j && j.choices) {
      // Metered side is alive: clear any forced-subscription entries and any
      // pending probe marker; a top-up or transient glitch recovers itself.
      let cleared = 0;
      for (const tid of Object.keys(forced)) {
        const heldAt = (state.forcedAt && state.forcedAt[tid]) || 0;
        if ((forced[tid] === "subscription" || forced[tid] === "metered-probe") && Date.now() - heldAt > 10 * 60 * 1000) { delete forced[tid]; cleared++; }
      }
      if (cleared) { saveState(); log("failover: metered has credit again — cleared", cleared, "subscription overrides"); }
      return;
    }
    // Probe failed: the metered side is genuinely unavailable.
    log("failover probe: metered unavailable", j && j.error && j.error.code ? "(code " + j.error.code + ")" : "");
    let switched = 0;
    for (const tid of Object.keys(forced)) {
      if (forced[tid] === "metered-probe") {
        forced[tid] = "subscription";
        state.forcedAt = state.forcedAt || {};
        state.forcedAt[tid] = Date.now();
        switched++;
        if (tid === deadTaskId || deadTaskId === undefined) {
          daymarkFailoverJournal(tid, "metered API unavailable — switched this session to the subscription automatically");
        }
      }
    }
    if (deadTaskId && forced[deadTaskId] !== "subscription") {
      forced[deadTaskId] = "subscription";
      state.forcedAt = state.forcedAt || {};
      state.forcedAt[deadTaskId] = Date.now();
      switched++;
      daymarkFailoverJournal(deadTaskId, "metered API unavailable — switched this session to the subscription automatically");
    }
    if (switched) { saveState(); log("FAILOVER: metered unavailable — forced subscription on", switched, "task(s)"); }
  }).catch((e) => { log("failover probe error:", e && e.message); });
}
// ==== DAYMARK-FAILOVER-ENGINE END ====
// ==== DAYMARK-MODEL-OVERRIDE-HELPERS END ====
async function launchSession(task) {
  // SPAWN SPACING: overlapping zcode boots on one machine collide and die
  // with "Unexpected server error" before posting anything. Minimum 8 s
  // between any two spawns; the claim stays open so the launch retries.
  const sinceLast = Date.now() - (state.lastSpawnAt || 0);
  if (sinceLast < 20000) { log("launch deferred for task", task.id, "— spawn spacing", (20000 - sinceLast) + "ms"); return; }
  // FAST-DEATH COOLDOWN: a spawn that died within 20 s is retried at most
  // once per 120 s per task - boot collisions and provider refusals never
  // turn into per-poll spawn storms again.
  if (state.lastFastDeath && state.lastFastDeath[task.id] && Date.now() - state.lastFastDeath[task.id] < 120_000) {
    log("launch deferred for task", task.id, "— fast-death cooldown", Math.ceil((120_000 - (Date.now() - state.lastFastDeath[task.id])) / 1000) + "s");
    delete state.pending[task.id];
    saveState();
    return;
  }
  const title = task.content || task.title || task.id;
  // Dedupe guard: claim the task's launch slot SYNCHRONOUSLY, before any await.
  // A concurrent poll pass must never see no record and launch a SECOND session
  // for the same card (observed live: two sessions fighting over one description).
  const existing = state.pending[task.id] || state.launched[task.id];
  if (existing) {
    const ageMs = Date.now() - (Date.parse(existing.at) || 0);
    if (ageMs < 10 * 60 * 1000) { log("launch skipped for task", task.id, "— a launch is already recorded (age", Math.round(ageMs / 1000) + "s)"); return; }
  }
  state.pending[task.id] = { at: new Date().toISOString(), pid: null };
  saveState();
  log("launching zcode session for task", task.id, JSON.stringify(title));
  // Re-read the live description before prepending: writing from a stale
  // snapshot (e.g. the wedge-replacement line written seconds ago) would
  // silently DELETE it — journal lines must never be lost to a stale
  // read-modify-write. On fetch failure fall back to the snapshot we have.
  let prevDesc = task.description || "";
  try {
    const r = await req("GET", `${V}/tasks/${encodeURIComponent(task.id)}`);
    if (r && r.task && typeof r.task.description === "string") prevDesc = r.task.description;
  } catch {}
  // RESUME CONTINUITY (v3): a card that was paused before gets an explicit
  // resume-first instruction so the fresh session anchors on the ledger
  // instead of restarting or improvising.
  const wasPaused = prevDesc.includes("— PAUSED") || prevDesc.includes("— update"); // any prior journal counts: a To-do-parked card must continue exactly where it left off
  const resumeClause = wasPaused
    ? ` RESUME CONTINUITY: this task was paused earlier and the user just resumed it. Your FIRST update line must be '— update HH:MM — <the exact concrete step from the newest ledger line, in your own words> — continuing from there' and then DO it. NEVER write meta words: no 'resuming', no 'ledger', no 'session', no pid, no bridge — only the work itself.`
    : "";
  // ID PIN: spawn by exact task id, never by title alone — a title-based
  // /task lookup can resolve a DIFFERENT user card and write foreign content
  // to it (observed live: an audit probe card got another mission's journal).
  // DEMAND-FIRST (user demand: react immediately): if the card carries any
  // unanswered demand, the fresh session's FIRST act is that demand — before
  // reading anything else, before any other update.
  let demandClause = "";
  // NEVER-STUCK (4.2): detect the demand on the LIVE description (prevDesc was
  // re-fetched above) - a demand that landed after the poll snapshot must still
  // be injected demand-first into the fresh session.
  const liveLines = String(prevDesc || task.description || "").split("\n").filter((l) => l.trim());
  const pendingDemand = newestDemand(liveLines);
  if (pendingDemand && !demandAnswered(liveLines, pendingDemand.idx)) {
    demandClause = " IMMEDIATE PRIORITY OVERRIDE: the user is waiting on this demand RIGHT NOW: [" + pendingDemand.line.slice(0, 160) + "] — your very first action is to execute exactly this and prepend its ack before anything else.";
  }
  let chosenDesc = prevDesc || task.description || "";
  if (!daymarkPeekModel(task.id, chosenDesc)) {
    const gRaw = daymarkGlobalModelRaw();
    const gCls = gRaw && !/^default$/i.test(gRaw) ? daymarkClassifyModel(gRaw) : null;
    // METERED GHOST GUARD: the global model card publishes display names like
    // "GLM-5.3-Flash", which daymarkClassifyModel maps to the METERED pay-as-you-go
    // provider. A global default must never silently force metered on a card with
    // no explicit model pick - the subscription default wins instead.
    if (gCls && gCls.providerId !== "zai-metered-api") chosenDesc = "— ORDER 00:00 — model: " + gRaw + "\\n" + chosenDesc;
  }
  const __pickRaw = daymarkResolveModelForTask(task.id, chosenDesc);
  log("resolve debug:", task.id, "->", JSON.stringify(__pickRaw ? __pickRaw.modelId : null), "| chosenDesc head:", JSON.stringify(String(chosenDesc).slice(0, 80)));
  const modelOverride = daymarkApplyFailover(task, null, __pickRaw);
  log("resolve debug after failover:", task.id, "->", JSON.stringify(modelOverride ? modelOverride.modelId : null));
  if (modelOverride) log("task", task.id, "-> model override", modelOverride.modelId);
  const prompt = `/task ${title} — HARD IDENTITY: you are working EXACTLY the Daymark task with id ${task.id}; GET and PATCH only /api/agent/v1/tasks/${task.id}, never any other card —${demandClause} ${modelOverride && String(modelOverride.modelId).startsWith("zai-metered-api") ? NARRATION_LAW_METERED : NARRATION_LAW}${resumeClause}`;
  if (modelOverride && String(modelOverride.modelId).startsWith("nvidia-nim/")) {
    // NVIDIA IN-PROCESS AGENT (model truth guaranteed): the zcode CLI's
    // headless launcher cannot be forced onto a specific model, so NVIDIA
    // cards run in an in-process agent loop against the local rotating-key
    // proxy — the inference model is EXACTLY the card's chosen one.
    if (nvidiaRuns.has(task.id)) return; // an NVIDIA agent is already running for this card
    const { runNvidiaAgent } = await import("./nvidia-agent-runner.mjs");
    const run = { aborted: false };
    nvidiaRuns.set(task.id, run);
    state.pending[task.id] = { at: new Date().toISOString(), pid: null, model: modelOverride.modelId, nvidia: true };
    state.launched[task.id] = { at: new Date().toISOString(), pid: null, model: modelOverride.modelId, nvidia: true, sig: "pinned:" + (task.updatedAt || task.id) };
    saveState();
    prependJournal(task.id, prevDesc || task.description || "", `— update ${localHHMM()} — running on model ${modelOverride.modelId} (NVIDIA, rotating-key proxy)`).catch(() => {});
    const shouldStop = async () => {
      if (run.aborted) return true;
      try {
        const r = await req("GET", `${V}/tasks/${encodeURIComponent(task.id)}`);
        const t = r && r.task;
        return !t || Boolean(t.completedAt) || (t.sectionId !== IN_PROGRESS_SECTION);
      } catch { return false; }
    };
    runNvidiaAgent({
      taskId: task.id,
      modelId: String(modelOverride.modelId).slice("nvidia-nim/".length),
      demand: prompt,
      cwd: "F:/Downloads/a",
      journal: async (line) => {
        try {
          const r = await req("GET", `${V}/tasks/${encodeURIComponent(task.id)}`);
          const desc = String((r && r.task && r.task.description) || "");
          const nl = String.fromCharCode(10);
          let d2 = `— update ${localHHMM()} — ${line}` + nl + desc;
          while (d2.length > 19_500 && d2.includes(nl)) d2 = d2.slice(0, d2.lastIndexOf(nl));
          await prependJournal(task.id, d2, "");
        } catch {}
      },
      shouldStop,
      onFinished: async () => {
        try { await req("POST", `${V}/tasks/${encodeURIComponent(task.id)}/complete`, { idempotencyKey: randomUUID() }); } catch {}
      },
    }).then(async () => {
      nvidiaRuns.delete(task.id); delete state.pending[task.id]; delete state.launched[task.id]; saveState();
    }).catch(async (e) => {
      nvidiaRuns.delete(task.id); delete state.pending[task.id]; saveState();
      log("nvidia agent failed for task", task.id, "—", e && e.message);
      state.retries[task.id] = state.retries[task.id] || [];
      state.retries[task.id].push(Date.now());
      saveState();
      daymarkFailoverJournal(task.id, "NVIDIA agent failed (" + String(e && e.message || e).slice(0, 80) + ") — will retry; if it keeps failing the session falls back to the subscription default");
    });
    return; // the in-process run replaces the CLI spawn entirely
  }

  // NO pre-launch journal line (v3 generic-line ban): the card stays silent for
  // the ≤20s spawn window instead of showing a canned launch line.
  let child;
  if (modelOverride) {
    // FREE-MODEL LAW: the zen free tier only serves the genuine opencode
    // client (direct API calls get FreeTierError), so an override session
    // runs the LOCAL opencode CLI keyless on the exact chosen model.
    const ocPrompt = "You are running inside the opencode CLI, working EXACTLY the Daymark task with id " + task.id + ". "
      + "Update the card yourself: write the payload JSON to payload.json in the CURRENT directory (writes outside it are auto-rejected) and run `node C:/Temp/dmrun.mjs PATCH /api/agent/v1/tasks/" + task.id + " payload.json` - "
      + "PATCH body MUST be a complete JSON object like {\"idempotencyKey\":\"<uuid v4, fresh on every PATCH>\",\"description\":\"<FULL new description>\"} - the journal IS the description: newest line FIRST, each new line a concrete artifact (file path, number, command+output - never generic; at least every 30 s, never more than 60 s apart); NEVER replace the whole description with a short text - always GET the task first and prepend your line on top. Other accepted key: sectionId. "
      + "When the work is fully done and verified, PATCH sectionId to section-7f2adc429cd4a01046f1415d and end. "
      + prompt;
    // The scheduled-task parent env is sparse; opencode needs the full user
    // profile env to find its config/data dirs or every run dies at boot.
    const ocEnv = {
      ...process.env,
      SystemRoot: "C:\\Windows",
      USERPROFILE: "C:\\Users\\Admin",
      HOMEDRIVE: "C:",
      HOMEPATH: "\\Users\\Admin",
      APPDATA: "C:\\Users\\Admin\\AppData\\Roaming",
      LOCALAPPDATA: "C:\\Users\\Admin\\AppData\\Local",
      TEMP: "C:\\Users\\Admin\\AppData\\Local\\Temp",
      TMP: "C:\\Users\\Admin\\AppData\\Local\\Temp",
      PATH: "C:\\Windows\\System32;C:\\Program Files\\nodejs;F:\\backup\\opencode\\bin;" + (process.env.PATH || ""),
      TERM: "dumb",
      NO_COLOR: "1",
    };
    const ocArgs = ["run", "--auto", "--model", String(modelOverride.modelId).includes("/") ? modelOverride.modelId : ("opencode/" + modelOverride.modelId), ocPrompt];
    const ocSpawn = () => spawn(OPENCODE_CLI, ocArgs, {
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: false,
      cwd: "F:/Downloads/a",
      env: ocEnv,
    });
    try {
      child = ocSpawn();
    } catch (spawnErr) {
      log("opencode spawn threw:", spawnErr.message, "— rerouting task", task.id, "to metered");
      const ov = daymarkBuildMeteredOverride();
      if (ov) { FAILOVER_STATE()[task.id] = ov.modelId; saveState(); }
      daymarkFailoverJournal(task.id, "opencode executor unavailable (" + (spawnErr.code || "error") + ") — session rerouted to zai-metered-api/GLM-5.3-Flash, continuing");
      child = null;
    }
    if (child) child.on("error", (err) => {
      log("opencode spawn error event:", err.message, "— rerouting task", task.id, "to metered");
      const ov = daymarkBuildMeteredOverride();
      if (ov) { FAILOVER_STATE()[task.id] = ov.modelId; saveState(); }
      daymarkFailoverJournal(task.id, "opencode executor failed (" + (err.code || "error") + ") — session rerouted to zai-metered-api/GLM-5.3-Flash, continuing");
      try { if (child.pid) process.kill(child.pid); } catch (e) {}
      delete state.pending[task.id]; saveState();
    });
  } else {
    // METERED SPAWNS run in a proven-clean minimal environment: the
    // scheduled-task parent env makes override sessions die at boot with
    // "Unexpected server error"; this exact env set is verified working.
    const meteredEnv = modelOverride ? {
      SystemRoot: "C:\Windows",
      USERPROFILE: "C:\Users\Admin",
      HOMEDRIVE: "C:",
      HOMEPATH: "\Users\Admin",
      APPDATA: "C:\Users\Admin\AppData\Roaming",
      LOCALAPPDATA: "C:\Users\Admin\AppData\Local",
      PATH: "C:\Windows\System32;C:\Program Files\nodejs",
      ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: modelOverride.file,
      ZCODE_DEBUG: "1",
      ZCODE_LOG_CONSOLE: "1",
    } : null;
    if (modelOverride) {
      // PROVEN-CLEAN ENV: override sessions died at boot with "Unexpected
      // server error" when spawned with the full inherited env (the bridge's
      // own historical note above). The minimal meteredEnv carries the config
      // file + debug flags and is the verified-working shape for ALL override
      // providers (metered, nvidia-nim, opencode) — use it, with the config
      // file always set from modelOverride.file.
      const overrideEnv = { ...(meteredEnv || {
        SystemRoot: "C:\Windows",
        USERPROFILE: "C:\Users\Admin",
        HOMEDRIVE: "C:",
        HOMEPATH: "\Users\Admin",
        APPDATA: "C:\Users\Admin\AppData\Roaming",
        LOCALAPPDATA: "C:\Users\Admin\AppData\Local",
        PATH: "C:\Windows\System32;C:\Program Files\nodejs",
      }), ZCODE_PERSONAL_PROVIDER_CONFIG_FILE: modelOverride.file, ZCODE_DEBUG: "1", ZCODE_LOG_CONSOLE: "1" };
      child = spawn(process.execPath, [ZCODE_CLI, "--prompt", prompt, "--surface", "desktop", "--cwd", "F:/Downloads/a"], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: false,
        env: overrideEnv,
      });
      child.on("error", (err) => {
        log("zcode override spawn error:", err.message, "— task", task.id);
        daymarkFailoverJournal(task.id, "session launcher failed (" + (err.code || "error") + ") — will retry on next poll");
        delete state.pending[task.id]; saveState();
      });
    } else {
      child = spawn(process.execPath, [ZCODE_CLI, "--prompt", prompt, "--surface", "desktop", "--cwd", "F:/Downloads/a"], {
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: false,
        env: process.env,
      });
      child.on("error", (err) => {
        log("zcode spawn error:", err.message, "— task", task.id);
        daymarkFailoverJournal(task.id, "session launcher failed (" + (err.code || "error") + ") — will retry on next poll");
        delete state.pending[task.id]; saveState();
      });
    }
  }
  if (modelOverride) {
    // USER LAW: while a non-default model runs, the card ALWAYS names it.
    prependJournal(task.id, prevDesc || task.description || "", `\u2014 update ${localHHMM()} \u2014 running on model ${modelOverride.modelId}${String(modelOverride.modelId).includes(":free") || String(modelOverride.modelId).includes("-free") ? " (free)" : ""}`).catch(() => {});
  }
  const spawnedAt = Date.now();
  let lastErrText = "";
  child.stdout.on("data", (d) => appendFileSync(openSync(LOG_FILE, "a"), `[session ${task.id}] ${d}`));
  child.stderr.on("data", (d) => { lastErrText = (lastErrText + String(d)).slice(-4000); appendFileSync(openSync(LOG_FILE, "a"), `[session ${task.id}][err] ${d}`); daymarkHandleSessionDeath(task.id, d); });
  child.unref();
  state.lastSpawnAt = Date.now();
  state.pending[task.id] = { at: new Date().toISOString(), pid: child.pid, model: modelOverride ? modelOverride.modelId : null };
  saveState();

  let settled = false;
  // Honest success: only after the child survives 20 seconds do we journal the
  // real launch and lock the one-launch-per-task record.
  setTimeout(() => {
    if (settled) return;
    let alive = false;
    try { process.kill(child.pid, 0); alive = true; } catch {}
    if (!alive) return; // died — the exit handler owns it
    settled = true;
    delete state.pending[task.id];
    state.launched[task.id] = { at: new Date().toISOString(), pid: child.pid, model: modelOverride ? modelOverride.modelId : null };
    saveState();
    log("session survived 20s for task", task.id, "pid", child.pid, modelOverride ? ("on model " + modelOverride.modelId) : "(default model)");
    // Register the REAL session pid for the relay's pause/resume (NtSuspendProcess
    // tree). Session self-registration proved unreliable (transient bash pids);
    // the bridge is the only component that knows the durable child pid. Merge —
    // never overwrite other tasks' entries.
    try {
      const REG = "C:/Users/Admin/.zcode/control-registry.json";
      let reg = {};
      try { reg = JSON.parse(readFileSync(REG, "utf8")); } catch {}
      reg[task.id] = { pid: child.pid, name: title, registeredAt: new Date().toISOString(), by: "bridge" };
      writeFileSync(REG, JSON.stringify(reg, null, 2));
      log("registered session pid for pause/resume:", task.id, "pid", child.pid);
    } catch (e) { log("control-registry write failed for task", task.id, e.message || e); }
    req("GET", `${V}/tasks/${encodeURIComponent(task.id)}`)
      /* took-the-task ack removed (zero-boilerplate law) */
  }, 20_000);

  child.on("exit", (code, signal) => {
    if (settled) {
      // Died later in its life: un-mark so a pinned task gets a fresh session on
      // the next poll — buttons (message/agents/orders) must never go dead.
      // Guard: when the bridge wedge-kills a session its exit must not erase
      // the REPLACEMENT session's record — only un-mark our own pid's entry.
      if (state.launched[task.id] && state.launched[task.id].pid !== child.pid) return;
      daymarkHandleSessionDeath(task.id, lastErrText);
      if (new RegExp("ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN").test(lastErrText)) log("INFRA outage death (proxy/API connection) on task", task.id, "— retry budget untouched");
      log("session exited later for task", task.id, "code", code, "— un-marking for relaunch");
      // METERED FAILOVER DRILL: a session that was running on the metered API
      // and died must be checked against the provider itself (the CLI swallows
      // API errors, so stderr is blind). Probe the key directly: failure ->
      // the metered side is genuinely unavailable -> force subscription so the
      // task keeps working; success -> transient death, normal relaunch.
      const deadModel = (state.launched[task.id] && state.launched[task.id].model) || (state.pending[task.id] && state.pending[task.id].model) || "";
      if (String(deadModel).startsWith("zai-metered-api")) {
        FAILOVER_STATE()[task.id] = "metered-probe";
        saveState();
        daymarkMeteredProbe(task.id);
      }
      // RELAUNCH SPACING: an immediately-exited session (crashed model, API
      // rate limit) must not be respawned every poll - that churn trips the
      // free-tier rate limit and turns one failure into a storm. The 120 s
      // wedge spacing gates the next launch for this task.
      if (Date.now() - spawnedAt < 60 * 1000) {
        state.lastWedgeKill[task.id] = Date.now();
      }
      delete state.launched[task.id];
      saveState();
      return;
    }
    // FAST-DEATH SPACING: a spawn that died within 20 s (server collision,
    // provider refusal) must not be retried every global-spawn cycle - the
    // per-task 120 s wedge spacing absorbs the collision window.
    if (state.lastWedgeKill) state.lastWedgeKill[task.id] = Date.now();
    state.lastFastDeath = state.lastFastDeath || {};
    state.lastFastDeath[task.id] = Date.now();
    saveState();
    settled = true;
    daymarkHandleSessionDeath(task.id, lastErrText);
    const infraOutage = new RegExp("ECONNRESET|ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|Select a model before sending").test(lastErrText);
    const fdModel = (state.pending[task.id] && state.pending[task.id].model) || (state.launched[task.id] && state.launched[task.id].model) || "";
    delete state.pending[task.id];
    if (!infraOutage) {
      state.retries[task.id] = state.retries[task.id] || [];
      state.retries[task.id].push(Date.now());
    } else { log("INFRA outage death (proxy/API connection) on task", task.id, "— retry budget untouched; relaunch continues"); }
    saveState();
    log("session DIED within 20s for task", task.id, "code", code, "signal", signal, "— un-marking, will retry");
    if (String(fdModel).startsWith("zai-metered-api")) {
      // Repeated fast deaths on the metered side force a subscription hold
      // (10 min, auto-retry) so the card NEVER stalls on a failing provider.
      const fc = state.meteredFails = state.meteredFails || {};
      fc[task.id] = (fc[task.id] || 0) + 1;
      const serverErr = /Unexpected server error/i.test(String(lastErrText));
      if (serverErr || fc[task.id] >= 3) {
        FAILOVER_STATE()[task.id] = "subscription";
        state.forcedAt = state.forcedAt || {};
        state.forcedAt[task.id] = Date.now();
        fc[task.id] = 0;
        saveState();
        log("FAILOVER: repeated metered deaths on task", task.id, serverErr ? "(server error)" : "(fast deaths)", "— subscription hold, metered auto-retries in 10 min");
        daymarkFailoverJournal(task.id, "metered provider failed — switched this session to the subscription automatically; metered retries in 10 minutes");
      } else {
        FAILOVER_STATE()[task.id] = "metered-probe";
        saveState();
        daymarkMeteredProbe(task.id);
      }
    }
    if (String(fdModel).startsWith("opencode")) {
      // Free-opencode executor broken (missing binary, server boot failure):
      // reroute THIS task to the metered provider so the card never stalls,
      // and keep a 30-minute hold before touching opencode again on it.
      const oc = state.opencodeFails = state.opencodeFails || {};
      oc[task.id] = (oc[task.id] || 0) + 1;
      const ov = daymarkBuildMeteredOverride();
      if (ov) {
        FAILOVER_STATE()[task.id] = ov.modelId;
        state.forcedAt = state.forcedAt || {};
        state.forcedAt[task.id] = Date.now();
        saveState();
        log("FAILOVER: opencode session died fast on task", task.id, "(" + oc[task.id] + "x) — rerouted to", ov.modelId);
        daymarkFailoverJournal(task.id, "the free model runner failed (" + String(lastErrText).replace(/\s+/g, " ").slice(0, 80) + "...) — this session automatically switched to zai-metered-api/GLM-5.3-Flash so it keeps running");
        // Rewrite the card's own model line so the next relaunch uses the
        // working provider directly (the card line outranks every failover
        // force, and the card must always name the model that really runs).
        req("GET", `${V}/tasks/${encodeURIComponent(task.id)}`).then((r) => {
          if (!r || !r.task) return;
          const desc = String(r.task.description || "");
          const rewritten = desc.replace(DAYMARK_MODEL_LINE_RE, (line0) => line0.replace(/model:\s*[A-Za-z0-9._:\/-]+/, "model: default"));
          if (rewritten !== desc) {
            return req("PATCH", `${V}/tasks/${encodeURIComponent(task.id)}`, {
              body: { description: rewritten },
              idempotencyKey: randomUUID(),
            });
          }
        }).catch(() => {});
      }
    }
    req("GET", `${V}/tasks/${encodeURIComponent(task.id)}`)
      .then((r) => {
        if (!r || !r.task) return;
        const desc = String(r.task.description || "");
        // CHURN GUARD: a chronically failing spawn would hammer the card with
        // identical exit notices - journal at most one per task per 10 min.
        const key = "exitNotice:" + task.id;
        if (state[key] && Date.now() - state[key] < 10 * 60 * 1000) return;
        state[key] = Date.now(); saveState();
        return prependJournal(task.id, desc, `— update ${localHHMM()} — the launched session exited immediately (code ${code ?? signal ?? "?"}) instead of running; the bridge keeps retrying automatically. No fake session is running.`);
      })
      .catch(() => {});
  });
}

function assignedNow(task) {
  if (task.assignedSession && task.assignedSession.id) return "server:" + task.assignedSession.id;
  const desc = String(task.description || "");
  // PINNED ANYWHERE (permanent fix): machine watchdog/nudge lines prepend above
  // the pinned marker and eventually bury it — a top-3 scan silently lost the
  // assignment and the card never got a session again (observed: myres). Scan
  // the WHOLE description; pinned = assigned, forever.
  const pinned = desc.split("\n").some((l) => l.trim() === "— pinned —");
  const launchedLine = desc.includes("a real ZCode session has been launched");
  if (pinned || launchedLine) return "pinned:" + (task.updatedAt || task.id);
  return null;
}
// True while a task is force-paused: the NEWEST PAUSED-vs-RESUMED marker wins
// (same rule as the relay and the Android app), so session narration or machine
// lines above a PAUSED marker never un-pause a card — only a RESUMED click does.
function isNewestPaused(desc) {
  const marker = /—\s*(PAUSED|RESUMED)\s+\d{1,2}:\d{2}\s+—/i;
  for (const l of desc.split("\n")) {
    const m = l.match(marker);
    if (m) return m[1].toUpperCase() === "PAUSED";
  }
  return false;
}

let polling = false;
async function poll() {
  if (polling) return; // POLL MUTEX: a slow pass (kills, PATCH retries) must never overlap the next one — overlapping passes double-spawn and conflict
  polling = true;
  try {
    daymarkQuotaWatch();
    // Prune launched entries whose session process is dead so pinned tasks
    // automatically get a fresh session — a dead session must never freeze a
    // card (and its buttons) forever. Retry budget still applies.
    for (const [tid, rec] of Object.entries(state.launched || {})) {
      if (!rec || !rec.pid) continue;
      if (rec.nvidia || nvidiaRuns.has(tid)) continue; // in-process run: no pid to prune
      try { process.kill(rec.pid, 0); } catch {
        delete state.launched[tid];
        saveState();
        log("pruned dead session entry for task", tid, "pid", rec.pid, "— will relaunch if still assigned");
      }
    }
    // Prune stale launch CLAIMS: if the bridge died between claiming the launch
    // slot and spawning, pending[] would hold a pid-less record that blocks
    // retries. Anything claimed over 2 minutes ago without a pid is garbage.
    for (const [tid, rec] of Object.entries(state.pending || {})) {
      if (!rec) { delete state.pending[tid]; saveState(); continue; }
      if (rec.nvidia || nvidiaRuns.has(tid)) continue; // in-process run: alive without a pid
      const claimAge = Date.now() - (Date.parse(rec.at) || 0);
      if (!rec.pid && claimAge > 2 * 60 * 1000) {
        delete state.pending[tid];
        saveState();
        log("pruned stale launch claim for task", tid);
      }
    }
    // STATE-PROBE GATE (server CPU diet): a tiny revision+hash probe replaces
    // the two full API reads whenever the workspace hash is unchanged — the
    // worker then skips the multi-megabyte state parse entirely.
    let res = null; // full read result (null on unchanged probe reuse)
    let tasks = null;
    if (state.lastStateHash && Array.isArray(state.lastTasks) && state.lastTasks.length) {
      try {
        const syncKeyB = readFileSync(DAYMARK_SYNCKEY_PATH, "utf8").trim();
        if (syncKeyB) {
          const probeRes = await fetch(DEFAULT_API_URL.replace(/\/+$/, "") + "/api/sync/" + encodeURIComponent(syncKeyB) + "?probe=1", {
            headers: { Accept: "application/json", "X-Daymark-Sync-Key": syncKeyB, Authorization: "Bearer " + syncKeyB },
            cache: "no-store", signal: AbortSignal.timeout(8000),
          });
          if (probeRes.ok) {
            const pj = await probeRes.json();
            if (pj.hash && pj.hash === state.lastStateHash) tasks = state.lastTasks; // unchanged: reuse cached list
          }
        }
      } catch (e) { /* probe failure falls through to the full read */ }
    }
    if (tasks === null) {
      const inv = await req("GET", `${V}/projects`);
      const proj = (inv.projects || inv).find((p) => p.name === PROJECT);
      if (!proj) return;
      res = await req("GET", `${V}/tasks?status=all&limit=250&projectId=${encodeURIComponent(proj.id)}`);
      tasks = res.tasks || res || [];
      try {
        const syncKeyB2 = readFileSync(DAYMARK_SYNCKEY_PATH, "utf8").trim();
        if (syncKeyB2) {
          const probeRes2 = await fetch(DEFAULT_API_URL.replace(/\/+$/, "") + "/api/sync/" + encodeURIComponent(syncKeyB2) + "?probe=1", {
            headers: { Accept: "application/json", "X-Daymark-Sync-Key": syncKeyB2, Authorization: "Bearer " + syncKeyB2 },
            cache: "no-store", signal: AbortSignal.timeout(8000),
          });
          if (probeRes2.ok) {
            const pj2 = await probeRes2.json();
            if (pj2.hash) { state.lastStateHash = pj2.hash; state.lastTasks = tasks; saveState(); }
          }
        }
      } catch (e) {}
    }
    // REVISION CACHE (v3 token/bandwidth diet): mechanical polls cost zero model
    // tokens but bandwidth matters — skip the FETCH only. The per-task
    // enforcement loop below must ALWAYS run: a silent card never changes the
    // board revision, so skipping the loop on an unchanged revision would
    // disable the 4-minute silence revive exactly when it is needed (observed
    // live: press sat silent for hours because the cache gated the loop).
    const boardSig = (res && res.revision)
      || createHash("sha1").update(tasks.map((t) => `${t.id}:${t.updatedAt}`).join("|")).digest("hex");
    if (boardSig && boardSig === state.lastBoardSig) {
      if (Array.isArray(state.lastTasks) && state.lastTasks.length) {
        tasks = state.lastTasks; // reuse cached list: descriptions still valid
      } else {
        return; // first poll after boot with unchanged sig: nothing cached yet
      }
    } else {
      state.lastBoardSig = boardSig;
      state.lastTasks = tasks;
      saveState();
    }
    const TODO_SECTION = "section-5fc763b0f6ac492b7c4eaa0f";

    // TO-DO REORDER (phone button channel): the Android "# Order" button
    // writes ONE marker line; the bridge applies the reorder through the
    // authoritative agent API — the phone's full-state push loses races
    // against constant session writes, the agent PATCHes never do.
    let reorderMarker = null;
    let reorderPos = 0;
    for (const t of tasks) {
      if (t.sectionId !== TODO_SECTION) continue;
      const m = String(t.description || "").match(/—\s*ORDER\s+\d{1,2}:\d{2}\s+—\s*reorder:\s*position\s*(\d+)/i);
      if (m && (!reorderMarker || String(t.updatedAt || "") > String(reorderMarker.updatedAt || ""))) {
        reorderMarker = t; reorderPos = parseInt(m[1], 10);
      }
    }
    if (reorderMarker && !state.applyingReorder) {
      state.applyingReorder = true;
      saveState();
      const key = reorderMarker.id + ":" + reorderPos;
      if ((state.appliedReorders || {})[key]) {
        state.applyingReorder = false;
        saveState();
      } else {
        log("reorder marker on", reorderMarker.id, "→ position", reorderPos);
        (async () => {
          try {
            const todos = tasks.filter((x) => x.sectionId === TODO_SECTION && x.id !== reorderMarker.id);
            todos.sort((a, b2) => (a.order || 0) - (b2.order || 0));
            const idx = Math.max(0, Math.min(reorderPos - 1, todos.length));
            todos.splice(idx, 0, reorderMarker);
            for (let i = 0; i < todos.length; i++) {
              const want = i + 1;
              // FORCE-APPLY: the poll snapshot's orders can be stale after a
              // partial apply - skipping "already correct" cards froze moves
              // like first-to-last. Patch every card, always.
              await req("PATCH", `${V}/tasks/${encodeURIComponent(todos[i].id)}`, { body: { order: want }, idempotencyKey: randomUUID() });
            }
            if (!state.appliedReorders) state.appliedReorders = {};
            state.appliedReorders[key] = Date.now();
            const keys = Object.keys(state.appliedReorders);
            if (keys.length > 50) delete state.appliedReorders[keys[0]];
            log("reorder applied:", key);
          } catch (e) { log("reorder apply failed:", e.message || e); }
          state.applyingReorder = false;
          state.lastBoardSig = null;
          saveState();
        })();
        return;
      }
    }
    // DELETE-ALL-FINISHED (phone button channel): the Android Finished
    // "Delete all" prepends the delete-finished ORDER marker onto one
    // finished card (cheap single push); the bridge executes the purge
    // through the authoritative agent API (per-task POST /delete with
    // server-side undo tokens) — the phone can never get stuck "saving".
    const FINISHED_SECTION = "section-7f2adc429cd4a01046f1415d";
    let purgeMarker = null;
    const finishedIds = [];
    for (const t of tasks) {
      if (t.sectionId === FINISHED_SECTION || t.completedAt) {
        finishedIds.push(t.id);
        if (/—\s*ORDER\s+\d{1,2}:\d{2}\s+—\s*delete-finished/i.test(String(t.description || "")) && !purgeMarker) purgeMarker = t;
      }
    }
    if (purgeMarker && !state.purgingFinished) {
      state.purgingFinished = true;
      saveState();
      log("delete-finished marker on", purgeMarker.id, "— purging", finishedIds.length, "finished tasks");
      (async () => {
        let deleted = 0;
        for (const id of finishedIds) {
          try {
            await req("POST", `${V}/tasks/${encodeURIComponent(id)}/delete`, { body: { confirm: "delete" }, idempotencyKey: randomUUID() });
            deleted++;
          } catch (e) { log("purge delete failed for", id, e.message || e); }
        }
        state.purgingFinished = false;
        state.lastBoardSig = null; // force fresh fetch so the phone sees zero
        saveState();
        log("finished purge complete:", deleted + "/" + finishedIds.length, "tasks deleted");
      })();
      return; // this pass is spent; next poll sees the cleaned board
    }
    for (const t of tasks) {
      // 4.13 PER-TASK ISOLATION: any throw in one task's handling is logged and
      // skipped — the remaining tasks still get their pass this poll.
      try {
      const full = t.description === undefined
        ? await req("GET", `${V}/tasks/${encodeURIComponent(t.id)}`).then((r) => r.task).catch(() => null)
        : t;
      if (!full) continue;
      // PAUSED HARD GATE (user law: a paused session stays paused until the user
      // clicks resume — even across a reboot): when the newest journal line is a
      // PAUSED marker the bridge does NOTHING for this task — no launch, no
      // revive, no demand dispatch, no nudge, no wedge-kill. Only a RESUMED line
      // (or any newer session line) reopens those paths.
      const pausedNow = isNewestPaused(String(full.description || ""));
      if (pausedNow) {
        // MESSAGE-OVER-PAUSE (user law, absolute): a message from the user
        // overrides ANY state, including pause. An unanswered user demand on a
        // paused card IS the resume: lift the gate, journal RESUMED, move the
          // card to In Progress, and dispatch a session demand-first THIS poll.
        const pLines = String(full.description || "").split("\n").filter((l) => l.trim());
        const pDemand = newestDemand(pLines);
        if (pDemand && !demandAnswered(pLines, pDemand.idx)) {
          const pDesc = String(full.description || "");
          try {
            await req("PATCH", `${V}/tasks/${encodeURIComponent(full.id)}`, { body: { sectionId: IN_PROGRESS_SECTION }, idempotencyKey: randomUUID() });
          } catch (eUnpause) { log("message-over-pause section PATCH failed for", full.id, eUnpause.message || eUnpause); }
          await prependJournal(full.id, pDesc, `\u2014 RESUMED ${localHHMM()} \u2014 your message resumed this paused task; it moved to In Progress and a session is starting now to carry the message out.`).catch(() => {});
          log("message-over-pause on task", full.id, "\u2014 paused gate lifted by unanswered demand; moved to In Progress, dispatching");
          full.sectionId = IN_PROGRESS_SECTION;
          delete state.demandReplaced[full.id];
          if (state.demandSeen) delete state.demandSeen[full.id];
          state.lastBoardSig = null;
          saveState();
          // Dispatch immediately with the demand injected as first priority —
          // but ONLY when no launch record is alive: the launchSession dedupe
            // guard owns single-spawn, so never delete its records here.
          const liveP = state.launched[full.id] || state.pending[full.id];
          if (!liveP && retryAllowed(full.id)) {
            await launchSession(full);
            const recP = state.pending[full.id] || state.launched[full.id];
            if (recP) { recP.sig = "demand:" + pDemand.line.slice(0, 40); saveState(); }
          }
          continue;
        } else {
          continue; // paused with no unanswered message: the hard gate holds
        }
      }

      // A task that has been moved OUT of In Progress (typically Finished by its
      // session) must never be relaunched or revived, even though its old
      // description still carries the pinned/launched phrases — finished stays
      // finished. The demand path below stays open for ALL sections because the
      // apps reopen a finished task to In Progress the moment the user messages it.
      let inProgress = !full.sectionId || full.sectionId === IN_PROGRESS_SECTION;
      // RESUME RETURNS TO IN PROGRESS (user law: the millisecond a card is
      // resumed it continues): a card whose newest marker is RESUMED but
      // which sits in To do (hand-parked) is moved back to In Progress so
      // the launch path below gives it a fresh session immediately.
      const firstLine = (String(full.description || "").split("\n").find((l) => l.trim()) || "");
      const newestResumed = /^\u2014 RESUMED \d{1,2}:\d{2} \u2014/.test(firstLine);
      if (!inProgress && full.sectionId === TODO_SECTION && newestResumed && !state.launched[full.id]) {
        await req("PATCH", `${V}/tasks/${encodeURIComponent(full.id)}`, { body: { sectionId: IN_PROGRESS_SECTION }, idempotencyKey: randomUUID() });
        log("resumed card returned to In Progress for task", full.id);
        prependJournal(full.id, String(full.description || ""), `\u2014 ack ${localHHMM()} \u2014 resumed: card moved back to In Progress; a fresh session is launching now.`).catch(() => {});
        state.lastBoardSig = null;
        saveState();
        return; // next poll sees the moved card and launches
      }

      // STOP-ON-FINISH (user demand, absolute): the millisecond a card leaves
      // In Progress (Finished by its session, or completed by the user), its
      // working session tree is TERMINATED — no lingering narration, no token
      // burn, "completely stop working". Grace of one poll cycle so the
      // session's own final journal write lands first.
      if (!inProgress && state.launched[full.id] && state.launched[full.id].pid) {
        const rec = state.launched[full.id];
        // ZERO-DELAY COMPLETE (user law, absolute): the moment a card is seen
        // out of In Progress (completed, parked, finished) its session tree is
        // terminated on THIS poll - no grace period, no lingering narration.
        log("stop-on-finish: killing session for task", full.id, "pid", rec.pid);
        await killTreeConfirmed(rec.pid, full.id); // 4.3: confirmed kill; nothing relaunches here
        delete state.launched[full.id];
        delete state.pending[full.id]; // a stale claim must never block the relaunch
        state.finishedAt[full.id] = Date.now();
        saveState();
        continue;
      }
      if (inProgress && state.finishedAt[full.id]) {
        delete state.finishedAt[full.id]; // reopened: enforcement re-arms
        saveState();
      }
      // 1) Assigned/pinned session launch (existing behavior).
      const sig = inProgress ? assignedNow(full) : null;
      if (sig) {
        const prev = state.launched[full.id] || state.pending[full.id];
        if (prev) {
          if (prev.sig !== sig) {
            // FRESH RE-ASSIGN: the user just tapped Assign (the pinned marker is
            // the TOP journal line). Previously this was swallowed — assign on
            // any ever-run card did nothing. Now: kill the old session (confirmed
            // dead) and relaunch immediately, demand-first via the new prompt.
            const topLine = String(full.description || "").split("\n").find((l) => l.trim()) || "";
            const freshAssign = /\u2014\s*pinned/.test(topLine) || /session assigned/i.test(topLine);
            const liveRec = state.launched[full.id] || state.pending[full.id];
            const recAgeMs = liveRec && liveRec.at ? Date.now() - (Date.parse(liveRec.at) || 0) : Infinity;
            if (freshAssign && retryAllowed(full.id) && recAgeMs >= 15_000) { // a session spawned moments ago IS this assign's session
              log("fresh re-assign on task", full.id, "\u2014 replacing session");
              state.pending[full.id] = { at: new Date().toISOString(), pid: null };
              saveState();
              if (liveRec && liveRec.pid && !(await killTreeConfirmed(liveRec.pid, full.id))) { delete state.pending[full.id]; saveState(); continue; }
              delete state.launched[full.id];
              delete state.pending[full.id];
              saveState();
              await launchSession(full);
              const recFresh = state.pending[full.id] || state.launched[full.id];
              if (recFresh) { recFresh.sig = sig; saveState(); }
            } else { prev.sig = sig; saveState(); }
          }
        } else if (retryAllowed(full.id)) {
          await launchSession(full);
          const rec = state.pending[full.id] || state.launched[full.id];
          if (rec) { rec.sig = sig; saveState(); }
        } else {
          log("retry budget exhausted for task", full.id);
          daymarkMeteredProbe(full.id);
        }
        // NO continue here (v2): even a live pinned session must face the demand
        // escalation below — previously wedged sessions left user demands dead.
      }
      // 1b) SILENCE REVIVE (v3): any task in the In Progress section whose
      //     journal has been silent >= 4 minutes gets a working session — with
      //     OR without a pinned/assigned marker. Markers can be lost to
      //     description compression (the 20k board cap), and an In Progress
      //     card without a live session is by doctrine an orphan (observed
      //     live: media sat through 3 stacked watchdog escalations with no
      //     session because its pinned line had been compressed away). Machine watchdog lines do NOT reset the silence clock
      //     (journalSilenceMin skips them), so a relay heartbeat can never keep
      //     a corpse "alive". At most one revive per task per 10 minutes, and
      //     never during a session's first 4 minutes of life.
      if (sig || inProgress) {
        const sil = journalSilenceMin(String(full.description || "").split("\n").filter((l) => l.trim()));
        const liveS = state.launched[full.id] || state.pending[full.id];
        // MODEL SWITCH (user law: he can change any session\u2019s model at any
        // time and it takes effect): a live session launched on a DIFFERENT
        // model than the card\u2019s newest ORDER says is replaced \u2014 old tree
        // confirmed dead, fresh session on the new model. Old records without
        // a model field ("unknown") never churn; defaults compare as null.
        if (liveS && liveS.pid) {
          // IMMEDIATE SWITCH LAW: a model change is an explicit user act —
          // no kill-spacing delay, it takes effect on the next 1 s poll.
          // model-less legacy records compare as null (default).
          const cardModel = daymarkPeekModel(full.id, String(full.description || ""));
          // METERED GHOST GUARD (switch law): the global default token
          // "GLM-5.3-Flash" classifies as the metered provider; a global
          // default must never demand a switch TO metered - it compares as
          // the subscription default (null) unless subscription is exhausted.
          const gm = daymarkGlobalModel();
          const gmNeutralized = gm && String(gm).startsWith("zai-metered-api") && !state.subExhausted ? null : gm;
          const wantModel = FAILOVER_STATE()[full.id] ? (liveS.model || null) : (cardModel || gmNeutralized);
          // OUTAGE GUARD: while the paid providers refuse model resolution,
          // a WORKING free session is never switched away - a paid pick
          // (global API/metered/subscription) waits for the provider to return.
          const providerBrokenNow = state.providerModelBrokenAt && Date.now() - state.providerModelBrokenAt < 30 * 60_000;
          const liveIsFree = String(liveS.model || "").endsWith("-free");
          const wantIsDeadPaid = wantModel && !String(wantModel).endsWith("-free") && providerBrokenNow;
          if (liveIsFree && wantIsDeadPaid) { continue; }
          if ((wantModel || null) !== (liveS.model || null)) {
            state.lastWedgeKill[full.id] = Date.now();
            saveState();
            log("model switch on task", full.id, ":", String(liveS.model), "->", String(wantModel), "\u2014 killing tree and relaunching");
            state.pending[full.id] = { at: new Date().toISOString(), pid: null };
            saveState();
            await killTreeConfirmed(liveS.pid, full.id);
            delete state.launched[full.id];
            delete state.pending[full.id];
            saveState();
            if (!state.launched[full.id] && !state.pending[full.id] && retryAllowed(full.id)) {
              await launchSession(full);
            }
            continue;
          }
        }
        // ONE-MINUTE OUTPUT LAW (machine guarantee): while a session is alive
        // but its card has had NO new real line for >=60 s, the bridge posts a
        // concrete liveness heartbeat (model, alive-seconds) at most once per
        // minute, so the user ALWAYS sees progress at least once every minute
        // - even while a slow model is still thinking. Machine heartbeats
        // never count as session output or demand answers (META rule), and
        // paused cards are never touched.
        if (sil !== null && sil >= 1 && liveS && liveS.pid && pidAlive(liveS.pid) && !isNewestPaused(String(full.description || ""))) {
          state.lastMachineBeat = state.lastMachineBeat || {};
          if (Date.now() - (state.lastMachineBeat[full.id] || 0) >= 60_000) {
            state.lastMachineBeat[full.id] = Date.now();
            saveState();
            const aliveSec = Math.max(0, Math.round((Date.now() - (Date.parse(liveS.at) || Date.now())) / 1000));
            const beatModel = liveS.model || "GLM-5.3-Flash (default)";
            prependJournal(full.id, String(full.description || ""), `— heartbeat ${localHHMM()} — machine: session alive ${aliveSec}s on ${beatModel}, working — its next concrete line lands on completion of the current step`).catch(() => {});
          }
        }
        // Tightened after the 2026-10-21 myres 20-min stall: a silent In
        // Progress card must be revived within ~3 minutes, never 10+.
        // 10x FREQUENCY LAW with BOOT GRACE: silence >= 1 min triggers revival
        // ONLY after the session has had 300 s to boot and post its first line -
        // killing a booting session just manufactures replacement spam.
        const sessAge = liveS ? Date.now() - (Date.parse(liveS.at) || 0) : Infinity;
        if (sil !== null && sil >= 1 && sessAge >= 75_000 && Date.now() - (state.lastWedgeKill[full.id] || 0) >= 120 * 1000) {
          const sessionAgeOk = !liveS || !liveS.at || (Date.now() - Date.parse(liveS.at)) >= 2 * 60 * 1000;
          if (sessionAgeOk) {
            state.lastWedgeKill[full.id] = Date.now();
            saveState();
            if (liveS && liveS.pid) {
              log("silence revive on task", full.id, "pid", liveS.pid, "— journal silent", sil, "min → killing tree and relaunching");
              // ZERO-OVERLAP (4.3): claim the launch slot BEFORE the kill so a
              // concurrent poll pass can never spawn a second session while we
              // await the death confirmation; then CONFIRM the old pid is dead
              // BEFORE the replacement spawn below.
              state.pending[full.id] = { at: new Date().toISOString(), pid: null };
              saveState();
              if (!(await killTreeConfirmed(liveS.pid, full.id))) { delete state.pending[full.id]; saveState(); continue; }
              delete state.launched[full.id];
              delete state.pending[full.id]; // launchSession re-claims synchronously
              saveState();
            }
            if (!state.launched[full.id] && !state.pending[full.id] && retryAllowed(full.id)) {
              log("silence revive on task", full.id, "→ relaunching session");
              await launchSession(full);
              const recS = state.pending[full.id] || state.launched[full.id];
              if (recS) { recS.sig = sig; saveState(); }
              const newPid = recS ? recS.pid : null;
              try {
                // ZERO-BOILERPLATE LAW: revive is infrastructure - the fresh session's own first concrete line is the only journal entry needed.
              } catch (e) { log("silence-revive journal failed", e.message || e); }
            }
            continue;
          }
        }
      }
      // 3) MODEL-CHANGE LIVE APPLY (user law: a non-default model must take
      //    effect the moment it is chosen, on a running card too). The newest
      //    journal line "- ORDER HH:MM - model: <id>" wins; when it differs
      //    from the model the live session was launched with, kill the old
      //    tree (confirmed) and relaunch with the new override env.
      {
        const mLine = String(full.description || "").match(/^.*\u2014\s*ORDER[^\n]*\bmodel:\s*([A-Za-z0-9._:\/-]+).*$/m);
        if (mLine) {
          const rawModel = mLine[1].trim();
          const bareModel = rawModel.replace(/^opencode\//i, "");
          const isDefault = /GLM-5\.3-Flash/i.test(bareModel);
          const wantModel = isDefault ? "DEFAULT" : bareModel;
          const live = state.launched[full.id] || state.pending[full.id];
          const applied = state.modelApplied ? state.modelApplied[full.id] : undefined;
          if (wantModel !== applied) {
            if (!state.modelApplied) state.modelApplied = {};
            state.modelApplied[full.id] = wantModel;
            saveState();
            if (live && live.pid) {
              log("model change on task", full.id, "\u2014", applied || "default", "\u2192", wantModel, "\u2014 killing and relaunching on the new model");
              state.pending[full.id] = { at: new Date().toISOString(), pid: null };
              saveState();
              if (!(await killTreeConfirmed(live.pid, full.id))) { delete state.pending[full.id]; saveState(); state.modelApplied[full.id] = applied; continue; }
              delete state.launched[full.id];
              delete state.pending[full.id];
              saveState();
            }
            if (inProgress && retryAllowed(full.id)) {
              await launchSession(full);
              const recM = state.pending[full.id] || state.launched[full.id];
              if (recM) { recM.sig = "model:" + wantModel; saveState(); }
            }
          }
        }
      }
      // 2) Graduated response to ANY unanswered user demand aged >= 2 min — the
      //    message, Agents ("sub-agents:") and Add-step ("do this now:") buttons
      //    all write DEMAND_RE lines. Journal is newest-first: a demand is
      //    unanswered while it sits ABOVE the newest update/ack/heartbeat line.
      const desc = String(full.description || "");
      const lines = desc.split("\n").filter((l) => l.trim());
      const demand = newestDemand(lines);
      if (!demand) continue;
      const answered = demandAnswered(lines, demand.idx);
      // MESSAGE-TO-DO (user law: act in <30s): an unanswered demand on a To-do
      // card moves the card to In Progress immediately and dispatches a
      // session on the same poll - a message must never sit dead in To do.
      let todoDemand = false;
      if (!answered && !inProgress && full.sectionId === TODO_SECTION) {
        await req("PATCH", `${V}/tasks/${encodeURIComponent(full.id)}`, { body: { sectionId: IN_PROGRESS_SECTION }, idempotencyKey: randomUUID() });
        log("to-do demand: card moved to In Progress for task", full.id);
        prependJournal(full.id, desc, `\u2014 ack ${localHHMM()} \u2014 your message moved this task to In Progress; a session is starting now to carry it out.`).catch(() => {});
        full.sectionId = IN_PROGRESS_SECTION;
        inProgress = true;
        todoDemand = true;
        state.lastBoardSig = null;
        saveState();
      }
      // FINISHED REVIVAL (4.7): an unanswered demand on a FINISHED card (by
      // section or completedAt/completed flag) reopens it on THIS poll: back to
      // In Progress, completedAt cleared, REOPENED marker prepended, and the
      // demand dispatched demand-first below (todoDemand bypasses the age
      // floor). The PAUSED hard gate above still wins — a paused card is never
      // revived. Sacred-never-delete: nothing is removed from the description.
      if (!answered && !inProgress && (full.sectionId === FINISHED_SECTION || full.completedAt || full.completed)) {
        const reopenBody = { sectionId: IN_PROGRESS_SECTION };
        try {
          // Probe: does the agent API accept completedAt in a PATCH body?
          await req("PATCH", `${V}/tasks/${encodeURIComponent(full.id)}`, { body: { ...reopenBody, completedAt: null }, idempotencyKey: randomUUID() });
        } catch (eReopen) {
          log("reopen with completedAt:null rejected for task", full.id, eReopen.message || eReopen, "— retrying with sectionId only");
          await req("PATCH", `${V}/tasks/${encodeURIComponent(full.id)}`, { body: reopenBody, idempotencyKey: randomUUID() });
        }
        log("finished demand: card reopened to In Progress for task", full.id);
        prependJournal(full.id, desc, `\u2014 REOPENED ${localHHMM()} \u2014 your message reopened this finished task; a session is starting now to carry it out.`).catch(() => {});
        full.sectionId = IN_PROGRESS_SECTION;
        delete full.completedAt;
        delete full.completed;
        inProgress = true;
        todoDemand = true; // dispatch immediately on this poll, demand-first
        state.lastBoardSig = null;
        saveState();
      }
      if (answered) continue; // already answered by a session
      const ageMin = hhmmAgeMin(demand.time);
      if (ageMin === null || (ageMin < 1 && !todoDemand)) continue;
      const dPrefix = demand.line.slice(0, 40);
      const live = state.launched[full.id] || state.pending[full.id];
      if (!live) {
        // 2a) No live session owns this task → dispatch one (retry budget applies).
        // AUTO-RUNNER (v3): the Android AUTO button assigns To-do tasks via the
        // normal assignSession path (— pinned — marker + section move), which
        // assignedNow() already picks up via the pinned check — so AUTO tasks get
        // exactly one session. Dispatch here is restricted to In Progress (or
        // already-assigned) tasks so a To-do card is never double-sessioned
        // before its assignment lands.
        if (!inProgress && !sig) continue;
        if (!retryAllowed(full.id)) { log("retry budget exhausted for task", full.id); continue; }
        log("unanswered demand on task", full.id, "age(min):", ageMin, "→ dispatching session");
        await launchSession(full);
        const rec = state.pending[full.id] || state.launched[full.id];
        if (rec) { rec.sig = "demand:" + dPrefix; saveState(); }
        continue;
      }
      // 2b) DEMAND 30-SECOND LAW (hard): a running session is a headless
      // one-shot --prompt process — it can NEVER read new card content
      // mid-run, so nudging is theater. The only guaranteed <30 s delivery
      // is REPLACEMENT: kill the live session and relaunch with the demand
      // injected demand-first (IMMEDIATE PRIORITY OVERRIDE). If the demand
      // is still unanswered 25 s after the bridge first saw it, replace now.
      // One replacement per exact demand line (no boot-phase churn); if the
      // replacement also never acks, the silence-revive watchdog owns it.
      {
        const seenKey = "seen:" + dPrefix;
        if (!state.demandSeen) state.demandSeen = {};
        if (!state.demandSeen[full.id] || state.demandSeen[full.id].prefix !== dPrefix) {
          state.demandSeen[full.id] = { prefix: dPrefix, at: Date.now() };
          saveState();
        }
        const seenAt = state.demandSeen[full.id].at;
        const waitMs = Date.now() - seenAt;
        const alreadyReplaced = state.demandReplaced[full.id] === dPrefix;
        if (live.pid && waitMs >= 45_000 && !alreadyReplaced) {
          state.demandReplaced[full.id] = dPrefix;
          state.lastWedgeKill[full.id] = Date.now();
          saveState();
          log("demand 30s law on task", full.id, "pid", live.pid, "\u2014 demand unanswered 45s after first seen \u2192 killing and relaunching demand-first");
          // ZERO-OVERLAP (4.3): claim first, then confirmed kill before relaunch.
          state.pending[full.id] = { at: new Date().toISOString(), pid: null };
          saveState();
          if (!(await killTreeConfirmed(live.pid, full.id))) { delete state.pending[full.id]; saveState(); continue; }
          delete state.launched[full.id];
          delete state.pending[full.id]; // launchSession re-claims synchronously
          saveState();
          if (retryAllowed(full.id)) {
            await launchSession(full);
            const recD = state.pending[full.id] || state.launched[full.id];
            if (recD) { recD.sig = "demand:" + dPrefix; saveState(); }
          } else { log("retry budget exhausted for task", full.id); }
          continue;
        }
        if (!live.pid || alreadyReplaced) continue; // replacement owned this demand; silence-revive watchdog covers the rest
        continue; // demand younger than 25 s — the law replaces at 25 s, no nudge theater
      }
      } catch (ePass) {
        log("task pass failed for", t.id, "— skipped this poll:", ePass.message || ePass);
      }
    }
  } catch (e) {
    log("poll error:", e.message || e, "| cause:", e.cause ? String(e.cause.code || e.cause.message || e.cause) : "none");
  } finally {
    polling = false; // POLL MUTEX release: a thrown pass must never freeze the bridge
  }
}

log("bridge v3 started, pid", process.pid);
// BOOT RE-ARM (user law: after Windows reboots, every In Progress session
// resumes where it left off, immediately, no manual nudge): a reboot is not
// a crash loop. Clear the per-task retry budget so the first poll (1 s) can
// relaunch every assigned, non-paused In Progress card via the dead-pid
// pruner + assignedNow() path. Paused cards stay paused (hard gate).
state.retries = {};
saveState();
log("boot re-arm: retry budgets cleared — assigned In Progress cards relaunch this poll");
setInterval(poll, POLL_MS);
poll();
