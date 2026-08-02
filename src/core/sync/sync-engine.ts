import { mergeCompetingEdits } from "./merge";
import type {
  SyncConflict,
  SyncEngineOptions,
  SyncFlushResult,
  SyncMutation,
  SyncRealtimeEvent,
  SyncRecord,
} from "./types";

const defaultRetryDelay = (attempt: number) => Math.min(1_000 * 2 ** Math.max(0, attempt - 1), 30_000);
const defaultSleep = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export interface SyncEngine<T extends SyncRecord> {
  enqueue(mutation: Omit<SyncMutation<T>, "clientId" | "attempts" | "status" | "createdAt">): Promise<void>;
  flush(): Promise<SyncFlushResult<T>[]>;
  receiveRealtime(event: SyncRealtimeEvent<T>): SyncFlushResult<T>;
}

export function createSyncEngine<T extends SyncRecord>(options: SyncEngineOptions<T>): SyncEngine<T> {
  const locallyApplied = new Set<string>();
  const seenEventIds = new Set<string>();
  const latestRevisions = new Map<string, number>();
  const retryDelayMs = options.retryDelayMs ?? defaultRetryDelay;
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? (() => new Date().toISOString());
  let activeFlush: Promise<SyncFlushResult<T>[]> | null = null;

  return {
    async enqueue(mutation) {
      const pending: SyncMutation<T> = {
        ...mutation,
        clientId: options.clientId,
        createdAt: now(),
        attempts: 0,
        status: "pending",
        baseRevision: mutation.baseRevision ?? null,
        lastAttemptAt: null,
        nextAttemptAt: null,
        lastError: null,
      };
      if (locallyApplied.has(pending.id)) return;
      locallyApplied.add(pending.id);
      options.onOptimistic?.(pending);
      await options.queue.enqueue(pending);
    },

    flush() {
      if (activeFlush) return activeFlush;
      activeFlush = flushQueue().finally(() => { activeFlush = null; });
      return activeFlush;
    },

    receiveRealtime,
  };

  async function flushQueue() {
      const results: SyncFlushResult<T>[] = [];

      for (let next = await options.queue.peek(); next; next = await options.queue.peek()) {
        if (next.status === "conflict") break;

        try {
          const response = await options.transport.push(next);
          if (response.status === "ack") {
            await options.queue.remove(next.id);
            results.push({ kind: "synced", mutation: next });
            if (response.event) results.push(receiveRealtime(response.event));
            continue;
          }

          const merge = mergeCompetingEdits(next.base, next.local, response.remote);
          if (!merge.ok) {
            const conflict: SyncConflict<T> = {
              kind: "competing-edit",
              mutation: next,
              remote: response.remote,
              remoteRevision: response.remoteRevision,
              fields: merge.fields,
            };
            await options.queue.replace({ ...next, status: "conflict" });
            options.onConflict?.(conflict);
            results.push({ kind: "conflict", conflict });
            break;
          }

          const replacement: SyncMutation<T> = {
            ...next,
            id: `${next.id}:merge`,
            base: response.remote,
            local: merge.record,
            attempts: 0,
            status: "pending",
          };
          await options.queue.replace(replacement);
          results.push({ kind: "merged", mutation: next, replacement });
          break;
        } catch (error) {
          const attemptedAt = now();
          const attempts = next.attempts + 1;
          const retry = {
            ...next,
            attempts,
            status: "pending" as const,
            lastAttemptAt: attemptedAt,
            nextAttemptAt: new Date(new Date(attemptedAt).getTime() + retryDelayMs(attempts)).toISOString(),
            lastError: error instanceof Error ? error.message : String(error),
          };
          const delayMs = retryDelayMs(attempts);
          await options.queue.replace(retry);
          results.push({ kind: "retry-scheduled", mutation: retry, delayMs, error });
          await sleep(delayMs);
        }
      }
      return results;
  }

  function receiveRealtime(event: SyncRealtimeEvent<T>): SyncFlushResult<T> {
    if (seenEventIds.has(event.id)) return { kind: "deduplicated", event };
    seenEventIds.add(event.id);
    if (event.originMutationId && locallyApplied.has(event.originMutationId)) return { kind: "deduplicated", event };
    const entityKey = `${event.entityType}:${event.entity?.id ?? "deleted"}`;
    const previousRevision = latestRevisions.get(entityKey);
    if (event.revision !== undefined && previousRevision !== undefined && event.revision <= previousRevision) {
      return { kind: "deduplicated", event };
    }
    if (event.revision !== undefined) latestRevisions.set(entityKey, event.revision);
    options.onRemoteEvent?.(event);
    return { kind: "remote-applied", event };
  }
}
