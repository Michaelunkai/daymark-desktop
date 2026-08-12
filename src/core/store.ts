import { createId, createSampleState } from "./sample-data";
import { loadState, saveState } from "./storage";
import type {
  AppState,
  DispatchResult,
  DiaryEntry,
  Note,
  OrderItem,
  OrderItemInput,
  Project,
  SavedFilter,
  Section,
  StateStorage,
  StoreAction,
  Task,
  TaskInput,
  UndoAction,
  UndoEntry,
  UserAction,
  DiaryEntry,
} from "./types";

const MAX_UNDO_ENTRIES = 20;
type InvalidResult = { ok: false; reason: "invalid"; message: string; state?: AppState };
type MutationResult = { ok: true; inverse: UndoAction; changed?: boolean } | InvalidResult;

export interface AppStore {
  getState(): AppState;
  dispatch(action: UserAction): DispatchResult;
  rollOverIncompleteTasks(today: string): AppState;
  replace(next: AppState): AppState;
  reload(): AppState;
  reset(): AppState;
  subscribe(listener: (state: AppState) => void): () => void;
}

export function createAppStore(storage: StateStorage, fallback?: () => AppState): AppStore {
  let state = loadState(storage, fallback).state;
  const listeners = new Set<(next: AppState) => void>();
  const notify = () => listeners.forEach((listener) => listener(state));

  return {
    getState: () => state,
    rollOverIncompleteTasks: (today) => {
      const loaded = loadState(storage, fallback);
      const durable = loaded.available ? loaded.state : state;
      const rolledOver = rollOverIncompleteTasks(durable, today);
      if (!rolledOver.changed) return state;

      const saved = saveState(storage, rolledOver.state, durable.revision);
      state = saved.state;
      notify();
      return state;
    },
    replace: (next) => {
      state = structuredClone(next);
      try {
        storage.write(JSON.stringify(state));
      } catch {
        // Keep the remote state usable in memory when durable storage is unavailable.
      }
      notify();
      return state;
    },
    reload: () => {
      const loaded = loadState(storage, fallback);
      if (loaded.available) state = loaded.state;
      notify();
      return state;
    },
    reset: () => {
      state = (fallback ?? createSampleState)();
      notify();
      return state;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch: (action) => {
      const loaded = loadState(storage, fallback);
      const durable = loaded.available ? loaded.state : state;
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

export function rollOverIncompleteTasks(
  state: AppState,
  today: string,
  now = new Date().toISOString(),
): { state: AppState; changed: boolean } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) {
    throw new Error("Today must be a valid local date.");
  }

  const overdueTaskIds = Object.values(state.tasks)
    .filter((task) => task.completedAt === null && task.due?.date && task.due.date < today)
    .map((task) => task.id);
  if (!overdueTaskIds.length) return { state, changed: false };

  const next = structuredClone(state);
  for (const taskId of overdueTaskIds) {
    const task = next.tasks[taskId];
    if (!task?.due) continue;
    task.due.date = today;
    task.updatedAt = now;
  }
  next.revision = state.revision + 1;
  next.updatedAt = now;
  return { state: next, changed: true };
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
  if (recordUndo && result.changed !== false && isUserAction(action) && action.type !== "task.delete") {
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
        priority: action.input.priority ?? 4,
        due: action.input.due ?? null,
        completedAt: null,
        completionContext: null,
        order: action.input.order ?? nextOrder(state.tasks),
        createdAt: now,
        updatedAt: now,
      };
      if (!isValidTaskLocation(state, task.projectId, task.sectionId)) return invalid("The task section does not belong to its project.");
      state.tasks[id] = task;
      clearTombstone(state, "tasks", id);
      return { ok: true, inverse: { type: "task.remove", taskId: id } };
    }
    case "task.restore":
      state.tasks[action.task.id] = structuredClone(action.task);
      clearTombstone(state, "tasks", action.task.id);
      return { ok: true, inverse: { type: "task.remove", taskId: action.task.id } };
    case "task.remove":
    case "task.delete": {
      const task = state.tasks[action.taskId];
      if (!task) return invalid("The task no longer exists.");
      delete state.tasks[action.taskId];
      markTombstone(state, "tasks", action.taskId, now);
      return { ok: true, inverse: { type: "task.restore", task: structuredClone(task) } };
    }
    case "task.transferToOrder": {
      const task = state.tasks[action.taskId];
      if (!task) return invalid("The task no longer exists.");
      const orderItemResult = createOrderItem(state, action.input, now);
      if (!orderItemResult.ok) return orderItemResult;

      state.orderItems[orderItemResult.item.id] = orderItemResult.item;
      clearTombstone(state, "orderItems", orderItemResult.item.id);
      delete state.tasks[action.taskId];
      markTombstone(state, "tasks", action.taskId, now);
      return {
        ok: true,
        inverse: {
          type: "task.transfer.restore",
          task: structuredClone(task),
          orderItemId: orderItemResult.item.id,
        },
      };
    }
    case "task.transfer.restore": {
      const orderItem = state.orderItems[action.orderItemId];
      if (!orderItem) return invalid("The transferred Order item no longer exists.");
      if (state.tasks[action.task.id]) return invalid("The original task already exists.");

      delete state.orderItems[action.orderItemId];
      markTombstone(state, "orderItems", action.orderItemId, now);
      clearOrderRelations(state, action.orderItemId);
      state.tasks[action.task.id] = structuredClone(action.task);
      clearTombstone(state, "tasks", action.task.id);
      return {
        ok: true,
        inverse: {
          type: "task.transfer.restore",
          task: structuredClone(action.task),
          orderItemId: action.orderItemId,
        },
      };
    }
    case "task.update": {
      const task = state.tasks[action.taskId];
      if (!task) return invalid("The task no longer exists.");
      const nextProjectId = action.patch.projectId ?? task.projectId;
      const nextSectionId = action.patch.sectionId === undefined ? task.sectionId : action.patch.sectionId;
      if (!isValidTaskLocation(state, nextProjectId, nextSectionId)) return invalid("The task section does not belong to its project.");
      const before = pick(task, action.patch);
      Object.assign(task, action.patch, {
        updatedAt: now,
      });
      return { ok: true, inverse: { type: "task.update", taskId: task.id, patch: before } };
    }
    case "task.complete":
    case "task.uncomplete": {
      const task = state.tasks[action.taskId];
      if (!task) return invalid("The task no longer exists.");
      const before = {
        completedAt: task.completedAt,
        completionContext: task.completionContext,
        projectId: task.projectId,
        sectionId: task.sectionId,
        order: task.order,
      };
      if (action.type === "task.complete") {
        if (task.completedAt) {
          return { ok: true, changed: false, inverse: { type: "task.update", taskId: task.id, patch: {} } };
        }
        task.completedAt = now;
        task.completionContext = {
          projectId: task.projectId,
          sectionId: task.sectionId,
          order: task.order,
        };
      } else {
        if (!task.completedAt) {
          return { ok: true, changed: false, inverse: { type: "task.update", taskId: task.id, patch: {} } };
        }
        const context = task.completionContext;
        task.completedAt = null;
        if (context && isValidTaskLocation(state, context.projectId, context.sectionId)) {
          task.projectId = context.projectId;
          task.sectionId = context.sectionId;
          placeTaskAtOrder(state, task, context.sectionId, context.order, now);
        }
        task.completionContext = null;
      }
      task.updatedAt = now;
      return {
        ok: true,
        inverse: {
          type: "task.update",
          taskId: task.id,
          patch: {
            completedAt: before.completedAt,
            completionContext: before.completionContext,
            projectId: before.projectId,
            sectionId: before.sectionId,
            order: before.order,
          },
        },
      };
    }
    case "task.reorder": {
      const task = state.tasks[action.input.taskId];
      if (!task) return invalid("The task no longer exists.");
      if (task.completedAt) return invalid("Completed tasks cannot be reordered.");
      if (!Number.isFinite(action.input.order) || action.input.order < 0) {
        return invalid("Task order must be a non-negative number.");
      }
      if (!isValidTaskLocation(state, task.projectId, action.input.sectionId)) {
        return invalid("The task section does not belong to its project.");
      }

      const before = { sectionId: task.sectionId, order: task.order };
      const siblings = Object.values(state.tasks)
        .filter(
          (candidate) =>
            candidate.projectId === task.projectId &&
            candidate.completedAt === null &&
            (candidate.sectionId ?? null) === (action.input.sectionId ?? null),
        )
        .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id))
        .filter((candidate) => candidate.id !== task.id);
      const targetIndex = Math.min(Math.floor(action.input.order), siblings.length);
      siblings.splice(targetIndex, 0, task);
      for (const [index, sibling] of siblings.entries()) {
        sibling.sectionId = action.input.sectionId;
        sibling.order = index;
        sibling.updatedAt = now;
      }
      return {
        ok: true,
        inverse: {
          type: "task.reorder",
          input: { taskId: task.id, sectionId: before.sectionId, order: before.order },
        },
      };
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
      clearTombstone(state, "projects", id);
      return { ok: true, inverse: { type: "project.remove", projectId: id } };
    }
    case "project.restore":
      state.projects[action.project.id] = structuredClone(action.project);
      clearTombstone(state, "projects", action.project.id);
      return { ok: true, inverse: { type: "project.remove", projectId: action.project.id } };
    case "project.remove": {
      const project = state.projects[action.projectId];
      if (!project) return invalid("The project no longer exists.");
      delete state.projects[action.projectId];
      markTombstone(state, "projects", action.projectId, now);
      return { ok: true, inverse: { type: "project.restore", project: structuredClone(project) } };
    }
    case "project.delete": {
      const project = state.projects[action.projectId];
      if (!project) return invalid("The project no longer exists.");
      if (project.id === state.preferences.inboxProjectId) return invalid("Inbox cannot be deleted.");
      if (Object.values(state.projects).some((candidate) => candidate.parentId === project.id)) {
        return invalid("Move or delete child projects before deleting this project.");
      }
      const sections = Object.values(state.sections).filter((section) => section.projectId === project.id);
      const tasks = Object.values(state.tasks).filter((task) => task.projectId === project.id);
      const taskSnapshot = structuredClone(tasks);
      for (const task of tasks) {
        task.projectId = state.preferences.inboxProjectId;
        task.sectionId = null;
        task.updatedAt = now;
      }
      for (const section of sections) {
        delete state.sections[section.id];
        markTombstone(state, "sections", section.id, now);
      }
      delete state.projects[project.id];
      markTombstone(state, "projects", project.id, now);
      if (state.preferences.activeProjectId === project.id) {
        state.preferences.activeProjectId = state.preferences.inboxProjectId;
      }
      return {
        ok: true,
        inverse: {
          type: "project.restoreBundle",
          project: structuredClone(project),
          sections: structuredClone(sections),
          tasks: taskSnapshot,
        },
      };
    }
    case "project.restoreBundle": {
      state.projects[action.project.id] = structuredClone(action.project);
      clearTombstone(state, "projects", action.project.id);
      for (const section of action.sections) {
        state.sections[section.id] = structuredClone(section);
        clearTombstone(state, "sections", section.id);
      }
      for (const task of action.tasks) state.tasks[task.id] = structuredClone(task);
      return { ok: true, inverse: { type: "project.delete", projectId: action.project.id } };
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
    case "order.add": {
      if (!action.input.title.trim()) return invalid("An Order item needs a title.");
      const id = action.input.id ?? createId("order");
      if (state.orderItems[id]) return invalid("That Order item already exists.");
      const relationId = action.input.relationId ?? null;
      if (relationId && !state.orderItems[relationId]) return invalid("The related Order item does not exist.");
      const item: OrderItem = {
        id,
        title: action.input.title.trim(),
        details: action.input.details?.trim() ?? "",
        lane: action.input.lane ?? "now",
        relationId,
        priority: action.input.priority ?? 4,
        status: action.input.status ?? "open",
        order: action.input.order ?? nextOrder(state.orderItems),
        createdAt: now,
        updatedAt: now,
      };
      state.orderItems[id] = item;
      clearTombstone(state, "orderItems", id);
      if (action.input.status === "done") return completeOrderItem(state, item, now);
      return { ok: true, inverse: { type: "order.remove", itemId: id } };
    }
    case "order.update": {
      const item = state.orderItems[action.itemId];
      if (!item) return invalid("The Order item no longer exists.");
      if (action.patch.title !== undefined && !action.patch.title.trim()) return invalid("An Order item needs a title.");
      if (action.patch.relationId && !state.orderItems[action.patch.relationId]) return invalid("The related Order item does not exist.");
      if (action.patch.relationId === item.id) return invalid("An Order item cannot relate to itself.");
      const before = pick(item, action.patch);
      Object.assign(item, action.patch, {
        title: action.patch.title?.trim() ?? item.title,
        details: action.patch.details?.trim() ?? item.details,
        updatedAt: now,
      });
      if (action.patch.status === "done") return completeOrderItem(state, item, now);
      return { ok: true, inverse: { type: "order.update", itemId: item.id, patch: before } };
    }
    case "order.complete":
    case "order.delete": {
      const item = state.orderItems[action.itemId];
      if (!item) return invalid("The Order item no longer exists.");
      return completeOrderItem(state, item, now);
    }
    case "order.remove": {
      const item = state.orderItems[action.itemId];
      if (!item) return invalid("The Order item no longer exists.");
      delete state.orderItems[action.itemId];
      markTombstone(state, "orderItems", action.itemId, now);
      clearOrderRelations(state, item.id);
      return { ok: true, inverse: { type: "order.add", input: structuredClone(item) } };
    }
    case "order.transferToTask": {
      const item = state.orderItems[action.itemId];
      if (!item) return invalid("The Order item no longer exists.");
      const taskResult = createTask(state, action.input, now);
      if (!taskResult.ok) return taskResult;

      state.tasks[taskResult.task.id] = taskResult.task;
      clearTombstone(state, "tasks", taskResult.task.id);
      delete state.orderItems[action.itemId];
      markTombstone(state, "orderItems", action.itemId, now);
      clearOrderRelations(state, action.itemId);
      return {
        ok: true,
        inverse: {
          type: "order.transfer.restore",
          orderItem: structuredClone(item),
          taskId: taskResult.task.id,
        },
      };
    }
    case "order.transfer.restore": {
      const task = state.tasks[action.taskId];
      if (!task) return invalid("The transferred task no longer exists.");
      if (state.orderItems[action.orderItem.id]) return invalid("The original Order item already exists.");

      delete state.tasks[action.taskId];
      markTombstone(state, "tasks", action.taskId, now);
      state.orderItems[action.orderItem.id] = structuredClone(action.orderItem);
      clearTombstone(state, "orderItems", action.orderItem.id);
      return {
        ok: true,
        inverse: {
          type: "order.transfer.restore",
          orderItem: structuredClone(action.orderItem),
          taskId: action.taskId,
        },
      };
    }
    case "note.add": {
      const id = action.input.id ?? createId("note");
      if (state.notes[id]) return invalid("That note already exists.");
      const title = action.input.title?.trim() ?? "";
      const body = action.input.body ?? "";
      if (!title && !body.trim()) return invalid("A note needs a title or body.");
      const note: Note = {
        id,
        title: title || "Untitled note",
        body,
        completedAt: null,
        order: action.input.order ?? nextOrder(state.notes),
        createdAt: now,
        updatedAt: now,
      };
      state.notes[id] = note;
      clearTombstone(state, "notes", id);
      return { ok: true, inverse: { type: "note.remove", noteId: id } };
    }
    case "note.restore":
      state.notes[action.note.id] = structuredClone(action.note);
      clearTombstone(state, "notes", action.note.id);
      return { ok: true, inverse: { type: "note.remove", noteId: action.note.id } };
    case "note.remove":
    case "note.delete": {
      const note = state.notes[action.noteId];
      if (!note) return invalid("The note no longer exists.");
      delete state.notes[action.noteId];
      markTombstone(state, "notes", action.noteId, now);
      return { ok: true, inverse: { type: "note.restore", note: structuredClone(note) } };
    }
    case "note.update": {
      const note = state.notes[action.noteId];
      if (!note) return invalid("The note no longer exists.");
      const before = pick(note, action.patch);
      const nextTitle = action.patch.title === undefined ? note.title : action.patch.title.trim();
      const nextBody = action.patch.body === undefined ? note.body : action.patch.body;
      if (!nextTitle && !nextBody.trim()) return invalid("A note needs a title or body.");
      Object.assign(note, action.patch, {
        title: nextTitle || "Untitled note",
        body: nextBody,
        updatedAt: now,
      });
      return { ok: true, inverse: { type: "note.update", noteId: note.id, patch: before } };
    }
    case "note.complete":
    case "note.uncomplete": {
      const note = state.notes[action.noteId];
      if (!note) return invalid("The note no longer exists.");
      const before = { completedAt: note.completedAt };
      const nextCompletedAt = action.type === "note.complete" ? now : null;
      if (note.completedAt === nextCompletedAt) {
        return { ok: true, changed: false, inverse: { type: "note.update", noteId: note.id, patch: {} } };
      }
      note.completedAt = nextCompletedAt;
      note.updatedAt = now;
      return {
        ok: true,
        inverse: { type: "note.update", noteId: note.id, patch: before },
      };
    }
    case "diary.upsert": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(action.date)) return invalid("Diary entries need a valid date.");
      const before = state.diaryEntries[action.date];
      if (!action.body.trim()) {
        if (!before) return { ok: true, changed: false, inverse: { type: "diary.remove", date: action.date } };
        delete state.diaryEntries[action.date];
        markTombstone(state, "diaryEntries", action.date, now);
        return { ok: true, inverse: { type: "diary.restore", entry: structuredClone(before) } };
      }
      const entry: DiaryEntry = {
        date: action.date,
        body: action.body,
        morning: before?.morning ?? "",
        highlights: before?.highlights ?? "",
        reflection: before?.reflection ?? "",
        tomorrow: before?.tomorrow ?? "",
        updatedAt: now,
      };
      state.diaryEntries[action.date] = entry;
      clearTombstone(state, "diaryEntries", action.date);
      return {
        ok: true,
        inverse: before
          ? { type: "diary.restore", entry: structuredClone(before) }
          : { type: "diary.remove", date: action.date },
      };
    }
    case "diary.restore":
      state.diaryEntries[action.entry.date] = structuredClone(action.entry);
      clearTombstone(state, "diaryEntries", action.entry.date);
      return { ok: true, inverse: { type: "diary.remove", date: action.entry.date } };
    case "diary.update": {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(action.date)) return invalid("Diary entries need a valid date.");
      const before = state.diaryEntries[action.date];
      const next: DiaryEntry = {
        date: action.date,
        body: before?.body ?? "",
        morning: before?.morning ?? "",
        highlights: before?.highlights ?? "",
        reflection: before?.reflection ?? "",
        tomorrow: before?.tomorrow ?? "",
        updatedAt: now,
        ...action.patch,
      };
      const hasContent = [next.body, next.morning, next.highlights, next.reflection, next.tomorrow]
        .some((value) => value.trim());
      if (!hasContent) {
        if (!before) return { ok: true, changed: false, inverse: { type: "diary.update", date: action.date, patch: {} } };
        delete state.diaryEntries[action.date];
        markTombstone(state, "diaryEntries", action.date, now);
        return { ok: true, inverse: { type: "diary.restore", entry: structuredClone(before) } };
      }
      state.diaryEntries[action.date] = next;
      clearTombstone(state, "diaryEntries", action.date);
      return {
        ok: true,
        inverse: before
          ? { type: "diary.restore", entry: structuredClone(before) }
          : { type: "diary.remove", date: action.date },
      };
    }
    case "diary.remove": {
      const entry = state.diaryEntries[action.date];
      if (!entry) return invalid("The diary entry no longer exists.");
      delete state.diaryEntries[action.date];
      markTombstone(state, "diaryEntries", action.date, now);
      return { ok: true, inverse: { type: "diary.restore", entry: structuredClone(entry) } };
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
      clearTombstone(state, "sections", id);
      return { ok: true, inverse: { type: "section.remove", sectionId: id } };
    }
    case "section.restore":
      state.sections[action.section.id] = structuredClone(action.section);
      clearTombstone(state, "sections", action.section.id);
      return { ok: true, inverse: { type: "section.remove", sectionId: action.section.id } };
    case "section.remove": {
      const section = state.sections[action.sectionId];
      if (!section) return invalid("The section no longer exists.");
      delete state.sections[action.sectionId];
      markTombstone(state, "sections", action.sectionId, now);
      return { ok: true, inverse: { type: "section.restore", section: structuredClone(section) } };
    }
    case "section.update": {
      const section = state.sections[action.sectionId];
      if (!section) return invalid("The section no longer exists.");
      const before = pick(section, action.patch);
      Object.assign(section, action.patch, { updatedAt: now });
      return { ok: true, inverse: { type: "section.update", sectionId: section.id, patch: before } };
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
      clearTombstone(state, "filters", id);
      return { ok: true, inverse: { type: "filter.remove", filterId: id } };
    }
    case "filter.restore":
      state.filters[action.filter.id] = structuredClone(action.filter);
      clearTombstone(state, "filters", action.filter.id);
      return { ok: true, inverse: { type: "filter.remove", filterId: action.filter.id } };
    case "filter.remove": {
      const filter = state.filters[action.filterId];
      if (!filter) return invalid("The filter no longer exists.");
      delete state.filters[action.filterId];
      markTombstone(state, "filters", action.filterId, now);
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

function createTask(
  state: AppState,
  input: TaskInput,
  now: string,
): { ok: true; task: Task } | InvalidResult {
  if (!input.content.trim()) return invalid("A task needs a name.");
  const id = input.id ?? createId("task");
  if (state.tasks[id]) return invalid("That task already exists.");
  const task: Task = {
    id,
    content: input.content.trim(),
    description: input.description ?? "",
    projectId: input.projectId ?? state.preferences.inboxProjectId,
    sectionId: input.sectionId ?? null,
    parentId: input.parentId ?? null,
    priority: input.priority ?? 4,
    due: input.due ?? null,
    completedAt: null,
    completionContext: null,
    order: input.order ?? nextOrder(state.tasks),
    createdAt: now,
    updatedAt: now,
  };
  if (!isValidTaskLocation(state, task.projectId, task.sectionId)) {
    return invalid("The task section does not belong to its project.");
  }
  return { ok: true, task };
}

function createOrderItem(
  state: AppState,
  input: OrderItemInput,
  now: string,
): { ok: true; item: OrderItem } | InvalidResult {
  if (!input.title.trim()) return invalid("An Order item needs a title.");
  const id = input.id ?? createId("order");
  if (state.orderItems[id]) return invalid("That Order item already exists.");
  const relationId = input.relationId ?? null;
  if (relationId && !state.orderItems[relationId]) {
    return invalid("The related Order item does not exist.");
  }
  const item: OrderItem = {
    id,
    title: input.title.trim(),
    details: input.details?.trim() ?? "",
    lane: input.lane ?? "now",
    relationId,
    priority: input.priority ?? 4,
    status: input.status ?? "open",
    order: input.order ?? nextOrder(state.orderItems),
    createdAt: now,
    updatedAt: now,
  };
  return { ok: true, item };
}

function clearOrderRelations(state: AppState, itemId: string): void {
  Object.values(state.orderItems).forEach((candidate) => {
    if (candidate.relationId === itemId) candidate.relationId = null;
  });
}

function completeOrderItem(state: AppState, item: OrderItem, now: string): MutationResult {
  const taskResult = createTask(state, {
    content: item.title,
    description: item.details,
    projectId: state.preferences.inboxProjectId,
    sectionId: null,
    priority: item.priority,
  }, now);
  if (!taskResult.ok) return taskResult;

  taskResult.task.completedAt = now;
  taskResult.task.completionContext = {
    projectId: taskResult.task.projectId,
    sectionId: taskResult.task.sectionId,
    order: taskResult.task.order,
  };
  state.tasks[taskResult.task.id] = taskResult.task;
  clearTombstone(state, "tasks", taskResult.task.id);
  delete state.orderItems[item.id];
  markTombstone(state, "orderItems", item.id, now);
  clearOrderRelations(state, item.id);
  return {
    ok: true,
    inverse: {
      type: "order.transfer.restore",
      orderItem: {
        ...structuredClone(item),
        status: item.status === "done" ? "open" : item.status,
      },
      taskId: taskResult.task.id,
    },
  };
}

function createUndoEntry(inverse: UndoAction, createdAt: string): UndoEntry {
  return { id: createId("undo"), label: inverse.type, inverse, createdAt };
}

function markTombstone(state: AppState, collection: string, id: string, deletedAt: string): void {
  state.syncTombstones ??= {};
  const key = `${collection}:${id}`;
  const current = state.syncTombstones[key];
  if (!current || deletedAt >= current.deletedAt) state.syncTombstones[key] = { deletedAt };
}

function clearTombstone(state: AppState, collection: string, id: string): void {
  if (!state.syncTombstones) return;
  delete state.syncTombstones[`${collection}:${id}`];
}

function isValidTaskLocation(state: AppState, projectId: string, sectionId: string | null): boolean {
  return Boolean(state.projects[projectId]) && (!sectionId || state.sections[sectionId]?.projectId === projectId);
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

function placeTaskAtOrder(
  state: AppState,
  task: Task,
  sectionId: string | null,
  requestedOrder: number,
  now: string,
) {
  const siblings = Object.values(state.tasks)
    .filter(
      (candidate) =>
        candidate.id !== task.id &&
        candidate.projectId === task.projectId &&
        candidate.completedAt === null &&
        (candidate.sectionId ?? null) === (sectionId ?? null),
    )
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const targetIndex = Math.min(Math.max(Math.floor(requestedOrder), 0), siblings.length);
  siblings.splice(targetIndex, 0, task);
  for (const [index, sibling] of siblings.entries()) {
    sibling.sectionId = sectionId;
    sibling.order = index;
    sibling.updatedAt = now;
  }
}
