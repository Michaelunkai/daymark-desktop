import type { BulkTaskLocation, EntityId, TaskDue, UserAction } from "./types";

export function uniqueTaskIds(taskIds: readonly EntityId[]): EntityId[] {
  return [...new Set(taskIds.filter(Boolean))];
}

export function bulkComplete(taskIds: readonly EntityId[], completed = true): UserAction {
  return { type: "task.bulk.complete", taskIds: uniqueTaskIds(taskIds), completed };
}

export function bulkMove(taskIds: readonly EntityId[], location: BulkTaskLocation): UserAction {
  return {
    type: "task.bulk.move",
    taskIds: uniqueTaskIds(taskIds),
    location: { ...location, sectionId: location.sectionId ?? null },
  };
}

export function bulkReschedule(taskIds: readonly EntityId[], due: TaskDue | null): UserAction {
  return {
    type: "task.bulk.reschedule",
    taskIds: uniqueTaskIds(taskIds),
    due: due ? { ...due } : null,
  };
}
