import type { CSSProperties } from "react";

import { PlusIcon, StarIcon } from "./icons";
import type { ProjectHeaderProps } from "./types";

const DEFAULT_PROJECT_COLOR = "#d05d4d";

export function ProjectHeader({ project, onToggleFavorite, onAddSection }: ProjectHeaderProps) {
  const projectColor = project.color || DEFAULT_PROJECT_COLOR;
  const style = { "--project-color": projectColor } as CSSProperties;
  const canFavorite = Boolean(onToggleFavorite);
  const canAddSection = Boolean(onAddSection);

  return (
    <header className="project-header" style={style}>
      <div className="project-heading">
        <span className="project-color-mark" aria-hidden="true" />
        <div className="project-heading-copy">
          <div className="project-title-line">
            <h1>{project.name}</h1>
            {project.isFavorite ? <span className="project-favorite-label">Favorite</span> : null}
          </div>
          <p className={project.description ? undefined : "project-description-placeholder"}>
            {project.description || "No project details yet. Add a description to keep the purpose visible here."}
          </p>
        </div>
      </div>

      <div className="project-header-actions">
        {canFavorite ? (
          <button
            aria-pressed={Boolean(project.isFavorite)}
            className="project-icon-button"
            title={project.isFavorite ? "Remove from favorites" : "Add to favorites"}
            type="button"
            onClick={() => onToggleFavorite?.(project.id, !project.isFavorite)}
          >
            <StarIcon filled={Boolean(project.isFavorite)} />
            <span className="visually-hidden">
              {project.isFavorite ? "Remove from favorites" : "Add to favorites"}
            </span>
          </button>
        ) : null}
        {canAddSection ? (
          <button className="project-add-section" type="button" onClick={onAddSection}>
            <PlusIcon />
            <span>Add section</span>
          </button>
        ) : null}
      </div>
    </header>
  );
}
