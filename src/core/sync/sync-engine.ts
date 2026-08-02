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
            const conflict: SyncConflict<T> = { kind: "competing-edit", mutation: next, remote: response.remote, fields: merge.fields };
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
          const retry = { ...next, attempts: next.attempts + 1, status: "pending" as const };
          const delayMs = retryDelayMs(retry.attempts);
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
    options.onRemoteEvent?.(event);
    return { kind: "remote-applied", event };
  }
}
