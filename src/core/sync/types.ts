export type SyncRecord = Record<string, unknown> & { id: string };

export interface SyncMutation<T extends SyncRecord = SyncRecord> {
  id: string;
  clientId: string;
  entityType: string;
  entityId: string;
  sequence: number;
  base: T | null;
  local: T | null;
  createdAt: string;
  attempts: number;
  status?: "pending" | "conflict";
}

export interface SyncRealtimeEvent<T extends SyncRecord = SyncRecord> {
  id: string;
  entityType: string;
  entity: T | null;
  originMutationId?: string;
}

export type SyncPushResult<T extends SyncRecord = SyncRecord> =
  | { status: "ack"; event?: SyncRealtimeEvent<T> }
  | { status: "conflict"; remote: T | null; eventId?: string };

export interface SyncTransport<T extends SyncRecord = SyncRecord> {
  push(mutation: SyncMutation<T>): Promise<SyncPushResult<T>>;
}

export interface SyncQueue<T extends SyncRecord = SyncRecord> {
  enqueue(mutation: SyncMutation<T>): Promise<void>;
  peek(): Promise<SyncMutation<T> | undefined>;
  remove(mutationId: string): Promise<void>;
  replace(mutation: SyncMutation<T>): Promise<void>;
}

export type SyncConflict<T extends SyncRecord = SyncRecord> = {
  kind: "competing-edit";
  mutation: SyncMutation<T>;
  remote: T | null;
  fields: string[];
};

export type SyncFlushResult<T extends SyncRecord = SyncRecord> =
  | { kind: "synced"; mutation: SyncMutation<T> }
  | { kind: "merged"; mutation: SyncMutation<T>; replacement: SyncMutation<T> }
  | { kind: "conflict"; conflict: SyncConflict<T> }
  | { kind: "retry-scheduled"; mutation: SyncMutation<T>; delayMs: number; error: unknown }
  | { kind: "remote-applied"; event: SyncRealtimeEvent<T> }
  | { kind: "deduplicated"; event: SyncRealtimeEvent<T> };

export interface SyncEngineOptions<T extends SyncRecord = SyncRecord> {
  clientId: string;
  queue: SyncQueue<T>;
  transport: SyncTransport<T>;
  onOptimistic?: (mutation: SyncMutation<T>) => void;
  onRemoteEvent?: (event: SyncRealtimeEvent<T>) => void;
  onConflict?: (conflict: SyncConflict<T>) => void;
  now?: () => string;
  sleep?: (delayMs: number) => Promise<void>;
  retryDelayMs?: (attempt: number) => number;
}
