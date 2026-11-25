import { ProjectSectionHeader } from "../projects/ProjectSectionHeader";
import { groupTasksBySection } from "./model";
import { TaskRow } from "./TaskRow";
import type { TaskListViewProps } from "./types";

export function TaskListView({
  sections,
  tasks,
  labels,
  showCompleted = true,
  onTaskOpen,
  onTaskComplete,
  onTaskMove,
  onTaskMenu,
  onTaskToggleExpanded,
  onSectionToggle,
  onSectionCreate,
  onSectionRename,
  onSectionAddTask,
  emptyMessage = "This project is ready for its first task.",
}: TaskListViewProps) {
  const { buckets, unsectioned } = groupTasksBySection(sections, tasks, showCompleted);
  const hasVisibleTasks = buckets.some((bucket) => bucket.tasks.length > 0) || unsectioned.length > 0;

  return (
    <section aria-label="Task list" className="task-list-view">
      {buckets.map(({ section, tasks: sectionTasks }) => {
        const isCollapsed = Boolean(section.isCollapsed);
        return (
          <section className="task-list-section" key={section.id}>
            <ProjectSectionHeader
              layout="list"
              section={section}
              taskCount={sectionTasks.length}
              onAddTask={onSectionAddTask}
              onRename={onSectionRename}
              onToggleCollapsed={onSectionToggle}
            />
            {!isCollapsed ? (
              <ol className="task-row-list">
                {sectionTasks.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    labels={labels}
                    onTaskComplete={onTaskComplete}
                    onTaskMenu={onTaskMenu}
                    onTaskMove={onTaskMove}
                    onTaskOpen={onTaskOpen}
                    onTaskToggleExpanded={onTaskToggleExpanded}
                  />
                ))}
              </ol>
            ) : null}
          </section>
        );
      })}

      {unsectioned.length > 0 ? (
        <section className="task-list-section task-list-section--unsectioned">
          <div className="task-list-unsectioned-heading">Unsectioned</div>
          <ol className="task-row-list">
            {unsectioned.map((task) => (
              <TaskRow
                key={task.id}
                task={task}
                labels={labels}
                onTaskComplete={onTaskComplete}
                onTaskMenu={onTaskMenu}
                onTaskMove={onTaskMove}
                onTaskOpen={onTaskOpen}
                onTaskToggleExpanded={onTaskToggleExpanded}
              />
            ))}
          </ol>
        </section>
      ) : null}

      {!hasVisibleTasks ? (
        <div className="task-view-empty">
          <div className="task-view-empty-mark" aria-hidden="true">
            +
          </div>
          <p>{emptyMessage}</p>
          {onSectionCreate ? (
            <button className="task-view-empty-action" type="button" onClick={onSectionCreate}>
              Add a section
            </button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
