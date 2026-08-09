import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test from "node:test"
import worker from "../worker/index.js"

const syncKey = "daymark-sync-key-12345"
const agentToken = "dmk_live_5F5dSkTgZBz8CYG4YMh-2m9tTy1pEpY0"

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function createState() {
  return {
    schemaVersion: 4,
    revision: 1,
    clientId: "client-test",
    updatedAt: "2026-08-09T00:00:00.000Z",
    projects: {
      "project-inbox": {
        id: "project-inbox",
        name: "Inbox",
        description: "",
        color: "charcoal",
        parentId: null,
        layout: "list",
        order: 0,
        isFavorite: true,
        isArchived: false,
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
      },
    },
    sections: {},
    labels: {},
    filters: {},
    tasks: {
      "task-existing": {
        id: "task-existing",
        content: "Existing Daymark task",
        description: "",
        projectId: "project-inbox",
        sectionId: null,
        parentId: null,
        labelIds: [],
        priority: 4,
        due: null,
        completedAt: null,
        completionContext: null,
        order: 0,
        createdAt: "2026-08-09T00:00:00.000Z",
        updatedAt: "2026-08-09T00:00:00.000Z",
      },
    },
    orderItems: {},
    notes: {},
    diaryEntries: {},
    preferences: {
      inboxProjectId: "project-inbox",
      activeProjectId: "project-inbox",
      onboardingDismissed: true,
      theme: "system",
      showCompleted: false,
    },
    undoStack: [],
    syncTombstones: {},
  }
}

class MemoryStatement {
  constructor(database, query) {
    this.database = database
    this.query = query
    this.values = []
  }

  bind(...values) {
    this.values = values
    return this
  }

  async first() {
    if (this.query.includes("FROM daymark_sync_states")) {
      return this.database.syncStates.get(this.values[0]) ?? null
    }
    if (this.query.includes("FROM daymark_agent_keys WHERE token_hash")) {
      return this.database.keys.find((key) => key.token_hash === this.values[0] && key.revoked_at === null) ?? null
    }
    if (this.query.includes("FROM daymark_agent_receipts")) {
      return this.database.receipts.get(`${this.values[0]}:${this.values[1]}`) ?? null
    }
    if (this.query.includes("FROM daymark_agent_undo")) {
      const undo = this.database.undos.get(this.values[0])
      return undo && undo.key_id === this.values[1] ? undo : null
    }
    return null
  }

  async all() {
    if (this.query.includes("FROM daymark_agent_keys WHERE sync_key")) {
      return {
        results: this.database.keys
          .filter((key) => key.sync_key === this.values[0])
          .map((key) => ({ ...key })),
      }
    }
    return { results: [] }
  }

