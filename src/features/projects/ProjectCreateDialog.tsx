import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import type { Project, ProjectInput } from "../../core/types";

const PROJECT_COLORS = [
  { value: "teal", label: "Teal", swatch: "#0f766e" },
  { value: "amber", label: "Amber", swatch: "#b45309" },
  { value: "indigo", label: "Indigo", swatch: "#4f46e5" },
  { value: "charcoal", label: "Charcoal", swatch: "#454745" },
] as const;

export interface ProjectCreateValues {
  project: ProjectInput;
  defaultSectionName: string;
}

export interface ProjectCreateDialogProps {
  isOpen: boolean;
  onCancel: () => void;
  onCreate: (values: ProjectCreateValues) => void;
  project?: Project | null;
  onSave?: (projectId: string, values: ProjectCreateValues["project"]) => void;
}

export function ProjectCreateDialog({
  isOpen,
  onCancel,
  onCreate,
  project = null,
  onSave,
}: ProjectCreateDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();
  const nameErrorId = useId();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [color, setColor] = useState<string>(PROJECT_COLORS[0].value);
  const [defaultSectionName, setDefaultSectionName] = useState("To do");
  const [nameError, setNameError] = useState("");

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setName(project?.name ?? "");
    setDescription(project?.description ?? "");
    setColor(project?.color ?? PROJECT_COLORS[0].value);
    setDefaultSectionName("To do");
    setNameError("");

    const frame = window.requestAnimationFrame(() => nameRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [isOpen, project]);

  const close = useCallback(() => {
    onCancel();
    window.requestAnimationFrame(() => openerRef.current?.focus());
  }, [onCancel]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, isOpen]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setNameError("Give the project a name to continue.");
      nameRef.current?.focus();
      return;
    }

    const values = {
      name: trimmedName,
      description: description.trim(),
      color,
    };
    if (project && onSave) onSave(project.id, values);
    else onCreate({
      project: values,
      defaultSectionName: defaultSectionName.trim(),
    });
    window.requestAnimationFrame(() => openerRef.current?.focus());
  };

  const handleOverlayMouseDown = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      close();
    }
  };

  const handleDialogKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== "Tab") {
      return;
    }

    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) {
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="project-create-overlay" onMouseDown={handleOverlayMouseDown}>
      <section
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        aria-modal="true"
        className="project-create-dialog"
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <header className="project-create-dialog__header">
          <div>
            <p className="project-create-dialog__eyebrow">{project ? "Edit project" : "New project"}</p>
            <h2 id={titleId}>{project ? "Refine the plan" : "Make space for a plan"}</h2>
            <p id={descriptionId}>Projects keep related tasks and sections together.</p>
          </div>
          <button
            aria-label="Close project creation"
            className="project-create-dialog__close"
            onClick={close}
            type="button"
          >
            <span aria-hidden="true">x</span>
          </button>
        </header>

        <form className="project-create-dialog__form" onSubmit={handleSubmit}>
          <label className="project-create-dialog__field">
            <span>Project name</span>
            <input
              aria-describedby={nameError ? nameErrorId : undefined}
              aria-invalid={Boolean(nameError)}
              autoComplete="off"
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) {
                  setNameError("");
                }
              }}
              placeholder="For example, Home refresh"
              ref={nameRef}
              type="text"
              value={name}
            />
            {nameError ? <small className="project-create-dialog__error" id={nameErrorId}>{nameError}</small> : null}
          </label>

          <label className="project-create-dialog__field">
            <span>Description <em>Optional</em></span>
            <textarea
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What is this project for?"
              rows={8}
              value={description}
            />
          </label>

          <fieldset className="project-create-dialog__colors">
            <legend>Color</legend>
            <div>
              {PROJECT_COLORS.map((option) => (
                <label className="project-create-dialog__color" key={option.value} title={option.label}>
                  <input
                    checked={color === option.value}
                    name="project-color"
                    onChange={() => setColor(option.value)}
                    type="radio"
                    value={option.value}
                  />
                  <span aria-hidden="true" style={{ backgroundColor: option.swatch }} />
                  <span className="project-create-dialog__sr-only">{option.label}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {!project ? (
            <label className="project-create-dialog__field">
              <span>First section <em>Optional</em></span>
              <input
                autoComplete="off"
                onChange={(event) => setDefaultSectionName(event.target.value)}
                placeholder="To do"
                type="text"
                value={defaultSectionName}
              />
              <small>Leave blank to create the project without a section.</small>
            </label>
          ) : null}

          <footer className="project-create-dialog__actions">
            <button className="project-create-dialog__cancel" onClick={close} type="button">Cancel</button>
            <button className="project-create-dialog__submit" type="submit">{project ? "Save changes" : "Create project"}</button>
          </footer>
        </form>
      </section>

      <style>{`
        .project-create-overlay { align-items: center; background: rgb(21 24 22 / 48%); display: flex; inset: 0; justify-content: center; padding: 20px; position: fixed; z-index: 100; }
        .project-create-dialog { background: var(--surface, #fff); border: 1px solid var(--line, #dedfd9); border-radius: 8px; box-shadow: 0 20px 58px rgb(18 22 19 / 25%); color: var(--ink, #282a27); max-width: 510px; width: 100%; }
        .project-create-dialog__header { align-items: flex-start; border-bottom: 1px solid var(--line, #e8e8e3); display: flex; gap: 16px; justify-content: space-between; padding: 24px 24px 20px; }
        .project-create-dialog__eyebrow { color: var(--ink-muted, #6b6e68); font-size: 11px; font-weight: 750; letter-spacing: .08em; margin: 0 0 6px; text-transform: uppercase; }
        .project-create-dialog h2 { font-size: 23px; letter-spacing: 0; line-height: 1.2; margin: 0; }
        .project-create-dialog__header p:last-child { color: var(--ink-soft, #70736d); font-size: 14px; line-height: 1.45; margin: 7px 0 0; }
        .project-create-dialog__close { align-items: center; background: transparent; border: 0; border-radius: 6px; color: var(--ink-muted, #777a74); cursor: pointer; display: inline-flex; font-size: 21px; height: 32px; justify-content: center; line-height: 1; padding: 0; width: 32px; }
        .project-create-dialog__close:hover { background: var(--surface-soft, #f0f0ec); color: var(--ink, #292b28); }
        .project-create-dialog__form { display: grid; gap: 18px; padding: 22px 24px 24px; }
        .project-create-dialog__field { color: var(--ink, #363834); display: grid; font-size: 13px; font-weight: 700; gap: 7px; }
        .project-create-dialog__field em { color: var(--ink-muted, #898c85); font-size: 12px; font-style: normal; font-weight: 500; }
        .project-create-dialog__field input, .project-create-dialog__field textarea { background: var(--surface-soft, #fff); border: 1px solid var(--line-strong, #d5d6d0); border-radius: 6px; box-sizing: border-box; color: var(--ink, #282a27); font: inherit; font-weight: 500; outline: none; padding: 10px 11px; resize: vertical; width: 100%; }
        .project-create-dialog__field input { min-height: 42px; }
        .project-create-dialog__field textarea { line-height: 1.45; min-height: 82px; }
        .project-create-dialog__field input:focus, .project-create-dialog__field textarea:focus { border-color: var(--blue, #315bd7); box-shadow: 0 0 0 3px rgb(49 91 215 / 16%); }
        .project-create-dialog__field small { color: var(--ink-muted, #787b75); font-size: 12px; font-weight: 500; line-height: 1.35; }
        .project-create-dialog__error { color: var(--coral, #b42318) !important; }
        .project-create-dialog__colors { border: 0; margin: 0; padding: 0; }
        .project-create-dialog__colors legend { color: var(--ink, #363834); font-size: 13px; font-weight: 700; margin-bottom: 9px; padding: 0; }
        .project-create-dialog__colors > div { display: flex; gap: 10px; }
        .project-create-dialog__color { cursor: pointer; display: inline-flex; position: relative; }
        .project-create-dialog__color input { height: 1px; opacity: 0; position: absolute; width: 1px; }
        .project-create-dialog__color > span:first-of-type { border: 3px solid var(--surface, #fff); border-radius: 50%; box-shadow: 0 0 0 1px var(--line-strong, #d4d5d0); height: 25px; transition: box-shadow .15s ease, transform .15s ease; width: 25px; }
        .project-create-dialog__color input:checked + span { box-shadow: 0 0 0 2px var(--ink, #282a27); transform: scale(1.08); }
        .project-create-dialog__color input:focus-visible + span { box-shadow: 0 0 0 2px var(--blue, #315bd7); }
        .project-create-dialog__actions { align-items: center; border-top: 1px solid var(--line, #e8e8e3); display: flex; gap: 10px; justify-content: flex-end; margin: 4px -24px -24px; padding: 16px 24px; }
        .project-create-dialog__actions button { border-radius: 6px; cursor: pointer; font: inherit; font-size: 13px; font-weight: 700; min-height: 38px; padding: 0 14px; }
        .project-create-dialog__cancel { background: var(--surface, #fff); border: 1px solid var(--line-strong, #d5d6d0); color: var(--ink, #444640); }
        .project-create-dialog__cancel:hover { background: var(--surface-soft, #f5f5f1); }
        .project-create-dialog__submit { background: var(--ink, #272926); border: 1px solid var(--ink, #272926); color: var(--surface, #fff); }
        .project-create-dialog__submit:hover { background: var(--ink-soft, #494b47); border-color: var(--ink-soft, #494b47); }
        .project-create-dialog__close:focus-visible, .project-create-dialog__actions button:focus-visible { outline: 2px solid var(--blue, #315bd7); outline-offset: 2px; }
        .project-create-dialog__sr-only { clip: rect(0 0 0 0); clip-path: inset(50%); height: 1px; overflow: hidden; position: absolute; white-space: nowrap; width: 1px; }
        @media (max-width: 560px) { .project-create-overlay { align-items: end; padding: 0; } .project-create-dialog { border-bottom: 0; border-radius: 8px 8px 0 0; max-height: calc(100vh - 18px); overflow-y: auto; } .project-create-dialog__header, .project-create-dialog__form { padding-left: 18px; padding-right: 18px; } .project-create-dialog__actions { margin-left: -18px; margin-right: -18px; padding-left: 18px; padding-right: 18px; } }
      `}</style>
    </div>
  );
}
