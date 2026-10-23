// Daymark local sync server — drop-in replacement for the cloud worker's
// /api/sync + /api/agent/v1 API surface so the PC app, the Android companion,
// and the CLI keep working with zero platform dependency (no Codex, no ChatGPT
// account, ever). State persists to disk; every write is journaled; history is
// bounded. Serves the exact routes both apps call.
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, unlinkSync, appendFileSync } from "node:fs";
import { join, dirname, extname, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DAYMARK_LOCAL_DATA ?? "F:/backup/ai/daymark-local-server/data";
const STATE_FILE = join(DATA_DIR, "sync-state.json");
const HISTORY_DIR = join(DATA_DIR, "history");
const ATTACH_DIR = join(DATA_DIR, "attachments");
const KEYS_FILE = join(DATA_DIR, "agent-keys.json");
const RECEIPTS_FILE = join(DATA_DIR, "receipts.json");
const PORT = Number(process.env.DAYMARK_LOCAL_PORT ?? 18780);
const HISTORY_KEEP = 5;
const MAX_BODY = 2_500_000;

for (const dir of [DATA_DIR, HISTORY_DIR, ATTACH_DIR]) mkdirSync(dir, { recursive: true });

// ---------- storage ----------
let state = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf8")) : null;
let revision = state?.revision ?? 0;
const keys = existsSync(KEYS_FILE) ? JSON.parse(readFileSync(KEYS_FILE, "utf8")) : [];
const receipts = existsSync(RECEIPTS_FILE) ? JSON.parse(readFileSync(RECEIPTS_FILE, "utf8")) : {};

function persistState() {
  writeFileSync(STATE_FILE, JSON.stringify(state));
  // bounded history
  const files = readdirSync(HISTORY_DIR).map(f => ({ f, rev: Number(f.split(".")[0]) })).sort((a, b) => b.rev - a.rev);
  files.slice(HISTORY_KEEP).forEach(e => { try { unlinkSync(join(HISTORY_DIR, e.f)); } catch {} });
}
function archiveState() {
  if (!state) return;
  const json = JSON.stringify(state);
  if (json.length > 200_000) return; // never archive oversized docs
  writeFileSync(join(HISTORY_DIR, `${revision}.json`), json);
}
function seedFromCloudExport() {
  // If a one-time seed file exists (last good cloud doc), adopt it.
  const seedPath = join(DATA_DIR, "seed-state.json");
  if (!existsSync(seedPath)) return null;
  const seeded = JSON.parse(readFileSync(seedPath, "utf8"));
  revision = Number(seeded.revision ?? 1);
  state = seeded.state ?? seeded;
  state.revision = revision;
  persistState();
  try { unlinkSync(seedPath); } catch {}
  return state;
}
if (!state) seedFromCloudExport() ?? { revision: 0 };

// ---------- merge (same semantics as the cloud worker) ----------
function compareMutationTimestamp(a, b) {
  const av = typeof a === "string" ? Date.parse(a) : NaN;
  const bv = typeof b === "string" ? Date.parse(b) : NaN;
  if (Number.isNaN(av) && Number.isNaN(bv)) return 0;
  if (Number.isNaN(av)) return -1;
  if (Number.isNaN(bv)) return 1;
  return av - bv;
}
function newerRecord(left, right) {
  const merged = { ...right };
  for (const [id, value] of Object.entries(left ?? {})) {
    const other = right?.[id];
    if (!other || compareMutationTimestamp(value?.updatedAt, other?.updatedAt) >= 0) merged[id] = structuredClone(value);
  }
  return merged;
}
function mergeSyncStates(local, remote) {
  const authoritative = compareMutationTimestamp(local?.updatedAt, remote?.updatedAt) >= 0 ? local : remote;
  const merged = {
    ...structuredClone(remote),
    schemaVersion: Math.max(Number(local?.schemaVersion ?? 0), Number(remote?.schemaVersion ?? 0), 6),
    revision: Math.max(Number(local?.revision ?? 0), Number(remote?.revision ?? 0)),
    updatedAt: authoritative?.updatedAt,
    clientId: local?.clientId ?? remote?.clientId,
    projects: newerRecord(local?.projects, remote?.projects),
    sections: newerRecord(local?.sections, remote?.sections),
    labels: newerRecord(local?.labels, remote?.labels),
    filters: newerRecord(local?.filters, remote?.filters),
    tasks: newerRecord(local?.tasks, remote?.tasks),
    orderItems: newerRecord(local?.orderItems, remote?.orderItems),
    notes: newerRecord(local?.notes, remote?.notes),
    reminders: newerRecord(local?.reminders, remote?.reminders),
    diaryEntries: newerRecord(local?.diaryEntries, remote?.diaryEntries),
    preferences: authoritative?.preferences ?? {},
    usage: compareMutationTimestamp(local?.usage?.updatedAt, remote?.usage?.updatedAt) >= 0 ? (local?.usage ?? null) : (remote?.usage ?? null),
    undoStack: (authoritative?.undoStack ?? []).slice(-10),
    syncTombstones: (() => {
      const merged = { ...(remote?.syncTombstones ?? {}) };
      for (const [k, v] of Object.entries(local?.syncTombstones ?? {})) {
        const other = merged[k];
        if (!other || compareMutationTimestamp(v?.deletedAt, other?.deletedAt) >= 0) merged[k] = v;
      }
      const entries = Object.entries(merged).sort((a, b) => String(b[1]?.deletedAt ?? "").localeCompare(String(a[1]?.deletedAt ?? "")));
      return Object.fromEntries(entries.slice(0, 400));
    })(),
  };
  // apply tombstones
  const collections = ["projects", "sections", "labels", "filters", "tasks", "orderItems", "notes", "reminders", "diaryEntries"];
  for (const [key, tombstone] of Object.entries(merged.syncTombstones ?? {})) {
    const sep = key.indexOf(":"); if (sep < 1) continue;
    const [coll, id] = [key.slice(0, sep), key.slice(sep + 1)];
    const record = merged[collections.find(c => c === coll)]?.[id];
    if (record && compareMutationTimestamp(record.updatedAt, tombstone.deletedAt) <= 0) delete merged[coll][id];
  }
  return merged;
}

// sanitize journal bloat server-side (same policy as the worker fix)
function sanitizeSyncState(s) {
  // Intentionally a NO-OP for task descriptions and undo history: the user's
  // journals must NEVER be deleted. The unbounded-growth problem was the
  // history table, bounded separately (HISTORY_KEEP + archive max size).
  return s;
}
// Internal `__`-prefixed fields (__syncKey, __knownKeys) must NEVER reach
// clients: they leak into client state, make the client's syncStatesMatch
// comparison permanently unequal, and turn every client into a 6/second
// full-document push storm that starves all other sync traffic.
function publicState() {
  if (!state) return state;
  const clone = { ...state };
  for (const key of Object.keys(clone)) if (key.startsWith("__")) delete clone[key];
  return clone;
}

// ---------- helpers ----------
const SYNC_KEY_RE = /^[A-Za-z0-9_-]{22}$/;
function json(res, body, status = 200) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
  res.end(payload);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > MAX_BODY) { reject(new Error("payload_too_large")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
function bearer(req) {
  const h = req.headers.authorization ?? "";
  return h.startsWith("Bearer ") ? h.slice(7) : "";
}
function hashToken(t) { return createHash("sha256").update(t).digest("hex"); }
function keyForToken(token) {
  if (SYNC_KEY_RE.test(token)) return { id: "sync-key", sync_key: token, scopes: ["*"] };
  const h = hashToken(token);
  return keys.find(k => k.tokenHash === h) ?? null;
}
function hasScope(key, scope) { return key.scopes.includes("*") || key.scopes.includes(scope); }
function nowIso() { return new Date().toISOString(); }

function ensureCollections(s) {
  for (const c of ["projects", "sections", "labels", "filters", "tasks", "orderItems", "notes", "reminders", "diaryEntries"]) {
    if (!s[c] || typeof s[c] !== "object") s[c] = {};
  }
  if (!Array.isArray(s.undoStack)) s.undoStack = [];
  if (!s.syncTombstones || typeof s.syncTombstones !== "object") s.syncTombstones = {};
  if (!s.preferences || typeof s.preferences !== "object") s.preferences = {};
  return s;
}
if (state) ensureCollections(state);

// Receipts memo grows with every mutation; cap it (idempotency only needs
// recent entries) so a long-lived server cannot spiral.
function capReceipts() {
  const keys = Object.keys(receipts);
  if (keys.length > 4000) {
    for (const k of keys.slice(0, keys.length - 2000)) delete receipts[k];
  }
}
function commitState(nextRevision) {
  revision = nextRevision;
  state.revision = revision;
  state.updatedAt = nowIso();
  sanitizeSyncState(state);
  ensureCollections(state);
  archiveState();
  persistState();
  capReceipts();
}

function tombstoneKey(collection, id) { return `${collection}:${id}`; }
function markTombstone(s, collection, id, ts) { s.syncTombstones[tombstoneKey(collection, id)] = { deletedAt: ts }; }

// ---------- routes ----------
async function handleSync(req, res, syncKey, pathname, url) {
  if (!state) return json(res, { error: "workspace_not_initialized" }, 409);
  if (pathname.endsWith("/changes")) {
    const after = Number(url.searchParams.get("after") ?? -1);
    if (!Number.isInteger(after) || after < 0) return json(res, { error: "invalid_revision" }, 400);
    const deadline = Date.now() + 24_000;
    while (Date.now() < deadline) {
      if (revision > after) return json(res, { revision, state: publicState(), updatedAt: state.updatedAt });
      await new Promise(r => setTimeout(r, 250));
    }
    res.writeHead(204, { "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*" });
    return res.end();
  }
  if (req.method === "GET") return json(res, { revision, state: publicState(), updatedAt: state.updatedAt });
  if (req.method !== "PUT") return json(res, { error: "method_not_allowed" }, 405);
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch { return json(res, { error: "invalid_json" }, 400); }
  const incoming = payload?.state;
  const expected = Number(payload?.expectedRevision);
  if (!incoming || typeof incoming !== "object" || !Number.isInteger(expected)) return json(res, { error: "invalid_payload" }, 400);
  // Always merge, even when `expected` is stale: the merge is per-record with
  // updatedAt authority, so a concurrent writer can never be clobbered, and
  // rejecting pushes over a moving revision only starves slower clients
  // (measured: the phone lost every race against the desktop's write loop and
  // its edits never landed). A stale push now merges cleanly instead of 409ing.
  // The response echoes the client's own merged-in state so its post-push
  // equality check converges immediately; the long-poll delivers the true
  // authoritative merge right after.
  state = mergeSyncStates(incoming, state);
  commitState(Math.max(revision + 1, Number(incoming.revision ?? 0), 1));
  return json(res, { revision, state: { ...incoming, revision, updatedAt: state.updatedAt }, updatedAt: state.updatedAt });
}

const RESOURCE_MAP = {
  projects: { singular: "project", collection: "projects" },
  sections: { singular: "section", collection: "sections" },
  labels: { singular: "label", collection: "labels" },
  filters: { singular: "filter", collection: "filters" },
  tasks: { singular: "task", collection: "tasks" },
  notes: { singular: "note", collection: "notes" },
  "order-items": { singular: "order-item", collection: "orderItems" },
};

async function handleAgent(req, res, pathname, url = new URL("http://local/")) {
  if (pathname === "/health") return json(res, { status: "ok", apiVersion: "2.0.0", persistence: "local" });
  if (pathname === "/ready") return json(res, { status: "ready", apiVersion: "2.0.0", persistence: "local" });
  if (pathname === "/capabilities") {
    const key = keyForToken(bearer(req));
    if (!key) return json(res, { error: "unauthorized" }, 401);
    return json(res, { apiVersion: "2.0.0", key: { id: key.id, scopes: key.scopes }, discovery: "/.well-known/daymark-ai.json" });
  }
  if (pathname === "/keys" && req.method === "POST") {
    const syncKey = bearer(req);
    if (!SYNC_KEY_RE.test(syncKey) || !state || syncKey !== stateKey()) return json(res, { error: "unauthorized" }, 401);
    let body; try { body = JSON.parse(await readBody(req) || "{}"); } catch { body = {}; }
    const token = "dmk_local_" + randomUUID().replace(/-/g, "");
    const record = { id: "agent-key-" + randomUUID(), name: String(body.name ?? "local key"), tokenHash: hashToken(token), scopes: ["*"], createdAt: nowIso() };
    keys.push(record); writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2));
    return json(res, { key: { ...record, token } }, 201);
  }
  if (pathname === "/keys" && req.method === "GET") {
    const key = keyForToken(bearer(req)); if (!key) return json(res, { error: "unauthorized" }, 401);
    return json(res, { keys: keys.map(({ tokenHash, ...rest }) => rest) });
  }

  if (!state) return json(res, { error: "workspace_not_initialized" }, 409);
  const key = keyForToken(bearer(req));
  if (!key) return json(res, { error: "unauthorized" }, 401);

  // tasks list with pagination (CLI enumerates pages)
  const listMatch = pathname.match(/^\/(projects|sections|labels|filters|tasks|notes|order-items)$/);
  if (listMatch && req.method === "GET") {
    const coll = RESOURCE_MAP[listMatch[1]].collection;
    const items = Object.values(state[coll] ?? {});
    // The CLI paginates with ?cursor=<offset> (its listAll loop); honor both.
    const cursorParam = url.searchParams.get("cursor");
    const offset = Number(cursorParam ?? url.searchParams.get("offset") ?? 0) || 0;
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 250);
    // Optional server-side filters matching the cloud contract: ?status= and
    // ?projectId= on task lists.
    let filtered = items;
    if (listMatch[1] === "tasks") {
      const status = url.searchParams.get("status");
      if (status === "open") filtered = filtered.filter((t) => !t.completedAt);
      else if (status === "completed") filtered = filtered.filter((t) => t.completedAt);
      const projectId = url.searchParams.get("projectId");
      if (projectId) filtered = filtered.filter((t) => t.projectId === projectId);
    }
    const page = filtered.slice(offset, offset + limit);
    // The CLI keys the envelope by the RESOURCE path name (e.g. "order-items"),
    // not the internal collection name ("orderItems"). Task lists additionally
    // carry revision/nextOffset/total for the CLI's strict complete-pagination
    // loop (cli/client.mjs listAllTasks).
    const envelope = { [listMatch[1]]: page };
    if (offset + limit < items.length) envelope.nextCursor = String(offset + limit);
    if (listMatch[1] === "tasks") {
      envelope.revision = revision;
      envelope.total = filtered.length;
      envelope.nextOffset = offset + limit < filtered.length ? offset + limit : null;
    }
    return json(res, envelope);
  }
  const itemMatch = pathname.match(/^\/(projects|sections|labels|filters|tasks|notes|order-items)\/([A-Za-z0-9_-]{3,160})$/);
  if (itemMatch) {
    const [, resource, id] = itemMatch;
    const { singular, collection } = RESOURCE_MAP[resource];
    if (req.method === "GET") {
      const record = state[collection]?.[id];
      if (!record) return json(res, { error: "not_found" }, 404);
      return json(res, resource === "tasks" ? { task: record } : { [singular]: record });
    }
    if (req.method === "PATCH" || req.method === "POST") {
      const receipt = receipts[req.headers["idempotency-key"]];
      if (receipt) return json(res, receipt.body, receipt.status);
      let body; try { body = JSON.parse(await readBody(req) || "{}"); } catch { return json(res, { error: "invalid_json" }, 400); }
      const record = state[collection]?.[id];
      if (!record) return json(res, { error: "not_found" }, 404);
      if (body.confirm === "delete") {
        delete state[collection][id];
        markTombstone(state, collection, id, nowIso());
        const undo = { id: "agent-undo-" + randomUUID().slice(0, 8), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
        state.undoStack.push({ id: undo.id, action: `${resource}.delete`, inverse: { kind: `${resource}.restore`, record: structuredClone(record) } });
        commitState(revision + 1);
        const resp = { deleted: true, undo };
        receipts[req.headers["idempotency-key"]] = { status: 200, body: resp };
        return json(res, resp);
      }
      Object.assign(record, body, { updatedAt: nowIso() });
      if (body.completedAt === null) { record.completedAt = null; record.completionContext = null; }
      commitState(revision + 1);
      const respBody = resource === "tasks" ? { task: record } : { [singular]: record };
      if (req.headers["idempotency-key"]) receipts[req.headers["idempotency-key"]] = { status: 200, body: respBody };
      return json(res, respBody);
    }
  }
  const completeMatch = pathname.match(/^\/tasks\/([A-Za-z0-9_-]{3,160})\/(complete|reopen)$/);
  if (completeMatch && req.method === "POST") {
    const [, id, action] = completeMatch;
    const record = state.tasks?.[id];
    if (!record) return json(res, { error: "not_found" }, 404);
    if (action === "complete" && !record.completedAt) {
      record.completedAt = nowIso();
      record.completionContext = { projectId: record.projectId, sectionId: record.sectionId ?? null, order: record.order };
    } else if (action === "reopen" && record.completedAt) {
      record.completedAt = null; record.completionContext = null;
    }
    record.updatedAt = nowIso();
    commitState(revision + 1);
    return json(res, { task: record, revision });
  }
  // Reversible delete — same contract as the cloud worker: {confirm:"delete"}
  // marks a tombstone (newest deletedAt wins merges) and returns an undo token.
  const deleteMatch = pathname.match(/^\/(tasks|notes|projects|sections|labels|filters|order-items)\/([A-Za-z0-9_-]{3,160})\/delete$/);
  if (deleteMatch && req.method === "POST") {
    const receipt = receipts[req.headers["idempotency-key"]];
    if (receipt) return json(res, receipt.body, receipt.status);
    let body; try { body = JSON.parse(await readBody(req) || "{}"); } catch { return json(res, { error: "invalid_json" }, 400); }
    if (body.confirm !== "delete") return json(res, { error: "invalid_payload", message: "confirm=delete required." }, 422);
    const collection = RESOURCE_MAP[deleteMatch[1]].collection;
    const id = deleteMatch[2];
    const record = state[collection]?.[id];
    if (!record) return json(res, { error: "not_found" }, 404);
    delete state[collection][id];
    markTombstone(state, collection, id, nowIso());
    const undo = { id: "agent-undo-" + randomUUID().slice(0, 8), expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };
    state.undoStack.push({ id: undo.id, action: `${deleteMatch[1]}.delete`, inverse: { kind: `${deleteMatch[1]}.restore`, record: structuredClone(record) } });
    commitState(revision + 1);
    const respBody = { deleted: true, undo };
    if (req.headers["idempotency-key"]) receipts[req.headers["idempotency-key"]] = { status: 200, body: respBody };
    return json(res, respBody);
  }
  const createMatch = pathname.match(/^\/(tasks|notes|projects|sections|labels|filters|order-items)$/);
  if (createMatch && req.method === "POST") {
    const receipt = receipts[req.headers["idempotency-key"]];
    if (receipt) return json(res, receipt.body, receipt.status);
    let body; try { body = JSON.parse(await readBody(req) || "{}"); } catch { return json(res, { error: "invalid_json" }, 400); }
    const { singular, collection } = RESOURCE_MAP[createMatch[1]];
    const id = `${singular.replace(/-/g, "_")}-${randomUUID().slice(0, 24)}`;
    const record = { id, ...body, createdAt: nowIso(), updatedAt: nowIso(), completedAt: null, order: body.order ?? 0 };
    if (createMatch[1] === "tasks") { record.content = body.title ?? body.content ?? "Untitled"; delete record.title; }
    ensureCollections(state)[collection][id] = record;
    delete state.syncTombstones[tombstoneKey(collection, id)];
    commitState(revision + 1);
    const respBody = resource2(createMatch[1], record);
    if (req.headers["idempotency-key"]) receipts[req.headers["idempotency-key"]] = { status: 201, body: respBody };
    return json(res, respBody, 201);
  }
  return json(res, { error: "not_found" }, 404);
}
function resource2(resource, record) {
  if (resource === "tasks") return { task: record };
  const { singular } = RESOURCE_MAP[resource];
  return { [singular]: record };
}
function stateKey() {
  // The local server trusts the canonical key from the seed; else any 22-char key is accepted on first PUT.
  return state?.__syncKey ?? null;
}

