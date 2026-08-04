import { createSampleState } from "./sample-data";
import { CURRENT_SCHEMA_VERSION, type AppState, type StateStorage } from "./types";

export const STORAGE_KEY = "todoist-replica.state";

export type LoadResult = { state: AppState; recovered: boolean };
export type SaveResult =
  | { ok: true; state: AppState }
  | { ok: false; reason: "conflict"; state: AppState };

export function createBrowserStorage(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null | undefined =
    typeof window === "undefined" ? undefined : window.localStorage,
  key = STORAGE_KEY,
): StateStorage {
  return {
    read: () => storage?.getItem(key) ?? null,
    write: (value) => storage?.setItem(key, value),
    remove: () => storage?.removeItem(key),
  };
}

export function loadState(storage: StateStorage, fallback = createSampleState): LoadResult {
  const raw = storage.read();
  if (!raw) return { state: fallback(), recovered: false };

  try {
    return { state: migrate(JSON.parse(raw)), recovered: false };
  } catch {
    return { state: fallback(), recovered: true };
  }
}

export function saveState(storage: StateStorage, next: AppState, expectedRevision: number): SaveResult {
  const raw = storage.read();
  if (raw) {
    let current: AppState;
    try {
      current = migrate(JSON.parse(raw));
    } catch {
      storage.write(JSON.stringify(next));
      return { ok: true, state: next };
    }
    if (current.revision !== expectedRevision) {
      return { ok: false, reason: "conflict", state: current };
    }
  } else if (expectedRevision !== 0) {
    return { ok: false, reason: "conflict", state: createSampleState() };
  }

  storage.write(JSON.stringify(next));
  return { ok: true, state: next };
}

export function migrate(value: unknown): AppState {
  if (!isRecord(value)) throw new Error("Stored state is not an object.");
  if (value.schemaVersion === CURRENT_SCHEMA_VERSION) return validateCurrentState(value);
  if (value.schemaVersion === 2 || value.schemaVersion === 1 || value.schemaVersion === 0) {
    return validateCurrentState({
      ...value,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      sections: isRecord(value.sections) ? value.sections : {},
      filters: isRecord(value.filters) ? value.filters : {},
      preferences: isRecord(value.preferences)
        ? {
            ...value.preferences,
            theme: value.preferences.theme ?? "system",
            showCompleted: value.preferences.showCompleted ?? false,
          }
        : value.preferences,
      undoStack: Array.isArray(value.undoStack) ? value.undoStack : [],
      orderItems: isRecord(value.orderItems) ? value.orderItems : {},
    });
  }
  throw new Error("Stored state schema is unsupported.");
}

function validateCurrentState(value: Record<string, unknown>): AppState {
  if (
    typeof value.revision !== "number" ||
    typeof value.clientId !== "string" ||
    typeof value.updatedAt !== "string" ||
    !isRecord(value.projects) ||
    !isRecord(value.sections) ||
    !isRecord(value.labels) ||
    !isRecord(value.filters) ||
    !isRecord(value.tasks) ||
    !isRecord(value.orderItems) ||
    !isRecord(value.preferences) ||
    !Array.isArray(value.undoStack)
  ) {
    throw new Error("Stored state is incomplete.");
  }
  return value as unknown as AppState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
