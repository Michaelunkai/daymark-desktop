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
    const pairingKey = url.searchParams.get("sync") ?? ""
    if (pathname === "/api/health") {
      return json({
        service: "daymark",
        status: env.DB ? "ready" : "degraded",
        protocolVersion: 3,
        transport: "same-origin-browser-bridge",
        serverTime: new Date().toISOString(),
      }, env.DB ? 200 : 503)
    }
    if (pathname === "/api/sync/pair-canonical") {
      if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405)
      if (!env.DB) return json({ error: "sync_unavailable" }, 503)
      const canonicalSyncKey = await getCanonicalSyncKey(env.DB)
      return canonicalSyncKey
        ? withPairingCookie(json({ paired: true }), canonicalSyncKey, true)
        : json({ error: "workspace_not_initialized" }, 409)
    }
    const syncMatch = pathname.match(/^\/api\/sync\/([A-Za-z0-9_-]{22})$/)
    const syncChangesMatch = pathname.match(/^\/api\/sync\/([A-Za-z0-9_-]{22})\/changes$/)
    if (pathname === "/.well-known/daymark-ai.json" && request.method === "GET") {
      return json(agentDiscovery(url.origin))
    }
    if (pathname === "/daymark-agent.json" && request.method === "GET") {
      return json(agentManifest(url.origin))
    }
    if (pathname === "/api/agent/v1/openapi.json" && request.method === "GET") {
      return json(agentOpenApi(url.origin))
    }
    if (pathname === "/api/agent/v1/health" && request.method === "GET") {
      return json({ status: "ok", apiVersion: "2.0.0", authentication: "required", persistence: env.DB ? "configured" : "unavailable" }, env.DB ? 200 : 503)
    }
    if (pathname === "/api/agent/v1/ready" && request.method === "GET") {
      if (!env.DB) return json({ status: "unavailable", reason: "d1_binding_missing" }, 503)
      try {
        await env.DB.prepare("SELECT 1 AS ready").first()
        return json({ status: "ready", apiVersion: "2.0.0", persistence: "d1" })
      } catch {
        return json({ status: "unavailable", reason: "d1_unreachable" }, 503)
      }
    }
    if (pathname.startsWith("/api/agent/v1/")) {
      return env.DB
        ? handleAgentApi(request, env.DB, pathname)
        : json({ error: "agent_api_unavailable" }, 503)
    }
    if (syncChangesMatch) {
      return env.DB
        ? handleSyncChanges(request, env.DB, syncChangesMatch[1])
        : json({ error: "sync_unavailable" }, 503)
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
      const response = await noStoreAssetResponse(await env.ASSETS.fetch(fallbackRequest))
      if (SYNC_KEY_PATTERN.test(pairingKey)) return withPairingCookie(response, pairingKey)
      const canonicalSyncKey = env.DB ? await getCanonicalSyncKey(env.DB) : null
      return canonicalSyncKey ? withPairingCookie(response, canonicalSyncKey) : response
    }

    return env.ASSETS.fetch(request)
  },
}

async function getCanonicalSyncKey(db) {
  try {
    const configured = await db
      .prepare("SELECT config_value FROM daymark_sync_config WHERE config_key = 'canonical_sync_key'")
      .first()
    if (SYNC_KEY_PATTERN.test(configured?.config_value ?? "")) return configured.config_value
  } catch {
    await db.prepare(
      "CREATE TABLE IF NOT EXISTS daymark_sync_config (config_key TEXT PRIMARY KEY, config_value TEXT NOT NULL, updated_at TEXT NOT NULL)",
    ).run()
  }
  const configured = await db
    .prepare("SELECT config_value FROM daymark_sync_config WHERE config_key = 'canonical_sync_key'")
    .first()
  if (SYNC_KEY_PATTERN.test(configured?.config_value ?? "")) return configured.config_value

  const latest = await db
    .prepare("SELECT sync_key FROM daymark_sync_states ORDER BY revision DESC, updated_at DESC LIMIT 1")
    .first()
  if (!SYNC_KEY_PATTERN.test(latest?.sync_key ?? "")) return null

  await db
    .prepare("INSERT OR IGNORE INTO daymark_sync_config (config_key, config_value, updated_at) VALUES ('canonical_sync_key', ?1, ?2)")
    .bind(latest.sync_key, new Date().toISOString())
    .run()
  return latest.sync_key
}

async function handleSyncChanges(request, db, syncKey) {
  if (request.method !== "GET") return json({ error: "method_not_allowed" }, 405)
  const afterRevision = Number(new URL(request.url).searchParams.get("after") ?? -1)
  if (!Number.isInteger(afterRevision) || afterRevision < 0) {
    return json({ error: "invalid_revision" }, 400)
  }

  for (let attempt = 0; attempt < 80; attempt += 1) {
    const row = await db
      .prepare("SELECT revision, state_json, updated_at FROM daymark_sync_states WHERE sync_key = ?1")
      .bind(syncKey)
      .first()
    if (row && Number(row.revision) > afterRevision) {
      return json({
        revision: row.revision,
        state: JSON.parse(row.state_json),
        updatedAt: row.updated_at,
      })
    }
    await sleep(250)
  }
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } })
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
const AGENT_SCOPES = [
  "projects:read", "projects:write",
  "sections:read", "sections:write",
  "labels:read", "labels:write",
  "filters:read", "filters:write",
  "tasks:read", "tasks:write",
  "calendar:read",
  "notes:read", "notes:write",
  "diary:read", "diary:write",
  "order:read", "order:write",
  "preferences:read", "preferences:write",
  "search:read",
  "undo:write",
]
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

  const resourceResponse = await handleDaymarkResourceApi(request, db, principal.key, relativePath)
  if (resourceResponse) return resourceResponse

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

