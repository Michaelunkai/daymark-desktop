import assert from "node:assert/strict";
import test from "node:test";

import { createSampleState } from "../sample-data";
import { STORAGE_KEY } from "../storage";
import {
  IndexedDbWorkspaceStorage,
  OfflineStorageUnavailableError,
  createTombstone,
  importLocalStorageState,
  MutationQueue,
  previewLocalStorageMigration,
  rollbackLocalStorageImport,
} from "./index";

const NOW = "2026-08-02T14:00:00.000Z";

test("IndexedDB workspace snapshots and tombstones survive a reload", async () => {
  const factory = new MemoryIndexedDbFactory();
  const first = new IndexedDbWorkspaceStorage({ indexedDB: factory as unknown as IDBFactory, now: () => NOW });
  const state = createSampleState(NOW, "offline-client");

  await first.saveSnapshot("workspace-a", state);
  await first.putTombstone(createTombstone("workspace-a", "task", "task-old", NOW, "mutation-delete"));

  const reloaded = new IndexedDbWorkspaceStorage({ indexedDB: factory as unknown as IDBFactory, now: () => NOW });
  assert.deepEqual(await reloaded.loadSnapshot("workspace-a"), {
    workspaceId: "workspace-a",
    state,
    savedAt: NOW,
  });
  assert.deepEqual(await reloaded.listTombstones("workspace-a"), [
    createTombstone("workspace-a", "task", "task-old", NOW, "mutation-delete"),
  ]);
});

test("ordered mutations retain idempotency keys and retry metadata across reloads", async () => {
  const factory = new MemoryIndexedDbFactory();
  const storage = new IndexedDbWorkspaceStorage({ indexedDB: factory as unknown as IDBFactory });
  const queue = new MutationQueue(storage, "workspace-a", {
    now: () => NOW,
    createId: (() => {
      let count = 0;
      return () => `mutation-${++count}`;
    })(),
    retryBaseMs: 1_000,
  });

  const first = await queue.enqueue({ idempotencyKey: "task-1:add", type: "task.add", payload: { id: "task-1" } });
  const second = await queue.enqueue({ idempotencyKey: "task-2:add", type: "task.add", payload: { id: "task-2" } });
  const duplicate = await queue.enqueue({ idempotencyKey: "task-1:add", type: "task.add", payload: { ignored: true } });
  assert.equal(first.enqueued, true);
  assert.equal(second.mutation.sequence, 2);
  assert.equal(duplicate.enqueued, false);
  assert.equal(duplicate.mutation.id, first.mutation.id);

  await queue.markInFlight(first.mutation.id, NOW);
  const retried = await queue.markRetry(first.mutation.id, "offline", NOW);
  assert.equal(retried.attempts, 1);
  assert.equal(retried.status, "retrying");
  assert.equal(retried.nextAttemptAt, "2026-08-02T14:00:01.000Z");
  assert.equal((await queue.nextReady(NOW))?.id, second.mutation.id);

  const reloaded = new MutationQueue(
    new IndexedDbWorkspaceStorage({ indexedDB: factory as unknown as IDBFactory }),
    "workspace-a",
  );
  assert.deepEqual(
    (await reloaded.list()).map((mutation) => [mutation.sequence, mutation.idempotencyKey, mutation.attempts]),
    [
      [1, "task-1:add", 1],
      [2, "task-2:add", 0],
    ],
  );
  assert.equal(await reloaded.acknowledge(second.mutation.id), true);
  assert.equal((await reloaded.list()).length, 1);
});

test("unavailable IndexedDB fails explicitly instead of silently falling back", async () => {
  const storage = new IndexedDbWorkspaceStorage({ indexedDB: null });
  await assert.rejects(() => storage.loadSnapshot("workspace-a"), OfflineStorageUnavailableError);
});

