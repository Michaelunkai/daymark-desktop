export const CURRENT_SCHEMA_VERSION = 2 as const;

export type EntityId = string;
export type Priority = 1 | 2 | 3 | 4;
export type ViewLayout = "list" | "board";

export interface Project {
  id: EntityId;
  name: string;
  description: string;
  color: string;
  parentId: EntityId | null;
  layout: ViewLayout;
  order: number;
  isFavorite: boolean;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Section {
  id: EntityId;
  projectId: EntityId;
  name: string;
  order: number;
  isCollapsed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Label {
  id: EntityId;
  name: string;
  color: string;
  order: number;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SavedFilter {
  id: EntityId;
  name: string;
  color: string;
  query: string;
  order: number;
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TaskDue {
  date: string;
  time: string | null;
  timezone: string | null;
  recurrence: string | null;
}

export interface Task {
  id: EntityId;
  content: string;
  description: string;
  projectId: EntityId;
  sectionId: EntityId | null;
  parentId: EntityId | null;
  labelIds: EntityId[];
  priority: Priority;
  due: TaskDue | null;
  completedAt: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppPreferences {
  inboxProjectId: EntityId;
  activeProjectId: EntityId | null;
  onboardingDismissed: boolean;
  theme: "system" | "light" | "dark";
  showCompleted: boolean;
}

export interface UndoEntry {
  id: EntityId;
  label: string;
  inverse: UndoAction;
  createdAt: string;
}

export interface AppState {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  revision: number;
  clientId: EntityId;
  updatedAt: string;
  projects: Record<EntityId, Project>;
  sections: Record<EntityId, Section>;
  labels: Record<EntityId, Label>;
  filters: Record<EntityId, SavedFilter>;
  tasks: Record<EntityId, Task>;
  preferences: AppPreferences;
  undoStack: UndoEntry[];
}

export type TaskInput = {
  id?: EntityId;
  content: string;
  description?: string;
  projectId?: EntityId;
  sectionId?: EntityId | null;
  parentId?: EntityId | null;
  labelIds?: EntityId[];
  priority?: Priority;
  due?: TaskDue | null;
  order?: number;
};

export type TaskPatch = Partial<
  Pick<
    Task,
    | "content"
    | "description"
    | "projectId"
    | "sectionId"
    | "parentId"
    | "labelIds"
    | "priority"
    | "due"
    | "completedAt"
    | "order"
  >
>;

export type ProjectInput = {
  id?: EntityId;
  name: string;
  description?: string;
  color?: string;
  parentId?: EntityId | null;
  layout?: ViewLayout;
  order?: number;
  isFavorite?: boolean;
};

export type SectionInput = {
  id?: EntityId;
  projectId: EntityId;
  name: string;
  order?: number;
  isCollapsed?: boolean;
};

export type LabelInput = {
  id?: EntityId;
  name: string;
  color?: string;
  order?: number;
  isFavorite?: boolean;
};

export type FilterInput = {
  id?: EntityId;
  name: string;
  color?: string;
  query: string;
  order?: number;
  isFavorite?: boolean;
};

export type UserAction =
  | { type: "task.add"; input: TaskInput }
  | { type: "task.update"; taskId: EntityId; patch: TaskPatch }
  | { type: "task.complete"; taskId: EntityId }
  | { type: "task.uncomplete"; taskId: EntityId }
  | { type: "task.delete"; taskId: EntityId }
  | { type: "project.add"; input: ProjectInput }
  | { type: "project.update"; projectId: EntityId; patch: Partial<Omit<Project, "id" | "createdAt" | "updatedAt">> }
  | { type: "project.archive"; projectId: EntityId; archived: boolean }
  | { type: "section.add"; input: SectionInput }
  | { type: "section.update"; sectionId: EntityId; patch: Partial<Pick<Section, "name" | "order" | "isCollapsed">> }
  | { type: "label.add"; input: LabelInput }
  | { type: "label.update"; labelId: EntityId; patch: Partial<Pick<Label, "name" | "color" | "order" | "isFavorite">> }
  | { type: "filter.add"; input: FilterInput }
  | { type: "filter.update"; filterId: EntityId; patch: Partial<Pick<SavedFilter, "name" | "color" | "query" | "order" | "isFavorite">> }
  | { type: "preferences.update"; patch: Partial<AppPreferences> }
  | { type: "undo" };

export type UndoAction =
  | { type: "task.restore"; task: Task }
  | { type: "task.remove"; taskId: EntityId }
  | { type: "task.update"; taskId: EntityId; patch: TaskPatch }
  | { type: "project.restore"; project: Project }
  | { type: "project.remove"; projectId: EntityId }
  | { type: "project.update"; projectId: EntityId; patch: Partial<Omit<Project, "id" | "createdAt" | "updatedAt">> }
  | { type: "section.restore"; section: Section }
  | { type: "section.remove"; sectionId: EntityId }
  | { type: "section.update"; sectionId: EntityId; patch: Partial<Pick<Section, "name" | "order" | "isCollapsed">> }
  | { type: "label.restore"; label: Label }
  | { type: "label.remove"; labelId: EntityId }
  | { type: "label.update"; labelId: EntityId; patch: Partial<Pick<Label, "name" | "color" | "order" | "isFavorite">> }
  | { type: "filter.restore"; filter: SavedFilter }
  | { type: "filter.remove"; filterId: EntityId }
  | { type: "filter.update"; filterId: EntityId; patch: Partial<Pick<SavedFilter, "name" | "color" | "query" | "order" | "isFavorite">> }
  | { type: "preferences.update"; patch: Partial<AppPreferences> };

export type StoreAction = UserAction | UndoAction;

export type DispatchResult =
  | { ok: true; state: AppState }
  | { ok: false; reason: "conflict" | "invalid"; message: string; state?: AppState };

export interface StateStorage {
  read(): string | null;
  write(value: string): void;
  remove?(): void;
}
