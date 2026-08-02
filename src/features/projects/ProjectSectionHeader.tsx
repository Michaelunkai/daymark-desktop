import { ChevronIcon, PlusIcon } from "./icons";
import type { ProjectSectionHeaderProps } from "./types";

export function ProjectSectionHeader({
  section,
  taskCount,
  layout = "list",
  onToggleCollapsed,
  onRename,
  onAddTask,
}: ProjectSectionHeaderProps) {
  const canCollapse = layout === "list" && Boolean(onToggleCollapsed);
  const isCollapsed = Boolean(section.isCollapsed);

  return (
    <div className={`project-section-header project-section-header--${layout}`}>
      <div className="project-section-heading">
        {canCollapse ? (
          <button
            aria-expanded={!isCollapsed}
            aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${section.name} section`}
            className="project-section-disclosure"
            title={isCollapsed ? "Expand section" : "Collapse section"}
            type="button"
            onClick={() => onToggleCollapsed?.(section.id, !isCollapsed)}
          >
            <ChevronIcon direction={isCollapsed ? "right" : "down"} />
          </button>
        ) : null}
        <span className="project-section-name">{section.name}</span>
        <span className="project-section-count">{taskCount}</span>
      </div>

      <div className="project-section-actions">
        {onRename ? (
          <button
            aria-label={`Rename ${section.name} section`}
            className="project-section-action"
            title="Rename section"
            type="button"
            onClick={() => onRename(section.id, section.name)}
          >
            Rename
          </button>
        ) : null}
        {onAddTask ? (
          <button
            aria-label={`Add task to ${section.name}`}
            className="project-section-add"
            title="Add task to section"
            type="button"
            onClick={() => onAddTask(section.id)}
          >
            <PlusIcon />
            <span className="visually-hidden">Add task</span>
          </button>
        ) : null}
      </div>
    </div>
  );
}