test("localStorage migration previews, imports, and rolls back deterministically", async () => {
  const factory = new MemoryIndexedDbFactory();
  const offline = new IndexedDbWorkspaceStorage({ indexedDB: factory as unknown as IDBFactory, now: () => NOW });
  const legacy = new MemoryLegacyStorage({ [STORAGE_KEY]: JSON.stringify(createSampleState(NOW, "legacy-client")) });

  assert.deepEqual(previewLocalStorageMigration(legacy), {
    status: "ready",
    sourceKey: STORAGE_KEY,
    revision: 0,
    updatedAt: NOW,
    taskCount: 1,
    projectCount: 2,
  });

  const imported = await importLocalStorageState(offline, "workspace-a", legacy);
  assert.equal(imported.imported, true);
  assert.equal((await offline.loadSnapshot("workspace-a"))?.state.clientId, "legacy-client");

  legacy.setItem(STORAGE_KEY, JSON.stringify(createSampleState("2026-08-03T00:00:00.000Z", "changed-client")));
  const rollback = await rollbackLocalStorageImport(offline, "workspace-a", legacy);
  assert.equal(rollback.rolledBack, true);
  assert.equal(await offline.loadSnapshot("workspace-a"), null);
  assert.equal(JSON.parse(legacy.getItem(STORAGE_KEY)!).clientId, "legacy-client");
  assert.equal(await offline.loadLegacyImportBackup("workspace-a"), null);
});

test("corrupted legacy data is previewed safely and cannot be imported", async () => {
  const factory = new MemoryIndexedDbFactory();
  const offline = new IndexedDbWorkspaceStorage({ indexedDB: factory as unknown as IDBFactory });
  const legacy = new MemoryLegacyStorage({ [STORAGE_KEY]: "{not-json" });

  assert.equal(previewLocalStorageMigration(legacy).status, "corrupted");
  await assert.rejects(() => importLocalStorageState(offline, "workspace-a", legacy), /Legacy localStorage data is invalid/);
  assert.equal(await offline.loadSnapshot("workspace-a"), null);
});

class MemoryLegacyStorage {
  private readonly values = new Map<string, string>();

  constructor(values: Record<string, string>) {
    Object.entries(values).forEach(([key, value]) => this.values.set(key, value));
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class MemoryIndexedDbFactory {
  private readonly databases = new Map<string, MemoryIndexedDbDatabase>();

  open(name: string, _version?: number): MemoryRequest<MemoryIndexedDbDatabase> {
    const request = new MemoryRequest<MemoryIndexedDbDatabase>();
    queueMicrotask(() => {
      let database = this.databases.get(name);
      const created = !database;
      if (!database) {
        database = new MemoryIndexedDbDatabase();
        this.databases.set(name, database);
      }
      request.result = database;
      if (created) request.onupgradeneeded?.({ target: request } as Event);
      request.onsuccess?.({ target: request } as Event);
    });
    return request;
  }
}

class MemoryIndexedDbDatabase {
  readonly objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  };
  private readonly stores = new Map<string, Map<string, unknown>>();

  createObjectStore(name: string): void {
    this.stores.set(name, new Map());
  }

  transaction(name: string, _mode: IDBTransactionMode): MemoryTransaction {
    const store = this.stores.get(name);
    if (!store) throw new Error(`Missing object store ${name}`);
    return new MemoryTransaction(store);
  }
}

class MemoryTransaction {
  oncomplete: ((event: Event) => void) | null = null;
  onabort: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  error: DOMException | null = null;

  constructor(private readonly values: Map<string, unknown>) {}

  objectStore(_name: string): MemoryObjectStore {
    return new MemoryObjectStore(this.values, () => {
      setTimeout(() => this.oncomplete?.({ target: this } as Event), 0);
    });
  }
}

class MemoryObjectStore {
  constructor(
    private readonly values: Map<string, unknown>,
    private readonly complete: () => void,
  ) {}

  get(key: IDBValidKey): MemoryRequest<unknown> {
    return this.respond(this.values.get(String(key)));
  }

  getAll(): MemoryRequest<unknown[]> {
    return this.respond([...this.values.values()].map((value) => structuredClone(value)));
  }

  put(value: unknown): MemoryRequest<string> {
    const key = (value as { key?: string; workspaceId?: string }).key ?? (value as { workspaceId?: string }).workspaceId;
    if (!key) throw new Error("A key is required.");
    this.values.set(key, structuredClone(value));
    return this.respond(key);
  }

  delete(key: IDBValidKey): MemoryRequest<undefined> {
    this.values.delete(String(key));
    return this.respond(undefined);
  }

  private respond<T>(value: T): MemoryRequest<T> {
    const request = new MemoryRequest<T>();
    queueMicrotask(() => {
      request.result = value;
      request.onsuccess?.({ target: request } as Event);
      this.complete();
    });
    return request;
  }
}

class MemoryRequest<T> {
  result!: T;
  error: DOMException | null = null;
  onsuccess: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onupgradeneeded: ((event: Event) => void) | null = null;
}
