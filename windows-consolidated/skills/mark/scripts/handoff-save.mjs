#!/usr/bin/env node
// handoff-save v2.0.0 — THE one-command, self-verifying Daymark handoff save.
// BACKEND LAW: local server only (http://127.0.0.1:18780), sync key auth.
//
// v2.0.0 (2026-11-09) — fixes the bug where a handoff was "VERIFIED SAVED" while the task was
// still marked COMPLETED (hidden from the app's active list). Success now requires ALL of:
//   1. exact content stored (SHA-256 of the stored description === SHA-256 of the master file)
//   2. the task is OPEN (completedAt null) — a completed task is REOPENED automatically, re-read, re-proved
//   3. exactly ONE task with that title in the project
//   4. the task is visible in the project's ACTIVE list (agent API) AND in the app's SYNC STATE (what the
//      PC Electron app and the Android app actually read), open, with the same description length
// and a receipt JSON is written to F:\backup\ai\handoff-receipts\. An agent may claim "saved" ONLY if this
// script printed a line starting "VERIFIED SAVED" that contains "status=open" and "visible=".
//
// Usage:
//   node handoff-save.mjs "<session name>" --desc-file <path> [--project handoff]   write + verify
//   node handoff-save.mjs "<session name>" --verify [--desc-file <path>]            verify only (reopens if hidden)
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";

const API = "http://127.0.0.1:18780";
const KEY = "REPLACE_WITH_LOCAL_SYNC_KEY";
const V = "/api/agent/v1";
const H = { Authorization: "Bearer " + KEY, "Content-Type": "application/json" };
const RECEIPTS = "F:/backup/ai/handoff-receipts";
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const fail = (reason) => {
  console.log("SAVE FAILED — DO NOT REPORT SUCCESS | reason=" + reason);
  process.exit(1);
};

const argv = process.argv.slice(2);
const title = argv[0];
const arg = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const descFile = arg("--desc-file");
const projectName = arg("--project") || "handoff";
const verifyOnly = argv.includes("--verify");

if (!title || title.startsWith("--") || (!descFile && !verifyOnly)) fail('usage: handoff-save.mjs "<session name>" --desc-file <path> [--project handoff]  |  handoff-save.mjs "<session name>" --verify [--desc-file <path>]');
if (/^(sess_|local_|task-|[0-9a-f]{8}-[0-9a-f]{4}-)/i.test(title) || /^(untitled|new session|session|handoff|test)$/i.test(title.trim())) fail('"' + title + '" is an id/placeholder, not the session name the user sees in the sidebar');

let description = null;
if (descFile) {
  try { description = readFileSync(descFile, "utf8"); } catch (e) { fail("cannot read --desc-file " + descFile + " (" + (e && e.code ? e.code : e) + ") — re-create the master file (its text is also stored in the Daymark task), then retry"); }
  if (description.charCodeAt(0) === 0xfeff) description = description.slice(1);
  if (!description.trim()) fail("description file is empty");
  if (description.length > 19800) fail("description is " + description.length + " chars (max 19800) — trim duplicated text only, keep every unique fact, then retry");
}

