export const CURRENT_SCHEMA_VERSION = 5 as const;

export type EntityId = string;
export type Priority = 1 | 2 | 3 | 4;
export type ViewLayout = "list" | "board";
export type OrderLane = "now" | "later" | "after" | "before";
export type OrderStatus = "open" | "done" | "blocked";

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

export interface TaskCompletionContext {
  projectId: EntityId;
  sectionId: EntityId | null;
  order: number;
}

export interface Task {
  id: EntityId;
  content: string;
  description: string;
  projectId: EntityId;
  sectionId: EntityId | null;
  parentId: EntityId | null;
  priority: Priority;
  due: TaskDue | null;
  completedAt: string | null;
  completionContext: TaskCompletionContext | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface OrderItem {
  id: EntityId;
  title: string;
  details: string;
  lane: OrderLane;
  relationId: EntityId | null;
  priority: Priority;
  status: OrderStatus;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface Note {
  id: EntityId;
  title: string;
  body: string;
  completedAt: string | null;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface DiaryEntry {
  date: string;
  body: string;
  morning: string;
  highlights: string;
  reflection: string;
  tomorrow: string;
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

export interface SyncTombstone {
  deletedAt: string;
}

export interface AppState {
  schemaVersion: typeof CURRENT_SCHEMA_VERSION;
  revision: number;
  clientId: EntityId;
  updatedAt: string;
  projects: Record<EntityId, Project>;
  sections: Record<EntityId, Section>;
  filters: Record<EntityId, SavedFilter>;
  tasks: Record<EntityId, Task>;
  orderItems: Record<EntityId, OrderItem>;
  notes: Record<EntityId, Note>;
  diaryEntries: Record<string, DiaryEntry>;
  preferences: AppPreferences;
  undoStack: UndoEntry[];
  syncTombstones?: Record<string, SyncTombstone>;
}

export type TaskInput = {
  id?: EntityId;
  content: string;
  description?: string;
  projectId?: EntityId;
  sectionId?: EntityId | null;
  parentId?: EntityId | null;
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
    | "priority"
    | "due"
    | "completedAt"
    | "completionContext"
    | "order"
  >
>;

export type TaskReorderInput = {
  taskId: EntityId;
  sectionId: EntityId | null;
  order: number;
};

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

export type OrderItemInput = {
  id?: EntityId;
  title: string;
  details?: string;
  lane?: OrderLane;
  relationId?: EntityId | null;
  priority?: Priority;
  status?: OrderStatus;
  order?: number;
};

export type OrderItemPatch = Partial<
  Pick<OrderItem, "title" | "details" | "lane" | "relationId" | "priority" | "status" | "order">
>;

export type NoteInput = {
  id?: EntityId;
  title?: string;
  body?: string;
  order?: number;
};

export type NotePatch = Partial<Pick<Note, "title" | "body" | "completedAt" | "order">>;

export type DiaryPatch = Partial<
  Pick<DiaryEntry, "body" | "morning" | "highlights" | "reflection" | "tomorrow">
>;

export type SectionInput = {
  id?: EntityId;
  projectId: EntityId;
  name: string;
  order?: number;
  isCollapsed?: boolean;
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
  | { type: "task.reorder"; input: TaskReorderInput }
  | { type: "task.delete"; taskId: EntityId }
  | { type: "task.transferToOrder"; taskId: EntityId; input: OrderItemInput }
  | { type: "project.add"; input: ProjectInput }
  | { type: "project.update"; projectId: EntityId; patch: Partial<Omit<Project, "id" | "createdAt" | "updatedAt">> }
  | { type: "project.archive"; projectId: EntityId; archived: boolean }
  | { type: "project.delete"; projectId: EntityId }
  | { type: "order.add"; input: OrderItemInput }
  | { type: "order.update"; itemId: EntityId; patch: OrderItemPatch }
  | { type: "order.complete"; itemId: EntityId }
  | { type: "order.delete"; itemId: EntityId }
  | { type: "order.transferToTask"; itemId: EntityId; input: TaskInput }
  | { type: "note.add"; input: NoteInput }
  | { type: "note.update"; noteId: EntityId; patch: NotePatch }
  | { type: "note.complete"; noteId: EntityId }
  | { type: "note.uncomplete"; noteId: EntityId }
  | { type: "note.delete"; noteId: EntityId }
  | { type: "diary.upsert"; date: string; body: string }
  | { type: "diary.update"; date: string; patch: DiaryPatch }
  | { type: "section.add"; input: SectionInput }
  | { type: "section.update"; sectionId: EntityId; patch: Partial<Pick<Section, "name" | "order" | "isCollapsed">> }
  | { type: "filter.add"; input: FilterInput }
  | { type: "filter.update"; filterId: EntityId; patch: Partial<Pick<SavedFilter, "name" | "color" | "query" | "order" | "isFavorite">> }
  | { type: "preferences.update"; patch: Partial<AppPreferences> }
  | { type: "undo" };

export type UndoAction =
  | { type: "task.restore"; task: Task }
  | { type: "task.remove"; taskId: EntityId }
  | { type: "task.update"; taskId: EntityId; patch: TaskPatch }
  | { type: "task.transfer.restore"; task: Task; orderItemId: EntityId }
  | { type: "project.restore"; project: Project }
  | { type: "project.remove"; projectId: EntityId }
  | { type: "project.update"; projectId: EntityId; patch: Partial<Omit<Project, "id" | "createdAt" | "updatedAt">> }
  | {
      type: "project.restoreBundle";
      project: Project;
      sections: Section[];
      tasks: Task[];
    }
  | { type: "project.delete"; projectId: EntityId }
  | { type: "order.add"; input: OrderItemInput }
  | { type: "order.update"; itemId: EntityId; patch: OrderItemPatch }
  | { type: "order.remove"; itemId: EntityId }
  | { type: "order.delete"; itemId: EntityId }
  | { type: "order.transfer.restore"; orderItem: OrderItem; taskId: EntityId }
  | { type: "note.restore"; note: Note }
  | { type: "note.remove"; noteId: EntityId }
  | { type: "note.update"; noteId: EntityId; patch: NotePatch }
  | { type: "note.complete"; noteId: EntityId }
  | { type: "note.uncomplete"; noteId: EntityId }
  | { type: "diary.restore"; entry: DiaryEntry }
  | { type: "diary.update"; date: string; patch: DiaryPatch }
  | { type: "diary.remove"; date: string }
  | { type: "section.restore"; section: Section }
  | { type: "section.remove"; sectionId: EntityId }
  | { type: "section.update"; sectionId: EntityId; patch: Partial<Pick<Section, "name" | "order" | "isCollapsed">> }
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
  isAvailable?(): boolean;
}
