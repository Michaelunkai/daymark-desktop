import { createId } from "./sample-data";
import { loadState, saveState } from "./storage";
import type {
  AppState,
  DispatchResult,
  DomainSnapshot,
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
  if (recordUndo && isUserAction(action)) {
    state.undoStack.push(createUndoEntry(result.inverse, now));
    state.undoStack = state.undoStack.slice(-MAX_UNDO_ENTRIES);
  }
  return { ok: true, state };
}

function mutate(state: AppState, action: Exclude<StoreAction, { type: "undo" }>, now: string): MutationResult {
  switch (action.type) {
    case "state.restore": {
      const before = captureDomain(state);
      restoreDomain(state, action.snapshot);
      return { ok: true, inverse: { type: "state.restore", snapshot: before } };
    }
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
      if (!isValidTaskParent(state, task, task.parentId)) return invalid("A subtask must belong to an existing task in the same location.");
      state.tasks[id] = task;
      return { ok: true, inverse: { type: "task.remove", taskId: id } };
    }
    case "task.restore":
      if (!isValidTaskLocation(state, action.task.projectId, action.task.sectionId)) {
        return invalid("The restored task section does not belong to its project.");
      }
      if (!hasKnownLabels(state, action.task.labelIds)) return invalid("One or more restored task labels do not exist.");
      if (!isValidTaskParent(state, action.task, action.task.parentId)) {
        return invalid("The restored task parent is invalid.");
      }
      state.tasks[action.task.id] = structuredClone(action.task);
      return { ok: true, inverse: { type: "task.remove", taskId: action.task.id } };
    case "task.remove": {
      const task = state.tasks[action.taskId];
      if (!task) return invalid("The task no longer exists.");
      delete state.tasks[action.taskId];
      return { ok: true, inverse: { type: "task.restore", task: structuredClone(task) } };
    }
    case "task.delete": {
      const task = state.tasks[action.taskId];
      if (!task) return invalid("The task no longer exists.");
      const before = captureDomain(state);
      for (const id of taskTreeIds(state, [task.id])) delete state.tasks[id];
      return { ok: true, inverse: { type: "state.restore", snapshot: before } };
    }
    case "task.update": {
      const task = state.tasks[action.taskId];
      if (!task) return invalid("The task no longer exists.");
      const nextProjectId = action.patch.projectId ?? task.projectId;
      const nextSectionId = action.patch.sectionId === undefined ? task.sectionId : action.patch.sectionId;
      const nextParentId = action.patch.parentId === undefined ? task.parentId : action.patch.parentId;
      const proposed = { ...task, ...action.patch, projectId: nextProjectId, sectionId: nextSectionId, parentId: nextParentId };
      if (action.patch.content !== undefined && !action.patch.content.trim()) return invalid("A task needs a name.");
      if (!isValidTaskLocation(state, nextProjectId, nextSectionId)) return invalid("The task section does not belong to its project.");
      if (!isValidTaskParent(state, proposed, nextParentId)) return invalid("A subtask must belong to an existing task in the same location.");
      if (action.patch.labelIds && !hasKnownLabels(state, action.patch.labelIds)) return invalid("One or more task labels do not exist.");
      const movesTaskTree = nextProjectId !== task.projectId || nextSectionId !== task.sectionId;
      if (movesTaskTree && taskTreeIds(state, [task.id]).length > 1) {
        const before = captureDomain(state);
        for (const taskId of taskTreeIds(state, [task.id])) {
          Object.assign(state.tasks[taskId], { projectId: nextProjectId, sectionId: nextSectionId, updatedAt: now });
        }
        Object.assign(task, action.patch, {
          labelIds: action.patch.labelIds ? unique(action.patch.labelIds) : task.labelIds,
          updatedAt: now,
        });
        return { ok: true, inverse: { type: "state.restore", snapshot: before } };
      }
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
    case "task.duplicate": {
      const task = state.tasks[action.taskId];
      if (!task) return invalid("The task no longer exists.");
      const before = captureDomain(state);
      const sourceIds = action.includeSubtasks === false ? [task.id] : taskTreeIds(state, [task.id]);
      const replacements = new Map(sourceIds.map((id) => [id, createId("task")]));
      for (const sourceId of sourceIds) {
        const source = state.tasks[sourceId];
        const copyId = replacements.get(sourceId)!;
        state.tasks[copyId] = {
          ...structuredClone(source),
          id: copyId,
          content: sourceId === task.id ? `${source.content} (copy)` : source.content,
          parentId: source.parentId ? replacements.get(source.parentId) ?? null : null,
          completedAt: null,
          order: nextOrder(state.tasks),
          createdAt: now,
          updatedAt: now,
        };
      }
      return { ok: true, inverse: { type: "state.restore", snapshot: before } };
    }
    case "task.bulk.complete": {
      const taskIds = requireTasks(state, action.taskIds);
      if (!taskIds.ok) return taskIds;
      const before = captureDomain(state);
      const completedAt = action.completed === false ? null : now;
      for (const taskId of taskIds.value) {
        state.tasks[taskId].completedAt = completedAt;
        state.tasks[taskId].updatedAt = now;
      }
      return { ok: true, inverse: { type: "state.restore", snapshot: before } };
    }
    case "task.bulk.move": {
      if (!isValidTaskLocation(state, action.location.projectId, action.location.sectionId ?? null)) {
        return invalid("The destination section does not belong to its project.");
      }
      const requested = requireTasks(state, action.taskIds);
      if (!requested.ok) return requested;
      const taskIds = taskTreeIds(state, requested.value);
      const moved = new Set(taskIds);
      for (const taskId of taskIds) {
        const parentId = state.tasks[taskId].parentId;
        if (parentId && !moved.has(parentId)) return invalid("Move a parent task with its subtasks.");
      }
      const before = captureDomain(state);
      for (const taskId of taskIds) {
        Object.assign(state.tasks[taskId], {
          projectId: action.location.projectId,
          sectionId: action.location.sectionId ?? null,
          updatedAt: now,
        });
      }
      return { ok: true, inverse: { type: "state.restore", snapshot: before } };
    }
    case "task.bulk.reschedule": {
      const taskIds = requireTasks(state, action.taskIds);
      if (!taskIds.ok) return taskIds;
      const before = captureDomain(state);
      for (const taskId of taskIds.value) {
        state.tasks[taskId].due = action.due ? structuredClone(action.due) : null;
        state.tasks[taskId].updatedAt = now;
      }
      return { ok: true, inverse: { type: "state.restore", snapshot: before } };
    }
    case "project.add": {
      if (!action.input.name.trim()) return invalid("A project needs a name.");
      const id = action.input.id ?? createId("project");
      if (state.projects[id]) return invalid("That project already exists.");
      const parentId = action.input.parentId ?? null;
      if (parentId && !state.projects[parentId]) return invalid("The parent project does not exist.");
      state.projects[id] = {
        id, name: action.input.name.trim(), description: action.input.description ?? "", color: action.input.color ?? "charcoal",
        parentId, layout: action.input.layout ?? "list", order: action.input.order ?? nextOrder(state.projects),
        isFavorite: action.input.isFavorite ?? false, isArchived: false, createdAt: now, updatedAt: now,
      };
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
    case "project.delete": {
      if (action.projectId === state.preferences.inboxProjectId) return invalid("The Inbox project cannot be deleted.");
      if (!state.projects[action.projectId]) return invalid("The project no longer exists.");
      const before = captureDomain(state);
      const projectIds = projectTreeIds(state, action.projectId);
      const deletedProjects = new Set(projectIds);
      for (const projectId of projectIds) delete state.projects[projectId];
      for (const [sectionId, section] of Object.entries(state.sections)) {
        if (deletedProjects.has(section.projectId)) delete state.sections[sectionId];
      }
      for (const [taskId, task] of Object.entries(state.tasks)) {
        if (deletedProjects.has(task.projectId)) delete state.tasks[taskId];
      }
      if (state.preferences.activeProjectId && deletedProjects.has(state.preferences.activeProjectId)) {
        state.preferences.activeProjectId = state.preferences.inboxProjectId;
      }
      return { ok: true, inverse: { type: "state.restore", snapshot: before } };
    }
    case "project.update": {
      const project = state.projects[action.projectId];
      if (!project) return invalid("The project no longer exists.");
      if (action.patch.name !== undefined && !action.patch.name.trim()) return invalid("A project needs a name.");
      if (action.patch.parentId !== undefined && !isValidProjectParent(state, project.id, action.patch.parentId)) {
        return invalid("The project parent is invalid.");
      }
      const before = pick(project, action.patch);
      Object.assign(project, action.patch, { updatedAt: now });
      return { ok: true, inverse: { type: "project.update", projectId: project.id, patch: before } };
    }
    case "project.archive": {
      if (!state.projects[action.projectId]) return invalid("The project no longer exists.");
      const before = captureDomain(state);
      for (const projectId of projectTreeIds(state, action.projectId)) {
        state.projects[projectId].isArchived = action.archived;
        state.projects[projectId].updatedAt = now;
      }
      return { ok: true, inverse: { type: "state.restore", snapshot: before } };
    }
    case "section.add": {
      if (!action.input.name.trim() || !state.projects[action.input.projectId]) return invalid("A section needs a valid project and name.");
      const id = action.input.id ?? createId("section");
      if (state.sections[id]) return invalid("That section already exists.");
      state.sections[id] = {
        id, projectId: action.input.projectId, name: action.input.name.trim(), order: action.input.order ?? nextOrder(state.sections),
        isCollapsed: action.input.isCollapsed ?? false, createdAt: now, updatedAt: now,
      };
      return { ok: true, inverse: { type: "section.remove", sectionId: id } };
    }
    case "section.restore":
      if (!state.projects[action.section.projectId]) return invalid("The restored section project does not exist.");
      state.sections[action.section.id] = structuredClone(action.section);
      return { ok: true, inverse: { type: "section.remove", sectionId: action.section.id } };
    case "section.remove": {
      const section = state.sections[action.sectionId];
      if (!section) return invalid("The section no longer exists.");
      delete state.sections[action.sectionId];
      return { ok: true, inverse: { type: "section.restore", section: structuredClone(section) } };
    }
    case "section.delete": {
      const section = state.sections[action.sectionId];
      if (!section) return invalid("The section no longer exists.");
      const before = captureDomain(state);
      delete state.sections[action.sectionId];
      for (const task of Object.values(state.tasks)) {
        if (task.sectionId === action.sectionId) {
          task.sectionId = null;
          task.updatedAt = now;
        }
      }
      return { ok: true, inverse: { type: "state.restore", snapshot: before } };
    }
    case "section.update": {
      const section = state.sections[action.sectionId];
      if (!section) return invalid("The section no longer exists.");
      if (action.patch.name !== undefined && !action.patch.name.trim()) return invalid("A section needs a name.");
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
  return !action.type.endsWith(".restore") && !action.type.endsWith(".remove") && action.type !== "state.restore";
}

function createUndoEntry(inverse: UndoAction, createdAt: string): UndoEntry {
  return { id: createId("undo"), label: inverse.type, inverse, createdAt };
}

function captureDomain(state: AppState): DomainSnapshot {
  return structuredClone({
    projects: state.projects,
    sections: state.sections,
    labels: state.labels,
    filters: state.filters,
    tasks: state.tasks,
    preferences: state.preferences,
  });
}

function restoreDomain(state: AppState, snapshot: DomainSnapshot): void {
  Object.assign(state, structuredClone(snapshot));
}

function isValidTaskLocation(state: AppState, projectId: string, sectionId: string | null): boolean {
  return Boolean(state.projects[projectId]) && (!sectionId || state.sections[sectionId]?.projectId === projectId);
}

function isValidTaskParent(state: AppState, task: Task, parentId: string | null): boolean {
  if (!parentId) return true;
  const parent = state.tasks[parentId];
  if (!parent || parent.id === task.id) return false;
  if (parent.projectId !== task.projectId || parent.sectionId !== task.sectionId) return false;
  let cursor: Task | undefined = parent;
  while (cursor) {
    if (cursor.parentId === task.id) return false;
    cursor = cursor.parentId ? state.tasks[cursor.parentId] : undefined;
  }
  return true;
}

function isValidProjectParent(state: AppState, projectId: string, parentId: string | null): boolean {
  if (!parentId) return true;
  if (!state.projects[parentId] || parentId === projectId) return false;
  let cursor: Project | undefined = state.projects[parentId];
  while (cursor) {
    if (cursor.id === projectId) return false;
    cursor = cursor.parentId ? state.projects[cursor.parentId] : undefined;
  }
  return true;
}

function projectTreeIds(state: AppState, rootId: string): string[] {
  const ids: string[] = [];
  const pending = [rootId];
  while (pending.length) {
    const projectId = pending.shift()!;
    ids.push(projectId);
    for (const project of Object.values(state.projects)) if (project.parentId === projectId) pending.push(project.id);
  }
  return ids;
}

function taskTreeIds(state: AppState, roots: string[]): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  const pending = [...roots];
  while (pending.length) {
    const taskId = pending.shift()!;
    if (seen.has(taskId) || !state.tasks[taskId]) continue;
    seen.add(taskId);
    ids.push(taskId);
    for (const task of Object.values(state.tasks)) if (task.parentId === taskId) pending.push(task.id);
  }
  return ids;
}

function requireTasks(state: AppState, taskIds: string[]): { ok: true; value: string[] } | InvalidResult {
  const ids = unique(taskIds);
  if (!ids.length) return invalid("Select at least one task.");
  if (ids.some((taskId) => !state.tasks[taskId])) return invalid("One or more selected tasks no longer exist.");
  return { ok: true, value: ids };
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
