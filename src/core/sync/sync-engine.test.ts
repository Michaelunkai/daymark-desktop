import assert from "node:assert/strict";
import test from "node:test";

import { mergeCompetingEdits } from "./merge";
import { createSyncEngine } from "./sync-engine";
import type { SyncMutation, SyncQueue, SyncRecord, SyncTransport } from "./types";

type TaskRecord = SyncRecord & {
  id: string;
  content: string;
  description: string;
  due: string | null;
  updatedAt: string;
};

const base: TaskRecord = {
  id: "task-1",
  content: "Plan launch",
  description: "Original description",
  due: "2026-08-03",
  updatedAt: "2026-08-02T08:00:00.000Z",
};

function mutation(id: string, sequence: number, local: TaskRecord = base): Omit<SyncMutation<TaskRecord>, "clientId" | "attempts" | "status" | "createdAt"> {
  return { id, entityType: "task", entityId: local.id, sequence, base, local };
}

function createQueue<T extends SyncRecord>(): SyncQueue<T> & { items: SyncMutation<T>[] } {
  const items: SyncMutation<T>[] = [];
  return {
    items,
    enqueue: async (item) => { items.push(structuredClone(item)); items.sort((left, right) => left.sequence - right.sequence); },
    peek: async () => items[0],
    remove: async (id) => { const index = items.findIndex((item) => item.id === id); if (index >= 0) items.splice(index, 1); },
    replace: async (replacement) => {
      const index = items.findIndex((item) => item.id === replacement.id || item.entityId === replacement.entityId && item.sequence === replacement.sequence);
      if (index < 0) throw new Error(`Missing queued mutation ${replacement.id}.`);
      items[index] = structuredClone(replacement);
    },
  };
}

test("flushes ordered mutations and retries the same id before later work", async () => {
  const queue = createQueue<TaskRecord>();
  const attempted: string[] = [];
  let firstAttempts = 0;
  const transport: SyncTransport<TaskRecord> = {
    push: async (item) => {
      attempted.push(item.id);
      if (item.id === "first" && firstAttempts++ === 0) throw new Error("Offline");
      return { status: "ack" };
    },
  };
  const engine = createSyncEngine({ clientId: "client-a", queue, transport, retryDelayMs: () => 0, sleep: async () => {} });

  await engine.enqueue(mutation("second", 2));
  await engine.enqueue(mutation("first", 1));
  const results = await engine.flush();

  assert.deepEqual(attempted, ["first", "first", "second"]);
  assert.deepEqual(results.map((result) => result.kind), ["retry-scheduled", "synced", "synced"]);
  assert.equal(queue.items.length, 0);
});

test("does not apply optimistic work or echoed realtime events twice", async () => {
  const queue = createQueue<TaskRecord>();
  const optimistic: string[] = [];
  const remote: string[] = [];
  const engine = createSyncEngine({
    clientId: "client-a",
    queue,
    transport: { push: async () => ({ status: "ack" }) },
    onOptimistic: (item) => optimistic.push(item.id),
    onRemoteEvent: (event) => remote.push(event.id),
  });

  await engine.enqueue(mutation("local-1", 1));
  await engine.enqueue(mutation("local-1", 1));
  const echo = { id: "event-1", entityType: "task", entity: base, originMutationId: "local-1" };
  engine.receiveRealtime(echo);
  engine.receiveRealtime(echo);
  const remoteResult = engine.receiveRealtime({ ...echo, id: "event-2", originMutationId: "other-client" });

  assert.deepEqual(optimistic, ["local-1"]);
  assert.deepEqual(remote, ["event-2"]);
  assert.equal(remoteResult.kind, "remote-applied");
});

