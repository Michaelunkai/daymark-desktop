#!/usr/bin/env node
// mark skill helper — compound Daymark operations with built-in verification.
// Every write op performs the mutation AND re-reads the exact target in ONE invocation,
// then prints a single JSON result: {op, ok, record, verify, revision, undo?}.
// Usage: node dm-ops.mjs <op> [args...]  — see the mark SKILL.md action table.
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

delete process.env.DAYMARK_AI_TOKEN;

const cliDirectory = String.raw`F:\backup\windowsapps\installed\daymark\cli`;
const [{ createDaymarkClient }, { getAgentToken }] = await Promise.all([
  import(pathToFileURL(join(cliDirectory, "client.mjs")).href),
  import(pathToFileURL(join(cliDirectory, "credential.mjs")).href),
]);
// PRIMARY BACKEND: the user's PC "Daymark local server" — zero cloud dependency,
// zero Codex / ChatGPT account (permanent user law). The cloud origin is dead
// for writes; reachable only via the DAYMARK_CLOUD=1 escape hatch.
const LOCAL_API_URL = "http://127.0.0.1:18780";
const LOCAL_SYNC_KEY = "REPLACE_WITH_LOCAL_SYNC_KEY";
const useCloud = process.env.DAYMARK_CLOUD === "1";
const api = await createDaymarkClient({
  apiUrl: useCloud ? "https://daymark-sync.michaelovsky5.workers.dev" : LOCAL_API_URL,
  token: useCloud ? await getAgentToken() : LOCAL_SYNC_KEY,
  onMutationKey: (key) => console.error(`Idempotency-Key: ${key}`),
});
const V = "/api/agent/v1";
const DELETABLE = new Set(["tasks", "notes", "projects", "order-items"]);
const PATCHABLE = new Set(["tasks", "notes", "projects", "sections", "labels", "filters", "order-items"]);

const emit = (value) => console.log(JSON.stringify(value, null, 2));
const norm = (s) => String(s ?? "").normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
const stripBom = (t) => (t.charCodeAt(0) === 0xfeff ? t.slice(1) : t);
const readJson = async (file) => JSON.parse(stripBom(await readFile(file, "utf8")));
const charCounts = (obj) => {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (typeof v === "string" && v.length > 80) out[k] = v.length;
  }
  return out;
};

async function listAll(resource) {
  const items = [];
  let cursor;
  do {
    const suffix = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const page = await api.request("GET", `${V}/${resource}${suffix}`);
    items.push(...(page.items ?? page[resource] ?? []));
    cursor = page.nextCursor ?? null;
  } while (cursor);
  return items;
}

function sortLanes(items) {
  const lanes = { now: [], later: [], after: [], before: [] };
  for (const item of items) (lanes[item.lane] ??= []).push(item);
  for (const list of Object.values(lanes)) {
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || String(a.createdAt).localeCompare(String(b.createdAt)));
  }
  return lanes;
}

function taskSummary(tasks) {
  return tasks.map((t) => ({
    id: t.id,
    title: t.content,
    status: t.completedAt ? "completed" : "open",
    sectionId: t.sectionId ?? null,
    priority: t.priority,
    due: t.due ?? null,
    descChars: t.description ? t.description.length : 0,
  }));
}

async function resolveProject(ref) {
  const projects = await listAll("projects");
  const hit = projects.find((p) => p.id === ref) ?? projects.find((p) => norm(p.name) === norm(ref));
  if (!hit) {
    throw new Error(`Project '${ref}' not found. Live projects: ${projects.map((p) => p.name).join(", ")}`);
  }
  return hit;
}

async function projectDeep(ref) {
  const project = await resolveProject(ref);
  const [sections, tasks] = await Promise.all([listAll("sections"), listAll("tasks")]);
  return {
    project: { id: project.id, name: project.name, isArchived: project.isArchived },
    sections: sections.filter((s) => s.projectId === project.id).map((s) => ({ id: s.id, name: s.name })),
    tasks: taskSummary(tasks.filter((t) => t.projectId === project.id)),
  };
}

