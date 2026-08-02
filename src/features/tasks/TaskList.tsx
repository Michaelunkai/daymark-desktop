import type { ReactNode } from 'react';

import { TaskRow, type TaskRowLabel, type TaskRowProps, type TaskRowTask } from './TaskRow';
import './task-list.css';

export interface TaskListSection {
  id: string;
  title?: string;
  name?: string;
  tasks: readonly TaskRowTask[];
  isCollapsed?: boolean;
}

export interface TaskListProps {
  sections: readonly TaskListSection[];
  ariaLabel?: string;
  idPrefix?: string;
  density?: 'comfortable' | 'compact';
  emptyState?: ReactNode;
  labels?: readonly TaskRowLabel[];
  onSectionToggle?: (sectionId: string, expanded: boolean) => void;
  onAddTask?: (sectionId: string) => void;
  onTaskComplete?: (taskId: string, nextCompleted: boolean) => void;
  onTaskOpen?: (taskId: string) => void;
  onTaskToggleExpand?: (taskId: string, expanded: boolean) => void;
  onTaskMenu?: (taskId: string) => void;
  onTaskReorderStart?: (taskId: string) => void;
}

function PlusIcon() {
  return (
    <svg aria-hidden="true" className="task-list__icon" viewBox="0 0 20 20">
      <path d="M10 4v12M4 10h12" />
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg aria-hidden="true" className="task-list__icon" viewBox="0 0 20 20">
      <path d={expanded ? 'm5.5 7.5 4.5 4.5 4.5-4.5' : 'm7.5 5.5 4.5 4.5-4.5 4.5'} />
    </svg>
  );
}

export function TaskList({
  sections,
  ariaLabel = 'Tasks',
  idPrefix = 'task-list',
  density = 'compact',
  emptyState,
  labels = [],
  onSectionToggle,
  onAddTask,
  onTaskComplete,
  onTaskOpen,
  onTaskToggleExpand,
  onTaskMenu,
  onTaskReorderStart,
}: TaskListProps) {
  if (sections.length === 0) {
    return (
      <div aria-label={ariaLabel} className="task-list" data-density={density} role="region">
        <div className="task-list__empty">{emptyState ?? <p>No task groups yet.</p>}</div>
      </div>
    );
  }

  return (
    <div aria-label={ariaLabel} className="task-list" data-density={density} role="region">
      {sections.map((section) => {
        const isExpanded = !section.isCollapsed;
        const sectionTitle = section.title ?? section.name ?? 'Untitled section';
        const headingId = `${idPrefix}-section-${section.id}`;
        const taskListId = `${idPrefix}-items-${section.id}`;

        return (
          <section aria-labelledby={headingId} className="task-list__section" key={section.id}>
            <header className="task-list__section-header">
              <div className="task-list__section-heading-group">
                {onSectionToggle ? (
                  <button
                    aria-controls={taskListId}
                    aria-expanded={isExpanded}
                    aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${sectionTitle}`}
                    className="task-list__icon-button"
                    data-tooltip={isExpanded ? 'Collapse section' : 'Expand section'}
                    onClick={() => onSectionToggle(section.id, !isExpanded)}
                    type="button"
                  >
                    <ChevronIcon expanded={isExpanded} />
                  </button>
                ) : null}
                <h2 className="task-list__section-heading" id={headingId}>
                  {sectionTitle}
                </h2>
                <span aria-label={`${section.tasks.length} tasks`} className="task-list__section-count">
                  {section.tasks.length}
                </span>
              </div>

              {onAddTask ? (
                <button
                  aria-label={`Add task to ${sectionTitle}`}
                  className="task-list__icon-button task-list__section-add"
                  data-tooltip="Add task"
                  onClick={() => onAddTask(section.id)}
                  type="button"
                >
                  <PlusIcon />
                </button>
              ) : null}
            </header>

            <ol className="task-list__items" hidden={!isExpanded} id={taskListId}>
              {section.tasks.map((task) => (
                <TaskRow
                  key={task.id}
                  labels={labels}
                  onComplete={onTaskComplete}
                  onMenu={onTaskMenu}
                  onOpen={onTaskOpen}
                  onReorderStart={onTaskReorderStart}
                  onToggleExpand={onTaskToggleExpand}
                  task={task}
                />
              ))}
            </ol>

            {isExpanded && section.tasks.length === 0 ? (
              <div className="task-list__section-empty">
                {onAddTask ? (
                  <button className="task-list__add-task" onClick={() => onAddTask(section.id)} type="button">
                    <PlusIcon />
                    <span>Add task</span>
                  </button>
                ) : (
                  <span>No tasks in this section.</span>
                )}
              </div>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
