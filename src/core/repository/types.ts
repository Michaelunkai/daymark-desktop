import type {
  AppPreferences,
  AppState,
  DispatchResult,
  EntityId,
  FilterInput,
  Label,
  LabelInput,
  Project,
  ProjectInput,
  SavedFilter,
  Section,
  SectionInput,
  TaskInput,
  TaskPatch,
  UserAction,
} from "../types";

export type ProjectPatch = Partial<Omit<Project, "id" | "createdAt" | "updatedAt">>;
export type SectionPatch = Partial<Pick<Section, "name" | "order" | "isCollapsed">>;
export type LabelPatch = Partial<Pick<Label, "name" | "color" | "order" | "isFavorite">>;
export type FilterPatch = Partial<Pick<SavedFilter, "name" | "color" | "query" | "order" | "isFavorite">>;
export type RepositoryListener = (state: AppState) => void;

export interface DaymarkRepository {
  getState(): AppState;
  reload(): AppState;
  subscribe(listener: RepositoryListener): () => void;
  dispatch(action: UserAction): DispatchResult;

  addTask(input: TaskInput): DispatchResult;
  updateTask(taskId: EntityId, patch: TaskPatch): DispatchResult;
  completeTask(taskId: EntityId): DispatchResult;
  uncompleteTask(taskId: EntityId): DispatchResult;
  deleteTask(taskId: EntityId): DispatchResult;

  addProject(input: ProjectInput): DispatchResult;
  updateProject(projectId: EntityId, patch: ProjectPatch): DispatchResult;
  archiveProject(projectId: EntityId, archived: boolean): DispatchResult;

  addSection(input: SectionInput): DispatchResult;
  updateSection(sectionId: EntityId, patch: SectionPatch): DispatchResult;

  addLabel(input: LabelInput): DispatchResult;
  updateLabel(labelId: EntityId, patch: LabelPatch): DispatchResult;

  addFilter(input: FilterInput): DispatchResult;
  updateFilter(filterId: EntityId, patch: FilterPatch): DispatchResult;

  updatePreferences(patch: Partial<AppPreferences>): DispatchResult;
  undo(): DispatchResult;
}
