import type { ProjectLayout } from "../projects/types";
import { BoardIcon, ListIcon } from "./icons";

export interface ViewModeToggleProps {
  mode: ProjectLayout;
  onChange?: (mode: ProjectLayout) => void;
}

export function ViewModeToggle({ mode, onChange }: ViewModeToggleProps) {
  return (
    <div aria-label="View layout" className="view-mode-toggle" role="group">
      <button
        aria-pressed={mode === "list"}
        className="view-mode-button"
        title="List view"
        type="button"
        onClick={() => onChange?.("list")}
      >
        <ListIcon />
        <span>List</span>
      </button>
      <button
        aria-pressed={mode === "board"}
        className="view-mode-button"
        title="Board view"
        type="button"
        onClick={() => onChange?.("board")}
      >
        <BoardIcon />
        <span>Board</span>
      </button>
    </div>
  );
}
