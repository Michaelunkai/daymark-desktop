import { STORAGE_KEY, migrate } from "../storage";
import type { AppState } from "../types";
import type { IndexedDbWorkspaceStorage, WorkspaceSnapshot } from "./indexeddb-storage";

export type LegacyStorage = Pick<Storage, "getItem" | "setItem">;

export type LocalStorageMigrationPreview =
  | {
      status: "empty";
      sourceKey: string;
    }
  | {
      status: "ready";
      sourceKey: string;
      revision: number;
      updatedAt: string;
      taskCount: number;
      projectCount: number;
    }
  | {
      status: "corrupted";
      sourceKey: string;
      message: string;
    };

export type LocalStorageImportResult = {
  imported: boolean;
  snapshot: WorkspaceSnapshot | null;
};

export type LocalStorageRollbackResult = {
  rolledBack: boolean;
  snapshot: WorkspaceSnapshot | null;
};

export function previewLocalStorageMigration(
  legacyStorage: Pick<Storage, "getItem"> | null | undefined,
  key = STORAGE_KEY,
): LocalStorageMigrationPreview {
  const raw = readLegacyValue(legacyStorage, key);
  if (raw === null) return { status: "empty", sourceKey: key };

  try {
    const state = parseLegacyState(raw);
    return {
      status: "ready",
      sourceKey: key,
      revision: state.revision,
      updatedAt: state.updatedAt,
      taskCount: Object.keys(state.tasks).length,
      projectCount: Object.keys(state.projects).length,
    };
  } catch (error) {
    return {
      status: "corrupted",
      sourceKey: key,
      message: error instanceof Error ? error.message : "Legacy localStorage data is invalid.",
    };
  }
}

export async function importLocalStorageState(
  offlineStorage: IndexedDbWorkspaceStorage,
  workspaceId: string,
  legacyStorage: Pick<Storage, "getItem"> | null | undefined,
  key = STORAGE_KEY,
): Promise<LocalStorageImportResult> {
  const raw = readLegacyValue(legacyStorage, key);
  if (raw === null) return { imported: false, snapshot: null };

  const state = parseLegacyState(raw);
  const priorSnapshot = await offlineStorage.loadSnapshot(workspaceId);
  await offlineStorage.saveLegacyImportBackup({
    workspaceId,
    legacyKey: key,
    rawLegacyValue: raw,
    priorSnapshot,
    capturedAt: new Date().toISOString(),
  });
  const snapshot = await offlineStorage.saveSnapshot(workspaceId, state);
  return { imported: true, snapshot };
}

export async function rollbackLocalStorageImport(
  offlineStorage: IndexedDbWorkspaceStorage,
  workspaceId: string,
  legacyStorage: LegacyStorage | null | undefined,
): Promise<LocalStorageRollbackResult> {
  const backup = await offlineStorage.loadLegacyImportBackup(workspaceId);
  if (!backup) return { rolledBack: false, snapshot: null };
  if (!legacyStorage) throw new Error("localStorage is unavailable for rollback.");

  legacyStorage.setItem(backup.legacyKey, backup.rawLegacyValue);
  if (backup.priorSnapshot) {
    await offlineStorage.saveSnapshot(workspaceId, backup.priorSnapshot.state);
  } else {
    await offlineStorage.deleteSnapshot(workspaceId);
  }
  await offlineStorage.deleteLegacyImportBackup(workspaceId);
  return { rolledBack: true, snapshot: backup.priorSnapshot };
}

function readLegacyValue(legacyStorage: Pick<Storage, "getItem"> | null | undefined, key: string): string | null {
  if (!legacyStorage) return null;
  try {
    return legacyStorage.getItem(key);
  } catch (error) {
    throw new Error(`Could not read legacy localStorage: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function parseLegacyState(raw: string): AppState {
  try {
    return migrate(JSON.parse(raw));
  } catch (error) {
    throw new Error(`Legacy localStorage data is invalid: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}