async function handleDaymarkResourceApi(request, db, key, path) {
  if (path === "/capabilities" && request.method === "GET") {
    return json({
      apiVersion: "2.0.0",
      key: { id: key.id, name: key.name, scopes: key.scopes },
      discovery: "/.well-known/daymark-ai.json",
      openapi: "/api/agent/v1/openapi.json",
    })
  }
  if (path === "/health" && request.method === "GET") {
    return json({ status: "ok", apiVersion: "2.0.0", authentication: "required", persistence: "d1" })
  }
  if (path === "/ready" && request.method === "GET") {
    const state = await getSyncState(db, key.sync_key)
    return state
      ? json({ status: "ready", apiVersion: "2.0.0", revision: state.revision })
      : json({ error: "workspace_not_initialized" }, 409)
  }
  if (path === "/calendar" && request.method === "GET") {
    if (!hasScope(key, "calendar:read")) return forbidden("calendar:read")
    const url = new URL(request.url)
    const from = url.searchParams.get("from")
    const to = url.searchParams.get("to")
    if ((from && !isIsoDate(from)) || (to && !isIsoDate(to)) || (from && to && from > to)) {
      return json({ error: "invalid_date_range" }, 422)
    }
    return readAgentState(db, key, (state, revision) => json({
      tasks: Object.values(state.tasks ?? {})
        .filter((task) => task.due?.date && (!from || task.due.date >= from) && (!to || task.due.date <= to))
        .sort((left, right) => left.due.date.localeCompare(right.due.date) || left.order - right.order)
        .map(publicTask),
      revision,
    }))
  }
  if (path === "/search" && request.method === "GET") {
    if (!hasScope(key, "search:read")) return forbidden("search:read")
    const query = (new URL(request.url).searchParams.get("q") ?? "").trim().toLocaleLowerCase()
    if (!query || query.length > 200) return json({ error: "invalid_query" }, 422)
    return readAgentState(db, key, (state, revision) => json({
      results: searchAgentState(state, query).slice(0, 100),
      revision,
    }))
  }
  if (path === "/preferences") {
    if (request.method === "GET") {
      if (!hasScope(key, "preferences:read")) return forbidden("preferences:read")
      return readAgentState(db, key, (state, revision) => json({ preferences: structuredClone(state.preferences ?? {}), revision }))
    }
    if (request.method === "PATCH") {
      if (!hasScope(key, "preferences:write")) return forbidden("preferences:write")
      const payload = await readJson(request, 12_000)
      if (!payload.ok) return payload.response
      return writeAgentAction(request, db, key, "preferences.update", payload.value, (state, now) => {
        const patch = normalizePreferencePatch(payload.value, state)
        if (!patch) return invalidAgentPayload()
        Object.assign(state.preferences, patch)
        return successAgentMutation(200, { preferences: structuredClone(state.preferences) }, "preferences", now)
      })
    }
  }
  const undoMatch = path.match(/^\/undo\/(agent-undo-[A-Za-z0-9_-]{16,80})$/)
  if (undoMatch && request.method === "POST") {
    if (!hasScope(key, "undo:write")) return forbidden("undo:write")
    return consumeAgentUndo(request, db, key, undoMatch[1])
  }
  const diaryMatch = path.match(/^\/diary\/(\d{4}-\d{2}-\d{2})(?:\/(delete))?$/)
  if (path === "/diary" && request.method === "GET") {
    if (!hasScope(key, "diary:read")) return forbidden("diary:read")
    const date = new URL(request.url).searchParams.get("date")
    if (date && !isIsoDate(date)) return json({ error: "invalid_date" }, 422)
    return readAgentState(db, key, (state, revision) => json({
      entries: Object.values(state.diaryEntries ?? {})
        .filter((entry) => !date || entry.date === date)
        .sort((left, right) => right.date.localeCompare(left.date))
        .map((entry) => structuredClone(entry)),
      revision,
    }))
  }
  if (diaryMatch) {
    const [, date, action] = diaryMatch
    if (!isIsoDate(date)) return json({ error: "invalid_date" }, 422)
    if (request.method === "GET" && !action) {
      if (!hasScope(key, "diary:read")) return forbidden("diary:read")
      return readAgentState(db, key, (state, revision) => {
        const entry = state.diaryEntries?.[date]
        return entry ? json({ entry: structuredClone(entry), revision }) : json({ error: "not_found" }, 404)
      })
    }
    if (request.method === "PUT" && !action) {
      if (!hasScope(key, "diary:write")) return forbidden("diary:write")
      const payload = await readJson(request, 64_000)
      if (!payload.ok) return payload.response
      return writeAgentAction(request, db, key, "diary.upsert", { date, ...payload.value }, (state, now) => {
        const patch = normalizeDiaryPatch(payload.value)
        if (!patch) return invalidAgentPayload()
        const before = state.diaryEntries?.[date] ?? {}
        const entry = { date, body: "", morning: "", highlights: "", reflection: "", tomorrow: "", ...before, ...patch, updatedAt: now }
        if (![entry.body, entry.morning, entry.highlights, entry.reflection, entry.tomorrow].some((value) => value.trim())) {
          return invalidAgentPayload("A diary entry needs content; use the confirmed delete action to remove it.")
        }
        state.diaryEntries ??= {}
        state.diaryEntries[date] = entry
        clearAgentTombstone(state, "diaryEntries", date)
        return successAgentMutation(200, { entry: structuredClone(entry) }, date, now)
      })
    }
    if (request.method === "POST" && action === "delete") {
      if (!hasScope(key, "diary:write")) return forbidden("diary:write")
      const payload = await readJson(request, 12_000)
      if (!payload.ok) return payload.response
      if (payload.value.confirm !== "delete") return json({ error: "confirmation_required" }, 422)
      return writeAgentAction(request, db, key, "diary.delete", { date, confirm: "delete" }, (state, now, requestHash) => {
        const entry = state.diaryEntries?.[date]
        if (!entry) return notFoundAgentMutation()
        delete state.diaryEntries[date]
        markAgentTombstone(state, "diaryEntries", date, now)
        return deleteAgentMutation("diary", date, { kind: "diary.restore", entry }, requestHash, now)
      })
    }
  }
  const resourceMatch = path.match(/^\/(projects|sections|labels|filters|tasks|notes|order-items)(?:\/([A-Za-z0-9_-]{3,160})(?:\/(complete|reopen|archive|delete))?)?$/)
  if (!resourceMatch) return null
  const [, resource, id, action] = resourceMatch
  const definition = resourceDefinition(resource)
  if (!definition) return null
  if (!id) {
    if (request.method === "GET") {
      if (!hasScope(key, definition.readScope)) return forbidden(definition.readScope)
      if (resource === "tasks") return listAgentTasks(request, db, key)
      return readAgentState(db, key, (state, revision) => json({
        [definition.plural]: Object.values(state[definition.collection] ?? {})
          .sort((left, right) => String(left.updatedAt ?? "").localeCompare(String(right.updatedAt ?? "")) * -1)
          .map((record) => publicAgentRecord(resource, record)),
        revision,
      }))
    }
    if (request.method === "POST") {
      if (!hasScope(key, definition.writeScope)) return forbidden(definition.writeScope)
      const payload = await readJson(request, definition.maxBytes)
      if (!payload.ok) return payload.response
      return createAgentResource(request, db, key, resource, payload.value)
    }
    return json({ error: "method_not_allowed" }, 405)
  }
  if (!action && request.method === "GET") {
    if (!hasScope(key, definition.readScope)) return forbidden(definition.readScope)
    return readAgentState(db, key, (state, revision) => {
      const record = state[definition.collection]?.[id]
      return record ? json({ [definition.singular]: publicAgentRecord(resource, record), revision }) : json({ error: "not_found" }, 404)
    })
  }
  if (!action && request.method === "PATCH") {
    if (!hasScope(key, definition.writeScope)) return forbidden(definition.writeScope)
    const payload = await readJson(request, definition.maxBytes)
    if (!payload.ok) return payload.response
    return patchAgentResource(request, db, key, resource, id, payload.value)
  }
  if (action === "archive" && resource === "projects" && request.method === "POST") {
    if (!hasScope(key, "projects:write")) return forbidden("projects:write")
    const payload = await readJson(request, 12_000)
    if (!payload.ok) return payload.response
    return writeAgentAction(request, db, key, "project.archive", { id, archived: payload.value.archived !== false }, (state, now) => {
      const project = state.projects?.[id]
      if (!project) return notFoundAgentMutation()
      project.isArchived = payload.value.archived !== false
      project.updatedAt = now
      return successAgentMutation(200, { project: publicAgentRecord("projects", project) }, id, now)
    })
  }
  if ((action === "complete" || action === "reopen") && (resource === "tasks" || resource === "notes") && request.method === "POST") {
    if (!hasScope(key, definition.writeScope)) return forbidden(definition.writeScope)
    return toggleAgentCompletion(request, db, key, resource, id, action === "complete")
  }
  if (action === "delete" && request.method === "POST") {
    if (!hasScope(key, definition.writeScope)) return forbidden(definition.writeScope)
    const payload = await readJson(request, 12_000)
    if (!payload.ok) return payload.response
    if (payload.value.confirm !== "delete") return json({ error: "confirmation_required" }, 422)
    return deleteAgentResource(request, db, key, resource, id)
  }
  return json({ error: "method_not_allowed" }, 405)
}

