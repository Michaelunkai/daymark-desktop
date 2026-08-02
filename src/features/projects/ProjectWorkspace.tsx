import { ProjectHeader } from "./ProjectHeader";
import type { Project } from "./types";
import { TaskView } from "../views/TaskView";
import type { TaskViewProps } from "../views/types";

export interface ProjectWorkspaceProps extends TaskViewProps {
  project: Project;
  onToggleFavorite?: (projectId: string, nextValue: boolean) => void;
}

export function ProjectWorkspace({ project, onToggleFavorite, ...viewProps }: ProjectWorkspaceProps) {
  return (
    <main className="project-workspace">
      <ProjectHeader
        project={project}
        onAddSection={viewProps.onSectionCreate}
        onToggleFavorite={onToggleFavorite}
      />
      <TaskView {...viewProps} />
    </main>
  );
}
