import { fromLocalDate } from "./dates";
import { createId, createSampleState } from "./sample-data";
import {
  CURRENT_SCHEMA_VERSION,
  type AppPreferences,
  type AppState,
  type DiaryEntry,
  type EntityId,
  type Label,
  type Note,
  type Project,
  type SavedFilter,
  type Section,
  type StateStorage,
  type StorageStatus,
  type Task,
  type TaskDue,
} from "./types";

export const STORAGE_KEY = "todoist-replica.state";
export const RECOVERY_KEY_SUFFIX = ".recovery";

export type LoadRecoveryReason = "malformed" | "blocked";
export type LoadResult = { state: AppState; recovered: boolean; reason?: LoadRecoveryReason };

export type SaveResult =
  | { ok: true; state: AppState; durable: boolean }
  | { ok: false; reason: "conflict" | "unavailable"; state: AppState; message: string };

export function createBrowserStorage(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null | undefined =
    getDefaultBrowserStorage(),
  key = STORAGE_KEY,
): StateStorage {
  let memoryValue: string | null = null;
  let memoryDirty = false;
  let memoryRemoved = false;
  let recoveryValue: string | null = null;
  let recoveryDirty = false;
  let status: StorageStatus = storage ? "persistent" : "memory";

  const flushMemory = (): boolean => {
    if (!storage) return false;
    try {
      if (memoryDirty) {
        if (memoryRemoved) storage.removeItem(key);
        else storage.setItem(key, memoryValue ?? "");
      }
      if (recoveryDirty && recoveryValue !== null) {
        storage.setItem(`${key}${RECOVERY_KEY_SUFFIX}`, recoveryValue);
      }
      memoryDirty = false;
      memoryRemoved = false;
      recoveryDirty = false;
      status = "persistent";
      return true;
    } catch {
      status = "memory";
      return false;
    }
  };

  return {
    read: () => {
      if (!storage) return memoryValue;
      if (memoryDirty || memoryRemoved || recoveryDirty) {
        flushMemory();
        return memoryValue;
      }
      try {
        const value = storage.getItem(key);
        memoryValue = value;
        status = "persistent";
        return value;
      } catch {
        status = "memory";
        return memoryValue;
      }
    },
    write: (value) => {
      memoryValue = value;
      memoryDirty = true;
      memoryRemoved = false;
      if (!storage) return;
      try {
        storage.setItem(key, value);
        memoryDirty = false;
        status = "persistent";
      } catch {
        status = "memory";
      }
    },
    remove: () => {
      memoryValue = null;
      memoryDirty = true;
      memoryRemoved = true;
      if (!storage) return;
      try {
        storage.removeItem(key);
        memoryDirty = false;
        memoryRemoved = false;
        status = "persistent";
      } catch {
        status = "memory";
      }
    },
    backup: (value) => {
      recoveryValue = value;
      recoveryDirty = true;
      if (!storage) return;
      try {
        storage.setItem(`${key}${RECOVERY_KEY_SUFFIX}`, value);
        recoveryDirty = false;
      } catch {
        status = "memory";
      }
    },
    getStatus: () => status,
  };
}

function getDefaultBrowserStorage(): Pick<Storage, "getItem" | "setItem" | "removeItem"> | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

export function loadState(storage: StateStorage, fallback = createSampleState): LoadResult {
  let raw: string | null;
  try {
    raw = storage.read();
  } catch {
    return { state: fallback(), recovered: true, reason: "blocked" };
  }

  if (!raw) return { state: fallback(), recovered: false };

  try {
    return { state: migrate(JSON.parse(raw)), recovered: false };
  } catch {
    try {
      storage.backup?.(raw);
    } catch {
      // Recovery is best effort; the fallback state must still be usable.
    }
    return { state: fallback(), recovered: true, reason: "malformed" };
  }
}

