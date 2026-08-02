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
    deleteTask: (taskId: EntityId) => dispatch({ type: "task.delete", taskId }),

    addProject: (input: ProjectInput) => dispatch({ type: "project.add", input }),
    updateProject: (projectId: EntityId, patch: ProjectPatch) => dispatch({ type: "project.update", projectId, patch }),
    archiveProject: (projectId: EntityId, archived: boolean) => dispatch({ type: "project.archive", projectId, archived }),

    addSection: (input: SectionInput) => dispatch({ type: "section.add", input }),
    updateSection: (sectionId: EntityId, patch: SectionPatch) => dispatch({ type: "section.update", sectionId, patch }),

    addLabel: (input: LabelInput) => dispatch({ type: "label.add", input }),
    updateLabel: (labelId: EntityId, patch: LabelPatch) => dispatch({ type: "label.update", labelId, patch }),

    addFilter: (input: FilterInput) => dispatch({ type: "filter.add", input }),
    updateFilter: (filterId: EntityId, patch: FilterPatch) => dispatch({ type: "filter.update", filterId, patch }),

    updatePreferences: (patch: Partial<AppPreferences>) => dispatch({ type: "preferences.update", patch }),
    undo: () => dispatch({ type: "undo" }),
  };
}
