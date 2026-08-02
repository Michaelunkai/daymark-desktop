import type { AppStore } from "../store";
import type {
  AppPreferences,
  DispatchResult,
  EntityId,
  FilterInput,
  LabelInput,
  ProjectInput,
  SectionInput,
  TaskInput,
  TaskPatch,
  UserAction,
} from "../types";
import type {
  DaymarkRepository,
  FilterPatch,
  LabelPatch,
  ProjectPatch,
  SectionPatch,
} from "./types";

export function createLocalRepository(store: AppStore): DaymarkRepository {
  const dispatch = (action: UserAction): DispatchResult => store.dispatch(action);

  return {
    getState: () => store.getState(),
    reload: () => store.reload(),
    subscribe: (listener) => store.subscribe(listener),
    dispatch,

    addTask: (input: TaskInput) => dispatch({ type: "task.add", input }),
    updateTask: (taskId: EntityId, patch: TaskPatch) => dispatch({ type: "task.update", taskId, patch }),
    completeTask: (taskId: EntityId) => dispatch({ type: "task.complete", taskId }),
    uncompleteTask: (taskId: EntityId) => dispatch({ type: "task.uncomplete", taskId }),
    duplicateTask: (taskId: EntityId, includeSubtasks = true) =>
      dispatch({ type: "task.duplicate", taskId, includeSubtasks }),
    deleteTask: (taskId: EntityId) => dispatch({ type: "task.delete", taskId }),
    bulkComplete: (taskIds: EntityId[], completed = true) =>
      dispatch({ type: "task.bulk.complete", taskIds, completed }),
    bulkMove: (taskIds, location) => dispatch({ type: "task.bulk.move", taskIds, location }),
    bulkReschedule: (taskIds, due) => dispatch({ type: "task.bulk.reschedule", taskIds, due }),

    addProject: (input: ProjectInput) => dispatch({ type: "project.add", input }),
    updateProject: (projectId: EntityId, patch: ProjectPatch) => dispatch({ type: "project.update", projectId, patch }),
    archiveProject: (projectId: EntityId, archived: boolean) => dispatch({ type: "project.archive", projectId, archived }),
    deleteProject: (projectId: EntityId) => dispatch({ type: "project.delete", projectId }),

    addSection: (input: SectionInput) => dispatch({ type: "section.add", input }),
    updateSection: (sectionId: EntityId, patch: SectionPatch) => dispatch({ type: "section.update", sectionId, patch }),
    deleteSection: (sectionId: EntityId) => dispatch({ type: "section.delete", sectionId }),

    addLabel: (input: LabelInput) => dispatch({ type: "label.add", input }),
    updateLabel: (labelId: EntityId, patch: LabelPatch) => dispatch({ type: "label.update", labelId, patch }),

    addFilter: (input: FilterInput) => dispatch({ type: "filter.add", input }),
    updateFilter: (filterId: EntityId, patch: FilterPatch) => dispatch({ type: "filter.update", filterId, patch }),

    updatePreferences: (patch: Partial<AppPreferences>) => dispatch({ type: "preferences.update", patch }),
    undo: () => dispatch({ type: "undo" }),
  };
}