  async run() {
    if (this.query.startsWith("INSERT INTO daymark_agent_keys")) {
      const [id, keySyncKey, tokenHash, name, scopes, createdAt] = this.values
      this.database.keys.push({
        id,
        sync_key: keySyncKey,
        token_hash: tokenHash,
        name,
        scopes,
        created_at: createdAt,
        last_used_at: null,
        revoked_at: null,
      })
      return { meta: { changes: 1 } }
    }
    if (this.query.startsWith("UPDATE daymark_agent_keys SET last_used_at")) {
      const [lastUsedAt, keyId] = this.values
      const key = this.database.keys.find((candidate) => candidate.id === keyId)
      if (key) key.last_used_at = lastUsedAt
      return { meta: { changes: key ? 1 : 0 } }
    }
    if (this.query.startsWith("UPDATE daymark_agent_keys SET revoked_at")) {
      const [revokedAt, keyId, keySyncKey] = this.values
      const key = this.database.keys.find((candidate) => candidate.id === keyId && candidate.sync_key === keySyncKey)
      if (key) key.revoked_at = revokedAt
      return { meta: { changes: key ? 1 : 0 } }
    }
    if (this.query.startsWith("UPDATE daymark_sync_states")) {
      const [revision, stateJson, updatedAt, keySyncKey, expectedRevision] = this.values
      const current = this.database.syncStates.get(keySyncKey)
      if (!current || current.revision !== expectedRevision) return { meta: { changes: 0 } }
      this.database.syncStates.set(keySyncKey, {
        revision,
        state_json: stateJson,
        updated_at: updatedAt,
      })
      return { meta: { changes: 1 } }
    }
    if (this.query.startsWith("INSERT INTO daymark_agent_receipts") || this.query.startsWith("INSERT OR IGNORE INTO daymark_agent_receipts")) {
      const [keyId, idempotencyKey, requestHash, responseJson, status, createdAt] = this.values
      this.database.receipts.set(`${keyId}:${idempotencyKey}`, {
        key_id: keyId,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        response_json: responseJson,
        status,
        created_at: createdAt,
      })
      return { meta: { changes: 1 } }
    }
    if (this.query.startsWith("INSERT INTO daymark_agent_audit") || this.query.startsWith("INSERT OR IGNORE INTO daymark_agent_audit")) {
      this.database.audit.push(this.values)
      return { meta: { changes: 1 } }
    }
    if (this.query.startsWith("INSERT OR IGNORE INTO daymark_agent_undo")) {
      const [id, keyId, keySyncKey, action, inverseJson, expectedRevision, createdAt, expiresAt] = this.values
      this.database.undos.set(id, {
        id,
        key_id: keyId,
        sync_key: keySyncKey,
        action,
        inverse_json: inverseJson,
        expected_revision: expectedRevision,
        created_at: createdAt,
        expires_at: expiresAt,
        consumed_at: null,
      })
      return { meta: { changes: 1 } }
    }
    if (this.query.startsWith("UPDATE daymark_agent_undo SET consumed_at")) {
      const [consumedAt, id] = this.values
      const undo = this.database.undos.get(id)
      if (!undo || undo.consumed_at) return { meta: { changes: 0 } }
      undo.consumed_at = consumedAt
      return { meta: { changes: 1 } }
    }
    return { meta: { changes: 0 } }
  }
}

class MemoryD1 {
  constructor() {
    this.syncStates = new Map([
      [syncKey, {
        revision: 1,
        state_json: JSON.stringify(createState()),
        updated_at: "2026-08-09T00:00:00.000Z",
      }],
    ])
    this.keys = []
    this.receipts = new Map()
    this.audit = []
    this.undos = new Map()
  }

  prepare(query) {
    return new MemoryStatement(this, query.replace(/\s+/g, " ").trim())
  }
}

function request(path, init = {}) {
  return new Request(`https://daymark.test${path}`, init)
}

