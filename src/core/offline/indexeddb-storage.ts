import type { AppState } from "../types";
import type { OfflineMutation, OfflineTombstone } from "./mutation-queue";

export const OFFLINE_DATABASE_NAME = "daymark-offline";
export const OFFLINE_DATABASE_VERSION = 1;

const SNAPSHOTS_STORE = "workspace-snapshots";
const MUTATIONS_STORE = "mutation-queue";
const TOMBSTONES_STORE = "tombstones";
const LEGACY_IMPORTS_STORE = "legacy-imports";

export class OfflineStorageUnavailableError extends Error {
  constructor() {
    super("IndexedDB is unavailable in this environment.");
    this.name = "OfflineStorageUnavailableError";
  }
}

export type WorkspaceSnapshot = {
  workspaceId: string;
  state: AppState;
  savedAt: string;
};

export type LegacyImportBackup = {
  workspaceId: string;
  legacyKey: string;
  rawLegacyValue: string;
  priorSnapshot: WorkspaceSnapshot | null;
  capturedAt: string;
};

type StoredMutation = OfflineMutation & { key: string };
type StoredTombstone = OfflineTombstone & { key: string };

export type IndexedDbWorkspaceStorageOptions = {
  indexedDB?: IDBFactory | null;
  databaseName?: string;
  now?: () => string;
};

export class IndexedDbWorkspaceStorage {
  private readonly factory: IDBFactory | null;
  private readonly databaseName: string;
  private readonly now: () => string;
  private database: Promise<IDBDatabase> | null = null;

  constructor(options: IndexedDbWorkspaceStorageOptions = {}) {
    this.factory =
      options.indexedDB === undefined
        ? typeof indexedDB === "undefined"
          ? null
          : indexedDB
        : options.indexedDB;
    this.databaseName = options.databaseName ?? OFFLINE_DATABASE_NAME;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  get isAvailable(): boolean {
    return this.factory !== null;
  }

  async saveSnapshot(workspaceId: string, state: AppState): Promise<WorkspaceSnapshot> {
    const snapshot = {
      workspaceId,
      state: clone(state),
      savedAt: this.now(),
    };
    await this.put(SNAPSHOTS_STORE, snapshot);
    return clone(snapshot);
  }

  async loadSnapshot(workspaceId: string): Promise<WorkspaceSnapshot | null> {
    const value = await this.get<unknown>(SNAPSHOTS_STORE, workspaceId);
    return isWorkspaceSnapshot(value) ? clone(value) : null;
  }

  async deleteSnapshot(workspaceId: string): Promise<void> {
    await this.delete(SNAPSHOTS_STORE, workspaceId);
  }

  async readMutationQueue(workspaceId: string): Promise<OfflineMutation[]> {
    const entries = await this.getAll<unknown>(MUTATIONS_STORE);
    return entries
      .filter(isStoredMutation)
      .filter((entry) => entry.workspaceId === workspaceId)
      .map(({ key: _key, ...mutation }) => clone(mutation))
      .sort(compareMutations);
  }

  async replaceMutationQueue(workspaceId: string, mutations: OfflineMutation[]): Promise<void> {
    const existing = await this.getAll<unknown>(MUTATIONS_STORE);
    const matchingKeys = existing
      .filter(isStoredMutation)
      .filter((entry) => entry.workspaceId === workspaceId)
      .map((entry) => entry.key);

    await Promise.all(matchingKeys.map((key) => this.delete(MUTATIONS_STORE, key)));
    await Promise.all(
      mutations.map((mutation) =>
        this.put(MUTATIONS_STORE, {
          ...clone(mutation),
          key: mutationKey(mutation.workspaceId, mutation.idempotencyKey),
        } satisfies StoredMutation),
      ),
    );
  }

  async listTombstones(workspaceId: string): Promise<OfflineTombstone[]> {
    const entries = await this.getAll<unknown>(TOMBSTONES_STORE);
    return entries
      .filter(isStoredTombstone)
      .filter((entry) => entry.workspaceId === workspaceId)
      .map(({ key: _key, ...tombstone }) => clone(tombstone))
      .sort((left, right) => left.deletedAt.localeCompare(right.deletedAt) || left.id.localeCompare(right.id));
  }

  async putTombstone(tombstone: OfflineTombstone): Promise<void> {
    await this.put(TOMBSTONES_STORE, {
      ...clone(tombstone),
      key: tombstoneKey(tombstone.workspaceId, tombstone.id),
    } satisfies StoredTombstone);
  }

  async deleteTombstone(workspaceId: string, id: string): Promise<void> {
    await this.delete(TOMBSTONES_STORE, tombstoneKey(workspaceId, id));
  }

  async saveLegacyImportBackup(backup: LegacyImportBackup): Promise<void> {
    await this.put(LEGACY_IMPORTS_STORE, clone(backup));
  }

  async loadLegacyImportBackup(workspaceId: string): Promise<LegacyImportBackup | null> {
    const value = await this.get<unknown>(LEGACY_IMPORTS_STORE, workspaceId);
    return isLegacyImportBackup(value) ? clone(value) : null;
  }

  async deleteLegacyImportBackup(workspaceId: string): Promise<void> {
    await this.delete(LEGACY_IMPORTS_STORE, workspaceId);
  }

  private async getDatabase(): Promise<IDBDatabase> {
    if (!this.factory) throw new OfflineStorageUnavailableError();
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = this.factory!.open(this.databaseName, OFFLINE_DATABASE_VERSION);
        request.onerror = () => reject(request.error ?? new Error("Could not open IndexedDB."));
        request.onupgradeneeded = () => {
          const database = request.result;
          for (const storeName of [SNAPSHOTS_STORE, MUTATIONS_STORE, TOMBSTONES_STORE, LEGACY_IMPORTS_STORE]) {
            if (!database.objectStoreNames.contains(storeName)) {
              database.createObjectStore(storeName, { keyPath: storeName === SNAPSHOTS_STORE || storeName === LEGACY_IMPORTS_STORE ? "workspaceId" : "key" });
            }
          }
        };
        request.onsuccess = () => resolve(request.result);
      });
    }
    return this.database;
  }

  private async get<T>(storeName: string, key: IDBValidKey): Promise<T | undefined> {
    return this.withStore(storeName, "readonly", (store) => store.get(key) as IDBRequest<T | undefined>);
  }

  private async getAll<T>(storeName: string): Promise<T[]> {
    return this.withStore(storeName, "readonly", (store) => store.getAll() as IDBRequest<T[]>);
  }

  private async put(storeName: string, value: unknown): Promise<void> {
    await this.withStore(storeName, "readwrite", (store) => store.put(value) as IDBRequest<IDBValidKey>);
  }

  private async delete(storeName: string, key: IDBValidKey): Promise<void> {
    await this.withStore(storeName, "readwrite", (store) => store.delete(key) as IDBRequest<undefined>);
  }

  private async withStore<T>(
    storeName: string,
    mode: IDBTransactionMode,
    requestFor: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.getDatabase();
    const transaction = database.transaction(storeName, mode);
    const request = requestFor(transaction.objectStore(storeName));
    const [result] = await Promise.all([requestResult(request), transactionDone(transaction)]);
    return result;
  }
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
  });
}