const CLIENT_DIR = process.env.DAYMARK_CLIENT_DIR
  ?? join(__dirname, "..", "dist", "client");
const CLIENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};
function serveClientFile(pathname) {
  let relative = decodeURIComponent(pathname).replace(/^\/+/, "").replace(/\\/g, "/");
  if (relative.includes("\0") || relative.split("/").includes("..")) return null;
  if (relative === "" || !extname(relative)) relative = "index.html";
  const filePath = normalize(join(CLIENT_DIR, relative));
  if (!filePath.startsWith(normalize(CLIENT_DIR))) return null;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return null;
  return {
    body: readFileSync(filePath),
    type: CLIENT_TYPES[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    immutable: relative.startsWith("assets/"),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const pathname = url.pathname;
  // Request journal: makes every client's sync traffic observable on disk so
  // sync failures can be diagnosed from evidence instead of guesswork.
  if (pathname.startsWith("/api/") && !pathname.endsWith("/changes")) {
    const started = Date.now();
    const reqLog = `${new Date().toISOString()} ${req.socket.remoteAddress} ${req.method} ${pathname} ua="${String(req.headers["user-agent"] ?? "").slice(0, 40)}" len=${req.headers["content-length"] ?? 0}`;
    res.on("finish", () => {
      try { appendFileSync(join(DATA_DIR, "requests.log"), `${reqLog} -> ${res.statusCode} (${Date.now() - started}ms)\n`); } catch {}
    });
  }
  try {
    if (req.method === "OPTIONS") {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET,PUT,POST,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, Content-Type, Idempotency-Key, X-Daymark-Sync-Key",
      });
      return res.end();
    }
    if (pathname === "/api/health") return json(res, { service: "daymark-local", status: "ready", protocolVersion: 3, serverTime: nowIso() });
    if (pathname === "/api/sync/pair-canonical" && req.method === "POST") {
      if (!state) return json(res, { error: "workspace_not_initialized" }, 409);
      const key = state.__syncKey ?? Array.from({ length: 22 }, () => "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-"[Math.floor(Math.random() * 64)]).join("");
      state.__syncKey = key;
      persistState();
      res.setHeader("Set-Cookie", `daymark.sync-key=${key}; Path=/; Max-Age=315360000; SameSite=Strict`);
      return json(res, { paired: true });
    }
    const syncMatch = pathname.match(/^\/api\/sync\/([A-Za-z0-9_-]{22})$/);
    const syncChanges = pathname.match(/^\/api\/sync\/([A-Za-z0-9_-]{22})\/changes$/);
    if (syncChanges) return handleSync(req, res, syncChanges[1], pathname + "/changes", url);
    if (syncMatch) {
      // Multi-key local mode: the first key to write becomes canonical; known
      // keys (cloud canonical + paired local keys) are all accepted so both
      // apps and the CLI keep working regardless of which cookie they hold.
      const known = new Set([state?.__syncKey, ...(state?.__knownKeys ?? [])].filter(Boolean));
      if (req.method === "PUT" && !state?.__syncKey) state.__syncKey = syncMatch[1];
      if (!known.has(syncMatch[1])) {
        if (req.method === "PUT") {
          state.__knownKeys = [...(state?.__knownKeys ?? []), syncMatch[1]].slice(-8);
          persistState();
        } else {
          return json(res, { error: "not_found" }, 404);
        }
      }
      return handleSync(req, res, syncMatch[1], pathname, url);
    }
    if (pathname.startsWith("/api/agent/v1/")) return handleAgent(req, res, pathname.slice("/api/agent/v1".length), url);
    if (pathname === "/.well-known/daymark-ai.json") return json(res, { daymark: true, api: "/api/agent/v1", local: true });
    // Static web client (same contract as the cloud worker's ASSETS binding):
    // serve dist/client with index.html fallback for HTML routes. HTML responses
    // carry the canonical pairing cookie exactly like the cloud worker's
    // withPairingCookie — the client reads it to find the sync key.
    if (req.method === "GET" || req.method === "HEAD") {
      const file = serveClientFile(pathname);
      if (file) {
        const headers = {
          "Content-Type": file.type,
          "Cache-Control": file.immutable ? "public, max-age=31536000, immutable" : "no-store",
          "Access-Control-Allow-Origin": "*",
        };
        if (file.type.startsWith("text/html") && state?.__syncKey) {
          headers["Set-Cookie"] = `daymark.sync-key=${state.__syncKey}; Path=/; Max-Age=315360000; SameSite=Strict`;
        }
        res.writeHead(200, headers);
        return req.method === "HEAD" ? res.end() : res.end(file.body);
      }
    }
    return json(res, { error: "not_found" }, 404);
  } catch (error) {
    return json(res, { error: "internal", message: String(error?.message ?? error) }, 500);
  }
});

// accept the first arg as the seed file if provided
const seedArg = process.argv[2];
if (seedArg && existsSync(seedArg)) {
  const seeded = JSON.parse(readFileSync(seedArg, "utf8"));
  revision = Number(seeded.revision ?? 1);
  state = seeded.state ?? seeded;
  state.revision = revision;
  ensureCollections(state);
  sanitizeSyncState(state);
  persistState();
  console.log(`[daymark-local] seeded from ${seedArg} at revision ${revision}`);
}

server.listen(PORT, "0.0.0.0", () => {
  console.log(`[daymark-local] listening on http://127.0.0.1:${PORT} (LAN: port reachable via host IP)`);
  console.log(`[daymark-local] data dir: ${DATA_DIR}`);
  console.log(`[daymark-local] revision: ${revision}, state ${state ? JSON.stringify(state).length : 0} bytes`);
});