function resourceDefinition(resource) {
  return {
    projects: { singular: "project", plural: "projects", collection: "projects", readScope: "projects:read", writeScope: "projects:write", maxBytes: 32_000 },
    sections: { singular: "section", plural: "sections", collection: "sections", readScope: "sections:read", writeScope: "sections:write", maxBytes: 12_000 },
    labels: { singular: "label", plural: "labels", collection: "labels", readScope: "labels:read", writeScope: "labels:write", maxBytes: 12_000 },
    filters: { singular: "filter", plural: "filters", collection: "filters", readScope: "filters:read", writeScope: "filters:write", maxBytes: 32_000 },
    tasks: { singular: "task", plural: "tasks", collection: "tasks", readScope: "tasks:read", writeScope: "tasks:write", maxBytes: 64_000 },
    notes: { singular: "note", plural: "notes", collection: "notes", readScope: "notes:read", writeScope: "notes:write", maxBytes: 128_000 },
    "order-items": { singular: "item", plural: "items", collection: "orderItems", readScope: "order:read", writeScope: "order:write", maxBytes: 32_000 },
  }[resource] ?? null
}

async function readAgentState(db, key, respond) {
  const current = await getSyncState(db, key.sync_key)
  if (!current) return json({ error: "workspace_not_initialized" }, 409)
  const state = parseStoredState(current)
  return state ? respond(state, current.revision) : json({ error: "invalid_workspace_state" }, 500)
}

async function writeAgentAction(request, db, key, operation, payload, mutate) {
  const idempotency = getIdempotencyKey(request)
  if (!idempotency) return json({ error: "idempotency_key_required" }, 400)
  return agentWithIdempotency(db, key, idempotency, {
    operation,
    payload,
    mutate: async (requestHash) => {
      let response
      const outcome = await mutateAgentState(db, key.sync_key, (state, now) => {
        response = mutate(state, now, requestHash)
        return response
      })
      if (!outcome.ok) return outcome
      return {
        ok: true,
        status: response.status,
        body: { ...response.body, revision: outcome.revision },
        targetId: response.targetId,
        undo: response.undo,
      }
    },
  })
}

function successAgentMutation(status, body, targetId) {
  return { ok: true, status, body, targetId }
}

function invalidAgentPayload(message = "The request does not match the documented schema.") {
  return { ok: false, status: 422, body: { error: "invalid_payload", message } }
}

function notFoundAgentMutation() {
  return { ok: false, status: 404, body: { error: "not_found" } }
}

async function createAgentResource(request, db, key, resource, payload) {
  return writeAgentAction(request, db, key, `${resource}.create`, payload, (state, now, requestHash) => {
    const definition = resourceDefinition(resource)
    const collection = state[definition.collection] ?? (state[definition.collection] = {})
    const id = `${resource.replace(/s$/, "").replace("-", "_")}-${requestHash.slice(0, 24)}`
    if (collection[id]) {
      return successAgentMutation(201, { [definition.singular]: publicAgentRecord(resource, collection[id]) }, id)
    }
    const record = buildAgentResource(resource, payload, state, id, now)
    if (!record.ok) return record
    collection[id] = record.value
    clearAgentTombstone(state, definition.collection, id)
    return successAgentMutation(201, { [definition.singular]: publicAgentRecord(resource, record.value) }, id)
  })
}

async function patchAgentResource(request, db, key, resource, id, payload) {
  return writeAgentAction(request, db, key, `${resource}.update`, { id, ...payload }, (state, now) => {
    const definition = resourceDefinition(resource)
    const record = state[definition.collection]?.[id]
    if (!record) return notFoundAgentMutation()
    const patch = normalizeAgentResourcePatch(resource, payload, state, record)
    if (!patch.ok) return patch
    Object.assign(record, patch.value, { updatedAt: now })
    return successAgentMutation(200, { [definition.singular]: publicAgentRecord(resource, record) }, id)
  })
}

async function toggleAgentCompletion(request, db, key, resource, id, complete) {
  return writeAgentAction(request, db, key, `${resource}.${complete ? "complete" : "reopen"}`, { id }, (state, now) => {
    const record = state[resource === "tasks" ? "tasks" : "notes"]?.[id]
    if (!record) return notFoundAgentMutation()
    if (resource === "tasks") {
      if (complete && !record.completedAt) {
        record.completedAt = now
        record.completionContext = { projectId: record.projectId, sectionId: record.sectionId ?? null, order: record.order }
      } else if (!complete && record.completedAt) {
        record.completedAt = null
        record.completionContext = null
      } else {
        return { ...successAgentMutation(200, { task: publicTask(record), changed: false }, id), changed: false }
      }
      record.updatedAt = now
      return successAgentMutation(200, { task: publicTask(record), changed: true }, id)
    }
    if (Boolean(record.completedAt) === complete) {
      return { ...successAgentMutation(200, { note: structuredClone(record), changed: false }, id), changed: false }
    }
    record.completedAt = complete ? now : null
    record.updatedAt = now
    return successAgentMutation(200, { note: structuredClone(record), changed: true }, id)
  })
}

async function deleteAgentResource(request, db, key, resource, id) {
  return writeAgentAction(request, db, key, `${resource}.delete`, { id, confirm: "delete" }, (state, now, requestHash) => {
    const definition = resourceDefinition(resource)
    const record = state[definition.collection]?.[id]
    if (!record) return notFoundAgentMutation()
    if (resource === "projects") {
      if (id === state.preferences?.inboxProjectId) return invalidAgentPayload("Inbox cannot be deleted.")
      if (Object.values(state.projects ?? {}).some((project) => project.parentId === id)) {
        return invalidAgentPayload("Move or delete child projects before deleting this project.")
      }
      const sections = Object.values(state.sections ?? {}).filter((section) => section.projectId === id)
      const tasks = Object.values(state.tasks ?? {}).filter((task) => task.projectId === id)
      for (const task of tasks) {
        task.projectId = state.preferences.inboxProjectId
        task.sectionId = null
        task.updatedAt = now
      }
      for (const section of sections) {
        delete state.sections[section.id]
        markAgentTombstone(state, "sections", section.id, now)
      }
      delete state.projects[id]
      markAgentTombstone(state, "projects", id, now)
      const activeProjectId = state.preferences.activeProjectId
      if (activeProjectId === id) state.preferences.activeProjectId = state.preferences.inboxProjectId
      return deleteAgentMutation("projects", id, {
        kind: "project.restoreBundle",
        project: structuredClone(record),
        sections: structuredClone(sections),
        tasks: structuredClone(tasks),
        activeProjectId,
      }, requestHash, now)
    }
    if (resource === "order-items") {
      const related = Object.values(state.orderItems ?? {}).filter((item) => item.relationId === id)
      for (const item of related) {
        item.relationId = null
        item.updatedAt = now
      }
      delete state.orderItems[id]
      markAgentTombstone(state, "orderItems", id, now)
      return deleteAgentMutation("order-items", id, { kind: "order.restore", item: structuredClone(record), related: structuredClone(related) }, requestHash, now)
    }
    delete state[definition.collection][id]
    markAgentTombstone(state, definition.collection, id, now)
    return deleteAgentMutation(resource, id, { kind: `${resource}.restore`, record: structuredClone(record) }, requestHash, now)
  })
}