const req = async (method, path, body) => {
  const res = await fetch(API + path, {
    method,
    headers: { ...H, ...(body || method === "POST" ? { "Idempotency-Key": randomUUID() } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, json, text };
};
const norm = (s) => String(s ?? "").trim().toLowerCase();
const taskOf = (r) => r.json?.task ?? r.json?.item ?? r.json;

// 0. server health
const health = await fetch(API + "/api/health", { signal: AbortSignal.timeout(5000) }).catch(() => null);
if (!health || !health.ok) fail("local server unhealthy at " + API + " — run: schtasks /Run /TN DaymarkLocalSyncServer, then retry");

// 1. resolve project (exact, case-insensitive)
const projRes = await req("GET", V + "/projects?limit=200");
const projects = projRes.json?.projects ?? [];
const project = projects.find((p) => norm(p.name) === norm(projectName));
if (!project) fail('project "' + projectName + '" not found (live projects: ' + projects.map((p) => p.name).join(", ") + ")");

// helper: every task (open AND completed) of the workspace
const allTasks = async () => {
  let cursor; const all = [];
  do {
    const page = await req("GET", V + "/tasks?limit=200" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""));
    all.push(...(page.json?.tasks ?? page.json?.items ?? []));
    cursor = page.json?.nextCursor ?? null;
  } while (cursor);
  return all;
};
const findMatches = async () => (await allTasks()).filter((t) => t.content === title && t.projectId === project.id);

// 2. find the existing task by EXACT title
let matches = await findMatches();
if (matches.length > 1) fail(matches.length + ' tasks titled "' + title + '" already exist in ' + projectName + " — ambiguous; keep one, delete-verify the rest, retry");

let taskId, action;
if (verifyOnly) {
  if (matches.length !== 1) fail('no task titled "' + title + '" exists in project ' + projectName + " — the handoff was NEVER saved; run the save (not --verify)");
  taskId = matches[0].id; action = "verify";
} else if (matches.length === 1) {
  taskId = matches[0].id;
  const patch = await req("PATCH", V + "/tasks/" + encodeURIComponent(taskId), {
    description, projectId: matches[0].projectId, sectionId: matches[0].sectionId ?? null, updatedAt: matches[0].updatedAt,
  });
  if (patch.status !== 200) fail("PATCH update -> HTTP " + patch.status + " :: " + String(patch.text).slice(0, 200));
  action = "updated";
} else {
  const created = await req("POST", V + "/tasks", { title, projectId: project.id, description });
  if (created.status !== 201) fail("POST create -> HTTP " + created.status + " :: " + String(created.text).slice(0, 200));
  taskId = created.json?.task?.id ?? created.json?.item?.id ?? created.json?.id;
  if (!taskId) fail("create returned 201 without a task id :: " + String(created.text).slice(0, 200));
  action = "created";
}

// 3. REOPEN if a completer (bulk automation, another session) left it completed — a completed task is HIDDEN from the app's active list
const read = async () => { const r = await req("GET", V + "/tasks/" + encodeURIComponent(taskId)); return { r, task: taskOf(r) }; };
let { r: back, task } = await read();
let reopened = false;
if (back.status === 200 && task?.completedAt) {
  const ro = await req("POST", V + "/tasks/" + encodeURIComponent(taskId) + "/reopen", {});
  if (ro.status >= 300) fail("task was COMPLETED (hidden) and reopen -> HTTP " + ro.status + " :: " + String(ro.text).slice(0, 160));
  reopened = true;
  ({ r: back, task } = await read());
}

// 4. exact-content + state verification
const stored = task?.description ?? "";
const problems = [];
if (back.status !== 200) problems.push("re-read HTTP " + back.status);
if (task?.content !== title) problems.push("title mismatch: " + JSON.stringify(task?.content));
if (task?.projectId !== project.id) problems.push("project mismatch: " + task?.projectId);
if (task?.completedAt) problems.push("task is still COMPLETED (completedAt=" + task.completedAt + ") after reopen — it is hidden from the app");
if (description !== null) {
  if (stored.length !== description.length) problems.push("char mismatch: sent " + description.length + " stored " + stored.length);
  if (sha(stored) !== sha(description)) problems.push("content hash mismatch (stored text differs from the master file)");
} else if (stored.length < 200) problems.push("stored description is only " + stored.length + " chars — the handoff body is missing");
if (problems.length) fail("verification failed :: " + problems.join("; "));

// 5. VISIBILITY proof — exactly one open task in the project's active list ...
const after = await findMatches();
const openOnes = after.filter((t) => !t.completedAt && t.status !== "completed");
if (after.length !== 1 || openOnes.length !== 1) fail("active-list check failed: " + after.length + " task(s) titled \"" + title + '", ' + openOnes.length + " open (need exactly 1 open)");

// ... and in the SYNC STATE (what the PC app and the Android app actually read), open, same description length
let syncOk = false, revision = "unknown", syncWhy = "task missing from sync state";
for (let i = 0; i < 6 && !syncOk; i++) {
  const sync = await fetch(API + "/api/sync/" + KEY, { signal: AbortSignal.timeout(20000) }).then((r) => r.json()).catch(() => null);
  revision = sync?.revision ?? revision;
  const coll = sync?.state?.tasks;
  const list = Array.isArray(coll) ? coll : coll && typeof coll === "object" ? Object.values(coll) : [];
  const t = list.find((x) => x && x.id === taskId);
  if (!t) syncWhy = "task " + taskId + " not present in the app sync state";
  else if (t.completedAt) syncWhy = "app sync state has the task COMPLETED (completedAt=" + t.completedAt + ")";
  else if (String(t.description ?? "").length !== stored.length) syncWhy = "app sync state description is " + String(t.description ?? "").length + " chars, expected " + stored.length;
  else syncOk = true;
  if (!syncOk) await sleep(1000);
}
if (!syncOk) fail("app visibility check failed :: " + syncWhy);

// 6. receipt (evidence a later session can cite) + loud success
const verdict = "VERIFIED SAVED | action=" + action + " | id=" + taskId + " | title=" + JSON.stringify(title) + " | project=" + project.name +
  " | chars=" + stored.length + " | sha256=" + sha(stored).slice(0, 12) + " | status=open" + (reopened ? " (reopened)" : "") +
  " | visible=active-list+app-sync | revision=" + revision;
let receipt = "unwritten";
try {
  mkdirSync(RECEIPTS, { recursive: true });
  receipt = RECEIPTS + "/" + title.replace(/[^\w.-]+/g, "_") + "-" + new Date().toISOString().replace(/[:.]/g, "-") + ".json";
  writeFileSync(receipt, JSON.stringify({ verdict, title, id: taskId, project: project.name, chars: stored.length, sha256: sha(stored), reopened, revision, at: new Date().toISOString(), descFile }, null, 2));
} catch { /* receipt is best-effort; the verdict line is the contract */ }
console.log(verdict + " | receipt=" + receipt);
