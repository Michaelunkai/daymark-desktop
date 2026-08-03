import { createSampleState } from "./sample-data";
import {
  CURRENT_SCHEMA_VERSION,
  type AppState,
  type DiaryEntry,
  type Note,
  type StateStorage,
} from "./types";

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
      notes: isRecord(value.notes) ? value.notes : {},
      diaryEntries: isRecord(value.diaryEntries) ? value.diaryEntries : {},
      preferences: isRecord(value.preferences)
        ? {
            ...value.preferences,
            theme: value.preferences.theme ?? "system",
            showCompleted: value.preferences.showCompleted ?? false,
          }
        : value.preferences,
      undoStack: Array.isArray(value.undoStack) ? value.undoStack : [],
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
    !isRecord(value.preferences) ||
    !Array.isArray(value.undoStack)
  ) {
    throw new Error("Stored state is incomplete.");
  }
  return {
    ...value,
    notes: normalizeNotes(isRecord(value.notes) ? value.notes : {}),
    diaryEntries: normalizeDiaryEntries(isRecord(value.diaryEntries) ? value.diaryEntries : {}),
  } as unknown as AppState;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNotes(value: Record<string, unknown>): Record<string, Note> {
  return Object.entries(value).reduce<Record<string, Note>>((notes, [key, candidate]) => {
    if (!isRecord(candidate)) return notes;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.title !== "string" ||
      typeof candidate.content !== "string" ||
      typeof candidate.createdAt !== "string" ||
      typeof candidate.updatedAt !== "string"
    ) {
      return notes;
    }
    notes[key] = {
      id: candidate.id,
      title: candidate.title,
      content: candidate.content,
      tags: normalizeStringArray(candidate.tags),
      isPinned: candidate.isPinned === true,
      isArchived: candidate.isArchived === true,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    };
    return notes;
  }, {});
}

function normalizeDiaryEntries(value: Record<string, unknown>): Record<string, DiaryEntry> {
  return Object.entries(value).reduce<Record<string, DiaryEntry>>((entries, [key, candidate]) => {
    if (!isRecord(candidate)) return entries;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.date !== "string" ||
      !isValidLocalDate(candidate.date) ||
      typeof candidate.title !== "string" ||
      typeof candidate.content !== "string" ||
      typeof candidate.createdAt !== "string" ||
      typeof candidate.updatedAt !== "string"
    ) {
      return entries;
    }
    entries[key] = {
      id: candidate.id,
      date: candidate.date,
      title: candidate.title,
      content: candidate.content,
      mood: isDiaryMood(candidate.mood) ? candidate.mood : null,
      tags: normalizeStringArray(candidate.tags),
      isFavorite: candidate.isFavorite === true,
      createdAt: candidate.createdAt,
      updatedAt: candidate.updatedAt,
    };
    return entries;
  }, {});
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean))];
}

function isDiaryMood(value: unknown): value is DiaryEntry["mood"] {
  return value === "great" || value === "good" || value === "okay" || value === "low" || value === "rough";
}

function isValidLocalDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