test("provisions a scoped key and applies idempotent task actions without exposing workspace state", async () => {
  const db = new MemoryD1()
  const taskEnv = { DB: db, ASSETS: { fetch: () => new Response("missing", { status: 404 }) } }

  const unauthenticated = await worker.fetch(request("/api/agent/v1/tasks"), taskEnv)
  assert.equal(unauthenticated.status, 401)

  const provision = await worker.fetch(request("/api/agent/v1/keys", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${syncKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: "Codex task assistant",
      tokenHash: sha256(agentToken),
      scopes: ["projects:read", "tasks:read", "tasks:write"],
    }),
  }), taskEnv)
  assert.equal(provision.status, 201)
  const provisioned = await provision.json()
  assert.equal(provisioned.key.name, "Codex task assistant")
  assert.deepEqual(provisioned.key.scopes, ["projects:read", "tasks:read", "tasks:write"])

  const completeExisting = await worker.fetch(request("/api/agent/v1/tasks/task-existing/complete", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${agentToken}`,
      "Idempotency-Key": "complete-existing-task-001",
    },
  }), taskEnv)
  assert.equal(completeExisting.status, 200)
  assert.equal((await completeExisting.json()).task.id, "task-existing")

  const authHeaders = {
    Authorization: `Bearer ${agentToken}`,
    "Content-Type": "application/json",
    "Idempotency-Key": "create-release-checklist-001",
  }
  const create = await worker.fetch(request("/api/agent/v1/tasks", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ title: "Review AI integration release", priority: 2 }),
  }), taskEnv)
  assert.equal(create.status, 201)
  const created = await create.json()
  assert.equal(created.task.content, "Review AI integration release")
  assert.equal(created.task.projectId, "project-inbox")

  const replay = await worker.fetch(request("/api/agent/v1/tasks", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ title: "Review AI integration release", priority: 2 }),
  }), taskEnv)
  assert.equal(replay.status, 201)
  assert.deepEqual(await replay.json(), created)
  assert.equal(Object.keys(JSON.parse(db.syncStates.get(syncKey).state_json).tasks).length, 2)

  const complete = await worker.fetch(request(`/api/agent/v1/tasks/${created.task.id}/complete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${agentToken}`,
      "Idempotency-Key": "complete-release-checklist-001",
    },
  }), taskEnv)
  assert.equal(complete.status, 200)
  const completed = await complete.json()
  assert.ok(completed.task.completedAt)
  assert.equal(db.audit.length, 3)
})

test("covers the durable Daymark workspace without exposing raw sync or local-only reminder state", async () => {
  const db = new MemoryD1()
  const env = { DB: db, ASSETS: { fetch: () => new Response("missing", { status: 404 }) } }
  const scopes = [
    "projects:read", "projects:write", "sections:read", "sections:write",
    "labels:read", "labels:write", "filters:read", "filters:write",
    "tasks:read", "tasks:write", "calendar:read", "notes:read", "notes:write",
    "diary:read", "diary:write", "order:read", "order:write",
    "preferences:read", "preferences:write", "search:read", "undo:write",
  ]
  const provision = await worker.fetch(request("/api/agent/v1/keys", {
    method: "POST",
    headers: { Authorization: `Bearer ${syncKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Full Daymark assistant", tokenHash: sha256(agentToken), scopes }),
  }), env)
  assert.equal(provision.status, 201)

  const auth = {
    Authorization: `Bearer ${agentToken}`,
    "Content-Type": "application/json",
  }
  const write = (key) => ({ ...auth, "Idempotency-Key": key })

  const project = await worker.fetch(request("/api/agent/v1/projects", {
    method: "POST",
    headers: write("project-create-20260809"),
    body: JSON.stringify({ name: "AI planning" }),
  }), env)
  assert.equal(project.status, 201)
  const projectBody = await project.json()

  const label = await worker.fetch(request("/api/agent/v1/labels", {
    method: "POST",
    headers: write("label-create-20260809"),
    body: JSON.stringify({ name: "Automation", color: "blue" }),
  }), env)
  assert.equal(label.status, 201)
  const labelBody = await label.json()

  const section = await worker.fetch(request("/api/agent/v1/sections", {
    method: "POST",
    headers: write("section-create-20260809"),
    body: JSON.stringify({ projectId: projectBody.project.id, name: "Release" }),
  }), env)
  assert.equal(section.status, 201)
  const sectionBody = await section.json()

  const task = await worker.fetch(request("/api/agent/v1/tasks", {
    method: "POST",
    headers: write("task-create-full-surface-20260809"),
    body: JSON.stringify({
      title: "Publish Daymark",
      projectId: projectBody.project.id,
      sectionId: sectionBody.section.id,
      labelIds: [labelBody.label.id],
      priority: 1,
      due: { date: "2026-08-10", time: "09:00" },
    }),
  }), env)
  assert.equal(task.status, 201)
  const taskBody = await task.json()

  const taskPatch = await worker.fetch(request(`/api/agent/v1/tasks/${taskBody.task.id}`, {
    method: "PATCH",
    headers: write("task-patch-full-surface-20260809"),
    body: JSON.stringify({ description: "Use the deployed API.", due: { date: "2026-08-11" } }),
  }), env)
  assert.equal(taskPatch.status, 200)

  const calendar = await worker.fetch(request("/api/agent/v1/calendar?from=2026-08-10&to=2026-08-12", {
    headers: auth,
  }), env)
  assert.equal(calendar.status, 200)
  assert.equal((await calendar.json()).tasks.length, 1)

  const note = await worker.fetch(request("/api/agent/v1/notes", {
    method: "POST",
    headers: write("note-create-full-surface-20260809"),
    body: JSON.stringify({ title: "Release note", body: "Published with least privilege." }),
  }), env)
  assert.equal(note.status, 201)
  const noteBody = await note.json()
  const noteComplete = await worker.fetch(request(`/api/agent/v1/notes/${noteBody.note.id}/complete`, {
    method: "POST",
    headers: write("note-complete-full-surface-20260809"),
  }), env)
  assert.equal(noteComplete.status, 200)

  const diary = await worker.fetch(request("/api/agent/v1/diary/2026-08-09", {
    method: "PUT",
    headers: write("diary-upsert-full-surface-20260809"),
    body: JSON.stringify({ highlights: "API released" }),
  }), env)
  assert.equal(diary.status, 200)

  const order = await worker.fetch(request("/api/agent/v1/order-items", {
    method: "POST",
    headers: write("order-create-full-surface-20260809"),
    body: JSON.stringify({ title: "Monitor deployment", lane: "now", priority: 2 }),
  }), env)
  assert.equal(order.status, 201)

  const filter = await worker.fetch(request("/api/agent/v1/filters", {
    method: "POST",
    headers: write("filter-create-full-surface-20260809"),
    body: JSON.stringify({ name: "Urgent", query: "p1" }),
  }), env)
  assert.equal(filter.status, 201)

  const preferences = await worker.fetch(request("/api/agent/v1/preferences", {
    method: "PATCH",
    headers: write("preferences-patch-full-surface-20260809"),
    body: JSON.stringify({ showCompleted: true }),
  }), env)
  assert.equal(preferences.status, 200)

  const search = await worker.fetch(request("/api/agent/v1/search?q=publish", { headers: auth }), env)
  assert.equal(search.status, 200)
  assert.ok((await search.json()).results.some((result) => result.id === taskBody.task.id))

  const rejectedDelete = await worker.fetch(request(`/api/agent/v1/tasks/${taskBody.task.id}/delete`, {
    method: "POST",
    headers: write("task-delete-missing-confirmation-20260809"),
    body: JSON.stringify({}),
  }), env)
  assert.equal(rejectedDelete.status, 422)

  const deleted = await worker.fetch(request(`/api/agent/v1/tasks/${taskBody.task.id}/delete`, {
    method: "POST",
    headers: write("task-delete-confirmed-20260809"),
    body: JSON.stringify({ confirm: "delete" }),
  }), env)
  assert.equal(deleted.status, 200)
  const deletedBody = await deleted.json()
  assert.ok(deletedBody.undo?.id)

  const restored = await worker.fetch(request(`/api/agent/v1/undo/${deletedBody.undo.id}`, {
    method: "POST",
    headers: write("task-undo-full-surface-20260809"),
  }), env)
  assert.equal(restored.status, 200)

  const rawSync = await worker.fetch(request("/api/agent/v1/sync", { headers: auth }), env)
  assert.equal(rawSync.status, 404)
  const reminders = await worker.fetch(request("/api/agent/v1/reminders", { headers: auth }), env)
  assert.equal(reminders.status, 404)
})