const ops = {
  async inventory() {
    const [projects, sections, tasks, notes, orderItems] = await Promise.all([
      listAll("projects"), listAll("sections"), listAll("tasks"), listAll("notes"), listAll("order-items"),
    ]);
    const byProject = {};
    for (const t of tasks) {
      const bucket = (byProject[t.projectId] ??= { open: 0, completed: 0 });
      bucket[t.completedAt ? "completed" : "open"] += 1;
    }
    return {
      projects: projects.map((p) => ({ id: p.id, name: p.name, isArchived: p.isArchived, order: p.order, taskCounts: byProject[p.id] ?? { open: 0, completed: 0 } })),
      sections: sections.map((s) => ({ id: s.id, projectId: s.projectId, name: s.name })),
      notes: notes.map((n) => ({ id: n.id, title: n.title })),
      order: sortLanes(orderItems),
      counts: { projects: projects.length, sections: sections.length, tasks: tasks.length, notes: notes.length, orderItems: orderItems.length },
    };
  },

  async tasks([ref]) {
    if (!ref) throw new Error("Usage: dm-ops.mjs tasks <projectId-or-name>");
    return projectDeep(ref);
  },

  async find(words) {
    const q = norm(words.join(" "));
    if (!q) throw new Error("Usage: dm-ops.mjs find <text to search>");
    const [projects, tasks, notes, orderItems] = await Promise.all([
      listAll("projects"), listAll("tasks"), listAll("notes"), listAll("order-items"),
    ]);
    const hits = [];
    for (const t of tasks) if (norm(t.content).includes(q) || norm(t.description).includes(q)) {
      hits.push({ kind: "task", id: t.id, projectId: t.projectId, title: t.content, status: t.completedAt ? "completed" : "open" });
    }
    for (const n of notes) if (norm(n.title).includes(q) || norm(n.body).includes(q)) {
      hits.push({ kind: "note", id: n.id, title: n.title });
    }
    for (const o of orderItems) if (norm(o.title).includes(q)) {
      hits.push({ kind: "order-item", id: o.id, title: o.title, lane: o.lane, status: o.status });
    }
    for (const p of projects) if (norm(p.name).includes(q)) {
      hits.push({ kind: "project", id: p.id, name: p.name });
    }
    return { query: q, count: hits.length, hits };
  },

  async "task-add"(argv) {
    const opts = { labels: [] };
    const words = [];
    for (let i = 0; i < argv.length; i += 1) {
      const a = argv[i];
      const take = (name) => { const v = argv[++i]; if (!v) throw new Error(`${name} needs a value.`); return v; };
      if (a === "--desc-file") opts.descFile = take(a);
      else if (a === "--due") opts.due = take(a);
      else if (a === "--time") opts.time = take(a);
      else if (a === "--priority") opts.priority = Number(take(a));
      else if (a === "--section") opts.sectionId = take(a);
      else if (a === "--labels") opts.labels.push(...take(a).split(",").map((s) => s.trim()).filter(Boolean));
      else words.push(a);
    }
    const [projectRef, ...titleWords] = words;
    if (!projectRef || !titleWords.length) throw new Error("Usage: dm-ops.mjs task-add <projectId-or-name> <title words> [--desc-file f] [--due YYYY-MM-DD] [--time HH:MM] [--priority 1-4] [--section id] [--labels a,b]");
    const project = await resolveProject(projectRef);
    const body = { title: titleWords.join(" "), projectId: project.id };
    if (opts.descFile) body.description = stripBom(await readFile(opts.descFile, "utf8"));
    if (opts.due) body.due = { date: opts.due, ...(opts.time ? { time: opts.time } : {}) };
    if (opts.priority !== undefined) body.priority = opts.priority;
    if (opts.sectionId) body.sectionId = opts.sectionId;
    if (opts.labels.length) body.labelIds = opts.labels;
    const sent = { title: body.title, description: body.description?.length, due: body.due, priority: body.priority };
    const created = await api.request("POST", `${V}/tasks`, { body, idempotencyKey: randomUUID() });
    const id = created.task?.id ?? created.item?.id ?? created.id;
    const back = await api.request("GET", `${V}/tasks/${encodeURIComponent(id)}`);
    const record = back.task ?? back.item ?? back;
    const verify = {
      titleMatch: record.content === body.title,
      charsMatch: (body.description?.length ?? 0) === (record.description?.length ?? 0),
      projectIdMatch: record.projectId === project.id,
    };
    return { op: "task-add", ok: verify.titleMatch && verify.charsMatch && verify.projectIdMatch, sent: { title: body.title, description: body.description?.length, due: body.due, priority: body.priority }, task: { id: record.id, title: record.content, status: record.completedAt ? "completed" : "open" }, verify };
  },

  async create([resource, payloadFile]) {
    if (!resource || !payloadFile) throw new Error("Usage: dm-ops.mjs create <resource> <payload.json>  (resource: projects|sections|tasks|notes|labels|filters)");
    const body = await readJson(payloadFile);
    const created = await api.request("POST", `${V}/${resource}`, { body, idempotencyKey: randomUUID() });
    const record = created[resource.slice(0, -1)] ?? created.item ?? created;
    const id = record.id;
    const back = await api.request("GET", `${V}/${resource}/${encodeURIComponent(id)}`);
    const stored = back[resource.slice(0, -1)] ?? back.item ?? back;
    return { op: "create", ok: Boolean(stored.id), sent: charCounts(body), record: stored };
  },

  async update([resource, id, payloadFile]) {
    if (!resource || !id || !payloadFile) throw new Error("Usage: dm-ops.mjs update <resource> <ID> <payload.json>");
    if (!PATCHABLE.has(resource)) throw new Error(`update supports: ${[...PATCHABLE].join(", ")}`);
    const body = await readJson(payloadFile);
    const current = await api.request("GET", `${V}/${resource}/${encodeURIComponent(id)}`);
    const existing = current[resource.slice(0, -1)] ?? current.item ?? current;
    // The server validates location on task/section PATCH; carry it through unless explicitly changed.
    if (resource === "tasks") {
      body.projectId ??= existing.projectId;
      body.sectionId = body.sectionId !== undefined ? body.sectionId : (existing.sectionId ?? null);
    } else if (resource === "sections") {
      body.projectId ??= existing.projectId;
    }
    await api.request("PATCH", `${V}/${resource}/${encodeURIComponent(id)}`, { body, idempotencyKey: randomUUID() });
    const back = await api.request("GET", `${V}/${resource}/${encodeURIComponent(id)}`);
    const record = back[resource.slice(0, -1)] ?? back.item ?? back;
    const sentCounts = Object.fromEntries(Object.entries(body).filter(([, v]) => typeof v === "string").map(([k, v]) => [k, v.length]));
    const storedCounts = Object.fromEntries(Object.entries(record).filter(([k]) => k in sentCounts).map(([k, v]) => [k, typeof v === "string" ? v.length : -1]));
    const verify = Object.fromEntries(Object.keys(sentCounts).map((k) => [k, sentCounts[k] === storedCounts[k]]));
    return { op: "update", ok: Object.values(verify).every(Boolean), sentChars: sentCounts, storedChars: storedCounts, verify, record };
  },

  async complete([resource, id]) {
    return setStatus(resource, id, "complete");
  },
  async reopen([resource, id]) {
    return setStatus(resource, id, "reopen");
  },

  async "delete-verify"([resource, id]) {
    if (!resource || !id) throw new Error("Usage: dm-ops.mjs delete-verify <tasks|notes|projects|order-items> <ID>");
    if (!DELETABLE.has(resource)) throw new Error(`delete-verify supports: ${[...DELETABLE].join(", ")}`);
    let result = null;
    try {
      result = await api.request("POST", `${V}/${resource}/${encodeURIComponent(id)}/delete`, { body: { confirm: "delete" }, idempotencyKey: randomUUID() });
    } catch {
      // Possibly already deleted by an earlier interrupted attempt — reconcile via absence check below.
    }
    let present = true;
    for (let attempt = 0; attempt < 2 && present; attempt += 1) {
      if (attempt === 1) {
        try { await api.request("POST", `${V}/${resource}/${encodeURIComponent(id)}/delete`, { body: { confirm: "delete" }, idempotencyKey: randomUUID() }); } catch {}
      }
      if (resource === "projects" || resource === "order-items") {
        const list = await listAll(resource);
        present = list.some((item) => item.id === id);
      } else {
        try { await api.request("GET", `${V}/${resource}/${encodeURIComponent(id)}`); } catch { present = false; }
      }
    }
    return { op: "delete-verify", ok: !present, deletedReport: result, undo: result?.undo ?? null, confirmedAbsent: !present };
  },

  async "diary-set"([date, payloadFile]) {
    if (!date || !payloadFile) throw new Error("Usage: dm-ops.mjs diary-set <YYYY-MM-DD> <payload.json>");
    const body = await readJson(payloadFile);
    await api.request("PUT", `${V}/diary/${encodeURIComponent(date)}`, { body, idempotencyKey: randomUUID() });
    const back = await api.request("GET", `${V}/diary/${encodeURIComponent(date)}`);
    return { op: "diary-set", ok: Boolean(back), record: back };
  },

  async "diary-delete"([date]) {
    if (!date) throw new Error("Usage: dm-ops.mjs diary-delete <YYYY-MM-DD>");
    const result = await api.request("POST", `${V}/diary/${encodeURIComponent(date)}/delete`, { body: { confirm: "delete" }, idempotencyKey: randomUUID() });
    const back = await api.request("GET", `${V}/diary/${encodeURIComponent(date)}`);
    return { op: "diary-delete", ok: !back || Object.keys(back).length === 0, deletedReport: result, undo: result?.undo ?? null, recordAfter: back };
  },

  async "prefs-set"([payloadFile]) {
    if (!payloadFile) throw new Error("Usage: dm-ops.mjs prefs-set <payload.json>");
    const body = await readJson(payloadFile);
    await api.request("PATCH", `${V}/preferences`, { body, idempotencyKey: randomUUID() });
    const back = await api.request("GET", `${V}/preferences`);
    return { op: "prefs-set", ok: Boolean(back), record: back };
  },

  async api([method, path, payloadFile]) {
    if (!method || !path) throw new Error("Usage: dm-ops.mjs api <METHOD> </api/agent/v1/path> [payload.json]");
    // Git Bash (MSYS) rewrites leading-slash args to Windows paths; recover the API path from anywhere in the string.
    const at = path.indexOf("api/agent/v1/");
    const clean = at >= 0 ? `/${path.slice(at)}` : path;
    if (!clean.startsWith("/api/agent/v1/")) throw new Error("The path must start with /api/agent/v1/. (If Git Bash mangled it, prefix the command with MSYS_NO_PATHCONV=1)");
    const body = payloadFile ? await readJson(payloadFile) : undefined;
    const result = await api.request(method.toUpperCase(), clean, { body, idempotencyKey: body ? randomUUID() : undefined });
    return { op: "api", ok: true, result };
  },
};

async function setStatus(resource, id, action) {
  if (resource !== "tasks" && resource !== "notes") {
    throw new Error("complete/reopen apply to tasks and notes only (Order items: mark.mjs order complete|reopen <ID>).");
  }
  await api.request("POST", `${V}/${resource}/${encodeURIComponent(id)}/${action}`, { idempotencyKey: randomUUID() });
  const back = await api.request("GET", `${V}/${resource}/${encodeURIComponent(id)}`);
  const record = back[resource.slice(0, -1)] ?? back.item ?? back;
  const done = Boolean(record.completedAt);
  const expectedDone = action === "complete";
  return { op: action, ok: done === expectedDone, id: record.id, title: record.content ?? record.title, status: done ? "completed" : "open" };
}

const [op, ...rest] = process.argv.slice(2);
const handler = ops[op];
if (!handler) {
  console.error(`Mark: unknown op '${op}'. Ops: ${Object.keys(ops).join(", ")}`);
  process.exitCode = 1;
} else {
  try {
    emit(await handler(rest));
  } catch (error) {
    console.error(`Mark: ${error.message}`);
    process.exitCode = 1;
  }
}
