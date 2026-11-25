import type {
  Label as CoreLabel,
  Priority,
  Project as CoreProject,
  Section as CoreSection,
  Task as CoreTask,
  ViewLayout,
} from "../../core/types";

export type ProjectLayout = ViewLayout;

export type TaskPriority = Priority;

export type DueTone =
  | "overdue"
  | "today"
  | "tomorrow"
  | "upcoming"
  | "neutral";

export type Project = CoreProject;

export type ProjectSection = CoreSection;

export interface ProjectTask extends CoreTask {
  dueLabel?: string;
  dueTone?: DueTone;
  depth?: number;
  hasChildren?: boolean;
  isExpanded?: boolean;
}

export type ProjectLabel = CoreLabel;

export interface ProjectHeaderProps {
  project: Project;
  onToggleFavorite?: (projectId: string, nextValue: boolean) => void;
  onAddSection?: () => void;
}

export interface ProjectSectionHeaderProps {
  section: ProjectSection;
  taskCount: number;
  layout?: ProjectLayout;
  onToggleCollapsed?: (sectionId: string, nextValue: boolean) => void;
  onRename?: (sectionId: string, nextName: string) => void;
  onAddTask?: (sectionId: string) => void;
}
