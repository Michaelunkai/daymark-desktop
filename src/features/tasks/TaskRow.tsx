import type { CSSProperties, ReactNode } from 'react';

import type { Label, Task, TaskDue } from '../../core/types';

export type TaskDueTone =
  | 'overdue'
  | 'today'
  | 'tomorrow'
  | 'soon'
  | 'upcoming'
  | 'default'
  | 'neutral';

export type TaskRowTask = Pick<Task, 'id' | 'content' | 'completedAt' | 'priority' | 'due' | 'labelIds'> & {
  dueLabel?: string;
  dueTone?: TaskDueTone;
  depth?: number;
  hasChildren?: boolean;
  subtaskCount?: number;
  isExpanded?: boolean;
};

export type TaskRowLabel = Pick<Label, 'id' | 'name' | 'color'>;

export interface TaskRowProps {
  task: TaskRowTask;
  labels?: readonly TaskRowLabel[];
  depth?: number;
  isExpanded?: boolean;
  leadingAccessory?: ReactNode;
  onComplete?: (taskId: string, nextCompleted: boolean) => void;
  onOpen?: (taskId: string) => void;
  onToggleExpand?: (taskId: string, expanded: boolean) => void;
  onMenu?: (taskId: string) => void;
  onReorderStart?: (taskId: string) => void;
}

function formatDueLabel(due: TaskDue | null, fallback?: string) {
  if (fallback) {
    return fallback;
  }
  if (!due) {
    return undefined;
  }
  return due.time ? `${due.date}, ${due.time}` : due.date;
}

function CheckIcon({ checked }: { checked: boolean }) {
  return (
    <svg aria-hidden="true" className="task-row__icon task-row__check-icon" viewBox="0 0 20 20">
      <circle cx="10" cy="10" r="7.25" />
      {checked ? <path d="m6.5 10.1 2.15 2.15 4.85-5.05" /> : null}
    </svg>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg aria-hidden="true" className="task-row__icon" viewBox="0 0 20 20">
      <path d={expanded ? 'm5.5 7.5 4.5 4.5 4.5-4.5' : 'm7.5 5.5 4.5 4.5-4.5 4.5'} />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg aria-hidden="true" className="task-row__meta-icon" viewBox="0 0 16 16">
      <rect height="10.5" rx="1.5" width="11.5" x="2.25" y="3.25" />
      <path d="M5 2.5v2M11 2.5v2M2.75 6.25h10.5" />
    </svg>
  );
}

function FlagIcon() {
  return (
    <svg aria-hidden="true" className="task-row__meta-icon" viewBox="0 0 16 16">
      <path d="M3.5 13.5V2.25c2.6-1.35 4.4 1.55 7 .2 1.1-.58 1.8-.28 2 .03v6.05c-.2-.3-.9-.6-2-.03-2.6 1.35-4.4-1.55-7-.2" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg aria-hidden="true" className="task-row__meta-icon" viewBox="0 0 16 16">
      <path d="M2.5 8V3.5h4.55l6.45 6.45a1.45 1.45 0 0 1 0 2.05l-.5.5a1.45 1.45 0 0 1-2.05 0L4.5 6.05" />
      <circle cx="5.25" cy="5.25" r=".8" />
    </svg>
  );
}

function GripIcon() {
  return (
    <svg aria-hidden="true" className="task-row__icon" viewBox="0 0 20 20">
      <circle cx="7" cy="5" r="1" />
      <circle cx="13" cy="5" r="1" />
      <circle cx="7" cy="10" r="1" />
      <circle cx="13" cy="10" r="1" />
      <circle cx="7" cy="15" r="1" />
      <circle cx="13" cy="15" r="1" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg aria-hidden="true" className="task-row__icon" viewBox="0 0 20 20">
      <circle cx="5" cy="10" r="1.25" />
      <circle cx="10" cy="10" r="1.25" />
      <circle cx="15" cy="10" r="1.25" />
    </svg>
  );
}

export function TaskRow({
  task,
  labels = [],
  depth: depthOverride,
  isExpanded: expandedOverride,
  leadingAccessory,
  onComplete,
  onOpen,
  onToggleExpand,
  onMenu,
  onReorderStart,
}: TaskRowProps) {
  const depth = Math.max(0, Math.min(4, depthOverride ?? task.depth ?? 0));
  const isExpanded = expandedOverride ?? task.isExpanded ?? false;
  const hasChildren = Boolean(task.hasChildren || task.subtaskCount);
  const title = task.content.trim() || 'Untitled task';
  const completed = task.completedAt !== null;
  const priority = task.priority && task.priority < 4 ? task.priority : undefined;
  const dueLabel = formatDueLabel(task.due, task.dueLabel);
  const dueTone = task.dueTone ?? 'default';
  const taskLabels = task.labelIds
    .map((labelId) => labels.find((label) => label.id === labelId))
    .filter((label): label is TaskRowLabel => Boolean(label));

  return (
    <li
      aria-level={depth + 1}
      className={`task-row${completed ? ' is-completed' : ''}`}
      data-depth={depth}
    >
      <div className="task-row__leading">
        <button
          aria-label={`${completed ? 'Mark incomplete' : 'Complete'} ${title}`}
          className="task-row__icon-button task-row__complete"
          disabled={!onComplete}
          onClick={() => onComplete?.(task.id, !completed)}
          type="button"
        >
          <CheckIcon checked={completed} />
        </button>

        {hasChildren ? (
          <button
            aria-expanded={isExpanded}
            aria-label={`${isExpanded ? 'Collapse' : 'Expand'} subtasks for ${title}`}
            className="task-row__icon-button task-row__disclosure"
            data-tooltip={isExpanded ? 'Collapse subtasks' : 'Expand subtasks'}
            disabled={!onToggleExpand}
            onClick={() => onToggleExpand?.(task.id, !isExpanded)}
            type="button"
          >
            <ChevronIcon expanded={isExpanded} />
          </button>
        ) : (
          <span aria-hidden="true" className="task-row__disclosure-placeholder" />
        )}
      </div>

      <div className="task-row__body">
        <div className="task-row__title-line">
          {onOpen ? (
            <button className="task-row__title" onClick={() => onOpen(task.id)} type="button">
              {title}
            </button>
          ) : (
            <span className="task-row__title task-row__title--static">{title}</span>
          )}
          {leadingAccessory}
        </div>

        {dueLabel || priority || taskLabels.length ? (
          <div className="task-row__metadata">
            {dueLabel ? (
              <span className="task-row__due" data-tone={dueTone}>
                <CalendarIcon />
                {dueLabel}
              </span>
            ) : null}

            {priority ? (
              <span className={`task-row__priority task-row__priority--${priority}`}>
                <FlagIcon />
                <span>P{priority}</span>
              </span>
            ) : null}

            {taskLabels.map((label) => (
              <span
                className="task-row__label"
                key={label.id}
                style={{ '--task-label-color': label.color ?? 'var(--task-list-accent)' } as CSSProperties}
              >
                <TagIcon />
                {label.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="task-row__actions">
        {onReorderStart ? (
          <button
            aria-label={`Reorder ${title}`}
            className="task-row__icon-button task-row__action"
            data-tooltip="Reorder task"
            onClick={() => onReorderStart(task.id)}
            type="button"
          >
            <GripIcon />
          </button>
        ) : null}
        {onMenu ? (
          <button
            aria-label={`Open actions for ${title}`}
            className="task-row__icon-button task-row__action"
            data-tooltip="Task actions"
            onClick={() => onMenu(task.id)}
            type="button"
          >
            <MoreIcon />
          </button>
        ) : null}
      </div>
    </li>
  );
}