function deleteAgentMutation(resource, targetId, inverse, requestHash, now) {
  const id = `agent-undo-${requestHash.slice(0, 32)}`
  const expiresAt = new Date(Date.parse(now) + 30 * 60 * 1000).toISOString()
  return {
    ok: true,
    status: 200,
    body: { deleted: true, undo: { id, expiresAt } },
    targetId,
    undo: { id, action: `${resource}.delete`, inverse, expiresAt },
  }
}

function buildAgentResource(resource, payload, state, id, now) {
  const name = boundedText(payload.name, 200)
  const title = boundedText(payload.title ?? payload.content, 500)
  const description = boundedText(payload.description, 20_000, true)
  const color = boundedToken(payload.color, 32) ?? "charcoal"
  const order = normalizeOrder(payload.order)
  if (resource === "projects") {
    const parentId = optionalId(payload.parentId)
    if (!name || (parentId && !state.projects?.[parentId])) return invalidAgentPayload("A project needs a name and valid parent.")
    if (parentId === id || (parentId && state.projects[parentId]?.parentId === id)) return invalidAgentPayload("The project parent is invalid.")
    return { ok: true, value: { id, name, description, color, parentId, layout: payload.layout === "board" ? "board" : "list", order: order ?? nextAgentOrder(state.projects), isFavorite: Boolean(payload.isFavorite), isArchived: false, createdAt: now, updatedAt: now } }
  }
  if (resource === "sections") {
    const projectId = optionalId(payload.projectId)
    if (!name || !projectId || !state.projects?.[projectId]) return invalidAgentPayload("A section needs a name and valid project.")
    return { ok: true, value: { id, projectId, name, order: order ?? nextAgentOrder(state.sections), isCollapsed: Boolean(payload.isCollapsed), createdAt: now, updatedAt: now } }
  }
  if (resource === "labels") {
    if (!name) return invalidAgentPayload("A label needs a name.")
    return { ok: true, value: { id, name, color, order: order ?? nextAgentOrder(state.labels), isFavorite: Boolean(payload.isFavorite), createdAt: now, updatedAt: now } }
  }
  if (resource === "filters") {
    const query = boundedText(payload.query, 2_000)
    if (!name || !query) return invalidAgentPayload("A filter needs a name and query.")
    return { ok: true, value: { id, name, color, query, order: order ?? nextAgentOrder(state.filters), isFavorite: Boolean(payload.isFavorite), createdAt: now, updatedAt: now } }
  }
  if (resource === "tasks") {
    const projectId = optionalId(payload.projectId) ?? state.preferences?.inboxProjectId
    const sectionId = optionalNullableId(payload.sectionId)
    const parentId = optionalNullableId(payload.parentId)
    const labelIds = normalizeKnownIds(payload.labelIds, state.labels)
    const priority = normalizePriority(payload.priority)
    const due = normalizeAgentDue(payload.due)
    if (!title || !projectId || !state.projects?.[projectId] || state.projects[projectId].isArchived || !validTaskLocation(state, projectId, sectionId) || labelIds === null || priority === null || due === undefined || (parentId && !state.tasks?.[parentId])) {
      return invalidAgentPayload("The task fields are invalid.")
    }
    return { ok: true, value: { id, content: title, description, projectId, sectionId, parentId, labelIds, priority, due, completedAt: null, completionContext: null, order: order ?? nextTaskOrder(state.tasks, projectId), createdAt: now, updatedAt: now } }
  }
  if (resource === "notes") {
    const body = boundedText(payload.body, 60_000, true)
    if (!title && !body.trim()) return invalidAgentPayload("A note needs a title or body.")
    return { ok: true, value: { id, title: title || "Untitled note", body, completedAt: null, order: order ?? nextAgentOrder(state.notes), createdAt: now, updatedAt: now } }
  }
  if (resource === "order-items") {
    const details = boundedText(payload.details, 20_000, true)
    const relationId = optionalNullableId(payload.relationId)
    const lane = ["now", "later", "after", "before"].includes(payload.lane) ? payload.lane : "now"
    const status = ["open", "done", "blocked"].includes(payload.status) ? payload.status : "open"
    const priority = normalizePriority(payload.priority)
    if (!title || (relationId && !state.orderItems?.[relationId]) || priority === null) return invalidAgentPayload("The Order item fields are invalid.")
    return { ok: true, value: { id, title, details, lane, relationId, priority, status, order: order ?? nextAgentOrder(state.orderItems), createdAt: now, updatedAt: now } }
  }
  return invalidAgentPayload()
}

