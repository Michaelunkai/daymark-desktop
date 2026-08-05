import type { CSSProperties, DragEvent } from "react";

import { GripIcon, MoreIcon } from "./icons";
import type { TaskRowProps } from "./types";

const PRIORITY_LABELS = {
  1: "Priority 1",
  2: "Priority 2",
  3: "Priority 3",
  4: "No priority",
} as const;

export function TaskRow({
  task,
  labels = [],
  onTaskOpen,
  onTaskComplete,
  onTaskMove,
  onTaskMenu,
  onTaskToggleExpanded,
}: TaskRowProps) {
  const depth = Math.min(Math.max(task.depth ?? 0, 0), 3);
  const hasChildren = Boolean(task.hasChildren);
  const canDrag = Boolean(onTaskMove);
  const isCompleted = task.completedAt !== null;
  const title = task.content.trim() || "Untitled task";
  const taskLabels = task.labelIds
    .map((labelId) => labels.find((label) => label.id === labelId))
    .filter((label): label is (typeof labels)[number] => Boolean(label));
  const dueLabel = task.dueLabel ?? (task.due ? `${task.due.date}${task.due.time ? ` ${task.due.time}` : ""}` : "");

  return (
    <li
      aria-level={depth + 1}
      className={`view-task-row${isCompleted ? " view-task-row--completed" : ""}`}
      style={{ "--task-depth": depth } as CSSProperties}
      draggable={canDrag}
      onDragStart={(event) => {
        if (!canDrag) {
          return;
        }
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", task.id);
      }}
      onDragOver={(event) => {
        if (canDrag) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event: DragEvent<HTMLLIElement>) => {
        event.preventDefault();
        const draggedTaskId = event.dataTransfer.getData("text/plain").trim();
        if (draggedTaskId && draggedTaskId !== task.id) {
          onTaskMove?.(draggedTaskId, task.sectionId ?? null, task.order);
        }
      }}
    >
      <span className="view-task-row-drag-handle" aria-hidden="true">
        <GripIcon />
      </span>
      <button
        aria-label={`${isCompleted ? "Mark incomplete" : "Complete"} ${title}`}
        className={`task-complete-button${isCompleted ? " task-complete-button--checked" : ""}`}
        disabled={!onTaskComplete}
        type="button"
        onClick={() => onTaskComplete?.(task.id, !isCompleted)}
      >
        <span aria-hidden="true" className="task-complete-ring">
          {isCompleted ? "\u2713" : null}
        </span>
      </button>
      {hasChildren ? (
        <button
          aria-expanded={Boolean(task.isExpanded)}
          aria-label={`${task.isExpanded ? "Collapse" : "Expand"} subtasks for ${title}`}
          className="task-disclosure-button"
          disabled={!onTaskToggleExpanded}
          type="button"
          onClick={() => onTaskToggleExpanded?.(task.id, !task.isExpanded)}
        >
          <span aria-hidden="true">{task.isExpanded ? "-" : "+"}</span>
        </button>
      ) : (
        <span className="task-disclosure-spacer" aria-hidden="true" />
      )}
      {onTaskOpen ? (
        <button className="view-task-row-main" type="button" onClick={() => onTaskOpen(task.id)}>
          <span className="view-task-row-title">{title}</span>
          <span className="view-task-row-description">
            {task.description.trim() || "No details yet. Open the task to add context."}
          </span>
          {dueLabel || taskLabels.length > 0 ? (
            <span className="view-task-row-meta">
              {dueLabel ? (
                <span className={`task-due task-due--${task.dueTone ?? "neutral"}`}>{dueLabel}</span>
              ) : null}
              {taskLabels.map((label) => (
                <span className="task-label" key={label.id}>
                  {label.name}
                </span>
              ))}
            </span>
          ) : null}
        </button>
      ) : (
        <div className="view-task-row-main">
          <span className="view-task-row-title">{title}</span>
          <span className="view-task-row-description">
            {task.description.trim() || "No details yet. Open the task to add context."}
          </span>
          {dueLabel || taskLabels.length > 0 ? (
            <span className="view-task-row-meta">
              {dueLabel ? (
                <span className={`task-due task-due--${task.dueTone ?? "neutral"}`}>{dueLabel}</span>
              ) : null}
              {taskLabels.map((label) => (
                <span className="task-label" key={label.id}>
                  {label.name}
                </span>
              ))}
            </span>
          ) : null}
        </div>
      )}
      <span className="view-task-row-status">
        {task.priority && task.priority < 4 ? (
          <span className={`task-priority task-priority--p${task.priority}`} title={PRIORITY_LABELS[task.priority]}>
            P{task.priority}
          </span>
        ) : null}
      </span>
      <span className="view-task-row-actions">
        {onTaskMenu ? (
          <button
            aria-label={`Open actions for ${title}`}
            className="task-action-button"
            title="Task actions"
            type="button"
            onClick={() => onTaskMenu(task.id)}
          >
            <MoreIcon />
          </button>
        ) : null}
      </span>
    </li>
  );
}
