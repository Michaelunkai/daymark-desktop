import {
  type FormEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

import {
  updateTaskEditorDraft,
  validateTaskEditorDraft,
} from './form-state';
import type {
  TaskEditorDraft,
  TaskEditorProps,
  TaskPriority,
} from './types';
import './task-editor.css';

const PRIORITY_OPTIONS: Array<{ value: TaskPriority; label: string }> = [
  { value: 4, label: 'P4 - No priority' },
  { value: 3, label: 'P3 - Low' },
  { value: 2, label: 'P2 - Medium' },
  { value: 1, label: 'P1 - High' },
];

export function TaskEditor({
  isOpen,
  draft,
  mode = 'edit',
  projects = [],
  sections = [],
  labels = [],
  isSaving = false,
  saveError,
  validationErrors = {},
  presentation = 'panel',
  onDraftChange,
  onSave,
  onCancel,
  onClose,
  onRequestProjectPicker,
  onRequestLabelPicker,
  onRequestReminderPicker,
}: TaskEditorProps) {
  const titleId = useId().replace(/:/g, '');
  const surfaceRef = useRef<HTMLElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<ReturnType<
    typeof validateTaskEditorDraft
  >['errors']>({});

  const availableSections = sections;

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const previousFocus = document.activeElement as HTMLElement | null;
    const focusTitle = window.requestAnimationFrame(() => {
      titleRef.current?.focus();
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        handleCancel();
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
        event.preventDefault();
        submitDraft();
        return;
      }

      if (event.key !== 'Tab' || !surfaceRef.current) {
        return;
      }

      const focusable = Array.from(
        surfaceRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );

      if (focusable.length === 0) {
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

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusTitle);
      document.removeEventListener('keydown', handleKeyDown);
      previousFocus?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      return undefined;
    }

    setErrors({});
    return undefined;
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  const displayedErrors = { ...validationErrors, ...errors };
  const formError = saveError ?? displayedErrors.form;
  const ids = {
    title: `${titleId}-title`,
    description: `${titleId}-description`,
    project: `${titleId}-project`,
    section: `${titleId}-section`,
    priority: `${titleId}-priority`,
    due: `${titleId}-due`,
    recurrence: `${titleId}-recurrence`,
    reminder: `${titleId}-reminder`,
    error: `${titleId}-error`,
  };

  function changeField<Field extends keyof TaskEditorDraft>(
    field: Field,
    value: TaskEditorDraft[Field],
  ) {
    const nextDraft = updateTaskEditorDraft(draft, field, value);
    onDraftChange(nextDraft, { field, value });

    if (errors[field]) {
      setErrors((current) => ({ ...current, [field]: undefined }));
    }
  }

  function submitDraft() {
    const result = validateTaskEditorDraft(draft);
    setErrors(result.errors);

    if (!result.valid) {
      titleRef.current?.focus();
      return;
    }

    onSave(result.value);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submitDraft();
  }

  function handleCancel() {
    onCancel?.();
    onClose();
  }

  function handleLabelToggle(labelId: string, checked: boolean) {
    const nextLabelIds = checked
      ? [...draft.labelIds, labelId]
      : draft.labelIds.filter((id) => id !== labelId);
    changeField('labelIds', nextLabelIds);
  }

  return (
    <div
      className={`task-editor__backdrop task-editor__backdrop--${presentation}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          handleCancel();
        }
      }}
    >
      <section
        ref={surfaceRef}
        className={`task-editor__surface task-editor__surface--${presentation}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${titleId}-heading`}
        aria-describedby={formError ? ids.error : undefined}
      >
        <header className="task-editor__header">
          <div>
            <p className="task-editor__eyebrow">
              {mode === 'create' ? 'Capture' : 'Task details'}
            </p>
            <h2 id={`${titleId}-heading`}>
              {mode === 'create' ? 'Create task' : 'Edit task'}
            </h2>
          </div>
          <button
            type="button"
            className="task-editor__icon-button"
            aria-label="Close task editor"
            title="Close task editor"
            onClick={handleCancel}
          >
            <CloseIcon />
          </button>
        </header>

        <form className="task-editor__form" onSubmit={handleSubmit} noValidate>
          <div className="task-editor__content">
            <section className="task-editor__section task-editor__section--primary">
              <div className="task-editor__field">
                <label htmlFor={ids.title}>Task title</label>
                <input
                  ref={titleRef}
                  id={ids.title}
                  className="task-editor__title-input"
                  value={draft.title}
                  onChange={(event) =>
                    changeField('title', event.currentTarget.value)
                  }
                  aria-invalid={Boolean(displayedErrors.title)}
                  aria-describedby={
                    displayedErrors.title ? `${ids.title}-error` : undefined
                  }
                  placeholder="What needs doing?"
                  autoComplete="off"
                />
                {displayedErrors.title ? (
                  <span id={`${ids.title}-error`} className="task-editor__error">
                    {displayedErrors.title}
                  </span>
                ) : null}
              </div>

              <div className="task-editor__field">
                <label htmlFor={ids.description}>Description</label>
                <textarea
                  id={ids.description}
                  value={draft.description}
                  onChange={(event) =>
                    changeField('description', event.currentTarget.value)
                  }
                  placeholder="Add context, links, or the next step"
                  rows={4}
                />
              </div>
            </section>

            <section className="task-editor__section">
              <div className="task-editor__section-heading">
                <div>
                  <p className="task-editor__eyebrow">Organize</p>
                  <h3>Where it belongs</h3>
                </div>
                <FolderIcon />
              </div>

              <div className="task-editor__field-grid">
                <div className="task-editor__field">
                  <label htmlFor={ids.project}>Project</label>
                  <div className="task-editor__select-wrap">
                    <select
                      id={ids.project}
                      value={draft.projectId ?? ''}
                      onChange={(event) =>
                        changeField(
                          'projectId',
                          event.currentTarget.value || null,
                        )
                      }
                    >
                      <option value="">Inbox</option>
                      {projects.map((project) => (
                        <option
                          key={project.id}
                          value={project.id}
                          disabled={project.disabled}
                        >
                          {project.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon />
                  </div>
                </div>

                <div className="task-editor__field">
                  <label htmlFor={ids.section}>Section</label>
                  <div className="task-editor__select-wrap">
                    <select
                      id={ids.section}
                      value={draft.sectionId ?? ''}
                      onChange={(event) =>
                        changeField(
                          'sectionId',
                          event.currentTarget.value || null,
                        )
                      }
                      disabled={!draft.projectId || availableSections.length === 0}
                      aria-invalid={Boolean(displayedErrors.sectionId)}
                      aria-describedby={
                        displayedErrors.sectionId
                          ? `${ids.section}-error`
                          : undefined
                      }
                    >
                      <option value="">
                        {draft.projectId
                          ? availableSections.length
                            ? 'No section'
                            : 'No sections'
                          : 'Choose a project first'}
                      </option>
                      {availableSections.map((section) => (
                        <option
                          key={section.id}
                          value={section.id}
                          disabled={section.disabled}
                        >
                          {section.label}
                        </option>
                      ))}
                    </select>
                    <ChevronDownIcon />
                  </div>
                  {displayedErrors.sectionId ? (
                    <span id={`${ids.section}-error`} className="task-editor__error">
                      {displayedErrors.sectionId}
                    </span>
                  ) : null}
                </div>
              </div>

              {onRequestProjectPicker ? (
                <button
                  type="button"
                  className="task-editor__text-button"
                  onClick={onRequestProjectPicker}
                >
                  <PlusIcon />
                  Manage projects
                </button>
              ) : null}
            </section>

            <section className="task-editor__section">
              <div className="task-editor__section-heading">
                <div>
                  <p className="task-editor__eyebrow">Signal</p>
                  <h3>Priority and labels</h3>
                </div>
                <TagIcon />
              </div>

              <div className="task-editor__field">
                <label htmlFor={ids.priority}>Priority</label>
                <div className="task-editor__priority-control">
                  <PriorityMark priority={draft.priority} />
                  <select
                    id={ids.priority}
                    value={draft.priority}
                    onChange={(event) =>
                      changeField(
                        'priority',
                        Number(event.currentTarget.value) as TaskPriority,
                      )
                    }
                  >
                    {PRIORITY_OPTIONS.map((priority) => (
                      <option key={priority.value} value={priority.value}>
                        {priority.label}
                      </option>
                    ))}
                  </select>
                  <ChevronDownIcon />
                </div>
              </div>

              <fieldset className="task-editor__labels">
                <legend>Labels</legend>
                {labels.length ? (
                  <div className="task-editor__label-list">
                    {labels.map((label) => {
                      const checkboxId = `${titleId}-label-${label.id}`;
                      return (
                        <label
                          key={label.id}
                          className={`task-editor__label-option ${
                            draft.labelIds.includes(label.id)
                              ? 'task-editor__label-option--selected'
                              : ''
                          }`}
                          htmlFor={checkboxId}
                        >
                          <input
                            id={checkboxId}
                            type="checkbox"
                            checked={draft.labelIds.includes(label.id)}
                            onChange={(event) =>
                              handleLabelToggle(
                                label.id,
                                event.currentTarget.checked,
                              )
                            }
                            disabled={label.disabled}
                          />
                          <span
                            className="task-editor__label-dot"
                            style={{ backgroundColor: label.color ?? '#b8aaa4' }}
                            aria-hidden="true"
                          />
                          <span>{label.label}</span>
                          {label.hint ? (
                            <small>{label.hint}</small>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="task-editor__empty">No labels available.</p>
                )}
                {onRequestLabelPicker ? (
                  <button
                    type="button"
                    className="task-editor__text-button"
                    onClick={onRequestLabelPicker}
                  >
                    <PlusIcon />
                    Manage labels
                  </button>
                ) : null}
              </fieldset>
            </section>

            <section className="task-editor__section">
              <div className="task-editor__section-heading">
                <div>
                  <p className="task-editor__eyebrow">Schedule</p>
                  <h3>Make time for it</h3>
                </div>
                <CalendarIcon />
              </div>

              <div className="task-editor__field">
                <label htmlFor={ids.due}>Due date</label>
                <div className="task-editor__input-with-icon">
                  <CalendarIcon />
                  <input
                    id={ids.due}
                    value={draft.dueText}
                    onChange={(event) =>
                      changeField('dueText', event.currentTarget.value)
                    }
                    placeholder="e.g. tomorrow at 4pm"
                    autoComplete="off"
                  />
                </div>
              </div>

              <div className="task-editor__field-grid">
                <div className="task-editor__field">
                  <label htmlFor={ids.recurrence}>Repeat</label>
                  <div className="task-editor__input-with-icon">
                    <RepeatIcon />
                    <input
                      id={ids.recurrence}
                      value={draft.recurrenceText}
                      onChange={(event) =>
                        changeField('recurrenceText', event.currentTarget.value)
                      }
                      placeholder="e.g. every Friday"
                      autoComplete="off"
                    />
                  </div>
                </div>

                <div className="task-editor__field">
                  <label htmlFor={ids.reminder}>Reminder</label>
                  <div className="task-editor__input-with-icon">
                    <BellIcon />
                    <input
                      id={ids.reminder}
                      value={draft.reminderText}
                      onChange={(event) =>
                        changeField('reminderText', event.currentTarget.value)
                      }
                      placeholder="Optional"
                      autoComplete="off"
                    />
                  </div>
                </div>
              </div>

              {onRequestReminderPicker ? (
                <button
                  type="button"
                  className="task-editor__text-button"
                  onClick={onRequestReminderPicker}
                >
                  <BellIcon />
                  Open reminder picker
                </button>
              ) : null}
            </section>
          </div>

          {formError ? (
            <p id={ids.error} className="task-editor__form-error" role="alert">
              {formError}
            </p>
          ) : null}

          <footer className="task-editor__footer">
            <div className="task-editor__actions">
              <button
                type="button"
                className="task-editor__button task-editor__button--secondary"
                onClick={handleCancel}
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="task-editor__button task-editor__button--primary"
                disabled={isSaving}
              >
                {isSaving ? 'Saving...' : mode === 'create' ? 'Create task' : 'Save changes'}
              </button>
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

function PriorityMark({ priority }: { priority: TaskPriority }) {
  return (
    <span
      className={`task-editor__priority-mark task-editor__priority-mark--p${priority}`}
      aria-hidden="true"
    >
      P{priority}
    </span>
  );
}

function Icon({
  children,
  size = 18,
}: {
  children: ReactNode;
  size?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      className="task-editor__icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

function CloseIcon() {
  return (
    <Icon>
      <path d="m7 7 10 10M17 7 7 17" />
    </Icon>
  );
}

function ChevronDownIcon() {
  return (
    <Icon size={16}>
      <path d="m6 9 6 6 6-6" />
    </Icon>
  );
}

function FolderIcon() {
  return (
    <Icon>
      <path d="M3.5 7.5h6l1.8 2h9.2v8.7a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8Z" />
      <path d="M3.5 7.5V5.8A1.8 1.8 0 0 1 5.3 4h4l1.8 2h4.2" />
    </Icon>
  );
}

function TagIcon() {
  return (
    <Icon>
      <path d="m4 5 .6 6.1 7.8 7.8a2.1 2.1 0 0 0 3 0l3.5-3.5a2.1 2.1 0 0 0 0-3L11.1 4.6Z" />
      <circle cx="8" cy="8" r="1.1" />
    </Icon>
  );
}

function CalendarIcon() {
  return (
    <Icon>
      <rect x="4" y="5.5" width="16" height="15" rx="2" />
      <path d="M8 3.5v4M16 3.5v4M4 9.5h16" />
    </Icon>
  );
}

function RepeatIcon() {
  return (
    <Icon>
      <path d="M17 4.5h2.5v5M19.5 9.5l-3-3" />
      <path d="M19.2 9.5A7.5 7.5 0 0 0 5.4 7M7 19.5H4.5v-5M4.5 14.5l3 3" />
      <path d="M4.8 14.5A7.5 7.5 0 0 0 18.6 17" />
    </Icon>
  );
}

function BellIcon() {
  return (
    <Icon>
      <path d="M18 9.5a6 6 0 0 0-12 0c0 6-2.3 6.2-2.3 7.4h16.6C20.3 15.7 18 15.5 18 9.5Z" />
      <path d="M10 20h4" />
    </Icon>
  );
}

function PlusIcon() {
  return (
    <Icon size={15}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  );
}
