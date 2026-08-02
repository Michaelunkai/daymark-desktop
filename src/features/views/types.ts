import type { ProjectLabel, ProjectLayout, ProjectSection, ProjectTask } from "../projects/types";

export interface TaskViewProps {
  mode: ProjectLayout;
  sections: readonly ProjectSection[];
  tasks: readonly ProjectTask[];
  labels?: readonly ProjectLabel[];
  showCompleted?: boolean;
  onChangeLayout?: (layout: ProjectLayout) => void;
  onTaskOpen?: (taskId: string) => void;
  onTaskComplete?: (taskId: string, nextValue: boolean) => void;
  onTaskMove?: (taskId: string, sectionId: string | null, order: number) => void;
  onTaskMenu?: (taskId: string) => void;
  onTaskToggleExpanded?: (taskId: string, nextValue: boolean) => void;
  onSectionToggle?: (sectionId: string, nextValue: boolean) => void;
  onSectionCreate?: () => void;
  onSectionRename?: (sectionId: string, nextName: string) => void;
  onSectionAddTask?: (sectionId: string) => void;
  emptyMessage?: string;
}

export interface TaskListViewProps extends Omit<TaskViewProps, "mode" | "onChangeLayout"> {}

export interface TaskBoardViewProps extends Omit<TaskViewProps, "mode" | "onChangeLayout"> {}

export interface TaskRowProps {
  task: ProjectTask;
  labels?: readonly ProjectLabel[];
  onTaskOpen?: (taskId: string) => void;
  onTaskComplete?: (taskId: string, nextValue: boolean) => void;
  onTaskMove?: (taskId: string, sectionId: string | null, order: number) => void;
  onTaskMenu?: (taskId: string) => void;
  onTaskToggleExpanded?: (taskId: string, nextValue: boolean) => void;
}