test("publishes restart-safe discovery, diagnostics, and a full versioned OpenAPI surface", async () => {
  const db = new MemoryD1()
  const env = { DB: db, ASSETS: { fetch: () => new Response("missing", { status: 404 }) } }

  const discovery = await worker.fetch(request("/.well-known/daymark-ai.json"), env)
  assert.equal(discovery.status, 200)
  const discoveryBody = await discovery.json()
  assert.equal(discoveryBody.apiVersion, "2.0.0")
  assert.equal(discoveryBody.openapi, "https://daymark.test/api/agent/v1/openapi.json")
  assert.equal(discoveryBody.clientConfiguration, "https://daymark.test/daymark-ai-client.json")

  const health = await worker.fetch(request("/api/agent/v1/health"), env)
  assert.equal(health.status, 200)
  const readiness = await worker.fetch(request("/api/agent/v1/ready"), env)
  assert.equal(readiness.status, 200)

  const openapi = await worker.fetch(request("/api/agent/v1/openapi.json"), env)
  const document = await openapi.json()
  assert.equal(document.info.version, "2.0.0")
  for (const path of [
    "/api/agent/v1/projects",
    "/api/agent/v1/sections",
    "/api/agent/v1/labels",
    "/api/agent/v1/filters",
    "/api/agent/v1/tasks",
    "/api/agent/v1/calendar",
    "/api/agent/v1/notes",
    "/api/agent/v1/diary/{date}",
    "/api/agent/v1/order-items",
    "/api/agent/v1/preferences",
    "/api/agent/v1/search",
    "/api/agent/v1/undo/{undoId}",
  ]) {
    assert.ok(document.paths[path], `missing OpenAPI path ${path}`)
  }
  assert.ok(document.components.schemas.Task)
  assert.ok(document.components.schemas.Error)
})