export function saveState(
  storage: StateStorage,
  next: AppState,
  expectedRevision: number,
  fallback = createSampleState,
): SaveResult {
  let raw: string | null;
  try {
    raw = storage.read();
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      state: next,
      message: "Saved data is unavailable. The change was kept only in memory.",
    };
  }

  if (raw) {
    let current: AppState;
    let currentWasMalformed = false;
    try {
      current = migrate(JSON.parse(raw));
    } catch {
      currentWasMalformed = true;
      try {
        storage.backup?.(raw);
      } catch {
        // Continue with the new valid state if backup is unavailable.
      }
      current = next;
    }
    if (!currentWasMalformed && current.revision !== expectedRevision) {
      return {
        ok: false,
        reason: "conflict",
        state: current,
        message: "Data changed in another tab. Reloaded the latest saved state.",
      };
    }
  } else if (expectedRevision !== 0) {
    return {
      ok: false,
      reason: "conflict",
      state: fallback(),
      message: "Saved data was cleared in another tab. Reloaded the initial state.",
    };
  }

  try {
    storage.write(JSON.stringify(next));
  } catch {
    return {
      ok: false,
      reason: "unavailable",
      state: next,
      message: "Saved data is unavailable. The change was kept only in memory.",
    };
  }

  return {
    ok: true,
    state: next,
    durable: storage.getStatus?.() !== "memory",
  };
}

export function exportState(state: AppState): string {
  return JSON.stringify(migrate(state));
}

export function importState(raw: string): AppState {
  if (typeof raw !== "string" || !raw.trim()) throw new Error("Import data is empty.");
  return migrate(JSON.parse(raw.replace(/^\uFEFF/, "")));
}

export function migrate(value: unknown): AppState {
  if (!isRecord(value)) throw new Error("Stored state is not an object.");
  const schemaVersion = value.schemaVersion;
  if (schemaVersion !== 0 && schemaVersion !== 1 && schemaVersion !== 2 && schemaVersion !== CURRENT_SCHEMA_VERSION) {
    throw new Error("Stored state schema is unsupported.");
  }

  return validateCurrentState({
    ...value,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    sections: isRecord(value.sections) ? value.sections : {},
    filters: isRecord(value.filters) ? value.filters : {},
    notes: isRecord(value.notes) ? value.notes : {},
    diaryEntries: isRecord(value.diaryEntries) ? value.diaryEntries : {},
    preferences: isRecord(value.preferences) ? value.preferences : {},
  });
}

function validateCurrentState(value: Record<string, unknown>): AppState {
  const projects = normalizeMap(value.projects, normalizeProject, "projects");
  const sections = normalizeMap(
    value.sections,
    (id, item) => normalizeSection(id, item, projects),
    "sections",
  );
  const labels = normalizeMap(value.labels, normalizeLabel, "labels");
  const filters = normalizeMap(value.filters, normalizeFilter, "filters");
  const tasks = normalizeMap(
    value.tasks,
    (id, item) => normalizeTask(id, item, projects, sections, labels),
    "tasks",
  );
  const notes = normalizeMap(
    value.notes,
    (id, item) => normalizeNote(id, item, projects, tasks),
    "notes",
  );
  const diaryEntries = normalizeMap(
    value.diaryEntries,
    (id, item) => normalizeDiaryEntry(id, item, tasks),
    "diaryEntries",
  );

  const preferences = normalizePreferences(value.preferences, projects);
  const undoStack = Array.isArray(value.undoStack)
    ? value.undoStack.filter(isUndoEntry)
    : [];

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    revision: nonNegativeInteger(value.revision, 0),
    clientId: stringValue(value.clientId, createId("client")),
    updatedAt: stringValue(value.updatedAt, new Date().toISOString()),
    projects,
    sections,
    labels,
    filters,
    tasks,
    notes,
    diaryEntries,
    preferences,
    undoStack,
  };
}

function normalizeProject(id: EntityId, value: unknown): Project {
  const record = recordFor(id, value, "project");
  return {
    id,
    name: requiredString(record.name, "project name"),
    description: stringValue(record.description, ""),
    color: stringValue(record.color, "charcoal"),
    parentId: nullableString(record.parentId),
    layout: record.layout === "board" ? "board" : "list",
    order: finiteNumber(record.order, 0),
    isFavorite: booleanValue(record.isFavorite, false),
    isArchived: booleanValue(record.isArchived, false),
    createdAt: stringValue(record.createdAt, new Date().toISOString()),
    updatedAt: stringValue(record.updatedAt, new Date().toISOString()),
  };
}