function normalizeAgentResourcePatch(resource, payload, state, record) {
  if (!payload || typeof payload !== "object") return invalidAgentPayload()
  const patch = {}
  if (resource === "projects") {
    if (payload.name !== undefined) {
      const name = boundedText(payload.name, 200)
      if (!name) return invalidAgentPayload("A project needs a name.")
      patch.name = name
    }
    if (payload.description !== undefined) {
      const description = boundedText(payload.description, 20_000, true)
      if (description === null) return invalidAgentPayload()
      patch.description = description
    }
    if (payload.color !== undefined) {
      const color = boundedToken(payload.color, 32)
      if (!color) return invalidAgentPayload()
      patch.color = color
    }
    if (payload.layout !== undefined) {
      if (!["list", "board"].includes(payload.layout)) return invalidAgentPayload()
      patch.layout = payload.layout
    }
    if (payload.isFavorite !== undefined) {
      if (typeof payload.isFavorite !== "boolean") return invalidAgentPayload()
      patch.isFavorite = payload.isFavorite
    }
    if (payload.parentId !== undefined) {
      const parentId = optionalNullableId(payload.parentId)
      if (parentId === undefined || (parentId && (!state.projects[parentId] || parentId === record.id))) return invalidAgentPayload()
      patch.parentId = parentId
    }
  } else if (resource === "sections") {
    if (payload.name !== undefined) {
      const name = boundedText(payload.name, 200)
      if (!name) return invalidAgentPayload()
      patch.name = name
    }
    if (payload.order !== undefined) {
      const order = normalizeOrder(payload.order)
      if (order === null) return invalidAgentPayload()
      patch.order = order
    }
    if (payload.isCollapsed !== undefined) {
      if (typeof payload.isCollapsed !== "boolean") return invalidAgentPayload()
      patch.isCollapsed = payload.isCollapsed
    }
  } else if (resource === "labels") {
    if (payload.name !== undefined) {
      const name = boundedText(payload.name, 200)
      if (!name) return invalidAgentPayload()
      patch.name = name
    }
    if (payload.color !== undefined) {
      const color = boundedToken(payload.color, 32)
      if (!color) return invalidAgentPayload()
      patch.color = color
    }
    if (payload.isFavorite !== undefined) {
      if (typeof payload.isFavorite !== "boolean") return invalidAgentPayload()
      patch.isFavorite = payload.isFavorite
    }
  } else if (resource === "filters") {
    if (payload.name !== undefined) {
      const name = boundedText(payload.name, 200)
      if (!name) return invalidAgentPayload()
      patch.name = name
    }
    if (payload.query !== undefined) {
      const query = boundedText(payload.query, 2_000)
      if (!query) return invalidAgentPayload()
      patch.query = query
    }
    if (payload.color !== undefined) {
      const color = boundedToken(payload.color, 32)
      if (!color) return invalidAgentPayload()
      patch.color = color
    }
  } else if (resource === "tasks") {
    if (payload.title !== undefined || payload.content !== undefined) {
      const content = boundedText(payload.title ?? payload.content, 500)
      if (!content) return invalidAgentPayload("A task needs a title.")
      patch.content = content
    }
    if (payload.description !== undefined) {
      const description = boundedText(payload.description, 20_000, true)
      if (description === null) return invalidAgentPayload()
      patch.description = description
    }
    const projectId = payload.projectId === undefined ? record.projectId : optionalId(payload.projectId)
    const sectionId = payload.sectionId === undefined ? record.sectionId : optionalNullableId(payload.sectionId)
    if (!projectId || sectionId === undefined || !validTaskLocation(state, projectId, sectionId) || state.projects[projectId]?.isArchived) return invalidAgentPayload("The task location is invalid.")
    patch.projectId = projectId
    patch.sectionId = sectionId
    if (payload.labelIds !== undefined) {
      const labelIds = normalizeKnownIds(payload.labelIds, state.labels)
      if (labelIds === null) return invalidAgentPayload()
      patch.labelIds = labelIds
    }
    if (payload.priority !== undefined) {
      const priority = normalizePriority(payload.priority)
      if (priority === null) return invalidAgentPayload()
      patch.priority = priority
    }
    if (payload.due !== undefined) {
      const due = normalizeAgentDue(payload.due)
      if (due === undefined) return invalidAgentPayload()
      patch.due = due
    }
  } else if (resource === "notes") {
    const title = payload.title === undefined ? record.title : boundedText(payload.title, 500, true)
    const body = payload.body === undefined ? record.body : boundedText(payload.body, 60_000, true)
    if (title === null || body === null || (!title && !body.trim())) return invalidAgentPayload("A note needs a title or body.")
    patch.title = title || "Untitled note"
    patch.body = body
  } else if (resource === "order-items") {
    if (payload.title !== undefined) {
      const title = boundedText(payload.title, 500)
      if (!title) return invalidAgentPayload()
      patch.title = title
    }
    if (payload.details !== undefined) {
      const details = boundedText(payload.details, 20_000, true)
      if (details === null) return invalidAgentPayload()
      patch.details = details
    }
    if (payload.lane !== undefined) {
      if (!["now", "later", "after", "before"].includes(payload.lane)) return invalidAgentPayload()
      patch.lane = payload.lane
    }
    if (payload.status !== undefined) {
      if (!["open", "done", "blocked"].includes(payload.status)) return invalidAgentPayload()
      patch.status = payload.status
    }
    if (payload.priority !== undefined) {
      const priority = normalizePriority(payload.priority)
      if (priority === null) return invalidAgentPayload()
      patch.priority = priority
    }
    if (payload.relationId !== undefined) {
      const relationId = optionalNullableId(payload.relationId)
      if (relationId === undefined || relationId === record.id || (relationId && !state.orderItems[relationId])) return invalidAgentPayload()
      patch.relationId = relationId
    }
  }
  if (payload.order !== undefined && resource !== "sections") {
    const order = normalizeOrder(payload.order)
    if (order === null) return invalidAgentPayload()
    patch.order = order
  }
  return Object.keys(patch).length ? { ok: true, value: patch } : invalidAgentPayload("At least one supported field is required.")
}

function normalizePreferencePatch(value, state) {
  const patch = {}
  if (value.theme !== undefined) {
    if (!["system", "light", "dark"].includes(value.theme)) return null
    patch.theme = value.theme
  }
  if (value.showCompleted !== undefined) {
    if (typeof value.showCompleted !== "boolean") return null
    patch.showCompleted = value.showCompleted
  }
  if (value.activeProjectId !== undefined) {
    const activeProjectId = optionalNullableId(value.activeProjectId)
    if (activeProjectId === undefined || (activeProjectId && !state.projects?.[activeProjectId])) return null
    patch.activeProjectId = activeProjectId
  }
  return Object.keys(patch).length ? patch : null
}

function normalizeDiaryPatch(value) {
  const patch = {}
  for (const field of ["body", "morning", "highlights", "reflection", "tomorrow"]) {
    if (value[field] === undefined) continue
    const normalized = boundedText(value[field], 60_000, true)
    if (normalized === null) return null
    patch[field] = normalized
  }
  return Object.keys(patch).length ? patch : null
}

async function consumeAgentUndo(request, db, key, undoId) {
  const idempotency = getIdempotencyKey(request)
  if (!idempotency) return json({ error: "idempotency_key_required" }, 400)
  const row = await db
    .prepare("SELECT id, key_id, sync_key, inverse_json, expected_revision, expires_at, consumed_at FROM daymark_agent_undo WHERE id = ?1 AND key_id = ?2")
    .bind(undoId, key.id)
    .first()
  if (!row) return json({ error: "not_found" }, 404)
  if (row.consumed_at || row.expires_at < new Date().toISOString()) return json({ error: "undo_unavailable" }, 409)
  let inverse
  try {
    inverse = JSON.parse(row.inverse_json)
  } catch {
    return json({ error: "undo_unavailable" }, 409)
  }
  return agentWithIdempotency(db, key, idempotency, {
    operation: "undo.apply",
    payload: { undoId },
    mutate: async () => {
      const outcome = await mutateAgentState(db, key.sync_key, (state) => {
        if (Number(state.revision) !== Number(row.expected_revision)) {
          return { ok: false, status: 409, body: { error: "undo_conflict", retryable: false } }
        }
        const restored = applyAgentInverse(state, inverse)
        return restored ? successAgentMutation(200, { restored: true, undoId }, undoId) : { ok: false, status: 409, body: { error: "undo_unavailable" } }
      })
      if (!outcome.ok) return outcome
      return { ok: true, status: 200, body: { restored: true, undoId, revision: outcome.revision }, targetId: undoId }
    },
    afterSuccess: async () => {
      await db.prepare("UPDATE daymark_agent_undo SET consumed_at = ?1 WHERE id = ?2 AND consumed_at IS NULL")
        .bind(new Date().toISOString(), undoId)
        .run()
    },
  })
}

