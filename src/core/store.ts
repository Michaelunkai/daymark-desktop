import { createId } from "./sample-data";
import { loadState, saveState } from "./storage";
import type {
  AppState,
  DispatchResult,
  Label,
  Project,
  SavedFilter,
  Section,
  StateStorage,
  StoreAction,
  Task,
  UndoAction,
  UndoEntry,
  UserAction,
} from "./types";

const MAX_UNDO_ENTRIES = 20;
type InvalidResult = { ok: false; reason: "invalid"; message: string; state?: AppState };
type MutationResult = { ok: true; inverse: UndoAction } | InvalidResult;

export interface AppStore {
  getState(): AppState;
  dispatch(action: UserAction): DispatchResult;
  reload(): AppState;
  subscribe(listener: (state: AppState) => void): () => void;
}

export function createAppStore(storage: StateStorage, fallback?: () => AppState): AppStore {
  let state = loadState(storage, fallback).state;
  const listeners = new Set<(next: AppState) => void>();
  const notify = () => listeners.forEach((listener) => listener(state));

  return {
    getState: () => state,
    reload: () => {
      state = loadState(storage, fallback).state;
      notify();
      return state;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (action) => {
      const durable = loadState(storage, fallback).state;
      const result = reduce(durable, action);
      if (!result.ok) return result;

      const saved = saveState(storage, result.state, durable.revision);
      if (!saved.ok) {
        state = saved.state;
        notify();
        return {
          ok: false,
          reason: "conflict",
          message: "Data changed in another tab. Reloaded the latest saved state.",
          state,
        };
      }

      state = saved.state;
      notify();
      return { ok: true, state };
    },
  };
}

export function reduce(state: AppState, action: StoreAction, now = new Date().toISOString()): DispatchResult {
  const draft = structuredClone(state);
  const result = apply(draft, action, now);
  if (!result.ok) return result;
  draft.revision = state.revision + 1;
  draft.updatedAt = now;
  return { ok: true, state: draft };
}

function apply(state: AppState, action: StoreAction, now: string, recordUndo = true): DispatchResult {
  if (action.type === "undo") {
    const entry = state.undoStack.pop();
    return entry ? apply(state, entry.inverse, now, false) : invalid("There is no action to undo.");
  }

  const result = mutate(state, action, now);
  if (!result.ok) return result;
  if (recordUndo && isUserAction(action) && action.type !== "task.delete") {
    state.undoStack.push(createUndoEntry(result.inverse, now));
    state.undoStack = state.undoStack.slice(-MAX_UNDO_ENTRIES);
  }
  return { ok: true, state };
}

function mutate(state: AppState, action: Exclude<StoreAction, { type: "undo" }>, now: string): MutationResult {
  switch (action.type) {
    case "task.add": {
      if (!action.input.content.trim()) return invalid("A task needs a name.");
      const id = action.input.id ?? createId("task");
      if (state.tasks[id]) return invalid("That task already exists.");
      const task: Task = {
        id,
        content: action.input.content.trim(),
        description: action.input.description ?? "",
        projectId: action.input.projectId ?? state.preferences.inboxProjectId,
        sectionId: action.input.sectionId ?? null,
        parentId: action.input.parentId ?? null,
        labelIds: unique(action.input.labelIds ?? []),
        priority: action.input.priority ?? 4,
        due: action.input.due ?? null,
        completedAt: null,
        order: action.input.order ?? nextOrder(state.tasks),
        createdAt: now,
        updatedAt: now,
      };
      if (!isValidTaskLocation(state, task.projectId, task.sectionId)) return invalid("The task section does not belong to its project.");
      if (!hasKnownLabels(state, task.labelIds)) return invalid("One or more task labels do not exist.");
      state.tasks[id] = task;
      return { ok: true, inverse: { type: "task.remove", taskId: id } };
    }
    case "task.restore":
      state.tasks[action.task.id] = structuredClone(action.task);
      return { ok: true, inverse: { type: "task.remove", taskId: action.task.id } };
    case "task.remove":
    case "task.delete": {
      const task = state.tasks[action.taskId];
      if (!task) return invalid("The task no longer exists.");
      delete state.tasks[action.taskId];
      return { ok: true, inverse: { type: "task.restore", task: structuredClone(task) } };
    }
    case "task.update": {
      const task = state.tasks[action.taskId];
      if (!task) return invalid("The task no longer exists.");
      const nextProjectId = action.patch.projectId ?? task.projectId;
      const nextSectionId = action.patch.sectionId === undefined ? task.sectionId : action.patch.sectionId;
      if (!isValidTaskLocation(state, nextProjectId, nextSectionId)) return invalid("The task section does not belong to its project.");
      if (action.patch.labelIds && !hasKnownLabels(state, action.patch.labelIds)) return invalid("One or more task labels do not exist.");
      const before = pick(task, action.patch);
      Object.assign(task, action.patch, {
        labelIds: action.patch.labelIds ? unique(action.patch.labelIds) : task.labelIds,
        updatedAt: now,
      });
      return { ok: true, inverse: { type: "task.update", taskId: task.id, patch: before } };
    }
    case "task.complete":
    case "task.uncomplete": {
      const task = state.tasks[action.taskId];
      if (!task) return invalid("The task no longer exists.");
      const before = task.completedAt;
      task.completedAt = action.type === "task.complete" ? now : null;
      task.updatedAt = now;
      return { ok: true, inverse: { type: "task.update", taskId: task.id, patch: { completedAt: before } } };
    }
    case "project.add": {
      if (!action.input.name.trim()) return invalid("A project needs a name.");
      const id = action.input.id ?? createId("project");
      if (state.projects[id]) return invalid("That project already exists.");
      const parentId = action.input.parentId ?? null;
      if (parentId && !state.projects[parentId]) return invalid("The parent project does not exist.");
      const project: Project = {
        id, name: action.input.name.trim(), description: action.input.description ?? "", color: action.input.color ?? "charcoal",
        parentId, layout: action.input.layout ?? "list", order: action.input.order ?? nextOrder(state.projects),
        isFavorite: action.input.isFavorite ?? false, isArchived: false, createdAt: now, updatedAt: now,
      };
      state.projects[id] = project;
      return { ok: true, inverse: { type: "project.remove", projectId: id } };
    }
    case "project.restore":
      state.projects[action.project.id] = structuredClone(action.project);
      return { ok: true, inverse: { type: "project.remove", projectId: action.project.id } };
    case "project.remove": {
      const project = state.projects[action.projectId];
      if (!project) return invalid("The project no longer exists.");
      delete state.projects[action.projectId];
      return { ok: true, inverse: { type: "project.restore", project: structuredClone(project) } };
    }
    case "project.update": {
      const project = state.projects[action.projectId];
      if (!project) return invalid("The project no longer exists.");
      if (action.patch.parentId && (!state.projects[action.patch.parentId] || action.patch.parentId === project.id)) return invalid("The project parent is invalid.");
      const before = pick(project, action.patch);
      Object.assign(project, action.patch, { updatedAt: now });
      return { ok: true, inverse: { type: "project.update", projectId: project.id, patch: before } };
    }
    case "project.archive": {
      const project = state.projects[action.projectId];
      if (!project) return invalid("The project no longer exists.");
      const before = project.isArchived;
      project.isArchived = action.archived;
      project.updatedAt = now;
      return { ok: true, inverse: { type: "project.update", projectId: project.id, patch: { isArchived: before } } };
    }
    case "section.add": {
      if (!action.input.name.trim() || !state.projects[action.input.projectId]) return invalid("A section needs a valid project and name.");
      const id = action.input.id ?? createId("section");
      if (state.sections[id]) return invalid("That section already exists.");
      const section: Section = {
        id, projectId: action.input.projectId, name: action.input.name.trim(), order: action.input.order ?? nextOrder(state.sections),
        isCollapsed: action.input.isCollapsed ?? false, createdAt: now, updatedAt: now,
      };
      state.sections[id] = section;
      return { ok: true, inverse: { type: "section.remove", sectionId: id } };
    }
    case "section.restore":
      state.sections[action.section.id] = structuredClone(action.section);
      return { ok: true, inverse: { type: "section.remove", sectionId: action.section.id } };
    case "section.remove": {
      const section = state.sections[action.sectionId];
      if (!section) return invalid("The section no longer exists.");
      delete state.sections[action.sectionId];
      return { ok: true, inverse: { type: "section.restore", section: structuredClone(section) } };
    }
    case "section.update": {
      const section = state.sections[action.sectionId];
      if (!section) return invalid("The section no longer exists.");
      const before = pick(section, action.patch);
      Object.assign(section, action.patch, { updatedAt: now });
      return { ok: true, inverse: { type: "section.update", sectionId: section.id, patch: before } };
    }
    case "label.add": {
      if (!action.input.name.trim()) return invalid("A label needs a name.");
      const id = action.input.id ?? createId("label");
      if (state.labels[id]) return invalid("That label already exists.");
      const label: Label = {
        id, name: action.input.name.trim(), color: action.input.color ?? "charcoal", order: action.input.order ?? nextOrder(state.labels),
        isFavorite: action.input.isFavorite ?? false, createdAt: now, updatedAt: now,
      };
      state.labels[id] = label;
      return { ok: true, inverse: { type: "label.remove", labelId: id } };
    }
    case "label.restore":
      state.labels[action.label.id] = structuredClone(action.label);
      return { ok: true, inverse: { type: "label.remove", labelId: action.label.id } };
    case "label.remove": {
      const label = state.labels[action.labelId];
      if (!label) return invalid("The label no longer exists.");
      delete state.labels[action.labelId];
      return { ok: true, inverse: { type: "label.restore", label: structuredClone(label) } };
    }
    case "label.update": {
      const label = state.labels[action.labelId];
      if (!label) return invalid("The label no longer exists.");
      const before = pick(label, action.patch);
      Object.assign(label, action.patch, { updatedAt: now });
      return { ok: true, inverse: { type: "label.update", labelId: label.id, patch: before } };
    }
    case "filter.add": {
      if (!action.input.name.trim() || !action.input.query.trim()) return invalid("A filter needs a name and query.");
      const id = action.input.id ?? createId("filter");
      if (state.filters[id]) return invalid("That filter already exists.");
      const filter: SavedFilter = {
        id, name: action.input.name.trim(), color: action.input.color ?? "charcoal", query: action.input.query.trim(),
        order: action.input.order ?? nextOrder(state.filters), isFavorite: action.input.isFavorite ?? false, createdAt: now, updatedAt: now,
      };
      state.filters[id] = filter;
      return { ok: true, inverse: { type: "filter.remove", filterId: id } };
    }
    case "filter.restore":
      state.filters[action.filter.id] = structuredClone(action.filter);
      return { ok: true, inverse: { type: "filter.remove", filterId: action.filter.id } };
    case "filter.remove": {
      const filter = state.filters[action.filterId];
      if (!filter) return invalid("The filter no longer exists.");
      delete state.filters[action.filterId];
      return { ok: true, inverse: { type: "filter.restore", filter: structuredClone(filter) } };
    }
    case "filter.update": {
      const filter = state.filters[action.filterId];
      if (!filter) return invalid("The filter no longer exists.");
      const before = pick(filter, action.patch);
      Object.assign(filter, action.patch, { updatedAt: now });
      return { ok: true, inverse: { type: "filter.update", filterId: filter.id, patch: before } };
    }
    case "preferences.update": {
      const before = pick(state.preferences, action.patch);
      Object.assign(state.preferences, action.patch);
      return { ok: true, inverse: { type: "preferences.update", patch: before } };
    }
  }
}

function isUserAction(action: StoreAction): action is UserAction {
  return !action.type.endsWith(".restore") && !action.type.endsWith(".remove");
}

function createUndoEntry(inverse: UndoAction, createdAt: string): UndoEntry {
  return { id: createId("undo"), label: inverse.type, inverse, createdAt };
}

function isValidTaskLocation(state: AppState, projectId: string, sectionId: string | null): boolean {
  return Boolean(state.projects[projectId]) && (!sectionId || state.sections[sectionId]?.projectId === projectId);
}

function hasKnownLabels(state: AppState, labelIds: string[]): boolean {
  return labelIds.every((labelId) => Boolean(state.labels[labelId]));
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function nextOrder(collection: Record<string, { order: number }>): number {
  return Object.values(collection).reduce((largest, value) => Math.max(largest, value.order), -1) + 1;
}

function pick<T extends object>(source: T, patch: Partial<T>): Partial<T> {
  return Object.keys(patch).reduce<Partial<T>>((result, key) => {
    const typedKey = key as keyof T;
    result[typedKey] = source[typedKey];
    return result;
  }, {});
}

function invalid(message: string): InvalidResult {
  return { ok: false, reason: "invalid", message };
}
