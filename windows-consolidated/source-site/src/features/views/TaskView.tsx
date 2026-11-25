import "./views.css";

import { TaskBoardView } from "./TaskBoardView";
import { TaskListView } from "./TaskListView";
import { ViewModeToggle } from "./ViewModeToggle";
import type { TaskViewProps } from "./types";

export function TaskView({ mode, onChangeLayout, ...viewProps }: TaskViewProps) {
  return (
    <section className="task-view">
      <div className="task-view-toolbar">
        <div>
          <span className="task-view-toolbar-label">Project view</span>
          <span className="task-view-toolbar-note">
            {mode === "list" ? "Scan sections in order" : "Move work across sections"}
          </span>
        </div>
        <ViewModeToggle mode={mode} onChange={onChangeLayout} />
      </div>
      {mode === "list" ? <TaskListView {...viewProps} /> : <TaskBoardView {...viewProps} />}
    </section>
  );
}