function applyAgentInverse(state, inverse) {
  if (inverse.kind === "projects.restore") {
    state.projects[inverse.record.id] = inverse.record
    clearAgentTombstone(state, "projects", inverse.record.id)
  } else if (inverse.kind === "project.restoreBundle") {
    state.projects[inverse.project.id] = inverse.project
    clearAgentTombstone(state, "projects", inverse.project.id)
    for (const section of inverse.sections) {
      state.sections[section.id] = section
      clearAgentTombstone(state, "sections", section.id)
    }
    for (const task of inverse.tasks) state.tasks[task.id] = task
    state.preferences.activeProjectId = inverse.activeProjectId
  } else if (inverse.kind === "tasks.restore") {
    state.tasks[inverse.record.id] = inverse.record
    clearAgentTombstone(state, "tasks", inverse.record.id)
  } else if (inverse.kind === "notes.restore") {
    state.notes[inverse.record.id] = inverse.record
    clearAgentTombstone(state, "notes", inverse.record.id)
  } else if (inverse.kind === "order.restore") {
    state.orderItems[inverse.item.id] = inverse.item
    clearAgentTombstone(state, "orderItems", inverse.item.id)
    for (const item of inverse.related) state.orderItems[item.id] = item
  } else if (inverse.kind === "diary.restore") {
    state.diaryEntries[inverse.entry.date] = inverse.entry
    clearAgentTombstone(state, "diaryEntries", inverse.entry.date)
  } else {
    return false
  }
  return true
}

async function agentWithIdempotency(db, key, idempotencyKey, action) {
  const requestHash = await sha256Hex(JSON.stringify({ operation: action.operation, payload: action.payload }))
  const existing = await db
    .prepare("SELECT request_hash, response_json, status FROM daymark_agent_receipts WHERE key_id = ?1 AND idempotency_key = ?2")
    .bind(key.id, idempotencyKey)
    .first()
  if (existing) {
    if (existing.request_hash !== requestHash) return json({ error: "idempotency_key_reused" }, 409)
    return json(JSON.parse(existing.response_json), Number(existing.status))
  }
  const outcome = await action.mutate(requestHash)
  if (!outcome.ok) return json(outcome.body, outcome.status)
  const createdAt = new Date().toISOString()
  if (outcome.undo) {
    await db
      .prepare("INSERT OR IGNORE INTO daymark_agent_undo (id, key_id, sync_key, action, inverse_json, expected_revision, created_at, expires_at, consumed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, NULL)")
      .bind(outcome.undo.id, key.id, key.sync_key, outcome.undo.action, JSON.stringify(outcome.undo.inverse), outcome.body.revision, createdAt, outcome.undo.expiresAt)
      .run()
  }
  const responseJson = JSON.stringify(outcome.body)
  await db
    .prepare("INSERT OR IGNORE INTO daymark_agent_receipts (key_id, idempotency_key, request_hash, response_json, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
    .bind(key.id, idempotencyKey, requestHash, responseJson, outcome.status, createdAt)
    .run()
  await db
    .prepare("INSERT OR IGNORE INTO daymark_agent_audit (id, key_id, idempotency_key, action, target_id, status, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)")
    .bind(`agent-audit-${requestHash.slice(0, 32)}`, key.id, idempotencyKey, action.operation, outcome.targetId ?? null, outcome.status, createdAt)
    .run()
  if (action.afterSuccess) await action.afterSuccess(outcome)
  return json(outcome.body, outcome.status)
}

async function ensureAgentTables(db) {
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS daymark_agent_keys (id TEXT PRIMARY KEY, sync_key TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE, name TEXT NOT NULL, scopes TEXT NOT NULL, created_at TEXT NOT NULL, last_used_at TEXT, revoked_at TEXT)",
  ).run()
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS daymark_agent_receipts (key_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, request_hash TEXT NOT NULL, response_json TEXT NOT NULL, status INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (key_id, idempotency_key))",
  ).run()
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS daymark_agent_audit (id TEXT PRIMARY KEY, key_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, action TEXT NOT NULL, target_id TEXT, status INTEGER NOT NULL, created_at TEXT NOT NULL)",
  ).run()
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS daymark_agent_undo (id TEXT PRIMARY KEY, key_id TEXT NOT NULL, sync_key TEXT NOT NULL, action TEXT NOT NULL, inverse_json TEXT NOT NULL, expected_revision INTEGER NOT NULL, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT)",
  ).run()
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_daymark_agent_keys_sync_created ON daymark_agent_keys (sync_key, created_at DESC)",
  ).run()
  const auditColumns = await db.prepare("PRAGMA table_info(daymark_agent_audit)").all()
  if (!(auditColumns.results ?? []).some((column) => column.name === "idempotency_key")) {
    try {
      await db.prepare("ALTER TABLE daymark_agent_audit ADD COLUMN idempotency_key TEXT NOT NULL DEFAULT ''").run()
    } catch {
      const refreshed = await db.prepare("PRAGMA table_info(daymark_agent_audit)").all()
      if (!(refreshed.results ?? []).some((column) => column.name === "idempotency_key")) throw new Error("Unable to migrate daymark_agent_audit")
    }
  }
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
  if (mutation.changed === false) {
    return { ok: true, revision: Number(current.revision), changed: false }
  }
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
    parentId: task.parentId ?? null,
    labelIds: Array.isArray(task.labelIds) ? [...task.labelIds] : [],
    priority: task.priority,
    due: task.due ?? null,
    completedAt: task.completedAt ?? null,
    completionContext: task.completionContext ?? null,
    order: task.order,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  }
}

function publicAgentRecord(resource, record) {
  return resource === "tasks" ? publicTask(record) : structuredClone(record)
}

function boundedText(value, maxLength, allowEmpty = false) {
  if (value === undefined && allowEmpty) return ""
  if (typeof value !== "string") return null
  const result = allowEmpty ? value : value.trim()
  return result.length <= maxLength && (allowEmpty || result.length > 0) ? result : null
}

function boundedToken(value, maxLength) {
  return typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value) && value.length <= maxLength ? value : null
}

function optionalId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_-]{3,160}$/.test(value) ? value : null
}

function optionalNullableId(value) {
  if (value === null) return null
  if (value === undefined) return undefined
  return optionalId(value)
}

function normalizeOrder(value) {
  if (value === undefined) return undefined
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
}

function normalizePriority(value) {
  if (value === undefined || value === null) return 4
  const priority = Number(value)
  return [1, 2, 3, 4].includes(priority) ? priority : null
}

function normalizeKnownIds(value, collection) {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((id) => !optionalId(id))) return null
  const unique = [...new Set(value)]
  return unique.every((id) => collection?.[id]) ? unique : null
}

function validTaskLocation(state, projectId, sectionId) {
  return Boolean(state.projects?.[projectId]) && (!sectionId || state.sections?.[sectionId]?.projectId === projectId)
}

function nextAgentOrder(collection) {
  return Object.values(collection ?? {}).reduce((maximum, record) => Math.max(maximum, Number(record.order) || 0), -1) + 1
}

function markAgentTombstone(state, collection, id, deletedAt) {
  state.syncTombstones ??= {}
  const key = `${collection}:${id}`
  const current = state.syncTombstones[key]
  if (!current || current.deletedAt <= deletedAt) state.syncTombstones[key] = { deletedAt }
}

function clearAgentTombstone(state, collection, id) {
  if (state.syncTombstones) delete state.syncTombstones[`${collection}:${id}`]
}

function isIsoDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [year, month, day] = value.split("-").map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, day))
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day
}