function mutationKey(workspaceId: string, idempotencyKey: string): string {
  return `${workspaceId}\u0000${idempotencyKey}`;
}

function tombstoneKey(workspaceId: string, id: string): string {
  return `${workspaceId}\u0000${id}`;
}

function compareMutations(left: OfflineMutation, right: OfflineMutation): number {
  return left.sequence - right.sequence || left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function isWorkspaceSnapshot(value: unknown): value is WorkspaceSnapshot {
  return isRecord(value) && typeof value.workspaceId === "string" && typeof value.savedAt === "string" && isRecord(value.state);
}

function isStoredMutation(value: unknown): value is StoredMutation {
  return (
    isRecord(value) &&
    typeof value.key === "string" &&
    typeof value.workspaceId === "string" &&
    typeof value.id === "string" &&
    typeof value.idempotencyKey === "string" &&
    typeof value.sequence === "number" &&
    typeof value.createdAt === "string"
  );
}

function isStoredTombstone(value: unknown): value is StoredTombstone {
  return isRecord(value) && typeof value.key === "string" && typeof value.workspaceId === "string" && typeof value.id === "string";
}

function isLegacyImportBackup(value: unknown): value is LegacyImportBackup {
  return (
    isRecord(value) &&
    typeof value.workspaceId === "string" &&
    typeof value.legacyKey === "string" &&
    typeof value.rawLegacyValue === "string" &&
    typeof value.capturedAt === "string" &&
    (value.priorSnapshot === null || isWorkspaceSnapshot(value.priorSnapshot))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
