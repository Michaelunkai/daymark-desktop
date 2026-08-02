export type OfflineMutationStatus = "pending" | "retrying" | "in-flight";

export type OfflineMutation = {
  id: string;
  workspaceId: string;
  idempotencyKey: string;
  type: string;
  payload: unknown;
  sequence: number;
  createdAt: string;
  attempts: number;
  status: OfflineMutationStatus;
  lastAttemptAt: string | null;
  nextAttemptAt: string | null;
  lastError: string | null;
};

export type OfflineTombstone = {
  id: string;
  workspaceId: string;
  entityType: string;
  entityId: string;
  deletedAt: string;
  mutationId: string | null;
};

export interface MutationQueueStorage {
  readMutationQueue(workspaceId: string): Promise<OfflineMutation[]>;
  replaceMutationQueue(workspaceId: string, mutations: OfflineMutation[]): Promise<void>;
}

export type EnqueueMutationInput = {
  id?: string;
  idempotencyKey: string;
  type: string;
  payload: unknown;
  createdAt?: string;
};

export type MutationQueueOptions = {
  now?: () => string;
  createId?: () => string;
  retryBaseMs?: number;
  retryCapMs?: number;
};

export class MutationQueue {
  private readonly now: () => string;
  private readonly createId: () => string;
  private readonly retryBaseMs: number;
  private readonly retryCapMs: number;

  constructor(
    private readonly storage: MutationQueueStorage,
    private readonly workspaceId: string,
    options: MutationQueueOptions = {},
  ) {
    this.now = options.now ?? (() => new Date().toISOString());
    this.createId = options.createId ?? (() => `mutation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
    this.retryBaseMs = options.retryBaseMs ?? 1_000;
    this.retryCapMs = options.retryCapMs ?? 5 * 60_000;
  }

  async list(): Promise<OfflineMutation[]> {
    return sortQueue(await this.storage.readMutationQueue(this.workspaceId));
  }

  async enqueue(input: EnqueueMutationInput): Promise<{ mutation: OfflineMutation; enqueued: boolean }> {
    assertNonEmpty(input.idempotencyKey, "An idempotency key is required.");
    assertNonEmpty(input.type, "A mutation type is required.");

    const queue = await this.list();
    const existing = queue.find((mutation) => mutation.idempotencyKey === input.idempotencyKey);
    if (existing) return { mutation: existing, enqueued: false };

    const mutation: OfflineMutation = {
      id: input.id ?? this.createId(),
      workspaceId: this.workspaceId,
      idempotencyKey: input.idempotencyKey,
      type: input.type,
      payload: clone(input.payload),
      sequence: queue.reduce((highest, item) => Math.max(highest, item.sequence), 0) + 1,
      createdAt: input.createdAt ?? this.now(),
      attempts: 0,
      status: "pending",
      lastAttemptAt: null,
      nextAttemptAt: null,
      lastError: null,
    };

    await this.persist([...queue, mutation]);
    return { mutation: clone(mutation), enqueued: true };
  }

  async nextReady(now = this.now()): Promise<OfflineMutation | null> {
    return (
      (await this.list()).find(
        (mutation) =>
          mutation.status !== "in-flight" &&
          (mutation.nextAttemptAt === null || mutation.nextAttemptAt <= now),
      ) ?? null
    );
  }

  async markInFlight(id: string, attemptedAt = this.now()): Promise<OfflineMutation> {
    return this.update(id, (mutation) => ({
      ...mutation,
      status: "in-flight",
      attempts: mutation.attempts + 1,
      lastAttemptAt: attemptedAt,
      nextAttemptAt: null,
      lastError: null,
    }));
  }

  async markRetry(id: string, error: string, attemptedAt = this.now()): Promise<OfflineMutation> {
    assertNonEmpty(error, "A retry error is required.");
    return this.update(id, (mutation) => {
      const attempts = mutation.status === "in-flight" ? mutation.attempts : mutation.attempts + 1;
      const delay = Math.min(this.retryCapMs, this.retryBaseMs * 2 ** Math.max(0, attempts - 1));
      return {
        ...mutation,
        status: "retrying",
        attempts,
        lastAttemptAt: attemptedAt,
        nextAttemptAt: new Date(new Date(attemptedAt).getTime() + delay).toISOString(),
        lastError: error,
      };
    });
  }

  async acknowledge(id: string): Promise<boolean> {
    const queue = await this.list();
    const next = queue.filter((mutation) => mutation.id !== id);
    if (next.length === queue.length) return false;
    await this.persist(next);
    return true;
  }

  private async update(id: string, transform: (mutation: OfflineMutation) => OfflineMutation): Promise<OfflineMutation> {
    const queue = await this.list();
    const index = queue.findIndex((mutation) => mutation.id === id);
    if (index === -1) throw new Error(`Unknown offline mutation "${id}".`);
    const next = [...queue];
    next[index] = transform(next[index]);
    await this.persist(next);
    return clone(next[index]);
  }

  private async persist(mutations: OfflineMutation[]): Promise<void> {
    await this.storage.replaceMutationQueue(this.workspaceId, sortQueue(mutations).map(clone));
  }
}

export function createTombstone(
  workspaceId: string,
  entityType: string,
  entityId: string,
  deletedAt: string,
  mutationId: string | null = null,
): OfflineTombstone {
  assertNonEmpty(workspaceId, "A workspace id is required.");
  assertNonEmpty(entityType, "An entity type is required.");
  assertNonEmpty(entityId, "An entity id is required.");
  return {
    id: `${entityType}:${entityId}`,
    workspaceId,
    entityType,
    entityId,
    deletedAt,
    mutationId,
  };
}

function sortQueue(queue: OfflineMutation[]): OfflineMutation[] {
  return [...queue].sort(
    (left, right) => left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

function assertNonEmpty(value: string, message: string): void {
  if (!value.trim()) throw new Error(message);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