function searchAgentState(state, query) {
  const results = []
  const add = (type, id, title, subtitle = "") => {
    const haystack = `${title} ${subtitle}`.toLocaleLowerCase()
    if (haystack.includes(query)) results.push({ type, id, title, subtitle: subtitle || undefined })
  }
  for (const project of Object.values(state.projects ?? {})) add("project", project.id, project.name, project.description)
  for (const section of Object.values(state.sections ?? {})) add("section", section.id, section.name)
  for (const label of Object.values(state.labels ?? {})) add("label", label.id, label.name)
  for (const filter of Object.values(state.filters ?? {})) add("filter", filter.id, filter.name, filter.query)
  for (const task of Object.values(state.tasks ?? {})) add("task", task.id, task.content, task.description)
  for (const note of Object.values(state.notes ?? {})) add("note", note.id, note.title, note.body)
  for (const item of Object.values(state.orderItems ?? {})) add("order-item", item.id, item.title, item.details)
  for (const entry of Object.values(state.diaryEntries ?? {})) add("diary", entry.date, entry.date, [entry.body, entry.morning, entry.highlights, entry.reflection, entry.tomorrow].join(" "))
  return results.sort((left, right) => left.type.localeCompare(right.type) || left.title.localeCompare(right.title))
}

function nextTaskOrder(tasks, projectId) {
  return Object.values(tasks ?? {})
    .filter((task) => task.projectId === projectId && !task.completedAt)
    .reduce((highest, task) => Math.max(highest, Number(task.order) || 0), -1) + 1
}

