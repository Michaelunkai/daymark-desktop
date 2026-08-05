import { createSampleState } from "./sample-data";
import {
  CURRENT_SCHEMA_VERSION,
  type AppState,
  type DiaryEntry,
  type Note,
  type StateStorage,
  type Task,
} from "./types";

export const STORAGE_KEY = "todoist-replica.state";

export type LoadResult = { state: AppState; recovered: boolean; available: boolean };
export type SaveResult =
  | { ok: true; state: AppState }
  | { ok: false; reason: "conflict"; state: AppState };

export function createBrowserStorage(
  storage?: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null,
  key = STORAGE_KEY,
): StateStorage {
  const target = storage === undefined ? getBrowserStorage() : storage;
  let available = Boolean(target);
  return {
    read: () => {
      try {
        return target?.getItem(key) ?? null;
      } catch {
        available = false;
        return null;
      }
    },
    write: (value) => {
      try {
        target?.setItem(key, value);
      } catch {
        available = false;
      }
    },
    remove: () => {
      try {
        target?.removeItem(key);
      } catch {
        available = false;
      }
    },
    isAvailable: () => available,
  };
}

export function loadState(storage: StateStorage, fallback = createSampleState): LoadResult {
  let raw: string | null = null;
  let readFailed = false;
  try {
    raw = storage.read();
  } catch {
    raw = null;
    readFailed = true;
  }
  const available = !readFailed && (storage.isAvailable?.() ?? true);
  if (!raw) return { state: fallback(), recovered: false, available };

  try {
    return { state: migrate(JSON.parse(raw)), recovered: false, available };
  } catch {
    return { state: fallback(), recovered: true, available };
  }
}

export function saveState(storage: StateStorage, next: AppState, expectedRevision: number): SaveResult {
  let raw: string | null = null;
  let readFailed = false;
  try {
    raw = storage.read();
  } catch {
    readFailed = true;
  }
  if (readFailed || storage.isAvailable?.() === false) {
    return { ok: true, state: next };
  }
  if (raw) {
    let current: AppState;
    try {
      current = migrate(JSON.parse(raw));
    } catch {
      try {
        storage.write(JSON.stringify(next));
      } catch {
        // Keep the in-memory state usable when durable storage is unavailable.
      }
      return { ok: true, state: next };
    }
    if (current.revision !== expectedRevision) {
      return { ok: false, reason: "conflict", state: current };
    }
  } else if (expectedRevision !== 0) {
    return { ok: false, reason: "conflict", state: createSampleState() };
  }

  try {
    storage.write(JSON.stringify(next));
  } catch {
    // Keep the in-memory state usable when durable storage is unavailable.
  }
  return { ok: true, state: next };
}

export function migrate(value: unknown): AppState {
  if (!isRecord(value)) throw new Error("Stored state is not an object.");
  if (value.schemaVersion === CURRENT_SCHEMA_VERSION) return validateCurrentState(value);
  if (
    value.schemaVersion === 3 ||
    value.schemaVersion === 2 ||
    value.schemaVersion === 1 ||
    value.schemaVersion === 0
  ) {
    return validateCurrentState(migrateTasks({
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
      notes: isRecord(value.notes) ? value.notes : {},
      diaryEntries: isRecord(value.diaryEntries) ? value.diaryEntries : {},
    }));
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
    !isRecord(value.notes) ||
    !isRecord(value.diaryEntries) ||
    !isRecord(value.preferences) ||
    !Array.isArray(value.undoStack)
  ) {
    throw new Error("Stored state is incomplete.");
  }
  return migrateDiaryEntries(migrateNotes(migrateTasks(value))) as unknown as AppState;
}

function getBrowserStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

function migrateTasks(value: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(value.tasks)) return value;

  const tasks = Object.fromEntries(
    Object.entries(value.tasks).map(([id, rawTask]) => {
      if (!isRecord(rawTask)) throw new Error(`Stored task ${id} is invalid.`);
      const task = rawTask as Partial<Task>;
      const completionContext =
        task.completionContext ??
        (typeof task.completedAt === "string"
          ? {
              projectId: typeof task.projectId === "string" ? task.projectId : "",
              sectionId: typeof task.sectionId === "string" ? task.sectionId : null,
              order: typeof task.order === "number" ? task.order : 0,
            }
          : null);
      return [
        id,
        {
          ...rawTask,
          completionContext,
          completedAt: typeof task.completedAt === "string" ? task.completedAt : null,
        },
      ];
    }),
  );

  return { ...value, tasks };
}

function migrateNotes(value: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(value.notes)) return value;
  const notes = Object.fromEntries(
    Object.entries(value.notes).map(([id, rawNote], index) => {
      if (!isRecord(rawNote)) throw new Error(`Stored note ${id} is invalid.`);
      const note = rawNote as Partial<Note>;
      return [
        id,
        {
          ...rawNote,
          completedAt: typeof note.completedAt === "string" ? note.completedAt : null,
          order: typeof note.order === "number" ? note.order : index,
        },
      ];
    }),
  );
  return { ...value, notes };
}

function migrateDiaryEntries(value: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(value.diaryEntries)) return value;
  const diaryEntries = Object.fromEntries(
    Object.entries(value.diaryEntries).map(([date, rawEntry]) => {
      if (!isRecord(rawEntry)) throw new Error(`Stored diary entry ${date} is invalid.`);
      const entry = rawEntry as Partial<DiaryEntry>;
      return [
        date,
        {
          ...rawEntry,
          date: typeof entry.date === "string" ? entry.date : date,
          body: typeof entry.body === "string" ? entry.body : "",
          morning: typeof entry.morning === "string" ? entry.morning : "",
          highlights: typeof entry.highlights === "string" ? entry.highlights : "",
          reflection: typeof entry.reflection === "string" ? entry.reflection : "",
          tomorrow: typeof entry.tomorrow === "string" ? entry.tomorrow : "",
        },
      ];
    }),
  );
  return { ...value, diaryEntries };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