function normalizeSection(
  id: EntityId,
  value: unknown,
  projects: Record<EntityId, Project>,
): Section {
  const record = recordFor(id, value, "section");
  const projectId = requiredString(record.projectId, "section project");
  if (!projects[projectId]) throw new Error(`Section ${id} references an unknown project.`);
  return {
    id,
    projectId,
    name: requiredString(record.name, "section name"),
    order: finiteNumber(record.order, 0),
    isCollapsed: booleanValue(record.isCollapsed, false),
    createdAt: stringValue(record.createdAt, new Date().toISOString()),
    updatedAt: stringValue(record.updatedAt, new Date().toISOString()),
  };
}

function normalizeLabel(id: EntityId, value: unknown): Label {
  const record = recordFor(id, value, "label");
  return {
    id,
    name: requiredString(record.name, "label name"),
    color: stringValue(record.color, "charcoal"),
    order: finiteNumber(record.order, 0),
    isFavorite: booleanValue(record.isFavorite, false),
    createdAt: stringValue(record.createdAt, new Date().toISOString()),
    updatedAt: stringValue(record.updatedAt, new Date().toISOString()),
  };
}

function normalizeFilter(id: EntityId, value: unknown): SavedFilter {
  const record = recordFor(id, value, "filter");
  return {
    id,
    name: requiredString(record.name, "filter name"),
    color: stringValue(record.color, "charcoal"),
    query: requiredString(record.query, "filter query"),
    order: finiteNumber(record.order, 0),
    isFavorite: booleanValue(record.isFavorite, false),
    createdAt: stringValue(record.createdAt, new Date().toISOString()),
    updatedAt: stringValue(record.updatedAt, new Date().toISOString()),
  };
}

