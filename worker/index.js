/**
 * Sites runtime entry for the Vite-built Daymark SPA.
 *
 * Static files are served by the platform ASSETS binding. A browser
 * navigation to a client-side route receives index.html so the app router can
 * render the requested view. Missing non-HTML assets remain 404s.
 */
const worker = {
  async fetch(request, env) {
    const url = new URL(request.url)
    const pathname = url.pathname
    const syncMatch = pathname.match(/^\/api\/sync\/([A-Za-z0-9_-]{22})$/)
    if (pathname === "/api/agent/v1/openapi.json" && request.method === "GET") {
      return json(agentOpenApi(url.origin))
    }
    if (pathname.startsWith("/api/agent/v1/")) {
      return env.DB
        ? handleAgentApi(request, env.DB, pathname)
        : json({ error: "agent_api_unavailable" }, 503)
    }
    if (syncMatch) {
      return env.DB
        ? handleSync(request, env.DB, syncMatch[1])
        : json({ error: "sync_unavailable" }, 503)
    }

    const isStaticAsset = pathname.startsWith('/assets/') || /\.[^/]+$/.test(pathname)
    if (!isStaticAsset && ['GET', 'HEAD'].includes(request.method)) {
      const headers = new Headers(request.headers)
      headers.set('Accept', 'text/html')
      const fallbackRequest = new Request(new URL('/index.html', request.url), {
        method: request.method,
        headers,
      })
      return env.ASSETS.fetch(fallbackRequest)
    }

    return env.ASSETS.fetch(request)
  },
}

async function handleSync(request, db, syncKey) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS daymark_sync_states (sync_key TEXT PRIMARY KEY, revision INTEGER NOT NULL, state_json TEXT NOT NULL, updated_at TEXT NOT NULL)",
  ).run()
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS daymark_sync_history (sync_key TEXT NOT NULL, revision INTEGER NOT NULL, state_json TEXT NOT NULL, archived_at TEXT NOT NULL, PRIMARY KEY (sync_key, revision))",
  ).run()

  if (request.method === "GET") {
    const row = await db
      .prepare("SELECT revision, state_json, updated_at FROM daymark_sync_states WHERE sync_key = ?1")
      .bind(syncKey)
      .first()
    if (!row) return json({ error: "not_found" }, 404)
    return json({
      revision: row.revision,
      state: JSON.parse(row.state_json),
      updatedAt: row.updated_at,
    })
  }

  if (request.method !== "PUT") return json({ error: "method_not_allowed" }, 405)
  const contentLength = Number(request.headers.get("content-length") ?? 0)
  if (contentLength > 2_500_000) return json({ error: "payload_too_large" }, 413)

  let payload
  try {
    payload = await request.json()
  } catch {
    return json({ error: "invalid_json" }, 400)
  }
  const state = payload?.state
  const expectedRevision = Number(payload?.expectedRevision)
  if (
    !state ||
    typeof state !== "object" ||
    !Number.isInteger(state.revision) ||
    state.revision < 0 ||
    !Number.isInteger(expectedRevision) ||
    expectedRevision < 0
  ) {
    return json({ error: "invalid_payload" }, 400)
  }
  const current = await db
    .prepare("SELECT revision, state_json, updated_at FROM daymark_sync_states WHERE sync_key = ?1")
    .bind(syncKey)
    .first()
  if ((current?.revision ?? 0) !== expectedRevision) {
    return json({
      error: "conflict",
      revision: current?.revision ?? 0,
      state: current ? JSON.parse(current.state_json) : null,
    }, 409)
  }

  const updatedAt = new Date().toISOString()
  const currentState = current ? JSON.parse(current.state_json) : null
  const mergedState = currentState ? mergeSyncStates(state, currentState) : structuredClone(state)
  const nextRevision = Math.max(Number(current?.revision ?? 0) + 1, Number(state.revision), 1)
  mergedState.revision = nextRevision
  mergedState.updatedAt = updatedAt
  const stateJson = JSON.stringify(mergedState)
  if (current) {
    await db
      .prepare("INSERT OR IGNORE INTO daymark_sync_history (sync_key, revision, state_json, archived_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(syncKey, current.revision, current.state_json, updatedAt)
      .run()
    const result = await db
      .prepare("UPDATE daymark_sync_states SET revision = ?1, state_json = ?2, updated_at = ?3 WHERE sync_key = ?4 AND revision = ?5")
      .bind(nextRevision, stateJson, updatedAt, syncKey, expectedRevision)
      .run()
    if (!result.meta?.changes) {
      const latest = await db
        .prepare("SELECT revision, state_json, updated_at FROM daymark_sync_states WHERE sync_key = ?1")
        .bind(syncKey)
        .first()
      return json({
        error: "conflict",
        revision: latest?.revision ?? 0,
        state: latest ? JSON.parse(latest.state_json) : null,
      }, 409)
    }
  } else {
    await db
      .prepare("INSERT INTO daymark_sync_states (sync_key, revision, state_json, updated_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(syncKey, nextRevision, stateJson, updatedAt)
      .run()
  }
  return json({ revision: nextRevision, state: mergedState, updatedAt })
}

const AGENT_API_PREFIX = "/api/agent/v1"
const AGENT_SCOPES = ["projects:read", "tasks:read", "tasks:write"]
const SYNC_KEY_PATTERN = /^[A-Za-z0-9_-]{22}$/
const TOKEN_HASH_PATTERN = /^[a-f0-9]{64}$/
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._-]{8,128}$/