function normalizeAgentDue(value) {
  if (value === undefined || value === null) return null
  if (!value || typeof value !== "object" || !isIsoDate(value.date)) return undefined
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
    const raw = await request.text()
    if (new TextEncoder().encode(raw).byteLength > maxBytes) {
      return { ok: false, response: json({ error: "payload_too_large" }, 413) }
    }
    const value = JSON.parse(raw)
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

function agentDiscovery(origin) {
  return {
    name: "Daymark AI API",
    version: 4,
    apiVersion: "2.0.0",
    integration: "openapi-http",
    manifest: `${origin}/daymark-agent.json`,
    discovery: `${origin}/.well-known/daymark-ai.json`,
    openapi: `${origin}/api/agent/v1/openapi.json`,
    clientConfiguration: `${origin}/daymark-ai-client.json`,
    connector: `${origin}/daymark-ai-connector.mjs`,
    health: `${origin}/api/agent/v1/health`,
    readiness: `${origin}/api/agent/v1/ready`,
    authentication: {
      scheme: "bearer",
      provisioning: "Generate a scoped AI key in Daymark Settings. The secret is shown once and can be revoked there.",
    },
    persistence: "D1-backed Daymark workspace state with optimistic revision conflicts and idempotency receipts.",
    excludedData: ["rawSync", "pairingCodes", "backups", "databaseAdministration", "localOnlyReminders", "activityComments"],
    excludedActions: ["backup.import", "backup.export", "sync.manage", "key.administration.byAgent"],
  }
}

function agentManifest(origin) {
  return {
    ...agentDiscovery(origin),
    scopes: AGENT_SCOPES,
    idempotency: "Every write requires an Idempotency-Key. Reuse the same key after a retryable conflict or transport failure.",
    deletion: "Deletion requires confirm=delete and returns a short-lived undo token. Restore only succeeds when no later workspace revision has intervened.",
    legacyBrowserBridge: "DaymarkAI remains an in-page compatibility adapter only. It is not required for, and is not the authority for, the authenticated remote API.",
  }
}

function agentOpenApi(origin) {
  const idempotency = [{ name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 8, maxLength: 128 } }]
  const resource = (name, scope, schema) => {
    const identifier = name.replace(/[^A-Za-z0-9]/g, "")
    const singular = identifier.endsWith("s") ? identifier.slice(0, -1) : identifier
    return {
      get: operation(`list${identifier}`, `List ${name.toLocaleLowerCase()}`, scope),
      post: operation(`create${singular}`, `Create one ${name.slice(0, -1).toLocaleLowerCase()}`, scope.replace(":read", ":write"), schema, 201, idempotency),
    }
  }
  const item = (name, scope, schema, actions = []) => {
    const identifier = name.replace(/[^A-Za-z0-9]/g, "")
    const path = {
      get: operation(`get${identifier}`, `Read one ${name.toLocaleLowerCase()}`, scope),
      patch: operation(`update${identifier}`, `Update one ${name.toLocaleLowerCase()}`, scope.replace(":read", ":write"), schema, 200, idempotency),
    }
    for (const action of actions) path[action.path] = operation(action.id, action.summary, scope.replace(":read", ":write"), action.schema, 200, idempotency)
    return path
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "Daymark AI API",
      version: "2.0.0",
      description: "A scoped, revision-aware HTTP API for durable Daymark user data. Writes require an Idempotency-Key. Destructive actions require confirm=delete and return a short-lived undo token that only applies at the expected workspace revision.",
    },
    servers: [{ url: origin }],
    security: [{ agentKey: [] }],
    tags: [
      { name: "diagnostics" }, { name: "projects" }, { name: "tasks" }, { name: "calendar" },
      { name: "notes" }, { name: "diary" }, { name: "organization" }, { name: "preferences" }, { name: "search" }, { name: "undo" },
    ],
    components: {
      securitySchemes: { agentKey: { type: "http", scheme: "bearer", bearerFormat: "Daymark API key" } },
      schemas: {
        Error: { type: "object", required: ["error"], properties: { error: { type: "string" }, message: { type: "string" }, retryable: { type: "boolean" } } },
        Task: { type: "object", required: ["id", "content", "projectId", "priority", "createdAt", "updatedAt"], properties: { id: { type: "string" }, content: { type: "string" }, description: { type: "string" }, projectId: { type: "string" }, sectionId: { type: ["string", "null"] }, parentId: { type: ["string", "null"] }, labelIds: { type: "array", items: { type: "string" } }, priority: { type: "integer", enum: [1, 2, 3, 4] }, due: { $ref: "#/components/schemas/TaskDue" }, completedAt: { type: ["string", "null"], format: "date-time" }, completionContext: { type: ["object", "null"] }, order: { type: "integer" }, createdAt: { type: "string", format: "date-time" }, updatedAt: { type: "string", format: "date-time" } } },
        TaskDue: { type: ["object", "null"], properties: { date: { type: "string", format: "date" }, time: { type: ["string", "null"], pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" } } },
        ProjectInput: { type: "object", required: ["name"], properties: { name: { type: "string", maxLength: 200 }, description: { type: "string", maxLength: 20000 }, color: { type: "string" }, parentId: { type: ["string", "null"] }, layout: { type: "string", enum: ["list", "board"] }, isFavorite: { type: "boolean" } } },
        TaskInput: { type: "object", required: ["title"], properties: { title: { type: "string", maxLength: 500 }, description: { type: "string", maxLength: 20000 }, projectId: { type: "string" }, sectionId: { type: ["string", "null"] }, labelIds: { type: "array", items: { type: "string" } }, priority: { type: "integer", enum: [1, 2, 3, 4] }, due: { $ref: "#/components/schemas/TaskDue" } } },
        NoteInput: { type: "object", properties: { title: { type: "string", maxLength: 500 }, body: { type: "string", maxLength: 60000 } } },
        DeleteConfirmation: { type: "object", required: ["confirm"], properties: { confirm: { type: "string", const: "delete" } } },
        Undo: { type: "object", required: ["id", "expiresAt"], properties: { id: { type: "string" }, expiresAt: { type: "string", format: "date-time" } } },
      },
    },
    paths: {
      "/api/agent/v1/health": { get: operation("health", "Check public API health", null) },
      "/api/agent/v1/ready": { get: operation("readiness", "Check public D1 readiness", null) },
      "/api/agent/v1/capabilities": { get: operation("getCapabilities", "List this key's granted scopes", null) },
      "/api/agent/v1/projects": resource("Projects", "projects:read", { $ref: "#/components/schemas/ProjectInput" }),
      "/api/agent/v1/projects/{id}": item("Project", "projects:read", { $ref: "#/components/schemas/ProjectInput" }),
      "/api/agent/v1/projects/{id}/archive": { post: operation("archiveProject", "Archive or restore one project", "projects:write", { type: "object", properties: { archived: { type: "boolean" } } }, 200, idempotency) },
      "/api/agent/v1/projects/{id}/delete": { post: operation("deleteProject", "Delete one project with reversible confirmation", "projects:write", { $ref: "#/components/schemas/DeleteConfirmation" }, 200, idempotency) },
      "/api/agent/v1/sections": resource("Sections", "sections:read", { type: "object", required: ["projectId", "name"], properties: { projectId: { type: "string" }, name: { type: "string" } } }),
      "/api/agent/v1/sections/{id}": item("Section", "sections:read", { type: "object", properties: { name: { type: "string" }, order: { type: "integer" }, isCollapsed: { type: "boolean" } } }),
      "/api/agent/v1/labels": resource("Labels", "labels:read", { type: "object", required: ["name"], properties: { name: { type: "string" }, color: { type: "string" } } }),
      "/api/agent/v1/labels/{id}": item("Label", "labels:read", { type: "object", properties: { name: { type: "string" }, color: { type: "string" }, isFavorite: { type: "boolean" } } }),
      "/api/agent/v1/filters": resource("Filters", "filters:read", { type: "object", required: ["name", "query"], properties: { name: { type: "string" }, query: { type: "string" }, color: { type: "string" } } }),
      "/api/agent/v1/filters/{id}": item("Filter", "filters:read", { type: "object", properties: { name: { type: "string" }, query: { type: "string" }, color: { type: "string" } } }),
      "/api/agent/v1/tasks": { get: operation("listTasks", "List tasks by status or project", "tasks:read"), post: operation("createTask", "Create one task", "tasks:write", { $ref: "#/components/schemas/TaskInput" }, 201, idempotency) },
      "/api/agent/v1/tasks/{id}": item("Task", "tasks:read", { $ref: "#/components/schemas/TaskInput" }),
      "/api/agent/v1/tasks/{id}/complete": { post: operation("completeTask", "Complete one task", "tasks:write", null, 200, idempotency) },
      "/api/agent/v1/tasks/{id}/reopen": { post: operation("reopenTask", "Reopen one task", "tasks:write", null, 200, idempotency) },
      "/api/agent/v1/tasks/{id}/delete": { post: operation("deleteTask", "Delete one task with reversible confirmation", "tasks:write", { $ref: "#/components/schemas/DeleteConfirmation" }, 200, idempotency) },
      "/api/agent/v1/calendar": { get: operation("listCalendar", "List scheduled tasks in a date range", "calendar:read") },
      "/api/agent/v1/notes": resource("Notes", "notes:read", { $ref: "#/components/schemas/NoteInput" }),
      "/api/agent/v1/notes/{id}": item("Note", "notes:read", { $ref: "#/components/schemas/NoteInput" }),
      "/api/agent/v1/notes/{id}/complete": { post: operation("completeNote", "Complete one note", "notes:write", null, 200, idempotency) },
      "/api/agent/v1/notes/{id}/reopen": { post: operation("reopenNote", "Reopen one note", "notes:write", null, 200, idempotency) },
      "/api/agent/v1/notes/{id}/delete": { post: operation("deleteNote", "Delete one note with reversible confirmation", "notes:write", { $ref: "#/components/schemas/DeleteConfirmation" }, 200, idempotency) },
      "/api/agent/v1/diary": { get: operation("listDiaryEntries", "List diary entries", "diary:read") },
      "/api/agent/v1/diary/{date}": { get: operation("getDiaryEntry", "Read one diary entry", "diary:read"), put: operation("upsertDiaryEntry", "Create or update one diary entry", "diary:write", { type: "object" }, 200, idempotency) },
      "/api/agent/v1/diary/{date}/delete": { post: operation("deleteDiaryEntry", "Delete one diary entry with reversible confirmation", "diary:write", { $ref: "#/components/schemas/DeleteConfirmation" }, 200, idempotency) },
      "/api/agent/v1/order-items": resource("Order Items", "order:read", { type: "object", required: ["title"], properties: { title: { type: "string" }, details: { type: "string" }, lane: { type: "string", enum: ["now", "later", "after", "before"] } } }),
      "/api/agent/v1/order-items/{id}": item("Order Item", "order:read", { type: "object", properties: { title: { type: "string" }, details: { type: "string" }, lane: { type: "string" }, status: { type: "string" } } }),
      "/api/agent/v1/order-items/{id}/delete": { post: operation("deleteOrderItem", "Delete one Order item with reversible confirmation", "order:write", { $ref: "#/components/schemas/DeleteConfirmation" }, 200, idempotency) },
      "/api/agent/v1/preferences": { get: operation("getPreferences", "Read safe user preferences", "preferences:read"), patch: operation("updatePreferences", "Update safe user preferences", "preferences:write", { type: "object", properties: { theme: { type: "string", enum: ["system", "light", "dark"] }, showCompleted: { type: "boolean" }, activeProjectId: { type: ["string", "null"] } } }, 200, idempotency) },
      "/api/agent/v1/search": { get: operation("search", "Search durable Daymark content", "search:read") },
      "/api/agent/v1/undo/{undoId}": { post: operation("applyUndo", "Restore a confirmed deletion at the expected revision", "undo:write", null, 200, idempotency) },
    },
  }
}

function operation(operationId, summary, scope, schema, successStatus = 200, parameters = []) {
  const value = { operationId, summary, responses: { [successStatus]: { description: "Success" }, 401: { description: "Unauthorized" }, 403: { description: "Insufficient scope" }, 409: { description: "Revision or idempotency conflict" }, 422: { description: "Validation failed" } } }
  if (scope) value["x-daymark-required-scope"] = scope
  if (parameters.length) value.parameters = parameters
  if (schema) value.requestBody = { required: true, content: { "application/json": { schema } } }
  return value
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

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function noStoreAssetResponse(response) {
  const headers = new Headers(response.headers)
  headers.set("Cache-Control", "no-store")
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function withPairingCookie(response, syncKey, canonical = false) {
  const headers = new Headers(response.headers)
  headers.append(
    "Set-Cookie",
    `daymark.sync-key=${encodeURIComponent(syncKey)}; Path=/; Max-Age=315360000; Secure; SameSite=Strict`,
  )
  if (canonical) {
    headers.append(
      "Set-Cookie",
      "daymark.canonical-workspace=1; Path=/; Max-Age=315360000; Secure; SameSite=Strict",
    )
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

export default worker
