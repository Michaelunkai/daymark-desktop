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
    if (this.query.startsWith("INSERT INTO daymark_agent_receipts")) {
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
    if (this.query.startsWith("INSERT INTO daymark_agent_audit")) {
      this.database.audit.push(this.values)
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
  const env = { DB: db, ASSETS: { fetch: () => new Response("missing", { status: 404 }) } }

  const unauthenticated = await worker.fetch(request("/api/agent/v1/tasks"), env)
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
  }), env)
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
  }), env)
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
  }), env)
  assert.equal(create.status, 201)
  const created = await create.json()
  assert.equal(created.task.content, "Review AI integration release")
  assert.equal(created.task.projectId, "project-inbox")

  const replay = await worker.fetch(request("/api/agent/v1/tasks", {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({ title: "Review AI integration release", priority: 2 }),
  }), env)
  assert.equal(replay.status, 201)
  assert.deepEqual(await replay.json(), created)
  assert.equal(Object.keys(JSON.parse(db.syncStates.get(syncKey).state_json).tasks).length, 2)

  const complete = await worker.fetch(request(`/api/agent/v1/tasks/${created.task.id}/complete`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${agentToken}`,
      "Idempotency-Key": "complete-release-checklist-001",
    },
  }), env)
  assert.equal(complete.status, 200)
  const completed = await complete.json()
  assert.ok(completed.task.completedAt)
  assert.equal(db.audit.length, 3)
})