test("merges non-overlapping edits, then flushes the rebase before later work", async () => {
  const local = { ...base, content: "Plan launch event", updatedAt: "2026-08-02T09:00:00.000Z" };
  const remote = { ...base, description: "Remote notes", updatedAt: "2026-08-02T09:01:00.000Z" };
  const merged = mergeCompetingEdits(base, local, remote);
  assert.equal(merged.ok, true);
  if (merged.ok) assert.deepEqual(merged.record, { ...remote, content: local.content });

  const queue = createQueue<TaskRecord>();
  const calls: string[] = [];
  const engine = createSyncEngine({
    clientId: "client-a",
    queue,
    transport: {
      push: async (item) => {
        calls.push(item.id);
        return item.id === "merge-me" ? { status: "conflict", remote } : { status: "ack" };
      },
    },
  });
  await engine.enqueue(mutation("merge-me", 1, local));
  await engine.enqueue(mutation("later", 2));
  const mergeResults = await engine.flush();
  assert.equal(mergeResults[0]?.kind, "merged");
  assert.equal(queue.items[0]?.local.content, "Plan launch event");
  assert.equal(queue.items[0]?.local.description, "Remote notes");
  const rebasedResults = await engine.flush();
  assert.deepEqual(calls, ["merge-me", "merge-me:merge", "later"]);
  assert.deepEqual(rebasedResults.map((result) => result.kind), ["synced", "synced"]);

  const competing = { ...base, content: "Remote launch title", updatedAt: "2026-08-02T09:02:00.000Z" };
  const conflictQueue = createQueue<TaskRecord>();
  const conflicts: string[][] = [];
  const conflictEngine = createSyncEngine({
    clientId: "client-a",
    queue: conflictQueue,
    transport: { push: async () => ({ status: "conflict", remote: competing, remoteRevision: 7 }) },
    onConflict: (conflict) => {
      conflicts.push(conflict.fields);
      assert.equal(conflict.remoteRevision, 7);
    },
  });
  await conflictEngine.enqueue(mutation("conflict-me", 1, local));
  const conflictResults = await conflictEngine.flush();

  assert.equal(conflictResults[0]?.kind, "conflict");
  assert.deepEqual(conflicts.at(-1), ["content"]);
  assert.equal(conflictQueue.items[0]?.status, "conflict");
});

test("coalesces concurrent flushes so the queue head is sent only once", async () => {
  const queue = createQueue<TaskRecord>();
  let pushCount = 0;
  let release!: () => void;
  const pushed = new Promise<void>((resolve) => { release = resolve; });
  const engine = createSyncEngine({
    clientId: "client-a",
    queue,
    transport: {
      push: async () => {
        pushCount += 1;
        await pushed;
        return { status: "ack" };
      },
    },
  });
  await engine.enqueue(mutation("one", 1));

  const first = engine.flush();
  const second = engine.flush();
  release();
  await Promise.all([first, second]);

  assert.equal(pushCount, 1);
});

test("records retry metadata while preserving the mutation id", async () => {
  const queue = createQueue<TaskRecord>();
  let failed = false;
  const engine = createSyncEngine({
    clientId: "client-a",
    queue,
    transport: {
      push: async () => {
        if (!failed) {
          failed = true;
          throw new Error("offline");
        }
        return { status: "ack" };
      },
    },
    now: () => "2026-08-03T10:00:00.000Z",
    retryDelayMs: () => 5_000,
    sleep: async () => {},
  });
  await engine.enqueue(mutation("retry-me", 1));
  const results = await engine.flush();
  assert.equal(results[0]?.kind, "retry-scheduled");
  const retry = results[0];
  if (retry.kind === "retry-scheduled") {
    assert.equal(retry.mutation.id, "retry-me");
    assert.equal(retry.mutation.attempts, 1);
    assert.equal(retry.mutation.lastAttemptAt, "2026-08-03T10:00:00.000Z");
    assert.equal(retry.mutation.nextAttemptAt, "2026-08-03T10:00:05.000Z");
    assert.equal(retry.mutation.lastError, "offline");
  }
});

test("deduplicates stale revisions even when event ids differ", () => {
  const queue = createQueue<TaskRecord>();
  const applied: number[] = [];
  const engine = createSyncEngine({
    clientId: "client-a",
    queue,
    transport: { push: async () => ({ status: "ack" }) },
    onRemoteEvent: (event) => applied.push(event.revision!),
  });
  engine.receiveRealtime({ id: "event-2", entityType: "task", entity: base, revision: 2 });
  const result = engine.receiveRealtime({ id: "event-1", entityType: "task", entity: base, revision: 1 });
  assert.equal(result.kind, "deduplicated");
  assert.deepEqual(applied, [2]);
});