async function handleAgentApi(request, db, pathname) {
  await ensureAgentTables(db)
  const relativePath = pathname.slice(AGENT_API_PREFIX.length)

  if (relativePath === "/keys") {
    return handleAgentKeys(request, db)
  }
  const revokeMatch = relativePath.match(/^\/keys\/(agent-key-[A-Za-z0-9-]{16,80})$/)
  if (revokeMatch) {
    return handleAgentKeyRevoke(request, db, revokeMatch[1])
  }

  const principal = await authorizeAgent(request, db)
  if (!principal.ok) return principal.response

  if (relativePath === "/projects" && request.method === "GET") {
    if (!hasScope(principal.key, "projects:read")) return forbidden("projects:read")
    const current = await getSyncState(db, principal.key.sync_key)
    if (!current) return json({ error: "workspace_not_initialized" }, 409)
    const state = parseStoredState(current)
    if (!state) return json({ error: "invalid_workspace_state" }, 500)
    return json({
      projects: Object.values(state.projects ?? {})
        .map((project) => ({
          id: project.id,
          name: project.name,
          isArchived: Boolean(project.isArchived),
          updatedAt: project.updatedAt,
        }))
        .sort((left, right) => left.name.localeCompare(right.name)),
    })
  }

  if (relativePath === "/tasks" && request.method === "GET") {
    if (!hasScope(principal.key, "tasks:read")) return forbidden("tasks:read")
    return listAgentTasks(request, db, principal.key)
  }

  if (relativePath === "/tasks" && request.method === "POST") {
    if (!hasScope(principal.key, "tasks:write")) return forbidden("tasks:write")
    return createAgentTask(request, db, principal.key)
  }

  const completeMatch = relativePath.match(/^\/tasks\/([A-Za-z0-9_-]{3,160})\/complete$/)
  if (completeMatch && request.method === "POST") {
    if (!hasScope(principal.key, "tasks:write")) return forbidden("tasks:write")
    return completeAgentTask(request, db, principal.key, completeMatch[1])
  }

  return json({ error: "not_found" }, 404)
}

async function ensureAgentTables(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS daymark_agent_keys (id TEXT PRIMARY KEY, sync_key TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, scopes TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT)",
  ).run()
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS daymark_agent_receipts (key_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, status INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (key_id, idempotency_key))",
  ).run()
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS daymark_agent_audit (id TEXT PRIMARY KEY, key_id TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT, status INTEGER NOT NULL, created_at TEXT NOT NULL)",
  ).run()
}

