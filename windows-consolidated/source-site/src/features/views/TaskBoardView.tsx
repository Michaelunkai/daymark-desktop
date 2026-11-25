import type { DragEvent } from "react";

import { ProjectSectionHeader } from "../projects/ProjectSectionHeader";
import type { ProjectSection, ProjectTask } from "../projects/types";
import { GripIcon, MoreIcon } from "./icons";
import { sortSections } from "./model";
import type { TaskBoardViewProps } from "./types";

function getSectionTasks(sectionId: string | null, tasks: readonly ProjectTask[], showCompleted: boolean) {
  return tasks
    .filter((task) => (task.sectionId ?? null) === sectionId)
    .filter((task) => showCompleted || task.completedAt === null)
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

function getDueLabel(task: ProjectTask) {
  return task.dueLabel ?? (task.due ? `${task.due.date}${task.due.time ? ` ${task.due.time}` : ""}` : "");
}

function readDraggedTask(event: DragEvent<HTMLElement>) {
  return event.dataTransfer.getData("text/plain").trim();
}

interface BoardColumnProps {
  section: ProjectSection | null;
  tasks: ProjectTask[];
  labels?: TaskBoardViewProps["labels"];
  onTaskOpen?: (taskId: string) => void;
  onTaskComplete?: (taskId: string, nextValue: boolean) => void;
  onTaskMove?: (taskId: string, sectionId: string | null, order: number) => void;
  onTaskMenu?: (taskId: string) => void;
  onSectionAddTask?: (sectionId: string) => void;
}

function BoardColumn({
  section,
  tasks,
  labels = [],
  onTaskOpen,
  onTaskComplete,
  onTaskMove,
  onTaskMenu,
  onSectionAddTask,
}: BoardColumnProps) {
  const sectionName = section?.name ?? "Unsectioned";
  const sectionId = section?.id ?? null;

  return (
    <section
      aria-label={`${sectionName} column`}
      className="task-board-column"
      onDragOver={(event) => {
        if (onTaskMove) {
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
        }
      }}
      onDrop={(event) => {
        event.preventDefault();
        const taskId = readDraggedTask(event);
        if (taskId && onTaskMove) {
          onTaskMove(taskId, sectionId, tasks.length);
        }
      }}
    >
      {section ? (
        <ProjectSectionHeader
          layout="board"
          section={section}
          taskCount={tasks.length}
          onAddTask={onSectionAddTask}
        />
      ) : (
        <div className="project-section-header project-section-header--board">
          <div className="project-section-heading">
            <span className="project-section-name">{sectionName}</span>
            <span className="project-section-count">{tasks.length}</span>
          </div>
        </div>
      )}
      <div className="task-board-column-body">
        {tasks.length > 0 ? (
          tasks.map((task) => (
            <article
              className={`task-card${task.completedAt !== null ? " task-card--completed" : ""}`}
              draggable={Boolean(onTaskMove)}
              key={task.id}
              onDragStart={(event) => {
                if (!onTaskMove) {
                  return;
                }
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", task.id);
              }}
            >
              <div className="task-card-topline">
                <span className="task-card-grip" aria-hidden="true">
                  <GripIcon />
                </span>
                {task.priority && task.priority < 4 ? (
                  <span className={`task-priority task-priority--p${task.priority}`}>P{task.priority}</span>
                ) : null}
                {onTaskMenu ? (
                  <button
                    aria-label={`Open actions for ${task.content}`}
                    className="task-action-button task-card-action"
                    title="Task actions"
                    type="button"
                    onClick={() => onTaskMenu(task.id)}
                  >
                    <MoreIcon />
                  </button>
                ) : null}
              </div>
              {onTaskOpen ? (
                <button className="task-card-title" type="button" onClick={() => onTaskOpen(task.id)}>
                  {task.content}
                </button>
              ) : (
                <div className="task-card-title">{task.content}</div>
              )}
              <div className="task-card-bottomline">
                <button
                  aria-label={`${task.completedAt !== null ? "Mark incomplete" : "Complete"} ${task.content}`}
                  className={`task-complete-button${task.completedAt !== null ? " task-complete-button--checked" : ""}`}
                  disabled={!onTaskComplete}
                  type="button"
                  onClick={() => onTaskComplete?.(task.id, task.completedAt === null)}
                >
                  <span aria-hidden="true" className="task-complete-ring">
                    {task.completedAt !== null ? "\u2713" : null}
                  </span>
                </button>
                {getDueLabel(task) ? (
                  <span className={`task-due task-due--${task.dueTone ?? "neutral"}`}>{getDueLabel(task)}</span>
                ) : null}
                {task.labelIds.length ? (
                  <span className="task-card-label-count">
                    {task.labelIds.filter((labelId) => labels.some((label) => label.id === labelId)).length} labels
                  </span>
                ) : null}
              </div>
            </article>
          ))
        ) : (
          <div className="task-board-drop-hint">Drop a task here</div>
        )}
      </div>
    </section>
  );
}

export function TaskBoardView({
  sections,
  tasks,
  labels,
  showCompleted = true,
  onTaskOpen,
  onTaskComplete,
  onTaskMove,
  onTaskMenu,
  onSectionCreate,
  onSectionAddTask,
  emptyMessage = "Create a section to turn this project into a board.",
}: TaskBoardViewProps) {
  const orderedSections = sortSections(sections);
  const hasUnsectioned = tasks.some(
    (task) => (task.sectionId === null || task.sectionId === undefined) && (showCompleted || task.completedAt === null),
  );

  return (
    <section aria-label="Task board" className="task-board-view">
      {orderedSections.length > 0 || hasUnsectioned ? (
        <div className="task-board-scroller">
          {orderedSections.map((section) => (
            <BoardColumn
              key={section.id}
              section={section}
              tasks={getSectionTasks(section.id, tasks, showCompleted)}
              labels={labels}
              onSectionAddTask={onSectionAddTask}
              onTaskComplete={onTaskComplete}
              onTaskMenu={onTaskMenu}
              onTaskMove={onTaskMove}
              onTaskOpen={onTaskOpen}
            />
          ))}
          {hasUnsectioned ? (
            <BoardColumn
              section={null}
              tasks={getSectionTasks(null, tasks, showCompleted)}
              labels={labels}
              onTaskComplete={onTaskComplete}
              onTaskMenu={onTaskMenu}
              onTaskMove={onTaskMove}
              onTaskOpen={onTaskOpen}
            />
          ) : null}
          {onSectionCreate ? (
            <button className="task-board-add-column" type="button" onClick={onSectionCreate}>
              <span aria-hidden="true">+</span>
              <span>Add section</span>
            </button>
          ) : null}
        </div>
      ) : (
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
      )}
    </section>
  );
}
