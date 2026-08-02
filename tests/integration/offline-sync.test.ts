import assert from "node:assert/strict"
import { test } from "vitest"

import { MutationQueue, type MutationQueueStorage } from "../../src/core/offline"
import { createSyncEngine, type SyncMutation, type SyncQueue, type SyncRecord } from "../../src/core/sync"

class MemoryMutationStorage implements MutationQueueStorage {
  private mutations: unknown[] = []

  async readMutationQueue(): Promise<never[]> {
    return structuredClone(this.mutations) as never[]
  }

  async replaceMutationQueue(_workspaceId: string, mutations: never[]): Promise<void> {
    this.mutations = structuredClone(mutations)
  }
}

function createMemorySyncQueue<T extends SyncRecord>(): SyncQueue<T> & { items: SyncMutation<T>[] } {
  const items: SyncMutation<T>[] = []
  return {
    items,
    enqueue: async (mutation) => {
      items.push(structuredClone(mutation))
      items.sort((left, right) => left.sequence - right.sequence)
    },
    peek: async () => items[0],
    remove: async (id) => {
      const index = items.findIndex((item) => item.id === id)
      if (index >= 0) items.splice(index, 1)
    },
    replace: async (mutation) => {
      const index = items.findIndex((item) => item.id === mutation.id)
      if (index < 0) throw new Error(`Missing mutation ${mutation.id}`)
      items[index] = structuredClone(mutation)
    },
  }
}

test("preserves offline mutation sequence and only releases later work when it is ready", async () => {
  const queue = new MutationQueue(new MemoryMutationStorage(), "workspace-a", {
    now: () => "2026-08-02T14:00:00.000Z",
    createId: (() => {
      let count = 0
      return () => `mutation-${++count}`
    })(),
    retryBaseMs: 1_000,
  })

  const first = await queue.enqueue({ idempotencyKey: "task-1", type: "task.update", payload: { id: "task-1" } })
  const second = await queue.enqueue({ idempotencyKey: "task-2", type: "task.update", payload: { id: "task-2" } })
  await queue.markInFlight(first.mutation.id)
  await queue.markRetry(first.mutation.id, "offline")

  assert.equal((await queue.nextReady("2026-08-02T14:00:00.000Z"))?.id, second.mutation.id)
  assert.deepEqual(
    (await queue.list()).map((mutation) => [mutation.sequence, mutation.idempotencyKey, mutation.status]),
    [
      [1, "task-1", "retrying"],
      [2, "task-2", "pending"],
    ],
  )
})

test("retries the queue head before later sync work and deduplicates realtime echoes", async () => {
  type TaskRecord = SyncRecord & { id: string; content: string; updatedAt: string }
  const base: TaskRecord = { id: "task-1", content: "Before", updatedAt: "2026-08-02T12:00:00.000Z" }
  const queue = createMemorySyncQueue<TaskRecord>()
  const attempts: string[] = []
  const remote: string[] = []
  let firstAttempt = true
  const engine = createSyncEngine({
    clientId: "client-a",
    queue,
    transport: {
      push: async (mutation) => {
        attempts.push(mutation.id)
        if (mutation.id === "first" && firstAttempt) {
          firstAttempt = false
          throw new Error("offline")
        }
        return { status: "ack", event: { id: `event-${mutation.id}`, entityType: "task", entity: base, originMutationId: mutation.id } }
      },
    },
    retryDelayMs: () => 0,
    sleep: async () => {},
    onRemoteEvent: (event) => remote.push(event.id),
  })

  await engine.enqueue({ id: "second", entityType: "task", entityId: "task-2", sequence: 2, base, local: { ...base, id: "task-2" } })
  await engine.enqueue({ id: "first", entityType: "task", entityId: "task-1", sequence: 1, base, local: { ...base, content: "First" } })
  const result = await engine.flush()

  assert.deepEqual(attempts, ["first", "first", "second"])
  assert.deepEqual(result.map((item) => item.kind), ["retry-scheduled", "synced", "deduplicated", "synced", "deduplicated"])
  assert.deepEqual(remote, [])
})