async function handleAgentKeys(request, db) {
  const workspace = await authorizeWorkspace(request, db)
  if (!workspace.ok) return workspace.response

  if (request.method === "GET") {
    const result = await db
      .prepare("SELECT id, name, scopes, created_at, last_used_at, revoked_at FROM daymark_agent_keys WHERE sync_key = ?1 ORDER BY created_at DESC")
      .bind(workspace.syncKey)
      .all()
    return json({
      keys: (result.results ?? []).map((key) => publicAgentKey(key)),
    })
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405)
  const payload = await readJson(request, 12_000)
  if (!payload.ok) return payload.response
  const name = typeof payload.value.name === "string" ? payload.value.name.trim() : ""
  const tokenHash = typeof payload.value.tokenHash === "string" ? payload.value.tokenHash : ""
  const scopes = normalizeScopes(payload.value.scopes)
  if (!name || name.length > 80 || !TOKEN_HASH_PATTERN.test(tokenHash) || !scopes.length) {
    return json({ error: "invalid_payload", message: "A name, SHA-256 token hash, and supported scopes are required." }, 422)
  }

  const now = new Date().toISOString()
  const key = {
    id: createRecordId("agent-key"),
    sync_key: workspace.syncKey,
    token_hash: tokenHash,
    name,
    scopes: JSON.stringify(scopes),
    created_at: now,
    last_used_at: null,
    revoked_at: null,
  }
  try {
    await db
      .prepare("INSERT INTO daymark_agent_keys (id, sync_key, token_hash, name, scopes, created_at, last_used_at, revoked_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
      .bind(key.id, key.sync_key, key.token_hash, key.name, key.scopes, key.created_at, key.last_used_at, key.revoked_at)
      .run()
  } catch {
    return json({ error: "key_conflict", message: "That API key could not be provisioned. Generate a new key and retry." }, 409)
  }
  return json({ key: publicAgentKey(key) }, 201)
}

async function handleAgentKeyRevoke(request, db, keyId) {
  const workspace = await authorizeWorkspace(request, db)
  if (!workspace.ok) return workspace.response
  if (request.method !== "DELETE") return json({ error: "method_not_allowed" }, 405)
  const result = await db
    .prepare("UPDATE daymark_agent_keys SET revoked_at = ?1 WHERE id = ?2 AND sync_key = ?3 AND revoked_at IS NULL")
    .bind(new Date().toISOString(), keyId, workspace.syncKey)
    .run()
  if (!result.meta?.changes) return json({ error: "not_found" }, 404)
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
}

async function authorizeWorkspace(request, db) {
  const syncKey = getBearerToken(request)
  if (!syncKey || !SYNC_KEY_PATTERN.test(syncKey)) {
    return { ok: false, response: json({ error: "unauthorized" }, 401) }
  }
  const current = await getSyncState(db, syncKey)
  if (!current) {
    return { ok: false, response: json({ error: "workspace_not_initialized" }, 409) }
  }
  return { ok: true, syncKey }
}

async function authorizeAgent(request, db) {
  const token = getBearerToken(request)
  if (!token || token.length > 512) {
    return { ok: false, response: json({ error: "unauthorized" }, 401) }
  }
  const tokenHash = await sha256Hex(token)
  const key = await db
    .prepare("SELECT id, sync_key, token_hash, name, scopes, created_at, last_used_at, revoked_at FROM daymark_agent_keys WHERE token_hash = ?1 AND revoked_at IS NULL")
    .bind(tokenHash)
    .first()
  if (!key) return { ok: false, response: json({ error: "unauthorized" }, 401) }
  const scopes = normalizeScopes(key.scopes)
  if (!scopes.length) return { ok: false, response: json({ error: "unauthorized" }, 401) }
  const principal = { ...key, scopes }
  await db
    .prepare("UPDATE daymark_agent_keys SET last_used_at = ?1 WHERE id = ?2")
    .bind(new Date().toISOString(), principal.id)
    .run()
  return { ok: true, key: principal }
}

async function listAgentTasks(request, db, key) {
  const current = await getSyncState(db, key.sync_key)
  if (!current) return json({ error: "workspace_not_initialized" }, 409)
  const state = parseStoredState(current)
  if (!state) return json({ error: "invalid_workspace_state" }, 500)
  const url = new URL(request.url)
  const status = url.searchParams.get("status") ?? "open"
  const projectId = url.searchParams.get("projectId")
  const requestedLimit = Number(url.searchParams.get("limit") ?? 100)
  const limit = Number.isInteger(requestedLimit) ? Math.min(Math.max(requestedLimit, 1), 250) : 100
  if (!["open", "completed", "all"].includes(status)) {
    return json({ error: "invalid_status" }, 422)
  }
  const tasks = Object.values(state.tasks ?? {})
    .filter((task) => !projectId || task.projectId === projectId)
    .filter((task) => status === "all" || (status === "open" ? !task.completedAt : Boolean(task.completedAt)))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .slice(0, limit)
    .map(publicTask)
  return json({ tasks, revision: current.revision })
}

async function createAgentTask(request, db, key) {
  const idempotency = getIdempotencyKey(request)
  if (!idempotency) return json({ error: "idempotency_key_required" }, 400)
  const payload = await readJson(request, 32_000)
  if (!payload.ok) return payload.response
  const title = typeof payload.value.title === "string" ? payload.value.title.trim() : ""
  const description = typeof payload.value.description === "string" ? payload.value.description : ""
  const priority = Number(payload.value.priority ?? 4)
  const due = normalizeAgentDue(payload.value.due)
  if (!title || title.length > 500 || description.length > 20_000 || ![1, 2, 3, 4].includes(priority) || due === undefined) {
    return json({ error: "invalid_payload" }, 422)
  }

  return withIdempotency(db, key, idempotency, {
    operation: "task.create",
    payload: { title, description, priority, due, projectId: payload.value.projectId ?? null },
    mutate: async () => {
      let task
      const outcome = await mutateAgentState(db, key.sync_key, (state, now) => {
        const projectId = typeof payload.value.projectId === "string"
          ? payload.value.projectId
          : state.preferences?.inboxProjectId
        const project = state.projects?.[projectId]
        if (!project || project.isArchived) {
          return { ok: false, status: 422, body: { error: "invalid_project" } }
        }
        task = {
          id: createRecordId("agent-task"),
          content: title,
          description,
          projectId,
          sectionId: null,
          parentId: null,
          labelIds: [],
          priority,
          due,
          completedAt: null,
          completionContext: null,
          order: nextTaskOrder(state.tasks, projectId),
          createdAt: now,
          updatedAt: now,
        }
        state.tasks[task.id] = task
        return { ok: true, status: 201, body: { task: publicTask(task), revision: state.revision } }
      })
      if (!outcome.ok) return outcome
      return { ok: true, status: 201, body: { task: publicTask(task), revision: outcome.revision }, targetId: task.id }
    },
  })
}

async function completeAgentTask(request, db, key, taskId) {
  const idempotency = getIdempotencyKey(request)
  if (!idempotency) return json({ error: "idempotency_key_required" }, 400)
  return withIdempotency(db, key, idempotency, {
    operation: "task.complete",
    payload: { taskId },
    mutate: async () => {
      let task
      let changed = false
      const outcome = await mutateAgentState(db, key.sync_key, (state, now) => {
        task = state.tasks?.[taskId]
        if (!task) return { ok: false, status: 404, body: { error: "not_found" } }
        if (!task.completedAt) {
          task.completedAt = now
          task.completionContext = {
            projectId: task.projectId,
            sectionId: task.sectionId ?? null,
            order: task.order,
          }
          task.updatedAt = now
          changed = true
        }
        return { ok: true, status: 200, body: {} }
      })
      if (!outcome.ok) return outcome
      return { ok: true, status: 200, body: { task: publicTask(task), changed, revision: outcome.revision }, targetId: task.id }
    },
  })
}

async function withIdempotency(db, key, idempotencyKey, action) {
  const requestHash = await sha256Hex(JSON.stringify({ operation: action.operation, payload: action.payload }))
  const existing = await db
    .prepare("SELECT request_hash, response_json, status FROM daymark_agent_receipts WHERE key_id = ?1 AND idempotency_key = ?2")
    .bind(key.id, idempotencyKey)
    .first()
  if (existing) {
    if (existing.request_hash !== requestHash) {
      return json({ error: "idempotency_key_reused" }, 409)
    }
    return json(JSON.parse(existing.response_json), Number(existing.status))
  }

  const outcome = await action.mutate()
  if (!outcome.ok) {
    return json(outcome.body, outcome.status)
  }
  const createdAt = new Date().toISOString()
  const responseJson = JSON.stringify(outcome.body)
  await db
    .prepare("INSERT INTO daymark_agent_receipts (key_id, idempotency_key, request_hash, response_json, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(key.id, idempotencyKey, requestHash, responseJson, outcome.status, createdAt)
    .run()
  await db
    .prepare("INSERT INTO daymark_agent_audit (id, key_id, action, target_id, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(createRecordId("agent-audit"), key.id, action.operation, outcome.targetId ?? null, outcome.status, createdAt)
    .run()
  return json(outcome.body, outcome.status)
}

async function mutateAgentState(db, syncKey, mutate) {
  const current = await getSyncState(db, syncKey)
  if (!current) return { ok: false, status: 409, body: { error: "workspace_not_initialized" } }
  const state = parseStoredState(current)
  if (!state) return { ok: false, status: 500, body: { error: "invalid_workspace_state" } }
  const now = new Date().toISOString()
  const mutation = mutate(state, now)
  if (!mutation.ok) return mutation
  const nextRevision = Number(current.revision) + 1
  state.revision = nextRevision
  state.updatedAt = now
  const stateJson = JSON.stringify(state)
  if (stateJson.length > 2_500_000) return { ok: false, status: 413, body: { error: "payload_too_large" } }
  const write = await db
    .prepare("UPDATE daymark_sync_states SET revision = ?1, state_json = ?2, updated_at = ?3 WHERE sync_key = ?4 AND revision = ?5")
    .bind(nextRevision, stateJson, now, syncKey, current.revision)
    .run()
  if (!write.meta?.changes) {
    return { ok: false, status: 409, body: { error: "conflict", retryable: true } }
  }
  return { ok: true, revision: nextRevision }
}

async function getSyncState(db, syncKey) {
  return db
    .prepare("SELECT revision, state_json, updated_at FROM daymark_sync_states WHERE sync_key = ?1")
    .bind(syncKey)
    .first()
}

function parseStoredState(current) {
  try {
    return JSON.parse(current.state_json)
  } catch {
    return null
  }
}

function publicAgentKey(key) {
  return {
    id: key.id,
    name: key.name,
    scopes: normalizeScopes(key.scopes),
    createdAt: key.created_at,
    lastUsedAt: key.last_used_at,
    revokedAt: key.revoked_at,
  }
}

function publicTask(task) {
  return {
    id: task.id,
    content: task.content,
    description: task.description,
    projectId: task.projectId,
    sectionId: task.sectionId ?? null,
    priority: task.priority,
    due: task.due ?? null,
    completedAt: task.completedAt ?? null,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

function nextTaskOrder(tasks, projectId) {
  return Object.values(tasks ?? {})
    .filter((task) => task.projectId === projectId && !task.completedAt)
    .reduce((highest, task) => Math.max(highest, Number(task.order) || 0), -1) + 1
}

function normalizeAgentDue(value) {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== "object" || !/^\d{4}-\d{2}-\d{2}$/.test(value.date ?? "")) return undefined
  const time = value.time === undefined || value.time === null || value.time === "" ? null : value.time
  if (time !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return undefined
  return { date: value.date, time, timezone: null, recurrence: null }
}

function normalizeScopes(value) {
  let scopes
  if (typeof value === "string") {
    try {
      scopes = JSON.parse(value)
    } catch {
      return []
    }
  } else {
    scopes = value
  }
  if (!Array.isArray(scopes)) return []
  const unique = [...new Set(scopes.filter((scope) => typeof scope === "string" && AGENT_SCOPES.includes(scope)))]
  return unique.length === scopes.length ? unique : []
}

function hasScope(key, scope) {
  return key.scopes.includes(scope)
}

function getBearerToken(request) {
  const authorization = request.headers.get("authorization") ?? ""
  const match = authorization.match(/^Bearer ([^\s]+)$/i)
  return match?.[1] ?? null
}

function getIdempotencyKey(request) {
  const value = request.headers.get("idempotency-key") ?? ""
  return IDEMPOTENCY_KEY_PATTERN.test(value) ? value : null
}

async function readJson(request, maxBytes) {
  const contentLength = Number(request.headers.get("content-length") ?? 0)
  if (contentLength > maxBytes) return { ok: false, response: json({ error: "payload_too_large" }, 413) }
  try {
    const value = await request.json()
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, response: json({ error: "invalid_json" }, 400) }
    }
    return { ok: true, value }
  } catch {
    return { ok: false, response: json({ error: "invalid_json" }, 400) }
  }
}

function forbidden(scope) {
  return json({ error: "insufficient_scope", required: scope }, 403)
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
}

function createRecordId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`
}

function agentOpenApi(origin) {
  return {
    openapi: "3.1.0",
    info: {
      title: "Daymark Task Assistant API",
      version: "1.0.0",
      description: "A least-privilege API for listing projects and tasks, creating tasks, and completing tasks. Notes, diary entries, backups, sync state, task deletion, project administration, and bulk actions are not exposed.",
    },
    servers: [{ url: origin }],
    security: [{ agentKey: [] }],
    components: {
      securitySchemes: {
        agentKey: { type: "http", scheme: "bearer", bearerFormat: "Daymark API key" },
      },
    },
    paths: {
      "/api/agent/v1/projects": { get: { operationId: "listProjects", summary: "List visible Daymark projects" } },
      "/api/agent/v1/tasks": {
        get: { operationId: "listTasks", summary: "List tasks by status and project" },
        post: { operationId: "createTask", summary: "Create one task", parameters: [{ name: "Idempotency-Key", in: "header", required: true }] },
      },
      "/api/agent/v1/tasks/{taskId}/complete": {
        post: { operationId: "completeTask", summary: "Mark one task complete", parameters: [{ name: "Idempotency-Key", in: "header", required: true }] },
      },
    },
  }
}

function mergeSyncStates(local, remote) {
  const newerRecord = (left, right) => {
    const merged = { ...right }
    for (const [id, value] of Object.entries(left ?? {})) {
      const other = right?.[id]
      if (!other || value.updatedAt >= other.updatedAt) merged[id] = structuredClone(value)
    }
    return merged
  }

  const merged = {
    ...structuredClone(remote),
    revision: Math.max(Number(local?.revision ?? 0), Number(remote?.revision ?? 0)),
    updatedAt: local?.updatedAt >= remote?.updatedAt ? local.updatedAt : remote.updatedAt,
    clientId: local?.clientId ?? remote?.clientId,
    projects: newerRecord(local?.projects, remote?.projects),
    sections: newerRecord(local?.sections, remote?.sections),
    labels: newerRecord(local?.labels, remote?.labels),
    filters: newerRecord(local?.filters, remote?.filters),
    tasks: newerRecord(local?.tasks, remote?.tasks),
    orderItems: newerRecord(local?.orderItems, remote?.orderItems),
    notes: newerRecord(local?.notes, remote?.notes),
    diaryEntries: newerRecord(local?.diaryEntries, remote?.diaryEntries),
    preferences: local?.updatedAt >= remote?.updatedAt
      ? structuredClone(local.preferences)
      : structuredClone(remote.preferences),
    undoStack: local?.updatedAt >= remote?.updatedAt
      ? structuredClone(local.undoStack)
      : structuredClone(remote.undoStack),
    syncTombstones: mergeTombstones(local?.syncTombstones, remote?.syncTombstones),
  }
  applyTombstones(merged)
  return merged
}

function mergeTombstones(local, remote) {
  const merged = { ...(remote ?? {}) }
  for (const [key, tombstone] of Object.entries(local ?? {})) {
    const other = merged[key]
    if (!other || tombstone.deletedAt >= other.deletedAt) merged[key] = structuredClone(tombstone)
  }
  return merged
}

function applyTombstones(state) {
  const collections = {
    projects: state.projects,
    sections: state.sections,
    labels: state.labels,
    filters: state.filters,
    tasks: state.tasks,
    orderItems: state.orderItems,
    notes: state.notes,
    diaryEntries: state.diaryEntries,
  }
  for (const [key, tombstone] of Object.entries(state.syncTombstones ?? {})) {
    const separator = key.indexOf(":")
    if (separator < 1) continue
    const collectionName = key.slice(0, separator)
    const id = key.slice(separator + 1)
    const collection = collections[collectionName]
    const record = collection?.[id]
    if (record && tombstone.deletedAt >= record.updatedAt) delete collection[id]
  }
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    },
  })
}

export default worker