function normalizeTask(
  id: EntityId,
  value: unknown,
  projects: Record<EntityId, Project>,
  sections: Record<EntityId, Section>,
  labels: Record<EntityId, Label>,
): Task {
  const record = recordFor(id, value, "task");
  const projectId = requiredString(record.projectId, "task project");
  const sectionId = nullableString(record.sectionId);
  if (!projects[projectId]) throw new Error(`Task ${id} references an unknown project.`);
  const validSectionId =
    sectionId && sections[sectionId]?.projectId === projectId ? sectionId : null;

  const labelIds = stringArray(record.labelIds, "task labels");
  if (labelIds.some((labelId) => !labels[labelId])) {
    throw new Error(`Task ${id} references an unknown label.`);
  }

  return {
    id,
    content: requiredString(record.content, "task content"),
    description: stringValue(record.description, ""),
    projectId,
    sectionId: validSectionId,
    parentId: nullableString(record.parentId),
    labelIds: unique(labelIds),
    priority: record.priority === 1 || record.priority === 2 || record.priority === 3 ? record.priority : 4,
    due: normalizeDue(record.due),
    completedAt: nullableString(record.completedAt),
    order: finiteNumber(record.order, 0),
    createdAt: stringValue(record.createdAt, new Date().toISOString()),
    updatedAt: stringValue(record.updatedAt, new Date().toISOString()),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeNote(
  id: EntityId,
  value: unknown,
  projects: Record<EntityId, Project>,
  tasks: Record<EntityId, Task>,
): Note {
  const record = recordFor(id, value, "note");
  if (
    typeof record.id !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string"
  ) {
    throw new Error(`Note ${id} metadata is invalid.`);
  }
  const title = stringValue(record.title, "");
  const content = stringValue(record.content, "");
  if (!title.trim() && !content.trim()) throw new Error(`Note ${id} is empty.`);
  const linkedProjectId = nullableString(record.linkedProjectId);
  return {
    id,
    title,
    content,
    tags: normalizeStringArray(record.tags),
    isPinned: booleanValue(record.isPinned, false),
    isArchived: booleanValue(record.isArchived, false),
    linkedTaskIds: linkedTaskIds(record.linkedTaskIds, tasks),
    linkedProjectId: linkedProjectId && projects[linkedProjectId] ? linkedProjectId : null,
    createdAt: stringValue(record.createdAt, new Date().toISOString()),
    updatedAt: stringValue(record.updatedAt, new Date().toISOString()),
  };
}

function normalizeDiaryEntry(
  id: EntityId,
  value: unknown,
  tasks: Record<EntityId, Task>,
): DiaryEntry {
  const record = recordFor(id, value, "diary entry");
  if (
    typeof record.id !== "string" ||
    typeof record.createdAt !== "string" ||
    typeof record.updatedAt !== "string"
  ) {
    throw new Error(`Diary entry ${id} metadata is invalid.`);
  }
  const date = requiredString(record.date, "diary date");
  assertLocalDate(date);
  const title = stringValue(record.title, "");
  const content = stringValue(record.content, "");
  if (!title.trim() && !content.trim()) throw new Error(`Diary entry ${id} is empty.`);
  return {
    id,
    date,
    title,
    content,
    mood: isDiaryMood(record.mood) ? record.mood : null,
    tags: normalizeStringArray(record.tags),
    isFavorite: booleanValue(record.isFavorite, false),
    linkedTaskIds: linkedTaskIds(record.linkedTaskIds, tasks),
    createdAt: stringValue(record.createdAt, new Date().toISOString()),
    updatedAt: stringValue(record.updatedAt, new Date().toISOString()),
  };
}

function normalizePreferences(
  value: unknown,
  projects: Record<EntityId, Project>,
): AppPreferences {
  const record = isRecord(value) ? value : {};
  const firstProjectId = Object.keys(projects)[0];
  const inboxProjectId =
    typeof record.inboxProjectId === "string" && projects[record.inboxProjectId]
      ? record.inboxProjectId
      : firstProjectId;
  if (!inboxProjectId) throw new Error("Stored state has no projects.");

  const activeProjectId =
    record.activeProjectId === null
      ? null
      : typeof record.activeProjectId === "string" && projects[record.activeProjectId]
        ? record.activeProjectId
        : inboxProjectId;

  return {
    inboxProjectId,
    activeProjectId,
    onboardingDismissed: booleanValue(record.onboardingDismissed, false),
    theme: record.theme === "light" || record.theme === "dark" ? record.theme : "system",
    showCompleted: booleanValue(record.showCompleted, false),
  };
}

function normalizeDue(value: unknown): TaskDue | null {
  if (value === null || value === undefined) return null;
  const record = recordFor("due", value, "task due");
  const date = requiredString(record.date, "task due date");
  assertLocalDate(date);
  return {
    date,
    time: nullableString(record.time),
    timezone: nullableString(record.timezone),
    recurrence: nullableString(record.recurrence),
  };
}

function linkedTaskIds(
  value: unknown,
  tasks: Record<EntityId, Task>,
): EntityId[] {
  const ids = value === undefined ? [] : stringArray(value, "linked task ids");
  return unique(ids).filter((taskId) => Boolean(tasks[taskId]));
}

function normalizeMap<T>(
  value: unknown,
  normalize: (id: EntityId, item: unknown) => T,
  name: string,
): Record<EntityId, T> {
  if (!isRecord(value)) throw new Error(`Stored ${name} collection is invalid.`);
  const normalized: Record<EntityId, T> = {};
  for (const [id, item] of Object.entries(value)) {
    try {
      normalized[id] = normalize(id, item);
    } catch (error) {
      if (name === "notes" || name === "diaryEntries") continue;
      throw error;
    }
  }
  return normalized;
}

function recordFor(id: string, value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} ${id} is invalid.`);
  return value;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Stored ${name} is invalid.`);
  return value;
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : typeof value === "string" ? value : null;
}

function stringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`Stored ${name} is invalid.`);
  }
  return value;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean))];
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function nonNegativeInteger(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function assertLocalDate(value: string): void {
  try {
    fromLocalDate(value);
  } catch {
    throw new Error(`Stored local date is invalid: ${value}`);
  }
}

function isValidLocalDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    fromLocalDate(value);
    return true;
  } catch {
    return false;
  }
}

function isDiaryMood(value: unknown): value is DiaryEntry["mood"] {
  return value === "great" || value === "good" || value === "okay" || value === "low" || value === "rough";
}

function isUndoEntry(value: unknown): value is AppState["undoStack"][number] {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.createdAt === "string" &&
    isRecord(value.inverse)
  );
}
